CREATE INDEX "allocations_project_released_idx" ON "allocations" USING btree ("project_id","released_at");--> statement-breakpoint
CREATE INDEX "allocations_sku_released_idx" ON "allocations" USING btree ("sku","released_at");--> statement-breakpoint
CREATE INDEX "movements_created_at_idx" ON "movements" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "movements_sku_created_at_idx" ON "movements" USING btree ("sku","created_at");