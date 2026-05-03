import { Hono } from "hono"
import { validator } from "hono-openapi"
import z from "zod"
import { lazy } from "../../util/lazy"
import { KbGitSync } from "../../learning/git-sync"
import { Workspace } from "../../learning/workspace"

export const KBGitRoutes = lazy(() =>
  new Hono()
    // GET /kb/git/status?directory=<kbPath>
    .get("/status", (c) => {
      const directory = c.req.query("directory")
      if (!directory) return c.json({ error: "directory required" }, 400)

      const workspace = Workspace.getByKbPath(directory)
      if (!workspace) return c.json({ error: "Workspace not found" }, 404)

      const status = KbGitSync.getStatus(directory)
      return c.json({
        ...status,
        hasRemoteConfigured: !!(workspace.github_remote_url),
      })
    })

    // POST /kb/git/commit  { directory }
    .post(
      "/commit",
      validator("json", z.object({ directory: z.string().min(1) })),
      (c) => {
        const { directory } = c.req.valid("json")
        const workspace = Workspace.getByKbPath(directory)
        if (!workspace) return c.json({ error: "Workspace not found" }, 404)

        const result = KbGitSync.commit(directory)
        if (!result.ok) return c.json({ error: result.message }, 500)
        return c.json({ message: result.message })
      },
    )

    // POST /kb/git/push  { directory }
    .post(
      "/push",
      validator("json", z.object({ directory: z.string().min(1) })),
      (c) => {
        const { directory } = c.req.valid("json")
        const workspace = Workspace.getByKbPath(directory)
        if (!workspace) return c.json({ error: "Workspace not found" }, 404)

        if (!workspace.github_pat) return c.json({ error: "No GitHub remote configured" }, 400)

        const result = KbGitSync.push(directory)
        if (!result.ok) return c.json({ error: result.message }, 500)
        return c.json({ message: result.message })
      },
    )

    // POST /kb/git/remote  { directory, remote_url, pat }
    .post(
      "/remote",
      validator(
        "json",
        z.object({
          directory: z.string().min(1),
          remote_url: z.string().url(),
          pat: z.string().min(1),
        }),
      ),
      (c) => {
        const { directory, remote_url, pat } = c.req.valid("json")
        const workspace = Workspace.getByKbPath(directory)
        if (!workspace) return c.json({ error: "Workspace not found" }, 404)

        const result = KbGitSync.setRemote(directory, remote_url, pat)
        if (!result.ok) return c.json({ error: result.message }, 500)

        // Persist remote URL and PAT per workspace
        Workspace.update(workspace.id, {
          github_remote_url: remote_url,
          github_pat: pat,
        })

        return c.json({ message: result.message })
      },
    ),
)
