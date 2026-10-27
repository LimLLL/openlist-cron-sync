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
	CONSTRAINT "instances_multipart" CHECK("__new_instances"."multipart_enabled" IS NULL OR "__new_instances"."multipart_enabled" IN (0,1)),
	CONSTRAINT "instances_times" CHECK("__new_instances"."created_at" >= 0 AND "__new_instances"."updated_at" >= 0 AND ("__new_instances"."archived_at" IS NULL OR "__new_instances"."archived_at" >= 0) AND ("__new_instances"."last_test_at" IS NULL OR "__new_instances"."last_test_at" >= 0) AND ("__new_instances"."auth_blocked_until" IS NULL OR "__new_instances"."auth_blocked_until" >= 0))
);
--> statement-breakpoint
INSERT INTO `__new_instances`("id", "name", "base_url", "auth_mode", "username", "secret_enc", "auth_state", "auth_block_reason", "auth_blocked_until", "account_username", "account_base_path", "account_role", "account_permissions", "download_mode", "last_test_at", "openlist_version", "multipart_enabled", "last_error_code", "last_error_message", "archived_at", "created_at", "updated_at") SELECT "id", "name", "base_url", "auth_mode", "username", "secret_enc", "auth_state", "auth_block_reason", "auth_blocked_until", "account_username", "account_base_path", "account_role", "account_permissions", "download_mode", "last_test_at", "openlist_version", "multipart_enabled", "last_error_code", "last_error_message", "archived_at", "created_at", "updated_at" FROM `instances`;--> statement-breakpoint
DROP TABLE `instances`;--> statement-breakpoint
ALTER TABLE `__new_instances` RENAME TO `instances`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `instances_archive_created_id` ON `instances` (`archived_at`,`created_at`,`id`);--> statement-breakpoint
ALTER TABLE `job_targets` ADD `scan_interval_seconds` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `source_scan_interval_seconds` integer DEFAULT 0 NOT NULL;