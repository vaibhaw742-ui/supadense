/**
 * kb_retrieve — Query the knowledge base for relevant content locations.
 *
 * Returns exact file_path + section_heading for each match.
 * Use ReadTool on the returned abs_path to get the actual content.
 *
 * Does NOT return file content — returns pointers so ReadTool can
 * fetch only the relevant section (offset + limit pattern).
 */
import z from "zod"
import { Tool } from "../tool"
import { Instance } from "../../project/instance"
import { Workspace } from "../../learning/workspace"
import { Retrieval } from "../../learning/retrieval"

export const KbRetrieveTool = Tool.define("kb_retrieve", {
  description: [
    "Search the knowledge base for content relevant to a query.",
    "",
    "Returns a list of locations (file_path + section_heading) where relevant content lives.",
    "Does NOT return the content itself — use ReadTool on the abs_path to get it.",
    "",
    "This keeps context window efficient: only read the relevant sections,",
    "not entire wiki files.",
    "",
    "Search covers: concepts, content placements, wiki page titles, category names.",
    "",
    "Typical usage:",
    "  1. Call kb_retrieve with the query",
    "  2. For each result, call ReadTool on abs_path",
    "  3. If section_heading is provided, scan for that heading to find the right offset",
  ].join("\n"),
  parameters: z.object({
    query: z.string().describe("Natural language query, e.g. 'multi-agent coordination', 'RAG evaluation metrics'"),
    workspace_id: z
      .string()
      .optional()
      .describe("Workspace ID. If omitted, uses the current project's workspace."),
    max_results: z
      .number()
      .min(1)
      .max(20)
      .optional()
      .describe("Maximum results to return. Default: 5."),
  }),
  async execute(params) {
    type M = { query?: string; result_count?: number; concept_count?: number; source_count?: number; results?: { file_path: string; abs_path: string; section_heading: string | null; match_type: string; relevance: number }[]; concepts?: unknown[]; sources?: unknown[] }

    let workspaceId = params.workspace_id
    if (!workspaceId) {
      const project = Instance.project
      const ws = Workspace.get(project.id)
      if (!ws) {
        return {
          title: "No KB workspace",
          metadata: {} as M,
          output:
            "No knowledge base workspace found for this project. Run kb_workspace_init to create one.",
        }
      }
      workspaceId = ws.id
    }

    const { locations, concepts, sources } = Retrieval.searchWithContext(workspaceId, params.query, params.max_results ?? 8)

    const conceptsText = concepts.length > 0
      ? [
          "",
          "## Related Concepts in your KB",
          ...concepts.map((c) => {
            const parts = [`**${c.name}**`]
            if (c.definition) parts.push(`: ${c.definition}`)
            if (c.aliases.length > 0) parts.push(` _(also: ${c.aliases.join(", ")})_`)
            if (c.related_slugs.length > 0) parts.push(`\n   Related: ${c.related_slugs.join(", ")}`)
            return `- ${parts.join("")}`
          }),
        ].join("\n")
      : ""

    const sourcesText = sources.length > 0
      ? [
          "",
          "## Resources that cover this topic",
          ...sources.map((s) => {
            const label = s.title ?? s.url ?? "Untitled"
            const meta = [s.author, s.modality].filter(Boolean).join(" · ")
            return `- **${label}**${meta ? ` (${meta})` : ""}${s.url ? `\n   ${s.url}` : ""}`
          }),
        ].join("\n")
      : ""

    const locationsText = locations.length > 0
      ? ["", "## Wiki Locations", Retrieval.format(locations)].join("\n")
      : "\nNo matching wiki sections found."

    return {
      title: `KB search: "${params.query}"`,
      metadata: {
        query: params.query,
        result_count: locations.length,
        concept_count: concepts.length,
        source_count: sources.length,
        results: locations.map((r) => ({
          file_path: r.file_path,
          abs_path: r.abs_path,
          section_heading: r.section_heading,
          match_type: r.match_type,
          relevance: r.relevance,
        })),
        concepts,
        sources,
      } as M,
      output: [locationsText, conceptsText, sourcesText].join("\n"),
    }
  },
})
