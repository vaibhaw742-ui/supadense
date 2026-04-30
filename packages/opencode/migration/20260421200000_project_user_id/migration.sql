ALTER TABLE `project` ADD COLUMN `user_id` text REFERENCES `auth_users`(`id`);
--> statement-breakpoint
CREATE INDEX `project_user_idx` ON `project` (`user_id`);
