import { watch, type FSWatcher } from "chokidar"
import path from "path"

const watchers = new Map<string, FSWatcher>()

export namespace KbWatcher {
  export function start(workspaceId: string, kbPath: string): void {
    if (watchers.has(workspaceId)) return

    const wikiDir = path.join(kbPath, "wiki")

    const watcher = watch(wikiDir, {
      ignoreInitial: true,
      depth: 10,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
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
