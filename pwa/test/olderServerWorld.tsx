// W4-U27's world (delegation broker wave 4, PR2 Task 2.7, spec §5.13; review 1029's F1): an older server's frame
// sequence on a fixed clock, rendered by the whole fleet screen and by Instrument's fleet list, with every request left
// unanswered so nothing lands after the frames. It imports only modules PR2's base (7dc486b97) already has, unchanged,
// so this one function rendered the base's code into `fixtures/older-server/render-7dc486b97.json` and renders
// today's code in `older-server-render.test.tsx`. It returns markup as rendered: what may differ is the test's to say.
import { act, cleanup, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import { FLEET_PROTO, FLEET_PROTO_MIN, type UpdatesView } from '../../shared/api';
import { api } from '../src/lib/api';
import { resetAcks } from '../src/lib/seen';
import { setSkin } from '../src/lib/skin';
import { SKIN_SETS } from '../src/skins';
import { createFleetStore } from '../src/stores/fleet';
import { FleetScreen } from '../src/screens/FleetScreen';
import { renderFleet } from './fleetHost';
import { HOUR, MIN, NOW, asking, coordinatorFleet, run, sess } from './rollupFixture';

/** The views captured, in order: rows hydrated before the socket speaks, the frames applied, two folds opened, and
 *  Instrument's own fleet table over the same store. */
export const WORLD_VIEWS = ['cold', 'connected', 'opened', 'instrument'] as const;
export type WorldView = (typeof WORLD_VIEWS)[number];

class WorldSocket {
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  close(): void {}
  open(): void { this.onopen?.(new Event('open')); }
  message(data: unknown): void { this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent); }
}

/** A quiet project, a working one, a coordinator whose five workers fold into one line (one of them asking), and a
 *  coordinator whose one worker, a workspace of another project, sits on the coordinator's card (`boardProject`). */
function world() {
  const folded = coordinatorFleet(asking());
  const sessions = [
    sess('quiet-one', 'project-a', { statusUpdatedAt: NOW - 3 * HOUR, bucketSince: NOW - 3 * HOUR }),
    sess('busy-one', 'project-b', { status: 'busy', bucket: 'working', bucketSince: NOW - HOUR, statusUpdatedAt: NOW - 2 * MIN }),
    ...folded.sessions,
    sess('coord-e', 'project-e', { role: 'coordinator', status: 'busy', bucket: 'working', bucketSince: NOW - 2 * HOUR }),
    sess('w-e1', 'project-f', {
      role: 'child', child: { kind: 'child', runId: 20 }, boardProject: 'project-e', status: 'busy', bucket: 'working',
      bucketSince: NOW - 30 * MIN,
    }),
  ];
  const runs = [...folded.runs, run(20, 'coord-e', 'w-e1', { project: 'project-f', state: 'working' })];
  return { sessions, runs };
}

const cardOf = (project: string): Element => {
  const card = [...document.querySelectorAll('.proj-card')]
    .find((c) => c.querySelector('.proj-card-name')?.textContent === project);
  if (card === undefined) throw new Error(`no card for ${project}`);
  return card;
};

const click = (el: Element | null | undefined, what: string): void => {
  if (el === null || el === undefined) throw new Error(`no ${what}`);
  fireEvent.click(el);
};

export function renderOlderServerWorld(): Record<WorldView, string> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  window.localStorage.clear();
  resetAcks();
  const updates = vi.spyOn(api, 'updates').mockReturnValue(new Promise<UpdatesView>(() => {}));
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  const sockets: WorldSocket[] = [];
  const store = createFleetStore({ makeSocket: () => { const s = new WorldSocket(); sockets.push(s); return s as unknown as WebSocket; } });
  const { sessions, runs } = world();
  try {
    renderFleet(<FleetScreen store={store} />);
    act(() => { store.setState({ sessions }); });
    const cold = document.body.innerHTML;
    act(() => {
      const s = sockets[sockets.length - 1];
      if (s === undefined) throw new Error('the screen opened no fleet socket');
      s.open();
      s.message({ type: 'hello', proto: FLEET_PROTO, min: FLEET_PROTO_MIN });
      s.message({ type: 'fleet', sessions });
      s.message({ type: 'runs', runs });
      s.message({ type: 'coord', coord: { pause: 'clear', mail: 'clear' } });
      s.message({ type: 'pools', pools: { listed: false, enforcement: 'enforced' } });
      s.message({ type: 'divergence', divergences: [] });
    });
    const connected = document.body.innerHTML;
    click(cardOf('project-a').querySelector('.proj-card-toggle'), 'card toggle on project-a');
    click(cardOf('project-c').querySelector('.proj-children-toggle'), 'workers line on project-c');
    const opened = document.body.innerHTML;
    cleanup();
    act(() => setSkin(INSTRUMENT));
    const Table = SKIN_SETS[INSTRUMENT].FleetList;
    if (Table === null) throw new Error('Instrument places no fleet table');
    renderFleet(<Table />, store);
    const instrument = document.body.innerHTML;
    return { cold, connected, opened, instrument };
  } finally {
    cleanup();
    act(() => setSkin(REFINED));
    store.getState().disconnect();
    window.localStorage.clear();
    updates.mockRestore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
}
