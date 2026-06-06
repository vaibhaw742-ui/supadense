import { createHash }        from "node:crypto"
import { brainDb }           from "../db"
import {
  ensureDatabase, ensureSchema,
  pushFullSync, pushDiff, fetchTerminusPageSlugs,
} from "./client"

type PageRow = { id: number; slug: string; title: string; type: string; source_id: string; layer: number; updated_at: string; deleted_at: string | null }
type LinkRow = { from_slug: string; to_slug: string; from_title: string; to_title: string; link_type: string; source_id: string }

interface BridgeState {
  snapshotHash: string
  pages:        PageRow[]
  links:        LinkRow[]
}

let prevState: BridgeState | null = null
let isRunning = false
let _timer: ReturnType<typeof setInterval> | null = null

async function waitForTerminus(maxAttempts = 15): Promise<boolean> {
  const url  = process.env.BRAIN_TERMINUSDB_URL ?? "http://localhost:6363"
  const pass = process.env.BRAIN_TERMINUSDB_PASS ?? "admin"
  const auth = "Basic " + Buffer.from(`admin:${pass}`).toString("base64")

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${url}/api/info`, { headers: { Authorization: auth } })
      if (res.ok) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 2000))
  }
  return false
}

async function fetchCurrentState(): Promise<BridgeState> {
  const db = brainDb()

  const pages = await db`
    SELECT id, slug, title, type, source_id, layer,
           updated_at::text, deleted_at::text
    FROM brain_pages
    ORDER BY source_id, slug
  ` as PageRow[]

  const links = await db`
    SELECT fp.slug AS from_slug, fp.title AS from_title,
           tp.slug AS to_slug,   tp.title AS to_title,
           l.link_type, fp.source_id
    FROM brain_links l
    JOIN brain_pages fp ON fp.id = l.from_page_id
    JOIN brain_pages tp ON tp.id = l.to_page_id
    WHERE fp.deleted_at IS NULL AND tp.deleted_at IS NULL
    ORDER BY fp.source_id, fp.slug, l.link_type
  ` as LinkRow[]

  const data = JSON.stringify({
    pages: pages.map((p) => ({ slug: p.slug, sid: p.source_id, hash: p.updated_at, del: !!p.deleted_at })),
    links: links.map((l) => ({ f: l.from_slug, t: l.to_slug, lt: l.link_type, s: l.source_id })),
  })
  const snapshotHash = createHash("sha256").update(data).digest("hex").slice(0, 16)

  return { pages, links, snapshotHash }
}

function computeDiff(prev: BridgeState, current: BridgeState, sourceId: string) {
  const prevMap  = new Map(prev.pages.map((p) => [`${p.source_id}::${p.slug}`, p]))
  const currMap  = new Map(current.pages.map((p) => [`${p.source_id}::${p.slug}`, p]))

  const added_pages:        PageRow[] = []
  const updated_pages:      PageRow[] = []
  const removed_page_slugs: string[]  = []

  for (const [key, page] of currMap) {
    if (page.source_id !== sourceId) continue
    if (!page.deleted_at) {
      const prev_page = prevMap.get(key)
      if (!prev_page)                               added_pages.push(page)
      else if (prev_page.updated_at !== page.updated_at) updated_pages.push(page)
    }
  }
  for (const [key, page] of prevMap) {
    if (page.source_id !== sourceId || page.deleted_at) continue
    if (!currMap.has(key)) removed_page_slugs.push(key)
  }

  const prevLinkKeys = new Set(
    prev.links.filter((l) => l.source_id === sourceId)
              .map((l) => `${l.source_id}::${l.from_slug}::${l.to_slug}::${l.link_type}`),
  )
  const currLinkKeys = new Set(
    current.links.filter((l) => l.source_id === sourceId)
                 .map((l) => `${l.source_id}::${l.from_slug}::${l.to_slug}::${l.link_type}`),
  )

  const added_links   = current.links.filter((l) => l.source_id === sourceId && !prevLinkKeys.has(`${l.source_id}::${l.from_slug}::${l.to_slug}::${l.link_type}`))
  const removed_links = prev.links.filter((l)    => l.source_id === sourceId && !currLinkKeys.has(`${l.source_id}::${l.from_slug}::${l.to_slug}::${l.link_type}`))

  return { added_pages, updated_pages, removed_page_slugs, added_links, removed_links }
}

async function tick(): Promise<void> {
  if (isRunning) return
  isRunning = true
  try {
    const current    = await fetchCurrentState()
    if (prevState?.snapshotHash === current.snapshotHash) return

    const sourceIds  = [...new Set([...current.pages.map((p) => p.source_id), "default"])]

    if (!prevState) {
      await pushFullSync(current.pages, current.links, sourceIds)
    } else {
      let anyChange = false
      for (const sid of sourceIds) {
        const diff = computeDiff(prevState, current, sid)
        const total = diff.added_pages.length + diff.updated_pages.length +
                      diff.removed_page_slugs.length + diff.added_links.length
        if (total > 0) { await pushDiff(diff, sid); anyChange = true }
      }
      if (!anyChange) { prevState = current; return }
    }

    prevState = current
  } catch (err) {
    console.error("[brain/bridge] tick error:", err instanceof Error ? err.message : err)
  } finally {
    isRunning = false
  }
}

export async function startVersioningBridge(intervalMs = 30_000): Promise<void> {
  if (_timer) return

  const ready = await waitForTerminus()
  if (!ready) {
    console.warn("[brain/bridge] TerminusDB not reachable — versioning disabled")
    return
  }

  await ensureDatabase()
  await ensureSchema()
  console.log("[brain/bridge] connected to TerminusDB")

  // Initial sync
  await tick()

  _timer = setInterval(tick, intervalMs)
}

export function stopVersioningBridge(): void {
  if (_timer) { clearInterval(_timer); _timer = null }
}
