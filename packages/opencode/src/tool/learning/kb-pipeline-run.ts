/**
 * kb_pipeline_run — Trigger the background KB extraction pipeline for a resource.
 *
 * Creates a child KBCurator session and fires it without awaiting — returns
 * immediately with a task_id while the curator runs in the background.
 *
 * The curator will:
 *   1. Extract key concepts from the resource
 *   2. Call kb_concept_upsert, kb_event_log
 *
 * When done, injects a synthetic user message into the parent session with a
 * full summary of concepts extracted.
 */
import z from "zod"

import { Effect } from "effect"
import { ulid } from "ulid"
import { Tool } from "../tool"
import { Agent } from "../../agent/agent"
import { Session } from "../../session"
import { SessionID, MessageID, PartID } from "../../session/schema"
import { MessageV2 } from "../../session/message-v2"
import { SessionPrompt } from "../../session/prompt"
import { Resource } from "../../learning/resource"
import { Workspace } from "../../learning/workspace"

// ── Prompt builder ─────────────────────────────────────────────────────────

export function buildCuratorPrompt(
  resource: ReturnType<typeof Resource.get>,
  workspace: ReturnType<typeof Workspace.getById>,
): string {
  if (!resource || !workspace) return ""

  const MAX_CONTENT = 12_000
  const rawText = Resource.getRawContent(resource, workspace.kb_path)
  const content = rawText.slice(0, MAX_CONTENT)
  const truncated = rawText.length > MAX_CONTENT

  const lines: string[] = [
    "## Resource to Process",
    "",
    `**Resource ID:** \`${resource.id}\``,
    `**Title:** ${resource.title ?? "(untitled)"}`,
    resource.url ? `**URL:** ${resource.url}` : "",
    `**Modality:** ${resource.modality}`,
    resource.author ? `**Author:** ${resource.author}` : "",
    "",
    "### Content",
    "```",
    content,
    truncated ? `\n[... truncated — full ${rawText.length} chars ...]` : "",
    "```",
    "",
    "---",
    "",
    "## KB Workspace",
    "",
    `**Workspace ID:** ${workspace.id}`,
    `**KB Path:** ${workspace.kb_path}`,
    workspace.learning_intent ? `**Learning Intent:** ${workspace.learning_intent}` : "",
    "",
    "---",
    "",
    "## Your Task",
    "",
    "1. Extract key domain-specific concepts introduced by this resource.",
    `2. Call \`kb_concept_upsert\` for each new concept. Pass resource_id: \`${resource.id}\`.`,
    "3. Call `kb_event_log` with a summary of what was learned.",
    "",
    "Focus on 3–8 high-value concepts. Skip common knowledge.",
  ]

  return lines.filter(Boolean).join("\n")
}

// ── Background completion → inject notification into parent session ─────────

async function injectCompletionNotification(
  parentSessionID: string,
  workspaceID: string,
  childSessionID: string,
  resourceLabel: string,
  model: { modelID: string; providerID: string },
): Promise<void> {
  const KB_TOOLS = new Set([
    "kb_concept_upsert",
    "kb_event_log",
    "kb_resource_create",
  ])

  const concepts: string[] = []
  const errorDetails: string[] = []

  const page = MessageV2.page({ sessionID: childSessionID as SessionID, limit: 200 })
  for (const msg of page.items) {
    if (msg.info.role !== "assistant") continue
    for (const part of msg.parts) {
      if (part.type !== "tool") continue
      if (!KB_TOOLS.has(part.tool)) continue
      const state = part.state
      if (state.status === "error") {
        const errMsg = (state as Record<string, unknown>).error as string | undefined
        const input = (state as Record<string, unknown>).input as Record<string, unknown> | undefined
        const detail = (input?.name as string) ?? ""
        errorDetails.push(`${part.tool}${detail ? ` (${detail})` : ""}: ${errMsg ?? "unknown error"}`)
        continue
      }
      if (state.status !== "completed") continue
      if (part.tool === "kb_concept_upsert") {
        const input = state.input as Record<string, unknown>
        const name = (input?.name as string) ?? ""
        if (name) concepts.push(name)
      }
    }
  }

  // Build the notification text
  const lines: string[] = [
    `**KB pipeline complete:** ${resourceLabel}`,
    "",
  ]

  if (concepts.length > 0) {
    lines.push(`Concepts extracted: ${concepts.join(", ")}`)
    lines.push("")
  } else {
    lines.push("No concepts extracted.")
    lines.push("")
  }

  if (errorDetails.length > 0) {
    lines.push(`⚠ ${errorDetails.length} non-critical tool call(s) failed during extraction, but the pipeline completed successfully.`)
    for (const e of errorDetails) lines.push(`  • ${e}`)
    lines.push("")
  }

  const notificationText = lines.join("\n").trimEnd()

  // Inject a synthetic user message into the parent session
  const msgID = MessageID.ascending()
  const userMsg: MessageV2.User = {
    id: msgID,
    sessionID: parentSessionID as SessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "default",
    model: { providerID: model.providerID as any, modelID: model.modelID as any },
  }
  await Session.updateMessage(userMsg)
  await Session.updatePart({
    id: PartID.ascending(),
    sessionID: parentSessionID as SessionID,
    messageID: msgID,
    type: "text",
    text: notificationText,
    synthetic: true,
  } satisfies MessageV2.TextPart)
}

// ── Tool definition ────────────────────────────────────────────────────────

export const KbPipelineRunTool = Tool.defineEffect(
  "kb_pipeline_run",
  Effect.gen(function* () {
    const agentService = yield* Agent.Service

    const run = Effect.fn("KbPipelineRun.execute")(function* (
      params: { resource_id: string; workspace_id: string },
      ctx: Tool.Context,
    ) {
      // ── Load resource + workspace ─────────────────────────────────────
      const resource = yield* Effect.sync(() => Resource.get(params.resource_id))
      if (!resource) return yield* Effect.fail(new Error(`Resource ${params.resource_id} not found`))

      const workspace = yield* Effect.sync(() => Workspace.getById(params.workspace_id))
      if (!workspace) return yield* Effect.fail(new Error(`Workspace ${params.workspace_id} not found`))

      // ── Resolve model from current message ────────────────────────────
      const msg = yield* Effect.sync(() =>
        MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }),
      )
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))

      const curatorAgent = yield* agentService.get("kb-curator")
      if (!curatorAgent) return yield* Effect.fail(new Error("kb-curator agent not configured"))

      const model = curatorAgent.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }

      // ── Build curator prompt ──────────────────────────────────────────
      const curatorPrompt = buildCuratorPrompt(resource, workspace)

      // ── Create child session ──────────────────────────────────────────
      const childSession = yield* Effect.promise(() =>
        Session.create({
          parentID: ctx.sessionID,
          title: `KB: ${resource.title ?? resource.url ?? resource.id}`,
          permission: [
            { permission: "bash" as const, pattern: "*" as const, action: "deny" as const },
            { permission: "edit" as const, pattern: "*" as const, action: "deny" as const },
            { permission: "write" as const, pattern: "*" as const, action: "deny" as const },
            { permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const },
            { permission: "task" as const, pattern: "*" as const, action: "deny" as const },
          ],
        }),
      )

      const messageID = MessageID.ascending()
      const resourceLabel = resource.title ?? resource.url ?? resource.id
      const parentSessionID = ctx.sessionID

      ctx.metadata({
        title: `KB pipeline running: ${resourceLabel}`,
        metadata: { task_id: childSession.id as string, resource_id: params.resource_id },
      })

      const parts = yield* Effect.promise(() => SessionPrompt.resolvePromptParts(curatorPrompt))

      // ── Fire curator in background — do NOT await ─────────────────────
      SessionPrompt.prompt({
        sessionID: childSession.id,
        messageID,
        model,
        agent: "kb-curator",
        tools: {
          bash: false,
          edit: false,
          write: false,
          glob: false,
          grep: false,
          task: false,
          fetch: false,
          search: false,
          code: false,
          skill: false,
          patch: false,
          lsp: false,
          plan: false,
          todo: false,
        },
        parts,
      })
        .then(() =>
          injectCompletionNotification(
            parentSessionID,
            params.workspace_id,
            childSession.id,
            resourceLabel,
            model,
          ),
        )
        .catch((err: unknown) => {
          console.error(
            "[KB Pipeline] Error in curator session:",
            err instanceof Error ? err.message : String(err),
          )
        })

      // ── Return immediately ────────────────────────────────────────────
      return {
        title: `KB pipeline started: ${resourceLabel}`,
        metadata: { task_id: childSession.id as string, resource_id: params.resource_id },
        output: [
          `KB pipeline started for: **${resourceLabel}**`,
          "",
          "Extraction is running in the background. You will receive a notification in this chat when it completes with a summary of concepts extracted.",
          "",
          "You can continue using the KB session normally — the pipeline runs independently.",
        ].join("\n"),
      }
    })

    return {
      description: [
        "Run the KB extraction pipeline for a resource in the background.",
        "",
        "Starts the KBCurator agent asynchronously — returns immediately with a confirmation.",
        "When extraction is complete, a notification is injected into the current chat with a full",
        "summary of concepts extracted.",
        "",
        "Call this AFTER kb_resource_create. Do NOT call kb_pipeline_status after this — it is not needed.",
        "",
        "Parameters:",
        "  resource_id   — from kb_resource_create",
        "  workspace_id  — from kb_workspace_init",
      ].join("\n"),
      parameters: z.object({
        resource_id: z.string().describe("Resource ID from kb_resource_create"),
        workspace_id: z.string().describe("Workspace ID from kb_workspace_init"),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async execute(params: any, ctx: Tool.Context) {
        return Effect.runPromise(run(params as { resource_id: string; workspace_id: string }, ctx))
      },
    } as any
  }),
)
