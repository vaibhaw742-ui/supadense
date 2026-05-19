import { createMemo, createSignal, For, Show } from "solid-js"
import { useParams } from "@solidjs/router"
import { useGlobalSync } from "@/context/global-sync"
import { useGlobalSDK } from "@/context/global-sdk"
import { decode64 } from "@/utils/base64"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"

function partText(parts: Part[] | undefined): string {
  if (!parts) return ""
  return parts
    .filter((p) => (p as any).type === "text")
    .map((p) => (p as any).text ?? (p as any).content ?? "")
    .join("")
    .trim()
}

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

export function SupadenseChatPanel(props: { onClose: () => void }) {
  const params = useParams<{ dir?: string; id?: string }>()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()

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

  const messages = createMemo((): Message[] => {
    const id = params.id
    if (!id || !childStore) return []
    return (childStore as any).message?.[id] ?? []
  })

  const parts = createMemo(() => {
    if (!childStore) return {} as Record<string, Part[]>
    return (childStore as any).part ?? {}
  })

  const isActive = createMemo(() => {
    const id = params.id
    if (!id || !childStore) return false
    const status = (childStore as any).session_status?.[id]
    return status?.type !== "idle" && status !== undefined
  })

  const inSession = createMemo(() => !!params.dir && !!params.id)

  const [input, setInput] = createSignal("")
  const [sending, setSending] = createSignal(false)

  async function send() {
    const text = input().trim()
    const sessionID = params.id
    const dir = directory()
    if (!text || !sessionID || !dir || sending()) return

    // Derive model from last user message, or from child store config
    const msgs = messages()
    const lastUserMsg = [...msgs].reverse().find((m) => m.role === "user")
    const model = lastUserMsg?.model
      ?? (() => {
        const cfgModel = (childStore as any)?.config?.model as string | undefined
        if (!cfgModel) return undefined
        const [providerID, modelID] = cfgModel.split("/")
        return providerID && modelID ? { providerID, modelID } : undefined
      })()

    setSending(true)
    setInput("")
    try {
      await globalSDK.client.session.promptAsync({
        sessionID,
        directory: dir,
        model,
        parts: [{ type: "text", text }],
      })
    } catch {
      // session error handling covers this
    } finally {
      setSending(false)
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  const hasMessages = createMemo(() => messages().length > 0)

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
        padding: "11px 14px",
        "border-bottom": "1px solid var(--color-border-base)",
        "flex-shrink": "0",
        gap: "8px",
      }}>
        <button type="button" style={{
          display: "flex", "align-items": "center", gap: "6px",
          background: "none", border: "none", cursor: "pointer",
          color: "var(--color-text-strong)", "font-size": "14px", "font-weight": "500",
          padding: "2px 4px", "border-radius": "6px", "font-family": "inherit",
          flex: "1",
        }}>
          New chat
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        <div style={{ display: "flex", "align-items": "center", gap: "2px" }}>
          <button type="button" style={headerIconBtn}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </button>
          <button type="button" style={headerIconBtn}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/>
            </svg>
          </button>
          <button type="button" onClick={props.onClose} style={headerIconBtn} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ── Body ── */}
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
                      onClick={() => !s.muted && setInput(s.label)}
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
              <Show when={!inSession()}>
                <p style={{ "font-size": "12px", color: "var(--color-text-weak)", "margin-top": "20px", "font-family": "'Geist Mono', monospace", "letter-spacing": "0.04em" }}>
                  Open a session to start chatting
                </p>
              </Show>
            </div>
          }
        >
          <div style={{ padding: "16px", display: "flex", "flex-direction": "column", gap: "14px", flex: "1" }}>
            <For each={messages()}>
              {(msg) => {
                const msgParts = createMemo(() => parts()[msg.id] as Part[] | undefined)
                const text = createMemo(() => partText(msgParts()))
                const isUser = msg.role === "user"
                return (
                  <div style={{ display: "flex", "flex-direction": "column", gap: "4px", "align-items": isUser ? "flex-end" : "flex-start" }}>
                    <div style={{ "font-size": "10px", "font-family": "'Geist Mono', monospace", "letter-spacing": "0.08em", "text-transform": "uppercase", color: isUser ? "#d68a2e" : "var(--color-text-weak)", padding: "0 2px" }}>
                      {isUser ? "you" : "supadense"}
                    </div>
                    <div style={{
                      "max-width": "88%", padding: "8px 12px",
                      "border-radius": isUser ? "10px 10px 2px 10px" : "10px 10px 10px 2px",
                      background: isUser ? "rgba(214,138,46,0.12)" : "var(--color-surface-raised-base)",
                      border: isUser ? "1px solid rgba(214,138,46,0.25)" : "1px solid var(--color-border-base)",
                      "font-size": "13px", "line-height": "1.5", color: "var(--color-text-strong)",
                      "word-break": "break-word", "white-space": "pre-wrap",
                    }}>
                      <Show when={text()} fallback={<span style={{ color: "var(--color-text-weak)", "font-style": "italic" }}>thinking…</span>}>
                        {text()}
                      </Show>
                    </div>
                  </div>
                )
              }}
            </For>
            <Show when={isActive()}>
              <div style={{ display: "flex", "align-items": "center", gap: "6px", padding: "4px 2px", "font-family": "'Geist Mono', monospace", "font-size": "10px", color: "#d68a2e", "letter-spacing": "0.06em" }}>
                <span style={{ width: "5px", height: "5px", "border-radius": "50%", background: "#d68a2e", display: "inline-block" }} />
                working…
              </div>
            </Show>
          </div>
        </Show>
      </div>

      {/* ── Input ── */}
      <div style={{ "flex-shrink": "0", padding: "12px 14px 14px" }}>
        <div style={{
          border: `1.5px solid ${input().trim() ? "#d68a2e" : "var(--color-border-base)"}`,
          "border-radius": "10px",
          background: "var(--color-background-base)",
          transition: "border-color 150ms",
          overflow: "hidden",
        }}>
          <div style={{ padding: "9px 12px 0", display: "flex", gap: "8px", "align-items": "center" }}>
            <div style={{
              display: "inline-flex", "align-items": "center", gap: "5px",
              background: "var(--color-surface-raised-base)",
              border: "1px solid var(--color-border-base)",
              "border-radius": "6px",
              padding: "3px 8px",
              "font-size": "11px",
              "font-family": "'Geist Mono', monospace",
              color: "var(--color-text-weak)",
              "letter-spacing": "0.04em",
            }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
              Scope · this view
            </div>
          </div>
          <textarea
            value={input()}
            onInput={(e) => setInput(e.currentTarget.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask anything in your knowledge…"
            disabled={sending()}
            rows={2}
            style={{
              display: "block", width: "100%", background: "none", border: "none",
              padding: "8px 12px 6px",
              color: "var(--color-text-strong)",
              "font-family": "'Geist', system-ui, sans-serif",
              "font-size": "13px", "line-height": "1.45",
              resize: "none", outline: "none",
              "box-sizing": "border-box",
            }}
          />
          <div style={{ display: "flex", "align-items": "center", padding: "6px 10px 8px", gap: "6px" }}>
            <button type="button" style={toolbarIconBtn} aria-label="Attach">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
            <button type="button" style={toolbarIconBtn} aria-label="Options">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>
                <circle cx="4" cy="6" r="2" fill="currentColor"/><circle cx="6" cy="12" r="2" fill="currentColor"/><circle cx="4" cy="18" r="2" fill="currentColor"/>
              </svg>
            </button>
            <span style={{ flex: "1" }} />
            <span style={{ "font-size": "11px", color: "var(--color-text-weak)", "font-family": "'Geist Mono', monospace", "letter-spacing": "0.04em" }}>Auto</span>
            <button type="button" style={toolbarIconBtn} aria-label="Voice">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>
              </svg>
            </button>
            <button
              type="button"
              onClick={() => void send()}
              disabled={!input().trim() || sending() || !inSession()}
              style={{
                width: "26px", height: "26px", "border-radius": "7px",
                background: input().trim() && inSession() ? "#d68a2e" : "var(--color-surface-raised-base)",
                border: "none", cursor: input().trim() && inSession() ? "pointer" : "default",
                display: "flex", "align-items": "center", "justify-content": "center",
                transition: "background 120ms",
                "flex-shrink": "0",
              }}
              aria-label="Send"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={input().trim() && inSession() ? "#fff" : "var(--color-text-weak)"} stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const headerIconBtn: Record<string, string> = {
  background: "none", border: "none", cursor: "pointer",
  color: "var(--color-text-weak)", padding: "5px", "border-radius": "6px",
  display: "flex", "align-items": "center", "justify-content": "center",
  transition: "background 100ms, color 100ms",
}

const toolbarIconBtn: Record<string, string> = {
  background: "none", border: "none", cursor: "pointer",
  color: "var(--color-text-weak)", padding: "4px", "border-radius": "5px",
  display: "flex", "align-items": "center", "justify-content": "center",
}
