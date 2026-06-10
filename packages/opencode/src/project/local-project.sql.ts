import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core"

export const LocalProjectTable = sqliteTable("local_project", {
  id:          text().primaryKey(),           // slugified name, e.g. "my-api"
  user_id:     text().notNull(),
  name:        text().notNull(),              // display name
  local_path:  text().notNull(),              // absolute path on user's Mac
  brain_dir:   text().notNull(),              // local_path + "/.brain"
  sources_dir: text().notNull(),              // local_path + "/.brain-sources"
  source_id:   text().notNull(),              // Postgres brain_pages.source_id
  github_repo:  text(),                  // "owner/repo" parsed from .git/config remote.origin.url
  time_created: integer().notNull(),
  time_updated: integer().notNull(),
})

export const ApiRequestLogTable = sqliteTable("api_request_log", {
  id:           text().primaryKey(),
  user_id:      text().notNull(),
  project_id:   text(),                          // optional: which local project
  type:         text().notNull(),                // "search" | "add" | "update" | "delete" | "other"
  status:       integer().notNull(),             // HTTP status code e.g. 200, 400, 500
  duration_ms:  real().notNull(),                // response time in ms
  document_id:  text(),                          // filename/source id if applicable
  time_created: integer().notNull(),
})
