import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { useNavigate, useParams } from "@solidjs/router"
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

function SupadenseChatPanel(props: { onClose: () => void }) {
  const params = useParams<{ dir?: string; id?: string }>()
  const navigate = useNavigate()
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
    // If we're on an EL project route (/projects/:id), use that project's workspace dir
    const projId = (params as any).id as string | undefined
    if (userId && projId) return `/workspaces/${userId}/el-projects/${projId}`
    // Otherwise use the user root — now allowed by the backend guard fix
    if (userId) return `/workspaces/${userId}`
    return undefined
  })

  const [childStore] = createMemo(() => {
    const dir = directory()
    if (!dir) return [undefined, undefined] as const
    return globalSync.child(dir) // bootstrap: true (default) — registers dir for SSE events + loads sessions
  })() ?? [undefined]

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
  const [captureOpen, setCaptureOpen] = createSignal(false)

  // Active session for chat tab: chatSessionId or route param
  const activeSessionID = createMemo(() => selectedSessionID() ?? chatSessionId() ?? params.id)

  const messages = createMemo((): Message[] => {
    const id = activeSessionID()
    if (!id || !childStore) return []
    return (childStore as any).message?.[id] ?? []
  })

  const isActive = createMemo(() => {
    const id = activeSessionID()
    if (!id || !childStore) return false
    const status = (childStore as any).session_status?.[id]
    return status?.type !== "idle" && status !== undefined
  })

  const hasMessages = createMemo(() => messages().length > 0)
  const allSessions = createMemo(() =>
    (childStore?.session ?? []).filter((s: Session) => !s.parentID).slice().sort((a: Session, b: Session) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))
  )
  const activeChatTitle = createMemo(() => {
    const id = activeSessionID()
    if (!id || !childStore) return undefined
    const session = (childStore as any).session?.find((s: Session) => s.id === id)
    return session ? sessionTitle(session.title?.trim()) ?? "New chat" : undefined
  })

  function selectSession(id: string) {
    setSelectedSessionID(id)
    setChatSessionId(id)
    setTab("chat")
    void sync?.session.sync(id)
  }

  // ── Slash commands ──────────────────────────────────────────────────────────
  const [slashOpen, setSlashOpen] = createSignal(false)
  const [slashQuery, setSlashQuery] = createSignal("")
  const [slashIdx, setSlashIdx] = createSignal(0)

  // Built-in chat commands
  const BUILTIN_SLASH = [
    { id: "chat.new",     trigger: "new",     title: "New chat",    description: "Start a fresh conversation" },
    { id: "chat.model",   trigger: "model",   title: "Model",       description: "Open the model selector" },
    { id: "chat.clear",   trigger: "clear",   title: "Clear",       description: "Clear input" },
    // Backend commands always available
    { id: "compact",      trigger: "compact", title: "Compact",     description: "Summarise and compress this session's context" },
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
    if (!id || !childStore) return
    const status = (childStore as any).session_status?.[id]
    if (status?.type === "error" && status.error) {
      const msg = status.error.message ?? JSON.stringify(status.error)
      showToast({ variant: "error", title: "Session error", description: msg })
      setSending(false)
    }
  })

  async function handleSend() {
    const text = inputVal().trim()
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
    // Use directory-scoped client only when we have a valid /workspaces/ path; otherwise
    // let the server default to the authenticated user's workspace (userWorkspaceDir)
    const client = dir ? globalSDK.createClient({ directory: dir, throwOnError: true }) : globalSDK.createClient({ throwOnError: true })
    setSending(true)
    setInputVal("")
    try {
      let sid = chatSessionId()
      if (!sid) {
        const created = await client.session.create().then((x: any) => x.data)
        if (!created?.id) throw new Error("Failed to create session")
        sid = created.id as string
        setChatSessionId(sid)
        void sync?.session.sync(sid)
      }
      const messageID = Identifier.ascending("message")
      await client.session.promptAsync({
        sessionID: sid as string,
        agent: "build",
        model,
        messageID,
        parts: [{ id: Identifier.ascending("part"), type: "text" as const, text }],
      })
      void sync?.session.sync(sid as string)
    } catch (err: any) {
      showToast({ variant: "error", title: "Send failed", description: err?.message ?? "Unknown error" })
      setInputVal(text)
    } finally {
      setSending(false)
    }
  }

  let textareaRef: HTMLTextAreaElement | undefined

  function autoResize() {
    if (!textareaRef) return
    textareaRef.style.height = "auto"
    textareaRef.style.height = Math.min(textareaRef.scrollHeight, 120) + "px"
  }

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%", background: "#f4f4f5", "border-radius": "10px", overflow: "hidden", "font-family": "'Geist', system-ui, sans-serif" }}>

      {/* Head */}
      <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", padding: "14px 18px", "border-bottom": "1px solid #e5e5e5", "flex-shrink": "0", background: "#f4f4f5" }}>
        <button type="button" style={{ display: "flex", "align-items": "center", gap: "8px", background: "none", border: "none", cursor: "pointer", "font-family": "'Geist', system-ui, sans-serif", "font-size": "14px", "font-weight": "500", color: "#0a0a0a", padding: "0" }}>
          {activeChatTitle() ?? "New chat"}
          <span style={{ color: "#737373", display: "inline-flex", "align-items": "center" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </span>
        </button>
        <div style={{ display: "flex", gap: "4px" }}>
          <button type="button" title="New chat" aria-label="New chat" onClick={() => { setChatSessionId(undefined); setSelectedSessionID(undefined); setTab("chat") }} style={actionBtn}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="10" y1="11" x2="14" y2="11"/></svg>
          </button>
          <button type="button" title="Sessions" onClick={() => setTab(tab() === "sessions" ? "chat" : "sessions")} style={{ ...actionBtn, background: tab() === "sessions" ? "rgba(214,138,46,0.08)" : "transparent", color: tab() === "sessions" ? "#d68a2e" : "#525252" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><rect x="11" y="9" width="8" height="6" rx="1" fill="currentColor" opacity="0.3"/></svg>
          </button>
          <button type="button" title="Minimize" onClick={props.onClose} style={actionBtn}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>
      </div>

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
          <Show when={hasMessages()} fallback={
            <>
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
            </>
          }>
            <Show when={childStore && directory()}>
              <DataProvider
                data={childStore as any}
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
        </div>

        {/* Input wrap */}
        <div style={{ margin: "0 14px 14px", border: "1.5px solid #d68a2e", "border-radius": "8px", background: "#ffffff", padding: "10px 12px 8px", display: "flex", "flex-direction": "column", gap: "8px", "flex-shrink": "0", position: "relative" }}>
          {/* Scope pill */}
          <button type="button" style={{ display: "inline-flex", "align-items": "center", gap: "6px", "align-self": "flex-start", padding: "4px 10px", border: "1px solid #e5e5e5", "border-radius": "6px", "font-family": "'Geist', system-ui, sans-serif", "font-size": "12px", color: "#404040", background: "#ffffff", cursor: "pointer" }}>
            <span style={{ display: "inline-flex", color: "#737373" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>
            Scope · this component
          </button>

          {/* Slash command popup */}
          <Show when={slashOpen() && filteredSlash().length > 0}>
            <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: "0", right: "0", background: "#ffffff", border: "1px solid #e5e5e5", "border-radius": "8px", "box-shadow": "0 4px 20px rgba(0,0,0,0.12)", "z-index": "300", overflow: "hidden", "max-height": "240px", "overflow-y": "auto" }}>
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
          </Show>

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
        </div>
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
    <Show when={!chatOpen()}>
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
          background: "#f4f4f5",
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
  return (
    <Portal mount={document.body}>
      <div
        style={{
          position: "fixed",
          top: "68px",
          right: "8px",
          bottom: "8px",
          width: "460px",
          "max-width": "calc(100vw - 16px)",
          "z-index": "70",
          "border-radius": "10px",
          overflow: "hidden",
          background: "#ffffff",
          border: "1px solid #e5e5e5",
          "box-shadow": "-12px 0 32px -16px rgba(0,0,0,0.12)",
          display: "flex",
          "flex-direction": "column",
          transform: chatOpen() ? "translateX(0)" : "translateX(calc(100% + 16px))",
          "pointer-events": chatOpen() ? "auto" : "none",
          transition: "transform 240ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {/* Only mount the panel (which calls useSync) when it's open and inside a SyncProvider context */}
        <Show when={chatOpen()}>
          <SupadenseChatPanel onClose={() => setChatOpen(false)} />
        </Show>
      </div>
    </Portal>
  )
}
