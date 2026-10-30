// A programme as a box in its project card (Task G2), as the card draws the decider's answer (`programmeBoxes.ts`,
// pinned in `programme-box.test.ts`). One component in both skins: the card is drawn alone here, over the fleet tree
// and the rollup exactly as `FleetCards` builds them, and the fold's storage is checked through each skin's own list.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { INSTRUMENT, REFINED, type SkinId } from '@ccrc/ui';
import type { FleetSession, RunSummary, UpdatesView } from '../../shared/api';
import { fleetTree } from '../src/fleet/fleetTree';
import { NO_ROLLUP_PREFS, rollupFleet, type RollupPrefs } from '../src/fleet/rollup';
import { ProjectCard } from '../src/fleet/ProjectCard';
import { assignHues } from '../src/fleet/programmeBoxes';
import { api } from '../src/lib/api';
import { resetAcks } from '../src/lib/seen';
import { setSkin } from '../src/lib/skin';
import { SKIN_SETS } from '../src/skins';
import { createFleetStore } from '../src/stores/fleet';
import { renderFleet } from './fleetHost';
import { withRunBinding } from './runBindingFixture';
import { HOUR, MIN, NOW, answeredByCoordinator, asking, run, sess } from './rollupFixture';

const noop = (): void => {};

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
});
