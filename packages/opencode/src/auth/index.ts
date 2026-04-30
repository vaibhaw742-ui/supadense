import path from "path"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { Effect, Layer, Option, Record, Result, Schema, ServiceMap } from "effect"
import { makeRuntime } from "@/effect/run-service"
import { zod } from "@/util/effect-zod"
import { Global } from "../global"
import { AppFileSystem } from "../filesystem"
import { InstanceRef } from "@/effect/instance-ref"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

const globalFile = path.join(Global.Path.data, "auth.json")

function userAuthFile(userId: string): string {
  const dir = path.join(Global.Path.data, "auth")
  mkdirSync(dir, { recursive: true })
  return path.join(dir, `${userId}.json`)
}

const fail = (message: string) => (cause: unknown) => new Auth.AuthError({ message, cause })

export namespace Auth {
  export class Oauth extends Schema.Class<Oauth>("OAuth")({
    type: Schema.Literal("oauth"),
    refresh: Schema.String,
    access: Schema.String,
    expires: Schema.Number,
    accountId: Schema.optional(Schema.String),
    enterpriseUrl: Schema.optional(Schema.String),
  }) {}

  export class Api extends Schema.Class<Api>("ApiAuth")({
    type: Schema.Literal("api"),
    key: Schema.String,
    metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  }) {}

  export class WellKnown extends Schema.Class<WellKnown>("WellKnownAuth")({
    type: Schema.Literal("wellknown"),
    key: Schema.String,
    token: Schema.String,
  }) {}

  const _Info = Schema.Union([Oauth, Api, WellKnown]).annotate({ discriminator: "type", identifier: "Auth" })
  export const Info = Object.assign(_Info, { zod: zod(_Info) })
  export type Info = Schema.Schema.Type<typeof _Info>

  export class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  }) {}

  export interface Interface {
    readonly get: (providerID: string) => Effect.Effect<Info | undefined, AuthError>
    readonly all: () => Effect.Effect<Record<string, Info>, AuthError>
    readonly set: (key: string, info: Info) => Effect.Effect<void, AuthError>
    readonly remove: (key: string) => Effect.Effect<void, AuthError>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Auth") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const fsys = yield* AppFileSystem.Service
      const decode = Schema.decodeUnknownOption(Info)

      // Resolve the auth file dynamically per call.
      // When running inside an Instance context (InstanceRef is injected by makeRuntime's attach()),
      // use a per-user file. Otherwise fall back to the global file (e.g. CLI usage).
      const resolveFile = Effect.gen(function* () {
        const ref = yield* InstanceRef
        return ref?.userId ? userAuthFile(ref.userId) : globalFile
      })

      const all = Effect.fn("Auth.all")(function* () {
        const file = yield* resolveFile
        const data = (yield* fsys.readJson(file).pipe(Effect.orElseSucceed(() => ({})))) as Record<string, unknown>
        return Record.filterMap(data, (value) => Result.fromOption(decode(value), () => undefined))
      })

      const get = Effect.fn("Auth.get")(function* (providerID: string) {
        return (yield* all())[providerID]
      })

      const set = Effect.fn("Auth.set")(function* (key: string, info: Info) {
        const file = yield* resolveFile
        const norm = key.replace(/\/+$/, "")
        const data = yield* all()
        if (norm !== key) delete data[key]
        delete data[norm + "/"]
        yield* fsys
          .writeJson(file, { ...data, [norm]: info }, 0o600)
          .pipe(Effect.mapError(fail("Failed to write auth data")))
      })

      const remove = Effect.fn("Auth.remove")(function* (key: string) {
        const file = yield* resolveFile
        const norm = key.replace(/\/+$/, "")
        const data = yield* all()
        delete data[key]
        delete data[norm]
        yield* fsys.writeJson(file, data, 0o600).pipe(Effect.mapError(fail("Failed to write auth data")))
      })

      return Service.of({ get, all, set, remove })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))

  const { runPromise } = makeRuntime(Service, defaultLayer)

  // Global fallback (CLI, no user context)
  export async function get(providerID: string) {
    return runPromise((service) => service.get(providerID))
  }

  export async function all(): Promise<Record<string, Info>> {
    return runPromise((service) => service.all())
  }

  export async function set(key: string, info: Info) {
    return runPromise((service) => service.set(key, info))
  }

  export async function remove(key: string) {
    return runPromise((service) => service.remove(key))
  }

  // ── Per-user helpers for HTTP routes that have userId from request context ──
  // These run before WorkspaceRouterMiddleware so there is no Instance/InstanceRef context.
  // They use direct synchronous file I/O — the logic mirrors the Effect layer above.

  const _decode = Schema.decodeUnknownOption(Info)

  function readRaw(userId: string): Record<string, unknown> {
    try {
      return JSON.parse(readFileSync(userAuthFile(userId), "utf-8")) as Record<string, unknown>
    } catch {
      return {}
    }
  }

  function writeRaw(userId: string, data: Record<string, unknown>): void {
    writeFileSync(userAuthFile(userId), JSON.stringify(data, null, 2), { mode: 0o600 })
  }

  export async function getForUser(userId: string, providerID: string): Promise<Info | undefined> {
    return Option.getOrUndefined(_decode(readRaw(userId)[providerID]))
  }

  export async function allForUser(userId: string): Promise<Record<string, Info>> {
    const data = readRaw(userId)
    const result: Record<string, Info> = {}
    for (const [key, value] of Object.entries(data)) {
      const opt = _decode(value)
      if (Option.isSome(opt)) result[key] = opt.value
    }
    return result
  }

  export async function setForUser(userId: string, key: string, info: Info): Promise<void> {
    const norm = key.replace(/\/+$/, "")
    const data = readRaw(userId)
    delete data[key]
    delete data[norm + "/"]
    writeRaw(userId, { ...data, [norm]: info })
  }

  export async function removeForUser(userId: string, key: string): Promise<void> {
    const norm = key.replace(/\/+$/, "")
    const data = readRaw(userId)
    delete data[key]
    delete data[norm]
    writeRaw(userId, data)
  }
}
