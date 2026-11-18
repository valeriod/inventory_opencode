import { describe, expect, it } from 'vitest';
import { createFixtureItems, itemUrl, makeEnv, SKUS, type Engine } from './env.js';

/** Field-schema fixture (mirrors a seeded category schema). */
const resSchema = [
	{ key: 'value', label: 'Value', type: 'number', required: true, unit: 'Ω' },
	{
		key: 'tolerance',
		label: 'Tolerance',
		type: 'select',
		required: true,
		options: ['1%', '5%', '10%'],
	},
];

function categoriesApiSuite(engine: Engine): void {
	describe(`[api: ${engine}] categories`, () => {
		it('lists seeded categories', async () => {
			const env = await makeEnv(engine);
			try {
				const res = await env.request({ url: '/api/categories' });
				expect(res.status).toBe(200);
				const body = (await res.json()) as { categories: { name: string }[] };
				const names = body.categories.map((c) => c.name);
				expect(names).toContain('Resistors');
				expect(body.categories.length).toBeGreaterThanOrEqual(10);
			} finally {
				await env.teardown();
			}
		});

		it('creates a category and reads it back', async () => {
			const env = await makeEnv(engine);
			try {
				const created = await env.request({
					method: 'POST',
					url: '/api/categories',
					body: { name: 'Bench Power', description: 'lab supplies', fieldSchema: resSchema },
				});
				expect(created.status).toBe(201);
				const body = (await created.json()) as {
					category: { id: string; name: string; fieldSchema: unknown };
				};
				expect(body.category.name).toBe('Bench Power');
				expect(body.category.fieldSchema).toHaveLength(2);

				const got = await env.request({ url: `/api/categories/${body.category.id}` });
				expect(got.status).toBe(200);
				const gotBody = (await got.json()) as { category: { name: string } };
				expect(gotBody.category.name).toBe('Bench Power');
			} finally {
				await env.teardown();
			}
		});

		it('rejects invalid category bodies', async () => {
			const env = await makeEnv(engine);
			try {
				// select without options
				const bad = await env.request({
					method: 'POST',
					url: '/api/categories',
					body: {
						name: 'Bad',
						fieldSchema: [{ key: 'x', label: 'X', type: 'select', required: false }],
					},
				});
				expect(bad.status).toBe(400);

				// duplicate name
				await env.request({
					method: 'POST',
					url: '/api/categories',
					body: { name: 'Resistors', fieldSchema: [] },
				});
				const dup = await env.request({
					method: 'POST',
					url: '/api/categories',
					body: { name: 'Resistors', fieldSchema: [] },
				});
				expect(dup.status).toBe(409);
			} finally {
				await env.teardown();
			}
		});

		it('updates name/description and flags schema evolution', async () => {
			const env = await makeEnv(engine);
			try {
				const created = await env.request({
					method: 'POST',
					url: '/api/categories',
					body: { name: 'Evo', fieldSchema: resSchema },
				});
				const cat = ((await created.json()) as { category: { id: string } }).category;

				// harmless update: rename + add a field (no warning)
				const benign = await env.request({
					method: 'PATCH',
					url: `/api/categories/${cat.id}`,
					body: {
						name: 'Evo v2',
						fieldSchema: [
							...resSchema,
							{ key: 'extra', label: 'Extra', type: 'string', required: false },
						],
					},
				});
				expect(benign.status).toBe(200);
				const benignBody = (await benign.json()) as {
					category: { name: string };
					warnings: string[];
				};
				expect(benignBody.category.name).toBe('Evo v2');
				expect(benignBody.warnings).toEqual([]);

				// breaking update: change type + remove a field (warnings)
				const breaking = await env.request({
					method: 'PATCH',
					url: `/api/categories/${cat.id}`,
					body: {
						fieldSchema: [
							{ key: 'value', label: 'Value', type: 'string', required: true },
							{ key: 'extra', label: 'Extra', type: 'string', required: false },
						],
					},
				});
				expect(breaking.status).toBe(200);
				const breakingBody = (await breaking.json()) as { warnings: string[] };
				expect(breakingBody.warnings).toHaveLength(2);
				expect(breakingBody.warnings.join(' ')).toMatch(/type changed/);
				expect(breakingBody.warnings.join(' ')).toMatch(/removed/);
			} finally {
				await env.teardown();
			}
		});

		it('404s for unknown category id', async () => {
			const env = await makeEnv(engine);
			try {
				const got = await env.request({ url: '/api/categories/nope' });
				expect(got.status).toBe(404);
			} finally {
				await env.teardown();
			}
		});
	});
}

function movementsApiSuite(engine: Engine): void {
	describe(`[api: ${engine}] movements`, () => {
		it('returns movement history newest-first', async () => {
			const env = await makeEnv(engine);
			try {
				await createFixtureItems(env);
				await env.request({
					method: 'POST',
					url: itemUrl(SKUS.res10k) + '/move',
					body: { delta: 100, reason: 'received', reference: 'PO-1' },
				});
				await env.request({
					method: 'POST',
					url: itemUrl(SKUS.res10k) + '/move',
					body: { delta: -50, reason: 'used', reference: 'JOB-9' },
				});

				const res = await env.request({ url: itemUrl(SKUS.res10k) + '/movements' });
				expect(res.status).toBe(200);
				const body = (await res.json()) as {
					movements: {
						delta: number;
						reason: string;
						reference: string | null;
						resultingQty: number;
					}[];
				};
				expect(body.movements).toHaveLength(2);
				expect(body.movements[0].reference).toBe('JOB-9');
				expect(body.movements[0].delta).toBe(-50);
				expect(body.movements[0].resultingQty).toBe(50);
				expect(body.movements[1].reference).toBe('PO-1');
				expect(body.movements[1].resultingQty).toBe(100);
			} finally {
				await env.teardown();
			}
		});

		it('404s for unknown sku', async () => {
			const env = await makeEnv(engine);
			try {
				const res = await env.request({ url: itemUrl('NOPE-1') + '/movements' });
				expect(res.status).toBe(404);
			} finally {
				await env.teardown();
			}
		});
	});
}

categoriesApiSuite('sqlite');
movementsApiSuite('sqlite');

let postgresReachable = true;
try {
	const probe = (await import('postgres')).default(
		'postgres://inventory:inventory@localhost:5432/postgres',
		{ max: 1, onnotice: () => {}, connect_timeout: 3 },
	);
	await probe.unsafe('SELECT 1');
	await probe.end();
} catch {
	postgresReachable = false;
}

if (postgresReachable) {
	categoriesApiSuite('postgres');
	movementsApiSuite('postgres');
} else {
	describe('[api: postgres] categories/movements', () => {
		it('postgres not reachable — set TEST_POSTGRES_URL or start docker compose', () => {});
	});
}
