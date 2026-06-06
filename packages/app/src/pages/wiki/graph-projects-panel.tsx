import { createResource, createSignal, For, Show } from "solid-js"
import { elApi, type ElProject } from "@/pages/projects/el-api"
import { setActiveGraphProjectId, setActiveGraphProjectName } from "@/context/sidebar-view"
import { NewProjectModal } from "./new-project-modal"

const T = {
  bg: "#ffffff",
  border: "#e5e5e5",
  borderHov: "#d4d4d4",
  text: "#0a0a0a",
  textMuted: "#737373",
  textFaint: "#a3a3a3",
  amber: "#d68a2e",
  amberBg: "rgba(214,138,46,0.08)",
  amberBorder: "rgba(214,138,46,0.3)",
  surfaceHov: "#fafafa",
  red: "#ef4444",
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

function statusColor(status: ElProject["status"]) {
  if (status === "active") return T.amber
  if (status === "paused") return T.textFaint
  return T.textMuted
}

function statusLabel(status: ElProject["status"]) {
  if (status === "active") return "ACTIVE"
  if (status === "paused") return "PAUSED"
  return "ONBOARDING"
}

function ProjectRow(props: {
  project: ElProject
  onOpen: () => void
}) {
  const [hov, setHov] = createSignal(false)
  const githubRepo = () => {
    const url = props.project.context_json?.github_url ?? null
    if (!url) return null
    return url.replace(/^https?:\/\/github\.com\//, "")
  }

  return (
    <div
      style={{
        "border-bottom": `1px solid ${T.border}`,
        background: hov() ? T.surfaceHov : T.bg,
        cursor: "pointer",
        transition: "background 120ms",
        padding: "14px 20px",
      }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={props.onOpen}
    >
      {/* Row 1: badges + repo */}
      <div style={{ display: "flex", "align-items": "center", gap: "6px", "margin-bottom": "8px", "flex-wrap": "wrap" }}>
        <span style={{
          "font-family": "'Geist Mono', monospace", "font-size": "9px", "font-weight": "600",
          "letter-spacing": "0.1em", "text-transform": "uppercase",
          color: T.amber, padding: "2px 6px", "border-radius": "3px",
          background: T.amberBg, border: `1px solid ${T.amberBorder}`,
        }}>
          PROJECT
        </span>
        <span style={{
          "font-family": "'Geist Mono', monospace", "font-size": "9px", "font-weight": "600",
          "letter-spacing": "0.1em", "text-transform": "uppercase",
          color: statusColor(props.project.status), padding: "2px 6px", "border-radius": "3px",
          background: "#f4f4f5", border: `1px solid ${T.border}`,
        }}>
          {statusLabel(props.project.status)}
        </span>
        <Show when={props.project.clone_status && props.project.clone_status !== "none"}>
          <span
            title={props.project.clone_status === "failed" && props.project.clone_error ? props.project.clone_error : undefined}
            style={{
              "font-family": "'Geist Mono', monospace", "font-size": "9px", "font-weight": "600",
              "letter-spacing": "0.1em", "text-transform": "uppercase",
              color: props.project.clone_status === "done" ? "#22c55e"
                : props.project.clone_status === "failed" ? "#ef4444"
                : T.amber,
              padding: "2px 6px", "border-radius": "3px",
              background: props.project.clone_status === "done" ? "rgba(34,197,94,0.08)"
                : props.project.clone_status === "failed" ? "rgba(239,68,68,0.08)"
                : T.amberBg,
              border: `1px solid ${props.project.clone_status === "done" ? "rgba(34,197,94,0.3)"
                : props.project.clone_status === "failed" ? "rgba(239,68,68,0.3)"
                : T.amberBorder}`,
              cursor: props.project.clone_status === "failed" ? "help" : "default",
            }}>
            {props.project.clone_status === "done" ? "INDEXED"
              : props.project.clone_status === "failed" ? "FAILED ⓘ"
              : props.project.clone_status === "cloning" ? "CLONING"
              : "INDEXING"}
          </span>
        </Show>
        <Show when={githubRepo()}>
          <span style={{
            "font-family": "'Geist Mono', monospace", "font-size": "11px", color: T.textFaint,
            overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap",
          }}>
            {githubRepo()!.replace("https://github.com/", "")}
          </span>
        </Show>
      </div>

      {/* Row 2: project name */}
      <div style={{
        "font-size": "17px", "font-weight": "500", color: T.text,
        "line-height": "1.3", "margin-bottom": "10px",
      }}>
        {props.project.name}
      </div>

      {/* Row 3: meta left | action right */}
      <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "8px" }}>
        <span style={{
          "font-family": "'Geist Mono', monospace", "font-size": "11px", color: T.textFaint,
        }}>
          {props.project.clone_status === "cloning" || props.project.clone_status === "indexing"
            ? `${props.project.clone_status === "cloning" ? "Cloning" : "Indexing"}…`
            : props.project.clone_status === "done"
            ? `${props.project.resource_count ?? 0} components · cloned`
            : props.project.clone_status === "failed"
            ? props.project.clone_error
              ? `Error: ${props.project.clone_error.slice(0, 80)}${props.project.clone_error.length > 80 ? "…" : ""}`
              : "Clone failed"
            : `${props.project.resource_count ?? 0} resources · added ${timeAgo(props.project.time_created)}`
          }
        </span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); props.onOpen() }}
          style={{
            padding: "4px 10px", "border-radius": "4px",
            border: `1px solid ${T.amberBorder}`, background: T.amberBg,
            "font-family": "'Geist Mono', monospace", "font-size": "10px",
            "font-weight": "600", "letter-spacing": "0.05em",
            color: T.amber, cursor: "pointer", transition: "all 120ms",
            "flex-shrink": "0",
          }}
          onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(214,138,46,0.2)"; el.style.borderColor = "rgba(214,138,46,0.6)" }}
          onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = T.amberBg; el.style.borderColor = T.amberBorder }}
        >
          view graph →
        </button>
      </div>
    </div>
  )
}

export function GraphProjectsPanel() {
  const [showNewModal, setShowNewModal] = createSignal(false)
  const [projects, { refetch }] = createResource(() => elApi.listProjects())

  return (
    <div style={{ height: "100%", display: "flex", "flex-direction": "column", background: T.bg, overflow: "hidden" }}>

      {/* Header */}
      <div style={{
        "flex-shrink": "0",
        display: "flex", "align-items": "center", "justify-content": "space-between",
        padding: "12px 20px 10px",
        "border-bottom": `1px solid ${T.border}`,
        background: T.bg,
      }}>
        <span style={{
          "font-family": "'Geist Mono', monospace", "font-size": "10px", "font-weight": "600",
          "letter-spacing": "0.1em", "text-transform": "uppercase", color: T.textFaint,
        }}>
          Projects · {(projects() ?? []).length} graphs
        </span>

        <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
          {/* + New Project */}
          <button
            type="button"
            onClick={() => setShowNewModal(true)}
            style={{
              display: "inline-flex", "align-items": "center", gap: "5px",
              padding: "4px 10px", "border-radius": "4px",
              "font-family": "'Geist Mono', monospace", "font-size": "10px",
              "font-weight": "600", "letter-spacing": "0.04em",
              color: T.amber, border: `1px solid ${T.amberBorder}`,
              background: T.amberBg, cursor: "pointer", transition: "all 120ms",
            }}
            onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = "rgba(214,138,46,0.2)" }}
            onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = T.amberBg }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New Project
          </button>

          {/* Refresh */}
          <button
            type="button"
            title="Refresh"
            onClick={() => void refetch()}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: T.textFaint, display: "flex", "align-items": "center",
              padding: "4px", transition: "color 120ms",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = T.textMuted }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = T.textFaint }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
          </button>
        </div>
      </div>

      {/* List */}
      <div style={{ flex: "1", "overflow-y": "auto" }}>
        <Show when={projects.loading}>
          <div style={{
            display: "flex", "align-items": "center", "justify-content": "center",
            "padding-top": "60px", color: T.textFaint, "font-size": "13px",
          }}>
            Loading…
          </div>
        </Show>

        <Show when={!projects.loading && (projects() ?? []).length === 0}>
          <div style={{
            display: "flex", "flex-direction": "column", "align-items": "center",
            "justify-content": "center", "padding-top": "60px", gap: "8px",
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={T.border} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/>
              <circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>
              <line x1="10" y1="10" x2="7" y2="7"/><line x1="14" y1="10" x2="17" y2="7"/>
              <line x1="10" y1="14" x2="7" y2="17"/><line x1="14" y1="14" x2="17" y2="17"/>
            </svg>
            <span style={{ "font-size": "13px", color: T.textMuted }}>No projects yet</span>
            <span style={{ "font-size": "12px", color: T.textFaint }}>Create a project to start building a graph</span>
          </div>
        </Show>

        <Show when={(projects() ?? []).length > 0}>
          <For each={projects()}>
            {(project) => (
              <ProjectRow
                project={project}
                onOpen={() => { setActiveGraphProjectId(project.id); setActiveGraphProjectName(project.name) }}
              />
            )}
          </For>
        </Show>
      </div>

      <Show when={showNewModal()}>
        <NewProjectModal
          onClose={() => setShowNewModal(false)}
          onCreated={() => {
            setShowNewModal(false)
            void refetch()
          }}
        />
      </Show>
    </div>
  )
}
