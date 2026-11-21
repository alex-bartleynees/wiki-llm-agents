ALTER TABLE `threads` ADD `parent_thread_id` text;--> statement-breakpoint
CREATE INDEX `threads_parent_idx` ON `threads` (`parent_thread_id`);