import { BrainTools }         from "./tools"
import { onMessage, onSessionEnd, onProjectOpen } from "./hooks"
import { loadBrainSkills, buildSkillSystemPrompt } from "../skills/loader"
import { existsSync }          from "node:fs"
import { join }                from "node:path"
import { startBrainWatcher, initialSync } from "../watcher"
import { setSearchEmbeddingModel }        from "../search/hybrid"
import { setEmbeddingModel }             from "../embed"

export interface BrainPluginContext {
  projectDirectory: string
  sourceId?:        string
  embeddingModel?:  unknown
  registerTool?:    (name: string, def: unknown) => void
  appendSystemPrompt?: (text: string) => void
}

export async function initBrainPlugin(ctx: BrainPluginContext): Promise<void> {
  const brainDir = join(ctx.projectDirectory, ".brain")
  const sourceId = ctx.sourceId ?? "default"

  if (!existsSync(brainDir)) {
    // No brain folder — plugin no-ops but tools still registered
    console.log(`[brain/plugin] no .brain/ folder at ${brainDir} — brain features inactive`)
  }

  // Register embedding model if provided
  if (ctx.embeddingModel) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setEmbeddingModel(ctx.embeddingModel as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setSearchEmbeddingModel(ctx.embeddingModel as any)
  }

  // Register all brain tools
  if (ctx.registerTool) {
    for (const [name, tool] of Object.entries(BrainTools)) {
      ctx.registerTool(name, tool)
    }
  }

  // Build skill system prompt from built-in + user skills
  if (ctx.appendSystemPrompt && existsSync(brainDir)) {
    const skills  = loadBrainSkills(brainDir)
    const prompt  = buildSkillSystemPrompt(skills)
    if (prompt) ctx.appendSystemPrompt(prompt)
  }

  // Start file watcher + initial sync
  if (existsSync(brainDir)) {
    await initialSync(brainDir, sourceId)
    await startBrainWatcher(brainDir, sourceId)
  }
}

// Re-export hooks for wiring into session lifecycle
export { onMessage, onSessionEnd, onProjectOpen }
export { BrainTools }
