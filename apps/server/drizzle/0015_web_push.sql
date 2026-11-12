CREATE TABLE `notification_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`preferences` text,
	`vapid_public_key` text,
	`vapid_private_key` text
);
--> statement-breakpoint
CREATE TABLE `push_deliveries` (
	`item_id` text NOT NULL,
	`device_id` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer NOT NULL,
	`last_error` text,
	`at` integer NOT NULL,
	PRIMARY KEY(`item_id`, `device_id`)
);
--> statement-breakpoint
CREATE INDEX `push_deliveries_device_idx` ON `push_deliveries` (`device_id`);--> statement-breakpoint
CREATE TABLE `push_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_sent_at` integer,
	`last_error` text,
	`failures` integer NOT NULL,
	`disabled` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_devices_endpoint_idx` ON `push_devices` (`endpoint`);--> statement-breakpoint
CREATE TABLE `push_digest_queue` (
	`item_id` text PRIMARY KEY NOT NULL,
	`held_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `inbox_deliveries` ADD `detail` text;