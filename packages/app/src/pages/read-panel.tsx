import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show, type Accessor } from "solid-js"
import { useWikiApi, type WikiResourceData, type WikiResourceListItem } from "./wiki/wiki-api"
import { showToast } from "@opencode-ai/ui/toast"
import { useMarked } from "@opencode-ai/ui/context/marked"
import { activeReadResourceId, setActiveReadResourceId, activeReadResourceUrl, setActiveReadResourceUrl, setActiveSourceName, activeGraphProjectId, setActiveSidebarView, triggerGraphRefresh } from "@/context/sidebar-view"
import { elApi } from "@/pages/projects/el-api"

// ── Source badge ──────────────────────────────────────────────────────────────

function sourceBadge(item: WikiResourceListItem): string {
  if (item.modality === "linkedin") return "LINKEDIN"
  if (item.modality === "youtube") return "YOUTUBE"
  if (item.modality === "pdf") return "PDF"
  if (item.modality === "text") return "TEXT"
  const domain = (item.metadata?.domain as string | undefined) ?? ""
  const url = item.url ?? ""
  if (!domain && url) {
    try { return new URL(url).hostname.replace(/^www\./, "").toUpperCase() } catch { return "URL" }
  }
  if (domain.includes("arxiv")) return "ARXIV"
  if (domain.includes("x.com") || domain.includes("twitter")) return "X"
  if (domain.includes("substack")) return "SUBSTACK"
  if (domain.includes("medium.com")) return "MEDIUM"
  if (domain.includes("github.com")) return "GITHUB"
  if (domain.includes("ycombinator") || domain.includes("hackernews")) return "HN"
  if (domain.includes("linkedin")) return "LINKEDIN"
  return domain.replace(/^www\./, "").toUpperCase() || "URL"
}

// Derive a human-readable category from the resource
function deriveCategory(item: WikiResourceListItem): { label: string; color: string } {
  const text = ((item.title ?? "") + " " + (item.url ?? "")).toLowerCase()
  if (text.includes("auth") || text.includes("token") || text.includes("session") || text.includes("jwt") || text.includes("oauth"))
    return { label: "auth & sessions", color: "#22c55e" }
  if (text.includes("payment") || text.includes("billing") || text.includes("stripe") || text.includes("pci"))
    return { label: "payments", color: "#6366f1" }
  if (text.includes("search") || text.includes("elastic") || text.includes("knn") || text.includes("retrieval"))
    return { label: "search & retrieval", color: "#f59e0b" }
  if (text.includes("api") || text.includes("endpoint") || text.includes("rest") || text.includes("graphql"))
    return { label: "api design", color: "#06b6d4" }
  if (text.includes("distributed") || text.includes("mesh") || text.includes("trace") || text.includes("service"))
    return { label: "distributed sys", color: "#8b5cf6" }
  if (text.includes("event") || text.includes("stream") || text.includes("pipeline") || text.includes("kafka"))
    return { label: "event streaming", color: "#f97316" }
  if (text.includes("github.com")) return { label: "engineering", color: "#22c55e" }
  return { label: "general", color: "#a3a3a3" }
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

// Extract meaningful paragraphs from content as fragments
function extractFragments(content: string): { id: string; text: string }[] {
  const paras = content
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length >= 60 && !p.startsWith("#"))
    .slice(0, 12)
  return paras.map((text, i) => ({
    id: String(1000 + i * 13).padStart(4, "0"),
    text: text.length > 220 ? text.slice(0, 220) + "…" : text,
  }))
}

function formatReadTime(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

// ── Resource card (list view) ─────────────────────────────────────────────────

function ResourceCard(props: {
  item: WikiResourceListItem
  projectAssignments: Array<{ project_id: string; project_name: string; join_id: string }>
  onClick: () => void
  onRetried?: () => void
  onDeleted?: () => void
}) {
  const api = useWikiApi()
  const badge = () => sourceBadge(props.item)
  const title = () => props.item.title ?? props.item.url ?? "Untitled"
  const domain = () => {
    if (!props.item.url) return null
    try { return new URL(props.item.url).hostname.replace(/^www\./, "") } catch { return null }
  }

  const [retrying, setRetrying] = createSignal(false)
  const [deleting, setDeleting] = createSignal(false)
  const [hovered, setHovered] = createSignal(false)
  const [pickerOpen, setPickerOpen] = createSignal(false)
  const [addingToProject, setAddingToProject] = createSignal<string | null>(null)
  const [projects] = createResource(pickerOpen, (open) => open ? elApi.listProjects() : Promise.resolve([]))
  // Confirmation state: join_id of the chip the user clicked ×  on
  const [confirmRemove, setConfirmRemove] = createSignal<{ joinId: string; projectId: string; projectName: string } | null>(null)
  const [removing, setRemoving] = createSignal(false)

  async function retryResource(e: MouseEvent) {
    e.stopPropagation()
    setRetrying(true)
    try {
      await api.retryResource(props.item.id)
      props.onRetried?.()
    } catch {
      // swallow — badge will still show failed
    } finally {
      setRetrying(false)
    }
  }

  async function deleteResource(e: MouseEvent) {
    e.stopPropagation()
    setDeleting(true)
    try {
      await api.deleteResource(props.item.id)
      triggerGraphRefresh()
      props.onDeleted?.()
    } catch {
      setDeleting(false)
    }
  }

  const cat = () => deriveCategory(props.item)

  async function removeFromProject() {
    const c = confirmRemove()
    if (!c) return
    setRemoving(true)
    try {
      await elApi.removeResource(c.projectId, c.joinId)
      setConfirmRemove(null)
      props.onRetried?.() // trigger parent refresh
      showToast({ variant: "success", title: `Removed from ${c.projectName}` })
    } catch (e: any) {
      showToast({ variant: "error", title: e?.message ?? "Failed to remove" })
    } finally {
      setRemoving(false)
    }
  }

  async function addToProject(projectId: string) {
    if (!props.item.url) return
    setAddingToProject(projectId)
    try {
      await elApi.addResource(projectId, props.item.url, "supplementary")
      setPickerOpen(false)
      props.onRetried?.() // reuse to trigger parent refresh
      showToast({ variant: "success", title: "Added to project" })
    } catch (e: any) {
      showToast({ variant: "error", title: e?.message ?? "Failed to add" })
    } finally {
      setAddingToProject(null)
    }
  }

  return (
    <div
      style={{ "border-bottom": "1px solid #ebebeb", background: "#ffffff" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        onClick={props.onClick}
        style={{
          padding: "18px 20px 16px",
          background: hovered() ? "#fafafa" : "transparent",
          transition: "background 120ms",
          cursor: "pointer",
        }}
      >

        {/* ROW 1: type badge + status + path (left) | category chip (right) */}
        <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", "margin-bottom": "10px", gap: "12px" }}>

          {/* Left */}
          <div style={{ display: "flex", "align-items": "center", gap: "6px", "flex-wrap": "wrap", "min-width": "0", flex: "1" }}>
            {/* Type badge — amber outlined */}
            <span style={{
              "font-family": "'Geist Mono', monospace", "font-size": "9px", "font-weight": "700",
              "letter-spacing": "0.1em", "text-transform": "uppercase",
              color: "#d68a2e", padding: "3px 7px", "border-radius": "3px",
              background: "rgba(214,138,46,0.06)", border: "1px solid rgba(214,138,46,0.3)",
              "white-space": "nowrap", "flex-shrink": "0",
            }}>
              {badge()}
            </span>

            {/* Status badge */}
            <Show when={props.item.status === "processing" || props.item.status === "pending"}>
              <span style={{
                "font-family": "'Geist Mono', monospace", "font-size": "9px", "font-weight": "600",
                "letter-spacing": "0.1em", "text-transform": "uppercase",
                color: "#f59e0b", padding: "3px 7px", "border-radius": "3px",
                background: "#fffbeb", border: "1px solid #fde68a",
                "white-space": "nowrap", "flex-shrink": "0",
              }}>PARSING</span>
            </Show>
            <Show when={props.item.status === "done"}>
              <span style={{
                "font-family": "'Geist Mono', monospace", "font-size": "9px", "font-weight": "600",
                "letter-spacing": "0.1em", "text-transform": "uppercase",
                color: "#a3a3a3", padding: "3px 7px", "border-radius": "3px",
                background: "#f5f5f5", border: "1px solid #e5e5e5",
                "white-space": "nowrap", "flex-shrink": "0",
              }}>PROCESSED</span>
            </Show>
            <Show when={props.item.status === "failed"}>
              <span style={{
                "font-family": "'Geist Mono', monospace", "font-size": "9px", "font-weight": "600",
                "letter-spacing": "0.1em", "text-transform": "uppercase",
                color: "#ef4444", padding: "3px 7px", "border-radius": "3px",
                background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.25)",
                "white-space": "nowrap", "flex-shrink": "0",
              }}>FAILED</span>
              <button type="button" disabled={retrying()} onClick={retryResource} style={{
                "font-family": "'Geist Mono', monospace", "font-size": "9px", "font-weight": "600",
                "letter-spacing": "0.1em", color: retrying() ? "#a3a3a3" : "#d68a2e",
                padding: "3px 7px", "border-radius": "3px",
                background: "rgba(214,138,46,0.08)", border: "1px solid rgba(214,138,46,0.25)",
                cursor: retrying() ? "default" : "pointer",
              }}>{retrying() ? "RETRYING…" : "↺ RETRY"}</button>
            </Show>

            {/* Source path: domain · service · author */}
            <Show when={domain() || props.item.author}>
              <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#a3a3a3", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                {[domain(), props.item.author].filter(Boolean).join(" · ")}
              </span>
            </Show>
          </div>

          {/* Right: project assignment chips */}
          <div
            style={{ display: "flex", "align-items": "center", gap: "4px", "flex-shrink": "0", "flex-wrap": "wrap", "justify-content": "flex-end" }}
            onClick={(e) => e.stopPropagation()}
          >
            <Show
              when={props.projectAssignments.length > 0}
              fallback={
                <div style={{
                  display: "flex", "align-items": "center", gap: "6px",
                  padding: "4px 10px", "border-radius": "999px",
                  background: "#f5f5f5", border: "1px solid #e5e5e5",
                  "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#a3a3a3",
                }}>
                  <span style={{ width: "7px", height: "7px", "border-radius": "50%", background: "#d4d4d4", display: "inline-block", "flex-shrink": "0" }} />
                  default
                </div>
              }
            >
              <For each={props.projectAssignments}>
                {(pa) => (
                  <div style={{ position: "relative" }}>
                    <div style={{
                      display: "flex", "align-items": "center", gap: "6px",
                      padding: "4px 10px", "border-radius": "999px",
                      background: confirmRemove()?.joinId === pa.join_id ? "rgba(239,68,68,0.06)" : "rgba(214,138,46,0.06)",
                      border: `1px solid ${confirmRemove()?.joinId === pa.join_id ? "rgba(239,68,68,0.3)" : "rgba(214,138,46,0.25)"}`,
                      "font-family": "'Geist Mono', monospace", "font-size": "11px",
                      color: confirmRemove()?.joinId === pa.join_id ? "#ef4444" : "#d68a2e",
                      "max-width": "160px",
                    }}>
                      <span style={{ width: "7px", height: "7px", "border-radius": "50%", background: confirmRemove()?.joinId === pa.join_id ? "#ef4444" : "#d68a2e", display: "inline-block", "flex-shrink": "0" }} />
                      <span style={{ overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>{pa.project_name}</span>
                      <button
                        type="button"
                        title="Remove from project"
                        onClick={(e) => { e.stopPropagation(); setConfirmRemove({ joinId: pa.join_id, projectId: pa.project_id, projectName: pa.project_name }) }}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "currentColor", padding: "0 0 0 2px", "font-size": "13px", "line-height": "1", display: "flex", "align-items": "center", opacity: "0.6", "flex-shrink": "0" }}
                      >×</button>
                    </div>

                    {/* Inline confirm popover */}
                    <Show when={confirmRemove()?.joinId === pa.join_id}>
                      <div style={{ position: "fixed", inset: "0", "z-index": "40" }} onClick={(e) => { e.stopPropagation(); setConfirmRemove(null) }} />
                      <div style={{
                        position: "absolute", top: "calc(100% + 6px)", right: "0",
                        "z-index": "50", background: "#ffffff",
                        "border-radius": "10px", "box-shadow": "0 4px 20px rgba(0,0,0,0.12)",
                        border: "1px solid #e5e5e5", padding: "12px 14px", width: "220px",
                      }}>
                        <p style={{ margin: "0 0 10px", "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#374151", "line-height": "1.5" }}>
                          Remove from <strong style={{ color: "#0a0a0a" }}>{pa.project_name}</strong>?
                        </p>
                        <div style={{ display: "flex", gap: "6px" }}>
                          <button
                            type="button"
                            disabled={removing()}
                            onClick={(e) => { e.stopPropagation(); removeFromProject() }}
                            style={{
                              flex: "1", padding: "5px 0", "border-radius": "5px",
                              background: "#ef4444", border: "none",
                              "font-family": "'Geist Mono', monospace", "font-size": "11px", "font-weight": "600",
                              color: "#ffffff", cursor: removing() ? "default" : "pointer",
                              opacity: removing() ? "0.6" : "1",
                            }}
                          >{removing() ? "Removing…" : "Remove"}</button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setConfirmRemove(null) }}
                            style={{
                              flex: "1", padding: "5px 0", "border-radius": "5px",
                              background: "transparent", border: "1px solid #e5e5e5",
                              "font-family": "'Geist Mono', monospace", "font-size": "11px",
                              color: "#525252", cursor: "pointer",
                            }}
                          >Cancel</button>
                        </div>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
            {/* + button with project picker popover */}
            <div style={{ position: "relative" }}>
              <button
                type="button"
                title="Add to project"
                onClick={(e) => { e.stopPropagation(); setPickerOpen((v) => !v) }}
                style={{
                  width: "24px", height: "24px", "border-radius": "6px",
                  background: pickerOpen() ? "#f5f5f5" : "none",
                  border: `1px solid ${pickerOpen() ? "#d4d4d4" : "#e5e5e5"}`,
                  cursor: "pointer", color: "#525252",
                  display: "flex", "align-items": "center", "justify-content": "center",
                  "font-size": "14px", "line-height": "1",
                }}
              >+</button>

              <Show when={pickerOpen()}>
                {/* Backdrop */}
                <div style={{ position: "fixed", inset: "0", "z-index": "40" }} onClick={() => setPickerOpen(false)} />
                {/* Popover */}
                <div style={{
                  position: "absolute",
                  top: "calc(100% + 6px)",
                  right: "0",
                  width: "240px",
                  background: "#ffffff",
                  "border-radius": "10px",
                  "box-shadow": "0 4px 24px rgba(0,0,0,0.12)",
                  border: "1px solid #e5e5e5",
                  "z-index": "50",
                  overflow: "hidden",
                }}>
                  {/* Header */}
                  <div style={{ padding: "10px 14px 8px", "border-bottom": "1px solid #f0f0f0" }}>
                    <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", "font-weight": "600", "letter-spacing": "0.08em", "text-transform": "uppercase", color: "#a3a3a3" }}>
                      Add to project
                    </span>
                  </div>

                  {/* Project list */}
                  <div style={{ "max-height": "220px", "overflow-y": "auto" }}>
                    <Show when={projects.loading}>
                      <div style={{ padding: "12px 14px", "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#a3a3a3" }}>Loading…</div>
                    </Show>
                    <Show when={!projects.loading && (projects() ?? []).length === 0}>
                      <div style={{ padding: "12px 14px", "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#a3a3a3" }}>No projects found</div>
                    </Show>
                    <For each={projects() ?? []}>
                      {(project) => {
                        const alreadyAdded = () => props.projectAssignments.some(pa => pa.project_id === project.id)
                        const isAdding = () => addingToProject() === project.id
                        return (
                          <div
                            onClick={(e) => { e.stopPropagation(); if (!alreadyAdded() && !isAdding()) addToProject(project.id) }}
                            style={{
                              display: "flex", "align-items": "center", gap: "8px",
                              padding: "9px 14px",
                              cursor: alreadyAdded() ? "default" : "pointer",
                              "border-bottom": "1px solid #f7f7f7",
                              opacity: alreadyAdded() ? "0.5" : "1",
                            }}
                            onMouseEnter={(e) => { if (!alreadyAdded()) e.currentTarget.style.background = "#fafafa" }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}
                          >
                            <div style={{ width: "7px", height: "7px", "border-radius": "50%", background: "#d68a2e", "flex-shrink": "0" }} />
                            <span style={{ flex: "1", "font-family": "'Geist Mono', monospace", "font-size": "12px", color: "#0a0a0a", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                              {project.name}
                            </span>
                            <Show when={alreadyAdded()}>
                              <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", color: "#a3a3a3" }}>added</span>
                            </Show>
                            <Show when={isAdding()}>
                              <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", color: "#d68a2e" }}>adding…</span>
                            </Show>
                          </div>
                        )
                      }}
                    </For>
                  </div>
                </div>
              </Show>
            </div>
          </div>
        </div>

        {/* ROW 2: large monospace title */}
        <div
          style={{
            "font-family": "'Geist Mono', monospace",
            "font-size": "15px", "font-weight": "500",
            "line-height": "1.45", "margin-bottom": "12px",
            color: props.item.status === "done" ? "#d68a2e" : "#0a0a0a",
          }}
        >
          {title()}
        </div>

        {/* ROW 3: meta (left) | action buttons (right) */}
        <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "8px" }}>

          {/* Meta */}
          <div
            style={{
              display: "flex", "align-items": "center", gap: "6px",
              "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#a3a3a3",
            }}
          >
            <span>{timeAgo(props.item.time_created)}</span>
            <Show when={props.item.url}>
              <span>·</span>
              <span style={{ color: "#d68a2e" }}>
                {(() => { try { const u = new URL(props.item.url!); return u.pathname.split("/").filter(Boolean).slice(-2).join("/") || u.hostname } catch { return "" } })()}
              </span>
            </Show>
            <Show when={props.item.author}>
              <span>·</span>
              <span style={{ color: "#525252" }}>{props.item.author}</span>
            </Show>
          </div>

          {/* Action buttons */}
          <div
            style={{ display: "flex", "align-items": "center", gap: "6px", "flex-shrink": "0" }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); props.onClick() }}
              style={{
                padding: "5px 12px", "border-radius": "5px",
                border: "1px solid #e5e5e5", background: "transparent",
                "font-family": "'Geist Mono', monospace", "font-size": "11px",
                "font-weight": "500", "letter-spacing": "0.03em",
                color: "#525252", cursor: "pointer", transition: "all 120ms",
              }}
              onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.borderColor = "#d4d4d4"; el.style.color = "#0a0a0a" }}
              onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.borderColor = "#e5e5e5"; el.style.color = "#525252" }}
            >review notes</button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); props.onClick() }}
              style={{
                padding: "5px 14px", "border-radius": "5px",
                border: "1px solid #d68a2e", background: "#d68a2e",
                "font-family": "'Geist Mono', monospace", "font-size": "11px",
                "font-weight": "600", "letter-spacing": "0.03em",
                color: "#ffffff", cursor: "pointer", transition: "all 120ms",
              }}
              onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = "#c47a28"; el.style.borderColor = "#c47a28" }}
              onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = "#d68a2e"; el.style.borderColor = "#d68a2e" }}
            >learn</button>
          </div>
        </div>

      </div>
    </div>
  )
}

// ── Fragments panel ───────────────────────────────────────────────────────────

function FragmentsPanel(props: {
  fragments: { id: string; text: string }[]
  isCapturing: boolean
  onClose: () => void
}) {
  return (
    <div
      style={{
        position: "absolute", bottom: "52px", left: "0", right: "0",
        "z-index": "20",
        "max-height": "420px",
        display: "flex", "flex-direction": "column",
        background: "var(--surface-raised-stronger-non-alpha, var(--background-base))",
        "border-top": "1px solid var(--border-weak-base)",
        overflow: "hidden",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{
        "flex-shrink": "0",
        display: "flex", "align-items": "center", "justify-content": "space-between",
        padding: "10px 20px 8px",
        "border-bottom": "1px solid var(--border-weak-base)",
      }}>
        <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
          <span style={{
            display: "inline-block", width: "8px", height: "8px", "border-radius": "2px",
            background: "#d68a2e",
          }} />
          <span style={{
            "font-family": "'Geist Mono', monospace", "font-size": "9px", "font-weight": "600",
            "letter-spacing": "0.12em", "text-transform": "uppercase",
            color: "var(--color-text-weak)",
          }}>
            FROM THIS SOURCE
          </span>
          <span style={{ "font-size": "9px", color: "var(--color-text-dimmed, var(--text-weak))", opacity: "0.5" }}>·</span>
          <span style={{
            "font-family": "'Geist Mono', monospace", "font-size": "9px",
            "letter-spacing": "0.1em", "text-transform": "uppercase",
            color: props.isCapturing ? "#d68a2e" : "var(--color-text-dimmed, var(--text-weak))",
          }}>
            {props.isCapturing ? "SUPADENSE IS PARSING AS YOU READ" : "PARSING COMPLETE"}
          </span>
        </div>
        <button
          type="button"
          onClick={props.onClose}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-weak)", padding: "2px", display: "flex", "align-items": "center" }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {/* Fragment cards */}
      <div style={{ "overflow-y": "auto", padding: "8px 16px 12px" }}>
        <Show
          when={props.fragments.length > 0}
          fallback={
            <div style={{
              display: "flex", "align-items": "center", "justify-content": "center",
              padding: "32px 0", color: "var(--color-text-weak)", "font-size": "13px",
              "font-style": "italic",
            }}>
              {props.isCapturing ? "Fragments are being extracted…" : "No fragments found in this content."}
            </div>
          }
        >
          <For each={props.fragments}>
            {(frag, i) => (
              <div style={{
                border: "1px solid var(--border-weak-base)",
                "border-radius": "6px",
                padding: "12px 14px",
                "margin-bottom": "8px",
                background: "var(--surface-base)",
              }}>
                <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", "margin-bottom": "8px" }}>
                  <div style={{ display: "flex", "align-items": "center", gap: "6px" }}>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#d68a2e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                    <span style={{
                      "font-family": "'Geist Mono', monospace", "font-size": "9px", "font-weight": "600",
                      "letter-spacing": "0.1em", color: "#d68a2e",
                    }}>
                      FRAG {frag.id}
                    </span>
                  </div>
                  <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "9px", color: "var(--color-text-dimmed, var(--text-weak))", opacity: "0.6" }}>
                    {i() === 0 ? "JUST NOW" : `${(i() * 4)}S AGO`}
                  </span>
                </div>
                <div style={{
                  "font-size": "13px", "line-height": "1.55",
                  color: "var(--color-text-base, var(--text-base))",
                  "font-style": "normal",
                }}>
                  "{frag.text}"
                </div>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  )
}

// ── Stats panel ───────────────────────────────────────────────────────────────

function StatsPanel(props: {
  readTimeSecs: number
  isCapturing: boolean
  fragmentCount: number
  onClose: () => void
}) {
  const retention = () => Math.min(99, 72 + Math.floor(props.readTimeSecs / 30))

  return (
    <div
      style={{
        position: "absolute", bottom: "52px", right: "20px",
        width: "260px",
        "z-index": "20",
        background: "var(--surface-raised-stronger-non-alpha, var(--background-base))",
        border: "1px solid var(--border-weak-base)",
        "border-radius": "8px",
        overflow: "hidden",
        "box-shadow": "0 -4px 24px rgba(0,0,0,0.15)",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{
        padding: "10px 16px 8px",
        "border-bottom": "1px solid var(--border-weak-base)",
        display: "flex", "align-items": "center", "justify-content": "space-between",
      }}>
        <span style={{
          "font-family": "'Geist Mono', monospace", "font-size": "9px", "font-weight": "700",
          "letter-spacing": "0.14em", "text-transform": "uppercase",
          color: "var(--color-text-weak)",
        }}>
          READING STATS
        </span>
        <button
          type="button"
          onClick={props.onClose}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-weak)", padding: "2px", display: "flex", "align-items": "center" }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div style={{ padding: "12px 16px 14px", display: "flex", "flex-direction": "column", gap: "10px" }}>
        <StatRow label="read time" value={formatReadTime(props.readTimeSecs)} amber />
        <StatRow label="fragments extracted" value={String(props.fragmentCount)} />
        <StatRow label="review scheduled" value="in 3 days" />
        <StatRow label={`est. retention · d30`} value={`${retention()}%`} amber />
      </div>
    </div>
  )
}

function StatRow(props: { label: string; value: string; amber?: boolean }) {
  return (
    <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between" }}>
      <span style={{
        "font-family": "'Geist Mono', monospace", "font-size": "11px",
        color: "var(--color-text-weak)",
      }}>
        {props.label}
      </span>
      <span style={{
        "font-family": "'Geist Mono', monospace", "font-size": "12px", "font-weight": "600",
        color: props.amber ? "#d68a2e" : "var(--color-text-strong)",
      }}>
        {props.value}
      </span>
    </div>
  )
}

// ── Reader view ───────────────────────────────────────────────────────────────

function ResourceReader(props: {
  id: string
  badge: string
  onBack: () => void
}) {
  const api = useWikiApi()
  const marked = useMarked()

  const [data, { refetch }] = createResource(() => props.id, (id) => elApi.getResource(id))

  // Poll every 2s while status is still processing/pending
  createEffect(() => {
    const status = data()?.status
    if (status === "processing" || status === "pending") {
      const t = setInterval(() => void refetch(), 2000)
      onCleanup(() => clearInterval(t))
    }
  })

  // Use a signal for the prose ref so the content effect can track when it's mounted
  const [proseEl, setProseEl] = createSignal<HTMLDivElement | undefined>(undefined)
  let scrollRef: HTMLDivElement | undefined
  let lastRenderedContent = ""
  let lastProseEl: HTMLDivElement | undefined

  // Cache last-known-good data so content stays visible during refetch polling
  const [cachedData, setCachedData] = createSignal<WikiResourceData | undefined>(undefined)
  createEffect(() => {
    const d = data()
    if (d) setCachedData(() => d)
  })

  createEffect(() => {
    const el = proseEl()
    const resource = data() ?? cachedData()
    if (!el || !resource?.content) return
    // Reset cache when the prose element remounts (e.g. navigating away and back)
    if (el !== lastProseEl) { lastProseEl = el; lastRenderedContent = "" }
    if (resource.content === lastRenderedContent) return
    lastRenderedContent = resource.content

    const assetMap = resource.asset_map ?? {}
    const assetUrlToInfo = Object.fromEntries(
      Object.values(assetMap).map((info) => [api.assetUrl(info.localPath), info])
    )

    let content = resource.content
    for (const [src, info] of Object.entries(assetMap)) {
      content = content.replaceAll(src, api.assetUrl(info.localPath))
    }

    void Promise.resolve(marked.parse(content)).then((html: string) => {
      const currentEl = proseEl()
      if (!currentEl) return // component unmounted before promise resolved
      const patched = html.replace(/<img([^>]*?)src="([^"]*)"([^>]*?)>/g, (_m: string, pre: string, src: string, post: string) => {
        // marked HTML-encodes & as &amp; inside attribute values — decode before use
        const decodedSrc = src.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
        const info = assetUrlToInfo[decodedSrc]
        const dims = info?.width && info?.height ? ` width="${info.width}" height="${info.height}"` : ""
        // Route external images through the proxy to bypass hotlink restrictions / CORS
        const finalSrc = decodedSrc.startsWith("http://") || decodedSrc.startsWith("https://") ? api.proxyImageUrl(decodedSrc) : decodedSrc
        return `<img${pre}src="${finalSrc}"${post}${dims} loading="lazy">`
      })
      const savedTop = scrollRef?.scrollTop ?? 0
      currentEl.innerHTML = patched
      if (scrollRef && savedTop > 0) scrollRef.scrollTop = savedTop
    })
  })

  const isCapturing = () => {
    const s = (data() ?? cachedData())?.status
    return s === "processing" || s === "pending"
  }

  // Poll every 6s while capturing, but only if user hasn't scrolled into the content
  createEffect(() => {
    if (!isCapturing()) return
    const t = setInterval(() => {
      if (scrollRef && scrollRef.scrollTop > 80) return
      void refetch()
    }, 6000)
    onCleanup(() => clearInterval(t))
  })

  // Toast when processing completes (transition: capturing → done)
  let wasCapturing = false
  createEffect(() => {
    const capturing = isCapturing()
    if (wasCapturing && !capturing && data()?.status === "done") {
      showToast({ variant: "success", title: "Processed", description: data()?.title ?? undefined })
    }
    wasCapturing = capturing
  })

  // Read-time timer
  const [readSecs, setReadSecs] = createSignal(0)
  const timer = setInterval(() => setReadSecs((s) => s + 1), 1000)
  onCleanup(() => clearInterval(timer))

  // Stable fragments — only recompute when content actually changes so <For>
  // doesn't remount items (and reset panel scroll) on every poll cycle.
  let lastFragContent = ""
  let stableFrags: { id: string; text: string }[] = []
  const fragments = createMemo(() => {
    const c = (data() ?? cachedData())?.content ?? ""
    if (c && c === lastFragContent) return stableFrags
    lastFragContent = c
    stableFrags = c ? extractFragments(c) : []
    return stableFrags
  })

  const [activePanel, setActivePanel] = createSignal<"fragments" | "stats" | null>(null)

  const togglePanel = (panel: "fragments" | "stats") => {
    setActivePanel((v) => (v === panel ? null : panel))
  }

  // Close panels on outside click
  const handleOutsideClick = () => setActivePanel(null)

  return (
    <div
      style={{ height: "100%", display: "flex", "flex-direction": "column", overflow: "hidden", position: "relative" }}
      onClick={handleOutsideClick}
    >
      {/* Toolbar */}
      <div style={{
        "flex-shrink": "0",
        display: "flex", "align-items": "center", gap: "10px",
        padding: "10px 24px",
        "border-bottom": "1px solid var(--border-weak-base)",
        background: "var(--background-base)",
      }}>
        <button
          type="button"
          onClick={props.onBack}
          style={{ background: "none", border: "none", cursor: "pointer", display: "flex", "align-items": "center", gap: "5px", color: "var(--color-text-weak)", padding: "0", "font-size": "12px", "font-family": "inherit" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Back
        </button>
        <Show when={data()}>
          <div style={{ display: "flex", "align-items": "center", gap: "6px" }}>
            <span style={{
              "font-family": "'Geist Mono', monospace", "font-size": "9px", "font-weight": "600", "letter-spacing": "0.1em",
              color: "#d68a2e", padding: "2px 6px", "border-radius": "3px",
              background: "rgba(214,138,46,0.1)", border: "1px solid rgba(214,138,46,0.25)",
            }}>
              {props.badge}
            </span>
            <Show when={data()?.url}>
              {(url) => {
                try {
                  const u = new URL(url())
                  const parts = u.pathname.split("/").filter(Boolean)
                  if (parts.length > 0) {
                    return <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "9px", "letter-spacing": "0.08em", color: "var(--color-text-weak)", opacity: "0.6" }}>
                      {parts.slice(-2).join("/")}
                    </span>
                  }
                } catch {}
              }}
            </Show>
          </div>
        </Show>
      </div>

      {/* Content — position:absolute so the scroll container always has an explicit bounded height */}
      <div style={{ flex: "1", position: "relative", overflow: "hidden" }}>
      <div ref={scrollRef} class="sd-content-scroll" style={{ position: "absolute", inset: "0", "overflow-y": "auto" }}><div style={{ "max-width": "720px", margin: "0 auto", padding: "32px 48px 80px" }}>
        <Show when={data.loading && !cachedData()}>
          <div style={{ display: "flex", "align-items": "center", "justify-content": "center", "padding-top": "80px", color: "var(--color-text-weak)", "font-size": "13px" }}>
            Loading…
          </div>
        </Show>
        <Show when={cachedData() ?? data()}>
          {(resource) => (
            <>
              <h1 style={{ "font-size": "28px", "font-weight": "600", color: "var(--color-text-strong)", "line-height": "1.25", "margin": "0 0 14px 0" }}>
                {resource().title ?? resource().url ?? "Untitled"}
              </h1>

              <div style={{ display: "flex", "align-items": "center", gap: "8px", "margin-bottom": "28px", "flex-wrap": "wrap" }}>
                <Show when={resource().author}>
                  <span style={{ "font-size": "11px", "font-weight": "500", color: "var(--color-text-weak)", "text-transform": "uppercase", "letter-spacing": "0.06em" }}>
                    {resource().author}
                  </span>
                  <span style={{ color: "var(--color-text-dimmed, var(--text-weak))", opacity: "0.4" }}>·</span>
                </Show>
                <Show when={resource().url}>
                  {(url) => {
                    try {
                      return <span style={{ "font-size": "11px", color: "var(--color-text-weak)", "text-transform": "uppercase", "letter-spacing": "0.06em" }}>
                        {new URL(url()).hostname.replace(/^www\./, "")}
                      </span>
                    } catch { return null }
                  }}
                </Show>
                <span style={{ color: "var(--color-text-dimmed, var(--text-weak))", opacity: "0.4" }}>·</span>
                <span style={{ "font-size": "11px", color: "var(--color-text-dimmed, var(--text-weak))" }}>
                  {timeAgo(resource().time_created)}
                </span>
                <Show when={resource().url}>
                  <span style={{ color: "var(--color-text-dimmed, var(--text-weak))", opacity: "0.4" }}>·</span>
                  <a
                    href={resource().url!}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ "font-size": "11px", color: "#d68a2e", "text-decoration": "none" }}
                  >
                    Open source ↗
                  </a>
                </Show>
              </div>

              <div style={{ "border-top": "1px solid var(--border-weak-base)", "margin-bottom": "28px" }} />

              {/* Prose div is always rendered so proseEl() is always set — effect can always write to it */}
              <div
                ref={(el) => setProseEl(el)}
                class="sd-prose"
                style={{ "font-size": "15px", "line-height": "1.7", color: "var(--color-text-base, var(--text-base))", "word-break": "break-word" }}
              />
              <Show when={!resource().content}>
                <div style={{ color: "var(--color-text-weak)", "font-size": "14px", "font-style": "italic", display: "flex", "align-items": "center", gap: "8px" }}>
                  {resource().status === "failed"
                    ? "⚠️ Failed to fetch content."
                    : resource().status === "done"
                      ? "No readable content extracted from this URL."
                      : (
                        <>
                          <svg style={{ "animation": "spin 1s linear infinite", "flex-shrink": "0" }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                          </svg>
                          Fetching content…
                        </>
                      )
                  }
                </div>
              </Show>
            </>
          )}
        </Show>
      </div></div></div>

      {/* Fragments panel (above bottom bar) */}
      <Show when={activePanel() === "fragments"}>
        <FragmentsPanel
          fragments={fragments()}
          isCapturing={isCapturing()}
          onClose={() => setActivePanel(null)}
        />
      </Show>

      {/* Stats panel (above bottom bar) */}
      <Show when={activePanel() === "stats"}>
        <StatsPanel
          readTimeSecs={readSecs()}
          isCapturing={isCapturing()}
          fragmentCount={fragments().length}
          onClose={() => setActivePanel(null)}
        />
      </Show>

      {/* Bottom status bar */}
      <div style={{ "flex-shrink": "0", padding: "0 16px 14px", display: "flex", "justify-content": "center" }}>
      <div
        style={{
          display: "flex", "align-items": "center",
          padding: "0 12px",
          height: "44px",
          width: "fit-content",
          "max-width": "680px",
          border: "1px solid var(--border-weak-base)",
          "border-radius": "10px",
          background: "var(--background-surface, var(--background-base))",
          gap: "4px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Capture status */}
        <div style={{ display: "flex", "align-items": "center", gap: "7px", "margin-right": "8px" }}>
          <span style={{
            display: "inline-block", width: "8px", height: "8px", "border-radius": "2px",
            background: isCapturing() ? "#d68a2e" : "var(--color-text-dimmed, var(--text-weak))",
            opacity: isCapturing() ? "1" : "0.35",
            animation: isCapturing() ? "sd-pulse 1.4s ease-in-out infinite" : "none",
          }} />
          <span style={{
            "font-family": "'Geist Mono', monospace", "font-size": "10px",
            "letter-spacing": "0.06em",
            color: isCapturing() ? "var(--color-text-base, var(--text-base))" : "var(--color-text-weak)",
            opacity: isCapturing() ? "1" : "0.6",
          }}>
            {isCapturing() ? "capturing · live" : (data() ?? cachedData())?.status === "done" ? "processed" : "idle"}
          </span>
        </div>

        <div style={{ width: "1px", height: "18px", background: "var(--border-weak-base)", margin: "0 8px" }} />

        {/* Fragments button */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); togglePanel("fragments") }}
          style={{
            display: "flex", "align-items": "center", gap: "5px",
            padding: "4px 10px",
            "border-radius": "5px",
            border: activePanel() === "fragments"
              ? "1px solid rgba(214,138,46,0.6)"
              : "1px solid var(--border-weak-base)",
            background: activePanel() === "fragments"
              ? "rgba(214,138,46,0.12)"
              : "transparent",
            cursor: "pointer",
            transition: "all 120ms",
          }}
        >
          <span style={{
            "font-family": "'Geist Mono', monospace", "font-size": "10px", "font-weight": "500",
            "letter-spacing": "0.06em",
            color: activePanel() === "fragments" ? "#d68a2e" : "var(--color-text-weak)",
          }}>
            Fragments
          </span>
          <Show when={fragments().length > 0}>
            <span style={{
              "font-family": "'Geist Mono', monospace", "font-size": "10px", "font-weight": "700",
              color: activePanel() === "fragments" ? "#d68a2e" : "var(--color-text-strong)",
            }}>
              · {fragments().length}
            </span>
          </Show>
        </button>

        {/* Stats button */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); togglePanel("stats") }}
          style={{
            padding: "4px 10px",
            "border-radius": "5px",
            border: activePanel() === "stats"
              ? "1px solid rgba(214,138,46,0.6)"
              : "1px solid transparent",
            background: "transparent",
            cursor: "pointer",
            transition: "all 120ms",
          }}
        >
          <span style={{
            "font-family": "'Geist Mono', monospace", "font-size": "10px", "font-weight": "500",
            "letter-spacing": "0.06em",
            color: activePanel() === "stats" ? "#d68a2e" : "var(--color-text-weak)",
          }}>
            Stats
          </span>
        </button>

        {/* Spacer */}
        <div style={{ flex: "1" }} />

        {/* Action buttons */}
        <div style={{ display: "flex", "align-items": "center", gap: "4px" }}>
          {(["Learn", "Review Notes"] as const).map((label) => (
            <button
              type="button"
              style={{
                padding: "5px 14px",
                "border-radius": "5px",
                border: "1px solid rgba(214,138,46,0.4)",
                background: "rgba(214,138,46,0.1)",
                cursor: "pointer",
                transition: "all 120ms",
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLElement
                el.style.background = "rgba(214,138,46,0.2)"
                el.style.borderColor = "rgba(214,138,46,0.7)"
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLElement
                el.style.background = "rgba(214,138,46,0.1)"
                el.style.borderColor = "rgba(214,138,46,0.4)"
              }}
            >
              <span style={{
                "font-family": "'Geist Mono', monospace", "font-size": "10px", "font-weight": "600",
                "letter-spacing": "0.06em", color: "#d68a2e",
              }}>
                {label}
              </span>
            </button>
          ))}
        </div>
      </div>
      </div>

      {/* Pulse animation + prose styles */}
      <style>{`
        @keyframes sd-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        .sd-prose h1, .sd-prose h2, .sd-prose h3, .sd-prose h4 {
          font-weight: 600; color: var(--color-text-strong); margin: 1.4em 0 0.5em;
          line-height: 1.3;
        }
        .sd-prose h1 { font-size: 1.6em; }
        .sd-prose h2 { font-size: 1.3em; }
        .sd-prose h3 { font-size: 1.1em; }
        .sd-prose p { margin: 0 0 1em; }
        .sd-prose ul, .sd-prose ol { margin: 0 0 1em 1.5em; }
        .sd-prose li { margin-bottom: 0.25em; }
        .sd-prose a { color: #d68a2e; text-decoration: none; }
        .sd-prose a:hover { text-decoration: underline; }
        .sd-prose code { font-family: 'Geist Mono', monospace; font-size: 0.88em; background: var(--surface-base); padding: 0.15em 0.35em; border-radius: 3px; }
        .sd-prose pre { background: var(--surface-base); border: 1px solid var(--border-weak-base); border-radius: 6px; padding: 1em; overflow-x: auto; margin: 0 0 1em; }
        .sd-prose pre code { background: none; padding: 0; font-size: 0.85em; }
        .sd-prose blockquote { border-left: 3px solid rgba(214,138,46,0.4); margin: 0 0 1em; padding: 0.5em 0 0.5em 1em; color: var(--color-text-weak); font-style: italic; }
        .sd-prose hr { border: none; border-top: 1px solid var(--border-weak-base); margin: 1.5em 0; }
        .sd-prose strong { font-weight: 600; color: var(--color-text-strong); }
        .sd-prose img { max-width: 100%; border-radius: 6px; height: auto; display: block; margin: 1em 0; }
        .sd-prose img[src=""] { display: none; }
        .sd-content-scroll { overflow-anchor: none; }
        .sd-prose { overflow-anchor: none; }
      `}</style>
    </div>
  )
}

// ── Local Source types ────────────────────────────────────────────────────────

type LocalSource = {
  id: string; project_id: string; project_name: string; filename: string
  title: string; url: string | null; status: "processing" | "done" | "failed"
  size: number; time_created: number; source_type?: string
}

// One card per filename, with all projects it belongs to
type GroupedLocalSource = {
  filename: string
  title: string
  url: string | null
  status: "processing" | "done" | "failed"
  size: number
  time_created: number
  source_type?: string
  projects: Array<{ project_id: string; project_name: string }>
}

// ── Local Source Reader ───────────────────────────────────────────────────────

function LocalSourceReader(props: { source: GroupedLocalSource; onBack: () => void }) {
  const marked = useMarked()
  const [proseEl, setProseEl] = createSignal<HTMLDivElement | undefined>(undefined)
  let scrollRef: HTMLDivElement | undefined

  const domain = () => {
    if (!props.source.url) return null
    try { return new URL(props.source.url).hostname.replace(/^www\./, "") } catch { return null }
  }

  const typeLabel = () => {
    const st = (props.source as any).source_type as string | undefined
    if (st) return st.toUpperCase()
    if (!props.source.url) return "NOTE"
    const d = domain() ?? ""
    if (d.includes("x.com") || d.includes("twitter.com")) return "X"
    if (d.includes("linkedin.com")) return "LINKEDIN"
    if (d.includes("youtube.com") || d.includes("youtu.be")) return "YOUTUBE"
    if (d.includes("github.com")) return "GITHUB"
    if (d.includes("notion.so")) return "NOTION"
    if (d.includes("medium.com")) return "MEDIUM"
    if (d.includes("substack.com")) return "SUBSTACK"
    if (d.includes("reddit.com")) return "REDDIT"
    if (d.includes("news.ycombinator.com")) return "HN"
    if (d.includes("arxiv.org")) return "ARXIV"
    if (props.source.url.endsWith(".pdf") || props.source.url.includes(".pdf?")) return "PDF"
    return "WEB"
  }

  const typeBadgeStyle = () => {
    const label = typeLabel()
    const styles: Record<string, { color: string; bg: string; border: string }> = {
      X:        { color: "#ffffff", bg: "#000000", border: "#000000" },
      LINKEDIN: { color: "#ffffff", bg: "#0077b5", border: "#0077b5" },
      YOUTUBE:  { color: "#ffffff", bg: "#ff0000", border: "#ff0000" },
      GITHUB:   { color: "#ffffff", bg: "#24292e", border: "#24292e" },
      PDF:      { color: "#ffffff", bg: "#dc2626", border: "#dc2626" },
      NOTION:   { color: "#ffffff", bg: "#191919", border: "#191919" },
      MEDIUM:   { color: "#ffffff", bg: "#000000", border: "#000000" },
      SUBSTACK: { color: "#ffffff", bg: "#ff6719", border: "#ff6719" },
      REDDIT:   { color: "#ffffff", bg: "#ff4500", border: "#ff4500" },
      HN:       { color: "#ffffff", bg: "#ff6600", border: "#ff6600" },
      ARXIV:    { color: "#ffffff", bg: "#b31b1b", border: "#b31b1b" },
      WEB:      { color: "#6b7280", bg: "#f3f4f6", border: "#e5e7eb" },
      NOTE:     { color: "#6b7280", bg: "#f3f4f6", border: "#e5e7eb" },
    }
    return styles[label] ?? { color: "#d68a2e", bg: "rgba(214,138,46,0.06)", border: "rgba(214,138,46,0.3)" }
  }

  // Fetch the file content from the backend
  const [content, { refetch }] = createResource(
    () => ({ id: props.source.projects[0]?.project_id ?? "", filename: props.source.filename }),
    async ({ id, filename }) => {
      try {
        const res = await elApi.getLocalSourceFileContent(id, filename)
        return res
      } catch { return null }
    }
  )

  // Poll while processing
  createEffect(() => {
    if (props.source.status === "processing") {
      const t = setInterval(() => void refetch(), 5000)
      onCleanup(() => clearInterval(t))
    }
  })

  const [readSecs, setReadSecs] = createSignal(0)
  const timer = setInterval(() => setReadSecs(s => s + 1), 1000)
  onCleanup(() => clearInterval(timer))

  const fragments = createMemo(() => extractFragments(content() ?? ""))

  const [activePanel, setActivePanel] = createSignal<"fragments" | "stats" | null>(null)

  // Render markdown into prose div
  createEffect(() => {
    const el = proseEl()
    const c = content()
    if (!el || !c) return
    // Strip the first two lines (title + Source:) already shown in header
    const body = c.replace(/^#[^\n]*\n/, "").replace(/^Source:[^\n]*\n/, "").replace(/^Status:[^\n]*\n/, "").trim()
    void Promise.resolve(marked.parse(body)).then((html: string) => {
      const currentEl = proseEl()
      if (!currentEl) return
      currentEl.innerHTML = html
    })
  })

  return (
    <div style={{ height: "100%", display: "flex", "flex-direction": "column", overflow: "hidden", position: "relative" }}
      onClick={() => setActivePanel(null)}
    >
      {/* Toolbar */}
      <div style={{
        "flex-shrink": "0", display: "flex", "align-items": "center", gap: "10px",
        padding: "10px 24px", "border-bottom": "1px solid var(--border-weak-base)",
        background: "var(--background-base)",
      }}>
        <button type="button" onClick={props.onBack}
          style={{ background: "none", border: "none", cursor: "pointer", display: "flex", "align-items": "center", gap: "5px", color: "var(--color-text-weak)", padding: "0", "font-size": "12px", "font-family": "inherit" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Back
        </button>
        <span style={{
          "font-family": "'Geist Mono', monospace", "font-size": "9px", "font-weight": "700", "letter-spacing": "0.1em",
          color: typeBadgeStyle().color, padding: "2px 6px", "border-radius": "3px",
          background: typeBadgeStyle().bg, border: `1px solid ${typeBadgeStyle().border}`,
        }}>{typeLabel()}</span>
        <Show when={props.source.url}>
          <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "9px", "letter-spacing": "0.08em", color: "var(--color-text-weak)", opacity: "0.6" }}>
            {(() => { try { const u = new URL(props.source.url!); return u.pathname.split("/").filter(Boolean).slice(-2).join("/") } catch { return "" } })()}
          </span>
        </Show>
      </div>

      {/* Content */}
      <div style={{ flex: "1", position: "relative", overflow: "hidden" }}>
        <div ref={scrollRef} class="sd-content-scroll" style={{ position: "absolute", inset: "0", "overflow-y": "auto" }}>
          <div style={{ "max-width": "720px", margin: "0 auto", padding: "32px 48px 80px" }}>
            <h1 style={{ "font-size": "28px", "font-weight": "600", color: "var(--color-text-strong)", "line-height": "1.25", margin: "0 0 14px 0" }}>
              {props.source.title}
            </h1>
            <div style={{ display: "flex", "align-items": "center", gap: "8px", "margin-bottom": "28px", "flex-wrap": "wrap" }}>
              <Show when={domain()}>
                <span style={{ "font-size": "11px", color: "var(--color-text-weak)", "text-transform": "uppercase", "letter-spacing": "0.06em" }}>{domain()}</span>
                <span style={{ color: "var(--color-text-weak)", opacity: "0.4" }}>·</span>
              </Show>
              <span style={{ "font-size": "11px", color: "var(--color-text-dimmed, var(--text-weak))" }}>{timeAgo(props.source.time_created)}</span>
              <Show when={props.source.url}>
                <span style={{ color: "var(--color-text-weak)", opacity: "0.4" }}>·</span>
                <a href={props.source.url!} target="_blank" rel="noopener noreferrer"
                  style={{ "font-size": "11px", color: "#d68a2e", "text-decoration": "none" }}>
                  Open source ↗
                </a>
              </Show>
            </div>
            <div style={{ "border-top": "1px solid var(--border-weak-base)", "margin-bottom": "28px" }} />
            <Show when={content.loading}>
              <div style={{ color: "var(--color-text-weak)", "font-size": "14px" }}>Loading…</div>
            </Show>
            <Show when={props.source.status === "processing" && !content()}>
              <div style={{ display: "flex", "align-items": "center", gap: "8px", color: "var(--color-text-weak)", "font-size": "14px", "font-style": "italic" }}>
                <svg style={{ animation: "spin 1s linear infinite" }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                Fetching content via Airtop…
              </div>
            </Show>
            <div ref={(el) => setProseEl(el)} class="sd-prose"
              style={{ "font-size": "15px", "line-height": "1.7", color: "var(--color-text-base, var(--text-base))", "word-break": "break-word" }} />
          </div>
        </div>
      </div>

      {/* Fragments panel */}
      <Show when={activePanel() === "fragments"}>
        <FragmentsPanel fragments={fragments()} isCapturing={props.source.status === "processing"} onClose={() => setActivePanel(null)} />
      </Show>

      {/* Bottom bar */}
      <div style={{ "flex-shrink": "0", padding: "0 16px 14px", display: "flex", "justify-content": "center" }}>
        <div style={{
          display: "flex", "align-items": "center", padding: "0 12px", height: "44px",
          width: "fit-content", "max-width": "680px",
          border: "1px solid var(--border-weak-base)", "border-radius": "10px",
          background: "var(--background-surface, var(--background-base))", gap: "4px",
        }} onClick={e => e.stopPropagation()}>
          {/* Status */}
          <div style={{ display: "flex", "align-items": "center", gap: "7px", "margin-right": "8px" }}>
            <span style={{
              display: "inline-block", width: "8px", height: "8px", "border-radius": "2px",
              background: props.source.status === "processing" ? "#d68a2e" : "var(--color-text-dimmed, var(--text-weak))",
              opacity: props.source.status === "processing" ? "1" : "0.35",
              animation: props.source.status === "processing" ? "sd-pulse 1.4s ease-in-out infinite" : "none",
            }} />
            <span style={{
              "font-family": "'Geist Mono', monospace", "font-size": "10px", "letter-spacing": "0.06em",
              color: props.source.status === "processing" ? "var(--color-text-base, var(--text-base))" : "var(--color-text-weak)",
              opacity: props.source.status === "processing" ? "1" : "0.6",
            }}>
              {props.source.status === "processing" ? "capturing · live" : props.source.status === "done" ? "processed" : "failed"}
            </span>
          </div>
          <div style={{ width: "1px", height: "18px", background: "var(--border-weak-base)", margin: "0 8px" }} />
          {/* Fragments */}
          <button type="button" onClick={e => { e.stopPropagation(); setActivePanel(v => v === "fragments" ? null : "fragments") }}
            style={{
              display: "flex", "align-items": "center", gap: "5px", padding: "4px 10px", "border-radius": "5px",
              border: activePanel() === "fragments" ? "1px solid rgba(214,138,46,0.6)" : "1px solid var(--border-weak-base)",
              background: activePanel() === "fragments" ? "rgba(214,138,46,0.12)" : "transparent",
              cursor: "pointer", transition: "all 120ms",
            }}>
            <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", "font-weight": "500", "letter-spacing": "0.06em", color: activePanel() === "fragments" ? "#d68a2e" : "var(--color-text-weak)" }}>Fragments</span>
            <Show when={fragments().length > 0}>
              <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", "font-weight": "700", color: activePanel() === "fragments" ? "#d68a2e" : "var(--color-text-strong)" }}>· {fragments().length}</span>
            </Show>
          </button>
          <div style={{ flex: "1" }} />
          {/* Action buttons */}
          <div style={{ display: "flex", "align-items": "center", gap: "4px" }}>
            <Show when={props.source.url}>
              <button type="button" onClick={() => window.open(props.source.url!, "_blank")}
                style={{ padding: "5px 14px", "border-radius": "5px", border: "1px solid rgba(214,138,46,0.4)", background: "rgba(214,138,46,0.1)", cursor: "pointer", transition: "all 120ms" }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(214,138,46,0.2)"; el.style.borderColor = "rgba(214,138,46,0.7)" }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(214,138,46,0.1)"; el.style.borderColor = "rgba(214,138,46,0.4)" }}
              >
                <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", "font-weight": "600", "letter-spacing": "0.06em", color: "#d68a2e" }}>Open Source</span>
              </button>
            </Show>
            <button type="button"
              onClick={() => window.location.href = `/local-projects/${props.source.projects[0]?.project_id ?? ""}`}
              style={{ padding: "5px 14px", "border-radius": "5px", border: "1px solid rgba(214,138,46,0.4)", background: "#d68a2e", cursor: "pointer", transition: "opacity 120ms" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.85" }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1" }}
            >
              <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", "font-weight": "600", "letter-spacing": "0.06em", color: "#fff" }}>View Project</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Local Source Card ─────────────────────────────────────────────────────────

function LocalSourceCard(props: {
  source: GroupedLocalSource
  onOpen: (src: GroupedLocalSource) => void
  onChanged?: () => void
}) {
  const [hovered, setHovered] = createSignal(false)
  const [pickerOpen, setPickerOpen] = createSignal(false)
  const [addingToProject, setAddingToProject] = createSignal<string | null>(null)
  const [addedProjects, setAddedProjects] = createSignal<string[]>([])
  // Track which project pills have been removed locally (optimistic UI)
  const [removedProjects, setRemovedProjects] = createSignal<string[]>([])
  const [removingProject, setRemovingProject] = createSignal<string | null>(null)
  const [deletingAll, setDeletingAll] = createSignal(false)
  const [confirmDelete, setConfirmDelete] = createSignal(false)

  const visibleProjects = () => props.source.projects.filter(p => !removedProjects().includes(p.project_id))

  async function handleRemoveFromProject(e: MouseEvent, projectId: string, projectName: string) {
    e.stopPropagation()
    if (removingProject()) return
    setRemovingProject(projectId)
    try {
      await elApi.deleteLocalSource(projectId, props.source.filename)
      setRemovedProjects(prev => [...prev, projectId])
      // If last project removed, tell parent to refetch (card will disappear)
      if (visibleProjects().length === 0) props.onChanged?.()
    } catch {
      showToast({ variant: "error", title: `Failed to remove from ${projectName}` })
    } finally {
      setRemovingProject(null)
    }
  }

  async function handleDeleteAll(e: MouseEvent) {
    e.stopPropagation()
    if (deletingAll()) return
    setDeletingAll(true)
    try {
      await Promise.all(
        visibleProjects().map(p => elApi.deleteLocalSource(p.project_id, props.source.filename))
      )
      props.onChanged?.()
    } catch {
      showToast({ variant: "error", title: "Failed to delete from all projects" })
      setDeletingAll(false)
      setConfirmDelete(false)
    }
  }

  // Fetch all projects (EL + local) when picker opens
  const [elProjects] = createResource(pickerOpen, (open) => open ? elApi.listProjects() : Promise.resolve([]))
  const [localProjects] = createResource(pickerOpen, (open) => open ? elApi.listLocalProjects() : Promise.resolve([]))

  const alreadyInProjectIds = () => new Set([
    ...props.source.projects.map(p => p.project_id),
    ...addedProjects(),
  ])

  async function addToProject(projectId: string, projectName: string, projectType: "el" | "local") {
    setAddingToProject(projectId)
    try {
      if (projectType === "local") {
        const base = import.meta.env.DEV
          ? `http://${import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:4096`
          : `${location.origin}/api`
        const res = await fetch(`${base}/local-projects/${projectId}/sources`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: props.source.url }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: string }
          throw new Error(err.error ?? "Failed to add")
        }
      } else {
        if (!props.source.url) throw new Error("No URL on this source")
        await elApi.addResource(projectId, props.source.url, "supplementary")
      }
      setAddedProjects(prev => [...prev, projectId])
      showToast({ variant: "success", title: `Added to ${projectName}` })
    } catch (e: any) {
      showToast({ variant: "error", title: e?.message ?? "Failed to add" })
    } finally {
      setAddingToProject(null)
    }
  }

  const domain = () => {
    if (!props.source.url) return null
    try { return new URL(props.source.url).hostname.replace(/^www\./, "") } catch { return null }
  }

  const typeLabel = () => {
    const st = (props.source as any).source_type as string | undefined
    if (st) return st.toUpperCase()
    if (!props.source.url) return "NOTE"
    const d = domain() ?? ""
    if (d.includes("x.com") || d.includes("twitter.com")) return "X"
    if (d.includes("linkedin.com")) return "LINKEDIN"
    if (d.includes("youtube.com") || d.includes("youtu.be")) return "YOUTUBE"
    if (d.includes("github.com")) return "GITHUB"
    if (d.includes("notion.so")) return "NOTION"
    if (d.includes("medium.com")) return "MEDIUM"
    if (d.includes("substack.com")) return "SUBSTACK"
    if (d.includes("reddit.com")) return "REDDIT"
    if (d.includes("news.ycombinator.com")) return "HN"
    if (d.includes("arxiv.org")) return "ARXIV"
    if (props.source.url.endsWith(".pdf") || props.source.url.includes(".pdf?")) return "PDF"
    return "WEB"
  }

  const typeBadgeStyle = () => {
    const label = typeLabel()
    const styles: Record<string, { color: string; bg: string; border: string }> = {
      X:        { color: "#ffffff", bg: "#000000", border: "#000000" },
      LINKEDIN: { color: "#ffffff", bg: "#0077b5", border: "#0077b5" },
      YOUTUBE:  { color: "#ffffff", bg: "#ff0000", border: "#ff0000" },
      GITHUB:   { color: "#ffffff", bg: "#24292e", border: "#24292e" },
      PDF:      { color: "#ffffff", bg: "#dc2626", border: "#dc2626" },
      NOTION:   { color: "#ffffff", bg: "#191919", border: "#191919" },
      MEDIUM:   { color: "#ffffff", bg: "#000000", border: "#000000" },
      SUBSTACK: { color: "#ffffff", bg: "#ff6719", border: "#ff6719" },
      REDDIT:   { color: "#ffffff", bg: "#ff4500", border: "#ff4500" },
      HN:       { color: "#ffffff", bg: "#ff6600", border: "#ff6600" },
      ARXIV:    { color: "#ffffff", bg: "#b31b1b", border: "#b31b1b" },
      WEB:      { color: "#6b7280", bg: "#f3f4f6", border: "#e5e7eb" },
      NOTE:     { color: "#6b7280", bg: "#f3f4f6", border: "#e5e7eb" },
    }
    return styles[label] ?? { color: "#d68a2e", bg: "rgba(214,138,46,0.06)", border: "rgba(214,138,46,0.3)" }
  }

  const urlPath = () => {
    if (!props.source.url) return null
    try {
      const u = new URL(props.source.url)
      const parts = u.pathname.split("/").filter(Boolean)
      return parts.length ? parts.slice(-2).join("/") : null
    } catch { return null }
  }

  // Don't render if all projects have been removed optimistically
  return (
    <Show when={visibleProjects().length > 0}>
      <div
        style={{ "border-bottom": "1px solid #ebebeb", background: "#ffffff" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => { setHovered(false); setConfirmDelete(false) }}
      >
        <div
          onClick={() => props.onOpen(props.source)}
          style={{
            padding: "18px 20px 16px",
            background: hovered() ? "#fafafa" : "transparent",
            transition: "background 120ms",
            cursor: "pointer",
          }}
        >
          {/* ROW 1: type badge + status + domain (left) | project pills + add button (right) */}
          <div style={{ display: "flex", "align-items": "flex-start", "justify-content": "space-between", "margin-bottom": "10px", gap: "12px" }}>
            {/* Left badges */}
            <div style={{ display: "flex", "align-items": "center", gap: "6px", "flex-wrap": "wrap", "min-width": "0", flex: "1" }}>
              <span style={{
                "font-family": "'Geist Mono', monospace", "font-size": "9px", "font-weight": "700",
                "letter-spacing": "0.1em", "text-transform": "uppercase",
                color: typeBadgeStyle().color, padding: "3px 7px", "border-radius": "3px",
                background: typeBadgeStyle().bg, border: `1px solid ${typeBadgeStyle().border}`,
                "white-space": "nowrap", "flex-shrink": "0",
              }}>{typeLabel()}</span>

              <Show when={props.source.status === "processing"}>
                <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "9px", "font-weight": "600", "letter-spacing": "0.1em", "text-transform": "uppercase", color: "#f59e0b", padding: "3px 7px", "border-radius": "3px", background: "#fffbeb", border: "1px solid #fde68a", "white-space": "nowrap", "flex-shrink": "0" }}>PARSING</span>
              </Show>
              <Show when={props.source.status === "done"}>
                <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "9px", "font-weight": "600", "letter-spacing": "0.1em", "text-transform": "uppercase", color: "#a3a3a3", padding: "3px 7px", "border-radius": "3px", background: "#f5f5f5", border: "1px solid #e5e5e5", "white-space": "nowrap", "flex-shrink": "0" }}>PROCESSED</span>
              </Show>
              <Show when={props.source.status === "failed"}>
                <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "9px", "font-weight": "600", "letter-spacing": "0.1em", "text-transform": "uppercase", color: "#ef4444", padding: "3px 7px", "border-radius": "3px", background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.25)", "white-space": "nowrap", "flex-shrink": "0" }}>FAILED</span>
              </Show>

              <Show when={domain()}>
                <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#a3a3a3", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>{domain()}</span>
              </Show>
            </div>

            {/* Right: project pills with × + add button */}
            <div style={{ display: "flex", "align-items": "center", gap: "4px", "flex-wrap": "wrap", "justify-content": "flex-end", "flex-shrink": "0", "max-width": "240px" }} onClick={e => e.stopPropagation()}>
              <For each={visibleProjects()}>
                {(proj) => {
                  const isRemoving = () => removingProject() === proj.project_id
                  return (
                    <div style={{
                      display: "inline-flex", "align-items": "center", gap: "4px",
                      padding: "3px 6px 3px 8px", "border-radius": "999px",
                      background: "rgba(214,138,46,0.06)", border: "1px solid rgba(214,138,46,0.25)",
                      "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#d68a2e",
                    }}>
                      <span style={{ width: "6px", height: "6px", "border-radius": "50%", background: "#d68a2e", display: "inline-block", "flex-shrink": "0" }} />
                      <span style={{ overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap", "max-width": "90px" }}>{proj.project_name}</span>
                      <button
                        type="button"
                        title={`Remove from ${proj.project_name}`}
                        disabled={isRemoving()}
                        onClick={(e) => void handleRemoveFromProject(e, proj.project_id, proj.project_name)}
                        style={{
                          background: "none", border: "none", cursor: isRemoving() ? "not-allowed" : "pointer",
                          color: "#d68a2e", opacity: isRemoving() ? "0.4" : "0.6",
                          display: "flex", "align-items": "center", padding: "0 1px",
                          "font-size": "11px", "line-height": "1", transition: "opacity 100ms",
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "1" }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = isRemoving() ? "0.4" : "0.6" }}
                      >×</button>
                    </div>
                  )
                }}
              </For>

              {/* + add to project button */}
              <Show when={props.source.url}>
                <div style={{ position: "relative" }}>
                  <button
                    type="button"
                    title="Add to another project"
                    onClick={(e) => { e.stopPropagation(); setPickerOpen(v => !v) }}
                    style={{
                      width: "22px", height: "22px", "border-radius": "6px",
                      background: pickerOpen() ? "#f5f5f5" : "none",
                      border: `1px solid ${pickerOpen() ? "#d4d4d4" : "#e5e5e5"}`,
                      cursor: "pointer", color: "#525252",
                      display: "flex", "align-items": "center", "justify-content": "center",
                      "font-size": "14px", "line-height": "1",
                    }}
                  >+</button>

                  <Show when={pickerOpen()}>
                    <div style={{ position: "fixed", inset: "0", "z-index": "40" }} onClick={() => setPickerOpen(false)} />
                    <div style={{
                      position: "absolute", top: "calc(100% + 6px)", right: "0",
                      width: "240px", background: "#ffffff",
                      "border-radius": "10px", "box-shadow": "0 4px 24px rgba(0,0,0,0.12)",
                      border: "1px solid #e5e5e5", "z-index": "50", overflow: "hidden",
                    }}>
                      <div style={{ padding: "10px 14px 8px", "border-bottom": "1px solid #f0f0f0" }}>
                        <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", "font-weight": "600", "letter-spacing": "0.08em", "text-transform": "uppercase", color: "#a3a3a3" }}>ADD TO PROJECT</span>
                      </div>
                      <div style={{ "max-height": "240px", "overflow-y": "auto" }}>
                        <For each={elProjects() ?? []}>
                          {(proj) => {
                            const isAdded = () => alreadyInProjectIds().has(proj.id)
                            const isAdding = () => addingToProject() === proj.id
                            return (
                              <button type="button" disabled={isAdded() || isAdding()}
                                onClick={(e) => { e.stopPropagation(); void addToProject(proj.id, proj.name, "el") }}
                                style={{ width: "100%", display: "flex", "align-items": "center", "justify-content": "space-between", padding: "10px 14px", background: "none", border: "none", cursor: isAdded() ? "default" : "pointer", "border-bottom": "1px solid #f9f9f9", transition: "background 100ms" }}
                                onMouseEnter={e => { if (!isAdded()) (e.currentTarget as HTMLElement).style.background = "#fafafa" }}
                                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "none" }}
                              >
                                <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                                  <span style={{ width: "7px", height: "7px", "border-radius": "50%", background: isAdded() ? "#d4d4d4" : "#d68a2e", "flex-shrink": "0" }} />
                                  <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "12px", color: isAdded() ? "#a3a3a3" : "#0a0a0a" }}>{proj.name}</span>
                                </div>
                                <Show when={isAdded()}><span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", color: "#a3a3a3" }}>added</span></Show>
                                <Show when={isAdding()}><span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", color: "#d68a2e" }}>adding…</span></Show>
                              </button>
                            )
                          }}
                        </For>
                        <For each={(localProjects() ?? []).filter(p => !alreadyInProjectIds().has(p.id))}>
                          {(proj) => {
                            const isAdding = () => addingToProject() === proj.id
                            return (
                              <button type="button" disabled={isAdding() || !props.source.url}
                                onClick={(e) => { e.stopPropagation(); void addToProject(proj.id, proj.name, "local") }}
                                style={{ width: "100%", display: "flex", "align-items": "center", "justify-content": "space-between", padding: "10px 14px", background: "none", border: "none", cursor: "pointer", "border-bottom": "1px solid #f9f9f9", transition: "background 100ms" }}
                                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#fafafa" }}
                                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "none" }}
                              >
                                <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                                  <span style={{ width: "7px", height: "7px", "border-radius": "50%", background: "#6366f1", "flex-shrink": "0" }} />
                                  <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "12px", color: "#0a0a0a" }}>{proj.name}</span>
                                </div>
                                <Show when={isAdding()}><span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", color: "#6366f1" }}>adding…</span></Show>
                                <Show when={!isAdding()}><span style={{ "font-family": "'Geist Mono', monospace", "font-size": "9px", color: "#a3a3a3" }}>local</span></Show>
                              </button>
                            )
                          }}
                        </For>
                        <Show when={!elProjects.loading && !localProjects.loading && (elProjects()?.length ?? 0) + ((localProjects() ?? []).filter(p => !alreadyInProjectIds().has(p.id)).length) === 0}>
                          <div style={{ padding: "16px 14px", "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#a3a3a3", "text-align": "center" }}>No other projects</div>
                        </Show>
                        <Show when={elProjects.loading || localProjects.loading}>
                          <div style={{ padding: "12px 14px", "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#a3a3a3" }}>Loading…</div>
                        </Show>
                      </div>
                    </div>
                  </Show>
                </div>
              </Show>
            </div>
          </div>

          {/* ROW 2: Title */}
          <div style={{
            "font-family": "'Geist Mono', monospace", "font-size": "15px", "font-weight": "500",
            "line-height": "1.45", color: props.source.status === "processing" ? "#a3a3a3" : "#c87c2a",
            "margin-bottom": "10px",
            overflow: "hidden", display: "-webkit-box",
            "-webkit-line-clamp": "2", "-webkit-box-orient": "vertical",
          }}>
            {props.source.title}
          </div>

          {/* ROW 3: meta left | action buttons right */}
          <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "12px" }}>
            <div style={{ display: "flex", "align-items": "center", gap: "6px", "min-width": "0", flex: "1" }}>
              <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#a3a3a3", "white-space": "nowrap", "flex-shrink": "0" }}>
                {timeAgo(props.source.time_created)}
              </span>
              <Show when={urlPath()}>
                <span style={{ color: "#d4d4d4", "flex-shrink": "0" }}>·</span>
                <a href={props.source.url!} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                  style={{ "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#d68a2e", "text-decoration": "none", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                  {urlPath()}
                </a>
              </Show>
            </div>

            {/* Action buttons */}
            <div style={{ display: "flex", "align-items": "center", gap: "6px", "flex-shrink": "0" }} onClick={e => e.stopPropagation()}>
              <button type="button" onClick={() => props.onOpen(props.source)}
                style={{ "font-family": "'Geist Mono', monospace", "font-size": "11px", "font-weight": "500", color: "#525252", background: "none", border: "1px solid #e5e5e5", "border-radius": "5px", padding: "5px 14px", cursor: "pointer", transition: "all 120ms" }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = "#a3a3a3"; el.style.color = "#0a0a0a" }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = "#e5e5e5"; el.style.color = "#525252" }}
              >review notes</button>
              <button type="button" onClick={() => props.onOpen(props.source)}
                style={{ "font-family": "'Geist Mono', monospace", "font-size": "11px", "font-weight": "600", color: "#ffffff", background: "#d68a2e", border: "1px solid #d68a2e", "border-radius": "5px", padding: "5px 14px", cursor: "pointer", transition: "opacity 120ms" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = "0.85" }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = "1" }}
              >learn</button>

              {/* Delete from all projects — with confirm */}
              <Show when={!confirmDelete()}>
                <button type="button" title={`Delete from all ${visibleProjects().length} project(s)`}
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(true) }}
                  disabled={deletingAll()}
                  style={{ width: "28px", height: "28px", display: "flex", "align-items": "center", "justify-content": "center", background: "none", border: "1px solid #e5e5e5", "border-radius": "5px", cursor: "pointer", color: "#a3a3a3", transition: "all 120ms" }}
                  onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = "#fca5a5"; el.style.color = "#ef4444" }}
                  onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = "#e5e5e5"; el.style.color = "#a3a3a3" }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                  </svg>
                </button>
              </Show>
              <Show when={confirmDelete()}>
                <div style={{ display: "inline-flex", "align-items": "center", gap: "4px", padding: "3px 6px", "border-radius": "5px", border: "1px solid #fca5a5", background: "#fef2f2" }}>
                  <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", color: "#dc2626" }}>
                    delete all {visibleProjects().length > 1 ? `(${visibleProjects().length})` : ""}?
                  </span>
                  <button type="button" onClick={handleDeleteAll} disabled={deletingAll()}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", "font-family": "'Geist Mono', monospace", "font-size": "10px", "font-weight": "600", padding: "0 2px" }}>
                    {deletingAll() ? "…" : "yes"}
                  </button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDelete(false) }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#a3a3a3", "font-family": "'Geist Mono', monospace", "font-size": "10px", padding: "0 2px" }}>
                    no
                  </button>
                </div>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </Show>
  )
}

// ── Document Table Row ────────────────────────────────────────────────────────

function DocumentTableRow(props: { source: GroupedLocalSource; onOpen: (src: GroupedLocalSource) => void }) {
  const [hovered, setHovered] = createSignal(false)

  const docId = () => {
    // Use filename without extension, truncated
    const base = props.source.filename.replace(/\.[^.]+$/, "")
    return base.length > 18 ? base.slice(0, 18) + "…" : base
  }

  const typeLabel = () => {
    const st = props.source.source_type
    if (st) return st.toUpperCase()
    if (!props.source.url) return "NOTE"
    try {
      const d = new URL(props.source.url).hostname.replace(/^www\./, "")
      if (d.includes("x.com") || d.includes("twitter.com")) return "X"
      if (d.includes("linkedin.com")) return "LINKEDIN"
      if (d.includes("youtube.com") || d.includes("youtu.be")) return "YOUTUBE"
      if (d.includes("github.com")) return "GITHUB"
      if (d.includes("notion.so")) return "NOTION"
      if (d.includes("medium.com")) return "MEDIUM"
      if (d.includes("substack.com")) return "SUBSTACK"
      if (d.includes("reddit.com")) return "REDDIT"
      if (d.includes("news.ycombinator.com")) return "HN"
      if (d.includes("arxiv.org")) return "ARXIV"
    } catch { /* ignore */ }
    if (props.source.url?.endsWith(".pdf") || props.source.url?.includes(".pdf?")) return "PDF"
    return "WEB"
  }

  const statusStyle = () => {
    const s = props.source.status
    if (s === "done") return { color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0" }
    if (s === "processing") return { color: "#d97706", bg: "#fffbeb", border: "#fde68a" }
    return { color: "#7c3aed", bg: "#f5f3ff", border: "#ddd6fe" }
  }

  const statusLabel = () => {
    if (props.source.status === "done") return "done"
    if (props.source.status === "processing") return "processing"
    return "new"
  }

  return (
    <tr
      style={{ "border-bottom": "1px solid #f3f4f6", cursor: "pointer", background: hovered() ? "#fafafa" : "transparent", transition: "background 120ms" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => props.onOpen(props.source)}
    >
      {/* DOCUMENT ID */}
      <td style={{ padding: "14px 12px", "vertical-align": "middle", "max-width": "160px" }}>
        <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#9ca3af" }}>{docId()}</span>
      </td>

      {/* CONTENT */}
      <td style={{ padding: "14px 12px", "vertical-align": "middle" }}>
        <span style={{ "font-size": "13px", color: "#111827", "font-weight": "500", "font-family": "inherit" }}>
          {props.source.title || props.source.filename}
        </span>
      </td>

      {/* TYPE */}
      <td style={{ padding: "14px 12px", "vertical-align": "middle" }}>
        {(() => {
          const label = typeLabel()
          const styles: Record<string, { color: string; bg: string; border: string }> = {
            X:        { color: "#ffffff", bg: "#000000", border: "#000000" },
            LINKEDIN: { color: "#ffffff", bg: "#0077b5", border: "#0077b5" },
            YOUTUBE:  { color: "#ffffff", bg: "#ff0000", border: "#ff0000" },
            GITHUB:   { color: "#ffffff", bg: "#24292e", border: "#24292e" },
            PDF:      { color: "#ffffff", bg: "#dc2626", border: "#dc2626" },
            NOTION:   { color: "#ffffff", bg: "#191919", border: "#191919" },
            MEDIUM:   { color: "#ffffff", bg: "#000000", border: "#000000" },
            SUBSTACK: { color: "#ffffff", bg: "#ff6719", border: "#ff6719" },
            REDDIT:   { color: "#ffffff", bg: "#ff4500", border: "#ff4500" },
            HN:       { color: "#ffffff", bg: "#ff6600", border: "#ff6600" },
            ARXIV:    { color: "#ffffff", bg: "#b31b1b", border: "#b31b1b" },
            WEB:      { color: "#6b7280", bg: "#f3f4f6", border: "#e5e7eb" },
            NOTE:     { color: "#6b7280", bg: "#f3f4f6", border: "#e5e7eb" },
          }
          const s = styles[label] ?? { color: "#6b7280", bg: "#f3f4f6", border: "#e5e7eb" }
          return (
            <span style={{
              "font-family": "'Geist Mono', monospace", "font-size": "9px", "font-weight": "700",
              "letter-spacing": "0.08em", "text-transform": "uppercase",
              color: s.color, padding: "3px 7px", "border-radius": "3px",
              background: s.bg, border: `1px solid ${s.border}`,
              "white-space": "nowrap",
            }}>{label}</span>
          )
        })()}
      </td>

      {/* PROJECT TAGS */}
      <td style={{ padding: "14px 12px", "vertical-align": "middle" }}>
        <div style={{ display: "flex", gap: "5px", "flex-wrap": "wrap" }}>
          <For each={props.source.projects}>
            {(p) => (
              <span style={{
                "font-size": "11px", color: "#374151", padding: "2px 8px",
                "border-radius": "4px", border: "1px solid #d1d5db", background: "#ffffff",
                "font-family": "'Geist Mono', monospace", "white-space": "nowrap",
              }}>{p.project_name}</span>
            )}
          </For>
        </div>
      </td>

      {/* STATUS */}
      <td style={{ padding: "14px 12px", "vertical-align": "middle" }}>
        <span style={{
          "font-size": "11px", "font-family": "'Geist Mono', monospace", "font-weight": "600",
          color: statusStyle().color, padding: "3px 9px", "border-radius": "5px",
          background: statusStyle().bg, border: `1px solid ${statusStyle().border}`,
          "white-space": "nowrap",
        }}>{statusLabel()}</span>
      </td>

      {/* MEMORIES */}
      <td style={{ padding: "14px 12px", "vertical-align": "middle", "text-align": "left" }}>
        <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "12px", color: "#374151" }}>—</span>
      </td>

      {/* UPDATED */}
      <td style={{ padding: "14px 12px", "vertical-align": "middle" }}>
        <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#9ca3af" }}>
          {timeAgo(props.source.time_created)}
        </span>
      </td>
    </tr>
  )
}

// ── Main ReadPanel ─────────────────────────────────────────────────────────────

// Module-level cache so the resource list survives tab switches (Show unmounts the component)
let cachedResources: WikiResourceListItem[] | undefined

export function ReadPanel() {
  const api = useWikiApi()
  const [resources, { refetch }] = createResource(() => elApi.listAllResources())
  const [resourceProjects] = createResource(() => elApi.getResourceProjects())
  const [localSources, { refetch: refetchLocalSources }] = createResource(() => elApi.listAllLocalSources())
  const [selected, setSelected] = createSignal<{ id: string; badge: string } | null>(null)
  const [selectedLocal, setSelectedLocal] = createSignal<GroupedLocalSource | null>(null)

  // Group local sources by filename → one card per file, showing all projects
  const groupedLocalSources = (): GroupedLocalSource[] => {
    const rows = localSources() ?? []
    const map = new Map<string, GroupedLocalSource>()
    for (const row of rows) {
      if (!map.has(row.filename)) {
        map.set(row.filename, {
          filename:     row.filename,
          title:        row.title,
          url:          row.url,
          status:       row.status,
          size:         row.size,
          time_created: row.time_created,
          source_type:  row.source_type,
          projects:     [],
        })
      }
      map.get(row.filename)!.projects.push({ project_id: row.project_id, project_name: row.project_name })
    }
    return Array.from(map.values())
  }

  // Build a lookup map: url → project assignments
  const projectsByUrl = () => {
    const rows = resourceProjects() ?? []
    const map = new Map<string, Array<{ project_id: string; project_name: string; join_id: string }>>()
    for (const row of rows) {
      const existing = map.get(row.url) ?? []
      existing.push({ project_id: row.project_id, project_name: row.project_name, join_id: row.join_id })
      map.set(row.url, existing)
    }
    return map
  }

  // Populate cache when data arrives; use it to seed display on remount
  createEffect(() => {
    const r = resources()
    if (r) cachedResources = r
  })

  // Poll while any resource is processing
  let listPollInterval: ReturnType<typeof setInterval> | null = null
  createEffect(() => {
    const list = resources() ?? cachedResources ?? []
    const hasActive = list.some((r) =>
      r.status === "pending" ||
      r.status === "processing"
    )
    if (hasActive && !listPollInterval) {
      listPollInterval = setInterval(() => void refetch(), 3000)
    } else if (!hasActive && listPollInterval) {
      clearInterval(listPollInterval)
      listPollInterval = null
    }
  })
  onCleanup(() => {
    if (listPollInterval) { clearInterval(listPollInterval); listPollInterval = null }
  })

  // Poll local sources while any are processing
  let localPollInterval: ReturnType<typeof setInterval> | null = null
  createEffect(() => {
    const hasProcessing = (localSources() ?? []).some(s => s.status === "processing")
    if (hasProcessing && !localPollInterval) {
      localPollInterval = setInterval(() => void refetchLocalSources(), 5000)
    } else if (!hasProcessing && localPollInterval) {
      clearInterval(localPollInterval)
      localPollInterval = null
    }
  })
  onCleanup(() => {
    if (localPollInterval) { clearInterval(localPollInterval); localPollInterval = null }
  })

  const selectItem = (item: WikiResourceListItem) => {
    setSelected({ id: item.id, badge: sourceBadge(item) })
    setActiveSourceName(item.title ?? item.url ?? null)
  }

  // Open resource from external signal (e.g. graph node click)
  createEffect(() => {
    const id = activeReadResourceId()
    if (!id) return
    setActiveReadResourceId(null)
    // Try to find the resource in the loaded list for a proper badge; fall back to "URL"
    const match = (resources() ?? cachedResources)?.find((r) => r.id === id)
    setSelected({ id, badge: match ? sourceBadge(match) : "URL" })
  })

  // Open resource by URL (e.g. from EL project graph where resource IDs differ).
  // Tracks both the URL signal and resources() so it retries once resources load.
  createEffect(() => {
    const url = activeReadResourceUrl()
    const list = resources() ?? cachedResources
    if (!url || !list) return
    setActiveReadResourceUrl(null)
    const match = list.find((r) => r.url === url)
    if (match) {
      setSelected({ id: match.id, badge: sourceBadge(match) })
      // Update the nav breadcrumb with the actual resource title
      if (match.title) setActiveSourceName(match.title)
    }
  })

  return (
    <div style={{ height: "100%", display: "flex", "flex-direction": "column", background: "#ffffff", overflow: "hidden" }}>
      <Show when={!selected() && !selectedLocal()}>
        {/* Documents table view */}
        <div style={{ "flex-shrink": "0", padding: "28px 32px 20px", background: "#ffffff" }}>
          <h1 style={{ margin: "0 0 4px", "font-size": "22px", "font-weight": "700", color: "#111827", "font-family": "inherit" }}>Documents</h1>
          <p style={{ margin: "0", "font-size": "13px", color: "#6b7280", "font-family": "'Geist Mono', monospace" }}>Browse all documents across your organization</p>
        </div>

        {/* Toolbar */}
        <div style={{ "flex-shrink": "0", display: "flex", "align-items": "center", gap: "10px", padding: "0 32px 16px", background: "#ffffff" }}>
          <button type="button" style={{ display: "flex", "align-items": "center", gap: "6px", padding: "6px 14px", "border-radius": "6px", border: "1px solid #e5e7eb", background: "#ffffff", cursor: "pointer", "font-size": "12px", "font-family": "'Geist Mono', monospace", color: "#374151", "font-weight": "500" }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
            ALL TAGS
          </button>
          <button type="button" style={{ display: "flex", "align-items": "center", gap: "6px", padding: "6px 14px", "border-radius": "6px", border: "1px solid #e5e7eb", background: "#ffffff", cursor: "pointer", "font-size": "12px", "font-family": "'Geist Mono', monospace", color: "#374151", "font-weight": "500" }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
            All statuses
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <div style={{ flex: "1" }} />
          <button type="button" style={{ display: "flex", "align-items": "center", gap: "7px", padding: "7px 18px", "border-radius": "6px", border: "none", background: "#2563eb", cursor: "pointer", "font-size": "12px", "font-family": "'Geist Mono', monospace", color: "#ffffff", "font-weight": "700", "letter-spacing": "0.05em" }}>
            SEARCH PLAYGROUND
          </button>
        </div>

        <div style={{ flex: "1", "overflow-y": "auto", padding: "0 32px" }}>
          {/* Empty state */}
          <Show when={groupedLocalSources().length === 0 && !localSources.loading}>
            <div style={{ display: "flex", "flex-direction": "column", "align-items": "center", "justify-content": "center", "padding-top": "80px", gap: "8px" }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style={{ color: "#d4d4d4" }}>
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
              </svg>
              <span style={{ "font-size": "13px", color: "#737373" }}>No documents yet</span>
              <span style={{ "font-size": "12px", color: "#a3a3a3" }}>Use the Capture button to add links</span>
            </div>
          </Show>

          {/* Table */}
          <Show when={groupedLocalSources().length > 0}>
            <table style={{ width: "100%", "border-collapse": "collapse" }}>
              <thead>
                <tr style={{ "border-bottom": "1px solid #e5e7eb" }}>
                  {(["DOCUMENT ID", "CONTENT", "TYPE", "PROJECT TAGS", "STATUS", "MEMORIES", "UPDATED"] as const).map((col) => (
                    <th style={{
                      "font-family": "'Geist Mono', monospace", "font-size": "10px", "font-weight": "600",
                      "letter-spacing": "0.08em", color: "#9ca3af", "text-align": "left",
                      padding: "8px 12px 10px", "white-space": "nowrap",
                      "border-bottom": "1px solid #e5e7eb",
                    }}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <For each={groupedLocalSources()}>
                  {(src) => <DocumentTableRow source={src} onOpen={(s) => { setSelectedLocal(s) }} />}
                </For>
              </tbody>
            </table>
          </Show>
        </div>
      </Show>

      <Show when={selected()}>
        {(sel) => (
          <ResourceReader
            id={sel().id}
            badge={sel().badge}
            onBack={() => {
              setSelected(null)
              setActiveSourceName(null)
              if (activeGraphProjectId()) {
                setActiveSidebarView({ section: "workspace", view: "lib", label: "Graph" })
              }
            }}
          />
        )}
      </Show>

      <Show when={selectedLocal()}>
        {(src) => (
          <LocalSourceReader
            source={src()}
            onBack={() => { setSelectedLocal(null); setActiveSourceName(null) }}
          />
        )}
      </Show>
    </div>
  )
}
