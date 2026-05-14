CREATE TABLE IF NOT EXISTS `el_projects` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `name` text NOT NULL,
  `status` text NOT NULL DEFAULT 'onboarding',
  `context_json` text DEFAULT '{}',
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `el_projects_user_idx` ON `el_projects` (`user_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `el_project_resources` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES el_projects(`id`) ON DELETE CASCADE,
  `resource_id` text NOT NULL REFERENCES learning_resources(`id`) ON DELETE CASCADE,
  `role` text NOT NULL DEFAULT 'primary',
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `el_project_resources_project_idx` ON `el_project_resources` (`project_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `el_project_resources_resource_idx` ON `el_project_resources` (`resource_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `el_project_resources_unique` ON `el_project_resources` (`project_id`, `resource_id`);
--> statement-breakpoint
ALTER TABLE `session` ADD `el_project_id` text REFERENCES el_projects(`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `session` ADD `session_type` text NOT NULL DEFAULT 'workspace';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `session_el_project_idx` ON `session` (`el_project_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `session_type_idx` ON `session` (`session_type`);
