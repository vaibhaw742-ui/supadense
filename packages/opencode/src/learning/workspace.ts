/**
 * workspace.ts — Learning KB workspace operations
 */
import path from "path"
import { mkdirSync, writeFileSync, existsSync } from "fs"
import { ulid } from "ulid"
import { eq } from "drizzle-orm"
import { KbWatcher } from "./kb-watcher"
import { Database } from "../storage/db"
import {
  LearningKbWorkspaceTable,
  LearningKbEventTable,
} from "./schema.sql"

export type Workspace = typeof LearningKbWorkspaceTable.$inferSelect

export namespace Workspace {
  export function get(projectId: string): Workspace | undefined {
    return Database.use((db) =>
      db.select().from(LearningKbWorkspaceTable).where(eq(LearningKbWorkspaceTable.project_id, projectId)).get(),
    )
  }

  export function getById(id: string): Workspace | undefined {
    return Database.use((db) =>
      db.select().from(LearningKbWorkspaceTable).where(eq(LearningKbWorkspaceTable.id, id)).get(),
    )
  }

  export function getByKbPath(kbPath: string): Workspace | undefined {
    return Database.use((db) =>
      db.select().from(LearningKbWorkspaceTable).where(eq(LearningKbWorkspaceTable.kb_path, kbPath)).get(),
    )
  }

  export function ensure(projectId: string, kbPath: string): Workspace {
    // Always key workspaces by kb_path — each unique folder is a separate KB
    const byPath = getByKbPath(kbPath)
    if (byPath) return byPath

    // project_id must be unique per row. If another workspace already holds this
    // project_id (e.g. "global" for all non-git folders), use kb_path as a
    // synthetic project_id so the unique constraint stays satisfied.
    const byProject = get(projectId)
    const effectiveProjectId = byProject ? kbPath : projectId

    const now = Date.now()
    const id = ulid()
    Database.use((db) =>
      db.insert(LearningKbWorkspaceTable).values({
        id,
        project_id: effectiveProjectId,
        kb_path: kbPath,
        kb_initialized: false,
        goals: [],
        gaps: [],
        depth_prefs: {},
        trusted_sources: [],
        scout_platforms: [],
        extra_folders: [],
        time_created: now,
        time_updated: now,
      }).run(),
    )
    return getByKbPath(kbPath)!
  }

  export function update(id: string, data: Partial<Omit<Workspace, "id" | "project_id" | "time_created">>): void {
    Database.use((db) =>
      db
        .update(LearningKbWorkspaceTable)
        .set({ ...data, time_updated: Date.now() })
        .where(eq(LearningKbWorkspaceTable.id, id))
        .run(),
    )
  }

  export function scaffoldFiles(workspace: Workspace): void {
    const { kb_path } = workspace
    KbWatcher.start(workspace.id, kb_path)
  }

  export function logEvent(
    workspaceId: string,
    event: {
      event_type: string
      summary: string
      payload?: Record<string, unknown>
      resource_id?: string
    },
  ): void {
    const now = Date.now()
    Database.use((db) =>
      db.insert(LearningKbEventTable).values({
        id: ulid(),
        workspace_id: workspaceId,
        event_type: event.event_type,
        summary: event.summary,
        payload: event.payload ?? {},
        resource_id: event.resource_id,
        time_created: now,
        time_updated: now,
      }).run(),
    )
  }
}
