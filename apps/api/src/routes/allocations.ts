import type { FastifyInstance } from 'fastify';
import {
	createAllocation,
	getAllocation,
	NotFoundError,
	releaseAllocation,
	updateAllocationQuantity,
	type Db,
} from '@inventory/db';
import { createAllocationBody, updateAllocationBody } from '../schemas.js';

export function registerAllocationRoutes(app: FastifyInstance, db: Db): void {
	app.post('/api/allocations', async (req, reply) => {
		const body = createAllocationBody.parse(req.body);
		const allocation = await createAllocation(db, {
			projectId: body.projectId,
			sku: body.sku,
			quantity: body.quantity,
			note: body.note ?? null,
		});
		return reply.status(201).send({ allocation });
	});

	app.get('/api/allocations/:id', async (req) => {
		const { id } = req.params as { id: string };
		const allocation = await getAllocation(db, id);
		if (!allocation) throw new NotFoundError('allocation', id);
		return { allocation };
	});

	app.patch('/api/allocations/:id', async (req) => {
		const { id } = req.params as { id: string };
		const body = updateAllocationBody.parse(req.body);

		let allocation = await getAllocation(db, id);
		if (!allocation) throw new NotFoundError('allocation', id);

		if (body.quantity !== undefined && body.quantity !== allocation.quantity) {
			allocation = await updateAllocationQuantity(db, id, body.quantity);
		}
		if (body.release === true) {
			allocation = await releaseAllocation(db, id);
		}
		return { allocation };
	});
}
