import { and, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Db } from '../client.js';
import type { Allocation } from '../schema/index.js';
import {
	allocations as sqliteAllocations,
	items as sqliteItems,
	movements as sqliteMovements,
	projects as sqliteProjects,
} from '../schema/sqlite.js';
import {
	allocations as postgresAllocations,
	items as postgresItems,
	movements as postgresMovements,
	projects as postgresProjects,
} from '../schema/postgres.js';
import { NotFoundError, roundQty } from './items.js';

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

function assertPositiveQuantity(quantity: number): number {
	const q = roundQty(quantity);
	if (!Number.isFinite(q) || q <= 0) {
		throw new AllocationError('allocation quantity must be a positive number');
	}
	return q;
}

async function assertProjectExists(db: Db, projectId: string): Promise<void> {
	const rows =
		db.dialect === 'sqlite'
			? await db.db
					.select({ id: sqliteProjects.id })
					.from(sqliteProjects)
					.where(eq(sqliteProjects.id, projectId))
			: await db.db
					.select({ id: postgresProjects.id })
					.from(postgresProjects)
					.where(eq(postgresProjects.id, projectId));
	if (rows.length === 0) throw new NotFoundError('project', projectId);
}

/**
 * Set parts aside for a project (plan §3.4). Atomic: available-quantity
 * check + allocation insert + reservation movement row happen in one
 * transaction. Reserving never mutates `quantity_on_hand`.
 *
 * SQLite uses a synchronous transaction (better-sqlite3 v13 requirement).
 * Postgres locks the item row (FOR UPDATE) so concurrent allocations for
 * the same SKU cannot both observe the same available quantity.
 */
export async function createAllocation(db: Db, input: CreateAllocationInput): Promise<Allocation> {
	await assertProjectExists(db, input.projectId);
	const quantity = assertPositiveQuantity(input.quantity);
	const now = new Date().toISOString();
	const id = randomUUID();

	if (db.dialect === 'sqlite') {
		let created: Allocation | null = null;
		db.db.transaction((tx) => {
			const onHandRows = tx.select().from(sqliteItems).where(eq(sqliteItems.sku, input.sku)).all();
			if (onHandRows.length === 0) throw new NotFoundError('item', input.sku);
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
			.where(eq(postgresItems.sku, input.sku))
			.for('update');
		if (onHandRows.length === 0) throw new NotFoundError('item', input.sku);
		const reservedRows = await tx
			.select()
			.from(postgresAllocations)
			.where(and(eq(postgresAllocations.sku, input.sku), isNull(postgresAllocations.releasedAt)))
			.for('update');
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

/** Release a set-aside (plan §3.4). Records a `released` movement row. */
export async function releaseAllocation(db: Db, id: string): Promise<Allocation> {
	const now = new Date().toISOString();

	if (db.dialect === 'sqlite') {
		let released: Allocation | null = null;
		db.db.transaction((tx) => {
			const rows = tx.select().from(sqliteAllocations).where(eq(sqliteAllocations.id, id)).all();
			const allocation = rows[0] as Allocation | undefined;
			if (!allocation) throw new NotFoundError('allocation', id);
			if (allocation.releasedAt) throw new AllocationError(`allocation ${id} already released`);
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
		const rows = await tx
			.select()
			.from(postgresAllocations)
			.where(eq(postgresAllocations.id, id))
			.for('update');
		const allocation = rows[0] as Allocation | undefined;
		if (!allocation) throw new NotFoundError('allocation', id);
		if (allocation.releasedAt) throw new AllocationError(`allocation ${id} already released`);
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
 * non-negative. Runs in a transaction so the available-qty check and
 * update are atomic.
 */
export async function updateAllocationQuantity(
	db: Db,
	id: string,
	quantity: number,
): Promise<Allocation> {
	const newQuantity = assertPositiveQuantity(quantity);

	if (db.dialect === 'sqlite') {
		let updated: Allocation | null = null;
		db.db.transaction((tx) => {
			const rows = tx.select().from(sqliteAllocations).where(eq(sqliteAllocations.id, id)).all();
			const allocation = rows[0] as Allocation | undefined;
			if (!allocation) throw new NotFoundError('allocation', id);
			if (allocation.releasedAt) throw new AllocationError(`allocation ${id} is already released`);
			const itemRows = tx
				.select()
				.from(sqliteItems)
				.where(eq(sqliteItems.sku, allocation.sku))
				.all();
			if (itemRows.length === 0) throw new NotFoundError('item', allocation.sku);
			const reservedRows = tx
				.select()
				.from(sqliteAllocations)
				.where(and(eq(sqliteAllocations.sku, allocation.sku), isNull(sqliteAllocations.releasedAt)))
				.all();
			const reserved = roundQty(reservedRows.reduce((sum, r) => sum + Number(r.quantity), 0));
			const othersReserved = roundQty(reserved - Number(allocation.quantity));
			const available = roundQty(Number(itemRows[0].quantityOnHand) - othersReserved);
			if (newQuantity > available) {
				throw new AllocationError(
					`insufficient available quantity for ${allocation.sku}: requested ${newQuantity}, available ${available}`,
				);
			}
			tx.update(sqliteAllocations)
				.set({ quantity: newQuantity })
				.where(eq(sqliteAllocations.id, id))
				.run();
			updated = { ...allocation, quantity: newQuantity };
		});
		if (!updated) throw new Error('allocation update did not complete');
		return updated;
	}

	return db.db.transaction(async (tx) => {
		const rows = await tx
			.select()
			.from(postgresAllocations)
			.where(eq(postgresAllocations.id, id))
			.for('update');
		const allocation = rows[0] as Allocation | undefined;
		if (!allocation) throw new NotFoundError('allocation', id);
		if (allocation.releasedAt) throw new AllocationError(`allocation ${id} is already released`);
		const itemRows = await tx
			.select()
			.from(postgresItems)
			.where(eq(postgresItems.sku, allocation.sku))
			.for('update');
		if (itemRows.length === 0) throw new NotFoundError('item', allocation.sku);
		const reservedRows = await tx
			.select()
			.from(postgresAllocations)
			.where(
				and(eq(postgresAllocations.sku, allocation.sku), isNull(postgresAllocations.releasedAt)),
			)
			.for('update');
		const reserved = roundQty(reservedRows.reduce((sum, r) => sum + Number(r.quantity), 0));
		const othersReserved = roundQty(reserved - Number(allocation.quantity));
		const available = roundQty(Number(itemRows[0].quantityOnHand) - othersReserved);
		if (newQuantity > available) {
			throw new AllocationError(
				`insufficient available quantity for ${allocation.sku}: requested ${newQuantity}, available ${available}`,
			);
		}
		await tx
			.update(postgresAllocations)
			.set({ quantity: newQuantity })
			.where(eq(postgresAllocations.id, id));
		return { ...allocation, quantity: newQuantity } satisfies Allocation;
	});
}
