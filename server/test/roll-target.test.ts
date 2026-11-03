// The automatic coordinator roll's verdict, release half (D-7443, D-7452, D-7454; the operator's rulings of
// 2026-10-29): an idle coordinator whose pane started before the node's current ccrc install is rolled once it has
// been quiet for 90 minutes; a non-coordinator is never rolled; a busy, compacting or opted-out coordinator, or one
// hibernation will take within 30 minutes, is skipped by name; the setting off rolls nothing. Pure: no fixture HOME,
// no process, no network.
import { describe, expect, it } from 'vitest';
import { VIEWER_OPEN_TTL_MS, sessionRoleOf, type ChildMark } from '../../shared/api.js';
import { CLAUDE_ROLL_TARGETS, CLAUDE_ROLL_TARGETS_DEFAULT, isClaudeRollTargets } from '../../shared/claudeVersion.js';
import {
  AUTO_ROLL_SKIPS, ROLL_COMPACT_QUIET_MS, ROLL_HIBERNATION_LEAD_MS, ROLL_QUIET_MS, autoRollVerdict, rollTargetsOf,
  rollTargetVerdict, type AutoRollInput,
} from '../src/coord/rollTarget.js';
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
  optedOut: false,
  store: o.store ?? { ok: true, openWorker: false, openClaimant: false, claim: false, mail: false },
  viewer: o.viewer ?? false,
  sinceStartMs: VIEWER_OPEN_TTL_MS + HOUR,
  live: o.unread ? { kind: 'unread' } : { kind: 'read', word: { ok: true, word: o.word ?? 'idle' }, mark: o.mark ?? mark(ageMs) },
});

/** An idle coordinator, behind on release, quiet for `ageMs`, hibernation unarmed. */
const input = (ageMs: number, o: Partial<AutoRollInput> = {}): AutoRollInput => ({
  targets: CLAUDE_ROLL_TARGETS_DEFAULT,
  role: 'coordinator',
  release: INSTALLED,
  startedAt: PANE_START,
  optedOut: { roll: false, hibernate: false },
  hibernation: { armed: false, afterMs: HIBERNATE_AFTER_MS_DEFAULT },
  statusUpdatedAt: NOW - ageMs,
  sleep: sleep(ageMs),
  now: NOW,
  ...o,
});

describe('the setting (D-7453)', () => {
  it('the default is coordinators, and the row offers coordinators or off, never all', () => {
    expect(CLAUDE_ROLL_TARGETS_DEFAULT).toBe('coordinators');
    expect([...CLAUDE_ROLL_TARGETS]).toEqual(['coordinators', 'off']);
    expect(isClaudeRollTargets('all')).toBe(false);
  });

  it('a stored row is read through the one narrowing; a lost row is the default; anything else rolls nothing', () => {
    expect(rollTargetsOf({ kind: 'row', targets: 'off' })).toBe('off');
    expect(rollTargetsOf({ kind: 'row', targets: 'coordinators' })).toBe('coordinators');
    expect(rollTargetsOf({ kind: 'absent' })).toBe('coordinators');
    expect(rollTargetsOf({ kind: 'row', targets: 'all' })).toBeNull();
    expect(rollTargetsOf({ kind: 'unreadable', detail: 'locked' })).toBeNull();
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

describe('the role (D-7443): coordinators only', () => {
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

  it('an idle child is never rolled, however long it idles and however far behind', () => {
    expect(autoRollVerdict(input(30 * HOUR, { role: sessionRoleOf(CHILD) }))).toEqual({ act: 'skip', reason: 'not-coordinator' });
  });

  it('an unreadable .child counts as a child', () => {
    expect(sessionRoleOf(UNREADABLE)).toBe('child');
    expect(autoRollVerdict(input(30 * HOUR, { role: sessionRoleOf(UNREADABLE) }))).toEqual({ act: 'skip', reason: 'not-coordinator' });
  });

  it('a row whose role is unknown is never rolled', () => {
    expect(autoRollVerdict(input(30 * HOUR, { role: null }))).toEqual({ act: 'skip', reason: 'role-unknown' });
  });

  it('the role is tested before anything is measured: a child is never measured', () => {
    expect(autoRollVerdict(input(2 * HOUR, { role: 'child', sleep: sleep(2 * HOUR, { unread: true }) })))
      .toEqual({ act: 'skip', reason: 'not-coordinator' });
    expect(autoRollVerdict(input(2 * HOUR, { sleep: sleep(2 * HOUR, { unread: true }) }))).toEqual({ act: 'measure' });
  });

  it('rollTargetVerdict is the filter: setting first, then the role', () => {
    expect(rollTargetVerdict('coordinators', 'coordinator')).toEqual({ take: true });
    expect(rollTargetVerdict('off', 'coordinator')).toEqual({ take: false, skip: 'setting-off' });
    expect(rollTargetVerdict('coordinators', 'child')).toEqual({ take: false, skip: 'not-coordinator' });
    expect(rollTargetVerdict('coordinators', null)).toEqual({ take: false, skip: 'role-unknown' });
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

  it('with claims, .no-roll still opts it out, and a non-coordinator is still never rolled', () => {
    expect(autoRollVerdict(input(past, { optedOut: { roll: true, hibernate: false }, sleep: sleep(past, { store: claims() }) })))
      .toEqual({ act: 'skip', reason: 'no-roll' });
    expect(autoRollVerdict(input(30 * HOUR, { role: sessionRoleOf(CHILD), sleep: sleep(30 * HOUR, { store: claims() }) })))
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
      'setting-unreadable', 'setting-off', 'role-unknown', 'not-coordinator', 'release-unmeasured', 'start-unmeasured',
      'no-roll', 'idle-gate', 'hibernation-due', 'compacting',
    ]);
  });
});
