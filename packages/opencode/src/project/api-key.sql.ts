import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

export const ApiKeyTable = sqliteTable("api_key", {
  id:           text().primaryKey(),       // random UUID
  user_id:      text().notNull(),
  name:         text().notNull(),          // e.g. "cli-mymac"
  key_hash:     text().notNull().unique(), // sha256 of the raw key
  key_prefix:   text().notNull(),          // first 12 chars for display
  time_created: integer().notNull(),
})
