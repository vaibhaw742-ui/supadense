import { createSignal, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLayout } from "@/context/layout"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/util/encode"
import { useServer } from "@/context/server"
import { getAuthToken } from "@/utils/server"

export function DialogCreateKB() {
  const dialog = useDialog()
  const layout = useLayout()
  const navigate = useNavigate()
  const server = useServer()

  const [name, setName] = createSignal("")
  const [error, setError] = createSignal("")
  const [loading, setLoading] = createSignal(false)
  const [createdDir, setCreatedDir] = createSignal("")

  const handleCreate = async () => {
    const trimmed = name().trim()
    if (!trimmed) return
    setError("")
    setLoading(true)
    const token = getAuthToken()
    try {
      const base = import.meta.env.DEV
        ? `http://${import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:${import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`
        : `${location.origin}/api`
      const res = await fetch(`${base}/kb/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        setError(err.error ?? "Failed to create KB")
        return
      }
      const { directory } = (await res.json()) as { directory: string }
      setCreatedDir(directory)
    } catch (e) {
      setError("Failed to create KB — check connection")
    } finally {
      setLoading(false)
    }
  }

  const handleSetup = () => {
    const dir = createdDir()
    if (!dir) return
    dialog.close()
    layout.projects.open(dir)
    server.projects.touch(dir)
    navigate(
      `/${base64Encode(dir)}/session?prompt=${encodeURIComponent("Setup my knowledge base")}&send=1`,
    )
  }

  return (
    <Dialog title={createdDir() ? "Knowledge Base Created" : "New KB"} fit>
      <Show
        when={createdDir()}
        fallback={
          <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
            <div class="flex flex-col gap-1.5">
              <input
                autofocus
                class="w-72 rounded-lg border border-border-base bg-background-input px-3 py-2 text-14-regular text-text-strong outline-none focus:border-border-focus placeholder:text-text-weak"
                classList={{ "border-red-500 focus:border-red-500": !!error() }}
                placeholder="e.g. Machine Learning"
                onInput={(e) => { setName(e.currentTarget.value); setError("") }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate()
                  if (e.key === "Escape") dialog.close()
                }}
              />
              <Show when={error()}>
                <div class="text-12-regular text-red-500 pl-1">{error()}</div>
              </Show>
            </div>
            <div class="flex justify-end gap-2">
              <Button variant="ghost" size="large" onClick={() => dialog.close()}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="large"
                disabled={loading()}
                onClick={handleCreate}
              >
                {loading() ? "Creating…" : "Create"}
              </Button>
            </div>
          </div>
        }
      >
        <div class="flex flex-col gap-5 pl-6 pr-2.5 pb-3">
          <div class="flex flex-col gap-1.5">
            <div class="text-14-regular text-text-strong">Your Knowledge Base is ready.</div>
            <div class="text-12-regular text-text-weak">
              Click below to start the setup conversation.
            </div>
          </div>
          <div class="flex justify-end">
            <Button variant="primary" size="large" onClick={handleSetup}>
              Setup My Knowledge Base
            </Button>
          </div>
        </div>
      </Show>
    </Dialog>
  )
}
