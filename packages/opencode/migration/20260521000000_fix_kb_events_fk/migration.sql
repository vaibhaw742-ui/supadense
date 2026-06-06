-- Rebuild learning_kb_events without the dead FK to learning_wiki_pages
-- (that table was dropped in 20260520000000_drop_wiki_and_skills but the
--  FK constraint was left behind, causing PRAGMA foreign_keys = ON to fail
--  on every INSERT into this table)

CREATE TABLE `learning_kb_events_new` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`event_type` text NOT NULL,
	`resource_id` text,
	`payload` text DEFAULT '{}' NOT NULL,
	`summary` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_learning_kb_events_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `learning_kb_workspaces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_learning_kb_events_resource_id_fk` FOREIGN KEY (`resource_id`) REFERENCES `learning_resources`(`id`)
);
--> statement-breakpoint

INSERT INTO `learning_kb_events_new`
  (`id`, `workspace_id`, `event_type`, `resource_id`, `payload`, `summary`, `time_created`, `time_updated`)
SELECT
  `id`, `workspace_id`, `event_type`, `resource_id`, `payload`, `summary`, `time_created`, `time_updated`
FROM `learning_kb_events`;
--> statement-breakpoint

DROP TABLE `learning_kb_events`;
--> statement-breakpoint

ALTER TABLE `learning_kb_events_new` RENAME TO `learning_kb_events`;
--> statement-breakpoint

CREATE INDEX `learning_kb_events_workspace_idx` ON `learning_kb_events` (`workspace_id`);
--> statement-breakpoint
CREATE INDEX `learning_kb_events_type_idx` ON `learning_kb_events` (`event_type`);
