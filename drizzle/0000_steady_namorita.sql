CREATE TABLE `cases` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`revision` integer NOT NULL,
	`snapshot` text NOT NULL,
	`updated_at` text NOT NULL
);
