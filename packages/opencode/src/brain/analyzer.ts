import { generateText }  from "ai"
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join }           from "node:path"
import { captureToBrain } from "./capture"
import { brainDb }        from "./db"

const MAX_CHARS = 6000

function safeRead(path: string, max = 4000): string {
  try { const t = readFileSync(path, "utf8"); return t.length > max ? t.slice(0, max) + "\n...[truncated]" : t }
  catch { return "" }
}

function dirTree(dir: string, depth = 0, maxDepth = 2): string {
  if (depth > maxDepth) return ""
  let out = ""
  try {
    const SKIP = new Set(["node_modules", ".git", ".brain", "dist", "build", ".next"])
    for (const e of readdirSync(dir).filter((e) => !e.startsWith(".") && !SKIP.has(e)).sort()) {
      const full  = join(dir, e)
      const isDir = statSync(full).isDirectory()
      out += "  ".repeat(depth) + (isDir ? `📁 ${e}/` : `📄 ${e}`) + "\n"
      if (isDir && depth < maxDepth) out += dirTree(full, depth + 1, maxDepth)
    }
  } catch {}
  return out
}

function findFiles(dir: string, patterns: RegExp[], maxDepth = 3, depth = 0): string[] {
  if (depth > maxDepth) return []
  const found: string[] = []
  try {
    const SKIP = new Set(["node_modules", ".git", "dist", "build"])
    for (const e of readdirSync(dir).filter((e) => !SKIP.has(e))) {
      const full = join(dir, e)
      const stat = statSync(full)
      if (stat.isDirectory()) found.push(...findFiles(full, patterns, maxDepth, depth + 1))
      else if (patterns.some((p) => p.test(e))) found.push(full.replace(dir, ""))
    }
  } catch {}
  return found
}

function collectRepoContext(repoPath: string): string {
  const sections: string[] = []

  for (const name of ["README.md", "README.txt", "README"]) {
    const c = safeRead(join(repoPath, name)); if (c) { sections.push(`## README\n${c}`); break }
  }

  const manifests: Record<string, string> = {
    "package.json": "Node.js manifest", "requirements.txt": "Python deps",
    "go.mod": "Go module", "Cargo.toml": "Rust manifest", "pyproject.toml": "Python pyproject",
  }
  for (const [file, label] of Object.entries(manifests)) {
    const c = safeRead(join(repoPath, file)); if (c) { sections.push(`## ${label} (${file})\n${c}`); break }
  }

  for (const f of ["docker-compose.yml", "docker-compose.yaml", "Dockerfile", "Makefile"]) {
    const c = safeRead(join(repoPath, f), 1500); if (c) sections.push(`## ${f}\n${c}`)
  }

  const envC = safeRead(join(repoPath, ".env.example"), 1200) || safeRead(join(repoPath, ".env.sample"), 1200)
  if (envC) sections.push(`## .env.example\n${envC}`)

  sections.push(`## Directory structure\n${dirTree(repoPath, 0, 2)}`)

  const routeFiles = findFiles(repoPath, [/routes?\.(ts|js|py|go)$/, /controllers?\.(ts|js|py|go)$/], 3).slice(0, 15)
  if (routeFiles.length) sections.push(`## API/Route files\n${routeFiles.join("\n")}`)

  const schemaFiles = findFiles(repoPath, [/schema\.(sql|prisma|ts)$/, /migration.*\.(sql|ts)$/], 4).slice(0, 4)
  if (schemaFiles.length) {
    let s = "## Database schema files\n"
    for (const f of schemaFiles) {
      if (/\.sql$|\.prisma$/.test(f)) s += `### ${f}\n${safeRead(join(repoPath, f), 1500)}\n`
      else s += `- ${f}\n`
    }
    sections.push(s)
  }

  for (const name of ["openapi.yaml", "openapi.json", "swagger.yaml"]) {
    const c = safeRead(join(repoPath, name), 2000) || safeRead(join(repoPath, "docs", name), 2000)
    if (c) { sections.push(`## API Spec\n${c}`); break }
  }

  return sections.join("\n\n---\n\n").slice(0, MAX_CHARS)
}

export interface AnalyzeResult {
  project_name: string
  docs_created: string[]
  project_slug: string
}

export async function analyzeRepo(
  repoPath:    string,
  projectName: string,
  model:       Parameters<typeof generateText>[0]["model"],
  sourceId =   "default",
): Promise<AnalyzeResult> {
  if (!existsSync(repoPath)) throw new Error(`Repo not found: ${repoPath}`)

  const context     = collectRepoContext(repoPath)
  const projectSlug = `L1/projects/${projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
  const docsCreated: string[] = []

  async function genDoc(system: string, extraContext = ""): Promise<string> {
    const { text } = await generateText({
      model,
      system,
      prompt: `Project: ${projectName}\n\n${context}${extraContext ? "\n\n" + extraContext : ""}`,
    })
    return text
  }

  // Architecture overview
  const archContent = await genDoc(
    "You are a software architect. Based on the repo structure (README, manifests, directory tree, config — NOT raw code), write a clear architecture overview in markdown covering: what it does, tech stack, main modules, data flow, deployment. Be concise.",
  )
  await captureToBrain({ content: archContent, slug: `${projectSlug}/architecture`, type: "synthesis", layer: 1, source_id: sourceId, query: `architecture of ${projectName}` })
  docsCreated.push(`${projectSlug}/architecture`)

  // API surface (if routes found)
  if (context.includes("API/Route files")) {
    const apiContent = await genDoc(
      "Based on the route file names and any API spec provided, document the API surface. List key endpoints with method, path, and purpose. Use markdown.",
    )
    await captureToBrain({ content: apiContent, slug: `${projectSlug}/api-surface`, type: "synthesis", layer: 1, source_id: sourceId, query: `api surface of ${projectName}` })
    docsCreated.push(`${projectSlug}/api-surface`)
  }

  // Data model (if schema found)
  if (context.includes("Database schema")) {
    const dataContent = await genDoc(
      "Based on the schema files, document the data model. List main tables/collections, key fields, and relationships in plain language. Use markdown.",
    )
    await captureToBrain({ content: dataContent, slug: `${projectSlug}/data-model`, type: "synthesis", layer: 1, source_id: sourceId, query: `data model of ${projectName}` })
    docsCreated.push(`${projectSlug}/data-model`)
  }

  // Ensure project page
  const db = brainDb()
  await db`
    INSERT INTO brain_pages (source_id, slug, layer, type, title, compiled_truth, content_hash, updated_at)
    VALUES (${sourceId}, ${projectSlug}, 1, 'project', ${projectName}, ${`# ${projectName}\n\nProject page.`}, 'auto', now())
    ON CONFLICT (source_id, slug) DO NOTHING
  `

  return { project_name: projectName, docs_created: docsCreated, project_slug: projectSlug }
}
