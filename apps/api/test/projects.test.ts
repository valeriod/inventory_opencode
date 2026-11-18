import { describe, expect, it } from 'vitest';
import {
	createFixtureItems,
	itemUrl,
	makeEnv,
	SKUS,
	type Api,
	type Engine,
} from './env.js';

interface ProjectSummary {
	id: string;
	name: string;
	description: string | null;
	status: 'active' | 'closed';
	activeAllocations: number;
	reservedQuantity: number;
}

interface ProjectDetail extends ProjectSummary {
	allocations: {
		id: string;
		projectId: string;
		sku: string;
		quantity: number;
		note: string | null;
		reservedAt: string;
		releasedAt: string | null;
	}[];
}

interface Allocation {
	id: string;
	projectId: string;
	sku: string;
	quantity: number;
	note: string | null;
	reservedAt: string;
	releasedAt: string | null;
}

async function createProject(api: Api, body: { name: string; description?: string | null }) {
	const res = await api({ method: 'POST', url: '/api/projects', body });
	return { status: res.status, body: (await res.json()) as { project: ProjectSummary } };
}

async function receive(api: Api, sku: string, delta: number) {
	const res = await api({
		method: 'POST',
		url: itemUrl(sku) + '/move',
		body: { delta, reason: 'received' },
	});
	if (res.status !== 200) throw new Error(`receive failed: ${res.status}`);
}

function projectsSuite(engine: Engine): void {
	describe(`[api: ${engine}] projects & allocations`, () => {
		it('project CRUD: create, list with stats, detail, update/close', async () => {
			const env = await makeEnv(engine);
			try {
				await createFixtureItems(env);
				await receive(env.request, SKUS.res10k, 10);

				const created = await createProject(env.request, {
					name: 'Blinkenlights',
					description: 'LED matrix',
				});
				expect(created.status).toBe(201);
				expect(created.body.project.name).toBe('Blinkenlights');
				expect(created.body.project.status).toBe('active');

				const listRes = await env.request({ url: '/api/projects' });
				expect(listRes.status).toBe(200);
				const list = (await listRes.json()) as { projects: ProjectSummary[] };
				expect(list.projects.map((p) => p.name)).toContain('Blinkenlights');

				const detailRes = await env.request({ url: `/api/projects/${created.body.project.id}` });
				expect(detailRes.status).toBe(200);
				const detail = (await detailRes.json()) as { project: ProjectDetail };
				expect(detail.project.allocations).toEqual([]);
				expect(detail.project.activeAllocations).toBe(0);
				expect(detail.project.reservedQuantity).toBe(0);

				const patchRes = await env.request({
					method: 'PATCH',
					url: `/api/projects/${created.body.project.id}`,
					body: { status: 'closed', description: 'done' },
				});
				expect(patchRes.status).toBe(200);
				const patched = (await patchRes.json()) as { project: ProjectSummary };
				expect(patched.project.status).toBe('closed');
				expect(patched.project.description).toBe('done');

				const bad = await env.request({
					method: 'PATCH',
					url: `/api/projects/${created.body.project.id}`,
					body: {},
				});
				expect(bad.status).toBe(400);

				const missing = await env.request({ url: '/api/projects/nope' });
				expect(missing.status).toBe(404);
			} finally {
				await env.teardown();
			}
		});

		it('set-aside and release: enforces available qty, records history, updates stats', async () => {
			const env = await makeEnv(engine);
			try {
				await createFixtureItems(env);
				await receive(env.request, SKUS.res10k, 10);
				const project = (await createProject(env.request, { name: 'Proto' })).body.project;

				const allocRes = await env.request({
					method: 'POST',
					url: '/api/allocations',
					body: { projectId: project.id, sku: SKUS.res10k, quantity: 6, note: 'build' },
				});
				expect(allocRes.status).toBe(201);
				const alloc = (await allocRes.json()) as { allocation: Allocation };
				expect(alloc.allocation.quantity).toBe(6);
				expect(alloc.allocation.releasedAt).toBeNull();

				// reserving never mutates on-hand; available decreases
				const item = await env.request({ url: itemUrl(SKUS.res10k) });
				const itemBody = (await item.json()) as { quantityOnHand: number; available: number };
				expect(itemBody.quantityOnHand).toBe(10);
				expect(itemBody.available).toBe(4);

				// over-allocation rejected (409)
				const over = await env.request({
					method: 'POST',
					url: '/api/allocations',
					body: { projectId: project.id, sku: SKUS.res10k, quantity: 5 },
				});
				expect(over.status).toBe(409);

				// project detail/stats reflect active reservation
				const detail = (await (await env.request({ url: `/api/projects/${project.id}` })).json()) as {
					project: ProjectDetail;
				};
				expect(detail.project.activeAllocations).toBe(1);
				expect(detail.project.reservedQuantity).toBe(6);
				expect(detail.project.allocations).toHaveLength(1);
				expect(detail.project.allocations[0].sku).toBe(SKUS.res10k);

				// release
				const releaseRes = await env.request({
					method: 'PATCH',
					url: `/api/allocations/${alloc.allocation.id}`,
					body: { release: true },
				});
				expect(releaseRes.status).toBe(200);
				const released = (await releaseRes.json()) as { allocation: Allocation };
				expect(released.allocation.releasedAt).not.toBeNull();

				const itemAfter = (await (await env.request({ url: itemUrl(SKUS.res10k) })).json()) as {
					available: number;
				};
				expect(itemAfter.available).toBe(10);

				// history shows reserved + released with delta 0
				const moves = (await (await env.request({ url: itemUrl(SKUS.res10k) + '/movements' })).json()) as {
					movements: { reason: string; delta: number; projectId: string | null }[];
				};
				const events = moves.movements.filter((m) => m.reason === 'reserved' || m.reason === 'released');
				expect(events).toHaveLength(2);
				expect(events.every((m) => m.delta === 0)).toBe(true);
				expect(events.every((m) => m.projectId === project.id)).toBe(true);

				// cannot release twice
				const again = await env.request({
					method: 'PATCH',
					url: `/api/allocations/${alloc.allocation.id}`,
					body: { release: true },
				});
				expect(again.status).toBe(409);
			} finally {
				await env.teardown();
			}
		});

		it('edit allocation quantity (enforced) and rejects invalid refs', async () => {
			const env = await makeEnv(engine);
			try {
				await createFixtureItems(env);
				await receive(env.request, SKUS.res10k, 10);
				const project = (await createProject(env.request, { name: 'P2' })).body.project;

				const alloc = (
					(await (
						await env.request({
							method: 'POST',
							url: '/api/allocations',
							body: { projectId: project.id, sku: SKUS.res10k, quantity: 4 },
						})
					).json()) as { allocation: Allocation }
				).allocation;

				const up = await env.request({
					method: 'PATCH',
					url: `/api/allocations/${alloc.id}`,
					body: { quantity: 9 },
				});
				expect(up.status).toBe(200);
				expect(((await up.json()) as { allocation: Allocation }).allocation.quantity).toBe(9);

				const tooMuch = await env.request({
					method: 'PATCH',
					url: `/api/allocations/${alloc.id}`,
					body: { quantity: 11 },
				});
				expect(tooMuch.status).toBe(409);

				// unknown project / sku / allocation
				expect(
					(
						await env.request({
							method: 'POST',
							url: '/api/allocations',
							body: { projectId: 'nope', sku: SKUS.res10k, quantity: 1 },
						})
					).status,
				).toBe(404);
				expect(
					(
						await env.request({
							method: 'POST',
							url: '/api/allocations',
							body: { projectId: project.id, sku: 'NOPE-1', quantity: 1 },
						})
					).status,
				).toBe(404);
				expect((await env.request({ url: '/api/allocations/nope' })).status).toBe(404);
			} finally {
				await env.teardown();
			}
		});

		it('concurrent allocations never over-reserve available stock', async () => {
			const env = await makeEnv(engine);
			try {
				await createFixtureItems(env);
				await receive(env.request, SKUS.res10k, 10);
				const project = (await createProject(env.request, { name: 'Race' })).body.project;

				const attempts = Array.from({ length: 8 }, () =>
					env.request({
						method: 'POST',
						url: '/api/allocations',
						body: { projectId: project.id, sku: SKUS.res10k, quantity: 3 },
					}),
				);
				const results = await Promise.all(attempts);
				const ok = results.filter((r) => r.status === 201);
				const conflict = results.filter((r) => r.status === 409);
				// 10 on hand / 3 each => at most 3 can succeed; invariant: never > 3.
				expect(ok.length).toBeLessThanOrEqual(3);
				expect(ok.length + conflict.length).toBe(8);

				const detail = (await (await env.request({ url: `/api/projects/${project.id}` })).json()) as {
					project: ProjectDetail;
				};
				expect(detail.project.activeAllocations).toBe(ok.length);
				expect(detail.project.reservedQuantity).toBe(ok.length * 3);

				const item = (await (await env.request({ url: itemUrl(SKUS.res10k) })).json()) as {
					quantityOnHand: number;
					available: number;
				};
				expect(item.quantityOnHand).toBe(10);
				expect(item.available).toBe(10 - ok.length * 3);
				expect(item.available).toBeGreaterThanOrEqual(0);
			} finally {
				await env.teardown();
			}
		});
	});
}

projectsSuite('sqlite');

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
	projectsSuite('postgres');
} else {
	describe('[api: postgres] projects & allocations', () => {
		it('postgres not reachable — set TEST_POSTGRES_URL or start docker compose', () => {});
	});
}
