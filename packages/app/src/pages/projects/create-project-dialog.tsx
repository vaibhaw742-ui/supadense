import { createSignal, onMount } from "solid-js"
import { elApi, type ElProject } from "./el-api"

const MONO = '"Geist Mono", ui-monospace, monospace'
const SANS = '"Geist", ui-sans-serif, system-ui, sans-serif'
const AMBER = "#d68a2e"

interface Props {
  onCreated: (project: ElProject) => void
  onClose: () => void
}

export function CreateProjectDialog(props: Props) {
  const [name, setName] = createSignal("")
  const [repo, setRepo] = createSignal("")
  const [error, setError] = createSignal("")
  const [loading, setLoading] = createSignal(false)
  let nameRef: HTMLInputElement | undefined

  onMount(() => nameRef?.focus())

  async function handleCreate() {
    if (!name().trim()) { setError("Project name is required"); return }
    setError("")
    setLoading(true)
    try {
      const repoVal = repo().trim()
      const githubUrl = repoVal ? `https://github.com/${repoVal.replace(/^https?:\/\/github\.com\//, "")}` : undefined
      const project = await elApi.createProject({ name: name().trim(), github_url: githubUrl })
      props.onCreated(project)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project")
      setLoading(false)
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") handleCreate()
    if (e.key === "Escape") props.onClose()
  }

  return (
    <div
      style={{
        position: "fixed", inset: "0", "z-index": "100",
        display: "flex", "align-items": "center", "justify-content": "center",
        background: "rgba(0,0,0,0.45)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) props.onClose() }}
    >
      <div
        style={{
          background: "#ffffff",
          "border-radius": "12px",
          "box-shadow": "0 24px 64px rgba(0,0,0,0.22)",
          width: "100%",
          "max-width": "560px",
          margin: "0 16px",
          overflow: "hidden",
          "font-family": SANS,
        }}
        onKeyDown={onKeyDown}
      >
        {/* ── Header ── */}
        <div style={{
          display: "flex", "align-items": "center", "justify-content": "space-between",
          padding: "20px 24px 18px",
          "border-bottom": "1px solid #e5e5e5",
        }}>
          <div style={{ display: "flex", "align-items": "center", gap: "10px" }}>
            <span style={{ "font-size": "20px", "font-weight": "300", color: "#0a0a0a", "line-height": "1" }}>+</span>
            <span style={{ "font-size": "16px", "font-weight": "700", color: "#0a0a0a", "font-family": SANS }}>New</span>
            <span style={{ "font-size": "16px", "font-weight": "400", color: AMBER, "font-family": MONO }}>project</span>
          </div>
          <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={{ "font-family": MONO, "font-size": "11px", color: "#a3a3a3", "letter-spacing": "0.04em" }}>esc to close</span>
            <button
              type="button"
              onClick={props.onClose}
              style={{
                width: "28px", height: "28px", display: "flex", "align-items": "center", "justify-content": "center",
                border: "1px solid #e5e5e5", "border-radius": "6px", background: "#fff",
                cursor: "pointer", color: "#525252", "font-size": "14px",
              }}
            >✕</button>
          </div>
        </div>

        {/* ── Body ── */}
        <div style={{ padding: "24px 24px 0" }}>
          {/* Project name */}
          <label style={{ display: "block", "font-family": MONO, "font-size": "10px", "letter-spacing": "0.1em", "text-transform": "uppercase", color: "#737373", "margin-bottom": "10px" }}>
            Project Name
          </label>
          <input
            ref={nameRef}
            type="text"
            placeholder="e.g. payments-service, auth-service, search-infra…"
            value={name()}
            onInput={(e) => { setName(e.currentTarget.value); setError("") }}
            style={{
              width: "100%",
              "box-sizing": "border-box",
              "font-family": MONO,
              "font-size": "14px",
              padding: "13px 16px",
              border: `1.5px solid ${name() ? AMBER : "#e5e5e5"}`,
              "border-radius": "6px",
              outline: "none",
              color: "#0a0a0a",
              background: "#fff",
              transition: "border-color 150ms",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = AMBER }}
            onBlur={(e) => { e.currentTarget.style.borderColor = name() ? AMBER : "#e5e5e5" }}
          />

          {/* GitHub repo */}
          <label style={{ display: "block", "font-family": MONO, "font-size": "10px", "letter-spacing": "0.1em", "text-transform": "uppercase", color: "#737373", "margin-top": "20px", "margin-bottom": "10px" }}>
            GitHub Repository
          </label>
          <div style={{ display: "flex", border: "1.5px solid #e5e5e5", "border-radius": "6px", overflow: "hidden" }}>
            <div style={{
              display: "flex", "align-items": "center", gap: "8px",
              padding: "12px 14px",
              background: "#f5f5f5",
              "border-right": "1px solid #e5e5e5",
              "white-space": "nowrap",
              "flex-shrink": "0",
            }}>
              {/* GitHub icon */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="#737373"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"/></svg>
              <span style={{ "font-family": MONO, "font-size": "13px", color: "#737373" }}>github.com/</span>
            </div>
            <input
              type="text"
              placeholder="org/repo-name"
              value={repo()}
              onInput={(e) => setRepo(e.currentTarget.value)}
              style={{
                flex: "1",
                border: "none",
                outline: "none",
                padding: "12px 14px",
                "font-family": MONO,
                "font-size": "13px",
                color: "#0a0a0a",
                background: "#fff",
              }}
            />
          </div>

          {/* Error */}
          {error() && (
            <div style={{ "font-size": "12px", color: "#ef4444", "margin-top": "8px", "font-family": SANS }}>{error()}</div>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{
          display: "flex", "align-items": "center", "justify-content": "space-between",
          padding: "20px 24px",
          "margin-top": "24px",
          "border-top": "1px solid #f0f0f0",
        }}>
          <span style={{ "font-family": MONO, "font-size": "11px", color: "#a3a3a3", "letter-spacing": "0.04em" }}>
            ↵ create · <span style={{ "font-size": "11px" }}>esc</span> cancel
          </span>
          <div style={{ display: "flex", "align-items": "center", gap: "10px" }}>
            <button
              type="button"
              onClick={props.onClose}
              style={{
                padding: "9px 20px", "border-radius": "6px",
                border: "1px solid #e5e5e5", background: "#fff",
                "font-family": SANS, "font-size": "13px", "font-weight": "500",
                color: "#374151", cursor: "pointer",
              }}
            >Cancel</button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={loading()}
              style={{
                padding: "9px 20px", "border-radius": "6px",
                border: "none", background: loading() ? "#e5a857" : AMBER,
                "font-family": MONO, "font-size": "13px", "font-weight": "700",
                "letter-spacing": "0.02em",
                color: "#fff", cursor: loading() ? "not-allowed" : "pointer",
                display: "flex", "align-items": "center", gap: "6px",
                transition: "background 150ms",
              }}
            >
              {loading() ? "Creating…" : "Create project →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
