// Brain test preload — sets BRAIN_DATABASE_URL before any imports
import { afterAll, beforeAll } from "bun:test"

process.env.BRAIN_DATABASE_URL =
  process.env.BRAIN_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5433/supadense_brain"

// Run migrations once before all brain tests
beforeAll(async () => {
  const { runBrainMigrations } = await import("../../src/brain/migrate")
  await runBrainMigrations()
})

// Truncate all brain tables between test files
afterAll(async () => {
  const { brainDb, disconnectBrainDb } = await import("../../src/brain/db")
  const db = brainDb()
  await db`TRUNCATE brain_pages CASCADE`.catch(() => null)
  await db`UPDATE brain_gen_clock SET value = 0`.catch(() => null)
  await disconnectBrainDb()
})
