DROP INDEX `operations_cleanup`;--> statement-breakpoint
CREATE INDEX `operations_responsibility_run` ON `operations` (`run_id`) WHERE ("operations"."status" = 'unknown' AND "operations"."resolution_kind" IS NULL) OR "operations"."remote_cleanup_pending" = 1;--> statement-breakpoint
CREATE INDEX `operations_retry_of` ON `operations` (`retry_of`);--> statement-breakpoint
CREATE INDEX `operations_cause_seq` ON `operations` (`caused_by_operation_id`,`seq`);--> statement-breakpoint
CREATE INDEX `operations_resolved_run` ON `operations` (`resolved_by_run_id`,`id`);--> statement-breakpoint
CREATE INDEX `operations_reobserved_run` ON `operations` (`reobserved_by_run_id`,`id`);--> statement-breakpoint
CREATE INDEX `operations_run_clearable` ON `operations` (`run_id`,`id`) WHERE "operations"."retry_of" IS NOT NULL OR "operations"."resolved_by_run_id" IS NOT NULL OR "operations"."reobserved_by_run_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `operations_run_references` ON `operations` (`run_id`,`id`) WHERE "operations"."retry_of" IS NOT NULL OR "operations"."caused_by_operation_id" IS NOT NULL OR "operations"."resolved_by_run_id" IS NOT NULL OR "operations"."reobserved_by_run_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `operations_cleanup` ON `operations` (`remote_cleanup_pending`,`id`);--> statement-breakpoint
CREATE INDEX `runs_ended_id` ON `runs` (`ended_at`,`id`);