import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import postgres from 'postgres';
import {
	closeDb,
	createDb,
	getCategoryByName,
	runMigrations,
	seedCategories,
	type Db,
} from '@inventory/db';
import { buildApp } from '../src/app.js';

export type Engine = 'sqlite' | 'postgres';

export { getCategoryByName, listCategories } from '@inventory/db';

export interface ApiResponse {
	status: number;
	json: () => Promise<unknown>;
	text: () => Promise<string>;
	headers: Record<string, string | string[] | number | undefined>;
}

export interface ApiEnv {
	db: Db;
	request: (req: { url: string; method?: string; body?: unknown }) => Promise<ApiResponse>;
	teardown: () => Promise<void>;
}

export type Api = ApiEnv['request'];

export interface ItemSummary {
	sku: string;
	name: string;
	quantityOnHand: number;
	location: string | null;
	data: Record<string, unknown> | null;
}

export interface ItemDetail extends ItemSummary {
	available: number;
	category: { id: string; name: string } | null;
}

export function itemsOf(body: unknown): ItemSummary[] {
	return (body as { items: ItemSummary[] }).items;
}

export const POSTGRES_ADMIN_URL =
	process.env.TEST_POSTGRES_URL ?? 'postgres://inventory:inventory@localhost:5432/postgres';

export async function makeEnv(engine: Engine): Promise<ApiEnv> {
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
			text: () => Promise.resolve(res.payload),
			headers: res.headers as Record<string, string | string[] | number | undefined>,
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

export const SKUS = {
	res10k: 'RES-10K-1%',
	res4k7: 'RES-4K7-5%',
	cap100n: 'CAP-100N',
	wire24: 'WI-24AWG-BLK',
} as const;

/** SKUs are URL-encoded (they may contain `%`, e.g. `RES-10K-1%`). */
export const itemUrl = (sku: string) => `/api/items/${encodeURIComponent(sku)}`;

export async function createFixtureItems(env: ApiEnv): Promise<void> {
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
