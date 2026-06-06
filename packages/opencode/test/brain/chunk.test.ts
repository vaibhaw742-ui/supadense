import { describe, test, expect } from "bun:test"
import { chunkText } from "../../src/brain/chunk"

describe("chunkText", () => {
  test("returns empty for empty input", () => {
    expect(chunkText("")).toEqual([])
    expect(chunkText("   ")).toEqual([])
  })

  test("returns single chunk for short text", () => {
    const text = "Short text under 300 words."
    const chunks = chunkText(text)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toBe(text)
  })

  test("splits at markdown headers", () => {
    const text = `# Section 1
Content for section one.

## Section 2
Content for section two.`
    const chunks = chunkText(text)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.some((c) => c.includes("Section 1"))).toBe(true)
    expect(chunks.some((c) => c.includes("Section 2"))).toBe(true)
  })

  test("splits long section by word count", () => {
    const longText = Array(400).fill("word").join(" ")
    const chunks = chunkText(longText)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.split(" ").length).toBeLessThanOrEqual(301)
    }
  })
})
