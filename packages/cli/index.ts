#!/usr/bin/env bun
// supadense CLI
//
// Commands:
//   login                    — authenticate and save API key
//   init [--name N]          — register cwd as a local project + write .mcp.json
//   status                   — show registered projects
//   whoami                   — print current user info
//   projects                 — list all registered projects
//   sources list|add|remove  — manage sources
//   brain list|search        — brain file ops
//   sync                     — push all pending brain files to server
//   unregister [id]          — remove project registration
//   deinit [-f] [id]         — unregister + delete .supadense/ from disk
//   --mcp                    — launch MCP stdio bridge (used by .mcp.json)

import { mkdirSync, writeFileSync, existsSync, readFileSync, appendFileSync, readdirSync, statSync } from "node:fs"
import { join, basename, dirname }                                             from "node:path"
import { homedir, hostname }                                                   from "node:os"
import * as readline                                                            from "node:readline"
import { fileURLToPath }                                                       from "node:url"
import { createHash }                                                          from "node:crypto"

// ── Colors ────────────────────────────────────────────────────────────────────
const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  blue:   "\x1b[34m",
  cyan:   "\x1b[36m",
  red:    "\x1b[31m",
  gray:   "\x1b[90m",
}

function c(color: keyof typeof C, text: string): string {
  return `${C[color]}${text}${C.reset}`
}

function log(msg: string)  { process.stdout.write(msg + "\n") }
function err(msg: string)  { process.stderr.write(c("red", "✗ ") + msg + "\n") }
function ok(msg: string)   { log(c("green", "✓ ") + msg) }
function info(msg: string) { log(c("blue", "→ ") + msg) }
function warn(msg: string) { log(c("yellow", "⚠ ") + msg) }

// ── Config file ───────────────────────────────────────────────────────────────
const CONFIG_DIR  = join(homedir(), ".supadense")
const CONFIG_FILE = join(CONFIG_DIR, "config.json")

interface Config {
  url:    string
  apiKey: string
  userId?: string
  email?:  string
}

function readConfig(): Config | null {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as Config
  } catch {
    return null
  }
}

function writeConfig(cfg: Config) {
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8")
}

// ── Prompt helpers ────────────────────────────────────────────────────────────
function prompt(question: string, defaultValue = ""): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const display = defaultValue ? `${question} ${c("gray", `[${defaultValue}]`)}: ` : `${question}: `
    rl.question(display, (answer) => {
      rl.close()
      resolve(answer.trim() || defaultValue)
    })
  })
}

function promptPassword(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question + ": ")
    const { stdin } = process
    stdin.setRawMode?.(true)
    stdin.resume()
    stdin.setEncoding("utf8")
    let password = ""
    stdin.on("data", function handler(ch: string) {
      if (ch === "\r" || ch === "\n") {
        stdin.setRawMode?.(false)
        stdin.pause()
        stdin.removeListener("data", handler)
        process.stdout.write("\n")
        resolve(password)
      } else if (ch === "") {
        process.exit(1)
      } else if (ch === "") {
        password = password.slice(0, -1)
        process.stdout.write("\b \b")
      } else {
        password += ch
        process.stdout.write("*")
      }
    })
  })
}

// Numbered-list picker — prints items, asks for a number, returns chosen index
async function promptSelect(question: string, items: string[]): Promise<number> {
  for (let i = 0; i < items.length; i++) {
    log(`  ${c("cyan", String(i + 1))}. ${items[i]}`)
  }
  log("")
  const answer = await prompt(question)
  const n = parseInt(answer, 10)
  if (isNaN(n) || n < 1 || n > items.length) {
    err(`Invalid selection: "${answer}"`)
    process.exit(1)
  }
  return n - 1
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
async function api(
  url: string,
  path: string,
  opts: { method?: string; body?: unknown; token?: string } = {},
): Promise<{ ok: boolean; status: number; data: any }> {
  const method  = opts.method ?? (opts.body ? "POST" : "GET")
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`

  const res = await fetch(`${url}${path}`, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })

  let data: any
  try { data = await res.json() } catch { data = {} }

  return { ok: res.ok, status: res.status, data }
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function cmdLogin() {
  log("")
  log(c("bold", "  supadense login"))
  log(c("gray",  "  ─────────────────────────────────────"))
  log("")

  const url = await prompt("  Supadense URL", "http://localhost:4096")

  // Check if this server requires authentication
  const enabledRes = await api(url, "/supa-auth/enabled").catch(() => null)
  const authEnabled = enabledRes?.data?.enabled === true

  let jwt: string | undefined
  let email: string | undefined

  if (authEnabled) {
    email    = await prompt("  Email")
    const pw = await promptPassword("  Password")
    log("")
    info("Authenticating…")

    const loginRes = await api(url, "/supa-auth/login", { body: { email, password: pw } })
    if (!loginRes.ok) {
      err(`Login failed: ${loginRes.data?.error ?? loginRes.status}`)
      process.exit(1)
    }
    jwt = loginRes.data?.token as string | undefined
    if (!jwt) { err("No token in response"); process.exit(1) }
    ok("Authenticated")
  } else {
    log("")
    info("Local dev server detected — no password required")
  }

  info("Generating permanent API key…")

  const host   = hostname()
  const keyRes = await api(url, "/api-keys", { body: { name: `cli-${host}` }, token: jwt })
  if (!keyRes.ok) {
    err(`Failed to create API key: ${keyRes.data?.error ?? keyRes.status}`)
    process.exit(1)
  }

  const apiKey = keyRes.data?.key as string | undefined
  if (!apiKey) { err("No key in response"); process.exit(1) }

  const cfg: Config = { url, apiKey, ...(email ? { email } : {}) }
  writeConfig(cfg)

  log("")
  ok("Logged in!")
  log("")
  log(c("bold",   "  API Key (save this — it will not be shown again):"))
  log(c("cyan",   `  ${apiKey}`))
  log("")
  log(c("gray",   `  Config saved to: ${CONFIG_FILE}`))
  log("")
}

function detectGithubRepo(dir: string): string | null {
  try {
    const gitConfig = join(dir, ".git", "config")
    if (!existsSync(gitConfig)) return null
    const content = readFileSync(gitConfig, "utf8")
    // Match: url = git@github.com:owner/repo.git  OR  url = https://github.com/owner/repo.git
    const match = content.match(/url\s*=\s*(?:git@github\.com:|https:\/\/github\.com\/)([^\/\s]+\/[^\s\.]+)/)
    if (!match) return null
    return match[1].replace(/\.git$/, "")
  } catch {
    return null
  }
}

async function cmdInit(args: string[]) {
  log("")
  log(c("bold", "  supadense init"))
  log(c("gray",  "  ─────────────────────────────────────"))
  log("")

  const cfg = readConfig()
  if (!cfg) {
    err("Not logged in. Run: bun run supadense-cli.ts login")
    process.exit(1)
  }

  const cwd     = process.cwd()
  const nameIdx = args.indexOf("--name")
  const name    = nameIdx >= 0 ? args[nameIdx + 1] : basename(cwd)

  if (!name) { err("--name requires a value"); process.exit(1) }

  // Detect GitHub repo from .git/config
  const githubRepo = detectGithubRepo(cwd)
  if (githubRepo) info(`Detected GitHub repo: ${c("cyan", githubRepo)}`)

  info(`Registering project "${name}" at ${cwd}…`)

  const regRes = await api(cfg.url, "/local-projects", {
    body:  { name, local_path: cwd, github_repo: githubRepo ?? undefined },
    token: cfg.apiKey,
  })
  if (!regRes.ok) {
    err(`Failed to register project: ${regRes.data?.error ?? regRes.status}`)
    process.exit(1)
  }

  const proj = regRes.data as {
    id:         string
    brain_dir:  string
    sources_dir: string
  }

  // Create local dirs
  const brainBase = join(cwd, ".supadense", "brain")
  mkdirSync(join(brainBase, "L0"), { recursive: true })
  mkdirSync(join(brainBase, "L1"), { recursive: true })
  mkdirSync(join(brainBase, "L2"), { recursive: true })
  mkdirSync(join(cwd, ".supadense", "sources"), { recursive: true })

  // Create README.md in brain
  const readme = join(brainBase, "README.md")
  if (!existsSync(readme)) {
    writeFileSync(readme, [
      "# Brain Knowledge",
      "",
      "Knowledge captured during Claude Code sessions on this project.",
      "",
      "## Layers",
      "- `L0/` — raw decisions, facts, notes captured during sessions",
      "- `L1/` — synthesised summaries (auto-generated by Supadense)",
      "- `L2/` — durable patterns and architectural decisions",
      "",
      "## Git",
      "Brain files are gitignored by default (local knowledge).",
      "You CAN commit them if you want to share knowledge with your team — just",
      "remove the `.supadense/brain/` line from `.gitignore`.",
    ].join("\n"), "utf8")
    ok("Created .supadense/brain/README.md")
  }

  // Write .mcp.json
  const stdioPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "stdio.ts",
  )

  const mcpConfig = {
    mcpServers: {
      "supadense-brain": {
        command: "npx",
        args:    ["supadense", "--mcp"],
        env:     {
          SUPADENSE_URL:     cfg.url,
          SUPADENSE_TOKEN:   cfg.apiKey,
          SUPADENSE_PROJECT: proj.id,
        },
      },
    },
  }

  const mcpFile = join(cwd, ".mcp.json")
  let existing: any = {}
  if (existsSync(mcpFile)) {
    try { existing = JSON.parse(readFileSync(mcpFile, "utf8")) } catch {}
  }
  const merged = { ...existing, mcpServers: { ...(existing.mcpServers ?? {}), ...mcpConfig.mcpServers } }
  writeFileSync(mcpFile, JSON.stringify(merged, null, 2), "utf8")
  ok("Written .mcp.json")

  // Update .gitignore
  const gitignore = join(cwd, ".gitignore")
  if (existsSync(gitignore)) {
    const content = readFileSync(gitignore, "utf8")
    const line    = ".supadense/brain/"
    if (!content.includes(line)) {
      appendFileSync(gitignore, `\n# Supadense brain files (local knowledge — remove to commit)\n${line}\n`)
      ok("Appended .supadense/brain/ to .gitignore")
    } else {
      info(".gitignore already ignores .supadense/brain/")
    }
  } else {
    warn(".gitignore not found — brain files will not be gitignored automatically")
  }

  log("")
  log(c("bold", "  Done!"))
  log("")
  log(`  Project ID:   ${c("cyan",  proj.id)}`)
  log(`  Brain dir:    ${c("gray",  join(cwd, ".supadense", "brain"))}`)
  log(`  Sources dir:  ${c("gray",  join(cwd, ".supadense", "sources"))}`)
  log(`  MCP config:   ${c("gray",  mcpFile)}`)
  log("")
  log(c("dim", "  Claude Code will pick up the MCP server automatically via .mcp.json."))
  log(c("dim", "  Brain files are gitignored by default — you CAN commit them."))
  log("")
}

async function cmdProjects() {
  const cfg = readConfig()
  if (!cfg) { err("Not logged in. Run: supadense login"); process.exit(1) }

  const res = await api(cfg.url, "/local-projects", { token: cfg.apiKey })
  if (!res.ok) { err("Failed to list projects"); process.exit(1) }

  const projects = (res.data?.projects ?? []) as Array<{
    id: string; name: string; local_path: string; github_repo?: string | null; time_created: number
  }>

  if (projects.length === 0) {
    log("")
    warn("No projects registered yet. Run: supadense init")
    log("")
    return
  }

  const cwd = process.cwd()

  log("")
  log(c("bold", `Registered projects (${projects.length}):`))
  log("")

  for (const p of projects) {
    const isCurrent = cwd.startsWith(p.local_path)
    const marker = isCurrent ? c("cyan", "▶ ") : "  "
    log(`${marker}${c("bold", p.name)}  ${c("gray", p.id)}`)
    log(`    ${c("gray", "path:")}   ${p.local_path}`)
    if (p.github_repo) log(`    ${c("gray", "github:")} ${p.github_repo}`)
    log("")
  }
}

async function cmdStatus() {
  const cfg = readConfig()
  if (!cfg) { err("Not logged in. Run: bun run supadense-cli.ts login"); process.exit(1) }

  const cwd = process.cwd()
  const res = await api(cfg.url, "/local-projects", { token: cfg.apiKey })
  if (!res.ok) { err(`Failed to fetch projects: ${res.data?.error ?? res.status}`); process.exit(1) }

  const projects: Array<{ id: string; name: string; local_path: string }> = res.data?.projects ?? []

  log("")
  log(c("bold", "  Registered projects"))
  log(c("gray",  "  ─────────────────────────────────────"))
  log("")

  if (projects.length === 0) {
    warn("No projects registered. Run: bun run supadense-cli.ts init")
  } else {
    for (const p of projects) {
      const isCurrent = p.local_path === cwd
      const marker    = isCurrent ? c("green", " ◀ current") : ""
      log(`  ${c("cyan", p.id)}${marker}`)
      log(`  ${c("gray",  `  name: ${p.name}`)}`)
      log(`  ${c("gray",  `  path: ${p.local_path}`)}`)
      log("")
    }
  }

  const registered = projects.some((p) => p.local_path === cwd)
  if (!registered) {
    warn(`Current directory (${cwd}) is not registered. Run: bun run supadense-cli.ts init`)
  }
}

// ── Helper: resolve current project ID from cwd ──────────────────────────────
async function resolveCurrentProject(cfg: Config): Promise<{ id: string; name: string; local_path: string } | null> {
  const cwd = process.cwd()
  const res = await api(cfg.url, "/local-projects", { token: cfg.apiKey })
  if (!res.ok) return null
  const projects: Array<{ id: string; name: string; local_path: string }> = res.data?.projects ?? []
  return projects.find((p) => cwd.startsWith(p.local_path)) ?? null
}

// ── sources ───────────────────────────────────────────────────────────────────

async function resolveProject(cfg: Config, args: string[]): Promise<{ id: string; name: string; local_path: string } | null> {
  const flagIdx = args.indexOf("--project")
  if (flagIdx >= 0) {
    const id  = args[flagIdx + 1]
    if (!id) { err("--project requires a project id"); process.exit(1) }
    const res = await api(cfg.url, `/local-projects/${id}`, { token: cfg.apiKey })
    if (!res.ok) { err(`Project "${id}" not found`); process.exit(1) }
    return { id: res.data.id, name: res.data.name, local_path: res.data.local_path }
  }
  return resolveCurrentProject(cfg)
}

async function cmdSources(args: string[]) {
  const cfg = readConfig()
  if (!cfg) { err("Not logged in. Run: supadense login"); process.exit(1) }

  const sub = args[0] ?? "list"

  if (sub === "list") {
    const proj = await resolveProject(cfg, args)
    if (!proj) { err("Not inside a registered project. Run: supadense init\n  Or use: supadense sources list --project <id>"); process.exit(1) }

    const res = await api(cfg.url, `/local-projects/${proj.id}/sources`, { token: cfg.apiKey })
    if (!res.ok) { err(`Failed: ${res.data?.error ?? res.status}`); process.exit(1) }

    const sources: Array<{ name: string; size: number }> = res.data?.sources ?? []

    log("")
    log(c("bold", `  Sources — ${proj.name}`))
    log(c("gray",  "  ─────────────────────────────────────"))
    log("")

    if (sources.length === 0) {
      warn("No sources yet. Add one: supadense sources add <url>")
    } else {
      for (const s of sources) {
        const kb = (s.size / 1024).toFixed(1)
        log(`  ${c("cyan", s.name)}  ${c("gray", kb + " KB")}`)
      }
      log("")
      log(c("gray", `  ${sources.length} source(s) total`))
    }
    log("")
    return
  }

  if (sub === "add") {
    const urlOrContent = args[1]
    if (!urlOrContent) { err("Usage: supadense sources add <url> [--project <id>] [--project <id>] [--all-projects]"); process.exit(1) }

    const addAll = args.includes("--all-projects")

    // Collect --project flags (may appear multiple times)
    const projectFlags: string[] = []
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--project" && args[i + 1]) {
        projectFlags.push(args[i + 1])
        i++
      }
    }

    // Resolve target projects
    let targetProjects: Array<{ id: string; name: string; local_path: string }>

    if (addAll) {
      const res = await api(cfg.url, "/local-projects", { token: cfg.apiKey })
      if (!res.ok) { err(`Failed to list projects: ${res.data?.error ?? res.status}`); process.exit(1) }
      targetProjects = (res.data?.projects ?? []) as Array<{ id: string; name: string; local_path: string }>
      if (targetProjects.length === 0) { err("No registered projects found. Run: supadense init"); process.exit(1) }
    } else if (projectFlags.length > 0) {
      // Fetch all projects once, then match by id or name
      const res = await api(cfg.url, "/local-projects", { token: cfg.apiKey })
      if (!res.ok) { err(`Failed to list projects`); process.exit(1) }
      const allProjs = (res.data?.projects ?? []) as Array<{ id: string; name: string; local_path: string }>
      targetProjects = projectFlags.map((flag) => {
        const match = allProjs.find(p => p.id === flag || p.name === flag)
        if (!match) { err(`Project not found: "${flag}"`); process.exit(1) }
        return match!
      })
    } else {
      // Default: current directory project
      const proj = await resolveProject(cfg, args)
      if (!proj) { err("Not inside a registered project. Run: supadense init\n  Or use: --project <id>"); process.exit(1) }
      targetProjects = [proj]
    }

    const isUrl = urlOrContent.startsWith("http://") || urlOrContent.startsWith("https://")
    const body  = isUrl ? { url: urlOrContent } : { content: urlOrContent, type: "note" }

    log("")
    info(isUrl ? `Adding ${urlOrContent} to ${targetProjects.length} project(s)…` : `Saving note to ${targetProjects.length} project(s)…`)
    log("")

    for (const proj of targetProjects) {
      const res = await api(cfg.url, `/local-projects/${proj.id}/sources`, { body, token: cfg.apiKey })
      if (!res.ok) {
        warn(`  ${proj.name}: failed — ${res.data?.error ?? res.status}`)
        continue
      }
      if (res.data?.queued) {
        ok(`  ${proj.name}: queued (${res.data.fname})`)
      } else {
        ok(`  ${proj.name}: saved as ${res.data?.saved ?? "source"}`)
      }
    }

    if (isUrl) {
      log("")
      log(c("gray", `  URLs are processed in the background via Airtop.`))
      log(c("gray", `  Run ${c("cyan", "supadense sources list")} in a few minutes to see results.`))
    }
    log("")
    return
  }

  if (sub === "remove") {
    // Resolve project (current dir or --project flag)
    const proj = await resolveProject(cfg, args)
    if (!proj) { err("Not inside a registered project. Run: supadense init\n  Or use: --project <id>"); process.exit(1) }

    // Fetch sources for this project
    const srcRes = await api(cfg.url, `/local-projects/${proj.id}/sources`, { token: cfg.apiKey })
    if (!srcRes.ok) { err("Failed to list sources"); process.exit(1) }
    const sources = (srcRes.data?.sources ?? []) as Array<{ name: string; title: string; status: string }>

    if (sources.length === 0) {
      warn(`No sources found in project "${proj.name}".`)
      return
    }

    log("")
    log(c("bold", `Sources in "${proj.name}":`))
    log("")

    const labels = sources.map(s => {
      const status = s.status === "processing" ? c("gray", " (processing)") : s.status === "failed" ? c("red", " (failed)") : ""
      return `${s.title}${status}`
    })

    const idx = await promptSelect("Select source to remove (enter number)", labels)
    const chosen = sources[idx]

    log("")
    const confirm = await prompt(`Remove "${chosen.title}" from "${proj.name}"? ${c("gray", "[yes/no]")}`)
    if (confirm.toLowerCase() !== "yes" && confirm.toLowerCase() !== "y") {
      log(c("gray", "Cancelled."))
      return
    }

    const res = await api(cfg.url, `/local-projects/${proj.id}/sources/${encodeURIComponent(chosen.name)}`, {
      method: "DELETE", token: cfg.apiKey,
    })
    log("")
    if (!res.ok) {
      err(`Failed to remove: ${res.data?.error ?? res.status}`)
      process.exit(1)
    }
    ok(`Removed "${chosen.title}" from "${proj.name}".`)
    log("")
    return
  }

  if (sub === "delete") {
    // Delete from ALL projects that have this file
    const filename = args[1]
    if (!filename) { err("Usage: supadense sources delete <filename> [--force]"); process.exit(1) }

    const force = args.includes("--force") || args.includes("-f")

    // Find all projects that have this file
    const projRes = await api(cfg.url, "/local-projects", { token: cfg.apiKey })
    if (!projRes.ok) { err("Failed to list projects"); process.exit(1) }
    const allProjs = (projRes.data?.projects ?? []) as Array<{ id: string; name: string; local_path: string }>

    // Check each project for the file
    const matches: Array<{ id: string; name: string }> = []
    for (const proj of allProjs) {
      const srcRes = await api(cfg.url, `/local-projects/${proj.id}/sources`, { token: cfg.apiKey })
      if (!srcRes.ok) continue
      const sources = (srcRes.data?.sources ?? []) as Array<{ name: string }>
      if (sources.some(s => s.name === filename)) matches.push(proj)
    }

    if (matches.length === 0) {
      err(`Source "${filename}" not found in any project`)
      process.exit(1)
    }

    log("")
    log(c("bold", `  "${filename}" found in ${matches.length} project(s):`))
    for (const p of matches) {
      log(`  ${c("dim", "·")} ${p.name}`)
    }
    log("")

    if (!force) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      const answer = await new Promise<string>((resolve) => {
        rl.question(`  Type ${c("bold", "yes")} to delete from all: `, resolve)
      })
      rl.close()
      log("")
      if (answer.trim().toLowerCase() !== "yes") { info("Cancelled."); log(""); return }
    }

    for (const proj of matches) {
      const res = await api(cfg.url, `/local-projects/${proj.id}/sources/${encodeURIComponent(filename)}`, {
        method: "DELETE", token: cfg.apiKey,
      })
      if (!res.ok) {
        warn(`  ${proj.name}: failed — ${res.data?.error ?? res.status}`)
      } else {
        ok(`  ${proj.name}: deleted`)
      }
    }
    log("")
    return
  }

  err(`Unknown subcommand: ${sub}. Try: supadense sources list | add | remove | delete`)
  process.exit(1)
}

// ── brain ─────────────────────────────────────────────────────────────────────

async function cmdBrain(args: string[]) {
  const cfg = readConfig()
  if (!cfg) { err("Not logged in. Run: supadense login"); process.exit(1) }

  const sub = args[0] ?? "list"

  if (sub === "list") {
    const proj = await resolveProject(cfg, args)
    if (!proj) { err("Not inside a registered project. Run: supadense init\n  Or use: supadense brain list --project <id>"); process.exit(1) }

    const res = await api(cfg.url, `/local-projects/${proj.id}`, { token: cfg.apiKey })
    if (!res.ok) { err(`Failed: ${res.data?.error ?? res.status}`); process.exit(1) }

    const files: string[] = res.data?.brain_files ?? []

    log("")
    log(c("bold", `  Brain — ${proj.name}`))
    log(c("gray",  "  ─────────────────────────────────────"))
    log("")

    if (files.length === 0) {
      warn("No brain files yet. Start a Claude Code session to capture knowledge.")
      log("")
      return
    }

    const byLayer: Record<string, string[]> = { L0: [], L1: [], L2: [] }
    for (const f of files) {
      const layer = f.startsWith("L0") ? "L0" : f.startsWith("L1") ? "L1" : "L2"
      byLayer[layer].push(f)
    }

    const layerLabel: Record<string, string> = {
      L0: "L0  decisions & raw notes",
      L1: "L1  synthesised summaries",
      L2: "L2  architectural patterns",
    }
    const layerColor: Record<string, keyof typeof C> = { L0: "yellow", L1: "cyan", L2: "green" }

    for (const layer of ["L0", "L1", "L2"]) {
      if (byLayer[layer].length === 0) continue
      log(`  ${c(layerColor[layer], layerLabel[layer])}  ${c("gray", `(${byLayer[layer].length})`)}`)
      for (const f of byLayer[layer]) {
        const name = f.replace(/^L[012]\//, "")
        log(`    ${c("gray", "·")} ${name}`)
      }
      log("")
    }

    log(c("gray", `  ${files.length} file(s) total`))
    log("")
    return
  }

  if (sub === "search") {
    const query = args.slice(1).join(" ")
    if (!query) { err("Usage: supadense brain search <query>"); process.exit(1) }

    const proj = await resolveProject(cfg, args)
    if (!proj) { err("Not inside a registered project. Run: supadense init\n  Or use: --project <id>"); process.exit(1) }

    info(`Searching brain for "${query}"…`)

    const res = await api(cfg.url, `/local-projects/${proj.id}/brain/search?query=${encodeURIComponent(query)}`, { token: cfg.apiKey })
    if (!res.ok) { err(`Failed: ${res.data?.error ?? res.status}`); process.exit(1) }

    const results: Array<{ slug: string; content: string; score?: number }> = res.data?.results ?? res.data ?? []

    log("")
    log(c("bold", `  Brain search — "${query}"`))
    log(c("gray",  "  ─────────────────────────────────────"))
    log("")

    if (results.length === 0) {
      warn("No results found.")
      log("")
      return
    }

    for (const r of results) {
      const score = r.score != null ? c("gray", ` (${(r.score * 100).toFixed(0)}%)`) : ""
      log(`  ${c("cyan", r.slug)}${score}`)
      const preview = r.content?.split("\n").slice(0, 3).join(" ").slice(0, 120)
      if (preview) log(`  ${c("gray", preview)}`)
      log("")
    }
    return
  }

  if (sub === "clear") {
    const projArg = args[1]
    if (!projArg) { err("Usage: supadense brain clear <project-id>"); process.exit(1) }
    err("Brain clear not yet implemented via CLI — use the Supadense UI.")
    process.exit(1)
  }

  err(`Unknown subcommand: ${sub}. Try: supadense brain list | search <query>`)
  process.exit(1)
}

// ── unregister ────────────────────────────────────────────────────────────────

async function cmdUnregister(args: string[]) {
  const cfg = readConfig()
  if (!cfg) { err("Not logged in. Run: supadense login"); process.exit(1) }

  let projectId = args[0]

  if (!projectId) {
    // Default to current directory
    const proj = await resolveCurrentProject(cfg)
    if (!proj) { err("Not inside a registered project and no project ID given."); process.exit(1) }
    projectId = proj.id
  }

  const res = await api(cfg.url, `/local-projects/${projectId}`, { method: "DELETE", token: cfg.apiKey })
  if (!res.ok) { err(`Failed: ${res.data?.error ?? res.status}`); process.exit(1) }

  log("")
  ok(`Project "${projectId}" unregistered from Supadense.`)
  log(c("gray", "  Brain files on disk are preserved — only the registration was removed."))
  log("")
}

function cleanupMcpAndGitignore(dir: string) {
  // Remove supadense-brain entry from .mcp.json
  const mcpFile = join(dir, ".mcp.json")
  if (existsSync(mcpFile)) {
    try {
      const mcp = JSON.parse(readFileSync(mcpFile, "utf8"))
      if (mcp.mcpServers?.["supadense-brain"]) {
        delete mcp.mcpServers["supadense-brain"]
        // If no other servers remain, remove the file entirely; otherwise update it
        if (Object.keys(mcp.mcpServers).length === 0) delete mcp.mcpServers
        if (Object.keys(mcp).length === 0) {
          const { unlinkSync } = require("fs") as typeof import("fs")
          unlinkSync(mcpFile)
          ok("Removed .mcp.json (was empty after cleanup)")
        } else {
          writeFileSync(mcpFile, JSON.stringify(mcp, null, 2) + "\n", "utf8")
          ok("Removed supadense-brain from .mcp.json")
        }
      }
    } catch { warn("Could not update .mcp.json — edit it manually") }
  }

  // Remove supadense lines from .gitignore
  const gitignore = join(dir, ".gitignore")
  if (existsSync(gitignore)) {
    try {
      const original = readFileSync(gitignore, "utf8")
      const cleaned  = original
        .split("\n")
        .filter(line => !line.includes(".supadense/brain") && !line.includes("Supadense brain files"))
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")  // collapse extra blank lines
      if (cleaned !== original) {
        writeFileSync(gitignore, cleaned, "utf8")
        ok("Removed .supadense/brain/ from .gitignore")
      }
    } catch { warn("Could not update .gitignore — edit it manually") }
  }
}

async function cmdDeinit(args: string[]) {
  const cfg = readConfig()
  if (!cfg) { err("Not logged in. Run: supadense login"); process.exit(1) }

  const force    = args.includes("--force") || args.includes("-f")
  const diskOnly = args.includes("--disk-only")

  // Resolve project path from current directory (or explicit --path flag)
  const cwd = process.cwd()
  const supadenseDir = join(cwd, ".supadense")

  if (diskOnly) {
    // Only delete .supadense/ from disk — project was already unregistered via frontend
    if (!existsSync(supadenseDir)) {
      err(`No .supadense/ folder found in ${cwd}`)
      process.exit(1)
    }

    log("")
    warn(`This will permanently delete .supadense/ in:`)
    warn(`  ${cwd}`)
    log("")

    if (!force) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      const answer = await new Promise<string>((resolve) => {
        rl.question(`  Type ${c("bold", "yes")} to confirm: `, resolve)
      })
      rl.close()
      log("")
      if (answer.trim().toLowerCase() !== "yes") { info("Cancelled."); log(""); return }
    }

    const { rm } = await import("node:fs/promises")
    await rm(supadenseDir, { recursive: true, force: true })
    ok(".supadense/ deleted from disk.")
    cleanupMcpAndGitignore(cwd)
    log("")
    return
  }

  // Full deinit: unregister from DB + delete disk
  const explicitId = args.find((a) => !a.startsWith("-"))
  let projectId: string
  let projectPath: string

  if (explicitId) {
    projectId = explicitId
    projectPath = cwd
  } else {
    const proj = await resolveCurrentProject(cfg)
    if (!proj) { err("Not inside a registered project. Run from inside the project directory or pass a project ID."); process.exit(1) }
    projectId = proj.id
    projectPath = proj.local_path
  }

  const targetDir = join(projectPath, ".supadense")

  log("")
  warn(`This will permanently delete .supadense/ inside:`)
  warn(`  ${projectPath}`)
  warn("Your source code files will NOT be touched.")
  log("")

  if (!force) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const answer = await new Promise<string>((resolve) => {
      rl.question(`  Type ${c("bold", "yes")} to confirm deinit: `, resolve)
    })
    rl.close()
    log("")
    if (answer.trim().toLowerCase() !== "yes") { info("Cancelled."); log(""); return }
  }

  // Unregister from DB (backend — no disk delete, we do it here on host)
  const res = await api(cfg.url, `/local-projects/${projectId}`, { method: "DELETE", token: cfg.apiKey })
  if (!res.ok) { err(`Failed to unregister: ${res.data?.error ?? res.status}`); process.exit(1) }

  // Delete .supadense/ from disk (runs on host, not in Docker)
  if (existsSync(targetDir)) {
    const { rm } = await import("node:fs/promises")
    await rm(targetDir, { recursive: true, force: true })
    ok(".supadense/ deleted from disk.")
  }

  cleanupMcpAndGitignore(projectPath)

  log("")
  ok(`Project "${projectId}" deinitialized.`)
  log("")
}

async function cmdWhoami() {
  const cfg = readConfig()
  if (!cfg) { err("Not logged in. Run: bun run supadense-cli.ts login"); process.exit(1) }

  const res = await api(cfg.url, "/supa-auth/me", { token: cfg.apiKey })
  if (!res.ok) { err(`Failed: ${res.data?.error ?? res.status}`); process.exit(1) }

  log("")
  log(c("bold", "  Current user"))
  log(c("gray",  "  ─────────────────────────────────────"))
  log("")
  for (const [k, v] of Object.entries(res.data ?? {})) {
    log(`  ${c("dim", k + ":")} ${String(v)}`)
  }
  log(`  ${c("dim", "server:")} ${cfg.url}`)
  log("")
}

// ── sync ──────────────────────────────────────────────────────────────────────

function fileHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16)
}

async function cmdSync(args: string[]) {
  const cfg = readConfig()
  if (!cfg) { err("Not logged in. Run: supadense login"); process.exit(1) }

  // Resolve project
  const proj = await resolveProject(cfg, args)
  if (!proj) { err("Not inside a registered project. Run: supadense init\n  Or use: --project <id>"); process.exit(1) }

  const supadenseDir = join(proj.local_path, ".supadense")
  const syncStatePath = join(supadenseDir, ".sync-state.json")
  const brainDir = join(supadenseDir, "brain")

  if (!existsSync(brainDir)) {
    warn("No brain directory found. Nothing to sync.")
    return
  }

  // Read current sync state
  let syncState: Record<string, { hash: string; synced: boolean; modified_at: number }> = {}
  try { syncState = JSON.parse(readFileSync(syncStatePath, "utf8")) } catch {}

  // Collect all brain .md files
  const toSync: Array<{ path: string; content: string; modified_at: number }> = []

  for (const layer of ["L0", "L1", "L2"]) {
    const layerDir = join(brainDir, layer)
    if (!existsSync(layerDir)) continue
    for (const entry of readdirSync(layerDir, { recursive: true }) as string[]) {
      if (!entry.endsWith(".md")) continue
      const absPath     = join(layerDir, entry)
      const relativePath = `brain/${layer}/${entry}`
      const content     = readFileSync(absPath, "utf8")
      const hash        = fileHash(content)
      const existing    = syncState[relativePath]

      if (!existing || existing.hash !== hash || !existing.synced) {
        toSync.push({ path: `${layer}/${entry}`, content, modified_at: statSync(absPath).mtimeMs })
        syncState[relativePath] = { hash, synced: false, modified_at: statSync(absPath).mtimeMs }
      }
    }
  }

  if (toSync.length === 0) {
    ok("Everything is already synced.")
    return
  }

  log("")
  info(`Syncing ${toSync.length} brain file(s) to ${cfg.url}…`)

  const res = await api(cfg.url, `/brain/sync`, {
    method: "POST",
    body: {
      files:      toSync,
      source_id:  `local-${proj.id}`,
      project_id: proj.id,
    },
    token: cfg.apiKey,
  })

  log("")
  if (!res.ok) {
    err(`Sync failed: ${res.data?.error ?? res.status}`)
    process.exit(1)
  }

  // Mark all as synced
  for (const f of toSync) {
    const relativePath = `brain/${f.path}`
    if (syncState[relativePath]) syncState[relativePath].synced = true
  }
  mkdirSync(supadenseDir, { recursive: true })
  writeFileSync(syncStatePath, JSON.stringify(syncState, null, 2), "utf8")

  ok(`Synced ${res.data?.synced ?? toSync.length} file(s) to server.`)
  log("")
}

// ── --mcp flag: launch MCP stdio bridge ───────────────────────────────────────

async function runMcp() {
  // Launch the MCP stdio bridge — same directory as this CLI file
  const localStdio = join(dirname(fileURLToPath(import.meta.url)), "stdio.ts")
  if (existsSync(localStdio)) {
    await import(localStdio)
  } else {
    process.stderr.write("[supadense] ERROR: stdio.ts not found. Reinstall supadense.\n")
    process.exit(1)
  }
}

// ── pull: download brain files from server → local .supadense/brain/ ─────────

async function cmdPull(args: string[]) {
  const cfg = readConfig()
  if (!cfg) { err("Not logged in. Run: supadense login"); process.exit(1) }

  const projBase = await resolveProject(cfg, args)
  if (!projBase) { err("Not inside a registered project. Run: supadense init\n  Or use: --project <id>"); process.exit(1) }

  // Fetch full project to get source_id
  const fullRes = await api(cfg.url, `/local-projects/${projBase.id}`, { token: cfg.apiKey })
  if (!fullRes.ok) { err(`Project "${projBase.id}" not found`); process.exit(1) }
  const proj = fullRes.data as { id: string; name: string; local_path: string; source_id: string }

  const sourceId     = proj.source_id ?? `local-${proj.id}`
  const supadenseDir = join(proj.local_path, ".supadense")
  const brainDir     = join(supadenseDir, "brain")
  const syncStatePath = join(supadenseDir, ".sync-state.json")

  log("")
  info(`Pulling brain files from ${cfg.url} for project ${c("cyan", proj.id)}…`)

  const res = await api(cfg.url, `/brain/export?source_id=${encodeURIComponent(sourceId)}`, {
    method: "GET",
    token:  cfg.apiKey,
  })

  if (!res.ok) {
    err(`Pull failed: ${res.data?.error ?? res.status}`)
    process.exit(1)
  }

  const { files, total } = res.data as { files: Array<{ path: string; content: string; updated_at: number }>; total: number }

  if (total === 0) {
    warn("No brain files found on server for this project.")
    return
  }

  // Read existing sync state
  let syncState: Record<string, { hash: string; synced: boolean; modified_at: number }> = {}
  try { syncState = JSON.parse(readFileSync(syncStatePath, "utf8")) } catch {}

  let written = 0, skipped = 0

  for (const file of files) {
    const absPath    = join(brainDir, file.path)
    const relPath    = `brain/${file.path}`
    const newHash    = fileHash(file.content)
    const existing   = syncState[relPath]

    // Skip if local version is identical
    if (existing?.hash === newHash && existsSync(absPath)) {
      skipped++
      continue
    }

    mkdirSync(dirname(absPath), { recursive: true })
    writeFileSync(absPath, file.content, "utf8")
    syncState[relPath] = { hash: newHash, synced: true, modified_at: file.updated_at }
    written++
  }

  // Persist sync state
  mkdirSync(supadenseDir, { recursive: true })
  writeFileSync(syncStatePath, JSON.stringify(syncState, null, 2), "utf8")

  log("")
  ok(`Pull complete: ${written} file(s) written, ${skipped} unchanged`)
  info(`Brain files are in: ${brainDir}`)
  log("")
}

// ── Main ──────────────────────────────────────────────────────────────────────

function printHelp() {
  log("")
  log(c("bold",  "  supadense CLI"))
  log(c("gray",   "  ─────────────────────────────────────"))
  log("")
  log(c("dim", "  Auth"))
  log("  " + c("cyan", "login") + "                      Authenticate and save API key")
  log("  " + c("cyan", "whoami") + "                     Print current user info")
  log("")
  log(c("dim", "  Projects"))
  log("  " + c("cyan", "projects") + "                    List all registered projects")
  log("  " + c("cyan", "init") + " [--name N]            Register cwd as a Supadense project")
  log("  " + c("cyan", "deinit") + " [-f] [project-id]       Unregister + delete .supadense/ from disk")
  log("  " + c("cyan", "deinit") + " --disk-only [-f]         Delete .supadense/ from disk only (already unregistered)")
  log("  " + c("cyan", "status") + "                     List all registered local projects")
  log("  " + c("cyan", "unregister") + " [project-id]    Remove project registration (keeps files)")
  log("")
  log(c("dim", "  Brain"))
  log("  " + c("cyan", "brain list") + "                 List all brain files in current project")
  log("  " + c("cyan", "brain search") + " <query>       Search the brain")
  log("  " + c("cyan", "sync") + "                       Push all pending brain files to server")
  log("  " + c("cyan", "pull") + "                       Pull brain files from server → local .supadense/")
  log("")
  log(c("dim", "  Sources"))
  log("  " + c("cyan", "sources list") + "                           List captured sources in current project")
  log("  " + c("cyan", "sources add") + " <url>                      Capture a URL — adds to current project")
  log("  " + c("cyan", "sources add") + " <url> --project <id>       Add to a specific project")
  log("  " + c("cyan", "sources add") + " <url> --project a --project b  Add to multiple projects")
  log("  " + c("cyan", "sources add") + " <url> --all-projects        Add to all registered projects")
  log("  " + c("cyan", "sources remove") + "                                List sources and pick one to remove")
  log("  " + c("cyan", "sources delete") + " <filename> [-f]               Delete from ALL projects (with confirm)")
  log("")
  log(c("dim", "  Usage: supadense <command> [args]"))
  log("")
}

const [, , command, ...rest] = process.argv

// --mcp flag: launch MCP stdio bridge (used by .mcp.json in Claude Code)
if (command === "--mcp") {
  await runMcp()
} else {
  switch (command) {
    case "login":       await cmdLogin();             break
    case "init":        await cmdInit(rest);          break
    case "status":      await cmdStatus();            break
    case "whoami":      await cmdWhoami();            break
    case "projects":    await cmdProjects();          break
    case "sources":     await cmdSources(rest);       break
    case "brain":       await cmdBrain(rest);         break
    case "sync":        await cmdSync(rest);          break
    case "pull":        await cmdPull(rest);          break
    case "unregister":  await cmdUnregister(rest);    break
    case "deinit":      await cmdDeinit(rest);        break
    default:            printHelp();                  break
  }
}
