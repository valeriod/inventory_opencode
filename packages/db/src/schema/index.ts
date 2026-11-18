import type { FieldSchema } from '../field-schema.js';

/**
 * Dialect-normalized domain rows. Timestamps are ISO-8601 UTC strings on
 * both engines; quantities are numbers; JSON blobs are parsed objects.
 */

export interface Category {
	id: string;
	name: string;
	description: string | null;
	fieldSchema: FieldSchema;
	createdAt: string;
	updatedAt: string;
}

export interface Item {
	sku: string;
	categoryId: string;
	name: string;
	description: string | null;
	unit: string | null;
	quantityOnHand: number;
	unitCost: number | null;
	location: string | null;
	data: Record<string, unknown> | null;
	createdAt: string;
	updatedAt: string;
}

export interface Project {
	id: string;
	name: string;
	description: string | null;
	status: 'active' | 'closed';
	createdAt: string;
	updatedAt: string;
}

export interface Allocation {
	id: string;
	projectId: string;
	sku: string;
	quantity: number;
	note: string | null;
	reservedAt: string;
	releasedAt: string | null;
}

export const MOVEMENT_REASONS = [
	'received',
	'used',
	'reserved',
	'released',
	'adjusted',
	'counted',
] as const;
export type MovementReason = (typeof MOVEMENT_REASONS)[number];

export interface Movement {
	id: number;
	sku: string;
	delta: number;
	resultingQty: number;
	reason: MovementReason | null;
	projectId: string | null;
	reference: string | null;
	createdAt: string;
}

import * as sqliteSchema from './sqlite.js';
import * as postgresSchema from './postgres.js';

export { sqliteSchema, postgresSchema };
export type SqliteTables = typeof sqliteSchema;
export type PostgresTables = typeof postgresSchema;
