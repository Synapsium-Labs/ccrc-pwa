// The `Wordmark` primitive (D-5470, the identity core D-5094): `❯ ccrc`, the
// caret in the phosphor, the name in mono, one accessible name, and no place
// between the two where a line can break.
//
// What jsdom can and cannot see. vitest runs with `css: false`, so no rule
// reaches `getComputedStyle` here: the caret's COLOUR is resolved from its
// class list through theme.css's `@theme` map (themeStems.ts), never by
// matching a class string, and the computed colour, family, weight and size
// are read in a real browser by the story's play test
// (`ui/src/primitives/wordmark.stories.tsx`), in both skins.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Wordmark } from '@ccrc/ui';
import { colourStems } from './themeStems';

// vitest runs without globals, so RTL's auto-cleanup never registers itself.
afterEach(() => { cleanup(); });

const STEMS = colourStems();

const WORDMARK_CSS = readFileSync(
  path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'primitives', 'wordmark.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of the first top-level rule whose selector is exactly `sel`. */
function rule(sel: string): string {
  const m = new RegExp(`(?:^|\\})\\s*${sel.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`).exec(WORDMARK_CSS);
  if (m === null) throw new Error(`wordmark.css has no ${sel} rule`);
  return m[1] ?? '';
}

/** The body of the (last) prefers-reduced-motion block, brace-balanced. */
function reducedBlock(): { body: string; at: number } {
  const ms = [...WORDMARK_CSS.matchAll(/@media[^{]*prefers-reduced-motion[^{]*\{/g)];
  const m = ms[ms.length - 1];
  if (m === undefined) throw new Error('wordmark.css has no prefers-reduced-motion block');
  const open = (m.index ?? 0) + m[0].length - 1;
  let depth = 0;
  for (let i = open; i < WORDMARK_CSS.length; i += 1) {
    if (WORDMARK_CSS[i] === '{') depth += 1;
    else if (WORDMARK_CSS[i] === '}') { depth -= 1; if (depth === 0) return { body: WORDMARK_CSS.slice(open + 1, i), at: m.index ?? 0 }; }
  }
  throw new Error('unbalanced prefers-reduced-motion block');
}

const seconds = (t: string): number => (t.endsWith('ms') ? parseFloat(t) / 1000 : parseFloat(t));

function mark(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-wordmark]');
  if (el === null) throw new Error('no [data-wordmark] element rendered');
  return el;
}

/** The tokens a `text-*` utility on this element resolves to through
 *  theme.css's `@theme` block. A size utility (`text-xl`) has no colour stem
 *  and drops out; a utility with no ccrc key (`text-accent`, shadcn's) drops
 *  out too, which is the point: it compiles to no ccrc colour. */
function inkTokens(el: Element): string[] {
  return [...el.classList]
    .map((c) => /^text-(.+)$/.exec(c)?.[1])
    .filter((stem): stem is string => stem !== undefined && STEMS.has(stem))
    .map((stem) => STEMS.get(stem) ?? '');
}

describe('Wordmark', () => {
  it('renders an aria-hidden ❯ followed by ccrc, and its accessible text is ccrc', () => {
    const { container } = render(<h1><Wordmark /></h1>);
    const el = mark(container);
    const [caret, name] = [...el.children];
    expect(caret?.textContent).toBe('❯');
    expect(caret?.getAttribute('aria-hidden')).toBe('true');
    expect(name?.textContent).toBe('ccrc');
    // The name a heading built from the wordmark gets: the caret is decoration.
    expect(screen.getByRole('heading', { name: 'ccrc' })).toBeInTheDocument();
  });

  it('the caret is painted in the accent', () => {
    const { container } = render(<Wordmark />);
    const caret = mark(container).firstElementChild;
    if (caret === null) throw new Error('no caret');
    expect(inkTokens(caret)).toEqual(['var(--accent)']);
    // And the name is today's ink, `.wordmark`'s `--ink-primary`.
    expect(inkTokens(mark(container))).toEqual(['var(--ink-primary)']);
  });

  it('there is no text node between the caret and the name, so it cannot wrap there', () => {
    const { container } = render(<Wordmark />);
    const el = mark(container);
    const nodes = [...el.childNodes];
    expect(nodes.map((n) => n.nodeType)).toEqual([Node.ELEMENT_NODE, Node.ELEMENT_NODE]);
    // The space between them is a box gap, and the box does not wrap.
    expect(el).toHaveClass('inline-flex', 'whitespace-nowrap');
  });

  it("a caller's `whitespace-normal` undoes nowrap", () => {
    const { container } = render(<Wordmark className="whitespace-normal" />);
    const el = mark(container);
    expect(el).toHaveClass('whitespace-normal');
    expect(el).not.toHaveClass('whitespace-nowrap');
  });

  it('the default is still ❯ ccrc', () => {
    const { container } = render(<Wordmark />);
    const el = mark(container);
    expect(el.textContent).toBe('❯ccrc');
    expect(container.querySelector('.wordmark-type, .wordmark-cursor')).toBeNull();
    expect(el).toHaveClass('font-medium', 'inline-flex');
  });

  it('the overlord mark reads "overlord" and draws its underscore in the accent', () => {
    const { container } = render(<h1><Wordmark mark="overlord" /></h1>);
    const el = mark(container);
    const [word, bar] = [...el.children];
    expect(word?.textContent).toBe('overlord');
    expect(bar?.textContent).toBe('_');
    expect(bar?.getAttribute('aria-hidden')).toBe('true');
    expect(el.children).toHaveLength(2);
    expect(el.textContent).not.toContain('❯');
    expect(screen.getByRole('heading', { name: 'overlord' })).toBeInTheDocument();
    expect(el).toHaveClass('font-mono', 'font-extrabold');
    expect(el).not.toHaveClass('font-medium');
    // `overlord_` is one word: the underscore sits against the last letter, as the brief draws it, with no box gap.
    expect(el).toHaveClass('gap-0');
    expect(el).not.toHaveClass('gap-[0.4em]');
    if (bar === undefined) throw new Error('no underscore');
    expect(inkTokens(bar)).toEqual(['var(--accent)']);
  });

  it('typed adds the two classes, and the stylesheet stills them under reduced motion', () => {
    const { container } = render(<Wordmark mark="overlord" typed />);
    const [word, bar] = [...mark(container).children];
    expect(word).toHaveClass('wordmark-type');
    expect(bar).toHaveClass('wordmark-cursor');
    const { body, at } = reducedBlock();
    expect(body).toContain('.wordmark-type');
    expect(body).toContain('.wordmark-cursor');
    expect(body).toMatch(/animation:\s*none/);
    // Later in the sheet than the rules it governs, so it wins.
    expect(at).toBeGreaterThan(WORDMARK_CSS.indexOf('.wordmark-cursor'));
    // Untyped, the classes are absent.
    const plain = render(<Wordmark mark="overlord" />).container;
    expect(plain.querySelector('.wordmark-type, .wordmark-cursor')).toBeNull();
  });

  it('the underscore waits for the typing', () => {
    const typing = /animation:\s*wordmark-type\s+(\S+)\s+steps\(8\)/.exec(rule('.wordmark-type'));
    const cursor = /animation:\s*wordmark-cursor\s+(\S+)\s+steps\(1\)\s+(\S+)\s+infinite/.exec(rule('.wordmark-cursor'));
    if (typing === null || cursor === null) throw new Error('the animation shorthands are not as the plan spells them');
    expect(seconds(typing[1] ?? '')).toBe(1.2);
    expect(seconds(cursor[2] ?? '')).toBe(seconds(typing[1] ?? ''));
    expect(rule('.wordmark-type')).toMatch(/forwards/);
  });
});
