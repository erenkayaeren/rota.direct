import { guestNotFound } from './list-guests.js';
import type { GuestDetail, GuestRepository } from './ports.js';

export class GetGuestProfile {
  constructor(private readonly guests: GuestRepository) {}

  async execute(hotelId: string, guestId: string): Promise<GuestDetail> {
    const detail = await this.guests.findDetail(hotelId, guestId);
    if (detail === null) throw guestNotFound();
    return detail;
  }
}
