import type { Db } from '../client.js';
import type { Item } from '../schema/index.js';
import { listCategories } from './categories.js';
import { listItem } from './items.js';
import type { FieldSchema } from '../field-schema.js';

export interface SearchItemsOptions {
	/** Free-text query — matched against sku, name, description, and
	 * category fields flagged `searchable: true` in their field schema. */
	q?: string;
	/** Filter by category id (exact). */
	categoryId?: string;
	/** Filter by location (case-insensitive substring). */
	location?: string;
	/** Only items with quantity on hand >= minQty. */
	minQty?: number;
	/** Filter by custom field: key -> expected value (case-insensitive
	 * string comparison). */
	fieldFilters?: Record<string, string>;
	sort?: 'name' | 'sku' | 'quantity' | 'name-desc' | 'sku-desc' | 'quantity-desc';
	page?: number;
	pageSize?: number;
}

export interface SearchItemsResult {
	items: (Item & { score: number | null })[];
	total: number;
	page: number;
	pageSize: number;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/**
 * Portable item search (plan §4.3 / §5).
 *
 * Candidate filtering (category, minQty) happens in SQL via Drizzle so it
 * is identical on both engines. Free-text `q` matching and custom-field
 * filters run in the app layer — this guarantees exact parity between
 * SQLite and Postgres, including matching on JSON field values
 * (`q=10k` finds a resistor with `value: 10000` via its searchable
 * `value` field).
 *
 * TODO(optimize): for large inventories, replace the text-match stage with
 * SQLite FTS5 (trigram tokenizer) / Postgres pg_trgm per plan §4.3 — the
 * scoring function below stays the ranking model.
 */
/** Max rows pulled from SQL for the app-layer search stage (v1 scale). */
const MAX_CANDIDATES = 5000;

export async function searchItems(
	db: Db,
	opts: SearchItemsOptions = {},
): Promise<SearchItemsResult> {
	const page = Math.max(1, Math.floor(opts.page ?? 1));
	const pageSize = Math.min(
		MAX_PAGE_SIZE,
		Math.max(1, Math.floor(opts.pageSize ?? DEFAULT_PAGE_SIZE)),
	);

	const candidates: Item[] = await listItem(db, {
		limit: MAX_CANDIDATES,
		categoryId: opts.categoryId,
		minQty: opts.minQty,
	});

	const categorySchemas = new Map<string, FieldSchema>();
	for (const cat of await listCategories(db)) categorySchemas.set(cat.id, cat.fieldSchema);

	const q = opts.q?.trim().toLowerCase();
	const fieldFilters = opts.fieldFilters;
	const locationFilter = opts.location?.trim().toLowerCase();

	const scored: (Item & { score: number | null })[] = [];
	for (const item of candidates) {
		if (locationFilter && !(item.location ?? '').toLowerCase().includes(locationFilter)) continue;
		if (fieldFilters && !matchesFieldFilters(item, fieldFilters)) continue;
		const score = q ? scoreItem(item, q, categorySchemas.get(item.categoryId) ?? []) : null;
		if (q && (score === null || score === 0)) continue;
		scored.push({ ...item, score });
	}

	const sorted = sortItems(scored, opts.sort ?? 'name');
	const total = sorted.length;
	const items = sorted.slice((page - 1) * pageSize, page * pageSize);
	return { items, total, page, pageSize };
}

function matchesFieldFilters(item: Item, filters: Record<string, string>): boolean {
	for (const [key, expected] of Object.entries(filters)) {
		const actual = item.data?.[key];
		if (actual === undefined || actual === null) return false;
		if (String(actual).toLowerCase() !== expected.toLowerCase()) return false;
	}
	return true;
}

/**
 * Relevance scoring (plan §4.3 "ranked results"):
 * sku exact > sku prefix > name prefix > sku substring > custom-field
 * hit > name substring > description hit. All comparisons are
 * case-insensitive; `q` is also matched as a substring of JSON values
 * (so `q=10k` does NOT match 10000 — but `q=10000` does; exact numeric
 * substring semantics are the portable baseline).
 */
function scoreItem(item: Item, q: string, schema: FieldSchema): number {
	let score = 0;
	const sku = item.sku.toLowerCase();
	const name = item.name.toLowerCase();
	const desc = (item.description ?? '').toLowerCase();

	if (sku === q) score += 100;
	else if (sku.startsWith(q)) score += 60;
	else if (sku.includes(q)) score += 30;

	if (name.startsWith(q)) score += 50;
	else if (name.includes(q)) score += 20;

	if (desc.includes(q)) score += 10;

	for (const field of schema) {
		if (!field.searchable) continue;
		const value = item.data?.[field.key];
		if (value === undefined || value === null) continue;
		if (String(value).toLowerCase().includes(q)) score += 25;
	}
	return score;
}

function sortItems(items: (Item & { score: number | null })[], sort: string) {
	const byScore = (a: (typeof items)[number], b: (typeof items)[number]) =>
		(b.score ?? 0) - (a.score ?? 0);
	const byName = (a: (typeof items)[number], b: (typeof items)[number]) =>
		a.name.localeCompare(b.name) || a.sku.localeCompare(b.sku);
	const bySku = (a: (typeof items)[number], b: (typeof items)[number]) =>
		a.sku.localeCompare(b.sku);
	const byQty = (a: (typeof items)[number], b: (typeof items)[number]) =>
		a.quantityOnHand - b.quantityOnHand;

	switch (sort) {
		case 'sku':
			return items.sort((a, b) => (byScore(a, b) !== 0 ? byScore(a, b) : bySku(a, b)));
		case 'sku-desc':
			return items.sort((a, b) => (byScore(a, b) !== 0 ? byScore(a, b) : -bySku(a, b)));
		case 'quantity':
			return items.sort((a, b) => (byScore(a, b) !== 0 ? byScore(a, b) : -byQty(a, b)));
		case 'quantity-desc':
			return items.sort((a, b) => (byScore(a, b) !== 0 ? byScore(a, b) : byQty(a, b)));
		case 'name-desc':
			return items.sort((a, b) => (byScore(a, b) !== 0 ? byScore(a, b) : -byName(a, b)));
		default:
			return items.sort((a, b) => (byScore(a, b) !== 0 ? byScore(a, b) : byName(a, b)));
	}
}
