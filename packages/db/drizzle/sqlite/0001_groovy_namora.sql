CREATE INDEX `allocations_project_released_idx` ON `allocations` (`project_id`,`released_at`);--> statement-breakpoint
CREATE INDEX `allocations_sku_released_idx` ON `allocations` (`sku`,`released_at`);--> statement-breakpoint
CREATE INDEX `movements_created_at_idx` ON `movements` (`created_at`);--> statement-breakpoint
CREATE INDEX `movements_sku_created_at_idx` ON `movements` (`sku`,`created_at`);