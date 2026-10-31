// The run-to-session readers over the #746 fixture (D-7179; Task C7a Step 4; plan
// docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md, item 3 and its lookup table; ARCH-61, D-7205, D-7207).
// Written green on the old code, before C7d moves any reader: a closed-run row's verdict is pinned before C7d moves it.
//
// THE READERS, each through its own code: `runForSession` and `runBelongsTo` (the fleet's, retired by C7d and kept
// below as the record of the guess), the four inline matchers
// (`sessionEntries`' claimed programmes, `ArchiveSheet`'s claimed open runs, `runBelongsTo`'s id rule, `PrSheet`'s open
// run on the workspace), and the seven run-to-session map lookups: `RunsScreen`'s three (the abandon sheet's
// `sessionById.get(abandonTarget.sessionId)`, read through the child word the sheet is handed, and each row's worker and
// claimant, read off the props the screen hands `RunRow`, whose real Resume door is rendered), `runWords.ts#runCard`'s
// two, `nestFleet`'s `attentionFirst` (through the ORDER of a coordinator's children, its own block below: a card and
// a depth do not show it) and `fleetTree`'s filter lookup (through `fleetTree`'s rows). Beside them, the
// wire's own facts: `sessionRunOf(s)`, `sessionRunOf(s, 'open')` and `childIdsOf(run)`.
//
// THE ROWS: two runs naming one worker; a recycled id as a worker and as a coordinator; the open-vs-newest pair; a closed
// run of a live session as its worker and as its coordinator; an older closed run of a live session beside its newer
// bound run; and the four ordinary open runs `childIds` does not describe (planned with `sessionId: null`, an undecidable
// binding, empty `childIds` on an unlistable tick, no `childIds` key). Each row pins today's worker, today's coordinator
// (`coordSession`), `RunRow`'s `coordinatorPresence` (the `coordPresence` column) and whether the Resume door shows, and names the question it asks.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { childIdsOf, sessionRunOf, UNCHECKED_PR, type CoordCapsView, type FleetSession, type RunSpend, type RunSummary, type SessionRun } from '../../shared/api';
import { fleetSession } from './fleetFixture';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { childMarkOf, runCard } from '../src/fleet/runWords';

/** THE RETIRED GUESS, kept as the record this table was judged against (C7d deletes `runForSession` and
 *  `runBelongsTo` from `pwa/src`, D-7182). Before ARCH-61 the PWA guessed which run was a session's from the run's id
 *  and the session's `.child` mark; the `runForSession` and `runBelongsTo` columns below keep what that guess answered,
 *  byte for byte, beside the wire's own facts, so every C7d behaviour row stays readable as "the guess said X, the
 *  wire says Y". No `pwa/src` file reads it. */
const runBelongsTo = (run: { id: number; sessionId: string | null }, session: { id: string; child?: FleetSession['child'] }): boolean => {
  if (run.sessionId !== session.id) return false;
  const mark = childMarkOf(session);
  return mark.kind !== 'child' || run.id >= mark.runId;
};
const runForSession = (runs: readonly RunSummary[], session: { id: string; child?: FleetSession['child'] }): RunSummary | null => {
  let current: RunSummary | null = null;
  for (const r of runs) if (runBelongsTo(r, session) && (current === null || r.id > current.id)) current = r;
  return current;
};
import { cardsOf, fleetTree } from '../src/fleet/fleetTree';
import { nestFleet, type FleetRow } from '../src/fleet/nestFleet';
import { coordinatorPresence } from '../src/fleet/presence';
import { sessionEntries } from '../src/command/sessionEntries';
import { ArchiveSheet } from '../src/fleet/ArchiveSheet';
import { PrSheet } from '../src/session/PrSheet';
import type { AbandonChild } from '../src/fleet/AbandonSheet';

/** What `RunsScreen` hands each `RunRow` and the abandon sheet, recorded beside the real components (the screen is
 *  read through its own lookups; nothing it renders is replaced). */
const seen = vi.hoisted(() => ({ rows: [] as Array<{ run: number; session: string | null; coord: string | null }>, abandon: [] as AbandonChild[] }));
vi.mock('../src/screens/RunRow', async (orig) => {
  const m = await orig<typeof import('../src/screens/RunRow')>();
  const { createElement: h } = await import('react');
  const Spy = (p: Parameters<typeof m.RunRow>[0]) => {
    seen.rows.push({ run: p.run.id, session: p.session?.id ?? null, coord: p.coordSession?.id ?? null });
    return h(m.RunRow, p);
  };
  return { ...m, RunRow: Spy };
});
vi.mock('../src/fleet/AbandonSheet', async (orig) => {
  const m = await orig<typeof import('../src/fleet/AbandonSheet')>();
  const { createElement: h } = await import('react');
  const Spy = (p: Parameters<typeof m.AbandonSheet>[0]) => {
    if (p.run !== null) seen.abandon.push(p.workspaceChild ?? 'unknown');
    return h(m.AbandonSheet, p);
  };
  return { ...m, AbandonSheet: Spy };
});
const { RunsScreen } = await import('../src/screens/RunsScreen');

const W = 'session-a';
const C = 'coord-a';
const NO_CAPS = (): Promise<CoordCapsView> => new Promise<CoordCapsView>(() => {});
const NO_SPEND = (): Promise<RunSpend> => new Promise<RunSpend>(() => {});

const run = (id: number, over: Partial<RunSummary> = {}): RunSummary => ({
  id, program: `program-${id}`, programTitle: `Program ${id}`, wave: 1, waveOf: 2, project: 'project-a', homeProject: null,
  sessionId: W, workspace: 'ws-a', branch: 'ws/ws-a', state: 'working', kind: 'work', reviews: null,
  claimedBy: C, resumed: false, clearedAt: null, openedAt: 1, dispatchStartedAt: null, dispatchedAt: 1, closedAt: null,
  handoffCommit: null, items: { done: 0, total: 1 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: true, clearError: null, coordKickoffPendingSince: null },
  childReclaim: null, reviewCap: null, ...over,
});
const closed = (id: number, over: Partial<RunSummary> = {}): RunSummary => run(id, { state: 'done', closedAt: 2, ...over });
const bound = (r: RunSummary): SessionRun => ({ id: r.id, state: r.state, claimedBy: r.claimedBy });

const worker = (over: Partial<FleetSession> = {}): FleetSession => fleetSession({
  id: W, project: 'project-a', workspace: 'ws-a', workdir: '/w/ws-a', role: 'child', child: { kind: 'child', runId: 10 }, ...over,
});
const coord = (over: Partial<FleetSession> = {}): FleetSession => fleetSession({
  id: C, project: 'project-a', workspace: null, workdir: '/w/project-a', role: 'coordinator', status: 'idle', bucket: 'idle', lifecycle: 'running', ...over,
});
/** A dead coordinator, the Resume door's case: gone and not coming back. */
const deadCoord = (over: Partial<FleetSession> = {}): FleetSession => coord({ status: 'dead', bucket: 'dead', lifecycle: 'orphan', ...over });

interface Scenario {
  readonly name: string;
  /** The question each focus row asks (item 3's table). */
  readonly question: string;
  readonly sessions: readonly FleetSession[];
  /** The live slice (open runs) and the cold slice (the closed read). */
  readonly live: readonly RunSummary[];
  readonly cold: readonly RunSummary[];
  /** The runs this scenario pins, by id. */
  readonly focus: readonly number[];
}

const r10 = run(10), r11 = run(11);
const SCENARIOS: readonly Scenario[] = [
  { name: 'two runs naming one worker', question: 'which live session is this open run\'s worker',
    sessions: [worker({ run: bound(r11), openRun: bound(r11) }), deadCoord()], live: [r10, r11], cold: [], focus: [10, 11] },
  { name: 'a recycled id, as a worker (#746: a run opened before the workspace\'s own run)', question: 'which live session is this open run\'s worker',
    sessions: [worker({ child: { kind: 'child', runId: 504 }, run: null, openRun: null }), deadCoord()],
    live: [run(83, { state: 'planned', resumed: true })], cold: [], focus: [83] },
  { name: 'a recycled id, as a coordinator (no wire fact binds the claimant\'s incarnation)', question: 'which listed session carries the claimant id',
    sessions: [worker({ run: bound(run(12)), openRun: bound(run(12)) }), coord()],
    live: [run(12, { childIds: [] })], cold: [], focus: [12] },
  { name: 'the open-vs-newest pair (a newer run closed while an older one is open)', question: 'open: which live session is this open run\'s worker; closed: which listed session carries this id',
    sessions: [worker({ run: bound(closed(21)), openRun: bound(run(20)) }), deadCoord()], live: [run(20)], cold: [closed(21)], focus: [20, 21] },
  { name: 'a closed run of a live session, as its worker', question: 'which listed session carries this id (the named by-id arm, D-7205)',
    sessions: [worker({ run: bound(closed(30)), openRun: null }), deadCoord()], live: [], cold: [closed(30)], focus: [30] },
  { name: 'a closed run of a live session, as its coordinator', question: 'which listed session carries the claimant id (D-7207)',
    sessions: [worker({ id: 'worker-b', workspace: 'ws-b', run: null, openRun: null }), deadCoord()], live: [], cold: [closed(31, { sessionId: 'worker-b', workspace: 'ws-b' })], focus: [31] },
  { name: 'an older closed run of a live session, beside its newer bound run', question: 'closed: which listed session carries this id; open: its worker by binding',
    sessions: [worker({ run: bound(run(41)), openRun: bound(run(41)) }), deadCoord()], live: [run(41)], cold: [closed(40)], focus: [40, 41] },
  { name: 'an open planned run with sessionId null', question: 'which listed session carries the claimant id',
    sessions: [worker({ run: null, openRun: null }), deadCoord()], live: [run(50, { sessionId: null, workspace: null, branch: null, state: 'planned' })], cold: [], focus: [50] },
  { name: 'an open run whose worker binding is undecidable (no run key on the worker)', question: 'which live session is this open run\'s worker',
    sessions: [worker({}), deadCoord()], live: [run(51)], cold: [], focus: [51] },
  { name: 'an open run on a tick whose childIds are empty (the registry was unlistable)', question: 'which live session is this open run\'s worker',
    sessions: [worker({ run: bound(run(52)), openRun: bound(run(52)) }), deadCoord()], live: [run(52, { childIds: [] })], cold: [], focus: [52] },
  { name: 'an open run with no childIds key (an emitter that does not compute it)', question: 'which live session is this open run\'s worker',
    sessions: [worker({ run: bound(run(53)), openRun: bound(run(53)) }), deadCoord()], live: [run(53)], cold: [], focus: [53] },
];

const makeStore = (sc: Scenario): FleetStore => {
  const store = createFleetStore({ makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket });
  act(() => { store.setState({ sessions: [...sc.sessions], runs: [...sc.live], runsFrameSeen: true, fleetFrameSeen: true }); });
  return store;
};

/** `RunsScreen`'s three lookups for one scenario: each row's worker and claimant, the Resume doors, and the abandon
 *  sheet's child word for each open focus run. */
async function board(sc: Scenario): Promise<{ rows: Map<number, { session: string | null; coord: string | null; resume: boolean }>; abandon: Map<number, AbandonChild> }> {
  seen.rows.length = 0;
  seen.abandon.length = 0;
  const store = makeStore(sc);
  render(createElement(RunsScreen, { store, loadRuns: async () => ({ runs: [...sc.cold] }), loadCaps: NO_CAPS, loadSpend: NO_SPEND }));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  const rows = new Map<number, { session: string | null; coord: string | null; resume: boolean }>();
  for (const id of sc.focus) {
    const last = [...seen.rows].reverse().find((x) => x.run === id);
    rows.set(id, { session: last?.session ?? null, coord: last?.coord ?? null, resume: screen.queryByRole('button', { name: `Resume run ${id}` }) !== null });
  }
  const abandon = new Map<number, AbandonChild>();
  for (const id of sc.focus) {
    const door = screen.queryByRole('button', { name: `Abandon run ${id}` });
    if (door === null) continue;
    seen.abandon.length = 0;
    fireEvent.click(door);
    abandon.set(id, seen.abandon[seen.abandon.length - 1] ?? 'unknown');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  }
  cleanup();
  return { rows, abandon };
}

/** `ArchiveSheet`'s matcher: the open runs it says the claimant still holds (its programme question), or 0. */
function archiveAsks(sc: Scenario, sessionId: string): number {
  const session = sc.sessions.find((s) => s.id === sessionId) ?? null;
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })));
  render(createElement(ArchiveSheet, { session, open: true, onClose: () => {}, fleet: makeStore(sc) }));
  const m = /It has (\d+) open runs?\. End its programme too\?/.exec(document.body.textContent ?? '');
  cleanup();
  vi.unstubAllGlobals();
  return m === null ? 0 : Number(m[1]);
}

/** `PrSheet`'s matcher: the open run it says is still on the workspace (a merged, unarchived PR), or null. */
function prOpenRun(sc: Scenario): number | null {
  const w = sc.sessions.find((s) => s.id === W);
  if (w === undefined) return null;
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })));
  render(createElement(PrSheet, { session: { ...w, pr: { ...UNCHECKED_PR, phase: 'merged', number: 12 } }, open: true, onClose: () => {}, onReap: () => {}, fleet: makeStore(sc) }));
  const m = /Run (\d+) \([^)]*\) is still open on this workspace/.exec(document.body.textContent ?? '');
  cleanup();
  vi.unstubAllGlobals();
  return m === null ? null : Number(m[1]);
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });


/** Every pinned fact of one focus row. */
async function rowFacts(sc: Scenario): Promise<Record<number, Record<string, unknown>>> {
  const b = await board(sc);
  const runs = [...sc.live, ...sc.cold];
  const all = sc.live;
  const w = sc.sessions.find((s) => s.id === W || s.id === 'worker-b')!;
  const out: Record<number, Record<string, unknown>> = {};
  const cards = cardsOf(sc.sessions);
  const tree = fleetTree([...sc.sessions], ['project-a'], all, {});
  const treeRow = (id: string): string => {
    for (const g of tree) for (const row of g.rows) if (row.kind === 'session' && row.session.id === id) return `${g.project}:depth${row.depth}`;
    return 'none';
  };
  for (const id of sc.focus) {
    const r = runs.find((x) => x.id === id)!;
    const row = b.rows.get(id)!;
    const coordSession = sc.sessions.find((s) => s.id === row.coord) ?? null;
    out[id] = {
      question: sc.question,
      wire: { sessionRunOf: sessionRunOf(w)?.id ?? null, openRunOf: sessionRunOf(w, 'open')?.id ?? null, childIds: r.childIds === undefined ? 'absent' : childIdsOf(r) },
      runForSession: runForSession(all, w)?.id ?? null,
      runBelongsTo: runBelongsTo(r, w),
      worker: row.session,
      coordSession: row.coord,
      coordPresence: coordinatorPresence(r.claimedBy, coordSession, true),
      resumeDoor: row.resume,
      abandonChild: b.abandon.get(id) ?? '-',
      runCard: runCard(r, cards),
      paletteClaims: (sessionEntries(sc.sessions, all, 'page').find((e) => e.id === `open-session-${C}`)!.terms ?? []).includes(r.program),
      treeRow: treeRow(w.id),
    };
  }
  return out;
}

describe('the run binding table (#746 fixture): today\'s readers, row by row', () => {
  // C7d's behaviour rows, OA-C15 (a) (D-7265), each marked where it differs from the pins C7a wrote green on the old
  // code: an OPEN run's worker is the session the wire binds to it, so the run row (`worker`: W before) and the abandon
  // sheet find no worker for run 10 of "two runs naming one worker" (the worker's binding names 11), for the recycled
  // id (83) and for the undecidable binding (51), and the sheet hedges ('unknown'; 'child' before). Every closed run's
  // row, every coordinator, `coordPresence` and every Resume door is today's.
  const PINS: Record<string, unknown> = {
    'two runs naming one worker': {
      10: { question: 'which live session is this open run\'s worker', wire: { sessionRunOf: 11, openRunOf: 11, childIds: 'absent' }, runForSession: 11, runBelongsTo: true, worker: null, coordSession: C, coordPresence: 'dead', resumeDoor: true, abandonChild: 'unknown', runCard: 'project-a', paletteClaims: true, treeRow: 'project-a:depth1' },
      11: { question: 'which live session is this open run\'s worker', wire: { sessionRunOf: 11, openRunOf: 11, childIds: 'absent' }, runForSession: 11, runBelongsTo: true, worker: W, coordSession: C, coordPresence: 'dead', resumeDoor: true, abandonChild: 'child', runCard: 'project-a', paletteClaims: true, treeRow: 'project-a:depth1' },
    },
    'a recycled id, as a worker (#746: a run opened before the workspace\'s own run)': {
      83: { question: 'which live session is this open run\'s worker', wire: { sessionRunOf: null, openRunOf: null, childIds: 'absent' }, runForSession: null, runBelongsTo: false, worker: null, coordSession: C, coordPresence: 'dead', resumeDoor: true, abandonChild: 'unknown', runCard: 'project-a', paletteClaims: true, treeRow: 'project-a:depth0' },
    },
    'a recycled id, as a coordinator (no wire fact binds the claimant\'s incarnation)': {
      12: { question: 'which listed session carries the claimant id', wire: { sessionRunOf: 12, openRunOf: 12, childIds: [] }, runForSession: 12, runBelongsTo: true, worker: W, coordSession: C, coordPresence: 'alive', resumeDoor: false, abandonChild: 'child', runCard: 'project-a', paletteClaims: true, treeRow: 'project-a:depth1' },
    },
    'the open-vs-newest pair (a newer run closed while an older one is open)': {
      20: { question: 'open: which live session is this open run\'s worker; closed: which listed session carries this id', wire: { sessionRunOf: 21, openRunOf: 20, childIds: 'absent' }, runForSession: 20, runBelongsTo: true, worker: W, coordSession: C, coordPresence: 'dead', resumeDoor: true, abandonChild: 'child', runCard: 'project-a', paletteClaims: true, treeRow: 'project-a:depth1' },
      21: { question: 'open: which live session is this open run\'s worker; closed: which listed session carries this id', wire: { sessionRunOf: 21, openRunOf: 20, childIds: 'absent' }, runForSession: 20, runBelongsTo: true, worker: W, coordSession: C, coordPresence: 'dead', resumeDoor: true, abandonChild: '-', runCard: 'project-a', paletteClaims: false, treeRow: 'project-a:depth1' },
    },
    'a closed run of a live session, as its worker': {
      30: { question: 'which listed session carries this id (the named by-id arm, D-7205)', wire: { sessionRunOf: 30, openRunOf: null, childIds: 'absent' }, runForSession: null, runBelongsTo: true, worker: W, coordSession: C, coordPresence: 'dead', resumeDoor: true, abandonChild: '-', runCard: 'project-a', paletteClaims: false, treeRow: 'project-a:depth0' },
    },
    'a closed run of a live session, as its coordinator': {
      31: { question: 'which listed session carries the claimant id (D-7207)', wire: { sessionRunOf: null, openRunOf: null, childIds: 'absent' }, runForSession: null, runBelongsTo: true, worker: 'worker-b', coordSession: C, coordPresence: 'dead', resumeDoor: true, abandonChild: '-', runCard: 'project-a', paletteClaims: false, treeRow: 'project-a:depth0' },
    },
    'an older closed run of a live session, beside its newer bound run': {
      40: { question: 'closed: which listed session carries this id; open: its worker by binding', wire: { sessionRunOf: 41, openRunOf: 41, childIds: 'absent' }, runForSession: 41, runBelongsTo: true, worker: W, coordSession: C, coordPresence: 'dead', resumeDoor: true, abandonChild: '-', runCard: 'project-a', paletteClaims: false, treeRow: 'project-a:depth1' },
      41: { question: 'closed: which listed session carries this id; open: its worker by binding', wire: { sessionRunOf: 41, openRunOf: 41, childIds: 'absent' }, runForSession: 41, runBelongsTo: true, worker: W, coordSession: C, coordPresence: 'dead', resumeDoor: true, abandonChild: 'child', runCard: 'project-a', paletteClaims: true, treeRow: 'project-a:depth1' },
    },
    'an open planned run with sessionId null': {
      50: { question: 'which listed session carries the claimant id', wire: { sessionRunOf: null, openRunOf: null, childIds: 'absent' }, runForSession: null, runBelongsTo: false, worker: null, coordSession: C, coordPresence: 'dead', resumeDoor: true, abandonChild: 'unknown', runCard: 'project-a', paletteClaims: true, treeRow: 'project-a:depth0' },
    },
    // C7d's behaviour rows, OA-C15 (a) (D-7265): an open run's worker is the session the wire binds to it, so a worker
    // the wire does not bind is not bracketed under the run's claimant (fleetTree, `treeRow`: depth1 before).
    'an open run whose worker binding is undecidable (no run key on the worker)': {
      51: { question: 'which live session is this open run\'s worker', wire: { sessionRunOf: null, openRunOf: null, childIds: 'absent' }, runForSession: 51, runBelongsTo: true, worker: null, coordSession: C, coordPresence: 'dead', resumeDoor: true, abandonChild: 'unknown', runCard: 'project-a', paletteClaims: true, treeRow: 'project-a:depth0' },
    },
    'an open run on a tick whose childIds are empty (the registry was unlistable)': {
      52: { question: 'which live session is this open run\'s worker', wire: { sessionRunOf: 52, openRunOf: 52, childIds: [] }, runForSession: 52, runBelongsTo: true, worker: W, coordSession: C, coordPresence: 'dead', resumeDoor: true, abandonChild: 'child', runCard: 'project-a', paletteClaims: true, treeRow: 'project-a:depth1' },
    },
    'an open run with no childIds key (an emitter that does not compute it)': {
      53: { question: 'which live session is this open run\'s worker', wire: { sessionRunOf: 53, openRunOf: 53, childIds: 'absent' }, runForSession: 53, runBelongsTo: true, worker: W, coordSession: C, coordPresence: 'dead', resumeDoor: true, abandonChild: 'child', runCard: 'project-a', paletteClaims: true, treeRow: 'project-a:depth1' },
    },
  };
  for (const sc of SCENARIOS) {
    it(sc.name, async () => {
      const got = await rowFacts(sc);
      console.log(`w7-run-binding-table ${sc.name}:\n${Object.entries(got).map(([id, f]) => `  run ${id}: ${JSON.stringify(f)}`).join('\n')}`);
      expect(got).toEqual(PINS[sc.name]);
    });
  }
});

describe('the matchers that ask the coordinator side (ArchiveSheet, PrSheet)', () => {
  // `ArchiveSheet`'s claimed open runs of the claimant (`r.claimedBy === session.id`), and `PrSheet`'s open run on the
  // worker's workspace (`r.sessionId === id`): both match by id, so the recycled-id rows count today.
  const MATCHERS: Record<string, unknown> = {
    // C7d's behaviour rows, OA-C15 (a) (D-7265): the PR sheet's open run is the one the wire binds to the workspace
    // (`sessionRunOf(s, 'open')`), so the note names run 11, not the older run 10 that names the id (10 before), and
    // names no run for the recycled id (83 before) or the undecidable binding (51 before).
    'two runs naming one worker': { archiveAsksClaimant: 2, prOpenRunOnWorker: 11 },
    'a recycled id, as a worker (#746: a run opened before the workspace\'s own run)': { archiveAsksClaimant: 1, prOpenRunOnWorker: null },
    'a recycled id, as a coordinator (no wire fact binds the claimant\'s incarnation)': { archiveAsksClaimant: 1, prOpenRunOnWorker: 12 },
    'the open-vs-newest pair (a newer run closed while an older one is open)': { archiveAsksClaimant: 1, prOpenRunOnWorker: 20 },
    'a closed run of a live session, as its worker': { archiveAsksClaimant: 0, prOpenRunOnWorker: null },
    'a closed run of a live session, as its coordinator': { archiveAsksClaimant: 0, prOpenRunOnWorker: null },
    'an older closed run of a live session, beside its newer bound run': { archiveAsksClaimant: 1, prOpenRunOnWorker: 41 },
    'an open planned run with sessionId null': { archiveAsksClaimant: 1, prOpenRunOnWorker: null },
    'an open run whose worker binding is undecidable (no run key on the worker)': { archiveAsksClaimant: 1, prOpenRunOnWorker: null },
    'an open run on a tick whose childIds are empty (the registry was unlistable)': { archiveAsksClaimant: 1, prOpenRunOnWorker: 52 },
    'an open run with no childIds key (an emitter that does not compute it)': { archiveAsksClaimant: 1, prOpenRunOnWorker: 53 },
  };
  for (const sc of SCENARIOS) {
    it(sc.name, () => {
      const got = { archiveAsksClaimant: archiveAsks(sc, C), prOpenRunOnWorker: prOpenRun(sc) };
      console.log(`w7-run-binding-table matchers ${sc.name}: ${JSON.stringify(got)}`);
      expect(got).toEqual(MATCHERS[sc.name]);
    });
  }
});

describe('nestFleet\'s attentionFirst lookup: the child order under one coordinator (#746 fixture)', () => {
  // `attentionFirst`'s `byId.get(r.sessionId)` asks "is this run's worker waiting on the operator", and its answer is
  // only visible in the ORDER of a coordinator's children (`treeRow` above records a card and a depth, not an order).
  // So each row here gives one live coordinator two children: an ordinary worker on wave 1, and a wave-2 run whose
  // worker is in `attention`. Today a waiting worker's run sorts first whatever its binding, so the wave-2 row reads
  // above the wave-1 row. Item 3's table moves this lookup to `workerOf` by binding (an unbound worker does not sort its
  // run first), so the unbound and recycled rows are the ones C7d must name; the bound row is the control that keeps
  // its order. Pinned twice: `fleetTree`'s rows (the fleet's own path, after its binding filter, `workerOf`) and `nestFleet`
  // handed the runs directly (the comparator alone, no filter in front of it).
  const O = 'worker-o';
  const r60 = run(60, { sessionId: O, workspace: 'ws-o', branch: 'ws/ws-o', wave: 1 });
  const r61 = run(61, { wave: 2 });
  const ordinary = (): FleetSession => worker({ id: O, workspace: 'ws-o', workdir: '/w/ws-o', child: { kind: 'child', runId: 60 }, run: bound(r60), openRun: bound(r60) });
  const waiting = (over: Partial<FleetSession>): FleetSession => worker({ child: { kind: 'child', runId: 61 }, status: 'idle', bucket: 'attention', ...over });
  const ORDERS: ReadonlyArray<{ name: string; sessions: readonly FleetSession[]; tree: readonly string[]; nest: readonly string[] }> = [
    { name: 'the waiting worker is unbound (no run on the wire), the stale run names it by id',
      // C7d's behaviour rows, OA-C15 (a): the tree brackets only the run the wire binds, so the unbound waiting worker is
      // not this coordinator's child on the card (tree: [W, O] before); and `attentionFirst` asks the run's bound worker
      // (`workerOf`), so the unbound worker's run does not sort first (nest: [W, O] before).
      sessions: [coord(), ordinary(), waiting({ run: null, openRun: null })], tree: [O], nest: [O, W] },
    { name: 'the waiting worker is a recycled id (its binding names another run), the stale run names it by id',
      // C7d's behaviour rows, OA-C15 (a): the recycled id's binding names another run (tree: [W, O] and nest: [W, O]
      // before).
      sessions: [coord(), ordinary(), waiting({ run: bound(closed(90)), openRun: null })], tree: [O], nest: [O, W] },
    { name: 'the control: the waiting worker is bound to the wave-2 run',
      sessions: [coord(), ordinary(), waiting({ run: bound(r61), openRun: bound(r61) })], tree: [W, O], nest: [W, O] },
  ];
  const childrenOf = (rows: readonly FleetRow[]): string[] => {
    const at = rows.findIndex((x) => x.kind === 'session' && x.session.id === C && x.depth === 0);
    const out: string[] = [];
    for (const x of rows.slice(at + 1)) {
      if (x.depth === 0) break;
      out.push(x.kind === 'session' ? x.session.id : x.kind === 'pending' ? `pending:${x.run.id}` : x.kind);
    }
    return out;
  };
  for (const o of ORDERS) {
    it(o.name, () => {
      const runs = [r60, r61];
      const tree = fleetTree([...o.sessions], ['project-a'], runs, {});
      const card = tree.find((g) => g.project === 'project-a')!;
      const got = { tree: childrenOf(card.rows), nest: childrenOf(nestFleet(o.sessions, runs)) };
      console.log(`w7-run-binding-table attentionFirst ${o.name}: ${JSON.stringify(got)}`);
      expect(got).toEqual({ tree: o.tree, nest: o.nest });
    });
  }
});
