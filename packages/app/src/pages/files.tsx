import { createSignal, createMemo, Show, onMount } from "solid-js"
import { useParams } from "@solidjs/router"
import { useFile } from "@/context/file"
import { useServer } from "@/context/server"
import { decode64 } from "@/utils/base64"
import { getAuthToken } from "@/utils/server"
import { renderMarkdown } from "./wiki/markdown"
import FileTree from "@/components/file-tree"
import "./wiki/wiki.css"

function apiBase(server: ReturnType<typeof useServer>): string {
  const http = server.current?.http
  if (!http) return import.meta.env.DEV
    ? `http://${import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:${import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`
    : `${location.origin}/api`
  return typeof http === "string" ? http : (http as { url: string }).url
}

export default function FilesPage() {
  const params = useParams<{ dir: string }>()
  const file = useFile()
  const server = useServer()

  const directory = () => decode64(params.dir) ?? ""
  const [selectedPath, setSelectedPath] = createSignal<string | null>(null)
  const [content, setContent] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(false)

  onMount(() => {
    void file.tree.refresh("")
  })

  const isMarkdown = (path: string) => path.endsWith(".md") || path.endsWith(".mdx")

  const loadFile = async (path: string) => {
    setSelectedPath(path)
    setContent(null)
    setLoading(true)
    try {
      const token = getAuthToken()
      const base = apiBase(server)
      const res = await fetch(
        `${base}/file/read?path=${encodeURIComponent(path)}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      )
      if (!res.ok) { setContent("Failed to load file."); return }
      const text = await res.text()
      setContent(text)
    } catch {
      setContent("Failed to load file.")
    } finally {
      setLoading(false)
    }
  }

  const renderedHtml = createMemo(() => {
    const path = selectedPath()
    const text = content()
    if (!text || !path) return null
    if (isMarkdown(path)) return renderMarkdown(text)
    return null
  })

  return (
    <div class="flex h-screen w-full bg-background-base overflow-hidden">
      {/* Left: file tree */}
      <div class="w-64 shrink-0 h-full border-r border-border-weaker-base flex flex-col overflow-hidden bg-background-base">
        <div class="px-3 py-2 border-b border-border-weaker-base shrink-0 flex items-center justify-between">
          <span class="text-12-medium text-text-weak uppercase tracking-wider">
            {directory().split("/").pop() ?? "Files"}
          </span>
          <button
            class="text-text-weak hover:text-text-strong"
            onClick={() => window.history.back()}
            aria-label="Close"
            title="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto px-2 pt-2">
          <FileTree
            path=""
            onFileClick={(node) => void loadFile(node.path)}
            onFolderClick={(node) => setSelectedPath(node.path)}
            active={selectedPath() ?? undefined}
          />
        </div>
      </div>

      {/* Right: content viewer */}
      <div class="flex-1 min-w-0 h-full overflow-hidden flex flex-col">
        <Show when={selectedPath()} fallback={
          <div class="flex-1 flex items-center justify-center text-text-weak text-14-regular">
            Select a file to view its contents
          </div>
        }>
          <div class="flex-1 min-h-0 overflow-y-auto">
            <Show when={loading()}>
              <div class="p-8 text-text-weak text-12-regular">Loading…</div>
            </Show>
            <Show when={!loading() && content() !== null}>
              <Show when={renderedHtml()} fallback={
                <pre class="p-6 text-12-regular text-text-base font-mono whitespace-pre-wrap break-words">{content()}</pre>
              }>
                {(html) => (
                  <div
                    class="wk-content px-8 py-6 max-w-4xl"
                    innerHTML={html()}
                  />
                )}
              </Show>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}
