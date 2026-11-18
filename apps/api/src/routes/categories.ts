import type { FastifyInstance } from 'fastify';
import { fieldSchemaList } from '@inventory/db';
import {
	createCategory,
	getCategory,
	listCategories,
	NotFoundError,
	updateCategory,
	type Db,
} from '@inventory/db';
import { z } from 'zod';

export const createCategoryBody = z
	.object({
		name: z.string().min(1).max(100),
		description: z.string().max(1000).nullish(),
		fieldSchema: fieldSchemaList,
	})
	.strict();

export const updateCategoryBody = z
	.object({
		name: z.string().min(1).max(100).optional(),
		description: z.string().max(1000).nullish(),
		fieldSchema: fieldSchemaList.optional(),
	})
	.strict()
	.refine((o) => Object.keys(o).length > 0, { message: 'update body must not be empty' });

interface FieldDef {
	key: string;
	type: string;
}

/**
 * Field-schema evolution warnings (plan §5): removing a field or changing
 * its type is allowed but flagged; existing `data` blobs keep old values.
 */
function evolutionWarnings(current: FieldDef[], next: FieldDef[]): string[] {
	const warnings: string[] = [];
	const prev = new Map(current.map((f) => [f.key, f.type]));
	for (const field of next) {
		if (prev.has(field.key) && prev.get(field.key) !== field.type) {
			warnings.push(`field '${field.key}' type changed ${prev.get(field.key)} -> ${field.type}`);
		}
	}
	for (const key of prev.keys()) {
		if (!next.some((f) => f.key === key)) warnings.push(`field '${key}' removed`);
	}
	return warnings;
}

export function registerCategoryRoutes(app: FastifyInstance, db: Db): void {
	app.get('/api/categories', async () => {
		return { categories: await listCategories(db) };
	});

	app.post('/api/categories', async (req, reply) => {
		const body = createCategoryBody.parse(req.body);
		const category = await createCategory(db, {
			name: body.name,
			description: body.description ?? null,
			fieldSchema: body.fieldSchema,
		});
		return reply.status(201).send({ category });
	});

	app.get('/api/categories/:id', async (req) => {
		const { id } = req.params as { id: string };
		const category = await getCategory(db, id);
		if (!category) throw new NotFoundError('category', id);
		return { category };
	});

	app.patch('/api/categories/:id', async (req) => {
		const { id } = req.params as { id: string };
		const body = updateCategoryBody.parse(req.body);
		const current = await getCategory(db, id);
		if (!current) throw new NotFoundError('category', id);

		let warnings: string[] = [];
		if (body.fieldSchema) {
			warnings = evolutionWarnings(
				current.fieldSchema.map((f) => ({ key: f.key, type: f.type })),
				body.fieldSchema.map((f) => ({ key: f.key, type: f.type })),
			);
		}
		const category = await updateCategory(db, id, {
			name: body.name,
			description: body.description,
			fieldSchema: body.fieldSchema,
		});
		return { category, warnings };
	});
}
