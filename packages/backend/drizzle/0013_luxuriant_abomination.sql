CREATE TABLE `password_reset_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`created_by` text,
	`expires_at` text NOT NULL,
	`used_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_password_reset_codes_user` ON `password_reset_codes` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_password_reset_codes_hash` ON `password_reset_codes` (`code_hash`);