import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import {
	AllocationError,
	ConflictError,
	DeleteBlockedError,
	InsufficientQuantityError,
	NotFoundError,
	ValidationError,
} from '@inventory/db';

/**
 * Map domain/repository errors to HTTP responses (plan §5):
 * - validation (Zod)        → 400
 * - not found               → 404
 * - quantity/conflict rules → 409
 * - everything else         → 500
 */
export function errorHandler(error: Error, request: FastifyRequest, reply: FastifyReply): void {
	if (error instanceof ZodError) {
		reply.status(400).send({
			error: 'validation_error',
			message: error.message,
			issues: error.issues,
		});
		return;
	}
	if (error instanceof ValidationError) {
		reply.status(400).send({ error: 'validation_error', message: error.message });
		return;
	}
	if (error instanceof NotFoundError) {
		reply.status(404).send({ error: 'not_found', message: error.message });
		return;
	}
	if (
		error instanceof InsufficientQuantityError ||
		error instanceof AllocationError ||
		error instanceof DeleteBlockedError ||
		error instanceof ConflictError
	) {
		reply.status(409).send({ error: 'conflict', message: error.message });
		return;
	}
	try {
		request.log?.error(error);
	} catch {
		// logger may be disabled
	}
	// Fastify/HTTP-level errors carry their own status (e.g. 415 bad content
	// type, 404 unknown route); everything else is a 500.
	const fastifyStatus = (error as { statusCode?: number }).statusCode;
	const status = typeof fastifyStatus === 'number' ? fastifyStatus : 500;
	reply.status(status).send({
		error: status === 500 ? 'internal_error' : 'request_error',
		message: error.message,
	});
}
