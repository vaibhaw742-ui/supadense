/**
 * kb_resource_place — Place extracted content into a wiki page section.
 *
 * Step 2 of the memorize pipeline (called once per section placement).
 * Records exactly what content from which resource was placed into which
 * section of which wiki page.
 *
 * Call kb_wiki_build after all placements to regenerate the .md files.
 */
import z from "zod"
import { eq, and } from "drizzle-orm"
import { Tool } from "../tool"
import { Instance } from "../../project/instance"
import { Workspace } from "../../learning/workspace"
import { Resource, Placement } from "../../learning/resource"
import { Database } from "../../storage/db"
import { LearningWikiPageTable } from "../../learning/schema.sql"

export const KbResourcePlaceTool = Tool.define("kb_resource_place", {
  description: [
    "Step 2 of the memorize pipeline. Record that a chunk of content from a resource",
    "should appear in a specific section of a wiki page.",
    "",
    "Call once per section placement (a resource can appear in multiple sections/pages).",
    "Skips if the same resource + page + section combination already exists.",
    "",
    "Parameters:",
    "  resource_id       — from kb_resource_create",
    "  wiki_page_id      — ID of the target wiki page (from kb_workspace_init pages list)",
    "  section_slug      — e.g. 'key-concepts', 'examples', 'papers', 'definitions'",
    "  section_heading   — exact markdown heading, e.g. '## Key Concepts'",
    "  extracted_content — the text chunk to place (well-formatted markdown)",
    "  confidence        — 0.0–1.0, how confident this placement is relevant",
  ].join("\n"),
  parameters: z.object({
    resource_id: z.string().describe("Resource ID from kb_resource_create"),
    wiki_page_id: z.string().describe("Target wiki page ID from kb_workspace_init. Also accepts category slug (e.g. 'agents') as fallback."),
    section_slug: z
      .string()
      .describe("Section identifier, e.g. 'key-concepts', 'examples', 'tools', 'papers'"),
    section_heading: z
      .string()
      .describe("Exact markdown heading for this section, e.g. '## Key Concepts'"),
    extracted_content: z
      .string()
      .describe(
        "The extracted and reformatted content chunk to place. Should be clean markdown. " +
          "Can include bullet points, short paragraphs. No need to include the section heading — it will be added automatically.",
      ),
    placement_position: z
      .number()
      .optional()
      .describe("Position within section (0 = first). Defaults to appending at end."),
    confidence: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("0.0–1.0 confidence that this content belongs here. Default: 1.0"),
  }),
  async execute(params) {
    const resource = Resource.get(params.resource_id)
    if (!resource) throw new Error(`Resource ${params.resource_id} not found`)

    // Accept either a DB ID or a category/subcategory slug as wiki_page_id
    let page = Workspace.getWikiPageById(params.wiki_page_id)
    if (!page) {
      // Try slug lookup within this project's workspace
      const workspace = Workspace.get(Instance.project.id)
      if (workspace) {
        page = Database.use((db) =>
          db.select().from(LearningWikiPageTable)
            .where(and(
              eq(LearningWikiPageTable.workspace_id, workspace.id),
              eq(LearningWikiPageTable.slug, params.wiki_page_id),
            )).get(),
        ) ?? undefined
      }
    }
    if (!page) throw new Error(`Wiki page '${params.wiki_page_id}' not found. Check the wiki_pages list from kb_workspace_init.`)

    type M = { skipped: boolean; placement_id?: string; resource_id?: string; wiki_page_id?: string; section_slug?: string; file_path?: string }

    // Idempotency: skip if already placed
    if (Placement.exists(params.resource_id, params.wiki_page_id, params.section_slug)) {
      return {
        title: "Already placed",
        metadata: { skipped: true } as M,
        output: `Skipped: resource ${params.resource_id} already placed in ${page.file_path} / ${params.section_slug}`,
      }
    }

    // Determine position (append after existing placements in same section)
    let position = params.placement_position
    if (position === undefined) {
      const existing = Placement.byPage(params.wiki_page_id).filter(
        (p) => p.section_slug === params.section_slug,
      )
      position = existing.length
    }

    const placement = Placement.create({
      resource_id: params.resource_id,
      wiki_page_id: params.wiki_page_id,
      section_slug: params.section_slug,
      section_heading: params.section_heading,
      extracted_content: params.extracted_content,
      placement_position: position,
      confidence: params.confidence ?? 1.0,
    })

    return {
      title: `Placed in ${page.file_path}`,
      metadata: {
        skipped: false,
        placement_id: placement.id,
        resource_id: params.resource_id,
        wiki_page_id: params.wiki_page_id,
        section_slug: params.section_slug,
        file_path: page.file_path,
      } as M,
      output: [
        `placement_id: ${placement.id}`,
        `file: ${page.file_path}`,
        `section: ${params.section_heading}`,
        `position: ${position}`,
        `content_length: ${params.extracted_content.length} chars`,
        "",
        "Content placed successfully. Call kb_wiki_build to regenerate the .md file.",
      ].join("\n"),
    }
  },
})
