import { sqliteTable, text, integer, index, unique } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema.sql"
import { LearningResourceTable } from "../learning/schema.sql"

export const ElProjectTable = sqliteTable(
  "el_projects",
  {
    id: text().primaryKey(),
    user_id: text().notNull(),
    name: text().notNull(),
    status: text().notNull().default("onboarding"), // "onboarding" | "active" | "paused"
    context_json: text({ mode: "json" }).$type<Record<string, string>>().default({}),
    // repo indexing
    repo_local_path: text(),
    repo_branch: text(),
    clone_status: text().notNull().default("none"), // none | cloning | indexing | done | failed
    clone_error: text(),
    supadense_init: text().notNull().default("none"), // none | local | pushed
    is_default: integer({ mode: "boolean" }).notNull().default(false),
    cloned_at: integer(),
    indexed_at: integer(),
    ...Timestamps,
  },
  (t) => [index("el_projects_user_idx").on(t.user_id)],
)

export const ElProjectResourceTable = sqliteTable(
  "el_project_resources",
  {
    id: text().primaryKey(),
    project_id: text()
      .notNull()
      .references(() => ElProjectTable.id, { onDelete: "cascade" }),
    resource_id: text()
      .notNull()
      .references(() => LearningResourceTable.id, { onDelete: "cascade" }),
    role: text().notNull().default("primary"), // "primary" | "supplementary" | "archived"
    ...Timestamps,
  },
  (t) => [
    index("el_project_resources_project_idx").on(t.project_id),
    index("el_project_resources_resource_idx").on(t.resource_id),
    unique("el_project_resources_unique").on(t.project_id, t.resource_id),
  ],
)

export const ElProjectNodeTable = sqliteTable(
  "el_project_nodes",
  {
    id: text().primaryKey(),
    project_id: text()
      .notNull()
      .references(() => ElProjectTable.id, { onDelete: "cascade" }),
    path: text().notNull(),
    name: text().notNull(),
    depth: integer().notNull().default(0),
    parent_path: text(),
    node_type: text().notNull().default("directory"),
    file_count: integer().notNull().default(0),
    total_file_count: integer().notNull().default(0),
    files_json: text({ mode: "json" })
      .$type<Array<{ name: string; path: string; ext: string; size_bytes: number }>>()
      .notNull()
      .default([]),
    key_files: text({ mode: "json" }).$type<string[]>().notNull().default([]),
    ...Timestamps,
  },
  (t) => [
    index("el_project_nodes_project_idx").on(t.project_id),
    index("el_project_nodes_depth_idx").on(t.project_id, t.depth),
    unique("el_project_nodes_unique").on(t.project_id, t.path),
  ],
)
