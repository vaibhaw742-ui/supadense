/**
 * wiki-graph.tsx — Obsidian-style force-directed knowledge graph
 * Renders categories, subcategories, resources, and groups as an interactive SVG.
 */
import { onMount, onCleanup } from "solid-js"
import * as d3 from "d3"
import type { GraphData, GraphNode } from "./wiki-api"

interface Props {
  data: GraphData
  onNavigate: (slug: string) => void
}

// ── Node sizing ───────────────────────────────────────────────────────────────

function nodeRadius(type: string): number {
  switch (type) {
    case "category":    return 14
    case "subcategory": return 9
    case "group":       return 7
    case "resource":    return 4
    default:            return 5
  }
}

function nodeColor(node: GraphNode, categoryColorMap: Map<string, string>): string {
  switch (node.type) {
    case "category":
      return node.color ?? "#6366f1"
    case "subcategory": {
      const base = node.category_slug ? categoryColorMap.get(node.category_slug) ?? "#6366f1" : "#6366f1"
      return blendWithWhite(base, 0.45)
    }
    case "group":
      return "#f59e0b"
    case "resource":
      return "#cbd5e1"
    default:
      return "#9ca3af"
  }
}

function blendWithWhite(hex: string, amount: number): string {
  // amount: 0 = original, 1 = white
  try {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    const rr = Math.round(r + (255 - r) * amount)
    const gg = Math.round(g + (255 - g) * amount)
    const bb = Math.round(b + (255 - b) * amount)
    return `rgb(${rr},${gg},${bb})`
  } catch {
    return "#c7d2fe"
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s
}

// ── Component ─────────────────────────────────────────────────────────────────

export function WikiGraph(props: Props) {
  let container!: HTMLDivElement
  let fitFn: (() => void) | null = null

  onMount(() => {
    const { nodes: rawNodes, edges: rawEdges } = props.data
    if (rawNodes.length === 0) return

    // Build category color lookup for subcategory coloring
    const categoryColorMap = new Map<string, string>()
    for (const n of rawNodes) {
      if (n.type === "category" && n.slug) {
        categoryColorMap.set(n.slug, n.color ?? "#6366f1")
      }
    }

    // D3 needs mutable copies with position fields
    type SimNode = GraphNode & d3.SimulationNodeDatum
    type SimLink = { source: string | SimNode; target: string | SimNode }

    const nodes: SimNode[] = rawNodes.map((n) => ({ ...n }))
    const links: SimLink[] = rawEdges.map((e) => ({ source: e.source, target: e.target }))

    const width  = container.clientWidth  || 320
    const height = container.clientHeight || 480

    // SVG
    const svg = d3.select(container)
      .append("svg")
      .attr("width",  "100%")
      .attr("height", "100%")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .style("cursor", "grab")

    // Zoom layer
    const g = svg.append("g")

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 5])
      .on("zoom", (event) => {
        g.attr("transform", event.transform)
        svg.style("cursor", event.transform.k > 1 ? "grabbing" : "grab")
      })

    svg.call(zoom)

    // ── Fit-to-view helper ────────────────────────────────────────────────────
    fitFn = () => {
      // Only consider category nodes for fit bounds (avoids resource scatter)
      const catNodes = nodes.filter((n) => n.type === "category" && n.x != null && n.y != null)
      const fitNodes = catNodes.length > 0 ? catNodes : nodes.filter((n) => n.x != null && n.y != null)
      if (fitNodes.length === 0) return

      const pad = 40
      const xs = fitNodes.map((n) => n.x!)
      const ys = fitNodes.map((n) => n.y!)
      const x0 = Math.min(...xs) - pad
      const y0 = Math.min(...ys) - pad
      const x1 = Math.max(...xs) + pad
      const y1 = Math.max(...ys) + pad

      const scale = Math.min(0.95, Math.min(width / (x1 - x0), height / (y1 - y0)))
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
          if (s.type === "category" || t.type === "category")    return 90
          if (s.type === "subcategory" || t.type === "subcategory") return 65
          if (s.type === "group" || t.type === "group")           return 40
          return 50
        })
        .strength(0.6)
      )
      .force("charge",   d3.forceManyBody<SimNode>().strength((d) => d.type === "category" ? -220 : -80))
      .force("center",   d3.forceCenter(width / 2, height / 2).strength(0.05))
      .force("collision",d3.forceCollide<SimNode>().radius((d) => nodeRadius(d.type) + 5))

    // ── Edges ─────────────────────────────────────────────────────────────────
    const linkSel = g.append("g").attr("class", "g-links")
      .selectAll<SVGLineElement, SimLink>("line")
      .data(links)
      .join("line")
      .attr("stroke", "#d3d1cb")
      .attr("stroke-width", 1)
      .attr("stroke-opacity", 0.9)

    // ── Node groups ───────────────────────────────────────────────────────────
    const nodeSel = g.append("g").attr("class", "g-nodes")
      .selectAll<SVGGElement, SimNode>("g")
      .data(nodes)
      .join("g")
      .style("cursor", (d) => (d.type === "category" || d.type === "subcategory") ? "pointer" : "default")

    // Drag
    nodeSel.call(
      d3.drag<SVGGElement, SimNode>()
        .on("start", (event, d) => {
          if (!event.active) sim.alphaTarget(0.3).restart()
          d.fx = d.x; d.fy = d.y
        })
        .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y })
        .on("end",  (event, d) => {
          if (!event.active) sim.alphaTarget(0)
          d.fx = null; d.fy = null
        })
    )

    // Circles
    nodeSel.append("circle")
      .attr("r",            (d) => nodeRadius(d.type))
      .attr("fill",         (d) => nodeColor(d, categoryColorMap))
      .attr("stroke",       "#f7f7f5")
      .attr("stroke-width", 1.5)

    // Labels — category, subcategory, group only (resources too small)
    nodeSel.filter((d) => d.type !== "resource")
      .append("text")
      .text((d) => truncate(d.label, d.type === "category" ? 12 : 14))
      .attr("text-anchor", "middle")
      .attr("dy", (d) => nodeRadius(d.type) + 11)
      .attr("font-size", (d) => d.type === "category" ? 10 : 8)
      .attr("font-family", "'Inter', -apple-system, BlinkMacSystemFont, sans-serif")
      .attr("fill", "#787774")
      .attr("pointer-events", "none")

    // ── Tooltip ───────────────────────────────────────────────────────────────
    const tooltip = d3.select(container)
      .append("div")
      .attr("class", "wk-graph-tooltip")
      .style("opacity", "0")

    // ── Hover interactions ────────────────────────────────────────────────────
    nodeSel
      .on("mouseover", function (event, d) {
        d3.select(this).select("circle")
          .attr("stroke", "#2d6a4f")
          .attr("stroke-width", 2.5)

        // Collect connected node IDs
        const connected = new Set([d.id])
        links.forEach((l) => {
          const s = (l.source as SimNode).id
          const t = (l.target as SimNode).id
          if (s === d.id) connected.add(t)
          if (t === d.id) connected.add(s)
        })

        nodeSel.select("circle").attr("opacity", (n) => connected.has(n.id) ? 1 : 0.2)
        linkSel
          .attr("stroke-opacity", (l) => {
            const s = (l.source as SimNode).id
            const t = (l.target as SimNode).id
            return s === d.id || t === d.id ? 1 : 0.08
          })
          .attr("stroke", (l) => {
            const s = (l.source as SimNode).id
            const t = (l.target as SimNode).id
            return s === d.id || t === d.id ? "#2d6a4f" : "#d3d1cb"
          })
          .attr("stroke-width", (l) => {
            const s = (l.source as SimNode).id
            const t = (l.target as SimNode).id
            return s === d.id || t === d.id ? 1.5 : 1
          })

        tooltip
          .style("opacity", "1")
          .html(d.label)
          .style("left", (event.offsetX + 12) + "px")
          .style("top",  (event.offsetY - 8)  + "px")
      })
      .on("mousemove", (event) => {
        tooltip
          .style("left", (event.offsetX + 12) + "px")
          .style("top",  (event.offsetY - 8)  + "px")
      })
      .on("mouseout", function () {
        d3.select(this).select("circle")
          .attr("stroke", "#f7f7f5")
          .attr("stroke-width", 1.5)
        nodeSel.select("circle").attr("opacity", 1)
        linkSel
          .attr("stroke-opacity", 0.9)
          .attr("stroke", "#d3d1cb")
          .attr("stroke-width", 1)
        tooltip.style("opacity", "0")
      })
      .on("click", (_event, d) => {
        if (d.type === "category" && d.slug)
          props.onNavigate(d.slug)
        else if (d.type === "subcategory" && d.category_slug && d.slug)
          props.onNavigate(`${d.category_slug}--${d.slug}`)
      })

    // ── Tick ──────────────────────────────────────────────────────────────────
    sim.on("tick", () => {
      linkSel
        .attr("x1", (d) => (d.source as SimNode).x ?? 0)
        .attr("y1", (d) => (d.source as SimNode).y ?? 0)
        .attr("x2", (d) => (d.target as SimNode).x ?? 0)
        .attr("y2", (d) => (d.target as SimNode).y ?? 0)
      nodeSel
        .attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })

    onCleanup(() => sim.stop())
  })

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={container} class="wk-graph-container" style={{ width: "100%", height: "100%" }} />
      <button
        class="wk-graph-fit-btn"
        title="Fit all categories into view"
        onClick={() => fitFn?.()}
      >
        ⊡
      </button>
    </div>
  )
}
