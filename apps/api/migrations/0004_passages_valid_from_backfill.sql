-- Phase 0 holds one version of each source: every passage applies from its source's first day.
UPDATE `passages` SET `valid_from` = (SELECT `valid_from` FROM `sources` WHERE `sources`.`id` = `passages`.`source_id`) WHERE `valid_from` IS NULL;
