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
    "Supported modalities:",
    "  url      — web page (fetched via HTTP)",
    "  youtube  — YouTube video (extracts ID, returns metadata)",
    "  text     — plain text paste",
    "  pdf      — PDF file path or URL",
    "  image    — image file path",
    "  linkedin — LinkedIn post URL",
    "",
    "Returns: resource_id + raw_content for the agent to analyze + asset_ids of downloaded images.",
    "After this, use kb_resource_place to write analyzed content into wiki sections.",
    "Finally, call kb_wiki_build to regenerate the .md files.",
  ].join("\n"),
  parameters: z.object({
    workspace_id: z.string().describe("Workspace ID from kb_workspace_init"),
    modality: z.enum(["url", "youtube", "text", "pdf", "image", "linkedin"]).describe("What kind of resource this is"),
    input: z.string().describe("The URL (for url/youtube/pdf/linkedin) or raw text content (for text/image)"),
    title: z.string().optional().describe("Optional title override"),
    author: z.string().optional().describe("Optional author/creator name"),
    note: z.string().optional().describe("Optional annotation from the user about this resource"),
  }),
  async execute(params) {
    const { workspace_id, modality, input, title, author, note } = params

    const workspace = Workspace.getById(workspace_id)
    if (!workspace) throw new Error(`Workspace ${workspace_id} not found. Run kb_workspace_init first.`)

    // ── Deduplication ────────────────────────────────────────────────────────
    if (["url", "linkedin", "youtube", "pdf"].includes(modality)) {
      const existing = Resource.getByUrl(workspace_id, input)
      if (existing) {
        return {
          title: `Already memorized: ${existing.title ?? input}`,
          metadata: { resource_id: existing.id, duplicate: true, url: input },
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
        const response = await fetch(input, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; supadense/1.0)" },
          signal: AbortSignal.timeout(15_000),
        })
        if (!response.ok) throw new Error(`Failed to fetch ${input}: HTTP ${response.status}`)
        const html = await response.text()

        // Extract image candidates before stripping HTML
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
        metadata = { domain: new URL(input).hostname }
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
    const resource = Resource.create({
      workspace_id, modality, url: resolvedUrl,
      title: resolvedTitle, author, raw_content: rawContent, metadata,
    })
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
