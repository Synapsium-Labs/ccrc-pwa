// F7: the compact warn row. The board's job here is to say a wedge exists using
// facts the server measured — and, just as load-bearing, to say NOTHING when the
// server is older than the field or when the run is healthy. An older server
// omitting `health` must render exactly as the board did before it existed.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
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

  it('draws NOTHING on a closed run, in either the done or the failed arm', async () => {
    // The board has ONE rowFor and applies it to `list` AND to `finished`
    // (RunsScreen), so this is the only thing that keeps warnings out of the
    // archive. Before the filter: a wave whose first done-claim was refused
    // stale-tip and then closed cleanly carried an amber "1 rejected" forever, and
    // an ABANDONED run — failed, never dispatched, which is exactly what the
    // Abandon control produces on a wedged row — drew "never briefed … an open run
    // whose chair nobody sat in", about a closed run.
    // REAL timers here, deliberately: `waitFor` polls, and fake timers deadlock it.
    // The only clock-sensitive fact is the kickoff, so it is anchored to the real
    // now rather than to FROZEN.
    const wedged = (): Partial<RunSummary> => health({
      mailParked: 2, doneRejects: 1, lastRejectCode: 'stale-tip',
      coordKickoffPendingSince: Date.now() - 86_400_000 });
    // THROUGH THE COLD LOADER, which is the only path a closed run reaches the
    // board by: `active` is the live frame MINUS closed rows, and `finished` comes
    // from `?closed=1` alone. The first version of this case pushed the closed run
    // onto the LIVE frame, where the board filtered it out before rendering — so it
    // asserted an absence its own fixture could not produce, and the mutation that
    // deletes `isRunClosed` from `runWarnings` measured GREEN against it.
    for (const state of ['done', 'failed'] as const) {
      const store = makeStore();
      act(() => { store.setState({ runs: [], runsFrameSeen: true }); });
      const closed = r({ state, closedAt: Date.now() - 10_000, dispatchedAt: null, ...wedged() });
      render(<RunsScreen store={store} loadRuns={async () => ({ runs: [closed] })}
                         loadCaps={NO_CAPS} />);
      await waitFor(() => expect(document.querySelector('.run-row')).not.toBeNull());
      expect(document.querySelector('[aria-label^="finished"]'),
        `the ${state} fixture did not reach the Finished group`).not.toBeNull();
      expect(warn(), `a ${state} run drew a warning`).toBeNull();
      cleanup();
    }
    // Non-vacuity: the SAME health on an OPEN run does draw, so the fixture could
    // have gone either way.
    board({ state: 'working', dispatchedAt: null,
            ...health({ mailParked: 2, doneRejects: 1, lastRejectCode: 'stale-tip',
                        coordKickoffPendingSince: FROZEN - 86_400_000 }) });
    expect(warn(), 'the fixture cannot produce the presence it asserts the absence of').not.toBeNull();
  });

  it('says nothing about briefQueued === null — no dispatch decided anything', () => {
    // NULL is a third condition, not a flavour of false. A row from before
    // migration 7, or a run nobody dispatched, has no decision to report.
    board(health({ briefQueued: null }));
    expect(warn()).toBeNull();
  });
});

describe('the warn row draws each wedge, with two cues', () => {
  it('names parked mail, and the outstanding half beside it', () => {
    board(health({ mailParked: 2, mailOutstanding: 5 }));
    expect(warn()?.textContent).toContain('2 parked');
    // The spec's ask is "outstanding VS parked". Without this the field was
    // measured, shipped on every run in every frame, and read by nothing.
    expect(warn()?.querySelector('[title]')?.getAttribute('title'),
      'mailOutstanding has no reader').toContain('5 still outstanding');
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
    // The code rides the WORD, not only the title: this board is mobile-first,
    // has no hover, and a title on a span flattened inside `.run-open` is not
    // announced either — so a title-only fact is one the operator cannot reach.
    expect(warn()?.textContent).toContain('no brief');
    expect(warn()?.textContent, 'the /clear refusal is title-only').toContain('draft-present');
  });

  it('names done-claim rejections and the last code', () => {
    board(health({ doneRejects: 3, lastRejectCode: 'stale-tip' }));
    expect(warn()?.textContent).toContain('3');
    expect(warn()?.textContent, 'the reject code is title-only').toContain('stale-tip');
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
