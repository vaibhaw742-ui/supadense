/**
 * wiki-graph.tsx — D3 force-directed graph for resources.
 *
 * Resource nodes: fixed amber color, status badge (✓ / ✗ / ⟳) on top-right corner.
 */
import { onCleanup, createEffect } from "solid-js"
import * as d3 from "d3"
import type { GraphData, GraphNode } from "./wiki-api"

interface WikiGraphProps {
  data: () => GraphData
  notifiedNodeIds?: () => Set<string>
  onNavigate: (slug: string, label?: string) => void
  onNavigateResource: (resourceId: string, label: string, url?: string) => void
  onNavigateDirectory?: (path: string, label: string) => void
  onOpenCodeBrowser?: () => void
}

const RESOURCE_COLOR = "#f59e0b"
const RESOURCE_R = 8
const DIRECTORY_COLOR = "#0a0a0a"
const PROJECT_COLOR = "#d68a2e"
const GITHUB_R = 24

function nodeRadius(node: GraphNode): number {
  if (node.type === "github") return GITHUB_R
  if (node.type === "project") return 16
  if (node.type === "directory") {
    const files = (node as any).total_file_count ?? 0
    return Math.max(6, Math.min(24, 6 + Math.sqrt(files) * 1.5))
  }
  return RESOURCE_R
}

function statusBadge(status?: string): { color: string; type: "done" | "failed" | "processing" } | null {
  switch (status) {
    case "done":        return { color: "#22c55e", type: "done" }
    case "failed":      return { color: "#ef4444", type: "failed" }
    case "processing":
    case "pending":     return { color: "#f97316", type: "processing" }
    default:            return null
  }
}

// SVG path data for each status icon, drawn inside a ~5px-radius circle (coords centered at 0,0)
const STATUS_PATHS: Record<string, string> = {
  // checkmark ✓
  done:       "M-2.2,0.1 L-0.6,2.0 L2.4,-1.8",
  // × cross
  failed:     "M-1.8,-1.8 L1.8,1.8 M1.8,-1.8 L-1.8,1.8",
  // rotating dash for processing (animated via CSS)
  processing: "M-2.0,0 L2.0,0",
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s
}

export function WikiGraph(props: WikiGraphProps) {
  let container!: HTMLDivElement
  let fitFn: (() => void) | null = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let nodeSelRef: d3.Selection<SVGGElement, any, SVGGElement, unknown> | null = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let linkSelRef: d3.Selection<SVGLineElement, any, SVGGElement, unknown> | null = null

  const updateDots = () => {
    if (!nodeSelRef) return
    nodeSelRef.selectAll(".notif-dot").remove()
    const ids = props.notifiedNodeIds?.() ?? new Set<string>()
    if (ids.size === 0) return
    nodeSelRef.filter((d: GraphNode) => ids.has(d.id))
      .append("circle")
      .attr("class", "notif-dot")
      .attr("r", 4)
      .attr("cx", (d: GraphNode) => nodeRadius(d) - 1)
      .attr("cy", (d: GraphNode) => -(nodeRadius(d) - 1))
      .attr("fill", "#22c55e")
      .attr("stroke", "#1a1a1a")
      .attr("stroke-width", 1.5)
      .attr("pointer-events", "none")
  }

  createEffect(() => {
    props.notifiedNodeIds?.()
    updateDots()
  })

  createEffect(() => {
    const { nodes: rawNodes, edges: rawEdges } = props.data()
    // Clear previous render when data changes
    d3.select(container).selectAll("*").remove()
    fitFn = null
    nodeSelRef = null
    linkSelRef = null
    if (rawNodes.length === 0) return

    type SimNode = GraphNode & d3.SimulationNodeDatum
    type SimLink = { source: string | SimNode; target: string | SimNode }

    const nodes: SimNode[] = rawNodes.map((n) => ({ ...n }))
    const links: SimLink[] = rawEdges.map((e) => ({ source: e.source, target: e.target }))

    const width  = container.clientWidth  || 600
    const height = container.clientHeight || 500

    // ── SVG setup ─────────────────────────────────────────────────────────────
    const svg = d3.select(container)
      .append("svg")
      .attr("width", "100%")
      .attr("height", "100%")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .style("cursor", "grab")

    const g = svg.append("g")

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 6])
      .on("zoom", (event) => {
        g.attr("transform", event.transform)
        svg.style("cursor", "grabbing")
      })
      .on("end", () => svg.style("cursor", "grab"))

    svg.call(zoom)

    fitFn = () => {
      const visibleNodes = nodes.filter((n) => n.x != null && n.y != null)
      if (visibleNodes.length === 0) return
      const pad = 48
      const xs = visibleNodes.map((n) => n.x!)
      const ys = visibleNodes.map((n) => n.y!)
      const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad
      const y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad
      const scale = Math.min(1, Math.min(width / (x1 - x0), height / (y1 - y0)))
      const tx = width / 2 - scale * ((x0 + x1) / 2)
      const ty = height / 2 - scale * ((y0 + y1) / 2)
      svg.transition().duration(400).call(
        zoom.transform,
        d3.zoomIdentity.translate(tx, ty).scale(scale),
      )
    }

    // ── Force simulation ──────────────────────────────────────────────────────
    const sim = d3.forceSimulation<SimNode>(nodes)
      .force("link", d3.forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        .distance((l) => {
          const s = l.source as SimNode
          const t = l.target as SimNode
          if (s.type === "project" || t.type === "project") return 140
          if (s.type === "directory" || t.type === "directory") return 90
          return 80
        })
        .strength(0.5)
      )
      .force("charge", d3.forceManyBody<SimNode>().strength((d) => {
        if (d.type === "github") return -500
        if (d.type === "project") return -400
        if (d.type === "directory") return -200
        return -120
      }))
      .force("center", d3.forceCenter(width / 2, height / 2).strength(0.06))
      .force("collision", d3.forceCollide<SimNode>().radius((d) =>
        nodeRadius(d) + (d.type === "project" ? 16 : 8)
      ))

    // ── Edges ─────────────────────────────────────────────────────────────────
    const linkSel = g.append("g").attr("class", "g-links")
      .selectAll<SVGLineElement, SimLink>("line")
      .data(links)
      .join("line")
      .attr("stroke", "rgba(255,255,255,0.12)")
      .attr("stroke-width", 1.2)
      .attr("stroke-opacity", 1)

    linkSelRef = linkSel

    // ── Node groups ───────────────────────────────────────────────────────────
    const nodeSel = g.append("g").attr("class", "g-nodes")
      .selectAll<SVGGElement, SimNode>("g")
      .data(nodes)
      .join("g")
      .style("cursor", "pointer")

    // Drag
    nodeSel.call(
      d3.drag<SVGGElement, SimNode>()
        .on("start", (event, d) => {
          if (!event.active) sim.alphaTarget(0.3).restart()
          d.fx = d.x; d.fy = d.y
        })
        .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y })
        .on("end", (event, d) => {
          if (!event.active) sim.alphaTarget(0)
          d.fx = null; d.fy = null
        })
    )

    // Main circle
    nodeSel.append("circle")
      .attr("r", (d) => nodeRadius(d))
      .attr("fill", (d) => {
        if (d.type === "github") return "rgba(10,10,10,0.92)"
        if (d.type === "project") return "rgba(214,138,46,0.15)"
        if (d.type === "directory") return "rgba(10,10,10,0.08)"
        return `${RESOURCE_COLOR}33`
      })
      .attr("stroke", (d) => {
        if (d.type === "github") return "#d68a2e"
        if (d.type === "project") return "#d68a2e"
        if (d.type === "directory") return "#737373"
        return RESOURCE_COLOR
      })
      .attr("stroke-width", (d) => {
        if (d.type === "github") return 2.5
        if (d.type === "project") return 2
        return 1.5
      })

    // GitHub node: outer glow ring
    nodeSel.filter((d) => d.type === "github")
      .append("circle")
      .attr("r", GITHUB_R + 5)
      .attr("fill", "none")
      .attr("stroke", "rgba(214,138,46,0.25)")
      .attr("stroke-width", 1.5)
      .attr("pointer-events", "none")

    // GitHub node: <> code brackets inside
    nodeSel.filter((d) => d.type === "github")
      .append("text")
      .text("</>")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("font-size", 11)
      .attr("font-weight", "700")
      .attr("font-family", "'Geist Mono', monospace")
      .attr("fill", "#d68a2e")
      .attr("pointer-events", "none")

    // GitHub node: label below
    nodeSel.filter((d) => d.type === "github")
      .append("text")
      .text((d) => truncate(d.label, 14))
      .attr("text-anchor", "middle")
      .attr("dy", GITHUB_R + 13)
      .attr("font-size", 9)
      .attr("font-weight", "600")
      .attr("font-family", "'Geist Mono', monospace")
      .attr("fill", "#d68a2e")
      .attr("pointer-events", "none")

    // Project: label inside
    nodeSel.filter((d) => d.type === "project")
      .append("text")
      .text((d) => truncate(d.label, 12))
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("font-size", 9)
      .attr("font-weight", "700")
      .attr("font-family", "'Geist Mono', monospace")
      .attr("fill", "#d68a2e")
      .attr("pointer-events", "none")

    // Resource: label below
    nodeSel.filter((d) => d.type === "resource")
      .append("text")
      .text((d) => truncate(d.label, 18))
      .attr("text-anchor", "middle")
      .attr("dy", RESOURCE_R + 10)
      .attr("font-size", 7)
      .attr("font-family", "'Inter', -apple-system, sans-serif")
      .attr("fill", "rgba(255,255,255,0.45)")
      .attr("pointer-events", "none")

    // Directory: label below
    nodeSel.filter((d) => d.type === "directory")
      .append("text")
      .text((d) => truncate(d.label, 14))
      .attr("text-anchor", "middle")
      .attr("dy", (d: GraphNode) => nodeRadius(d) + 10)
      .attr("font-size", 8)
      .attr("font-family", "'Geist Mono', 'JetBrains Mono', monospace")
      .attr("fill", "rgba(10,10,10,0.6)")
      .attr("pointer-events", "none")

    // Status badge on resource nodes
    const resourceNodes = nodeSel.filter((d) => d.type === "resource" && !!statusBadge(d.status))
    const badgeG = resourceNodes.append("g")
      .attr("class", "status-badge")
      .attr("transform", `translate(${RESOURCE_R - 1},${-(RESOURCE_R - 1)})`)
      .attr("pointer-events", "none")

    badgeG.append("circle")
      .attr("r", 5)
      .style("fill", (d) => statusBadge(d.status)?.color ?? "transparent")
      .style("stroke", "#1a1a1a")
      .style("stroke-width", "1px")

    badgeG.append("path")
      .attr("d", (d) => STATUS_PATHS[statusBadge(d.status)?.type ?? ""] ?? "")
      .style("stroke", "#ffffff")
      .style("stroke-width", "1.8px")
      .style("stroke-linecap", "round")
      .style("stroke-linejoin", "round")
      .style("fill", "none")
      .attr("class", (d) => statusBadge(d.status)?.type === "processing" ? "badge-spin" : "")

    nodeSelRef = nodeSel
    updateDots()

    // ── Tooltip ───────────────────────────────────────────────────────────────
    const tooltip = d3.select(container)
      .append("div")
      .attr("class", "wk-graph-tooltip")
      .style("opacity", "0")

    // ── Hover ─────────────────────────────────────────────────────────────────
    nodeSel
      .on("mouseover", function (event, d) {
        const r = (d.type === "github" || d.type === "project") ? 3.5 : 2.5
        d3.select(this).select("circle")
          .attr("stroke-width", r)

        const connected = new Set([d.id])
        links.forEach((l) => {
          const s = (l.source as SimNode).id
          const t = (l.target as SimNode).id
          if (s === d.id) connected.add(t)
          if (t === d.id) connected.add(s)
        })

        nodeSel.select("circle").attr("opacity", (n: GraphNode) => connected.has(n.id) ? 1 : 0.2)
        linkSel
          .attr("stroke", (l) => {
            const s = (l.source as SimNode).id
            const t = (l.target as SimNode).id
            return s === d.id || t === d.id ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.06)"
          })
          .attr("stroke-width", (l) => {
            const s = (l.source as SimNode).id
            const t = (l.target as SimNode).id
            return s === d.id || t === d.id ? 2 : 1
          })

        tooltip
          .style("opacity", "1")
          .html(d.label)
          .style("left", (event.offsetX + 14) + "px")
          .style("top",  (event.offsetY - 10) + "px")
      })
      .on("mousemove", (event) => {
        tooltip
          .style("left", (event.offsetX + 14) + "px")
          .style("top",  (event.offsetY - 10) + "px")
      })
      .on("mouseout", function (_event, d) {
        d3.select(this).select("circle")
          .attr("stroke-width", d.type === "github" ? 2.5 : d.type === "project" ? 2 : 1.5)
        nodeSel.select("circle").attr("opacity", 1)
        linkSel
          .attr("stroke", "rgba(255,255,255,0.12)")
          .attr("stroke-width", 1.2)
        tooltip.style("opacity", "0")
      })
      .on("click", (_event, d) => {
        if (d.type === "github") {
          props.onOpenCodeBrowser?.()
        } else if (d.type === "resource") {
          const resourceId = d.resource_id ?? d.id.replace(/^res_/, "")
          if (resourceId) props.onNavigateResource(resourceId, d.label, d.url)
        } else if (d.type === "directory") {
          const p = (d as any).path ?? ""
          props.onNavigateDirectory?.(p, d.label)
        }
      })

    // ── Tick ──────────────────────────────────────────────────────────────────
    sim.on("tick", () => {
      linkSel
        .attr("x1", (d) => (d.source as SimNode).x ?? 0)
        .attr("y1", (d) => (d.source as SimNode).y ?? 0)
        .attr("x2", (d) => (d.target as SimNode).x ?? 0)
        .attr("y2", (d) => (d.target as SimNode).y ?? 0)
      nodeSel.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })

    // Auto-fit after initial settle
    setTimeout(() => fitFn?.(), 800)

    onCleanup(() => {
      sim.stop()
      d3.select(container).selectAll("*").remove()
    })
  })

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={container} class="wk-graph-container" style={{ width: "100%", height: "100%" }} />
      <button
        class="wk-graph-fit-btn"
        title="Fit to view"
        onClick={() => fitFn?.()}
      >
        ⊡
      </button>
    </div>
  )
}
