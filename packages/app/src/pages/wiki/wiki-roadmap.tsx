import { createResource, For, Show, createSignal } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useWikiApi, type WikiRoadmapDoc } from "./wiki-api"
import "./wiki.css"

export default function WikiRoadmapList() {
  const api = useWikiApi()
  const navigate = useNavigate()
  const params = useParams<{ dir: string }>()
  const [sidebarOpen, setSidebarOpen] = createSignal(true)

  const [data] = createResource(() => api.roadmapList())

  const go = (slug: string) => navigate(`/${params.dir}/wiki/roadmap/${slug}`)
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
              <a class="wk-sb-link wk-sb-link-active" onClick={() => navigate(`/${params.dir}/wiki/roadmap`)}>Roadmaps</a>
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
              <div class="wk-loading">Loading roadmaps…</div>
            </Show>

            <Show when={data()}>
              {(d) => (
                <>
                  <h1 class="wk-title">Roadmaps</h1>
                  <p class="wk-subtitle">Learning paths and blog posts generated from your KB</p>

                  <Show
                    when={d().docs.length > 0}
                    fallback={
                      <p style={{ color: "var(--wk-text-faint)", "font-size": "13px", "margin-top": "24px" }}>
                        No roadmaps yet. Ask the assistant to "create a roadmap" or "write a blog post".
                      </p>
                    }
                  >
                    <div class="wk-section-label" style={{ "margin-top": "4px" }}>All docs</div>
                    <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
                      <For each={d().docs}>
                        {(doc) => <RoadmapCard doc={doc} onClick={() => go(doc.slug)} />}
                      </For>
                    </div>
                  </Show>
                </>
              )}
            </Show>
          </main>
        </div>

      </div>
    </div>
  )
}

function RoadmapCard(props: { doc: WikiRoadmapDoc; onClick: () => void }) {
  const formatDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : ""

  return (
    <div class="wk-card" onClick={props.onClick} style={{ display: "flex", "align-items": "center", gap: "12px" }}>
      <div style={{ flex: 1 }}>
        <div class="wk-card-title">{props.doc.title}</div>
        <Show when={props.doc.created}>
          <div class="wk-card-desc">{formatDate(props.doc.created)}</div>
        </Show>
      </div>
      <span style={{
        "font-size": "11px",
        padding: "2px 7px",
        "border-radius": "4px",
        background: props.doc.type === "roadmap" ? "var(--wk-accent-light)" : "rgba(99,102,241,0.08)",
        color: props.doc.type === "roadmap" ? "var(--wk-accent)" : "var(--wk-purple)",
        "flex-shrink": "0",
      }}>
        {props.doc.type}
      </span>
    </div>
  )
}
