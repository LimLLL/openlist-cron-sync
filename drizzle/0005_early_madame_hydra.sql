PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`auth_mode` text NOT NULL,
	`username` text,
	`secret_enc` text,
	`auth_state` text DEFAULT 'untested' NOT NULL,
	`auth_block_reason` text,
	`auth_blocked_until` integer,
	`account_username` text,
	`account_base_path` text,
	`account_role` integer,
	`account_permissions` integer,
	`max_api_concurrency` integer DEFAULT 4 NOT NULL,
	`max_outstanding_tasks` integer DEFAULT 4 NOT NULL,
	`max_download_connections` integer DEFAULT 2 NOT NULL,
	`max_upload_sessions` integer DEFAULT 2 NOT NULL,
	`max_chunk_concurrency` integer DEFAULT 4 NOT NULL,
	`api_requests_per_second` integer DEFAULT 5 NOT NULL,
	`download_mode` text DEFAULT 'd' NOT NULL,
	`last_test_at` integer,
	`openlist_version` text,
	`multipart_enabled` integer,
	`last_error_code` text,
	`last_error_message` text,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "instances_name" CHECK(length("__new_instances"."name") BETWEEN 1 AND 100),
	CONSTRAINT "instances_auth_mode" CHECK("__new_instances"."auth_mode" IN ('token','password')),
	CONSTRAINT "instances_username" CHECK(("__new_instances"."auth_mode" = 'token' AND "__new_instances"."username" IS NULL) OR ("__new_instances"."auth_mode" = 'password' AND length("__new_instances"."username") > 0 AND "__new_instances"."username" IS NOT NULL)),
	CONSTRAINT "instances_auth_state" CHECK("__new_instances"."auth_state" IN ('untested','ready','auth_blocked')),
	CONSTRAINT "instances_download_mode" CHECK("__new_instances"."download_mode" IN ('d','p')),
	CONSTRAINT "instances_api_concurrency" CHECK("__new_instances"."max_api_concurrency" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "instances_task_limit" CHECK("__new_instances"."max_outstanding_tasks" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "instances_download_limit" CHECK("__new_instances"."max_download_connections" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "instances_upload_limit" CHECK("__new_instances"."max_upload_sessions" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "instances_chunk_limit" CHECK("__new_instances"."max_chunk_concurrency" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "instances_api_rate" CHECK("__new_instances"."api_requests_per_second" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "instances_multipart" CHECK("__new_instances"."multipart_enabled" IS NULL OR "__new_instances"."multipart_enabled" IN (0,1)),
	CONSTRAINT "instances_times" CHECK("__new_instances"."created_at" >= 0 AND "__new_instances"."updated_at" >= 0 AND ("__new_instances"."archived_at" IS NULL OR "__new_instances"."archived_at" >= 0) AND ("__new_instances"."last_test_at" IS NULL OR "__new_instances"."last_test_at" >= 0) AND ("__new_instances"."auth_blocked_until" IS NULL OR "__new_instances"."auth_blocked_until" >= 0))
);
--> statement-breakpoint
INSERT INTO `__new_instances`("id", "name", "base_url", "auth_mode", "username", "secret_enc", "auth_state", "auth_block_reason", "auth_blocked_until", "account_username", "account_base_path", "account_role", "account_permissions", "max_api_concurrency", "max_outstanding_tasks", "max_download_connections", "max_upload_sessions", "max_chunk_concurrency", "api_requests_per_second", "download_mode", "last_test_at", "openlist_version", "multipart_enabled", "last_error_code", "last_error_message", "archived_at", "created_at", "updated_at") SELECT "id", "name", "base_url", "auth_mode", "username", "secret_enc", "auth_state", "auth_block_reason", "auth_blocked_until", "account_username", "account_base_path", "account_role", "account_permissions", "max_api_concurrency", "max_outstanding_tasks", "max_download_connections", "max_upload_sessions", "max_chunk_concurrency", "api_requests_per_second", "download_mode", "last_test_at", "openlist_version", "multipart_enabled", "last_error_code", "last_error_message", "archived_at", "created_at", "updated_at" FROM `instances`;--> statement-breakpoint
DROP TABLE `instances`;--> statement-breakpoint
ALTER TABLE `__new_instances` RENAME TO `instances`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `instances_archive_created_id` ON `instances` (`archived_at`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `__new_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`source_instance_id` text NOT NULL,
	`source_path` text NOT NULL,
	`source_password_enc` text,
	`source_refresh` integer DEFAULT false NOT NULL,
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
	CONSTRAINT "jobs_name" CHECK(length("__new_jobs"."name") BETWEEN 1 AND 100),
	CONSTRAINT "jobs_booleans" CHECK("__new_jobs"."enabled" IN (0,1) AND "__new_jobs"."source_refresh" IN (0,1) AND "__new_jobs"."allow_empty_source" IN (0,1) AND "__new_jobs"."sync_empty_dirs" IN (0,1)),
	CONSTRAINT "jobs_globs" CHECK(json_valid("__new_jobs"."include_globs_json") AND json_valid("__new_jobs"."exclude_globs_json")),
	CONSTRAINT "jobs_sizes" CHECK(("__new_jobs"."min_size_bytes" IS NULL OR "__new_jobs"."min_size_bytes" BETWEEN 0 AND 9007199254740991) AND ("__new_jobs"."max_size_bytes" IS NULL OR "__new_jobs"."max_size_bytes" BETWEEN 0 AND 9007199254740991) AND ("__new_jobs"."min_size_bytes" IS NULL OR "__new_jobs"."max_size_bytes" IS NULL OR "__new_jobs"."min_size_bytes" <= "__new_jobs"."max_size_bytes")),
	CONSTRAINT "jobs_limits" CHECK("__new_jobs"."timeout_seconds" BETWEEN 60 AND 604800 AND "__new_jobs"."relay_bandwidth_limit" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "jobs_retry_count" CHECK("__new_jobs"."retry_count" IS NULL OR "__new_jobs"."retry_count" BETWEEN 0 AND 9),
	CONSTRAINT "jobs_times" CHECK("__new_jobs"."created_at" >= 0 AND "__new_jobs"."updated_at" >= 0 AND ("__new_jobs"."archived_at" IS NULL OR "__new_jobs"."archived_at" >= 0))
);
--> statement-breakpoint
INSERT INTO `__new_jobs`("id", "name", "enabled", "source_instance_id", "source_path", "source_password_enc", "source_refresh", "cron", "timezone", "include_globs_json", "exclude_globs_json", "min_size_bytes", "max_size_bytes", "allow_empty_source", "sync_empty_dirs", "retry_count", "relay_bandwidth_limit", "timeout_seconds", "archived_at", "created_at", "updated_at") SELECT "id", "name", "enabled", "source_instance_id", "source_path", "source_password_enc", "source_refresh", "cron", "timezone", "include_globs_json", "exclude_globs_json", "min_size_bytes", "max_size_bytes", "allow_empty_source", "sync_empty_dirs", NULL, "relay_bandwidth_limit", "timeout_seconds", "archived_at", "created_at", "updated_at" FROM `jobs`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;--> statement-breakpoint
CREATE INDEX `jobs_enabled_archive` ON `jobs` (`enabled`,`archived_at`);--> statement-breakpoint
CREATE INDEX `jobs_source` ON `jobs` (`source_instance_id`);--> statement-breakpoint
-- Historical Runs inherited the process retry setting: record that as retryCount null and keep
-- their frozen settings untouched. A snapshot that already carries retryCount is not one this
-- release wrote, so abort instead of overwriting it.
CREATE TEMP TABLE `__retry_count_check` (
  `valid` integer NOT NULL,
  CONSTRAINT `retry_count_snapshot_shape` CHECK (`valid` = 1)
);--> statement-breakpoint
INSERT INTO `__retry_count_check`
SELECT 0 FROM runs WHERE (
  json_type(run_config_json) = 'object'
  AND json_type(run_config_json, '$.snapshotVersion') = 'integer'
  AND json_extract(run_config_json, '$.snapshotVersion') = 1
  AND json_type(run_config_json, '$.job') = 'object'
  AND json_extract(run_config_json, '$.job.id') = job_id
  AND json_type(run_config_json, '$.job.retryCount') IS NULL
) IS NOT TRUE LIMIT 1;--> statement-breakpoint
UPDATE runs
SET run_config_json = json_set(run_config_json, '$.job.retryCount', NULL);--> statement-breakpoint
INSERT INTO `__retry_count_check`
SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM runs
  WHERE json_type(run_config_json, '$.job.retryCount') IS NOT 'null'
) THEN 1 ELSE 0 END;--> statement-breakpoint
DROP TABLE `__retry_count_check`;