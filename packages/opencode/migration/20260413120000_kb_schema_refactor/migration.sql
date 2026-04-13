-- Add per-workspace schema metadata table
CREATE TABLE IF NOT EXISTS `learning_kb_schema` (
    `id` text PRIMARY KEY,
    `workspace_id` text NOT NULL UNIQUE,
    `schema_path` text NOT NULL DEFAULT 'schema.json',
    `version` integer NOT NULL DEFAULT 1,
    `time_created` integer NOT NULL,
    `time_updated` integer NOT NULL,
    CONSTRAINT `fk_learning_kb_schema_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `learning_kb_workspaces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
-- Drop old global template tables — replaced by per-workspace schema.json
DROP TABLE IF EXISTS `learning_schema_sections`;
--> statement-breakpoint
DROP TABLE IF EXISTS `learning_schema_subcategories`;
--> statement-breakpoint
DROP TABLE IF EXISTS `learning_schema_templates`;
--> statement-breakpoint
-- Rebuild learning_kb_workspaces to remove the dangling template_id FK
-- (template_id referenced learning_schema_templates which was just dropped above)
-- SQLite requires table recreation to remove a column + its FK constraint.
--
-- Use PRAGMA legacy_alter_table = ON so that RENAME does NOT cascade FK
-- references in child tables (SQLite 3.26+ cascades by default, which would
-- break every child table by pointing their FKs at the _old temp name).
PRAGMA legacy_alter_table = ON;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `learning_kb_workspaces_new` (
    `id` text PRIMARY KEY,
    `project_id` text NOT NULL UNIQUE,
    `kb_path` text NOT NULL,
    `kb_initialized` integer NOT NULL DEFAULT false,
    `learning_intent` text,
    `goals` text NOT NULL DEFAULT '[]',
    `gaps` text NOT NULL DEFAULT '[]',
    `depth_prefs` text NOT NULL DEFAULT '{}',
    `trusted_sources` text NOT NULL DEFAULT '[]',
    `scout_platforms` text NOT NULL DEFAULT '[]',
    `extra_folders` text NOT NULL DEFAULT '[]',
    `onboarded_at` integer,
    `time_created` integer NOT NULL,
    `time_updated` integer NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO `learning_kb_workspaces_new`
    SELECT `id`, `project_id`, `kb_path`, `kb_initialized`, `learning_intent`,
           `goals`, `gaps`, `depth_prefs`, `trusted_sources`, `scout_platforms`,
           `extra_folders`, `onboarded_at`, `time_created`, `time_updated`
    FROM `learning_kb_workspaces`;
--> statement-breakpoint
DROP TABLE IF EXISTS `learning_kb_workspaces_old`;
--> statement-breakpoint
ALTER TABLE `learning_kb_workspaces` RENAME TO `learning_kb_workspaces_old`;
--> statement-breakpoint
ALTER TABLE `learning_kb_workspaces_new` RENAME TO `learning_kb_workspaces`;
--> statement-breakpoint
DROP TABLE IF EXISTS `learning_kb_workspaces_old`;
--> statement-breakpoint
PRAGMA legacy_alter_table = OFF;
