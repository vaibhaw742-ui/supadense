import { Component, For, Match, Show, Switch } from "solid-js"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { getDirectory, getFilename } from "@opencode-ai/util/path"

export type AtOption =
  | { type: "agent"; name: string; display: string }
  | { type: "file"; path: string; display: string; recent?: boolean }
  | { type: "resource"; id: string; title: string; display: string }
  | { type: "note"; slug: string; title: string; display: string }

export interface SlashCommand {
  id: string
  trigger: string
  title: string
  description?: string
  keybind?: string
  type: "builtin" | "custom"
  source?: "command" | "mcp" | "skill"
}

export type AtLevel = "top" | "read" | "notes"

type PromptPopoverProps = {
  popover: "at" | "slash" | null
  setSlashPopoverRef: (el: HTMLDivElement) => void
  atFlat: AtOption[]
  atActive?: string
  atKey: (item: AtOption) => string
  setAtActive: (id: string) => void
  onAtSelect: (item: AtOption) => void
  atLevel: AtLevel
  onAtLevelChange: (level: AtLevel) => void
  atNotes: { slug: string; title: string }[]
  atQuery: string
  slashFlat: SlashCommand[]
  slashActive?: string
  setSlashActive: (id: string) => void
  onSlashSelect: (item: SlashCommand) => void
  commandKeybind: (id: string) => string | undefined
  t: (key: string) => string
}

const TOP_CATEGORIES: { id: "read" | "notes"; label: string; description: string }[] = [
  { id: "read",  label: "Read",  description: "Sources & resources" },
  { id: "notes", label: "Notes", description: "Wiki pages" },
]

export const PromptPopover: Component<PromptPopoverProps> = (props) => {
  return (
    <Show when={props.popover}>
      <div
        ref={(el) => {
          if (props.popover === "slash") props.setSlashPopoverRef(el)
        }}
        class="absolute inset-x-0 -top-2 -translate-y-full origin-bottom-left max-h-80 min-h-10
                 overflow-auto no-scrollbar flex flex-col p-2 rounded-[12px]
                 bg-surface-raised-stronger-non-alpha shadow-[var(--shadow-lg-border-base)]"
        onMouseDown={(e) => e.preventDefault()}
      >
        <Switch>
          <Match when={props.popover === "at"}>
            {/* ── back header when inside a submenu ───────────────────────── */}
            <Show when={props.atLevel !== "top"}>
              <button
                class="w-full flex items-center gap-x-1.5 rounded-md px-2 py-1 mb-0.5 text-text-weak hover:text-text-base hover:bg-surface-raised-base-hover"
                onClick={() => props.onAtLevelChange("top")}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="shrink-0">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                <span class="text-11-medium uppercase tracking-wide">
                  {props.atLevel === "read" ? "Read" : "Notes"}
                </span>
              </button>
              <div class="h-px bg-border-weaker-base mx-1 mb-1" />
            </Show>

            {/* ── top level: Read / Notes ─────────────────────────────────── */}
            <Show when={props.atLevel === "top"}>
              <For each={TOP_CATEGORIES}>
                {(cat) => (
                  <button
                    class="w-full flex items-center justify-between gap-x-2 rounded-md px-2 py-1.5 hover:bg-surface-raised-base-hover"
                    onClick={() => props.onAtLevelChange(cat.id)}
                  >
                    <div class="flex items-center gap-x-2 min-w-0">
                      <span class="text-14-regular text-text-strong">{cat.label}</span>
                      <span class="text-12-regular text-text-weak truncate">{cat.description}</span>
                    </div>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-icon-base shrink-0 opacity-50">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                )}
              </For>
            </Show>

            {/* ── Read submenu: resources ──────────────────────────────────── */}
            <Show when={props.atLevel === "read"}>
              <Show
                when={props.atFlat.filter(i => i.type === "resource").length > 0}
                fallback={<div class="text-text-weak px-2 py-1 text-13-regular">{props.t("prompt.popover.emptyResults")}</div>}
              >
                <For each={props.atFlat.filter(i => i.type === "resource").slice(0, 12)}>
                  {(item) => {
                    if (item.type !== "resource") return null
                    const key = props.atKey(item)
                    return (
                      <button
                        class="w-full flex items-center gap-x-2 rounded-md px-2 py-0.5"
                        classList={{ "bg-surface-raised-base-hover": props.atActive === key }}
                        onClick={() => props.onAtSelect(item)}
                        onMouseEnter={() => props.setAtActive(key)}
                      >
                        <Icon name="open-file" size="small" class="text-icon-warning shrink-0" />
                        <span class="text-14-regular text-text-strong whitespace-nowrap truncate">@{item.title}</span>
                      </button>
                    )
                  }}
                </For>
              </Show>
            </Show>

            {/* ── Notes submenu ────────────────────────────────────────────── */}
            <Show when={props.atLevel === "notes"}>
              <Show
                when={props.atNotes.length > 0}
                fallback={<div class="text-text-weak px-2 py-1 text-13-regular">No notes yet</div>}
              >
                <For each={props.atNotes.filter(n =>
                  !props.atQuery || n.title.toLowerCase().includes(props.atQuery.toLowerCase())
                ).slice(0, 12)}>
                  {(note) => {
                    const opt: AtOption = { type: "note", slug: note.slug, title: note.title, display: note.title }
                    const key = `note:${note.slug}`
                    return (
                      <button
                        class="w-full flex items-center gap-x-2 rounded-md px-2 py-0.5"
                        classList={{ "bg-surface-raised-base-hover": props.atActive === key }}
                        onClick={() => props.onAtSelect(opt)}
                        onMouseEnter={() => props.setAtActive(key)}
                      >
                        <Icon name="open-file" size="small" class="text-icon-base shrink-0" />
                        <span class="text-14-regular text-text-strong whitespace-nowrap truncate">@{note.title}</span>
                      </button>
                    )
                  }}
                </For>
              </Show>
            </Show>
          </Match>

          <Match when={props.popover === "slash"}>
            <Show
              when={props.slashFlat.length > 0}
              fallback={<div class="text-text-weak px-2 py-1">{props.t("prompt.popover.emptyCommands")}</div>}
            >
              <For each={props.slashFlat}>
                {(cmd) => (
                  <button
                    data-slash-id={cmd.id}
                    classList={{
                      "w-full flex items-center justify-between gap-4 rounded-md px-2 py-1": true,
                      "bg-surface-raised-base-hover": props.slashActive === cmd.id,
                    }}
                    onClick={() => props.onSlashSelect(cmd)}
                    onMouseEnter={() => props.setSlashActive(cmd.id)}
                  >
                    <div class="flex items-center gap-2 min-w-0">
                      <span class="text-14-regular text-text-strong whitespace-nowrap">/{cmd.trigger}</span>
                      <Show when={cmd.description}>
                        <span class="text-14-regular text-text-weak truncate">{cmd.description}</span>
                      </Show>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                      <Show when={cmd.type === "custom" && cmd.source !== "command"}>
                        <span class="text-11-regular text-text-subtle px-1.5 py-0.5 bg-surface-base rounded">
                          {cmd.source === "skill"
                            ? props.t("prompt.slash.badge.skill")
                            : cmd.source === "mcp"
                              ? props.t("prompt.slash.badge.mcp")
                              : props.t("prompt.slash.badge.custom")}
                        </span>
                      </Show>
                      <Show when={props.commandKeybind(cmd.id)}>
                        <span class="text-12-regular text-text-subtle">{props.commandKeybind(cmd.id)}</span>
                      </Show>
                    </div>
                  </button>
                )}
              </For>
            </Show>
          </Match>
        </Switch>
      </div>
    </Show>
  )
}
