import {
  batch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  ParentProps,
  Show,
  untrack,
  type Accessor,
} from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { useLayout, LocalProject } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
import { Persist, persisted } from "@/utils/persist"
import { base64Encode } from "@opencode-ai/util/encode"
import { decode64 } from "@/utils/base64"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Dialog } from "@opencode-ai/ui/dialog"
import { getFilename } from "@opencode-ai/util/path"
import { Session, type Message } from "@opencode-ai/sdk/v2/client"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { createStore, produce, reconcile } from "solid-js/store"
import { DragDropProvider, DragDropSensors, DragOverlay, SortableProvider, closestCenter } from "@thisbeyond/solid-dnd"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import { useProviders } from "@/hooks/use-providers"
import { showToast, Toast, toaster } from "@opencode-ai/ui/toast"
import { useGlobalSDK } from "@/context/global-sdk"
import { clearWorkspaceTerminals } from "@/context/terminal"
import { dropSessionCaches, pickSessionCacheEvictions } from "@/context/global-sync/session-cache"
import {
  clearSessionPrefetchInflight,
  clearSessionPrefetch,
  getSessionPrefetch,
  isSessionPrefetchCurrent,
  runSessionPrefetch,
  setSessionPrefetch,
  shouldSkipSessionPrefetch,
} from "@/context/global-sync/session-prefetch"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { Binary } from "@opencode-ai/util/binary"
import { retry } from "@opencode-ai/util/retry"
import { playSoundById } from "@/utils/sound"
import { createAim } from "@/utils/aim"
import { setNavigate } from "@/utils/notification-click"
import { Worktree as WorktreeState } from "@/utils/worktree"
import { setSessionHandoff } from "@/pages/session/handoff"

import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useTheme, type ColorScheme } from "@opencode-ai/ui/theme/context"
import { useCommand, type CommandOption } from "@/context/command"
import { ConstrainDragXAxis, getDraggableId } from "@/utils/solid-dnd"
import { DebugBar } from "@/components/debug-bar"
import { Titlebar } from "@/components/titlebar"
import { useServer } from "@/context/server"
import { useLanguage, type Locale } from "@/context/language"
import { clearAuthToken, getAuthToken } from "@/utils/server"
import {
  displayName,
  effectiveWorkspaceOrder,
  errorMessage,
  latestRootSession,
  sortedRootSessions,
  workspaceKey,
} from "./layout/helpers"
import {
  collectNewSessionDeepLinks,
  collectOpenProjectDeepLinks,
  deepLinkEvent,
  drainPendingDeepLinks,
} from "./layout/deep-links"
import { createInlineEditorController } from "./layout/inline-editor"
import {
  LocalWorkspace,
  SortableWorkspace,
  WorkspaceDragOverlay,
  type WorkspaceSidebarContext,
} from "./layout/sidebar-workspace"
import { ProjectDragOverlay, SortableProject, type ProjectSidebarContext } from "./layout/sidebar-project"
import { SidebarContent } from "./layout/sidebar-shell"
import { SupadenseMark, SupadenseChatOverlay } from "@/components/supadense-chat-panel"
import { SupadenseSidebar, SidebarCollapseToggle } from "@/components/supadense-sidebar"
import { chatOpen, setChatOpen } from "@/context/chat-overlay"
import { CaptureDialog } from "@/components/capture-dialog"
import { activeSidebarView, setActiveSidebarView, setActiveSourceName } from "@/context/sidebar-view"
import { ReadPanel } from "@/pages/read-panel"

export default function Layout(props: ParentProps) {
  const [store, setStore, , ready] = persisted(
    Persist.global("layout.page", ["layout.page.v1"]),
    createStore({
      lastProjectSession: {} as { [directory: string]: { directory: string; id: string; at: number } },
      activeProject: undefined as string | undefined,
      activeWorkspace: undefined as string | undefined,
      workspaceOrder: {} as Record<string, string[]>,
      workspaceName: {} as Record<string, string>,
      workspaceBranchName: {} as Record<string, Record<string, string>>,
      workspaceExpanded: {} as Record<string, boolean>,
      gettingStartedDismissed: false,
    }),
  )

  const pageReady = createMemo(() => ready())

  let scrollContainerRef: HTMLDivElement | undefined
  let dialogRun = 0
  let dialogDead = false

  const params = useParams()
  const routeLocation = useLocation()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const layout = useLayout()
  const layoutReady = createMemo(() => layout.ready())
  const platform = usePlatform()
  const settings = useSettings()
  const server = useServer()
  const notification = useNotification()
  const permission = usePermission()
  const navigate = useNavigate()
  setNavigate(navigate)
  const providers = useProviders()
  const dialog = useDialog()
  const command = useCommand()
  const theme = useTheme()
  const language = useLanguage()

  const [supadenseSidebarCollapsed, setSupadenseSidebarCollapsed] = createSignal(false)

  const initialDirectory = decode64(params.dir)
  const route = createMemo(() => {
    const slug = params.dir
    if (!slug) return { slug, dir: "" }
    const dir = decode64(slug)
    if (!dir) return { slug, dir: "" }
    return {
      slug,
      dir: globalSync.peek(dir, { bootstrap: false })[0].path.directory || dir,
    }
  })
  const availableThemeEntries = createMemo(() => theme.ids().map((id) => [id, theme.themes()[id]] as const))
  const colorSchemeOrder: ColorScheme[] = ["system", "light", "dark"]
  const colorSchemeKey: Record<ColorScheme, "theme.scheme.system" | "theme.scheme.light" | "theme.scheme.dark"> = {
    system: "theme.scheme.system",
    light: "theme.scheme.light",
    dark: "theme.scheme.dark",
  }
  const colorSchemeLabel = (scheme: ColorScheme) => language.t(colorSchemeKey[scheme])
  const currentDir = createMemo(() => route().dir)

  const [state, setState] = createStore({
    autoselect: !initialDirectory,
    busyWorkspaces: {} as Record<string, boolean>,
    hoverProject: undefined as string | undefined,
    scrollSessionKey: undefined as string | undefined,
    nav: undefined as HTMLElement | undefined,
    sortNow: Date.now(),
    sizing: false,
    peek: undefined as string | undefined,
    peeked: false,
  })

  const editor = createInlineEditorController()
  const setBusy = (directory: string, value: boolean) => {
    const key = workspaceKey(directory)
    if (value) {
      setState("busyWorkspaces", key, true)
      return
    }
    setState(
      "busyWorkspaces",
      produce((draft) => {
        delete draft[key]
      }),
    )
  }
  const isBusy = (directory: string) => !!state.busyWorkspaces[workspaceKey(directory)]
  const navLeave = { current: undefined as number | undefined }
  const collapseTimer = { current: undefined as number | undefined }
  const sortNow = () => state.sortNow
  let sizet: number | undefined
  let sortNowInterval: ReturnType<typeof setInterval> | undefined
  const sortNowTimeout = setTimeout(
    () => {
      setState("sortNow", Date.now())
      sortNowInterval = setInterval(() => setState("sortNow", Date.now()), 60_000)
    },
    60_000 - (Date.now() % 60_000),
  )

  const aim = createAim({
    enabled: () => !layout.sidebar.opened(),
    active: () => state.hoverProject,
    el: () => state.nav?.querySelector<HTMLElement>("[data-component='sidebar-rail']") ?? state.nav,
    onActivate: (directory) => {
      globalSync.child(directory)
      setState("hoverProject", directory)
    },
  })

  onCleanup(() => {
    dialogDead = true
    dialogRun += 1
    if (navLeave.current !== undefined) clearTimeout(navLeave.current)
    if (collapseTimer.current !== undefined) clearTimeout(collapseTimer.current)
    clearTimeout(sortNowTimeout)
    if (sortNowInterval) clearInterval(sortNowInterval)
    if (sizet !== undefined) clearTimeout(sizet)
    if (peekt !== undefined) clearTimeout(peekt)
    aim.reset()
  })

  onMount(() => {
    const stop = () => setState("sizing", false)
    const blur = () => reset()
    const hide = () => {
      if (document.visibilityState !== "hidden") return
      reset()
    }
    makeEventListener(window, "pointerup", stop)
    makeEventListener(window, "pointercancel", stop)
    makeEventListener(window, "blur", stop)
    makeEventListener(window, "blur", blur)
    makeEventListener(document, "visibilitychange", hide)
  })

  const sidebarHovering = createMemo(() => !layout.sidebar.opened() && state.hoverProject !== undefined)
  const sidebarExpanded = createMemo(() => layout.sidebar.opened() || sidebarHovering())
  const setHoverProject = (value: string | undefined) => {
    setState("hoverProject", value)
    if (value !== undefined) return
    aim.reset()
  }
  const clearHoverProjectSoon = () => queueMicrotask(() => setHoverProject(undefined))

  const disarm = () => {
    if (navLeave.current === undefined) return
    clearTimeout(navLeave.current)
    navLeave.current = undefined
  }

  const reset = () => {
    disarm()
    setHoverProject(undefined)
  }

  const arm = () => {
    if (layout.sidebar.opened()) return
    if (state.hoverProject === undefined) return
    disarm()
    navLeave.current = window.setTimeout(() => {
      navLeave.current = undefined
      setHoverProject(undefined)
    }, 300)
  }

  const disarmCollapse = () => {
    if (collapseTimer.current === undefined) return
    clearTimeout(collapseTimer.current)
    collapseTimer.current = undefined
  }

  const armCollapse = () => {
    // Sidebar only collapses via explicit button click, not on mouse-leave
  }

  let peekt: number | undefined

  const hoverProjectData = createMemo(() => {
    const id = state.hoverProject
    if (!id) return
    return layout.projects.list().find((project) => project.worktree === id)
  })

  const peekProject = createMemo(() => {
    const id = state.peek
    if (!id) return
    return layout.projects.list().find((project) => project.worktree === id)
  })

  createEffect(() => {
    const p = hoverProjectData()
    if (p) {
      if (peekt !== undefined) {
        clearTimeout(peekt)
        peekt = undefined
      }
      setState("peek", p.worktree)
      setState("peeked", true)
      return
    }

    setState("peeked", false)
    if (state.peek === undefined) return
    if (peekt !== undefined) clearTimeout(peekt)
    peekt = window.setTimeout(() => {
      peekt = undefined
      setState("peek", undefined)
    }, 180)
  })

  createEffect(() => {
    if (!layout.sidebar.opened()) return
    setHoverProject(undefined)
  })


  createEffect(() => {
    if (!state.autoselect) return
    const dir = params.dir
    if (!dir) return
    const directory = decode64(dir)
    if (!directory) return
    setState("autoselect", false)
  })

  const editorOpen = editor.editorOpen
  const openEditor = editor.openEditor
  const closeEditor = editor.closeEditor
  const setEditor = editor.setEditor
  const InlineEditor = editor.InlineEditor

  const clearSidebarHoverState = () => {
    if (layout.sidebar.opened()) return
    reset()
  }

  const navigateWithSidebarReset = (href: string) => {
    clearSidebarHoverState()
    navigate(href)
    layout.mobileSidebar.hide()
  }

  function cycleTheme(direction = 1) {
    const ids = availableThemeEntries().map(([id]) => id)
    if (ids.length === 0) return
    const currentIndex = ids.indexOf(theme.themeId())
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + direction + ids.length) % ids.length
    const nextThemeId = ids[nextIndex]
    theme.setTheme(nextThemeId)
    showToast({
      title: language.t("toast.theme.title"),
      description: theme.name(nextThemeId),
    })
  }

  function cycleColorScheme(direction = 1) {
    const current = theme.colorScheme()
    const currentIndex = colorSchemeOrder.indexOf(current)
    const nextIndex =
      currentIndex === -1 ? 0 : (currentIndex + direction + colorSchemeOrder.length) % colorSchemeOrder.length
    const next = colorSchemeOrder[nextIndex]
    theme.setColorScheme(next)
    showToast({
      title: language.t("toast.scheme.title"),
      description: colorSchemeLabel(next),
    })
  }

  function setLocale(next: Locale) {
    if (next === language.locale()) return
    language.setLocale(next)
    showToast({
      title: language.t("toast.language.title"),
      description: language.t("toast.language.description", { language: language.label(next) }),
    })
  }

  function cycleLanguage(direction = 1) {
    const locales = language.locales
    const currentIndex = locales.indexOf(language.locale())
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + direction + locales.length) % locales.length
    const next = locales[nextIndex]
    if (!next) return
    setLocale(next)
  }

  const useUpdatePolling = () =>
    onMount(() => {
      if (!platform.checkUpdate || !platform.update || !platform.restart) return

      let toastId: number | undefined
      let interval: ReturnType<typeof setInterval> | undefined

      const pollUpdate = () =>
        platform.checkUpdate!().then(({ updateAvailable, version }) => {
          if (!updateAvailable) return
          if (toastId !== undefined) return
          toastId = showToast({
            persistent: true,
            icon: "download",
            title: language.t("toast.update.title"),
            description: language.t("toast.update.description", { version: version ?? "" }),
            actions: [
              {
                label: language.t("toast.update.action.installRestart"),
                onClick: async () => {
                  await platform.update!()
                  await platform.restart!()
                },
              },
              {
                label: language.t("toast.update.action.notYet"),
                onClick: "dismiss",
              },
            ],
          })
        })

      createEffect(() => {
        if (!settings.ready()) return

        if (!settings.updates.startup()) {
          if (interval === undefined) return
          clearInterval(interval)
          interval = undefined
          return
        }

        if (interval !== undefined) return
        void pollUpdate()
        interval = setInterval(pollUpdate, 10 * 60 * 1000)
      })

      onCleanup(() => {
        if (interval === undefined) return
        clearInterval(interval)
      })
    })

  const useSDKNotificationToasts = () =>
    onMount(() => {
      const toastBySession = new Map<string, number>()
      const alertedAtBySession = new Map<string, number>()
      const cooldownMs = 5000

      const dismissSessionAlert = (sessionKey: string) => {
        const toastId = toastBySession.get(sessionKey)
        if (toastId === undefined) return
        toaster.dismiss(toastId)
        toastBySession.delete(sessionKey)
        alertedAtBySession.delete(sessionKey)
      }

      const unsub = globalSDK.event.listen((e) => {
        if (e.details?.type === "worktree.ready") {
          setBusy(e.name, false)
          WorktreeState.ready(e.name)
          return
        }

        if (e.details?.type === "worktree.failed") {
          setBusy(e.name, false)
          WorktreeState.failed(e.name, e.details.properties?.message ?? language.t("common.requestFailed"))
          return
        }

        if (
          e.details?.type === "question.replied" ||
          e.details?.type === "question.rejected" ||
          e.details?.type === "permission.replied"
        ) {
          const props = e.details.properties as { sessionID: string }
          const sessionKey = `${e.name}:${props.sessionID}`
          dismissSessionAlert(sessionKey)
          return
        }

        if (e.details?.type !== "permission.asked" && e.details?.type !== "question.asked") return
        const title =
          e.details.type === "permission.asked"
            ? language.t("notification.permission.title")
            : language.t("notification.question.title")
        const icon = e.details.type === "permission.asked" ? ("checklist" as const) : ("bubble-5" as const)
        const directory = e.name
        const props = e.details.properties
        if (e.details.type === "permission.asked" && permission.autoResponds(e.details.properties, directory)) return

        const [store] = globalSync.child(directory, { bootstrap: false })
        const session = store.session.find((s) => s.id === props.sessionID)
        const sessionKey = `${directory}:${props.sessionID}`

        const sessionTitle = session?.title ?? language.t("command.session.new")
        const projectName = getFilename(directory)
        const description =
          e.details.type === "permission.asked"
            ? language.t("notification.permission.description", { sessionTitle, projectName })
            : language.t("notification.question.description", { sessionTitle, projectName })
        const href = `/${base64Encode(directory)}/session/${props.sessionID}`

        const now = Date.now()
        const lastAlerted = alertedAtBySession.get(sessionKey) ?? 0
        if (now - lastAlerted < cooldownMs) return
        alertedAtBySession.set(sessionKey, now)

        if (e.details.type === "permission.asked") {
          if (settings.sounds.permissionsEnabled()) {
            void playSoundById(settings.sounds.permissions())
          }
          if (settings.notifications.permissions()) {
            void platform.notify(title, description, href)
          }
        }

        if (e.details.type === "question.asked") {
          if (settings.notifications.agent()) {
            void platform.notify(title, description, href)
          }
        }

        const currentSession = params.id
        if (workspaceKey(directory) === workspaceKey(currentDir()) && props.sessionID === currentSession) return
        if (workspaceKey(directory) === workspaceKey(currentDir()) && session?.parentID === currentSession) return

        dismissSessionAlert(sessionKey)

        const toastId = showToast({
          persistent: true,
          icon,
          title,
          description,
          actions: [
            {
              label: language.t("notification.action.goToSession"),
              onClick: () => navigate(href),
            },
            {
              label: language.t("common.dismiss"),
              onClick: "dismiss",
            },
          ],
        })
        toastBySession.set(sessionKey, toastId)
      })
      onCleanup(unsub)

      createEffect(() => {
        const currentSession = params.id
        if (!currentDir() || !currentSession) return
        const sessionKey = `${currentDir()}:${currentSession}`
        dismissSessionAlert(sessionKey)
        const [store] = globalSync.child(currentDir(), { bootstrap: false })
        const childSessions = store.session.filter((s) => s.parentID === currentSession)
        for (const child of childSessions) {
          dismissSessionAlert(`${currentDir()}:${child.id}`)
        }
      })
    })

  useUpdatePolling()
  useSDKNotificationToasts()

  function scrollToSession(sessionId: string, sessionKey: string) {
    if (!scrollContainerRef) return
    if (state.scrollSessionKey === sessionKey) return
    const element = scrollContainerRef.querySelector(`[data-session-id="${sessionId}"]`)
    if (!element) return
    const containerRect = scrollContainerRef.getBoundingClientRect()
    const elementRect = element.getBoundingClientRect()
    if (elementRect.top >= containerRect.top && elementRect.bottom <= containerRect.bottom) {
      setState("scrollSessionKey", sessionKey)
      return
    }
    setState("scrollSessionKey", sessionKey)
    element.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }

  const currentProject = createMemo(() => {
    const directory = currentDir()
    if (!directory) return
    const key = workspaceKey(directory)

    const projects = layout.projects.list()

    const sandbox = projects.find((p) => p.sandboxes?.some((item) => workspaceKey(item) === key))
    if (sandbox) return sandbox

    const direct = projects.find((p) => workspaceKey(p.worktree) === key)
    if (direct) return direct

    const [child] = globalSync.child(directory, { bootstrap: false })
    const id = child.project
    if (!id) return

    const meta = globalSync.data.project.find((p) => p.id === id)
    const root = meta?.worktree
    if (!root) return

    return projects.find((p) => p.worktree === root)
  })

  const [autoselecting] = createResource(async () => {
    await ready.promise
    await layout.ready.promise
    if (!untrack(() => state.autoselect)) return
    if (routeLocation.pathname === "/admin") return

    const list = layout.projects.list()
    const last = server.projects.last()

    if (list.length === 0) {
      if (!last) return
      await openProject(last, true)
    } else {
      const next = list.find((project) => project.worktree === last) ?? list[0]
      if (!next) return
      await openProject(next.worktree, true)
    }
  })

  const workspaceName = (directory: string, projectId?: string, branch?: string) => {
    const key = workspaceKey(directory)
    const direct = store.workspaceName[key] ?? store.workspaceName[directory]
    if (direct) return direct
    if (!projectId) return
    if (!branch) return
    return store.workspaceBranchName[projectId]?.[branch]
  }

  const setWorkspaceName = (directory: string, next: string, projectId?: string, branch?: string) => {
    const key = workspaceKey(directory)
    setStore("workspaceName", key, next)
    if (!projectId) return
    if (!branch) return
    if (!store.workspaceBranchName[projectId]) {
      setStore("workspaceBranchName", projectId, {})
    }
    setStore("workspaceBranchName", projectId, branch, next)
  }

  const workspaceLabel = (directory: string, branch?: string, projectId?: string) =>
    workspaceName(directory, projectId, branch) ?? branch ?? getFilename(directory)

  const workspaceSetting = createMemo(() => {
    const project = currentProject()
    if (!project) return false
    if (project.vcs !== "git") return false
    return layout.sidebar.workspaces(project.worktree)()
  })

  const visibleSessionDirs = createMemo(() => {
    const project = currentProject()
    if (!project) return [] as string[]
    if (!workspaceSetting()) return [project.worktree]

    const activeDir = currentDir()
    return workspaceIds(project).filter((directory) => {
      const expanded = store.workspaceExpanded[directory] ?? directory === project.worktree
      const active = workspaceKey(directory) === workspaceKey(activeDir)
      return expanded || active
    })
  })

  createEffect(() => {
    if (!pageReady()) return
    if (!layoutReady()) return
    const projects = layout.projects.list()
    for (const [directory, expanded] of Object.entries(store.workspaceExpanded)) {
      if (!expanded) continue
      const key = workspaceKey(directory)
      const project = projects.find(
        (item) =>
          workspaceKey(item.worktree) === key || item.sandboxes?.some((sandbox) => workspaceKey(sandbox) === key),
      )
      if (!project) continue
      if (project.vcs === "git" && layout.sidebar.workspaces(project.worktree)()) continue
      setStore("workspaceExpanded", directory, false)
    }
  })

  const currentSessions = createMemo(() => {
    const now = Date.now()
    const dirs = visibleSessionDirs()
    if (dirs.length === 0) return [] as Session[]

    const result: Session[] = []
    for (const dir of dirs) {
      const [dirStore] = globalSync.child(dir, { bootstrap: true })
      const dirSessions = sortedRootSessions(dirStore, now)
      result.push(...dirSessions)
    }
    return result
  })

  type PrefetchQueue = {
    inflight: Set<string>
    pending: string[]
    pendingSet: Set<string>
    running: number
  }

  const prefetchChunk = 200
  const prefetchConcurrency = 2
  const prefetchPendingLimit = 10
  const span = 4
  const prefetchToken = { value: 0 }
  const prefetchQueues = new Map<string, PrefetchQueue>()

  const PREFETCH_MAX_SESSIONS_PER_DIR = 10
  const prefetchedByDir = new Map<string, Set<string>>()

  const lruFor = (directory: string) => {
    const existing = prefetchedByDir.get(directory)
    if (existing) return existing
    const created = new Set<string>()
    prefetchedByDir.set(directory, created)
    return created
  }

  const markPrefetched = (directory: string, sessionID: string) => {
    const lru = lruFor(directory)
    return pickSessionCacheEvictions({
      seen: lru,
      keep: sessionID,
      limit: PREFETCH_MAX_SESSIONS_PER_DIR,
      preserve: params.id && workspaceKey(directory) === workspaceKey(currentDir()) ? [params.id] : undefined,
    })
  }

  createEffect(() => {
    const active = new Set(visibleSessionDirs())
    for (const directory of [...prefetchedByDir.keys()]) {
      if (active.has(directory)) continue
      prefetchedByDir.delete(directory)
    }
  })

  createEffect(() => {
    route()
    globalSDK.url

    prefetchToken.value += 1
    clearSessionPrefetchInflight()
    prefetchQueues.clear()
  })

  createEffect(() => {
    const visible = new Set(visibleSessionDirs())
    for (const [directory, q] of prefetchQueues) {
      if (visible.has(directory)) continue
      q.pending.length = 0
      q.pendingSet.clear()
      if (q.running === 0) prefetchQueues.delete(directory)
    }
  })

  const queueFor = (directory: string) => {
    const existing = prefetchQueues.get(directory)
    if (existing) return existing

    const created: PrefetchQueue = {
      inflight: new Set(),
      pending: [],
      pendingSet: new Set(),
      running: 0,
    }
    prefetchQueues.set(directory, created)
    return created
  }

  const mergeByID = <T extends { id: string }>(current: T[], incoming: T[]) => {
    if (current.length === 0) {
      return incoming.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    }

    const map = new Map<string, T>()
    for (const item of current) {
      map.set(item.id, item)
    }
    for (const item of incoming) {
      map.set(item.id, item)
    }
    return [...map.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }

  async function prefetchMessages(directory: string, sessionID: string, token: number) {
    const [store, setStore] = globalSync.child(directory, { bootstrap: false })

    return runSessionPrefetch({
      directory,
      sessionID,
      task: (rev) =>
        retry(() => globalSDK.client.session.messages({ directory, sessionID, limit: prefetchChunk }))
          .then((messages) => {
            if (prefetchToken.value !== token) return
            if (!isSessionPrefetchCurrent(directory, sessionID, rev)) return

            const items = (messages.data ?? []).filter((x) => !!x?.info?.id)
            const next = items.map((x) => x.info).filter((m): m is Message => !!m?.id)
            const sorted = mergeByID([], next)
            const stale = markPrefetched(directory, sessionID)
            const cursor = messages.response.headers.get("x-next-cursor") ?? undefined
            const meta = {
              limit: sorted.length,
              cursor,
              complete: !cursor,
              at: Date.now(),
            }

            if (stale.length > 0) {
              clearSessionPrefetch(directory, stale)
              for (const id of stale) {
                globalSync.todo.set(id, undefined)
              }
            }

            const current = store.message[sessionID] ?? []
            const merged = mergeByID(
              current.filter((item): item is Message => !!item?.id),
              sorted,
            )

            if (!isSessionPrefetchCurrent(directory, sessionID, rev)) return

            batch(() => {
              if (stale.length > 0) {
                setStore(
                  produce((draft) => {
                    dropSessionCaches(draft, stale)
                  }),
                )
              }

              setStore("message", sessionID, reconcile(merged, { key: "id" }))
              setSessionPrefetch({ directory, sessionID, ...meta })

              for (const message of items) {
                const currentParts = store.part[message.info.id] ?? []
                const mergedParts = mergeByID(
                  currentParts.filter((item): item is (typeof currentParts)[number] & { id: string } => !!item?.id),
                  message.parts.filter((item): item is (typeof message.parts)[number] & { id: string } => !!item?.id),
                )

                setStore("part", message.info.id, reconcile(mergedParts, { key: "id" }))
              }
            })

            return meta
          })
          .catch(() => undefined),
    })
  }

  const pumpPrefetch = (directory: string) => {
    const q = queueFor(directory)
    if (q.running >= prefetchConcurrency) return

    const sessionID = q.pending.shift()
    if (!sessionID) return

    q.pendingSet.delete(sessionID)
    q.inflight.add(sessionID)
    q.running += 1

    const token = prefetchToken.value

    void prefetchMessages(directory, sessionID, token).finally(() => {
      q.running -= 1
      q.inflight.delete(sessionID)
      pumpPrefetch(directory)
    })
  }

  const prefetchSession = (session: Session, priority: "high" | "low" = "low") => {
    const directory = session.directory
    if (!directory) return

    const [store] = globalSync.child(directory, { bootstrap: false })
    const cached = untrack(() => {
      const info = getSessionPrefetch(directory, session.id)
      return shouldSkipSessionPrefetch({
        message: store.message[session.id] !== undefined,
        info,
        chunk: prefetchChunk,
      })
    })
    if (cached) return

    const q = queueFor(directory)
    if (q.inflight.has(session.id)) return
    if (q.pendingSet.has(session.id)) {
      if (priority !== "high") return
      const index = q.pending.indexOf(session.id)
      if (index > 0) {
        q.pending.splice(index, 1)
        q.pending.unshift(session.id)
      }
      return
    }

    const lru = lruFor(directory)
    const known = lru.has(session.id)
    if (!known && lru.size >= PREFETCH_MAX_SESSIONS_PER_DIR && priority !== "high") return

    if (priority === "high") q.pending.unshift(session.id)
    if (priority !== "high") q.pending.push(session.id)
    q.pendingSet.add(session.id)

    while (q.pending.length > prefetchPendingLimit) {
      const dropped = q.pending.pop()
      if (!dropped) continue
      q.pendingSet.delete(dropped)
    }

    pumpPrefetch(directory)
  }

  const warm = (sessions: Session[], index: number) => {
    for (let offset = 1; offset <= span; offset++) {
      const next = sessions[index + offset]
      if (next) prefetchSession(next, offset === 1 ? "high" : "low")

      const prev = sessions[index - offset]
      if (prev) prefetchSession(prev, offset === 1 ? "high" : "low")
    }
  }

  createEffect(() => {
    const sessions = currentSessions()
    if (sessions.length === 0) return

    const index = params.id ? sessions.findIndex((s) => s.id === params.id) : 0
    if (index === -1) return

    if (!params.id) {
      const first = sessions[index]
      if (first) prefetchSession(first, "high")
    }

    warm(sessions, index)
  })

  function navigateSessionByOffset(offset: number) {
    const sessions = currentSessions()
    if (sessions.length === 0) return

    const sessionIndex = params.id ? sessions.findIndex((s) => s.id === params.id) : -1

    let targetIndex: number
    if (sessionIndex === -1) {
      targetIndex = offset > 0 ? 0 : sessions.length - 1
    } else {
      targetIndex = (sessionIndex + offset + sessions.length) % sessions.length
    }

    const session = sessions[targetIndex]
    if (!session) return

    prefetchSession(session, "high")
    warm(sessions, targetIndex)

    navigateToSession(session)
  }

  function navigateProjectByOffset(offset: number) {
    const projects = layout.projects.list()
    if (projects.length === 0) return

    const current = currentProject()?.worktree
    const fallback = currentDir() ? projectRoot(currentDir()) : undefined
    const active = current ?? fallback
    const index = active ? projects.findIndex((project) => project.worktree === active) : -1

    const target =
      index === -1
        ? offset > 0
          ? projects[0]
          : projects[projects.length - 1]
        : projects[(index + offset + projects.length) % projects.length]
    if (!target) return

    // warm up child store to prevent flicker
    globalSync.child(target.worktree)
    openProject(target.worktree)
  }

  function navigateSessionByUnseen(offset: number) {
    const sessions = currentSessions()
    if (sessions.length === 0) return

    const hasUnseen = sessions.some((session) => notification.session.unseenCount(session.id) > 0)
    if (!hasUnseen) return

    const activeIndex = params.id ? sessions.findIndex((s) => s.id === params.id) : -1
    const start = activeIndex === -1 ? (offset > 0 ? -1 : 0) : activeIndex

    for (let i = 1; i <= sessions.length; i++) {
      const index = offset > 0 ? (start + i) % sessions.length : (start - i + sessions.length) % sessions.length
      const session = sessions[index]
      if (!session) continue
      if (notification.session.unseenCount(session.id) === 0) continue

      prefetchSession(session, "high")
      warm(sessions, index)

      navigateToSession(session)
      return
    }
  }

  async function archiveSession(session: Session) {
    const [store, setStore] = globalSync.child(session.directory)
    const sessions = store.session ?? []
    const index = sessions.findIndex((s) => s.id === session.id)
    const nextSession = sessions[index + 1] ?? sessions[index - 1]

    await globalSDK.client.session.update({
      directory: session.directory,
      sessionID: session.id,
      time: { archived: Date.now() },
    })
    setStore(
      produce((draft) => {
        const match = Binary.search(draft.session, session.id, (s) => s.id)
        if (match.found) draft.session.splice(match.index, 1)
      }),
    )
    if (session.id === params.id) {
      if (nextSession) {
        navigate(`/${params.dir}/session/${nextSession.id}`)
      } else {
        navigate(`/${params.dir}/session`)
      }
    }
  }

  command.register("layout", () => {
    const commands: CommandOption[] = [
      {
        id: "sidebar.toggle",
        title: language.t("command.sidebar.toggle"),
        category: language.t("command.category.view"),
        keybind: "mod+b",
        onSelect: () => layout.sidebar.toggle(),
      },
      {
        id: "project.open",
        title: language.t("command.project.open"),
        category: language.t("command.category.project"),
        keybind: "mod+o",
        onSelect: () => chooseProject(),
      },
      {
        id: "project.create",
        title: "Create New KB",
        category: language.t("command.category.project"),
        onSelect: () => createNewKB(),
      },
      {
        id: "project.previous",
        title: language.t("command.project.previous"),
        category: language.t("command.category.project"),
        keybind: "mod+alt+arrowup",
        onSelect: () => navigateProjectByOffset(-1),
      },
      {
        id: "project.next",
        title: language.t("command.project.next"),
        category: language.t("command.category.project"),
        keybind: "mod+alt+arrowdown",
        onSelect: () => navigateProjectByOffset(1),
      },
      {
        id: "provider.connect",
        title: language.t("command.provider.connect"),
        category: language.t("command.category.provider"),
        onSelect: () => connectProvider(),
      },
      {
        id: "server.switch",
        title: language.t("command.server.switch"),
        category: language.t("command.category.server"),
        onSelect: () => openServer(),
      },
      {
        id: "settings.open",
        title: language.t("command.settings.open"),
        category: language.t("command.category.settings"),
        keybind: "mod+comma",
        onSelect: () => openSettings(),
      },
      {
        id: "session.previous",
        title: language.t("command.session.previous"),
        category: language.t("command.category.session"),
        keybind: "alt+arrowup",
        onSelect: () => navigateSessionByOffset(-1),
      },
      {
        id: "session.next",
        title: language.t("command.session.next"),
        category: language.t("command.category.session"),
        keybind: "alt+arrowdown",
        onSelect: () => navigateSessionByOffset(1),
      },
      {
        id: "session.previous.unseen",
        title: language.t("command.session.previous.unseen"),
        category: language.t("command.category.session"),
        keybind: "shift+alt+arrowup",
        onSelect: () => navigateSessionByUnseen(-1),
      },
      {
        id: "session.next.unseen",
        title: language.t("command.session.next.unseen"),
        category: language.t("command.category.session"),
        keybind: "shift+alt+arrowdown",
        onSelect: () => navigateSessionByUnseen(1),
      },
      {
        id: "session.archive",
        title: language.t("command.session.archive"),
        category: language.t("command.category.session"),
        keybind: "mod+shift+backspace",
        disabled: !params.dir || !params.id,
        onSelect: () => {
          const session = currentSessions().find((s) => s.id === params.id)
          if (session) archiveSession(session)
        },
      },
      {
        id: "workspace.new",
        title: language.t("workspace.new"),
        category: language.t("command.category.workspace"),
        keybind: "mod+shift+w",
        disabled: !workspaceSetting(),
        onSelect: () => {
          const project = currentProject()
          if (!project) return
          return createWorkspace(project)
        },
      },
      {
        id: "workspace.toggle",
        title: language.t("command.workspace.toggle"),
        description: language.t("command.workspace.toggle.description"),
        category: language.t("command.category.workspace"),
        disabled: !currentProject() || currentProject()?.vcs !== "git",
        onSelect: () => {
          const project = currentProject()
          if (!project) return
          if (project.vcs !== "git") return
          const wasEnabled = layout.sidebar.workspaces(project.worktree)()
          layout.sidebar.toggleWorkspaces(project.worktree)
          showToast({
            title: wasEnabled
              ? language.t("toast.workspace.disabled.title")
              : language.t("toast.workspace.enabled.title"),
            description: wasEnabled
              ? language.t("toast.workspace.disabled.description")
              : language.t("toast.workspace.enabled.description"),
          })
        },
      },
      {
        id: "theme.cycle",
        title: language.t("command.theme.cycle"),
        category: language.t("command.category.theme"),
        keybind: "mod+shift+t",
        onSelect: () => cycleTheme(1),
      },
    ]

    for (const [id] of availableThemeEntries()) {
      commands.push({
        id: `theme.set.${id}`,
        title: language.t("command.theme.set", { theme: theme.name(id) }),
        category: language.t("command.category.theme"),
        onSelect: () => theme.commitPreview(),
        onHighlight: () => {
          theme.previewTheme(id)
          return () => theme.cancelPreview()
        },
      })
    }

    commands.push({
      id: "theme.scheme.cycle",
      title: language.t("command.theme.scheme.cycle"),
      category: language.t("command.category.theme"),
      keybind: "mod+shift+s",
      onSelect: () => cycleColorScheme(1),
    })

    for (const scheme of colorSchemeOrder) {
      commands.push({
        id: `theme.scheme.${scheme}`,
        title: language.t("command.theme.scheme.set", { scheme: colorSchemeLabel(scheme) }),
        category: language.t("command.category.theme"),
        onSelect: () => theme.commitPreview(),
        onHighlight: () => {
          theme.previewColorScheme(scheme)
          return () => theme.cancelPreview()
        },
      })
    }

    commands.push({
      id: "language.cycle",
      title: language.t("command.language.cycle"),
      category: language.t("command.category.language"),
      onSelect: () => cycleLanguage(1),
    })

    for (const locale of language.locales) {
      commands.push({
        id: `language.set.${locale}`,
        title: language.t("command.language.set", { language: language.label(locale) }),
        category: language.t("command.category.language"),
        onSelect: () => setLocale(locale),
      })
    }

    return commands
  })

  function connectProvider() {
    const run = ++dialogRun
    void import("@/components/dialog-select-provider").then((x) => {
      if (dialogDead || dialogRun !== run) return
      dialog.show(() => <x.DialogSelectProvider />)
    })
  }

  function openServer() {
    const run = ++dialogRun
    void import("@/components/dialog-select-server").then((x) => {
      if (dialogDead || dialogRun !== run) return
      dialog.show(() => <x.DialogSelectServer />)
    })
  }

  function openSettings() {
    const run = ++dialogRun
    void import("@/components/dialog-settings").then((x) => {
      if (dialogDead || dialogRun !== run) return
      dialog.show(() => <x.DialogSettings />)
    })
  }

  function projectRoot(directory: string) {
    const key = workspaceKey(directory)
    const project = layout.projects
      .list()
      .find(
        (item) =>
          workspaceKey(item.worktree) === key || item.sandboxes?.some((sandbox) => workspaceKey(sandbox) === key),
      )
    if (project) return project.worktree

    const known = Object.entries(store.workspaceOrder).find(
      ([root, dirs]) => workspaceKey(root) === key || dirs.some((item) => workspaceKey(item) === key),
    )
    if (known) return known[0]

    const [child] = globalSync.child(directory, { bootstrap: false })
    const id = child.project
    if (!id) return directory

    const meta = globalSync.data.project.find((item) => item.id === id)
    return meta?.worktree ?? directory
  }

  function activeProjectRoot(directory: string) {
    return currentProject()?.worktree ?? projectRoot(directory)
  }

  function rememberSessionRoute(directory: string, id: string, root = activeProjectRoot(directory)) {
    setStore("lastProjectSession", root, { directory, id, at: Date.now() })
    return root
  }

  function clearLastProjectSession(root: string) {
    if (!store.lastProjectSession[root]) return
    setStore(
      "lastProjectSession",
      produce((draft) => {
        delete draft[root]
      }),
    )
  }

  function syncSessionRoute(directory: string, id: string, root = activeProjectRoot(directory)) {
    rememberSessionRoute(directory, id, root)
    notification.session.markViewed(id)
    const expanded = untrack(() => store.workspaceExpanded[directory])
    if (expanded === false) {
      setStore("workspaceExpanded", directory, true)
    }
    requestAnimationFrame(() => scrollToSession(id, `${directory}:${id}`))
    return root
  }

  async function navigateToProject(directory: string | undefined) {
    if (!directory) return
    const root = projectRoot(directory)
    server.projects.touch(root)
    const project = layout.projects.list().find((item) => item.worktree === root)
    let dirs = project
      ? effectiveWorkspaceOrder(root, [root, ...(project.sandboxes ?? [])], store.workspaceOrder[root])
      : [root]
    const canOpen = (value: string | undefined) => {
      if (!value) return false
      return dirs.some((item) => workspaceKey(item) === workspaceKey(value))
    }
    const refreshDirs = async (target?: string) => {
      if (!target || target === root || canOpen(target)) return canOpen(target)
      const listed = await globalSDK.client.worktree
        .list({ directory: root })
        .then((x) => x.data ?? [])
        .catch(() => [] as string[])
      dirs = effectiveWorkspaceOrder(root, [root, ...listed], store.workspaceOrder[root])
      return canOpen(target)
    }
    const openSession = async (target: { directory: string; id: string }) => {
      if (!canOpen(target.directory)) return false
      const [data] = globalSync.child(target.directory, { bootstrap: false })
      if (data.session.some((item) => item.id === target.id)) {
        setStore("lastProjectSession", root, { directory: target.directory, id: target.id, at: Date.now() })
        navigateWithSidebarReset(`/${base64Encode(target.directory)}/session/${target.id}`)
        return true
      }
      const resolved = await globalSDK.client.session
        .get({ sessionID: target.id })
        .then((x) => x.data)
        .catch(() => undefined)
      if (!resolved?.directory) return false
      if (!canOpen(resolved.directory)) return false
      setStore("lastProjectSession", root, { directory: resolved.directory, id: resolved.id, at: Date.now() })
      navigateWithSidebarReset(`/${base64Encode(resolved.directory)}/session/${resolved.id}`)
      return true
    }

    const projectSession = store.lastProjectSession[root]
    if (projectSession?.id) {
      await refreshDirs(projectSession.directory)
      const opened = await openSession(projectSession)
      if (opened) return
      clearLastProjectSession(root)
    }

    const latest = latestRootSession(
      dirs.map((item) => globalSync.child(item, { bootstrap: false })[0]),
      Date.now(),
    )
    if (latest && (await openSession(latest))) {
      return
    }

    const fetched = latestRootSession(
      await Promise.all(
        dirs.map(async (item) => ({
          path: { directory: item },
          session: await globalSDK.client.session
            .list({ directory: item })
            .then((x) => x.data ?? [])
            .catch(() => []),
        })),
      ),
      Date.now(),
    )
    if (fetched && (await openSession(fetched))) {
      return
    }

    navigateWithSidebarReset(`/${base64Encode(root)}/session`)
  }

  function navigateToSession(session: Session | undefined) {
    if (!session) return
    navigateWithSidebarReset(`/${base64Encode(session.directory)}/session/${session.id}`)
  }

  function openProject(directory: string, navigate = true) {
    layout.projects.open(directory)
    if (navigate) return navigateToProject(directory)
  }

  const handleDeepLinks = (urls: string[]) => {
    if (!server.isLocal()) return

    for (const directory of collectOpenProjectDeepLinks(urls)) {
      openProject(directory)
    }

    for (const link of collectNewSessionDeepLinks(urls)) {
      openProject(link.directory, false)
      const slug = base64Encode(link.directory)
      if (link.prompt) {
        setSessionHandoff(slug, { prompt: link.prompt })
      }
      const href = link.prompt ? `/${slug}/session?prompt=${encodeURIComponent(link.prompt)}` : `/${slug}/session`
      navigateWithSidebarReset(href)
    }
  }

  onMount(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ urls: string[] }>).detail
      const urls = detail?.urls ?? []
      if (urls.length === 0) return
      handleDeepLinks(urls)
    }

    handleDeepLinks(drainPendingDeepLinks(window))
    makeEventListener(window, deepLinkEvent, handler as EventListener)
  })

  async function renameProject(project: LocalProject, next: string) {
    const current = displayName(project)
    if (next === current) return
    const name = next === getFilename(project.worktree) ? "" : next

    if (project.id && project.id !== "global") {
      await globalSDK.client.project.update({ projectID: project.id, directory: project.worktree, name })
      return
    }

    globalSync.project.meta(project.worktree, { name })
  }

  const renameWorkspace = async (directory: string, next: string, projectId?: string, branch?: string) => {
    const trimmed = next.trim()
    const current = workspaceName(directory, projectId, branch) ?? branch ?? getFilename(directory)
    if (current === trimmed) return

    const allProjects = layout.projects.list()
    const isDuplicate = allProjects.some(
      (p) => workspaceKey(p.worktree) !== workspaceKey(directory) && displayName(p) === trimmed,
    )
    if (isDuplicate) {
      showToast({ title: "A workspace with that name already exists" })
      return
    }

    setWorkspaceName(directory, trimmed, projectId, branch)

    const project = allProjects.find((p) => workspaceKey(p.worktree) === workspaceKey(directory))
    if (project?.id && project.id !== "global") {
      await globalSDK.client.project.update({ projectID: project.id, directory, name: trimmed })
    }
  }

  function closeProject(directory: string) {
    const list = layout.projects.list()
    const key = workspaceKey(directory)
    const index = list.findIndex((x) => workspaceKey(x.worktree) === key)
    const active = workspaceKey(currentProject()?.worktree ?? "") === key
    if (index === -1) return
    const next = list[index + 1]

    if (!active) {
      layout.projects.close(directory)
      return
    }

    if (!next) {
      layout.projects.close(directory)
      navigate("/")
      return
    }

    navigateWithSidebarReset(`/${base64Encode(next.worktree)}/session`)
    layout.projects.close(directory)
    queueMicrotask(() => {
      void navigateToProject(next.worktree)
    })
  }

  function DialogDeleteProject(props: { project: LocalProject }) {
    const handleDelete = async () => {
      dialog.close()
      closeProject(props.project.worktree)
      if (!props.project.id || props.project.id === "global") return
      const base = import.meta.env.DEV
        ? `http://${import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:${import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`
        : `${location.origin}/api`
      const token = getAuthToken()
      await fetch(
        `${base}/project/${encodeURIComponent(props.project.id)}?directory=${encodeURIComponent(props.project.worktree)}`,
        {
          method: "DELETE",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      )
    }

    return (
      <Dialog title="Delete workspace" fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-text-strong">
              Are you sure you want to delete "{props.project.name || getFilename(props.project.worktree)}"?
            </span>
            <span class="text-12-regular text-text-weak">This will permanently remove the workspace and all its data.</span>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              Cancel
            </Button>
            <Button variant="primary" size="large" onClick={handleDelete}>
              Delete
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  async function chooseProject() {
    function resolve(result: string | string[] | null) {
      if (Array.isArray(result)) {
        for (const directory of result) {
          openProject(directory, false)
        }
        navigateToProject(result[0])
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
      const run = ++dialogRun
      void import("@/components/dialog-select-directory").then((x) => {
        if (dialogDead || dialogRun !== run) return
        dialog.show(
          () => <x.DialogSelectDirectory multiple={true} onSelect={resolve} />,
          () => resolve(null),
        )
      })
    }
  }

  function DialogCreateNewKB() {
    const [name, setName] = createSignal("")
    const [error, setError] = createSignal("")

    const handleCreate = async () => {
      const trimmed = name().trim()
      if (!trimmed) return
      setError("")
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
          setError(err.error ?? "Failed to create KB")
          return
        }
        const { directory } = (await res.json()) as { directory: string; name: string }
        dialog.close()
        openProject(directory)
      } catch {
        setError("Failed to create KB — check connection")
      }
    }

    return (
      <Dialog title="New KB" fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="flex flex-col gap-1.5">
            <input
              autofocus
              class="w-72 rounded-lg border border-border-base bg-background-input px-3 py-2 text-14-regular text-text-strong outline-none focus:border-border-focus placeholder:text-text-weak"
              classList={{ "border-red-500 focus:border-red-500": !!error() }}
              placeholder="e.g. Machine Learning"
              value={name()}
              onInput={(e) => { setName(e.currentTarget.value); setError("") }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate()
                if (e.key === "Escape") dialog.close()
              }}
            />
            <Show when={error()}>
              <div class="text-12-regular text-red-500 pl-1">{error()}</div>
            </Show>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              Cancel
            </Button>
            <Button variant="primary" size="large" disabled={!name().trim()} onClick={handleCreate}>
              Create
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  function createNewKB() {
    dialog.show(() => <DialogCreateNewKB />, { noOverlay: true })
  }

  const deleteWorkspace = async (root: string, directory: string, leaveDeletedWorkspace = false) => {
    if (directory === root) return

    const current = currentDir()
    const currentKey = workspaceKey(current)
    const deletedKey = workspaceKey(directory)
    const shouldLeave = leaveDeletedWorkspace || (!!params.dir && currentKey === deletedKey)
    if (!leaveDeletedWorkspace && shouldLeave) {
      navigateWithSidebarReset(`/${base64Encode(root)}/session`)
    }

    setBusy(directory, true)

    const result = await globalSDK.client.worktree
      .remove({ directory: root, worktreeRemoveInput: { directory } })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("workspace.delete.failed.title"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
        return false
      })

    setBusy(directory, false)

    if (!result) return

    if (workspaceKey(store.lastProjectSession[root]?.directory ?? "") === workspaceKey(directory)) {
      clearLastProjectSession(root)
    }

    globalSync.set(
      "project",
      produce((draft) => {
        const project = draft.find((item) => item.worktree === root)
        if (!project) return
        project.sandboxes = (project.sandboxes ?? []).filter((sandbox) => sandbox !== directory)
      }),
    )
    setStore("workspaceOrder", root, (order) => (order ?? []).filter((workspace) => workspace !== directory))

    layout.projects.close(directory)
    layout.projects.open(root)

    if (shouldLeave) return

    const nextCurrent = currentDir()
    const nextKey = workspaceKey(nextCurrent)
    const project = layout.projects.list().find((item) => item.worktree === root)
    const dirs = project
      ? effectiveWorkspaceOrder(root, [root, ...(project.sandboxes ?? [])], store.workspaceOrder[root])
      : [root]
    const valid = dirs.some((item) => workspaceKey(item) === nextKey)

    if (params.dir && projectRoot(nextCurrent) === root && !valid) {
      navigateWithSidebarReset(`/${base64Encode(root)}/session`)
    }
  }

  const resetWorkspace = async (root: string, directory: string) => {
    if (directory === root) return
    setBusy(directory, true)

    const progress = showToast({
      persistent: true,
      title: language.t("workspace.resetting.title"),
      description: language.t("workspace.resetting.description"),
    })
    const dismiss = () => toaster.dismiss(progress)

    const sessions: Session[] = await globalSDK.client.session
      .list({ directory })
      .then((x) => x.data ?? [])
      .catch(() => [])

    clearWorkspaceTerminals(
      directory,
      sessions.map((s) => s.id),
      platform,
    )
    await globalSDK.client.instance.dispose({ directory }).catch(() => undefined)

    const result = await globalSDK.client.worktree
      .reset({ directory: root, worktreeResetInput: { directory } })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("workspace.reset.failed.title"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
        return false
      })

    if (!result) {
      setBusy(directory, false)
      dismiss()
      return
    }

    const archivedAt = Date.now()
    await Promise.all(
      sessions
        .filter((session) => session.time.archived === undefined)
        .map((session) =>
          globalSDK.client.session
            .update({
              sessionID: session.id,
              directory: session.directory,
              time: { archived: archivedAt },
            })
            .catch(() => undefined),
        ),
    )

    setBusy(directory, false)
    dismiss()

    showToast({
      title: language.t("workspace.reset.success.title"),
      description: language.t("workspace.reset.success.description"),
      actions: [
        {
          label: language.t("command.session.new"),
          onClick: () => {
            const href = `/${base64Encode(directory)}/session`
            navigate(href)
            layout.mobileSidebar.hide()
          },
        },
        {
          label: language.t("common.dismiss"),
          onClick: "dismiss",
        },
      ],
    })
  }

  const activeRoute = {
    session: "",
    sessionProject: "",
    directory: "",
  }

  createEffect(
    on(
      () => {
        return [pageReady(), route().slug, params.id, currentProject()?.worktree, currentDir()] as const
      },
      ([ready, slug, id, root, dir]) => {
        if (!ready || !slug || !dir) {
          activeRoute.session = ""
          activeRoute.sessionProject = ""
          activeRoute.directory = ""
          return
        }

        if (!id) {
          activeRoute.session = ""
          activeRoute.sessionProject = ""
          activeRoute.directory = ""
          return
        }

        const session = `${slug}/${id}`

        if (!root) {
          activeRoute.session = session
          activeRoute.directory = dir
          activeRoute.sessionProject = ""
          return
        }

        if (server.projects.last() !== root) server.projects.touch(root)

        const changed = session !== activeRoute.session || dir !== activeRoute.directory
        if (changed) {
          activeRoute.session = session
          activeRoute.directory = dir
          activeRoute.sessionProject = syncSessionRoute(dir, id, root)
          return
        }

        if (root === activeRoute.sessionProject) return
        activeRoute.directory = dir
        activeRoute.sessionProject = rememberSessionRoute(dir, id, root)
      },
    ),
  )

  const SIDEBAR_COLLAPSED_WIDTH = 56

  createEffect(() => {
    const sidebarWidth = layout.sidebar.opened() ? layout.sidebar.width() : 0
    document.documentElement.style.setProperty("--dialog-left-margin", `${sidebarWidth}px`)
    document.documentElement.style.setProperty(
      "--session-panel-left",
      `${sidebarWidth + layout.session.width()}px`,
    )
  })

  const side = createMemo(() => layout.sidebar.opened() ? Math.max(layout.sidebar.width(), 160) : SIDEBAR_COLLAPSED_WIDTH)
  const panel = createMemo(() => side())

  const loadedSessionDirs = new Set<string>()

  createEffect(
    on(
      visibleSessionDirs,
      (dirs) => {
        if (dirs.length === 0) {
          loadedSessionDirs.clear()
          return
        }

        const next = new Set(dirs)
        for (const directory of next) {
          if (loadedSessionDirs.has(directory)) continue
          globalSync.project.loadSessions(directory)
        }

        loadedSessionDirs.clear()
        for (const directory of next) {
          loadedSessionDirs.add(directory)
        }
      },
      { defer: true },
    ),
  )

  function handleDragStart(event: unknown) {
    const id = getDraggableId(event)
    if (!id) return
    setHoverProject(undefined)
    setStore("activeProject", id)
  }

  function handleDragOver(event: DragEvent) {
    const { draggable, droppable } = event
    if (draggable && droppable) {
      const projects = layout.projects.list()
      const fromIndex = projects.findIndex((p) => p.worktree === draggable.id.toString())
      const toIndex = projects.findIndex((p) => p.worktree === droppable.id.toString())
      if (fromIndex !== toIndex && toIndex !== -1) {
        layout.projects.move(draggable.id.toString(), toIndex)
      }
    }
  }

  function handleDragEnd() {
    setStore("activeProject", undefined)
  }

  function workspaceIds(project: LocalProject | undefined) {
    if (!project) return []
    const local = project.worktree
    const dirs = [local, ...(project.sandboxes ?? [])]
    const active = currentProject()
    const directory = workspaceKey(active?.worktree ?? "") === workspaceKey(project.worktree) ? currentDir() : undefined
    const extra =
      directory &&
      workspaceKey(directory) !== workspaceKey(local) &&
      !dirs.some((item) => workspaceKey(item) === workspaceKey(directory))
        ? directory
        : undefined
    const pending = extra ? WorktreeState.get(extra)?.status === "pending" : false

    const ordered = effectiveWorkspaceOrder(local, dirs, store.workspaceOrder[project.worktree])
    if (pending && extra) return [local, extra, ...ordered.filter((item) => item !== local)]
    if (!extra) return ordered
    if (pending) return ordered
    return [...ordered, extra]
  }

  const sidebarProject = createMemo(() => {
    if (layout.sidebar.opened()) return currentProject()
    const hovered = hoverProjectData()
    if (hovered) return hovered
    return currentProject()
  })

  function handleWorkspaceDragStart(event: unknown) {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeWorkspace", id)
  }

  function handleWorkspaceDragOver(event: DragEvent) {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return

    const project = sidebarProject()
    if (!project) return

    const ids = workspaceIds(project)
    const fromIndex = ids.findIndex((dir) => dir === draggable.id.toString())
    const toIndex = ids.findIndex((dir) => dir === droppable.id.toString())
    if (fromIndex === -1 || toIndex === -1) return
    if (fromIndex === toIndex) return

    const result = ids.slice()
    const [item] = result.splice(fromIndex, 1)
    if (!item) return
    result.splice(toIndex, 0, item)
    setStore(
      "workspaceOrder",
      project.worktree,
      result.filter((directory) => workspaceKey(directory) !== workspaceKey(project.worktree)),
    )
  }

  function handleWorkspaceDragEnd() {
    setStore("activeWorkspace", undefined)
  }

  const doCreateWorkspace = async (project: LocalProject, name: string) => {
    clearSidebarHoverState()
    const created = await globalSDK.client.worktree
      .create({ directory: project.worktree })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("workspace.create.failed.title"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
        return undefined
      })

    if (!created?.directory) return

    setWorkspaceName(created.directory, name, project.id, created.branch)

    const local = project.worktree
    const key = workspaceKey(created.directory)
    const root = workspaceKey(local)

    setBusy(created.directory, true)
    WorktreeState.pending(created.directory)
    setStore("workspaceExpanded", key, true)
    if (key !== created.directory) {
      setStore("workspaceExpanded", created.directory, true)
    }
    setStore("workspaceOrder", project.worktree, (prev) => {
      const existing = prev ?? []
      const next = existing.filter((item) => {
        const id = workspaceKey(item)
        return id !== root && id !== key
      })
      return [created.directory, ...next]
    })

    globalSync.child(created.directory)
    navigateWithSidebarReset(`/${base64Encode(created.directory)}/session`)
  }

  function DialogCreateWorkspace(props: { project: LocalProject }) {
    const [name, setName] = createSignal("")

    const handleCreate = () => {
      const trimmed = name().trim()
      if (!trimmed) return
      dialog.close()
      void doCreateWorkspace(props.project, trimmed)
    }

    return (
      <Dialog title="New KB" fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <input
            autofocus
            class="w-72 rounded-lg border border-border-base bg-background-input px-3 py-2 text-14-regular text-text-strong outline-none focus:border-border-focus placeholder:text-text-weak"
            placeholder="e.g. Machine Learning"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate()
              if (e.key === "Escape") dialog.close()
            }}
          />
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              Cancel
            </Button>
            <Button variant="primary" size="large" disabled={!name().trim()} onClick={handleCreate}>
              Create
            </Button>
          </div>
        </div>
      </Dialog>
    )
  }

  const createWorkspace = (project: LocalProject) => {
    dialog.show(() => <DialogCreateWorkspace project={project} />)
  }

  const workspaceSidebarCtx: WorkspaceSidebarContext = {
    currentDir,
    navList: currentSessions,
    sidebarExpanded,
    sidebarHovering,
    clearHoverProjectSoon,
    prefetchSession,
    archiveSession,
    workspaceName,
    renameWorkspace,
    editorOpen,
    openEditor,
    closeEditor,
    setEditor,
    InlineEditor,
    isBusy,
    workspaceExpanded: (directory, local) => store.workspaceExpanded[directory] ?? local,
    setWorkspaceExpanded: (directory, value) => setStore("workspaceExpanded", directory, value),
    setScrollContainerRef: (el, mobile) => {
      if (!mobile) scrollContainerRef = el
    },
  }

  const projectSidebarCtx: ProjectSidebarContext = {
    currentDir,
    currentProject,
    sidebarOpened: () => layout.sidebar.opened(),
    sidebarHovering,
    hoverProject: () => state.hoverProject,
    onProjectMouseEnter: (worktree, event) => aim.enter(worktree, event),
    onProjectMouseLeave: (worktree) => aim.leave(worktree),
    onProjectFocus: (worktree) => aim.activate(worktree),
    onHoverOpenChanged: (worktree, hoverOpen) => {
      if (!hoverOpen && state.hoverProject && state.hoverProject !== worktree) return
      setState("hoverProject", hoverOpen ? worktree : undefined)
    },
    navigateToProject,
    openSidebar: () => layout.sidebar.open(),
    closeProject,
    workspaceIds,
    workspaceLabel,
    sessionProps: {
      navList: currentSessions,
      sidebarExpanded,
      clearHoverProjectSoon,
      prefetchSession,
      archiveSession,
    },
  }

  const [topbarCaptureOpen, setTopbarCaptureOpen] = createSignal(false)

  const SidebarPanel = (panelProps: {
    project: Accessor<LocalProject | undefined>
    mobile?: boolean
    merged?: boolean
    onCollapse?: () => void
  }) => {
    const project = panelProps.project
    const merged = createMemo(() => panelProps.mobile || (panelProps.merged ?? layout.sidebar.opened()))
    const hover = createMemo(() => !panelProps.mobile && panelProps.merged === false && !layout.sidebar.opened())
    const empty = createMemo(() => !params.dir && layout.projects.list().length === 0)
    const projectName = createMemo(() => {
      const item = project()
      if (!item) return ""
      return item.name || getFilename(item.worktree)
    })
    const projectId = createMemo(() => project()?.id ?? "")
    const worktree = createMemo(() => project()?.worktree ?? "")
    const slug = createMemo(() => {
      const dir = worktree()
      if (!dir) return ""
      return base64Encode(dir)
    })
    const workspaces = createMemo(() => {
      const item = project()
      if (!item) return [] as string[]
      return workspaceIds(item)
    })
    const unseenCount = createMemo(() =>
      workspaces().reduce((total, directory) => total + notification.project.unseenCount(directory), 0),
    )
    const clearNotifications = () =>
      workspaces()
        .filter((directory) => notification.project.unseenCount(directory) > 0)
        .forEach((directory) => notification.project.markViewed(directory))
    const workspacesEnabled = createMemo(() => {
      const item = project()
      if (!item) return false
      if (item.vcs !== "git") return false
      return layout.sidebar.workspaces(item.worktree)()
    })
    const canToggle = createMemo(() => {
      const item = project()
      if (!item) return false
      return item.vcs === "git" || layout.sidebar.workspaces(item.worktree)()
    })
    const homedir = createMemo(() => globalSync.data.path.home)
    const [sidebarCaptureOpen, setSidebarCaptureOpen] = createSignal(false)

    const [hoveredView, setHoveredView] = createSignal("")
    const a = (view: string) => activeSidebarView().view === view
    const h = (view: string) => hoveredView() === view

    const [profileOpen, setProfileOpen] = createSignal(false)
    const [hoveredMenuItem, setHoveredMenuItem] = createSignal("")
    const [workspaceExpanded, setWorkspaceExpanded] = createSignal(false)
    let profileRef: HTMLDivElement | undefined

    createEffect(() => { if (!profileOpen()) setWorkspaceExpanded(false) })

    const getUserEmail = () => {
      try {
        const t = localStorage.getItem("supadense.auth.token")
        if (!t) return ""
        const p = JSON.parse(atob(t.split(".")[1].replace(/-/g,"+").replace(/_/g,"/")))
        return (p.email || "") as string
      } catch { return "" }
    }

    createEffect(() => {
      if (!profileOpen()) return
      const handler = (e: MouseEvent) => {
        if (profileRef && !profileRef.contains(e.target as Node)) setProfileOpen(false)
      }
      document.addEventListener("mousedown", handler, true)
      onCleanup(() => document.removeEventListener("mousedown", handler, true))
    })

    // Light theme tokens — warm parchment palette (sd v2)
    const C = {
      bg: "#f4f4f5",         // ground-000: sidebar bg
      surface: "#ffffff",    // ground-100: card/button bg
      raised: "#fafafa",     // ground-150: hover/active bg
      border: "#e5e5e5",     // ground-300: hairlines
      divider: "#d4d4d4",    // ground-400: muted dividers
      text: "#0a0a0a",       // ink-100: primary text
      textSub: "#525252",    // ink-300: nav item default
      textMuted: "#737373",  // ink-400: labels, icons, counts
      amber: "#d68a2e",      // amber-300: accent
      amberBg: "rgba(214,138,46,0.08)",
    }

    return (
      <div
        style={{
          background: C.bg,
          display: "flex",
          "flex-direction": "column",
          width: "100%",
          height: "100%",
          "min-height": "0",
          overflow: "hidden",
          "border-radius": "10px",
        }}
      >
        <Show
          when={project()}
          fallback={
            <Show when={empty()}>
              <div class="flex-1 min-h-0 flex items-center justify-center px-6 pb-64 text-center">
                <div class="mt-8 flex max-w-60 flex-col items-center gap-6 text-center">
                  <div class="flex flex-col gap-3">
                    <div class="text-14-medium" style={{ color: C.text }}>{language.t("sidebar.empty.title")}</div>
                    <div class="text-14-regular" style={{ color: C.textSub, "line-height": "var(--line-height-normal)" }}>
                      {language.t("sidebar.empty.description")}
                    </div>
                  </div>
                  <Button size="large" icon="folder-add-left" onClick={createNewKB} data-tour="create-kb-btn">
                    Create Knowledge Base
                  </Button>
                </div>
              </div>
            </Show>
          }
        >
          <>
            {/* ── HEADER ── */}
            <div style={{ padding: "16px 14px", display: "flex", "align-items": "center", "justify-content": "space-between", "border-bottom": `1px solid ${C.border}`, "flex-shrink": "0" }}>
              <div style={{ display: "inline-flex", "align-items": "center", gap: "10px", "font-weight": "500", "letter-spacing": "-0.02em", "font-size": "14px", color: C.text }}>
                <div style={{ display: "inline-grid", "grid-template-columns": "repeat(4, 1fr)", "grid-template-rows": "repeat(4, 1fr)", gap: "1px", width: "18px", height: "18px", "flex-shrink": "0" }}>
                  <For each={[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]}>
                    {(i) => <div style={{ background: i === 5 ? C.amber : C.text }} />}
                  </For>
                </div>
                <span>supadense</span>
              </div>
              <div style={{ display: "flex", gap: "6px", "align-items": "center" }}>
                <Show when={panelProps.onCollapse}>
                  <button
                    type="button"
                    style={{ width: "26px", height: "26px", border: `1px solid ${C.border}`, "border-radius": "2px", background: C.surface, color: C.textSub, display: "inline-flex", "align-items": "center", "justify-content": "center", cursor: "pointer" }}
                    onClick={panelProps.onCollapse}
                    title="Collapse sidebar"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="3" y="4" width="18" height="16" rx="2"/><line x1="9" y1="4" x2="9" y2="20"/>
                    </svg>
                  </button>
                </Show>
                <button
                  type="button"
                  style={{ width: "26px", height: "26px", border: `1px solid ${C.border}`, "border-radius": "2px", background: C.surface, color: C.textSub, display: "inline-flex", "align-items": "center", "justify-content": "center", cursor: "pointer" }}
                  onClick={() => { if (worktree()) setSidebarCaptureOpen(true) }}
                  title="Capture"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* ── NAV ── */}
            <div style={{ flex: "1", "min-height": "0", "overflow-y": "auto", "scrollbar-width": "none" }}>
              <div style={{ padding: "12px 8px 6px", "font-family": "'Geist Mono', monospace", "font-size": "9px", "letter-spacing": "0.14em", "text-transform": "uppercase", color: C.textMuted }}>workspace</div>
              <div style={{ display: "flex", "flex-direction": "column", gap: "1px", padding: "0 8px 8px" }}>

                {/* Graph */}
                <button type="button" style={{ padding: "7px 10px", display: "flex", "align-items": "center", gap: "10px", "font-size": "13px", color: a("lib") || h("lib") ? C.text : C.textSub, background: a("lib") ? C.raised : h("lib") ? C.surface : "transparent", "border-radius": "2px", cursor: "pointer", border: "none", "text-align": "left", width: "100%", "font-family": "inherit", "box-shadow": a("lib") ? `inset 2px 0 0 0 ${C.amber}` : "none" }} onMouseEnter={() => setHoveredView("lib")} onMouseLeave={() => setHoveredView("")} onClick={() => setActiveSidebarView({ section: "workspace", view: "lib", label: "Graph" })}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a("lib") ? C.amber : C.textMuted} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style={{ "flex-shrink": "0" }}><circle cx="12" cy="12" r="3"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><line x1="10" y1="10" x2="7" y2="7"/><line x1="14" y1="10" x2="17" y2="7"/><line x1="10" y1="14" x2="7" y2="17"/><line x1="14" y1="14" x2="17" y2="17"/></svg>
                  <span style={{ flex: "1" }}>Graph</span>
                  <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", color: a("lib") ? C.amber : C.textMuted, "letter-spacing": "0.04em" }}>412</span>
                </button>

                {/* Sources */}
                <button type="button" style={{ padding: "7px 10px", display: "flex", "align-items": "center", gap: "10px", "font-size": "13px", color: a("read") || h("read") ? C.text : C.textSub, background: a("read") ? C.raised : h("read") ? C.surface : "transparent", "border-radius": "2px", cursor: "pointer", border: "none", "text-align": "left", width: "100%", "font-family": "inherit", "box-shadow": a("read") ? `inset 2px 0 0 0 ${C.amber}` : "none" }} onMouseEnter={() => setHoveredView("read")} onMouseLeave={() => setHoveredView("")} onClick={() => { setActiveSourceName(null); setActiveSidebarView({ section: "workspace", view: "read", label: "Sources" }) }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a("read") ? C.amber : C.textMuted} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style={{ "flex-shrink": "0" }}><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                  <span style={{ flex: "1" }}>Sources</span>
                  <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", color: a("read") ? C.amber : C.textMuted, "letter-spacing": "0.04em" }}>3 new</span>
                </button>

                {/* Eng Notes */}
                <button type="button" style={{ padding: "7px 10px", display: "flex", "align-items": "center", gap: "10px", "font-size": "13px", color: a("notes") || h("notes") ? C.text : C.textSub, background: a("notes") ? C.raised : h("notes") ? C.surface : "transparent", "border-radius": "2px", cursor: "pointer", border: "none", "text-align": "left", width: "100%", "font-family": "inherit", "box-shadow": a("notes") ? `inset 2px 0 0 0 ${C.amber}` : "none" }} onMouseEnter={() => setHoveredView("notes")} onMouseLeave={() => setHoveredView("")} onClick={() => setActiveSidebarView({ section: "workspace", view: "notes", label: "Eng Notes" })}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a("notes") ? C.amber : C.textMuted} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style={{ "flex-shrink": "0" }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>
                  <span style={{ flex: "1" }}>Eng Notes</span>
                  <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", color: a("notes") ? C.amber : C.textMuted, "letter-spacing": "0.04em" }}>24</span>
                </button>

                {/* Experiments */}
                <button type="button" style={{ padding: "7px 10px", display: "flex", "align-items": "center", gap: "10px", "font-size": "13px", color: a("experiments") || h("experiments") ? C.text : C.textSub, background: a("experiments") ? C.raised : h("experiments") ? C.surface : "transparent", "border-radius": "2px", cursor: "pointer", border: "none", "text-align": "left", width: "100%", "font-family": "inherit", "box-shadow": a("experiments") ? `inset 2px 0 0 0 ${C.amber}` : "none" }} onMouseEnter={() => setHoveredView("experiments")} onMouseLeave={() => setHoveredView("")} onClick={() => setActiveSidebarView({ section: "workspace", view: "experiments", label: "Experiments" })}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a("experiments") ? C.amber : C.textMuted} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style={{ "flex-shrink": "0" }}><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v11m0 0a3 3 0 1 0 6 0M9 14h6"/><path d="M14 3v11"/></svg>
                  <span style={{ flex: "1" }}>Experiments</span>
                </button>

                {/* Members */}
                <button type="button" style={{ padding: "7px 10px", display: "flex", "align-items": "center", gap: "10px", "font-size": "13px", color: a("members") || h("members") ? C.text : C.textSub, background: a("members") ? C.raised : h("members") ? C.surface : "transparent", "border-radius": "2px", cursor: "pointer", border: "none", "text-align": "left", width: "100%", "font-family": "inherit", "box-shadow": a("members") ? `inset 2px 0 0 0 ${C.amber}` : "none" }} onMouseEnter={() => setHoveredView("members")} onMouseLeave={() => setHoveredView("")} onClick={() => setActiveSidebarView({ section: "workspace", view: "members", label: "Members" })}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a("members") ? C.amber : C.textMuted} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style={{ "flex-shrink": "0" }}><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                  <span style={{ flex: "1" }}>Members</span>
                </button>

                {/* Today */}
                <button type="button" style={{ padding: "7px 10px", display: "flex", "align-items": "center", gap: "10px", "font-size": "13px", color: a("dash") || h("dash") ? C.text : C.textSub, background: a("dash") ? C.raised : h("dash") ? C.surface : "transparent", "border-radius": "2px", cursor: "pointer", border: "none", "text-align": "left", width: "100%", "font-family": "inherit", "box-shadow": a("dash") ? `inset 2px 0 0 0 ${C.amber}` : "none" }} onMouseEnter={() => setHoveredView("dash")} onMouseLeave={() => setHoveredView("")} onClick={() => setActiveSidebarView({ section: "workspace", view: "dash", label: "Today" })}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a("dash") ? C.amber : C.textMuted} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style={{ "flex-shrink": "0" }}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                  <span style={{ flex: "1" }}>Today</span>
                  <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", color: a("dash") ? C.amber : C.textMuted, "letter-spacing": "0.04em" }}>7 due</span>
                </button>

                {/* Gaps */}
                <button type="button" style={{ padding: "7px 10px", display: "flex", "align-items": "center", gap: "10px", "font-size": "13px", color: a("gaps") || h("gaps") ? C.text : C.textSub, background: a("gaps") ? C.raised : h("gaps") ? C.surface : "transparent", "border-radius": "2px", cursor: "pointer", border: "none", "text-align": "left", width: "100%", "font-family": "inherit", "box-shadow": a("gaps") ? `inset 2px 0 0 0 ${C.amber}` : "none" }} onMouseEnter={() => setHoveredView("gaps")} onMouseLeave={() => setHoveredView("")} onClick={() => setActiveSidebarView({ section: "workspace", view: "gaps", label: "Gaps" })}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a("gaps") ? C.amber : C.textMuted} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style={{ "flex-shrink": "0" }}><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7"/><circle cx="12" cy="17" r="0.6" fill="currentColor"/></svg>
                  <span style={{ flex: "1" }}>Gaps</span>
                  <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", color: a("gaps") ? C.amber : C.textMuted, "letter-spacing": "0.04em" }}>14 open</span>
                </button>

                {/* Review */}
                <button type="button" style={{ padding: "7px 10px", display: "flex", "align-items": "center", gap: "10px", "font-size": "13px", color: a("practice") || h("practice") ? C.text : C.textSub, background: a("practice") ? C.raised : h("practice") ? C.surface : "transparent", "border-radius": "2px", cursor: "pointer", border: "none", "text-align": "left", width: "100%", "font-family": "inherit", "box-shadow": a("practice") ? `inset 2px 0 0 0 ${C.amber}` : "none" }} onMouseEnter={() => setHoveredView("practice")} onMouseLeave={() => setHoveredView("")} onClick={() => setActiveSidebarView({ section: "workspace", view: "practice", label: "Review" })}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a("practice") ? C.amber : C.textMuted} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style={{ "flex-shrink": "0" }}><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  <span style={{ flex: "1" }}>Review</span>
                  <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", color: a("practice") ? C.amber : C.textMuted, "letter-spacing": "0.04em" }}>7 due</span>
                </button>

                {/* Ask */}
                <button type="button" style={{ padding: "7px 10px", display: "flex", "align-items": "center", gap: "10px", "font-size": "13px", color: a("ask") || h("ask") ? C.text : C.textSub, background: a("ask") ? C.raised : h("ask") ? C.surface : "transparent", "border-radius": "2px", cursor: "pointer", border: "none", "text-align": "left", width: "100%", "font-family": "inherit", "box-shadow": a("ask") ? `inset 2px 0 0 0 ${C.amber}` : "none" }} onMouseEnter={() => setHoveredView("ask")} onMouseLeave={() => setHoveredView("")} onClick={() => { setActiveSidebarView({ section: "workspace", view: "ask", label: "Ask" }); const dir = worktree(); if (dir) navigateWithSidebarReset(`/${slug()}/session`) }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a("ask") ? C.amber : C.textMuted} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style={{ "flex-shrink": "0" }}><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/></svg>
                  <span style={{ flex: "1" }}>Ask</span>
                </button>

              </div>
            </div>

            {/* ── USER PILL ── */}
            <div ref={(el) => { profileRef = el }} style={{ position: "relative", "border-top": `1px solid ${C.border}`, "flex-shrink": "0" }}>

              {/* Profile popover */}
              <Show when={profileOpen()}>
                <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: "8px", right: "8px", background: C.surface, border: `1px solid ${C.border}`, "border-radius": "6px", "box-shadow": "0 8px 24px rgba(0,0,0,0.12)", "z-index": "100" }}>
                  {/* User info header */}
                  <div style={{ padding: "12px 14px 10px", "border-bottom": `1px solid ${C.border}` }}>
                    <div style={{ display: "flex", "align-items": "center", gap: "10px" }}>
                      <div style={{ width: "32px", height: "32px", "border-radius": "50%", background: C.amber, color: "#ffffff", display: "flex", "align-items": "center", "justify-content": "center", "font-family": "'Geist Mono', monospace", "font-weight": "600", "font-size": "13px", "flex-shrink": "0" }}>
                        {getUserEmail().substring(0, 2).toUpperCase() || "U"}
                      </div>
                      <div style={{ "min-width": "0" }}>
                        <div style={{ "font-size": "13px", "font-weight": "500", color: C.text, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                          {getUserEmail().split("@")[0] || "user"}
                        </div>
                        <div style={{ "font-size": "11px", color: C.textMuted, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap", "margin-top": "1px" }}>
                          {getUserEmail() || "—"}
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* Menu items */}
                  <div style={{ padding: "4px 0" }}>
                    <button
                      type="button"
                      style={{ padding: "7px 14px", display: "flex", "align-items": "center", gap: "10px", "font-size": "13px", color: hoveredMenuItem() === "workspace" ? C.text : C.textSub, background: workspaceExpanded() || hoveredMenuItem() === "workspace" ? C.raised : "transparent", border: "none", cursor: "pointer", width: "100%", "text-align": "left", "font-family": "inherit" }}
                      onMouseEnter={() => setHoveredMenuItem("workspace")}
                      onMouseLeave={() => setHoveredMenuItem("")}
                      onClick={() => setWorkspaceExpanded(e => !e)}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style={{ "flex-shrink": "0" }}>
                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                        <polyline points="9 22 9 12 15 12 15 22"/>
                      </svg>
                      <span style={{ flex: "1" }}>Workspace</span>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={C.divider} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{ "flex-shrink": "0", transform: workspaceExpanded() ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 140ms" }}>
                        <polyline points="18 15 12 9 6 15"/>
                      </svg>
                    </button>
                    <Show when={workspaceExpanded()}>
                      <div style={{ background: C.bg, "border-top": `1px solid ${C.border}`, "border-bottom": `1px solid ${C.border}`, "max-height": "240px", "overflow-y": "auto" }}>
                        <For each={layout.projects.list()}>
                          {(proj) => {
                            const allDirs = () => workspaceIds(proj)
                            return (
                              <For each={allDirs()}>
                                {(dir) => {
                                  const isActive = () => workspaceKey(dir) === workspaceKey(currentDir() ?? "")
                                  const [hov, setHov] = createSignal(false)
                                  const label = () => workspaceLabel(dir, undefined, proj.id) || getFilename(dir)
                                  return (
                                    <button
                                      type="button"
                                      style={{ padding: "7px 14px 7px 20px", display: "flex", "align-items": "center", gap: "8px", "font-size": "12px", color: isActive() ? C.amber : hov() ? C.text : C.textSub, background: isActive() ? C.amberBg : hov() ? C.raised : "transparent", border: "none", cursor: "pointer", width: "100%", "text-align": "left", "font-family": "inherit" }}
                                      onMouseEnter={() => setHov(true)}
                                      onMouseLeave={() => setHov(false)}
                                      onClick={() => { setProfileOpen(false); void navigateToProject(dir) }}
                                    >
                                      <Show when={isActive()} fallback={<span style={{ width: "12px", "flex-shrink": "0" }} />}>
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.amber} stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style={{ "flex-shrink": "0" }}>
                                          <polyline points="20 6 9 17 4 12"/>
                                        </svg>
                                      </Show>
                                      <span style={{ overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                                        {label()}
                                      </span>
                                    </button>
                                  )
                                }}
                              </For>
                            )
                          }}
                        </For>
                      </div>
                    </Show>
                    <button
                      type="button"
                      style={{ padding: "7px 14px", display: "flex", "align-items": "center", gap: "10px", "font-size": "13px", color: hoveredMenuItem() === "settings" ? C.text : C.textSub, background: hoveredMenuItem() === "settings" ? C.raised : "transparent", border: "none", cursor: "pointer", width: "100%", "text-align": "left", "font-family": "inherit" }}
                      onMouseEnter={() => setHoveredMenuItem("settings")}
                      onMouseLeave={() => setHoveredMenuItem("")}
                      onClick={() => { setProfileOpen(false); openSettings() }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style={{ "flex-shrink": "0" }}>
                        <circle cx="12" cy="12" r="3"/>
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                      </svg>
                      <span style={{ flex: "1" }}>Settings</span>
                      <span style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", color: C.divider, "letter-spacing": "0.04em" }}>⌘,</span>
                    </button>
                    <div style={{ height: "1px", background: C.border, margin: "4px 0" }} />
                    <button
                      type="button"
                      style={{ padding: "7px 14px", display: "flex", "align-items": "center", gap: "10px", "font-size": "13px", color: hoveredMenuItem() === "signout" ? C.text : C.textSub, background: hoveredMenuItem() === "signout" ? C.raised : "transparent", border: "none", cursor: "pointer", width: "100%", "text-align": "left", "font-family": "inherit" }}
                      onMouseEnter={() => setHoveredMenuItem("signout")}
                      onMouseLeave={() => setHoveredMenuItem("")}
                      onClick={() => { setProfileOpen(false); clearAuthToken(); location.reload() }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style={{ "flex-shrink": "0" }}>
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                        <polyline points="16 17 21 12 16 7"/>
                        <line x1="21" y1="12" x2="9" y2="12"/>
                      </svg>
                      Sign out
                    </button>
                  </div>
                </div>
              </Show>

              {/* Pill button */}
              <button
                type="button"
                style={{ padding: "12px 10px", display: "flex", "align-items": "center", gap: "10px", width: "100%", background: profileOpen() ? C.raised : "transparent", border: "none", cursor: "pointer", "text-align": "left", "font-family": "inherit", transition: "background 120ms" }}
                onMouseEnter={(e) => { if (!profileOpen()) (e.currentTarget as HTMLElement).style.background = C.surface }}
                onMouseLeave={(e) => { if (!profileOpen()) (e.currentTarget as HTMLElement).style.background = "transparent" }}
                onClick={() => setProfileOpen(p => !p)}
              >
                <div style={{ width: "30px", height: "30px", "border-radius": "50%", background: C.amber, color: "#ffffff", display: "flex", "align-items": "center", "justify-content": "center", "font-family": "'Geist Mono', monospace", "font-weight": "600", "font-size": "12px", "flex-shrink": "0" }}>
                  {getUserEmail().substring(0, 2).toUpperCase() || "U"}
                </div>
                <div style={{ flex: "1", "min-width": "0" }}>
                  <div style={{ "font-size": "13px", "font-weight": "500", color: C.text, "line-height": "1.1", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                    {getUserEmail().split("@")[0] || "user"}
                  </div>
                  <div style={{ "font-family": "'Geist Mono', monospace", "font-size": "10px", "letter-spacing": "0.06em", color: C.textMuted, "text-transform": "uppercase" }}>
                    12 eng commits · pro
                  </div>
                </div>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.divider} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{ "flex-shrink": "0", transform: profileOpen() ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 140ms" }}>
                  <polyline points="18 15 12 9 6 15"/>
                </svg>
              </button>
            </div>
          </>
        </Show>

        <Show when={sidebarCaptureOpen() && worktree()}>
          <CaptureDialog
            onClose={() => setSidebarCaptureOpen(false)}
          />
        </Show>
      </div>
    )
  }

  const projects = () => layout.projects.list()
  const projectOverlay = () => <ProjectDragOverlay projects={projects} activeProject={() => store.activeProject} />


  const sidebarContent = (mobile?: boolean) => (
    <SidebarContent
      mobile={mobile}
      opened={() => layout.sidebar.opened()}
      aimMove={aim.move}
      projects={projects}
      renderProject={(project) => (
        <SortableProject ctx={projectSidebarCtx} project={project} sortNow={sortNow} mobile={mobile} />
      )}
      handleDragStart={handleDragStart}
      handleDragEnd={handleDragEnd}
      handleDragOver={handleDragOver}
      openProjectLabel="Create New KB"
      openProjectKeybind={() => undefined}
      onOpenProject={createNewKB}
      renderProjectOverlay={projectOverlay}
      renderPanel={() =>
        mobile
          ? <SidebarPanel project={currentProject} mobile />
          : <SidebarPanel project={currentProject} merged onCollapse={() => layout.sidebar.toggle()} />
      }
      onToggleSessions={() => layout.sidebar.toggle()}
      onNewSession={() => {
        const dir = currentProject()?.worktree
        if (!dir) return
        navigateWithSidebarReset(`/${base64Encode(dir)}/session`)
      }}
    />
  )

  // ── Supadense: get user email for sidebar ────────────────────────────────
  const getTopLevelUserEmail = () => {
    try {
      const t = localStorage.getItem("supadense.auth.token")
      if (!t) return ""
      const p = JSON.parse(atob(t.split(".")[1].replace(/-/g,"+").replace(/_/g,"/")))
      return (p.email || "") as string
    } catch { return "" }
  }

  // ── Supadense: always keep opencode session sidebar closed so only SupadenseSidebar shows ──
  onMount(() => { layout.sidebar.close() })

  return (
    <div
      class="select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
      style={{
        display: "grid",
        "grid-template-columns": supadenseSidebarCollapsed() ? "0fr 1fr" : "240px 1fr",
        gap: supadenseSidebarCollapsed() ? "0" : "8px",
        padding: supadenseSidebarCollapsed() ? "8px 8px 8px 0" : "8px",
        background: "#ffffff",
        height: "100vh",
        "box-sizing": "border-box",
        "padding-right": chatOpen() ? "484px" : "8px",
        transition: "grid-template-columns 220ms cubic-bezier(0.22,1,0.36,1), padding 240ms cubic-bezier(0.22,1,0.36,1)",
        overflow: "hidden",
      }}
    >
      {/* ── Supadense left sidebar (first grid cell) ── */}
      <div style={{ overflow: "hidden", "min-width": "0" }}>
        <SupadenseSidebar
          collapsed={supadenseSidebarCollapsed()}
          onToggle={() => setSupadenseSidebarCollapsed(v => !v)}
          userEmail={getTopLevelUserEmail()}
          onLogout={() => { clearAuthToken(); navigate("/auth/login") }}
          onCapture={() => setTopbarCaptureOpen(true)}
        />
      </div>

      {/* ── Main area (second grid cell) ── */}
      <main
        style={{
          display: "flex",
          "flex-direction": "column",
          overflow: "hidden",
          "min-width": "0",
          background: "#ffffff",
          "border-radius": "10px",
        }}
      >
        <Titlebar
          sidebarCollapsed={supadenseSidebarCollapsed()}
          onToggleSidebar={() => setSupadenseSidebarCollapsed(v => !v)}
          onCapture={() => setTopbarCaptureOpen(true)}
        />

        {/* ── Virtual panels (Sources etc.) — shown instead of router children ── */}
        <Show when={activeSidebarView().view === "read"}>
          <div style={{ flex: "1", "min-height": "0", overflow: "hidden", background: "#ffffff" }}>
            <ReadPanel />
          </div>
        </Show>

        <div class="flex-1 min-h-0 relative" style={{ background: "#ffffff", "border-radius": "10px", overflow: "hidden", display: activeSidebarView().view === "read" ? "none" : undefined }}>
          <div class="size-full relative overflow-x-hidden">
            <nav
              aria-label={language.t("sidebar.nav.projectsAndSessions")}
              data-component="sidebar-nav-desktop"
              classList={{
                "hidden xl:block": layout.sidebar.opened(),
                "hidden": !layout.sidebar.opened(),
                "fixed": true,
                "z-10": true,
              }}
              style={{
                width: `${side()}px`,
                top: "8px",
                bottom: "8px",
                left: supadenseSidebarCollapsed() ? "8px" : "256px",
              }}
              ref={(el) => {
                setState("nav", el)
              }}
              onMouseEnter={() => {
                disarm()
                disarmCollapse()
              }}
              onMouseLeave={() => {
                aim.reset()
                if (sidebarHovering()) arm()
                armCollapse()
              }}
            >
              <div class="@container w-full h-full contain-strict">{sidebarContent()}</div>
            </nav>

            <Show when={layout.sidebar.opened()}>
              <div
                class="hidden xl:block fixed z-30 w-0 overflow-visible"
                style={{ left: `${side() + (supadenseSidebarCollapsed() ? 8 : 256)}px`, top: "8px", bottom: "8px" }}
                onPointerDown={() => setState("sizing", true)}
              >
                <ResizeHandle
                  direction="horizontal"
                  size={layout.sidebar.width()}
                  min={220}
                  max={typeof window === "undefined" ? 1000 : window.innerWidth * 0.3 + 64}
                  onResize={(w) => {
                    setState("sizing", true)
                    if (sizet !== undefined) clearTimeout(sizet)
                    sizet = window.setTimeout(() => setState("sizing", false), 120)
                    layout.sidebar.resize(w)
                  }}
                />
              </div>
            </Show>

            <div
              class="hidden xl:block pointer-events-none absolute top-0 right-0 z-0 border-t border-border-weaker-base"
              style={{ left: "calc(4rem + 12px)" }}
            />

            <div class="xl:hidden">
              <div
                classList={{
                  "fixed inset-x-0 top-10 bottom-0 z-40 bg-black/40 transition-opacity duration-200": true,
                  "opacity-100 pointer-events-auto": layout.mobileSidebar.opened(),
                  "opacity-0 pointer-events-none": !layout.mobileSidebar.opened(),
                }}
                onClick={(e) => {
                  if (e.target === e.currentTarget) layout.mobileSidebar.hide()
                }}
              />
              <nav
                aria-label={language.t("sidebar.nav.projectsAndSessions")}
                data-component="sidebar-nav-mobile"
                classList={{
                  "@container fixed top-10 bottom-0 left-0 z-50 w-full max-w-[400px] overflow-hidden border-r border-border-weaker-base bg-background-base transition-transform duration-200 ease-out": true,
                  "translate-x-0": layout.mobileSidebar.opened(),
                  "-translate-x-full": !layout.mobileSidebar.opened(),
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {sidebarContent(true)}
              </nav>
            </div>

            <div
              classList={{
                "absolute inset-0": true,
                "xl:inset-y-0 xl:right-0 xl:left-[var(--main-left)]": true,
                "z-20": true,
                "transition-[left] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[left] motion-reduce:transition-none":
                  !state.sizing,
              }}
              style={{
                "--main-left": layout.sidebar.opened() ? `${side()}px` : "0px",
              }}
            >
              <main
                classList={{
                  "size-full overflow-x-hidden flex flex-col items-start contain-strict": true,
                }}
                style={{ background: "#ffffff" }}
              >
                <Show when={!autoselecting.loading} fallback={<div class="size-full" />}>
                  {props.children}
                </Show>
              </main>

            </div>

            <div
              classList={{
                "hidden xl:flex absolute inset-y-0 left-16 z-30": true,
                "opacity-100 translate-x-0 pointer-events-auto": state.peeked && !layout.sidebar.opened(),
                "opacity-0 -translate-x-2 pointer-events-none": !state.peeked || layout.sidebar.opened(),
                "transition-[opacity,transform] motion-reduce:transition-none": true,
                "duration-180 ease-out": state.peeked && !layout.sidebar.opened(),
                "duration-120 ease-in": !state.peeked || layout.sidebar.opened(),
              }}
              onMouseMove={disarm}
              onMouseEnter={() => {
                disarm()
                aim.reset()
              }}
              onPointerDown={disarm}
              onMouseLeave={() => {
                arm()
              }}
            >
              <Show when={peekProject()}>
                <SidebarPanel project={peekProject} merged={false} />
              </Show>
            </div>

            <div
              classList={{
                "hidden xl:block pointer-events-none absolute inset-y-0 right-0 z-25 overflow-hidden": true,
                "opacity-100 translate-x-0": state.peeked && !layout.sidebar.opened(),
                "opacity-0 -translate-x-2": !state.peeked || layout.sidebar.opened(),
                "transition-[opacity,transform] motion-reduce:transition-none": true,
                "duration-180 ease-out": state.peeked && !layout.sidebar.opened(),
                "duration-120 ease-in": !state.peeked || layout.sidebar.opened(),
              }}
              style={{ left: `calc(4rem + ${panel()}px)` }}
            >
              <div class="h-full w-px" style={{ "box-shadow": "var(--shadow-sidebar-overlay)" }} />
            </div>
          </div>
        </div>
        {false && <DebugBar />}
      </main>
      <Toast.Region />
      <SupadenseChatOverlay />

      {/* ── Floating chat button — visible on every tab ── */}
      <Show when={!chatOpen()}>
        <button
          type="button"
          title="Ask AI"
          onClick={() => setChatOpen(true)}
          style={{
            position: "fixed",
            bottom: "120px",
            right: "32px",
            width: "56px",
            height: "56px",
            "border-radius": "50%",
            background: "#ffffff",
            border: "2px solid #d68a2e",
            "box-shadow": "0 4px 20px rgba(214,138,46,0.18)",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            cursor: "pointer",
            "z-index": "100",
            transition: "box-shadow 150ms, transform 150ms",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow = "0 6px 28px rgba(214,138,46,0.32)"
            e.currentTarget.style.transform = "scale(1.06)"
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = "0 4px 20px rgba(214,138,46,0.18)"
            e.currentTarget.style.transform = "scale(1)"
          }}
        >
          <span style={{
            display: "inline-grid",
            "grid-template-columns": "repeat(3, 1fr)",
            "grid-template-rows": "repeat(3, 1fr)",
            gap: "2.5px",
            width: "22px",
            height: "22px",
          }}>
            {([0,1,2,3,4,5,6,7,8] as const).map((i) => (
              <span style={{
                display: "block",
                background: i === 4 ? "#d68a2e" : "#0a0a0a",
                "border-radius": "2px",
              }} />
            ))}
          </span>
        </button>
      </Show>
      <Show when={topbarCaptureOpen()}>
        {(() => {
          const token = getAuthToken()
          let userId: string | undefined
          try {
            if (token) {
              const p = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")))
              userId = typeof p.userId === "string" ? p.userId : undefined
            }
          } catch {}
          return (
            <CaptureDialog
              onClose={() => setTopbarCaptureOpen(false)}
            />
          )
        })()}
      </Show>
    </div>
  )
}
