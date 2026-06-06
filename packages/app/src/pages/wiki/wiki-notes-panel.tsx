/**
 * wiki-notes-panel.tsx — Notes tab content, styled after the design screenshot.
 * Layout: top breadcrumb → horizontal section tabs → meta pill → big title → content.
 */
import { createResource, createMemo, createSignal, For, Show } from "solid-js"
import { useParams } from "@solidjs/router"
import { useWikiApi } from "./wiki-api"
import { useServer } from "@/context/server"
import { decode64 } from "@/utils/base64"
import { getAuthToken } from "@/utils/server"
import { activeNotesSlug, setActiveNotesSlug, setActiveSidebarView } from "@/context/sidebar-view"
import { renderMarkdown } from "./markdown"
import "./wiki.css"

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const days = Math.floor(diff / 86_400_000)
  if (days === 0) return "today"
  if (days === 1) return "1 day ago"
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  if (months === 1) return "1 month ago"
  return `${months} months ago`
}

export function WikiNotesPanel() {
  const api = useWikiApi()
  const server = useServer()
  const params = useParams<{ dir: string }>()

  const wikiBase = () => {
    const http = server.current?.http
    if (!http) return "http://localhost:4096/wiki"
    const base = typeof http === "string" ? http : (http as { url: string }).url
    return `${base}/wiki`
  }

  const assetParams = () => {
    const dir = decode64(params.dir) ?? ""
    const token = getAuthToken()
    const parts: string[] = []
    if (dir) parts.push(`directory=${encodeURIComponent(dir)}`)
    if (token) parts.push(`auth_token=${encodeURIComponent(token)}`)
    return parts.length ? `?${parts.join("&")}` : ""
  }

  const [data, { refetch }] = createResource(
    () => activeNotesSlug(),
    (slug) => api.page(slug!),
  )

  const rewrittenContent = createMemo(() => {
    const content = data()?.content ?? ""
    const qs = assetParams()
    return content
      .replace(/!\[([^\]]*)\]\((\/wiki\/assets\/[^)]+)\)/g, (_, alt, p) => `![${alt}](${wikiBase()}${p}${qs})`)
      .replace(/!\[([^\]]*)\]\((assets\/[^)]+)\)/g, (_, alt, p) => `![${alt}](${wikiBase()}/${p}${qs})`)
  })

  const navigateTo = (slug: string) => setActiveNotesSlug(slug)

  const handleProseClick = (e: MouseEvent, currentCategorySlug: string) => {
    const anchor = (e.target as HTMLElement).closest("a")
    if (!anchor) return
    const href = anchor.getAttribute("href")
    if (!href) return
    if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("mailto:")) return
    e.preventDefault()
    e.stopPropagation()
    const clean = href.replace(/^\.\//, "").replace(/\.md$/, "")
    const parts = clean.split("/").filter(Boolean)
    if (parts.length === 0) return
    if (parts.length === 1) {
      parts[0] === "overview"
        ? navigateTo(currentCategorySlug)
        : navigateTo(`${currentCategorySlug}--${parts[0]}`)
    } else if (parts[parts.length - 1] === "overview") {
      navigateTo(parts[parts.length - 2])
    } else {
      navigateTo(`${parts[parts.length - 2]}--${parts[parts.length - 1]}`)
    }
  }

  return (
    <Show
      when={activeNotesSlug()}
      fallback={
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            "font-size": "13px",
            color: "var(--wk-text-faint)",
            background: "var(--wk-bg)",
          }}
        >
          Click a node in the graph to open its notes here.
        </div>
      }
    >
      <div class="wkn-root">
        {/* ── Breadcrumb ── */}
        <div class="wkn-breadcrumb">
          <span
            class="wkn-breadcrumb-link"
            onClick={() => setActiveSidebarView({ section: "workspace", view: "lib", label: "Graph" })}
          >
            Workspace
          </span>
          <span class="wkn-breadcrumb-sep">›</span>
          <span class="wkn-breadcrumb-link">Notes</span>
          <Show when={data()?.category?.name ?? data()?.page.title}>
            <span class="wkn-breadcrumb-sep">›</span>
            <span class="wkn-breadcrumb-current">
              {data()?.category?.name ?? data()?.page.title}
            </span>
          </Show>
        </div>

        {/* ── Section tabs ── */}
        <Show when={(data()?.category_tabs.length ?? 0) > 0}>
          <div class="wkn-tabs">
            <For each={data()!.category_tabs}>
              {(tab) => (
                <button
                  class={`wkn-tab${tab.nav_slug === activeNotesSlug() ? " wkn-tab--active" : ""}`}
                  onClick={() => navigateTo(tab.nav_slug)}
                >
                  {tab.title}
                  <Show when={tab.nav_slug === activeNotesSlug() && (data()?.page.resource_count ?? 0) > 0}>
                    <span class="wkn-tab-count">{data()!.page.resource_count}</span>
                  </Show>
                </button>
              )}
            </For>
          </div>
        </Show>

        {/* ── Scrollable body ── */}
        <div class="wkn-body">
          <Show when={data.loading}>
            <div class="wkn-loading">Loading…</div>
          </Show>

          <Show when={data()}>
            {(d) => (
              <div class="wkn-content">
                {/* Meta pill */}
                <div class="wkn-meta-pill">
                  <span class="wkn-meta-star">★</span>
                  <span class="wkn-meta-badge">Synthesised</span>
                  <span class="wkn-meta-dot">·</span>
                  <span>{d().page.resource_count} fragment{d().page.resource_count !== 1 ? "s" : ""}</span>
                  <span class="wkn-meta-dot">·</span>
                  <span>{timeAgo(d().page.time_updated)}</span>
                  <button class="wkn-regen-btn" onClick={() => refetch()}>
                    ↺ Regenerate
                  </button>
                </div>

                {/* Title */}
                <h1 class="wkn-title">{d().page.title}</h1>

                {/* Description / subtitle in orange */}
                <Show when={d().page.description}>
                  <p class="wkn-description">{d().page.description}</p>
                </Show>

                {/* Rendered markdown content */}
                <div
                  class="wk-prose wkn-prose"
                  innerHTML={renderMarkdown(rewrittenContent())}
                  onClick={(e) => handleProseClick(e, d().page.category_slug ?? "")}
                />
              </div>
            )}
          </Show>
        </div>
      </div>
    </Show>
  )
}
