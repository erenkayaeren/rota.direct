import type { FastifyPluginAsync } from 'fastify';
import type { CancelReservation } from '../application/cancel-reservation.js';
import type { CreateReservation } from '../application/create-reservation.js';
import { parseCancelBody, parseCreateBody, parseIdempotencyKey } from './reservation-body.js';

export interface ReservationRoutesOptions {
  createReservation: CreateReservation;
  cancelReservation: CancelReservation;
}

/** Registered inside the tenant scope: `request.hotel` is always set (see tenant-context.ts). */
export const reservationRoutes: FastifyPluginAsync<ReservationRoutesOptions> = async (scope, options) => {
  scope.post('/reservations', async (request, reply) => {
    const idempotencyKey = parseIdempotencyKey(request.headers);
    const input = parseCreateBody(request.body);

    const result = await options.createReservation.execute(request.hotel, idempotencyKey, input);

    reply.header('Cache-Control', 'no-store');
    if (result.replayed) reply.header('Idempotent-Replayed', 'true');
    return reply.code(result.status).send(result.body);
  });

  scope.post<{ Params: { code: string } }>('/reservations/:code/cancel', async (request, reply) => {
    const { email } = parseCancelBody(request.body);
    const result = await options.cancelReservation.execute(request.hotel, request.params.code, email);
    reply.header('Cache-Control', 'no-store');
    return result;
  });
};
