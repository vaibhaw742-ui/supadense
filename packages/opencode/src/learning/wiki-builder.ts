/**
 * wiki-builder.ts — Generate wiki .md files from DB state
 *
 * All wiki files are READ-ONLY from the user's perspective.
 * This module is the ONLY place that writes to them.
 * Every file is fully regenerated from the DB on each build.
 *
 * File format:
 *   wiki/index.md           → navigation hub
 *   wiki/<cat>.md           → category overview + subcategory summaries
 *   wiki/<cat>--<sub>.md    → subcategory page with section content
 */
import path from "path"
import { writeFileSync, mkdirSync } from "fs"
import { eq, and, inArray } from "drizzle-orm"
import { Database } from "../storage/db"
import {
  LearningWikiPageTable,
  LearningCategoryTable,
  LearningResourceWikiPlacementTable,
  LearningResourceTable,
  LearningConceptTable,
  LearningConceptWikiPlacementTable,
  LearningWikiCrossRefTable,
  LearningKbWorkspaceTable,
  LearningKbEventTable,
  LearningMediaAssetTable,
} from "./schema.sql"
import { Placement } from "./resource"

// ─── Types ────────────────────────────────────────────────────────────────────

type WikiPage = typeof LearningWikiPageTable.$inferSelect
type Category = typeof LearningCategoryTable.$inferSelect
type Workspace = typeof LearningKbWorkspaceTable.$inferSelect

// ─── Builder ─────────────────────────────────────────────────────────────────

export namespace WikiBuilder {
  /**
   * Build (regenerate) a single wiki page from DB state.
   * Writes the .md file to disk and updates word_count + last_built_at in DB.
   */
  export function buildPage(pageId: string): void {
    const page = Database.use((db) =>
      db.select().from(LearningWikiPageTable).where(eq(LearningWikiPageTable.id, pageId)).get(),
    )
    if (!page) throw new Error(`Wiki page ${pageId} not found`)

    const workspace = Database.use((db) =>
      db.select().from(LearningKbWorkspaceTable).where(eq(LearningKbWorkspaceTable.id, page.workspace_id)).get(),
    )
    if (!workspace) throw new Error(`Workspace ${page.workspace_id} not found`)

    // Migrate any placements stored with slug instead of UUID (pre-fix data)
    // Before the FK fix, wiki_page_id was stored as a slug (e.g. "agents") not a UUID
    if (page.slug) {
      Database.use((db) =>
        db.update(LearningResourceWikiPlacementTable)
          .set({ wiki_page_id: page.id, time_updated: Date.now() })
          .where(eq(LearningResourceWikiPlacementTable.wiki_page_id, page.slug!))
          .run()
      )
    }

    let content: string
    switch (page.page_type) {
      case "index":
        content = buildIndexPage(workspace)
        break
      case "category":
        content = buildCategoryPage(page, workspace)
        break
      case "subcategory":
        content = buildSubcategoryPage(page, workspace)
        break
      default:
        throw new Error(`Unknown page_type: ${page.page_type}`)
    }

    const fullPath = path.join(workspace.kb_path, page.file_path)
    mkdirSync(path.dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, content, "utf8")

    const wordCount = content.split(/\s+/).filter(Boolean).length
    Database.use((db) =>
      db
        .update(LearningWikiPageTable)
        .set({ word_count: wordCount, last_built_at: Date.now(), time_updated: Date.now() })
        .where(eq(LearningWikiPageTable.id, pageId))
        .run(),
    )
  }

  /** Build all wiki pages in a workspace (index + all category + subcategory). */
  export function buildAll(workspaceId: string): void {
    const pages = Database.use((db) =>
      db.select().from(LearningWikiPageTable).where(eq(LearningWikiPageTable.workspace_id, workspaceId)).all(),
    )
    for (const page of pages) {
      buildPage(page.id)
    }
  }

  /** Build all pages within a specific category (category page + its subcategories). */
  export function buildCategory(categoryId: string): void {
    const pages = Database.use((db) =>
      db
        .select()
        .from(LearningWikiPageTable)
        .where(eq(LearningWikiPageTable.category_id, categoryId))
        .all(),
    )
    for (const page of pages) {
      buildPage(page.id)
    }
  }

  // ─── Index Page ─────────────────────────────────────────────────────────────

  function buildIndexPage(workspace: Workspace): string {
    const categories = Database.use((db) =>
      db
        .select()
        .from(LearningCategoryTable)
        .where(eq(LearningCategoryTable.workspace_id, workspace.id))
        .all(),
    )
    const pages = Database.use((db) =>
      db
        .select()
        .from(LearningWikiPageTable)
        .where(eq(LearningWikiPageTable.workspace_id, workspace.id))
        .all(),
    )

    const lines: string[] = [
      "# Knowledge Index",
      "",
      "> This file is managed by the supadense agent. Edit via chat only.",
      "",
    ]

    if (workspace.learning_intent) {
      lines.push(`**Learning Intent:** ${workspace.learning_intent}`, "")
    }

    lines.push("## Categories", "")

    for (const cat of categories.sort((a, b) => a.position - b.position)) {
      const icon = cat.icon ? `${cat.icon} ` : ""
      const depth = cat.depth ? ` _(${cat.depth})_` : ""
      const catPage = pages.find((p) => p.category_slug === cat.slug && p.page_type === "category")
      const resourceCount = catPage?.resource_count ?? 0
      lines.push(`### ${icon}[${cat.name}](${cat.slug}.md)${depth}`)
      if (cat.description) lines.push("", cat.description)
      lines.push("")

      // Subcategory links
      const subcats = pages
        .filter((p) => p.category_slug === cat.slug && p.page_type === "subcategory")
        .sort((a, b) => (a.subcategory_slug ?? "").localeCompare(b.subcategory_slug ?? ""))

      if (subcats.length > 0) {
        lines.push("**Sections:**")
        for (const sub of subcats) {
          const subCount = sub.resource_count > 0 ? ` (${sub.resource_count} resources)` : ""
          lines.push(`- [${sub.title}](${cat.slug}--${sub.subcategory_slug}.md)${subCount}`)
        }
        lines.push("")
      }

      if (resourceCount > 0) {
        lines.push(`_${resourceCount} total resource${resourceCount === 1 ? "" : "s"}_`, "")
      }
    }

    lines.push(
      "---",
      "",
      `_Built: ${new Date().toISOString().split("T")[0]}_`,
    )

    return lines.join("\n")
  }

  // ─── Category Page ──────────────────────────────────────────────────────────

  function buildCategoryPage(page: WikiPage, workspace: Workspace): string {
    const category = Database.use((db) =>
      db
        .select()
        .from(LearningCategoryTable)
        .where(eq(LearningCategoryTable.id, page.category_id!))
        .get(),
    )
    if (!category) throw new Error(`Category for page ${page.id} not found`)

    const subcategoryPages = Database.use((db) =>
      db
        .select()
        .from(LearningWikiPageTable)
        .where(
          and(
            eq(LearningWikiPageTable.workspace_id, workspace.id),
            eq(LearningWikiPageTable.category_slug, category.slug),
            eq(LearningWikiPageTable.page_type, "subcategory"),
          ),
        )
        .all(),
    )

    const icon = category.icon ? `${category.icon} ` : ""
    const lines: string[] = [
      `# ${icon}${category.name}`,
      "",
      "> This file is managed by the supadense agent. Edit via chat only.",
      "",
    ]

    if (category.description) {
      lines.push(category.description, "")
    }

    lines.push(`**Depth:** ${category.depth}`, "")

    if (page.resource_count > 0) {
      lines.push(`**Resources:** ${page.resource_count}`, "")
    }

    // Subcategory summaries
    if (subcategoryPages.length > 0) {
      lines.push("## Sections", "")
      for (const sub of subcategoryPages.sort((a, b) =>
        (a.subcategory_slug ?? "").localeCompare(b.subcategory_slug ?? ""),
      )) {
        const subCount = sub.resource_count > 0 ? ` — ${sub.resource_count} resources` : ""
        lines.push(`### [${sub.title}](${sub.file_path.replace("wiki/", "")})\n`)

        // Pull most recent placements from this subcategory page for a summary
        const recentPlacements = Placement.byPage(sub.id).slice(0, 2)
        if (recentPlacements.length > 0) {
          const snippet = recentPlacements[0].extracted_content.slice(0, 200).trim()
          lines.push(snippet + (snippet.length === 200 ? "…" : ""), "")
        }

        lines.push(`[View full section →](${sub.file_path.replace("wiki/", "")})${subCount}`, "")
      }
    }

    // Placements directly on the category page (when no subcategory was created)
    const categoryPlacements = Placement.byPage(page.id)
    if (categoryPlacements.length > 0) {
      const sections = new Map<string, { heading: string; entries: typeof categoryPlacements }>()
      for (const p of categoryPlacements) {
        if (!sections.has(p.section_slug)) {
          sections.set(p.section_slug, { heading: p.section_heading, entries: [] })
        }
        sections.get(p.section_slug)!.entries.push(p)
      }

      const resourceImagesShown = new Set<string>()

      for (const [, { heading, entries }] of sections) {
        lines.push(heading, "")
        for (const entry of entries.sort((a, b) => a.placement_position - b.placement_position)) {
          lines.push(entry.extracted_content.trim())

          const resource = Database.use((db) =>
            db.select().from(LearningResourceTable).where(eq(LearningResourceTable.id, entry.resource_id)).get(),
          )
          if (resource) {
            const cite = resource.url
              ? `[Source](${resource.url})`
              : resource.title
                ? `_Source: ${resource.title}_`
                : "_Source: text paste_"
            lines.push("", `> ${cite}`)
          }

          if (!resourceImagesShown.has(entry.resource_id)) {
            const assets = Database.use((db) =>
              db.select().from(LearningMediaAssetTable)
                .where(eq(LearningMediaAssetTable.resource_id, entry.resource_id))
                .all()
            )
            if (assets.length > 0) {
              resourceImagesShown.add(entry.resource_id)
              for (const asset of assets) {
                const relPath = asset.local_path.replace(/^wiki\//, "")
                const alt = asset.alt_text ?? asset.description ?? "Image"
                lines.push("", `![${alt}](${relPath})`)
              }
            }
          }

          lines.push("")
        }
      }
    }

    // Cross-references
    const crossRefs = buildCrossRefSection(page.id)
    if (crossRefs) {
      lines.push(crossRefs)
    }

    lines.push(
      "---",
      "",
      `_Built: ${new Date().toISOString().split("T")[0]}_`,
    )

    return lines.join("\n")
  }

  // ─── Subcategory Page ───────────────────────────────────────────────────────

  function buildSubcategoryPage(page: WikiPage, workspace: Workspace): string {
    const placements = Placement.byPage(page.id)

    const lines: string[] = [
      `# ${page.title}`,
      "",
      "> This file is managed by the supadense agent. Edit via chat only.",
      "",
    ]

    if (page.description) {
      lines.push(page.description, "")
    }

    // Group placements by section
    const sections = new Map<string, { heading: string; entries: typeof placements }>()
    for (const p of placements) {
      if (!sections.has(p.section_slug)) {
        sections.set(p.section_slug, { heading: p.section_heading, entries: [] })
      }
      sections.get(p.section_slug)!.entries.push(p)
    }

    if (sections.size === 0) {
      lines.push("_No content yet. Memorize resources to populate this page._", "")
    } else {
      // Track which resources have already had their images embedded (show once per resource)
      const resourceImagesShown = new Set<string>()

      for (const [, { heading, entries }] of sections) {
        lines.push(heading, "")
        for (const entry of entries.sort((a, b) => a.placement_position - b.placement_position)) {
          lines.push(entry.extracted_content.trim())

          // Citation
          const resource = Database.use((db) =>
            db.select().from(LearningResourceTable).where(eq(LearningResourceTable.id, entry.resource_id)).get(),
          )
          if (resource) {
            const cite = resource.url
              ? `[Source](${resource.url})`
              : resource.title
                ? `_Source: ${resource.title}_`
                : "_Source: text paste_"
            lines.push("", `> ${cite}`)
          }

          // Embed images once per resource (on first placement encountered)
          if (!resourceImagesShown.has(entry.resource_id)) {
            const assets = Database.use((db) =>
              db.select().from(LearningMediaAssetTable)
                .where(eq(LearningMediaAssetTable.resource_id, entry.resource_id))
                .all()
            )
            if (assets.length > 0) {
              resourceImagesShown.add(entry.resource_id)
              for (const asset of assets) {
                const relPath = asset.local_path.replace(/^wiki\//, "")
                const alt = asset.alt_text ?? asset.description ?? "Image"
                lines.push("", `![${alt}](${relPath})`)
              }
            }
          }

          lines.push("")
        }
      }
    }

    // Concepts on this page
    const concepts = conceptsOnPage(page.id)
    if (concepts.length > 0) {
      lines.push("## Key Concepts", "")
      for (const c of concepts) {
        lines.push(`**${c.name}**`)
        if (c.definition) lines.push(c.definition)
        if (c.aliases.length > 0) lines.push(`_Also known as: ${c.aliases.join(", ")}_`)
        lines.push("")
      }
    }

    // Cross-references
    const crossRefs = buildCrossRefSection(page.id)
    if (crossRefs) {
      lines.push(crossRefs)
    }

    // Resources sidebar
    if (placements.length > 0) {
      const resourceIds = [...new Set(placements.map((p) => p.resource_id))]
      const resources = resourceIds
        .map((id) =>
          Database.use((db) =>
            db.select().from(LearningResourceTable).where(eq(LearningResourceTable.id, id)).get(),
          ),
        )
        .filter(Boolean)

      lines.push("## Sources", "")
      for (const r of resources) {
        if (!r) continue
        const link = r.url ? `[${r.title ?? r.url}](${r.url})` : r.title ?? "_text paste_"
        lines.push(`- ${link}`)
      }
      lines.push("")
    }

    lines.push(
      "---",
      "",
      `_Built: ${new Date().toISOString().split("T")[0]} | Resources: ${page.resource_count} | Words: ~${placements.reduce((n, p) => n + p.extracted_content.split(/\s+/).length, 0)}_`,
    )

    return lines.join("\n")
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function conceptsOnPage(pageId: string) {
    const links = Database.use((db) =>
      db
        .select()
        .from(LearningConceptWikiPlacementTable)
        .where(eq(LearningConceptWikiPlacementTable.wiki_page_id, pageId))
        .all(),
    )
    return links
      .map((l) =>
        Database.use((db) =>
          db.select().from(LearningConceptTable).where(eq(LearningConceptTable.id, l.concept_id)).get(),
        ),
      )
      .filter(Boolean) as (typeof LearningConceptTable.$inferSelect)[]
  }

  function buildCrossRefSection(pageId: string): string | null {
    const refs = Database.use((db) =>
      db
        .select()
        .from(LearningWikiCrossRefTable)
        .where(eq(LearningWikiCrossRefTable.source_page_id, pageId))
        .all(),
    )
    if (refs.length === 0) return null

    const lines: string[] = ["## Related", ""]
    for (const ref of refs) {
      const target = Database.use((db) =>
        db.select().from(LearningWikiPageTable).where(eq(LearningWikiPageTable.id, ref.target_page_id)).get(),
      )
      if (!target) continue
      const label = ref.description ? `${target.title} — ${ref.description}` : target.title
      lines.push(`- [${label}](${target.file_path.replace("wiki/", "")})`)
    }
    lines.push("")
    return lines.join("\n")
  }

  // ─── Log file ────────────────────────────────────────────────────────────────

  /**
   * Rebuild log.md from learning_kb_events table.
   * Most recent events first.
   */
  export function buildLogFile(workspace: Workspace): void {
    const events = Database.use((db) =>
      db
        .select()
        .from(LearningKbEventTable)
        .where(eq(LearningKbEventTable.workspace_id, workspace.id))
        .orderBy(LearningKbEventTable.time_created)
        .all(),
    )

    const lines: string[] = [
      "# Activity Log",
      "",
      "> This file is managed by the supadense agent. Edit via chat only.",
      "",
    ]

    // Group by date
    const byDate = new Map<string, typeof events>()
    for (const event of events.reverse()) {
      const date = new Date(event.time_created).toISOString().split("T")[0]
      if (!byDate.has(date)) byDate.set(date, [])
      byDate.get(date)!.push(event)
    }

    for (const [date, dayEvents] of byDate) {
      lines.push(`## ${date}`, "")
      for (const e of dayEvents) {
        const time = new Date(e.time_created).toISOString().split("T")[1].slice(0, 5)
        lines.push(`- **${time}** ${e.summary}`)
      }
      lines.push("")
    }

    const logPath = path.join(workspace.kb_path, "log.md")
    writeFileSync(logPath, lines.join("\n"), "utf8")
  }

  /**
   * Rebuild supadense.md from workspace profile.
   */
  export function buildSupadenseMd(workspace: Workspace): void {
    const categories = Database.use((db) =>
      db
        .select()
        .from(LearningCategoryTable)
        .where(eq(LearningCategoryTable.workspace_id, workspace.id))
        .all(),
    )

    const lines: string[] = [
      "# Knowledge Base",
      "",
      "> This file is managed by the supadense agent. Edit via chat only.",
      "",
      "## Learning Intent",
      "",
      workspace.learning_intent ?? "_Not set yet. Complete onboarding._",
      "",
      "## Goals",
      "",
    ]

    if (workspace.goals.length > 0) {
      for (const g of workspace.goals) lines.push(`- ${g}`)
    } else {
      lines.push("_Not set yet._")
    }
    lines.push("")

    lines.push("## Focus Areas", "")
    if (categories.length > 0) {
      for (const cat of categories.sort((a, b) => a.position - b.position)) {
        const depth = workspace.depth_prefs[cat.slug] ?? cat.depth
        const icon = cat.icon ? `${cat.icon} ` : ""
        lines.push(`- ${icon}**${cat.name}** _(${depth})_`)
        if (cat.description) lines.push(`  ${cat.description}`)
      }
    } else {
      lines.push("_No categories yet. Complete onboarding._")
    }
    lines.push("")

    if (workspace.trusted_sources.length > 0) {
      lines.push("## Trusted Sources", "")
      for (const s of workspace.trusted_sources) lines.push(`- ${s}`)
      lines.push("")
    }

    if (workspace.scout_platforms.length > 0) {
      lines.push("## Scout Platforms", "")
      for (const s of workspace.scout_platforms) lines.push(`- ${s}`)
      lines.push("")
    }

    lines.push("---", "", `_Updated: ${new Date().toISOString().split("T")[0]}_`)

    const mdPath = path.join(workspace.kb_path, "supadense.md")
    writeFileSync(mdPath, lines.join("\n"), "utf8")
  }
}
