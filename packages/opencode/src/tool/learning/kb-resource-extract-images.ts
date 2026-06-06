/**
 * kb_resource_extract_images — Download and store images from a resource's web page.
 *
 * Called after kb_resource_create when image_candidates are returned.
 * Downloads, filters, and stores images to assets/.
 * Returns asset_ids stored in the KB assets/ folder.
 */
import z from "zod"
import { createHash } from "crypto"
import { mkdirSync, writeFileSync, existsSync } from "fs"
import path from "path"
import { Tool } from "../tool"
import { Workspace } from "../../learning/workspace"
import { Resource } from "../../learning/resource"

const TRACKING_DOMAINS = ["pixel.", "track.", "beacon.", "doubleclick.", "googlesyndication.", "analytics."]

const ALLOWED_MIMES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
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
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6]
      const width = (bytes[i + 7] << 8) | bytes[i + 8]
      return { width, height }
    }
    i += 2 + len
  }
  return null
}

function getDimensions(bytes: Uint8Array, mime: string): { width: number; height: number } | null {
  if (mime === "image/png") return parsePngDimensions(bytes)
  if (mime === "image/jpeg") return parseJpegDimensions(bytes)
  return null
}

type DownloadResult =
  | { asset: { local_path: string; mime_type: string; width?: number; height?: number; is_diagram: boolean } }
  | { skip: string }
  | { error: string }

async function downloadImage(
  url: string,
  workspaceId: string,
  resourceId: string,
  assetsDir: string,
  nsPrefix: string,
): Promise<DownloadResult> {
  try {
    const parsed = new URL(url)
    if (!["http:", "https:"].includes(parsed.protocol)) return { skip: "non-http scheme" }
    if (TRACKING_DOMAINS.some((d) => parsed.hostname.includes(d))) return { skip: "tracking domain" }
    if (url.toLowerCase().endsWith(".svg") || url.includes(".svg?")) return { skip: "svg" }

    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; supadense/1.0)" },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return { error: `HTTP ${response.status}` }

    const contentLength = parseInt(response.headers.get("content-length") ?? "0", 10)
    if (contentLength > 5 * 1024 * 1024) return { skip: "too large (>5MB)" }

    const MAX_BYTES = 5 * 1024 * 1024
    const reader = response.body?.getReader()
    if (!reader) return { error: "no response body" }

    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > MAX_BYTES) {
        await reader.cancel()
        return { skip: "too large (streaming >5MB)" }
      }
      chunks.push(value)
    }

    if (total < 2 * 1024) return { skip: "too small (<2KB, likely icon)" }

    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }

    const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? ""
    const mime = (ALLOWED_MIMES[contentType] ? contentType : null) ?? detectMime(bytes)
    if (!mime || !ALLOWED_MIMES[mime]) return { skip: `unsupported type: ${contentType}` }

    const ext = ALLOWED_MIMES[mime]
    const dims = getDimensions(bytes, mime)
    if (dims && (dims.width < 50 || dims.height < 50)) {
      return { skip: `too small dimensions (${dims.width}x${dims.height})` }
    }

    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 8)
    const resPrefix = resourceId.slice(0, 8)
    const filename = `${resPrefix}-${hash}.${ext}`
    const localPath = `.supadense/assets/${nsPrefix}/${filename}`
    const fullPath = path.join(assetsDir, filename)

    if (!existsSync(fullPath)) {
      writeFileSync(fullPath, bytes)
    }

    const is_diagram = !!(dims && dims.width / dims.height > 1.5 && dims.width > 400)
    return { asset: { local_path: localPath, mime_type: mime, width: dims?.width, height: dims?.height, is_diagram } }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

export const KbResourceExtractImagesTool = Tool.define("kb_resource_extract_images", {
  description: [
    "Download and store images from a resource into assets/.",
    "",
    "Call this after kb_resource_create when image_candidates are returned in the metadata.",
    "Returns asset_ids that are stored in the KB assets/ folder.",
    "",
    "The tool filters out icons, tracking pixels, SVGs, and oversized images automatically.",
    "Images marked is_diagram: true are wide landscape images — best placed near concept introductions.",
    "",
    "Parameters:",
    "  resource_id    — from kb_resource_create",
    "  image_urls     — the image_candidates array from kb_resource_create metadata",
  ].join("\n"),
  parameters: z.object({
    resource_id: z.string().describe("Resource ID from kb_resource_create"),
    image_urls: z.array(z.string()).max(10).describe("Candidate image URLs from kb_resource_create metadata.image_candidates"),
  }),
  async execute(params) {
    // assets are no longer stored on disk — return empty result immediately
    const skipped = params.image_urls.length
    return {
      title: "Image extraction skipped",
      metadata: { asset_ids: [] as string[], downloaded: 0, skipped, failed: 0 },
      output: `skipped: ${skipped}\nNo images extracted.`,
    }
  },
})
