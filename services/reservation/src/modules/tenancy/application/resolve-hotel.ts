import { HOTEL_KEY_PATTERN, hotelNotFound, type Hotel } from '../domain/hotel.js';
import type { HotelRepository } from './ports.js';

/** Turns the public hotel key from the request into the tenant every later step is scoped to. */
export class ResolveHotel {
  constructor(private readonly hotels: HotelRepository) {}

  async execute(publicKey: string): Promise<Hotel> {
    // Malformed keys cannot exist; answer without a database round trip.
    if (!HOTEL_KEY_PATTERN.test(publicKey)) throw hotelNotFound();
    const hotel = await this.hotels.findByPublicKey(publicKey);
    if (hotel === null) throw hotelNotFound();
    return hotel;
  }
}
