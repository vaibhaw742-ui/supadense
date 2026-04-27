import { createResource, createMemo, createSignal, For, Show } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useWikiApi } from "./wiki-api"
import { useServer } from "@/context/server"
import { renderMarkdown } from "./markdown"
import { decode64 } from "@/utils/base64"
import { getAuthToken } from "@/utils/server"
import "./wiki.css"

function resourceIcon(modality: string): string {
  const m = modality.toLowerCase()
  if (m === "youtube") return "▶"
  if (m === "pdf") return "◧"
  if (m === "image") return "⊡"
  if (m === "linkedin") return "◉"
  return "⊕"
}

function resourceDomain(url: string | null): string {
  if (!url) return ""
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return ""
  }
}

export default function WikiPage() {
  const api = useWikiApi()
  const server = useServer()
  const params = useParams<{ dir: string; slug: string }>()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = createSignal(true)
  const [resourcePanelWidth, setResourcePanelWidth] = createSignal(38)
  const [rightTab, setRightTab] = createSignal<"sources" | "images">("sources")
  const [sortOrder, setSortOrder] = createSignal<"new" | "old">("new")
  let contentAreaRef: HTMLDivElement | undefined

  const directory = () => decode64(params.dir) ?? ""

  const wikiBase = () => {
    const http = server.current?.http
    if (!http) return "http://localhost:4096/wiki"
    const base = typeof http === "string" ? http : (http as { url: string }).url
    return `${base}/wiki`
  }

  const assetParams = () => {
    const dir = directory()
    const token = getAuthToken()
    const parts: string[] = []
    if (dir) parts.push(`directory=${encodeURIComponent(dir)}`)
    if (token) parts.push(`auth_token=${encodeURIComponent(token)}`)
    return parts.length ? `?${parts.join("&")}` : ""
  }

  const assetUrl = (path: string) => `${wikiBase()}/${path}${assetParams()}`

  const [data] = createResource(() => params.slug, (slug) => api.page(slug))

  const rewrittenContent = createMemo(() => {
    const content = data()?.content ?? ""
    const qs = assetParams()
    return content
      .replace(/!\[([^\]]*)\]\((\/wiki\/assets\/[^)]+)\)/g, (_, alt, p) => `![${alt}](${wikiBase()}${p}${qs})`)
      .replace(/!\[([^\]]*)\]\((assets\/[^)]+)\)/g, (_, alt, p) => `![${alt}](${wikiBase()}/${p}${qs})`)
  })

  const navigateTo = (slug: string) => navigate(`/${params.dir}/wiki/${slug}`)

  const handleProseClick = (e: MouseEvent, currentCategorySlug: string) => {
    const anchor = (e.target as HTMLElement).closest("a")
    if (!anchor) return
    const href = anchor.getAttribute("href")
    if (!href) return
    if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("mailto:")) return

    e.preventDefault()
    e.stopPropagation()

    // Strip leading ./ and split into parts
    const clean = href.replace(/^\.\//, "").replace(/\.md$/, "")
    const parts = clean.split("/").filter(Boolean)

    if (parts.length === 0) return

    if (parts.length === 1) {
      // ./key-concepts.md  →  agents--key-concepts
      // ./overview.md      →  agents
      parts[0] === "overview"
        ? navigateTo(currentCategorySlug)
        : navigateTo(`${currentCategorySlug}--${parts[0]}`)
    } else if (parts[parts.length - 1] === "overview") {
      // ./rag/overview.md  →  rag
      navigateTo(parts[parts.length - 2])
    } else {
      // ./rag/retrieval.md  →  rag--retrieval
      navigateTo(`${parts[parts.length - 2]}--${parts[parts.length - 1]}`)
    }
  }

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
  const formatShortDate = (ts: number) =>
    new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })

  const onDividerMouseDown = (e: MouseEvent) => {
    e.preventDefault()
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"

    const onMouseMove = (e: MouseEvent) => {
      if (!contentAreaRef) return
      const rect = contentAreaRef.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const rw = ((rect.width - mouseX) / rect.width) * 100
      setResourcePanelWidth(Math.max(25, Math.min(50, rw)))
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

  const sortedResources = createMemo(() => {
    const list = [...(data()?.resources ?? [])]
    return sortOrder() === "new"
      ? list.sort((a, b) => b.placed_at - a.placed_at)
      : list.sort((a, b) => a.placed_at - b.placed_at)
  })

  const sortedImages = createMemo(() => {
    const list = [...(data()?.images ?? [])]
    return sortOrder() === "new"
      ? list.sort((a, b) => b.time_created - a.time_created)
      : list.sort((a, b) => a.time_created - b.time_created)
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

          <Show when={sidebarOpen()}>
            <div class="wk-sb-nav">
              <Show when={data()}>
                {(d) => (
                  <>
                    <div class="wk-sb-label" style={{ "margin-top": "8px" }}>Docs</div>
                    <a class="wk-sb-link" onClick={() => navigate(`/${params.dir}/wiki/roadmap`)}>Roadmaps</a>

                    <div class="wk-sb-label" style={{ "margin-top": "8px" }}>Stats</div>
                    <div class="wk-sb-stat">{d().page.resource_count} sources</div>
                    <Show when={d().category}>
                      {(cat) => <div class="wk-sb-stat">depth: {cat().depth}</div>}
                    </Show>
                    <div class="wk-sb-stat">Updated {formatDate(d().page.time_updated)}</div>

                    <Show when={d().category_tabs.length >= 1}>
                      <div class="wk-sb-label" style={{ "margin-top": "8px" }}>Pages</div>
                      <For each={d().category_tabs}>
                        {(tab) => (
                          <a
                            class={`wk-sb-link${tab.nav_slug === params.slug ? " wk-sb-link--active" : ""}`}
                            onClick={() => navigateTo(tab.nav_slug)}
                          >
                            {tab.title}
                          </a>
                        )}
                      </For>
                    </Show>
                  </>
                )}
              </Show>
            </div>


          </Show>
        </aside>

        {/* ── Content area ── */}
        <div class="wk-content-area" ref={contentAreaRef}>

          {/* ── Main ── */}
          <main class="wk-main">
            <Show when={data.loading}>
              <div class="wk-loading">Loading page…</div>
            </Show>

            <Show when={data()}>
              {(d) => (
                <div class="wk-page-content">
                  <div class="wk-breadcrumb">
                    <span class="wk-breadcrumb-link" onClick={() => navigate(`/${params.dir}/wiki`)}>Supadense</span>
                    <Show when={d().parent_category}>
                      {(parent) => (
                        <>
                          <span class="wk-breadcrumb-sep">›</span>
                          <span class="wk-breadcrumb-link" onClick={() => navigateTo(parent().slug)}>
                            {parent().name}
                          </span>
                        </>
                      )}
                    </Show>
                    <Show when={d().category}>
                      {(cat) => (
                        <>
                          <span class="wk-breadcrumb-sep">›</span>
                          <Show
                            when={d().page.type !== "overview" || d().parent_category}
                            fallback={<span class="wk-breadcrumb-current">{cat().name || cat().slug}</span>}
                          >
                            <span class="wk-breadcrumb-link" onClick={() => navigateTo(cat().slug)}>
                              {cat().name || cat().slug}
                            </span>
                          </Show>
                        </>
                      )}
                    </Show>
                    <Show when={d().page.type === "section"}>
                      <span class="wk-breadcrumb-sep">›</span>
                      <span class="wk-breadcrumb-current">{d().page.title}</span>
                    </Show>
                  </div>

                  <h1 class="wk-page-title">{d().page.title}</h1>
                  <div class="wk-page-meta">
                    <span>{d().page.resource_count} source{d().page.resource_count !== 1 ? "s" : ""}</span>
                    <span>·</span>
                    <span>Updated {formatDate(d().page.time_updated)}</span>
                    <Show when={d().category}>
                      {(cat) => (<><span>·</span><span>{cat().depth}</span></>)}
                    </Show>
                  </div>

                  <Show when={d().category_tabs.length >= 1}>
                    <div class="wk-section-tabs">
                      <For each={d().category_tabs}>
                        {(tab) => (
                          <button
                            class={`wk-section-tab${tab.nav_slug === params.slug ? " wk-section-tab--active" : ""}`}
                            onClick={() => navigateTo(tab.nav_slug)}
                          >
                            {tab.title}
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>

                  <div
                    class="wk-prose wk-tab-pane"
                    innerHTML={renderMarkdown(rewrittenContent())}
                    onClick={(e) => handleProseClick(e, d().page.category_slug ?? "")}
                  />
                </div>
              )}
            </Show>
          </main>

          {/* ── Resize divider + Right panel (sources/images tabs) ── */}
          <Show when={data() !== undefined}>
            <div class="wk-resize-divider" onMouseDown={onDividerMouseDown} />

            <aside class="wk-resource-panel" style={{ width: `${resourcePanelWidth()}%` }}>
              {/* Tab bar */}
              <div class="wk-resource-panel-header">
                <span class="wk-graph-title" style={{ flex: "1" }}>
                  {rightTab() === "sources" ? "Sources" : "Images"}
                </span>
                <div class="wk-rp-tabs">
                  <button
                    class={`wk-rp-tab${rightTab() === "sources" ? " wk-rp-tab--active" : ""}`}
                    onClick={() => setRightTab("sources")}
                  >
                    ⊕ Sources
                    <Show when={(data()?.resources?.length ?? 0) > 0}>
                      <span class="wk-rp-tab-count">{data()!.resources.length}</span>
                    </Show>
                  </button>
                  <button
                    class={`wk-rp-tab${rightTab() === "images" ? " wk-rp-tab--active" : ""}`}
                    onClick={() => setRightTab("images")}
                  >
                    ⊡ Images
                    <Show when={(data()?.images?.length ?? 0) > 0}>
                      <span class="wk-rp-tab-count">{data()!.images.length}</span>
                    </Show>
                  </button>
                  <div style={{ flex: "1" }} />
                  <button
                    class="wk-rp-sort-btn"
                    title="Toggle sort order"
                    onClick={() => setSortOrder(o => o === "new" ? "old" : "new")}
                  >
                    {sortOrder() === "new" ? "↓ Newest" : "↑ Oldest"}
                  </button>
                </div>
              </div>

              {/* Sources tab */}
              <Show when={rightTab() === "sources"}>
                <div class="wk-resource-list">
                  <For each={sortedResources()} fallback={
                    <p class="wk-rp-empty">No sources for this page.</p>
                  }>
                    {(r) => (
                      <div class="wk-resource-item">
                        <span class="wk-resource-icon">{resourceIcon(r.modality)}</span>
                        <div class="wk-resource-info">
                          <Show when={r.url} fallback={
                            <span class="wk-resource-title">{r.title ?? "Untitled"}</span>
                          }>
                            <a class="wk-resource-title" href={r.url!} target="_blank" rel="noopener noreferrer">
                              {r.title ?? resourceDomain(r.url)}
                            </a>
                          </Show>
                          <div class="wk-resource-meta">
                            <Show when={resourceDomain(r.url)}>
                              <span class="wk-resource-domain">{resourceDomain(r.url)}</span>
                            </Show>
                            <Show when={r.section_heading}>
                              <span class="wk-resource-section-tag">{r.section_heading}</span>
                            </Show>
                          </div>
                          <span class="wk-resource-date">{formatShortDate(r.placed_at)}</span>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>

              {/* Images tab */}
              <Show when={rightTab() === "images"}>
                <div class="wk-image-grid">
                  <For each={sortedImages()} fallback={
                    <p class="wk-rp-empty">No images for this page.</p>
                  }>
                    {(img) => (
                      <div class="wk-image-card">
                        <img
                          class="wk-image-thumb"
                          src={assetUrl(img.src_path)}
                          alt={img.alt_text ?? img.caption ?? ""}
                          loading="lazy"
                        />
                        <div class="wk-image-caption-row">
                          <Show when={img.caption || img.description}>
                            <span class="wk-image-caption">{img.caption ?? img.description}</span>
                          </Show>
                          <span class="wk-image-date">{formatShortDate(img.time_created)}</span>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </aside>
          </Show>

        </div>{/* ── end .wk-content-area ── */}
      </div>
    </div>
  )
}
