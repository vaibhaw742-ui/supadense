ALTER TABLE `auth_users` ADD COLUMN `status` text NOT NULL DEFAULT 'approved';
--> statement-breakpoint
CREATE INDEX `auth_users_status_idx` ON `auth_users` (`status`);
