CREATE TABLE `project_files` (
	`project_id` text NOT NULL,
	`directory` text NOT NULL,
	`path` text NOT NULL,
	`hash` text NOT NULL,
	PRIMARY KEY(`project_id`, `directory`, `path`)
);
--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `baseline`;