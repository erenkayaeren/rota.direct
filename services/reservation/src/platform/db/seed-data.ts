/**
 * Demo tenants from the case study. Prices are in minor units (kurus): 3.200 TRY = 320000.
 * The `http://localhost:8080` origin is the demo host page used during development and
 * must be removed for a real hotel.
 */
export interface SeedRoomType {
  code: string;
  nameTr: string;
  nameEn: string;
  totalRooms: number;
  maxGuests: number;
  nightlyPriceMinor: number;
}

export interface SeedHotel {
  publicKey: string;
  name: string;
  city: string;
  timezone: string;
  currency: string;
  allowedOrigins: string[];
  roomTypes: SeedRoomType[];
}

export const DEMO_HOTELS: readonly SeedHotel[] = [
  {
    publicKey: 'pk_lagos_beach_demo',
    name: 'Lagos Beach Hotel',
    city: 'Antalya',
    timezone: 'Europe/Istanbul',
    currency: 'TRY',
    allowedOrigins: ['https://www.lagosbeachhotel.example', 'http://localhost:8080'],
    roomTypes: [
      { code: 'standard', nameTr: 'Standart', nameEn: 'Standard', totalRooms: 20, maxGuests: 2, nightlyPriceMinor: 320_000 },
      { code: 'deluxe-sea-view', nameTr: 'Deluxe Deniz Manzaralı', nameEn: 'Deluxe Sea View', totalRooms: 15, maxGuests: 3, nightlyPriceMinor: 480_000 },
      { code: 'family-suite', nameTr: 'Aile Suiti', nameEn: 'Family Suite', totalRooms: 5, maxGuests: 4, nightlyPriceMinor: 750_000 },
    ],
  },
  {
    publicKey: 'pk_peri_stone_demo',
    name: 'Peri Stone Cave Hotel',
    city: 'Kapadokya',
    timezone: 'Europe/Istanbul',
    currency: 'TRY',
    allowedOrigins: ['https://www.peristonecave.example', 'http://localhost:8080'],
    roomTypes: [
      { code: 'cave-room', nameTr: 'Mağara Oda', nameEn: 'Cave Room', totalRooms: 8, maxGuests: 2, nightlyPriceMinor: 550_000 },
      { code: 'terrace-suite', nameTr: 'Teras Süit', nameEn: 'Terrace Suite', totalRooms: 2, maxGuests: 3, nightlyPriceMinor: 900_000 },
    ],
  },
];
