/**
 * kb_category_manage — Add or remove categories and subcategories from the KB.
 *
 * Supports:
 *   - add_category: create a new top-level category folder + overview.md + key-concepts.md
 *   - remove_category: delete a category + all its wiki pages and placements
 *   - add_subcategory: add a subcategory page under an existing category
 *   - remove_subcategory: delete a subcategory page and its placements
 */
import path from "path"
import { mkdirSync, writeFileSync } from "fs"
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
import { DEFAULT_SECTIONS } from "../../learning/kb-schema"

export const KbCategoryManageTool = Tool.define("kb_category_manage", {
  description: [
    "Add or remove categories and subcategories in the knowledge base.",
    "",
    "Actions:",
    "  add_category       — create a new top-level category and its wiki page",
    "  remove_category    — delete a category and ALL its pages, placements, and files",
    "  add_subcategory    — add a subcategory page under an existing category",
    "  remove_subcategory — delete a subcategory page and its placements",
    "  add_section        — add a section to a category or subcategory page",
    "  remove_section     — remove a section from a category or subcategory page",
    "  update_section     — update a section's heading and/or description",
    "",
    "For section actions: omit subcategory_slug to target the category page itself.",
    "After any change, wiki files are automatically rebuilt.",
  ].join("\n"),
  parameters: z.object({
    action: z.enum(["add_category", "remove_category", "add_subcategory", "remove_subcategory", "add_section", "remove_section", "update_section"]),

    // For add_category / remove_category
    category_slug: z.string().describe("Kebab-case slug, e.g. 'systems-design'"),
    category_name: z.string().optional().describe("Display name, e.g. 'Systems Design' (required for add_category)"),
    category_description: z.string().optional().describe("One-line description (optional)"),
    category_depth: z.enum(["deep", "working", "awareness"]).optional().describe("Depth preference (default: working)"),
    category_icon: z.string().optional().describe("Emoji icon, e.g. '🧠'"),
    parent_path: z.string().optional().describe("Parent folder path relative to kb_path where the category folder will be created, e.g. 'wiki' (default) or 'research/rag'. Do not include trailing slash."),

    // For add_subcategory / remove_subcategory
    subcategory_slug: z.string().optional().describe("Kebab-case slug, e.g. 'key-concepts' (required for subcategory actions)"),
    subcategory_name: z.string().optional().describe("Display name, e.g. 'Key Concepts' (required for add_subcategory)"),

    // For add_section / remove_section
    // target: category page if subcategory_slug is omitted, subcategory page if provided
    section_slug: z.string().optional().describe("Section slug, e.g. 'key-concepts' (required for section actions)"),
    section_heading: z.string().optional().describe("Markdown heading, e.g. '## Key Concepts' (required for add_section)"),
    section_description: z.string().optional().describe("Extraction guidance for the curator (required for add_section)"),
  }),

  async execute(params, ctx) {
    type M = { category_slug: string; pages_removed?: number; file_path?: string }

    const kbPath = Instance.directory
    const workspace = Workspace.getByKbPath(kbPath)
    if (!workspace) throw new Error("No KB workspace found. Run kb_workspace_init first.")

    const workspaceId = workspace.id
    const now = Date.now()

    // ── add_category ──────────────────────────────────────────────────────────
    if (params.action === "add_category") {
      if (!params.category_name) throw new Error("category_name is required for add_category")

      const parentPath = (params.parent_path ?? "wiki").replace(/\/+$/, "")
      const folderRelPath = `${parentPath}/${params.category_slug}`
      const overviewRelPath = `${folderRelPath}/overview.md`
      const kcRelPath = `${folderRelPath}/key-concepts.md`

      await ctx.ask({
        permission: "edit",
        patterns: [overviewRelPath, kcRelPath, "wiki/index.md", "supadense.md"],
        always: ["*"],
        metadata: { filepath: overviewRelPath, diff: `Add category: ${params.category_name}` },
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

      // Create the category folder + default files
      const absFolder = path.join(workspace.kb_path, folderRelPath)
      mkdirSync(absFolder, { recursive: true })

      const overviewContent = [
        `# ${params.category_name}`,
        "",
        "> This file is maintained by Supadense. Do not edit directly.",
        "",
        params.category_description ?? `Overview of ${params.category_name}.`,
        "",
        "## Sections",
        "",
        "_No sections yet — create one to get started._",
        "",
      ].join("\n")
      writeFileSync(path.join(workspace.kb_path, overviewRelPath), overviewContent, "utf8")

      const humanName = params.category_slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
      const kcContent = [
        `# Key Concepts`,
        "",
        "> This file is maintained by Supadense. Do not edit directly.",
        "",
        `Core concepts for ${humanName}.`,
        "",
        "## Key Concepts",
        "",
        "_No content yet — add resources to fill this in._",
        "",
      ].join("\n")
      writeFileSync(path.join(workspace.kb_path, kcRelPath), kcContent, "utf8")

      // Insert DB records
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

      const overviewPageId = ulid()
      Database.use((db) =>
        db.insert(LearningWikiPageTable).values({
          id: overviewPageId,
          workspace_id: workspaceId,
          category_id: categoryId,
          type: "overview",
          page_type: "category",
          category_slug: params.category_slug,
          slug: "overview",
          title: params.category_name!,
          description: params.category_description,
          file_path: overviewRelPath,
          sections: DEFAULT_SECTIONS,
          resource_count: 0,
          word_count: 0,
          time_created: now,
          time_updated: now,
        }).run(),
      )

      Database.use((db) =>
        db.insert(LearningWikiPageTable).values({
          id: ulid(),
          workspace_id: workspaceId,
          category_id: categoryId,
          parent_page_id: overviewPageId,
          type: "section",
          page_type: "category",
          category_slug: params.category_slug,
          subcategory_slug: "key-concepts",
          slug: "key-concepts",
          title: "Key Concepts",
          file_path: kcRelPath,
          sections: DEFAULT_SECTIONS,
          resource_count: 0,
          word_count: 0,
          time_created: now,
          time_updated: now,
        }).run(),
      )

      Workspace.logEvent(workspaceId, {
        event_type: "category_added",
        summary: `Added category: ${params.category_name}`,
        payload: { slug: params.category_slug, folder: folderRelPath },
      })

      return {
        title: `Category added: ${params.category_name}`,
        metadata: { category_slug: params.category_slug, file_path: folderRelPath } as M,
        output: [
          `Added category '${params.category_name}':`,
          `  📁 ${folderRelPath}/`,
          `     overview.md`,
          `     key-concepts.md`,
        ].join("\n"),
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

      // Get all wiki pages for this category before deleting
      const pages = Database.use((db) =>
        db.select().from(LearningWikiPageTable)
          .where(eq(LearningWikiPageTable.category_id, category.id))
          .all(),
      )

      // Determine folder path from the overview page (new folder-based structure)
      // Falls back to deleting individual files for old flat-file categories
      const overviewPage = pages.find((p) => p.type === "overview" || p.slug === "overview")
      const folderRelPath = overviewPage
        ? path.dirname(overviewPage.file_path)
        : null

      await ctx.ask({
        permission: "edit",
        patterns: folderRelPath
          ? [`${folderRelPath}/**`, "wiki/index.md", "supadense.md"]
          : [`wiki/${params.category_slug}*.md`, "wiki/index.md", "supadense.md"],
        always: ["*"],
        metadata: {
          filepath: folderRelPath ?? `wiki/${params.category_slug}.md`,
          diff: `Remove category: ${category.name}`,
        },
      })

      // Delete placements for each page
      for (const page of pages) {
        Database.use((db) =>
          db.delete(LearningResourceWikiPlacementTable)
            .where(eq(LearningResourceWikiPlacementTable.wiki_page_id, page.id))
            .run(),
        )
      }

      // Delete wiki pages and category record
      Database.use((db) =>
        db.delete(LearningWikiPageTable)
          .where(eq(LearningWikiPageTable.category_id, category.id))
          .run(),
      )
      Database.use((db) =>
        db.delete(LearningCategoryTable)
          .where(eq(LearningCategoryTable.id, category.id))
          .run(),
      )

      // Delete files: remove entire folder if folder-based, else delete individual flat files
      const { rmSync, unlinkSync, existsSync } = await import("fs")
      if (folderRelPath) {
        const absFolder = path.join(workspace.kb_path, folderRelPath)
        if (existsSync(absFolder)) rmSync(absFolder, { recursive: true, force: true })
      } else {
        for (const page of pages) {
          const fullPath = path.join(workspace.kb_path, page.file_path)
          if (existsSync(fullPath)) unlinkSync(fullPath)
        }
      }

      Workspace.logEvent(workspaceId, {
        event_type: "category_removed",
        summary: `Removed category: ${category.name}`,
        payload: { slug: params.category_slug, folder: folderRelPath, pages_removed: pages.length },
      })

      return {
        title: `Category removed: ${category.name}`,
        metadata: { category_slug: params.category_slug, pages_removed: pages.length } as M,
        output: folderRelPath
          ? `Removed category '${category.name}' and deleted folder ${folderRelPath}/ (${pages.length} page(s)).`
          : `Removed category '${category.name}' and ${pages.length} wiki page(s).`,
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
          sections: DEFAULT_SECTIONS,
          resource_count: 0,
          word_count: 0,
          time_created: now,
          time_updated: now,
        }).run(),
      )

      // Register the subcategory as a section on the parent category page
      if (parentPage) {
        const currentSections = parentPage.sections ?? []
        const alreadyRegistered = currentSections.some((s) => s.slug === params.subcategory_slug)
        if (!alreadyRegistered) {
          Database.use((db) =>
            db.update(LearningWikiPageTable)
              .set({
                sections: [
                  ...currentSections,
                  {
                    slug: params.subcategory_slug!,
                    heading: `## ${params.subcategory_name}`,
                    description: `Content from the ${params.subcategory_name} subcategory.`,
                    updated_at: now,
                  },
                ],
                time_updated: now,
              })
              .where(eq(LearningWikiPageTable.id, parentPage.id))
              .run(),
          )
        }
      }

      WikiBuilder.buildAll(workspaceId)

      Workspace.logEvent(workspaceId, {
        event_type: "subcategory_added",
        summary: `Added subcategory: ${params.subcategory_name} under ${category.name}`,
        payload: { category_slug: params.category_slug, subcategory_slug: params.subcategory_slug },
      })
      WikiBuilder.buildLogFile(workspace)

      return {
        title: `Subcategory added: ${params.subcategory_name}`,
        metadata: { file_path: filePath } as M,
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
      WikiBuilder.buildAll(workspaceId)
      WikiBuilder.buildLogFile(workspace)

      return {
        title: `Subcategory removed: ${page.title}`,
        metadata: { file_path: page.file_path } as M,
        output: `Removed subcategory '${page.title}' and deleted ${page.file_path}.`,
      }
    }

    // ── add_section ───────────────────────────────────────────────────────────
    if (params.action === "add_section") {
      if (!params.section_slug) throw new Error("section_slug is required for add_section")
      if (!params.section_heading) throw new Error("section_heading is required for add_section")

      // Resolve parent page (category overview or subcategory overview)
      const allPages = Workspace.getWikiPages(workspaceId)
      const parentPage = params.subcategory_slug
        ? allPages.find((p) => p.category_slug === params.category_slug && p.subcategory_slug === params.subcategory_slug)
          ?? allPages.find((p) => p.category_slug === params.subcategory_slug && !p.subcategory_slug)
        : allPages.find((p) => p.category_slug === params.category_slug && (p.type === "overview" || p.slug === "overview"))
          ?? allPages.find((p) => p.category_slug === params.category_slug && !p.subcategory_slug)
      if (!parentPage) throw new Error(`Category/subcategory page not found for "${params.category_slug}"${params.subcategory_slug ? ` / "${params.subcategory_slug}"` : ""}. Check kb_workspace_init.`)

      // Determine the folder: use parent_path if given, else derive from the parent page's directory
      const folderRelPath = params.parent_path
        ? params.parent_path.replace(/\/+$/, "")
        : path.dirname(parentPage.file_path)

      const fileRelPath = `${folderRelPath}/${params.section_slug}.md`

      // Check for duplicate
      if (allPages.some((p) => p.file_path === fileRelPath)) {
        throw new Error(`Section file '${fileRelPath}' already exists.`)
      }

      await ctx.ask({
        permission: "edit",
        patterns: [fileRelPath],
        always: ["*"],
        metadata: { filepath: fileRelPath, diff: `Add section: ${params.section_heading}` },
      })

      // Create the section .md file
      const sectionName = params.section_slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
      const description = params.section_description ?? `Content about ${sectionName}.`
      const sectionContent = [
        `# ${sectionName}`,
        "",
        "> This file is maintained by Supadense. Do not edit directly.",
        "",
        description,
        "",
        "## Key Concepts",
        "",
        "_No content yet — add resources to fill this in._",
        "",
      ].join("\n")

      mkdirSync(path.join(workspace.kb_path, folderRelPath), { recursive: true })
      writeFileSync(path.join(workspace.kb_path, fileRelPath), sectionContent, "utf8")

      // Insert a wiki page record for this section
      const categoryRecord = Database.use((db) =>
        db.select().from(LearningCategoryTable)
          .where(and(eq(LearningCategoryTable.workspace_id, workspaceId), eq(LearningCategoryTable.slug, params.category_slug)))
          .get(),
      )

      const sectionSlug = params.section_slug!
      const catId: string | null = categoryRecord?.id ?? parentPage.category_id ?? null

      Database.use((db) =>
        db.insert(LearningWikiPageTable).values({
          id: ulid(),
          workspace_id: workspaceId,
          category_id: catId,
          parent_page_id: parentPage.id,
          type: "section",
          page_type: parentPage.page_type as "category" | "subcategory",
          category_slug: params.category_slug,
          subcategory_slug: sectionSlug,
          slug: sectionSlug,
          title: sectionName,
          description,
          file_path: fileRelPath,
          sections: DEFAULT_SECTIONS,
          resource_count: 0,
          word_count: 0,
          time_created: now,
          time_updated: now,
        }).run(),
      )

      // Register section on the parent page's sections list
      const currentSections = parentPage.sections ?? []
      if (!currentSections.some((s) => s.slug === params.section_slug)) {
        Database.use((db) =>
          db.update(LearningWikiPageTable)
            .set({
              sections: [...currentSections, {
                slug: params.section_slug!,
                heading: params.section_heading!,
                description,
                updated_at: now,
              }],
              time_updated: now,
            })
            .where(eq(LearningWikiPageTable.id, parentPage.id))
            .run(),
        )
      }

      Workspace.logEvent(workspaceId, {
        event_type: "section_added",
        summary: `Added section '${sectionName}' at ${fileRelPath}`,
        payload: { section_slug: params.section_slug, file_path: fileRelPath },
      })

      return {
        title: `Section added: ${sectionName}`,
        metadata: { category_slug: params.category_slug, file_path: fileRelPath } as M,
        output: `Added section '${sectionName}' → ${fileRelPath}`,
      }
    }

    // ── remove_section ────────────────────────────────────────────────────────
    if (params.action === "remove_section") {
      if (!params.section_slug) throw new Error("section_slug is required for remove_section")

      const allPages2 = Workspace.getWikiPages(workspaceId)
      const targetPage = params.subcategory_slug
        ? allPages2.find((p) => p.category_slug === params.category_slug && p.subcategory_slug === params.subcategory_slug) ??
          allPages2.find((p) => p.category_slug === params.subcategory_slug && !p.subcategory_slug)
        : allPages2.find((p) => p.category_slug === params.category_slug && !p.subcategory_slug)
      if (!targetPage) throw new Error(`Page not found for "${params.category_slug}"${params.subcategory_slug ? ` / "${params.subcategory_slug}"` : ""}. Check kb_workspace_init.`)

      const currentSections = targetPage.sections ?? []
      const section = currentSections.find((s) => s.slug === params.section_slug)
      // section may not be in the DB array if it was created dynamically via placements — proceed anyway

      // Remove from page's sections array if present
      if (section) {
        Database.use((db) =>
          db.update(LearningWikiPageTable)
            .set({
              sections: currentSections.filter((s) => s.slug !== params.section_slug),
              time_updated: now,
            })
            .where(eq(LearningWikiPageTable.id, targetPage.id))
            .run(),
        )
      }

      // Delete all placements for this section so the wiki file stops rendering it
      Database.use((db) =>
        db.delete(LearningResourceWikiPlacementTable)
          .where(and(
            eq(LearningResourceWikiPlacementTable.wiki_page_id, targetPage.id),
            eq(LearningResourceWikiPlacementTable.section_slug, params.section_slug!),
          ))
          .run(),
      )

      WikiBuilder.buildAll(workspaceId)

      const sectionLabel = section?.heading ?? params.section_slug!

      Workspace.logEvent(workspaceId, {
        event_type: "section_removed",
        summary: `Removed section '${sectionLabel}' from ${targetPage.file_path}`,
        payload: { section_slug: params.section_slug, file_path: targetPage.file_path },
      })

      return {
        title: `Section removed: ${sectionLabel}`,
        metadata: { category_slug: params.category_slug, file_path: targetPage.file_path } as M,
        output: [
          `Removed section '${sectionLabel}' from ${targetPage.file_path}.`,
        ].join("\n"),
      }
    }

    // ── update_section ────────────────────────────────────────────────────────
    if (params.action === "update_section") {
      if (!params.section_slug) throw new Error("section_slug is required for update_section")
      if (!params.section_heading && !params.section_description)
        throw new Error("Provide at least one of: section_heading, section_description")

      const allPages3 = Workspace.getWikiPages(workspaceId)
      const targetPage = params.subcategory_slug
        ? allPages3.find((p) => p.category_slug === params.category_slug && p.subcategory_slug === params.subcategory_slug) ??
          allPages3.find((p) => p.category_slug === params.subcategory_slug && !p.subcategory_slug)
        : allPages3.find((p) => p.category_slug === params.category_slug && !p.subcategory_slug)
      if (!targetPage) throw new Error(`Page not found for "${params.category_slug}"${params.subcategory_slug ? ` / "${params.subcategory_slug}"` : ""}. Check kb_workspace_init.`)

      const currentSections = targetPage.sections ?? []
      const idx = currentSections.findIndex((s) => s.slug === params.section_slug)
      if (idx === -1) throw new Error(`Section '${params.section_slug}' not found on this page.`)

      const updated = {
        ...currentSections[idx],
        ...(params.section_heading ? { heading: params.section_heading } : {}),
        ...(params.section_description ? { description: params.section_description } : {}),
        updated_at: now,
      }
      const newSections = [...currentSections]
      newSections[idx] = updated

      Database.use((db) =>
        db.update(LearningWikiPageTable)
          .set({ sections: newSections, time_updated: now })
          .where(eq(LearningWikiPageTable.id, targetPage.id))
          .run(),
      )

      // If heading changed, update it on all existing placements so the wiki renders correctly
      let placementsUpdated = 0
      if (params.section_heading && params.section_heading !== currentSections[idx].heading) {
        const result = Database.use((db) =>
          db.update(LearningResourceWikiPlacementTable)
            .set({ section_heading: params.section_heading! })
            .where(and(
              eq(LearningResourceWikiPlacementTable.wiki_page_id, targetPage.id),
              eq(LearningResourceWikiPlacementTable.section_slug, params.section_slug!),
            ))
            .returning()
            .all(),
        )
        placementsUpdated = result.length
      }

      WikiBuilder.buildAll(workspaceId)

      Workspace.logEvent(workspaceId, {
        event_type: "section_updated",
        summary: `Updated section '${updated.heading}' in ${targetPage.file_path}`,
        payload: { section_slug: params.section_slug, file_path: targetPage.file_path, placements_updated: placementsUpdated },
      })

      return {
        title: `Section updated: ${updated.heading}`,
        metadata: { category_slug: params.category_slug, file_path: targetPage.file_path } as M,
        output: [
          `Updated section '${params.section_slug}' in ${targetPage.file_path}:`,
          `  heading: ${updated.heading}`,
          `  description: ${updated.description}`,
          placementsUpdated > 0 ? `  ${placementsUpdated} placement(s) updated with new heading.` : "",
        ].filter(Boolean).join("\n"),
      }
    }

    throw new Error(`Unknown action: ${params.action}`)
  },
})
