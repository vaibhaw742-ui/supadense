import { AppIcon } from "@opencode-ai/ui/app-icon"
import { Button } from "@opencode-ai/ui/button"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Keybind } from "@opencode-ai/ui/keybind"
import { Spinner } from "@opencode-ai/ui/spinner"
import { showToast } from "@opencode-ai/ui/toast"
import { Tooltip, TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { getFilename } from "@opencode-ai/util/path"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"
import { useParams } from "@solidjs/router"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useSync } from "@/context/sync"
import { useSessionLayout } from "@/pages/session/session-layout"
import { messageAgentColor } from "@/utils/agent"
import { decode64 } from "@/utils/base64"
import { Persist, persisted } from "@/utils/persist"


const OPEN_APPS = [
  "vscode",
  "cursor",
  "zed",
  "textmate",
  "antigravity",
  "finder",
  "terminal",
  "iterm2",
  "ghostty",
  "warp",
  "xcode",
  "android-studio",
  "powershell",
  "sublime-text",
] as const

type OpenApp = (typeof OPEN_APPS)[number]
type OS = "macos" | "windows" | "linux" | "unknown"

const MAC_APPS = [
  {
    id: "vscode",
    label: "session.header.open.app.vscode",
    icon: "vscode",
    openWith: "Visual Studio Code",
  },
  { id: "cursor", label: "session.header.open.app.cursor", icon: "cursor", openWith: "Cursor" },
  { id: "zed", label: "session.header.open.app.zed", icon: "zed", openWith: "Zed" },
  { id: "textmate", label: "session.header.open.app.textmate", icon: "textmate", openWith: "TextMate" },
  {
    id: "antigravity",
    label: "session.header.open.app.antigravity",
    icon: "antigravity",
    openWith: "Antigravity",
  },
  { id: "terminal", label: "session.header.open.app.terminal", icon: "terminal", openWith: "Terminal" },
  { id: "iterm2", label: "session.header.open.app.iterm2", icon: "iterm2", openWith: "iTerm" },
  { id: "ghostty", label: "session.header.open.app.ghostty", icon: "ghostty", openWith: "Ghostty" },
  { id: "warp", label: "session.header.open.app.warp", icon: "warp", openWith: "Warp" },
  { id: "xcode", label: "session.header.open.app.xcode", icon: "xcode", openWith: "Xcode" },
  {
    id: "android-studio",
    label: "session.header.open.app.androidStudio",
    icon: "android-studio",
    openWith: "Android Studio",
  },
  {
    id: "sublime-text",
    label: "session.header.open.app.sublimeText",
    icon: "sublime-text",
    openWith: "Sublime Text",
  },
] as const

const WINDOWS_APPS = [
  { id: "vscode", label: "session.header.open.app.vscode", icon: "vscode", openWith: "code" },
  { id: "cursor", label: "session.header.open.app.cursor", icon: "cursor", openWith: "cursor" },
  { id: "zed", label: "session.header.open.app.zed", icon: "zed", openWith: "zed" },
  {
    id: "powershell",
    label: "session.header.open.app.powershell",
    icon: "powershell",
    openWith: "powershell",
  },
  {
    id: "sublime-text",
    label: "session.header.open.app.sublimeText",
    icon: "sublime-text",
    openWith: "Sublime Text",
  },
] as const

const LINUX_APPS = [
  { id: "vscode", label: "session.header.open.app.vscode", icon: "vscode", openWith: "code" },
  { id: "cursor", label: "session.header.open.app.cursor", icon: "cursor", openWith: "cursor" },
  { id: "zed", label: "session.header.open.app.zed", icon: "zed", openWith: "zed" },
  {
    id: "sublime-text",
    label: "session.header.open.app.sublimeText",
    icon: "sublime-text",
    openWith: "Sublime Text",
  },
] as const

const detectOS = (platform: ReturnType<typeof usePlatform>): OS => {
  if (platform.platform === "desktop" && platform.os) return platform.os
  if (typeof navigator !== "object") return "unknown"
  const value = navigator.platform || navigator.userAgent
  if (/Mac/i.test(value)) return "macos"
  if (/Win/i.test(value)) return "windows"
  if (/Linux/i.test(value)) return "linux"
  return "unknown"
}

const showRequestError = (language: ReturnType<typeof useLanguage>, err: unknown) => {
  showToast({
    variant: "error",
    title: language.t("common.requestFailed"),
    description: err instanceof Error ? err.message : String(err),
  })
}

function kbApiBase() {
  return import.meta.env.DEV
    ? `http://${import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:4096`
    : `${location.origin}/api`
}

function GitHubButton(props: { directory: string }) {
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [modalOpen, setModalOpen] = createSignal(false)
  const [repoUrl, setRepoUrl] = createSignal("")
  const [pat, setPat] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [committing, setCommitting] = createSignal(false)
  const [pushing, setPushing] = createSignal(false)
  const [hasRemote, setHasRemote] = createSignal(false)
  const [uncommitted, setUncommitted] = createSignal(0)
  const [unpushed, setUnpushed] = createSignal(0)

  const loadStatus = async () => {
    try {
      const res = await fetch(
        `${kbApiBase()}/kb/git/status?directory=${encodeURIComponent(props.directory)}`,
      )
      if (!res.ok) return
      const data = await res.json() as {
        hasRemoteConfigured: boolean
        uncommittedCount: number
        unpushedCount: number
      }
      setHasRemote(data.hasRemoteConfigured)
      setUncommitted(data.uncommittedCount)
      setUnpushed(data.unpushedCount)
    } catch {}
  }

  const handleCommit = async () => {
    setCommitting(true)
    setMenuOpen(false)
    try {
      const res = await fetch(`${kbApiBase()}/kb/git/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directory: props.directory }),
      })
      const data = await res.json() as { message?: string; error?: string }
      if (!res.ok) {
        showToast({ variant: "error", title: data.error ?? "Commit failed" })
      } else {
        showToast({ variant: "success", title: data.message ?? "Committed" })
        await loadStatus()
      }
    } catch {
      showToast({ variant: "error", title: "Commit failed" })
    } finally {
      setCommitting(false)
    }
  }

  const handlePush = async () => {
    if (!hasRemote()) {
      setMenuOpen(false)
      setModalOpen(true)
      return
    }
    setPushing(true)
    setMenuOpen(false)
    try {
      const res = await fetch(`${kbApiBase()}/kb/git/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directory: props.directory }),
      })
      const data = await res.json() as { message?: string; error?: string }
      if (!res.ok) {
        showToast({ variant: "error", title: data.error ?? "Push failed" })
      } else {
        showToast({ variant: "success", title: data.message ?? "Pushed" })
        await loadStatus()
      }
    } catch {
      showToast({ variant: "error", title: "Push failed" })
    } finally {
      setPushing(false)
    }
  }

  const handleSaveRemote = async () => {
    if (!repoUrl().trim() || !pat().trim()) return
    setSaving(true)
    try {
      const res = await fetch(`${kbApiBase()}/kb/git/remote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directory: props.directory,
          remote_url: repoUrl().trim(),
          pat: pat().trim(),
        }),
      })
      const data = await res.json() as { message?: string; error?: string }
      if (!res.ok) {
        showToast({ variant: "error", title: data.error ?? "Failed to save remote" })
      } else {
        showToast({ variant: "success", title: "GitHub remote saved" })
        setModalOpen(false)
        setRepoUrl("")
        setPat("")
        await loadStatus()
      }
    } catch {
      showToast({ variant: "error", title: "Failed to save remote" })
    } finally {
      setSaving(false)
    }
  }

  const busy = () => committing() || pushing() || saving()
  const hasDot = () => uncommitted() > 0 || unpushed() > 0

  return (
    <>
      <DropdownMenu
        gutter={4}
        placement="bottom-end"
        open={menuOpen()}
        onOpenChange={(open) => {
          if (open) void loadStatus()
          setMenuOpen(open)
        }}
      >
        <DropdownMenu.Trigger as="div">
          <Tooltip placement="bottom" value="GitHub sync">
            <Button
              variant="ghost"
              class="titlebar-icon h-6 px-2 gap-1.5 box-border shrink-0 flex items-center relative"
              aria-label="GitHub sync"
              disabled={busy()}
            >
              <Show when={busy()} fallback={
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.603-3.369-1.342-3.369-1.342-.454-1.154-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.647.35-1.087.636-1.337-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"/>
                  </svg>
                  <span class="text-xs">GitHub</span>
                  <Show when={hasDot()}>
                    <span
                      class="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full"
                      style={{ background: unpushed() > 0 ? "#f97316" : "#22c55e" }}
                    />
                  </Show>
                </>
              }>
                <Spinner class="size-3" />
              </Show>
            </Button>
          </Tooltip>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <DropdownMenu.Item onSelect={handleCommit} disabled={committing()}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{ "flex-shrink": "0" }}>
                <circle cx="12" cy="12" r="3"/>
                <line x1="3" y1="12" x2="9" y2="12"/>
                <line x1="15" y1="12" x2="21" y2="12"/>
              </svg>
              <DropdownMenu.ItemLabel>
                Commit changes{uncommitted() > 0 ? ` (${uncommitted()})` : ""}
              </DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={handlePush} disabled={pushing()}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{ "flex-shrink": "0" }}>
                <path d="M7 16V4m0 0L3 8m4-4l4 4"/>
                <path d="M17 8v12m0 0l4-4m-4 4l-4-4"/>
              </svg>
              <DropdownMenu.ItemLabel>
                {hasRemote() ? `Push to GitHub${unpushed() > 0 ? ` (${unpushed()})` : ""}` : "Connect GitHub repo…"}
              </DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>

      {/* GitHub repo setup modal */}
      <Show when={modalOpen()}>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setModalOpen(false) }}
        >
          <div
            class="bg-[var(--color-background)] border border-[var(--color-border)] rounded-lg shadow-xl p-6 w-full max-w-md mx-4"
            style={{ "font-family": "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif" }}
          >
            <h2 class="text-sm font-medium text-[var(--color-text-strong)] mb-1">Connect GitHub repo</h2>
            <p class="text-xs text-[var(--color-text-weak)] mb-4">
              Your KB files (wiki, assets, raw) will be pushed to this repo.
            </p>
            <div class="flex flex-col gap-3">
              <div class="flex flex-col gap-1">
                <label class="text-xs text-[var(--color-text-weak)]">Repository URL</label>
                <input
                  type="url"
                  placeholder="https://github.com/your-user/your-kb"
                  value={repoUrl()}
                  onInput={(e) => setRepoUrl(e.currentTarget.value)}
                  class="w-full px-3 py-2 text-xs rounded border border-[var(--color-border)] bg-[var(--color-background-weak)] text-[var(--color-text-strong)] outline-none focus:border-[var(--sl-color-accent)]"
                />
              </div>
              <div class="flex flex-col gap-1">
                <label class="text-xs text-[var(--color-text-weak)]">Personal Access Token (PAT)</label>
                <input
                  type="password"
                  placeholder="ghp_xxxxxxxxxxxx"
                  value={pat()}
                  onInput={(e) => setPat(e.currentTarget.value)}
                  class="w-full px-3 py-2 text-xs rounded border border-[var(--color-border)] bg-[var(--color-background-weak)] text-[var(--color-text-strong)] outline-none focus:border-[var(--sl-color-accent)]"
                />
                <p class="text-xs text-[var(--color-text-weaker)]">
                  Needs <strong>repo</strong> scope. Stored locally on this device only.
                </p>
              </div>
            </div>
            <div class="flex justify-end gap-2 mt-5">
              <Button variant="ghost" class="text-xs h-7 px-3" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                class="text-xs h-7 px-3"
                disabled={saving() || !repoUrl().trim() || !pat().trim()}
                onClick={handleSaveRemote}
              >
                <Show when={saving()} fallback="Save & connect">
                  <Spinner class="size-3 mr-1" />Saving…
                </Show>
              </Button>
            </div>
          </div>
        </div>
      </Show>
    </>
  )
}

function WikiButton() {
  const params = useParams<{ dir: string }>()
  return (
    <Tooltip placement="bottom" value="Open Wiki">
      <Button
        variant="ghost"
        class="titlebar-icon h-6 px-2 gap-1.5 box-border shrink-0 flex items-center"
        onClick={() => window.open(`/${params.dir}/wiki`, "_blank")}
        aria-label="Open Wiki"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
        </svg>
        <span class="text-xs">Open Wiki</span>
      </Button>
    </Tooltip>
  )
}

function DocsButton() {
  return (
    <Tooltip placement="bottom" value="Docs">
      <Button
        variant="ghost"
        class="titlebar-icon h-6 px-2 gap-1.5 box-border shrink-0 flex items-center"
        onClick={() => window.open("https://supadense.com/docs", "_blank")}
        aria-label="Docs"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 16v-4"/>
          <path d="M12 8h.01"/>
        </svg>
        <span class="text-xs">Docs</span>
      </Button>
    </Tooltip>
  )
}

export function SessionHeader() {
  const layout = useLayout()
  const command = useCommand()
  const server = useServer()
  const platform = usePlatform()
  const language = useLanguage()
  const sync = useSync()
  const { params, view } = useSessionLayout()

  const projectDirectory = createMemo(() => decode64(params.dir) ?? "")
  const project = createMemo(() => {
    const directory = projectDirectory()
    if (!directory) return
    return layout.projects.list().find((p) => p.worktree === directory || p.sandboxes?.includes(directory))
  })
  const name = createMemo(() => {
    const current = project()
    if (current) return current.name || getFilename(current.worktree)
    return getFilename(projectDirectory())
  })
  const hotkey = createMemo(() => command.keybind("file.open"))
  const os = createMemo(() => detectOS(platform))

  const [exists, setExists] = createStore<Partial<Record<OpenApp, boolean>>>({
    finder: true,
  })

  const apps = createMemo(() => {
    if (os() === "macos") return MAC_APPS
    if (os() === "windows") return WINDOWS_APPS
    return LINUX_APPS
  })

  const fileManager = createMemo(() => {
    if (os() === "macos") return { label: "session.header.open.finder", icon: "finder" as const }
    if (os() === "windows") return { label: "session.header.open.fileExplorer", icon: "file-explorer" as const }
    return { label: "session.header.open.fileManager", icon: "finder" as const }
  })

  createEffect(() => {
    if (platform.platform !== "desktop") return
    if (!platform.checkAppExists) return

    const list = apps()

    setExists(Object.fromEntries(list.map((app) => [app.id, undefined])) as Partial<Record<OpenApp, boolean>>)

    void Promise.all(
      list.map((app) =>
        Promise.resolve(platform.checkAppExists?.(app.openWith))
          .then((value) => Boolean(value))
          .catch(() => false)
          .then((ok) => [app.id, ok] as const),
      ),
    ).then((entries) => {
      setExists(Object.fromEntries(entries) as Partial<Record<OpenApp, boolean>>)
    })
  })

  const options = createMemo(() => {
    return [
      { id: "finder", label: language.t(fileManager().label), icon: fileManager().icon },
      ...apps()
        .filter((app) => exists[app.id])
        .map((app) => ({ ...app, label: language.t(app.label) })),
    ] as const
  })

  const [prefs, setPrefs] = persisted(Persist.global("open.app"), createStore({ app: "finder" as OpenApp }))
  const [menu, setMenu] = createStore({ open: false })
  const [openRequest, setOpenRequest] = createStore({
    app: undefined as OpenApp | undefined,
  })

  const canOpen = createMemo(() => platform.platform === "desktop" && !!platform.openPath && server.isLocal())
  const current = createMemo(
    () =>
      options().find((o) => o.id === prefs.app) ??
      options()[0] ??
      ({ id: "finder", label: fileManager().label, icon: fileManager().icon } as const),
  )
  const opening = createMemo(() => openRequest.app !== undefined)
  const tint = createMemo(() =>
    messageAgentColor(params.id ? sync.data.message[params.id] : undefined, sync.data.agent),
  )

  const selectApp = (app: OpenApp) => {
    if (!options().some((item) => item.id === app)) return
    setPrefs("app", app)
  }

  const openDir = (app: OpenApp) => {
    if (opening() || !canOpen() || !platform.openPath) return
    const directory = projectDirectory()
    if (!directory) return

    const item = options().find((o) => o.id === app)
    const openWith = item && "openWith" in item ? item.openWith : undefined
    setOpenRequest("app", app)
    platform
      .openPath(directory, openWith)
      .catch((err: unknown) => showRequestError(language, err))
      .finally(() => {
        setOpenRequest("app", undefined)
      })
  }

  const centerMount = createMemo(() => document.getElementById("opencode-titlebar-center"))
  const rightMount = createMemo(() => document.getElementById("opencode-titlebar-right"))

  return (
    <>
      <Show when={centerMount()}>
        {(mount) => (
          <Portal mount={mount()}>
            <Button
              type="button"
              variant="ghost"
              size="small"
              class="hidden md:flex w-[240px] max-w-full min-w-0 items-center gap-2 justify-between rounded-md border border-border-weak-base bg-surface-panel shadow-none cursor-default"
              onClick={() => command.trigger("file.open")}
              aria-label={language.t("session.header.searchFiles")}
            >
              <div class="flex min-w-0 flex-1 items-center overflow-visible">
                <span class="flex-1 min-w-0 text-12-regular text-text-weak truncate text-left">
                  {language.t("session.header.search.placeholder", {
                    project: name(),
                  })}
                </span>
              </div>

              <Show when={hotkey()}>
                {(keybind) => (
                  <Keybind class="shrink-0 !border-0 !bg-transparent !shadow-none px-0 text-text-weaker">
                    {keybind()}
                  </Keybind>
                )}
              </Show>
            </Button>
          </Portal>
        )}
      </Show>
      <Show when={rightMount()}>
        {(mount) => (
          <Portal mount={mount()}>
            <div class="flex items-center gap-2">
              <Show when={projectDirectory()}>
                <div class="hidden xl:flex items-center">
                  <Show when={canOpen()}>
                    <div class="flex items-center">
                      <div class="flex h-[24px] box-border items-center rounded-md border border-border-weak-base bg-surface-panel overflow-hidden">
                        <Button
                          variant="ghost"
                          class="rounded-none h-full px-0.5 border-none shadow-none disabled:!cursor-default"
                          classList={{
                            "bg-surface-raised-base-active": opening(),
                          }}
                          onClick={() => openDir(current().id)}
                          disabled={opening()}
                          aria-label={language.t("session.header.open.ariaLabel", { app: current().label })}
                        >
                          <div class="flex size-5 shrink-0 items-center justify-center [&_[data-component=app-icon]]:size-5">
                            <Show when={opening()} fallback={<AppIcon id={current().icon} />}>
                              <Spinner class="size-3.5" style={{ color: tint() ?? "var(--icon-base)" }} />
                            </Show>
                          </div>
                        </Button>
                        <DropdownMenu
                          gutter={4}
                          placement="bottom-end"
                          open={menu.open}
                          onOpenChange={(open) => setMenu("open", open)}
                        >
                          <DropdownMenu.Trigger
                            as={IconButton}
                            icon="chevron-down"
                            variant="ghost"
                            disabled={opening()}
                            class="rounded-none h-full w-[20px] p-0 border-none shadow-none data-[expanded]:bg-surface-raised-base-active disabled:!cursor-default"
                            classList={{
                              "bg-surface-raised-base-active": opening(),
                            }}
                            aria-label={language.t("session.header.open.menu")}
                          />
                          <DropdownMenu.Portal>
                            <DropdownMenu.Content class="[&_[data-slot=dropdown-menu-item]]:pl-1 [&_[data-slot=dropdown-menu-radio-item]]:pl-1 [&_[data-slot=dropdown-menu-radio-item]+[data-slot=dropdown-menu-radio-item]]:mt-1">
                              <DropdownMenu.Group>
                                <DropdownMenu.GroupLabel class="!px-1 !py-1">
                                  {language.t("session.header.openIn")}
                                </DropdownMenu.GroupLabel>
                                <DropdownMenu.RadioGroup
                                  class="mt-1"
                                  value={current().id}
                                  onChange={(value) => {
                                    if (!OPEN_APPS.includes(value as OpenApp)) return
                                    selectApp(value as OpenApp)
                                  }}
                                >
                                  <For each={options()}>
                                    {(o) => (
                                      <DropdownMenu.RadioItem
                                        value={o.id}
                                        disabled={opening()}
                                        onSelect={() => {
                                          setMenu("open", false)
                                          openDir(o.id)
                                        }}
                                      >
                                        <div class="flex size-5 shrink-0 items-center justify-center [&_[data-component=app-icon]]:size-5">
                                          <AppIcon id={o.icon} />
                                        </div>
                                        <DropdownMenu.ItemLabel>{o.label}</DropdownMenu.ItemLabel>
                                        <DropdownMenu.ItemIndicator>
                                          <Icon name="check-small" size="small" class="text-icon-weak" />
                                        </DropdownMenu.ItemIndicator>
                                      </DropdownMenu.RadioItem>
                                    )}
                                  </For>
                                </DropdownMenu.RadioGroup>
                              </DropdownMenu.Group>
                            </DropdownMenu.Content>
                          </DropdownMenu.Portal>
                        </DropdownMenu>
                      </div>
                    </div>
                  </Show>
                </div>
              </Show>
              <div class="flex items-center gap-1">
                <WikiButton />
                <DocsButton />
                <Show when={projectDirectory()}>
                  {(dir) => <GitHubButton directory={dir()} />}
                </Show>

                <div class="hidden md:flex items-center gap-1 shrink-0">
                  <TooltipKeybind
                    title={language.t("command.review.toggle")}
                    keybind={command.keybind("review.toggle")}
                  >
                    <Button
                      variant="ghost"
                      class="group/review-toggle titlebar-icon w-8 h-6 p-0 box-border"
                      onClick={() => view().reviewPanel.toggle()}
                      aria-label={language.t("command.review.toggle")}
                      aria-expanded={view().reviewPanel.opened()}
                      aria-controls="review-panel"
                    >
                      <Icon size="small" name={view().reviewPanel.opened() ? "review-active" : "review"} />
                    </Button>
                  </TooltipKeybind>

                  <TooltipKeybind
                    title={language.t("command.fileTree.toggle")}
                    keybind={command.keybind("fileTree.toggle")}
                  >
                    <Button
                      variant="ghost"
                      class="titlebar-icon w-8 h-6 p-0 box-border"
                      onClick={() => layout.fileTree.toggle()}
                      aria-label={language.t("command.fileTree.toggle")}
                      aria-expanded={layout.fileTree.opened()}
                      aria-controls="file-tree-panel"
                    >
                      <div class="relative flex items-center justify-center size-4">
                        <Icon
                          size="small"
                          name={layout.fileTree.opened() ? "file-tree-active" : "file-tree"}
                          classList={{
                            "text-icon-strong": layout.fileTree.opened(),
                            "text-icon-weak": !layout.fileTree.opened(),
                          }}
                        />
                      </div>
                    </Button>
                  </TooltipKeybind>
                </div>
              </div>
            </div>
          </Portal>
        )}
      </Show>
    </>
  )
}
