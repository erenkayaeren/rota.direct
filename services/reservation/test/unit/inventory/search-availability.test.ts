import { describe, expect, it } from 'vitest';
import type { InventoryReader } from '../../../src/modules/inventory/application/ports.js';
import { SearchAvailability } from '../../../src/modules/inventory/application/search-availability.js';
import type { NightlyInventory, RoomType } from '../../../src/modules/inventory/domain/availability.js';
import { INVENTORY_HORIZON_DAYS } from '../../../src/modules/inventory/infra/inventory-horizon.js';
import { STAY_LIMITS } from '../../../src/modules/inventory/domain/stay-search.js';
import { localDate } from '../../../src/shared/local-date.js';
import { expectDomainErrorAsync } from '../../support/domain-error.js';
import { fixedClock, hotelFixture } from '../../support/fixtures.js';

const standard: RoomType = { id: 'rt-standard', code: 'standard', name: { tr: 'Standart', en: 'Standard' }, maxGuests: 2, nightlyPriceMinor: 320_000 };

/** In-memory InventoryReader that records how it was called. */
class FakeInventory implements InventoryReader {
  readonly calls: Array<{ hotelId: string; from: string; toExclusive: string }> = [];

  async listRoomTypes(): Promise<RoomType[]> {
    return [standard];
  }

  async listNightlyInventory(hotelId: string, from: string, toExclusive: string): Promise<NightlyInventory[]> {
    this.calls.push({ hotelId, from, toExclusive });
    return ['2026-11-01', '2026-11-02'].map((date) => ({
      roomTypeId: standard.id,
      date: localDate(date),
      total: 20,
      booked: 5,
    }));
  }
}

const input = { checkIn: localDate('2026-11-01'), checkOut: localDate('2026-11-03'), adults: 2, children: 0 };

describe('SearchAvailability', () => {
  it('scopes the inventory query to the resolved hotel and to the nights of the stay', async () => {
    const inventory = new FakeInventory();
    const useCase = new SearchAvailability(inventory, fixedClock());

    const result = await useCase.execute(hotelFixture({ id: 'hotel-42' }), input);

    expect(inventory.calls).toEqual([{ hotelId: 'hotel-42', from: '2026-11-01', toExclusive: '2026-11-03' }]);
    expect(result.currency).toBe('TRY');
    expect(result.roomTypes).toHaveLength(1);
    expect(result.roomTypes[0]?.remaining).toBe(15);
    expect(result.roomTypes[0]?.totalPriceMinor).toBe(640_000);
  });

  it("evaluates 'today' in the hotel's time zone: 22:30 UTC is already tomorrow in Istanbul", async () => {
    const lateEvening = fixedClock(new Date('2026-10-26T22:30:00Z'));
    const checkingInOnThe26th = { ...input, checkIn: localDate('2026-10-26'), checkOut: localDate('2026-10-28') };

    const istanbulHotel = hotelFixture({ timezone: 'Europe/Istanbul' });
    await expectDomainErrorAsync(
      new SearchAvailability(new FakeInventory(), lateEvening).execute(istanbulHotel, checkingInOnThe26th),
      'CHECK_IN_IN_PAST',
    );

    const utcHotel = hotelFixture({ timezone: 'UTC' });
    const result = await new SearchAvailability(new FakeInventory(), lateEvening).execute(utcHotel, checkingInOnThe26th);
    expect(result.stay.nights).toBe(2);
  });

  it('does not touch the database when the search is invalid', async () => {
    const inventory = new FakeInventory();
    const useCase = new SearchAvailability(inventory, fixedClock());

    await expectDomainErrorAsync(
      useCase.execute(hotelFixture(), { ...input, checkOut: input.checkIn }),
      'INVALID_DATE_RANGE',
    );
    expect(inventory.calls).toHaveLength(0);
  });
});

describe('inventory horizon', () => {
  it('materialises more days than the booking window so a searchable night always has a row', () => {
    expect(INVENTORY_HORIZON_DAYS).toBeGreaterThanOrEqual(STAY_LIMITS.bookingWindowDays + 2);
  });
});
