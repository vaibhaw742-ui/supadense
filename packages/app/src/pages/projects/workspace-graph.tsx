// workspace-graph.tsx — force-directed graph of all project tags
// Each node = a registered local project, sized by doc count, click → project view

import { createResource, createEffect, onCleanup, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import * as d3 from "d3"
import { elApi } from "./el-api"
import { setActiveSidebarView } from "@/context/sidebar-view"

interface ProjectNode extends d3.SimulationNodeDatum {
  id:         string
  name:       string
  doc_count:  number
  last_activity: number
  color:      string
}

// Amber palette cycling per project
const COLORS = ["#f59e0b", "#10b981", "#6366f1", "#ec4899", "#3b82f6", "#f97316", "#14b8a6", "#8b5cf6"]

export default function WorkspaceGraph() {
  const navigate  = useNavigate()
  let container!: HTMLDivElement

  const [projects] = createResource(() => elApi.listLocalProjects())
  const [allSources] = createResource(() => elApi.listAllLocalSources())

  createEffect(() => {
    const projs   = projects()
    const sources = allSources()
    if (!projs || !sources) return

    // Count docs per project
    const docCount = new Map<string, number>()
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

    drawGraph(nodes)
  })

  function drawGraph(nodes: ProjectNode[]) {
    d3.select(container).selectAll("*").remove()
    if (nodes.length === 0) return

    const w = container.clientWidth  || 800
    const h = container.clientHeight || 600

    const radius = (n: ProjectNode) => Math.max(28, Math.min(64, 28 + n.doc_count * 6))

    const svg = d3.select(container)
      .append("svg")
      .attr("width", "100%")
      .attr("height", "100%")
      .attr("viewBox", `0 0 ${w} ${h}`)
      .style("cursor", "grab")

    const g = svg.append("g")

    // Zoom + pan
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on("start", () => svg.style("cursor", "grabbing"))
      .on("zoom",  (e) => g.attr("transform", e.transform.toString()))
      .on("end",   () => svg.style("cursor", "grab"))
    svg.call(zoom)

    // Simulation — no edges needed, just spread them nicely
    const sim = d3.forceSimulation<ProjectNode>(nodes)
      .force("charge",  d3.forceManyBody<ProjectNode>().strength(-300))
      .force("center",  d3.forceCenter(w / 2, h / 2))
      .force("collide", d3.forceCollide<ProjectNode>((n) => radius(n) + 20))
      .alphaDecay(0.03)

    // Node groups
    const node = g.selectAll<SVGGElement, ProjectNode>("g.node")
      .data(nodes)
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

    // Outer glow ring
    node.append("circle")
      .attr("r", (d) => radius(d) + 6)
      .attr("fill", "none")
      .attr("stroke", (d) => d.color)
      .attr("stroke-width", 1)
      .attr("opacity", 0.25)

    // Main circle
    node.append("circle")
      .attr("r", radius)
      .attr("fill", (d) => d.color)
      .attr("fill-opacity", 0.15)
      .attr("stroke", (d) => d.color)
      .attr("stroke-width", 2)

    // Project initial (large letter)
    node.append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("dy", "-6")
      .attr("fill", (d) => d.color)
      .attr("font-size", (d) => radius(d) * 0.7)
      .attr("font-weight", "700")
      .attr("font-family", "inherit")
      .attr("pointer-events", "none")
      .text((d) => d.name.charAt(0).toUpperCase())

    // Doc count badge
    node.append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("dy", (d) => radius(d) * 0.4)
      .attr("fill", (d) => d.color)
      .attr("font-size", "10")
      .attr("font-family", "'Geist Mono', monospace")
      .attr("opacity", 0.8)
      .attr("pointer-events", "none")
      .text((d) => `${d.doc_count} doc${d.doc_count !== 1 ? "s" : ""}`)

    // Project name label below node
    node.append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "hanging")
      .attr("dy", (d) => radius(d) + 10)
      .attr("fill", "#374151")
      .attr("font-size", "12")
      .attr("font-weight", "600")
      .attr("font-family", "inherit")
      .attr("pointer-events", "none")
      .text((d) => d.name)

    // Tick
    sim.on("tick", () => {
      node.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })

    // Auto-fit after settling
    setTimeout(() => {
      const pad = 80
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      nodes.forEach((n) => {
        const r = radius(n)
        x0 = Math.min(x0, (n.x ?? 0) - r); y0 = Math.min(y0, (n.y ?? 0) - r)
        x1 = Math.max(x1, (n.x ?? 0) + r); y1 = Math.max(y1, (n.y ?? 0) + r)
      })
      const bw = x1 - x0 + pad * 2, bh = y1 - y0 + pad * 2
      const s  = Math.min(w / bw, h / bh, 1.5)
      const tx = (w - s * (x0 + x1)) / 2
      const ty = (h - s * (y0 + y1)) / 2
      svg.transition().duration(600).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(s))
    }, 1200)

    onCleanup(() => sim.stop())
  }

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", "flex-direction": "column", background: "#fafafa" }}>
      {/* Header */}
      <div style={{ padding: "16px 24px 12px", "border-bottom": "1px solid #f3f4f6", "flex-shrink": "0", display: "flex", "align-items": "center", gap: "10px" }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/>
          <circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>
          <line x1="10" y1="10" x2="7" y2="7"/><line x1="14" y1="10" x2="17" y2="7"/>
          <line x1="10" y1="14" x2="7" y2="17"/><line x1="14" y1="14" x2="17" y2="17"/>
        </svg>
        <span style={{ "font-size": "13px", "font-weight": "600", color: "#111827" }}>Project Graph</span>
        <span style={{ "font-size": "11px", color: "#9ca3af", "font-family": "'Geist Mono', monospace", "margin-left": "4px" }}>
          {projects.loading ? "…" : `${projects()?.length ?? 0} projects`}
        </span>
      </div>

      {/* Graph canvas */}
      <div style={{ flex: "1", position: "relative", overflow: "hidden" }}>
        <Show when={projects.loading || allSources.loading}>
          <div style={{ position: "absolute", inset: "0", display: "flex", "align-items": "center", "justify-content": "center" }}>
            <span style={{ "font-size": "13px", color: "#9ca3af", "font-family": "'Geist Mono', monospace" }}>Loading…</span>
          </div>
        </Show>
        <Show when={!projects.loading && (projects()?.length ?? 0) === 0}>
          <div style={{ position: "absolute", inset: "0", display: "flex", "flex-direction": "column", "align-items": "center", "justify-content": "center", gap: "8px" }}>
            <span style={{ "font-size": "14px", color: "#6b7280" }}>No projects yet</span>
            <span style={{ "font-size": "12px", color: "#9ca3af", "font-family": "'Geist Mono', monospace" }}>Run <code style={{ background: "#f3f4f6", padding: "1px 6px", "border-radius": "3px" }}>supadense init</code> in your project directory</span>
          </div>
        </Show>
        <div ref={container} style={{ width: "100%", height: "100%" }} />
      </div>
    </div>
  )
}
