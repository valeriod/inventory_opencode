import { describe, expect, it } from 'vitest';
import { createFixtureItems, itemUrl, makeEnv, SKUS, type Engine } from './env.js';

function labelsSuite(engine: Engine): void {
	describe(`[api: ${engine}] labels`, () => {
		it('returns item label as PNG and SVG (code128/qr)', async () => {
			const env = await makeEnv(engine);
			try {
				await createFixtureItems(env);

				const png = await env.request({ url: `${itemUrl(SKUS.res10k)}/label` });
				expect(png.status).toBe(200);
				expect(String(png.headers['content-type'])).toContain('image/png');
				const pngText = await png.text();
				expect(pngText.slice(0, 8)).toContain('PNG');

				const svg = await env.request({ url: `${itemUrl(SKUS.res10k)}/label?format=svg&size=qr` });
				expect(svg.status).toBe(200);
				expect(String(svg.headers['content-type'])).toContain('image/svg+xml');
				const svgText = await svg.text();
				expect(svgText).toContain('<svg');
				expect(svgText).toContain('</svg>');

				const c128 = await env.request({
					url: `${itemUrl(SKUS.res10k)}/label?format=svg&size=code128`,
				});
				const c128Text = await c128.text();
				expect(c128Text).toContain('<svg');
			} finally {
				await env.teardown();
			}
		});

		it('returns 404 for unknown item label', async () => {
			const env = await makeEnv(engine);
			try {
				const res = await env.request({ url: '/api/items/NOPE-999/label' });
				expect(res.status).toBe(404);
			} finally {
				await env.teardown();
			}
		});

		it('renders printable label sheets for a5 and 4x6', async () => {
			const env = await makeEnv(engine);
			try {
				await createFixtureItems(env);
				const url = `/api/labels/print?sku=${encodeURIComponent(SKUS.res10k)}&sku=${encodeURIComponent(SKUS.cap100n)}&layout=a5`;
				const res = await env.request({ url });
				expect(res.status).toBe(200);
				expect(String(res.headers['content-type'])).toContain('text/html');
				const html = await res.text();
				expect(html).toContain(SKUS.res10k);
				expect(html).toContain(SKUS.cap100n);
				expect(html).toContain('10kΩ resistor 1%');
				expect(html).toContain('100nF ceramic capacitor');
				expect(html).toContain('A3-12');
				expect(html).toContain('<svg');

				const res46 = await env.request({
					url: `/api/labels/print?sku=${encodeURIComponent(SKUS.res10k)}&layout=4x6`,
				});
				const html46 = await res46.text();
				expect(html46).toContain('4in 6in');
			} finally {
				await env.teardown();
			}
		});

		it('print sheet tolerates unknown SKUs', async () => {
			const env = await makeEnv(engine);
			try {
				await createFixtureItems(env);
				const res = await env.request({ url: `/api/labels/print?sku=DOES-NOT-EXIST&layout=a5` });
				expect(res.status).toBe(200);
				const html = await res.text();
				expect(html).toContain('DOES-NOT-EXIST');
				expect(html).toContain('Unknown item');
				expect(html).toContain('<svg');
			} finally {
				await env.teardown();
			}
		});
	});
}

labelsSuite('sqlite');

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
	labelsSuite('postgres');
} else {
	describe('[api: postgres] labels', () => {
		it('postgres not reachable — set TEST_POSTGRES_URL or start docker compose', () => {});
	});
}
