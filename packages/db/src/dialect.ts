import type { Db } from './client.js';

/**
 * JSON column handling (plan §4.2): Postgres uses `jsonb`, SQLite stores
 * JSON as text. All encode/decode goes through these helpers so the
 * repositories stay dialect-agnostic above this layer.
 */

export function encodeJson(db: Db, value: unknown): unknown {
	return db.dialect === 'sqlite' ? JSON.stringify(value) : value;
}

export function decodeJson<T>(db: Db, value: unknown): T | null {
	if (value === null || value === undefined) return null;
	if (typeof value === 'string') return JSON.parse(value) as T;
	return value as T;
}
