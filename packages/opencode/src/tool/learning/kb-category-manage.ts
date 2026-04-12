/**
 * kb_category_manage — Add or remove categories and subcategories from the KB.
 *
 * Supports:
 *   - add_category: create a new top-level category + its wiki page
 *   - remove_category: delete a category + all its wiki pages and placements
 *   - add_subcategory: add a subcategory page under an existing category
 *   - remove_subcategory: delete a subcategory page and its placements
 */
import z from "zod"
import { ulid } from "ulid"
import { eq, and } from "drizzle-orm"
import { Tool } from "../tool"
import { Instance } from "../../project/instance"
import { Workspace } from "../../learning/workspace"
import { WikiBuilder } from "../../learning/wiki-builder"
import { Database } from "../../storage/db"
import {
  LearningCategoryTable,
  LearningWikiPageTable,
  LearningResourceWikiPlacementTable,
} from "../../learning/schema.sql"

export const KbCategoryManageTool = Tool.define("kb_category_manage", {
  description: [
    "Add or remove categories and subcategories in the knowledge base.",
    "",
    "Actions:",
    "  add_category     — create a new top-level category and its wiki page",
    "  remove_category  — delete a category and ALL its pages, placements, and files",
    "  add_subcategory  — add a subcategory page under an existing category",
    "  remove_subcategory — delete a subcategory page and its placements",
    "",
    "After any change, wiki files on disk are automatically rebuilt.",
  ].join("\n"),
  parameters: z.object({
    action: z.enum(["add_category", "remove_category", "add_subcategory", "remove_subcategory"]),

    // For add_category / remove_category
    category_slug: z.string().describe("Kebab-case slug, e.g. 'systems-design'"),
    category_name: z.string().optional().describe("Display name, e.g. 'Systems Design' (required for add_category)"),
    category_description: z.string().optional().describe("One-line description (optional)"),
    category_depth: z.enum(["deep", "working", "awareness"]).optional().describe("Depth preference (default: working)"),
    category_icon: z.string().optional().describe("Emoji icon, e.g. '🧠'"),

    // For add_subcategory / remove_subcategory
    subcategory_slug: z.string().optional().describe("Kebab-case slug, e.g. 'key-concepts' (required for subcategory actions)"),
    subcategory_name: z.string().optional().describe("Display name, e.g. 'Key Concepts' (required for add_subcategory)"),
  }),

  async execute(params, ctx) {
    const project = Instance.project
    const workspace = Workspace.get(project.id)
    if (!workspace) throw new Error("No KB workspace found. Run kb_workspace_init first.")

    const workspaceId = workspace.id
    const now = Date.now()

    // ── add_category ──────────────────────────────────────────────────────────
    if (params.action === "add_category") {
      if (!params.category_name) throw new Error("category_name is required for add_category")

      await ctx.ask({
        permission: "edit",
        patterns: [`wiki/${params.category_slug}.md`, "wiki/index.md", "supadense.md"],
        always: ["*"],
        metadata: { filepath: `wiki/${params.category_slug}.md`, diff: `Add category: ${params.category_name}` },
      })

      // Check for existing
      const existing = Database.use((db) =>
        db.select().from(LearningCategoryTable)
          .where(and(
            eq(LearningCategoryTable.workspace_id, workspaceId),
            eq(LearningCategoryTable.slug, params.category_slug),
          )).get(),
      )
      if (existing) throw new Error(`Category '${params.category_slug}' already exists.`)

      const position = Database.use((db) =>
        db.select().from(LearningCategoryTable).where(eq(LearningCategoryTable.workspace_id, workspaceId)).all(),
      ).length

      const categoryId = ulid()
      Database.use((db) =>
        db.insert(LearningCategoryTable).values({
          id: categoryId,
          workspace_id: workspaceId,
          slug: params.category_slug,
          name: params.category_name!,
          description: params.category_description,
          depth: params.category_depth ?? "working",
          icon: params.category_icon,
          position,
          time_created: now,
          time_updated: now,
        }).run(),
      )

      Database.use((db) =>
        db.insert(LearningWikiPageTable).values({
          id: ulid(),
          workspace_id: workspaceId,
          category_id: categoryId,
          page_type: "category",
          category_slug: params.category_slug,
          slug: params.category_slug,
          title: params.category_name!,
          description: params.category_description,
          file_path: `wiki/${params.category_slug}.md`,
          sections: [],
          resource_count: 0,
          word_count: 0,
          time_created: now,
          time_updated: now,
        }).run(),
      )

      WikiBuilder.buildAll(workspaceId)
      WikiBuilder.buildSupadenseMd(workspace)

      Workspace.logEvent(workspaceId, {
        event_type: "category_added",
        summary: `Added category: ${params.category_name}`,
        payload: { slug: params.category_slug },
      })
      WikiBuilder.buildLogFile(workspace)

      return {
        title: `Category added: ${params.category_name}`,
        metadata: { category_slug: params.category_slug },
        output: `Added category '${params.category_name}' → wiki/${params.category_slug}.md`,
      }
    }

    // ── remove_category ───────────────────────────────────────────────────────
    if (params.action === "remove_category") {
      const category = Database.use((db) =>
        db.select().from(LearningCategoryTable)
          .where(and(
            eq(LearningCategoryTable.workspace_id, workspaceId),
            eq(LearningCategoryTable.slug, params.category_slug),
          )).get(),
      )
      if (!category) throw new Error(`Category '${params.category_slug}' not found.`)

      await ctx.ask({
        permission: "edit",
        patterns: [`wiki/${params.category_slug}*.md`, "wiki/index.md", "supadense.md"],
        always: ["*"],
        metadata: { filepath: `wiki/${params.category_slug}.md`, diff: `Remove category: ${category.name}` },
      })

      // Get all wiki pages for this category
      const pages = Database.use((db) =>
        db.select().from(LearningWikiPageTable)
          .where(eq(LearningWikiPageTable.category_id, category.id))
          .all(),
      )

      // Delete placements for each page
      for (const page of pages) {
        Database.use((db) =>
          db.delete(LearningResourceWikiPlacementTable)
            .where(eq(LearningResourceWikiPlacementTable.wiki_page_id, page.id))
            .run(),
        )
      }

      // Delete wiki pages
      Database.use((db) =>
        db.delete(LearningWikiPageTable)
          .where(eq(LearningWikiPageTable.category_id, category.id))
          .run(),
      )

      // Delete category
      Database.use((db) =>
        db.delete(LearningCategoryTable)
          .where(eq(LearningCategoryTable.id, category.id))
          .run(),
      )

      // Delete files
      const { unlinkSync, existsSync } = await import("fs")
      for (const page of pages) {
        const fullPath = `${workspace.kb_path}/${page.file_path}`
        if (existsSync(fullPath)) unlinkSync(fullPath)
      }

      WikiBuilder.buildAll(workspaceId)
      WikiBuilder.buildSupadenseMd(workspace)

      Workspace.logEvent(workspaceId, {
        event_type: "category_removed",
        summary: `Removed category: ${category.name}`,
        payload: { slug: params.category_slug, pages_removed: pages.length },
      })
      WikiBuilder.buildLogFile(workspace)

      return {
        title: `Category removed: ${category.name}`,
        metadata: { category_slug: params.category_slug, pages_removed: pages.length },
        output: `Removed category '${category.name}' and ${pages.length} wiki page(s).`,
      }
    }

    // ── add_subcategory ───────────────────────────────────────────────────────
    if (params.action === "add_subcategory") {
      if (!params.subcategory_slug) throw new Error("subcategory_slug is required for add_subcategory")
      if (!params.subcategory_name) throw new Error("subcategory_name is required for add_subcategory")

      const category = Database.use((db) =>
        db.select().from(LearningCategoryTable)
          .where(and(
            eq(LearningCategoryTable.workspace_id, workspaceId),
            eq(LearningCategoryTable.slug, params.category_slug),
          )).get(),
      )
      if (!category) throw new Error(`Category '${params.category_slug}' not found.`)

      const filePath = `wiki/${params.category_slug}--${params.subcategory_slug}.md`

      await ctx.ask({
        permission: "edit",
        patterns: [filePath, "wiki/index.md"],
        always: ["*"],
        metadata: { filepath: filePath, diff: `Add subcategory: ${params.subcategory_name}` },
      })

      // Find parent category page
      const parentPage = Database.use((db) =>
        db.select().from(LearningWikiPageTable)
          .where(and(
            eq(LearningWikiPageTable.workspace_id, workspaceId),
            eq(LearningWikiPageTable.category_id, category.id),
            eq(LearningWikiPageTable.page_type, "category"),
          )).get(),
      )

      Database.use((db) =>
        db.insert(LearningWikiPageTable).values({
          id: ulid(),
          workspace_id: workspaceId,
          category_id: category.id,
          parent_page_id: parentPage?.id,
          page_type: "subcategory",
          category_slug: params.category_slug,
          subcategory_slug: params.subcategory_slug,
          slug: params.subcategory_slug!,
          title: `${category.name} — ${params.subcategory_name}`,
          file_path: filePath,
          sections: [],
          resource_count: 0,
          word_count: 0,
          time_created: now,
          time_updated: now,
        }).run(),
      )

      WikiBuilder.buildAll(workspaceId)

      Workspace.logEvent(workspaceId, {
        event_type: "subcategory_added",
        summary: `Added subcategory: ${params.subcategory_name} under ${category.name}`,
        payload: { category_slug: params.category_slug, subcategory_slug: params.subcategory_slug },
      })
      WikiBuilder.buildLogFile(workspace)

      return {
        title: `Subcategory added: ${params.subcategory_name}`,
        metadata: { file_path: filePath },
        output: `Added subcategory '${params.subcategory_name}' → ${filePath}`,
      }
    }

    // ── remove_subcategory ────────────────────────────────────────────────────
    if (params.action === "remove_subcategory") {
      if (!params.subcategory_slug) throw new Error("subcategory_slug is required for remove_subcategory")

      const page = Database.use((db) =>
        db.select().from(LearningWikiPageTable)
          .where(and(
            eq(LearningWikiPageTable.workspace_id, workspaceId),
            eq(LearningWikiPageTable.category_slug, params.category_slug),
            eq(LearningWikiPageTable.subcategory_slug, params.subcategory_slug!),
          )).get(),
      )
      if (!page) throw new Error(`Subcategory '${params.category_slug}--${params.subcategory_slug}' not found.`)

      await ctx.ask({
        permission: "edit",
        patterns: [page.file_path],
        always: ["*"],
        metadata: { filepath: page.file_path, diff: `Remove subcategory: ${page.title}` },
      })

      // Delete placements
      Database.use((db) =>
        db.delete(LearningResourceWikiPlacementTable)
          .where(eq(LearningResourceWikiPlacementTable.wiki_page_id, page.id))
          .run(),
      )

      // Delete page
      Database.use((db) =>
        db.delete(LearningWikiPageTable)
          .where(eq(LearningWikiPageTable.id, page.id))
          .run(),
      )

      // Delete file
      const { unlinkSync, existsSync } = await import("fs")
      const fullPath = `${workspace.kb_path}/${page.file_path}`
      if (existsSync(fullPath)) unlinkSync(fullPath)

      Workspace.logEvent(workspaceId, {
        event_type: "subcategory_removed",
        summary: `Removed subcategory: ${page.title}`,
        payload: { category_slug: params.category_slug, subcategory_slug: params.subcategory_slug },
      })
      WikiBuilder.buildLogFile(workspace)

      return {
        title: `Subcategory removed: ${page.title}`,
        metadata: { file_path: page.file_path },
        output: `Removed subcategory '${page.title}' and deleted ${page.file_path}.`,
      }
    }

    throw new Error(`Unknown action: ${params.action}`)
  },
})
