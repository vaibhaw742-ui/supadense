/**
 * retrieval.ts — Query the knowledge base for relevant locations
 *
 * Returns exact file_path + section_heading so the agent can call
 * ReadTool with an offset/limit rather than reading full files.
 *
 * Search order:
 *   1. Concept match (slug / name / alias)
 *   2. Placement content substring match
 *   3. Wiki page title / description match
 *   4. Category name match
 */
import { eq, and, like, or } from "drizzle-orm"
import { Database } from "../storage/db"
import {
  LearningWikiPageTable,
  LearningCategoryTable,
  LearningConceptTable,
  LearningConceptWikiPlacementTable,
  LearningResourceWikiPlacementTable,
  LearningResourceTable,
  LearningKbWorkspaceTable,
} from "./schema.sql"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RetrievalResult {
  /** Relative path from kb_path: "wiki/agents--key-concepts.md" */
  file_path: string
  /** Full abs path for ReadTool */
  abs_path: string
  /** Exact markdown heading: "## Key Concepts" */
  section_heading: string | null
  /** Clean one-line description of what's there */
  summary: string
  /** How this result was found */
  match_type: "concept" | "content" | "page" | "category"
  /** 0.0–1.0 relevance hint */
  relevance: number
}

export interface ConceptResult {
  name: string
  slug: string
  definition: string | null
  explanation: string | null
  aliases: string[]
  related_slugs: string[]
}

export interface SourceResult {
  title: string | null
  url: string | null
  author: string | null
  modality: string
  memorized_at: number
}

// ─── Retrieval ────────────────────────────────────────────────────────────────

export namespace Retrieval {
  /**
   * Main entry: find the best locations in the wiki for a query string.
   * Returns up to `limit` results sorted by relevance.
   */
  export function search(workspaceId: string, query: string, limit = 5): RetrievalResult[] {
    const workspace = Database.use((db) =>
      db.select().from(LearningKbWorkspaceTable).where(eq(LearningKbWorkspaceTable.id, workspaceId)).get(),
    )
    if (!workspace) return []

    const kbPath = workspace.kb_path
    const results: RetrievalResult[] = []
    const seen = new Set<string>() // deduplicate by file_path + section_slug

    const q = query.toLowerCase().trim()
    const words = q.split(/\s+/).filter(Boolean)

    // ── 1. Concept match ──────────────────────────────────────────────────────
    const concepts = Database.use((db) =>
      db
        .select()
        .from(LearningConceptTable)
        .where(eq(LearningConceptTable.workspace_id, workspaceId))
        .all(),
    )
    for (const concept of concepts) {
      const nameMatch = concept.name.toLowerCase().includes(q)
      const slugMatch = concept.slug.includes(q.replace(/\s+/g, "-"))
      const aliasMatch = concept.aliases.some((a) => a.toLowerCase().includes(q))
      if (!nameMatch && !slugMatch && !aliasMatch) continue

      // Find wiki pages that have this concept
      const links = Database.use((db) =>
        db
          .select()
          .from(LearningConceptWikiPlacementTable)
          .where(eq(LearningConceptWikiPlacementTable.concept_id, concept.id))
          .all(),
      )
      for (const link of links) {
        const page = Database.use((db) =>
          db
            .select()
            .from(LearningWikiPageTable)
            .where(eq(LearningWikiPageTable.id, link.wiki_page_id))
            .get(),
        )
        if (!page) continue
        const key = `${page.file_path}:${link.section_slug ?? "_"}`
        if (seen.has(key)) continue
        seen.add(key)

        results.push({
          file_path: page.file_path,
          abs_path: `${kbPath}/${page.file_path}`,
          section_heading: link.section_slug ? `## ${toTitle(link.section_slug)}` : null,
          summary: `Concept "${concept.name}"${concept.definition ? `: ${concept.definition}` : ""} — found in ${page.title}`,
          match_type: "concept",
          relevance: nameMatch ? 1.0 : slugMatch ? 0.9 : 0.7,
        })
      }
    }

    // ── 2. Placement content match ────────────────────────────────────────────
    const placements = Database.use((db) =>
      db
        .select()
        .from(LearningResourceWikiPlacementTable)
        .all()
        // We fetch all and filter in JS since SQLite LIKE is case-insensitive by default
        .filter((p) => {
          // Get page workspace
          const page = Database.use((db2) =>
            db2
              .select()
              .from(LearningWikiPageTable)
              .where(eq(LearningWikiPageTable.id, p.wiki_page_id))
              .get(),
          )
          return page?.workspace_id === workspaceId
        }),
    )

    for (const placement of placements) {
      const content = placement.extracted_content.toLowerCase()
      const matchedWords = words.filter((w) => content.includes(w))
      if (matchedWords.length === 0) continue

      const page = Database.use((db) =>
        db.select().from(LearningWikiPageTable).where(eq(LearningWikiPageTable.id, placement.wiki_page_id)).get(),
      )
      if (!page) continue

      const key = `${page.file_path}:${placement.section_slug}`
      if (seen.has(key)) continue
      seen.add(key)

      const snippet = placement.extracted_content.slice(0, 100).trim()
      results.push({
        file_path: page.file_path,
        abs_path: `${kbPath}/${page.file_path}`,
        section_heading: placement.section_heading,
        summary: `Content match in "${page.title}" / ${placement.section_heading}: "${snippet}…"`,
        match_type: "content",
        relevance: matchedWords.length / words.length,
      })
    }

    // ── 3. Wiki page title / description match ────────────────────────────────
    const pages = Database.use((db) =>
      db
        .select()
        .from(LearningWikiPageTable)
        .where(eq(LearningWikiPageTable.workspace_id, workspaceId))
        .all(),
    )
    for (const page of pages) {
      const titleMatch = page.title.toLowerCase().includes(q)
      const descMatch = page.description?.toLowerCase().includes(q) ?? false
      if (!titleMatch && !descMatch) continue

      const key = `${page.file_path}:_`
      if (seen.has(key)) continue
      seen.add(key)

      results.push({
        file_path: page.file_path,
        abs_path: `${kbPath}/${page.file_path}`,
        section_heading: null,
        summary: `Page match: "${page.title}"${page.description ? ` — ${page.description.slice(0, 80)}` : ""}`,
        match_type: "page",
        relevance: titleMatch ? 0.8 : 0.5,
      })
    }

    // ── 4. Category name match ────────────────────────────────────────────────
    const categories = Database.use((db) =>
      db
        .select()
        .from(LearningCategoryTable)
        .where(eq(LearningCategoryTable.workspace_id, workspaceId))
        .all(),
    )
    for (const cat of categories) {
      if (!cat.name.toLowerCase().includes(q) && !cat.slug.includes(q.replace(/\s+/g, "-"))) continue

      const key = `wiki/${cat.slug}.md:_`
      if (seen.has(key)) continue
      seen.add(key)

      results.push({
        file_path: `wiki/${cat.slug}.md`,
        abs_path: `${kbPath}/wiki/${cat.slug}.md`,
        section_heading: null,
        summary: `Category: "${cat.name}"${cat.description ? ` — ${cat.description.slice(0, 80)}` : ""}`,
        match_type: "category",
        relevance: 0.6,
      })
    }

    // ── Sort + deduplicate ────────────────────────────────────────────────────
    return results.sort((a, b) => b.relevance - a.relevance).slice(0, limit)
  }

  /**
   * Enriched search: returns wiki locations + related concepts + source resources.
   * Use this for "learn about" / "explain" queries where full context is needed.
   */
  export function searchWithContext(
    workspaceId: string,
    query: string,
    limit = 8,
  ): { locations: RetrievalResult[]; concepts: ConceptResult[]; sources: SourceResult[] } {
    const locations = search(workspaceId, query, limit)

    const q = query.toLowerCase().trim()
    const words = q.split(/\s+/).filter(Boolean)

    // ── Related concepts ──────────────────────────────────────────────────────
    const allConcepts = Database.use((db) =>
      db.select().from(LearningConceptTable).where(eq(LearningConceptTable.workspace_id, workspaceId)).all(),
    )
    const matchedConcepts: ConceptResult[] = allConcepts
      .filter((c) => {
        const text = [c.name, c.slug, c.definition ?? "", c.explanation ?? "", ...c.aliases].join(" ").toLowerCase()
        return words.some((w) => text.includes(w))
      })
      .slice(0, 10)
      .map((c) => ({
        name: c.name,
        slug: c.slug,
        definition: c.definition ?? null,
        explanation: c.explanation ?? null,
        aliases: c.aliases,
        related_slugs: c.related_slugs,
      }))

    // ── Source resources (which articles/pages introduced this content) ───────
    const placementPageIds = new Set(locations.map((l) => l.file_path))
    const seenResourceIds = new Set<string>()
    const sources: SourceResult[] = []

    for (const filePath of placementPageIds) {
      const page = Database.use((db) =>
        db.select().from(LearningWikiPageTable)
          .where(and(
            eq(LearningWikiPageTable.workspace_id, workspaceId),
            eq(LearningWikiPageTable.file_path, filePath),
          )).get(),
      )
      if (!page) continue

      const placements = Database.use((db) =>
        db.select().from(LearningResourceWikiPlacementTable)
          .where(eq(LearningResourceWikiPlacementTable.wiki_page_id, page.id))
          .all(),
      )

      for (const p of placements) {
        if (seenResourceIds.has(p.resource_id)) continue
        seenResourceIds.add(p.resource_id)

        const resource = Database.use((db) =>
          db.select().from(LearningResourceTable)
            .where(eq(LearningResourceTable.id, p.resource_id))
            .get(),
        )
        if (!resource) continue

        sources.push({
          title: resource.title ?? null,
          url: resource.url ?? null,
          author: resource.author ?? null,
          modality: resource.modality,
          memorized_at: resource.memorized_at,
        })
      }
    }

    return { locations, concepts: matchedConcepts, sources }
  }

  /** Format results as a readable string for agent output. */
  export function format(results: RetrievalResult[]): string {
    if (results.length === 0) return "No matching content found in the knowledge base."

    return results
      .map((r, i) => {
        const heading = r.section_heading ? `\n   Section: ${r.section_heading}` : ""
        return [
          `${i + 1}. **${r.file_path}**${heading}`,
          `   ${r.summary}`,
          `   Match: ${r.match_type} | Relevance: ${Math.round(r.relevance * 100)}%`,
          `   Path: ${r.abs_path}`,
        ].join("\n")
      })
      .join("\n\n")
  }
}

function toTitle(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}
