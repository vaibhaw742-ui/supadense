import { randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs"
import { createServer } from "node:net"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Event } from "electron"
import { app, BrowserWindow, dialog, ipcMain } from "electron"
import pkg from "electron-updater"

import contextMenu from "electron-context-menu"
contextMenu({ showSaveImageAs: true, showLookUpSelection: false, showSearchWithGoogle: false })

process.env.OPENCODE_DISABLE_EMBEDDED_WEB_UI = "true"

const APP_NAMES: Record<string, string> = {
  dev: "Supadense Dev",
  beta: "Supadense Beta",
  prod: "Supadense",
}
const APP_IDS: Record<string, string> = {
  dev: "ai.supadense.desktop.dev",
  beta: "ai.supadense.desktop.beta",
  prod: "ai.supadense.desktop",
}
app.setName(app.isPackaged ? APP_NAMES[CHANNEL] : "Supadense Dev")
app.setPath("userData", join(app.getPath("appData"), app.isPackaged ? APP_IDS[CHANNEL] : "ai.supadense.desktop.dev"))
const { autoUpdater } = pkg

import type { InitStep, ServerReadyData, SqliteMigrationProgress, WslConfig } from "../preload/types"
import { checkAppExists, resolveAppPath, wslPath } from "./apps"
import { CHANNEL, UPDATER_ENABLED } from "./constants"
import { registerIpcHandlers, sendDeepLinks, sendMenuCommand, sendSqliteMigrationProgress } from "./ipc"
import { initLogging } from "./logging"
import { parseMarkdown } from "./markdown"
import { createMenu } from "./menu"
import { getDefaultServerUrl, getWslConfig, setDefaultServerUrl, setWslConfig, spawnLocalServer } from "./server"
import { createLoadingWindow, createMainWindow, setBackgroundColor, setDockIcon } from "./windows"
import { setupTray, updateTrayTooltip, destroyTray } from "./tray"
import { getSecret, setSecret, deleteSecret, injectSecretsToEnv } from "./secrets"
import { writeMcpPortFile, deleteMcpPortFile } from "./mcp-port"
import type { Server } from "virtual:opencode-server"

const initEmitter = new EventEmitter()
let initStep: InitStep = { phase: "server_waiting" }

let mainWindow: BrowserWindow | null = null
let server: Server.Listener | null = null

// Extend app with isQuitting flag to distinguish close vs quit
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Electron { interface App { isQuitting: boolean } }
}
app.isQuitting = false
const loadingComplete = defer<void>()

const pendingDeepLinks: string[] = []

const serverReady = defer<ServerReadyData>()
const logger = initLogging()

logger.log("app starting", {
  version: app.getVersion(),
  packaged: app.isPackaged,
})

setupApp()

function setupApp() {
  ensureLoopbackNoProxy()
  app.commandLine.appendSwitch("proxy-bypass-list", "<-loopback>")

  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  app.on("second-instance", (_event: Event, argv: string[]) => {
    const urls = argv.filter((arg: string) => arg.startsWith("opencode://"))
    if (urls.length) {
      logger.log("deep link received via second-instance", { urls })
      emitDeepLinks(urls)
    }
    focusMainWindow()
  })

  app.on("open-url", (event: Event, url: string) => {
    event.preventDefault()
    logger.log("deep link received via open-url", { url })
    emitDeepLinks([url])
  })

  // Keep app alive in tray when all windows are closed (macOS default behaviour)
  app.on("window-all-closed", () => {
    // Do nothing — app stays alive via tray icon
  })

  app.on("activate", () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.on("before-quit", () => {
    app.isQuitting = true
    deleteMcpPortFile()
    destroyTray()
    killSidecar()
  })

  app.on("will-quit", () => {
    deleteMcpPortFile()
    killSidecar()
  })

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      killSidecar()
      app.exit(0)
    })
  }

  void app.whenReady().then(async () => {
    app.setAsDefaultProtocolClient("supadense")
    setDockIcon()
    setupAutoUpdater()
    injectSecretsToEnv()
    registerSupadenseIpcHandlers()
    await initialize()
  })
}

function emitDeepLinks(urls: string[]) {
  if (urls.length === 0) return
  pendingDeepLinks.push(...urls)
  if (mainWindow) sendDeepLinks(mainWindow, urls)
}

function focusMainWindow() {
  if (!mainWindow) return
  mainWindow.show()
  mainWindow.focus()
}

function setInitStep(step: InitStep) {
  initStep = step
  logger.log("init step", { step })
  initEmitter.emit("step", step)
}

async function initialize() {
  const needsMigration = !sqliteFileExists()
  const sqliteDone = needsMigration ? defer<void>() : undefined
  let overlay: BrowserWindow | null = null

  const port = await getSidecarPort()
  const hostname = "127.0.0.1"
  const url = `http://${hostname}:${port}`
  const password = randomUUID()

  logger.log("spawning sidecar", { url })
  const { listener, health } = await spawnLocalServer(hostname, port, password)
  server = listener
  writeMcpPortFile(port)
  serverReady.resolve({
    url,
    username: "opencode",
    password,
  })

  const loadingTask = (async () => {
    logger.log("sidecar connection started", { url })

    initEmitter.on("sqlite", (progress: SqliteMigrationProgress) => {
      setInitStep({ phase: "sqlite_waiting" })
      if (overlay) sendSqliteMigrationProgress(overlay, progress)
      if (mainWindow) sendSqliteMigrationProgress(mainWindow, progress)
      if (progress.type === "Done") sqliteDone?.resolve()
    })

    if (needsMigration) {
      await sqliteDone?.promise
    }

    await Promise.race([
      health.wait,
      delay(30_000).then(() => {
        throw new Error("Sidecar health check timed out")
      }),
    ]).catch((error) => {
      logger.error("sidecar health check failed", error)
    })

    logger.log("loading task finished")
  })()

  const globals = {
    updaterEnabled: UPDATER_ENABLED,
    deepLinks: pendingDeepLinks,
  }

  if (needsMigration) {
    const show = await Promise.race([loadingTask.then(() => false), delay(1_000).then(() => true)])
    if (show) {
      overlay = createLoadingWindow(globals)
      await delay(1_000)
    }
  }

  await loadingTask
  setInitStep({ phase: "done" })

  if (overlay) {
    await loadingComplete.promise
  }

  mainWindow = createMainWindow(globals)
  wireMenu()

  // Hide window on close instead of quitting — app lives in tray
  mainWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  // Set up menubar tray
  setupTray(() => mainWindow)
  updateTrayTooltip("Supadense — brain ready")

  // Auto-launch on login (first run)
  if (!app.getLoginItemSettings().openAtLogin) {
    app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true })
  }

  overlay?.close()
}

function wireMenu() {
  if (!mainWindow) return
  createMenu({
    trigger: (id) => mainWindow && sendMenuCommand(mainWindow, id),
    checkForUpdates: () => {
      void checkForUpdates(true)
    },
    reload: () => mainWindow?.reload(),
    relaunch: () => {
      killSidecar()
      app.relaunch()
      app.exit(0)
    },
  })
}

registerIpcHandlers({
  killSidecar: () => killSidecar(),
  awaitInitialization: async (sendStep) => {
    sendStep(initStep)
    const listener = (step: InitStep) => sendStep(step)
    initEmitter.on("step", listener)
    try {
      logger.log("awaiting server ready")
      const res = await serverReady.promise
      logger.log("server ready", { url: res.url })
      return res
    } finally {
      initEmitter.off("step", listener)
    }
  },
  getDefaultServerUrl: () => getDefaultServerUrl(),
  setDefaultServerUrl: (url) => setDefaultServerUrl(url),
  getWslConfig: () => Promise.resolve(getWslConfig()),
  setWslConfig: (config: WslConfig) => setWslConfig(config),
  getDisplayBackend: async () => null,
  setDisplayBackend: async () => undefined,
  parseMarkdown: async (markdown) => parseMarkdown(markdown),
  checkAppExists: async (appName) => checkAppExists(appName),
  wslPath: async (path, mode) => wslPath(path, mode),
  resolveAppPath: async (appName) => resolveAppPath(appName),
  loadingWindowComplete: () => loadingComplete.resolve(),
  runUpdater: async (alertOnFail) => checkForUpdates(alertOnFail),
  checkUpdate: async () => checkUpdate(),
  installUpdate: async () => installUpdate(),
  setBackgroundColor: (color) => setBackgroundColor(color),
})

function killSidecar() {
  if (!server) return
  server.stop()
  server = null
}

function ensureLoopbackNoProxy() {
  const loopback = ["127.0.0.1", "localhost", "::1"]
  const upsert = (key: string) => {
    const items = (process.env[key] ?? "")
      .split(",")
      .map((value: string) => value.trim())
      .filter((value: string) => Boolean(value))

    for (const host of loopback) {
      if (items.some((value: string) => value.toLowerCase() === host)) continue
      items.push(host)
    }

    process.env[key] = items.join(",")
  }

  upsert("NO_PROXY")
  upsert("no_proxy")
}

async function getSidecarPort() {
  const fromEnv = process.env.OPENCODE_PORT
  if (fromEnv) {
    const parsed = Number.parseInt(fromEnv, 10)
    if (!Number.isNaN(parsed)) return parsed
  }

  return await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (typeof address !== "object" || !address) {
        server.close()
        reject(new Error("Failed to get port"))
        return
      }
      const port = address.port
      server.close(() => resolve(port))
    })
  })
}

function sqliteFileExists() {
  // Check userData path first (macOS/Windows), then XDG fallback (Linux)
  const userDataDb = join(app.getPath("userData"), "opencode-local.db")
  if (existsSync(userDataDb)) return true
  const xdg = process.env.XDG_DATA_HOME
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".local", "share")
  return existsSync(join(base, "opencode", "opencode.db"))
}

function setupAutoUpdater() {
  if (!UPDATER_ENABLED) return
  autoUpdater.logger = logger
  autoUpdater.channel = "latest"
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  logger.log("auto updater configured", {
    channel: autoUpdater.channel,
    allowPrerelease: autoUpdater.allowPrerelease,
    allowDowngrade: autoUpdater.allowDowngrade,
    currentVersion: app.getVersion(),
  })
}

let updateReady = false

async function checkUpdate() {
  if (!UPDATER_ENABLED) return { updateAvailable: false }
  updateReady = false
  logger.log("checking for updates", {
    currentVersion: app.getVersion(),
    channel: autoUpdater.channel,
    allowPrerelease: autoUpdater.allowPrerelease,
    allowDowngrade: autoUpdater.allowDowngrade,
  })
  try {
    const result = await autoUpdater.checkForUpdates()
    const updateInfo = result?.updateInfo
    logger.log("update metadata fetched", {
      releaseVersion: updateInfo?.version ?? null,
      releaseDate: updateInfo?.releaseDate ?? null,
      releaseName: updateInfo?.releaseName ?? null,
      files: updateInfo?.files?.map((file) => file.url) ?? [],
    })
    const version = result?.updateInfo?.version
    if (result?.isUpdateAvailable === false || !version) {
      logger.log("no update available", {
        reason: "provider returned no newer version",
      })
      return { updateAvailable: false }
    }
    logger.log("update available", { version })
    await autoUpdater.downloadUpdate()
    logger.log("update download completed", { version })
    updateReady = true
    return { updateAvailable: true, version }
  } catch (error) {
    logger.error("update check failed", error)
    return { updateAvailable: false, failed: true }
  }
}

async function installUpdate() {
  if (!updateReady) return
  killSidecar()
  autoUpdater.quitAndInstall()
}

async function checkForUpdates(alertOnFail: boolean) {
  if (!UPDATER_ENABLED) return
  logger.log("checkForUpdates invoked", { alertOnFail })
  const result = await checkUpdate()
  if (!result.updateAvailable) {
    if (result.failed) {
      logger.log("no update decision", { reason: "update check failed" })
      if (!alertOnFail) return
      await dialog.showMessageBox({
        type: "error",
        message: "Update check failed.",
        title: "Update Error",
      })
      return
    }

    logger.log("no update decision", { reason: "already up to date" })
    if (!alertOnFail) return
    await dialog.showMessageBox({
      type: "info",
      message: "You're up to date.",
      title: "No Updates",
    })
    return
  }

  const response = await dialog.showMessageBox({
    type: "info",
    message: `Update ${result.version ?? ""} downloaded. Restart now?`,
    title: "Update Ready",
    buttons: ["Restart", "Later"],
    defaultId: 0,
    cancelId: 1,
  })
  logger.log("update prompt response", {
    version: result.version ?? null,
    restartNow: response.response === 0,
  })
  if (response.response === 0) {
    await installUpdate()
  }
}

function registerSupadenseIpcHandlers() {
  ipcMain.handle("supadense:get-secret", (_e, name: string) => getSecret(name))
  ipcMain.handle("supadense:set-secret", (_e, name: string, value: string) => {
    setSecret(name, value)
    // Re-inject into process.env so server picks it up without restart
    injectSecretsToEnv()
  })
  ipcMain.handle("supadense:delete-secret", (_e, name: string) => deleteSecret(name))
  ipcMain.handle("supadense:has-secret", (_e, name: string) => getSecret(name) !== null)
  ipcMain.handle("supadense:init-project", (_e, projectDir: string) => {
    const supadenseDir = join(projectDir, ".supadense")
    const subdirs = ["sources", "brain", "notes", "commits"]
    mkdirSync(supadenseDir, { recursive: true })
    for (const sub of subdirs) mkdirSync(join(supadenseDir, sub), { recursive: true })
    return { path: supadenseDir, created: !existsSync(supadenseDir) }
  })
  ipcMain.handle("supadense:git-remote", async (_e, projectDir: string) => {
    try {
      const { execFile } = await import("node:child_process")
      const { promisify } = await import("node:util")
      const exec = promisify(execFile)
      const { stdout } = await exec("git", ["remote", "get-url", "origin"], { cwd: projectDir })
      return stdout.trim()
    } catch { return null }
  })
  ipcMain.handle("supadense:show-in-finder", async (_e, dirPath: string) => {
    const { shell } = await import("electron")
    shell.openPath(dirPath)
  })
  ipcMain.handle("supadense:git-info", async (_e, projectDir: string) => {
    try {
      const { execFile } = await import("node:child_process")
      const { promisify } = await import("node:util")
      const exec = promisify(execFile)
      const [branchRes, diffRes, remoteRes] = await Promise.allSettled([
        exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: projectDir }),
        exec("git", ["diff", "--shortstat", "HEAD"], { cwd: projectDir }),
        exec("git", ["remote", "get-url", "origin"], { cwd: projectDir }),
      ])
      const branch = branchRes.status === "fulfilled" ? branchRes.value.stdout.trim() : "main"
      const remote = remoteRes.status === "fulfilled" ? remoteRes.value.stdout.trim() : null

      // Parse +added -removed from shortstat: "2 files changed, 31 insertions(+), 0 deletions(-)"
      let added = 0, removed = 0
      if (diffRes.status === "fulfilled") {
        const m = diffRes.value.stdout.match(/(\d+) insertion|(\d+) deletion/g) ?? []
        for (const part of m) {
          const n = parseInt(part)
          if (part.includes("insertion")) added = n
          if (part.includes("deletion")) removed = n
        }
      }

      // Derive GitHub PR creation URL from remote
      let prUrl: string | null = null
      if (remote) {
        const ghMatch = remote.match(/github\.com[:/](.+?)(?:\.git)?$/)
        if (ghMatch) prUrl = `https://github.com/${ghMatch[1]}/compare/${branch}?expand=1`
      }

      return { branch, added, removed, prUrl, remote }
    } catch { return null }
  })
  ipcMain.handle("supadense:git-diff-files", async (_e, projectDir: string) => {
    try {
      const { execFile } = await import("node:child_process")
      const { promisify } = await import("node:util")
      const exec = promisify(execFile)
      // --numstat: added\tremoved\tfilepath per changed file
      const [numstatRes, statusRes] = await Promise.allSettled([
        exec("git", ["diff", "--numstat", "HEAD"], { cwd: projectDir }),
        exec("git", ["status", "--porcelain"], { cwd: projectDir }),
      ])
      const result: Record<string, { added: number; removed: number; status: "added" | "deleted" | "modified" }> = {}
      if (numstatRes.status === "fulfilled") {
        for (const line of numstatRes.value.stdout.trim().split("\n")) {
          const parts = line.split("\t")
          if (parts.length < 3) continue
          const added = parseInt(parts[0] ?? "0") || 0
          const removed = parseInt(parts[1] ?? "0") || 0
          const file = parts[2]!.trim()
          result[file] = { added, removed, status: "modified" }
        }
      }
      if (statusRes.status === "fulfilled") {
        for (const line of statusRes.value.stdout.trim().split("\n")) {
          if (!line.trim()) continue
          const code = line.slice(0, 2).trim()
          const file = line.slice(3).trim()
          if (file && result[file]) {
            if (code === "A" || code === "??") result[file]!.status = "added"
            else if (code === "D") result[file]!.status = "deleted"
          } else if (file) {
            // untracked or status-only changes not in numstat
            if (code === "A" || code === "??") result[file] = { added: 0, removed: 0, status: "added" }
            else if (code === "D") result[file] = { added: 0, removed: 0, status: "deleted" }
          }
        }
      }
      return result
    } catch { return {} }
  })
  ipcMain.handle("supadense:git-file-diff", async (_e, projectDir: string, filePath: string) => {
    try {
      const { execFile } = await import("node:child_process")
      const { promisify } = await import("node:util")
      const exec = promisify(execFile)
      const res = await exec("git", ["diff", "HEAD", "--", filePath], { cwd: projectDir })
      return res.stdout
    } catch { return null }
  })
  ipcMain.handle("supadense:read-file", async (_e, filePath: string) => {
    try {
      const { readFileSync } = await import("node:fs")
      return readFileSync(filePath, "utf-8")
    } catch { return null }
  })
  ipcMain.handle("supadense:write-file", async (_e, filePath: string, content: string) => {
    try {
      const { writeFileSync, mkdirSync } = await import("node:fs")
      const { dirname } = await import("node:path")
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, content, "utf-8")
      return true
    } catch { return false }
  })
  ipcMain.handle("supadense:list-dir", (_e, dirPath: string) => {
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true })
      const EXCLUDE = new Set([".git", ".DS_Store", "node_modules", "__pycache__"])
      return entries
        .filter((e) => !EXCLUDE.has(e.name))
        .map((e) => ({
          name: e.name,
          path: join(dirPath, e.name),
          type: e.isDirectory() ? "directory" : "file",
        }))
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === "directory" ? -1 : 1
          return a.name.localeCompare(b.name)
        })
    } catch {
      return []
    }
  })
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function defer<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
