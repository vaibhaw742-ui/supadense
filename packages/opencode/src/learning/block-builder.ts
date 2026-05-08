/**
 * block-builder.ts — Build and maintain the learning_page_blocks table.
 *
 * Every wiki page has a block tree. AI-generated blocks come from placements.
 * User-created blocks have source="user". User-edited AI blocks have source="user_edited".
 *
 * Rules:
 *   - source="ai" blocks can be updated when AI re-runs
 *   - source="user_edited" and source="user" blocks are NEVER touched by AI
 *   - AI blocks whose placement is deleted get removed from the table
 */
import path from "path"
import { writeFileSync, mkdirSync } from "fs"
import { eq, and, inArray, asc } from "drizzle-orm"
import { Database } from "../storage/db"
import {
  LearningPageBlockTable,
  LearningResourceWikiPlacementTable,
  LearningWikiPageTable,
  LearningConceptTable,
  LearningConceptWikiPlacementTable,
  LearningKbWorkspaceTable,
} from "./schema.sql"

type Block = typeof LearningPageBlockTable.$inferSelect

export interface BlockNode {
  id: string
  content: string
  block_type: string
  source: string
  placement_id: string | null
  order_index: number
  depth: number
  properties: Record<string, unknown> | null
  children: BlockNode[]
}

// ─── Tree assembly ────────────────────────────────────────────────────────────

function assembleTree(flat: Block[]): BlockNode[] {
  const nodeMap = new Map<string, BlockNode>()
  const roots: BlockNode[] = []

  for (const b of flat) {
    nodeMap.set(b.id, {
      id: b.id,
      content: b.content,
      block_type: b.block_type,
      source: b.source,
      placement_id: b.placement_id ?? null,
      order_index: b.order_index,
      depth: b.depth,
      properties: (b.properties as Record<string, unknown>) ?? null,
      children: [],
    })
  }

  for (const b of flat) {
    const node = nodeMap.get(b.id)!
    if (b.parent_id) {
      const parent = nodeMap.get(b.parent_id)
      if (parent) parent.children.push(node)
      else roots.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}

// ─── BlockBuilder namespace ───────────────────────────────────────────────────

export namespace BlockBuilder {
  /**
   * Sync blocks for a wiki page from placements + concepts.
   * Creates/updates AI blocks, never touches user/user_edited blocks.
   * Removes AI blocks whose placement was deleted.
   */
  export function syncPage(wikiPageId: string): void {
    const page = Database.use((db) =>
      db.select().from(LearningWikiPageTable).where(eq(LearningWikiPageTable.id, wikiPageId)).get()
    )
    if (!page) return

    const workspace = Database.use((db) =>
      db.select().from(LearningKbWorkspaceTable).where(eq(LearningKbWorkspaceTable.id, page.workspace_id)).get()
    )
    if (!workspace) return

    const existingBlocks = Database.use((db) =>
      db.select().from(LearningPageBlockTable)
        .where(eq(LearningPageBlockTable.wiki_page_id, wikiPageId))
        .orderBy(asc(LearningPageBlockTable.order_index))
        .all()
    )

    const byPlacementId = new Map<string, Block>()
    for (const b of existingBlocks) {
      if (b.placement_id) byPlacementId.set(b.placement_id, b)
    }

    const placements = Database.use((db) =>
      db.select().from(LearningResourceWikiPlacementTable)
        .where(eq(LearningResourceWikiPlacementTable.wiki_page_id, wikiPageId))
        .orderBy(
          asc(LearningResourceWikiPlacementTable.section_slug),
          asc(LearningResourceWikiPlacementTable.placement_position)
        )
        .all()
    )

    const conceptPlacements = Database.use((db) =>
      db.select({
        concept_id: LearningConceptWikiPlacementTable.concept_id,
        section_slug: LearningConceptWikiPlacementTable.section_slug,
      })
        .from(LearningConceptWikiPlacementTable)
        .where(eq(LearningConceptWikiPlacementTable.wiki_page_id, wikiPageId))
        .all()
    )
    const conceptIds = conceptPlacements.map((cp) => cp.concept_id)
    const concepts = conceptIds.length > 0
      ? Database.use((db) =>
          db.select().from(LearningConceptTable)
            .where(inArray(LearningConceptTable.id, conceptIds))
            .all()
        )
      : []

    // Group placements by section
    const sectionMap = new Map<string, { heading: string; placements: typeof placements }>()
    for (const p of placements) {
      if (!sectionMap.has(p.section_slug)) {
        sectionMap.set(p.section_slug, { heading: p.section_heading, placements: [] })
      }
      sectionMap.get(p.section_slug)!.placements.push(p)
    }

    // Add schema sections with no placements yet
    if (page.sections && Array.isArray(page.sections)) {
      for (const s of page.sections as { slug: string; heading: string }[]) {
        if (!sectionMap.has(s.slug)) {
          sectionMap.set(s.slug, { heading: s.heading, placements: [] })
        }
      }
    }

    const skipSections = new Set(["images", "sources", "architecture-overview"])
    const now = Date.now()
    let globalOrderIndex = 0
    const seenPlacementIds = new Set<string>()

    for (const [sectionSlug, { heading, placements: sectionPlacements }] of sectionMap) {
      if (skipSections.has(sectionSlug)) continue

      // Upsert section heading block
      const existingHeading = existingBlocks.find(
        (b) => b.block_type === "heading_2" && b.content === heading && b.source === "ai" && b.placement_id == null
      )
      if (!existingHeading) {
        Database.use((db) =>
          db.insert(LearningPageBlockTable).values({
            id: crypto.randomUUID(),
            workspace_id: page.workspace_id,
            wiki_page_id: wikiPageId,
            parent_id: null,
            content: heading,
            block_type: "heading_2",
            source: "ai",
            placement_id: null,
            order_index: globalOrderIndex,
            depth: 0,
            properties: null,
            time_created: now,
            time_updated: now,
          }).run()
        )
      } else {
        Database.use((db) =>
          db.update(LearningPageBlockTable)
            .set({ order_index: globalOrderIndex, time_updated: now })
            .where(eq(LearningPageBlockTable.id, existingHeading.id))
            .run()
        )
      }
      globalOrderIndex++

      for (const p of sectionPlacements) {
        seenPlacementIds.add(p.id)
        const content = p.extracted_content?.trim() ?? ""
        if (!content) continue

        const existing = byPlacementId.get(p.id)
        if (!existing) {
          Database.use((db) =>
            db.insert(LearningPageBlockTable).values({
              id: crypto.randomUUID(),
              workspace_id: page.workspace_id,
              wiki_page_id: wikiPageId,
              parent_id: null,
              content,
              block_type: "content",
              source: "ai",
              placement_id: p.id,
              order_index: globalOrderIndex,
              depth: 1,
              properties: null,
              time_created: now,
              time_updated: now,
            }).run()
          )
        } else if (existing.source === "ai") {
          Database.use((db) =>
            db.update(LearningPageBlockTable)
              .set({ content, order_index: globalOrderIndex, depth: 1, time_updated: now })
              .where(eq(LearningPageBlockTable.id, existing.id))
              .run()
          )
        } else {
          // user or user_edited — preserve content, only update order
          Database.use((db) =>
            db.update(LearningPageBlockTable)
              .set({ order_index: globalOrderIndex, time_updated: now })
              .where(eq(LearningPageBlockTable.id, existing.id))
              .run()
          )
        }
        globalOrderIndex++
      }
    }

    // Concepts section
    if (concepts.length > 0) {
      const conceptHeading = "## Key Concepts"
      const existingConceptHeading = existingBlocks.find(
        (b) => b.block_type === "heading_2" && b.content === conceptHeading && b.source === "ai"
      )
      if (!existingConceptHeading) {
        Database.use((db) =>
          db.insert(LearningPageBlockTable).values({
            id: crypto.randomUUID(),
            workspace_id: page.workspace_id,
            wiki_page_id: wikiPageId,
            parent_id: null,
            content: conceptHeading,
            block_type: "heading_2",
            source: "ai",
            placement_id: null,
            order_index: globalOrderIndex,
            depth: 0,
            properties: null,
            time_created: now,
            time_updated: now,
          }).run()
        )
      } else {
        Database.use((db) =>
          db.update(LearningPageBlockTable)
            .set({ order_index: globalOrderIndex, time_updated: now })
            .where(eq(LearningPageBlockTable.id, existingConceptHeading.id))
            .run()
        )
      }
      globalOrderIndex++

      for (const c of concepts) {
        const conceptContent = `**${c.name}**${c.definition ? `\n${c.definition}` : ""}`
        const existingConcept = existingBlocks.find(
          (b) =>
            b.block_type === "concept" &&
            b.properties != null &&
            (b.properties as Record<string, unknown>).concept_id === c.id
        )
        if (!existingConcept) {
          Database.use((db) =>
            db.insert(LearningPageBlockTable).values({
              id: crypto.randomUUID(),
              workspace_id: page.workspace_id,
              wiki_page_id: wikiPageId,
              parent_id: null,
              content: conceptContent,
              block_type: "concept",
              source: "ai",
              placement_id: null,
              order_index: globalOrderIndex,
              depth: 1,
              properties: { concept_id: c.id },
              time_created: now,
              time_updated: now,
            }).run()
          )
        } else if (existingConcept.source === "ai") {
          Database.use((db) =>
            db.update(LearningPageBlockTable)
              .set({ content: conceptContent, order_index: globalOrderIndex, time_updated: now })
              .where(eq(LearningPageBlockTable.id, existingConcept.id))
              .run()
          )
        } else {
          Database.use((db) =>
            db.update(LearningPageBlockTable)
              .set({ order_index: globalOrderIndex, time_updated: now })
              .where(eq(LearningPageBlockTable.id, existingConcept.id))
              .run()
          )
        }
        globalOrderIndex++
      }
    }

    // Remove stale AI blocks (placement was deleted)
    const staleAiBlocks = existingBlocks.filter(
      (b) => b.source === "ai" && b.placement_id != null && !seenPlacementIds.has(b.placement_id)
    )
    if (staleAiBlocks.length > 0) {
      const staleIds = staleAiBlocks.map((b) => b.id)
      Database.use((db) =>
        db.delete(LearningPageBlockTable)
          .where(inArray(LearningPageBlockTable.id, staleIds))
          .run()
      )
    }
  }

  /**
   * Load all blocks for a page as a nested tree, ordered by order_index.
   */
  export function getBlockTree(wikiPageId: string): BlockNode[] {
    const flat = Database.use((db) =>
      db.select().from(LearningPageBlockTable)
        .where(eq(LearningPageBlockTable.wiki_page_id, wikiPageId))
        .orderBy(asc(LearningPageBlockTable.order_index))
        .all()
    )
    return assembleTree(flat)
  }

  /**
   * Serialize block tree to markdown string.
   */
  export function serializePage(wikiPageId: string): string {
    const page = Database.use((db) =>
      db.select().from(LearningWikiPageTable).where(eq(LearningWikiPageTable.id, wikiPageId)).get()
    )
    if (!page) return ""

    const flat = Database.use((db) =>
      db.select().from(LearningPageBlockTable)
        .where(eq(LearningPageBlockTable.wiki_page_id, wikiPageId))
        .orderBy(asc(LearningPageBlockTable.order_index))
        .all()
    )

    const tree = assembleTree(flat)
    const lines: string[] = [`# ${page.title}`, ""]

    function renderNode(node: BlockNode): void {
      switch (node.block_type) {
        case "heading_2":
          lines.push(node.content, "")
          break
        case "heading_3":
          lines.push(node.content, "")
          break
        case "content":
        case "paragraph":
          lines.push(node.content.trim(), "")
          break
        case "concept":
          lines.push(node.content.trim(), "")
          break
        case "image":
          lines.push(node.content.trim(), "")
          break
        case "link":
          lines.push(`- ${node.content.trim()}`, "")
          break
        case "divider":
          lines.push("---", "")
          break
        default:
          if (node.content.trim()) lines.push(node.content.trim(), "")
      }
      for (const child of node.children) renderNode(child)
    }

    for (const node of tree) renderNode(node)
    lines.push("---", "", `_Built: ${new Date().toISOString().split("T")[0]}_`)
    return lines.join("\n")
  }

  /**
   * Serialize blocks to markdown and write .md file to disk.
   * Called after user edits to keep git-sync files current.
   */
  export function rebuildMdFromBlocks(wikiPageId: string): void {
    const page = Database.use((db) =>
      db.select().from(LearningWikiPageTable).where(eq(LearningWikiPageTable.id, wikiPageId)).get()
    )
    if (!page) return

    const workspace = Database.use((db) =>
      db.select().from(LearningKbWorkspaceTable).where(eq(LearningKbWorkspaceTable.id, page.workspace_id)).get()
    )
    if (!workspace) return

    const content = serializePage(wikiPageId)
    const fullPath = path.join(workspace.kb_path, page.file_path)
    mkdirSync(path.dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, content, "utf8")
  }
}
