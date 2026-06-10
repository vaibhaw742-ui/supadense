// Routes for registering and managing local projects (code that lives on the user's Mac)
// These projects are NOT cloned by supadense — they already exist locally.
//
// Workflow:
//   1. User registers their local project path
//   2. Supadense creates .brain/ and .brain-sources/ inside it
//   3. User configures Claude Code MCP with SUPADENSE_PROJECT=project-id
//   4. Brain tools in Claude Code sessions scope to this project's brain

import { Hono }                         from "hono"
import { streamSSE }                     from "hono/streaming"
import { existsSync, mkdirSync,
         writeFileSync, readdirSync,
         statSync, readFileSync,
         unlinkSync }                   from "node:fs"
import { join, basename, normalize }     from "node:path"
import { Database }                      from "../../storage/db"
import { LocalProjectTable, ApiRequestLogTable } from "../../project/local-project.sql"
import { eq, and, desc, gte }            from "drizzle-orm"
import { randomUUID }                    from "node:crypto"
import { initialSync }                   from "../../brain/watcher"
import { startBrainWatcher }             from "../../brain/watcher"
import { setBrainSessionCtx }            from "../../brain/session-context"
import { brainSearch }                   from "../../brain/search/hybrid"
import { captureToBrain }                from "../../brain/capture"

// ── Source type detection ─────────────────────────────────────────────────────
export type SourceType =
  | "x"        // twitter / x.com
  | "linkedin"
  | "youtube"
  | "github"
  | "pdf"
  | "notion"
  | "medium"
  | "substack"
  | "reddit"
  | "hackernews"
  | "arxiv"
  | "web"      // generic website
  | "note"     // plain text note (no URL)

export function detectSourceType(url: string | null, filename?: string): SourceType {
  // PDF by file extension
  if (filename?.toLowerCase().endsWith(".pdf")) return "pdf"
  if (!url) return "note"

  try {
    const host = new URL(url).hostname.replace(/^www\./, "")
    if (host === "x.com" || host === "twitter.com") return "x"
    if (host === "linkedin.com" || host.endsWith(".linkedin.com")) return "linkedin"
    if (host === "youtube.com" || host === "youtu.be") return "youtube"
    if (host === "github.com") return "github"
    if (host === "notion.so" || host.endsWith(".notion.so")) return "notion"
    if (host === "medium.com" || host.endsWith(".medium.com")) return "medium"
    if (host.endsWith(".substack.com") || host === "substack.com") return "substack"
    if (host === "reddit.com" || host.endsWith(".reddit.com")) return "reddit"
    if (host === "news.ycombinator.com") return "hackernews"
    if (host === "arxiv.org") return "arxiv"
    if (url.endsWith(".pdf") || url.includes(".pdf?")) return "pdf"
  } catch { /* malformed URL */ }

  return "web"
}

// ── Per-project SSE subscribers for .supadense/ change notifications ──────────
type SSEListener = (event: string) => void
const _sseListeners = new Map<string, Set<SSEListener>>()

export function emitProjectChange(projectId: string, event = "change") {
  const listeners = _sseListeners.get(projectId)
  if (listeners) for (const fn of listeners) fn(event)
}

function addListener(projectId: string, fn: SSEListener) {
  if (!_sseListeners.has(projectId)) _sseListeners.set(projectId, new Set())
  _sseListeners.get(projectId)!.add(fn)
}

function removeListener(projectId: string, fn: SSEListener) {
  _sseListeners.get(projectId)?.delete(fn)
}

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
    name:        string
    local_path:  string
    github_repo?: string
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
    github_repo: body.github_repo ?? null,
    time_created: now,
    time_updated: now,
  }).onConflictDoUpdate({
    target: LocalProjectTable.id,
    set: { user_id: userId, local_path: body.local_path, brain_dir: brainDir, sources_dir: sourcesDir, github_repo: body.github_repo ?? null, time_updated: now },
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

// GET /local-projects/all-sources
// Aggregate all sources across all local projects for the Sources tab
LocalProjectRoutes.get("/all-sources", (c) => {
  const userId = getUserId(c)
  if (!userId) return json(c, { error: "Not authenticated" }, 401)

  const db       = Database.use((db) => db)
  const projects = db.select().from(LocalProjectTable)
    .where(eq(LocalProjectTable.user_id, userId))
    .all()

  const allSources: Array<{
    id:           string
    project_id:   string
    project_name: string
    filename:     string
    title:        string
    url:          string | null
    source_type:  string
    status:       "processing" | "done" | "failed"
    size:         number
    time_created: number
  }> = []

  for (const proj of projects) {
    if (!existsSync(proj.sources_dir)) continue
    const files = readdirSync(proj.sources_dir)
    for (const filename of files) {
      const filePath = join(proj.sources_dir, filename as string)
      const stat     = statSync(filePath)
      let title    = (filename as string).replace(/\.(md|txt)$/, "").replace(/-/g, " ")
      let url: string | null = null
      let status: "processing" | "done" | "failed" = "done"
      let source_type: SourceType = "web"

      try {
        const first500 = readFileSync(filePath, "utf8").slice(0, 500)
        const titleMatch = first500.match(/^#\s+(.+)$/m)
        if (titleMatch) title = titleMatch[1].trim()
        const urlMatch = first500.match(/^Source:\s+(https?:\/\/.+)$/m)
        if (urlMatch) url = urlMatch[1].trim()
        const typeMatch = first500.match(/^SourceType:\s+(\S+)$/m)
        source_type = typeMatch ? (typeMatch[1].trim() as SourceType) : detectSourceType(url, filename as string)
        if (first500.includes("Status: processing")) status = "processing"
        else if (first500.includes("Status: failed")) status = "failed"
      } catch { /* skip unreadable */ }

      allSources.push({
        id:           `local-src-${proj.id}-${(filename as string)}`,
        project_id:   proj.id,
        project_name: proj.name,
        filename:     filename as string,
        title,
        url,
        source_type,
        status,
        size:         stat.size,
        time_created: Math.floor(stat.birthtimeMs ?? stat.ctimeMs),
      })
    }
  }

  allSources.sort((a, b) => b.time_created - a.time_created)
  return json(c, { sources: allSources, total: allSources.length })
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

// ── GitHub activity cache ──────────────────────────────────────────────────
type GithubActivity = {
  repo:       string
  prs:        GithubPR[]
  issues:     GithubIssue[]
  fetched_at: number
}
type GithubPR = {
  number:    number
  title:     string
  author:    string
  state:     "open" | "draft"
  reviews:   "approved" | "changes_requested" | "pending" | "none"
  comments:  number
  updated_at: string
  url:       string
  labels:    string[]
}
type GithubIssue = {
  number:    number
  title:     string
  author:    string
  labels:    string[]
  comments:  number
  updated_at: string
  url:       string
}
const _activityCache = new Map<string, GithubActivity>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

async function fetchGithubActivity(repo: string, token?: string | null): Promise<GithubActivity> {
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  }
  if (token) headers["Authorization"] = `Bearer ${token}`

  const base = `https://api.github.com/repos/${repo}`

  const [prsRes, issuesRes] = await Promise.all([
    fetch(`${base}/pulls?state=open&per_page=30`, { headers }),
    fetch(`${base}/issues?state=open&per_page=30`, { headers }),
  ])

  const prsRaw: any[]    = prsRes.ok    ? await prsRes.json()    : []
  const issuesRaw: any[] = issuesRes.ok ? await issuesRes.json() : []

  // Fetch review status for open PRs (up to 10 to avoid rate limiting)
  const prSlice = prsRaw.slice(0, 10)
  const reviewsMap = new Map<number, string>()
  await Promise.all(prSlice.map(async (pr: any) => {
    try {
      const rRes = await fetch(`${base}/pulls/${pr.number}/reviews?per_page=50`, { headers })
      if (!rRes.ok) return
      const reviews: any[] = await rRes.json()
      // Latest review state per reviewer
      const byReviewer = new Map<string, string>()
      for (const r of reviews) byReviewer.set(r.user?.login, r.state)
      const states = Array.from(byReviewer.values())
      if (states.includes("CHANGES_REQUESTED")) reviewsMap.set(pr.number, "changes_requested")
      else if (states.includes("APPROVED")) reviewsMap.set(pr.number, "approved")
      else reviewsMap.set(pr.number, "pending")
    } catch { /* ignore */ }
  }))

  const prs: GithubPR[] = prsRaw.map((pr: any) => ({
    number:    pr.number,
    title:     pr.title,
    author:    pr.user?.login ?? "unknown",
    state:     pr.draft ? "draft" : "open",
    reviews:   (reviewsMap.get(pr.number) ?? "none") as GithubPR["reviews"],
    comments:  pr.comments ?? 0,
    updated_at: pr.updated_at,
    url:       pr.html_url,
    labels:    (pr.labels ?? []).map((l: any) => l.name),
  }))

  // issues endpoint returns both issues AND prs — filter out prs
  const issues: GithubIssue[] = issuesRaw
    .filter((i: any) => !i.pull_request)
    .map((i: any) => ({
      number:    i.number,
      title:     i.title,
      author:    i.user?.login ?? "unknown",
      labels:    (i.labels ?? []).map((l: any) => l.name),
      comments:  i.comments ?? 0,
      updated_at: i.updated_at,
      url:       i.html_url,
    }))

  return { repo, prs, issues, fetched_at: Date.now() }
}

// GET /local-projects/:id/github-activity
LocalProjectRoutes.get("/:id/github-activity", async (c) => {
  const userId = getUserId(c)
  const id     = c.req.param("id")
  const force  = c.req.query("force") === "true"
  if (!userId) return json(c, { error: "Not authenticated" }, 401)

  const db = Database.use((db) => db)
  const rows = db.select().from(LocalProjectTable)
    .where(and(eq(LocalProjectTable.id, id), eq(LocalProjectTable.user_id, userId)))
    .all()
  const row = rows[0]
  if (!row) return json(c, { error: "Project not found" }, 404)
  if (!row.github_repo) return json(c, { error: "No GitHub repo linked to this project", hint: "Run supadense init in a GitHub repo, or set github_repo manually." }, 404)

  // Serve from cache if fresh
  const cached = _activityCache.get(id)
  if (!force && cached && Date.now() - cached.fetched_at < CACHE_TTL_MS) {
    return json(c, { ...cached, cached: true })
  }

  // Fetch fresh — try to use GitHub token if available
  let ghToken: string | null = null
  try {
    // Reuse the GitHub OAuth token from el_github_tokens if present
    const tokenRows = (db as any).all?.(`SELECT access_token FROM el_github_tokens WHERE user_id = ?`, [userId]) ?? []
    ghToken = tokenRows[0]?.access_token ?? null
  } catch { /* table may not exist */ }

  try {
    const activity = await fetchGithubActivity(row.github_repo, ghToken)
    _activityCache.set(id, activity)
    return json(c, { ...activity, cached: false })
  } catch (e: any) {
    return json(c, { error: `GitHub fetch failed: ${e?.message ?? "unknown"}` }, 502)
  }
})

// PATCH /local-projects/:id/github-repo
// Manually set or update the GitHub repo for a project
LocalProjectRoutes.patch("/:id/github-repo", async (c) => {
  const userId = getUserId(c)
  const id     = c.req.param("id")
  if (!userId) return json(c, { error: "Not authenticated" }, 401)

  const body = await c.req.json().catch(() => null) as { github_repo: string } | null
  if (!body?.github_repo) return json(c, { error: "github_repo required" }, 400)

  // Basic validation: should be "owner/repo"
  if (!/^[^\/]+\/[^\/]+$/.test(body.github_repo)) return json(c, { error: "github_repo must be in format owner/repo" }, 400)

  const db = Database.use((db) => db)
  db.update(LocalProjectTable)
    .set({ github_repo: body.github_repo, time_updated: Date.now() })
    .where(and(eq(LocalProjectTable.id, id), eq(LocalProjectTable.user_id, userId)))
    .run()

  _activityCache.delete(id) // bust cache
  return json(c, { updated: true, github_repo: body.github_repo })
})

// DELETE /local-projects/:id
// Unregister project from DB. Pass ?deleteDisk=true to also delete .supadense/ from disk.
LocalProjectRoutes.delete("/:id", async (c) => {
  const userId     = getUserId(c)
  const id         = c.req.param("id")
  const deleteDisk = c.req.query("deleteDisk") === "true"
  if (!userId) return json(c, { error: "Not authenticated" }, 401)

  const db = Database.use((db) => db)

  // Fetch project row before deleting (need local_path for disk cleanup)
  const rows = db.select().from(LocalProjectTable)
    .where(and(eq(LocalProjectTable.id, id), eq(LocalProjectTable.user_id, userId)))
    .all()
  const row = rows[0]

  if (!row) return json(c, { error: "Project not found" }, 404)

  // Notify SSE clients before removing from DB so they can react
  emitProjectChange(id, "deleted")

  db.delete(LocalProjectTable)
    .where(and(eq(LocalProjectTable.id, id), eq(LocalProjectTable.user_id, userId)))
    .run()

  if (deleteDisk && row.local_path) {
    const supadenseDir = join(row.local_path, ".supadense")
    if (existsSync(supadenseDir)) {
      const { rm } = await import("node:fs/promises")
      await rm(supadenseDir, { recursive: true, force: true })
    }
  }

  return json(c, { deleted: true, diskDeleted: deleteDisk })
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
    const hash  = createHash("sha256").update(body.url).digest("hex").slice(0, 8)
    const fname = `url-${hash}.md`
    const filePath = join(row.sources_dir, fname)

    // Write a pending placeholder immediately so the file shows up in sources list
    const sourceType = detectSourceType(body.url, undefined)
    writeFileSync(filePath,
      `# ${body.title ?? body.url}\nSource: ${body.url}\nSourceType: ${sourceType}\nStatus: processing\n\n_Content is being extracted in the background…_`, "utf8")

    // Fire-and-forget: scrape via Airtop then update the file
    void (async () => {
      try {
        const AIRTOP_AGENT_WEBHOOK =
          "https://api.airtop.ai/api/hooks/agents/e0103755-2146-43d3-bd25-5410d00b3654/webhooks/984d5de3-2807-43c8-af8a-f441652a11f4"

        const apiKey = process.env.AIRTOP_API_KEY
        let content = ""
        let title: string = body.title ?? body.url ?? "Untitled"

        if (!apiKey) throw new Error("AIRTOP_API_KEY is not configured — cannot process URLs")

        // Trigger Airtop agent
        const triggerRes = await fetch(AIRTOP_AGENT_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ configVars: { url: body.url } }),
          signal: AbortSignal.timeout(15_000),
        })
        if (!triggerRes.ok) throw new Error(`Airtop trigger failed: ${triggerRes.status}`)
        const triggerBody = await triggerRes.json() as { invocationId?: string }
        const { invocationId } = triggerBody
        if (!invocationId) throw new Error("Airtop did not return invocationId")

        // Poll — Airtop takes 60-100s minimum
        const pollUrl = `https://api.airtop.ai/api/hooks/agents/e0103755-2146-43d3-bd25-5410d00b3654/invocations/${invocationId}/result`
        await new Promise((r) => setTimeout(r, 60_000))
        let elapsed = 60_000
        const MAX_WAIT = 5 * 60 * 1000

        while (elapsed < MAX_WAIT) {
          await new Promise((r) => setTimeout(r, 2_000))
          elapsed += 2_000
          const res = await fetch(pollUrl, {
            headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
            signal: AbortSignal.timeout(10_000),
          })
          if (!res.ok) continue
          const data = await res.json() as { status?: string; output?: unknown; error?: string }
          const statusLower = data.status?.toLowerCase() ?? ""
          if (statusLower === "failed") throw new Error(`Airtop failed: ${data.error ?? "unknown"}`)
          const outputObj = data.output as Record<string, unknown> | undefined
          const isDone = statusLower === "completed" || outputObj?.success === true
          if (isDone && data.output != null) {
            content = typeof data.output === "string"
              ? data.output
              : String(outputObj?.text_md ?? outputObj?.markdown ?? outputObj?.content ?? outputObj?.text ?? JSON.stringify(data.output))
            title = (outputObj?.title as string | undefined) ?? content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? title
            content = content.slice(0, 40_000)
            break
          }
        }
        if (!content) throw new Error("Airtop timed out")

        // Write final content
        writeFileSync(filePath, `# ${title}\nSource: ${body.url}\nSourceType: ${sourceType}\n\n${content}`, "utf8")
        emitProjectChange(id)

        // Capture a summary into brain
        await captureToBrain({
          content:   `# ${title}\n\n${body.url}\n\n${content.slice(0, 5000)}`,
          slug:      `L0/sources/url-${hash}`,
          layer:     0,
          source_id: row.source_id,
        })
        console.log(`[local-sources] Processed URL ${body.url} → ${fname}`)
      } catch (err) {
        // Update file to show error
        writeFileSync(filePath,
          `# ${body.title ?? body.url}\nSource: ${body.url}\nSourceType: ${sourceType}\nStatus: failed\n\nError: ${String(err)}`, "utf8")
        console.error(`[local-sources] Failed to process URL ${body.url}:`, err)
      }
    })()

    return json(c, {
      queued: true,
      fname,
      type: "url",
      message: "URL is being processed in the background via Airtop. Check sources list in a few minutes.",
    })
  }

  if (body.content) {
    const hash  = createHash("sha256").update(body.content).digest("hex").slice(0, 8)
    const fname = `${body.type ?? "note"}-${hash}.md`
    writeFileSync(join(row.sources_dir, fname),
      `# ${body.title ?? "Note"}\nSourceType: note\n\n${body.content}`, "utf8")
    await captureToBrain({
      content:   body.content,
      slug:      `L0/sources/${body.type ?? "note"}-${hash}`,
      layer:     0,
      source_id: row.source_id,
    })
    emitProjectChange(id)
    return json(c, { saved: fname, type: body.type ?? "text" })
  }

  return json(c, { error: "No content to save" }, 400)
})

// GET /local-projects/:id/graph
// Returns brain files as graph nodes for visualization
LocalProjectRoutes.get("/:id/graph", (c) => {
  const userId = getUserId(c)
  const id     = c.req.param("id")
  if (!userId) return json(c, { error: "Not authenticated" }, 401)

  const db  = Database.use((db) => db)
  const row = db.select().from(LocalProjectTable)
    .where(and(eq(LocalProjectTable.id, id), eq(LocalProjectTable.user_id, userId)))
    .get()

  if (!row) return json(c, { error: "Not found" }, 404)

  const nodes: Array<{ id: string; type: string; label: string; layer: string }> = []
  const edges: Array<{ source: string; target: string }> = []

  // Root project node
  const rootId = `proj_${row.id}`
  nodes.push({ id: rootId, type: "project", label: row.name, layer: "root" })

  const layerColors: Record<string, string> = { L0: "decision", L1: "summary", L2: "pattern" }

  for (const layer of ["L0", "L1", "L2"]) {
    const dir = join(row.brain_dir, layer)
    if (!existsSync(dir)) continue

    const files = readdirSync(dir, { recursive: true }) as string[]
    const mdFiles = files.filter(f => (f as string).endsWith(".md"))

    // Layer node (always show, even if empty)
    const layerId = `layer_${row.id}_${layer}`
    nodes.push({ id: layerId, type: "category", label: `${layer} — ${layerColors[layer]}`, layer })
    edges.push({ source: rootId, target: layerId })

    for (const f of mdFiles) {
      const fileId = `brain_${row.id}_${layer}_${(f as string).replace(/\//g, "_")}`
      const label  = (f as string).replace(/\.md$/, "").replace(/_/g, " ")
      nodes.push({ id: fileId, type: "resource", label, layer })
      edges.push({ source: layerId, target: fileId })
    }
  }

  // Sources node + one child per source file
  if (existsSync(row.sources_dir)) {
    const sourceFiles = (readdirSync(row.sources_dir) as string[]).filter(f => f.endsWith(".md") || f.endsWith(".txt"))
    if (sourceFiles.length > 0) {
      const sourcesNodeId = `sources_${row.id}`
      nodes.push({ id: sourcesNodeId, type: "category", label: "sources", layer: "sources" })
      edges.push({ source: rootId, target: sourcesNodeId })

      for (const f of sourceFiles) {
        const filePath = join(row.sources_dir, f)
        let label = f.replace(/\.(md|txt)$/, "").replace(/-/g, " ")
        try {
          const first200 = readFileSync(filePath, "utf8").slice(0, 200)
          const m = first200.match(/^#\s+(.+)$/m)
          if (m) label = m[1].trim()
        } catch { /* skip */ }
        const nodeId = `source_${row.id}_${f}`
        nodes.push({ id: nodeId, type: "source", label, layer: "sources" })
        edges.push({ source: sourcesNodeId, target: nodeId })
      }
    }
  }

  return json(c, { nodes, edges })
})

// GET /local-projects/:id/brain-file?path=L0/foo.md
// Returns the text content of a single brain file
LocalProjectRoutes.get("/:id/brain-file", (c) => {
  const userId = getUserId(c)
  const id     = c.req.param("id")
  if (!userId) return json(c, { error: "Not authenticated" }, 401)

  const filePath = c.req.query("path") ?? ""
  // Security: must start with a valid layer prefix and contain no ..
  if (!filePath || !/^(L0|L1|L2)\//.test(filePath) || filePath.includes("..")) {
    return json(c, { error: "Invalid path: must start with L0/, L1/, or L2/ and contain no .." }, 400)
  }

  const db  = Database.use((db) => db)
  const row = db.select().from(LocalProjectTable)
    .where(and(eq(LocalProjectTable.id, id), eq(LocalProjectTable.user_id, userId)))
    .get()

  if (!row) return json(c, { error: "Not found" }, 404)

  const fullPath = normalize(join(row.brain_dir, filePath))
  // Ensure resolved path is still inside brain_dir
  if (!fullPath.startsWith(normalize(row.brain_dir))) {
    return json(c, { error: "Path traversal not allowed" }, 400)
  }

  if (!existsSync(fullPath)) return json(c, { error: "File not found" }, 404)

  try {
    const content = readFileSync(fullPath, "utf8")
    return json(c, { content, path: filePath })
  } catch {
    return json(c, { error: "Failed to read file" }, 500)
  }
})

// GET /local-projects/:id/sources/:filename — serve raw file content
LocalProjectRoutes.get("/:id/sources/:filename", (c) => {
  const userId   = getUserId(c)
  const id       = c.req.param("id")
  const filename = c.req.param("filename")
  if (!userId) return json(c, { error: "Not authenticated" }, 401)
  if (filename.includes("..") || filename.includes("/")) return json(c, { error: "Invalid filename" }, 400)

  const db  = Database.use((db) => db)
  const row = db.select().from(LocalProjectTable)
    .where(and(eq(LocalProjectTable.id, id), eq(LocalProjectTable.user_id, userId)))
    .get()

  if (!row) return json(c, { error: "Not found" }, 404)
  const filePath = join(row.sources_dir, filename)
  if (!existsSync(filePath)) return json(c, { error: "File not found" }, 404)

  try {
    const content = readFileSync(filePath, "utf8")
    return c.text(content, 200, { "Content-Type": "text/plain; charset=utf-8" })
  } catch {
    return json(c, { error: "Failed to read file" }, 500)
  }
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

  const files = readdirSync(row.sources_dir).map(f => {
    const filePath = join(row.sources_dir, f as string)
    let title    = (f as string).replace(/\.(md|txt)$/, "").replace(/-/g, " ")
    let url: string | null = null
    let status: "processing" | "done" | "failed" = "done"
    let source_type: SourceType = "web"
    try {
      const first500 = readFileSync(filePath, "utf8").slice(0, 500)
      const titleMatch = first500.match(/^#\s+(.+)$/m)
      if (titleMatch) title = titleMatch[1].trim()
      const urlMatch = first500.match(/^Source:\s+(https?:\/\/.+)$/m)
      if (urlMatch) url = urlMatch[1].trim()
      const typeMatch = first500.match(/^SourceType:\s+(\S+)$/m)
      source_type = typeMatch ? (typeMatch[1].trim() as SourceType) : detectSourceType(url, f as string)
      if (first500.includes("Status: processing")) status = "processing"
      else if (first500.includes("Status: failed"))  status = "failed"
    } catch { /* skip */ }
    return { name: f as string, size: statSync(filePath).size, title, url, source_type, status }
  })
  return json(c, { sources: files, total: files.length })
})

// DELETE /local-projects/:id/sources/:filename
// Deletes the source file and removes any brain file references to it
LocalProjectRoutes.delete("/:id/sources/:filename", (c) => {
  const userId   = getUserId(c)
  const id       = c.req.param("id")
  const filename = c.req.param("filename")
  if (!userId) return json(c, { error: "Not authenticated" }, 401)

  // Reject path traversal
  if (filename.includes("/") || filename.includes("..")) {
    return json(c, { error: "Invalid filename" }, 400)
  }

  const db  = Database.use((db) => db)
  const row = db.select().from(LocalProjectTable)
    .where(and(eq(LocalProjectTable.id, id), eq(LocalProjectTable.user_id, userId)))
    .get()

  if (!row) return json(c, { error: "Not found" }, 404)

  const filePath = join(row.sources_dir, filename)
  if (!existsSync(filePath)) return json(c, { error: "Source not found" }, 404)

  // Delete the source file
  unlinkSync(filePath)

  // Scrub references from brain files
  // Brain files reference sources as: "Source: <filename>" or links like [text](../sources/filename)
  const brainCleaned: string[] = []
  if (existsSync(row.brain_dir)) {
    const scanDir = (dir: string) => {
      try {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry as string)
          try {
            const stat = statSync(full)
            if (stat.isDirectory()) { scanDir(full); continue }
            if (!(entry as string).endsWith(".md")) continue
            const content = readFileSync(full, "utf8")
            // Remove lines referencing this source file
            const cleaned = content
              .split("\n")
              .filter(line => !line.includes(filename))
              .join("\n")
            if (cleaned !== content) {
              writeFileSync(full, cleaned, "utf8")
              brainCleaned.push(full)
            }
          } catch { /* skip unreadable files */ }
        }
      } catch { /* skip unreadable dirs */ }
    }
    scanDir(row.brain_dir)
  }

  emitProjectChange(id)
  return json(c, { deleted: true, name: filename, brain_files_cleaned: brainCleaned.length })
})

// GET /local-projects/:id/watch  — SSE stream, pushes "change" events when .supadense/ changes
LocalProjectRoutes.get("/:id/watch", async (c) => {
  const userId = getUserId(c)
  const id     = c.req.param("id")
  if (!userId) return json(c, { error: "Not authenticated" }, 401)

  const db  = Database.use((db) => db)
  const row = db.select().from(LocalProjectTable)
    .where(and(eq(LocalProjectTable.id, id), eq(LocalProjectTable.user_id, userId)))
    .get()
  if (!row) return json(c, { error: "Not found" }, 404)

  // Start a chokidar watcher on .supadense/ for this connection
  const supadenseDir = join(row.local_path, ".supadense")

  return streamSSE(c, async (stream) => {
    // Send initial heartbeat
    await stream.writeSSE({ data: "connected", event: "connected" })

    let fsWatcher: any = null

    const onChange = async (event: string) => {
      try { await stream.writeSSE({ data: event, event: "change" }) } catch { /* client disconnected */ }
    }

    // Register SSE listener for programmatic emits (e.g. from source add/delete routes)
    addListener(id, onChange)

    // Also watch the filesystem directly — use polling so changes from the host Mac
    // (via CLI running outside Docker) are reliably detected across the volume mount
    try {
      const { watch } = await import("chokidar")
      if (existsSync(supadenseDir)) {
        fsWatcher = watch(supadenseDir, {
          ignoreInitial: true, persistent: false,
          usePolling: true, interval: 1500, binaryInterval: 3000,
        })
        fsWatcher.on("all", () => { void onChange("change") })
      }
    } catch { /* chokidar not available */ }

    // Keep alive with periodic heartbeat
    const heartbeat = setInterval(async () => {
      try { await stream.writeSSE({ data: "ping", event: "ping" }) } catch { clearInterval(heartbeat) }
    }, 15000)

    // Cleanup on disconnect
    stream.onAbort(() => {
      clearInterval(heartbeat)
      removeListener(id, onChange)
      if (fsWatcher) fsWatcher.close()
    })

    // Keep stream open
    await new Promise<void>((resolve) => stream.onAbort(resolve))
  })
})

// ── API Request Logging ────────────────────────────────────────────────────────

// POST /local-projects/api-requests/log  — record one request (called by brain MCP tools)
LocalProjectRoutes.post("/api-requests/log", async (c) => {
  const userId = getUserId(c)
  if (!userId) return json(c, { error: "Not authenticated" }, 401)

  const body = await c.req.json().catch(() => null) as {
    type: string
    status: number
    duration_ms: number
    project_id?: string
    document_id?: string
  } | null

  if (!body || !body.type || body.status == null || body.duration_ms == null) {
    return json(c, { error: "type, status, duration_ms required" }, 400)
  }

  const db = Database.use((db) => db)
  const now = Date.now()
  db.insert(ApiRequestLogTable).values({
    id:           randomUUID(),
    user_id:      userId,
    project_id:   body.project_id ?? null,
    type:         body.type,
    status:       body.status,
    duration_ms:  body.duration_ms,
    document_id:  body.document_id ?? null,
    time_created: now,
  }).run()

  return json(c, { ok: true })
})

// GET /local-projects/api-requests — list requests with optional filters
LocalProjectRoutes.get("/api-requests", (c) => {
  const userId = getUserId(c)
  if (!userId) return json(c, { error: "Not authenticated" }, 401)

  const range      = c.req.query("range") ?? "30d"   // "1d" | "7d" | "30d" | "all"
  const typeFilter = c.req.query("type")              // "search" | "add" | etc
  const statusFilter = c.req.query("status")          // "2xx" | "4xx" | "5xx" | "error"

  const rangeMs: Record<string, number> = { "1d": 86400000, "7d": 604800000, "30d": 2592000000 }
  const since = rangeMs[range] ? Date.now() - rangeMs[range] : 0

  const db = Database.use((db) => db)

  let rows = db
    .select()
    .from(ApiRequestLogTable)
    .where(
      and(
        eq(ApiRequestLogTable.user_id, userId),
        since > 0 ? gte(ApiRequestLogTable.time_created, since) : undefined,
      )
    )
    .orderBy(desc(ApiRequestLogTable.time_created))
    .all()

  // Post-filter by type
  if (typeFilter) rows = rows.filter(r => r.type === typeFilter)

  // Post-filter by status group
  if (statusFilter) {
    if (statusFilter === "2xx") rows = rows.filter(r => r.status >= 200 && r.status < 300)
    else if (statusFilter === "4xx") rows = rows.filter(r => r.status >= 400 && r.status < 500)
    else if (statusFilter === "5xx") rows = rows.filter(r => r.status >= 500)
    else if (statusFilter === "error") rows = rows.filter(r => r.status >= 400)
  }

  // Aggregate stats
  const total = rows.length
  const successful = rows.filter(r => r.status >= 200 && r.status < 300).length
  const searchRows = rows.filter(r => r.type === "search")
  const avgLatency = searchRows.length
    ? Math.round(searchRows.reduce((s, r) => s + r.duration_ms, 0) / searchRows.length)
    : null

  // Type counts for donut chart
  const typeCounts: Record<string, number> = {}
  for (const row of rows) typeCounts[row.type] = (typeCounts[row.type] ?? 0) + 1

  return json(c, {
    requests: rows,
    stats: { total, successful, avg_latency_ms: avgLatency, type_counts: typeCounts },
  })
})

