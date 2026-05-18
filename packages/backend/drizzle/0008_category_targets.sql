ALTER TABLE `categories` ADD COLUMN `target_cadence` text;
--> statement-breakpoint
ALTER TABLE `categories` ADD COLUMN `target_minutes` integer;
--> statement-breakpoint
ALTER TABLE `categories` ADD COLUMN `target_started_at` text;
--> statement-breakpoint
UPDATE `categories`
SET
  `target_cadence` = COALESCE(
    `target_cadence`,
    (
      SELECT CASE
        WHEN ((mpg.`available_hours` * 60) + mpg.`available_minutes`) > 0 THEN 'monthly'
        ELSE NULL
      END
      FROM `monthly_project_goals` mpg
      WHERE mpg.`user_id` = `categories`.`user_id`
        AND mpg.`category_id` = `categories`.`id`
      ORDER BY mpg.`month_year` DESC, mpg.`last_updated` DESC
      LIMIT 1
    )
  ),
  `target_minutes` = COALESCE(
    `target_minutes`,
    (
      SELECT CASE
        WHEN ((mpg.`available_hours` * 60) + mpg.`available_minutes`) > 0 THEN ((mpg.`available_hours` * 60) + mpg.`available_minutes`)
        ELSE NULL
      END
      FROM `monthly_project_goals` mpg
      WHERE mpg.`user_id` = `categories`.`user_id`
        AND mpg.`category_id` = `categories`.`id`
      ORDER BY mpg.`month_year` DESC, mpg.`last_updated` DESC
      LIMIT 1
    )
  )
WHERE EXISTS (
  SELECT 1
  FROM `monthly_project_goals` mpg
  WHERE mpg.`user_id` = `categories`.`user_id`
    AND mpg.`category_id` = `categories`.`id`
);
