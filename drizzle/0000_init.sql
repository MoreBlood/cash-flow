-- Начальная схема. IF NOT EXISTS: база, созданная до перехода на drizzle (та же схема), принимает её без изменений.
CREATE TABLE IF NOT EXISTS `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`currency` text NOT NULL,
	`offbudget` integer DEFAULT false NOT NULL,
	`closed` integer DEFAULT false NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`bank` text,
	`iban` text,
	`eb_account_id` text,
	`eb_hash` text,
	`eb_session_id` text,
	`consent_until` text,
	`bank_balance` integer,
	`synced_at` text,
	`sync_error` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`name` text NOT NULL,
	`is_income` integer DEFAULT false NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `category_groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `category_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_income` integer DEFAULT false NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `category_groups_name_unique` ON `category_groups` (`name`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `kv` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `rules` (
	`id` text PRIMARY KEY NOT NULL,
	`conditions_op` text DEFAULT 'and' NOT NULL,
	`conditions` text NOT NULL,
	`category_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "rules_conditions_op" CHECK("rules"."conditions_op" IN ('and', 'or'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`date` text NOT NULL,
	`amount` integer NOT NULL,
	`payee` text NOT NULL,
	`imported_payee` text,
	`notes` text DEFAULT '' NOT NULL,
	`category_id` text,
	`imported_id` text,
	`raw` text,
	`starting_balance` integer DEFAULT false NOT NULL,
	`cleared` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `transactions_imported` ON `transactions` (`account_id`,`imported_id`) WHERE "transactions"."imported_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `transactions_date` ON `transactions` (`date`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `transactions_account` ON `transactions` (`account_id`,`date`);