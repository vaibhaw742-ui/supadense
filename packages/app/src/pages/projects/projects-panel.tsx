import { createResource, createSignal, For, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { getAuthToken, clearAuthToken } from "@/utils/server"
import { elApi, type ElProject } from "./el-api"
import { CreateProjectDialog } from "./create-project-dialog"

const STATUS_COLOR: Record<string, string> = {
  onboarding: "#f59e0b",
  active: "#22c55e",
  paused: "#94a3b8",
}

const STATUS_BG: Record<string, string> = {
  onboarding: "rgba(245,158,11,0.15)",
  active: "rgba(34,197,94,0.15)",
  paused: "rgba(148,163,184,0.15)",
}

const PROJECT_COLORS = [
  "#7c3aed", "#1d4ed8", "#0891b2", "#047857",
  "#b45309", "#9333ea", "#be185d", "#dc2626",
]

function projectColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
  return PROJECT_COLORS[Math.abs(hash) % PROJECT_COLORS.length]
}

export default function ProjectsPanel() {
  const navigate = useNavigate()
  const dialog = useDialog()
  const [showCreate, setShowCreate] = createSignal(false)

  const [projects, { refetch }] = createResource(async () => {
    return elApi.listProjects()
  })

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

  function handleCreated(project: ElProject) {
    setShowCreate(false)
    void refetch()
    navigate(`/projects/${project.id}`)
  }

  return (
    <div class="size-full flex flex-col bg-background-base overflow-y-auto">
      {/* Header */}
      <div class="flex items-center justify-between px-8 pt-4 pb-4">
        <div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="text-14-regular text-text-weak hover:text-text-base transition-colors"
              onClick={() => navigate("/workspaces")}
            >
              ← Workspaces
            </button>
          </div>
          <div class="text-28-medium text-text-strong mt-0.5 leading-tight">Experiential Learning</div>
        </div>
        <div class="flex items-center gap-1">
          <Tooltip placement="bottom" value="Settings">
            <IconButton icon="settings-gear" variant="ghost" size="large" onClick={openSettings} aria-label="Settings" />
          </Tooltip>
          <Show when={getAuthToken()}>
            <Tooltip placement="bottom" value={userEmail ?? "Account"}>
              <IconButton
                icon="person"
                variant="ghost"
                size="large"
                aria-label="Account"
                onClick={() => { clearAuthToken(); location.href = "/signin" }}
              />
            </Tooltip>
          </Show>
        </div>
      </div>

      {/* Grid */}
      <div class="px-8 pb-6">
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {/* Create new card */}
          <button
            type="button"
            class="aspect-square rounded-xl border-2 border-dashed border-border-base flex flex-col items-center justify-center gap-2 text-text-weak hover:text-text-base hover:border-border-stronger transition-colors"
            onClick={() => setShowCreate(true)}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span class="text-12-regular">New Project</span>
          </button>

          <Show when={!projects.loading} fallback={
            <For each={[1, 2, 3]}>
              {() => (
                <div class="aspect-square rounded-xl animate-pulse" style={{ background: "var(--surface-base)" }} />
              )}
            </For>
          }>
            <For each={projects() ?? []}>
              {(project) => {
                const [hovered, setHovered] = createSignal(false)
                const color = () => projectColor(project.name)

                return (
                  <div
                    class="aspect-square rounded-xl flex flex-col relative overflow-visible cursor-pointer active:scale-[0.98] transition-all shadow-sm"
                    style={{ background: color() }}
                    onMouseEnter={() => setHovered(true)}
                    onMouseLeave={() => setHovered(false)}
                    onClick={() => navigate(`/projects/${project.id}`)}
                  >
                    {/* Status chip */}
                    <div class="absolute top-2 right-2">
                      <div
                        class="rounded-full px-2 py-0.5 text-10-medium"
                        style={{
                          background: STATUS_BG[project.status] ?? STATUS_BG.paused,
                          color: STATUS_COLOR[project.status] ?? STATUS_COLOR.paused,
                          "font-size": "10px",
                          "font-weight": "600",
                          "backdrop-filter": "blur(4px)",
                        }}
                      >
                        {project.status}
                      </div>
                    </div>

                    {/* Resource count badge */}
                    <Show when={hovered()}>
                      <div class="absolute top-2 left-2">
                        <div
                          class="rounded-full px-2 py-0.5"
                          style={{
                            background: "rgba(0,0,0,0.35)",
                            color: "rgba(255,255,255,0.9)",
                            "font-size": "10px",
                            "font-weight": "500",
                          }}
                        >
                          {project.resource_count ?? 0} {project.resource_count === 1 ? "resource" : "resources"}
                        </div>
                      </div>
                    </Show>

                    {/* Card label */}
                    <div class="absolute bottom-0 left-0 right-0 p-3">
                      <div class="text-14-medium text-white truncate">{project.name}</div>
                      <div class="text-12-regular mt-0.5" style={{ color: "rgba(255,255,255,0.65)" }}>
                        experiential learning
                      </div>
                    </div>
                  </div>
                )
              }}
            </For>
          </Show>
        </div>

        <Show when={!projects.loading && (projects()?.length ?? 0) === 0}>
          <div class="mt-16 flex flex-col items-center gap-3 text-center">
            <div style={{
              width: "48px", height: "48px", "border-radius": "12px",
              background: "var(--surface-base)",
              display: "flex", "align-items": "center", "justify-content": "center",
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-text-weak">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
            </div>
            <div class="text-14-medium text-text-strong">No projects yet</div>
            <div class="text-13-regular text-text-weak max-w-xs">
              Create a project and add a GitHub repo or paper to start your learning journey
            </div>
            <button
              type="button"
              class="mt-2 px-4 py-2 rounded-lg text-14-medium text-white transition-colors"
              style={{ background: "#f59e0b" }}
              onClick={() => setShowCreate(true)}
            >
              Create your first project
            </button>
          </div>
        </Show>
      </div>

      {/* Create project dialog */}
      <Show when={showCreate()}>
        <CreateProjectDialog
          onCreated={handleCreated}
          onClose={() => setShowCreate(false)}
        />
      </Show>
    </div>
  )
}
