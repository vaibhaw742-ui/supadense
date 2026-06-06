import { brainDb } from "../db"
import type { VectorResult } from "./vector"

const STOP_WORDS = new Set([
  "the","a","an","is","are","was","were","has","have","had","do","does","did",
  "and","or","but","in","on","at","to","for","of","with","from","that","this",
  "i","me","my","you","we","they","it","what","who","how","why","when","where",
  "tell","show","find","get","give","list","summarize","explain","extract",
  "describe","about","can","will","would","should","could","may","might",
])

export function extractKeywords(query: string): string {
  const words = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))

  if (words.length === 0) {
    // Fallback: use last 3 words of query
    return query.split(/\s+/).slice(-3).join(" & ")
  }
  return words.join(" & ")
}

export async function keywordSearch(
  query: string,
  layer: number,
  sourceId: string,
  limit = 10,
): Promise<VectorResult[]> {
  const db       = brainDb()
  const keywords = extractKeywords(query)

  // Try full-text search first
  const rows = await db.unsafe(`
    SELECT
      p.id, p.slug, p.title, p.layer, p.type, p.compiled_truth,
      ts_rank(
        to_tsvector('english', COALESCE(p.title,'') || ' ' || COALESCE(p.compiled_truth,'')),
        to_tsquery('english', $1)
      ) AS score
    FROM brain_pages p
    WHERE p.deleted_at IS NULL
      AND p.source_id = $2
      AND p.layer = $3
      AND to_tsvector('english', COALESCE(p.title,'') || ' ' || COALESCE(p.compiled_truth,''))
            @@ to_tsquery('english', $1)
    ORDER BY score DESC
    LIMIT $4
  `, [keywords, sourceId, layer, limit]).catch(() => []) as VectorResult[]

  if (rows.length > 0) return rows.map((r) => ({ ...r, score: Number(r.score) }))

  // ILIKE fallback
  const terms = keywords.replace(/ & /g, " ").split(" ").filter(Boolean)
  if (!terms.length) return []

  const likeClause = terms
    .map((_, i) => `(p.title ILIKE $${i + 4} OR p.compiled_truth ILIKE $${i + 4})`)
    .join(" OR ")

  const params: (string | number)[] = [sourceId, layer, limit, ...terms.map((t) => `%${t}%`)]
  const fallback = await db.unsafe(`
    SELECT p.id, p.slug, p.title, p.layer, p.type, p.compiled_truth, 0.01 AS score
    FROM brain_pages p
    WHERE p.deleted_at IS NULL AND p.source_id = $1 AND p.layer = $2
      AND (${likeClause})
    ORDER BY p.updated_at DESC
    LIMIT $3
  `, params).catch(() => []) as VectorResult[]

  return fallback.map((r) => ({ ...r, score: 0.01 }))
}
