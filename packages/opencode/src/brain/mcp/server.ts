// HTTP MCP endpoint — JSON-RPC 2.0 over POST /mcp
// Mirrors gbrain's HTTP MCP server but uses supadense's existing JWT auth

import { Hono }                    from "hono"
import { getMcpToolDefs }          from "./schema"
import { dispatchBrainTool }       from "./dispatch"
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

  // tools/list — return all brain tool schemas (filtered by scope)
  if (req.method === "tools/list") {
    const all    = getMcpToolDefs()
    const SCOPES: Record<string, McpScope> = {
      save_to_brain: "write", delete_brain_node: "write", delete_brain_edge: "write",
      ingest_meeting: "write", analyze_repo: "admin", capture_git_events: "admin",
    }
    const tools = all.filter(t => {
      const required = SCOPES[t.name] ?? "read"
      return scopes.some(s =>
        (s === "admin") ||
        (s === "write" && required !== "admin") ||
        (s === "read"  && required === "read")
      )
    })
    return c.json(ok(id, { tools }))
  }

  // tools/call — dispatch to brain handler
  if (req.method === "tools/call") {
    const { name, arguments: args } = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> }
    if (!name) return c.json(err(id, -32602, "Missing tool name"))

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
