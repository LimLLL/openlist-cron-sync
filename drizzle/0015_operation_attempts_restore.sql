-- 根身份保留为逻辑操作，全部旧行ID保留为尝试ID，终态Run统计不重新写入。
CREATE TEMP TABLE __operation_counts AS
SELECT coalesce(retry_of,id) AS id, count(*) AS attempt_count FROM __old_operations GROUP BY coalesce(retry_of,id);
--> statement-breakpoint
CREATE UNIQUE INDEX __operation_counts_id ON __operation_counts(id);
--> statement-breakpoint
INSERT INTO operations (id,run_id,run_target_id,seq,action,method,reason,status,source_instance_id,source_path,target_instance_id,target_path,is_dir,expected_source_size,expected_target_size,expected_source_modified,affected_file_count,affected_bytes,attempt_count,created_at,updated_at,ended_at)
SELECT o.id,o.run_id,o.run_target_id,o.seq,o.action,o.method,o.reason,a.status,o.source_instance_id,o.source_path,o.target_instance_id,o.target_path,o.is_dir,o.expected_source_size,o.expected_target_size,o.expected_source_modified,o.affected_file_count,o.affected_bytes,c.attempt_count,o.created_at,a.updated_at,a.ended_at
FROM __old_operations o JOIN __operation_counts c ON c.id=o.id
JOIN __old_operations a ON (a.id=o.id OR a.retry_of=o.id) AND a.attempt_no=c.attempt_count
WHERE o.retry_of IS NULL;
--> statement-breakpoint
INSERT INTO operation_attempts (id,operation_id,target_instance_id,method,attempt_no,status,openlist_task_id,remote_state,remote_cleanup_pending,bytes_downloaded,bytes_transferred,multipart_upload_id,multipart_chunk_size,multipart_state,multipart_attempt,source_stream_completed_at,error_code,error_message,created_at,updated_at,submitted_at,ended_at,next_attempt_at,unknown_since)
SELECT id,coalesce(retry_of,id),target_instance_id,method,attempt_no,status,openlist_task_id,remote_state,remote_cleanup_pending,bytes_downloaded,bytes_transferred,multipart_upload_id,multipart_chunk_size,multipart_state,multipart_attempt,source_stream_completed_at,error_code,error_message,created_at,updated_at,submitted_at,ended_at,next_attempt_at,unknown_since FROM __old_operations;
--> statement-breakpoint
DROP TABLE operation_dependencies;
--> statement-breakpoint
CREATE TABLE operation_dependencies (
 operation_id TEXT NOT NULL REFERENCES operations(id) ON DELETE RESTRICT,
 depends_on_id TEXT NOT NULL REFERENCES operations(id) ON DELETE RESTRICT,
 PRIMARY KEY(operation_id,depends_on_id),
 CONSTRAINT dependencies_not_self CHECK(operation_id!=depends_on_id)
) WITHOUT ROWID;
--> statement-breakpoint
CREATE INDEX operation_dependencies_depends_on ON operation_dependencies(depends_on_id);
--> statement-breakpoint
INSERT INTO operation_dependencies SELECT operation_id,depends_on_id FROM __old_dependencies;
--> statement-breakpoint
INSERT INTO __operation_migration_error
SELECT id,'MIGRATION_ROW_COUNT' FROM __old_operations
WHERE (SELECT count(*) FROM operation_attempts)!=(SELECT count(*) FROM __old_operations)
 OR (SELECT count(*) FROM operations)!=(SELECT count(*) FROM __operation_counts) LIMIT 1;
--> statement-breakpoint
-- 任何未发现的外键破坏也必须回滚整个发行升级，而非提交后才拒绝启动。
CREATE TEMP TABLE __operation_fk_check (valid INTEGER NOT NULL CHECK(valid=1));
--> statement-breakpoint
INSERT INTO __operation_fk_check SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM pragma_foreign_key_check) THEN 1 ELSE 0 END;
--> statement-breakpoint
DROP TABLE __operation_fk_check;
--> statement-breakpoint
DROP TABLE __old_dependencies;
--> statement-breakpoint
DROP TABLE __old_operations;
--> statement-breakpoint
DROP TABLE __operation_counts;
--> statement-breakpoint
DROP TABLE __operation_migration_error;
