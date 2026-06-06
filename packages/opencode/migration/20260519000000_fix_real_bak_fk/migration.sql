-- Fix broken FK references pointing to "learning_kb_workspaces_real_bak".
-- Migration 20260501000000_fix_kb_old_fk_refs renamed learning_kb_workspaces
-- to learning_kb_workspaces_real_bak as an intermediate step, then dropped it,
-- leaving all pre-existing child tables (learning_resources, learning_categories, etc.)
-- with dangling FK DDLs referencing the now-missing table.
-- This migration recreates the missing table and keeps it in sync via triggers.

CREATE TABLE IF NOT EXISTS `learning_kb_workspaces_real_bak` (
  `id` text PRIMARY KEY
);
--> statement-breakpoint
INSERT OR IGNORE INTO `learning_kb_workspaces_real_bak` (`id`)
  SELECT `id` FROM `learning_kb_workspaces`;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_kb_ws_real_bak_insert`
  AFTER INSERT ON `learning_kb_workspaces`
  BEGIN
    INSERT OR REPLACE INTO `learning_kb_workspaces_real_bak` (`id`) VALUES (NEW.`id`);
  END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `sync_kb_ws_real_bak_delete`
  AFTER DELETE ON `learning_kb_workspaces`
  BEGIN
    DELETE FROM `learning_kb_workspaces_real_bak` WHERE `id` = OLD.`id`;
  END;
