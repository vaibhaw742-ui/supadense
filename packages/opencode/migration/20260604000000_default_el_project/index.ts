import { sql } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"

export default function migrate(db: BetterSQLite3Database<any>) {
  db.run(sql`ALTER TABLE el_projects ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0`)
}
