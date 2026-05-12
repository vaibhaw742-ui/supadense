/**
 * block-page-view.tsx — Notion-style block-based page viewer/editor.
 * Cover header (emoji + title) + formatting toolbar + editable blocks.
 */
import { For, Show, createEffect, createResource, createSignal, type JSX } from "solid-js"
import { useWikiApi, type PageBlock } from "./wiki-api"
import { BlockList } from "./block-list"
import { BacklinksPanel } from "./backlinks-panel"

interface Props {
  slug: string
  label: string
  onNavigate: (slug: string, label: string) => void
}

// ── Toolbar primitives ─────────────────────────────────────────────────────────

function ToolbarBtn(p: { children: JSX.Element; title: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      title={p.title}
      disabled={p.disabled}
      onClick={p.onClick}
      style={{
        background: p.active ? "var(--surface-raised-base, rgba(0,0,0,0.06))" : "none",
        border: "none",
        cursor: p.disabled ? "default" : "pointer",
        padding: "4px 5px",
        "border-radius": "4px",
        color: p.disabled ? "var(--text-weakest, #d4d4d0)" : p.active ? "var(--text-strong)" : "var(--text-weak)",
        "line-height": "1",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        transition: "background 0.1s, color 0.1s",
        opacity: p.disabled ? "0.4" : "1",
      }}
      onMouseEnter={(e) => { if (!p.disabled) { (e.currentTarget as HTMLElement).style.background = "var(--surface-raised-base, rgba(0,0,0,0.06))"; (e.currentTarget as HTMLElement).style.color = "var(--text-base)" } }}
      onMouseLeave={(e) => { if (!p.disabled && !p.active) { (e.currentTarget as HTMLElement).style.background = "none"; (e.currentTarget as HTMLElement).style.color = "var(--text-weak)" } }}
    >
      {p.children}
    </button>
  )
}

function ToolbarDivider() {
  return <div style={{ width: "1px", height: "16px", background: "var(--border-base, #e5e5e5)", "flex-shrink": "0" }} />
}

// ── Toolbar icons (18×18 SVGs) ────────────────────────────────────────────────

const IC = {
  h1: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><text x="1" y="13" font-size="10" font-weight="600" font-family="system-ui,sans-serif" fill="currentColor">H</text><text x="10" y="14" font-size="7" font-weight="600" font-family="system-ui,sans-serif" fill="currentColor">1</text></svg>,
  h2: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><text x="1" y="13" font-size="10" font-weight="600" font-family="system-ui,sans-serif" fill="currentColor">H</text><text x="10" y="14" font-size="7" font-weight="600" font-family="system-ui,sans-serif" fill="currentColor">2</text></svg>,
  h3: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><text x="1" y="13" font-size="10" font-weight="600" font-family="system-ui,sans-serif" fill="currentColor">H</text><text x="10" y="14" font-size="7" font-weight="600" font-family="system-ui,sans-serif" fill="currentColor">3</text></svg>,
  bullet: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="3.5" cy="5" r="1" fill="currentColor" stroke="none"/><circle cx="3.5" cy="9" r="1" fill="currentColor" stroke="none"/><circle cx="3.5" cy="13" r="1" fill="currentColor" stroke="none"/><line x1="6.5" y1="5" x2="15" y2="5"/><line x1="6.5" y1="9" x2="15" y2="9"/><line x1="6.5" y1="13" x2="15" y2="13"/></svg>,
  numbered: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><text x="1.5" y="6.5" font-size="5.5" font-family="system-ui,sans-serif" fill="currentColor" stroke="none">1</text><text x="1.5" y="10.5" font-size="5.5" font-family="system-ui,sans-serif" fill="currentColor" stroke="none">2</text><text x="1.5" y="14.5" font-size="5.5" font-family="system-ui,sans-serif" fill="currentColor" stroke="none">3</text><line x1="6.5" y1="5" x2="15" y2="5"/><line x1="6.5" y1="9" x2="15" y2="9"/><line x1="6.5" y1="13" x2="15" y2="13"/></svg>,
  todo: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3.5" width="5" height="5" rx="1"/><rect x="2" y="10" width="5" height="5" rx="1"/><line x1="9" y1="6" x2="16" y2="6"/><line x1="9" y1="12.5" x2="16" y2="12.5"/><polyline points="3,6.2 4,7.2 6,5"/></svg>,
  quote: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><line x1="3" y1="5" x2="3" y2="13"/><line x1="6" y1="5" x2="15" y2="5"/><line x1="6" y1="9" x2="15" y2="9"/><line x1="6" y1="13" x2="12" y2="13"/></svg>,
  code: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="5,6 2,9 5,12"/><polyline points="13,6 16,9 13,12"/><line x1="10" y1="4" x2="8" y2="14"/></svg>,
  image: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="14" height="12" rx="1.5"/><circle cx="6.5" cy="7" r="1.5"/><polyline points="2,13 6,9 9,12 12,8.5 16,13"/></svg>,
  file: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5.5C3 4.67 3.67 4 4.5 4H7.5L9 5.5H13.5C14.33 5.5 15 6.17 15 7v7.5C15 15.33 14.33 16 13.5 16h-9C3.67 16 3 15.33 3 14.5V5.5z"/></svg>,
  video: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="11" height="10" rx="1.5"/><polyline points="13,7 16,5 16,13 13,11"/></svg>,
  figma: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="12" cy="9" r="2.5"/><rect x="4" y="2" width="5" height="5" rx="1"/><rect x="4" y="7" width="5" height="5" rx="1"/><rect x="4" y="12" width="5" height="5" rx="1"/></svg>,
  globe: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="9" cy="9" r="6.5"/><ellipse cx="9" cy="9" rx="2.8" ry="6.5"/><line x1="2.5" y1="7" x2="15.5" y2="7"/><line x1="2.5" y1="11" x2="15.5" y2="11"/></svg>,
  table: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><rect x="2.5" y="2.5" width="13" height="13" rx="1.5"/><line x1="2.5" y1="7" x2="15.5" y2="7"/><line x1="2.5" y1="11" x2="15.5" y2="11"/><line x1="7" y1="2.5" x2="7" y2="15.5"/><line x1="11" y1="2.5" x2="11" y2="15.5"/></svg>,
  divider: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="2" y1="9" x2="16" y2="9"/></svg>,
  wavy: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 7 C4 5, 6 9, 8 7 S12 5, 14 7 S16 9, 16 7"/><path d="M2 11 C4 9, 6 13, 8 11 S12 9, 14 11 S16 13, 16 11"/></svg>,
  columns: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><rect x="2" y="3" width="6" height="12" rx="1.2"/><rect x="10" y="3" width="6" height="12" rx="1.2"/></svg>,
  sparkle: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2 L10.2 7.8 L16 9 L10.2 10.2 L9 16 L7.8 10.2 L2 9 L7.8 7.8 Z"/><line x1="14" y1="3" x2="14.5" y2="4.5"/><line x1="14.5" y1="4.5" x2="16" y2="5"/><line x1="16" y1="5" x2="14.5" y2="5.5"/><line x1="14.5" y1="5.5" x2="14" y2="7"/></svg>,
  clear: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><text x="2" y="13" font-size="10" font-weight="500" font-family="system-ui,sans-serif" fill="currentColor">T</text><text x="9" y="14" font-size="7" font-family="system-ui,sans-serif" fill="currentColor">x</text><line x1="1" y1="15" x2="17" y2="15" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>,
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
    // Root scrolls — the whole page (cover + toolbar + content) scrolls together
    <div style={{ height: "100%", "overflow-y": "auto" }}>

      {/* ── Cover: emoji + title ─────────────────────────────────────────── */}
      <div style={{
        background: "var(--surface-base, #f5f5f4)",
        padding: "28px 28px 24px",
        "border-bottom": "1px solid var(--border-weaker-base, #e7e5e4)",
        margin: "10px 14px 0",
        "border-radius": "8px 8px 0 0",
      }}>
        <div style={{ "font-size": "38px", "line-height": "1", "margin-bottom": "10px", "user-select": "none" }}>
          {pageIcon()}
        </div>
        <h1 style={{ margin: "0", "font-size": "22px", "font-weight": "700", "letter-spacing": "-0.02em", color: "var(--text-strong)", "line-height": "1.2" }}>
          {props.label}
        </h1>
        <Show when={pageData()}>
          {(d) => (
            <div style={{ "margin-top": "6px", "font-size": "11px", color: "var(--text-weakest, #a8a29e)" }}>
              {d().page.resource_count} source{d().page.resource_count !== 1 ? "s" : ""}
            </div>
          )}
        </Show>
      </div>

      {/* ── Sticky header: format toolbar + underline tabs — sticks after cover scrolls away */}
      <div style={{
        position: "sticky",
        top: "0",
        "z-index": "10",
        background: "var(--background-base)",
        margin: "0 14px",
      }}>
        {/* Formatting toolbar */}
        <div class="flex items-center px-2 py-1" style={{ "flex-wrap": "nowrap", "justify-content": "space-between", "border-bottom": "1px solid var(--border-weaker-base, #e7e5e4)", "overflow-x": "auto" }}>
          {/* Headings */}
          <ToolbarBtn title="Heading 1" active={focusedBlockType() === "heading_2"} onClick={() => applyFormat(focusedBlockType() === "heading_2" ? "paragraph" : "heading_2")}>{IC.h1}</ToolbarBtn>
          <ToolbarBtn title="Heading 2" active={focusedBlockType() === "heading_3"} onClick={() => applyFormat(focusedBlockType() === "heading_3" ? "paragraph" : "heading_3")}>{IC.h2}</ToolbarBtn>
          <ToolbarBtn title="Heading 3" active={focusedBlockType() === "heading_4"} onClick={() => applyFormat(focusedBlockType() === "heading_4" ? "paragraph" : "heading_4")}>{IC.h3}</ToolbarBtn>
          <ToolbarDivider />
          {/* Lists */}
          <ToolbarBtn title="Bullet list" active={focusedBlockType() === "bullet"} onClick={() => applyFormat(focusedBlockType() === "bullet" ? "paragraph" : "bullet")}>{IC.bullet}</ToolbarBtn>
          <ToolbarBtn title="Numbered list" active={focusedBlockType() === "numbered"} onClick={() => applyFormat(focusedBlockType() === "numbered" ? "paragraph" : "numbered")}>{IC.numbered}</ToolbarBtn>
          <ToolbarBtn title="To-do" active={focusedBlockType() === "todo"} onClick={() => applyFormat(focusedBlockType() === "todo" ? "paragraph" : "todo")}>{IC.todo}</ToolbarBtn>
          <ToolbarBtn title="Quote" active={focusedBlockType() === "quote"} onClick={() => applyFormat(focusedBlockType() === "quote" ? "paragraph" : "quote")}>{IC.quote}</ToolbarBtn>
          <ToolbarDivider />
          {/* Content blocks */}
          <ToolbarBtn title="Code" active={focusedBlockType() === "code"} onClick={() => applyFormat(focusedBlockType() === "code" ? "paragraph" : "code")}>{IC.code}</ToolbarBtn>
          <ToolbarBtn title="Image" disabled onClick={() => {}}>{IC.image}</ToolbarBtn>
          <ToolbarBtn title="File" disabled onClick={() => {}}>{IC.file}</ToolbarBtn>
          <ToolbarBtn title="Video" disabled onClick={() => {}}>{IC.video}</ToolbarBtn>
          <ToolbarBtn title="Figma" disabled onClick={() => {}}>{IC.figma}</ToolbarBtn>
          <ToolbarBtn title="Link / Web bookmark" disabled onClick={() => {}}>{IC.globe}</ToolbarBtn>
          <ToolbarBtn title="Table" disabled onClick={() => {}}>{IC.table}</ToolbarBtn>
          <ToolbarBtn title="Divider" onClick={() => applyFormat("divider")}>{IC.divider}</ToolbarBtn>
          <ToolbarDivider />
          {/* Layout / AI */}
          <ToolbarBtn title="AI summary" disabled onClick={() => {}}>{IC.wavy}</ToolbarBtn>
          <ToolbarBtn title="Columns" disabled onClick={() => {}}>{IC.columns}</ToolbarBtn>
          <ToolbarBtn title="AI assist" disabled onClick={() => {}}>{IC.sparkle}</ToolbarBtn>
          <ToolbarBtn title="Clear formatting" active={focusedBlockType() === "paragraph"} onClick={() => applyFormat("paragraph")}>{IC.clear}</ToolbarBtn>
        </div>

        {/* Underline-style sub-page tabs */}
        <Show when={pageData() && (pageData()!.category_tabs?.length ?? 0) > 1}>
          <div style={{ display: "flex", "border-bottom": "1px solid var(--border-weaker-base, #e7e5e4)" }}>
            <For each={pageData()!.category_tabs}>
              {(tab) => {
                const isActive = () => tab.nav_slug === props.slug
                return (
                  <button
                    onClick={() => props.onNavigate(tab.nav_slug, tab.title)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: "8px 16px",
                      "font-size": "13px",
                      "font-weight": isActive() ? "600" : "400",
                      color: isActive() ? "var(--text-strong)" : "var(--text-weak)",
                      "border-bottom": isActive() ? "2px solid var(--text-strong)" : "2px solid transparent",
                      "margin-bottom": "-1px",
                      transition: "color 0.15s",
                      "white-space": "nowrap",
                    }}
                  >
                    {tab.title}
                  </button>
                )
              }}
            </For>
          </div>
        </Show>
      </div>

      {/* ── Block editor ─────────────────────────────────────────────────── */}
      <div style={{ padding: "12px 28px", margin: "0 14px" }}>
        <Show when={pageData.loading}>
          <div class="text-12-regular text-text-weak py-4">Loading…</div>
        </Show>
        <Show when={!pageData.loading}>
          <Show
            when={blocks().length > 0}
            fallback={
              <div
                style={{ "font-size": "14px", color: "var(--text-weakest, #a8a29e)", padding: "4px 4px", cursor: "text" }}
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

      {/* ── Backlinks ────────────────────────────────────────────────────── */}
      <Show when={!pageData.loading}>
        <div style={{ margin: "0 14px" }}>
          <BacklinksPanel slug={props.slug} onNavigate={props.onNavigate} />
        </div>
      </Show>

      <div style={{ height: "64px" }} />
    </div>
  )
}
