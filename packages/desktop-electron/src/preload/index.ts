import { contextBridge, ipcRenderer } from "electron"
import type { ElectronAPI, InitStep, SqliteMigrationProgress } from "./types"

const api: ElectronAPI = {
  killSidecar: () => ipcRenderer.invoke("kill-sidecar"),
  installCli: () => ipcRenderer.invoke("install-cli"),
  awaitInitialization: (onStep) => {
    const handler = (_: unknown, step: InitStep) => onStep(step)
    ipcRenderer.on("init-step", handler)
    return ipcRenderer.invoke("await-initialization").finally(() => {
      ipcRenderer.removeListener("init-step", handler)
    })
  },
  getDefaultServerUrl: () => ipcRenderer.invoke("get-default-server-url"),
  setDefaultServerUrl: (url) => ipcRenderer.invoke("set-default-server-url", url),
  getWslConfig: () => ipcRenderer.invoke("get-wsl-config"),
  setWslConfig: (config) => ipcRenderer.invoke("set-wsl-config", config),
  getDisplayBackend: () => ipcRenderer.invoke("get-display-backend"),
  setDisplayBackend: (backend) => ipcRenderer.invoke("set-display-backend", backend),
  parseMarkdownCommand: (markdown) => ipcRenderer.invoke("parse-markdown", markdown),
  checkAppExists: (appName) => ipcRenderer.invoke("check-app-exists", appName),
  wslPath: (path, mode) => ipcRenderer.invoke("wsl-path", path, mode),
  resolveAppPath: (appName) => ipcRenderer.invoke("resolve-app-path", appName),
  storeGet: (name, key) => ipcRenderer.invoke("store-get", name, key),
  storeSet: (name, key, value) => ipcRenderer.invoke("store-set", name, key, value),
  storeDelete: (name, key) => ipcRenderer.invoke("store-delete", name, key),
  storeClear: (name) => ipcRenderer.invoke("store-clear", name),
  storeKeys: (name) => ipcRenderer.invoke("store-keys", name),
  storeLength: (name) => ipcRenderer.invoke("store-length", name),

  getWindowCount: () => ipcRenderer.invoke("get-window-count"),
  onSqliteMigrationProgress: (cb) => {
    const handler = (_: unknown, progress: SqliteMigrationProgress) => cb(progress)
    ipcRenderer.on("sqlite-migration-progress", handler)
    return () => ipcRenderer.removeListener("sqlite-migration-progress", handler)
  },
  onMenuCommand: (cb) => {
    const handler = (_: unknown, id: string) => cb(id)
    ipcRenderer.on("menu-command", handler)
    return () => ipcRenderer.removeListener("menu-command", handler)
  },
  onDeepLink: (cb) => {
    const handler = (_: unknown, urls: string[]) => cb(urls)
    ipcRenderer.on("deep-link", handler)
    return () => ipcRenderer.removeListener("deep-link", handler)
  },

  openDirectoryPicker: (opts) => ipcRenderer.invoke("open-directory-picker", opts),
  openFilePicker: (opts) => ipcRenderer.invoke("open-file-picker", opts),
  saveFilePicker: (opts) => ipcRenderer.invoke("save-file-picker", opts),
  openLink: (url) => ipcRenderer.send("open-link", url),
  openPath: (path, app) => ipcRenderer.invoke("open-path", path, app),
  readClipboardImage: () => ipcRenderer.invoke("read-clipboard-image"),
  showNotification: (title, body) => ipcRenderer.send("show-notification", title, body),
  getWindowFocused: () => ipcRenderer.invoke("get-window-focused"),
  setWindowFocus: () => ipcRenderer.invoke("set-window-focus"),
  showWindow: () => ipcRenderer.invoke("show-window"),
  relaunch: () => ipcRenderer.send("relaunch"),
  getZoomFactor: () => ipcRenderer.invoke("get-zoom-factor"),
  setZoomFactor: (factor) => ipcRenderer.invoke("set-zoom-factor", factor),
  setTitlebar: (theme) => ipcRenderer.invoke("set-titlebar", theme),
  loadingWindowComplete: () => ipcRenderer.send("loading-window-complete"),
  runUpdater: (alertOnFail) => ipcRenderer.invoke("run-updater", alertOnFail),
  checkUpdate: () => ipcRenderer.invoke("check-update"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  setBackgroundColor: (color: string) => ipcRenderer.invoke("set-background-color", color),
  gitClone: (repoUrl: string, targetDir: string) => ipcRenderer.invoke("git-clone", repoUrl, targetDir),
}

contextBridge.exposeInMainWorld("api", api)

// Supadense-specific IPC — secrets, tray events
const supadenseApi = {
  getSecret: (name: string): Promise<string | null> => ipcRenderer.invoke("supadense:get-secret", name),
  setSecret: (name: string, value: string): Promise<void> => ipcRenderer.invoke("supadense:set-secret", name, value),
  deleteSecret: (name: string): Promise<void> => ipcRenderer.invoke("supadense:delete-secret", name),
  hasSecret: (name: string): Promise<boolean> => ipcRenderer.invoke("supadense:has-secret", name),
  onQuickAdd: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on("supadense:quick-add", handler)
    return () => ipcRenderer.removeListener("supadense:quick-add", handler)
  },
  onOpenSettings: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on("supadense:open-settings", handler)
    return () => ipcRenderer.removeListener("supadense:open-settings", handler)
  },
  onCopyMcpConfig: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on("supadense:copy-mcp-config", handler)
    return () => ipcRenderer.removeListener("supadense:copy-mcp-config", handler)
  },
  onRegisterClaudeDesktop: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on("supadense:register-claude-desktop", handler)
    return () => ipcRenderer.removeListener("supadense:register-claude-desktop", handler)
  },
  initProject: (projectDir: string): Promise<{ path: string; created: boolean }> =>
    ipcRenderer.invoke("supadense:init-project", projectDir),
  listDir: (dirPath: string): Promise<{ name: string; path: string; type: "file" | "directory" }[]> =>
    ipcRenderer.invoke("supadense:list-dir", dirPath),
  gitRemote: (projectDir: string): Promise<string | null> =>
    ipcRenderer.invoke("supadense:git-remote", projectDir),
  gitInfo: (projectDir: string): Promise<{ branch: string; added: number; removed: number; prUrl: string | null; remote: string | null } | null> =>
    ipcRenderer.invoke("supadense:git-info", projectDir),
  readFile: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke("supadense:read-file", filePath),
  writeFile: (filePath: string, content: string): Promise<boolean> =>
    ipcRenderer.invoke("supadense:write-file", filePath, content),
  showInFinder: (dirPath: string): Promise<void> =>
    ipcRenderer.invoke("supadense:show-in-finder", dirPath),
  gitDiffFiles: (projectDir: string): Promise<Record<string, { added: number; removed: number; status: "added" | "deleted" | "modified" }>> =>
    ipcRenderer.invoke("supadense:git-diff-files", projectDir),
  gitFileDiff: (projectDir: string, filePath: string): Promise<string | null> =>
    ipcRenderer.invoke("supadense:git-file-diff", projectDir, filePath),
}

contextBridge.exposeInMainWorld("supadense", supadenseApi)
