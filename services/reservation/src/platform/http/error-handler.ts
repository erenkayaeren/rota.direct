import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { toHttpError } from './error-mapping.js';

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply): void {
  const mapped = toHttpError(error);
  if (mapped.unexpected) request.log.error({ err: error }, 'unhandled error');
  void reply.code(mapped.status).send(mapped.body);
}

export function notFoundHandler(_request: FastifyRequest, reply: FastifyReply): void {
  void reply.code(404).send({ error: { code: 'ROUTE_NOT_FOUND', message: 'Route not found.' } });
}
