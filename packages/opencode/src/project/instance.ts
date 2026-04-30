import { GlobalBus } from "@/bus/global"
import { disposeInstance } from "@/effect/instance-registry"
import { Filesystem } from "@/util/filesystem"
import { iife } from "@/util/iife"
import { Log } from "@/util/log"
import { Context } from "../util/context"
import { Project } from "./project"
import { State } from "./state"

export interface InstanceContext {
  directory: string
  worktree: string
  project: Project.Info
  userId?: string
}

const context = Context.create<InstanceContext>("instance")
const cache = new Map<string, Promise<InstanceContext>>()

const disposal = {
  all: undefined as Promise<void> | undefined,
}

function emit(directory: string) {
  GlobalBus.emit("event", {
    directory,
    payload: {
      type: "server.instance.disposed",
      properties: {
        directory,
      },
    },
  })
}

function boot(input: { directory: string; init?: () => Promise<any>; project?: Project.Info; worktree?: string; userId?: string }) {
  return iife(async () => {
    const ctx =
      input.project && input.worktree
        ? {
            directory: input.directory,
            worktree: input.worktree,
            project: input.project,
            userId: input.userId,
          }
        : await Project.fromDirectory(input.directory, input.userId).then(({ project, sandbox }) => ({
            directory: input.directory,
            worktree: sandbox,
            project,
            userId: input.userId,
          }))
    await context.provide(ctx, async () => {
      await input.init?.()
    })
    return ctx
  })
}

function cacheKey(directory: string, userId?: string) {
  return userId ? `${directory}:${userId}` : directory
}

function track(key: string, next: Promise<InstanceContext>) {
  const task = next.catch((error) => {
    if (cache.get(key) === task) cache.delete(key)
    throw error
  })
  cache.set(key, task)
  return task
}

export const Instance = {
  async provide<R>(input: { directory: string; init?: () => Promise<any>; fn: () => R; userId?: string }): Promise<R> {
    const directory = Filesystem.resolve(input.directory)
    const key = cacheKey(directory, input.userId)
    let existing = cache.get(key)
    if (!existing) {
      Log.Default.info("creating instance", { directory })
      existing = track(
        key,
        boot({
          directory,
          init: input.init,
          userId: input.userId,
        }),
      )
    }
    const ctx = await existing
    return context.provide(ctx, async () => {
      return input.fn()
    })
  },
  get current() {
    return context.use()
  },
  get directory() {
    return context.use().directory
  },
  get worktree() {
    return context.use().worktree
  },
  get project() {
    return context.use().project
  },
  /**
   * Check if a path is within the project boundary.
   * Returns true if path is inside Instance.directory OR Instance.worktree.
   * Paths within the worktree but outside the working directory should not trigger external_directory permission.
   */
  containsPath(filepath: string) {
    if (Filesystem.contains(Instance.directory, filepath)) return true
    // Non-git projects set worktree to "/" which would match ANY absolute path.
    // Skip worktree check in this case to preserve external_directory permissions.
    if (Instance.worktree === "/") return false
    return Filesystem.contains(Instance.worktree, filepath)
  },
  /**
   * Captures the current instance ALS context and returns a wrapper that
   * restores it when called. Use this for callbacks that fire outside the
   * instance async context (native addons, event emitters, timers, etc.).
   */
  bind<F extends (...args: any[]) => any>(fn: F): F {
    const ctx = context.use()
    return ((...args: any[]) => context.provide(ctx, () => fn(...args))) as F
  },
  /**
   * Run a synchronous function within the given instance context ALS.
   * Use this to bridge from Effect (where InstanceRef carries context)
   * back to sync code that reads Instance.directory from ALS.
   */
  restore<R>(ctx: InstanceContext, fn: () => R): R {
    return context.provide(ctx, fn)
  },
  state<S>(init: () => S, dispose?: (state: Awaited<S>) => Promise<void>): () => S {
    return State.create(() => Instance.directory, init, dispose)
  },
  async reload(input: { directory: string; init?: () => Promise<any>; project?: Project.Info; worktree?: string }) {
    const directory = Filesystem.resolve(input.directory)
    const userId = Instance.current.userId
    const key = cacheKey(directory, userId)
    Log.Default.info("reloading instance", { directory })
    await Promise.all([State.dispose(directory), disposeInstance(directory)])
    cache.delete(key)
    const next = track(key, boot({ ...input, directory, userId }))
    emit(directory)
    return await next
  },
  async dispose() {
    const directory = Instance.directory
    const userId = Instance.current.userId
    const key = cacheKey(directory, userId)
    Log.Default.info("disposing instance", { directory })
    await Promise.all([State.dispose(directory), disposeInstance(directory)])
    cache.delete(key)
    emit(directory)
  },
  async disposeAll() {
    if (disposal.all) return disposal.all

    disposal.all = iife(async () => {
      Log.Default.info("disposing all instances")
      const entries = [...cache.entries()]
      for (const [key, value] of entries) {
        if (cache.get(key) !== value) continue

        const ctx = await value.catch((error) => {
          Log.Default.warn("instance dispose failed", { key, error })
          return undefined
        })

        if (!ctx) {
          if (cache.get(key) === value) cache.delete(key)
          continue
        }

        if (cache.get(key) !== value) continue

        await context.provide(ctx, async () => {
          await Instance.dispose()
        })
      }
    }).finally(() => {
      disposal.all = undefined
    })

    return disposal.all
  },

  async disposeForUser(userId: string) {
    Log.Default.info("disposing instances for user", { userId })
    const suffix = `:${userId}`
    const entries = [...cache.entries()].filter(([key]) => key.endsWith(suffix))
    for (const [key, value] of entries) {
      if (cache.get(key) !== value) continue
      const ctx = await value.catch((error) => {
        Log.Default.warn("instance dispose failed", { key, error })
        return undefined
      })
      if (!ctx) {
        if (cache.get(key) === value) cache.delete(key)
        continue
      }
      if (cache.get(key) !== value) continue
      await context.provide(ctx, async () => {
        await Instance.dispose()
      })
    }
  },
}
