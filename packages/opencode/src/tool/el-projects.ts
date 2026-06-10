import z from "zod"
import { Tool } from "./tool"
import { Database } from "../storage/db"
import { ElProjectTable, ElProjectResourceTable } from "../experiential/schema.sql"
import { LearningResourceTable } from "../learning/schema.sql"
import { eq, inArray, and } from "drizzle-orm"
import { mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import path from "node:path"
import { Instance } from "../project/instance"
import { ulid } from "ulid"

type TxOrDb = Parameters<Parameters<typeof Database.use>[0]>[0]

/** Get the authenticated user ID for the current instance. Returns undefined in unauthenticated contexts. */
function currentUserId(): string | undefined {
  try { return Instance.current.userId } catch { return undefined }
}

// ── el_list_projects ──────────────────────────────────────────────────────────

export const ElListProjectsTool = Tool.define("el_list_projects", {
  description:
    "List all EL (Experiential Learning) projects for the current user. " +
    "Call this when the user asks about their projects, wants to see what projects exist, or needs a project ID.",
  parameters: z.object({}),
  async execute(_params, ctx) {
    const userId = currentUserId()
    if (!userId) {
      return { title: "Not authenticated", output: "Unable to determine current user.", metadata: { count: 0 } }
    }

    const rows = Database.use((db: TxOrDb) =>
      db.select({
        id: ElProjectTable.id,
        name: ElProjectTable.name,
        status: ElProjectTable.status,
        is_default: ElProjectTable.is_default,
        clone_status: ElProjectTable.clone_status,
        time_created: ElProjectTable.time_created,
      }).from(ElProjectTable)
        .where(eq(ElProjectTable.user_id, userId))
        .all()
    )

    ctx.metadata({ title: "List EL projects", metadata: { count: rows.length } })

    if (rows.length === 0) {
      return { title: "EL Projects", output: "No projects found.", metadata: { count: 0 } }
    }

    const lines = rows.map((p) =>
      `- **${p.name}**${p.is_default ? " (default)" : ""} — ${p.status} — id: \`${p.id}\``
    )

    return {
      title: `EL Projects (${rows.length})`,
      output: lines.join("\n"),
      metadata: { count: rows.length },
    }
  },
})

// ── el_get_project ────────────────────────────────────────────────────────────

export const ElGetProjectTool = Tool.define("el_get_project", {
  description:
    "Get details of a specific EL project including its GitHub URL, status, and context. " +
    "Use when the user asks about a specific project.",
  parameters: z.object({
    project_id: z.string().describe("EL project ID"),
  }),
  async execute(params, ctx) {
    const userId = currentUserId()
    const meta = { project_id: undefined as string | undefined, name: undefined as string | undefined }

    if (!userId) {
      return { title: "Not authenticated", output: "Unable to determine current user.", metadata: meta }
    }

    // Always filter by user_id to prevent cross-user access
    const project = Database.use((db: TxOrDb) =>
      db.select().from(ElProjectTable)
        .where(and(eq(ElProjectTable.id, params.project_id), eq(ElProjectTable.user_id, userId)))
        .get()
    )

    ctx.metadata({ title: `Project: ${params.project_id}`, metadata: {} })

    if (!project) {
      return { title: "Project not found", output: `No project found with id: ${params.project_id}`, metadata: meta }
    }

    const githubUrl = (project.context_json as Record<string, unknown> | null)?.github_url as string | undefined
    const lines = [
      `**Name:** ${project.name}`,
      `**Status:** ${project.status}`,
      `**Default:** ${project.is_default ? "yes" : "no"}`,
      `**Clone status:** ${project.clone_status ?? "n/a"}`,
      githubUrl ? `**GitHub:** ${githubUrl}` : "",
      `**ID:** \`${project.id}\``,
    ].filter(Boolean)

    return {
      title: `Project: ${project.name}`,
      output: lines.join("\n"),
      metadata: { project_id: project.id as string | undefined, name: project.name as string | undefined },
    }
  },
})

// ── el_list_resources ─────────────────────────────────────────────────────────

export const ElListResourcesTool = Tool.define("el_list_resources", {
  description:
    "List all captured sources/resources for an EL project. " +
    "Call this when the user asks what sources or documents have been added to a project.",
  parameters: z.object({
    project_id: z.string().describe("EL project ID"),
  }),
  async execute(params, ctx) {
    const userId = currentUserId()
    if (!userId) {
      return { title: "Not authenticated", output: "Unable to determine current user.", metadata: { count: 0 } }
    }

    // Verify the project belongs to this user before listing its resources
    const project = Database.use((db: TxOrDb) =>
      db.select({ id: ElProjectTable.id }).from(ElProjectTable)
        .where(and(eq(ElProjectTable.id, params.project_id), eq(ElProjectTable.user_id, userId)))
        .get()
    )
    if (!project) {
      return { title: "Project not found", output: `No project found with id: ${params.project_id}`, metadata: { count: 0 } }
    }

    const joinRows = Database.use((db: TxOrDb) =>
      db.select().from(ElProjectResourceTable)
        .where(eq(ElProjectResourceTable.project_id, params.project_id))
        .all()
    )

    ctx.metadata({ title: `Resources for ${params.project_id}`, metadata: { count: joinRows.length } })

    if (joinRows.length === 0) {
      return { title: "No resources", output: "No sources have been added to this project yet.", metadata: { count: 0 } }
    }

    const resourceIds = joinRows.map((r) => r.resource_id)
    const resources = Database.use((db: TxOrDb) =>
      db.select({
        id: LearningResourceTable.id,
        url: LearningResourceTable.url,
        title: LearningResourceTable.title,
        status: LearningResourceTable.status,
        modality: LearningResourceTable.modality,
      }).from(LearningResourceTable)
        .where(inArray(LearningResourceTable.id, resourceIds))
        .all()
    )

    const roleMap = new Map(joinRows.map((r) => [r.resource_id, r.role]))
    const lines = resources.map((r) =>
      `- **${r.title ?? r.url ?? r.id}** (${r.modality}, ${r.status}, role: ${roleMap.get(r.id) ?? "supplementary"}) — id: \`${r.id}\``
    )

    return {
      title: `Resources (${resources.length})`,
      output: lines.join("\n"),
      metadata: { count: resources.length },
    }
  },
})

// ── el_get_resource ───────────────────────────────────────────────────────────

export const ElGetResourceTool = Tool.define("el_get_resource", {
  description:
    "Get the full markdown content of a captured source/resource. " +
    "Call this when the user wants to read or reference a specific source.",
  parameters: z.object({
    resource_id: z.string().describe("Resource ID"),
  }),
  async execute(params, ctx) {
    const userId = currentUserId()
    const meta = { resource_id: undefined as string | undefined, has_content: undefined as boolean | undefined }

    if (!userId) {
      return { title: "Not authenticated", output: "Unable to determine current user.", metadata: meta }
    }

    const resource = Database.use((db: TxOrDb) =>
      db.select().from(LearningResourceTable)
        .where(eq(LearningResourceTable.id, params.resource_id))
        .get()
    )

    ctx.metadata({ title: `Resource: ${params.resource_id}`, metadata: {} })

    if (!resource) {
      return { title: "Resource not found", output: `No resource found with id: ${params.resource_id}`, metadata: meta }
    }

    // Verify the resource belongs to a project owned by this user
    const ownerCheck = Database.use((db: TxOrDb) =>
      db.select({ id: ElProjectTable.id }).from(ElProjectTable)
        .innerJoin(ElProjectResourceTable, eq(ElProjectResourceTable.project_id, ElProjectTable.id))
        .where(and(eq(ElProjectResourceTable.resource_id, params.resource_id), eq(ElProjectTable.user_id, userId)))
        .get()
    )
    if (!ownerCheck) {
      return { title: "Not found", output: `Resource not found or not accessible.`, metadata: meta }
    }

    let content = resource.raw_content ?? null
    if (content && content.startsWith("/") && content.endsWith(".md")) {
      try { content = readFileSync(content, "utf-8") } catch { content = null }
    }

    const header = [
      `**Title:** ${resource.title ?? "(untitled)"}`,
      resource.url ? `**URL:** ${resource.url}` : "",
      `**Status:** ${resource.status}`,
      "",
    ].filter(Boolean).join("\n")

    return {
      title: `Resource: ${resource.title ?? resource.id}`,
      output: content ? `${header}\n---\n\n${content.slice(0, 8000)}` : `${header}\n(No content available)`,
      metadata: { resource_id: resource.id as string | undefined, has_content: !!content as boolean | undefined },
    }
  },
})

// ── el_capture_url ────────────────────────────────────────────────────────────

export const ElCaptureUrlTool = Tool.define("el_capture_url", {
  description:
    "Capture any URL as a markdown source and add it to a project's engineering brain. " +
    "Scrapes the page with Airtop (JS-rendered) or plain fetch as fallback. " +
    "Saves the markdown to the user's workspace and links it to the specified project. " +
    "Call this when the user shares a link and wants to capture it, add it to their brain, or save it as a source.",
  parameters: z.object({
    url: z.string().url().describe("URL to capture"),
    project_id: z.string().optional().describe("EL project ID to add the source to. If omitted, saves to workspace only."),
    title: z.string().optional().describe("Optional title override"),
  }),
  async execute(params, ctx) {
    const userId = currentUserId()
    if (!userId) {
      return { title: "Not authenticated", output: "Unable to determine current user.", metadata: { resource_id: undefined as string | undefined } }
    }

    // If project_id provided, verify ownership
    if (params.project_id) {
      const project = Database.use((db: TxOrDb) =>
        db.select({ id: ElProjectTable.id }).from(ElProjectTable)
          .where(and(eq(ElProjectTable.id, params.project_id!), eq(ElProjectTable.user_id, userId)))
          .get()
      )
      if (!project) {
        return { title: "Project not found", output: `No project found with id: ${params.project_id}`, metadata: { resource_id: undefined as string | undefined } }
      }
    }

    ctx.metadata({ title: `Capturing: ${params.url}`, metadata: {} })

    // Scrape the URL
    const { scrapeUrl } = await import("../brain/mcp/capture")
    let scraped: { content: string; title: string; slug: string }
    try {
      scraped = await scrapeUrl(params.url, params.title)
    } catch (err) {
      return {
        title: "Capture failed",
        output: `Failed to scrape ${params.url}: ${err instanceof Error ? err.message : String(err)}`,
        metadata: { resource_id: undefined as string | undefined },
      }
    }

    const { content, title, slug } = scraped

    // Save .md file to user workspace
    const { userWorkspaceDir } = await import("../util/workspace-provision")
    const sourcesDir = path.join(userWorkspaceDir(userId), "sources")
    mkdirSync(sourcesDir, { recursive: true })
    const filePath = path.join(sourcesDir, slug)
    writeFileSync(filePath, content, "utf-8")

    // Create DB record
    const resourceId = ulid()
    const now = Date.now()
    Database.use((db: TxOrDb) =>
      db.insert(LearningResourceTable).values({
        id: resourceId,
        url: params.url,
        title,
        modality: "url",
        status: "done",
        raw_content: filePath,
        time_created: now,
        time_updated: now,
      }).run()
    )

    // Link to project if provided, and create symlink in project's .supadense/sources/
    if (params.project_id) {
      Database.use((db: TxOrDb) =>
        db.insert(ElProjectResourceTable).values({
          id: ulid(),
          project_id: params.project_id!,
          resource_id: resourceId,
          role: "supplementary",
          time_created: now,
          time_updated: now,
        }).onConflictDoNothing().run()
      )

      // Symlink into project sources dir so it appears in file browser
      const { elProjectSourcesDir } = await import("../experiential/project-structure")
      const projSourcesDir = elProjectSourcesDir(userId, params.project_id)
      mkdirSync(projSourcesDir, { recursive: true })
      const linkPath = path.join(projSourcesDir, slug)
      try { unlinkSync(linkPath) } catch {}
      try { symlinkSync(filePath, linkPath) } catch {}
    }

    return {
      title: `Captured: ${title}`,
      output: [
        `✅ **${title}**`,
        `URL: ${params.url}`,
        `Saved to: \`${filePath}\``,
        params.project_id ? `Added to project: \`${params.project_id}\`` : "",
        `Resource ID: \`${resourceId}\``,
        "",
        "--- Preview ---",
        content.slice(0, 1000),
        content.length > 1000 ? `\n[... ${content.length} chars total ...]` : "",
      ].filter(Boolean).join("\n"),
      metadata: { resource_id: resourceId as string | undefined },
    }
  },
})

// ── el_remove_resource ────────────────────────────────────────────────────────

export const ElRemoveResourceTool = Tool.define("el_remove_resource", {
  description:
    "Remove a source/resource from an EL project. " +
    "Deletes the project link and symlink but keeps the original .md file (source may belong to other projects). " +
    "Call this when the user wants to remove a source from a project.",
  parameters: z.object({
    project_id: z.string().describe("EL project ID"),
    resource_id: z.string().describe("Resource ID to remove from the project"),
  }),
  async execute(params, ctx) {
    const userId = currentUserId()
    if (!userId) {
      return { title: "Not authenticated", output: "Unable to determine current user.", metadata: {} }
    }

    // Verify project ownership
    const project = Database.use((db: TxOrDb) =>
      db.select({ id: ElProjectTable.id, name: ElProjectTable.name })
        .from(ElProjectTable)
        .where(and(eq(ElProjectTable.id, params.project_id), eq(ElProjectTable.user_id, userId)))
        .get()
    )
    if (!project) {
      return { title: "Project not found", output: `No project found with id: ${params.project_id}`, metadata: {} }
    }

    // Find the join row
    const joinRow = Database.use((db: TxOrDb) =>
      db.select().from(ElProjectResourceTable)
        .where(and(
          eq(ElProjectResourceTable.project_id, params.project_id),
          eq(ElProjectResourceTable.resource_id, params.resource_id),
        ))
        .get()
    )
    if (!joinRow) {
      return { title: "Resource not in project", output: `Resource \`${params.resource_id}\` is not linked to this project.`, metadata: {} }
    }

    // Delete the join row
    Database.use((db: TxOrDb) =>
      db.delete(ElProjectResourceTable)
        .where(and(
          eq(ElProjectResourceTable.project_id, params.project_id),
          eq(ElProjectResourceTable.resource_id, params.resource_id),
        ))
        .run()
    )

    // Remove symlink from .supadense/sources/ (keep the actual .md file)
    const { elProjectSourcesDir } = await import("../experiential/project-structure")
    const linkPath = path.join(elProjectSourcesDir(userId, params.project_id), `${params.resource_id}.md`)
    try { unlinkSync(linkPath) } catch {}

    ctx.metadata({ title: `Removed resource from ${project.name}`, metadata: {} })

    return {
      title: `Removed from ${project.name}`,
      output: `✅ Resource \`${params.resource_id}\` removed from project **${project.name}**.\nThe original source file is preserved.`,
      metadata: {},
    }
  },
})
