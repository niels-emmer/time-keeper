CREATE TABLE `user_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`weekly_goal_hours` integer DEFAULT 40 NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
