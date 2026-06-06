# Supadense MCP Server

Exposes the supadense knowledge brain **and** Experiential Learning (EL) projects as an MCP server
so external coding agents (Claude Code, Claude Desktop, Cursor) can search, read, and write knowledge.

## Brain Tools

| Tool | Scope | Description |
|------|-------|-------------|
| `search_brain` | read | Cascade search L2→L1→L0 with vector + BM25 |
| `get_brain_node` | read | Fetch full node content by slug |
| `get_brain_context` | read | Auto-pull relevant context for a task |
| `list_brain_nodes` | read | List nodes with layer/type filters |
| `find_brain_experts` | read | Find people with expertise on a topic |
| `find_brain_connections` | read | Traverse knowledge graph from a node |
| `save_to_brain` | write | Save knowledge — writes .md file + Postgres |
| `delete_brain_node` | write | Delete node (requires confirm=true) |
| `delete_brain_edge` | write | Remove relationship between nodes |

## EL Project Tools

| Tool | Scope | Description |
|------|-------|-------------|
| `el_list_projects` | read | List all EL projects for a user |
| `el_get_project` | read | Get project details (name, status, GitHub URL, context) |
| `el_list_resources` | read | List all captured sources for a project |
| `el_get_resource_content` | read | Get full markdown content of a captured source |
| `el_add_resource` | write | Capture a URL and add it to a project (triggers Airtop) |
| `el_get_graph` | read | Get knowledge graph nodes (GitHub repo + source nodes) |
| `el_get_project_file` | read | Read a file from the project's cloned GitHub repo |
| `el_get_brain_files` | read | List brain `.md` files (L0/L1/L2) for a project |

## Usage

### Option 1: HTTP (any agent with HTTP support)

```
POST http://localhost:4096/mcp
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json

{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_brain","arguments":{"query":"event sourcing decision"}}}
```

### Option 2: Stdio bridge (Claude Desktop / Cursor)

Get a JWT token:
```bash
curl -X POST http://localhost:4096/supa-auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"yourpassword"}'
```

Add to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "supadense-brain": {
      "command": "bun",
      "args": ["run", "/path/to/supadense/packages/opencode/src/brain/mcp/stdio.ts"],
      "env": {
        "SUPADENSE_URL":   "http://localhost:4096",
        "SUPADENSE_TOKEN": "YOUR_JWT_TOKEN"
      }
    }
  }
}
```

Restart Claude Desktop. The brain tools appear in Claude's tool list.

### Option 3: Cursor

In Cursor settings → MCP → Add server:
- Type: HTTP
- URL: `http://localhost:4096/mcp`
- Auth: Bearer `YOUR_JWT_TOKEN`

## Trust Boundary

- All external agent calls are treated as `remote=true` (untrusted)
- `delete_brain_node` and `delete_brain_edge` require `confirm=true` — returns preview without it
- All authenticated supadense users get read+write+admin scope
- Future: per-token scope restrictions via `brain_mcp_tokens` table
