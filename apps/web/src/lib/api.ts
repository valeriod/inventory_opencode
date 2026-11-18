import type { FieldDefinition } from '@inventory/db';

export interface Category {
	id: string;
	name: string;
	description: string | null;
	fieldSchema: FieldDefinition[];
	createdAt: string;
	updatedAt: string;
}

export interface Item {
	sku: string;
	categoryId: string;
	name: string;
	description: string | null;
	unit: string | null;
	quantityOnHand: number;
	unitCost: number | null;
	location: string | null;
	data: Record<string, unknown> | null;
	createdAt: string;
	updatedAt: string;
}

export interface ItemDetail extends Item {
	available: number;
	category: { id: string; name: string } | null;
}

export interface Movement {
	id: number;
	sku: string;
	delta: number;
	resultingQty: number;
	reason: string;
	projectId: string | null;
	reference: string | null;
	createdAt: string;
}

export interface ItemListResult {
	items: Item[];
	total: number;
	page: number;
	pageSize: number;
}

export interface Project {
	id: string;
	name: string;
	description: string | null;
	status: 'active' | 'closed';
	createdAt: string;
	updatedAt: string;
}

export interface ProjectSummary extends Project {
	activeAllocations: number;
	reservedQuantity: number;
}

export interface Allocation {
	id: string;
	projectId: string;
	sku: string;
	quantity: number;
	note: string | null;
	reservedAt: string;
	releasedAt: string | null;
}

export interface ProjectDetail extends ProjectSummary {
	allocations: Allocation[];
	history: Allocation[];
}

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

export interface MovementReportRow {
	id: number;
	sku: string;
	itemName: string | null;
	delta: number;
	resultingQty: number;
	reason: string | null;
	projectId: string | null;
	reference: string | null;
	createdAt: string;
}

export interface MovementsReport {
	rows: MovementReportRow[];
}

export interface ProjectReportRow {
	id: string;
	name: string;
	description: string | null;
	status: 'active' | 'closed';
	activeAllocations: number;
	reservedQuantity: number;
	createdAt: string;
	updatedAt: string;
}

export interface ProjectsReport {
	rows: ProjectReportRow[];
}

export class ApiError extends Error {
	constructor(
		public status: number,
		public body: { error: string; message: string; issues?: unknown[] },
	) {
		super(body.message);
		this.name = 'ApiError';
	}

	get issues(): unknown[] {
		return this.body.issues ?? [];
	}
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`/api${path}`, {
		...init,
		headers: init?.body ? { 'content-type': 'application/json' } : undefined,
	});
	const text = await res.text();
	const body: unknown = text ? JSON.parse(text) : null;
	if (!res.ok) {
		const errBody = (body ?? { error: 'request_error', message: res.statusText }) as {
			error: string;
			message: string;
			issues?: unknown[];
		};
		throw new ApiError(res.status, errBody);
	}
	return body as T;
}

function itemPath(sku: string): string {
	return `/items/${encodeURIComponent(sku)}`;
}

function qs(params: Record<string, string | number | undefined | null>): string {
	const sp = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
	}
	const s = sp.toString();
	return s ? `?${s}` : '';
}

export interface ListItemsParams {
	q?: string;
	category?: string;
	location?: string;
	minQty?: number;
	sort?: string;
	page?: number;
	pageSize?: number;
}

export const api = {
	listItems(params: ListItemsParams = {}): Promise<ItemListResult> {
		return request<ItemListResult>(`/items${qs(params as Record<string, string | number | undefined>)}`);
	},
	getItem: (sku: string) => request<ItemDetail>(itemPath(sku)),
	createItem: (body: unknown) =>
		request<Item>('/items', { method: 'POST', body: JSON.stringify(body) }),
	updateItem: (sku: string, body: unknown) =>
		request<Item>(itemPath(sku), { method: 'PATCH', body: JSON.stringify(body) }),
	deleteItem: (sku: string) => request<null>(itemPath(sku), { method: 'DELETE' }).then(() => null),
	moveItem: (sku: string, body: unknown) =>
		request<{ item: Item; movement: Movement }>(`${itemPath(sku)}/move`, {
			method: 'POST',
			body: JSON.stringify(body),
		}),
	listMovements: (sku: string) => request<{ movements: Movement[] }>(`${itemPath(sku)}/movements`),

	listCategories: () => request<{ categories: Category[] }>('/categories'),
	getCategory: (id: string) => request<{ category: Category }>(`/categories/${id}`),
	createCategory: (body: unknown) =>
		request<{ category: Category }>('/categories', { method: 'POST', body: JSON.stringify(body) }),
	updateCategory: (id: string, body: unknown) =>
		request<{ category: Category; warnings: string[] }>(`/categories/${id}`, {
			method: 'PATCH',
			body: JSON.stringify(body),
		}),

	listProjects: () => request<{ projects: ProjectSummary[] }>('/projects'),
	getProject: (id: string) => request<{ project: ProjectDetail }>(`/projects/${id}`),
	createProject: (body: unknown) =>
		request<{ project: Project }>('/projects', { method: 'POST', body: JSON.stringify(body) }),
	updateProject: (id: string, body: unknown) =>
		request<{ project: Project }>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

	createAllocation: (body: unknown) =>
		request<{ allocation: Allocation }>('/allocations', {
			method: 'POST',
			body: JSON.stringify(body),
		}),
	getAllocation: (id: string) => request<{ allocation: Allocation }>(`/allocations/${id}`),
	updateAllocation: (id: string, body: unknown) =>
		request<{ allocation: Allocation }>(`/allocations/${id}`, {
			method: 'PATCH',
			body: JSON.stringify(body),
		}),

	getSummaryReport: (params: { groupBy?: 'category' | 'location'; category?: string } = {}) =>
		request<SummaryReport>(`/reports/summary${qs(params)}`),
	getLowStockReport: (params: { threshold?: number; category?: string } = {}) =>
		request<LowStockReport>(`/reports/low-stock${qs(params)}`),
	getMovementsReport: (params: { sku?: string; from?: string; to?: string; limit?: number } = {}) =>
		request<MovementsReport>(`/reports/movements${qs(params)}`),
	getProjectsReport: (params: { status?: 'active' | 'closed' } = {}) =>
		request<ProjectsReport>(`/reports/projects${qs(params)}`),
	exportCsvUrl: (params: {
		report: 'summary' | 'movements';
		groupBy?: 'category' | 'location';
		category?: string;
		sku?: string;
		from?: string;
		to?: string;
	}) => `/api/reports/export.csv${qs(params)}`,
	itemLabelUrl: (sku: string, params: { format?: 'png' | 'svg'; size?: 'code128' | 'qr' } = {}) =>
		`/api/items/${encodeURIComponent(sku)}/label${qs(params)}`,
	labelsPrintUrl: (skus: string[], layout: 'a5' | '4x6' = 'a5') => {
		const sp = new URLSearchParams();
		for (const sku of skus) sp.append('sku', sku);
		sp.set('layout', layout);
		return `/api/labels/print?${sp.toString()}`;
	},
};
