// SettingsScreen (route `/settings`, centralised update management W3 —
// design 2026-09-20 §13). Task 6 lands the SHELL — the header and its back
// control — because the route's own pin (app.test.tsx) needs the screen's
// heading; Tasks 7–10 append one describe each for the sections they add,
// merging their names into the import lines below.
//
// The idiom is accounts-screen.test.tsx's: the FULL afterEach (:46-51) —
// cleanup, restoreAllMocks, the route back to '/', and the fleet store reset —
// because a later section spies on `api` and reads the store, and dropping any
// one of the four leaks state into the next case. CSS is asserted by scraping
// fleet.css through test/cssRule.ts: vitest runs with `css: false`, so jsdom
// evaluates no stylesheet and no computed style can carry a claim.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SettingsScreen } from '../src/screens/SettingsScreen';
import { navigate } from '../src/lib/router';
import { useFleetStore } from '../src/stores/fleet';
import { declValue, ruleIn } from './cssRule';

const fleetCss = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navigate('/');
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], blocked: false }));
});

describe('SettingsScreen — the shell', () => {
  it('titles itself Settings, as the one level-1 heading', () => {
    render(<SettingsScreen />);
    expect(screen.getByRole('heading', { level: 1, name: /^settings$/i })).toBeInTheDocument();
  });

  it('has a back affordance that returns to the fleet', () => {
    // Starts ON /settings, so the assertion cannot pass by the route never
    // having moved (accounts-screen.test.tsx's own back case starts on '/').
    navigate('/settings');
    render(<SettingsScreen />);
    fireEvent.click(screen.getByRole('button', { name: /back to fleet/i }));
    expect(location.pathname).toBe('/');
  });
});

describe('SettingsScreen — tap targets and the header door', () => {
  it('.settings-back is at least one tap square, off the shared token', () => {
    expect(declValue(ruleIn(fleetCss, '.settings-back'), 'min-height')).toBe('var(--tap-min)');
    expect(declValue(ruleIn(fleetCss, '.settings-back'), 'min-width')).toBe('var(--tap-min)');
  });

  it('.settings-back is the class the rendered back button carries', () => {
    render(<SettingsScreen />);
    expect(screen.getByRole('button', { name: /back to fleet/i })).toHaveClass('settings-back');
  });

  it('.settings-door is at least one tap tall, off the shared token', () => {
    // The render half — a real element still carries the class — is the
    // fleet-screen.test.tsx door case, where the door is mounted.
    expect(declValue(ruleIn(fleetCss, '.settings-door'), 'min-height')).toBe('var(--tap-min)');
  });

  it("wraps the fleet head's right group rather than overflowing it, by specificity", () => {
    // D-3303: the group's four steady-state items
    // leave ~38px at 390px (fleet.css's Chromium-measured width note above
    // `.fleet-runs-line`), and a fifth, labelled door cannot fit that. The
    // override must OUT-SPECIFY `.fleet-head-right` rather than restate it —
    // the cascade trap fleet-css.test.ts documents at the class chooser.
    const spec = (sel: string): number =>
      (sel.match(/\.[A-Za-z0-9_-]+|\[[^\]]*\]|:[a-z-]+/g) ?? []).length;
    const override = ruleIn(fleetCss, '.fleet-head > .fleet-head-right');
    expect(declValue(override, 'flex-wrap')).toBe('wrap');
    expect(declValue(override, 'justify-content')).toBe('flex-end');
    expect(spec('.fleet-head > .fleet-head-right')).toBeGreaterThan(spec('.fleet-head-right'));
    // Non-vacuity: wrapping means something only on a flex container, and the
    // base rule must still be the one that makes it one.
    expect(declValue(ruleIn(fleetCss, '.fleet-head-right'), 'display')).toBe('flex');
  });
});
