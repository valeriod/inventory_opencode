import type { FastifyInstance } from 'fastify';
import {
	createProject,
	getProjectDetail,
	listProjectsWithStats,
	NotFoundError,
	updateProject,
	type Db,
} from '@inventory/db';
import { createProjectBody, updateProjectBody } from '../schemas.js';

export function registerProjectRoutes(app: FastifyInstance, db: Db): void {
	app.get('/api/projects', async () => {
		return { projects: await listProjectsWithStats(db) };
	});

	app.post('/api/projects', async (req, reply) => {
		const body = createProjectBody.parse(req.body);
		const project = await createProject(db, {
			name: body.name,
			description: body.description ?? null,
		});
		return reply.status(201).send({ project });
	});

	app.get('/api/projects/:id', async (req) => {
		const { id } = req.params as { id: string };
		const project = await getProjectDetail(db, id);
		if (!project) throw new NotFoundError('project', id);
		return { project };
	});

	app.patch('/api/projects/:id', async (req) => {
		const { id } = req.params as { id: string };
		const body = updateProjectBody.parse(req.body);
		const project = await updateProject(db, id, {
			name: body.name,
			description: body.description,
			status: body.status,
		});
		return { project };
	});
}
