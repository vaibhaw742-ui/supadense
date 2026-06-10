// Routes for managing API keys (permanent, long-lived tokens for CLI / CI use)
//
// POST   /api-keys          — generate a new key, returns raw key once
// GET    /api-keys          — list keys (key prefix, name, created_at; never raw key)
// DELETE /api-keys/:id      — revoke a key

import { Hono }            from "hono"
import { createHash,
         randomBytes,
         randomUUID }      from "node:crypto"
import { Database }        from "../../storage/db"
import { ApiKeyTable }     from "../../project/api-key.sql"
import { eq, and }         from "drizzle-orm"
import os                  from "node:os"

function getUserId(c: { get: Function }): string | null {
  return (c as any).get?.("userId") as string ?? null
}

function json(c: { json: Function }, data: unknown, status = 200) {
  return c.json(data, status as 200)
}

// Ensure the api_key table exists (idempotent DDL run at first route access)
function ensureTable() {
  const client = Database.Client().$client
  client.run(`
    CREATE TABLE IF NOT EXISTS api_key (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      name         TEXT NOT NULL,
      key_hash     TEXT NOT NULL UNIQUE,
      key_prefix   TEXT NOT NULL,
      time_created INTEGER NOT NULL
    )
  `)
}

let tableReady = false
function withTable() {
  if (!tableReady) { ensureTable(); tableReady = true }
}

export const ApiKeyRoutes = new Hono()

// POST /api-keys — generate a new API key
ApiKeyRoutes.post("/", async (c) => {
  withTable()
  const userId = getUserId(c)
  if (!userId) return json(c, { error: "Not authenticated" }, 401)

  const body = await c.req.json().catch(() => ({})) as { name?: string }
  const name = body.name ?? `key-${os.hostname()}`

  // Generate: "supa_" + 35 random chars (hex) = 40 chars total
  const raw    = "supa_" + randomBytes(18).toString("hex") // 5 + 36 = 41; trim to 40
  const key    = raw.slice(0, 40)
  const hash   = createHash("sha256").update(key).digest("hex")
  const prefix = key.slice(0, 12)
  const id     = randomUUID()
  const now    = Date.now()

  Database.use((db) => {
    db.insert(ApiKeyTable).values({
      id,
      user_id:      userId,
      name,
      key_hash:     hash,
      key_prefix:   prefix,
      time_created: now,
    }).run()
  })

  return json(c, {
    id,
    name,
    key,           // raw key — shown only once
    key_prefix:    prefix,
    time_created:  now,
    message:       "Store this key safely — it will not be shown again.",
  })
})

// GET /api-keys — list keys for user (never returns raw key)
ApiKeyRoutes.get("/", (c) => {
  withTable()
  const userId = getUserId(c)
  if (!userId) return json(c, { error: "Not authenticated" }, 401)

  const keys = Database.use((db) =>
    db.select({
      id:           ApiKeyTable.id,
      name:         ApiKeyTable.name,
      key_prefix:   ApiKeyTable.key_prefix,
      time_created: ApiKeyTable.time_created,
    })
    .from(ApiKeyTable)
    .where(eq(ApiKeyTable.user_id, userId))
    .all()
  )

  return json(c, { keys, total: keys.length })
})

// DELETE /api-keys/:id — revoke a key
ApiKeyRoutes.delete("/:id", (c) => {
  withTable()
  const userId = getUserId(c)
  const id     = c.req.param("id")
  if (!userId) return json(c, { error: "Not authenticated" }, 401)

  Database.use((db) => {
    db.delete(ApiKeyTable)
      .where(and(eq(ApiKeyTable.id, id), eq(ApiKeyTable.user_id, userId)))
      .run()
  })

  return json(c, { deleted: true })
})

// ── Exported helper used by auth middleware ───────────────────────────────────

export function lookupApiKey(rawKey: string): string | null {
  try {
    withTable()
    const hash = createHash("sha256").update(rawKey).digest("hex")
    const row  = Database.use((db) =>
      db.select({ user_id: ApiKeyTable.user_id })
        .from(ApiKeyTable)
        .where(eq(ApiKeyTable.key_hash, hash))
        .get()
    )
    return row?.user_id ?? null
  } catch {
    return null
  }
}
