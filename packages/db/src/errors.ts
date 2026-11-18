import type { Db } from './client.js';

/** A write failed because a unique value already exists (→ HTTP 409). */
export class ConflictError extends Error {
	constructor(entity: string, id: string, detail?: string) {
		super(`${entity} already exists: ${id}${detail ? ` (${detail})` : ''}`);
		this.name = 'ConflictError';
	}
}

/**
 * Detect a unique-constraint violation portably across both drivers.
 * Drizzle wraps driver errors, so the original may sit on `err.cause`.
 * - better-sqlite3: `SQLITE_CONSTRAINT_UNIQUE`
 * - postgres.js:   SQLSTATE `23505` (unique_violation)
 */
export function isUniqueViolation(db: Db, err: unknown): boolean {
	const chain: unknown[] = [err, (err as { cause?: unknown })?.cause];
	for (const e of chain) {
		const c = e as { code?: string; message?: string } | null;
		if (!c) continue;
		if (db.dialect === 'sqlite') {
			if (c.code === 'SQLITE_CONSTRAINT_UNIQUE') return true;
		} else if (c.code === '23505') {
			return true;
		}
		if (/UNIQUE constraint failed/i.test(c.message ?? '')) return true;
		if (/duplicate key value violates unique constraint/i.test(c.message ?? '')) return true;
	}
	return false;
}
