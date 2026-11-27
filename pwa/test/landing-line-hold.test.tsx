// Landing order wave 5k, Task 7 (F8, R8): a card's landing block joins `FleetCards`' view-hold key, on
// `programme-box-card.test.tsx`'s pattern (`useHoldView` mocked to record its key) with `useLandingLines` mocked to answer
// fixed states. A card with no block keeps exactly today's part.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import type { UpdatesView } from '../../shared/api';
import { FleetCards } from '../src/fleet/FleetCards';
import type { LandingCardState } from '../src/fleet/landingLineView';
import { api } from '../src/lib/api';
import { resetAcks } from '../src/lib/seen';
import { createFleetStore } from '../src/stores/fleet';
import { renderFleet } from './fleetHost';
import { sess } from './rollupFixture';
import { LANDING_ROUTE_WORDS } from '../src/fleet/landingWords';
import { lineView, stateOf } from './landingLineFixture';

const holdKeys = vi.hoisted((): string[] => []);
vi.mock('../src/fleet/useHoldView', async (load) => {
  const real = await load<typeof import('../src/fleet/useHoldView')>();
  return { useHoldView: (...args: Parameters<typeof real.useHoldView>): void => { holdKeys.push(args[1]); real.useHoldView(...args); } };
});
const lines = vi.hoisted(() => ({ states: new Map<string, unknown>() as ReadonlyMap<string, unknown>, reload: (): void => {} }));
vi.mock('../src/fleet/useLandingLines', () => ({ LANDING_LINE_POLL_MS: 60_000, useLandingLines: () => lines }));

beforeEach(() => {
  window.localStorage.clear();
  resetAcks();
  holdKeys.length = 0;
  lines.states = new Map();
  vi.spyOn(api, 'updates').mockReturnValue(new Promise<UpdatesView>(() => {}));
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const noop = (): void => {};
const partOf = (key: string, project: string): string => key.split('|').find((p) => p.startsWith(`${project}:`)) ?? '<none>';

describe('the landing part of the view-hold key (F8, R8)', () => {
  it('a card with section 5\'s line gains ~5r, then ~5rs once stale, then ~5p once paused; a card with no block keeps today\'s part', () => {
    const store = createFleetStore({
      makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
    });
    store.setState({ conn: 'open', fleetFrameSeen: true, runsFrameSeen: true, runs: [], sessions: [sess('lane-a-one', 'project-a'), sess('lane-b-one', 'project-b')] });
    const view = renderFleet(<FleetCards selectedId={null} onOpen={noop} />, store);
    const today = holdKeys.at(-1)!;
    expect(partOf(today, 'project-a')).not.toContain('~');
    expect(partOf(today, 'project-b')).not.toContain('~');

    const running = stateOf(lineView());
    lines.states = new Map<string, LandingCardState>([['project-a', running], ['project-b', { kind: 'none' }]]);
    view.rerender(<FleetCards selectedId={null} onOpen={noop} />);
    expect(partOf(holdKeys.at(-1)!, 'project-a')).toBe(`${partOf(today, 'project-a')}~5r`);
    expect(partOf(holdKeys.at(-1)!, 'project-b')).toBe(partOf(today, 'project-b'));

    if (running.kind !== 'line') throw new Error('not a line');
    lines.states = new Map<string, LandingCardState>([['project-a', { ...running, stale: { text: LANDING_ROUTE_WORDS['landing-fenced'].text, scope: 'box', outcomeUnknown: false } }]]);
    view.rerender(<FleetCards selectedId={null} onOpen={noop} />);
    expect(partOf(holdKeys.at(-1)!, 'project-a')).toBe(`${partOf(today, 'project-a')}~5rs`);

    lines.states = new Map<string, LandingCardState>([['project-a', stateOf(lineView({ operatorPaused: true }, { paused: true, by: ['operator'], head: undefined } as never))]]);
    view.rerender(<FleetCards selectedId={null} onOpen={noop} />);
    expect(partOf(holdKeys.at(-1)!, 'project-a')).toBe(`${partOf(today, 'project-a')}~5p`);
    expect(holdKeys.at(-1)).toBe(today.replace(partOf(today, 'project-a'), `${partOf(today, 'project-a')}~5p`));
  });
});
