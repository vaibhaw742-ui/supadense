import { Hono, type Context } from "hono"
import { createHmac, randomUUID } from "node:crypto"
import { Database } from "@/storage/db"
import { Flag } from "@/flag/flag"
import { provisionWorkspace } from "@/util/workspace-provision"

// ── JWT helpers (HS256, no external deps) ─────────────────────────────────────

function b64url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

function signToken(payload: Record<string, unknown>, secret: string): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const body = b64url(JSON.stringify(payload))
  const sig = b64url(createHmac("sha256", secret).update(`${header}.${body}`).digest())
  return `${header}.${body}.${sig}`
}

export function verifyToken(token: string, secret: string): Record<string, unknown> {
  const parts = token.split(".")
  if (parts.length !== 3) throw new Error("Invalid token")
  const [header, body, sig] = parts
  const expected = b64url(createHmac("sha256", secret).update(`${header}.${body}`).digest())
  if (sig !== expected) throw new Error("Invalid signature")
  const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as Record<string, unknown>
  if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000))
    throw new Error("Token expired")
  return payload
}

// ── Seed admin user on startup ────────────────────────────────────────────────

export async function seedAdminUser() {
  const secret = Flag.SUPADENSE_AUTH_SECRET
  const email = Flag.SUPADENSE_ADMIN_EMAIL
  const password = Flag.SUPADENSE_ADMIN_PASSWORD
  if (!secret || !email || !password) return

  const client = Database.Client().$client
  const existing = client.prepare("SELECT id FROM auth_users WHERE email = ?").get(email)
  if (existing) return

  const hash = await Bun.password.hash(password)
  const id = randomUUID()
  client
    .prepare("INSERT INTO auth_users (id, email, password_hash, status, created_at) VALUES (?, ?, ?, 'approved', ?)")
    .run(id, email, hash, new Date().toISOString())
  provisionWorkspace(id)
}

// ── Routes ────────────────────────────────────────────────────────────────────

type AuthUser = { id: string; email: string; password_hash: string; status: string }

export function SupaAuthRoutes() {
  const app = new Hono()

  app.get("/enabled", (c) => c.json({ enabled: !!Flag.SUPADENSE_AUTH_SECRET }))

  app.post("/register", async (c) => {
    const secret = Flag.SUPADENSE_AUTH_SECRET
    if (!secret) return c.json({ error: "Auth not configured" }, 503)

    let email: string, yearsOfExperience: string | undefined
    try {
      const body = await c.req.json()
      email = body.email?.trim()
      yearsOfExperience = body.years_of_experience?.trim() || undefined
    } catch {
      return c.json({ error: "Invalid request body" }, 400)
    }
    if (!email) return c.json({ error: "Email required" }, 400)

    const existing = Database.Client().$client.prepare("SELECT id FROM auth_users WHERE email = ?").get(email)
    if (existing) return c.json({ error: "Email already registered" }, 409)

    Database.Client().$client
      .prepare("INSERT INTO auth_users (id, email, password_hash, status, years_of_experience, created_at) VALUES (?, ?, '', 'pending', ?, ?)")
      .run(randomUUID(), email, yearsOfExperience ?? null, new Date().toISOString())

    return c.json({ waitlisted: true })
  })

  app.post("/login", async (c) => {
    const secret = Flag.SUPADENSE_AUTH_SECRET
    if (!secret) return c.json({ error: "Auth not configured" }, 503)

    let email: string, password: string
    try {
      const body = await c.req.json()
      email = body.email?.trim()
      password = body.password
    } catch {
      return c.json({ error: "Invalid request body" }, 400)
    }
    if (!email || !password) return c.json({ error: "Email and password required" }, 400)

    const user = Database.Client().$client
      .prepare("SELECT id, email, password_hash, status FROM auth_users WHERE email = ?")
      .get(email) as AuthUser | undefined
    if (!user) return c.json({ error: "Invalid credentials" }, 401)

    const valid = await Bun.password.verify(password, user.password_hash)
    if (!valid) return c.json({ error: "Invalid credentials" }, 401)

    if (user.status === "pending") return c.json({ error: "waitlist" }, 403)

    const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
    const token = signToken({ userId: user.id, email: user.email, exp }, secret)

    try {
      Database.Client().$client
        .prepare("INSERT INTO user_activity_events (id, user_id, event_type, created_at) VALUES (?, ?, 'login', ?)")
        .run(randomUUID(), user.id, new Date().toISOString())
    } catch {}

    return c.json({ token, email: user.email })
  })

  app.post("/logout", (c) => c.json({ ok: true }))

  app.get("/me", (c) => {
    const secret = Flag.SUPADENSE_AUTH_SECRET
    if (!secret) return c.json({ error: "Auth not configured" }, 503)

    const authHeader = c.req.header("Authorization")
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null
    if (!token) return c.json({ error: "Unauthorized" }, 401)

    try {
      const payload = verifyToken(token, secret) as { userId: string; email: string }
      const isAdmin = payload.email === Flag.SUPADENSE_ADMIN_EMAIL
      return c.json({ userId: payload.userId, email: payload.email, is_admin: isAdmin })
    } catch {
      return c.json({ error: "Invalid token" }, 401)
    }
  })

  // ── Admin helpers ─────────────────────────────────────────────────────────────

  function getCallerEmail(c: Context): string | null {
    const secret = Flag.SUPADENSE_AUTH_SECRET
    if (!secret) return null
    const authHeader = c.req.header("Authorization")
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null
    if (!token) return null
    try {
      const payload = verifyToken(token, secret) as { userId: string; email: string }
      return payload.email
    } catch {
      return null
    }
  }

  function requireAdmin(c: Context) {
    const email = getCallerEmail(c)
    if (!email) return { error: "Unauthorized" as const }
    if (email !== Flag.SUPADENSE_ADMIN_EMAIL) return { error: "Forbidden" as const }
    return { email }
  }

  // ── Admin: approved user management ──────────────────────────────────────────

  app.get("/users", async (c) => {
    const auth = requireAdmin(c)
    if ("error" in auth) return c.json({ error: auth.error }, auth.error === "Forbidden" ? 403 : 401)
    const users = Database.Client().$client
      .prepare("SELECT id, email, status, created_at FROM auth_users WHERE status = 'approved' ORDER BY created_at ASC")
      .all() as { id: string; email: string; status: string; created_at: string }[]
    return c.json(users)
  })

  app.post("/users", async (c) => {
    const auth = requireAdmin(c)
    if ("error" in auth) return c.json({ error: auth.error }, auth.error === "Forbidden" ? 403 : 401)

    let email: string, password: string
    try {
      const body = await c.req.json()
      email = body.email?.trim()
      password = body.password
    } catch {
      return c.json({ error: "Invalid request body" }, 400)
    }
    if (!email || !password) return c.json({ error: "Email and password required" }, 400)

    const existing = Database.Client().$client.prepare("SELECT id FROM auth_users WHERE email = ?").get(email)
    if (existing) return c.json({ error: "User already exists" }, 409)

    const hash = await Bun.password.hash(password)
    const id = randomUUID()
    Database.Client().$client
      .prepare("INSERT INTO auth_users (id, email, password_hash, status, created_at) VALUES (?, ?, ?, 'approved', ?)")
      .run(id, email, hash, new Date().toISOString())
    provisionWorkspace(id)

    return c.json({ id, email })
  })

  app.delete("/users/:id", async (c) => {
    const auth = requireAdmin(c)
    if ("error" in auth) return c.json({ error: auth.error }, auth.error === "Forbidden" ? 403 : 401)

    const callerToken = c.req.header("Authorization")?.slice(7)
    const callerPayload = callerToken ? verifyToken(callerToken, Flag.SUPADENSE_AUTH_SECRET!) as { userId: string } : null
    if (callerPayload?.userId === c.req.param("id")) return c.json({ error: "Cannot delete yourself" }, 400)

    Database.Client().$client.prepare("DELETE FROM auth_users WHERE id = ?").run(c.req.param("id"))
    return c.json({ ok: true })
  })

  // ── Admin: waitlist management ────────────────────────────────────────────────

  app.get("/waitlist", async (c) => {
    const auth = requireAdmin(c)
    if ("error" in auth) return c.json({ error: auth.error }, auth.error === "Forbidden" ? 403 : 401)
    const users = Database.Client().$client
      .prepare("SELECT id, email, years_of_experience, created_at FROM auth_users WHERE status = 'pending' ORDER BY created_at ASC")
      .all() as { id: string; email: string; years_of_experience: string | null; created_at: string }[]
    return c.json(users)
  })

  app.post("/waitlist/:id/approve", async (c) => {
    const auth = requireAdmin(c)
    if ("error" in auth) return c.json({ error: auth.error }, auth.error === "Forbidden" ? 403 : 401)

    let password: string
    try {
      const body = await c.req.json()
      password = body.password
    } catch {
      return c.json({ error: "Invalid request body" }, 400)
    }
    if (!password || password.length < 6) return c.json({ error: "Password must be at least 6 characters" }, 400)

    const hash = await Bun.password.hash(password)
    const userId = c.req.param("id")
    Database.Client().$client
      .prepare("UPDATE auth_users SET status = 'approved', password_hash = ? WHERE id = ? AND status = 'pending'")
      .run(hash, userId)
    provisionWorkspace(userId)
    return c.json({ ok: true })
  })

  app.delete("/waitlist/:id", async (c) => {
    const auth = requireAdmin(c)
    if ("error" in auth) return c.json({ error: auth.error }, auth.error === "Forbidden" ? 403 : 401)
    Database.Client().$client
      .prepare("DELETE FROM auth_users WHERE id = ? AND status = 'pending'")
      .run(c.req.param("id"))
    return c.json({ ok: true })
  })

  // ── Admin: analytics ──────────────────────────────────────────────────────────

  app.get("/admin/analytics", (c) => {
    const auth = requireAdmin(c)
    if ("error" in auth) return c.json({ error: auth.error }, auth.error === "Forbidden" ? 403 : 401)

    const db = Database.Client().$client

    const totalUsers = (db.prepare("SELECT COUNT(*) as n FROM auth_users WHERE status = 'approved'").get() as { n: number }).n

    const dau = db.prepare(`
      SELECT DATE(created_at) as day, COUNT(DISTINCT user_id) as users
      FROM user_activity_events
      WHERE event_type = 'login' AND created_at >= DATE('now', '-30 days')
      GROUP BY day ORDER BY day ASC
    `).all() as { day: string; users: number }[]

    const hourly = db.prepare(`
      SELECT CAST(STRFTIME('%H', created_at) AS INTEGER) as hour, COUNT(*) as events
      FROM user_activity_events
      WHERE event_type = 'login' AND created_at >= DATE('now', '-30 days')
      GROUP BY hour ORDER BY hour ASC
    `).all() as { hour: number; events: number }[]

    // Week-1 retention: users who logged in again in days 7-14 after their first login
    const retention = db.prepare(`
      SELECT
        COUNT(DISTINCT first_logins.user_id) as cohort_size,
        COUNT(DISTINCT retained.user_id) as retained
      FROM (
        SELECT user_id, MIN(DATE(created_at)) as first_day
        FROM user_activity_events WHERE event_type = 'login'
        GROUP BY user_id
        HAVING first_day <= DATE('now', '-7 days')
      ) first_logins
      LEFT JOIN user_activity_events retained ON retained.user_id = first_logins.user_id
        AND DATE(retained.created_at) BETWEEN DATE(first_logins.first_day, '+7 days') AND DATE(first_logins.first_day, '+14 days')
        AND retained.event_type = 'login'
    `).get() as { cohort_size: number; retained: number }

    const messageStats = db.prepare(`
      SELECT
        DATE(m.created_at) as day,
        COUNT(*) as messages
      FROM message m
      WHERE m.created_at >= DATE('now', '-30 days')
      GROUP BY day ORDER BY day ASC
    `).all() as { day: string; messages: number }[]

    return c.json({ totalUsers, dau, hourly, retention, messageStats })
  })

  app.get("/admin/users-detail", (c) => {
    const auth = requireAdmin(c)
    if ("error" in auth) return c.json({ error: auth.error }, auth.error === "Forbidden" ? 403 : 401)

    const db = Database.Client().$client

    const users = db.prepare(`
      SELECT
        u.id,
        u.email,
        u.created_at,
        MAX(e.created_at) as last_login,
        COUNT(e.id) as login_count,
        (SELECT COUNT(*) FROM message m JOIN session s ON s.id = m.session_id JOIN project p ON p.id = s.project_id WHERE p.user_id = u.id) as message_count
      FROM auth_users u
      LEFT JOIN user_activity_events e ON e.user_id = u.id AND e.event_type = 'login'
      WHERE u.status = 'approved'
      GROUP BY u.id
      ORDER BY last_login DESC NULLS LAST
    `).all() as {
      id: string; email: string; created_at: string;
      last_login: string | null; login_count: number; message_count: number
    }[]

    return c.json(users)
  })

  app.get("/admin/user-queries", (c) => {
    const auth = requireAdmin(c)
    if ("error" in auth) return c.json({ error: auth.error }, auth.error === "Forbidden" ? 403 : 401)

    const userId = c.req.query("userId")
    if (!userId) return c.json({ error: "userId required" }, 400)

    const db = Database.Client().$client

    const rows = db.prepare(`
      SELECT
        m.id as message_id,
        m.time_created,
        s.title as session_title,
        (
          SELECT json_extract(p.data, '$.text')
          FROM part p
          WHERE p.message_id = m.id
            AND json_extract(p.data, '$.type') = 'text'
            AND (json_extract(p.data, '$.synthetic') IS NULL OR json_extract(p.data, '$.synthetic') = 0)
          ORDER BY p.time_created ASC
          LIMIT 1
        ) as query_text
      FROM message m
      JOIN session s ON s.id = m.session_id
      JOIN project pr ON pr.id = s.project_id
      WHERE pr.user_id = ?
        AND s.parent_id IS NULL
        AND json_extract(m.data, '$.role') = 'user'
      ORDER BY m.time_created DESC
      LIMIT 10
    `).all(userId) as { message_id: string; time_created: number; session_title: string; query_text: string | null }[]

    const queries = rows.filter((r) => r.query_text && r.query_text.trim().length > 0)

    return c.json(queries)
  })

  return app
}
