import { and, eq, gte, isNull } from 'drizzle-orm';
import { decodeJson } from '../dialect.js';
import { skuSchema, validateItemData, type FieldSchema } from '../field-schema.js';
import type { Db } from '../client.js';
import type { Item, Movement, MovementReason } from '../schema/index.js';
import {
	items as sqliteItems,
	movements as sqliteMovements,
	allocations as sqliteAllocations,
} from '../schema/sqlite.js';
import {
	items as postgresItems,
	movements as postgresMovements,
	allocations as postgresAllocations,
} from '../schema/postgres.js';
import { ConflictError, isUniqueViolation } from '../errors.js';
import { getCategory } from './categories.js';

export class NotFoundError extends Error {
	constructor(entity: string, id: string) {
		super(`${entity} not found: ${id}`);
		this.name = 'NotFoundError';
	}
}

export class InsufficientQuantityError extends Error {
	constructor(sku: string, resulting: number, onHand: number) {
		super(
			`insufficient quantity for ${sku}: would result in ${resulting} on hand (currently ${onHand})`,
		);
		this.name = 'InsufficientQuantityError';
	}
}

/** Item cannot be deleted: stock still on hand or parts still reserved. */
export class DeleteBlockedError extends Error {
	constructor(sku: string, reason: string) {
		super(`cannot delete ${sku}: ${reason}`);
		this.name = 'DeleteBlockedError';
	}
}

/** Round to 3 decimals to match NUMERIC(18,3). */
export function roundQty(value: number): number {
	return Math.round(value * 1000) / 1000;
}

type RawItemRow = {
	sku: string;
	categoryId: string;
	name: string;
	description: string | null;
	unit: string | null;
	quantityOnHand: number;
	unitCost: number | null;
	location: string | null;
	data: unknown;
	createdAt: string;
	updatedAt: string;
};

function normalizeItem(db: Db, row: RawItemRow): Item {
	return {
		sku: row.sku,
		categoryId: row.categoryId,
		name: row.name,
		description: row.description,
		unit: row.unit,
		quantityOnHand: roundQty(Number(row.quantityOnHand)),
		unitCost: row.unitCost === null || row.unitCost === undefined ? null : Number(row.unitCost),
		location: row.location,
		data: decodeJson<Record<string, unknown>>(db, row.data),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

async function fetchItem(db: Db, sku: string): Promise<Item | null> {
	const rows: RawItemRow[] =
		db.dialect === 'sqlite'
			? await db.db.select().from(sqliteItems).where(eq(sqliteItems.sku, sku))
			: await db.db.select().from(postgresItems).where(eq(postgresItems.sku, sku));
	const row = rows[0];
	return row ? normalizeItem(db, row) : null;
}

export interface CreateItemInput {
	sku: string;
	categoryId: string;
	name: string;
	description?: string | null;
	unit?: string | null;
	unitCost?: number | null;
	location?: string | null;
	data?: Record<string, unknown> | null;
}

export interface UpdateItemInput {
	categoryId?: string;
	name?: string;
	description?: string | null;
	unit?: string | null;
	unitCost?: number | null;
	location?: string | null;
	data?: Record<string, unknown> | null;
}

export interface MoveItemInput {
	sku: string;
	delta: number;
	reason: Extract<MovementReason, 'received' | 'used' | 'adjusted' | 'counted'>;
	projectId?: string | null;
	reference?: string | null;
}

export interface MoveResult {
	item: Item;
	movement: Movement;
}

export interface ListItemOptions {
	limit?: number;
	offset?: number;
	categoryId?: string;
	/** Only items with quantity on hand >= minQty. */
	minQty?: number;
}

export async function listItem(db: Db, opts?: ListItemOptions): Promise<Item[]> {
	const limit = opts?.limit ?? 100;
	const offset = opts?.offset ?? 0;
	if (db.dialect === 'sqlite') {
		const conds = [
			opts?.categoryId ? eq(sqliteItems.categoryId, opts.categoryId) : undefined,
			opts?.minQty !== undefined ? gte(sqliteItems.quantityOnHand, opts.minQty) : undefined,
		];
		const rows: RawItemRow[] = await db.db
			.select()
			.from(sqliteItems)
			.where(and(...conds))
			.limit(limit)
			.offset(offset);
		return rows.map((r) => normalizeItem(db, r));
	}
	const conds = [
		opts?.categoryId ? eq(postgresItems.categoryId, opts.categoryId) : undefined,
		opts?.minQty !== undefined ? gte(postgresItems.quantityOnHand, opts.minQty) : undefined,
	];
	const rows: RawItemRow[] = await db.db
		.select()
		.from(postgresItems)
		.where(and(...conds))
		.limit(limit)
		.offset(offset);
	return rows.map((r) => normalizeItem(db, r));
}

export async function getItem(db: Db, sku: string): Promise<Item | null> {
	return fetchItem(db, sku);
}

/** Quantity reserved by active allocations for a SKU. */
export async function reservedQuantity(db: Db, sku: string): Promise<number> {
	const rows: { quantity: number }[] =
		db.dialect === 'sqlite'
			? await db.db
					.select()
					.from(sqliteAllocations)
					.where(and(eq(sqliteAllocations.sku, sku), isNull(sqliteAllocations.releasedAt)))
			: await db.db
					.select()
					.from(postgresAllocations)
					.where(and(eq(postgresAllocations.sku, sku), isNull(postgresAllocations.releasedAt)));
	return roundQty(rows.reduce((sum, r) => sum + Number(r.quantity), 0));
}

/** `available(sku) = quantity_on_hand - SUM(active allocations)` (plan §3.4). */
export async function availableQuantity(db: Db, sku: string): Promise<number> {
	const item = await fetchItem(db, sku);
	if (!item) throw new NotFoundError('item', sku);
	return roundQty(item.quantityOnHand - (await reservedQuantity(db, sku)));
}

async function fetchCategoryFieldSchema(db: Db, categoryId: string): Promise<FieldSchema> {
	const category = await getCategory(db, categoryId);
	if (!category) throw new NotFoundError('category', categoryId);
	return category.fieldSchema;
}

export async function createItem(db: Db, input: CreateItemInput): Promise<Item> {
	const sku = skuSchema.parse(input.sku);
	const category = await fetchCategoryFieldSchema(db, input.categoryId);
	const data =
		input.data === null || input.data === undefined ? null : validateItemData(category, input.data);
	const now = new Date().toISOString();

	try {
		if (db.dialect === 'sqlite') {
			await db.db.insert(sqliteItems).values({
				sku,
				categoryId: input.categoryId,
				name: input.name,
				description: input.description ?? null,
				unit: input.unit ?? null,
				quantityOnHand: 0,
				unitCost: input.unitCost ?? null,
				location: input.location ?? null,
				data: data === null ? null : JSON.stringify(data),
				createdAt: now,
				updatedAt: now,
			});
		} else {
			await db.db.insert(postgresItems).values({
				sku,
				categoryId: input.categoryId,
				name: input.name,
				description: input.description ?? null,
				unit: input.unit ?? null,
				quantityOnHand: 0,
				unitCost: input.unitCost ?? null,
				location: input.location ?? null,
				data,
				createdAt: now,
				updatedAt: now,
			});
		}
	} catch (err) {
		if (isUniqueViolation(db, err)) throw new ConflictError('item', sku);
		throw err;
	}
	const created = await fetchItem(db, sku);
	if (!created) throw new Error(`item ${sku} not found after insert`);
	return created;
}

export async function updateItem(db: Db, sku: string, input: UpdateItemInput): Promise<Item> {
	const current = await fetchItem(db, sku);
	if (!current) throw new NotFoundError('item', sku);

	const categoryId = input.categoryId ?? current.categoryId;
	const category = await fetchCategoryFieldSchema(db, categoryId);
	const data =
		input.data !== undefined ? validateItemData(category, input.data ?? {}) : current.data;
	const now = new Date().toISOString();

	const values = {
		categoryId,
		name: input.name ?? current.name,
		description: input.description !== undefined ? input.description : current.description,
		unit: input.unit !== undefined ? input.unit : current.unit,
		unitCost: input.unitCost !== undefined ? input.unitCost : current.unitCost,
		location: input.location !== undefined ? input.location : current.location,
		updatedAt: now,
	};

	if (db.dialect === 'sqlite') {
		await db.db
			.update(sqliteItems)
			.set({ ...values, data: data === null ? null : JSON.stringify(data) })
			.where(eq(sqliteItems.sku, sku));
	} else {
		await db.db
			.update(postgresItems)
			.set({ ...values, data: data ?? null })
			.where(eq(postgresItems.sku, sku));
	}
	const updated = await fetchItem(db, sku);
	if (!updated) throw new Error(`item ${sku} not found after update`);
	return updated;
}

/**
 * Delete an item. Only allowed when qty on hand is 0 and there are no
 * active allocations (plan §5).
 */
export async function deleteItem(db: Db, sku: string): Promise<void> {
	const item = await fetchItem(db, sku);
	if (!item) throw new NotFoundError('item', sku);
	if (item.quantityOnHand !== 0) {
		throw new DeleteBlockedError(sku, `quantity on hand is ${item.quantityOnHand}`);
	}
	const reserved = await reservedQuantity(db, sku);
	if (reserved !== 0) {
		throw new DeleteBlockedError(sku, `${reserved} unit(s) still reserved`);
	}
	if (db.dialect === 'sqlite') {
		await db.db.delete(sqliteItems).where(eq(sqliteItems.sku, sku));
	} else {
		await db.db.delete(postgresItems).where(eq(postgresItems.sku, sku));
	}
}

/**
 * Atomic quantity change (plan §5 transaction rule): item read, on-hand
 * update, and movement row insert happen in one transaction. On-hand may
 * not go negative. In v1 this does not consult reservations (an operator
 * can use reserved stock after releasing it); the API layer (M2) may
 * additionally restrict `used` to the available quantity.
 *
 * SQLite: better-sqlite3 v13 requires synchronous transaction functions,
 * so the work uses the sync builder terminals (.get/.run). Postgres: async
 * transaction with awaited builders.
 */
export async function moveItem(db: Db, input: MoveItemInput): Promise<MoveResult> {
	const { sku, delta, reason, projectId, reference } = input;
	if (!Number.isFinite(delta) || delta === 0) {
		throw new Error('delta must be a non-zero finite number');
	}
	const now = new Date().toISOString();

	if (db.dialect === 'sqlite') {
		let result: MoveResult | null = null;
		db.db.transaction((tx) => {
			const row = tx.select().from(sqliteItems).where(eq(sqliteItems.sku, sku)).get();
			if (!row) throw new NotFoundError('item', sku);
			const onHand = Number(row.quantityOnHand);
			const next = roundQty(onHand + delta);
			if (next < 0) throw new InsufficientQuantityError(sku, next, onHand);
			tx.update(sqliteItems)
				.set({ quantityOnHand: next, updatedAt: now })
				.where(eq(sqliteItems.sku, sku))
				.run();
			const ins = tx
				.insert(sqliteMovements)
				.values({
					sku,
					delta,
					resultingQty: next,
					reason,
					projectId: projectId ?? null,
					reference: reference ?? null,
					createdAt: now,
				})
				.run();
			result = {
				item: normalizeItem(db, { ...row, quantityOnHand: next, updatedAt: now }),
				movement: {
					id: Number(ins.lastInsertRowid),
					sku,
					delta,
					resultingQty: next,
					reason,
					projectId: projectId ?? null,
					reference: reference ?? null,
					createdAt: now,
				},
			};
		});
		if (!result) throw new Error('moveItem transaction did not complete');
		return result;
	}

	return db.db.transaction(async (tx) => {
		const rows = await tx.select().from(postgresItems).where(eq(postgresItems.sku, sku));
		const row = rows[0];
		if (!row) throw new NotFoundError('item', sku);
		const onHand = Number(row.quantityOnHand);
		const next = roundQty(onHand + delta);
		if (next < 0) throw new InsufficientQuantityError(sku, next, onHand);
		await tx
			.update(postgresItems)
			.set({ quantityOnHand: next, updatedAt: now })
			.where(eq(postgresItems.sku, sku));
		const inserted = await tx
			.insert(postgresMovements)
			.values({
				sku,
				delta,
				resultingQty: next,
				reason,
				projectId: projectId ?? null,
				reference: reference ?? null,
				createdAt: now,
			})
			.returning();
		return {
			item: normalizeItem(db, { ...row, quantityOnHand: next, updatedAt: now }),
			movement: {
				id: Number(inserted[0]?.id ?? 0),
				sku,
				delta,
				resultingQty: next,
				reason,
				projectId: projectId ?? null,
				reference: reference ?? null,
				createdAt: now,
			},
		};
	});
}

/**
 * Record a reservation event. Reserving never mutates `quantity_on_hand`
 * (plan §3.4); this row keeps the item history complete with delta 0.
 */
export async function recordReservationEvent(
	db: Db,
	kind: 'reserved' | 'released',
	sku: string,
	projectId: string,
	quantity: number,
): Promise<void> {
	const item = await fetchItem(db, sku);
	if (!item) throw new NotFoundError('item', sku);
	const now = new Date().toISOString();
	const reference = kind === 'reserved' ? `allocation of ${quantity}` : `release of ${quantity}`;
	if (db.dialect === 'sqlite') {
		await db.db.insert(sqliteMovements).values({
			sku,
			delta: 0,
			resultingQty: item.quantityOnHand,
			reason: kind,
			projectId,
			reference,
			createdAt: now,
		});
	} else {
		await db.db.insert(postgresMovements).values({
			sku,
			delta: 0,
			resultingQty: item.quantityOnHand,
			reason: kind,
			projectId,
			reference,
			createdAt: now,
		});
	}
}

export async function listMovements(
	db: Db,
	sku: string,
	opts?: { limit?: number; offset?: number },
): Promise<Movement[]> {
	const limit = opts?.limit ?? 100;
	const offset = opts?.offset ?? 0;
	const rows =
		db.dialect === 'sqlite'
			? await db.db
					.select()
					.from(sqliteMovements)
					.where(eq(sqliteMovements.sku, sku))
					.orderBy(sqliteMovements.id)
					.limit(limit)
					.offset(offset)
			: await db.db
					.select()
					.from(postgresMovements)
					.where(eq(postgresMovements.sku, sku))
					.orderBy(postgresMovements.id)
					.limit(limit)
					.offset(offset);
	return rows.map((r) => ({
		...r,
		delta: Number(r.delta),
		resultingQty: Number(r.resultingQty),
		reason: r.reason as MovementReason | null,
	}));
}
