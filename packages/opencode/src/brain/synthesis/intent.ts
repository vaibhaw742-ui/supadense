const L2_PATTERNS = [
  /\bpattern[s]?\b/i,
  /\bmodel[s]?\b/i,
  /\bframework[s]?\b/i,
  /\bacross\s+all\b/i,
  /\bin\s+general\b/i,
  /\bcommon\s+theme[s]?\b/i,
  /\btrend[s]?\b/i,
  /\beverything\s+I\s+know\b/i,
  /\bhigh.level\b/i,
  /\bbig\s+picture\b/i,
  /\boverall\s+picture\b/i,
]

const SYNTHESIS_PATTERNS = [
  /\bextract\b/i,
  /\bsummariz[e|ing]\b/i,
  /\bcreate\s+a?\s*(note|summary|insight|synthesis)\b/i,
  /\bsave\s+(this|as)\b/i,
  /\bmake\s+a?\s*(note|summary)\b/i,
  /\bnote\s+(down|this)\b/i,
  /\bi\s+want\s+to\s+know\s+about\s+.+\s+from\b/i,
  /\bgenerate\s+a?\s*(report|summary|analysis)\b/i,
  /\bwrite\s+a?\s*(summary|note|report)\b/i,
  /\bsynthesize\b/i,
]

const DELETE_EDGE_PATTERNS = [
  /\b(delete|remove|erase|drop)\b.{0,60}\b(edge|link|relation|relationship|connection)\b/i,
  /\bremove\s+the\s+\w+\s+(between|from|to)\b/i,
  /\bunlink\b/i,
  /\bdisconnect\b/i,
  /(?:→|->)/,   // arrow notation always means an edge
]

const DELETE_NODE_PATTERNS = [
  /\b(delete|remove|erase|drop)\b.{0,40}\b(node|page|entry|note)\b/i,
  /\b(delete|remove)\s+([\w\s\-]+)/i,
]

export interface DeleteIntent {
  kind:       "node" | "edge" | null
  subject:    string
  link_type?: string
}

export function detectSynthesisIntent(query: string): boolean {
  return SYNTHESIS_PATTERNS.some((p) => p.test(query))
}

export function detectTargetLayer(query: string): 1 | 2 {
  return L2_PATTERNS.some((p) => p.test(query)) ? 2 : 1
}

export function detectDeleteIntent(query: string): DeleteIntent {
  if (DELETE_EDGE_PATTERNS.some((p) => p.test(query))) {
    const betweenMatch = query.match(
      /(?:the\s+)?(\w+)\s+(?:relationship|relation|edge|link|connection)?\s*between\s+([\w\s\-]+?)\s+and\s+([\w\s\-]+)/i,
    )
    if (betweenMatch) {
      const safeTypes = new Set(["founded","works_at","invested_in","attended","advises","mentions","synthesized_from"])
      const lt = betweenMatch[1].toLowerCase()
      return {
        kind:      "edge",
        subject:   `${betweenMatch[2].trim()} → ${betweenMatch[3].trim()}`,
        link_type: safeTypes.has(lt) ? lt : undefined,
      }
    }
    const arrowMatch = query.match(/([\w\s]+?)\s*(?:→|->)\s*([\w\s]+)/i)
    if (arrowMatch) return { kind: "edge", subject: `${arrowMatch[1].trim()} → ${arrowMatch[2].trim()}` }
    const plainBetween = query.match(/between\s+([\w\s\-]+?)\s+and\s+([\w\s\-]+)/i)
    if (plainBetween) return { kind: "edge", subject: `${plainBetween[1].trim()} → ${plainBetween[2].trim()}` }
  }

  if (DELETE_NODE_PATTERNS.some((p) => p.test(query))) {
    const subject = query
      .replace(/\b(delete|remove|erase|drop|node|page|entry|note|the)\b/gi, "")
      .replace(/\s+/g, " ").trim()
    return { kind: "node", subject }
  }

  return { kind: null, subject: "" }
}
