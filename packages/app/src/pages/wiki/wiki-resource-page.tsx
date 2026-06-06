import { createResource, createSignal, onCleanup, Show } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useWikiApi } from "./wiki-api"
import { renderMarkdown } from "./markdown"
import "./wiki.css"

function modalityLabel(modality: string): string {
  switch (modality.toLowerCase()) {
    case "youtube": return "YouTube"
    case "pdf": return "PDF"
    case "image": return "Image"
    case "linkedin": return "LinkedIn"
    case "url": return "Web page"
    case "text": return "Text"
    default: return modality
  }
}

function modalityIcon(modality: string): string {
  switch (modality.toLowerCase()) {
    case "youtube": return "▶"
    case "pdf": return "◧"
    case "image": return "⊡"
    case "linkedin": return "◉"
    default: return "⊕"
  }
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function StatusBanner(props: { status: string }) {
  const isProcessing = () => props.status === "pending" || props.status === "processing"
  const isFailed = () => props.status === "failed"

  return (
    <Show when={isProcessing() || isFailed()}>
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "10px 16px",
          "border-radius": "8px",
          "margin-bottom": "20px",
          background: isFailed()
            ? "var(--surface-error, rgba(239,68,68,0.08))"
            : "var(--surface-raised, rgba(99,102,241,0.08))",
          color: isFailed()
            ? "var(--text-error, #ef4444)"
            : "var(--text-weak, #888)",
          "font-size": "13px",
        }}
      >
        <Show when={isProcessing()}>
          <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span>
          <span>Processing resource — content will appear when ready.</span>
        </Show>
        <Show when={isFailed()}>
          <span>⚠</span>
          <span>Processing failed for this resource.</span>
        </Show>
      </div>
    </Show>
  )
}

export default function WikiResourcePage() {
  const api = useWikiApi()
  const navigate = useNavigate()
  const params = useParams<{ dir: string; id: string }>()
  const [sidebarOpen, setSidebarOpen] = createSignal(true)

  const [data, { refetch }] = createResource(() => params.id, (id) => api.resource(id))

  // Poll while processing
  let interval: ReturnType<typeof setInterval> | undefined

  const startPolling = () => {
    if (interval) return
    interval = setInterval(() => {
      const d = data()
      const status = d?.status
      if (status === "done" || status === "failed") {
        clearInterval(interval)
        interval = undefined
        return
      }
      refetch()
    }, 3000)
  }

  const checkAndPoll = () => {
    const d = data()
    if (!d) return
    if (d.status !== "done" && d.status !== "failed") startPolling()
  }

  onCleanup(() => {
    if (interval) clearInterval(interval)
  })

  return (
    <div class="wk-root">
      <div class="wk-layout">

        {/* ── Sidebar ── */}
        <aside class={`wk-sidebar${sidebarOpen() ? "" : " wk-sidebar--collapsed"}`}>
          <div class="wk-sb-top">
            <Show when={sidebarOpen()}>
              <span class="wk-logo wk-sb-logo" onClick={() => navigate(`/${params.dir}/wiki`)}>Supadense</span>
            </Show>
            <button
              class="wk-sb-collapse-btn"
              title={sidebarOpen() ? "Collapse sidebar" : "Expand sidebar"}
              onClick={() => setSidebarOpen((v) => !v)}
            >
              {sidebarOpen() ? "◀" : "▶"}
            </button>
          </div>

          <Show when={sidebarOpen() && data()}>
            {(d) => (
              <div class="wk-sb-nav">
                <div class="wk-sb-label" style={{ "margin-top": "8px" }}>Resource</div>
                <div class="wk-sb-stat">{modalityLabel(d().modality)}</div>
                <Show when={d().author}>
                  <div class="wk-sb-stat">By {d().author}</div>
                </Show>
                <div class="wk-sb-stat">Added {formatDate(d().time_created)}</div>
                {/* Status badge */}
                <div class="wk-sb-stat" style={{
                  color: d().status === "done"
                    ? "var(--text-success, #22c55e)"
                    : d().status === "failed"
                      ? "var(--text-error, #ef4444)"
                      : "var(--text-weak, #888)",
                }}>
                  {d().status === "done" ? "✓ Processed"
                    : d().status === "failed" ? "✗ Failed"
                    : "⟳ Processing…"}
                </div>
                <Show when={d().url}>
                  {(url) => (
                    <a class="wk-sb-link" href={url()} target="_blank" rel="noopener noreferrer">
                      Open source ↗
                    </a>
                  )}
                </Show>
              </div>
            )}
          </Show>
        </aside>

        {/* ── Content area ── */}
        <div class="wk-content-area">
          <main class="wk-main">
            <Show when={data.loading}>
              <div class="wk-loading">Loading resource…</div>
            </Show>

            <Show when={data.error}>
              <div class="wk-loading">Resource not found.</div>
            </Show>

            <Show when={data()} keyed>
              {(d) => {
                checkAndPoll()
                return (
                  <div class="wk-page-content">
                    {/* Breadcrumb */}
                    <div class="wk-breadcrumb">
                      <span class="wk-breadcrumb-link" onClick={() => navigate(`/${params.dir}/wiki`)}>Supadense</span>
                      <span class="wk-breadcrumb-sep">›</span>
                      <span class="wk-breadcrumb-link" onClick={() => navigate(`/${params.dir}/wiki`)}>Resources</span>
                      <span class="wk-breadcrumb-sep">›</span>
                      <span class="wk-breadcrumb-current">{d.title || d.url || "Resource"}</span>
                    </div>

                    {/* Title */}
                    <h1 class="wk-page-title">{d.title || d.url || "Resource"}</h1>

                    {/* Meta row */}
                    <div class="wk-page-meta">
                      <span>{modalityIcon(d.modality)} {modalityLabel(d.modality)}</span>
                      <Show when={d.author}>
                        <span>·</span>
                        <span>{d.author}</span>
                      </Show>
                      <Show when={d.url}>
                        <span>·</span>
                        <a
                          href={d.url!}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: "var(--color-text-link, #6366f1)" }}
                        >
                          {(() => {
                            try { return new URL(d.url!).hostname.replace(/^www\./, "") } catch { return d.url }
                          })()}
                          {" ↗"}
                        </a>
                      </Show>
                      <span>·</span>
                      <span>Added {formatDate(d.time_created)}</span>
                    </div>

                    {/* Processing / failed banner */}
                    <StatusBanner status={d.status} />

                    {/* Content — only shown when processed */}
                    <Show when={d.status === "done"}>
                      <Show
                        when={d.content}
                        fallback={
                          <div class="wk-prose" style={{ color: "var(--color-text-dim)", "font-style": "italic", "margin-top": "24px" }}>
                            No content available for this resource.
                          </div>
                        }
                      >
                        {(content) => (
                          <div
                            class="wk-prose wk-tab-pane"
                            innerHTML={renderMarkdown(content())}
                          />
                        )}
                      </Show>
                    </Show>

                  </div>
                )
              }}
            </Show>
          </main>
        </div>
      </div>
    </div>
  )
}
