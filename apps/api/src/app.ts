import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Db } from '@inventory/db';
import { errorHandler } from './errors.js';
import { registerItemsRoutes } from './routes/items.js';

export function buildApp(db: Db): FastifyInstance {
	const app = Fastify({
		logger: false,
	});

	app.register(cors, {
		origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true,
	});

	app.setErrorHandler(errorHandler);

	app.get('/api/health', () => ({
		status: 'ok',
	}));

	registerItemsRoutes(app, db);

	return app;
}
