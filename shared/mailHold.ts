// The `mailhold` route field's grammar (mid-turn mail spec 2026-11-19 §3.3; plan Task 3.1): L0, one owner, imports
// nothing, because the PWA may bundle it.
//
// The value is `<until>:<role>.<delivery>[,<role>.<delivery>]…`, at most MAILHOLD_MAX_PAIRS pairs:
//   - `until` is epoch seconds, the end of the lease, 1 to 11 digits with no leading zero (plan P14);
//   - `role` is the sender's role for that delivery, `coordinator` or `overlord` (plan P1), so the hook names the sender
//     without asking the server;
//   - `delivery` is a `mail_deliveries` id, 1 to 10 digits with no leading zero.
// The digit widths keep a value reading the same in bash (a 64-bit integer) and here (a double): a 25-digit number would
// wrap in one and round in the other.
//
// It has three readers, held equal by one corpus (`server/test/fixtures/mailhold-grammar.json`, the parity test
// `server/test/mailhold-parity.test.ts`): `parseMailHold` here, `ccd/ccd#_route_valid`'s `mailhold` row, and, from the
// hook's pull request on, the session hook's builtin parse. Both bash readers copy MAILHOLD_RE_BODY character for
// character. Its digit classes are spelled out, never a range, because under a UTF-8 locale bash may collate other
// characters into `0-9` (`_hook_server_cap`'s note).
//
// The bound on `until` is the readers' business, not the grammar's: ccd refuses a write whose `until` is more than
// MAILHOLD_REACH_S past its own clock (a write-site check, so a standing marker survives a clock step), and the hook
// honours a marker only while `mailHoldLive` holds.

/** The lease the writer sets: `until` is this many seconds after the writer's wall clock. */
export const MAILHOLD_LEASE_S = 300;
/** The furthest a reader accepts `until` past its own clock: the lease plus 60 s of tolerated skew. */
export const MAILHOLD_REACH_S = 360;
/** The writer renews a matching marker once it has fewer than this many seconds left. */
export const MAILHOLD_RENEW_UNDER_S = 120;
/** The most pairs one marker carries. Past it the writer keeps the lowest delivery ids, so the marker always renews. */
export const MAILHOLD_MAX_PAIRS = 8;

/** The sender roles a pair may name (plan P1: the urgent column stores one of these). */
export const MAILHOLD_ROLES = ['coordinator', 'overlord'] as const;
export type MailHoldRole = (typeof MAILHOLD_ROLES)[number];

/** One held delivery and the role of the session that sent it. */
export interface MailHoldPair { readonly role: MailHoldRole; readonly delivery: number }
/** A parsed marker: its lease end and its pairs, in the order written. */
export interface MailHold { readonly until: number; readonly pairs: readonly MailHoldPair[] }

const DIGIT = '[0123456789]';
const LEAD = '[123456789]';
const UNTIL = `${LEAD}${DIGIT}{0,10}`;
const PAIR = `(coordinator|overlord)\\.${LEAD}${DIGIT}{0,9}`;

/**
 * The regular expression body both bash readers copy, character for character (POSIX ERE, as bash's `=~` reads it).
 * Group 1 is `until`.
 */
export const MAILHOLD_RE_BODY = `^(${UNTIL}):(${PAIR})(,${PAIR}){0,${MAILHOLD_MAX_PAIRS - 1}}$`;
const MAILHOLD_RE = new RegExp(MAILHOLD_RE_BODY);
const PAIR_RE = /^(coordinator|overlord)\.([0-9]+)$/;

const isUntil = (n: number): boolean => Number.isSafeInteger(n) && n >= 1 && n <= 99_999_999_999;
const isDelivery = (n: number): boolean => Number.isSafeInteger(n) && n >= 1 && n <= 9_999_999_999;

/** Read one stored value. Anything outside the grammar is `{ ok: false }`; there is no partial answer. */
export function parseMailHold(value: string): { readonly ok: true; readonly hold: MailHold } | { readonly ok: false } {
  const m = MAILHOLD_RE.exec(value);
  if (m === null) return { ok: false };
  const until = Number(m[1]);
  const pairs = value.slice(m[1]!.length + 1).split(',').map((p) => {
    const pm = PAIR_RE.exec(p)!;
    return { role: pm[1] as MailHoldRole, delivery: Number(pm[2]) };
  });
  return { ok: true, hold: { until, pairs } };
}

/**
 * Spell a marker. The pairs are sorted by delivery id, ascending, a repeated id is kept once (its first pair after the
 * sort), and only the MAILHOLD_MAX_PAIRS lowest are kept, so a large hold still renews. Throws RangeError on an input
 * the grammar cannot spell (no pair, an unknown role, an id or `until` outside its digit width): a caller never
 * receives a value `parseMailHold` would refuse. The empty value that clears the field is the writer's, never this.
 */
export function renderMailHold(until: number, pairs: readonly MailHoldPair[]): string {
  if (!isUntil(until)) throw new RangeError(`mailhold: until ${until} is outside 1 to 11 digits`);
  if (pairs.length === 0) throw new RangeError('mailhold: a marker holds at least one pair');
  for (const p of pairs) {
    if (!(MAILHOLD_ROLES as readonly string[]).includes(p.role)) throw new RangeError(`mailhold: unknown role ${String(p.role)}`);
    if (!isDelivery(p.delivery)) throw new RangeError(`mailhold: delivery ${p.delivery} is outside 1 to 10 digits`);
  }
  const seen = new Set<number>();
  const kept = [...pairs]
    .sort((a, b) => a.delivery - b.delivery)
    .filter((p) => (seen.has(p.delivery) ? false : (seen.add(p.delivery), true)))
    .slice(0, MAILHOLD_MAX_PAIRS);
  return `${until}:${kept.map((p) => `${p.role}.${p.delivery}`).join(',')}`;
}

/** Whether a marker is honoured at `now` (epoch seconds): `now < until <= now + MAILHOLD_REACH_S`. */
export function mailHoldLive(until: number, now: number): boolean {
  return now < until && until <= now + MAILHOLD_REACH_S;
}
