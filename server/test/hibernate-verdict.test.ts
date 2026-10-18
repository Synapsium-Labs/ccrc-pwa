// D-5242 (`hibernate-long-idle-sessions`, plan Task 17a, spec §5.11): `hibernateVerdict`, the server's pure rule for
// putting a long-idle session to sleep. One base input that hibernates, then one case per member of
// `HIBERNATE_HOLDS`, held equal to the list, each red against an implementation that answers `hibernate`. The cases the
// plan names as written first (a `done` bucket, `bg: -1`, the claimant in `awaiting-review` and `merging`) come first
// in their tables. Nothing here can act: the verdict only decides.
import { describe, it, expect } from 'vitest';
import {
  HIBERNATE_AFTER_MS_DEFAULT, HIBERNATE_HOLDS, hibernateAfterMs, hibernateVerdict,
  type HibernateHold, type HibernateInput, type HibernateLive, type HibernateMark, type HibernateRow,
  type HibernateStoreRead,
} from '../src/coord/hibernate.js';
import { PRESENCE_OPEN_TTL_MS, PRESENCE_TTL_MS, RUN_STATES, TERMINAL_RUN_STATES } from '../../shared/api.js';

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const ID = 'lane-a-project-a';

const row = (over: Partial<HibernateRow> = {}): HibernateRow => ({
  id: ID, status: 'idle', archivedAt: null, bucket: 'idle', held: null, unmeasured: [], statusUnmeasured: false,
  dialogPending: false, background: null, subagents: null, stranded: null, swapBlocked: null, substrate: null,
  ...over,
});
const STORE: HibernateStoreRead = { ok: true, openWorker: false, openClaimant: false, claim: false, mail: false };
/** The marker a Stop 7 h ago writes: `done`, no background task, nothing scheduled. */
const MARK: HibernateMark = {
  ok: true, state: 'done', bg: 0, crons: 0, turnAt: NOW - 7 * HOUR - MIN, stopAt: NOW - 7 * HOUR, restartAt: null,
};
const live = (over: { word?: string; mark?: Partial<HibernateMark> | HibernateMark } = {}): HibernateLive => ({
  kind: 'read', word: { ok: true, word: over.word ?? 'idle' },
  mark: { ...MARK, ...(over.mark ?? {}) } as HibernateMark,
});
const base = (over: Partial<HibernateInput> = {}): HibernateInput => ({
  row: row(), optedOut: false, store: STORE, viewer: false, sinceStartMs: PRESENCE_OPEN_TTL_MS + 1, live: live(),
  ...over,
});
const verdict = (over: Partial<HibernateInput> = {}) => hibernateVerdict(base(over), NOW, HIBERNATE_AFTER_MS_DEFAULT);
const held = (reason: HibernateHold) => ({ act: 'hold', reason });

describe('hibernateVerdict: the base case', () => {
  it('an idle row whose marker stopAt is 7 h old with crons 0 hibernates, naming how long it sat idle', () => {
    expect(verdict()).toEqual({ act: 'hibernate', idleMs: 7 * HOUR });
  });
  it('the default N is 6 hours', () => {
    expect(HIBERNATE_AFTER_MS_DEFAULT).toBe(6 * HOUR);
  });
  it('the live reads come last: a row nothing cheaper holds asks for them (`measure`)', () => {
    expect(verdict({ live: { kind: 'unread' } })).toEqual({ act: 'measure' });
  });
});

/** One case per hold. Each entry changes ONE fact of the base input. */
const CASES: readonly (readonly [HibernateHold, Partial<HibernateInput>, string])[] = [
  ['bucket', { row: row({ bucket: 'done' }) }, 'bucket done (a badged result may be unread) — written first'],
  ['marker-background', { live: live({ mark: { bg: -1 } }) }, 'marker bg -1 (unknown; red against "0 or less")'],
  ['bucket', { row: row({ bucket: 'working' }) }, 'bucket working'],
  ['bucket', { row: row({ bucket: 'attention' }) }, 'bucket attention'],
  ['live-word', { live: live({ word: 'busy' }) }, 'live busy'],
  ['live-word', { live: live({ word: 'shell' }) }, 'live shell (a background shell over an idle main loop)'],
  ['live-word', { live: live({ word: 'waiting' }) }, 'live waiting'],
  ['menu', { row: row({ dialogPending: true }) }, 'a pane menu'],
  ['background', { row: row({ background: { count: 1, kinds: ['subagent'] } }) }, 'background set'],
  ['roster', { row: row({ subagents: [{ name: 'a0000000000000001', startedAt: NOW - MIN }] }) }, 'roster non-empty'],
  ['marker', { live: live({ mark: { state: 'failed' } }) }, 'marker failed'],
  ['marker', { live: live({ mark: { ok: false, reason: 'stale' } }) }, 'marker stale (not this process)'],
  ['marker', { live: live({ mark: { ok: false, reason: 'absent' } }) }, 'marker absent (an older hook)'],
  ['marker-background', { live: live({ mark: { bg: 1 } }) }, 'marker bg 1 (a monitor)'],
  ['scheduled', { live: live({ mark: { crons: 1 } }) }, 'marker crons 1'],
  ['scheduled', { live: live({ mark: { crons: null } }) }, 'a marker with no crons (an older hook)'],
  ['scheduled', { live: live({ mark: { crons: -1 } }) }, 'marker crons -1 (the Stop carried no array)'],
  ['recent', { live: live({ mark: { stopAt: NOW - 5 * HOUR, turnAt: NOW - 5 * HOUR - MIN } }) }, '5 h old'],
  ['held', { row: row({ held: 'programme-a' }) }, 'held'],
  ['run-worker', { store: { ...STORE, openWorker: true } }, 'an open run as worker'],
  ['run-claimant', { store: { ...STORE, openClaimant: true } }, 'an open run as claimant'],
  ['runs-unreadable', { store: { ok: false, detail: 'run-unreadable' } }, 'a run read that fails'],
  ['claim', { store: { ...STORE, claim: true } }, 'a claim held'],
  ['mail', { store: { ...STORE, mail: true } }, 'queued mail'],
  ['viewer', { viewer: true }, 'an open screen (Presence.isOpen), visible or not'],
  ['stranded', { row: row({ stranded: { at: NOW - HOUR, reason: 'fixture' } }) }, 'stranded'],
  ['swap-blocked', { row: row({ swapBlocked: { at: NOW - HOUR, reason: 'fixture' } }) }, 'swap-blocked'],
  ['substrate', { row: row({ substrate: { at: NOW - HOUR, text: 'fixture' } }) }, 'substrate'],
  ['archived', { row: row({ archivedAt: 1_700_000_000 }) }, 'archived'],
  ['opted-out', { optedOut: true }, 'no-hibernate'],
  ['unmeasured', { row: row({ statusUnmeasured: true }) }, 'status unmeasured'],
  ['unmeasured', { row: row({ unmeasured: ['uuid'] }) }, 'identity unmeasured'],
  ['unmeasured', { live: { kind: 'read', word: { ok: false, reason: 'unmeasured' }, mark: MARK } }, 'live file unread'],
  ['pane', { row: row({ status: 'dead', bucket: 'dead' }) }, 'no live pane'],
  ['pane', { live: { kind: 'read', word: { ok: false, reason: 'no-pane' }, mark: MARK } }, 'no pane at the live read'],
];

describe('hibernateVerdict: every hold, one case each', () => {
  it.each(CASES.map(([reason, over, what]) => [what, reason, over] as const))('%s → hold %s', (_what, reason, over) => {
    expect(verdict(over)).toEqual(held(reason));
  });

  it('the cases cover HIBERNATE_HOLDS exactly: a hold with no case, or a case with no hold, is red', () => {
    expect([...new Set(CASES.map(([r]) => r))].sort()).toEqual([...HIBERNATE_HOLDS].sort());
  });
});

describe('hibernateVerdict: open runs, every non-terminal RunState', () => {
  const OPEN = RUN_STATES.filter((s) => !(TERMINAL_RUN_STATES as readonly string[]).includes(s));
  it('the open states are the seven the spec names (planned, dispatched, working, awaiting-review, merging, closing, unknown)', () => {
    expect([...OPEN].sort()).toEqual(['awaiting-review', 'closing', 'dispatched', 'merging', 'planned', 'unknown', 'working']);
  });
  // The verdict reads booleans the sweep computed with the store's `state NOT IN` the terminal set; these cases pin
  // the store half (`hibernate-sweep.test.ts` drives a real store for every state).
  it('the claimant cases written first: awaiting-review and merging hold through the claimant read', () => {
    expect(verdict({ store: { ...STORE, openClaimant: true } })).toEqual(held('run-claimant'));
  });
  it('a claimant whose only runs are done or failed hibernates', () => {
    expect(verdict({ store: { ...STORE, openClaimant: false } })).toEqual({ act: 'hibernate', idleMs: 7 * HOUR });
  });
});

describe('hibernateVerdict: the clock', () => {
  it('idle compactions that moved statusUpdatedAt 50 minutes ago do not hold a row whose marker is 7 h old', () => {
    const r = { ...row(), statusUpdatedAt: NOW - 50 * MIN, bucketSince: NOW - 50 * MIN } as HibernateRow;
    expect(verdict({ row: r })).toEqual({ act: 'hibernate', idleMs: 7 * HOUR });
  });
  it('the latest of turnAt, stopAt and restartAt is the clock: a restart 1 h ago holds', () => {
    expect(verdict({ live: live({ mark: { restartAt: NOW - HOUR } }) })).toEqual(held('recent'));
  });
  it('a marker with no stamp at all cannot be aged, and holds', () => {
    expect(verdict({ live: live({ mark: { turnAt: null, stopAt: null, restartAt: null } }) })).toEqual(held('recent'));
  });
  it('N exactly is not "more than N": it holds, and one millisecond more hibernates', () => {
    const at = (age: number) => live({ mark: { stopAt: NOW - age, turnAt: NOW - age - 1 } });
    expect(verdict({ live: at(HIBERNATE_AFTER_MS_DEFAULT) })).toEqual(held('recent'));
    expect(verdict({ live: at(HIBERNATE_AFTER_MS_DEFAULT + 1) })).toEqual({ act: 'hibernate', idleMs: HIBERNATE_AFTER_MS_DEFAULT + 1 });
  });
  it('afterMs is the caller\'s: N = 2 h hibernates a 3 h row', () => {
    const three = live({ mark: { stopAt: NOW - 3 * HOUR, turnAt: NOW - 3 * HOUR - MIN } });
    expect(hibernateVerdict(base({ live: three }), NOW, 2 * HOUR)).toEqual({ act: 'hibernate', idleMs: 3 * HOUR });
    expect(hibernateVerdict(base({ live: three }), NOW, HIBERNATE_AFTER_MS_DEFAULT)).toEqual(held('recent'));
  });
});

describe('hibernateVerdict: the post-start presence hold', () => {
  it('every candidate holds viewer for PRESENCE_OPEN_TTL_MS after the server starts (presence is never persisted)', () => {
    expect(verdict({ sinceStartMs: 0 })).toEqual(held('viewer'));
    expect(verdict({ sinceStartMs: PRESENCE_OPEN_TTL_MS - 1 })).toEqual(held('viewer'));
    expect(verdict({ sinceStartMs: PRESENCE_OPEN_TTL_MS })).toEqual({ act: 'hibernate', idleMs: 7 * HOUR });
  });
  it('the window is the open TTL, not the visible one: at PRESENCE_TTL_MS + 1 it still holds', () => {
    expect(PRESENCE_OPEN_TTL_MS).toBeGreaterThan(PRESENCE_TTL_MS);
    expect(verdict({ sinceStartMs: PRESENCE_TTL_MS + 1 })).toEqual(held('viewer'));
  });
});

describe('hibernateAfterMs: $REG/hibernate-after-hours', () => {
  it('absent is the default', () => {
    expect(hibernateAfterMs(null)).toBe(HIBERNATE_AFTER_MS_DEFAULT);
  });
  it('an integer from 1 to 168 is that many hours, whitespace trimmed', () => {
    expect(hibernateAfterMs('2')).toBe(2 * HOUR);
    expect(hibernateAfterMs('1\n')).toBe(HOUR);
    expect(hibernateAfterMs(' 168 ')).toBe(168 * HOUR);
  });
  it('an out-of-range or malformed value is the default, never a guess', () => {
    for (const bad of ['0', '169', '-3', '1.5', '2h', '', 'six', '1e2', '0x10']) {
      expect(hibernateAfterMs(bad), JSON.stringify(bad)).toBe(HIBERNATE_AFTER_MS_DEFAULT);
    }
  });
});
