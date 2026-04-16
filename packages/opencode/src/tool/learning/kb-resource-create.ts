/**
 * kb_resource_create — Fetch + create a resource record in the KB.
 *
 * Step 1 of the memorize pipeline. Creates the DB row, fetches content,
 * and automatically downloads images into wiki/assets/.
 */
import z from "zod"
import { createHash } from "crypto"
import { mkdirSync, writeFileSync, existsSync } from "fs"
import path from "path"
import { Tool } from "../tool"
import { Workspace } from "../../learning/workspace"
import { Resource, MediaAsset } from "../../learning/resource"

const MAX_CONTENT_CHARS = 40_000

// ── Airtop extraction ──────────────────────────────────────────────────────

const AIRTOP_AGENT_WEBHOOK =
  "https://api.airtop.ai/api/hooks/agents/e0103755-2146-43d3-bd25-5410d00b3654/webhooks/984d5de3-2807-43c8-af8a-f441652a11f4"

async function fetchWithAirtop(url: string, apiKey: string): Promise<{
  content: string
  imageCandidates: string[]
  title?: string
}> {
  // ── 1. Trigger ─────────────────────────────────────────────────────────
  const triggerRes = await fetch(AIRTOP_AGENT_WEBHOOK, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ configVars: { url } }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!triggerRes.ok) throw new Error(`Airtop trigger failed: HTTP ${triggerRes.status}`)
  const { invocationId } = (await triggerRes.json()) as { invocationId: string }
  if (!invocationId) throw new Error("Airtop did not return an invocationId")

  // ── 2. Poll until completed ────────────────────────────────────────────
  const pollUrl = `https://api.airtop.ai/api/hooks/agents/e0103755-2146-43d3-bd25-5410d00b3654/invocations/${invocationId}/result`
  const MAX_ATTEMPTS = 60       // 60 × 5s = 5 min max (Airtop takes ~100s)
  const POLL_INTERVAL_MS = 5_000

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))

    const res = await fetch(pollUrl, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) continue  // transient error — keep polling

    const data = (await res.json()) as { status?: string; output?: unknown; error?: string }

    console.log(`[Airtop] attempt ${attempt + 1} status=${data.status ?? "(no status field)"}`)

    const statusLower = data.status?.toLowerCase() ?? ""
    if (statusLower === "failed") throw new Error(`Airtop extraction failed: ${data.error ?? "unknown"}`)

    // Accept "Completed" / "completed" or treat it as done if output.success === true
    const outputObj = data.output as Record<string, unknown> | undefined
    const isDone = statusLower === "completed" || outputObj?.success === true

    if (isDone && data.output != null) {
      // Airtop returns: { success: true, text_md: "...", title: "...", url: "..." }
      const raw = data.output
      const markdown = typeof raw === "string"
        ? raw
        : outputObj?.text_md as string
          ?? outputObj?.markdown as string
          ?? outputObj?.content as string
          ?? outputObj?.text as string
          ?? JSON.stringify(raw)

      // Extract image URLs from markdown: ![alt](https://...)
      const imageCandidates: string[] = []
      const imgRegex = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g
      let m: RegExpExecArray | null
      while ((m = imgRegex.exec(markdown)) !== null) {
        if (!imageCandidates.includes(m[1])) imageCandidates.push(m[1])
        if (imageCandidates.length >= 10) break
      }

      // Prefer title from Airtop output, fall back to first # heading
      const title = (outputObj?.title as string | undefined)
        ?? markdown.match(/^#\s+(.+)$/m)?.[1]?.trim()

      return {
        content: markdown.slice(0, MAX_CONTENT_CHARS),
        imageCandidates,
        title,
      }
    }
    // status === "running" — keep polling
  }

  throw new Error("Airtop extraction timed out after ~3 minutes")
}

// ── Image download helpers ─────────────────────────────────────────────────

const TRACKING_DOMAINS = ["pixel.", "track.", "beacon.", "doubleclick.", "googlesyndication.", "analytics."]
const ALLOWED_MIMES: Record<string, string> = {
  "image/jpeg": "jpg", "image/jpg": "jpg",
  "image/png": "png", "image/gif": "gif", "image/webp": "webp",
}

function detectMime(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png"
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif"
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return "image/webp"
  return null
}

function parsePngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

function parseJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let i = 2
  while (i < bytes.length - 8) {
    if (bytes[i] !== 0xff) break
    const marker = bytes[i + 1]
    const len = (bytes[i + 2] << 8) | bytes[i + 3]
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return { width: (bytes[i + 7] << 8) | bytes[i + 8], height: (bytes[i + 5] << 8) | bytes[i + 6] }
    }
    i += 2 + len
  }
  return null
}

async function downloadImages(
  candidates: string[],
  sourceUrl: string,
  resourceId: string,
  workspaceId: string,
  kbPath: string,
): Promise<{ asset_ids: string[]; downloaded: number; skipped: number }> {
  const nsPrefix = workspaceId.slice(0, 8)
  const assetsDir = path.join(kbPath, "wiki", "assets", nsPrefix)
  mkdirSync(assetsDir, { recursive: true })

  const assetIds: string[] = []
  let downloaded = 0
  let skipped = 0

  for (const url of candidates.slice(0, 10)) {
    try {
      const parsed = new URL(url)
      if (!["http:", "https:"].includes(parsed.protocol)) { skipped++; continue }
      if (TRACKING_DOMAINS.some((d) => parsed.hostname.includes(d))) { skipped++; continue }
      if (url.toLowerCase().endsWith(".svg") || url.includes(".svg?")) { skipped++; continue }

      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; supadense/1.0)",
          "Referer": sourceUrl,
        },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) { skipped++; continue }

      const MAX_BYTES = 5 * 1024 * 1024
      const reader = res.body?.getReader()
      if (!reader) { skipped++; continue }

      const chunks: Uint8Array[] = []
      let total = 0
      let tooLarge = false
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.length
        if (total > MAX_BYTES) { await reader.cancel(); tooLarge = true; break }
        chunks.push(value)
      }
      if (tooLarge || total < 1024) { skipped++; continue }

      const bytes = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }

      const contentType = res.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? ""
      const mime = (ALLOWED_MIMES[contentType] ? contentType : null) ?? detectMime(bytes)
      if (!mime || !ALLOWED_MIMES[mime]) { skipped++; continue }

      const dims = mime === "image/png" ? parsePngDimensions(bytes)
        : mime === "image/jpeg" ? parseJpegDimensions(bytes)
        : null
      if (dims && (dims.width < 50 || dims.height < 50)) { skipped++; continue }

      const ext = ALLOWED_MIMES[mime]
      const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 8)
      const filename = `${resourceId.slice(0, 8)}-${hash}.${ext}`
      const localPath = `wiki/assets/${nsPrefix}/${filename}`
      const fullPath = path.join(assetsDir, filename)

      // DB dedup
      const existing = MediaAsset.findByLocalPath(workspaceId, localPath)
      if (existing) { assetIds.push(existing.id); skipped++; continue }

      if (!existsSync(fullPath)) writeFileSync(fullPath, bytes)

      const is_diagram = !!(dims && dims.width / dims.height > 1.5 && dims.width > 400)
      const asset = MediaAsset.create({
        resource_id: resourceId,
        workspace_id: workspaceId,
        asset_type: "image",
        source_url: url,
        local_path: localPath,
        mime_type: mime,
        width: dims?.width,
        height: dims?.height,
        is_diagram,
      })
      assetIds.push(asset.id)
      downloaded++
    } catch {
      skipped++
    }
  }

  return { asset_ids: assetIds, downloaded, skipped }
}

export const KbResourceCreateTool = Tool.define("kb_resource_create", {
  description: [
    "Step 1 of the memorize pipeline. Creates a resource record, fetches content, and auto-downloads images.",
    "",
    "⛔ MODALITY RULES — READ CAREFULLY:",
    "  url      — ANY web page URL (http/https). Fetches page + downloads images automatically.",
    "  youtube  — YouTube video URL",
    "  linkedin — LinkedIn post URL",
    "  pdf      — PDF file path or URL",
    "  text     — ONLY for raw text with NO source URL whatsoever.",
    "  image    — image file path",
    "",
    "When the user gives a URL: ALWAYS use modality:'url', pass the URL as `input`.",
    "NEVER pre-fetch the page yourself before calling this tool — images will be lost.",
    "NEVER use modality:'text' when you have a URL.",
    "",
    "If you already fetched the content by mistake: still call with modality:'url' and the original URL.",
    "The tool will re-fetch it and download all images.",
    "",
    "Returns: resource_id + content preview + asset_ids of downloaded images.",
  ].join("\n"),
  parameters: z.object({
    workspace_id: z.string().describe("Workspace ID from kb_workspace_init"),
    modality: z.enum(["url", "youtube", "text", "pdf", "image", "linkedin"]).describe(
      "What kind of resource. Use 'url' for any http/https link — NEVER use 'text' when you have a URL."
    ),
    input: z.string().describe(
      "For url/youtube/linkedin/pdf: the RAW URL — do NOT paste fetched content here. " +
      "For text: the actual text content (only when no URL exists)."
    ),
    source_url: z.string().optional().describe(
      "REQUIRED when modality is 'text' but content came from a URL. " +
      "Provide the original URL so images can be downloaded and the source can be linked."
    ),
    title: z.string().optional().describe("Optional title override"),
    author: z.string().optional().describe("Optional author/creator name"),
    note: z.string().optional().describe("Optional annotation from the user about this resource"),
  }),
  async execute(params) {
    const { workspace_id, title, author, note } = params
    let { modality, input } = params
    const sourceUrl = params.source_url?.trim()

    const workspace = Workspace.getById(workspace_id)
    if (!workspace) throw new Error(`Workspace ${workspace_id} not found. Run kb_workspace_init first.`)

    // ── Auto-upgrade text→url when input looks like a URL ────────────────────
    // Agents sometimes pass a URL with modality:"text" — detect and fix it.
    if (modality === "text") {
      const trimmed = input.trim()
      if (/^https?:\/\//i.test(trimmed)) {
        modality = trimmed.includes("youtube.com") || trimmed.includes("youtu.be") ? "youtube"
          : trimmed.includes("linkedin.com") ? "linkedin"
          : "url"
        input = trimmed
      }
    }

    // ── Guard: text without source_url when content looks pre-fetched ─────────
    // If agent passed formatted article content as "text" without source_url,
    // it likely pre-fetched a URL. Warn and require source_url to get images.
    if (modality === "text" && !sourceUrl) {
      // Heuristic: looks like pre-fetched article (has markdown headers, multiple paragraphs, >500 chars)
      const looksLikeFetchedContent = input.length > 500 &&
        (/^#{1,3}\s.+/m.test(input) || /\*\*[^*]{5,}\*\*/m.test(input)) &&
        (input.match(/\n\n/g)?.length ?? 0) >= 3
      if (looksLikeFetchedContent) {
        return {
          title: "source_url required",
          metadata: { error: "missing_source_url" },
          output: [
            "⚠️ This content looks like it was fetched from a URL.",
            "",
            "To download images and link the source, please re-call this tool with the original URL:",
            "",
            "Option A (preferred): Use modality:'url' and pass the URL as `input` — the tool fetches everything automatically.",
            "Option B: Keep modality:'text' but add source_url:'<the original URL>' so images can be downloaded.",
            "",
            "What was the original URL for this content?",
          ].join("\n"),
        }
      }
    }

    // ── Deduplication ────────────────────────────────────────────────────────
    if (["url", "linkedin", "youtube", "pdf"].includes(modality)) {
      const existing = Resource.getByUrl(workspace_id, input)
      if (existing) {
        return {
          title: `Already memorized: ${existing.title ?? input}`,
          metadata: { resource_id: existing.id, duplicate: true, url: input } as Record<string, unknown>,
          output: [
            `⚠️ This resource has already been memorized.`,
            `resource_id: ${existing.id}`,
            `title: ${existing.title ?? "(untitled)"}`,
            `url: ${input}`,
            `memorized_at: ${new Date(existing.memorized_at ?? existing.time_created).toLocaleString()}`,
            "",
            "No action taken. If you want to re-process it, remove the existing resource first.",
          ].join("\n"),
        }
      }
    }

    // ── Fetch content ────────────────────────────────────────────────────────
    let rawContent: string | undefined
    let metadata: Record<string, unknown> = {}
    let resolvedTitle = title
    let resolvedUrl: string | undefined
    let imageCandidates: string[] = []

    switch (modality) {
      case "url":
      case "linkedin": {
        resolvedUrl = input
        metadata = { domain: new URL(input).hostname }

        const airtopKey = process.env.AIRTOP_API_KEY
        if (airtopKey) {
          // ── Airtop path: structured markdown extraction ──────────────────
          const airtop = await fetchWithAirtop(input, airtopKey)
          rawContent = airtop.content
          imageCandidates = airtop.imageCandidates
          if (!resolvedTitle && airtop.title) resolvedTitle = airtop.title
        } else {
          // ── Fallback: direct HTML fetch ───────────────────────────────────
          const response = await fetch(input, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; supadense/1.0)" },
            signal: AbortSignal.timeout(15_000),
          })
          if (!response.ok) throw new Error(`Failed to fetch ${input}: HTTP ${response.status}`)
          const html = await response.text()

          const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
            ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
          if (ogMatch?.[1]) imageCandidates.push(ogMatch[1])
          const imgRegex = /<img[^>]+(?:src|data-src)=["']([^"']+)["']/gi
          let imgMatch: RegExpExecArray | null
          while ((imgMatch = imgRegex.exec(html)) !== null) {
            const src = imgMatch[1]
            if (src.startsWith("data:") || src.toLowerCase().endsWith(".svg")) continue
            try {
              const abs = new URL(src, input).href
              if (!imageCandidates.includes(abs)) imageCandidates.push(abs)
            } catch { /* malformed */ }
            if (imageCandidates.length >= 10) break
          }
          rawContent = html
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, MAX_CONTENT_CHARS)
          if (!resolvedTitle) {
            const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
            if (titleMatch) resolvedTitle = titleMatch[1].trim()
          }
        }
        break
      }

      case "youtube": {
        resolvedUrl = input
        const match = input.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/)
        const videoId = match?.[1]
        if (!videoId) throw new Error(`Could not extract YouTube video ID from: ${input}`)
        metadata = { video_id: videoId }
        rawContent = [`YouTube video: ${input}`, `Video ID: ${videoId}`, "Note: transcript not automatically fetched."].join("\n")
        break
      }

      case "text": {
        rawContent = input.slice(0, MAX_CONTENT_CHARS)
        // If the caller provided source_url, fetch images from it and record the URL
        if (sourceUrl && /^https?:\/\//i.test(sourceUrl)) {
          resolvedUrl = sourceUrl
          try {
            const res = await fetch(sourceUrl, {
              headers: { "User-Agent": "Mozilla/5.0 (compatible; supadense/1.0)" },
              signal: AbortSignal.timeout(10_000),
            })
            if (res.ok) {
              const html = await res.text()
              const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
                ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
              if (ogMatch?.[1]) imageCandidates.push(ogMatch[1])
              const imgRegex = /<img[^>]+(?:src|data-src)=["']([^"']+)["']/gi
              let m: RegExpExecArray | null
              while ((m = imgRegex.exec(html)) !== null) {
                const src = m[1]
                if (src.startsWith("data:") || src.toLowerCase().endsWith(".svg")) continue
                try {
                  const abs = new URL(src, sourceUrl).href
                  if (!imageCandidates.includes(abs)) imageCandidates.push(abs)
                } catch { /* malformed */ }
                if (imageCandidates.length >= 10) break
              }
              if (!resolvedTitle) {
                const tm = html.match(/<title[^>]*>([^<]+)<\/title>/i)
                if (tm) resolvedTitle = tm[1].trim()
              }
            }
          } catch { /* non-fatal */ }
        }
        break
      }

      case "pdf": {
        resolvedUrl = input.startsWith("http") ? input : undefined
        rawContent = `PDF: ${input}\nNote: PDF content extraction not yet automated. Please paste the relevant text manually.`
        metadata = { source_url: input }
        break
      }

      case "image": {
        rawContent = `Image: ${input}\nNote: Describe the image content for the knowledge base.`
        break
      }
    }

    if (note) rawContent = `${rawContent ?? ""}\n\n--- User note ---\n${note}`

    // ── Create DB record ─────────────────────────────────────────────────────
    // raw_content is stored as a file, not in the DB column.
    const resource = Resource.create({
      workspace_id, modality, url: resolvedUrl,
      title: resolvedTitle, author, metadata,
    })

    // ── Write raw content to file ─────────────────────────────────────────────
    // Stored under <kb_path>/raw/<id>.md — DB holds only the path.
    // getRawContent() reads the file; falls back to raw_content column for old records.
    if (rawContent) {
      const rawDir = path.join(workspace.kb_path, "raw")
      mkdirSync(rawDir, { recursive: true })
      const filename = `${resource.id}.md`
      writeFileSync(path.join(rawDir, filename), rawContent, "utf8")
      Resource.update(resource.id, { raw_content_path: `raw/${filename}` })
    }
    Resource.setStatus(resource.id, "processing", "awaiting_analysis")

    Workspace.logEvent(workspace_id, {
      event_type: "memorize",
      summary: `Resource created (${modality}): ${resolvedTitle ?? resolvedUrl ?? "text paste"}`,
      resource_id: resource.id,
      payload: { modality, url: resolvedUrl },
    })

    // ── Auto-download images ─────────────────────────────────────────────────
    let imageResult = { asset_ids: [] as string[], downloaded: 0, skipped: 0 }
    if (imageCandidates.length > 0) {
      try {
        imageResult = await downloadImages(imageCandidates, input, resource.id, workspace_id, workspace.kb_path)
      } catch {
        // Non-fatal — continue without images
      }
    }

    const contentPreview = (rawContent ?? "").slice(0, 500)
    const isTruncated = (rawContent?.length ?? 0) > 500

    return {
      title: `Resource: ${resolvedTitle ?? resolvedUrl ?? modality}`,
      metadata: {
        resource_id: resource.id,
        modality,
        url: resolvedUrl,
        title: resolvedTitle,
        content_length: rawContent?.length ?? 0,
        asset_ids: imageResult.asset_ids,
        images_downloaded: imageResult.downloaded,
      },
      output: [
        `resource_id: ${resource.id}`,
        `modality: ${modality}`,
        resolvedUrl ? `url: ${resolvedUrl}` : "",
        resolvedTitle ? `title: ${resolvedTitle}` : "",
        imageResult.downloaded > 0
          ? `images: ${imageResult.downloaded} downloaded, asset_ids: [${imageResult.asset_ids.join(", ")}]`
          : `images: none downloaded (${imageResult.skipped} filtered)`,
        "",
        "--- Content for analysis ---",
        contentPreview,
        isTruncated ? `\n[... truncated at 500 chars — full ${rawContent?.length} chars ...]` : "",
        "",
        "Next steps:",
        "1. Analyze this content to determine the relevant category/subcategory and key concepts.",
        imageResult.asset_ids.length > 0
          ? `2. Call kb_resource_place for each section. Pass media_asset_ids: [${imageResult.asset_ids.map(id => `"${id}"`).join(", ")}] on the most relevant placement.`
          : "2. Call kb_resource_place for each section chunk.",
        "3. Call kb_concept_upsert for any new concepts discovered.",
        "4. Call kb_wiki_build to regenerate the .md files.",
        "5. Call kb_event_log to update log.md.",
      ].filter(Boolean).join("\n"),
    }
  },
})
