-- Add user_id to account table (defaults to "global" for any legacy rows)
ALTER TABLE `account` ADD COLUMN `user_id` text NOT NULL DEFAULT 'global';
--> statement-breakpoint
-- Recreate account_state with user_id text PK instead of integer id=1 singleton
PRAGMA legacy_alter_table = ON;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `account_state_new` (
	`user_id` text PRIMARY KEY,
	`active_account_id` text REFERENCES `account`(`id`) ON DELETE SET NULL,
	`active_org_id` text
);
--> statement-breakpoint
-- Migrate existing singleton row: map old id=1 row to user_id='global'
INSERT OR IGNORE INTO `account_state_new` (`user_id`, `active_account_id`, `active_org_id`)
	SELECT 'global', `active_account_id`, `active_org_id`
	FROM `account_state`
	WHERE `id` = 1;
--> statement-breakpoint
DROP TABLE IF EXISTS `account_state_old`;
--> statement-breakpoint
ALTER TABLE `account_state` RENAME TO `account_state_old`;
--> statement-breakpoint
ALTER TABLE `account_state_new` RENAME TO `account_state`;
--> statement-breakpoint
DROP TABLE IF EXISTS `account_state_old`;
--> statement-breakpoint
PRAGMA legacy_alter_table = OFF;
