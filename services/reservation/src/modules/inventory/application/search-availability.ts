import type { Clock } from '../../../shared/clock.js';
import { todayInZone } from '../../../shared/local-date.js';
import type { Hotel } from '../../tenancy/domain/hotel.js';
import {
  computeAvailability,
  type RoomTypeAvailability,
} from '../domain/availability.js';
import {
  createStaySearch,
  type StaySearch,
  type StaySearchInput,
} from '../domain/stay-search.js';
import type { InventoryReader } from './ports.js';

export interface AvailabilityResult {
  readonly stay: StaySearch;
  readonly currency: string;
  readonly roomTypes: RoomTypeAvailability[];
}

/** Use case for M2/M3/M5: validate the search, load the hotel's inventory, compute offers. */
export class SearchAvailability {
  constructor(
    private readonly inventory: InventoryReader,
    private readonly clock: Clock,
  ) {}

  /** `hotel` is the already-resolved tenant: every query below is scoped to its id. */
  async execute(hotel: Hotel, input: StaySearchInput): Promise<AvailabilityResult> {
    const today = todayInZone(this.clock.now(), hotel.timezone);
    const stay = createStaySearch(input, today);

    const [roomTypes, nights] = await Promise.all([
      this.inventory.listRoomTypes(hotel.id),
      this.inventory.listNightlyInventory(hotel.id, stay.checkIn, stay.checkOut),
    ]);

    return {
      stay,
      currency: hotel.currency,
      roomTypes: computeAvailability(stay, roomTypes, nights),
    };
  }
}
