PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_passages` (
	`key` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`heading` text NOT NULL,
	`sha256` text NOT NULL,
	`valid_from` integer NOT NULL,
	`valid_until` integer DEFAULT 99991231 NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "passages_validity_check" CHECK("__new_passages"."valid_from" <= "__new_passages"."valid_until")
);
--> statement-breakpoint
INSERT INTO `__new_passages`("key", "source_id", "heading", "sha256", "valid_from", "valid_until") SELECT "key", "source_id", "heading", "sha256", "valid_from", "valid_until" FROM `passages`;--> statement-breakpoint
DROP TABLE `passages`;--> statement-breakpoint
ALTER TABLE `__new_passages` RENAME TO `passages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `passages_source_idx` ON `passages` (`source_id`);