import { randomUUID } from 'node:crypto';
import type { Db } from './client.js';
import { fieldSchemaList, type FieldSchema } from './field-schema.js';
import { categories as sqliteCategories } from './schema/sqlite.js';
import { categories as postgresCategories } from './schema/postgres.js';

export interface SeedCategory {
	name: string;
	description: string;
	fieldSchema: FieldSchema;
}

/** Seed categories per plan §3.6. */
export const SEED_CATEGORIES: SeedCategory[] = [
	{
		name: 'Resistors',
		description: 'Fixed resistors',
		fieldSchema: [
			{
				key: 'value',
				label: 'Resistance value',
				type: 'number',
				required: true,
				unit: 'Ω',
				searchable: true,
				min: 0,
			},
			{ key: 'tolerance', label: 'Tolerance', type: 'select', options: ['5%', '1%', '0.1%'] },
			{
				key: 'powerRating',
				label: 'Power rating',
				type: 'select',
				options: ['0.125W', '0.25W', '0.5W', '1W', '2W', '5W'],
			},
			{
				key: 'package',
				label: 'Package',
				type: 'select',
				options: ['0402', '0603', '0805', '1206', '1210', 'axial', 'through-hole'],
			},
			{ key: 'voltageRating', label: 'Voltage rating (V)', type: 'number', min: 0 },
		],
	},
	{
		name: 'Capacitors',
		description: 'Fixed capacitors',
		fieldSchema: [
			{
				key: 'capacitance',
				label: 'Capacitance',
				type: 'number',
				required: true,
				unit: 'µF',
				searchable: true,
				min: 0,
			},
			{
				key: 'type',
				label: 'Type',
				type: 'select',
				options: ['ceramic', 'electrolytic', 'tantalum', 'film'],
			},
			{ key: 'voltageRating', label: 'Voltage rating (V)', type: 'number', min: 0 },
			{ key: 'tolerance', label: 'Tolerance', type: 'select', options: ['20%', '10%', '5%', '1%'] },
			{ key: 'esr', label: 'ESR (Ω)', type: 'number', min: 0 },
			{ key: 'package', label: 'Package', type: 'string' },
		],
	},
	{
		name: 'Inductors / Coils',
		description: 'Inductors and coils',
		fieldSchema: [
			{
				key: 'inductance',
				label: 'Inductance',
				type: 'number',
				required: true,
				unit: 'µH',
				searchable: true,
				min: 0,
			},
			{ key: 'dcr', label: 'DCR (Ω)', type: 'number', min: 0 },
			{ key: 'saturationCurrent', label: 'Saturation current (A)', type: 'number', min: 0 },
			{ key: 'package', label: 'Package', type: 'string' },
		],
	},
	{
		name: 'Diodes / Semiconductors',
		description: 'Diodes, LEDs, transistors',
		fieldSchema: [
			{ key: 'partNumber', label: 'Part number', type: 'string', required: true, searchable: true },
			{
				key: 'type',
				label: 'Type',
				type: 'select',
				options: ['rectifier', 'schottky', 'zener', 'led', 'transistor', 'diode'],
			},
			{ key: 'maxCurrent', label: 'Max current (A)', type: 'number', min: 0 },
			{ key: 'maxVoltage', label: 'Max voltage (V)', type: 'number', min: 0 },
			{ key: 'package', label: 'Package', type: 'string' },
		],
	},
	{
		name: 'ICs',
		description: 'Integrated circuits',
		fieldSchema: [
			{ key: 'partNumber', label: 'Part number', type: 'string', required: true, searchable: true },
			{ key: 'manufacturer', label: 'Manufacturer', type: 'string' },
			{ key: 'package', label: 'Package', type: 'string' },
			{ key: 'function', label: 'Function', type: 'string' },
			{ key: 'datasheetUrl', label: 'Datasheet URL', type: 'string' },
		],
	},
	{
		name: 'Wire & Cable',
		description: 'Wire and cable, quantity in meters',
		fieldSchema: [
			{ key: 'gauge', label: 'Gauge / size', type: 'string', required: true, searchable: true },
			{
				key: 'conductorMaterial',
				label: 'Conductor material',
				type: 'select',
				options: ['copper', 'aluminum'],
			},
			{ key: 'insulation', label: 'Insulation', type: 'string' },
			{ key: 'voltageRating', label: 'Voltage rating (V)', type: 'number', min: 0 },
			{ key: 'color', label: 'Color', type: 'string', searchable: true },
			{ key: 'metersPerRoll', label: 'Meters per roll', type: 'number', min: 0, unit: 'm' },
		],
	},
	{
		name: 'Connectors',
		description: 'Headers, receptacles, terminals',
		fieldSchema: [
			{
				key: 'type',
				label: 'Type',
				type: 'select',
				options: ['header', 'receptacle', 'terminal'],
			},
			{ key: 'pitch', label: 'Pitch (mm)', type: 'number', min: 0 },
			{ key: 'pinCount', label: 'Pin count', type: 'integer', min: 1 },
			{ key: 'gender', label: 'Gender', type: 'select', options: ['male', 'female'] },
			{ key: 'mounting', label: 'Mounting', type: 'select', options: ['through-hole', 'surface'] },
		],
	},
	{
		name: 'Fasteners',
		description: 'Screws, nuts, bolts, standoffs',
		fieldSchema: [
			{ key: 'size', label: 'Size', type: 'string', required: true, searchable: true },
			{ key: 'threadPitch', label: 'Thread pitch', type: 'string' },
			{ key: 'material', label: 'Material', type: 'string' },
			{
				key: 'standard',
				label: 'Standard',
				type: 'select',
				options: ['ISO', 'DIN', 'ANSI/ASME', 'JIS'],
			},
			{
				key: 'headType',
				label: 'Head type',
				type: 'select',
				options: ['hex', 'socket', 'phillips', 'slotted'],
			},
		],
	},
	{
		name: 'PCBs',
		description: 'Printed circuit boards',
		fieldSchema: [
			{ key: 'dimensions', label: 'Dimensions (WxH mm)', type: 'string' },
			{ key: 'layerCount', label: 'Layer count', type: 'integer', min: 1 },
			{ key: 'thickness', label: 'Thickness (mm)', type: 'number', min: 0 },
			{
				key: 'surfaceFinish',
				label: 'Surface finish',
				type: 'select',
				options: ['HASL', 'ENIG', 'OSP', 'immersion tin'],
			},
		],
	},
	{
		name: 'Tools',
		description: 'Hand tools and instruments',
		fieldSchema: [
			{ key: 'brand', label: 'Brand', type: 'string' },
			{ key: 'model', label: 'Model', type: 'string', required: true, searchable: true },
			{
				key: 'category',
				label: 'Category',
				type: 'select',
				options: ['hand', 'measuring', 'soldering', 'power'],
			},
			{
				key: 'condition',
				label: 'Condition',
				type: 'select',
				options: ['new', 'good', 'fair', 'worn'],
			},
			{ key: 'calibrationDue', label: 'Calibration due', type: 'date' },
		],
	},
];

export interface SeedResult {
	inserted: number;
	skipped: number;
}

/**
 * Idempotently insert the seed categories (matched by name).
 * Returns how many were inserted vs. already present.
 */
export async function seedCategories(db: Db): Promise<SeedResult> {
	const existing =
		db.dialect === 'sqlite'
			? await db.db.select().from(sqliteCategories)
			: await db.db.select().from(postgresCategories);
	const present = new Set(existing.map((c) => c.name));

	let inserted = 0;
	let skipped = 0;
	const now = new Date().toISOString();
	for (const seed of SEED_CATEGORIES) {
		if (present.has(seed.name)) {
			skipped += 1;
			continue;
		}
		fieldSchemaList.parse(seed.fieldSchema);
		if (db.dialect === 'sqlite') {
			await db.db.insert(sqliteCategories).values({
				id: randomUUID(),
				name: seed.name,
				description: seed.description,
				fieldSchema: JSON.stringify(seed.fieldSchema),
				createdAt: now,
				updatedAt: now,
			});
		} else {
			await db.db.insert(postgresCategories).values({
				id: randomUUID(),
				name: seed.name,
				description: seed.description,
				fieldSchema: seed.fieldSchema,
				createdAt: now,
				updatedAt: now,
			});
		}
		inserted += 1;
	}
	return { inserted, skipped };
}

/** CLI: `pnpm --filter @inventory/db seed` — migrates + seeds the configured database. */
if (process.argv[1] && import.meta.url.endsWith('seed.ts') && process.argv[1].endsWith('seed.ts')) {
	const { createDb, closeDb } = await import('./client.js');
	const { runMigrations } = await import('./migrate.js');
	const handle = createDb();
	try {
		await runMigrations(handle);
		const result = await seedCategories(handle);
		console.log(
			`seeded categories: ${result.inserted} inserted, ${result.skipped} already present`,
		);
	} finally {
		await closeDb(handle);
	}
}
