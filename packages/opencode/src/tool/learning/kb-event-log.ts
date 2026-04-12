/**
 * kb_event_log — Append an event to the KB activity log.
 *
 * Call at the end of any meaningful KB operation (memorize, onboarding,
 * wiki update, concept merge, gap detected, etc.).
 *
 * log.md is regenerated from this table via kb_wiki_build.
 */
import z from "zod"
import { Tool } from "../tool"
import { Workspace } from "../../learning/workspace"
import { WikiBuilder } from "../../learning/wiki-builder"

export const KbEventLogTool = Tool.define("kb_event_log", {
  description: [
    "Append an event to the KB activity log table (learning_kb_events).",
    "log.md is the human-readable render of this table.",
    "",
    "Common event types:",
    "  memorize        — resource was memorized and placed",
    "  concept_added   — new concept extracted",
    "  concept_merged  — existing concept updated/merged",
    "  wiki_update     — wiki pages rebuilt",
    "  gap_detected    — knowledge gap identified",
    "  gap_resolved    — gap marked as resolved",
    "  roadmap_update  — roadmap item status changed",
    "  note_added      — user added a note",
    "  category_added  — new category created",
    "",
    "After logging, the caller should rebuild log.md via kb_wiki_build (workspace_id).",
  ].join("\n"),
  parameters: z.object({
    workspace_id: z.string().describe("Workspace ID from kb_workspace_init"),
    event_type: z
      .string()
      .describe(
        "Event type string, e.g. 'memorize', 'concept_added', 'wiki_update', 'gap_detected'",
      ),
    summary: z
      .string()
      .describe("Human-readable one-line summary. This goes directly into log.md."),
    payload: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Structured metadata about the event"),
    resource_id: z
      .string()
      .optional()
      .describe("Associated resource ID (if event relates to a resource)"),
    wiki_page_id: z
      .string()
      .optional()
      .describe("Associated wiki page ID (if event relates to a page)"),
    rebuild_log: z
      .boolean()
      .optional()
      .describe("If true, immediately rebuilds log.md. Default: true."),
  }),
  async execute(params) {
    const workspace = Workspace.getById(params.workspace_id)
    if (!workspace) throw new Error(`Workspace ${params.workspace_id} not found`)

    Workspace.logEvent(params.workspace_id, {
      event_type: params.event_type,
      summary: params.summary,
      payload: params.payload ?? {},
      resource_id: params.resource_id,
      wiki_page_id: params.wiki_page_id,
    })

    const shouldRebuild = params.rebuild_log !== false
    if (shouldRebuild) {
      WikiBuilder.buildLogFile(workspace)
    }

    return {
      title: `Event: ${params.event_type}`,
      metadata: {
        event_type: params.event_type,
        workspace_id: params.workspace_id,
        log_rebuilt: shouldRebuild,
      },
      output: [
        `Logged: [${params.event_type}] ${params.summary}`,
        shouldRebuild ? "log.md has been rebuilt." : "Run kb_wiki_build (workspace_id) to update log.md.",
      ].join("\n"),
    }
  },
})
