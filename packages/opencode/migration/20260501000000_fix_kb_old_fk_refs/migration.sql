-- Fix broken FK references pointing to "learning_kb_workspaces_old".
--
-- Migration 20260413120000_kb_schema_refactor renamed learning_kb_workspaces →
-- learning_kb_workspaces_old with PRAGMA legacy_alter_table = ON. On some SQLite
-- builds the PRAGMA was ignored (defaulting to OFF), so child tables had their FK
-- DDLs rewritten to reference "learning_kb_workspaces_old". That table was then
-- dropped, leaving dangling FKs that cause "no such table: main.learning_kb_workspaces_old"
-- at runtime.
--
-- Fix strategy (legacy_alter_table = OFF so SQLite rewrites child FK DDLs on rename):
--   1. Save the real table under a temp name.
--   2. Create a dummy table with the broken name child FKs expect.
--   3. Rename dummy → learning_kb_workspaces so SQLite updates child FK DDLs.
--   4. Drop the temp backup.

PRAGMA legacy_alter_table = OFF;
--> statement-breakpoint
DROP TABLE IF EXISTS `learning_kb_workspaces_real_bak`;
--> statement-breakpoint
ALTER TABLE `learning_kb_workspaces` RENAME TO `learning_kb_workspaces_real_bak`;
--> statement-breakpoint
CREATE TABLE `learning_kb_workspaces_old` (
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
	`time_updated` integer NOT NULL,
	`years_of_experience` integer
);
--> statement-breakpoint
INSERT OR IGNORE INTO `learning_kb_workspaces_old`
	SELECT `id`, `project_id`, `kb_path`, `kb_initialized`, `learning_intent`,
	       `goals`, `gaps`, `depth_prefs`, `trusted_sources`, `scout_platforms`,
	       `extra_folders`, `onboarded_at`, `time_created`, `time_updated`,
	       `years_of_experience`
	FROM `learning_kb_workspaces_real_bak`;
--> statement-breakpoint
-- Rename with legacy=OFF: SQLite rewrites all child FK DDLs from
-- "learning_kb_workspaces_old" → "learning_kb_workspaces"
ALTER TABLE `learning_kb_workspaces_old` RENAME TO `learning_kb_workspaces`;
--> statement-breakpoint
DROP TABLE IF EXISTS `learning_kb_workspaces_real_bak`;
