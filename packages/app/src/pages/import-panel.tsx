import { createSignal, createResource, For, Show } from "solid-js"
import { getAuthToken } from "@/utils/server"

function kbApiBase() {
  return import.meta.env.DEV
    ? `http://${import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:4096`
    : `${location.origin}/api`
}

function authHeaders(): Record<string, string> {
  const token = getAuthToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

interface ProcessingItem {
  id: string
  name: string
  status: "pending" | "processing" | "done" | "error"
  type: string
}

// ── Fetch processing queue ────────────────────────────────────────────────────
async function fetchQueue(): Promise<ProcessingItem[]> {
  try {
    const res = await fetch(`${kbApiBase()}/kb/queue`, { headers: authHeaders() })
    if (!res.ok) return []
    return await res.json() as ProcessingItem[]
  } catch {
    return []
  }
}

// ── Fetch available tags ──────────────────────────────────────────────────────
async function fetchTags(): Promise<string[]> {
  try {
    const res = await fetch(`${kbApiBase()}/kb/tags`, { headers: authHeaders() })
    if (!res.ok) return []
    const data = await res.json() as { tags?: string[] }
    return data.tags ?? []
  } catch {
    return []
  }
}

const C = {
  bg: "#ffffff",
  border: "#e5e5e5",
  borderDash: "#d1d5db",
  surface: "#f9fafb",
  text: "#0a0a0a",
  textMid: "#374151",
  textSub: "#6b7280",
  blue: "#3b7af6",
  blueBg: "#eff6ff",
  blueBorder: "#bfdbfe",
  font: '"Geist", ui-sans-serif, system-ui, sans-serif',
  mono: '"Geist Mono", ui-monospace, monospace',
}

export function ImportPanel() {
  const [dragOver, setDragOver] = createSignal(false)
  const [files, setFiles] = createSignal<File[]>([])
  const [urls, setUrls] = createSignal<string[]>([])
  const [urlInput, setUrlInput] = createSignal("")
  const [tag, setTag] = createSignal("")
  const [tagSearch, setTagSearch] = createSignal("")
  const [tagDropOpen, setTagDropOpen] = createSignal(false)
  const [importing, setImporting] = createSignal(false)
  const [importMsg, setImportMsg] = createSignal("")

  const [queue, { refetch: refetchQueue }] = createResource(fetchQueue)
  const [availTags] = createResource(fetchTags)

  const totalItems = () => files().length + urls().length

  // ── Drop zone ─────────────────────────────────────────────────────────────
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const dropped = Array.from(e.dataTransfer?.files ?? [])
    setFiles(prev => [...prev, ...dropped])
  }

  const onFileInput = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement
    const selected = Array.from(input.files ?? [])
    setFiles(prev => [...prev, ...selected])
    input.value = ""
  }

  // ── URL add ───────────────────────────────────────────────────────────────
  const addUrl = () => {
    const v = urlInput().trim()
    if (!v) return
    try { new URL(v) } catch { return }
    setUrls(prev => [...prev, v])
    setUrlInput("")
  }

  const removeFile = (i: number) => setFiles(prev => prev.filter((_, idx) => idx !== i))
  const removeUrl  = (i: number) => setUrls(prev => prev.filter((_, idx) => idx !== i))

  // ── Import ─────────────────────────────────────────────────────────────────
  const handleImport = async () => {
    if (totalItems() === 0) return
    setImporting(true)
    setImportMsg("")
    try {
      const form = new FormData()
      files().forEach(f => form.append("files", f))
      urls().forEach(u => form.append("urls", u))
      if (tag()) form.append("tag", tag())

      const hdrs = authHeaders()
      const res = await fetch(`${kbApiBase()}/kb/import`, { method: "POST", headers: hdrs, body: form })
      if (res.ok) {
        setFiles([])
        setUrls([])
        setTag("")
        setImportMsg(`Imported ${totalItems()} item(s) successfully.`)
        void refetchQueue()
      } else {
        const d = await res.json() as { error?: string }
        setImportMsg(d.error ?? "Import failed.")
      }
    } catch {
      setImportMsg("Import failed.")
    } finally {
      setImporting(false)
    }
  }

  const filteredTags = () =>
    (availTags() ?? []).filter(t => t.toLowerCase().includes(tagSearch().toLowerCase()))

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%", background: C.bg, "font-family": C.font, overflow: "auto" }}>
      {/* Header */}
      <div style={{ padding: "32px 40px 0" }}>
        <h1 style={{ margin: "0 0 4px", "font-size": "22px", "font-weight": "700", color: C.text, "font-family": C.mono }}>
          Knowledge Base
        </h1>
        <p style={{ margin: "0 0 28px", "font-size": "13px", color: C.textSub, "font-family": C.mono }}>
          Upload files or add URLs to build your memory layer
        </p>
      </div>

      {/* Body — two columns */}
      <div style={{ display: "flex", gap: "24px", padding: "0 40px 40px", flex: "1", "min-height": "0", "align-items": "flex-start" }}>
        {/* Left column */}
        <div style={{ flex: "1", "min-width": "0", display: "flex", "flex-direction": "column", gap: "24px" }}>

          {/* Upload Files */}
          <section>
            <h2 style={{ margin: "0 0 12px", "font-size": "13px", "font-weight": "700", color: C.text, "font-family": C.mono }}>Upload Files</h2>

            {/* Drop zone */}
            <div
              style={{
                border: `2px dashed ${dragOver() ? C.blue : C.borderDash}`,
                "border-radius": "10px",
                background: dragOver() ? C.blueBg : C.surface,
                padding: "48px 32px",
                display: "flex",
                "flex-direction": "column",
                "align-items": "center",
                gap: "10px",
                cursor: "pointer",
                transition: "all 150ms",
              }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => (document.getElementById("import-file-input") as HTMLInputElement)?.click()}
            >
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={C.textSub} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="16 16 12 12 8 16"/>
                <line x1="12" y1="12" x2="12" y2="21"/>
                <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
              </svg>
              <div style={{ "font-size": "14px", "font-weight": "600", color: C.textMid, "font-family": C.mono }}>
                Drop files here or click to browse
              </div>
              <div style={{ "font-size": "12px", color: C.textSub, "font-family": C.mono }}>
                Supports TXT, MD, JSON, PDF, DOCX, PNG, JPG, MP4
              </div>
              <input id="import-file-input" type="file" multiple style={{ display: "none" }} onChange={onFileInput} />
            </div>

            {/* File list */}
            <Show when={files().length > 0}>
              <div style={{ "margin-top": "10px", display: "flex", "flex-direction": "column", gap: "6px" }}>
                <For each={files()}>
                  {(f, i) => (
                    <div style={{ display: "flex", "align-items": "center", gap: "8px", padding: "6px 10px", background: C.surface, border: `1px solid ${C.border}`, "border-radius": "6px" }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.textSub} stroke-width="1.8" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      <span style={{ flex: "1", "font-size": "12px", color: C.textMid, "font-family": C.mono, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>{f.name}</span>
                      <span style={{ "font-size": "11px", color: C.textSub, "font-family": C.mono, "flex-shrink": "0" }}>{(f.size / 1024).toFixed(1)} KB</span>
                      <button type="button" onClick={(e) => { e.stopPropagation(); removeFile(i()) }} style={{ background: "none", border: "none", cursor: "pointer", color: C.textSub, padding: "0 2px", "font-size": "16px", "line-height": "1", "flex-shrink": "0" }}>×</button>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </section>

          {/* Add URLs */}
          <section>
            <h2 style={{ margin: "0 0 12px", "font-size": "13px", "font-weight": "700", color: C.text, "font-family": C.mono }}>Add URLs</h2>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                placeholder="https://example.com/article"
                value={urlInput()}
                onInput={(e) => setUrlInput(e.currentTarget.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addUrl() }}
                style={{ flex: "1", padding: "9px 14px", border: `1px solid ${C.border}`, "border-radius": "6px", "font-size": "13px", "font-family": C.mono, color: C.textMid, background: C.bg, outline: "none" }}
              />
              <button
                type="button"
                onClick={addUrl}
                style={{ padding: "9px 18px", background: C.bg, border: `1px solid ${C.border}`, "border-radius": "6px", "font-size": "13px", "font-family": C.mono, "font-weight": "600", color: C.textMid, cursor: "pointer", "white-space": "nowrap" }}
              >
                + ADD
              </button>
            </div>

            <Show when={urls().length > 0}>
              <div style={{ "margin-top": "10px", display: "flex", "flex-direction": "column", gap: "6px" }}>
                <For each={urls()}>
                  {(u, i) => (
                    <div style={{ display: "flex", "align-items": "center", gap: "8px", padding: "6px 10px", background: C.surface, border: `1px solid ${C.border}`, "border-radius": "6px" }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.textSub} stroke-width="1.8" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                      <span style={{ flex: "1", "font-size": "12px", color: C.textMid, "font-family": C.mono, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>{u}</span>
                      <button type="button" onClick={() => removeUrl(i())} style={{ background: "none", border: "none", cursor: "pointer", color: C.textSub, padding: "0 2px", "font-size": "16px", "line-height": "1", "flex-shrink": "0" }}>×</button>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </section>

          {/* Project tag */}
          <div style={{ display: "flex", gap: "24px", "align-items": "flex-start" }}>
            <div style={{ flex: "1" }}>
              <label style={{ display: "block", "font-size": "13px", "font-weight": "700", color: C.text, "margin-bottom": "8px", "font-family": C.mono }}>
                Project tag <span style={{ "font-weight": "400", color: C.textSub }}>(optional)</span>
              </label>
              <div style={{ position: "relative" }}>
                <div
                  style={{ display: "flex", "align-items": "center", border: `1px solid ${C.border}`, "border-radius": "6px", background: C.bg, cursor: "pointer", padding: "9px 12px" }}
                  onClick={() => setTagDropOpen(v => !v)}
                >
                  <input
                    type="text"
                    placeholder="Search or create tags..."
                    value={tag() || tagSearch()}
                    onInput={(e) => { setTagSearch(e.currentTarget.value); setTag(""); setTagDropOpen(true) }}
                    onClick={(e) => { e.stopPropagation(); setTagDropOpen(true) }}
                    style={{ flex: "1", border: "none", outline: "none", "font-size": "13px", "font-family": C.mono, color: C.textMid, background: "transparent" }}
                  />
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.textSub} stroke-width="2" stroke-linecap="round" style={{ "flex-shrink": "0" }}><polyline points="6 9 12 15 18 9"/></svg>
                </div>
                <Show when={tagDropOpen()}>
                  <div style={{ position: "absolute", top: "calc(100% + 4px)", left: "0", right: "0", background: C.bg, border: `1px solid ${C.border}`, "border-radius": "6px", "box-shadow": "0 4px 12px rgba(0,0,0,0.1)", "z-index": "50", "max-height": "180px", overflow: "auto" }}>
                    <Show when={tagSearch() && !filteredTags().includes(tagSearch())}>
                      <button type="button"
                        style={{ width: "100%", padding: "9px 12px", "text-align": "left", "font-size": "13px", "font-family": C.mono, color: C.blue, background: "none", border: "none", cursor: "pointer", "border-bottom": `1px solid ${C.border}` }}
                        onClick={() => { setTag(tagSearch()); setTagSearch(""); setTagDropOpen(false) }}
                      >
                        + Create "{tagSearch()}"
                      </button>
                    </Show>
                    <Show when={filteredTags().length === 0 && !tagSearch()}>
                      <div style={{ padding: "9px 12px", "font-size": "12px", color: C.textSub, "font-family": C.mono }}>No tags yet</div>
                    </Show>
                    <For each={filteredTags()}>
                      {(t) => (
                        <button type="button"
                          style={{ width: "100%", padding: "9px 12px", "text-align": "left", "font-size": "13px", "font-family": C.mono, color: C.textMid, background: tag() === t ? C.surface : "none", border: "none", cursor: "pointer" }}
                          onClick={() => { setTag(t); setTagSearch(""); setTagDropOpen(false) }}
                        >
                          {t}
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </div>
          </div>

          {/* Import button */}
          <button
            type="button"
            disabled={importing() || totalItems() === 0}
            onClick={handleImport}
            style={{
              width: "100%",
              padding: "14px",
              "border-radius": "8px",
              background: totalItems() === 0 ? "#93c5fd" : C.blue,
              border: "none",
              color: "#ffffff",
              "font-size": "13px",
              "font-family": C.mono,
              "font-weight": "700",
              "letter-spacing": "0.08em",
              "text-transform": "uppercase",
              cursor: totalItems() === 0 ? "not-allowed" : "pointer",
              transition: "background 150ms",
            }}
          >
            {importing() ? "IMPORTING…" : `IMPORT ${totalItems()} ITEM${totalItems() === 1 ? "" : "S"}`}
          </button>

          <Show when={importMsg()}>
            <div style={{ "font-size": "12px", "font-family": C.mono, color: importMsg().includes("success") ? "#16a34a" : "#ef4444", "text-align": "center" }}>
              {importMsg()}
            </div>
          </Show>
        </div>

        {/* Right column — Processing Queue */}
        <div style={{ width: "300px", "flex-shrink": "0" }}>
          <h2 style={{ margin: "0 0 12px", "font-size": "13px", "font-weight": "700", color: C.text, "font-family": C.mono }}>Processing Queue</h2>
          <div style={{ border: `1px solid ${C.border}`, "border-radius": "10px", background: C.surface, "min-height": "160px", display: "flex", "flex-direction": "column" }}>
            <Show
              when={(queue() ?? []).length > 0}
              fallback={
                <div style={{ flex: "1", display: "flex", "align-items": "center", "justify-content": "center", padding: "40px 16px", "font-size": "12px", color: C.textSub, "font-family": C.mono }}>
                  No documents processing
                </div>
              }
            >
              <div style={{ padding: "8px" }}>
                <For each={queue()}>
                  {(item) => (
                    <div style={{ display: "flex", "align-items": "center", gap: "10px", padding: "8px 10px", "border-radius": "6px", background: C.bg, "margin-bottom": "4px", border: `1px solid ${C.border}` }}>
                      {/* Status indicator */}
                      <div style={{
                        width: "8px", height: "8px", "border-radius": "50%", "flex-shrink": "0",
                        background: item.status === "done" ? "#16a34a" : item.status === "error" ? "#ef4444" : item.status === "processing" ? "#f59e0b" : "#9ca3af",
                      }} />
                      <span style={{ flex: "1", "font-size": "12px", "font-family": C.mono, color: C.textMid, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>{item.name}</span>
                      <span style={{ "font-size": "10px", "font-family": C.mono, color: C.textSub, "text-transform": "uppercase", "letter-spacing": "0.05em", "flex-shrink": "0" }}>{item.status}</span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}
