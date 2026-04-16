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
  const [search, setSearch] = createSignal("")

  const [data] = createResource(() => api.home())

  const go = (slug: string) => navigate(`/${params.dir}/wiki/${slug}`)

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" })

  const updatedDate = () => {
    const events = data()?.recent_events
    if (!events || events.length === 0) return "—"
    return formatDate(events[0].time_created)
  }

  return (
    <div class="wk-root">
      {/* ── Header ── */}
      <header class="wk-header">
        <span class="wk-logo" onClick={() => navigate(`/${params.dir}/wiki`)}>Supadense</span>
        <input
          class="wk-search"
          placeholder="Search your knowledge bank..."
          value={search()}
          onInput={(e) => setSearch(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && search().trim())
              navigate(`/${params.dir}/wiki/search?q=${encodeURIComponent(search())}`)
          }}
        />
        <nav class="wk-nav">
          <span class="wk-nav-item">Chat</span>
          <span class="wk-nav-item">Digest</span>
          <div class="wk-avatar">VK</div>
        </nav>
      </header>

      <div class="wk-layout">
        {/* ── Sidebar ── */}
        <aside class="wk-sidebar">
          <div class="wk-sb-label">NAVIGATION</div>
          <a class="wk-sb-link wk-sb-link-active" onClick={() => navigate(`/${params.dir}/wiki`)}>Main page</a>
          <a class="wk-sb-link">Random article</a>

          <Show when={data()}>
            {(d) => (
              <>
                <div class="wk-sb-label" style={{ "margin-top": "16px" }}>CATEGORIES</div>
                <For each={d().categories}>
                  {(cat) => (
                    <a class="wk-sb-link" onClick={() => go(cat.slug)}>{cat.slug}</a>
                  )}
                </For>

                <div class="wk-sb-label" style={{ "margin-top": "16px" }}>STATS</div>
                <div class="wk-sb-stat">{d().stats.total_pages} pages</div>
                <div class="wk-sb-stat">{d().stats.total_sources} sources</div>
                <div class="wk-sb-stat">Updated {updatedDate()}</div>
              </>
            )}
          </Show>
        </aside>

        {/* ── Main ── */}
        <main class="wk-main">
          <Show when={data.loading}>
            <div class="wk-loading">Loading…</div>
          </Show>

          <Show when={data()}>
            {(d) => (
              <>
                <h1 class="wk-title">Welcome to Supadense Wiki</h1>
                <p class="wk-subtitle">
                  Your personal learning encyclopedia — {d().stats.total_pages} articles across {d().stats.total_categories} categories.
                </p>

                <div class="wk-section-label">Browse by category</div>
                <div class="wk-grid">
                  <For each={d().categories}>
                    {(cat) => <CategoryCard cat={cat} onNavigate={go} />}
                  </For>
                </div>

                <Show when={d().recent_events.length > 0}>
                  <div class="wk-section-label" style={{ "margin-top": "28px" }}>Recent activity</div>
                  <ul class="wk-activity-list">
                    <For each={d().recent_events}>
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

        {/* ── Graph panel ── */}
        <Show when={data()}>
          {(d) => (
            <aside class="wk-graph-panel">
              <div class="wk-graph-header">
                <span class="wk-graph-title">Knowledge Graph</span>
                <span class="wk-graph-hint">scroll to zoom · drag to pan</span>
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
      </div>
    </div>
  )
}
