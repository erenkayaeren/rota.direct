import { guestNotFound } from './list-guests.js';
import type { GuestNoteView, GuestRepository } from './ports.js';
import { normalizeNote } from '../domain/notes.js';

export class AddGuestNote {
  constructor(private readonly guests: GuestRepository) {}

  async execute(hotelId: string, guestId: string, body: string, author: string): Promise<GuestNoteView> {
    const note = await this.guests.addNote(hotelId, guestId, normalizeNote(body), author);
    if (note === null) throw guestNotFound();
    return note;
  }
}
