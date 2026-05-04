import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { base64Encode } from "@opencode-ai/util/encode"
import { getFilename } from "@opencode-ai/util/path"
import { useNavigate, useParams } from "@solidjs/router"
import { type LocalProject } from "@/context/layout"
import { useLayout } from "@/context/layout"
import { getAuthToken } from "@/utils/server"
import { workspaceKey } from "@/pages/layout/helpers"
import { decode64 } from "@/utils/base64"

export function DialogDeleteProject(props: { project: LocalProject }) {
  const dialog = useDialog()
  const layout = useLayout()
  const navigate = useNavigate()
  const params = useParams<{ dir?: string }>()

  const handleDelete = async () => {
    dialog.close()

    const list = layout.projects.list()
    const key = workspaceKey(props.project.worktree)
    const index = list.findIndex((x) => workspaceKey(x.worktree) === key)
    const currentDir = params.dir ? decode64(params.dir) ?? "" : ""
    const active = workspaceKey(currentDir) === key
    const next = list[index + 1] ?? list[index - 1]

    if (active) {
      if (next) {
        layout.sidebar.close()
        navigate(`/${base64Encode(next.worktree)}/session`)
      } else {
        navigate("/")
      }
    }

    layout.projects.close(props.project.worktree)

    if (!props.project.id || props.project.id === "global") return
    const base = import.meta.env.DEV
      ? `http://${import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:${import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`
      : `${location.origin}/api`
    const token = getAuthToken()
    await fetch(
      `${base}/project/${encodeURIComponent(props.project.id)}?directory=${encodeURIComponent(props.project.worktree)}`,
      {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    )
  }

  return (
    <Dialog title="Delete workspace" fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <div class="flex flex-col gap-1">
          <span class="text-14-regular text-text-strong">
            Are you sure you want to delete "{props.project.name || getFilename(props.project.worktree)}"?
          </span>
          <span class="text-12-regular text-text-weak">
            This will permanently remove the workspace and all its data.
          </span>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            Cancel
          </Button>
          <Button variant="primary" size="large" onClick={handleDelete}>
            Delete
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
