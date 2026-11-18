import { sql } from 'drizzle-orm';
import { check, index, integer, numeric, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const categories = sqliteTable('categories', {
	id: text('id').primaryKey(),
	name: text('name').notNull().unique(),
	description: text('description'),
	fieldSchema: text('field_schema').notNull(),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
});

export const items = sqliteTable(
	'items',
	{
		sku: text('sku').primaryKey(),
		categoryId: text('category_id')
			.notNull()
			.references(() => categories.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		description: text('description'),
		unit: text('unit'),
		quantityOnHand: numeric('quantity_on_hand', { mode: 'number' }).notNull().default(0),
		unitCost: numeric('unit_cost', { mode: 'number' }),
		location: text('location'),
		data: text('data'),
		createdAt: text('created_at').notNull(),
		updatedAt: text('updated_at').notNull(),
	},
	(t) => [
		index('items_category_id_idx').on(t.categoryId),
		index('items_location_idx').on(t.location),
	],
);

export const projects = sqliteTable('projects', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	description: text('description'),
	status: text('status').notNull().default('active'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
});

export const allocations = sqliteTable(
	'allocations',
	{
		id: text('id').primaryKey(),
		projectId: text('project_id')
			.notNull()
			.references(() => projects.id, { onDelete: 'cascade' }),
		sku: text('sku')
			.notNull()
			.references(() => items.sku, { onDelete: 'cascade' }),
		quantity: numeric('quantity', { mode: 'number' }).notNull(),
		note: text('note'),
		reservedAt: text('reserved_at').notNull(),
		releasedAt: text('released_at'),
	},
	(t) => [
		index('allocations_project_id_idx').on(t.projectId),
		index('allocations_sku_idx').on(t.sku),
		index('allocations_project_released_idx').on(t.projectId, t.releasedAt),
		index('allocations_sku_released_idx').on(t.sku, t.releasedAt),
		check('allocations_quantity_positive', sql`quantity > 0`),
	],
);

export const movements = sqliteTable(
	'movements',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		sku: text('sku').notNull(),
		delta: numeric('delta', { mode: 'number' }).notNull(),
		resultingQty: numeric('resulting_qty', { mode: 'number' }).notNull(),
		reason: text('reason'),
		projectId: text('project_id'),
		reference: text('reference'),
		createdAt: text('created_at').notNull(),
	},
	(t) => [
		index('movements_sku_idx').on(t.sku),
		index('movements_created_at_idx').on(t.createdAt),
		index('movements_sku_created_at_idx').on(t.sku, t.createdAt),
	],
);
