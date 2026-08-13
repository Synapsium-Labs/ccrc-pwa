// Spec §4.3. The pure ladder, driven from the SAME fixture the bash twin is
// driven from (ccd-session-lifecycle.test.ts). Everything a single fixture row
// cannot state — "no surface changes the answer", "unmeasurable wins over
// everything" — is a separate case below, because a mutation that only shows up
// under a combination the table does not enumerate is exactly what a
// table-shaped test misses.
import { describe, it, expect } from 'vitest';
import {
  LIFECYCLE_FIELDS, SESSION_LIFECYCLES, SUPERVISED_FRESH_MS,
  isSessionLifecycle, isStopSurface, sessionLifecycle,
  type LifecycleInput, type SessionLifecycle, type StopSurface,
} from '../../shared/api.js';
import {
  FIXTURE_NOW_MS, LIFECYCLE_FIXTURE, lifecycleInputOf,
} from './sessionLifecycleFixture.js';

/** A row that classifies `running`, used as the base for the combination cases
 *  below — every one of them mutates ONE field, so the assertion is about that
 *  field and nothing else. */
const running: LifecycleInput = {
  alive: true, supervisedAt: FIXTURE_NOW_MS - 5_000, stoppedAt: null,
  stopSurface: null, started: true, unmeasured: [], nowMs: FIXTURE_NOW_MS,
};

describe('sessionLifecycle — the §4.3 table, driven from the fixture', () => {
  for (const row of LIFECYCLE_FIXTURE) {
    // Each row kills the mutant that collapses its rung into the one above it.
    it(row.name, () => {
      expect(sessionLifecycle(lifecycleInputOf(row))).toBe(row.expect);
    });
  }
});

describe('the fixture is complete, and its one exemption is the only one', () => {
  it('covers every SessionLifecycle member — a state with no row is a state nobody tests', () => {
    // Kills the mutant that deletes a rung: with a member uncovered, deleting
    // its branch would leave every remaining row green.
    const covered = new Set(LIFECYCLE_FIXTURE.map((r) => r.expect));
    expect([...covered].sort()).toEqual([...SESSION_LIFECYCLES].sort());
  });

  it('exempts the bash twin from exactly the unmeasurable rows, and from nothing else', () => {
    // Spec §4.3's own warning, made mechanical: "a fixture with an unexplained
    // exemption is how a second exemption gets added later." Biconditional, so
    // marking an inconvenient row server-only to make ccd green fails HERE.
    for (const row of LIFECYCLE_FIXTURE) {
      expect(row.serverOnly !== null, row.name).toBe(row.expect === 'unmeasurable');
      if (row.serverOnly !== null) expect(row.serverOnly.length, row.name).toBeGreaterThan(40);
    }
  });

  it('SESSION_LIFECYCLES is the whole union and nothing else', () => {
    // The runtime list is DERIVED from `Record<SessionLifecycle, true>` (the
    // PR_REASONS technique), so a member added to the type without a key here
    // is TS2739 rather than a list one short. This pins the runtime half.
    expect([...SESSION_LIFECYCLES].sort()).toEqual([
      'never-started', 'orphan', 'restarting', 'running', 'stopped', 'unmeasurable', 'unsupervised',
    ]);
  });

  it('LIFECYCLE_FIELDS names exactly the three REGISTRY fields the ladder reads', () => {
    // `alive` is deliberately absent: it comes from tmux, not from `$REG`, and
    // is taken as a plain boolean. A field in this list that the ladder does not
    // read would make an unrelated degraded read print `unmeasurable`.
    expect([...LIFECYCLE_FIELDS].sort()).toEqual(['started', 'stopped', 'supervised']);
  });

  it('SUPERVISED_FRESH_MS is the contract\'s 120 seconds, in ms', () => {
    expect(SUPERVISED_FRESH_MS).toBe(120_000);
  });
});

describe('sessionLifecycle — the rungs one fixture row cannot state', () => {
  it('no stop surface changes the answer — the ladder reads the STAMP, never who wrote it', () => {
    // Kills a mutant that special-cases one surface (e.g. treating `ccd` — the
    // ws-archive default — as "not really stopped", which would put every
    // archived workspace in the fleet back on the orphan rung).
    const surfaces: readonly StopSurface[] = ['cli', 'pwa', 'agent', 'ccd', 'unknown'];
    for (const s of surfaces) {
      expect(sessionLifecycle({
        ...running, alive: false, stoppedAt: FIXTURE_NOW_MS - 5_000, stopSurface: s,
      }), s).toBe('stopped');
    }
  });

  it('a stop with a null surface is still stopped — the epoch is the evidence', () => {
    expect(sessionLifecycle({
      ...running, alive: false, stoppedAt: FIXTURE_NOW_MS - 5_000, stopSurface: null,
    })).toBe('stopped');
  });

  it('a future-dated heartbeat is NOT fresh — it matches ccd\'s own >= 0 guard, not the reverse', () => {
    // DEVIATION FROM THE BRIEF (see task-8-report.md for the full reasoning):
    // the brief's draft asserted the opposite of this — that a future stamp
    // counts as fresh — and its own comment named the mutant it meant to kill
    // as "`>= 0 &&`", i.e. it wanted NO lower-bound guard at all. But ccd's
    // shipped `_session_state` (ccd/ccd) computes freshness as
    // `now - sup >= 0 && now - sup < 120`, and its own comment says the `>= 0`
    // half exists BECAUSE a future-dated stamp would otherwise read fresh
    // forever (`now - sup` goes negative and stays "< 120" as the gap only
    // grows). DISPATCH-CONTEXT §5's rule applies — where the brief and the
    // shipped tree disagree, the tree wins — so this ladder carries the same
    // guard bash does, and the test is corrected to match it rather than the
    // brief's draft.
    expect(sessionLifecycle({ ...running, supervisedAt: FIXTURE_NOW_MS + 60_000 })).toBe('unsupervised');
  });

  it('unmeasurable wins over every other rung, whatever else is true', () => {
    // Rule (b): an unreadable registry must NEVER be laundered into an
    // affirmative claim. Kills a mutant that moves the unmeasured check below
    // the alive check — which is precisely the shape that prints `orphan` for a
    // fleet host that dropped one agent-WS round trip.
    for (const row of LIFECYCLE_FIXTURE.filter((r) => r.serverOnly === null)) {
      expect(sessionLifecycle({ ...lifecycleInputOf(row), unmeasured: ['supervised'] }), row.name)
        .toBe('unmeasurable');
    }
  });

  it('an empty unmeasured list never yields unmeasurable', () => {
    // Kills `.some(...)` inverted to `.every(...)`, which answers true for [].
    expect(sessionLifecycle({ ...running, unmeasured: [] })).toBe('running');
  });

  it('every lifecycle field name, on its own, yields unmeasurable', () => {
    for (const f of LIFECYCLE_FIELDS) {
      expect(sessionLifecycle({ ...running, unmeasured: [f] }), f).toBe('unmeasurable');
    }
  });
});

describe('the validators are the only door onto the two vocabularies', () => {
  it('isSessionLifecycle accepts every member and rejects a stray token or a non-string', () => {
    for (const s of SESSION_LIFECYCLES) expect(isSessionLifecycle(s), s).toBe(true);
    expect(isSessionLifecycle('blocked')).toBe(false);
    expect(isSessionLifecycle('')).toBe(false);
    expect(isSessionLifecycle(null)).toBe(false);
    expect(isSessionLifecycle(3)).toBe(false);
  });

  it('isStopSurface accepts the closed set and rejects a word from the wire', () => {
    // §4.1: the surface is text from the wire being written into the registry —
    // ccd validates on write AND the server validates on read, because a
    // version-skewed ccd is the ordinary case on this box, not the exotic one.
    for (const s of ['cli', 'pwa', 'agent', 'ccd', 'unknown']) expect(isStopSurface(s), s).toBe(true);
    expect(isStopSurface('slack')).toBe(false);
    expect(isStopSurface('')).toBe(false);
    expect(isStopSurface(undefined)).toBe(false);
  });
});

// The lifecycle vocabulary must not have leaked into either union M10 names —
// a new `SessionStatus`/`SessionBucket` member CRASHES an already-deployed PWA
// (`DOT[status].cls` throws; `RANK[bucket]` is a NaN comparator). Task 9 pins
// the same claim behaviourally, through `sessionBucket`; this is the cheap
// structural half, here because this file is where the new words are defined.
describe('the new vocabulary is a FIELD, not a status or a bucket (M10)', () => {
  it('no SessionLifecycle member is also a SessionStatus or SessionBucket token', () => {
    const statuses = ['busy', 'idle', 'dead'];
    const buckets = ['attention', 'working', 'done', 'idle', 'cleanup', 'archived', 'dead'];
    for (const lc of SESSION_LIFECYCLES) {
      expect(statuses.includes(lc), lc).toBe(false);
      expect(buckets.includes(lc), lc).toBe(false);
    }
  });
});

// Compile-time half of the exhaustiveness claim: a member added to
// `SessionLifecycle` without a row here is TS2739 in the tests project
// (typecheck-tests.test.ts runs it), not a silently-short runtime list.
const _EXHAUSTIVE: Record<SessionLifecycle, true> = {
  running: true, unsupervised: true, stopped: true, restarting: true,
  orphan: true, 'never-started': true, unmeasurable: true,
};
void _EXHAUSTIVE;
