CREATE TABLE `api_usage` (
	`day` text NOT NULL,
	`credential_kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`surface` text NOT NULL,
	`operation` text NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL,
	`errors` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`day`, `credential_kind`, `owner_id`, `credential_id`, `surface`, `operation`)
);
--> statement-breakpoint
CREATE INDEX `api_usage_owner_day_idx` ON `api_usage` (`credential_kind`,`owner_id`,`day`);