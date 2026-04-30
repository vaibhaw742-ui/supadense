-- SQLite does not support ADD CONSTRAINT on existing tables.
-- Recreate learning_kb_workspaces with REFERENCES project(id) ON DELETE CASCADE
-- on project_id so the DB enforces the user isolation chain at engine level.
-- Rows whose project_id has no matching project row are dropped (orphans).
PRAGMA legacy_alter_table = ON;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `learning_kb_workspaces_fk_new` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL UNIQUE REFERENCES `project`(`id`) ON DELETE CASCADE,
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
INSERT OR IGNORE INTO `learning_kb_workspaces_fk_new`
	SELECT w.`id`, w.`project_id`, w.`kb_path`, w.`kb_initialized`, w.`learning_intent`,
	       w.`goals`, w.`gaps`, w.`depth_prefs`, w.`trusted_sources`, w.`scout_platforms`,
	       w.`extra_folders`, w.`onboarded_at`, w.`time_created`, w.`time_updated`
	FROM `learning_kb_workspaces` w
	WHERE EXISTS (SELECT 1 FROM `project` p WHERE p.`id` = w.`project_id`);
--> statement-breakpoint
DROP TABLE IF EXISTS `learning_kb_workspaces_fk_old`;
--> statement-breakpoint
ALTER TABLE `learning_kb_workspaces` RENAME TO `learning_kb_workspaces_fk_old`;
--> statement-breakpoint
ALTER TABLE `learning_kb_workspaces_fk_new` RENAME TO `learning_kb_workspaces`;
--> statement-breakpoint
DROP TABLE IF EXISTS `learning_kb_workspaces_fk_old`;
--> statement-breakpoint
PRAGMA legacy_alter_table = OFF;
