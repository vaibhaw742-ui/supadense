import { createEffect, createMemo, Show, type Accessor, type JSX } from "solid-js"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { type LocalProject } from "@/context/layout"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
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
  settingsLabel: Accessor<string>
  settingsKeybind: Accessor<string | undefined>
  onOpenSettings: () => void
  helpLabel: Accessor<string>
  onOpenHelp: () => void
  renderPanel: () => JSX.Element
  userEmail?: string
  onLogout?: () => void
  notificationBell?: JSX.Element
  onToggleSessions: () => void
  onNewSession?: () => void
}): JSX.Element => {
  const expanded = createMemo(() => !!props.mobile || props.opened())
  const placement = () => (props.mobile ? "bottom" : "right")
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
      {/* Collapsed state: thin strip with toggle + all icons */}
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
          <div class="shrink-0 flex flex-col items-center pb-6 gap-2">
            <Show when={props.notificationBell}>
              {props.notificationBell}
            </Show>
            <TooltipKeybind placement="right" title={props.settingsLabel()} keybind={props.settingsKeybind() ?? ""}>
              <IconButton
                icon="settings-gear"
                variant="ghost"
                size="large"
                onClick={props.onOpenSettings}
                aria-label={props.settingsLabel()}
              />
            </TooltipKeybind>
            <Tooltip placement="right" value={props.helpLabel()}>
              <IconButton
                icon="help"
                variant="ghost"
                size="large"
                onClick={props.onOpenHelp}
                aria-label={props.helpLabel()}
              />
            </Tooltip>
            <Show when={props.onLogout}>
              <DropdownMenu placement="right-end">
                <Tooltip placement="right" value={props.userEmail ?? "Account"}>
                  <DropdownMenu.Trigger
                    as={IconButton}
                    icon="person"
                    variant="ghost"
                    size="large"
                    aria-label="Account"
                  />
                </Tooltip>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content>
                    <Show when={props.userEmail}>
                      <div style={{ padding: "8px 12px 4px", "font-size": "12px", color: "var(--color-text-dimmed)", "max-width": "200px", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                        {props.userEmail}
                      </div>
                      <DropdownMenu.Separator />
                    </Show>
                    <DropdownMenu.Item onSelect={props.onLogout}>
                      Sign out
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu>
            </Show>
          </div>
        </div>
      </Show>

      {/* Expanded state: full sessions panel + footer */}
      <div
        ref={(el) => { panel = el }}
        classList={{
          "flex flex-col h-full w-full min-w-0 overflow-hidden": true,
          "hidden": !expanded(),
        }}
        aria-hidden={!expanded()}
      >
        {/* Sessions panel content */}
        <div class="flex-1 min-h-0 overflow-hidden">
          {props.renderPanel()}
        </div>

        {/* Footer: bell, settings, help, account + collapse button */}
        <div class="shrink-0 flex items-center justify-between px-2 py-2 border-t border-border-weaker-base bg-background-base">
          <div class="flex items-center gap-1">
            <Show when={props.notificationBell}>
              {props.notificationBell}
            </Show>
            <TooltipKeybind placement={placement()} title={props.settingsLabel()} keybind={props.settingsKeybind() ?? ""}>
              <IconButton
                icon="settings-gear"
                variant="ghost"
                size="large"
                onClick={props.onOpenSettings}
                aria-label={props.settingsLabel()}
              />
            </TooltipKeybind>
            <Tooltip placement={placement()} value={props.helpLabel()}>
              <IconButton
                icon="help"
                variant="ghost"
                size="large"
                onClick={props.onOpenHelp}
                aria-label={props.helpLabel()}
              />
            </Tooltip>
            <Show when={props.onLogout}>
              <DropdownMenu placement="top-start">
                <Tooltip placement={placement()} value={props.userEmail ?? "Account"}>
                  <DropdownMenu.Trigger
                    as={IconButton}
                    icon="person"
                    variant="ghost"
                    size="large"
                    aria-label="Account"
                  />
                </Tooltip>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content>
                    <Show when={props.userEmail}>
                      <div style={{ padding: "8px 12px 4px", "font-size": "12px", color: "var(--color-text-dimmed)", "max-width": "200px", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                        {props.userEmail}
                      </div>
                      <DropdownMenu.Separator />
                    </Show>
                    <DropdownMenu.Item onSelect={props.onLogout}>
                      Sign out
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu>
            </Show>
          </div>
          <Tooltip placement={placement()} value="Collapse">
            <IconButton
              icon="sidebar-active"
              variant="ghost"
              size="large"
              onClick={props.onToggleSessions}
              aria-label="Collapse sidebar"
            />
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
