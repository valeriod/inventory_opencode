import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { decodeJson } from '../dialect.js';
import { fieldSchemaList, type FieldSchema } from '../field-schema.js';
import { ConflictError, isUniqueViolation } from '../errors.js';
import type { Db } from '../client.js';
import type { Category } from '../schema/index.js';
import { categories as sqliteCategories } from '../schema/sqlite.js';
import { categories as postgresCategories } from '../schema/postgres.js';

export interface CreateCategoryInput {
	name: string;
	description?: string | null;
	fieldSchema: FieldSchema;
}

export interface UpdateCategoryInput {
	name?: string;
	description?: string | null;
	fieldSchema?: FieldSchema;
}

type RawCategoryRow = {
	id: string;
	name: string;
	description: string | null;
	fieldSchema: unknown;
	createdAt: string;
	updatedAt: string;
};

function normalize(db: Db, row: RawCategoryRow): Category {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		fieldSchema: decodeJson<FieldSchema>(db, row.fieldSchema) ?? [],
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export async function listCategories(db: Db): Promise<Category[]> {
	const rows: RawCategoryRow[] =
		db.dialect === 'sqlite'
			? await db.db.select().from(sqliteCategories)
			: await db.db.select().from(postgresCategories);
	return rows.map((r) => normalize(db, r));
}

export async function getCategory(db: Db, id: string): Promise<Category | null> {
	const rows: RawCategoryRow[] =
		db.dialect === 'sqlite'
			? await db.db.select().from(sqliteCategories).where(eq(sqliteCategories.id, id))
			: await db.db.select().from(postgresCategories).where(eq(postgresCategories.id, id));
	const row = rows[0];
	return row ? normalize(db, row) : null;
}

export async function getCategoryByName(db: Db, name: string): Promise<Category | null> {
	const rows: RawCategoryRow[] =
		db.dialect === 'sqlite'
			? await db.db.select().from(sqliteCategories).where(eq(sqliteCategories.name, name))
			: await db.db.select().from(postgresCategories).where(eq(postgresCategories.name, name));
	const row = rows[0];
	return row ? normalize(db, row) : null;
}

export async function createCategory(db: Db, input: CreateCategoryInput): Promise<Category> {
	const schema = fieldSchemaList.parse(input.fieldSchema);
	const now = new Date().toISOString();
	const id = randomUUID();
	try {
		if (db.dialect === 'sqlite') {
			await db.db.insert(sqliteCategories).values({
				id,
				name: input.name,
				description: input.description ?? null,
				fieldSchema: JSON.stringify(schema),
				createdAt: now,
				updatedAt: now,
			});
		} else {
			await db.db.insert(postgresCategories).values({
				id,
				name: input.name,
				description: input.description ?? null,
				fieldSchema: schema,
				createdAt: now,
				updatedAt: now,
			});
		}
	} catch (err) {
		if (isUniqueViolation(db, err)) throw new ConflictError('category', input.name);
		throw err;
	}
	const created = await getCategory(db, id);
	if (!created) throw new Error(`category ${id} not found after insert`);
	return created;
}

/**
 * Field-schema evolution (plan §5): adding a field is always allowed;
 * changing a field's type or removing one is allowed but flagged — the
 * caller (API layer) computes and surfaces the warning. Existing `data`
 * blobs keep their old values; the PWA hides fields not in the schema.
 */
export async function updateCategory(
	db: Db,
	id: string,
	input: UpdateCategoryInput,
): Promise<Category> {
	const current = await getCategory(db, id);
	if (!current) throw new Error(`category not found: ${id}`);

	const name = input.name ?? current.name;
	const description = input.description !== undefined ? input.description : current.description;
	const schema = fieldSchemaList.parse(input.fieldSchema ?? current.fieldSchema);
	const now = new Date().toISOString();

	if (db.dialect === 'sqlite') {
		await db.db
			.update(sqliteCategories)
			.set({ name, description, fieldSchema: JSON.stringify(schema), updatedAt: now })
			.where(eq(sqliteCategories.id, id));
	} else {
		await db.db
			.update(postgresCategories)
			.set({ name, description, fieldSchema: schema, updatedAt: now })
			.where(eq(postgresCategories.id, id));
	}
	const updated = await getCategory(db, id);
	if (!updated) throw new Error(`category ${id} not found after update`);
	return updated;
}
