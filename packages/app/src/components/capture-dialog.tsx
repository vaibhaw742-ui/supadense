import { Button } from "@opencode-ai/ui/button"
import { showToast } from "@opencode-ai/ui/toast"
import { createEffect, createMemo, createResource, createSignal, For, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { getAuthToken } from "@/utils/server"
import { setActiveSidebarView } from "@/context/sidebar-view"
import { elApi } from "@/pages/projects/el-api"
import { useServer } from "@/context/server"

function kbApiBase() {
  return import.meta.env.DEV
    ? `http://${import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:4096`
    : `${location.origin}/api`
}

type Tab = "url" | "file" | "paste" | "source" | "extension"

const SOURCE_TAGS = ["arxiv", "github", "hn", "medium", "substack", "youtube", "pdf", "any html"]

interface Props {
  onClose: () => void
  onCaptured?: (resourceId: string) => void
}

export function CaptureDialog(props: Props) {
  const [tab, setTab] = createSignal<Tab>("url")
  const [url, setUrl] = createSignal("")
  const [pasteText, setPasteText] = createSignal("")
  const [loading, setLoading] = createSignal(false)
  const [preview, setPreview] = createSignal<{ domain: string } | null>(null)
  // Multi-select: set of selected project ids
  const [selectedProjectIds, setSelectedProjectIds] = createSignal<Set<string>>(new Set())

  const [localProjects] = createResource(() => elApi.listLocalProjects().catch(() => []))
  const server = useServer()

  // Combine opencode server projects + elApi local projects
  const allProjects = createMemo(() => {
    const serverProjects = server.projects.list().map((p) => ({
      id: p.worktree,
      name: p.worktree.split("/").filter(Boolean).pop() ?? p.worktree,
      type: "local" as const,
      source: "server" as const,
    }))
    const elProjects = (localProjects() ?? []).map((p) => ({ id: p.id, name: p.name, type: "local" as const, source: "el" as const }))
    // Merge, preferring server projects; deduplicate by id
    const seen = new Set<string>()
    const merged = [...serverProjects, ...elProjects].filter((p) => {
      if (seen.has(p.id)) return false
      seen.add(p.id)
      return true
    })
    return merged
  })

  // Auto-select first project once loaded
  createEffect(() => {
    const combined = allProjects()
    if (combined.length > 0 && selectedProjectIds().size === 0) {
      setSelectedProjectIds(new Set([combined[0].id]))
    }
  })

  function toggleProject(id: string) {
    setSelectedProjectIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }

  let inputRef: HTMLInputElement | undefined

  onMount(() => { inputRef?.focus() })

  const isValidUrl = (s: string) => { try { new URL(s); return true } catch { return false } }
  const urlValid = createMemo(() => isValidUrl(url().trim()))

  let previewTimer: ReturnType<typeof setTimeout> | undefined
  const onUrlInput = (val: string) => {
    setUrl(val)
    clearTimeout(previewTimer)
    previewTimer = setTimeout(() => {
      const trimmed = val.trim()
      if (!isValidUrl(trimmed)) { setPreview(null); return }
      try { setPreview({ domain: new URL(trimmed).hostname.replace(/^www\./, "") }) } catch { setPreview(null) }
    }, 350)
  }

  const handlePasteShortcut = async () => {
    try { const t = await navigator.clipboard.readText(); if (t) onUrlInput(t) } catch {}
  }

  const handleCapture = async () => {
    const rawUrl = url().trim()
    const rawText = pasteText().trim()
    const isUrl = tab() === "url" && rawUrl
    const isText = tab() === "paste" && rawText
    if ((!isUrl && !isText) || loading()) return

    const ids = selectedProjectIds()
    if (ids.size === 0) {
      showToast({ variant: "error", title: "Select at least one project" })
      return
    }

    setLoading(true)
    try {
      const token = getAuthToken()
      const projects = allProjects().filter(p => ids.has(p.id))

      const results = await Promise.allSettled(
        projects.map(async (proj) => {
          // Server projects (opencode worktree path as ID) — write directly to disk
          if ((proj as any).source === "server") {
            const projectDir = proj.id
            const timestamp = Date.now()
            if (isUrl) {
              const slug = rawUrl.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 60)
              const filename = `${timestamp}_${slug}.md`
              const content = `# ${rawUrl}\nSource: ${rawUrl}\nCaptured: ${new Date().toISOString()}\n`
              const ok = await window.supadense?.writeFile(`${projectDir}/.supadense/sources/${filename}`, content)
              if (!ok) throw new Error("Failed to write source file")
            } else if (isText) {
              const filename = `${timestamp}_note.md`
              const content = `# Note\nCaptured: ${new Date().toISOString()}\n\n${rawText}`
              const ok = await window.supadense?.writeFile(`${projectDir}/.supadense/sources/${filename}`, content)
              if (!ok) throw new Error("Failed to write note file")
            }
            return
          }
          // elApi projects (UUID IDs)
          if (isUrl) {
            if (proj.type === "local") {
              const res = await fetch(`${kbApiBase()}/local-projects/${proj.id}/sources`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                body: JSON.stringify({ url: rawUrl }),
              })
              if (!res.ok) {
                const err = await res.json().catch(() => ({})) as { error?: string }
                throw new Error(err.error ?? "Capture failed")
              }
            } else {
              await elApi.addResource(proj.id, rawUrl, "supplementary")
            }
          } else if (isText) {
            if (proj.type === "local") {
              const res = await fetch(`${kbApiBase()}/local-projects/${proj.id}/sources`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                body: JSON.stringify({ content: rawText, type: "note" }),
              })
              if (!res.ok) {
                const err = await res.json().catch(() => ({})) as { error?: string }
                throw new Error(err.error ?? "Capture failed")
              }
            } else {
              const res = await fetch(`${kbApiBase()}/el/projects/${proj.id}/resources`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                body: JSON.stringify({ text: rawText, role: "supplementary" }),
              })
              if (!res.ok) {
                const text = await res.text().catch(() => "")
                let errMsg = "Capture failed"
                try { const j = JSON.parse(text); errMsg = j.error ?? j.data?.message ?? j.message ?? (text.slice(0, 120) || errMsg) } catch {}
                throw new Error(errMsg)
              }
            }
          }
        })
      )

      const failed = results.filter(r => r.status === "rejected")
      const succeeded = results.filter(r => r.status === "fulfilled").length

      if (succeeded > 0) {
        const label = projects.length === 1 ? projects[0].name : `${succeeded} project${succeeded > 1 ? "s" : ""}`
        showToast({ variant: "success", title: `Queued for ${label}` })
      }
      if (failed.length > 0) {
        showToast({ variant: "error", title: `${failed.length} project(s) failed` })
      }

      setActiveSidebarView({ section: "workspace", view: "read", label: "Read" })
      props.onCaptured?.("")
      props.onClose()
    } catch (err) {
      showToast({ variant: "error", title: err instanceof Error ? err.message : "Capture failed" })
      setLoading(false)
    }
  }

  const canCapture = createMemo(() =>
    (tab() === "url" && urlValid()) || (tab() === "paste" && pasteText().trim().length > 0),
  )

  const tabs: { id: Tab; label: string }[] = [
    { id: "url", label: "URL" },
    { id: "file", label: "File" },
    { id: "paste", label: "Paste text" },
    { id: "source", label: "Connect source" },
    { id: "extension", label: "Browser extension" },
  ]

  return (
    <Portal mount={document.body}>
      {/* Backdrop */}
      <div
        style={{ position: "fixed", inset: "0", "z-index": "200", display: "flex", "align-items": "center", "justify-content": "center", background: "rgba(0,0,0,0.35)" }}
        onClick={(e) => { if (e.target === e.currentTarget) { setActiveSidebarView({ section: "workspace", view: "read", label: "Read" }); props.onClose() } }}
        onKeyDown={(e) => { if (e.key === "Escape") { setActiveSidebarView({ section: "workspace", view: "read", label: "Read" }); props.onClose() } }}
      >
        {/* Card */}
        <div
          style={{
            background: "var(--surface-raised-stronger-non-alpha)",
            border: "1px solid var(--border-weak-base)",
            "border-radius": "12px",
            "box-shadow": "0 8px 40px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)",
            width: "540px",
            "max-width": "calc(100vw - 32px)",
            overflow: "hidden",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", padding: "14px 18px 10px", "border-bottom": "1px solid var(--border-weak-base)" }}>
            <div style={{ display: "flex", "align-items": "center", gap: "6px" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{ color: "var(--color-text-weak)" }}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              <span style={{ "font-size": "14px", "font-weight": "500", color: "var(--color-text-strong)" }}>Capture a </span>
              <span style={{ "font-size": "14px", "font-weight": "500", color: "#d68a2e" }}>resource</span>
            </div>
            <div style={{ display: "flex", "align-items": "center", gap: "10px" }}>
              <span style={{ "font-size": "11px", color: "var(--color-text-dimmed, var(--text-weak))" }}>esc to close</span>
              <button
                type="button"
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-icon-weak)", padding: "2px", display: "flex", "align-items": "center", "border-radius": "4px" }}
                onClick={props.onClose}
                aria-label="Close"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", "border-bottom": "1px solid var(--border-weak-base)", padding: "0 18px" }}>
            {tabs.map((t) => (
              <button
                type="button"
                onClick={() => { setTab(t.id); if (t.id === "url") setTimeout(() => inputRef?.focus(), 50) }}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  padding: "8px 10px 10px",
                  "font-size": "12px",
                  "font-weight": tab() === t.id ? "500" : "400",
                  color: tab() === t.id ? "var(--color-text-strong)" : "var(--color-text-weak)",
                  "border-bottom": tab() === t.id ? "2px solid #d68a2e" : "2px solid transparent",
                  "margin-bottom": "-1px",
                  transition: "color 100ms, border-color 100ms",
                  "font-family": "inherit",
                  "white-space": "nowrap",
                  display: "flex", "align-items": "center", gap: "5px",
                }}
              >
                {t.id === "url" && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>}
                {t.id === "file" && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>}
                {t.id === "paste" && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>}
                {t.id === "source" && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>}
                {t.id === "extension" && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>}
                {t.label}
              </button>
            ))}
          </div>

          {/* Body */}
          <div style={{ padding: "16px 18px" }}>

            {/* URL tab */}
            <Show when={tab() === "url"}>
              {/* Input row */}
              <div style={{ display: "flex", "align-items": "center", gap: "8px", background: "var(--background-input)", border: "1px solid var(--border-base)", "border-radius": "8px", padding: "7px 10px" }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{ color: "var(--color-icon-weak)", "flex-shrink": "0" }}>
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                </svg>
                <input
                  ref={inputRef}
                  type="url"
                  style={{ flex: "1", background: "none", border: "none", outline: "none", "font-size": "13px", color: "var(--color-text-strong)", "font-family": "inherit", "min-width": "0" }}
                  placeholder="https://example.com/article"
                  value={url()}
                  onInput={(e) => onUrlInput(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canCapture()) void handleCapture()
                    if (e.key === "Escape") props.onClose()
                  }}
                />
                <button
                  type="button"
                  onClick={handlePasteShortcut}
                  style={{ background: "var(--surface-base)", border: "1px solid var(--border-base)", "border-radius": "4px", cursor: "pointer", padding: "2px 7px", display: "flex", "align-items": "center", gap: "4px", "font-size": "11px", color: "var(--color-text-weak)", "font-family": "inherit", "flex-shrink": "0" }}
                >
                  PASTE <span style={{ "font-size": "10px", opacity: "0.6" }}>⌘V</span>
                </button>
              </div>

              {/* Source tags */}
              <div style={{ display: "flex", "align-items": "center", gap: "5px", "margin-top": "10px", "flex-wrap": "wrap" }}>
                <span style={{ "font-size": "11px", color: "var(--color-text-dimmed, var(--text-weak))", "margin-right": "2px" }}>supadense reads:</span>
                {SOURCE_TAGS.map((tag) => (
                  <span style={{ "font-size": "11px", color: "var(--color-text-weak)", padding: "1px 7px", "border-radius": "4px", background: "var(--surface-base)", border: "1px solid var(--border-weak-base)" }}>
                    {tag}
                  </span>
                ))}
              </div>

              {/* Live preview */}
              <Show when={preview()}>
                <div style={{ "margin-top": "14px", background: "rgba(214,138,46,0.06)", border: "1px solid rgba(214,138,46,0.25)", "border-radius": "8px", padding: "12px 14px" }}>
                  <div style={{ display: "flex", "align-items": "center", gap: "6px", "margin-bottom": "12px" }}>
                    <span style={{ "font-size": "10px", "font-weight": "600", "letter-spacing": "0.06em", color: "#d68a2e", padding: "2px 6px", "border-radius": "4px", background: "rgba(214,138,46,0.12)", border: "1px solid rgba(214,138,46,0.25)" }}>
                      LIVE PREVIEW
                    </span>
                    <span style={{ "font-size": "10px", "font-weight": "600", "letter-spacing": "0.06em", color: "var(--color-text-weak)", padding: "2px 6px", "border-radius": "4px", background: "var(--surface-base)", border: "1px solid var(--border-weak-base)" }}>
                      PARSING
                    </span>
                    <span style={{ "font-size": "12px", color: "var(--color-text-weak)", "margin-left": "2px" }}>
                      {preview()?.domain}
                    </span>
                  </div>
                  <div style={{ display: "grid", "grid-template-columns": "1fr 1fr 1fr", gap: "16px" }}>
                    {[
                      { label: "FRAGMENTS TO EXTRACT", value: "~10", sub: "claims · links · citations" },
                      { label: "CONNECTIONS DRAWN", value: "~5", sub: "to existing KB nodes" },
                      { label: "FIRST REVIEW", value: "in 3d", sub: "est. retention d30 85%" },
                    ].map((item) => (
                      <div>
                        <div style={{ "font-size": "9px", "letter-spacing": "0.08em", "text-transform": "uppercase", color: "var(--color-text-dimmed, var(--text-weak))", "margin-bottom": "4px" }}>{item.label}</div>
                        <div style={{ "font-size": "20px", "font-weight": "600", color: "var(--color-text-strong)", "line-height": "1" }}>{item.value}</div>
                        <div style={{ "font-size": "10px", color: "var(--color-text-dimmed, var(--text-weak))", "margin-top": "3px" }}>{item.sub}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </Show>
            </Show>

            {/* File tab */}
            <Show when={tab() === "file"}>
              <div
                style={{ border: "2px dashed var(--border-base)", "border-radius": "8px", padding: "36px 16px", display: "flex", "flex-direction": "column", "align-items": "center", gap: "10px", cursor: "pointer", color: "var(--color-text-weak)" }}
                onClick={() => { const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".pdf,.txt,.md,.html"; inp.onchange = () => { if (inp.files?.[0]) showToast({ variant: "error", title: "File upload coming soon" }) }; inp.click() }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
                </svg>
                <span style={{ "font-size": "13px" }}>Click to upload a PDF, TXT, or HTML file</span>
                <span style={{ "font-size": "11px", color: "var(--color-text-dimmed, var(--text-weak))" }}>Coming soon</span>
              </div>
            </Show>

            {/* Paste text tab */}
            <Show when={tab() === "paste"}>
              <textarea
                style={{ width: "100%", "box-sizing": "border-box", background: "var(--background-input)", border: "1px solid var(--border-base)", "border-radius": "8px", padding: "10px 12px", "font-size": "13px", color: "var(--color-text-strong)", "font-family": "inherit", resize: "none", outline: "none", "min-height": "120px" }}
                placeholder="Paste article text, notes, or any content to capture…"
                value={pasteText()}
                onInput={(e) => setPasteText(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canCapture()) void handleCapture()
                  if (e.key === "Escape") props.onClose()
                }}
              />
            </Show>

            {/* Connect source / Extension tabs */}
            <Show when={tab() === "source" || tab() === "extension"}>
              <div style={{ padding: "36px 16px", display: "flex", "flex-direction": "column", "align-items": "center", gap: "8px", color: "var(--color-text-weak)", "text-align": "center" }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <span style={{ "font-size": "13px" }}>{tab() === "source" ? "Source connections" : "Browser extension"} coming soon</span>
              </div>
            </Show>
          </div>

          {/* Project selector — shown on URL and Paste tabs */}
          <Show when={tab() === "url" || tab() === "paste"}>
            <div style={{ padding: "10px 18px 0" }}>
              <div style={{ display: "flex", "align-items": "center", gap: "6px", "margin-bottom": "8px" }}>
                <span style={{ "font-size": "11px", color: "var(--color-text-weak)", "white-space": "nowrap" }}>add to project:</span>
                <Show when={selectedProjectIds().size > 1}>
                  <span style={{ "font-size": "10px", color: "#d68a2e", "font-family": "'Geist Mono', monospace" }}>
                    {selectedProjectIds().size} selected
                  </span>
                </Show>
              </div>
              <div style={{ display: "flex", gap: "6px", "flex-wrap": "wrap", "align-items": "center" }}>
                <Show when={!localProjects.loading} fallback={
                  <span style={{ "font-size": "11px", color: "var(--color-text-dimmed, var(--text-weak))" }}>Loading…</span>
                }>
                  <For each={allProjects()}>
                    {(project) => {
                      const isSelected = () => selectedProjectIds().has(project.id)
                      return (
                        <button
                          type="button"
                          onClick={() => toggleProject(project.id)}
                          style={{
                            display: "inline-flex", "align-items": "center", gap: "5px",
                            padding: "3px 10px",
                            "border-radius": "4px",
                            border: isSelected() ? "1px solid #d68a2e" : "1px solid var(--border-base)",
                            background: isSelected() ? "rgba(214,138,46,0.1)" : "none",
                            color: isSelected() ? "#d68a2e" : "var(--color-text-weak)",
                            "font-size": "11px",
                            "font-family": "inherit",
                            cursor: "pointer",
                            transition: "all 100ms",
                            "max-width": "160px",
                            overflow: "hidden",
                            "text-overflow": "ellipsis",
                            "white-space": "nowrap",
                          }}
                        >
                          {/* Checkbox indicator */}
                          <span style={{
                            width: "12px", height: "12px", "border-radius": "3px", "flex-shrink": "0",
                            border: isSelected() ? "1.5px solid #d68a2e" : "1.5px solid var(--border-base)",
                            background: isSelected() ? "#d68a2e" : "none",
                            display: "inline-flex", "align-items": "center", "justify-content": "center",
                            transition: "all 100ms",
                          }}>
                            <Show when={isSelected()}>
                              <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                                <polyline points="1.5,5 4,7.5 8.5,2.5" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                              </svg>
                            </Show>
                          </span>
                          {project.name}
                          <Show when={project.type === "local"}>
                            <span style={{ "font-size": "9px", opacity: "0.6" }}>cli</span>
                          </Show>
                        </button>
                      )
                    }}
                  </For>
                  <Show when={allProjects().length === 0}>
                    <span style={{ "font-size": "11px", color: "var(--color-text-dimmed, var(--text-weak))" }}>No projects — run supadense init</span>
                  </Show>
                </Show>
              </div>
            </div>
          </Show>

          {/* Footer */}
          <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", padding: "10px 18px 14px", "border-top": "1px solid var(--border-weak-base)" }}>
            <div style={{ "font-size": "11px", color: "var(--color-text-dimmed, var(--text-weak))", display: "flex", gap: "12px" }}>
              <span>↵ capture</span>
              <span>⌘↵ capture &amp; open</span>
              <span>esc cancel</span>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <Button variant="ghost" size="large" onClick={props.onClose}>Cancel</Button>
              <Button variant="primary" size="large" disabled={loading() || !canCapture()} onClick={() => void handleCapture()}>
                {loading() ? "Capturing…" : "Capture →"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  )
}
