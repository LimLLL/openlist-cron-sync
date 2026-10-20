CREATE TABLE `job_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`instance_id` text NOT NULL,
	`path` text NOT NULL,
	`password_enc` text,
	`position` integer NOT NULL,
	`mode` text DEFAULT 'incremental' NOT NULL,
	`refresh` integer DEFAULT false NOT NULL,
	`delete_limits_enabled` integer DEFAULT true NOT NULL,
	`max_delete_count` integer,
	`max_delete_percent` integer,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "job_targets_position_nonnegative" CHECK("job_targets"."position" >= 0),
	CONSTRAINT "job_targets_mode" CHECK("job_targets"."mode" IN ('incremental','mirror')),
	CONSTRAINT "job_targets_booleans" CHECK("job_targets"."refresh" IN (0,1) AND "job_targets"."delete_limits_enabled" IN (0,1)),
	CONSTRAINT "job_targets_limits" CHECK(("job_targets"."delete_limits_enabled" = 0 OR "job_targets"."max_delete_count" IS NOT NULL OR "job_targets"."max_delete_percent" IS NOT NULL) AND ("job_targets"."max_delete_count" IS NULL OR "job_targets"."max_delete_count" BETWEEN 0 AND 9007199254740991) AND ("job_targets"."max_delete_percent" IS NULL OR "job_targets"."max_delete_percent" BETWEEN 0 AND 100)),
	CONSTRAINT "job_targets_times" CHECK("job_targets"."created_at" >= 0 AND "job_targets"."updated_at" >= 0 AND ("job_targets"."archived_at" IS NULL OR "job_targets"."archived_at" >= 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_targets_position` ON `job_targets` (`job_id`,`position`) WHERE "job_targets"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX `job_targets_instance_archive` ON `job_targets` (`instance_id`,`archived_at`);--> statement-breakpoint
CREATE TABLE `jobs` (
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
	`create_mode` text DEFAULT 'relay' NOT NULL,
	`relay_bandwidth_limit` integer DEFAULT 0 NOT NULL,
	`timeout_seconds` integer DEFAULT 86400 NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "jobs_name" CHECK(length("jobs"."name") BETWEEN 1 AND 100),
	CONSTRAINT "jobs_booleans" CHECK("jobs"."enabled" IN (0,1) AND "jobs"."source_refresh" IN (0,1) AND "jobs"."allow_empty_source" IN (0,1) AND "jobs"."sync_empty_dirs" IN (0,1)),
	CONSTRAINT "jobs_mode" CHECK("jobs"."create_mode" IN ('relay','server_copy')),
	CONSTRAINT "jobs_globs" CHECK(json_valid("jobs"."include_globs_json") AND json_valid("jobs"."exclude_globs_json")),
	CONSTRAINT "jobs_sizes" CHECK(("jobs"."min_size_bytes" IS NULL OR "jobs"."min_size_bytes" BETWEEN 0 AND 9007199254740991) AND ("jobs"."max_size_bytes" IS NULL OR "jobs"."max_size_bytes" BETWEEN 0 AND 9007199254740991) AND ("jobs"."min_size_bytes" IS NULL OR "jobs"."max_size_bytes" IS NULL OR "jobs"."min_size_bytes" <= "jobs"."max_size_bytes")),
	CONSTRAINT "jobs_limits" CHECK("jobs"."timeout_seconds" BETWEEN 60 AND 604800 AND "jobs"."relay_bandwidth_limit" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "jobs_times" CHECK("jobs"."created_at" >= 0 AND "jobs"."updated_at" >= 0 AND ("jobs"."archived_at" IS NULL OR "jobs"."archived_at" >= 0))
);
--> statement-breakpoint
CREATE INDEX `jobs_enabled_archive` ON `jobs` (`enabled`,`archived_at`);--> statement-breakpoint
CREATE INDEX `jobs_source` ON `jobs` (`source_instance_id`);--> statement-breakpoint
CREATE TABLE `operation_dependencies` (
	`operation_id` text NOT NULL,
	`depends_on_id` text NOT NULL,
	PRIMARY KEY(`operation_id`, `depends_on_id`),
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`depends_on_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "dependencies_not_self" CHECK("operation_dependencies"."operation_id" != "operation_dependencies"."depends_on_id")
);
--> statement-breakpoint
CREATE INDEX `operation_dependencies_depends_on` ON `operation_dependencies` (`depends_on_id`);--> statement-breakpoint
CREATE TABLE `operations` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`run_target_id` text NOT NULL,
	`seq` integer NOT NULL,
	`action` text NOT NULL,
	`method` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`source_instance_id` text,
	`source_path` text,
	`target_instance_id` text NOT NULL,
	`target_path` text NOT NULL,
	`is_dir` integer NOT NULL,
	`expected_source_size` integer,
	`expected_target_size` integer,
	`expected_source_modified` text,
	`affected_file_count` integer NOT NULL,
	`affected_bytes` integer NOT NULL,
	`retry_of` text,
	`caused_by_operation_id` text,
	`attempt_no` integer DEFAULT 1 NOT NULL,
	`openlist_task_id` text,
	`remote_state` integer,
	`remote_cleanup_pending` integer DEFAULT false NOT NULL,
	`bytes_downloaded` integer DEFAULT 0 NOT NULL,
	`bytes_transferred` integer DEFAULT 0 NOT NULL,
	`multipart_upload_id` text,
	`multipart_chunk_size` integer,
	`multipart_state` text,
	`multipart_attempt` integer,
	`source_stream_completed_at` integer,
	`error_code` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`submitted_at` integer,
	`ended_at` integer,
	`next_attempt_at` integer,
	`unknown_since` integer,
	`unknown_until` integer,
	`quarantine_released_at` integer,
	`quarantine_release_reason` text,
	`reobserved_at` integer,
	`reobserved_by_run_id` text,
	`resolution_kind` text,
	`resolution_note` text,
	`resolved_at` integer,
	`resolved_by_run_id` text,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`run_target_id`) REFERENCES `run_targets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`target_instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`retry_of`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`caused_by_operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reobserved_by_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`resolved_by_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "operations_method" CHECK(("operations"."action" = 'mkdir' AND "operations"."method" = 'mkdir') OR ("operations"."action" = 'create' AND "operations"."method" IN ('relay','server_copy')) OR ("operations"."action" = 'delete' AND "operations"."method" = 'remove')),
	CONSTRAINT "operations_reason" CHECK("operations"."reason" IN ('prepare','new','replace','extra','retry_cleanup')),
	CONSTRAINT "operations_status" CHECK("operations"."status" IN ('pending','submitting','submitted','running','succeeded','failed','skipped','unknown','cancelled')),
	CONSTRAINT "operations_positive" CHECK("operations"."seq" >= 1 AND "operations"."attempt_no" >= 1),
	CONSTRAINT "operations_booleans" CHECK("operations"."is_dir" IN (0,1) AND "operations"."remote_cleanup_pending" IN (0,1)),
	CONSTRAINT "operations_sizes" CHECK("operations"."affected_file_count" BETWEEN 0 AND 9007199254740991 AND "operations"."affected_bytes" BETWEEN 0 AND 9007199254740991 AND "operations"."bytes_downloaded" BETWEEN 0 AND 9007199254740991 AND "operations"."bytes_transferred" BETWEEN 0 AND 9007199254740991 AND ("operations"."expected_source_size" IS NULL OR "operations"."expected_source_size" BETWEEN 0 AND 9007199254740991) AND ("operations"."expected_target_size" IS NULL OR "operations"."expected_target_size" BETWEEN 0 AND 9007199254740991)),
	CONSTRAINT "operations_terminal" CHECK("operations"."status" NOT IN ('succeeded','failed','skipped','unknown','cancelled') OR "operations"."ended_at" IS NOT NULL),
	CONSTRAINT "operations_unknown_fields" CHECK("operations"."status" != 'unknown' OR ("operations"."unknown_since" IS NOT NULL AND "operations"."unknown_until" IS NOT NULL AND "operations"."unknown_until" >= "operations"."unknown_since")),
	CONSTRAINT "operations_resolution" CHECK("operations"."resolution_kind" IS NULL OR ("operations"."resolution_kind" IN ('observed','superseded','abandoned') AND "operations"."resolved_at" IS NOT NULL AND ("operations"."resolution_kind" != 'abandoned' OR "operations"."resolution_note" IS NOT NULL))),
	CONSTRAINT "operations_task_method" CHECK("operations"."method" = 'server_copy' OR ("operations"."openlist_task_id" IS NULL AND "operations"."remote_state" IS NULL)),
	CONSTRAINT "operations_cleanup_task" CHECK("operations"."remote_cleanup_pending" = 0 OR "operations"."openlist_task_id" IS NOT NULL),
	CONSTRAINT "operations_multipart_method" CHECK("operations"."method" = 'relay' OR ("operations"."multipart_upload_id" IS NULL AND "operations"."multipart_chunk_size" IS NULL AND "operations"."multipart_state" IS NULL AND "operations"."multipart_attempt" IS NULL AND "operations"."source_stream_completed_at" IS NULL)),
	CONSTRAINT "operations_cause" CHECK(("operations"."caused_by_operation_id" IS NULL AND ("operations"."error_code" IS NULL OR "operations"."error_code" != 'REMOTE_TASK_CHANGED')) OR ("operations"."caused_by_operation_id" IS NOT NULL AND "operations"."error_code" = 'REMOTE_TASK_CHANGED' AND "operations"."openlist_task_id" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operations_run_seq` ON `operations` (`run_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `operations_task` ON `operations` (`target_instance_id`,`openlist_task_id`) WHERE "operations"."openlist_task_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `operations_upload` ON `operations` (`target_instance_id`,`multipart_upload_id`) WHERE "operations"."multipart_upload_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `operations_target_status_seq` ON `operations` (`run_target_id`,`status`,`seq`);--> statement-breakpoint
CREATE INDEX `operations_retry` ON `operations` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `operations_path` ON `operations` (`target_instance_id`,`target_path`);--> statement-breakpoint
CREATE INDEX `operations_unknown` ON `operations` (`status`,`unknown_until`);--> statement-breakpoint
CREATE INDEX `operations_cleanup` ON `operations` (`remote_cleanup_pending`);--> statement-breakpoint
CREATE TABLE `run_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`target_id` text NOT NULL,
	`target_snapshot_json` text NOT NULL,
	`stats_json` text NOT NULL,
	`source_complete` integer DEFAULT false NOT NULL,
	`target_complete` integer DEFAULT false NOT NULL,
	`suspect` integer DEFAULT false NOT NULL,
	`delete_blocked` integer DEFAULT false NOT NULL,
	`extras_blocked` integer DEFAULT false NOT NULL,
	`block_reasons_json` text NOT NULL,
	`observed_target_file_count` integer DEFAULT 0 NOT NULL,
	`planned_replace_count` integer DEFAULT 0 NOT NULL,
	`planned_extra_count` integer DEFAULT 0 NOT NULL,
	`delete_budget_count` integer,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`target_id`) REFERENCES `job_targets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "run_targets_json" CHECK(json_valid("run_targets"."target_snapshot_json") AND json_valid("run_targets"."stats_json") AND json_valid("run_targets"."block_reasons_json")),
	CONSTRAINT "run_targets_booleans" CHECK("run_targets"."source_complete" IN (0,1) AND "run_targets"."target_complete" IN (0,1) AND "run_targets"."suspect" IN (0,1) AND "run_targets"."delete_blocked" IN (0,1) AND "run_targets"."extras_blocked" IN (0,1)),
	CONSTRAINT "run_targets_counts" CHECK("run_targets"."observed_target_file_count" BETWEEN 0 AND 9007199254740991 AND "run_targets"."planned_replace_count" BETWEEN 0 AND 9007199254740991 AND "run_targets"."planned_extra_count" BETWEEN 0 AND 9007199254740991 AND ("run_targets"."delete_budget_count" IS NULL OR "run_targets"."delete_budget_count" BETWEEN 0 AND 9007199254740991))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_targets_run_target` ON `run_targets` (`run_id`,`target_id`);--> statement-breakpoint
CREATE INDEX `run_targets_run` ON `run_targets` (`run_id`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`trigger` text NOT NULL,
	`scheduled_at` integer,
	`dry_run` integer NOT NULL,
	`confirm_deletes` integer NOT NULL,
	`status` text NOT NULL,
	`run_config_json` text NOT NULL,
	`secret_snapshot_enc` text,
	`stats_json` text NOT NULL,
	`stop_reason` text,
	`error_code` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`queue_deadline_at` integer NOT NULL,
	`started_at` integer,
	`scan_completed_at` integer,
	`ended_at` integer,
	`deadline_at` integer,
	`cancel_requested_at` integer,
	`recovery_deadline_at` integer,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "runs_status" CHECK("runs"."status" IN ('queued','scanning','planned','executing','cancelling','recovering','succeeded','partial','failed','cancelled','interrupted')),
	CONSTRAINT "runs_trigger" CHECK("runs"."trigger" IN ('manual','cron')),
	CONSTRAINT "runs_booleans" CHECK("runs"."dry_run" IN (0,1) AND "runs"."confirm_deletes" IN (0,1)),
	CONSTRAINT "runs_json" CHECK(json_valid("runs"."run_config_json") AND json_valid("runs"."stats_json")),
	CONSTRAINT "runs_terminal" CHECK("runs"."status" NOT IN ('succeeded','partial','failed','cancelled','interrupted') OR "runs"."ended_at" IS NOT NULL),
	CONSTRAINT "runs_times" CHECK("runs"."created_at" >= 0 AND "runs"."updated_at" >= 0 AND "runs"."queue_deadline_at" >= "runs"."created_at" AND ("runs"."started_at" IS NULL OR "runs"."started_at" >= 0) AND ("runs"."ended_at" IS NULL OR "runs"."ended_at" >= 0) AND ("runs"."deadline_at" IS NULL OR "runs"."deadline_at" >= 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runs_active_job` ON `runs` (`job_id`) WHERE "runs"."status" IN ('queued','scanning','planned','executing','cancelling','recovering');--> statement-breakpoint
CREATE INDEX `runs_created_id` ON `runs` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `runs_job_created_id` ON `runs` (`job_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `runs_status_created_id` ON `runs` (`status`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `scan_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`run_target_id` text,
	`endpoint_role` text NOT NULL,
	`instance_id` text NOT NULL,
	`path` text NOT NULL,
	`code` text NOT NULL,
	`message` text NOT NULL,
	`protect_subtree` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`run_target_id`) REFERENCES `run_targets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "scan_issues_role" CHECK("scan_issues"."endpoint_role" IN ('source','target')),
	CONSTRAINT "scan_issues_protection" CHECK("scan_issues"."protect_subtree" IN (0,1))
);
--> statement-breakpoint
CREATE INDEX `scan_issues_run_id` ON `scan_issues` (`run_id`,`id`);--> statement-breakpoint
CREATE INDEX `scan_issues_target_path` ON `scan_issues` (`run_target_id`,`path`);