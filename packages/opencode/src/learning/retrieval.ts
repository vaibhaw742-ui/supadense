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
 *   5. Raw content file search (raw/*.txt fallback)
 */
import { eq, and, like, or } from "drizzle-orm"
import { readFileSync, existsSync } from "fs"
import path from "path"
import { Database } from "../storage/db"
import {
  LearningWikiPageTable,
  LearningCategoryTable,
  LearningConceptTable,
  LearningConceptWikiPlacementTable,
  LearningResourceWikiPlacementTable,
  LearningResourceTable,
  LearningMediaAssetTable,
  LearningKbWorkspaceTable,
} from "./schema.sql"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RetrievalImage {
  /** Relative path from kb_path: "wiki/assets/abc/img.jpg" */
  local_path: string
  /** Full abs path */
  abs_path: string
  alt_text: string | null
  caption: string | null
  is_diagram: boolean
}

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
  match_type: "concept" | "content" | "page" | "category" | "raw"
  /** 0.0–1.0 relevance hint */
  relevance: number
  /** Images associated with this result (from placement media_asset_ids) */
  images: RetrievalImage[]
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
  export function search(workspaceId: string, query: string, limit = 8): RetrievalResult[] {
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
          images: [],
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

      // Resolve media assets attached to this placement
      const assetIds: string[] = (placement.media_asset_ids as string[] | null) ?? []
      const images: RetrievalImage[] = assetIds.length > 0
        ? assetIds.flatMap((id) => {
            const asset = Database.use((db) =>
              db.select().from(LearningMediaAssetTable).where(eq(LearningMediaAssetTable.id, id)).get(),
            )
            if (!asset) return []
            return [{
              local_path: asset.local_path,
              abs_path: path.join(kbPath, asset.local_path),
              alt_text: asset.alt_text ?? null,
              caption: asset.caption ?? null,
              is_diagram: asset.is_diagram ?? false,
            }]
          })
        : []

      const snippet = placement.extracted_content.slice(0, 100).trim()
      results.push({
        file_path: page.file_path,
        abs_path: `${kbPath}/${page.file_path}`,
        section_heading: placement.section_heading,
        summary: `Content match in "${page.title}" / ${placement.section_heading}: "${snippet}…"`,
        match_type: "content",
        relevance: matchedWords.length / words.length,
        images,
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
        images: [],
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
        images: [],
      })
    }

    // ── 5. Raw content file search ────────────────────────────────────────────
    const resources = Database.use((db) =>
      db
        .select()
        .from(LearningResourceTable)
        .where(eq(LearningResourceTable.workspace_id, workspaceId))
        .all(),
    )
    for (const resource of resources) {
      const filePath = resource.raw_content_path ?? null
      const key = `${filePath ?? `raw/${resource.id}`}:_`
      if (seen.has(key)) continue

      let rawText = ""
      if (resource.raw_content_path) {
        const fullPath = path.join(kbPath, resource.raw_content_path)
        if (existsSync(fullPath)) {
          // Cap at 100 KB to avoid reading enormous files into memory
          const buf = readFileSync(fullPath, "utf8")
          rawText = buf.slice(0, 100_000).toLowerCase()
        }
      } else if (resource.raw_content) {
        rawText = resource.raw_content.slice(0, 100_000).toLowerCase()
      }
      if (!rawText) continue

      const matchedWords = words.filter((w) => rawText.includes(w))
      if (matchedWords.length === 0) continue

      seen.add(key)

      // Find a snippet around the first matched word
      const firstWord = matchedWords[0]
      const idx = rawText.indexOf(firstWord)
      const start = Math.max(0, idx - 40)
      const snippet = rawText.slice(start, start + 120).replace(/\s+/g, " ").trim()

      // Include all images downloaded for this resource
      const rawAssets = Database.use((db) =>
        db.select().from(LearningMediaAssetTable)
          .where(eq(LearningMediaAssetTable.resource_id, resource.id))
          .all(),
      )
      const rawImages: RetrievalImage[] = rawAssets.map((a) => ({
        local_path: a.local_path,
        abs_path: path.join(kbPath, a.local_path),
        alt_text: a.alt_text ?? null,
        caption: a.caption ?? null,
        is_diagram: a.is_diagram ?? false,
      }))

      results.push({
        file_path: filePath ?? `raw/${resource.id}`,
        abs_path: path.join(kbPath, filePath ?? `raw/${resource.id}`),
        section_heading: null,
        summary: `Raw source: "${resource.title ?? resource.url ?? resource.id}"${resource.author ? ` by ${resource.author}` : ""} — "…${snippet}…"`,
        match_type: "raw",
        relevance: 0.4 + 0.1 * (matchedWords.length / words.length),
        images: rawImages,
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
        const imgLine = r.images.length > 0
          ? `\n   Images (${r.images.length}): ${r.images.map((img) => img.abs_path).join(", ")}`
          : ""
        return [
          `${i + 1}. **${r.file_path}**${heading}`,
          `   ${r.summary}`,
          `   Match: ${r.match_type} | Relevance: ${Math.round(r.relevance * 100)}%`,
          `   Path: ${r.abs_path}${imgLine}`,
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
