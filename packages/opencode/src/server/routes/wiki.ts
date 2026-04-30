/**
 * wiki.ts — HTTP API routes for the KB wiki site
 * Served under /wiki/* in the instance router.
 */
import { Hono } from "hono"
import { readFileSync, existsSync, readdirSync } from "fs"
import path from "path"
import { eq, desc, inArray } from "drizzle-orm"
import { Instance } from "../../project/instance"
import { ProjectTable } from "../../project/project.sql"
import { Workspace } from "../../learning/workspace"
import { Retrieval } from "../../learning/retrieval"
import { Database } from "../../storage/db"
import {
  LearningKbEventTable,
  LearningResourceTable,
  LearningConceptTable,
  LearningKbWorkspaceTable,
  LearningResourceWikiPlacementTable,
  LearningMediaAssetTable,
} from "../../learning/schema.sql"
import { Auth } from "../../auth"
import { createAnthropic } from "@ai-sdk/anthropic"
import { generateText } from "ai"

async function generateKbDescription(
  type: "category" | "section",
  name: string,
  context?: string,
): Promise<string> {
  try {
    const auth = await Auth.get("anthropic")
    const apiKey = (auth && "key" in auth) ? auth.key : undefined
    if (!apiKey) return ""

    const anthropic = createAnthropic({ apiKey })
    const prompt = type === "category"
      ? `Write a 1-2 sentence description for a knowledge base category called "${name}"${context ? ` (inside "${context}")` : ""}. Be specific and technical. Return only the description, no quotes, no extra text.`
      : `Write a 1-2 sentence description for a knowledge base section called "${name}" inside the category "${context ?? "general"}". Be specific and technical. Return only the description, no quotes, no extra text.`

    const { text } = await generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      prompt,
      maxOutputTokens: 80,
    })
    return text.trim()
  } catch {
    return ""
  }
}

/** Resolve the KB workspace for the current request context.
 *  Tries project_id first, then falls back to kb_path = Instance.directory.
 *  Also ensures the watcher is started and existing wiki files are synced to DB.
 */
const wikiInitializedWorkspaces = new Set<string>()

function resolveWorkspace() {
  const project = Instance.project
  const workspace = Workspace.get(project.id) ?? Workspace.getByKbPath(Instance.directory)
  if (workspace && !wikiInitializedWorkspaces.has(workspace.id)) {
    wikiInitializedWorkspaces.add(workspace.id)
    Workspace.scaffoldFiles(workspace)
  }
  return workspace
}

/**
 * Returns a map of pageId → distinct resource count, computed from placements.
 * Avoids the stale denormalized resource_count column on wiki pages.
 */
function distinctResourceCounts(pageIds: string[]): Map<string, number> {
  if (pageIds.length === 0) return new Map()
  const placements = Database.use((db) =>
    db
      .select({
        wiki_page_id: LearningResourceWikiPlacementTable.wiki_page_id,
        resource_id: LearningResourceWikiPlacementTable.resource_id,
      })
      .from(LearningResourceWikiPlacementTable)
      .where(inArray(LearningResourceWikiPlacementTable.wiki_page_id, pageIds))
      .all(),
  )
  const sets = new Map<string, Set<string>>()
  for (const { wiki_page_id, resource_id } of placements) {
    if (!sets.has(wiki_page_id)) sets.set(wiki_page_id, new Set())
    sets.get(wiki_page_id)!.add(resource_id)
  }
  const result = new Map<string, number>()
  for (const [pageId, ids] of sets) result.set(pageId, ids.size)
  return result
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  const fm: Record<string, string> = {}
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":")
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const val = line.slice(colonIdx + 1).trim()
    if (key) fm[key] = val
  }
  return fm
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, "")
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

    const nonIndexPageIds = pages.filter((p) => p.page_type !== "index").map((p) => p.id)
    const pageResourceCounts = distinctResourceCounts(nonIndexPageIds)

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
        parent_category_id: cat.parent_category_id ?? null,
        resource_count: (() => {
          const ids = new Set<string>()
          const catPageIds = pages.filter((p) => p.category_id === cat.id).map((p) => p.id)
          // union all resource IDs across the category's pages for a true distinct count
          const catPlacements = Database.use((db) =>
            catPageIds.length === 0 ? [] :
            db.select({ resource_id: LearningResourceWikiPlacementTable.resource_id })
              .from(LearningResourceWikiPlacementTable)
              .where(inArray(LearningResourceWikiPlacementTable.wiki_page_id, catPageIds))
              .all()
          )
          for (const { resource_id } of catPlacements) ids.add(resource_id)
          return ids.size
        })(),
        pages: pages
          .filter((p) => p.category_id === cat.id)
          .map((p) => ({
            id: p.id,
            slug: p.slug,
            title: p.title,
            page_type: p.page_type,
            file_path: p.file_path,
            resource_count: pageResourceCounts.get(p.id) ?? 0,
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
    const pageIds = pages.map((p) => p.id)
    const counts = distinctResourceCounts(pageIds)
    return c.json(
      pages.map((p) => ({
        id: p.id,
        slug: p.slug,
        title: p.title,
        page_type: p.page_type,
        file_path: p.file_path,
        category_slug: p.category_slug,
        subcategory_slug: p.subcategory_slug,
        resource_count: counts.get(p.id) ?? 0,
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
      ) ??
      pages.find((p) => p.category_slug === slug && p.type === "overview") ??
      pages.find((p) => p.category_slug === slug && p.page_type === "category")

    if (!page) return c.json({ error: "Page not found" }, 404)

    const filePath = `${workspace.kb_path}/${page.file_path}`
    const content = existsSync(filePath) ? readFileSync(filePath, "utf8") : ""

    const categories = Workspace.getCategories(workspace.id)
    const category = page.category_id ? categories.find((c) => c.id === page.category_id) : null
    const subcategories = pages.filter((p) => p.parent_page_id === page.id)

    const concepts = Database.use((db) =>
      db.select().from(LearningConceptTable).where(eq(LearningConceptTable.workspace_id, workspace.id)).all(),
    )

    const pageCounts = distinctResourceCounts([page.id])
    const subcatIds = subcategories.map((s) => s.id)
    const subcatCounts = distinctResourceCounts(subcatIds)

    // For overview pages, aggregate resources from all section pages in the same category folder.
    // Overview pages have no direct placements — content lives on their sibling section pages.
    const placementPageIds = page.type === "overview" && page.category_id
      ? pages.filter((p) => p.category_id === page.category_id && p.type !== "overview").map((p) => p.id)
      : [page.id]

    // Fetch distinct resources for this page — sorted by placement date (latest first)
    const placements = placementPageIds.length === 0 ? [] : Database.use((db) =>
      db.select().from(LearningResourceWikiPlacementTable)
        .where(inArray(LearningResourceWikiPlacementTable.wiki_page_id, placementPageIds))
        .orderBy(desc(LearningResourceWikiPlacementTable.placed_at))
        .all(),
    )
    const allResources = Database.use((db) =>
      db.select().from(LearningResourceTable)
        .where(eq(LearningResourceTable.workspace_id, workspace.id))
        .all(),
    )
    const seenResourceIds = new Set<string>()
    const pageResources: { id: string; title: string | null; url: string | null; modality: string; section_heading: string | null; placed_at: number }[] = []
    for (const p of placements) {
      if (seenResourceIds.has(p.resource_id)) continue
      seenResourceIds.add(p.resource_id)
      const r = allResources.find((r) => r.id === p.resource_id)
      if (!r) continue
      pageResources.push({
        id: r.id,
        title: r.title ?? null,
        url: r.url ?? null,
        modality: r.modality,
        section_heading: p.section_heading ?? null,
        placed_at: p.placed_at,
      })
    }

    // Fetch images for all resources on this page — sorted by creation date (latest first)
    const resourceIds = [...seenResourceIds]
    const pageImages = resourceIds.length === 0 ? [] : Database.use((db) =>
      db.select().from(LearningMediaAssetTable)
        .where(inArray(LearningMediaAssetTable.resource_id, resourceIds))
        .orderBy(desc(LearningMediaAssetTable.time_created))
        .all(),
    ).map((a) => ({
      id: a.id,
      src_path: a.local_path.replace(/^wiki\//, ""),
      caption: a.caption ?? null,
      description: a.description ?? null,
      alt_text: a.alt_text ?? null,
      asset_type: a.asset_type,
      time_created: a.time_created,
    }))

    // All pages in the same category folder, used to build file-based tabs
    const categoryPages = page.category_id
      ? pages
          .filter((p) => p.category_id === page.category_id)
          .sort((a, b) => {
            if (a.type === "overview") return -1
            if (b.type === "overview") return 1
            return a.title.localeCompare(b.title)
          })
      : []
    const categoryTabs = categoryPages.map((p) => ({
      nav_slug: p.type === "overview"
        ? (p.category_slug ?? p.slug)
        : `${p.category_slug}--${p.subcategory_slug}`,
      title: p.type === "overview" ? "Overview" : p.title,
      type: p.type as string,
    }))

    return c.json({
      page: {
        id: page.id,
        slug: page.slug,
        title: page.title,
        description: page.description,
        type: page.type,
        page_type: page.page_type,
        file_path: page.file_path,
        resource_count: pageCounts.get(page.id) ?? 0,
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
      parent_category: (() => {
        if (!category?.parent_category_id) return null
        const parent = categories.find((c) => c.id === category.parent_category_id)
        return parent ? { id: parent.id, slug: parent.slug, name: parent.name } : null
      })(),
      content,
      category_tabs: categoryTabs,
      subcategories: subcategories.map((s) => ({
        id: s.id,
        slug: s.slug,
        title: s.title,
        file_path: s.file_path,
        subcategory_slug: s.subcategory_slug,
        resource_count: subcatCounts.get(s.id) ?? 0,
      })),
      concepts: concepts.slice(0, 30).map((c) => ({
        name: c.name,
        slug: c.slug,
        definition: c.definition,
        related_slugs: c.related_slugs,
      })),
      resources: pageResources,
      images: pageImages,
    })
  })

  // ── KB File Tree ─────────────────────────────────────────────────────────────
  app.get("/tree", async (c) => {
    const workspace = resolveWorkspace()
    if (!workspace) return c.json({ tree: [], kb_path: "" })
    return c.json({ tree: Workspace.getTree(workspace.id), kb_path: workspace.kb_path })
  })

  // ── Create Category ───────────────────────────────────────────────────────────
  app.post("/category", async (c) => {
    const workspace = resolveWorkspace()
    if (!workspace) return c.json({ error: "No KB workspace found" }, 404)

    let body: { name?: string; parent_category_id?: string }
    try { body = await c.req.json() } catch { return c.json({ error: "Invalid JSON" }, 400) }

    const name = body.name?.trim()
    if (!name) return c.json({ error: "name is required" }, 400)

    const parentName = body.parent_category_id
      ? Workspace.getCategories(workspace.id).find((c) => c.id === body.parent_category_id)?.name
      : undefined
    const description = await generateKbDescription("category", name, parentName)

    try {
      const result = Workspace.createCategory(workspace.id, name, body.parent_category_id, description || undefined)
      return c.json({ category: result.category, overview_page: result.overviewPage })
    } catch (e: unknown) {
      return c.json({ error: e instanceof Error ? e.message : "Failed to create category" }, 500)
    }
  })

  // ── Create Section ────────────────────────────────────────────────────────────
  app.post("/section", async (c) => {
    const workspace = resolveWorkspace()
    if (!workspace) return c.json({ error: "No KB workspace found" }, 404)

    let body: { name?: string; category_id?: string }
    try { body = await c.req.json() } catch { return c.json({ error: "Invalid JSON" }, 400) }

    const name = body.name?.trim()
    if (!name) return c.json({ error: "name is required" }, 400)
    if (!body.category_id) return c.json({ error: "category_id is required" }, 400)

    const categoryName = Workspace.getCategories(workspace.id).find((cat) => cat.id === body.category_id)?.name
    const description = await generateKbDescription("section", name, categoryName)

    try {
      const page = Workspace.createSection(workspace.id, name, body.category_id, description || undefined)
      return c.json({ page })
    } catch (e: unknown) {
      return c.json({ error: e instanceof Error ? e.message : "Failed to create section" }, 500)
    }
  })

  // ── Delete Category ───────────────────────────────────────────────────────────
  app.delete("/category/:id", async (c) => {
    const workspace = resolveWorkspace()
    if (!workspace) return c.json({ error: "No KB workspace found" }, 404)
    try {
      Workspace.deleteCategory(workspace.id, c.req.param("id"))
      return c.json({ ok: true })
    } catch (e: unknown) {
      return c.json({ error: e instanceof Error ? e.message : "Failed to delete category" }, 500)
    }
  })

  // ── Rename Category ───────────────────────────────────────────────────────────
  app.patch("/category/:id", async (c) => {
    const workspace = resolveWorkspace()
    if (!workspace) return c.json({ error: "No KB workspace found" }, 404)

    let body: { name?: string }
    try { body = await c.req.json() } catch { return c.json({ error: "Invalid JSON" }, 400) }

    const name = body.name?.trim()
    if (!name) return c.json({ error: "name is required" }, 400)

    try {
      Workspace.renameCategory(workspace.id, c.req.param("id"), name)
      return c.json({ ok: true })
    } catch (e: unknown) {
      return c.json({ error: e instanceof Error ? e.message : "Failed to rename category" }, 500)
    }
  })

  // ── Delete Section ────────────────────────────────────────────────────────────
  app.delete("/section/:id", async (c) => {
    const workspace = resolveWorkspace()
    if (!workspace) return c.json({ error: "No KB workspace found" }, 404)
    try {
      Workspace.deleteSection(workspace.id, c.req.param("id"))
      return c.json({ ok: true })
    } catch (e: unknown) {
      return c.json({ error: e instanceof Error ? e.message : "Failed to delete section" }, 500)
    }
  })

  // ── Rename Section ────────────────────────────────────────────────────────────
  app.patch("/section/:id", async (c) => {
    const workspace = resolveWorkspace()
    if (!workspace) return c.json({ error: "No KB workspace found" }, 404)

    let body: { name?: string }
    try { body = await c.req.json() } catch { return c.json({ error: "Invalid JSON" }, 400) }

    const name = body.name?.trim()
    if (!name) return c.json({ error: "name is required" }, 400)

    try {
      Workspace.renameSection(workspace.id, c.req.param("id"), name)
      return c.json({ ok: true })
    } catch (e: unknown) {
      return c.json({ error: e instanceof Error ? e.message : "Failed to rename section" }, 500)
    }
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
  // ── Roadmap list ────────────────────────────────────────────────────────────
  app.get("/roadmap", async (c) => {
    const ws = resolveWorkspace()
    if (!ws) return c.json({ docs: [] })
    const roadmapDir = path.join(ws.kb_path, "wiki", "roadmap")
    if (!existsSync(roadmapDir)) return c.json({ docs: [] })
    const files = readdirSync(roadmapDir).filter((f) => f.endsWith(".md"))
    const docs = files.map((file) => {
      const content = readFileSync(path.join(roadmapDir, file), "utf-8")
      const fm = parseFrontmatter(content)
      const slug = file.replace(/\.md$/, "")
      return { slug, title: fm.title ?? slug, type: fm.type ?? "roadmap", created: fm.created ?? null }
    })
    return c.json({ docs })
  })

  // ── Single roadmap doc ───────────────────────────────────────────────────────
  app.get("/roadmap/:slug", async (c) => {
    const slug = c.req.param("slug")
    if (!/^[a-zA-Z0-9_-]+$/.test(slug)) return c.text("Not found", 404)
    const ws = resolveWorkspace()
    if (!ws) return c.text("Not found", 404)
    const roadmapRoot = path.resolve(path.join(ws.kb_path, "wiki", "roadmap"))
    const filePath = path.resolve(path.join(roadmapRoot, `${slug}.md`))
    if (!filePath.startsWith(roadmapRoot)) return c.text("Not found", 404)
    if (!existsSync(filePath)) return c.text("Not found", 404)
    const content = readFileSync(filePath, "utf-8")
    const fm = parseFrontmatter(content)
    const body = stripFrontmatter(content)
    return c.json({ slug, title: fm.title ?? slug, type: fm.type ?? "roadmap", created: fm.created ?? null, content: body })
  })

  app.get("/assets/*", async (c) => {
    // c.req.param("*") can be undefined in some Hono versions; extract from path instead.
    // c.req.path returns the FULL path (e.g. "/wiki/assets/01KP5MJ7/file.png") — strip up to "assets/"
    const relativePath = c.req.path.replace(/^.*\/assets\//, "")

    // Helper: attempt to serve from a given kb_path
    async function tryServe(kbPath: string): Promise<Response | null> {
      const assetsRoot = path.resolve(path.join(kbPath, "assets"))
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

    // 2. Fall back: scan workspaces scoped to the current user (covers browser img requests)
    // Determine current userId from Instance context if available, else null (no cross-user scan)
    let userId: string | null = null
    try {
      userId = Instance.current.userId ?? null
    } catch { /* no instance context */ }

    if (userId) {
      // Join through project to restrict to this user's KB workspaces only
      const userWorkspaces = Database.use((db) =>
        db
          .select({ id: LearningKbWorkspaceTable.id, kb_path: LearningKbWorkspaceTable.kb_path })
          .from(LearningKbWorkspaceTable)
          .innerJoin(ProjectTable, eq(LearningKbWorkspaceTable.project_id, ProjectTable.id))
          .where(eq(ProjectTable.user_id, userId!))
          .all(),
      )
      for (const ws of userWorkspaces) {
        if (current && ws.id === current.id) continue
        const res = await tryServe(ws.kb_path)
        if (res) return res
      }
    }

    return c.text("Not found", 404)
  })

  return app
}
