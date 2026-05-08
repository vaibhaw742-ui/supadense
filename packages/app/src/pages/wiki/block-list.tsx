/**
 * block-list.tsx — Recursive block list renderer.
 */
import { For } from "solid-js"
import type { PageBlock } from "./wiki-api"
import { BlockItem } from "./block-item"

interface Props {
  blocks: PageBlock[]
  focusedId: string | null
  depth?: number
  onFocus: (id: string | null) => void
  onNavigate: (slug: string, label: string) => void
  onCreate: (afterBlockId: string | null, parentId: string | null, depth: number) => void
  onUpdate: (id: string, content: string, currentSource: string, block_type?: string) => void
  onDelete: (id: string, focusPrevId: string | null) => void
  onIndent: (id: string) => void
  onUnindent: (id: string) => void
}

export function BlockList(props: Props) {
  const depth = () => props.depth ?? 0

  return (
    <div
      class="block-list"
      style={{ "padding-left": depth() > 0 ? "20px" : "0" }}
    >
      <For each={props.blocks}>
        {(block, index) => {
          const prevBlock = () => props.blocks[index() - 1] ?? null

          return (
            <div>
              <BlockItem
                block={block}
                focused={props.focusedId === block.id}
                onFocus={() => props.onFocus(block.id)}
                onBlur={() => {}}
                onNavigate={props.onNavigate}
                onCreate={() => props.onCreate(block.id, block.placement_id ?? null, block.depth)}
                onUpdate={(content, block_type) => props.onUpdate(block.id, content, block.source, block_type)}
                onDelete={() => props.onDelete(block.id, prevBlock()?.id ?? null)}
                onIndent={() => props.onIndent(block.id)}
                onUnindent={() => props.onUnindent(block.id)}
              />
              {/* Render children recursively */}
              <BlockList
                blocks={block.children}
                focusedId={props.focusedId}
                depth={depth() + 1}
                onFocus={props.onFocus}
                onNavigate={props.onNavigate}
                onCreate={props.onCreate}
                onUpdate={props.onUpdate}
                onDelete={props.onDelete}
                onIndent={props.onIndent}
                onUnindent={props.onUnindent}
              />
            </div>
          )
        }}
      </For>
    </div>
  )
}
