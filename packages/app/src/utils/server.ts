import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import type { ServerConnection } from "@/context/server"

export const AUTH_TOKEN_KEY = "supadense.auth.token"

export function getBackendUrl(): string {
  if (typeof location === "undefined") return "http://localhost:4096"
  if (location.hostname.includes("opencode.ai")) return "http://localhost:4096"
  if (import.meta.env?.DEV)
    return `http://${import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:${import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`
  return `${location.origin}/api`
}

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY)
  } catch {
    return null
  }
}

export function setAuthToken(token: string) {
  localStorage.setItem(AUTH_TOKEN_KEY, token)
}

export function clearAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY)
}

export function createSdkForServer({
  server,
  ...config
}: Omit<NonNullable<Parameters<typeof createOpencodeClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
}) {
  const sessionToken = getAuthToken()
  const auth = (() => {
    if (sessionToken) return { Authorization: `Bearer ${sessionToken}` }
    if (!server.password) return
    return { Authorization: `Basic ${btoa(`${server.username ?? "opencode"}:${server.password}`)}` }
  })()

  return createOpencodeClient({
    ...config,
    headers: { ...config.headers, ...auth },
    baseUrl: server.url,
  })
}
