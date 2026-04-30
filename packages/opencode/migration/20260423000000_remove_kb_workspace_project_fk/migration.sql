-- Remove the FK constraint on learning_kb_workspaces.project_id.
-- KB workspaces use a synthetic project_id (kb_path) when the real project_id
-- is already taken, so the FK reference to project(id) causes false failures.
PRAGMA legacy_alter_table = ON;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `learning_kb_workspaces_nofk_new` (
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
INSERT OR IGNORE INTO `learning_kb_workspaces_nofk_new`
	SELECT `id`, `project_id`, `kb_path`, `kb_initialized`, `learning_intent`,
	       `goals`, `gaps`, `depth_prefs`, `trusted_sources`, `scout_platforms`,
	       `extra_folders`, `onboarded_at`, `time_created`, `time_updated`
	FROM `learning_kb_workspaces`;
--> statement-breakpoint
DROP TABLE IF EXISTS `learning_kb_workspaces_nofk_old`;
--> statement-breakpoint
ALTER TABLE `learning_kb_workspaces` RENAME TO `learning_kb_workspaces_nofk_old`;
--> statement-breakpoint
ALTER TABLE `learning_kb_workspaces_nofk_new` RENAME TO `learning_kb_workspaces`;
--> statement-breakpoint
DROP TABLE IF EXISTS `learning_kb_workspaces_nofk_old`;
--> statement-breakpoint
PRAGMA legacy_alter_table = OFF;
