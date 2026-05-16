import { createEffect, createSignal, For, onCleanup, Show, untrack } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/util/encode"
import { useServer } from "@/context/server"
import { useGlobalSync } from "@/context/global-sync"
import { getAuthToken, clearAuthToken, getBackendUrl } from "@/utils/server"
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

  // Auto-redirect to first workspace session once data loads
  createEffect(() => {
    if (!sync.ready) return
    const first = sync.data.project[0]
    if (!first) return
    untrack(() => {
      server.projects.touch(first.worktree)
      navigate(`/${base64Encode(first.worktree)}/session`, { replace: true })
    })
  })

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
    ? () => { clearAuthToken(); location.href = '/signin' }
    : undefined

  // KB creation state
  const [kbOpen, setKbOpen] = createSignal(false)
  const [kbName, setKbName] = createSignal("")
  const [kbError, setKbError] = createSignal("")
  const [kbLoading, setKbLoading] = createSignal(false)

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
    setKbName(""); setKbError(""); setKbLoading(false); setKbOpen(true)
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
      closeKbDialog()
      openProject(directory)
    } catch {
      setKbError("Failed to create KB — check connection")
    } finally {
      setKbLoading(false)
    }
  }

  function openProject(directory: string) {
    server.projects.touch(directory)
    navigate(`/${base64Encode(directory)}/session`)
  }

  function openEditModal(worktree: string, e: MouseEvent) {
    e.stopPropagation()
    const project = sync.data.project.find((p) => p.worktree === worktree)
    if (!project) return
    void import("@/components/dialog-edit-project").then((x) => {
      dialog.show(() => <x.DialogEditProject project={{ ...project, expanded: false }} />)
    })
  }

  function openRemoveConfirm(worktree: string, e: MouseEvent) {
    e.stopPropagation()
    setRemoveWorktree(worktree)
  }

  async function confirmRemove() {
    const wt = removeWorktree()
    if (!wt) return
    const project = sync.data.project.find((p) => p.worktree === wt)
    server.projects.close(wt)
    clearStoredColor(wt)
    try { localStorage.removeItem(`ws-name:${wt}`) } catch {}
    setRemoveWorktree(null)
    if (!project?.id || project.id === "global") return
    const base = import.meta.env.DEV
      ? `http://${import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:${import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`
      : `${location.origin}/api`
    const token = getAuthToken()
    await fetch(
      `${base}/project/${encodeURIComponent(project.id)}?directory=${encodeURIComponent(wt)}`,
      { method: "DELETE", headers: token ? { Authorization: `Bearer ${token}` } : {} },
    )
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

  // Chat state
  const [chatInput, setChatInput] = createSignal("")
  const [chatMessages, setChatMessages] = createSignal<{ role: "user" | "assistant"; text: string }[]>([])
  const [chatLoading, setChatLoading] = createSignal(false)
  const [selectedWorktree, setSelectedWorktree] = createSignal<string | null>(null)
  const [wsDropdownOpen, setWsDropdownOpen] = createSignal(false)

  const activeWorktree = () => selectedWorktree() ?? sync.data.project[0]?.worktree ?? null

  async function sendChat() {
    const text = chatInput().trim()
    if (!text || chatLoading()) return
    setChatInput("")
    setChatMessages((prev) => [...prev, { role: "user", text }])
    setChatLoading(true)
    try {
      const base = getBackendUrl()
      const token = getAuthToken()
      const wt = activeWorktree()
      const res = await fetch(`${base}/session/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ text, worktree: wt }),
      })
      if (res.ok) {
        const data = (await res.json()) as { reply?: string }
        if (data.reply) setChatMessages((prev) => [...prev, { role: "assistant", text: data.reply! }])
      }
    } catch {
      // silently ignore
    } finally {
      setChatLoading(false)
    }
  }

  return (
    <div class="size-full flex flex-col bg-background-base overflow-hidden">
      {/* Top header bar */}
      <div class="flex items-center justify-between px-4 py-2 border-b border-border-base flex-shrink-0">
        {/* Left: title */}
        <div class="text-14-medium text-text-strong">Home</div>

        {/* Right: workspace dropdown + TOC icon + other actions */}
        <div class="flex items-center gap-1">
          <BgProcessMonitor directory={() => undefined} />
          <KbNotificationBell directory={() => undefined} />

          <Tooltip placement="bottom" value="Settings">
            <IconButton icon="settings-gear" variant="ghost" size="large" onClick={openSettings} aria-label="Settings" />
          </Tooltip>
          <Tooltip placement="bottom" value="Help">
            <IconButton icon="help" variant="ghost" size="large" onClick={() => window.open("https://x.com/vaibhawkhemka6", "_blank")} aria-label="Help" />
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

      {/* Main body: left TOC + center + right chat */}
      <div class="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Left sidebar: workspace TOC ── */}
        <div class="flex flex-col w-64 flex-shrink-0 border-r border-border-base overflow-hidden">
          {/* TOC list of all workspaces */}
          <div class="flex-1 overflow-y-auto px-2 pb-4 pt-3">
            <div class="text-11-medium text-text-weak uppercase tracking-wider px-2 mb-1">All workspaces</div>
            <For each={sync.data.project} fallback={
              <div class="px-2 py-3 text-12-regular text-text-weak">No workspaces yet</div>
            }>
              {(project) => {
                const [hovered, setHovered] = createSignal(false)
                const name = () => workspaceName(project.worktree)
                const color = () => workspaceColor(project.worktree)
                const isActive = () => activeWorktree() === project.worktree
                return (
                  <div
                    class="group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors"
                    classList={{
                      "bg-background-hover": isActive(),
                      "hover:bg-background-hover": !isActive(),
                    }}
                    onMouseEnter={() => setHovered(true)}
                    onMouseLeave={() => setHovered(false)}
                    onClick={() => setSelectedWorktree(project.worktree)}
                  >
                    <span class="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: color() }} />
                    <span class="text-13-regular text-text-base truncate flex-1">{name()}</span>
                    {/* hover actions */}
                    <Show when={hovered()}>
                      <div class="flex items-center gap-0.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          class="w-5 h-5 rounded flex items-center justify-center text-text-weak hover:text-text-base hover:bg-background-hover transition-colors"
                          title="Open"
                          onClick={() => openProject(project.worktree)}
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                            <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                          </svg>
                        </button>
                        <button
                          type="button"
                          class="w-5 h-5 rounded flex items-center justify-center text-text-weak hover:text-red-500 hover:bg-background-hover transition-colors"
                          title="Remove"
                          onClick={(e) => openRemoveConfirm(project.worktree, e)}
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                          </svg>
                        </button>
                      </div>
                    </Show>
                  </div>
                )
              }}
            </For>
          </div>
        </div>

        {/* ── Center: main content ── */}
        <div class="flex-1 flex flex-col overflow-hidden">
          <div class="flex items-center justify-between px-6 py-4 border-b border-border-base flex-shrink-0">
            <div>
              <div class="text-12-regular text-text-weak">Knowledge base</div>
              <div class="text-20-medium text-text-strong leading-tight">
                {activeWorktree() ? workspaceName(activeWorktree()!) : "All Workspaces"}
              </div>
            </div>
            <Button variant="ghost" size="small" onClick={openKbDialog}>
              + New
            </Button>
          </div>

          <div class="flex-1 overflow-y-auto px-6 py-5">
            <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
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
                      <Show when={hovered() || isColorOpen()}>
                        <div class="absolute top-0 left-0 right-0 flex items-center justify-between px-2 pt-2 z-10" onClick={(e) => e.stopPropagation()}>
                          <div class="relative" data-color-picker>
                            <button
                              type="button"
                              class="w-7 h-7 rounded-md flex items-center justify-center"
                              style={{ background: "rgba(0,0,0,0.25)" }}
                              title="Change color"
                              onClick={(e) => openColorPicker(project.worktree, e)}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/>
                                <path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662"/>
                              </svg>
                            </button>
                            <Show when={isColorOpen()}>
                              <div class="absolute top-9 left-0 z-50 rounded-xl shadow-xl border w-72 overflow-hidden" style={{ background: "var(--surface-raised-stronger-non-alpha)", "border-color": "var(--border-weak-base)" }} data-color-picker>
                                <div class="flex border-b" style={{ "border-color": "var(--border-weak-base)" }}>
                                  {(["color", "image", "templates"] as const).map((t) => (
                                    <button type="button" class="flex-1 py-2 text-12-medium transition-colors capitalize" classList={{ "text-text-strong border-b-2 border-current": colorTab() === t, "text-text-weak hover:text-text-base": colorTab() !== t }} onClick={() => setColorTab(t)}>
                                      {t.charAt(0).toUpperCase() + t.slice(1)}
                                    </button>
                                  ))}
                                </div>
                                <Show when={colorTab() === "color"}>
                                  <div class="p-3 max-h-64 overflow-y-auto">
                                    <div class="grid grid-cols-7 gap-1.5">
                                      <For each={COLOR_SWATCHES}>
                                        {(swatch) => (
                                          <button type="button" class="w-7 h-7 rounded-md transition-transform hover:scale-110 active:scale-95 ring-offset-1" classList={{ "ring-2 ring-white": color() === swatch }} style={{ background: swatch }} onClick={() => applyColor(project.worktree, swatch)} />
                                        )}
                                      </For>
                                    </div>
                                  </div>
                                </Show>
                                <Show when={colorTab() !== "color"}>
                                  <div class="p-4 flex flex-col items-center gap-2">
                                    <span class="text-12-regular text-text-weak">Coming soon</span>
                                  </div>
                                </Show>
                              </div>
                            </Show>
                          </div>
                          <div class="flex items-center gap-1">
                            <button type="button" class="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: "rgba(0,0,0,0.25)" }} title="Edit" onClick={(e) => openEditModal(project.worktree, e)}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                              </svg>
                            </button>
                            <button type="button" class="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: "rgba(0,0,0,0.25)" }} title="Remove" onClick={(e) => openRemoveConfirm(project.worktree, e)}>
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
                      <div class="absolute bottom-0 left-0 right-0 p-3">
                        <div class="text-14-medium text-white truncate">{name()}</div>
                        <div class="text-12-regular mt-0.5" style={{ color: "rgba(255,255,255,0.7)" }}>knowledge base</div>
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
        </div>

        {/* ── Right: chat panel ── */}
        <div class="flex flex-col w-80 flex-shrink-0 border-l border-border-base overflow-hidden">
          {/* Chat header */}
          <div class="flex items-center gap-2 px-4 py-3 border-b border-border-base flex-shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-text-weak">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <span class="text-13-medium text-text-strong flex-1">Chat</span>
            <Show when={activeWorktree()}>
              <span class="text-11-regular text-text-weak truncate max-w-24">{workspaceName(activeWorktree()!)}</span>
            </Show>
          </div>

          {/* Messages */}
          <div class="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
            <Show when={chatMessages().length === 0}>
              <div class="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-text-weak">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                <p class="text-12-regular text-text-weak">Ask anything about your workspace</p>
              </div>
            </Show>
            <For each={chatMessages()}>
              {(msg) => (
                <div class="flex flex-col gap-1" style={{ "align-items": msg.role === "user" ? "flex-end" : "flex-start" }}>
                  <div class="text-10-medium text-text-weak uppercase tracking-wider px-1">
                    {msg.role === "user" ? "you" : "supadense"}
                  </div>
                  <div
                    class="text-13-regular text-text-strong px-3 py-2 rounded-xl max-w-[88%]"
                    style={{
                      background: msg.role === "user" ? "rgba(228,166,74,0.15)" : "var(--color-surface-raised-base)",
                      border: msg.role === "user" ? "1px solid rgba(228,166,74,0.3)" : "1px solid var(--color-border-base)",
                      "border-radius": msg.role === "user" ? "10px 10px 2px 10px" : "10px 10px 10px 2px",
                      "white-space": "pre-wrap",
                      "word-break": "break-word",
                    }}
                  >
                    {msg.text}
                  </div>
                </div>
              )}
            </For>
            <Show when={chatLoading()}>
              <div class="text-12-regular text-text-weak italic px-1">thinking…</div>
            </Show>
          </div>

          {/* Input */}
          <div class="flex-shrink-0 px-3 pb-3 pt-2 border-t border-border-base flex flex-col gap-2">
            <textarea
              value={chatInput()}
              onInput={(e) => setChatInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendChat() }
              }}
              placeholder="Ask about this workspace…"
              rows={3}
              class="w-full rounded-lg border border-border-base bg-background-input px-3 py-2 text-13-regular text-text-strong outline-none focus:border-border-focus placeholder:text-text-weak resize-none"
              style={{ "line-height": "1.4", "box-sizing": "border-box" }}
            />
            <div class="flex items-center justify-between">
              <span class="text-10-regular text-text-weak">↵ send · shift+↵ newline</span>
              <button
                type="button"
                onClick={() => void sendChat()}
                disabled={!chatInput().trim() || chatLoading()}
                class="px-3 py-1.5 rounded-md text-12-medium transition-all"
                style={{
                  background: chatInput().trim() ? "#e4a64a" : "var(--color-surface-raised-base)",
                  color: chatInput().trim() ? "#131010" : "var(--color-text-weak)",
                  border: "none",
                  cursor: chatInput().trim() ? "pointer" : "default",
                }}
              >
                {chatLoading() ? "…" : "Ask →"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* KB creation modal */}
      <Show when={kbOpen()}>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center"
          onClick={(e) => { if (e.target === e.currentTarget) closeKbDialog() }}
        >
          <div class="rounded-xl shadow-lg border w-full max-w-sm mx-4" style={{ background: "var(--surface-raised-stronger-non-alpha)", "border-color": "var(--border-weak-base)" }}>
            <div class="flex items-center justify-between px-5 py-4 border-b" style={{ "border-color": "var(--border-weak-base)" }}>
              <span class="text-16-medium text-text-strong">New KB</span>
              <button type="button" class="text-text-weak hover:text-text-strong transition-colors text-lg leading-none" onClick={closeKbDialog}>✕</button>
            </div>
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
