CREATE TABLE `provider_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runtime_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`prompt` text NOT NULL,
	`status` text NOT NULL,
	`answer` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE INDEX `runtime_requests_thread_idx` ON `runtime_requests` (`thread_id`,`status`);--> statement-breakpoint
CREATE TABLE `thread_events` (
	`thread_id` text NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`at` integer NOT NULL,
	PRIMARY KEY(`thread_id`, `seq`)
);
--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY NOT NULL,
	`vault_id` text NOT NULL,
	`title` text,
	`provider_instance_id` text NOT NULL,
	`model` text,
	`native_session_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `threads_vault_idx` ON `threads` (`vault_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `turns` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`input` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`input_tokens` integer,
	`output_tokens` integer,
	`cost_usd` real
);
--> statement-breakpoint
CREATE INDEX `turns_thread_idx` ON `turns` (`thread_id`,`status`);