CREATE TABLE `allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`sku` text NOT NULL,
	`quantity` numeric NOT NULL,
	`note` text,
	`reserved_at` text NOT NULL,
	`released_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sku`) REFERENCES `items`(`sku`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "allocations_quantity_positive" CHECK(quantity > 0)
);
--> statement-breakpoint
CREATE INDEX `allocations_project_id_idx` ON `allocations` (`project_id`);--> statement-breakpoint
CREATE INDEX `allocations_sku_idx` ON `allocations` (`sku`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`field_schema` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_unique` ON `categories` (`name`);--> statement-breakpoint
CREATE TABLE `items` (
	`sku` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`unit` text,
	`quantity_on_hand` numeric DEFAULT 0 NOT NULL,
	`unit_cost` numeric,
	`location` text,
	`data` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `items_category_id_idx` ON `items` (`category_id`);--> statement-breakpoint
CREATE INDEX `items_location_idx` ON `items` (`location`);--> statement-breakpoint
CREATE TABLE `movements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sku` text NOT NULL,
	`delta` numeric NOT NULL,
	`resulting_qty` numeric NOT NULL,
	`reason` text,
	`project_id` text,
	`reference` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `movements_sku_idx` ON `movements` (`sku`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
