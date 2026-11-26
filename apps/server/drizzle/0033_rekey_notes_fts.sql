CREATE TEMP TABLE `_notes_fts_dedup` AS
SELECT f.`vault_id`, f.`path`, f.`title`, f.`body`, f.`tags`
FROM `notes_fts` f
JOIN (
  SELECT `vault_id`, `path`, MAX(`rowid`) AS `max_rowid`
  FROM `notes_fts`
  GROUP BY `vault_id`, `path`
) latest ON latest.`max_rowid` = f.`rowid`
JOIN `notes` n ON n.`vault_id` = f.`vault_id` AND n.`path` = f.`path`;
--> statement-breakpoint
DELETE FROM `notes_fts`;
--> statement-breakpoint
INSERT INTO `notes_fts` (`vault_id`, `path`, `title`, `body`, `tags`)
SELECT `vault_id`, `path`, `title`, `body`, `tags` FROM `_notes_fts_dedup`;
--> statement-breakpoint
DROP TABLE `_notes_fts_dedup`;
--> statement-breakpoint
UPDATE `notes`
SET `fts_rowid` = (
  SELECT f.`rowid`
  FROM `notes_fts` f
  WHERE f.`vault_id` = `notes`.`vault_id` AND f.`path` = `notes`.`path`
  LIMIT 1
);
