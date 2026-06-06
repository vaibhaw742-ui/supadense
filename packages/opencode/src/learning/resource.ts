/**
 * resource.ts — Learning KB resource + concept operations
 */
import { ulid } from "ulid"
import { eq, and, desc } from "drizzle-orm"
import { readFileSync, existsSync } from "fs"
import path from "path"
import { Database } from "../storage/db"
import {
  LearningResourceTable,
} from "./schema.sql"

export type Resource = typeof LearningResourceTable.$inferSelect

export type Modality = "url" | "pdf" | "youtube" | "text" | "image" | "linkedin"
export type ResourceStatus = "pending" | "processing" | "done" | "failed"

// ─── Resource ─────────────────────────────────────────────────────────────────

export namespace Resource {
  export function create(input: {
    workspace_id?: string | null
    modality: Modality
    url?: string
    title?: string
    author?: string
    raw_content?: string
    raw_content_path?: string
    metadata?: Record<string, unknown>
    published_at?: number
  }): Resource {
    const now = Date.now()
    const id = ulid()
    Database.use((db) =>
      db.insert(LearningResourceTable).values({
        id,
        workspace_id: input.workspace_id ?? null,
        modality: input.modality,
        url: input.url,
        title: input.title,
        author: input.author,
        raw_content: input.raw_content_path ? null : input.raw_content,
        raw_content_path: input.raw_content_path,
        status: "pending",
        quality_score: 0,
        relevance_score: 0,
        metadata: input.metadata ?? {},
        published_at: input.published_at,
        added_at: now,
        time_created: now,
        time_updated: now,
      }).run(),
    )
    return get(id)!
  }

  /**
   * Read the raw content for a resource.
   * Prefers the file at raw_content_path (relative to kb_path), falls back to the DB column.
   */
  export function getRawContent(resource: Resource, kbPath: string): string {
    if (resource.raw_content_path) {
      const fullPath = path.join(kbPath, resource.raw_content_path)
      if (existsSync(fullPath)) return readFileSync(fullPath, "utf8")
    }
    return resource.raw_content ?? ""
  }

  export function get(id: string): Resource | undefined {
    return Database.use((db) =>
      db.select().from(LearningResourceTable).where(eq(LearningResourceTable.id, id)).get(),
    )
  }

  export function getByUrl(workspaceId: string, url: string): Resource | undefined {
    return Database.use((db) =>
      db
        .select()
        .from(LearningResourceTable)
        .where(and(eq(LearningResourceTable.workspace_id, workspaceId), eq(LearningResourceTable.url, url)))
        .get(),
    )
  }

  export function update(
    id: string,
    data: Partial<Pick<Resource, "title" | "author" | "summary" | "raw_content" | "raw_content_path" | "quality_score" | "relevance_score" | "status" | "processing_step" | "error" | "metadata">>,
  ): void {
    Database.use((db) =>
      db.update(LearningResourceTable).set({ ...data, time_updated: Date.now() }).where(eq(LearningResourceTable.id, id)).run(),
    )
  }

  export function setStatus(id: string, status: ResourceStatus, step?: string, error?: string): void {
    Database.use((db) =>
      db
        .update(LearningResourceTable)
        .set({ status, processing_step: step, error: status === "failed" ? error : undefined, time_updated: Date.now() })
        .where(eq(LearningResourceTable.id, id))
        .run(),
    )
  }

  export function getByWorkspace(workspaceId: string, limit = 20): Resource[] {
    return Database.use((db) =>
      db
        .select()
        .from(LearningResourceTable)
        .where(eq(LearningResourceTable.workspace_id, workspaceId))
        .orderBy(desc(LearningResourceTable.added_at))
        .limit(limit)
        .all(),
    )
  }
}

