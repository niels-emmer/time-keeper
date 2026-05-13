PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_api_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`label` text NOT NULL,
	`created_at` text NOT NULL DEFAULT (datetime('now')),
	`last_used_at` text,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_api_tokens` (`id`, `user_id`, `token_hash`, `label`, `created_at`, `last_used_at`, `expires_at`)
SELECT
	`id`,
	`user_id`,
	`token_hash`,
	`label`,
	`created_at`,
	`last_used_at`,
	COALESCE(datetime(`created_at`, '+365 days'), datetime('now', '+365 days'))
FROM `api_tokens`;
--> statement-breakpoint
DROP TABLE `api_tokens`;
--> statement-breakpoint
ALTER TABLE `__new_api_tokens` RENAME TO `api_tokens`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_api_tokens_hash` ON `api_tokens` (`token_hash`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;