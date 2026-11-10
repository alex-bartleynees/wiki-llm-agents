CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`vault_id` text NOT NULL,
	`working_directories` text NOT NULL,
	`notes_folder` text,
	`baseline` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `threads` ADD `project_id` text;