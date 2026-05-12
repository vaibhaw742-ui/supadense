import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import type { PageBlock } from "./wiki-api"

interface Props {
  block: PageBlock
  focused: boolean
  onFocus: () => void
  onBlur: () => void
  onNavigate: (slug: string, label: string) => void
  onCreate: () => void
  onUpdate: (content: string, block_type?: string) => void
  onDelete: () => void
  onIndent: () => void
  onUnindent: () => void
}

// ── Slash commands ────────────────────────────────────────────────────────────

interface SlashCommand {
  id: string
  label: string
  description: string
  icon: string
  blockType: string
}

const SLASH_COMMANDS: SlashCommand[] = [
  { id: "text",     label: "Text",       description: "Plain paragraph",         icon: "¶",  blockType: "paragraph" },
  { id: "h1",       label: "Heading 1",  description: "Large section heading",   icon: "H1", blockType: "heading_2" },
  { id: "h2",       label: "Heading 2",  description: "Medium section heading",  icon: "H2", blockType: "heading_3" },
  { id: "quote",    label: "Quote",      description: "Highlighted quote block", icon: "❝",  blockType: "quote"     },
  { id: "code",     label: "Code",       description: "Code snippet block",      icon: "</>", blockType: "code"     },
  { id: "bullet",   label: "Bullet",     description: "Unordered list item",     icon: "•",  blockType: "bullet"    },
  { id: "todo",     label: "To-do",      description: "Checkbox task item",      icon: "☐",  blockType: "todo"      },
  { id: "divider",  label: "Divider",    description: "Horizontal separator",    icon: "—",  blockType: "divider"   },
]

// ── Inline markdown renderer ──────────────────────────────────────────────────

function renderInlineMarkdown(content: string): string {
  let html = content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>")
  html = html.replace(/`(.+?)`/g, "<code>$1</code>")
  html = html.replace(/\[\[(.+?)\]\]/g, (_, text) => {
    const slug = text.toLowerCase().replace(/\s+/g, "_")
    return `<span class="block-link" data-slug="${slug}" data-label="${text}">${text}</span>`
  })
  return html
}

export function BlockItem(props: Props) {
  let editorRef: HTMLDivElement | undefined
  let menuRef: HTMLDivElement | undefined
  let saveTimer: ReturnType<typeof setTimeout> | undefined

  const [editing, setEditing] = createSignal(false)
  const [localContent, setLocalContent] = createSignal(props.block.content)

  // ── Slash menu state ─────────────────────────────────────────────────────
  const [slashQuery, setSlashQuery] = createSignal<string | null>(null) // null = closed
  const [menuIndex, setMenuIndex] = createSignal(0)

  const filteredCommands = createMemo(() => {
    const q = slashQuery()
    if (q === null) return []
    if (q === "") return SLASH_COMMANDS
    const lower = q.toLowerCase()
    return SLASH_COMMANDS.filter(
      (c) => c.label.toLowerCase().includes(lower) || c.id.includes(lower)
    )
  })

  // Reset menu index when filter changes
  createEffect(() => {
    filteredCommands() // track
    setMenuIndex(0)
  })

  // Close menu on outside click
  function handleOutsideClick(e: MouseEvent) {
    if (menuRef && !menuRef.contains(e.target as Node)) {
      setSlashQuery(null)
    }
  }

  createEffect(() => {
    if (slashQuery() !== null) {
      document.addEventListener("mousedown", handleOutsideClick)
      onCleanup(() => document.removeEventListener("mousedown", handleOutsideClick))
    }
  })

  // ── Sync display when not editing ────────────────────────────────────────
  onMount(() => {
    if (props.focused && editorRef) editorRef.focus()
  })

  createEffect(() => {
    if (!editing() && editorRef) {
      editorRef.innerHTML = renderInlineMarkdown(props.block.content)
    }
  })

  createEffect(() => {
    setLocalContent(props.block.content)
  })

  // ── Save helpers ─────────────────────────────────────────────────────────
  function scheduleSave(content: string) {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => props.onUpdate(content), 500)
  }

  // ── Apply a slash command ────────────────────────────────────────────────
  function applyCommand(cmd: SlashCommand) {
    setSlashQuery(null)
    if (!editorRef) return

    // Remove the slash + query text from content
    const raw = editorRef.innerText ?? ""
    const slashIdx = raw.lastIndexOf("/")
    const newContent = slashIdx >= 0 ? raw.slice(0, slashIdx) : raw

    // Special case: divider sets content to "---"
    const finalContent = cmd.blockType === "divider" ? "---" : newContent

    clearTimeout(saveTimer)
    editorRef.innerText = finalContent
    setLocalContent(finalContent)
    props.onUpdate(finalContent, cmd.blockType)
  }

  // ── Keyboard handler ─────────────────────────────────────────────────────
  function handleKeyDown(e: KeyboardEvent) {
    const el = editorRef!
    const content = el.innerText ?? ""

    // Slash menu navigation
    if (slashQuery() !== null) {
      const cmds = filteredCommands()
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setMenuIndex((i) => Math.min(i + 1, cmds.length - 1))
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setMenuIndex((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === "Enter" && cmds.length > 0) {
        e.preventDefault()
        applyCommand(cmds[menuIndex()])
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        setSlashQuery(null)
        return
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
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

  // ── Input handler — detect slash trigger ────────────────────────────────
  function handleInput(e: InputEvent) {
    const content = (e.currentTarget as HTMLDivElement).innerText ?? ""
    setLocalContent(content)
    scheduleSave(content)

    // Detect /query at end of content (allows slash anywhere in line)
    const match = content.match(/\/(\w*)$/)
    if (match) {
      setSlashQuery(match[1])
    } else {
      setSlashQuery(null)
    }
  }

  function handleFocus() {
    setEditing(true)
    props.onFocus()
    if (editorRef) {
      editorRef.innerText = localContent()
      const range = document.createRange()
      const sel = window.getSelection()
      range.selectNodeContents(editorRef)
      range.collapse(false)
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
  }

  function handleBlur() {
    // Delay so menu clicks register first
    setTimeout(() => {
      if (slashQuery() !== null) return
      setEditing(false)
      props.onBlur()
      clearTimeout(saveTimer)
      const content = editorRef?.innerText ?? ""
      if (content !== props.block.content) props.onUpdate(content)
      if (editorRef) editorRef.innerHTML = renderInlineMarkdown(content)
    }, 120)
  }

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
    if (type === "heading_4") return "block-heading-4"
    if (type === "concept")   return "block-concept"
    if (type === "quote")     return "block-quote"
    if (type === "code")      return "block-code"
    if (type === "bullet")    return "block-bullet"
    if (type === "numbered")  return "block-numbered"
    if (type === "todo")      return "block-todo"
    if (type === "divider")   return "block-divider"
    return "block-content"
  }

  return (
    <div class="block-row" classList={{ "block-row--focused": props.focused }} style={{ position: "relative" }}>
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

      {/* Slash command dropdown */}
      <Show when={slashQuery() !== null && filteredCommands().length > 0}>
        <div ref={menuRef} class="slash-menu">
          <For each={filteredCommands()}>
            {(cmd, i) => (
              <button
                type="button"
                class="slash-menu-item"
                classList={{ "slash-menu-item--active": menuIndex() === i() }}
                onMouseDown={(e) => { e.preventDefault(); applyCommand(cmd) }}
                onMouseEnter={() => setMenuIndex(i())}
              >
                <span class="slash-menu-icon">{cmd.icon}</span>
                <span class="slash-menu-label">{cmd.label}</span>
                <span class="slash-menu-desc">{cmd.description}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
