/**
 * kb_remove_resource — Remove a resource by URL and clean up everything associated with it.
 *
 * Deletes:
 *   - The resource row (cascades → placements, media asset rows, skill results)
 *   - The raw content file on disk (raw_content_path)
 *   - All image/asset files on disk (wiki/assets/...)
 *
 * Nulls out soft references in:
 *   - learning_concept_wiki_placements.introduced_by_resource_id
 *   - learning_gaps.detected_from_resource_id
 *   - learning_roadmap_items.resource_id
 *
 * Rebuilds all affected wiki pages after deletion.
 */
import z from "zod"
import { eq } from "drizzle-orm"
import { unlinkSync, existsSync } from "fs"
import path from "path"
import { Tool } from "../tool"
import { Instance } from "../../project/instance"
import { Workspace } from "../../learning/workspace"
import { Database } from "../../storage/db"
import { WikiBuilder } from "../../learning/wiki-builder"
import {
  LearningResourceTable,
  LearningMediaAssetTable,
  LearningResourceWikiPlacementTable,
  LearningConceptWikiPlacementTable,
  LearningGapTable,
  LearningRoadmapItemTable,
  LearningKbEventTable,
  LearningWikiPageTable,
  LearningCategoryTable,
} from "../../learning/schema.sql"
import { ulid } from "ulid"

export const KbRemoveResourceTool = Tool.define("kb_remove_resource", {
  description: [
    "Remove a resource by URL and clean up EVERYTHING associated with it.",
    "",
    "This tool:",
    "  1. Finds the resource by URL",
    "  2. Deletes the raw extracted text file from disk",
    "  3. Deletes all extracted images/assets from disk",
    "  4. Removes all wiki placement rows for this resource",
    "  5. Removes the resource row (cascades to media assets, skill results)",
    "  6. Rebuilds all affected wiki pages",
    "  7. Logs a resource_removed KB event",
    "",
    "Use when the user says 'remove resource <url>', 'delete resource <url>',",
    "'forget this source <url>', or similar.",
  ].join("\n"),

  parameters: z.object({
    url: z.string().describe("The exact URL of the resource to remove"),
  }),

  async execute(params, _ctx) {
    const project = Instance.project
    const workspace = Workspace.get(project.id) ?? Workspace.getByKbPath(Instance.directory)
    if (!workspace) throw new Error("No KB workspace found.")

    // ── 1. Find the resource ──────────────────────────────────────────────────
    const resource = Database.use((db) =>
      db.select().from(LearningResourceTable)
        .where(eq(LearningResourceTable.url, params.url))
        .get(),
    )
    if (!resource) {
      throw new Error(
        `No resource found with URL: ${params.url}\n` +
        `Check the URL is exact — including http/https prefix.`,
      )
    }

    // ── 2–5. Collect data and delete everything inside a single transaction ───
    // Must be a transaction so null-outs and the resource delete are atomic.
    // Also collect placement/asset data INSIDE the transaction before cascades fire.
    let placements: (typeof LearningResourceWikiPlacementTable.$inferSelect)[] = []
    let mediaAssets: (typeof LearningMediaAssetTable.$inferSelect)[] = []
    const affectedCategoryIds = new Set<string>()

    Database.transaction((tx) => {
      // Collect placements (needed for wiki rebuild after delete)
      placements = tx.select().from(LearningResourceWikiPlacementTable)
        .where(eq(LearningResourceWikiPlacementTable.resource_id, resource.id))
        .all()

      const affectedPageIds = [...new Set(placements.map((p) => p.wiki_page_id))]
      for (const pageId of affectedPageIds) {
        const page = tx.select().from(LearningWikiPageTable)
          .where(eq(LearningWikiPageTable.id, pageId))
          .get()
        if (page?.category_id) affectedCategoryIds.add(page.category_id)
      }

      // Collect media asset paths (needed for disk cleanup after delete)
      mediaAssets = tx.select().from(LearningMediaAssetTable)
        .where(eq(LearningMediaAssetTable.resource_id, resource.id))
        .all()

      // Null-out all soft (non-cascaded) FK references before deleting
      tx.update(LearningConceptWikiPlacementTable)
        .set({ introduced_by_resource_id: null })
        .where(eq(LearningConceptWikiPlacementTable.introduced_by_resource_id, resource.id))
        .run()

      tx.update(LearningGapTable)
        .set({ detected_from_resource_id: null })
        .where(eq(LearningGapTable.detected_from_resource_id, resource.id))
        .run()

      tx.update(LearningRoadmapItemTable)
        .set({ resource_id: null })
        .where(eq(LearningRoadmapItemTable.resource_id, resource.id))
        .run()

      tx.update(LearningKbEventTable)
        .set({ resource_id: null })
        .where(eq(LearningKbEventTable.resource_id, resource.id))
        .run()

      // Delete the resource — cascades handle placements, media asset rows, skill results
      tx.delete(LearningResourceTable)
        .where(eq(LearningResourceTable.id, resource.id))
        .run()

      // Verify the row is gone
      const stillExists = tx.select().from(LearningResourceTable)
        .where(eq(LearningResourceTable.id, resource.id))
        .get()
      if (stillExists) {
        throw new Error(`Resource row still exists after delete — possible unhandled FK constraint. resource_id=${resource.id}`)
      }
    })

    // ── 6. Delete files from disk ─────────────────────────────────────────────
    const deletedFiles: string[] = []
    const missingFiles: string[] = []

    function tryDelete(relativePath: string | null | undefined) {
      if (!relativePath) return
      const fullPath = path.join(workspace!.kb_path, relativePath)
      if (existsSync(fullPath)) {
        try {
          unlinkSync(fullPath)
          deletedFiles.push(relativePath)
        } catch (e) {
          missingFiles.push(`${relativePath} (delete failed: ${e})`)
        }
      } else {
        missingFiles.push(`${relativePath} (not found on disk)`)
      }
    }

    // Raw content file
    tryDelete(resource.raw_content_path)

    // Image/asset files
    for (const asset of mediaAssets) {
      tryDelete(asset.local_path)
    }

    // ── 7. Rebuild affected wiki pages ────────────────────────────────────────
    const rebuiltCategories: string[] = []
    for (const categoryId of affectedCategoryIds) {
      const cat = Database.use((db) =>
        db.select().from(LearningCategoryTable)
          .where(eq(LearningCategoryTable.id, categoryId))
          .get(),
      )
      WikiBuilder.buildCategory(categoryId)
      if (cat) rebuiltCategories.push(cat.slug)
    }

    // ── 8. Log KB event ───────────────────────────────────────────────────────
    const resourceTitle = resource.title ?? resource.url ?? resource.id
    Database.use((db) =>
      db.insert(LearningKbEventTable).values({
        id: ulid(),
        workspace_id: workspace.id,
        event_type: "resource_removed",
        payload: {
          resource_id: resource.id,
          url: resource.url,
          placements_removed: placements.length,
          files_deleted: deletedFiles.length,
          categories_rebuilt: rebuiltCategories,
        },
        summary: `Removed resource "${resourceTitle}" — ${placements.length} placement${placements.length === 1 ? "" : "s"} removed, ${rebuiltCategories.join(", ") || "no"} pages rebuilt`,
        time_created: Date.now(),
        time_updated: Date.now(),
      }).run(),
    )

    // ── 9. Return summary ─────────────────────────────────────────────────────
    const lines = [
      `✓ Resource removed: ${resourceTitle}`,
      ``,
      `Placements removed:  ${placements.length}`,
      `Files deleted:       ${deletedFiles.length}`,
      `Wiki pages rebuilt:  ${rebuiltCategories.join(", ") || "none"}`,
    ]

    if (deletedFiles.length > 0) {
      lines.push(``, `Deleted files:`)
      for (const f of deletedFiles) lines.push(`  - ${f}`)
    }

    if (missingFiles.length > 0) {
      lines.push(``, `Skipped (not on disk):`)
      for (const f of missingFiles) lines.push(`  - ${f}`)
    }

    return {
      title: `Removed resource: ${resourceTitle}`,
      metadata: {
        resource_id: resource.id,
        url: resource.url,
        placements_removed: placements.length,
        files_deleted: deletedFiles.length,
        categories_rebuilt: rebuiltCategories,
      } as Record<string, unknown>,
      output: lines.join("\n"),
    }
  },
})
