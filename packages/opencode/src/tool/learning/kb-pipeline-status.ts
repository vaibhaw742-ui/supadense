/**
 * kb_pipeline_status — Check the progress of a background KB extraction pipeline.
 *
 * Takes the task_id returned by kb_pipeline_run and shows what the
 * curator has done so far: which tools ran, their status, and whether
 * the pipeline has finished.
 */
import z from "zod"
import { eq } from "drizzle-orm"
import { Tool } from "../tool"
import { Database } from "../../storage/db"
import { SessionTable } from "../../session/session.sql"
import { MessageV2 } from "../../session/message-v2"
import type { SessionID } from "../../session/schema"

// KB curator tool names we care about tracking
const KB_TOOLS = new Set([
  "kb_resource_place",
  "kb_concept_upsert",
  "kb_wiki_build",
  "kb_event_log",
  "kb_resource_create",
  "kb_category_manage",
])

export const KbPipelineStatusTool = Tool.define("kb_pipeline_status", {
  description: [
    "Check the progress of a background KB extraction pipeline.",
    "",
    "Pass the task_id returned by kb_pipeline_run to see current status:",
    "  - Whether the pipeline is still running or has finished",
    "  - Which KB tools have been called and their outcomes",
    "  - Any errors that occurred",
    "",
    "Call this anytime after kb_pipeline_run to monitor progress.",
  ].join("\n"),
  parameters: z.object({
    task_id: z.string().describe("The task_id returned by kb_pipeline_run (child session ID)"),
  }),
  async execute(params) {
    const sessionID = params.task_id as SessionID

    // ── Check session exists + archived status ────────────────────────────
    const row = Database.use((db) =>
      db
        .select({ id: SessionTable.id, title: SessionTable.title, time_archived: SessionTable.time_archived })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get(),
    )

    if (!row) {
      throw new Error(`Pipeline task not found: ${params.task_id}`)
    }

    const isFinished = !!row.time_archived

    // ── Gather all messages ───────────────────────────────────────────────
    const toolCalls: Array<{
      tool: string
      status: string
      title?: string
      error?: string
      input?: Record<string, unknown>
    }> = []

    let before: string | undefined
    // Read up to 200 messages (more than enough for a single pipeline run)
    for (let i = 0; i < 4; i++) {
      const page = MessageV2.page({ sessionID, limit: 50, before })
      for (const msg of page.items) {
        if (msg.info.role !== "assistant") continue
        for (const part of msg.parts) {
          if (part.type !== "tool") continue
          if (!KB_TOOLS.has(part.tool)) continue
          const state = part.state
          toolCalls.push({
            tool: part.tool,
            status: state.status,
            title: state.status === "completed" ? state.title : undefined,
            error: state.status === "error" ? state.error : undefined,
            input:
              state.status === "completed" || state.status === "error" || state.status === "running"
                ? (state.input as Record<string, unknown>)
                : undefined,
          })
        }
      }
      if (!page.more || !page.cursor) break
      before = page.cursor
    }

    // ── Build status summary ──────────────────────────────────────────────
    const statusIcon = (s: string) => {
      if (s === "completed") return "✓"
      if (s === "error") return "✗"
      if (s === "running") return "⟳"
      return "·"
    }

    const lines: string[] = [
      `Pipeline: ${row.title}`,
      `Status: ${isFinished ? "finished" : "running"}`,
      `Task ID: ${sessionID}`,
      "",
    ]

    if (toolCalls.length === 0) {
      lines.push(isFinished ? "No KB tool calls recorded." : "Pipeline is starting up — no tool calls yet.")
    } else {
      lines.push(`KB tool calls (${toolCalls.length}):`)
      for (const call of toolCalls) {
        const icon = statusIcon(call.status)
        const label = call.title ?? call.tool
        if (call.status === "error") {
          lines.push(`  ${icon} ${call.tool}: ${call.error ?? "unknown error"}`)
        } else {
          lines.push(`  ${icon} ${label}`)
        }
      }

      const counts = {
        completed: toolCalls.filter((c) => c.status === "completed").length,
        running: toolCalls.filter((c) => c.status === "running").length,
        error: toolCalls.filter((c) => c.status === "error").length,
      }
      lines.push("")
      lines.push(`Summary: ${counts.completed} done, ${counts.running} running, ${counts.error} errors`)
    }

    if (!isFinished) {
      lines.push("", "Call kb_pipeline_status again to refresh.")
    }

    return {
      title: `KB Pipeline: ${isFinished ? "finished" : "running"}`,
      metadata: {
        task_id: sessionID,
        finished: isFinished,
        tool_calls: toolCalls,
      },
      output: lines.join("\n"),
    }
  },
})
