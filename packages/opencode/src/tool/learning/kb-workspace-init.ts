/**
 * kb_workspace_init — Initialize (or get) the KB workspace for the current project.
 *
 * Call this at the start of any KB interaction to ensure the workspace and
 * scaffold files exist. Returns workspace info + current status.
 */
import z from "zod"
import { existsSync } from "fs"
import { join } from "path"
import { spawnSync } from "child_process"
import { Tool } from "../tool"
import { Instance } from "../../project/instance"
import { Workspace } from "../../learning/workspace"
import { KbSchema } from "../../learning/kb-schema"
import { Project } from "../../project/project"

export const KbWorkspaceInitTool = Tool.define("kb_workspace_init", {
  description: [
    "Initialize or retrieve the knowledge base (KB) workspace for the current project.",
    "",
    "Call this tool at the start of any KB workflow (onboarding, memorize, retrieve).",
    "",
    "If kb_path is provided, the workspace will be created/updated to use that folder.",
    "If kb_path is omitted, it defaults to the current project directory.",
    "",
    "On first call it creates the folder structure inside kb_path:",
    "  supadense.md",
    "  log.md",
    "  wiki/index.md",
    "  wiki/assets/",
    "",
    "Returns the workspace record including: id, kb_path, kb_initialized, categories, wiki pages.",
    "If kb_initialized is false, run the onboard flow (kb_onboard_complete) before memorizing.",
  ].join("\n"),
  parameters: z.object({
    kb_path: z
      .string()
      .optional()
      .describe(
        "Absolute path to the knowledge base folder. " +
          "Example: '/Users/you/Desktop/KnowledgeBase'. " +
          "Defaults to the current project directory if omitted.",
      ),
  }),
  async execute(params, ctx) {
    const project = Instance.project
    const kbPath = params.kb_path ?? Instance.directory

    // Always look up by kb_path first — each folder is its own independent KB
    let workspace = Workspace.getByKbPath(kbPath)

    if (!workspace) {
      workspace = Workspace.ensure(project.id, kbPath)
    }
    // Always scaffold — idempotent (only writes files/DB records that are missing)
    Workspace.scaffoldFiles(workspace)

    // Auto-initialize git if the KB folder isn't already a git repo.
    // This prevents the "initialize git?" prompt from appearing in the UI.
    if (!existsSync(join(kbPath, ".git"))) {
      const { which } = await import("../../util/which")
      if (which("git")) {
        const git = (args: string[]) =>
          spawnSync("git", args, { cwd: kbPath, encoding: "utf8", stdio: "pipe" })

        git(["init", "--quiet"])
        git(["add", "."])
        git(["commit", "--quiet", "-m", "Initialize knowledge base"])

        // Re-discover the project so it picks up the new git repo and gets
        // a stable git-based project ID (derived from the root commit hash).
        await Project.fromDirectory(kbPath)

        // Reload workspace after project re-registration (kb_path lookup still works)
        workspace = Workspace.getByKbPath(kbPath) ?? workspace
      }
    }

    // Render schema.json if the workspace has been onboarded
    if (workspace.kb_initialized) {
      KbSchema.ensure(workspace.id)
      KbSchema.renderToFile(workspace.id)
    }

    const categories = Workspace.getCategories(workspace.id)
    const pages = Workspace.getWikiPages(workspace.id)

    const summary = [
      `Workspace: ${workspace.id}`,
      `Path: ${workspace.kb_path}`,
      `Initialized: ${workspace.kb_initialized}`,
      `Categories: ${categories.length}`,
      `Wiki pages: ${pages.length}`,
      workspace.learning_intent ? `Intent: ${workspace.learning_intent}` : "Intent: (not set — run onboarding)",
    ].join("\n")

    return {
      title: "KB Workspace",
      metadata: {
        workspace_id: workspace.id,
        kb_path: workspace.kb_path,
        kb_initialized: workspace.kb_initialized,
        categories: categories.map((c) => ({ id: c.id, slug: c.slug, name: c.name, depth: c.depth })),
        wiki_pages: pages.map((p) => ({ id: p.id, type: p.page_type, file_path: p.file_path, title: p.title })),
      },
      output: summary,
    }
  },
})
