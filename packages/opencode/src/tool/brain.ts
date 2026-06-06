import z from "zod"
import { Tool } from "./tool"
import { resolveBrainCtx } from "../brain/session-context"

// ── search_brain ──────────────────────────────────────────────────────────────

export const BrainSearchTool = Tool.define("brain_search", {
  description:
    "Search the project knowledge brain using hybrid semantic + keyword search. " +
    "Cascades from L2 (patterns/models) → L1 (syntheses) → L0 (raw notes). " +
    "ALWAYS call this before answering questions about architecture, past decisions, or project history.",
  parameters: z.object({
    query: z.string().describe("What to search for"),
    layer: z
      .number()
      .int()
      .min(0)
      .max(2)
      .optional()
      .describe("Restrict to layer: 0=raw notes, 1=synthesis, 2=patterns. Omit to cascade all layers."),
    limit: z.number().int().min(1).max(20).optional().default(5),
  }),
  async execute(params, ctx) {
    const { brainSearch } = await import("../brain/search/hybrid")
    const { sourceId }    = resolveBrainCtx(ctx.sessionID)
    const result = await brainSearch(params.query, {
      layer:     params.layer !== undefined ? params.layer : null,
      limit:     params.limit ?? 5,
      source_id: sourceId,
    })

    ctx.metadata({
      title: `Brain search: "${params.query}"`,
      metadata: { layer_reached: result.layer_reached, cascaded: result.cascaded },
    })

    const output = result.results.length === 0
      ? "No relevant knowledge found in the brain."
      : result.results.map((r) =>
          `## ${r.title ?? r.slug} [L${r.layer}]\nSlug: ${r.slug}\nEvidence: ${r.evidence}\n\n${(r.compiled_truth ?? "").slice(0, 600)}`
        ).join("\n\n---\n\n")

    return {
      title:    `Brain: ${result.results.length} result(s) from L${result.layer_reached}`,
      output,
      metadata: {
        layer_reached:   result.layer_reached,
        cascaded:        result.cascaded,
        layers_searched: result.layers_searched,
        promote_signal:  result.promote_signals.length > 0,
      },
    }
  },
})

// ── save_to_brain ─────────────────────────────────────────────────────────────

export const BrainSaveTool = Tool.define("brain_save", {
  description:
    "Save a piece of knowledge to the project brain. " +
    "Use for decisions made, discoveries, architectural choices, patterns noticed, or anything worth remembering. " +
    "Writes a .md file on disk AND indexes it in Postgres for future search. " +
    "layer=0 for raw notes/facts, layer=1 for synthesised summaries, layer=2 for durable patterns.",
  parameters: z.object({
    content:   z.string().describe("Markdown content to save"),
    title:     z.string().describe("Short title for the knowledge node"),
    type:      z.enum(["note", "decision", "person", "company", "meeting", "synthesis"]).default("note"),
    layer:     z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
    slug:      z.string().optional().describe("Override slug, e.g. 'L0/decisions/event-sourcing'"),
    sources:   z.array(z.string()).optional().describe("Source slugs this synthesises from"),
    query:     z.string().optional().describe("Question that prompted this save"),
  }),
  async execute(params, ctx) {
    const { writeFileSync, mkdirSync } = await import("node:fs")
    const { join, dirname }            = await import("node:path")
    const { inboxSlug, contentHash }   = await import("../brain/slugify")
    const { captureToBrain }           = await import("../brain/capture")

    const { brainDir, sourceId } = resolveBrainCtx(ctx.sessionID)
    const hash = contentHash(params.content)
    const slug = params.slug ?? inboxSlug(hash)

    // 1. Write .md file to .brain/ (source of truth on disk)
    if (brainDir) {
      const filePath = join(brainDir, slug + ".md")
      mkdirSync(dirname(filePath), { recursive: true })
      const fm = [
        "---",
        `type: ${params.type}`,
        `layer: ${params.layer}`,
        `title: ${params.title}`,
        ...(params.query   ? [`query: "${params.query.replace(/"/g, '\\"')}"`] : []),
        ...(params.sources?.length ? ["sources:", ...params.sources.map(s => `  - ${s}`)] : []),
        "---",
        "",
      ].join("\n")
      writeFileSync(filePath, fm + params.content + "\n", "utf8")
    }

    // 2. Write to Postgres
    const result = await captureToBrain({
      content:           params.content,
      type:              params.type,
      layer:             params.layer,
      slug,
      sources:           params.sources,
      query:             params.query,
      source_id:         sourceId,
      session_id:        ctx.sessionID,
      contribution_type: "capture",
    })

    ctx.metadata({ title: `Saved to brain: ${slug}`, metadata: { slug, layer: params.layer } })

    return {
      title:    `Brain: saved ${slug}`,
      output:   result.created
        ? `✅ Saved to brain:\n- Slug: ${slug}\n- Layer: L${params.layer}\n- Type: ${params.type}\n- File: ${brainDir ? slug + ".md" : "(no BRAIN_DIR set)"}`
        : `⚠️ Already exists (content unchanged): ${slug}`,
      metadata: { slug, layer: params.layer, created: result.created },
    }
  },
})

// ── get_brain_context ─────────────────────────────────────────────────────────

export const BrainContextTool = Tool.define("brain_context", {
  description:
    "Automatically retrieve relevant knowledge from the brain for the current task. " +
    "Call this at the start of a complex task to get architectural context, past decisions, and relevant patterns. " +
    "Returns the top matching nodes across all layers.",
  parameters: z.object({
    task:      z.string().describe("Current task or question to get context for"),
    max_nodes: z.number().int().min(1).max(10).optional().default(5),
  }),
  async execute(params, ctx) {
    const { brainSearch }        = await import("../brain/search/hybrid")
    const { sourceId }           = resolveBrainCtx(ctx.sessionID)
    const result = await brainSearch(params.task, { limit: params.max_nodes ?? 5, source_id: sourceId })

    ctx.metadata({ title: `Brain context for: "${params.task}"`, metadata: {} })

    const contextOutput = !result.results.length
      ? "No relevant knowledge in the brain yet. Consider saving key decisions as you make them."
      : [
          `Retrieved ${result.results.length} relevant knowledge nodes (layer reached: L${result.layer_reached}):`,
          "",
          ...result.results.map((r, i) =>
            `### ${i + 1}. ${r.title ?? r.slug} [L${r.layer}]\n${(r.compiled_truth ?? "").slice(0, 400)}`
          ),
          result.promote_signals.length > 0
            ? `\n⬆ Note: ${result.promote_signals.length} frequently-accessed L0 node(s) could be synthesised to L1.`
            : "",
        ].filter(Boolean).join("\n")

    return {
      title:    result.results.length ? `Brain: ${result.results.length} context node(s)` : "Brain: no context found",
      output:   contextOutput,
      metadata: { layer_reached: result.layer_reached ?? -1 },
    }
  },
})

// ── brain_delete ──────────────────────────────────────────────────────────────

export const BrainDeleteTool = Tool.define("brain_delete", {
  description:
    "Delete a knowledge node from the brain. " +
    "Requires confirm=true to actually delete — without it returns a preview showing what would be deleted.",
  parameters: z.object({
    slug:    z.string().describe("Slug of the node to delete, e.g. 'L0/decisions/old-decision'"),
    confirm: z.boolean().default(false).describe("Must be true to execute deletion"),
  }),
  async execute(params, ctx) {
    let deleteTitle  = ""
    let deleteOutput = ""

    if (!params.confirm) {
      const { brainDb } = await import("../brain/db")
      const db = brainDb()
      const rows = await db`
        SELECT title, type, layer,
          (SELECT COUNT(*) FROM brain_links l WHERE l.from_page_id = p.id OR l.to_page_id = p.id)::int AS edges
        FROM brain_pages p WHERE slug = ${params.slug} AND deleted_at IS NULL LIMIT 1
      ` as { title: string; type: string; layer: number; edges: number }[]

      if (!rows.length) {
        deleteTitle  = "Brain: node not found"
        deleteOutput = `No node found with slug: ${params.slug}`
      } else {
        const r = rows[0]
        deleteTitle  = `Brain: delete preview for ${params.slug}`
        deleteOutput = `Would delete:\n- Title: ${r.title}\n- Type: ${r.type} (L${r.layer})\n- Edges: ${r.edges}\n\nCall again with confirm=true to execute.`
      }
    } else {
      const { deleteNode } = await import("../brain/capture")
      const result = await deleteNode(params.slug, "default")
      deleteTitle  = result.deleted ? `Brain: deleted ${params.slug}` : "Brain: delete failed"
      deleteOutput = result.deleted
        ? `✅ Deleted ${params.slug} and ${result.edges_deleted} edges.`
        : `❌ ${result.error ?? "Delete failed"}`
    }

    ctx.metadata({ title: deleteTitle, metadata: {} })
    return { title: deleteTitle, output: deleteOutput, metadata: {} }
  },
})
