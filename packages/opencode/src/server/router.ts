import type { MiddlewareHandler } from "hono"
import type { UpgradeWebSocket } from "hono/ws"
import { getAdaptor } from "@/control-plane/adaptors"
import { WorkspaceID } from "@/control-plane/schema"
import { Workspace } from "@/control-plane/workspace"
import { ServerProxy } from "./proxy"
import { lazy } from "@/util/lazy"
import { Filesystem } from "@/util/filesystem"
import { Instance } from "@/project/instance"
import { InstanceBootstrap } from "@/project/bootstrap"
import { InstanceRoutes } from "./instance"
import { DirectoryInUseError } from "@/project/project"
import { defaultKBDir } from "@/util/workspace-provision"

type Rule = { method?: string; path: string; exact?: boolean; action: "local" | "forward" }

const RULES: Array<Rule> = [
  { path: "/session/status", action: "forward" },
  { method: "GET", path: "/session", action: "local" },
]

function local(method: string, path: string) {
  for (const rule of RULES) {
    if (rule.method && rule.method !== method) continue
    const match = rule.exact ? path === rule.path : path === rule.path || path.startsWith(rule.path + "/")
    if (match) return rule.action === "local"
  }
  return false
}

export function WorkspaceRouterMiddleware(upgrade: UpgradeWebSocket): MiddlewareHandler {
  const routes = lazy(() => InstanceRoutes(upgrade))

  return async (c) => {
    const userId = c.get("userId") as string | undefined
    const defaultDir = userId ? defaultKBDir(userId) : process.cwd()
    const raw = c.req.query("directory") || c.req.header("x-opencode-directory") || defaultDir
    const directory = Filesystem.resolve(
      (() => {
        try {
          return decodeURIComponent(raw)
        } catch {
          return raw
        }
      })(),
    )

    // When auth is active, lock every request to the authenticated user's workspace.
    // Reject any directory that isn't strictly under /workspaces/{userId}/ — this blocks
    // both cross-user paths (/workspaces/other/) and arbitrary disk paths (/etc, /root, …).
    if (userId) {
      const allowed = `/workspaces/${userId}/`
      if (!directory.startsWith(allowed)) {
        return new Response(JSON.stringify({ error: "forbidden", message: "Directory does not belong to you." }), {
          status: 403,
          headers: { "content-type": "application/json" },
        })
      }
    }

    const url = new URL(c.req.url)
    const workspaceParam = url.searchParams.get("workspace") || c.req.header("x-opencode-workspace")

    // If no workspace is provided we use the "project" workspace
    if (!workspaceParam) {
      try {
        return await Instance.provide({
          directory,
          userId,
          init: InstanceBootstrap,
          async fn() {
            return routes().fetch(c.req.raw, c.env)
          },
        })
      } catch (err) {
        if (err instanceof DirectoryInUseError) {
          return new Response(
            JSON.stringify({ error: "directory_in_use", message: `This folder is already in use by another user.` }),
            { status: 409, headers: { "content-type": "application/json" } },
          )
        }
        if (err instanceof Error && err.message.startsWith("Directory does not exist:")) {
          return new Response(
            JSON.stringify({ error: "directory_not_found", message: err.message }),
            { status: 404, headers: { "content-type": "application/json" } },
          )
        }
        throw err
      }
    }

    const workspaceID = WorkspaceID.make(workspaceParam)
    const workspace = await Workspace.get(workspaceID)
    if (!workspace) {
      return new Response(`Workspace not found: ${workspaceID}`, {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8" },
      })
    }

    // Ownership check — reject if the workspace belongs to a different user
    if (userId && workspace.userID && workspace.userID !== userId) {
      return new Response("Forbidden", {
        status: 403,
        headers: { "content-type": "text/plain; charset=utf-8" },
      })
    }

    const adaptor = await getAdaptor(workspace.type)
    const target = await adaptor.target(workspace)

    if (target.type === "local") {
      try {
        return await Instance.provide({
          directory: target.directory,
          userId,
          init: InstanceBootstrap,
          async fn() {
            return routes().fetch(c.req.raw, c.env)
          },
        })
      } catch (err) {
        if (err instanceof DirectoryInUseError) {
          return new Response(
            JSON.stringify({ error: "directory_in_use", message: `This folder is already in use by another user.` }),
            { status: 409, headers: { "content-type": "application/json" } },
          )
        }
        if (err instanceof Error && err.message.startsWith("Directory does not exist:")) {
          return new Response(
            JSON.stringify({ error: "directory_not_found", message: err.message }),
            { status: 404, headers: { "content-type": "application/json" } },
          )
        }
        throw err
      }
    }

    if (local(c.req.method, url.pathname)) {
      // No instance provided because we are serving cached data; there
      // is no instance to work with
      return routes().fetch(c.req.raw, c.env)
    }

    if (c.req.header("upgrade")?.toLowerCase() === "websocket") {
      return ServerProxy.websocket(upgrade, target, c.req.raw, c.env)
    }

    const headers = new Headers(c.req.raw.headers)
    headers.delete("x-opencode-workspace")

    return ServerProxy.http(
      target,
      new Request(c.req.raw, {
        headers,
      }),
    )
  }
}
