CREATE TABLE `project_ignored_files` (
	`project_id` text NOT NULL,
	`directory` text NOT NULL,
	`path` text NOT NULL,
	`ignored_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `directory`, `path`)
);
