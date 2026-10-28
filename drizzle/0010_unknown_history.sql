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
	`retry_of` text,
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
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`run_target_id`) REFERENCES `run_targets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`target_instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`retry_of`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "operations_method" CHECK(("__new_operations"."action" = 'mkdir' AND "__new_operations"."method" = 'mkdir') OR ("__new_operations"."action" = 'create' AND "__new_operations"."method" IN ('relay','server_copy')) OR ("__new_operations"."action" = 'delete' AND "__new_operations"."method" = 'remove')),
	CONSTRAINT "operations_reason" CHECK("__new_operations"."reason" IN ('prepare','new','replace','extra','retry_cleanup')),
	CONSTRAINT "operations_status" CHECK("__new_operations"."status" IN ('pending','submitting','submitted','running','succeeded','failed','skipped','unknown','cancelled')),
	CONSTRAINT "operations_positive" CHECK("__new_operations"."seq" >= 1 AND "__new_operations"."attempt_no" >= 1),
	CONSTRAINT "operations_booleans" CHECK("__new_operations"."is_dir" IN (0,1) AND "__new_operations"."remote_cleanup_pending" IN (0,1)),
	CONSTRAINT "operations_sizes" CHECK("__new_operations"."affected_file_count" BETWEEN 0 AND 9007199254740991 AND "__new_operations"."affected_bytes" BETWEEN 0 AND 9007199254740991 AND "__new_operations"."bytes_downloaded" BETWEEN 0 AND 9007199254740991 AND "__new_operations"."bytes_transferred" BETWEEN 0 AND 9007199254740991 AND ("__new_operations"."expected_source_size" IS NULL OR "__new_operations"."expected_source_size" BETWEEN 0 AND 9007199254740991) AND ("__new_operations"."expected_target_size" IS NULL OR "__new_operations"."expected_target_size" BETWEEN 0 AND 9007199254740991)),
	CONSTRAINT "operations_terminal" CHECK("__new_operations"."status" NOT IN ('succeeded','failed','skipped','unknown','cancelled') OR "__new_operations"."ended_at" IS NOT NULL),
	CONSTRAINT "operations_unknown_fields" CHECK("__new_operations"."status" != 'unknown' OR "__new_operations"."unknown_since" IS NOT NULL),
	CONSTRAINT "operations_task_method" CHECK("__new_operations"."method" = 'server_copy' OR ("__new_operations"."openlist_task_id" IS NULL AND "__new_operations"."remote_state" IS NULL)),
	CONSTRAINT "operations_cleanup_task" CHECK("__new_operations"."remote_cleanup_pending" = 0 OR "__new_operations"."openlist_task_id" IS NOT NULL),
	CONSTRAINT "operations_multipart_method" CHECK("__new_operations"."method" = 'relay' OR ("__new_operations"."multipart_upload_id" IS NULL AND "__new_operations"."multipart_chunk_size" IS NULL AND "__new_operations"."multipart_state" IS NULL AND "__new_operations"."multipart_attempt" IS NULL AND "__new_operations"."source_stream_completed_at" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_operations`("id", "run_id", "run_target_id", "seq", "action", "method", "reason", "status", "source_instance_id", "source_path", "target_instance_id", "target_path", "is_dir", "expected_source_size", "expected_target_size", "expected_source_modified", "affected_file_count", "affected_bytes", "retry_of", "attempt_no", "openlist_task_id", "remote_state", "remote_cleanup_pending", "bytes_downloaded", "bytes_transferred", "multipart_upload_id", "multipart_chunk_size", "multipart_state", "multipart_attempt", "source_stream_completed_at", "error_code", "error_message", "created_at", "updated_at", "submitted_at", "ended_at", "next_attempt_at", "unknown_since") SELECT "id", "run_id", "run_target_id", "seq", "action", "method", "reason", "status", "source_instance_id", "source_path", "target_instance_id", "target_path", "is_dir", "expected_source_size", "expected_target_size", "expected_source_modified", "affected_file_count", "affected_bytes", "retry_of", "attempt_no", "openlist_task_id", "remote_state", "remote_cleanup_pending", "bytes_downloaded", "bytes_transferred", "multipart_upload_id", "multipart_chunk_size", "multipart_state", "multipart_attempt", "source_stream_completed_at", "error_code", "error_message", "created_at", "updated_at", "submitted_at", "ended_at", "next_attempt_at", "unknown_since" FROM `operations`;--> statement-breakpoint
DROP TABLE `operations`;--> statement-breakpoint
ALTER TABLE `__new_operations` RENAME TO `operations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `operations_run_seq` ON `operations` (`run_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `operations_task` ON `operations` (`target_instance_id`,`openlist_task_id`) WHERE "operations"."openlist_task_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `operations_target_status_seq` ON `operations` (`run_target_id`,`status`,`seq`);--> statement-breakpoint
CREATE INDEX `operations_retry` ON `operations` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `operations_path` ON `operations` (`target_instance_id`,`target_path`);--> statement-breakpoint
CREATE INDEX `operations_status` ON `operations` (`status`);--> statement-breakpoint
CREATE INDEX `operations_cleanup` ON `operations` (`remote_cleanup_pending`,`id`);--> statement-breakpoint
CREATE INDEX `operations_responsibility_run` ON `operations` (`run_id`) WHERE "operations"."remote_cleanup_pending" = 1;--> statement-breakpoint
CREATE INDEX `operations_retry_of` ON `operations` (`retry_of`);