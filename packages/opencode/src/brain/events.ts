import { generateText }  from "ai"
import { existsSync }    from "node:fs"
import { captureToBrain } from "./capture"
import { brainDb }       from "./db"

interface GitCommit { hash: string; date: string; message: string; author: string }

const NOISE = [
  /^(fix typo|typo|format|lint|style|wip|tmp|temp|bump version|update deps|merge)/i,
  /^merge (pull request|branch)/i,
  /^v?\d+\.\d+\.\d+/,
  /^\s*$/,
]

function isSignificant(msg: string): boolean {
  return !NOISE.some((p) => p.test(msg.trim()))
}

async function runGit(repoPath: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", "-C", repoPath, ...args], { stdout: "pipe", stderr: "pipe" })
  const out  = await new Response(proc.stdout).text()
  await proc.exited
  return out.trim()
}

async function getGitLog(repoPath: string, days: number): Promise<GitCommit[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  const raw   = await runGit(repoPath, ["log", `--since=${since}`, "--format=%H|%as|%s|%an", "--no-merges"])
  if (!raw) return []

  return raw.split("\n")
    .map((line) => {
      const parts   = line.split("|")
      const hash    = parts[0]?.slice(0, 8) ?? ""
      const date    = parts[1] ?? ""
      const message = parts.slice(2, -1).join("|")
      const author  = parts[parts.length - 1] ?? ""
      return { hash, date, message, author }
    })
    .filter((c) => c.hash && c.message && isSignificant(c.message))
}

interface CategorisedEvent {
  date:        string
  message:     string
  category:    "fix" | "feature" | "refactor" | "migration" | "removal" | "other"
  summary:     string
  worth_doc:   boolean
}

async function categoriseCommits(
  commits:     GitCommit[],
  projectName: string,
  model:       Parameters<typeof generateText>[0]["model"],
): Promise<CategorisedEvent[]> {
  if (!commits.length) return []

  const list = commits.map((c) => `${c.date} | ${c.message}`).join("\n")

  const { text } = await generateText({
    model,
    system: `Categorise these git commits for project "${projectName}". Return a JSON array only.
Each item: { "date":"YYYY-MM-DD", "message":"original", "category":"fix|feature|refactor|migration|removal|other", "summary":"1-2 sentence plain English explanation", "worth_doc":true/false }
worth_doc=true for: new features, significant fixes, schema migrations, API changes, major refactors.
worth_doc=false for: minor fixes, dep updates, formatting.`,
    prompt: list,
  })

  try {
    const clean = text.trim()
    const start = clean.indexOf("[")
    return JSON.parse(clean.slice(start)) as CategorisedEvent[]
  } catch {
    return commits.map((c) => ({
      date: c.date, message: c.message,
      category: "other" as const, summary: c.message, worth_doc: false,
    }))
  }
}

export interface EventsResult {
  project_name:   string
  commits_found:  number
  significant:    number
  docs_created:   number
  timeline_added: number
  project_slug:   string
}

export async function captureCodeEvents(
  repoPath:    string,
  projectName: string,
  model:       Parameters<typeof generateText>[0]["model"],
  days = 30,
  sourceId = "default",
): Promise<EventsResult> {
  if (!existsSync(repoPath)) throw new Error(`Repo not found: ${repoPath}`)

  const projectSlug = `L1/projects/${projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
  const db = brainDb()

  // Ensure project page exists
  await db`
    INSERT INTO brain_pages (source_id, slug, layer, type, title, compiled_truth, content_hash, updated_at)
    VALUES (${sourceId}, ${projectSlug}, 1, 'project', ${projectName}, ${`# ${projectName}`}, 'auto', now())
    ON CONFLICT (source_id, slug) DO NOTHING
  `
  const pageRows = await db`SELECT id FROM brain_pages WHERE slug = ${projectSlug} AND source_id = ${sourceId} LIMIT 1` as { id: number }[]
  const pageId   = pageRows[0]?.id
  if (!pageId) return { project_name: projectName, commits_found: 0, significant: 0, docs_created: 0, timeline_added: 0, project_slug: projectSlug }

  const commits = await getGitLog(repoPath, days)
  if (!commits.length) return { project_name: projectName, commits_found: 0, significant: 0, docs_created: 0, timeline_added: 0, project_slug: projectSlug }

  const events = await categoriseCommits(commits, projectName, model)
  let docsCreated = 0, timelineAdded = 0

  for (const event of events) {
    // Timeline entry for every significant commit
    await db`
      INSERT INTO brain_timeline (page_id, date, source, summary)
      VALUES (${pageId}, ${event.date}::date, ${"git:" + event.category}, ${event.summary.slice(0, 500)})
      ON CONFLICT (page_id, date, summary, source) DO NOTHING
    `.catch(() => null)
    timelineAdded++

    // Decision doc for worth_doc events
    if (event.worth_doc) {
      const slug = `${projectSlug}/decisions/${event.date}-${event.message.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, "-").slice(0, 40)}`
      const content = `## ${event.message}\n\n**Date:** ${event.date}  \n**Category:** ${event.category}\n\n${event.summary}`
      await captureToBrain({ content, slug, type: "synthesis", layer: 1, source_id: sourceId, query: event.message })
      docsCreated++
    }
  }

  return { project_name: projectName, commits_found: commits.length, significant: events.length, docs_created: docsCreated, timeline_added: timelineAdded, project_slug: projectSlug }
}
