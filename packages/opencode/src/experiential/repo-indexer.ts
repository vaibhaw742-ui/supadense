import { spawnSync } from "child_process"
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "fs"
import path from "path"

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Supadense",
  GIT_AUTHOR_EMAIL: "sync@supadense",
  GIT_COMMITTER_NAME: "Supadense",
  GIT_COMMITTER_EMAIL: "sync@supadense",
  GIT_TERMINAL_PROMPT: "0",
}

function runGit(args: string[], cwd: string) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, timeout: 300_000 })
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? "").trim(),
    stderr: ((result.stderr ?? "").trim()) || result.error?.message || "",
  }
}

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "coverage", ".next", "out",
  ".cache", ".turbo", ".vercel", ".husky", "vendor", "__pycache__",
  ".mypy_cache", ".pytest_cache", "target", "bin", "obj", ".gradle",
  "pods", "Pods", ".expo", "supadense",
])

const KEY_FILE_PATTERNS = [
  /^index\.(ts|tsx|js|jsx|py|go|rs|rb|java|cs)$/,
  /^main\.(ts|tsx|js|jsx|py|go|rs)$/,
  /^server\.(ts|js)$/,
  /^app\.(ts|tsx|js|jsx)$/,
  /^router\.(ts|js)$/,
  /^schema\.(ts|js|sql|prisma)$/,
  /\.config\.(ts|js|mjs|cjs)$/,
  /^(package|composer|Cargo|pyproject)\.(json|toml|mod)$/,
  /^(Dockerfile|docker-compose\.yml)$/,
  /^README\.(md|txt|rst)$/i,
]

function isKeyFile(name: string): boolean {
  return KEY_FILE_PATTERNS.some((p) => p.test(name))
}

export interface ProjectNode {
  project_id: string
  path: string
  name: string
  depth: number
  parent_path: string | null
  node_type: string
  file_count: number
  total_file_count: number
  files_json: Array<{ name: string; path: string; ext: string; size_bytes: number }>
  key_files: string[]
}

function walkDir(
  baseDir: string,
  relPath: string,
  depth: number,
  maxDepth: number,
  nodes: Omit<ProjectNode, "project_id">[],
): number {
  const absPath = path.join(baseDir, relPath || ".")
  let totalFiles = 0

  let entries: string[]
  try { entries = readdirSync(absPath) } catch { return 0 }

  const files: Array<{ name: string; path: string; ext: string; size_bytes: number }> = []
  const subdirs: string[] = []

  for (const entry of entries) {
    if (entry.startsWith(".")) continue
    const entryRel = relPath ? `${relPath}/${entry}` : entry
    const entryAbs = path.join(baseDir, entryRel)
    let stat: ReturnType<typeof statSync>
    try { stat = statSync(entryAbs) } catch { continue }

    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) subdirs.push(entry)
    } else if (stat.isFile()) {
      totalFiles++
      files.push({ name: entry, path: entryRel, ext: path.extname(entry).toLowerCase(), size_bytes: stat.size })
    }
  }

  const keyFiles = files.filter((f) => isKeyFile(f.name)).map((f) => f.name)
  const nodeName = relPath ? path.basename(relPath) : "."
  const parentPath = relPath
    ? (path.dirname(relPath) === "." ? null : path.dirname(relPath))
    : null

  const nodeIdx = nodes.length
  nodes.push({
    path: relPath || ".",
    name: nodeName,
    depth,
    parent_path: parentPath,
    node_type: "directory",
    file_count: files.length,
    total_file_count: 0,
    files_json: files.slice(0, 300),
    key_files: keyFiles,
  })

  if (depth < maxDepth) {
    for (const sub of subdirs) {
      const subRel = relPath ? `${relPath}/${sub}` : sub
      const subTotal = walkDir(baseDir, subRel, depth + 1, maxDepth, nodes)
      totalFiles += subTotal
    }
  }

  nodes[nodeIdx].total_file_count = totalFiles
  return totalFiles
}

export namespace RepoIndexer {
  export function cloneRepo(repoUrl: string, localPath: string, branch: string, pat?: string): { ok: boolean; error?: string } {
    if (existsSync(path.join(localPath, ".git"))) return { ok: true }
    mkdirSync(localPath, { recursive: true })

    let authUrl = repoUrl
    if (pat) {
      try {
        const u = new URL(repoUrl)
        u.username = "x-access-token"
        u.password = pat
        authUrl = u.toString()
      } catch { /* use original */ }
    }

    const result = spawnSync(
      "git",
      ["clone", "--depth=1", "--single-branch", "--branch", branch, authUrl, "."],
      { cwd: localPath, encoding: "utf8", env: GIT_ENV, timeout: 300_000 },
    )

    if (result.status !== 0) {
      const err = ((result.stderr ?? "").trim()) || result.error?.message || "git clone failed"
      return { ok: false, error: pat ? err.replace(pat, "***") : err }
    }
    return { ok: true }
  }

  export function getDefaultBranch(repoUrl: string, pat?: string): string {
    let authUrl = repoUrl
    if (pat) {
      try {
        const u = new URL(repoUrl)
        u.username = "x-access-token"
        u.password = pat
        authUrl = u.toString()
      } catch { /* use original */ }
    }
    const result = spawnSync(
      "git",
      ["ls-remote", "--symref", authUrl, "HEAD"],
      { encoding: "utf8", env: GIT_ENV, timeout: 30_000 },
    )
    if (result.status === 0 && result.stdout) {
      const match = result.stdout.match(/refs\/heads\/(\S+)/)
      if (match) return match[1]
    }
    return "main"
  }

  export function buildFileIndex(localPath: string, projectId: string): ProjectNode[] {
    const nodes: Omit<ProjectNode, "project_id">[] = []
    walkDir(localPath, "", 0, 4, nodes)
    return nodes.map((n) => ({ ...n, project_id: projectId }))
  }

  export function initSupadenseFolder(
    localPath: string,
    branch: string,
    pat?: string,
  ): { ok: boolean; pushed: boolean; error?: string } {
    const folders = ["supadense/sources", "supadense/notes", "supadense/conversations"]
    for (const folder of folders) {
      const abs = path.join(localPath, folder)
      if (!existsSync(abs)) mkdirSync(abs, { recursive: true })
      const keep = path.join(abs, ".gitkeep")
      if (!existsSync(keep)) writeFileSync(keep, "")
    }

    const mdPath = path.join(localPath, "supadense", "SUPADENSE.md")
    if (!existsSync(mdPath)) {
      writeFileSync(mdPath, [
        "# Supadense Workspace",
        "",
        "This folder is managed by [Supadense](https://supadense.com).",
        "",
        "## Structure",
        "- `sources/` — saved research sources and references",
        "- `notes/` — engineering notes and documentation",
        "- `conversations/` — exported AI conversation logs",
        "",
      ].join("\n"))
    }

    const add = runGit(["add", "supadense/"], localPath)
    if (!add.ok) return { ok: false, pushed: false, error: add.stderr }

    const commit = runGit(["commit", "-m", "chore: init supadense workspace"], localPath)
    if (!commit.ok && !commit.stdout.includes("nothing to commit") && !commit.stderr.includes("nothing to commit")) {
      return { ok: false, pushed: false, error: commit.stderr }
    }

    if (pat) {
      const remoteRes = runGit(["remote", "get-url", "origin"], localPath)
      if (remoteRes.ok && remoteRes.stdout) {
        try {
          const u = new URL(remoteRes.stdout)
          u.username = "x-access-token"
          u.password = pat
          runGit(["remote", "set-url", "origin", u.toString()], localPath)
        } catch { /* ignore */ }
      }
      const push = runGit(["push", "origin", branch], localPath)
      if (push.ok) return { ok: true, pushed: true }
      return { ok: true, pushed: false, error: push.stderr }
    }

    return { ok: true, pushed: false }
  }

  export function pullRepo(localPath: string, pat?: string): { ok: boolean; error?: string } {
    if (!existsSync(path.join(localPath, ".git"))) return { ok: false, error: "Not a git repo" }
    if (pat) {
      const r = runGit(["remote", "get-url", "origin"], localPath)
      if (r.ok && r.stdout) {
        try {
          const u = new URL(r.stdout)
          u.username = "x-access-token"
          u.password = pat
          runGit(["remote", "set-url", "origin", u.toString()], localPath)
        } catch { /* ignore */ }
      }
    }
    const result = runGit(["pull", "--ff-only"], localPath)
    if (!result.ok) return { ok: false, error: result.stderr }
    return { ok: true }
  }
}
