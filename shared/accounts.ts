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
  /** When `add` made the lane and when `enable` first switched it on (accounts plan Task A16): the write routes' discard
   *  check reads them (A17, D-7739). Never on `LaneWire`. */
  readonly addedAt?: number;
  readonly enabledAt?: number;
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

/** The source sentences whose words carry an age, spelled once: `stateWordFor` writes them at the server's instant and
 *  `sourceAt` speaks them again at the screen's (D-7718 (10)). */
const checkedAgo = (at: number, now: number): string => `checked ${shortSpan(now - at)} ago`;
const limitSource = (window: '5h' | '7d', resetAt: number | null | undefined, now: number): string =>
  `${window} limit reached${resetLine(resetAt, now)}`;
const unreachedSource = (at: number, now: number): string =>
  `the last check couldn't reach the provider · ${checkedAgo(at, now)} · nothing was learned about the credential`;
const mintedTokenSource = (mintedAt: number, now: number): string => {
  const left = mintedAt + MINTED_TOKEN_LIFETIME_MS - now;
  const months = Math.floor((now - mintedAt) / (DAY_MS * 365.25 / 12));
  const weeks = Math.round(left / DAY_MS / 7); // a unit (days to weeks), not a seven-day quantity
  const leftLine = left <= 0 ? 'past its estimated year'
    : weeks >= 1 ? `about ${plural(weeks, 'week')} left` : `about ${plural(Math.ceil(left / DAY_MS), 'day')} left`;
  return `token minted ${plural(months, 'month')} ago · ${leftLine} · estimated`;
};
const keyExpirySource = (expiresAt: number, now: number): string => {
  const days = Math.ceil((expiresAt - now) / DAY_MS);
  return days > 0 ? `key expires in ${plural(days, 'day')} · set when minted` : 'key expired · set when minted';
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
    return { word: 'signed-out', source: `HTTP 401 · ${checkedAgo(check.at, now)}`, at: check.at };
  }
  if (i.authDead) return { word: 'signed-out', source: 'HTTP 401' };

  if (i.five !== null && i.five >= WINDOW_LIMITED_PCT) {
    return { word: 'rate-limited', source: limitSource('5h', i.fiveResetAt, now) };
  }
  if (i.seven !== null && i.seven >= WINDOW_LIMITED_PCT) {
    return { word: 'rate-limited', source: limitSource('7d', i.sevenResetAt, now) };
  }
  const credit = openrouterKey ? st?.credit : undefined;
  if (credit !== undefined && credit.limit !== null && credit.remaining !== null && credit.remaining <= 0) {
    return { word: 'rate-limited', source: `credit used up · ${creditLine(credit.remaining, credit.limit)}` };
  }

  if (mintedToken && st?.mintedAt !== undefined) {
    const left = st.mintedAt + MINTED_TOKEN_LIFETIME_MS - now;
    if (left < MINTED_TOKEN_EXPIRING_MS) return { word: 'expiring', source: mintedTokenSource(st.mintedAt, now), at: st.mintedAt };
  }
  if (credit !== undefined && credit.limit !== null && credit.limit > 0 && credit.remaining !== null
      && credit.remaining <= credit.limit * CREDIT_EXPIRING_FRACTION) {
    return { word: 'expiring', source: `credit low · ${creditLine(credit.remaining, credit.limit)}` };
  }
  if (openrouterKey && st?.keySource === 'minted' && st.keyExpiresAt !== undefined
      && st.keyExpiresAt - now < MINTED_KEY_EXPIRING_MS) {
    return { word: 'expiring', source: keyExpirySource(st.keyExpiresAt, now), at: st.keyExpiresAt };
  }

  if (lane.kind === 'unreadable') return { word: 'inconclusive', source: 'lane state unreadable' };
  if (check === undefined) return { word: 'not-checked', source: 'no check recorded yet' };
  if (now - check.at >= SIGNED_IN_WITHIN_MS) {
    return { word: 'not-checked', source: `last ${checkedAgo(check.at, now)}`, at: check.at };
  }
  if (check.verdict === 'ok') return { word: 'signed-in', source: checkedAgo(check.at, now), at: check.at };
  return { word: 'inconclusive', source: unreachedSource(check.at, now), at: check.at };
}

/** The reset instants (epoch seconds) a Rate-limited source counts down to: the telemetry row's, which is what
 *  `stateWordFor` read them from. */
export interface SourceResets {
  readonly fiveResetAt?: number | null;
  readonly sevenResetAt?: number | null;
}

/** "checked 4m ago" wherever a source says how long ago its check was. */
const CHECKED_AGO_RE = /\bchecked \d+[smhd] ago\b/;
/** A window's limit with or without its countdown. */
const LIMIT_RE = /^(5h|7d) limit reached(?: · resets in (?:\d+h )?\d+m)?$/;
const MINTED_TOKEN_RE = /^token minted \d+ months? ago · (?:past its estimated year|about \d+ (?:weeks?|days?) left) · estimated$/;
const KEY_EXPIRY_RE = /^key expire(?:s in \d+ days?|d) · set when minted$/;

/**
 * An answer's source spoken at `now` (D-7718 (10)). The server writes its ages into the source at request time
 * ("checked 2h ago", "resets in 1h 12m", "key expires in 9 days"), and an answer the screen holds keeps that text for
 * as long as it holds the answer: offline, for hours. Every other age on the card is the screen's own, from its own
 * clock, so a held source would contradict its card. This says the same sentence again from the instant it was
 * measured (`answer.at`) or the window's reset (`resets`), with the same spelling `stateWordFor` used, so a source
 * re-spoken at the server's instant is the server's text. A source this build does not recognise (a newer server's), an
 * answer with no finite `at`, or a countdown with no reset to count to, stands as it came. The word is never changed:
 * a word that would have moved since is the held answer's, and the screen says how old that answer is elsewhere.
 */
export function sourceAt(answer: AccountStateAnswer, now: number, resets?: SourceResets): string {
  const { word, source } = answer;
  const at = typeof answer.at === 'number' && Number.isFinite(answer.at) ? answer.at : undefined;
  switch (word) {
    case 'signed-out': case 'signed-in': case 'not-checked': case 'inconclusive':
      return at !== undefined && CHECKED_AGO_RE.test(source) ? source.replace(CHECKED_AGO_RE, checkedAgo(at, now)) : source;
    case 'rate-limited': {
      const m = LIMIT_RE.exec(source);
      if (m === null || resets === undefined) return source;
      const window = m[1] as '5h' | '7d';
      return limitSource(window, window === '5h' ? resets.fiveResetAt : resets.sevenResetAt, now);
    }
    case 'expiring':
      if (at === undefined) return source;
      if (MINTED_TOKEN_RE.test(source)) return mintedTokenSource(at, now);
      if (KEY_EXPIRY_RE.test(source)) return keyExpirySource(at, now);
      return source;
    default:
      return source;
  }
}

/** Why a lane is not ready, the first that applies (A13's three conditions, as the lane-state file records them): no
 *  readable lane state, no check, a last check not `ok`, or no seed verified after the last run. Display only (D-5518):
 *  `enable` reads the file on the box, which alone also answers `no-credential` (D-7732). In the box's order. */
export function laneNotReadyReason(read: LaneStateRead): 'no-lane-state' | 'not-checked' | 'check-failed' | 'seed-unverified' | null {
  if (read.kind !== 'read') return 'no-lane-state';
  const st = read.state;
  if (st.check === undefined) return 'not-checked';
  if (st.check.verdict !== 'ok') return 'check-failed';
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

/** An identity a lane-state file may hold and a screen may draw: 1 to `LANE_IDENTITY_MAX` characters, not blank, no
 *  unprintable character. The one grammar for the file's `identity` and for the stated account `set` carries (the write
 *  routes refuse anything else `bad-stated` before the verb, which holds it to its own rule again; A17, D-7739). */
export const isLaneIdentity = (v: unknown): v is string =>
  typeof v === 'string' && v.trim() !== '' && v.length <= LANE_IDENTITY_MAX && !UNPRINTABLE_RE.test(v);

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
 * measurement. Only the fields `LaneWire` carries, `stateWordFor` reads or the write routes' discard check reads
 * (`addedAt`, `enabledAt`) are kept; `keyHash`, `retiredKeyHash`,
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
  if (isLaneIdentity(id)) out.identity = id;
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
  for (const k of ['validatedAt', 'mintedAt', 'keyExpiresAt', 'seedVerifiedAt', 'lastRunAt', 'addedAt', 'enabledAt'] as const) {
    const t = timeOf(o[k]);
    if (t !== undefined) out[k] = t;
  }
  return out;
}

// ── The kind chip (spec §4.1 "Type is visible"; accounts plan Task A2, D-7718) ──────────────────────────────────────

/** Each lane kind's chip, keyed `<provider>/<kind>` (`RosterKindWire`'s two fields, spelled structurally so this file
 *  imports nothing): `words` is Refined's mono chip, `code` Instrument's short column (A4). The one list: the screens
 *  read it through `kindCodeOf` and never re-list a kind. */
export const KIND_CODES = {
  'anthropic/sign-in': { words: 'claude · sign-in', code: 'cl·in' },
  'anthropic/token': { words: 'claude · token', code: 'cl·tok' },
  'openai/codex': { words: 'chatgpt · codex', code: 'gpt' },
  'openrouter/key': { words: 'openrouter · key', code: 'or' },
  'compatible/key': { words: 'compatible · key', code: 'cmp' },
} as const;
export type KindCode = (typeof KIND_CODES)[keyof typeof KIND_CODES];

/** The chip for a lane's provider and kind, or `null` when the roster does not say (an older server, an undeclared
 *  lane) or names a pair this build has no chip for: no chip rather than a wrong one. */
export function kindCodeOf(provider: string | undefined, kind: string | undefined): KindCode | null {
  if (provider === undefined || kind === undefined) return null;
  const key = `${provider}/${kind}`;
  return Object.prototype.hasOwnProperty.call(KIND_CODES, key) ? KIND_CODES[key as keyof typeof KIND_CODES] : null;
}

// ── What the operator is asked to open (N2 `auth-url-allowlist`, D-7792; spec §3.7, §3.8; accounts plan Task A21) ──

/** The sign-in methods `POST /api/accounts/:id/auth/start` takes (spec §13.1), the verb's `--method` words. */
export const AUTH_METHODS = ['login', 'setup-token', 'openai-login', 'openrouter-pkce'] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];

/** The states the sign-in helper publishes in `~/.cc-sessions/.auth/<id>.json` (`ccd-account-auth`'s `_auth_state`,
 *  `_auth_end` and its two terminal assignments), in the order a sign-in moves through them. A state off this list is
 *  a file somebody else wrote. */
export const AUTH_STATUS_STATES = ['starting', 'url', 'waiting-code', 'exchanging', 'done', 'failed', 'expired', 'cancelled'] as const;
export type AuthStatusState = (typeof AUTH_STATUS_STATES)[number];
/** The states after which the helper writes nothing more. */
export const AUTH_TERMINAL_STATES: readonly AuthStatusState[] = ['done', 'failed', 'expired', 'cancelled'];

/** The helper's own bound on one attempt (`CCRC_AUTH_TIMEOUT`'s default in `ccd-account-auth`, 600 s): the latest an
 *  attempt's `expiresAt` can be. The helper publishes no provider expiry, so this bound is the earlier of the two. */
export const AUTH_HELPER_BOUND_MS = 600_000;

/**
 * THE EXACT HOSTS a sign-in URL may name, per method (N2, D-7792), from OA1b's record of 2026-11-01: an exact match on
 * the host the server parsed, never a suffix, so `evilclaude.com` and `claude.com.example.invalid` are refused.
 *  - `login` and `setup-token`: measured, both `https://claude.com/cai/oauth/authorize`.
 *  - `openai-login`: NOT measured (the provider refused the device-code request that day), so the list is empty and
 *    the route refuses to start one (`method-unmeasured`) until a box run measures the host and it is added here.
 *  - `openrouter-pkce`: never read from the status file (spec §3.8); its own wave checks the URL the verb answers.
 */
export const AUTH_URL_HOSTS: Readonly<Record<AuthMethod, readonly string[]>> = {
  'login': ['claude.com'],
  'setup-token': ['claude.com'],
  'openai-login': [],
  'openrouter-pkce': [],
};

/** THE EXACT PATH a sign-in URL may name, per method (N2, D-7792), from the same record: `login` and `setup-token` were
 *  both measured at `/cai/oauth/authorize`. `null` for a method with no measured host (no URL is accepted for it). */
export const AUTH_URL_PATHS: Readonly<Record<AuthMethod, string | null>> = {
  'login': '/cai/oauth/authorize',
  'setup-token': '/cai/oauth/authorize',
  'openai-login': null,
  'openrouter-pkce': null,
};

/**
 * The shape of the code the operator pastes, per method (spec §3.7), checked by the route before the code is sent.
 *  - `login`: measured (OA1b): 48 alphanumerics, `#`, then 43 base64url characters.
 *  - `setup-token`: NOT measured (OA1b's record: pending the operator's approval of that step), so it keeps the spec's
 *    provisional shape, which both measured `login` samples also match. Tighten it when the box run measures it.
 *  - `openai-login`: a device sign-in has no code to paste; `null` refuses every one.
 *  - `openrouter-pkce`: its own wave's.
 */
export const AUTH_CODE_SHAPES: Readonly<Record<AuthMethod, RegExp | null>> = {
  'login': /^[A-Za-z0-9]{48}#[A-Za-z0-9_-]{43}$/,
  'setup-token': /^[A-Za-z0-9._#-]{8,512}$/,
  'openai-login': null,
  'openrouter-pkce': null,
};

/** The methods whose sign-in shows the operator a device code (spec §3.8): the Codex device sign-in only. For every
 *  other method a status file's `userCode` is never read and never answered: the helper's device-code scan runs on
 *  every line it reads, and a 43-character base64url `code_challenge` or `state` in the authorize URL holds a
 *  `XXXX-XXXX` run about once in ninety URLs, so refusing it would end a genuine sign-in as a rewrite (D-7792). */
export const AUTH_DEVICE_CODE_METHODS: readonly AuthMethod[] = ['openai-login'];

/** The shape of the device code a status file may carry, per method of {@link AUTH_DEVICE_CODE_METHODS} (spec §3.8):
 *  `null` refuses every one. The Codex `userCode` is NOT measured (OA1b), so it is `null`; a method off that list never
 *  reads its entry. */
export const AUTH_USER_CODE_SHAPES: Readonly<Record<AuthMethod, RegExp | null>> = {
  'login': null,
  'setup-token': null,
  'openai-login': null,
  'openrouter-pkce': null,
};

/** The longest sign-in URL the server reads from a status file. */
export const AUTH_URL_MAX = 4096;

/** A sign-in URL the server parsed and accepted: the URL as the parser spelled it, and the host the label shows. */
export interface AuthUrlAccepted { readonly href: string; readonly host: string }

/**
 * N2's URL check (D-7792; spec §3.8). Pure. `text` is the status file's `url`, which any fleet-user process can write.
 * Accepted only when it is a string of printable, unspaced characters within {@link AUTH_URL_MAX}, parses as a URL,
 * is `https:`, carries no user name, password, explicit port or fragment, names a host in the method's exact list, and
 * the method's exact path ({@link AUTH_URL_PATHS}). The query is the provider's and is not read here: the route masks
 * the whole answer and refuses one the mask changed, so a credential planted in it never crosses. The answer's `host`
 * is the parsed URL's `hostname`, never a slice of the file's text, and `href` the parser's spelling.
 */
export function authUrlVerdict(text: unknown, method: AuthMethod): AuthUrlAccepted | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > AUTH_URL_MAX || /[\u0000- \u007f-\u009f]/.test(text)) return null;
  let url: URL;
  try { url = new URL(text); } catch { return null; }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') return null;
  if (url.hash !== '' || text.includes('#')) return null;
  if (!AUTH_URL_HOSTS[method].includes(url.hostname) || url.pathname !== AUTH_URL_PATHS[method]) return null;
  return { href: url.href, host: url.hostname };
}

/** Whether `code` may be sent for `method`: its measured (or provisional) shape, {@link AUTH_CODE_SHAPES}. Pure. */
export function authCodeShapeOk(code: unknown, method: AuthMethod): code is string {
  const shape = AUTH_CODE_SHAPES[method];
  return shape !== null && typeof code === 'string' && shape.test(code);
}
