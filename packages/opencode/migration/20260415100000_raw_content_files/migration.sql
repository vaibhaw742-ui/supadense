-- Store raw content as files; DB holds the path instead of the full text.
ALTER TABLE `learning_resources` ADD COLUMN `raw_content_path` text;
