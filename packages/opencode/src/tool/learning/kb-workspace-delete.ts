/**
 * kb_workspace_delete — Delete a KB workspace and all its data.
 *
 * Removes the workspace row from the DB — all child records cascade automatically:
 *   categories, wiki pages, resources, placements, concepts, events, schema, etc.
 *
 * Optionally removes the files on disk (wiki/, supadense.md, log.md, schema.json).
 */
import z from "zod"
import { eq } from "drizzle-orm"
import { Tool } from "../tool"
import { Workspace } from "../../learning/workspace"
import { Database } from "../../storage/db"
import { LearningKbWorkspaceTable, LearningResourceTable } from "../../learning/schema.sql"

export const KbWorkspaceDeleteTool = Tool.define("kb_workspace_delete", {
  description: [
    "Delete a KB workspace and all its associated data.",
    "",
    "Removes from the database (all cascade automatically):",
    "  categories, wiki pages, resources, placements, concepts, gaps,",
    "  roadmap items, skills, events, schema metadata",
    "",
    "Optionally deletes the files on disk:",
    "  wiki/, supadense.md, log.md, schema.json",
    "",
    "Identify the workspace by either workspace_id or kb_path.",
    "Use kb_workspace_init (without a kb_path) or list existing workspaces to find the id.",
  ].join("\n"),
  parameters: z.object({
    workspace_id: z.string().optional().describe("Workspace ID to delete"),
    kb_path: z.string().optional().describe("KB folder path — used if workspace_id is not given"),
    delete_files: z
      .boolean()
      .optional()
      .default(true)
      .describe("If true (default), also delete wiki/, supadense.md, log.md, schema.json from disk"),
  }),

  async execute(params, ctx) {
    // ── Resolve workspace ────────────────────────────────────────────────────
    let workspace = params.workspace_id
      ? Workspace.getById(params.workspace_id)
      : params.kb_path
        ? Workspace.getByKbPath(params.kb_path)
        : undefined

    if (!workspace) {
      const hint = params.workspace_id
        ? `id '${params.workspace_id}'`
        : params.kb_path
          ? `path '${params.kb_path}'`
          : "(no id or path provided)"
      throw new Error(`Workspace not found: ${hint}`)
    }

    // ── Snapshot counts before deletion ──────────────────────────────────────
    const categories = Workspace.getCategories(workspace.id)
    const pages = Workspace.getWikiPages(workspace.id)
    const resources = Database.use((db) =>
      db.select().from(LearningResourceTable).where(eq(LearningResourceTable.workspace_id, workspace!.id)).all(),
    ).length

    // ── Ask permission ───────────────────────────────────────────────────────
    const filePatterns = params.delete_files
      ? ["wiki/**", "supadense.md", "log.md", "schema.json"]
      : []

    await ctx.ask({
      permission: "edit",
      patterns: filePatterns.length > 0 ? filePatterns : ["*"],
      always: ["*"],
      metadata: {
        filepath: workspace.kb_path,
        diff: [
          `Delete KB workspace: ${workspace.kb_path}`,
          `  ${categories.length} categories, ${pages.length} wiki pages`,
          params.delete_files ? "  Files on disk will also be removed" : "  Files on disk will be kept",
        ].join("\n"),
      },
    })

    const kbPath = workspace.kb_path
    const workspaceId = workspace.id

    // ── Delete DB rows — child tables cascade automatically ───────────────────
    Database.use((db) =>
      db.delete(LearningKbWorkspaceTable).where(eq(LearningKbWorkspaceTable.id, workspaceId)).run(),
    )

    // ── Optionally delete files on disk ───────────────────────────────────────
    const deleted: string[] = []
    if (params.delete_files) {
      const { existsSync, rmSync } = await import("fs")
      const path = await import("path")

      const filesToRemove = [
        path.join(kbPath, "supadense.md"),
        path.join(kbPath, "log.md"),
        path.join(kbPath, "schema.json"),
      ]
      const wikiDir = path.join(kbPath, "wiki")

      for (const f of filesToRemove) {
        if (existsSync(f)) {
          rmSync(f)
          deleted.push(f.replace(kbPath + "/", ""))
        }
      }

      if (existsSync(wikiDir)) {
        rmSync(wikiDir, { recursive: true })
        deleted.push("wiki/")
      }
    }

    // ── Build output ─────────────────────────────────────────────────────────
    const lines = [
      `Deleted workspace: ${kbPath}`,
      "",
      "Removed from database:",
      `  ${categories.length} categories`,
      `  ${pages.length} wiki pages`,
      `  ${resources} resources`,
      `  (concepts, events, placements, and all related records cascaded)`,
    ]

    if (deleted.length > 0) {
      lines.push("", "Deleted from disk:", ...deleted.map((f) => `  ${f}`))
    } else if (params.delete_files) {
      lines.push("", "No files found on disk to delete.")
    } else {
      lines.push("", "Files on disk were kept (pass delete_files: true to remove them).")
    }

    return {
      title: `KB workspace deleted: ${kbPath}`,
      metadata: {
        workspace_id: workspaceId,
        kb_path: kbPath,
        categories_removed: categories.length,
        pages_removed: pages.length,
        files_deleted: deleted,
      },
      output: lines.join("\n"),
    }
  },
})
