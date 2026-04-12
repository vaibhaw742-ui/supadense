/**
 * kb_wiki_build — Regenerate wiki .md files from DB state.
 *
 * Rebuilds one page, all pages in a category, or all pages in the workspace.
 * Always writes from DB state — the file is fully regenerated each time.
 * Also rebuilds supadense.md and log.md when rebuild_all is true.
 */
import z from "zod"
import { Tool } from "../tool"
import { WikiBuilder } from "../../learning/wiki-builder"
import { Workspace } from "../../learning/workspace"

export const KbWikiBuildTool = Tool.define("kb_wiki_build", {
  description: [
    "Regenerate wiki .md files from DB state. Call this after kb_resource_place to make changes visible.",
    "",
    "Three modes (mutually exclusive, checked in order):",
    "  page_id      — rebuild a single wiki page",
    "  category_id  — rebuild all pages in a category (category page + subcategories)",
    "  workspace_id — rebuild ALL pages, supadense.md, and log.md",
    "",
    "Always returns the list of files that were written.",
    "",
    "Note: this is the ONLY way files get updated. Users cannot edit wiki files directly.",
  ].join("\n"),
  parameters: z.object({
    page_id: z.string().optional().describe("Rebuild a single wiki page by ID"),
    category_id: z.string().optional().describe("Rebuild all pages in this category"),
    workspace_id: z.string().optional().describe("Rebuild all pages in this workspace (including supadense.md and log.md)"),
  }),
  async execute(params, ctx) {
    if (!params.page_id && !params.category_id && !params.workspace_id) {
      throw new Error("Provide one of: page_id, category_id, or workspace_id")
    }

    await ctx.ask({
      permission: "edit",
      patterns: ["wiki/**", "supadense.md", "log.md"],
      always: ["*"],
      metadata: {
        filepath: params.page_id ?? params.category_id ?? params.workspace_id ?? "",
        diff: "Regenerating wiki files from DB state",
      },
    })

    const built: string[] = []

    if (params.page_id) {
      const page = Workspace.getWikiPageById(params.page_id)
      if (!page) throw new Error(`Wiki page ${params.page_id} not found`)
      WikiBuilder.buildPage(params.page_id)
      built.push(page.file_path)
    } else if (params.category_id) {
      WikiBuilder.buildCategory(params.category_id)
      // Collect pages for output
      const allPages = Workspace.getWikiPages(
        Workspace.getWikiPageById(params.category_id)?.workspace_id ?? "",
      ).filter((p) => p.category_id === params.category_id)
      built.push(...allPages.map((p) => p.file_path))
    } else if (params.workspace_id) {
      const workspace = Workspace.getById(params.workspace_id)
      if (!workspace) throw new Error(`Workspace ${params.workspace_id} not found`)
      WikiBuilder.buildAll(params.workspace_id)
      WikiBuilder.buildSupadenseMd(workspace)
      WikiBuilder.buildLogFile(workspace)
      const allPages = Workspace.getWikiPages(params.workspace_id)
      built.push(...allPages.map((p) => p.file_path), "supadense.md", "log.md")
    }

    return {
      title: `Built ${built.length} file${built.length === 1 ? "" : "s"}`,
      metadata: { files_built: built },
      output: [
        `Built ${built.length} file${built.length === 1 ? "" : "s"}:`,
        ...built.map((f) => `  • ${f}`),
      ].join("\n"),
    }
  },
})
