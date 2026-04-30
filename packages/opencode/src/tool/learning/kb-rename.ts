import z from "zod"
import { Tool } from "../tool"
import { Instance } from "../../project/instance"
import { Workspace } from "../../learning/workspace"

export const KbRenameTool = Tool.define("kb_rename", {
  description: [
    "Rename a KB category (folder) or section (file) by ID.",
    "",
    "Always use this tool instead of shell `mv` when renaming wiki folders or .md files.",
    "Using `mv` directly will orphan DB records — this tool updates both disk and DB atomically.",
    "",
    "To find the id, call kb_workspace_init which returns categories and wiki_pages with their ids.",
    "",
    "entity_type: 'category' for folders, 'section' for .md files.",
  ].join("\n"),
  parameters: z.object({
    entity_type: z.enum(["category", "section"]).describe("'category' for a folder, 'section' for a .md file"),
    id: z.string().describe("The id of the category or section to rename"),
    new_name: z.string().describe("The new human-readable name (e.g. 'Machine Learning'). Slug is derived automatically."),
  }),
  async execute(params) {
    const project = Instance.project
    const workspace = Workspace.get(project.id) ?? Workspace.getByKbPath(Instance.directory)
    if (!workspace) return { title: "KB Rename", output: "Error: no KB workspace found", metadata: {} }

    if (params.entity_type === "category") {
      Workspace.renameCategory(workspace.id, params.id, params.new_name)
    } else {
      Workspace.renameSection(workspace.id, params.id, params.new_name)
    }

    return {
      title: "KB Rename",
      output: `Renamed ${params.entity_type} ${params.id} → "${params.new_name}"`,
      metadata: { id: params.id, entity_type: params.entity_type, new_name: params.new_name },
    }
  },
})
