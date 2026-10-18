import { PRESENCE_OPEN_TTL_MS, type FleetSession } from '../../../shared/api.js';

/**
 * HIBERNATE LONG-IDLE SESSIONS (D-5242, `hibernate-long-idle-sessions`, spec §5.11): the server's pure verdict.
 *
 * The server decides, because only it sees every fact the operator's ruling names — open runs, claims, outstanding
 * mail, a screen with the session open — and it already assembles the rest every tick. `ccd hibernate <id>` (plan
 * Task 16) acts, after re-measuring the box-local half at the act (and the one hold the server cannot see,
 * `attached`). THIS TASK (17a) ONLY DECIDES: its sweep (`hibernateSweep.ts`) logs a shadow line for a `hibernate`
 * answer and can do nothing else; the live act arrives in Task 17b, behind `$REG/hibernate-live`, together with every
 * path that wakes a session.
 *
 * L1: decisions only, over what the sweep measured. It imports L0 alone.
 *
 * IDLE MEANS ALL OF THESE, on one assembled row (spec §5.11):
 * - a live pane, its identity and status measured, its RAW live word `idle` (not `busy`, `waiting` or `shell`), no
 *   pane menu;
 * - bucket `idle` — a `done` row is badged (`pwa/src/lib/seen.ts`'s `BADGED`) and a dead row never is, so sleeping it
 *   could hide a result nobody has read; it falls to `idle` on its own 30 minutes after its newest hookstate stamp
 *   (`HOOKSTATE_FRESH_MS`), long before N — no `background`, an empty roster;
 * - the turn marker reads `done`, its last Stop listed no background task of any kind (`bg` EXACTLY 0: −1, a Stop that
 *   carried no array, says nothing about what runs), nothing scheduled (`crons` EXACTLY 0: Claude Code's crons and
 *   wakeups are session-scoped, and a sleeping session's are gone when they fall due; absent — an older hook — holds
 *   too), and the latest of its `turnAt`, `stopAt` and `restartAt` more than N ago. Compactions do not move that clock
 *   (the row's `statusUpdatedAt` is never read), so a session Claude Code compacts while it idles still ages;
 * - no hold, no open run naming it as worker or claimant in ANY non-terminal state (the store's `state NOT IN` the
 *   terminal set, so `planned`, `awaiting-review`, `merging`, `closing` and `unknown` hold too), no claim, no mail;
 * - nobody has it open (`Presence.isOpen`, a hidden tab included), and nothing is believed about presence for
 *   `PRESENCE_OPEN_TTL_MS` after the server starts, since presence is never persisted;
 * - not stranded, swap-blocked, under a substrate fault or archived, and no `$REG/<id>.no-hibernate`.
 *
 * THE `measure` ARM (hibernate-verdict-measure-arm (D-5425)): the plan's signature answers `hibernate` or a hold;
 * this one also answers `measure`, as `stopDoneVerdict` does, so the sweep reads a pane's live word and turn marker
 * (tmux and two file reads) only for a row nothing cheaper already holds.
 *
 * THE STOP-DONE LANE (D-5370) shares these words on purpose: every hold it has that this verdict also has is spelled
 * the same, so hibernation can absorb it in Task 17b.
 */

/** Every reason a session is left awake — a `Record`, so the list below is derived and a word cannot be added without
 *  its meaning. None is terminal: the sweep asks again next time. */
const HIBERNATE_HOLD_MAP = {
  pane: 'no live pane: it is not running, so there is nothing to put to sleep',
  unmeasured: 'its identity, its status or its live file was not measured',
  'live-word': 'its live word is not `idle` (`busy`, `waiting` and `shell` hold)',
  menu: 'a pane menu is pending',
  bucket: 'its bucket is not `idle` (a `done` row is badged: its result may be unread)',
  background: 'background work is running',
  roster: 'subagents are running',
  marker: 'its turn marker does not read a finished turn (`done`), or could not be read, or is not this process\'s',
  'marker-background': 'its turn marker\'s last Stop listed background work, or could not say (`bg` not exactly 0; −1 holds)',
  scheduled: 'its last Stop listed a session cron or wakeup, or the marker cannot say (`crons` not exactly 0; absent holds)',
  recent: 'its last main event is not yet more than N hours old (or the marker carries no stamp to age)',
  held: 'a hold stands: a programme declares it mid-flight',
  'run-worker': 'an open run names it as worker (any state outside the terminal set)',
  'run-claimant': 'it claims an open run (any state outside the terminal set): it coordinates',
  'runs-unreadable': 'the coordination store could not answer its runs, claims or mail',
  claim: 'it holds a live claim',
  mail: 'mail to it is outstanding',
  viewer: 'somebody has it open (on screen or in a hidden tab), or the server started too recently to know',
  stranded: 'stranded by an automatic swap',
  'swap-blocked': 'a swap was refused for it',
  substrate: 'a substrate marker stands',
  archived: 'archived',
  'opted-out': 'the operator opted it out (`$REG/<id>.no-hibernate`)',
} as const satisfies Record<string, string>;

export type HibernateHold = keyof typeof HIBERNATE_HOLD_MAP;
export const HIBERNATE_HOLDS: readonly HibernateHold[] = Object.keys(HIBERNATE_HOLD_MAP) as HibernateHold[];
export function hibernateHoldText(h: HibernateHold): string { return HIBERNATE_HOLD_MAP[h]; }

/** N, by default: six hours of idleness — past Claude Code's one-hour prompt-cache lifetime, so a wake costs no cache
 *  that idling would have kept. */
export const HIBERNATE_AFTER_MS_DEFAULT = 6 * 60 * 60_000;
/** The range `$REG/hibernate-after-hours` may set N to, in whole hours. */
export const HIBERNATE_AFTER_HOURS_MIN = 1;
export const HIBERNATE_AFTER_HOURS_MAX = 168;

/** The sweep's own cadence, off the watcher's tick. */
export const HIBERNATE_SWEEP_MS = 5 * 60_000;
/** At most one shadow line per id this often, so a session that stays asleep-worthy is not logged every sweep. */
export const HIBERNATE_SHADOW_LINE_MS = 60 * 60_000;

/** The operator's switches and settings, all in `$REG` (`~/.cc-sessions`), all touched and removed BY HAND — nothing in
 *  the tree writes any of them (`single-definition.test.ts`):
 *  - `hibernate-disabled`: the sweep does nothing at all; it wins over `hibernate-live`;
 *  - `hibernate-live`: arms the act — Task 17b's; THIS task's sweep logs whatever it says;
 *  - `hibernate-after-hours`: N in whole hours (1 to 168), read only when listed; anything else is the default;
 *  - `<id>.no-hibernate`: that session is never put to sleep (`opted-out`). */
export const HIBERNATE_DISABLED_MARKER = 'hibernate-disabled';
export const HIBERNATE_LIVE_MARKER = 'hibernate-live';
export const HIBERNATE_AFTER_HOURS_FILE = 'hibernate-after-hours';
export const NO_HIBERNATE_SUFFIX = 'no-hibernate';

/** The live read's no-word reasons (`liveWordFor`'s), as the verdict's input spells them. */
export const HIBERNATE_LIVE_REASONS = ['no-pane', 'no-config-dir', 'unmeasured'] as const;

/** Every kebab word this file spells as a literal (its holds, its four operator settings, the live read's reasons),
 *  for `mail-routes.test.ts`'s census of `server/src/coord`: none is a mail rejection or a route refusal. Derived from
 *  the tables above, never re-spelled. */
const HIBERNATE_KEBABS: ReadonlySet<string> = new Set<string>([
  ...HIBERNATE_HOLDS, HIBERNATE_DISABLED_MARKER, HIBERNATE_LIVE_MARKER, HIBERNATE_AFTER_HOURS_FILE, NO_HIBERNATE_SUFFIX,
  ...HIBERNATE_LIVE_REASONS,
]);
export function isHibernateKebab(token: string): boolean {
  return HIBERNATE_KEBABS.has(token);
}

/** `$REG/hibernate-after-hours`'s body → N in MS. An integer from 1 to 168, surrounding whitespace allowed; anything
 *  else — absent, out of range, a fraction, a unit — is the default, never a guess at what was meant. */
export function hibernateAfterMs(raw: string | null): number {
  if (raw === null) return HIBERNATE_AFTER_MS_DEFAULT;
  const t = raw.trim();
  if (!/^[0-9]{1,3}$/.test(t)) return HIBERNATE_AFTER_MS_DEFAULT;
  const h = Number(t);
  return h >= HIBERNATE_AFTER_HOURS_MIN && h <= HIBERNATE_AFTER_HOURS_MAX ? h * 60 * 60_000 : HIBERNATE_AFTER_MS_DEFAULT;
}

/** The registry row's facts the verdict reads — the fleet frame's own row, so the sweep sees what the PWA shows. */
export type HibernateRow = Pick<FleetSession,
  'id' | 'status' | 'archivedAt' | 'bucket' | 'held' | 'unmeasured' | 'statusUnmeasured' | 'dialogPending'
  | 'background' | 'subagents' | 'stranded' | 'swapBlocked' | 'substrate'>;

/** The coordination store's answers for one session. `ok: false` when any of the reads failed or there is no store. */
export type HibernateStoreRead =
  | { readonly ok: false; readonly detail: string }
  | {
    readonly ok: true;
    /** `openRunsForSession`: a run outside the terminal set names it as worker. */
    readonly openWorker: boolean;
    /** `openRunsClaimedBy`: it claims a run outside the terminal set. */
    readonly openClaimant: boolean;
    readonly claim: boolean;
    readonly mail: boolean;
  };

/** The turn marker, as `turnMarkFor` (`turnverdict.ts`) reads it judged against the live process — the fields the
 *  verdict reads, structurally, so this L1 file still imports L0 alone. Any `ok: false` reason holds `marker`. */
export type HibernateMark =
  | {
    readonly ok: true; readonly state: string; readonly bg: number; readonly crons: number | null;
    readonly turnAt: number | null; readonly stopAt: number | null; readonly restartAt: number | null;
  }
  | { readonly ok: false; readonly reason: string };

/** The live reads, made only for a row every cheaper hold has passed. `unread` asks the sweep to make them. */
export type HibernateLive =
  | { readonly kind: 'unread' }
  | {
    readonly kind: 'read';
    /** `liveWordFor`'s answer, the RAW word; `no-pane`/`no-config-dir`/`unmeasured` when it gave none. */
    readonly word: { readonly ok: true; readonly word: string } | { readonly ok: false; readonly reason: (typeof HIBERNATE_LIVE_REASONS)[number] };
    readonly mark: HibernateMark;
  };

export interface HibernateInput {
  readonly row: HibernateRow;
  /** `$REG/<id>.no-hibernate` is listed. */
  readonly optedOut: boolean;
  readonly store: HibernateStoreRead;
  /** `Presence.isOpen` for this id. */
  readonly viewer: boolean;
  /** Milliseconds since the server started (presence is never persisted). */
  readonly sinceStartMs: number;
  readonly live: HibernateLive;
}

export type HibernateVerdict =
  | { readonly act: 'hibernate'; readonly idleMs: number }
  | { readonly act: 'measure' }
  | { readonly act: 'hold'; readonly reason: HibernateHold };

/**
 * Put this session to sleep? The holds run cheapest first and the live reads come last: `measure` asks the sweep to
 * read them for a row nothing else holds. Every read the verdict could not make HOLDS — never an unmeasured sleep.
 * `afterMs` is N; `idleMs` on a `hibernate` answer is how long ago the marker's clock last moved.
 */
export function hibernateVerdict(i: HibernateInput, now: number, afterMs: number): HibernateVerdict {
  const hold = (reason: HibernateHold): HibernateVerdict => ({ act: 'hold', reason });
  const r = i.row;
  if (r.archivedAt !== null || r.bucket === 'archived') return hold('archived');
  if (r.status === 'dead') return hold('pane');
  if (r.unmeasured.length > 0 || r.statusUnmeasured) return hold('unmeasured');
  if (i.optedOut) return hold('opted-out');
  if (r.held !== null) return hold('held');
  if (r.stranded !== null) return hold('stranded');
  if (r.swapBlocked !== null) return hold('swap-blocked');
  if (r.substrate !== null) return hold('substrate');
  const s = i.store;
  if (!s.ok) return hold('runs-unreadable');
  if (s.openWorker) return hold('run-worker');
  if (s.openClaimant) return hold('run-claimant');
  if (s.claim) return hold('claim');
  if (s.mail) return hold('mail');
  if (i.viewer || i.sinceStartMs < PRESENCE_OPEN_TTL_MS) return hold('viewer');
  if (r.dialogPending) return hold('menu');
  if (r.bucket !== 'idle') return hold('bucket');
  if (r.background !== null) return hold('background');
  if (r.subagents !== null && r.subagents.length > 0) return hold('roster');
  if (i.live.kind === 'unread') return { act: 'measure' };
  const w = i.live.word;
  if (!w.ok) return hold(w.reason === 'unmeasured' ? 'unmeasured' : 'pane');
  if (w.word !== 'idle') return hold('live-word');
  const m = i.live.mark;
  if (!m.ok || m.state !== 'done') return hold('marker');
  if (m.bg !== 0) return hold('marker-background');
  if (m.crons !== 0) return hold('scheduled');
  const stamps = [m.turnAt, m.stopAt, m.restartAt].filter((t): t is number => t !== null);
  if (stamps.length === 0) return hold('recent');
  const idleMs = now - Math.max(...stamps);
  if (idleMs <= afterMs) return hold('recent');
  return { act: 'hibernate', idleMs };
}
