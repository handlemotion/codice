CREATE TABLE `catalog_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`catalog` text NOT NULL,
	`key` text NOT NULL,
	`fields` text NOT NULL,
	`source_id` text NOT NULL,
	`valid_from` integer NOT NULL,
	`valid_until` integer DEFAULT 99991231 NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "catalog_entries_validity_check" CHECK("catalog_entries"."valid_from" <= "catalog_entries"."valid_until")
);
--> statement-breakpoint
CREATE INDEX `catalog_entries_catalog_key_idx` ON `catalog_entries` (`catalog`,`key`);--> statement-breakpoint
CREATE INDEX `catalog_entries_source_idx` ON `catalog_entries` (`source_id`);--> statement-breakpoint
CREATE TABLE `error_codes` (
	`code` text PRIMARY KEY NOT NULL,
	`node` text NOT NULL,
	`attribute` text NOT NULL,
	`validation` text NOT NULL,
	`message` text NOT NULL,
	`source_id` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `error_codes_source_idx` ON `error_codes` (`source_id`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`authority` text NOT NULL,
	`url` text NOT NULL,
	`sha256` text NOT NULL,
	`published_at` text,
	`retrieved_at` integer NOT NULL,
	`valid_from` integer NOT NULL,
	`valid_until` integer DEFAULT 99991231 NOT NULL,
	CONSTRAINT "sources_authority_check" CHECK("sources"."authority" IN ('SAT', 'DOF', 'SCJN', 'TFJA', 'Congreso')),
	CONSTRAINT "sources_validity_check" CHECK("sources"."valid_from" <= "sources"."valid_until")
);
