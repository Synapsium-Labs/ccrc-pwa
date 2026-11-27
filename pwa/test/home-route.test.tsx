// The console's root and the Overlord's route (Overlord W1 home, Task 2; plan question 1): `/` replaces itself with the place
// `homePlace` answers once it is decided, and leaves no `/` in history; `/overlord` without `overlord-v1` replaces to `/fleet`.
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

// The place's face reads the shell's chrome (`useMood`), and its session stream opens a socket: neither is this file's
// subject, so both are stood in for (`overlord-face-part.test.tsx` and `overlord-session-stream.test.tsx` pin them).
vi.mock('../src/face/useMood', () => ({ useMood: () => ({ mood: 'sleeping', cause: 'nothing needs anyone' }) }));
vi.mock('../src/overlord/useOverlordSessionStream', () => ({ useOverlordSessionStream: () => undefined }));

/** Let the route's deferred replace run (it waits for the whole commit, `useReplaceWhen`). */
const flush = (): Promise<void> => act(async () => {});
import type { DesignationView } from '../../shared/overlord-designation';
import type { LadderWire } from '../../shared/overlord-ladder';
import { HomeRoute } from '../src/overlord/HomeRoute';
import { OverlordRoute } from '../src/overlord/OverlordRoute';
import type { ReadState } from '../src/overlord/readState';
import { matchRoute, shellViewOf, topRouteOf, FLEET_PATH } from '../src/lib/routes';
import { useOverlordStore } from '../src/stores/overlord';
import { navigate, useLocation } from '../src/lib/router';

afterEach(() => { cleanup(); });
/** The place's head word (`designationWordOf`): the place draws other status lines beside it. */
const designationWord = (): string | null | undefined => document.querySelector('[data-designation-word]')?.textContent;

const AT = 1_700_000_000_000;
const ROW: DesignationView = {
  bound: { sessionId: 'lane-a-overlord', generation: 'g1' }, pending: null, term: 1, designatedTerm: 1, model: 'opus',
  accountPools: { pools: ['pool-a'], untagged: false }, pastIds: [], actor: 'operator', lastAttempt: null, stopsOwed: [],
};
/** A whole ladder read (the place draws every field of it), at the operator's rung. */
const ladder = (operatorRung: string): ReadState<LadderWire> => ({
  state: 'answered', at: AT,
  value: {
    ok: true, operatorRung, operatorRungSource: 'set', effectiveRung: operatorRung, binding: [], latches: [], conditions: [],
    readBy: [], lastChange: null, rungs: [],
  } as unknown as LadderWire,
});
const caps = (words: readonly string[]): ReadState<readonly string[]> => ({ state: 'answered', value: words, at: AT });
const WORD = caps(['overlord-v1']);

function setReads(over: Partial<{ caps: ReadState<readonly string[]>; designation: ReadState<DesignationView | null>; ladder: ReadState<LadderWire> }>): void {
  useOverlordStore.setState({ caps: { state: 'loading' }, designation: { state: 'loading' }, ladder: { state: 'loading' }, ...over });
}

beforeEach(() => {
  history.replaceState(null, '', '/settings');
  history.pushState(null, '', '/');
});

describe('the route table (Overlord W1 home, Task 2)', () => {
  it('/fleet is the Fleet, / is the home and /overlord is the place', async () => {
    expect(matchRoute('/fleet')?.route.id).toBe('fleet');
    expect(matchRoute('/fleet/')?.route.id).toBe('fleet');
    expect(matchRoute('/')?.route.id).toBe('home');
    expect(matchRoute('/overlord')?.route.id).toBe('overlord');
    expect(FLEET_PATH).toBe('/fleet');
  });
  it('the path readers read the path alone: the phone shows the Fleet under / and /fleet, a session sits under the Fleet', async () => {
    expect(shellViewOf('/fleet')).toBe('fleet');
    expect(shellViewOf('/')).toBe('fleet');
    expect(shellViewOf('/overlord')).toBe('session');
    expect(topRouteOf('/s/lane-a-x')?.id).toBe('fleet');
    expect(topRouteOf('/')).toBeNull();
    expect(topRouteOf('/overlord')?.id).toBe('overlord');
  });
});

describe('HomeRoute, `/`', () => {
  it('with no word, replaces to /fleet and leaves no / entry in history', async () => {
    const before = history.length;
    setReads({ caps: caps(['continuity-v1']) });
    render(<HomeRoute />);
    await flush();
    expect(location.pathname).toBe('/fleet');
    expect(history.length).toBe(before);
  });
  it('with the word and no designation, replaces to /fleet', async () => {
    setReads({ caps: WORD, designation: { state: 'answered', value: null, at: AT } });
    render(<HomeRoute />);
    await flush();
    expect(location.pathname).toBe('/fleet');
  });
  it('with the word and a bound Overlord, replaces to /overlord', async () => {
    const before = history.length;
    setReads({ caps: WORD, designation: { state: 'answered', value: ROW, at: AT }, ladder: ladder('chat') });
    render(<HomeRoute />);
    await flush();
    expect(location.pathname).toBe('/overlord');
    expect(history.length).toBe(before);
  });
  it('with the rung off, replaces to /fleet', async () => {
    setReads({ caps: WORD, designation: { state: 'answered', value: ROW, at: AT }, ladder: ladder('off') });
    render(<HomeRoute />);
    await flush();
    expect(location.pathname).toBe('/fleet');
  });
  // Review 3319 F3: each wait is checked AFTER the deferred replace has had its chance to run (`flush`), so a missing wait
  // fails here rather than passing before the microtask; and the eventual answer's destination and history are pinned.
  it('while the reads load, says so and stays on /, after the deferred work has run; then lands where the answer says', async () => {
    const before = history.length;
    setReads({});
    render(<HomeRoute />);
    await flush();
    expect(screen.getByRole('status').textContent).toBe('Loading…');
    expect(location.pathname).toBe('/');
    act(() => { useOverlordStore.setState({ caps: WORD }); });
    await flush();
    expect(location.pathname, 'the word, the designation still loading').toBe('/');
    act(() => { useOverlordStore.setState({ designation: { state: 'answered', value: ROW, at: AT } }); });
    await flush();
    expect(location.pathname, 'a bound Overlord, its ladder still loading').toBe('/');
    act(() => { useOverlordStore.setState({ ladder: ladder('chat') }); });
    await flush();
    expect(location.pathname).toBe('/overlord');
    expect(history.length, 'replaced, so no / entry').toBe(before);
  });
  it('with the word, waits for the designation: a loading designation never lands on /fleet early', async () => {
    const before = history.length;
    setReads({ caps: WORD });
    render(<HomeRoute />);
    await flush();
    expect(location.pathname).toBe('/');
    act(() => { useOverlordStore.setState({ designation: { state: 'answered', value: ROW, at: AT }, ladder: ladder('chat') }); });
    await flush();
    expect(location.pathname).toBe('/overlord');
    expect(history.length).toBe(before);
  });
  it('a designated Overlord waits for its ladder: an unread ladder never lands on /overlord early, and the rung off lands on /fleet', async () => {
    const before = history.length;
    setReads({ caps: WORD, designation: { state: 'answered', value: ROW, at: AT } });
    render(<HomeRoute />);
    await flush();
    expect(location.pathname).toBe('/');
    act(() => { useOverlordStore.setState({ ladder: ladder('off') }); });
    await flush();
    expect(location.pathname).toBe('/fleet');
    expect(history.length).toBe(before);
  });
  it('after a 503 on the caps read, lands on /fleet', async () => {
    setReads({ caps: { state: 'unmeasured', error: 'HTTP 503' } });
    render(<HomeRoute />);
    await flush();
    expect(location.pathname).toBe('/fleet');
  });
  it('a designation read that failed lands on /fleet; an unread rung keeps the place', async () => {
    setReads({ caps: WORD, designation: { state: 'unmeasured', error: 'timeout' } });
    render(<HomeRoute />);
    await flush();
    expect(location.pathname).toBe('/fleet');
    cleanup();
    history.pushState(null, '', '/');
    setReads({ caps: WORD, designation: { state: 'answered', value: ROW, at: AT }, ladder: { state: 'unmeasured', error: 'HTTP 503' } });
    render(<HomeRoute />);
    await flush();
    expect(location.pathname).toBe('/overlord');
  });
});

describe('the replace reaches a shell that subscribes in its own effect', () => {
  // The shell's `useLocation` listens for `popstate` in its own effect, which runs after its children's: a replace made in
  // the route's first effect, with the answer already in the store, was lost before `useReplaceWhen` deferred it.
  function Shell(): ReactNode {
    const { path } = useLocation();
    return path === '/' ? <HomeRoute /> : <p data-testid="at">{path}</p>;
  }
  it('with the home decided before the first mount, the shell draws where the home is', async () => {
    setReads({ caps: caps([]) });
    render(<Shell />);
    await flush();
    expect(location.pathname).toBe('/fleet');
    expect(screen.getByTestId('at').textContent).toBe('/fleet');
  });

  // Review 3319 F1: `navigate` runs its history call inside a view transition where the platform has one, a frame later. The
  // home's replace, held there, must not land over a navigation made in between. The stub holds the first transition's
  // update and runs every later one at once, as a browser that has started a new transition would.
  describe('a replace held by a view transition', () => {
    const doc = document as { startViewTransition?: unknown };
    let held: Array<() => void> = [];
    let holdNext = true;
    beforeEach(() => {
      held = [];
      holdNext = true;
      doc.startViewTransition = (update: () => void) => {
        if (holdNext) { holdNext = false; held.push(update); } else update();
        return { finished: Promise.resolve() };
      };
    });
    afterEach(() => { delete doc.startViewTransition; });

    it('never lands over a navigation made while it waited: the page stays where the tap took it', async () => {
      setReads({ caps: caps([]) });
      render(<Shell />);
      await flush();
      expect(held, 'the replace waits in its transition').toHaveLength(1);
      expect(location.pathname).toBe('/');
      const before = history.length;
      act(() => { navigate('/runs'); });
      expect(location.pathname).toBe('/runs');
      act(() => { held.shift()!(); });
      expect(location.pathname, 'the late replace did nothing').toBe('/runs');
      expect(history.length).toBe(before + 1);
      expect(screen.getByTestId('at').textContent).toBe('/runs');
    });

    it('with no navigation meanwhile, lands when its transition runs, and leaves no / in history', async () => {
      const before = history.length;
      setReads({ caps: caps([]) });
      render(<Shell />);
      await flush();
      expect(location.pathname).toBe('/');
      act(() => { held.shift()!(); });
      expect(location.pathname).toBe('/fleet');
      expect(history.length).toBe(before);
      expect(screen.getByTestId('at').textContent).toBe('/fleet');
    });
  });
});

describe('OverlordRoute, `/overlord`', () => {
  beforeEach(() => { history.pushState(null, '', '/overlord'); });
  it('without the word, replaces to /fleet and draws nothing of the Overlord', async () => {
    setReads({ caps: caps([]) });
    render(<OverlordRoute />);
    await flush();
    expect(location.pathname).toBe('/fleet');
    expect(screen.queryByRole('heading', { name: 'Overlord' })).toBeNull();
  });
  it('with the caps unread, replaces to /fleet too', async () => {
    setReads({ caps: { state: 'unmeasured', error: 'HTTP 503' } });
    render(<OverlordRoute />);
    await flush();
    expect(location.pathname).toBe('/fleet');
  });
  it('with the word, draws the place: its heading and its state word', async () => {
    setReads({ caps: WORD, designation: { state: 'answered', value: ROW, at: AT }, ladder: ladder('chat') });
    render(<OverlordRoute />);
    await flush();
    expect(location.pathname).toBe('/overlord');
    expect(screen.getByRole('heading', { name: 'Overlord' })).toBeTruthy();
    expect(designationWord()).toBe('The Overlord is running.');
    expect(document.querySelector('[data-overlord-place]'), 'home B draws the whole place').not.toBeNull();
  });
  // Review 3319 A3: a read in flight is not a failure.
  it('while the designation loads it says Loading…, and only a failed read says it could not be read', async () => {
    setReads({ caps: WORD });
    render(<OverlordRoute />);
    await flush();
    expect(designationWord()).toBe('Loading…');
    expect(screen.queryByText('The designation could not be read.')).toBeNull();
    act(() => { useOverlordStore.setState({ designation: { state: 'unmeasured', error: 'HTTP 503' } }); });
    expect(designationWord()).toBe('The designation could not be read.');
  });
  // Carried from home A's review 3613 (ticket home-a-review-carries): the place waits on the capability read. While the caps
  // load it draws nothing of the Overlord's and replaces nothing; the answer then decides, the place with the word and the
  // Fleet without it, and only then.
  it('waits on the capability read: nothing drawn and no replace while the caps load, then the answer decides', async () => {
    setReads({ designation: { state: 'answered', value: ROW, at: AT }, ladder: ladder('chat') });
    render(<OverlordRoute />);
    await flush();
    expect(location.pathname, 'no replace while the caps load').toBe('/overlord');
    expect(screen.getByRole('status').textContent).toBe('Loading…');
    expect(document.querySelector('[data-overlord-place]'), 'nothing of the Overlord drawn before the word').toBeNull();
    act(() => { useOverlordStore.setState({ caps: WORD }); });
    await flush();
    expect(location.pathname).toBe('/overlord');
    expect(document.querySelector('[data-overlord-place]')).not.toBeNull();
    cleanup();
    setReads({ designation: { state: 'answered', value: ROW, at: AT }, ladder: ladder('chat') });
    render(<OverlordRoute />);
    await flush();
    expect(location.pathname).toBe('/overlord');
    act(() => { useOverlordStore.setState({ caps: caps([]) }); });
    await flush();
    expect(location.pathname, 'the answer without the word replaces to the Fleet').toBe('/fleet');
    expect(document.querySelector('[data-overlord-place]')).toBeNull();
  });
});
