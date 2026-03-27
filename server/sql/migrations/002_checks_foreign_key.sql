-- Add FK if missing (idempotent for DBs created before this migration set).
SET @hasfk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'checks'
    AND CONSTRAINT_NAME = 'checks_target_id_fkey'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql := IF(
  @hasfk = 0,
  'ALTER TABLE checks ADD CONSTRAINT checks_target_id_fkey FOREIGN KEY (target_id) REFERENCES targets(id) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE _urlmon_fk FROM @sql;
EXECUTE _urlmon_fk;
DEALLOCATE PREPARE _urlmon_fk;
