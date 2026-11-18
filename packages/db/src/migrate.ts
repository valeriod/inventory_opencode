import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Db } from './client.js';

/**
 * Apply the SQL migrations generated from the matching Drizzle schema.
 * Migrations live in `drizzle/sqlite` and `drizzle/postgres` (plan §4.1).
 */
export async function runMigrations(handle: Db): Promise<void> {
	const migrationsDir = path.join(fileURLToPath(new URL('..', import.meta.url)), 'drizzle');
	if (handle.dialect === 'sqlite') {
		const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
		migrate(handle.db, { migrationsFolder: path.join(migrationsDir, 'sqlite') });
	} else {
		const { migrate } = await import('drizzle-orm/postgres-js/migrator');
		await migrate(handle.db, { migrationsFolder: path.join(migrationsDir, 'postgres') });
	}
}

/** CLI: `pnpm --filter @inventory/db migrate` — migrates the configured database. */
if (
	process.argv[1] &&
	import.meta.url.endsWith('migrate.ts') &&
	process.argv[1].endsWith('migrate.ts')
) {
	const { createDb, closeDb } = await import('./client.js');
	const handle = createDb();
	try {
		await runMigrations(handle);
		console.log(`migrations applied (${handle.dialect})`);
	} finally {
		await closeDb(handle);
	}
}
