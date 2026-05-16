import { createEffect, createSignal, Show, untrack } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/util/encode"
import { useServer } from "@/context/server"
import { useGlobalSync } from "@/context/global-sync"
import { getAuthToken } from "@/utils/server"
import { getBackendUrl } from "@/utils/server"

export default function Home() {
  const sync = useGlobalSync()
  const navigate = useNavigate()
  const server = useServer()
  const [creating, setCreating] = createSignal(false)
  const [error, setError] = createSignal("")
  const [name, setName] = createSignal("")

  // As soon as sync is ready, navigate to first workspace session
  createEffect(() => {
    if (!sync.ready) return
    const first = sync.data.project[0]
    if (!first) return
    untrack(() => {
      server.projects.touch(first.worktree)
      navigate(`/${base64Encode(first.worktree)}/session`, { replace: true })
    })
  })

  async function createWorkspace() {
    const trimmed = name().trim()
    if (!trimmed) return
    setCreating(true)
    setError("")
    const token = getAuthToken()
    try {
      const base = getBackendUrl()
      const res = await fetch(`${base}/kb/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        setError(err.error ?? "Failed to create workspace")
        return
      }
      const { directory } = (await res.json()) as { directory: string }
      server.projects.touch(directory)
      navigate(`/${base64Encode(directory)}/session`, { replace: true })
    } catch {
      setError("Failed to create workspace — check connection")
    } finally {
      setCreating(false)
    }
  }

  // Show this only if sync is ready and there are no workspaces
  return (
    <div class="size-full flex items-center justify-center bg-background-base">
      <div class="flex flex-col items-center gap-6 text-center max-w-sm px-6">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-text-weak">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
        </svg>
        <div>
          <div class="text-18-medium text-text-strong mb-1">Create your first workspace</div>
          <div class="text-13-regular text-text-weak">Organise what you learn into categories and resources.</div>
        </div>
        <div class="w-full flex flex-col gap-3">
          <input
            autofocus
            class="w-full rounded-lg border border-border-base bg-background-input px-3 py-2 text-14-regular text-text-strong outline-none focus:border-border-focus placeholder:text-text-weak"
            placeholder="e.g. Machine Learning"
            value={name()}
            onInput={(e) => { setName(e.currentTarget.value); setError("") }}
            onKeyDown={(e) => { if (e.key === "Enter") void createWorkspace() }}
          />
          <Show when={error()}>
            <div class="text-12-regular text-red-500">{error()}</div>
          </Show>
          <button
            type="button"
            disabled={!name().trim() || creating()}
            onClick={() => void createWorkspace()}
            class="w-full py-2.5 rounded-lg text-14-medium font-semibold transition-colors"
            style={{
              background: name().trim() ? "var(--color-text-strong)" : "var(--color-surface-raised-base)",
              color: name().trim() ? "var(--color-background-base)" : "var(--color-text-weak)",
              border: "none",
              cursor: name().trim() ? "pointer" : "default",
            }}
          >
            {creating() ? "Creating…" : "Get Started"}
          </button>
        </div>
      </div>
    </div>
  )
}
