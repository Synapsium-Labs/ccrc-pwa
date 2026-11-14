// Character draws either character in any mood from the generated art (Overlord face plan, Task 2).
// A character owns no colour: every leaf takes one `chr-t-<tone>` class, and characters.css maps it to a token.
import { act, cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ART, Character } from '@ccrc/ui';
import { CHARACTERS, MOODS } from '../../shared/face';
import { filesUnder, stripJs } from './sourceScan';

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

// ── what a caller may add through className (review 1918, R2-12) ───────────
// A character never glows and never loops by a caller's hand: a `drop-shadow-*`, `shadow-*`, `blur-*` or `filter`
// utility is a glow (a glow means life), and an `animate-*` one a loop the stepped, still and reduced-motion rules
// never see. The scan reads every `<Character …>` tag in pwa/src and ui/src and refuses such a utility in a literal
// `className`, and refuses any `className` that is not a literal (nothing static could read it) or a prop spread.
const REPO = path.join(import.meta.dirname, '..', '..');
const BANNED_UTILITY = /^(?:drop-shadow|animate|blur|backdrop-blur|backdrop-filter|shadow|filter)(?:$|-|\[)/;

/** The tag text of every `<Character …>` in `code`, walked to its closing `>` outside braces and strings. */
function characterTags(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/<Character(?![\w.])/g)) {
    let depth = 0;
    let quote = '';
    let i = (m.index ?? 0) + m[0].length;
    const from = i;
    for (; i < code.length; i++) {
      const c = code[i] as string;
      if (quote) { if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    out.push(code.slice(from, i));
  }
  return out;
}

/** What one tag's className lets through: one line per utility or non-literal found. */
function classNameOffences(tag: string): string[] {
  const out: string[] = [];
  if (/\{\s*\.\.\./.test(tag)) out.push('spreads props, which could carry a className');
  const attr = tag.match(/\bclassName\s*=\s*("[^"]*"|'[^']*'|\{[\s\S]*)/);
  if (!attr) return out;
  let value = (attr[1] as string).trim();
  if (value.startsWith('{')) {
    // The capture runs to the tag's end, so a self-closing ` /` trails the brace: trim it before the brace strip.
    const inner = value.replace(/^\{\s*/, '').replace(/[\s/]+$/, '').replace(/\s*\}\s*$/, '');
    if (!/^(?:"[^"]*"|'[^']*'|`[^`$]*`)$/.test(inner)) return [...out, `className is not a literal (${inner.trim()})`];
    value = inner;
  }
  for (const token of value.slice(1, -1).split(/\s+/).filter(Boolean)) {
    const base = token.replace(/^(?:[^\s:[\]]+:)*/, '').replace(/^[!-]+/, '');
    if (BANNED_UTILITY.test(base) || base.startsWith('[')) out.push(`"${token}" is a glow, a filter or a loop`);
  }
  return out;
}

function classNameOffencesIn(files: Record<string, string>): string[] {
  return Object.entries(files).flatMap(([rel, src]) =>
    characterTags(stripJs(src)).flatMap((tag) => classNameOffences(tag).map((o) => `${rel}: ${o}`)));
}

describe('what a caller may add to a Character through className', () => {
  const real = (): Record<string, string> => Object.fromEntries(
    ['pwa/src', 'ui/src']
      .flatMap((root) => filesUnder(REPO, root, (n) => n.endsWith('.tsx')))
      .map((rel) => [rel, readFileSync(path.join(REPO, rel), 'utf8')]),
  );
  it('the real callers add nothing that glows, filters or loops, and the scan sees them', () => {
    const files = real();
    const seen = Object.values(files).flatMap((src) => characterTags(stripJs(src)));
    expect(seen.length).toBeGreaterThanOrEqual(4);
    expect(classNameOffencesIn(files)).toEqual([]);
  });
  const tag = (attrs: string): Record<string, string> => ({ 'planted.tsx': `export const A = () => <Character character="orb" mood="neutral" ${attrs} />;` });
  it.each([
    ['a drop-shadow utility', 'className="face-mark drop-shadow-lg"', /drop-shadow-lg/],
    ['an arbitrary drop-shadow', 'className="drop-shadow-[0_0_4px_red]"', /drop-shadow-\[/],
    ['an animate utility', 'className="animate-pulse"', /animate-pulse/],
    ['a variant-prefixed animate utility', 'className="hover:animate-spin"', /animate-spin/],
    ['a blur utility', 'className="blur-sm"', /blur-sm/],
    ['a shadow utility', 'className="shadow-md"', /shadow-md/],
    ['an arbitrary shadow', 'className="shadow-[0_0_2px_red]"', /shadow-\[/],
    ['a bare filter', 'className="filter"', /"filter"/],
    ['an arbitrary property', 'className="[filter:blur(1px)]"', /\[filter/],
    ['a literal inside braces', "className={'animate-ping'}", /"animate-ping" is a glow/],
    ['a non-literal className', 'className={cls}', /not a literal/],
    ['a template with a hole', 'className={`a ${b}`}', /not a literal/],
    ['a prop spread', '{...rest}', /spreads props/],
  ])('refuses %s', (_name, attrs, word) => {
    expect(classNameOffencesIn(tag(attrs)).join('\n')).toMatch(word);
  });
  it('CONTROL: a plain literal and an absent className pass', () => {
    expect(classNameOffencesIn(tag('className="face-mark"'))).toEqual([]);
    expect(classNameOffencesIn(tag(''))).toEqual([]);
    expect(classNameOffencesIn(tag("className={'face-mark'}"))).toEqual([]);
  });
  it('the real tree goes red when a planted caller is added', () => {
    const files = { ...real(), 'pwa/src/planted.tsx': tag('className="drop-shadow-xl"')['planted.tsx'] as string };
    expect(classNameOffencesIn(files)).toHaveLength(1);
  });
});
