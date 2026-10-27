-- 扫描间隔只补固定默认值；实例旧限额直接删除，不从当前 Job/Instance 回填历史。
-- 与前两份结构迁移同处 Drizzle 事务，异常快照或外键不完整时全部回滚。
CREATE TEMP TABLE `__scan_snapshot_check` (
  `valid` integer NOT NULL CHECK (`valid` = 1)
);--> statement-breakpoint
INSERT INTO `__scan_snapshot_check`
SELECT 0 FROM runs AS r WHERE (
  json_type(r.run_config_json) = 'object'
  AND json_extract(r.run_config_json, '$.snapshotVersion') = 1
  AND json_type(r.run_config_json, '$.job') = 'object'
  AND json_type(r.run_config_json, '$.job.targets') = 'array'
  AND json_type(r.run_config_json, '$.instances') = 'object'
  AND json_type(r.run_config_json, '$.job.sourceScanIntervalSeconds') IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM json_each(r.run_config_json, '$.job.targets') AS t
    WHERE json_type(t.value) IS NOT 'object'
       OR json_type(t.value, '$.scanIntervalSeconds') IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM json_each(r.run_config_json, '$.instances') AS i
    WHERE json_type(i.value) IS NOT 'object'
  )
) IS NOT TRUE LIMIT 1;--> statement-breakpoint
INSERT INTO `__scan_snapshot_check`
SELECT 0 FROM run_targets AS rt WHERE (
  json_type(rt.target_snapshot_json) = 'object'
  AND json_type(rt.target_snapshot_json, '$.target') = 'object'
  AND json_type(rt.target_snapshot_json, '$.instance') = 'object'
  AND json_type(rt.target_snapshot_json, '$.target.scanIntervalSeconds') IS NULL
) IS NOT TRUE LIMIT 1;--> statement-breakpoint
-- 保留完整冻结 Job、目标数组顺序和所有实例身份；终态 Run 不依赖已被清理的子表。
UPDATE runs AS r
SET run_config_json = json_set(
  r.run_config_json,
  '$.job.sourceScanIntervalSeconds', 0,
  '$.job.targets', json((
    SELECT json_group_array(json(json_set(t.value, '$.scanIntervalSeconds', 0)) ORDER BY t.key)
    FROM json_each(r.run_config_json, '$.job.targets') AS t
  )),
  '$.instances', json((
    SELECT json_group_object(i.key, json(json_remove(i.value, '$.limits')))
    FROM json_each(r.run_config_json, '$.instances') AS i
  ))
);--> statement-breakpoint
UPDATE run_targets
SET target_snapshot_json = json_set(
  json_remove(target_snapshot_json, '$.instance.limits'),
  '$.target.scanIntervalSeconds', 0
);--> statement-breakpoint
-- 父表重建后在事务提交前验证外键，不让失败升级留下部分新结构。
INSERT INTO `__scan_snapshot_check`
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM pragma_foreign_key_check) THEN 1 ELSE 0 END;--> statement-breakpoint
DROP TABLE `__scan_snapshot_check`;
