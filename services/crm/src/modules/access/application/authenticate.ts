import { createHash } from 'node:crypto';
import { DomainError } from '../../../shared/errors.js';

export interface StaffContext {
  readonly name: string;
  readonly hotelKey: string;
  /** NIL_UUID until the hotel's first reservation event has arrived: queries then match nothing. */
  readonly hotelId: string;
  readonly hotelName: string | null;
}

export interface StaffDirectory {
  findByTokenHash(tokenHash: string): Promise<StaffContext | null>;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function unauthenticated(): DomainError {
  return new DomainError('UNAUTHENTICATED', 'A valid staff token is required.', 'unauthenticated');
}

/**
 * Staff sign in with an opaque bearer token. Tokens are long random strings, stored only as a
 * SHA-256 hash (a fast hash is fine for high-entropy secrets). The token decides the hotel; the
 * client never says which hotel it wants, so one hotel's staff cannot ask for another's data.
 */
export class Authenticate {
  constructor(private readonly staff: StaffDirectory) {}

  async execute(authorization: string | undefined): Promise<StaffContext> {
    const match = /^Bearer ([^\s]{16,200})$/.exec(authorization ?? '');
    if (match === null) throw unauthenticated();
    const staff = await this.staff.findByTokenHash(hashToken(match[1] as string));
    if (staff === null) throw unauthenticated();
    return staff;
  }
}
