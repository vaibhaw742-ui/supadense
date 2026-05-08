/**
 * block-item.tsx — Single editable block.
 * Displays AI blocks with a subtle source indicator.
 * Switches between display mode (inline markdown) and edit mode (raw text).
 */
import { Show, createEffect, createSignal, onMount } from "solid-js"
import type { PageBlock } from "./wiki-api"

interface Props {
  block: PageBlock
  focused: boolean
  onFocus: () => void
  onBlur: () => void
  onNavigate: (slug: string, label: string) => void
  onCreate: () => void       // Enter key → new block after
  onUpdate: (content: string) => void
  onDelete: () => void       // Backspace on empty block
  onIndent: () => void       // Tab
  onUnindent: () => void     // Shift+Tab
}

// Render [[Page Name]] as clickable span, bold, italic inline
function renderInlineMarkdown(content: string): string {
  // Escape HTML
  let html = content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
  // Italic
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>")
  // Inline code
  html = html.replace(/`(.+?)`/g, "<code>$1</code>")
  // [[links]] — use a data attribute; onclick handled via event delegation
  html = html.replace(/\[\[(.+?)\]\]/g, (_, text) => {
    const slug = text.toLowerCase().replace(/\s+/g, "_")
    return `<span class="block-link" data-slug="${slug}" data-label="${text}">${text}</span>`
  })
  return html
}

export function BlockItem(props: Props) {
  let editorRef: HTMLDivElement | undefined
  let saveTimer: ReturnType<typeof setTimeout> | undefined

  const [editing, setEditing] = createSignal(false)
  const [localContent, setLocalContent] = createSignal(props.block.content)

  // When focused prop changes from outside, focus the DOM element
  onMount(() => {
    if (props.focused && editorRef) editorRef.focus()
  })

  // Keep display HTML in sync when not editing
  createEffect(() => {
    if (!editing() && editorRef) {
      editorRef.innerHTML = renderInlineMarkdown(props.block.content)
    }
  })

  // Keep localContent in sync when block content changes from outside
  createEffect(() => {
    setLocalContent(props.block.content)
  })

  function scheduleSave(content: string) {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      props.onUpdate(content)
    }, 500)
  }

  function handleKeyDown(e: KeyboardEvent) {
    const el = editorRef!
    const content = el.innerText ?? ""

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      // Flush pending save first
      clearTimeout(saveTimer)
      if (content !== props.block.content) props.onUpdate(content)
      props.onCreate()
      return
    }

    if (e.key === "Backspace" && content === "") {
      e.preventDefault()
      props.onDelete()
      return
    }

    if (e.key === "Tab") {
      e.preventDefault()
      if (e.shiftKey) props.onUnindent()
      else props.onIndent()
      return
    }
  }

  function handleInput(e: InputEvent) {
    const content = (e.currentTarget as HTMLDivElement).innerText ?? ""
    setLocalContent(content)
    scheduleSave(content)
  }

  function handleFocus() {
    setEditing(true)
    props.onFocus()
    // Set innerText to raw content for editing
    if (editorRef) {
      editorRef.innerText = localContent()
      // Move cursor to end
      const range = document.createRange()
      const sel = window.getSelection()
      range.selectNodeContents(editorRef)
      range.collapse(false)
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
  }

  function handleBlur() {
    setEditing(false)
    props.onBlur()
    clearTimeout(saveTimer)
    const content = editorRef?.innerText ?? ""
    if (content !== props.block.content) props.onUpdate(content)
    // Restore rendered HTML
    if (editorRef) {
      editorRef.innerHTML = renderInlineMarkdown(content)
    }
  }

  // Handle clicks on [[links]] via event delegation
  function handleClick(e: MouseEvent) {
    const target = e.target as HTMLElement
    if (target.classList.contains("block-link")) {
      const slug = target.dataset.slug ?? ""
      const label = target.dataset.label ?? slug
      props.onNavigate(slug, label)
      e.preventDefault()
    }
  }

  const isAi = () => props.block.source === "ai"
  const blockClass = () => {
    const type = props.block.block_type
    if (type === "heading_2") return "block-heading-2"
    if (type === "heading_3") return "block-heading-3"
    if (type === "concept") return "block-concept"
    return "block-content"
  }

  return (
    <div class="block-row" classList={{ "block-row--focused": props.focused }}>
      {/* Source indicator */}
      <div class="block-gutter">
        <Show when={isAi()}>
          <span class="block-source-dot" title="AI generated" />
        </Show>
      </div>

      {/* Editable content */}
      <div
        ref={editorRef}
        class={`block-editor ${blockClass()}`}
        contentEditable={true}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onClick={handleClick}
      />
    </div>
  )
}
