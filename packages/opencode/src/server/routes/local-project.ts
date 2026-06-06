// Routes for registering and managing local projects (code that lives on the user's Mac)
// These projects are NOT cloned by supadense — they already exist locally.
//
// Workflow:
//   1. User registers their local project path
//   2. Supadense creates .brain/ and .brain-sources/ inside it
//   3. User configures Claude Code MCP with SUPADENSE_PROJECT=project-id
//   4. Brain tools in Claude Code sessions scope to this project's brain

import { Hono }                         from "hono"
import { existsSync, mkdirSync,
         writeFileSync, readdirSync,
         statSync }                      from "node:fs"
import { join, basename }                from "node:path"
import { Database }                      from "../../storage/db"
import { LocalProjectTable }             from "../../project/local-project.sql"
import { eq, and }                       from "drizzle-orm"
import { initialSync }                   from "../../brain/watcher"
import { startBrainWatcher }             from "../../brain/watcher"
import { setBrainSessionCtx }            from "../../brain/session-context"
import { brainSearch }                   from "../../brain/search/hybrid"
import { captureToBrain }                from "../../brain/capture"

function json(c: { json: Function }, data: unknown, status = 200) {
  return c.json(data, status as 200)
}

function getUserId(c: { get: Function }): string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (c as any).get?.("userId") as string ?? null
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50)
}

function initBrainDirs(localPath: string): { brainDir: string; sourcesDir: string } {
  const brainDir   = join(localPath, ".supadense", "brain")
  const sourcesDir = join(localPath, ".supadense", "sources")

  mkdirSync(join(brainDir, "L0"), { recursive: true })
  mkdirSync(join(brainDir, "L1"), { recursive: true })
  mkdirSync(join(brainDir, "L2"), { recursive: true })
  mkdirSync(sourcesDir,           { recursive: true })

  const readme = join(brainDir, "README.md")
  if (!existsSync(readme)) {
    writeFileSync(readme, [
      "# Brain Knowledge",
      "",
      "Knowledge captured during Claude Code sessions on this project.",
      "- `L0/` — decisions, raw notes, facts",
      "- `L1/` — synthesised summaries",
      "- `L2/` — durable patterns",
      "",
      "Committed to git alongside the code.",
    ].join("\n"), "utf8")
  }

  return { brainDir, sourcesDir }
}

export const LocalProjectRoutes = new Hono()

// ── Register a local project ───────────────────────────────────────────────

// POST /local-projects
// Register a local project path — creates .brain/ inside it
LocalProjectRoutes.post("/", async (c) => {
  const userId = getUserId(c)
  if (!userId) return json(c, { error: "Not authenticated" }, 401)

  const body = await c.req.json().catch(() => null) as {
    name:       string
    local_path: string
  } | null

  if (!body?.name || !body?.local_path) {
    return json(c, { error: "name and local_path required" }, 400)
  }

  // NOTE: local_path is on the user's Mac — container cannot validate it.
  // Path validation and .brain/ creation happen in the stdio bridge on the host.

  const id       = slugify(body.name) || slugify(basename(body.local_path))
  const sourceId = `local-${id}`
  const now      = Date.now()

  // brainDir and sourcesDir are on the user's Mac.
  // The stdio bridge creates these dirs locally when first used.
  const brainDir   = join(body.local_path, ".supadense", "brain")
  const sourcesDir = join(body.local_path, ".supadense", "sources")

  // Upsert in SQLite
  const db = Database.use((db) => db)
  db.insert(LocalProjectTable).values({
    id,
    user_id:     userId,
    name:        body.name,
    local_path:  body.local_path,
    brain_dir:   brainDir,
    sources_dir: sourcesDir,
    source_id:   sourceId,
    time_created: now,
    time_updated: now,
  }).onConflictDoUpdate({
    target: LocalProjectTable.id,
    set: { local_path: body.local_path, brain_dir: brainDir, sources_dir: sourcesDir, time_updated: now },
  }).run()

  // Note: initialSync and watcher happen on the host via stdio bridge,
  // not from the container (no access to host filesystem).

  return json(c, {
    id,
    name:        body.name,
    local_path:  body.local_path,
    brain_dir:   brainDir,
    sources_dir: sourcesDir,
    source_id:   sourceId,
    claude_code_config: {
      mcpServers: {
        "supadense-brain": {
          command: "bun",
          args:    ["run", "/path/to/supadense/packages/opencode/src/brain/mcp/stdio.ts"],
          env:     {
            SUPADENSE_URL:     "http://localhost:4096",
            SUPADENSE_TOKEN:   "YOUR_JWT_TOKEN",
            SUPADENSE_PROJECT: id,
          },
        },
      },
    },
  })
})

// GET /local-projects
// List registered local projects for user
LocalProjectRoutes.get("/", (c) => {
  const userId = getUserId(c)
  if (!userId) return json(c, { error: "Not authenticated" }, 401)

  const db      = Database.use((db) => db)
  const projects = db.select().from(LocalProjectTable)
    .where(eq(LocalProjectTable.user_id, userId))
    .all()

  return json(c, { projects, total: projects.length })
})

// GET /local-projects/:id
LocalProjectRoutes.get("/:id", (c) => {
  const userId = getUserId(c)
  const id     = c.req.param("id")
  if (!userId) return json(c, { error: "Not authenticated" }, 401)

  const db  = Database.use((db) => db)
  const row = db.select().from(LocalProjectTable)
    .where(and(eq(LocalProjectTable.id, id), eq(LocalProjectTable.user_id, userId)))
    .get()

  if (!row) return json(c, { error: "Not found" }, 404)

  // List .brain files
  const brainFiles: string[] = []
  for (const layer of ["L0", "L1", "L2"]) {
    const dir = join(row.brain_dir, layer)
    if (existsSync(dir)) {
      for (const f of readdirSync(dir, { recursive: true }) as string[]) {
        if (f.endsWith(".md")) brainFiles.push(`${layer}/${f}`)
      }
    }
  }

  return json(c, { ...row, brain_files: brainFiles })
})

// DELETE /local-projects/:id
// Unregister project (does NOT delete .brain/ files)
LocalProjectRoutes.delete("/:id", (c) => {
  const userId = getUserId(c)
  const id     = c.req.param("id")
  if (!userId) return json(c, { error: "Not authenticated" }, 401)

  const db = Database.use((db) => db)
  db.delete(LocalProjectTable)
    .where(and(eq(LocalProjectTable.id, id), eq(LocalProjectTable.user_id, userId)))
    .run()

  return json(c, { deleted: true, note: ".brain/ files on disk are preserved" })
})

// ── Session start for local project ───────────────────────────────────────

// POST /local-projects/:id/session-start
// Called by stdio bridge on session open — registers brain context
LocalProjectRoutes.post("/:id/session-start", async (c) => {
  const userId = getUserId(c)
  const id     = c.req.param("id")
  const body   = await c.req.json().catch(() => ({})) as { session_id?: string }

  if (!userId) return json(c, { error: "Not authenticated" }, 401)
  if (!body.session_id) return json(c, { error: "session_id required" }, 400)

  const db  = Database.use((db) => db)
  const row = db.select().from(LocalProjectTable)
    .where(and(eq(LocalProjectTable.id, id), eq(LocalProjectTable.user_id, userId)))
    .get()

  if (!row) return json(c, { error: "Local project not found. Register it first." }, 404)

  setBrainSessionCtx(body.session_id, {
    brainDir:  row.brain_dir,
    sourceId:  row.source_id,
    projectId: row.id,
  })

  // Ensure watcher is running
  if (existsSync(row.brain_dir)) {
    await startBrainWatcher(row.brain_dir, row.source_id)
  }

  return json(c, {
    ok:        true,
    project:   row.name,
    brain_dir: row.brain_dir,
    source_id: row.source_id,
  })
})

// ── Brain search scoped to project ────────────────────────────────────────

// GET /local-projects/:id/brain/search?query=...
LocalProjectRoutes.get("/:id/brain/search", async (c) => {
  const id    = c.req.param("id")
  const query = c.req.query("query") ?? ""
  if (!query) return json(c, { error: "query required" }, 400)

  const userId = getUserId(c)
  if (!userId) return json(c, { error: "Not authenticated" }, 401)

  const db  = Database.use((db) => db)
  const row = db.select().from(LocalProjectTable)
    .where(and(eq(LocalProjectTable.id, id), eq(LocalProjectTable.user_id, userId)))
    .get()

  if (!row) return json(c, { error: "Not found" }, 404)

  const result = await brainSearch(query, { source_id: row.source_id, limit: 10 })
  return json(c, result)
})

// ── Sources for local project ──────────────────────────────────────────────

// POST /local-projects/:id/sources
LocalProjectRoutes.post("/:id/sources", async (c) => {
  const userId = getUserId(c)
  const id     = c.req.param("id")
  if (!userId) return json(c, { error: "Not authenticated" }, 401)

  const db  = Database.use((db) => db)
  const row = db.select().from(LocalProjectTable)
    .where(and(eq(LocalProjectTable.id, id), eq(LocalProjectTable.user_id, userId)))
    .get()

  if (!row) return json(c, { error: "Not found" }, 404)

  mkdirSync(row.sources_dir, { recursive: true })

  const body = await c.req.json().catch(() => ({})) as {
    type?:    string
    content?: string
    title?:   string
    url?:     string
  }

  if (!body.content && !body.url) return json(c, { error: "content or url required" }, 400)

  const { createHash } = await import("node:crypto")

  if (body.url) {
    const res   = await fetch(body.url).catch(() => null)
    const text  = res ? await res.text() : ""
    const hash  = createHash("sha256").update(body.url).digest("hex").slice(0, 8)
    const fname = `url-${hash}.md`
    writeFileSync(join(row.sources_dir, fname),
      `# ${body.title ?? body.url}\nSource: ${body.url}\n\n${text.slice(0, 50000)}`, "utf8")
    await captureToBrain({
      content:   `# ${body.title ?? body.url}\n\n${body.url}\n\n${text.slice(0, 5000)}`,
      slug:      `L0/sources/url-${hash}`,
      layer:     0,
      source_id: row.source_id,
    })
    return json(c, { saved: fname, type: "url" })
  }

  if (body.content) {
    const hash  = createHash("sha256").update(body.content).digest("hex").slice(0, 8)
    const fname = `${body.type ?? "note"}-${hash}.md`
    writeFileSync(join(row.sources_dir, fname),
      `# ${body.title ?? "Note"}\n\n${body.content}`, "utf8")
    await captureToBrain({
      content:   body.content,
      slug:      `L0/sources/${body.type ?? "note"}-${hash}`,
      layer:     0,
      source_id: row.source_id,
    })
    return json(c, { saved: fname, type: body.type ?? "text" })
  }

  return json(c, { error: "No content to save" }, 400)
})

// GET /local-projects/:id/sources
LocalProjectRoutes.get("/:id/sources", (c) => {
  const userId = getUserId(c)
  const id     = c.req.param("id")
  if (!userId) return json(c, { error: "Not authenticated" }, 401)

  const db  = Database.use((db) => db)
  const row = db.select().from(LocalProjectTable)
    .where(and(eq(LocalProjectTable.id, id), eq(LocalProjectTable.user_id, userId)))
    .get()

  if (!row) return json(c, { error: "Not found" }, 404)
  if (!existsSync(row.sources_dir)) return json(c, { sources: [] })

  const files = readdirSync(row.sources_dir).map(f => ({
    name: f,
    size: statSync(join(row.sources_dir, f)).size,
  }))
  return json(c, { sources: files, total: files.length })
})
