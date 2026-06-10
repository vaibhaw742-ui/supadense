import { createResource, createSignal, createEffect, onCleanup, For, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"

function timeAgo(ms: number): string {
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

import { elApi } from "./el-api"
import { setActiveSidebarView } from "@/context/sidebar-view"

// ── CLI Onboarding Modal ───────────────────────────────────────────────────────

function CliOnboardingModal(props: { onClose: () => void; onDetected: () => void }) {
  const serverUrl = () => {
    if (typeof window !== "undefined") return window.location.origin
    return "http://localhost:4096"
  }

  const [copied, setCopied] = createSignal<string | null>(null)

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(null), 1800)
    })
  }

  // Poll for new projects every 3s while modal is open
  const [prevCount, setPrevCount] = createSignal<number | null>(null)
  createEffect(() => {
    elApi.listLocalProjects().then(p => setPrevCount(p.length))
    const iv = setInterval(async () => {
      const projects = await elApi.listLocalProjects()
      const prev = prevCount()
      if (prev !== null && projects.length > prev) {
        props.onDetected()
      }
      setPrevCount(projects.length)
    }, 3000)
    onCleanup(() => clearInterval(iv))
  })

  const steps: Array<{ key: string; step: string; label: string; cmd: string }> = [
    {
      key: "install",
      step: "1",
      label: "Install Supadense CLI",
      cmd: `curl -fsSL ${serverUrl()}/install.sh | bash`,
    },
    {
      key: "login",
      step: "2",
      label: "Login",
      cmd: "supadense login",
    },
    {
      key: "init",
      step: "3",
      label: "Init your project",
      cmd: "cd /path/to/your-project && supadense init",
    },
  ]

  return (
    <div
      style={{
        position: "fixed", inset: "0", "z-index": "9999",
        display: "flex", "align-items": "center", "justify-content": "center",
        background: "rgba(0,0,0,0.45)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) props.onClose() }}
    >
      <div style={{
        background: "#ffffff",
        "border-radius": "12px",
        width: "520px",
        "max-width": "calc(100vw - 32px)",
        padding: "32px",
        "box-shadow": "0 20px 60px rgba(0,0,0,0.18)",
        position: "relative",
      }}>
        {/* Close */}
        <button
          type="button"
          onClick={props.onClose}
          style={{
            position: "absolute", top: "16px", right: "16px",
            background: "none", border: "none", cursor: "pointer",
            color: "#a3a3a3", "font-size": "18px", "line-height": "1",
            padding: "4px 6px", "border-radius": "4px",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#525252" }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "#a3a3a3" }}
        >
          ✕
        </button>

        {/* Title */}
        <div style={{ "margin-bottom": "8px" }}>
          <span style={{
            "font-family": "'Geist Mono', monospace", "font-size": "10px", "font-weight": "600",
            "letter-spacing": "0.08em", color: "#d68a2e",
          }}>
            ADD PROJECT
          </span>
        </div>
        <div style={{ "font-size": "22px", "font-weight": "700", color: "#0a0a0a", "margin-bottom": "6px" }}>
          Connect your codebase
        </div>
        <div style={{ "font-size": "13px", color: "#737373", "margin-bottom": "28px", "line-height": "1.5" }}>
          Run these commands in your terminal. Your project will appear here automatically once initialised.
        </div>

        {/* Steps */}
        <div style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
          <For each={steps}>
            {(s) => (
              <div style={{
                background: "#fafafa",
                border: "1px solid #e5e5e5",
                "border-radius": "8px",
                padding: "14px 16px",
              }}>
                <div style={{ display: "flex", "align-items": "center", gap: "8px", "margin-bottom": "10px" }}>
                  <span style={{
                    "font-family": "'Geist Mono', monospace", "font-size": "10px", "font-weight": "700",
                    color: "#d68a2e",
                    background: "rgba(214,138,46,0.1)",
                    border: "1px solid rgba(214,138,46,0.3)",
                    "border-radius": "4px",
                    padding: "1px 7px",
                  }}>
                    {s.step}
                  </span>
                  <span style={{ "font-size": "13px", "font-weight": "600", color: "#0a0a0a" }}>{s.label}</span>
                  <Show when={s.key === "install"}>
                    <span style={{ "font-size": "11px", color: "#a3a3a3", "margin-left": "2px" }}>(skip if already done)</span>
                  </Show>
                </div>
                <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                  <code style={{
                    flex: "1",
                    "font-family": "'Geist Mono', monospace",
                    "font-size": "12px",
                    color: "#0a0a0a",
                    background: "#f0f0f0",
                    "border-radius": "5px",
                    padding: "8px 12px",
                    display: "block",
                    overflow: "auto",
                    "white-space": "nowrap",
                  }}>
                    {s.cmd}
                  </code>
                  <button
                    type="button"
                    onClick={() => copy(s.cmd, s.key)}
                    title="Copy"
                    style={{
                      "flex-shrink": "0",
                      background: copied() === s.key ? "rgba(22,163,74,0.1)" : "rgba(214,138,46,0.08)",
                      border: `1px solid ${copied() === s.key ? "rgba(22,163,74,0.3)" : "rgba(214,138,46,0.3)"}`,
                      "border-radius": "5px",
                      cursor: "pointer",
                      padding: "8px 10px",
                      display: "flex", "align-items": "center", "justify-content": "center",
                      transition: "all 150ms",
                      color: copied() === s.key ? "#16a34a" : "#d68a2e",
                    }}
                  >
                    <Show
                      when={copied() === s.key}
                      fallback={
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                      }
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </Show>
                  </button>
                </div>
              </div>
            )}
          </For>
        </div>

        {/* Waiting indicator */}
        <div style={{
          "margin-top": "20px",
          display: "flex", "align-items": "center", gap: "8px",
          "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#a3a3a3",
        }}>
          <span style={{
            width: "6px", height: "6px", "border-radius": "50%",
            background: "#d68a2e",
            animation: "pulse 1.6s ease-in-out infinite",
          }} />
          Waiting for <code style={{ color: "#525252" }}>supadense init</code>…
        </div>

        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
          }
        `}</style>
      </div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

type TagRow = {
  name: string
  project_id: string
  doc_count: number
  last_activity: number
}

export default function ProjectsPanel() {
  const navigate = useNavigate()
  const [showModal, setShowModal] = createSignal(false)
  const [search, setSearch] = createSignal("")
  const [sortBy, setSortBy] = createSignal<"documents" | "memories" | "activity">("documents")

  const [sources, { refetch: refetchSources }] = createResource(() => elApi.listAllLocalSources())
  const [projects, { refetch: refetchProjects }] = createResource(() => elApi.listLocalProjects())

  function handleDetected() {
    void refetchProjects()
    void refetchSources()
    setShowModal(false)
  }

  // Group sources by project, deduplicated by filename per project
  const tagRows = (): TagRow[] => {
    const rows = sources() ?? []
    const map = new Map<string, TagRow>()
    const seen = new Set<string>() // project_id + filename dedup
    for (const row of rows) {
      const key = `${row.project_id}::${row.filename}`
      if (!map.has(row.project_id)) {
        map.set(row.project_id, { name: row.project_name, project_id: row.project_id, doc_count: 0, last_activity: row.time_created })
      }
      const entry = map.get(row.project_id)!
      if (!seen.has(key)) {
        seen.add(key)
        entry.doc_count++
      }
      if (row.time_created > entry.last_activity) entry.last_activity = row.time_created
    }
    let result = Array.from(map.values())

    // Filter
    const q = search().toLowerCase().trim()
    if (q) result = result.filter(r => r.name.toLowerCase().includes(q))

    // Sort
    if (sortBy() === "documents") result.sort((a, b) => b.doc_count - a.doc_count)
    else if (sortBy() === "activity") result.sort((a, b) => b.last_activity - a.last_activity)
    // "memories" — no real data yet, keep doc order

    return result
  }

  const SortBtn = (p: { label: string; value: "documents" | "memories" | "activity" }) => (
    <button
      type="button"
      onClick={() => setSortBy(p.value)}
      style={{
        padding: "6px 14px",
        border: "1px solid #e5e7eb",
        "border-radius": "6px",
        background: sortBy() === p.value ? "#111827" : "#ffffff",
        cursor: "pointer",
        "font-family": "'Geist Mono', monospace",
        "font-size": "11px",
        "font-weight": "600",
        "letter-spacing": "0.06em",
        color: sortBy() === p.value ? "#ffffff" : "#6b7280",
        transition: "all 120ms",
      }}
    >
      {sortBy() === p.value ? `SORT: ${p.label}` : p.label}
    </button>
  )

  return (
    <div class="size-full flex flex-col" style={{ background: "#f9fafb", overflow: "hidden" }}>

      {/* Header */}
      <div style={{ "flex-shrink": "0", padding: "28px 32px 0", background: "#f9fafb" }}>
        <div style={{ display: "flex", "align-items": "flex-start", "justify-content": "space-between", "margin-bottom": "4px" }}>
          <div>
            <h1 style={{ margin: "0 0 4px", "font-size": "22px", "font-weight": "700", color: "#111827", "font-family": "inherit" }}>Project Tags</h1>
            <p style={{ margin: "0", "font-size": "13px", color: "#6b7280", "font-family": "'Geist Mono', monospace" }}>Project tags organize your documents and memories</p>
          </div>
        </div>

        {/* Toolbar */}
        <div style={{ display: "flex", "align-items": "center", gap: "10px", "margin-top": "20px", "margin-bottom": "16px" }}>
          {/* Search */}
          <div style={{ position: "relative", flex: "1", "max-width": "320px" }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2" style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", "pointer-events": "none" }}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              placeholder="Search tags..."
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
              style={{
                width: "100%", "box-sizing": "border-box",
                padding: "7px 12px 7px 30px",
                border: "1px solid #e5e7eb", "border-radius": "6px",
                background: "#ffffff", "font-size": "12px",
                "font-family": "'Geist Mono', monospace", color: "#374151",
                outline: "none",
              }}
            />
          </div>
          <div style={{ flex: "1" }} />
          <SortBtn label="DOCUMENTS" value="documents" />
          <SortBtn label="MEMORIES" value="memories" />
          <SortBtn label="ACTIVITY" value="activity" />
        </div>
      </div>

      {/* Table container */}
      <div style={{ flex: "1", "overflow-y": "auto", padding: "0 32px 32px" }}>
        <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", "border-radius": "8px", overflow: "hidden" }}>
          {/* Table header */}
          <table style={{ width: "100%", "border-collapse": "collapse" }}>
            <thead>
              <tr style={{ "border-bottom": "1px solid #e5e7eb", background: "#f9fafb" }}>
                {(["PROJECT TAG", "DOCUMENTS", "MEMORIES", "LAST ACTIVITY"] as const).map((col) => (
                  <th style={{
                    "font-family": "'Geist Mono', monospace", "font-size": "10px", "font-weight": "600",
                    "letter-spacing": "0.08em", color: "#9ca3af", "text-align": col === "PROJECT TAG" ? "left" : "right",
                    padding: "10px 20px", "white-space": "nowrap",
                  }}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Loading skeletons */}
              <Show when={sources.loading}>
                <For each={[1, 2, 3, 4]}>
                  {() => (
                    <tr style={{ "border-bottom": "1px solid #f3f4f6" }}>
                      <td style={{ padding: "16px 20px" }}><div style={{ width: "100px", height: "14px", background: "#f3f4f6", "border-radius": "3px" }} /></td>
                      <td style={{ padding: "16px 20px", "text-align": "right" }}><div style={{ width: "24px", height: "14px", background: "#f3f4f6", "border-radius": "3px", "margin-left": "auto" }} /></td>
                      <td style={{ padding: "16px 20px", "text-align": "right" }}><div style={{ width: "24px", height: "14px", background: "#f3f4f6", "border-radius": "3px", "margin-left": "auto" }} /></td>
                      <td style={{ padding: "16px 20px", "text-align": "right" }}><div style={{ width: "60px", height: "14px", background: "#f3f4f6", "border-radius": "3px", "margin-left": "auto" }} /></td>
                    </tr>
                  )}
                </For>
              </Show>

              {/* Empty state */}
              <Show when={!sources.loading && tagRows().length === 0}>
                <tr>
                  <td colspan="4" style={{ padding: "60px 20px", "text-align": "center" }}>
                    <div style={{ "font-family": "'Geist Mono', monospace", "font-size": "13px", color: "#9ca3af" }}>
                      {search() ? "No tags match your search" : "No project tags yet"}
                    </div>
                    <Show when={!search()}>
                      <div style={{ "font-size": "12px", color: "#d1d5db", "margin-top": "4px" }}>
                        Add documents to projects to see tags here
                      </div>
                    </Show>
                  </td>
                </tr>
              </Show>

              {/* Tag rows */}
              <For each={tagRows()}>
                {(tag) => <TagTableRow tag={tag} onOpen={(id) => {
                  setActiveSidebarView({ section: "workspace", view: "project", label: tag.name })
                  navigate(`/local-projects/${id}`)
                }} />}
              </For>
            </tbody>
          </table>
        </div>

        {/* Footer total */}
        <Show when={!sources.loading && tagRows().length > 0}>
          <div style={{ display: "flex", "justify-content": "flex-end", "margin-top": "12px" }}>
            <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#9ca3af" }}>
              {tagRows().length} total
            </span>
          </div>
        </Show>
      </div>

      {/* CLI Onboarding Modal */}
      <Show when={showModal()}>
        <CliOnboardingModal onClose={() => setShowModal(false)} onDetected={handleDetected} />
      </Show>
    </div>
  )
}

// ── Tag table row ─────────────────────────────────────────────────────────────

function TagTableRow(props: { tag: TagRow; onOpen: (id: string) => void }) {
  const [hovered, setHovered] = createSignal(false)

  return (
    <tr
      style={{ "border-bottom": "1px solid #f3f4f6", cursor: "pointer", background: hovered() ? "#fafafa" : "transparent", transition: "background 120ms" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => props.onOpen(props.tag.project_id)}
    >
      {/* PROJECT TAG */}
      <td style={{ padding: "16px 20px", "vertical-align": "middle" }}>
        <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "13px", color: "#374151" }}>
          {props.tag.name}
        </span>
      </td>

      {/* DOCUMENTS */}
      <td style={{ padding: "16px 20px", "vertical-align": "middle", "text-align": "right" }}>
        <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "13px", color: "#374151" }}>
          {props.tag.doc_count}
        </span>
      </td>

      {/* MEMORIES */}
      <td style={{ padding: "16px 20px", "vertical-align": "middle", "text-align": "right" }}>
        <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "13px", color: "#9ca3af" }}>—</span>
      </td>

      {/* LAST ACTIVITY */}
      <td style={{ padding: "16px 20px", "vertical-align": "middle", "text-align": "right" }}>
        <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "12px", color: "#9ca3af" }}>
          {timeAgo(props.tag.last_activity)}
        </span>
      </td>
    </tr>
  )
}
