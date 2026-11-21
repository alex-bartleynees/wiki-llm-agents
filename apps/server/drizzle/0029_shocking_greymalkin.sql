CREATE TABLE `thread_inactivity_policy` (
	`id` integer PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL,
	`days` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `threads` ADD `done_reason` text;--> statement-breakpoint
ALTER TABLE `threads` ADD `activity_at` integer;--> statement-breakpoint
CREATE INDEX `threads_inactivity_idx` ON `threads` (`activity_at`,`id`) WHERE "threads"."done_at" IS NULL AND "threads"."deleted_at" IS NULL;