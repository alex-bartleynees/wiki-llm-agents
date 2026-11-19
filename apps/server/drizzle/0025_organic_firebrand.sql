CREATE TABLE `thread_worktree_shares` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`owner_thread_id` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `threads` ADD `continued_from_thread_id` text;--> statement-breakpoint
CREATE INDEX `threads_continued_from_idx` ON `threads` (`continued_from_thread_id`);