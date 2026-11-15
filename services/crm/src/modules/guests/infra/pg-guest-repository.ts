import type { Pool } from 'pg';
import type { Queryable } from '../../../platform/db/queryable.js';
import { withTransaction } from '../../../platform/db/transaction.js';
import type {
  GuestDetail,
  GuestListQuery,
  GuestNoteView,
  GuestRepository,
  GuestReservationView,
  GuestStats,
  GuestSummary,
  Page,
} from '../application/ports.js';

interface SummaryRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  marketing_consent: boolean;
  tags: string[];
  reservations: number;
  cancelled: number;
  nights: number;
  spent_minor: number;
  currency: string | null;
  last_check_in: string | null;
  last_seen_at: Date;
}

interface DetailRow extends SummaryRow {
  kvkk_accepted_at: Date;
  marketing_consented_at: Date | null;
  created_at: Date;
}

/** `%`, `_` and `\` are wildcards/escapes in LIKE; user input must match literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Per-guest aggregates over non-cancelled reservations. Computed in SQL from the projection so
 * list and detail can never disagree about "how many stays".
 */
const STATS_CTE = `
  stats AS (
    SELECT guest_id,
           count(*) FILTER (WHERE status <> 'CANCELLED')::int AS reservations,
           count(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled,
           COALESCE(sum(nights) FILTER (WHERE status <> 'CANCELLED'), 0)::int AS nights,
           COALESCE(sum(total_price_minor) FILTER (WHERE status <> 'CANCELLED'), 0)::int AS spent_minor,
           max(currency) AS currency,
           max(check_in) FILTER (WHERE status <> 'CANCELLED')::text AS last_check_in,
           max(booked_at) AS last_booked_at
    FROM guest_reservations
    WHERE hotel_id = $1
    GROUP BY guest_id
  )`;

const SUMMARY_COLUMNS = `
  g.id, g.first_name, g.last_name, g.email, g.phone, g.marketing_consent,
  ARRAY(SELECT t.tag FROM guest_tags t WHERE t.guest_id = g.id ORDER BY t.tag) AS tags,
  COALESCE(s.reservations, 0) AS reservations, COALESCE(s.cancelled, 0) AS cancelled,
  COALESCE(s.nights, 0) AS nights, COALESCE(s.spent_minor, 0) AS spent_minor,
  s.currency, s.last_check_in, COALESCE(s.last_booked_at, g.created_at) AS last_seen_at`;

function toStats(row: SummaryRow): GuestStats {
  return {
    reservations: row.reservations,
    cancelled: row.cancelled,
    nights: row.nights,
    spentMinor: row.spent_minor,
    currency: row.currency,
    lastCheckIn: row.last_check_in,
  };
}

function toSummary(row: SummaryRow): GuestSummary {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    marketingConsent: row.marketing_consent,
    tags: row.tags,
    stats: toStats(row),
    lastSeenAt: row.last_seen_at.toISOString(),
  };
}

const ORDER_BY: Record<GuestListQuery['sort'], string> = {
  recent: 'COALESCE(s.last_booked_at, g.created_at) DESC, g.id',
  name: 'lower(g.last_name), lower(g.first_name), g.id',
  spend: 'COALESCE(s.spent_minor, 0) DESC, g.id',
};

/** Every statement filters on hotel_id: a staff user can never read or change another hotel's guests. */
export class PgGuestRepository implements GuestRepository {
  constructor(private readonly pool: Pool) {}

  async search(hotelId: string, query: GuestListQuery): Promise<Page<GuestSummary>> {
    const params: unknown[] = [hotelId];
    const bind = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };
    const where = ['g.hotel_id = $1'];

    if (query.q !== undefined) {
      const like = bind(`%${escapeLike(query.q)}%`);
      const matches = [
        `g.email ILIKE ${like}`,
        `(g.first_name || ' ' || g.last_name) ILIKE ${like}`,
        `EXISTS (SELECT 1 FROM guest_reservations r WHERE r.guest_id = g.id AND r.code ILIKE ${like})`,
      ];
      // "0532 123" must find "+90532...": compare digits only, without the national leading 0.
      const digits = query.q.replace(/\D/g, '').replace(/^0/, '');
      if (digits.length >= 4) matches.push(`regexp_replace(g.phone, '\\D', '', 'g') LIKE ${bind(`%${digits}%`)}`);
      where.push(`(${matches.join(' OR ')})`);
    }
    if (query.tag !== undefined) {
      where.push(`EXISTS (SELECT 1 FROM guest_tags t WHERE t.guest_id = g.id AND t.tag = ${bind(query.tag)})`);
    }
    if (query.marketing !== undefined) where.push(`g.marketing_consent = ${bind(query.marketing)}`);

    const whereSql = where.join(' AND ');
    const total = await this.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM guests g WHERE ${whereSql}`,
      params,
    );

    const limit = bind(query.pageSize);
    const offset = bind((query.page - 1) * query.pageSize);
    const rows = await this.pool.query<SummaryRow>(
      `WITH ${STATS_CTE}
       SELECT ${SUMMARY_COLUMNS}
       FROM guests g LEFT JOIN stats s ON s.guest_id = g.id
       WHERE ${whereSql}
       ORDER BY ${ORDER_BY[query.sort]}
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    return {
      items: rows.rows.map(toSummary),
      page: query.page,
      pageSize: query.pageSize,
      total: total.rows[0]?.n ?? 0,
    };
  }

  async findDetail(hotelId: string, guestId: string): Promise<GuestDetail | null> {
    const guest = await this.pool.query<DetailRow>(
      `WITH ${STATS_CTE}
       SELECT ${SUMMARY_COLUMNS}, g.kvkk_accepted_at, g.marketing_consented_at, g.created_at
       FROM guests g LEFT JOIN stats s ON s.guest_id = g.id
       WHERE g.hotel_id = $1 AND g.id = $2`,
      [hotelId, guestId],
    );
    const row = guest.rows[0];
    if (row === undefined) return null;

    const [reservations, notes, duplicates] = await Promise.all([
      this.pool.query<{
        code: string; status: string; version: number; room_type_code: string;
        room_type_name_tr: string; room_type_name_en: string; check_in: string; check_out: string;
        nights: number; adults: number; children: number; total_price_minor: number; currency: string;
        booked_at: Date; cancelled_at: Date | null;
      }>(
        `SELECT code, status, version, room_type_code, room_type_name_tr, room_type_name_en, check_in, check_out,
                nights, adults, children, total_price_minor, currency, booked_at, cancelled_at
         FROM guest_reservations WHERE hotel_id = $1 AND guest_id = $2 ORDER BY check_in DESC, booked_at DESC`,
        [hotelId, guestId],
      ),
      this.pool.query<{ id: string; body: string; author: string; created_at: Date }>(
        `SELECT id, body, author, created_at FROM guest_notes
         WHERE hotel_id = $1 AND guest_id = $2 ORDER BY created_at DESC, id`,
        [hotelId, guestId],
      ),
      this.pool.query<{ id: string; first_name: string; last_name: string; email: string }>(
        `SELECT id, first_name, last_name, email FROM guests
         WHERE hotel_id = $1 AND phone = $2 AND id <> $3 ORDER BY created_at LIMIT 10`,
        [hotelId, row.phone, guestId],
      ),
    ]);

    return {
      ...toSummary(row),
      kvkkAcceptedAt: row.kvkk_accepted_at.toISOString(),
      marketingConsentedAt: row.marketing_consented_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
      reservations: reservations.rows.map(
        (r): GuestReservationView => ({
          code: r.code,
          status: r.status,
          version: r.version,
          roomType: { code: r.room_type_code, name: { tr: r.room_type_name_tr, en: r.room_type_name_en } },
          checkIn: r.check_in,
          checkOut: r.check_out,
          nights: r.nights,
          adults: r.adults,
          children: r.children,
          totalPriceMinor: r.total_price_minor,
          currency: r.currency,
          bookedAt: r.booked_at.toISOString(),
          cancelledAt: r.cancelled_at?.toISOString() ?? null,
        }),
      ),
      notes: notes.rows.map((n): GuestNoteView => ({ id: n.id, body: n.body, author: n.author, createdAt: n.created_at.toISOString() })),
      possibleDuplicates: duplicates.rows.map((d) => ({ id: d.id, firstName: d.first_name, lastName: d.last_name, email: d.email })),
    };
  }

  async addNote(hotelId: string, guestId: string, body: string, author: string): Promise<GuestNoteView | null> {
    const result = await this.pool.query<{ id: string; body: string; author: string; created_at: Date }>(
      `INSERT INTO guest_notes (hotel_id, guest_id, body, author)
       SELECT g.hotel_id, g.id, $3, $4 FROM guests g WHERE g.hotel_id = $1 AND g.id = $2
       RETURNING id, body, author, created_at`,
      [hotelId, guestId, body, author],
    );
    const row = result.rows[0];
    return row === undefined ? null : { id: row.id, body: row.body, author: row.author, createdAt: row.created_at.toISOString() };
  }

  async replaceTags(hotelId: string, guestId: string, tags: readonly string[]): Promise<string[] | null> {
    return withTransaction(this.pool, async (client: Queryable) => {
      const guest = await client.query('SELECT 1 FROM guests WHERE hotel_id = $1 AND id = $2 FOR UPDATE', [hotelId, guestId]);
      if (guest.rowCount !== 1) return null;
      await client.query('DELETE FROM guest_tags WHERE guest_id = $1 AND tag <> ALL($2::text[])', [guestId, tags]);
      await client.query(
        `INSERT INTO guest_tags (hotel_id, guest_id, tag)
         SELECT $1, $2, unnest($3::text[]) ON CONFLICT (guest_id, tag) DO NOTHING`,
        [hotelId, guestId, tags],
      );
      return [...tags];
    });
  }
}
