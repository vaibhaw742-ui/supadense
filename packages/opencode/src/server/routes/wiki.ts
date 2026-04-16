/**
 * wiki.ts — HTTP API routes for the KB wiki site
 * Served under /wiki/* in the instance router.
 */
import { Hono } from "hono"
import { readFileSync, existsSync } from "fs"
import path from "path"
import { eq, desc, inArray } from "drizzle-orm"
import { Instance } from "../../project/instance"
import { Workspace } from "../../learning/workspace"
import { Retrieval } from "../../learning/retrieval"
import { Database } from "../../storage/db"
import {
  LearningKbEventTable,
  LearningResourceTable,
  LearningConceptTable,
  LearningKbWorkspaceTable,
  LearningResourceWikiPlacementTable,
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

    // ── Graph data ────────────────────────────────────────────────────────────
    type GraphNode = { id: string; type: string; label: string; color?: string; slug?: string; category_slug?: string; url?: string }
    type GraphEdge = { source: string; target: string }
    const graphNodes: GraphNode[] = []
    const graphEdges: GraphEdge[] = []
    const seenEdges = new Set<string>()
    function addEdge(source: string, target: string) {
      const key = `${source}→${target}`
      if (!seenEdges.has(key)) { seenEdges.add(key); graphEdges.push({ source, target }) }
    }

    // Category nodes
    for (const cat of categories) {
      graphNodes.push({ id: `cat_${cat.id}`, type: "category", label: cat.name, color: cat.color ?? "#6366f1", slug: cat.slug })
    }

    // Subcategory page nodes + category→page edges
    const subPages = pages.filter((p) => p.page_type === "subcategory")
    for (const page of subPages) {
      const label = page.subcategory_slug?.replace(/-/g, " ") ?? page.slug
      graphNodes.push({ id: `page_${page.id}`, type: "subcategory", label, category_slug: page.category_slug ?? undefined, slug: page.subcategory_slug ?? undefined })
      const cat = categories.find((c) => c.slug === page.category_slug)
      if (cat) addEdge(`cat_${cat.id}`, `page_${page.id}`)
    }

    // Resources + page→resource edges + group nodes
    // Use ALL pages (category + subcategory) since placements can be on either
    const resources = Database.use((db) =>
      db.select().from(LearningResourceTable).where(eq(LearningResourceTable.workspace_id, workspace.id)).all(),
    )
    const allPageIds = pages.filter((p) => p.page_type !== "index").map((p) => p.id)

    if (allPageIds.length > 0) {
      const placements = Database.use((db) =>
        db.select().from(LearningResourceWikiPlacementTable)
          .where(inArray(LearningResourceWikiPlacementTable.wiki_page_id, allPageIds))
          .all(),
      )

      const seenResources = new Set<string>()
      const seenGroups = new Set<string>()

      for (const placement of placements) {
        const resource = resources.find((r) => r.id === placement.resource_id)
        if (!resource) continue

        // Resource node (deduplicated) — domain-only label
        if (!seenResources.has(resource.id)) {
          let label = "Source"
          if (resource.url) {
            try { label = new URL(resource.url).hostname.replace(/^www\./, "") } catch { label = resource.title ?? "Source" }
          } else if (resource.title) {
            label = resource.title.split(" ").slice(0, 2).join(" ")
          }
          graphNodes.push({ id: `res_${resource.id}`, type: "resource", label, url: resource.url ?? undefined })
          seenResources.add(resource.id)
        }

        // Edge: page → resource (deduplicated)
        // For category-page placements, connect directly to the category node
        const placementPage = pages.find((p) => p.id === placement.wiki_page_id)
        if (placementPage?.page_type === "category") {
          const cat = categories.find((c) => c.slug === placementPage.category_slug)
          if (cat) addEdge(`cat_${cat.id}`, `res_${resource.id}`)
        } else {
          addEdge(`page_${placement.wiki_page_id}`, `res_${resource.id}`)
        }

        // Group nodes from group_assignments
        if (placement.group_assignments) {
          try {
            const assignments = JSON.parse(placement.group_assignments) as Array<{ group_num: number; group: string }>
            const page = pages.find((p) => p.id === placement.wiki_page_id)
            for (const a of assignments) {
              const groupId = `grp_${placement.wiki_page_id}_${a.group_num}`
              if (!seenGroups.has(groupId)) {
                graphNodes.push({ id: groupId, type: "group", label: `[${a.group_num}] ${a.group}`, category_slug: page?.category_slug ?? undefined })
                seenGroups.add(groupId)
                // Connect group to its parent page (or category if on category page)
                if (placementPage?.page_type === "category") {
                  const cat = categories.find((c) => c.slug === placementPage.category_slug)
                  if (cat) addEdge(`cat_${cat.id}`, groupId)
                } else {
                  addEdge(`page_${placement.wiki_page_id}`, groupId)
                }
              }
              addEdge(`res_${resource.id}`, groupId)
            }
          } catch { /* malformed JSON — skip */ }
        }
      }
    }

    return c.json({
      workspace: {
        id: workspace.id,
        kb_path: workspace.kb_path,
        learning_intent: workspace.learning_intent,
        kb_initialized: workspace.kb_initialized,
        goals: workspace.goals,
      },
      graph_data: { nodes: graphNodes, edges: graphEdges },
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
