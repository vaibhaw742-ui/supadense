import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { elApi, type LocalProject, type GithubPR, type GithubIssue } from "./el-api"
import { WikiGraph } from "@/pages/wiki/wiki-graph"
import type { GraphData } from "@/pages/wiki/wiki-api"
import { setBrainGraphOpen, brainViewMode, setBrainViewMode } from "@/context/sidebar-view"

const AMBER = "#d68a2e"

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

function layerColor(layer: string): string {
  if (layer === "L0") return "#6366f1"
  if (layer === "L1") return "#0891b2"
  return "#16a34a"
}

function groupByLayer(files: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = { L0: [], L1: [], L2: [] }
  for (const f of files) {
    const layer = f.split("/")[0]
    if (layer === "L0" || layer === "L1" || layer === "L2") {
      groups[layer].push(f)
    }
  }
  return groups
}

function mcpJson(project: LocalProject): string {
  return JSON.stringify({
    mcpServers: {
      "supadense-brain": {
        command: "bun",
        args: ["run", "/path/to/supadense/packages/opencode/src/brain/mcp/stdio.ts"],
        env: {
          SUPADENSE_URL: "http://localhost:4096",
          SUPADENSE_TOKEN: "YOUR_JWT_TOKEN",
          SUPADENSE_PROJECT: project.id,
        },
      },
    },
  }, null, 2)
}

export default function LocalProjectView() {
  const params = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [copied, setCopied] = createSignal(false)
  const [selectedFile, setSelectedFile] = createSignal<string | null>(null)
  const [showGraph, _setShowGraph] = createSignal(false)
  const [deinitConfirm, setDeinitConfirm] = createSignal(false)
  const [deiniting, setDeiniting] = createSignal(false)
  const [deinitDone, setDeinitDone] = createSignal<string | null>(null) // holds local_path after deinit
  const setShowGraph = (v: boolean) => { _setShowGraph(v); setBrainGraphOpen(v); if (!v) setBrainViewMode("graph") }
  onCleanup(() => { setBrainGraphOpen(false); setBrainViewMode("graph") })

  const [project, { refetch: refetchProject }] = createResource(() => params.id, (id) => elApi.getLocalProject(id))
  const [sources, { refetch: refetchSources }] = createResource(() => params.id, (id) => elApi.getLocalProjectSources(id))

  // Live sync: subscribe to SSE change events from the backend watcher
  createEffect(() => {
    const id = params.id
    if (!id) return
    const unsub = elApi.watchLocalProject(id, () => {
      void refetchProject()
      void refetchSources()
    })
    onCleanup(unsub)
  })
  const [graphData] = createResource(() => params.id, (id) => elApi.getLocalProjectGraph(id))
  const [githubActivity, { refetch: refetchActivity }] = createResource(
    () => params.id,
    (id) => elApi.getGithubActivity(id).catch(() => null),
  )
  const [githubRepoInput, setGithubRepoInput] = createSignal("")
  const [savingRepo, setSavingRepo] = createSignal(false)
  const [fileContent, { refetch: refetchFile }] = createResource(
    () => selectedFile() ? { id: params.id, path: selectedFile()! } : null,
    (args) => elApi.getLocalProjectBrainFile(args.id, args.path),
  )

  const wikiGraphData = (): GraphData | null => {
    const g = graphData()
    if (!g || g.nodes.length === 0) return null
    return {
      nodes: g.nodes.map(n => ({
        id: n.id,
        type: n.type as any,
        label: n.label,
      })),
      edges: g.edges,
    }
  }

  function refetch() {
    void refetchProject()
    void refetchSources()
  }

  async function copyMcp() {
    const p = project()
    if (!p) return
    try {
      await navigator.clipboard.writeText(mcpJson(p))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  async function handleDeinit() {
    if (deiniting()) return
    setDeiniting(true)
    const localPath = project()?.local_path ?? null
    try {
      // Only unregister from DB — disk deletion must be done on the host via CLI
      await elApi.deleteLocalProject(params.id, { deleteDisk: false })
      setBrainGraphOpen(false)
      setBrainViewMode("graph")
      setDeinitDone(localPath)
    } catch (e) {
      console.error("Deinit failed", e)
      setDeiniting(false)
      setDeinitConfirm(false)
    }
  }

  // Post-deinit screen — shown after DB record removed, guides user to run CLI for disk cleanup
  if (deinitDone() !== null) {
    const path = deinitDone()!
    return (
      <div style={{ "min-height": "100vh", background: "#ffffff", "font-family": "'Geist', 'Inter', sans-serif", display: "flex", "align-items": "center", "justify-content": "center" }}>
        <div style={{ "max-width": "520px", padding: "40px", "text-align": "center" }}>
          <div style={{ width: "48px", height: "48px", "border-radius": "50%", background: "#f0fdf4", border: "1px solid #bbf7d0", display: "flex", "align-items": "center", "justify-content": "center", margin: "0 auto 20px" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <h2 style={{ margin: "0 0 8px", "font-size": "20px", "font-weight": "700", color: "#0a0a0a" }}>Project unregistered</h2>
          <p style={{ margin: "0 0 24px", "font-size": "13px", color: "#737373", "line-height": "1.6" }}>
            The project has been removed from Supadense.<br/>
            The <code style={{ background: "#f5f5f5", padding: "1px 5px", "border-radius": "3px", "font-size": "12px" }}>.supadense/</code> folder still exists on disk.
          </p>
          <div style={{ background: "#0a0a0a", "border-radius": "8px", padding: "14px 18px", "text-align": "left", "margin-bottom": "24px" }}>
            <div style={{ "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#737373", "margin-bottom": "6px" }}>
              Run in your project folder to remove .supadense/ from disk:
            </div>
            <code style={{ "font-family": "'Geist Mono', monospace", "font-size": "13px", color: "#d68a2e", display: "block" }}>
              cd {path}
            </code>
            <code style={{ "font-family": "'Geist Mono', monospace", "font-size": "13px", color: "#ffffff", display: "block" }}>
              supadense deinit --disk-only
            </code>
          </div>
          <button
            type="button"
            onClick={() => navigate("/")}
            style={{
              padding: "8px 20px", "border-radius": "6px", border: "1px solid #e5e5e5",
              background: "none", cursor: "pointer", "font-family": "'Geist Mono', monospace",
              "font-size": "12px", color: "#525252", transition: "all 120ms",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "#a3a3a3" }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "#e5e5e5" }}
          >
            ← Back to projects
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ "min-height": "100vh", background: "#ffffff", "font-family": "'Geist', 'Inter', sans-serif" }}>
      {/* Header */}
      <div style={{ "border-bottom": "1px solid #f0f0f0", padding: "24px 40px" }}>
        <Show when={project.loading}>
          <div style={{ height: "32px", width: "200px", background: "#f5f5f5", "border-radius": "6px" }} />
        </Show>
        <Show when={!project.loading && project()}>
          {(p) => (
            <>
              <div style={{ display: "flex", "align-items": "center", gap: "12px", "margin-bottom": "8px" }}>
                <span style={{
                  "font-family": "'Geist Mono', monospace", "font-size": "10px", "font-weight": "600",
                  "letter-spacing": "0.08em", color: AMBER, border: `1px solid ${AMBER}`,
                  "border-radius": "4px", padding: "2px 8px",
                }}>LOCAL PROJECT</span>
                <span style={{
                  "font-family": "'Geist Mono', monospace", "font-size": "10px", "font-weight": "600",
                  "letter-spacing": "0.08em", color: "#6366f1", border: "1px solid #6366f1",
                  "border-radius": "4px", padding: "2px 8px",
                }}>CLI</span>
              </div>
              <div style={{ display: "flex", "align-items": "center", gap: "16px", "flex-wrap": "wrap" }}>
                <h1 style={{ margin: "0", "font-size": "28px", "font-weight": "700", color: "#0a0a0a" }}>
                  {p().name}
                </h1>
                <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "12px", color: "#a3a3a3" }}>
                  {p().local_path}
                </span>
              </div>
              <div style={{ display: "flex", gap: "8px", "margin-top": "16px", "flex-wrap": "wrap" }}>
                <button
                  type="button"
                  onClick={refetch}
                  style={{
                    display: "inline-flex", "align-items": "center", gap: "6px",
                    padding: "6px 14px", border: "1px solid #e5e5e5", "border-radius": "6px",
                    background: "transparent", cursor: "pointer",
                    "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#525252",
                    transition: "border-color 120ms",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "#a3a3a3" }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "#e5e5e5" }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/>
                  </svg>
                  Refresh
                </button>

                {/* View Brain Graph button */}
                <button
                  type="button"
                  onClick={() => setShowGraph(true)}
                  style={{
                    display: "inline-flex", "align-items": "center", gap: "6px",
                    padding: "6px 14px", border: `1px solid ${AMBER}`,
                    "border-radius": "6px", background: "rgba(214,138,46,0.06)", cursor: "pointer",
                    "font-family": "'Geist Mono', monospace", "font-size": "11px", "font-weight": "600",
                    color: AMBER, transition: "all 120ms",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(214,138,46,0.14)" }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(214,138,46,0.06)" }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="3"/>
                    <circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/>
                    <circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>
                    <line x1="10" y1="10" x2="7" y2="7"/><line x1="14" y1="10" x2="17" y2="7"/>
                    <line x1="10" y1="14" x2="7" y2="17"/><line x1="14" y1="14" x2="17" y2="17"/>
                  </svg>
                  View Brain Graph
                </button>

                <button
                  type="button"
                  onClick={copyMcp}
                  style={{
                    display: "inline-flex", "align-items": "center", gap: "6px",
                    padding: "6px 14px", border: `1px solid ${copied() ? "#16a34a" : "#e5e5e5"}`,
                    "border-radius": "6px", background: "transparent", cursor: "pointer",
                    "font-family": "'Geist Mono', monospace", "font-size": "11px",
                    color: copied() ? "#16a34a" : "#525252", transition: "all 120ms",
                  }}
                >
                  {copied() ? "✓ Copied!" : "Copy .mcp.json snippet"}
                </button>
              </div>
            </>
          )}
        </Show>
        <Show when={!project.loading && !project()}>
          <div style={{ "font-family": "'Geist Mono', monospace", color: "#dc2626" }}>Project not found</div>
        </Show>
      </div>

      {/* Body */}
      <Show when={!project.loading && project()}>
        {(p) => {
          const groups = () => groupByLayer(p().brain_files ?? [])
          const totalFiles = () => (p().brain_files ?? []).length

          return (
            <>
            <div style={{ display: "flex", gap: "0", "max-width": "1200px", margin: "0 auto", padding: "32px 40px", "flex-wrap": "wrap" }}>
              {/* Left column: Brain + Sources */}
              <div style={{ flex: "1", "min-width": "0", "margin-right": "40px" }}>

                {/* Brain section */}
                <section style={{ "margin-bottom": "48px" }}>
                  <div style={{ display: "flex", "align-items": "center", gap: "12px", "margin-bottom": "20px" }}>
                    <h2 style={{ margin: "0", "font-size": "14px", "font-weight": "700", "letter-spacing": "0.06em", color: "#0a0a0a", "text-transform": "uppercase" }}>
                      Brain
                    </h2>
                    <span style={{
                      "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#a3a3a3",
                      border: "1px solid #e5e5e5", "border-radius": "4px", padding: "1px 7px",
                    }}>
                      {totalFiles()} {totalFiles() === 1 ? "file" : "files"}
                    </span>
                  </div>

                  <Show when={totalFiles() === 0}>
                    <div style={{
                      padding: "32px", "border-radius": "8px", border: "1px dashed #e5e5e5",
                      "text-align": "center", "font-family": "'Geist Mono', monospace",
                      "font-size": "12px", color: "#a3a3a3", "line-height": "1.6",
                    }}>
                      No brain files yet — start a Claude Code session in this repo
                    </div>
                  </Show>

                  <Show when={totalFiles() > 0}>
                    <For each={["L0", "L1", "L2"]}>
                      {(layer) => (
                        <Show when={groups()[layer].length > 0}>
                          <div style={{ "margin-bottom": "24px" }}>
                            <div style={{ display: "flex", "align-items": "center", gap: "8px", "margin-bottom": "8px" }}>
                              <span style={{
                                "font-family": "'Geist Mono', monospace", "font-size": "10px", "font-weight": "700",
                                "letter-spacing": "0.08em", color: layerColor(layer),
                                border: `1px solid ${layerColor(layer)}`, "border-radius": "4px",
                                padding: "1px 7px",
                              }}>{layer}</span>
                              <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#a3a3a3" }}>
                                {groups()[layer].length} {groups()[layer].length === 1 ? "file" : "files"}
                              </span>
                            </div>
                            <div style={{ border: "1px solid #f0f0f0", "border-radius": "8px", overflow: "hidden" }}>
                              <For each={groups()[layer]}>
                                {(file, i) => {
                                  const filename = file.split("/").pop() ?? file
                                  const isSelected = () => selectedFile() === file
                                  return (
                                    <div
                                      onClick={() => {
                                        setSelectedFile(isSelected() ? null : file)
                                      }}
                                      style={{
                                        display: "flex", "align-items": "center", gap: "10px",
                                        padding: "10px 14px",
                                        "border-top": i() > 0 ? "1px solid #f0f0f0" : "none",
                                        cursor: "pointer",
                                        background: isSelected() ? "rgba(214,138,46,0.04)" : "transparent",
                                        transition: "background 100ms",
                                      }}
                                      onMouseEnter={(e) => { if (!isSelected()) (e.currentTarget as HTMLElement).style.background = "#fafafa" }}
                                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = isSelected() ? "rgba(214,138,46,0.04)" : "transparent" }}
                                    >
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a3a3a3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                        <polyline points="14 2 14 8 20 8"/>
                                      </svg>
                                      <span style={{ flex: "1", "font-family": "'Geist Mono', monospace", "font-size": "12px", color: "#0a0a0a" }}>
                                        {filename}
                                      </span>
                                      <span style={{
                                        "font-family": "'Geist Mono', monospace", "font-size": "9px", "font-weight": "700",
                                        "letter-spacing": "0.08em", color: layerColor(layer),
                                        border: `1px solid ${layerColor(layer)}`, "border-radius": "3px",
                                        padding: "0 5px",
                                      }}>{layer}</span>
                                    </div>
                                  )
                                }}
                              </For>
                            </div>
                          </div>
                        </Show>
                      )}
                    </For>
                  </Show>

                  {/* File content preview */}
                  <Show when={selectedFile()}>
                    <div style={{ "margin-top": "16px", border: "1px solid #e5e5e5", "border-radius": "8px", overflow: "hidden" }}>
                      <div style={{
                        display: "flex", "align-items": "center", "justify-content": "space-between",
                        padding: "10px 14px", background: "#fafafa", "border-bottom": "1px solid #f0f0f0",
                      }}>
                        <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#525252" }}>
                          {selectedFile()}
                        </span>
                        <button
                          type="button"
                          onClick={() => setSelectedFile(null)}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "#a3a3a3", "font-size": "16px", "line-height": "1", padding: "0 4px" }}
                        >×</button>
                      </div>
                      <Show when={fileContent.loading}>
                        <div style={{ padding: "24px", "font-family": "'Geist Mono', monospace", "font-size": "12px", color: "#a3a3a3" }}>Loading…</div>
                      </Show>
                      <Show when={!fileContent.loading && fileContent()}>
                        <pre style={{
                          margin: "0", padding: "16px", "font-family": "'Geist Mono', monospace",
                          "font-size": "12px", "line-height": "1.6", color: "#0a0a0a",
                          "overflow-x": "auto", "white-space": "pre-wrap", "word-break": "break-word",
                          "max-height": "400px", overflow: "auto",
                        }}>
                          {fileContent()!.content}
                        </pre>
                      </Show>
                    </div>
                  </Show>
                </section>

                {/* Sources section */}
                <section>
                  <div style={{ display: "flex", "align-items": "center", gap: "12px", "margin-bottom": "20px" }}>
                    <h2 style={{ margin: "0", "font-size": "14px", "font-weight": "700", "letter-spacing": "0.06em", color: "#0a0a0a", "text-transform": "uppercase" }}>
                      Sources
                    </h2>
                    <Show when={!sources.loading && (sources()?.length ?? 0) > 0}>
                      <span style={{
                        "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#a3a3a3",
                        border: "1px solid #e5e5e5", "border-radius": "4px", padding: "1px 7px",
                      }}>
                        {sources()!.length} {sources()!.length === 1 ? "file" : "files"}
                      </span>
                    </Show>
                  </div>

                  <Show when={sources.loading}>
                    <div style={{ height: "80px", background: "#f5f5f5", "border-radius": "8px" }} />
                  </Show>

                  <Show when={!sources.loading && (sources()?.length ?? 0) === 0}>
                    <div style={{
                      padding: "32px", "border-radius": "8px", border: "1px dashed #e5e5e5",
                      "text-align": "center", "font-family": "'Geist Mono', monospace",
                      "font-size": "12px", color: "#a3a3a3", "line-height": "1.6",
                    }}>
                      No sources captured yet — use /capture in Claude Code
                    </div>
                  </Show>

                  <Show when={!sources.loading && (sources()?.length ?? 0) > 0}>
                    <div style={{ border: "1px solid #f0f0f0", "border-radius": "8px", overflow: "hidden" }}>
                      <For each={sources() ?? []}>
                        {(file, i) => (
                          <div style={{
                            display: "flex", "align-items": "center", gap: "10px",
                            padding: "10px 14px",
                            "border-top": i() > 0 ? "1px solid #f0f0f0" : "none",
                          }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                              stroke={file.status === "processing" ? "#a3a3a3" : file.status === "failed" ? "#ef4444" : "#d68a2e"}
                              stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                              <polyline points="14 2 14 8 20 8"/>
                            </svg>
                            <span style={{
                              flex: "1", "font-family": "'Geist Mono', monospace", "font-size": "12px",
                              color: file.status === "processing" ? "#a3a3a3" : file.status === "failed" ? "#ef4444" : "#0a0a0a",
                              overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap",
                            }} title={file.title + (file.url ? `\n${file.url}` : "")}>
                              {file.title}
                            </span>
                            <Show when={file.status === "processing"}>
                              <span style={{ "font-size": "10px", color: "#a3a3a3", "flex-shrink": "0", "font-family": "'Geist Mono', monospace" }}>processing…</span>
                            </Show>
                            <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#a3a3a3", "flex-shrink": "0" }}>
                              {formatSize(file.size)}
                            </span>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </section>
              </div>

              {/* Right rail: Info */}
              <div style={{ width: "280px", "flex-shrink": "0" }}>
                <div style={{ border: "1px solid #f0f0f0", "border-radius": "10px", overflow: "hidden" }}>
                  <div style={{ padding: "14px 16px", background: "#fafafa", "border-bottom": "1px solid #f0f0f0" }}>
                    <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", "font-weight": "700", "letter-spacing": "0.08em", color: "#a3a3a3" }}>
                      PROJECT INFO
                    </span>
                  </div>
                  <div style={{ padding: "16px" }}>
                    <InfoRow label="ID" value={p().id} mono />
                    <InfoRow label="Local Path" value={p().local_path} mono small />
                    <InfoRow label="Brain Dir" value={p().brain_dir.replace(p().local_path, ".")} mono small />
                    <InfoRow label="Source ID" value={p().source_id} mono small />
                  </div>
                </div>

                {/* MCP snippet preview */}
                <div style={{ "margin-top": "16px", border: "1px solid #f0f0f0", "border-radius": "10px", overflow: "hidden" }}>
                  <div style={{ padding: "14px 16px", background: "#fafafa", "border-bottom": "1px solid #f0f0f0", display: "flex", "align-items": "center", "justify-content": "space-between" }}>
                    <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", "font-weight": "700", "letter-spacing": "0.08em", color: "#a3a3a3" }}>
                      .mcp.json SNIPPET
                    </span>
                    <button
                      type="button"
                      onClick={copyMcp}
                      style={{
                        background: "none", border: "none", cursor: "pointer", padding: "0",
                        "font-family": "'Geist Mono', monospace", "font-size": "10px",
                        color: copied() ? "#16a34a" : AMBER, transition: "color 120ms",
                      }}
                    >
                      {copied() ? "copied!" : "copy"}
                    </button>
                  </div>
                  <pre style={{
                    margin: "0", padding: "12px 16px",
                    "font-family": "'Geist Mono', monospace", "font-size": "10px",
                    "line-height": "1.5", color: "#525252",
                    "overflow-x": "auto", "white-space": "pre-wrap", "word-break": "break-all",
                  }}>
                    {mcpJson(p())}
                  </pre>
                </div>

                {/* GitHub Activity card — removed */}
                <div style={{ display: "none" }}>
                  <div style={{ padding: "12px 16px", background: "#fafafa", "border-bottom": "1px solid #f0f0f0", display: "flex", "align-items": "center", "justify-content": "space-between" }}>
                    <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ color: "#0a0a0a" }}>
                        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
                      </svg>
                      <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", "font-weight": "700", "letter-spacing": "0.08em", color: "#a3a3a3" }}>
                        GITHUB ACTIVITY
                      </span>
                    </div>
                    <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                      <Show when={githubActivity()?.repo}>
                        <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", color: "#737373" }}>
                          {githubActivity()!.repo}
                        </span>
                      </Show>
                      <button
                        type="button"
                        onClick={() => void refetchActivity()}
                        title="Refresh"
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#a3a3a3", display: "flex", "align-items": "center", padding: "0", transition: "color 120ms" }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#525252" }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#a3a3a3" }}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                          <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* No repo linked */}
                  <Show when={!githubActivity.loading && !githubActivity()?.repo && !p().github_repo}>
                    <div style={{ padding: "14px 16px" }}>
                      <p style={{ margin: "0 0 10px", "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#a3a3a3", "line-height": "1.5" }}>
                        No GitHub repo linked. Enter owner/repo:
                      </p>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <input
                          type="text"
                          placeholder="owner/repo"
                          value={githubRepoInput()}
                          onInput={e => setGithubRepoInput(e.currentTarget.value)}
                          onKeyDown={async e => {
                            if (e.key === "Enter" && githubRepoInput().trim()) {
                              setSavingRepo(true)
                              try {
                                await elApi.setGithubRepo(params.id, githubRepoInput().trim())
                                await refetchActivity()
                              } catch { /* ignore */ } finally { setSavingRepo(false) }
                            }
                          }}
                          style={{
                            flex: "1", "font-family": "'Geist Mono', monospace", "font-size": "11px",
                            padding: "5px 8px", border: "1px solid #e5e5e5", "border-radius": "5px",
                            background: "#fafafa", color: "#0a0a0a", outline: "none", "min-width": "0",
                          }}
                        />
                        <button
                          type="button"
                          disabled={savingRepo() || !githubRepoInput().trim()}
                          onClick={async () => {
                            if (!githubRepoInput().trim()) return
                            setSavingRepo(true)
                            try {
                              await elApi.setGithubRepo(params.id, githubRepoInput().trim())
                              await refetchActivity()
                            } catch { /* ignore */ } finally { setSavingRepo(false) }
                          }}
                          style={{
                            padding: "5px 10px", "border-radius": "5px", border: "none",
                            background: AMBER, color: "#fff", cursor: savingRepo() ? "not-allowed" : "pointer",
                            "font-family": "'Geist Mono', monospace", "font-size": "11px", "font-weight": "600",
                            opacity: savingRepo() ? "0.6" : "1", transition: "opacity 120ms",
                          }}
                        >
                          {savingRepo() ? "…" : "Link"}
                        </button>
                      </div>
                    </div>
                  </Show>

                  {/* Loading */}
                  <Show when={githubActivity.loading}>
                    <div style={{ padding: "14px 16px", "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#a3a3a3" }}>Loading…</div>
                  </Show>

                  {/* Activity loaded */}
                  <Show when={!githubActivity.loading && githubActivity()?.repo}>
                    {(_) => {
                      const act = () => githubActivity()!
                      return (
                        <div>
                          {/* Summary row */}
                          <div style={{ padding: "10px 16px", display: "flex", gap: "16px", "border-bottom": "1px solid #f0f0f0" }}>
                            <div style={{ display: "flex", "align-items": "center", gap: "5px" }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{ color: "#16a34a" }}>
                                <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/>
                                <path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M11 18H8a2 2 0 0 1-2-2V9"/>
                              </svg>
                              <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "11px", "font-weight": "600", color: "#0a0a0a" }}>{act().prs.length}</span>
                              <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#737373" }}>PRs</span>
                            </div>
                            <div style={{ display: "flex", "align-items": "center", gap: "5px" }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{ color: "#6366f1" }}>
                                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                              </svg>
                              <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "11px", "font-weight": "600", color: "#0a0a0a" }}>{act().issues.length}</span>
                              <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#737373" }}>issues</span>
                            </div>
                          </div>

                          {/* PRs */}
                          <Show when={act().prs.length > 0}>
                            <div style={{ padding: "8px 0" }}>
                              <For each={act().prs}>
                                {(pr) => (
                                  <a
                                    href={pr.url} target="_blank" rel="noopener noreferrer"
                                    style={{ display: "flex", "align-items": "flex-start", gap: "8px", padding: "7px 16px", "text-decoration": "none", transition: "background 100ms" }}
                                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#fafafa" }}
                                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent" }}
                                  >
                                    <span style={{
                                      "font-family": "'Geist Mono', monospace", "font-size": "9px", "font-weight": "700",
                                      padding: "2px 5px", "border-radius": "3px", "white-space": "nowrap", "flex-shrink": "0", "margin-top": "1px",
                                      background: pr.state === "draft" ? "#f5f5f5" : "rgba(22,163,74,0.08)",
                                      color: pr.state === "draft" ? "#a3a3a3" : "#16a34a",
                                      border: `1px solid ${pr.state === "draft" ? "#e5e5e5" : "rgba(22,163,74,0.25)"}`,
                                    }}>
                                      #{pr.number}
                                    </span>
                                    <div style={{ flex: "1", "min-width": "0" }}>
                                      <div style={{ "font-family": "'Geist Mono', monospace", "font-size": "11px", "font-weight": "500", color: "#0a0a0a", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                                        {pr.title}
                                      </div>
                                      <div style={{ display: "flex", "align-items": "center", gap: "6px", "margin-top": "3px", "flex-wrap": "wrap" }}>
                                        <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", color: "#a3a3a3" }}>@{pr.author}</span>
                                        <Show when={pr.state === "draft"}>
                                          <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "9px", color: "#a3a3a3", border: "1px solid #e5e5e5", "border-radius": "3px", padding: "0 4px" }}>DRAFT</span>
                                        </Show>
                                        <Show when={pr.reviews === "approved"}>
                                          <span style={{ "font-size": "10px" }}>✓</span>
                                          <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "9px", color: "#16a34a" }}>approved</span>
                                        </Show>
                                        <Show when={pr.reviews === "changes_requested"}>
                                          <span style={{ "font-size": "10px" }}>⚠</span>
                                          <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "9px", color: "#dc2626" }}>changes requested</span>
                                        </Show>
                                        <Show when={pr.comments > 0}>
                                          <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "9px", color: "#a3a3a3" }}>{pr.comments} 💬</span>
                                        </Show>
                                      </div>
                                    </div>
                                    <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "9px", color: "#c3c3c3", "white-space": "nowrap", "flex-shrink": "0", "margin-top": "2px" }}>
                                      {relativeTime(pr.updated_at)}
                                    </span>
                                  </a>
                                )}
                              </For>
                            </div>
                          </Show>

                          {/* Issues */}
                          <Show when={act().issues.length > 0}>
                            <div style={{ "border-top": "1px solid #f5f5f5", padding: "8px 0" }}>
                              <For each={act().issues.slice(0, 8)}>
                                {(issue) => (
                                  <a
                                    href={issue.url} target="_blank" rel="noopener noreferrer"
                                    style={{ display: "flex", "align-items": "flex-start", gap: "8px", padding: "7px 16px", "text-decoration": "none", transition: "background 100ms" }}
                                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#fafafa" }}
                                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent" }}
                                  >
                                    <span style={{
                                      "font-family": "'Geist Mono', monospace", "font-size": "9px", "font-weight": "700",
                                      padding: "2px 5px", "border-radius": "3px", "white-space": "nowrap", "flex-shrink": "0", "margin-top": "1px",
                                      background: "rgba(99,102,241,0.08)", color: "#6366f1", border: "1px solid rgba(99,102,241,0.25)",
                                    }}>
                                      #{issue.number}
                                    </span>
                                    <div style={{ flex: "1", "min-width": "0" }}>
                                      <div style={{ "font-family": "'Geist Mono', monospace", "font-size": "11px", "font-weight": "500", color: "#0a0a0a", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                                        {issue.title}
                                      </div>
                                      <div style={{ display: "flex", "align-items": "center", gap: "6px", "margin-top": "3px" }}>
                                        <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", color: "#a3a3a3" }}>@{issue.author}</span>
                                        <Show when={issue.comments > 0}>
                                          <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "9px", color: "#a3a3a3" }}>{issue.comments} 💬</span>
                                        </Show>
                                        <For each={issue.labels.slice(0, 2)}>
                                          {(lbl) => (
                                            <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "9px", color: "#737373", border: "1px solid #e5e5e5", "border-radius": "3px", padding: "0 4px" }}>
                                              {lbl}
                                            </span>
                                          )}
                                        </For>
                                      </div>
                                    </div>
                                    <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "9px", color: "#c3c3c3", "white-space": "nowrap", "flex-shrink": "0", "margin-top": "2px" }}>
                                      {relativeTime(issue.updated_at)}
                                    </span>
                                  </a>
                                )}
                              </For>
                              <Show when={act().issues.length > 8}>
                                <div style={{ padding: "6px 16px 8px" }}>
                                  <a href={`https://github.com/${act().repo}/issues`} target="_blank" rel="noopener noreferrer"
                                    style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", color: AMBER, "text-decoration": "none" }}>
                                    +{act().issues.length - 8} more issues ↗
                                  </a>
                                </div>
                              </Show>
                            </div>
                          </Show>

                          <Show when={act().prs.length === 0 && act().issues.length === 0}>
                            <div style={{ padding: "16px", "text-align": "center", "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#a3a3a3" }}>
                              No open PRs or issues 🎉
                            </div>
                          </Show>

                          {/* Cache indicator */}
                          <div style={{ padding: "6px 16px 8px", "border-top": "1px solid #f5f5f5" }}>
                            <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "9px", color: "#d4d4d4" }}>
                              {act().cached ? "cached · " : ""}updated {relativeTime(new Date(act().fetched_at).toISOString())}
                            </span>
                          </div>
                        </div>
                      )
                    }}
                  </Show>
                </div>
              </div>
            </div>

            {/* Danger zone */}
            <div style={{ "max-width": "1200px", margin: "0 auto", padding: "0 40px 48px" }}>
              <div style={{ "border-top": "1px solid #fee2e2", "padding-top": "32px" }}>
                <h2 style={{ margin: "0 0 8px", "font-size": "14px", "font-weight": "700", "letter-spacing": "0.06em", color: "#dc2626", "text-transform": "uppercase" }}>
                  Danger Zone
                </h2>
                <p style={{ margin: "0 0 16px", "font-family": "'Geist Mono', monospace", "font-size": "12px", color: "#737373", "line-height": "1.6" }}>
                  Deinitializing removes the <code style={{ background: "#f5f5f5", padding: "1px 5px", "border-radius": "3px" }}>.supadense/</code> folder and unregisters this project.
                  Your source code is untouched.
                </p>
                <Show when={!deinitConfirm()}>
                  <button
                    type="button"
                    onClick={() => setDeinitConfirm(true)}
                    style={{
                      display: "inline-flex", "align-items": "center", gap: "6px",
                      padding: "7px 16px", border: "1px solid #fca5a5", "border-radius": "6px",
                      background: "transparent", cursor: "pointer",
                      "font-family": "'Geist Mono', monospace", "font-size": "12px", color: "#dc2626",
                      transition: "all 120ms",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#fef2f2" }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent" }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                      <path d="M10 11v6"/><path d="M14 11v6"/>
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                    </svg>
                    Deinitialize project
                  </button>
                </Show>
                <Show when={deinitConfirm()}>
                  <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
                    <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "12px", color: "#dc2626", "font-weight": "600" }}>
                      This will permanently delete .supadense/ — are you sure?
                    </span>
                    <button
                      type="button"
                      onClick={handleDeinit}
                      disabled={deiniting()}
                      style={{
                        padding: "6px 16px", border: "none", "border-radius": "6px",
                        background: deiniting() ? "#fca5a5" : "#dc2626", cursor: deiniting() ? "not-allowed" : "pointer",
                        "font-family": "'Geist Mono', monospace", "font-size": "12px", "font-weight": "600", color: "#fff",
                        transition: "background 120ms",
                      }}
                    >
                      {deiniting() ? "Removing…" : "Yes, deinit"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeinitConfirm(false)}
                      style={{
                        padding: "6px 14px", border: "1px solid #e5e5e5", "border-radius": "6px",
                        background: "transparent", cursor: "pointer",
                        "font-family": "'Geist Mono', monospace", "font-size": "12px", color: "#525252",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </Show>
              </div>
            </div>
            </>
          )
        }}
      </Show>
      {/* Brain Graph Overlay */}
      <Show when={showGraph()}>
        <div style={{
          position: "fixed", inset: "0", "z-index": "9999",
          background: "#ffffff",
          display: "flex", "flex-direction": "column",
        }}>
          {/* Overlay header */}
          <div style={{
            display: "flex", "align-items": "center", gap: "12px",
            padding: "12px 20px", "border-bottom": "1px solid #f0f0f0",
            "flex-shrink": "0",
          }}>
            <button
              type="button"
              onClick={() => setShowGraph(false)}
              style={{
                display: "inline-flex", "align-items": "center", gap: "6px",
                background: "none", border: "none", cursor: "pointer",
                "font-family": "'Geist Mono', monospace", "font-size": "12px", color: "#737373",
                padding: "4px 8px", "border-radius": "4px", transition: "color 120ms",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#0a0a0a" }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "#737373" }}
            >
              <span>←</span>
              <span>{project()?.name ?? "Project"}</span>
            </button>
            <span style={{ color: "#d4d4d4" }}>/</span>
            <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "12px", "font-weight": "600", color: "#0a0a0a" }}>Brain Graph</span>

            {/* Legend */}
            <div style={{ "margin-left": "auto", display: "flex", "align-items": "center", gap: "16px" }}>
              <LegendDot color="#d68a2e" label="Project" />
              <LegendDot color="#6366f1" label="L0 decisions" />
              <LegendDot color="#0891b2" label="L1 summaries" />
              <LegendDot color="#16a34a" label="L2 patterns" />
            </div>
          </div>

          {/* Main canvas: graph or file explorer */}
          <div style={{ flex: "1", position: "relative", overflow: "hidden", display: "flex" }}>
            <Show when={brainViewMode() === "graph"}>
              <div style={{ flex: "1", position: "relative", overflow: "hidden" }}>
                <Show
                  when={wikiGraphData()}
                  fallback={
                    <div style={{
                      height: "100%", display: "flex", "flex-direction": "column",
                      "align-items": "center", "justify-content": "center", gap: "16px",
                    }}>
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#e5e5e5" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="3"/>
                        <circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/>
                        <circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>
                        <line x1="10" y1="10" x2="7" y2="7"/><line x1="14" y1="10" x2="17" y2="7"/>
                        <line x1="10" y1="14" x2="7" y2="17"/><line x1="14" y1="14" x2="17" y2="17"/>
                      </svg>
                      <div style={{ "font-family": "'Geist Mono', monospace", "font-size": "13px", color: "#a3a3a3" }}>No brain files yet</div>
                      <div style={{ "font-size": "12px", color: "#b3b3b3", "text-align": "center", "max-width": "300px", "line-height": "1.6" }}>
                        Start a Claude Code session in this repo — brain knowledge will appear here as you work
                      </div>
                    </div>
                  }
                >
                  {(gd) => (
                    <WikiGraph data={() => gd()} onNavigate={() => {}} onNavigateResource={() => {}} />
                  )}
                </Show>
              </div>
            </Show>

            <Show when={brainViewMode() === "files"}>
              <BrainFileExplorer projectId={params.id} projectName={project()?.name ?? ""} brainFiles={project()?.brain_files ?? []} sources={sources() ?? []} onRefresh={() => { void refetchProject(); void refetchSources() }} />
            </Show>
          </div>

          {/* Bottom pill bar */}
          <div style={{
            "flex-shrink": "0",
            margin: "0 24px 18px",
            padding: "8px 14px",
            background: "#ffffff",
            border: "1px solid #e5e5e5",
            "border-radius": "999px",
            display: "flex", "align-items": "center", gap: "8px",
            "box-shadow": "0 12px 28px -16px rgba(0,0,0,0.12)",
            "z-index": "20",
          }}>
            {/* Project badge */}
            <span style={{
              display: "inline-flex", "align-items": "center", gap: "6px",
              "font-family": "'Geist Mono', monospace", "font-size": "11px", "font-weight": "600",
              color: AMBER, padding: "4px 10px",
              background: "rgba(214,138,46,0.08)", border: "1px solid rgba(214,138,46,0.3)",
              "border-radius": "4px",
            }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
              </svg>
              {project()?.name ?? ""}
            </span>

            <div style={{ width: "1px", height: "20px", background: "#e5e5e5" }} />

            {/* Brain file count */}
            <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#737373" }}>
              Brain files · {(project()?.brain_files ?? []).length}
            </span>

            <div style={{ width: "1px", height: "20px", background: "#e5e5e5" }} />

            {/* Layer pills */}
            <For each={[
              { layer: "L0", color: "#6366f1", label: "decisions" },
              { layer: "L1", color: "#0891b2", label: "summaries" },
              { layer: "L2", color: "#16a34a", label: "patterns" },
            ]}>
              {(item) => {
                const count = () => (project()?.brain_files ?? []).filter(f => f.startsWith(item.layer + "/")).length
                return (
                  <Show when={count() > 0}>
                    <span style={{
                      display: "inline-flex", "align-items": "center", gap: "5px",
                      "font-family": "'Geist Mono', monospace", "font-size": "10px", "font-weight": "600",
                      color: item.color, padding: "3px 8px",
                      background: `${item.color}14`, border: `1px solid ${item.color}40`,
                      "border-radius": "4px",
                    }}>
                      <span style={{ width: "6px", height: "6px", "border-radius": "50%", background: item.color }} />
                      {item.layer} · {count()} {item.label}
                    </span>
                  </Show>
                )
              }}
            </For>

            {/* Right side: Graph button */}
            <div style={{ "margin-left": "auto" }}>
              <button
                type="button"
                onClick={() => setShowGraph(false)}
                style={{
                  display: "inline-flex", "align-items": "center", gap: "6px",
                  padding: "5px 12px", "border-radius": "6px",
                  background: "rgba(214,138,46,0.1)", border: "1px solid rgba(214,138,46,0.35)",
                  "font-family": "'Geist Mono', monospace", "font-size": "10px", "font-weight": "600",
                  color: AMBER, cursor: "pointer", transition: "all 120ms",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(214,138,46,0.2)" }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(214,138,46,0.1)" }}
              >
                ← Back to project
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}

function BrainFileExplorer(props: {
  projectId: string
  projectName: string
  brainFiles: string[]
  sources: Array<{ name: string; size: number; title: string; url: string | null; status: "processing" | "done" | "failed" }>
  onRefresh?: () => void
}) {
  const [selectedPath, setSelectedPath] = createSignal<string | null>(null)
  const [selectedType, setSelectedType] = createSignal<"brain" | "source">("brain")
  const [tick, setTick] = createSignal(0)

  // Re-fetch open file AND parent lists when .supadense/ changes
  createEffect(() => {
    const unsub = elApi.watchLocalProject(props.projectId, () => {
      setTick(t => t + 1)
      props.onRefresh?.()
    })
    onCleanup(unsub)
  })

  const [fileContent] = createResource(
    () => selectedPath() ? { path: selectedPath()!, type: selectedType(), tick: tick() } : null,
    async ({ path, type, tick: _tick }) => {
      if (type === "brain") return elApi.getLocalProjectBrainFile(props.projectId, path)
      const text = await elApi.getLocalSourceFileContent(props.projectId, path)
      return { content: text, path }
    }
  )

  const grouped = () => {
    const g: Record<string, string[]> = { L0: [], L1: [], L2: [] }
    for (const f of props.brainFiles) {
      const layer = f.split("/")[0]
      if (layer in g) g[layer].push(f)
    }
    return g
  }

  const layerMeta: Record<string, { color: string; desc: string }> = {
    L0: { color: "#6366f1", desc: "raw decisions, notes, facts" },
    L1: { color: "#0891b2", desc: "synthesised summaries" },
    L2: { color: "#16a34a", desc: "durable patterns" },
  }

  function basename(p: string) { return p.split("/").pop() ?? p }

  // Collapse state: key = folder path, value = open
  const [open, setOpen] = createSignal<Record<string, boolean>>({
    "project": true, "supadense": true, "brain": true,
    "L0": true, "L1": true, "L2": true, "sources": true,
  })
  const toggle = (key: string) => setOpen(o => ({ ...o, [key]: !o[key] }))

  // Chevron icon: right when closed, down when open
  const Chevron = (p: { open: boolean }) => (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
      stroke-linecap="round" style={{ "flex-shrink": "0", transition: "transform 120ms", transform: p.open ? "rotate(90deg)" : "rotate(0deg)" }}>
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  )

  // Folder row component
  const FolderRow = (p: { label: string; depth: number; openKey: string; color?: string; hint?: string }) => {
    const isOpen = () => open()[p.openKey] !== false
    return (
      <div
        onClick={() => toggle(p.openKey)}
        style={{
          padding: `3px 16px 3px ${8 + p.depth * 14}px`,
          "font-size": "11px", cursor: "pointer",
          display: "flex", "align-items": "center", gap: "5px",
          color: p.color ?? "#525252",
          "user-select": "none", transition: "background 80ms",
          "border-radius": "3px", margin: "0 4px",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#efefef" }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent" }}
      >
        <Chevron open={isOpen()} />
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style={{ "flex-shrink": "0" }}>
          <Show when={isOpen()}>
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </Show>
          <Show when={!isOpen()}>
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </Show>
        </svg>
        <span>{p.label}</span>
        {p.hint && <span style={{ color: "#b0b0b0", "font-size": "10px", "margin-left": "4px" }}>{p.hint}</span>}
      </div>
    )
  }

  return (
    <div style={{ display: "flex", flex: "1", overflow: "hidden", "font-family": "'Geist Mono', monospace" }}>
      {/* Left: file tree */}
      <div style={{
        width: "280px", "flex-shrink": "0", "border-right": "1px solid #f0f0f0",
        "overflow-y": "auto", background: "#fafafa", padding: "8px 0",
      }}>
        {/* project/ */}
        <FolderRow label="project/" depth={0} openKey="project" />

        <Show when={open()["project"] !== false}>
          {/* .supadense/ */}
          <FolderRow label=".supadense/" depth={1} openKey="supadense" color="#737373" />

          <Show when={open()["supadense"] !== false}>
            {/* brain/ */}
            <FolderRow label="brain/" depth={2} openKey="brain" color="#737373" />

            <Show when={open()["brain"] !== false}>
              <For each={["L0", "L1", "L2"]}>
                {(layer) => (
                  <>
                    <FolderRow label={`${layer}/`} depth={3} openKey={layer} color={layerMeta[layer].color} hint={layerMeta[layer].desc} />
                    <Show when={open()[layer] !== false}>
                      <For each={grouped()[layer]}>
                        {(f) => {
                          const isSelected = () => selectedPath() === f && selectedType() === "brain"
                          return (
                            <div
                              onClick={() => { setSelectedPath(f); setSelectedType("brain") }}
                              style={{
                                padding: `3px 16px 3px ${8 + 4 * 14}px`,
                                "font-size": "11px", cursor: "pointer",
                                display: "flex", "align-items": "center", gap: "5px",
                                background: isSelected() ? "#e0e0e0" : "transparent",
                                color: isSelected() ? "#0a0a0a" : "#525252",
                                transition: "background 80ms",
                                "border-radius": "3px", margin: "0 4px",
                              }}
                              onMouseEnter={(e) => { if (!isSelected()) (e.currentTarget as HTMLElement).style.background = "#efefef" }}
                              onMouseLeave={(e) => { if (!isSelected()) (e.currentTarget as HTMLElement).style.background = "transparent" }}
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={layerMeta[layer].color} stroke-width="1.8" style={{ "flex-shrink": "0" }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                              {basename(f)}
                            </div>
                          )
                        }}
                      </For>
                    </Show>
                  </>
                )}
              </For>
            </Show>

            {/* sources/ */}
            <Show when={props.sources.length > 0}>
              <FolderRow label="sources/" depth={2} openKey="sources" color="#737373" hint="PDFs, URLs, refs" />
              <Show when={open()["sources"] !== false}>
                <For each={props.sources}>
                  {(src) => {
                    const isSelected = () => selectedPath() === src.name && selectedType() === "source"
                    return (
                      <div
                        onClick={() => { setSelectedPath(src.name); setSelectedType("source") }}
                        style={{
                          padding: `3px 16px 3px ${8 + 3 * 14}px`,
                          "font-size": "11px", cursor: "pointer",
                          display: "flex", "align-items": "center", gap: "5px",
                          background: isSelected() ? "#e0e0e0" : "transparent",
                          color: isSelected() ? "#0a0a0a" : "#525252",
                          transition: "background 80ms",
                          "border-radius": "3px", margin: "0 4px",
                        }}
                        onMouseEnter={(e) => { if (!isSelected()) (e.currentTarget as HTMLElement).style.background = "#efefef" }}
                        onMouseLeave={(e) => { if (!isSelected()) (e.currentTarget as HTMLElement).style.background = "transparent" }}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                          stroke={src.status === "processing" ? "#a3a3a3" : src.status === "failed" ? "#ef4444" : "#d68a2e"}
                          stroke-width="1.8" style={{ "flex-shrink": "0" }}>
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                        </svg>
                        <span style={{ overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap",
                          color: src.status === "processing" ? "#a3a3a3" : src.status === "failed" ? "#ef4444" : "inherit" }}
                          title={src.title + (src.url ? `\n${src.url}` : "")}>
                          {src.title}
                        </span>
                        <Show when={src.status === "processing"}>
                          <span style={{ color: "#a3a3a3", "font-size": "9px", "flex-shrink": "0" }}>…</span>
                        </Show>
                      </div>
                    )
                  }}
                </For>
              </Show>
            </Show>
          </Show>
        </Show>
      </div>

      {/* Right: file content */}
      <div style={{ flex: "1", overflow: "hidden", display: "flex", "flex-direction": "column", background: "#ffffff" }}>
        <Show when={selectedPath()} fallback={
          <div style={{ flex: "1", display: "flex", "align-items": "center", "justify-content": "center", color: "#a3a3a3", "font-size": "12px" }}>
            Select a file to view its contents
          </div>
        }>
          {/* Tab bar */}
          <div style={{ "border-bottom": "1px solid #f0f0f0", padding: "0 16px", display: "flex", "align-items": "center", gap: "0", "flex-shrink": "0" }}>
            <div style={{
              padding: "8px 14px", "font-size": "11px", color: "#0a0a0a",
              "border-bottom": "2px solid #d68a2e", "margin-bottom": "-1px",
              display: "flex", "align-items": "center", gap: "6px",
            }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              {selectedPath()?.split("/").pop()}
              <span style={{ color: "#a3a3a3", "font-size": "10px", cursor: "pointer" }} onClick={() => setSelectedPath(null)}>×</span>
            </div>
          </div>

          {/* Content */}
          <div style={{ flex: "1", "overflow-y": "auto", padding: "20px 28px" }}>
            <Show when={fileContent.loading}>
              <div style={{ color: "#a3a3a3", "font-size": "12px" }}>Loading…</div>
            </Show>
            <Show when={fileContent()}>
              <pre style={{
                margin: "0", "font-family": "'Geist Mono', monospace", "font-size": "12px",
                "line-height": "1.7", color: "#0a0a0a", "white-space": "pre-wrap", "word-break": "break-word",
              }}>
                {/* Line numbers + content */}
                <For each={(fileContent()?.content ?? "").split("\n")}>
                  {(line, i) => (
                    <div style={{ display: "flex", gap: "16px" }}>
                      <span style={{ color: "#d4d4d4", "min-width": "28px", "text-align": "right", "user-select": "none", "flex-shrink": "0" }}>{i() + 1}</span>
                      <span style={{ color: line.startsWith("#") ? "#d68a2e" : line.startsWith(">") ? "#737373" : line.startsWith("##") ? "#525252" : "#0a0a0a" }}>{line || " "}</span>
                    </div>
                  )}
                </For>
              </pre>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}

function LegendDot(props: { color: string; label: string }) {
  return (
    <div style={{ display: "flex", "align-items": "center", gap: "6px" }}>
      <div style={{ width: "8px", height: "8px", "border-radius": "50%", background: props.color, "flex-shrink": "0" }} />
      <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", color: "#a3a3a3" }}>{props.label}</span>
    </div>
  )
}

function InfoRow(props: { label: string; value: string; mono?: boolean; small?: boolean }) {
  return (
    <div style={{ "margin-bottom": "12px" }}>
      <div style={{ "font-family": "'Geist Mono', monospace", "font-size": "9px", "font-weight": "700", "letter-spacing": "0.1em", color: "#a3a3a3", "text-transform": "uppercase", "margin-bottom": "2px" }}>
        {props.label}
      </div>
      <div style={{
        "font-family": props.mono ? "'Geist Mono', monospace" : "inherit",
        "font-size": props.small ? "10px" : "12px",
        color: "#0a0a0a",
        "word-break": "break-all",
        "line-height": "1.4",
      }}>
        {props.value}
      </div>
    </div>
  )
}
