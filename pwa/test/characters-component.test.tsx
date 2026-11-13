// Character draws either character in any mood from the generated art (Overlord face plan, Task 2).
// A character owns no colour: every leaf takes one `chr-t-<tone>` class, and characters.css maps it to a token.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ART, Character } from '@ccrc/ui';
import { CHARACTERS, MOODS } from '../../shared/face';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A `matchMedia` whose reduced-motion answer a test can flip, firing the `change` listeners as a browser does. */
const stubReduced = (initial: boolean): ((next: boolean) => void) => {
  let matches = initial;
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  vi.stubGlobal('matchMedia', (q: string) => ({
    get matches() { return matches; },
    media: q,
    onchange: null,
    addEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => { listeners.add(l); },
    removeEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => { listeners.delete(l); },
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }));
  return (next) => {
    matches = next;
    act(() => { listeners.forEach((l) => { l({ matches: next } as MediaQueryListEvent); }); });
  };
};

const countNodes = (nodes: readonly { kids?: readonly unknown[] }[]): number =>
  nodes.reduce((n, node) => n + 1 + countNodes((node.kids ?? []) as { kids?: readonly unknown[] }[]), 0);

describe('Character', () => {
  it('draws the mood with its label, at a whole scale', () => {
    const { getByRole } = render(<Character character="orb" mood="alert" scale={2} />);
    const svg = getByRole('img', { name: ART.orb.alert.label });
    expect(svg.getAttribute('width')).toBe('64');
    expect(svg.getAttribute('height')).toBe('64');
    expect(svg.getAttribute('shape-rendering')).toBe('crispEdges');
    expect(svg.getAttribute('viewBox')).toBe('0 0 32 32');
  });

  it('draws no colour itself', () => {
    const { container } = render(<Character character="dark-lord" mood="angry" />);
    const all = [...container.querySelectorAll('*')];
    for (const el of all) {
      expect(el.hasAttribute('fill')).toBe(false);
      expect(el.hasAttribute('style')).toBe(false);
    }
    const leaves = all.filter((el) => el.tagName !== 'svg' && el.tagName !== 'g');
    expect(leaves.length).toBeGreaterThan(0);
    for (const leaf of leaves) expect([...leaf.classList].filter((c) => c.startsWith('chr-t-'))).toHaveLength(1);
  });

  it('play false holds the still frame', () => {
    stubReduced(false);
    const on = render(<Character character="orb" mood="sleeping" />);
    expect(on.getByRole('img').hasAttribute('data-still')).toBe(false);
    cleanup();
    const off = render(<Character character="orb" mood="sleeping" play={false} />);
    expect(off.getByRole('img').hasAttribute('data-still')).toBe(true);
  });

  it('reduced motion holds the still frame whatever play says', () => {
    stubReduced(true);
    const { getByRole } = render(<Character character="orb" mood="sleeping" play />);
    expect(getByRole('img').hasAttribute('data-still')).toBe(true);
  });

  it('turning reduced motion on mid-session stills it', () => {
    const set = stubReduced(false);
    const { getByRole } = render(<Character character="orb" mood="sleeping" />);
    expect(getByRole('img').hasAttribute('data-still')).toBe(false);
    set(true);
    expect(getByRole('img').hasAttribute('data-still')).toBe(true);
    set(false);
    expect(getByRole('img').hasAttribute('data-still')).toBe(false);
  });

  it('a label override replaces the drawn label', () => {
    const { getByRole, queryByRole } = render(<Character character="orb" mood="sad" label="Run stalled" />);
    expect(getByRole('img', { name: 'Run stalled' })).toBeTruthy();
    expect(queryByRole('img', { name: ART.orb.sad.label })).toBeNull();
  });

  it('draws all 28 without a throw, each node once', () => {
    for (const character of CHARACTERS) {
      for (const mood of MOODS) {
        const { container, unmount } = render(<Character character={character} mood={mood} />);
        const drawn = container.querySelectorAll('svg > *, svg *').length;
        expect(drawn, `${character} ${mood}`).toBe(countNodes(ART[character][mood].nodes));
        unmount();
      }
    }
  });
});
