-- Repair any pre-existing H-1 state before the constraint exists: an affected
-- install may already have more than one open row per user. Keep the most
-- recently started open row and close the rest, so the unique index below can
-- be created without a failed migration on boot.
--
-- `end_time IS NULL` identifies a running timer; the value written here matches
-- the application's UTC ISO 8601 format.
UPDATE `time_entries`
SET `end_time` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `end_time` IS NULL
  AND `id` NOT IN (
    SELECT `id` FROM (
      SELECT
        `id`,
        ROW_NUMBER() OVER (
          PARTITION BY `user_id`
          ORDER BY `start_time` DESC, `id` DESC
        ) AS `rn`
      FROM `time_entries`
      WHERE `end_time` IS NULL
    )
    WHERE `rn` = 1
  );
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_entries_one_open_per_user` ON `time_entries` (`user_id`) WHERE end_time IS NULL;
