import { describe, test, expect, beforeEach } from "bun:test"

// Must set env before imports
process.env.BRAIN_DATABASE_URL =
  process.env.BRAIN_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5433/supadense_brain"

import { captureToBrain, deleteNode, deleteEdge } from "../../src/brain/capture"
import { brainDb } from "../../src/brain/db"
import { runBrainMigrations } from "../../src/brain/migrate"

const db = brainDb()

async function reset() {
  await db`TRUNCATE brain_pages CASCADE`
  await db`UPDATE brain_gen_clock SET value = 0`
  // Ensure default source exists
  await db`INSERT INTO brain_sources (id, name) VALUES ('default', 'Default') ON CONFLICT DO NOTHING`
}

beforeEach(reset)

// Run migrations once
await runBrainMigrations()

// ── Capture tests ─────────────────────────────────────────────────────────

describe("captureToBrain", () => {
  test("creates a page with correct slug and layer", async () => {
    const result = await captureToBrain({
      content:  "# Alice Chen\nAlice is a founder.",
      slug:     "L0/people/alice-chen",
      type:     "person",
      layer:    0,
      source_id: "default",
    })

    expect(result.created).toBe(true)
    expect(result.slug).toBe("L0/people/alice-chen")
    expect(result.page_id).toBeGreaterThan(0)

    const rows = await db`SELECT slug, layer, type FROM brain_pages WHERE id = ${result.page_id}`
    expect(rows[0]).toMatchObject({ slug: "L0/people/alice-chen", layer: 0, type: "person" })
  })

  test("deduplicates on content_hash", async () => {
    const content = "Same content here"
    const r1 = await captureToBrain({ content, slug: "inbox/test-1", source_id: "default" })
    const r2 = await captureToBrain({ content, slug: "inbox/test-2", source_id: "default" })

    expect(r1.created).toBe(true)
    expect(r2.created).toBe(false)   // deduped — same content_hash
    expect(r2.page_id).toBe(r1.page_id)
  })

  test("creates chunks in brain_chunks", async () => {
    const result = await captureToBrain({
      content:   "First chunk content.\n\n## Section\nSecond chunk content here.",
      slug:      "L0/test/chunked",
      source_id: "default",
    })

    const chunks = await db`SELECT chunk_index, chunk_text FROM brain_chunks WHERE page_id = ${result.page_id} ORDER BY chunk_index`
    expect((chunks as unknown[]).length).toBeGreaterThan(0)
  })

  test("creates synthesized_from edges for synthesis nodes", async () => {
    // Create source pages first
    const s1 = await captureToBrain({ content: "Source 1", slug: "L0/src/one", source_id: "default" })
    const s2 = await captureToBrain({ content: "Source 2", slug: "L0/src/two", source_id: "default" })

    const synth = await captureToBrain({
      content:   "Synthesis content",
      slug:      "L1/summaries/test-synth",
      type:      "synthesis",
      layer:     1,
      sources:   ["L0/src/one", "L0/src/two"],
      source_id: "default",
    })

    const edges = await db`
      SELECT l.link_type, tp.slug AS to_slug
      FROM brain_links l
      JOIN brain_pages tp ON tp.id = l.to_page_id
      WHERE l.from_page_id = ${synth.page_id}
    `
    expect((edges as unknown[]).length).toBe(2)
    expect((edges as unknown as { link_type: string }[])[0].link_type).toBe("synthesized_from")
  })

  test("bumps generation clock on capture", async () => {
    const before = await db`SELECT value FROM brain_gen_clock WHERE id = 1`
    await captureToBrain({ content: "Clock test", slug: "L0/test/clock", source_id: "default" })
    const after = await db`SELECT value FROM brain_gen_clock WHERE id = 1`
    expect(Number((after[0] as { value: number }).value)).toBeGreaterThan(Number((before[0] as { value: number }).value))
  })
})

// ── Delete tests ──────────────────────────────────────────────────────────

describe("deleteNode", () => {
  test("deletes page and cascades edges", async () => {
    const p1 = await captureToBrain({ content: "Page 1", slug: "L0/del/p1", source_id: "default" })
    const p2 = await captureToBrain({ content: "Page 2", slug: "L0/del/p2", sources: ["L0/del/p1"], source_id: "default" })

    const result = await deleteNode("L0/del/p1", "default")
    expect(result.deleted).toBe(true)

    const rows = await db`SELECT id FROM brain_pages WHERE slug = 'L0/del/p1'`
    expect((rows as unknown[]).length).toBe(0)

    // Edges should also be gone (CASCADE)
    const edges = await db`SELECT id FROM brain_links WHERE from_page_id = ${p2.page_id}`
    expect((edges as unknown[]).length).toBe(0)
  })

  test("returns error for non-existent page", async () => {
    const result = await deleteNode("L0/nonexistent/page", "default")
    expect(result.deleted).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

describe("deleteEdge", () => {
  test("deletes specific edge between two pages", async () => {
    await captureToBrain({ content: "Person A", slug: "L0/people/person-a", source_id: "default" })
    await captureToBrain({
      content:   "Company B",
      slug:      "L0/companies/company-b",
      source_id: "default",
    })

    // Manually insert an edge
    await db`
      INSERT INTO brain_links (from_page_id, to_page_id, link_type, link_source)
      SELECT a.id, b.id, 'works_at', 'manual'
      FROM brain_pages a, brain_pages b
      WHERE a.slug = 'L0/people/person-a' AND b.slug = 'L0/companies/company-b'
    `

    const result = await deleteEdge("L0/people/person-a", "L0/companies/company-b", "works_at")
    expect(result.deleted).toBe(true)

    const edges = await db`
      SELECT l.id FROM brain_links l
      JOIN brain_pages fp ON fp.id = l.from_page_id
      JOIN brain_pages tp ON tp.id = l.to_page_id
      WHERE fp.slug = 'L0/people/person-a' AND tp.slug = 'L0/companies/company-b'
    `
    expect((edges as unknown[]).length).toBe(0)
  })
})
