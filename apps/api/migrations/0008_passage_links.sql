CREATE TABLE `passage_links` (
	`passage_key` text NOT NULL,
	`related_key` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`passage_key`, `related_key`),
	FOREIGN KEY (`passage_key`) REFERENCES `passages`(`key`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`related_key`) REFERENCES `passages`(`key`) ON UPDATE no action ON DELETE no action
);
