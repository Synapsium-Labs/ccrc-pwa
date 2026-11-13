import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Splash } from '../src/face/Splash';
import { SPLASH_MAX_MS, SPLASH_MOTTO, SPLASH_TAGLINE, SPLASH_TYPE_MS, splashShows, type SplashFacts } from '../src/face/splash';
import { useFleetStore } from '../src/stores/fleet';

const facts = (over: Partial<SplashFacts> = {}): SplashFacts => ({
  standalone: true, sinceMs: 0, frameSeen: false, reducedMotion: false, ...over,
});

describe('splashShows', () => {
  it('not installed never shows', () => {
    for (const sinceMs of [0, SPLASH_TYPE_MS, SPLASH_MAX_MS - 1]) {
      expect(splashShows(facts({ standalone: false, sinceMs }))).toBe(false);
    }
  });
  it('installed shows at mount', () => expect(splashShows(facts())).toBe(true));
  it('stays until the typing ends even when the frame came first', () => {
    expect(splashShows(facts({ frameSeen: true, sinceMs: SPLASH_TYPE_MS - 1 }))).toBe(true);
    expect(splashShows(facts({ frameSeen: true, sinceMs: SPLASH_TYPE_MS }))).toBe(false);
  });
  it('stays until the frame when the typing ended first', () => {
    expect(splashShows(facts({ sinceMs: SPLASH_TYPE_MS + 1 }))).toBe(true);
    expect(splashShows(facts({ sinceMs: SPLASH_TYPE_MS + 1, frameSeen: true }))).toBe(false);
  });
  it('reduced motion leaves on the frame', () => {
    expect(splashShows(facts({ reducedMotion: true }))).toBe(true);
    expect(splashShows(facts({ reducedMotion: true, frameSeen: true }))).toBe(false);
  });
  it('never outlives SPLASH_MAX_MS, link or no link', () => {
    expect(splashShows(facts({ sinceMs: SPLASH_MAX_MS - 1 }))).toBe(true);
    expect(splashShows(facts({ sinceMs: SPLASH_MAX_MS }))).toBe(false);
    expect(splashShows(facts({ sinceMs: SPLASH_MAX_MS, frameSeen: true }))).toBe(false);
  });
});

function standalone(on: boolean): void {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: on && q === '(display-mode: standalone)', media: q, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

describe('<Splash />', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useFleetStore.setState({ fleetFrameSeen: false });
    standalone(true);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('draws the chosen character in Neutral, with the words', () => {
    const { container } = render(<Splash />);
    const layer = screen.getByTestId('splash');
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('svg.chr')).not.toBeNull();
    expect(layer.textContent).toContain('overlord');
    expect(layer.textContent).toContain(SPLASH_TAGLINE);
    expect(layer.textContent).toContain(SPLASH_MOTTO);
  });

  it('is not drawn in a tab', () => {
    standalone(false);
    render(<Splash />);
    expect(screen.queryByTestId('splash')).toBeNull();
  });

  it('leaves at the cap with no link, and never comes back once gone', () => {
    render(<Splash />);
    act(() => { vi.advanceTimersByTime(SPLASH_MAX_MS); });
    expect(screen.queryByTestId('splash')).toBeNull();
    act(() => { useFleetStore.setState({ fleetFrameSeen: true }); });
    act(() => { useFleetStore.setState({ fleetFrameSeen: false }); });
    expect(screen.queryByTestId('splash')).toBeNull();
  });

  it('leaves when the typing ends after the frame, and a later lost link does not raise it again', () => {
    render(<Splash />);
    act(() => { useFleetStore.setState({ fleetFrameSeen: true }); });
    expect(screen.queryByTestId('splash')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(SPLASH_TYPE_MS); });
    expect(screen.queryByTestId('splash')).toBeNull();
    act(() => { useFleetStore.setState({ fleetFrameSeen: false }); });
    act(() => { vi.advanceTimersByTime(SPLASH_MAX_MS); });
    expect(screen.queryByTestId('splash')).toBeNull();
  });

  it('hides nothing from assistive technology', () => {
    render(
      <>
        <Splash />
        <header><nav aria-label="Main">x</nav></header>
        <main>content</main>
      </>,
    );
    expect(screen.queryByTestId('splash')).not.toBeNull();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByTestId('splash').getAttribute('aria-hidden')).toBe('true');
  });
});
