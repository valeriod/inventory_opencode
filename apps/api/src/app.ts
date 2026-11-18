import cors from '@fastify/cors';
import Fastify from 'fastify';

export function buildApp() {
	const app = Fastify({
		logger: false,
	});

	app.register(cors, {
		origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true,
	});

	app.get('/api/health', () => ({
		status: 'ok',
	}));

	return app;
}
