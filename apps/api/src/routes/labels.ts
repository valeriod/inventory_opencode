import type { FastifyInstance } from 'fastify';
import bwipjs from 'bwip-js';
import { getItem, type Db } from '@inventory/db';
import { labelItemQuery, labelsPrintQuery } from '../schemas.js';
import { NotFoundError } from '@inventory/db';

function esc(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function code128Svg(text: string): string {
	return bwipjs.toSVG({
		bcid: 'code128',
		text,
		includetext: true,
		textxalign: 'center',
		scale: 2,
		height: 12,
	});
}

function qrSvg(text: string): string {
	return bwipjs.toSVG({
		bcid: 'qrcode',
		text,
		scale: 3,
	});
}

export function registerLabelRoutes(app: FastifyInstance, db: Db): void {
	app.get('/api/items/:sku/label', async (req, reply) => {
		const { sku } = req.params as { sku: string };
		const q = labelItemQuery.parse(req.query);
		const item = await getItem(db, sku);
		if (!item) throw new NotFoundError('item', sku);

		const format = q.format ?? 'png';
		const size = q.size ?? 'code128';
		const opts =
			size === 'qr'
				? ({ bcid: 'qrcode', text: item.sku, scale: 4 } as const)
				: ({
						bcid: 'code128',
						text: item.sku,
						scale: 3,
						height: 12,
						includetext: true,
						textxalign: 'center' as const,
					} as const);

		if (format === 'svg') {
			const svg = bwipjs.toSVG(opts);
			reply.header('Content-Type', 'image/svg+xml; charset=utf-8');
			reply.header('Cache-Control', 'no-store');
			return reply.send(svg);
		}

		const png = await bwipjs.toBuffer(opts);
		reply.header('Content-Type', 'image/png');
		reply.header('Cache-Control', 'no-store');
		return reply.send(png);
	});

	app.get('/api/labels/print', async (req, reply) => {
		const q = labelsPrintQuery.parse(req.query);
		const layout = q.layout ?? 'a5';
		const skus = q.sku;

		const items = await Promise.all(
			skus.map(async (s) => {
				const item = await getItem(db, s);
				return { sku: s, item };
			}),
		);

		const pageSize = layout === '4x6' ? '4in 6in' : 'A5';
		const margin = layout === '4x6' ? '0.2in' : '6mm';
		const cols = layout === '4x6' ? 2 : 2;
		const labelMinH = layout === '4x6' ? '1.7in' : '45mm';

		const cards = items
			.map(({ sku, item }) => {
				let c128: string;
				let qr: string;
				try {
					c128 = code128Svg(sku);
					qr = qrSvg(sku);
				} catch {
					c128 = `<div class="err">barcode error</div>`;
					qr = '';
				}
				const name = item ? esc(item.name) : '<em>Unknown item</em>';
				const loc = item?.location ? esc(item.location) : '—';
				const qty =
					item != null
						? `${item.quantityOnHand}${item.unit ? ` ${esc(item.unit)}` : ''}`
						: '—';
				return `<div class="label">
  <div class="top">
    <div class="name">${name}</div>
    <div class="sku">${esc(sku)}</div>
    <div class="meta"><span>Qty: ${qty}</span><span>Loc: ${loc}</span></div>
  </div>
  <div class="codes">
    <div class="code code128">${c128}</div>
    <div class="code qr">${qr}</div>
  </div>
</div>`;
			})
			.join('\n');

		const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Inventory labels (${layout.toUpperCase()})</title>
<style>
  @page { size: ${pageSize}; margin: ${margin}; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #111; }
  .sheet { display: grid; grid-template-columns: repeat(${cols}, 1fr); gap: 3mm; align-content: start; }
  .label { border: 1px dashed #999; padding: 2mm; min-height: ${labelMinH}; display: flex; flex-direction: column; justify-content: space-between; break-inside: avoid; page-break-inside: avoid; }
  .name { font-size: 10pt; font-weight: 600; line-height: 1.2; }
  .sku { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 8pt; color: #333; margin-top: 1mm; }
  .meta { font-size: 8pt; color: #444; margin-top: 1mm; display: flex; justify-content: space-between; gap: 2mm; }
  .codes { display: flex; align-items: flex-end; justify-content: space-between; gap: 2mm; margin-top: 2mm; }
  .code svg { max-width: 100%; height: auto; display: block; }
  .code128 { flex: 1 1 auto; }
  .code128 svg { width: 100%; max-height: 18mm; }
  .qr { flex: 0 0 auto; }
  .qr svg { width: 16mm; height: 16mm; }
  .err { font-size: 8pt; color: #b00; }
  @media screen { body { background: #f5f5f5; padding: 8mm; } .sheet { max-width: ${layout === '4x6' ? '4in' : '210mm'}; margin: 0 auto; background: #fff; padding: ${margin}; } }
  @media print { body { background: #fff; } }
</style>
</head>
<body>
<div class="sheet">
${cards || '<p>No SKUs provided.</p>'}
</div>
</body>
</html>`;

		reply.header('Content-Type', 'text/html; charset=utf-8');
		reply.header('Cache-Control', 'no-store');
		return reply.send(html);
	});
}
