-- 在同一发行迁移事务中校验和暂存旧行；临时对象只服务本次结构转换。
CREATE TEMP TABLE __operation_migration_error (row_id TEXT NOT NULL, reason TEXT NOT NULL);
--> statement-breakpoint
CREATE TEMP TRIGGER __operation_migration_abort BEFORE INSERT ON __operation_migration_error
BEGIN
  SELECT RAISE(ABORT, 'OPERATION_MIGRATION ' || NEW.reason || ' ' || NEW.row_id);
END;
--> statement-breakpoint
INSERT INTO __operation_migration_error
SELECT id, 'MAINTENANCE_RESPONSIBILITY' FROM operations
WHERE error_code='REMOTE_TASK_CHANGED' AND (remote_cleanup_pending=1 OR openlist_task_id IS NOT NULL OR status IN ('pending','submitting','submitted','running')) LIMIT 1;
--> statement-breakpoint
INSERT INTO __operation_migration_error
SELECT o.id, 'BROKEN_RETRY_CHAIN' FROM operations o LEFT JOIN operations r ON r.id=o.retry_of
WHERE o.error_code IS NOT 'REMOTE_TASK_CHANGED' AND o.retry_of IS NOT NULL AND (
  r.id IS NULL OR r.retry_of IS NOT NULL OR r.error_code='REMOTE_TASK_CHANGED'
  OR r.run_id IS NOT o.run_id OR r.run_target_id IS NOT o.run_target_id
  OR r.action IS NOT o.action OR r.method IS NOT o.method OR r.reason IS NOT o.reason
  OR r.target_instance_id IS NOT o.target_instance_id OR r.target_path IS NOT o.target_path
  OR r.source_instance_id IS NOT o.source_instance_id OR r.source_path IS NOT o.source_path
  OR r.is_dir IS NOT o.is_dir OR r.expected_source_size IS NOT o.expected_source_size
  OR r.expected_target_size IS NOT o.expected_target_size OR r.expected_source_modified IS NOT o.expected_source_modified
  OR r.affected_file_count IS NOT o.affected_file_count OR r.affected_bytes IS NOT o.affected_bytes
) LIMIT 1;
--> statement-breakpoint
-- 只物化每Run的数值预算，避免分组排序携带数百KB的冻结配置。
CREATE TEMP TABLE __operation_budgets AS SELECT id,
 json_type(run_config_json,'$.settings.retryMaxAttempts') AS budget_type,
 json_extract(run_config_json,'$.settings.retryMaxAttempts') AS budget FROM runs;
--> statement-breakpoint
CREATE UNIQUE INDEX __operation_budget_id ON __operation_budgets(id);
--> statement-breakpoint
INSERT INTO __operation_migration_error
SELECT o.id,'INVALID_ATTEMPT_BUDGET' FROM operations o LEFT JOIN __operation_budgets r ON r.id=o.run_id
WHERE o.error_code IS NOT 'REMOTE_TASK_CHANGED' AND (r.id IS NULL OR r.budget_type IS NOT 'integer' OR r.budget NOT BETWEEN 1 AND 10 OR o.attempt_no>r.budget) LIMIT 1;
--> statement-breakpoint
INSERT INTO __operation_migration_error
SELECT id, 'INVALID_ATTEMPT_NUMBERS' FROM operations
WHERE error_code IS NOT 'REMOTE_TASK_CHANGED'
 AND ((retry_of IS NULL AND attempt_no!=1) OR (retry_of IS NOT NULL AND attempt_no=1)) LIMIT 1;
--> statement-breakpoint
INSERT INTO __operation_migration_error
SELECT min(o.id), 'INVALID_ATTEMPT_NUMBERS' FROM operations o
WHERE o.error_code IS NOT 'REMOTE_TASK_CHANGED'
GROUP BY coalesce(o.retry_of,o.id)
HAVING min(o.attempt_no)!=1 OR max(o.attempt_no)!=count(*) OR count(DISTINCT o.attempt_no)!=count(*) OR max(o.attempt_no)>10
LIMIT 1;
--> statement-breakpoint
DROP TABLE __operation_budgets;
--> statement-breakpoint
INSERT INTO __operation_migration_error
SELECT o.id, 'INVALID_RETRY_RESULT' FROM operations o
WHERE o.error_code IS NOT 'REMOTE_TASK_CHANGED' AND o.status!='failed'
  AND EXISTS (SELECT 1 FROM operations n WHERE n.retry_of=coalesce(o.retry_of,o.id) AND n.attempt_no>o.attempt_no)
LIMIT 1;
--> statement-breakpoint
INSERT INTO __operation_migration_error
SELECT o.id, 'INVALID_OPERATION_TARGET' FROM operations o LEFT JOIN run_targets t ON t.id=o.run_target_id
WHERE o.error_code IS NOT 'REMOTE_TASK_CHANGED' AND (t.id IS NULL OR t.run_id IS NOT o.run_id) LIMIT 1;
--> statement-breakpoint
INSERT INTO __operation_migration_error
SELECT d.operation_id, 'INVALID_DEPENDENCY' FROM operation_dependencies d
LEFT JOIN operations o ON o.id=d.operation_id LEFT JOIN operations p ON p.id=d.depends_on_id
WHERE (o.id IS NULL OR p.id IS NULL) OR (
  o.error_code IS NOT 'REMOTE_TASK_CHANGED' AND p.error_code IS NOT 'REMOTE_TASK_CHANGED'
  AND (o.run_id IS NOT p.run_id OR o.run_target_id IS NOT p.run_target_id OR coalesce(o.retry_of,o.id)=coalesce(p.retry_of,p.id))
) LIMIT 1;
--> statement-breakpoint
CREATE TEMP TABLE __old_operations AS SELECT * FROM operations WHERE error_code IS NOT 'REMOTE_TASK_CHANGED';
--> statement-breakpoint
CREATE UNIQUE INDEX __old_operation_id ON __old_operations(id);
--> statement-breakpoint
CREATE INDEX __old_operation_root ON __old_operations(retry_of,attempt_no);
--> statement-breakpoint
CREATE TEMP TABLE __old_dependencies AS
SELECT DISTINCT coalesce(o.retry_of,o.id) AS operation_id, coalesce(p.retry_of,p.id) AS depends_on_id
FROM operation_dependencies d JOIN __old_operations o ON o.id=d.operation_id JOIN __old_operations p ON p.id=d.depends_on_id;
--> statement-breakpoint
CREATE INDEX __old_dependency_operation ON __old_dependencies(operation_id);
--> statement-breakpoint
-- 序号在同Run内唯一，环上必有一条边指向不更早的序号；只从这类边出发，正常计划（依赖均指向更早序号）无需展开整棵目录树。
-- UNION按顶点对去重，损坏的环也会收敛，不设深度截断。
WITH RECURSIVE reachable(start,node) AS (
 SELECT d.operation_id,d.depends_on_id FROM __old_dependencies d
 JOIN __old_operations o ON o.id=d.operation_id JOIN __old_operations p ON p.id=d.depends_on_id
 WHERE p.seq>=o.seq
 UNION
 SELECT r.start,d.depends_on_id FROM reachable r JOIN __old_dependencies d ON d.operation_id=r.node
)
INSERT INTO __operation_migration_error SELECT start,'DEPENDENCY_CYCLE' FROM reachable WHERE start=node LIMIT 1;
--> statement-breakpoint
-- 已按计划删除旧维护记录；生成的结构迁移不承接旧尝试行。
DELETE FROM operation_dependencies;
--> statement-breakpoint
DELETE FROM operations;
--> statement-breakpoint
-- Drizzle重建语句会读取新增列，空表先提供该列以保持生成SQL原样。
ALTER TABLE operations ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 1;
