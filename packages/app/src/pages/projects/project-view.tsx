import {
  createResource,
  createSignal,
  For,
  Match,
  Show,
  Switch,
  onCleanup,
  createEffect,
} from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/util/encode"
import { useServer } from "@/context/server"
import { elApi, type ElProject, type ElResource, type GraphNode, type GraphEdge } from "./el-api"
import { WikiGraph } from "@/pages/wiki/wiki-graph"
import type { GraphData } from "@/pages/wiki/wiki-api"

// ── Status helpers ────────────────────────────────────────────────────────────

const RESOURCE_STATUS_COLOR: Record<string, string> = {
  pending: "#94a3b8",
  processing: "#f59e0b",
  done: "#22c55e",
  failed: "#ef4444",
}

const RESOURCE_TYPE_ICON: Record<string, string> = {
  github: "⬡",
  arxiv: "📄",
  url: "🔗",
}

const PROJECT_STATUS_COLOR: Record<string, string> = {
  onboarding: "#f59e0b",
  active: "#22c55e",
  paused: "#94a3b8",
}

// ── Mini graph adapter ────────────────────────────────────────────────────────
// WikiGraph expects GraphData from wiki-api.ts — EL graph has a compatible shape
// with an extra "project" node type. We extend nodeRadius/nodeColor via the
// existing "category" type for the project node.

function elGraphToWikiGraph(nodes: GraphNode[], edges: GraphEdge[]): GraphData {
  return {
    nodes: nodes.map((n) => ({
      ...n,
      // Map "project" → "category" so WikiGraph renders it large + colored
      type: n.type === "project" ? "category" : n.type,
      color: n.type === "project" ? "#f59e0b" : undefined,
    })) as any,
    edges,
  }
}

// ── Resource status dot ───────────────────────────────────────────────────────

function StatusDot(props: { status: string }) {
  return (
    <div
      class="rounded-full shrink-0"
      style={{
        width: "6px",
        height: "6px",
        background: RESOURCE_STATUS_COLOR[props.status] ?? "#94a3b8",
        animation: props.status === "processing" ? "pulse 1.5s infinite" : "none",
      }}
    />
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ProjectView() {
  const params = useParams<{ id: string }>()
  const navigate = useNavigate()
  const server = useServer()

  const [addingUrl, setAddingUrl] = createSignal("")
  const [addError, setAddError] = createSignal("")
  const [addLoading, setAddLoading] = createSignal(false)
  const [openingSession, setOpeningSession] = createSignal(false)
  const [graphExpanded, setGraphExpanded] = createSignal(false)
  const [removeConfirm, setRemoveConfirm] = createSignal<string | null>(null)

  const [data, { refetch }] = createResource(
    () => params.id,
    (id) => elApi.getProject(id),
  )

  const [graph, { refetch: refetchGraph }] = createResource(
    () => params.id,
    (id) => elApi.getGraph(id),
  )

  const [sessions] = createResource(
    () => params.id,
    (id) => elApi.listSessions(id),
  )

  // Poll resources that are still processing
  let pollTimer: ReturnType<typeof setInterval> | undefined
  createEffect(() => {
    const resources = data()?.resources ?? []
    const anyProcessing = resources.some((r) => r.status === "processing" || r.status === "pending")
    if (anyProcessing && !pollTimer) {
      pollTimer = setInterval(() => { void refetch(); void refetchGraph() }, 3000)
    } else if (!anyProcessing && pollTimer) {
      clearInterval(pollTimer)
      pollTimer = undefined
    }
  })
  onCleanup(() => { if (pollTimer) clearInterval(pollTimer) })

  const project = () => data()?.project
  const resources = () => data()?.resources ?? []

  async function handleAddResource() {
    const url = addingUrl().trim()
    if (!url) return
    setAddError("")
    setAddLoading(true)
    try {
      await elApi.addResource(params.id, url)
      setAddingUrl("")
      void refetch()
      void refetchGraph()
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add resource")
    } finally {
      setAddLoading(false)
    }
  }

  async function handleRemoveResource(joinId: string) {
    await elApi.removeResource(params.id, joinId)
    setRemoveConfirm(null)
    void refetch()
    void refetchGraph()
  }

  async function openSession(sessionId?: string) {
    setOpeningSession(true)
    try {
      const { directory } = await elApi.provisionDirectory(params.id)
      server.projects.touch(directory)
      if (sessionId) {
        navigate(`/${base64Encode(directory)}/session/${sessionId}`)
      } else {
        navigate(`/${base64Encode(directory)}/session`)
      }
    } catch {
      setOpeningSession(false)
    }
  }

  const graphData = (): GraphData => {
    const g = graph()
    if (!g) return { nodes: [], edges: [] }
    return elGraphToWikiGraph(g.nodes, g.edges)
  }

  const panelStyle = {
    background: "var(--surface-raised-stronger-non-alpha)",
    "border-color": "var(--border-weak-base)",
  }

  return (
    <div class="size-full flex flex-col bg-background-base overflow-hidden">
      {/* Top bar */}
      <div
        class="flex items-center gap-3 px-5 py-3 border-b shrink-0"
        style={{ "border-color": "var(--border-weak-base)" }}
      >
        <button
          type="button"
          class="text-13-regular text-text-weak hover:text-text-base transition-colors flex items-center gap-1"
          onClick={() => navigate("/projects")}
        >
          ←
          <span>Projects</span>
        </button>
        <span class="text-text-dimmed">/</span>
        <Show when={project()} fallback={<div class="w-32 h-4 rounded animate-pulse" style={{ background: "var(--surface-base)" }} />}>
          {(p) => (
            <>
              <span class="text-14-medium text-text-strong">{p().name}</span>
              <div
                class="rounded-full px-2 py-0.5 text-11-medium"
                style={{
                  background: `${PROJECT_STATUS_COLOR[p().status]}22`,
                  color: PROJECT_STATUS_COLOR[p().status],
                  "font-size": "11px",
                }}
              >
                {p().status}
              </div>
            </>
          )}
        </Show>
      </div>

      {/* Body */}
      <div class="flex flex-1 min-h-0 overflow-hidden">
        {/* ── Left panel: resources + graph ── */}
        <div
          class="flex flex-col border-r shrink-0 overflow-hidden"
          style={{ width: "300px", "border-color": "var(--border-weak-base)" }}
        >
          {/* Resources section */}
          <div class="flex flex-col flex-1 min-h-0 overflow-y-auto">
            <div
              class="px-4 pt-4 pb-2 flex items-center justify-between shrink-0"
            >
              <span class="text-12-medium text-text-weak uppercase tracking-wide">Resources</span>
              <span class="text-11-regular text-text-dimmed">{resources().length}</span>
            </div>

            {/* Resource list */}
            <div class="px-3 flex flex-col gap-1">
              <Show when={data.loading}>
                <For each={[1, 2, 3]}>
                  {() => <div class="h-10 rounded-lg animate-pulse" style={{ background: "var(--surface-base)" }} />}
                </For>
              </Show>

              <For each={resources()}>
                {(res) => (
                  <div
                    class="group flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-surface-base transition-colors"
                    style={{ cursor: "default" }}
                  >
                    <span style={{ "font-size": "13px", opacity: "0.7", "flex-shrink": "0" }}>
                      {RESOURCE_TYPE_ICON[res.resource_type] ?? "🔗"}
                    </span>
                    <div class="flex-1 min-w-0">
                      <div class="text-12-medium text-text-base truncate">
                        {res.title ?? (res.url ? new URL(res.url).hostname.replace(/^www\./, "") : "Resource")}
                      </div>
                      <div class="flex items-center gap-1.5 mt-0.5">
                        <StatusDot status={res.status} />
                        <span class="text-10-regular text-text-dimmed capitalize">{res.status}</span>
                        <span class="text-10-regular text-text-dimmed opacity-50">·</span>
                        <span class="text-10-regular text-text-dimmed">{res.role}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      class="opacity-0 group-hover:opacity-100 transition-opacity text-text-weak hover:text-red-400 shrink-0"
                      style={{ "font-size": "14px", padding: "2px" }}
                      onClick={() => setRemoveConfirm(res.join_id)}
                      title="Remove resource"
                    >
                      ×
                    </button>
                  </div>
                )}
              </For>

              <Show when={!data.loading && resources().length === 0}>
                <div class="py-4 text-center">
                  <div class="text-12-regular text-text-dimmed">No resources yet</div>
                  <div class="text-11-regular text-text-dimmed mt-0.5">Add a GitHub repo or arxiv paper below</div>
                </div>
              </Show>
            </div>

            {/* Add resource */}
            <div class="px-3 pt-2 pb-3 shrink-0">
              <div class="flex gap-1">
                <input
                  class="flex-1 min-w-0 rounded-lg border border-border-base bg-background-input px-2 py-1.5 text-12-regular text-text-strong outline-none focus:border-border-focus placeholder:text-text-dimmed"
                  placeholder="github.com/… or arxiv.org/…"
                  value={addingUrl()}
                  onInput={(e) => { setAddingUrl(e.currentTarget.value); setAddError("") }}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleAddResource() }}
                  disabled={addLoading()}
                />
                <button
                  type="button"
                  class="px-2 py-1.5 rounded-lg text-12-medium text-white transition-colors shrink-0"
                  style={{ background: addLoading() ? "#94a3b8" : "#f59e0b" }}
                  onClick={handleAddResource}
                  disabled={addLoading()}
                >
                  {addLoading() ? "…" : "+"}
                </button>
              </div>
              <Show when={addError()}>
                <div class="text-11-regular text-red-400 mt-1 px-1">{addError()}</div>
              </Show>
            </div>
          </div>

          {/* Graph section */}
          <div
            class="border-t shrink-0"
            style={{ "border-color": "var(--border-weak-base)", height: graphExpanded() ? "340px" : "200px" }}
          >
            <div class="flex items-center justify-between px-4 py-2">
              <span class="text-12-medium text-text-weak uppercase tracking-wide">Graph</span>
              <div class="flex items-center gap-3">
                <button
                  type="button"
                  class="text-11-regular text-text-dimmed hover:text-text-base transition-colors"
                  onClick={() => navigate(`/projects/${params.id}/graph`)}
                >
                  full screen ↗
                </button>
                <button
                  type="button"
                  class="text-11-regular text-text-dimmed hover:text-text-base transition-colors"
                  onClick={() => setGraphExpanded((v) => !v)}
                >
                  {graphExpanded() ? "↓ collapse" : "↑ expand"}
                </button>
              </div>
            </div>
            <div style={{ height: "calc(100% - 36px)" }}>
              <Show
                when={(graph()?.nodes.length ?? 0) > 0}
                fallback={
                  <div class="size-full flex items-center justify-center">
                    <span class="text-11-regular text-text-dimmed">
                      {graph.loading ? "Loading…" : "No graph data yet"}
                    </span>
                  </div>
                }
              >
                <WikiGraph
                  data={graphData()}
                  onNavigate={() => {}}
                />
              </Show>
            </div>
          </div>
        </div>

        {/* ── Right panel: session launcher ── */}
        <div class="flex flex-col flex-1 min-w-0 overflow-hidden items-center justify-center gap-6 p-8">
          <Show when={!data.loading} fallback={
            <div class="w-8 h-8 rounded-full animate-spin border-2 border-border-base border-t-amber-400" />
          }>
            <div class="flex flex-col items-center gap-4 text-center max-w-sm">
              {/* Project icon */}
              <div
                class="rounded-2xl flex items-center justify-center"
                style={{
                  width: "64px",
                  height: "64px",
                  background: "rgba(245,158,11,0.12)",
                  border: "1px solid rgba(245,158,11,0.25)",
                }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="1.5">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                </svg>
              </div>

              <div>
                <div class="text-18-medium text-text-strong">{project()?.name ?? "Project"}</div>
                <div class="text-13-regular text-text-weak mt-1">
                  <Switch>
                    <Match when={project()?.status === "onboarding"}>
                      Start your first session — the AI will analyze your resources and guide you through onboarding questions.
                    </Match>
                    <Match when={project()?.status === "active"}>
                      Continue your learning session. Your resources and context are ready.
                    </Match>
                    <Match when={project()?.status === "paused"}>
                      Resume your project session where you left off.
                    </Match>
                  </Switch>
                </div>
              </div>

              {/* Resource summary */}
              <Show when={resources().length > 0}>
                <div
                  class="flex flex-wrap gap-2 justify-center"
                >
                  <For each={resources().slice(0, 4)}>
                    {(res) => (
                      <div
                        class="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-12-regular"
                        style={{
                          background: "var(--surface-base)",
                          color: "var(--text-weak)",
                          border: "1px solid var(--border-weak-base)",
                        }}
                      >
                        <StatusDot status={res.status} />
                        <span>
                          {res.title
                            ? res.title.split(" ").slice(0, 3).join(" ")
                            : res.url ? new URL(res.url).hostname.replace(/^www\./, "") : "Resource"
                          }
                        </span>
                      </div>
                    )}
                  </For>
                  <Show when={resources().length > 4}>
                    <div
                      class="px-2.5 py-1 rounded-full text-12-regular"
                      style={{ background: "var(--surface-base)", color: "var(--text-dimmed)" }}
                    >
                      +{resources().length - 4} more
                    </div>
                  </Show>
                </div>
              </Show>

              {/* Open session button */}
              <button
                type="button"
                class="px-6 py-2.5 rounded-xl text-14-medium text-white transition-all active:scale-[0.98]"
                style={{
                  background: openingSession() ? "#94a3b8" : "#f59e0b",
                  "box-shadow": openingSession() ? "none" : "0 2px 12px rgba(245,158,11,0.35)",
                }}
                onClick={() => openSession()}
                disabled={openingSession()}
              >
                {openingSession() ? "Opening…" : project()?.status === "onboarding" ? "Start Learning Session →" : "Open Session →"}
              </button>

              <Show when={project()?.status === "onboarding" && resources().length === 0}>
                <div class="text-12-regular text-text-dimmed">
                  Tip: add a GitHub repo or paper in the left panel first for a richer session.
                </div>
              </Show>
            </div>

            {/* Recent sessions */}
            <Show when={(sessions() ?? []).length > 0}>
              <div class="w-full max-w-sm mt-2">
                <p class="text-11-semibold text-text-weak uppercase tracking-wide mb-2">Recent Sessions</p>
                <div class="flex flex-col gap-1">
                  <For each={sessions()!.slice(0, 5)}>
                    {(s) => (
                      <button
                        type="button"
                        class="flex items-center justify-between w-full px-3 py-2 rounded-lg text-left transition-colors hover:bg-surface-raised-base-hover"
                        style={{ background: "var(--surface-base)" }}
                        onClick={() => openSession(s.id)}
                      >
                        <span class="text-12-regular text-text-base truncate max-w-[200px]">{s.title}</span>
                        <span class="text-11-regular text-text-dimmed shrink-0 ml-2">
                          {new Date(s.time_updated).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </Show>
        </div>
      </div>

      {/* Remove resource confirm */}
      <Show when={removeConfirm()}>
        {(joinId) => (
          <div
            class="fixed inset-0 z-50 flex items-center justify-center"
            onClick={(e) => { if (e.target === e.currentTarget) setRemoveConfirm(null) }}
          >
            <div class="rounded-xl shadow-lg border w-full max-w-xs mx-4 p-5 flex flex-col gap-4"
              style={{ background: "var(--surface-raised-stronger-non-alpha)", "border-color": "var(--border-weak-base)" }}
            >
              <div class="text-14-regular text-text-base">Remove this resource from the project?</div>
              <div class="flex justify-end gap-2">
                <button
                  type="button"
                  class="px-3 py-1.5 rounded-lg text-13-medium text-text-base hover:bg-surface-base transition-colors"
                  onClick={() => setRemoveConfirm(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  class="px-3 py-1.5 rounded-lg text-13-medium text-white bg-red-600 hover:bg-red-700 transition-colors"
                  onClick={() => void handleRemoveResource(joinId())}
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}
