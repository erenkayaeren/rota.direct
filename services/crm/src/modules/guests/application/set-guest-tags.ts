import { guestNotFound } from './list-guests.js';
import type { GuestRepository } from './ports.js';
import { normalizeTags } from '../domain/tags.js';

export class SetGuestTags {
  constructor(private readonly guests: GuestRepository) {}

  async execute(hotelId: string, guestId: string, tags: readonly string[]): Promise<string[]> {
    const saved = await this.guests.replaceTags(hotelId, guestId, normalizeTags(tags));
    if (saved === null) throw guestNotFound();
    return saved;
  }
}
