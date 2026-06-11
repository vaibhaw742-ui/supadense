// workspace-graph.tsx — force-directed graph of all project tags + their nodes
import { createResource, createEffect, onCleanup, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import * as d3 from "d3"
import { elApi } from "./el-api"
import { setActiveSidebarView } from "@/context/sidebar-view"

interface GraphNode extends d3.SimulationNodeDatum {
  id:        string
  label:     string
  type:      string   // "project" | "category" | "source" | "brain"
  projectId: string
  color:     string
}
interface GraphEdge {
  source: string | GraphNode
  target: string | GraphNode
}

const COLORS = ["#f59e0b", "#10b981", "#6366f1", "#ec4899", "#3b82f6", "#f97316", "#14b8a6", "#8b5cf6"]

export default function WorkspaceGraph() {
  const navigate  = useNavigate()
  let container!: HTMLDivElement
  let simRef: d3.Simulation<GraphNode, GraphEdge> | null = null

  const [projects] = createResource(() => elApi.listLocalProjects())

  // Once projects load, fetch each project's graph and merge
  const [graphData] = createResource(
    () => projects(),
    async (projs) => {
      if (!projs?.length) return { nodes: [] as GraphNode[], edges: [] as GraphEdge[] }
      const allNodes: GraphNode[] = []
      const allEdges: GraphEdge[] = []
      const seen = new Set<string>()

      await Promise.all(projs.map(async (p, i) => {
        const color = COLORS[i % COLORS.length]
        const g = await elApi.getLocalProjectGraph(p.id)
        for (const n of g.nodes) {
          if (seen.has(n.id)) continue
          seen.add(n.id)
          allNodes.push({ id: n.id, label: n.label, type: n.type, projectId: p.id, color })
        }
        for (const e of g.edges) {
          allEdges.push({ source: e.source, target: e.target })
        }
      }))
      return { nodes: allNodes, edges: allEdges }
    }
  )

  createEffect(() => {
    const data = graphData()
    if (!data || data.nodes.length === 0) return

    const tryDraw = () => {
      if (!container) return
      const rect = container.getBoundingClientRect()
      if (rect.width < 10 || rect.height < 10) { requestAnimationFrame(tryDraw); return }
      drawGraph(data.nodes, data.edges, rect.width, rect.height)
    }
    requestAnimationFrame(tryDraw)
  })

  function drawGraph(nodes: GraphNode[], edges: GraphEdge[], w: number, h: number) {
    simRef?.stop()
    d3.select(container).selectAll("*").remove()
    if (nodes.length === 0) return

    const nodeRadius = (n: GraphNode) =>
      n.type === "project" ? 20 : n.type === "category" ? 14 : 10

    const svg = d3.select(container)
      .append("svg")
      .attr("width", "100%").attr("height", "100%")
      .attr("viewBox", `0 0 ${w} ${h}`)
      .style("cursor", "grab")

    const g = svg.append("g")

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 5])
      .on("start", () => svg.style("cursor", "grabbing"))
      .on("zoom",  (e) => g.attr("transform", e.transform.toString()))
      .on("end",   () => svg.style("cursor", "grab"))
    svg.call(zoom)

    const nodeById = new Map(nodes.map(n => [n.id, n]))

    const sim = d3.forceSimulation<GraphNode>(nodes)
      .force("link", d3.forceLink<GraphNode, GraphEdge>(edges)
        .id((d) => d.id).distance(80).strength(0.6))
      .force("charge", d3.forceManyBody<GraphNode>().strength(-180))
      .force("center", d3.forceCenter(w / 2, h / 2))
      .force("collide", d3.forceCollide<GraphNode>((n) => nodeRadius(n) + 20).strength(0.8))
      .alphaDecay(0.02)
    simRef = sim as any

    // Edges
    const link = g.append("g")
      .selectAll<SVGLineElement, GraphEdge>("line")
      .data(edges)
      .join("line")
      .attr("stroke", "#e5e7eb")
      .attr("stroke-width", 1.5)

    // Node groups
    const node = g.selectAll<SVGGElement, GraphNode>("g.node")
      .data(nodes, (d) => d.id)
      .join("g")
      .attr("class", "node")
      .style("cursor", (d) => d.type === "project" ? "pointer" : "default")
      .call(
        d3.drag<SVGGElement, GraphNode>()
          .on("start", (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y })
          .on("drag",  (e, d) => { d.fx = e.x; d.fy = e.y })
          .on("end",   (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null })
      )
      .on("click", (_, d) => {
        if (d.type !== "project") return
        setActiveSidebarView({ section: "workspace", view: "project", label: d.label })
        navigate(`/local-projects/${d.projectId}`)
      })

    // Circle
    node.append("circle")
      .attr("r", nodeRadius)
      .attr("fill", (d) => d.color)
      .attr("fill-opacity", (d) => d.type === "project" ? 0.15 : 0.1)
      .attr("stroke", (d) => d.color)
      .attr("stroke-width", (d) => d.type === "project" ? 2.5 : 1.5)

    // Label to the right
    node.append("text")
      .attr("text-anchor", "start")
      .attr("dominant-baseline", "central")
      .attr("x", (d) => nodeRadius(d) + 5)
      .attr("fill", (d) => d.type === "project" ? d.color : "#6b7280")
      .attr("font-size", (d) => d.type === "project" ? "12px" : "10px")
      .attr("font-weight", (d) => d.type === "project" ? "600" : "400")
      .attr("font-family", "inherit")
      .attr("pointer-events", "none")
      .text((d) => d.label)

    sim.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as GraphNode).x ?? 0)
        .attr("y1", (d) => (d.source as GraphNode).y ?? 0)
        .attr("x2", (d) => (d.target as GraphNode).x ?? 0)
        .attr("y2", (d) => (d.target as GraphNode).y ?? 0)
      node.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })

    onCleanup(() => { sim.stop() })
  }

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", "flex-direction": "column", background: "#ffffff" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px 12px", "border-bottom": "1px solid #f3f4f6", "flex-shrink": "0", display: "flex", "align-items": "center", gap: "8px" }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/>
          <circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>
          <line x1="10" y1="10" x2="7" y2="7"/><line x1="14" y1="10" x2="17" y2="7"/>
          <line x1="10" y1="14" x2="7" y2="17"/><line x1="14" y1="14" x2="17" y2="17"/>
        </svg>
        <span style={{ "font-size": "13px", "font-weight": "600", color: "#111827" }}>Project Graph</span>
        <Show when={!projects.loading}>
          <span style={{ "font-size": "11px", color: "#9ca3af", "font-family": "'Geist Mono', monospace", "margin-left": "4px" }}>
            {projects()?.length ?? 0} project{(projects()?.length ?? 0) !== 1 ? "s" : ""}
          </span>
        </Show>
      </div>

      {/* Canvas */}
      <div style={{ flex: "1", position: "relative", overflow: "hidden" }}>
        <Show when={projects.loading || graphData.loading}>
          <div style={{ position: "absolute", inset: "0", display: "flex", "align-items": "center", "justify-content": "center" }}>
            <span style={{ "font-size": "13px", color: "#9ca3af", "font-family": "'Geist Mono', monospace" }}>Loading…</span>
          </div>
        </Show>
        <Show when={!projects.loading && (projects()?.length ?? 0) === 0}>
          <div style={{ position: "absolute", inset: "0", display: "flex", "flex-direction": "column", "align-items": "center", "justify-content": "center", gap: "10px" }}>
            <span style={{ "font-size": "14px", color: "#6b7280" }}>No projects yet</span>
            <code style={{ "font-size": "12px", color: "#9ca3af", "font-family": "'Geist Mono', monospace", background: "#f3f4f6", padding: "3px 10px", "border-radius": "4px" }}>supadense init</code>
          </div>
        </Show>
        <div ref={container} style={{ width: "100%", height: "100%" }} />
      </div>
    </div>
  )
}
