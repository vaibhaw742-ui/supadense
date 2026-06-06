-- learning_concepts still had a FK to learning_categories which was dropped in
-- 20260520000000_drop_wiki_and_skills. With PRAGMA foreign_keys = ON, any INSERT
-- into learning_kb_workspaces (which triggers sync_kb_ws_real_bak_insert) caused
-- SQLite to try to compile FK checks involving learning_concepts, failing with
-- "no such table: main.learning_categories". Recreate the table without that FK.

PRAGMA foreign_keys = OFF;
--> statement-breakpoint

CREATE TABLE `learning_concepts_new` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`definition` text,
	`explanation` text,
	`aliases` text DEFAULT '[]' NOT NULL,
	`related_slugs` text DEFAULT '[]' NOT NULL,
	`first_seen_at` integer NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_learning_concepts_workspace_id_learning_kb_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `learning_kb_workspaces_real_bak`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint

INSERT INTO `learning_concepts_new` SELECT `id`, `workspace_id`, `name`, `slug`, `definition`, `explanation`, `aliases`, `related_slugs`, `first_seen_at`, `time_created`, `time_updated` FROM `learning_concepts`;
--> statement-breakpoint

DROP TABLE `learning_concepts`;
--> statement-breakpoint

ALTER TABLE `learning_concepts_new` RENAME TO `learning_concepts`;
--> statement-breakpoint

PRAGMA foreign_keys = ON;
