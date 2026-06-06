import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"

export const LocalProjectTable = sqliteTable("local_project", {
  id:          text().primaryKey(),           // slugified name, e.g. "my-api"
  user_id:     text().notNull(),
  name:        text().notNull(),              // display name
  local_path:  text().notNull(),              // absolute path on user's Mac
  brain_dir:   text().notNull(),              // local_path + "/.brain"
  sources_dir: text().notNull(),              // local_path + "/.brain-sources"
  source_id:   text().notNull(),              // Postgres brain_pages.source_id
  time_created: integer().notNull(),
  time_updated: integer().notNull(),
})
