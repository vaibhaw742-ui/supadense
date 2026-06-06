import { brainDb } from "../db"
import type { RRFResult } from "./rrf"

const PROMOTE_THRESHOLD = 3
const PROMOTE_WINDOW_DAYS = 7

// ── Recency boost ──────────────────────────────────────────────────────────

export async function applyRecencyBoost(results: RRFResult[]): Promise<RRFResult[]> {
  if (!results.length) return results
  const db   = brainDb()
  const slugs = results.map((r) => r.slug)

  const rows = await db`
    SELECT slug,
      COUNT(*) FILTER (WHERE accessed_at > NOW() - INTERVAL '1 day')  AS d1,
      COUNT(*) FILTER (WHERE accessed_at > NOW() - INTERVAL '7 days') AS d7,
      COUNT(*) FILTER (WHERE accessed_at > NOW() - INTERVAL '30 days')AS d30
    FROM brain_access_log
    WHERE slug = ANY(${slugs})
    GROUP BY slug
  `.catch(() => []) as { slug: string; d1: number; d7: number; d30: number }[]

  const boostMap = new Map<string, number>()
  for (const r of rows) {
    let mult = 1.0
    if (r.d1  > 0) mult = Math.max(mult, 1.5)
    if (r.d7  > 2) mult = Math.max(mult, 1.3)
    if (r.d30 > 4) mult = Math.max(mult, 1.1)
    boostMap.set(r.slug, mult)
  }

  return results.map((r) => ({
    ...r,
    score: r.score * (boostMap.get(r.slug) ?? 1.0),
  })).sort((a, b) => b.score - a.score)
}

// ── Title phrase boost ─────────────────────────────────────────────────────

export function applyTitleBoost(results: RRFResult[], query: string): RRFResult[] {
  const queryLower = query.toLowerCase()
  return results
    .map((r) => {
      const titleLower = (r.title ?? "").toLowerCase()
      const boost = titleLower.includes(queryLower) ||
                    queryLower.split(" ").every((w) => titleLower.includes(w))
        ? 1.25
        : 1.0
      return { ...r, score: r.score * boost }
    })
    .sort((a, b) => b.score - a.score)
}

// ── Record access (for future boost) ──────────────────────────────────────

export async function recordAccess(slugs: string[], query: string): Promise<void> {
  if (!slugs.length) return
  const db = brainDb()
  for (const slug of slugs) {
    const layer = slug.toLowerCase().startsWith("l2/") ? 2
                : slug.toLowerCase().startsWith("l1/") ? 1 : 0
    await db`
      INSERT INTO brain_access_log (slug, query, layer)
      VALUES (${slug}, ${query}, ${layer})
    `.catch(() => null)
  }
}

// ── Promote signal ─────────────────────────────────────────────────────────

export interface PromoteCandidate {
  slug:          string
  access_count:  number
  suggest_layer: 1 | 2
}

export async function getPromoteSignals(slugs: string[]): Promise<PromoteCandidate[]> {
  if (!slugs.length) return []
  const db     = brainDb()
  const l0slugs = slugs.filter((s) => !s.toLowerCase().startsWith("l1/") && !s.toLowerCase().startsWith("l2/"))
  if (!l0slugs.length) return []

  const rows = await db`
    SELECT slug, COUNT(*)::int AS access_count
    FROM brain_access_log
    WHERE slug = ANY(${l0slugs})
      AND accessed_at > NOW() - INTERVAL '7 days'
    GROUP BY slug
    HAVING COUNT(*) >= ${PROMOTE_THRESHOLD}
  `.catch(() => []) as { slug: string; access_count: number }[]

  return rows.map((r) => ({ ...r, suggest_layer: 1 as const }))
}
