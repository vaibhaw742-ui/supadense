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
  export function buildLogFile(workspace: Workspace): void {
    const events = Database.use((db) =>
      db
        .select()
        .from(LearningKbEventTable)
        .where(eq(LearningKbEventTable.workspace_id, workspace.id))
        .orderBy(LearningKbEventTable.time_created)
        .all(),
    )

    const lines: string[] = [
      "# Activity Log",
      "",
      "> This file is managed by the supadense agent. Edit via chat only.",
      "",
    ]

    // Group by date
    const byDate = new Map<string, typeof events>()
    for (const event of events.reverse()) {
      const date = new Date(event.time_created).toISOString().split("T")[0]
      if (!byDate.has(date)) byDate.set(date, [])
      byDate.get(date)!.push(event)
    }

    for (const [date, dayEvents] of byDate) {
      lines.push(`## ${date}`, "")
      for (const e of dayEvents) {
        const time = new Date(e.time_created).toISOString().split("T")[1].slice(0, 5)
        lines.push(`- **${time}** ${e.summary}`)
      }
      lines.push("")
    }

    const logPath = path.join(workspace.kb_path, ".supadense", "log.md")
    writeFileSync(logPath, lines.join("\n"), "utf8")
  }

  /**
   * Rebuild supadense.md from workspace profile.
   */
  export function buildSupadenseMd(workspace: Workspace): void {
    const lines: string[] = [
      "# Knowledge Base",
      "",
      "> This file is managed by the supadense agent. Edit via chat only.",
      "",
      "## Learning Intent",
      "",
      workspace.learning_intent ?? "_Not set yet. Complete onboarding._",
      "",
      "## Goals",
      "",
    ]

    if (workspace.goals.length > 0) {
      for (const g of workspace.goals) lines.push(`- ${g}`)
    } else {
      lines.push("_Not set yet._")
    }
    lines.push("")

    if (workspace.trusted_sources.length > 0) {
      lines.push("## Trusted Sources", "")
      for (const s of workspace.trusted_sources) lines.push(`- ${s}`)
      lines.push("")
    }

    if (workspace.scout_platforms.length > 0) {
      lines.push("## Scout Platforms", "")
      for (const s of workspace.scout_platforms) lines.push(`- ${s}`)
      lines.push("")
    }

    lines.push("---", "", `_Updated: ${new Date().toISOString().split("T")[0]}_`)

    const mdPath = path.join(workspace.kb_path, ".supadense", "supadense.md")
    writeFileSync(mdPath, lines.join("\n"), "utf8")
  }
}
