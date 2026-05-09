import { createEffect, createMemo, type Accessor, type JSX } from "solid-js"
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
      <div
        ref={(el) => { panel = el }}
        classList={{
          "flex flex-col h-full w-full min-w-0 overflow-hidden": true,
          "hidden": !expanded(),
        }}
        aria-hidden={!expanded()}
      >
        <div class="flex-1 min-h-0 overflow-hidden">
          {props.renderPanel()}
        </div>
      </div>
    </div>
  )
}
