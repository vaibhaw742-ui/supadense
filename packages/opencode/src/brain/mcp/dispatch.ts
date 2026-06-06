// MCP tool call dispatcher — mirrors gbrain's src/mcp/dispatch.ts
// Validates params, applies trust boundary, calls BrainTools handlers

import { BrainTools } from "../plugin/tools"

export type McpScope = "read" | "write" | "admin"

// Which scope each tool requires
const TOOL_SCOPES: Record<string, McpScope> = {
  search_brain:          "read",
  get_brain_node:        "read",
  list_brain_nodes:      "read",
  find_brain_experts:    "read",
  find_brain_connections:"read",
  get_brain_graph:       "read",
  get_brain_context:     "read",
  save_to_brain:         "write",
  delete_brain_node:     "write",
  delete_brain_edge:     "write",
  ingest_meeting:        "write",
  analyze_repo:          "admin",
  capture_git_events:    "admin",
}

function scopeLevel(scope: McpScope): number {
  return scope === "read" ? 0 : scope === "write" ? 1 : 2
}

function hasScope(granted: McpScope[], required: McpScope): boolean {
  return granted.some(g => scopeLevel(g) >= scopeLevel(required))
}

export interface DispatchResult {
  content:  Array<{ type: "text"; text: string }>
  isError?: boolean
}

export async function dispatchBrainTool(
  name:    string,
  args:    Record<string, unknown>,
  scopes:  McpScope[] = ["read"],
  remote = true,
): Promise<DispatchResult> {
  // 1. Find tool
  const tool = (BrainTools as Record<string, typeof BrainTools[keyof typeof BrainTools]>)[name]
  if (!tool) {
    return errResult(`Unknown brain tool: ${name}`)
  }

  // 2. Scope check
  const required = TOOL_SCOPES[name] ?? "read"
  if (!hasScope(scopes, required)) {
    return errResult(`Tool '${name}' requires '${required}' scope. Token has: [${scopes.join(", ")}]`)
  }

  // 3. Trust boundary: remote agents cannot skip confirmation on delete
  if (remote && (name === "delete_brain_node" || name === "delete_brain_edge")) {
    const confirmArg = args.confirm
    if (confirmArg !== true) {
      // Return preview instead of erroring — agents must explicitly confirm
      args = { ...args, confirm: false }
    }
  }

  // 4. Validate params via Zod
  const parsed = tool.parameters.safeParse(args)
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join(", ")
    return errResult(`Invalid params for '${name}': ${issues}`)
  }

  // 5. Execute
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (tool.execute as (p: any) => Promise<unknown>)(parsed.data)
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return errResult(`Tool '${name}' failed: ${msg}`)
  }
}

function errResult(message: string): DispatchResult {
  return {
    content:  [{ type: "text", text: JSON.stringify({ error: message }) }],
    isError:  true,
  }
}
