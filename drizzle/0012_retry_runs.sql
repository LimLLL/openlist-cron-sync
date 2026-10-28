CREATE TABLE `run_retry_items` (
	`run_id` text NOT NULL,
	`run_target_id` text NOT NULL,
	`relative_path` text NOT NULL,
	`is_dir` integer NOT NULL,
	`scan_outcome` text DEFAULT 'unprocessed' NOT NULL,
	PRIMARY KEY(`run_target_id`, `relative_path`),
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`run_target_id`) REFERENCES `run_targets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "run_retry_items_directory" CHECK("run_retry_items"."is_dir" IN (0,1) AND ("run_retry_items"."relative_path" != '' OR "run_retry_items"."is_dir" = 1)),
	CONSTRAINT "run_retry_items_outcome" CHECK("run_retry_items"."scan_outcome" IN ('unprocessed','noop','planned','blocked'))
);
--> statement-breakpoint
CREATE INDEX `run_retry_items_run` ON `run_retry_items` (`run_id`);--> statement-breakpoint
ALTER TABLE `runs` ADD `retry_of_run_id` text;