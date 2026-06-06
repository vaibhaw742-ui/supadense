/**
 * wiki-builder.ts — Generate auxiliary .md files from DB state
 *
 * NOTE: LearningKbWorkspaceTable and LearningKbEventTable have been dropped.
 * All methods are no-ops kept for backward compat.
 */
import { Workspace } from "./workspace"

export namespace WikiBuilder {
  export function buildLogFile(_workspace: Workspace): void {
    // no-op: log.md is no longer written to disk
    return
  }

  export function buildSupadenseMd(_workspace: Workspace): void {
    // no-op: supadense.md is no longer written to disk
    return
  }
}
