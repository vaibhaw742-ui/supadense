import { createResource, createSignal, Show, For } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { elApi, type GraphNode, type GraphEdge } from "./el-api"
import { WikiGraph } from "@/pages/wiki/wiki-graph"
import type { GraphData } from "@/pages/wiki/wiki-api"

// ── EL → WikiGraph adapter ────────────────────────────────────────────────────

function elGraphToWikiGraph(nodes: GraphNode[], edges: GraphEdge[]): GraphData {
  return {
    nodes: nodes.map((n) => ({
      ...n,
      type: n.type === "project" ? "category" : n.type,
      color: n.type === "project" ? "#f59e0b" : undefined,
    })) as any,
    edges,
  }
}

// ── Legend item ───────────────────────────────────────────────────────────────

function LegendDot(props: { color: string; label: string }) {
  return (
    <div class="flex items-center gap-2">
      <div class="rounded-full shrink-0" style={{ width: "10px", height: "10px", background: props.color }} />
      <span class="text-11-regular text-text-weak">{props.label}</span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ProjectGraph() {
  const params = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [selectedNode, setSelectedNode] = createSignal<GraphNode | null>(null)

  const [projectData] = createResource(() => params.id, (id) => elApi.getProject(id))
  const [graphData] = createResource(() => params.id, (id) => elApi.getGraph(id))

  const wikiGraphData = () => {
    const g = graphData()
    if (!g) return null
    return elGraphToWikiGraph(g.nodes, g.edges)
  }

  const handleNodeClick = (slugOrId: string, label?: string) => {
    const g = graphData()
    if (!g) return
    const node = g.nodes.find((n) => n.id === slugOrId || n.id === `proj_${slugOrId}` || n.id === `concept_${slugOrId}`)
    if (node) setSelectedNode(node)
    else setSelectedNode({ id: slugOrId, type: "concept", label: label ?? slugOrId })
  }

  const handleResourceClick = (resourceId: string, label: string) => {
    const g = graphData()
    if (!g) return
    const node = g.nodes.find((n) => n.resource_id === resourceId || n.id === `res_${resourceId}`)
    if (node) setSelectedNode(node)
    else setSelectedNode({ id: resourceId, type: "resource", label, resource_id: resourceId })
  }

  const project = () => projectData()?.project

  return (
    <div class="h-dvh w-screen flex flex-col bg-background-base overflow-hidden">
      {/* Top bar */}
      <div class="h-12 flex items-center gap-3 px-4 border-b border-border-base shrink-0">
        <button
          type="button"
          class="flex items-center gap-1.5 text-12-regular text-text-weak hover:text-text-base transition-colors"
          onClick={() => navigate(`/projects/${params.id}`)}
        >
          <span>←</span>
          <span>{project()?.name ?? "Project"}</span>
        </button>
        <span class="text-text-weak select-none">/</span>
        <span class="text-12-regular text-text-base font-medium">Knowledge Graph</span>
        <div class="ml-auto flex items-center gap-4">
          <LegendDot color="#f59e0b" label="Project" />
          <LegendDot color="#6366f1" label="Resource" />
          <LegendDot color="#f59e0b" label="Concept" />
        </div>
      </div>

      {/* Body */}
      <div class="flex-1 flex overflow-hidden">
        {/* Graph canvas */}
        <div class="flex-1 relative">
          <Show when={wikiGraphData()} fallback={
            <div class="h-full flex items-center justify-center text-12-regular text-text-weak">
              {graphData.loading ? "Loading graph…" : "No nodes yet. Add resources to your project."}
            </div>
          }>
            {(gd) => (
              <WikiGraph
                data={gd()}
                onNavigate={handleNodeClick}
                onNavigateResource={handleResourceClick}
              />
            )}
          </Show>
        </div>

        {/* Node detail panel */}
        <Show when={selectedNode()}>
          {(node) => {
            const g = graphData()
            const edges = g?.edges ?? []
            const allNodes = g?.nodes ?? []
            const connected = allNodes.filter((n) =>
              edges.some((e) => (e.source === node().id && e.target === n.id) || (e.target === node().id && e.source === n.id))
            )

            return (
              <div class="w-72 border-l border-border-base flex flex-col overflow-hidden shrink-0">
                <div class="flex items-center justify-between px-4 py-3 border-b border-border-base">
                  <span class="text-12-semibold text-text-base">Node Detail</span>
                  <button
                    type="button"
                    class="text-12-regular text-text-weak hover:text-text-base"
                    onClick={() => setSelectedNode(null)}
                  >
                    ✕
                  </button>
                </div>

                <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                  <div>
                    <p class="text-14-semibold text-text-base">{node().label}</p>
                    <span class="inline-block mt-1 px-2 py-0.5 rounded text-11-regular bg-surface-raised-base text-text-weak capitalize">
                      {node().type}
                    </span>
                  </div>

                  <Show when={node().url}>
                    <div>
                      <p class="text-11-semibold text-text-weak mb-1 uppercase tracking-wide">URL</p>
                      <a
                        href={node().url}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-12-regular text-accent-base hover:underline break-all"
                      >
                        {node().url}
                      </a>
                    </div>
                  </Show>

                  <Show when={node().status}>
                    <div>
                      <p class="text-11-semibold text-text-weak mb-1 uppercase tracking-wide">Status</p>
                      <span class="text-12-regular text-text-base capitalize">{node().status}</span>
                    </div>
                  </Show>

                  <Show when={connected.length > 0}>
                    <div>
                      <p class="text-11-semibold text-text-weak mb-2 uppercase tracking-wide">
                        Connected ({connected.length})
                      </p>
                      <div class="flex flex-col gap-1">
                        <For each={connected}>
                          {(n) => (
                            <button
                              type="button"
                              class="flex items-center gap-2 text-left px-2 py-1.5 rounded hover:bg-surface-raised-base-hover transition-colors"
                              onClick={() => setSelectedNode(n)}
                            >
                              <span class="text-11-regular text-text-weak capitalize w-14 shrink-0">{n.type}</span>
                              <span class="text-12-regular text-text-base truncate">{n.label}</span>
                            </button>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                </div>
              </div>
            )
          }}
        </Show>
      </div>
    </div>
  )
}
