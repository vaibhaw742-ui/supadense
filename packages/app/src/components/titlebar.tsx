/**
 * Supadense Topbar — matches app.html .topbar exactly
 * breadcrumbs · view-mode-group · Capture · ask-glyph toggle
 */
import { createEffect, createSignal, Show, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocation, useNavigate } from "@solidjs/router"
import { useTheme } from "@opencode-ai/ui/theme/context"
import { usePlatform } from "@/context/platform"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { applyPath, backPath, forwardPath } from "./titlebar-history"
import {
  activeSidebarView,
  setActiveSidebarView,
  activeGraphProjectId,
  activeGraphProjectName,
  setActiveGraphProjectId,
  setActiveGraphProjectName,
  activeSourceName,
  setActiveSourceName,
  sessionViewMode,
  setSessionViewMode,
  projectViewMode,
  setProjectViewMode,
} from "@/context/sidebar-view"
import { chatOpen, setChatOpen } from "@/context/chat-overlay"

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:        "#ffffff",   /* sd-ground-100: topbar bg */
  ground000: "#fafafa",   /* sd-ground-150: hover */
  border:    "#e5e5e5",   /* sd-ground-300: hairlines */
  borderMid: "#d4d4d4",   /* sd-ground-400 */
  ink100:    "#0a0a0a",
  ink300:    "#525252",
  ink400:    "#737373",
  ink500:    "#a3a3a3",
  amber:     "#d68a2e",
  amberBg:   "rgba(214,138,46,0.08)",
  amberBorder:"rgba(214,138,46,0.35)",
  fontMono:  '"Geist Mono", ui-monospace, monospace',
  fontSans:  '"Geist", ui-sans-serif, system-ui, sans-serif',
}

export function Titlebar(props: { onCapture?: () => void; onToggleSidebar?: () => void; sidebarCollapsed?: boolean }) {
  const location = useLocation()
  const navigate = useNavigate()
  const command = useCommand()
  const language = useLanguage()

  const [history, setHistory] = createStore({
    stack: [] as string[],
    index: 0,
    action: undefined as "back" | "forward" | undefined,
  })

  const path = () => `${location.pathname}${location.search}${location.hash}`

  createEffect(() => {
    const current = path()
    untrack(() => {
      const next = applyPath(history, current)
      if (next === history) return
      setHistory(next)
    })
  })

  const back = () => {
    const next = backPath(history)
    if (!next) return
    setHistory(next.state)
    navigate(next.to)
  }

  const forward = () => {
    const next = forwardPath(history)
    if (!next) return
    setHistory(next.state)
    navigate(next.to)
  }

  command.register(() => [
    {
      id: "common.goBack",
      title: language.t("common.goBack"),
      category: language.t("command.category.view"),
      keybind: "mod+[",
      onSelect: back,
    },
    {
      id: "common.goForward",
      title: language.t("common.goForward"),
      category: language.t("command.category.view"),
      keybind: "mod+]",
      onSelect: forward,
    },
  ])

  // ── Crumb derivation ──────────────────────────────────────────────────────
  const isGraph    = () => activeSidebarView().view === "lib"
  const isRead     = () => activeSidebarView().view === "read"
  const hasProject = () => !!activeGraphProjectId()
  const isGraphCtx = () => isGraph() || (isRead() && !!activeGraphProjectId())
  const hasAnySource = () => isRead() && !!activeSourceName()

  const crumbSection = () => {
    if (isGraphCtx() && hasProject()) return activeGraphProjectName() ?? "Graph"
    if (isGraphCtx()) return "Graph"
    if (isRead() && hasAnySource()) return activeSourceName() ?? "Sources"
    if (isRead()) return "Sources"
    return activeSidebarView().label || "Workspace"
  }

  // show view-mode-group only in session routes
  const isSession = () => /\/session(?:\/|$)/.test(location.pathname)

  // ── Hover states ─────────────────────────────────────────────────────────
  const [hovCapture, setHovCapture] = createSignal(false)

  return (
    <header
      style={{
        display: "flex",
        "align-items": "center",
        height: "52px",
        "flex-shrink": "0",
        background: C.bg,
        padding: "0 16px",
        gap: "8px",
      }}
    >
      {/* ── Topbar toggle — shown when sidebar is collapsed ── */}
      <Show when={props.sidebarCollapsed}>
        <button
          type="button"
          title="Open sidebar"
          aria-label="Open sidebar"
          onClick={props.onToggleSidebar}
          style={iconBtn(false)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <rect x="3" y="4" width="18" height="16" rx="2"/>
            <line x1="9" y1="4" x2="9" y2="20"/>
          </svg>
        </button>
      </Show>

      {/* ── Breadcrumbs ── */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          "font-family": C.fontMono,
          "font-size": "11px",
          "letter-spacing": "0.08em",
          "text-transform": "uppercase",
          color: C.ink500,
          gap: "0",
        }}
      >
        <span style={{ cursor: "pointer" }} onClick={() => navigate("/projects")}>
          workspace
        </span>
        <span style={{ padding: "0 10px", color: C.borderMid, "user-select": "none" }}>·</span>
        <Show
          when={activeGraphProjectName()}
          fallback={<span style={{ color: C.ink100 }}>{activeSidebarView().label || "Graph"}</span>}
        >
          <span
            style={{ cursor: "pointer", color: C.ink500 }}
            onClick={() => { setActiveGraphProjectId(null); setActiveGraphProjectName(null); navigate("/projects") }}
          >
            Graph
          </span>
          <span style={{ padding: "0 10px", color: C.borderMid, "user-select": "none" }}>·</span>
          <span style={{ color: C.ink100 }}>{activeGraphProjectName()}</span>
        </Show>
      </div>

      {/* ── Right actions ── */}
      <div style={{ display: "flex", "align-items": "center", gap: "8px", "margin-left": "auto" }}>

        {/* View-mode-group — only in session views */}
        <Show when={isSession()}>
          <div
            style={{
              display: "inline-flex",
              "align-items": "center",
              border: `1px solid ${C.borderMid}`,
              "border-radius": "6px",
              overflow: "hidden",
              background: C.bg,
            }}
          >
            {/* Brain */}
            <VmgBtn
              active={sessionViewMode() === "brain"}
              title="Brain"
              onClick={() => setSessionViewMode("brain")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
                <path d="M12 5a7 7 0 0 0-7 7c0 2.4 1.2 4.5 3 5.7V20h8v-2.3c1.8-1.2 3-3.3 3-5.7a7 7 0 0 0-7-7z"/>
                <line x1="9" y1="9" x2="9" y2="9.01"/><line x1="15" y1="9" x2="15" y2="9.01"/>
              </svg>
            </VmgBtn>

            {/* Sources/Files */}
            <VmgBtn
              active={sessionViewMode() === "sources"}
              title="Sources"
              onClick={() => setSessionViewMode("sources")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>
              </svg>
            </VmgBtn>

            {/* Code — active by default */}
            <VmgBtn
              active={sessionViewMode() === "code"}
              title="Code"
              onClick={() => setSessionViewMode("code")}
              label="Code"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <polyline points="16 18 22 12 16 6"/>
                <polyline points="8 6 2 12 8 18"/>
              </svg>
            </VmgBtn>

            {/* Layers */}
            <VmgBtn
              active={sessionViewMode() === "layers"}
              title="Layers"
              onClick={() => setSessionViewMode("layers")}
              last
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
                <polygon points="12 2 2 7 12 12 22 7 12 2"/>
                <polyline points="2 17 12 22 22 17"/>
                <polyline points="2 12 12 17 22 12"/>
              </svg>
            </VmgBtn>
          </div>
        </Show>

        {/* Project action group — shown when viewing a project */}
        <Show when={activeGraphProjectId()}>
          <div style={{ display: "inline-flex", "align-items": "center", border: `1px solid ${C.borderMid}`, "border-radius": "6px", overflow: "hidden", background: C.bg }}>
            <VmgBtn active={projectViewMode() === "graph"} title="Graph" onClick={() => setProjectViewMode("graph")}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            </VmgBtn>
            <VmgBtn active={projectViewMode() === "brain"} title="Brain files (.supadense)" onClick={() => setProjectViewMode(projectViewMode() === "brain" ? "graph" : "brain")}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </VmgBtn>
            <VmgBtn active={projectViewMode() === "code"} title="Source code" onClick={() => setProjectViewMode(projectViewMode() === "code" ? "graph" : "code")} label="Code">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
            </VmgBtn>
            <VmgBtn active={false} title="Layers" onClick={() => {}} last>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
            </VmgBtn>
          </div>
        </Show>

        {/* Capture button */}
        <button
          type="button"
          title="Capture"
          onMouseEnter={() => setHovCapture(true)}
          onMouseLeave={() => setHovCapture(false)}
          onClick={() => props.onCapture?.()}
          style={{
            display: "inline-flex",
            "align-items": "center",
            gap: "6px",
            padding: "6px 12px",
            "border-radius": "4px",
            "font-family": C.fontSans,
            "font-size": "12px",
            "font-weight": "500",
            border: `1px solid ${hovCapture() ? C.borderMid : C.border}`,
            background: hovCapture() ? C.ground000 : C.bg,
            color: C.ink300,
            cursor: "pointer",
            transition: "all 120ms",
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Capture
        </button>

        {/* Rail toggle — 3×3 ask glyph */}
        <button
          type="button"
          title="Toggle Ask panel"
          aria-label="Toggle Ask panel"
          onClick={() => setChatOpen((v) => !v)}
          style={{
            ...iconBtn(chatOpen()),
            background: chatOpen() ? C.amberBg : "transparent",
            border: `1px solid ${chatOpen() ? C.amberBorder : C.border}`,
            color: chatOpen() ? C.amber : C.ink300,
          }}
        >
          {/* 3×3 glyph */}
          <span
            style={{
              display: "inline-grid",
              "grid-template-columns": "repeat(3, 1fr)",
              "grid-template-rows": "repeat(3, 1fr)",
              gap: "1.5px",
              width: "14px",
              height: "14px",
            }}
            aria-hidden="true"
          >
            {([0,1,2,3,4,5,6,7,8] as const).map((i) => (
              <span style={{
                display: "block",
                background: i === 4 ? C.amber : chatOpen() ? C.amber : C.ink100,
                "border-radius": "1px",
              }} />
            ))}
          </span>
        </button>
      </div>
    </header>
  )
}

// ── Vmg button helper ─────────────────────────────────────────────────────────
function VmgBtn(props: {
  active: boolean
  title: string
  onClick: () => void
  label?: string
  last?: boolean
  children: any
}) {
  const [hov, setHov] = createSignal(false)
  return (
    <button
      type="button"
      title={props.title}
      onClick={props.onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "inline-flex",
        "align-items": "center",
        gap: "5px",
        padding: "5px 10px",
        background: props.active ? "#fafafa" : hov() ? "#ffffff" : "none",
        border: "none",
        "border-right": props.last ? "none" : "1px solid #d4d4d4",
        color: props.active ? "#0a0a0a" : hov() ? "#262626" : "#737373",
        "font-family": '"Geist Mono", ui-monospace, monospace',
        "font-size": "11px",
        "letter-spacing": "0.04em",
        cursor: "pointer",
        transition: "background 120ms, color 120ms",
        "flex-shrink": "0",
      }}
    >
      {props.children}
      <Show when={props.label}>
        <span>{props.label}</span>
      </Show>
    </button>
  )
}

function iconBtn(active: boolean): Record<string, string> {
  return {
    display: "inline-flex",
    "align-items": "center",
    "justify-content": "center",
    width: "28px",
    height: "28px",
    border: `1px solid ${active ? "rgba(214,138,46,0.35)" : "#e5e5e5"}`,
    "border-radius": "4px",
    background: active ? "rgba(214,138,46,0.08)" : "transparent",
    color: active ? "#d68a2e" : "#525252",
    cursor: "pointer",
    "flex-shrink": "0",
    padding: "0",
    transition: "background 120ms, border-color 120ms, color 120ms",
  }
}
