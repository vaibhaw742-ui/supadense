import { createResource, createSignal, Show } from "solid-js"
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

export default function WikiResourcePage() {
  const api = useWikiApi()
  const navigate = useNavigate()
  const params = useParams<{ dir: string; id: string }>()
  const [sidebarOpen, setSidebarOpen] = createSignal(true)

  const [data] = createResource(() => params.id, (id) => api.resource(id))

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

            <Show when={data()}>
              {(d) => (
                <div class="wk-page-content">
                  {/* Breadcrumb */}
                  <div class="wk-breadcrumb">
                    <span class="wk-breadcrumb-link" onClick={() => navigate(`/${params.dir}/wiki`)}>Supadense</span>
                    <span class="wk-breadcrumb-sep">›</span>
                    <span class="wk-breadcrumb-link" onClick={() => navigate(`/${params.dir}/wiki`)}>Resources</span>
                    <span class="wk-breadcrumb-sep">›</span>
                    <span class="wk-breadcrumb-current">{d().title || d().url || "Resource"}</span>
                  </div>

                  {/* Title */}
                  <h1 class="wk-page-title">{d().title || d().url || "Resource"}</h1>

                  {/* Meta row */}
                  <div class="wk-page-meta">
                    <span>{modalityIcon(d().modality)} {modalityLabel(d().modality)}</span>
                    <Show when={d().author}>
                      <span>·</span>
                      <span>{d().author}</span>
                    </Show>
                    <Show when={d().url}>
                      <span>·</span>
                      <a
                        href={d().url!}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "var(--color-text-link, #6366f1)" }}
                      >
                        {(() => {
                          try { return new URL(d().url!).hostname.replace(/^www\./, "") } catch { return d().url }
                        })()}
                        {" ↗"}
                      </a>
                    </Show>
                    <span>·</span>
                    <span>Added {formatDate(d().time_created)}</span>
                  </div>

                  {/* Content */}
                  <Show
                    when={d().content}
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
                </div>
              )}
            </Show>
          </main>
        </div>
      </div>
    </div>
  )
}
