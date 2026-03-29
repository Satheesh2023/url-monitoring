-- Default probe interval: 1 minute (was 5s). New targets and DB default only; existing rows unchanged.
ALTER TABLE targets
  MODIFY COLUMN poll_interval_sec INT NOT NULL DEFAULT 60;
