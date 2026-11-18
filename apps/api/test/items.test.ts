import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import {
	closeDb,
	createDb,
	getCategoryByName,
	listCategories,
	runMigrations,
	seedCategories,
	type Db,
} from '@inventory/db';
import { buildApp } from '../src/app.js';

type Engine = 'sqlite' | 'postgres';

interface ApiEnv {
	db: Db;
	request: (req: { url: string; method?: string; body?: unknown }) => Promise<{
		status: number;
		json: () => Promise<unknown>;
	}>;
	teardown: () => Promise<void>;
}

type Api = ApiEnv['request'];

interface ItemSummary {
	sku: string;
	name: string;
	quantityOnHand: number;
	location: string | null;
	data: Record<string, unknown> | null;
}

interface ItemDetail extends ItemSummary {
	available: number;
	category: { id: string; name: string } | null;
}

function itemsOf(body: unknown): ItemSummary[] {
	return (body as { items: ItemSummary[] }).items;
}

const POSTGRES_ADMIN_URL =
	process.env.TEST_POSTGRES_URL ?? 'postgres://inventory:inventory@localhost:5432/postgres';

async function makeEnv(engine: Engine): Promise<ApiEnv> {
	let db: Db;
	let dbTeardown: () => Promise<void>;

	if (engine === 'sqlite') {
		const dir = mkdtempSync(path.join(tmpdir(), 'inventory-api-sqlite-'));
		db = createDb(`file:${path.join(dir, 'api-test.db')}`);
		dbTeardown = async () => {
			await closeDb(db);
			rmSync(dir, { recursive: true, force: true });
		};
	} else {
		const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
		const dbName = `inventory_api_test_${suffix}`.slice(0, 40);
		const admin = postgres(POSTGRES_ADMIN_URL, { max: 1, onnotice: () => {} });
		await admin.unsafe(`CREATE DATABASE ${dbName}`);
		await admin.end();
		const scratchUrl = new URL(POSTGRES_ADMIN_URL);
		scratchUrl.pathname = `/${dbName}`;
		db = createDb(scratchUrl.toString());
		dbTeardown = async () => {
			await closeDb(db);
			const drop = postgres(POSTGRES_ADMIN_URL, { max: 1, onnotice: () => {} });
			await drop.unsafe(`DROP DATABASE ${dbName}`);
			await drop.end();
		};
	}

	await runMigrations(db);
	await seedCategories(db);
	const app = buildApp(db);

	const request: Api = async ({ url, method, body }) => {
		const res = await app.inject({
			method: method ?? 'GET',
			url,
			headers: body === undefined ? undefined : { 'content-type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		return {
			status: res.statusCode,
			json: () => Promise.resolve(res.json()),
		};
	};

	return {
		db,
		request,
		teardown: async () => {
			await app.close();
			await dbTeardown();
		},
	};
}

// --- fixtures ----------------------------------------------------------------

const SKUS = {
	res10k: 'RES-10K-1%',
	res4k7: 'RES-4K7-5%',
	cap100n: 'CAP-100N',
	wire24: 'WI-24AWG-BLK',
} as const;

/** SKUs are URL-encoded (they may contain `%`, e.g. `RES-10K-1%`). */
const itemUrl = (sku: string) => `/api/items/${encodeURIComponent(sku)}`;

async function createFixtureItems(env: ApiEnv): Promise<void> {
	const resistors = await getCategoryByName(env.db, 'Resistors');
	const capacitors = await getCategoryByName(env.db, 'Capacitors');
	const wire = await getCategoryByName(env.db, 'Wire & Cable');
	if (!resistors || !capacitors || !wire) throw new Error('seed categories missing');

	const post = async (body: unknown) => {
		const res = await env.request({ method: 'POST', url: '/api/items', body });
		if (res.status !== 201) throw new Error(`fixture create failed (${res.status})`);
	};

	await post({
		sku: SKUS.res10k,
		categoryId: resistors.id,
		name: '10kΩ resistor 1%',
		unit: 'pc',
		location: 'A3-12',
		data: { value: 10000, tolerance: '1%', package: '0805' },
	});
	await post({
		sku: SKUS.res4k7,
		categoryId: resistors.id,
		name: '4.7kΩ resistor 5%',
		unit: 'pc',
		location: 'A3-12',
		data: { value: 4700, tolerance: '5%' },
	});
	await post({
		sku: SKUS.cap100n,
		categoryId: capacitors.id,
		name: '100nF ceramic capacitor',
		description: 'X7R, 0805',
		unit: 'pc',
		location: 'B1-4',
		data: { capacitance: 0.1, type: 'ceramic', voltageRating: 50 },
	});
	await post({
		sku: SKUS.wire24,
		categoryId: wire.id,
		name: '24 AWG black wire',
		description: 'silicone insulated, 305m roll',
		unit: 'm',
		location: 'C2-1',
		data: { gauge: '24 AWG', color: 'black', metersPerRoll: 305 },
	});
}

// --- the suite (run identically against both engines) --------------------------

function itemsApiSuite(engine: Engine): void {
	describe(`[api: ${engine}]`, () => {
		it('health', async () => {
			const env = await makeEnv(engine);
			try {
				const res = await env.request({ url: '/api/health' });
				expect(res.status).toBe(200);
				expect(await res.json()).toEqual({ status: 'ok' });
			} finally {
				await env.teardown();
			}
		});

		it('item CRUD: create, read, update, delete', async () => {
			const env = await makeEnv(engine);
			try {
				await createFixtureItems(env);

				// read back with category + available
				const got = await env.request({ url: itemUrl(SKUS.res10k) });
				expect(got.status).toBe(200);
				const body = (await got.json()) as ItemDetail;
				expect(body.sku).toBe(SKUS.res10k);
				expect(body.quantityOnHand).toBe(0);
				expect(body.available).toBe(0);
				expect(body.category).not.toBeNull();
				expect(body.category?.name).toBe('Resistors');
				expect(body.data).toEqual({ value: 10000, tolerance: '1%', package: '0805' });

				// unknown sku → 404
				expect((await env.request({ url: '/api/items/NOPE-999' })).status).toBe(404);

				// update name + location
				const patched = await env.request({
					method: 'PATCH',
					url: itemUrl(SKUS.res10k),
					body: { name: '10kΩ resistor 1% (stock)', location: 'A3-13' },
				});
				expect(patched.status).toBe(200);
				const patchBody = (await patched.json()) as ItemDetail;
				expect(patchBody.name).toBe('10kΩ resistor 1% (stock)');
				expect(patchBody.location).toBe('A3-13');

				// delete with stock on hand → 409
				await env.request({
					method: 'POST',
					url: itemUrl(SKUS.res10k) + '/move',
					body: { delta: 4, reason: 'received' },
				});
				expect((await env.request({ method: 'DELETE', url: itemUrl(SKUS.res10k) })).status).toBe(
					409,
				);

				// delete clean item → 204
				expect((await env.request({ method: 'DELETE', url: itemUrl(SKUS.cap100n) })).status).toBe(
					204,
				);
				expect((await env.request({ url: itemUrl(SKUS.cap100n) })).status).toBe(404);
			} finally {
				await env.teardown();
			}
		});

		it('create validates sku, category, and custom fields', async () => {
			const env = await makeEnv(engine);
			try {
				await createFixtureItems(env);

				const badSku = await env.request({
					method: 'POST',
					url: '/api/items',
					body: { sku: 'bad sku', categoryId: 'x', name: 'n' },
				});
				expect(badSku.status).toBe(400);
				expect(((await badSku.json()) as { error: string }).error).toBe('validation_error');

				const badCategory = await env.request({
					method: 'POST',
					url: '/api/items',
					body: { sku: 'NEW-1', categoryId: 'does-not-exist', name: 'n' },
				});
				expect(badCategory.status).toBe(404);

				// unknown custom field / wrong type → 400
				const resistors = await getCategoryByName(env.db, 'Resistors');
				const badField = await env.request({
					method: 'POST',
					url: '/api/items',
					body: { sku: 'NEW-2', categoryId: resistors?.id, name: 'n', data: { notAField: true } },
				});
				expect(badField.status).toBe(400);
				const badType = await env.request({
					method: 'POST',
					url: '/api/items',
					body: { sku: 'NEW-3', categoryId: resistors?.id, name: 'n', data: { value: 'abc' } },
				});
				expect(badType.status).toBe(400);

				// duplicate sku → conflict
				const dup = await env.request({
					method: 'POST',
					url: '/api/items',
					body: { sku: SKUS.res10k, categoryId: resistors?.id, name: 'n' },
				});
				expect([400, 409]).toContain(dup.status);
			} finally {
				await env.teardown();
			}
		});

		it('search: q matches sku, name, description, and searchable JSON fields', async () => {
			const env = await makeEnv(engine);
			try {
				await createFixtureItems(env);

				// by sku prefix
				let res = await env.request({ url: '/api/items?q=RES-10K' });
				expect(res.status).toBe(200);
				const items = itemsOf(await res.json());
				expect(items.map((i) => i.sku)).toEqual([SKUS.res10k]);

				// by name substring
				res = await env.request({ url: '/api/items?q=capacitor' });
				expect(itemsOf(await res.json()).map((i) => i.sku)).toEqual([SKUS.cap100n]);

				// by description substring
				res = await env.request({ url: '/api/items?q=silicone' });
				expect(itemsOf(await res.json()).map((i) => i.sku)).toEqual([SKUS.wire24]);

				// by searchable JSON field value (plan §4.3 example)
				res = await env.request({ url: '/api/items?q=4700' });
				expect(itemsOf(await res.json()).map((i) => i.sku)).toEqual([SKUS.res4k7]);

				// ranking: sku-prefix hit outranks name-substring hits
				res = await env.request({ url: '/api/items?q=10k' });
				const ranked = itemsOf(await res.json());
				expect(ranked.length).toBeGreaterThanOrEqual(1);
				expect(ranked[0].sku).toBe(SKUS.res10k);

				// no match
				res = await env.request({ url: '/api/items?q=zzz-nothing' });
				expect(itemsOf(await res.json())).toEqual([]);
			} finally {
				await env.teardown();
			}
		});

		it('filters: category, location, minQty, field[key]; pagination', async () => {
			const env = await makeEnv(engine);
			try {
				await createFixtureItems(env);
				await env.request({
					method: 'POST',
					url: itemUrl(SKUS.res10k) + '/move',
					body: { delta: 100, reason: 'received' },
				});
				await env.request({
					method: 'POST',
					url: itemUrl(SKUS.res4k7) + '/move',
					body: { delta: 2, reason: 'received' },
				});

				const cats = await listCategories(env.db);
				const resistors = cats.find((c) => c.name === 'Resistors');
				if (!resistors) throw new Error('Resistors category missing');

				// category filter
				let res = await env.request({ url: `/api/items?category=${resistors.id}` });
				expect(
					itemsOf(await res.json())
						.map((i) => i.sku)
						.sort(),
				).toEqual([SKUS.res10k, SKUS.res4k7]);

				// location substring filter (case-insensitive)
				res = await env.request({ url: '/api/items?location=a3' });
				expect(
					itemsOf(await res.json())
						.map((i) => i.sku)
						.sort(),
				).toEqual([SKUS.res10k, SKUS.res4k7]);

				// minQty filter
				res = await env.request({ url: '/api/items?minQty=50' });
				expect(itemsOf(await res.json()).map((i) => i.sku)).toEqual([SKUS.res10k]);

				// custom field filter
				res = await env.request({
					url: `/api/items?field[tolerance]=1%&category=${resistors.id}`,
				});
				expect(itemsOf(await res.json()).map((i) => i.sku)).toEqual([SKUS.res10k]);

				// pagination — pages are disjoint and cover all items
				res = await env.request({ url: '/api/items?page=1&pageSize=2&sort=sku' });
				const page1 = itemsOf(await res.json()).map((i) => i.sku);
				res = await env.request({ url: '/api/items?page=2&pageSize=2&sort=sku' });
				const page2 = itemsOf(await res.json()).map((i) => i.sku);
				expect(page1).toHaveLength(2);
				expect(page2).toHaveLength(2);
				expect(new Set([...page1, ...page2]).size).toBe(4);
			} finally {
				await env.teardown();
			}
		});

		it('move: applies delta, records movement, rejects negative and zero', async () => {
			const env = await makeEnv(engine);
			try {
				await createFixtureItems(env);

				const move = await env.request({
					method: 'POST',
					url: itemUrl(SKUS.res10k) + '/move',
					body: { delta: 10, reason: 'received', reference: 'PO-77' },
				});
				expect(move.status).toBe(200);
				const moveBody = (await move.json()) as {
					item: ItemSummary;
					movement: { reason: string; reference: string | null };
				};
				expect(moveBody.item.quantityOnHand).toBe(10);
				expect(moveBody.movement.reason).toBe('received');
				expect(moveBody.movement.reference).toBe('PO-77');

				// over-use → 409
				const over = await env.request({
					method: 'POST',
					url: itemUrl(SKUS.res10k) + '/move',
					body: { delta: -11, reason: 'used' },
				});
				expect(over.status).toBe(409);
				expect(((await over.json()) as { error: string }).error).toBe('conflict');

				// zero delta → 400
				const zero = await env.request({
					method: 'POST',
					url: itemUrl(SKUS.res10k) + '/move',
					body: { delta: 0, reason: 'used' },
				});
				expect(zero.status).toBe(400);

				// bad reason → 400
				const badReason = await env.request({
					method: 'POST',
					url: itemUrl(SKUS.res10k) + '/move',
					body: { delta: 1, reason: 'exploded' },
				});
				expect(badReason.status).toBe(400);

				// unknown sku → 404
				const unknown = await env.request({
					method: 'POST',
					url: '/api/items/NOPE-1/move',
					body: { delta: 1, reason: 'used' },
				});
				expect(unknown.status).toBe(404);

				// on-hand unchanged after the rejected move
				const got = await env.request({ url: itemUrl(SKUS.res10k) });
				expect(((await got.json()) as ItemSummary).quantityOnHand).toBe(10);
			} finally {
				await env.teardown();
			}
		});
	});
}

itemsApiSuite('sqlite');

let postgresReachable = true;
try {
	const probe = postgres(POSTGRES_ADMIN_URL, { max: 1, onnotice: () => {}, connect_timeout: 3 });
	await probe.unsafe('SELECT 1');
	await probe.end();
} catch {
	postgresReachable = false;
}

if (postgresReachable) {
	itemsApiSuite('postgres');
} else {
	describe('[api: postgres]', () => {
		it('postgres not reachable — set TEST_POSTGRES_URL or start docker compose', () => {});
	});
}
