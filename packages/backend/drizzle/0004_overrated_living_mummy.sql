CREATE TABLE `monthly_project_goals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`category_id` integer NOT NULL,
	`month_year` text NOT NULL,
	`available_hours` integer NOT NULL,
	`available_minutes` integer NOT NULL,
	`last_updated` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
