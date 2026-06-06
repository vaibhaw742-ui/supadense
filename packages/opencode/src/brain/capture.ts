import { brainDb } from "./db"
import { chunkText } from "./chunk"
import { inboxSlug, extractTitle, contentHash } from "./slugify"
import { extractAndSaveLinks } from "./extract"

export interface CaptureInput {
  content:              string
  slug?:                string
  type?:                string
  layer?:               0 | 1 | 2
  source_id?:           string
  sources?:             string[]   // creates synthesized_from edges
  query?:               string
  session_id?:          string     // SQLite session that triggered this capture
  contribution_type?:   "capture" | "synthesis" | "git_event" | "analyze"
}

export interface CaptureResult {
  slug:    string
  page_id: number
  created: boolean
}

export async function captureToBrain(input: CaptureInput): Promise<CaptureResult> {
  const db        = brainDb()
  const sourceId  = input.source_id ?? "default"

  // Auto-create source if it doesn't exist
  await db`
    INSERT INTO brain_sources (id, name) VALUES (${sourceId}, ${sourceId})
    ON CONFLICT (id) DO NOTHING
  `.catch(() => null)
  const layer     = input.layer ?? 0
  const type      = input.type ?? "note"

  // 1. Normalise + hash
  const normalised = input.content
    .replace(/^﻿/, "")          // strip BOM
    .replace(/\r\n/g, "\n")          // CRLF → LF
    .trim()
  const hash = contentHash(normalised)

  // 2. Dedup check
  const existing = await db`
    SELECT id, slug FROM brain_pages
    WHERE content_hash = ${hash} AND source_id = ${sourceId} AND deleted_at IS NULL
    LIMIT 1
  `
  if ((existing as unknown[]).length > 0) {
    const row = existing[0] as { id: number; slug: string }
    return { slug: row.slug, page_id: row.id, created: false }
  }

  // 3. Slug
  const slug = input.slug ?? inboxSlug(hash)

  // 4. Parse frontmatter for title + layer override
  let fm: Record<string, unknown> = {}
  let title = extractTitle(normalised)
  if (normalised.startsWith("---")) {
    const end = normalised.indexOf("---", 3)
    if (end > 3) {
      const fmText = normalised.slice(3, end)
      for (const line of fmText.split("\n")) {
        const colon = line.indexOf(":")
        if (colon < 0) continue
        const k = line.slice(0, colon).trim()
        const v = line.slice(colon + 1).trim().replace(/^["']|["']$/g, "")
        fm[k] = v
      }
      if (fm.title) title = String(fm.title)
      if (fm.layer !== undefined) {
        const parsed = parseInt(String(fm.layer), 10)
        if ([0, 1, 2].includes(parsed)) (input as CaptureInput & { layer: 0|1|2 }).layer = parsed as 0|1|2
      }
    }
  }

  // Merge frontmatter with synthesis metadata
  const storedFm = {
    ...fm,
    type,
    layer: input.layer ?? layer,
    ...(input.query   ? { query: input.query }   : {}),
    ...(input.sources ? { sources: input.sources } : {}),
  }

  // 5. Insert page
  const pageRows = await db`
    INSERT INTO brain_pages
      (source_id, slug, layer, type, title, compiled_truth, frontmatter, content_hash, updated_at)
    VALUES
      (${sourceId}, ${slug}, ${input.layer ?? layer}, ${type}, ${title},
       ${normalised}, ${db.json(storedFm)}, ${hash}, now())
    ON CONFLICT (source_id, slug) DO UPDATE SET
      compiled_truth = EXCLUDED.compiled_truth,
      frontmatter    = EXCLUDED.frontmatter,
      content_hash   = EXCLUDED.content_hash,
      layer          = EXCLUDED.layer,
      title          = EXCLUDED.title,
      updated_at     = now()
    RETURNING id
  `
  const pageId = (pageRows[0] as { id: number }).id

  // 6. Chunks → insert with search_vec (trigger builds it)
  await db`DELETE FROM brain_chunks WHERE page_id = ${pageId}`
  const chunks = chunkText(normalised)
  for (let i = 0; i < chunks.length; i++) {
    await db`
      INSERT INTO brain_chunks (page_id, chunk_index, chunk_text)
      VALUES (${pageId}, ${i}, ${chunks[i]})
      ON CONFLICT (page_id, chunk_index) DO UPDATE
      SET chunk_text = EXCLUDED.chunk_text, embedding = NULL, embedded_at = NULL
    `
  }

  // 7. Extract wikilinks + frontmatter links → brain_links
  await extractAndSaveLinks(pageId, normalised, slug, sourceId)

  // 8. Explicit synthesized_from edges (for synthesis nodes)
  if (input.sources?.length) {
    for (const srcSlug of input.sources) {
      const target = await db`
        SELECT id FROM brain_pages
        WHERE slug = ${srcSlug} AND source_id = ${sourceId} AND deleted_at IS NULL
        LIMIT 1
      `
      if (!(target as unknown[]).length) continue
      await db`
        INSERT INTO brain_links (from_page_id, to_page_id, link_type, link_source)
        VALUES (${pageId}, ${(target[0] as { id: number }).id}, 'synthesized_from', 'synthesis')
        ON CONFLICT DO NOTHING
      `
    }
  }

  // gen_clock bumped automatically by trigger

  // Write session→brain contribution if session_id provided
  if (input.session_id) {
    await db`
      INSERT INTO session_brain_contributions
        (session_id, brain_page_id, contribution_type)
      VALUES
        (${input.session_id}, ${pageId}, ${input.contribution_type ?? "capture"})
      ON CONFLICT (session_id, brain_page_id) DO NOTHING
    `.catch(() => null)
  }

  return { slug, page_id: pageId, created: true }
}

export async function deleteNode(slug: string, sourceId = "default"): Promise<{
  deleted: boolean
  slug: string
  edges_deleted: number
  error?: string
}> {
  const db = brainDb()

  const edgeCount = await db`
    SELECT COUNT(*)::int AS n FROM brain_links l
    JOIN brain_pages p ON p.id = l.from_page_id OR p.id = l.to_page_id
    WHERE p.slug = ${slug} AND p.source_id = ${sourceId}
  `

  const deleted = await db`
    DELETE FROM brain_pages WHERE slug = ${slug} AND source_id = ${sourceId} RETURNING id
  `

  if (!(deleted as unknown[]).length) {
    return { deleted: false, slug, edges_deleted: 0, error: "Page not found" }
  }

  return {
    deleted: true,
    slug,
    edges_deleted: (edgeCount[0] as { n: number }).n ?? 0,
  }
}

export async function deleteEdge(
  fromSlug: string,
  toSlug:   string,
  linkType?: string,
  sourceId = "default",
): Promise<{ deleted: boolean; from_slug: string; to_slug: string; link_type: string; error?: string }> {
  const db = brainDb()

  const fromRows = await db`SELECT id FROM brain_pages WHERE slug = ${fromSlug} AND source_id = ${sourceId} LIMIT 1`
  const toRows   = await db`SELECT id FROM brain_pages WHERE slug = ${toSlug}   AND source_id = ${sourceId} LIMIT 1`

  if (!(fromRows as unknown[]).length || !(toRows as unknown[]).length) {
    return { deleted: false, from_slug: fromSlug, to_slug: toSlug, link_type: linkType ?? "any", error: "Page not found" }
  }

  const fromId = (fromRows[0] as { id: number }).id
  const toId   = (toRows[0] as { id: number }).id

  const deleted = linkType
    ? await db`DELETE FROM brain_links WHERE from_page_id = ${fromId} AND to_page_id = ${toId} AND link_type = ${linkType} RETURNING id`
    : await db`DELETE FROM brain_links WHERE from_page_id = ${fromId} AND to_page_id = ${toId} RETURNING id`

  if (!(deleted as unknown[]).length) {
    return { deleted: false, from_slug: fromSlug, to_slug: toSlug, link_type: linkType ?? "any", error: "Edge not found" }
  }

  return { deleted: true, from_slug: fromSlug, to_slug: toSlug, link_type: linkType ?? "any" }
}
