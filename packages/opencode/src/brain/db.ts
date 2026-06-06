import postgres from "postgres"

const BRAIN_DB_URL =
  process.env.BRAIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/supadense_brain"

let _sql: ReturnType<typeof postgres> | null = null

export function brainDb() {
  if (!_sql) {
    _sql = postgres(BRAIN_DB_URL, {
      max: 10,
      idle_timeout: 30,
      connect_timeout: 10,
    })
  }
  return _sql
}

export async function disconnectBrainDb() {
  if (_sql) {
    await _sql.end()
    _sql = null
  }
}
