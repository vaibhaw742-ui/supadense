CREATE TABLE IF NOT EXISTS `api_request_log` (
	`id`           text PRIMARY KEY,
	`user_id`      text NOT NULL,
	`project_id`   text,
	`type`         text NOT NULL,
	`status`       integer NOT NULL,
	`duration_ms`  real NOT NULL,
	`document_id`  text,
	`time_created` integer NOT NULL
);
