/**
 * block-page-view.tsx — Notion-style block-based page viewer/editor.
 * Cover header (emoji + title) + formatting toolbar + editable blocks.
 */
import { For, Show, createEffect, createResource, createSignal } from "solid-js"
import { useWikiApi, type PageBlock } from "./wiki-api"
import { BlockList } from "./block-list"
import { BacklinksPanel } from "./backlinks-panel"

interface Props {
  slug: string
  label: string
  onNavigate: (slug: string, label: string) => void
}

// ── Toolbar button ─────────────────────────────────────────────────────────────

function ToolbarBtn(p: { label: string; title: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      title={p.title}
      onClick={p.onClick}
      style={{
        background: p.active ? "var(--surface-raised-base, rgba(0,0,0,0.06))" : "none",
        border: "none",
        cursor: "pointer",
        padding: "3px 6px",
        "border-radius": "4px",
        "font-size": "12px",
        "font-weight": p.active ? "600" : "500",
        color: p.active ? "var(--text-strong)" : "var(--text-weak)",
        "line-height": "1",
        "min-width": "24px",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        transition: "background 0.1s, color 0.1s",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--surface-raised-base, rgba(0,0,0,0.06))"; (e.currentTarget as HTMLElement).style.color = "var(--text-base)" }}
      onMouseLeave={(e) => { if (!p.active) { (e.currentTarget as HTMLElement).style.background = "none"; (e.currentTarget as HTMLElement).style.color = "var(--text-weak)" } }}
    >
      {p.label}
    </button>
  )
}

function ToolbarDivider() {
  return <div style={{ width: "1px", height: "16px", background: "var(--border-base, #e5e5e5)", margin: "0 4px", "flex-shrink": "0" }} />
}

// ── Component ──────────────────────────────────────────────────────────────────

export function BlockPageView(props: Props) {
  const wikiApi = useWikiApi()

  const [pageData, { refetch }] = createResource(
    () => props.slug,
    (slug) => wikiApi.page(slug),
  )

  const [blocks, setBlocks] = createSignal<PageBlock[]>([])
  const [focusedId, setFocusedId] = createSignal<string | null>(null)

  createEffect(() => {
    const data = pageData()
    if (data?.blocks) setBlocks(data.blocks)
  })

  // ── Flat ordered list helpers ──────────────────────────────────────────────

  function flattenBlocks(tree: PageBlock[]): PageBlock[] {
    const result: PageBlock[] = []
    function walk(nodes: PageBlock[]) {
      for (const n of nodes) {
        result.push(n)
        if (n.children.length > 0) walk(n.children)
      }
    }
    walk(tree)
    return result
  }

  function insertBlockInTree(tree: PageBlock[], parentId: string | null, orderIndex: number, newBlock: PageBlock): PageBlock[] {
    if (!parentId) {
      const result = [...tree]
      result.splice(orderIndex, 0, newBlock)
      return result.map((b, i) => ({ ...b, order_index: i }))
    }
    return tree.map((b) => {
      if (b.id === parentId) {
        const newChildren = [...b.children]
        newChildren.splice(orderIndex, 0, newBlock)
        return { ...b, children: newChildren.map((c, i) => ({ ...c, order_index: i })) }
      }
      if (b.children.length > 0) {
        return { ...b, children: insertBlockInTree(b.children, parentId, orderIndex, newBlock) }
      }
      return b
    })
  }

  function updateBlockInTree(tree: PageBlock[], id: string, content: string, source: "user" | "user_edited", block_type?: string): PageBlock[] {
    return tree.map((b) => {
      if (b.id === id) return { ...b, content, source, ...(block_type ? { block_type } : {}) }
      if (b.children.length > 0) return { ...b, children: updateBlockInTree(b.children, id, content, source, block_type) }
      return b
    })
  }

  function deleteBlockInTree(tree: PageBlock[], id: string): PageBlock[] {
    return tree
      .filter((b) => b.id !== id)
      .map((b, i) => ({
        ...b,
        order_index: i,
        children: b.id !== id ? deleteBlockInTree(b.children, id) : b.children,
      }))
  }

  // ── Toolbar: apply format to focused block ─────────────────────────────────

  function applyFormat(blockType: string) {
    const id = focusedId()
    if (!id) return
    const flat = flattenBlocks(blocks())
    const block = flat.find((b) => b.id === id)
    if (!block) return
    const newSource = block.source === "ai" ? "user_edited" : (block.source as "user" | "user_edited")
    setBlocks((prev) => updateBlockInTree(prev, id, block.content, newSource, blockType))
    wikiApi.updateBlock(id, block.content, blockType).catch((e) => console.error("updateBlock failed", e))
  }

  const focusedBlockType = () => {
    const id = focusedId()
    if (!id) return "paragraph"
    return flattenBlocks(blocks()).find((b) => b.id === id)?.block_type ?? "paragraph"
  }

  // ── Block CRUD ─────────────────────────────────────────────────────────────

  async function handleCreate(afterBlockId: string | null, parentId: string | null, depth: number) {
    const siblings = parentId
      ? flattenBlocks(blocks()).find((b) => b.id === parentId)?.children ?? []
      : blocks()
    const afterSiblingIdx = afterBlockId
      ? siblings.findIndex((b) => b.id === afterBlockId)
      : siblings.length - 1
    const newOrderIndex = afterSiblingIdx + 1
    try {
      const { block } = await wikiApi.createBlock(props.slug, {
        content: "",
        parent_id: parentId,
        order_index: newOrderIndex,
        block_type: "paragraph",
        depth,
      })
      const newBlock: PageBlock = { ...block, children: [] }
      setBlocks((prev) => insertBlockInTree(prev, parentId, newOrderIndex, newBlock))
      setFocusedId(block.id)
    } catch (e) {
      console.error("createBlock failed", e)
    }
  }

  async function handleUpdate(id: string, content: string, currentSource: string, block_type?: string) {
    const newSource = currentSource === "ai" ? "user_edited" : (currentSource as "user" | "user_edited")
    setBlocks((prev) => updateBlockInTree(prev, id, content, newSource, block_type))
    try {
      await wikiApi.updateBlock(id, content, block_type)
    } catch (e) {
      console.error("updateBlock failed", e)
    }
  }

  async function handleDelete(id: string, focusPrevId: string | null) {
    setBlocks((prev) => deleteBlockInTree(prev, id))
    if (focusPrevId) setFocusedId(focusPrevId)
    try {
      await wikiApi.deleteBlock(id)
    } catch (e) {
      console.error("deleteBlock failed", e)
      refetch()
    }
  }

  async function handleIndent(id: string) {
    const flat = flattenBlocks(blocks())
    const idx = flat.findIndex((b) => b.id === id)
    if (idx <= 0) return
    const prevSibling = flat[idx - 1]
    if (!prevSibling) return
    const newOrderIndex = prevSibling.children.length
    try {
      await wikiApi.moveBlock(id, { new_parent_id: prevSibling.id, new_order_index: newOrderIndex })
      refetch()
    } catch (e) {
      console.error("moveBlock (indent) failed", e)
    }
  }

  async function handleUnindent(id: string) {
    const flat = flattenBlocks(blocks())
    const block = flat.find((b) => b.id === id)
    if (!block || block.placement_id == null) return
    const parent = flat.find((b) => b.id === block.placement_id)
    if (!parent) return
    const grandparentId = (parent as PageBlock & { placement_id?: string }).placement_id ?? null
    const grandparentChildren = grandparentId
      ? (flat.find((b) => b.id === grandparentId)?.children ?? [])
      : blocks()
    const parentIdx = grandparentChildren.findIndex((b) => b.id === parent.id)
    const newOrderIndex = parentIdx + 1
    try {
      await wikiApi.moveBlock(id, { new_parent_id: grandparentId, new_order_index: newOrderIndex })
      refetch()
    } catch (e) {
      console.error("moveBlock (unindent) failed", e)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const pageIcon = () => pageData()?.category?.icon ?? "📄"

  return (
    <div class="h-full flex flex-col overflow-hidden">

      {/* ── Cover: emoji + title ──────────────────────────────────────────── */}
      <div
        class="shrink-0"
        style={{
          background: "var(--surface-base, #f5f5f4)",
          padding: "28px 28px 24px",
          "border-bottom": "1px solid var(--border-weaker-base, #e7e5e4)",
        }}
      >
        <div style={{ "font-size": "38px", "line-height": "1", "margin-bottom": "10px", "user-select": "none" }}>
          {pageIcon()}
        </div>
        <h1 style={{
          margin: "0",
          "font-size": "22px",
          "font-weight": "700",
          "letter-spacing": "-0.02em",
          color: "var(--text-strong)",
          "line-height": "1.2",
        }}>
          {props.label}
        </h1>
        {/* Source count */}
        <Show when={pageData()}>
          {(d) => (
            <div style={{ "margin-top": "6px", "font-size": "11px", color: "var(--text-weakest, #a8a29e)" }}>
              {d().page.resource_count} source{d().page.resource_count !== 1 ? "s" : ""}
            </div>
          )}
        </Show>
      </div>

      {/* ── Sub-page tabs ─────────────────────────────────────────────────── */}
      <Show when={pageData() && (pageData()!.category_tabs?.length ?? 0) > 1}>
        <div
          class="shrink-0 flex gap-1 px-4 py-2 flex-wrap"
          style={{ "border-bottom": "1px solid var(--border-weaker-base, #e7e5e4)" }}
        >
          <For each={pageData()!.category_tabs}>
            {(tab) => (
              <button
                class="px-2.5 py-0.5 rounded text-11-regular border border-border-weaker-base hover:bg-surface-base-hover"
                classList={{ "bg-surface-base font-medium border-border-base": tab.nav_slug === props.slug }}
                onClick={() => props.onNavigate(tab.nav_slug, tab.title)}
              >
                {tab.title}
              </button>
            )}
          </For>
        </div>
      </Show>

      {/* ── Formatting toolbar ────────────────────────────────────────────── */}
      <div
        class="shrink-0 flex items-center gap-0.5 px-3 py-1.5"
        style={{ "border-bottom": "1px solid var(--border-weaker-base, #e7e5e4)", "flex-wrap": "wrap" }}
      >
        <ToolbarBtn label="H1" title="Heading 1" active={focusedBlockType() === "heading_2"} onClick={() => applyFormat(focusedBlockType() === "heading_2" ? "paragraph" : "heading_2")} />
        <ToolbarBtn label="H2" title="Heading 2" active={focusedBlockType() === "heading_3"} onClick={() => applyFormat(focusedBlockType() === "heading_3" ? "paragraph" : "heading_3")} />
        <ToolbarDivider />
        <ToolbarBtn label="•" title="Bullet list" active={focusedBlockType() === "bullet"} onClick={() => applyFormat(focusedBlockType() === "bullet" ? "paragraph" : "bullet")} />
        <ToolbarBtn label="☐" title="To-do" active={focusedBlockType() === "todo"} onClick={() => applyFormat(focusedBlockType() === "todo" ? "paragraph" : "todo")} />
        <ToolbarBtn label="❝" title="Quote" active={focusedBlockType() === "quote"} onClick={() => applyFormat(focusedBlockType() === "quote" ? "paragraph" : "quote")} />
        <ToolbarDivider />
        <ToolbarBtn label="</>" title="Code" active={focusedBlockType() === "code"} onClick={() => applyFormat(focusedBlockType() === "code" ? "paragraph" : "code")} />
        <ToolbarBtn label="—" title="Divider" onClick={() => applyFormat("divider")} />
        <ToolbarDivider />
        <ToolbarBtn label="Tx" title="Plain text" active={focusedBlockType() === "paragraph"} onClick={() => applyFormat("paragraph")} />
      </div>

      {/* ── Block editor ──────────────────────────────────────────────────── */}
      <div class="flex-1 min-h-0 overflow-y-auto px-6 py-3">
        <Show when={pageData.loading}>
          <div class="text-12-regular text-text-weak py-4">Loading…</div>
        </Show>
        <Show when={!pageData.loading}>
          <Show
            when={blocks().length > 0}
            fallback={
              <div
                style={{ "font-size": "14px", color: "var(--text-weakest, #a8a29e)", "padding": "4px 22px", "cursor": "text" }}
                onClick={() => handleCreate(null, null, 0)}
              >
                Start typing…
              </div>
            }
          >
            <BlockList
              blocks={blocks()}
              focusedId={focusedId()}
              onFocus={setFocusedId}
              onNavigate={props.onNavigate}
              onCreate={handleCreate}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              onIndent={handleIndent}
              onUnindent={handleUnindent}
            />
          </Show>
          {/* Add block at end when there are already blocks */}
          <Show when={blocks().length > 0}>
            <div
              class="mt-1 py-1 px-2 text-12-regular text-text-weakest hover:text-text-weak cursor-text select-none"
              onClick={() => {
                const last = blocks()
                handleCreate(last.length > 0 ? last[last.length - 1].id : null, null, 0)
              }}
            >
              + Add a note…
            </div>
          </Show>
        </Show>
      </div>

      {/* ── Backlinks ─────────────────────────────────────────────────────── */}
      <Show when={!pageData.loading}>
        <BacklinksPanel slug={props.slug} onNavigate={props.onNavigate} />
      </Show>
    </div>
  )
}
