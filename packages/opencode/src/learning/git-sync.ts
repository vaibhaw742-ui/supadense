import { spawnSync } from "child_process"
import { existsSync, writeFileSync } from "fs"
import path from "path"

const GITIGNORE = "*.db\n*.db-wal\n*.db-shm\n"

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Supadense",
  GIT_AUTHOR_EMAIL: "sync@supadense",
  GIT_COMMITTER_NAME: "Supadense",
  GIT_COMMITTER_EMAIL: "sync@supadense",
}

function run(args: string[], cwd: string) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV })
  const stdout = (result.stdout ?? "").trim()
  const stderr = (result.stderr ?? "").trim()
  return {
    ok: result.status === 0,
    stdout,
    stderr: stderr || result.error?.message || "",
  }
}

export namespace KbGitSync {
  export function hasRepo(kbPath: string): boolean {
    return existsSync(path.join(kbPath, ".git"))
  }

  export function initRepo(kbPath: string): void {
    if (hasRepo(kbPath)) return
    run(["init", "-b", "main"], kbPath)
    const gitignorePath = path.join(kbPath, ".gitignore")
    if (!existsSync(gitignorePath)) writeFileSync(gitignorePath, GITIGNORE)
  }

  export interface Status {
    hasRepo: boolean
    uncommittedCount: number
    unpushedCount: number
    remote: string | null
  }

  export function getStatus(kbPath: string): Status {
    if (!hasRepo(kbPath)) return { hasRepo: false, uncommittedCount: 0, unpushedCount: 0, remote: null }

    const statusResult = run(["status", "--short"], kbPath)
    const uncommittedCount = statusResult.stdout
      ? statusResult.stdout.split("\n").filter(Boolean).length
      : 0

    const remoteResult = run(["remote", "get-url", "origin"], kbPath)
    // Mask PAT from the URL before returning to frontend
    let remote: string | null = null
    if (remoteResult.ok && remoteResult.stdout) {
      try {
        const u = new URL(remoteResult.stdout)
        u.username = ""
        u.password = ""
        remote = u.toString()
      } catch {
        remote = remoteResult.stdout
      }
    }

    let unpushedCount = 0
    if (remote) {
      // fetch quietly so we have fresh remote refs; ignore errors
      run(["fetch", "--quiet"], kbPath)
      const logResult = run(["log", "@{u}..", "--oneline"], kbPath)
      if (logResult.ok) {
        unpushedCount = logResult.stdout.split("\n").filter(Boolean).length
      }
    }

    return { hasRepo: true, uncommittedCount, unpushedCount, remote }
  }

  export function commit(kbPath: string): { ok: boolean; message: string } {
    initRepo(kbPath)

    // Stage everything (db files excluded via .gitignore)
    run(["add", "-A"], kbPath)

    const statusResult = run(["status", "--short"], kbPath)
    if (!statusResult.stdout) return { ok: true, message: "Nothing to commit" }

    const timestamp = new Date().toISOString()
    const commitResult = run(["commit", "-m", `sync: ${timestamp}`], kbPath)
    if (!commitResult.ok) {
      const detail = [commitResult.stderr, commitResult.stdout].filter(Boolean).join(" | ")
      return { ok: false, message: detail || "git commit failed" }
    }

    return { ok: true, message: "Changes committed" }
  }

  export function push(kbPath: string): { ok: boolean; message: string } {
    initRepo(kbPath)

    const remoteResult = run(["remote", "get-url", "origin"], kbPath)
    if (!remoteResult.ok) return { ok: false, message: "No remote configured. Add a GitHub repo first." }

    // If no commits exist yet, stage everything and make an initial commit
    const headResult = run(["rev-parse", "HEAD"], kbPath)
    if (!headResult.ok) {
      run(["add", "-A"], kbPath)
      const initCommit = run(["commit", "--allow-empty", "-m", `init: ${new Date().toISOString()}`], kbPath)
      if (!initCommit.ok) {
        const detail = [initCommit.stderr, initCommit.stdout].filter(Boolean).join(" | ")
        return { ok: false, message: detail || "Failed to create initial commit" }
      }
    }

    // Detect actual branch name rather than assuming "main"
    const branchResult = run(["rev-parse", "--abbrev-ref", "HEAD"], kbPath)
    const branch = branchResult.ok && branchResult.stdout ? branchResult.stdout : "main"

    // Push all commits; --set-upstream handles first-time push
    const pushResult = run(["push", "--set-upstream", "origin", branch], kbPath)
    if (!pushResult.ok) return { ok: false, message: pushResult.stderr || "Push failed" }

    return { ok: true, message: "Pushed to GitHub" }
  }

  export function setRemote(kbPath: string, repoUrl: string, pat: string): { ok: boolean; message: string } {
    initRepo(kbPath)

    // Build authenticated URL: https://<pat>@github.com/user/repo
    let authUrl: string
    try {
      const u = new URL(repoUrl)
      u.username = pat
      u.password = ""
      authUrl = u.toString()
    } catch {
      return { ok: false, message: "Invalid GitHub repo URL" }
    }

    // Remove existing origin quietly
    run(["remote", "remove", "origin"], kbPath)

    const addResult = run(["remote", "add", "origin", authUrl], kbPath)
    if (!addResult.ok) return { ok: false, message: addResult.stderr || "Failed to set remote" }

    return { ok: true, message: "Remote configured" }
  }
}
