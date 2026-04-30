import { useFile } from "@/context/file"
import { encodeFilePath } from "@/context/file/path"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  Show,
  splitProps,
  Switch,
  untrack,
  type ComponentProps,
  type JSXElement,
  type ParentProps,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import type { FileNode } from "@opencode-ai/sdk/v2"

const MAX_DEPTH = 128

function pathToFileUrl(filepath: string): string {
  return `file://${encodeFilePath(filepath)}`
}

type Kind = "add" | "del" | "mix"

type Filter = {
  files: Set<string>
  dirs: Set<string>
}

export function shouldListRoot(input: { level: number; dir?: { loaded?: boolean; loading?: boolean } }) {
  if (input.level !== 0) return false
  if (input.dir?.loaded) return false
  if (input.dir?.loading) return false
  return true
}

export function shouldListExpanded(input: {
  level: number
  dir?: { expanded?: boolean; loaded?: boolean; loading?: boolean }
}) {
  if (input.level === 0) return false
  if (!input.dir?.expanded) return false
  if (input.dir.loaded) return false
  if (input.dir.loading) return false
  return true
}

export function dirsToExpand(input: {
  level: number
  filter?: { dirs: Set<string> }
  expanded: (dir: string) => boolean
}) {
  if (input.level !== 0) return []
  if (!input.filter) return []
  return [...input.filter.dirs].filter((dir) => !input.expanded(dir))
}

const kindLabel = (kind: Kind) => {
  if (kind === "add") return "A"
  if (kind === "del") return "D"
  return "M"
}

const kindTextColor = (kind: Kind) => {
  if (kind === "add") return "color: var(--icon-diff-add-base)"
  if (kind === "del") return "color: var(--icon-diff-delete-base)"
  return "color: var(--icon-diff-modified-base)"
}

const kindDotColor = (kind: Kind) => {
  if (kind === "add") return "background-color: var(--icon-diff-add-base)"
  if (kind === "del") return "background-color: var(--icon-diff-delete-base)"
  return "background-color: var(--icon-diff-modified-base)"
}

const visibleKind = (node: FileNode, kinds?: ReadonlyMap<string, Kind>, marks?: Set<string>) => {
  const kind = kinds?.get(node.path)
  if (!kind) return
  if (!marks?.has(node.path)) return
  return kind
}

const buildDragImage = (target: HTMLElement) => {
  const icon = target.querySelector('[data-component="file-icon"]') ?? target.querySelector("svg")
  const text = target.querySelector("span")
  if (!icon || !text) return

  const image = document.createElement("div")
  image.className =
    "flex items-center gap-x-2 px-2 py-1 bg-surface-raised-base rounded-md border border-border-base text-12-regular text-text-strong"
  image.style.position = "absolute"
  image.style.top = "-1000px"
  image.innerHTML = (icon as SVGElement).outerHTML + (text as HTMLSpanElement).outerHTML
  return image
}

const withFileDragImage = (event: DragEvent) => {
  const image = buildDragImage(event.currentTarget as HTMLElement)
  if (!image) return
  document.body.appendChild(image)
  event.dataTransfer?.setDragImage(image, 0, 12)
  setTimeout(() => document.body.removeChild(image), 0)
}

const FileTreeNode = (
  p: ParentProps &
    ComponentProps<"div"> &
    ComponentProps<"button"> & {
      node: FileNode
      level: number
      active?: string
      nodeClass?: string
      draggable: boolean
      kinds?: ReadonlyMap<string, Kind>
      marks?: Set<string>
      as?: "div" | "button"
      hoverActions?: JSXElement
    },
) => {
  const [local, rest] = splitProps(p, [
    "node",
    "level",
    "active",
    "nodeClass",
    "draggable",
    "kinds",
    "marks",
    "as",
    "children",
    "class",
    "classList",
    "hoverActions",
  ])
  const kind = () => visibleKind(local.node, local.kinds, local.marks)
  const active = () => !!kind() && !local.node.ignored
  const color = () => {
    const value = kind()
    if (!value) return
    return kindTextColor(value)
  }

  return (
    <Dynamic
      component={local.as ?? "div"}
      classList={{
        "group/row w-full min-w-0 h-6 flex items-center justify-start gap-x-1.5 rounded-md px-1.5 py-0 text-left hover:bg-surface-raised-base-hover active:bg-surface-base-active transition-colors cursor-pointer": true,
        "bg-surface-base-active": local.node.path === local.active,
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
        [local.nodeClass ?? ""]: !!local.nodeClass,
      }}
      style={`padding-left: ${Math.max(0, 8 + local.level * 12 - (local.node.type === "file" ? 24 : 4))}px`}
      draggable={local.draggable}
      onDragStart={(event: DragEvent) => {
        if (!local.draggable) return
        event.dataTransfer?.setData("text/plain", `file:${local.node.path}`)
        event.dataTransfer?.setData("text/uri-list", pathToFileUrl(local.node.path))
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy"
        withFileDragImage(event)
      }}
      {...rest}
    >
      {local.children}
      <span
        classList={{
          "flex-1 min-w-0 text-12-medium whitespace-nowrap truncate": true,
          "text-text-weaker": local.node.ignored,
          "text-text-weak": !local.node.ignored && !active(),
        }}
        style={active() ? color() : undefined}
      >
        {local.node.name}
      </span>
      {(() => {
        const value = kind()
        if (!value) return null
        if (local.node.type === "file") {
          return (
            <span class="shrink-0 w-4 text-center text-12-medium" style={kindTextColor(value)}>
              {kindLabel(value)}
            </span>
          )
        }
        return <div class="shrink-0 size-1.5 mr-1.5 rounded-full" style={kindDotColor(value)} />
      })()}
      <Show when={local.hoverActions}>
        <div class="opacity-0 group-hover/row:opacity-100 flex items-center gap-0.5 shrink-0 transition-opacity">
          {local.hoverActions}
        </div>
      </Show>
    </Dynamic>
  )
}

function InlineRenameInput(props: {
  initialValue: string
  level: number
  nodeType: "file" | "directory"
  onConfirm: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = createSignal(props.initialValue)
  const indent = Math.max(0, 8 + props.level * 12 - (props.nodeType === "file" ? 24 : 4))
  let submitted = false

  const confirm = () => {
    const v = value().trim()
    if (v && v !== props.initialValue) {
      submitted = true
      props.onConfirm(v)
    } else {
      props.onCancel()
    }
  }

  return (
    <div
      class="w-full min-w-0 h-6 flex items-center gap-x-1.5 rounded-md"
      style={{ "padding-left": `${indent}px`, "padding-right": "8px" }}
    >
      <input
        autofocus
        type="text"
        value={value()}
        onInput={(e) => setValue(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); confirm() }
          if (e.key === "Escape") props.onCancel()
        }}
        onBlur={() => { if (!submitted) props.onCancel() }}
        class="flex-1 min-w-0 bg-transparent text-12-medium text-text-base"
        style={{
          outline: "none",
          border: "1px solid var(--color-focus-ring, #0078d4)",
          "border-radius": "2px",
          padding: "0 4px",
          height: "18px",
          "font-size": "12px",
        }}
      />
    </div>
  )
}

export type InlineCreate = {
  parentPath: string
  type: "file" | "folder"
  onConfirm: (name: string) => void
  onCancel: () => void
}

export type FileTreeActions = {
  onRename?: (node: FileNode) => void
  onDelete?: (node: FileNode) => void
}

export type InlineRename = {
  path: string
  onConfirm: (newName: string) => void
  onCancel: () => void
}

function InlineFileRow(props: { type: "file" | "folder"; level: number; onConfirm: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = createSignal("")
  const indent = Math.max(0, 8 + props.level * 12 - (props.type === "file" ? 24 : 4))

  const confirm = () => {
    const v = value().trim()
    if (v) props.onConfirm(v)
    else props.onCancel()
  }

  return (
    <div
      class="w-full min-w-0 h-6 flex items-center gap-x-1.5 rounded-md"
      style={{ "padding-left": `${indent}px`, "padding-right": "8px" }}
    >
      <Show when={props.type === "folder"} fallback={<div class="w-4 shrink-0" />}>
        <div class="size-4 flex items-center justify-center text-icon-weak shrink-0">
          <Icon name="folder" size="small" />
        </div>
      </Show>
      <input
        autofocus
        type="text"
        value={value()}
        onInput={(e) => setValue(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") confirm()
          if (e.key === "Escape") props.onCancel()
        }}
        onBlur={props.onCancel}
        class="flex-1 min-w-0 bg-transparent text-12-medium text-text-base"
        style={{
          outline: "none",
          border: "1px solid var(--color-focus-ring, #0078d4)",
          "border-radius": "2px",
          padding: "0 4px",
          height: "18px",
          "font-size": "12px",
        }}
      />
    </div>
  )
}

export default function FileTree(props: {
  path: string
  class?: string
  nodeClass?: string
  active?: string
  level?: number
  allowed?: readonly string[]
  modified?: readonly string[]
  kinds?: ReadonlyMap<string, Kind>
  draggable?: boolean
  onFileClick?: (file: FileNode) => void
  onFolderClick?: (folder: FileNode) => void
  inlineCreate?: InlineCreate
  actions?: FileTreeActions
  inlineRename?: InlineRename

  _filter?: Filter
  _marks?: Set<string>
  _deeps?: Map<string, number>
  _kinds?: ReadonlyMap<string, Kind>
  _chain?: readonly string[]
}) {
  const file = useFile()
  const level = props.level ?? 0
  const draggable = () => props.draggable ?? true

  const key = (p: string) =>
    file
      .normalize(p)
      .replace(/[\\/]+$/, "")
      .replaceAll("\\", "/")
  const chain = props._chain ? [...props._chain, key(props.path)] : [key(props.path)]

  const filter = createMemo(() => {
    if (props._filter) return props._filter

    const allowed = props.allowed
    if (!allowed) return

    const files = new Set(allowed)
    const dirs = new Set<string>()

    for (const item of allowed) {
      const parts = item.split("/")
      const parents = parts.slice(0, -1)
      for (const [idx] of parents.entries()) {
        const dir = parents.slice(0, idx + 1).join("/")
        if (dir) dirs.add(dir)
      }
    }

    return { files, dirs }
  })

  const marks = createMemo(() => {
    if (props._marks) return props._marks

    const out = new Set<string>()
    for (const item of props.modified ?? []) out.add(item)
    for (const item of props.kinds?.keys() ?? []) out.add(item)
    if (out.size === 0) return
    return out
  })

  const kinds = createMemo(() => {
    if (props._kinds) return props._kinds
    return props.kinds
  })

  const deeps = createMemo(() => {
    if (props._deeps) return props._deeps

    const out = new Map<string, number>()

    const root = props.path
    if (!(file.tree.state(root)?.expanded ?? false)) return out

    const seen = new Set<string>()
    const stack: { dir: string; lvl: number; i: number; kids: string[]; max: number }[] = []

    const push = (dir: string, lvl: number) => {
      const id = key(dir)
      if (seen.has(id)) return
      seen.add(id)

      const kids = file.tree
        .children(dir)
        .filter((node) => node.type === "directory" && (file.tree.state(node.path)?.expanded ?? false))
        .map((node) => node.path)

      stack.push({ dir, lvl, i: 0, kids, max: lvl })
    }

    push(root, level - 1)

    while (stack.length > 0) {
      const top = stack[stack.length - 1]!

      if (top.i < top.kids.length) {
        const next = top.kids[top.i]!
        top.i++
        push(next, top.lvl + 1)
        continue
      }

      out.set(top.dir, top.max)
      stack.pop()

      const parent = stack[stack.length - 1]
      if (!parent) continue
      parent.max = Math.max(parent.max, top.max)
    }

    return out
  })

  createEffect(() => {
    const current = filter()
    const dirs = dirsToExpand({
      level,
      filter: current,
      expanded: (dir) => untrack(() => file.tree.state(dir)?.expanded) ?? false,
    })
    for (const dir of dirs) file.tree.expand(dir)
  })

  createEffect(
    on(
      () => props.path,
      (path) => {
        const dir = untrack(() => file.tree.state(path))
        if (!shouldListRoot({ level, dir })) return
        void file.tree.list(path)
      },
      { defer: false },
    ),
  )

  const nodes = createMemo(() => {
    const nodes = file.tree.children(props.path)
    const current = filter()
    if (!current) return nodes

    const parent = (path: string) => {
      const idx = path.lastIndexOf("/")
      if (idx === -1) return ""
      return path.slice(0, idx)
    }

    const leaf = (path: string) => {
      const idx = path.lastIndexOf("/")
      return idx === -1 ? path : path.slice(idx + 1)
    }

    const out = nodes.filter((node) => {
      if (node.type === "file") return current.files.has(node.path)
      return current.dirs.has(node.path)
    })

    const seen = new Set(out.map((node) => node.path))

    for (const dir of current.dirs) {
      if (parent(dir) !== props.path) continue
      if (seen.has(dir)) continue
      out.push({
        name: leaf(dir),
        path: dir,
        absolute: dir,
        type: "directory",
        ignored: false,
      })
      seen.add(dir)
    }

    for (const item of current.files) {
      if (parent(item) !== props.path) continue
      if (seen.has(item)) continue
      out.push({
        name: leaf(item),
        path: item,
        absolute: item,
        type: "file",
        ignored: false,
      })
      seen.add(item)
    }

    out.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })

    return out
  })

  const showInlineCreate = createMemo(() => {
    const ic = props.inlineCreate
    if (!ic) return false
    const normalizedParent = ic.parentPath.replace(/[\\/]+$/, "").replaceAll("\\", "/")
    const normalizedThis = key(props.path)
    return normalizedParent === normalizedThis
  })

  const hoverActionsFor = (node: FileNode) => {
    if (!props.actions) return undefined
    const PROTECTED = new Set(["wiki", "raw", "assets", "overview.md", "index.md", "log.md", "supadense.md"])
    if (PROTECTED.has(node.name)) return undefined
    return (
      <>
        <button
          title="Rename"
          onClick={(e) => { e.stopPropagation(); props.actions?.onRename?.(node) }}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "1px",
            "border-radius": "3px",
            color: "var(--text-weak-base)",
            display: "flex",
            "align-items": "center",
          }}
          class="hover:!bg-surface-raised-base-hover"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M11.5 2.5l2 2-8 8H3.5v-2l8-8z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button
          title="Delete"
          onClick={(e) => { e.stopPropagation(); props.actions?.onDelete?.(node) }}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "1px",
            "border-radius": "3px",
            color: "var(--text-weak-base)",
            display: "flex",
            "align-items": "center",
          }}
          class="hover:!text-red-500 hover:!bg-surface-raised-base-hover"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M3 4h10M6 4V3h4v1M5 4l.5 9h5L11 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </>
    )
  }

  const isInlineRenaming = (node: FileNode) => {
    const ir = props.inlineRename
    if (!ir) return false
    const normalizedTarget = ir.path.replace(/[\\/]+$/, "").replaceAll("\\", "/")
    const normalizedNode = node.path.replace(/[\\/]+$/, "").replaceAll("\\", "/")
    return normalizedTarget === normalizedNode
  }

  return (
    <div data-component="filetree" class={`flex flex-col gap-0.5 ${props.class ?? ""}`}>
      <For each={nodes()}>
        {(node) => {
          const expanded = () => file.tree.state(node.path)?.expanded ?? false
          const deep = () => deeps().get(node.path) ?? -1
          const kind = () => visibleKind(node, kinds(), marks())
          const active = () => !!kind() && !node.ignored

          return (
            <Switch>
              <Match when={node.type === "directory"}>
                <Show
                  when={!isInlineRenaming(node)}
                  fallback={
                    <InlineRenameInput
                      initialValue={node.name}
                      level={level}
                      nodeType="directory"
                      onConfirm={props.inlineRename!.onConfirm}
                      onCancel={props.inlineRename!.onCancel}
                    />
                  }
                >
                  <Collapsible
                    variant="ghost"
                    class="w-full"
                    data-scope="filetree"
                    forceMount={false}
                    open={expanded()}
                    onOpenChange={(open) => (open ? file.tree.expand(node.path) : file.tree.collapse(node.path))}
                  >
                    <Collapsible.Trigger>
                      <FileTreeNode
                        node={node}
                        level={level}
                        active={props.active}
                        nodeClass={props.nodeClass}
                        draggable={draggable()}
                        kinds={kinds()}
                        marks={marks()}
                        hoverActions={hoverActionsFor(node)}
                        onClick={() => props.onFolderClick?.(node)}
                      >
                        <div class="size-4 flex items-center justify-center text-icon-weak">
                          <Icon name={expanded() ? "chevron-down" : "chevron-right"} size="small" />
                        </div>
                      </FileTreeNode>
                    </Collapsible.Trigger>
                    <Collapsible.Content class="relative pt-0.5">
                      <div
                        classList={{
                          "absolute top-0 bottom-0 w-px pointer-events-none bg-border-weak-base opacity-0 transition-opacity duration-150 ease-out motion-reduce:transition-none": true,
                          "group-hover/filetree:opacity-100": expanded() && deep() === level,
                          "group-hover/filetree:opacity-50": !(expanded() && deep() === level),
                        }}
                        style={`left: ${Math.max(0, 8 + level * 12 - 4) + 8}px`}
                      />
                      <Show
                        when={level < MAX_DEPTH && !chain.includes(key(node.path))}
                        fallback={<div class="px-2 py-1 text-12-regular text-text-weak">...</div>}
                      >
                        <FileTree
                          path={node.path}
                          level={level + 1}
                          allowed={props.allowed}
                          modified={props.modified}
                          kinds={props.kinds}
                          active={props.active}
                          draggable={props.draggable}
                          onFileClick={props.onFileClick}
                          onFolderClick={props.onFolderClick}
                          inlineCreate={props.inlineCreate}
                          actions={props.actions}
                          inlineRename={props.inlineRename}
                          _filter={filter()}
                          _marks={marks()}
                          _deeps={deeps()}
                          _kinds={kinds()}
                          _chain={chain}
                        />
                      </Show>
                    </Collapsible.Content>
                  </Collapsible>
                </Show>
              </Match>
              <Match when={node.type === "file"}>
                <Show
                  when={!isInlineRenaming(node)}
                  fallback={
                    <InlineRenameInput
                      initialValue={node.name.replace(/\.md$/, "")}
                      level={level}
                      nodeType="file"
                      onConfirm={props.inlineRename!.onConfirm}
                      onCancel={props.inlineRename!.onCancel}
                    />
                  }
                >
                  <FileTreeNode
                    node={node}
                    level={level}
                    active={props.active}
                    nodeClass={props.nodeClass}
                    draggable={draggable()}
                    kinds={kinds()}
                    marks={marks()}
                    hoverActions={hoverActionsFor(node)}
                    as="button"
                    type="button"
                    onClick={() => props.onFileClick?.(node)}
                  >
                    <div class="w-4 shrink-0" />
                    <Switch>
                      <Match when={node.ignored}>
                        <FileIcon
                          node={node}
                          class="size-4 filetree-icon filetree-icon--mono"
                          style="color: var(--icon-weak-base)"
                          mono
                        />
                      </Match>
                      <Match when={active()}>
                        <FileIcon
                          node={node}
                          class="size-4 filetree-icon filetree-icon--mono"
                          style={kindTextColor(kind()!)}
                          mono
                        />
                      </Match>
                      <Match when={!node.ignored}>
                        <span class="filetree-iconpair size-4">
                          <FileIcon
                            node={node}
                            class="size-4 filetree-icon filetree-icon--color opacity-0 group-hover/filetree:opacity-100"
                          />
                          <FileIcon
                            node={node}
                            class="size-4 filetree-icon filetree-icon--mono group-hover/filetree:opacity-0"
                            mono
                          />
                        </span>
                      </Match>
                    </Switch>
                  </FileTreeNode>
                </Show>
              </Match>
            </Switch>
          )
        }}
      </For>
      <Show when={showInlineCreate()}>
        <InlineFileRow
          type={props.inlineCreate!.type}
          level={level}
          onConfirm={props.inlineCreate!.onConfirm}
          onCancel={props.inlineCreate!.onCancel}
        />
      </Show>
    </div>
  )
}
