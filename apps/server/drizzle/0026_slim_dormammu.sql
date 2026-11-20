CREATE TABLE `thread_subagents` (
	`thread_id` text NOT NULL,
	`subagent_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`label` text NOT NULL,
	`agent` text,
	`status` text NOT NULL,
	`result` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`thread_id`, `subagent_id`)
);
--> statement-breakpoint
CREATE INDEX `thread_subagents_status_idx` ON `thread_subagents` (`status`);--> statement-breakpoint
ALTER TABLE `runtime_requests` ADD `subagent_id` text;