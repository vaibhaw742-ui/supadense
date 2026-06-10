// Serves the supadense CLI installer and CLI script files
// Usage: curl -fsSL http://localhost:4096/install.sh | bash

import { Hono }         from "hono"
import { readFileSync }  from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
// Resolve to packages/opencode/src/brain/mcp/
const MCP_DIR = join(__dirname, "..", "..", "brain", "mcp")

export const InstallRoutes = new Hono()

// ── install.sh ────────────────────────────────────────────────────────────────
InstallRoutes.get("/install.sh", (c) => {
  const host = new URL(c.req.url).origin

  const script = /* bash */ `#!/usr/bin/env bash
set -e

SUPADENSE_URL="${host}"
INSTALL_DIR="$HOME/.supadense"
BIN_DIR="$INSTALL_DIR/bin"
CLI_SCRIPT="$INSTALL_DIR/supadense-cli.ts"
STDIO_SCRIPT="$INSTALL_DIR/stdio.ts"
WRAPPER="$BIN_DIR/supadense"

# ── Colors ────────────────────────────────────────────────────────────────────
BOLD="\\033[1m"
GREEN="\\033[32m"
CYAN="\\033[36m"
GRAY="\\033[90m"
RED="\\033[31m"
RESET="\\033[0m"

ok()   { echo -e "\${GREEN}✓\${RESET} $1"; }
info() { echo -e "\${CYAN}→\${RESET} $1"; }
fail() { echo -e "\${RED}✗\${RESET} $1"; exit 1; }

echo ""
echo -e "\${BOLD}  Installing Supadense CLI\${RESET}"
echo -e "\${GRAY}  ─────────────────────────────────────\${RESET}"
echo ""

# ── Check bun ─────────────────────────────────────────────────────────────────
if ! command -v bun &>/dev/null; then
  echo -e "\${RED}✗ bun is not installed.\${RESET}"
  echo "  Install it from: https://bun.sh"
  echo "  Then re-run this installer."
  exit 1
fi
ok "bun \$(bun --version) found"

# ── Create dirs ───────────────────────────────────────────────────────────────
mkdir -p "$BIN_DIR"
mkdir -p "$INSTALL_DIR/config"

# ── Download CLI scripts ──────────────────────────────────────────────────────
info "Downloading CLI scripts from \${SUPADENSE_URL}…"
curl -fsSL "\${SUPADENSE_URL}/cli/supadense-cli.ts" -o "$CLI_SCRIPT"
curl -fsSL "\${SUPADENSE_URL}/cli/stdio.ts"         -o "$STDIO_SCRIPT"
ok "Scripts saved to $INSTALL_DIR"

# ── Write wrapper ─────────────────────────────────────────────────────────────
cat > "$WRAPPER" << 'WRAPPER_EOF'
#!/usr/bin/env bash
exec bun run "$HOME/.supadense/supadense-cli.ts" "$@"
WRAPPER_EOF
chmod +x "$WRAPPER"
ok "Wrapper written to $WRAPPER"

# ── Add to PATH + prompt ──────────────────────────────────────────────────────
SHELL_BLOCK='
# Supadense CLI
export PATH="$HOME/.supadense/bin:$PATH"

# Supadense prompt — shows (project-name) when inside a registered project
__supa_project() {
  local dir="$PWD"
  while [ "$dir" != "/" ]; do
    if [ -f "$dir/.mcp.json" ]; then
      local proj
      proj=$(python3 -c "import json,sys; d=json.load(open('"'"'$dir/.mcp.json'"'"')); s=d.get('"'"'mcpServers'"'"',{}); k=next(iter(s),None); print(s[k]['"'"'env'"'"']['"'"'SUPADENSE_PROJECT'"'"']) if k and '"'"'env'"'"' in s[k] else '"'"''"'"'" 2>/dev/null)
      if [ -n "$proj" ]; then echo "($proj)"; fi
      return
    fi
    dir=$(dirname "$dir")
  done
}

# Hook into prompt (works for zsh and bash)
if [ -n "$ZSH_VERSION" ]; then
  setopt PROMPT_SUBST 2>/dev/null || true
  PROMPT='"'"'%F{214}$(__supa_project)%f '"'"'$PROMPT
elif [ -n "$BASH_VERSION" ]; then
  PS1='"'"'\[\x1b[38;5;214m\]$(__supa_project)\[\x1b[0m\] '"'"'$PS1
fi'

add_to_shell() {
  local rc="$1"
  if [ -f "$rc" ] && ! grep -q ".supadense/bin" "$rc"; then
    echo "$SHELL_BLOCK" >> "$rc"
    ok "Added PATH + prompt to $rc"
  fi
}

add_to_shell "$HOME/.zshrc"
add_to_shell "$HOME/.bashrc"
add_to_shell "$HOME/.bash_profile"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "\${BOLD}  Done! Supadense CLI installed.\${RESET}"
echo ""
echo -e "  Run now:       \${CYAN}source ~/.zshrc && supadense login\${RESET}"
echo -e "  In any repo:   \${CYAN}supadense init\${RESET}"
echo ""
echo -e "\${GRAY}  Supadense must be running at \${SUPADENSE_URL} for CLI to work.\${RESET}"
echo ""
`

  return c.text(script, 200, { "Content-Type": "text/x-shellscript" })
})

// ── Serve the CLI source files ────────────────────────────────────────────────
InstallRoutes.get("/cli/supadense-cli.ts", (c) => {
  try {
    const src = readFileSync(join(MCP_DIR, "supadense-cli.ts"), "utf8")
    return c.text(src, 200, { "Content-Type": "text/plain" })
  } catch {
    return c.text("Not found", 404)
  }
})

InstallRoutes.get("/cli/stdio.ts", (c) => {
  try {
    const src = readFileSync(join(MCP_DIR, "stdio.ts"), "utf8")
    return c.text(src, 200, { "Content-Type": "text/plain" })
  } catch {
    return c.text("Not found", 404)
  }
})
