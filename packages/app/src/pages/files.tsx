import { createSignal, createResource, For, Show, Suspense } from "solid-js"
import { useParams } from "@solidjs/router"
import { useServer } from "@/context/server"
import { decode64 } from "@/utils/base64"
import { getAuthToken } from "@/utils/server"
import { renderMarkdown } from "./wiki/markdown"
import "./wiki/wiki.css"

type FileNode = { name: string; path: string; type: "file" | "directory" }

function apiBase(server: ReturnType<typeof useServer>): string {
  const http = server.current?.http
  if (!http) return import.meta.env.DEV
    ? `http://${import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:${import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`
    : `${location.origin}/api`
  return typeof http === "string" ? http : (http as { url: string }).url
}

async function listDir(base: string, path: string): Promise<FileNode[]> {
  const token = getAuthToken()
  const res = await fetch(
    `${base}/file/list?path=${encodeURIComponent(path)}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  )
  if (!res.ok) return []
  const data = await res.json() as { children?: { name: string; path: string; type: string }[] }
  return (data.children ?? []).map((n) => ({
    name: n.name,
    path: n.path,
    type: n.type === "directory" ? "directory" : "file",
  }))
}

async function readFile(base: string, path: string): Promise<string> {
  const token = getAuthToken()
  const res = await fetch(
    `${base}/file/read?path=${encodeURIComponent(path)}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  )
  if (!res.ok) throw new Error("Failed to load file")
  return res.text()
}

function FileTreeNode(props: {
  node: FileNode
  base: string
  level: number
  activePath: () => string | null
  onFileClick: (path: string) => void
}) {
  const [expanded, setExpanded] = createSignal(false)
  const [children] = createResource(
    () => (props.node.type === "directory" && expanded() ? props.node.path : null),
    (path) => listDir(props.base, path),
  )

  const indent = () => `${props.level * 12 + 8}px`
  const isActive = () => props.activePath() === props.node.path

  if (props.node.type === "directory") {
    return (
      <div>
        <button
          class="w-full text-left flex items-center gap-1 py-0.5 pr-2 hover:bg-surface-base-hover rounded text-13-regular text-text-base cursor-default"
          style={{ "padding-left": indent() }}
          onClick={() => setExpanded((v) => !v)}
        >
          <svg
            width="10" height="10" viewBox="0 0 10 10"
            class="shrink-0 text-icon-base transition-transform"
            style={{ transform: expanded() ? "rotate(90deg)" : "none" }}
          >
            <path d="M3 2l4 3-4 3" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-icon-base">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          <span class="truncate">{props.node.name}</span>
        </button>
        <Show when={expanded()}>
          <Suspense>
            <For each={children()}>
              {(child) => (
                <FileTreeNode
                  node={child}
                  base={props.base}
                  level={props.level + 1}
                  activePath={props.activePath}
                  onFileClick={props.onFileClick}
                />
              )}
            </For>
          </Suspense>
        </Show>
      </div>
    )
  }

  return (
    <button
      class="w-full text-left flex items-center gap-1.5 py-0.5 pr-2 rounded text-13-regular cursor-default"
      classList={{
        "bg-surface-base-active text-text-strong": isActive(),
        "hover:bg-surface-base-hover text-text-base": !isActive(),
      }}
      style={{ "padding-left": indent() }}
      onClick={() => props.onFileClick(props.node.path)}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-icon-base">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
      <span class="truncate">{props.node.name}</span>
    </button>
  )
}

export default function FilesPage() {
  const params = useParams<{ dir: string }>()
  const server = useServer()

  const directory = () => decode64(params.dir) ?? ""
  const base = () => apiBase(server)

  const [rootNodes] = createResource(
    () => ({ base: base(), dir: directory() }),
    ({ base, dir }) => listDir(base, dir),
  )

  const [activePath, setActivePath] = createSignal<string | null>(null)
  const [fileContent, setFileContent] = createSignal<string | null>(null)
  const [fileLoading, setFileLoading] = createSignal(false)
  const [fileError, setFileError] = createSignal(false)

  const isMarkdown = (path: string) => path.endsWith(".md") || path.endsWith(".mdx")

  const handleFileClick = async (path: string) => {
    setActivePath(path)
    setFileContent(null)
    setFileError(false)
    setFileLoading(true)
    try {
      const text = await readFile(base(), path)
      setFileContent(text)
    } catch {
      setFileError(true)
    } finally {
      setFileLoading(false)
    }
  }

  return (
    <div class="flex h-screen w-full overflow-hidden" style={{ background: "var(--color-background-base, #fff)", "font-family": "inherit" }}>
      {/* Left: file tree */}
      <div class="shrink-0 h-full border-r flex flex-col overflow-hidden" style={{ width: "256px", "border-color": "var(--color-border-weaker-base, #e5e7eb)" }}>
        <div class="px-3 py-2 border-b shrink-0 flex items-center justify-between" style={{ "border-color": "var(--color-border-weaker-base, #e5e7eb)" }}>
          <span class="text-11-medium uppercase tracking-wider" style={{ color: "var(--color-text-weak, #6b7280)" }}>
            {directory().split("/").pop() ?? "Files"}
          </span>
          <button
            onClick={() => window.history.back()}
            aria-label="Close"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-weak, #6b7280)", padding: "2px", "border-radius": "4px", display: "flex", "align-items": "center" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto py-1">
          <Suspense fallback={<div class="px-4 py-2 text-12-regular" style={{ color: "var(--color-text-weak)" }}>Loading…</div>}>
            <For each={rootNodes()}>
              {(node) => (
                <FileTreeNode
                  node={node}
                  base={base()}
                  level={0}
                  activePath={activePath}
                  onFileClick={(p) => void handleFileClick(p)}
                />
              )}
            </For>
          </Suspense>
        </div>
      </div>

      {/* Right: content */}
      <div class="flex-1 min-w-0 h-full overflow-hidden flex flex-col">
        <Show when={!activePath()}>
          <div class="flex-1 flex items-center justify-center text-14-regular" style={{ color: "var(--color-text-weak, #6b7280)" }}>
            Select a file to view its contents
          </div>
        </Show>
        <Show when={activePath()}>
          <div class="flex-1 min-h-0 overflow-y-auto">
            <Show when={fileLoading()}>
              <div class="p-8 text-12-regular" style={{ color: "var(--color-text-weak)" }}>Loading…</div>
            </Show>
            <Show when={fileError()}>
              <div class="p-8 text-12-regular" style={{ color: "var(--color-text-weak)" }}>Failed to load file.</div>
            </Show>
            <Show when={!fileLoading() && !fileError() && fileContent() !== null}>
              <Show
                when={isMarkdown(activePath()!)}
                fallback={
                  <pre class="p-6 text-12-regular font-mono whitespace-pre-wrap break-words" style={{ color: "var(--color-text-base)" }}>{fileContent()}</pre>
                }
              >
                <div
                  class="wk-content px-8 py-6 max-w-4xl"
                  innerHTML={renderMarkdown(fileContent()!)}
                />
              </Show>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}
