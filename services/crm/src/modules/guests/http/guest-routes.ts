import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { UUID_PATTERN } from '../../../shared/uuid.js';
import type { AddGuestNote } from '../application/add-guest-note.js';
import type { GetGuestProfile } from '../application/get-guest-profile.js';
import type { ListGuests } from '../application/list-guests.js';
import type { SetGuestTags } from '../application/set-guest-tags.js';

export interface GuestRoutesOptions {
  listGuests: ListGuests;
  getGuestProfile: GetGuestProfile;
  addGuestNote: AddGuestNote;
  setGuestTags: SetGuestTags;
}

// Shape only. Content rules (tag format, note length) are the domain's job and answer 422.
const listQuerySchema = z.object({
  q: z.string().max(100).optional(),
  tag: z.string().max(60).optional(),
  marketing: z.enum(['true', 'false']).optional(),
  sort: z.enum(['recent', 'name', 'spend']).default('recent'),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
const idParamsSchema = z.object({ id: z.string().regex(UUID_PATTERN) });
const noteBodySchema = z.object({ body: z.string().max(5000) }).strict();
const tagsBodySchema = z.object({ tags: z.array(z.string().max(60)).max(100) }).strict();

/** Registered inside the authenticated scope: `request.staff` is set and decides the hotel. */
export const guestRoutes: FastifyPluginAsync<GuestRoutesOptions> = async (scope, options) => {
  scope.get('/me', async (request) => ({
    name: request.staff.name,
    hotel: { key: request.staff.hotelKey, name: request.staff.hotelName },
  }));

  scope.get('/guests', async (request) => {
    const query = listQuerySchema.parse(request.query);
    return options.listGuests.execute(request.staff.hotelId, {
      q: query.q,
      tag: query.tag,
      marketing: query.marketing === undefined ? undefined : query.marketing === 'true',
      sort: query.sort,
      page: query.page,
      pageSize: query.pageSize,
    });
  });

  scope.get('/guests/:id', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return options.getGuestProfile.execute(request.staff.hotelId, id);
  });

  scope.post('/guests/:id/notes', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const { body } = noteBodySchema.parse(request.body);
    const note = await options.addGuestNote.execute(request.staff.hotelId, id, body, request.staff.name);
    return reply.code(201).send(note);
  });

  scope.put('/guests/:id/tags', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const { tags } = tagsBodySchema.parse(request.body);
    return { tags: await options.setGuestTags.execute(request.staff.hotelId, id, tags) };
  });
};
