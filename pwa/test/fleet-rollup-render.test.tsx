// The fleet rollup as each skin's fleet list renders it (D-6088). The decider has its own skin-independent suite
// (`rollup.test.ts`); this one mounts each skin's own fleet part (`SKIN_SETS[skin].Nav`) over the same fleet, so a
// restyle that stops reading the decider — renders every project open, or every worker as a row — goes red here.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { INSTRUMENT, REFINED, type SkinId } from '@ccrc/ui';
import type { UpdatesView } from '../../shared/api';
import { api } from '../src/lib/api';
import { resetAcks } from '../src/lib/seen';
import { setSkin } from '../src/lib/skin';
import { SKIN_SETS } from '../src/skins';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { renderFleet } from './fleetHost';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FleetScreen } from '../src/screens/FleetScreen';
import { HOUR, MIN, NOW, asking, coordinatorFleet, sess } from './rollupFixture';
import { activity, frame } from './delegationFixture';
import { NEST_BRACKET } from '../src/fleet/ProjectCard';

const makeStore = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
});

beforeEach(() => {
  window.localStorage.clear();
  resetAcks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.spyOn(api, 'updates').mockReturnValue(new Promise<UpdatesView>(() => {}));
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A quiet project, a working one, and a coordinator whose fifth worker has a question nobody intercepted. */
function mount(skin: SkinId): FleetStore {
  act(() => setSkin(skin));
  const store = makeStore();
  const Nav = SKIN_SETS[skin].Nav;
  if (Nav === null) throw new Error(`${skin} places no fleet list`);
  renderFleet(<Nav />, store);
  const { sessions, runs } = coordinatorFleet(asking());
  act(() => {
    store.setState({
      conn: 'open', fleetFrameSeen: true, runsFrameSeen: true, runs,
      sessions: [
        sess('quiet-one', 'project-a', { statusUpdatedAt: NOW - 3 * HOUR, bucketSince: NOW - 3 * HOUR }),
        sess('busy-one', 'project-b', { status: 'busy', bucket: 'working', bucketSince: NOW - HOUR }),
        ...sessions,
      ],
    });
  });
  return store;
}

const cardOf = (project: string): HTMLElement => {
  const name = screen.getAllByText(project).find((el) => el.classList.contains('proj-card-name'));
  const card = name?.closest('section');
  if (!card) throw new Error(`no card ${project}`);
  return card as HTMLElement;
};

/** The card's own ▾ (the `+` beside it names the project too). */
const toggleOf = (card: HTMLElement): HTMLElement => {
  const t = card.querySelector<HTMLElement>('.proj-card-toggle');
  if (t === null) throw new Error('no toggle');
  return t;
};

describe.each([REFINED, INSTRUMENT] as const)('the fleet rollup in the %s fleet list', (skin) => {
  it('rolls up the inactive project to its header, which says when it was last active', () => {
    mount(skin);
    const quiet = cardOf('project-a');
    expect(quiet.getAttribute('data-collapsed')).toBe('true');
    expect(toggleOf(quiet).getAttribute('aria-expanded')).toBe('false');
    expect(within(quiet).getByText('active 3h ago')).toBeTruthy();
    expect(quiet.querySelector('.sess-line')).toBeNull();
  });

  it('keeps the active project open', () => {
    mount(skin);
    const busy = cardOf('project-b');
    expect(busy.getAttribute('data-collapsed')).toBeNull();
    expect(busy.querySelectorAll('.sess-line')).toHaveLength(1);
  });

  // Task G2: the coordinator's workers fold into its programme box, and the box's footer is the one toggle
  // that was the separate summary line.
  it('folds the workers into the programme box and keeps the one with the operator\'s question in its tray', () => {
    mount(skin);
    const c = cardOf('project-c');
    expect(c.getAttribute('data-collapsed')).toBeNull();
    const box = c.querySelector<HTMLElement>('section.pg-box')!;
    const line = within(box).getByRole('button', { name: '4 more workers · 2 working' });
    expect(line.getAttribute('aria-expanded')).toBe('false');
    // The coordinator and the asking worker: two rows, the four quiet siblings folded away.
    expect(c.querySelectorAll('.sess-line')).toHaveLength(2);
    expect(box.querySelector('.pg-tray .sess-label')?.textContent).toBe('w5');
    fireEvent.click(line);
    expect(c.querySelectorAll('.sess-line')).toHaveLength(6);
  });

  it('draws each count of the footer as one unbreakable part, and never counts the worker it draws', () => {
    mount(skin);
    const line = within(cardOf('project-c')).getByRole('button', { name: /more workers/ });
    const parts = [...line.querySelectorAll('.proj-children-part')].map((el) => el.textContent);
    // The worker that needs you is in the tray, with its ask, so the footer counts only what it hides.
    expect(parts).toEqual(['4 more workers', '2 working']);
    const css = readFileSync(join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');
    expect(css).toMatch(/\.proj-children-part\s*\{[^}]*white-space:\s*nowrap/);
  });

  it('keeps a held-open project\'s ▾ in the tab order and says why it does nothing', () => {
    mount(skin);
    const t = toggleOf(cardOf('project-c'));
    expect(t.hasAttribute('disabled')).toBe(false);
    expect(t.getAttribute('aria-disabled')).toBe('true');
    expect(t.getAttribute('title')).toBeNull();
    expect(within(t).getByText(/held open: a question here is waiting on you/)).toBeTruthy();
    fireEvent.click(t);
    expect(cardOf('project-c').getAttribute('data-collapsed')).toBeNull();
  });

  it('opens a rolled-up project on the operator\'s tap, and keeps it open across a remount', () => {
    mount(skin);
    fireEvent.click(toggleOf(cardOf('project-a')));
    expect(cardOf('project-a').getAttribute('data-collapsed')).toBeNull();
    cleanup();
    mount(skin);
    expect(cardOf('project-a').getAttribute('data-collapsed')).toBeNull();
  });

  it('W4-U31: a folded coordinator counts two live activities in its line and hides them; expanded, both nest', () => {
    const store = mount(skin);
    act(() => {
      store.setState({ delegation: frame({ activities: [
        activity({ activityId: 'a1', parentId: 'coord', displayName: 'map the tree' }),
        activity({ activityId: 'a2', parentId: 'coord', displayName: 'read the plan', openedAt: '2026-10-26T10:01:00.000Z' }),
      ] }) });
    });
    const c = cardOf('project-c');
    // Task G2: the line is the programme box's footer, which counts what the tray hides: the four quiet workers, then
    // the two activities, never as workers.
    const line = within(c.querySelector<HTMLElement>('section.pg-box')!).getByRole('button', { name: /more workers/ });
    expect([...line.querySelectorAll('.proj-children-part')].map((el) => el.textContent))
      .toEqual(['4 more workers', '2 working', '2 delegated']);
    expect(c.querySelectorAll('.proj-work')).toHaveLength(0);
    fireEvent.click(line);
    const rows = [...cardOf('project-c').querySelectorAll('.proj-work')];
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.closest('.proj-nest')?.querySelector('.proj-nest-bracket')?.textContent).toBe(NEST_BRACKET);
  });
});

describe('the fleet rollup on the fleet screen both skins place', () => {
  const store = (): FleetStore => makeStore();

  it('rolls a project up when its 30-minute window closes, even after a frame landed between clock ticks', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const st = store();
    renderFleet(<FleetScreen store={st} />, st);
    const mk = () => [
      sess('x1', 'project-x', { statusUpdatedAt: NOW - 29.5 * MIN, bucketSince: NOW - 29.5 * MIN }),
      sess('busy', 'project-b', { status: 'busy', bucket: 'working', bucketSince: NOW - HOUR }),
    ];
    act(() => { st.setState({ conn: 'open', fleetFrameSeen: true, runsFrameSeen: true, sessions: mk() }); });
    expect(cardOf('project-x').getAttribute('data-collapsed')).toBeNull();
    act(() => { vi.setSystemTime(NOW + 40_000); st.setState({ sessions: mk() }); });
    expect(cardOf('project-x').getAttribute('data-collapsed')).toBe('true');
    act(() => { vi.advanceTimersByTime(HOUR); });
    expect(cardOf('project-x').getAttribute('data-collapsed')).toBe('true');
  });

  it('rolls a project up at its window\'s end with no frame at all', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const st = store();
    renderFleet(<FleetScreen store={st} />, st);
    act(() => {
      st.setState({ conn: 'open', fleetFrameSeen: true, runsFrameSeen: true, sessions: [
        sess('x1', 'project-x', { statusUpdatedAt: NOW - 29.5 * MIN, bucketSince: NOW - 29.5 * MIN }),
      ] });
    });
    expect(cardOf('project-x').getAttribute('data-collapsed')).toBeNull();
    act(() => { vi.advanceTimersByTime(MIN); });
    expect(cardOf('project-x').getAttribute('data-collapsed')).toBe('true');
  });

  it('shows the open session inside a quiet project (a deep link or a jump into it)', () => {
    const st = store();
    renderFleet(<FleetScreen store={st} selectedId="q1" />, st);
    act(() => {
      st.setState({ conn: 'open', fleetFrameSeen: true, runsFrameSeen: true, sessions: [
        sess('q1', 'project-q', { statusUpdatedAt: NOW - 3 * HOUR, bucketSince: NOW - 3 * HOUR }),
      ] });
    });
    expect(cardOf('project-q').getAttribute('data-collapsed')).toBeNull();
    expect(cardOf('project-q').querySelector('.sess-line')).not.toBeNull();
  });
});
