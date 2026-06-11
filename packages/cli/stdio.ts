#!/usr/bin/env bun
// Stdio MCP bridge — reads JSON-RPC from stdin, calls /mcp HTTP, writes to stdout
//
// Architecture:
//   - Brain files live on developer's Mac inside .supadense/brain/
//   - This process runs locally (spawned by Claude Code via .mcp.json)
//   - All data pushed to backend via HTTP — no volume mount needed
//   - .supadense/.sync-state.json tracks which files are pending/synced
//   - On SIGTERM (Claude Code close): flush all pending files to server
//   - npx supadense sync: manual fallback flush

import { mkdirSync, writeFileSync, readdirSync, statSync, existsSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { createHash }    from "node:crypto"

const SUPADENSE_URL     = process.env.SUPADENSE_URL     ?? "http://localhost:4096"
const SUPADENSE_TOKEN   = process.env.SUPADENSE_TOKEN   ?? ""
const SUPADENSE_PROJECT = process.env.SUPADENSE_PROJECT ?? ""

if (!SUPADENSE_TOKEN) {
  process.stderr.write("[supadense-mcp] WARNING: SUPADENSE_TOKEN not set\n")
}

let _sessionId:  string | null = null
let _brainDir:   string | null = null
let _sourceId:   string | null = null
let _projectDir: string | null = null

// ── Sync state ────────────────────────────────────────────────────────────────

interface SyncEntry { hash: string; synced: boolean; modified_at: number }
type SyncState = Record<string, SyncEntry>

function syncStatePath(projectDir: string): string {
  return join(projectDir, ".supadense", ".sync-state.json")
}

function readSyncState(projectDir: string): SyncState {
  try {
    return JSON.parse(readFileSync(syncStatePath(projectDir), "utf8")) as SyncState
  } catch {
    return {}
  }
}

function writeSyncState(projectDir: string, state: SyncState): void {
  const p = syncStatePath(projectDir)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(state, null, 2), "utf8")
}

function fileHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16)
}

function markPending(projectDir: string, relativePath: string, content: string): void {
  const state = readSyncState(projectDir)
  state[relativePath] = { hash: fileHash(content), synced: false, modified_at: Date.now() }
  writeSyncState(projectDir, state)
}

function markSynced(projectDir: string, relativePath: string): void {
  const state = readSyncState(projectDir)
  if (state[relativePath]) {
    state[relativePath].synced = true
    writeSyncState(projectDir, state)
  }
}

function getPendingFiles(projectDir: string): Array<{ relativePath: string; entry: SyncEntry }> {
  const state = readSyncState(projectDir)
  return Object.entries(state)
    .filter(([, e]) => !e.synced)
    .map(([relativePath, entry]) => ({ relativePath, entry }))
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function callMcp(body: unknown): Promise<unknown> {
  const res = await fetch(`${SUPADENSE_URL}/mcp`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": SUPADENSE_TOKEN ? `Bearer ${SUPADENSE_TOKEN}` : "",
    },
    body: JSON.stringify(body),
  })
  return res.json()
}

async function callHttp(path: string, body: unknown): Promise<Response> {
  return fetch(`${SUPADENSE_URL}${path}`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": SUPADENSE_TOKEN ? `Bearer ${SUPADENSE_TOKEN}` : "",
    },
    body: JSON.stringify(body),
  })
}

// ── Brain file ops ────────────────────────────────────────────────────────────

function ensureBrainDirs(brainDir: string): void {
  mkdirSync(join(brainDir, "L0"), { recursive: true })
  mkdirSync(join(brainDir, "L1"), { recursive: true })
  mkdirSync(join(brainDir, "L2"), { recursive: true })
  const readme = join(brainDir, "README.md")
  if (!existsSync(readme)) {
    writeFileSync(readme,
      "# Brain Knowledge\n\nKnowledge captured during Claude Code sessions.\n- `L0/` decisions, notes\n- `L1/` syntheses\n- `L2/` patterns\n", "utf8")
  }
}

function writeBrainFile(brainDir: string, slug: string, content: string, layer: number, type: string, query?: string): string {
  const filePath = join(brainDir, slug + ".md")
  mkdirSync(dirname(filePath), { recursive: true })
  const fm = [
    "---",
    `type: ${type}`,
    `layer: ${layer}`,
    ...(query ? [`query: "${query.replace(/"/g, '\\"')}"`] : []),
    "---",
    "",
  ].join("\n")
  const full = fm + content + "\n"
  writeFileSync(filePath, full, "utf8")
  return full
}

// ── Push one brain file to server, track sync state ──────────────────────────

async function pushBrainFile(projectDir: string, relativePath: string, content: string, sourceId: string): Promise<void> {
  try {
    const layerMatch = relativePath.match(/^brain\/L([012])\//)
    const layer = layerMatch ? parseInt(layerMatch[1]) as 0 | 1 | 2 : 0
    const slug  = relativePath.replace(/^brain\//, "").replace(/\.md$/, "")

    const res = await callHttp("/brain/capture", {
      content,
      slug,
      layer,
      source_id: sourceId,
      contribution_type: "capture",
    })
    if (res.ok) {
      markSynced(projectDir, relativePath)
      process.stderr.write(`[supadense-mcp] synced: ${relativePath}\n`)
    } else {
      process.stderr.write(`[supadense-mcp] sync failed (${res.status}): ${relativePath}\n`)
    }
  } catch (e) {
    process.stderr.write(`[supadense-mcp] push error: ${relativePath}: ${e}\n`)
  }
}

// ── Flush all pending files (used on startup + SIGTERM) ──────────────────────

async function flushPending(label = "flush"): Promise<void> {
  if (!_projectDir || !_sourceId) return
  const pending = getPendingFiles(_projectDir)
  if (pending.length === 0) return

  process.stderr.write(`[supadense-mcp] ${label}: ${pending.length} pending file(s)\n`)

  // Bulk POST for efficiency
  const files = pending.map(({ relativePath }) => {
    const absPath = join(_projectDir!, ".supadense", relativePath)
    try {
      const content = readFileSync(absPath, "utf8")
      return { path: relativePath.replace(/^brain\//, ""), content, modified_at: Date.now() }
    } catch {
      return null
    }
  }).filter(Boolean)

  if (files.length === 0) return

  try {
    const res = await callHttp("/brain/sync", {
      files,
      source_id:  _sourceId,
      project_id: SUPADENSE_PROJECT,
    })
    if (res.ok) {
      const data = await res.json() as { synced?: number }
      // Mark all as synced
      const state = readSyncState(_projectDir)
      for (const { relativePath } of pending) {
        if (state[relativePath]) state[relativePath].synced = true
      }
      writeSyncState(_projectDir, state)
      process.stderr.write(`[supadense-mcp] ${label} complete: ${data.synced ?? files.length} synced\n`)
    } else {
      process.stderr.write(`[supadense-mcp] ${label} failed: HTTP ${res.status}\n`)
    }
  } catch (e) {
    process.stderr.write(`[supadense-mcp] ${label} error: ${e}\n`)
  }
}

// ── Startup: sync any files that weren't synced in previous session ───────────

async function syncOnStartup(brainDir: string, sourceId: string, projectDir: string): Promise<void> {
  if (!existsSync(brainDir)) return

  const state  = readSyncState(projectDir)
  let   queued = 0

  for (const layer of ["L0", "L1", "L2"]) {
    const layerDir = join(brainDir, layer)
    if (!existsSync(layerDir)) continue
    for (const entry of readdirSync(layerDir, { recursive: true }) as string[]) {
      if (!entry.endsWith(".md")) continue
      const relativePath = `brain/${layer}/${entry}`
      const absPath = join(layerDir, entry)
      const content = readFileSync(absPath, "utf8")
      const hash    = fileHash(content)
      const existing = state[relativePath]
      // Queue if not in state, or hash changed, or not synced
      if (!existing || existing.hash !== hash || !existing.synced) {
        state[relativePath] = { hash, synced: false, modified_at: statSync(absPath).mtimeMs }
        queued++
      }
    }
  }

  writeSyncState(projectDir, state)

  if (queued > 0) {
    process.stderr.write(`[supadense-mcp] startup: ${queued} file(s) need sync\n`)
    await flushPending("startup-sync")
  }
}

// ── Session init ──────────────────────────────────────────────────────────────

async function initLocalSession(): Promise<void> {
  if (!SUPADENSE_PROJECT) return

  const res = await fetch(`${SUPADENSE_URL}/local-projects/${SUPADENSE_PROJECT}`, {
    headers: { "Authorization": `Bearer ${SUPADENSE_TOKEN}` },
  })
  if (!res.ok) {
    process.stderr.write(`[supadense-mcp] project "${SUPADENSE_PROJECT}" not registered. Run: npx supadense init\n`)
    return
  }

  const project = await res.json() as { brain_dir: string; source_id: string; local_path: string }
  _brainDir   = project.brain_dir   // e.g. /Users/dev/my-app/.supadense/brain
  _sourceId   = project.source_id
  _projectDir = project.local_path  // e.g. /Users/dev/my-app

  ensureBrainDirs(_brainDir)

  // Sync any files that weren't synced last session
  await syncOnStartup(_brainDir, _sourceId, _projectDir)

  // Register session
  const sessionId = `mcp-${Date.now()}`
  _sessionId = sessionId
  await callHttp(`/local-projects/${SUPADENSE_PROJECT}/session-start`, { session_id: sessionId })
  process.stderr.write(`[supadense-mcp] ready: project=${SUPADENSE_PROJECT} source=${_sourceId}\n`)
}

// ── SIGTERM / SIGINT handler — flush pending on Claude Code close ─────────────

let _shutdownInProgress = false

async function shutdown(signal: string): Promise<void> {
  if (_shutdownInProgress) return
  _shutdownInProgress = true
  process.stderr.write(`[supadense-mcp] ${signal} received — flushing pending brain files…\n`)
  await flushPending("shutdown-flush")
  process.stderr.write(`[supadense-mcp] shutdown complete\n`)
  process.exit(0)
}

process.on("SIGTERM", () => { void shutdown("SIGTERM") })
process.on("SIGINT",  () => { void shutdown("SIGINT")  })
process.on("SIGHUP",  () => { void shutdown("SIGHUP")  })

// ── Intercept brain_save ──────────────────────────────────────────────────────

async function interceptSave(params: Record<string, unknown>): Promise<void> {
  if (!_brainDir || !_projectDir || !_sourceId) return
  const { content, slug, layer = 0, type = "note", query } = params
  if (typeof content !== "string" || typeof slug !== "string") return

  try {
    const fullContent = writeBrainFile(_brainDir, String(slug), String(content), Number(layer), String(type), query ? String(query) : undefined)
    const relativePath = `brain/${String(slug)}.md`

    // Mark pending first
    markPending(_projectDir, relativePath, fullContent)

    // Try immediate push
    await pushBrainFile(_projectDir, relativePath, fullContent, _sourceId)
  } catch (err) {
    process.stderr.write(`[supadense-mcp] interceptSave error: ${err}\n`)
  }
}

// ── Intercept capture_source / el_add_resource ────────────────────────────────

async function interceptWriteFile(result: unknown): Promise<void> {
  try {
    const outer = result as { result?: { content?: Array<{ type: string; text: string }> } }
    const text = outer?.result?.content?.[0]?.text
    if (!text) return
    const parsed = JSON.parse(text) as { _write_file?: { path: string; content: string } }
    const wf = parsed._write_file
    if (!wf || typeof wf.path !== "string" || typeof wf.content !== "string") return

    const base = _brainDir ? dirname(dirname(_brainDir)) : process.cwd()
    const supadenseDir = _brainDir ? dirname(_brainDir) : join(base, ".supadense")
    const destPath = join(supadenseDir, wf.path)
    mkdirSync(dirname(destPath), { recursive: true })
    writeFileSync(destPath, wf.content, "utf8")
    process.stderr.write(`[supadense-mcp] wrote source: ${destPath}\n`)
  } catch (err) {
    process.stderr.write(`[supadense-mcp] _write_file error: ${err}\n`)
  }
}

// ── I/O loop ──────────────────────────────────────────────────────────────────

function send(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj) + "\n")
}

async function readLines(): Promise<void> {
  const decoder = new TextDecoder()
  let buffer    = ""

  for await (const chunk of process.stdin) {
    buffer += decoder.decode(chunk as Uint8Array, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const msg = JSON.parse(trimmed) as {
          jsonrpc: string; method: string; id?: unknown
          params?: { name?: string; arguments?: Record<string, unknown> }
        }

        if (msg.method === "notifications/initialized") continue

        if (msg.method === "initialize") {
          const result = await callMcp(msg)
          await initLocalSession()
          send(result)
          continue
        }

        const result = await callMcp(msg)

        if (msg.method === "tools/call" && msg.params?.name === "save_to_brain" && msg.params?.arguments) {
          await interceptSave(msg.params.arguments)
        }

        if (msg.method === "tools/call" &&
            (msg.params?.name === "capture_source" || msg.params?.name === "el_add_resource")) {
          await interceptWriteFile(result)
        }

        send(result)
      } catch (err) {
        send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: String(err) } })
      }
    }
  }
}

process.stderr.write(`[supadense-mcp] connecting to ${SUPADENSE_URL}${SUPADENSE_PROJECT ? ` (project: ${SUPADENSE_PROJECT})` : ""}\n`)
readLines().catch(err => {
  process.stderr.write(`[supadense-mcp] fatal: ${err}\n`)
  process.exit(1)
})
