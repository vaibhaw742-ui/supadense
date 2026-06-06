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
import { mkdirSync, existsSync, writeFileSync, readFileSync, symlinkSync, unlinkSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"

// ── Load deployment/.env if AIRTOP_API_KEY not already set ───────────────────
;(function loadDeploymentEnv() {
  if (process.env.AIRTOP_API_KEY) return
  // Walk up from this file's dir until we find deployment/.env
  let dir = path.dirname(import.meta.filename ?? __filename)
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, "deployment", ".env")
    try {
      const lines = readFileSync(candidate, "utf-8").split("\n")
      for (const line of lines) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
      }
      console.log(`[EL] Loaded env from ${candidate}`)
      return
    } catch { /* try parent */ }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
})()

// Kick off reprocess once DB is ready (6s after module load)
setTimeout(startupReprocess, 6000)
import { userWorkspaceDir } from "../../util/workspace-provision"
import { lazy }                 from "../../util/lazy"
import { initElProjectDirs, elProjectSourcesDir } from "../../experiential/project-structure"
import { initialSync }         from "../../brain/watcher"
import { startBrainWatcher }   from "../../brain/watcher"
import { Database } from "../../storage/db"
import { ElProjectTable, ElProjectResourceTable, ElProjectNodeTable } from "../../experiential/schema.sql"
import { RepoIndexer } from "../../experiential/repo-indexer"
import { getStoredGitHubToken } from "./el-github"
import { LearningResourceTable } from "../../learning/schema.sql"
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
 * Fetch GitHub repo metadata, file tree, and package.json.
 * Creates concept nodes that form the engineering brain graph.
 * Runs fire-and-forget after resource creation.
 */
async function analyzeGitHubResource(resourceId: string, url: string, githubPat?: string): Promise<void> {
  const parsed = parseGitHubRepo(url)
  if (!parsed) return

  const ghHeaders: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(githubPat ? { Authorization: `Bearer ${githubPat}` } : {}),
  }

  try {
    // 1. Basic repo metadata
    const res = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, { headers: ghHeaders })
    if (!res.ok) {
      Database.use((db) =>
        db.update(LearningResourceTable)
          .set({ status: "failed", error: `GitHub API ${res.status}${res.status === 403 ? " — add a GitHub PAT to avoid rate limits" : ""}`, time_updated: Date.now() })
          .where(eq(LearningResourceTable.id, resourceId))
          .run(),
      )
      return
    }

    const data = await res.json() as Record<string, any>
    const branch: string = data.default_branch ?? "main"
    const language: string = data.language ?? ""
    const topics: string[] = data.topics ?? []

    // 2. README (raw text, first 4000 chars)
    let readme = ""
    try {
      const readmeRes = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/readme`, {
        headers: { ...ghHeaders, Accept: "application/vnd.github.raw+json" },
      })
      if (readmeRes.ok) readme = (await readmeRes.text()).slice(0, 4000)
    } catch { /* readme optional */ }

    // 3. File tree (recursive) — capped at 10 000 entries by GitHub
    let filePaths: string[] = []
    try {
      const treeRes = await fetch(
        `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/${branch}?recursive=1`,
        { headers: ghHeaders },
      )
      if (treeRes.ok) {
        const treeData = await treeRes.json() as { tree?: Array<{ type: string; path: string }> }
        filePaths = (treeData.tree ?? [])
          .filter((f) => f.type === "blob")
          .map((f) => f.path)
      }
    } catch { /* tree optional */ }

    // 4. Update resource row with full metadata
    const metadata = {
      type: "github",
      full_name: data.full_name,
      description: data.description ?? "",
      stars: data.stargazers_count ?? 0,
      language,
      topics,
      default_branch: branch,
      readme_preview: readme.slice(0, 2000),
      file_count: filePaths.length,
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

const AIRTOP_AGENT_WEBHOOK =
  "https://api.airtop.ai/api/hooks/agents/e0103755-2146-43d3-bd25-5410d00b3654/webhooks/984d5de3-2807-43c8-af8a-f441652a11f4"

async function fetchWithAirtop(url: string, apiKey: string): Promise<{ content: string; title?: string }> {
  // 1. Trigger
  const triggerRes = await fetch(AIRTOP_AGENT_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ configVars: { url } }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!triggerRes.ok) {
    const body = await triggerRes.text().catch(() => "")
    throw new Error(`Airtop trigger failed: HTTP ${triggerRes.status} — ${body.slice(0, 200)}`)
  }
  const triggerBody = (await triggerRes.json()) as { invocationId?: string }
  console.log(`[Airtop] trigger response:`, JSON.stringify(triggerBody))
  const { invocationId } = triggerBody
  if (!invocationId) throw new Error("Airtop did not return an invocationId")

  // 2. Poll until completed (Airtop takes ~60-100s minimum)
  const pollUrl = `https://api.airtop.ai/api/hooks/agents/e0103755-2146-43d3-bd25-5410d00b3654/invocations/${invocationId}/result`
  await new Promise((r) => setTimeout(r, 60_000))
  let elapsed = 60_000
  const MAX_WAIT_MS = 5 * 60 * 1000

  while (elapsed < MAX_WAIT_MS) {
    await new Promise((r) => setTimeout(r, 2_000))
    elapsed += 2_000

    const res = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) continue

    const data = (await res.json()) as { status?: string; output?: unknown; error?: string }
    const statusLower = data.status?.toLowerCase() ?? ""
    if (statusLower === "failed") throw new Error(`Airtop failed: ${data.error ?? "unknown"}`)

    const outputObj = data.output as Record<string, unknown> | undefined
    const isDone = statusLower === "completed" || outputObj?.success === true
    if (isDone && data.output != null) {
      const markdown = typeof data.output === "string"
        ? data.output
        : (outputObj?.text_md ?? outputObj?.markdown ?? outputObj?.content ?? outputObj?.text ?? JSON.stringify(data.output)) as string
      const title = (outputObj?.title as string | undefined) ?? markdown.match(/^#\s+(.+)$/m)?.[1]?.trim()
      return { content: markdown.slice(0, 40_000), title }
    }
  }
  throw new Error("Airtop extraction timed out after 5 minutes")
}

/**
 * Fetch and extract readable content from a generic URL using Airtop.
 * Falls back to simple HTML fetch if AIRTOP_API_KEY is not set.
 */
async function analyzeGenericUrl(resourceId: string, url: string): Promise<void> {
  try {
    const apiKey = process.env.AIRTOP_API_KEY
    console.log(`[EL] analyzeGenericUrl: resourceId=${resourceId} url=${url} hasKey=${!!apiKey}`)
    let content = ""
    let title: string | undefined
    let metaDesc = ""

    if (apiKey) {
      // Use Airtop for full JS-rendered content
      const result = await fetchWithAirtop(url, apiKey)
      content = result.content
      title = result.title
    } else {
      // Fallback: plain HTTP fetch + HTML strip
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Supadense/1.0)", Accept: "text/html,*/*" },
        redirect: "follow",
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) {
        Database.use((db) =>
          db.update(LearningResourceTable)
            .set({ status: "failed", error: `HTTP ${res.status}`, time_updated: Date.now() })
            .where(eq(LearningResourceTable.id, resourceId))
            .run(),
        )
        return
      }
      const html = await res.text()
      title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim().replace(/\s+/g, " ")
      metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? ""
      content = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
        .replace(/<header[\s\S]*?<\/header>/gi, " ")
        .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/\s{2,}/g, " ").trim()
        .slice(0, 20_000)
    }

    // Save markdown to data/workspaces/<userId>/sources/<resourceId>.md
    const joinRow = Database.use((db) =>
      db.select({ project_id: ElProjectResourceTable.project_id })
        .from(ElProjectResourceTable)
        .where(eq(ElProjectResourceTable.resource_id, resourceId))
        .get(),
    )
    let contentPath: string | null = null
    if (joinRow) {
      const project = Database.use((db) =>
        db.select({ user_id: ElProjectTable.user_id })
          .from(ElProjectTable)
          .where(eq(ElProjectTable.id, joinRow.project_id))
          .get(),
      )
      if (project?.user_id) {
        // 1. Save actual file to data/workspaces/<userId>/sources/<resourceId>.md
        const sourcesDir = path.join(userWorkspaceDir(project.user_id), "sources")
        mkdirSync(sourcesDir, { recursive: true })
        const filePath = path.join(sourcesDir, `${resourceId}.md`)
        writeFileSync(filePath, content, "utf-8")
        contentPath = filePath
        console.log(`[EL] saved markdown to ${filePath}`)

        // 2. Symlink into project's .supadense/sources/<resourceId>.md
        const projSourcesDir = elProjectSourcesDir(project.user_id, joinRow.project_id)
        mkdirSync(projSourcesDir, { recursive: true })
        const linkPath = path.join(projSourcesDir, `${resourceId}.md`)
        try { unlinkSync(linkPath) } catch {}
        symlinkSync(filePath, linkPath)
        console.log(`[EL] symlinked ${linkPath} -> ${filePath}`)
      }
    }

    Database.use((db) =>
      db.update(LearningResourceTable)
        .set({
          title: title ?? new URL(url).hostname,
          summary: metaDesc.slice(0, 500),
          raw_content: contentPath ?? content,
          metadata: { type: "url" },
          status: "done",
          time_updated: Date.now(),
        })
        .where(eq(LearningResourceTable.id, resourceId))
        .run(),
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
 * Ensure every user has exactly one "Default" project.
 * Called at list-projects time and on first capture.
 * Returns the default project id.
 */
function ensureDefaultProject(userId: string): string {
  const existing = Database.use((db) =>
    db.select().from(ElProjectTable)
      .where(and(eq(ElProjectTable.user_id, userId), eq(ElProjectTable.is_default, true)))
      .get(),
  )
  if (existing) return existing.id

  const now = Date.now()
  const projectId = ulid()
  Database.use((db) =>
    db.insert(ElProjectTable).values({
      id: projectId,
      user_id: userId,
      name: "Default",
      status: "active",
      context_json: {},
      is_default: true,
      time_created: now,
      time_updated: now,
    }).run(),
  )
  // Create the folder structure
  const dir = path.join(userWorkspaceDir(userId), "el-projects", projectId)
  mkdirSync(path.join(dir, ".supadense", "brain", "L0"), { recursive: true })
  mkdirSync(path.join(dir, ".supadense", "brain", "L1"), { recursive: true })
  mkdirSync(path.join(dir, ".supadense", "brain", "L2"), { recursive: true })
  mkdirSync(path.join(dir, ".supadense", "sources"), { recursive: true })
  return projectId
}

/**
 * Add a resource to a project: creates learning_resources row + join row,
 * kicks off background analysis.
 */
function addResourceToProject(projectId: string, url: string, role: "primary" | "supplementary" = "primary", githubPat?: string) {
  const { modality } = classifyUrl(url)
  const resourceType = detectResourceType(url)

  const resource = Resource.create({
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
    void analyzeGitHubResource(resource.id, url, githubPat)
  } else if (resourceType === "arxiv") {
    void analyzeArxivResource(resource.id, url)
  } else {
    // Generic URL — scrape and extract content asynchronously
    void analyzeGenericUrl(resource.id, url)
  }

  // Write initial CLAUDE.md immediately (resource may still be processing, but good to have)
  refreshClaudeMd(projectId)

  return resource
}

// ─── Graph Builder ────────────────────────────────────────────────────────────

function buildProjectGraph(projectId: string, _projectName: string) {
  const nodes: Array<{ id: string; type: string; label: string; url?: string; resource_id?: string; status?: string }> = []
  const edges: Array<{ source: string; target: string }> = []

  // Always add GitHub node from context_json.github_url if present
  const project = Database.use((db) =>
    db.select({ context_json: ElProjectTable.context_json }).from(ElProjectTable).where(eq(ElProjectTable.id, projectId)).get(),
  )
  const githubUrl = project?.context_json?.github_url
  if (githubUrl) {
    let label = "Repo"
    try {
      const u = new URL(githubUrl)
      const parts = u.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/")
      label = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : u.pathname.replace(/^\//, "") || "github"
    } catch {}
    nodes.push({ id: `github_${projectId}`, type: "github", label, url: githubUrl })
  }

  const joinRows = Database.use((db) =>
    db.select().from(ElProjectResourceTable)
      .where(eq(ElProjectResourceTable.project_id, projectId))
      .all(),
  )

  if (joinRows.length === 0) return { nodes, edges }

  // Build a role map: resource_id → role (skip github — handled above via context_json)
  const roleMap = new Map(joinRows.map((r) => [r.resource_id, r.role]))

  const resourceIds = joinRows.map((r) => r.resource_id)
  const resources = Database.use((db) =>
    db.select().from(LearningResourceTable)
      .where(inArray(LearningResourceTable.id, resourceIds))
      .all(),
  )

  for (const res of resources) {
    const role = roleMap.get(res.id) ?? "supplementary"
    // primary + github URL → "github" node; everything else → "source"
    const isGitHub = !!res.url && res.url.includes("github.com")
    const nodeType = role === "primary" && isGitHub ? "github" : "source"

    let label = nodeType === "source" ? "Source" : "Repo"
    if (res.url) {
      try {
        const u = new URL(res.url)
        if (u.hostname.includes("github.com")) {
          const parts = u.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/")
          label = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : u.pathname.replace(/^\//, "") || "github"
        } else if (u.hostname.includes("arxiv.org")) {
          label = res.title ? res.title.split(" ").slice(0, 5).join(" ") : `arxiv${u.pathname}`
        } else {
          label = res.title ? res.title.split(" ").slice(0, 4).join(" ") : u.hostname.replace(/^www\./, "")
        }
      } catch { label = res.title ? res.title.split(" ").slice(0, 4).join(" ") : "Source" }
    } else if (res.title) {
      label = res.title.split(" ").slice(0, 4).join(" ")
    }
    nodes.push({ id: `res_${res.id}`, type: nodeType, label, url: res.url ?? undefined, resource_id: res.id, status: res.status })
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

    // Use the project's actual directory (no workspace lookup needed)
    const dir = project.repo_local_path ?? null
    if (!dir || !existsSync(dir)) return

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
  clone_status: z.string().optional(),
  clone_error: z.string().nullable().optional(),
  supadense_init: z.string().optional(),
  repo_branch: z.string().nullable().optional(),
  repo_local_path: z.string().nullable().optional(),
  is_default: z.boolean().optional(),
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

let didStartupReprocess = false
function startupReprocess() {
  if (didStartupReprocess) return
  didStartupReprocess = true
  console.log("[EL] startupReprocess running, AIRTOP_API_KEY set:", !!process.env.AIRTOP_API_KEY)
  try {
    const stuck = Database.use((db) =>
      db.select().from(LearningResourceTable)
        .where(eq(LearningResourceTable.status, "processing"))
        .all(),
    )
    const doneEmpty = Database.use((db) =>
      db.select().from(LearningResourceTable).all(),
    ).filter((r) => r.status === "done" && !r.raw_content && !!r.url && detectResourceType(r.url) === "url")

    const toReprocess = [...stuck, ...doneEmpty]
    console.log(`[EL] stuck=${stuck.length} doneEmpty=${doneEmpty.length} total=${toReprocess.length}`)
    for (const r of toReprocess) {
      if (!r.url) continue
      console.log(`[EL] Reprocessing: ${r.url}`)
      Database.use((db) => db.update(LearningResourceTable).set({ status: "processing", time_updated: Date.now() }).where(eq(LearningResourceTable.id, r.id)).run())
      const type = detectResourceType(r.url)
      if (type === "github") void analyzeGitHubResource(r.id, r.url)
      else if (type === "arxiv") void analyzeArxivResource(r.id, r.url)
      else void analyzeGenericUrl(r.id, r.url)
    }
    if (toReprocess.length > 0) console.log(`[EL] Reprocessing ${toReprocess.length} stuck resources`)
  } catch (e) { console.error("[EL] Startup reprocess error", e) }
}

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

        ensureDefaultProject(userId)

        const projects = Database.use((db) =>
          db.select().from(ElProjectTable)
            .where(eq(ElProjectTable.user_id, userId))
            .orderBy(desc(ElProjectTable.time_created))
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
        github_pat: z.string().optional(),
      })),
      (c) => {
        const userId = getUserId(c)
        if (!userId) return c.json({ error: "Not authenticated" }, 401)

        const { name, github_url, arxiv_url, github_pat } = c.req.valid("json")
        const now = Date.now()
        const projectId = ulid()

        // Store github_url and PAT in context_json so the frontend can display them
        const context_json: Record<string, string> = {}
        if (github_url) context_json.github_url = github_url
        if (github_pat) context_json.github_pat = github_pat

        Database.use((db) =>
          db.insert(ElProjectTable).values({
            id: projectId,
            user_id: userId,
            name,
            status: "onboarding",
            context_json,
            time_created: now,
            time_updated: now,
          }).run(),
        )

        // Add initial resources if provided
        // GitHub URL is stored in context_json — not added as a source in learning_resources
        if (arxiv_url) addResourceToProject(projectId, arxiv_url, "primary")

        // Initialise brain/ + sources/ dirs for this project (async, non-blocking)
        const paths = initElProjectDirs(userId, projectId)
        initialSync(paths.brain, projectId)
          .then(() => startBrainWatcher(paths.brain, projectId))
          .catch(() => null)

        const project = Database.use((db) =>
          db.select().from(ElProjectTable).where(eq(ElProjectTable.id, projectId)).get(),
        )!

        return c.json({ ...project, brain_dir: paths.brain, sources_dir: paths.sources })
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

    // ── Resource → project mapping (for display in sources list) ─────────────
    // EL project resources live in virtual workspaces with different IDs from KB
    // resources, so we join through LearningResourceTable to match by URL.
    .get(
      "/resource-projects",
      describeRoute({
        summary: "Get project assignments for all resources keyed by URL",
        operationId: "el.resource-projects",
        responses: { 200: { description: "Array of { url, project_id, project_name }" } },
      }),
      (c) => {
        const userId = getUserId(c)
        if (!userId) return c.json([])

        const projects = Database.use((db) =>
          db.select({ id: ElProjectTable.id, name: ElProjectTable.name })
            .from(ElProjectTable)
            .where(eq(ElProjectTable.user_id, userId))
            .all(),
        )
        if (projects.length === 0) return c.json([])

        const projectIds = projects.map((p) => p.id)
        const joins = Database.use((db) =>
          db.select({ id: ElProjectResourceTable.id, resource_id: ElProjectResourceTable.resource_id, project_id: ElProjectResourceTable.project_id })
            .from(ElProjectResourceTable)
            .where(inArray(ElProjectResourceTable.project_id, projectIds))
            .all(),
        )
        if (joins.length === 0) return c.json([])

        // Resolve each EL resource_id → URL via LearningResourceTable
        const resourceIds = [...new Set(joins.map((j) => j.resource_id))]
        const resourceRows = Database.use((db) =>
          db.select({ id: LearningResourceTable.id, url: LearningResourceTable.url })
            .from(LearningResourceTable)
            .where(inArray(LearningResourceTable.id, resourceIds))
            .all(),
        )
        const urlById = new Map(resourceRows.filter((r) => r.url).map((r) => [r.id, r.url!]))

        const projectMap = new Map(projects.map((p) => [p.id, p.name]))
        const result: Array<{ url: string; project_id: string; project_name: string; join_id: string }> = []
        for (const j of joins) {
          const url = urlById.get(j.resource_id)
          if (!url) continue
          result.push({ url, project_id: j.project_id, project_name: projectMap.get(j.project_id) ?? "", join_id: j.id })
        }

        return c.json(result)
      },
    )

    // ── List all resources across all user projects ───────────────────────────
    .get(
      "/resources",
      describeRoute({
        summary: "List all resources across all user's projects",
        operationId: "el.resources.list",
        responses: { 200: { description: "All resources", content: { "application/json": { schema: resolver(z.array(z.any())) } } } },
      }),
      (c) => {
        const userId = getUserId(c)
        if (!userId) return c.json([])

        const projects = Database.use((db) =>
          db.select({ id: ElProjectTable.id }).from(ElProjectTable)
            .where(eq(ElProjectTable.user_id, userId))
            .all(),
        )
        if (projects.length === 0) return c.json([])

        const projectIds = projects.map((p) => p.id)
        const joins = Database.use((db) =>
          db.select().from(ElProjectResourceTable)
            .where(inArray(ElProjectResourceTable.project_id, projectIds))
            .orderBy(desc(ElProjectResourceTable.time_created))
            .all(),
        )
        if (joins.length === 0) return c.json([])

        const resourceIds = [...new Set(joins.map((j) => j.resource_id))]
        const resources = Database.use((db) =>
          db.select().from(LearningResourceTable)
            .where(inArray(LearningResourceTable.id, resourceIds))
            .all(),
        )
        const resourceMap = new Map(resources.map((r) => [r.id, r]))

        // Deduplicate by resource_id (a resource may be in multiple projects)
        const seen = new Set<string>()
        const result = []
        for (const j of joins) {
          if (seen.has(j.resource_id)) continue
          seen.add(j.resource_id)
          const r = resourceMap.get(j.resource_id)
          if (!r) continue
          result.push({
            id: r.id,
            url: r.url ?? null,
            title: r.title ?? null,
            author: r.author ?? null,
            modality: r.modality,
            status: r.status,
            metadata: r.metadata ?? {},
            time_created: r.time_created,
          })
        }
        return c.json(result)
      },
    )

    // ── Get single resource by id ─────────────────────────────────────────────
    .get(
      "/resources/:id",
      describeRoute({
        summary: "Get a single resource by id",
        operationId: "el.resources.get",
        responses: { 200: { description: "Resource", content: { "application/json": { schema: resolver(z.any()) } } } },
      }),
      (c) => {
        const userId = getUserId(c)
        if (!userId) return c.json({ error: "Not authenticated" }, 401)

        const resource = Database.use((db) =>
          db.select().from(LearningResourceTable)
            .where(eq(LearningResourceTable.id, c.req.param("id")))
            .get(),
        )
        if (!resource) return c.json({ error: "Not found" }, 404)

        // Auto-kick reprocessing for stuck resources
        const resourceType = detectResourceType(resource.url ?? "")
        const isStuck = resource.status === "processing" || (resource.status === "done" && !resource.raw_content && resourceType === "url")
        if (isStuck && resource.url) {
          // Reset to processing and re-analyze
          Database.use((db) =>
            db.update(LearningResourceTable)
              .set({ status: "processing", time_updated: Date.now() })
              .where(eq(LearningResourceTable.id, resource.id))
              .run(),
          )
          if (resourceType === "github") void analyzeGitHubResource(resource.id, resource.url)
          else if (resourceType === "arxiv") void analyzeArxivResource(resource.id, resource.url)
          else void analyzeGenericUrl(resource.id, resource.url)
        }

        // raw_content may be a file path (starts with /) — read it if so
        let content: string | null = resource.raw_content ?? null
        if (content && content.startsWith("/") && content.endsWith(".md")) {
          try { content = readFileSync(content, "utf-8") } catch { content = null }
        }

        return c.json({
          id: resource.id,
          url: resource.url ?? null,
          title: resource.title ?? null,
          author: resource.author ?? null,
          modality: resource.modality,
          status: isStuck ? "processing" : resource.status,
          content,
          metadata: resource.metadata ?? {},
          time_created: resource.time_created,
          asset_map: {},
        })
      },
    )

    // ── Delete project ────────────────────────────────────────────────────────
    .delete(
      "/projects/:id",
      describeRoute({
        summary: "Delete EL project",
        operationId: "el.projects.delete",
        responses: { 200: { description: "Deleted", content: { "application/json": { schema: resolver(z.object({ ok: z.boolean() })) } } } },
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

        Database.use((db) => {
          db.delete(ElProjectNodeTable).where(eq(ElProjectNodeTable.project_id, project.id)).run()
          db.delete(ElProjectResourceTable).where(eq(ElProjectResourceTable.project_id, project.id)).run()
          db.delete(ElProjectTable).where(eq(ElProjectTable.id, project.id)).run()
        })

        return c.json({ ok: true })
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

    // ── List resources ─────────────────────────────────────────────────────────
    .get(
      "/projects/:id/resources",
      describeRoute({
        summary: "List resources for a project",
        operationId: "el.projects.resources.list",
        responses: { 200: { description: "Resource list", content: { "application/json": { schema: resolver(z.array(ResourceOut)) } } } },
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

        const joins = Database.use((db) =>
          db.select().from(ElProjectResourceTable)
            .where(eq(ElProjectResourceTable.project_id, project.id))
            .orderBy(desc(ElProjectResourceTable.time_created))
            .all(),
        )
        if (joins.length === 0) return c.json([])

        const resourceIds = joins.map((j) => j.resource_id)
        const resources = Database.use((db) =>
          db.select().from(LearningResourceTable)
            .where(inArray(LearningResourceTable.id, resourceIds))
            .all(),
        )
        const resourceMap = new Map(resources.map((r) => [r.id, r]))

        return c.json(joins.map((j) => {
          const r = resourceMap.get(j.resource_id)
          return {
            join_id: j.id,
            resource_id: j.resource_id,
            role: j.role,
            url: r?.url ?? null,
            title: r?.title ?? null,
            status: r?.status ?? "pending",
            resource_type: detectResourceType(r?.url ?? ""),
            metadata: r?.metadata ?? {},
            time_created: j.time_created,
          }
        }))
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

        // Get resource_id before deleting so we can clean up files
        const joinRow = Database.use((db) =>
          db.select({ resource_id: ElProjectResourceTable.resource_id })
            .from(ElProjectResourceTable)
            .where(and(
              eq(ElProjectResourceTable.project_id, project.id),
              eq(ElProjectResourceTable.id, c.req.param("rid")),
            ))
            .get(),
        )

        Database.use((db) =>
          db.delete(ElProjectResourceTable)
            .where(and(
              eq(ElProjectResourceTable.project_id, project.id),
              eq(ElProjectResourceTable.id, c.req.param("rid")),
            ))
            .run(),
        )

        // Remove symlink from project's .supadense/sources/
        if (joinRow) {
          const linkPath = path.join(elProjectSourcesDir(userId, project.id), `${joinRow.resource_id}.md`)
          try { unlinkSync(linkPath) } catch {}

        }

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

    // ── Add resource (from /add-resource command in session) ──────────────────
    .post(
      "/projects/:id/add-resource",
      describeRoute({
        summary: "Add resource to project",
        operationId: "el.projects.addResource",
        responses: { 200: { description: "Resource added", content: { "application/json": { schema: resolver(ResourceOut) } } } },
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

          // Count uncategorized resources
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
          const filteredResources = filters?.type
            ? allResources.filter((r) => (r.metadata as any)?.type === filters.type)
            : allResources
          const uncategorized_count = filteredResources.filter((r) => r.status !== "done").length

          // Simple title/url search across project resources (no workspace needed)
          const matched = q ? filteredResources.filter((r) =>
            r.title?.toLowerCase().includes(q.toLowerCase()) ||
            r.url?.toLowerCase().includes(q.toLowerCase())
          ) : filteredResources
          const sources = matched.map((r) => ({ id: r.id, url: r.url, title: r.title, status: r.status }))
          return c.json({ locations: [], concepts: [], sources, uncategorized_count })
        }

        // Global search across all user's projects
        const userProjects = Database.use((db) =>
          db.select().from(ElProjectTable).where(eq(ElProjectTable.user_id, userId)).all(),
        )
        const allSources: any[] = []
        for (const project of userProjects) {
          const joinRows = Database.use((db) =>
            db.select().from(ElProjectResourceTable).where(eq(ElProjectResourceTable.project_id, project.id)).all(),
          )
          if (joinRows.length === 0) continue
          const resources = Database.use((db) =>
            db.select().from(LearningResourceTable)
              .where(inArray(LearningResourceTable.id, joinRows.map((r) => r.resource_id)))
              .all(),
          )
          const matched = q ? resources.filter((r) =>
            r.title?.toLowerCase().includes(q.toLowerCase()) ||
            r.url?.toLowerCase().includes(q.toLowerCase())
          ) : resources
          allSources.push(...matched.map((r) => ({ id: r.id, url: r.url, title: r.title, status: r.status, project_id: project.id, project_name: project.name })))
        }
        return c.json({ locations: [], concepts: [], sources: allSources.slice(0, 15), uncategorized_count: 0 })
      },
    )

    // ── Clone repo ─────────────────────────────────────────────────────────────
    .post(
      "/projects/:id/clone",
      describeRoute({
        summary: "Clone GitHub repo for a project",
        operationId: "el.projects.clone",
        responses: { 200: { description: "Clone started", content: { "application/json": { schema: resolver(z.object({ status: z.string() })) } } } },
      }),
      validator("json", z.object({ branch: z.string().optional() })),
      (c) => {
        const userId = getUserId(c)
        if (!userId) return c.json({ error: "Not authenticated" }, 401)

        const project = Database.use((db) =>
          db.select().from(ElProjectTable)
            .where(and(eq(ElProjectTable.id, c.req.param("id")), eq(ElProjectTable.user_id, userId)))
            .get(),
        )
        if (!project) return c.json({ error: "Not found" }, 404)

        const githubUrl = project.context_json?.github_url
        if (!githubUrl) return c.json({ error: "No GitHub URL configured for this project" }, 400)

        // PAT from project context takes priority; fall back to user's stored GitHub OAuth token
        const pat = project.context_json?.github_pat ?? getStoredGitHubToken(userId) ?? undefined
        const localPath = path.join(userWorkspaceDir(userId), "el-projects", project.id, "repo")
        const { branch: bodyBranch } = c.req.valid("json")

        // Set status to cloning immediately
        Database.use((db) =>
          db.update(ElProjectTable)
            .set({ clone_status: "cloning", clone_error: null, repo_local_path: localPath, time_updated: Date.now() })
            .where(eq(ElProjectTable.id, project.id))
            .run(),
        )

        // Fire-and-forget async pipeline
        void (async () => {
          try {
            // Resolve branch
            let branch = bodyBranch ?? project.repo_branch ?? "main"
            if (!bodyBranch && !project.repo_branch) {
              branch = RepoIndexer.getDefaultBranch(githubUrl, pat)
            }

            // Update branch
            Database.use((db) =>
              db.update(ElProjectTable)
                .set({ repo_branch: branch, time_updated: Date.now() })
                .where(eq(ElProjectTable.id, project.id))
                .run(),
            )

            // Clone
            const cloneResult = RepoIndexer.cloneRepo(githubUrl, localPath, branch, pat)
            if (!cloneResult.ok) {
              Database.use((db) =>
                db.update(ElProjectTable)
                  .set({ clone_status: "failed", clone_error: cloneResult.error ?? "Clone failed", time_updated: Date.now() })
                  .where(eq(ElProjectTable.id, project.id))
                  .run(),
              )
              return
            }

            // Clone done — no file indexing, just mark active
            Database.use((db) =>
              db.update(ElProjectTable)
                .set({ clone_status: "done", cloned_at: Date.now(), indexed_at: Date.now(), status: "active", time_updated: Date.now() })
                .where(eq(ElProjectTable.id, project.id))
                .run(),
            )
          } catch (err) {
            Database.use((db) =>
              db.update(ElProjectTable)
                .set({ clone_status: "failed", clone_error: String(err), time_updated: Date.now() })
                .where(eq(ElProjectTable.id, project.id))
                .run(),
            )
          }
        })()

        return c.json({ status: "cloning" })
      },
    )

    // ── Clone status ───────────────────────────────────────────────────────────
    .get(
      "/projects/:id/clone-status",
      describeRoute({
        summary: "Get clone/index status",
        operationId: "el.projects.cloneStatus",
        responses: { 200: { description: "Status", content: { "application/json": { schema: resolver(z.any()) } } } },
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

        const nodeCount = Database.use((db) =>
          db.select().from(ElProjectNodeTable)
            .where(eq(ElProjectNodeTable.project_id, project.id))
            .all(),
        ).length

        const totalFiles = nodeCount > 0
          ? Database.use((db) =>
              db.select({ total_file_count: ElProjectNodeTable.total_file_count })
                .from(ElProjectNodeTable)
                .where(and(eq(ElProjectNodeTable.project_id, project.id), eq(ElProjectNodeTable.depth, 0)))
                .get(),
            )?.total_file_count ?? 0
          : 0

        return c.json({
          clone_status: project.clone_status,
          clone_error: project.clone_error,
          supadense_init: project.supadense_init,
          repo_branch: project.repo_branch,
          node_count: nodeCount,
          total_file_count: totalFiles,
        })
      },
    )

    // ── Branches ──────────────────────────────────────────────────────────────
    .get(
      "/projects/:id/branches",
      describeRoute({
        summary: "List remote branches for a cloned repo",
        operationId: "el.projects.branches",
        responses: { 200: { description: "Branch list", content: { "application/json": { schema: resolver(z.object({ branches: z.array(z.string()), commit_count: z.number() })) } } } },
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
        if (!project.repo_local_path) return c.json({ branches: [], commit_count: 0 })

        // List remote branches
        const branchResult = spawnSync("git", ["-C", project.repo_local_path, "branch", "-r"], {
          encoding: "utf8", timeout: 10_000,
        })
        const branches = (branchResult.stdout ?? "")
          .split("\n")
          .map((l: string) => l.trim().replace(/^origin\//, "").replace(/^HEAD ->.*/, "").trim())
          .filter((l: string) => l.length > 0 && !l.startsWith("HEAD"))

        // Commit count on current branch
        const countResult = spawnSync("git", ["-C", project.repo_local_path, "rev-list", "--count", "HEAD"], {
          encoding: "utf8", timeout: 10_000,
        })
        const commit_count = parseInt((countResult.stdout ?? "").trim(), 10) || 0

        return c.json({ branches: [...new Set(branches)], commit_count })
      },
    )

    // ── Commits ───────────────────────────────────────────────────────────────
    .get(
      "/projects/:id/commits",
      describeRoute({
        summary: "List commits for a branch",
        operationId: "el.projects.commits",
        responses: { 200: { description: "Commit list" } },
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
        if (!project.repo_local_path) return c.json({ commits: [] })

        const branch = (c.req.query("branch") || "HEAD").trim()
        const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10) || 50, 200)

        // Resolve ref: try origin/<branch> first, fall back to local branch, then HEAD
        const refCandidates = branch === "HEAD"
          ? ["HEAD"]
          : [`origin/${branch}`, branch, "HEAD"]

        let ref = "HEAD"
        for (const candidate of refCandidates) {
          const check = spawnSync("git", ["-C", project.repo_local_path, "rev-parse", "--verify", candidate], {
            encoding: "utf8", timeout: 5_000,
          })
          if (check.status === 0) { ref = candidate; break }
        }

        const logResult = spawnSync(
          "git",
          ["-C", project.repo_local_path, "log", ref, `--max-count=${limit}`, "--format=%H\x1f%s\x1f%an\x1f%ae\x1f%ai"],
          { encoding: "utf8", timeout: 15_000 },
        )

        const commits = (logResult.stdout ?? "")
          .split("\n")
          .filter((l: string) => l.trim().length > 0)
          .map((line: string) => {
            const [sha, message, author_name, author_email, date] = line.split("\x1f")
            return {
              sha: (sha ?? "").slice(0, 8),
              sha_full: sha ?? "",
              message: message ?? "",
              author_name: author_name ?? "",
              author_email: author_email ?? "",
              date: date ?? "",
            }
          })

        return c.json({ commits })
      },
    )

    // ── Pull (re-sync) ─────────────────────────────────────────────────────────
    .post(
      "/projects/:id/pull",
      describeRoute({
        summary: "Pull latest + re-index",
        operationId: "el.projects.pull",
        responses: { 200: { description: "Pull started", content: { "application/json": { schema: resolver(z.object({ status: z.string() })) } } } },
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
        if (!project.repo_local_path) return c.json({ error: "Repo not cloned yet" }, 400)

        const pat = project.context_json?.github_pat ?? getStoredGitHubToken(userId) ?? undefined

        Database.use((db) =>
          db.update(ElProjectTable)
            .set({ clone_status: "cloning", time_updated: Date.now() })
            .where(eq(ElProjectTable.id, project.id))
            .run(),
        )

        void (async () => {
          try {
            const pullResult = RepoIndexer.pullRepo(project.repo_local_path!, pat)
            if (!pullResult.ok) {
              Database.use((db) =>
                db.update(ElProjectTable)
                  .set({ clone_status: "failed", clone_error: pullResult.error, time_updated: Date.now() })
                  .where(eq(ElProjectTable.id, project.id))
                  .run(),
              )
              return
            }

            // Pull done — no re-indexing
            Database.use((db) =>
              db.update(ElProjectTable)
                .set({ clone_status: "done", indexed_at: Date.now(), time_updated: Date.now() })
                .where(eq(ElProjectTable.id, project.id))
                .run(),
            )
          } catch (err) {
            Database.use((db) =>
              db.update(ElProjectTable)
                .set({ clone_status: "failed", clone_error: String(err), time_updated: Date.now() })
                .where(eq(ElProjectTable.id, project.id))
                .run(),
            )
          }
        })()

        return c.json({ status: "pulling" })
      },
    )

    // ── Directory nodes ────────────────────────────────────────────────────────
    .get(
      "/projects/:id/nodes",
      describeRoute({
        summary: "Get indexed directory nodes",
        operationId: "el.projects.nodes",
        responses: { 200: { description: "Node list", content: { "application/json": { schema: resolver(z.array(z.any())) } } } },
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

        const maxDepth = Number(c.req.query("max_depth") ?? "3")
        const nodes = Database.use((db) =>
          db.select().from(ElProjectNodeTable)
            .where(and(eq(ElProjectNodeTable.project_id, project.id)))
            .all(),
        ).filter((n) => n.depth <= maxDepth)

        return c.json(nodes)
      },
    )

    // ── Files in a specific node ───────────────────────────────────────────────
    .get(
      "/projects/:id/nodes/:encodedPath",
      describeRoute({
        summary: "Get files for a directory node",
        operationId: "el.projects.nodeFiles",
        responses: { 200: { description: "Node detail", content: { "application/json": { schema: resolver(z.any()) } } } },
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

        const nodePath = decodeURIComponent(c.req.param("encodedPath"))
        const node = Database.use((db) =>
          db.select().from(ElProjectNodeTable)
            .where(and(eq(ElProjectNodeTable.project_id, project.id), eq(ElProjectNodeTable.path, nodePath)))
            .get(),
        )
        if (!node) return c.json({ error: "Node not found" }, 404)

        // Also return immediate child directories
        const children = Database.use((db) =>
          db.select().from(ElProjectNodeTable)
            .where(and(eq(ElProjectNodeTable.project_id, project.id), eq(ElProjectNodeTable.parent_path, nodePath)))
            .all(),
        )

        return c.json({ ...node, children })
      },
    )

    // ── Repo source tree (actual filesystem) ──────────────────────────────────
    .get(
      "/projects/:id/tree",
      describeRoute({
        summary: "Get repo source file tree",
        operationId: "el.projects.tree",
        responses: { 200: { description: "Tree", content: { "application/json": { schema: resolver(z.any()) } } } },
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
        if (!project.repo_local_path) return c.json({ entries: [] })

        const { join, relative } = require("node:path") as typeof import("node:path")
        const { readdirSync, statSync, existsSync } = require("node:fs") as typeof import("node:fs")

        const IGNORE = new Set([".git", "node_modules", "__pycache__", ".DS_Store", "dist", "build", ".supadense"])
        const MAX_DEPTH = 3
        const MAX_ENTRIES = 300

        type TreeEntry = { name: string; path: string; type: "file" | "dir"; children?: TreeEntry[] }

        function walk(dir: string, depth: number): TreeEntry[] {
          if (depth > MAX_DEPTH) return []
          let entries: TreeEntry[] = []
          let items: string[]
          try { items = readdirSync(dir) } catch { return [] }
          for (const name of items.sort()) {
            if (IGNORE.has(name) || name.startsWith(".")) continue
            const full = join(dir, name)
            let stat
            try { stat = statSync(full) } catch { continue }
            const relPath = relative(project.repo_local_path!, full)
            if (stat.isDirectory()) {
              entries.push({ name, path: relPath, type: "dir", children: walk(full, depth + 1) })
            } else {
              entries.push({ name, path: relPath, type: "file" })
            }
            if (entries.length >= MAX_ENTRIES) break
          }
          return entries
        }

        return c.json({ entries: walk(project.repo_local_path, 0) })
      },
    )

    // ── .supadense/ folder tree ──────────────────────────────────────────────
    .get(
      "/projects/:id/supadense-tree",
      describeRoute({
        summary: "Get .supadense folder tree",
        operationId: "el.projects.supadense-tree",
        responses: { 200: { description: "Tree", content: { "application/json": { schema: resolver(z.any()) } } } },
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

        const { join, relative } = require("node:path") as typeof import("node:path")
        const { readdirSync, statSync, existsSync } = require("node:fs") as typeof import("node:fs")

        const supadenseDir = path.join(userWorkspaceDir(userId), "el-projects", project.id, ".supadense")
        if (!existsSync(supadenseDir)) return c.json({ entries: [] })

        type TreeEntry = { name: string; path: string; type: "file" | "dir"; children?: TreeEntry[] }

        function walk(dir: string, depth: number): TreeEntry[] {
          if (depth > 5) return []
          let entries: TreeEntry[] = []
          let items: string[]
          try { items = readdirSync(dir) } catch { return [] }
          for (const name of items.sort()) {
            if (name.startsWith(".")) continue
            const full = join(dir, name)
            let stat
            try { stat = statSync(full) } catch { continue }
            const relPath = relative(supadenseDir, full)
            if (stat.isDirectory()) {
              entries.push({ name, path: relPath, type: "dir", children: walk(full, depth + 1) })
            } else {
              entries.push({ name, path: relPath, type: "file" })
            }
          }
          return entries
        }

        return c.json({ entries: walk(supadenseDir, 0) })
      },
    )

    // ── Read a file from the .supadense/ folder ───────────────────────────────
    .get(
      "/projects/:id/supadense-file-content",
      describeRoute({
        summary: "Read file content from .supadense folder",
        operationId: "el.projects.supadenseFileContent",
        responses: { 200: { description: "File content", content: { "application/json": { schema: resolver(z.object({ content: z.string(), path: z.string() })) } } } },
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

        const filePath = c.req.query("path")
        if (!filePath) return c.json({ error: "Missing path" }, 400)

        const { join, resolve } = require("node:path") as typeof import("node:path")
        const { readFileSync, existsSync } = require("node:fs") as typeof import("node:fs")
        const supadenseDir = path.join(userWorkspaceDir(userId), "el-projects", project.id, ".supadense")
        const full = resolve(join(supadenseDir, filePath))
        if (!full.startsWith(supadenseDir)) return c.json({ error: "Forbidden" }, 403)
        if (!existsSync(full)) return c.json({ error: "File not found" }, 404)

        try {
          const content = readFileSync(full, "utf-8")
          return c.json({ content, path: filePath })
        } catch {
          return c.json({ error: "Failed to read file" }, 500)
        }
      },
    )

    // ── Read a file from the cloned repo ──────────────────────────────────────
    .get(
      "/projects/:id/file-content",
      describeRoute({
        summary: "Read file content from cloned repo",
        operationId: "el.projects.fileContent",
        responses: { 200: { description: "File content", content: { "application/json": { schema: resolver(z.object({ content: z.string(), path: z.string() })) } } } },
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
        if (!project.repo_local_path) return c.json({ error: "Repo not cloned" }, 400)

        const filePath = c.req.query("path")
        if (!filePath) return c.json({ error: "Missing path" }, 400)

        // Security: ensure path stays within repo_local_path
        const { join, resolve } = require("node:path") as typeof import("node:path")
        const { readFileSync, existsSync } = require("node:fs") as typeof import("node:fs")
        const full = resolve(join(project.repo_local_path, filePath))
        if (!full.startsWith(project.repo_local_path)) return c.json({ error: "Forbidden" }, 403)
        if (!existsSync(full)) return c.json({ error: "File not found" }, 404)

        try {
          const content = readFileSync(full, "utf-8")
          return c.json({ content, path: filePath })
        } catch {
          return c.json({ error: "Failed to read file" }, 500)
        }
      },
    )

    // ── Init supadense folder ──────────────────────────────────────────────────
    .post(
      "/projects/:id/init-supadense",
      describeRoute({
        summary: "Create supadense/ folder in cloned repo",
        operationId: "el.projects.initSupadense",
        responses: { 200: { description: "Init result", content: { "application/json": { schema: resolver(z.object({ status: z.string(), pushed: z.boolean(), message: z.string().optional() })) } } } },
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
        if (!project.repo_local_path) return c.json({ error: "Repo not cloned yet" }, 400)

        const pat = project.context_json?.github_pat
        const branch = project.repo_branch ?? "main"

        const result = RepoIndexer.initSupadenseFolder(project.repo_local_path, branch, pat)

        const supadenseInit = result.pushed ? "pushed" : result.ok ? "local" : "none"
        Database.use((db) =>
          db.update(ElProjectTable)
            .set({ supadense_init: supadenseInit, time_updated: Date.now() })
            .where(eq(ElProjectTable.id, project.id))
            .run(),
        )

        return c.json({
          status: result.ok ? "ok" : "error",
          pushed: result.pushed,
          message: result.error,
        })
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

        const directory = path.join(userWorkspaceDir(userId), "el-projects", project.id)
        if (!existsSync(directory)) mkdirSync(directory, { recursive: true })

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
