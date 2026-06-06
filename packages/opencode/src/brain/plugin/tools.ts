import z                    from "zod"
import { brainSearch }       from "../search/hybrid"
import { captureToBrain, deleteNode, deleteEdge } from "../capture"
import { brainDb }           from "../db"

// ── Tool definitions (zod schemas + execute functions) ─────────────────────

export const BrainTools = {

  search_brain: {
    description:
      "Search the project knowledge brain using hybrid semantic + keyword search. " +
      "Cascades from L2 (patterns) → L1 (syntheses) → L0 (raw notes). " +
      "ALWAYS call this before answering architectural or historical questions.",
    parameters: z.object({
      query:     z.string().describe("What to search for"),
      layer:     z.number().int().min(0).max(2).optional().describe("Restrict to specific layer (0=raw, 1=synthesis, 2=patterns)"),
      limit:     z.number().int().min(1).max(20).optional().default(5),
      source_id: z.string().optional(),
    }),
    execute: async ({ query, layer, limit, source_id }: {
      query: string; layer?: number; limit?: number; source_id?: string
    }) => {
      const result = await brainSearch(query, {
        layer:     layer !== undefined ? layer : null,
        limit:     limit ?? 5,
        source_id: source_id ?? "default",
      })
      return {
        results: result.results.map((r) => ({
          slug:          r.slug,
          title:         r.title,
          excerpt:       (r.compiled_truth ?? "").slice(0, 500),
          layer:         r.layer,
          score:         r.score,
          evidence:      r.evidence,
          create_safety: r.create_safety,
        })),
        layer_reached:   result.layer_reached,
        cascaded:        result.cascaded,
        layers_searched: result.layers_searched,
        promote_signal:  result.promote_signals.length > 0,
      }
    },
  },

  get_brain_node: {
    description: "Fetch the full content of a specific brain node by its slug.",
    parameters: z.object({
      slug:      z.string(),
      source_id: z.string().optional(),
    }),
    execute: async ({ slug, source_id }: { slug: string; source_id?: string }) => {
      const db  = brainDb()
      const sid = source_id ?? "default"
      const rows = await db`
        SELECT id, slug, layer, type, title, compiled_truth, frontmatter
        FROM brain_pages
        WHERE slug = ${slug} AND source_id = ${sid} AND deleted_at IS NULL
        LIMIT 1
      `
      if (!(rows as unknown[]).length) return { error: `Node not found: ${slug}` }
      return rows[0]
    },
  },

  save_to_brain: {
    description:
      "Save a piece of knowledge to the brain. " +
      "Use for decisions, discoveries, patterns, architectural choices. " +
      "layer=0 for raw notes, layer=1 for synthesised summaries, layer=2 for durable patterns. " +
      "Writes both a .md file on disk and a Postgres row.",
    parameters: z.object({
      content:    z.string().describe("Markdown content to save"),
      type:       z.string().optional().default("note"),
      layer:      z.union([z.literal(0), z.literal(1), z.literal(2)]).optional().default(0),
      slug:       z.string().optional().describe("Override auto-generated slug"),
      sources:    z.array(z.string()).optional().describe("Source slugs this is synthesized from"),
      query:      z.string().optional(),
      source_id:  z.string().optional(),
      session_id: z.string().optional().describe("Session that triggered this save"),
    }),
    execute: async (params: {
      content: string; type?: string; layer?: 0|1|2; slug?: string;
      sources?: string[]; query?: string; source_id?: string; session_id?: string
    }) => {
      const { writeFileSync, mkdirSync } = await import("node:fs")
      const { join, dirname } = await import("node:path")
      const { inboxSlug, contentHash } = await import("../slugify")

      const content   = params.content
      const layer     = params.layer ?? 0
      const type      = params.type ?? "note"
      const sourceId  = params.source_id ?? "default"
      const hash      = contentHash(content)
      const slug      = params.slug ?? inboxSlug(hash)
      const brainDir  = process.env.BRAIN_DIR

      // 1. Write .md file to .brain/ folder (source of truth)
      if (brainDir) {
        const filePath = join(brainDir, slug + ".md")
        mkdirSync(dirname(filePath), { recursive: true })
        const fm = [
          "---",
          `type: ${type}`,
          `layer: ${layer}`,
          ...(params.query   ? [`query: "${params.query.replace(/"/g, '\\"')}"`] : []),
          ...(params.sources?.length ? ["sources:", ...params.sources.map(s => `  - ${s}`)] : []),
          "---",
          "",
        ].join("\n")
        writeFileSync(filePath, fm + content + "\n", "utf8")
      }

      // 2. Write to Postgres (file watcher dedup prevents double-write)
      return captureToBrain({
        content,
        type,
        layer,
        slug,
        sources:           params.sources,
        query:             params.query,
        source_id:         sourceId,
        session_id:        params.session_id,
        contribution_type: "capture",
      })
    },
  },

  delete_brain_node: {
    description: "Delete a knowledge node from the brain. Requires confirm=true to actually delete.",
    parameters: z.object({
      slug:      z.string(),
      confirm:   z.boolean().describe("Must be true to execute deletion"),
      source_id: z.string().optional(),
    }),
    execute: async ({ slug, confirm, source_id }: { slug: string; confirm: boolean; source_id?: string }) => {
      if (!confirm) {
        const db = brainDb()
        const rows = await db`
          SELECT p.title,
            (SELECT COUNT(*) FROM brain_links l WHERE l.from_page_id = p.id OR l.to_page_id = p.id)::int AS edge_count
          FROM brain_pages p WHERE p.slug = ${slug} AND p.deleted_at IS NULL LIMIT 1
        `
        return { preview: true, slug, ...(rows[0] ?? {}), message: "Set confirm=true to delete" }
      }
      return deleteNode(slug, source_id ?? "default")
    },
  },

  delete_brain_edge: {
    description: "Remove a typed relationship between two brain nodes.",
    parameters: z.object({
      from_slug:  z.string(),
      to_slug:    z.string(),
      link_type:  z.string().optional(),
      source_id:  z.string().optional(),
    }),
    execute: async ({ from_slug, to_slug, link_type, source_id }: {
      from_slug: string; to_slug: string; link_type?: string; source_id?: string
    }) => {
      return deleteEdge(from_slug, to_slug, link_type, source_id ?? "default")
    },
  },

  get_brain_context: {
    description:
      "Automatically retrieve relevant brain context for the current coding task. " +
      "Call at the start of a session or when starting a new subtask.",
    parameters: z.object({
      task:      z.string().describe("Current task description"),
      max_nodes: z.number().int().min(1).max(10).optional().default(5),
      source_id: z.string().optional(),
    }),
    execute: async ({ task, max_nodes, source_id }: { task: string; max_nodes?: number; source_id?: string }) => {
      const result = await brainSearch(task, {
        limit:     max_nodes ?? 5,
        source_id: source_id ?? "default",
      })
      return {
        context: result.results.map((r) => ({
          slug:    r.slug,
          title:   r.title,
          layer:   r.layer,
          excerpt: (r.compiled_truth ?? "").slice(0, 800),
        })),
        layer_reached:  result.layer_reached,
        promote_signal: result.promote_signals.length > 0,
      }
    },
  },

  list_brain_nodes: {
    description: "List brain nodes with optional filters.",
    parameters: z.object({
      type:      z.string().optional(),
      layer:     z.number().int().min(0).max(2).optional(),
      source_id: z.string().optional(),
      limit:     z.number().int().min(1).max(100).optional().default(20),
    }),
    execute: async ({ type, layer, source_id, limit }: {
      type?: string; layer?: number; source_id?: string; limit?: number
    }) => {
      const db  = brainDb()
      const sid = source_id ?? "default"
      const rows = await db.unsafe(`
        SELECT id, slug, layer, type, title, updated_at
        FROM brain_pages
        WHERE source_id = $1
          AND deleted_at IS NULL
          ${type  !== undefined ? `AND type = '${type.replace(/'/g, "''")}'` : ""}
          ${layer !== undefined ? `AND layer = ${layer}` : ""}
        ORDER BY layer, updated_at DESC
        LIMIT $2
      `, [sid, limit ?? 20])
      return { nodes: rows, count: (rows as unknown[]).length }
    },
  },

  find_brain_experts: {
    description: "Find people in the brain who have knowledge about a topic.",
    parameters: z.object({
      topic:     z.string(),
      source_id: z.string().optional(),
    }),
    execute: async ({ topic, source_id }: { topic: string; source_id?: string }) => {
      const result = await brainSearch(topic, {
        source_id: source_id ?? "default",
        limit: 10,
      })
      const people = result.results.filter((r) => r.type === "person")
      return { experts: people.map((p) => ({ slug: p.slug, title: p.title, score: p.score })) }
    },
  },

  find_brain_connections: {
    description: "Traverse the knowledge graph to find how nodes connect.",
    parameters: z.object({
      slug:      z.string(),
      depth:     z.number().int().min(1).max(3).optional().default(2),
      direction: z.enum(["in", "out", "both"]).optional().default("both"),
      source_id: z.string().optional(),
    }),
    execute: async ({ slug, depth, direction, source_id }: {
      slug: string; depth?: number; direction?: "in"|"out"|"both"; source_id?: string
    }) => {
      const db  = brainDb()
      const sid = source_id ?? "default"

      const startPage = await db`
        SELECT id FROM brain_pages WHERE slug = ${slug} AND source_id = ${sid} AND deleted_at IS NULL LIMIT 1
      `
      if (!(startPage as unknown[]).length) return { error: "Node not found" }

      const startId = (startPage[0] as { id: number }).id
      const visited = new Set<number>([startId])
      const results: unknown[] = []
      let frontier = [startId]

      for (let d = 0; d < (depth ?? 2) && frontier.length; d++) {
        let links: { page_id: number; slug: string; title: string; link_type: string }[] = []

        if (direction !== "in") {
          const out = await db`
            SELECT tp.id AS page_id, tp.slug, tp.title, l.link_type
            FROM brain_links l JOIN brain_pages tp ON tp.id = l.to_page_id
            WHERE l.from_page_id = ANY(${frontier}) AND tp.source_id = ${sid} AND tp.deleted_at IS NULL
          ` as typeof links
          links = links.concat(out)
        }
        if (direction !== "out") {
          const inn = await db`
            SELECT fp.id AS page_id, fp.slug, fp.title, l.link_type
            FROM brain_links l JOIN brain_pages fp ON fp.id = l.from_page_id
            WHERE l.to_page_id = ANY(${frontier}) AND fp.source_id = ${sid} AND fp.deleted_at IS NULL
          ` as typeof links
          links = links.concat(inn)
        }

        frontier = []
        for (const link of links) {
          if (!visited.has(link.page_id)) {
            visited.add(link.page_id)
            frontier.push(link.page_id)
            results.push({ ...link, depth: d + 1 })
          }
        }
      }
      return { connections: results, total: results.length }
    },
  },

} as const
