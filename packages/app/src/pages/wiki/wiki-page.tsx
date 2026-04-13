import { createResource, createMemo, createSignal, For, Show } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useWikiApi } from "./wiki-api"
import { useServer } from "@/context/server"
import { renderMarkdown, extractHeadings } from "./markdown"
import "./wiki.css"

export default function WikiPage() {
  const api = useWikiApi()
  const server = useServer()
  const params = useParams<{ dir: string; slug: string }>()
  const navigate = useNavigate()
  const [search, setSearch] = createSignal("")

  const wikiBase = () => {
    const http = server.current?.http
    if (!http) return "http://localhost:4096/wiki"
    const base = typeof http === "string" ? http : (http as { url: string }).url
    return `${base}/wiki`
  }

  const [data] = createResource(() => params.slug, (slug) => api.page(slug))

  const headings = createMemo(() => {
    const content = data()?.content ?? ""
    return extractHeadings(content)
  })

  const renderedContent = createMemo(() => {
    const content = data()?.content ?? ""
    // Rewrite relative asset paths to absolute server URLs
    const rewritten = content.replace(
      /!\[([^\]]*)\]\((assets\/[^)]+)\)/g,
      (_, alt, assetPath) => `![${alt}](${wikiBase()}/${assetPath})`
    )
    return renderMarkdown(rewritten)
  })

  const navigateTo = (slug: string) => navigate(`/${params.dir}/wiki/${slug}`)

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })

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
          <span class="wk-nav-item" onClick={() => navigate(`/${params.dir}/session`)}>← Back to session</span>
          <span class="wk-nav-item">Chat</span>
          <span class="wk-nav-item">Digest</span>
          <div class="wk-avatar">VK</div>
        </nav>
      </header>

      <div class="wk-layout">
        {/* ── Sidebar ── */}
        <aside class="wk-sidebar">
          <div class="wk-sb-label">NAVIGATION</div>
          <a class="wk-sb-link" onClick={() => navigate(`/${params.dir}/wiki`)}>Main page</a>
          <a class="wk-sb-link">Random article</a>

          <Show when={data()}>
            {(d) => (
              <>
                <Show when={headings().length > 0}>
                  <div class="wk-sb-label" style={{ "margin-top": "14px" }}>ON THIS PAGE</div>
                  <For each={headings()}>
                    {(h) => (
                      <a
                        class={`wk-sb-link${h.level === 3 ? " wk-sb-link-sub" : ""}`}
                        href={`#${h.id}`}
                      >
                        {h.text}
                      </a>
                    )}
                  </For>
                </Show>

                <div class="wk-sb-label" style={{ "margin-top": "14px" }}>STATS</div>
                <div class="wk-sb-stat">{d().page.resource_count} sources</div>
                <Show when={d().category}>
                  {(cat) => <div class="wk-sb-stat">depth: {cat().depth}</div>}
                </Show>
                <div class="wk-sb-stat">Updated {formatDate(d().page.time_updated)}</div>
              </>
            )}
          </Show>
        </aside>

        {/* ── Main ── */}
        <main class="wk-main">
          <Show when={data.loading}>
            <div class="wk-loading">Loading page…</div>
          </Show>

          <Show when={data()}>
            {(d) => (
              <div class="wk-page-content">
                {/* Breadcrumb */}
                <div class="wk-breadcrumb">
                  <span class="wk-breadcrumb-link" onClick={() => navigate(`/${params.dir}/wiki`)}>
                    Supadense
                  </span>
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
                    <span class="wk-breadcrumb-current">
                      {d().page.subcategory_slug?.replace(/-/g, " ")}
                    </span>
                  </Show>
                </div>

                {/* Page title */}
                <h1 class="wk-page-title">{d().page.title}</h1>
                <div class="wk-page-meta">
                  <span>
                    {d().page.resource_count} source{d().page.resource_count !== 1 ? "s" : ""}
                  </span>
                  <span>·</span>
                  <span>Updated {formatDate(d().page.time_updated)}</span>
                  <Show when={d().category}>
                    {(cat) => (
                      <>
                        <span>·</span>
                        <span>{cat().depth}</span>
                      </>
                    )}
                  </Show>
                </div>

                {/* Floating TOC */}
                <Show when={headings().length > 1}>
                  <div class="wk-toc">
                    <div class="wk-toc-title">Contents</div>
                    <ol class="wk-toc-list">
                      <For each={headings()}>
                        {(h, i) => (
                          <li class={h.level === 3 ? "wk-toc-sub" : ""}>
                            <a href={`#${h.id}`} class="wk-toc-link">
                              {i() + 1}. {h.text}
                            </a>
                          </li>
                        )}
                      </For>
                    </ol>
                  </div>
                </Show>

                {/* Markdown content */}
                <div class="wk-prose" innerHTML={renderedContent()} />

                {/* Concepts */}
                <Show when={d().concepts.length > 0}>
                  <div class="wk-concepts-section">
                    <div class="wk-section-heading">Key Concepts</div>
                    <div class="wk-concepts-grid">
                      <For each={d().concepts.slice(0, 12)}>
                        {(c) => (
                          <div class="wk-concept-card">
                            <span class="wk-concept-name">{c.name}</span>
                            <Show when={c.definition}>
                              <p class="wk-concept-def">{c.definition}</p>
                            </Show>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>

                {/* Subcategories */}
                <Show when={d().subcategories.length > 0}>
                  <div class="wk-subcat-section">
                    <div class="wk-section-heading">Subcategories</div>
                    <div class="wk-subcat-list">
                      <For each={d().subcategories}>
                        {(sub) => (
                          <div
                            class="wk-subcat-item"
                            onClick={() =>
                              navigateTo(`${d().page.category_slug}--${sub.subcategory_slug}`)
                            }
                          >
                            <span class="wk-subcat-name">
                              {sub.subcategory_slug?.replace(/-/g, " ")}
                            </span>
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
      </div>
    </div>
  )
}
