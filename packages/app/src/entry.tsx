// @refresh reload

import { render } from "solid-js/web"
import { createResource, Show } from "solid-js"
import { AppBaseProviders, AppInterface } from "@/app"
import { type Platform, PlatformProvider } from "@/context/platform"
import { dict as en } from "@/i18n/en"
import { dict as zh } from "@/i18n/zh"
import { handleNotificationClick } from "@/utils/notification-click"
import pkg from "../package.json"
import { ServerConnection } from "./context/server"
import LandingPage from "@/pages/auth/landing"
import { getAuthToken } from "@/utils/server"
import { Splash } from "@opencode-ai/ui/logo"

const DEFAULT_SERVER_URL_KEY = "opencode.settings.dat:defaultServerUrl"

const getLocale = () => {
  if (typeof navigator !== "object") return "en" as const
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const language of languages) {
    if (!language) continue
    if (language.toLowerCase().startsWith("zh")) return "zh" as const
  }
  return "en" as const
}

const getRootNotFoundError = () => {
  const key = "error.dev.rootNotFound" as const
  const locale = getLocale()
  return locale === "zh" ? (zh[key] ?? en[key]) : en[key]
}

const getStorage = (key: string) => {
  if (typeof localStorage === "undefined") return null
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const setStorage = (key: string, value: string | null) => {
  if (typeof localStorage === "undefined") return
  try {
    if (value !== null) {
      localStorage.setItem(key, value)
      return
    }
    localStorage.removeItem(key)
  } catch {
    return
  }
}

const readDefaultServerUrl = () => getStorage(DEFAULT_SERVER_URL_KEY)
const writeDefaultServerUrl = (url: string | null) => setStorage(DEFAULT_SERVER_URL_KEY, url)

const notify: Platform["notify"] = async (title, description, href) => {
  if (!("Notification" in window)) return

  const permission =
    Notification.permission === "default"
      ? await Notification.requestPermission().catch(() => "denied")
      : Notification.permission

  if (permission !== "granted") return

  const inView = document.visibilityState === "visible" && document.hasFocus()
  if (inView) return

  const notification = new Notification(title, {
    body: description ?? "",
    icon: "https://opencode.ai/favicon-96x96-v3.png",
  })

  notification.onclick = () => {
    handleNotificationClick(href)
    notification.close()
  }
}

const openLink: Platform["openLink"] = (url) => {
  window.open(url, "_blank")
}

const back: Platform["back"] = () => {
  window.history.back()
}

const forward: Platform["forward"] = () => {
  window.history.forward()
}

const restart: Platform["restart"] = async () => {
  window.location.reload()
}

const root = document.getElementById("root")
if (!(root instanceof HTMLElement) && import.meta.env.DEV) {
  throw new Error(getRootNotFoundError())
}

const getCurrentUrl = () => {
  if (location.hostname.includes("opencode.ai")) return "http://localhost:4096"
  if (import.meta.env.DEV)
    return `http://${import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:${import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`
  return `${location.origin}/api`
}

const getDefaultUrl = () => {
  const lsDefault = readDefaultServerUrl()
  if (lsDefault) return lsDefault
  return getCurrentUrl()
}

const platform: Platform = {
  platform: "web",
  version: pkg.version,
  openLink,
  back,
  forward,
  restart,
  notify,
  getDefaultServer: async () => {
    const stored = readDefaultServerUrl()
    return stored ? ServerConnection.Key.make(stored) : null
  },
  setDefaultServer: writeDefaultServerUrl,
}

async function checkAuth(backendUrl: string): Promise<"pass" | "login" | "directory_in_use"> {
  try {
    const res = await fetch(`${backendUrl}/supa-auth/enabled`)
    if (!res.ok) return "pass"
    const { enabled } = (await res.json()) as { enabled: boolean }
    if (!enabled) return "pass"
    const token = getAuthToken()
    if (!token) return "login"
    const me = await fetch(`${backendUrl}/supa-auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!me.ok) return "login"
    // Check if the current directory is already claimed by another user
    const probe = await fetch(`${backendUrl}/project/current`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (probe.status === 409) return "directory_in_use"
    return "pass"
  } catch {
    return "pass"
  }
}

function App() {
  const backendUrl = getCurrentUrl()
  const server: ServerConnection.Http = { type: "http", http: { url: backendUrl } }

  const [authState, { refetch }] = createResource(() => checkAuth(backendUrl))

  return (
    <PlatformProvider value={platform}>
      <AppBaseProviders>
        <Show
          when={!authState.loading}
          fallback={
            <div style={{ display: "flex", "align-items": "center", "justify-content": "center", height: "100dvh" }}>
              <Splash class="w-16 h-20 opacity-50 animate-pulse" />
            </div>
          }
        >
            <Show
            when={authState() !== "login" && authState() !== "directory_in_use"}
            fallback={
              <Show
                when={authState() === "login"}
                fallback={
                  <div style={{
                    display: "flex",
                    "flex-direction": "column",
                    "align-items": "center",
                    "justify-content": "center",
                    height: "100dvh",
                    gap: "12px",
                    "font-family": "sans-serif",
                    color: "#e5e7eb",
                    background: "#111",
                  }}>
                    <div style={{ "font-size": "2rem" }}>⚠️</div>
                    <div style={{ "font-size": "1.1rem", "font-weight": "600" }}>Folder already in use</div>
                    <div style={{ "font-size": "0.9rem", color: "#9ca3af", "text-align": "center", "max-width": "360px" }}>
                      This folder is already open by another user. Please open a different folder or contact the admin.
                    </div>
                  </div>
                }
              >
                <LandingPage backendUrl={backendUrl} onLogin={() => refetch()} />
              </Show>
            }
          >
            <AppInterface
              defaultServer={ServerConnection.Key.make(getDefaultUrl())}
              servers={[server]}
              disableHealthCheck
            />
          </Show>
        </Show>
      </AppBaseProviders>
    </PlatformProvider>
  )
}

if (root instanceof HTMLElement) {
  render(() => <App />, root)
}
