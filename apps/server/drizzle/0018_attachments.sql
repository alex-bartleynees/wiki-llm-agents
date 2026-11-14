CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`sha256` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attachments_content_idx` ON `attachments` (`sha256`,`name`);