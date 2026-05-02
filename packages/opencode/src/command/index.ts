import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { SessionID, MessageID } from "@/session/schema"
import { Effect, Layer, ServiceMap } from "effect"
import z from "zod"
import { Config } from "../config/config"
import { MCP } from "../mcp"
import { Skill } from "../skill"
import { Log } from "../util/log"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import PROMPT_REVIEW from "./template/review.txt"
import PROMPT_ONBOARD from "./template/onboard.txt"
import PROMPT_MEMORIZE from "./template/memorize.txt"
import PROMPT_ADD_CATEGORY from "./template/add-category.txt"
import PROMPT_REMOVE_CATEGORY from "./template/remove-category.txt"
import PROMPT_ADD_SECTION from "./template/add-section.txt"
import PROMPT_REMOVE_SECTION from "./template/remove-section.txt"
import PROMPT_GROUP from "./template/group.txt"
import PROMPT_REMOVE_RESOURCE from "./template/remove-resource.txt"

export namespace Command {
  const log = Log.create({ service: "command" })

  type State = {
    commands: Record<string, Info>
  }

  export const Event = {
    Executed: BusEvent.define(
      "command.executed",
      z.object({
        name: z.string(),
        sessionID: SessionID.zod,
        arguments: z.string(),
        messageID: MessageID.zod,
      }),
    ),
  }

  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      agent: z.string().optional(),
      model: z.string().optional(),
      source: z.enum(["command", "mcp", "skill"]).optional(),
      // workaround for zod not supporting async functions natively so we use getters
      // https://zod.dev/v4/changelog?id=zfunction
      template: z.promise(z.string()).or(z.string()),
      subtask: z.boolean().optional(),
      hints: z.array(z.string()),
    })
    .meta({
      ref: "Command",
    })

  // for some reason zod is inferring `string` for z.promise(z.string()).or(z.string()) so we have to manually override it
  export type Info = Omit<z.infer<typeof Info>, "template"> & { template: Promise<string> | string }

  export function hints(template: string) {
    const result: string[] = []
    const numbered = template.match(/\$\d+/g)
    if (numbered) {
      for (const match of [...new Set(numbered)].sort()) result.push(match)
    }
    if (template.includes("$ARGUMENTS")) result.push("$ARGUMENTS")
    return result
  }

  export const Default = {
    INIT: "init",
    REVIEW: "review",
    ONBOARD: "onboard",
    MEMORIZE: "memorize",
    ADD_CATEGORY: "add-category",
    REMOVE_CATEGORY: "remove-category",
    ADD_SECTION: "add-section",
    REMOVE_SECTION: "remove-section",
    GROUP: "group",
    REMOVE_RESOURCE: "remove-resource",
  } as const

  export interface Interface {
    readonly get: (name: string) => Effect.Effect<Info | undefined>
    readonly list: () => Effect.Effect<Info[]>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Command") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const config = yield* Config.Service
      const mcp = yield* MCP.Service
      const skill = yield* Skill.Service

      const init = Effect.fn("Command.state")(function* (ctx) {
        const cfg = yield* config.get()
        const commands: Record<string, Info> = {}

        commands[Default.ONBOARD] = {
          name: Default.ONBOARD,
          description: "set up your knowledge base — goals, categories, depth",
          source: "command",
          get template() {
            return PROMPT_ONBOARD
          },
          hints: hints(PROMPT_ONBOARD),
        }
        commands[Default.MEMORIZE] = {
          name: Default.MEMORIZE,
          description: "add a resource to your knowledge base",
          source: "command",
          get template() {
            return PROMPT_MEMORIZE
          },
          hints: hints(PROMPT_MEMORIZE),
        }
        commands[Default.ADD_CATEGORY] = {
          name: Default.ADD_CATEGORY,
          description: "add a new category to your knowledge base",
          source: "command",
          get template() {
            return PROMPT_ADD_CATEGORY
          },
          hints: hints(PROMPT_ADD_CATEGORY),
        }
        commands[Default.REMOVE_CATEGORY] = {
          name: Default.REMOVE_CATEGORY,
          description: "remove a category from your knowledge base",
          source: "command",
          get template() {
            return PROMPT_REMOVE_CATEGORY
          },
          hints: hints(PROMPT_REMOVE_CATEGORY),
        }
        commands[Default.ADD_SECTION] = {
          name: Default.ADD_SECTION,
          description: "add a section to a category or subcategory",
          source: "command",
          get template() {
            return PROMPT_ADD_SECTION
          },
          hints: hints(PROMPT_ADD_SECTION),
        }
        commands[Default.REMOVE_SECTION] = {
          name: Default.REMOVE_SECTION,
          description: "remove a section (overview and key concepts are protected)",
          source: "command",
          get template() {
            return PROMPT_REMOVE_SECTION
          },
          hints: hints(PROMPT_REMOVE_SECTION),
        }
        commands[Default.GROUP] = {
          name: Default.GROUP,
          description: "group and consolidate key-concepts for a category or subcategory",
          source: "command",
          get template() {
            return PROMPT_GROUP
          },
          hints: hints(PROMPT_GROUP),
        }
        commands[Default.REMOVE_RESOURCE] = {
          name: Default.REMOVE_RESOURCE,
          description: "remove a resource and all its content from the knowledge base",
          source: "command",
          get template() {
            return PROMPT_REMOVE_RESOURCE
          },
          hints: hints(PROMPT_REMOVE_RESOURCE),
        }

        for (const [name, command] of Object.entries(cfg.command ?? {})) {
          commands[name] = {
            name,
            agent: command.agent,
            model: command.model,
            description: command.description,
            source: "command",
            get template() {
              return command.template
            },
            subtask: command.subtask,
            hints: hints(command.template),
          }
        }

        for (const [name, prompt] of Object.entries(yield* mcp.prompts())) {
          commands[name] = {
            name,
            source: "mcp",
            description: prompt.description,
            get template() {
              return Effect.runPromise(
                mcp
                  .getPrompt(
                    prompt.client,
                    prompt.name,
                    prompt.arguments
                      ? Object.fromEntries(prompt.arguments.map((argument, i) => [argument.name, `$${i + 1}`]))
                      : {},
                  )
                  .pipe(
                    Effect.map(
                      (template) =>
                        template?.messages
                          .map((message) => (message.content.type === "text" ? message.content.text : ""))
                          .join("\n") || "",
                    ),
                  ),
              )
            },
            hints: prompt.arguments?.map((_, i) => `$${i + 1}`) ?? [],
          }
        }

        for (const item of yield* skill.all()) {
          if (commands[item.name]) continue
          commands[item.name] = {
            name: item.name,
            description: item.description,
            source: "skill",
            get template() {
              return item.content
            },
            hints: [],
          }
        }

        return {
          commands,
        }
      })

      const state = yield* InstanceState.make<State>((ctx) => init(ctx))

      const get = Effect.fn("Command.get")(function* (name: string) {
        const s = yield* InstanceState.get(state)
        return s.commands[name]
      })

      const list = Effect.fn("Command.list")(function* () {
        const s = yield* InstanceState.get(state)
        return Object.values(s.commands)
      })

      return Service.of({ get, list })
    }),
  )

  export const defaultLayer = layer.pipe(
    Layer.provide(Config.defaultLayer),
    Layer.provide(MCP.defaultLayer),
    Layer.provide(Skill.defaultLayer),
  )

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function list() {
    return runPromise((svc) => svc.list())
  }
}
