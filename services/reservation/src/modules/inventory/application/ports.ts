import type { LocalDate } from '../../../shared/local-date.js';
import type { HotelId } from '../../tenancy/domain/hotel.js';
import type { NightlyInventory, RoomType } from '../domain/availability.js';

/** Read side of the inventory module. Implemented by the Postgres adapter in `infra/`. */
export interface InventoryReader {
  listRoomTypes(hotelId: HotelId): Promise<RoomType[]>;
  /** Inventory rows for nights in [from, toExclusive). */
  listNightlyInventory(
    hotelId: HotelId,
    from: LocalDate,
    toExclusive: LocalDate,
  ): Promise<NightlyInventory[]>;
}
