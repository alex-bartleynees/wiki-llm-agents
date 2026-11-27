CREATE TABLE `note_tags` (
	`vault_id` text NOT NULL,
	`tag` text NOT NULL,
	`path` text NOT NULL,
	PRIMARY KEY(`vault_id`, `tag`, `path`)
);
--> statement-breakpoint
CREATE INDEX `note_tags_vault_path_idx` ON `note_tags` (`vault_id`,`path`,`tag`);--> statement-breakpoint
ALTER TABLE `notes` ADD `lead` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `threads` ADD `continued_in_thread_id` text;--> statement-breakpoint
ALTER TABLE `threads` ADD `last_seq` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `threads` ADD `status` text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE `threads` ADD `active_subagents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `threads` ADD `running_turn_json` text;--> statement-breakpoint
ALTER TABLE `threads` ADD `last_turn_json` text;--> statement-breakpoint
CREATE INDEX `threads_active_idx` ON `threads` (`updated_at`) WHERE "threads"."status" <> 'idle' OR "threads"."active_subagents" > 0;