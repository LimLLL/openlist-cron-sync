PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_job_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`instance_id` text NOT NULL,
	`path` text NOT NULL,
	`password_enc` text,
	`position` integer NOT NULL,
	`mode` text DEFAULT 'incremental' NOT NULL,
	`create_mode` text DEFAULT 'relay' NOT NULL,
	`scan_interval_seconds` integer DEFAULT 0 NOT NULL,
	`concurrent_files` integer DEFAULT 2 NOT NULL,
	`chunk_concurrency` integer DEFAULT 2 NOT NULL,
	`refresh` integer DEFAULT false NOT NULL,
	`delete_limits_enabled` integer DEFAULT true NOT NULL,
	`max_delete_count` integer,
	`max_delete_percent` integer,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "job_targets_position_nonnegative" CHECK("__new_job_targets"."position" >= 0),
	CONSTRAINT "job_targets_scan_interval" CHECK(typeof("__new_job_targets"."scan_interval_seconds") = 'integer' AND "__new_job_targets"."scan_interval_seconds" BETWEEN 0 AND 3600),
	CONSTRAINT "job_targets_mode" CHECK("__new_job_targets"."mode" IN ('incremental','mirror')),
	CONSTRAINT "job_targets_create_mode" CHECK("__new_job_targets"."create_mode" IN ('relay','server_copy')),
	CONSTRAINT "job_targets_booleans" CHECK("__new_job_targets"."refresh" IN (0,1) AND "__new_job_targets"."delete_limits_enabled" IN (0,1)),
	CONSTRAINT "job_targets_limits" CHECK(("__new_job_targets"."delete_limits_enabled" = 0 OR "__new_job_targets"."max_delete_count" IS NOT NULL OR "__new_job_targets"."max_delete_percent" IS NOT NULL) AND ("__new_job_targets"."max_delete_count" IS NULL OR "__new_job_targets"."max_delete_count" BETWEEN 0 AND 9007199254740991) AND ("__new_job_targets"."max_delete_percent" IS NULL OR "__new_job_targets"."max_delete_percent" BETWEEN 0 AND 100)),
	CONSTRAINT "job_targets_resources" CHECK("__new_job_targets"."concurrent_files" BETWEEN 0 AND 9007199254740991 AND "__new_job_targets"."chunk_concurrency" BETWEEN 1 AND 8),
	CONSTRAINT "job_targets_times" CHECK("__new_job_targets"."created_at" >= 0 AND "__new_job_targets"."updated_at" >= 0 AND ("__new_job_targets"."archived_at" IS NULL OR "__new_job_targets"."archived_at" >= 0))
);
--> statement-breakpoint
INSERT INTO `__new_job_targets`("id", "job_id", "instance_id", "path", "password_enc", "position", "mode", "create_mode", "scan_interval_seconds", "concurrent_files", "chunk_concurrency", "refresh", "delete_limits_enabled", "max_delete_count", "max_delete_percent", "archived_at", "created_at", "updated_at") SELECT "id", "job_id", "instance_id", "path", "password_enc", "position", "mode", "create_mode", "scan_interval_seconds", "concurrent_files", "chunk_concurrency", "refresh", "delete_limits_enabled", "max_delete_count", "max_delete_percent", "archived_at", "created_at", "updated_at" FROM `job_targets`;--> statement-breakpoint
DROP TABLE `job_targets`;--> statement-breakpoint
ALTER TABLE `__new_job_targets` RENAME TO `job_targets`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `job_targets_position` ON `job_targets` (`job_id`,`position`) WHERE "job_targets"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX `job_targets_instance_archive` ON `job_targets` (`instance_id`,`archived_at`);--> statement-breakpoint
CREATE TABLE `__new_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`source_instance_id` text NOT NULL,
	`source_path` text NOT NULL,
	`source_password_enc` text,
	`source_refresh` integer DEFAULT false NOT NULL,
	`source_scan_interval_seconds` integer DEFAULT 0 NOT NULL,
	`source_download_concurrency` integer DEFAULT 2 NOT NULL,
	`cron` text,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`include_globs_json` text NOT NULL,
	`exclude_globs_json` text NOT NULL,
	`min_size_bytes` integer,
	`max_size_bytes` integer,
	`allow_empty_source` integer DEFAULT false NOT NULL,
	`sync_empty_dirs` integer DEFAULT false NOT NULL,
	`retry_count` integer,
	`relay_bandwidth_limit` integer DEFAULT 0 NOT NULL,
	`timeout_seconds` integer DEFAULT 86400 NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "jobs_scan_interval" CHECK(typeof("__new_jobs"."source_scan_interval_seconds") = 'integer' AND "__new_jobs"."source_scan_interval_seconds" BETWEEN 0 AND 3600),
	CONSTRAINT "jobs_name" CHECK(length("__new_jobs"."name") BETWEEN 1 AND 100),
	CONSTRAINT "jobs_booleans" CHECK("__new_jobs"."enabled" IN (0,1) AND "__new_jobs"."source_refresh" IN (0,1) AND "__new_jobs"."allow_empty_source" IN (0,1) AND "__new_jobs"."sync_empty_dirs" IN (0,1)),
	CONSTRAINT "jobs_globs" CHECK(json_valid("__new_jobs"."include_globs_json") AND json_valid("__new_jobs"."exclude_globs_json")),
	CONSTRAINT "jobs_sizes" CHECK(("__new_jobs"."min_size_bytes" IS NULL OR "__new_jobs"."min_size_bytes" BETWEEN 0 AND 9007199254740991) AND ("__new_jobs"."max_size_bytes" IS NULL OR "__new_jobs"."max_size_bytes" BETWEEN 0 AND 9007199254740991) AND ("__new_jobs"."min_size_bytes" IS NULL OR "__new_jobs"."max_size_bytes" IS NULL OR "__new_jobs"."min_size_bytes" <= "__new_jobs"."max_size_bytes")),
	CONSTRAINT "jobs_limits" CHECK("__new_jobs"."timeout_seconds" BETWEEN 60 AND 604800 AND "__new_jobs"."relay_bandwidth_limit" BETWEEN 0 AND 9007199254740991 AND "__new_jobs"."source_download_concurrency" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "jobs_retry_count" CHECK("__new_jobs"."retry_count" IS NULL OR "__new_jobs"."retry_count" BETWEEN 0 AND 9),
	CONSTRAINT "jobs_times" CHECK("__new_jobs"."created_at" >= 0 AND "__new_jobs"."updated_at" >= 0 AND ("__new_jobs"."archived_at" IS NULL OR "__new_jobs"."archived_at" >= 0))
);
--> statement-breakpoint
INSERT INTO `__new_jobs`("id", "name", "enabled", "source_instance_id", "source_path", "source_password_enc", "source_refresh", "source_scan_interval_seconds", "source_download_concurrency", "cron", "timezone", "include_globs_json", "exclude_globs_json", "min_size_bytes", "max_size_bytes", "allow_empty_source", "sync_empty_dirs", "retry_count", "relay_bandwidth_limit", "timeout_seconds", "archived_at", "created_at", "updated_at") SELECT "id", "name", "enabled", "source_instance_id", "source_path", "source_password_enc", "source_refresh", "source_scan_interval_seconds", "source_download_concurrency", "cron", "timezone", "include_globs_json", "exclude_globs_json", "min_size_bytes", "max_size_bytes", "allow_empty_source", "sync_empty_dirs", "retry_count", "relay_bandwidth_limit", "timeout_seconds", "archived_at", "created_at", "updated_at" FROM `jobs`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;--> statement-breakpoint
CREATE INDEX `jobs_enabled_archive` ON `jobs` (`enabled`,`archived_at`);--> statement-breakpoint
CREATE INDEX `jobs_source` ON `jobs` (`source_instance_id`);