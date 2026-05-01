import z from "zod"
import { mkdirSync } from "fs"
import path from "path"
import { Tool } from "../tool"
import { Workspace } from "../../learning/workspace"
import { WikiBuilder } from "../../learning/wiki-builder"

// ── Built-in templates ────────────────────────────────────────────────────────

const TEMPLATES = {
  ml: {
    categories: [
      { slug: "agents", name: "Agents", description: "Autonomous AI systems that reason, plan, and act using tools, memory, and environment feedback to complete multi-step tasks.", depth: "deep" as const, icon: "🤖" },
      { slug: "rag", name: "RAG", description: "Retrieval-Augmented Generation — grounding LLM outputs with external knowledge retrieval for accurate, up-to-date responses.", depth: "deep" as const, icon: "🔍" },
      { slug: "llm-inference", name: "LLM Inference", description: "Serving large language models efficiently — latency, throughput, quantization, batching, and hardware trade-offs.", depth: "working" as const, icon: "⚡" },
      { slug: "llm-training", name: "LLM Training", description: "Pre-training, fine-tuning, RLHF, and alignment techniques that shape how large language models learn and behave.", depth: "working" as const, icon: "🧠" },
    ],
    sectionName: "Key Concepts",
  },
  software: {
    categories: [
      { slug: "database", name: "Database", description: "Relational and non-relational databases — schema design, indexing, query optimization, transactions, and consistency models.", depth: "working" as const, icon: "🗄️" },
      { slug: "frontend", name: "Frontend", description: "UI engineering — component architecture, state management, rendering strategies, accessibility, and performance.", depth: "working" as const, icon: "🖥️" },
      { slug: "software-system-design", name: "Software System Design", description: "Distributed systems, scalability patterns, API design, caching, and architectural trade-offs for production systems.", depth: "deep" as const, icon: "🏗️" },
    ],
    sectionName: "Key Concepts",
  },
} as const

const CategoryInput = z.object({
  slug: z.string().describe("URL-safe slug, e.g. 'agents', 'rag', 'systems-design'"),
  name: z.string().describe("Display name, e.g. 'Agents', 'RAG', 'Systems Design'"),
  description: z.string().optional().describe("One-line description of this domain"),
  depth: z.enum(["deep", "working", "awareness"]).optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
})

export const KbOnboardCompleteTool = Tool.define("kb_onboard_complete", {
  description: [
    "Complete KB onboarding. Saves the learning profile and builds the initial wiki structure.",
    "",
    "Supports three modes via the `template` field:",
    "  'ml'       — creates Agents, RAG, LLM Inference, LLM Training categories (each with a Key Concepts section)",
    "  'software' — creates Database, Frontend, Software System Design categories (each with a Key Concepts section)",
    "  'custom'   — uses the `categories` array you provide; you must supply at least one category",
    "",
    "When template is 'ml' or 'software', the `categories` field is ignored — the template defines them.",
    "After this call succeeds, the user can add/remove/rename categories and sections freely.",
  ].join("\n"),
  parameters: z.object({
    workspace_id: z.string(),
    template: z.enum(["ml", "software", "custom"]).describe("Which category template to use"),
    learning_intent: z.string().describe("One sentence: what the user wants to achieve"),
    years_of_experience: z.number().optional(),
    goals: z.array(z.string()).describe("2-5 concrete goals"),
    depth_prefs: z.record(z.string(), z.enum(["deep", "working", "awareness"])).default({}),
    trusted_sources: z.array(z.string()).optional(),
    scout_platforms: z.array(z.string()).optional(),
    categories: z.array(CategoryInput).optional().describe("Required when template is 'custom'"),
  }),
  async execute(params, ctx) {
    // Resolve categories from template or custom input
    const templateDef = params.template !== "custom" ? TEMPLATES[params.template] : undefined
    const resolvedCategories = templateDef
      ? templateDef.categories.map((c) => ({ ...c, color: undefined }))
      : (params.categories ?? [])

    if (resolvedCategories.length === 0) {
      throw new Error("No categories provided. For custom template, supply at least one category.")
    }

    await ctx.ask({
      permission: "edit",
      patterns: ["wiki/**", "raw/", "supadense.md", "log.md"],
      always: ["*"],
      metadata: {
        filepath: params.workspace_id,
        diff: `Onboarding (${params.template} template): creating ${resolvedCategories.length} categories`,
      },
    })

    // Save workspace metadata (intent, goals, etc.) and mark as initialized
    Workspace.completeOnboarding(params.workspace_id, {
      learning_intent: params.learning_intent,
      years_of_experience: params.years_of_experience,
      goals: params.goals,
      depth_prefs: params.depth_prefs,
      trusted_sources: params.trusted_sources ?? [],
      scout_platforms: params.scout_platforms ?? [],
      categories: resolvedCategories,
      subcategories: [],
    })

    const workspace = Workspace.getById(params.workspace_id)!

    // Scaffold root directory structure
    mkdirSync(path.join(workspace.kb_path, "assets"), { recursive: true })
    mkdirSync(path.join(workspace.kb_path, "raw"), { recursive: true })

    // Create each category as a proper folder with overview.md
    const createdCategories: ReturnType<typeof Workspace.createCategory>["category"][] = []
    for (let i = 0; i < resolvedCategories.length; i++) {
      const cat = resolvedCategories[i]
      const { category } = Workspace.createCategory(
        params.workspace_id,
        cat.name,
        undefined,
        cat.description,
        { depth: cat.depth, icon: (cat as { icon?: string }).icon, color: (cat as { color?: string }).color, position: i },
      )
      createdCategories.push(category)
    }

    WikiBuilder.buildSupadenseMd(workspace)
    WikiBuilder.buildLogFile(workspace)

    const pages = Workspace.getWikiPages(params.workspace_id)

    return {
      title: "Onboarding complete",
      metadata: {
        workspace_id: params.workspace_id,
        template: params.template,
        categories_created: createdCategories.length,
        pages_created: pages.length,
      },
      output: [
        `Onboarding complete (${params.template} template). Created ${createdCategories.length} categories and ${pages.length} wiki pages.`,
        "",
        "Categories:",
        ...createdCategories.map((c) => `  • ${c.icon ?? ""} ${c.name} (${c.depth})`),
        "",
        "You can add/remove/rename categories and sections at any time from the file panel or via chat.",
      ].join("\n"),
    }
  },
})
