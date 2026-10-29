// A programme as a box in its project card (Task G2), as the card draws the decider's answer (`programmeBox.ts`,
// pinned in `programme-box.test.ts`). One component in both skins: the card is drawn alone here, over the fleet tree
// and the rollup exactly as `FleetCards` builds them, and the fold's storage is checked through each skin's own list.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { INSTRUMENT, REFINED, type SkinId } from '@ccrc/ui';
import type { FleetSession, RunSummary, UpdatesView } from '../../shared/api';
import { fleetTree } from '../src/fleet/fleetTree';
import { NO_ROLLUP_PREFS, rollupFleet, type RollupPrefs } from '../src/fleet/rollup';
import { ProjectCard } from '../src/fleet/ProjectCard';
import { assignHues } from '../src/fleet/programmeBox';
import { api } from '../src/lib/api';
import { resetAcks } from '../src/lib/seen';
import { setSkin } from '../src/lib/skin';
import { SKIN_SETS } from '../src/skins';
import { createFleetStore } from '../src/stores/fleet';
import { renderFleet } from './fleetHost';
import { HOUR, NOW, answeredByCoordinator, asking, run, sess } from './rollupFixture';

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
  return { sessions: [coord, ...kids, ...lone], runs };
}

function drawCard(
  sessions: FleetSession[], runs: RunSummary[], project: string,
  { prefs = NO_ROLLUP_PREFS, collapsed }: { prefs?: RollupPrefs; collapsed?: boolean } = {},
): HTMLElement {
  const tree = fleetTree(sessions, [], runs);
  const g = tree.find((x) => x.project === project);
  if (g === undefined) throw new Error(`no card ${project}`);
  const rollup = collapsed === undefined ? rollupFleet(tree, prefs, NOW, null).cards.get(project) : undefined;
  const { container } = render(
    <ProjectCard group={g} rollup={rollup} collapsed={collapsed} runs={g.runs} abroad={g.abroad} nowMs={NOW}
      onOpen={noop} onActions={noop} onToggleChildren={noop} />,
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
});
