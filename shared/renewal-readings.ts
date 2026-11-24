// L0, context K (Session Conversation's shared vocabulary): the Overlord's renewal readings' wire shapes (Overlord spec
// §3.3.11, R19; W1, plan `w1-renewal-readings.md`). The daily backstop's setting, its bounds and its default; the ordered
// list's hold filter joins it in PR H. Imports nothing: the PWA bundles this file.

/** The daily backstop's setting (R19, Table 11.1d's Settings row): the wall-clock hour in an IANA time zone at which a
 *  generation that has lived through it is due a soft renewal. `isDefault` while no operator has set it; `setAt` is the
 *  wall ms of the last set (0 for the seeded row). One row, one writer: `continuityStore.ts#setBackstop`, from its door. */
export interface RenewalBackstop {
  readonly hour: number;
  readonly zone: string;
  readonly isDefault: boolean;
  readonly setAt: number;
}

/** The backstop row as read (`continuityStore.ts#backstopRead`), or why it does not read: a store failure, or a row
 *  outside the bounds below. Never a default in place of an unread row. */
export type BackstopRead = { readonly ok: true; readonly backstop: RenewalBackstop } | { readonly ok: false; readonly detail: string };

/** The hours a backstop may name, 0 to 23, in the zone's own wall clock. */
export const BACKSTOP_HOURS: readonly number[] = Array.from({ length: 24 }, (_, h) => h);

/** The seeded backstop (question 2, ruled at review 2183 Q2; slug backstop-default-is-a-starting-value): 04:00 UTC until
 *  W3's quiet hours name a default, changeable in Settings. The migration seeds the same two values. */
export const BACKSTOP_DEFAULT: { readonly hour: number; readonly zone: string } = { hour: 4, zone: 'UTC' };

/** The longest zone name the door takes. IANA names are short (the longest in the database is under 32 characters). */
export const BACKSTOP_ZONE_MAX = 64;

/** An hour the backstop may name: one of `BACKSTOP_HOURS`. */
export function isBackstopHour(v: unknown): v is number {
  return typeof v === 'number' && BACKSTOP_HOURS.includes(v);
}

/** A zone the backstop may name: a short string `Intl.DateTimeFormat` accepts as a time zone. */
export function isBackstopZone(v: unknown): v is string {
  if (typeof v !== 'string' || v.length === 0 || v.length > BACKSTOP_ZONE_MAX) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: v });
    return true;
  } catch {
    return false;
  }
}
