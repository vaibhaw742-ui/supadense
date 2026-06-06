/**
 * retrieval.ts — Query the knowledge base for relevant content
 *
 * Returns exact file_path or resource info so the agent can read further.
 *
 * Search order:
 *   1. Concept match (slug / name / alias)
 *   2. Raw content file search (raw/*.txt)
 */
import { eq } from "drizzle-orm"
import { readFileSync, existsSync } from "fs"
import path from "path"
import { Database } from "../storage/db"
import {
  LearningResourceTable,
} from "./schema.sql"
import { Workspace } from "./workspace"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RetrievalImage {
  /** Relative path from kb_path: "assets/abc/img.jpg" */
  local_path: string
  /** Full abs path */
  abs_path: string
  alt_text: string | null
  caption: string | null
  is_diagram: boolean
}

export interface RetrievalResult {
  /** Relative path from kb_path or resource raw path */
  file_path: string
  /** Full abs path for ReadTool */
  abs_path: string
  /** Clean one-line description of what's there */
  summary: string
  /** How this result was found */
  match_type: "concept" | "raw"
  /** 0.0–1.0 relevance hint */
  relevance: number
  /** Images associated with this result */
  images: RetrievalImage[]
}

export interface ConceptResult {
  name: string
  slug: string
  definition: string | null
  explanation: string | null
  aliases: string[]
  related_slugs: string[]
}

export interface SourceResult {
  title: string | null
  url: string | null
  author: string | null
  modality: string
  added_at: number
}

// ─── Retrieval ────────────────────────────────────────────────────────────────

export namespace Retrieval {
  /**
   * Main entry: find the best locations in the KB for a query string.
   * Returns up to `limit` results sorted by relevance.
   */
  export function search(workspaceId: string, query: string, limit = 8): RetrievalResult[] {
    const workspace = Workspace.getById(workspaceId)
    if (!workspace) return []

    const kbPath = workspace.kb_path
    const results: RetrievalResult[] = []
    const seen = new Set<string>()

    const q = query.toLowerCase().trim()
    const words = q.split(/\s+/).filter(Boolean)

    // ── 1. Raw content file search ────────────────────────────────────────────
    const resources = Database.use((db) =>
      db
        .select()
        .from(LearningResourceTable)
        .where(eq(LearningResourceTable.workspace_id, workspaceId))
        .all(),
    )
    for (const resource of resources) {
      const filePath = resource.raw_content_path ?? null
      const key = `${filePath ?? `raw/${resource.id}`}:_`
      if (seen.has(key)) continue

      let rawText = ""
      if (resource.raw_content_path) {
        const fullPath = path.join(kbPath, resource.raw_content_path)
        if (existsSync(fullPath)) {
          const buf = readFileSync(fullPath, "utf8")
          rawText = buf.slice(0, 100_000).toLowerCase()
        }
      } else if (resource.raw_content) {
        rawText = resource.raw_content.slice(0, 100_000).toLowerCase()
      }
      if (!rawText) continue

      const matchedWords = words.filter((w) => rawText.includes(w))
      if (matchedWords.length === 0) continue

      seen.add(key)

      const firstWord = matchedWords[0]
      const idx = rawText.indexOf(firstWord)
      const start = Math.max(0, idx - 40)
      const snippet = rawText.slice(start, start + 120).replace(/\s+/g, " ").trim()

      const rawImages: RetrievalImage[] = []

      results.push({
        file_path: filePath ?? `raw/${resource.id}`,
        abs_path: path.join(kbPath, filePath ?? `raw/${resource.id}`),
        summary: `Raw source: "${resource.title ?? resource.url ?? resource.id}"${resource.author ? ` by ${resource.author}` : ""} — "…${snippet}…"`,
        match_type: "raw",
        relevance: 0.4 + 0.1 * (matchedWords.length / words.length),
        images: rawImages,
      })
    }

    return results.sort((a, b) => b.relevance - a.relevance).slice(0, limit)
  }

  /**
   * Enriched search: returns locations + related concepts + source resources.
   */
  export function searchWithContext(
    workspaceId: string,
    query: string,
    limit = 8,
  ): { locations: RetrievalResult[]; concepts: ConceptResult[]; sources: SourceResult[] } {
    const locations = search(workspaceId, query, limit)

    const q = query.toLowerCase().trim()
    const words = q.split(/\s+/).filter(Boolean)

    const matchedConcepts: ConceptResult[] = []

    // ── Source resources ──────────────────────────────────────────────────────
    const allResources = Database.use((db) =>
      db.select().from(LearningResourceTable)
        .where(eq(LearningResourceTable.workspace_id, workspaceId))
        .all(),
    )
    const sources: SourceResult[] = allResources
      .filter((r) => {
        const text = [r.title ?? "", r.url ?? "", r.author ?? "", r.summary ?? ""].join(" ").toLowerCase()
        return words.some((w) => text.includes(w))
      })
      .slice(0, 10)
      .map((r) => ({
        title: r.title ?? null,
        url: r.url ?? null,
        author: r.author ?? null,
        modality: r.modality,
        added_at: r.added_at,
      }))

    return { locations, concepts: matchedConcepts, sources }
  }

  /** Format results as a readable string for agent output. */
  export function format(results: RetrievalResult[]): string {
    if (results.length === 0) return "No matching content found in the knowledge base."

    return results
      .map((r, i) => {
        const imgLine = r.images.length > 0
          ? `\n   Images (${r.images.length}): ${r.images.map((img) => img.abs_path).join(", ")}`
          : ""
        return [
          `${i + 1}. **${r.file_path}**`,
          `   ${r.summary}`,
          `   Match: ${r.match_type} | Relevance: ${Math.round(r.relevance * 100)}%`,
          `   Path: ${r.abs_path}${imgLine}`,
        ].join("\n")
      })
      .join("\n\n")
  }
}
