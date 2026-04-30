-- Fix broken FK references in child tables.
--
-- Migration 20260421500000 renamed learning_kb_workspaces → learning_kb_workspaces_fk_old
-- with legacy_alter_table effectively OFF, so SQLite updated every child table's FK DDL
-- to reference "learning_kb_workspaces_fk_old". The subsequent rename of _fk_new →
-- learning_kb_workspaces did not fix those references, leaving them broken.
--
-- Strategy (legacy_alter_table = OFF, the default):
--   1. Move the real data table out of the way temporarily.
--   2. Create a table named "learning_kb_workspaces_fk_old" — the exact name child FKs expect.
--   3. Copy all rows into it.
--   4. Rename it to "learning_kb_workspaces" — with legacy=OFF SQLite rewrites all child
--      FK DDLs from "learning_kb_workspaces_fk_old" to "learning_kb_workspaces".
--   5. Drop the temporary backup.

PRAGMA legacy_alter_table = OFF;
--> statement-breakpoint
DROP TABLE IF EXISTS `learning_kb_workspaces_current_bak`;
--> statement-breakpoint
ALTER TABLE `learning_kb_workspaces` RENAME TO `learning_kb_workspaces_current_bak`;
--> statement-breakpoint
CREATE TABLE `learning_kb_workspaces_fk_old` (
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
INSERT OR IGNORE INTO `learning_kb_workspaces_fk_old`
	SELECT `id`, `project_id`, `kb_path`, `kb_initialized`, `learning_intent`,
	       `goals`, `gaps`, `depth_prefs`, `trusted_sources`, `scout_platforms`,
	       `extra_folders`, `onboarded_at`, `time_created`, `time_updated`
	FROM `learning_kb_workspaces_current_bak`;
--> statement-breakpoint
-- This rename propagates: child FK DDLs change from "_fk_old" → "learning_kb_workspaces"
ALTER TABLE `learning_kb_workspaces_fk_old` RENAME TO `learning_kb_workspaces`;
--> statement-breakpoint
DROP TABLE IF EXISTS `learning_kb_workspaces_current_bak`;
