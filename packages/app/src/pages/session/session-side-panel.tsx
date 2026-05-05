import { For, Match, Show, Switch, Suspense, createEffect, createMemo, createResource, createSignal, lazy, onCleanup, onMount, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { Tabs } from "@opencode-ai/ui/tabs"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Mark } from "@opencode-ai/ui/logo"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import type { SnapshotFileDiff, VcsFileDiff, FileNode } from "@opencode-ai/sdk/v2"
import { ConstrainDragYAxis, getDraggableId } from "@/utils/solid-dnd"
import { useDialog } from "@opencode-ai/ui/context/dialog"

import FileTree from "@/components/file-tree"
import type { KbTreeNode } from "@/pages/session/kb-files-panel"
import { SessionContextUsage } from "@/components/session-context-usage"
import { SessionContextTab, SortableTab, FileVisual } from "@/components/session"
import { useCommand } from "@/context/command"
import { useFile, type SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { createFileTabListSync } from "@/pages/session/file-tab-scroll"
import { FileTabContent } from "@/pages/session/file-tabs"
import { createOpenSessionFileTab, createSessionTabs, getTabReorderIndex, type Sizing } from "@/pages/session/helpers"
import { setSessionHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"
import { useKbApi } from "@/pages/session/kb-files-panel"
import { useSDK } from "@/context/sdk"
import { getAuthToken } from "@/utils/server"
import { useServer } from "@/context/server"
import { decode64 } from "@/utils/base64"
import type { GraphData } from "@/pages/wiki/wiki-api"

const WikiGraph = lazy(() => import("@/pages/wiki/wiki-graph").then((m) => ({ default: m.WikiGraph })))

export function SessionSidePanel(props: {
  canReview: () => boolean
  diffs: () => (SnapshotFileDiff | VcsFileDiff)[]
  diffsReady: () => boolean
  empty: () => string
  hasReview: () => boolean
  reviewCount: () => number
  reviewPanel: () => JSX.Element
  activeDiff?: string
  focusReviewDiff: (path: string) => void
  reviewSnap: boolean
  size: Sizing
}) {
  const layout = useLayout()
  const file = useFile()
  const language = useLanguage()
  const command = useCommand()
  const dialog = useDialog()
  const server = useServer()
  const { sessionKey, tabs, view, params } = useSessionLayout()
  const kbApi = useKbApi()
  const sdk = useSDK()

  onMount(() => {
    const stop = sdk.event.listen((evt) => {
      if (evt.details.type === "session.idle") {
        file.tree.refresh("").catch(() => {})
      }
    })
    const interval = setInterval(() => { file.tree.refresh("").catch(() => {}) }, 10_000)
    onCleanup(() => { stop(); clearInterval(interval) })
  })

  const [kbCreating, setKbCreating] = createSignal<"category" | "section" | "collapsed" | null>(null)
  const [activePath, setActivePath] = createSignal<string | null>(null)
  const [kbPathRef, setKbPathRef] = createSignal("")
  const [kbFlatNodes, setKbFlatNodes] = createSignal<{ id: string; name: string; folder_path: string }[]>([])
  const [renaming, setRenaming] = createSignal<{ path: string; currentName: string; node: FileNode } | null>(null)
  const [kbFlatSections, setKbFlatSections] = createSignal<{ id: string; file_path: string }[]>([])

  function normPath(p: string): string {
    return p.replaceAll("\\", "/").replace(/\/+/g, "/").replace(/\/$/, "")
  }

  function resolveKbEntity(nodePath: string): { type: "category" | "section"; id: string } | undefined {
    const kb = normPath(kbPathRef() ?? "")
    const target = normPath(nodePath)
    // Try folders (categories)
    for (const n of kbFlatNodes()) {
      const abs = kb ? `${kb}/${n.folder_path}` : n.folder_path
      if (normPath(abs) === target) return { type: "category", id: n.id }
    }
    // Try files (sections)
    for (const s of kbFlatSections()) {
      const abs = kb ? `${kb}/${s.file_path}` : s.file_path
      if (normPath(abs) === target) return { type: "section", id: s.id }
    }
    return undefined
  }

  function populateFlatData(nodes: KbTreeNode[], kb_path: string) {
    const flat: { id: string; name: string; folder_path: string }[] = []
    const allSections: { id: string; file_path: string }[] = []
    const walk = (ns: KbTreeNode[]) => {
      for (const n of ns) {
        flat.push({ id: n.id, name: n.name, folder_path: n.folder_path })
        for (const s of n.sections) allSections.push({ id: s.id, file_path: s.file_path })
        walk(n.subcategories)
      }
    }
    walk(nodes)
    setKbPathRef(kb_path)
    setKbFlatNodes(flat)
    setKbFlatSections(allSections)
  }

  const isDesktop = createMediaQuery("(min-width: 768px)")

  const reviewOpen = createMemo(() => isDesktop() && view().reviewPanel.opened())
  const fileOpen = createMemo(() => isDesktop() && layout.fileTree.opened())
  const open = createMemo(() => reviewOpen() || fileOpen())
  const reviewTab = createMemo(() => isDesktop())
  const graphMode = createMemo(() => fileOpen() && fileTreeTab() === "all")
  const panelWidth = createMemo(() => {
    if (!open()) return "0px"
    if (reviewOpen() || graphMode()) return `calc(100% - ${layout.session.width()}px)`
    return `${layout.fileTree.width()}px`
  })
  const treeWidth = createMemo(() => (fileOpen() && !graphMode() ? `${layout.fileTree.width()}px` : "0px"))

  const wikiBase = () => {
    const http = server.current?.http
    if (!http) return import.meta.env.DEV
      ? `http://${import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:${import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`
      : `${location.origin}/api`
    return typeof http === "string" ? http : (http as { url: string }).url
  }
  const [graphData] = createResource(
    () => graphMode() || null,
    async (): Promise<GraphData | null> => {
      try {
        const token = getAuthToken()
        const directory = decode64(params.dir) ?? ""
        const res = await fetch(`${wikiBase()}/wiki/home`, {
          headers: {
            "x-opencode-directory": directory,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        })
        if (!res.ok) return null
        const data = await res.json() as { graph_data?: GraphData }
        return data.graph_data ?? null
      } catch {
        return null
      }
    },
  )

  const diffFiles = createMemo(() => props.diffs().map((d) => d.file))
  const kinds = createMemo(() => {
    const merge = (a: "add" | "del" | "mix" | undefined, b: "add" | "del" | "mix") => {
      if (!a) return b
      if (a === b) return a
      return "mix" as const
    }

    const normalize = (p: string) => p.replaceAll("\\\\", "/").replace(/\/+$/, "")

    const out = new Map<string, "add" | "del" | "mix">()
    for (const diff of props.diffs()) {
      const file = normalize(diff.file)
      const kind = diff.status === "added" ? "add" : diff.status === "deleted" ? "del" : "mix"

      out.set(file, kind)

      const parts = file.split("/")
      for (const [idx] of parts.slice(0, -1).entries()) {
        const dir = parts.slice(0, idx + 1).join("/")
        if (!dir) continue
        out.set(dir, merge(out.get(dir), kind))
      }
    }
    return out
  })

  const empty = (msg: string) => (
    <div class="h-full flex flex-col">
      <div class="h-6 shrink-0" aria-hidden />
      <div class="flex-1 pb-64 flex items-center justify-center text-center">
        <div class="text-12-regular text-text-weak">{msg}</div>
      </div>
    </div>
  )

  const nofiles = createMemo(() => {
    const state = file.tree.state("")
    if (!state?.loaded) return false
    return file.tree.children("").length === 0
  })

  const normalizeTab = (tab: string) => {
    if (!tab.startsWith("file://")) return tab
    return file.tab(tab)
  }

  const openReviewPanel = () => {
    if (!view().reviewPanel.opened()) view().reviewPanel.open()
  }

  const openTab = createOpenSessionFileTab({
    normalizeTab,
    openTab: tabs().open,
    pathFromTab: file.pathFromTab,
    loadFile: file.load,
    openReviewPanel,
    setActive: tabs().setActive,
  })

  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab,
    review: reviewTab,
    hasReview: props.canReview,
  })
  const contextOpen = tabState.contextOpen
  const openedTabs = tabState.openedTabs
  const activeTab = tabState.activeTab
  const activeFileTab = tabState.activeFileTab

  const fileTreeTab = () => layout.fileTree.tab()

  const setFileTreeTabValue = (value: string) => {
    if (value !== "changes" && value !== "all") return
    layout.fileTree.setTab(value)
  }

  const showAllFiles = () => {
    if (fileTreeTab() !== "changes") return
    layout.fileTree.setTab("all")
  }

  const [store, setStore] = createStore({
    activeDraggable: undefined as string | undefined,
  })

  const handleDragStart = (event: unknown) => {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeDraggable", id)
  }

  const handleDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return

    const currentTabs = tabs().all()
    const toIndex = getTabReorderIndex(currentTabs, draggable.id.toString(), droppable.id.toString())
    if (toIndex === undefined) return
    tabs().move(draggable.id.toString(), toIndex)
  }

  const handleDragEnd = () => {
    setStore("activeDraggable", undefined)
  }

  createEffect(() => {
    if (!file.ready()) return

    setSessionHandoff(sessionKey(), {
      files: tabs()
        .all()
        .reduce<Record<string, SelectedLineRange | null>>((acc, tab) => {
          const path = file.pathFromTab(tab)
          if (!path) return acc

          const selected = file.selectedLines(path)
          acc[path] =
            selected && typeof selected === "object" && "start" in selected && "end" in selected
              ? (selected as SelectedLineRange)
              : null

          return acc
        }, {}),
    })
  })

  return (
    <Show when={isDesktop()}>
      <aside
        id="review-panel"
        aria-label={language.t("session.panel.reviewAndFiles")}
        aria-hidden={!open()}
        inert={!open()}
        class="relative min-w-0 h-full flex shrink-0 overflow-hidden bg-background-base"
        classList={{
          "pointer-events-none": !open(),
          "transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
            !props.size.active() && !props.reviewSnap,
        }}
        style={{ width: panelWidth() }}
      >
        {/* Graph mode: full-width wiki graph spanning both panels */}
        <Show when={graphMode()}>
          <div class="size-full flex flex-col border-l border-border-weaker-base bg-background-base">
            {/* Tab strip */}
            <div class="shrink-0">
              <Tabs variant="pill" value={fileTreeTab()} onChange={setFileTreeTabValue} data-scope="filetree">
                <Tabs.List>
                  <Tabs.Trigger value="changes" class="flex-1" classes={{ button: "w-full" }}>
                    {props.reviewCount()}{" "}
                    {language.t(props.reviewCount() === 1 ? "session.review.change.one" : "session.review.change.other")}
                  </Tabs.Trigger>
                  <Tabs.Trigger value="all" class="flex-1" classes={{ button: "w-full" }}>
                    {language.t("session.files.all")}
                  </Tabs.Trigger>
                </Tabs.List>
              </Tabs>
            </div>
            {/* Graph */}
            <div class="flex-1 min-h-0 overflow-hidden">
              <Show when={graphData()} fallback={
                <div class="h-full flex items-center justify-center text-12-regular text-text-weak">
                  {graphData() === null ? "No graph data available" : "Loading…"}
                </div>
              }>
                {(data) => (
                  <Suspense>
                    <WikiGraph
                      data={data()}
                      onNavigate={(slug) => {
                        window.open(`/${params.dir}/wiki/${slug}`, "_blank")
                      }}
                    />
                  </Suspense>
                )}
              </Show>
            </div>
          </div>
        </Show>

        <div class="size-full flex border-l border-border-weaker-base" classList={{ "hidden": graphMode() }}>
          <div
            id="file-tree-panel"
            data-tour="kb-tree-panel"
            aria-hidden={!fileOpen()}
            inert={!fileOpen()}
            class="relative min-w-0 h-full shrink-0 overflow-hidden"
            classList={{
              "pointer-events-none": !fileOpen(),
              "transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
                !props.size.active(),
            }}
            style={{ width: treeWidth() }}
          >
            <div
              class="h-full flex flex-col overflow-hidden group/filetree"
            >
              <Tabs
                variant="pill"
                value={fileTreeTab()}
                onChange={setFileTreeTabValue}
                class="h-full"
                data-scope="filetree"
              >
                <Tabs.List>
                  <Tabs.Trigger value="changes" class="flex-1" classes={{ button: "w-full" }}>
                    {props.reviewCount()}{" "}
                    {language.t(
                      props.reviewCount() === 1 ? "session.review.change.one" : "session.review.change.other",
                    )}
                  </Tabs.Trigger>
                  <Tabs.Trigger value="all" class="flex-1" classes={{ button: "w-full" }}>
                    {language.t("session.files.all")}
                  </Tabs.Trigger>
                </Tabs.List>
                <Tabs.Content value="changes" class="bg-background-stronger px-3 py-0">
                  <Switch>
                    <Match when={props.hasReview() || !props.diffsReady()}>
                      <Show
                        when={props.diffsReady()}
                        fallback={
                          <div class="px-2 py-2 text-12-regular text-text-weak">
                            {language.t("common.loading")}
                            {language.t("common.loading.ellipsis")}
                          </div>
                        }
                      >
                        <FileTree
                          path=""
                          class="pt-3"
                          allowed={diffFiles()}
                          kinds={kinds()}
                          draggable={false}
                          active={props.activeDiff}
                          onFileClick={(node) => props.focusReviewDiff(node.path)}
                        />
                      </Show>
                    </Match>
                    <Match when={true}>{empty(props.empty())}</Match>
                  </Switch>
                </Tabs.Content>
                <Tabs.Content value="all" class="bg-background-stronger py-0" style={{ "padding-left": "0", "padding-right": "0" }} data-tour="kb-files-panel">
                  {/* VS Code-style explorer header */}
                  <div class="kb-explorer-header" style={{
                    display: "flex", "align-items": "center",
                    padding: "0 8px 0 4px", height: "28px",
                    "flex-shrink": "0",
                  }}>
                    {/* Section title + collapse toggle */}
                    <button
                      onClick={() => setKbCreating((v) => v === "collapsed" ? null : "collapsed")}
                      style={{ display: "flex", "align-items": "center", gap: "4px", background: "none", border: "none", cursor: "pointer", flex: "1", "min-width": "0", padding: "0 4px 0 2px" }}
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" style={{ "flex-shrink": "0", color: "var(--text-weak-base)", transform: kbCreating() === "collapsed" ? "rotate(-90deg)" : "none", transition: "transform 0.15s" }}>
                        <path d="M1 3l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                      <span style={{ "font-size": "11px", "font-weight": "600", "letter-spacing": "0.6px", "text-transform": "uppercase", color: "var(--text-base)", "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>
                        Supadense
                      </span>
                    </button>
                    {/* Action buttons — shown on hover of the header */}
                    <div class="kb-header-actions" style={{ display: "flex", "align-items": "center", gap: "1px", "flex-shrink": "0" }}>
                      {/* New section */}
                      <button
                        title={activePath() ? `New section in ${activePath()!.split("/").pop()}` : "New section (select a folder first)"}
                        onClick={async () => {
                          const { nodes, kb_path } = await kbApi.tree()
                          populateFlatData(nodes, kb_path)
                          const p = activePath()
                          if (p) file.tree.expand(p)
                          setKbCreating("section")
                        }}
                        class="kb-header-btn"
                        style={{ background: "none", border: "none", cursor: "pointer", padding: "3px", "border-radius": "4px", color: "var(--text-weak-base)", display: "flex", "align-items": "center" }}
                      >
                        <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
                          <rect x="2" y="1" width="9" height="12" rx="1" stroke="currentColor" stroke-width="1.2"/>
                          <line x1="11" y1="10" x2="11" y2="15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                          <line x1="8.5" y1="12.5" x2="13.5" y2="12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                        </svg>
                      </button>

                      {/* New folder/category */}
                      <button
                        title={activePath() ? `New folder in ${activePath()!.split("/").pop()}` : "New folder"}
                        onClick={async () => {
                          const { nodes, kb_path } = await kbApi.tree()
                          populateFlatData(nodes, kb_path)
                          const p = activePath()
                          if (p) file.tree.expand(p)
                          setKbCreating("category")
                        }}
                        class="kb-header-btn"
                        style={{ background: "none", border: "none", cursor: "pointer", padding: "3px", "border-radius": "4px", color: "var(--text-weak-base)", display: "flex", "align-items": "center" }}
                      >
                        <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
                          <path d="M1 4.5C1 3.67 1.67 3 2.5 3H6l1.5 1.5H13.5C14.33 4.5 15 5.17 15 6v6.5C15 13.33 14.33 14 13.5 14h-11C1.67 14 1 13.33 1 12.5V4.5z" stroke="currentColor" stroke-width="1.2"/>
                          <line x1="9" y1="8.5" x2="9" y2="13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                          <line x1="6.5" y1="10.75" x2="11.5" y2="10.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                        </svg>
                      </button>

                      {/* Refresh */}
                      <button
                        title="Refresh"
                        onClick={async () => { const p = activePath(); if (p) await file.tree.refresh(p); await file.tree.refresh("") }}
                        class="kb-header-btn"
                        style={{ background: "none", border: "none", cursor: "pointer", padding: "3px", "border-radius": "4px", color: "var(--text-weak-base)", display: "flex", "align-items": "center" }}
                      >
                        <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
                          <path d="M13.5 8a5.5 5.5 0 1 1-1.1-3.3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                          <polyline points="10,2 12.5,4.7 10,7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                      </button>

                      {/* Collapse all */}
                      <button
                        title="Collapse all"
                        onClick={() => {
                          for (const node of file.tree.children("")) {
                            if (node.type === "directory") file.tree.collapse(node.path)
                          }
                        }}
                        class="kb-header-btn"
                        style={{ background: "none", border: "none", cursor: "pointer", padding: "3px", "border-radius": "4px", color: "var(--text-weak-base)", display: "flex", "align-items": "center" }}
                      >
                        <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
                          <rect x="1.5" y="1.5" width="13" height="13" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
                          <line x1="4" y1="8" x2="12" y2="8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* File tree */}
                  <Show when={kbCreating() !== "collapsed"}>
                    <div class="px-3">
                      <Switch>
                        <Match when={nofiles()}>{empty(language.t("session.files.empty"))}</Match>
                        <Match when={true}>
                          <FileTree
                            path=""
                            class="pt-3"
                            modified={diffFiles()}
                            kinds={kinds()}
                            active={activePath() ?? undefined}
                            onFileClick={(node) => { setActivePath(node.path); openTab(file.tab(node.path)) }}
                            onFolderClick={(node) => setActivePath(node.path)}
                            inlineCreate={kbCreating() === "category" || kbCreating() === "section" ? {
                              parentPath: activePath() ?? "",
                              type: kbCreating() === "category" ? "folder" : "file",
                              onCancel: () => setKbCreating(null),
                              onConfirm: async (name) => {
                                const mode = kbCreating()
                                setKbCreating(null)
                                const sel = activePath()
                                const matchedId = sel
                                  ? kbFlatNodes().find((n) => {
                                      const abs = kbPathRef() ? `${kbPathRef()}/${n.folder_path}` : n.folder_path
                                      return abs === sel || n.folder_path === sel || sel.endsWith(`/${n.folder_path}`) || sel.endsWith(n.folder_path)
                                    })?.id
                                  : undefined
                                if (mode === "category") {
                                  await kbApi.createCategory(name, matchedId)
                                } else {
                                  if (matchedId) await kbApi.createSection(name, matchedId)
                                }
                                const parent = activePath()
                                if (parent) await file.tree.refresh(parent)
                                await file.tree.refresh("")
                              },
                            } : undefined}
                            actions={{
                              onRename: async (node) => {
                                if (node.name === "wiki" || node.name === "raw" || node.name === "overview.md" || node.name === "index.md" || node.name === "log.md" || node.name === "supadense.md" || node.name === "assets") return
                                const { nodes, kb_path } = await kbApi.tree()
                                populateFlatData(nodes, kb_path)
                                setRenaming({ path: node.path, currentName: node.name, node })
                              },
                              onDelete: async (node) => {
                                if (node.name === "wiki" || node.name === "raw" || node.name === "overview.md" || node.name === "index.md" || node.name === "log.md" || node.name === "supadense.md" || node.name === "assets") return
                                const { nodes, kb_path } = await kbApi.tree()
                                populateFlatData(nodes, kb_path)
                                const entity = resolveKbEntity(node.path)
                                if (!entity) return
                                if (entity.type === "category") await kbApi.deleteCategory(entity.id)
                                else await kbApi.deleteSection(entity.id)
                                const p = activePath()
                                if (p) await file.tree.refresh(p)
                                await file.tree.refresh("")
                              },
                            }}
                            inlineRename={renaming() ? {
                              path: renaming()!.path,
                              onCancel: () => setRenaming(null),
                              onConfirm: async (newName) => {
                                const r = renaming()
                                setRenaming(null)
                                if (!r) return
                                const entity = resolveKbEntity(r.path)
                                if (!entity) {
                                  console.error("[kb rename] could not resolve entity for path:", r.path, "flat nodes:", kbFlatNodes(), "flat sections:", kbFlatSections(), "kb_path:", kbPathRef())
                                  return
                                }
                                try {
                                  if (entity.type === "category") await kbApi.renameCategory(entity.id, newName)
                                  else await kbApi.renameSection(entity.id, newName)
                                } catch (e) {
                                  console.error("[kb rename] API call failed:", e)
                                  return
                                }
                                const { nodes, kb_path } = await kbApi.tree()
                                populateFlatData(nodes, kb_path)
                                try { if (activePath()) await file.tree.refresh(activePath()!) } catch { /* old path gone */ }
                                await file.tree.refresh("")
                              },
                            } : undefined}
                          />
                        </Match>
                      </Switch>
                    </div>
                  </Show>

                  <style>{`
                    .kb-explorer-header .kb-header-actions { opacity: 0; transition: opacity 0.1s; }
                    .kb-explorer-header:hover .kb-header-actions { opacity: 1; }
                    .kb-header-btn:hover { background: var(--surface-raised-base-hover) !important; color: var(--text-base) !important; }
                  `}</style>
                </Tabs.Content>
              </Tabs>
            </div>
            <Show when={fileOpen()}>
              <div onPointerDown={() => props.size.start()}>
                <ResizeHandle
                  direction="horizontal"
                  edge="start"
                  size={layout.fileTree.width()}
                  min={200}
                  max={480}
                  onResize={(width) => {
                    props.size.touch()
                    layout.fileTree.resize(width)
                  }}
                />
              </div>
            </Show>
          </div>

          <div
            aria-hidden={!reviewOpen()}
            inert={!reviewOpen()}
            class="relative min-w-0 h-full flex-1 overflow-hidden bg-background-base"
            classList={{
              "pointer-events-none": !reviewOpen(),
              "border-l border-border-weaker-base": fileOpen(),
            }}
          >
            <div class="size-full min-w-0 h-full bg-background-base">
              <DragDropProvider
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOver}
                collisionDetector={closestCenter}
              >
                <DragDropSensors />
                <ConstrainDragYAxis />
                <Tabs value={activeTab()} onChange={openTab}>
                  <div class="sticky top-0 shrink-0 flex">
                    <Tabs.List
                      ref={(el: HTMLDivElement) => {
                        const stop = createFileTabListSync({ el, contextOpen })
                        onCleanup(stop)
                      }}
                    >
                      <Show when={reviewTab() && props.canReview()}>
                        <Tabs.Trigger value="review">
                          <div class="flex items-center gap-1.5">
                            <div>{language.t("session.tab.review")}</div>
                            <Show when={props.hasReview()}>
                              <div>{props.reviewCount()}</div>
                            </Show>
                          </div>
                        </Tabs.Trigger>
                      </Show>
                      <Show when={contextOpen()}>
                        <Tabs.Trigger
                          value="context"
                          closeButton={
                            <TooltipKeybind
                              title={language.t("common.closeTab")}
                              keybind={command.keybind("tab.close")}
                              placement="bottom"
                              gutter={10}
                            >
                              <IconButton
                                icon="close-small"
                                variant="ghost"
                                class="h-5 w-5"
                                onClick={() => tabs().close("context")}
                                aria-label={language.t("common.closeTab")}
                              />
                            </TooltipKeybind>
                          }
                          hideCloseButton
                          onMiddleClick={() => tabs().close("context")}
                        >
                          <div class="flex items-center gap-2">
                            <SessionContextUsage variant="indicator" />
                            <div>{language.t("session.tab.context")}</div>
                          </div>
                        </Tabs.Trigger>
                      </Show>
                      <SortableProvider ids={openedTabs()}>
                        <For each={openedTabs()}>{(tab) => <SortableTab tab={tab} onTabClose={tabs().close} />}</For>
                      </SortableProvider>
                      <div class="bg-background-stronger h-full shrink-0 sticky right-0 z-10 flex items-center justify-center pr-3">
                        <TooltipKeybind
                          title={language.t("command.file.open")}
                          keybind={command.keybind("file.open")}
                          class="flex items-center"
                        >
                          <IconButton
                            icon="plus-small"
                            variant="ghost"
                            iconSize="large"
                            class="!rounded-md"
                            onClick={() => {
                              void import("@/components/dialog-select-file").then((x) => {
                                dialog.show(() => <x.DialogSelectFile mode="files" onOpenFile={showAllFiles} />)
                              })
                            }}
                            aria-label={language.t("command.file.open")}
                          />
                        </TooltipKeybind>
                      </div>
                    </Tabs.List>
                  </div>

                  <Show when={reviewTab() && props.canReview()}>
                    <Tabs.Content value="review" class="flex flex-col h-full overflow-hidden contain-strict">
                      <Show when={activeTab() === "review"}>{props.reviewPanel()}</Show>
                    </Tabs.Content>
                  </Show>

                  <Tabs.Content value="empty" class="flex flex-col h-full overflow-hidden contain-strict">
                    <Show when={activeTab() === "empty"}>
                      <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                        <div class="h-full px-6 pb-42 -mt-4 flex flex-col items-center justify-center text-center gap-6">
                          <Mark class="w-14 opacity-10" />
                          <div class="text-14-regular text-text-weak max-w-56">
                            {language.t("session.files.selectToOpen")}
                          </div>
                        </div>
                      </div>
                    </Show>
                  </Tabs.Content>

                  <Show when={contextOpen()}>
                    <Tabs.Content value="context" class="flex flex-col h-full overflow-hidden contain-strict">
                      <Show when={activeTab() === "context"}>
                        <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                          <SessionContextTab />
                        </div>
                      </Show>
                    </Tabs.Content>
                  </Show>

                  <Show when={activeFileTab()} keyed>
                    {(tab) => <FileTabContent tab={tab} />}
                  </Show>
                </Tabs>
                <DragOverlay>
                  <Show when={store.activeDraggable} keyed>
                    {(tab) => {
                      const path = file.pathFromTab(tab)
                      return (
                        <div data-component="tabs-drag-preview">
                          <Show when={path}>{(p) => <FileVisual active path={p()} />}</Show>
                        </div>
                      )
                    }}
                  </Show>
                </DragOverlay>
              </DragDropProvider>
            </div>
          </div>
        </div>
      </aside>
    </Show>
  )
}
