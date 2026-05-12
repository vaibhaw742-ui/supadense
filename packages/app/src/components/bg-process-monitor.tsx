import { createMemo, createSignal, For, onCleanup, onMount, Show, type Accessor } from "solid-js"
import { Popover } from "@opencode-ai/ui/popover"
import { bgProcesses, bgProcessAdd, bgProcessUpdate, bgProcessClear, serverJobs, setServerJobs, serverJobSeenAt, activityEvents, setActivityEvents, type ActivityEvent } from "@/context/bg-processes"
import { useServer } from "@/context/server"
import { useGlobalSDK } from "@/context/global-sdk"
import { getAuthToken } from "@/utils/server"

// Estimated total duration for a memorize/pipeline job (ms)
const ESTIMATED_MS = 2 * 60 * 1000

export function formatEta(startedAt: number): string {
  const elapsed = Date.now() - startedAt
  const remaining = Math.max(0, ESTIMATED_MS - elapsed)
  if (remaining === 0) return "finishing…"
  const secs = Math.round(remaining / 1000)
  if (secs < 60) return `~${secs}s left`
  const mins = Math.floor(secs / 60)
  const s = secs % 60
  return s > 0 ? `~${mins}m ${s}s left` : `~${mins}m left`
}

export function formatElapsed(startedAt: number): string {
  const secs = Math.round((Date.now() - startedAt) / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ago`
}

function formatTimeAgo(ts: number): string {
  return formatElapsed(ts)
}

function eventIcon(eventType: string): string {
  if (eventType === "memorize") return "⊕"
  if (eventType === "resource_removed") return "⊖"
  if (eventType.includes("category_added") || eventType.includes("subcategory_added")) return "◈"
  if (eventType.includes("category_removed") || eventType.includes("subcategory_removed")) return "◉"
  if (eventType.includes("section_added")) return "▤"
  if (eventType.includes("section_removed") || eventType.includes("section_updated")) return "▣"
  if (eventType.includes("concept")) return "◆"
  if (eventType === "wiki_update" || eventType === "wiki_build") return "◎"
  return "·"
}

// ── Shared content component — used by both Popover and slide-in panel ────────

export function BgProcessContent(props: { showHeader?: boolean; onNavigate?: (slug: string | null, resourceId: string | null) => void } = {}) {
  const [tick, setTick] = createSignal(0)
  onMount(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1_000)
    onCleanup(() => clearInterval(t))
  })

  const hasServerJobs = createMemo(() => serverJobs().length > 0)
  const hasQueueJobs = createMemo(() => bgProcesses().length > 0)
  const hasAny = createMemo(() => hasServerJobs() || hasQueueJobs())
  const hasActive = createMemo(
    () => serverJobs().length > 0 || bgProcesses().some((p) => p.status === "processing"),
  )

  return (
    <>
      {/* Header — only shown in popover mode */}
      <Show when={props.showHeader !== false}>
        <div style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          padding: "10px 16px 8px",
          "border-bottom": "1px solid var(--border-weaker-base)",
          "flex-shrink": "0",
        }}>
          <span style={{ "font-size": "13px", "font-weight": "600", color: "var(--text-strong)" }}>
            Background Processes
          </span>
          <Show when={!hasActive() && hasAny()}>
            <button
              style={{ "font-size": "11px", color: "var(--text-weak)", padding: "2px 6px", "border-radius": "4px", border: "none", background: "transparent", cursor: "pointer" }}
              onClick={() => bgProcessClear()}
            >
              Clear done
            </button>
          </Show>
        </div>
      </Show>

      <div style={{ flex: "1", "overflow-y": "auto" }}>
        {/* Server-side pipeline jobs */}
        <For each={serverJobs()}>
          {(job) => {
            const _ = tick()
            const start = serverJobSeenAt.get(job.sessionID) ?? Date.now()
            return (
              <div style={{
                padding: "10px 16px",
                "border-bottom": "1px solid var(--border-weaker-base)",
              }}>
                {/* Job title + status row */}
                <div style={{ display: "flex", "align-items": "flex-start", gap: "10px" }}>
                  <div style={{ "flex-shrink": "0", "padding-top": "2px" }}>
                    <svg style={{ animation: "bgp-spin 1s linear infinite", color: "#f97316" }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                    </svg>
                  </div>
                  <div style={{ flex: "1", "min-width": "0" }}>
                    <div style={{ "font-size": "12px", color: "var(--text-base)", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }} title={job.title}>
                      {job.title}
                    </div>
                    <div style={{ "font-size": "11px", color: "#fb923c", "margin-top": "2px" }}>
                      Processing · {formatEta(start)}
                    </div>
                  </div>
                </div>
                {/* Logs */}
                <Show when={job.logs && job.logs.length > 0}>
                  <div style={{
                    "margin-top": "8px",
                    "margin-left": "23px",
                    background: "var(--background-surface, rgba(0,0,0,0.04))",
                    "border-radius": "6px",
                    padding: "6px 8px",
                    "max-height": "120px",
                    "overflow-y": "auto",
                  }}>
                    <For each={job.logs}>
                      {(line) => (
                        <div style={{
                          "font-size": "10.5px",
                          "font-family": "monospace",
                          color: "var(--text-weak)",
                          "line-height": "1.5",
                          "word-break": "break-word",
                          "white-space": "pre-wrap",
                        }}>
                          {line}
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            )
          }}
        </For>

        {/* Add-source queue */}
        <For each={[...bgProcesses()].reverse()}>
          {(p) => {
            const _ = tick()
            return (
              <div style={{
                display: "flex",
                "align-items": "flex-start",
                gap: "10px",
                padding: "10px 16px",
                "border-bottom": "1px solid var(--border-weaker-base)",
              }}>
                <div style={{ "flex-shrink": "0", "padding-top": "1px" }}>
                  <Show when={p.status === "processing"}>
                    <svg style={{ animation: "bgp-spin 1s linear infinite", color: "#3b82f6" }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                    </svg>
                  </Show>
                  <Show when={p.status === "done"}>
                    <svg style={{ color: "#22c55e" }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  </Show>
                  <Show when={p.status === "error"}>
                    <svg style={{ color: "#ef4444" }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </Show>
                </div>
                <div style={{ flex: "1", "min-width": "0" }}>
                  <div style={{ "font-size": "12px", color: "var(--text-base)", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }} title={p.label}>
                    {p.label}
                  </div>
                  <div style={{
                    "font-size": "11px",
                    "margin-top": "2px",
                    color: p.status === "processing" ? "#60a5fa" : p.status === "done" ? "#22c55e" : "#f87171",
                  }}>
                    {p.status === "processing"
                      ? `Adding · ${formatEta(p.createdAt)}`
                      : p.status === "done"
                      ? `Done · ${formatElapsed(p.createdAt)}`
                      : "Failed"}
                  </div>
                </div>
              </div>
            )
          }}
        </For>

        {/* Empty state */}
        <Show when={!hasAny()}>
          <div style={{ padding: "20px 16px 8px", "text-align": "center", "font-size": "12px", color: "var(--text-weak)" }}>
            No active processes
          </div>
        </Show>

        {/* Activity feed */}
        <Show when={activityEvents().length > 0}>
          <div style={{
            "border-top": hasAny() ? "1px solid var(--border-weaker-base)" : "none",
            "padding-top": "4px",
          }}>
            <div style={{ padding: "8px 16px 4px", "font-size": "11px", "font-weight": "600", color: "var(--text-weak)", "text-transform": "uppercase", "letter-spacing": "0.06em" }}>
              Activity
            </div>
            <For each={activityEvents()}>
              {(event) => {
                const isNavigable = !!(event.nav_slug || event.nav_resource_id) && !!props.onNavigate
                return (
                  <div
                    style={{
                      display: "flex",
                      "align-items": "flex-start",
                      gap: "8px",
                      padding: "5px 16px",
                      cursor: isNavigable ? "pointer" : "default",
                      "border-radius": "6px",
                      transition: "background 0.1s",
                    }}
                    onClick={() => {
                      if (isNavigable) props.onNavigate!(event.nav_slug, event.nav_resource_id)
                    }}
                    onMouseEnter={(e) => { if (isNavigable) (e.currentTarget as HTMLElement).style.background = "var(--surface-raised-base, rgba(0,0,0,0.04))" }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent" }}
                  >
                    <div style={{ "flex-shrink": "0", "padding-top": "3px" }}>
                      {eventIcon(event.event_type)}
                    </div>
                    <div style={{ flex: "1", "min-width": "0" }}>
                      <div style={{
                        "font-size": "12px",
                        color: isNavigable ? "var(--text-base)" : "var(--text-base)",
                        "line-height": "1.4",
                        "word-break": "break-word",
                        "text-decoration": isNavigable ? "underline" : "none",
                        "text-decoration-color": "var(--border-weak-base)",
                        "text-underline-offset": "2px",
                      }}>
                        {event.label}
                      </div>
                      <div style={{ "font-size": "10px", color: "var(--text-weak)", "margin-top": "1px" }}>
                        {formatTimeAgo(event.time_created)}
                      </div>
                    </div>
                  </div>
                )
              }}
            </For>
          </div>
        </Show>
      </div>

      <style>{`
        @keyframes bgp-spin {
          from { transform: rotate(0deg) }
          to   { transform: rotate(360deg) }
        }
      `}</style>
    </>
  )
}

// ── Trigger button + poller ───────────────────────────────────────────────────
// When onOpen is provided, clicking opens the slide-in panel (controlled by parent).
// When onOpen is omitted, falls back to the original inline Popover.

export function BgProcessMonitor(props: { directory: Accessor<string | undefined>; onOpen?: () => void }) {
  const server = useServer()
  const globalSDK = useGlobalSDK()

  function baseUrl() {
    const http = server.current?.http
    if (!http) return "http://localhost:4096"
    return typeof http === "string" ? http : (http as { url: string }).url
  }

  async function pollJobs() {
    const dir = props.directory()
    if (!dir) return
    const token = getAuthToken()
    const headers = {
      "x-opencode-directory": dir,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }
    try {
      const res = await fetch(`${baseUrl()}/wiki/jobs`, { headers })
      if (res.ok) {
        const data = await res.json() as { jobs: { sessionID: string; title: string; status: string; logs: string[] }[] }
        for (const j of data.jobs) {
          if (!serverJobSeenAt.has(j.sessionID)) serverJobSeenAt.set(j.sessionID, Date.now())
        }
        setServerJobs(data.jobs)
      }
    } catch { /* ignore */ }
    try {
      const res = await fetch(`${baseUrl()}/wiki/activity`, { headers })
      if (res.ok) {
        const data = await res.json() as { events: ActivityEvent[] }
        setActivityEvents(data.events)
      }
    } catch { /* ignore */ }
  }

  onMount(() => {
    pollJobs()
    const interval = setInterval(pollJobs, 5_000)
    const stop = globalSDK.event.listen((e) => {
      if (e.details.type === "session.idle") pollJobs()

      if (e.details.type === "command.executed" && (e.details as { name?: string }).name === "memorize") {
        const url = ((e.details as { arguments?: string }).arguments ?? "").trim()
        if (!url) return
        const existing = bgProcesses().find((p) => p.label === url && p.status === "processing")
        if (existing) {
          bgProcessUpdate(existing.id, "done")
        } else {
          const id = bgProcessAdd(url)
          bgProcessUpdate(id, "done")
        }
      }
    })
    onCleanup(() => { clearInterval(interval); stop() })
  })

  const [tick, setTick] = createSignal(0)
  onMount(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1_000)
    onCleanup(() => clearInterval(t))
  })

  const hasAny = createMemo(() => serverJobs().length > 0 || bgProcesses().length > 0)
  const hasActive = createMemo(
    () => serverJobs().length > 0 || bgProcesses().some((p) => p.status === "processing"),
  )
  const hasError = createMemo(() => bgProcesses().some((p) => p.status === "error"))

  const triggerIcon = (
    <>
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
        style={{
          color: hasActive() ? "#3b82f6" : "var(--color-icon-base)",
          opacity: hasAny() ? "1" : "0.45",
        }}
      >
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
      <Show when={hasAny()}>
        <span
          style={{
            position: "absolute",
            top: "6px",
            right: "6px",
            width: "6px",
            height: "6px",
            "border-radius": "50%",
            background: hasActive() ? "#3b82f6" : hasError() ? "#ef4444" : "#22c55e",
          }}
        />
      </Show>
    </>
  )

  // Panel mode — just render the icon button, parent controls the panel
  if (props.onOpen) {
    return (
      <button
        aria-label="Background processes"
        onClick={props.onOpen}
        style={{
          position: "relative",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          width: "40px",
          height: "40px",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          color: "var(--color-icon-base)",
          "border-radius": "8px",
        }}
      >
        {triggerIcon}
      </button>
    )
  }

  // Fallback popover mode (e.g. home page)
  return (
    <Popover
      placement="right-end"
      triggerAs="button"
      triggerProps={{
        "aria-label": "Background processes",
        style: {
          position: "relative",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          width: "40px",
          height: "40px",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          color: "var(--color-icon-base)",
          "border-radius": "8px",
        },
      }}
      trigger={triggerIcon}
      class="[&_[data-slot=popover-body]]:p-0"
    >
      <div style={{ width: "290px", display: "flex", "flex-direction": "column", "max-height": "320px" }}>
        <BgProcessContent />
      </div>
    </Popover>
  )
}
