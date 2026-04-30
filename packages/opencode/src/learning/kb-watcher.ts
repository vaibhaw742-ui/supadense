import { watch, type FSWatcher } from "chokidar"
import path from "path"
import { Workspace } from "./workspace"

const watchers = new Map<string, FSWatcher>()

export namespace KbWatcher {
  export function start(workspaceId: string, kbPath: string): void {
    if (watchers.has(workspaceId)) return

    const wikiDir = path.join(kbPath, "wiki")
    const wikiDirNorm = wikiDir.replace(/\\/g, "/").replace(/\/$/, "")

    const watcher = watch(wikiDir, {
      ignoreInitial: true,
      depth: 10,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    })

    watcher.on("addDir", (dirPath: string) => {
      const norm = dirPath.replace(/\\/g, "/").replace(/\/$/, "")
      if (norm === wikiDirNorm) return
      const rel = path.relative(kbPath, dirPath).replace(/\\/g, "/")
      Workspace.syncFolderAdded(workspaceId, rel)
    })

    watcher.on("unlinkDir", (dirPath: string) => {
      const rel = path.relative(kbPath, dirPath).replace(/\\/g, "/")
      Workspace.syncFolderRemoved(workspaceId, rel)
    })

    watcher.on("add", (filePath: string) => {
      if (!filePath.endsWith(".md")) return
      const fileName = path.basename(filePath)
      if (fileName === "overview.md") return
      const rel = path.relative(kbPath, filePath).replace(/\\/g, "/")
      Workspace.syncFileAdded(workspaceId, rel)
    })

    watcher.on("unlink", (filePath: string) => {
      if (!filePath.endsWith(".md")) return
      const rel = path.relative(kbPath, filePath).replace(/\\/g, "/")
      Workspace.syncFileRemoved(workspaceId, rel)
    })

    watchers.set(workspaceId, watcher)
  }

  export function stop(workspaceId: string): void {
    const w = watchers.get(workspaceId)
    if (w) {
      w.close()
      watchers.delete(workspaceId)
    }
  }

  export function stopAll(): void {
    for (const [id] of watchers) stop(id)
  }
}
