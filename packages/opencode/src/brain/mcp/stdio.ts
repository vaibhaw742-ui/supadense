#!/usr/bin/env bun
// Stdio MCP bridge — reads JSON-RPC from stdin, calls /mcp HTTP, writes to stdout
//
// For LOCAL projects (SUPADENSE_PROJECT set):
//   - Writes .brain/ files on the host Mac (container can't see host paths)
//   - Registers session context with supadense for per-project brain scoping
//   - Syncs existing .brain/ files to Postgres on startup
//
// Claude Code config (.claude/settings.json):
// {
//   "mcpServers": {
//     "supadense-brain": {
//       "command": "bun",
//       "args": ["run", "/path/to/supadense/src/brain/mcp/stdio.ts"],
//       "env": {
//         "SUPADENSE_URL":     "http://localhost:4096",
//         "SUPADENSE_TOKEN":   "your-jwt-token",
//         "SUPADENSE_PROJECT": "your-project-id"
//       }
//     }
//   }
// }

import { mkdirSync, writeFileSync, readdirSync, statSync, existsSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { createHash }    from "node:crypto"

const SUPADENSE_URL     = process.env.SUPADENSE_URL     ?? "http://localhost:4096"
const SUPADENSE_TOKEN   = process.env.SUPADENSE_TOKEN   ?? ""
const SUPADENSE_PROJECT = process.env.SUPADENSE_PROJECT ?? ""

if (!SUPADENSE_TOKEN) {
  process.stderr.write("[supadense-mcp] WARNING: SUPADENSE_TOKEN not set\n")
}

let _sessionId: string | null    = null
let _brainDir:  string | null    = null
let _sourceId:  string | null    = null

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

async function callHttp(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${SUPADENSE_URL}${path}`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": SUPADENSE_TOKEN ? `Bearer ${SUPADENSE_TOKEN}` : "",
    },
    body: JSON.stringify(body),
  })
  return res.json().catch(() => null)
}

// ── Local .brain/ file operations (runs on host Mac) ─────────────────────────

/** brainDir is already the .supadense/brain path */
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

function writeBrainFile(brainDir: string, slug: string, content: string, layer: number, type: string, query?: string): void {
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
  writeFileSync(filePath, fm + content + "\n", "utf8")
}

/** Sync all existing .brain/ .md files to Postgres on startup */
async function syncBrainToPostgres(brainDir: string, sourceId: string): Promise<void> {
  if (!existsSync(brainDir)) return
  let synced = 0

  for (const layer of ["L0", "L1", "L2"]) {
    const layerDir = join(brainDir, layer)
    if (!existsSync(layerDir)) continue
    for (const entry of readdirSync(layerDir, { recursive: true }) as string[]) {
      if (!entry.endsWith(".md")) continue
      const filePath = join(layerDir, entry)
      try {
        const content = readFileSync(filePath, "utf8")
        const slug    = `${layer}/${entry.replace(/\.md$/, "")}`
        await callHttp("/brain/capture", { content, slug, source_id: sourceId, layer: parseInt(layer[1]) })
        synced++
      } catch {}
    }
  }
  if (synced > 0) process.stderr.write(`[supadense-mcp] synced ${synced} brain files\n`)
}

// ── Session init ──────────────────────────────────────────────────────────────

async function initLocalSession(): Promise<void> {
  if (!SUPADENSE_PROJECT) return

  // Get project info from supadense
  const res = await fetch(`${SUPADENSE_URL}/local-projects/${SUPADENSE_PROJECT}`, {
    headers: { "Authorization": `Bearer ${SUPADENSE_TOKEN}` },
  })
  if (!res.ok) {
    process.stderr.write(`[supadense-mcp] project "${SUPADENSE_PROJECT}" not registered. Run: POST /local-projects\n`)
    return
  }

  const project = await res.json() as { brain_dir: string; source_id: string; local_path: string }
  _brainDir = project.brain_dir
  _sourceId = project.source_id

  // Create .brain/ dirs on host (container can't do this)
  ensureBrainDirs(_brainDir)

  // Sync existing files to Postgres
  await syncBrainToPostgres(_brainDir, _sourceId)

  // Register session context
  const sessionId = `mcp-${Date.now()}`
  _sessionId = sessionId
  await callHttp(`/local-projects/${SUPADENSE_PROJECT}/session-start`, { session_id: sessionId })
  process.stderr.write(`[supadense-mcp] ready: project=${SUPADENSE_PROJECT} source=${_sourceId}\n`)
}

// ── Intercept brain_save to write .md on host ────────────────────────────────

async function interceptSave(params: Record<string, unknown>, result: unknown): Promise<void> {
  if (!_brainDir || typeof params !== "object") return
  const { content, slug, layer = 0, type = "note", query } = params
  if (typeof content !== "string" || typeof slug !== "string") return

  try {
    writeBrainFile(_brainDir, String(slug), String(content), Number(layer), String(type), query ? String(query) : undefined)
  } catch (err) {
    process.stderr.write(`[supadense-mcp] file write error: ${err}\n`)
  }
}

// ── Intercept capture_source / el_add_resource to write .md on host ──────────

async function interceptWriteFile(result: unknown): Promise<void> {
  // The tool result is { jsonrpc, id, result: { content: [{ type, text }] } }
  // text is JSON with _write_file: { path, content }
  try {
    const outer = result as { result?: { content?: Array<{ type: string; text: string }> } }
    const text = outer?.result?.content?.[0]?.text
    if (!text) return
    const parsed = JSON.parse(text) as { _write_file?: { path: string; content: string } }
    const wf = parsed._write_file
    if (!wf || typeof wf.path !== "string" || typeof wf.content !== "string") return

    // Resolve relative to the project dir (or cwd if no project)
    const base = _brainDir ? dirname(dirname(_brainDir)) : process.cwd()  // .supadense/ parent
    const supadenseDir = _brainDir ? dirname(_brainDir) : join(base, ".supadense")
    const destPath = join(supadenseDir, wf.path)
    mkdirSync(dirname(destPath), { recursive: true })
    writeFileSync(destPath, wf.content, "utf8")
    process.stderr.write(`[supadense-mcp] wrote source: ${destPath}\n`)
  } catch (err) {
    process.stderr.write(`[supadense-mcp] _write_file error: ${err}\n`)
  }
}

// ── I/O ───────────────────────────────────────────────────────────────────────

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

        // Forward to HTTP MCP server
        const result = await callMcp(msg)

        // After save_to_brain, also write .md file on host (container can't write to Mac paths)
        if (msg.method === "tools/call" && msg.params?.name === "save_to_brain" && msg.params?.arguments) {
          await interceptSave(msg.params.arguments, result)
        }

        // After capture_source or el_add_resource, write the source .md on host
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
