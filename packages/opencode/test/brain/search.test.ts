import { describe, test, expect, beforeEach } from "bun:test"

process.env.BRAIN_DATABASE_URL =
  process.env.BRAIN_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5433/supadense_brain"

import { captureToBrain } from "../../src/brain/capture"
import { keywordSearch }  from "../../src/brain/search/keyword"
import { rrfFusion }      from "../../src/brain/search/rrf"
import { stampEvidence }  from "../../src/brain/search/evidence"
import { brainDb }        from "../../src/brain/db"
import { runBrainMigrations } from "../../src/brain/migrate"

await runBrainMigrations()
const db = brainDb()

async function reset() {
  await db`TRUNCATE brain_pages CASCADE`
  await db`UPDATE brain_gen_clock SET value = 0`
  await db`INSERT INTO brain_sources (id, name) VALUES ('default', 'Default') ON CONFLICT DO NOTHING`
}

beforeEach(reset)

async function seed() {
  await captureToBrain({ content: "# Alice Chen\nAlice is the CEO of Acme Corp. She co-founded it in 2019.", slug: "L0/people/alice-chen", type: "person", layer: 0, source_id: "default" })
  await captureToBrain({ content: "# Acme Corp\nAcme Corp is an AI startup founded by Alice Chen.", slug: "L0/companies/acme-corp", type: "company", layer: 0, source_id: "default" })
  await captureToBrain({ content: "# Auth Architecture\nWe use JWT tokens stored in Postgres.", slug: "L1/tech/auth-arch", type: "synthesis", layer: 1, source_id: "default" })
}

describe("keywordSearch", () => {
  test("finds pages by title keyword", async () => {
    await seed()
    const results = await keywordSearch("alice", 0, "default", 5)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].slug).toBe("L0/people/alice-chen")
  })

  test("respects layer filter", async () => {
    await seed()
    const l0 = await keywordSearch("acme", 0, "default", 5)
    const l1 = await keywordSearch("auth", 1, "default", 5)

    expect(l0.every((r) => r.layer === 0)).toBe(true)
    expect(l1.every((r) => r.layer === 1)).toBe(true)
  })

  test("returns empty for no match", async () => {
    await seed()
    const results = await keywordSearch("xyznonexistent123", 0, "default", 5)
    expect(results.length).toBe(0)
  })
})

describe("rrfFusion", () => {
  test("combines vector and keyword results", () => {
    const vec = [
      { id: 1, slug: "a", title: "A", layer: 0, type: "note", compiled_truth: "", score: 0.9 },
      { id: 2, slug: "b", title: "B", layer: 0, type: "note", compiled_truth: "", score: 0.7 },
    ]
    const kw = [
      { id: 2, slug: "b", title: "B", layer: 0, type: "note", compiled_truth: "", score: 0.8 },
      { id: 3, slug: "c", title: "C", layer: 0, type: "note", compiled_truth: "", score: 0.5 },
    ]

    const fused = rrfFusion(vec, kw)
    // "b" appears in both → higher fused score
    const bResult = fused.find((r) => r.slug === "b")
    const aResult = fused.find((r) => r.slug === "a")
    expect(bResult).toBeDefined()
    expect(bResult!.rrf_score).toBeGreaterThan(aResult!.rrf_score)
  })

  test("handles empty inputs", () => {
    expect(rrfFusion([], [])).toEqual([])
    expect(rrfFusion([{ id: 1, slug: "x", title: "X", layer: 0, type: "note", compiled_truth: "", score: 0.5 }], [])).toHaveLength(1)
  })
})

describe("stampEvidence", () => {
  test("stamps exact_title for title match", () => {
    const result = { id: 1, slug: "test", title: "Alice Chen", layer: 0, type: "person", compiled_truth: "", score: 0.5, rrf_score: 0.5, vec_rank: 0, kw_rank: null }
    const stamped = stampEvidence([result], "alice chen")
    expect(stamped[0].evidence).toBe("exact_title")
    expect(stamped[0].create_safety).toBe("exists")
  })

  test("stamps high_vector for high score", () => {
    const result = { id: 1, slug: "test", title: "Something Else", layer: 0, type: "note", compiled_truth: "", score: 0.85, rrf_score: 0.85, vec_rank: 0, kw_rank: null }
    const stamped = stampEvidence([result], "unrelated query")
    expect(stamped[0].evidence).toBe("high_vector")
  })

  test("stamps weak_semantic for low score", () => {
    const result = { id: 1, slug: "test", title: "Something", layer: 0, type: "note", compiled_truth: "", score: 0.05, rrf_score: 0.05, vec_rank: null, kw_rank: 5 }
    const stamped = stampEvidence([result], "query")
    expect(stamped[0].evidence).toBe("weak_semantic")
    expect(stamped[0].create_safety).toBe("unknown")
  })
})
