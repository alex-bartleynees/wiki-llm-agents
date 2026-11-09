CREATE TABLE `pins` (
	`vault_id` text NOT NULL,
	`path` text NOT NULL,
	`pinned_at` integer NOT NULL,
	PRIMARY KEY(`vault_id`, `path`)
);
