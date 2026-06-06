import { brainDb } from "../db"
import type { RRFResult } from "./rrf"

const ADJACENCY_BOOST    = 1.05
const CROSS_LAYER_BOOST  = 1.10
const SESSION_DEMOTE     = 0.95

export async function applyGraphSignals(results: RRFResult[]): Promise<RRFResult[]> {
  if (results.length < 2) return results
  const db      = brainDb()
  const pageIds = results.map((r) => r.id)

  // Load inbound links among top-K set
  const links = await db`
    SELECT l.from_page_id, l.to_page_id,
      CASE WHEN fp.layer != tp.layer THEN 1 ELSE 0 END AS cross_layer
    FROM brain_links l
    JOIN brain_pages fp ON fp.id = l.from_page_id
    JOIN brain_pages tp ON tp.id = l.to_page_id
    WHERE l.from_page_id = ANY(${pageIds})
      AND l.to_page_id   = ANY(${pageIds})
  `.catch(() => []) as { from_page_id: number; to_page_id: number; cross_layer: number }[]

  // Count inbound hits per page within the top-K set
  const inboundCount    = new Map<number, number>()
  const crossLayerCount = new Map<number, number>()

  for (const link of links) {
    inboundCount.set(link.to_page_id, (inboundCount.get(link.to_page_id) ?? 0) + 1)
    if (link.cross_layer) {
      crossLayerCount.set(link.to_page_id, (crossLayerCount.get(link.to_page_id) ?? 0) + 1)
    }
  }

  // Session demote: detect session-shaped slugs (chat/ or date segments)
  const SESSION_RE = /\b(chat|session|sessions)\b|\/\d{4}-\d{2}-\d{2}/
  const sessionGroups = new Map<string, number[]>()
  for (const r of results) {
    const m = SESSION_RE.exec(r.slug)
    if (m) {
      const prefix = r.slug.slice(0, m.index + m[0].length)
      const group  = sessionGroups.get(prefix) ?? []
      group.push(r.id)
      sessionGroups.set(prefix, group)
    }
  }

  // Score of the highest member in each session group (kept at full score)
  const sessionKeepIds = new Set<number>()
  for (const ids of sessionGroups.values()) {
    if (ids.length >= 2) {
      const best = ids.reduce((a, b) => {
        const sa = results.find((r) => r.id === a)?.score ?? 0
        const sb = results.find((r) => r.id === b)?.score ?? 0
        return sa >= sb ? a : b
      })
      sessionKeepIds.add(best)
    }
  }

  const boosted = results.map((r) => {
    let score = r.score

    // Adjacency boost
    if ((inboundCount.get(r.id) ?? 0) >= 2) score *= ADJACENCY_BOOST

    // Cross-layer boost
    if ((crossLayerCount.get(r.id) ?? 0) >= 2) score *= CROSS_LAYER_BOOST

    // Session demote (keep highest, demote rest)
    const m = SESSION_RE.exec(r.slug)
    if (m) {
      const prefix = r.slug.slice(0, m.index + m[0].length)
      const group  = sessionGroups.get(prefix) ?? []
      if (group.length >= 2 && !sessionKeepIds.has(r.id)) {
        score *= SESSION_DEMOTE
      }
    }

    return { ...r, score }
  })

  return boosted.sort((a, b) => b.score - a.score)
}
