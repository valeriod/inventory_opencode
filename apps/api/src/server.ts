import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { closeDb, createDb, runMigrations, seedCategories } from '@inventory/db';
import { buildApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

// Default SQLite location: <repo-root>/data/inventory.db (server.ts lives in
// apps/api/src), resolved from this file so the server works regardless of
// the launch directory.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const defaultDatabaseUrl = `file:${path.join(repoRoot, 'data', 'inventory.db')}`;
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = defaultDatabaseUrl;

// Bring up the database: select driver from DATABASE_URL, apply
// migrations, and idempotently seed the default categories (plan §5).
const db = createDb();
await runMigrations(db);
await seedCategories(db);

const app = buildApp(db);

await app.listen({ port, host });

async function shutdown(): Promise<void> {
	await app.close();
	await closeDb(db);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => {
		shutdown().then(
			() => process.exit(0),
			(err) => {
				console.error(err);
				process.exit(1);
			},
		);
	});
}
