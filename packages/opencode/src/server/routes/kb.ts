import { Hono } from "hono"

type HonoEnv = { Variables: { userId: string } }
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { createKB, listKBs } from "../../util/workspace-provision"
import { lazy } from "../../util/lazy"

const KBInfo = z.object({
  directory: z.string(),
  name: z.string(),
})

export const KBRoutes = lazy(() =>
  new Hono<HonoEnv>()
    .post(
      "/create",
      describeRoute({
        summary: "Create a new KB",
        description: "Create a new Knowledge Base directory under the current user's workspace.",
        operationId: "kb.create",
        responses: {
          200: {
            description: "KB created",
            content: { "application/json": { schema: resolver(KBInfo) } },
          },
        },
      }),
      validator("json", z.object({ name: z.string().min(1) })),
      (c) => {
        const { name } = c.req.valid("json")
        const userId = c.get("userId") as string | undefined
        if (!userId) return c.json({ error: "Not authenticated" }, 401)
        try {
          const directory = createKB(userId, name)
          return c.json({ directory, name: directory.split("/").at(-1)! })
        } catch (err) {
          const message = err instanceof Error ? err.message : "Failed to create KB"
          return c.json({ error: message }, 409)
        }
      },
    )
    .get(
      "/list",
      describeRoute({
        summary: "List KBs",
        description: "List all Knowledge Base directories for the current user.",
        operationId: "kb.list",
        responses: {
          200: {
            description: "KB list",
            content: { "application/json": { schema: resolver(z.array(KBInfo)) } },
          },
        },
      }),
      (c) => {
        const userId = c.get("userId") as string | undefined
        if (!userId) return c.json({ error: "Not authenticated" }, 401)
        const dirs = listKBs(userId)
        return c.json(dirs.map((d) => ({ directory: d, name: d.split("/").at(-1)! })))
      },
    ),
)
