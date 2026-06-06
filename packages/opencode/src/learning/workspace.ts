/**
 * workspace.ts — Learning KB workspace operations
 *
 * NOTE: LearningKbWorkspaceTable and LearningKbEventTable have been dropped.
 * Workspace lookup is now done in-memory or via the project system.
 * This file is kept for backward compatibility — tools that accept a workspace_id
 * still work but the workspace rows are no longer persisted to SQLite.
 */

export interface Workspace {
  id: string
  project_id: string
  kb_path: string
  kb_initialized: boolean
  learning_intent: string | null
  goals: string[]
  gaps: string[]
  depth_prefs: Record<string, string>
  trusted_sources: string[]
  scout_platforms: string[]
  extra_folders: string[]
  onboarded_at: number | null
  github_remote_url: string | null
  github_pat: string | null
  time_created: number
  time_updated: number
}

// In-memory store keyed by kb_path (primary) and by id.
const byPath = new Map<string, Workspace>()
const byId = new Map<string, Workspace>()
const byProjectId = new Map<string, Workspace>()

function store(ws: Workspace): void {
  byPath.set(ws.kb_path, ws)
  byId.set(ws.id, ws)
  byProjectId.set(ws.project_id, ws)
}

export namespace Workspace {
  export function get(projectId: string): Workspace | undefined {
    return byProjectId.get(projectId)
  }

  export function getById(id: string): Workspace | undefined {
    return byId.get(id)
  }

  export function getByKbPath(kbPath: string): Workspace | undefined {
    return byPath.get(kbPath)
  }

  export function ensure(projectId: string, kbPath: string): Workspace {
    const existing = byPath.get(kbPath)
    if (existing) return existing

    const { ulid } = require("ulid") as typeof import("ulid")
    const now = Date.now()
    const ws: Workspace = {
      id: ulid(),
      project_id: projectId,
      kb_path: kbPath,
      kb_initialized: false,
      learning_intent: null,
      goals: [],
      gaps: [],
      depth_prefs: {},
      trusted_sources: [],
      scout_platforms: [],
      extra_folders: [],
      onboarded_at: null,
      github_remote_url: null,
      github_pat: null,
      time_created: now,
      time_updated: now,
    }
    store(ws)
    return ws
  }

  export function update(id: string, data: Partial<Omit<Workspace, "id" | "project_id" | "time_created">>): void {
    const ws = byId.get(id)
    if (!ws) return
    Object.assign(ws, data, { time_updated: Date.now() })
  }

  export function scaffoldFiles(_workspace: Workspace): void {
    // No-op: KB watcher and file scaffolding removed with workspace tables.
  }

  export function logEvent(
    _workspaceId: string,
    _event: {
      event_type: string
      summary: string
      payload?: Record<string, unknown>
      resource_id?: string
    },
  ): void {
    // No-op: LearningKbEventTable has been dropped.
  }
}
