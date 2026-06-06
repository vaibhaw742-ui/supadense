// Unified .supadense/ folder inside every project:
//
//   project-dir/
//     .supadense/
//       brain/     ← L0/L1/L2 .md knowledge
//       sources/   ← PDFs, URLs, reference materials
//
// EL projects: data/{userId}/el-projects/{projectId}/.supadense/
// Local projects: /path/to/project/.supadense/
// Default project (is_default=true) lives in el-projects/ — no separate inbox folder.

import { mkdirSync, existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { userWorkspaceDir } from "../util/workspace-provision"

// ── EL project paths ──────────────────────────────────────────────────────────
export function elProjectsDir(userId: string) { return join(userWorkspaceDir(userId), "el-projects") }
export function elProjectDir(userId: string, projectId: string) { return join(elProjectsDir(userId), projectId) }
export function elProjectSupadenseDir(userId: string, projectId: string) { return join(elProjectDir(userId, projectId), ".supadense") }
export function elProjectBrainDir(userId: string, projectId: string) { return join(elProjectSupadenseDir(userId, projectId), "brain") }
export function elProjectSourcesDir(userId: string, projectId: string) { return join(elProjectSupadenseDir(userId, projectId), "sources") }
export function elProjectRepoDir(userId: string, projectId: string) { return join(elProjectDir(userId, projectId), "repo") }


// ── Local project paths (on host Mac) ─────────────────────────────────────────
export function localBrainDir(localPath: string) { return join(localPath, ".supadense", "brain") }
export function localSourcesDir(localPath: string) { return join(localPath, ".supadense", "sources") }

// ── Init helper ────────────────────────────────────────────────────────────────
export interface ProjectPaths {
  root: string; supadense: string; brain: string; sources: string; repo: string; sourceId: string
}

const README = [
  "# Brain Knowledge",
  "",
  "Knowledge from this project's sessions and sources.",
  "- `L0/` — decisions, raw notes, facts",
  "- `L1/` — synthesised summaries",
  "- `L2/` — patterns and principles",
  "",
  "Commit alongside your code — knowledge travels with the project.",
].join("\n")

export function initSupadenseDirs(rootDir: string, sourceId: string, createRepo = false): ProjectPaths {
  const supadense = join(rootDir, ".supadense")
  const brain     = join(supadense, "brain")
  const sources   = join(supadense, "sources")
  const repo      = join(rootDir, "repo")

  mkdirSync(join(brain, "L0"), { recursive: true })
  mkdirSync(join(brain, "L1"), { recursive: true })
  mkdirSync(join(brain, "L2"), { recursive: true })
  mkdirSync(sources, { recursive: true })
  if (createRepo) mkdirSync(repo, { recursive: true })

  const readme = join(brain, "README.md")
  if (!existsSync(readme)) writeFileSync(readme, README, "utf8")

  return { root: rootDir, supadense, brain, sources, repo, sourceId }
}

export function initElProjectDirs(userId: string, projectId: string): ProjectPaths {
  return initSupadenseDirs(elProjectDir(userId, projectId), projectId, true)
}
