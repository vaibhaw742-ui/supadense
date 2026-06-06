CREATE TABLE `local_project` (
  `id`           text PRIMARY KEY NOT NULL,
  `user_id`      text NOT NULL,
  `name`         text NOT NULL,
  `local_path`   text NOT NULL,
  `brain_dir`    text NOT NULL,
  `sources_dir`  text NOT NULL,
  `source_id`    text NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);
CREATE INDEX `local_project_user_idx` ON `local_project` (`user_id`);
