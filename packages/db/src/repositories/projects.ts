import { desc, eq, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Db } from '../client.js';
import type { Allocation, Project } from '../schema/index.js';
import { allocations as sqliteAllocations } from '../schema/sqlite.js';
import { allocations as postgresAllocations } from '../schema/postgres.js';
import { projects as sqliteProjects } from '../schema/sqlite.js';
import { projects as postgresProjects } from '../schema/postgres.js';
import { NotFoundError } from './items.js';

export interface ProjectStats {
	activeAllocations: number;
	reservedQuantity: number;
}

export interface ProjectSummary extends Project, ProjectStats {}

export interface ProjectDetail extends Project, ProjectStats {
	/** Active (not yet released) allocations — plan §5. */
	allocations: Allocation[];
	/** Released allocations for the history tab. */
	history: Allocation[];
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

function normalizeAllocation(row: Allocation): Allocation {
	return { ...row, quantity: Number(row.quantity) };
}

export async function listProjects(db: Db): Promise<Project[]> {
	const rows: RawProjectRow[] =
		db.dialect === 'sqlite'
			? await db.db.select().from(sqliteProjects)
			: await db.db.select().from(postgresProjects);
	return rows.map(normalizeProject);
}

export async function listProjectsWithStats(db: Db): Promise<ProjectSummary[]> {
	const projects = await listProjects(db);
	if (projects.length === 0) return [];

	if (db.dialect === 'sqlite') {
		const stats = db.db
			.select({
				projectId: sqliteAllocations.projectId,
				activeAllocations: sql<number>`count(*)`.mapWith(Number),
				reservedQuantity: sql<number>`coalesce(sum(${sqliteAllocations.quantity}), 0)`.mapWith(
					Number,
				),
			})
			.from(sqliteAllocations)
			.where(isNull(sqliteAllocations.releasedAt))
			.groupBy(sqliteAllocations.projectId)
			.all();
		const byId = new Map(stats.map((s) => [s.projectId, s]));
		return projects.map((p) => {
			const s = byId.get(p.id);
			return {
				...p,
				activeAllocations: s?.activeAllocations ?? 0,
				reservedQuantity: Number(s?.reservedQuantity ?? 0),
			};
		});
	}

	const stats = await db.db
		.select({
			projectId: postgresAllocations.projectId,
			activeAllocations: sql<number>`count(*)::int`.mapWith(Number),
			reservedQuantity:
				sql<number>`coalesce(sum(${postgresAllocations.quantity}), 0)::float`.mapWith(Number),
		})
		.from(postgresAllocations)
		.where(isNull(postgresAllocations.releasedAt))
		.groupBy(postgresAllocations.projectId);
	const byId = new Map(stats.map((s) => [s.projectId, s]));
	return projects.map((p) => {
		const s = byId.get(p.id);
		return {
			...p,
			activeAllocations: s?.activeAllocations ?? 0,
			reservedQuantity: Number(s?.reservedQuantity ?? 0),
		};
	});
}

export async function getProject(db: Db, id: string): Promise<Project | null> {
	const rows: RawProjectRow[] =
		db.dialect === 'sqlite'
			? await db.db.select().from(sqliteProjects).where(eq(sqliteProjects.id, id))
			: await db.db.select().from(postgresProjects).where(eq(postgresProjects.id, id));
	return rows[0] ? normalizeProject(rows[0]) : null;
}

export async function getProjectDetail(db: Db, id: string): Promise<ProjectDetail | null> {
	const project = await getProject(db, id);
	if (!project) return null;

	const rows: Allocation[] =
		db.dialect === 'sqlite'
			? await db.db
					.select()
					.from(sqliteAllocations)
					.where(eq(sqliteAllocations.projectId, id))
					.orderBy(desc(sqliteAllocations.reservedAt))
			: await db.db
					.select()
					.from(postgresAllocations)
					.where(eq(postgresAllocations.projectId, id))
					.orderBy(desc(postgresAllocations.reservedAt));

	const all = rows.map(normalizeAllocation);
	const allocations = all.filter((a) => a.releasedAt === null);
	const history = all.filter((a) => a.releasedAt !== null);
	const reservedQuantity = allocations.reduce((sum, a) => sum + a.quantity, 0);

	return {
		...project,
		activeAllocations: allocations.length,
		reservedQuantity,
		allocations,
		history,
	};
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
