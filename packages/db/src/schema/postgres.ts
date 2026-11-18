import { sql } from 'drizzle-orm';
import {
	bigint,
	check,
	index,
	jsonb,
	numeric,
	pgTable,
	text,
	timestamp,
} from 'drizzle-orm/pg-core';

export const categories = pgTable('categories', {
	id: text('id').primaryKey(),
	name: text('name').notNull().unique(),
	description: text('description'),
	fieldSchema: jsonb('field_schema').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
});

export const items = pgTable(
	'items',
	{
		sku: text('sku').primaryKey(),
		categoryId: text('category_id')
			.notNull()
			.references(() => categories.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		description: text('description'),
		unit: text('unit'),
		quantityOnHand: numeric('quantity_on_hand', { precision: 18, scale: 3, mode: 'number' })
			.notNull()
			.default(0),
		unitCost: numeric('unit_cost', { precision: 12, scale: 4, mode: 'number' }),
		location: text('location'),
		data: jsonb('data'),
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
	},
	(t) => [
		index('items_category_id_idx').on(t.categoryId),
		index('items_location_idx').on(t.location),
	],
);

export const projects = pgTable('projects', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	description: text('description'),
	status: text('status').notNull().default('active'),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
});

export const allocations = pgTable(
	'allocations',
	{
		id: text('id').primaryKey(),
		projectId: text('project_id')
			.notNull()
			.references(() => projects.id, { onDelete: 'cascade' }),
		sku: text('sku')
			.notNull()
			.references(() => items.sku, { onDelete: 'cascade' }),
		quantity: numeric('quantity', { precision: 18, scale: 3, mode: 'number' }).notNull(),
		note: text('note'),
		reservedAt: timestamp('reserved_at', { withTimezone: true, mode: 'string' }).notNull(),
		releasedAt: timestamp('released_at', { withTimezone: true, mode: 'string' }),
	},
	(t) => [
		index('allocations_project_id_idx').on(t.projectId),
		index('allocations_sku_idx').on(t.sku),
		check('allocations_quantity_positive', sql`quantity > 0`),
	],
);

export const movements = pgTable(
	'movements',
	{
		id: bigint('id', { mode: 'number' }).generatedByDefaultAsIdentity().primaryKey(),
		sku: text('sku').notNull(),
		delta: numeric('delta', { precision: 18, scale: 3, mode: 'number' }).notNull(),
		resultingQty: numeric('resulting_qty', { precision: 18, scale: 3, mode: 'number' }).notNull(),
		reason: text('reason'),
		projectId: text('project_id'),
		reference: text('reference'),
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
	},
	(t) => [index('movements_sku_idx').on(t.sku)],
);
