import { generateText }    from "ai"
import { brainSearch }      from "../search/hybrid"
import { captureToBrain }   from "../capture"
import { detectTargetLayer } from "./intent"
import { writeFileSync, mkdirSync } from "node:fs"
import { join, dirname }    from "node:path"

export type SynthesisSubtype = "summary" | "insight" | "connection" | "pattern" | "session" | "architecture"

export interface SynthesisPreview {
  content:      string
  slug:         string
  layer:        1 | 2
  subtype:      SynthesisSubtype
  sources_used: string[]
  query:        string
  session_id?:  string
  model_used:   string
  preview:      true
}

interface RunSynthesisOpts {
  query:        string
  subtype:      SynthesisSubtype
  targetLayer?: 1 | 2
  sourceSlugs?: string[]
  sourceId?:    string
  sessionId?:   string   // SQLite session that triggered synthesis
  model?:       Parameters<typeof generateText>[0]["model"]
}

const SUBTYPE_PROMPTS: Record<SynthesisSubtype, string> = {
  summary:      "Synthesise the provided sources into a concise, well-structured summary. Focus on key facts, decisions, and relationships. Use markdown headers.",
  insight:      "Analyse the provided sources and extract non-obvious insights, risks, or opportunities. Think critically. Use markdown.",
  connection:   "Identify meaningful relationships and surprising connections between the provided sources. Explain why they matter.",
  pattern:      "Derive a durable principle or pattern from the provided examples. Your output should generalise beyond the specific cases. Use markdown.",
  session:      "Summarise the key decisions, discoveries, and open questions from this coding session. Be concise.",
  architecture: "Based on the repository structure provided, write a clear architecture overview covering: what it does, tech stack, main components, and key decisions.",
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, "-").slice(0, 50)
}

function subtypeFolder(subtype: SynthesisSubtype): string {
  const map: Record<SynthesisSubtype, string> = {
    summary:      "summaries",
    insight:      "insights",
    connection:   "connections",
    pattern:      "patterns",
    session:      "sessions",
    architecture: "projects",
  }
  return map[subtype]
}

export async function runSynthesis(opts: RunSynthesisOpts): Promise<SynthesisPreview> {
  const targetLayer = opts.targetLayer ?? detectTargetLayer(opts.query)
  const sourceId    = opts.sourceId    ?? "default"
  const sourceLayer = (targetLayer - 1) as 0 | 1

  // Collect source pages
  let sourcePages: { slug: string; title: string; compiled_truth: string }[] = []

  if (opts.sourceSlugs?.length) {
    const { brainDb } = await import("../db")
    const db = brainDb()
    sourcePages = await db`
      SELECT slug, title, compiled_truth FROM brain_pages
      WHERE slug = ANY(${opts.sourceSlugs}) AND source_id = ${sourceId} AND deleted_at IS NULL
    ` as typeof sourcePages
  } else {
    const searchResult = await brainSearch(opts.query, {
      layer:     sourceLayer,
      source_id: sourceId,
      limit:     5,
    })
    sourcePages = searchResult.results.map((r) => ({
      slug:           r.slug,
      title:          r.title ?? "",
      compiled_truth: r.compiled_truth ?? "",
    }))
  }

  if (!sourcePages.length) throw new Error("No source material found for synthesis")

  // Build context
  const context = sourcePages
    .map((p, i) => `## Source ${i + 1}: ${p.title}\nSlug: ${p.slug}\n\n${(p.compiled_truth ?? "").slice(0, 3000)}`)
    .join("\n\n---\n\n")

  if (!opts.model) throw new Error("No AI model configured for brain synthesis")

  // LLM call
  const { text } = await generateText({
    model:  opts.model,
    system: `You are a knowledge assistant. ${SUBTYPE_PROMPTS[opts.subtype]}\n\nEnd with a "## Sources Used" section.`,
    prompt: `Query: "${opts.query}"\n\nSources:\n${context}`,
  })

  // Build slug
  const today = new Date().toISOString().slice(0, 10)
  const slug  = `L${targetLayer}/${subtypeFolder(opts.subtype)}/${slugify(opts.query)}-${today}`

  return {
    content:      text,
    slug,
    layer:        targetLayer,
    subtype:      opts.subtype,
    sources_used: sourcePages.map((p) => p.slug),
    query:        opts.query,
    session_id:   opts.sessionId,
    model_used:   "configured-model",
    preview:      true,
  }
}

export async function confirmSynthesis(
  preview:  SynthesisPreview,
  brainDir: string,
): Promise<{ saved: true; slug: string; page_id: number }> {
  // 1. Write .md file
  const relPath  = preview.slug + ".md"
  const fullPath = join(brainDir, relPath)
  mkdirSync(dirname(fullPath), { recursive: true })

  const fm = [
    "---",
    `type: synthesis`,
    `subtype: ${preview.subtype}`,
    `layer: ${preview.layer}`,
    `query: "${preview.query.replace(/"/g, '\\"')}"`,
    `synthesized_at: "${new Date().toISOString()}"`,
    `model: ${preview.model_used}`,
    `tags:`,
    `  - auto-generated`,
    `  - ${preview.subtype}`,
    `sources:`,
    ...preview.sources_used.map((s) => `  - ${s}`),
    "---",
  ].join("\n")

  writeFileSync(fullPath, `${fm}\n\n${preview.content}\n`, "utf8")

  // 2. Write to DB (with session contribution tracking)
  const result = await captureToBrain({
    content:           preview.content,
    slug:              preview.slug,
    type:              "synthesis",
    layer:             preview.layer,
    sources:           preview.sources_used,
    query:             preview.query,
    session_id:        preview.session_id,
    contribution_type: "synthesis",
  })

  return { saved: true, slug: result.slug, page_id: result.page_id }
}
