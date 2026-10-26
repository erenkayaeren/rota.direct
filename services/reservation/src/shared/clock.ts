/** Injected wherever "now" matters, so time-dependent rules are testable without fake timers. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
