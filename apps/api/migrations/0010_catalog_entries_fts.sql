-- Custom SQL migration file, put your code below! --
-- Drizzle cannot declare an FTS5 virtual table, so `drizzle-kit generate --custom` made this file
-- (SPEC.md, "Catalog search"). An external-content index
-- (https://www.sqlite.org/fts5.html#external_content_tables): it keeps no copy of the text, and
-- the triggers below keep it in step with every write to `catalog_entries`. Its content is the view
-- of the entries with search text, the only ones it holds, so FTS5's `integrity-check` and
-- `rebuild` agree with it.
CREATE VIEW `catalog_entries_searchable` AS
	SELECT `id`, `catalog`, `search_text` FROM `catalog_entries` WHERE `search_text` IS NOT NULL;
--> statement-breakpoint
CREATE VIRTUAL TABLE `catalog_entries_fts` USING fts5(
	`catalog`,
	`search_text`,
	content = 'catalog_entries_searchable',
	content_rowid = 'id',
	tokenize = 'porter unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER `catalog_entries_fts_insert` AFTER INSERT ON `catalog_entries`
WHEN new.`search_text` IS NOT NULL BEGIN
	INSERT INTO `catalog_entries_fts` (rowid, `catalog`, `search_text`)
	VALUES (new.`id`, new.`catalog`, new.`search_text`);
END;
--> statement-breakpoint
CREATE TRIGGER `catalog_entries_fts_delete` AFTER DELETE ON `catalog_entries`
WHEN old.`search_text` IS NOT NULL BEGIN
	INSERT INTO `catalog_entries_fts` (`catalog_entries_fts`, rowid, `catalog`, `search_text`)
	VALUES ('delete', old.`id`, old.`catalog`, old.`search_text`);
END;
--> statement-breakpoint
CREATE TRIGGER `catalog_entries_fts_update` AFTER UPDATE ON `catalog_entries` BEGIN
	INSERT INTO `catalog_entries_fts` (`catalog_entries_fts`, rowid, `catalog`, `search_text`)
	SELECT 'delete', old.`id`, old.`catalog`, old.`search_text` WHERE old.`search_text` IS NOT NULL;
	INSERT INTO `catalog_entries_fts` (rowid, `catalog`, `search_text`)
	SELECT new.`id`, new.`catalog`, new.`search_text` WHERE new.`search_text` IS NOT NULL;
END;
