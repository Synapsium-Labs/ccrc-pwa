/**
 * The §4.3 classification table, as DATA — the single source of truth both the
 * TypeScript ladder (`session-lifecycle.test.ts`) and the bash twin
 * (`ccd-session-lifecycle.test.ts`) are driven against. Two hand-written lists
 * is exactly the drift the architecture doc's cross-language fixture-test idiom
 * exists to stop (`wrapper-roster-fixture.test.ts` is the same mechanism over
 * the account roster).
 *
 * Rows are stated in REGISTRY-NATIVE terms — a pane that is alive or not, plus
 * stamp AGES in whole seconds — because that is the one vocabulary both sides
 * can be built from: the TS side projects a row into a `LifecycleInput` via
 * `lifecycleInputOf`, the bash side plants `$REG/<id>.supervised`,
 * `$REG/<id>.stopped` and `$REG/<id>.started` and stubs `_alive`. Whole
 * seconds, never fractions, because ccd's stamps are `date +%s` and the two
 * implementations must agree at the 120-second boundary to the second.
 */
import type { LifecycleInput, SessionLifecycle, StopSurface } from '../../shared/api.js';

/** Fixed clock. Both suites pin it: the TS side passes it as `nowMs`, the bash
 *  side stubs `date +%s` with its seconds form, so the freshness boundary is an
 *  EXACT assertion on both sides instead of a wall-clock race that flakes one
 *  time in a thousand and gets marked skipped. */
export const FIXTURE_NOW_MS = 1_785_300_000_000;
export const FIXTURE_NOW_SEC = FIXTURE_NOW_MS / 1000;

/** The ONE exemption, said out loud (spec §4.3). Shared by every `unmeasurable`
 *  row rather than retyped, so a second exemption cannot be smuggled in wearing
 *  a vaguer sentence — and `session-lifecycle.test.ts` pins the biconditional
 *  (`serverOnly !== null` iff `expect === 'unmeasurable'`), so it cannot be
 *  smuggled in at all. */
export const SERVER_ONLY_UNMEASURABLE =
  'ccd reads $REG off local disk, where a read either works or the file is genuinely absent. '
  + '`unmeasurable` exists only on the SERVER side of the remote-io seam, where `readFile` '
  + 'collapses missing/forbidden/agent-disconnected into one null (remote/io.ts).';

export interface LifecycleFixtureRow {
  /** Doubles as the `it` title in both suites. */
  readonly name: string;
  readonly alive: boolean;
  /** Seconds since the supervisor heartbeat; null = no stamp on disk at all. */
  readonly supervisedAgoSec: number | null;
  /** Seconds since the stop stamp; null = no stamp on disk at all. */
  readonly stoppedAgoSec: number | null;
  readonly stopSurface: StopSurface | null;
  readonly started: boolean;
  /** Registry field names that were LISTED but unreadable this pass. */
  readonly unmeasured: readonly string[];
  readonly expect: SessionLifecycle;
  /** Why the bash twin cannot answer this row. Null = it must. */
  readonly serverOnly: string | null;
}

export const LIFECYCLE_FIXTURE: readonly LifecycleFixtureRow[] = [
  { name: 'alive with a fresh heartbeat is running',
    alive: true, supervisedAgoSec: 5, stoppedAgoSec: null, stopSurface: null,
    started: true, unmeasured: [], expect: 'running', serverOnly: null },

  { name: 'a heartbeat 119s old is still fresh — the boundary, from the inside',
    alive: true, supervisedAgoSec: 119, stoppedAgoSec: null, stopSurface: null,
    started: true, unmeasured: [], expect: 'running', serverOnly: null },

  { name: 'a heartbeat 120s old is stale — the boundary, from the outside',
    alive: true, supervisedAgoSec: 120, stoppedAgoSec: null, stopSurface: null,
    started: true, unmeasured: [], expect: 'unsupervised', serverOnly: null },

  { name: 'alive with a stale heartbeat is unsupervised — what a pre-fix `ccd start` minted',
    alive: true, supervisedAgoSec: 600, stoppedAgoSec: null, stopSurface: null,
    started: true, unmeasured: [], expect: 'unsupervised', serverOnly: null },

  { name: 'alive with no heartbeat at all is unsupervised',
    alive: true, supervisedAgoSec: null, stoppedAgoSec: null, stopSurface: null,
    started: true, unmeasured: [], expect: 'unsupervised', serverOnly: null },

  // §1.6, and the reason the shipped 24-combination sweep yields only SIX tokens:
  // NO existing row combines `alive: true` with `started: false`. That omission is
  // exactly why F8's shape — a live pane, a fresh heartbeat, no claim — classified
  // as `running` for two days on the live fleet.
  //
  // SUPERVISED, deliberately. `swift-harbor` was alive AND supervised AND
  // unclaimed, so this row is what proves `unclaimed` wins over `running`; an
  // `unclaimed` rung checked after the supervised split could never fire on the
  // specimen that motivated it.
  { name: 'a live pane nobody wrote a claim for is unclaimed, even freshly supervised',
    alive: true, supervisedAgoSec: 5, stoppedAgoSec: null, stopSurface: null,
    started: false, unmeasured: [], expect: 'unclaimed', serverOnly: null },

  // The other half of the same rung: it wins over `unsupervised` too. Without
  // this row a mutant that puts `unclaimed` between the two halves of the
  // supervised split still passes.
  { name: 'a live, unsupervised pane with no claim is unclaimed, not unsupervised',
    alive: true, supervisedAgoSec: null, stoppedAgoSec: null, stopSurface: null,
    started: false, unmeasured: [], expect: 'unclaimed', serverOnly: null },

  // Fix round 1 (task-8-report.md): this row and the "dead" one below are
  // what closes the reviewer's Important finding. A NEGATIVE age is a
  // future-dated stamp — clock skew, or a hand-edited registry — and the
  // ladder's `>= 0` guard is what stops it reading fresh forever (see
  // `sessionLifecycle`'s own docstring in shared/api.ts). Before this round
  // the divergence this task discovered (ccd's shipped guard vs. the brief's
  // draft) was pinned only in the TS-only "rungs one fixture row cannot
  // state" describe and in the OLDER ccd-session-state.test.ts — never in
  // THIS shared table, so a bash-side regression of the guard was invisible
  // to the fixture that is supposed to be the single source of truth.
  { name: 'alive with a future-dated heartbeat is unsupervised — clock skew must not read as fresh forever',
    alive: true, supervisedAgoSec: -60, stoppedAgoSec: null, stopSurface: null,
    started: true, unmeasured: [], expect: 'unsupervised', serverOnly: null },

  { name: 'a stop stamp on a dead row is stopped, and the row says who and when',
    alive: false, supervisedAgoSec: null, stoppedAgoSec: 90, stopSurface: 'pwa',
    started: true, unmeasured: [], expect: 'stopped', serverOnly: null },

  { name: 'a stop taken INSIDE the freshness window still reads stopped — the stamp is checked before the heartbeat',
    alive: false, supervisedAgoSec: 5, stoppedAgoSec: 5, stopSurface: 'agent',
    started: true, unmeasured: [], expect: 'stopped', serverOnly: null },

  { name: 'dead, unstopped, freshly heartbeat is restarting — between Restart=always cycles, not a fault',
    alive: false, supervisedAgoSec: 5, stoppedAgoSec: null, stopSurface: null,
    started: true, unmeasured: [], expect: 'restarting', serverOnly: null },

  { name: 'dead, unstopped, stale heartbeat, started is orphan',
    alive: false, supervisedAgoSec: 600, stoppedAgoSec: null, stopSurface: null,
    started: true, unmeasured: [], expect: 'orphan', serverOnly: null },

  { name: 'dead, unstopped, no heartbeat at all, started is orphan',
    alive: false, supervisedAgoSec: null, stoppedAgoSec: null, stopSurface: null,
    started: true, unmeasured: [], expect: 'orphan', serverOnly: null },

  // The freshness boolean feeds BOTH the alive branch above and this dead
  // branch — the SAME `>= 0` guard, one computation, per `sessionLifecycle`'s
  // ladder and ccd's own `fresh=` assignment. Pinning only the alive-branch
  // row would leave a mutant that special-cases the guard to one branch (e.g.
  // moving `>= 0` inside `if (alive)` only) undetected; this row closes that.
  { name: 'dead, unstopped, with a future-dated heartbeat is orphan, not restarting — the same >= 0 guard',
    alive: false, supervisedAgoSec: -60, stoppedAgoSec: null, stopSurface: null,
    started: true, unmeasured: [], expect: 'orphan', serverOnly: null },

  { name: 'dead, unstopped, no heartbeat, never started is never-started',
    alive: false, supervisedAgoSec: null, stoppedAgoSec: null, stopSurface: null,
    started: false, unmeasured: [], expect: 'never-started', serverOnly: null },

  { name: 'a stale heartbeat does not promote a never-started row to orphan',
    alive: false, supervisedAgoSec: 600, stoppedAgoSec: null, stopSurface: null,
    started: false, unmeasured: [], expect: 'never-started', serverOnly: null },

  { name: 'an unmeasured field OUTSIDE the lifecycle set changes nothing',
    alive: true, supervisedAgoSec: 5, stoppedAgoSec: null, stopSurface: null,
    started: true, unmeasured: ['branch'], expect: 'running', serverOnly: null },

  { name: 'an unreadable supervised stamp is unmeasurable, never orphan',
    alive: false, supervisedAgoSec: null, stoppedAgoSec: null, stopSurface: null,
    started: true, unmeasured: ['supervised'], expect: 'unmeasurable',
    serverOnly: SERVER_ONLY_UNMEASURABLE },

  { name: 'an unreadable stop stamp is unmeasurable even for a plainly-alive, plainly-supervised pane',
    alive: true, supervisedAgoSec: 5, stoppedAgoSec: null, stopSurface: null,
    started: true, unmeasured: ['stopped'], expect: 'unmeasurable',
    serverOnly: SERVER_ONLY_UNMEASURABLE },

  { name: 'an unreadable started flag is unmeasurable, never never-started',
    alive: false, supervisedAgoSec: null, stoppedAgoSec: null, stopSurface: null,
    started: false, unmeasured: ['started'], expect: 'unmeasurable',
    serverOnly: SERVER_ONLY_UNMEASURABLE },
];

/** One fixture row → the classifier's own input shape. Ages become absolute
 *  epoch-MS stamps against the fixed clock; nothing else is derived. */
export function lifecycleInputOf(
  row: LifecycleFixtureRow,
  nowMs: number = FIXTURE_NOW_MS,
): LifecycleInput {
  return {
    alive: row.alive,
    supervisedAt: row.supervisedAgoSec === null ? null : nowMs - row.supervisedAgoSec * 1000,
    stoppedAt: row.stoppedAgoSec === null ? null : nowMs - row.stoppedAgoSec * 1000,
    stopSurface: row.stopSurface,
    started: row.started,
    unmeasured: row.unmeasured,
    nowMs,
  };
}
