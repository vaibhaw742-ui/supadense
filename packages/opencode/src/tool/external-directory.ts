import path from "path"
import { Effect } from "effect"
import type { Tool } from "./tool"
import { Instance } from "../project/instance"
import { AppFileSystem } from "../filesystem"
import { Global } from "../global"

type Kind = "file" | "directory"

type Options = {
  bypass?: boolean
  kind?: Kind
}

export async function assertExternalDirectory(ctx: Tool.Context, target?: string, options?: Options) {
  if (!target) return

  const full = process.platform === "win32" ? AppFileSystem.normalizePath(target) : target

  // Hard-block access to the opencode data directory (auth keys, logs, config).
  // This is unconditional — bypass does not override it.
  if (full.startsWith(Global.Path.data + path.sep) || full === Global.Path.data) {
    throw new Error("Access to opencode internal data is not permitted.")
  }

  if (options?.bypass) return

  // Hard-block access to other users' workspace directories.
  // /workspaces/{userId}/ is only accessible by that user's instance.
  const userId = Instance.current.userId
  if (userId && full.startsWith("/workspaces/") && !full.startsWith(`/workspaces/${userId}/`)) {
    throw new Error("Access to another user's workspace is not permitted.")
  }

  if (Instance.containsPath(full)) return

  const kind = options?.kind ?? "file"
  const dir = kind === "directory" ? full : path.dirname(full)
  const glob =
    process.platform === "win32"
      ? AppFileSystem.normalizePathPattern(path.join(dir, "*"))
      : path.join(dir, "*").replaceAll("\\", "/")

  await ctx.ask({
    permission: "external_directory",
    patterns: [glob],
    always: [glob],
    metadata: {
      filepath: full,
      parentDir: dir,
    },
  })
}

export const assertExternalDirectoryEffect = Effect.fn("Tool.assertExternalDirectory")(function* (
  ctx: Tool.Context,
  target?: string,
  options?: Options,
) {
  yield* Effect.promise(() => assertExternalDirectory(ctx, target, options))
})
