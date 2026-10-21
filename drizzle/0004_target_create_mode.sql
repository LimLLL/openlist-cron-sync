-- 将创建方式迁到 Target，并按每个 Run 自己的历史值改写两个快照副本。
-- foreign_keys 由启动入口在 Drizzle 事务开始前关闭；本迁移不读取当前配置来改写历史。
CREATE TEMP TABLE `__target_create_mode_check` (
  `valid` integer NOT NULL,
  CONSTRAINT `target_create_mode_snapshot_shape` CHECK (`valid` = 1)
);
--> statement-breakpoint
INSERT INTO `__target_create_mode_check`
SELECT 0 FROM runs WHERE (
  json_type(run_config_json) = 'object'
  AND json_type(run_config_json, '$.snapshotVersion') = 'integer'
  AND json_extract(run_config_json, '$.snapshotVersion') = 1
  AND json_type(run_config_json, '$.job') = 'object'
  AND json_extract(run_config_json, '$.job.id') = job_id
  AND json_type(run_config_json, '$.job.source') = 'object'
  AND json_type(run_config_json, '$.job.filters') = 'object'
  AND json_type(run_config_json, '$.job.createMode') = 'text'
  AND json_extract(run_config_json, '$.job.createMode') IN ('relay', 'server_copy')
  AND json_type(run_config_json, '$.job.targets') = 'array'
  AND json_array_length(run_config_json, '$.job.targets') BETWEEN 1 AND 32
  AND json_type(run_config_json, '$.instances') = 'object'
  AND json_type(run_config_json, '$.settings') = 'object'
) IS NOT TRUE LIMIT 1;
--> statement-breakpoint
-- 校验稳定 ID 唯一及活动 Run 的子记录；终态历史清理可能已删除 run_targets。
INSERT INTO `__target_create_mode_check`
SELECT 0 FROM runs AS r, json_each(r.run_config_json, '$.job.targets') AS entry
WHERE (
  entry.type = 'object'
  AND json_type(entry.value, '$.id') = 'text'
  AND json_type(entry.value, '$.instanceId') = 'text'
  AND json_type(entry.value, '$.path') = 'text'
  AND json_type(entry.value, '$.position') = 'integer'
  AND json_extract(entry.value, '$.mode') IN ('incremental', 'mirror')
  AND json_type(entry.value, '$.deleteLimits') = 'object'
  AND json_type(entry.value, '$.createMode') IS NULL
  AND (SELECT count(*) FROM json_each(r.run_config_json, '$.job.targets') AS peer
       WHERE json_extract(peer.value, '$.id') = json_extract(entry.value, '$.id')) = 1
  AND (r.status IN ('succeeded', 'partial', 'failed', 'cancelled', 'interrupted')
       OR (SELECT count(*) FROM run_targets AS rt
           WHERE rt.run_id = r.id AND rt.target_id = json_extract(entry.value, '$.id')) = 1)
) IS NOT TRUE LIMIT 1;
--> statement-breakpoint
INSERT INTO `__target_create_mode_check`
SELECT 0 FROM run_targets AS rt LEFT JOIN runs AS r ON r.id = rt.run_id
WHERE (
  json_type(rt.target_snapshot_json) = 'object'
  AND json_type(rt.target_snapshot_json, '$.target') = 'object'
  AND json_type(rt.target_snapshot_json, '$.instance') = 'object'
  AND json_extract(rt.target_snapshot_json, '$.target.id') = rt.target_id
  AND json_type(rt.target_snapshot_json, '$.target.instanceId') = 'text'
  AND json_type(rt.target_snapshot_json, '$.target.path') = 'text'
  AND json_type(rt.target_snapshot_json, '$.target.position') = 'integer'
  AND json_extract(rt.target_snapshot_json, '$.target.mode') IN ('incremental', 'mirror')
  AND json_type(rt.target_snapshot_json, '$.target.deleteLimits') = 'object'
  AND json_type(rt.target_snapshot_json, '$.target.createMode') IS NULL
  AND (SELECT count(*) FROM json_each(r.run_config_json, '$.job.targets') AS entry
       WHERE json_extract(entry.value, '$.id') = rt.target_id) = 1
) IS NOT TRUE LIMIT 1;
--> statement-breakpoint
UPDATE run_targets
SET target_snapshot_json = json_set(target_snapshot_json, '$.target.createMode',
  (SELECT json_extract(r.run_config_json, '$.job.createMode') FROM runs AS r WHERE r.id = run_targets.run_id));
--> statement-breakpoint
-- 子查询会丢失 JSON 子类型；显式 json() 保持对象与数组。聚合内 ORDER BY 按数组下标保证原顺序。
UPDATE runs
SET run_config_json = json_remove(
  json_set(run_config_json, '$.job.targets', json((
    SELECT json_group_array(
      json(json_set(entry.value, '$.createMode', json_extract(runs.run_config_json, '$.job.createMode')))
      ORDER BY entry.key
    )
    FROM json_each(runs.run_config_json, '$.job.targets') AS entry
  ))), '$.job.createMode');
--> statement-breakpoint
CREATE TABLE `__new_job_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`instance_id` text NOT NULL,
	`path` text NOT NULL,
	`password_enc` text,
	`position` integer NOT NULL,
	`mode` text DEFAULT 'incremental' NOT NULL,
	`create_mode` text DEFAULT 'relay' NOT NULL,
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
	CONSTRAINT "job_targets_mode" CHECK("__new_job_targets"."mode" IN ('incremental','mirror')),
	CONSTRAINT "job_targets_create_mode" CHECK("__new_job_targets"."create_mode" IN ('relay','server_copy')),
	CONSTRAINT "job_targets_booleans" CHECK("__new_job_targets"."refresh" IN (0,1) AND "__new_job_targets"."delete_limits_enabled" IN (0,1)),
	CONSTRAINT "job_targets_limits" CHECK(("__new_job_targets"."delete_limits_enabled" = 0 OR "__new_job_targets"."max_delete_count" IS NOT NULL OR "__new_job_targets"."max_delete_percent" IS NOT NULL) AND ("__new_job_targets"."max_delete_count" IS NULL OR "__new_job_targets"."max_delete_count" BETWEEN 0 AND 9007199254740991) AND ("__new_job_targets"."max_delete_percent" IS NULL OR "__new_job_targets"."max_delete_percent" BETWEEN 0 AND 100)),
	CONSTRAINT "job_targets_times" CHECK("__new_job_targets"."created_at" >= 0 AND "__new_job_targets"."updated_at" >= 0 AND ("__new_job_targets"."archived_at" IS NULL OR "__new_job_targets"."archived_at" >= 0))
);
--> statement-breakpoint
INSERT INTO `__new_job_targets`("id", "job_id", "instance_id", "path", "password_enc", "position", "mode", "create_mode", "refresh", "delete_limits_enabled", "max_delete_count", "max_delete_percent", "archived_at", "created_at", "updated_at") SELECT "id", "job_id", "instance_id", "path", "password_enc", "position", "mode", (SELECT j.create_mode FROM jobs AS j WHERE j.id = job_targets.job_id), "refresh", "delete_limits_enabled", "max_delete_count", "max_delete_percent", "archived_at", "created_at", "updated_at" FROM `job_targets`;
--> statement-breakpoint
DROP TABLE `job_targets`;
--> statement-breakpoint
ALTER TABLE `__new_job_targets` RENAME TO `job_targets`;
--> statement-breakpoint
CREATE UNIQUE INDEX `job_targets_position` ON `job_targets` (`job_id`,`position`) WHERE "job_targets"."archived_at" IS NULL;
--> statement-breakpoint
CREATE INDEX `job_targets_instance_archive` ON `job_targets` (`instance_id`,`archived_at`);
--> statement-breakpoint
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
	CONSTRAINT "jobs_times" CHECK("__new_jobs"."created_at" >= 0 AND "__new_jobs"."updated_at" >= 0 AND ("__new_jobs"."archived_at" IS NULL OR "__new_jobs"."archived_at" >= 0))
);
--> statement-breakpoint
INSERT INTO `__new_jobs`("id", "name", "enabled", "source_instance_id", "source_path", "source_password_enc", "source_refresh", "cron", "timezone", "include_globs_json", "exclude_globs_json", "min_size_bytes", "max_size_bytes", "allow_empty_source", "sync_empty_dirs", "relay_bandwidth_limit", "timeout_seconds", "archived_at", "created_at", "updated_at") SELECT "id", "name", "enabled", "source_instance_id", "source_path", "source_password_enc", "source_refresh", "cron", "timezone", "include_globs_json", "exclude_globs_json", "min_size_bytes", "max_size_bytes", "allow_empty_source", "sync_empty_dirs", "relay_bandwidth_limit", "timeout_seconds", "archived_at", "created_at", "updated_at" FROM `jobs`;
--> statement-breakpoint
DROP TABLE `jobs`;
--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;
--> statement-breakpoint
CREATE INDEX `jobs_enabled_archive` ON `jobs` (`enabled`,`archived_at`);
--> statement-breakpoint
CREATE INDEX `jobs_source` ON `jobs` (`source_instance_id`);
--> statement-breakpoint
-- 此断言由 SQLite CHECK 抛错，Drizzle 因此回滚数据、结构及迁移记录。
INSERT INTO `__target_create_mode_check`
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM pragma_foreign_key_check) THEN 1 ELSE 0 END;
--> statement-breakpoint
DROP TABLE `__target_create_mode_check`;
