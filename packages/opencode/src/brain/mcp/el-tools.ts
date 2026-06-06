// EL (Experiential Learning) MCP tool definitions and dispatcher
// These tools let external agents (Claude Code, Cursor, etc.) interact with
// EL projects, sources, and the knowledge graph.

import z from "zod"
import { Database }              from "../../storage/db"
import { ElProjectTable, ElProjectResourceTable } from "../../experiential/schema.sql"
import { LearningResourceTable } from "../../learning/schema.sql"
import { eq, inArray }           from "drizzle-orm"
import { existsSync, readFileSync } from "node:fs"
import type { DispatchResult }   from "./dispatch"
type TxOrDb = Parameters<Parameters<typeof Database.use>[0]>[0]

// ── Tool definitions ─────────────────────────────────────────────────────────

export const ElTools = {

  el_list_projects: {
    description: "List all Experiential Learning projects for the authenticated user.",
    parameters: z.object({
      user_id: z.string().describe("The user ID to list projects for"),
    }),
    async execute({ user_id }: { user_id: string }) {
      const rows = Database.use((db: TxOrDb) =>
        db.select({
          id: ElProjectTable.id,
          name: ElProjectTable.name,
          status: ElProjectTable.status,
          is_default: ElProjectTable.is_default,
          clone_status: ElProjectTable.clone_status,
          time_created: ElProjectTable.time_created,
        })
          .from(ElProjectTable)
          .where(eq(ElProjectTable.user_id, user_id))
          .all(),
      )
      return { projects: rows }
    },
  },

  el_get_project: {
    description: "Get details of a specific EL project including GitHub URL and context.",
    parameters: z.object({
      project_id: z.string().describe("EL project ID"),
    }),
    async execute({ project_id }: { project_id: string }) {
      const project = Database.use((db: TxOrDb) =>
        db.select().from(ElProjectTable).where(eq(ElProjectTable.id, project_id)).get(),
      )
      if (!project) return { error: "Project not found" }
      return { project }
    },
  },

  el_list_resources: {
    description: "List all captured sources/resources for an EL project.",
    parameters: z.object({
      project_id: z.string().describe("EL project ID"),
    }),
    async execute({ project_id }: { project_id: string }) {
      const joinRows = Database.use((db: TxOrDb) =>
        db.select().from(ElProjectResourceTable)
          .where(eq(ElProjectResourceTable.project_id, project_id))
          .all(),
      )
      if (joinRows.length === 0) return { resources: [] }

      const resourceIds = joinRows.map((r) => r.resource_id)
      const resources = Database.use((db: TxOrDb) =>
        db.select({
          id: LearningResourceTable.id,
          url: LearningResourceTable.url,
          title: LearningResourceTable.title,
          status: LearningResourceTable.status,
          modality: LearningResourceTable.modality,
          summary: LearningResourceTable.summary,
          time_created: LearningResourceTable.time_created,
        })
          .from(LearningResourceTable)
          .where(inArray(LearningResourceTable.id, resourceIds))
          .all(),
      )

      // Attach role from join table
      const roleMap = new Map(joinRows.map((r) => [r.resource_id, r.role]))
      return {
        resources: resources.map((r) => ({ ...r, role: roleMap.get(r.id) ?? "supplementary" })),
      }
    },
  },

  el_get_resource_content: {
    description: "Get the full markdown content of a captured source/resource.",
    parameters: z.object({
      resource_id: z.string().describe("Resource ID"),
    }),
    async execute({ resource_id }: { resource_id: string }) {
      const resource = Database.use((db: TxOrDb) =>
        db.select().from(LearningResourceTable)
          .where(eq(LearningResourceTable.id, resource_id))
          .get(),
      )
      if (!resource) return { error: "Resource not found" }

      // raw_content may be a file path
      let content = resource.raw_content ?? null
      if (content && content.startsWith("/") && content.endsWith(".md")) {
        try { content = readFileSync(content, "utf-8") } catch { content = null }
      }

      return {
        id: resource.id,
        url: resource.url,
        title: resource.title,
        status: resource.status,
        content,
      }
    },
  },

  el_add_resource: {
    description: "Capture a URL as a source and add it to an EL project. Scrapes with Airtop and returns markdown content.",
    parameters: z.object({
      project_id: z.string().describe("EL project ID to add the resource to"),
      url: z.string().url().describe("URL to capture and process"),
    }),
    async execute({ project_id, url }: { project_id: string; url: string }) {
      const { scrapeUrl } = await import("./capture")
      const { title, content, slug } = await scrapeUrl(url)
      return {
        ok: true,
        project_id,
        url,
        title,
        slug,
        content,
        _write_file: { path: slug, content },   // stdio bridge picks this up
      }
    },
  },

  capture_source: {
    description: "Capture any URL as a markdown source. Scrapes with Airtop (JS-rendered), saves to .supadense/sources/ and adds to brain. Use this when working in a local project with Claude Code.",
    parameters: z.object({
      url: z.string().url().describe("URL to capture"),
      project_id: z.string().optional().describe("Local project ID (from SUPADENSE_PROJECT env). If omitted, saves to brain only."),
      title: z.string().optional().describe("Optional title override"),
    }),
    async execute({ url, project_id, title: titleOverride }: { url: string; project_id?: string; title?: string }) {
      const { scrapeUrl } = await import("./capture")
      const { title, content, slug } = await scrapeUrl(url, titleOverride)
      return {
        ok: true,
        url,
        title,
        slug,
        content,
        project_id: project_id ?? null,
        _write_file: { path: `sources/${slug}`, content },  // stdio bridge writes to .supadense/sources/
      }
    },
  },

  el_get_graph: {
    description: "Get the knowledge graph (concepts, sources, GitHub nodes and their connections) for an EL project.",
    parameters: z.object({
      project_id: z.string().describe("EL project ID"),
    }),
    async execute({ project_id }: { project_id: string }) {
      const project = Database.use((db: TxOrDb) =>
        db.select({ context_json: ElProjectTable.context_json })
          .from(ElProjectTable)
          .where(eq(ElProjectTable.id, project_id))
          .get(),
      )
      const joinRows = Database.use((db: TxOrDb) =>
        db.select().from(ElProjectResourceTable)
          .where(eq(ElProjectResourceTable.project_id, project_id))
          .all(),
      )

      const nodes: Array<{ id: string; type: string; label: string; url?: string }> = []

      // GitHub node from context_json
      const githubUrl = project?.context_json?.github_url
      if (githubUrl) {
        let label = "Repo"
        try {
          const u = new URL(githubUrl)
          const parts = u.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/")
          label = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : label
        } catch {}
        nodes.push({ id: `github_${project_id}`, type: "github", label, url: githubUrl })
      }

      // Source nodes
      for (const row of joinRows) {
        const res = Database.use((db: TxOrDb) =>
          db.select({ id: LearningResourceTable.id, url: LearningResourceTable.url, title: LearningResourceTable.title, status: LearningResourceTable.status })
            .from(LearningResourceTable)
            .where(eq(LearningResourceTable.id, row.resource_id))
            .get(),
        )
        if (!res) continue
        const label = res.title ?? (res.url ? new URL(res.url).hostname : "Source")
        nodes.push({ id: `res_${res.id}`, type: "source", label, url: res.url ?? undefined })
      }

      return { nodes, edges: [] }
    },
  },

  el_get_project_file: {
    description: "Read a file from an EL project's cloned GitHub repo.",
    parameters: z.object({
      project_id: z.string().describe("EL project ID"),
      file_path: z.string().describe("Relative file path within the repo (e.g. src/index.ts)"),
    }),
    async execute({ project_id, file_path }: { project_id: string; file_path: string }) {
      const project = Database.use((db: TxOrDb) =>
        db.select({ repo_local_path: ElProjectTable.repo_local_path })
          .from(ElProjectTable)
          .where(eq(ElProjectTable.id, project_id))
          .get(),
      )
      if (!project?.repo_local_path) return { error: "Project has no cloned repo" }

      const { join, resolve } = await import("node:path")
      const fullPath = resolve(join(project.repo_local_path, file_path))

      // Path traversal guard
      if (!fullPath.startsWith(project.repo_local_path)) return { error: "Invalid path" }

      if (!existsSync(fullPath)) return { error: "File not found" }
      try {
        const content = readFileSync(fullPath, "utf-8")
        return { path: file_path, content: content.slice(0, 50_000) }
      } catch {
        return { error: "Could not read file" }
      }
    },
  },

  el_get_brain_files: {
    description: "List the brain knowledge files (.supadense/brain/) for an EL project.",
    parameters: z.object({
      project_id: z.string().describe("EL project ID"),
      layer: z.enum(["L0", "L1", "L2", "all"]).default("all").describe("Which knowledge layer to list"),
    }),
    async execute({ project_id, layer }: { project_id: string; layer: string }) {
      const project = Database.use((db: TxOrDb) =>
        db.select({ user_id: ElProjectTable.user_id })
          .from(ElProjectTable)
          .where(eq(ElProjectTable.id, project_id))
          .get(),
      )
      if (!project) return { error: "Project not found" }

      const { userWorkspaceDir } = await import("../../util/workspace-provision")
      const { join } = await import("node:path")
      const { readdirSync, statSync } = await import("node:fs")

      const brainDir = join(userWorkspaceDir(project.user_id), "el-projects", project_id, ".supadense", "brain")
      if (!existsSync(brainDir)) return { files: [] }

      const layers = layer === "all" ? ["L0", "L1", "L2"] : [layer]
      const files: Array<{ layer: string; path: string; size: number }> = []

      for (const l of layers) {
        const layerDir = join(brainDir, l)
        if (!existsSync(layerDir)) continue
        try {
          for (const name of readdirSync(layerDir)) {
            if (!name.endsWith(".md")) continue
            const fullPath = join(layerDir, name)
            const stat = statSync(fullPath)
            files.push({ layer: l, path: `${l}/${name}`, size: stat.size })
          }
        } catch {}
      }

      return { brain_dir: brainDir, files }
    },
  },
}

// ── EL tool scopes ────────────────────────────────────────────────────────────

export const EL_TOOL_SCOPES: Record<string, "read" | "write" | "admin"> = {
  el_list_projects:       "read",
  el_get_project:         "read",
  el_list_resources:      "read",
  el_get_resource_content:"read",
  el_add_resource:        "write",
  el_get_graph:           "read",
  el_get_project_file:    "read",
  el_get_brain_files:     "read",
  capture_source:         "write",
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

export async function dispatchElTool(
  name: string,
  args: Record<string, unknown>,
  scopes: Array<"read" | "write" | "admin">,
): Promise<DispatchResult> {
  const tool = (ElTools as Record<string, typeof ElTools[keyof typeof ElTools]>)[name]
  if (!tool) return errResult(`Unknown EL tool: ${name}`)

  const required = EL_TOOL_SCOPES[name] ?? "read"
  const scopeLevel = (s: string) => s === "read" ? 0 : s === "write" ? 1 : 2
  const hasScope = scopes.some((g) => scopeLevel(g) >= scopeLevel(required))
  if (!hasScope) return errResult(`Tool '${name}' requires '${required}' scope`)

  const parsed = tool.parameters.safeParse(args)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")
    return errResult(`Invalid params for '${name}': ${issues}`)
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (tool.execute as (p: any) => Promise<unknown>)(parsed.data)
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
  } catch (err) {
    return errResult(`Tool '${name}' failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function errResult(message: string): DispatchResult {
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true }
}

// ── Schema builder ────────────────────────────────────────────────────────────

export function getElToolDefs() {
  return Object.entries(ElTools).map(([name, tool]) => ({
    name,
    description: tool.description,
    inputSchema: zodToJsonSchema(tool.parameters),
  }))
}

function zodToJsonSchema(schema: z.ZodTypeAny): { type: "object"; properties: Record<string, unknown>; required: string[] } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const def = (schema as any)._def
  if (def?.typeName === "ZodObject") {
    const props: Record<string, unknown> = {}
    const required: string[] = []
    for (const [k, v] of Object.entries(def.shape())) {
      const inner = v as z.ZodTypeAny
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const innerDef = (inner as any)._def
      props[k] = innerDef?.typeName === "ZodString"  ? { type: "string" }
               : innerDef?.typeName === "ZodNumber"  ? { type: "number" }
               : innerDef?.typeName === "ZodBoolean" ? { type: "boolean" }
               : innerDef?.typeName === "ZodEnum"    ? { type: "string", enum: innerDef.values }
               : innerDef?.typeName === "ZodDefault" ? { type: "string" }
               : { type: "string" }
      if (innerDef?.description) (props[k] as Record<string, unknown>).description = innerDef.description
      if (innerDef?.typeName !== "ZodOptional" && innerDef?.typeName !== "ZodDefault") required.push(k)
    }
    return { type: "object", properties: props, required }
  }
  return { type: "object", properties: {}, required: [] }
}
