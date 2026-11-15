/** 32 symbols without 0/O/1/I, so a code read over the phone is hard to get wrong. 32 = 2^5: no modulo bias. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_PREFIX = 'RT-';
const CODE_LENGTH = 8;

export const RESERVATION_CODE_PATTERN = /^RT-[A-HJ-NP-Z2-9]{8}$/;

/**
 * Human-facing booking reference, e.g. "RT-7K3MQ9XA". 32^8 = 2^40 possibilities: not
 * guessable by trial (cancellation also needs the guest's email) and unique per hotel,
 * which the database enforces; on a collision the caller simply draws another one.
 *
 * @param randomBytes source of at least 8 random bytes (crypto.randomBytes in production)
 */
export function generateReservationCode(randomBytes: (size: number) => Uint8Array): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = CODE_PREFIX;
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[(bytes[i] as number) & 31];
  }
  return code;
}
