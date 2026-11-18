import { and, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Db } from '../client.js';
import type { Allocation } from '../schema/index.js';
import {
	allocations as sqliteAllocations,
	items as sqliteItems,
	movements as sqliteMovements,
} from '../schema/sqlite.js';
import {
	allocations as postgresAllocations,
	items as postgresItems,
	movements as postgresMovements,
} from '../schema/postgres.js';
import { roundQty, reservedQuantity } from './items.js';

export class AllocationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AllocationError';
	}
}

export interface CreateAllocationInput {
	projectId: string;
	sku: string;
	quantity: number;
	note?: string | null;
}

/**
 * Set parts aside for a project (plan §3.4). Atomic: available-quantity
 * check + allocation insert + reservation movement row happen in one
 * transaction. Reserving never mutates `quantity_on_hand`.
 *
 * SQLite uses a synchronous transaction (better-sqlite3 v13 requirement);
 * Postgres uses an async one.
 */
export async function createAllocation(db: Db, input: CreateAllocationInput): Promise<Allocation> {
	const quantity = roundQty(input.quantity);
	if (!Number.isFinite(quantity) || quantity <= 0) {
		throw new AllocationError('allocation quantity must be a positive number');
	}
	const now = new Date().toISOString();
	const id = randomUUID();

	if (db.dialect === 'sqlite') {
		let created: Allocation | null = null;
		db.db.transaction((tx) => {
			const onHandRows = tx.select().from(sqliteItems).where(eq(sqliteItems.sku, input.sku)).all();
			if (onHandRows.length === 0) throw new AllocationError(`item not found: ${input.sku}`);
			const reservedRows = tx
				.select()
				.from(sqliteAllocations)
				.where(and(eq(sqliteAllocations.sku, input.sku), isNull(sqliteAllocations.releasedAt)))
				.all();
			const reserved = roundQty(reservedRows.reduce((sum, r) => sum + Number(r.quantity), 0));
			const onHand = Number(onHandRows[0].quantityOnHand);
			const available = roundQty(onHand - reserved);
			if (quantity > available) {
				throw new AllocationError(
					`insufficient available quantity for ${input.sku}: requested ${quantity}, available ${available}`,
				);
			}
			tx.insert(sqliteAllocations)
				.values({
					id,
					projectId: input.projectId,
					sku: input.sku,
					quantity,
					note: input.note ?? null,
					reservedAt: now,
					releasedAt: null,
				})
				.run();
			tx.insert(sqliteMovements)
				.values({
					sku: input.sku,
					delta: 0,
					resultingQty: onHand,
					reason: 'reserved',
					projectId: input.projectId,
					reference: `allocation of ${quantity}`,
					createdAt: now,
				})
				.run();
			created = {
				id,
				projectId: input.projectId,
				sku: input.sku,
				quantity,
				note: input.note ?? null,
				reservedAt: now,
				releasedAt: null,
			};
		});
		if (!created) throw new Error('allocation transaction did not complete');
		return created;
	}

	return db.db.transaction(async (tx) => {
		const onHandRows = await tx
			.select()
			.from(postgresItems)
			.where(eq(postgresItems.sku, input.sku));
		if (onHandRows.length === 0) throw new AllocationError(`item not found: ${input.sku}`);
		const reservedRows = await tx
			.select()
			.from(postgresAllocations)
			.where(and(eq(postgresAllocations.sku, input.sku), isNull(postgresAllocations.releasedAt)));
		const reserved = roundQty(reservedRows.reduce((sum, r) => sum + Number(r.quantity), 0));
		const onHand = Number(onHandRows[0].quantityOnHand);
		const available = roundQty(onHand - reserved);
		if (quantity > available) {
			throw new AllocationError(
				`insufficient available quantity for ${input.sku}: requested ${quantity}, available ${available}`,
			);
		}
		await tx.insert(postgresAllocations).values({
			id,
			projectId: input.projectId,
			sku: input.sku,
			quantity,
			note: input.note ?? null,
			reservedAt: now,
			releasedAt: null,
		});
		await tx.insert(postgresMovements).values({
			sku: input.sku,
			delta: 0,
			resultingQty: onHand,
			reason: 'reserved',
			projectId: input.projectId,
			reference: `allocation of ${quantity}`,
			createdAt: now,
		});
		return {
			id,
			projectId: input.projectId,
			sku: input.sku,
			quantity,
			note: input.note ?? null,
			reservedAt: now,
			releasedAt: null,
		} satisfies Allocation;
	});
}

export async function getAllocation(db: Db, id: string): Promise<Allocation | null> {
	const rows: Allocation[] =
		db.dialect === 'sqlite'
			? await db.db.select().from(sqliteAllocations).where(eq(sqliteAllocations.id, id))
			: await db.db.select().from(postgresAllocations).where(eq(postgresAllocations.id, id));
	return rows[0] ?? null;
}

export async function listProjectAllocations(
	db: Db,
	projectId: string,
	activeOnly = true,
): Promise<Allocation[]> {
	const rows: Allocation[] =
		db.dialect === 'sqlite'
			? await db.db
					.select()
					.from(sqliteAllocations)
					.where(
						activeOnly
							? and(
									eq(sqliteAllocations.projectId, projectId),
									isNull(sqliteAllocations.releasedAt),
								)
							: eq(sqliteAllocations.projectId, projectId),
					)
			: await db.db
					.select()
					.from(postgresAllocations)
					.where(
						activeOnly
							? and(
									eq(postgresAllocations.projectId, projectId),
									isNull(postgresAllocations.releasedAt),
								)
							: eq(postgresAllocations.projectId, projectId),
					);
	return rows;
}

/**
 * Release a set-aside. Atomic: released_at set + item on-hand check.
 */
export async function releaseAllocation(db: Db, id: string): Promise<Allocation> {
	const allocation = await getAllocation(db, id);
	if (!allocation) throw new AllocationError(`allocation not found: ${id}`);
	if (allocation.releasedAt) throw new AllocationError(`allocation ${id} already released`);
	const now = new Date().toISOString();

	if (db.dialect === 'sqlite') {
		let released: Allocation | null = null;
		db.db.transaction((tx) => {
			const itemRows = tx
				.select()
				.from(sqliteItems)
				.where(eq(sqliteItems.sku, allocation.sku))
				.all();
			const onHand = itemRows.length > 0 ? Number(itemRows[0].quantityOnHand) : 0;
			tx.update(sqliteAllocations)
				.set({ releasedAt: now })
				.where(eq(sqliteAllocations.id, id))
				.run();
			tx.insert(sqliteMovements)
				.values({
					sku: allocation.sku,
					delta: 0,
					resultingQty: onHand,
					reason: 'released',
					projectId: allocation.projectId,
					reference: `release of ${allocation.quantity}`,
					createdAt: now,
				})
				.run();
			released = { ...allocation, releasedAt: now };
		});
		if (!released) throw new Error('release transaction did not complete');
		return released;
	}

	return db.db.transaction(async (tx) => {
		const itemRows = await tx
			.select()
			.from(postgresItems)
			.where(eq(postgresItems.sku, allocation.sku));
		const onHand = itemRows.length > 0 ? Number(itemRows[0].quantityOnHand) : 0;
		await tx
			.update(postgresAllocations)
			.set({ releasedAt: now })
			.where(eq(postgresAllocations.id, id));
		await tx.insert(postgresMovements).values({
			sku: allocation.sku,
			delta: 0,
			resultingQty: onHand,
			reason: 'released',
			projectId: allocation.projectId,
			reference: `release of ${allocation.quantity}`,
			createdAt: now,
		});
		return { ...allocation, releasedAt: now } satisfies Allocation;
	});
}

/**
 * Edit an active allocation's quantity, keeping available quantity
 * non-negative.
 */
export async function updateAllocationQuantity(
	db: Db,
	id: string,
	quantity: number,
): Promise<Allocation> {
	const allocation = await getAllocation(db, id);
	if (!allocation) throw new AllocationError(`allocation not found: ${id}`);
	if (allocation.releasedAt) throw new AllocationError(`allocation ${id} is already released`);
	const newQuantity = roundQty(quantity);
	if (!Number.isFinite(newQuantity) || newQuantity <= 0) {
		throw new AllocationError('allocation quantity must be a positive number');
	}
	const reserved = await reservedQuantity(db, allocation.sku);
	const othersReserved = roundQty(reserved - allocation.quantity);
	const onHandRows: { quantityOnHand: number }[] =
		db.dialect === 'sqlite'
			? await db.db.select().from(sqliteItems).where(eq(sqliteItems.sku, allocation.sku))
			: await db.db.select().from(postgresItems).where(eq(postgresItems.sku, allocation.sku));
	if (onHandRows.length === 0) throw new AllocationError(`item not found: ${allocation.sku}`);
	const available = roundQty(Number(onHandRows[0].quantityOnHand) - othersReserved);
	if (newQuantity > available) {
		throw new AllocationError(
			`insufficient available quantity for ${allocation.sku}: requested ${newQuantity}, available ${available}`,
		);
	}
	if (db.dialect === 'sqlite') {
		await db.db
			.update(sqliteAllocations)
			.set({ quantity: newQuantity })
			.where(eq(sqliteAllocations.id, id));
	} else {
		await db.db
			.update(postgresAllocations)
			.set({ quantity: newQuantity })
			.where(eq(postgresAllocations.id, id));
	}
	return { ...allocation, quantity: newQuantity };
}
