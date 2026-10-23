-- 传输配额从 Instance 迁到 Job/Target：编辑中的 Job/Target 继承当前 Instance 值，历史 Run 按各自冻结的旧值改写。
-- foreign_keys 由启动入口在 Drizzle 事务开始前关闭；快照结构不符时中止迁移，不为已接受的 Run 编造数值。
CREATE TEMP TABLE `__resource_snapshot_check` (
  `valid` integer NOT NULL,
  CONSTRAINT `resource_snapshot_shape` CHECK (`valid` = 1)
);--> statement-breakpoint
-- 校验 Run 快照：Target 稳定 ID 唯一、引用的 Instance 都在快照中、旧四项配额是安全整数且新字段尚不存在；
-- 终态历史清理可能已删除 run_targets，只对活动 Run 要求子记录。
INSERT INTO `__resource_snapshot_check`
SELECT 0 FROM runs AS r WHERE (
  json_type(r.run_config_json) = 'object'
  AND json_type(r.run_config_json, '$.snapshotVersion') = 'integer'
  AND json_extract(r.run_config_json, '$.snapshotVersion') = 1
  AND json_type(r.run_config_json, '$.job') = 'object'
  AND json_extract(r.run_config_json, '$.job.id') = r.job_id
  AND json_type(r.run_config_json, '$.job.source') = 'object'
  AND json_type(r.run_config_json, '$.job.source.instanceId') = 'text'
  AND json_type(r.run_config_json, '$.job.sourceDownloadConcurrency') IS NULL
  AND json_type(r.run_config_json, '$.settings') = 'object'
  AND json_type(r.run_config_json, '$.job.targets') = 'array'
  AND json_array_length(r.run_config_json, '$.job.targets') BETWEEN 1 AND 32
  AND json_type(r.run_config_json, '$.instances') = 'object'
  AND EXISTS (SELECT 1 FROM json_each(r.run_config_json, '$.instances') AS i
              WHERE i.key = json_extract(r.run_config_json, '$.job.source.instanceId'))
  AND NOT EXISTS (
    SELECT 1 FROM json_each(r.run_config_json, '$.job.targets') AS t
    WHERE (
      json_type(t.value) = 'object'
      AND json_type(t.value, '$.id') = 'text'
      AND json_type(t.value, '$.instanceId') = 'text'
      AND json_type(t.value, '$.path') = 'text'
      AND json_type(t.value, '$.position') = 'integer'
      AND json_extract(t.value, '$.mode') IN ('incremental', 'mirror')
      AND json_type(t.value, '$.deleteLimits') = 'object'
      AND json_extract(t.value, '$.createMode') IN ('relay', 'server_copy')
      AND json_type(t.value, '$.concurrentFiles') IS NULL
      AND json_type(t.value, '$.chunkConcurrency') IS NULL
      AND EXISTS (SELECT 1 FROM json_each(r.run_config_json, '$.instances') AS i
                  WHERE i.key = json_extract(t.value, '$.instanceId'))
      AND (SELECT count(*) FROM json_each(r.run_config_json, '$.job.targets') AS peer
           WHERE json_extract(peer.value, '$.id') = json_extract(t.value, '$.id')) = 1
      AND (r.status IN ('succeeded', 'partial', 'failed', 'cancelled', 'interrupted')
           OR (SELECT count(*) FROM run_targets AS rt
               WHERE rt.run_id = r.id AND rt.target_id = json_extract(t.value, '$.id')) = 1)
    ) IS NOT TRUE
  )
  AND NOT EXISTS (
    SELECT 1 FROM json_each(r.run_config_json, '$.instances') AS i
    WHERE json_extract(i.value, '$.id') IS NOT i.key
      OR json_type(i.value, '$.limits.maxApiConcurrency') IS NOT 'integer'
      OR json_extract(i.value, '$.limits.maxApiConcurrency') NOT BETWEEN 0 AND 9007199254740991
      OR json_type(i.value, '$.limits.apiRequestsPerSecond') IS NOT 'integer'
      OR json_extract(i.value, '$.limits.apiRequestsPerSecond') NOT BETWEEN 0 AND 9007199254740991
      OR json_type(i.value, '$.limits.maxDownloadConnections') IS NOT 'integer'
      OR json_extract(i.value, '$.limits.maxDownloadConnections') NOT BETWEEN 0 AND 9007199254740991
      OR json_type(i.value, '$.limits.maxUploadSessions') IS NOT 'integer'
      OR json_extract(i.value, '$.limits.maxUploadSessions') NOT BETWEEN 0 AND 9007199254740991
      OR json_type(i.value, '$.limits.maxOutstandingTasks') IS NOT 'integer'
      OR json_extract(i.value, '$.limits.maxOutstandingTasks') NOT BETWEEN 0 AND 9007199254740991
      OR json_type(i.value, '$.limits.maxChunkConcurrency') IS NOT 'integer'
      OR json_extract(i.value, '$.limits.maxChunkConcurrency') NOT BETWEEN 0 AND 9007199254740991
  )
) IS NOT TRUE LIMIT 1;--> statement-breakpoint
-- 校验 Run Target 快照：目标与快照 Instance 一致，旧四项配额是安全整数且新字段尚不存在。
INSERT INTO `__resource_snapshot_check`
SELECT 0 FROM run_targets AS rt WHERE (
  json_type(rt.target_snapshot_json) = 'object'
  AND json_type(rt.target_snapshot_json, '$.target') = 'object'
  AND json_type(rt.target_snapshot_json, '$.instance') = 'object'
  AND json_type(rt.target_snapshot_json, '$.target.id') = 'text'
  AND json_extract(rt.target_snapshot_json, '$.target.id') = rt.target_id
  AND json_type(rt.target_snapshot_json, '$.target.instanceId') = 'text'
  AND json_extract(rt.target_snapshot_json, '$.target.instanceId') = json_extract(rt.target_snapshot_json, '$.instance.id')
  AND json_type(rt.target_snapshot_json, '$.target.path') = 'text'
  AND json_type(rt.target_snapshot_json, '$.target.position') = 'integer'
  AND json_extract(rt.target_snapshot_json, '$.target.mode') IN ('incremental', 'mirror')
  AND json_type(rt.target_snapshot_json, '$.target.deleteLimits') = 'object'
  AND json_extract(rt.target_snapshot_json, '$.target.createMode') IN ('relay', 'server_copy')
  AND json_type(rt.target_snapshot_json, '$.target.concurrentFiles') IS NULL
  AND json_type(rt.target_snapshot_json, '$.target.chunkConcurrency') IS NULL
  AND json_type(rt.target_snapshot_json, '$.instance.limits.maxApiConcurrency') = 'integer'
  AND json_extract(rt.target_snapshot_json, '$.instance.limits.maxApiConcurrency') BETWEEN 0 AND 9007199254740991
  AND json_type(rt.target_snapshot_json, '$.instance.limits.apiRequestsPerSecond') = 'integer'
  AND json_extract(rt.target_snapshot_json, '$.instance.limits.apiRequestsPerSecond') BETWEEN 0 AND 9007199254740991
  AND json_type(rt.target_snapshot_json, '$.instance.limits.maxDownloadConnections') = 'integer'
  AND json_extract(rt.target_snapshot_json, '$.instance.limits.maxDownloadConnections') BETWEEN 0 AND 9007199254740991
  AND json_type(rt.target_snapshot_json, '$.instance.limits.maxUploadSessions') = 'integer'
  AND json_extract(rt.target_snapshot_json, '$.instance.limits.maxUploadSessions') BETWEEN 0 AND 9007199254740991
  AND json_type(rt.target_snapshot_json, '$.instance.limits.maxOutstandingTasks') = 'integer'
  AND json_extract(rt.target_snapshot_json, '$.instance.limits.maxOutstandingTasks') BETWEEN 0 AND 9007199254740991
  AND json_type(rt.target_snapshot_json, '$.instance.limits.maxChunkConcurrency') = 'integer'
  AND json_extract(rt.target_snapshot_json, '$.instance.limits.maxChunkConcurrency') BETWEEN 0 AND 9007199254740991
) IS NOT TRUE LIMIT 1;--> statement-breakpoint
-- 历史 Run 只用自己冻结的 Instance 值：源下载并发取源实例的下载连接数；relay Target 取目标实例上传会话数，
-- server_copy Target 取目标实例 task 数；单文件分片并发原先实际最多 2，旧值 1 保留为 1，其余为 2。
-- 子查询会丢失 JSON 子类型，显式 json() 保持对象与数组；聚合内 ORDER BY 按数组下标保证原顺序。
UPDATE runs AS r
SET run_config_json = json_set(
  r.run_config_json,
  '$.job.sourceDownloadConcurrency',
  (SELECT json_extract(i.value, '$.limits.maxDownloadConnections')
   FROM json_each(r.run_config_json, '$.instances') AS i
   WHERE i.key = json_extract(r.run_config_json, '$.job.source.instanceId')),
  '$.job.targets',
  json((
    SELECT json_group_array(
      json(json_set(
        entry.value,
        '$.concurrentFiles',
        CASE json_extract(entry.value, '$.createMode')
          WHEN 'server_copy' THEN json_extract(i.value, '$.limits.maxOutstandingTasks')
          ELSE json_extract(i.value, '$.limits.maxUploadSessions')
        END,
        '$.chunkConcurrency',
        CASE WHEN json_extract(i.value, '$.limits.maxChunkConcurrency') = 1 THEN 1 ELSE 2 END
      )) ORDER BY entry.key
    )
    FROM json_each(r.run_config_json, '$.job.targets') AS entry
    JOIN json_each(r.run_config_json, '$.instances') AS i
      ON i.key = json_extract(entry.value, '$.instanceId')
  ))
);--> statement-breakpoint
UPDATE run_targets
SET target_snapshot_json = json_set(
  target_snapshot_json,
  '$.target.concurrentFiles',
  CASE json_extract(target_snapshot_json, '$.target.createMode')
    WHEN 'server_copy' THEN json_extract(target_snapshot_json, '$.instance.limits.maxOutstandingTasks')
    ELSE json_extract(target_snapshot_json, '$.instance.limits.maxUploadSessions')
  END,
  '$.target.chunkConcurrency',
  CASE WHEN json_extract(target_snapshot_json, '$.instance.limits.maxChunkConcurrency') = 1 THEN 1 ELSE 2 END
);--> statement-breakpoint
-- 快照中的 Instance 只保留管理 API 配额。
UPDATE runs
SET run_config_json = json_set(run_config_json, '$.instances', json((
  SELECT json_group_object(i.key, json(json_remove(
    i.value,
    '$.limits.maxDownloadConnections',
    '$.limits.maxUploadSessions',
    '$.limits.maxOutstandingTasks',
    '$.limits.maxChunkConcurrency'
  )))
  FROM json_each(runs.run_config_json, '$.instances') AS i
)));--> statement-breakpoint
UPDATE run_targets
SET target_snapshot_json = json_remove(
  target_snapshot_json,
  '$.instance.limits.maxDownloadConnections',
  '$.instance.limits.maxUploadSessions',
  '$.instance.limits.maxOutstandingTasks',
  '$.instance.limits.maxChunkConcurrency'
);--> statement-breakpoint
-- 编辑中的 Job/Target 继承当前 Instance 值；用 LEFT JOIN，实例缺失时由 NOT NULL 约束中止迁移而不是丢行。
CREATE TABLE `__new_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`source_instance_id` text NOT NULL,
	`source_path` text NOT NULL,
	`source_password_enc` text,
	`source_refresh` integer DEFAULT false NOT NULL,
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
	CONSTRAINT `jobs_name` CHECK(length(`name`) BETWEEN 1 AND 100),
	CONSTRAINT `jobs_booleans` CHECK(`enabled` IN (0,1) AND `source_refresh` IN (0,1) AND `allow_empty_source` IN (0,1) AND `sync_empty_dirs` IN (0,1)),
	CONSTRAINT `jobs_globs` CHECK(json_valid(`include_globs_json`) AND json_valid(`exclude_globs_json`)),
	CONSTRAINT `jobs_sizes` CHECK((`min_size_bytes` IS NULL OR `min_size_bytes` BETWEEN 0 AND 9007199254740991) AND (`max_size_bytes` IS NULL OR `max_size_bytes` BETWEEN 0 AND 9007199254740991) AND (`min_size_bytes` IS NULL OR `max_size_bytes` IS NULL OR `min_size_bytes` <= `max_size_bytes`)),
	CONSTRAINT `jobs_limits` CHECK(`timeout_seconds` BETWEEN 60 AND 604800 AND `relay_bandwidth_limit` BETWEEN 0 AND 9007199254740991 AND `source_download_concurrency` BETWEEN 0 AND 9007199254740991),
	CONSTRAINT `jobs_retry_count` CHECK(`retry_count` IS NULL OR `retry_count` BETWEEN 0 AND 9),
	CONSTRAINT `jobs_times` CHECK(`created_at` >= 0 AND `updated_at` >= 0 AND (`archived_at` IS NULL OR `archived_at` >= 0))
);--> statement-breakpoint
INSERT INTO `__new_jobs` SELECT
	j.`id`, j.`name`, j.`enabled`, j.`source_instance_id`, j.`source_path`,
	j.`source_password_enc`, j.`source_refresh`, i.`max_download_connections`,
	j.`cron`, j.`timezone`, j.`include_globs_json`, j.`exclude_globs_json`,
	j.`min_size_bytes`, j.`max_size_bytes`, j.`allow_empty_source`,
	j.`sync_empty_dirs`, j.`retry_count`, j.`relay_bandwidth_limit`,
	j.`timeout_seconds`, j.`archived_at`, j.`created_at`, j.`updated_at`
FROM `jobs` AS j
LEFT JOIN `instances` AS i ON i.`id` = j.`source_instance_id`;--> statement-breakpoint
CREATE TABLE `__new_job_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`instance_id` text NOT NULL,
	`path` text NOT NULL,
	`password_enc` text,
	`position` integer NOT NULL,
	`mode` text DEFAULT 'incremental' NOT NULL,
	`create_mode` text DEFAULT 'relay' NOT NULL,
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
	CONSTRAINT `job_targets_position_nonnegative` CHECK(`position` >= 0),
	CONSTRAINT `job_targets_mode` CHECK(`mode` IN ('incremental','mirror')),
	CONSTRAINT `job_targets_create_mode` CHECK(`create_mode` IN ('relay','server_copy')),
	CONSTRAINT `job_targets_booleans` CHECK(`refresh` IN (0,1) AND `delete_limits_enabled` IN (0,1)),
	CONSTRAINT `job_targets_limits` CHECK((`delete_limits_enabled` = 0 OR `max_delete_count` IS NOT NULL OR `max_delete_percent` IS NOT NULL) AND (`max_delete_count` IS NULL OR `max_delete_count` BETWEEN 0 AND 9007199254740991) AND (`max_delete_percent` IS NULL OR `max_delete_percent` BETWEEN 0 AND 100)),
	CONSTRAINT `job_targets_resources` CHECK(`concurrent_files` BETWEEN 0 AND 9007199254740991 AND `chunk_concurrency` BETWEEN 1 AND 8),
	CONSTRAINT `job_targets_times` CHECK(`created_at` >= 0 AND `updated_at` >= 0 AND (`archived_at` IS NULL OR `archived_at` >= 0))
);--> statement-breakpoint
INSERT INTO `__new_job_targets` SELECT
	t.`id`, t.`job_id`, t.`instance_id`, t.`path`, t.`password_enc`, t.`position`,
	t.`mode`, t.`create_mode`,
	CASE WHEN t.`create_mode` = 'server_copy' THEN i.`max_outstanding_tasks` ELSE i.`max_upload_sessions` END,
	CASE WHEN i.`max_chunk_concurrency` = 1 THEN 1 ELSE 2 END,
	t.`refresh`, t.`delete_limits_enabled`, t.`max_delete_count`,
	t.`max_delete_percent`, t.`archived_at`, t.`created_at`, t.`updated_at`
FROM `job_targets` AS t
LEFT JOIN `instances` AS i ON i.`id` = t.`instance_id`;--> statement-breakpoint
DROP TABLE `job_targets`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;--> statement-breakpoint
ALTER TABLE `__new_job_targets` RENAME TO `job_targets`;--> statement-breakpoint
CREATE INDEX `jobs_enabled_archive` ON `jobs` (`enabled`,`archived_at`);--> statement-breakpoint
CREATE INDEX `jobs_source` ON `jobs` (`source_instance_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `job_targets_position` ON `job_targets` (`job_id`,`position`) WHERE `archived_at` IS NULL;--> statement-breakpoint
CREATE INDEX `job_targets_instance_archive` ON `job_targets` (`instance_id`,`archived_at`);--> statement-breakpoint
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
	CONSTRAINT `instances_name` CHECK(length(`name`) BETWEEN 1 AND 100),
	CONSTRAINT `instances_auth_mode` CHECK(`auth_mode` IN ('token','password')),
	CONSTRAINT `instances_username` CHECK((`auth_mode` = 'token' AND `username` IS NULL) OR (`auth_mode` = 'password' AND length(`username`) > 0 AND `username` IS NOT NULL)),
	CONSTRAINT `instances_auth_state` CHECK(`auth_state` IN ('untested','ready','auth_blocked')),
	CONSTRAINT `instances_download_mode` CHECK(`download_mode` IN ('d','p')),
	CONSTRAINT `instances_api_concurrency` CHECK(`max_api_concurrency` BETWEEN 0 AND 9007199254740991),
	CONSTRAINT `instances_api_rate` CHECK(`api_requests_per_second` BETWEEN 0 AND 9007199254740991),
	CONSTRAINT `instances_multipart` CHECK(`multipart_enabled` IS NULL OR `multipart_enabled` IN (0,1)),
	CONSTRAINT `instances_times` CHECK(`created_at` >= 0 AND `updated_at` >= 0 AND (`archived_at` IS NULL OR `archived_at` >= 0) AND (`last_test_at` IS NULL OR `last_test_at` >= 0) AND (`auth_blocked_until` IS NULL OR `auth_blocked_until` >= 0))
);--> statement-breakpoint
INSERT INTO `__new_instances` SELECT
	`id`, `name`, `base_url`, `auth_mode`, `username`, `secret_enc`,
	`auth_state`, `auth_block_reason`, `auth_blocked_until`, `account_username`,
	`account_base_path`, `account_role`, `account_permissions`,
	`max_api_concurrency`, `api_requests_per_second`, `download_mode`,
	`last_test_at`, `openlist_version`, `multipart_enabled`, `last_error_code`,
	`last_error_message`, `archived_at`, `created_at`, `updated_at`
FROM `instances`;--> statement-breakpoint
DROP TABLE `instances`;--> statement-breakpoint
ALTER TABLE `__new_instances` RENAME TO `instances`;--> statement-breakpoint
CREATE INDEX `instances_archive_created_id` ON `instances` (`archived_at`,`created_at`,`id`);--> statement-breakpoint
-- 表重建后在事务内断言外键完整，否则连同数据一起回滚。
INSERT INTO `__resource_snapshot_check`
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM pragma_foreign_key_check) THEN 1 ELSE 0 END;--> statement-breakpoint
DROP TABLE `__resource_snapshot_check`;
