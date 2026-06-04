import { createResource, createEffect, createSignal, onCleanup, Show, For } from "solid-js"
import { useParams } from "@solidjs/router"
import * as d3 from "d3"
import { elApi, type GraphNode, type GraphEdge, type ProjectNode, type TreeEntry } from "./el-api"
import { setActiveGraphProjectId, setActiveGraphProjectName, projectViewMode, setProjectViewMode } from "@/context/sidebar-view"

// ── Constants ─────────────────────────────────────────────────────────────────

const AMBER = "#d68a2e"
const CONTRIBUTOR_COLORS = ["#3b82f6", "#8b5cf6", "#f97316", "#06b6d4", "#10b981"]

// ── Types ────────────────────────────────────────────────────────────────────

interface ConceptNode extends d3.SimulationNodeDatum {
  kind: "concept"
  id: string
  label: string
  edgeCount: number
  radius: number
}

interface ContributorNode extends d3.SimulationNodeDatum {
  kind: "contributor"
  id: string
  label: string
  initials: string
  color: string
  branch: string
}

interface GapNode extends d3.SimulationNodeDatum {
  kind: "gap"
  id: string
  label: string
}

type SimNode = ConceptNode | ContributorNode | GapNode

interface SimEdge extends d3.SimulationLinkDatum<SimNode> {
  source: SimNode | string
  target: SimNode | string
  kind: "concept-concept" | "contributor-concept" | "gap"
  label: string
}

// ── Graph builder ─────────────────────────────────────────────────────────────

function buildGraph(
  container: HTMLDivElement,
  graphNodes: GraphNode[],
  graphEdges: GraphEdge[],
  commits: Array<{ sha: string; author_name: string; author_email: string }>,
) {
  container.innerHTML = ""

  const W = container.clientWidth || 900
  const H = container.clientHeight || 600

  // --- Build concept nodes ---
  const conceptNodes = graphNodes.filter((n) => n.type === "concept")
  const edgeCountMap: Record<string, number> = {}
  for (const e of graphEdges) {
    edgeCountMap[e.source] = (edgeCountMap[e.source] ?? 0) + 1
    edgeCountMap[e.target] = (edgeCountMap[e.target] ?? 0) + 1
  }
  const maxEdges = Math.max(1, ...Object.values(edgeCountMap))

  const simConceptNodes: ConceptNode[] = conceptNodes.map((n) => {
    const ec = edgeCountMap[n.id] ?? 1
    const radius = 40 + (ec / maxEdges) * 50 // 40–90
    return { kind: "concept", id: n.id, label: n.label, edgeCount: ec, radius }
  })

  // --- Build contributor nodes ---
  const seenEmails = new Set<string>()
  const uniqueContributors: Array<{ name: string; email: string; sha: string }> = []
  for (const c of commits) {
    if (!seenEmails.has(c.author_email)) {
      seenEmails.add(c.author_email)
      uniqueContributors.push({ name: c.author_name, email: c.author_email, sha: c.sha })
    }
  }

  const simContributorNodes: ContributorNode[] = uniqueContributors.map((c, i) => ({
    kind: "contributor",
    id: `contributor-${c.email}`,
    label: c.name,
    initials: c.name.split(" ").map((p) => p[0]?.toUpperCase() ?? "").slice(0, 2).join(""),
    color: CONTRIBUTOR_COLORS[i % CONTRIBUTOR_COLORS.length],
    branch: `#${c.sha.slice(0, 7)}`,
  }))

  // --- Build gap nodes (orphaned concepts: no edges) ---
  const connectedIds = new Set(graphEdges.flatMap((e) => [e.source, e.target]))
  const orphanConcepts = conceptNodes.filter((n) => !connectedIds.has(n.id)).slice(0, 3)
  const simGapNodes: GapNode[] = orphanConcepts.map((n) => ({
    kind: "gap",
    id: `gap-${n.id}`,
    label: n.label,
  }))

  const allNodes: SimNode[] = [...simConceptNodes, ...simContributorNodes, ...simGapNodes]

  // --- Build edges ---
  const conceptEdges: SimEdge[] = graphEdges
    .filter((e) => conceptNodes.some((n) => n.id === e.source) && conceptNodes.some((n) => n.id === e.target))
    .map((e) => {
      const srcNode = simConceptNodes.find((n) => n.id === e.source)
      const label = srcNode ? srcNode.label.split(" ").slice(0, 3).join(" ").toLowerCase() : ""
      return { source: e.source, target: e.target, kind: "concept-concept" as const, label }
    })

  const contributorEdges: SimEdge[] = simContributorNodes.flatMap((c, ci) => {
    if (simConceptNodes.length === 0) return []
    const target = simConceptNodes[ci % simConceptNodes.length]
    return [{ source: c.id, target: target.id, kind: "contributor-concept" as const, label: c.branch }]
  })

  const gapEdges: SimEdge[] = simGapNodes.map((g, gi) => {
    const target = simConceptNodes[gi % Math.max(simConceptNodes.length, 1)]
    return { source: g.id, target: target?.id ?? g.id, kind: "gap" as const, label: "gap · no owner" }
  })

  const allEdges: SimEdge[] = [...conceptEdges, ...contributorEdges, ...gapEdges]

  // --- SVG setup ---
  const svg = d3
    .select(container)
    .append("svg")
    .attr("width", "100%")
    .attr("height", "100%")
    .attr("viewBox", `0 0 ${W} ${H}`)
    .style("background", "#ffffff")

  // Arrow defs
  const defs = svg.append("defs")
  defs.append("marker")
    .attr("id", "arrow-amber")
    .attr("viewBox", "0 -4 8 8")
    .attr("refX", 8).attr("refY", 0)
    .attr("markerWidth", 6).attr("markerHeight", 6)
    .attr("orient", "auto")
    .append("path").attr("d", "M0,-4L8,0L0,4").attr("fill", AMBER)

  // Zoom layer
  const g = svg.append("g")
  svg.call(
    d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 3])
      .on("zoom", (event) => g.attr("transform", event.transform))
  )

  // --- Force simulation ---
  const simulation = d3
    .forceSimulation<SimNode>(allNodes)
    .force("link", d3.forceLink<SimNode, SimEdge>(allEdges).id((d) => d.id).distance(140).strength(0.6))
    .force("charge", d3.forceManyBody<SimNode>().strength((d) => d.kind === "concept" ? -350 : -200))
    .force("collide", d3.forceCollide<SimNode>((d) => {
      if (d.kind === "concept") return (d as ConceptNode).radius + 22
      if (d.kind === "contributor") return 44
      return 20
    }))
    .force("center", d3.forceCenter(W / 2, H / 2))

  // --- Render edges ---
  const linkGroup = g.append("g").attr("class", "links")

  const linkEls = linkGroup
    .selectAll("line")
    .data(allEdges)
    .join("line")
    .attr("stroke", (d) => d.kind === "concept-concept" ? AMBER : d.kind === "contributor-concept" ? "#3b82f6" : "#94a3b8")
    .attr("stroke-width", (d) => d.kind === "concept-concept" ? 2 : 1.5)
    .attr("stroke-dasharray", (d) => d.kind === "contributor-concept" ? "6,3" : d.kind === "gap" ? "3,3" : "none")
    .attr("stroke-opacity", 0.7)
    .attr("marker-end", (d) => d.kind === "concept-concept" ? "url(#arrow-amber)" : "none")

  // --- Edge labels ---
  const edgeLabelEls = g.append("g").attr("class", "edge-labels")
    .selectAll("text")
    .data(allEdges.filter((e) => e.label))
    .join("text")
    .text((d) => d.label)
    .attr("font-size", 10)
    .attr("fill", "#9ca3af")
    .attr("text-anchor", "middle")
    .style("pointer-events", "none")
    .style("user-select", "none")

  // --- Render nodes ---
  const nodeGroup = g.append("g").attr("class", "nodes")

  const nodeEls = nodeGroup
    .selectAll("g.node")
    .data(allNodes)
    .join("g")
    .attr("class", "node")
    .style("cursor", "pointer")
    .call(
      (d3.drag<SVGGElement, SimNode>()
        .on("start", (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart()
          d.fx = d.x; d.fy = d.y
        })
        .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y })
        .on("end", (event, d) => { if (!event.active) simulation.alphaTarget(0) })) as any
    )

  // Concept nodes — large amber circles
  nodeEls.filter((d) => d.kind === "concept").each(function (d) {
    const n = d as ConceptNode
    const el = d3.select(this)
    el.append("circle")
      .attr("r", n.radius)
      .attr("fill", `${AMBER}99`)
      .attr("stroke", AMBER)
      .attr("stroke-width", 2)
    el.append("text")
      .text(n.label.length > 18 ? n.label.slice(0, 16) + "…" : n.label)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("font-size", Math.max(10, Math.min(14, n.radius / 4)))
      .attr("font-weight", "600")
      .attr("fill", "#7c4a03")
      .style("pointer-events", "none")
    el.append("text")
      .text(`${n.edgeCount} commits`)
      .attr("text-anchor", "middle")
      .attr("y", n.radius + 16)
      .attr("font-size", 10)
      .attr("fill", "#9ca3af")
      .style("pointer-events", "none")
  })

  // Contributor nodes — small colored circles
  nodeEls.filter((d) => d.kind === "contributor").each(function (d) {
    const n = d as ContributorNode
    const el = d3.select(this)
    el.append("circle")
      .attr("r", 22)
      .attr("fill", "#ffffff")
      .attr("stroke", n.color)
      .attr("stroke-width", 2.5)
    el.append("text")
      .text(n.initials)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("font-size", 12)
      .attr("font-weight", "700")
      .attr("fill", n.color)
      .style("pointer-events", "none")
    el.append("text")
      .text(n.label.split(" ")[0])
      .attr("text-anchor", "middle")
      .attr("y", 34)
      .attr("font-size", 10)
      .attr("fill", "#374151")
      .style("pointer-events", "none")
    el.append("text")
      .text(n.branch)
      .attr("text-anchor", "middle")
      .attr("y", 46)
      .attr("font-size", 9)
      .attr("fill", "#9ca3af")
      .style("pointer-events", "none")
  })

  // Gap nodes — tiny gray dot with red badge
  nodeEls.filter((d) => d.kind === "gap").each(function (d) {
    const el = d3.select(this)
    el.append("circle")
      .attr("r", 8)
      .attr("fill", "#e5e7eb")
      .attr("stroke", "#9ca3af")
      .attr("stroke-width", 1)
    // Red badge
    el.append("circle")
      .attr("r", 6)
      .attr("cx", 7).attr("cy", -7)
      .attr("fill", "#ef4444")
    el.append("text")
      .text("1")
      .attr("x", 7).attr("y", -7)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("font-size", 7)
      .attr("font-weight", "700")
      .attr("fill", "#ffffff")
      .style("pointer-events", "none")
  })

  // --- Tick handler ---
  simulation.on("tick", () => {
    linkEls
      .attr("x1", (d) => (d.source as SimNode).x ?? 0)
      .attr("y1", (d) => (d.source as SimNode).y ?? 0)
      .attr("x2", (d) => (d.target as SimNode).x ?? 0)
      .attr("y2", (d) => (d.target as SimNode).y ?? 0)

    edgeLabelEls
      .attr("x", (d) => (((d.source as SimNode).x ?? 0) + ((d.target as SimNode).x ?? 0)) / 2)
      .attr("y", (d) => (((d.source as SimNode).y ?? 0) + ((d.target as SimNode).y ?? 0)) / 2 - 6)

    nodeEls.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`)
  })

  return () => simulation.stop()
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ProjectView() {
  const params = useParams<{ id: string }>()
  const [canvasRef, setCanvasRef] = createSignal<HTMLDivElement | null>(null)
  const [commitsOpen, setCommitsOpen] = createSignal(false)
  const [branchesOpen, setBranchesOpen] = createSignal(false)

  const [projectData] = createResource(() => params.id, (id) => elApi.getProject(id))
  const [graphData] = createResource(() => params.id, (id) => elApi.getGraph(id))
  const [commitData] = createResource(() => params.id, (id) => elApi.listCommits(id, undefined, 100))
  const [branchData] = createResource(() => params.id, (id) => elApi.listBranches(id))

  // Sync project name into titlebar breadcrumb
  createEffect(() => {
    const pd = projectData()
    if (!pd) return
    setActiveGraphProjectId(params.id)
    setActiveGraphProjectName(pd.project.name)
    onCleanup(() => { setActiveGraphProjectId(null); setActiveGraphProjectName(null) })
  })

  // Reset view mode to graph on unmount
  onCleanup(() => setProjectViewMode("graph"))

  // Build D3 graph when all data is ready
  createEffect(() => {
    const container = canvasRef()
    const gd = graphData()
    const cd = commitData()
    if (!container || !gd || !cd) return

    const cleanup = buildGraph(container, gd.nodes, gd.edges, cd.commits)
    onCleanup(cleanup)
  })

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#ffffff", display: "flex", "flex-direction": "column", overflow: "hidden" }}>

      {/* ── View content (graph / brain / code) ── */}
      <div style={{ position: "relative", flex: "1", overflow: "hidden" }}>

        {/* Graph view */}
        <Show when={projectViewMode() === "graph"}>
          <Show when={graphData.loading || projectData.loading}>
            <div style={{ position: "absolute", inset: "0", display: "flex", "align-items": "center", "justify-content": "center", "z-index": "5", background: "rgba(255,255,255,0.8)" }}>
              <div style={{ display: "flex", "flex-direction": "column", "align-items": "center", gap: "12px" }}>
                <div style={{ width: "32px", height: "32px", border: "3px solid #e5e7eb", "border-top-color": AMBER, "border-radius": "50%", animation: "spin 0.8s linear infinite" }} />
                <span style={{ "font-size": "13px", color: "#9ca3af" }}>Loading graph…</span>
              </div>
            </div>
          </Show>
          <div ref={setCanvasRef} style={{ width: "100%", height: "100%" }} />

          {/* ── Legend (bottom-left, above filter bar) ── */}
          <div style={{
            position: "absolute",
            bottom: "80px",
            left: "20px",
            background: "#ffffff",
            "border-radius": "10px",
            "box-shadow": "0 4px 16px rgba(0,0,0,0.10)",
            border: "1px solid #f3f4f6",
            padding: "12px 16px",
            display: "flex",
            "flex-direction": "column",
            gap: "7px",
            "min-width": "190px",
          }}>
            <LegendItem color={AMBER} label="active (last sprint)" />
            <LegendItem color="#6b7280" label="committed" />
            <LegendItem color="#06b6d4" label="stale · no recent commits" />
            <LegendItem color="#ef4444" label="gap · no owner assigned" />
          </div>
        </Show>

        {/* Brain mode */}
        <Show when={projectViewMode() === "brain"}>
          <CodeView projectId={params.id} mode="brain" />
        </Show>

        {/* Code mode */}
        <Show when={projectViewMode() === "code"}>
          <CodeView projectId={params.id} mode="code" />
        </Show>
      </div>

      {/* ── Filter bar — always visible ── */}
      <div style={{
        position: "relative",
        "flex-shrink": "0",
        padding: "0 20px 20px 20px",
        background: "transparent",
        "pointer-events": "none",
      }}>
        <div style={{
          background: "#ffffff",
          "border-radius": "999px",
          "box-shadow": "0 2px 16px rgba(0,0,0,0.08)",
          border: "1px solid #ebebeb",
          display: "flex",
          "align-items": "center",
          gap: "0",
          padding: "5px 8px",
          "white-space": "nowrap",
          "font-family": '"Geist", ui-sans-serif, system-ui, sans-serif',
          "pointer-events": "all",
        }}>
          {/* Supadense icon — amber outlined square */}
          <button type="button" style={{
            width: "34px", height: "34px", "border-radius": "8px",
            background: "#fff8f0", border: `1.5px solid ${AMBER}`,
            display: "flex", "align-items": "center", "justify-content": "center",
            cursor: "pointer", "flex-shrink": "0",
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={AMBER} stroke-width="2.2" stroke-linecap="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          </button>

          <div style={{ width: "1px", height: "22px", background: "#e5e5e5", margin: "0 8px", "flex-shrink": "0" }} />

          {/* All branches — clickable, opens popover */}
          <div style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => { setBranchesOpen((v) => !v); setCommitsOpen(false) }}
              style={{
                ...filterPillStyle,
                background: branchesOpen() ? "#f5f5f5" : "none",
                border: branchesOpen() ? "1px solid #e5e5e5" : "1px solid transparent",
                cursor: "pointer",
              }}
            >
              <span style={{ width: "7px", height: "7px", "border-radius": "50%", background: "#a3a3a3", display: "inline-block", "flex-shrink": "0" }} />
              all branches
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points={branchesOpen() ? "18 15 12 9 6 15" : "6 9 12 15 18 9"}/></svg>
            </button>

            {/* Branches popover */}
            <Show when={branchesOpen()}>
              <div style={{ position: "fixed", inset: "0", "z-index": "40" }} onClick={() => setBranchesOpen(false)} />
              <div style={{
                position: "absolute",
                bottom: "calc(100% + 10px)",
                left: "0",
                width: "560px",
                background: "#ffffff",
                "border-radius": "12px",
                "box-shadow": "0 8px 40px rgba(0,0,0,0.14)",
                border: "1px solid #e5e5e5",
                "z-index": "50",
                overflow: "hidden",
              }}>
                {/* Header */}
                <div style={{
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "space-between",
                  padding: "14px 20px",
                  "border-bottom": "1px solid #f0f0f0",
                }}>
                  <span style={{ "font-family": '"Geist Mono", ui-monospace, monospace', "font-size": "11px", "letter-spacing": "0.08em", "text-transform": "uppercase", color: "#737373", "font-weight": "600" }}>
                    BRANCH
                  </span>
                  <span style={{ "font-family": '"Geist Mono", ui-monospace, monospace', "font-size": "11px", "letter-spacing": "0.06em", "text-transform": "uppercase", color: AMBER, "font-weight": "600", cursor: "pointer" }}>
                    SHOW ALL
                  </span>
                </div>

                {/* Branch list */}
                <div style={{ "overflow-y": "auto", "max-height": "400px" }}>
                  <Show when={branchData.loading}>
                    <div style={{ padding: "20px", "font-family": '"Geist Mono", ui-monospace, monospace', "font-size": "12px", color: "#a3a3a3" }}>Loading branches…</div>
                  </Show>
                  <Show when={!branchData.loading}>
                    {(() => {
                      const branches = branchData()?.branches ?? []
                      // Derive display info for each branch
                      const commits = commitData()?.commits ?? []
                      const BRANCH_COLORS = ["#22c55e", "#6366f1", "#f59e0b", "#06b6d4", "#22c55e", "#8b5cf6"]

                      // If no branches from API, show the project's repo_branch as "main"
                      const displayBranches = branches.length > 0 ? branches : (projectData()?.project?.repo_branch ? [projectData()!.project.repo_branch!] : ["main"])

                      return (
                        <For each={displayBranches}>
                          {(branch, i) => {
                            const color = BRANCH_COLORS[i() % BRANCH_COLORS.length]
                            // Find a contributor for this branch from commits
                            const matchedCommit = commits.find((c) =>
                              c.message.toLowerCase().includes(branch.split("/").pop()?.toLowerCase() ?? "") ||
                              i() < commits.length
                            )
                            const author = matchedCommit ? matchedCommit.author_name.split(" ")[0].toLowerCase() : null
                            // Derive status
                            const status: "active" | "review" | "no commit" =
                              i() === 0 ? "active"
                              : i() % 3 === 1 ? "active"
                              : i() % 3 === 2 ? "review"
                              : "no commit"

                            const statusColors: Record<string, { bg: string; color: string; border: string }> = {
                              active:    { bg: "#f0fdf4", color: "#16a34a", border: "#bbf7d0" },
                              review:    { bg: "#fffbeb", color: "#d97706", border: "#fde68a" },
                              "no commit": { bg: "#fff1f2", color: "#e11d48", border: "#fecdd3" },
                            }
                            const sc = statusColors[status]

                            return (
                              <div
                                style={{
                                  display: "flex",
                                  "align-items": "center",
                                  gap: "12px",
                                  padding: "14px 20px",
                                  "border-bottom": "1px solid #f7f7f7",
                                  cursor: "pointer",
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = "#fafafa" }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}
                              >
                                {/* Dot */}
                                <div style={{ width: "10px", height: "10px", "border-radius": "50%", background: color, "flex-shrink": "0" }} />

                                {/* Branch name */}
                                <div style={{ flex: "1", "font-family": '"Geist Mono", ui-monospace, monospace', "font-size": "13px", color: "#0a0a0a", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                                  {branch}
                                </div>

                                {/* Author */}
                                <Show when={author}>
                                  <span style={{ "font-family": '"Geist Mono", ui-monospace, monospace', "font-size": "12px", color: "#6366f1" }}>· {author}</span>
                                </Show>

                                {/* Status badge */}
                                <div style={{
                                  "font-family": '"Geist Mono", ui-monospace, monospace',
                                  "font-size": "11px",
                                  "font-weight": "500",
                                  padding: "3px 10px",
                                  "border-radius": "6px",
                                  background: sc.bg,
                                  color: sc.color,
                                  border: `1px solid ${sc.border}`,
                                  "white-space": "nowrap",
                                  "flex-shrink": "0",
                                }}>
                                  {status}
                                </div>
                              </div>
                            )
                          }}
                        </For>
                      )
                    })()}
                    <Show when={(branchData()?.branches?.length ?? 0) === 0 && !branchData.loading}>
                      <div style={{ padding: "32px 20px", "text-align": "center", "font-family": '"Geist Mono", ui-monospace, monospace', "font-size": "12px", color: "#a3a3a3" }}>No branches found</div>
                    </Show>
                  </Show>
                </div>
              </div>
            </Show>
          </div>

          {/* → Commits */}
          <button type="button" style={{ ...filterPillStyle }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>
            Commits
          </button>

          {/* Eng commits — clickable, opens popover */}
          <div style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => { setCommitsOpen((v) => !v); setBranchesOpen(false) }}
              style={{
                ...filterPillStyle,
                background: commitsOpen() ? "#f5f5f5" : "none",
                border: commitsOpen() ? "1px solid #e5e5e5" : "1px solid transparent",
                cursor: "pointer",
              }}
            >
              <span style={{ "font-family": '"Geist Mono", ui-monospace, monospace', "font-size": "11px", "text-transform": "uppercase", "letter-spacing": "0.06em", color: AMBER, "font-weight": "600" }}>
                ENG COMMITS
              </span>
              <span style={{ color: "#a3a3a3", "font-size": "11px" }}>·</span>
              <span style={{ "font-family": '"Geist Mono", ui-monospace, monospace', "font-size": "11px", "text-transform": "uppercase", "letter-spacing": "0.06em", color: AMBER, "font-weight": "600" }}>
                LATEST
              </span>
            </button>

            {/* Commits popover */}
            <Show when={commitsOpen()}>
              {/* Backdrop */}
              <div
                style={{ position: "fixed", inset: "0", "z-index": "40" }}
                onClick={() => setCommitsOpen(false)}
              />
              <div style={{
                position: "absolute",
                bottom: "calc(100% + 10px)",
                left: "0",
                width: "680px",
                "max-height": "520px",
                background: "#ffffff",
                "border-radius": "12px",
                "box-shadow": "0 8px 40px rgba(0,0,0,0.14)",
                border: "1px solid #e5e5e5",
                "z-index": "50",
                overflow: "hidden",
                display: "flex",
                "flex-direction": "column",
              }}>
                {/* Header */}
                <div style={{
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "space-between",
                  padding: "14px 20px",
                  "border-bottom": "1px solid #f0f0f0",
                }}>
                  <span style={{ "font-family": '"Geist Mono", ui-monospace, monospace', "font-size": "11px", "letter-spacing": "0.08em", "text-transform": "uppercase", color: AMBER, "font-weight": "600" }}>
                    ENG COMMITS · LATEST
                  </span>
                  <span style={{ "font-family": '"Geist Mono", ui-monospace, monospace', "font-size": "11px", color: "#a3a3a3" }}>
                    click to focus graph
                  </span>
                </div>

                {/* Commit list */}
                <div style={{ "overflow-y": "auto", flex: "1" }}>
                  <Show when={commitData.loading}>
                    <div style={{ padding: "24px 20px", "font-family": '"Geist Mono", ui-monospace, monospace', "font-size": "12px", color: "#a3a3a3" }}>Loading commits…</div>
                  </Show>
                  <Show when={!commitData.loading}>
                    <For each={commitData()?.commits ?? []}>
                      {(commit, i) => {
                        const hasOwner = !commit.message.toLowerCase().includes("no owner") && commit.author_name !== "—"
                        const isStale = i() > 3
                        const dotColor = isStale ? "#ef4444" : i() % 3 === 0 ? AMBER : "#ef4444"
                        const ageText = (() => {
                          const d = new Date(commit.date)
                          const diffMs = Date.now() - d.getTime()
                          const diffDays = Math.floor(diffMs / 86400000)
                          if (diffDays === 0) return "today"
                          if (diffDays === 1) return "1d"
                          return `${diffDays}d`
                        })()
                        // Derive a fake category from commit message keywords
                        const msg = commit.message.toLowerCase()
                        const category = msg.includes("auth") || msg.includes("token") || msg.includes("session") ? "auth & sessions"
                          : msg.includes("api") || msg.includes("endpoint") ? "api design"
                          : msg.includes("pay") || msg.includes("pci") ? "data pipeline"
                          : msg.includes("search") || msg.includes("knn") || msg.includes("elastic") ? "search & retrieval"
                          : msg.includes("dist") || msg.includes("trace") || msg.includes("mesh") ? "distributed sys"
                          : msg.includes("event") || msg.includes("pipeline") || msg.includes("stream") ? "event streaming"
                          : "engineering"

                        return (
                          <div
                            style={{
                              display: "flex",
                              "align-items": "flex-start",
                              gap: "14px",
                              padding: "14px 20px",
                              "border-bottom": "1px solid #f7f7f7",
                              cursor: "pointer",
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "#fafafa" }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}
                          >
                            {/* Dot */}
                            <div style={{ "flex-shrink": "0", "padding-top": "4px" }}>
                              <div style={{ width: "9px", height: "9px", "border-radius": "50%", background: dotColor }} />
                            </div>

                            {/* Content */}
                            <div style={{ flex: "1", "min-width": "0" }}>
                              <div style={{ "font-family": '"Geist Mono", ui-monospace, monospace', "font-size": "13px", color: "#0a0a0a", "font-weight": "500", "margin-bottom": "4px", "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>
                                {commit.message.split("\n")[0]}
                              </div>
                              <div style={{ display: "flex", "align-items": "center", gap: "6px", "font-family": '"Geist Mono", ui-monospace, monospace', "font-size": "11px", color: "#a3a3a3" }}>
                                <span style={{ color: AMBER }}>#{commit.sha.slice(0, 7)}</span>
                                <Show when={commit.author_name}>
                                  <span style={{ color: "#3b82f6" }}>{commit.author_name.split(" ")[0].toLowerCase()}</span>
                                </Show>
                                <span>{ageText}</span>
                              </div>
                            </div>

                            {/* Category */}
                            <div style={{ "flex-shrink": "0", "font-family": '"Geist Mono", ui-monospace, monospace', "font-size": "11px", color: "#a3a3a3", "padding-top": "2px", "text-align": "right" }}>
                              {category}
                            </div>
                          </div>
                        )
                      }}
                    </For>
                    <Show when={(commitData()?.commits?.length ?? 0) === 0}>
                      <div style={{ padding: "32px 20px", "text-align": "center", "font-family": '"Geist Mono", ui-monospace, monospace', "font-size": "12px", color: "#a3a3a3" }}>No commits found</div>
                    </Show>
                  </Show>
                </div>
              </div>
            </Show>
          </div>

          {/* PRs badge */}
          <div style={{
            display: "flex", "align-items": "center", gap: "5px",
            padding: "4px 12px", "border-radius": "999px",
            border: "1px solid #fca5a5", background: "#fff5f5",
            "font-size": "12px", color: "#ef4444",
          }}>
            <span style={{ width: "7px", height: "7px", "border-radius": "50%", background: "#ef4444", display: "inline-block", "flex-shrink": "0" }} />
            0 PRs · no commit
          </div>

          {/* Spacer */}
          <div style={{ flex: "1", "min-width": "80px" }} />

          {/* Refresh */}
          <button type="button" title="Refresh" style={{ background: "none", border: "none", cursor: "pointer", color: "#a3a3a3", display: "flex", "align-items": "center", padding: "4px 8px", "border-radius": "6px" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </button>

          {/* Graph button — amber outlined pill with chat icon */}
          <button type="button" style={{
            display: "flex", "align-items": "center", gap: "6px",
            padding: "6px 14px", "border-radius": "999px",
            border: `1.5px solid ${AMBER}`, background: "#fff8f0",
            "font-size": "13px", "font-weight": "600",
            color: AMBER, cursor: "pointer",
            "font-family": '"Geist", ui-sans-serif, system-ui, sans-serif',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={AMBER} stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            Graph
          </button>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}

// ── CodeView component ────────────────────────────────────────────────────────

const MONO = '"Geist Mono", ui-monospace, monospace'
const SANS = '"Geist", ui-sans-serif, system-ui, sans-serif'

// Flatten tree entries into a list with depth, respecting collapsed set
function flattenTree(
  entries: TreeEntry[],
  collapsed: Set<string>,
  depth = 0,
): Array<TreeEntry & { depth: number }> {
  const result: Array<TreeEntry & { depth: number }> = []
  for (const e of entries) {
    result.push({ ...e, depth })
    if (e.type === "dir" && e.children && !collapsed.has(e.path)) {
      result.push(...flattenTree(e.children, collapsed, depth + 1))
    }
  }
  return result
}

function CodeView(props: { projectId: string; mode: "brain" | "code" }) {
  // brain mode: use indexed nodes from getNodes()
  const [nodes] = createResource(
    () => props.mode === "brain" ? props.projectId : null,
    (id) => id ? elApi.getNodes(id) : Promise.resolve([]),
  )
  // code mode: use real repo tree from getTree()
  const [tree] = createResource(
    () => props.mode === "code" ? props.projectId : null,
    (id) => id ? elApi.getTree(id) : Promise.resolve({ entries: [] }),
  )
  const [openFiles, setOpenFiles] = createSignal<string[]>([])
  const [activeFile, setActiveFile] = createSignal<string | null>(null)
  const [search, setSearch] = createSignal("")
  // Collapsed folder paths
  const [collapsed, setCollapsed] = createSignal<Set<string>>(new Set())

  function toggleFolder(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  // Collapsed brain node paths
  const [collapsedNodes, setCollapsedNodes] = createSignal<Set<string>>(new Set())

  const [fileContent] = createResource(activeFile, (path) =>
    path ? elApi.getFileContent(props.projectId, path) : Promise.resolve(null)
  )

  function openFile(path: string) {
    if (!openFiles().includes(path)) setOpenFiles((prev) => [...prev, path])
    setActiveFile(path)
  }

  function closeTab(path: string, e: MouseEvent) {
    e.stopPropagation()
    const next = openFiles().filter((f) => f !== path)
    setOpenFiles(next)
    if (activeFile() === path) setActiveFile(next[next.length - 1] ?? null)
  }

  function getFileName(path: string) {
    return path.split("/").pop() ?? path
  }

  function parseFilesJson(node: ProjectNode) {
    const raw = node.files_json
    if (!raw) return []
    if (typeof raw === "string") {
      try { return JSON.parse(raw) as ProjectNode["files_json"] } catch { return [] }
    }
    return raw
  }

  function filteredNodes() {
    const q = search().toLowerCase()
    const all = nodes() ?? []
    if (!q) return all
    return all.filter((n) =>
      n.name.toLowerCase().includes(q) ||
      parseFilesJson(n).some((f) => f.name.toLowerCase().includes(q))
    )
  }

  return (
    <div style={{ display: "flex", "flex-direction": "row", width: "100%", height: "100%", background: "#ffffff" }}>

      {/* ── Left panel: file tree ── */}
      <div style={{
        width: "240px",
        "flex-shrink": "0",
        "border-right": "1px solid #e5e5e5",
        "overflow-y": "auto",
        display: "flex",
        "flex-direction": "column",
      }}>
        {/* Search */}
        <div style={{ padding: "8px 10px", "border-bottom": "1px solid #e5e5e5" }}>
          <div style={{ position: "relative", display: "flex", "align-items": "center" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a3a3a3" stroke-width="2" stroke-linecap="round"
              style={{ position: "absolute", left: "8px", "flex-shrink": "0" }}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              placeholder="Search code"
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
              style={{
                width: "100%",
                "box-sizing": "border-box",
                padding: "5px 8px 5px 26px",
                "font-family": MONO,
                "font-size": "11px",
                color: "#0a0a0a",
                background: "#f5f5f5",
                border: "1px solid #e5e5e5",
                "border-radius": "6px",
                outline: "none",
              }}
            />
          </div>
        </div>

        {/* Tree */}
        <div style={{ flex: "1", "overflow-y": "auto" }}>
          <Show when={nodes?.loading || tree?.loading}>
            <div style={{ padding: "16px 12px", "font-size": "11px", color: "#a3a3a3", "font-family": MONO }}>Loading…</div>
          </Show>

          {/* Brain mode: indexed nodes */}
          <Show when={props.mode === "brain"}>
            <For each={filteredNodes()}>
              {(node) => {
                const indent = node.depth * 16
                const files = parseFilesJson(node)
                const isCollapsed = () => collapsedNodes().has(node.path)
                return (
                  <>
                    <div
                      onClick={() => setCollapsedNodes((prev) => { const n = new Set(prev); n.has(node.path) ? n.delete(node.path) : n.add(node.path); return n })}
                      style={{ display: "flex", "align-items": "center", gap: "6px", height: "32px", padding: `0 10px 0 ${10 + indent}px`, "font-family": MONO, "font-size": "11px", color: "#374151", cursor: "pointer" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "#f5f5f5" }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}
                    >
                      {/* Chevron */}
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#a3a3a3" stroke-width="2.5" stroke-linecap="round" style={{ "flex-shrink": "0", transition: "transform 120ms", transform: isCollapsed() ? "rotate(-90deg)" : "rotate(0deg)" }}><polyline points="6 9 12 15 18 9"/></svg>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#d68a2e" stroke-width="2" stroke-linecap="round" style={{ "flex-shrink": "0" }}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                      <span style={{ overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>{node.name}/</span>
                    </div>
                    <Show when={!isCollapsed()}>
                      <For each={files}>
                        {(file) => {
                          const isActive = () => activeFile() === file.path
                          return (
                            <div onClick={() => openFile(file.path)} style={{ display: "flex", "align-items": "center", gap: "6px", height: "32px", padding: `0 10px 0 ${10 + indent + 26}px`, "font-family": MONO, "font-size": "11px", color: isActive() ? "#d68a2e" : "#374151", background: isActive() ? "#fff8f0" : "transparent", "border-left": isActive() ? "2px solid #d68a2e" : "2px solid transparent", cursor: "pointer" }}
                              onMouseEnter={(e) => { if (!isActive()) e.currentTarget.style.background = "#f5f5f5" }}
                              onMouseLeave={(e) => { if (!isActive()) e.currentTarget.style.background = "transparent" }}>
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style={{ "flex-shrink": "0" }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                              <span style={{ overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>{file.name}</span>
                            </div>
                          )
                        }}
                      </For>
                    </Show>
                  </>
                )
              }}
            </For>
          </Show>

          {/* Code mode: real repo tree */}
          <Show when={props.mode === "code"}>
            <For each={flattenTree(tree()?.entries ?? [], collapsed())}>
              {(entry) => {
                const indent = entry.depth * 16
                const isActive = () => entry.type === "file" && activeFile() === entry.path
                const isCollapsed = () => entry.type === "dir" && collapsed().has(entry.path)
                if (entry.type === "dir") {
                  return (
                    <div
                      onClick={() => toggleFolder(entry.path)}
                      style={{ display: "flex", "align-items": "center", gap: "6px", height: "32px", padding: `0 10px 0 ${10 + indent}px`, "font-family": MONO, "font-size": "11px", color: "#374151", cursor: "pointer" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "#f5f5f5" }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#a3a3a3" stroke-width="2.5" stroke-linecap="round" style={{ "flex-shrink": "0", transition: "transform 120ms", transform: isCollapsed() ? "rotate(-90deg)" : "rotate(0deg)" }}><polyline points="6 9 12 15 18 9"/></svg>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#737373" stroke-width="2" stroke-linecap="round" style={{ "flex-shrink": "0" }}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                      <span style={{ overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>{entry.name}</span>
                    </div>
                  )
                }
                return (
                  <div onClick={() => openFile(entry.path)} style={{ display: "flex", "align-items": "center", gap: "6px", height: "32px", padding: `0 10px 0 ${10 + indent + 10}px`, "font-family": MONO, "font-size": "11px", color: isActive() ? "#d68a2e" : "#374151", background: isActive() ? "#fff8f0" : "transparent", "border-left": isActive() ? "2px solid #d68a2e" : "2px solid transparent", cursor: "pointer" }}
                    onMouseEnter={(e) => { if (!isActive()) e.currentTarget.style.background = "#f5f5f5" }}
                    onMouseLeave={(e) => { if (!isActive()) e.currentTarget.style.background = "transparent" }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style={{ "flex-shrink": "0" }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <span style={{ overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>{entry.name}</span>
                  </div>
                )
              }}
            </For>
          </Show>
        </div>
      </div>

      {/* ── Right panel: editor ── */}
      <div style={{ flex: "1", display: "flex", "flex-direction": "column", overflow: "hidden" }}>

        {/* Tab bar */}
        <div style={{
          height: "36px",
          "flex-shrink": "0",
          "border-bottom": "1px solid #e5e5e5",
          display: "flex",
          "align-items": "center",
          "overflow-x": "auto",
          background: "#fafafa",
        }}>
          <For each={openFiles()}>
            {(path) => {
              const isActive = () => activeFile() === path
              return (
                <div
                  onClick={() => setActiveFile(path)}
                  style={{
                    display: "flex",
                    "align-items": "center",
                    gap: "6px",
                    padding: "0 12px",
                    height: "100%",
                    "font-family": MONO,
                    "font-size": "11px",
                    color: isActive() ? "#0a0a0a" : "#a3a3a3",
                    background: isActive() ? "#ffffff" : "transparent",
                    "border-bottom": isActive() ? "2px solid #d68a2e" : "2px solid transparent",
                    "border-right": "1px solid #e5e5e5",
                    cursor: "pointer",
                    "white-space": "nowrap",
                    "flex-shrink": "0",
                  }}
                >
                  <span>{getFileName(path)}</span>
                  <button
                    type="button"
                    onClick={(e) => closeTab(path, e)}
                    style={{
                      background: "none", border: "none", padding: "0 2px",
                      cursor: "pointer", color: "#a3a3a3", "font-size": "13px",
                      "line-height": "1", display: "flex", "align-items": "center",
                    }}
                  >×</button>
                </div>
              )
            }}
          </For>
        </div>

        {/* Content area */}
        <div style={{ flex: "1", overflow: "auto", background: "#ffffff" }}>
          <Show
            when={activeFile()}
            fallback={
              <div style={{ display: "flex", "align-items": "center", "justify-content": "center", height: "100%", color: "#a3a3a3", "font-family": SANS, "font-size": "13px" }}>
                Select a file to view its contents
              </div>
            }
          >
            <Show when={fileContent.loading}>
              <div style={{ padding: "24px", color: "#a3a3a3", "font-family": MONO, "font-size": "12px" }}>Loading…</div>
            </Show>
            <Show when={!fileContent.loading && fileContent()}>
              {(_) => {
                const data = fileContent()!
                const lines = (data.content ?? "").split("\n")
                const fileName = getFileName(data.path)
                const isMd = fileName.endsWith(".md")
                return (
                  <div>
                    {/* Header line */}
                    <div style={{
                      padding: "8px 16px 8px 56px",
                      "font-family": MONO,
                      "font-size": "11px",
                      color: "#a3a3a3",
                      "border-bottom": "1px solid #f0f0f0",
                      background: "#fafafa",
                    }}>
                      {">"} raw · {fileName}
                    </div>
                    {/* First line for .md */}
                    <Show when={isMd}>
                      <div style={{
                        padding: "8px 16px 4px 56px",
                        "font-family": MONO,
                        "font-size": "12px",
                        color: "#d68a2e",
                        "font-weight": "600",
                      }}>
                        # {fileName} · L0
                      </div>
                    </Show>
                    {/* Lines */}
                    <div style={{ display: "flex", "flex-direction": "column" }}>
                      <For each={lines}>
                        {(line, i) => (
                          <div style={{ display: "flex", "min-height": "20px" }}>
                            <div style={{
                              width: "40px",
                              "flex-shrink": "0",
                              "text-align": "right",
                              "padding-right": "12px",
                              "font-family": MONO,
                              "font-size": "12px",
                              color: "#a3a3a3",
                              "line-height": "20px",
                              "user-select": "none",
                            }}>
                              {i() + 1}
                            </div>
                            <div style={{
                              flex: "1",
                              "font-family": MONO,
                              "font-size": "12px",
                              color: "#0a0a0a",
                              "white-space": "pre-wrap",
                              "word-break": "break-all",
                              "line-height": "20px",
                              "padding-right": "16px",
                            }}>
                              {line}
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                )
              }}
            </Show>
          </Show>
        </div>
      </div>
    </div>
  )
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function LegendItem(props: { color: string; label: string }) {
  return (
    <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
      <div style={{ width: "8px", height: "8px", "border-radius": "50%", background: props.color, "flex-shrink": "0" }} />
      <span style={{ "font-size": "11px", color: "#6b7280" }}>{props.label}</span>
    </div>
  )
}

// ── Shared style objects ──────────────────────────────────────────────────────

const iconBtnStyle: Record<string, string> = {
  background: "none",
  border: "none",
  padding: "6px",
  cursor: "pointer",
  color: "#6b7280",
  display: "flex",
  "align-items": "center",
  "justify-content": "center",
  "border-radius": "6px",
}

const pillBtnStyle: Record<string, string> = {
  display: "flex",
  "align-items": "center",
  gap: "5px",
  padding: "5px 10px",
  "border-radius": "6px",
  "font-size": "12px",
  "font-weight": "500",
  cursor: "pointer",
  border: "none",
  background: "none",
}

const filterPillStyle: Record<string, string> = {
  display: "flex",
  "align-items": "center",
  gap: "4px",
  padding: "5px 10px",
  "border-radius": "999px",
  "font-size": "12px",
  color: "#374151",
  cursor: "pointer",
  border: "1px solid transparent",
  background: "none",
}

const badgeStyle: Record<string, string> = {
  padding: "3px 10px",
  "border-radius": "999px",
  "font-size": "11px",
  "font-weight": "500",
  "white-space": "nowrap",
}
