// The console's root and the Overlord's route (Overlord W1 home, Task 2; plan question 1): `/` replaces itself with the place
// `homePlace` answers once it is decided, and leaves no `/` in history; `/overlord` without `overlord-v1` replaces to `/fleet`.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { DesignationView } from '../../shared/overlord-designation';
import type { LadderWire } from '../../shared/overlord-ladder';
import { HomeRoute } from '../src/overlord/HomeRoute';
import { OverlordRoute } from '../src/overlord/OverlordRoute';
import type { ReadState } from '../src/overlord/readState';
import { matchRoute, shellViewOf, topRouteOf, FLEET_PATH } from '../src/lib/routes';
import { useOverlordStore } from '../src/stores/overlord';

afterEach(() => { cleanup(); });

const AT = 1_700_000_000_000;
const ROW: DesignationView = {
  bound: { sessionId: 'lane-a-overlord', generation: 'g1' }, pending: null, term: 1, designatedTerm: 1, model: 'opus',
  accountPools: { pools: ['pool-a'], untagged: false }, pastIds: [], actor: 'operator', lastAttempt: null, stopsOwed: [],
};
const ladder = (operatorRung: string): ReadState<LadderWire> =>
  ({ state: 'answered', value: { ok: true, operatorRung } as unknown as LadderWire, at: AT });
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
  it('/fleet is the Fleet, / is the home and /overlord is the place', () => {
    expect(matchRoute('/fleet')?.route.id).toBe('fleet');
    expect(matchRoute('/fleet/')?.route.id).toBe('fleet');
    expect(matchRoute('/')?.route.id).toBe('home');
    expect(matchRoute('/overlord')?.route.id).toBe('overlord');
    expect(FLEET_PATH).toBe('/fleet');
  });
  it('the path readers read the path alone: the phone shows the Fleet under / and /fleet, a session sits under the Fleet', () => {
    expect(shellViewOf('/fleet')).toBe('fleet');
    expect(shellViewOf('/')).toBe('fleet');
    expect(shellViewOf('/overlord')).toBe('session');
    expect(topRouteOf('/s/lane-a-x')?.id).toBe('fleet');
    expect(topRouteOf('/')).toBeNull();
    expect(topRouteOf('/overlord')?.id).toBe('overlord');
  });
});

describe('HomeRoute, `/`', () => {
  it('with no word, replaces to /fleet and leaves no / entry in history', () => {
    const before = history.length;
    setReads({ caps: caps(['continuity-v1']) });
    render(<HomeRoute />);
    expect(location.pathname).toBe('/fleet');
    expect(history.length).toBe(before);
  });
  it('with the word and no designation, replaces to /fleet', () => {
    setReads({ caps: WORD, designation: { state: 'answered', value: null, at: AT } });
    render(<HomeRoute />);
    expect(location.pathname).toBe('/fleet');
  });
  it('with the word and a bound Overlord, replaces to /overlord', () => {
    const before = history.length;
    setReads({ caps: WORD, designation: { state: 'answered', value: ROW, at: AT }, ladder: ladder('chat') });
    render(<HomeRoute />);
    expect(location.pathname).toBe('/overlord');
    expect(history.length).toBe(before);
  });
  it('with the rung off, replaces to /fleet', () => {
    setReads({ caps: WORD, designation: { state: 'answered', value: ROW, at: AT }, ladder: ladder('off') });
    render(<HomeRoute />);
    expect(location.pathname).toBe('/fleet');
  });
  it('while the reads load, says so and stays on /; then lands where the answer says', () => {
    setReads({});
    render(<HomeRoute />);
    expect(screen.getByRole('status').textContent).toBe('Loading…');
    expect(location.pathname).toBe('/');
    act(() => { useOverlordStore.setState({ caps: WORD }); });
    expect(location.pathname).toBe('/');
    act(() => { useOverlordStore.setState({ designation: { state: 'answered', value: ROW, at: AT } }); });
    expect(location.pathname).toBe('/');
    act(() => { useOverlordStore.setState({ ladder: ladder('chat') }); });
    expect(location.pathname).toBe('/overlord');
  });
  it('after a 503 on the caps read, lands on /fleet', () => {
    setReads({ caps: { state: 'unmeasured', error: 'HTTP 503' } });
    render(<HomeRoute />);
    expect(location.pathname).toBe('/fleet');
  });
  it('a designation read that failed lands on /fleet; an unread rung keeps the place', () => {
    setReads({ caps: WORD, designation: { state: 'unmeasured', error: 'timeout' } });
    render(<HomeRoute />);
    expect(location.pathname).toBe('/fleet');
    cleanup();
    history.pushState(null, '', '/');
    setReads({ caps: WORD, designation: { state: 'answered', value: ROW, at: AT }, ladder: { state: 'unmeasured', error: 'HTTP 503' } });
    render(<HomeRoute />);
    expect(location.pathname).toBe('/overlord');
  });
});

describe('OverlordRoute, `/overlord`', () => {
  beforeEach(() => { history.pushState(null, '', '/overlord'); });
  it('without the word, replaces to /fleet and draws nothing of the Overlord', () => {
    setReads({ caps: caps([]) });
    render(<OverlordRoute />);
    expect(location.pathname).toBe('/fleet');
    expect(screen.queryByRole('heading', { name: 'Overlord' })).toBeNull();
  });
  it('with the caps unread, replaces to /fleet too', () => {
    setReads({ caps: { state: 'unmeasured', error: 'HTTP 503' } });
    render(<OverlordRoute />);
    expect(location.pathname).toBe('/fleet');
  });
  it('with the word, draws the place: its heading and its state word', () => {
    setReads({ caps: WORD, designation: { state: 'answered', value: ROW, at: AT }, ladder: ladder('chat') });
    render(<OverlordRoute />);
    expect(location.pathname).toBe('/overlord');
    expect(screen.getByRole('heading', { name: 'Overlord' })).toBeTruthy();
    expect(screen.getByText('The Overlord is running.')).toBeTruthy();
  });
});
