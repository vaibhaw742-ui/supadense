/**
 * kb_section_group — Group and densify a wiki section across all resources.
 *
 * Two-phase tool (call in order):
 *
 * Phase 1 — fetch (no `groups` param):
 *   Returns all placement content for the section so the LLM can cluster them.
 *
 * Phase 2 — apply (with `groups` param):
 *   Stores LLM-computed group assignments on each placement row,
 *   then rebuilds the wiki page so the grouped view is immediately visible.
 */
import z from "zod"
import { eq, and } from "drizzle-orm"
import { Tool } from "../tool"
import { Instance } from "../../project/instance"
import { Workspace } from "../../learning/workspace"
import { Resource } from "../../learning/resource"
import { Database } from "../../storage/db"
import { WikiBuilder } from "../../learning/wiki-builder"
import {
  LearningResourceWikiPlacementTable,
  LearningWikiPageTable,
  LearningResourceTable,
  LearningCategoryTable,
} from "../../learning/schema.sql"
import { readFileSync, existsSync } from "fs"
import path from "path"

// ─── Types ────────────────────────────────────────────────────────────────────

interface GroupAssignment {
  group_num: number
  group: string
  definition: string
  concepts: string[]
}

const GroupMemberSchema = z.object({
  resource_id: z.string().describe("Resource ID from the fetch phase"),
  concepts: z.array(z.string()).describe("Original concept/bullet names from this resource that belong to this group"),
})

const GroupSchema = z.object({
  group_num: z.number().int().positive().describe("Sequential group number starting at 1"),
  group: z.string().describe("Short, descriptive group name"),
  definition: z.string().describe("One-sentence synthesised definition grounded across all member resources"),
  members: z.array(GroupMemberSchema).describe("Which resources + concepts map into this group"),
})

// ─── Tool ─────────────────────────────────────────────────────────────────────

export const KbSectionGroupTool = Tool.define("kb_section_group", {
  description: [
    "Group and densify a wiki section across all resources. Use this when the user asks to",
    "'group', 'densify', 'consolidate', or 'merge' a section in a category.",
    "",
    "TWO-PHASE WORKFLOW — call in order:",
    "",
    "Phase 1 — FETCH (omit the `groups` param):",
    "  kb_section_group({ category_slug, section_slug })",
    "  → Returns all placement content for this section.",
    "  → Analyse the output and cluster the concepts into groups yourself.",
    "  → Each group should combine concepts that express the same core idea.",
    "",
    "Phase 2 — APPLY (provide the `groups` param with your clusters):",
    "  kb_section_group({ category_slug, section_slug, groups: [...] })",
    "  → Stores group_assignments on each placement row.",
    "  → Rebuilds the wiki page so grouped view is immediately visible.",
    "  → Returns a summary of what was grouped.",
    "",
    "Rules for grouping:",
    "  - Merge concepts that are synonyms or sub-variants of the same idea",
    "  - Keep groups that are genuinely distinct separate",
    "  - Aim for the fewest groups that preserve all meaningful distinctions",
    "  - Every resource must appear in at least one group",
    "  - A resource CAN belong to multiple groups if its content spans them",
  ].join("\n"),

  parameters: z.object({
    category_slug: z.string().describe("Category slug, e.g. 'rag', 'agents'"),
    subcategory_slug: z.string().optional().describe("Subcategory slug, e.g. 'advanced'. When provided, groups only that subcategory's section."),
    section_slug: z.string().describe("Section slug to group, e.g. 'key-concepts', 'use-cases'. Defaults to 'key-concepts'."),
    groups: z
      .array(GroupSchema)
      .optional()
      .describe("Phase 2 only: LLM-computed groups to store. Omit in Phase 1."),
  }),

  async execute(params, _ctx) {
    const project = Instance.project
    const workspace = Workspace.get(project.id) ?? Workspace.getByKbPath(Instance.directory)
    if (!workspace) throw new Error("No KB workspace found. Run kb_workspace_init first.")

    // ── Find category ─────────────────────────────────────────────────────────
    const category = Database.use((db) =>
      db.select().from(LearningCategoryTable)
        .where(and(
          eq(LearningCategoryTable.workspace_id, workspace.id),
          eq(LearningCategoryTable.slug, params.category_slug),
        ))
        .get(),
    )
    if (!category) throw new Error(`Category '${params.category_slug}' not found. Check available categories.`)

    // ── Find target page(s) ───────────────────────────────────────────────────
    // If subcategory_slug is given, scope to that specific page only.
    // Otherwise gather all pages in the category.
    let pages: (typeof LearningWikiPageTable.$inferSelect)[]

    if (params.subcategory_slug) {
      const subPage = Database.use((db) =>
        db.select().from(LearningWikiPageTable)
          .where(and(
            eq(LearningWikiPageTable.workspace_id, workspace.id),
            eq(LearningWikiPageTable.category_id, category.id),
            eq(LearningWikiPageTable.subcategory_slug, params.subcategory_slug!),
          ))
          .get(),
      )
      if (!subPage) throw new Error(`Subcategory '${params.subcategory_slug}' not found under '${params.category_slug}'.`)
      pages = [subPage]
    } else {
      pages = Database.use((db) =>
        db.select().from(LearningWikiPageTable)
          .where(and(
            eq(LearningWikiPageTable.workspace_id, workspace.id),
            eq(LearningWikiPageTable.category_id, category.id),
          ))
          .all(),
      )
      if (pages.length === 0) throw new Error(`No wiki pages found for category '${params.category_slug}'.`)
    }

    // ── Find placements for the requested section ─────────────────────────────
    const allPlacements: (typeof LearningResourceWikiPlacementTable.$inferSelect)[] = []

    for (const page of pages) {
      const rows = Database.use((db) =>
        db.select().from(LearningResourceWikiPlacementTable)
          .where(and(
            eq(LearningResourceWikiPlacementTable.wiki_page_id, page.id),
            eq(LearningResourceWikiPlacementTable.section_slug, params.section_slug),
          ))
          .all(),
      )
      allPlacements.push(...rows)
    }

    const target = params.subcategory_slug
      ? `${params.category_slug}/${params.subcategory_slug}`
      : params.category_slug

    if (allPlacements.length === 0) {
      throw new Error(
        `No placements found for section '${params.section_slug}' in '${target}'. ` +
        `Check that resources have been placed into this section.`,
      )
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 2 — APPLY: store groups, update placements, rebuild wiki
    // ══════════════════════════════════════════════════════════════════════════
    if (params.groups && params.groups.length > 0) {
      const groups = params.groups

      // Build a map: resource_id → group assignments for that resource
      const assignmentsByResource = new Map<string, GroupAssignment[]>()
      for (const group of groups) {
        for (const member of group.members) {
          if (!assignmentsByResource.has(member.resource_id)) {
            assignmentsByResource.set(member.resource_id, [])
          }
          assignmentsByResource.get(member.resource_id)!.push({
            group_num: group.group_num,
            group: group.group,
            definition: group.definition,
            concepts: member.concepts,
          })
        }
      }

      // Update each placement row with its group_assignments
      let updatedCount = 0
      for (const placement of allPlacements) {
        const assignments = assignmentsByResource.get(placement.resource_id)
        if (!assignments || assignments.length === 0) continue
        Database.use((db) =>
          db.update(LearningResourceWikiPlacementTable)
            .set({ group_assignments: JSON.stringify(assignments), time_updated: Date.now() })
            .where(eq(LearningResourceWikiPlacementTable.id, placement.id))
            .run(),
        )
        updatedCount++
      }

      // Rebuild all wiki pages in this category so grouped view is visible
      WikiBuilder.buildCategory(category.id)

      // Build summary
      const groupSummaryLines = groups.map((g) =>
        `  [${g.group_num}] ${g.group} — ${g.members.length} resource${g.members.length === 1 ? "" : "s"}`,
      )
      const totalConcepts = groups.reduce((n, g) => n + g.members.reduce((m, r) => m + r.concepts.length, 0), 0)

      return {
        title: `Grouped '${params.section_slug}' in ${target} → ${groups.length} groups`,
        metadata: {
          category_slug: params.category_slug,
          subcategory_slug: params.subcategory_slug,
          section_slug: params.section_slug,
          phase: "apply",
          groups_created: groups.length,
          placements_updated: updatedCount,
          total_concepts_grouped: totalConcepts,
        } as Record<string, unknown>,
        output: [
          `Section '${params.section_slug}' in '${target}' grouped successfully.`,
          ``,
          `Groups (${groups.length}):`,
          ...groupSummaryLines,
          ``,
          `Placements updated: ${updatedCount}`,
          `Total concepts grouped: ${totalConcepts}`,
          `Wiki pages rebuilt for category '${params.category_slug}'.`,
          ``,
          `To un-group: call kb_section_group_reset({ category_slug, section_slug }).`,
        ].join("\n"),
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 1 — FETCH: return placement data for LLM to analyse
    // ══════════════════════════════════════════════════════════════════════════
    const outputLines: string[] = [
      `Section: '${params.section_slug}' in category '${params.category_slug}'`,
      `Placements: ${allPlacements.length} resource${allPlacements.length === 1 ? "" : "s"}`,
      ``,
      `Analyse the entries below. Cluster concepts that express the same core idea into groups.`,
      `Then call kb_section_group again with the 'groups' param to apply your clusters.`,
      ``,
      `── ENTRIES ──────────────────────────────────────────────────────────────`,
      ``,
    ]

    for (const placement of allPlacements) {
      const resource = Database.use((db) =>
        db.select().from(LearningResourceTable)
          .where(eq(LearningResourceTable.id, placement.resource_id))
          .get(),
      )
      if (!resource) continue

      let title = resource.title ?? resource.url ?? "Untitled"
      try { if (!resource.title && resource.url) title = new URL(resource.url).hostname } catch { /* ok */ }

      outputLines.push(`Resource: ${title}`)
      outputLines.push(`resource_id: ${resource.id}`)

      // Raw content excerpt for richer context
      const rawContent = Resource.getRawContent(resource, workspace.kb_path)
      if (rawContent) {
        const excerpt = rawContent.slice(0, 400).replace(/\n+/g, " ").trim()
        outputLines.push(`Context excerpt: ${excerpt}${rawContent.length > 400 ? "…" : ""}`)
      }

      outputLines.push(`Placement content:`)
      outputLines.push(placement.extracted_content.trim())
      outputLines.push(``)
      outputLines.push(`────────────────────────────────────────────────────────────────────────`)
      outputLines.push(``)
    }

    return {
      title: `Fetched ${allPlacements.length} placements for '${params.section_slug}' in '${target}'`,
      metadata: {
        category_slug: params.category_slug,
        subcategory_slug: params.subcategory_slug,
        section_slug: params.section_slug,
        phase: "fetch",
        placement_count: allPlacements.length,
      } as Record<string, unknown>,
      output: outputLines.join("\n"),
    }
  },
})
