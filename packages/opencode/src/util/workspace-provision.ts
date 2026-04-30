import { mkdirSync, existsSync, readdirSync } from "node:fs"
import path from "node:path"

const WORKSPACES_ROOT = "/workspaces"

export function userWorkspaceDir(userId: string): string {
  return path.join(WORKSPACES_ROOT, userId)
}

export function defaultKBDir(userId: string): string {
  return path.join(WORKSPACES_ROOT, userId, "default")
}

export function provisionWorkspace(userId: string): string {
  const userDir = userWorkspaceDir(userId)
  const defaultDir = defaultKBDir(userId)
  mkdirSync(defaultDir, { recursive: true })
  return defaultDir
}

export function createKB(userId: string, name: string): string {
  const safe = name.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
  if (!safe) throw new Error("Invalid KB name")

  const userDir = userWorkspaceDir(userId)
  mkdirSync(userDir, { recursive: true })

  const dir = path.join(userDir, safe)
  if (existsSync(dir)) throw new Error(`A Knowledge Base named "${name}" already exists`)

  mkdirSync(dir, { recursive: true })
  return dir
}

export function listKBs(userId: string): string[] {
  const userDir = userWorkspaceDir(userId)
  if (!existsSync(userDir)) return []
  return readdirSync(userDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(userDir, d.name))
}
