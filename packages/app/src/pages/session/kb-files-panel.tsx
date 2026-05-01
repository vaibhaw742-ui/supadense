import { createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useServer } from "@/context/server"
import { useSDK } from "@/context/sdk"
import { getAuthToken } from "@/utils/server"

// ── KB Jobs badge ─────────────────────────────────────────────────────────────

interface KbJob { sessionID: string; title: string; status: string }

export function useKbJobs() {
  const server = useServer()
  const sdk = useSDK()

  function baseUrl(): string {
    const http = server.current?.http
    if (!http) return "http://localhost:4096"
    return typeof http === "string" ? http : (http as { url: string }).url
  }

  function headers(): Record<string, string> {
    const token = getAuthToken()
    return {
      "x-opencode-directory": sdk.directory,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }
  }

  const [jobs, setJobs] = createSignal<KbJob[]>([])
  const [justFinished, setJustFinished] = createSignal(false)

  async function poll() {
    try {
      const res = await fetch(`${baseUrl()}/wiki/jobs`, { headers: headers() })
      if (!res.ok) return
      const data = await res.json() as { jobs: KbJob[] }
      const prev = jobs()
      const next = data.jobs
      setJobs(next)
      // If we had running jobs and now have none — briefly show "Done"
      if (prev.length > 0 && next.length === 0) {
        setJustFinished(true)
        setTimeout(() => setJustFinished(false), 3000)
      }
    } catch { /* ignore */ }
  }

  onMount(() => {
    poll()
    const interval = setInterval(poll, 4_000)
    // Also poll immediately when AI finishes a turn
    const stop = sdk.event.listen((evt) => {
      if (evt.details.type === "session.idle") poll()
    })
    onCleanup(() => { clearInterval(interval); stop() })
  })

  return { jobs, justFinished }
}

export function KbJobsBadge() {
  const { jobs, justFinished } = useKbJobs()
  const count = () => jobs().length

  return (
    <Show when={count() > 0 || justFinished()}>
      <div
        title={jobs().map(j => j.title).join(", ") || "Done"}
        style={{
          display: "inline-flex",
          "align-items": "center",
          gap: "5px",
          padding: "2px 7px",
          "border-radius": "10px",
          "font-size": "10px",
          "font-weight": "600",
          "white-space": "nowrap",
          background: count() > 0 ? "rgba(196,74,14,0.10)" : "rgba(34,197,94,0.12)",
          color: count() > 0 ? "#c44a0e" : "#16a34a",
          border: count() > 0 ? "1px solid rgba(196,74,14,0.25)" : "1px solid rgba(34,197,94,0.3)",
          transition: "all 0.3s ease",
        }}
      >
        <Show when={count() > 0} fallback={<span>✓ Done</span>}>
          <span style={{ animation: "kb-spin 1s linear infinite", display: "inline-block" }}>⟳</span>
          <span>{count() === 1 ? "Processing" : `${count()} processing`}</span>
        </Show>
      </div>
      <style>{`@keyframes kb-spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </Show>
  )
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface KbSection {
  id: string
  title: string
  slug: string
  file_path: string
}

export interface KbTreeNode {
  id: string
  name: string
  slug: string
  depth: string
  folder_path: string
  overview: KbSection | null
  sections: KbSection[]
  subcategories: KbTreeNode[]
}

// ── API ────────────────────────────────────────────────────────────────────────

export function useKbApi() {
  const server = useServer()
  const sdk = useSDK()

  function baseUrl(): string {
    const http = server.current?.http
    if (!http) return "http://localhost:4096"
    return typeof http === "string" ? http : (http as { url: string }).url
  }

  function headers(): Record<string, string> {
    const token = getAuthToken()
    return {
      "x-opencode-directory": sdk.directory,
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }
  }

  return {
    tree: async (): Promise<{ nodes: KbTreeNode[]; kb_path: string }> => {
      const res = await fetch(`${baseUrl()}/wiki/tree`, { headers: headers() })
      if (!res.ok) return { nodes: [], kb_path: "" }
      const data = await res.json() as { tree: KbTreeNode[]; kb_path: string }
      return { nodes: data.tree, kb_path: data.kb_path }
    },
    createCategory: async (name: string, parentCategoryId?: string): Promise<void> => {
      await fetch(`${baseUrl()}/wiki/category`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ name, parent_category_id: parentCategoryId }),
      })
    },
    createSection: async (name: string, categoryId: string): Promise<void> => {
      await fetch(`${baseUrl()}/wiki/section`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ name, category_id: categoryId }),
      })
    },
    deleteCategory: async (id: string): Promise<void> => {
      await fetch(`${baseUrl()}/wiki/category/${id}`, {
        method: "DELETE",
        headers: headers(),
      })
    },
    renameCategory: async (id: string, name: string): Promise<void> => {
      await fetch(`${baseUrl()}/wiki/category/${id}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ name }),
      })
    },
    deleteSection: async (id: string): Promise<void> => {
      await fetch(`${baseUrl()}/wiki/section/${id}`, {
        method: "DELETE",
        headers: headers(),
      })
    },
    renameSection: async (id: string, name: string): Promise<void> => {
      await fetch(`${baseUrl()}/wiki/section/${id}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ name }),
      })
    },
  }
}

// ── Inline input ───────────────────────────────────────────────────────────────

export function InlineInput(props: {
  placeholder: string
  onConfirm: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = createSignal("")

  const submit = () => {
    const v = value().trim()
    if (v) props.onConfirm(v)
    else props.onCancel()
  }

  return (
    <div style={{ display: "flex", "align-items": "center", gap: "4px", padding: "2px 4px" }}>
      <input
        autofocus
        type="text"
        placeholder={props.placeholder}
        value={value()}
        onInput={(e) => setValue(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit()
          if (e.key === "Escape") props.onCancel()
        }}
        style={{
          flex: "1",
          "font-size": "12px",
          padding: "2px 6px",
          border: "1px solid #c44a0e",
          "border-radius": "4px",
          outline: "none",
          background: "#fff",
          color: "#1a1210",
          "min-width": "0",
        }}
      />
      <button
        onClick={submit}
        style={{ background: "#c44a0e", border: "none", "border-radius": "3px", color: "#fff", "font-size": "11px", padding: "2px 6px", cursor: "pointer" }}
      >
        ✓
      </button>
      <button
        onClick={props.onCancel}
        style={{ background: "none", border: "none", color: "#888", "font-size": "12px", cursor: "pointer", padding: "2px 4px" }}
      >
        ✕
      </button>
    </div>
  )
}

// ── + Dropdown ─────────────────────────────────────────────────────────────────

function PlusDropdown(props: {
  onAddSection: () => void
  onAddFolder: () => void
}) {
  const [open, setOpen] = createSignal(false)

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        style={{
          background: "none", border: "none", color: "#c44a0e", "font-size": "14px", cursor: "pointer",
          padding: "0 4px", "line-height": "1", opacity: "0", transition: "opacity 0.1s",
        }}
        class="kb-plus-btn"
        title="Add"
      >
        +
      </button>
      <Show when={open()}>
        <div
          style={{
            position: "absolute", right: "0", top: "100%", "z-index": "100",
            background: "#fff", border: "1px solid #e5e5e5", "border-radius": "6px",
            "box-shadow": "0 4px 12px rgba(0,0,0,0.1)", "min-width": "140px", padding: "4px 0",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => { setOpen(false); props.onAddSection() }}
            style={{ display: "block", width: "100%", "text-align": "left", padding: "6px 12px", background: "none", border: "none", "font-size": "12px", color: "#333", cursor: "pointer" }}
          >
            📄 Add section
          </button>
          <button
            onClick={() => { setOpen(false); props.onAddFolder() }}
            style={{ display: "block", width: "100%", "text-align": "left", padding: "6px 12px", background: "none", border: "none", "font-size": "12px", color: "#333", cursor: "pointer" }}
          >
            📁 Add subfolder
          </button>
        </div>
      </Show>
    </div>
  )
}

// ── Tree node (recursive) ──────────────────────────────────────────────────────

function TreeNode(props: {
  node: KbTreeNode
  depth: number
  onRefresh: () => void
  api: ReturnType<typeof useKbApi>
}) {
  const [expanded, setExpanded] = createSignal(true)
  const [creating, setCreating] = createSignal<"section" | "folder" | null>(null)

  const indent = () => `${props.depth * 14}px`

  const handleCreate = async (name: string) => {
    const mode = creating()
    setCreating(null)
    if (!name.trim()) return
    if (mode === "section") {
      await props.api.createSection(name, props.node.id)
    } else if (mode === "folder") {
      await props.api.createCategory(name, props.node.id)
    }
    props.onRefresh()
  }

  return (
    <div>
      {/* Folder row */}
      <div
        class="kb-tree-row"
        style={{
          display: "flex", "align-items": "center", gap: "4px",
          padding: `3px 8px 3px ${indent()}`, cursor: "pointer",
          "border-radius": "4px",
        }}
      >
        <span
          onClick={() => setExpanded((v) => !v)}
          style={{ "font-size": "10px", color: "#888", width: "12px", "flex-shrink": "0" }}
        >
          {expanded() ? "▾" : "▸"}
        </span>
        <span style={{ "font-size": "13px", "flex-shrink": "0" }}>📁</span>
        <span
          onClick={() => setExpanded((v) => !v)}
          style={{ "font-size": "12px", "font-weight": "500", color: "#1a1210", flex: "1", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}
        >
          {props.node.name}
        </span>
        <PlusDropdown
          onAddSection={() => setCreating("section")}
          onAddFolder={() => setCreating("folder")}
        />
      </div>

      {/* Inline creation input */}
      <Show when={creating()}>
        <div style={{ "padding-left": `calc(${indent()} + 28px)` }}>
          <InlineInput
            placeholder={creating() === "section" ? "section name…" : "folder name…"}
            onConfirm={handleCreate}
            onCancel={() => setCreating(null)}
          />
        </div>
      </Show>

      {/* Children */}
      <Show when={expanded()}>
        {/* overview.md — read-only */}
        <Show when={props.node.overview}>
          {(ov) => (
            <div
              style={{
                display: "flex", "align-items": "center", gap: "6px",
                padding: `2px 8px 2px calc(${indent()} + 26px)`,
                opacity: "0.5",
              }}
              title="Maintained by Supadense — read only"
            >
              <span style={{ "font-size": "11px" }}>📄</span>
              <span style={{ "font-size": "11px", color: "#888", "font-style": "italic" }}>
                overview.md
              </span>
              <span style={{ "font-size": "9px", color: "#bbb", "margin-left": "2px" }}>🔒</span>
            </div>
          )}
        </Show>

        {/* Sections */}
        <For each={props.node.sections}>
          {(section) => (
            <div
              class="kb-tree-row"
              style={{
                display: "flex", "align-items": "center", gap: "6px",
                padding: `2px 8px 2px calc(${indent()} + 26px)`,
                "border-radius": "4px", cursor: "default",
              }}
            >
              <span style={{ "font-size": "11px" }}>📄</span>
              <span style={{ "font-size": "12px", color: "#37352f", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                {section.slug}.md
              </span>
            </div>
          )}
        </For>

        {/* Subcategories (recursive) */}
        <For each={props.node.subcategories}>
          {(sub) => (
            <TreeNode
              node={sub}
              depth={props.depth + 1}
              onRefresh={props.onRefresh}
              api={props.api}
            />
          )}
        </For>
      </Show>
    </div>
  )
}

// ── Main panel ─────────────────────────────────────────────────────────────────

export function KbFilesPanel() {
  const api = useKbApi()
  const sdk = useSDK()
  const [tick, setTick] = createSignal(0)
  const [creatingRoot, setCreatingRoot] = createSignal(false)

  const [tree] = createResource(tick, () => api.tree())

  const refresh = () => setTick((t) => t + 1)

  onMount(() => {
    const stop = sdk.event.listen((evt) => {
      if (evt.details.type === "session.idle") refresh()
    })
    const interval = setInterval(refresh, 10_000)
    onCleanup(() => { stop(); clearInterval(interval) })
  })

  const handleCreateRoot = async (name: string) => {
    setCreatingRoot(false)
    if (!name.trim()) return
    await api.createCategory(name)
    refresh()
  }

  return (
    <div
      style={{
        height: "100%", display: "flex", "flex-direction": "column",
        background: "#faf9f8", "font-family": "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{
        display: "flex", "align-items": "center", "justify-content": "space-between",
        padding: "10px 12px 8px",
        "border-bottom": "1px solid rgba(196,74,14,0.12)",
        "flex-shrink": "0",
      }}>
        <span style={{ "font-size": "11px", "font-weight": "600", color: "#888", "letter-spacing": "0.5px", "text-transform": "uppercase" }}>
          Knowledge Base
        </span>
        <button
          onClick={() => setCreatingRoot(true)}
          title="New category"
          style={{
            background: "#c44a0e", border: "none", "border-radius": "4px",
            color: "#fff", "font-size": "14px", width: "20px", height: "20px",
            cursor: "pointer", display: "flex", "align-items": "center", "justify-content": "center",
            "line-height": "1", padding: "0",
          }}
        >
          +
        </button>
      </div>

      {/* Root creation input */}
      <Show when={creatingRoot()}>
        <div style={{ padding: "6px 8px", "border-bottom": "1px solid rgba(196,74,14,0.12)" }}>
          <InlineInput
            placeholder="category name…"
            onConfirm={handleCreateRoot}
            onCancel={() => setCreatingRoot(false)}
          />
        </div>
      </Show>

      {/* Tree */}
      <div style={{ flex: "1", "overflow-y": "auto", padding: "4px 0", "scrollbar-width": "none" }}>
        <Show when={tree.loading}>
          <div style={{ "font-size": "12px", color: "#aaa", padding: "12px 16px" }}>Loading…</div>
        </Show>
        <Show when={!tree.loading && (tree()?.nodes.length ?? 0) === 0}>
          <div style={{ "font-size": "12px", color: "#aaa", padding: "12px 16px", "text-align": "center", "line-height": "1.6" }}>
            No categories yet.<br />Click <strong>+</strong> to create one.
          </div>
        </Show>
        <For each={tree()?.nodes ?? []}>
          {(node) => (
            <TreeNode
              node={node}
              depth={0}
              onRefresh={refresh}
              api={api}
            />
          )}
        </For>
      </div>

      <style>{`
        .kb-tree-row:hover { background: rgba(196,74,14,0.06); }
        .kb-tree-row:hover .kb-plus-btn { opacity: 1 !important; }
      `}</style>
    </div>
  )
}
