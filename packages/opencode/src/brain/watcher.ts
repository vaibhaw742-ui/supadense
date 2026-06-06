import { readFileSync, existsSync } from "node:fs"
import { join, relative }           from "node:path"
import { captureToBrain }            from "./capture"
import { brainDb }                   from "./db"
import { deriveSlug }                from "./slugify"

type FSWatcher = { close(): void }

// Support multiple concurrent watchers (one per active project)
const _watchers = new Map<string, FSWatcher>()

async function importFromDisk(filePath: string, brainDir: string, sourceId: string): Promise<void> {
  try {
    const content = readFileSync(filePath, "utf8")
    const slug    = deriveSlug(filePath, brainDir)
    await captureToBrain({ content, slug, source_id: sourceId })
  } catch (err) {
    console.error("[brain/watcher] import error:", err instanceof Error ? err.message : err)
  }
}

async function softDeleteFromDisk(filePath: string, brainDir: string, sourceId: string): Promise<void> {
  const slug = deriveSlug(filePath, brainDir)
  const db   = brainDb()
  await db`
    UPDATE brain_pages SET deleted_at = now()
    WHERE slug = ${slug} AND source_id = ${sourceId} AND deleted_at IS NULL
  `.catch(() => null)
}

export async function startBrainWatcher(brainDir: string, sourceId = "default"): Promise<void> {
  if (_watchers.has(sourceId)) return   // already watching this source
  if (!existsSync(brainDir)) return

  try {
    const { watch } = await import("chokidar")
    const pattern   = join(brainDir, "**/*.md")

    const watcher = watch(pattern, {
      ignoreInitial:    true,
      usePolling:       true,      // required for Docker bind mounts on macOS
      interval:         2000,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 200 },
    })

    ;(watcher as ReturnType<typeof watch>)
      .on("add",    (f: string) => importFromDisk(f, brainDir, sourceId))
      .on("change", (f: string) => importFromDisk(f, brainDir, sourceId))
      .on("unlink", (f: string) => softDeleteFromDisk(f, brainDir, sourceId))

    _watchers.set(sourceId, watcher)
    console.log(`[brain/watcher] watching ${brainDir} (source: ${sourceId})`)
  } catch {
    console.warn("[brain/watcher] chokidar not available — file watching disabled")
  }
}

export function stopBrainWatcher(sourceId?: string): void {
  if (sourceId) {
    const w = _watchers.get(sourceId)
    if (w) { w.close(); _watchers.delete(sourceId) }
  } else {
    for (const [id, w] of _watchers) { w.close(); _watchers.delete(id) }
  }
}

/** Initial sync: walk all .md files in brainDir and import them */
export async function initialSync(brainDir: string, sourceId = "default"): Promise<number> {
  if (!existsSync(brainDir)) return 0

  const files = await walkMdFiles(brainDir)
  let count   = 0

  for (const file of files) {
    await importFromDisk(file, brainDir, sourceId)
    count++
  }

  console.log(`[brain/watcher] initial sync: ${count} files from ${brainDir}`)
  return count
}

async function walkMdFiles(dir: string, depth = 0): Promise<string[]> {
  if (depth > 6) return []
  const { readdirSync, statSync } = await import("node:fs")
  const SKIP = new Set(["node_modules", ".git", "dist"])
  const files: string[] = []

  try {
    for (const entry of readdirSync(dir).filter((e: string) => !e.startsWith("."))) {
      if (SKIP.has(entry)) continue
      const full = join(dir, entry)
      const stat = statSync(full)
      if (stat.isDirectory()) files.push(...await walkMdFiles(full, depth + 1))
      else if (entry.endsWith(".md")) files.push(full)
    }
  } catch {}

  return files
}
