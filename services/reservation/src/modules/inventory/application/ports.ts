import type { LocalDate } from '../../../shared/local-date.js';
import type { HotelId } from '../../tenancy/domain/hotel.js';
import type { NightlyInventory, RoomType } from '../domain/availability.js';

/** Read side of the inventory module. Implemented by the Postgres adapter in `infra/`. */
export interface InventoryReader {
  listRoomTypes(hotelId: HotelId): Promise<RoomType[]>;
  /** A room type of this hotel, or null (also when the id belongs to another hotel). */
  findRoomType(hotelId: HotelId, roomTypeId: string): Promise<RoomType | null>;
  /** Inventory rows for nights in [from, toExclusive). */
  listNightlyInventory(
    hotelId: HotelId,
    from: LocalDate,
    toExclusive: LocalDate,
  ): Promise<NightlyInventory[]>;
}

/**
 * Write side of the inventory module. Both operations are all-or-nothing *per night* only;
 * they return how many nights they changed so the caller (inside its transaction) can
 * decide whether the whole stay was possible and roll back if not.
 */
export interface InventoryStock {
  /** Sells one room on every night in [checkIn, checkOut) that still has a free one. */
  takeNights(hotelId: HotelId, roomTypeId: string, checkIn: LocalDate, checkOut: LocalDate): Promise<number>;
  /** Gives one room back on every night in [checkIn, checkOut) that has something booked. */
  releaseNights(hotelId: HotelId, roomTypeId: string, checkIn: LocalDate, checkOut: LocalDate): Promise<number>;
}
