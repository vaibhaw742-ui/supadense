import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { Log } from "../util/log"
import { OAUTH_DUMMY_KEY } from "../auth"

const log = Log.create({ service: "plugin.anthropic-claude" })

const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
const AUTHORIZE_URL = "https://claude.com/cai/oauth/authorize"
// Token endpoint is on platform.claude.com, not api.anthropic.com
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token"
// Whitelisted redirect URI for this client (localhost is not allowed)
const REDIRECT_URI = "https://platform.claude.com/oauth/code/callback"
const SCOPE = "org:create_api_key user:profile user:inference"
const OAUTH_VERSION = "oauth-2025-04-20"

// ---------- PKCE helpers ----------

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const bytes = crypto.getRandomValues(new Uint8Array(43))
  const verifier = Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join("")
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  const challenge = base64UrlEncode(hash)
  return { verifier, challenge }
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function generateState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
}

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  })
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`)
  return res.json()
}

// ---------- Plugin ----------

export async function AnthropicClaudeAuthPlugin(input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "anthropic",
      async loader(getAuth) {
        const auth = await getAuth()
        if (!auth || auth.type !== "oauth") return {}

        return {
          apiKey: OAUTH_DUMMY_KEY,
          async fetch(requestInput: RequestInfo | URL, init?: RequestInit) {
            // Remove the dummy x-api-key header added by the SDK
            if (init?.headers) {
              if (init.headers instanceof Headers) {
                init.headers.delete("x-api-key")
                init.headers.delete("authorization")
              } else if (Array.isArray(init.headers)) {
                init.headers = init.headers.filter(
                  ([key]) => key.toLowerCase() !== "x-api-key" && key.toLowerCase() !== "authorization",
                )
              } else {
                delete (init.headers as Record<string, string>)["x-api-key"]
                delete (init.headers as Record<string, string>)["authorization"]
              }
            }

            const currentAuth = await getAuth()
            if (!currentAuth || currentAuth.type !== "oauth") return fetch(requestInput, init)

            let accessToken = currentAuth.access

            // Refresh if expired
            if (!accessToken || currentAuth.expires < Date.now()) {
              log.info("refreshing anthropic oauth access token")
              try {
                const tokens = await refreshAccessToken(currentAuth.refresh)
                await input.client.auth.set({
                  path: { id: "anthropic" },
                  body: {
                    type: "oauth",
                    refresh: tokens.refresh_token,
                    access: tokens.access_token,
                    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                  },
                })
                accessToken = tokens.access_token
              } catch (err) {
                log.error("token refresh failed", { error: err })
                // Fall back to potentially expired token
                accessToken = currentAuth.access
              }
            }

            const headers = new Headers()
            if (init?.headers) {
              if (init.headers instanceof Headers) {
                init.headers.forEach((value, key) => headers.set(key, value))
              } else if (Array.isArray(init.headers)) {
                for (const [key, value] of init.headers) {
                  if (value !== undefined) headers.set(key, String(value))
                }
              } else {
                for (const [key, value] of Object.entries(init.headers as Record<string, string>)) {
                  if (value !== undefined) headers.set(key, value)
                }
              }
            }

            headers.set("authorization", `Bearer ${accessToken}`)
            headers.set("anthropic-beta", OAUTH_VERSION)

            return fetch(requestInput, { ...init, headers })
          },
        }
      },
      methods: [
        {
          label: "Login with Claude.ai (browser)",
          type: "oauth",
          authorize: async () => {
            const pkce = await generatePKCE()
            const state = generateState()

            const params = new URLSearchParams({
              response_type: "code",
              client_id: CLIENT_ID,
              redirect_uri: REDIRECT_URI,
              scope: SCOPE,
              code_challenge: pkce.challenge,
              code_challenge_method: "S256",
              state,
            })

            return {
              url: `${AUTHORIZE_URL}?${params.toString()}`,
              instructions: "After authorizing, copy the code from the page (or the full callback URL) and paste it below.",
              method: "code" as const,
              callback: async (rawInput: string) => {
                try {
                  // If user pasted the full callback URL, extract the code param
                  let code = rawInput.trim()
                  if (code.startsWith("http")) {
                    try {
                      const url = new URL(code)
                      code = url.searchParams.get("code") ?? code
                    } catch {
                      // not a URL, use as-is
                    }
                  }

                  log.info("exchanging oauth code", { codeLength: code.length })

                  const tokenRes = await fetch(TOKEN_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      grant_type: "authorization_code",
                      code,
                      redirect_uri: REDIRECT_URI,
                      client_id: CLIENT_ID,
                      code_verifier: pkce.verifier,
                    }),
                  })

                  if (!tokenRes.ok) {
                    const body = await tokenRes.text()
                    log.error("token exchange failed", { status: tokenRes.status, body })
                    return { type: "failed" as const }
                  }

                  const tokenData = (await tokenRes.json()) as {
                    access_token: string
                    refresh_token: string
                    expires_in: number
                  }

                  return {
                    type: "success" as const,
                    access: tokenData.access_token,
                    refresh: tokenData.refresh_token,
                    expires: Date.now() + (tokenData.expires_in ?? 3600) * 1000,
                  }
                } catch (err) {
                  log.error("oauth callback error", { error: err })
                  return { type: "failed" as const }
                }
              },
            }
          },
        },
        {
          label: "Enter API Key manually",
          type: "api",
        },
      ],
    },
  }
}
