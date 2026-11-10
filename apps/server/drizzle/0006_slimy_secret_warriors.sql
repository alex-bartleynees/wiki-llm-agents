CREATE TABLE `thread_notes` (
	`thread_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`path` text NOT NULL,
	`reason` text NOT NULL,
	`hash` text NOT NULL,
	PRIMARY KEY(`thread_id`, `turn_id`, `path`, `reason`, `hash`)
);
--> statement-breakpoint
CREATE INDEX `thread_notes_path_idx` ON `thread_notes` (`path`);