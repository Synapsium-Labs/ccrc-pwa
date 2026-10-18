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
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Wordmark } from '@ccrc/ui';
import { colourStems } from './themeStems';

// vitest runs without globals, so RTL's auto-cleanup never registers itself.
afterEach(() => { cleanup(); });

const STEMS = colourStems();

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
});
