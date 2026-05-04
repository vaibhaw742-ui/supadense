import { createMemo, createSignal, For, Match, onMount, Show, Switch } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Logo } from "@opencode-ai/ui/logo"
import { useLayout } from "@/context/layout"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/util/encode"
import { Icon } from "@opencode-ai/ui/icon"
import { usePlatform } from "@/context/platform"
import { DateTime } from "luxon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { DialogSelectServer } from "@/components/dialog-select-server"
import { useServer } from "@/context/server"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { getAuthToken, getBackendUrl } from "@/utils/server"

export default function Home() {
  const sync = useGlobalSync()
  const layout = useLayout()
  const platform = usePlatform()
  const dialog = useDialog()
  const navigate = useNavigate()
  const server = useServer()
  const language = useLanguage()
  const homedir = createMemo(() => sync.data.path.home)
  const recent = createMemo(() => {
    return sync.data.project
      .slice()
      .sort((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
      .slice(0, 5)
  })

  const serverDotClass = createMemo(() => {
    const healthy = server.healthy()
    if (healthy === true) return "bg-icon-success-base"
    if (healthy === false) return "bg-icon-critical-base"
    return "bg-border-weak-base"
  })

  // Auto-redirect authenticated users to their default workspace
  onMount(async () => {
    const token = getAuthToken()
    if (!token) return
    try {
      const res = await fetch(`${getBackendUrl()}/supa-auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const { userId } = (await res.json()) as { userId?: string }
      if (!userId) return
      const defaultDir = `/workspaces/${userId}/default`
      server.projects.touch(defaultDir)
      navigate(`/${base64Encode(defaultDir)}/session`)
    } catch {}
  })

  // KB creation state — lives directly in Home so signals are always reactive
  const [kbOpen, setKbOpen] = createSignal(false)
  const [kbName, setKbName] = createSignal("")
  const [kbError, setKbError] = createSignal("")
  const [kbLoading, setKbLoading] = createSignal(false)
  const [kbCreatedDir, setKbCreatedDir] = createSignal("")

  function openKbDialog() {
    setKbName("")
    setKbError("")
    setKbLoading(false)
    setKbCreatedDir("")
    setKbOpen(true)
  }

  function closeKbDialog() {
    setKbOpen(false)
  }

  async function handleKbCreate() {
    const trimmed = kbName().trim()
    if (!trimmed) return
    setKbError("")
    setKbLoading(true)
    const token = getAuthToken()
    try {
      const base = import.meta.env.DEV
        ? `http://${import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:${import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`
        : `${location.origin}/api`
      const res = await fetch(`${base}/kb/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        setKbError(err.error ?? "Failed to create KB")
        return
      }
      const { directory } = (await res.json()) as { directory: string }
      setKbCreatedDir(directory)
    } catch {
      setKbError("Failed to create KB — check connection")
    } finally {
      setKbLoading(false)
    }
  }

  function handleKbSetup() {
    const dir = kbCreatedDir()
    if (!dir) return
    closeKbDialog()
    layout.projects.open(dir)
    server.projects.touch(dir)
    navigate(
      `/${base64Encode(dir)}/session?prompt=${encodeURIComponent("Setup my knowledge base")}&send=1`,
    )
  }

  function openProject(directory: string) {
    layout.projects.open(directory)
    server.projects.touch(directory)
    navigate(`/${base64Encode(directory)}/session`)
  }

  async function chooseProject() {
    function resolve(result: string | string[] | null) {
      if (Array.isArray(result)) {
        for (const directory of result) {
          openProject(directory)
        }
      } else if (result) {
        openProject(result)
      }
    }

    if (platform.openDirectoryPickerDialog && server.isLocal()) {
      const result = await platform.openDirectoryPickerDialog?.({
        title: language.t("command.project.open"),
        multiple: true,
      })
      resolve(result)
    } else {
      dialog.show(
        () => <DialogSelectDirectory multiple={true} onSelect={resolve} />,
        () => resolve(null),
      )
    }
  }

  return (
    <div class="mx-auto mt-55 w-full md:w-auto px-4">
      <Logo class="md:w-xl opacity-12" />
      <Button
        size="large"
        variant="ghost"
        class="mt-4 mx-auto text-14-regular text-text-weak"
        onClick={() => dialog.show(() => <DialogSelectServer />)}
      >
        <div
          classList={{
            "size-2 rounded-full": true,
            [serverDotClass()]: true,
          }}
        />
        {server.name}
      </Button>
      <Switch>
        <Match when={sync.data.project.length > 0}>
          <div class="mt-20 w-full flex flex-col gap-4">
            <div class="flex gap-2 items-center justify-between pl-3">
              <div class="text-14-medium text-text-strong">{language.t("home.recentProjects")}</div>
              <Button icon="folder-add-left" size="normal" class="pl-2 pr-3" onClick={openKbDialog}>
                Create Knowledge Base
              </Button>
            </div>
            <ul class="flex flex-col gap-2">
              <For each={recent()}>
                {(project) => (
                  <Button
                    size="large"
                    variant="ghost"
                    class="text-14-mono text-left justify-between px-3"
                    onClick={() => openProject(project.worktree)}
                  >
                    {project.worktree.replace(/^\/workspaces\/[^/]+\//, "~/").replace(homedir(), "~")}
                    <div class="text-14-regular text-text-weak">
                      {DateTime.fromMillis(project.time.updated ?? project.time.created).toRelative()}
                    </div>
                  </Button>
                )}
              </For>
            </ul>
          </div>
        </Match>
        <Match when={!sync.ready}>
          <div class="mt-30 mx-auto flex flex-col items-center gap-3">
            <div class="text-12-regular text-text-weak">{language.t("common.loading")}</div>
            <Button class="px-3" onClick={openKbDialog}>
              Create Knowledge Base
            </Button>
          </div>
        </Match>
        <Match when={true}>
          <div class="mt-30 mx-auto flex flex-col items-center gap-3">
            <Icon name="folder-add-left" size="large" />
            <div class="flex flex-col gap-1 items-center justify-center">
              <div class="text-14-medium text-text-strong">No recent Knowledge Base</div>
              <div class="text-12-regular text-text-weak">Get started by creating a Knowledge Base</div>
            </div>
            <Button class="px-3 mt-1" onClick={openKbDialog}>
              Create Knowledge Base
            </Button>
          </div>
        </Match>
      </Switch>

      {/* KB creation modal — rendered inline so signals are always reactive */}
      <Show when={kbOpen()}>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center"
          onClick={(e) => { if (e.target === e.currentTarget) closeKbDialog() }}
        >
          <div class="rounded-xl shadow-lg bg-[var(--surface-raised-stronger-non-alpha)] border border-[var(--border-weak-base)] w-full max-w-sm mx-4">
            <div class="flex items-center justify-between px-5 py-4 border-b border-[var(--border-weak-base)]">
              <span class="text-16-medium text-text-strong">
                {kbCreatedDir() ? "Knowledge Base Created" : "New KB"}
              </span>
              <button
                type="button"
                class="text-text-weak hover:text-text-strong transition-colors text-lg leading-none"
                onClick={closeKbDialog}
              >
                ✕
              </button>
            </div>

            <Show
              when={kbCreatedDir()}
              fallback={
                <div class="flex flex-col gap-4 px-6 py-4">
                  <input
                    autofocus
                    class="w-full rounded-lg border border-border-base bg-background-input px-3 py-2 text-14-regular text-text-strong outline-none focus:border-border-focus placeholder:text-text-weak"
                    classList={{ "border-red-500 focus:border-red-500": !!kbError() }}
                    placeholder="e.g. Machine Learning"
                    onInput={(e) => { setKbName(e.currentTarget.value); setKbError("") }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleKbCreate()
                      if (e.key === "Escape") closeKbDialog()
                    }}
                  />
                  <Show when={kbError()}>
                    <div class="text-12-regular text-red-500">{kbError()}</div>
                  </Show>
                  <div class="flex justify-end gap-2">
                    <Button variant="ghost" size="large" onClick={closeKbDialog}>
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      size="large"
                      disabled={kbLoading()}
                      onClick={handleKbCreate}
                    >
                      {kbLoading() ? "Creating…" : "Create"}
                    </Button>
                  </div>
                </div>
              }
            >
              <div class="flex flex-col gap-5 px-6 py-4">
                <div class="flex flex-col gap-1.5">
                  <div class="text-14-regular text-text-strong">Your Knowledge Base is ready.</div>
                  <div class="text-12-regular text-text-weak">
                    Click below to start the setup conversation.
                  </div>
                </div>
                <div class="flex justify-end">
                  <Button variant="primary" size="large" onClick={handleKbSetup}>
                    Setup My Knowledge Base
                  </Button>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  )
}
