import type { VectorResult } from "./vector"

const RRF_K = 60

export interface RRFResult extends VectorResult {
  rrf_score:  number
  vec_rank:   number | null
  kw_rank:    number | null
}

export function rrfFusion(
  vectorResults:  VectorResult[],
  keywordResults: VectorResult[],
): RRFResult[] {
  const scores = new Map<string, { rrf: number; vec: number | null; kw: number | null; page: VectorResult }>()

  for (let i = 0; i < vectorResults.length; i++) {
    const r = vectorResults[i]
    const existing = scores.get(r.slug)
    const contribution = 1 / (RRF_K + i + 1)
    if (existing) {
      existing.rrf += contribution
      existing.vec  = i
    } else {
      scores.set(r.slug, { rrf: contribution, vec: i, kw: null, page: r })
    }
  }

  for (let i = 0; i < keywordResults.length; i++) {
    const r = keywordResults[i]
    const existing = scores.get(r.slug)
    const contribution = 1 / (RRF_K + i + 1)
    if (existing) {
      existing.rrf += contribution
      existing.kw   = i
    } else {
      scores.set(r.slug, { rrf: contribution, vec: null, kw: i, page: r })
    }
  }

  return [...scores.values()]
    .map(({ rrf, vec, kw, page }) => ({
      ...page,
      rrf_score: rrf,
      vec_rank:  vec,
      kw_rank:   kw,
      // Use RRF as primary score
      score:     rrf,
    }))
    .sort((a, b) => b.rrf_score - a.rrf_score)
}
