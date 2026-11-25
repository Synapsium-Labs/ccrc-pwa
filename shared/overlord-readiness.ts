// The Overlord's readiness word, vocabulary (Overlord spec §6.4, Table 6.4a, C23, H20; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-readiness.md` Task 1). L0, context K, one concern: the fourteen words in
// the table's order with each one's meaning and the wave that makes it reachable, the starting values the decider reads, the
// classification of every generation outcome, the causes a stranded item can name, and the wire the read door serves. It
// imports only other `shared/` files, and nothing from `node:*`, because the PWA bundles it. Every union below is the key
// set of a const map with a runtime list beside it, so a new member is a compile error, never a silent wire change.
import type { GenerationOutcome } from './continuity.js';

/** Table 6.4a, in its order: the decider's rows are these, first match (Review Focus 1). A new word is a new row here, and an
 *  older build ignores the table that stores it (Table 11.5). */
export const READINESS_WORD_MAP = {
  absent: { wave: 'W1', meaning: 'No session is bound to the designation' },
  off: { wave: 'W1', meaning: 'The off rung, or mail-disabled' },
  unmeasured: { wave: 'W1', meaning: 'An input could not be read, the first sweep after boot, or a stale word' },
  dead: { wave: 'W1', meaning: 'It measures dead, or a third restart in the hour' },
  restarting: { wave: 'W1', meaning: 'Within its restart bound, at most two restarts in the hour' },
  renewing: { wave: 'W1', meaning: 'A renewal the lane started, or not yet proven' },
  degraded: { wave: 'W1', meaning: 'Chat only' },
  stranded: { wave: 'W1', meaning: 'No account can serve it, a swap is blocked, or its turn failed on its account' },
  'dialog-open': { wave: 'W1', meaning: 'A dialog has stood in its pane for 30 s' },
  wedged: { wave: 'W1', meaning: 'A turn over ten minutes, or working with no hook event for five' },
  deaf: { wave: 'W1', meaning: 'An operator message not picked up within two minutes of ready' },
  saturated: { wave: 'W3', meaning: 'Its inbox cannot be served in time' },
  unproved: { wave: 'W1', meaning: 'No proof since the word last left ready' },
  ready: { wave: 'W1', meaning: 'Proof newer than the moment the word last left ready' },
} as const;
export type ReadinessWord = keyof typeof READINESS_WORD_MAP;
export const READINESS_WORDS = Object.keys(READINESS_WORD_MAP) as readonly ReadinessWord[];
export const isReadinessWord = (v: unknown): v is ReadinessWord =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(READINESS_WORD_MAP, v);

/** The order the word falls by, which the hold tier reads: `ready` 2, `unproved` 1, every other word 0 (question 2). The
 *  monotonicity property is stated over it. */
export function admitRank(w: ReadinessWord): 0 | 1 | 2 {
  return w === 'ready' ? 2 : w === 'unproved' ? 1 : 0;
}

/** The unit's `RestartSec=3` plus W0b's measured p95 restart time, 6.1 s, counted from the first pass that saw the body down
 *  (question 4, slug `restart-bound-adds-the-restart-delay`). A test reads the unit file, so a change of it reds this. */
export const READINESS_RESTART_BOUND_MS = 9_100;
/** Table 11.5b: two restarts in an hour; a third reads `dead`. */
export const READINESS_RESTARTS_PER_HOUR = 2;
/** The window `restartsSince` counts over. */
export const READINESS_RESTART_WINDOW_MS = 3_600_000;
export const READINESS_DIALOG_MS = 30_000;
export const READINESS_LONG_TURN_MS = 600_000;
export const READINESS_HOOK_QUIET_MS = 300_000;
export const READINESS_DEAF_MS = 120_000;
/** A served word is the stored one only while this process's lane passed within this long: three sweeps (fix round 1, F2). */
export const READINESS_FRESH_MS = 30_000;
/** The lane's cadence (question 5, slug `readiness-sweeps-every-ten-seconds`): the mail and asks lanes' 10 s. */
export const OVERLORD_READINESS_SWEEP_MS = 10_000;
/** How long readiness rows are kept, as `overlord_sequence` keeps its lines (question 13, Table 11.5b). */
export const READINESS_KEEP_MS = 90 * 24 * 3_600_000;
/** The lane prunes once a day on its own pass, never on a lane of its own. */
export const READINESS_PRUNE_EVERY_MS = 24 * 3_600_000;

/** Every generation outcome classified once (question 3): a `restart` adds to the count, a `renewal` and a `clear` do not, and
 *  `retire` (the operator ended the binding, and no later start replaced it) is no restart either (slug
 *  `retired-outcome-is-not-a-restart`). An `unmeasured` outcome counts as a restart, the direction that falls with doubt. A new
 *  outcome is a compile error here. */
export const RESTART_OUTCOME_MAP: Readonly<Record<GenerationOutcome, 'restart' | 'renewal' | 'clear' | 'retire'>> = {
  renewed: 'renewal',
  crashed: 'restart',
  swapped: 'restart',
  woken: 'restart',
  'woken-elsewhere': 'restart',
  unmeasured: 'restart',
  cleared: 'clear',
  retired: 'retire',
};
/** The outcomes `restartsSince` counts, derived from the map. */
export const RESTART_OUTCOMES = (Object.keys(RESTART_OUTCOME_MAP) as GenerationOutcome[])
  .filter((o) => RESTART_OUTCOME_MAP[o] === 'restart');

/** The causes a stranded item can name (C57 and Table 6.4a). `projection` and `set-unreadable` have no structured reader yet, so
 *  they read `unread`, with ccd's sentence (slug `strand-cause-from-structured-readers`); they stay for the item's text. */
export const STRAND_CAUSE_MAP = {
  limited: 'Every account in its set is limited',
  projection: 'The pool projection is stale or unreadable',
  'set-unreadable': 'The set on its route record is unreadable or malformed',
  'set-admits-none': 'Its set admits no account that can serve it',
  'swap-blocked': 'A swap off its account was refused',
  'turn-failed': 'Its last turn failed on its account',
  unread: 'ccd marked it stranded',
} as const;
export type StrandCause = keyof typeof STRAND_CAUSE_MAP;
export const STRAND_CAUSES = Object.keys(STRAND_CAUSE_MAP) as readonly StrandCause[];
export const isStrandCause = (v: unknown): v is StrandCause =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(STRAND_CAUSE_MAP, v);

/** The StopFailure tokens that mean the account failed the turn: exactly Table 6.4a's three. The hook records Claude Code's
 *  `error` field cleaned to `[a-z_]` (`ccd/session-hook.sh`, the StopFailure arm); a test pins that each is in the account class
 *  of `server/src/coord/stopFailure.ts#STOP_FAILURE_ERRORS`, so the two never disagree. Any other token is a failed turn that
 *  is not the account's, and strands nothing. */
export const ACCOUNT_FAILURE_ERRS: readonly string[] = ['rate_limit', 'authentication_failed', 'billing_error'];

/** The operator items this lane raises (question 9): one per cause, settled by the lane when the cause clears. */
const READINESS_ITEM_KIND_MAP = {
  stranded: 'no account can serve the Overlord, keyed by the strand cause',
  count: 'the Overlord counts fewer than two accounts (C56)',
  hold: 'an account is held out of the Overlord\'s ordered list, keyed by the lane (renewal readings Q6)',
} as const;
export type ReadinessItemKind = keyof typeof READINESS_ITEM_KIND_MAP;
export const READINESS_ITEM_KINDS = Object.keys(READINESS_ITEM_KIND_MAP) as readonly ReadinessItemKind[];
/** Who ended an item's record: the lane's settle, or the operator's move (F8). */
export const READINESS_CLOSED_BY = ['lane', 'operator'] as const;
export type ReadinessClosedBy = (typeof READINESS_CLOSED_BY)[number];

/** Where questions go meanwhile. W1 has no holds, so always the operator; W3 adds `overlord` for `ready`. */
export type QuestionsGo = 'operator';

/** What `GET /api/overlord/readiness` serves and `readinessRead()` returns, both through `servedReadiness`. */
export interface ReadinessWire {
  readonly word: ReadinessWord;
  /** When the word last changed (epoch ms, server wall); for a served `unmeasured` (`boot` or `stale`), the moment this
   *  process stopped vouching for the stored word. */
  readonly since: number;
  /** The input that decided an `unmeasured` (`boot`, `stale`, `registry`, or the producer), or the row's own detail (the dead
   *  cause, the strand cause). */
  readonly why: string | null;
  /** For `renewing`: the generation's deadline. For `restarting`: the first sighting plus the bound. Otherwise null. */
  readonly until: number | null;
  readonly questionsGo: QuestionsGo;
  /** Designation B's `restartVerdict(...).ok` at the row's write: the door would act. Only `dead` can be true. */
  readonly restartable: boolean;
  readonly strandCause: StrandCause | null;
}

/** The two words a served `unmeasured` carries when this process cannot vouch for the stored word (F2). */
export const READINESS_SERVED_WHY = { boot: 'boot', stale: 'stale' } as const;
