CREATE TABLE `project_worktrees` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`branch` text NOT NULL,
	`path` text NOT NULL,
	`directory` text NOT NULL,
	`created_at` integer NOT NULL,
	`removed_at` integer
);
