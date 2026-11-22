// The automatic roll's verdict (D-7443, D-7452, D-7454; D-8276, the operator's ruling of 2026-11-10 that reverses the
// 2026-10-29 coordinators-only rule): an idle session whose pane started before the node's current ccrc install, or
// that runs an older Claude Code build than the newest the fleet runs, is rolled once it has been quiet for 90 minutes,
// whatever its role under the default `all`; under `coordinators` a non-coordinator is never rolled; a busy, compacting
// or opted-out session, or one hibernation will take within 30 minutes, is skipped by name; the setting off rolls
// nothing. Pure: no fixture HOME, no process, no network.
import { describe, expect, it } from 'vitest';
import * as rollTargetModule from '../src/coord/rollTarget.js';
import { rollHandoffCases } from './sim/handoffSets.js';
import { VIEWER_OPEN_TTL_MS, type ChildMark } from '../../shared/api.js';
import { sessionRoleOf } from '../src/roleOf.js';
import { CLAUDE_ROLL_TARGETS, CLAUDE_ROLL_TARGETS_DEFAULT, isClaudeRollTargets } from '../../shared/claudeVersion.js';
import {
  AUTO_ROLL_SKIPS, ROLL_COMPACT_QUIET_MS, ROLL_HIBERNATION_LEAD_MS, ROLL_QUIET_MS, autoRollVerdict, longLivedOf, modelCandidateOf,
  modelFactOf, rollTargetsOf, rollTargetVerdict, type AutoRollInput,
} from '../src/coord/rollTarget.js';
import { CLASSES, type LaneClassAdvance, type LaneClassModel, type LaneModelsRead, type ModelClass } from '../../shared/models.js';
import type { FleetSession } from '../../shared/api.js';
import { HIBERNATE_AFTER_MS_DEFAULT, hibernateVerdict, type HibernateInput, type HibernateMark } from '../src/coord/hibernate.js';

const NONE: ChildMark = { kind: 'none' };
const CHILD: ChildMark = { kind: 'child', runId: 7 };
const UNREADABLE: ChildMark = { kind: 'unreadable' };

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
/** The node's current ccrc install completed two hours ago; the coordinator's pane started three hours ago. */
const INSTALLED = NOW - 2 * HOUR;
const PANE_START = NOW - 3 * HOUR;

const mark = (ageMs: number, o: Partial<HibernateMark> = {}): HibernateMark =>
  ({ ok: true, state: 'done', bg: 0, crons: 0, turnAt: NOW - ageMs - MIN, stopAt: NOW - ageMs, restartAt: null, ...o }) as HibernateMark;

const sleep = (ageMs: number, o: { word?: string; mark?: HibernateMark; unread?: boolean; viewer?: boolean; store?: HibernateInput['store'] } = {}): HibernateInput => ({
  row: {
    id: 'project-a', status: 'idle', archivedAt: null, bucket: 'idle', held: null, unmeasured: [], statusUnmeasured: false,
    dialogPending: false, background: null, subagents: null, stranded: null, swapBlocked: null, substrate: null,
  },
  overlord: false,
  optedOut: false,
  store: o.store ?? { ok: true, openWorker: false, openClaimant: false, claim: false, mail: false },
  viewer: o.viewer ?? false,
  sinceStartMs: VIEWER_OPEN_TTL_MS + HOUR,
  live: o.unread ? { kind: 'unread' } : { kind: 'read', word: { ok: true, word: o.word ?? 'idle' }, mark: o.mark ?? mark(ageMs) },
});

/** An idle coordinator, behind on release, quiet for `ageMs`, hibernation unarmed, its build unmeasured. */
const input = (ageMs: number, o: Partial<AutoRollInput> = {}): AutoRollInput => ({
  targets: CLAUDE_ROLL_TARGETS_DEFAULT,
  role: 'coordinator',
  longLived: false,
  continuityLive: false,
  overlord: false,
  release: INSTALLED,
  startedAt: PANE_START,
  build: { kind: 'unmeasured' },
  rolledFor: null,
  model: { kind: 'none' },
  rolledModelFor: null,
  optedOut: { roll: false, hibernate: false },
  hibernation: { armed: false, afterMs: HIBERNATE_AFTER_MS_DEFAULT },
  statusUpdatedAt: NOW - ageMs,
  sleep: sleep(ageMs),
  now: NOW,
  ...o,
});

describe('the setting (D-7453; D-8276)', () => {
  it('the default is all (D-8276), and the row offers every idle session, coordinators only, or off', () => {
    expect(CLAUDE_ROLL_TARGETS_DEFAULT).toBe('all');
    expect([...CLAUDE_ROLL_TARGETS]).toEqual(['all', 'coordinators', 'off']);
    expect(isClaudeRollTargets('all')).toBe(true);
    expect(isClaudeRollTargets('children')).toBe(false);
  });

  it('a stored row is read through the one narrowing; a lost row is the default; anything else rolls nothing', () => {
    expect(rollTargetsOf({ kind: 'row', targets: 'off', seeded: false })).toBe('off');
    expect(rollTargetsOf({ kind: 'row', targets: 'coordinators', seeded: false })).toBe('coordinators');
    expect(rollTargetsOf({ kind: 'row', targets: 'all', seeded: false })).toBe('all');
    expect(rollTargetsOf({ kind: 'absent' })).toBe('all');
    expect(rollTargetsOf({ kind: 'row', targets: 'children', seeded: false })).toBeNull();
    expect(rollTargetsOf({ kind: 'unreadable', detail: 'locked' })).toBeNull();
  });

  it('D-8276: the migration\'s seed, never written by an operator, reads as today\'s default, not as the 10-29 rule', () => {
    expect(rollTargetsOf({ kind: 'row', targets: 'coordinators', seeded: true })).toBe('all');
    expect(rollTargetsOf({ kind: 'row', targets: 'off', seeded: true }), 'any seeded word is the default').toBe('all');
  });

  it('off rolls nothing, and reads nothing first', () => {
    expect(autoRollVerdict(input(2 * HOUR, { targets: 'off' }))).toEqual({ act: 'skip', reason: 'setting-off' });
    expect(autoRollVerdict(input(2 * HOUR, { targets: 'off', sleep: sleep(2 * HOUR, { unread: true }) })))
      .toEqual({ act: 'skip', reason: 'setting-off' });
  });

  it('a setting that could not be read rolls nothing', () => {
    expect(autoRollVerdict(input(2 * HOUR, { targets: null }))).toEqual({ act: 'skip', reason: 'setting-unreadable' });
  });
});

describe('the Overlord hold and the unread designation (Overlord W1 designation A, Task 3)', () => {
  it('a bound or pending body is skipped overlord, right after the setting checks, whatever its idle state', () => {
    expect(autoRollVerdict(input(2 * HOUR, { overlord: true }))).toEqual({ act: 'skip', reason: 'overlord' });
    expect(autoRollVerdict(input(2 * HOUR, { overlord: true, sleep: sleep(2 * HOUR, { unread: true }) }))).toEqual({ act: 'skip', reason: 'overlord' });
    expect(autoRollVerdict(input(2 * HOUR, { overlord: true, targets: 'off' }))).toEqual({ act: 'skip', reason: 'setting-off' });
    expect(autoRollVerdict(input(2 * HOUR, { overlord: true, release: null }))).toEqual({ act: 'skip', reason: 'overlord' });
  });

  it('an unmeasured designation skips every row designation-unreadable, and is not the Overlord skip', () => {
    expect(autoRollVerdict(input(2 * HOUR, { overlord: 'unmeasured' }))).toEqual({ act: 'skip', reason: 'designation-unreadable' });
    expect(autoRollVerdict(input(2 * HOUR, { overlord: 'unmeasured', role: 'child' }))).toEqual({ act: 'skip', reason: 'designation-unreadable' });
  });

  it('any other row is rolled as before', () => {
    expect(autoRollVerdict(input(ROLL_QUIET_MS + MIN, { overlord: false }))).toEqual({ act: 'roll', idleMs: ROLL_QUIET_MS + MIN });
  });

  it('the idle gate of an ordinary session never reads unmeasured: its sleep input carries a real overlord value', () => {
    expect(autoRollVerdict(input(2 * HOUR, { sleep: { ...sleep(2 * HOUR), overlord: false } }))).toEqual({ act: 'roll', idleMs: 2 * HOUR });
    expect(autoRollVerdict(input(2 * HOUR, { sleep: { ...sleep(2 * HOUR), overlord: null } }))).toEqual({ act: 'skip', reason: 'idle-gate', hold: 'unmeasured' });
  });

  it('the words are in the skip list', () => {
    expect(AUTO_ROLL_SKIPS).toEqual(expect.arrayContaining(['overlord', 'designation-unreadable']));
  });
});

describe('the role (D-8276): every idle session under all, coordinators only under coordinators', () => {
  it('under the default, an idle child is rolled like a coordinator, and so is an unreadable .child or an unknown role', () => {
    expect(autoRollVerdict(input(ROLL_QUIET_MS + MIN, { role: sessionRoleOf(CHILD) }))).toEqual({ act: 'roll', idleMs: ROLL_QUIET_MS + MIN });
    expect(autoRollVerdict(input(ROLL_QUIET_MS + MIN, { role: sessionRoleOf(UNREADABLE) })).act).toBe('roll');
    expect(autoRollVerdict(input(ROLL_QUIET_MS + MIN, { role: null })).act).toBe('roll');
  });

  it('under the default, a busy child is never rolled, and a child with .no-roll is skipped by name', () => {
    expect(autoRollVerdict(input(2 * HOUR, { role: 'child', sleep: sleep(2 * HOUR, { word: 'busy' }) })))
      .toEqual({ act: 'skip', reason: 'idle-gate', hold: 'live-word' });
    expect(autoRollVerdict(input(2 * HOUR, { role: 'child', optedOut: { roll: true, hibernate: false } })))
      .toEqual({ act: 'skip', reason: 'no-roll' });
  });

  it('under the default, a child an open run names as worker is still held (the idle gate\'s run-worker hold)', () => {
    const store = { ok: true as const, openWorker: true, openClaimant: false, claim: false, mail: false };
    expect(autoRollVerdict(input(2 * HOUR, { role: 'child', sleep: sleep(2 * HOUR, { store }) })))
      .toEqual({ act: 'skip', reason: 'idle-gate', hold: 'run-worker' });
  });

  it('an idle coordinator behind on release is rolled after 90 minutes', () => {
    expect(autoRollVerdict(input(ROLL_QUIET_MS + MIN))).toEqual({ act: 'roll', idleMs: ROLL_QUIET_MS + MIN });
    expect(autoRollVerdict(input(ROLL_QUIET_MS + MIN, { role: sessionRoleOf(NONE) })).act).toBe('roll');
  });

  it('the quiet window is 90 minutes (U2) and the hibernation lead 30: an 89-minute quiet holds, a 91-minute one rolls', () => {
    expect([ROLL_QUIET_MS, ROLL_HIBERNATION_LEAD_MS, ROLL_COMPACT_QUIET_MS]).toEqual([90 * MIN, 30 * MIN, 10 * MIN]);
    expect(autoRollVerdict(input(89 * MIN)).act).toBe('skip');
    expect(autoRollVerdict(input(91 * MIN)).act).toBe('roll');
  });

  it('before 90 minutes of quiet it is not', () => {
    expect(autoRollVerdict(input(ROLL_QUIET_MS - MIN))).toEqual({ act: 'skip', reason: 'idle-gate', hold: 'recent' });
  });

  it('under coordinators, an idle child is never rolled, however long it idles and however far behind', () => {
    expect(autoRollVerdict(input(30 * HOUR, { targets: 'coordinators', role: sessionRoleOf(CHILD) })))
      .toEqual({ act: 'skip', reason: 'not-coordinator' });
  });

  it('under coordinators, an unreadable .child counts as a child', () => {
    expect(sessionRoleOf(UNREADABLE)).toBe('child');
    expect(autoRollVerdict(input(30 * HOUR, { targets: 'coordinators', role: sessionRoleOf(UNREADABLE) })))
      .toEqual({ act: 'skip', reason: 'not-coordinator' });
  });

  it('under coordinators, a row whose role is unknown is never rolled', () => {
    expect(autoRollVerdict(input(30 * HOUR, { targets: 'coordinators', role: null }))).toEqual({ act: 'skip', reason: 'role-unknown' });
  });

  it('under coordinators, the role is tested before anything is measured: a child is never measured', () => {
    expect(autoRollVerdict(input(2 * HOUR, { targets: 'coordinators', role: 'child', sleep: sleep(2 * HOUR, { unread: true }) })))
      .toEqual({ act: 'skip', reason: 'not-coordinator' });
    expect(autoRollVerdict(input(2 * HOUR, { sleep: sleep(2 * HOUR, { unread: true }) }))).toEqual({ act: 'measure' });
    expect(autoRollVerdict(input(2 * HOUR, { role: 'child', sleep: sleep(2 * HOUR, { unread: true }) })), 'under all, a child is measured')
      .toEqual({ act: 'measure' });
  });

  it('rollTargetVerdict is the filter: setting first, then the role, which only coordinators reads', () => {
    expect(rollTargetVerdict('coordinators', 'coordinator', false, false)).toEqual({ take: true });
    expect(rollTargetVerdict('off', 'coordinator', false, false)).toEqual({ take: false, skip: 'setting-off' });
    expect(rollTargetVerdict('coordinators', 'child', false, false)).toEqual({ take: false, skip: 'not-coordinator' });
    expect(rollTargetVerdict('coordinators', null, false, false)).toEqual({ take: false, skip: 'role-unknown' });
    expect(rollTargetVerdict('all', 'coordinator', false, false)).toEqual({ take: true });
    expect(rollTargetVerdict('all', 'child', false, false)).toEqual({ take: true });
    expect(rollTargetVerdict('all', null, false, false)).toEqual({ take: true });
    expect(rollTargetVerdict('off', 'child', false, false)).toEqual({ take: false, skip: 'setting-off' });
  });
});

describe('the hand-off to the renewal lane (Overlord W1a, the renewal hand-offs, Task 5; spec §3.3.8)', () => {
  // The decider's cases live once in `sim/handoffSets.ts` (its mutation floor runs them against each mutant).
  for (const [name, run] of Object.entries(rollHandoffCases(rollTargetModule))) it(name, run);

  it('autoRollVerdict carries it: an idle coordinator behind on release is renewal-owns while live, and rolled while shadow', () => {
    expect(autoRollVerdict(input(2 * HOUR, { longLived: true, continuityLive: true }))).toEqual({ act: 'skip', reason: 'renewal-owns' });
    expect(autoRollVerdict(input(2 * HOUR, { longLived: true, continuityLive: false }))).toEqual({ act: 'roll', idleMs: 2 * HOUR });
    expect(autoRollVerdict(input(2 * HOUR, { role: 'coordinator', longLived: false, continuityLive: true }))).toEqual({ act: 'roll', idleMs: 2 * HOUR });
    // Before anything is measured: the hand-off is decided on the frame's facts alone.
    expect(autoRollVerdict(input(2 * HOUR, { longLived: true, continuityLive: true, sleep: sleep(2 * HOUR, { unread: true }) })))
      .toEqual({ act: 'skip', reason: 'renewal-owns' });
  });

  it('longLivedOf: a decided role by its column; agreeing ambiguities decide; coordinator-or-plain reads the live generation', () => {
    expect(longLivedOf({ kind: 'role', role: 'coordinator' }, false)).toBe(true);
    expect(longLivedOf({ kind: 'role', role: 'overlord' }, 'unmeasured')).toBe(true);
    expect(longLivedOf({ kind: 'role', role: 'worker' }, false)).toBe(false);
    expect(longLivedOf({ kind: 'role', role: 'plain' }, false)).toBe(false);
    expect(longLivedOf({ kind: 'undecided', between: 'worker-or-reviewer' }, 'unmeasured')).toBe(false);
    expect(longLivedOf({ kind: 'undecided', between: 'coordinator-or-plain' }, true)).toBe(true);
    expect(longLivedOf({ kind: 'undecided', between: 'coordinator-or-plain' }, false)).toBe(false);
    expect(longLivedOf({ kind: 'undecided', between: 'coordinator-or-plain' }, 'unmeasured')).toBeNull();
  });
});

describe('behind on release (D-7454)', () => {
  it('a pane that started after the node\'s current install is current, not a skip', () => {
    expect(autoRollVerdict(input(2 * HOUR, { startedAt: INSTALLED + MIN }))).toEqual({ act: 'current' });
    expect(autoRollVerdict(input(2 * HOUR, { startedAt: INSTALLED }))).toEqual({ act: 'current' });
  });

  it('an install time or a pane start that could not be measured rolls nothing', () => {
    expect(autoRollVerdict(input(2 * HOUR, { release: null }))).toEqual({ act: 'skip', reason: 'release-unmeasured' });
    expect(autoRollVerdict(input(2 * HOUR, { startedAt: null }))).toEqual({ act: 'skip', reason: 'start-unmeasured' });
  });
});

describe('behind on the Claude Code build (D-8276)', () => {
  const after = INSTALLED + MIN;
  const behind = { kind: 'behind', build: '2.1.296', latest: '2.1.302', reach: '2.1.302' } as const;

  it('a pane on the current release but an older build than its lane reaches is rolled', () => {
    expect(autoRollVerdict(input(2 * HOUR, { startedAt: after, build: behind }))).toEqual({ act: 'roll', idleMs: 2 * HOUR });
    expect(autoRollVerdict(input(2 * HOUR, { startedAt: after, role: 'child', build: behind })).act, 'whatever its role').toBe('roll');
    expect(autoRollVerdict(input(2 * HOUR, { startedAt: after, build: { ...behind, reach: '2.1.300' } })).act, 'its lane reaches only .300')
      .toBe('roll');
  });

  it('a pane behind the fleet\'s newest that a restart cannot move (its lane runs nothing newer) is not rolled for it', () => {
    // Binary-lifecycle spec §2.2: the launcher picks the lane's own recorded build first, so a restart keeps the pane
    // on it until that lane's updater writes a newer one. Restarting it would cost memory and reach nothing.
    const held = { ...behind, reach: null };
    expect(autoRollVerdict(input(2 * HOUR, { startedAt: after, build: held }))).toEqual({ act: 'current' });
    expect(autoRollVerdict(input(2 * HOUR, { startedAt: after, role: 'child', build: held }))).toEqual({ act: 'current' });
    expect(autoRollVerdict(input(2 * HOUR, { build: held })).act, 'behind on release, it still rolls for the release').toBe('roll');
  });

  it('a pane on the newest build, an unmeasured build or an asleep row is current when the release is', () => {
    expect(autoRollVerdict(input(2 * HOUR, { startedAt: after, build: { kind: 'current', build: '2.1.302' } }))).toEqual({ act: 'current' });
    expect(autoRollVerdict(input(2 * HOUR, { startedAt: after, build: { kind: 'unmeasured' } }))).toEqual({ act: 'current' });
    expect(autoRollVerdict(input(2 * HOUR, { startedAt: after, build: { kind: 'asleep' } }))).toEqual({ act: 'current' });
  });

  it('a session already rolled for the build its lane reaches is not rolled for it again (its restart did not reach it)', () => {
    expect(autoRollVerdict(input(2 * HOUR, { startedAt: after, build: behind, rolledFor: '2.1.302' }))).toEqual({ act: 'current' });
    expect(autoRollVerdict(input(2 * HOUR, { startedAt: after, build: behind, rolledFor: '2.1.300' })).act, 'a newer build asks again').toBe('roll');
    expect(autoRollVerdict(input(2 * HOUR, { startedAt: after, build: { ...behind, reach: '2.1.300' }, rolledFor: '2.1.300' })),
      'the guard keys on the lane\'s reach, not the fleet\'s newest').toEqual({ act: 'current' });
    expect(autoRollVerdict(input(2 * HOUR, { build: behind, rolledFor: '2.1.302' })).act, 'the release still rolls it').toBe('roll');
  });

  it('a build-behind session keeps every hold: busy, .no-roll, under coordinators a child, the setting off', () => {
    expect(autoRollVerdict(input(2 * HOUR, { startedAt: after, build: behind, sleep: sleep(2 * HOUR, { word: 'busy' }) })))
      .toEqual({ act: 'skip', reason: 'idle-gate', hold: 'live-word' });
    expect(autoRollVerdict(input(2 * HOUR, { startedAt: after, build: behind, optedOut: { roll: true, hibernate: false } })))
      .toEqual({ act: 'skip', reason: 'no-roll' });
    expect(autoRollVerdict(input(2 * HOUR, { startedAt: after, build: behind, targets: 'coordinators', role: 'child' })))
      .toEqual({ act: 'skip', reason: 'not-coordinator' });
    expect(autoRollVerdict(input(2 * HOUR, { startedAt: after, build: behind, targets: 'off' }))).toEqual({ act: 'skip', reason: 'setting-off' });
  });
});

describe('never while busy, drafting or compacting', () => {
  it('a busy coordinator is not rolled', () => {
    expect(autoRollVerdict(input(2 * HOUR, { sleep: sleep(2 * HOUR, { word: 'busy' }) })))
      .toEqual({ act: 'skip', reason: 'idle-gate', hold: 'live-word' });
  });

  it('a coordinator whose last Stop left background work or a cron is not rolled', () => {
    expect(autoRollVerdict(input(2 * HOUR, { sleep: sleep(2 * HOUR, { mark: mark(2 * HOUR, { bg: 1 }) }) })))
      .toEqual({ act: 'skip', reason: 'idle-gate', hold: 'marker-background' });
    expect(autoRollVerdict(input(2 * HOUR, { sleep: sleep(2 * HOUR, { mark: mark(2 * HOUR, { crons: 1 }) }) })))
      .toEqual({ act: 'skip', reason: 'idle-gate', hold: 'scheduled' });
  });

  it('a coordinator somebody has open is not rolled', () => {
    expect(autoRollVerdict(input(2 * HOUR, { sleep: sleep(2 * HOUR, { viewer: true }) })))
      .toEqual({ act: 'skip', reason: 'idle-gate', hold: 'viewer' });
  });

  it('a compacting coordinator (its live status moved within 10 minutes) is not rolled', () => {
    expect(autoRollVerdict(input(2 * HOUR, { statusUpdatedAt: NOW - ROLL_COMPACT_QUIET_MS + MIN })))
      .toEqual({ act: 'skip', reason: 'compacting' });
    expect(autoRollVerdict(input(2 * HOUR, { statusUpdatedAt: NOW - ROLL_COMPACT_QUIET_MS })).act).toBe('roll');
  });

  it('a status time that could not be read holds', () => {
    expect(autoRollVerdict(input(2 * HOUR, { statusUpdatedAt: null }))).toEqual({ act: 'skip', reason: 'compacting' });
  });
});

describe('opt-outs (U4)', () => {
  it('.no-roll opts a coordinator out', () => {
    expect(autoRollVerdict(input(2 * HOUR, { optedOut: { roll: true, hibernate: false } }))).toEqual({ act: 'skip', reason: 'no-roll' });
  });

  it('.no-hibernate does NOT opt it out of the roll: the act, ccd hibernate --roll, refuses only .no-roll (D-7458)', () => {
    expect(autoRollVerdict(input(2 * HOUR, { optedOut: { roll: false, hibernate: true } })).act).toBe('roll');
  });

  it('.no-hibernate means hibernation never takes it, so hibernation-due never holds it (D-7458)', () => {
    const armed = { armed: true, afterMs: HIBERNATE_AFTER_MS_DEFAULT };
    const age = HIBERNATE_AFTER_MS_DEFAULT - ROLL_HIBERNATION_LEAD_MS + MIN;
    expect(autoRollVerdict(input(age, { hibernation: armed })).act, 'control: due without the opt-out').toBe('skip');
    expect(autoRollVerdict(input(age, { hibernation: armed, optedOut: { roll: false, hibernate: true } })).act).toBe('roll');
  });
});

describe('hibernation counts as the roll', () => {
  const armed = { armed: true, afterMs: HIBERNATE_AFTER_MS_DEFAULT };

  it('a coordinator hibernation will take within 30 minutes is not rolled', () => {
    const age = HIBERNATE_AFTER_MS_DEFAULT - ROLL_HIBERNATION_LEAD_MS + MIN;
    expect(autoRollVerdict(input(age, { hibernation: armed }))).toEqual({ act: 'skip', reason: 'hibernation-due' });
    expect(autoRollVerdict(input(HIBERNATE_AFTER_MS_DEFAULT - ROLL_HIBERNATION_LEAD_MS, { hibernation: armed })))
      .toEqual({ act: 'skip', reason: 'hibernation-due' });
  });

  it('one hibernation will take later than that is rolled', () => {
    const age = HIBERNATE_AFTER_MS_DEFAULT - ROLL_HIBERNATION_LEAD_MS - MIN;
    expect(autoRollVerdict(input(age, { hibernation: armed })).act).toBe('roll');
  });

  it('while hibernation is not armed, nothing is due, so a long-idle coordinator is rolled', () => {
    expect(autoRollVerdict(input(HIBERNATE_AFTER_MS_DEFAULT + HOUR)).act).toBe('roll');
  });
});

describe('claimed runs and claims do not hold a roll (D-7562)', () => {
  // The operator's ruling of 2026-10-30: every live coordinator claims at least one open run (stale planned runs count),
  // so the shared idle gate's `run-claimant` and `claim` holds kept every coordinator from ever rolling. A roll comes
  // straight back as the same session, and its runs and claims stay in the coordination store, so for the roll ONLY
  // they do not hold; every other hold still does.
  const claims = (o: Partial<{ openWorker: boolean; openClaimant: boolean; claim: boolean; mail: boolean }> = {}): HibernateInput['store'] =>
    ({ ok: true, openWorker: false, openClaimant: true, claim: true, mail: false, ...o });
  const past = ROLL_QUIET_MS + MIN;

  it('a coordinator idle past 90 minutes that claims open runs (planned ones included) is rolled', () => {
    expect(autoRollVerdict(input(past, { sleep: sleep(past, { store: claims({ claim: false }) }) })))
      .toEqual({ act: 'roll', idleMs: past });
  });

  it('a coordinator holding a live claim is rolled', () => {
    expect(autoRollVerdict(input(past, { sleep: sleep(past, { store: claims({ openClaimant: false }) }) })))
      .toEqual({ act: 'roll', idleMs: past });
  });

  it('a coordinator that claims a dispatched run and holds a claim (its child works it) is rolled', () => {
    expect(autoRollVerdict(input(past, { sleep: sleep(past, { store: claims() }) }))).toEqual({ act: 'roll', idleMs: past });
  });

  it('with claims, a busy coordinator, one somebody has open, or one not yet quiet for 90 minutes is still not rolled', () => {
    expect(autoRollVerdict(input(past, { sleep: sleep(past, { store: claims(), word: 'busy' }) })))
      .toEqual({ act: 'skip', reason: 'idle-gate', hold: 'live-word' });
    expect(autoRollVerdict(input(past, { sleep: sleep(past, { store: claims(), viewer: true }) })))
      .toEqual({ act: 'skip', reason: 'idle-gate', hold: 'viewer' });
    expect(autoRollVerdict(input(ROLL_QUIET_MS - MIN, { sleep: sleep(ROLL_QUIET_MS - MIN, { store: claims() }) })))
      .toEqual({ act: 'skip', reason: 'idle-gate', hold: 'recent' });
  });

  it('with claims, a hold, an open run naming it as worker, outstanding mail or an unreadable store still holds', () => {
    const held = { ...sleep(past, { store: claims() }), row: { ...sleep(past).row, held: 'program mid-flight' } };
    expect(autoRollVerdict(input(past, { sleep: held }))).toEqual({ act: 'skip', reason: 'idle-gate', hold: 'held' });
    expect(autoRollVerdict(input(past, { sleep: sleep(past, { store: claims({ openWorker: true }) }) })))
      .toEqual({ act: 'skip', reason: 'idle-gate', hold: 'run-worker' });
    expect(autoRollVerdict(input(past, { sleep: sleep(past, { store: claims({ mail: true }) }) })))
      .toEqual({ act: 'skip', reason: 'idle-gate', hold: 'mail' });
    expect(autoRollVerdict(input(past, { sleep: sleep(past, { store: { ok: false, detail: 'locked' } }) })))
      .toEqual({ act: 'skip', reason: 'idle-gate', hold: 'runs-unreadable' });
  });

  it('with claims, .no-roll still opts it out, and under coordinators a non-coordinator is still never rolled', () => {
    expect(autoRollVerdict(input(past, { optedOut: { roll: true, hibernate: false }, sleep: sleep(past, { store: claims() }) })))
      .toEqual({ act: 'skip', reason: 'no-roll' });
    expect(autoRollVerdict(input(30 * HOUR, { targets: 'coordinators', role: sessionRoleOf(CHILD), sleep: sleep(30 * HOUR, { store: claims() }) })))
      .toEqual({ act: 'skip', reason: 'not-coordinator' });
  });

  it('hibernation never takes a claimant, so hibernation-due never holds one: it is rolled', () => {
    const armed = { armed: true, afterMs: HIBERNATE_AFTER_MS_DEFAULT };
    const age = HIBERNATE_AFTER_MS_DEFAULT - ROLL_HIBERNATION_LEAD_MS + MIN;
    expect(autoRollVerdict(input(age, { hibernation: armed })), 'control: due with no claims').toEqual({ act: 'skip', reason: 'hibernation-due' });
    expect(autoRollVerdict(input(age, { hibernation: armed, sleep: sleep(age, { store: claims() }) }))).toEqual({ act: 'roll', idleMs: age });
  });

  it('hibernation keeps its run gate (pin): its verdict still holds a run claimant and a claim', () => {
    const at = (store: HibernateInput['store']) => hibernateVerdict(sleep(HIBERNATE_AFTER_MS_DEFAULT + HOUR, { store }), NOW, HIBERNATE_AFTER_MS_DEFAULT);
    expect(at(claims({ claim: false }))).toEqual({ act: 'hold', reason: 'run-claimant' });
    expect(at(claims({ openClaimant: false }))).toEqual({ act: 'hold', reason: 'claim' });
    expect(at(claims({ openClaimant: false, claim: false })).act, 'control: no claims hibernates').toBe('hibernate');
  });
});

describe('the vocabulary', () => {
  it('every skip is named, in the order the ladder tests them', () => {
    expect([...AUTO_ROLL_SKIPS]).toEqual([
      'setting-unreadable', 'setting-off', 'role-unknown', 'renewal-owns', 'not-coordinator', 'designation-unreadable', 'overlord',
      'release-unmeasured', 'start-unmeasured',
      'no-roll', 'idle-gate', 'hibernation-due', 'compacting',
    ]);
  });
});

// ── behind its class's model (model-class follow-up typed-repick) ─────────────────────────────────────────────────────
// An Anthropic lane's session that runs a model its class has left is behind, as on the release or the build. The lane's
// models are read only for a session past every other gate and behind on nothing else (`read-models`).
describe('the model term (typed-repick)', () => {
  const X1 = 'claude-opus-9-1';
  const X2 = 'claude-opus-9-2';
  const X0 = 'claude-opus-9-0';
  const S1 = 'claude-sonnet-9-1';
  /** Not behind on the release (its pane started after the install) nor on the build. */
  const after = INSTALLED + MIN;
  const behindX2 = { kind: 'behind', class: 'opus', from: X1, to: X2 } as const;

  const cm = (o: Partial<LaneClassModel> = {}): LaneClassModel => ({ model: null, label: null, efforts: null, ...o } as LaneClassModel);
  const ca = (o: Partial<LaneClassAdvance> = {}): LaneClassAdvance =>
    ({ family: null, hold: null, previous: null, revertable: false, lastMove: null, ...o });
  /** An Anthropic lane's read: opus's alias on X2, a launch seen on it; sonnet on S1. */
  const read = (opus: Partial<LaneClassModel> = {}, opusAdv: Partial<LaneClassAdvance> = {}): LaneModelsRead => {
    const classes = {} as Record<ModelClass, LaneClassModel>;
    const adv = {} as Record<ModelClass, LaneClassAdvance>;
    for (const c of CLASSES) { classes[c] = cm(); adv[c] = ca(); }
    classes.opus = cm({ model: X2, seenId: X2, ...opus });
    classes.sonnet = cm({ model: S1, seenId: S1 });
    adv.opus = ca(opusAdv);
    return { kind: 'read', classes, advance: { state: 'ok', detail: null, pending: null, classes: adv } };
  };
  const cand = { cls: 'opus' as const, model: X1 };

  /** The pane started three hours ago; its last render, a minute after the turn it ended, 100 minutes ago. */
  const START = NOW - 3 * HOUR;
  const RENDER_S = Math.floor((NOW - 100 * MIN) / 1000);
  const r = (cls: string | undefined, model: string | null, o: { unreadable?: string[]; route?: null; ts?: number; stale?: boolean } = {}) => ({
    route: o.route === null ? null : { fields: cls === undefined ? {} : { class: cls }, degraded: null, inert: [], unreadable: o.unreadable ?? [] },
    usage: model === null ? null : { ts: o.ts ?? RENDER_S, model, class: model.includes('-opus-') ? 'opus' : model.includes('-sonnet-') ? 'sonnet' : null,
      effort: null, ctxPct: null, cost: null, stale: o.stale ?? false },
  }) as unknown as Pick<FleetSession, 'route' | 'usage'>;

  it('the session side: an Anthropic lane, a routed class, a main-loop model of its family; anything else is none', () => {
    expect(modelCandidateOf(r('opus', X1), true, START)).toEqual({ cls: 'opus', model: X1 });
    expect(modelCandidateOf(r('opus', X1), false, START), 'not an Anthropic lane').toBeNull();
    expect(modelCandidateOf(r('default', X1), true, START), 'default is no class').toBeNull();
    expect(modelCandidateOf(r(undefined, X1), true, START), 'unrouted').toBeNull();
    expect(modelCandidateOf(r('opus', X1, { route: null }), true, START), 'never routed').toBeNull();
    expect(modelCandidateOf(r('opus', X1, { unreadable: ['class'] }), true, START), 'class unreadable').toBeNull();
    expect(modelCandidateOf(r('opus', null), true, START), 'no usage reading').toBeNull();
    expect(modelCandidateOf(r('opus', S1), true, START), 'a hand pick of another class').toBeNull();
  });

  it('only a reading rendered after the current pane started is a candidate; an unknown start is none (fix round 1)', () => {
    // A session relaunched by another path (a build roll, a swap, a wake) keeps its old reading until it renders again.
    expect(modelCandidateOf(r('opus', X1, { ts: Math.floor((START - MIN) / 1000) }), true, START), 'rendered before the start').toBeNull();
    expect(modelCandidateOf(r('opus', X1, { ts: Math.floor(START / 1000) }), true, START), 'rendered at the start').toBeNull();
    expect(modelCandidateOf(r('opus', X1), true, null), 'start unknown').toBeNull();
    // An idle session's status line does not render again, so a reading the roll could act on is past the freshness
    // window: stale after its start is still a candidate.
    expect(modelCandidateOf(r('opus', X1, { stale: true }), true, START)).toEqual({ cls: 'opus', model: X1 });
  });

  it('the lane side: on the old id after a move is behind; on the new id, unlaunchable or unseen it is not', () => {
    expect(modelFactOf(cand, read())).toEqual(behindX2);
    expect(modelFactOf({ cls: 'opus', model: X2 }, read())).toEqual({ kind: 'current' });
    expect(modelFactOf({ cls: 'opus', model: `${X2}[1m]` }, read())).toEqual({ kind: 'current' });
    // `show` nulls an unlaunchable id and names its need.
    expect(modelFactOf(cand, read({ model: null, unlaunchable: { needs: '9.9.9', laneVersion: '1.0.0' } }))).toEqual({ kind: 'current' });
    expect(modelFactOf(cand, read({ seenId: X1 })), 'no launch seen on X2 yet').toEqual({ kind: 'current' });
    expect(modelFactOf(cand, read({ seenId: undefined })), 'an op too old to say').toEqual({ kind: 'current' });
    expect(modelFactOf(null, read())).toEqual({ kind: 'none' });
  });

  it('while a hold stands its id is the target, seen or not; a session at the held id is current', () => {
    const held = read({ model: X0, aliasId: X2, seenId: X2 }, { hold: { at: '2026-11-20T00:00:00Z', by: 'hand', model: X0 } });
    expect(modelFactOf(cand, held)).toEqual({ kind: 'behind', class: 'opus', from: X1, to: X0 });
    expect(modelFactOf({ cls: 'opus', model: X0 }, held)).toEqual({ kind: 'current' });
    // The alias's own id is no hand pick of another class: a session on X2 under the hold is behind the held id.
    expect(modelFactOf({ cls: 'opus', model: X2 }, held)).toEqual({ kind: 'behind', class: 'opus', from: X2, to: X0 });
  });

  it('an unread read is unread; a read that gave no answer, or whose holds are unknown, is unmeasured', () => {
    expect(modelFactOf(cand, undefined)).toEqual({ kind: 'unread' });
    for (const r of [{ kind: 'unreadable' }, { kind: 'busy' }, { kind: 'absent', laneKind: 'anthropic' }, { kind: 'unsupported' }] as LaneModelsRead[]) {
      expect(modelFactOf(cand, r)).toEqual({ kind: 'unmeasured' });
    }
    const r = read() as Extract<LaneModelsRead, { kind: 'read' }>;
    expect(modelFactOf(cand, { ...r, advance: { state: 'unreadable', detail: 'x', pending: null, classes: null } })).toEqual({ kind: 'unmeasured' });
    expect(modelFactOf(cand, { ...r, advance: undefined })).toEqual({ kind: 'unmeasured' });
    expect(modelFactOf(cand, { ...r, advance: { state: 'absent', detail: null, pending: null, classes: null } })).toEqual(behindX2);
  });

  it('behind on its model alone, an idle session is rolled, the target named', () => {
    expect(autoRollVerdict(input(2 * HOUR, { startedAt: after, model: behindX2 })))
      .toEqual({ act: 'roll', idleMs: 2 * HOUR, model: { class: 'opus', from: X1, to: X2 } });
  });

  it('a session already rolled for that target is not rolled again; a newer target asks again', () => {
    expect(autoRollVerdict(input(2 * HOUR, { startedAt: after, model: behindX2, rolledModelFor: X2 }))).toEqual({ act: 'current' });
    expect(autoRollVerdict(input(2 * HOUR, { startedAt: after, model: behindX2, rolledModelFor: X0 })).act).toBe('roll');
    // Behind on the release as well: rolled for the release, with no model target named.
    expect(autoRollVerdict(input(2 * HOUR, { model: behindX2, rolledModelFor: X2 }))).toEqual({ act: 'roll', idleMs: 2 * HOUR });
  });

  it('current, unmeasured or none on its model is not behind', () => {
    for (const model of [{ kind: 'current' }, { kind: 'unmeasured' }, { kind: 'none' }] as const) {
      expect(autoRollVerdict(input(2 * HOUR, { startedAt: after, model }))).toEqual({ act: 'current' });
    }
  });

  it('unread: past every gate it asks for the lane read; held at a gate it is current, never a skip', () => {
    expect(autoRollVerdict(input(2 * HOUR, { startedAt: after, model: { kind: 'unread' } }))).toEqual({ act: 'read-models' });
    expect(autoRollVerdict(input(ROLL_QUIET_MS - MIN, { startedAt: after, model: { kind: 'unread' } }))).toEqual({ act: 'current' });
    expect(autoRollVerdict(input(2 * HOUR, { startedAt: after, model: { kind: 'unread' }, optedOut: { roll: true, hibernate: false } })))
      .toEqual({ act: 'current' });
    expect(autoRollVerdict(input(2 * HOUR, { startedAt: after, model: { kind: 'unread' }, statusUpdatedAt: NOW - MIN }))).toEqual({ act: 'current' });
    // Before the live reads the verdict measures first, as for every row.
    expect(autoRollVerdict(input(2 * HOUR, { startedAt: after, model: { kind: 'unread' }, sleep: sleep(2 * HOUR, { unread: true }) })))
      .toEqual({ act: 'measure' });
    // Behind on the release already: no lane read is asked for.
    expect(autoRollVerdict(input(2 * HOUR, { model: { kind: 'unread' } }))).toEqual({ act: 'roll', idleMs: 2 * HOUR });
  });

  it('the gates still hold a session behind on its model, by name', () => {
    expect(autoRollVerdict(input(2 * HOUR, { startedAt: after, model: behindX2, optedOut: { roll: true, hibernate: false } })))
      .toEqual({ act: 'skip', reason: 'no-roll' });
    expect(autoRollVerdict(input(2 * HOUR, { startedAt: after, model: behindX2, overlord: true }))).toEqual({ act: 'skip', reason: 'overlord' });
    expect(autoRollVerdict(input(2 * HOUR, { startedAt: after, model: behindX2, targets: 'off' }))).toEqual({ act: 'skip', reason: 'setting-off' });
  });
});
