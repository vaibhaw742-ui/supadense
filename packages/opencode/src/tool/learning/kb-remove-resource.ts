/**
 * kb_remove_resource — Remove a resource by URL and clean up everything associated with it.
 *
 * Deletes:
 *   - The resource row (cascades → media asset rows, skill results)
 *   - The raw content file on disk (raw_content_path)
 *   - All image/asset files on disk (assets/...)
 */
import z from "zod"
import { eq } from "drizzle-orm"
import { unlinkSync, existsSync } from "fs"
import path from "path"
import { Tool } from "../tool"
import { Instance } from "../../project/instance"
import { Workspace } from "../../learning/workspace"
import { Database } from "../../storage/db"
import {
  LearningResourceTable,
} from "../../learning/schema.sql"

export const KbRemoveResourceTool = Tool.define("kb_remove_resource", {
  description: [
    "Remove a resource by URL and clean up EVERYTHING associated with it.",
    "",
    "This tool:",
    "  1. Finds the resource by URL",
    "  2. Deletes the raw extracted text file from disk",
    "  3. Deletes all extracted images/assets from disk",
    "  4. Removes the resource row (cascades to media assets, skill results)",
    "  5. Logs a resource_removed KB event",
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

    // ── 2. Delete inside a transaction ───────────────────────────────────────
    const mediaAssets: { local_path: string }[] = []

    Database.transaction((tx) => {
      // Delete the resource — cascades handle skill results
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

    // ── 3. Delete files from disk ─────────────────────────────────────────────
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

    // ── 4. Log KB event (no-op: LearningKbEventTable has been dropped) ───────
    const resourceTitle = resource.title ?? resource.url ?? resource.id
    Workspace.logEvent(workspace.id, {
      event_type: "resource_removed",
      summary: `Removed resource "${resourceTitle}" — ${deletedFiles.length} file${deletedFiles.length === 1 ? "" : "s"} deleted`,
      payload: { resource_id: resource.id, url: resource.url, files_deleted: deletedFiles.length },
    })

    // ── 5. Return summary ─────────────────────────────────────────────────────
    const lines = [
      `✓ Resource removed: ${resourceTitle}`,
      ``,
      `Files deleted: ${deletedFiles.length}`,
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
        files_deleted: deletedFiles.length,
      } as Record<string, unknown>,
      output: lines.join("\n"),
    }
  },
})
