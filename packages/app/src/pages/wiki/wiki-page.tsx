import { createResource, createMemo, createSignal, For, Show } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useWikiApi } from "./wiki-api"
import { useServer } from "@/context/server"
import { renderMarkdown } from "./markdown"
import "./wiki.css"

// ── Section parsing ──────────────────────────────────────────────────────────

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

// Icon map for common section names
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

// ── Component ────────────────────────────────────────────────────────────────

export default function WikiPage() {
  const api = useWikiApi()
  const server = useServer()
  const params = useParams<{ dir: string; slug: string }>()
  const navigate = useNavigate()
  const [search, setSearch] = createSignal("")
  const [activeTab, setActiveTab] = createSignal(0)

  const wikiBase = () => {
    const http = server.current?.http
    if (!http) return "http://localhost:4096/wiki"
    const base = typeof http === "string" ? http : (http as { url: string }).url
    return `${base}/wiki`
  }

  const [data] = createResource(() => params.slug, (slug) => {
    setActiveTab(0) // reset to first tab on page change
    return api.page(slug)
  })

  // Rewrite asset image paths before parsing/rendering
  const rewrittenContent = createMemo(() => {
    const content = data()?.content ?? ""
    return content
      .replace(
        /!\[([^\]]*)\]\((\/wiki\/assets\/[^)]+)\)/g,
        (_, alt, p) => `![${alt}](${wikiBase()}${p})`
      )
      .replace(
        /!\[([^\]]*)\]\((assets\/[^)]+)\)/g,
        (_, alt, p) => `![${alt}](${wikiBase()}/${p})`
      )
  })

  const sections = createMemo(() => parseSections(rewrittenContent()))

  // Content that appears before the first ## (title blurb, description)
  const preamble = createMemo(() => {
    const content = rewrittenContent()
    const firstH2 = content.indexOf("\n## ")
    if (firstH2 === -1) return ""
    // Strip h1 and blockquote managed-by line, keep description
    return content
      .slice(0, firstH2)
      .split("\n")
      .filter((l) => !l.startsWith("# ") && !l.startsWith("> This file"))
      .join("\n")
      .trim()
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
                <div class="wk-sb-label" style={{ "margin-top": "14px" }}>STATS</div>
                <div class="wk-sb-stat">{d().page.resource_count} sources</div>
                <Show when={d().category}>
                  {(cat) => <div class="wk-sb-stat">depth: {cat().depth}</div>}
                </Show>
                <div class="wk-sb-stat">Updated {formatDate(d().page.time_updated)}</div>

                <Show when={d().subcategories.length > 0}>
                  <div class="wk-sb-label" style={{ "margin-top": "14px" }}>SECTIONS</div>
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

                {/* Page title + meta */}
                <h1 class="wk-page-title">{d().page.title}</h1>
                <div class="wk-page-meta">
                  <span>{d().page.resource_count} source{d().page.resource_count !== 1 ? "s" : ""}</span>
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

                {/* Preamble (description before first section) */}
                <Show when={preamble()}>
                  <div class="wk-prose wk-preamble" innerHTML={renderMarkdown(preamble())} />
                </Show>

                {/* ── Section tabs ── */}
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

                  {/* Active tab content */}
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

                {/* Fallback: no sections — render full content */}
                <Show when={sections().length === 0 && rewrittenContent()}>
                  <div class="wk-prose" innerHTML={renderMarkdown(rewrittenContent())} />
                </Show>

                {/* Subcategories (for category pages with sub-pages) */}
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
