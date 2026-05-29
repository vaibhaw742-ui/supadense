import { createEffect, createMemo, createSignal, Show, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocation, useNavigate } from "@solidjs/router"
import { useTheme } from "@opencode-ai/ui/theme/context"

import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { applyPath, backPath, forwardPath } from "./titlebar-history"
import { activeSidebarView, setActiveSidebarView } from "@/context/sidebar-view"
import { chatOpen, setChatOpen } from "@/context/chat-overlay"

type TauriDesktopWindow = {
  startDragging?: () => Promise<void>
  toggleMaximize?: () => Promise<void>
}

type TauriThemeWindow = {
  setTheme?: (theme?: "light" | "dark" | null) => Promise<void>
}

type TauriApi = {
  window?: {
    getCurrentWindow?: () => TauriDesktopWindow
  }
  webviewWindow?: {
    getCurrentWebviewWindow?: () => TauriThemeWindow
  }
}

const tauriApi = () => (window as unknown as { __TAURI__?: TauriApi }).__TAURI__
const currentThemeWindow = () => tauriApi()?.webviewWindow?.getCurrentWebviewWindow?.()

export function Titlebar(props: { onCapture?: () => void }) {
  const layout = useLayout()
  const platform = usePlatform()
  const command = useCommand()
  const language = useLanguage()
  const theme = useTheme()
  const navigate = useNavigate()
  const location = useLocation()

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

  createEffect(() => {
    if (platform.platform !== "desktop") return
    const scheme = theme.colorScheme()
    const value = scheme === "system" ? null : scheme
    const win = currentThemeWindow()
    if (!win?.setTheme) return
    void win.setTheme(value).catch(() => undefined)
  })

  const isGraph = () => activeSidebarView().view === "lib"

  const [hovWs, setHovWs] = createSignal(false)
  const [hovGraph, setHovGraph] = createSignal(false)
  const [hovCapture, setHovCapture] = createSignal(false)
  const [hovSidebar, setHovSidebar] = createSignal(false)
  const [hovPlus, setHovPlus] = createSignal(false)
  const [hovChat, setHovChat] = createSignal(false)

  /* Light theme tokens (sd v2: white canvas, dark ink) */
  const T = {
    bg: "#ffffff",
    border: "#e5e5e5",
    borderHov: "#d4d4d4",
    text: "#0a0a0a",
    textMuted: "#737373",
    textFaint: "#a3a3a3",
    amber: "#d68a2e",
    surfaceHov: "#fafafa",
  }

  const tabStyle = (active: boolean, hov: boolean) => ({
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: "4px 2px",
    "font-family": "'Geist Mono', 'JetBrains Mono', monospace",
    "font-size": "11px",
    "letter-spacing": "0.08em",
    "text-transform": "uppercase" as const,
    color: active ? T.amber : hov ? T.textMuted : T.textFaint,
    "border-bottom": active ? `1px solid ${T.amber}` : "1px solid transparent",
    transition: "color 120ms, border-color 120ms",
  })

  const iconBtnStyle = (hov: boolean) => ({
    display: "flex",
    "align-items": "center",
    "justify-content": "center",
    width: "30px",
    height: "30px",
    background: hov ? T.surfaceHov : "transparent",
    border: `1px solid ${hov ? T.border : "transparent"}`,
    "border-radius": "4px",
    cursor: "pointer",
    color: hov ? T.textMuted : T.textFaint,
    transition: "background 120ms, border-color 120ms, color 120ms",
    "flex-shrink": "0",
  })

  return (
    <header
      style={{
        display: "flex",
        "align-items": "center",
        height: "52px",
        "flex-shrink": "0",
        background: T.bg,

        "padding-right": "16px",
      }}
    >
      {/* ── LEFT SPACER ── matches sidebar width so tabs start right after sidebar */}
      <div style={{
        display: "flex",
        "align-items": "center",
        "justify-content": "flex-end",
        "flex-shrink": "0",
        width: layout.sidebar.opened() ? `${layout.sidebar.width() + 8}px` : "auto",
        padding: layout.sidebar.opened() ? "0" : "0 16px",
        "box-sizing": "border-box",
      }}>
        <Show when={!layout.sidebar.opened()}>
          <button
            type="button"
            title="Open sidebar"
            style={iconBtnStyle(hovSidebar())}
            onMouseEnter={() => setHovSidebar(true)}
            onMouseLeave={() => setHovSidebar(false)}
            onClick={() => layout.sidebar.open()}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2"/>
              <line x1="9" y1="4" x2="9" y2="20"/>
            </svg>
          </button>
        </Show>
      </div>

      {/* ── TABS ── appear just right of the sidebar */}
      <div style={{ display: "flex", "align-items": "center", gap: "0", padding: "0 16px" }}>
          <button
            type="button"
            style={tabStyle(!isGraph(), hovWs())}
            onMouseEnter={() => setHovWs(true)}
            onMouseLeave={() => setHovWs(false)}
            onClick={() => {
              if (isGraph()) setActiveSidebarView({ section: "workspace", view: "read", label: "Sources" })
            }}
          >
            Workspace
          </button>
          <span style={{
            "font-family": "'Geist Mono', 'JetBrains Mono', monospace",
            "font-size": "11px",
            color: T.textFaint,
            "padding": "0 10px",
            "user-select": "none",
          }}>·</span>
          <button
            type="button"
            style={tabStyle(isGraph(), hovGraph())}
            onMouseEnter={() => setHovGraph(true)}
            onMouseLeave={() => setHovGraph(false)}
            onClick={() => setActiveSidebarView({ section: "workspace", view: "lib", label: "Graph" })}
          >
            Graph
          </button>
        </div>

      {/* ── RIGHT ACTIONS ── pushed to far right */}
      <div style={{ display: "flex", "align-items": "center", gap: "8px", "margin-left": "auto" }}>
        {/* Capture button */}
        <button
          type="button"
          title="Capture a resource"
          style={{
            display: "inline-flex",
            "align-items": "center",
            gap: "6px",
            padding: "6px 12px",
            "border-radius": "4px",
            "font-family": "inherit",
            "font-size": "12px",
            "font-weight": "500",
            "letter-spacing": "-0.01em",
            border: `1px solid ${hovCapture() ? T.borderHov : T.border}`,
            background: hovCapture() ? T.surfaceHov : T.bg,
            color: hovCapture() ? T.textMuted : T.textMuted,
            cursor: "pointer",
            transition: "all 120ms",
          }}
          onMouseEnter={() => setHovCapture(true)}
          onMouseLeave={() => setHovCapture(false)}
          onClick={() => props.onCapture?.()}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Capture
        </button>

        {/* Chat toggle (sd-mark grid) */}
        <button
          type="button"
          title="Ask supadense"
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            width: "32px",
            height: "32px",
            background: chatOpen() ? "rgba(214,138,46,0.08)" : hovChat() ? T.surfaceHov : "transparent",
            border: `1px solid ${chatOpen() ? "rgba(214,138,46,0.35)" : hovChat() ? T.border : "transparent"}`,
            "border-radius": "4px",
            cursor: "pointer",
            transition: "background 120ms, border-color 120ms",
            padding: "0",
          }}
          onMouseEnter={() => setHovChat(true)}
          onMouseLeave={() => setHovChat(false)}
          onClick={() => setChatOpen((v) => !v)}
        >
          {/* 3×3 ask-glyph matching app.html .rail-toggle */}
          <span style={{
            display: "inline-grid",
            "grid-template-columns": "repeat(3, 1fr)",
            "grid-template-rows": "repeat(3, 1fr)",
            gap: "2px",
            width: "16px",
            height: "16px",
            "flex-shrink": "0",
          }} aria-hidden="true">
            {([0,1,2,3,4,5,6,7,8] as const).map((i) => (
              <span style={{
                display: "block",
                background: i === 4 ? T.amber : chatOpen() ? T.amber : T.text,
                "border-radius": "1px",
              }} />
            ))}
          </span>
        </button>
      </div>
    </header>
  )
}
