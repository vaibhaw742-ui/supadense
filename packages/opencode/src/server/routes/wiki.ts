/**
 * wiki.ts — HTTP API routes for the KB wiki site
 * Served under /wiki/* in the instance router.
 */
import { Hono } from "hono"
import { readFileSync, existsSync } from "fs"
import path from "path"
import { eq, desc } from "drizzle-orm"
import { Instance } from "../../project/instance"
import { Workspace } from "../../learning/workspace"
import { Retrieval } from "../../learning/retrieval"
import { Database } from "../../storage/db"
import {
  LearningKbEventTable,
  LearningResourceTable,
  LearningConceptTable,
  LearningKbWorkspaceTable,
} from "../../learning/schema.sql"

/** Resolve the KB workspace for the current request context.
 *  Tries project_id first, then falls back to kb_path = Instance.directory.
 */
function resolveWorkspace() {
  const project = Instance.project
  return Workspace.get(project.id) ?? Workspace.getByKbPath(Instance.directory)
}

export const WikiRoutes = () => {
  const app = new Hono()

  // ── Home ────────────────────────────────────────────────────────────────────
  // Returns workspace stats, all categories with their pages, and recent events.
  app.get("/home", async (c) => {
    const workspace = resolveWorkspace()
    if (!workspace) return c.json({ error: "No KB workspace found" }, 404)

    const categories = Workspace.getCategories(workspace.id)
    const pages = Workspace.getWikiPages(workspace.id)

    const resourceCount = Database.use((db) =>
      db.select().from(LearningResourceTable).where(eq(LearningResourceTable.workspace_id, workspace.id)).all(),
    ).length

    const conceptCount = Database.use((db) =>
      db.select().from(LearningConceptTable).where(eq(LearningConceptTable.workspace_id, workspace.id)).all(),
    ).length

    const events = Database.use((db) =>
      db
        .select()
        .from(LearningKbEventTable)
        .where(eq(LearningKbEventTable.workspace_id, workspace.id))
        .orderBy(desc(LearningKbEventTable.time_created))
        .limit(10)
        .all(),
    )

    return c.json({
      workspace: {
        id: workspace.id,
        kb_path: workspace.kb_path,
        learning_intent: workspace.learning_intent,
        kb_initialized: workspace.kb_initialized,
        goals: workspace.goals,
      },
      stats: {
        total_pages: pages.filter((p) => p.page_type !== "index").length,
        total_categories: categories.length,
        total_sources: resourceCount,
        total_concepts: conceptCount,
      },
      categories: categories.map((cat) => ({
        id: cat.id,
        slug: cat.slug,
        name: cat.name,
        description: cat.description,
        depth: cat.depth,
        icon: cat.icon,
        color: cat.color,
        resource_count: pages
          .filter((p) => p.category_id === cat.id)
          .reduce((sum, p) => sum + p.resource_count, 0),
        pages: pages
          .filter((p) => p.category_id === cat.id)
          .map((p) => ({
            id: p.id,
            slug: p.slug,
            title: p.title,
            page_type: p.page_type,
            file_path: p.file_path,
            resource_count: p.resource_count,
            subcategory_slug: p.subcategory_slug,
          })),
      })),
      recent_events: events.map((e) => ({
        id: e.id,
        event_type: e.event_type,
        summary: e.summary,
        time_created: e.time_created,
      })),
    })
  })

  // ── Pages list ───────────────────────────────────────────────────────────────
  app.get("/pages", async (c) => {
    const workspace = resolveWorkspace()
    if (!workspace) return c.json([])

    const pages = Workspace.getWikiPages(workspace.id)
    return c.json(
      pages.map((p) => ({
        id: p.id,
        slug: p.slug,
        title: p.title,
        page_type: p.page_type,
        file_path: p.file_path,
        category_slug: p.category_slug,
        subcategory_slug: p.subcategory_slug,
        resource_count: p.resource_count,
      })),
    )
  })

  // ── Single page ──────────────────────────────────────────────────────────────
  // :slug can be a category slug ("agents") or combined ("agents--key-concepts")
  app.get("/page/:slug", async (c) => {
    const workspace = resolveWorkspace()
    if (!workspace) return c.json({ error: "No KB workspace found" }, 404)

    const slug = c.req.param("slug")
    const pages = Workspace.getWikiPages(workspace.id)

    const page =
      pages.find((p) => p.slug === slug) ??
      pages.find((p) => p.file_path === `wiki/${slug}.md`) ??
      pages.find(
        (p) => p.category_slug && p.subcategory_slug && `${p.category_slug}--${p.subcategory_slug}` === slug,
      )

    if (!page) return c.json({ error: "Page not found" }, 404)

    const filePath = `${workspace.kb_path}/${page.file_path}`
    const content = existsSync(filePath) ? readFileSync(filePath, "utf8") : ""

    const categories = Workspace.getCategories(workspace.id)
    const category = page.category_id ? categories.find((c) => c.id === page.category_id) : null
    const subcategories = pages.filter((p) => p.parent_page_id === page.id)

    const concepts = Database.use((db) =>
      db.select().from(LearningConceptTable).where(eq(LearningConceptTable.workspace_id, workspace.id)).all(),
    )

    return c.json({
      page: {
        id: page.id,
        slug: page.slug,
        title: page.title,
        description: page.description,
        page_type: page.page_type,
        file_path: page.file_path,
        resource_count: page.resource_count,
        word_count: page.word_count,
        category_slug: page.category_slug,
        subcategory_slug: page.subcategory_slug,
        time_updated: page.time_updated,
      },
      category: category
        ? {
            id: category.id,
            slug: category.slug,
            name: category.name,
            depth: category.depth,
            icon: category.icon,
          }
        : null,
      content,
      subcategories: subcategories.map((s) => ({
        id: s.id,
        slug: s.slug,
        title: s.title,
        file_path: s.file_path,
        subcategory_slug: s.subcategory_slug,
        resource_count: s.resource_count,
      })),
      concepts: concepts.slice(0, 30).map((c) => ({
        name: c.name,
        slug: c.slug,
        definition: c.definition,
        related_slugs: c.related_slugs,
      })),
    })
  })

  // ── Concepts ─────────────────────────────────────────────────────────────────
  app.get("/concepts", async (c) => {
    const workspace = resolveWorkspace()
    if (!workspace) return c.json([])

    const concepts = Database.use((db) =>
      db.select().from(LearningConceptTable).where(eq(LearningConceptTable.workspace_id, workspace.id)).all(),
    )

    return c.json(
      concepts.map((c) => ({
        name: c.name,
        slug: c.slug,
        definition: c.definition,
        aliases: c.aliases,
        related_slugs: c.related_slugs,
      })),
    )
  })

  // ── Search ───────────────────────────────────────────────────────────────────
  app.get("/search", async (c) => {
    const workspace = resolveWorkspace()
    if (!workspace) return c.json({ locations: [], concepts: [], sources: [] })

    const q = c.req.query("q") ?? ""
    if (!q.trim()) return c.json({ locations: [], concepts: [], sources: [] })

    const result = Retrieval.searchWithContext(workspace.id, q, 10)
    return c.json(result)
  })

  // ── Assets ───────────────────────────────────────────────────────────────────
  // NOTE: Browser <img> requests carry no custom headers, so we cannot use the
  // x-opencode-directory header here. Instead: try the current instance workspace
  // first, then scan all workspaces for a matching file.
  app.get("/assets/*", async (c) => {
    // c.req.param("*") can be undefined in some Hono versions; extract from path instead.
    // c.req.path returns the FULL path (e.g. "/wiki/assets/01KP5MJ7/file.png") — strip up to "assets/"
    const relativePath = c.req.path.replace(/^.*\/assets\//, "")

    // Helper: attempt to serve from a given kb_path
    async function tryServe(kbPath: string): Promise<Response | null> {
      const assetsRoot = path.resolve(path.join(kbPath, "wiki", "assets"))
      const fullPath = path.resolve(path.join(assetsRoot, relativePath))
      if (!fullPath.startsWith(assetsRoot)) return null
      if (!existsSync(fullPath)) return null
      const file = Bun.file(fullPath)
      const mime = file.type || "application/octet-stream"
      return new Response(await file.arrayBuffer(), {
        headers: { "Content-Type": mime, "Cache-Control": "public, max-age=86400" },
      })
    }

    // 1. Try the current instance workspace (fast path — header may be present)
    // resolveWorkspace() can throw if Instance context is not set (browser img requests)
    let current: ReturnType<typeof resolveWorkspace> = undefined
    try {
      current = resolveWorkspace()
      if (current) {
        const res = await tryServe(current.kb_path)
        if (res) return res
      }
    } catch { /* no instance context — fall through to scan all */ }

    // 2. Fall back: scan all workspaces (covers browser img requests with no header)
    const allWorkspaces = Database.use((db) =>
      db.select().from(LearningKbWorkspaceTable).all()
    )
    for (const ws of allWorkspaces) {
      if (current && ws.id === current.id) continue // already tried
      const res = await tryServe(ws.kb_path)
      if (res) return res
    }

    return c.text("Not found", 404)
  })

  return app
}
