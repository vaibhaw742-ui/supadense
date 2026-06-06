import { createResource, createSignal, For, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { getAuthToken, clearAuthToken } from "@/utils/server"
import { elApi, type ElProject } from "./el-api"
import { CreateProjectDialog } from "./create-project-dialog"

function timeAgo(ms: number): string {
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export default function ProjectsPanel() {
  const navigate = useNavigate()
  const dialog = useDialog()
  const [showCreate, setShowCreate] = createSignal(false)

  const [projects, { refetch }] = createResource(async () => elApi.listProjects())

  const userEmail = (() => {
    const token = getAuthToken()
    if (!token) return undefined
    try {
      const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")))
      return typeof payload.email === "string" ? payload.email : undefined
    } catch { return undefined }
  })()

  function openSettings() {
    void import("@/components/dialog-settings").then((x) => {
      dialog.show(() => <x.DialogSettings />)
    })
  }

  async function handleCreated(project: ElProject) {
    setShowCreate(false)
    void refetch()
    // Auto-start clone if a GitHub URL was provided
    const githubUrl = (project.context_json as any)?.github_url
    if (githubUrl && project.clone_status === "none") {
      await elApi.cloneRepo(project.id).catch(() => {})
    }
    navigate(`/projects/${project.id}`)
  }

  return (
    <div class="size-full flex flex-col overflow-y-auto" style={{ background: "#ffffff" }}>

      {/* Projects header row */}
      <div style={{
        "flex-shrink": "0",
        display: "flex", "align-items": "center", "justify-content": "space-between",
        padding: "20px 32px 16px",
      }}>
        <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "11px", "letter-spacing": "0.06em", color: "#a3a3a3" }}>
          PROJECTS
          <Show when={!projects.loading && (projects()?.length ?? 0) > 0}>
            {" · "}{projects()!.length} GRAPHS
          </Show>
        </span>
        <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
          <button
            type="button"
            onClick={() => void refetch()}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#a3a3a3", display: "flex", "align-items": "center", padding: "4px", "border-radius": "4px", transition: "color 120ms" }}
            title="Refresh"
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#525252" }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "#a3a3a3" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/>
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            style={{
              display: "inline-flex", "align-items": "center", gap: "6px",
              padding: "6px 14px",
              border: "1px solid #d68a2e",
              "border-radius": "6px",
              background: "transparent",
              "font-family": "'Geist Mono', monospace", "font-size": "11px", "font-weight": "600",
              "letter-spacing": "0.04em", color: "#d68a2e",
              cursor: "pointer", transition: "background 120ms",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(214,138,46,0.08)" }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent" }}
          >
            + New Project
          </button>
        </div>
      </div>

      {/* Project list */}
      <div style={{ flex: "1", padding: "0 32px 32px" }}>
        {/* Loading skeletons */}
        <Show when={projects.loading}>
          <For each={[1, 2, 3]}>
            {() => (
              <div style={{ padding: "20px 0", "border-bottom": "1px solid #f0f0f0" }}>
                <div style={{ width: "120px", height: "20px", "border-radius": "4px", background: "#f0f0f0", "margin-bottom": "8px" }} />
                <div style={{ width: "200px", height: "28px", "border-radius": "4px", background: "#f5f5f5" }} />
              </div>
            )}
          </For>
        </Show>

        {/* Empty state */}
        <Show when={!projects.loading && (projects()?.length ?? 0) === 0}>
          <div style={{ padding: "64px 0", display: "flex", "flex-direction": "column", "align-items": "center", gap: "12px" }}>
            <div style={{ "font-family": "'Geist Mono', monospace", "font-size": "13px", color: "#a3a3a3" }}>
              no projects yet
            </div>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              style={{
                padding: "8px 20px", "border-radius": "6px",
                background: "#d68a2e", border: "none", cursor: "pointer",
                "font-family": "'Geist Mono', monospace", "font-size": "12px",
                "font-weight": "600", color: "#ffffff",
              }}
            >
              Create your first project
            </button>
          </div>
        </Show>

        {/* Project rows */}
        <Show when={!projects.loading}>
          <For each={projects() ?? []}>
            {(project) => <ProjectRow project={project} onDelete={() => void refetch()} onOpen={(id) => navigate(`/projects/${id}`)} />}
          </For>
        </Show>
      </div>

      {/* Create dialog */}
      <Show when={showCreate()}>
        <CreateProjectDialog onCreated={handleCreated} onClose={() => setShowCreate(false)} />
      </Show>
    </div>
  )
}

function ProjectRow(props: { project: ElProject; onDelete: () => void; onOpen: (id: string) => void }) {
  const [confirmDelete, setConfirmDelete] = createSignal(false)
  const [deleting, setDeleting] = createSignal(false)

  const handleDelete = async (e: MouseEvent) => {
    e.stopPropagation()
    if (!confirmDelete()) { setConfirmDelete(true); return }
    setDeleting(true)
    try {
      await elApi.deleteProject(props.project.id)
      props.onDelete()
    } catch { setDeleting(false) }
  }

  const statusColor: Record<string, string> = { onboarding: "#d68a2e", active: "#16a34a", paused: "#94a3b8" }
  const sc = () => statusColor[props.project.status] ?? "#a3a3a3"

  return (
    <div
      style={{
        padding: "20px 0",
        "border-bottom": "1px solid #f0f0f0",
        display: "flex", "align-items": "center", "justify-content": "space-between",
        gap: "16px",
      }}
    >
      {/* Left: tags + name + meta */}
      <div style={{ flex: "1", "min-width": "0", cursor: "pointer" }} onClick={() => props.onOpen(props.project.id)}>
        {/* Tag chips */}
        <div style={{ display: "flex", gap: "6px", "margin-bottom": "6px" }}>
          <span style={{
            "font-family": "'Geist Mono', monospace", "font-size": "10px", "font-weight": "600",
            "letter-spacing": "0.06em", color: "#d68a2e",
            border: "1px solid #d68a2e", "border-radius": "4px",
            padding: "1px 7px",
          }}>
            PROJECT
          </span>
          <span style={{
            "font-family": "'Geist Mono', monospace", "font-size": "10px", "font-weight": "600",
            "letter-spacing": "0.06em", color: sc(),
            border: `1px solid ${sc()}`,
            "border-radius": "4px", padding: "1px 7px",
            "text-transform": "uppercase",
          }}>
            {props.project.status}
          </span>
          <Show when={props.project.clone_status && props.project.clone_status !== "none"}>
            <span style={{
              "font-family": "'Geist Mono', monospace", "font-size": "10px", "font-weight": "600",
              "letter-spacing": "0.06em",
              color: props.project.clone_status === "done" ? "#16a34a" : props.project.clone_status === "failed" ? "#dc2626" : "#f97316",
              border: `1px solid ${props.project.clone_status === "done" ? "#16a34a" : props.project.clone_status === "failed" ? "#dc2626" : "#f97316"}`,
              "border-radius": "4px", padding: "1px 7px",
              "text-transform": "uppercase",
            }}>
              {props.project.clone_status}
            </span>
          </Show>
        </div>

        {/* Project name */}
        <div style={{ "font-size": "22px", "font-weight": "600", color: "#0a0a0a", "line-height": "1.2", "margin-bottom": "5px" }}>
          {props.project.name}
        </div>

        {/* Meta */}
        <div style={{ "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#a3a3a3" }}>
          {props.project.resource_count ?? 0} {props.project.resource_count === 1 ? "resource" : "resources"}
          {" · "}added {timeAgo(props.project.time_created)}
        </div>
      </div>

      {/* Right: delete + view graph */}
      <div style={{ display: "flex", "align-items": "center", gap: "8px", "flex-shrink": "0" }}>
        {/* Delete button */}
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting()}
          title={confirmDelete() ? "Click again to confirm" : "Delete project"}
          style={{
            display: "inline-flex", "align-items": "center", gap: "5px",
            padding: confirmDelete() ? "5px 10px" : "6px 8px",
            border: confirmDelete() ? "1px solid #dc2626" : "1px solid #e5e5e5",
            "border-radius": "6px",
            background: confirmDelete() ? "rgba(220,38,38,0.06)" : "transparent",
            cursor: deleting() ? "not-allowed" : "pointer",
            color: confirmDelete() ? "#dc2626" : "#a3a3a3",
            "font-family": "'Geist Mono', monospace", "font-size": "11px",
            transition: "all 120ms",
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget as HTMLElement
            if (!confirmDelete()) { el.style.borderColor = "#dc2626"; el.style.color = "#dc2626" }
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget as HTMLElement
            if (!confirmDelete()) { el.style.borderColor = "#e5e5e5"; el.style.color = "#a3a3a3" }
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
          <Show when={confirmDelete()}>
            <span>{deleting() ? "Deleting…" : "Confirm?"}</span>
          </Show>
        </button>

        {/* View graph button */}
        <button
          type="button"
          onClick={() => props.onOpen(props.project.id)}
          style={{
            display: "inline-flex", "align-items": "center", gap: "5px",
            padding: "6px 14px",
            border: "1px solid #d68a2e",
            "border-radius": "6px",
            background: "transparent",
            "font-family": "'Geist Mono', monospace", "font-size": "11px", "font-weight": "600",
            "letter-spacing": "0.04em", color: "#d68a2e",
            cursor: "pointer", transition: "background 120ms",
            "white-space": "nowrap",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(214,138,46,0.08)" }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent" }}
        >
          view graph →
        </button>
      </div>
    </div>
  )
}
