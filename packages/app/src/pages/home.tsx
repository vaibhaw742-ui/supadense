import { createSignal, For, onMount, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { useLayout } from "@/context/layout"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/util/encode"
import { usePlatform } from "@/context/platform"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { useServer } from "@/context/server"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { getAuthToken, getBackendUrl } from "@/utils/server"

export default function Home() {
  const sync = useGlobalSync()
  const layout = useLayout()
  const platform = usePlatform()
  const dialog = useDialog()
  const navigate = useNavigate()
  const server = useServer()
  const language = useLanguage()

  // Auto-redirect authenticated users to their default workspace
  onMount(async () => {
    const token = getAuthToken()
    if (!token) return
    try {
      const res = await fetch(`${getBackendUrl()}/supa-auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const { userId } = (await res.json()) as { userId?: string }
      if (!userId) return
      const defaultDir = `/workspaces/${userId}/default`
      server.projects.touch(defaultDir)
      navigate(`/${base64Encode(defaultDir)}/session`)
    } catch {}
  })

  // KB creation state — lives directly in Home so signals are always reactive
  const [kbOpen, setKbOpen] = createSignal(false)
  const [kbName, setKbName] = createSignal("")
  const [kbError, setKbError] = createSignal("")
  const [kbLoading, setKbLoading] = createSignal(false)
  const [kbCreatedDir, setKbCreatedDir] = createSignal("")

  function openKbDialog() {
    setKbName("")
    setKbError("")
    setKbLoading(false)
    setKbCreatedDir("")
    setKbOpen(true)
  }

  function closeKbDialog() {
    setKbOpen(false)
  }

  async function handleKbCreate() {
    const trimmed = kbName().trim()
    if (!trimmed) return
    setKbError("")
    setKbLoading(true)
    const token = getAuthToken()
    try {
      const base = import.meta.env.DEV
        ? `http://${import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:${import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`
        : `${location.origin}/api`
      const res = await fetch(`${base}/kb/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        setKbError(err.error ?? "Failed to create KB")
        return
      }
      const { directory } = (await res.json()) as { directory: string }
      setKbCreatedDir(directory)
    } catch {
      setKbError("Failed to create KB — check connection")
    } finally {
      setKbLoading(false)
    }
  }

  function handleKbSetup() {
    const dir = kbCreatedDir()
    if (!dir) return
    closeKbDialog()
    layout.projects.open(dir)
    server.projects.touch(dir)
    navigate(
      `/${base64Encode(dir)}/session?prompt=${encodeURIComponent("Setup my knowledge base")}&send=1`,
    )
  }

  function openProject(directory: string) {
    layout.projects.open(directory)
    server.projects.touch(directory)
    navigate(`/${base64Encode(directory)}/session`)
  }

  async function chooseProject() {
    function resolve(result: string | string[] | null) {
      if (Array.isArray(result)) {
        for (const directory of result) {
          openProject(directory)
        }
      } else if (result) {
        openProject(result)
      }
    }

    if (platform.openDirectoryPickerDialog && server.isLocal()) {
      const result = await platform.openDirectoryPickerDialog?.({
        title: language.t("command.project.open"),
        multiple: true,
      })
      resolve(result)
    } else {
      dialog.show(
        () => <DialogSelectDirectory multiple={true} onSelect={resolve} />,
        () => resolve(null),
      )
    }
  }

  const [filterTab, setFilterTab] = createSignal<"all" | "synced">("all")

  const workspaceColor = (name: string) => {
    const colors = [
      "#8b9e7a", "#7a9e8b", "#9e8b7a", "#7a8b9e", "#9e7a8b",
      "#6b8f6b", "#8f6b6b", "#6b6b8f", "#8f8f6b", "#6b8f8f",
    ]
    let hash = 0
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
    return colors[Math.abs(hash) % colors.length]
  }

  const workspaceName = (worktree: string) =>
    worktree.replace(/^\/workspaces\/[^/]+\//, "").split("/").pop() ?? worktree.split("/").pop() ?? worktree

  return (
    <div class="size-full flex flex-col bg-background-base overflow-y-auto">
      {/* Header */}
      <div class="flex items-center justify-between px-8 pt-8 pb-4">
        <div>
          <div class="text-13-regular text-text-weak">All Workspaces</div>
          <div class="text-24-medium text-text-strong mt-0.5">Knowledge Bases</div>
        </div>
        <Button icon="folder-add-left" size="normal" class="pl-2 pr-3" onClick={openKbDialog}>
          Create Workspace
        </Button>
      </div>

      {/* Filter tabs */}
      <div class="flex items-center gap-1 px-8 pb-6 border-b border-border-weak-base">
        <button
          type="button"
          class="px-3 py-1 rounded-md text-13-medium transition-colors"
          classList={{
            "bg-surface-base-active text-text-strong": filterTab() === "all",
            "text-text-weak hover:text-text-base": filterTab() !== "all",
          }}
          onClick={() => setFilterTab("all")}
        >
          All
        </button>
        <button
          type="button"
          class="px-3 py-1 rounded-md text-13-medium transition-colors"
          classList={{
            "bg-surface-base-active text-text-strong": filterTab() === "synced",
            "text-text-weak hover:text-text-base": filterTab() !== "synced",
          }}
          onClick={() => setFilterTab("synced")}
        >
          Synced
        </button>
      </div>

      {/* Workspace grid */}
      <div class="px-8 py-6">
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {/* Create new */}
          <button
            type="button"
            class="aspect-square rounded-xl border-2 border-dashed border-border-base flex flex-col items-center justify-center gap-2 text-text-weak hover:text-text-base hover:border-border-stronger transition-colors"
            onClick={openKbDialog}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            <span class="text-12-regular">Create Workspace</span>
          </button>

          <For each={sync.data.project}>
            {(project) => {
              const name = workspaceName(project.worktree)
              const color = workspaceColor(name)
              return (
                <button
                  type="button"
                  class="aspect-square rounded-xl flex flex-col justify-end p-3 text-left hover:opacity-90 active:scale-[0.98] transition-all shadow-sm"
                  style={{ background: color }}
                  onClick={() => openProject(project.worktree)}
                >
                  <div class="text-14-medium text-white truncate">{name}</div>
                  <div class="text-12-regular mt-0.5" style={{ color: "rgba(255,255,255,0.7)" }}>
                    knowledge base
                  </div>
                </button>
              )
            }}
          </For>
        </div>

        <Show when={sync.data.project.length === 0 && sync.ready}>
          <div class="mt-16 flex flex-col items-center gap-3 text-center">
            <div class="text-14-medium text-text-strong">No workspaces yet</div>
            <div class="text-13-regular text-text-weak">Create your first Knowledge Base to get started</div>
          </div>
        </Show>
      </div>

      {/* KB creation modal — rendered inline so signals are always reactive */}
      <Show when={kbOpen()}>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center"
          onClick={(e) => { if (e.target === e.currentTarget) closeKbDialog() }}
        >
          <div class="rounded-xl shadow-lg bg-[var(--surface-raised-stronger-non-alpha)] border border-[var(--border-weak-base)] w-full max-w-sm mx-4">
            <div class="flex items-center justify-between px-5 py-4 border-b border-[var(--border-weak-base)]">
              <span class="text-16-medium text-text-strong">
                {kbCreatedDir() ? "Knowledge Base Created" : "New KB"}
              </span>
              <button
                type="button"
                class="text-text-weak hover:text-text-strong transition-colors text-lg leading-none"
                onClick={closeKbDialog}
              >
                ✕
              </button>
            </div>

            <Show
              when={kbCreatedDir()}
              fallback={
                <div class="flex flex-col gap-4 px-6 py-4">
                  <input
                    autofocus
                    class="w-full rounded-lg border border-border-base bg-background-input px-3 py-2 text-14-regular text-text-strong outline-none focus:border-border-focus placeholder:text-text-weak"
                    classList={{ "border-red-500 focus:border-red-500": !!kbError() }}
                    placeholder="e.g. Machine Learning"
                    onInput={(e) => { setKbName(e.currentTarget.value); setKbError("") }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleKbCreate()
                      if (e.key === "Escape") closeKbDialog()
                    }}
                  />
                  <Show when={kbError()}>
                    <div class="text-12-regular text-red-500">{kbError()}</div>
                  </Show>
                  <div class="flex justify-end gap-2">
                    <Button variant="ghost" size="large" onClick={closeKbDialog}>
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      size="large"
                      disabled={kbLoading()}
                      onClick={handleKbCreate}
                    >
                      {kbLoading() ? "Creating…" : "Create"}
                    </Button>
                  </div>
                </div>
              }
            >
              <div class="flex flex-col gap-5 px-6 py-4">
                <div class="flex flex-col gap-1.5">
                  <div class="text-14-regular text-text-strong">Your Knowledge Base is ready.</div>
                  <div class="text-12-regular text-text-weak">
                    Click below to start the setup conversation.
                  </div>
                </div>
                <div class="flex justify-end">
                  <Button variant="primary" size="large" onClick={handleKbSetup}>
                    Setup My Knowledge Base
                  </Button>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  )
}
