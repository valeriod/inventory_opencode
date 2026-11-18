export { createDb, closeDb, type Db, type SqliteHandle, type PostgresHandle } from './client.js';
export type { SqliteDb, PostgresDb } from './client.js';
export { runMigrations } from './migrate.js';
export { seedCategories, SEED_CATEGORIES, type SeedCategory } from './seed.js';
export {
	FIELD_TYPES,
	fieldDefinition,
	fieldSchemaList,
	skuSchema,
	SKU_PATTERN,
	buildItemDataValidator,
	validateItemData,
	type FieldType,
	type FieldDefinition,
	type FieldSchema,
} from './field-schema.js';
export * from './repositories/index.js';
export type {
	Category,
	Item,
	Project,
	Allocation,
	Movement,
	MovementReason,
} from './schema/index.js';
export { MOVEMENT_REASONS } from './schema/index.js';
