import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { getAuthToken } from "@/utils/server"
import { DataProvider } from "@opencode-ai/ui/context"
import { useGlobalSync } from "@/context/global-sync"
import { useGlobalSDK } from "@/context/global-sdk"
import { useSync } from "@/context/sync"
import { useCommand } from "@/context/command"
import { decode64 } from "@/utils/base64"
import { chatOpen, setChatOpen } from "@/context/chat-overlay"
import { SessionTurn } from "@opencode-ai/ui/session-turn"
import { sessionTitle } from "@/utils/session-title"
import { CaptureDialog } from "@/components/capture-dialog"
import { useProviders } from "@/hooks/use-providers"
import { Identifier } from "@/utils/id"
import { showToast } from "@opencode-ai/ui/toast"
import type { Message, Session } from "@opencode-ai/sdk/v2/client"
import { elApi } from "@/pages/projects/el-api"
import { activeGraphProjectName, activeSourceName, activeSidebarView, activeChatProjectDir, pendingNewChatDir, setPendingNewChatDir, setActiveSessionId } from "@/context/sidebar-view"

export function SupadenseMark(props: { size?: number; class?: string }) {
  const s = props.size ?? 20
  const cellSize = s / 4
  const gap = s > 40 ? 2 : 1.5
  const amberSet = new Set([1, 6, 10, 12])
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} class={props.class} aria-hidden="true">
      <For each={Array.from({ length: 16 }, (_, i) => i)}>
        {(i) => {
          const row = Math.floor(i / 4)
          const col = i % 4
          const x = col * (cellSize + gap / 2)
          const y = row * (cellSize + gap / 2)
          const fill = amberSet.has(i) ? "#d68a2e" : "currentColor"
          return <rect x={x} y={y} width={cellSize - gap / 2} height={cellSize - gap / 2} fill={fill} rx="0.5" />
        }}
      </For>
    </svg>
  )
}

const SUGGESTIONS = [
  {
    label: "summarize this component",
    muted: false,
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="18" y2="18"/></svg>,
  },
  {
    label: "Find what's connected in the team graph",
    muted: false,
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="3"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><line x1="6.5" y1="6.5" x2="9.9" y2="9.9"/><line x1="17.5" y1="6.5" x2="14.1" y2="9.9"/><line x1="6.5" y1="17.5" x2="9.9" y2="14.1"/><line x1="17.5" y1="17.5" x2="14.1" y2="14.1"/></svg>,
  },
  {
    label: "Review me on this component's decisions",
    muted: false,
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  },
  {
    label: "Surface what's stale or unowned",
    muted: false,
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  },
  {
    label: "Compare with what the team decided",
    muted: true,
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20 6L9 17l-5-5"/></svg>,
  },
]

function SupadenseSessionsList(props: {
  directory: string
  activeSessionID: string | undefined
  onSelect: (sessionID: string) => void
}) {
  const globalSync = useGlobalSync()

  const [childStore] = globalSync.child(props.directory, { bootstrap: false })
  const sessions = createMemo(() =>
    (childStore.session ?? [])
      .filter((s: Session) => !s.parentID)
      .slice()
      .sort((a: Session, b: Session) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))
  )
  const isWorking = (sessionID: string) => {
    const status = childStore.session_status?.[sessionID]
    return status?.type !== "idle" && status !== undefined
  }

  return (
    <div style={{ flex: "1", "min-height": "0", "overflow-y": "auto", padding: "8px 0" }}>
      <Show
        when={sessions().length > 0}
        fallback={
          <div style={{ padding: "24px 16px", "text-align": "center", color: "var(--color-text-weak)", "font-size": "13px", "font-family": "'Geist Mono', monospace", "letter-spacing": "0.04em" }}>
            No sessions yet
          </div>
        }
      >
        <For each={sessions()}>
          {(session: Session) => {
            const isActive = () => props.activeSessionID === session.id
            const working = () => isWorking(session.id)
            const title = () => sessionTitle(session.title?.trim()) ?? "New session"
            return (
              <button
                type="button"
                onClick={() => props.onSelect(session.id)}
                style={{
                  display: "flex",
                  "align-items": "center",
                  gap: "10px",
                  width: "100%",
                  padding: "8px 14px",
                  background: isActive() ? "var(--color-surface-raised-base)" : "none",
                  border: "none",
                  "border-left": isActive() ? "2px solid #d68a2e" : "2px solid transparent",
                  cursor: "pointer",
                  "text-align": "left",
                  transition: "background 100ms",
                  "font-family": "inherit",
                }}
              >
                <div style={{ flex: "1", "min-width": "0" }}>
                  <div style={{
                    "font-size": "13px",
                    color: isActive() ? "var(--color-text-strong)" : "var(--color-text-base)",
                    "font-weight": isActive() ? "500" : "400",
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                    "white-space": "nowrap",
                  }}>
                    {title()}
                  </div>
                  <Show when={session.time?.updated}>
                    <div style={{ "font-size": "11px", color: "var(--color-text-weak)", "margin-top": "2px", "font-family": "'Geist Mono', monospace" }}>
                      {new Date(session.time!.updated!).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </Show>
                </div>
                <Show when={working()}>
                  <div style={{ width: "6px", height: "6px", "border-radius": "50%", background: "#d68a2e", "flex-shrink": "0" }} />
                </Show>
              </button>
            )
          }}
        </For>
      </Show>
    </div>
  )
}

const actionBtn: Record<string, string> = {
  width: "28px", height: "28px",
  background: "transparent", border: "0",
  "border-radius": "4px",
  color: "#525252",
  display: "flex", "align-items": "center", "justify-content": "center",
  cursor: "pointer",
  transition: "background 100ms, color 100ms",
}

const tbBtn: Record<string, string> = {
  width: "26px", height: "26px",
  background: "transparent", border: "0",
  color: "#525252",
  "border-radius": "4px",
  display: "inline-flex", "align-items": "center", "justify-content": "center",
  cursor: "pointer",
  transition: "background 100ms, color 100ms",
}

export function SupadenseChatPanel(props: { onClose: () => void }) {
  const params = useParams<{ dir?: string; id?: string }>()
  const navigate = useNavigate()
  const location = useLocation()

  // ── Active scope — what the user is chatting "within" ──────────────────────
  // { type, id, name } or null for workspace-wide. Auto-detects from route/view,
  // but can be cleared by the user (X button on the chip).
  type ScopeCtx = { type: "project" | "source"; id: string; name: string } | null
  const [userScope, setUserScope] = createSignal<ScopeCtx>(undefined as unknown as ScopeCtx)
  const [scopeCleared, setScopeCleared] = createSignal(false) // true when user explicitly cleared

  // Route-based project detection
  const scopeProjectId = createMemo(() => {
    if (/^\/projects\/[^/]+/.test(location.pathname)) return params.id
    return undefined
  })
  const [scopeProject] = createResource(scopeProjectId, (id) => elApi.getProject(id))

  // Auto-derive scope from view signals when not manually cleared
  const derivedScope = createMemo<ScopeCtx>(() => {
    if (scopeCleared()) return null
    const manual = userScope()
    if (manual !== (undefined as unknown as ScopeCtx)) return manual
    // Source open in Read panel
    const sourceName = activeSourceName()
    if (sourceName) return { type: "source", id: "", name: sourceName }
    // Project route (/projects/:id)
    const projData = scopeProject()
    if (projData?.project) return { type: "project", id: projData.project.id, name: projData.project.name }
    // Project open in Graph/Brain tab
    const graphProject = activeGraphProjectName()
    if (graphProject) return { type: "project", id: "", name: graphProject }
    return null
  })

  // Reset cleared state when the view changes to a new project/source
  createEffect(() => {
    const source = activeSourceName()
    const proj = scopeProject()?.project
    const graph = activeGraphProjectName()
    if (source || proj || graph) setScopeCleared(false)
  })

  const scopeLabel = createMemo(() => {
    const localDir = activeChatProjectDir()
    if (localDir) return localDir.split("/").filter(Boolean).pop() ?? "project"
    const s = derivedScope()
    return s ? s.name : "workspace"
  })

  // Context string injected into messages when scope is active
  const scopeContextPrefix = createMemo(() => {
    const s = derivedScope()
    if (!s) return ""
    if (s.type === "project") return s.id
      ? `[Project context: ${s.name} (id: ${s.id})]\n\n`
      : `[Project context: ${s.name}]\n\n`
    return `[Source context: ${s.name}]\n\n`
  })

  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  let sync: ReturnType<typeof useSync> | undefined
  try { sync = useSync() } catch { sync = undefined }
  const providers = useProviders()
  let command: ReturnType<typeof useCommand> | undefined
  try { command = useCommand() } catch { command = undefined }

  // Decode userId from JWT (same pattern as projects-panel.tsx)
  const userId = (() => {
    try {
      const token = getAuthToken()
      if (!token) return undefined
      const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")))
      return typeof payload.userId === "string" ? payload.userId : undefined
    } catch { return undefined }
  })()

  const directory = createMemo(() => {
    // Local git project opened from Recents
    const localDir = activeChatProjectDir()
    if (localDir) return localDir
    // If we're on an EL project route (/projects/:id), use that project's workspace dir
    const projId = (params as any).id as string | undefined
    if (userId && projId && /^\/projects\/[^/]+/.test(location.pathname)) {
      return `/workspaces/${userId}/el-projects/${projId}`
    }
    // Otherwise use the user root
    if (userId) return `/workspaces/${userId}`
    return undefined
  })

  const childStoreMemo = createMemo(() => {
    const dir = directory()
    if (!dir) return undefined
    const [store] = globalSync.child(dir)
    return store
  })
  const childStore = () => childStoreMemo()

  // Git context bar — branch, diff stats, PR link
  const [gitInfo] = createResource(directory, async (dir) => {
    if (!dir || !window.supadense?.gitInfo) return null
    return window.supadense.gitInfo(dir)
  })

  // Model list from connected providers
  const allModels = createMemo(() => {
    const list: Array<{ providerID: string; modelID: string; displayName: string; providerName: string }> = []
    for (const p of providers.connected()) {
      for (const [id, m] of Object.entries(p.models ?? {})) {
        list.push({ providerID: p.id, modelID: id, displayName: (m as any).name || id, providerName: p.id })
      }
    }
    return list
  })

  // Group models by provider for dropdown
  const modelsByProvider = createMemo(() => {
    const groups: Array<{ providerID: string; models: Array<{ providerID: string; modelID: string; displayName: string }> }> = []
    for (const m of allModels()) {
      let g = groups.find(x => x.providerID === m.providerID)
      if (!g) { g = { providerID: m.providerID, models: [] }; groups.push(g) }
      g.models.push(m)
    }
    return groups
  })

  const [selectedModel, setSelectedModel] = createSignal<{ providerID: string; modelID: string } | undefined>(undefined)
  const [modelDropdownOpen, setModelDropdownOpen] = createSignal(false)

  // Auto-select first model when providers load
  createEffect(() => {
    if (!selectedModel() && allModels().length > 0) {
      const first = allModels()[0]
      if (first) setSelectedModel({ providerID: first.providerID, modelID: first.modelID })
    }
  })

  const selectedModelLabel = createMemo(() => {
    const m = selectedModel()
    if (!m) return "Model"
    const found = allModels().find(x => x.providerID === m.providerID && x.modelID === m.modelID)
    return found?.displayName ?? m.modelID
  })

  // Chat state
  const [chatSessionId, setChatSessionId] = createSignal<string | undefined>(undefined)
  const [inputVal, setInputVal] = createSignal("")
  const [sending, setSending] = createSignal(false)
  const [tab, setTab] = createSignal<"chat" | "sessions">("chat")
  const [selectedSessionID, setSelectedSessionID] = createSignal<string | undefined>(undefined)

  // When project changes, load the most recent session for that project
  createEffect(on(directory, () => {
    setSending(false)
    setTab("chat")
    const sessions = (childStore()?.session ?? [])
      .filter((s: Session) => !s.parentID)
      .sort((a: Session, b: Session) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))
    const latest = sessions[0]
    if (latest) {
      setChatSessionId(latest.id)
      setSelectedSessionID(latest.id)
      void sync?.session.sync(latest.id)
    } else {
      setChatSessionId(undefined)
      setSelectedSessionID(undefined)
    }
  }, { defer: true }))
  const [captureOpen, setCaptureOpen] = createSignal(false)
  const [chatDropdownOpen, setChatDropdownOpen] = createSignal(false)

  // Active session for chat tab: chatSessionId or route param
  const activeSessionID = createMemo(() => selectedSessionID() ?? chatSessionId() ?? params.id)

  const messages = createMemo((): Message[] => {
    const id = activeSessionID()
    const store = childStore()
    if (!id || !store) return []
    return (store as any).message?.[id] ?? []
  })

  const isActive = createMemo(() => {
    const id = activeSessionID()
    const store = childStore()
    if (!id || !store) return false
    const status = (store as any).session_status?.[id]
    return status?.type !== "idle" && status !== undefined
  })

  const hasMessages = createMemo(() => messages().length > 0)
  const allSessions = createMemo(() =>
    (childStore()?.session ?? []).filter((s: Session) => !s.parentID).slice().sort((a: Session, b: Session) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))
  )
  const activeChatTitle = createMemo(() => {
    const id = activeSessionID()
    const store = childStore()
    if (!id || !store) return undefined
    const session = (store as any).session?.find((s: Session) => s.id === id)
    return session ? sessionTitle(session.title?.trim()) ?? "New chat" : undefined
  })

  function selectSession(id: string) {
    setSelectedSessionID(id)
    setChatSessionId(id)
    setTab("chat")
    void sync?.session.sync(id)
  }

  // Publish active session ID to sidebar for highlight sync
  createEffect(() => {
    setActiveSessionId(activeSessionID())
  })

  // Listen for session selection events dispatched from the sidebar
  onMount(() => {
    const handler = (e: Event) => {
      const { sessionId, dir } = (e as CustomEvent).detail as { sessionId: string; dir: string }
      if (dir === directory()) {
        selectSession(sessionId)
      }
    }
    window.addEventListener("supadense:select-session", handler)
    onCleanup(() => window.removeEventListener("supadense:select-session", handler))
  })

  // Watch for pending new chat triggered from sidebar + button
  createEffect(() => {
    const pending = pendingNewChatDir()
    if (!pending) return
    const dir = directory()
    if (dir && dir === pending) {
      setPendingNewChatDir(null)
      setChatSessionId(undefined)
      setSelectedSessionID(undefined)
      setTab("chat")
      requestAnimationFrame(() => textareaRef?.focus())
    }
  })

  // ── Slash commands ──────────────────────────────────────────────────────────
  const [slashOpen, setSlashOpen] = createSignal(false)
  const [slashQuery, setSlashQuery] = createSignal("")
  const [slashIdx, setSlashIdx] = createSignal(0)

  // Built-in chat commands
  const BUILTIN_SLASH = [
    { id: "chat.new",          trigger: "new",           title: "New chat",         description: "Start a fresh conversation" },
    { id: "chat.model",        trigger: "model",         title: "Model",            description: "Open the model selector" },
    { id: "chat.clear",        trigger: "clear",         title: "Clear",            description: "Clear input" },
    { id: "compact",           trigger: "compact",       title: "Compact",          description: "Summarise and compress this session's context" },
    // Brain commands
    { id: "brain.context",     trigger: "brain-context", title: "Brain context",    description: "What does the brain know about what I'm working on?" },
    { id: "brain.search",      trigger: "brain-search",  title: "Brain search",     description: "Search the engineering brain" },
    { id: "brain.save",        trigger: "brain-save",    title: "Brain save",       description: "Capture a decision or insight into the brain" },
    // EL project commands
    { id: "el.projects",       trigger: "projects",      title: "List projects",    description: "List all your EL projects" },
    { id: "el.sources",        trigger: "sources",       title: "List sources",     description: "List sources for a project" },
    { id: "el.capture",        trigger: "capture",       title: "Capture URL",      description: "Capture a URL as a source" },
    { id: "el.remove-source",  trigger: "remove-source", title: "Remove source",    description: "Remove a source from a project" },
  ] as const

  const slashCommands = createMemo(() => {
    // Backend custom commands (MCP / skills)
    const custom = ((globalSync.data as any).command ?? []).map((cmd: any) => ({
      id: `custom.${cmd.name}`,
      trigger: cmd.name as string,
      title: cmd.name as string,
      description: (cmd.description ?? cmd.name) as string,
      type: "custom" as const,
    }))
    // Session-registered commands that have a slash trigger (available when inside a session)
    const fromRegistry = (command?.options ?? [])
      .filter((opt: any) => !opt.disabled && !opt.id?.startsWith("suggested.") && opt.slash)
      .map((opt: any) => ({ id: opt.id as string, trigger: opt.slash as string, title: opt.title as string, description: (opt.description ?? "") as string, type: "builtin" as const }))
    // Always-available chat-panel builtins
    const builtin = BUILTIN_SLASH.map((c) => ({ ...c, type: "builtin" as const }))
    // Merge: custom first, then registry (deduped by trigger), then panel builtins that aren't in registry
    const all: Array<{ id: string; trigger: string; title: string; description: string; type: "builtin" | "custom" }> = [...custom, ...fromRegistry]
    for (const b of builtin) {
      if (!all.some((x) => x.trigger === b.trigger)) all.push(b)
    }
    return all
  })

  const filteredSlash = createMemo(() => {
    const q = slashQuery().toLowerCase()
    return slashCommands().filter((c) => !q || c.trigger.toLowerCase().includes(q) || c.title.toLowerCase().includes(q))
  })

  function applySlashCommand(cmd: { id: string; trigger: string; type: "builtin" | "custom"; argsHint?: string }) {
    setSlashOpen(false)
    setSlashQuery("")

    // Panel builtins — no session needed
    switch (cmd.id) {
      case "chat.new":
        setInputVal("")
        setChatSessionId(undefined); setSelectedSessionID(undefined); setTab("chat")
        requestAnimationFrame(() => textareaRef?.focus())
        return
      case "chat.model":
        setInputVal("")
        setModelDropdownOpen(true)
        return
      case "chat.clear":
        setInputVal("")
        requestAnimationFrame(() => textareaRef?.focus())
        return
      // Brain + EL commands — pre-fill the textarea so the user can refine and send
      case "brain.context":
        setInputVal("What does the brain know about what I'm currently working on?")
        requestAnimationFrame(() => textareaRef?.focus())
        return
      case "brain.search":
        setInputVal("Search the brain for: ")
        requestAnimationFrame(() => textareaRef?.focus())
        return
      case "brain.save":
        setInputVal("Save this to the brain: ")
        requestAnimationFrame(() => textareaRef?.focus())
        return
      case "el.projects":
        setInputVal("List all my projects")
        requestAnimationFrame(() => textareaRef?.focus())
        return
      case "el.sources":
        setInputVal("List sources for project: ")
        requestAnimationFrame(() => textareaRef?.focus())
        return
      case "el.capture":
        setInputVal("Capture this URL: ")
        requestAnimationFrame(() => textareaRef?.focus())
        return
      case "el.remove-source":
        setInputVal("Remove source with id: ")
        requestAnimationFrame(() => textareaRef?.focus())
        return
    }

    // Backend commands (custom MCP/skill/command) and compact — need a session
    // If the command needs arguments (e.g. /add-resource <url>), pre-fill the input
    const needsArgs = cmd.type === "custom" // backend commands typically take $ARGUMENTS
    if (needsArgs) {
      setInputVal(`/${cmd.trigger} `)
      requestAnimationFrame(() => { textareaRef?.focus(); textareaRef && (textareaRef.selectionStart = textareaRef.selectionEnd = textareaRef.value.length) })
      return
    }

    // Builtin commands that map to session.command (compact, etc.)
    const commandName = cmd.trigger // e.g. "compact", "add-resource"
    void executeSessionCommand(commandName, "")
  }

  async function executeSessionCommand(commandName: string, args: string) {
    const model = selectedModel()
    if (!model) { showToast({ variant: "error", title: "No model", description: "Select a model first" }); return }
    const dir = directory()
    const client = dir ? globalSDK.createClient({ directory: dir, throwOnError: true }) : globalSDK.createClient({ throwOnError: true })
    setSending(true)
    try {
      let sid = chatSessionId()
      if (!sid) {
        const created = await client.session.create().then((x: any) => x.data)
        if (!created?.id) throw new Error("Failed to create session")
        sid = created.id as string
        setChatSessionId(sid)
      }
      const messageID = Identifier.ascending("message")
      await client.session.command({
        sessionID: sid as string,
        command: commandName,
        arguments: args,
        model: `${model.providerID}/${model.modelID}`,
        messageID,
      })
    } catch (err: any) {
      showToast({ variant: "error", title: "Command failed", description: err?.message ?? "Unknown error" })
    } finally {
      setSending(false)
    }
  }

  function handleSlashKeyDown(e: KeyboardEvent) {
    if (!slashOpen()) return
    const items = filteredSlash()
    if (e.key === "ArrowDown") { e.preventDefault(); setSlashIdx((i) => Math.min(i + 1, items.length - 1)) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSlashIdx((i) => Math.max(i - 1, 0)) }
    else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault()
      const sel = items[slashIdx()]
      if (sel) applySlashCommand(sel)
    } else if (e.key === "Escape") { setSlashOpen(false) }
  }
  // ────────────────────────────────────────────────────────────────────────────

  const isReady = () => inputVal().trim().length > 0 && !sending()

  // Surface session errors (e.g. "Agent not found") as toasts
  createEffect(() => {
    const id = activeSessionID()
    const store = childStore()
    if (!id || !store) return
    const status = (store as any).session_status?.[id]
    if (status?.type === "error" && status.error) {
      const msg = status.error.message ?? JSON.stringify(status.error)
      showToast({ variant: "error", title: "Session error", description: msg })
      setSending(false)
    }
  })

  async function handleSend() {
    const text = inputVal().trim()
    console.log("[supadense-chat] handleSend called, text:", text, "sending:", sending(), "model:", selectedModel(), "dir:", directory())
    if (!text || sending()) return

    // Detect slash command submission: /command-name [args]
    const slashMatch = text.match(/^\/(\S+)(?:\s(.*))?$/s)
    if (slashMatch) {
      const cmdName = slashMatch[1]
      const cmdArgs = slashMatch[2]?.trim() ?? ""
      const known = slashCommands().find((c) => c.trigger === cmdName)
      if (known && (known.type === "custom" || !["new", "model", "clear"].includes(known.trigger))) {
        setInputVal("")
        void executeSessionCommand(cmdName, cmdArgs)
        return
      }
    }

    const model = selectedModel()
    if (!model) { showToast({ variant: "error", title: "No model", description: "Select a model first" }); return }
    console.log("[supadense-chat] sending with model:", model.providerID, model.modelID)

    const dir = directory()
    console.log("[supadense-chat] directory:", dir)
    const client = dir ? globalSDK.createClient({ directory: dir, throwOnError: true }) : globalSDK.createClient({ throwOnError: true })
    setSending(true)
    setInputVal("")
    try {
      let sid = chatSessionId()
      if (!sid) {
        console.log("[supadense-chat] creating session for dir:", dir)
        const res = await Promise.race([
          client.session.create(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("session.create timed out — directory may not be accessible: " + dir)), 10000)),
        ])
        console.log("[supadense-chat] session.create response:", JSON.stringify(res))
        const created = (res as any).data
        if (!created?.id) throw new Error("Failed to create session: " + JSON.stringify(res))
        sid = created.id as string
        setChatSessionId(sid)
        void sync?.session.sync(sid)
      }
      const messageID = Identifier.ascending("message")
      console.log("[supadense-chat] sending prompt to session:", sid)
      const promptRes = await Promise.race([
        client.session.promptAsync({
          sessionID: sid as string,
          agent: "build",
          model,
          messageID,
          parts: [{ id: Identifier.ascending("part"), type: "text" as const, text: scopeContextPrefix() + text }],
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Request timed out after 15s")), 15000)),
      ])
      console.log("[supadense-chat] promptAsync response:", JSON.stringify(promptRes))
      void sync?.session.sync(sid as string)
    } catch (err: any) {
      const errMsg = err?.message ?? err?.error?.message ?? JSON.stringify(err)
      console.error("[supadense-chat] handleSend error:", errMsg, err)
      showToast({ variant: "error", title: "Send failed", description: errMsg })
      setInputVal(text)
    } finally {
      setSending(false)
    }
  }

  let textareaRef: HTMLTextAreaElement | undefined
  let inputWrapRef: HTMLDivElement | undefined

  function autoResize() {
    if (!textareaRef) return
    textareaRef.style.height = "auto"
    textareaRef.style.height = Math.min(textareaRef.scrollHeight, 120) + "px"
  }

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%", "min-height": "0", background: "#ffffff", overflow: "hidden", "font-family": "'Geist', system-ui, sans-serif" }}>

      {/* Chat dropdown (hidden head, still accessible programmatically) */}
      <Show when={chatDropdownOpen()}>
        <div style={{ position: "fixed", inset: "0", "z-index": "998" }} onClick={() => setChatDropdownOpen(false)} />
        <div style={{ position: "absolute", top: "4px", left: "14px", "min-width": "260px", background: "#ffffff", border: "1px solid #e5e5e5", "border-radius": "8px", "box-shadow": "0 8px 24px rgba(0,0,0,0.12)", "z-index": "999", overflow: "hidden" }}>
            {/* + New chat */}
            <button
              type="button"
              onClick={() => { setChatSessionId(undefined); setSelectedSessionID(undefined); setTab("chat"); setChatDropdownOpen(false) }}
              style={{ display: "flex", "align-items": "center", gap: "8px", width: "100%", padding: "10px 14px", border: "none", "border-bottom": "1px solid #f4f4f5", background: "none", cursor: "pointer", "font-family": "'Geist', system-ui, sans-serif", "font-size": "13px", "font-weight": "500", color: "#d68a2e", "text-align": "left" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#fafafa" }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              New chat
            </button>
            {/* Sessions list */}
            <div style={{ "max-height": "280px", "overflow-y": "auto" }}>
              <Show when={allSessions().length > 0} fallback={
                <div style={{ padding: "12px 14px", "font-size": "12px", color: "#737373" }}>No previous sessions</div>
              }>
                <For each={allSessions()}>
                  {(session: Session) => (
                    <button
                      type="button"
                      onClick={() => { selectSession(session.id); setChatDropdownOpen(false) }}
                      style={{ display: "flex", "align-items": "center", width: "100%", padding: "9px 14px", border: "none", "border-left": activeSessionID() === session.id ? "2px solid #d68a2e" : "2px solid transparent", background: activeSessionID() === session.id ? "#fafafa" : "none", cursor: "pointer", "font-family": "'Geist', system-ui, sans-serif", "text-align": "left" }}
                      onMouseEnter={(e) => { if (activeSessionID() !== session.id) (e.currentTarget as HTMLElement).style.background = "#fafafa" }}
                      onMouseLeave={(e) => { if (activeSessionID() !== session.id) (e.currentTarget as HTMLElement).style.background = "none" }}
                    >
                      <div style={{ flex: "1", "min-width": "0" }}>
                        <div style={{ "font-size": "13px", color: activeSessionID() === session.id ? "#0a0a0a" : "#525252", "font-weight": activeSessionID() === session.id ? "500" : "400", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                          {sessionTitle(session.title?.trim()) ?? "New session"}
                        </div>
                        <Show when={session.time?.updated}>
                          <div style={{ "font-size": "11px", color: "#a3a3a3", "margin-top": "1px" }}>
                            {new Date(session.time!.updated!).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </div>
                        </Show>
                      </div>
                    </button>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </Show>

      {/* Sessions tab */}
      <Show when={tab() === "sessions"}>
        <Show when={directory()} fallback={<div style={{ flex: "1", display: "flex", "align-items": "center", "justify-content": "center", color: "#737373", "font-size": "13px" }}>Open a workspace first</div>}>
          <div style={{ flex: "1", "min-height": "0", "overflow-y": "auto", padding: "8px 0" }}>
            <Show when={allSessions().length > 0} fallback={<div style={{ padding: "24px 16px", "text-align": "center", color: "#737373", "font-size": "13px" }}>No sessions yet</div>}>
              <For each={allSessions()}>
                {(session: Session) => (
                  <button type="button" onClick={() => selectSession(session.id)} style={{ display: "flex", "align-items": "center", gap: "10px", width: "100%", padding: "8px 14px", background: activeSessionID() === session.id ? "#fafafa" : "none", border: "none", "border-left": activeSessionID() === session.id ? "2px solid #d68a2e" : "2px solid transparent", cursor: "pointer", "text-align": "left", "font-family": "inherit" }}>
                    <div style={{ flex: "1", "min-width": "0" }}>
                      <div style={{ "font-size": "13px", color: activeSessionID() === session.id ? "#0a0a0a" : "#525252", "font-weight": activeSessionID() === session.id ? "500" : "400", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                        {sessionTitle(session.title?.trim()) ?? "New session"}
                      </div>
                      <Show when={session.time?.updated}>
                        <div style={{ "font-size": "11px", color: "#737373", "margin-top": "2px", "font-family": "'Geist Mono', monospace" }}>
                          {new Date(session.time!.updated!).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </Show>
                    </div>
                  </button>
                )}
              </For>
            </Show>
          </div>
        </Show>
      </Show>

      {/* Chat tab */}
      <Show when={tab() === "chat"}>
        <div style={{ flex: "1", "min-height": "0", "overflow-y": "auto", padding: "22px 22px 0", display: "flex", "flex-direction": "column", gap: "4px" }}>
        <div style={{ width: "100%", "max-width": "720px", display: "flex", "flex-direction": "column", gap: "4px", margin: "0 auto" }}>
          <Show when={hasMessages()} fallback={
            <div style={{ display: "flex", flex: "1", "align-items": "center", "justify-content": "center" }}>
            <div style={{ "max-width": "480px", width: "100%" }}>
              <div style={{ width: "44px", height: "44px", "border-radius": "50%", background: "#ffffff", border: "1px solid #e5e5e5", display: "flex", "align-items": "center", "justify-content": "center", color: "#0a0a0a", "margin-bottom": "12px", "flex-shrink": "0" }}>
                <span style={{ width: "22px", height: "22px", display: "grid", "grid-template-columns": "repeat(3, 1fr)", "grid-template-rows": "repeat(3, 1fr)", gap: "2px" }} aria-hidden="true">
                  {([0,1,2,3,4,5,6,7,8] as const).map((i) => (<span style={{ background: i === 4 ? "#d68a2e" : "#0a0a0a", "border-radius": "1px", display: "block" }} />))}
                </span>
              </div>
              <h3 style={{ margin: "0 0 18px", "font-size": "19px", "font-weight": "500", "letter-spacing": "-0.015em", color: "#0a0a0a", "font-family": "'Geist', system-ui, sans-serif", "line-height": "1.3" }}>
                Ask about your team's{" "}<em style={{ color: "#d68a2e", "font-style": "normal", "font-weight": "500" }}>engineering.</em>
              </h3>
              <Show when={sending()}>
                <div style={{ "font-size": "13px", color: "#737373", display: "flex", "align-items": "center", gap: "8px" }}>
                  <span style={{ width: "6px", height: "6px", "border-radius": "50%", background: "#d68a2e", display: "inline-block", animation: "pulse 1s infinite" }} />
                  Thinking…
                </div>
              </Show>
              <Show when={!sending()}>
                <div style={{ display: "flex", "flex-direction": "column", "padding-bottom": "14px" }}>
                  <For each={SUGGESTIONS}>
                    {(s) => (
                      <button type="button" disabled={s.muted} onClick={() => { if (!s.muted) { setInputVal(s.label); textareaRef?.focus() } }} style={{ display: "flex", "align-items": "center", gap: "14px", padding: "10px 4px", background: "transparent", border: "0", "text-align": "left", cursor: s.muted ? "default" : "pointer", "font-family": "'Geist', system-ui, sans-serif", "font-size": "14px", color: s.muted ? "#a3a3a3" : "#0a0a0a", width: "100%" }}>
                        <span style={{ width: "20px", height: "20px", "flex-shrink": "0", color: s.muted ? "#d4d4d4" : "#525252", display: "flex", "align-items": "center", "justify-content": "center" }}>{s.icon}</span>
                        {s.label}
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>
            </div>
          }>
            <Show when={childStore() && directory()}>
              <DataProvider
                data={childStore() as any}
                directory={directory()!}
              >
                <div style={{ display: "flex", "flex-direction": "column", "padding-bottom": "8px" }}>
                  <For each={messages()}>
                    {(msg) => (
                      <SessionTurn
                        sessionID={activeSessionID() ?? ""}
                        messageID={msg.id}
                        active={isActive()}
                        classes={{ root: "min-w-0 w-full relative", content: "flex flex-col justify-between !overflow-visible", container: "w-full px-3" }}
                      />
                    )}
                  </For>
                  <Show when={sending() && !isActive()}>
                    <div style={{ "font-size": "13px", color: "#737373", padding: "8px 12px", display: "flex", "align-items": "center", gap: "8px" }}>
                      <span style={{ width: "6px", height: "6px", "border-radius": "50%", background: "#d68a2e", display: "inline-block" }} />
                      Thinking…
                    </div>
                  </Show>
                </div>
              </DataProvider>
            </Show>
          </Show>
        </div>{/* end centering inner div */}
        </div>

        {/* Slash command popup — rendered in a Portal to escape overflow:hidden on the panel */}
        <Portal mount={document.body}>
          <Show when={slashOpen() && filteredSlash().length > 0}>
            {(() => {
              const rect = inputWrapRef?.getBoundingClientRect()
              if (!rect) return null
              return (
                <div
                  style={{
                    position: "fixed",
                    bottom: `${window.innerHeight - rect.top + 6}px`,
                    left: `${rect.left}px`,
                    width: `${rect.width}px`,
                    background: "#ffffff",
                    border: "1px solid #e5e5e5",
                    "border-radius": "8px",
                    "box-shadow": "0 4px 20px rgba(0,0,0,0.12)",
                    "z-index": "9999",
                    overflow: "hidden",
                    "max-height": "240px",
                    "overflow-y": "auto",
                  }}
                >
                  <For each={filteredSlash()}>
                    {(cmd, i) => (
                      <button
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); applySlashCommand(cmd) }}
                        onMouseEnter={() => setSlashIdx(i())}
                        style={{
                          display: "flex", "align-items": "center", gap: "10px",
                          width: "100%", padding: "8px 12px", border: "none",
                          background: slashIdx() === i() ? "rgba(214,138,46,0.06)" : "transparent",
                          "border-left": slashIdx() === i() ? "2px solid #d68a2e" : "2px solid transparent",
                          cursor: "pointer", "text-align": "left",
                        }}
                      >
                        <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "12px", "font-weight": "600", color: "#d68a2e", "white-space": "nowrap", "min-width": "80px" }}>
                          /{cmd.trigger}
                        </span>
                        <span style={{ "font-size": "12px", color: "#525252", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                          {cmd.description ?? cmd.title}
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              )
            })()}
          </Show>
        </Portal>

        {/* Git context bar — just above input */}
        <Show when={gitInfo() && directory()}>
          {(() => {
            const [gitMenuOpen, setGitMenuOpen] = createSignal(false)
            const repoName = () => directory()!.split("/").filter(Boolean).pop() ?? ""
            const ghRepoUrl = () => {
              const remote = gitInfo()?.remote
              if (!remote) return null
              const m = remote.match(/github\.com[:/](.+?)(?:\.git)?$/)
              return m ? `https://github.com/${m[1]}` : null
            }
            return (
              <div style={{ display: "flex", "justify-content": "center", padding: "0 14px 4px", "flex-shrink": "0" }}>
              <div style={{ width: "100%", "max-width": "720px", display: "flex", "align-items": "center", gap: "8px", padding: "5px 10px", "border-radius": "6px", background: "#f5f5f5", border: "1px solid #ebebeb", position: "relative" }}>
                {/* Clickable left section — repo + branch */}
                <button
                  type="button"
                  onClick={() => setGitMenuOpen(v => !v)}
                  style={{ display: "flex", "align-items": "center", gap: "8px", background: "none", border: "none", cursor: "pointer", padding: "0", "flex-shrink": "0" }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#737373" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{ "flex-shrink": "0" }}>
                    <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
                    <path d="M6 9v3a3 3 0 0 0 3 3h3"/><line x1="6" y1="9" x2="6" y2="15"/>
                  </svg>
                  <span style={{ "font-size": "12px", color: "#525252", "font-family": "'Geist Mono', monospace", "font-weight": "500" }}>{repoName()}</span>
                  <span style={{ "font-size": "12px", color: "#c4c4c4" }}>·</span>
                  <span style={{ "font-size": "12px", color: "#737373", "font-family": "'Geist Mono', monospace" }}>{gitInfo()?.branch ?? "main"}</span>
                </button>

                {/* Diff stats */}
                <Show when={(gitInfo()?.added ?? 0) > 0 || (gitInfo()?.removed ?? 0) > 0}>
                  <span style={{ "font-size": "12px", color: "#c4c4c4" }}>·</span>
                  <Show when={(gitInfo()?.added ?? 0) > 0}>
                    <span style={{ "font-size": "12px", "font-weight": "600", color: "#16a34a", "font-family": "'Geist Mono', monospace" }}>+{gitInfo()!.added}</span>
                  </Show>
                  <Show when={(gitInfo()?.removed ?? 0) > 0}>
                    <span style={{ "font-size": "12px", "font-weight": "600", color: "#dc2626", "font-family": "'Geist Mono', monospace" }}>−{gitInfo()!.removed}</span>
                  </Show>
                </Show>

                <div style={{ flex: "1" }} />

                {/* Create PR button */}
                <Show when={gitInfo()?.prUrl}>
                  <button
                    type="button"
                    onClick={() => window.open(gitInfo()!.prUrl!, "_blank")}
                    style={{ display: "flex", "align-items": "center", gap: "5px", padding: "3px 9px", "font-size": "12px", "font-family": "'Geist', system-ui, sans-serif", "font-weight": "500", color: "#0a0a0a", background: "#ffffff", border: "1px solid #d4d4d4", "border-radius": "5px", cursor: "pointer", transition: "background 100ms, border-color 100ms" }}
                    onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = "#f0f0f0"; el.style.borderColor = "#a3a3a3" }}
                    onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = "#ffffff"; el.style.borderColor = "#d4d4d4" }}
                  >
                    Create PR
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                  </button>
                </Show>

                {/* Dropdown menu */}
                <Show when={gitMenuOpen()}>
                  <div style={{ position: "fixed", inset: "0", "z-index": "998" }} onClick={() => setGitMenuOpen(false)} />
                  <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: "0", "z-index": "999", background: "#1e1e1e", border: "1px solid #333", "border-radius": "8px", "min-width": "180px", overflow: "hidden", "box-shadow": "0 8px 24px rgba(0,0,0,0.3)", padding: "4px 0" }}>
                    <button
                      type="button"
                      onClick={() => { setGitMenuOpen(false); window.supadense?.showInFinder?.(directory()!) }}
                      style={{ display: "block", width: "100%", padding: "8px 14px", background: "none", border: "none", "text-align": "left", "font-size": "13px", "font-family": "'Geist', system-ui, sans-serif", color: "#e5e5e5", cursor: "pointer" }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#2a2a2a" }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none" }}
                    >
                      Show in Finder
                    </button>
                    <button
                      type="button"
                      style={{ display: "block", width: "100%", padding: "8px 14px", background: "none", border: "none", "text-align": "left", "font-size": "13px", "font-family": "'Geist', system-ui, sans-serif", color: "#e5e5e5", cursor: "pointer" }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#2a2a2a" }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none" }}
                      onClick={() => { setGitMenuOpen(false); navigator.clipboard.writeText(directory()!) }}
                    >
                      Copy path
                    </button>
                    <Show when={ghRepoUrl()}>
                      <button
                        type="button"
                        style={{ display: "block", width: "100%", padding: "8px 14px", background: "none", border: "none", "text-align": "left", "font-size": "13px", "font-family": "'Geist', system-ui, sans-serif", color: "#e5e5e5", cursor: "pointer" }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#2a2a2a" }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none" }}
                        onClick={() => { setGitMenuOpen(false); window.open(ghRepoUrl()!, "_blank") }}
                      >
                        Open repo in GitHub
                      </button>
                    </Show>
                  </div>
                </Show>
              </div>
              </div>
            )
          })()}
        </Show>

        {/* Input wrap — centered */}
        <div style={{ display: "flex", "justify-content": "center", padding: "0 14px 14px", "flex-shrink": "0" }}>
        <div ref={inputWrapRef} style={{ width: "100%", "max-width": "720px", border: "1.5px solid #d68a2e", "border-radius": "8px", background: "#ffffff", padding: "10px 12px 8px", display: "flex", "flex-direction": "column", gap: "8px", "flex-shrink": "0", position: "relative" }}>
          {/* Textarea */}
          <textarea
            ref={textareaRef}
            placeholder="ask about team decisions, / for commands"
            value={inputVal()}
            rows={1}
            onInput={(e) => {
              const val = e.currentTarget.value
              setInputVal(val)
              autoResize()
              const m = val.match(/^\/(\S*)$/)
              if (m) { setSlashOpen(true); setSlashQuery(m[1]); setSlashIdx(0) }
              else setSlashOpen(false)
            }}
            onKeyDown={(e) => {
              if (slashOpen()) { handleSlashKeyDown(e); return }
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend() }
            }}
            style={{ width: "100%", border: "0", outline: "0", background: "transparent", "font-family": "'Geist', system-ui, sans-serif", "font-size": "15px", color: "#0a0a0a", padding: "2px 0", resize: "none", overflow: "hidden", "min-height": "24px", "line-height": "1.5" }}
          />

          {/* Toolbar */}
          <div style={{ display: "flex", "align-items": "center", gap: "4px", "padding-top": "2px", position: "relative" }}>
            <button type="button" title="attach" style={tbBtn}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            <button type="button" title="filters" style={tbBtn}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="4" y1="7" x2="20" y2="7"/><circle cx="9" cy="7" r="2.4" fill="#f4f4f5"/><line x1="4" y1="17" x2="20" y2="17"/><circle cx="15" cy="17" r="2.4" fill="#f4f4f5"/></svg>
            </button>
            <span style={{ flex: "1" }} />

            {/* Model selector */}
            <div style={{ position: "relative" }}>
              <button type="button" onClick={() => setModelDropdownOpen(v => !v)} style={{ "font-family": "'Geist', system-ui, sans-serif", "font-size": "12px", color: "#525252", padding: "3px 8px", border: "1px solid #e5e5e5", "border-radius": "4px", background: "transparent", cursor: "pointer", display: "flex", "align-items": "center", gap: "4px", "white-space": "nowrap", "max-width": "140px", overflow: "hidden", "text-overflow": "ellipsis" }}>
                <span style={{ overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>{selectedModelLabel()}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style={{ "flex-shrink": "0" }}><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              <Show when={modelDropdownOpen()}>
                <div style={{ position: "absolute", bottom: "calc(100% + 4px)", right: "0", "z-index": "200", background: "#ffffff", border: "1px solid #e5e5e5", "border-radius": "6px", "min-width": "220px", "max-height": "260px", "overflow-y": "auto", "box-shadow": "0 4px 16px rgba(0,0,0,0.12)" }}>
                  <Show when={allModels().length === 0}>
                    <div style={{ padding: "16px 12px", "font-size": "12px", color: "#737373", "text-align": "center" }}>No models connected.<br/>Configure providers in settings.</div>
                  </Show>
                  <For each={modelsByProvider()}>
                    {(group) => (
                      <>
                        <div style={{ padding: "6px 10px 2px", "font-family": "'Geist Mono', monospace", "font-size": "9px", "letter-spacing": "0.1em", "text-transform": "uppercase", color: "#a3a3a3", "border-top": "1px solid #f0f0f0" }}>
                          {group.providerID}
                        </div>
                        <For each={group.models}>
                          {(m) => {
                            const isSelected = () => selectedModel()?.providerID === m.providerID && selectedModel()?.modelID === m.modelID
                            return (
                              <button type="button" onClick={() => { setSelectedModel({ providerID: m.providerID, modelID: m.modelID }); setModelDropdownOpen(false) }} style={{ display: "block", width: "100%", "text-align": "left", padding: "7px 10px", "font-size": "12px", "font-family": "'Geist', system-ui, sans-serif", color: isSelected() ? "#d68a2e" : "#525252", background: isSelected() ? "rgba(214,138,46,0.06)" : "transparent", border: "none", "border-left": isSelected() ? "2px solid #d68a2e" : "2px solid transparent", cursor: "pointer" }}>
                                {m.displayName}
                              </button>
                            )
                          }}
                        </For>
                      </>
                    )}
                  </For>
                </div>
              </Show>
            </div>

            {/* Voice */}
            <button type="button" title="voice" style={tbBtn}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><line x1="12" y1="18" x2="12" y2="21"/></svg>
            </button>

            {/* Send */}
            <button type="button" title="send" onClick={() => void handleSend()} disabled={!isReady()} style={{ width: "28px", height: "28px", background: isReady() ? "#d68a2e" : "#e5e5e5", border: `1px solid ${isReady() ? "#d68a2e" : "#d4d4d4"}`, color: isReady() ? "#ffffff" : "#525252", "border-radius": "50%", display: "inline-flex", "align-items": "center", "justify-content": "center", cursor: isReady() ? "pointer" : "default", transition: "background 140ms, border-color 140ms, color 140ms" }}>
              <Show when={sending()} fallback={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
              }>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
              </Show>
            </button>
          </div>
        </div>{/* end input inner div */}
        </div>{/* end centering outer div */}
      </Show>

      <Show when={captureOpen() && directory()}>
        <CaptureDialog onClose={() => setCaptureOpen(false)} />
      </Show>
    </div>
  )
}

/** Global FAB — lives in layout.tsx (visible on all pages) */
export function SupadenseFAB() {
  const [hov, setHov] = createSignal(false)
  return (
    <Show when={!chatOpen() && activeSidebarView().view !== "ask"}>
      <button
        type="button"
        title="Ask supadense"
        aria-label="Ask supadense"
        onClick={() => setChatOpen(true)}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          position: "fixed",
          bottom: "96px",
          right: "24px",
          width: "52px",
          height: "52px",
          "border-radius": "50%",
          background: "#ffffff",
          border: hov() ? "1px solid #d68a2e" : "1px solid #e5e5e5",
          "box-shadow": hov()
            ? "0 10px 28px -8px rgba(214,138,46,0.30), 0 2px 4px -2px rgba(0,0,0,0.10)"
            : "0 6px 20px -6px rgba(0,0,0,0.18), 0 2px 4px -2px rgba(0,0,0,0.08)",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          cursor: "pointer",
          "z-index": "70",
          transform: hov() ? "translateY(-1px)" : "translateY(0)",
          transition: "transform 140ms cubic-bezier(0.22,1,0.36,1), box-shadow 140ms, border-color 140ms",
          padding: "0",
        }}
      >
        {/* 3×3 glyph matching app.html .ask-fab .glyph */}
        <span style={{
          display: "inline-grid",
          "grid-template-columns": "repeat(3, 1fr)",
          "grid-template-rows": "repeat(3, 1fr)",
          gap: "2px",
          width: "24px",
          height: "24px",
        }} aria-hidden="true">
          {([0,1,2,3,4,5,6,7,8] as const).map((i) => (
            <span style={{
              display: "block",
              background: i === 4 ? "#d68a2e" : "#0a0a0a",
              "border-radius": "1px",
              "box-shadow": i === 4 && hov() ? "0 0 6px rgba(214,138,46,0.6)" : "none",
            }} />
          ))}
        </span>
      </button>
    </Show>
  )
}

/** Side panel — slides in from the right, pushes main content left (matches app.html .ask-pop) */
export function SupadenseChatOverlay() {
  return null
}
