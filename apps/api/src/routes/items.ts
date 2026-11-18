import type { FastifyInstance } from 'fastify';
import {
	availableQuantity,
	createItem,
	deleteItem,
	getCategory,
	getItem,
	moveItem,
	NotFoundError,
	searchItems,
	updateItem,
	type Db,
} from '@inventory/db';
import { createItemBody, listItemsQuery, moveItemBody, updateItemBody } from '../schemas.js';

/** Extract `field[key]=value` query params into a plain object. */
function extractFieldFilters(query: Record<string, unknown>): Record<string, string> {
	const filters: Record<string, string> = {};
	for (const [key, value] of Object.entries(query)) {
		const match = /^field\[(.+)\]$/.exec(key);
		if (!match) continue;
		const v = Array.isArray(value) ? value[0] : value;
		if (typeof v === 'string') filters[match[1]] = v;
	}
	return filters;
}

export function registerItemsRoutes(app: FastifyInstance, db: Db): void {
	app.get('/api/items', async (req) => {
		const params = listItemsQuery.parse(req.query);
		const result = await searchItems(db, {
			q: params.q ?? params.search,
			categoryId: params.category,
			location: params.location,
			minQty: params.minQty,
			fieldFilters: extractFieldFilters(req.query as Record<string, unknown>),
			sort: params.sort,
			page: params.page,
			pageSize: params.pageSize,
		});
		return result;
	});

	app.get('/api/items/:sku', async (req) => {
		const { sku } = req.params as { sku: string };
		const item = await getItem(db, sku);
		if (!item) throw new NotFoundError('item', sku);
		const category = await getCategory(db, item.categoryId);
		return {
			...item,
			available: await availableQuantity(db, sku),
			category: category ? { id: category.id, name: category.name } : null,
		};
	});

	app.post('/api/items', async (req, reply) => {
		const body = createItemBody.parse(req.body);
		const item = await createItem(db, body);
		return reply.status(201).send(item);
	});

	app.patch('/api/items/:sku', async (req) => {
		const { sku } = req.params as { sku: string };
		const body = updateItemBody.parse(req.body);
		return updateItem(db, sku, body);
	});

	app.delete('/api/items/:sku', async (req, reply) => {
		const { sku } = req.params as { sku: string };
		await deleteItem(db, sku);
		return reply.status(204).send();
	});

	app.post('/api/items/:sku/move', async (req) => {
		const { sku } = req.params as { sku: string };
		const body = moveItemBody.parse(req.body);
		return moveItem(db, { sku, ...body });
	});
}
