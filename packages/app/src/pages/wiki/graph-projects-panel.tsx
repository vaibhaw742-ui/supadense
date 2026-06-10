import { createResource, createSignal, For, Show } from "solid-js"
import { elApi, type ElProject, type LocalProject } from "@/pages/projects/el-api"
import { setActiveGraphProjectId, setActiveGraphProjectName, setActiveSidebarView } from "@/context/sidebar-view"
import { base64Encode } from "@opencode-ai/util/encode"
import { useNavigate } from "@solidjs/router"

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

// ── EL Project Row ─────────────────────────────────────────────────────────────

function ElProjectRow(props: { project: ElProject; onOpen: () => void }) {
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
      <div style={{ display: "flex", "align-items": "center", gap: "6px", "margin-bottom": "8px", "flex-wrap": "wrap" }}>
        <span style={{
          "font-family": "'Geist Mono', monospace", "font-size": "9px", "font-weight": "600",
          "letter-spacing": "0.1em", "text-transform": "uppercase",
          color: T.amber, padding: "2px 6px", "border-radius": "3px",
          background: T.amberBg, border: `1px solid ${T.amberBorder}`,
        }}>
          PROJECT
        </span>
        <Show when={githubRepo()}>
          <span style={{
            "font-family": "'Geist Mono', monospace", "font-size": "11px", color: T.textFaint,
            overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap",
          }}>
            {githubRepo()}
          </span>
        </Show>
      </div>

      <div style={{
        "font-size": "17px", "font-weight": "500", color: T.text,
        "line-height": "1.3", "margin-bottom": "10px",
      }}>
        {props.project.name}
      </div>

      <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "8px" }}>
        <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "11px", color: T.textFaint }}>
          {props.project.resource_count ?? 0} resources · added {timeAgo(props.project.time_created)}
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

// ── Local Project Row ─────────────────────────────────────────────────────────

function LocalProjectRow(props: { project: LocalProject; onOpen: () => void }) {
  const [hov, setHov] = createSignal(false)
  const pathParts = () => {
    const parts = props.project.local_path.replace(/\\/g, "/").split("/").filter(Boolean)
    return parts.slice(-2).join("/")
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
      <div style={{ display: "flex", "align-items": "center", gap: "6px", "margin-bottom": "8px" }}>
        <span style={{
          "font-family": "'Geist Mono', monospace", "font-size": "9px", "font-weight": "600",
          "letter-spacing": "0.1em", "text-transform": "uppercase",
          color: T.amber, padding: "2px 6px", "border-radius": "3px",
          background: T.amberBg, border: `1px solid ${T.amberBorder}`,
        }}>
          LOCAL
        </span>
        <span style={{
          "font-family": "'Geist Mono', monospace", "font-size": "9px", "font-weight": "600",
          "letter-spacing": "0.1em", color: "#6366f1",
          padding: "2px 6px", "border-radius": "3px",
          background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.3)",
        }}>
          CLI
        </span>
        <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "11px", color: T.textFaint }}>
          ~/{pathParts()}
        </span>
      </div>

      <div style={{ "font-size": "17px", "font-weight": "500", color: T.text, "line-height": "1.3", "margin-bottom": "10px" }}>
        {props.project.name}
      </div>

      <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", gap: "8px" }}>
        <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "11px", color: T.textFaint }}>
          brain graph · added {timeAgo(props.project.time_created)}
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

// ── Main component ────────────────────────────────────────────────────────────

export function GraphProjectsPanel() {
  const navigate = useNavigate()
  const [localProjects, { refetch: refetchLocal }] = createResource(() => elApi.listLocalProjects())

  const totalCount = () => (localProjects() ?? []).length

  function refetch() { void refetchLocal() }

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
          Projects · {totalCount()} graphs
        </span>

        <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
          <button
            type="button"
            title="Refresh"
            onClick={refetch}
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
        <Show when={localProjects.loading}>
          <div style={{
            display: "flex", "align-items": "center", "justify-content": "center",
            "padding-top": "60px", color: T.textFaint, "font-size": "13px",
          }}>
            Loading…
          </div>
        </Show>

        <Show when={!localProjects.loading && totalCount() === 0}>
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
            <span style={{ "font-size": "12px", color: T.textFaint }}>Run <code>supadense init</code> in any folder</span>
          </div>
        </Show>

        {/* Local projects first */}
        <Show when={(localProjects() ?? []).length > 0}>
          <For each={localProjects()}>
            {(project) => (
              <LocalProjectRow
                project={project}
                onOpen={() => {
                  setActiveGraphProjectId(project.id)
                  setActiveGraphProjectName(project.name)
                  setActiveSidebarView({ section: "workspace", view: "lib", label: project.name })
                  navigate(`/${base64Encode(project.local_path)}/session`)
                }}
              />
            )}
          </For>
        </Show>

      </div>

    </div>
  )
}
