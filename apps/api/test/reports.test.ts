import { describe, expect, it } from 'vitest';
import {
	createFixtureItems,
	getCategoryByName,
	itemUrl,
	makeEnv,
	SKUS,
	type Engine,
} from './env.js';

function reportsSuite(engine: Engine): void {
	describe(`[api: ${engine}] reports`, () => {
		it('summary report by category and location is verifiable against seeded/created data', async () => {
			const env = await makeEnv(engine);
			try {
				await createFixtureItems(env);
				await env.request({
					method: 'POST',
					url: itemUrl(SKUS.res10k) + '/move',
					body: { delta: 10, reason: 'received' },
				});
				await env.request({
					method: 'POST',
					url: itemUrl(SKUS.res4k7) + '/move',
					body: { delta: 2, reason: 'received' },
				});

				const byCatRes = await env.request({ url: '/api/reports/summary?groupBy=category' });
				expect(byCatRes.status).toBe(200);
				const byCat = (await byCatRes.json()) as {
					groupBy: string;
					rows: { label: string; itemCount: number; totalQuantity: number; totalValue: number }[];
					totals: { itemCount: number; totalQuantity: number; totalValue: number };
				};
				expect(byCat.groupBy).toBe('category');
				const resistors = byCat.rows.find((r) => r.label === 'Resistors');
				expect(resistors).toBeDefined();
				expect(resistors?.itemCount).toBe(2);
				expect(resistors?.totalQuantity).toBe(12);
				expect(byCat.totals.itemCount).toBe(4);
				expect(byCat.totals.totalQuantity).toBe(12);

				const byLocRes = await env.request({ url: '/api/reports/summary?groupBy=location' });
				expect(byLocRes.status).toBe(200);
				const byLoc = (await byLocRes.json()) as {
					rows: { label: string; itemCount: number; totalQuantity: number }[];
				};
				const a3 = byLoc.rows.find((r) => r.label === 'A3-12');
				expect(a3).toEqual({
					key: 'A3-12',
					label: 'A3-12',
					itemCount: 2,
					totalQuantity: 12,
					totalValue: 0,
				});

				const resistorsCat = await getCategoryByName(env.db, 'Resistors');
				const filteredRes = await env.request({
					url: `/api/reports/summary?groupBy=category&category=${resistorsCat?.id}`,
				});
				const filtered = (await filteredRes.json()) as {
					rows: { label: string; itemCount: number }[];
					totals: { itemCount: number };
				};
				expect(filtered.rows).toHaveLength(1);
				expect(filtered.rows[0].label).toBe('Resistors');
				expect(filtered.totals.itemCount).toBe(2);
			} finally {
				await env.teardown();
			}
		});

		it('low-stock report respects threshold and category filter', async () => {
			const env = await makeEnv(engine);
			try {
				await createFixtureItems(env);
				await env.request({
					method: 'POST',
					url: itemUrl(SKUS.res10k) + '/move',
					body: { delta: 10, reason: 'received' },
				});
				await env.request({
					method: 'POST',
					url: itemUrl(SKUS.res4k7) + '/move',
					body: { delta: 2, reason: 'received' },
				});

				const res = await env.request({ url: '/api/reports/low-stock?threshold=5' });
				expect(res.status).toBe(200);
				const body = (await res.json()) as {
					threshold: number;
					rows: { sku: string; quantityOnHand: number; categoryName: string | null }[];
				};
				expect(body.threshold).toBe(5);
				const skus = body.rows.map((r) => r.sku).sort();
				expect(skus).toEqual([SKUS.cap100n, SKUS.res4k7, SKUS.wire24]);
				expect(body.rows.find((r) => r.sku === SKUS.res4k7)?.quantityOnHand).toBe(2);
				expect(body.rows.every((r) => r.categoryName)).toBe(true);

				const resistorsCat = await getCategoryByName(env.db, 'Resistors');
				const catRes = await env.request({
					url: `/api/reports/low-stock?threshold=5&category=${resistorsCat?.id}`,
				});
				const catBody = (await catRes.json()) as { rows: { sku: string }[] };
				expect(catBody.rows.map((r) => r.sku)).toEqual([SKUS.res4k7]);
			} finally {
				await env.teardown();
			}
		});

		it('movements report supports sku/from/to filters', async () => {
			const env = await makeEnv(engine);
			try {
				await createFixtureItems(env);
				await env.request({
					method: 'POST',
					url: itemUrl(SKUS.res10k) + '/move',
					body: { delta: 10, reason: 'received', reference: 'PO-1' },
				});
				await env.request({
					method: 'POST',
					url: itemUrl(SKUS.res10k) + '/move',
					body: { delta: -3, reason: 'used', reference: 'JOB-1' },
				});
				await env.request({
					method: 'POST',
					url: itemUrl(SKUS.res4k7) + '/move',
					body: { delta: 5, reason: 'received' },
				});

				const res = await env.request({
					url: `/api/reports/movements?sku=${encodeURIComponent(SKUS.res10k)}`,
				});
				expect(res.status).toBe(200);
				const body = (await res.json()) as {
					rows: { sku: string; delta: number; reference: string | null; itemName: string | null }[];
				};
				expect(body.rows).toHaveLength(2);
				expect(body.rows.every((r) => r.sku === SKUS.res10k)).toBe(true);
				expect(body.rows[0].reference).toBe('JOB-1');
				expect(body.rows[0].itemName).toBe('10kΩ resistor 1%');

				const today = new Date().toISOString().slice(0, 10);
				const ranged = await env.request({
					url: `/api/reports/movements?from=${today}&to=${today}`,
				});
				const rangedBody = (await ranged.json()) as { rows: unknown[] };
				expect(rangedBody.rows.length).toBe(3);

				const future = '2099-01-01';
				const none = await env.request({
					url: `/api/reports/movements?from=${future}&to=${future}`,
				});
				expect(((await none.json()) as { rows: unknown[] }).rows).toHaveLength(0);
			} finally {
				await env.teardown();
			}
		});

		it('projects report includes allocation stats and status filter', async () => {
			const env = await makeEnv(engine);
			try {
				await createFixtureItems(env);
				await env.request({
					method: 'POST',
					url: itemUrl(SKUS.res10k) + '/move',
					body: { delta: 10, reason: 'received' },
				});

				const p1 = await env.request({
					method: 'POST',
					url: '/api/projects',
					body: { name: 'Active Project' },
				});
				const p1Id = ((await p1.json()) as { project: { id: string } }).project.id;
				await env.request({
					method: 'POST',
					url: '/api/allocations',
					body: { projectId: p1Id, sku: SKUS.res10k, quantity: 4 },
				});

				const p2 = await env.request({
					method: 'POST',
					url: '/api/projects',
					body: { name: 'Closed Project' },
				});
				const p2Id = ((await p2.json()) as { project: { id: string } }).project.id;
				await env.request({
					method: 'PATCH',
					url: `/api/projects/${p2Id}`,
					body: { status: 'closed' },
				});

				const res = await env.request({ url: '/api/reports/projects' });
				expect(res.status).toBe(200);
				const body = (await res.json()) as {
					rows: {
						name: string;
						status: string;
						activeAllocations: number;
						reservedQuantity: number;
					}[];
				};
				expect(body.rows).toHaveLength(2);
				const active = body.rows.find((r) => r.name === 'Active Project');
				expect(active?.status).toBe('active');
				expect(active?.activeAllocations).toBe(1);
				expect(active?.reservedQuantity).toBe(4);

				const activeOnly = await env.request({ url: '/api/reports/projects?status=active' });
				const activeBody = (await activeOnly.json()) as { rows: { name: string }[] };
				expect(activeBody.rows.map((r) => r.name)).toEqual(['Active Project']);
			} finally {
				await env.teardown();
			}
		});

		it('export.csv returns downloadable CSV for summary and movements', async () => {
			const env = await makeEnv(engine);
			try {
				await createFixtureItems(env);
				await env.request({
					method: 'POST',
					url: itemUrl(SKUS.res10k) + '/move',
					body: { delta: 10, reason: 'received', reference: 'PO-1' },
				});

				const summary = await env.request({
					url: '/api/reports/export.csv?report=summary&groupBy=category',
				});
				expect(summary.status).toBe(200);
				expect(String(summary.headers['content-type'])).toContain('text/csv');
				expect(String(summary.headers['content-disposition'])).toContain('summary.csv');
				const summaryText = await summary.text();
				const summaryLines = summaryText.trim().split('\n');
				expect(summaryLines[0]).toBe('key,label,itemCount,totalQuantity,totalValue');
				expect(summaryText).toContain('Resistors');

				const movements = await env.request({
					url: `/api/reports/export.csv?report=movements&sku=${encodeURIComponent(SKUS.res10k)}`,
				});
				expect(movements.status).toBe(200);
				expect(String(movements.headers['content-disposition'])).toContain('movements.csv');
				const movText = await movements.text();
				expect(movText.split('\n')[0]).toBe(
					'id,sku,itemName,delta,resultingQty,reason,projectId,reference,createdAt',
				);
				expect(movText).toContain(SKUS.res10k);
				expect(movText).toContain('PO-1');
			} finally {
				await env.teardown();
			}
		});
	});
}

reportsSuite('sqlite');

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
	reportsSuite('postgres');
} else {
	describe('[api: postgres] reports', () => {
		it('postgres not reachable — set TEST_POSTGRES_URL or start docker compose', () => {});
	});
}
