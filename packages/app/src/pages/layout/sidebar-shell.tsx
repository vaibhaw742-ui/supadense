import { createEffect, createMemo, Show, type Accessor, type JSX } from "solid-js"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { type LocalProject } from "@/context/layout"
import type { DragEvent } from "@thisbeyond/solid-dnd"

export const SidebarContent = (props: {
  mobile?: boolean
  opened: Accessor<boolean>
  aimMove: (event: MouseEvent) => void
  projects: Accessor<LocalProject[]>
  renderProject: (project: LocalProject) => JSX.Element
  handleDragStart: (event: unknown) => void
  handleDragEnd: () => void
  handleDragOver: (event: DragEvent) => void
  openProjectLabel: JSX.Element
  openProjectKeybind: Accessor<string | undefined>
  onOpenProject: () => void
  renderProjectOverlay: () => JSX.Element
  renderPanel: () => JSX.Element
  onToggleSessions: () => void
  onNewSession?: () => void
}): JSX.Element => {
  const expanded = createMemo(() => !!props.mobile || props.opened())
  let panel: HTMLDivElement | undefined

  createEffect(() => {
    const el = panel
    if (!el) return
    if (expanded()) {
      el.removeAttribute("inert")
      return
    }
    el.setAttribute("inert", "")
  })

  return (
    <div class="flex h-full w-full min-w-0 overflow-hidden" onMouseMove={props.aimMove}>
      {/* Collapsed state: thin strip with toggle */}
      <Show when={!expanded()}>
        <div class="w-full h-full bg-background-base flex flex-col items-center overflow-hidden">
          <div class="flex-1 min-h-0 flex flex-col items-center pt-3 gap-2">
            <Tooltip placement="right" value="Show Sessions">
              <IconButton
                icon="sidebar"
                variant="ghost"
                size="large"
                onClick={props.onToggleSessions}
                aria-label="Show Sessions"
              />
            </Tooltip>
          </div>
        </div>
      </Show>

      {/* Expanded state: full sessions panel */}
      <div
        ref={(el) => { panel = el }}
        classList={{
          "flex flex-col h-full w-full min-w-0 overflow-hidden": true,
          "hidden": !expanded(),
        }}
        aria-hidden={!expanded()}
      >
        <Show when={!props.mobile}>
          <div class="shrink-0 flex items-center px-3 pt-2 pb-0">
            <Tooltip placement="right" value="Hide Sessions">
              <IconButton
                icon="sidebar-active"
                variant="ghost"
                size="large"
                onClick={props.onToggleSessions}
                aria-label="Hide Sessions"
              />
            </Tooltip>
          </div>
        </Show>
        <div class="flex-1 min-h-0 overflow-hidden">
          {props.renderPanel()}
        </div>
      </div>
    </div>
  )
}
