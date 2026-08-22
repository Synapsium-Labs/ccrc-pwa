// WHEN the detail pane's scroll reset lands, not just THAT it lands (D-161).
//
// app.test.tsx holds the reset itself. This file holds the one property that
// file could not see: app.tsx resets `.shell-detail` in a `useLayoutEffect`,
// its comment calls the LAYOUT effect load-bearing, and the D-161 re-review
// found nothing measuring it — swapping in `useEffect` left all 12 tests there
// green, because `navigate` wraps the path change in `flushSync`, which flushes
// passive effects too before it returns.
//
// WHAT IS AND IS NOT MEASURABLE HERE, said plainly because the point of this
// file is to stop claiming the unmeasured. jsdom does no layout and paints
// nothing, so "before the browser paints" cannot be observed in this package by
// any test. What CAN be observed is the ordering that the paint claim rests on:
// React runs every layout effect of a commit INSIDE that commit, before any
// passive effect of it, and it runs passive effects child-before-parent. So a
// screen mounted into the pane sees offset 0 from its own `useEffect` if and
// only if the shell's reset is a layout effect; make it passive and the child
// runs first and reads the stale offset. That ordering is what this file pins.
// The remaining step — that the browser gets no chance to paint between the two
// — is the platform's definition of a layout effect, reasoned and unmeasured
// here; app.tsx's comment says so rather than claiming otherwise.
//
// Its own file because it MOCKS a route screen: app.test.tsx asserts the real
// screens' headings, and a module mock is per-file. RunsScreen is the stand-in
// for "any screen that reads the pane on mount" — nothing about the real one
// matters to the ordering.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { navigate } from '../src/lib/router';
import { useFleetStore } from '../src/stores/fleet';

/** `vi.hoisted` because `vi.mock`'s factory is hoisted above every import and
 *  runs while app.tsx is still being evaluated — a plain `const` in this file's
 *  body is in its temporal dead zone at that moment. */
const probe = vi.hoisted(() => ({ seen: [] as number[] }));

vi.mock('../src/screens/RunsScreen', () => ({
  /** A screen that records the pane's offset from its own MOUNT effect — a
   *  passive one, so it is ordered against the shell's reset rather than beside
   *  it. Reads `.shell-detail` out of the document rather than taking a ref:
   *  the pane is the shell's node, this is a child of it, and the test installs
   *  the accessor that makes the offset observable at all. */
  RunsScreen: (): ReactNode => {
    useEffect(() => {
      const pane = document.querySelector('.shell-detail');
      // -1, never 0, if the pane is somehow gone: 0 is the passing value, so a
      // missing pane must not read as a pass.
      probe.seen.push(pane === null ? -1 : (pane as HTMLElement).scrollTop);
    }, []);
    return <h1>runs (probe)</h1>;
  },
}));

const { App } = await import('../src/app');

beforeEach(() => {
  probe.seen.length = 0;
});

afterEach(() => {
  cleanup();
  navigate('/');
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], blocked: false }));
});

/** jsdom's `scrollTop` is a hard 0 that discards writes (no layout), so an own
 *  accessor pair on the node is the only way to see what the shell WROTE —
 *  app.test.tsx's `track`, same reason, kept separate because this file's
 *  reader is the mocked screen rather than the test body. */
const track = (el: Element, start: number): void => {
  let top = start;
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (v: number) => { top = v; },
  });
};

const pane = (): Element => {
  const el = document.querySelector('.shell-detail');
  expect(el, '.shell-detail is the pane the reset is about').not.toBeNull();
  return el!;
};

describe('the reset lands before the new screen runs anything (D-161)', () => {
  it('the arriving screen reads 0 from its own mount effect', () => {
    navigate('/mail');
    render(<App />);
    track(pane(), 2517);            // where a long screen left the pane
    act(() => { navigate('/runs'); });
    // Passive effects run child-before-parent, so with a passive reset in the
    // shell this is 2517: the screen's first frame would be composed against
    // an offset the shell has not corrected yet.
    expect(probe.seen).toEqual([0]);
  });

  it('and on back/forward, which does not ride flushSync at all', () => {
    // The path that made the distinction invisible: `navigate` calls
    // `flushSync`, which flushes passive effects before returning, so the
    // WHOLE-COMMIT view of both spellings is identical there. A popstate has no
    // flushSync — the ordering inside the commit is all there is.
    navigate('/mail');
    render(<App />);
    track(pane(), 1200);
    act(() => {
      history.pushState(null, '', '/runs');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(probe.seen).toEqual([0]);
  });
});
