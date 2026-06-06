import { mkdirSync, existsSync, readdirSync, accessSync, constants } from "node:fs"
import path from "node:path"
import os from "node:os"

function resolveWorkspacesRoot(): string {
  if (process.env.WORKSPACES_ROOT) return process.env.WORKSPACES_ROOT
  // In Docker, /workspaces is mounted from data/workspaces
  try {
    accessSync("/workspaces", constants.W_OK)
    return "/workspaces"
  } catch {}
  // Local dev: use data/ relative to the monorepo root (two levels up from packages/opencode/src/util/)
  const projectRoot = path.resolve(__dirname, "../../../../..")
  const dataDir = path.join(projectRoot, "data")
  if (existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
    return dataDir
  }
  // Fallback if project root not detectable
  const fallback = path.join(os.homedir(), ".supadense")
  mkdirSync(fallback, { recursive: true })
  return fallback
}

const WORKSPACES_ROOT = resolveWorkspacesRoot()

export function userWorkspaceDir(userId: string): string {
  return path.join(WORKSPACES_ROOT, userId)
}

// ── DEPRECATED: KB workspaces replaced by EL project brain/ folders ──────────
// These functions are kept for backward compatibility only.
// New code should use el-projects/{id}/brain/ and el-projects/{id}/sources/

export function defaultKBDir(userId: string): string {
  return path.join(WORKSPACES_ROOT, userId, "default")
}

export function provisionWorkspace(userId: string): string {
  // No longer creates the default KB — just ensures the user dir exists
  const userDir = userWorkspaceDir(userId)
  mkdirSync(userDir, { recursive: true })
  return userDir
}

export function createKB(_userId: string, _name: string): string {
  throw new Error(
    "KB workspaces are deprecated. Use EL projects instead: POST /el/projects to create a project with repo/ + sources/ + brain/ structure."
  )
}

export function listKBs(_userId: string): string[] {
  // No longer lists KB workspaces — return empty
  return []
}
