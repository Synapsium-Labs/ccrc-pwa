// C9 / D-6441: the fleet list re-renders what changed and nothing else.
//
// Two counters, each a stand-in that calls the real module, so nothing about what renders changes:
// - `sessionFacts` (SessionLine's one model, called once per SessionLine render) counts the session lines;
// - `ProjectCardHead` (rendered exactly when its `ProjectCard` renders) counts the project cards.
// Frames arrive through the store's OWN socket path (a fake socket, `connect()`, a JSON message, so every frame carries
// fresh objects and `keepRows` is in the loop), as `render-fanout.test.tsx` drives them.
//
// The fleet: 20 rows (`ws-a` … `ws-t`) on four projects, one lane. project-a holds a coordinator with one child under
// an active run; project-b a coordinator whose dispatch is spawning (when the case asks for it); project-c two workers
// whose coordinator is gone; project-d five quiet rows, rolled up. Every other row is working, so its status group is
// open in Instrument's status mode and its card is open in Refined.
//
// `CCRC_MEASURE=1` adds the jsdom bench (80 rows, one changed per frame, a React Profiler around the list): no
// assertion, one console line per list, for the PR body.
import { Profiler, createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { FleetSession, RunSummary } from '../../shared/api';
import { api } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { resetAcks } from '../src/lib/seen';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { useFleetChrome } from '../src/fleet/FleetChrome';
import { useFleetFlows } from '../src/fleet/FleetFlows';
import { FleetScreen } from '../src/screens/FleetScreen';
import { FleetTable, GROUP_MODE_KEY } from '../src/skins/instrument/FleetTable';
import { renderFleet } from './fleetHost';
import { fleetSession } from './fleetFixture';

const probe = vi.hoisted(() => ({ lines: [] as string[], heads: [] as string[] }));

vi.mock('../src/fleet/sessionFacts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/fleet/sessionFacts')>();
  return {
    ...real,
    sessionFacts: (input: Parameters<typeof real.sessionFacts>[0]) => {
      probe.lines.push(input.session.id);
      return real.sessionFacts(input);
    },
  };
});

vi.mock('../src/fleet/ProjectCardHead', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/fleet/ProjectCardHead')>();
  const { createElement: h } = await import('react');
  return {
    ...real,
    ProjectCardHead: (props: Parameters<typeof real.ProjectCardHead>[0]) => {
      probe.heads.push(props.group.project);
      return h(real.ProjectCardHead, props);
    },
  };
});

// — the fleet: neutral names —

const NOW = 1_800_000_000_000;
const MIN = 60_000;

const row = (id: string, project: string, over: Partial<FleetSession> = {}): FleetSession => fleetSession({
  id, wrapper: 'lane-a', home: 'lane-a', project, workdir: `/w/${project}/${id}`, workspace: id, name: `task ${id}`,
  status: 'busy', bucket: 'working', statusUpdatedAt: NOW - 5 * MIN, bucketSince: NOW - 5 * MIN, ...over,
});

/** A row of the quiet project: idle, last changed 40 minutes ago, so its card rolls up (D-6088 rule 2). */
const quiet = (id: string): FleetSession =>
  row(id, 'project-d', { status: 'idle', bucket: 'idle', statusUpdatedAt: NOW - 40 * MIN, bucketSince: NOW - 40 * MIN });

const FLEET: readonly FleetSession[] = [
  row('ws-a', 'project-a', { role: 'coordinator', name: 'the coordinator' }),
  row('ws-b', 'project-a', { role: 'child', child: { kind: 'child', runId: 41 } }),
  row('ws-c', 'project-a'), row('ws-d', 'project-a'), row('ws-e', 'project-a'),
  row('ws-f', 'project-b', { role: 'coordinator', name: 'the spawning coordinator' }),
  row('ws-g', 'project-b'), row('ws-h', 'project-b'), row('ws-i', 'project-b'), row('ws-j', 'project-b'),
  row('ws-k', 'project-c', { role: 'child', child: { kind: 'child', runId: 43 } }),
  row('ws-l', 'project-c', { role: 'child', child: { kind: 'child', runId: 44 } }),
  row('ws-m', 'project-c'), row('ws-n', 'project-c'), row('ws-o', 'project-c'), row('ws-p', 'project-c'),
  quiet('ws-q'), quiet('ws-r'), quiet('ws-s'), quiet('ws-t'),
];

const run = (id: number, claimedBy: string, sessionId: string | null, project: string, over: Partial<RunSummary> = {}): RunSummary => ({
  id, program: 'port-api', programTitle: 'Port the API', wave: 1, waveOf: 3,
  project, homeProject: project, sessionId, workspace: sessionId, branch: null,
  state: 'working', kind: 'work', reviews: null, claimedBy, resumed: false, clearedAt: null,
  openedAt: NOW - 60 * MIN, dispatchStartedAt: null, dispatchedAt: NOW - 50 * MIN, closedAt: null, handoffCommit: null,
  items: { done: 0, total: 0 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null,
            briefQueued: true, clearError: null, coordKickoffPendingSince: null }, childReclaim: null, reviewCap: null,
  ...over,
});

/** The active runs: ws-b under ws-a, and two workers whose coordinator (`ws-gone`) left the fleet. */
const RUNS: readonly RunSummary[] = [
  run(41, 'ws-a', 'ws-b', 'project-a'),
  run(43, 'ws-gone', 'ws-k', 'project-c'),
  run(44, 'ws-gone', 'ws-l', 'project-c'),
];

/** ws-f's dispatch, spawning for 42 seconds: a pending child on project-b's card, with a readout to the second. */
const SPAWNING = run(42, 'ws-f', null, 'project-b', {
  state: 'planned', workspace: null, dispatchStartedAt: NOW - 42_000, dispatchedAt: null,
});

// — the store, driven through its own socket —

class FakeSocket {
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  close(): void {}
  open(): void { this.onopen?.(new Event('open')); }
  message(data: unknown): void { this.onmessage?.({ data } as MessageEvent); }
}

interface Driven {
  store: FleetStore;
  /** One `fleet` frame: the rows are serialised and parsed again, so every frame carries FRESH objects. */
  sendRows: (sessions: readonly FleetSession[]) => void;
  sendRuns: (runs: readonly RunSummary[]) => void;
}

const never = <T,>(): Promise<T> => new Promise<T>(() => {});

const opened: FleetStore[] = [];

const driven = (rows: readonly FleetSession[], runs: readonly RunSummary[]): Driven => {
  const sockets: FakeSocket[] = [];
  const store = createFleetStore({
    makeSocket: () => { const s = new FakeSocket(); sockets.push(s); return s as unknown as WebSocket; },
    catchUp: () => never(),
    fetchFeed: () => never(),
    fetchAccounts: () => never(),
  });
  opened.push(store);
  store.getState().connect();
  const sock = sockets[0];
  if (sock === undefined) throw new Error('the store opened no socket');
  act(() => { sock.open(); });
  const d: Driven = {
    store,
    sendRows: (sessions) => { act(() => { sock.message(JSON.stringify({ type: 'fleet', sessions })); }); },
    sendRuns: (r) => { act(() => { sock.message(JSON.stringify({ type: 'runs', runs: r })); }); },
  };
  d.sendRows(rows);
  d.sendRuns(runs);
  return d;
};

/** The same fleet with one row renamed: a frame that changes exactly that row. */
const renamed = (rows: readonly FleetSession[], id: string): FleetSession[] =>
  rows.map((s) => (s.id === id ? { ...s, name: `renamed ${id}` } : s));

/** The chrome's own planes, held open, and `/api/projects` answered with no rows, so every card's placement is a
 *  measured `missing`: `placementOfRow` builds that read afresh on every call, which is what `sameCardProps` gates. */
const holdApis = (): void => {
  vi.spyOn(api, 'accounts').mockReturnValue(never());
  vi.spyOn(api, 'fleetHealth').mockReturnValue(never());
  vi.spyOn(api, 'updates').mockReturnValue(never());
  vi.spyOn(api, 'projects').mockResolvedValue({ roots: [], projects: [] });
  vi.stubGlobal('fetch', vi.fn(() => never<Response>()));
};

/** A desk, so Instrument's status table draws its groups without phone tabs. */
const stubDesk = (): void => {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('min-width: 900px') || q.includes('pointer: fine'),
    media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }));
};

/** Lets `/api/projects`' answer land, so the cards read a ready placement before anything is counted. */
const settle = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

/** Opens the New session sheet through the chrome, as the screen's own door does, and says whether it is open. */
function SheetDoor(): ReactNode {
  const flows = useFleetFlows();
  const open = useFleetChrome().newOpen;
  return <button type="button" data-testid="sheet-door" data-open={String(open)} onClick={flows.openNewSession}>open</button>;
}

const resetProbe = (): void => { probe.lines.length = 0; probe.heads.length = 0; };

beforeEach(() => {
  window.localStorage.clear();
  resetAcks();
  navigate('/');
  holdApis();
  stubDesk();
  resetProbe();
  // The fleet's clock: every timestamp above is relative to NOW, so the rollup reads project-d as quiet. The cases
  // about a timer fake the timers too.
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});

afterEach(() => {
  cleanup();
  for (const s of opened.splice(0)) s.getState().disconnect();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  navigate('/');
});

/** Refined's list: `FleetScreen` over the shared cards. */
const mountScreen = async (runs: readonly RunSummary[]): Promise<Driven> => {
  const d = driven(FLEET, runs);
  renderFleet(<><FleetScreen store={d.store} /><SheetDoor /></>, d.store);
  await settle();
  return d;
};

/** Instrument's status table, the mode the toggle starts in. */
const mountStatus = async (runs: readonly RunSummary[]): Promise<Driven> => {
  window.localStorage.setItem(GROUP_MODE_KEY, 'status');
  const d = driven(FLEET, runs);
  renderFleet(<FleetTable />, d.store);
  await settle();
  return d;
};

const cardOf = (project: string): HTMLElement => {
  const name = screen.getAllByText(project).find((el) => el.classList.contains('proj-card-name'));
  const card = name?.closest('section');
  if (!card) throw new Error(`no card ${project}`);
  return card as HTMLElement;
};

describe('the 1 s countdown of a spawning dispatch reaches only its readout (C9, D-6441)', () => {
  const mountSpawning = async (): Promise<void> => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    await mountScreen([...RUNS, SPAWNING]);
    // The mount is real: both counters fired, and the readout is on project-b's card.
    expect(probe.lines.length).toBeGreaterThan(0);
    expect(probe.heads.length).toBeGreaterThan(0);
    expect(within(cardOf('project-b')).getByText('0:42')).toBeTruthy();
  };

  it('the 1 s countdown re-renders no SessionLine', async () => {
    await mountSpawning();
    resetProbe();
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(within(cardOf('project-b')).getByText('0:45')).toBeTruthy();
    expect(probe.lines).toEqual([]);
  });

  it('the 1 s countdown re-renders no ProjectCard', async () => {
    await mountSpawning();
    resetProbe();
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(within(cardOf('project-b')).getByText('0:45')).toBeTruthy();
    expect(probe.heads).toEqual([]);
  });
});

describe('a one-row frame re-renders one SessionLine (C9, D-6441)', () => {
  it('a one-row frame re-renders one SessionLine, through FleetScreen', async () => {
    const d = await mountScreen(RUNS);
    // Every row with a run is drawn, so their run doors and child labels are in the count.
    for (const id of ['ws-b', 'ws-e', 'ws-k', 'ws-l']) expect(probe.lines).toContain(id);
    resetProbe();
    d.sendRows(renamed(FLEET, 'ws-e'));
    expect(screen.getByRole('button', { name: 'Actions for renamed ws-e' })).toBeTruthy();
    expect(probe.lines).toEqual(['ws-e']);
  });

  it('a one-row frame re-renders one SessionLine, through StatusTable', async () => {
    const d = await mountStatus(RUNS);
    for (const id of ['ws-b', 'ws-e', 'ws-k', 'ws-l']) expect(probe.lines).toContain(id);
    resetProbe();
    d.sendRows(renamed(FLEET, 'ws-e'));
    expect(screen.getByRole('button', { name: 'Actions for renamed ws-e' })).toBeTruthy();
    expect(probe.lines).toEqual(['ws-e']);
  });
});

describe('a chrome change with the same fleet (C9, D-6441)', () => {
  it('a chrome change with the same fleet re-renders no ProjectCard', async () => {
    await mountScreen(RUNS);
    expect(probe.heads).toEqual(expect.arrayContaining(['project-a', 'project-b', 'project-c', 'project-d']));
    const door = screen.getByTestId('sheet-door');
    expect(door.getAttribute('data-open')).toBe('false');
    resetProbe();
    fireEvent.click(door);
    expect(door.getAttribute('data-open')).toBe('true');
    expect(probe.heads).toEqual([]);
    expect(probe.lines).toEqual([]);
  });
});

describe('a folded card\'s last-active readout (C9, D-6441)', () => {
  it('a folded card\'s \'active … ago\' advances with no fleet frame', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    await mountScreen(RUNS);
    const card = cardOf('project-d');
    expect(card.getAttribute('data-collapsed')).toBe('true');
    expect(within(card).getByText('active 40m ago')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(3 * MIN); });
    expect(within(cardOf('project-d')).getByText('active 43m ago')).toBeTruthy();
  });
});

// — the jsdom bench (CCRC_MEASURE=1): what one changed row costs the list —

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** 80 rows on 15 projects, a third of them working: the browser fixture's proportions (`browser/app.ts`). */
const benchFleet = (n: number): FleetSession[] => Array.from({ length: n }, (_, i) => {
  const working = i % 3 === 0;
  return row(`ws-${i}`, `project-${String.fromCharCode(97 + (i % 15))}`, {
    status: working ? 'busy' : 'idle', bucket: working ? 'working' : 'idle', statusUpdatedAt: Date.now() - (60 + i * 37) * 1000,
  });
});

describe.runIf(process.env.CCRC_MEASURE === '1')('measurement: the jsdom bench (80 rows, one changed per frame)', () => {
  const FRAMES = 15;
  for (const list of ['FleetScreen', 'StatusTable'] as const) {
    it(`${list}: the median render of a one-row frame`, async () => {
      const base = benchFleet(80);
      if (list === 'StatusTable') window.localStorage.setItem(GROUP_MODE_KEY, 'status');
      const d = driven(base, []);
      const took: number[] = [];
      let frame = 0;
      const onRender = (_id: string, _phase: string, actual: number): void => { if (frame > 0) took[frame - 1] = (took[frame - 1] ?? 0) + actual; };
      const inner = list === 'FleetScreen' ? <FleetScreen store={d.store} /> : <FleetTable />;
      renderFleet(createElement(Profiler, { id: list, onRender }, inner), d.store);
      await settle();
      let rows = base;
      const commits: number[] = [];
      for (frame = 1; frame <= FRAMES; frame += 1) {
        const id = `ws-${(frame * 7) % 80}`;
        rows = rows.map((s) => (s.id === id ? { ...s, name: `task ${id} @${frame}` } : s));
        const t0 = performance.now();
        d.sendRows(rows);
        commits.push(performance.now() - t0);
      }
      console.log(`C9 bench ${list}: render median ${median(took).toFixed(2)} ms, frame (render + commit) median ${median(commits).toFixed(2)} ms over ${FRAMES} one-row frames at 80 rows`);
    });
  }
});
