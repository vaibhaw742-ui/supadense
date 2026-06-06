import { embed } from "ai"
import { brainDb } from "./db"

let embeddingModel: Parameters<typeof embed>[0]["model"] | null = null

export function setEmbeddingModel(model: Parameters<typeof embed>[0]["model"]) {
  embeddingModel = model
}

export async function embedChunks(sourceId?: string): Promise<{ embedded: number }> {
  if (!embeddingModel) return { embedded: 0 }
  const db = brainDb()

  const stale = await db`
    SELECT c.id, c.chunk_text
    FROM brain_chunks c
    JOIN brain_pages p ON p.id = c.page_id
    WHERE c.embedding IS NULL
      ${sourceId ? db`AND p.source_id = ${sourceId}` : db``}
    ORDER BY c.id
    LIMIT 50
  ` as { id: number; chunk_text: string }[]

  if (!stale.length) return { embedded: 0 }

  let embedded = 0
  // Embed in batches of 20
  const BATCH = 20
  for (let i = 0; i < stale.length; i += BATCH) {
    const batch = stale.slice(i, i + BATCH)
    try {
      const results = await Promise.all(
        batch.map((c) => embed({ model: embeddingModel!, value: c.chunk_text })),
      )
      for (let j = 0; j < batch.length; j++) {
        const vec = JSON.stringify(results[j].embedding)
        await db`
          UPDATE brain_chunks
          SET embedding   = ${vec}::vector,
              embedded_at = now()
          WHERE id = ${batch[j].id}
        `
        embedded++
      }
    } catch (err) {
      console.error("[brain/embed] batch error:", err instanceof Error ? err.message : err)
    }
  }

  return { embedded }
}

let _timer: ReturnType<typeof setInterval> | null = null

export function startEmbedWorker(intervalMs = 30_000) {
  if (_timer) return
  _timer = setInterval(async () => {
    try { await embedChunks() } catch {}
  }, intervalMs)
  // Run once immediately
  setTimeout(async () => { try { await embedChunks() } catch {} }, 2000)
}

export function stopEmbedWorker() {
  if (_timer) { clearInterval(_timer); _timer = null }
}
