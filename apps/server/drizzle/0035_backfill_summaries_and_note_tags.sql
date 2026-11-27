UPDATE `threads`
SET
	`continued_in_thread_id` = (
		SELECT c.`id`
		FROM `threads` c
		WHERE c.`continued_from_thread_id` = `threads`.`id` AND c.`deleted_at` IS NULL
		ORDER BY c.`created_at` DESC
		LIMIT 1
	),
	`last_seq` = COALESCE((SELECT MAX(e.`seq`) FROM `thread_events` e WHERE e.`thread_id` = `threads`.`id`), 0),
	`status` = CASE
		WHEN EXISTS (SELECT 1 FROM `runtime_requests` r WHERE r.`thread_id` = `threads`.`id` AND r.`status` = 'pending') THEN 'waiting'
		WHEN EXISTS (SELECT 1 FROM `turns` t WHERE t.`thread_id` = `threads`.`id` AND t.`status` = 'running') THEN 'running'
		ELSE 'idle'
	END,
	`active_subagents` = (SELECT COUNT(*) FROM `thread_subagents` s WHERE s.`thread_id` = `threads`.`id` AND s.`status` IN ('running', 'waiting')),
	`running_turn_json` = (
		SELECT json_object('startedAt', t.`started_at`, 'plan', t.`plan`)
		FROM `turns` t
		WHERE t.`thread_id` = `threads`.`id` AND t.`status` = 'running'
		ORDER BY t.`started_at` DESC
		LIMIT 1
	),
	`last_turn_json` = (
		SELECT json_object('outcome', t.`status`, 'reason', t.`reason`, 'endedAt', t.`ended_at`)
		FROM `turns` t
		WHERE t.`thread_id` = `threads`.`id` AND t.`status` <> 'running'
		ORDER BY t.`ended_at` DESC, t.`rowid` DESC
		LIMIT 1
	);
--> statement-breakpoint
INSERT OR IGNORE INTO `note_tags` (`vault_id`, `tag`, `path`)
SELECT n.`vault_id`, lower(t.`value`), n.`path`
FROM `notes` n, json_each(n.`tags`) AS t
WHERE t.`type` = 'text' AND t.`value` <> '';
--> statement-breakpoint
UPDATE `notes`
SET `lead` = COALESCE(
	(
		SELECT trim(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(f.`body`, char(13), ' '), char(10), ' '), char(9), ' '), char(11), ' '), char(12), ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '), '  ', ' '))
		FROM `notes_fts` f
		WHERE f.`rowid` = `notes`.`fts_rowid`
	),
	''
);
--> statement-breakpoint
UPDATE `notes`
SET `lead` = rtrim(substr(`lead`, 1, 200)) || '…'
WHERE length(`lead`) > 200;
