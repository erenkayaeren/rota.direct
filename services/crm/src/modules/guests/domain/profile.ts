/**
 * Both rules decide whether an incoming event may change stored state. Events can arrive late,
 * twice or out of order, so every write is guarded by a monotonic marker (ADR-0007).
 */

/** Reservation snapshots only move forward: a stale or repeated version is ignored. */
export function isNewerVersion(storedVersion: number | null, incomingVersion: number): boolean {
  return storedVersion === null || incomingVersion > storedVersion;
}

/**
 * Contact details and consents come from the most recently CREATED reservation of the guest.
 * Using the reservation's creation time (not the event time) means the cancellation of an old
 * booking never overwrites the details given in a newer one.
 */
export function shouldReplaceProfile(storedAsOf: Date, incomingAsOf: Date): boolean {
  return incomingAsOf.getTime() >= storedAsOf.getTime();
}
