import { Hono }         from "hono"
import { brainSearch }  from "../../brain/search/hybrid"
import { captureToBrain, deleteNode, deleteEdge } from "../../brain/capture"
import { brainDb }      from "../../brain/db"
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs"
import { join, extname, basename } from "node:path"

const BRAIN_DIR = process.env.BRAIN_DIR ?? process.cwd()

/** Resolve a language model for brain synthesis.
 *  Priority: 1) supadense Provider system  2) direct env var construction */
async function resolveBrainModel() {
  // Try supadense's provider system first (uses Effect runtime)
  try {
    const { Provider } = await import("../../provider/provider")
    const model = await Provider.defaultModel()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (model) return await Provider.getLanguage(model as any)
  } catch {}

  // Fallback: construct directly from env vars (works before project is opened)
  try {
    if (process.env.ANTHROPIC_API_KEY) {
      const { createAnthropic } = await import("@ai-sdk/anthropic")
      const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      return anthropic("claude-haiku-4-5-20251001")  // fast + cheap for brain ops
    }
    if (process.env.OPENAI_API_KEY) {
      const { createOpenAI } = await import("@ai-sdk/openai")
      const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY })
      return openai("gpt-4o-mini")
    }
  } catch {}

  return null
}

// ── Helpers ────────────────────────────────────────────────────────────────

function json(c: { json: Function }, data: unknown, status = 200) {
  return c.json(data, status as 200)
}

// ── Router ─────────────────────────────────────────────────────────────────

export const BrainRoutes = new Hono()

// GET /brain/search
BrainRoutes.get("/search", async (c) => {
  const query    = c.req.query("query") ?? ""
  const layerStr = c.req.query("layer")
  const sourceId = c.req.query("source_id") ?? "default"
  const limit    = parseInt(c.req.query("limit") ?? "10", 10)

  if (!query.trim()) return json(c, { error: "query required" }, 400)

  const layer = layerStr !== undefined ? parseInt(layerStr, 10) : null
  const result = await brainSearch(query, { layer, source_id: sourceId, limit })
  return json(c, result)
})

// POST /brain/capture
BrainRoutes.post("/capture", async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body?.content) return json(c, { error: "content required" }, 400)

  const result = await captureToBrain({
    content:           body.content,
    slug:              body.slug,
    type:              body.type,
    layer:             body.layer,
    source_id:         body.source_id,
    sources:           body.sources,
    query:             body.query,
    session_id:        body.session_id,
    contribution_type: body.contribution_type ?? "capture",
  })
  return json(c, result)
})

// GET /brain/node
BrainRoutes.get("/node", async (c) => {
  const slug     = c.req.query("slug") ?? ""
  const sourceId = c.req.query("source_id") ?? "default"
  if (!slug) return json(c, { error: "slug required" }, 400)

  const db = brainDb()
  const rows = await db`
    SELECT * FROM brain_pages
    WHERE slug = ${slug} AND source_id = ${sourceId} AND deleted_at IS NULL
    LIMIT 1
  `
  if (!(rows as unknown[]).length) return json(c, { error: "Not found" }, 404)
  return json(c, rows[0])
})

// DELETE /brain/node
BrainRoutes.delete("/node", async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body?.slug) return json(c, { error: "slug required" }, 400)
  if (!body?.confirm) return json(c, { preview: true, slug: body.slug, message: "Set confirm=true to delete" }, 200)

  const result = await deleteNode(body.slug, body.source_id ?? "default")
  return json(c, result, result.deleted ? 200 : 404)
})

// DELETE /brain/edge
BrainRoutes.delete("/edge", async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body?.from_slug || !body?.to_slug) return json(c, { error: "from_slug and to_slug required" }, 400)

  const result = await deleteEdge(body.from_slug, body.to_slug, body.link_type, body.source_id ?? "default")
  return json(c, result, result.deleted ? 200 : 404)
})

// POST /brain/synthesize
BrainRoutes.post("/synthesize", async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body?.query) return json(c, { error: "query required" }, 400)

  const { runSynthesis, confirmSynthesis } = await import("../../brain/synthesis/engine")

  // Resolve model: body.model_id > supadense default > error
  let model = body.model ?? null
  if (!model) model = await resolveBrainModel()
  if (!model) return json(c, { error: "No AI model configured. Set a provider in supadense settings or pass model in request body." }, 400)

  const preview = await runSynthesis({
    query:       body.query,
    subtype:     body.subtype ?? "summary",
    targetLayer: body.target_layer ?? 1,
    sourceSlugs: body.source_slugs,
    sourceId:    body.source_id,
    sessionId:   body.session_id,
    model,
  })

  if (!body.confirm) return json(c, { ...preview, preview: true })

  const saved = await confirmSynthesis(preview, BRAIN_DIR)
  return json(c, { ...preview, ...saved, preview: false })
})

// GET /brain/graph
BrainRoutes.get("/graph", async (c) => {
  const sourceId = c.req.query("source_id") ?? "default"
  const layerStr = c.req.query("layer")
  const db = brainDb()

  const layerFilter = layerStr !== undefined
    ? `AND p.layer = ${parseInt(layerStr, 10)}`
    : ""

  const nodes = await db.unsafe(`
    SELECT id, slug, title, type, layer, source_id,
           (frontmatter->>'subtype') AS subtype
    FROM brain_pages
    WHERE deleted_at IS NULL AND source_id = $1 ${layerFilter}
    ORDER BY layer, slug
  `, [sourceId])

  const pageIds = (nodes as unknown as { id: number }[]).map((n) => n.id)
  const edges = pageIds.length
    ? await db`
        SELECT l.id, l.from_page_id, l.to_page_id, l.link_type,
               fp.slug AS from_slug, fp.title AS from_title, fp.type AS from_type,
               tp.slug AS to_slug,   tp.title AS to_title,   tp.type AS to_type
        FROM brain_links l
        JOIN brain_pages fp ON fp.id = l.from_page_id
        JOIN brain_pages tp ON tp.id = l.to_page_id
        WHERE l.from_page_id = ANY(${pageIds})
          AND l.to_page_id   = ANY(${pageIds})
      `
    : []

  return json(c, { nodes, edges })
})

// GET /brain/stats
BrainRoutes.get("/stats", async (c) => {
  const sourceId = c.req.query("source_id") ?? "default"
  const db = brainDb()

  const rows = await db`
    SELECT
      COUNT(*) FILTER (WHERE layer = 0) AS l0_count,
      COUNT(*) FILTER (WHERE layer = 1) AS l1_count,
      COUNT(*) FILTER (WHERE layer = 2) AS l2_count,
      COUNT(*) AS total
    FROM brain_pages
    WHERE source_id = ${sourceId} AND deleted_at IS NULL
  `
  const links = await db`SELECT COUNT(*) AS total FROM brain_links`
  const stale = await db`SELECT COUNT(*) AS total FROM brain_chunks WHERE embedding IS NULL`

  return json(c, {
    pages:          rows[0],
    total_edges:    (links[0] as { total: number }).total,
    stale_chunks:   (stale[0] as { total: number }).total,
    source_id:      sourceId,
  })
})

// POST /brain/chat — cascading search + intent detection
BrainRoutes.post("/chat", async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body?.query) return json(c, { error: "query required" }, 400)

  const query    = body.query as string
  const sourceId = (body.source_id as string) ?? "default"

  // Dynamic import to avoid circular at module load
  const { detectSynthesisIntent, detectTargetLayer, detectDeleteIntent } = await import("../../brain/synthesis/intent")

  // ── Delete intent ─────────────────────────────────────────────────────
  const delIntent = detectDeleteIntent(query)
  if (delIntent.kind === "node") {
    const db   = brainDb()
    const name = delIntent.subject
    const page = await db`
      SELECT id, slug, title, type,
        (SELECT COUNT(*) FROM brain_links l WHERE l.from_page_id = p.id OR l.to_page_id = p.id)::int AS edge_count
      FROM brain_pages p
      WHERE deleted_at IS NULL AND source_id = ${sourceId}
        AND (title ILIKE ${'%' + name + '%'} OR slug ILIKE ${'%' + name.toLowerCase().replace(/\s+/g, "-") + '%'})
      ORDER BY title LIMIT 1
    ` as { id: number; slug: string; title: string; type: string; edge_count: number }[]

    if (!page.length) return json(c, { answer: `Could not find a node matching "${name}".`, sources: [], delete_preview: null })
    const p = page[0]
    return json(c, {
      answer: `Found **${p.title}** (\`${p.slug}\`). This will delete the node and **${p.edge_count} edges**. Confirm?`,
      sources: [],
      delete_preview: { kind: "node", slug: p.slug, title: p.title, source_id: sourceId, edge_count: p.edge_count },
    })
  }

  if (delIntent.kind === "edge") {
    const parts    = delIntent.subject.split("→").map((s: string) => s.trim())
    const fromName = parts[0] ?? ""
    const toName   = parts[1] ?? ""
    if (fromName && toName) {
      const db = brainDb()
      const edge = await db`
        SELECT fp.slug AS from_slug, fp.title AS from_title,
               tp.slug AS to_slug,   tp.title AS to_title, l.link_type
        FROM brain_links l
        JOIN brain_pages fp ON fp.id = l.from_page_id
        JOIN brain_pages tp ON tp.id = l.to_page_id
        WHERE fp.deleted_at IS NULL AND tp.deleted_at IS NULL
          AND fp.source_id = ${sourceId}
          AND fp.title ILIKE ${'%' + fromName + '%'}
          AND tp.title ILIKE ${'%' + toName   + '%'}
          ${delIntent.link_type ? db`AND l.link_type = ${delIntent.link_type}` : db``}
        LIMIT 1
      ` as { from_slug: string; from_title: string; to_slug: string; to_title: string; link_type: string }[]

      if (!edge.length) return json(c, { answer: `Could not find an edge matching "${delIntent.subject}". Try: "remove the [type] between [from] and [to]"`, sources: [], delete_preview: null })
      const e = edge[0]
      return json(c, {
        answer: `Found edge: **${e.from_title}** ──[${e.link_type}]──► **${e.to_title}**. Remove this relationship?`,
        sources: [],
        delete_preview: { kind: "edge", from_slug: e.from_slug, to_slug: e.to_slug, link_type: e.link_type, from_title: e.from_title, to_title: e.to_title },
      })
    }
  }

  // ── Normal search + Q&A ───────────────────────────────────────────────
  const wantsSynthesis = detectSynthesisIntent(query)
  const targetLayer    = detectTargetLayer(query)
  const searchResult   = await brainSearch(query, { source_id: sourceId, limit: 5 })

  if (!searchResult.results.length) {
    return json(c, {
      answer:          "No relevant information found in the brain. Try adding more notes first.",
      sources:         [],
      layer_reached:   -1,
      cascaded:        true,
      synthesis_hint:  false,
      promote_signals: [],
    })
  }

  // Generate answer using supadense's AI provider
  let answer: string | null = null
  const model = await resolveBrainModel()
  if (model) {
    try {
      const { generateText } = await import("ai")
      const context = searchResult.results
        .map((r, i) => `## Source ${i + 1}: ${r.title ?? r.slug}\n${(r.compiled_truth ?? "").slice(0, 1500)}`)
        .join("\n\n---\n\n")
      const { text } = await generateText({
        model,
        system: "You are a knowledgeable assistant. Answer the user's question using only the provided brain context. Be concise and direct.",
        prompt: `Question: ${query}\n\nBrain context:\n${context}`,
      })
      answer = text
    } catch (err) {
      // Non-fatal — return search results without generated answer
      answer = null
    }
  }

  return json(c, {
    answer,
    sources:         searchResult.results.map((r) => ({ slug: r.slug, title: r.title, type: r.type, layer: r.layer, excerpt: (r.compiled_truth ?? "").slice(0, 500) })),
    layer_reached:   searchResult.layer_reached,
    layer_label:     searchResult.layer_reached === 2 ? "L2 — pattern" : searchResult.layer_reached === 1 ? "L1 — synthesis" : "L0 — raw notes",
    cascaded:        searchResult.cascaded,
    layers_searched: searchResult.layers_searched,
    synthesis_hint:  wantsSynthesis,
    target_layer:    targetLayer,
    promote_signals: searchResult.promote_signals,
    delete_preview:  null,
    model_available: !!model,
  })
})

// GET /brain/session/:sessionId/contributions
// "What brain nodes did this coding session produce?"
BrainRoutes.get("/session/:sessionId/contributions", async (c) => {
  const sessionId = c.req.param("sessionId")
  const db = brainDb()

  const rows = await db`
    SELECT
      sbc.contribution_type,
      sbc.contributed_at,
      p.slug,
      p.title,
      p.type,
      p.layer
    FROM session_brain_contributions sbc
    JOIN brain_pages p ON p.id = sbc.brain_page_id
    WHERE sbc.session_id = ${sessionId}
      AND p.deleted_at IS NULL
    ORDER BY sbc.contributed_at ASC
  `
  return json(c, { session_id: sessionId, contributions: rows, total: (rows as unknown[]).length })
})

// GET /brain/node/:slug/sessions
// "Which coding sessions contributed to this brain node?"
BrainRoutes.get("/node/:slug/sessions", async (c) => {
  const slug     = decodeURIComponent(c.req.param("slug"))
  const sourceId = c.req.query("source_id") ?? "default"
  const db = brainDb()

  const rows = await db`
    SELECT
      sbc.session_id,
      sbc.contribution_type,
      sbc.contributed_at
    FROM session_brain_contributions sbc
    JOIN brain_pages p ON p.id = sbc.brain_page_id
    WHERE p.slug      = ${slug}
      AND p.source_id = ${sourceId}
      AND p.deleted_at IS NULL
    ORDER BY sbc.contributed_at ASC
  `
  return json(c, { slug, sessions: rows, total: (rows as unknown[]).length })
})

// GET /brain/contributions/recent?limit=20
// "What brain nodes were created recently, and which sessions made them?"
BrainRoutes.get("/contributions/recent", async (c) => {
  const limit    = parseInt(c.req.query("limit") ?? "20", 10)
  const sourceId = c.req.query("source_id") ?? "default"
  const db = brainDb()

  const rows = await db`
    SELECT
      sbc.session_id,
      sbc.contribution_type,
      sbc.contributed_at,
      p.slug,
      p.title,
      p.type,
      p.layer
    FROM session_brain_contributions sbc
    JOIN brain_pages p ON p.id = sbc.brain_page_id
    WHERE p.source_id = ${sourceId}
      AND p.deleted_at IS NULL
    ORDER BY sbc.contributed_at DESC
    LIMIT ${limit}
  `
  return json(c, { contributions: rows, total: (rows as unknown[]).length })
})

// GET /brain/versioning/history
BrainRoutes.get("/versioning/history", async (c) => {
  const count  = parseInt(c.req.query("count") ?? "20", 10)
  const { fetchLog } = await import("../../brain/versioning/client")
  const log = await fetchLog(count).catch(() => [])
  return json(c, { commits: log })
})

// GET /brain/versioning/at  ?commit=hash
BrainRoutes.get("/versioning/at", async (c) => {
  const commitHash = c.req.query("commit") ?? ""
  if (!commitHash) return json(c, { error: "commit hash required" }, 400)
  const url  = process.env.BRAIN_TERMINUSDB_URL ?? "http://localhost:6363"
  const auth = "Basic " + Buffer.from(`admin:${process.env.BRAIN_TERMINUSDB_PASS ?? "admin"}`).toString("base64")
  const res  = await fetch(`${url}/api/document/admin/supadense_brain/local/commit/${commitHash}?type=BrainPage&as_list=true&count=5000`, { headers: { Authorization: auth } })
  const data = await res.json().catch(() => [])
  return json(c, { commit: commitHash, nodes: data })
})

// POST /brain/analyze-repo
BrainRoutes.post("/analyze-repo", async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body?.repo_path || !body?.project_name) return json(c, { error: "repo_path and project_name required" }, 400)

  const { analyzeRepo } = await import("../../brain/analyzer")
  if (!body.model) return json(c, { error: "model required (e.g. 'anthropic:claude-sonnet-4-6')" }, 400)

  const result = await analyzeRepo(body.repo_path, body.project_name, body.model as never, body.source_id ?? "default")
  return json(c, result)
})

// POST /brain/capture-events
BrainRoutes.post("/capture-events", async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body?.repo_path || !body?.project_name) return json(c, { error: "repo_path and project_name required" }, 400)

  const { captureCodeEvents } = await import("../../brain/events")
  if (!body.model) return json(c, { error: "model required (e.g. 'anthropic:claude-haiku-4-5')" }, 400)

  const result = await captureCodeEvents(body.repo_path, body.project_name, body.model as never, body.days ?? 30, body.source_id ?? "default")
  return json(c, result)
})

// GET /brain/files
BrainRoutes.get("/files", async (c) => {
  const brainDir = c.req.query("brain_dir") ?? join(BRAIN_DIR, ".brain")

  function buildTree(dir: string, depth = 0): unknown[] {
    if (depth > 4 || !existsSync(dir)) return []
    const entries = readdirSync(dir).filter((e) => !e.startsWith(".")).sort()
    return entries.map((entry) => {
      const full = join(dir, entry)
      const isDir = statSync(full).isDirectory()
      if (isDir) {
        return { name: entry, path: full.replace(brainDir + "/", ""), type: "dir", children: buildTree(full, depth + 1) }
      }
      if (!entry.endsWith(".md")) return null
      let fm_type = "", fm_title = ""
      try {
        const raw = readFileSync(full, "utf8").slice(0, 600)
        if (raw.startsWith("---")) {
          const m = raw.match(/\ntype:\s*(.+)/)
          const t = raw.match(/\ntitle:\s*(.+)/)
          if (m) fm_type  = m[1].trim()
          if (t) fm_title = t[1].trim().replace(/^["']|["']$/g, "")
        }
      } catch {}
      return { name: entry, path: full.replace(brainDir + "/", ""), type: "file", fm_type, fm_title }
    }).filter(Boolean)
  }

  const tree  = buildTree(brainDir)
  const total = JSON.stringify(tree).match(/"type":"file"/g)?.length ?? 0
  return json(c, { tree, total, brain_dir: brainDir })
})

// POST /brain/sync — bulk receive brain files from MCP on shutdown or manual sync
BrainRoutes.post("/sync", async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body?.files || !Array.isArray(body.files)) return json(c, { error: "files array required" }, 400)

  const sourceId  = body.source_id ?? "default"
  const projectId = body.project_id as string | undefined

  let synced  = 0
  let skipped = 0
  const errors: string[] = []

  for (const f of body.files as Array<{ path: string; content: string; modified_at?: number }>) {
    if (!f.path || !f.content) { skipped++; continue }
    try {
      const layerMatch = f.path.match(/^L([012])\//)
      const layer = layerMatch ? parseInt(layerMatch[1]) as 0 | 1 | 2 : 0
      const slug  = f.path.replace(/\.md$/, "")
      await captureToBrain({
        content:  f.content,
        slug,
        layer,
        source_id: sourceId,
        contribution_type: "capture",
      })
      synced++
    } catch (e) {
      errors.push(f.path)
    }
  }

  // If project_id provided, update last_synced_at on the project
  if (projectId) {
    try {
      const { Database } = await import("../../storage/db")
      Database.use((db) => {
        db.run(`UPDATE local_project SET last_synced_at = ${Date.now()} WHERE id = '${projectId}'`)
      })
    } catch {}
  }

  return json(c, { synced, skipped, errors })
})

// GET /brain/export?source_id=xxx&project_id=xxx
// Returns all brain pages for a source/project so the CLI can pull them locally
BrainRoutes.get("/export", async (c) => {
  const sourceId  = c.req.query("source_id")
  const projectId = c.req.query("project_id")

  const db = brainDb()

  let rows: Array<{ slug: string; layer: number; type: string; compiled_truth: string | null; frontmatter: Record<string, unknown>; updated_at: Date }>

  if (sourceId) {
    rows = await db`
      SELECT slug, layer, type, compiled_truth, frontmatter, updated_at
      FROM brain_pages
      WHERE source_id = ${sourceId} AND deleted_at IS NULL
      ORDER BY layer, slug
    ` as typeof rows
  } else if (projectId) {
    // Look up source_id from local_project table then export
    try {
      const { Database } = await import("../../storage/db")
      const project = Database.use((db) => db.query("SELECT source_id FROM local_project WHERE id = ?").get(projectId)) as { source_id: string } | undefined
      if (!project) return json(c, { error: "project not found" }, 404)
      rows = await db`
        SELECT slug, layer, type, compiled_truth, frontmatter, updated_at
        FROM brain_pages
        WHERE source_id = ${project.source_id} AND deleted_at IS NULL
        ORDER BY layer, slug
      ` as typeof rows
    } catch (e) {
      return json(c, { error: String(e) }, 500)
    }
  } else {
    return json(c, { error: "source_id or project_id required" }, 400)
  }

  // Reconstruct markdown with frontmatter
  const files = rows.map((row) => {
    const fm = row.frontmatter as Record<string, unknown> ?? {}
    const fmLines = [
      "---",
      `type: ${row.type}`,
      `layer: ${row.layer}`,
      ...(fm.query ? [`query: "${String(fm.query).replace(/"/g, '\\"')}"`] : []),
      "---",
      "",
    ]
    const content = fmLines.join("\n") + (row.compiled_truth ?? "") + "\n"
    return {
      path:        `L${row.layer}/${row.slug.replace(/^L[012]\//, "")}.md`,
      content,
      updated_at:  row.updated_at instanceof Date ? row.updated_at.getTime() : Date.now(),
    }
  })

  return json(c, { files, total: files.length })
})
