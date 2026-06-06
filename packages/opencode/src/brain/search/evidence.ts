import type { RRFResult } from "./rrf"

const HIGH_VEC_FLOOR  = 0.70
const SOLID_KW_FLOOR  = 0.30

export type EvidenceKind =
  | "alias_hit"
  | "exact_title"
  | "high_vector"
  | "keyword_exact"
  | "weak_semantic"

export type CreateSafety = "exists" | "probable" | "unknown"

export interface StampedResult extends RRFResult {
  evidence:      EvidenceKind
  create_safety: CreateSafety
  alias_hit?:    boolean
}

function classifyEvidence(r: RRFResult, query: string): EvidenceKind {
  if ((r as StampedResult).alias_hit) return "alias_hit"
  const titleLower = (r.title ?? "").toLowerCase()
  const queryLower = query.toLowerCase()
  if (titleLower === queryLower || titleLower.includes(queryLower)) return "exact_title"
  if (r.score >= HIGH_VEC_FLOOR)  return "high_vector"
  if (r.score >= SOLID_KW_FLOOR)  return "keyword_exact"
  return "weak_semantic"
}

function createSafety(evidence: EvidenceKind): CreateSafety {
  if (evidence === "alias_hit" || evidence === "exact_title" || evidence === "high_vector") return "exists"
  if (evidence === "keyword_exact") return "probable"
  return "unknown"
}

export function stampEvidence(results: RRFResult[], query: string): StampedResult[] {
  return results.map((r) => {
    const evidence = classifyEvidence(r, query)
    return {
      ...r,
      evidence,
      create_safety: createSafety(evidence),
    }
  })
}
