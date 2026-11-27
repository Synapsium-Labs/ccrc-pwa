// Landing order wave 5k, Task 7 (F8, R8): a card's landing block joins `FleetCards`' view-hold key, on
// `programme-box-card.test.tsx`'s pattern (`useHoldView` mocked to record its key) with `useLandingLines` mocked to answer
// fixed states. A card with no block keeps exactly today's part.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { UpdatesView } from '../../shared/api';
import { FleetCards } from '../src/fleet/FleetCards';
import { resetLandingLineOpen } from '../src/fleet/foldState';
import type { LandingCardState } from '../src/fleet/landingLineView';
import { api } from '../src/lib/api';
import { resetAcks } from '../src/lib/seen';
import { createFleetStore } from '../src/stores/fleet';
import { renderFleet } from './fleetHost';
import { sess } from './rollupFixture';
import { LANDING_ROUTE_WORDS, LINE_TITLE, WITHDRAW_LABEL } from '../src/fleet/landingWords';
import { lineView, stateOf } from './landingLineFixture';

const holdKeys = vi.hoisted((): string[] => []);
vi.mock('../src/fleet/useHoldView', async (load) => {
  const real = await load<typeof import('../src/fleet/useHoldView')>();
  return { useHoldView: (...args: Parameters<typeof real.useHoldView>): void => { holdKeys.push(args[1]); real.useHoldView(...args); } };
});
const lines = vi.hoisted(() => ({ states: new Map<string, unknown>() as ReadonlyMap<string, unknown>, reload: (): void => {} }));
vi.mock('../src/fleet/useLandingLines', () => ({ LANDING_LINE_POLL_MS: 60_000, useLandingLines: () => lines }));

beforeEach(() => {
  resetLandingLineOpen();
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
const regionOf = (project: string): HTMLElement => screen.getByRole('region', { name: `Landing line of ${project}` });
/** The block's disclosure (desktop polish wave 192). */
const toggleOf = (project: string): HTMLElement => within(regionOf(project)).getByRole('button', { name: LINE_TITLE });
const fleetStore = (): ReturnType<typeof createFleetStore> => {
  const store = createFleetStore({
    makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
  });
  store.setState({ conn: 'open', fleetFrameSeen: true, runsFrameSeen: true, runs: [], sessions: [sess('lane-a-one', 'project-a'), sess('lane-b-one', 'project-b')] });
  return store;
};

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
    // Desktop polish wave 192: the one added tap, which opens project-a's block, so the parts below are the open block's.
    fireEvent.click(toggleOf('project-a'));
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

// Desktop polish wave 192: the block starts rolled up, and its part of the key is the rolled-up block's until the
// operator opens it; the choice is kept per project for the page's life (`foldState.ts`), whatever unmounts meanwhile.
describe('the rolled-up block on the fleet\'s cards (wave 192)', () => {
  const withdrawOf = (pr: number): HTMLElement | null => screen.queryByRole('button', { name: WITHDRAW_LABEL(pr, 'project-a') });
  const isOpen = (): boolean => toggleOf('project-a').getAttribute('aria-expanded') === 'true' && withdrawOf(104) !== null;

  it('rolled up on first draw: its part is c5r; a tap opens it (5r) and closes it again (c5r), the other card untouched', () => {
    lines.states = new Map<string, LandingCardState>([['project-a', stateOf(lineView())], ['project-b', stateOf(lineView({ project: 'project-b' }))]]);
    renderFleet(<FleetCards selectedId={null} onOpen={noop} />, fleetStore());
    const base = partOf(holdKeys.at(-1)!, 'project-a').split('~')[0];
    expect(partOf(holdKeys.at(-1)!, 'project-a')).toBe(`${base}~c5r`);
    expect(toggleOf('project-a').getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggleOf('project-a'));
    expect(partOf(holdKeys.at(-1)!, 'project-a')).toBe(`${base}~5r`);
    expect(partOf(holdKeys.at(-1)!, 'project-b')).toMatch(/~c5r$/);
    expect(toggleOf('project-b').getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggleOf('project-a'));
    expect(partOf(holdKeys.at(-1)!, 'project-a')).toBe(`${base}~c5r`);
  });

  it('a change nobody sees rolled up keeps the key: a re-read whose only change is a sent-back reason', () => {
    lines.states = new Map<string, LandingCardState>([['project-a', stateOf(lineView())]]);
    const view = renderFleet(<FleetCards selectedId={null} onOpen={noop} />, fleetStore());
    const before = holdKeys.at(-1)!;
    const moved = lineView({ entries: lineView().entries.map((x) => (x.pr === 102 ? { ...x, ejectionKind: 'conflict' as const } : x)) });
    lines.states = new Map<string, LandingCardState>([['project-a', stateOf(moved)]]);
    view.rerender(<FleetCards selectedId={null} onOpen={noop} />);
    expect(holdKeys.at(-1)).toBe(before);
  });

  it('opened, it stays open across a re-read, the card folding and unfolding, and the block going and coming back', () => {
    lines.states = new Map<string, LandingCardState>([['project-a', stateOf(lineView())]]);
    const view = renderFleet(<FleetCards selectedId={null} onOpen={noop} />, fleetStore());
    fireEvent.click(toggleOf('project-a'));
    expect(isOpen()).toBe(true);
    // A re-read: a new state object for the same line, then one with a row fewer.
    lines.states = new Map<string, LandingCardState>([['project-a', stateOf(lineView())]]);
    view.rerender(<FleetCards selectedId={null} onOpen={noop} />);
    expect(isOpen()).toBe(true);
    lines.states = new Map<string, LandingCardState>([['project-a', stateOf(lineView({ entries: lineView().entries.filter((x) => x.pr !== 109) }))]]);
    view.rerender(<FleetCards selectedId={null} onOpen={noop} />);
    expect(isOpen()).toBe(true);
    // The card folds and unfolds; its landing block is outside the fold and keeps its choice.
    const card = regionOf('project-a').closest('section.proj-card') as HTMLElement;
    const fold = card.querySelector<HTMLElement>('.proj-card-toggle')!;
    fireEvent.click(fold);
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(isOpen()).toBe(true);
    fireEvent.click(fold);
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    expect(isOpen()).toBe(true);
    // The block goes with an empty read and comes back on a later one.
    lines.states = new Map<string, LandingCardState>([['project-a', { kind: 'none' }]]);
    view.rerender(<FleetCards selectedId={null} onOpen={noop} />);
    expect(screen.queryByRole('region', { name: 'Landing line of project-a' })).toBeNull();
    lines.states = new Map<string, LandingCardState>([['project-a', stateOf(lineView())]]);
    view.rerender(<FleetCards selectedId={null} onOpen={noop} />);
    expect(isOpen()).toBe(true);
  });

  it('opened, it stays open when the cards unmount and mount again, as a switch to the Status view and back does', () => {
    lines.states = new Map<string, LandingCardState>([['project-a', stateOf(lineView())]]);
    const first = renderFleet(<FleetCards selectedId={null} onOpen={noop} />, fleetStore());
    fireEvent.click(toggleOf('project-a'));
    first.unmount();
    expect(screen.queryByRole('region', { name: 'Landing line of project-a' })).toBeNull();
    renderFleet(<FleetCards selectedId={null} onOpen={noop} />, fleetStore());
    expect(isOpen()).toBe(true);
    expect(partOf(holdKeys.at(-1)!, 'project-a')).toMatch(/~5r$/);
  });
});
