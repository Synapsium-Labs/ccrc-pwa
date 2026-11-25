// The provider-failure ladder's words (wave 2; plan docs/superpowers/plans/2026-11-25-provider-retry.md): what the console says of a
// session whose turn ended on a provider error and that ccrc retries by itself. One words module (`providerRetryWords.ts`), and the
// owners of the words it takes the place of: the row's and the header's status word (`sessionFacts.ts`, `sessionHeaderView.ts`),
// the `stalled` marker, and the run row's "turn failed" and "quiet" (`runWords.ts#workerSeenNote`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { WAITING_ON_WORKERS } from '../src/fleet/sessionFacts';
import { reviveFleetSession, TURN_STALL_MS, type FleetSession, type RunSummary } from '../../shared/api';
import type { ProviderRetryWire } from '../../shared/provider-retry';
import { cardFacts, cardWithinHeader, headerFacts, headerStatusWord, markers, sessionFacts } from '../src/fleet/sessionFacts';
import { providerRetryNote } from '../src/fleet/providerRetryWords';
import { workerSeenNote } from '../src/fleet/runWords';
import { SessionLine } from '../src/fleet/SessionLine';
import { RunRow } from '../src/screens/RunRow';
import { RunDetailScreen } from '../src/screens/RunDetailScreen';
import { createFleetStore } from '../src/stores/fleet';
import { api } from '../src/lib/api';
import { sessionHeaderView } from '../src/session/sessionHeaderView';
import { SessionHeaderHost, type HeaderHostProps } from './sessionHost';
import { withRunBinding } from './runBindingFixture';
import { DEAD_LIFECYCLE, fleetSession, hibernatedSession } from './fleetFixture';

afterEach(cleanup);

// The viewer's own clock: the words say its HH:MM, whatever the zone the suite runs in.
const NOW = new Date(2026, 10, 25, 14, 51, 10).getTime();
const AT_52 = new Date(2026, 10, 25, 14, 52, 5).getTime();
const retry = (over: Partial<ProviderRetryWire> = {}): ProviderRetryWire =>
  ({ err: 'overloaded', since: NOW - 60_000, attempts: 1, nextAt: AT_52, phase: 'retrying', ...over });
const s = (over: Partial<FleetSession> = {}): FleetSession => fleetSession({
  id: 'lane-a-project-a-still-pond', wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workspace: 'still-pond',
  statusUpdatedAt: NOW - 60_000, providerRetry: retry(), ...over,
});
const text = (over: Partial<FleetSession> = {}, now = NOW): string | null => providerRetryNote(s(over), now)?.text ?? null;

describe('the words', () => {
  it('by the token, at the viewer\'s own time', () => {
    expect(text()).toBe('Provider overloaded, retrying 14:52');
    expect(text({ providerRetry: retry({ err: 'server_error' }) })).toBe('Provider error, retrying 14:52');
    expect(text({ providerRetry: retry({ err: null }) })).toBe('Provider error, retrying 14:52');
    expect(text({ providerRetry: retry({ err: 'a_later_token' }) })).toBe('Provider error, retrying 14:52');
  });
  it('past due reads retrying now, from the due instant on', () => {
    expect(text({}, AT_52 - 1)).toBe('Provider overloaded, retrying 14:52');
    expect(text({}, AT_52)).toBe('Provider overloaded, retrying now');
    expect(text({ providerRetry: retry({ err: 'server_error' }) }, AT_52 + 60_000)).toBe('Provider error, retrying now');
  });
  it('a held retry promises no time and no now: it is waiting', () => {
    expect(text({ providerRetry: retry({ nextAt: null }) })).toBe('Provider overloaded, retry waiting');
    expect(text({ providerRetry: retry({ err: 'server_error', nextAt: null }) }, AT_52 + 1)).toBe('Provider error, retry waiting');
    // A dialog or a question the row already shows, before the pass that finds the retry held.
    expect(text({ bucket: 'attention', dialogPending: true })).toBe('Provider overloaded, retry waiting');
  });
  it('a due time that is not today says its date', () => {
    expect(text({ providerRetry: retry({ nextAt: new Date(2026, 10, 26, 0, 3).getTime() }) })).toBe('Provider overloaded, retrying 00:03 · 26 Nov');
  });
  it('the title says ccrc acts by itself, how many in a row and, held, what can hold it', () => {
    expect(providerRetryNote(s(), NOW)!.title).toBe('The turn ended on a provider error. ccrc tells the session to continue by itself.');
    expect(providerRetryNote(s({ providerRetry: retry({ attempts: 3 }) }), NOW)!.title)
      .toBe('3 provider errors in a row since 14:50. ccrc tells the session to continue by itself.');
    expect(providerRetryNote(s({ providerRetry: retry({ nextAt: null }) }), NOW)!.title)
      .toBe('The turn ended on a provider error. ccrc tells the session to continue by itself, but something holds that now: unsent text in its box, an open dialog, a question or a usage limit.');
  });
  it('nothing: no field, null, a later phase, a malformed one, a pane that is gone, a sleeping session', () => {
    expect(text({ providerRetry: null })).toBeNull();
    const older = s(); delete (older as { providerRetry?: unknown }).providerRetry;
    expect(providerRetryNote(older, NOW)).toBeNull();
    expect(text({ providerRetry: { ...retry(), phase: 'no-lane' } as never })).toBeNull();
    expect(text({ providerRetry: { ...retry(), nextAt: 'soon' } as never })).toBeNull();
    expect(text({ status: 'dead', lifecycle: DEAD_LIFECYCLE, bucket: 'dead' })).toBeNull();
    expect(providerRetryNote(hibernatedSession(NOW - 1, { providerRetry: retry() }), NOW)).toBeNull();
  });
  it('a saved copy keeps it', () => {
    expect(providerRetryNote(reviveFleetSession(JSON.parse(JSON.stringify(s())))!, NOW)?.text).toBe('Provider overloaded, retrying 14:52');
  });
});

describe('the fleet row: the status word, in place of its own', () => {
  const card = (over: Partial<FleetSession>, more = {}) => cardFacts(sessionFacts({ session: s(over), now: NOW, ...more }));
  it.each(['idle', 'done', 'working'] as const)('a %s row says it, in the calm tone', (bucket) => {
    const f = sessionFacts({ session: s({ bucket, status: bucket === 'working' ? 'busy' : 'idle' }), now: NOW });
    expect(cardFacts(f).status.text).toBe('Provider overloaded, retrying 14:52');
    expect(cardFacts(f).status.title).toContain('ccrc tells the session to continue');
    expect(f.stateTone).toBe('idle');
  });
  it('a coordinator with busy workers says it, not that it waits on them', () => {
    const over = { role: 'coordinator' as const, bucket: 'done' as const };
    expect(card({ ...over, providerRetry: null }, { workersBusy: true }).status.text).toBe(WAITING_ON_WORKERS);
    expect(card(over, { workersBusy: true }).status.text).toBe('Provider overloaded, retrying 14:52');
    expect(sessionFacts({ session: s(over), now: NOW, workersBusy: true }).waitingOnWorkers).toBe(false);
  });
  it('it outranks the delegated background work and the stalled marker', () => {
    const busy = { bucket: 'working' as const, status: 'busy' as const };
    expect(card({ ...busy, background: { count: 2, kinds: ['agent'] } }).status.text).toBe('Provider overloaded, retrying 14:52');
    const stalled = { ...busy, ctxPct: 90, statusUpdatedAt: NOW - TURN_STALL_MS };
    const keys = (over: Partial<FleetSession>) => markers(sessionFacts({ session: s({ ...stalled, ...over }), now: NOW })).map((m) => m.key);
    expect(keys({ providerRetry: null })).toContain('stalled');
    expect(keys({})).not.toContain('stalled');
    expect(keys({}), 'the context pressure is still said').toContain('ctx');
  });
  it('a row that waits on you keeps its word: the header says both', () => {
    const over = { bucket: 'attention' as const, dialogPending: true };
    expect(card(over).status.text).toBe('waiting');
    expect(card(over).marker?.key).toBe('needs-you');
  });
  it('a question its coordinator holds keeps that word', () => {
    const wc = { kind: 'question' as const, parentId: 'lane-b-project-a', since: NOW - 1, notifyAt: NOW + 1 };
    const f = sessionFacts({ session: s({ bucket: 'working', status: 'busy', withCoordinator: wc }), now: NOW });
    expect(cardFacts(f).status.text).toMatch(/^with coordinator/);
    expect(headerFacts(f).find((x) => x.key === 'status')?.title).not.toContain('ccrc tells');
  });
  it('every card fact is a header fact, in every form', () => {
    for (const over of [{}, { bucket: 'working' as const }, { bucket: 'attention' as const }, { providerRetry: retry({ nextAt: null }) }]) {
      const f = sessionFacts({ session: s(over), now: NOW });
      expect(cardWithinHeader(cardFacts(f), headerFacts(f))).toEqual([]);
      expect(headerFacts(f).find((x) => x.key === 'status')?.title).toContain('ccrc tells the session');
    }
  });

  describe('drawn', () => {
    beforeEach(() => { vi.useFakeTimers({ now: AT_52 - 5_000 }); });
    afterEach(() => { vi.useRealTimers(); });
    it('the row ticks by itself from the time to now, though it is idle', () => {
      const { container } = render(<SessionLine session={s()} onOpen={() => undefined} onActions={() => undefined} />);
      const word = () => container.querySelector('.sess-state')!.textContent;
      expect(word()).toBe('Provider overloaded, retrying 14:52');
      act(() => { vi.advanceTimersByTime(30_000); });
      expect(word()).toBe('Provider overloaded, retrying now');
    });
  });
});

describe('the session screen: the status line', () => {
  const chip = (over: Partial<FleetSession>, status: FleetSession['status'] | null = null) => {
    const session = s(over);
    const view = sessionHeaderView({ session, status, statusUpdatedAt: null, now: NOW, finePointer: true, facts: sessionFacts({ session, now: NOW }) });
    const c = view.chips.find((x) => x.kind === 'status');
    if (c === undefined || c.kind !== 'status') throw new Error('no status chip');
    return c;
  };
  it('says it where the status is said, in the calm tint, with its title', () => {
    for (const bucket of ['idle', 'done', 'working'] as const) {
      expect(chip({ bucket, status: bucket === 'working' ? 'busy' : 'idle' })).toMatchObject({ word: 'Provider overloaded, retrying 14:52', variant: 'idle' });
    }
    expect(chip({}).title).toContain('ccrc tells the session to continue');
  });
  it('a session that waits on you says both, and promises no time', () => {
    expect(chip({ bucket: 'attention', dialogPending: true }))
      .toMatchObject({ word: 'waiting on you · Provider overloaded, retry waiting', variant: 'attention' });
  });
  it('a coordinator waiting on its workers says it instead, and its lamp is not the waiting one', () => {
    const session = s({ role: 'coordinator', bucket: 'done' });
    const view = sessionHeaderView({ session, status: null, statusUpdatedAt: null, now: NOW, finePointer: true,
      facts: sessionFacts({ session, now: NOW, workersBusy: true }) });
    expect(view.chips.find((x) => x.kind === 'status')).toMatchObject({ word: 'Provider overloaded, retrying 14:52', waiting: false });
  });
  it('a stream that says the session is dead wins', () => {
    expect(chip({}, 'dead')).toMatchObject({ word: 'exited', variant: 'dead', title: undefined });
    expect(headerStatusWord({ bucket: 'dead', asleepAt: null, background: null, at: null, now: NOW, retry: 'x' })).toBe('exited');
  });
  it('a question its coordinator holds keeps that line', () => {
    const wc = { kind: 'question' as const, parentId: 'lane-b-project-a', since: NOW - 1, notifyAt: NOW + 1 };
    const c = chip({ bucket: 'working', status: 'busy', withCoordinator: wc });
    expect(c.coordinator).not.toBeNull();
    expect(c.word).toMatch(/^working/);
  });
  it('a session with none reads as before', () => {
    expect(chip({ providerRetry: null }).word).toBe('idle · 1m ago');
  });
  it('the header draws it', () => {
    const props: HeaderHostProps = {
      session: s({ providerRetry: retry({ nextAt: null }) }), status: null, statusUpdatedAt: null,
      onInterrupt: vi.fn(), onOpenTerminal: vi.fn(), onBack: vi.fn(), onChangeModel: vi.fn(), onChangeEffort: vi.fn(),
      onMoveAccount: vi.fn(), onArchive: vi.fn(), onRestore: vi.fn(), onOpenHistory: vi.fn(), onReapWorkspace: vi.fn(),
    };
    const { container } = render(<SessionHeaderHost {...props} />);
    expect(container.querySelector('.status-line')?.textContent).toBe('Provider overloaded, retry waiting');
  });
});

describe('the run row: in place of "turn failed" and "quiet"', () => {
  const QUIET = 2 * 3_600_000;
  const run = (state: 'failed' | 'done' | 'working', seenAgo: number): RunSummary => ({
    id: 1, program: 'program-a', programTitle: 'Program A', wave: 1, waveOf: 3, project: 'project-a', homeProject: null,
    sessionId: 'lane-a-project-a-still-pond', workspace: null, branch: null, state: 'working', claimedBy: 'coord-a', resumed: false,
    clearedAt: null, openedAt: NOW - 9_000_000, dispatchStartedAt: null, dispatchedAt: NOW - 8_000_000, closedAt: null, handoffCommit: null,
    items: { done: 0, total: 5 }, unreadMail: 0, workerLastSeen: NOW - seenAgo,
    workerLastTurn: { state, startedAt: NOW - seenAgo - 1, endedAt: NOW - seenAgo },
  } as RunSummary);
  it('outranks both, and is not drawn quiet', () => {
    expect(workerSeenNote(run('failed', 600_000), NOW, QUIET)).toMatchObject({ word: 'last seen 10m ago · turn failed' });
    expect(workerSeenNote(run('failed', 600_000), NOW, QUIET, s())).toMatchObject({ word: 'last seen 10m ago · Provider overloaded, retrying 14:52' });
    expect(workerSeenNote(run('done', 3 * 3_600_000), NOW, QUIET)).toMatchObject({ word: 'last seen 3h ago · quiet', quiet: true });
    const q = workerSeenNote(run('done', 3 * 3_600_000), NOW, QUIET, s())!;
    expect(q).toMatchObject({ word: 'last seen 3h ago · Provider overloaded, retrying 14:52', quiet: false });
    expect(q.title).toContain('ccrc tells the session to continue');
    expect(q.title).not.toContain('quiet time');
  });
  it('a worker that owes none, and an open turn, read as before', () => {
    expect(workerSeenNote(run('failed', 600_000), NOW, QUIET, s({ providerRetry: null }))).toMatchObject({ word: 'last seen 10m ago · turn failed' });
    expect(workerSeenNote(run('working', 600_000), NOW, QUIET, s())).toMatchObject({ word: 'last seen 10m ago · in a turn' });
  });
  it('the row and the run page read the worker\'s own session', async () => {
    const r = run('failed', 600_000);
    const WORD = 'last seen 10m ago · Provider overloaded, retrying 14:52';
    const { container } = render(<ul><RunRow run={r} nowMs={NOW} session={s()} quietMs={QUIET} /></ul>);
    expect(container.querySelector('.run-seen')?.textContent).toBe(WORD);
    cleanup();
    vi.spyOn(api, 'runRecord').mockResolvedValue({ ok: true, run: r, events: [], reviewedBy: [], olderEvents: 0 });
    for (const read of ['run', 'runItems', 'runSignals', 'goals'] as const) vi.spyOn(api, read).mockRejectedValue(new Error('offline'));
    const store = createFleetStore({ makeSocket: () => ({ close() {} }) as unknown as WebSocket });
    store.setState({ sessions: withRunBinding([s()], [r]), runs: [r] });
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    try { render(<RunDetailScreen id={1} store={store} />); } finally { vi.useRealTimers(); }
    const seen = await waitFor(() => { const e = document.querySelector('.rd-seen'); if (e === null) throw new Error('not drawn'); return e; });
    expect(seen.textContent).toBe(WORD);
    vi.restoreAllMocks();
  });
});
