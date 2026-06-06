/**
 * wiki.ts — HTTP API routes for the KB wiki site
 * Served under /wiki/* in the instance router.
 */
import { Hono } from "hono"
import { readFileSync, existsSync, readdirSync, unlinkSync } from "fs"
import path from "path"
import { eq, desc, inArray, isNotNull, and } from "drizzle-orm"
import { Instance } from "../../project/instance"
import { Workspace } from "../../learning/workspace"
import { Retrieval } from "../../learning/retrieval"
import { Database } from "../../storage/db"
import {
  LearningResourceTable,
} from "../../learning/schema.sql"
import { Auth } from "../../auth"
import { SessionStatus } from "../../session/status"
import { SessionTable, PartTable } from "../../session/session.sql"
import { Resource } from "../../learning/resource"
import { Session } from "../../session"
import { WikiBuilder } from "../../learning/wiki-builder"

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  const fm: Record<string, string> = {}
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":")
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const val = line.slice(colonIdx + 1).trim()
    if (key) fm[key] = val
  }
  return fm
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, "")
}

/** Resolve the KB workspace for the current request context. */
const wikiInitializedWorkspaces = new Set<string>()

function resolveWorkspace() {
  const project = Instance.project
  const workspace = Workspace.get(project.id) ?? Workspace.getByKbPath(Instance.directory)
  if (workspace && !wikiInitializedWorkspaces.has(workspace.id)) {
    wikiInitializedWorkspaces.add(workspace.id)
    Workspace.scaffoldFiles(workspace)
  }
  return workspace
}

export const WikiRoutes = () => {
  const app = new Hono()

  // ── Home ────────────────────────────────────────────────────────────────────
  // Returns workspace stats and recent events.
  app.get("/home", async (c) => {
    let workspace = resolveWorkspace()
    if (!workspace) {
      try {
        workspace = Workspace.ensure(Instance.project.id, Instance.directory)
        wikiInitializedWorkspaces.add(workspace.id)
        Workspace.scaffoldFiles(workspace)
      } catch {
        return c.json({
          workspace: { id: "", kb_path: "", learning_intent: null, kb_initialized: false, goals: [] },
          stats: { total_sources: 0, total_concepts: 0 },
          recent_events: [],
        })
      }
    }

    // Batch-heal resources stuck in "processing" that already have content
    // (either stored in a file or inline in the DB column — both mean capture succeeded).
    const stuckResources = Database.use((db) =>
      db.select({
        id: LearningResourceTable.id,
        raw_content_path: LearningResourceTable.raw_content_path,
        raw_content: LearningResourceTable.raw_content,
      })
        .from(LearningResourceTable)
        .where(and(
          eq(LearningResourceTable.workspace_id, workspace.id),
          eq(LearningResourceTable.status, "processing"),
        ))
        .all(),
    )
    if (stuckResources.length > 0) {
      const healedIds = stuckResources
        .filter((r) => {
          if (r.raw_content) return true // inline content
          if (r.raw_content_path) return existsSync(path.join(workspace.kb_path, r.raw_content_path))
          return false
        })
        .map((r) => r.id)
      if (healedIds.length > 0) {
        Database.use((db) =>
          db.update(LearningResourceTable)
            .set({ status: "done", time_updated: Date.now() })
            .where(and(
              eq(LearningResourceTable.workspace_id, workspace.id),
              inArray(LearningResourceTable.id, healedIds),
            ))
            .run(),
        )
      }
    }

    const resourceCount = Database.use((db) =>
      db.select().from(LearningResourceTable).where(eq(LearningResourceTable.workspace_id, workspace.id)).all(),
    ).length

    const conceptCount = 0

    return c.json({
      workspace: {
        id: workspace.id,
        kb_path: workspace.kb_path,
        learning_intent: workspace.learning_intent,
        kb_initialized: workspace.kb_initialized,
        goals: workspace.goals,
      },
      stats: {
        total_sources: resourceCount,
        total_concepts: conceptCount,
      },
      recent_events: [],
    })
  })

  // ── Concepts ─────────────────────────────────────────────────────────────────
  app.get("/concepts", async (c) => {
    return c.json([])
  })

  // ── Search ───────────────────────────────────────────────────────────────────
  app.get("/search", async (c) => {
    const workspace = resolveWorkspace()
    if (!workspace) return c.json({ locations: [], concepts: [], sources: [] })

    const q = c.req.query("q") ?? ""
    if (!q.trim()) return c.json({ locations: [], concepts: [], sources: [] })

    const result = Retrieval.searchWithContext(workspace.id, q, 10)
    return c.json(result)
  })

  // ── Resources ────────────────────────────────────────────────────────────────
  app.get("/resources", async (c) => {
    const workspace = resolveWorkspace()
    if (!workspace) return c.json([])
    const rows = Database.use((db) =>
      db.select({
        id: LearningResourceTable.id,
        title: LearningResourceTable.title,
        url: LearningResourceTable.url,
        author: LearningResourceTable.author,
        modality: LearningResourceTable.modality,
        status: LearningResourceTable.status,
        metadata: LearningResourceTable.metadata,
        time_created: LearningResourceTable.time_created,
      })
        .from(LearningResourceTable)
        .where(eq(LearningResourceTable.workspace_id, workspace.id))
        .orderBy(desc(LearningResourceTable.time_created))
        .all(),
    )
    return c.json(rows)
  })

  app.get("/resource/:id", async (c) => {
    const id = c.req.param("id")
    const workspace = resolveWorkspace()
    if (!workspace) return c.json({ error: "No workspace" }, 404)

    let resource = Database.use((db) =>
      db.select().from(LearningResourceTable)
        .where(and(eq(LearningResourceTable.id, id), eq(LearningResourceTable.workspace_id, workspace.id)))
        .get(),
    )
    if (!resource) return c.json({ error: "Not found" }, 404)

    // Auto-heal: if status is "processing" but content exists, mark done.
    // Fixes resources created before the setStatus("done") call was introduced.
    if (resource.status === "processing") {
      const hasInline = !!resource.raw_content
      const hasFile = resource.raw_content_path
        ? existsSync(path.join(workspace.kb_path, resource.raw_content_path))
        : false
      if (hasInline || hasFile) {
        Database.use((db) =>
          db.update(LearningResourceTable)
            .set({ status: "done", time_updated: Date.now() })
            .where(eq(LearningResourceTable.id, id))
            .run(),
        )
        resource = { ...resource, status: "done" }
      }
    }

    // Load raw content from file if stored on disk
    let content: string | null = resource.raw_content ?? null
    if (!content && resource.raw_content_path) {
      const fullPath = path.join(workspace.kb_path, resource.raw_content_path)
      if (existsSync(fullPath)) {
        content = readFileSync(fullPath, "utf-8")
      }
    }

    const asset_map: Record<string, { localPath: string; width?: number | null; height?: number | null }> = {}

    return c.json({
      id: resource.id,
      title: resource.title ?? null,
      url: resource.url ?? null,
      author: resource.author ?? null,
      modality: resource.modality,
      status: resource.status,
      content,
      metadata: resource.metadata ?? null,
      time_created: resource.time_created,
      asset_map,
    })
  })

  // ── Create a learn session for a resource ────────────────────────────────────
  app.post("/resource/:id/learn-session", async (c) => {
    const resourceId = c.req.param("id")
    const body = await c.req.json().catch(() => ({}))
    const question = body?.question as string | undefined
    const concept = body?.concept as string | undefined

    const resource = Resource.get(resourceId)
    if (!resource) return c.json({ error: "Resource not found" }, 404)

    const ws = resolveWorkspace()
    if (!ws) return c.json({ error: "No workspace" }, 500)

    const { Session } = await import("../../session")
    const rawContent = Resource.getRawContent(resource, ws.kb_path)

    const title = `Learn: ${resource.title ?? resource.url ?? "Resource"}`
    const sessionInfo = await Session.create({
      title,
      sessionType: "learn" as const,
      learnResourceId: resourceId,
    })

    return c.json({
      session_id: sessionInfo.id,
      resource_id: resourceId,
      resource_title: resource.title ?? resource.url,
      question: question ?? null,
      concept: concept ?? null,
      initial_context: rawContent?.slice(0, 8000) ?? null,
    })
  })

  // ── Roadmap list ────────────────────────────────────────────────────────────
  app.get("/roadmap", async (c) => {
    const ws = resolveWorkspace()
    if (!ws) return c.json({ docs: [] })
    const roadmapDir = path.join(ws.kb_path, "wiki", "roadmap")
    if (!existsSync(roadmapDir)) return c.json({ docs: [] })
    const files = readdirSync(roadmapDir).filter((f) => f.endsWith(".md"))
    const docs = files.map((file) => {
      const content = readFileSync(path.join(roadmapDir, file), "utf-8")
      const fm = parseFrontmatter(content)
      const slug = file.replace(/\.md$/, "")
      return { slug, title: fm.title ?? slug, type: fm.type ?? "roadmap", created: fm.created ?? null }
    })
    return c.json({ docs })
  })

  // ── Single roadmap doc ───────────────────────────────────────────────────────
  app.get("/roadmap/:slug", async (c) => {
    const slug = c.req.param("slug")
    if (!/^[a-zA-Z0-9_-]+$/.test(slug)) return c.text("Not found", 404)
    const ws = resolveWorkspace()
    if (!ws) return c.text("Not found", 404)
    const roadmapRoot = path.resolve(path.join(ws.kb_path, "wiki", "roadmap"))
    const filePath = path.resolve(path.join(roadmapRoot, `${slug}.md`))
    if (!filePath.startsWith(roadmapRoot)) return c.text("Not found", 404)
    if (!existsSync(filePath)) return c.text("Not found", 404)
    const content = readFileSync(filePath, "utf-8")
    const fm = parseFrontmatter(content)
    const body = stripFrontmatter(content)
    return c.json({ slug, title: fm.title ?? slug, type: fm.type ?? "roadmap", created: fm.created ?? null, content: body })
  })

  // ── Assets ───────────────────────────────────────────────────────────────────
  app.get("/assets/*", async (c) => {
    const relativePath = c.req.path.replace(/^.*\/assets\//, "")

    async function tryServe(kbPath: string): Promise<Response | null> {
      const assetsRoot = path.resolve(path.join(kbPath, "assets"))
      const fullPath = path.resolve(path.join(assetsRoot, relativePath))
      if (!fullPath.startsWith(assetsRoot)) return null
      if (!existsSync(fullPath)) return null
      const file = Bun.file(fullPath)
      const mime = file.type || "application/octet-stream"
      return new Response(await file.arrayBuffer(), {
        headers: { "Content-Type": mime, "Cache-Control": "public, max-age=86400" },
      })
    }

    let current: ReturnType<typeof resolveWorkspace> = undefined
    try {
      current = resolveWorkspace()
      if (current) {
        const res = await tryServe(current.kb_path)
        if (res) return res
      }
    } catch { /* no instance context — fall through to scan all */ }

    // Note: cross-workspace asset lookup removed (LearningKbWorkspaceTable dropped).

    return c.text("Not found", 404)
  })

  app.get("/proxy-image", async (c) => {
    const rawUrl = c.req.query("url")
    if (!rawUrl) return c.text("Missing url param", 400)
    const url = rawUrl.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')

    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return c.text("Invalid url", 400)
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return c.text("Only http/https allowed", 400)
    }

    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
          Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
      })
      if (!res.ok) return c.text("Upstream error", 502)

      const contentType = res.headers.get("content-type") ?? "image/jpeg"
      const buffer = await res.arrayBuffer()
      return new Response(buffer, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=86400",
        },
      })
    } catch {
      return c.text("Fetch failed", 502)
    }
  })

  // ── Direct resource add (bypasses AI command layer) ──────────────────────────
  app.post("/resource", async (c) => {
    let workspace: ReturnType<typeof resolveWorkspace>
    try {
      console.log("[capture] POST /wiki/resource hit, dir=", Instance.directory)
      workspace = resolveWorkspace()
      if (!workspace) {
        workspace = Workspace.ensure(Instance.project.id, Instance.directory)
        wikiInitializedWorkspaces.add(workspace.id)
        Workspace.scaffoldFiles(workspace)
      }
      console.log("[capture] workspace resolved, id=", workspace?.id)
    } catch (err) {
      console.error("[capture] workspace resolution failed:", err)
      return c.json({ error: "Could not resolve workspace" }, 500)
    }

    let body: { url?: string; session_id?: string }
    try { body = await c.req.json() } catch { return c.json({ error: "Invalid JSON" }, 400) }
    const url = body?.url?.trim()
    if (!url) return c.json({ error: "url required" }, 400)

    let existing: ReturnType<typeof Resource.getByUrl>
    try {
      existing = Resource.getByUrl(workspace.id, url)
    } catch (err) {
      console.error("[capture] getByUrl failed:", err)
      existing = undefined
    }
    if (existing && existing.status !== "pending") {
      return c.json({ resource_id: existing.id, duplicate: true })
    }

    let stub: ReturnType<typeof Resource.create>
    try {
      stub = existing ?? Resource.create({ workspace_id: workspace.id, modality: "url", url })
    } catch (err) {
      console.error("[capture] stub creation failed:", err)
      return c.json({ error: "Failed to create resource record" }, 500)
    }

    const captureWorkspaceId = workspace.id
    const stubId = stub.id

    void (async () => {
      try {
        const { KbResourceCreateTool } = await import("../../tool/learning/kb-resource-create")
        const toolDef = await KbResourceCreateTool.init()
        await toolDef.execute({ workspace_id: captureWorkspaceId, modality: "url", input: url }, {} as never)
      } catch (err) {
        console.error("[capture:bg] Failed for", url, err)
        try { Resource.setStatus(stubId, "failed", undefined, String(err instanceof Error ? err.message : err)) } catch {}
      }
    })()

    return c.json({ resource_id: stubId, status: "pending" })
  })

  // ── Retry failed resource ────────────────────────────────────────────────────
  app.post("/resource/:id/retry", async (c) => {
    const workspace = resolveWorkspace()
    if (!workspace) return c.json({ error: "No workspace" }, 404)

    const resourceId = c.req.param("id")
    const resource = Resource.get(resourceId)
    if (!resource) return c.json({ error: "Resource not found" }, 404)
    if (resource.workspace_id !== workspace.id) return c.json({ error: "Not found" }, 404)

    if (!resource.url) return c.json({ error: "Resource has no URL to retry" }, 400)

    Resource.setStatus(resourceId, "pending")

    void (async () => {
      try {
        const { KbResourceCreateTool } = await import("../../tool/learning/kb-resource-create")
        const toolDef = await KbResourceCreateTool.init()
        await toolDef.execute({ workspace_id: workspace.id, modality: "url", input: resource.url! }, {} as never)
      } catch (err) {
        console.error("[retry:bg] Failed for", resource.url, err)
        try { Resource.setStatus(resourceId, "failed", undefined, String(err instanceof Error ? err.message : err)) } catch {}
      }
    })()

    return c.json({ resource_id: resourceId, status: "pending" })
  })

  // ── Delete resource ──────────────────────────────────────────────────────────
  app.delete("/resource/:id", async (c) => {
    const workspace = resolveWorkspace()
    if (!workspace) return c.json({ error: "No workspace" }, 404)

    const resourceId = c.req.param("id")
    const resource = Resource.get(resourceId)
    if (!resource) return c.json({ error: "Resource not found" }, 404)
    if (resource.workspace_id !== workspace.id) return c.json({ error: "Not found" }, 404)

    const assets: { local_path: string }[] = []

    // Delete DB row — cascades resource_clusters
    Database.use((db) =>
      db.delete(LearningResourceTable)
        .where(eq(LearningResourceTable.id, resourceId))
        .run(),
    )

    // Clean up physical files (best-effort)
    if (resource.raw_content_path) {
      try { unlinkSync(path.join(workspace.kb_path, resource.raw_content_path)) } catch {}
    }
    for (const { local_path } of assets) {
      try { unlinkSync(path.join(workspace.kb_path, local_path)) } catch {}
    }

    return c.json({ ok: true })
  })

  // ── Graph data ───────────────────────────────────────────────────────────────
  app.get("/graph", async (c) => {
    const workspace = resolveWorkspace()
    if (!workspace) return c.json({ nodes: [], edges: [] })

    const resources = Database.use((db) =>
      db.select({
        id: LearningResourceTable.id,
        title: LearningResourceTable.title,
        url: LearningResourceTable.url,
        status: LearningResourceTable.status,
        modality: LearningResourceTable.modality,
      })
        .from(LearningResourceTable)
        .where(eq(LearningResourceTable.workspace_id, workspace.id))
        .all(),
    )

    const nodes = resources.map((r) => ({
      id: `res_${r.id}`,
      type: "resource" as const,
      label: r.title ?? r.url ?? r.id,
      status: r.status,
      resource_id: r.id,
      url: r.url ?? undefined,
    }))

    return c.json({ nodes, edges: [] })
  })

  // ── KB background jobs (curator sessions) ────────────────────────────────────
  app.get("/jobs", async (c) => {
    const busyMap = await SessionStatus.list()
    if (busyMap.size === 0) return c.json({ jobs: [] })

    const busyIds = [...busyMap.keys()]

    const rows = Database.use((db) =>
      db
        .select({ id: SessionTable.id, title: SessionTable.title, parent_id: SessionTable.parent_id })
        .from(SessionTable)
        .where(isNotNull(SessionTable.parent_id))
        .all(),
    ).filter((r) => busyIds.includes(r.id as any) && r.title.startsWith("KB:"))

    const jobs = rows.map((r) => {
      const recentParts = Database.use((db) =>
        db.select({ data: PartTable.data })
          .from(PartTable)
          .where(eq(PartTable.session_id, r.id as any))
          .orderBy(desc(PartTable.time_created))
          .limit(20)
          .all(),
      )
      const logs: string[] = []
      for (const p of recentParts) {
        const data = p.data as { type?: string; text?: string }
        if (data?.type === "text" && data.text?.trim()) {
          const line = data.text.trim().split("\n")[0]!.slice(0, 120)
          if (line) logs.push(line)
          if (logs.length >= 6) break
        }
      }

      return {
        sessionID: r.id,
        title: r.title.replace(/^KB:\s*/, ""),
        status: busyMap.get(r.id as any)?.type ?? "busy",
        logs: logs.reverse(),
      }
    })

    return c.json({ jobs })
  })

  // ── Activity feed ─────────────────────────────────────────────────────────────
  app.get("/activity", async (c) => {
    // LearningKbEventTable has been dropped — return empty activity feed.
    return c.json({ events: [] })
  })

  return app
}
