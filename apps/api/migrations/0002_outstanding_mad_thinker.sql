DROP INDEX `catalog_entries_catalog_key_idx`;--> statement-breakpoint
CREATE INDEX `catalog_entries_catalog_key_idx` ON `catalog_entries` ("catalog" COLLATE NOCASE,"key" COLLATE NOCASE);