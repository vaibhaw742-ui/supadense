import { createResource, createMemo, For, Show, createSignal } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useWikiApi, type WikiCategory, type WikiPageSummary } from "./wiki-api"
import { WikiGraph } from "./wiki-graph"
import "./wiki.css"

// Rotate through a palette so each top-level category's sub-cats get a distinct accent
const SUBCAT_PALETTES = [
  { bg: "rgba(99,102,241,0.10)", border: "rgba(99,102,241,0.25)", text: "#6366f1" },
  { bg: "rgba(16,185,129,0.10)", border: "rgba(16,185,129,0.25)", text: "#059669" },
  { bg: "rgba(245,158,11,0.10)", border: "rgba(245,158,11,0.25)", text: "#d97706" },
  { bg: "rgba(236,72,153,0.10)", border: "rgba(236,72,153,0.25)", text: "#db2777" },
  { bg: "rgba(14,165,233,0.10)", border: "rgba(14,165,233,0.25)", text: "#0284c7" },
  { bg: "rgba(168,85,247,0.10)", border: "rgba(168,85,247,0.25)", text: "#9333ea" },
]

function pageNavSlug(page: WikiPageSummary): string {
  if (!page.subcategory_slug) return page.category_slug ?? page.slug
  return `${page.category_slug}--${page.subcategory_slug}`
}

function pageLabel(page: WikiPageSummary): string {
  if (!page.subcategory_slug) return "Overview"
  return page.title
}

function sortedPages(pages: WikiPageSummary[]): WikiPageSummary[] {
  return [...pages]
    .filter((p) => p.page_type !== "index")
    .sort((a, b) => {
      if (!a.subcategory_slug) return -1
      if (!b.subcategory_slug) return 1
      return a.title.localeCompare(b.title)
    })
}

// ── Collapsible sub-category row ─────────────────────────────────────────────
function SidebarSubcat(props: {
  cat: WikiCategory
  openIds: Set<string>
  onToggle: (id: string) => void
  onNavigate: (slug: string) => void
  indent: number
}) {
  const isOpen = () => props.openIds.has(props.cat.id)
  const pages = () => sortedPages(props.cat.pages)

  return (
    <div class="wk-tree-subcat" style={{ "padding-left": `${props.indent}px` }}>
      <div class="wk-tree-row wk-tree-row--subcat">
        <span class="wk-tree-toggle" onClick={() => props.onToggle(props.cat.id)}>
          {isOpen() ? "▾" : "▸"}
        </span>
        <span class="wk-tree-label wk-tree-label--subcat" onClick={() => props.onNavigate(props.cat.slug)}>
          {props.cat.name || props.cat.slug}
        </span>
      </div>
      <Show when={isOpen()}>
        <div class="wk-tree-children">
          <For each={pages()}>
            {(page) => (
              <div
                class="wk-tree-leaf"
                style={{ "padding-left": `${props.indent + 16}px` }}
                onClick={() => props.onNavigate(pageNavSlug(page))}
              >
                {pageLabel(page)}
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

// ── Collapsible top-level category row ───────────────────────────────────────
function SidebarCategory(props: {
  cat: WikiCategory
  subcats: WikiCategory[]
  openIds: Set<string>
  onToggle: (id: string) => void
  onNavigate: (slug: string) => void
}) {
  const isOpen = () => props.openIds.has(props.cat.id)
  const pages = () => sortedPages(props.cat.pages)

  return (
    <div class="wk-tree-cat">
      <div class="wk-tree-row">
        <span class="wk-tree-toggle" onClick={() => props.onToggle(props.cat.id)}>
          {isOpen() ? "▾" : "▸"}
        </span>
        <span class="wk-tree-label" onClick={() => props.onNavigate(props.cat.slug)}>
          {props.cat.name || props.cat.slug}
        </span>
      </div>
      <Show when={isOpen()}>
        <div class="wk-tree-children">
          <For each={pages()}>
            {(page) => (
              <div class="wk-tree-leaf" style={{ "padding-left": "16px" }} onClick={() => props.onNavigate(pageNavSlug(page))}>
                {pageLabel(page)}
              </div>
            )}
          </For>
          <For each={props.subcats}>
            {(sub) => (
              <SidebarSubcat
                cat={sub}
                openIds={props.openIds}
                onToggle={props.onToggle}
                onNavigate={props.onNavigate}
                indent={16}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

// ── Category card (main grid) ─────────────────────────────────────────────────
function CategoryCard(props: {
  cat: WikiCategory
  subcats: WikiCategory[]
  paletteIndex: number
  onNavigate: (slug: string) => void
}) {
  const palette = () => SUBCAT_PALETTES[props.paletteIndex % SUBCAT_PALETTES.length]

  return (
    <div class="wk-card">
      <div class="wk-card-header" onClick={() => props.onNavigate(props.cat.slug)}>
        <div class="wk-card-title">{props.cat.name || props.cat.slug}</div>
        <div class="wk-card-desc">{props.cat.description}</div>
      </div>
      <Show when={props.subcats.length > 0}>
        <div class="wk-card-subcats">
          <For each={props.subcats}>
            {(sub) => (
              <span
                class="wk-card-subcat-chip"
                style={{
                  background: palette().bg,
                  border: `1px solid ${palette().border}`,
                  color: palette().text,
                }}
                onClick={(e) => { e.stopPropagation(); props.onNavigate(sub.slug) }}
              >
                {sub.name || sub.slug}
              </span>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

export default function WikiHome() {
  const api = useWikiApi()
  const navigate = useNavigate()
  const params = useParams<{ dir: string }>()
  const [sidebarOpen, setSidebarOpen] = createSignal(true)
  const [graphWidth, setGraphWidth] = createSignal(45)
  const [openIds, setOpenIds] = createSignal<Set<string>>(new Set())
  let contentAreaRef: HTMLDivElement | undefined

  const [data] = createResource(() => api.home())

  const go = (slug: string) => navigate(`/${params.dir}/wiki/${slug}`)

  const toggleId = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const topLevelCats = createMemo(() =>
    (data()?.categories ?? []).filter((c) => !c.parent_category_id)
  )

  const subcatsByParent = createMemo(() => {
    const map = new Map<string, WikiCategory[]>()
    for (const c of data()?.categories ?? []) {
      if (!c.parent_category_id) continue
      const list = map.get(c.parent_category_id) ?? []
      list.push(c)
      map.set(c.parent_category_id, list)
    }
    return map
  })

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

          <Show when={sidebarOpen()}>
            {/* Tree fills all available space and scrolls */}
            <div class="wk-sb-nav">
              <Show when={data()}>
                {(_d) => (
                  <>
                    <div class="wk-sb-label" style={{ "margin-top": "4px" }}>Categories</div>
                    <div class="wk-tree">
                      <For each={topLevelCats()}>
                        {(cat) => (
                          <SidebarCategory
                            cat={cat}
                            subcats={subcatsByParent().get(cat.id) ?? []}
                            openIds={openIds()}
                            onToggle={toggleId}
                            onNavigate={go}
                          />
                        )}
                      </For>
                    </div>
                  </>
                )}
              </Show>
            </div>

            {/* Docs + Stats pinned below the tree */}
            <div class="wk-sb-bottom">
              <Show when={data()}>
                <>
                  <div class="wk-sb-label">Docs</div>
                  <a class="wk-sb-link" onClick={() => navigate(`/${params.dir}/wiki/roadmap`)}>Roadmaps</a>
                  <div class="wk-sb-label" style={{ "margin-top": "6px" }}>Stats</div>
                  <div class="wk-sb-stat">{data()!.stats.total_pages} pages</div>
                  <div class="wk-sb-stat">{data()!.stats.total_sources} sources</div>
                  <div class="wk-sb-stat">Updated {updatedDate()}</div>
                </>
              </Show>
            </div>

          </Show>
        </aside>

        {/* ── Content area ── */}
        <div class="wk-content-area" ref={contentAreaRef}>

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
                    <For each={topLevelCats()}>
                      {(cat, i) => (
                        <CategoryCard
                          cat={cat}
                          subcats={subcatsByParent().get(cat.id) ?? []}
                          paletteIndex={i()}
                          onNavigate={go}
                        />
                      )}
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

          <Show when={data()}>
            <div class="wk-resize-divider" onMouseDown={onDividerMouseDown} />
          </Show>

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

        </div>
      </div>
    </div>
  )
}
