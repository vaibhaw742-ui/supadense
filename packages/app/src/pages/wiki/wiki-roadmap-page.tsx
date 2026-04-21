import { createResource, createSignal, createMemo, Show } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useWikiApi } from "./wiki-api"
import { useServer } from "@/context/server"
import { renderMarkdown } from "./markdown"
import "./wiki.css"

export default function WikiRoadmapPage() {
  const api = useWikiApi()
  const server = useServer()
  const navigate = useNavigate()
  const params = useParams<{ dir: string; slug: string }>()
  const [sidebarOpen, setSidebarOpen] = createSignal(true)

  const [data] = createResource(() => params.slug, (slug) => api.roadmapDoc(slug))

  const wikiBase = () => {
    const http = server.current?.http
    if (!http) return "http://localhost:4096/wiki"
    const base = typeof http === "string" ? http : (http as { url: string }).url
    return `${base}/wiki`
  }

  const rewrittenContent = createMemo(() => {
    const content = data()?.content ?? ""
    return content
      .replace(/!\[([^\]]*)\]\((\.\.\/assets\/[^)]+)\)/g, (_, alt, p) =>
        `![${alt}](${wikiBase()}/assets/${p.replace(/^\.\.\/assets\//, "")})`)
      .replace(/!\[([^\]]*)\]\((\/wiki\/assets\/[^)]+)\)/g, (_, alt, p) =>
        `![${alt}](${wikiBase()}${p})`)
      .replace(/!\[([^\]]*)\]\((assets\/[^)]+)\)/g, (_, alt, p) =>
        `![${alt}](${wikiBase()}/${p})`)
  })

  const formatDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : ""

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
              <div class="wk-sb-label" style={{ "margin-top": "8px" }}>Wiki</div>
              <a class="wk-sb-link" onClick={() => navigate(`/${params.dir}/wiki`)}>Home</a>
              <a class="wk-sb-link" onClick={() => navigate(`/${params.dir}/wiki/roadmap`)}>Roadmaps</a>
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
        <div class="wk-content-area">
          <main class="wk-main">
            <Show when={data.loading}>
              <div class="wk-loading">Loading…</div>
            </Show>

            <Show when={data()}>
              {(d) => (
                <div class="wk-page-content">
                  <div class="wk-breadcrumb">
                    <span class="wk-breadcrumb-link" onClick={() => navigate(`/${params.dir}/wiki`)}>Supadense</span>
                    <span class="wk-breadcrumb-sep">›</span>
                    <span class="wk-breadcrumb-link" onClick={() => navigate(`/${params.dir}/wiki/roadmap`)}>Roadmaps</span>
                    <span class="wk-breadcrumb-sep">›</span>
                    <span class="wk-breadcrumb-current">{d().title}</span>
                  </div>

                  <h1 class="wk-page-title">{d().title}</h1>

                  <div class="wk-page-meta">
                    <span style={{
                      padding: "1px 7px",
                      "border-radius": "4px",
                      background: d().type === "roadmap" ? "var(--wk-accent-light)" : "rgba(99,102,241,0.08)",
                      color: d().type === "roadmap" ? "var(--wk-accent)" : "var(--wk-purple)",
                    }}>
                      {d().type}
                    </span>
                    <Show when={d().created}>
                      <span>·</span>
                      <span>{formatDate(d().created)}</span>
                    </Show>
                  </div>

                  <div class="wk-prose" innerHTML={renderMarkdown(rewrittenContent())} />
                </div>
              )}
            </Show>
          </main>
        </div>

      </div>
    </div>
  )
}
