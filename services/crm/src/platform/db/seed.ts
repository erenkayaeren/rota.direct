import type { Pool } from 'pg';
import { hashToken } from '../../modules/access/application/authenticate.js';

/**
 * Demo panel users, one per demo hotel. The tokens are PUBLISHED in the README so the panel can be
 * tried immediately; they are loaded only when SEED_DEMO_DATA=true and must never exist in production.
 */
export const DEMO_STAFF = [
  { hotelKey: 'pk_lagos_beach_demo', name: 'Lagos Resepsiyon', token: 'demo-lagos-staff-token-0001' },
  { hotelKey: 'pk_peri_stone_demo', name: 'Peri Resepsiyon', token: 'demo-peri-staff-token-0002' },
] as const;

export async function seedDemoStaff(pool: Pool): Promise<void> {
  for (const staff of DEMO_STAFF) {
    await pool.query(
      `INSERT INTO staff_users (hotel_key, name, token_hash) VALUES ($1, $2, $3)
       ON CONFLICT (token_hash) DO UPDATE SET hotel_key = EXCLUDED.hotel_key, name = EXCLUDED.name`,
      [staff.hotelKey, staff.name, hashToken(staff.token)],
    );
  }
}
