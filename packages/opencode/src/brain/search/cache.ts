import { brainDb } from "../db"
import { createHash } from "crypto"
import type { StampedResult } from "./evidence"

const TTL_SECONDS = 3600  // 1 hour

export function buildQueryHash(query: string, layer: number | null, sourceId: string): string {
  return createHash("sha256")
    .update(`${query}::${layer}::${sourceId}`)
    .digest("hex")
    .slice(0, 16)
}

async function getClockValue(): Promise<number> {
  const db = brainDb()
  const rows = await db`SELECT value FROM brain_gen_clock WHERE id = 1`.catch(() => []) as { value: number }[]
  return rows[0]?.value ?? 0
}

export async function checkQueryCache(
  query:    string,
  layer:    number | null,
  sourceId: string,
): Promise<StampedResult[] | null> {
  const db        = brainDb()
  const queryHash = buildQueryHash(query, layer, sourceId)
  const clock     = await getClockValue()
  const knobsHash = String(clock)  // cache busted when any page changes

  const rows = await db`
    SELECT results FROM brain_query_cache
    WHERE query_hash = ${queryHash}
      AND source_id  = ${sourceId}
      AND knobs_hash = ${knobsHash}
      AND expires_at > NOW()
    LIMIT 1
  `.catch(() => []) as { results: unknown }[]

  if (!rows.length) return null
  return rows[0].results as StampedResult[]
}

export async function saveToCache(
  query:    string,
  layer:    number | null,
  sourceId: string,
  results:  StampedResult[],
): Promise<void> {
  const db        = brainDb()
  const queryHash = buildQueryHash(query, layer, sourceId)
  const clock     = await getClockValue()
  const knobsHash = String(clock)

  await db`
    INSERT INTO brain_query_cache
      (query_hash, source_id, knobs_hash, layer_mode, results, expires_at)
    VALUES
      (${queryHash}, ${sourceId}, ${knobsHash},
       ${layer !== null ? String(layer) : null},
       ${db.unsafe(`'${JSON.stringify(results).replace(/'/g, "''")}'::jsonb`)},
       NOW() + INTERVAL '${db.unsafe(String(TTL_SECONDS))} seconds')
    ON CONFLICT (query_hash, source_id, knobs_hash)
    DO UPDATE SET results = EXCLUDED.results, expires_at = EXCLUDED.expires_at
  `.catch(() => null)
}
