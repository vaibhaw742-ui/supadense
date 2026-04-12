/**
 * resource.ts — Learning KB resource + placement operations
 */
import { ulid } from "ulid"
import { eq, and, desc } from "drizzle-orm"
import { Database } from "../storage/db"
import {
  LearningResourceTable,
  LearningResourceWikiPlacementTable,
  LearningConceptTable,
  LearningConceptWikiPlacementTable,
  LearningWikiPageTable,
} from "./schema.sql"

export type Resource = typeof LearningResourceTable.$inferSelect
export type Placement = typeof LearningResourceWikiPlacementTable.$inferSelect
export type Concept = typeof LearningConceptTable.$inferSelect

export type Modality = "url" | "pdf" | "youtube" | "text" | "image" | "linkedin"
export type ResourceStatus = "pending" | "processing" | "done" | "failed"

export interface PlacementInput {
  resource_id: string
  wiki_page_id: string
  section_slug: string
  section_heading: string
  extracted_content: string
  media_asset_ids?: string[]
  placement_position?: number
  confidence?: number
}

// ─── Resource ─────────────────────────────────────────────────────────────────

export namespace Resource {
  export function create(input: {
    workspace_id: string
    modality: Modality
    url?: string
    title?: string
    author?: string
    raw_content?: string
    metadata?: Record<string, unknown>
    published_at?: number
  }): Resource {
    const now = Date.now()
    const id = ulid()
    Database.use((db) =>
      db.insert(LearningResourceTable).values({
        id,
        workspace_id: input.workspace_id,
        modality: input.modality,
        url: input.url,
        title: input.title,
        author: input.author,
        raw_content: input.raw_content,
        status: "pending",
        quality_score: 0,
        relevance_score: 0,
        metadata: input.metadata ?? {},
        published_at: input.published_at,
        memorized_at: now,
        time_created: now,
        time_updated: now,
      }).run(),
    )
    return get(id)!
  }

  export function get(id: string): Resource | undefined {
    return Database.use((db) =>
      db.select().from(LearningResourceTable).where(eq(LearningResourceTable.id, id)).get(),
    )
  }

  export function update(
    id: string,
    data: Partial<Pick<Resource, "title" | "author" | "summary" | "raw_content" | "quality_score" | "relevance_score" | "status" | "processing_step" | "error" | "metadata">>,
  ): void {
    Database.use((db) =>
      db.update(LearningResourceTable).set({ ...data, time_updated: Date.now() }).where(eq(LearningResourceTable.id, id)).run(),
    )
  }

  export function setStatus(id: string, status: ResourceStatus, step?: string, error?: string): void {
    Database.use((db) =>
      db
        .update(LearningResourceTable)
        .set({ status, processing_step: step, error: status === "failed" ? error : undefined, time_updated: Date.now() })
        .where(eq(LearningResourceTable.id, id))
        .run(),
    )
  }

  export function getByWorkspace(workspaceId: string, limit = 20): Resource[] {
    return Database.use((db) =>
      db
        .select()
        .from(LearningResourceTable)
        .where(eq(LearningResourceTable.workspace_id, workspaceId))
        .orderBy(desc(LearningResourceTable.memorized_at))
        .limit(limit)
        .all(),
    )
  }
}

// ─── Placement ────────────────────────────────────────────────────────────────

export namespace Placement {
  export function create(input: PlacementInput): Placement {
    const now = Date.now()
    const id = ulid()
    Database.use((db) =>
      db.insert(LearningResourceWikiPlacementTable).values({
        id,
        resource_id: input.resource_id,
        wiki_page_id: input.wiki_page_id,
        section_slug: input.section_slug,
        section_heading: input.section_heading,
        extracted_content: input.extracted_content,
        media_asset_ids: input.media_asset_ids ?? [],
        placement_position: input.placement_position ?? 0,
        confidence: input.confidence ?? 1.0,
        placed_at: now,
        time_created: now,
        time_updated: now,
      }).run(),
    )

    // Increment resource_count on the wiki page
    Database.use((db) => {
      const page = db.select().from(LearningWikiPageTable).where(eq(LearningWikiPageTable.id, input.wiki_page_id)).get()
      if (page) {
        db.update(LearningWikiPageTable)
          .set({ resource_count: page.resource_count + 1, time_updated: now })
          .where(eq(LearningWikiPageTable.id, input.wiki_page_id))
          .run()
      }
    })

    return get(id)!
  }

  export function get(id: string): Placement | undefined {
    return Database.use((db) =>
      db.select().from(LearningResourceWikiPlacementTable).where(eq(LearningResourceWikiPlacementTable.id, id)).get(),
    )
  }

  export function byPage(wikiPageId: string): Placement[] {
    return Database.use((db) =>
      db
        .select()
        .from(LearningResourceWikiPlacementTable)
        .where(eq(LearningResourceWikiPlacementTable.wiki_page_id, wikiPageId))
        .orderBy(LearningResourceWikiPlacementTable.section_slug, LearningResourceWikiPlacementTable.placement_position)
        .all(),
    )
  }

  export function byResource(resourceId: string): Placement[] {
    return Database.use((db) =>
      db
        .select()
        .from(LearningResourceWikiPlacementTable)
        .where(eq(LearningResourceWikiPlacementTable.resource_id, resourceId))
        .all(),
    )
  }

  export function exists(resourceId: string, wikiPageId: string, sectionSlug: string): boolean {
    const row = Database.use((db) =>
      db
        .select()
        .from(LearningResourceWikiPlacementTable)
        .where(
          and(
            eq(LearningResourceWikiPlacementTable.resource_id, resourceId),
            eq(LearningResourceWikiPlacementTable.wiki_page_id, wikiPageId),
            eq(LearningResourceWikiPlacementTable.section_slug, sectionSlug),
          ),
        )
        .get(),
    )
    return !!row
  }
}

// ─── Concepts ─────────────────────────────────────────────────────────────────

export namespace ConceptStore {
  export function upsert(input: {
    workspace_id: string
    category_id?: string
    name: string
    slug: string
    definition?: string
    explanation?: string
    aliases?: string[]
    related_slugs?: string[]
  }): Concept {
    const existing = Database.use((db) =>
      db
        .select()
        .from(LearningConceptTable)
        .where(and(eq(LearningConceptTable.workspace_id, input.workspace_id), eq(LearningConceptTable.slug, input.slug)))
        .get(),
    )

    const now = Date.now()
    if (existing) {
      Database.use((db) =>
        db
          .update(LearningConceptTable)
          .set({
            definition: input.definition ?? existing.definition,
            explanation: input.explanation ?? existing.explanation,
            aliases: [...new Set([...existing.aliases, ...(input.aliases ?? [])])],
            related_slugs: [...new Set([...existing.related_slugs, ...(input.related_slugs ?? [])])],
            time_updated: now,
          })
          .where(eq(LearningConceptTable.id, existing.id))
          .run(),
      )
      return Database.use((db) =>
        db.select().from(LearningConceptTable).where(eq(LearningConceptTable.id, existing.id)).get(),
      )!
    }

    const id = ulid()
    Database.use((db) =>
      db.insert(LearningConceptTable).values({
        id,
        workspace_id: input.workspace_id,
        category_id: input.category_id,
        name: input.name,
        slug: input.slug,
        definition: input.definition,
        explanation: input.explanation,
        aliases: input.aliases ?? [],
        related_slugs: input.related_slugs ?? [],
        first_seen_at: now,
        time_created: now,
        time_updated: now,
      }).run(),
    )
    return Database.use((db) =>
      db.select().from(LearningConceptTable).where(eq(LearningConceptTable.id, id)).get(),
    )!
  }

  export function linkToPage(conceptId: string, wikiPageId: string, sectionSlug?: string, introducedByResourceId?: string): void {
    const existing = Database.use((db) =>
      db
        .select()
        .from(LearningConceptWikiPlacementTable)
        .where(
          and(
            eq(LearningConceptWikiPlacementTable.concept_id, conceptId),
            eq(LearningConceptWikiPlacementTable.wiki_page_id, wikiPageId),
          ),
        )
        .get(),
    )
    if (existing) return

    const now = Date.now()
    Database.use((db) =>
      db.insert(LearningConceptWikiPlacementTable).values({
        concept_id: conceptId,
        wiki_page_id: wikiPageId,
        section_slug: sectionSlug,
        introduced_by_resource_id: introducedByResourceId,
        time_created: now,
        time_updated: now,
      }).run(),
    )
  }

  export function byWorkspace(workspaceId: string): Concept[] {
    return Database.use((db) =>
      db.select().from(LearningConceptTable).where(eq(LearningConceptTable.workspace_id, workspaceId)).all(),
    )
  }
}
