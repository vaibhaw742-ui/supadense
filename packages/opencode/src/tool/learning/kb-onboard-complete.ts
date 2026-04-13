/**
 * kb_onboard_complete — Save onboarding profile and build initial KB structure.
 *
 * After gathering the user's intent, goals, and categories through conversation,
 * call this tool to persist everything and scaffold the wiki pages, schema.json,
 * supadense.md, and log.md.
 */
import z from "zod"
import { Tool } from "../tool"
import { Workspace } from "../../learning/workspace"
import { WikiBuilder } from "../../learning/wiki-builder"
import { KbSchema, DEFAULT_SUBCATEGORIES } from "../../learning/kb-schema"

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
    "  3. Apply default subcategory structure (key-concepts, papers, examples, tools) to every category",
    "  4. Write schema.json, supadense.md, log.md, and all wiki pages to disk",
    "  5. Log the onboarding event",
    "",
    "The subcategory structure can be evolved later via chat (add/remove sections, subcategories).",
  ].join("\n"),
  parameters: z.object({
    workspace_id: z.string().describe("Workspace ID from kb_workspace_init output"),
    learning_intent: z.string().describe("One sentence: what the user is trying to achieve"),
    goals: z.array(z.string()).describe("2-5 concrete goals"),
    depth_prefs: z
      .record(z.string(), z.enum(["deep", "working", "awareness"]))
      .describe("Per-category depth override, e.g. { 'agents': 'deep', 'rag': 'working' }"),
    trusted_sources: z.array(z.string()).optional().describe("Domains or authors the user trusts"),
    scout_platforms: z.array(z.string()).optional().describe("Where to look for content, e.g. ['Twitter', 'HN', 'ArXiv']"),
    categories: z.array(CategoryInput).describe("The 2-6 knowledge domains to track"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "edit",
      patterns: ["wiki/**", "schema.json", "supadense.md", "log.md"],
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
      subcategories: DEFAULT_SUBCATEGORIES,
    })

    const workspace = Workspace.getById(params.workspace_id)!

    // Ensure schema metadata row exists and render schema.json
    KbSchema.ensure(params.workspace_id)
    KbSchema.renderToFile(params.workspace_id)

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
        "All files written to disk: schema.json, supadense.md, log.md, wiki/",
      ].join("\n"),
    }
  },
})
