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
import { HOUR, NOW, asking, coordinatorFleet, sess } from './rollupFixture';

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

  it('folds the workers to one line and keeps the one with the operator\'s question as its own row', () => {
    mount(skin);
    const c = cardOf('project-c');
    expect(c.getAttribute('data-collapsed')).toBeNull();
    const line = within(c).getByRole('button', { name: /5 workers · 2 working · 2 idle · 1 needs you/ });
    expect(line.getAttribute('aria-expanded')).toBe('false');
    // The coordinator and the asking worker: two rows, the three quiet siblings folded away.
    expect(c.querySelectorAll('.sess-line')).toHaveLength(2);
    fireEvent.click(line);
    expect(c.querySelectorAll('.sess-line')).toHaveLength(6);
  });

  it('opens a rolled-up project on the operator\'s tap, and keeps it open across a remount', () => {
    mount(skin);
    fireEvent.click(toggleOf(cardOf('project-a')));
    expect(cardOf('project-a').getAttribute('data-collapsed')).toBeNull();
    cleanup();
    mount(skin);
    expect(cardOf('project-a').getAttribute('data-collapsed')).toBeNull();
  });
});
