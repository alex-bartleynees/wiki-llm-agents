CREATE TABLE `blobs` (
	`hash` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `links` (
	`vault_id` text NOT NULL,
	`src_path` text NOT NULL,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`target_path` text,
	PRIMARY KEY(`vault_id`, `src_path`, `kind`, `target`)
);
--> statement-breakpoint
CREATE INDEX `links_target` ON `links` (`vault_id`,`target_path`);--> statement-breakpoint
CREATE TABLE `notes` (
	`vault_id` text NOT NULL,
	`path` text NOT NULL,
	`title` text NOT NULL,
	`frontmatter` text NOT NULL,
	`tags` text NOT NULL,
	`content_hash` text NOT NULL,
	PRIMARY KEY(`vault_id`, `path`)
);
--> statement-breakpoint
CREATE INDEX `notes_content_hash` ON `notes` (`content_hash`);--> statement-breakpoint
CREATE TABLE `vault_files` (
	`vault_id` text NOT NULL,
	`path` text NOT NULL,
	`kind` text NOT NULL,
	`mtime_ms` integer NOT NULL,
	`size` integer NOT NULL,
	PRIMARY KEY(`vault_id`, `path`)
);
