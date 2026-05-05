/**
 * kb_pipeline_run — Trigger the background KB extraction pipeline for a resource.
 *
 * Creates a child KBCurator session and fires it without awaiting — returns
 * immediately with a task_id while the curator runs in the background.
 *
 * The curator will:
 *   1. Categorize the resource
 *   2. Extract content into each relevant schema section
 *   3. Call kb_resource_place (×N), kb_concept_upsert, kb_wiki_build, kb_event_log
 *
 * When done, injects a synthetic user message into the parent session with a
 * full summary of placements, concepts, and wiki pages updated.
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
import { WikiBuilder } from "../../learning/wiki-builder"

// ── Prompt builder ─────────────────────────────────────────────────────────

export function buildCuratorPrompt(
  resource: ReturnType<typeof Resource.get>,
  workspace: ReturnType<typeof Workspace.getById>,
  pages: ReturnType<typeof Workspace.getWikiPages>,
): string {
  if (!resource || !workspace) return ""

  const MAX_CONTENT = 12_000
  const rawText = Resource.getRawContent(resource, workspace.kb_path)
  const content = rawText.slice(0, MAX_CONTENT)
  const truncated = rawText.length > MAX_CONTENT

  const categoryPages = pages.filter((p) => p.page_type === "category")
  const subcatPages = pages.filter((p) => p.page_type === "subcategory")

  const lines: string[] = [
    "## Resource to Process",
    "",
    `**Resource ID:** \`${resource.id}\` ← use this as \`resource_id\` in every kb_resource_place call`,
    `**Title:** ${resource.title ?? "(untitled)"}`,
    resource.url ? `**URL:** ${resource.url}` : "",
    `**Modality:** ${resource.modality}`,
    resource.author ? `**Author:** ${resource.author}` : "",
    "",
    "### Content",
    "```",
    content,
    truncated ? `\n[... truncated — full ${resource.raw_content?.length} chars ...]` : "",
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
    "### Available Wiki Pages",
    "(Use the `id` field as `wiki_page_id` when calling kb_resource_place)",
    "",
    ...categoryPages.map((p) => `- **${p.title}** [category] — id: \`${p.id}\` — file: ${p.file_path}`),
    ...(subcatPages.length > 0
      ? ["", ...subcatPages.map((p) => `- **${p.title}** [subcategory of ${p.category_slug}] — id: \`${p.id}\` — file: ${p.file_path}`)]
      : []),
    "",
    "---",
    "",
    "## Section Extraction Guide",
    "",
    "Extract content into the sections listed below — only when the resource has genuinely relevant content for that section.",
    "The **Guidance** tells you what to look for. Skip a section if the resource has nothing valuable to add.",
    "",
    // Category pages with sections (skip overview pages — content belongs in section pages)
    ...categoryPages
      .filter((p) => p.type !== "overview" && (p.sections ?? []).length > 0)
      .flatMap((p) => [
        `### ${p.title} — category page`,
        `(wiki_page_id: \`${p.id}\`, file: ${p.file_path})`,
        "",
        ...(p.sections ?? []).flatMap((sec) => [
          `**${sec.heading}** (\`section_slug: "${sec.slug}"\`)`,
          sec.description ? `> ${sec.description}` : "",
          "",
        ]),
      ]),
    // Subcategory pages with sections (skip overview pages)
    ...subcatPages
      .filter((p) => p.type !== "overview" && (p.sections ?? []).length > 0)
      .flatMap((p) => [
        `### ${p.category_slug} → ${p.title} — subcategory page`,
        `(wiki_page_id: \`${p.id}\`, file: ${p.file_path})`,
        "",
        ...(p.sections ?? []).flatMap((sec) => [
          `**${sec.heading}** (\`section_slug: "${sec.slug}"\`)`,
          sec.description ? `> ${sec.description}` : "",
          "",
        ]),
      ]),
    "---",
    "",
    "## Your Task",
    "",
    `1. Determine which **category** this resource belongs to.`,
    "2. For each relevant wiki page in that category, extract content into the appropriate sections.",
    `3. Call \`kb_resource_place\` once per section that has relevant content. Always pass resource_id: \`${resource.id}\` and workspace_id: \`${workspace.id}\`.`,
    "4. Call `kb_concept_upsert` for any new domain-specific concepts introduced.",
    "5. Call `kb_wiki_build` with the affected page_ids to regenerate .md files.",
    "6. Call `kb_event_log` with a summary of what was placed.",
    "",
    "Aim for 3–6 placements. Skip sections where this resource has nothing valuable to add.",
    "",
    "**CRITICAL RULE — schema is read-only during extraction:**",
    "Only place content into sections that already appear in the Section Extraction Guide above.",
    "NEVER invent new section slugs. If no listed section fits, skip the resource for that page.",
    "Do NOT call kb_category_manage. Do NOT create, rename, or remove sections, categories, or subcategories.",
    "The schema may only be changed by the user — not during automated extraction.",
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
    "kb_resource_place",
    "kb_concept_upsert",
    "kb_wiki_build",
    "kb_event_log",
    "kb_resource_create",
    "kb_category_manage",
  ])

  const placements: string[] = []
  const concepts: string[] = []
  const wikiBuilt: string[] = []
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
        const detail = input?.name ?? input?.section_slug ?? input?.page_ids ?? ""
        errorDetails.push(`${part.tool}${detail ? ` (${detail})` : ""}: ${errMsg ?? "unknown error"}`)
        continue
      }
      if (state.status !== "completed") continue
      if (part.tool === "kb_resource_place") {
        const input = state.input as Record<string, unknown>
        const slug = (input?.section_slug as string) ?? ""
        const pageId = (input?.wiki_page_id as string) ?? ""
        if (slug) placements.push(`${pageId} → ${slug}`)
      } else if (part.tool === "kb_concept_upsert") {
        const input = state.input as Record<string, unknown>
        const name = (input?.name as string) ?? ""
        if (name) concepts.push(name)
      } else if (part.tool === "kb_wiki_build") {
        const input = state.input as Record<string, unknown>
        const ids = (input?.page_ids as string[]) ?? []
        wikiBuilt.push(...ids)
      }
    }
  }

  // Fallback wiki build if the curator's kb_wiki_build failed due to permissions
  const wikiToolFailed = errorDetails.some((e) => e.startsWith("kb_wiki_build"))
  if (placements.length > 0 && wikiToolFailed) {
    try {
      const workspace = Workspace.getById(workspaceID)
      if (workspace) {
        WikiBuilder.buildAll(workspaceID)
        WikiBuilder.buildSupadenseMd(workspace)
        WikiBuilder.buildLogFile(workspace)
        wikiBuilt.push(...Workspace.getWikiPages(workspaceID).map((p) => p.file_path))
        errorDetails.splice(0, errorDetails.length, ...errorDetails.filter((e) => !e.startsWith("kb_wiki_build")))
      }
    } catch (e) {
      console.error("[KB Pipeline] fallback wiki build failed:", e instanceof Error ? e.message : String(e))
    }
  }

  // Build the notification text
  const lines: string[] = [
    `**KB pipeline complete:** ${resourceLabel}`,
    "",
  ]

  if (placements.length > 0) {
    lines.push(`Placed into ${placements.length} section(s):`)
    for (const p of placements) lines.push(`  • ${p}`)
    lines.push("")
  } else {
    lines.push("No section placements recorded.")
    lines.push("")
  }

  if (concepts.length > 0) {
    lines.push(`Concepts extracted: ${concepts.join(", ")}`)
    lines.push("")
  }

  if (wikiBuilt.length > 0) {
    lines.push("Wiki has been rebuilt and updated.")
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
      const pages = yield* Effect.sync(() => Workspace.getWikiPages(params.workspace_id))
      const curatorPrompt = buildCuratorPrompt(resource, workspace, pages)

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
        metadata: { task_id: childSession.id, resource_id: params.resource_id },
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
        metadata: { task_id: childSession.id, resource_id: params.resource_id },
        output: [
          `KB pipeline started for: **${resourceLabel}**`,
          "",
          "Extraction is running in the background. You will receive a notification in this chat when it completes with a full summary of placements, concepts, and wiki updates.",
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
        "summary of what was placed, which concepts were extracted, and which wiki pages were rebuilt.",
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
      async execute(params, ctx) {
        return Effect.runPromise(run(params as { resource_id: string; workspace_id: string }, ctx))
      },
    }
  }),
)
