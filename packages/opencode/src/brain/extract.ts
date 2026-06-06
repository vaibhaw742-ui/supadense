import { brainDb } from "./db"

// Regexes for link type inference (port from gbrain)
const FOUNDED_RE   = /\b(co-founded?|founded?|founder of|co-founder)\b/i
const INVESTED_RE  = /\b(backed by|led the (seed|series)|invested in|portfolio company|investor)\b/i
const ADVISES_RE   = /\b(advis(or|es|ory)|advisory board)\b/i
const WORKS_AT_RE  = /\b(CEO of|CTO of|engineer at|works? at|tenure as|joined)\b/i
const ATTENDED_RE  = /\b(attended|attendee|present at|in the meeting)\b/i

// Frontmatter fields → link types
const FRONTMATTER_LINK_MAP: Record<string, { type: string; direction: "out" | "in" }> = {
  company:    { type: "works_at",    direction: "out" },
  companies:  { type: "works_at",    direction: "out" },
  founded:    { type: "founded",     direction: "out" },
  investors:  { type: "invested_in", direction: "in"  },
  investor:   { type: "invested_in", direction: "in"  },
  attendees:  { type: "attended",    direction: "out" },
  sources:    { type: "synthesized_from", direction: "out" },
}

function inferLinkType(context: string): string {
  if (FOUNDED_RE.test(context))  return "founded"
  if (INVESTED_RE.test(context)) return "invested_in"
  if (ADVISES_RE.test(context))  return "advises"
  if (WORKS_AT_RE.test(context)) return "works_at"
  if (ATTENDED_RE.test(context)) return "attended"
  return "mentions"
}

function extractWikilinks(text: string): Array<{ slug: string; context: string }> {
  const results: Array<{ slug: string; context: string }> = []
  // Match [[slug]], [[slug|label]], strip code blocks first
  const cleaned = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`]+`/g, "")
  const re = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(cleaned)) !== null) {
    const slug = m[1].trim()
    const start = Math.max(0, m.index - 120)
    const end   = Math.min(cleaned.length, m.index + m[0].length + 120)
    results.push({ slug, context: cleaned.slice(start, end) })
  }
  return results
}

function parseFrontmatter(text: string): Record<string, unknown> {
  if (!text.startsWith("---")) return {}
  const end = text.indexOf("---", 3)
  if (end < 3) return {}
  const fm = text.slice(3, end)
  const result: Record<string, unknown> = {}
  for (const line of fm.split("\n")) {
    const colon = line.indexOf(":")
    if (colon < 0) continue
    const key = line.slice(0, colon).trim()
    const val = line.slice(colon + 1).trim()
    if (val) result[key] = val.replace(/^["']|["']$/g, "")
  }
  return result
}

function parseFrontmatterList(text: string, field: string): string[] {
  if (!text.startsWith("---")) return []
  const end = text.indexOf("---", 3)
  if (end < 3) return []
  const fm = text.slice(3, end)
  const re = new RegExp(`^${field}:\\s*$`, "m")
  const m = re.exec(fm)
  if (!m) return []
  const after = fm.slice(m.index + m[0].length)
  const items: string[] = []
  for (const line of after.split("\n")) {
    if (line.startsWith("  - ")) {
      items.push(line.slice(4).trim())
    } else if (line.match(/^\S/) && !line.startsWith("  ")) {
      break
    }
  }
  return items
}

export async function extractAndSaveLinks(
  pageId: number,
  content: string,
  fromSlug: string,
  sourceId: string,
): Promise<number> {
  const db = brainDb()
  let created = 0

  // 1. Wikilinks from body
  const wikilinks = extractWikilinks(content)
  for (const { slug, context } of wikilinks) {
    const target = await db`
      SELECT id FROM brain_pages
      WHERE (slug = ${slug} OR slug LIKE ${'%/' + slug})
        AND source_id = ${sourceId}
        AND deleted_at IS NULL
      LIMIT 1
    `
    if (!target.length) continue
    const linkType = inferLinkType(context)
    await db`
      INSERT INTO brain_links (from_page_id, to_page_id, link_type, link_source)
      VALUES (${pageId}, ${(target[0] as { id: number }).id}, ${linkType}, 'markdown')
      ON CONFLICT DO NOTHING
    `
    created++
  }

  // 2. Frontmatter field links
  const fm = parseFrontmatter(content)
  for (const [field, { type, direction }] of Object.entries(FRONTMATTER_LINK_MAP)) {
    if (field === "sources") continue // handled separately
    const rawVal = fm[field]
    if (!rawVal) continue

    const vals = Array.isArray(rawVal)
      ? rawVal.map(String)
      : String(rawVal).split(",").map((s) => s.trim())

    for (const val of vals) {
      const slugVal = val.toLowerCase().replace(/\s+/g, "-")
      const target = await db`
        SELECT id FROM brain_pages
        WHERE (slug = ${slugVal} OR title ILIKE ${val} OR slug LIKE ${'%/' + slugVal})
          AND source_id = ${sourceId}
          AND deleted_at IS NULL
        LIMIT 1
      `
      if (!target.length) continue
      const targetId = (target[0] as { id: number }).id
      const [fromId, toId] = direction === "out" ? [pageId, targetId] : [targetId, pageId]
      await db`
        INSERT INTO brain_links (from_page_id, to_page_id, link_type, link_source)
        VALUES (${fromId}, ${toId}, ${type}, 'frontmatter')
        ON CONFLICT DO NOTHING
      `
      created++
    }
  }

  // 3. sources: list → synthesized_from edges
  const sources = parseFrontmatterList(content, "sources")
  for (const sourceSlug of sources) {
    const target = await db`
      SELECT id FROM brain_pages
      WHERE slug = ${sourceSlug}
        AND source_id = ${sourceId}
        AND deleted_at IS NULL
      LIMIT 1
    `
    if (!target.length) continue
    await db`
      INSERT INTO brain_links (from_page_id, to_page_id, link_type, link_source)
      VALUES (${pageId}, ${(target[0] as { id: number }).id}, 'synthesized_from', 'frontmatter')
      ON CONFLICT DO NOTHING
    `
    created++
  }

  return created
}
