// The Overlord's chords at the keyboard (Overlord W1 home, Task 3; review 3319 A1). `useShortcuts` binds every `g` chord
// whatever its command's `when`, so without `overlord-v1` the `g o` keys must move nothing: Go to Overlord's run refuses there.
// With the word, `g o` opens the place; `g h` goes where the home is, the Overlord's place or the Fleet.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { DesignationView } from '../../shared/overlord-designation';
import type { LadderWire } from '../../shared/overlord-ladder';
import { CommandLayer } from '../src/command/CommandLayer';
import { navigate } from '../src/lib/router';
import type { ReadState } from '../src/overlord/readState';
import { useFleetStore } from '../src/stores/fleet';
import { useOverlordStore } from '../src/stores/overlord';

const AT = 1_700_000_000_000;
const ROW: DesignationView = {
  bound: { sessionId: 'lane-a-overlord', generation: 'g1' }, pending: null, term: 1, designatedTerm: 1, model: 'opus',
  accountPools: { pools: ['pool-a'], untagged: false }, pastIds: [], actor: 'operator', lastAttempt: null, stopsOwed: [],
};
const caps = (words: readonly string[]): ReadState<readonly string[]> => ({ state: 'answered', value: words, at: AT });
const ladder = (operatorRung: string): ReadState<LadderWire> =>
  ({ state: 'answered', value: { ok: true, operatorRung } as unknown as LadderWire, at: AT });

/** The two keys of a chord, inside its window. */
function chord(second: string): void {
  fireEvent.keyDown(document.body, { key: 'g' });
  fireEvent.keyDown(document.body, { key: second });
}

beforeEach(() => {
  navigate('/fleet');
  useFleetStore.setState({ sessions: [], runs: [], blocked: false });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  act(() => useOverlordStore.setState({ caps: { state: 'loading' }, designation: { state: 'loading' }, ladder: { state: 'loading' } }));
  navigate('/fleet');
});

describe('the Overlord chords', () => {
  it('without overlord-v1, g o moves nothing and pushes no entry; g h lands on the Fleet', () => {
    act(() => useOverlordStore.setState({ caps: caps(['continuity-v1']), designation: { state: 'loading' }, ladder: { state: 'loading' } }));
    render(<CommandLayer openNewSession={vi.fn()} />);
    navigate('/runs');
    const before = history.length;
    chord('o');
    expect(location.pathname).toBe('/runs');
    expect(history.length).toBe(before);
    chord('h');
    expect(location.pathname).toBe('/fleet');
  });

  it('with the word and a bound Overlord, g o opens the place and g h goes there too', () => {
    act(() => useOverlordStore.setState({ caps: caps(['overlord-v1']), designation: { state: 'answered', value: ROW, at: AT }, ladder: ladder('chat') }));
    render(<CommandLayer openNewSession={vi.fn()} />);
    chord('o');
    expect(location.pathname).toBe('/overlord');
    navigate('/runs');
    chord('h');
    expect(location.pathname).toBe('/overlord');
  });
});
