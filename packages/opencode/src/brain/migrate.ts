import { brainDb } from "./db"
import { BRAIN_SCHEMA_SQL } from "./schema"

let migrated = false

export async function runBrainMigrations(): Promise<void> {
  if (migrated) return
  const db = brainDb()

  // Ensure pgvector extension
  await db`CREATE EXTENSION IF NOT EXISTS vector`.catch(() => {
    console.warn("[brain] pgvector extension not available — vector search disabled")
  })

  await db.unsafe(BRAIN_SCHEMA_SQL)
  migrated = true
  console.log("[brain] schema ready")
}
