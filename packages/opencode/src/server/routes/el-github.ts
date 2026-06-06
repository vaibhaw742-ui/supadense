/**
 * el-github.ts — GitHub OAuth connection for EL projects
 *
 * Prefix: /el/github (registered in server.ts before /el)
 *
 * Env vars required:
 *   GITHUB_OAUTH_CLIENT_ID     — GitHub OAuth App client ID
 *   GITHUB_OAUTH_CLIENT_SECRET — GitHub OAuth App client secret
 *   GITHUB_OAUTH_CALLBACK_URL  — callback URL registered in GitHub App
 *                                (default: http://localhost:4096/el/github/callback)
 */
import { Hono } from "hono"
import crypto from "node:crypto"
import { lazy } from "../../util/lazy"
import { Database } from "../../storage/db"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getUserId(c: any): string | undefined {
  return (c as any).get("userId") as string | undefined
}

function githubCfg() {
  return {
    clientId: process.env.GITHUB_OAUTH_CLIENT_ID ?? "",
    clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET ?? "",
    callbackUrl: process.env.GITHUB_OAUTH_CALLBACK_URL ?? "http://localhost:4096/el/github/callback",
    configured: !!(process.env.GITHUB_OAUTH_CLIENT_ID && process.env.GITHUB_OAUTH_CLIENT_SECRET),
  }
}

// CSRF state: state → { userId, expiresAt }
const stateMap = new Map<string, { userId: string; expiresAt: number }>()
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of stateMap) if (v.expiresAt < now) stateMap.delete(k)
}, 60_000)

export function getStoredGitHubToken(userId: string): string | null {
  const row = Database.Client().$client
    .prepare("SELECT github_access_token FROM auth_users WHERE id = ?")
    .get(userId) as { github_access_token: string | null } | undefined
  return row?.github_access_token ?? null
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export const ElGitHubRoutes = lazy(() =>
  new Hono()

    // ── Status ─────────────────────────────────────────────────────────────────
    .get("/status", (c) => {
      const userId = getUserId(c)
      if (!userId) return c.json({ error: "Not authenticated" }, 401)
      const { configured } = githubCfg()
      if (!configured) return c.json({ configured: false, connected: false, login: null })
      const row = Database.Client().$client
        .prepare("SELECT github_login FROM auth_users WHERE id = ?")
        .get(userId) as { github_login: string | null } | undefined
      const login = row?.github_login ?? null
      return c.json({ configured: true, connected: !!login, login })
    })

    // ── Get OAuth URL ──────────────────────────────────────────────────────────
    .get("/connect", (c) => {
      const userId = getUserId(c)
      if (!userId) return c.json({ error: "Not authenticated" }, 401)
      const { clientId, callbackUrl, configured } = githubCfg()
      if (!configured) return c.json({ error: "GitHub OAuth not configured on this server" }, 503)
      const state = crypto.randomBytes(16).toString("hex")
      stateMap.set(state, { userId, expiresAt: Date.now() + 10 * 60_000 })
      const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=repo,read:user&state=${state}`
      return c.json({ url })
    })

    // ── OAuth callback — serves HTML that postMessages to opener ───────────────
    .get("/callback", async (c) => {
      const code = c.req.query("code")
      const state = c.req.query("state")

      const html = (login?: string, error?: string) => {
        const msg = login
          ? `{ type: 'github-connected', login: ${JSON.stringify(login)} }`
          : `{ type: 'github-error', error: ${JSON.stringify(error ?? "Unknown error")} }`
        const color = login ? "#22c55e" : "#ef4444"
        const text = login ? `Connected as @${login}` : `Error: ${error ?? "Unknown error"}`
        return c.html(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>GitHub OAuth</title></head>
<body style="font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#fafafa;flex-direction:column;gap:12px">
<div style="width:40px;height:40px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center">
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><${login ? 'polyline points="20 6 9 17 4 12"' : 'line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"'}'/></svg>
</div>
<p style="color:${color};font-size:14px;margin:0">${text}</p>
<script>window.opener?.postMessage(${msg}, '*'); setTimeout(() => window.close(), 1000);</script>
</body></html>`)
      }

      if (!code || !state) return html(undefined, "Missing code or state")
      const stateData = stateMap.get(state)
      if (!stateData || stateData.expiresAt < Date.now()) return html(undefined, "Invalid or expired state — please try again")
      stateMap.delete(state)

      const { clientId, clientSecret, callbackUrl } = githubCfg()
      if (!clientId || !clientSecret) return html(undefined, "OAuth not configured")

      try {
        const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: callbackUrl }),
        })
        const tokenData = await tokenRes.json() as { access_token?: string; error?: string; error_description?: string }
        if (!tokenData.access_token) {
          return html(undefined, tokenData.error_description ?? tokenData.error ?? "No access token returned")
        }

        const userRes = await fetch("https://api.github.com/user", {
          headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/vnd.github+json", "User-Agent": "Supadense" },
        })
        const userData = await userRes.json() as { login?: string }
        const login = userData.login ?? "unknown"

        Database.Client().$client
          .prepare("UPDATE auth_users SET github_access_token = ?, github_login = ? WHERE id = ?")
          .run(tokenData.access_token, login, stateData.userId)

        return html(login)
      } catch (err) {
        return html(undefined, String(err))
      }
    })

    // ── List repos ─────────────────────────────────────────────────────────────
    .get("/repos", async (c) => {
      const userId = getUserId(c)
      if (!userId) return c.json({ error: "Not authenticated" }, 401)
      const token = getStoredGitHubToken(userId)
      if (!token) return c.json({ error: "GitHub not connected" }, 401)

      const q = (c.req.query("q") ?? "").toLowerCase()
      try {
        const res = await fetch("https://api.github.com/user/repos?sort=pushed&per_page=100&type=all", {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "Supadense" },
        })
        if (!res.ok) {
          if (res.status === 401) {
            Database.Client().$client
              .prepare("UPDATE auth_users SET github_access_token = NULL, github_login = NULL WHERE id = ?")
              .run(userId)
            return c.json({ error: "GitHub token expired — please reconnect" }, 401)
          }
          return c.json({ error: `GitHub API ${res.status}` }, 502)
        }
        type GHRepo = { id: number; full_name: string; private: boolean; description: string | null; language: string | null; pushed_at: string }
        const repos = await res.json() as GHRepo[]
        const filtered = q ? repos.filter((r) => r.full_name.toLowerCase().includes(q)) : repos
        return c.json(filtered.slice(0, 60).map((r) => ({
          id: r.id,
          full_name: r.full_name,
          private: r.private,
          description: r.description,
          language: r.language,
          pushed_at: r.pushed_at,
        })))
      } catch (err) {
        return c.json({ error: String(err) }, 500)
      }
    })

    // ── Disconnect ─────────────────────────────────────────────────────────────
    .delete("/disconnect", (c) => {
      const userId = getUserId(c)
      if (!userId) return c.json({ error: "Not authenticated" }, 401)
      Database.Client().$client
        .prepare("UPDATE auth_users SET github_access_token = NULL, github_login = NULL WHERE id = ?")
        .run(userId)
      return c.json({ ok: true })
    }),
)
