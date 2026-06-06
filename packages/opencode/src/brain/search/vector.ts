import { brainDb } from "../db"

export interface VectorResult {
  id:             number
  slug:           string
  title:          string
  layer:          number
  type:           string
  compiled_truth: string
  score:          number
}

export async function vectorSearch(
  queryEmbedding: number[],
  layer: number,
  sourceId: string,
  limit = 10,
): Promise<VectorResult[]> {
  const db = brainDb()
  const vec = JSON.stringify(queryEmbedding)

  // Per-page max-pool: DISTINCT ON picks best chunk per page
  const rows = await db.unsafe(`
    WITH best_per_page AS (
      SELECT DISTINCT ON (p.id)
        p.id,
        p.slug,
        p.title,
        p.layer,
        p.type,
        p.compiled_truth,
        1 - (c.embedding <=> $1::vector) AS score
      FROM brain_chunks c
      JOIN brain_pages p ON p.id = c.page_id
      WHERE p.deleted_at IS NULL
        AND p.source_id = $2
        AND p.layer = $3
        AND c.embedding IS NOT NULL
      ORDER BY p.id, c.embedding <=> $1::vector
    )
    SELECT * FROM best_per_page
    ORDER BY score DESC
    LIMIT $4
  `, [vec, sourceId, layer, limit]) as VectorResult[]

  return rows.map((r) => ({ ...r, score: Number(r.score) }))
}
