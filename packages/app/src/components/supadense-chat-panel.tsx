import { createMemo, createSignal, For, Show } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useGlobalSync } from "@/context/global-sync"
import { useSync } from "@/context/sync"
import { decode64 } from "@/utils/base64"
import { PromptInput } from "@/components/prompt-input"
import { chatOpen, setChatOpen } from "@/context/chat-overlay"
import { SessionTurn } from "@opencode-ai/ui/session-turn"
import { sessionTitle } from "@/utils/session-title"
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
  { icon: "M4 6h16M4 12h16M4 18h10", label: "Summarize this view" },
  { icon: "M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M5 5m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M19 5m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M5 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M19 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M10 10l-3-3M14 10l3-3M10 14l-3 3M14 14l3 3", label: "Find what's connected in your graph" },
  { icon: "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01", label: "Quiz me on this cluster" },
  { icon: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2", label: "Surface what's stale" },
  { icon: "M20 6L9 17l-5-5", label: "Compare with what past-you wrote", muted: true },
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

function SupadenseChatPanel(props: { onClose: () => void }) {
  const params = useParams<{ dir?: string; id?: string }>()
  const navigate = useNavigate()
  const globalSync = useGlobalSync()
  const sync = useSync()

  const directory = createMemo(() => {
    const dir = params.dir
    if (!dir) return undefined
    try { return decode64(dir) } catch { return undefined }
  })

  const [childStore] = createMemo(() => {
    const dir = directory()
    if (!dir) return [undefined, undefined] as const
    return globalSync.child(dir, { bootstrap: false })
  })() ?? [undefined]

  type Tab = "chat" | "sessions"
  const [tab, setTab] = createSignal<Tab>("chat")

  // Track which session the panel is viewing (null = follow route param)
  const [selectedSessionID, setSelectedSessionID] = createSignal<string | undefined>(undefined)
  const activeSessionID = createMemo(() => selectedSessionID() ?? params.id)

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
  const userMessages = createMemo(() => messages().filter((m) => m.role === "user"))

  // The title of the session currently shown in the chat tab
  const activeChatTitle = createMemo(() => {
    const id = activeSessionID()
    if (!id || !childStore) return undefined
    const session = (childStore.session ?? []).find((s: Session) => s.id === id)
    return session ? sessionTitle(session.title?.trim()) ?? "New session" : undefined
  })

  function selectSession(id: string) {
    setSelectedSessionID(id)
    setTab("chat")
    // Trigger a sync so messages load if not already in the store
    void sync.session.sync(id)
  }

  return (
    <div style={{
      display: "flex",
      "flex-direction": "column",
      height: "100%",
      background: "var(--color-background-base)",
      "border-radius": "14px",
      overflow: "hidden",
      "font-family": "'Geist', system-ui, sans-serif",
      border: "1px solid var(--color-border-base)",
      "box-shadow": "0 8px 40px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)",
    }}>

      {/* ── Header ── */}
      <div style={{
        display: "flex",
        "align-items": "center",
        padding: "10px 14px 0",
        "border-bottom": "1px solid var(--color-border-base)",
        "flex-shrink": "0",
        gap: "8px",
      }}>
        {/* Back button shown when viewing a selected session in chat tab */}
        <Show when={tab() === "chat" && selectedSessionID()}>
          <button
            type="button"
            onClick={() => { setSelectedSessionID(undefined); setTab("sessions") }}
            style={{ ...headerIconBtn, "margin-bottom": "8px" }}
            aria-label="Back to sessions"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        </Show>

        {/* Tabs */}
        <div style={{ display: "flex", gap: "0", flex: "1" }}>
          {(["chat", "sessions"] as Tab[]).map((t) => (
            <button
              type="button"
              onClick={() => setTab(t)}
              style={{
                background: "none", border: "none", cursor: "pointer",
                padding: "6px 12px 10px",
                "font-size": "13px", "font-weight": tab() === t ? "500" : "400",
                color: tab() === t ? "var(--color-text-strong)" : "var(--color-text-weak)",
                "border-bottom": tab() === t ? "2px solid #d68a2e" : "2px solid transparent",
                "margin-bottom": "-1px",
                transition: "color 100ms, border-color 100ms",
                "font-family": "inherit",
                "text-transform": "capitalize",
              }}
            >
              {t}
            </button>
          ))}
        </div>

        <button
          type="button"
          title="New session"
          aria-label="New session"
          onClick={() => {
            setSelectedSessionID(undefined)
            setTab("chat")
            navigate(`/${params.dir}/session`)
          }}
          style={{ ...headerIconBtn, "margin-bottom": "8px" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
        <button type="button" onClick={props.onClose} style={{ ...headerIconBtn, "margin-bottom": "8px" }} aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      </div>

      {/* ── Sessions tab ── */}
      <Show when={tab() === "sessions"}>
        <Show
          when={directory()}
          fallback={
            <div style={{ flex: "1", display: "flex", "align-items": "center", "justify-content": "center", color: "var(--color-text-weak)", "font-size": "13px" }}>
              Open a workspace first
            </div>
          }
        >
          <SupadenseSessionsList
            directory={directory()!}
            activeSessionID={activeSessionID()}
            onSelect={selectSession}
          />
        </Show>
      </Show>

      {/* ── Chat tab ── */}
      <Show when={tab() === "chat"}>
        {/* Session title when browsing a non-route session */}
        <Show when={selectedSessionID() && activeChatTitle()}>
          <div style={{
            padding: "6px 14px",
            "font-size": "12px",
            color: "var(--color-text-weak)",
            "border-bottom": "1px solid var(--color-border-base)",
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
            "flex-shrink": "0",
          }}>
            {activeChatTitle()}
          </div>
        </Show>

        {/* Messages */}
        <div style={{ flex: "1", "min-height": "0", "overflow-y": "auto", display: "flex", "flex-direction": "column" }}>
          <Show
            when={hasMessages()}
            fallback={
              <div style={{ padding: "28px 20px 16px", display: "flex", "flex-direction": "column", gap: "0" }}>
                <SupadenseMark size={36} />
                <p style={{
                  margin: "18px 0 24px",
                  "font-size": "20px",
                  "font-weight": "500",
                  "line-height": "1.25",
                  "letter-spacing": "-0.02em",
                  color: "var(--color-text-strong)",
                }}>
                  Ask past-you, or ask the{" "}
                  <span style={{ color: "#d68a2e" }}>graph.</span>
                </p>
                <div style={{ display: "flex", "flex-direction": "column", gap: "0" }}>
                  <For each={SUGGESTIONS}>
                    {(s) => (
                      <button
                        type="button"
                        style={{
                          display: "flex", "align-items": "center", gap: "14px",
                          background: "none", border: "none", cursor: s.muted ? "default" : "pointer",
                          "font-family": "inherit", "font-size": "14px",
                          color: s.muted ? "var(--color-text-weak)" : "var(--color-text-strong)",
                          padding: "11px 0",
                          "border-bottom": "1px solid var(--color-border-base)",
                          "text-align": "left", width: "100%",
                          transition: "color 120ms",
                        }}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style={{ "flex-shrink": "0", opacity: s.muted ? "0.4" : "0.6" }}>
                          <path d={s.icon} />
                        </svg>
                        {s.label}
                      </button>
                    )}
                  </For>
                </div>
              </div>
            }
          >
            <div style={{ padding: "8px 0 8px", display: "flex", "flex-direction": "column" }}>
              <For each={userMessages()}>
                {(msg) => (
                  <SessionTurn
                    sessionID={activeSessionID() ?? ""}
                    messageID={msg.id}
                    active={isActive()}
                    classes={{
                      root: "min-w-0 w-full relative",
                      content: "flex flex-col justify-between !overflow-visible",
                      container: "w-full px-3",
                    }}
                  />
                )}
              </For>
            </div>
          </Show>
        </div>

        {/* Input */}
        <div style={{ "flex-shrink": "0", padding: "0 8px 8px" }}>
          <PromptInput onSubmit={() => {}} />
        </div>
      </Show>
    </div>
  )
}

/** Global FAB — lives in layout.tsx (visible on all pages) */
export function SupadenseFAB() {
  return (
    <button
      type="button"
      title="Ask supadense"
      aria-label="Ask supadense"
      onClick={() => setChatOpen((v) => !v)}
      style={{
        position: "fixed",
        bottom: "28px",
        right: "28px",
        width: "56px",
        height: "56px",
        "border-radius": "50%",
        background: chatOpen() ? "var(--color-surface-raised-base)" : "var(--color-background-base)",
        border: chatOpen() ? "1px solid rgba(228,166,74,0.4)" : "1px solid var(--color-border-base)",
        "box-shadow": chatOpen()
          ? "0 4px 24px rgba(0,0,0,0.55), 0 0 20px rgba(228,166,74,0.3)"
          : "0 4px 20px rgba(0,0,0,0.4)",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        cursor: "pointer",
        "z-index": "100",
        transition: "border-color 160ms, box-shadow 160ms, background 160ms",
        padding: "0",
      }}
    >
      <SupadenseMark size={26} />
    </button>
  )
}

/** Floating panel — lives inside SessionRoute so all providers are available */
export function SupadenseChatOverlay() {
  return (
    <div
      style={{
        position: "fixed",
        bottom: "96px",
        right: "28px",
        width: "420px",
        height: "600px",
        "z-index": "99",
        "border-radius": "14px",
        overflow: "hidden",
        "pointer-events": chatOpen() ? "auto" : "none",
        opacity: chatOpen() ? "1" : "0",
        transform: chatOpen() ? "translateY(0) scale(1)" : "translateY(16px) scale(0.97)",
        transition: "opacity 180ms ease, transform 180ms ease",
      }}
    >
      <Show when={chatOpen()}>
        <SupadenseChatPanel onClose={() => setChatOpen(false)} />
      </Show>
    </div>
  )
}

const headerIconBtn: Record<string, string> = {
  background: "none", border: "none", cursor: "pointer",
  color: "var(--color-text-weak)", padding: "5px", "border-radius": "6px",
  display: "flex", "align-items": "center", "justify-content": "center",
  transition: "background 100ms, color 100ms",
}
