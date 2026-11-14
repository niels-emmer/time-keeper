-- Phase A / D7: introduce `users` and move every user-scoped table from the
-- Authentik email string to `users.id` (UUID).
--
-- ORDER MATTERS. Statements run top to bottom inside Drizzle's single wrapping
-- transaction, so the backfill below must finish before any table is rebuilt,
-- because every rebuilt table resolves its owner with a sub-select on
-- `users.email`.
--
-- Migration-safety notes (see docs/operations/migration-phase-a.md):
--
--   * The five rebuilds at the bottom drop tables that other tables reference
--     (`categories`, for instance). That cannot happen with foreign-key
--     enforcement on, and neither `PRAGMA foreign_keys = OFF` nor
--     `PRAGMA defer_foreign_keys = ON` can help from inside the transaction the
--     migrator opens around this file. Enforcement is therefore switched off
--     around the whole batch by `migrateWithRebuildSafety()` in
--     `src/db/migrationRunner.ts`, which re-validates with
--     `PRAGMA foreign_key_check` before restoring it. The migration must be
--     applied through `runMigrations()`, never by a bare `migrate()` call.
--   * Every rebuilt table maps its owner with
--     `(SELECT id FROM users WHERE email = lower(trim(<old user_id>)))`.
--     A missing mapping yields NULL into a NOT NULL column, so an unmapped row
--     aborts and rolls back the whole migration instead of silently detaching
--     data.
--   * No row is deleted, and no id is renumbered. Only `user_id` values change,
--     from an email to that email's `users.id`.
--   * The legacy `monthly_project_goals` table is kept (Q24). Only its
--     `user_id` becomes a foreign key.

CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_updated_at` text,
	`role` text DEFAULT 'user' NOT NULL,
	`display_name` text,
	`mfa_enabled` integer DEFAULT false NOT NULL,
	`mfa_secret_enc` text,
	`mfa_last_step` integer,
	`must_set_password` integer DEFAULT false NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`invited_by` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`last_login_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_username` ON `users` (`username`);--> statement-breakpoint
-- Backfill one `users` row per distinct pre-existing identity.
--
--   * email     — lower-cased and trimmed, so the proxy path's lookup is
--                 deterministic regardless of the header's casing (Q15).
--   * username  — derived from the email local part, filtered to the allowed
--                 alphabet `[a-z0-9_-]` one character at a time (the recursive
--                 CTE), trimmed, padded to the 3-character minimum, capped at
--                 32, and de-collided with a `-N` suffix in email order (Q14).
--                 Reserved names get a `-1` suffix so the migration can never
--                 mint `admin`/`root`/...
--   * password  — an `unusable$<random>` sentinel, not a hash: no input can
--                 verify against it. No password is generated or logged (Q3).
--   * must_set_password — 1, so every migrated account is flagged for the admin
--                 to issue a reset code (Q3).
INSERT INTO `users`
	(`id`, `email`, `username`, `password_hash`, `role`, `must_set_password`, `created_at`)
WITH RECURSIVE
	`src`(`email`) AS (
		SELECT lower(trim(`user_id`)) FROM `categories`
		UNION SELECT lower(trim(`user_id`)) FROM `time_entries`
		UNION SELECT lower(trim(`user_id`)) FROM `user_settings`
		UNION SELECT lower(trim(`user_id`)) FROM `api_tokens`
		UNION SELECT lower(trim(`user_id`)) FROM `monthly_project_goals`
	),
	`seed`(`email`, `local_part`) AS (
		SELECT
			`email`,
			CASE
				WHEN instr(`email`, '@') > 0 THEN substr(`email`, 1, instr(`email`, '@') - 1)
				ELSE `email`
			END
		FROM `src`
	),
	`walk`(`email`, `local_part`, `i`, `out`) AS (
		SELECT `email`, `local_part`, 1, '' FROM `seed`
		UNION ALL
		SELECT
			`email`,
			`local_part`,
			`i` + 1,
			`out` || CASE
				WHEN substr(`local_part`, `i`, 1) GLOB '[a-z0-9_-]' THEN substr(`local_part`, `i`, 1)
				ELSE '-'
			END
		FROM `walk`
		WHERE `i` <= length(`local_part`)
	),
	`filtered`(`email`, `candidate`) AS (
		SELECT `email`, trim(`out`, '-') FROM `walk` WHERE `i` > length(`local_part`)
	),
	`normalised`(`email`, `candidate`) AS (
		SELECT
			`email`,
			CASE
				WHEN length(`candidate`) = 0 THEN 'user'
				WHEN length(`candidate`) < 3 THEN 'user'
				ELSE substr(`candidate`, 1, 32)
			END
		FROM `filtered`
	),
	`reserved`(`email`, `base`) AS (
		SELECT
			`email`,
			CASE
				WHEN `candidate` IN ('admin', 'api', 'me', 'root', 'system') THEN `candidate` || '-1'
				ELSE `candidate`
			END
		FROM `normalised`
	),
	`ranked`(`email`, `base`, `rn`) AS (
		SELECT `email`, `base`, ROW_NUMBER() OVER (PARTITION BY `base` ORDER BY `email`) FROM `reserved`
	)
SELECT
	lower(
		hex(randomblob(4)) || '-' ||
		hex(randomblob(2)) || '-' ||
		'4' || substr(hex(randomblob(2)), 2) || '-' ||
		substr('89ab', 1 + (random() & 3), 1) || substr(hex(randomblob(2)), 2) || '-' ||
		hex(randomblob(6))
	),
	`email`,
	CASE WHEN `rn` = 1 THEN `base` ELSE substr(`base`, 1, 28) || '-' || `rn` END,
	'unusable$' || lower(hex(randomblob(16))),
	'user',
	1,
	datetime('now')
FROM `ranked`;
--> statement-breakpoint
CREATE TABLE `auth_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text,
	`kind` text NOT NULL,
	`ip` text,
	`user_agent` text,
	`meta_json` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_auth_events_user_created` ON `auth_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`email` text,
	`role` text DEFAULT 'user' NOT NULL,
	`created_by` text,
	`expires_at` text NOT NULL,
	`used_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_invites_token_hash` ON `invites` (`token_hash`);--> statement-breakpoint
CREATE TABLE `recovery_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`used_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_recovery_codes_user` ON `recovery_codes` (`user_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`last_seen_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`absolute_expires_at` text NOT NULL,
	`user_agent` text,
	`ip` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `__new_api_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`label` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`last_used_at` text,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Q25: existing tokens are remapped onto the new user id, not dropped, so the
-- macOS app keeps authenticating after the upgrade without re-minting.
INSERT INTO `__new_api_tokens`("id", "user_id", "token_hash", "label", "created_at", "last_used_at", "expires_at")
	SELECT "id", (SELECT "id" FROM `users` WHERE "email" = lower(trim("api_tokens"."user_id"))), "token_hash", "label", "created_at", "last_used_at", "expires_at"
	FROM `api_tokens`;--> statement-breakpoint
DROP TABLE `api_tokens`;--> statement-breakpoint
ALTER TABLE `__new_api_tokens` RENAME TO `api_tokens`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_api_tokens_hash` ON `api_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `__new_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#6366f1' NOT NULL,
	`workday_code` text,
	`billable` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`target_cadence` text,
	`target_minutes` integer,
	`target_started_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_categories`("id", "user_id", "name", "color", "workday_code", "billable", "sort_order", "target_cadence", "target_minutes", "target_started_at", "created_at", "updated_at")
	SELECT "id", (SELECT "id" FROM `users` WHERE "email" = lower(trim("categories"."user_id"))), "name", "color", "workday_code", "billable", "sort_order", "target_cadence", "target_minutes", "target_started_at", "created_at", "updated_at"
	FROM `categories`;--> statement-breakpoint
DROP TABLE `categories`;--> statement-breakpoint
ALTER TABLE `__new_categories` RENAME TO `categories`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_categories_user_name` ON `categories` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `__new_monthly_project_goals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`category_id` integer NOT NULL,
	`month_year` text NOT NULL,
	`available_hours` integer NOT NULL,
	`available_minutes` integer NOT NULL,
	`last_updated` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_monthly_project_goals`("id", "user_id", "category_id", "month_year", "available_hours", "available_minutes", "last_updated")
	SELECT "id", (SELECT "id" FROM `users` WHERE "email" = lower(trim("monthly_project_goals"."user_id"))), "category_id", "month_year", "available_hours", "available_minutes", "last_updated"
	FROM `monthly_project_goals`;--> statement-breakpoint
DROP TABLE `monthly_project_goals`;--> statement-breakpoint
ALTER TABLE `__new_monthly_project_goals` RENAME TO `monthly_project_goals`;--> statement-breakpoint
CREATE TABLE `__new_time_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`category_id` integer NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text,
	`notes` text,
	`rounded` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_time_entries`("id", "user_id", "category_id", "start_time", "end_time", "notes", "rounded", "created_at", "updated_at")
	SELECT "id", (SELECT "id" FROM `users` WHERE "email" = lower(trim("time_entries"."user_id"))), "category_id", "start_time", "end_time", "notes", "rounded", "created_at", "updated_at"
	FROM `time_entries`;--> statement-breakpoint
DROP TABLE `time_entries`;--> statement-breakpoint
ALTER TABLE `__new_time_entries` RENAME TO `time_entries`;--> statement-breakpoint
CREATE INDEX `idx_entries_user_start` ON `time_entries` (`user_id`,`start_time`);--> statement-breakpoint
CREATE INDEX `idx_entries_user_category` ON `time_entries` (`user_id`,`category_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_entries_one_open_per_user` ON `time_entries` (`user_id`) WHERE end_time IS NULL;--> statement-breakpoint
CREATE TABLE `__new_user_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`weekly_goal_hours` integer DEFAULT 40 NOT NULL,
	`rounding_increment_minutes` integer DEFAULT 60 NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_user_settings`("user_id", "weekly_goal_hours", "rounding_increment_minutes", "timezone", "updated_at")
	SELECT (SELECT "id" FROM `users` WHERE "email" = lower(trim("user_settings"."user_id"))), "weekly_goal_hours", "rounding_increment_minutes", "timezone", "updated_at"
	FROM `user_settings`;--> statement-breakpoint
DROP TABLE `user_settings`;--> statement-breakpoint
ALTER TABLE `__new_user_settings` RENAME TO `user_settings`;
