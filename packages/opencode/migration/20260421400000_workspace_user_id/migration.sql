ALTER TABLE `workspace` ADD COLUMN `user_id` text REFERENCES `auth_users`(`id`);
--> statement-breakpoint
CREATE INDEX `workspace_user_idx` ON `workspace` (`user_id`);
