CREATE TABLE `source_versions` (
	`source_id` text NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`sha256` text NOT NULL,
	`published_at` text,
	`retrieved_at` integer NOT NULL,
	`valid_from` integer NOT NULL,
	`valid_until` integer NOT NULL,
	PRIMARY KEY(`source_id`, `valid_from`),
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "source_versions_validity_check" CHECK("source_versions"."valid_from" <= "source_versions"."valid_until")
);
--> statement-breakpoint
ALTER TABLE `passages` ADD `valid_from` integer;--> statement-breakpoint
ALTER TABLE `passages` ADD `valid_until` integer DEFAULT 99991231 NOT NULL;