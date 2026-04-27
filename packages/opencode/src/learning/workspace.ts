/**
 * workspace.ts — Learning KB workspace operations
 */
import path from "path"
import { mkdirSync, writeFileSync, existsSync, rmSync, renameSync, statSync, readdirSync } from "fs"
import { ulid } from "ulid"
import { eq, and } from "drizzle-orm"
import { KbWatcher } from "./kb-watcher"
import { Database } from "../storage/db"
import {
  LearningKbWorkspaceTable,
  LearningCategoryTable,
  LearningWikiPageTable,
  LearningKbEventTable,
} from "./schema.sql"
import { type SchemaSubcategory, DEFAULT_SECTIONS } from "./kb-schema"

export type Workspace = typeof LearningKbWorkspaceTable.$inferSelect
export type Category = typeof LearningCategoryTable.$inferSelect
export type WikiPage = typeof LearningWikiPageTable.$inferSelect

export interface OnboardingProfile {
  learning_intent: string
  years_of_experience?: number
  goals: string[]
  depth_prefs: Record<string, string>
  trusted_sources: string[]
  scout_platforms: string[]
  categories: {
    slug: string
    name: string
    description?: string
    depth?: "deep" | "working" | "awareness"
    color?: string
    icon?: string
  }[]
  subcategories: SchemaSubcategory[] // applied to every category
}

function humanize(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

function categoryOverviewDescription(name: string, parentName?: string): string {
  if (parentName) {
    return `${name} is a sub-area of ${parentName}, covering specific concepts, tools, and resources within this domain. Add sections below to organise what you learn.`
  }
  return `${name} is a top-level knowledge area in your KB. This overview tracks the sections and sub-categories you create as you learn and curate resources in this space.`
}

function sectionDescription(sectionName: string, categoryName: string): string {
  return `${sectionName} within ${categoryName} — curated resources, key concepts, and practical insights focused on this topic.`
}

export namespace Workspace {
  export function get(projectId: string): Workspace | undefined {
    return Database.use((db) =>
      db.select().from(LearningKbWorkspaceTable).where(eq(LearningKbWorkspaceTable.project_id, projectId)).get(),
    )
  }

  export function getById(id: string): Workspace | undefined {
    return Database.use((db) =>
      db.select().from(LearningKbWorkspaceTable).where(eq(LearningKbWorkspaceTable.id, id)).get(),
    )
  }

  export function getByKbPath(kbPath: string): Workspace | undefined {
    return Database.use((db) =>
      db.select().from(LearningKbWorkspaceTable).where(eq(LearningKbWorkspaceTable.kb_path, kbPath)).get(),
    )
  }

  export function ensure(projectId: string, kbPath: string): Workspace {
    // Always key workspaces by kb_path — each unique folder is a separate KB
    const byPath = getByKbPath(kbPath)
    if (byPath) return byPath

    // project_id must be unique per row. If another workspace already holds this
    // project_id (e.g. "global" for all non-git folders), use kb_path as a
    // synthetic project_id so the unique constraint stays satisfied.
    const byProject = get(projectId)
    const effectiveProjectId = byProject ? kbPath : projectId

    const now = Date.now()
    const id = ulid()
    Database.use((db) =>
      db.insert(LearningKbWorkspaceTable).values({
        id,
        project_id: effectiveProjectId,
        kb_path: kbPath,
        kb_initialized: false,
        goals: [],
        gaps: [],
        depth_prefs: {},
        trusted_sources: [],
        scout_platforms: [],
        extra_folders: [],
        time_created: now,
        time_updated: now,
      }).run(),
    )
    return getByKbPath(kbPath)!
  }

  export function update(id: string, data: Partial<Omit<Workspace, "id" | "project_id" | "time_created">>): void {
    Database.use((db) =>
      db
        .update(LearningKbWorkspaceTable)
        .set({ ...data, time_updated: Date.now() })
        .where(eq(LearningKbWorkspaceTable.id, id))
        .run(),
    )
  }

  export function scaffoldFiles(workspace: Workspace): void {
    const { kb_path } = workspace
    const wikiDir = path.join(kb_path, "wiki")
    const assetsDir = path.join(kb_path, "assets")

    mkdirSync(wikiDir, { recursive: true })
    mkdirSync(assetsDir, { recursive: true })

    KbWatcher.start(workspace.id, kb_path)

    const supadensePath = path.join(kb_path, "supadense.md")
    if (!existsSync(supadensePath)) {
      writeFileSync(
        supadensePath,
        [
          "# Knowledge Base",
          "",
          "> This file is managed by the supadense agent. Edit via chat only.",
          "",
          "## Learning Intent",
          "",
          "<!-- Filled during onboarding -->",
          "",
          "## Goals",
          "",
          "<!-- Filled during onboarding -->",
          "",
          "## Focus Areas",
          "",
          "<!-- Categories and depth prefs filled during onboarding -->",
          "",
          "## Trusted Sources",
          "",
          "<!-- Filled during onboarding -->",
        ].join("\n"),
        "utf8",
      )
    }

    const logPath = path.join(kb_path, "log.md")
    if (!existsSync(logPath)) {
      writeFileSync(
        logPath,
        [
          "# Activity Log",
          "",
          "> This file is managed by the supadense agent. Edit via chat only.",
          "",
          `_Initialized: ${new Date().toISOString().split("T")[0]}_`,
          "",
        ].join("\n"),
        "utf8",
      )
    }

    const indexPath = path.join(wikiDir, "index.md")
    if (!existsSync(indexPath)) {
      writeFileSync(
        indexPath,
        [
          "# Knowledge Index",
          "",
          "> This file is managed by the supadense agent. Edit via chat only.",
          "",
          "## Categories",
          "",
          "<!-- Built automatically when categories are added -->",
          "",
        ].join("\n"),
        "utf8",
      )
    }

    ensureIndexPage(workspace)
    syncExistingWikiFiles(workspace)
  }

  // Scan existing wiki/ tree on startup so files created before the watcher started
  // (or between restarts) are reflected in the DB. syncFolderAdded / syncFileAdded are
  // both idempotent — safe to call even if the record already exists.
  function syncExistingWikiFiles(workspace: Workspace): void {
    const wikiDir = path.join(workspace.kb_path, "wiki")
    if (!existsSync(wikiDir)) return

    function scanDir(absDir: string) {
      let entries: ReturnType<typeof readdirSync>
      try {
        entries = readdirSync(absDir, { withFileTypes: true })
      } catch {
        return
      }

      // Process sub-directories first so parent categories exist in DB before files
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const childAbs = path.join(absDir, entry.name)
        const rel = path.relative(workspace.kb_path, childAbs).replace(/\\/g, "/")
        syncFolderAdded(workspace.id, rel)
        scanDir(childAbs)
      }

      // Then process .md files (skip overview.md — syncFolderAdded already handles it)
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "overview.md") continue
        const fileAbs = path.join(absDir, entry.name)
        const rel = path.relative(workspace.kb_path, fileAbs).replace(/\\/g, "/")
        syncFileAdded(workspace.id, rel)
      }
    }

    scanDir(wikiDir)
  }

  function ensureIndexPage(workspace: Workspace): void {
    const existing = Database.use((db) =>
      db
        .select()
        .from(LearningWikiPageTable)
        .where(and(eq(LearningWikiPageTable.workspace_id, workspace.id), eq(LearningWikiPageTable.page_type, "index")))
        .get(),
    )
    if (existing) return

    const now = Date.now()
    Database.use((db) =>
      db.insert(LearningWikiPageTable).values({
        id: ulid(),
        workspace_id: workspace.id,
        page_type: "index",
        slug: "index",
        title: "Knowledge Index",
        file_path: "wiki/index.md",
        sections: [],
        resource_count: 0,
        word_count: 0,
        time_created: now,
        time_updated: now,
      }).run(),
    )
  }

  export function completeOnboarding(workspaceId: string, profile: OnboardingProfile): void {
    const workspace = getById(workspaceId)
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`)

    update(workspaceId, {
      learning_intent: profile.learning_intent,
      years_of_experience: profile.years_of_experience,
      goals: profile.goals,
      depth_prefs: profile.depth_prefs,
      trusted_sources: profile.trusted_sources,
      scout_platforms: profile.scout_platforms,
      kb_initialized: true,
      onboarded_at: Date.now(),
    })

    logEvent(workspaceId, {
      event_type: "onboarding",
      summary: `Onboarding completed. Intent: "${profile.learning_intent}". Categories: ${profile.categories.map((c) => c.name).join(", ")}.`,
      payload: { category_count: profile.categories.length },
    })
  }

  export function getCategories(workspaceId: string): Category[] {
    return Database.use((db) =>
      db.select().from(LearningCategoryTable).where(eq(LearningCategoryTable.workspace_id, workspaceId)).all(),
    )
  }

  export function getWikiPages(workspaceId: string): WikiPage[] {
    return Database.use((db) =>
      db.select().from(LearningWikiPageTable).where(eq(LearningWikiPageTable.workspace_id, workspaceId)).all(),
    )
  }

  export function getWikiPage(workspaceId: string, filePath: string): WikiPage | undefined {
    return Database.use((db) =>
      db
        .select()
        .from(LearningWikiPageTable)
        .where(
          and(eq(LearningWikiPageTable.workspace_id, workspaceId), eq(LearningWikiPageTable.file_path, filePath)),
        )
        .get(),
    )
  }

  export function getWikiPageById(id: string): WikiPage | undefined {
    return Database.use((db) =>
      db.select().from(LearningWikiPageTable).where(eq(LearningWikiPageTable.id, id)).get(),
    )
  }

  /** Resolve the folder-relative wiki path for a category (handles nesting). */
  export function getCategoryWikiPath(workspaceId: string, categoryId: string): string {
    const parts: string[] = []
    let catId: string | null = categoryId
    while (catId) {
      const cat = Database.use((db) =>
        db.select().from(LearningCategoryTable).where(eq(LearningCategoryTable.id, catId!)).get(),
      )
      if (!cat) break
      parts.unshift(cat.slug)
      catId = cat.parent_category_id ?? null
    }
    return path.join("wiki", ...parts)
  }

  /**
   * Create a new category folder + overview.md.
   * If parentCategoryId is set, creates as a nested subcategory.
   */
  export function createCategory(
    workspaceId: string,
    name: string,
    parentCategoryId?: string,
    description?: string,
    opts?: { depth?: "deep" | "working" | "awareness"; icon?: string; color?: string; position?: number },
  ): { category: Category; overviewPage: WikiPage } {
    const workspace = getById(workspaceId)
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`)

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    const now = Date.now()
    const categoryId = ulid()

    const existingCount = Database.use((db) =>
      db.select().from(LearningCategoryTable).where(eq(LearningCategoryTable.workspace_id, workspaceId)).all(),
    ).length

    Database.use((db) =>
      db.insert(LearningCategoryTable).values({
        id: categoryId,
        workspace_id: workspaceId,
        parent_category_id: parentCategoryId ?? null,
        slug,
        name,
        depth: opts?.depth ?? "working",
        color: opts?.color,
        icon: opts?.icon,
        position: opts?.position ?? existingCount,
        time_created: now,
        time_updated: now,
      }).run(),
    )

    const wikiRelPath = getCategoryWikiPath(workspaceId, categoryId)
    const absFolderPath = path.join(workspace.kb_path, wikiRelPath)
    mkdirSync(absFolderPath, { recursive: true })

    const overviewRelPath = path.join(wikiRelPath, "overview.md").replace(/\\/g, "/")
    const overviewAbsPath = path.join(workspace.kb_path, overviewRelPath)

    const parentCategory = parentCategoryId
      ? Database.use((db) => db.select().from(LearningCategoryTable).where(eq(LearningCategoryTable.id, parentCategoryId)).get())
      : undefined
    const overviewDesc = description || categoryOverviewDescription(name, parentCategory?.name)

    const overviewContent = [
      `# ${name}`,
      "",
      "> This file is maintained by Supadense. Do not edit directly.",
      "",
      overviewDesc,
      "",
      "## Sections",
      "",
      "_No sections yet — create one to get started._",
      "",
    ].join("\n")

    writeFileSync(overviewAbsPath, overviewContent, "utf8")

    const pageId = ulid()
    Database.use((db) =>
      db.insert(LearningWikiPageTable).values({
        id: pageId,
        workspace_id: workspaceId,
        category_id: categoryId,
        parent_page_id: parentCategoryId
          ? (Database.use((db2) =>
              db2.select().from(LearningWikiPageTable)
                .where(and(eq(LearningWikiPageTable.category_id, parentCategoryId), eq(LearningWikiPageTable.type, "overview")))
                .get()
            )?.id ?? null)
          : null,
        type: "overview",
        page_type: parentCategoryId ? "subcategory" : "category",
        category_slug: slug,
        slug: "overview",
        title: name,
        file_path: overviewRelPath,
        sections: [],
        resource_count: 0,
        word_count: 0,
        time_created: now,
        time_updated: now,
      }).run(),
    )

    const category = Database.use((db) =>
      db.select().from(LearningCategoryTable).where(eq(LearningCategoryTable.id, categoryId)).get(),
    )!
    const overviewPage = Database.use((db) =>
      db.select().from(LearningWikiPageTable).where(eq(LearningWikiPageTable.id, pageId)).get(),
    )!

    logEvent(workspaceId, {
      event_type: "category_added",
      summary: `Category "${name}" created.`,
      wiki_page_id: pageId,
      payload: { slug, parent_category_id: parentCategoryId ?? null },
    })

    ensureCategoryKeyConceptsPage(workspaceId, categoryId, slug, workspace)
    refreshOverview(workspaceId, categoryId)
    if (parentCategoryId) refreshOverview(workspaceId, parentCategoryId)

    return { category, overviewPage }
  }

  /** Create a new section .md file inside a category folder. */
  export function createSection(
    workspaceId: string,
    name: string,
    categoryId: string,
    description?: string,
  ): WikiPage {
    const workspace = getById(workspaceId)
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`)

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    const now = Date.now()

    const wikiRelDir = getCategoryWikiPath(workspaceId, categoryId)
    const fileRelPath = path.join(wikiRelDir, `${slug}.md`).replace(/\\/g, "/")
    const fileAbsPath = path.join(workspace.kb_path, fileRelPath)

    mkdirSync(path.join(workspace.kb_path, wikiRelDir), { recursive: true })

    const category = Database.use((db) =>
      db.select().from(LearningCategoryTable).where(eq(LearningCategoryTable.id, categoryId)).get(),
    )

    const secDesc = description || sectionDescription(name, category?.name ?? humanize(slug))

    const sectionContent = [
      `# ${name}`,
      "",
      "> This file is maintained by Supadense. Do not edit directly.",
      "",
      secDesc,
      "",
      "## Key Concepts",
      "",
      "_No content yet — add resources to fill this in._",
      "",
    ].join("\n")

    writeFileSync(fileAbsPath, sectionContent, "utf8")

    const overviewPage = Database.use((db) =>
      db.select().from(LearningWikiPageTable)
        .where(and(eq(LearningWikiPageTable.category_id, categoryId), eq(LearningWikiPageTable.type, "overview")))
        .get()
    )

    const pageId = ulid()
    Database.use((db) =>
      db.insert(LearningWikiPageTable).values({
        id: pageId,
        workspace_id: workspaceId,
        category_id: categoryId,
        parent_page_id: overviewPage?.id ?? null,
        type: "section",
        page_type: "subcategory",
        category_slug: category?.slug ?? slug,
        subcategory_slug: slug,
        slug,
        title: name,
        file_path: fileRelPath,
        sections: [],
        resource_count: 0,
        word_count: 0,
        time_created: now,
        time_updated: now,
      }).run(),
    )

    const page = Database.use((db) =>
      db.select().from(LearningWikiPageTable).where(eq(LearningWikiPageTable.id, pageId)).get(),
    )!

    refreshOverview(workspaceId, categoryId)

    logEvent(workspaceId, {
      event_type: "section_added",
      summary: `Section "${name}" created in category "${category?.name ?? categoryId}".`,
      wiki_page_id: pageId,
      payload: { slug, category_id: categoryId },
    })

    return page
  }

  /** Rewrite overview.md for a category to reflect current sections and subcategories. */
  export function refreshOverview(workspaceId: string, categoryId: string): void {
    const workspace = getById(workspaceId)
    if (!workspace) return

    const category = Database.use((db) =>
      db.select().from(LearningCategoryTable).where(eq(LearningCategoryTable.id, categoryId)).get(),
    )
    if (!category) return

    const overviewPage = Database.use((db) =>
      db.select().from(LearningWikiPageTable)
        .where(and(eq(LearningWikiPageTable.category_id, categoryId), eq(LearningWikiPageTable.type, "overview")))
        .get()
    )
    if (!overviewPage) return

    const sections = Database.use((db) =>
      db.select().from(LearningWikiPageTable)
        .where(and(eq(LearningWikiPageTable.category_id, categoryId), eq(LearningWikiPageTable.type, "section")))
        .all()
    )

    const subcategories = Database.use((db) =>
      db.select().from(LearningCategoryTable)
        .where(eq(LearningCategoryTable.parent_category_id, categoryId))
        .all()
    )

    const lines = [
      `# ${category.name}`,
      "",
      "> This file is maintained by Supadense. Do not edit directly.",
      "",
      "## Overview",
      "",
      category.description ?? "<!-- Supadense will fill this in as you add resources -->",
      "",
    ]

    if (subcategories.length > 0) {
      lines.push("## Subcategories", "")
      for (const sub of subcategories.sort((a, b) => a.name.localeCompare(b.name))) {
        const desc = sub.description ? ` — ${sub.description}` : ""
        lines.push(`- [**${sub.name}**](./${sub.slug}/overview.md)${desc}`)
      }
      lines.push("")
    }

    if (sections.length > 0) {
      lines.push("## Sections", "")
      for (const sec of sections.sort((a, b) => a.title.localeCompare(b.title))) {
        const fileName = path.basename(sec.file_path)
        lines.push(`- [**${sec.title}**](./${fileName})`)
      }
      lines.push("")
    }

    lines.push("---", "", `_Updated: ${new Date().toISOString().split("T")[0]}_`)

    const absPath = path.join(workspace.kb_path, overviewPage.file_path)
    try {
      writeFileSync(absPath, lines.join("\n"), "utf8")
    } catch { /* file may not exist yet during creation */ }
  }

  /** Return the nested tree of categories + their pages for the file panel. */
  export function getTree(workspaceId: string): object[] {
    const allCategories = getCategories(workspaceId)
    const allPages = getWikiPages(workspaceId)

    function buildNode(cat: Category): object {
      const overview = allPages.find((p) => p.category_id === cat.id && p.type === "overview")
      const sections = allPages.filter((p) => p.category_id === cat.id && p.type === "section")
      const subcategories = allCategories
        .filter((c) => c.parent_category_id === cat.id)
        .map(buildNode)

      return {
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
        depth: cat.depth,
        folder_path: getCategoryWikiPath(workspaceId, cat.id),
        overview: overview ? { id: overview.id, title: overview.title, file_path: overview.file_path, slug: overview.slug } : null,
        sections: sections.map((s) => ({ id: s.id, title: s.title, slug: s.slug, file_path: s.file_path })),
        subcategories,
      }
    }

    return allCategories
      .filter((c) => !c.parent_category_id)
      .sort((a, b) => a.position - b.position)
      .map(buildNode)
  }

  /** Find a category by walking slugs parsed from a wiki-relative folder path.
   *  e.g. "wiki/agents" → root cat with slug "agents"
   *       "wiki/agents/llm" → child cat slug "llm" under "agents"
   */
  export function getCategoryByFolderPath(workspaceId: string, relFolderPath: string): Category | undefined {
    const normalized = relFolderPath.replace(/\\/g, "/").replace(/\/$/, "")
    const parts = normalized.split("/").filter(Boolean)
    if (parts[0] !== "wiki" || parts.length < 2) return undefined
    const slugs = parts.slice(1)

    const allCats = getCategories(workspaceId)
    let parentId: string | null = null
    let found: Category | undefined

    for (const slug of slugs) {
      found = allCats.find(
        (c) => c.slug === slug && (c.parent_category_id ?? null) === parentId,
      )
      if (!found) return undefined
      parentId = found.id
    }
    return found
  }

  export function syncFolderAdded(workspaceId: string, relFolderPath: string): void {
    const normalized = relFolderPath.replace(/\\/g, "/").replace(/\/$/, "")
    const parts = normalized.split("/").filter(Boolean)
    if (parts[0] !== "wiki" || parts.length < 2) return

    const slugs = parts.slice(1)
    const slug = slugs[slugs.length - 1]!
    const parentSlugPath = slugs.length > 1 ? ["wiki", ...slugs.slice(0, -1)].join("/") : null
    const parentId = parentSlugPath ? getCategoryByFolderPath(workspaceId, parentSlugPath)?.id : undefined

    const allCats = getCategories(workspaceId)
    const existing = allCats.find(
      (c) => c.slug === slug && (c.parent_category_id ?? null) === (parentId ?? null),
    )
    if (existing) {
      if (parentId) refreshOverview(workspaceId, parentId)
      // Scaffold key-concepts.md if missing (handles categories created before this feature)
      const ws = getById(workspaceId)
      if (ws) {
        ensureCategoryKeyConceptsPage(workspaceId, existing.id, slug, ws)
        refreshOverview(workspaceId, existing.id)
      }
      return
    }

    const name = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    const now = Date.now()
    const categoryId = ulid()

    Database.use((db) =>
      db.insert(LearningCategoryTable).values({
        id: categoryId,
        workspace_id: workspaceId,
        parent_category_id: parentId ?? null,
        slug,
        name,
        depth: "working",
        position: allCats.length,
        time_created: now,
        time_updated: now,
      }).run(),
    )

    // Create overview.md and wiki page record if not already on disk
    const workspace = getById(workspaceId)
    if (workspace) {
      const wikiRelPath = getCategoryWikiPath(workspaceId, categoryId)
      const overviewRelPath = path.join(wikiRelPath, "overview.md").replace(/\\/g, "/")
      const overviewAbsPath = path.join(workspace.kb_path, overviewRelPath)
      if (!existsSync(overviewAbsPath)) {
        const parentCat = parentId
          ? Database.use((db) => db.select().from(LearningCategoryTable).where(eq(LearningCategoryTable.id, parentId)).get())
          : undefined
        const desc = categoryOverviewDescription(name, parentCat?.name)
        const overviewContent = [`# ${name}`, "", "> This file is maintained by Supadense. Do not edit directly.", "", desc, "", "## Sections", "", "_No sections yet — create one to get started._", ""].join("\n")
        writeFileSync(overviewAbsPath, overviewContent, "utf8")
      }
      const existingPage = Database.use((db) =>
        db.select().from(LearningWikiPageTable)
          .where(and(eq(LearningWikiPageTable.category_id, categoryId), eq(LearningWikiPageTable.type, "overview")))
          .get(),
      )
      const overviewPageId = ulid()
      if (!existingPage) {
        Database.use((db) =>
          db.insert(LearningWikiPageTable).values({
            id: overviewPageId,
            workspace_id: workspaceId,
            category_id: categoryId,
            parent_page_id: parentId
              ? (Database.use((db2) =>
                  db2.select().from(LearningWikiPageTable)
                    .where(and(eq(LearningWikiPageTable.category_id, parentId), eq(LearningWikiPageTable.type, "overview")))
                    .get()
                )?.id ?? null)
              : null,
            type: "overview",
            page_type: parentId ? "subcategory" : "category",
            category_slug: slug,
            slug: "overview",
            title: name,
            file_path: overviewRelPath,
            sections: DEFAULT_SECTIONS,
            resource_count: 0,
            word_count: 0,
            time_created: now,
            time_updated: now,
          }).run(),
        )
      }

      ensureCategoryKeyConceptsPage(workspaceId, categoryId, slug, workspace)
      // Refresh this category's own overview now that key-concepts page exists
      refreshOverview(workspaceId, categoryId)
    }

    // Refresh parent overview to include this new category
    if (parentId) refreshOverview(workspaceId, parentId)
  }

  function ensureCategoryKeyConceptsPage(workspaceId: string, categoryId: string, slug: string, workspace: Workspace): void {
    const wikiRelPath = getCategoryWikiPath(workspaceId, categoryId)
    const kcRelPath = path.join(wikiRelPath, "key-concepts.md").replace(/\\/g, "/")
    const kcAbsPath = path.join(workspace.kb_path, kcRelPath)
    const name = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    const now = Date.now()

    if (!existsSync(kcAbsPath)) {
      const kcContent = [`# Key Concepts`, "", "> This file is maintained by Supadense. Do not edit directly.", "", `Core concepts for ${name}.`, "", "## Key Concepts", "", "_No content yet — add resources to fill this in._", ""].join("\n")
      writeFileSync(kcAbsPath, kcContent, "utf8")
    }

    const existingKcPage = Database.use((db) =>
      db.select().from(LearningWikiPageTable)
        .where(and(eq(LearningWikiPageTable.category_id, categoryId), eq(LearningWikiPageTable.subcategory_slug, "key-concepts")))
        .get(),
    )
    if (!existingKcPage) {
      const overviewPage = Database.use((db) =>
        db.select().from(LearningWikiPageTable)
          .where(and(eq(LearningWikiPageTable.category_id, categoryId), eq(LearningWikiPageTable.type, "overview")))
          .get(),
      )
      const cat = Database.use((db) =>
        db.select().from(LearningCategoryTable).where(eq(LearningCategoryTable.id, categoryId)).get(),
      )
      Database.use((db) =>
        db.insert(LearningWikiPageTable).values({
          id: ulid(),
          workspace_id: workspaceId,
          category_id: categoryId,
          parent_page_id: overviewPage?.id ?? null,
          type: "section",
          page_type: cat?.parent_category_id ? "subcategory" : "category",
          category_slug: slug,
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
    }
  }

  export function syncFolderRemoved(workspaceId: string, relFolderPath: string): void {
    const cat = getCategoryByFolderPath(workspaceId, relFolderPath)
    if (!cat) return
    const parentId = cat.parent_category_id
    Database.use((db) => {
      db.delete(LearningWikiPageTable).where(eq(LearningWikiPageTable.category_id, cat.id)).run()
      db.delete(LearningCategoryTable).where(eq(LearningCategoryTable.id, cat.id)).run()
    })
    if (parentId) refreshOverview(workspaceId, parentId)
  }

  export function syncFileAdded(workspaceId: string, relFilePath: string): void {
    const normalized = relFilePath.replace(/\\/g, "/")
    const parts = normalized.split("/").filter(Boolean)
    if (parts[0] !== "wiki" || parts.length < 3) return

    const fileName = parts[parts.length - 1]!
    if (!fileName.endsWith(".md") || fileName === "overview.md") return

    const slug = fileName.replace(/\.md$/, "")
    const folderParts = parts.slice(0, -1)
    const folderPath = folderParts.join("/")
    const cat = getCategoryByFolderPath(workspaceId, folderPath)
    if (!cat) return

    const allPages = getWikiPages(workspaceId)
    const existing = allPages.find((p) => p.file_path === normalized)
    if (existing) return

    const title = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    const now = Date.now()

    // Write initial description if file is empty or just created
    const workspace = getById(workspaceId)
    if (workspace) {
      const absPath = path.join(workspace.kb_path, normalized)
      try {
        const size = statSync(absPath).size
        if (size === 0) {
          const desc = sectionDescription(title, cat.name)
          const content = [`# ${title}`, "", "> This file is maintained by Supadense. Do not edit directly.", "", desc, "", "## Key Concepts", "", "_No content yet — add resources to fill this in._", ""].join("\n")
          writeFileSync(absPath, content, "utf8")
        }
      } catch { /* file may not be readable yet */ }
    }

    const overviewPage = Database.use((db) =>
      db.select().from(LearningWikiPageTable)
        .where(and(eq(LearningWikiPageTable.category_id, cat.id), eq(LearningWikiPageTable.type, "overview")))
        .get(),
    )

    Database.use((db) =>
      db.insert(LearningWikiPageTable).values({
        id: ulid(),
        workspace_id: workspaceId,
        category_id: cat.id,
        parent_page_id: overviewPage?.id ?? null,
        slug,
        title,
        file_path: normalized,
        page_type: "subcategory",
        type: "section",
        category_slug: cat.slug,
        subcategory_slug: slug,
        resource_count: 0,
        sections: DEFAULT_SECTIONS,
        time_created: now,
        time_updated: now,
      }).run(),
    )

    refreshOverview(workspaceId, cat.id)
  }

  export function syncFileRemoved(workspaceId: string, relFilePath: string): void {
    const normalized = relFilePath.replace(/\\/g, "/")
    const page = Database.use((db) =>
      db.select().from(LearningWikiPageTable)
        .where(and(
          eq(LearningWikiPageTable.workspace_id, workspaceId),
          eq(LearningWikiPageTable.file_path, normalized),
        )).get(),
    )
    if (page) {
      Database.use((db) =>
        db.delete(LearningWikiPageTable).where(eq(LearningWikiPageTable.id, page.id)).run(),
      )
      if (page.category_id) refreshOverview(workspaceId, page.category_id)
    }
  }

  export function logEvent(
    workspaceId: string,
    event: {
      event_type: string
      summary: string
      payload?: Record<string, unknown>
      resource_id?: string
      wiki_page_id?: string
    },
  ): void {
    const now = Date.now()
    Database.use((db) =>
      db.insert(LearningKbEventTable).values({
        id: ulid(),
        workspace_id: workspaceId,
        event_type: event.event_type,
        summary: event.summary,
        payload: event.payload ?? {},
        resource_id: event.resource_id,
        wiki_page_id: event.wiki_page_id,
        time_created: now,
        time_updated: now,
      }).run(),
    )
  }

  /** Recursively collect all descendant category IDs (depth-first). */
  function collectDescendantIds(workspaceId: string, categoryId: string): string[] {
    const allCats = getCategories(workspaceId)
    const ids: string[] = []
    const stack = [categoryId]
    while (stack.length > 0) {
      const current = stack.pop()!
      ids.push(current)
      const children = allCats.filter((c) => c.parent_category_id === current)
      for (const child of children) stack.push(child.id)
    }
    return ids
  }

  const PROTECTED_SLUGS = new Set(["assets", "raw"])

  export function deleteCategory(workspaceId: string, categoryId: string): void {
    const workspace = getById(workspaceId)
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`)

    // Capture parent before deleting
    const cat = Database.use((db) =>
      db.select().from(LearningCategoryTable).where(eq(LearningCategoryTable.id, categoryId)).get(),
    )

    if (cat && PROTECTED_SLUGS.has(cat.slug)) throw new Error(`Cannot delete protected folder: ${cat.slug}`)
    const parentId = cat?.parent_category_id ?? null

    // Compute path BEFORE any DB changes
    const absPath = path.join(workspace.kb_path, getCategoryWikiPath(workspaceId, categoryId))

    // Collect all descendant IDs (including the category itself)
    const allIds = collectDescendantIds(workspaceId, categoryId)

    // Delete in reverse order (children first, then parent)
    const ordered = [...allIds].reverse()
    for (const id of ordered) {
      Database.use((db) => {
        db.delete(LearningWikiPageTable).where(eq(LearningWikiPageTable.category_id, id)).run()
        db.delete(LearningCategoryTable).where(eq(LearningCategoryTable.id, id)).run()
      })
    }

    // Delete folder on disk
    rmSync(absPath, { recursive: true, force: true })

    // Refresh parent overview to remove this category from the list
    if (parentId) refreshOverview(workspaceId, parentId)
  }

  export function renameCategory(workspaceId: string, categoryId: string, newName: string): void {
    const workspace = getById(workspaceId)
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`)

    const catCheck = Database.use((db) =>
      db.select().from(LearningCategoryTable).where(eq(LearningCategoryTable.id, categoryId)).get(),
    )
    if (catCheck && PROTECTED_SLUGS.has(catCheck.slug)) throw new Error(`Cannot rename protected folder: ${catCheck.slug}`)

    // Compute old paths BEFORE updating slug
    const oldRelPath = getCategoryWikiPath(workspaceId, categoryId)
    const oldAbsPath = path.join(workspace.kb_path, oldRelPath)

    const newSlug = newName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

    // Compute new abs path: replace last segment with newSlug
    const parentDir = path.dirname(oldAbsPath)
    const newAbsPath = path.join(parentDir, newSlug)
    const newRelPath = path.join(path.dirname(oldRelPath), newSlug).replace(/\\/g, "/")

    // Update the DB row
    Database.use((db) =>
      db.update(LearningCategoryTable)
        .set({ name: newName, slug: newSlug, time_updated: Date.now() })
        .where(eq(LearningCategoryTable.id, categoryId))
        .run(),
    )

    // Rename folder on disk
    renameSync(oldAbsPath, newAbsPath)

    // Update file_path for all wiki pages under this category (prefix replace)
    const pages = Database.use((db) =>
      db.select().from(LearningWikiPageTable)
        .where(eq(LearningWikiPageTable.workspace_id, workspaceId))
        .all(),
    )
    const oldPrefix = oldRelPath.replace(/\\/g, "/") + "/"
    const newPrefix = newRelPath + "/"
    for (const page of pages) {
      if (page.file_path.startsWith(oldPrefix)) {
        const newFilePath = newPrefix + page.file_path.slice(oldPrefix.length)
        Database.use((db) =>
          db.update(LearningWikiPageTable)
            .set({ file_path: newFilePath, time_updated: Date.now() })
            .where(eq(LearningWikiPageTable.id, page.id))
            .run(),
        )
      }
    }

    // Refresh own overview (title changed) + parent overview (link text changed)
    refreshOverview(workspaceId, categoryId)
    const renamedCat = Database.use((db) =>
      db.select().from(LearningCategoryTable).where(eq(LearningCategoryTable.id, categoryId)).get(),
    )
    if (renamedCat?.parent_category_id) refreshOverview(workspaceId, renamedCat.parent_category_id)
  }

  const PROTECTED_FILES = new Set(["log.md", "supadense.md", "index.md"])

  export function deleteSection(workspaceId: string, pageId: string): void {
    const workspace = getById(workspaceId)
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`)

    const page = getWikiPageById(pageId)
    if (!page) throw new Error(`Wiki page ${pageId} not found`)

    const basename = path.basename(page.file_path)
    if (PROTECTED_FILES.has(basename)) throw new Error(`Cannot delete protected file: ${basename}`)

    const categoryId = page.category_id

    // Delete file on disk
    const absPath = path.join(workspace.kb_path, page.file_path)
    rmSync(absPath, { force: true })

    // Delete from DB
    Database.use((db) =>
      db.delete(LearningWikiPageTable).where(eq(LearningWikiPageTable.id, pageId)).run(),
    )

    // Refresh parent overview to remove this section
    if (categoryId) refreshOverview(workspaceId, categoryId)
  }

  export function renameSection(workspaceId: string, pageId: string, newName: string): void {
    const workspace = getById(workspaceId)
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`)

    const page = getWikiPageById(pageId)
    if (!page) throw new Error(`Wiki page ${pageId} not found`)

    const basename = path.basename(page.file_path)
    if (PROTECTED_FILES.has(basename)) throw new Error(`Cannot rename protected file: ${basename}`)

    const newSlug = newName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    const dir = path.dirname(page.file_path).replace(/\\/g, "/")
    const newFilePath = `${dir}/${newSlug}.md`

    // Rename file on disk
    const oldAbsPath = path.join(workspace.kb_path, page.file_path)
    const newAbsPath = path.join(workspace.kb_path, newFilePath)
    renameSync(oldAbsPath, newAbsPath)

    // Update DB
    Database.use((db) =>
      db.update(LearningWikiPageTable)
        .set({ slug: newSlug, subcategory_slug: newSlug, title: newName, file_path: newFilePath, time_updated: Date.now() })
        .where(eq(LearningWikiPageTable.id, pageId))
        .run(),
    )

    // Refresh category overview so link text + filename reflect new name
    if (page.category_id) refreshOverview(workspaceId, page.category_id)
  }
}
