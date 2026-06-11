// workspace-graph.tsx — force-directed graph of all project tags
import { createResource, createEffect, onCleanup, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import * as d3 from "d3"
import { elApi } from "./el-api"
import { setActiveSidebarView } from "@/context/sidebar-view"

interface ProjectNode extends d3.SimulationNodeDatum {
  id:            string
  name:          string
  doc_count:     number
  last_activity: number
  color:         string
}

const COLORS = ["#f59e0b", "#10b981", "#6366f1", "#ec4899", "#3b82f6", "#f97316", "#14b8a6", "#8b5cf6"]

export default function WorkspaceGraph() {
  const navigate = useNavigate()
  let container!: HTMLDivElement
  let simRef: d3.Simulation<ProjectNode, undefined> | null = null

  const [projects]   = createResource(() => elApi.listLocalProjects())
  const [allSources] = createResource(() => elApi.listAllLocalSources())

  createEffect(() => {
    const projs   = projects()
    const sources = allSources()
    if (!projs || !sources) return

    const docCount     = new Map<string, number>()
    const lastActivity = new Map<string, number>()
    for (const s of sources) {
      docCount.set(s.project_id, (docCount.get(s.project_id) ?? 0) + 1)
      const prev = lastActivity.get(s.project_id) ?? 0
      if (s.time_created > prev) lastActivity.set(s.project_id, s.time_created)
    }

    const nodes: ProjectNode[] = projs.map((p, i) => ({
      id:            p.id,
      name:          p.name,
      doc_count:     docCount.get(p.id) ?? 0,
      last_activity: lastActivity.get(p.id) ?? (p.time_created ?? 0),
      color:         COLORS[i % COLORS.length],
    }))

    // Retry until container has real dimensions
    const tryDraw = () => {
      if (!container) return
      const rect = container.getBoundingClientRect()
      if (rect.width < 10 || rect.height < 10) { requestAnimationFrame(tryDraw); return }
      drawGraph(nodes, rect.width, rect.height)
    }
    requestAnimationFrame(tryDraw)
  })

  function drawGraph(nodes: ProjectNode[], w: number, h: number) {
    simRef?.stop()
    d3.select(container).selectAll("*").remove()
    if (nodes.length === 0) return

    // Small nodes like the wiki graph — radius ~14-22px based on doc count
    const radius = (n: ProjectNode) => Math.max(14, Math.min(28, 14 + n.doc_count * 2))

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

    const sim = d3.forceSimulation<ProjectNode>(nodes)
      .force("charge",  d3.forceManyBody<ProjectNode>().strength(-200))
      .force("center",  d3.forceCenter(w / 2, h / 2))
      .force("collide", d3.forceCollide<ProjectNode>((n) => radius(n) + 40).strength(0.8))
      .alphaDecay(0.02)
    simRef = sim

    const node = g.selectAll<SVGGElement, ProjectNode>("g.node")
      .data(nodes, (d) => d.id)
      .join("g")
      .attr("class", "node")
      .style("cursor", "pointer")
      .call(
        d3.drag<SVGGElement, ProjectNode>()
          .on("start", (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y })
          .on("drag",  (e, d) => { d.fx = e.x; d.fy = e.y })
          .on("end",   (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null })
      )
      .on("click", (_, d) => {
        setActiveSidebarView({ section: "workspace", view: "project", label: d.name })
        navigate(`/local-projects/${d.id}`)
      })

    // Main circle — small, light fill, coloured stroke
    node.append("circle")
      .attr("r", radius)
      .attr("fill", (d) => d.color)
      .attr("fill-opacity", 0.15)
      .attr("stroke", (d) => d.color)
      .attr("stroke-width", 2)

    // Name label to the right of the node
    node.append("text")
      .attr("text-anchor", "start")
      .attr("dominant-baseline", "central")
      .attr("x", (d) => radius(d) + 6)
      .attr("fill", (d) => d.color)
      .attr("font-size", "12px")
      .attr("font-weight", "500")
      .attr("font-family", "inherit")
      .attr("pointer-events", "none")
      .text((d) => d.name)

    sim.on("tick", () => node.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`))

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
        <Show when={projects.loading || allSources.loading}>
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
