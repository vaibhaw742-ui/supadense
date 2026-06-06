const MAX_WORDS = 300
const HEADER_RE = /^#{1,5}\s/m

/**
 * Split text into ~300-word chunks at markdown header boundaries.
 * Falls back to word-boundary splitting when no headers present.
 */
export function chunkText(text: string): string[] {
  if (!text?.trim()) return []

  const sections = splitAtHeaders(text)
  const chunks: string[] = []

  for (const section of sections) {
    const words = section.trim().split(/\s+/)
    if (words.length <= MAX_WORDS) {
      if (section.trim()) chunks.push(section.trim())
    } else {
      // Split large sections into MAX_WORDS pieces
      for (let i = 0; i < words.length; i += MAX_WORDS) {
        chunks.push(words.slice(i, i + MAX_WORDS).join(" "))
      }
    }
  }

  return chunks.filter(Boolean)
}

function splitAtHeaders(text: string): string[] {
  const lines = text.split("\n")
  const sections: string[] = []
  let current: string[] = []

  for (const line of lines) {
    if (HEADER_RE.test(line) && current.length > 0) {
      sections.push(current.join("\n"))
      current = [line]
    } else {
      current.push(line)
    }
  }
  if (current.length > 0) sections.push(current.join("\n"))
  return sections
}
