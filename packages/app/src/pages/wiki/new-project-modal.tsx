import { createSignal, createResource, Show, For, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import { elApi, type GitHubRepo } from "@/pages/projects/el-api"
import { showToast } from "@opencode-ai/ui/toast"

const T = {
  bg: "#ffffff",
  border: "#e5e5e5",
  borderHov: "#d4d4d4",
  text: "#0a0a0a",
  textMuted: "#737373",
  textFaint: "#a3a3a3",
  amber: "#d68a2e",
  amberBg: "rgba(214,138,46,0.08)",
  amberBorder: "rgba(214,138,46,0.3)",
  surface: "#fafafa",
  surfaceHov: "#f4f4f5",
}

const LANG_COLORS: Record<string, string> = {
  TypeScript: "#3178c6", JavaScript: "#f0db4f", Python: "#3776ab",
  Go: "#00add8", Rust: "#ce422b", Java: "#b07219", "C++": "#f34b7d",
  C: "#555555", Ruby: "#701516", PHP: "#4f5d95", Swift: "#f05138",
  Kotlin: "#a97bff", Dart: "#00b4ab",
}

export function NewProjectModal(props: {
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = createSignal("")
  const [repoSearch, setRepoSearch] = createSignal("")
  const [selectedRepo, setSelectedRepo] = createSignal<GitHubRepo | null>(null)
  const [manualRepo, setManualRepo] = createSignal("")
  const [showManual, setShowManual] = createSignal(false)
  const [pat, setPat] = createSignal("")
  const [showPat, setShowPat] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [createdProjectId, setCreatedProjectId] = createSignal<string | null>(null)
  const [cloneState, setCloneState] = createSignal<"idle" | "cloning" | "indexing" | "done" | "failed">("idle")
  const [cloneError, setCloneError] = createSignal<string | null>(null)
  const [componentCount, setComponentCount] = createSignal(0)
  const [connectingGitHub, setConnectingGitHub] = createSignal(false)

  const [ghStatus, { refetch: refetchGhStatus }] = createResource(() => elApi.getGitHubStatus())
  const [repos, { refetch: refetchRepos }] = createResource(
    () => ghStatus()?.connected ? repoSearch() : null,
    (q) => elApi.listGitHubRepos(q || undefined).catch(() => [] as GitHubRepo[]),
  )

  // Final github_url to use when creating the project
  const githubUrl = () => {
    const sel = selectedRepo()
    if (sel) return `https://github.com/${sel.full_name}`
    const m = manualRepo().trim()
    if (m) return m.startsWith("https://") ? m : `https://github.com/${m}`
    return undefined
  }

  const canCreate = () => name().trim().length > 0

  async function connectGitHub() {
    setConnectingGitHub(true)
    try {
      const { url } = await elApi.getGitHubConnectUrl()
      const popup = window.open(url, "github-oauth", "width=900,height=640,left=200,top=100")
      if (!popup) {
        showToast({ variant: "error", title: "Popup blocked — allow popups and try again" })
        setConnectingGitHub(false)
        return
      }
      const handler = (e: MessageEvent) => {
        if (e.data?.type === "github-connected") {
          window.removeEventListener("message", handler)
          setConnectingGitHub(false)
          void refetchGhStatus()
          void refetchRepos()
        } else if (e.data?.type === "github-error") {
          window.removeEventListener("message", handler)
          setConnectingGitHub(false)
          showToast({ variant: "error", title: e.data.error ?? "GitHub connection failed" })
        }
      }
      window.addEventListener("message", handler)
      // Cleanup if popup is closed manually
      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed)
          window.removeEventListener("message", handler)
          setConnectingGitHub(false)
        }
      }, 1000)
    } catch (err) {
      setConnectingGitHub(false)
      showToast({ variant: "error", title: String(err instanceof Error ? err.message : err) })
    }
  }

  async function disconnectGitHub() {
    await elApi.disconnectGitHub()
    setSelectedRepo(null)
    void refetchGhStatus()
  }

  async function create() {
    if (!canCreate() || busy()) return
    setBusy(true)
    try {
      const project = await elApi.createProject({
        name: name().trim(),
        ...(githubUrl() ? { github_url: githubUrl() } : {}),
        ...(pat().trim() ? { github_pat: pat().trim() } : {}),
      })
      setCreatedProjectId(project.id)

      if (githubUrl()) {
        setCloneState("cloning")
        await elApi.cloneRepo(project.id)
        const poll = setInterval(async () => {
          try {
            const status = await elApi.getCloneStatus(project.id)
            if (status.clone_status === "indexing") setCloneState("indexing")
            if (status.clone_status === "done") {
              clearInterval(poll)
              setCloneState("done")
              setComponentCount(status.node_count)
            }
            if (status.clone_status === "failed") {
              clearInterval(poll)
              setCloneState("failed")
              setCloneError(status.clone_error ?? "Clone failed")
            }
          } catch { /* ignore poll errors */ }
        }, 2000)
        onCleanup(() => clearInterval(poll))
      } else {
        props.onCreated()
      }
    } catch (err) {
      showToast({ variant: "error", title: String(err instanceof Error ? err.message : "Failed to create project") })
      setBusy(false)
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && canCreate() && cloneState() === "idle") void create()
    if (e.key === "Escape") props.onClose()
  }

  const connected = () => ghStatus()?.connected ?? false
  const login = () => ghStatus()?.login ?? null
  const ghConfigured = () => ghStatus()?.configured ?? false

  return (
    <Portal mount={document.body}>
      <div
        style={{
          position: "fixed", inset: "0", "z-index": "300",
          background: "rgba(0,0,0,0.35)",
          display: "flex", "align-items": "center", "justify-content": "center",
        }}
        onClick={props.onClose}
      >
        <div
          style={{
            width: "520px", "max-width": "94vw", "max-height": "92vh",
            background: T.bg,
            border: `1px solid ${T.border}`,
            "border-radius": "10px",
            "box-shadow": "0 16px 48px rgba(0,0,0,0.14)",
            overflow: "hidden",
            display: "flex", "flex-direction": "column",
          }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={onKeyDown}
        >
          {/* Header */}
          <div style={{
            "flex-shrink": "0",
            display: "flex", "align-items": "center", "justify-content": "space-between",
            padding: "18px 20px 14px",
            "border-bottom": `1px solid ${T.border}`,
          }}>
            <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.amber} stroke-width="2.2" stroke-linecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              <span style={{ "font-size": "15px", "font-weight": "500", color: T.text }}>
                New <span style={{ color: T.amber }}>project</span>
              </span>
            </div>
            <button
              type="button"
              onClick={props.onClose}
              style={{
                display: "flex", "align-items": "center", "justify-content": "center",
                width: "26px", height: "26px",
                border: `1px solid ${T.border}`, "border-radius": "4px",
                background: "none", cursor: "pointer", color: T.textMuted,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          {/* Body */}
          <div style={{ flex: "1", "overflow-y": "auto", padding: "20px" }}>
            {/* Clone progress view */}
            <Show when={cloneState() !== "idle"}>
              <div style={{ padding: "8px 0", "text-align": "center" }}>
                <Show when={cloneState() === "cloning" || cloneState() === "indexing"}>
                  <div style={{ "font-size": "14px", "font-weight": "500", color: T.text, "margin-bottom": "8px" }}>
                    {cloneState() === "cloning" ? "Cloning repository…" : "Indexing files…"}
                  </div>
                  <div style={{ "font-size": "12px", color: T.textFaint, "margin-bottom": "20px" }}>
                    {cloneState() === "cloning"
                      ? `Fetching ${githubUrl()?.replace("https://github.com/", "")}…`
                      : "Building engineering brain from file structure…"}
                  </div>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={T.amber} stroke-width="2" stroke-linecap="round" style={{ animation: "sd-pulse 1.4s ease-in-out infinite" }}>
                    <circle cx="12" cy="12" r="9"/>
                  </svg>
                </Show>
                <Show when={cloneState() === "done"}>
                  <div style={{ "font-size": "14px", "font-weight": "500", color: T.text, "margin-bottom": "8px" }}>✓ Repository indexed</div>
                  <div style={{ "font-size": "12px", color: T.textFaint, "margin-bottom": "20px" }}>
                    {componentCount()} components found
                  </div>
                  <button type="button" onClick={() => props.onCreated()} style={{
                    padding: "7px 16px", "border-radius": "4px",
                    border: "1px solid rgba(214,138,46,0.4)", background: "rgba(214,138,46,0.1)",
                    "font-family": "'Geist Mono', monospace", "font-size": "11px", "font-weight": "600",
                    color: T.amber, cursor: "pointer",
                  }}>View graph →</button>
                </Show>
                <Show when={cloneState() === "failed"}>
                  <div style={{ "font-size": "14px", "font-weight": "500", color: "#ef4444", "margin-bottom": "8px" }}>Clone failed</div>
                  <div style={{ "font-size": "12px", color: T.textFaint, "margin-bottom": "20px", "word-break": "break-word" }}>
                    {cloneError()}
                  </div>
                  <div style={{ display: "flex", gap: "8px", "justify-content": "center" }}>
                    <button type="button" onClick={props.onCreated} style={{ padding: "6px 12px", border: `1px solid ${T.border}`, "border-radius": "4px", background: T.bg, "font-size": "12px", color: T.textMuted, cursor: "pointer" }}>
                      Skip for now
                    </button>
                    <button type="button" onClick={() => { setCloneState("cloning"); void elApi.cloneRepo(createdProjectId()!) }}
                      style={{ padding: "6px 12px", border: "1px solid rgba(214,138,46,0.4)", "border-radius": "4px", background: "rgba(214,138,46,0.1)", "font-size": "12px", color: T.amber, cursor: "pointer" }}>
                      Retry
                    </button>
                  </div>
                </Show>
              </div>
            </Show>

            {/* Form */}
            <Show when={cloneState() === "idle"}>
              {/* Project name */}
              <div style={{ "margin-bottom": "20px" }}>
                <label style={{
                  display: "block", "margin-bottom": "6px",
                  "font-family": "'Geist Mono', monospace", "font-size": "10px",
                  "font-weight": "600", "letter-spacing": "0.08em", "text-transform": "uppercase",
                  color: T.textMuted,
                }}>Project name</label>
                <input
                  type="text"
                  placeholder="e.g. auth-service, payments-infra, search-pipeline…"
                  value={name()}
                  onInput={(e) => setName(e.currentTarget.value)}
                  autofocus
                  style={{
                    width: "100%", "box-sizing": "border-box",
                    padding: "0 12px", height: "36px",
                    border: `1px solid ${T.border}`, "border-radius": "6px",
                    background: T.surface, outline: "none",
                    "font-family": "'Geist Mono', monospace", "font-size": "13px",
                    color: T.text, transition: "border-color 120ms",
                  }}
                  onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = T.amber }}
                  onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = T.border }}
                />
              </div>

              {/* GitHub repo section */}
              <div>
                <div style={{
                  display: "flex", "align-items": "center", "justify-content": "space-between",
                  "margin-bottom": "10px",
                }}>
                  <label style={{
                    "font-family": "'Geist Mono', monospace", "font-size": "10px",
                    "font-weight": "600", "letter-spacing": "0.08em", "text-transform": "uppercase",
                    color: T.textMuted,
                  }}>GitHub Repository</label>
                  <Show when={connected()}>
                    <div style={{ display: "flex", "align-items": "center", gap: "6px" }}>
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="#22c55e">
                        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                      </svg>
                      <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "11px", color: "#22c55e" }}>
                        @{login()}
                      </span>
                      <button
                        type="button"
                        onClick={() => void disconnectGitHub()}
                        style={{ background: "none", border: "none", cursor: "pointer", "font-size": "10px", color: T.textFaint, padding: "0 2px" }}
                      >disconnect</button>
                    </div>
                  </Show>
                </div>

                {/* Not connected — show Connect button */}
                <Show when={!ghStatus.loading && ghConfigured() && !connected()}>
                  <button
                    type="button"
                    onClick={() => void connectGitHub()}
                    disabled={connectingGitHub()}
                    style={{
                      width: "100%", display: "flex", "align-items": "center", "justify-content": "center", gap: "8px",
                      padding: "10px 16px", "border-radius": "8px",
                      border: `1px solid ${T.border}`, background: T.surface,
                      cursor: connectingGitHub() ? "default" : "pointer",
                      "font-size": "13px", "font-weight": "500", color: T.text,
                      transition: "all 120ms",
                      opacity: connectingGitHub() ? "0.6" : "1",
                      "margin-bottom": "10px",
                    }}
                    onMouseEnter={(e) => { if (!connectingGitHub()) { const el = e.currentTarget as HTMLElement; el.style.borderColor = T.borderHov; el.style.background = T.surfaceHov } }}
                    onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.borderColor = T.border; el.style.background = T.surface }}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill={T.text}>
                      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                    </svg>
                    {connectingGitHub() ? "Connecting…" : "Connect with GitHub"}
                  </button>
                  <div style={{ "text-align": "center", "margin-bottom": "10px" }}>
                    <button
                      type="button"
                      onClick={() => setShowManual((v) => !v)}
                      style={{ background: "none", border: "none", cursor: "pointer", "font-size": "11px", color: T.textFaint }}
                    >
                      {showManual() ? "▲ hide" : "or enter repo URL manually"}
                    </button>
                  </div>
                </Show>

                {/* Repo browser — connected */}
                <Show when={connected()}>
                  <Show when={selectedRepo()}>
                    {(repo) => (
                      <div style={{
                        display: "flex", "align-items": "center", gap: "8px",
                        padding: "8px 12px", "border-radius": "6px",
                        border: `1px solid rgba(214,138,46,0.4)`, background: "rgba(214,138,46,0.06)",
                        "margin-bottom": "8px",
                      }}>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill={T.amber}>
                          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                        </svg>
                        <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "12px", color: T.amber, flex: "1" }}>
                          {repo().full_name}
                        </span>
                        <Show when={repo().private}>
                          <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "9px", color: T.textFaint, border: `1px solid ${T.border}`, padding: "1px 4px", "border-radius": "3px" }}>PRIVATE</span>
                        </Show>
                        <button
                          type="button"
                          onClick={() => setSelectedRepo(null)}
                          style={{ background: "none", border: "none", cursor: "pointer", color: T.textFaint, padding: "2px", display: "flex" }}
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                        </button>
                      </div>
                    )}
                  </Show>

                  <Show when={!selectedRepo()}>
                    {/* Search */}
                    <div style={{ position: "relative", "margin-bottom": "6px" }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.textFaint} stroke-width="2" stroke-linecap="round" style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", "pointer-events": "none" }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                      <input
                        type="text"
                        placeholder="Search your repos…"
                        value={repoSearch()}
                        onInput={(e) => setRepoSearch(e.currentTarget.value)}
                        style={{
                          width: "100%", "box-sizing": "border-box",
                          padding: "0 12px 0 30px", height: "34px",
                          border: `1px solid ${T.border}`, "border-radius": "6px",
                          background: T.surface, outline: "none",
                          "font-family": "'Geist Mono', monospace", "font-size": "12px",
                          color: T.text, transition: "border-color 120ms",
                        }}
                        onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = T.amber }}
                        onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = T.border }}
                      />
                    </div>

                    {/* Repo list */}
                    <div style={{
                      "max-height": "200px", "overflow-y": "auto",
                      border: `1px solid ${T.border}`, "border-radius": "6px",
                      "margin-bottom": "6px",
                    }}>
                      <Show when={repos.loading}>
                        <div style={{ padding: "20px", "text-align": "center", "font-size": "12px", color: T.textFaint }}>
                          Loading repos…
                        </div>
                      </Show>
                      <Show when={!repos.loading && (!repos() || repos()!.length === 0)}>
                        <div style={{ padding: "20px", "text-align": "center", "font-size": "12px", color: T.textFaint }}>
                          {repoSearch() ? "No repos match your search" : "No repos found"}
                        </div>
                      </Show>
                      <For each={repos() ?? []}>
                        {(repo) => <RepoRow repo={repo} onSelect={() => setSelectedRepo(repo)} />}
                      </For>
                    </div>
                    {/* Toggle to enter any URL manually */}
                    <div style={{ "text-align": "center", "margin-bottom": "8px" }}>
                      <button
                        type="button"
                        onClick={() => setShowManual((v) => !v)}
                        style={{ background: "none", border: "none", cursor: "pointer", "font-size": "11px", color: T.textFaint }}
                      >
                        {showManual() ? "▲ hide" : "or enter any repo URL"}
                      </button>
                    </div>
                  </Show>
                </Show>

                {/* Manual URL input — shown when not connected, GitHub not configured, or user toggled it */}
                <Show when={!ghConfigured() || showManual()}>
                  <div style={{ "margin-bottom": "10px" }}>
                    <div style={{
                      display: "flex", "align-items": "center",
                      border: `1px solid ${T.border}`, "border-radius": "6px",
                      background: T.surface, overflow: "hidden",
                      transition: "border-color 120ms",
                    }}
                      onFocusIn={(e) => { (e.currentTarget as HTMLElement).style.borderColor = T.amber }}
                      onFocusOut={(e) => { (e.currentTarget as HTMLElement).style.borderColor = T.border }}
                    >
                      <span style={{
                        padding: "0 10px", height: "36px", display: "flex", "align-items": "center",
                        "font-family": "'Geist Mono', monospace", "font-size": "11px", color: T.textFaint,
                        "border-right": `1px solid ${T.border}`, background: "#f4f4f5",
                        "white-space": "nowrap", "flex-shrink": "0",
                      }}>github.com/</span>
                      <input
                        type="text"
                        placeholder="org/repo-name"
                        value={manualRepo()}
                        onInput={(e) => setManualRepo(e.currentTarget.value)}
                        style={{
                          flex: "1", border: "none", background: "transparent",
                          padding: "0 12px", height: "36px",
                          "font-family": "'Geist Mono', monospace", "font-size": "12px",
                          color: T.text, outline: "none",
                        }}
                      />
                    </div>
                  </div>
                </Show>

                {/* PAT field (hidden when GitHub is connected via OAuth) */}
                <Show when={!connected()}>
                  <div style={{ "margin-top": "4px" }}>
                    <button
                      type="button"
                      onClick={() => setShowPat((v) => !v)}
                      style={{
                        display: "flex", "align-items": "center", gap: "5px",
                        background: "none", border: "none", cursor: "pointer", padding: "0",
                        "font-family": "'Geist Mono', monospace", "font-size": "10px",
                        "font-weight": "600", "letter-spacing": "0.06em", "text-transform": "uppercase",
                        color: T.textFaint, transition: "color 120ms",
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = T.textMuted }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = T.textFaint }}
                    >
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
                        style={{ transform: showPat() ? "rotate(90deg)" : "none", transition: "transform 120ms" }}>
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                      {showPat() ? "Hide" : "Add"} GitHub PAT (private repos / rate limits)
                    </button>
                    <Show when={showPat()}>
                      <div style={{ "margin-top": "8px" }}>
                        <input
                          type="password"
                          placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                          value={pat()}
                          onInput={(e) => setPat(e.currentTarget.value)}
                          style={{
                            width: "100%", "box-sizing": "border-box",
                            padding: "0 12px", height: "36px",
                            border: `1px solid ${T.border}`, "border-radius": "6px",
                            background: T.surface, outline: "none",
                            "font-family": "'Geist Mono', monospace", "font-size": "12px",
                            color: T.text, transition: "border-color 120ms",
                          }}
                          onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = T.amber }}
                          onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = T.border }}
                        />
                        <div style={{ "margin-top": "5px", "font-size": "11px", color: T.textFaint }}>
                          Stored locally. Needs <code style={{ "font-family": "inherit", background: "#f4f4f5", padding: "0 3px", "border-radius": "2px" }}>repo:read</code> scope.
                        </div>
                      </div>
                    </Show>
                  </div>
                </Show>
              </div>
            </Show>
          </div>

          {/* Footer */}
          <Show when={cloneState() === "idle"}>
            <div style={{
              "flex-shrink": "0",
              display: "flex", "align-items": "center", "justify-content": "space-between",
              padding: "12px 20px 16px",
              "border-top": `1px solid ${T.border}`,
            }}>
              <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", color: T.textFaint }}>
                ↵ create · esc cancel
              </span>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  onClick={props.onClose}
                  style={{
                    padding: "6px 14px", "border-radius": "4px",
                    border: `1px solid ${T.border}`, background: T.bg,
                    "font-size": "12px", color: T.textMuted, cursor: "pointer", transition: "all 120ms",
                  }}
                  onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.borderColor = T.borderHov; el.style.color = T.text }}
                  onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.borderColor = T.border; el.style.color = T.textMuted }}
                >Cancel</button>
                <button
                  type="button"
                  disabled={!canCreate() || busy()}
                  onClick={() => void create()}
                  style={{
                    padding: "6px 14px", "border-radius": "4px",
                    border: `1px solid ${canCreate() && !busy() ? T.amberBorder : T.border}`,
                    background: canCreate() && !busy() ? T.amberBg : "#f4f4f5",
                    "font-family": "'Geist Mono', monospace", "font-size": "11px", "font-weight": "600",
                    "letter-spacing": "0.04em",
                    color: canCreate() && !busy() ? T.amber : T.textFaint,
                    cursor: canCreate() && !busy() ? "pointer" : "default",
                    transition: "all 120ms",
                    opacity: busy() ? "0.6" : "1",
                  }}
                >
                  <Show when={busy()} fallback="Create project →">Creating…</Show>
                </button>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </Portal>
  )
}

function RepoRow(props: { repo: GitHubRepo; onSelect: () => void }) {
  const [hov, setHov] = createSignal(false)
  const langColor = () => props.repo.language ? (LANG_COLORS[props.repo.language] ?? "#737373") : null

  return (
    <div
      style={{
        display: "flex", "align-items": "center", gap: "8px",
        padding: "7px 12px",
        background: hov() ? T.surfaceHov : "transparent",
        "border-bottom": `1px solid ${T.border}`,
        cursor: "pointer", transition: "background 80ms",
      }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={props.onSelect}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill={T.textFaint} style={{ "flex-shrink": "0" }}>
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
      </svg>
      <span style={{
        "font-family": "'Geist Mono', monospace", "font-size": "12px",
        color: T.text, flex: "1", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap",
      }}>
        {props.repo.full_name}
      </span>
      <Show when={langColor()}>
        <span style={{ width: "8px", height: "8px", "border-radius": "50%", background: langColor()!, "flex-shrink": "0", display: "inline-block" }} />
      </Show>
      <Show when={props.repo.private}>
        <span style={{
          "font-family": "'Geist Mono', monospace", "font-size": "9px", color: T.textFaint,
          border: `1px solid ${T.border}`, padding: "1px 4px", "border-radius": "3px", "flex-shrink": "0",
        }}>PRIVATE</span>
      </Show>
    </div>
  )
}
