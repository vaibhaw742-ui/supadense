/**
 * kb_wiki_build — Regenerate auxiliary .md files from DB state.
 *
 * Rebuilds supadense.md and log.md for the workspace.
 */
import z from "zod"
import { Tool } from "../tool"
import { WikiBuilder } from "../../learning/wiki-builder"
import { Workspace } from "../../learning/workspace"

export const KbWikiBuildTool = Tool.define("kb_wiki_build", {
  description: [
    "Regenerate auxiliary .md files from DB state.",
    "",
    "Rebuilds supadense.md and log.md for the workspace.",
    "",
    "When the user says 'rebuild wiki' or 'refresh wiki', use workspace_id.",
    "",
    "Always returns the list of files that were written.",
  ].join("\n"),
  parameters: z.object({
    workspace_id: z.string().describe("Rebuild supadense.md and log.md for this workspace"),
  }),
  async execute(params, _ctx) {
    const workspace = Workspace.getById(params.workspace_id)
    if (!workspace) throw new Error(`Workspace ${params.workspace_id} not found`)

    WikiBuilder.buildSupadenseMd(workspace)
    WikiBuilder.buildLogFile(workspace)

    const built = ["supadense.md", "log.md"]

    return {
      title: `Built ${built.length} files`,
      metadata: { files_built: built },
      output: [
        `Built ${built.length} files:`,
        ...built.map((f) => `  • ${f}`),
      ].join("\n"),
    }
  },
})
