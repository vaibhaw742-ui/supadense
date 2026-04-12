/**
 * workspace.ts — Learning KB workspace operations
 */
import path from "path"
import { mkdirSync, writeFileSync, existsSync } from "fs"
import { ulid } from "ulid"
import { eq, and } from "drizzle-orm"
import { Database } from "../storage/db"
import {
  LearningKbWorkspaceTable,
  LearningCategoryTable,
  LearningWikiPageTable,
  LearningKbEventTable,
  LearningSchemaTemplateTable,
  LearningSchemaSubcategoryTable,
} from "./schema.sql"

export type Workspace = typeof LearningKbWorkspaceTable.$inferSelect
export type Category = typeof LearningCategoryTable.$inferSelect
export type WikiPage = typeof LearningWikiPageTable.$inferSelect

export interface OnboardingProfile {
  learning_intent: string
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
  template_slug?: string
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

  export function ensure(projectId: string, kbPath: string): Workspace {
    const existing = get(projectId)
    if (existing) return existing

    const now = Date.now()
    const id = ulid()
    Database.use((db) =>
      db.insert(LearningKbWorkspaceTable).values({
        id,
        project_id: projectId,
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
    return get(projectId)!
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
    const assetsDir = path.join(wikiDir, "assets")

    mkdirSync(wikiDir, { recursive: true })
    mkdirSync(assetsDir, { recursive: true })

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

  export function completeOnboarding(workspaceId: string, profile: OnboardingProfile): Category[] {
    const workspace = getById(workspaceId)
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`)

    let templateId: string | undefined
    if (profile.template_slug) {
      const tpl = Database.use((db) =>
        db
          .select()
          .from(LearningSchemaTemplateTable)
          .where(eq(LearningSchemaTemplateTable.slug, profile.template_slug!))
          .get(),
      )
      templateId = tpl?.id
    }

    update(workspaceId, {
      template_id: templateId,
      learning_intent: profile.learning_intent,
      goals: profile.goals,
      depth_prefs: profile.depth_prefs,
      trusted_sources: profile.trusted_sources,
      scout_platforms: profile.scout_platforms,
      kb_initialized: true,
      onboarded_at: Date.now(),
    })

    const categories: Category[] = []
    const now = Date.now()

    for (let i = 0; i < profile.categories.length; i++) {
      const cat = profile.categories[i]

      const categoryId = ulid()
      Database.use((db) =>
        db.insert(LearningCategoryTable).values({
          id: categoryId,
          workspace_id: workspaceId,
          slug: cat.slug,
          name: cat.name,
          description: cat.description,
          depth: cat.depth ?? "working",
          color: cat.color,
          icon: cat.icon,
          position: i,
          time_created: now,
          time_updated: now,
        }).run(),
      )

      const catPageId = ulid()
      Database.use((db) =>
        db.insert(LearningWikiPageTable).values({
          id: catPageId,
          workspace_id: workspaceId,
          category_id: categoryId,
          page_type: "category",
          category_slug: cat.slug,
          slug: cat.slug,
          title: cat.name,
          description: cat.description,
          file_path: `wiki/${cat.slug}.md`,
          sections: [],
          resource_count: 0,
          word_count: 0,
          time_created: now,
          time_updated: now,
        }).run(),
      )

      if (templateId) {
        const subcats = Database.use((db) =>
          db
            .select()
            .from(LearningSchemaSubcategoryTable)
            .where(eq(LearningSchemaSubcategoryTable.template_id, templateId!))
            .all(),
        )

        for (const sub of subcats) {
          Database.use((db) =>
            db.insert(LearningWikiPageTable).values({
              id: ulid(),
              workspace_id: workspaceId,
              category_id: categoryId,
              parent_page_id: catPageId,
              page_type: "subcategory",
              category_slug: cat.slug,
              subcategory_slug: sub.slug,
              slug: sub.slug,
              title: `${cat.name} — ${sub.name}`,
              file_path: `wiki/${cat.slug}--${sub.slug}.md`,
              sections: [],
              resource_count: 0,
              word_count: 0,
              time_created: now,
              time_updated: now,
            }).run(),
          )
        }
      }

      categories.push(
        Database.use((db) =>
          db.select().from(LearningCategoryTable).where(eq(LearningCategoryTable.id, categoryId)).get(),
        )!,
      )
    }

    logEvent(workspaceId, {
      event_type: "onboarding",
      summary: `Onboarding completed. Intent: "${profile.learning_intent}". Categories: ${profile.categories.map((c) => c.name).join(", ")}.`,
      payload: { template_slug: profile.template_slug, category_count: profile.categories.length },
    })

    return categories
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
}
