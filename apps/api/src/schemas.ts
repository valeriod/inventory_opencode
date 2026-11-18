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

export const listMovementsQuery = z.object({
	limit: z.coerce.number().int().min(1).max(500).optional(),
	offset: z.coerce.number().int().min(0).optional(),
});

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

export const createProjectBody = z
	.object({
		name: z.string().min(1).max(200),
		description: z.string().max(5000).nullish(),
	})
	.strict();

export const updateProjectBody = z
	.object({
		name: z.string().min(1).max(200).optional(),
		description: z.string().max(5000).nullish(),
		status: z.enum(['active', 'closed']).optional(),
	})
	.strict()
	.refine((o) => Object.keys(o).length > 0, { message: 'update body must not be empty' });

export const createAllocationBody = z
	.object({
		projectId: z.string().min(1),
		sku: z.string().min(1),
		quantity: z.number().positive(),
		note: z.string().max(1000).nullish(),
	})
	.strict();

export const updateAllocationBody = z
	.object({
		release: z.literal(true).optional(),
		quantity: z.number().positive().optional(),
		note: z.string().max(1000).nullish(),
	})
	.strict()
	.refine((o) => o.release === true || o.quantity !== undefined, {
		message: 'provide quantity and/or release: true',
	});

export const listAllocationsQuery = z.object({
	activeOnly: z
		.enum(['true', 'false', '1', '0'])
		.transform((v) => v === 'true' || v === '1')
		.optional(),
});

export const summaryReportQuery = z.object({
	groupBy: z.enum(['category', 'location']).optional(),
	category: z.string().min(1).optional(),
});

export const lowStockReportQuery = z.object({
	threshold: z.coerce.number().optional(),
	category: z.string().min(1).optional(),
});

export const movementsReportQuery = z.object({
	sku: z.string().min(1).optional(),
	from: z.string().min(1).optional(),
	to: z.string().min(1).optional(),
	limit: z.coerce.number().int().min(1).max(2000).optional(),
});

export const projectsReportQuery = z.object({
	status: z.enum(['active', 'closed']).optional(),
});

export const exportReportQuery = z.object({
	report: z.enum(['summary', 'movements']),
	groupBy: z.enum(['category', 'location']).optional(),
	category: z.string().min(1).optional(),
	sku: z.string().min(1).optional(),
	from: z.string().min(1).optional(),
	to: z.string().min(1).optional(),
});

export const labelItemQuery = z.object({
	format: z.enum(['png', 'svg']).optional(),
	size: z.enum(['code128', 'qr']).optional(),
});

export const labelsPrintQuery = z.object({
	sku: z.preprocess(
		(v) => (Array.isArray(v) ? v : v === undefined ? [] : [v]),
		z.array(z.string().min(1)).max(200),
	),
	layout: z.enum(['a5', '4x6']).optional(),
});

export type CreateItemBody = z.infer<typeof createItemBody>;
export type UpdateItemBody = z.infer<typeof updateItemBody>;
export type MoveItemBody = z.infer<typeof moveItemBody>;
