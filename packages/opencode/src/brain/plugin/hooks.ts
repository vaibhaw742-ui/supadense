import { captureToBrain }  from "../capture"
import { brainSearch }     from "../search/hybrid"
import { existsSync, statSync } from "node:fs"
import { join }            from "node:path"

// ── Signal patterns (always-on capture detector) ──────────────────────────

const SIGNAL_PATTERNS = [
  /\bI noticed\b/i,
  /\bIdea:\s/i,
  /\bRemember:\s/i,
  /\bProblem:\s/i,
  /\bWe should\b/i,
  /\bTODO:\s/i,
  /\bDecision:\s/i,
  /\bKey insight:\b/i,
  /\bImportant:\s/i,
]

function detectSignal(text: string): { excerpt: string; text: string } | null {
  for (const pattern of SIGNAL_PATTERNS) {
    const m = pattern.exec(text)
    if (m) {
      const start = m.index
      const excerpt = text.slice(start, start + 100).replace(/\n/g, " ").trim()
      return { excerpt, text: text.slice(start).trim() }
    }
  }
  return null
}

// ── onMessage: signal detector ────────────────────────────────────────────

export interface MessageHookCtx {
  role:      "user" | "assistant"
  content:   string
  sessionId: string
  queueSuggestion?: (s: { type: string; message: string; action: () => Promise<unknown> }) => void
}

export async function onMessage(ctx: MessageHookCtx): Promise<void> {
  if (ctx.role !== "user") return

  const signal = detectSignal(ctx.content)
  if (!signal) return

  ctx.queueSuggestion?.({
    type:    "brain_capture",
    message: `Signal detected: "${signal.excerpt}". Save to brain?`,
    action:  async () =>
      captureToBrain({ content: signal.text, type: "note", layer: 0 }),
  })
}

// ── onSessionEnd: synthesis offer ─────────────────────────────────────────

const DECISION_RE = /\bdecided?\b|\bchose?\b|\bwill use\b|\bgoing with\b|\bagreed?\b|\bsolution:\b/i

export interface SessionEndCtx {
  sessionId:   string
  title:       string
  messages:    Array<{ role: "user" | "assistant"; content: string }>
  notifyUser?: (n: { type: string; message: string; previewSlug?: string }) => void
  model?:      unknown
}

export async function onSessionEnd(ctx: SessionEndCtx): Promise<void> {
  if (ctx.messages.length < 5) return

  const hasDecisions = ctx.messages.some((m) => DECISION_RE.test(m.content ?? ""))
  if (!hasDecisions) return

  const slug = `L1/sessions/${new Date().toISOString().slice(0, 10)}-${ctx.sessionId.slice(0, 8)}`

  ctx.notifyUser?.({
    type:        "brain_synthesis_offer",
    message:     `Session "${ctx.title}" produced decisions. Save synthesis to brain?`,
    previewSlug: slug,
  })
}

// ── onProjectOpen: architecture doc freshness ─────────────────────────────

export interface ProjectOpenCtx {
  projectName: string
  directory:   string
  brainDir:    string
  notifyUser?: (n: { type: string; message: string }) => void
}

export async function onProjectOpen(ctx: ProjectOpenCtx): Promise<void> {
  const archDoc = join(ctx.brainDir, "L1", "projects", ctx.projectName, "architecture.md")

  if (!existsSync(archDoc)) {
    ctx.notifyUser?.({
      type:    "brain_analysis_offer",
      message: `No architecture docs found for ${ctx.projectName}. Generate from codebase?`,
    })
    return
  }

  // Check staleness: any code file newer than the arch doc?
  const archMtime = statSync(archDoc).mtimeMs
  const stale = isCodeNewerThan(ctx.directory, archMtime)
  if (stale) {
    ctx.notifyUser?.({
      type:    "brain_analysis_offer",
      message: `Architecture docs for ${ctx.projectName} may be stale. Regenerate?`,
    })
  }
}

function isCodeNewerThan(dir: string, mtime: number, depth = 0): boolean {
  if (depth > 3) return false
  try {
    const { readdirSync, statSync: ss } = require("node:fs")
    const SKIP = new Set(["node_modules", ".git", ".brain", "dist", "build"])
    for (const entry of readdirSync(dir)) {
      if (SKIP.has(entry)) continue
      const full = join(dir, entry)
      const stat = ss(full)
      if (stat.isDirectory()) {
        if (isCodeNewerThan(full, mtime, depth + 1)) return true
      } else if (/\.(ts|js|py|go|rs|java|sql)$/.test(entry)) {
        if (stat.mtimeMs > mtime) return true
      }
    }
  } catch {}
  return false
}
