import { describe, test, expect } from "bun:test"
import { detectSynthesisIntent, detectTargetLayer, detectDeleteIntent } from "../../src/brain/synthesis/intent"

describe("detectSynthesisIntent", () => {
  test("detects extract", ()  => expect(detectSynthesisIntent("extract key points from auth docs")).toBe(true))
  test("detects summarize",() => expect(detectSynthesisIntent("summarize alice's fundraising history")).toBe(true))
  test("detects save",     () => expect(detectSynthesisIntent("save this to brain")).toBe(true))
  test("ignores plain Q",  () => expect(detectSynthesisIntent("who is alice chen?")).toBe(false))
  test("ignores how",      () => expect(detectSynthesisIntent("how does auth work?")).toBe(false))
})

describe("detectTargetLayer", () => {
  test("returns L2 for pattern queries",  () => expect(detectTargetLayer("what patterns do I see?")).toBe(2))
  test("returns L2 for model queries",    () => expect(detectTargetLayer("build a model of fundraising")).toBe(2))
  test("returns L2 for across-all",       () => expect(detectTargetLayer("across all my meetings")).toBe(2))
  test("returns L1 for specific entity",  () => expect(detectTargetLayer("summarize alice chen")).toBe(1))
  test("returns L1 by default",           () => expect(detectTargetLayer("what is the auth architecture?")).toBe(1))
})

describe("detectDeleteIntent", () => {
  test("detects node delete",   () => {
    const r = detectDeleteIntent("delete alice chen")
    expect(r.kind).toBe("node")
    expect(r.subject).toContain("alice")
  })

  test("detects edge delete",   () => {
    const r = detectDeleteIntent("remove the works_at relationship between alice and acme")
    expect(r.kind).toBe("edge")
    expect(r.link_type).toBe("works_at")
    expect(r.subject).toContain("alice")
  })

  test("detects edge with arrow", () => {
    const r = detectDeleteIntent("remove alice → acme")
    expect(r.kind).toBe("edge")
    expect(r.subject).toContain("alice")
    expect(r.subject).toContain("acme")
  })

  test("returns null for normal queries", () => {
    expect(detectDeleteIntent("what is event sourcing?").kind).toBeNull()
    expect(detectDeleteIntent("search for alice").kind).toBeNull()
  })
})
