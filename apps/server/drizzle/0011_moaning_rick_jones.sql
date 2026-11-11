CREATE TABLE `file_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`vault_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`path` text NOT NULL,
	`before_hash` text,
	`after_hash` text,
	`attribution` text NOT NULL,
	`actor` text NOT NULL,
	`recorded_at` integer NOT NULL,
	`undone_at` integer
);
--> statement-breakpoint
CREATE INDEX `file_changes_turn_idx` ON `file_changes` (`turn_id`);--> statement-breakpoint
CREATE INDEX `file_changes_path_idx` ON `file_changes` (`vault_id`,`path`);