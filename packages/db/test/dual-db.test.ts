import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import {
	createDb,
	closeDb,
	runMigrations,
	seedCategories,
	fieldSchemaList,
	listCategories,
	getCategory,
	getCategoryByName,
	createCategory,
	updateCategory,
	createItem,
	getItem,
	moveItem,
	deleteItem,
	listMovements,
	createProject,
	createAllocation,
	releaseAllocation,
	listProjectAllocations,
	availableQuantity,
	reservedQuantity,
	InsufficientQuantityError,
	AllocationError,
	type Db,
} from '../src/index.js';

interface TestEnv {
	db: Db;
	teardown: () => Promise<void>;
}

const EXPECTED_TABLES = ['categories', 'items', 'projects', 'allocations', 'movements'];

async function createSqliteEnv(): Promise<TestEnv> {
	const dir = mkdtempSync(path.join(tmpdir(), 'inventory-sqlite-'));
	const file = path.join(dir, 'test.db');
	const db = createDb(`file:${file}`);
	await runMigrations(db);
	return {
		db,
		teardown: async () => {
			await closeDb(db);
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

const POSTGRES_ADMIN_URL =
	process.env.TEST_POSTGRES_URL ?? 'postgres://inventory:inventory@localhost:5432/postgres';

async function createPostgresEnv(): Promise<TestEnv> {
	const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
	const dbName = `inventory_test_${suffix}`.slice(0, 40);
	const admin = postgres(POSTGRES_ADMIN_URL, { max: 1, onnotice: () => {} });
	await admin.unsafe(`CREATE DATABASE ${dbName}`);
	await admin.end();
	const scratchUrl = new URL(POSTGRES_ADMIN_URL);
	scratchUrl.pathname = `/${dbName}`;
	const db = createDb(scratchUrl.toString());
	await runMigrations(db);
	return {
		db,
		teardown: async () => {
			await closeDb(db);
			const drop = postgres(POSTGRES_ADMIN_URL, { max: 1, onnotice: () => {} });
			await drop.unsafe(`DROP DATABASE ${dbName}`);
			await drop.end();
		},
	};
}

async function tablesIn(env: TestEnv): Promise<string[]> {
	if (env.db.dialect === 'sqlite') {
		const rows: { name: string }[] = env.db.db.$client
			.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
			.all() as { name: string }[];
		return rows.map((r) => r.name);
	}
	// pg migrator keeps its tracking table in the `drizzle` schema
	const rows: { table_name: string; table_schema: string }[] = await env.db.db.$client`
		SELECT table_name, table_schema FROM information_schema.tables
		WHERE table_schema IN ('public', 'drizzle')
	`;
	return rows.map((r) => (r.table_schema === 'drizzle' ? `drizzle.${r.table_name}` : r.table_name));
}

/** The whole M1 suite, parameterized by engine (plan §8). */
function suite(engine: string, makeEnv: () => Promise<TestEnv>) {
	describe(`[db: ${engine}]`, () => {
		it('migrations apply cleanly and create all tables', async () => {
			const env = await makeEnv();
			try {
				const tables = await tablesIn(env);
				for (const t of EXPECTED_TABLES) expect(tables, `missing table ${t}`).toContain(t);
				expect(
					tables.some((t) => t === '__drizzle_migrations' || t === 'drizzle.__drizzle_migrations'),
				).toBe(true);
				// migrations are idempotent — running again must be a no-op
				await runMigrations(env.db);
			} finally {
				await env.teardown();
			}
		});

		it('seeds the 10 default categories (idempotently)', async () => {
			const env = await makeEnv();
			try {
				const first = await seedCategories(env.db);
				expect(first.inserted).toBe(10);
				expect(first.skipped).toBe(0);
				const second = await seedCategories(env.db);
				expect(second.inserted).toBe(0);
				expect(second.skipped).toBe(10);

				const cats = await listCategories(env.db);
				expect(cats).toHaveLength(10);
				for (const cat of cats) {
					// stored field schema round-trips through Zod validation
					fieldSchemaList.parse(cat.fieldSchema);
					expect(cat.fieldSchema.length).toBeGreaterThan(0);
				}
				const resistors = await getCategoryByNameOrThrow(env.db, 'Resistors');
				expect(resistors.fieldSchema.some((f) => f.key === 'value' && f.searchable)).toBe(true);
			} finally {
				await env.teardown();
			}
		});

		it('category CRUD works', async () => {
			const env = await makeEnv();
			try {
				await seedCategories(env.db);
				const created = await createCategory(env.db, {
					name: 'Batteries',
					description: 'Cells and packs',
					fieldSchema: [
						{
							key: 'chemistry',
							label: 'Chemistry',
							type: 'select',
							options: ['li-ion', 'aa', 'aaa'],
						},
						{ key: 'voltage', label: 'Voltage', type: 'number', required: true, unit: 'V', min: 0 },
					],
				});
				expect(created.id).toBeTruthy();
				expect(created.fieldSchema).toHaveLength(2);

				const fetched = await getCategory(env.db, created.id);
				expect(fetched?.name).toBe('Batteries');

				const updated = await updateCategory(env.db, created.id, {
					fieldSchema: [
						{
							key: 'chemistry',
							label: 'Chemistry',
							type: 'select',
							options: ['li-ion', 'aa', 'aaa'],
						},
						{ key: 'voltage', label: 'Voltage', type: 'number', required: true, unit: 'V', min: 0 },
						{ key: 'capacity', label: 'Capacity', type: 'number', unit: 'mAh', min: 0 },
					],
				});
				expect(updated.fieldSchema).toHaveLength(3);
			} finally {
				await env.teardown();
			}
		});

		it('item creation validates custom fields against the category schema', async () => {
			const env = await makeEnv();
			try {
				await seedCategories(env.db);
				const resistors = await getCategoryByNameOrThrow(env.db, 'Resistors');

				const item = await createItem(env.db, {
					sku: 'RES-10K-1%',
					categoryId: resistors.id,
					name: '10kΩ resistor 1%',
					unit: 'pc',
					location: 'A3-12',
					data: { value: 10000, tolerance: '1%', package: '0805' },
				});
				expect(item.quantityOnHand).toBe(0);
				expect(item.data?.value).toBe(10000);

				// unknown field rejected
				await expect(
					createItem(env.db, {
						sku: 'RES-BAD-01',
						categoryId: resistors.id,
						name: 'x',
						data: { value: 1, notAField: true },
					}),
				).rejects.toThrow(/notAField/);

				// wrong type rejected
				await expect(
					createItem(env.db, {
						sku: 'RES-BAD-02',
						categoryId: resistors.id,
						name: 'x',
						data: { value: 'not-a-number' },
					}),
				).rejects.toThrow(/value/);

				// bad SKU rejected
				await expect(
					createItem(env.db, {
						sku: 'bad sku!',
						categoryId: resistors.id,
						name: 'x',
					}),
				).rejects.toThrow(/SKU/);
			} finally {
				await env.teardown();
			}
		});

		it('move updates on-hand and appends movements atomically', async () => {
			const env = await makeEnv();
			try {
				await seedCategories(env.db);
				const resistors = await getCategoryByNameOrThrow(env.db, 'Resistors');
				await createItem(env.db, {
					sku: 'RES-10K-1%',
					categoryId: resistors.id,
					name: '10kΩ resistor 1%',
					unit: 'pc',
				});

				const received = await moveItem(env.db, {
					sku: 'RES-10K-1%',
					delta: 10,
					reason: 'received',
					reference: 'PO-123',
				});
				expect(received.item.quantityOnHand).toBe(10);
				expect(received.movement.resultingQty).toBe(10);
				expect(received.movement.reason).toBe('received');

				const used = await moveItem(env.db, { sku: 'RES-10K-1%', delta: -3, reason: 'used' });
				expect(used.item.quantityOnHand).toBe(7);

				// going negative is rejected, on-hand unchanged
				await expect(
					moveItem(env.db, { sku: 'RES-10K-1%', delta: -100, reason: 'used' }),
				).rejects.toThrow(InsufficientQuantityError);
				expect((await getItem(env.db, 'RES-10K-1%'))?.quantityOnHand).toBe(7);

				const movements = await listMovements(env.db, 'RES-10K-1%');
				expect(movements).toHaveLength(2);
				// newest-first ordering
				expect(movements.map((m) => m.reason)).toEqual(['used', 'received']);
				expect(movements[0].resultingQty).toBe(7);
			} finally {
				await env.teardown();
			}
		});

		it('quantities round to 3 decimals on both engines', async () => {
			const env = await makeEnv();
			try {
				await seedCategories(env.db);
				const wire = await getCategoryByNameOrThrow(env.db, 'Wire & Cable');
				await createItem(env.db, {
					sku: 'WI-24AWG-BLK',
					categoryId: wire.id,
					name: '24 AWG black wire',
					unit: 'm',
					data: { gauge: '24 AWG', color: 'black' },
				});
				const moved = await moveItem(env.db, {
					sku: 'WI-24AWG-BLK',
					delta: 12.3456,
					reason: 'received',
				});
				expect(moved.item.quantityOnHand).toBe(12.346);
			} finally {
				await env.teardown();
			}
		});

		it('allocations enforce available quantity and release it back', async () => {
			const env = await makeEnv();
			try {
				await seedCategories(env.db);
				const resistors = await getCategoryByNameOrThrow(env.db, 'Resistors');
				await createItem(env.db, {
					sku: 'RES-10K-1%',
					categoryId: resistors.id,
					name: '10kΩ resistor 1%',
					unit: 'pc',
				});
				await moveItem(env.db, { sku: 'RES-10K-1%', delta: 10, reason: 'received' });
				const project = await createProject(env.db, { name: 'Blinkenlights' });

				const alloc = await createAllocation(env.db, {
					projectId: project.id,
					sku: 'RES-10K-1%',
					quantity: 6,
					note: 'prototyping',
				});
				expect(alloc.quantity).toBe(6);
				expect(await availableQuantity(env.db, 'RES-10K-1%')).toBe(4);
				// reserving never mutates on-hand
				expect((await getItem(env.db, 'RES-10K-1%'))?.quantityOnHand).toBe(10);

				// over-allocation rejected
				await expect(
					createAllocation(env.db, { projectId: project.id, sku: 'RES-10K-1%', quantity: 5 }),
				).rejects.toThrow(AllocationError);

				// released allocation frees quantity
				await releaseAllocation(env.db, alloc.id);
				expect(await availableQuantity(env.db, 'RES-10K-1%')).toBe(10);
				expect(await reservedQuantity(env.db, 'RES-10K-1%')).toBe(0);

				const allocations = await listProjectAllocations(env.db, project.id, false);
				expect(allocations).toHaveLength(1);
				expect(allocations[0].releasedAt).toBeTruthy();

				// history shows reservation + release events with delta 0
				const movements = await listMovements(env.db, 'RES-10K-1%');
				const events = movements.filter((m) => m.reason === 'reserved' || m.reason === 'released');
				expect(events).toHaveLength(2);
				expect(events.every((m) => m.delta === 0)).toBe(true);
			} finally {
				await env.teardown();
			}
		});

		it('delete is guarded by on-hand and active allocations', async () => {
			const env = await makeEnv();
			try {
				await seedCategories(env.db);
				const resistors = await getCategoryByNameOrThrow(env.db, 'Resistors');
				await createItem(env.db, {
					sku: 'RES-10K-1%',
					categoryId: resistors.id,
					name: '10kΩ resistor 1%',
					unit: 'pc',
				});
				const project = await createProject(env.db, { name: 'Temp' });

				// qty 0, no allocations → delete ok
				await deleteItem(env.db, 'RES-10K-1%');
				expect(await getItem(env.db, 'RES-10K-1%')).toBeNull();

				// with stock → blocked
				await createItem(env.db, {
					sku: 'RES-10K-2%',
					categoryId: resistors.id,
					name: 'x',
					unit: 'pc',
				});
				await moveItem(env.db, { sku: 'RES-10K-2%', delta: 5, reason: 'received' });
				await expect(deleteItem(env.db, 'RES-10K-2%')).rejects.toThrow(/quantity on hand/);

				// with active allocation → blocked even after stock is used up
				const alloc = await createAllocation(env.db, {
					projectId: project.id,
					sku: 'RES-10K-2%',
					quantity: 5,
				});
				await moveItem(env.db, { sku: 'RES-10K-2%', delta: -5, reason: 'used' });
				await expect(deleteItem(env.db, 'RES-10K-2%')).rejects.toThrow(/reserved/);
				await releaseAllocation(env.db, alloc.id);

				// on-hand 0, nothing reserved → deletable
				await deleteItem(env.db, 'RES-10K-2%');
				expect(await getItem(env.db, 'RES-10K-2%')).toBeNull();
			} finally {
				await env.teardown();
			}
		});
	});
}

async function getCategoryByNameOrThrow(db: Db, name: string) {
	const cat = await getCategoryByName(db, name);
	if (!cat) throw new Error(`seed category missing: ${name}`);
	return cat;
}

suite('sqlite', createSqliteEnv);

let postgresReachable = true;
try {
	const probe = postgres(POSTGRES_ADMIN_URL, { max: 1, onnotice: () => {}, connect_timeout: 3 });
	await probe.unsafe(`SELECT 1`);
	await probe.end();
} catch {
	postgresReachable = false;
}

if (postgresReachable) {
	suite('postgres', createPostgresEnv);
} else {
	describe('[db: postgres]', () => {
		it.skipIf(!postgresReachable)(
			'postgres not reachable — set TEST_POSTGRES_URL or start docker compose',
			() => {},
		);
	});
}
