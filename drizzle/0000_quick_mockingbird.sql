CREATE TABLE `admins` (
	`id` integer PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`token_version` integer DEFAULT 1 NOT NULL,
	`must_change_password` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "admins_singleton" CHECK("admins"."id" = 1),
	CONSTRAINT "admins_username_length" CHECK(length("admins"."username") BETWEEN 1 AND 64),
	CONSTRAINT "admins_token_version" CHECK("admins"."token_version" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "admins_must_change" CHECK("admins"."must_change_password" IN (0, 1)),
	CONSTRAINT "admins_timestamps" CHECK("admins"."created_at" >= 0 AND "admins"."updated_at" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admins_username_unique` ON `admins` (`username`);