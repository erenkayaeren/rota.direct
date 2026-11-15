import type { Clock } from '../../../shared/clock.js';
import { DomainError } from '../../../shared/errors.js';
import type { Hotel, HotelId } from '../../tenancy/domain/hotel.js';
import { RESERVATION_CODE_PATTERN } from '../domain/code.js';
import { reservationCancelled } from '../domain/events.js';
import { normalizeEmail } from '../domain/guest.js';
import { nightsOf } from '../domain/reservation.js';
import { assertTransition } from '../domain/status.js';
import type { UnitOfWork } from './ports.js';
import { toReservationView, type ReservationView } from './reservation-view.js';

function notFound(): DomainError {
  return new DomainError('RESERVATION_NOT_FOUND', 'No reservation matches this code and email.', 'not_found');
}

/**
 * M8: cancel a reservation and give its rooms back, in one transaction.
 *
 * The guest proves ownership with the booking code plus the email used for the booking. A
 * wrong email, an unknown code and another hotel's code all answer the same 404, so the
 * endpoint cannot be used to find out which codes exist.
 */
export class CancelReservation {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    /** Called after the rooms were given back, so cached availability for the hotel is dropped. */
    private readonly inventoryChanged: (hotelId: HotelId) => void = () => undefined,
  ) {}

  async execute(hotel: Hotel, rawCode: string, rawEmail: string): Promise<{ reservation: ReservationView }> {
    const code = rawCode.trim().toUpperCase();
    if (!RESERVATION_CODE_PATTERN.test(code)) throw notFound();
    const email = normalizeEmail(rawEmail);
    const now = this.clock.now();

    const { cancelled, roomType } = await this.unitOfWork.run(async (tx) => {
      // FOR UPDATE: two simultaneous cancels of the same reservation take turns, so the
      // rooms are released exactly once; the loser then sees CANCELLED and gets a 409.
      const current = await tx.reservations.findByCodeForUpdate(hotel.id, code);
      if (current === null || current.guest.email !== email) throw notFound();

      assertTransition(current.status, 'CANCELLED');

      const released = await tx.stock.releaseNights(hotel.id, current.roomTypeId, current.checkIn, current.checkOut);
      if (released !== nightsOf(current)) {
        // Inventory and reservations disagree: roll back and surface it instead of hiding it.
        throw new Error(`Inventory drift while cancelling ${current.code}: released ${released} of ${nightsOf(current)} nights`);
      }

      const roomType = await tx.roomTypes.findRoomType(hotel.id, current.roomTypeId);
      if (roomType === null) throw new Error(`Room type ${current.roomTypeId} vanished`); // FK makes this impossible

      const updated = await tx.reservations.markCancelled(hotel.id, current.id, current.version, now);
      await tx.outbox.append(updated, reservationCancelled(updated, hotel, roomType));
      return { cancelled: updated, roomType };
    });

    this.inventoryChanged(hotel.id);
    return { reservation: toReservationView(cancelled, roomType) };
  }
}
