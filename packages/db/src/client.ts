import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { postgresSchema, sqliteSchema } from './schema/index.js';

function createSqliteHandle(file: string) {
	const client = new Database(file);
	client.pragma('foreign_keys = ON');
	const db = drizzleSqlite(client, { schema: sqliteSchema });
	return { dialect: 'sqlite' as const, db };
}

function createPostgresHandle(url: string) {
	const client = postgres(url, { max: 10, onnotice: () => {} });
	const db = drizzlePg(client, { schema: postgresSchema });
	return { dialect: 'postgresql' as const, db };
}

/**
 * Tagged database handle — a proper discriminated union so repository
 * code narrows cleanly (`db.dialect === 'sqlite'` → `db.db` is the
 * concrete driver instance).
 */
export type SqliteHandle = ReturnType<typeof createSqliteHandle>;
export type PostgresHandle = ReturnType<typeof createPostgresHandle>;
export type Db = SqliteHandle | PostgresHandle;

export type SqliteDb = SqliteHandle['db'];
export type PostgresDb = PostgresHandle['db'];

/**
 * Pick the driver from DATABASE_URL (plan §4.1):
 * - `file:./data/inventory.db`        → SQLite (better-sqlite3)
 * - `postgres://user:pass@host/db`    → PostgreSQL (postgres.js)
 */
export function createDb(
	databaseUrl: string = process.env.DATABASE_URL ?? 'file:./data/inventory.db',
): Db {
	if (databaseUrl.startsWith('file:')) {
		const file = databaseUrl.slice('file:'.length);
		const dir = path.dirname(file);
		if (dir && dir !== '.' && dir !== '/') mkdirSync(dir, { recursive: true });
		return createSqliteHandle(file);
	}
	if (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://')) {
		return createPostgresHandle(databaseUrl);
	}
	throw new Error(`Unsupported DATABASE_URL: ${databaseUrl}`);
}

export async function closeDb(handle: Db): Promise<void> {
	if (handle.dialect === 'sqlite') {
		handle.db.$client.close();
	} else {
		await handle.db.$client.end();
	}
}
