/**
 * kb_onboard_complete — Save onboarding profile and build initial KB structure.
 *
 * After gathering the user's intent, goals, categories and depth preferences
 * through conversation, call this tool to persist everything and scaffold the
 * wiki pages, supadense.md, and log.md.
 */
import z from "zod"
import { Tool } from "../tool"
import { Instance } from "../../project/instance"
import { Workspace } from "../../learning/workspace"
import { WikiBuilder } from "../../learning/wiki-builder"

const CategoryInput = z.object({
  slug: z.string().describe("URL-safe slug, e.g. 'agents', 'rag', 'systems-design'"),
  name: z.string().describe("Display name, e.g. 'Agents', 'RAG', 'Systems Design'"),
  description: z.string().optional().describe("One-line description of this domain"),
  depth: z
    .enum(["deep", "working", "awareness"])
    .optional()
    .describe("'deep' = expert focus | 'working' = practical | 'awareness' = survey"),
  color: z.string().optional().describe("Hex color for UI, e.g. '#6366f1'"),
  icon: z.string().optional().describe("Emoji icon, e.g. '🤖'"),
})

export const KbOnboardCompleteTool = Tool.define("kb_onboard_complete", {
  description: [
    "Complete the KB onboarding by saving the user's learning profile and building the initial wiki structure.",
    "",
    "Call this AFTER collecting all onboarding information through conversation.",
    "It will:",
    "  1. Save the workspace profile (intent, goals, trusted sources, etc.)",
    "  2. Create category records and their wiki pages in the DB",
    "  3. If a template_slug is provided, create subcategory pages (agents--key-concepts.md etc.)",
    "  4. Regenerate supadense.md, wiki/index.md, and all wiki pages from DB state",
    "  5. Log the onboarding event",
    "",
    "Available templates: 'software-engineering', 'research', 'product'",
    "(If no template matches, leave template_slug empty and create custom categories.)",
  ].join("\n"),
  parameters: z.object({
    workspace_id: z.string().describe("Workspace ID from kb_workspace_init output"),
    learning_intent: z.string().describe("One sentence: what the user is trying to achieve, e.g. 'Build production-grade AI agent systems'"),
    goals: z.array(z.string()).describe("2-5 concrete goals, e.g. ['Understand ReAct prompting', 'Build a multi-agent pipeline']"),
    depth_prefs: z
      .record(z.string(), z.enum(["deep", "working", "awareness"]))
      .describe("Per-category depth override, e.g. { 'agents': 'deep', 'rag': 'working' }"),
    trusted_sources: z.array(z.string()).optional().describe("Domains or authors the user trusts, e.g. ['arxiv.org', 'Simon Willison']"),
    scout_platforms: z.array(z.string()).optional().describe("Where to look for content, e.g. ['Twitter', 'HN', 'ArXiv']"),
    categories: z.array(CategoryInput).describe("The 2-6 knowledge domains to track"),
    template_slug: z
      .string()
      .optional()
      .describe("Schema template to apply ('software-engineering' | 'research' | 'product'). Leave empty for custom categories only."),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "edit",
      patterns: ["wiki/**", "supadense.md", "log.md"],
      always: ["*"],
      metadata: {
        filepath: params.workspace_id,
        diff: `Onboarding: creating ${params.categories.length} categories + wiki pages`,
      },
    })

    const categories = Workspace.completeOnboarding(params.workspace_id, {
      learning_intent: params.learning_intent,
      goals: params.goals,
      depth_prefs: params.depth_prefs,
      trusted_sources: params.trusted_sources ?? [],
      scout_platforms: params.scout_platforms ?? [],
      categories: params.categories,
      template_slug: params.template_slug,
    })

    const workspace = Workspace.getById(params.workspace_id)!

    // Build all wiki files from DB state
    WikiBuilder.buildAll(params.workspace_id)
    WikiBuilder.buildSupadenseMd(workspace)
    WikiBuilder.buildLogFile(workspace)

    const pages = Workspace.getWikiPages(params.workspace_id)

    return {
      title: "Onboarding complete",
      metadata: {
        workspace_id: params.workspace_id,
        categories_created: categories.length,
        pages_created: pages.length,
      },
      output: [
        `Onboarding complete. Created ${categories.length} categories and ${pages.length} wiki pages.`,
        "",
        "Categories:",
        ...categories.map((c) => `  • ${c.icon ?? ""} ${c.name} (${c.depth}) → wiki/${c.slug}.md`),
        "",
        "Wiki pages:",
        ...pages.map((p) => `  • ${p.file_path} [${p.page_type}]`),
        "",
        "All files have been written to disk.",
        `supadense.md and log.md have been updated.`,
      ].join("\n"),
    }
  },
})
