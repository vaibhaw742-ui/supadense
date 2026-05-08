/**
 * block-page-view.tsx — Unified block-based page viewer/editor.
 * Replaces the read-only markdown renderer in session-side-panel.tsx.
 * Shows AI-generated and user-created blocks together in one editable outliner.
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

export function BlockPageView(props: Props) {
  const wikiApi = useWikiApi()

  const [pageData, { refetch }] = createResource(
    () => props.slug,
    (slug) => wikiApi.page(slug),
  )

  // Local block tree — owned here, mutated optimistically
  const [blocks, setBlocks] = createSignal<PageBlock[]>([])
  const [focusedId, setFocusedId] = createSignal<string | null>(null)

  // Sync blocks from API whenever page loads
  createEffect(() => {
    const data = pageData()
    if (data?.blocks) setBlocks(data.blocks)
  })

  // ── Flat ordered list helpers ─────────────────────────────────────────────

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

  function updateBlockInTree(tree: PageBlock[], id: string, content: string, source: "user" | "user_edited"): PageBlock[] {
    return tree.map((b) => {
      if (b.id === id) return { ...b, content, source }
      if (b.children.length > 0) return { ...b, children: updateBlockInTree(b.children, id, content, source) }
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

  // ── Callbacks passed to BlockList ─────────────────────────────────────────

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

  async function handleUpdate(id: string, content: string, currentSource: string) {
    const newSource = currentSource === "ai" ? "user_edited" : (currentSource as "user" | "user_edited")
    // Optimistic update
    setBlocks((prev) => updateBlockInTree(prev, id, content, newSource))
    try {
      await wikiApi.updateBlock(id, content)
    } catch (e) {
      console.error("updateBlock failed", e)
    }
  }

  async function handleDelete(id: string, focusPrevId: string | null) {
    // Optimistic
    setBlocks((prev) => deleteBlockInTree(prev, id))
    if (focusPrevId) setFocusedId(focusPrevId)
    try {
      await wikiApi.deleteBlock(id)
    } catch (e) {
      console.error("deleteBlock failed", e)
      refetch() // revert on error
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
      refetch() // tree restructure — reload from server
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
    // Place after parent in grandparent's children
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

  return (
    <div class="h-full flex flex-col overflow-hidden">
      {/* Breadcrumb + title */}
      <Show when={pageData()}>
        {(d) => (
          <div class="shrink-0 px-4 pt-3 pb-1">
            <Show when={(d().category_tabs?.length ?? 0) > 1}>
              <div class="flex gap-1.5 mb-2 flex-wrap">
                <For each={d().category_tabs}>
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
            <div class="text-12-regular text-text-weak">
              {d().page.resource_count} source{d().page.resource_count !== 1 ? "s" : ""}
            </div>
          </div>
        )}
      </Show>

      {/* Block editor */}
      <div class="flex-1 min-h-0 overflow-y-auto px-4 py-2">
        <Show when={pageData.loading}>
          <div class="text-12-regular text-text-weak py-4">Loading…</div>
        </Show>
        <Show when={!pageData.loading}>
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
          {/* Add block at end */}
          <div
            class="mt-1 py-1 px-2 text-12-regular text-text-weakest hover:text-text-weak cursor-text select-none"
            onClick={() => {
              const lastTopLevel = blocks()
              handleCreate(
                lastTopLevel.length > 0 ? lastTopLevel[lastTopLevel.length - 1].id : null,
                null,
                0,
              )
            }}
          >
            + Add a note…
          </div>
        </Show>
      </div>

      {/* Backlinks */}
      <Show when={!pageData.loading}>
        <BacklinksPanel slug={props.slug} onNavigate={props.onNavigate} />
      </Show>
    </div>
  )
}
