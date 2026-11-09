-- Full-text search over notes (searched from slice 3). A plain FTS5 table that the
-- indexer keeps in step with `notes`: one row per note, replaced when it changes.
-- vault_id and path are stored to identify rows but are not searched.
CREATE VIRTUAL TABLE `notes_fts` USING fts5(
	`vault_id` UNINDEXED,
	`path` UNINDEXED,
	`title`,
	`body`,
	`tags`,
	tokenize = 'porter unicode61 remove_diacritics 2'
);
