import {
  createMemo,
  createSignal,
  For,
  Match,
  Show,
  Switch,
  type Accessor,
} from "solid-js"
import { useLocation, useParams } from "@solidjs/router"
import { useGlobalSync } from "@/context/global-sync"
import { useSDK } from "@/context/sdk"
import { useLocal } from "@/context/local"
import { decode64 } from "@/utils/base64"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"

// Extract plaintext from message parts
function partText(parts: Part[] | undefined): string {
  if (!parts) return ""
  return parts
    .filter((p) => (p as any).type === "text")
    .map((p) => (p as any).text ?? (p as any).content ?? "")
    .join("")
    .trim()
}

// Supadense 4×4 mark grid used as the FAB icon
export function SupadenseMark(props: { size?: number; class?: string }) {
  const s = props.size ?? 20
  const cellSize = s / 4
  const gap = s > 40 ? 2 : 1.5
  // Amber cells: (row1,col1), (row1,col3), (row2,col2), (row3,col0)
  const amberSet = new Set([1, 6, 10, 12])
  return (
    <svg
      width={s}
      height={s}
      viewBox={`0 0 ${s} ${s}`}
      class={props.class}
      aria-hidden="true"
    >
      <For each={Array.from({ length: 16 }, (_, i) => i)}>
        {(i) => {
          const row = Math.floor(i / 4)
          const col = i % 4
          const x = col * (cellSize + gap / 2)
          const y = row * (cellSize + gap / 2)
          const fill = amberSet.has(i) ? "#e4a64a" : "currentColor"
          return (
            <rect
              x={x}
              y={y}
              width={cellSize - gap / 2}
              height={cellSize - gap / 2}
              fill={fill}
              rx="0.5"
            />
          )
        }}
      </For>
    </svg>
  )
}

export function SupadenseChatPanel(props: {
  onClose: () => void
}) {
  const location = useLocation()
  const params = useParams<{ dir?: string; id?: string }>()
  const globalSync = useGlobalSync()
  const sdk = useSDK()
  const local = useLocal()

  const inSession = createMemo(() => !!params.dir && !!params.id)
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
    if (!childStore) return {}
    return (childStore as any).part ?? {}
  })

  const isActive = createMemo(() => {
    const id = params.id
    if (!id || !childStore) return false
    const status = (childStore as any).session_status?.[id]
    return status?.type !== "idle" && status !== undefined
  })

  const [input, setInput] = createSignal("")
  const [sending, setSending] = createSignal(false)

  async function send() {
    const text = input().trim()
    if (!text || !params.id || sending()) return
    const sessionID = params.id
    const model = local.model.current()
    if (!model) return
    setSending(true)
    setInput("")
    try {
      await sdk.client.session.promptAsync({
        sessionID,
        agent: local.agent.current() ?? "coder",
        model,
        parts: [{ type: "text", text }],
      } as any)
    } catch {
      // silently fail — existing session error handling covers this
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

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        background: "var(--color-background-base)",
        "border-left": "1px solid var(--color-border-base)",
        "border-radius": "12px 12px 12px 12px",
        overflow: "hidden",
        "font-family": "'Geist', system-ui, sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          padding: "12px 14px",
          "border-bottom": "1px solid var(--color-border-base)",
          gap: "10px",
          "flex-shrink": "0",
        }}
      >
        <SupadenseMark size={16} />
        <span
          style={{
            "font-family": "'Geist Mono', monospace",
            "font-size": "11px",
            "letter-spacing": "0.1em",
            "text-transform": "uppercase",
            color: "var(--color-text-weak)",
            flex: "1",
          }}
        >
          supadense
        </span>
        <button
          type="button"
          onClick={props.onClose}
          style={{
            background: "none",
            border: "none",
            color: "var(--color-text-weak)",
            cursor: "pointer",
            "font-size": "14px",
            padding: "4px 6px",
            "border-radius": "4px",
            "line-height": "1",
          }}
          aria-label="Close chat"
        >
          ✕
        </button>
      </div>

      {/* Messages */}
      <div
        style={{
          flex: "1",
          "min-height": "0",
          "overflow-y": "auto",
          padding: "16px 14px",
          display: "flex",
          "flex-direction": "column",
          gap: "16px",
        }}
      >
        <Show
          when={inSession()}
          fallback={
            <div
              style={{
                display: "flex",
                "flex-direction": "column",
                "align-items": "center",
                "justify-content": "center",
                height: "100%",
                gap: "12px",
                color: "var(--color-text-weak)",
                "text-align": "center",
                padding: "0 24px",
              }}
            >
              <SupadenseMark size={32} />
              <p
                style={{
                  "font-family": "'Geist Mono', monospace",
                  "font-size": "11px",
                  "letter-spacing": "0.06em",
                  "text-transform": "uppercase",
                  margin: "0",
                }}
              >
                Open a KB session to start chatting
              </p>
            </div>
          }
        >
          <For
            each={messages()}
            fallback={
              <div
                style={{
                  "font-family": "'Geist Mono', monospace",
                  "font-size": "11px",
                  color: "var(--color-text-weak)",
                  "text-align": "center",
                  "padding-top": "32px",
                  "letter-spacing": "0.06em",
                }}
              >
                No messages yet
              </div>
            }
          >
            {(msg) => {
              const msgParts = createMemo(() => parts()[msg.id] as Part[] | undefined)
              const text = createMemo(() => partText(msgParts()))
              const isUser = msg.role === "user"
              return (
                <div
                  style={{
                    display: "flex",
                    "flex-direction": "column",
                    gap: "4px",
                    "align-items": isUser ? "flex-end" : "flex-start",
                  }}
                >
                  <div
                    style={{
                      "font-family": "'Geist Mono', monospace",
                      "font-size": "9px",
                      "letter-spacing": "0.1em",
                      "text-transform": "uppercase",
                      color: isUser ? "var(--color-primary)" : "var(--color-text-weak)",
                      padding: "0 2px",
                    }}
                  >
                    {isUser ? "you" : "supadense"}
                  </div>
                  <div
                    style={{
                      "max-width": "88%",
                      padding: "8px 12px",
                      "border-radius": isUser ? "10px 10px 2px 10px" : "10px 10px 10px 2px",
                      background: isUser
                        ? "rgba(228,166,74,0.15)"
                        : "var(--color-surface-raised-base)",
                      "border": isUser
                        ? "1px solid rgba(228,166,74,0.3)"
                        : "1px solid var(--color-border-base)",
                      "font-size": "13px",
                      "line-height": "1.5",
                      color: "var(--color-text-strong)",
                      "word-break": "break-word",
                      "white-space": "pre-wrap",
                    }}
                  >
                    <Show when={text()} fallback={
                      <span style={{ color: "var(--color-text-weak)", "font-style": "italic" }}>
                        thinking…
                      </span>
                    }>
                      {text()}
                    </Show>
                  </div>
                </div>
              )
            }}
          </For>
          <Show when={isActive()}>
            <div
              style={{
                display: "flex",
                "align-items": "center",
                gap: "6px",
                padding: "8px 2px",
                "font-family": "'Geist Mono', monospace",
                "font-size": "10px",
                color: "var(--color-primary)",
                "letter-spacing": "0.06em",
              }}
            >
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  "border-radius": "50%",
                  background: "var(--color-primary)",
                  animation: "pulse 1.5s ease-in-out infinite",
                }}
              />
              working…
            </div>
          </Show>
        </Show>
      </div>

      {/* Input */}
      <div
        style={{
          "flex-shrink": "0",
          padding: "10px 12px",
          "border-top": "1px solid var(--color-border-base)",
          display: "flex",
          "flex-direction": "column",
          gap: "8px",
        }}
      >
        <textarea
          value={input()}
          onInput={(e) => setInput(e.currentTarget.value)}
          onKeyDown={onKeyDown}
          placeholder={
            inSession()
              ? "Ask past-you anything…"
              : "Open a session first"
          }
          disabled={!inSession() || sending()}
          rows={3}
          style={{
            width: "100%",
            background: "var(--color-background-input)",
            border: "1px solid var(--color-border-base)",
            "border-radius": "6px",
            padding: "8px 10px",
            color: "var(--color-text-strong)",
            "font-family": "'Geist', system-ui, sans-serif",
            "font-size": "13px",
            "line-height": "1.4",
            resize: "none",
            outline: "none",
            "box-sizing": "border-box",
          }}
        />
        <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}>
          <span
            style={{
              "font-family": "'Geist Mono', monospace",
              "font-size": "10px",
              color: "var(--color-text-weak)",
              "letter-spacing": "0.04em",
            }}
          >
            ↵ send · shift+↵ newline
          </span>
          <button
            type="button"
            onClick={() => void send()}
            disabled={!inSession() || !input().trim() || sending()}
            style={{
              background: input().trim() && inSession() ? "#e4a64a" : "var(--color-surface-raised-base)",
              color: input().trim() && inSession() ? "#131010" : "var(--color-text-weak)",
              border: "none",
              "border-radius": "6px",
              padding: "5px 14px",
              "font-family": "'Geist', system-ui, sans-serif",
              "font-size": "12px",
              "font-weight": "600",
              cursor: input().trim() && inSession() ? "pointer" : "default",
              transition: "all 80ms",
            }}
          >
            {sending() ? "…" : "Ask →"}
          </button>
        </div>
      </div>
    </div>
  )
}
