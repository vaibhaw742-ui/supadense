// Routes for per-project brain + sources
// Registered as: app.route("/brain-project", BrainProjectRoutes)

import { Hono }                       from "hono"
import { existsSync, readdirSync,
         statSync, writeFileSync,
         mkdirSync }                   from "node:fs"
import { join, extname }               from "node:path"
import { createHash }                  from "node:crypto"
import {
  initElProjectDirs,
  elProjectDir,
}                                      from "../../experiential/project-structure"
import { captureToBrain }              from "../../brain/capture"
import { brainSearch }                 from "../../brain/search/hybrid"
import { startBrainWatcher, initialSync } from "../../brain/watcher"
import { setBrainSessionCtx }          from "../../brain/session-context"
import { userWorkspaceDir }            from "../../util/workspace-provision"

function json(c: { json: Function }, data: unknown, status = 200) {
  return c.json(data, status as 200)
}

function getUserId(c: { get: Function }): string | null {
  return (c as { get: Function }).get?.("userId") as string ?? null
}

export const BrainProjectRoutes = new Hono()

// ── EL Project: init brain + sources dirs ─────────────────────────────────────

// POST /brain-project/projects/:projectId/init
BrainProjectRoutes.post("/projects/:projectId/init", async (c) => {
  const userId    = getUserId(c)
  const projectId = c.req.param("projectId")
  if (!userId) return json(c, { error: "Not authenticated" }, 401)

  const paths = initElProjectDirs(userId, projectId)
  await initialSync(paths.brain, projectId)
  await startBrainWatcher(paths.brain, projectId)

  return json(c, {
    project_id:   projectId,
    brain_dir:    paths.brain,
    sources_dir:  paths.sources,
    source_id:    paths.sourceId,
  })
})

// POST /brain-project/projects/:projectId/session-start
BrainProjectRoutes.post("/projects/:projectId/session-start", async (c) => {
  const userId    = getUserId(c)
  const projectId = c.req.param("projectId")
  const body      = await c.req.json().catch(() => ({})) as { session_id?: string }
  if (!userId || !body.session_id) return json(c, { error: "userId and session_id required" }, 400)

  const brainDir = join(elProjectDir(userId, projectId), ".supadense", "brain")
  if (!existsSync(brainDir)) {
    initElProjectDirs(userId, projectId)
  }

  setBrainSessionCtx(body.session_id, {
    brainDir,
    sourceId:  projectId,
    projectId,
  })

  await startBrainWatcher(brainDir, projectId)

  return json(c, { ok: true, brain_dir: brainDir, source_id: projectId })
})

// POST /brain-project/projects/:projectId/sources
BrainProjectRoutes.post("/projects/:projectId/sources", async (c) => {
  const userId    = getUserId(c)
  const projectId = c.req.param("projectId")
  if (!userId) return json(c, { error: "Not authenticated" }, 401)

  const contentType = c.req.header("content-type") ?? ""
  const sourcesDir  = join(elProjectDir(userId, projectId), ".supadense", "sources")
  mkdirSync(sourcesDir, { recursive: true })

  if (contentType.includes("application/json")) {
    const body = await c.req.json() as { type: string; url?: string; content?: string; title?: string }

    if (body.type === "url" && body.url) {
      const res     = await fetch(body.url).catch(() => null)
      const text    = res ? await res.text() : ""
      const hash    = createHash("sha256").update(body.url).digest("hex").slice(0, 8)
      const fname   = `url-${hash}.md`
      writeFileSync(join(sourcesDir, fname), `# ${body.title ?? body.url}\nSource: ${body.url}\n\n${text.slice(0, 50000)}`, "utf8")
      await captureToBrain({ content: `# ${body.title ?? body.url}\n\n${body.url}\n\n${text.slice(0, 5000)}`, slug: `L0/sources/url-${hash}`, layer: 0, source_id: projectId })
      return json(c, { saved: fname, type: "url" })
    }

    if (body.type === "text" && body.content) {
      const hash  = createHash("sha256").update(body.content).digest("hex").slice(0, 8)
      const fname = `note-${hash}.md`
      writeFileSync(join(sourcesDir, fname), `# ${body.title ?? "Note"}\n\n${body.content}`, "utf8")
      await captureToBrain({ content: body.content, slug: `L0/sources/note-${hash}`, layer: 0, source_id: projectId })
      return json(c, { saved: fname, type: "text" })
    }

    return json(c, { error: "type must be 'url' or 'text'" }, 400)
  }

  // Binary upload
  const buffer   = await c.req.arrayBuffer()
  const bytes    = new Uint8Array(buffer)
  const hash     = createHash("sha256").update(bytes).digest("hex").slice(0, 8)
  const ext      = contentType.includes("pdf") ? ".pdf" : contentType.includes("image") ? ".img" : ".bin"
  const fname    = `file-${hash}${ext}`
  const { writeFileSync: wf } = await import("node:fs")
  wf(join(sourcesDir, fname), Buffer.from(bytes))

  return json(c, { saved: fname, type: "file", size: bytes.length })
})

// GET /brain-project/projects/:projectId/sources
BrainProjectRoutes.get("/projects/:projectId/sources", async (c) => {
  const userId    = getUserId(c)
  const projectId = c.req.param("projectId")
  if (!userId) return json(c, { error: "Not authenticated" }, 401)

  const sourcesDir = join(elProjectDir(userId, projectId), ".supadense", "sources")
  if (!existsSync(sourcesDir)) return json(c, { sources: [] })

  const files = readdirSync(sourcesDir).map(f => ({
    name: f,
    size: statSync(join(sourcesDir, f)).size,
    ext:  extname(f),
  }))
  return json(c, { sources: files, total: files.length })
})

// GET /brain-project/projects/:projectId/brain/search
BrainProjectRoutes.get("/projects/:projectId/brain/search", async (c) => {
  const projectId = c.req.param("projectId")
  const query     = c.req.query("query") ?? ""
  if (!query) return json(c, { error: "query required" }, 400)

  const result = await brainSearch(query, { source_id: projectId, limit: 10 })
  return json(c, result)
})
