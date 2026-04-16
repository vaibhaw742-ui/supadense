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
 * The main conversation is unblocked immediately after this call.
 */
import z from "zod"

import { Effect } from "effect"
import { Tool } from "../tool"
import { Agent } from "../../agent/agent"
import { Config } from "../../config/config"
import { Session } from "../../session"
import { SessionPrompt } from "../../session/prompt"
import { MessageID } from "../../session/schema"
import { MessageV2 } from "../../session/message-v2"
import { Resource } from "../../learning/resource"
import { Workspace } from "../../learning/workspace"
import { KbSchema, type SchemaContent } from "../../learning/kb-schema"

// ── Prompt builder ─────────────────────────────────────────────────────────

function buildCuratorPrompt(
  resource: ReturnType<typeof Resource.get>,
  workspace: ReturnType<typeof Workspace.getById>,
  pages: ReturnType<typeof Workspace.getWikiPages>,
  schema: SchemaContent,
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
    // Category pages with direct sections (common when no subcategories exist)
    ...schema.categories.flatMap((cat) => {
      const catPage = categoryPages.find((p) => p.category_slug === cat.slug)
      if (!catPage || cat.sections.length === 0) return []
      return [
        `### ${cat.name} — category page`,
        `(wiki_page_id: \`${catPage.id}\`, file: ${catPage.file_path})`,
        "",
        ...cat.sections.flatMap((sec) => [
          `**${sec.heading}** (\`section_slug: "${sec.slug}"\`)`,
          `> ${sec.description}`,
          "",
        ]),
      ]
    }),
    // Subcategory pages
    ...schema.categories.flatMap((cat) =>
      cat.subcategories.flatMap((sub) => {
        const matchingPages = subcatPages.filter((p) => p.subcategory_slug === sub.slug)
        if (matchingPages.length === 0) return []
        return matchingPages.flatMap((p) => [
          `### ${cat.name} → ${sub.name} — subcategory page`,
          `(wiki_page_id: \`${p.id}\`, file: ${p.file_path})`,
          "",
          ...sub.sections.flatMap((sec) => [
            `**${sec.heading}** (\`section_slug: "${sec.slug}"\`)`,
            `> ${sec.description}`,
            "",
          ]),
        ])
      }),
    ),
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

// ── Tool definition ────────────────────────────────────────────────────────

export const KbPipelineRunTool = Tool.defineEffect(
  "kb_pipeline_run",
  Effect.gen(function* () {
    const agentService = yield* Agent.Service
    const config = yield* Config.Service

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

      // ── Build schema context ──────────────────────────────────────────
      const pages = yield* Effect.sync(() => Workspace.getWikiPages(params.workspace_id))
      const schema = yield* Effect.sync(() => KbSchema.buildContent(params.workspace_id))
      const curatorPrompt = buildCuratorPrompt(resource, workspace, pages, schema)

      // ── Create child session ──────────────────────────────────────────
      const childSession = yield* Effect.promise(() =>
        Session.create({
          parentID: ctx.sessionID,
          title: `KB: ${resource.title ?? resource.url ?? resource.id}`,
          permission: [
            // Lock the curator to KB tools only — deny destructive tools
            { permission: "bash" as const, pattern: "*" as const, action: "deny" as const },
            { permission: "edit" as const, pattern: "*" as const, action: "deny" as const },
            { permission: "write" as const, pattern: "*" as const, action: "deny" as const },
            { permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const },
            { permission: "task" as const, pattern: "*" as const, action: "deny" as const },
          ],
        }),
      )

      const messageID = MessageID.ascending()

      ctx.metadata({
        title: `KB: ${resource.title ?? resource.url ?? resource.id}`,
        metadata: { task_id: childSession.id, resource_id: params.resource_id },
      })

      const parts = yield* Effect.promise(() => SessionPrompt.resolvePromptParts(curatorPrompt))

      // ── Fire and forget ───────────────────────────────────────────────
      // Intentionally not awaited — the curator runs in background.
      SessionPrompt.prompt({
        sessionID: childSession.id,
        messageID,
        model,
        agent: "kb-curator",
        tools: {
          // Disable non-KB tools in this session
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
          // Allow read so curator can inspect existing wiki content if needed
          // KB tools are all enabled by default
        },
        parts,
      }).catch((err: unknown) => {
        console.error(
          "[KB Pipeline] Error in curator session:",
          err instanceof Error ? err.message : String(err),
        )
      })

      return {
        title: "KB pipeline started",
        metadata: { task_id: childSession.id, resource_id: params.resource_id },
        output: [
          `task_id: ${childSession.id}`,
          `resource: ${resource.title ?? resource.url ?? resource.id}`,
          "",
          "KB extraction running in background.",
          "The wiki will be updated automatically — you can continue chatting.",
          "",
          "To check progress, look for the child session in your session list.",
        ].join("\n"),
      }
    })

    return {
      description: [
        "Trigger the background KB extraction pipeline for a memorized resource.",
        "",
        "Creates a child KBCurator session that runs in the background — returns immediately.",
        "The curator reads the resource content, extracts knowledge per the schema sections,",
        "calls kb_resource_place (×N), kb_concept_upsert, kb_wiki_build, and kb_event_log.",
        "",
        "Call this AFTER kb_resource_create. The user can continue chatting immediately.",
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
