import { Component, For, Match, Show, Switch } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { getDirectory, getFilename } from "@opencode-ai/util/path"

export type AtOption =
  | { type: "agent"; name: string; display: string }
  | { type: "file"; path: string; display: string; recent?: boolean }
  | { type: "resource"; id: string; title: string; display: string }
  | { type: "note"; slug: string; title: string; display: string }
  | { type: "project"; id: string; title: string; display: string }
  | { type: "el-source"; id: string; title: string; projectId: string; display: string }

export interface SlashCommand {
  id: string
  trigger: string
  title: string
  description?: string
  keybind?: string
  type: "builtin" | "custom"
  source?: "command" | "mcp" | "skill"
}

export type AtLevel = "top" | "read" | "notes" | "projects" | "el-sources" // kept for compat

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
            {/* ── Projects ─────────────────────────────────────────────── */}
            <Show when={props.atFlat.some(i => i.type === "project")}>
              <div class="text-11-medium uppercase tracking-wide text-text-subtle px-2 pt-1 pb-0.5">Projects</div>
              <For each={props.atFlat.filter(i => i.type === "project").slice(0, 12)}>
                {(item) => {
                  if (item.type !== "project") return null
                  const key = props.atKey(item)
                  return (
                    <button
                      class="w-full flex items-center gap-x-2 rounded-md px-2 py-1"
                      classList={{ "bg-surface-raised-base-hover": props.atActive === key }}
                      onClick={() => props.onAtSelect(item)}
                      onMouseEnter={() => props.setAtActive(key)}
                    >
                      <Icon name="open-file" size="small" class="text-icon-info shrink-0" />
                      <span class="text-14-regular text-text-strong whitespace-nowrap truncate">{item.title}</span>
                    </button>
                  )
                }}
              </For>
            </Show>

            {/* ── EL Sources ───────────────────────────────────────────── */}
            <Show when={props.atFlat.some(i => i.type === "el-source")}>
              <div class="text-11-medium uppercase tracking-wide text-text-subtle px-2 pt-1.5 pb-0.5">Sources</div>
              <For each={props.atFlat.filter(i => i.type === "el-source").slice(0, 20)}>
                {(item) => {
                  if (item.type !== "el-source") return null
                  const key = props.atKey(item)
                  return (
                    <button
                      class="w-full flex items-center gap-x-2 rounded-md px-2 py-1"
                      classList={{ "bg-surface-raised-base-hover": props.atActive === key }}
                      onClick={() => props.onAtSelect(item)}
                      onMouseEnter={() => props.setAtActive(key)}
                    >
                      <Icon name="open-file" size="small" class="text-icon-warning shrink-0" />
                      <span class="text-14-regular text-text-strong whitespace-nowrap truncate">{item.title}</span>
                    </button>
                  )
                }}
              </For>
            </Show>

            {/* ── Agents / Files ───────────────────────────────────────── */}
            <Show when={props.atFlat.some(i => i.type === "agent" || i.type === "file" || i.type === "resource")}>
              <Show when={props.atFlat.some(i => i.type === "project" || i.type === "el-source")}>
                <div class="h-px bg-border-weaker-base mx-1 my-1" />
              </Show>
              <For each={props.atFlat.filter(i => i.type === "agent" || i.type === "file" || i.type === "resource" || i.type === "note")}>
                {(item) => {
                  const key = props.atKey(item)
                  const label = item.type === "agent" ? item.name
                    : item.type === "file" ? getFilename(item.path)
                    : item.type === "resource" || item.type === "note" ? item.title
                    : ""
                  const sub = item.type === "file" ? getDirectory(item.path) : undefined
                  return (
                    <button
                      class="w-full flex items-center gap-x-2 rounded-md px-2 py-0.5"
                      classList={{ "bg-surface-raised-base-hover": props.atActive === key }}
                      onClick={() => props.onAtSelect(item)}
                      onMouseEnter={() => props.setAtActive(key)}
                    >
                      <Icon name="open-file" size="small" class="text-icon-base shrink-0" />
                      <span class="text-14-regular text-text-strong whitespace-nowrap truncate">{label}</span>
                      <Show when={sub}>
                        <span class="text-12-regular text-text-subtle truncate">{sub}</span>
                      </Show>
                    </button>
                  )
                }}
              </For>
            </Show>

            {/* ── empty state ──────────────────────────────────────────── */}
            <Show when={props.atFlat.length === 0}>
              <div class="text-text-weak px-2 py-2 text-13-regular">No results</div>
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
