import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Db } from '../client.js';
import type { Project } from '../schema/index.js';
import { projects as sqliteProjects } from '../schema/sqlite.js';
import { projects as postgresProjects } from '../schema/postgres.js';

export class NotFoundError extends Error {
	constructor(entity: string, id: string) {
		super(`${entity} not found: ${id}`);
		this.name = 'NotFoundError';
	}
}

export interface CreateProjectInput {
	name: string;
	description?: string | null;
}

export interface UpdateProjectInput {
	name?: string;
	description?: string | null;
	status?: 'active' | 'closed';
}

type RawProjectRow = Omit<Project, 'status'> & { status: string };

function normalizeProject(row: RawProjectRow): Project {
	return { ...row, status: row.status as Project['status'] };
}

export async function listProjects(db: Db): Promise<Project[]> {
	const rows: RawProjectRow[] =
		db.dialect === 'sqlite'
			? await db.db.select().from(sqliteProjects)
			: await db.db.select().from(postgresProjects);
	return rows.map(normalizeProject);
}

export async function getProject(db: Db, id: string): Promise<Project | null> {
	const rows: RawProjectRow[] =
		db.dialect === 'sqlite'
			? await db.db.select().from(sqliteProjects).where(eq(sqliteProjects.id, id))
			: await db.db.select().from(postgresProjects).where(eq(postgresProjects.id, id));
	return rows[0] ? normalizeProject(rows[0]) : null;
}

export async function createProject(db: Db, input: CreateProjectInput): Promise<Project> {
	const id = randomUUID();
	const now = new Date().toISOString();
	const values = {
		id,
		name: input.name,
		description: input.description ?? null,
		status: 'active' as const,
		createdAt: now,
		updatedAt: now,
	};
	if (db.dialect === 'sqlite') {
		await db.db.insert(sqliteProjects).values(values);
	} else {
		await db.db.insert(postgresProjects).values(values);
	}
	const created = await getProject(db, id);
	if (!created) throw new Error(`project ${id} not found after insert`);
	return created;
}

export async function updateProject(
	db: Db,
	id: string,
	input: UpdateProjectInput,
): Promise<Project> {
	const current = await getProject(db, id);
	if (!current) throw new NotFoundError('project', id);
	const now = new Date().toISOString();
	const values = {
		name: input.name ?? current.name,
		description: input.description !== undefined ? input.description : current.description,
		status: input.status ?? current.status,
		updatedAt: now,
	};
	if (db.dialect === 'sqlite') {
		await db.db.update(sqliteProjects).set(values).where(eq(sqliteProjects.id, id));
	} else {
		await db.db.update(postgresProjects).set(values).where(eq(postgresProjects.id, id));
	}
	const updated = await getProject(db, id);
	if (!updated) throw new Error(`project ${id} not found after update`);
	return updated;
}
