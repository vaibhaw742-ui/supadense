import { createResource, createMemo, createSignal, For, Show } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useWikiApi } from "./wiki-api"
import { useServer } from "@/context/server"
import { renderMarkdown } from "./markdown"
import "./wiki.css"

interface WikiSection {
  heading: string
  content: string
}

function parseSections(md: string): WikiSection[] {
  const lines = md.split("\n")
  const sections: WikiSection[] = []
  let heading = ""
  let buf: string[] = []
  for (const line of lines) {
    const h2 = line.match(/^## (.+)$/)
    if (h2) {
      if (heading) sections.push({ heading, content: buf.join("\n").trim() })
      heading = h2[1]
      buf = []
    } else if (heading) {
      buf.push(line)
    }
  }
  if (heading) sections.push({ heading, content: buf.join("\n").trim() })
  return sections
}

function sectionIcon(heading: string): string {
  const h = heading.toLowerCase()
  if (h.includes("concept") || h.includes("key")) return "✦"
  if (h.includes("architect") || h.includes("overview") || h.includes("design")) return "◈"
  if (h.includes("image") || h.includes("visual") || h.includes("diagram")) return "⊡"
  if (h.includes("source") || h.includes("link") || h.includes("reference")) return "⊕"
  if (h.includes("example") || h.includes("use case")) return "◎"
  if (h.includes("paper") || h.includes("research")) return "◧"
  if (h.includes("tool") || h.includes("framework") || h.includes("library")) return "⬡"
  if (h.includes("people") || h.includes("author") || h.includes("creator")) return "◉"
  return "◦"
}

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
  const [activeTab, setActiveTab] = createSignal(0)
  const [sidebarOpen, setSidebarOpen] = createSignal(true)
  const [resourcePanelWidth, setResourcePanelWidth] = createSignal(38)
  const [rightTab, setRightTab] = createSignal<"sources" | "images">("sources")
  const [sortOrder, setSortOrder] = createSignal<"new" | "old">("new")
  let contentAreaRef: HTMLDivElement | undefined

  const wikiBase = () => {
    const http = server.current?.http
    if (!http) return "http://localhost:4096/wiki"
    const base = typeof http === "string" ? http : (http as { url: string }).url
    return `${base}/wiki`
  }

  const [data] = createResource(() => params.slug, (slug) => {
    setActiveTab(0)
    return api.page(slug)
  })

  const rewrittenContent = createMemo(() => {
    const content = data()?.content ?? ""
    return content
      .replace(/!\[([^\]]*)\]\((\/wiki\/assets\/[^)]+)\)/g, (_, alt, p) => `![${alt}](${wikiBase()}${p})`)
      .replace(/!\[([^\]]*)\]\((assets\/[^)]+)\)/g, (_, alt, p) => `![${alt}](${wikiBase()}/${p})`)
  })

  const sections = createMemo(() => parseSections(rewrittenContent()))

  const preamble = createMemo(() => {
    const content = rewrittenContent()
    const firstH2 = content.indexOf("\n## ")
    if (firstH2 === -1) return ""
    return content.slice(0, firstH2).split("\n")
      .filter((l) => !l.startsWith("# ") && !l.startsWith("> This file"))
      .join("\n").trim()
  })

  const navigateTo = (slug: string) => navigate(`/${params.dir}/wiki/${slug}`)
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

                    <Show when={d().subcategories.length > 0}>
                      <div class="wk-sb-label" style={{ "margin-top": "8px" }}>Sections</div>
                      <For each={d().subcategories}>
                        {(sub) => (
                          <a
                            class="wk-sb-link"
                            onClick={() => navigateTo(`${d().page.category_slug}--${sub.subcategory_slug}`)}
                          >
                            {sub.subcategory_slug?.replace(/-/g, " ")}
                          </a>
                        )}
                      </For>
                    </Show>
                  </>
                )}
              </Show>
            </div>

            <div class="wk-sb-profile">
              <div class="wk-sb-profile-avatar">VK</div>
              <div class="wk-sb-profile-info">
                <div class="wk-sb-profile-name">Vaibhaw Khemka</div>
              </div>
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
                    <Show when={d().category}>
                      {(cat) => (
                        <>
                          <span class="wk-breadcrumb-sep">›</span>
                          <span class="wk-breadcrumb-link" onClick={() => navigateTo(cat().slug)}>
                            {cat().name || cat().slug}
                          </span>
                        </>
                      )}
                    </Show>
                    <Show when={d().page.page_type === "subcategory"}>
                      <span class="wk-breadcrumb-sep">›</span>
                      <span class="wk-breadcrumb-current">{d().page.subcategory_slug?.replace(/-/g, " ")}</span>
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

                  <Show when={preamble()}>
                    <div class="wk-prose wk-preamble" innerHTML={renderMarkdown(preamble())} />
                  </Show>

                  <Show when={sections().length > 0}>
                    <div class="wk-section-tabs">
                      <For each={sections()}>
                        {(sec, i) => (
                          <button
                            class={`wk-section-tab${activeTab() === i() ? " wk-section-tab--active" : ""}`}
                            onClick={() => setActiveTab(i())}
                          >
                            <span class="wk-tab-icon">{sectionIcon(sec.heading)}</span>
                            {sec.heading}
                          </button>
                        )}
                      </For>
                    </div>

                    <Show when={sections()[activeTab()]}>
                      {(sec) => (
                        <div class="wk-tab-pane">
                          <Show
                            when={sec().content.trim()}
                            fallback={<p class="wk-empty-section">No content yet for this section.</p>}
                          >
                            <div class="wk-prose" innerHTML={renderMarkdown(sec().content)} />
                          </Show>
                        </div>
                      )}
                    </Show>
                  </Show>

                  <Show when={sections().length === 0 && rewrittenContent()}>
                    <div class="wk-prose" innerHTML={renderMarkdown(rewrittenContent())} />
                  </Show>

                  <Show when={d().subcategories.length > 0}>
                    <div class="wk-subcat-section">
                      <div class="wk-section-heading">Subcategories</div>
                      <div class="wk-subcat-list">
                        <For each={d().subcategories}>
                          {(sub) => (
                            <div
                              class="wk-subcat-item"
                              onClick={() => navigateTo(`${d().page.category_slug}--${sub.subcategory_slug}`)}
                            >
                              <span class="wk-subcat-name">{sub.subcategory_slug?.replace(/-/g, " ")}</span>
                              <span class="wk-subcat-count">{sub.resource_count} sources</span>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
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
                          src={`${wikiBase()}/${img.src_path}`}
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
