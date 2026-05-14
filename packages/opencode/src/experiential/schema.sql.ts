import { sqliteTable, text, integer, index, primaryKey, unique } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema.sql"
import { LearningResourceTable } from "../learning/schema.sql"

// ─── EL Projects ─────────────────────────────────────────────────────────────
// One row per Experiential Learning project.
// status: "onboarding" | "active" | "paused"

export const ElProjectTable = sqliteTable(
  "el_projects",
  {
    id: text().primaryKey(),
    user_id: text().notNull(),
    name: text().notNull(),
    status: text().notNull().default("onboarding"), // "onboarding" | "active" | "paused"
    context_json: text({ mode: "json" }).$type<Record<string, string>>().default({}),
    ...Timestamps,
  },
  (t) => [index("el_projects_user_idx").on(t.user_id)],
)

// ─── EL Project Resources ─────────────────────────────────────────────────────
// Join table linking EL projects to learning_resources.
// One project can have many resources; one resource can appear in many projects.
// role: "primary" | "supplementary" | "archived"

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
