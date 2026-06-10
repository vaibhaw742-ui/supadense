# Supadense MCP Server

**Supadense Engineering Brain** — capture knowledge, manage project sources, and surface context as you build.

Exposes the engineering brain and Experiential Learning (EL) projects as an MCP server so external coding agents (Claude Code, Claude Desktop, Cursor) can search, read, and write knowledge across projects.

## Brain Tools

Tools for managing the L0/L1/L2 knowledge graph that grows as you build.

| Tool | Scope | Description |
|------|-------|-------------|
| `search_brain` | read | Search the engineering brain — cascades L2 (architecture) → L1 (patterns) → L0 (decisions) |
| `get_brain_node` | read | Fetch full node content by slug |
| `get_brain_context` | read | Surface what the brain already knows about the current task |
| `list_brain_nodes` | read | List nodes with layer/type filters |
| `find_brain_experts` | read | Find people with expertise on a topic |
| `find_brain_connections` | read | Traverse knowledge graph from a node |
| `save_to_brain` | write | Capture a decision, pattern, or architectural insight — writes .md file + Postgres |
| `delete_brain_node` | write | Delete node (requires confirm=true) |
| `delete_brain_edge` | write | Remove relationship between nodes |

## EL Project Tools

Tools for managing Experiential Learning projects — the per-project brain with sources, files, and graph.

| Tool | Scope | Description |
|------|-------|-------------|
| `el_list_projects` | read | List all EL projects for a user |
| `el_get_project` | read | Get project details (name, status, GitHub URL) |
| `el_list_resources` | read | List all captured sources for a project |
| `el_get_resource_content` | read | Get full markdown content of a captured source |
| `el_add_resource` | write | Capture a URL and add it to an EL project (triggers Airtop scraping) |
| `el_get_graph` | read | Get knowledge graph nodes for a project |
| `el_get_project_file` | read | Read a file from the project's cloned GitHub repo |
| `el_get_brain_files` | read | List brain .md files (L0/L1/L2) for a project |
| `capture_source` | write | Capture any URL as markdown — scrapes with Airtop, writes to .supadense/sources/ |

## Usage

### Option 1: HTTP (any agent with HTTP support)

```
POST http://localhost:4096/mcp
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json

{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_brain","arguments":{"query":"why did we choose postgres over sqlite"}}}
```

### Option 2: Stdio bridge (Claude Code / Claude Desktop)

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
    "supadense": {
      "command": "bun",
      "args": ["run", "/path/to/supadense/packages/opencode/src/brain/mcp/stdio.ts"],
      "env": {
        "SUPADENSE_URL":     "http://localhost:4096",
        "SUPADENSE_TOKEN":   "YOUR_JWT_TOKEN",
        "SUPADENSE_PROJECT": "your-project-id"
      }
    }
  }
}
```

Restart Claude Desktop. All 18 tools appear in Claude's tool list.

### Option 3: Cursor

In Cursor settings → MCP → Add server:
- Type: HTTP
- URL: `http://localhost:4096/mcp`
- Auth: Bearer `YOUR_JWT_TOKEN`

## Brain Layers

| Layer | What to store | When to use |
|-------|--------------|-------------|
| L0 | Decisions — why X was chosen over Y | After making a specific call this session |
| L1 | Patterns — recurring solutions and conventions | When you've seen something more than once |
| L2 | Architecture — structural facts that rarely change | For core system boundaries and data flows |

## Trust Boundary

- All external agent calls are treated as `remote=true` (untrusted)
- `delete_brain_node` and `delete_brain_edge` require `confirm=true` — returns preview without it
- All authenticated Supadense users get read+write+admin scope by default
