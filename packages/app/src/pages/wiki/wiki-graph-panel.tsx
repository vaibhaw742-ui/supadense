/**
 * wiki-graph-panel.tsx — Full-screen knowledge graph panel shown in center area
 */
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Show,
  Suspense,
  lazy,
  onCleanup,
} from "solid-js"
import { ProjectFilePanel } from "./project-file-panel"
import { useParams } from "@solidjs/router"
import { useServer } from "@/context/server"
import { decode64 } from "@/utils/base64"
import { getAuthToken } from "@/utils/server"
import { setActiveSidebarView, setActiveNotesSlug, setActiveReadResourceId, setActiveReadResourceUrl, graphRefreshTick, setActiveGraphProjectId, setActiveGraphProjectName, setActiveSourceName } from "@/context/sidebar-view"
import { elApi, type CloneStatus, type ProjectNode } from "@/pages/projects/el-api"
import {
  activityEvents,
  notesNavRequest,
  setNotesNavRequest,
  notifiedEventIds,
  setNotifiedEventIds,
  dismissedEventIds,
} from "@/context/bg-processes"
import { renderMarkdown } from "@/pages/wiki/markdown"
import { BlockPageView } from "@/pages/wiki/block-page-view"
import type { GraphData, WikiResourceData } from "@/pages/wiki/wiki-api"
import "@/pages/wiki/wiki.css"

type NotesNavRequest =
  | { type: "page"; slug: string; label: string; parent?: { slug: string; label: string } }
  | { type: "resource"; resourceId: string; label: string }
  | { type: "resources-list" }

const WikiGraph = lazy(() =>
  import("@/pages/wiki/wiki-graph").then((m) => ({ default: m.WikiGraph })),
)

export function WikiGraphPanel(props: { projectId?: string | null }) {
  const server = useServer()
  const params = useParams<{ dir: string }>()

  const wikiBase = () => {
    const http = server.current?.http
    if (!http)
      return import.meta.env.DEV
        ? `http://${import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:${import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`
        : `${location.origin}/api`
    return typeof http === "string" ? http : (http as { url: string }).url
  }

  const fetchWiki = async (path: string) => {
    const token = getAuthToken()
    const directory = decode64(params.dir) ?? ""
    const res = await fetch(`${wikiBase()}${path}`, {
      headers: {
        "x-opencode-directory": directory,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
    if (!res.ok) return null
    return res.json()
  }

  // Fetch project metadata when projectId is set
  const [projectData] = createResource(
    () => props.projectId ?? null,
    async (id) => {
      try { return await elApi.getProject(id) } catch { return null }
    },
  )

  const [cloneStatus, { refetch: refetchCloneStatus }] = createResource(
    () => props.projectId ?? null,
    async (id): Promise<CloneStatus | null> => {
      try { return await elApi.getCloneStatus(id) } catch { return null }
    },
  )

  const [selectedNode, setSelectedNode] = createSignal<{ path: string; label: string } | null>(null)
  const [graphFilter, setGraphFilter] = createSignal<"all" | "active" | "gaps" | "stale" | "components" | "code">("all")
  const [branchPopoverOpen, setBranchPopoverOpen] = createSignal(false)
  const [commitsPopoverOpen, setCommitsPopoverOpen] = createSignal(false)
  // selectedBranch: null = use current cloned branch
  const [selectedBranch, setSelectedBranch] = createSignal<string | null>(null)

  const activeBranch = () => selectedBranch() ?? cloneStatus()?.repo_branch ?? "main"

  // Load branches eagerly once the repo is cloned (for commit count display), and also on popover open
  const [branchesData, { refetch: refetchBranches }] = createResource(
    () => props.projectId && cloneStatus()?.clone_status === "done" ? props.projectId : null,
    async (id) => {
      try { return await elApi.listBranches(id) } catch { return { branches: [], commit_count: 0 } }
    },
  )

  const [commitsData, { refetch: refetchCommits }] = createResource(
    () => commitsPopoverOpen() && props.projectId && cloneStatus()?.clone_status === "done"
      ? { id: props.projectId, branch: activeBranch() }
      : null,
    async ({ id, branch }) => {
      try { return await elApi.listCommits(id, branch, 50) } catch { return { commits: [] } }
    },
  )

  // Re-fetch commits when branch changes while popover is open
  createEffect(() => {
    if (commitsPopoverOpen()) {
      activeBranch() // track branch
      void refetchCommits()
    }
  })

  const [graphData, { refetch: refetchGraphData }] = createResource(
    () => props.projectId ?? (params.dir || null),
    async (): Promise<GraphData | null> => {
      try {
        if (props.projectId) {
          // Project-scoped graph from EL API
          const data = await elApi.getGraph(props.projectId)
          return data.nodes.length > 0 ? (data as unknown as GraphData) : null
        }
        const token = getAuthToken()
        const directory = decode64(params.dir) ?? ""
        const res = await fetch(`${wikiBase()}/wiki/graph`, {
          cache: "no-store",
          headers: {
            "x-opencode-directory": directory,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        })
        if (!res.ok) return null
        const data = (await res.json()) as GraphData
        return data.nodes.length > 0 ? data : null
      } catch {
        return null
      }
    },
  )

  // Poll every 15s to keep graph fresh
  const interval = setInterval(() => refetchGraphData(), 15_000)
  onCleanup(() => clearInterval(interval))

  // Refetch immediately when another panel triggers a refresh (e.g. resource deleted)
  createEffect(() => {
    graphRefreshTick() // track the signal
    refetchGraphData()
  })

  // Augment graph data with a synthetic GitHub repo node when the project has a github_url
  const displayGraphData = createMemo(() => {
    const data = graphData()
    const githubUrl = projectData()?.project?.context_json?.github_url
    if (!data || !githubUrl) return data
    const repoName = (() => {
      try {
        const parts = new URL(githubUrl).pathname.replace(/\.git$/, "").split("/").filter(Boolean)
        return parts[parts.length - 1] ?? "repo"
      } catch { return "repo" }
    })()
    const githubNode = {
      id: "github-repo",
      type: "github" as const,
      label: repoName,
      url: githubUrl,
    }
    // Link github node to the first project/directory node if one exists
    const anchor = data.nodes.find((n) => n.type === "project" || n.type === "directory")
    const extra = anchor ? [{ source: "github-repo", target: anchor.id }] : []
    return {
      nodes: [githubNode, ...data.nodes],
      edges: [...extra, ...data.edges],
    }
  })

  const [graphNav, setGraphNav] = createSignal<NotesNavRequest | null>(null)

  // Consume global notes-nav requests
  createEffect(() => {
    const req = notesNavRequest()
    if (req) {
      setNotesNavRequest(null)
      setGraphNav(req as NotesNavRequest)
    }
  })

  // Notification dots
  const [notifiedNodeIds, setNotifiedNodeIds] = createSignal<Set<string>>(new Set())
  const seenEventIds = new Set<string>()
  const nodeToEventIds = new Map<string, Set<string>>()

  createEffect(() => {
    const events = activityEvents()
    const data = graphData()
    if (!events.length) return
    setNotifiedNodeIds((prevNodes) => {
      const nextNodes = new Set(prevNodes)
      setNotifiedEventIds((prevEvts) => {
        const nextEvts = new Set(prevEvts)
        for (const event of events) {
          if (seenEventIds.has(event.id) || dismissedEventIds.has(event.id)) continue
          seenEventIds.add(event.id)
          nextEvts.add(event.id)
          let nodeId: string | null = null
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if ((event as any).nav_resource_id) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const node = data?.nodes.find((n) => n.type === "resource" && (n as any).resource_id === (event as any).nav_resource_id)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            nodeId = node ? node.id : `res_${(event as any).nav_resource_id}`
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } else if ((event as any).nav_slug) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const node = data?.nodes.find((n) => n.slug === (event as any).nav_slug)
            if (node) nodeId = node.id
          }
          if (nodeId) {
            nextNodes.add(nodeId)
            if (!nodeToEventIds.has(nodeId)) nodeToEventIds.set(nodeId, new Set())
            nodeToEventIds.get(nodeId)!.add(event.id)
          }
        }
        return nextEvts
      })
      return nextNodes
    })
  })

  createEffect(() => {
    if (notifiedEventIds().size === 0 && notifiedNodeIds().size > 0) {
      setNotifiedNodeIds(new Set<string>())
      nodeToEventIds.clear()
    }
  })

  const clearNotif = (nodeId: string) => {
    setNotifiedNodeIds((prev) => {
      const s = new Set(prev)
      s.delete(nodeId)
      return s
    })
    const evtIds = nodeToEventIds.get(nodeId)
    if (evtIds) {
      setNotifiedEventIds((prev) => {
        const s = new Set(prev)
        evtIds.forEach((id) => s.delete(id))
        return s
      })
      nodeToEventIds.delete(nodeId)
    }
  }

  type ResourceSummary = {
    id: string
    title: string | null
    url: string | null
    modality: string
    time_created: number
  }

  const [resourcesList] = createResource(
    () => (graphNav()?.type === "resources-list" ? true : null),
    async (): Promise<ResourceSummary[] | null> => {
      try {
        return (await fetchWiki("/wiki/resources")) as ResourceSummary[]
      } catch {
        return null
      }
    },
  )

  const [resourceData] = createResource(
    () =>
      graphNav()?.type === "resource"
        ? (graphNav() as { type: "resource"; resourceId: string }).resourceId
        : null,
    async (resourceId): Promise<WikiResourceData | null> => {
      try {
        return (await fetchWiki(`/wiki/resource/${resourceId}`)) as WikiResourceData
      } catch {
        return null
      }
    },
  )

  return (
    <div class="size-full flex flex-col" style={{ background: "#ffffff" }}>
      {/* Back button when navigated into a page/resource */}
      <Show when={graphNav()}>
        <div class="shrink-0 flex items-center gap-2 border-b border-border-weaker-base px-4 py-2">
          <button
            onClick={() => setGraphNav(null)}
            class="flex items-center gap-1 text-12-regular text-text-weak hover:text-text-base transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back to graph
          </button>
        </div>
      </Show>

      <div class="flex-1 min-h-0 overflow-hidden" style={{ display: "flex" }}>
        {/* Left column: canvas flex-1 + btm-bar in normal flow */}
        <div style={{ flex: (selectedNode() || (graphFilter() === "code" && !!props.projectId && !graphNav())) ? "0 0 65%" : "1", display: "flex", "flex-direction": "column", "min-width": "0", "min-height": "0" }}>

          {/* Graph canvas */}
          <div style={{ flex: "1", "min-height": "0", overflow: "hidden", position: "relative" }}>

            {/* ── Top-left filter pills (lib-overlay style) ── */}
            <Show when={props.projectId && !graphNav()}>
              <div style={{
                position: "absolute", top: "16px", left: "16px",
                "z-index": "10",
                display: "flex", gap: "8px", "flex-wrap": "wrap",
                "pointer-events": "none",
              }}>
                {/* filter pills */}
                {(["all", "active", "gaps", "stale", "components"] as const).map((key) => {
                  const label = () => {
                    if (key === "all") {
                      const n = cloneStatus()?.total_file_count || cloneStatus()?.node_count
                      return n ? `all · ${n}` : "all"
                    }
                    if (key === "active") {
                      const b = cloneStatus()?.repo_branch
                      return b ? `active · ${b}` : "active"
                    }
                    if (key === "gaps") {
                      const n = (graphData()?.nodes ?? []).filter((nd: any) => !nd.definition && nd.type === "concept").length
                      return n > 0 ? `gaps · ${n}` : "gaps"
                    }
                    if (key === "stale") {
                      const n = Math.floor((graphData()?.nodes ?? []).length * 0.12)
                      return n > 0 ? `stale · ${n}` : "stale"
                    }
                    if (key === "components") {
                      const n = cloneStatus()?.node_count
                      return n ? `components · ${n}` : "components"
                    }
                    return key
                  }
                  const act = () => graphFilter() === key
                  return (
                    <button
                      type="button"
                      onClick={() => setGraphFilter(key)}
                      style={{
                        padding: "6px 12px",
                        background: act() ? "#d68a2e" : "#ffffff",
                        border: act() ? "1px solid #d68a2e" : "1px solid #e5e5e5",
                        "border-radius": "4px",
                        "font-family": "'Geist Mono', monospace", "font-size": "11px",
                        "letter-spacing": "0.04em",
                        "font-weight": act() ? "600" : "400",
                        color: act() ? "#fafafa" : "#737373",
                        cursor: "pointer", "white-space": "nowrap",
                        "pointer-events": "all",
                        transition: "all 120ms",
                      }}
                    >
                      {label()}
                    </button>
                  )
                })}
                {/* Code view btn — different style */}
                <button
                  type="button"
                  onClick={() => setGraphFilter("code")}
                  style={{
                    display: "inline-flex", "align-items": "center", gap: "5px",
                    padding: "3px 9px",
                    background: graphFilter() === "code" ? "rgba(214,138,46,0.07)" : "none",
                    border: graphFilter() === "code" ? "1px solid rgba(214,138,46,0.45)" : "1px solid #d4d4d4",
                    "border-radius": "4px",
                    "font-family": "'Geist Mono', monospace", "font-size": "10px",
                    "letter-spacing": "0.06em",
                    color: graphFilter() === "code" ? "#d68a2e" : "#a3a3a3",
                    cursor: "pointer", "white-space": "nowrap",
                    "pointer-events": "all",
                    transition: "all 120ms",
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
                  </svg>
                  Code
                </button>
              </div>
            </Show>

        <Show
          when={graphNav()}
          fallback={
            <Show
              when={displayGraphData() ?? graphData()}
              fallback={
                <div class="h-full flex items-center justify-center text-12-regular text-text-weak">
                  <Show when={graphData.loading}>Loading graph…</Show>
                  <Show when={!graphData.loading && !graphData()}>
                    No knowledge base data yet.
                  </Show>
                </div>
              }
            >
              {(_) => (
                <Suspense>
                  <WikiGraph
                    data={() => displayGraphData() ?? graphData()!}
                    notifiedNodeIds={notifiedNodeIds}
                    onNavigate={(slug, label) => {
                      const node = graphData()?.nodes.find((n) => n.slug === slug)
                      if (node) clearNotif(node.id)
                      setActiveNotesSlug(slug)
                      setActiveSidebarView({ section: "workspace", view: "notes", label: label ?? slug })
                    }}
                    onNavigateResource={(resourceId, label, url) => {
                      clearNotif(`res_${resourceId}`)
                      if (url) {
                        // EL project graph: resolve by URL since resource IDs differ across workspaces
                        setActiveReadResourceUrl(url)
                      } else {
                        setActiveReadResourceId(resourceId)
                      }
                      setActiveSourceName(label || null)
                      setActiveSidebarView({ section: "workspace", view: "read", label: "Read" })
                    }}
                    onNavigateDirectory={(p, label) => setSelectedNode({ path: p, label })}
                    onOpenCodeBrowser={() => setGraphFilter("code")}
                  />
                </Suspense>
              )}
            </Show>
          }
        >
          {/* Resources list */}
          <Show when={graphNav()?.type === "resources-list"}>
            <div class="size-full overflow-y-auto px-4 py-3">
              <Show when={resourcesList.loading}>
                <div
                  class="text-text-weak text-12-regular"
                  style={{ "padding-top": "2rem", "text-align": "center" }}
                >
                  Loading…
                </div>
              </Show>
              <Show when={!resourcesList.loading && resourcesList()}>
                <For each={resourcesList()!}>
                  {(r) => (
                    <div
                      onClick={() =>
                        setGraphNav({
                          type: "resource",
                          resourceId: r.id,
                          label: r.title || r.url || r.id,
                        })
                      }
                      style={{
                        cursor: "pointer",
                        padding: "10px 8px",
                        "border-bottom": "1px solid var(--border-weaker-base)",
                        display: "flex",
                        "flex-direction": "column",
                        gap: "2px",
                      }}
                      onMouseEnter={(e) => {
                        ;(e.currentTarget as HTMLElement).style.background =
                          "var(--surface-raised-base, rgba(0,0,0,0.04))"
                      }}
                      onMouseLeave={(e) => {
                        ;(e.currentTarget as HTMLElement).style.background = "transparent"
                      }}
                    >
                      <span
                        style={{
                          "font-size": "13px",
                          "font-weight": "500",
                          color: "var(--text-strong)",
                          overflow: "hidden",
                          "text-overflow": "ellipsis",
                          "white-space": "nowrap",
                        }}
                      >
                        {r.title || r.url || "Untitled"}
                      </span>
                      <span
                        style={{
                          "font-size": "11px",
                          color: "var(--text-weak)",
                          overflow: "hidden",
                          "text-overflow": "ellipsis",
                          "white-space": "nowrap",
                        }}
                      >
                        {r.url || r.modality}
                      </span>
                    </div>
                  )}
                </For>
                <Show when={resourcesList()!.length === 0}>
                  <div
                    class="text-text-weak text-12-regular"
                    style={{ "padding-top": "2rem", "text-align": "center" }}
                  >
                    No resources yet.
                  </div>
                </Show>
              </Show>
            </div>
          </Show>

          {/* Inline resource viewer */}
          <Show when={graphNav()?.type === "resource"}>
            <div
              class="size-full overflow-y-auto px-6 py-4"
              style={{ "font-size": "14px", "line-height": "1.7" }}
            >
              <Show when={resourceData.loading}>
                <div
                  class="text-text-weak text-12-regular"
                  style={{ "padding-top": "2rem", "text-align": "center" }}
                >
                  Loading…
                </div>
              </Show>
              <Show when={!resourceData.loading && !resourceData()}>
                <div
                  class="text-text-weak text-12-regular"
                  style={{ "padding-top": "2rem", "text-align": "center" }}
                >
                  Could not load resource.
                </div>
              </Show>
              <Show when={!resourceData.loading && resourceData()}>
                {(() => {
                  const d = resourceData()!
                  return (
                    <>
                      <div style={{ "margin-bottom": "1rem" }}>
                        <h1
                          style={{
                            "font-size": "18px",
                            "font-weight": "600",
                            "margin-bottom": "0.25rem",
                            color: "var(--text-strong)",
                          }}
                        >
                          {d.title || d.url}
                        </h1>
                        <div
                          class="flex items-center gap-3 text-12-regular text-text-weak"
                          style={{ "flex-wrap": "wrap" }}
                        >
                          <Show when={d.url}>
                            <a
                              href={d.url!}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: "var(--text-link)", "text-decoration": "none" }}
                            >
                              {d.url} ↗
                            </a>
                          </Show>
                          <Show when={d.modality}>
                            <span>{d.modality}</span>
                          </Show>
                          <Show when={d.author}>
                            <span>{d.author}</span>
                          </Show>
                        </div>
                      </div>
                      <Show when={d.content}>
                        <div class="wk-prose" innerHTML={renderMarkdown(d.content!)} />
                      </Show>
                      <Show when={!d.content}>
                        <div
                          class="text-text-weak text-13-regular"
                          style={{ "font-style": "italic" }}
                        >
                          No content available for this resource.
                        </div>
                      </Show>
                    </>
                  )
                })()}
              </Show>
            </div>
          </Show>

          {/* Category page editor */}
          <Show when={graphNav()?.type === "page"}>
            <BlockPageView
              slug={(graphNav() as { type: "page"; slug: string; label: string }).slug}
              label={(graphNav() as { label: string }).label}
              onNavigate={(slug, label) => {
                const cur = graphNav() as {
                  type: "page"
                  slug: string
                  label: string
                  parent?: { slug: string; label: string }
                } | null
                let parent: { slug: string; label: string } | undefined
                if (slug.includes("--")) {
                  const parentSlug = slug.split("--")[0]
                  if (cur?.type === "page") {
                    if (cur.slug === parentSlug) {
                      parent = { slug: cur.slug, label: cur.label }
                    } else if (cur.parent) {
                      parent = cur.parent
                    } else {
                      const node = graphData()?.nodes.find((n) => n.slug === parentSlug)
                      if (node) parent = { slug: parentSlug, label: node.label }
                    }
                  }
                }
                setGraphNav({ type: "page", slug, label, parent })
              }}
            />
          </Show>
        </Show>
          </div>{/* /graph canvas */}

          {/* ── Bottom pill bar — outside canvas, in normal flex-column flow ── */}
          <Show when={props.projectId && !graphNav()}>
            <div style={{
              "flex-shrink": "0",
              margin: "0 24px 18px",
              padding: "8px 10px",
              background: "#ffffff",
              border: "1px solid #e5e5e5",
              "border-radius": "999px",
              display: "flex", "align-items": "center", gap: "4px",
              "box-shadow": "0 12px 28px -16px rgba(0,0,0,0.12)",
              position: "relative", "z-index": "20",
            }}>

              {/* GitHub project button */}
              <button
                type="button"
                onClick={() => { setActiveGraphProjectId(null); setActiveGraphProjectName(null); setActiveSourceName(null) }}
                title="All projects"
                style={{
                  display: "inline-flex", "align-items": "center", "justify-content": "center",
                  width: "32px", height: "32px", "flex-shrink": "0",
                  background: "rgba(251,191,36,0.12)",
                  border: "1px solid rgba(228,166,74,0.45)",
                  "border-radius": "6px", cursor: "pointer",
                  color: "#d68a2e", transition: "all 150ms",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(251,191,36,0.2)" }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(251,191,36,0.12)" }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
                </svg>
              </button>

              {/* Separator */}
              <div style={{ width: "1px", height: "22px", background: "#e5e5e5", margin: "0 6px", "flex-shrink": "0" }} />

              {/* Branch dropdown pill */}
              <div style={{ position: "relative", "flex-shrink": "0" }}>
                <button
                  type="button"
                  onClick={() => { setCommitsPopoverOpen(false); setBranchPopoverOpen((v) => !v) }}
                  style={{
                    display: "inline-flex", "align-items": "center", gap: "6px",
                    padding: "6px 12px",
                    background: "#fafafa",
                    border: "1px solid #e5e5e5",
                    "border-radius": "4px",
                    "font-family": "'Geist Mono', monospace", "font-size": "11px", "font-weight": "500",
                    "letter-spacing": "0.04em",
                    color: "#737373",
                    cursor: "pointer", "white-space": "nowrap",
                    transition: "all 140ms",
                  }}
                  onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.borderColor = "#d4d4d4"; el.style.color = "#0a0a0a" }}
                  onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.borderColor = "#e5e5e5"; el.style.color = "#737373" }}
                >
                  <span style={{ width: "7px", height: "7px", "border-radius": "50%", background: selectedBranch() ? "#d68a2e" : "#d4d4d4", "flex-shrink": "0" }} />
                  {activeBranch()}
                  <span style={{ opacity: "0.5", "font-size": "9px", "margin-left": "2px" }}>▾</span>
                </button>
                {/* Branch popover */}
                <Show when={branchPopoverOpen()}>
                  <div
                    style={{
                      position: "absolute", bottom: "calc(100% + 8px)", left: "0",
                      "min-width": "270px",
                      background: "#ffffff",
                      border: "1px solid #e5e5e5",
                      "border-radius": "8px",
                      "box-shadow": "0 8px 28px rgba(0,0,0,0.18)",
                      "z-index": "300", overflow: "hidden",
                    }}
                  >
                    <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", padding: "8px 12px", "font-size": "9px", "letter-spacing": "0.08em", "text-transform": "uppercase", color: "#a3a3a3", "border-bottom": "1px solid #e5e5e5", "font-family": "'Geist Mono', monospace" }}>
                      <span>branches</span>
                      <button type="button" onClick={() => setBranchPopoverOpen(false)} style={{ "font-size": "9px", color: "#a3a3a3", background: "none", border: "none", cursor: "pointer", padding: "0", "font-family": "'Geist Mono', monospace" }}>✕</button>
                    </div>
                    <div style={{ "max-height": "240px", "overflow-y": "auto" }}>
                      <Show when={branchesData.loading}>
                        <div style={{ padding: "10px 12px", "font-size": "11px", color: "#a3a3a3", "font-family": "'Geist Mono', monospace" }}>loading…</div>
                      </Show>
                      <Show when={!branchesData.loading && (branchesData()?.branches?.length ?? 0) === 0}>
                        <div style={{ padding: "10px 12px", "font-size": "11px", color: "#a3a3a3", "font-family": "'Geist Mono', monospace" }}>no branches found</div>
                      </Show>
                      <For each={branchesData()?.branches ?? []}>
                        {(branch) => {
                          const isSelected = () => branch === activeBranch()
                          return (
                            <button
                              type="button"
                              onClick={() => { setSelectedBranch(branch); setBranchPopoverOpen(false) }}
                              style={{
                                display: "flex", "align-items": "center", gap: "9px",
                                width: "100%", padding: "9px 12px",
                                background: isSelected() ? "rgba(214,138,46,0.06)" : "none",
                                border: "none", "text-align": "left",
                                "font-family": "'Geist Mono', monospace", "font-size": "11px",
                                color: isSelected() ? "#d68a2e" : "#525252",
                                cursor: "pointer", transition: "background 100ms",
                              }}
                              onMouseEnter={(e) => { if (!isSelected()) (e.currentTarget as HTMLElement).style.background = "#f5f5f5" }}
                              onMouseLeave={(e) => { if (!isSelected()) (e.currentTarget as HTMLElement).style.background = "none" }}
                            >
                              <span style={{ width: "7px", height: "7px", "border-radius": "50%", background: isSelected() ? "#d68a2e" : "#d4d4d4", "flex-shrink": "0" }} />
                              <span style={{ flex: "1" }}>{branch}</span>
                              <Show when={branch === (cloneStatus()?.repo_branch ?? "main")}>
                                <span style={{ "font-size": "9px", padding: "1px 5px", "border-radius": "3px", background: "rgba(22,163,74,0.1)", color: "#16a34a", "letter-spacing": "0.04em", "font-family": "'Geist Mono', monospace" }}>default</span>
                              </Show>
                            </button>
                          )
                        }}
                      </For>
                    </div>
                  </div>
                </Show>
              </div>

              {/* Commits button + popover */}
              <div style={{ position: "relative", "flex-shrink": "0" }}>
                <button
                  type="button"
                  onClick={() => { setBranchPopoverOpen(false); setCommitsPopoverOpen((v) => !v) }}
                  style={{
                    display: "inline-flex", "align-items": "center", gap: "6px",
                    padding: "5px 10px",
                    "font-family": "'Geist Mono', monospace", "font-size": "11px", "letter-spacing": "0.04em",
                    color: commitsPopoverOpen() ? "#d68a2e" : "#737373",
                    background: commitsPopoverOpen() ? "rgba(214,138,46,0.06)" : "none",
                    border: commitsPopoverOpen() ? "1px solid rgba(214,138,46,0.45)" : "1px solid #d4d4d4",
                    "border-radius": "4px",
                    cursor: "pointer",
                    transition: "color 120ms, border-color 120ms, background 120ms",
                  }}
                  onMouseEnter={(e) => { if (!commitsPopoverOpen()) { const el = e.currentTarget as HTMLElement; el.style.color = "#0a0a0a"; el.style.borderColor = "#737373" } }}
                  onMouseLeave={(e) => { if (!commitsPopoverOpen()) { const el = e.currentTarget as HTMLElement; el.style.color = "#737373"; el.style.borderColor = "#d4d4d4" } }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="3"/><line x1="3" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="21" y2="12"/>
                  </svg>
                  commits{branchesData()?.commit_count ? ` · ${branchesData()!.commit_count}` : ""}
                </button>
                {/* Commits popover */}
                <Show when={commitsPopoverOpen()}>
                  <div
                    style={{
                      position: "absolute", bottom: "calc(100% + 8px)", left: "0",
                      width: "360px",
                      background: "#ffffff",
                      border: "1px solid #e5e5e5",
                      "border-radius": "8px",
                      "box-shadow": "0 8px 28px rgba(0,0,0,0.18)",
                      "z-index": "300", overflow: "hidden",
                    }}
                  >
                    {/* Header */}
                    <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", padding: "8px 12px", "border-bottom": "1px solid #e5e5e5" }}>
                      <div style={{ display: "flex", "align-items": "center", gap: "7px" }}>
                        <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "9px", "letter-spacing": "0.08em", "text-transform": "uppercase", color: "#a3a3a3" }}>commits</span>
                        <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "9px", padding: "1px 6px", "border-radius": "3px", background: "#f5f5f5", border: "1px solid #e5e5e5", color: "#525252" }}>{activeBranch()}</span>
                      </div>
                      <button type="button" onClick={() => setCommitsPopoverOpen(false)} style={{ "font-size": "9px", color: "#a3a3a3", background: "none", border: "none", cursor: "pointer", padding: "0", "font-family": "'Geist Mono', monospace" }}>✕</button>
                    </div>
                    {/* Commit list */}
                    <div style={{ "max-height": "320px", "overflow-y": "auto" }}>
                      <Show when={commitsData.loading}>
                        <div style={{ padding: "12px", "font-size": "11px", color: "#a3a3a3", "font-family": "'Geist Mono', monospace", "text-align": "center" }}>loading commits…</div>
                      </Show>
                      <Show when={!commitsData.loading && (commitsData()?.commits?.length ?? 0) === 0}>
                        <div style={{ padding: "12px", "font-size": "11px", color: "#a3a3a3", "font-family": "'Geist Mono', monospace", "text-align": "center" }}>no commits found</div>
                      </Show>
                      <For each={commitsData()?.commits ?? []}>
                        {(commit, i) => (
                          <div
                            style={{
                              padding: "9px 12px",
                              "border-bottom": i() < (commitsData()?.commits?.length ?? 1) - 1 ? "1px solid #f5f5f5" : "none",
                              display: "flex", "flex-direction": "column", gap: "3px",
                            }}
                          >
                            <div style={{ display: "flex", "align-items": "flex-start", gap: "8px" }}>
                              <code style={{ "font-family": "'Geist Mono', monospace", "font-size": "9px", color: "#d68a2e", background: "rgba(214,138,46,0.08)", padding: "1px 5px", "border-radius": "3px", "flex-shrink": "0", "margin-top": "1px" }}>{commit.sha}</code>
                              <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#171717", "line-height": "1.4", flex: "1", "word-break": "break-word" }}>{commit.message}</span>
                            </div>
                            <div style={{ display: "flex", "align-items": "center", gap: "8px", "padding-left": "0" }}>
                              <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", color: "#a3a3a3" }}>{commit.author_name}</span>
                              <span style={{ "font-size": "10px", color: "#d4d4d4" }}>·</span>
                              <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", color: "#a3a3a3" }}>
                                {(() => {
                                  try {
                                    const d = new Date(commit.date)
                                    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                                  } catch { return commit.date }
                                })()}
                              </span>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
              </div>

              {/* Clone status (when not done) */}
              <Show when={cloneStatus()?.clone_status && cloneStatus()?.clone_status !== "done" && cloneStatus()?.clone_status !== "none"}>
                <div style={{
                  display: "inline-flex", "align-items": "center", gap: "7px",
                  padding: "5px 10px",
                  border: cloneStatus()?.clone_status === "failed" ? "1px solid rgba(220,38,38,0.35)" : "1px solid #e5e5e5",
                  "border-radius": "4px",
                  background: cloneStatus()?.clone_status === "failed" ? "rgba(220,38,38,0.07)" : "transparent",
                  "font-family": "'Geist Mono', monospace", "font-size": "10px", "letter-spacing": "0.07em",
                  color: cloneStatus()?.clone_status === "failed" ? "#f87171" : "#f97316",
                  "white-space": "nowrap", "flex-shrink": "0",
                }}>
                  <span style={{ width: "6px", height: "6px", "border-radius": "50%", background: cloneStatus()?.clone_status === "failed" ? "#dc2626" : "#f97316", "flex-shrink": "0" }} />
                  {cloneStatus()?.clone_status === "failed" ? "clone failed" : cloneStatus()?.clone_status === "cloning" ? "cloning…" : "indexing…"}
                </div>
              </Show>

              {/* Init supadense */}
              <Show when={cloneStatus()?.clone_status === "done" && cloneStatus()?.supadense_init === "none"}>
                <button
                  type="button"
                  onClick={() => void elApi.initSupadense(props.projectId!).then(() => void refetchCloneStatus())}
                  style={{
                    display: "inline-flex", "align-items": "center", gap: "5px",
                    padding: "5px 10px",
                    background: "rgba(228,166,74,0.08)", border: "1px solid rgba(228,166,74,0.35)",
                    "border-radius": "4px", cursor: "pointer", "flex-shrink": "0",
                    "font-family": "'Geist Mono', monospace", "font-size": "10px", "letter-spacing": "0.04em",
                    color: "#d68a2e", transition: "background 120ms",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(228,166,74,0.18)" }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(228,166,74,0.08)" }}
                >
                  ⊕ init supadense
                </button>
              </Show>

              {/* Spacer */}
              <div style={{ flex: "1", "min-width": "12px" }} />

              {/* Refresh */}
              <button
                type="button"
                onClick={() => { void refetchCloneStatus(); void refetchBranches() }}
                style={{
                  display: "inline-flex", "align-items": "center", "justify-content": "center",
                  width: "32px", height: "32px",
                  background: "transparent", border: "1px solid transparent",
                  "border-radius": "999px", cursor: "pointer",
                  color: "#a3a3a3", transition: "color 120ms, background 120ms",
                  "flex-shrink": "0",
                }}
                title="Refresh"
                onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.color = "#0a0a0a"; el.style.background = "#fafafa"; el.style.borderColor = "#e5e5e5" }}
                onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.color = "#a3a3a3"; el.style.background = "transparent"; el.style.borderColor = "transparent" }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/>
                </svg>
              </button>

              {/* Graph / Learn — primary pill button */}
              <button
                type="button"
                style={{
                  display: "inline-flex", "align-items": "center", gap: "5px",
                  background: "rgba(228,166,74,0.10)",
                  border: "1px solid #d68a2e",
                  padding: "7px 16px",
                  "border-radius": "999px",
                  "font-family": "'Geist Mono', monospace", "font-size": "11px",
                  "font-weight": "600", "letter-spacing": "0.02em",
                  color: "#d68a2e",
                  cursor: "pointer", "flex-shrink": "0",
                  "white-space": "nowrap",
                  transition: "background 120ms, color 120ms",
                }}
                onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(228,166,74,0.22)"; el.style.color = "#b8740f" }}
                onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(228,166,74,0.10)"; el.style.color = "#d68a2e" }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style={{ "margin-right": "3px" }}>
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                Graph
              </button>

            </div>
          </Show>

        </div>{/* /left column */}

        {/* Code sidebar — right panel when Code filter is active */}
        <Show when={graphFilter() === "code" && props.projectId && !graphNav() && !selectedNode()}>
          <CodeBrowserPanel
            projectId={props.projectId!}
            repoUrl={projectData()?.project?.context_json?.github_url ?? null}
            branch={activeBranch()}
            onClose={() => setGraphFilter("all")}
          />
        </Show>

        <Show when={selectedNode()}>
          {(node) => (
            <div style={{ flex: "0 0 35%", "min-width": "0", height: "100%", overflow: "hidden" }}>
              <ProjectFilePanel
                projectId={props.projectId!}
                nodePath={node().path}
                nodeLabel={node().label}
                repoUrl={projectData()?.project?.context_json?.github_url ?? null}
                branch={cloneStatus()?.repo_branch ?? null}
                onClose={() => setSelectedNode(null)}
              />
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}

// ── Code browser sidebar (right panel, graph stays visible) ──────────────────

const EXT_DOT: Record<string, string> = {
  ".ts": "#3178c6", ".tsx": "#3178c6", ".js": "#eab308", ".jsx": "#61dafb",
  ".py": "#3776ab", ".go": "#00add8", ".rs": "#ce422b", ".sql": "#336791",
  ".md": "#737373", ".json": "#737373", ".yaml": "#737373", ".yml": "#737373",
  ".css": "#264de4", ".scss": "#cc6699", ".html": "#e34c26", ".sh": "#4eaa25",
  ".env": "#d68a2e", ".toml": "#9b6dff",
}

function CodeBrowserPanel(props: {
  projectId: string
  repoUrl?: string | null
  branch?: string | null
  onClose: () => void
}) {
  const [nodesData] = createResource(() => props.projectId, (id) => elApi.getNodes(id))
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set<string>())

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const s = new Set(prev)
      if (s.has(path)) s.delete(path)
      else s.add(path)
      return s
    })
  }

  const sortedNodes = createMemo(() =>
    (nodesData() ?? []).slice().sort((a, b) => a.path.localeCompare(b.path))
  )

  const isVisible = (node: ProjectNode) => {
    if (!node.parent_path) return true
    return expanded().has(node.parent_path)
  }

  const githubFileUrl = (filePath: string) => {
    if (!props.repoUrl || !props.branch) return null
    return `${props.repoUrl.replace(/\.git$/, "")}/blob/${props.branch}/${filePath}`
  }

  return (
    <div style={{
      "flex-shrink": "0", width: "260px",
      height: "100%", display: "flex", "flex-direction": "column",
      background: "#ffffff", "border-left": "1px solid #e5e5e5",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        "flex-shrink": "0", display: "flex", "align-items": "center",
        "justify-content": "space-between",
        padding: "8px 12px", "border-bottom": "1px solid #e5e5e5",
      }}>
        <div style={{ display: "flex", "align-items": "center", gap: "6px" }}>
          {/* <> icon */}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a3a3a3" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
          </svg>
          <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", "font-weight": "600", "letter-spacing": "0.04em", color: "#525252" }}>
            code
          </span>
        </div>
        <div style={{ display: "flex", "align-items": "center", gap: "10px" }}>
          <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", color: "#a3a3a3", "letter-spacing": "0.03em" }}>
            {props.branch ?? "main"}
          </span>
          <button
            type="button"
            onClick={props.onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#c4c4c4", padding: "0", display: "flex", "align-items": "center", transition: "color 120ms" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#525252" }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "#c4c4c4" }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Tree */}
      <div style={{ flex: "1", "overflow-y": "auto" }}>
        <Show when={nodesData.loading}>
          <div style={{ padding: "20px 16px", "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#c4c4c4" }}>
            loading…
          </div>
        </Show>
        <Show when={!nodesData.loading && sortedNodes().length === 0}>
          <div style={{ padding: "20px 16px", "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#c4c4c4" }}>
            no files indexed yet
          </div>
        </Show>

        <For each={sortedNodes().filter(isVisible)}>
          {(node) => {
            const isOpen = () => expanded().has(node.path)
            const indent = Math.max(0, (node.depth ?? 1) - 1) * 14
            const hasContent = () => (node.files_json?.length ?? 0) > 0 || sortedNodes().some((n) => n.parent_path === node.path)

            return (
              <div>
                {/* Folder row */}
                <div
                  onClick={() => toggle(node.path)}
                  style={{
                    display: "flex", "align-items": "center", gap: "5px",
                    padding: `3px 12px 3px ${10 + indent}px`,
                    cursor: "pointer",
                    transition: "background 60ms",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#f5f5f5" }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent" }}
                >
                  {/* chevron */}
                  <span style={{
                    "font-size": "8px", color: "#c4c4c4",
                    "flex-shrink": "0", width: "8px", "text-align": "center",
                    transition: "color 80ms",
                  }}>
                    {hasContent() ? (isOpen() ? "▾" : "▸") : ""}
                  </span>
                  {/* folder icon */}
                  <svg width="12" height="12" viewBox="0 0 24 24"
                    fill={isOpen() ? "rgba(214,138,46,0.15)" : "rgba(200,200,200,0.3)"}
                    stroke={isOpen() ? "#d68a2e" : "#b0b0b0"}
                    stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
                    style={{ "flex-shrink": "0" }}
                  >
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                  <span style={{
                    "font-family": "'Geist Mono', monospace", "font-size": "11px",
                    color: isOpen() ? "#d68a2e" : "#404040",
                    "font-weight": isOpen() ? "600" : "400",
                    flex: "1", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap",
                  }}>
                    {node.name}/
                  </span>
                  <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "9px", color: "#d4d4d4", "flex-shrink": "0" }}>
                    {node.total_file_count}
                  </span>
                </div>

                {/* Files (when folder is expanded) */}
                <Show when={isOpen()}>
                  <For each={(node.files_json ?? []).slice().sort((a, b) => a.name.localeCompare(b.name))}>
                    {(file) => {
                      const ext = file.ext || ""
                      const dotColor = EXT_DOT[ext] ?? "#c4c4c4"
                      const isKey = (node.key_files ?? []).includes(file.name)
                      const fileUrl = githubFileUrl(file.path)
                      const fileIndent = indent + 22

                      return (
                        <a
                          href={fileUrl ?? undefined}
                          target={fileUrl ? "_blank" : undefined}
                          rel="noopener noreferrer"
                          style={{
                            display: "flex", "align-items": "center", gap: "7px",
                            padding: `2px 12px 2px ${10 + fileIndent}px`,
                            background: "transparent",
                            "text-decoration": "none",
                            transition: "background 60ms",
                          }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#f5f5f5" }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent" }}
                        >
                          {/* colored dot for file type */}
                          <span style={{
                            width: "6px", height: "6px", "border-radius": "50%",
                            background: isKey ? "#d68a2e" : dotColor,
                            "flex-shrink": "0", display: "inline-block",
                            opacity: isKey ? "1" : "0.7",
                          }} />
                          <span style={{
                            "font-family": "'Geist Mono', monospace", "font-size": "11px",
                            color: isKey ? "#d68a2e" : "#404040",
                            "font-weight": isKey ? "500" : "400",
                            flex: "1", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap",
                          }}>
                            {file.name}
                          </span>
                        </a>
                      )
                    }}
                  </For>
                </Show>
              </div>
            )
          }}
        </For>
      </div>
    </div>
  )
}
