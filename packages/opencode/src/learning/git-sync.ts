import { spawnSync } from "child_process"
import { existsSync, writeFileSync } from "fs"
import path from "path"

const GITIGNORE = "*.db\n*.db-wal\n*.db-shm\n"

function run(args: string[], cwd: string) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" })
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
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

    run(["add", "wiki/", "assets/", "raw/", ".gitignore"], kbPath)

    const statusResult = run(["status", "--short"], kbPath)
    if (!statusResult.stdout) return { ok: true, message: "Nothing to commit" }

    const timestamp = new Date().toISOString()
    const commitResult = run(["commit", "-m", `sync: ${timestamp}`], kbPath)
    if (!commitResult.ok) return { ok: false, message: commitResult.stderr || "git commit failed" }

    return { ok: true, message: "Changes committed" }
  }

  export function push(kbPath: string): { ok: boolean; message: string } {
    const remoteResult = run(["remote", "get-url", "origin"], kbPath)
    if (!remoteResult.ok) return { ok: false, message: "No remote configured. Add a GitHub repo first." }

    // Try push; if upstream not set yet, set it
    let pushResult = run(["push", "origin", "main"], kbPath)
    if (!pushResult.ok && pushResult.stderr.includes("no upstream")) {
      pushResult = run(["push", "--set-upstream", "origin", "main"], kbPath)
    }
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
