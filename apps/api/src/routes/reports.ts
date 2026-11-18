import type { FastifyInstance } from 'fastify';
import {
	lowStockReport,
	movementsReport,
	projectsReport,
	summaryReport,
	toCsv,
	type Db,
} from '@inventory/db';
import {
	exportReportQuery,
	lowStockReportQuery,
	movementsReportQuery,
	projectsReportQuery,
	summaryReportQuery,
} from '../schemas.js';

const SUMMARY_CSV_HEADERS = ['key', 'label', 'itemCount', 'totalQuantity', 'totalValue'];
const MOVEMENTS_CSV_HEADERS = [
	'id',
	'sku',
	'itemName',
	'delta',
	'resultingQty',
	'reason',
	'projectId',
	'reference',
	'createdAt',
];

export function registerReportRoutes(app: FastifyInstance, db: Db): void {
	app.get('/api/reports/summary', async (req) => {
		const q = summaryReportQuery.parse(req.query);
		return summaryReport(db, { groupBy: q.groupBy, categoryId: q.category });
	});

	app.get('/api/reports/low-stock', async (req) => {
		const q = lowStockReportQuery.parse(req.query);
		return lowStockReport(db, { threshold: q.threshold, categoryId: q.category });
	});

	function normalizeRange(from?: string, to?: string): { from?: string; to?: string } {
		const toNorm = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999Z` : to;
		return { from, to: toNorm };
	}

	app.get('/api/reports/movements', async (req) => {
		const q = movementsReportQuery.parse(req.query);
		const range = normalizeRange(q.from, q.to);
		return movementsReport(db, { sku: q.sku, from: range.from, to: range.to, limit: q.limit });
	});

	app.get('/api/reports/projects', async (req) => {
		const q = projectsReportQuery.parse(req.query);
		return projectsReport(db, { status: q.status });
	});

	app.get('/api/reports/export.csv', async (req, reply) => {
		const q = exportReportQuery.parse(req.query);
		let csv: string;
		let filename: string;

		if (q.report === 'summary') {
			const report = await summaryReport(db, { groupBy: q.groupBy, categoryId: q.category });
			csv = toCsv(report.rows as unknown as Record<string, unknown>[], SUMMARY_CSV_HEADERS);
			filename = 'summary.csv';
		} else {
			const range = normalizeRange(q.from, q.to);
			const report = await movementsReport(db, { sku: q.sku, from: range.from, to: range.to });
			csv = toCsv(report.rows as unknown as Record<string, unknown>[], MOVEMENTS_CSV_HEADERS);
			filename = 'movements.csv';
		}

		reply.header('Content-Type', 'text/csv; charset=utf-8');
		reply.header('Content-Disposition', `attachment; filename="${filename}"`);
		return reply.send(csv);
	});
}
