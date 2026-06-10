// Per-session brain context — maps sessionID → { brainDir, sourceId }
// Set when a session opens with an EL project, read by brain tools.

export interface BrainSessionCtx {
  brainDir:  string   // absolute path to the project's brain/ folder
  sourceId:  string   // Postgres brain_pages.source_id (= project ID or "inbox-{userId}")
  projectId: string
}

const _ctxMap = new Map<string, BrainSessionCtx>()

export function setBrainSessionCtx(sessionId: string, ctx: BrainSessionCtx): void {
  _ctxMap.set(sessionId, ctx)
}

export function getBrainSessionCtx(sessionId: string): BrainSessionCtx | null {
  return _ctxMap.get(sessionId) ?? null
}

export function clearBrainSessionCtx(sessionId: string): void {
  _ctxMap.delete(sessionId)
}

/** Get brainDir + sourceId for a session, falling back to the user's inbox brain. */
export function resolveBrainCtx(sessionId: string): { brainDir: string | null; sourceId: string } {
  const ctx = _ctxMap.get(sessionId)
  if (ctx) return { brainDir: ctx.brainDir, sourceId: ctx.sourceId }

  // Fall back to per-user inbox brain scoped by userId from the current Instance.
  // This ensures two users without an active project don't share the same brain.
  try {
    const { Instance } = require("../project/instance") as typeof import("../project/instance")
    const userId = Instance.current.userId
    if (userId) {
      return {
        brainDir: process.env.BRAIN_DIR ?? null,
        sourceId: `inbox-${userId}`,
      }
    }
  } catch {}

  // Last resort: truly global fallback (CLI / unauthenticated use)
  return {
    brainDir: process.env.BRAIN_DIR ?? null,
    sourceId: process.env.BRAIN_SOURCE_ID ?? "default",
  }
}
