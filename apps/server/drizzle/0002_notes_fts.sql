CREATE VIRTUAL TABLE `notes_fts` USING fts5(
	`vault_id` UNINDEXED,
	`path` UNINDEXED,
	`title`,
	`body`,
	`tags`,
	tokenize = 'porter unicode61 remove_diacritics 2'
);
