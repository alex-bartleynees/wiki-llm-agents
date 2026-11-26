ALTER TABLE `notes` ADD `fts_rowid` integer;--> statement-breakpoint
CREATE INDEX `file_changes_before_hash_idx` ON `file_changes` (`before_hash`);--> statement-breakpoint
CREATE INDEX `file_changes_after_hash_idx` ON `file_changes` (`after_hash`);--> statement-breakpoint
CREATE INDEX `project_worktrees_project_idx` ON `project_worktrees` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `threads_updated_idx` ON `threads` (`updated_at`);--> statement-breakpoint
CREATE INDEX `turns_thread_ended_idx` ON `turns` (`thread_id`,`ended_at`);