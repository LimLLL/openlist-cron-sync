CREATE TABLE `operation_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`target_instance_id` text NOT NULL,
	`method` text NOT NULL,
	`attempt_no` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
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
	FOREIGN KEY (`operation_id`,`target_instance_id`,`method`) REFERENCES `operations`(`id`,`target_instance_id`,`method`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "attempts_number" CHECK("operation_attempts"."attempt_no" >= 1),
	CONSTRAINT "attempts_status" CHECK("operation_attempts"."status" IN ('pending','submitting','submitted','running','succeeded','failed','skipped','unknown','cancelled')),
	CONSTRAINT "attempts_boolean" CHECK("operation_attempts"."remote_cleanup_pending" IN (0,1)),
	CONSTRAINT "attempts_bytes" CHECK("operation_attempts"."bytes_downloaded" BETWEEN 0 AND 9007199254740991 AND "operation_attempts"."bytes_transferred" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "attempts_terminal" CHECK("operation_attempts"."status" NOT IN ('succeeded','failed','skipped','unknown','cancelled') OR "operation_attempts"."ended_at" IS NOT NULL),
	CONSTRAINT "attempts_unknown" CHECK("operation_attempts"."status" != 'unknown' OR "operation_attempts"."unknown_since" IS NOT NULL),
	CONSTRAINT "attempts_task_method" CHECK("operation_attempts"."method" = 'server_copy' OR ("operation_attempts"."openlist_task_id" IS NULL AND "operation_attempts"."remote_state" IS NULL)),
	CONSTRAINT "attempts_cleanup_task" CHECK("operation_attempts"."remote_cleanup_pending" = 0 OR "operation_attempts"."openlist_task_id" IS NOT NULL),
	CONSTRAINT "attempts_multipart_method" CHECK("operation_attempts"."method" = 'relay' OR ("operation_attempts"."multipart_upload_id" IS NULL AND "operation_attempts"."multipart_chunk_size" IS NULL AND "operation_attempts"."multipart_state" IS NULL AND "operation_attempts"."multipart_attempt" IS NULL AND "operation_attempts"."source_stream_completed_at" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attempts_operation_no` ON `operation_attempts` (`operation_id`,`attempt_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `attempts_active` ON `operation_attempts` (`operation_id`) WHERE "operation_attempts"."status" IN ('pending','submitting','submitted','running');--> statement-breakpoint
CREATE UNIQUE INDEX `attempts_task` ON `operation_attempts` (`target_instance_id`,`openlist_task_id`) WHERE "operation_attempts"."openlist_task_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `attempts_cleanup` ON `operation_attempts` (`id`) WHERE "operation_attempts"."remote_cleanup_pending" = 1;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_operations` (
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
	`attempt_count` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`run_target_id`) REFERENCES `run_targets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`target_instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "operations_method" CHECK(("__new_operations"."action" = 'mkdir' AND "__new_operations"."method" = 'mkdir') OR ("__new_operations"."action" = 'create' AND "__new_operations"."method" IN ('relay','server_copy')) OR ("__new_operations"."action" = 'delete' AND "__new_operations"."method" = 'remove')),
	CONSTRAINT "operations_reason" CHECK("__new_operations"."reason" IN ('prepare','new','replace','extra','retry_cleanup')),
	CONSTRAINT "operations_status" CHECK("__new_operations"."status" IN ('pending','submitting','submitted','running','succeeded','failed','skipped','unknown','cancelled')),
	CONSTRAINT "operations_positive" CHECK("__new_operations"."seq" >= 1 AND "__new_operations"."attempt_count" >= 1),
	CONSTRAINT "operations_boolean" CHECK("__new_operations"."is_dir" IN (0,1)),
	CONSTRAINT "operations_sizes" CHECK("__new_operations"."affected_file_count" BETWEEN 0 AND 9007199254740991 AND "__new_operations"."affected_bytes" BETWEEN 0 AND 9007199254740991 AND ("__new_operations"."expected_source_size" IS NULL OR "__new_operations"."expected_source_size" BETWEEN 0 AND 9007199254740991) AND ("__new_operations"."expected_target_size" IS NULL OR "__new_operations"."expected_target_size" BETWEEN 0 AND 9007199254740991)),
	CONSTRAINT "operations_terminal" CHECK("__new_operations"."status" NOT IN ('succeeded','failed','skipped','unknown','cancelled') OR "__new_operations"."ended_at" IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_operations`("id", "run_id", "run_target_id", "seq", "action", "method", "reason", "status", "source_instance_id", "source_path", "target_instance_id", "target_path", "is_dir", "expected_source_size", "expected_target_size", "expected_source_modified", "affected_file_count", "affected_bytes", "attempt_count", "created_at", "updated_at", "ended_at") SELECT "id", "run_id", "run_target_id", "seq", "action", "method", "reason", "status", "source_instance_id", "source_path", "target_instance_id", "target_path", "is_dir", "expected_source_size", "expected_target_size", "expected_source_modified", "affected_file_count", "affected_bytes", "attempt_count", "created_at", "updated_at", "ended_at" FROM `operations`;--> statement-breakpoint
DROP TABLE `operations`;--> statement-breakpoint
ALTER TABLE `__new_operations` RENAME TO `operations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `operations_run_seq` ON `operations` (`run_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `operations_attempt_identity` ON `operations` (`id`,`target_instance_id`,`method`);--> statement-breakpoint
CREATE INDEX `operations_target_status_seq` ON `operations` (`run_target_id`,`status`,`seq`);--> statement-breakpoint
CREATE INDEX `operations_target_instance` ON `operations` (`target_instance_id`);--> statement-breakpoint
CREATE INDEX `operations_source_instance` ON `operations` (`source_instance_id`) WHERE "operations"."source_instance_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `operations_status` ON `operations` (`status`);