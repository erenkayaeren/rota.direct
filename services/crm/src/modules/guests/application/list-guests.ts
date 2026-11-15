import { DomainError } from '../../../shared/errors.js';
import type { GuestListQuery, GuestRepository, GuestSummary, Page } from './ports.js';
import { normalizeTag } from '../domain/tags.js';

export const MAX_PAGE_SIZE = 100;

export class ListGuests {
  constructor(private readonly guests: GuestRepository) {}

  /** @throws DomainError INVALID_TAG */
  execute(hotelId: string, query: GuestListQuery): Promise<Page<GuestSummary>> {
    const q = query.q?.trim();
    return this.guests.search(hotelId, {
      ...query,
      q: q === undefined || q === '' ? undefined : q,
      tag: query.tag === undefined ? undefined : normalizeTag(query.tag),
      pageSize: Math.min(Math.max(1, query.pageSize), MAX_PAGE_SIZE),
      page: Math.max(1, query.page),
    });
  }
}

export function guestNotFound(): DomainError {
  return new DomainError('GUEST_NOT_FOUND', 'No such guest in this hotel.', 'not_found');
}
