ALTER TABLE `threads` ADD `draft_text` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `threads` ADD `draft_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `threads` ADD `draft_writer_id` text;--> statement-breakpoint
ALTER TABLE `threads` ADD `draft_sequence` integer DEFAULT 0 NOT NULL;