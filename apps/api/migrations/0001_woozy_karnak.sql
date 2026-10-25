CREATE TABLE `passages` (
	`key` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`heading` text NOT NULL,
	`sha256` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `passages_source_idx` ON `passages` (`source_id`);