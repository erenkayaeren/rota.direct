import type { Hotel } from '../domain/hotel.js';

export interface HotelRepository {
  findByPublicKey(publicKey: string): Promise<Hotel | null>;
}
