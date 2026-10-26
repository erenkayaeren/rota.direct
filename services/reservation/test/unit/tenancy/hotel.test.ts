import { describe, expect, it } from 'vitest';
import { ResolveHotel } from '../../../src/modules/tenancy/application/resolve-hotel.js';
import type { HotelRepository } from '../../../src/modules/tenancy/application/ports.js';
import { assertNormalizedOrigin, isOriginAllowed, type Hotel } from '../../../src/modules/tenancy/domain/hotel.js';
import { expectDomainErrorAsync } from '../../support/domain-error.js';
import { hotelFixture, LAGOS_ORIGIN, PERI_ORIGIN } from '../../support/fixtures.js';

describe('isOriginAllowed', () => {
  const hotel = hotelFixture();

  it('matches the exact origin only', () => {
    expect(isOriginAllowed(hotel, LAGOS_ORIGIN)).toBe(true);
    expect(isOriginAllowed(hotel, 'http://localhost:8080')).toBe(true);
  });

  it("does not allow another hotel's origin", () => {
    expect(isOriginAllowed(hotel, PERI_ORIGIN)).toBe(false);
  });

  it('does not allow look-alikes: other scheme, other port, sub-domain, suffix or prefix tricks', () => {
    const lookAlikes = [
      'http://www.lagosbeachhotel.example',
      'https://www.lagosbeachhotel.example:8443',
      'https://evil.www.lagosbeachhotel.example',
      'https://www.lagosbeachhotel.example.evil.test',
      'https://evilwww.lagosbeachhotel.example',
      'null',
      '',
    ];
    for (const origin of lookAlikes) {
      expect(isOriginAllowed(hotel, origin)).toBe(false);
    }
  });
});

describe('assertNormalizedOrigin', () => {
  it('accepts origins exactly as a browser sends them', () => {
    assertNormalizedOrigin('https://www.example.com');
    assertNormalizedOrigin('http://localhost:8080');
  });

  it('rejects paths, trailing slashes, uppercase hosts and non-URLs', () => {
    for (const value of ['https://www.example.com/', 'https://www.example.com/path', 'HTTPS://WWW.EXAMPLE.COM', 'example.com', 'null']) {
      expect(() => assertNormalizedOrigin(value)).toThrow();
    }
  });
});

describe('ResolveHotel', () => {
  const lagos: Hotel = hotelFixture();

  class FakeHotels implements HotelRepository {
    lookups = 0;
    async findByPublicKey(publicKey: string): Promise<Hotel | null> {
      this.lookups += 1;
      return publicKey === lagos.publicKey ? lagos : null;
    }
  }

  it('resolves a known key to its hotel', async () => {
    const resolved = await new ResolveHotel(new FakeHotels()).execute('pk_lagos_beach_demo');
    expect(resolved.id).toBe('hotel-lagos');
  });

  it('answers HOTEL_NOT_FOUND for an unknown key', async () => {
    await expectDomainErrorAsync(new ResolveHotel(new FakeHotels()).execute('pk_unknown_key_1'), 'HOTEL_NOT_FOUND');
  });

  it('rejects malformed keys without querying the database', async () => {
    const hotels = new FakeHotels();
    const resolve = new ResolveHotel(hotels);
    for (const key of ['short', 'has space in it', "pk_'; DROP TABLE hotels;--", 'x'.repeat(65)]) {
      await expectDomainErrorAsync(resolve.execute(key), 'HOTEL_NOT_FOUND');
    }
    expect(hotels.lookups).toBe(0);
  });
});
