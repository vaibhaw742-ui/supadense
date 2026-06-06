import { createEffect, untrack } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/util/encode"
import { useServer } from "@/context/server"
import { useGlobalSync } from "@/context/global-sync"

export default function Home() {
  const sync = useGlobalSync()
  const navigate = useNavigate()
  const server = useServer()

  createEffect(() => {
    if (!sync.ready) return
    untrack(() => {
      const first = sync.data.project[0]
      if (first) {
        // Has existing workspace — go straight to session
        server.projects.touch(first.worktree)
        navigate(`/${base64Encode(first.worktree)}/session`, { replace: true })
      } else {
        // No workspaces — go to projects list instead of showing create form
        navigate("/projects", { replace: true })
      }
    })
  })

  // Loading state while sync bootstraps
  return (
    <div class="size-full flex items-center justify-center bg-background-base">
      <svg class="animate-spin text-text-weak" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 12a9 9 0 1 1-6.219-8.56" stroke-linecap="round"/>
      </svg>
    </div>
  )
}
