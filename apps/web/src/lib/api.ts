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
		const qs = new URLSearchParams();
		for (const [key, value] of Object.entries(params)) {
			if (value !== undefined && value !== '') qs.set(key, String(value));
		}
		const s = qs.toString();
		return request<ItemListResult>(`/items${s ? `?${s}` : ''}`);
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
};
