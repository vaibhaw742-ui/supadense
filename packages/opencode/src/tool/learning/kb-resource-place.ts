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
    wiki_page_id: z.string().describe("Target wiki page — use 'id' or 'nav_slug' from kb_workspace_init wiki_pages list. Nav slug format: 'agents' (overview) or 'agents--key-concepts' (section). Double-dash separates category from section."),
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

    // Resolve page: try ID first, then several slug formats
    let page = Workspace.getWikiPageById(params.wiki_page_id)
    if (!page) {
      const workspace = Workspace.getByKbPath(Instance.directory)
      if (workspace) {
        const allPages = Workspace.getWikiPages(workspace.id)
        const id = params.wiki_page_id

        page =
          // exact slug column
          allPages.find((p) => p.slug === id) ??
          // nav_slug format: "category--subcategory"
          allPages.find((p) => p.category_slug && p.subcategory_slug && `${p.category_slug}--${p.subcategory_slug}` === id) ??
          // category overview: "agents"
          allPages.find((p) => p.category_slug === id && !p.subcategory_slug) ??
          // hyphenated combo: "agents-key-concepts" → category_slug="agents", subcategory_slug="key-concepts"
          allPages.find((p) => {
            if (!p.category_slug || !p.subcategory_slug) return false
            return `${p.category_slug}-${p.subcategory_slug}` === id ||
              id.startsWith(p.category_slug + "-") && id.slice(p.category_slug.length + 1) === p.subcategory_slug
          }) ??
          // file_path match
          allPages.find((p) => p.file_path === id || p.file_path.endsWith(`/${id}.md`))
      }
    }
    if (!page) throw new Error(
      `Wiki page '${params.wiki_page_id}' not found.\n` +
      `Use the 'id' or 'nav_slug' field from kb_workspace_init wiki_pages list.\n` +
      `Nav slug format: "agents" (overview) or "agents--key-concepts" (section).`
    )

    // Overview pages are structural indexes only — content must go into section pages.
    if (page.type === "overview") {
      const sectionSlug = params.section_slug ?? "key-concepts"
      const navSlug = page.category_slug
        ? `${page.category_slug}--${sectionSlug}`
        : `${page.slug}--${sectionSlug}`
      throw new Error(
        `Cannot place content on overview page '${page.file_path}'.\n` +
        `Overview pages are structural indexes only.\n` +
        `Place content on a section page instead, e.g. wiki_page_id: "${navSlug}".\n` +
        `Check kb_workspace_init wiki_pages list for available section pages.`
      )
    }

    type M = { skipped: boolean; placement_id?: string; resource_id?: string; wiki_page_id?: string; section_slug?: string; file_path?: string }

    const pageId = page.id

    // Auto-register the section on the page if not already defined
    const definedSections = page.sections ?? []
    if (!definedSections.some((s) => s.slug === params.section_slug)) {
      const newSection = {
        slug: params.section_slug,
        heading: params.section_heading,
        description: `Content from resources about ${params.section_slug.replace(/-/g, " ")}.`,
        updated_at: Date.now(),
      }
      Database.use((db) =>
        db.update(LearningWikiPageTable)
          .set({ sections: [...definedSections, newSection], time_updated: Date.now() })
          .where(eq(LearningWikiPageTable.id, page.id))
          .run(),
      )
    }

    // Idempotency: skip if already placed
    if (Placement.exists(params.resource_id, pageId, params.section_slug)) {
      return {
        title: "Already placed",
        metadata: { skipped: true } as M,
        output: `Skipped: resource ${params.resource_id} already placed in ${page.file_path} / ${params.section_slug}`,
      }
    }

    // Determine position (append after existing placements in same section)
    let position = params.placement_position
    if (position === undefined) {
      const existing = Placement.byPage(pageId).filter(
        (p) => p.section_slug === params.section_slug,
      )
      position = existing.length
    }

    const placement = Placement.create({
      resource_id: params.resource_id,
      wiki_page_id: pageId,
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
