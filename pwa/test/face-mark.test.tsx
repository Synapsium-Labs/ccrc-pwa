// The face in the bar (the Overlord face plan, Task 8): the console's character in the mood the fleet is in, after the
// wordmark of each skin's bar. It plays for five seconds after each change of mood, then holds the still frame.
// Fake timers drive the clock, `Date` included; a fixture store stands in for the fleet; `fetch` is refused, so the
// shell's polls answer nothing (no health: the agent is not down).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import { FleetChromeProvider } from '../src/fleet/FleetChrome';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { FaceMark, MOOD_PLAY_MS } from '../src/face/FaceMark';
import { HAPPY_WINDOW_MS } from '../src/face/mood';
import { setCharacter } from '../src/lib/character';
import { fleetSession } from './fleetFixture';
import { useFleetStore } from '../src/stores/fleet';
import { setSkin } from '../src/lib/skin';
import { navigate } from '../src/lib/router';
import { waitingView } from './ledgersFixture';

vi.mock('../src/lib/push', () => ({
  pushSupported: () => true,
  pushEnabled: async () => false,
  enablePush: async () => ({ status: 'enabled' }),
  disablePush: async () => {},
}));

const { App } = await import('../src/app');

const NOW = 1_800_000_000_000;
const MIN = 60_000;

let reduced = false;
function stubMedia(width = 1400): void {
  vi.stubGlobal('matchMedia', (q: string) => {
    const min = /min-width:\s*([\d.]+)px/.exec(q);
    const max = /max-width:\s*([\d.]+)px/.exec(q);
    const matches = /prefers-reduced-motion/.test(q)
      ? reduced
      : (min === null || width >= Number(min[1])) && (max === null || width <= Number(max[1])) && (min !== null || max !== null);
    return {
      matches, media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    };
  });
}

beforeEach(() => {
  reduced = false;
  localStorage.clear();
  vi.useFakeTimers({ now: NOW, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
  stubMedia();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

/** A store that has heard every reader and holds `sessions`: a calm fleet by default. */
function heard(over: Partial<ReturnType<FleetStore['getState']>> = {}): FleetStore {
  const store = createFleetStore();
  store.setState({
    conn: 'open', sessions: [fleetSession({ id: 'lane-a-1', bucket: 'idle' })], fleetFrameSeen: true, runs: [], runsFrameSeen: true,
    waiting: waitingView({ items: [] }), lanes: {}, ...over,
  });
  return store;
}

const mountFace = (store: FleetStore) => render(<FleetChromeProvider store={store}><FaceMark /></FleetChromeProvider>);
const face = (): SVGElement => {
  const el = document.querySelector<SVGElement>('svg.face-mark');
  if (el === null) throw new Error('no face mounted');
  return el;
};
const still = (): boolean => face().hasAttribute('data-still');
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe('the face', () => {
  it('plays five seconds, then still', () => {
    mountFace(heard());
    expect(still()).toBe(false);
    advance(MOOD_PLAY_MS - 1);
    expect(still()).toBe(false);
    advance(1);
    expect(still()).toBe(true);
  });

  it('a new mood plays again', () => {
    const store = heard();
    mountFace(store);
    advance(MOOD_PLAY_MS);
    expect(still()).toBe(true);
    act(() => store.setState({ sessions: [fleetSession({ id: 'lane-a-1', bucket: 'attention' })] }));
    expect(face().getAttribute('aria-label')).toContain('a session has a question for you');
    expect(still()).toBe(false);
    advance(MOOD_PLAY_MS);
    expect(still()).toBe(true);
  });

  it('a return to a mood that had settled plays again, inside five seconds of leaving it', () => {
    const store = heard();
    mountFace(store);
    advance(MOOD_PLAY_MS);
    expect(still()).toBe(true);
    act(() => store.setState({ sessions: [fleetSession({ id: 'lane-a-1', bucket: 'attention' })] }));
    advance(MOOD_PLAY_MS - 1000);
    act(() => store.setState({ sessions: [fleetSession({ id: 'lane-a-1', bucket: 'idle' })] }));
    expect(face().getAttribute('aria-label')).toContain('nothing needs anyone');
    expect(still()).toBe(false);
    advance(MOOD_PLAY_MS - 1);
    expect(still()).toBe(false);
    advance(1);
    expect(still()).toBe(true);
  });

  it('a change that keeps the mood does not play again', () => {
    const store = heard();
    mountFace(store);
    advance(MOOD_PLAY_MS);
    act(() => store.setState({ sessions: [fleetSession({ id: 'lane-a-2', bucket: 'idle' })] }));
    expect(still()).toBe(true);
  });

  it('reduced motion is still from the start', () => {
    reduced = true;
    mountFace(heard());
    expect(still()).toBe(true);
  });

  it('a window edge re-renders the mood', () => {
    const merged = fleetSession({ id: 'lane-a-1', bucket: 'idle' });
    const store = heard({ sessions: [{ ...merged, pr: { ...merged.pr, mergedAt: NOW - 9 * MIN } as never }] });
    mountFace(store);
    expect(face().getAttribute('aria-label')).toContain('a pull request just merged');
    advance(HAPPY_WINDOW_MS - 9 * MIN - 1);
    expect(face().getAttribute('aria-label')).toContain('a pull request just merged');
    advance(1);
    expect(face().getAttribute('aria-label')).toContain('nothing needs anyone');
  });

  it('the face is Neutral until the fleet has been heard, never calm', () => {
    mountFace(heard({ fleetFrameSeen: false }));
    expect(face().getAttribute('aria-label')).toContain('not heard from the fleet yet');
  });

  it("the face's name says the cause", () => {
    mountFace(heard());
    expect(face().getAttribute('aria-label')).toBe('The Orb asleep: its eye closed in a downward curve, with small letter Zs drifting up: nothing needs anyone');
  });

  it('it wears the chosen character', () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    mountFace(heard());
    act(() => { setCharacter('dark-lord'); });
    expect(face().getAttribute('aria-label')).toMatch(/^The Dark Lord/);
    act(() => { setCharacter('orb'); });
  });

  it('timers are cleared on unmount', () => {
    // The shell's own polls hold timers too: the face's are the difference its unmounting makes, in one tree.
    const store = heard();
    const tree = (face: boolean) => <FleetChromeProvider store={store}>{face ? <FaceMark /> : null}</FleetChromeProvider>;
    const { rerender } = render(tree(false));
    const bare = vi.getTimerCount();
    rerender(tree(true));
    expect(vi.getTimerCount()).toBeGreaterThan(bare);
    rerender(tree(false));
    expect(vi.getTimerCount()).toBe(bare);
  });
});

describe('the bars', () => {
  const cases: Array<[string, string, number]> = [
    ['Instrument\'s top bar', INSTRUMENT, 1400],
    ['Refined\'s desk bar', REFINED, 1400],
    ['Refined\'s phone header', REFINED, 390],
  ];
  for (const [name, skin, width] of cases) {
    it(`${name} shows one face, straight after the wordmark`, () => {
      vi.useRealTimers();
      stubMedia(width);
      act(() => { setSkin(skin); navigate('/'); });
      render(<App />);
      act(() => useFleetStore.setState({ conn: 'open', sessions: [fleetSession({ id: 'lane-a-1', bucket: 'idle' })], fleetFrameSeen: true }));
      const faces = document.querySelectorAll('svg.face-mark');
      expect(faces).toHaveLength(1);
      const mark = document.querySelector('[data-wordmark]');
      expect(mark).not.toBeNull();
      // Beside the wordmark, never inside a button: found by its own accessible name (the mood and its cause).
      const named = screen.getAllByRole('img', { name: /not heard yet: the runs/ });
      expect(named).toEqual([faces[0]]);
      expect(faces[0]!.closest('button, a')).toBeNull();
      // Instrument's wordmark is inside the home door, inside the doors-only nav: the face follows that nav.
      if (skin === INSTRUMENT) expect(faces[0]!.previousElementSibling).toBe(mark!.closest('nav'));
      else expect(faces[0]!.previousElementSibling).toBe(mark);
      act(() => { navigate('/'); setSkin(REFINED); });
    });
  }
});
