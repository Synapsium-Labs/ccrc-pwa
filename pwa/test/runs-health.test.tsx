// F7: the compact warn row. The board's job here is to say a wedge exists using
// facts the server measured — and, just as load-bearing, to say NOTHING when the
// server is older than the field or when the run is healthy. An older server
// omitting `health` must render exactly as the board did before it existed.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { KICKOFF_UNACKED_MS, MAIL_REPLAY_WARN_COUNT,
         type CoordCapsView, type RunHealth, type RunSummary } from '../../shared/api';
import { RunsScreen } from '../src/screens/RunsScreen';
import { runWarnings } from '../src/fleet/runWords';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const FROZEN = 1_800_000_000_499;

const HEALTHY: RunHealth = {
  mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0,
  lastRejectCode: null, briefQueued: true, clearError: null, coordKickoffPendingSince: null,
};

const r = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 3, program: 'program-leverage', programTitle: 'Program leverage',
  wave: 7, waveOf: 8, project: 'ccrc-pwa',
  sessionId: 'ccrc-pwa-quiet-meadow', workspace: 'quiet-meadow', branch: 'ws/quiet-meadow',
  state: 'working', claimedBy: 'ccrc-pwa-brisk-meadow', resumed: false, clearedAt: null,
  openedAt: FROZEN - 1_000_000, dispatchStartedAt: null,
  dispatchedAt: FROZEN - 900_000, closedAt: null,
  handoffCommit: null, items: { done: 3, total: 7 }, unreadMail: 0,
  health: HEALTHY, ...over,
});

const makeStore = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null,
                       close(): void {} }) as unknown as WebSocket,
});
const NO_CAPS = (): Promise<CoordCapsView> => new Promise<CoordCapsView>(() => {});

/** Mounts the board with one run on the live frame, at a frozen clock. */
const board = (over: Partial<RunSummary>): void => {
  vi.useFakeTimers({ now: FROZEN });
  const store = makeStore();
  act(() => { store.setState({ runs: [r(over)], runsFrameSeen: true }); });
  render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} loadCaps={NO_CAPS} />);
};
afterEach(() => { vi.useRealTimers(); });

const warn = (): HTMLElement | null => document.querySelector('.run-warn');
const health = (over: Partial<RunHealth>): Partial<RunSummary> => ({ health: { ...HEALTHY, ...over } });

describe('the warn row says nothing it was not told', () => {
  it('renders no warn row for a healthy run', () => {
    board({});
    expect(warn(), 'a healthy run drew a warning').toBeNull();
  });

  it('renders NOTHING when the server omits health — absence is never a verdict', () => {
    // The older-server case, and the one that matters most: `undefined` is not
    // "no wedge here", which is a claim this build would be making on that
    // server's behalf. Deleting a REQUIRED key is exactly what an older server
    // does on the wire, whatever the type says.
    const noHealth = { ...r() } as Partial<RunSummary>;
    delete noHealth.health;
    const store = makeStore();
    act(() => { store.setState({ runs: [noHealth as RunSummary], runsFrameSeen: true }); });
    expect(() => render(
      <RunsScreen store={store} loadRuns={async () => ({ runs: [] })} loadCaps={NO_CAPS} />))
      .not.toThrow();
    expect(warn(), 'an older server was made to assert a health claim').toBeNull();
  });

  it('says nothing about briefQueued === null — no dispatch decided anything', () => {
    // NULL is a third condition, not a flavour of false. A row from before
    // migration 7, or a run nobody dispatched, has no decision to report.
    board(health({ briefQueued: null }));
    expect(warn()).toBeNull();
  });
});

describe('the warn row draws each wedge, with two cues', () => {
  it('names parked mail', () => {
    board(health({ mailParked: 2 }));
    expect(warn()?.textContent).toContain('2 parked');
    // A word AND a glyph — the board's standing rule, so no state is read out
    // of colour alone.
    expect(warn()?.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('names a replay count climbing toward the ceiling, at the threshold and not below', () => {
    board(health({ mailReplayMax: MAIL_REPLAY_WARN_COUNT }));
    expect(warn()?.textContent).toContain(`${MAIL_REPLAY_WARN_COUNT}`);
    cleanup();
    board(health({ mailReplayMax: MAIL_REPLAY_WARN_COUNT - 1 }));
    expect(warn(), 'a replay below the threshold drew a warning').toBeNull();
  });

  it('names a dispatch that queued no brief, and says why', () => {
    board(health({ briefQueued: false, clearError: 'draft-present' }));
    expect(warn()?.textContent).toContain('no brief');
    expect(warn()?.querySelector('[title]')?.getAttribute('title')).toContain('draft-present');
  });

  it('names done-claim rejections and the last code', () => {
    board(health({ doneRejects: 3, lastRejectCode: 'stale-tip' }));
    expect(warn()?.textContent).toContain('3');
    expect(warn()?.querySelector('[title]')?.getAttribute('title')).toContain('stale-tip');
  });

  it('names an un-briefed coordinator only past the threshold, and only before dispatch', () => {
    // Spec design §9's condition is all THREE: open run, dispatchedAt null,
    // kickoff unacked past a threshold. This is run 11's live shape — planned
    // since 2026-08-28, dispatch begun and never completed.
    board({ ...health({ coordKickoffPendingSince: FROZEN - KICKOFF_UNACKED_MS }),
            state: 'planned', dispatchedAt: null });
    expect(warn()?.textContent).toContain('never briefed');
    cleanup();
    board({ ...health({ coordKickoffPendingSince: FROZEN - KICKOFF_UNACKED_MS + 1_000 }),
            state: 'planned', dispatchedAt: null });
    expect(warn(), 'a kickoff inside the threshold drew a warning').toBeNull();
    cleanup();
    // The middle condition, which the first draft of this omitted: a run that HAS
    // dispatched is not un-briefed, whatever its coordinator's mailbox says.
    board({ ...health({ coordKickoffPendingSince: FROZEN - KICKOFF_UNACKED_MS }),
            dispatchedAt: FROZEN - 10_000 });
    expect(warn(), 'a dispatched run was called never-briefed').toBeNull();
  });

  it('draws several at once, each its own item', () => {
    board(health({ mailParked: 1, doneRejects: 1 }));
    expect(document.querySelectorAll('.run-warn-item')).toHaveLength(2);
  });
});

describe('runWarnings — the decision, not the markup', () => {
  const h = (over: Partial<RunHealth>): RunHealth => ({ ...HEALTHY, ...over });

  it('is empty for an absent health object, and does not throw', () => {
    expect(runWarnings({ state: 'working' }, FROZEN)).toEqual([]);
  });

  it('reads briefQueued with === false, never truthiness', () => {
    // `!h.briefQueued` would fire on null too, which is the overloaded read this
    // whole field exists to avoid.
    expect(runWarnings({ state: 'working', health: h({ briefQueued: null }) }, FROZEN)).toEqual([]);
    expect(runWarnings({ state: 'working', health: h({ briefQueued: false }) }, FROZEN))
      .toHaveLength(1);
  });

  it('guards the kickoff timestamp before doing arithmetic on it', () => {
    // The negated-comparison idiom (MailStrip.tsx): an ABSENT numeric must fail
    // the test rather than pass it. `null` here would otherwise become 0 and
    // read as an infinitely old kickoff on every healthy row.
    expect(runWarnings({ state: 'working', health: h({ coordKickoffPendingSince: null }) }, FROZEN))
      .toEqual([]);
  });

  it('gives every warning both a word and a glyph', () => {
    const all = runWarnings({ state: 'working', dispatchedAt: null, health: h({
      mailParked: 1, mailReplayMax: 20, briefQueued: false, doneRejects: 1,
      coordKickoffPendingSince: 0 }) }, FROZEN);
    expect(all.length).toBe(5);
    for (const w of all) {
      expect(w.word.length, 'a warning with no word').toBeGreaterThan(0);
      expect(w.glyph.length, 'a warning with no glyph').toBeGreaterThan(0);
      expect(w.title.length, 'a warning with no explanation').toBeGreaterThan(10);
    }
  });
});
