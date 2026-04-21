import { createResource, For, Show, createSignal } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useWikiApi, type WikiCategory } from "./wiki-api"
import { WikiGraph } from "./wiki-graph"
import "./wiki.css"

function CategoryCard(props: { cat: WikiCategory; onNavigate: (slug: string) => void }) {
  return (
    <div class="wk-card" onClick={() => props.onNavigate(props.cat.slug)}>
      <div class="wk-card-title">{props.cat.slug}</div>
      <div class="wk-card-desc">{props.cat.description}</div>
    </div>
  )
}

export default function WikiHome() {
  const api = useWikiApi()
  const navigate = useNavigate()
  const params = useParams<{ dir: string }>()
  const [sidebarOpen, setSidebarOpen] = createSignal(true)
  const [catsOpen, setCatsOpen] = createSignal(true)
  const [graphWidth, setGraphWidth] = createSignal(45)
  let contentAreaRef: HTMLDivElement | undefined

  const [data] = createResource(() => api.home())

  const go = (slug: string) => navigate(`/${params.dir}/wiki/${slug}`)

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" })

  const updatedDate = () => {
    const events = data()?.recent_events
    if (!events || events.length === 0) return "—"
    return formatDate(events[0].time_created)
  }

  const onDividerMouseDown = (e: MouseEvent) => {
    e.preventDefault()
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"

    const onMouseMove = (e: MouseEvent) => {
      if (!contentAreaRef) return
      const rect = contentAreaRef.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const gw = ((rect.width - mouseX) / rect.width) * 100
      setGraphWidth(Math.max(35, Math.min(55, gw)))
    }

    const onMouseUp = () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
    }

    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
  }

  return (
    <div class="wk-root">
      <div class="wk-layout">

        {/* ── Sidebar ── */}
        <aside class={`wk-sidebar${sidebarOpen() ? "" : " wk-sidebar--collapsed"}`}>
          {/* Top: logo + collapse */}
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

          {/* Nav content */}
          <Show when={sidebarOpen()}>
            <div class="wk-sb-nav">
              <Show when={data()}>
                {(d) => (
                  <>
                    <div class="wk-sb-label wk-sb-label--toggle" style={{ "margin-top": "8px" }} onClick={() => setCatsOpen(v => !v)}>
                      <span>Categories</span>
                      <span class="wk-sb-label-arrow">{catsOpen() ? "▾" : "▸"}</span>
                    </div>
                    <Show when={catsOpen()}>
                      <For each={d().categories}>
                        {(cat) => (
                          <a class="wk-sb-link" onClick={() => go(cat.slug)}>{cat.slug}</a>
                        )}
                      </For>
                    </Show>

                    <div class="wk-sb-label" style={{ "margin-top": "8px" }}>Docs</div>
                    <a class="wk-sb-link" onClick={() => navigate(`/${params.dir}/wiki/roadmap`)}>Roadmaps</a>

                    <div class="wk-sb-label" style={{ "margin-top": "8px" }}>Stats</div>
                    <div class="wk-sb-stat">{d().stats.total_pages} pages</div>
                    <div class="wk-sb-stat">{d().stats.total_sources} sources</div>
                    <div class="wk-sb-stat">Updated {updatedDate()}</div>
                  </>
                )}
              </Show>
            </div>

            {/* Bottom: profile */}
            <div class="wk-sb-profile">
              <div class="wk-sb-profile-avatar">VK</div>
              <div class="wk-sb-profile-info">
                <div class="wk-sb-profile-name">Vaibhaw Khemka</div>
              </div>
            </div>
          </Show>
        </aside>

        {/* ── Content area (main + graph) — rounded inset container ── */}
        <div class="wk-content-area" ref={contentAreaRef}>

          {/* ── Main ── */}
          <main class="wk-main">
            <Show when={data.loading}>
              <div class="wk-loading">Loading…</div>
            </Show>

            <Show when={data()}>
              {(d) => (
                <>
                  <h1 class="wk-title">Welcome to Supadense Wiki</h1>
                  <p class="wk-subtitle">Your Knowledge base for Tech</p>

                  <div class="wk-section-label">Browse by category</div>
                  <div class="wk-grid">
                    <For each={d().categories}>
                      {(cat) => <CategoryCard cat={cat} onNavigate={go} />}
                    </For>
                  </div>

                  <Show when={d().recent_events.length > 0}>
                    <div class="wk-section-label" style={{ "margin-top": "28px" }}>Recent activity</div>
                    <ul class="wk-activity-list">
                      <For each={d().recent_events.slice(0, 5)}>
                        {(ev) => (
                          <li class="wk-activity-item">
                            <span class="wk-activity-dot" data-type={ev.event_type} />
                            <span class="wk-activity-summary">{ev.summary}</span>
                            <span class="wk-activity-date">{formatDate(ev.time_created)}</span>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </>
              )}
            </Show>
          </main>

          {/* ── Resize divider ── */}
          <Show when={data()}>
            <div class="wk-resize-divider" onMouseDown={onDividerMouseDown} />
          </Show>

          {/* ── Graph panel ── */}
          <Show when={data()}>
            {(d) => (
              <aside class="wk-graph-panel" style={{ width: `${graphWidth()}%` }}>
                <div class="wk-graph-header">
                  <span class="wk-graph-title">Knowledge Graph</span>
                </div>
                <div class="wk-graph-body">
                  <WikiGraph data={d().graph_data} onNavigate={go} />
                </div>
                <div class="wk-graph-legend">
                  <span class="wk-legend-item"><span class="wk-legend-dot" style={{ background: "#6366f1" }} />Category</span>
                  <span class="wk-legend-item"><span class="wk-legend-dot" style={{ background: "#a5b4fc" }} />Section</span>
                  <span class="wk-legend-item"><span class="wk-legend-dot" style={{ background: "#f59e0b" }} />Group</span>
                  <span class="wk-legend-item"><span class="wk-legend-dot" style={{ background: "#cbd5e1" }} />Resource</span>
                </div>
              </aside>
            )}
          </Show>

        </div>{/* ── end .wk-content-area ── */}

      </div>
    </div>
  )
}
