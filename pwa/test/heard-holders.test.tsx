// What seven hand-written "heard" ternaries show, pinned on `main` before they moved onto `useHeard` (`fleet/useHeard.ts`), so the
// move is measured and not assumed: the programme box's Spec link and its waiting chip (two sites), the fleet screen's runs line,
// the mail screen's Lift cap door, the run page's Resume control and the runs board's "needs you" counts. Each surface is drawn
// in four states: NOT HEARD YET (the store holds rows and runs, as an offline snapshot would, and no frame has landed), HEARD
// (both frames landed, the link is open), LINK LOST (both frames landed, then the link went down; the flags are sticky, so it
// shows what heard shows) and A FIELD ABSENT FROM THE FRAME (a row that omits an optional wire field is drawn, never a crash).
// Where a site reads one flag only, or both, the mixed states that matter are pinned too.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import type { FleetSession, RunSummary } from '../../shared/api';
import { fleetTree } from '../src/fleet/fleetTree';
import { NO_ROLLUP_PREFS, rollupFleet } from '../src/fleet/rollup';
import { ProjectCard } from '../src/fleet/ProjectCard';
import { resetAcks } from '../src/lib/seen';
import { navigate } from '../src/lib/router';
import { clearScreenCache } from '../src/lib/screenCache';
import { api } from '../src/lib/api';
import { createFleetStore, useFleetStore, type FleetStore } from '../src/stores/fleet';
import { FleetScreen } from '../src/screens/FleetScreen';
import { MailScreen } from '../src/screens/MailScreen';
import { RunDetailScreen } from '../src/screens/RunDetailScreen';
import { RunsScreen } from './runs-board';
import { renderFleet } from './fleetHost';
import { fleetSession } from './fleetFixture';
import { itemView, runRow, waitingView } from './ledgersFixture';
import { withRunBinding } from './runBindingFixture';
import { HOUR, NOW, run as boxRun, sess } from './rollupFixture';

type StoreSlice = Partial<ReturnType<FleetStore['getState']>>;
type Heard = 'not-heard' | 'heard' | 'link-lost';

/** The frame flags and the link each state names. The rows a case hands the store are the SAME in all three. */
const link = (state: Heard): StoreSlice =>
  state === 'not-heard' ? { conn: 'connecting', linkLost: false, fleetFrameSeen: false, runsFrameSeen: false }
    : state === 'heard' ? { conn: 'open', linkLost: false, fleetFrameSeen: true, runsFrameSeen: true }
      : { conn: 'down', linkLost: true, fleetFrameSeen: true, runsFrameSeen: true };

const inert = (): WebSocket => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket;
const fresh = (): FleetStore => createFleetStore({ makeSocket: inert });

/** The app's singleton store before this file touched it, so every case leaves it as it found it (the programme box reads it). */
const SINGLETON_KEYS = ['sessions', 'runs', 'waiting', 'conn', 'linkLost', 'fleetFrameSeen', 'runsFrameSeen'] as const;
let saved: StoreSlice;

beforeEach(() => {
  window.localStorage.clear();
  resetAcks();
  clearScreenCache();
  navigate('/', { replace: true });
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
  vi.spyOn(api, 'updates').mockReturnValue(new Promise(() => {}));
  const s = useFleetStore.getState();
  saved = Object.fromEntries(SINGLETON_KEYS.map((k) => [k, s[k]]));
});
afterEach(() => {
  cleanup();
  act(() => useFleetStore.setState(saved));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});

/* ── 1-3. The programme box: its Spec link and its waiting chip ─────────────────────────────────────────────── */

describe('the programme box, in four states', () => {
  const SPEC = 'docs/superpowers/specs/2026-10-31-port-api-design.md';
  const goals = { program: 'port-api', specPath: SPEC, inShort: null, inShortAt: null, modifications: [] };

  /** The coordinator `coord` of project-c with a worker `w1` that asks the operator, as the box is drawn from. */
  function fleet(): { sessions: FleetSession[]; runs: RunSummary[] } {
    const coord = sess('coord', 'project-c', { role: 'coordinator', status: 'busy', bucket: 'working', bucketSince: NOW - 4 * HOUR });
    const w1 = sess('w1', 'project-c', { role: 'child', status: 'idle', dialogPending: true, bucket: 'attention', bucketSince: NOW - 3 * HOUR });
    const runs = [boxRun(10, 'coord', 'w1', { wave: 1, waveOf: 3, homeProject: 'project-a' })];
    return { sessions: withRunBinding([coord, w1], runs), runs };
  }

  /** The card drawn from the fleet's own rows (the tree is not what is under test); the singleton store is what the box reads. */
  function drawBox(): HTMLElement {
    const { sessions, runs } = fleet();
    const tree = fleetTree(withRunBinding(sessions, runs), [], runs);
    const g = tree.find((x) => x.project === 'project-c')!;
    const rollup = rollupFleet(tree, NO_ROLLUP_PREFS, NOW, null).cards.get('project-c');
    const { container } = render(
      <ProjectCard group={g} rollup={rollup} runs={g.runs} abroad={g.abroad} nowMs={NOW} boxNow={NOW}
        onOpen={() => {}} onActions={() => {}} onToggleChildren={() => {}} />,
    );
    return container;
  }

  const put = (slice: StoreSlice): void => { act(() => useFleetStore.setState(slice)); };
  const chip = (c: Element): HTMLElement | null => c.querySelector<HTMLElement>('.pg-kicker .pg-waiting, .pg-kicker .pg-waiting-plain');
  const specLink = (c: Element): HTMLElement | null => within(c as HTMLElement).queryByRole('link', { name: 'Spec for Port the API' });
  const OPEN2 = [100, 101].map((id) => itemView({ id, program: 'port-api' }));
  const SPEC_HREF = '/docs/project-a/specs/2026-10-31-port-api-design.md';

  describe('the Spec link (reads the runs flag alone)', () => {
    const rows = (): StoreSlice => ({ waiting: waitingView({ goals: [goals] }), sessions: fleet().sessions, runs: fleet().runs });

    it('not heard yet: no link, though the snapshot\'s runs name a home project (ungated, the link would show)', () => {
      put({ ...rows(), ...link('not-heard') });
      expect(specLink(drawBox())).toBeNull();
    });
    it('the fleet frame alone does not open it', () => {
      put({ ...rows(), ...link('heard'), runsFrameSeen: false });
      expect(specLink(drawBox())).toBeNull();
    });
    it('the runs frame alone does: the home project is the runs\'', () => {
      put({ ...rows(), ...link('heard'), fleetFrameSeen: false });
      expect(specLink(drawBox())!.getAttribute('href')).toBe(SPEC_HREF);
    });
    it('heard: the pinned spec in the home project\'s Docs', () => {
      put({ ...rows(), ...link('heard') });
      expect(specLink(drawBox())!.getAttribute('href')).toBe(SPEC_HREF);
    });
    it('link lost: the same link (the flags are sticky)', () => {
      put({ ...rows(), ...link('link-lost') });
      expect(specLink(drawBox())!.getAttribute('href')).toBe(SPEC_HREF);
    });
    it('a frame run that omits homeProject names no home, so no link; a sibling that names one supplies it', () => {
      const bare = [{ id: 11, program: 'port-api', state: 'working' }] as unknown as RunSummary[];
      put({ waiting: waitingView({ goals: [goals] }), runs: bare, ...link('heard') });
      expect(specLink(drawBox())).toBeNull();
      cleanup();
      put({ runs: [...bare, ...fleet().runs] });
      expect(specLink(drawBox())!.getAttribute('href')).toBe(SPEC_HREF);
    });
  });

  describe('the waiting chip (reads both flags)', () => {
    // Two open items of port-api, and one question: the asking worker's, filed under port-api by the run it is bound to.
    const rows = (): StoreSlice => ({ waiting: waitingView({ items: OPEN2 }), sessions: fleet().sessions, runs: fleet().runs });

    it('not heard yet: no chip, though the snapshot would count 3 (ungated)', () => {
      put({ ...rows(), ...link('not-heard') });
      expect(chip(drawBox())).toBeNull();
    });
    it('the runs frame alone: no chip, the fleet\'s rows are not heard', () => {
      put({ ...rows(), ...link('heard'), fleetFrameSeen: false });
      expect(chip(drawBox())).toBeNull();
    });
    it('the fleet frame alone: the items and the question\'s session count, but with no runs the question is in no programme: 2, not 3', () => {
      put({ ...rows(), ...link('heard'), runsFrameSeen: false });
      expect(chip(drawBox())!.textContent).toContain('2 waiting on you');
    });
    it('heard: 3 waiting on you', () => {
      put({ ...rows(), ...link('heard') });
      const c = chip(drawBox())!;
      expect(c.textContent).toContain('3 waiting on you');
      expect(c.getAttribute('aria-label')).toBe('3 waiting on you in Port the API');
    });
    it('link lost: the same 3 (the flags are sticky)', () => {
      put({ ...rows(), ...link('link-lost') });
      expect(chip(drawBox())!.getAttribute('aria-label')).toBe('3 waiting on you in Port the API');
    });
    it('rows that omit optional fields still count: a bare asking session and a bare run', () => {
      const w1 = { id: 'w1', bucket: 'attention' } as unknown as FleetSession;
      const r = { id: 10, program: 'port-api', state: 'working', claimedBy: 'w1' } as unknown as RunSummary;
      put({ waiting: waitingView({ items: OPEN2 }), sessions: [w1], runs: [r], ...link('heard') });
      expect(chip(drawBox())!.getAttribute('aria-label')).toBe('3 waiting on you in Port the API');
    });
  });
});

/* ── 4. The fleet screen's runs line ────────────────────────────────────────────────────────────────────────── */

describe('the fleet screen\'s runs line, in four states', () => {
  const RUNS = [1, 2, 3].map((id) => runRow({ id, program: 'prog-a', state: 'working' }));
  const line = (slice: StoreSlice): string => {
    const store = fresh();
    renderFleet(<FleetScreen store={store} />);
    act(() => { store.setState({ sessions: [fleetSession({ id: 'sess-a', project: 'project-a' })], runs: RUNS, ...slice }); });
    return screen.getByRole('button', { name: /^Runs · / }).getAttribute('aria-label') ?? '';
  };

  it('not heard yet: a dash, never the snapshot\'s "3 active" (ungated, it would count)', () => {
    expect(line(link('not-heard'))).toBe('Runs · —');
  });
  it('the fleet frame alone: still a dash', () => {
    expect(line({ ...link('heard'), runsFrameSeen: false })).toBe('Runs · —');
  });
  it('the runs frame alone: counted', () => {
    expect(line({ ...link('heard'), fleetFrameSeen: false })).toBe('Runs · 3 active');
  });
  it('heard: 3 active', () => {
    expect(line(link('heard'))).toBe('Runs · 3 active');
  });
  it('link lost: the same 3 active', () => {
    expect(line(link('link-lost'))).toBe('Runs · 3 active');
  });
  it('runs that omit optional fields are counted by the state they carry', () => {
    const bare = [{ id: 1, program: 'p', state: 'working' }, { id: 2, program: 'p', state: 'working' }] as unknown as RunSummary[];
    expect(line({ ...link('heard'), runs: bare })).toBe('Runs · 2 active');
  });
});

/* ── 5. The mail screen's Lift cap door ─────────────────────────────────────────────────────────────────────── */

describe('the mail screen\'s Lift cap door, in four states', () => {
  const capRun = (over: Partial<RunSummary> = {}): RunSummary => ({
    ...runRow({ id: 12, program: 'programme-a' }), state: 'awaiting-review',
    reviewCap: { rounds: 3, cap: 3, askedAt: 5, liftedAt: null, granted: 0, askHandledAt: null, coordLift: null }, ...over,
  }) as unknown as RunSummary;
  const notice = {
    seq: 9, at: Date.now() - 60_000, kind: 'run' as const, sessionId: '', runId: 12,
    title: 'Review cap reached on run 12', body: 'Lift the cap…',
  };
  const door = async (slice: StoreSlice): Promise<HTMLElement | null> => {
    const store = fresh();
    act(() => { store.setState(slice); });
    render(<MailScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    await screen.findByText(notice.title);
    return screen.queryByRole('button', { name: /lift cap/i });
  };

  // The screen reads the feed through the store's `refreshFeed`, so the store a case builds answers it.
  beforeEach(() => {
    vi.spyOn(api, 'feed').mockResolvedValue({ events: [notice] } as unknown as Awaited<ReturnType<typeof api.feed>>);
  });

  it('not heard yet: no door, though the snapshot holds the waiting run (ungated, the door would show)', async () => {
    expect(await door({ runs: [capRun()], ...link('not-heard') })).toBeNull();
  });
  it('heard: the door shows', async () => {
    expect(await door({ runs: [capRun()], ...link('heard') })).not.toBeNull();
  });
  it('link lost: the door stays (the flags are sticky)', async () => {
    expect(await door({ runs: [capRun()], ...link('link-lost') })).not.toBeNull();
  });
  it('the fleet frame alone does not open it; the runs frame alone does', async () => {
    expect(await door({ runs: [capRun()], ...link('heard'), runsFrameSeen: false })).toBeNull();
    cleanup();
    expect(await door({ runs: [capRun()], ...link('heard'), fleetFrameSeen: false })).not.toBeNull();
  });
  it('a run whose cap omits the optional fields (an older server) still carries the door', async () => {
    const bare = { id: 12, program: 'programme-a', state: 'awaiting-review', reviewCap: { rounds: 3, cap: 3, askedAt: 5, liftedAt: null } } as unknown as RunSummary;
    expect(await door({ runs: [bare], ...link('heard') })).not.toBeNull();
  });
});

/* ── 6. The run page's Resume control ───────────────────────────────────────────────────────────────────────── */

describe('the run page\'s Resume control, in four states', () => {
  const T0 = Date.UTC(2026, 10, 2, 11, 20);
  // A CLOSED run of a programme whose coordinator is gone: Resume shows when no wave of the programme is open.
  const closed = (over: Record<string, unknown> = {}): RunSummary => ({
    ...runRow({ id: 410, program: 'programme-a', claimedBy: 'coord-a' }),
    programTitle: 'Programme A', project: 'project-a', homeProject: 'project-a', openedAt: T0, dispatchedAt: T0 + 60_000,
    items: { done: 1, total: 3 }, unreadMail: 0, resumed: false, clearedAt: null, dispatchStartedAt: null, lastMoveAt: T0 + 120_000,
    state: 'done', closedAt: T0 + 3_600_000, coordinatorGone: true, ...over,
  }) as unknown as RunSummary;
  const OTHER_OPEN = runRow({ id: 500, program: 'programme-z' });          // an open wave of ANOTHER programme
  const SIBLING_OPEN = runRow({ id: 411, program: 'programme-a' });        // an open wave of THIS programme
  const GONE = { id: 'coord-a', project: 'project-a', role: 'coordinator', status: 'dead', lifecycle: 'orphan' } as const;

  const resume = async (r: RunSummary, slice: StoreSlice): Promise<HTMLElement | null> => {
    const store = fresh();
    act(() => { store.setState({ sessions: [fleetSession(GONE as never)], ...slice }); });
    vi.spyOn(api, 'runRecord').mockResolvedValue({ ok: true, run: r, events: [], reviewedBy: [], olderEvents: 0 });
    vi.spyOn(api, 'run').mockResolvedValue({ ok: true, run: r, spend: { measured: false, reason: 'no-sweep' } });
    vi.spyOn(api, 'runItems').mockResolvedValue({ ok: true, items: [] });
    vi.spyOn(api, 'runSignals').mockRejectedValue(new Error('none'));
    vi.spyOn(api, 'goals').mockRejectedValue(new Error('none'));
    render(<RunDetailScreen id={r.id} store={store} />);
    await screen.findByRole('heading', { level: 1, name: `Run ${r.id}` });
    return screen.queryByRole('button', { name: `Resume run ${r.id}` });
  };

  it('not heard yet: no Resume, though the snapshot holds no open wave of the programme (ungated, it would show)', async () => {
    expect(await resume(closed(), { runs: [OTHER_OPEN], ...link('not-heard') })).toBeNull();
  });
  it('the fleet frame alone: still none; the runs frame alone: shown', async () => {
    expect(await resume(closed(), { runs: [OTHER_OPEN], ...link('heard'), runsFrameSeen: false })).toBeNull();
    cleanup();
    expect(await resume(closed(), { runs: [OTHER_OPEN], ...link('heard'), fleetFrameSeen: false })).not.toBeNull();
  });
  it('heard: shown when the programme has no open wave, hidden beside an open one', async () => {
    expect(await resume(closed(), { runs: [OTHER_OPEN], ...link('heard') })).not.toBeNull();
    cleanup();
    expect(await resume(closed(), { runs: [OTHER_OPEN, SIBLING_OPEN], ...link('heard') })).toBeNull();
  });
  it('link lost: the same answers as heard', async () => {
    expect(await resume(closed(), { runs: [OTHER_OPEN], ...link('link-lost') })).not.toBeNull();
    cleanup();
    expect(await resume(closed(), { runs: [OTHER_OPEN, SIBLING_OPEN], ...link('link-lost') })).toBeNull();
  });
  it('a record without coordinatorGone (an older server) reads the coordinator\'s presence, and bare frame runs are tolerated', async () => {
    const older = closed();
    delete (older as { coordinatorGone?: boolean }).coordinatorGone;
    const bare = [{ id: 500, program: 'programme-z', state: 'working' }] as unknown as RunSummary[];
    expect(await resume(older, { runs: bare, ...link('heard') })).not.toBeNull();
  });
});

/* ── 7. The runs board's "needs you" counts ─────────────────────────────────────────────────────────────────── */

describe('the runs board\'s "needs you" counts, in four states', () => {
  const NO_CAPS = (): Promise<never> => new Promise<never>(() => {});
  const runA = runRow({ id: 1, program: 'prog-a', claimedBy: 'sess-a', openedAt: Date.now() - 1_000_000 });
  const ASKING = fleetSession({ id: 'sess-a', project: 'project-a', bucket: 'attention' });
  // One open item of prog-a, and one question: the asking session claims run 1, which files it under prog-a.
  const rows = (): StoreSlice => ({ runs: [runA], sessions: [ASKING], waiting: waitingView({ items: [itemView({ id: 1, program: 'prog-a', runId: 1 })] }) });

  const marker = async (slice: StoreSlice): Promise<string | null> => {
    const store = fresh();
    act(() => { store.setState(slice); });
    render(<RunsScreen store={store} loadCaps={NO_CAPS} />);
    await act(async () => { await Promise.resolve(); });
    const card = document.querySelector<HTMLElement>('[data-programme="prog-a"]');
    if (card === null) return '(no card)';
    return within(card).queryByRole('link', { name: /^needs you/ })?.textContent ?? null;
  };

  // Without a runs frame the board lists no open programme at all (`noSignalYet`), so the cards, and with them the markers, are
  // not drawn in either runs-less state; the fleet flag's own gate is seen in the runs-frame-alone case below.
  it('not heard yet: no card is drawn, so no marker (the snapshot\'s runs are not listed as open)', async () => {
    expect(await marker({ ...rows(), ...link('not-heard') })).toBe('(no card)');
  });
  it('the runs frame alone (the fleet\'s rows not heard): the card is drawn with no marker (ungated, it would read "needs you · 2")', async () => {
    expect(await marker({ ...rows(), ...link('heard'), fleetFrameSeen: false })).toBeNull();
  });
  it('the fleet frame alone: no card is drawn, so no marker', async () => {
    expect(await marker({ ...rows(), ...link('heard'), runsFrameSeen: false })).toBe('(no card)');
  });
  it('heard: needs you · 2', async () => {
    expect(await marker({ ...rows(), ...link('heard') })).toBe('needs you · 2');
  });
  it('link lost: the same needs you · 2', async () => {
    expect(await marker({ ...rows(), ...link('link-lost') })).toBe('needs you · 2');
  });
  it('rows that omit optional fields still count: a bare asking session and a bare run', async () => {
    const w = { id: 'sess-a', bucket: 'attention' } as unknown as FleetSession;
    const r = { id: 1, program: 'prog-a', state: 'working', claimedBy: 'sess-a', project: 'project-a' } as unknown as RunSummary;
    expect(await marker({ ...rows(), runs: [r], sessions: [w], ...link('heard') })).toBe('needs you · 2');
  });
});
