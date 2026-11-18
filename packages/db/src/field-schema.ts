import { z } from 'zod';

export const FIELD_TYPES = [
	'string',
	'number',
	'integer',
	'boolean',
	'select',
	'date',
	'currency',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

/** One entry of a category's `field_schema` JSON (plan §3.1). */
export const fieldDefinition = z
	.object({
		key: z
			.string()
			.regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/, 'field key must start with a letter, max 64 chars'),
		label: z.string().min(1).max(120),
		type: z.enum(FIELD_TYPES),
		required: z.boolean().default(false),
		options: z.array(z.string().min(1).max(120)).min(2).max(100).optional(),
		unit: z.string().max(20).optional(),
		min: z.number().optional(),
		max: z.number().nullable().optional(),
		searchable: z.boolean().default(false),
	})
	.strict()
	.refine((f) => f.type !== 'select' || (f.options?.length ?? 0) >= 2, {
		message: 'select fields require at least 2 options',
		path: ['options'],
	});

/** An ordered list of field definitions (plan §3.1). */
export const fieldSchemaList = z
	.array(fieldDefinition)
	.max(100)
	.refine((fields) => new Set(fields.map((f) => f.key)).size === fields.length, {
		message: 'field keys must be unique within a category',
	});

/**
 * Field definitions as authored / stored (pre-defaults shape). Defaults
 * (`required: false`, `searchable: false`) are applied by Zod on parse.
 */
export type FieldDefinition = z.input<typeof fieldDefinition>;
export type FieldSchema = FieldDefinition[];

/**
 * SKU pattern (plan §10 risk table, extended with `%` so the plan's own
 * example SKUs like `RES-10K-5%` validate).
 */
export const SKU_PATTERN = /^[A-Z0-9][A-Z0-9-%]{2,31}$/;

export const skuSchema = z
	.string()
	.trim()
	.regex(
		SKU_PATTERN,
		'SKU must be 3-32 chars of A-Z, 0-9, - or % and start with a letter or digit',
	);

/**
 * Build a strict Zod object schema that validates an item's `data` blob
 * against a category's field schema. Unknown keys are rejected.
 */
export function buildItemDataValidator(schema: FieldSchema) {
	const shape: Record<string, z.ZodType> = {};
	for (const f of schema) {
		let v: z.ZodType;
		switch (f.type) {
			case 'string':
				v = z.string().trim().min(1).max(2000);
				break;
			case 'number':
			case 'currency':
				v = z.number();
				break;
			case 'integer':
				v = z.number().int();
				break;
			case 'boolean':
				v = z.boolean();
				break;
			case 'select':
				v = z.enum(f.options as [string, ...string[]]);
				break;
			case 'date':
				v = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');
				break;
		}
		if (f.type === 'number' || f.type === 'integer' || f.type === 'currency') {
			if (f.min !== undefined)
				v = z.number().min(f.min, `value below minimum ${f.min}`) as z.ZodType;
			if (f.max !== null && f.max !== undefined)
				v = z.number().max(f.max, `value above maximum ${f.max}`) as z.ZodType;
			if (f.type === 'currency') v = z.number().min(0, 'cost cannot be negative') as z.ZodType;
		}
		shape[f.key] = f.required ? v : (v.optional() as z.ZodType);
	}
	return z.object(shape).strict();
}

/** Validate (and clean) an item's data blob against its category schema. */
export function validateItemData(schema: FieldSchema, data: unknown) {
	const validator = buildItemDataValidator(schema);
	const result = validator.safeParse(data ?? {});
	if (!result.success) {
		const details = result.error.issues
			.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
			.join('; ');
		throw new Error(`invalid item data: ${details}`);
	}
	return result.data as Record<string, unknown>;
}
