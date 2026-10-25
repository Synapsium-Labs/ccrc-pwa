// L0 (imports nothing): the vocabulary of PR landing in ccrc, stage 1 (the checks mail). Every word is derived from
// one map, and every detail grammar has exactly ONE writer and ONE reader here; a reader answers null for anything it
// does not know. The deciders are `server/src/coord/landing.ts` (L1); the rows are written by the checks lane (L4).

/** The required checks of one PR head, as a verdict word. The order of precedence when a required set mixes words is
 *  `REQUIRED_CHECKS_PRECEDENCE` below, one total order. */
export const REQUIRED_CHECKS_MAP = {
  green: 'every required name is passing on the head',
  red: 'at least one required name is red',
  pending: 'none is red, and at least one required name is running or pending',
  'not-reported': 'none is red or running, and at least one required name has no context at all',
  unverifiable: 'a required name pinned to an App shows only as a commit status, which carries no App id',
  unmeasured: 'the read did not answer, or answered a shape this build does not know',
} as const;
export type RequiredChecksWord = keyof typeof REQUIRED_CHECKS_MAP;
export const REQUIRED_CHECKS_WORDS: readonly RequiredChecksWord[] = Object.keys(REQUIRED_CHECKS_MAP) as RequiredChecksWord[];
/** The one total precedence when a required set mixes words (the word that WINS comes first). */
export const REQUIRED_CHECKS_PRECEDENCE: readonly RequiredChecksWord[] =
  ['unmeasured', 'red', 'unverifiable', 'pending', 'not-reported', 'green'];

/** The five mails of the checks lane. */
export const CHECKS_MAIL_MAP = {
  green: 'every required check passed on the head the run advanced at',
  red: 'a required check failed on that head',
  stuck: 'the wait has no end the server can see, so the coordinator goes back to the foreground wait',
  moved: 'the PR head moved off the head the run advanced at',
  left: 'the PR is no longer one this episode can wait on',
} as const;
export type ChecksMailWord = keyof typeof CHECKS_MAIL_MAP;
export const CHECKS_MAIL_WORDS: readonly ChecksMailWord[] = Object.keys(CHECKS_MAIL_MAP) as ChecksMailWord[];

/** Why a `stuck` mail was sent. */
export const STUCK_CAUSE_MAP = {
  timeout: 'read by the lane, and still unsettled (or still red) when the bound fell due',
  unmeasured: 'the pass could not read the episode, or its read did not answer',
  unverifiable: 'a required name cannot be verified from a commit status, which waiting will not change',
  disabled: 'the landing lane was switched off while the episode was live',
} as const;
export type StuckCause = keyof typeof STUCK_CAUSE_MAP;
export const STUCK_CAUSES: readonly StuckCause[] = Object.keys(STUCK_CAUSE_MAP) as StuckCause[];

/** Why an episode ended in `left`. */
export const LEFT_PHASE_MAP = {
  closed: 'the PR was closed',
  draft: 'the PR was turned into a draft',
  unbound: 'the PR no longer binds to the workspace',
  merged: 'the PR merged (the merge notice is the wake, so no checks mail is sent)',
} as const;
export type LeftPhase = keyof typeof LEFT_PHASE_MAP;
export const LEFT_PHASES: readonly LeftPhase[] = Object.keys(LEFT_PHASE_MAP) as LeftPhase[];

/** The mode an episode is decided in, once, at the advance. */
export const CHECKS_MODE_MAP = {
  live: 'the lane reads, writes rows and mails the coordinator',
  shadow: 'the lane reads and writes shadow rows, and mails nothing',
  off: 'the episode is outside the population',
} as const;
export type ChecksMode = keyof typeof CHECKS_MODE_MAP;
export const CHECKS_MODES: readonly ChecksMode[] = Object.keys(CHECKS_MODE_MAP) as ChecksMode[];

/** The reasons `pr-landing` gives for a line it could not measure, as far as this build names them. An unknown
 *  reason is still `unmeasured`; these are only the words this build spells. */
export const PR_LANDING_REASON_MAP = {
  'pr-unreadable': 'GitHub answered no object for the PR number',
  'branch-drift': 'the workspace is no longer on the branch the PR was opened from',
} as const;

/** The 45 min bound of a wait (the CI job bound is 30 min). */
export const LANDING_CHECKS_STUCK_MS = 2_700_000;
/** The capability token the advance answers for a live episode. */
export const CHECKS_MAIL_TOKEN = 'checks-mail-v1';

/** Every hyphenated word this file defines, for the kebab scan in `mail-routes.test.ts` (via `coord/landing.ts`). */
export const LANDING_KEBABS: ReadonlySet<string> = new Set(
  [...REQUIRED_CHECKS_WORDS, ...CHECKS_MAIL_WORDS, ...STUCK_CAUSES, ...LEFT_PHASES, ...CHECKS_MODES,
    ...Object.keys(PR_LANDING_REASON_MAP)].filter((w) => w.includes('-')),
);

// ── canonical numbers and hashes ──────────────────────────────────────────────────────────────────────────────

const POSITIVE_INT_RE = /^[1-9][0-9]*$/;
const NON_NEGATIVE_INT_RE = /^(?:0|[1-9][0-9]*)$/;
const HEAD40_RE = /^[0-9a-f]{40}$/;
const FP12_RE = /^[0-9a-f]{12}$/;

const positiveInt = (s: string): number | null => {
  if (!POSITIVE_INT_RE.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
};
const nonNegativeInt = (s: string): number | null => {
  if (!NON_NEGATIVE_INT_RE.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
};
const isPositiveSafe = (n: number): boolean => Number.isSafeInteger(n) && n > 0;
const isNonNegativeSafe = (n: number): boolean => Number.isSafeInteger(n) && n >= 0;

/** True for a 12-hex fingerprint. */
export const isFp12 = (s: string): boolean => FP12_RE.test(s);
/** True for a 40-hex head. */
export const isHead40 = (s: string): boolean => HEAD40_RE.test(s);

// ── the transition row's detail: `merging-at:<head40>:<pr>:<mode>` ──────────────────────────────────────────────

const MERGING_AT_PREFIX = 'merging-at:';

export interface MergingAt { head: string; pr: number | null; mode: ChecksMode }

/** The ONE writer. `pr` is a positive integer, or null (spelled `none`, which only an `off` episode may carry). */
export function mergingAtDetail(head: string, pr: number | null, mode: ChecksMode): string {
  if (!HEAD40_RE.test(head)) throw new RangeError('mergingAtDetail: head is not 40 hex');
  if (!(CHECKS_MODES as readonly string[]).includes(mode)) throw new RangeError('mergingAtDetail: unknown mode');
  if (pr === null) {
    if (mode !== 'off') throw new RangeError('mergingAtDetail: only an off episode carries no PR');
    return `${MERGING_AT_PREFIX}${head}:none:${mode}`;
  }
  if (!isPositiveSafe(pr)) throw new RangeError('mergingAtDetail: pr is not a positive integer');
  return `${MERGING_AT_PREFIX}${head}:${pr}:${mode}`;
}

/** The ONE reader: null for anything it does not know. */
export function readMergingAtDetail(detail: string): MergingAt | null {
  if (!detail.startsWith(MERGING_AT_PREFIX)) return null;
  const parts = detail.slice(MERGING_AT_PREFIX.length).split(':');
  if (parts.length !== 3) return null;
  const [head, prText, mode] = parts as [string, string, string];
  if (!HEAD40_RE.test(head)) return null;
  if (!(CHECKS_MODES as readonly string[]).includes(mode)) return null;
  if (prText === 'none') return mode === 'off' ? { head, pr: null, mode: mode as ChecksMode } : null;
  const pr = positiveInt(prText);
  return pr === null ? null : { head, pr, mode: mode as ChecksMode };
}

// ── the episode's rows: `landing:checks:<e>:<gen>:<what>…` and `landing:checks:<e>:moved|left` ────────────────────

export const CHECKS_ROW_PREFIX = 'landing:checks:';
export const CHECKS_SHADOW_ROW_PREFIX = 'landing-shadow:checks:';

export const CHECKS_ROW_WHATS = ['open', 'green', 'red', 'stuck'] as const;
export type ChecksRowWhat = (typeof CHECKS_ROW_WHATS)[number];
export const CHECKS_END_WORDS = ['moved', 'left'] as const;
export type ChecksEndWord = (typeof CHECKS_END_WORDS)[number];
/** What a `stuck` row records the lane saw. */
export const STUCK_READING_WORDS = ['pending', 'not-reported', 'unverifiable', 'red'] as const;
export type StuckReadingWord = (typeof STUCK_READING_WORDS)[number];

const isStuckReading = (s: string): boolean => {
  if (s === 'unread') return true;
  const at = s.indexOf('@');
  if (at < 0) return false;
  return (STUCK_READING_WORDS as readonly string[]).includes(s.slice(0, at)) && FP12_RE.test(s.slice(at + 1));
};

/** The ONE writer of an `open`/`green`/`red`/`stuck` row's detail. `suffix` is the 12-hex fingerprint for `green` and
 *  `red` (REQUIRED), the reading for `stuck` (REQUIRED: `unread`, or `<word>@<fp12>`), and absent for `open`. */
export function checksRowDetail(e: number, gen: number, what: ChecksRowWhat, suffix?: string, shadow = false): string {
  if (!isPositiveSafe(e)) throw new RangeError('checksRowDetail: e is not a positive integer');
  if (!isNonNegativeSafe(gen)) throw new RangeError('checksRowDetail: gen is not a non-negative integer');
  const head = `${shadow ? CHECKS_SHADOW_ROW_PREFIX : CHECKS_ROW_PREFIX}${e}:${gen}:${what}`;
  if (what === 'open') {
    if (suffix !== undefined) throw new RangeError('checksRowDetail: an open row carries no suffix');
    return head;
  }
  if (what === 'stuck') {
    if (suffix === undefined || !isStuckReading(suffix)) throw new RangeError('checksRowDetail: a stuck row needs its reading');
    return `${head}:${suffix}`;
  }
  if (what !== 'green' && what !== 'red') throw new RangeError('checksRowDetail: unknown row');
  if (suffix === undefined || !FP12_RE.test(suffix)) throw new RangeError('checksRowDetail: an edge row needs its fingerprint');
  return `${head}@${suffix}`;
}

/** The ONE writer of a `moved` or `left` row's detail (one per episode, no generation). */
export function checksEndDetail(e: number, word: ChecksEndWord, shadow = false): string {
  if (!isPositiveSafe(e)) throw new RangeError('checksEndDetail: e is not a positive integer');
  if (word !== 'moved' && word !== 'left') throw new RangeError('checksEndDetail: unknown word');
  return `${shadow ? CHECKS_SHADOW_ROW_PREFIX : CHECKS_ROW_PREFIX}${e}:${word}`;
}

export interface ChecksRowRead {
  shadow: boolean;
  e: number;
  /** null for `moved` and `left`, which carry no generation. */
  gen: number | null;
  what: ChecksRowWhat | ChecksEndWord;
  /** The 12-hex fingerprint of a `green` or `red` row. */
  fp: string | null;
  /** The reading of a `stuck` row (`unread`, or `<word>@<fp12>`). */
  reading: string | null;
}

/** The ONE reader of every row `checksRowDetail` and `checksEndDetail` write: null for anything it does not know. */
export function readChecksRowDetail(detail: string): ChecksRowRead | null {
  let shadow: boolean;
  let rest: string;
  if (detail.startsWith(CHECKS_ROW_PREFIX)) { shadow = false; rest = detail.slice(CHECKS_ROW_PREFIX.length); }
  else if (detail.startsWith(CHECKS_SHADOW_ROW_PREFIX)) { shadow = true; rest = detail.slice(CHECKS_SHADOW_ROW_PREFIX.length); }
  else return null;
  const parts = rest.split(':');
  const e = positiveInt(parts[0] ?? '');
  if (e === null) return null;
  if (parts.length === 2) {
    const w = parts[1]!;
    return w === 'moved' || w === 'left' ? { shadow, e, gen: null, what: w, fp: null, reading: null } : null;
  }
  if (parts.length < 3) return null;
  const gen = nonNegativeInt(parts[1]!);
  if (gen === null) return null;
  const tail = parts.slice(2).join(':');
  if (tail === 'open') return { shadow, e, gen, what: 'open', fp: null, reading: null };
  if (parts.length === 3) {
    const at = tail.indexOf('@');
    if (at < 0) return null;
    const what = tail.slice(0, at);
    const fp = tail.slice(at + 1);
    if ((what !== 'green' && what !== 'red') || !FP12_RE.test(fp)) return null;
    return { shadow, e, gen, what, fp, reading: null };
  }
  if (parts[2] !== 'stuck') return null;
  const reading = parts.slice(3).join(':');
  return isStuckReading(reading) ? { shadow, e, gen, what: 'stuck', fp: null, reading } : null;
}
