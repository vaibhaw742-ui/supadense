import path from "path"
import { createHash } from "crypto"

/**
 * Derive a slug from a file path relative to the brain directory.
 * e.g. /project/.brain/L0/people/alice.md → "L0/people/alice"
 */
export function deriveSlug(filePath: string, brainDir: string): string {
  const rel = path.relative(brainDir, filePath)
  return rel.replace(/\.md$/, "").replace(/\\/g, "/")
}

/**
 * Generate an inbox slug for unstructured captures.
 * e.g. "inbox/2026-06-02-a3f9b2"
 */
export function inboxSlug(contentHash: string): string {
  const date = new Date().toISOString().slice(0, 10)
  return `inbox/${date}-${contentHash.slice(0, 6)}`
}

/**
 * Slugify a string for use in file paths.
 */
export function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60)
}

/**
 * Extract title from content (first # heading or first non-empty line).
 */
export function extractTitle(content: string): string {
  const h1 = content.match(/^#\s+(.+)$/m)
  if (h1) return h1[1].trim()
  const firstLine = content.split("\n").find((l) => l.trim())
  return (firstLine ?? "Untitled").trim().slice(0, 120)
}

export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16)
}
