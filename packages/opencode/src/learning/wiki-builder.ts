/**
 * wiki-builder.ts — Generate auxiliary .md files from DB state
 *
 * Rebuilds log.md and supadense.md from DB state.
 */
import path from "path"
import { writeFileSync } from "fs"
import { eq } from "drizzle-orm"
import { Database } from "../storage/db"
import {
  LearningKbWorkspaceTable,
  LearningKbEventTable,
} from "./schema.sql"

type Workspace = typeof LearningKbWorkspaceTable.$inferSelect

export namespace WikiBuilder {
  // ─── Log file ────────────────────────────────────────────────────────────────

  /**
   * Rebuild log.md from learning_kb_events table.
   * Most recent events first.
   */
  export function buildLogFile(_workspace: Workspace): void {
    // no-op: log.md is no longer written to disk
    return
  }

  /**
   * Rebuild supadense.md from workspace profile.
   */
  export function buildSupadenseMd(_workspace: Workspace): void {
    // no-op: supadense.md is no longer written to disk
    return
  }
}
