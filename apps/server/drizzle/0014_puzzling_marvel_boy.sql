CREATE TABLE `inbox_deliveries` (
	`item_id` text NOT NULL,
	`channel` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_error` text,
	`sent_at` integer,
	PRIMARY KEY(`item_id`, `channel`)
);
--> statement-breakpoint
CREATE INDEX `inbox_deliveries_due_idx` ON `inbox_deliveries` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `inbox_items` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`state` text NOT NULL,
	`read` integer NOT NULL,
	`overdue` integer NOT NULL,
	`snoozed_until` integer,
	`resolution` text,
	`vault_id` text,
	`thread_id` text,
	`turn_id` text,
	`request_id` text,
	`schedule_id` text,
	`note_path` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `inbox_items_state_idx` ON `inbox_items` (`state`,`updated_at`);--> statement-breakpoint
CREATE INDEX `inbox_items_request_idx` ON `inbox_items` (`request_id`);--> statement-breakpoint
CREATE INDEX `inbox_items_thread_idx` ON `inbox_items` (`thread_id`,`kind`);--> statement-breakpoint
CREATE TABLE `schedule_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`slot_at` integer NOT NULL,
	`fired_at` integer NOT NULL,
	`status` text NOT NULL,
	`overdue` integer NOT NULL,
	`coalesced` integer NOT NULL,
	`manual` integer NOT NULL,
	`thread_id` text,
	`turn_id` text,
	`reason` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cost_usd` real,
	`ended_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_runs_slot_idx` ON `schedule_runs` (`schedule_id`,`slot_at`);--> statement-breakpoint
CREATE INDEX `schedule_runs_turn_idx` ON `schedule_runs` (`turn_id`);--> statement-breakpoint
CREATE INDEX `schedule_runs_status_idx` ON `schedule_runs` (`status`);--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`text` text NOT NULL,
	`recurrence` text NOT NULL,
	`timezone` text NOT NULL,
	`vault_id` text,
	`project_id` text,
	`agent_id` text,
	`provider_instance_id` text,
	`model` text,
	`link` text,
	`thread_id` text,
	`missed_policy` text NOT NULL,
	`status` text NOT NULL,
	`paused_reason` text,
	`next_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `schedules_next_idx` ON `schedules` (`status`,`next_at`);--> statement-breakpoint
ALTER TABLE `turns` ADD `unattended` integer DEFAULT false NOT NULL;