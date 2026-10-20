/**
 * The Accounts screen's pure policy (spec 2026-10-18 accounts-connect; plan File structure). L0: imports
 * nothing. Task A5 opens this file with the step-up freshness window (D-5512, D-5618); the state words, the kind
 * codes, the URL shape checks and the ceiling arithmetic join it in their own tasks (A2, A12, A21, A29, A32).
 */

/**
 * How long a step-up stays fresh on the session that took it: FIVE MINUTES (D-5512, spec §3.2). Every act
 * that puts, replaces or deletes a credential needs a step-up from the last five minutes on the same session.
 * The one home of the number: `requireRecentAssertion`'s default and `stepUpFreshUntil` both read it.
 */
export const STEP_UP_FRESH_MS = 5 * 60 * 1000;

/**
 * The first instant a step-up taken at `assertedAt` is no longer fresh: `assertedAt + windowMs`. The window
 * is the last `windowMs` milliseconds, so this instant is OUTSIDE it, and `GET /api/accounts`'s
 * `connect.stepUpFreshUntil` (A12) carries exactly this value.
 */
export function stepUpFreshUntil(assertedAt: number, windowMs: number = STEP_UP_FRESH_MS): number {
  return assertedAt + windowMs;
}

/**
 * Is a step-up taken at `assertedAt` still fresh at `now`? `undefined` is "this session never stepped up",
 * which is never fresh. A stamp in the future (the clock stepped back) is not fresh either: freshness is
 * measured, never assumed.
 */
export function isStepUpFresh(assertedAt: number | undefined, now: number, windowMs: number = STEP_UP_FRESH_MS): boolean {
  if (assertedAt === undefined || assertedAt > now) return false;
  return now < stepUpFreshUntil(assertedAt, windowMs);
}

// ── One state word per lane (D-5517; spec §4.1; accounts plan Task A12) ─────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** The seven state words, in their precedence: the first that applies wins (spec §4.1). Five states and the two
 *  honest non-readings, Inconclusive and Not checked. */
export const ACCOUNT_STATE_WORDS = [
  'off', 'signed-out', 'rate-limited', 'expiring', 'signed-in', 'inconclusive', 'not-checked',
] as const;
export type AccountStateWord = (typeof ACCOUNT_STATE_WORDS)[number];

/** A last check of `ok` reads Signed in for 7 d; past that, or with none, the lane is Not checked. */
export const SIGNED_IN_WITHIN_MS = 7 * DAY_MS;
/** A minted long-lived token lasts about a year from `mintedAt` (an estimate: the provider does not say). */
export const MINTED_TOKEN_LIFETIME_MS = 365 * DAY_MS;
/** A minted token is Expiring once its estimated end is under 30 d away. */
export const MINTED_TOKEN_EXPIRING_MS = 30 * DAY_MS;
/** An OpenRouter key is Expiring at this fraction of its limit left, or less. */
export const CREDIT_EXPIRING_FRACTION = 0.1;
/** A key ccrc minted is Expiring once its `keyExpiresAt` is under 14 d away. */
export const MINTED_KEY_EXPIRING_MS = 14 * DAY_MS;
/** A 5h or 7d window at this many percent, or more, is Rate-limited. */
export const WINDOW_LIMITED_PCT = 100;

/** How the lane-state file says an identity was learned: read off the provider, or stated by the operator. */
export const LANE_IDENTITY_SOURCES = ['measured', 'stated'] as const;
/** How an OpenRouter key came: pasted, connected with OpenRouter (PKCE), or minted by ccrc (spec §3.4). */
export const LANE_KEY_SOURCES = ['pasted', 'pkce', 'minted'] as const;

/** The lane-state file (`~/.cc-sessions/.accounts/<id>.json`, spec §3.4) as the server read it, each field held to its
 *  grammar (`laneStateOf`) and its times in epoch ms. Display only: never authority for anything that touches a
 *  secret (D-5517). */
export interface LaneState {
  readonly check?: { readonly verdict: string; readonly at: number };
  readonly identity?: string;
  readonly identitySource?: (typeof LANE_IDENTITY_SOURCES)[number];
  readonly keyHint?: string;
  readonly keySource?: (typeof LANE_KEY_SOURCES)[number];
  readonly validatedAt?: number;
  /** OpenRouter's key credit: `limit` null is a key with no limit; `remaining` is its `limit_remaining`. */
  readonly credit?: { readonly limit: number | null; readonly remaining: number | null };
  readonly mintedAt?: number;
  readonly keyExpiresAt?: number;
  readonly seedVerifiedAt?: number;
  readonly lastRunAt?: number;
}

/** The two non-readings stay two (D-5517): an absent file is Not checked, an unreadable one Inconclusive. */
export type LaneStateRead =
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'read'; readonly state: LaneState };

/** What a lane's word is derived from: today's `GET /api/accounts` facts and the lane state. `provider` and `kind` are
 *  `RosterKindWire`'s (absent when the roster does not say), spelled structurally so this file imports nothing. */
export interface StateWordInput {
  readonly disabled: boolean;
  readonly authDead: boolean;
  /** The 5h and 7d windows in percent, after rollover (`AccountUsage.five`/`seven`); null when unmeasured. */
  readonly five: number | null;
  readonly seven: number | null;
  /** Epoch seconds the window resets, for the Rate-limited sentence. */
  readonly fiveResetAt?: number | null;
  readonly sevenResetAt?: number | null;
  readonly provider?: string;
  readonly kind?: string;
  readonly lane?: LaneStateRead;
  readonly now: number;
}

/** A lane's one word, its source sentence (spec §4.1's "When" column), and the instant the state was measured. */
export interface AccountStateAnswer {
  readonly word: AccountStateWord;
  readonly source: string;
  readonly at?: number;
}

/** "4m", "2h", "9d": how long ago, in the card's short form. */
function shortSpan(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;
/** "$20" for a whole figure, "$1.20" otherwise; never below zero. */
const dollars = (n: number): string => {
  const v = Math.max(0, n);
  return Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`;
};
const creditLine = (remaining: number, limit: number): string =>
  `$${Math.max(0, remaining).toFixed(2)} of ${dollars(limit)} left`;
const resetLine = (resetAt: number | null | undefined, now: number): string => {
  if (resetAt === null || resetAt === undefined || !Number.isFinite(resetAt)) return '';
  const left = Math.floor((resetAt * 1000 - now) / 60_000);
  if (left <= 0) return '';
  return ` · resets in ${left >= 60 ? `${Math.floor(left / 60)}h ${left % 60}m` : `${left}m`}`;
};

/**
 * THE ONE STATE WORD (D-5517, spec §4.1; created by Task A12 ahead of A2, D-6058 (3)): the first row of the table that applies, with its source. Pure, L1 policy
 * in L0: the server derives `LaneWire.state` from it, and nothing re-derives a word elsewhere.
 *
 *  - Off: the kill switch. Signed out: a 401, from the `authdead` marker or a last check of `auth-dead`, whatever its
 *    age (D-5755 (5): the last measured verdict). Rate-limited: a window at 100% or more, or an OpenRouter key whose
 *    `limit_remaining` is 0 or less.
 *  - Expiring, from three sources and never from another kind's file: a minted Anthropic token whose estimated year
 *    ends in under 30 d (a pasted token has no `mintedAt`); an OpenRouter key at 10% or less of a limit it has; an
 *    OpenRouter key ccrc minted whose `keyExpiresAt` is under 14 d away. A sign-in lane and a Codex lane never are.
 *  - Signed in: a last check of `ok` inside 7 d. Inconclusive: an unreadable lane state, or a last check inside 7 d
 *    that learned nothing. Not checked: no lane state, no check, or a check 7 d old or older.
 */
export function stateWordFor(i: StateWordInput): AccountStateAnswer {
  const { now } = i;
  const lane = i.lane ?? { kind: 'absent' };
  const st: LaneState | null = lane.kind === 'read' ? lane.state : null;
  const check = st?.check;
  const openrouterKey = i.provider === 'openrouter' && i.kind === 'key';
  const mintedToken = i.provider === 'anthropic' && i.kind === 'token';

  if (i.disabled) return { word: 'off', source: 'Off on the fleet host' };

  if (check?.verdict === 'auth-dead') {
    return { word: 'signed-out', source: `HTTP 401 · checked ${shortSpan(now - check.at)} ago`, at: check.at };
  }
  if (i.authDead) return { word: 'signed-out', source: 'HTTP 401' };

  if (i.five !== null && i.five >= WINDOW_LIMITED_PCT) {
    return { word: 'rate-limited', source: `5h limit reached${resetLine(i.fiveResetAt, now)}` };
  }
  if (i.seven !== null && i.seven >= WINDOW_LIMITED_PCT) {
    return { word: 'rate-limited', source: `7d limit reached${resetLine(i.sevenResetAt, now)}` };
  }
  const credit = openrouterKey ? st?.credit : undefined;
  if (credit !== undefined && credit.limit !== null && credit.remaining !== null && credit.remaining <= 0) {
    return { word: 'rate-limited', source: `credit used up · ${creditLine(credit.remaining, credit.limit)}` };
  }

  if (mintedToken && st?.mintedAt !== undefined) {
    const left = st.mintedAt + MINTED_TOKEN_LIFETIME_MS - now;
    if (left < MINTED_TOKEN_EXPIRING_MS) {
      const months = Math.floor((now - st.mintedAt) / (DAY_MS * 365.25 / 12));
      const weeks = Math.round(left / DAY_MS / 7); // a unit (days to weeks), not a seven-day quantity
      const leftLine = left <= 0 ? 'past its estimated year'
        : weeks >= 1 ? `about ${plural(weeks, 'week')} left` : `about ${plural(Math.ceil(left / DAY_MS), 'day')} left`;
      return { word: 'expiring', source: `token minted ${plural(months, 'month')} ago · ${leftLine} · estimated`, at: st.mintedAt };
    }
  }
  if (credit !== undefined && credit.limit !== null && credit.limit > 0 && credit.remaining !== null
      && credit.remaining <= credit.limit * CREDIT_EXPIRING_FRACTION) {
    return { word: 'expiring', source: `credit low · ${creditLine(credit.remaining, credit.limit)}` };
  }
  if (openrouterKey && st?.keySource === 'minted' && st.keyExpiresAt !== undefined
      && st.keyExpiresAt - now < MINTED_KEY_EXPIRING_MS) {
    const days = Math.ceil((st.keyExpiresAt - now) / DAY_MS);
    return {
      word: 'expiring',
      source: days > 0 ? `key expires in ${plural(days, 'day')} · set when minted` : 'key expired · set when minted',
      at: st.keyExpiresAt,
    };
  }

  if (lane.kind === 'unreadable') return { word: 'inconclusive', source: 'lane state unreadable' };
  if (check === undefined) return { word: 'not-checked', source: 'no check recorded yet' };
  if (now - check.at >= SIGNED_IN_WITHIN_MS) {
    return { word: 'not-checked', source: `last checked ${shortSpan(now - check.at)} ago`, at: check.at };
  }
  if (check.verdict === 'ok') return { word: 'signed-in', source: `checked ${shortSpan(now - check.at)} ago`, at: check.at };
  return {
    word: 'inconclusive',
    source: `the last check couldn't reach the provider · checked ${shortSpan(now - check.at)} ago · nothing was learned about the credential`,
    at: check.at,
  };
}

/** Why a lane is not ready, the first that applies (A13's three conditions, as the lane-state file records them): no
 *  readable lane state, no last check of `ok`, or no seed verified after the last run. Display only (D-5518): `enable`
 *  reads the file on the box. Spelled here, structurally, as `LANE_NOT_READY_REASONS` in `shared/api.ts`. */
export function laneNotReadyReason(read: LaneStateRead): 'no-lane-state' | 'not-checked' | 'seed-unverified' | null {
  if (read.kind !== 'read') return 'no-lane-state';
  const st = read.state;
  if (st.check?.verdict !== 'ok') return 'not-checked';
  if (st.seedVerifiedAt === undefined || st.lastRunAt === undefined || !(st.seedVerifiedAt > st.lastRunAt)) return 'seed-unverified';
  return null;
}

// ── The lane-state file, read as untrusted (D-5755 (11); accounts plan Task A12) ───────────────────────────────────

/** The check verdict's grammar, as `deploy/account-op.mjs`'s `CHECK_VERDICT_RE` writes it. */
const VERDICT_RE = /^[a-z][a-z-]{0,31}$/;
/** A UTC time to the second (the writer's form), or to the millisecond (an OpenRouter `expires_at`). */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
/** The most an identity may hold (spec §3.4: "1–120 characters"). */
export const LANE_IDENTITY_MAX = 120;
/** C0, DEL, C1, line and paragraph separators and every format character: never in an identity a screen draws. */
const UNPRINTABLE_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\p{Cf}]/u;
/** A key hint (spec §3.4): a short prefix, an ellipsis and the last four characters, so no file can put more of a key
 *  on the wire than the hint is meant to show. */
export const KEY_HINT_RE = /^[A-Za-z0-9_-]{1,16}…[A-Za-z0-9]{4}$/;

const timeOf = (v: unknown): number | undefined => {
  if (typeof v !== 'string' || !ISO_RE.test(v)) return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : undefined;
};
const amountOf = (v: unknown): number | null | undefined =>
  v === null ? null : typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const oneOf = <T extends string>(set: readonly T[], v: unknown): T | undefined =>
  typeof v === 'string' && (set as readonly string[]).includes(v) ? v as T : undefined;

/**
 * The lane-state file's JSON, held field by field to its grammar (D-5755 (11): any fleet-user process can write the
 * file, so every field is untrusted). A field off its grammar is dropped, never the file: what is left is still a
 * measurement. Only the fields `LaneWire` carries or `stateWordFor` reads are kept; `keyHash`, `retiredKeyHash`,
 * `keyLimit`, `limitReset` and `fleetIdentity` never leave the box's file through here. `null` for a value that is
 * not a JSON object, which the reader answers as unreadable.
 */
export function laneStateOf(json: unknown): LaneState | null {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  const out: { -readonly [K in keyof LaneState]: LaneState[K] } = {};
  const c = o['check'] as { verdict?: unknown; at?: unknown } | null | undefined;
  if (c !== null && typeof c === 'object' && typeof c.verdict === 'string' && VERDICT_RE.test(c.verdict)) {
    const at = timeOf(c.at);
    if (at !== undefined) out.check = { verdict: c.verdict, at };
  }
  const id = o['identity'];
  if (typeof id === 'string' && id.trim() !== '' && id.length <= LANE_IDENTITY_MAX && !UNPRINTABLE_RE.test(id)) {
    out.identity = id;
  }
  const idSource = oneOf(LANE_IDENTITY_SOURCES, o['identitySource']);
  if (idSource !== undefined) out.identitySource = idSource;
  const hint = o['keyHint'];
  if (typeof hint === 'string' && KEY_HINT_RE.test(hint)) out.keyHint = hint;
  const keySource = oneOf(LANE_KEY_SOURCES, o['keySource']);
  if (keySource !== undefined) out.keySource = keySource;
  const cr = o['credit'] as { limit?: unknown; limit_remaining?: unknown } | null | undefined;
  if (cr !== null && typeof cr === 'object') {
    const limit = amountOf(cr.limit);
    const remaining = amountOf(cr.limit_remaining);
    if (limit !== undefined && remaining !== undefined && (limit === null || limit >= 0)) out.credit = { limit, remaining };
  }
  for (const k of ['validatedAt', 'mintedAt', 'keyExpiresAt', 'seedVerifiedAt', 'lastRunAt'] as const) {
    const t = timeOf(o[k]);
    if (t !== undefined) out[k] = t;
  }
  return out;
}
