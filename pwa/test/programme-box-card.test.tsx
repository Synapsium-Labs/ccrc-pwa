// A programme as a box in its project card (Task G2), as the card draws the decider's answer (`programmeBoxes.ts`,
// pinned in `programme-box.test.ts`). One component in both skins: the card is drawn alone here, over the fleet tree
// and the rollup exactly as `FleetCards` builds them, and the fold's storage is checked through each skin's own list.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { INSTRUMENT, REFINED, type SkinId } from '@ccrc/ui';
import type { FleetSession, RunSummary, UpdatesView } from '../../shared/api';
import { fleetTree } from '../src/fleet/fleetTree';
import { NO_ROLLUP_PREFS, rollupFleet, type RollupPrefs } from '../src/fleet/rollup';
import { ProjectCard } from '../src/fleet/ProjectCard';
import { ProgrammeScreen } from '../src/ledgers/ProgrammeScreen';
import { assignHues } from '../src/fleet/programmeBoxes';
import { api } from '../src/lib/api';
import { resetAcks } from '../src/lib/seen';
import { matchRoute } from '../src/lib/routes';
import { setSkin } from '../src/lib/skin';
import { SKIN_SETS } from '../src/skins';
import { createFleetStore, useFleetStore } from '../src/stores/fleet';
import { renderFleet } from './fleetHost';
import { itemView, waitingView } from './ledgersFixture';
import { withRunBinding } from './runBindingFixture';
import { HOUR, MIN, NOW, answeredByCoordinator, asking, run, sess } from './rollupFixture';

const noop = (): void => {};

// Fix round 1, F1: the keys the list hands its view hold, recorded around the real hook.
const holdKeys = vi.hoisted((): string[] => []);
vi.mock('../src/fleet/useHoldView', async (load) => {
  const real = await load<typeof import('../src/fleet/useHoldView')>();
  return { useHoldView: (...args: Parameters<typeof real.useHoldView>): void => { holdKeys.push(args[1]); real.useHoldView(...args); } };
});

/** project-c: a coordinator with three workers (`w1` asks the operator, `w2` works, `w3` idles) and two sessions
 *  in no programme. */
function fleet(w1: Partial<FleetSession> = asking(), waveOf: number | null = 6): { sessions: FleetSession[]; runs: RunSummary[] } {
  const coord = sess('coord', 'project-c', { role: 'coordinator', status: 'busy', bucket: 'working', bucketSince: NOW - 4 * HOUR });
  const kids = [
    sess('w1', 'project-c', { role: 'child', ...w1 }),
    sess('w2', 'project-c', { role: 'child', status: 'busy', bucket: 'working' }),
    sess('w3', 'project-c', { role: 'child' }),
  ];
  const lone = [sess('l1', 'project-c'), sess('l2', 'project-c')];
  const runs = kids.map((k, i) => run(10 + i, 'coord', k.id, { wave: i + 1, waveOf }));
  return { sessions: withRunBinding([coord, ...kids, ...lone], runs), runs };
}

function drawCard(
  sessions: FleetSession[], runs: RunSummary[], project: string,
  { prefs = NO_ROLLUP_PREFS, collapsed, stallQuietMs, coordPaused }:
    { prefs?: RollupPrefs; collapsed?: boolean; stallQuietMs?: number | null; coordPaused?: boolean } = {},
): HTMLElement {
  const tree = fleetTree(withRunBinding(sessions, runs), [], runs);
  const g = tree.find((x) => x.project === project);
  if (g === undefined) throw new Error(`no card ${project}`);
  const rollup = collapsed === undefined ? rollupFleet(tree, prefs, NOW, null).cards.get(project) : undefined;
  const { container } = render(
    <ProjectCard group={g} rollup={rollup} collapsed={collapsed} runs={g.runs} abroad={g.abroad} nowMs={NOW} boxNow={NOW}
      stallQuietMs={stallQuietMs} coordPaused={coordPaused} onOpen={noop} onActions={noop} onToggleChildren={noop} />,
  );
  return container;
}

const labels = (root: Element): string[] =>
  [...root.querySelectorAll('.sess-line .sess-label')].map((e) => e.textContent ?? '');

beforeEach(() => {
  window.localStorage.clear();
  resetAcks();
});
afterEach(() => {
  act(() => useFleetStore.setState({ waiting: null }));
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('a programme box in its project card', () => {
  it('draws one box for the coordinator, before the rows in no programme', () => {
    const { sessions, runs } = fleet();
    const c = drawCard(sessions, runs, 'project-c');
    const boxes = c.querySelectorAll('section.pg-box');
    expect(boxes).toHaveLength(1);
    const lone = [...c.querySelectorAll('.sess-line')].find((el) => el.querySelector('.sess-label')?.textContent === 'l1');
    expect(boxes[0]!.compareDocumentPosition(lone!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(boxes[0]!.contains(lone!)).toBe(false);
  });

  it('heads the box with a kicker naming the programme and its progress', () => {
    const { sessions, runs } = fleet();
    const kicker = drawCard(sessions, runs, 'project-c').querySelector('.pg-kicker')!;
    expect(kicker.textContent).toContain('Programme');
    expect(kicker.querySelector('.pg-title')?.textContent).toBe('Port the API');
    expect(kicker.querySelector('.pg-count')?.textContent).toBe('3/6 waves');
    expect(kicker.querySelector('.pg-bar')).not.toBeNull();
  });

  it('says the wave with no bar when the programme declared no total', () => {
    const { sessions, runs } = fleet(asking(), null);
    const kicker = drawCard(sessions, runs, 'project-c').querySelector('.pg-kicker')!;
    expect(kicker.querySelector('.pg-count')?.textContent).toBe('wave 3');
    expect(kicker.querySelector('.pg-bar')).toBeNull();
  });

  it('keeps the coordinator\'s own row, with its own label, as the box\'s first row', () => {
    const { sessions, runs } = fleet();
    const box = drawCard(sessions, runs, 'project-c').querySelector('section.pg-box')!;
    expect(labels(box.querySelector('.pg-coord')!)).toEqual(['coord']);
  });

  it('folds the tray to the worker that asks the operator, with its ask, and words the footer', () => {
    const { sessions, runs } = fleet();
    const box = drawCard(sessions, runs, 'project-c').querySelector<HTMLElement>('section.pg-box')!;
    const tray = box.querySelector<HTMLElement>('.pg-tray')!;
    expect(labels(tray)).toEqual(['w1']);
    // Its ask is the row's own, as before: the attention lamp on the worker's line.
    expect(tray.querySelector('.sess-lamp')?.getAttribute('data-status')).toBe('attention');
    const foot = within(box).getByRole('button', { name: '2 more workers · 1 working' });
    expect(foot.getAttribute('aria-expanded')).toBe('false');
    // The old separate summary row is gone: the footer is the one toggle.
    expect(box.querySelectorAll('.proj-children-toggle')).toHaveLength(1);
    expect(box.querySelector('.pg-foot')?.contains(foot)).toBe(true);
  });

  it('words the open footer "hide n workers" and draws every worker', () => {
    const { sessions, runs } = fleet();
    const box = drawCard(sessions, runs, 'project-c', { prefs: { projects: {}, openChildren: ['coord'] } })
      .querySelector<HTMLElement>('section.pg-box')!;
    expect(labels(box.querySelector('.pg-tray')!)).toEqual(['w1', 'w2', 'w3']);
    expect(within(box).getByRole('button', { name: 'hide 3 workers' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('heads the rows in no programme, and the workers of programmes elsewhere above them', () => {
    const { sessions, runs } = fleet();
    const far = sess('w9', 'project-c', { role: 'child' });
    const farCoord = sess('far-coord', 'project-d', { role: 'coordinator' });
    const c = drawCard([...sessions, far, farCoord], [...runs, run(30, 'far-coord', 'w9', { program: 'billing' })], 'project-c');
    const subs = [...c.querySelectorAll('.pg-sub')].map((e) => e.textContent);
    expect(subs).toEqual(['Workers of programmes elsewhere', 'Not in a programme']);
    const [elsewhereHead, loneHead] = [...c.querySelectorAll('.pg-sub')];
    const row = (id: string): Element => [...c.querySelectorAll('.sess-line')].find((el) => el.querySelector('.sess-label')?.textContent === id)!;
    const after = (a: Element, b: Element): boolean => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(after(c.querySelector('section.pg-box')!, elsewhereHead!)).toBe(true);
    expect(after(elsewhereHead!, row('w9'))).toBe(true);
    expect(after(row('w9'), loneHead!)).toBe(true);
    expect(after(loneHead!, row('l1'))).toBe(true);
    expect(row('w9').closest('[data-hue]')?.getAttribute('data-hue')).toBe(assignHues(['port-api', 'billing']).get('billing'));
  });

  // A control, green on main too: a card with no programme draws exactly the rows it drew before.
  it('draws no sub-heading on a card with no programme, as before', () => {
    const c = drawCard([sess('l1', 'project-c', { status: 'busy', bucket: 'working' }), sess('l2', 'project-c')], [], 'project-c');
    expect(c.querySelector('.pg-sub')).toBeNull();
    expect(c.querySelector('section.pg-box')).toBeNull();
    expect(labels(c).sort()).toEqual(['l1', 'l2']);
  });

  it('carries the programme\'s hue and its state', () => {
    const { sessions, runs } = fleet();
    const box = drawCard(sessions, runs, 'project-c').querySelector('section.pg-box')!;
    expect(box.getAttribute('data-hue')).toBe(assignHues(['port-api']).get('port-api'));
    expect(box.getAttribute('data-state')).toBe('needs');
    cleanup();
    const quiet = fleet(answeredByCoordinator());
    expect(drawCard(quiet.sessions, quiet.runs, 'project-c').querySelector('section.pg-box')?.getAttribute('data-state')).toBe('moving');
  });

  // Vacuous in the app until Task G1: the rollup pins open a card whose rows need the operator, so a folded card
  // never holds a box that needs; and no box reads stalled until G1 supplies the moves, the threshold and a clock.
  // The card is folded by hand here (`collapsed`) to keep the branch pinned; G1 adds the real case through FleetCards.
  it('keeps a box that needs the operator on a folded card, and counts the rest', () => {
    const { sessions, runs } = fleet();
    const c = drawCard(sessions, runs, 'project-c', { collapsed: true });
    expect(c.querySelectorAll('section.pg-box')).toHaveLength(1);
    expect(c.querySelector('.pg-more')?.textContent).toBe('2 more in this project');
    expect(labels(c)).not.toContain('l1');
    cleanup();
    const quiet = fleet(answeredByCoordinator());
    const folded = drawCard(quiet.sessions, quiet.runs, 'project-c', { collapsed: true });
    expect(folded.querySelector('section.pg-box')).toBeNull();
    expect(folded.querySelector('.sess-line')).toBeNull();
  });

  it('lists a far worker in its box\'s tray as the abroad line, and only there', () => {
    const coord = sess('coord', 'project-d', { role: 'coordinator', status: 'busy', bucket: 'working' });
    const far = sess('w9', 'project-c', { role: 'child' });
    const r = run(30, 'coord', 'w9', { project: 'project-c', homeProject: 'project-d', wave: 5, waveOf: null });
    const c = drawCard([coord, far], [r], 'project-d');
    const lines = c.querySelectorAll('.proj-abroad-line');
    expect(lines).toHaveLength(1);
    expect(c.querySelector('.pg-tray')?.contains(lines[0]!)).toBe(true);
    expect(lines[0]!.textContent).toContain('port-api wave 5 in project-c');
  });
});

describe('one programme, one hue across the fleet', () => {
  // 'billing' and 'search-index' share an FNV bucket (cyan, programme-box.test.ts). Both coordinators sit on project-d;
  // search-index's worker renders on project-c, under "Workers of programmes elsewhere".
  const pair = (): { sessions: FleetSession[]; runs: RunSummary[] } => ({
    sessions: [
      sess('coord-b', 'project-d', { role: 'coordinator', status: 'busy', bucket: 'working' }),
      sess('wb', 'project-d', { role: 'child' }),
      sess('coord-s', 'project-d', { role: 'coordinator', status: 'busy', bucket: 'working' }),
      sess('ws', 'project-c', { role: 'child', status: 'busy', bucket: 'working' }),
    ],
    runs: [
      run(40, 'coord-b', 'wb', { program: 'billing', programTitle: 'Billing', project: 'project-d' }),
      run(41, 'coord-s', 'ws', { program: 'search-index', programTitle: 'Search index', project: 'project-c', homeProject: 'project-d' }),
    ],
  });
  const boxHue = (c: Element, title: string): string | null =>
    [...c.querySelectorAll('section.pg-box')].find((b) => b.querySelector('.pg-title')?.textContent === title)
      ?.getAttribute('data-hue') ?? null;

  it('draws a far worker in its box\'s hue, on the other card', () => {
    const { sessions, runs } = pair();
    const home = drawCard(sessions, runs, 'project-d');
    const hue = boxHue(home, 'Search index');
    expect(hue).not.toBeNull();
    expect(hue).not.toBe(boxHue(home, 'Billing'));
    cleanup();
    const far = drawCard(sessions, runs, 'project-c').querySelector('.pg-far');
    expect(far?.textContent).toContain('ws');
    expect(far?.getAttribute('data-hue')).toBe(hue);
  });
});

describe('a box\'s far workers are the runs whose worker renders on another card', () => {
  const coord = sess('coord', 'project-d', { role: 'coordinator', status: 'busy', bucket: 'working' });
  const released = sess('wr', 'project-d', {
    role: 'child', releasedFrom: { runId: 50, program: 'port-api', programTitle: null, claimedBy: 'coord', closedAt: NOW - HOUR, child: true },
  });
  const archived = sess('wa', 'project-d', { role: 'child', bucket: 'archived', status: 'dead' });

  it.each([
    ['in this card\'s Released fold', [coord, released], 'wr'],
    ['in this card\'s Archived fold', [coord, archived], 'wa'],
    ['gone from the fleet', [coord], 'ghost'],
  ] as const)('draws no abroad line for a worker %s', (_why, sessions, worker) => {
    const r = run(50, 'coord', worker, { project: 'project-d', wave: 2 });
    const c = drawCard([...sessions], [r], 'project-d');
    expect(c.querySelector('.proj-abroad-line')).toBeNull();
    expect(c.textContent).not.toContain('in project-d');
  });
});

// Task G1b (D-7380, D-7373): the moves off the runs frame (`runLastMove`), the stall watch's quiet time (`stallQuietMs`)
// and the operator's pause (the coord frame) reach the box at its one call site.
const QUIET = 2 * HOUR;
/** The fleet with no worker asking, every run last moved at `at` (`lastMoveAt`, as a current server sends it). */
function quietFleet(at: number | null): { sessions: FleetSession[]; runs: RunSummary[] } {
  const f = fleet(answeredByCoordinator());
  return { sessions: f.sessions, runs: f.runs.map((r) => ({ ...r, lastMoveAt: at })) };
}
const boxOf = (root: ParentNode): HTMLElement | null => root.querySelector<HTMLElement>('section.pg-box');

describe('a box says when its programme last moved (Task G1b)', () => {
  it('reads "no move 2h 10m" and stalled at the stall watch\'s own quiet time', () => {
    const { sessions, runs } = quietFleet(NOW - 2 * HOUR - 10 * MIN);
    const box = boxOf(drawCard(sessions, runs, 'project-c', { stallQuietMs: 7_200_000 }))!;
    expect(box.getAttribute('data-state')).toBe('stalled');
    expect(box.querySelector('.pg-moved')?.textContent).toBe('no move 2h 10m');
  });

  it('reads "paused" under the coord frame\'s pause, never stalled', () => {
    const { sessions, runs } = quietFleet(NOW - 2 * HOUR - 10 * MIN);
    const box = boxOf(drawCard(sessions, runs, 'project-c', { stallQuietMs: QUIET, coordPaused: true }))!;
    expect(box.getAttribute('data-state')).toBe('paused');
    expect(box.querySelector('.pg-moved')?.textContent).toBe('paused');
  });

  it('reads "moved … ago" below the quiet time', () => {
    const { sessions, runs } = quietFleet(NOW - 90 * MIN);
    const box = boxOf(drawCard(sessions, runs, 'project-c', { stallQuietMs: QUIET }))!;
    expect(box.getAttribute('data-state')).toBe('moving');
    expect(box.querySelector('.pg-moved')?.textContent).toBe('moved 1h 30m ago');
  });

  it('falls back to the dispatch time when the server measured no move (D-7338; fix round 1, F5)', () => {
    const f = quietFleet(null);
    const runs = f.runs.map((r) => ({ ...r, dispatchedAt: NOW - 2 * HOUR - 10 * MIN }));
    const box = boxOf(drawCard(f.sessions, runs, 'project-c', { stallQuietMs: QUIET }))!;
    expect(box.getAttribute('data-state')).toBe('stalled');
    expect(box.querySelector('.pg-moved')?.textContent).toBe('no move 2h 10m');
  });

  it('never stalls when the frame carries no quiet time, and shows no movement for an older server', () => {
    const late = quietFleet(NOW - 5 * HOUR);
    expect(boxOf(drawCard(late.sessions, late.runs, 'project-c'))?.getAttribute('data-state')).toBe('moving');
    cleanup();
    const old = fleet(answeredByCoordinator());   // no `lastMoveAt` on any run: an older server
    const box = boxOf(drawCard(old.sessions, old.runs, 'project-c', { stallQuietMs: QUIET }))!;
    expect(box.getAttribute('data-state')).toBe('moving');
    expect(box.querySelector('.pg-moved')).toBeNull();
  });
});

describe.each([REFINED, INSTRUMENT] as const)('the box\'s fold in the %s fleet list', (skin: SkinId) => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.spyOn(api, 'updates').mockReturnValue(new Promise<UpdatesView>(() => {}));
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  });

  it('opens the tray from the footer and stores the coordinator in openChildren, under the same key', () => {
    act(() => setSkin(skin));
    const store = createFleetStore({
      makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
    });
    const Nav = SKIN_SETS[skin].Nav;
    if (Nav === null) throw new Error(`${skin} places no fleet list`);
    renderFleet(<Nav />, store);
    const { sessions, runs } = fleet();
    act(() => { store.setState({ conn: 'open', fleetFrameSeen: true, runsFrameSeen: true, runs, sessions }); });
    const box = document.querySelector<HTMLElement>('section.pg-box')!;
    expect(labels(box.querySelector('.pg-tray')!)).toEqual(['w1']);
    const keys = Object.keys(window.localStorage).sort();
    fireEvent.click(within(box).getByRole('button', { name: '2 more workers · 1 working' }));
    expect(labels(document.querySelector('section.pg-box .pg-tray')!)).toEqual(['w1', 'w2', 'w3']);
    expect(JSON.parse(window.localStorage.getItem('ccrc.fleet-rollup.v1')!).openChildren).toEqual(['coord']);
    expect(Object.keys(window.localStorage).filter((k) => !keys.includes(k))).toEqual(
      keys.includes('ccrc.fleet-rollup.v1') ? [] : ['ccrc.fleet-rollup.v1']);
    expect(screen.getByRole('button', { name: 'hide 3 workers' })).toBeTruthy();
  });

  // Through the real list (FleetCards, its rollup and its one clock), never the test-only `nowMs` (review 1152 F1, F2).
  const mount = (): ReturnType<typeof createFleetStore> => {
    act(() => setSkin(skin));
    const store = createFleetStore({
      makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
    });
    const Nav = SKIN_SETS[skin].Nav;
    if (Nav === null) throw new Error(`${skin} places no fleet list`);
    renderFleet(<Nav />, store);
    return store;
  };
  const frames = (sessions: FleetSession[], runs: RunSummary[]) =>
    ({ conn: 'open' as const, fleetFrameSeen: true, runsFrameSeen: true, runs, sessions, stallQuietMs: QUIET });

  it('an open card\'s box turns from moving to stalled at its boundary, with no frame between', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(NOW);
    const store = mount();
    const f = quietFleet(NOW - QUIET + MIN);   // crosses in one minute
    // The coordinator changed state a minute ago, so the card is active and drawn open.
    const sessions = f.sessions.map((x) => (x.id === 'coord' ? { ...x, bucketSince: NOW - MIN, statusUpdatedAt: NOW - MIN } : x));
    act(() => { store.setState(frames(sessions, f.runs)); });
    expect(boxOf(document)?.getAttribute('data-state')).toBe('moving');
    act(() => { vi.advanceTimersByTime(MIN + 1_000); });
    expect(boxOf(document)?.getAttribute('data-state')).toBe('stalled');
  });

  it('a folded card shows its box once it stalls with no frame, and counts the rest (review 1152 F2)', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(NOW);
    const store = mount();
    const f = quietFleet(NOW - QUIET + MIN);
    // Every session idle for hours: the project is inactive, so the rollup folds its card and keeps no moving box.
    const sessions = f.sessions.map((x) => ({ ...x, status: 'idle' as const, bucket: 'idle' as const }));
    act(() => { store.setState(frames(sessions, f.runs)); });
    expect(boxOf(document)).toBeNull();
    act(() => { vi.advanceTimersByTime(MIN + 1_000); });
    expect(boxOf(document)?.getAttribute('data-state')).toBe('stalled');
    expect(document.querySelector('.pg-more')?.textContent).toBe('2 more in this project');
  });

  it('a runs frame with no quiet time never stalls a box, however long it has been quiet (D-7376)', () => {
    const store = mount();
    const f = quietFleet(NOW - 5 * HOUR);
    const sessions = f.sessions.map((x) => (x.id === 'coord' ? { ...x, bucketSince: NOW - MIN, statusUpdatedAt: NOW - MIN } : x));
    act(() => { store.setState({ ...frames(sessions, f.runs), stallQuietMs: null }); });
    expect(boxOf(document)?.getAttribute('data-state')).toBe('moving');
    expect(boxOf(document)?.querySelector('.pg-moved')?.textContent).toBe('moved 5h ago');
  });

  it('under the coord frame\'s pause a quiet box reads paused, never stalled', () => {
    const store = mount();
    const f = quietFleet(NOW - 3 * HOUR);
    const sessions = f.sessions.map((x) => (x.id === 'coord' ? { ...x, bucketSince: NOW - MIN, statusUpdatedAt: NOW - MIN } : x));
    act(() => { store.setState(frames(sessions, f.runs)); });
    expect(boxOf(document)?.getAttribute('data-state')).toBe('stalled');
    act(() => { store.setState({ coordFrameSeen: true,
      coord: { pause: 'set', mail: 'clear', reclaim: 'clear', childReclaimAttention: [] } }); });
    expect(boxOf(document)?.getAttribute('data-state')).toBe('paused');
  });

  // Fix round 1 (review 1241): every input the list's clock and `boxNow` read, each pinned through the real list.
  /** The coordinator changed state a minute ago, so the card is active and drawn open. */
  const active = (sessions: FleetSession[], id = 'coord'): FleetSession[] =>
    sessions.map((x) => (x.id === id ? { ...x, bucketSince: NOW - MIN, statusUpdatedAt: NOW - MIN } : x));
  const coordFrame = (pause: 'set' | 'clear' | 'unmeasurable') =>
    ({ coordFrameSeen: true, coord: { pause, mail: 'clear' as const, reclaim: 'clear' as const, childReclaimAttention: [] } });
  const boxTitled = (title: string): HTMLElement | undefined =>
    [...document.querySelectorAll<HTMLElement>('section.pg-box')].find((b) => b.querySelector('.pg-title')?.textContent === title);

  it('a box that crossed under the pause reads stalled once the pause clears, with no runs frame (F3)', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(NOW);
    const store = mount();
    const f = quietFleet(NOW - QUIET + MIN);
    act(() => { store.setState({ ...frames(active(f.sessions), f.runs), ...coordFrame('set') }); });
    expect(boxOf(document)?.getAttribute('data-state')).toBe('paused');
    act(() => { vi.advanceTimersByTime(MIN + 1_000); });
    act(() => { store.setState(coordFrame('clear')); });
    expect(boxOf(document)?.getAttribute('data-state')).toBe('stalled');
  });

  it('a runs frame that ages a box reads it stalled while the clock waits on another box (F3)', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(NOW);
    const store = mount();
    const sessions = active([
      sess('coord-a', 'project-c', { role: 'coordinator', status: 'busy', bucket: 'working' }),
      sess('wa1', 'project-c', { role: 'child' }), sess('wa2', 'project-c', { role: 'child' }),
      sess('coord-b', 'project-c', { role: 'coordinator', status: 'busy', bucket: 'working' }),
      sess('wb1', 'project-c', { role: 'child' }),
    ], 'coord-a');
    const a = { program: 'prog-a', programTitle: 'Programme A' };
    const runs = [
      run(20, 'coord-a', 'wa1', { ...a, lastMoveAt: NOW - 115 * MIN }),
      run(21, 'coord-a', 'wa2', { ...a, lastMoveAt: NOW - 30 * MIN }),   // A's newest: its boundary is 90 minutes out
      run(22, 'coord-b', 'wb1', { program: 'prog-b', programTitle: 'Programme B', lastMoveAt: NOW - 100 * MIN }),   // B's: 20
    ];
    act(() => { store.setState(frames(withRunBinding(sessions, runs), runs)); });
    expect(boxTitled('Programme A')?.getAttribute('data-state')).toBe('moving');
    act(() => { vi.advanceTimersByTime(10 * MIN); });
    // A's newest run closes: its last move is now 125 minutes old, and the clock still waits on B's boundary.
    act(() => { store.setState({ runs: runs.map((r) => (r.id === 21 ? { ...r, state: 'done' as const } : r)) }); });
    expect(boxTitled('Programme A')?.getAttribute('data-state')).toBe('stalled');
  });

  it('the clock wakes at the rollup\'s window end when it comes before a box\'s boundary (F4)', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(NOW);
    const store = mount();
    const f = quietFleet(NOW - 10 * MIN);   // the box's boundary is 110 minutes out
    // Nobody working; the coordinator's last change was 25 minutes ago, so the card rolls up in 5 minutes.
    const sessions = f.sessions.map((x) => ({ ...x, status: 'idle' as const, bucket: 'idle' as const,
      ...(x.id === 'coord' ? { bucketSince: NOW - 25 * MIN, statusUpdatedAt: NOW - 25 * MIN } : {}) }));
    act(() => { store.setState(frames(sessions, f.runs)); });
    expect(document.querySelector('section.proj-card')?.getAttribute('data-collapsed')).toBeNull();
    act(() => { vi.advanceTimersByTime(5 * MIN + 1_000); });
    expect(document.querySelector('section.proj-card')?.getAttribute('data-collapsed')).toBe('true');
  });

  it('a run the server measured no move on stalls from its dispatch time, at its boundary (D-7338, F5)', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(NOW);
    const store = mount();
    const f = quietFleet(null);
    const runs = f.runs.map((r) => ({ ...r, dispatchedAt: NOW - QUIET + MIN }));
    act(() => { store.setState(frames(active(f.sessions), runs)); });
    expect(boxOf(document)?.getAttribute('data-state')).toBe('moving');
    act(() => { vi.advanceTimersByTime(MIN + 1_000); });
    expect(boxOf(document)?.getAttribute('data-state')).toBe('stalled');
  });

  it('a coord frame that could not measure the pause does not pause a box (F6 ii)', () => {
    const store = mount();
    const f = quietFleet(NOW - 3 * HOUR);
    act(() => { store.setState({ ...frames(active(f.sessions), f.runs), ...coordFrame('unmeasurable') }); });
    expect(boxOf(document)?.getAttribute('data-state')).toBe('stalled');
  });

  it('a box 2h 30m quiet stays moving under the frame\'s 3 h quiet time, so no default sets the threshold (F6 iii)', () => {
    const store = mount();
    const f = quietFleet(NOW - 150 * MIN);
    act(() => { store.setState({ ...frames(active(f.sessions), f.runs), stallQuietMs: 3 * HOUR }); });
    expect(boxOf(document)?.getAttribute('data-state')).toBe('moving');
    expect(boxOf(document)?.querySelector('.pg-moved')?.textContent).toBe('moved 2h 30m ago');
  });

  it('a folded card that gains a stalled box with no frame changes its view-hold key, from `project-c:-0` to `project-c:-1` (D-6090; F1, F5)', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(NOW);
    const store = mount();
    const f = quietFleet(NOW - QUIET + MIN);
    const sessions = f.sessions.map((x) => ({ ...x, status: 'idle' as const, bucket: 'idle' as const }));
    act(() => { store.setState(frames(sessions, f.runs)); });
    expect(boxOf(document)).toBeNull();
    expect(holdKeys.at(-1)).toBe('project-c:-0');
    act(() => { vi.advanceTimersByTime(MIN + 1_000); });
    expect(boxOf(document)?.getAttribute('data-state')).toBe('stalled');
    expect(holdKeys.at(-1)).toBe('project-c:-1');
  });

  it('a folded card\'s view-hold key holds across a frame that changes no kept box, whatever the clock read (F5)', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(NOW);
    const store = mount();
    const f = quietFleet(NOW - QUIET + MIN);
    const sessions = f.sessions.map((x) => ({ ...x, status: 'idle' as const, bucket: 'idle' as const }));
    act(() => { store.setState(frames(sessions, f.runs)); });
    act(() => { vi.advanceTimersByTime(MIN + 1_000); });
    expect(holdKeys.at(-1)).toBe('project-c:-1');
    const renders = holdKeys.length;
    // The runs frame re-reads the clock (`boxNow` moves with the runs) but keeps the same boxes: the key must not move.
    act(() => { vi.advanceTimersByTime(5_000); });
    act(() => { store.setState({ runs: f.runs.map((r) => ({ ...r })) }); });
    expect(holdKeys.length).toBeGreaterThan(renders);
    expect(holdKeys.at(-1)).toBe('project-c:-1');
  });

  it('the readout agrees with the state from the boundary on, whatever its own clock last read (spec §2.5; F9)', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOW);
    const store = mount();
    const f = quietFleet(NOW - QUIET + 45_000);   // crosses 15 s after the readout's own 30 s tick
    act(() => { store.setState(frames(active(f.sessions), f.runs)); });
    expect(boxOf(document)?.querySelector('.pg-moved')?.textContent).toBe('moved 1h 59m ago');
    act(() => { vi.advanceTimersByTime(46_000); });
    expect(boxOf(document)?.getAttribute('data-state')).toBe('stalled');
    expect(boxOf(document)?.querySelector('.pg-moved')?.textContent).toBe('no move 2h');
  });
});

// PL5b: the chip on the programme box. "N waiting on you" beside the title, only when N is above zero, and a door to the
// programme's view. N is what the programme view's heading reads (ruling 14290): the programme's open items plus its sessions'
// questions. The list, the fleet's rows and its runs are the fleet store's (one list for every reader); the box reads its own
// programme's number. `fleet()`'s worker `w1` asks the operator, so the default fleet holds one question for `port-api`;
// `quiet()` is the same fleet with nobody asking.
describe('the waiting chip on a programme box (PL5b)', () => {
  const OPEN = (n: number, program = 'port-api') =>
    Array.from({ length: n }, (_v, i) => itemView({ id: 100 + i, program, title: `Item ${i}` }));
  const quiet = () => fleet(answeredByCoordinator());
  /** Put `items` on the store's list, with the fleet the box is drawn from heard (its rows and its runs). */
  const withList = (items: ReturnType<typeof itemView>[], from = quiet()): void => {
    act(() => useFleetStore.setState({
      waiting: waitingView({ items }), sessions: from.sessions, runs: from.runs, fleetFrameSeen: true, runsFrameSeen: true,
    }));
  };
  const chip = (c: Element): HTMLElement | null => c.querySelector<HTMLElement>('.pg-kicker .pg-waiting, .pg-kicker .pg-waiting-plain');
  afterEach(() => { act(() => useFleetStore.setState({ sessions: [], runs: [], fleetFrameSeen: false, runsFrameSeen: false })); });

  it('shows "N waiting on you" after the title when the programme has N open items', () => {
    withList(OPEN(3));
    const { sessions, runs } = quiet();
    const kicker = drawCard(sessions, runs, 'project-c').querySelector('.pg-kicker')!;
    const c = chip(kicker)!;
    expect(c.textContent).toContain('3 waiting on you');
    const title = kicker.querySelector('.pg-title')!;
    expect(title.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('counts its sessions\' questions with its open items: 2 items and 1 question read "3 waiting on you" on the box and 3 on the view (ruling 14290)', () => {
    const asking = fleet();
    withList(OPEN(2), asking);
    const box = drawCard(asking.sessions, asking.runs, 'project-c');
    expect(chip(box)!.textContent).toContain('3 waiting on you');
    cleanup();
    render(<ProgrammeScreen slug="port-api" store={useFleetStore} />);
    expect(screen.getByRole('heading', { name: 'Waiting on you · 3' })).toBeTruthy();
  });

  it('counts a question alone: a programme with no open item but one asking session still has a chip', () => {
    const asking = fleet();
    withList([], asking);
    expect(chip(drawCard(asking.sessions, asking.runs, 'project-c'))!.textContent).toContain('1 waiting on you');
  });

  it('draws no chip at zero: no list yet, no fleet frame yet, a list without this programme, or nothing but items being checked or done', () => {
    const { sessions, runs } = quiet();
    expect(chip(drawCard(sessions, runs, 'project-c'))).toBeNull(); // no list heard
    cleanup();
    withList(OPEN(2), quiet());
    act(() => useFleetStore.setState({ fleetFrameSeen: false })); // the list, but not the fleet's rows
    expect(chip(drawCard(sessions, runs, 'project-c'))).toBeNull();
    cleanup();
    withList(OPEN(2, 'another-programme'));
    expect(chip(drawCard(sessions, runs, 'project-c'))).toBeNull();
    cleanup();
    withList([itemView({ id: 1, program: 'port-api', state: 'checking', tickedAt: NOW }), itemView({ id: 2, program: 'port-api', state: 'done', closedAt: NOW })]);
    expect(chip(drawCard(sessions, runs, 'project-c'))).toBeNull();
    cleanup();
    withList([]);
    expect(chip(drawCard(sessions, runs, 'project-c'))).toBeNull();
  });

  it('counts only its own programme\'s open items', () => {
    withList([...OPEN(2), ...OPEN(5, 'another-programme')]);
    const { sessions, runs } = quiet();
    expect(chip(drawCard(sessions, runs, 'project-c'))!.textContent).toContain('2 waiting on you');
  });

  it('follows the list: the chip appears, changes and goes when the count does', () => {
    const { sessions, runs } = quiet();
    const c = drawCard(sessions, runs, 'project-c');
    expect(chip(c)).toBeNull();
    withList(OPEN(1));
    expect(chip(c)!.textContent).toContain('1 waiting on you');
    withList(OPEN(4));
    expect(chip(c)!.textContent).toContain('4 waiting on you');
    withList([]);
    expect(chip(c)).toBeNull();
  });

  it('is a door: a labelled button that opens the programme\'s view and nothing else on the box', () => {
    withList(OPEN(3));
    const { sessions, runs } = quiet();
    const c = drawCard(sessions, runs, 'project-c');
    const door = within(c).getByRole('button', { name: /3 waiting on you/ });
    expect(door.classList.contains('pg-waiting')).toBe(true);
    expect(door.getAttribute('aria-label')).toMatch(/port the api/i);
    expect(c.querySelectorAll('.pg-waiting')).toHaveLength(1);
    history.replaceState(null, '', '/');
    fireEvent.click(door);
    expect(location.pathname).toBe('/programmes/port-api');
    expect(c.querySelector('.pg-foot button')?.getAttribute('aria-expanded'), 'the footer toggle is untouched').toBe('false');
    history.replaceState(null, '', '/');
  });

  it.each(['Build_4', 'pA', 'build_4-name'])('is a door to the view for the programme %s, a slug the server accepts that the first route refused', (slug) => {
    const f = quiet();
    const from = { sessions: f.sessions, runs: f.runs.map((r) => ({ ...r, program: slug })) };
    withList(OPEN(2, slug), from);
    const c = drawCard(from.sessions, from.runs, 'project-c');
    const door = within(c).getByRole('button', { name: /2 waiting on you/ });
    history.replaceState(null, '', '/');
    fireEvent.click(door);
    expect(location.pathname).toBe(`/programmes/${slug}`);
    expect(matchRoute(location.pathname)?.route.id).toBe('programme');
    expect(matchRoute(location.pathname)?.param).toBe(slug);
    history.replaceState(null, '', '/');
  });

  it('draws a plain count, no door, for a slug the programme view would refuse (the owner\'s grammar has no dot)', () => {
    const f = quiet();
    const from = { sessions: f.sessions, runs: f.runs.map((r) => ({ ...r, program: 'old.name' })) };
    withList(OPEN(2, 'old.name'), from);
    const c = drawCard(from.sessions, from.runs, 'project-c');
    const plain = chip(c)!;
    expect(plain.textContent).toContain('2 waiting on you');
    expect(plain.tagName).not.toBe('BUTTON');
    expect(within(c).queryByRole('button', { name: /waiting on you/ })).toBeNull();
    history.replaceState(null, '', '/');
    fireEvent.click(plain);
    expect(location.pathname).toBe('/');
  });

  it('names the real count to a screen reader past the cap: 150 items read "150 waiting on you" in the label, "99+" on screen', () => {
    withList(OPEN(150));
    const { sessions, runs } = quiet();
    const c = drawCard(sessions, runs, 'project-c');
    const door = within(c).getByRole('button', { name: /150 waiting on you/ });
    expect(door.getAttribute('aria-label')).toMatch(/^150 waiting on you: open /);
    expect(door.textContent).toContain('99+ waiting on you');
    expect(door.textContent).not.toContain('150');
  });

  // Carry C (D-7951), review 1388's advisories: the plain count says the real number to a screen reader, as the door's label
  // does, and the chip spells its unit once, the navigation badge's (`WAITING_BADGE_UNIT`), for the figure drawn and spoken.
  it('a plain count past the cap says the real count to a screen reader: "99+" is drawn and hidden, "150 waiting on you" is said', () => {
    const f = quiet();
    const from = { sessions: f.sessions, runs: f.runs.map((r) => ({ ...r, program: 'old.name' })) };
    withList(OPEN(150, 'old.name'), from);
    const plain = chip(drawCard(from.sessions, from.runs, 'project-c'))!;
    expect(plain.classList.contains('pg-waiting-plain')).toBe(true);
    const hidden = plain.querySelector('[aria-hidden="true"]')!;
    expect(hidden.textContent).toBe('99+ waiting on you');
    // What a screen reader reads: the chip's text less what is hidden from it.
    const said = [...plain.childNodes].filter((n) => !(n instanceof Element && n.getAttribute('aria-hidden') === 'true'))
      .map((n) => n.textContent).join('');
    expect(said).toBe('150 waiting on you');
  });

  it('spells "waiting on you" nowhere in its own source: the words are the navigation badge\'s unit, read once', () => {
    const src = readFileSync(path.join(__dirname, '../src/fleet/ProgrammeBox.tsx'), 'utf8')
      .split('\n').filter((l) => !/^\s*(\/\/|\/?\*)/.test(l)).join('\n');
    expect(src).not.toMatch(/waiting on you/);
    expect(src).toMatch(/WAITING_BADGE_UNIT/);
  });

  it('prints its widest count as "99+", the one width the layout is measured at', () => {
    withList(OPEN(250));
    const { sessions, runs } = quiet();
    const c = chip(drawCard(sessions, runs, 'project-c'))!;
    expect(c.textContent).toContain('99+ waiting on you');
    expect(c.textContent).not.toContain('250');
  });
});

// Desktop-polish PL10, D26 amended (D-7952; the operator's steer of 2026-11-04, "where in the UI, for each coordinator, can I
// see that spec?"): every programme box is a door into its programme view whatever its count (its title), and links its pinned
// spec from the waiting frame's Goals, the programme view's own source (`isGoalsFor`), with no fetch of its own.
describe('every programme box opens its view and links its spec (PL10, D26 amended)', () => {
  const SPEC = 'docs/superpowers/specs/2026-10-31-port-api-design.md';
  const goals = (over: Record<string, unknown> = {}) => ({ program: 'port-api', specPath: SPEC, inShort: null, inShortAt: null, modifications: [], ...over });
  /** The fleet, its runs naming a home project, and the list as given, heard. */
  const heard = (list: ReturnType<typeof waitingView> | null) => {
    const f = fleet(answeredByCoordinator());
    const runs = f.runs.map((r) => ({ ...r, homeProject: 'project-a' }));
    act(() => useFleetStore.setState({ waiting: list, sessions: f.sessions, runs, fleetFrameSeen: true, runsFrameSeen: true }));
    return { sessions: f.sessions, runs };
  };
  const titleDoor = (c: Element): HTMLAnchorElement | null => c.querySelector<HTMLAnchorElement>('.pg-kicker a.pg-title-door');
  afterEach(() => {
    act(() => useFleetStore.setState({ sessions: [], runs: [], fleetFrameSeen: false, runsFrameSeen: false }));
    history.replaceState(null, '', '/');
  });

  it('a programme box with nothing waiting opens its programme view', () => {
    const { sessions, runs } = heard(waitingView());
    const c = drawCard(sessions, runs, 'project-c');
    expect(c.querySelector('.pg-waiting'), 'no chip at zero').toBeNull();
    const door = within(c).getByRole('link', { name: 'Port the API' });
    expect(door).toBe(titleDoor(c));
    expect(door.getAttribute('href')).toBe('/programmes/port-api');
    expect(door.querySelector('.pg-title')?.textContent).toBe('Port the API');
    fireEvent.click(door);
    expect(location.pathname).toBe('/programmes/port-api');
    expect(c.querySelector('.pg-foot button')?.getAttribute('aria-expanded'), 'the footer toggle is untouched').toBe('false');
  });

  it('a slug the view refuses keeps its title as plain text', () => {
    const f = fleet(answeredByCoordinator());
    const runs = f.runs.map((r) => ({ ...r, program: 'a.b' }));
    act(() => useFleetStore.setState({ waiting: waitingView(), sessions: f.sessions, runs, fleetFrameSeen: true, runsFrameSeen: true }));
    const c = drawCard(f.sessions, runs, 'project-c');
    expect(titleDoor(c)).toBeNull();
    expect(c.querySelector('.pg-kicker .pg-title')).not.toBeNull();
  });

  it('a programme box with a pin links its spec, and none without', () => {
    const pinned = heard(waitingView({ goals: [goals()] }));
    const c = drawCard(pinned.sessions, pinned.runs, 'project-c');
    const spec = within(c).getByRole('link', { name: 'Spec for Port the API' });
    expect(spec.getAttribute('href')).toBe('/docs/project-a/specs/2026-10-31-port-api-design.md');
    fireEvent.click(spec);
    expect(location.pathname).toBe('/docs/project-a/specs/2026-10-31-port-api-design.md');
    cleanup();
    for (const list of [null, waitingView(), waitingView({ goals: [goals({ specPath: null })] }),
      waitingView({ goals: [goals({ modifications: null })] }), waitingView({ goals: [goals({ program: 'another-programme' })] })]) {
      const at = heard(list);
      const box = drawCard(at.sessions, at.runs, 'project-c');
      expect(within(box).queryByRole('link', { name: /^Spec/ }), JSON.stringify(list?.goals ?? null)).toBeNull();
      cleanup();
    }
  });

  it('the waiting chip is unchanged above zero', () => {
    const list = waitingView({ items: Array.from({ length: 3 }, (_v, i) => itemView({ id: 100 + i, program: 'port-api' })), goals: [goals()] });
    const { sessions, runs } = heard(list);
    const c = drawCard(sessions, runs, 'project-c');
    const chip = within(c).getByRole('button', { name: /3 waiting on you/ });
    expect(chip.classList.contains('pg-waiting')).toBe(true);
    expect(chip.getAttribute('aria-label')).toBe('3 waiting on you: open Port the API');
    expect(chip.textContent).toContain('3 waiting on you');
    // The title door and the spec link sit beside it, and the chip stays the box's one button to the view.
    expect(titleDoor(c)!.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(c.querySelectorAll('.pg-kicker button')).toHaveLength(1);
    fireEvent.click(chip);
    expect(location.pathname).toBe('/programmes/port-api');
  });
});
