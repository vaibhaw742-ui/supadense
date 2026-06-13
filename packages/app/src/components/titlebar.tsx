/**
 * Supadense Topbar — matches app.html .topbar exactly
 * breadcrumbs · view-mode-group · Capture · ask-glyph toggle
 */
import { createEffect, createMemo, createSignal, For, Show, untrack } from "solid-js"
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
  brainGraphOpen,
  brainViewMode,
  setBrainViewMode,
  codeDrawerOpen,
  setCodeDrawerOpen,
  sourcesDrawerOpen,
  setSourcesDrawerOpen,
  projectPanelMode,
  setProjectPanelMode,
} from "@/context/sidebar-view"
import { chatOpen, setChatOpen } from "@/context/chat-overlay"
import { useGlobalSync } from "@/context/global-sync"
import { activeChatProjectDir, activeSessionId } from "@/context/sidebar-view"
import type { Session } from "@opencode-ai/sdk/v2/client"

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

export function Titlebar(props: { onCapture?: () => void; onToggleSidebar?: () => void; sidebarCollapsed?: boolean; userEmail?: string; onLogout?: () => void; onNewChat?: () => void }) {
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

  // ── New Chat dropdown ─────────────────────────────────────────────────────
  const [newChatDropOpen, setNewChatDropOpen] = createSignal(false)
  const [newChatSessionId, setNewChatSessionId] = createSignal<string | undefined>(undefined)
  const globalSync = useGlobalSync()

  // Keep dropdown highlight in sync with the chat panel's active session
  createEffect(() => {
    const id = activeSessionId()
    if (id) setNewChatSessionId(id)
  })

  // Reactive child store — re-subscribes whenever the active project changes
  const newChatSessions = createMemo(() => {
    const dir = activeChatProjectDir()
    if (!dir) return [] as Session[]
    const [store] = globalSync.child(dir, { bootstrap: false })
    const sessions: Session[] = (store?.session ?? [])
    return sessions
      .filter((s: Session) => !s.parentID)
      .slice()
      .sort((a: Session, b: Session) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))
  })

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

      {/* ── New Chat dropdown — only when a project is active ── */}
      <Show when={activeChatProjectDir()}>
      <div style={{ position: "relative", "flex-shrink": "0" }}>
        <button
          type="button"
          onClick={() => { setChatOpen(true); setNewChatDropOpen(o => !o) }}
          style={{ display: "inline-flex", "align-items": "center", gap: "4px", padding: "5px 8px", border: "none", background: "none", color: "#737373", "font-family": '"Geist Mono", ui-monospace, monospace', "font-size": "11px", "letter-spacing": "0.04em", cursor: "pointer", transition: "background 120ms, color 120ms", "flex-shrink": "0" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#ffffff"; (e.currentTarget as HTMLElement).style.color = "#262626" }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none"; (e.currentTarget as HTMLElement).style.color = "#737373" }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </button>

        <Show when={newChatDropOpen()}>
          <div style={{ position: "fixed", inset: "0", "z-index": "498" }} onClick={() => setNewChatDropOpen(false)} />
          <div style={{ position: "absolute", top: "calc(100% + 4px)", left: "0", "min-width": "240px", background: "#ffffff", border: `1px solid ${C.border}`, "border-radius": "8px", "box-shadow": "0 8px 24px rgba(0,0,0,0.12)", "z-index": "499", overflow: "hidden" }}>
            {/* + New chat */}
            <button
              type="button"
              onClick={() => { setNewChatSessionId(undefined); setNewChatDropOpen(false); props.onNewChat?.() }}
              style={{ display: "flex", "align-items": "center", gap: "8px", width: "100%", padding: "10px 14px", border: "none", "border-bottom": `1px solid ${C.border}`, background: "none", cursor: "pointer", "font-family": C.fontSans, "font-size": "13px", "font-weight": "500", color: C.amber, "text-align": "left" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#fafafa" }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none" }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              New chat
            </button>
            {/* Sessions */}
            <div style={{ "max-height": "260px", "overflow-y": "auto" }}>
              <Show when={newChatSessions().length > 0} fallback={
                <div style={{ padding: "12px 14px", "font-size": "12px", color: C.ink500 }}>No previous sessions</div>
              }>
                <For each={newChatSessions()}>
                  {(session: Session) => (
                    <button
                      type="button"
                      onClick={() => {
                        setNewChatSessionId(session.id)
                        setNewChatDropOpen(false)
                        const dir = activeChatProjectDir()
                        if (dir) window.dispatchEvent(new CustomEvent("supadense:select-session", { detail: { sessionId: session.id, dir } }))
                      }}
                      style={{ display: "flex", "align-items": "flex-start", "flex-direction": "column", width: "100%", padding: "8px 14px", border: "none", "border-left": newChatSessionId() === session.id ? `2px solid ${C.amber}` : "2px solid transparent", background: newChatSessionId() === session.id ? "#fafafa" : "none", cursor: "pointer", "font-family": C.fontSans, "text-align": "left" }}
                      onMouseEnter={(e) => { if (newChatSessionId() !== session.id) (e.currentTarget as HTMLElement).style.background = "#fafafa" }}
                      onMouseLeave={(e) => { if (newChatSessionId() !== session.id) (e.currentTarget as HTMLElement).style.background = "none" }}
                    >
                      <span style={{ "font-size": "13px", color: C.ink100, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap", width: "100%" }}>
                        {(session.title?.trim() || "New session")}
                      </span>
                      <Show when={session.time?.updated}>
                        <span style={{ "font-size": "11px", color: C.ink500, "margin-top": "1px" }}>
                          {new Date(session.time!.updated!).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </Show>
                    </button>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </Show>
      </div>
      </Show>

      {/* ── Right actions ── */}
      <div style={{ display: "flex", "align-items": "center", gap: "8px", "margin-left": "auto" }}>

        {/* View-mode-group — in project session or local project chat */}
        <Show when={!activeGraphProjectId() && (activeSidebarView().view === "ask" || activeChatProjectDir())}>
          <div style={{ display: "inline-flex", "align-items": "center", border: `1px solid ${C.borderMid}`, "border-radius": "6px", overflow: "hidden", background: C.bg }}>
            {/* Eng Commits */}
            <VmgBtn active={projectPanelMode() === "commits"} title="Eng Commits" onClick={() => setProjectPanelMode("commits")}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><line x1="3" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="21" y2="12"/></svg>
            </VmgBtn>
            {/* Brain */}
            <VmgBtn active={projectPanelMode() === "brain"} title="Brain" onClick={() => setProjectPanelMode("brain")}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5a7 7 0 0 0-7 7c0 2.4 1.2 4.5 3 5.7V20h8v-2.3c1.8-1.2 3-3.3 3-5.7a7 7 0 0 0-7-7z"/><line x1="9" y1="9" x2="9" y2="9.01"/><line x1="15" y1="9" x2="15" y2="9.01"/></svg>
            </VmgBtn>
            {/* Code */}
            <VmgBtn active={projectPanelMode() === "code"} title="Code" onClick={() => setProjectPanelMode("code")}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
            </VmgBtn>
            {/* More */}
            <VmgBtn active={sessionViewMode() === "layers"} title="More" onClick={() => setSessionViewMode("layers")} last>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="5" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="19" r="1" fill="currentColor"/></svg>
            </VmgBtn>
          </div>
        </Show>

        {/* Project action group */}
        <Show when={activeGraphProjectId()}>
          <div style={{ display: "inline-flex", "align-items": "center", border: `1px solid ${C.borderMid}`, "border-radius": "6px", overflow: "hidden", background: C.bg }}>
            <VmgBtn active={projectViewMode() === "graph"} title="Graph" onClick={() => setProjectViewMode("graph")}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            </VmgBtn>
            <VmgBtn active={projectViewMode() === "brain"} title="Brain files" onClick={() => setProjectViewMode(projectViewMode() === "brain" ? "graph" : "brain")}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </VmgBtn>
            <VmgBtn active={codeDrawerOpen()} title="Source code" onClick={() => setCodeDrawerOpen(o => !o)} label="Code">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
            </VmgBtn>
            <VmgBtn active={false} title="Layers" onClick={() => {}} last>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
            </VmgBtn>
          </div>
        </Show>

        {/* Brain graph view-mode buttons — only when brain graph overlay is open */}
        <Show when={brainGraphOpen()}>
          <div style={{
            display: "inline-flex", "align-items": "center",
            border: `1px solid ${C.borderMid}`, "border-radius": "6px",
            overflow: "hidden", background: C.bg,
          }}>
            <VmgBtn active={brainViewMode() === "graph"} title="Graph" onClick={() => setBrainViewMode("graph")}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            </VmgBtn>
            <VmgBtn active={brainViewMode() === "files"} title="Files" onClick={() => setBrainViewMode("files")}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </VmgBtn>
            <VmgBtn active={false} title="Layers" last onClick={() => {}}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
            </VmgBtn>
          </div>
        </Show>

        {/* Capture button */}
        <VmgBtn active={false} title="Capture" onClick={() => props.onCapture?.()} last>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </VmgBtn>


        {/* User avatar — rightmost */}
        <Show when={props.userEmail}>
          {(() => {
            const [open, setOpen] = createSignal(false)
            const initials = () => {
              const name = (props.userEmail ?? "").split("@")[0] || "U"
              return name.substring(0, 2).toUpperCase()
            }
            return (
              <div style={{ position: "relative" }}>
                <button type="button" title={props.userEmail} onClick={() => setOpen(v => !v)}
                  style={{ width: "32px", height: "32px", "border-radius": "50%", background: "#e5e5e5", border: "none", cursor: "pointer", "font-family": C.fontMono, "font-weight": "600", "font-size": "11px", color: C.ink300, display: "flex", "align-items": "center", "justify-content": "center", transition: "background 120ms" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#d4d4d4" }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "#e5e5e5" }}
                >
                  {initials()}
                </button>
                <Show when={open()}>
                  <div style={{ position: "absolute", top: "calc(100% + 6px)", right: "0", width: "200px", background: "#ffffff", border: `1px solid ${C.border}`, "border-radius": "6px", "box-shadow": "0 8px 24px rgba(0,0,0,0.12)", padding: "6px", "z-index": "300" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ padding: "10px", "border-bottom": `1px solid ${C.border}`, "margin-bottom": "4px" }}>
                      <div style={{ "font-size": "13px", "font-weight": "500", color: C.ink100, "font-family": C.fontSans, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                        {(props.userEmail ?? "").split("@")[0]}
                      </div>
                      <div style={{ "font-size": "11px", color: C.ink400, "font-family": C.fontMono, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                        {props.userEmail}
                      </div>
                    </div>
                    <button type="button" onClick={() => { setOpen(false); props.onLogout?.() }}
                      style={{ width: "100%", padding: "8px 10px", background: "none", border: "none", "border-radius": "4px", cursor: "pointer", "text-align": "left", "font-size": "13px", "font-family": C.fontSans, color: "#ef4444", transition: "background 100ms" }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#fef2f2" }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none" }}
                    >
                      Sign out
                    </button>
                  </div>
                </Show>
              </div>
            )
          })()}
        </Show>

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
