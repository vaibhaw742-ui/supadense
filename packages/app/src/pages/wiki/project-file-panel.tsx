import { createResource, createSignal, For, Show } from "solid-js"
import { elApi, type ProjectNode } from "@/pages/projects/el-api"

const T = {
  bg: "#ffffff",
  border: "#e5e5e5",
  text: "#0a0a0a",
  textMuted: "#737373",
  textFaint: "#a3a3a3",
  amber: "#d68a2e",
  amberBg: "rgba(214,138,46,0.08)",
  surfaceHov: "#fafafa",
}

const EXT_COLORS: Record<string, string> = {
  ".ts": "#3178c6",
  ".tsx": "#3178c6",
  ".js": "#f0db4f",
  ".jsx": "#61dafb",
  ".py": "#3776ab",
  ".go": "#00add8",
  ".rs": "#ce422b",
  ".sql": "#336791",
  ".md": "#737373",
  ".json": "#666666",
  ".yaml": "#666666",
  ".yml": "#666666",
  ".css": "#264de4",
  ".scss": "#cc6699",
  ".html": "#e34c26",
  ".sh": "#4eaa25",
  ".env": "#d68a2e",
}

function ExtBadge(props: { ext: string }) {
  const color = () => EXT_COLORS[props.ext] ?? "#a3a3a3"
  const label = () => props.ext.replace(/^\./, "").toUpperCase() || "FILE"
  return (
    <span style={{
      "font-family": "'Geist Mono', monospace", "font-size": "9px", "font-weight": "600",
      "letter-spacing": "0.06em", "text-transform": "uppercase",
      color: color(), padding: "1px 5px", "border-radius": "3px",
      background: `${color()}18`, border: `1px solid ${color()}30`,
      "white-space": "nowrap", "flex-shrink": "0",
    }}>
      {label()}
    </span>
  )
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

export function ProjectFilePanel(props: {
  projectId: string
  nodePath: string
  nodeLabel: string
  repoUrl?: string | null
  branch?: string | null
  onClose: () => void
}) {
  const [nodeData] = createResource(
    () => ({ projectId: props.projectId, nodePath: props.nodePath }),
    ({ projectId, nodePath }) => elApi.getNodeFiles(projectId, nodePath),
  )

  const breadcrumbs = () => {
    const parts = props.nodePath === "." ? [] : props.nodePath.split("/")
    return parts
  }

  const githubDirUrl = () => {
    if (!props.repoUrl || !props.branch) return null
    const base = props.repoUrl.replace(/\.git$/, "")
    const filePath = props.nodePath === "." ? "" : `/${props.nodePath}`
    return `${base}/tree/${props.branch}${filePath}`
  }

  return (
    <div style={{
      height: "100%", display: "flex", "flex-direction": "column",
      background: T.bg, "border-left": `1px solid ${T.border}`,
    }}>
      {/* Header */}
      <div style={{
        "flex-shrink": "0", display: "flex", "align-items": "center",
        "justify-content": "space-between", padding: "10px 16px 9px",
        "border-bottom": `1px solid ${T.border}`,
      }}>
        <div style={{ display: "flex", "align-items": "center", gap: "4px", overflow: "hidden" }}>
          <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", color: T.textFaint }}>
            /
          </span>
          <For each={breadcrumbs()}>
            {(part, i) => (
              <>
                <span style={{
                  "font-family": "'Geist Mono', monospace", "font-size": "10px",
                  "font-weight": i() === breadcrumbs().length - 1 ? "600" : "400",
                  color: i() === breadcrumbs().length - 1 ? T.text : T.textFaint,
                  overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap",
                }}>
                  {part}
                </span>
                <Show when={i() < breadcrumbs().length - 1}>
                  <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", color: T.textFaint }}>/</span>
                </Show>
              </>
            )}
          </For>
          <Show when={breadcrumbs().length === 0}>
            <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", "font-weight": "600", color: T.text }}>
              root
            </span>
          </Show>
        </div>
        <div style={{ display: "flex", "align-items": "center", gap: "8px", "flex-shrink": "0" }}>
          <Show when={githubDirUrl()}>
            <a
              href={githubDirUrl()!}
              target="_blank"
              rel="noopener noreferrer"
              style={{ "font-size": "11px", color: T.textFaint, "text-decoration": "none", transition: "color 120ms" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = T.amber }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = T.textFaint }}
            >
              GitHub ↗
            </a>
          </Show>
          <button
            type="button"
            onClick={props.onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: T.textFaint, padding: "2px", display: "flex", "align-items": "center" }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: "1", "overflow-y": "auto" }}>
        <Show when={nodeData.loading}>
          <div style={{ padding: "32px", "text-align": "center", color: T.textFaint, "font-size": "12px" }}>
            Loading…
          </div>
        </Show>

        <Show when={nodeData()}>
          {(data) => (
            <>
              {/* Stats */}
              <div style={{
                padding: "8px 16px", "border-bottom": `1px solid ${T.border}`,
                display: "flex", gap: "12px",
              }}>
                <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", color: T.textFaint }}>
                  {data().file_count} files
                </span>
                <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", color: T.textFaint }}>
                  {data().total_file_count} total
                </span>
                <Show when={(data().children ?? []).length > 0}>
                  <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", color: T.textFaint }}>
                    {(data().children ?? []).length} subdirs
                  </span>
                </Show>
              </div>

              {/* Sub-directories */}
              <Show when={(data().children ?? []).length > 0}>
                <div style={{ "border-bottom": `1px solid ${T.border}`, padding: "4px 0" }}>
                  <div style={{ padding: "6px 16px 4px", "font-family": "'Geist Mono', monospace", "font-size": "9px", "font-weight": "600", "letter-spacing": "0.08em", "text-transform": "uppercase", color: T.textFaint }}>
                    Subdirectories
                  </div>
                  <For each={data().children ?? []}>
                    {(child) => (
                      <div style={{
                        display: "flex", "align-items": "center", gap: "8px",
                        padding: "5px 16px", cursor: "default",
                      }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.textFaint} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style={{ "flex-shrink": "0" }}>
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                        </svg>
                        <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "12px", color: T.textMuted, flex: "1" }}>
                          {child.name}/
                        </span>
                        <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", color: T.textFaint }}>
                          {child.total_file_count}
                        </span>
                      </div>
                    )}
                  </For>
                </div>
              </Show>

              {/* Key files */}
              <Show when={(data().key_files ?? []).length > 0}>
                <div style={{ "border-bottom": `1px solid ${T.border}`, padding: "4px 0" }}>
                  <div style={{ padding: "6px 16px 4px", "font-family": "'Geist Mono', monospace", "font-size": "9px", "font-weight": "600", "letter-spacing": "0.08em", "text-transform": "uppercase", color: T.amber }}>
                    Key files
                  </div>
                  <For each={data().key_files ?? []}>
                    {(fname) => {
                      const file = () => data().files_json.find((f) => f.name === fname)
                      return (
                        <Show when={file()}>
                          <FileRow
                            file={file()!}
                            projectId={props.projectId}
                            repoUrl={props.repoUrl}
                            branch={props.branch}
                            isKey
                          />
                        </Show>
                      )
                    }}
                  </For>
                </div>
              </Show>

              {/* All files */}
              <Show when={data().files_json.length > 0}>
                <div style={{ padding: "4px 0" }}>
                  <div style={{ padding: "6px 16px 4px", "font-family": "'Geist Mono', monospace", "font-size": "9px", "font-weight": "600", "letter-spacing": "0.08em", "text-transform": "uppercase", color: T.textFaint }}>
                    Files
                  </div>
                  <For each={data().files_json.filter((f) => !data().key_files.includes(f.name))}>
                    {(file) => (
                      <FileRow
                        file={file}
                        projectId={props.projectId}
                        repoUrl={props.repoUrl}
                        branch={props.branch}
                      />
                    )}
                  </For>
                </div>
              </Show>
            </>
          )}
        </Show>
      </div>
    </div>
  )
}

function FileRow(props: {
  file: { name: string; path: string; ext: string; size_bytes: number }
  projectId: string
  repoUrl?: string | null
  branch?: string | null
  isKey?: boolean
}) {
  const [hov, setHov] = createSignal(false)

  const githubUrl = () => {
    if (!props.repoUrl || !props.branch) return null
    const base = props.repoUrl.replace(/\.git$/, "")
    return `${base}/blob/${props.branch}/${props.file.path}`
  }

  return (
    <a
      href={githubUrl() ?? undefined}
      target={githubUrl() ? "_blank" : undefined}
      rel="noopener noreferrer"
      style={{
        display: "flex", "align-items": "center", gap: "8px",
        padding: "4px 16px",
        background: hov() ? T.surfaceHov : "transparent",
        transition: "background 80ms",
        "text-decoration": "none",
        cursor: githubUrl() ? "pointer" : "default",
      }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      <Show when={props.isKey}>
        <span style={{ width: "6px", height: "6px", "border-radius": "50%", background: T.amber, "flex-shrink": "0", display: "inline-block" }} />
      </Show>
      <ExtBadge ext={props.file.ext} />
      <span style={{
        "font-family": "'Geist Mono', monospace", "font-size": "12px",
        color: T.text, flex: "1", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap",
      }}>
        {props.file.name}
      </span>
      <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", color: T.textFaint, "flex-shrink": "0" }}>
        {sizeLabel(props.file.size_bytes)}
      </span>
    </a>
  )
}
