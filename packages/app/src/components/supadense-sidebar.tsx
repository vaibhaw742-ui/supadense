/**
 * SupadenseSidebar
 * Left-rail navigation matching the reference app.html design.
 * Uses inline styles with Supadense design tokens so it works
 * without any extra CSS file.
 */
import { createSignal, Show, For, onMount } from "solid-js"
import { useNavigate, useLocation } from "@solidjs/router"
import { SupadenseMark } from "@/components/supadense-chat-panel"
import { clearAuthToken, getAuthToken } from "@/utils/server"
import { useServer } from "@/context/server"
import { activeSidebarView, setActiveSidebarView, setActiveGraphProjectId, setActiveGraphProjectName, activeGraphProjectId } from "@/context/sidebar-view"
import { elApi } from "@/pages/projects/el-api"
import { base64Encode } from "@opencode-ai/util/encode"

// ── Design tokens (mirrored from colors_and_type.css) ────────────────────────
const T = {
  ground000: "#f4f4f5",   /* sd-ground-000: sidebar bg */
  ground050: "#ffffff",   /* sd-ground-050: canvas */
  ground100: "#ffffff",   /* sd-ground-100: cards */
  ground150: "#fafafa",   /* sd-ground-150: hover */
  ground300: "#e5e5e5",   /* sd-ground-300: hairlines */
  ground400: "#d4d4d4",   /* sd-ground-400 */
  ink100: "#0a0a0a",
  ink200: "#262626",
  ink300: "#525252",
  ink400: "#737373",
  amber300: "#d68a2e",
  amber400: "#a8661c",
  radiusXs: "2px",
  radiusSm: "4px",
  radiusMd: "6px",
  radiusLg: "10px",
  fontSans: '"Geist", ui-sans-serif, system-ui, sans-serif',
  fontMono: '"Geist Mono", ui-monospace, "JetBrains Mono", monospace',
}

// ── Nav item definitions ──────────────────────────────────────────────────────
type NavItem = {
  id: string
  label: string
  path: string
  icon: string   // SVG path data
  count?: string
}

const NAV_ITEMS: NavItem[] = [
  {
    id: "today",
    label: "Overview",
    path: "/today",
    icon: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
  },
  {
    id: "chat",
    label: "Playground",
    path: "/ask",
    icon: "M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z",
  },
  {
    id: "sources",
    label: "Documents",
    path: "/sources",
    icon: "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z",
  },
  {
    id: "graph",
    label: "Project Tags",
    path: "/projects",
    icon: "M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M5 5m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M19 5m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M5 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M19 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M10 10l-3-3M14 10l3-3M10 14l-3 3M14 14l3 3",
  },
  {
    id: "experiments",
    label: "Graph",
    path: "/experiments",
    icon: "M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v11m0 0a3 3 0 1 0 6 0M9 14h6M14 3v11",
  },
  {
    id: "notes",
    label: "Eng Notes",
    path: "/notes",
    icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h6",
  },
  {
    id: "requests",
    label: "Requests",
    path: "/requests",
    icon: "M22 12h-4l-3 9L9 3l-3 9H2",
  },
]

function NavIcon(props: { d: string; active: boolean }) {
  return (
    <svg
      width="16" height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke={props.active ? T.amber300 : T.ink400}
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      style={{ "flex-shrink": "0" }}
    >
      <path d={props.d} />
    </svg>
  )
}

export function SupadenseSidebar(props: {
  collapsed: boolean
  onToggle: () => void
  userEmail: string
  onLogout?: () => void
  onCapture?: () => void
  onPlayground?: () => void
}) {
  const navigate = useNavigate()
  const location = useLocation()
  // On mount: set initial view based on URL so Graph is highlighted on first load
  onMount(() => {
    const p = location.pathname
    // Default view on load
    setActiveSidebarView({ section: "workspace", view: "project-tags", label: "Project Tags" })
  })

  // Active nav id: always driven by activeSidebarView signal first, fall back to URL
  const activeId = () => {
    const view = activeSidebarView().view
    if (view === "read") return "sources"
    if (view === "notes") return "notes"
    if (view === "lib" || view === "workspace-graph") return "experiments"
    if (view === "project-tags") return "graph"
    if (view === "ask") return "chat"
    // For other view values that match a nav id directly
    if (NAV_ITEMS.some(n => n.id === view)) return view
    return "graph"
  }

  return (
    <aside
      style={{
        background: T.ground000,
        "border-radius": T.radiusLg,
        display: "flex",
        "flex-direction": "column",
        overflow: "hidden",
        width: props.collapsed ? "0" : "240px",
        "min-width": props.collapsed ? "0" : "240px",
        transition: "width 220ms cubic-bezier(0.22,1,0.36,1), min-width 220ms cubic-bezier(0.22,1,0.36,1), opacity 160ms",
        opacity: props.collapsed ? "0" : "1",
        "pointer-events": props.collapsed ? "none" : "auto",
        "flex-shrink": "0",
        height: "100%",
      }}
      aria-label="Main navigation"
    >
      {/* ── Header ── */}
      <div
        style={{
          padding: "16px 14px",
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          "border-bottom": `1px solid ${T.ground300}`,
          "flex-shrink": "0",
        }}
      >
        {/* Wordmark */}
        <a
          href="/"
          style={{
            display: "inline-flex",
            "align-items": "center",
            gap: "10px",
            "font-weight": "500",
            "letter-spacing": "-0.02em",
            "font-size": "14px",
            color: T.ink100,
            "text-decoration": "none",
            "font-family": T.fontSans,
          }}
          onClick={(e) => { e.preventDefault(); navigate("/projects") }}
        >
          <SupadenseMark size={18} />
          <span>supadense</span>
        </a>

        {/* Head actions */}
        <div style={{ display: "flex", gap: "6px", "align-items": "center" }}>
          {/* Collapse toggle */}
          <button
            type="button"
            title="Collapse sidebar"
            aria-label="Toggle sidebar"
            onClick={props.onToggle}
            style={iconBtn()}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <line x1="9" y1="4" x2="9" y2="20" />
            </svg>
          </button>
          {/* Capture / Add */}
          <button
            type="button"
            title="Capture"
            aria-label="Capture"
            onClick={props.onCapture}
            style={iconBtn()}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Nav group label ── */}
      <div
        style={{
          padding: "12px 8px 6px",
          "font-family": T.fontMono,
          "font-size": "9px",
          "letter-spacing": "0.14em",
          "text-transform": "uppercase",
          color: T.ink400,
          "flex-shrink": "0",
        }}
      >
        workspace
      </div>

      {/* ── Nav list ── */}
      <nav
        style={{
          display: "flex",
          "flex-direction": "column",
          gap: "1px",
          padding: "0 8px",
          "flex-shrink": "0",
        }}
      >
        <For each={NAV_ITEMS}>
          {(item) => {
            const isActive = () => activeId() === item.id
            return (
              <button
                type="button"
                data-nav-id={item.id}
                onClick={() => {
                  if (item.id === "graph") {
                    // Project Tags list (unchanged)
                    setActiveSidebarView({ section: "workspace", view: "project-tags", label: "Project Tags" })
                  } else if (item.id === "experiments") {
                    // Workspace graph — all project tags as D3 force nodes
                    setActiveSidebarView({ section: "workspace", view: "workspace-graph", label: "Graph" })
                  } else if (item.id === "chat") {
                    setActiveSidebarView({ section: "workspace", view: "ask", label: "Playground" })
                    props.onPlayground?.()
                  } else if (item.id === "sources") {
                    setActiveSidebarView({ section: "workspace", view: "read", label: "Documents" })
                  } else if (item.id === "notes") {
                    setActiveSidebarView({ section: "workspace", view: "notes", label: "Eng Notes" })
                  } else {
                    setActiveSidebarView({ section: "workspace", view: item.id, label: item.label })
                  }
                }}
                style={{
                  padding: "7px 10px",
                  display: "flex",
                  "align-items": "center",
                  gap: "10px",
                  "font-size": "13px",
                  "font-family": T.fontSans,
                  color: isActive() ? T.ink100 : T.ink300,
                  "border-radius": T.radiusXs,
                  cursor: "pointer",
                  position: "relative",
                  border: "none",
                  background: isActive() ? T.ground150 : "transparent",
                  "text-align": "left",
                  width: "100%",
                  transition: "background 100ms, color 100ms",
                }}
                onMouseEnter={(e) => {
                  if (!isActive()) {
                    e.currentTarget.style.background = T.ground150
                    e.currentTarget.style.color = T.ink100
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive()) {
                    e.currentTarget.style.background = "transparent"
                    e.currentTarget.style.color = T.ink300
                  }
                }}
              >
                {/* Active amber left bar */}
                <Show when={isActive()}>
                  <span
                    style={{
                      position: "absolute",
                      left: "-8px",
                      top: "6px",
                      bottom: "6px",
                      width: "2px",
                      background: T.amber300,
                      "border-radius": "1px",
                    }}
                  />
                </Show>

                <NavIcon d={item.icon} active={isActive()} />
                <span style={{ flex: "1" }}>{item.label}</span>
                <Show when={item.count}>
                  <span
                    style={{
                      "margin-left": "auto",
                      "font-family": T.fontMono,
                      "font-size": "10px",
                      color: isActive() ? T.amber300 : T.ink400,
                      "letter-spacing": "0.04em",
                    }}
                  >
                    {item.count}
                  </span>
                </Show>
              </button>
            )
          }}
        </For>
      </nav>

      {/* ── Extra sections ── */}
      <div style={{ "overflow-y": "auto", flex: "1", padding: "0 8px 8px" }}>

        {/* ANALYTICS */}
        <div style={{ padding: "14px 8px 4px", "font-family": T.fontMono, "font-size": "9px", "letter-spacing": "0.14em", "text-transform": "uppercase", color: T.ink400 }}>
          analytics
        </div>
        {[
          { id: "gaps",   label: "Gaps",   badge: "14 open", icon: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01" },
          { id: "review", label: "Review", badge: "7 due",   icon: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" },
        ].map(item => (
          <button type="button" onClick={() => setActiveSidebarView({ section: "workspace", view: item.id, label: item.label })}
            style={{ padding: "7px 10px", display: "flex", "align-items": "center", gap: "10px", "font-size": "13px", "font-family": T.fontSans, color: T.ink300, "border-radius": T.radiusXs, cursor: "pointer", border: "none", background: "transparent", "text-align": "left", width: "100%", transition: "background 100ms, color 100ms" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = T.ground150; e.currentTarget.style.color = T.ink100 }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = T.ink300 }}
          >
            <NavIcon d={item.icon} active={false} />
            <span style={{ flex: "1" }}>{item.label}</span>
            <span style={{ "font-family": T.fontMono, "font-size": "10px", color: T.ink400 }}>{item.badge}</span>
          </button>
        ))}

        {/* DATA */}
        <div style={{ padding: "14px 8px 4px", "font-family": T.fontMono, "font-size": "9px", "letter-spacing": "0.14em", "text-transform": "uppercase", color: T.ink400 }}>
          data
        </div>
        {[
          { id: "connectors", label: "Connectors", icon: "M12 2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h4zM16 10h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2M8 10H6a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2M12 8v2M12 16v2M8 14h8" },
          { id: "import",     label: "Import",     icon: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" },
        ].map(item => (
          <button type="button" onClick={() => setActiveSidebarView({ section: "workspace", view: item.id, label: item.label })}
            style={{ padding: "7px 10px", display: "flex", "align-items": "center", gap: "10px", "font-size": "13px", "font-family": T.fontSans, color: T.ink300, "border-radius": T.radiusXs, cursor: "pointer", border: "none", background: "transparent", "text-align": "left", width: "100%", transition: "background 100ms, color 100ms" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = T.ground150; e.currentTarget.style.color = T.ink100 }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = T.ink300 }}
          >
            <NavIcon d={item.icon} active={false} />
            <span style={{ flex: "1" }}>{item.label}</span>
          </button>
        ))}

        {/* DEVELOPER */}
        <div style={{ padding: "14px 8px 4px", "font-family": T.fontMono, "font-size": "9px", "letter-spacing": "0.14em", "text-transform": "uppercase", color: T.ink400 }}>
          developer
        </div>
        {[
          { id: "apikeys",  label: "API Keys", icon: "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" },
          { id: "agents",   label: "Agents",   icon: "M12 2a5 5 0 1 0 0 10A5 5 0 0 0 12 2zM4 20c0-4 3.6-7 8-7s8 3 8 7M17 8h4M19 6v4" },
          { id: "plugins",  label: "Plugins",  icon: "M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z" },
        ].map(item => (
          <button type="button" onClick={() => setActiveSidebarView({ section: "workspace", view: item.id, label: item.label })}
            style={{ padding: "7px 10px", display: "flex", "align-items": "center", gap: "10px", "font-size": "13px", "font-family": T.fontSans, color: T.ink300, "border-radius": T.radiusXs, cursor: "pointer", border: "none", background: "transparent", "text-align": "left", width: "100%", transition: "background 100ms, color 100ms" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = T.ground150; e.currentTarget.style.color = T.ink100 }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = T.ink300 }}
          >
            <NavIcon d={item.icon} active={false} />
            <span style={{ flex: "1" }}>{item.label}</span>
          </button>
        ))}

        {/* ORGANIZATION */}
        <div style={{ padding: "14px 8px 4px", "font-family": T.fontMono, "font-size": "9px", "letter-spacing": "0.14em", "text-transform": "uppercase", color: T.ink400 }}>
          organization
        </div>
        {[
          { id: "team",     label: "Team",     icon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" },
          { id: "billing",  label: "Billing",  icon: "M1 4h22v16H1zM1 9h22" },
          { id: "settings", label: "Settings", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" },
        ].map(item => (
          <button type="button" onClick={() => setActiveSidebarView({ section: "workspace", view: item.id, label: item.label })}
            style={{ padding: "7px 10px", display: "flex", "align-items": "center", gap: "10px", "font-size": "13px", "font-family": T.fontSans, color: T.ink300, "border-radius": T.radiusXs, cursor: "pointer", border: "none", background: "transparent", "text-align": "left", width: "100%", transition: "background 100ms, color 100ms" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = T.ground150; e.currentTarget.style.color = T.ink100 }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = T.ink300 }}
          >
            <NavIcon d={item.icon} active={false} />
            <span style={{ flex: "1" }}>{item.label}</span>
          </button>
        ))}

      </div>

    </aside>
  )
}

// ── Collapsed toggle bar (shown when sidebar is hidden) ───────────────────────
export function SidebarCollapseToggle(props: { onClick: () => void }) {
  const [hov, setHov] = createSignal(false)
  return (
    <button
      type="button"
      title="Open sidebar"
      aria-label="Open sidebar"
      onClick={props.onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        ...iconBtn(),
        background: hov() ? T.ground150 : T.ground000,
        "border-color": hov() ? T.amber300 : T.ground300,
        color: hov() ? T.amber300 : T.ink300,
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <line x1="9" y1="4" x2="9" y2="20" />
      </svg>
    </button>
  )
}

function iconBtn(): Record<string, string> {
  return {
    width: "26px",
    height: "26px",
    border: `1px solid ${T.ground300}`,
    "border-radius": T.radiusXs,
    background: T.ground100,
    color: T.ink300,
    display: "inline-flex",
    "align-items": "center",
    "justify-content": "center",
    cursor: "pointer",
    "flex-shrink": "0",
    padding: "0",
    transition: "color 140ms, border-color 140ms, background 140ms",
  }
}
