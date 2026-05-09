import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/util/encode"
import { useServer } from "@/context/server"
import { useGlobalSync } from "@/context/global-sync"
import { getAuthToken, clearAuthToken } from "@/utils/server"
import { BgProcessMonitor } from "@/components/bg-process-monitor"
import { KbNotificationBell } from "@/pages/session/kb-files-panel"

const COLOR_SWATCHES = [
  // Reds / dark reds
  "#6b1a1a", "#7d2020", "#8b2020", "#9b1c1c", "#a31c1c", "#b91c1c", "#c0392b",
  // Pinks / hot pinks
  "#9d174d", "#be185d", "#db2777", "#ec4899", "#f472b6", "#f9a8d4", "#e879a4",
  // Magentas / purples
  "#d946ef", "#c026d3", "#a21caf", "#7e22ce", "#6d28d9", "#ea00ff", "#cc00cc",
  // Salmon / coral
  "#e07070", "#e05555", "#e06060", "#e07878", "#e08888", "#d06060", "#c05050",
  // Peach / light pink
  "#f4a7a7", "#f7c4c4", "#f9d5d5", "#fce4e4", "#ffb3b3", "#ffc4c4", "#f8c8c8",
  // Brown / terracotta
  "#7c2d12", "#9a3412", "#c2410c", "#d97706", "#b45309", "#92400e", "#78350f",
  // Orange
  "#ea580c", "#f97316", "#fb923c", "#fdba74", "#f59e0b", "#fbbf24", "#fcd34d",
  // Cream / light yellow
  "#fef3c7", "#fef9c3", "#fefce8", "#fffde7", "#fff9c4", "#fefce4", "#fffacd",
  // Yellow / lime
  "#eab308", "#facc15", "#fde047", "#a3e635", "#84cc16", "#65a30d", "#4d7c0f",
  // Greens
  "#166534", "#15803d", "#16a34a", "#22c55e", "#4ade80", "#86efac", "#bbf7d0",
]

function getStoredColor(worktree: string): string | null {
  try { return localStorage.getItem(`ws-color:${worktree}`) } catch { return null }
}
function setStoredColor(worktree: string, color: string) {
  try { localStorage.setItem(`ws-color:${worktree}`, color) } catch {}
}
function clearStoredColor(worktree: string) {
  try { localStorage.removeItem(`ws-color:${worktree}`) } catch {}
}

export default function Home() {
  const sync = useGlobalSync()
  const navigate = useNavigate()
  const server = useServer()
  const dialog = useDialog()

  function openSettings() {
    void import("@/components/dialog-settings").then((x) => {
      dialog.show(() => <x.DialogSettings />)
    })
  }

  const userEmail = (() => {
    const token = getAuthToken()
    if (!token) return undefined
    try {
      const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")))
      return typeof payload.email === "string" ? payload.email : undefined
    } catch { return undefined }
  })()

  const handleLogout = getAuthToken()
    ? () => { clearAuthToken(); location.reload() }
    : undefined

  // KB creation state
  const [kbOpen, setKbOpen] = createSignal(false)
  const [kbName, setKbName] = createSignal("")
  const [kbError, setKbError] = createSignal("")
  const [kbLoading, setKbLoading] = createSignal(false)
  const [kbCreatedDir, setKbCreatedDir] = createSignal("")

  // Edit modal state
  const [editWorktree, setEditWorktree] = createSignal<string | null>(null)
  const [editName, setEditName] = createSignal("")
  const [editDesc, setEditDesc] = createSignal("")

  // Remove confirm state
  const [removeWorktree, setRemoveWorktree] = createSignal<string | null>(null)

  // Color picker state
  const [colorWorktree, setColorWorktree] = createSignal<string | null>(null)
  const [colorTab, setColorTab] = createSignal<"color" | "image" | "templates">("color")
  const [, forceUpdate] = createSignal(0)

  // Close color picker on outside click
  createEffect(() => {
    if (!colorWorktree()) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Element
      if (!target.closest("[data-color-picker]")) setColorWorktree(null)
    }
    document.addEventListener("mousedown", handler)
    onCleanup(() => document.removeEventListener("mousedown", handler))
  })

  function openKbDialog() {
    setKbName(""); setKbError(""); setKbLoading(false); setKbCreatedDir(""); setKbOpen(true)
  }
  function closeKbDialog() { setKbOpen(false) }

  async function handleKbCreate() {
    const trimmed = kbName().trim()
    if (!trimmed) return
    setKbError(""); setKbLoading(true)
    const token = getAuthToken()
    try {
      const base = import.meta.env.DEV
        ? `http://${import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:${import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`
        : `${location.origin}/api`
      const res = await fetch(`${base}/kb/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        setKbError(err.error ?? "Failed to create KB"); return
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
    server.projects.touch(dir)
    navigate(`/${base64Encode(dir)}/session?prompt=${encodeURIComponent("Setup my knowledge base")}&send=1`)
  }

  function openProject(directory: string) {
    server.projects.touch(directory)
    navigate(`/${base64Encode(directory)}/session`)
  }

  function openEditModal(worktree: string, e: MouseEvent) {
    e.stopPropagation()
    setEditWorktree(worktree)
    setEditName(workspaceName(worktree))
    setEditDesc("")
  }

  function saveEdit() {
    // Name editing is display-only (stored in localStorage)
    const wt = editWorktree()
    if (!wt) return
    const trimmed = editName().trim()
    if (trimmed) {
      try { localStorage.setItem(`ws-name:${wt}`, trimmed) } catch {}
    }
    setEditWorktree(null)
  }

  function openRemoveConfirm(worktree: string, e: MouseEvent) {
    e.stopPropagation()
    setRemoveWorktree(worktree)
  }

  function confirmRemove() {
    const wt = removeWorktree()
    if (!wt) return
    server.projects.close(wt)
    clearStoredColor(wt)
    try { localStorage.removeItem(`ws-name:${wt}`) } catch {}
    setRemoveWorktree(null)
  }

  function openColorPicker(worktree: string, e: MouseEvent) {
    e.stopPropagation()
    setColorWorktree(colorWorktree() === worktree ? null : worktree)
    setColorTab("color")
  }

  function applyColor(worktree: string, color: string) {
    setStoredColor(worktree, color)
    forceUpdate(n => n + 1)
    setColorWorktree(null)
  }

  const [filterTab, setFilterTab] = createSignal<"all" | "synced">("all")

  const defaultWorkspaceColor = (name: string) => {
    let hash = 0
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
    return COLOR_SWATCHES[Math.abs(hash) % COLOR_SWATCHES.length]
  }

  const workspaceColor = (worktree: string) => {
    return getStoredColor(worktree) ?? defaultWorkspaceColor(workspaceName(worktree))
  }

  function workspaceName(worktree: string): string {
    try {
      const stored = localStorage.getItem(`ws-name:${worktree}`)
      if (stored) return stored
    } catch {}
    return worktree.replace(/^\/workspaces\/[^/]+\//, "").split("/").pop() ?? worktree.split("/").pop() ?? worktree
  }

  return (
    <div class="size-full flex flex-col bg-background-base overflow-y-auto">
      {/* Header */}
      <div class="flex items-center justify-between px-8 pt-4 pb-4">
        <div class="flex items-end gap-4">
          <div>
            <div class="text-14-regular text-text-weak">Knowledge base</div>
            <div class="text-28-medium text-text-strong mt-0.5 leading-tight">All Workspaces</div>
          </div>
          <div class="flex items-center gap-1 pb-1">
            {(["all", "synced"] as const).map((tab) => (
              <button
                type="button"
                class="px-3 py-1 rounded-md text-13-medium transition-colors"
                classList={{
                  "bg-surface-base-active text-text-strong": filterTab() === tab,
                  "text-text-weak hover:text-text-base": filterTab() !== tab,
                }}
                onClick={() => setFilterTab(tab)}
              >
                {tab === "all" ? "All" : "Synced"}
              </button>
            ))}
          </div>
        </div>
        <div class="flex items-center gap-1">
          <BgProcessMonitor directory={() => undefined} />
          <KbNotificationBell directory={() => undefined} />
          <Tooltip placement="bottom" value="Settings">
            <IconButton
              icon="settings-gear"
              variant="ghost"
              size="large"
              onClick={openSettings}
              aria-label="Settings"
            />
          </Tooltip>
          <Tooltip placement="bottom" value="Help">
            <IconButton
              icon="help"
              variant="ghost"
              size="large"
              onClick={() => window.open("https://x.com/vaibhawkhemka6", "_blank")}
              aria-label="Help"
            />
          </Tooltip>
          <Show when={handleLogout} fallback={
            <Tooltip placement="bottom" value="Account">
              <IconButton icon="person" variant="ghost" size="large" aria-label="Account" />
            </Tooltip>
          }>
            <DropdownMenu placement="bottom-end">
              <Tooltip placement="bottom" value={userEmail ?? "Account"}>
                <DropdownMenu.Trigger as={IconButton} icon="person" variant="ghost" size="large" aria-label="Account" />
              </Tooltip>
              <DropdownMenu.Portal>
                <DropdownMenu.Content>
                  <Show when={userEmail}>
                    <div style={{ padding: "8px 12px 4px", "font-size": "12px", color: "var(--color-text-dimmed)", "max-width": "200px", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                      {userEmail}
                    </div>
                    <DropdownMenu.Separator />
                  </Show>
                  <DropdownMenu.Item onSelect={handleLogout}>Sign out</DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu>
          </Show>
        </div>
      </div>

      {/* Workspace grid */}
      <div class="px-8 pb-6">
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
              const [hovered, setHovered] = createSignal(false)
              const name = () => workspaceName(project.worktree)
              const color = () => workspaceColor(project.worktree)
              const isColorOpen = () => colorWorktree() === project.worktree

              return (
                <div
                  class="aspect-square rounded-xl flex flex-col relative overflow-visible cursor-pointer active:scale-[0.98] transition-all shadow-sm"
                  style={{ background: color() }}
                  onMouseEnter={() => setHovered(true)}
                  onMouseLeave={() => setHovered(false)}
                  onClick={() => openProject(project.worktree)}
                >
                  {/* Hover action bar */}
                  <Show when={hovered() || isColorOpen()}>
                    <div
                      class="absolute top-0 left-0 right-0 flex items-center justify-between px-2 pt-2 z-10"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Color picker trigger */}
                      <div class="relative" data-color-picker>
                        <button
                          type="button"
                          class="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
                          style={{ background: "rgba(0,0,0,0.25)" }}
                          title="Change color"
                          onClick={(e) => openColorPicker(project.worktree, e)}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10"/>
                            <circle cx="12" cy="10" r="3"/>
                            <path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662"/>
                          </svg>
                        </button>

                        {/* Color picker dropdown */}
                        <Show when={isColorOpen()}>
                          <div
                            class="absolute top-9 left-0 z-50 rounded-xl shadow-xl border w-72 overflow-hidden"
                            style={{ background: "var(--surface-raised-stronger-non-alpha)", "border-color": "var(--border-weak-base)" }}
                            data-color-picker
                          >
                            {/* Tabs */}
                            <div class="flex border-b" style={{ "border-color": "var(--border-weak-base)" }}>
                              {(["color", "image", "templates"] as const).map((t) => (
                                <button
                                  type="button"
                                  class="flex-1 py-2 text-12-medium transition-colors capitalize"
                                  classList={{
                                    "text-text-strong border-b-2 border-current": colorTab() === t,
                                    "text-text-weak hover:text-text-base": colorTab() !== t,
                                  }}
                                  onClick={() => setColorTab(t)}
                                >
                                  {t.charAt(0).toUpperCase() + t.slice(1)}
                                </button>
                              ))}
                            </div>

                            <Show when={colorTab() === "color"}>
                              <div class="p-3 max-h-64 overflow-y-auto">
                                <div class="grid grid-cols-7 gap-1.5">
                                  <For each={COLOR_SWATCHES}>
                                    {(swatch) => (
                                      <button
                                        type="button"
                                        class="w-7 h-7 rounded-md transition-transform hover:scale-110 active:scale-95 ring-offset-1"
                                        classList={{ "ring-2 ring-white": color() === swatch }}
                                        style={{ background: swatch }}
                                        onClick={() => applyColor(project.worktree, swatch)}
                                      />
                                    )}
                                  </For>
                                </div>
                              </div>
                            </Show>

                            <Show when={colorTab() === "image"}>
                              <div class="p-4 flex flex-col items-center gap-2">
                                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-text-weak">
                                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                                  <circle cx="8.5" cy="8.5" r="1.5"/>
                                  <path d="M21 15l-5-5L5 21"/>
                                </svg>
                                <span class="text-12-regular text-text-weak">Image upload coming soon</span>
                              </div>
                            </Show>

                            <Show when={colorTab() === "templates"}>
                              <div class="p-4 flex flex-col items-center gap-2">
                                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-text-weak">
                                  <rect x="3" y="3" width="7" height="7"/>
                                  <rect x="14" y="3" width="7" height="7"/>
                                  <rect x="3" y="14" width="7" height="7"/>
                                  <rect x="14" y="14" width="7" height="7"/>
                                </svg>
                                <span class="text-12-regular text-text-weak">Templates coming soon</span>
                              </div>
                            </Show>
                          </div>
                        </Show>
                      </div>

                      {/* Edit + Delete buttons */}
                      <div class="flex items-center gap-1">
                        <button
                          type="button"
                          class="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
                          style={{ background: "rgba(0,0,0,0.25)" }}
                          title="Edit workspace"
                          onClick={(e) => openEditModal(project.worktree, e)}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                          </svg>
                        </button>
                        <button
                          type="button"
                          class="w-7 h-7 rounded-md flex items-center justify-center transition-colors"
                          style={{ background: "rgba(0,0,0,0.25)" }}
                          title="Remove workspace"
                          onClick={(e) => openRemoveConfirm(project.worktree, e)}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                            <path d="M10 11v6M14 11v6"/>
                            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                  </Show>

                  {/* Card label */}
                  <div class="absolute bottom-0 left-0 right-0 p-3">
                    <div class="text-14-medium text-white truncate">{name()}</div>
                    <div class="text-12-regular mt-0.5" style={{ color: "rgba(255,255,255,0.7)" }}>
                      knowledge base
                    </div>
                  </div>
                </div>
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

      {/* KB creation modal */}
      <Show when={kbOpen()}>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center"
          onClick={(e) => { if (e.target === e.currentTarget) closeKbDialog() }}
        >
          <div class="rounded-xl shadow-lg border w-full max-w-sm mx-4" style={{ background: "var(--surface-raised-stronger-non-alpha)", "border-color": "var(--border-weak-base)" }}>
            <div class="flex items-center justify-between px-5 py-4 border-b" style={{ "border-color": "var(--border-weak-base)" }}>
              <span class="text-16-medium text-text-strong">
                {kbCreatedDir() ? "Knowledge Base Created" : "New KB"}
              </span>
              <button type="button" class="text-text-weak hover:text-text-strong transition-colors text-lg leading-none" onClick={closeKbDialog}>✕</button>
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
                    <Button variant="ghost" size="large" onClick={closeKbDialog}>Cancel</Button>
                    <Button variant="primary" size="large" disabled={kbLoading()} onClick={handleKbCreate}>
                      {kbLoading() ? "Creating…" : "Create"}
                    </Button>
                  </div>
                </div>
              }
            >
              <div class="flex flex-col gap-5 px-6 py-4">
                <div class="flex flex-col gap-1.5">
                  <div class="text-14-regular text-text-strong">Your Knowledge Base is ready.</div>
                  <div class="text-12-regular text-text-weak">Click below to start the setup conversation.</div>
                </div>
                <div class="flex justify-end">
                  <Button variant="primary" size="large" onClick={handleKbSetup}>Setup My Knowledge Base</Button>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </Show>

      {/* Edit workspace modal */}
      <Show when={editWorktree()}>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center"
          onClick={(e) => { if (e.target === e.currentTarget) setEditWorktree(null) }}
        >
          <div class="rounded-xl shadow-lg border w-full max-w-sm mx-4" style={{ background: "var(--surface-raised-stronger-non-alpha)", "border-color": "var(--border-weak-base)" }}>
            <div class="flex items-center justify-between px-5 py-4 border-b" style={{ "border-color": "var(--border-weak-base)" }}>
              <span class="text-16-medium text-text-strong">Edit Workspace</span>
              <button type="button" class="text-text-weak hover:text-text-strong transition-colors text-lg leading-none" onClick={() => setEditWorktree(null)}>✕</button>
            </div>
            <div class="flex flex-col gap-4 px-6 py-5">
              <div class="flex flex-col gap-1.5">
                <label class="text-12-medium text-text-weak">Name</label>
                <input
                  autofocus
                  class="w-full rounded-lg border border-border-base bg-background-input px-3 py-2 text-14-regular text-text-strong outline-none focus:border-border-focus"
                  value={editName()}
                  onInput={(e) => setEditName(e.currentTarget.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditWorktree(null) }}
                />
              </div>
              <div class="flex flex-col gap-1.5">
                <label class="text-12-medium text-text-weak">Description <span class="text-text-weak opacity-60">(optional)</span></label>
                <textarea
                  class="w-full rounded-lg border border-border-base bg-background-input px-3 py-2 text-14-regular text-text-strong outline-none focus:border-border-focus resize-none"
                  rows={2}
                  value={editDesc()}
                  onInput={(e) => setEditDesc(e.currentTarget.value)}
                />
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-12-medium text-text-weak">Location</span>
                <span class="text-12-regular text-text-weak font-mono truncate">{editWorktree()}</span>
              </div>
              <div class="flex justify-end gap-2 pt-1">
                <Button variant="ghost" size="large" onClick={() => setEditWorktree(null)}>Cancel</Button>
                <Button variant="primary" size="large" onClick={saveEdit}>Save</Button>
              </div>
            </div>
          </div>
        </div>
      </Show>

      {/* Remove workspace confirm */}
      <Show when={removeWorktree()}>
        {(wt) => (
          <div
            class="fixed inset-0 z-50 flex items-center justify-center"
            onClick={(e) => { if (e.target === e.currentTarget) setRemoveWorktree(null) }}
          >
            <div class="rounded-xl shadow-lg border w-full max-w-sm mx-4" style={{ background: "var(--surface-raised-stronger-non-alpha)", "border-color": "var(--border-weak-base)" }}>
              <div class="flex items-center justify-between px-5 py-4 border-b" style={{ "border-color": "var(--border-weak-base)" }}>
                <span class="text-16-medium text-text-strong">Remove Workspace</span>
                <button type="button" class="text-text-weak hover:text-text-strong transition-colors text-lg leading-none" onClick={() => setRemoveWorktree(null)}>✕</button>
              </div>
              <div class="flex flex-col gap-5 px-6 py-5">
                <div class="text-14-regular text-text-base">
                  Remove <span class="font-medium text-text-strong">"{workspaceName(wt())}"</span> from your list?{" "}
                  <span class="text-text-weak">The folder will remain on disk.</span>
                </div>
                <div class="flex justify-end gap-2">
                  <Button variant="ghost" size="large" onClick={() => setRemoveWorktree(null)}>Cancel</Button>
                  <button
                    type="button"
                    class="px-4 py-2 rounded-lg text-14-medium text-white bg-red-600 hover:bg-red-700 active:bg-red-800 transition-colors"
                    onClick={confirmRemove}
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}
