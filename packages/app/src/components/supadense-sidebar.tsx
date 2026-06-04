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
import { activeSidebarView, setActiveSidebarView, setActiveGraphProjectId, setActiveGraphProjectName } from "@/context/sidebar-view"

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
    id: "graph",
    label: "Graph",
    path: "/projects",
    icon: "M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M5 5m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M19 5m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M5 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M19 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M10 10l-3-3M14 10l3-3M10 14l-3 3M14 14l3 3",
  },
  {
    id: "sources",
    label: "Sources",
    path: "/sources",
    icon: "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z",
  },
  {
    id: "notes",
    label: "Eng Notes",
    path: "/notes",
    icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h6",
  },
  {
    id: "experiments",
    label: "Experiments",
    path: "/experiments",
    icon: "M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v11m0 0a3 3 0 1 0 6 0M9 14h6M14 3v11",
  },
  {
    id: "members",
    label: "Members",
    path: "/members",
    icon: "M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0M4 20c0-4 3.6-7 8-7s8 3 8 7",
  },
  {
    id: "today",
    label: "Today",
    path: "/today",
    icon: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
  },
  {
    id: "gaps",
    label: "Gaps",
    path: "/gaps",
    icon: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01",
  },
  {
    id: "review",
    label: "Review",
    path: "/review",
    icon: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01",
  },
  {
    id: "chat",
    label: "Ask",
    path: "/ask",
    icon: "M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z",
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
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const [profileOpen, setProfileOpen] = createSignal(false)

  // On mount: set initial view based on URL so Graph is highlighted on first load
  onMount(() => {
    const p = location.pathname
    if (p.startsWith("/projects") || p === "/") {
      setActiveSidebarView({ section: "workspace", view: "lib", label: "Graph" })
    }
  })

  // Active nav id: always driven by activeSidebarView signal first, fall back to URL
  const activeId = () => {
    const view = activeSidebarView().view
    if (view === "read") return "sources"
    if (view === "notes") return "notes"
    if (view === "lib") return "graph"
    // For other view values that match a nav id directly
    if (NAV_ITEMS.some(n => n.id === view)) return view
    // Fall back to URL
    const p = location.pathname
    if (p.startsWith("/projects") || p === "/") return "graph"
    return "graph"
  }

  const initials = () => {
    const e = props.userEmail || ""
    const name = e.split("@")[0] || "U"
    return name.substring(0, 2).toUpperCase()
  }

  const username = () => (props.userEmail || "").split("@")[0] || "user"

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
                    // Graph has a real route
                    setActiveGraphProjectId(null)
                    setActiveGraphProjectName(null)
                    setActiveSidebarView({ section: "workspace", view: "lib", label: "Graph" })
                    navigate("/projects")
                  } else if (item.id === "sources") {
                    setActiveSidebarView({ section: "workspace", view: "read", label: "Sources" })
                  } else if (item.id === "notes") {
                    setActiveSidebarView({ section: "workspace", view: "notes", label: "Eng Notes" })
                  } else {
                    // For other virtual tabs just switch the view, don't navigate
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

      {/* ── Spacer ── */}
      <div style={{ flex: "1" }} />

      {/* ── User pill ── */}
      <div
        style={{
          "margin-top": "auto",
          padding: "12px 10px",
          "border-top": `1px solid ${T.ground300}`,
          display: "flex",
          "align-items": "center",
          gap: "10px",
          cursor: "pointer",
          "border-radius": T.radiusSm,
          transition: "background 140ms",
          position: "relative",
          background: profileOpen() ? T.ground150 : "transparent",
          "flex-shrink": "0",
        }}
        onClick={() => setProfileOpen((v) => !v)}
        onMouseEnter={(e) => { if (!profileOpen()) e.currentTarget.style.background = T.ground150 }}
        onMouseLeave={(e) => { if (!profileOpen()) e.currentTarget.style.background = "transparent" }}
      >
        {/* Avatar */}
        <div
          style={{
            width: "30px",
            height: "30px",
            "border-radius": "50%",
            background: T.amber300,
            color: T.ground050,
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            "font-family": T.fontMono,
            "font-weight": "600",
            "font-size": "12px",
            "flex-shrink": "0",
          }}
        >
          {initials()}
        </div>

        {/* Name + meta */}
        <div style={{ "min-width": "0" }}>
          <div
            style={{
              "font-size": "13px",
              "font-weight": "500",
              color: T.ink100,
              "line-height": "1.1",
              "font-family": T.fontSans,
              overflow: "hidden",
              "text-overflow": "ellipsis",
              "white-space": "nowrap",
            }}
          >
            {username()}
          </div>
          <div
            style={{
              "font-family": T.fontMono,
              "font-size": "10px",
              "letter-spacing": "0.06em",
              color: T.ink400,
              "text-transform": "uppercase",
            }}
          >
            {props.userEmail || "—"}
          </div>
        </div>

        {/* Caret */}
        <svg
          width="12" height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke={T.ink400}
          stroke-width="2.2"
          style={{
            "margin-left": "auto",
            "flex-shrink": "0",
            transform: profileOpen() ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 160ms",
          }}
        >
          <polyline points="18 15 12 9 6 15" />
        </svg>

        {/* Profile popover */}
        <Show when={profileOpen()}>
          <div
            style={{
              position: "absolute",
              bottom: "calc(100% + 6px)",
              left: "8px",
              width: "200px",
              background: T.ground150,
              border: `1px solid ${T.ground400}`,
              "border-radius": T.radiusMd,
              "box-shadow": "0 8px 24px rgba(0,0,0,0.18)",
              padding: "6px",
              "z-index": "200",
              display: "flex",
              "flex-direction": "column",
              gap: "2px",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              style={{
                padding: "10px 10px 8px",
                "border-bottom": `1px solid ${T.ground300}`,
                "margin-bottom": "4px",
              }}
            >
              <div style={{ "font-size": "13px", "font-weight": "600", color: T.ink100, "line-height": "1.2", "font-family": T.fontSans }}>
                {username()}
              </div>
              <div style={{ "font-family": T.fontMono, "font-size": "10px", color: T.ink400, "letter-spacing": "0.04em", "margin-top": "2px" }}>
                {props.userEmail}
              </div>
            </div>

            <PopItem
              icon="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"
              label="Profile"
              onClick={() => setProfileOpen(false)}
            />

            <div style={{ height: "1px", background: T.ground300, margin: "2px 0" }} />

            <PopItem
              icon="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"
              label="Log out"
              danger
              onClick={() => {
                setProfileOpen(false)
                props.onLogout?.()
              }}
            />
          </div>
        </Show>
      </div>
    </aside>
  )
}

function PopItem(props: { icon: string; label: string; danger?: boolean; onClick: () => void }) {
  const [hov, setHov] = createSignal(false)
  return (
    <button
      type="button"
      onClick={props.onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex",
        "align-items": "center",
        gap: "10px",
        width: "100%",
        padding: "7px 10px",
        background: hov() ? T.ground300 : "transparent",
        border: "none",
        "border-radius": T.radiusXs,
        cursor: "pointer",
        "font-size": "13px",
        "font-family": T.fontSans,
        color: props.danger ? "#dc2626" : T.ink200,
        "text-align": "left",
        transition: "background 100ms",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d={props.icon} />
      </svg>
      {props.label}
    </button>
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
