/**
 * el.ts — Experiential Learning API routes
 *
 * Prefix: /el
 *
 * Projects are the root entity. Each project gets a companion virtual
 * learning_kb_workspaces row so existing retrieval/concept machinery works.
 */
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { eq, and, inArray, desc } from "drizzle-orm"
import { ulid } from "ulid"
import { mkdirSync, existsSync, writeFileSync } from "node:fs"
import path from "node:path"
import { lazy } from "../../util/lazy"
import { Database } from "../../storage/db"
import { ElProjectTable, ElProjectResourceTable } from "../../experiential/schema.sql"
import { LearningKbWorkspaceTable, LearningResourceTable, LearningConceptTable } from "../../learning/schema.sql"
import { SessionTable } from "../../session/session.sql"
import { Resource } from "../../learning/resource"
import { Retrieval } from "../../learning/retrieval"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getUserId(c: any): string | undefined {
  return (c as any).get("userId") as string | undefined
}

/** Derive resource modality and a clean label from a URL */
function classifyUrl(url: string): { modality: "url" | "pdf"; label: string } {
  try {
    const u = new URL(url)
    if (u.hostname.includes("arxiv.org")) return { modality: "pdf", label: "arxiv" }
    return { modality: "url", label: u.hostname.replace(/^www\./, "") }
  } catch {
    return { modality: "url", label: url.slice(0, 40) }
  }
}

/** Detect resource type from URL for display purposes */
function detectResourceType(url: string): "github" | "arxiv" | "url" {
  try {
    const u = new URL(url)
    if (u.hostname.includes("github.com")) return "github"
    if (u.hostname.includes("arxiv.org")) return "arxiv"
  } catch { /* ignore */ }
  return "url"
}

/** Parse owner/repo from a GitHub URL */
function parseGitHubRepo(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url)
    if (!u.hostname.includes("github.com")) return null
    const parts = u.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/")
    if (parts.length < 2) return null
    return { owner: parts[0], repo: parts[1] }
  } catch {
    return null
  }
}

/** Parse arxiv paper ID from URL or plain ID */
function parseArxivId(url: string): string | null {
  const match = url.match(/arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]+)/)
  if (match) return match[1]
  if (/^[0-9]{4}\.[0-9]+$/.test(url.trim())) return url.trim()
  return null
}

/**
 * Fetch GitHub repo metadata and update the resource row.
 * Runs fire-and-forget after resource creation.
 */
async function analyzeGitHubResource(resourceId: string, url: string): Promise<void> {
  const parsed = parseGitHubRepo(url)
  if (!parsed) return

  try {
    const res = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, {
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    })
    if (!res.ok) {
      Database.use((db) =>
        db.update(LearningResourceTable)
          .set({ status: "failed", error: `GitHub API ${res.status}`, time_updated: Date.now() })
          .where(eq(LearningResourceTable.id, resourceId))
          .run(),
      )
      return
    }

    const data = await res.json() as Record<string, any>

    // Fetch README for a richer summary
    let readme = ""
    try {
      const readmeRes = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/readme`, {
        headers: { Accept: "application/vnd.github.raw+json", "X-GitHub-Api-Version": "2022-11-28" },
      })
      if (readmeRes.ok) readme = (await readmeRes.text()).slice(0, 3000)
    } catch { /* readme optional */ }

    const metadata = {
      type: "github",
      full_name: data.full_name,
      description: data.description ?? "",
      stars: data.stargazers_count ?? 0,
      language: data.language ?? "",
      topics: data.topics ?? [],
      default_branch: data.default_branch ?? "main",
      readme_preview: readme,
    }

    Database.use((db) =>
      db.update(LearningResourceTable)
        .set({
          title: data.full_name,
          summary: data.description ?? "",
          metadata,
          status: "done",
          time_updated: Date.now(),
        })
        .where(eq(LearningResourceTable.id, resourceId))
        .run(),
    )

    // Refresh CLAUDE.md now that metadata is populated
    const joinRow = Database.use((db) =>
      db.select().from(ElProjectResourceTable)
        .where(eq(ElProjectResourceTable.resource_id, resourceId))
        .get(),
    )
    if (joinRow) refreshClaudeMd(joinRow.project_id)
  } catch (err) {
    Database.use((db) =>
      db.update(LearningResourceTable)
        .set({ status: "failed", error: String(err), time_updated: Date.now() })
        .where(eq(LearningResourceTable.id, resourceId))
        .run(),
    )
  }
}

/**
 * Fetch arxiv paper metadata and update the resource row.
 */
async function analyzeArxivResource(resourceId: string, url: string): Promise<void> {
  const paperId = parseArxivId(url)
  if (!paperId) return

  try {
    const res = await fetch(`https://export.arxiv.org/api/query?id_list=${paperId}`)
    if (!res.ok) {
      Database.use((db) =>
        db.update(LearningResourceTable)
          .set({ status: "failed", error: `arxiv API ${res.status}`, time_updated: Date.now() })
          .where(eq(LearningResourceTable.id, resourceId))
          .run(),
      )
      return
    }

    const xml = await res.text()

    const title = xml.match(/<title>(?!ArXiv)([^<]+)<\/title>/)?.[1]?.trim() ?? ""
    const abstract = xml.match(/<summary>([^<]+)<\/summary>/)?.[1]?.trim() ?? ""
    const authors = [...xml.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1]).join(", ")
    const published = xml.match(/<published>([^<]+)<\/published>/)?.[1] ?? ""

    const metadata = {
      type: "arxiv",
      paper_id: paperId,
      authors,
      published_at: published,
    }

    Database.use((db) =>
      db.update(LearningResourceTable)
        .set({
          title,
          author: authors,
          summary: abstract.slice(0, 500),
          metadata,
          status: "done",
          published_at: published ? new Date(published).getTime() : undefined,
          time_updated: Date.now(),
        })
        .where(eq(LearningResourceTable.id, resourceId))
        .run(),
    )

    // Refresh CLAUDE.md now that metadata is populated
    const joinRow = Database.use((db) =>
      db.select().from(ElProjectResourceTable)
        .where(eq(ElProjectResourceTable.resource_id, resourceId))
        .get(),
    )
    if (joinRow) refreshClaudeMd(joinRow.project_id)
  } catch (err) {
    Database.use((db) =>
      db.update(LearningResourceTable)
        .set({ status: "failed", error: String(err), time_updated: Date.now() })
        .where(eq(LearningResourceTable.id, resourceId))
        .run(),
    )
  }
}

/**
 * Create (or reuse) the virtual learning_kb_workspaces row for an EL project.
 * This gives EL resources a valid workspace_id so the retrieval system works.
 */
function ensureVirtualWorkspace(projectId: string): string {
  const virtualProjectId = `el-${projectId}`
  const existing = Database.use((db) =>
    db.select().from(LearningKbWorkspaceTable)
      .where(eq(LearningKbWorkspaceTable.project_id, virtualProjectId))
      .get(),
  )
  if (existing) return existing.id

  const now = Date.now()
  const id = ulid()
  Database.use((db) =>
    db.insert(LearningKbWorkspaceTable).values({
      id,
      project_id: virtualProjectId,
      kb_path: `/el-virtual/${projectId}`,
      kb_initialized: false,
      goals: [],
      gaps: [],
      depth_prefs: {},
      trusted_sources: [],
      scout_platforms: [],
      extra_folders: [],
      time_created: now,
      time_updated: now,
    }).run(),
  )
  return id
}

/**
 * Add a resource to a project: creates learning_resources row + join row,
 * kicks off background analysis.
 */
function addResourceToProject(projectId: string, url: string, role: "primary" | "supplementary" = "primary") {
  const workspaceId = ensureVirtualWorkspace(projectId)
  const { modality } = classifyUrl(url)
  const resourceType = detectResourceType(url)

  const resource = Resource.create({
    workspace_id: workspaceId,
    modality,
    url,
    metadata: { type: resourceType },
  })

  // Update status to processing immediately
  Database.use((db) =>
    db.update(LearningResourceTable)
      .set({ status: "processing", time_updated: Date.now() })
      .where(eq(LearningResourceTable.id, resource.id))
      .run(),
  )

  const now = Date.now()
  Database.use((db) =>
    db.insert(ElProjectResourceTable).values({
      id: ulid(),
      project_id: projectId,
      resource_id: resource.id,
      role,
      time_created: now,
      time_updated: now,
    }).run(),
  )

  // Fire-and-forget analysis (GitHub/arxiv will call refreshClaudeMd when done)
  if (resourceType === "github") {
    void analyzeGitHubResource(resource.id, url)
  } else if (resourceType === "arxiv") {
    void analyzeArxivResource(resource.id, url)
  } else {
    // Generic URL — mark done immediately, then refresh
    Database.use((db) =>
      db.update(LearningResourceTable)
        .set({ status: "done", time_updated: Date.now() })
        .where(eq(LearningResourceTable.id, resource.id))
        .run(),
    )
    refreshClaudeMd(projectId)
  }

  // Write initial CLAUDE.md immediately (resource may still be processing, but good to have)
  refreshClaudeMd(projectId)

  return resource
}

// ─── Graph Builder ────────────────────────────────────────────────────────────

function buildProjectGraph(projectId: string, projectName: string) {
  type NodeType = "project" | "resource" | "concept" | "category"
  const nodes: Array<{ id: string; type: NodeType; label: string; url?: string; resource_id?: string; status?: string }> = []
  const edges: Array<{ source: string; target: string }> = []
  const seenEdges = new Set<string>()

  const addEdge = (source: string, target: string) => {
    const key = `${source}→${target}`
    if (seenEdges.has(key)) return
    seenEdges.add(key)
    edges.push({ source, target })
  }

  // Project node (root)
  nodes.push({ id: `proj_${projectId}`, type: "project", label: projectName })

  // Resource nodes
  const joinRows = Database.use((db) =>
    db.select().from(ElProjectResourceTable)
      .where(eq(ElProjectResourceTable.project_id, projectId))
      .all(),
  )

  if (joinRows.length === 0) return { nodes, edges }

  const resourceIds = joinRows.map((r) => r.resource_id)
  const resources = Database.use((db) =>
    db.select().from(LearningResourceTable)
      .where(inArray(LearningResourceTable.id, resourceIds))
      .all(),
  )

  for (const res of resources) {
    let label = "Source"
    if (res.title) {
      label = res.title.split(" ").slice(0, 4).join(" ")
    } else if (res.url) {
      try { label = new URL(res.url).hostname.replace(/^www\./, "") } catch { /* ignore */ }
    }
    nodes.push({ id: `res_${res.id}`, type: "resource", label, url: res.url ?? undefined, resource_id: res.id, status: res.status })
    addEdge(`proj_${projectId}`, `res_${res.id}`)
  }

  // Concept nodes — via virtual workspace
  const virtualWsId = Database.use((db) =>
    db.select({ id: LearningKbWorkspaceTable.id }).from(LearningKbWorkspaceTable)
      .where(eq(LearningKbWorkspaceTable.project_id, `el-${projectId}`))
      .get(),
  )?.id

  if (virtualWsId) {
    const concepts = Database.use((db) =>
      db.select().from(LearningConceptTable)
        .where(eq(LearningConceptTable.workspace_id, virtualWsId))
        .all(),
    )
    for (const concept of concepts) {
      nodes.push({ id: `concept_${concept.id}`, type: "concept", label: concept.name })
      addEdge(`proj_${projectId}`, `concept_${concept.id}`)
    }
  }

  return { nodes, edges }
}

// ─── CLAUDE.md Generator ─────────────────────────────────────────────────────

function generateClaudeMd(
  project: { id: string; name: string; status: string; context_json: Record<string, string> | null },
  resources: Array<{ title: string | null; url: string | null; summary: string | null; status: string; metadata: Record<string, unknown> | null }>,
): string {
  const lines: string[] = [
    `# ${project.name}`,
    ``,
    `> **Experiential Learning Project** — status: ${project.status}`,
    ``,
    `## Resources`,
    ``,
  ]

  if (resources.length === 0) {
    lines.push("No resources added yet.\n")
  } else {
    for (const r of resources) {
      const meta = (r.metadata ?? {}) as Record<string, any>
      const type: string = meta.type ?? "url"
      const title = r.title ?? r.url ?? "Untitled"
      lines.push(`### ${title}`)
      lines.push(`- **Type:** ${type}`)
      if (r.url) lines.push(`- **URL:** ${r.url}`)
      if (r.status === "processing" || r.status === "pending") {
        lines.push(`- **Status:** Analysis in progress`)
      } else {
        if (r.summary) lines.push(`- **Summary:** ${r.summary}`)
        if (meta.language) lines.push(`- **Language:** ${meta.language}`)
        if (Array.isArray(meta.topics) && meta.topics.length > 0)
          lines.push(`- **Topics:** ${(meta.topics as string[]).join(", ")}`)
        if (meta.stars !== undefined) lines.push(`- **Stars:** ${meta.stars}`)
        if (meta.authors) lines.push(`- **Authors:** ${meta.authors}`)
        if (meta.published_at) lines.push(`- **Published:** ${meta.published_at}`)
      }
      lines.push("")
    }
  }

  const ctx = project.context_json ?? {}
  const ctxKeys = Object.keys(ctx)
  if (ctxKeys.length > 0) {
    lines.push("## Learner Context")
    lines.push("")
    for (const key of ctxKeys) lines.push(`- **${key}:** ${ctx[key]}`)
    lines.push("")
  }

  lines.push(
    "## Your Role",
    "",
    "You are an **Experiential Learning assistant** for this project.",
    "Your job is to help the user deeply understand the resources above through conversation, questions, and guided exploration.",
    "",
    "**When the user sends their very first message in a new session**, do ALL of the following in order:",
    "1. Briefly introduce yourself as their learning assistant for this project.",
    "2. Give a 2–3 sentence summary of the resources.",
    "3. Ask these **5 onboarding questions one at a time** (wait for each answer before asking the next):",
    "   1. What are you building or trying to create with these resources?",
    "   2. Who are the users or audience for what you're building?",
    "   3. What is your current tech stack or implementation approach?",
    "   4. What concepts or parts feel unclear or uncertain to you right now?",
    "   5. What is your primary learning goal for this session?",
    "",
    "After onboarding, tailor all responses to the user's stated goals and knowledge gaps.",
    "When you encounter a concept worth adding to the project knowledge base, ask the user first before linking it.",
    "",
  )

  return lines.join("\n")
}

/**
 * Write (or overwrite) CLAUDE.md in the project directory.
 * No-ops silently if the directory hasn't been provisioned yet.
 */
function refreshClaudeMd(projectId: string): void {
  try {
    const project = Database.use((db) =>
      db.select().from(ElProjectTable).where(eq(ElProjectTable.id, projectId)).get(),
    )
    if (!project) return

    const virtualWs = Database.use((db) =>
      db.select().from(LearningKbWorkspaceTable)
        .where(eq(LearningKbWorkspaceTable.project_id, `el-${projectId}`))
        .get(),
    )
    const dir = virtualWs?.kb_path
    if (!dir || dir.startsWith("/el-virtual/") || !existsSync(dir)) return

    const joinRows = Database.use((db) =>
      db.select().from(ElProjectResourceTable)
        .where(eq(ElProjectResourceTable.project_id, projectId))
        .all(),
    )
    const resources = joinRows.length === 0 ? [] : Database.use((db) =>
      db.select().from(LearningResourceTable)
        .where(inArray(LearningResourceTable.id, joinRows.map((r) => r.resource_id)))
        .all(),
    )

    writeFileSync(path.join(dir, "CLAUDE.md"), generateClaudeMd(project, resources), "utf8")
  } catch { /* best-effort — never crash the request */ }
}

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

const ProjectOut = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  context_json: z.record(z.string(), z.string()).nullable(),
  time_created: z.number(),
  resource_count: z.number().optional(),
})

const ResourceOut = z.object({
  join_id: z.string(),
  resource_id: z.string(),
  role: z.string(),
  url: z.string().nullable(),
  title: z.string().nullable(),
  status: z.string(),
  resource_type: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  time_created: z.number(),
})

// ─── Routes ──────────────────────────────────────────────────────────────────

export const ELRoutes = lazy(() =>
  new Hono()

    // ── List projects ──────────────────────────────────────────────────────────
    .get(
      "/projects",
      describeRoute({
        summary: "List EL projects",
        operationId: "el.projects.list",
        responses: { 200: { description: "Project list", content: { "application/json": { schema: resolver(z.array(ProjectOut)) } } } },
      }),
      (c) => {
        const userId = getUserId(c)
        if (!userId) return c.json({ error: "Not authenticated" }, 401)

        const projects = Database.use((db) =>
          db.select().from(ElProjectTable)
            .where(eq(ElProjectTable.user_id, userId))
            .all(),
        )

        const result = projects.map((p) => {
          const resourceCount = Database.use((db) =>
            db.select().from(ElProjectResourceTable)
              .where(eq(ElProjectResourceTable.project_id, p.id))
              .all(),
          ).length
          return { ...p, resource_count: resourceCount }
        })

        return c.json(result)
      },
    )

    // ── Create project ─────────────────────────────────────────────────────────
    .post(
      "/projects",
      describeRoute({
        summary: "Create EL project",
        operationId: "el.projects.create",
        responses: { 200: { description: "Created project", content: { "application/json": { schema: resolver(ProjectOut) } } } },
      }),
      validator("json", z.object({
        name: z.string().min(1),
        github_url: z.string().url().optional(),
        arxiv_url: z.string().optional(),
      })),
      (c) => {
        const userId = getUserId(c)
        if (!userId) return c.json({ error: "Not authenticated" }, 401)

        const { name, github_url, arxiv_url } = c.req.valid("json")
        const now = Date.now()
        const projectId = ulid()

        Database.use((db) =>
          db.insert(ElProjectTable).values({
            id: projectId,
            user_id: userId,
            name,
            status: "onboarding",
            context_json: {},
            time_created: now,
            time_updated: now,
          }).run(),
        )

        // Add initial resources if provided
        if (github_url) addResourceToProject(projectId, github_url, "primary")
        if (arxiv_url) addResourceToProject(projectId, arxiv_url, "primary")

        const project = Database.use((db) =>
          db.select().from(ElProjectTable).where(eq(ElProjectTable.id, projectId)).get(),
        )!

        return c.json(project)
      },
    )

    // ── Get project detail ─────────────────────────────────────────────────────
    .get(
      "/projects/:id",
      describeRoute({
        summary: "Get EL project detail",
        operationId: "el.projects.get",
        responses: {
          200: {
            description: "Project with resources",
            content: {
              "application/json": {
                schema: resolver(z.object({ project: ProjectOut, resources: z.array(ResourceOut) })),
              },
            },
          },
        },
      }),
      (c) => {
        const userId = getUserId(c)
        if (!userId) return c.json({ error: "Not authenticated" }, 401)

        const project = Database.use((db) =>
          db.select().from(ElProjectTable)
            .where(and(eq(ElProjectTable.id, c.req.param("id")), eq(ElProjectTable.user_id, userId)))
            .get(),
        )
        if (!project) return c.json({ error: "Not found" }, 404)

        const joinRows = Database.use((db) =>
          db.select().from(ElProjectResourceTable)
            .where(eq(ElProjectResourceTable.project_id, project.id))
            .all(),
        )

        const resources: z.infer<typeof ResourceOut>[] = []
        for (const join of joinRows) {
          const res = Database.use((db) =>
            db.select().from(LearningResourceTable).where(eq(LearningResourceTable.id, join.resource_id)).get(),
          )
          if (!res) continue
          resources.push({
            join_id: join.id,
            resource_id: res.id,
            role: join.role,
            url: res.url ?? null,
            title: res.title ?? null,
            status: res.status,
            resource_type: (res.metadata as any)?.type ?? "url",
            metadata: res.metadata ?? {},
            time_created: join.time_created,
          })
        }

        return c.json({ project, resources })
      },
    )

    // ── Update project context (onboarding Q&A) ────────────────────────────────
    .patch(
      "/projects/:id/context",
      describeRoute({
        summary: "Save onboarding context",
        operationId: "el.projects.context",
        responses: { 200: { description: "Updated project", content: { "application/json": { schema: resolver(ProjectOut) } } } },
      }),
      validator("json", z.object({
        context: z.record(z.string(), z.string()),
        status: z.enum(["onboarding", "active", "paused"]).optional(),
      })),
      (c) => {
        const userId = getUserId(c)
        if (!userId) return c.json({ error: "Not authenticated" }, 401)

        const project = Database.use((db) =>
          db.select().from(ElProjectTable)
            .where(and(eq(ElProjectTable.id, c.req.param("id")), eq(ElProjectTable.user_id, userId)))
            .get(),
        )
        if (!project) return c.json({ error: "Not found" }, 404)

        const { context, status } = c.req.valid("json")
        const merged: Record<string, string> = { ...(project.context_json ?? {}), ...context }

        Database.use((db) =>
          db.update(ElProjectTable)
            .set({ context_json: merged, ...(status ? { status } : {}), time_updated: Date.now() })
            .where(eq(ElProjectTable.id, project.id))
            .run(),
        )

        return c.json(Database.use((db) =>
          db.select().from(ElProjectTable).where(eq(ElProjectTable.id, project.id)).get(),
        )!)
      },
    )

    // ── Add resource ───────────────────────────────────────────────────────────
    .post(
      "/projects/:id/resources",
      describeRoute({
        summary: "Add resource to project",
        operationId: "el.projects.resources.add",
        responses: { 200: { description: "Added resource", content: { "application/json": { schema: resolver(ResourceOut) } } } },
      }),
      validator("json", z.object({
        url: z.string().min(1),
        role: z.enum(["primary", "supplementary"]).default("primary"),
      })),
      (c) => {
        const userId = getUserId(c)
        if (!userId) return c.json({ error: "Not authenticated" }, 401)

        const project = Database.use((db) =>
          db.select().from(ElProjectTable)
            .where(and(eq(ElProjectTable.id, c.req.param("id")), eq(ElProjectTable.user_id, userId)))
            .get(),
        )
        if (!project) return c.json({ error: "Not found" }, 404)

        const { url, role } = c.req.valid("json")
        const resource = addResourceToProject(project.id, url, role)

        const join = Database.use((db) =>
          db.select().from(ElProjectResourceTable)
            .where(and(
              eq(ElProjectResourceTable.project_id, project.id),
              eq(ElProjectResourceTable.resource_id, resource.id),
            ))
            .get(),
        )!

        return c.json({
          join_id: join.id,
          resource_id: resource.id,
          role: join.role,
          url: resource.url ?? null,
          title: resource.title ?? null,
          status: resource.status,
          resource_type: detectResourceType(url),
          metadata: resource.metadata ?? {},
          time_created: join.time_created,
        })
      },
    )

    // ── Remove resource ────────────────────────────────────────────────────────
    .delete(
      "/projects/:id/resources/:rid",
      describeRoute({
        summary: "Remove resource from project",
        operationId: "el.projects.resources.remove",
        responses: { 200: { description: "Removed", content: { "application/json": { schema: resolver(z.boolean()) } } } },
      }),
      (c) => {
        const userId = getUserId(c)
        if (!userId) return c.json({ error: "Not authenticated" }, 401)

        const project = Database.use((db) =>
          db.select().from(ElProjectTable)
            .where(and(eq(ElProjectTable.id, c.req.param("id")), eq(ElProjectTable.user_id, userId)))
            .get(),
        )
        if (!project) return c.json({ error: "Not found" }, 404)

        Database.use((db) =>
          db.delete(ElProjectResourceTable)
            .where(and(
              eq(ElProjectResourceTable.project_id, project.id),
              eq(ElProjectResourceTable.id, c.req.param("rid")),
            ))
            .run(),
        )

        refreshClaudeMd(project.id)

        return c.json(true)
      },
    )

    // ── Get knowledge graph ────────────────────────────────────────────────────
    .get(
      "/projects/:id/graph",
      describeRoute({
        summary: "Get project knowledge graph",
        operationId: "el.projects.graph",
        responses: {
          200: {
            description: "Graph nodes and edges",
            content: { "application/json": { schema: resolver(z.object({ nodes: z.array(z.any()), edges: z.array(z.any()) })) } },
          },
        },
      }),
      (c) => {
        const userId = getUserId(c)
        if (!userId) return c.json({ error: "Not authenticated" }, 401)

        const project = Database.use((db) =>
          db.select().from(ElProjectTable)
            .where(and(eq(ElProjectTable.id, c.req.param("id")), eq(ElProjectTable.user_id, userId)))
            .get(),
        )
        if (!project) return c.json({ error: "Not found" }, 404)

        return c.json(buildProjectGraph(project.id, project.name))
      },
    )

    // ── Memorize (from /memorize command in session) ───────────────────────────
    .post(
      "/projects/:id/memorize",
      describeRoute({
        summary: "Memorize resource into project",
        operationId: "el.projects.memorize",
        responses: { 200: { description: "Memorized resource", content: { "application/json": { schema: resolver(ResourceOut) } } } },
      }),
      validator("json", z.object({ url: z.string().min(1) })),
      (c) => {
        const userId = getUserId(c)
        if (!userId) return c.json({ error: "Not authenticated" }, 401)

        const project = Database.use((db) =>
          db.select().from(ElProjectTable)
            .where(and(eq(ElProjectTable.id, c.req.param("id")), eq(ElProjectTable.user_id, userId)))
            .get(),
        )
        if (!project) return c.json({ error: "Not found" }, 404)

        const { url } = c.req.valid("json")
        const resource = addResourceToProject(project.id, url, "supplementary")

        const join = Database.use((db) =>
          db.select().from(ElProjectResourceTable)
            .where(and(
              eq(ElProjectResourceTable.project_id, project.id),
              eq(ElProjectResourceTable.resource_id, resource.id),
            ))
            .get(),
        )!

        return c.json({
          join_id: join.id,
          resource_id: resource.id,
          role: join.role,
          url: resource.url ?? null,
          title: resource.title ?? null,
          status: resource.status,
          resource_type: detectResourceType(url),
          metadata: resource.metadata ?? {},
          time_created: join.time_created,
        })
      },
    )

    // ── Search ─────────────────────────────────────────────────────────────────
    .post(
      "/search",
      describeRoute({
        summary: "Search resources",
        operationId: "el.search",
        responses: { 200: { description: "Search results", content: { "application/json": { schema: resolver(z.any()) } } } },
      }),
      validator("json", z.object({
        q: z.string().min(1),
        project_id: z.string().optional(), // null = global search
        filters: z.object({
          type: z.enum(["github", "arxiv", "url"]).optional(),
          role: z.enum(["primary", "supplementary"]).optional(),
        }).optional(),
      })),
      (c) => {
        const userId = getUserId(c)
        if (!userId) return c.json({ error: "Not authenticated" }, 401)

        const { q, project_id, filters } = c.req.valid("json")

        if (project_id) {
          // Project-scoped: search via virtual workspace
          const project = Database.use((db) =>
            db.select().from(ElProjectTable)
              .where(and(eq(ElProjectTable.id, project_id), eq(ElProjectTable.user_id, userId)))
              .get(),
          )
          if (!project) return c.json({ error: "Not found" }, 404)

          const virtualWs = Database.use((db) =>
            db.select().from(LearningKbWorkspaceTable)
              .where(eq(LearningKbWorkspaceTable.project_id, `el-${project_id}`))
              .get(),
          )
          if (!virtualWs) return c.json({ locations: [], concepts: [], sources: [], uncategorized_count: 0 })

          // Count uncategorized resources (status != "done" in retrieval terms = no placements)
          const joinRows = Database.use((db) =>
            db.select().from(ElProjectResourceTable)
              .where(eq(ElProjectResourceTable.project_id, project_id))
              .all(),
          )
          const allResources = joinRows.length === 0 ? [] : Database.use((db) =>
            db.select().from(LearningResourceTable)
              .where(inArray(LearningResourceTable.id, joinRows.map((r) => r.resource_id)))
              .all(),
          )
          // Apply type filter
          const filteredResources = filters?.type
            ? allResources.filter((r) => (r.metadata as any)?.type === filters.type)
            : allResources

          const uncategorized_count = filteredResources.filter((r) => r.status !== "done").length

          const results = Retrieval.searchWithContext(virtualWs.id, q, 10)
          return c.json({ ...results, uncategorized_count })
        }

        // Global search: search across all user's EL virtual workspaces
        const userProjects = Database.use((db) =>
          db.select().from(ElProjectTable)
            .where(eq(ElProjectTable.user_id, userId))
            .all(),
        )

        const allResults: any[] = []
        for (const project of userProjects) {
          const virtualWs = Database.use((db) =>
            db.select().from(LearningKbWorkspaceTable)
              .where(eq(LearningKbWorkspaceTable.project_id, `el-${project.id}`))
              .get(),
          )
          if (!virtualWs) continue
          const results = Retrieval.searchWithContext(virtualWs.id, q, 5)
          allResults.push(...results.locations.map((l: any) => ({ ...l, project_id: project.id, project_name: project.name })))
        }

        // Sort by relevance and cap
        allResults.sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0))
        return c.json({ locations: allResults.slice(0, 15), concepts: [], sources: [], uncategorized_count: 0 })
      },
    )

    // ── Provision project directory ────────────────────────────────────────────
    // Creates a real on-disk directory for this project so the session system
    // can create sessions in it. Returns the directory path.
    .post(
      "/projects/:id/provision",
      describeRoute({
        summary: "Provision project directory",
        operationId: "el.projects.provision",
        responses: {
          200: {
            description: "Directory path",
            content: { "application/json": { schema: resolver(z.object({ directory: z.string() })) } },
          },
        },
      }),
      (c) => {
        const userId = getUserId(c)
        if (!userId) return c.json({ error: "Not authenticated" }, 401)

        const project = Database.use((db) =>
          db.select().from(ElProjectTable)
            .where(and(eq(ElProjectTable.id, c.req.param("id")), eq(ElProjectTable.user_id, userId)))
            .get(),
        )
        if (!project) return c.json({ error: "Not found" }, 404)

        const directory = path.join("/workspaces", userId, "el-projects", project.id)
        if (!existsSync(directory)) mkdirSync(directory, { recursive: true })

        // Update virtual workspace kb_path to the real directory
        Database.use((db) =>
          db.update(LearningKbWorkspaceTable)
            .set({ kb_path: directory, time_updated: Date.now() })
            .where(eq(LearningKbWorkspaceTable.project_id, `el-${project.id}`))
            .run(),
        )

        // Write (or refresh) CLAUDE.md with current project + resource metadata
        refreshClaudeMd(project.id)

        return c.json({ directory })
      },
    )

    // ── Project sessions ───────────────────────────────────────────────────────
    .get(
      "/projects/:id/sessions",
      describeRoute({
        summary: "List sessions for an EL project",
        operationId: "el.projects.sessions",
        responses: {
          200: {
            description: "Session list",
            content: { "application/json": { schema: resolver(z.array(z.object({
              id: z.string(),
              title: z.string(),
              time_created: z.number(),
              time_updated: z.number(),
            }))) } },
          },
        },
      }),
      (c) => {
        const userId = getUserId(c)
        if (!userId) return c.json({ error: "Not authenticated" }, 401)

        const project = Database.use((db) =>
          db.select().from(ElProjectTable)
            .where(and(eq(ElProjectTable.id, c.req.param("id")), eq(ElProjectTable.user_id, userId)))
            .get(),
        )
        if (!project) return c.json({ error: "Not found" }, 404)

        const sessions = Database.use((db) =>
          db.select({
            id: SessionTable.id,
            title: SessionTable.title,
            time_created: SessionTable.time_created,
            time_updated: SessionTable.time_updated,
          })
            .from(SessionTable)
            .where(eq(SessionTable.el_project_id, project.id))
            .orderBy(desc(SessionTable.time_updated))
            .limit(20)
            .all(),
        )

        return c.json(sessions)
      },
    ),
)
