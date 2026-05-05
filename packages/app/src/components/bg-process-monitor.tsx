import { createMemo, createSignal, For, onCleanup, onMount, Show, type Accessor } from "solid-js"
import { Popover } from "@opencode-ai/ui/popover"
import { bgProcesses, bgProcessClear } from "@/context/bg-processes"
import { useServer } from "@/context/server"
import { useGlobalSDK } from "@/context/global-sdk"
import { getAuthToken } from "@/utils/server"

// Estimated total duration for a memorize/pipeline job (ms)
const ESTIMATED_MS = 2 * 60 * 1000

function formatEta(startedAt: number): string {
  const elapsed = Date.now() - startedAt
  const remaining = Math.max(0, ESTIMATED_MS - elapsed)
  if (remaining === 0) return "finishing…"
  const secs = Math.round(remaining / 1000)
  if (secs < 60) return `~${secs}s left`
  const mins = Math.floor(secs / 60)
  const s = secs % 60
  return s > 0 ? `~${mins}m ${s}s left` : `~${mins}m left`
}

function formatElapsed(startedAt: number): string {
  const secs = Math.round((Date.now() - startedAt) / 1000)
  if (secs < 60) return `${secs}s ago`
  return `${Math.floor(secs / 60)}m ${secs % 60}s ago`
}

interface ServerJob { sessionID: string; title: string; status: string }

export function BgProcessMonitor(props: { directory: Accessor<string | undefined> }) {
  const server = useServer()
  const globalSDK = useGlobalSDK()

  function baseUrl() {
    const http = server.current?.http
    if (!http) return "http://localhost:4096"
    return typeof http === "string" ? http : (http as { url: string }).url
  }

  const [serverJobs, setServerJobs] = createSignal<ServerJob[]>([])
  // Track first-seen timestamp for ETA
  const seenAt = new Map<string, number>()

  async function pollJobs() {
    const dir = props.directory()
    if (!dir) return
    const token = getAuthToken()
    try {
      const res = await fetch(`${baseUrl()}/wiki/jobs`, {
        headers: {
          "x-opencode-directory": dir,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })
      if (!res.ok) return
      const data = await res.json() as { jobs: ServerJob[] }
      // Record first-seen time for new jobs
      for (const j of data.jobs) {
        if (!seenAt.has(j.sessionID)) seenAt.set(j.sessionID, Date.now())
      }
      setServerJobs(data.jobs)
    } catch { /* ignore */ }
  }

  onMount(() => {
    pollJobs()
    const interval = setInterval(pollJobs, 4_000)
    const stop = globalSDK.event.listen((e) => {
      if (e.details.type === "session.idle") pollJobs()
    })
    onCleanup(() => { clearInterval(interval); stop() })
  })

  // Ticker to refresh ETA text every second while jobs are running
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
  const hasError = createMemo(() => bgProcesses().some((p) => p.status === "error"))

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
      trigger={
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
              color: hasActive() ? "#3b82f6" : hasAny() ? "var(--color-icon-base)" : "var(--color-icon-base)",
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
      }
      class="[&_[data-slot=popover-body]]:p-0"
    >
      <div style={{ width: "290px" }}>
        {/* Header */}
        <div style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          padding: "10px 12px 8px",
          "border-bottom": "1px solid var(--border-weaker-base)",
        }}>
          <span style={{ "font-size": "12px", "font-weight": "600", color: "var(--text-strong)" }}>
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

        <div style={{ "max-height": "260px", "overflow-y": "auto" }}>
          {/* Server-side pipeline jobs */}
          <For each={serverJobs()}>
            {(job) => {
              const _ = tick() // subscribe to ticker for live ETA
              const start = seenAt.get(job.sessionID) ?? Date.now()
              return (
                <div style={{
                  display: "flex",
                  "align-items": "flex-start",
                  gap: "10px",
                  padding: "9px 12px",
                  "border-bottom": "1px solid var(--border-weaker-base)",
                }}>
                  <div style={{ "flex-shrink": "0", "padding-top": "1px" }}>
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
                  padding: "9px 12px",
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
            <div style={{ padding: "16px 12px", "text-align": "center", "font-size": "12px", color: "var(--text-weak)" }}>
              No background processes
            </div>
          </Show>
        </div>

        <style>{`
          @keyframes bgp-spin {
            from { transform: rotate(0deg) }
            to   { transform: rotate(360deg) }
          }
        `}</style>
      </div>
    </Popover>
  )
}
