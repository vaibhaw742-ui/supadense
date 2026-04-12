/**
 * kb_resource_create — Fetch + create a resource record in the KB.
 *
 * Step 1 of the memorize pipeline. Creates the DB row and fetches/returns
 * raw content so the agent can analyze it and call kb_resource_place.
 *
 * For URLs: fetches the page via HTTP and returns the text content.
 * For text pastes: stores directly.
 * For YouTube: extracts video ID and returns metadata for agent to summarize.
 */
import z from "zod"
import { Tool } from "../tool"
import { Instance } from "../../project/instance"
import { Workspace } from "../../learning/workspace"
import { Resource } from "../../learning/resource"

const MAX_CONTENT_CHARS = 40_000 // ~10k tokens, enough for analysis

export const KbResourceCreateTool = Tool.define("kb_resource_create", {
  description: [
    "Step 1 of the memorize pipeline. Creates a resource record and fetches/returns its content.",
    "",
    "Supported modalities:",
    "  url      — web page (fetched via HTTP)",
    "  youtube  — YouTube video (extracts ID, returns metadata)",
    "  text     — plain text paste",
    "  pdf      — PDF file path or URL",
    "  image    — image file path",
    "  linkedin — LinkedIn post URL",
    "",
    "Returns: resource_id + raw_content for the agent to analyze.",
    "After this, use kb_resource_place to write analyzed content into wiki sections.",
    "Finally, call kb_wiki_build to regenerate the .md files.",
  ].join("\n"),
  parameters: z.object({
    workspace_id: z.string().describe("Workspace ID from kb_workspace_init"),
    modality: z
      .enum(["url", "youtube", "text", "pdf", "image", "linkedin"])
      .describe("What kind of resource this is"),
    input: z
      .string()
      .describe("The URL (for url/youtube/pdf/linkedin) or raw text content (for text/image)"),
    title: z.string().optional().describe("Optional title override"),
    author: z.string().optional().describe("Optional author/creator name"),
    note: z.string().optional().describe("Optional annotation from the user about this resource"),
  }),
  async execute(params, ctx) {
    const { workspace_id, modality, input, title, author, note } = params

    const workspace = Workspace.getById(workspace_id)
    if (!workspace) throw new Error(`Workspace ${workspace_id} not found. Run kb_workspace_init first.`)

    // ── Fetch content ───────────────────────────────────────────────────────
    let rawContent: string | undefined
    let metadata: Record<string, unknown> = {}
    let resolvedTitle = title
    let resolvedUrl: string | undefined

    switch (modality) {
      case "url":
      case "linkedin": {
        resolvedUrl = input
        try {
          const response = await fetch(input, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; supadense/1.0)" },
            signal: AbortSignal.timeout(15_000),
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const html = await response.text()
          // Basic HTML → text stripping (agent will parse properly)
          rawContent = html
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, MAX_CONTENT_CHARS)
          // Try to extract title from <title> tag
          if (!resolvedTitle) {
            const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
            if (titleMatch) resolvedTitle = titleMatch[1].trim()
          }
          metadata = { domain: new URL(input).hostname }
        } catch (err) {
          throw new Error(`Failed to fetch ${input}: ${err instanceof Error ? err.message : String(err)}`)
        }
        break
      }

      case "youtube": {
        resolvedUrl = input
        // Extract video ID
        const match = input.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/)
        const videoId = match?.[1]
        if (!videoId) throw new Error(`Could not extract YouTube video ID from: ${input}`)
        metadata = { video_id: videoId, channel: undefined, duration_seconds: undefined, transcript_available: false }
        rawContent = [
          `YouTube video: ${input}`,
          `Video ID: ${videoId}`,
          "Note: transcript not automatically fetched. Summarize from video content knowledge.",
        ].join("\n")
        break
      }

      case "text": {
        rawContent = input.slice(0, MAX_CONTENT_CHARS)
        break
      }

      case "pdf": {
        // PDF parsing requires additional deps — for now, store the path/URL
        // and instruct agent to provide content manually
        resolvedUrl = input.startsWith("http") ? input : undefined
        rawContent = input.startsWith("http")
          ? `PDF at URL: ${input}\nNote: PDF content extraction not yet automated. Please paste the relevant text manually.`
          : `PDF file: ${input}\nNote: PDF content extraction not yet automated. Please paste the relevant text manually.`
        metadata = { source_url: input }
        break
      }

      case "image": {
        rawContent = `Image: ${input}\nNote: Describe the image content for the knowledge base.`
        break
      }
    }

    if (note) {
      rawContent = `${rawContent ?? ""}\n\n--- User note ---\n${note}`
    }

    // ── Create DB record ────────────────────────────────────────────────────
    const resource = Resource.create({
      workspace_id,
      modality,
      url: resolvedUrl,
      title: resolvedTitle,
      author,
      raw_content: rawContent,
      metadata,
    })

    Resource.setStatus(resource.id, "processing", "awaiting_analysis")

    Workspace.logEvent(workspace_id, {
      event_type: "memorize",
      summary: `Resource created (${modality}): ${resolvedTitle ?? resolvedUrl ?? "text paste"}`,
      resource_id: resource.id,
      payload: { modality, url: resolvedUrl },
    })

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
      },
      output: [
        `resource_id: ${resource.id}`,
        `modality: ${modality}`,
        resolvedUrl ? `url: ${resolvedUrl}` : "",
        resolvedTitle ? `title: ${resolvedTitle}` : "",
        "",
        "--- Content for analysis ---",
        contentPreview,
        isTruncated ? `\n[... truncated at 500 chars — full content: ${rawContent?.length} chars ...]` : "",
        "",
        "Next steps:",
        "1. Analyze this content to determine the relevant category/subcategory and key concepts.",
        "2. Extract the most valuable chunks for each wiki section.",
        "3. Call kb_resource_place for each chunk (can call multiple times, one per section).",
        "4. Call kb_concept_upsert for any new concepts discovered.",
        "5. Call kb_wiki_build to regenerate the .md files.",
        "6. Call kb_event_log to update log.md.",
      ]
        .filter((l) => l !== null)
        .join("\n"),
    }
  },
})
