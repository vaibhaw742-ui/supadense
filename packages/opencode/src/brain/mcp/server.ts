// HTTP MCP endpoint — JSON-RPC 2.0 over POST /mcp
// Mirrors gbrain's HTTP MCP server but uses supadense's existing JWT auth

import { Hono }                    from "hono"
import { getMcpToolDefs }          from "./schema"
import { dispatchBrainTool }       from "./dispatch"
import { dispatchElTool, getElToolDefs, EL_TOOL_SCOPES } from "./el-tools"
import type { McpScope }           from "./dispatch"

interface JsonRpcRequest {
  jsonrpc: "2.0"
  id:      number | string | null
  method:  string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: "2.0"
  id:      number | string | null
  result?: unknown
  error?:  { code: number; message: string; data?: unknown }
}

function ok(id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result }
}

function err(id: JsonRpcRequest["id"], code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } }
}

/** Extract scopes — authenticated supadense users get read+write+admin */
function extractScopes(_payload: Record<string, unknown> | null): McpScope[] {
  // All authenticated supadense users get full brain access by default.
  // Future: add per-token scope restrictions via brain_mcp_tokens table.
  return ["read", "write", "admin"]
}

export const McpRoutes = new Hono()

// POST /mcp — JSON-RPC 2.0 endpoint
McpRoutes.post("/", async (c) => {
  // Parse body
  let req: JsonRpcRequest
  try {
    req = await c.req.json() as JsonRpcRequest
  } catch {
    return c.json(err(null, -32700, "Parse error"))
  }

  if (req.jsonrpc !== "2.0") {
    return c.json(err(req.id ?? null, -32600, "Invalid JSON-RPC version"))
  }

  const id = req.id ?? null

  // Get scopes from the verified token (middleware already set payload in context)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = (c as any).get?.("jwtPayload") as Record<string, unknown> | null
  const scopes  = extractScopes(payload)

  // ── Method dispatch ────────────────────────────────────────────────────

  // Initialize (MCP handshake)
  if (req.method === "initialize") {
    return c.json(ok(id, {
      protocolVersion: "2024-11-05",
      capabilities:    { tools: {} },
      serverInfo:      { name: "supadense-brain", version: "1.0.0" },
    }))
  }

  // tools/list — return all brain + EL tool schemas (filtered by scope)
  if (req.method === "tools/list") {
    const BRAIN_SCOPES: Record<string, McpScope> = {
      save_to_brain: "write", delete_brain_node: "write", delete_brain_edge: "write",
      ingest_meeting: "write", analyze_repo: "admin", capture_git_events: "admin",
    }
    const scopeLevel = (s: McpScope) => s === "read" ? 0 : s === "write" ? 1 : 2
    const hasScope = (required: McpScope) => scopes.some(s => scopeLevel(s) >= scopeLevel(required))

    const brainTools = getMcpToolDefs().filter(t => hasScope(BRAIN_SCOPES[t.name] ?? "read"))
    const elTools    = getElToolDefs().filter(t => hasScope((EL_TOOL_SCOPES[t.name] ?? "read") as McpScope))

    return c.json(ok(id, { tools: [...brainTools, ...elTools] }))
  }

  // tools/call — dispatch to brain or EL handler
  if (req.method === "tools/call") {
    const { name, arguments: args } = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> }
    if (!name) return c.json(err(id, -32602, "Missing tool name"))

    // Route EL tools separately
    if (name.startsWith("el_")) {
      const result = await dispatchElTool(name, args ?? {}, scopes)
      return c.json(ok(id, result))
    }

    const result = await dispatchBrainTool(name, args ?? {}, scopes, true /* remote=true */)
    return c.json(ok(id, result))
  }

  // notifications/initialized — acknowledge silently
  if (req.method === "notifications/initialized") {
    return c.json(ok(id, {}))
  }

  return c.json(err(id, -32601, `Method not found: ${req.method}`))
})

// GET /mcp — SSE stream (for streaming tool results, optional)
McpRoutes.get("/", async (c) => {
  return c.json({
    name:    "supadense-brain-mcp",
    version: "1.0.0",
    tools:   getMcpToolDefs().length,
    hint:    "POST to this endpoint with JSON-RPC 2.0 to interact with the brain",
  })
})
