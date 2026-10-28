-- 与 operations 重建同处 Drizzle 迁移事务；只删除退役设置，保留冻结配置的其余内容。
CREATE TEMP TABLE `__unknown_history_check` (
  `valid` integer NOT NULL CHECK (`valid` = 1)
);--> statement-breakpoint
INSERT INTO `__unknown_history_check`
SELECT 0 FROM runs WHERE (
  json_type(run_config_json) = 'object'
  AND json_extract(run_config_json, '$.snapshotVersion') = 1
  AND json_type(run_config_json, '$.settings') = 'object'
) IS NOT TRUE LIMIT 1;--> statement-breakpoint
UPDATE runs
SET run_config_json = json_remove(run_config_json, '$.settings.quarantineSeconds');--> statement-breakpoint
-- 父表重建后的依赖与自引用必须完整；不完整时回滚结构与快照修改。
INSERT INTO `__unknown_history_check`
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM pragma_foreign_key_check) THEN 1 ELSE 0 END;--> statement-breakpoint
DROP TABLE `__unknown_history_check`;
