import { z } from 'zod';
import { skuSchema } from '@inventory/db';

export const createItemBody = z
	.object({
		sku: skuSchema,
		categoryId: z.string().min(1),
		name: z.string().min(1).max(500),
		description: z.string().max(5000).nullish(),
		unit: z.string().max(50).nullish(),
		unitCost: z.number().min(0).nullish(),
		location: z.string().max(100).nullish(),
		data: z.record(z.string(), z.unknown()).nullish(),
	})
	.strict();

export const updateItemBody = z
	.object({
		categoryId: z.string().min(1).optional(),
		name: z.string().min(1).max(500).optional(),
		description: z.string().max(5000).nullish(),
		unit: z.string().max(50).nullish(),
		unitCost: z.number().min(0).nullish(),
		location: z.string().max(100).nullish(),
		data: z.record(z.string(), z.unknown()).nullish(),
	})
	.strict()
	.refine((o) => Object.keys(o).length > 0, { message: 'update body must not be empty' });

export const moveItemBody = z
	.object({
		delta: z.number().refine((v) => Number.isFinite(v) && v !== 0, {
			message: 'delta must be a non-zero finite number',
		}),
		reason: z.enum(['received', 'used', 'adjusted', 'counted']),
		projectId: z.string().min(1).nullish(),
		reference: z.string().max(200).nullish(),
	})
	.strict();

/**
 * GET /api/items query string. `passthrough()` keeps the dynamic
 * `field[key]=value` filters, which are extracted separately in the route.
 */
export const listItemsQuery = z
	.object({
		q: z.string().max(200).optional(),
		search: z.string().max(200).optional(),
		category: z.string().min(1).optional(),
		location: z.string().max(100).optional(),
		minQty: z.coerce.number().optional(),
		sort: z.enum(['name', 'sku', 'quantity', 'name-desc', 'sku-desc', 'quantity-desc']).optional(),
		page: z.coerce.number().int().min(1).optional(),
		pageSize: z.coerce.number().int().min(1).max(200).optional(),
	})
	.passthrough();

export type CreateItemBody = z.infer<typeof createItemBody>;
export type UpdateItemBody = z.infer<typeof updateItemBody>;
export type MoveItemBody = z.infer<typeof moveItemBody>;
