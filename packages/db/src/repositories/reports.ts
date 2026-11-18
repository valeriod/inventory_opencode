import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import type { MovementReason, Project } from '../schema/index.js';
import { items as sqliteItems } from '../schema/sqlite.js';
import { items as postgresItems } from '../schema/postgres.js';
import { movements as sqliteMovements } from '../schema/sqlite.js';
import { movements as postgresMovements } from '../schema/postgres.js';
import { projects as sqliteProjects } from '../schema/sqlite.js';
import { projects as postgresProjects } from '../schema/postgres.js';
import { allocations as sqliteAllocations } from '../schema/sqlite.js';
import { allocations as postgresAllocations } from '../schema/postgres.js';
import { listCategories } from './categories.js';

export interface SummaryRow {
	key: string | null;
	label: string;
	itemCount: number;
	totalQuantity: number;
	totalValue: number;
}

export interface SummaryReport {
	groupBy: 'category' | 'location';
	rows: SummaryRow[];
	totals: { itemCount: number; totalQuantity: number; totalValue: number };
}

function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}

function round4(n: number): number {
	return Math.round(n * 10000) / 10000;
}

export async function summaryReport(
	db: Db,
	opts: { groupBy?: 'category' | 'location'; categoryId?: string } = {},
): Promise<SummaryReport> {
	const groupBy = opts.groupBy ?? 'category';

	let raw: { key: string | null; itemCount: number; totalQuantity: number; totalValue: number }[];
	if (db.dialect === 'sqlite') {
		const keyExpr =
			groupBy === 'category'
				? sqliteItems.categoryId
				: sql<string | null>`coalesce(${sqliteItems.location}, '')`;
		raw = db.db
			.select({
				key: keyExpr,
				itemCount: sql<number>`count(*)`.mapWith(Number),
				totalQuantity: sql<number>`coalesce(sum(${sqliteItems.quantityOnHand}), 0)`.mapWith(Number),
				totalValue:
					sql<number>`coalesce(sum(${sqliteItems.quantityOnHand} * coalesce(${sqliteItems.unitCost}, 0)), 0)`.mapWith(
						Number,
					),
			})
			.from(sqliteItems)
			.where(opts.categoryId ? eq(sqliteItems.categoryId, opts.categoryId) : undefined)
			.groupBy(keyExpr)
			.all();
	} else {
		const keyExpr =
			groupBy === 'category'
				? postgresItems.categoryId
				: sql<string | null>`coalesce(${postgresItems.location}, '')`;
		raw = await db.db
			.select({
				key: keyExpr,
				itemCount: sql<number>`count(*)::int`.mapWith(Number),
				totalQuantity: sql<number>`coalesce(sum(${postgresItems.quantityOnHand}), 0)::float`.mapWith(
					Number,
				),
				totalValue:
					sql<number>`coalesce(sum(${postgresItems.quantityOnHand} * coalesce(${postgresItems.unitCost}, 0)), 0)::float`.mapWith(
						Number,
					),
			})
			.from(postgresItems)
			.where(opts.categoryId ? eq(postgresItems.categoryId, opts.categoryId) : undefined)
			.groupBy(keyExpr);
	}

	let labelFor: (key: string | null) => string;
	if (groupBy === 'category') {
		const cats = await listCategories(db);
		const names = new Map(cats.map((c) => [c.id, c.name]));
		labelFor = (k) => (k ? (names.get(k) ?? k) : '(unknown)');
	} else {
		labelFor = (k) => (k && k !== '' ? k : '(no location)');
	}

	const rows: SummaryRow[] = raw
		.map((r) => ({
			key: r.key,
			label: labelFor(r.key),
			itemCount: r.itemCount,
			totalQuantity: round3(Number(r.totalQuantity)),
			totalValue: round4(Number(r.totalValue)),
		}))
		.sort((a, b) => a.label.localeCompare(b.label));

	const totals = rows.reduce(
		(acc, r) => {
			acc.itemCount += r.itemCount;
			acc.totalQuantity = round3(acc.totalQuantity + r.totalQuantity);
			acc.totalValue = round4(acc.totalValue + r.totalValue);
			return acc;
		},
		{ itemCount: 0, totalQuantity: 0, totalValue: 0 },
	);

	return { groupBy, rows, totals };
}

export interface LowStockRow {
	sku: string;
	name: string;
	categoryId: string;
	categoryName: string | null;
	location: string | null;
	unit: string | null;
	quantityOnHand: number;
}

export interface LowStockReport {
	threshold: number;
	rows: LowStockRow[];
}

export async function lowStockReport(
	db: Db,
	opts: { threshold?: number; categoryId?: string } = {},
): Promise<LowStockReport> {
	const threshold = opts.threshold ?? 0;
	const cats = await listCategories(db);
	const catNames = new Map(cats.map((c) => [c.id, c.name]));

	let items: {
		sku: string;
		name: string;
		categoryId: string;
		location: string | null;
		unit: string | null;
		quantityOnHand: number;
	}[];
	if (db.dialect === 'sqlite') {
		items = db.db
			.select({
				sku: sqliteItems.sku,
				name: sqliteItems.name,
				categoryId: sqliteItems.categoryId,
				location: sqliteItems.location,
				unit: sqliteItems.unit,
				quantityOnHand: sqliteItems.quantityOnHand,
			})
			.from(sqliteItems)
			.where(
				and(
					lte(sqliteItems.quantityOnHand, threshold),
					opts.categoryId ? eq(sqliteItems.categoryId, opts.categoryId) : undefined,
				),
			)
			.orderBy(sqliteItems.quantityOnHand, sqliteItems.sku)
			.all();
	} else {
		items = await db.db
			.select({
				sku: postgresItems.sku,
				name: postgresItems.name,
				categoryId: postgresItems.categoryId,
				location: postgresItems.location,
				unit: postgresItems.unit,
				quantityOnHand: postgresItems.quantityOnHand,
			})
			.from(postgresItems)
			.where(
				and(
					lte(postgresItems.quantityOnHand, threshold),
					opts.categoryId ? eq(postgresItems.categoryId, opts.categoryId) : undefined,
				),
			)
			.orderBy(postgresItems.quantityOnHand, postgresItems.sku);
	}

	return {
		threshold,
		rows: items.map((i) => ({
			sku: i.sku,
			name: i.name,
			categoryId: i.categoryId,
			categoryName: catNames.get(i.categoryId) ?? null,
			location: i.location ?? null,
			unit: i.unit ?? null,
			quantityOnHand: round3(Number(i.quantityOnHand)),
		})),
	};
}

export interface MovementReportRow {
	id: number;
	sku: string;
	itemName: string | null;
	delta: number;
	resultingQty: number;
	reason: MovementReason | null;
	projectId: string | null;
	reference: string | null;
	createdAt: string;
}

export interface MovementsReport {
	rows: MovementReportRow[];
}

export async function movementsReport(
	db: Db,
	opts: { sku?: string; from?: string; to?: string; limit?: number } = {},
): Promise<MovementsReport> {
	const limit = Math.min(2000, Math.max(1, opts.limit ?? 500));

	type Row = {
		id: number;
		sku: string;
		itemName: string | null;
		delta: number;
		resultingQty: number;
		reason: string | null;
		projectId: string | null;
		reference: string | null;
		createdAt: string;
	};
	let rows: Row[];
	if (db.dialect === 'sqlite') {
		const conds = [
			opts.sku ? eq(sqliteMovements.sku, opts.sku) : undefined,
			opts.from ? gte(sqliteMovements.createdAt, opts.from) : undefined,
			opts.to ? lte(sqliteMovements.createdAt, opts.to) : undefined,
		];
		rows = db.db
			.select({
				id: sqliteMovements.id,
				sku: sqliteMovements.sku,
				itemName: sqliteItems.name,
				delta: sqliteMovements.delta,
				resultingQty: sqliteMovements.resultingQty,
				reason: sqliteMovements.reason,
				projectId: sqliteMovements.projectId,
				reference: sqliteMovements.reference,
				createdAt: sqliteMovements.createdAt,
			})
			.from(sqliteMovements)
			.leftJoin(sqliteItems, eq(sqliteMovements.sku, sqliteItems.sku))
			.where(and(...conds))
			.orderBy(desc(sqliteMovements.createdAt), desc(sqliteMovements.id))
			.limit(limit)
			.all() as unknown as Row[];
	} else {
		const conds = [
			opts.sku ? eq(postgresMovements.sku, opts.sku) : undefined,
			opts.from ? gte(postgresMovements.createdAt, opts.from) : undefined,
			opts.to ? lte(postgresMovements.createdAt, opts.to) : undefined,
		];
		rows = (await db.db
			.select({
				id: postgresMovements.id,
				sku: postgresMovements.sku,
				itemName: postgresItems.name,
				delta: postgresMovements.delta,
				resultingQty: postgresMovements.resultingQty,
				reason: postgresMovements.reason,
				projectId: postgresMovements.projectId,
				reference: postgresMovements.reference,
				createdAt: postgresMovements.createdAt,
			})
			.from(postgresMovements)
			.leftJoin(postgresItems, eq(postgresMovements.sku, postgresItems.sku))
			.where(and(...conds))
			.orderBy(desc(postgresMovements.createdAt), desc(postgresMovements.id))
			.limit(limit)) as unknown as Row[];
	}

	return {
		rows: rows.map((r) => ({
			id: Number(r.id),
			sku: r.sku,
			itemName: r.itemName ?? null,
			delta: Number(r.delta),
			resultingQty: Number(r.resultingQty),
			reason: (r.reason as MovementReason | null) ?? null,
			projectId: r.projectId ?? null,
			reference: r.reference ?? null,
			createdAt: r.createdAt,
		})),
	};
}

export interface ProjectReportRow {
	id: string;
	name: string;
	description: string | null;
	status: Project['status'];
	activeAllocations: number;
	reservedQuantity: number;
	createdAt: string;
	updatedAt: string;
}

export interface ProjectsReport {
	rows: ProjectReportRow[];
}

export async function projectsReport(
	db: Db,
	opts: { status?: 'active' | 'closed' } = {},
): Promise<ProjectsReport> {
	if (db.dialect === 'sqlite') {
		const prows = db.db
			.select()
			.from(sqliteProjects)
			.where(opts.status ? eq(sqliteProjects.status, opts.status) : undefined)
			.orderBy(sqliteProjects.name)
			.all();
		const stats = db.db
			.select({
				projectId: sqliteAllocations.projectId,
				activeAllocations: sql<number>`count(*)`.mapWith(Number),
				reservedQuantity: sql<number>`coalesce(sum(${sqliteAllocations.quantity}), 0)`.mapWith(
					Number,
				),
			})
			.from(sqliteAllocations)
			.where(sql`${sqliteAllocations.releasedAt} is null`)
			.groupBy(sqliteAllocations.projectId)
			.all();
		const byId = new Map(stats.map((s) => [s.projectId, s]));
		return {
			rows: prows.map((p) => {
				const s = byId.get(p.id);
				return {
					id: p.id,
					name: p.name,
					description: p.description ?? null,
					status: p.status as Project['status'],
					activeAllocations: s?.activeAllocations ?? 0,
					reservedQuantity: round3(Number(s?.reservedQuantity ?? 0)),
					createdAt: p.createdAt,
					updatedAt: p.updatedAt,
				};
			}),
		};
	}

	const prows = await db.db
		.select()
		.from(postgresProjects)
		.where(opts.status ? eq(postgresProjects.status, opts.status) : undefined)
		.orderBy(postgresProjects.name);
	const stats = await db.db
		.select({
			projectId: postgresAllocations.projectId,
			activeAllocations: sql<number>`count(*)::int`.mapWith(Number),
			reservedQuantity: sql<number>`coalesce(sum(${postgresAllocations.quantity}), 0)::float`.mapWith(
				Number,
			),
		})
		.from(postgresAllocations)
		.where(sql`${postgresAllocations.releasedAt} is null`)
		.groupBy(postgresAllocations.projectId);
	const byId = new Map(stats.map((s) => [s.projectId, s]));
	return {
		rows: prows.map((p) => {
			const s = byId.get(p.id);
			return {
				id: p.id,
				name: p.name,
				description: p.description ?? null,
				status: p.status as Project['status'],
				activeAllocations: s?.activeAllocations ?? 0,
				reservedQuantity: round3(Number(s?.reservedQuantity ?? 0)),
				createdAt: p.createdAt,
				updatedAt: p.updatedAt,
			};
		}),
	};
}

export function toCsv(rows: Record<string, unknown>[], headers?: string[]): string {
	const cols = headers ?? (rows.length > 0 ? Object.keys(rows[0]!) : []);
	if (cols.length === 0) return '';
	const escape = (v: unknown): string => {
		if (v === null || v === undefined) return '';
		const s = String(v);
		if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
		return s;
	};
	const lines = [cols.join(',')];
	for (const row of rows) lines.push(cols.map((h) => escape(row[h])).join(','));
	return lines.join('\n') + '\n';
}
