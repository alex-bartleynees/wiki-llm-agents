CREATE TABLE `vaults` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`root_path` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vaults_root_path_unique` ON `vaults` (`root_path`);