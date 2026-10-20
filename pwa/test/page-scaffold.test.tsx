// THE PAGE SCAFFOLD (D-5102): every secondary screen stands on one header and
// one column, and their density is the skin's, never the screen's.
//
// Before this, Mail, Runs, Accounts and Archive each drew their own head
// (`.mail-head`, `.runs-head`, `.accounts-head`; Archive drew none at all) and
// their own empty line, four copies of one idea at four paddings, with titles
// at 15px that no skin could reach. `PageScaffold`, `Section` and `EmptyState`
// in @ccrc/ui are the one drawing, and this file holds three things:
//   - the shape: one h1, led by an aria-hidden `❯` in the accent (the caret is
//     identity core, drawn in both skins — the spec's §12 O3);
//   - the measures: the column is `--page-max` or `--page-max-wide`, never a
//     literal, and the gutter, title size and header height each name a token
//     that SKIN_TOKENS lets a skin re-point;
//   - the retirement: the four screens carry no title or empty class of their
//     own any more, and fleet.css declares none.
//
// D-5666: `Section` takes the Settings spec's §15.3 C3 slots — `scope`,
// `title`, `purpose` — and `PageScaffold` a `nav` slot. The scope is drawn per
// skin through one keyword token, `--section-flow`, because only skins.css may
// select on `data-skin` (skin-identity.test.ts's census (k)).
// D-5667: the header's height, `--head-h`, is tap-bearing: Instrument's 40 is
// for a fine pointer only, and a phone keeps the 44px floor.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { EmptyState, PAGE_BODY, PAGE_FOCUS_CLEAR, PAGE_NAV_MIN_PX, PageScaffold, Section, cn } from '@ccrc/ui';
import { SKIN_TOKENS } from '../../ui/src/styles/skins';

afterEach(cleanup);

const ROOT = path.join(import.meta.dirname, '..', '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');
const stripTs = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
const stripCss = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '');

const SCREENS = {
  Mail: 'pwa/src/screens/MailScreen.tsx',
  Runs: 'pwa/src/screens/RunsScreen.tsx',
  Accounts: 'pwa/src/screens/AccountsScreen.tsx',
  Archive: 'pwa/src/screens/ArchiveScreen.tsx',
} as const;

/** The classes the scaffold retired: each screen's own title, note, total and
 *  empty line. They were the contrast census's grandfathered blind spots
 *  (contrast.test.ts) and are drawn by the primitives now. */
const RETIRED = [
  'mail-title', 'mail-note', 'mail-empty', 'mail-head',
  'runs-title', 'runs-empty', 'runs-head',
  'accounts-title', 'accounts-head',
  'archive-total', 'archive-empty',
] as const;

const allTokens = new Set<string>(Object.values(SKIN_TOKENS).flat().map((t) => t.name));

/** theme.css's `@theme inline` key → the token it maps, e.g. `--spacing-gutter` → `--gutter`. */
function bridge(): Map<string, string> {
  const css = stripCss(read('ui/src/styles/theme.css'));
  const out = new Map<string, string>();
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*var\((--[\w-]+)\)\s*;/g)) out.set(m[1]!, m[2]!);
  return out;
}

/** The token a Tailwind utility reads: a role key through the bridge, or an
 *  arbitrary `(--token)` value directly. */
function tokenOf(utility: string, map: Map<string, string>): string | undefined {
  const arbitrary = /\((--[\w-]+)\)$/.exec(utility)?.[1];
  if (arbitrary !== undefined) return arbitrary;
  const spacing = /^(?:min-h|h|px|p|gap)-([\w-]+)$/.exec(utility)?.[1];
  if (spacing !== undefined) return map.get(`--spacing-${spacing}`);
  const text = /^text-([\w-]+)$/.exec(utility)?.[1];
  if (text !== undefined) return map.get(`--text-${text}`);
  return undefined;
}

function scaffold(props: Partial<Parameters<typeof PageScaffold>[0]> = {}) {
  return render(
    <PageScaffold title="Mail" back={{ label: 'Back to fleet', onClick: () => {} }} {...props}>
      <p>body</p>
    </PageScaffold>,
  );
}

describe('PageScaffold (D-5102)', () => {
  it('renders one h1 holding the title', () => {
    scaffold();
    const h1 = screen.getAllByRole('heading', { level: 1 });
    expect(h1).toHaveLength(1);
    expect(h1[0]).toHaveTextContent('Mail');
  });

  it('the title is preceded by an aria-hidden caret', () => {
    scaffold();
    const h1 = screen.getByRole('heading', { level: 1 });
    const caret = h1.previousElementSibling;
    expect(caret, 'nothing precedes the title').not.toBeNull();
    expect(caret!.textContent).toBe('❯');
    expect(caret!.getAttribute('aria-hidden')).toBe('true');
    // In the accent, through the bridge's `phosphor` key (theme.css: `--color-phosphor: var(--accent)`).
    expect(caret!.className.split(/\s+/)).toContain('text-phosphor');
    // The caret is identity core, not a decoration of the title: the accessible
    // name of the heading is the title alone.
    expect(h1).toHaveAccessibleName('Mail');
  });

  it('draws Back when asked, with its label, and nothing in its place when not', () => {
    const { unmount } = scaffold();
    expect(screen.getByRole('button', { name: 'Back to fleet' })).toBeInTheDocument();
    unmount();
    scaffold({ back: undefined });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('places the actions after the title, in the header', () => {
    scaffold({ actions: <button type="button">Digest</button> });
    const banner = screen.getByRole('banner');
    const h1 = screen.getByRole('heading', { level: 1 });
    const action = screen.getByRole('button', { name: 'Digest' });
    expect(banner).toContainElement(action);
    expect(h1.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the body's max-width is var(--page-max) or var(--page-max-wide), never a literal", () => {
    // A literal as a class, as CSS, or as a JSX style object's `maxWidth`.
    const literal = /\bmax-w-\[[^\]]*\d[^\]]*\]|max-width:\s*\d|\bmaxWidth\b/;
    const src = stripTs(read('ui/src/primitives/page-scaffold.tsx'));
    expect(src, 'a literal column width in the scaffold').not.toMatch(literal);
    for (const wide of [false, true]) {
      const { container, unmount } = scaffold({ wide });
      const body = container.querySelector<HTMLElement>('[data-page-body]');
      expect(body, 'the scaffold names its body').not.toBeNull();
      const classes = body!.className.split(/\s+/);
      expect(classes).toContain(wide ? 'max-w-(--page-max-wide)' : 'max-w-(--page-max)');
      expect(classes.filter((c) => /^max-w-/.test(c))).toHaveLength(1);
      expect(body!.style.maxWidth, 'an inline max-width on the body').toBe('');
      unmount();
    }
  });

  it("the header's row is as wide as the body's column, so the title and actions sit over it", () => {
    const cap = (el: Element): string[] => el.className.split(/\s+/).filter((c) => /^max-w-/.test(c));
    for (const wide of [false, true]) {
      const { container, unmount } = scaffold({ wide });
      const row = container.querySelector('header')!.firstElementChild!;
      const body = container.querySelector('[data-page-body]')!;
      expect(cap(row), `the header row's cap (wide=${wide})`).toEqual(cap(body));
      expect(cap(row)).toHaveLength(1);
      unmount();
    }
    // With a nav the row's cap is the nav slot's to set (D-5666; the Settings
    // tasks own it), so it is held there, not here.
  });

  it("the scaffold's gutters, title size and header height read tokens in SKIN_TOKENS", () => {
    const map = bridge();
    const { container } = scaffold();
    const head = container.querySelector('header')!;
    const row = head.firstElementChild!;
    const h1 = screen.getByRole('heading', { level: 1 });
    const body = container.querySelector('[data-page-body]')!;
    const want: [Element, string, string][] = [
      [row, 'px-gutter', '--gutter'],
      [body, 'px-gutter', '--gutter'],
      [h1, 'text-title', '--fs-page'],
      [row, 'min-h-head', '--head-h'],
    ];
    for (const [el, utility, token] of want) {
      expect(el.className.split(/\s+/), `${utility} on the scaffold`).toContain(utility);
      expect(tokenOf(utility, map), `${utility} reaches ${token} through the bridge`).toBe(token);
      expect(allTokens.has(token), `${token} is a skin token`).toBe(true);
    }
    // The column caps are skin tokens too.
    expect(allTokens.has('--page-max')).toBe(true);
    expect(allTokens.has('--page-max-wide')).toBe(true);
  });

  it('the header is sticky and painted, so the body scrolls under it', () => {
    const { container } = scaffold();
    const classes = container.querySelector('header')!.className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['sticky', 'top-0', 'bg-page']));
  });

  it('D-5666: the nav slot renders beside the body, and the body keeps its own column', () => {
    const { container } = scaffold({ nav: <nav aria-label="sections">n</nav> });
    const nav = screen.getByRole('navigation', { name: 'sections' });
    const body = container.querySelector('[data-page-body]')!;
    expect(body.className.split(/\s+/)).toContain('max-w-(--page-max)');
    // The root is the query container: the pane's width, not the window's.
    const root = container.querySelector('[data-page-scaffold]')!;
    expect(root.className.split(/\s+/)).toContain('@container');
    const wrapper = body.parentElement!;
    expect(wrapper.contains(nav)).toBe(true);
    expect([...wrapper.children].indexOf(nav.parentElement!)).toBe(0);
    expect([...wrapper.children].indexOf(body)).toBe(1);
  });

  it('D-5668: the nav goes beside the body from a PAGE_NAV_MIN_PX (760) pane, at 200px, 220 from a 1600 viewport', () => {
    // The Settings spec's §4.2 and §15.3 C3: a pane of 760 or more carries the
    // 200 px nav (220 at a viewport of 1600 or more) beside the column. The
    // threshold is exported once, so Settings' own hook (R2c's
    // SETTINGS_NAV_MIN_PX) reads the number the CSS uses.
    expect(PAGE_NAV_MIN_PX).toBe(760);
    const at = `@min-[${PAGE_NAV_MIN_PX}px]:`;
    const { container } = scaffold({ nav: <nav aria-label="sections">n</nav> });
    const body = container.querySelector('[data-page-body]')!;
    const wrapper = body.parentElement!.className.split(/\s+/);
    expect(wrapper).toContain(`${at}grid-cols-[200px_minmax(0,1fr)]`);
    expect(wrapper).toContain(`min-[1600px]:${at}grid-cols-[220px_minmax(0,1fr)]`);
    // The gutter sits outside the nav, so the nav itself is 200 (220) wide and
    // the body keeps only its right gutter: at a 960 pane with Refined's 24
    // gutter the column is 960 - 24 - 200 - 24 - 24 = 688 (spec §4.2).
    expect(wrapper).toContain(`${at}pl-gutter`);
    expect(wrapper).toContain(`${at}gap-6`);
    expect(body.className.split(/\s+/)).toEqual(expect.arrayContaining([`${at}pl-0`, `${at}mx-0`]));
    const navColumn = screen.getByRole('navigation', { name: 'sections' }).parentElement!.className.split(/\s+/);
    // min-w-0 lets the nav's one-line, ellipsised rows (R2c) shrink inside
    // the 200/220 track rather than widen it.
    expect(navColumn).toEqual(expect.arrayContaining(['min-w-0', `${at}sticky`, `${at}top-head`, `${at}self-start`]));
    expect(navColumn.filter((c) => /^(?:@[\w-[\]]+:)?p[xlr]?-/.test(c)), 'a padding inside the nav column').toEqual([]);
  });

  it('D-5668: below the threshold the nav slot draws nothing, and the body is centred as on a page with no nav', () => {
    // A phone or a narrow pane shows the screen's own index instead (spec §4.2),
    // so the slot is hidden there, not stacked above the body.
    const at = `@min-[${PAGE_NAV_MIN_PX}px]:`;
    const { container } = scaffold({ nav: <nav aria-label="sections">n</nav> });
    const navColumn = screen.getByRole('navigation', { name: 'sections' }).parentElement!.className.split(/\s+/);
    expect(navColumn).toEqual(expect.arrayContaining(['hidden', `${at}block`]));
    const body = container.querySelector('[data-page-body]')!.className.split(/\s+/);
    expect(body).toEqual(expect.arrayContaining(['mx-auto', 'px-gutter']));
    expect(body.filter((c) => c === 'mx-0' || c === 'pl-0'), 'an unconditional nav-side measure').toEqual([]);
  });

  it('D-5668: every container breakpoint in the scaffold is PAGE_NAV_MIN_PX, so the CSS and the number cannot drift', () => {
    const src = stripTs(read('ui/src/primitives/page-scaffold.tsx'));
    const queries = [...src.matchAll(/@min-\[([^\]]+)\]/g)].map((m) => m[1]);
    expect(queries.length).toBeGreaterThan(0);
    expect([...new Set(queries)]).toEqual([`${PAGE_NAV_MIN_PX}px`]);
  });

  it('D-5666: with no nav there is no nav wrapper: the body is the scaffold\'s own child, its classes unchanged', () => {
    const { container } = scaffold();
    const root = container.querySelector('[data-page-scaffold]')!;
    const body = container.querySelector('[data-page-body]')!;
    expect(body.parentElement).toBe(root);
    expect([...root.children].map((c) => c.tagName)).toEqual(['HEADER', 'DIV']);
    // Today's callers (Mail, Runs, Accounts, Archive) pass no nav: their body
    // is the F11 drawing, class for class.
    expect(body.className).toBe(cn(PAGE_BODY, PAGE_FOCUS_CLEAR, 'max-w-(--page-max)'));
  });

  it('D-5667: focus scrolled into the body or the nav clears the sticky header (WCAG 2.2 SC 2.4.11)', () => {
    const { container } = scaffold({ nav: <nav aria-label="sections">n</nav> });
    const body = container.querySelector('[data-page-body]')!;
    const navColumn = screen.getByRole('navigation', { name: 'sections' }).parentElement!;
    for (const el of [body, navColumn]) {
      expect(el.className.split(/\s+/)).toContain('[&_*]:scroll-mt-[calc(var(--head-h)+var(--sp-2))]');
    }
    // The header's height is the reserve, so it re-points with the skin.
    expect(allTokens.has('--head-h')).toBe(true);
  });
});

describe('Section (D-5102, D-5666)', () => {
  it('a title is an h2, the scope and purpose are drawn, and the body is a card on the surface', () => {
    const { container } = render(
      <Section scope="This device" title="Appearance" purpose="How ccrc looks here.">
        <p>inside</p>
      </Section>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Appearance' })).toBeInTheDocument();
    expect(screen.getByText('This device')).toBeInTheDocument();
    expect(screen.getByText('How ccrc looks here.')).toBeInTheDocument();
    const card = screen.getByText('inside').parentElement!;
    expect(card.className.split(/\s+/)).toEqual(
      expect.arrayContaining(['bg-surface', 'p-card', 'rounded-lg', 'shadow-card', 'border-edge-subtle']),
    );
    // The section is a region named by its title.
    expect(container.querySelector('section')).toHaveAccessibleName('Appearance');
  });

  it("the scope's place is the skin's: one token, --section-flow, a SKIN_TOKENS member", () => {
    render(<Section scope="Whole fleet" title="Stall watch"><p>x</p></Section>);
    const head = screen.getByRole('heading', { level: 2 }).parentElement!;
    expect(head.className).toContain('[flex-direction:var(--section-flow)]');
    expect(allTokens.has('--section-flow')).toBe(true);
  });

  it('D-5666: the DOM order is the reading order, the title then whose it is', () => {
    render(<Section scope="Whole fleet" title="Stall watch"><p>x</p></Section>);
    const h2 = screen.getByRole('heading', { level: 2, name: 'Stall watch' });
    const head = h2.parentElement!;
    expect([...head.children].map((c) => c.tagName)).toEqual(['H2', 'P']);
    expect(head.children[1]).toHaveTextContent('Whole fleet');
  });

  it('D-5666: the purpose follows the head, and the card follows the purpose', () => {
    const { container } = render(
      <Section scope="This device" title="Appearance" purpose="How ccrc looks here."><p>inside</p></Section>,
    );
    const section = container.querySelector('section')!;
    const head = screen.getByRole('heading', { level: 2 }).parentElement!;
    const purpose = screen.getByText('How ccrc looks here.');
    const card = screen.getByText('inside').parentElement!;
    expect([...section.children]).toEqual([head, purpose, card]);
  });

  it('D-5666: each slot is omitted when absent: no empty scope, title, purpose or head', () => {
    const kids = (el: Element): string[] => [...el.children].map((c) => c.tagName);
    const only = (node: ReactNode): HTMLElement => {
      cleanup();
      return render(node).container.querySelector('section')!;
    };
    // The title alone: a head of one h2, then the card.
    let s = only(<Section title="Stall watch"><p>x</p></Section>);
    expect(kids(s)).toEqual(['DIV', 'DIV']);
    expect(kids(s.children[0]!)).toEqual(['H2']);
    // The scope alone: a head of one p, then the card.
    s = only(<Section scope="Whole fleet"><p>x</p></Section>);
    expect(kids(s)).toEqual(['DIV', 'DIV']);
    expect(kids(s.children[0]!)).toEqual(['P']);
    expect(s.querySelector('h2')).toBeNull();
    // The purpose alone: no head, the purpose, then the card.
    s = only(<Section purpose="One line."><p>x</p></Section>);
    expect(kids(s)).toEqual(['P', 'DIV']);
    // Nothing: the card alone, and no empty paragraph anywhere.
    s = only(<Section><p>x</p></Section>);
    expect(kids(s)).toEqual(['DIV']);
    expect([...s.querySelectorAll('p')].filter((p) => p.textContent === '')).toEqual([]);
  });

  it('D-5666: Refined lifts the scope above the title, Instrument sets it beside', () => {
    // Refined's place is the default, in tokens.css; Instrument's in skins.css's
    // bare block (every width, every pointer), and nowhere else.
    const flows = (css: string): string[] => [...css.matchAll(/--section-flow\s*:\s*([\w-]+)\s*;/g)].map((m) => m[1]!);
    expect(flows(stripCss(read('ui/src/styles/tokens.css')))).toEqual(['column-reverse']);
    const skins = stripCss(read('ui/src/styles/skins.css'));
    expect(flows(skins)).toEqual(['row']);
    const bare = /^:root\[data-skin='instrument'\]\s*\{([\s\S]*?)^\}/m.exec(skins)?.[1] ?? '';
    expect(flows(bare)).toEqual(['row']);
  });
});

describe('EmptyState (D-5102)', () => {
  it('says its sentence, and passes data attributes through for the state it names', () => {
    render(<EmptyState data-state="error" action={<button type="button">Retry</button>}>Nothing yet.</EmptyState>);
    const p = screen.getByText('Nothing yet.');
    expect(p.closest('[data-state]')?.getAttribute('data-state')).toBe('error');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('announces a loading state politely and an error assertively; an honest nothing is silent', () => {
    const { unmount } = render(<EmptyState data-state="loading">Loading…</EmptyState>);
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    unmount();
    const err = render(<EmptyState data-state="error">Could not reach the server.</EmptyState>);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not reach the server.');
    err.unmount();
    const { container } = render(<EmptyState data-state="ok">Nothing yet.</EmptyState>);
    expect(container.querySelector('[data-empty-state]')!.hasAttribute('role')).toBe(false);
  });

  it("a screen's own role wins over the state's", () => {
    render(<EmptyState data-state="error" role="status">Retrying…</EmptyState>);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Retrying…');
  });
});

describe('the four screens stand on the scaffold (D-5102)', () => {
  for (const [name, rel] of Object.entries(SCREENS)) {
    it(`${name} renders a PageScaffold`, () => {
      const src = stripTs(read(rel));
      expect(src).toMatch(/<PageScaffold\b/);
      expect(src, `${name} draws an h1 of its own`).not.toMatch(/<h1\b/);
    });
  }

  it('the four screens no longer carry their own title or empty classes', () => {
    const left: string[] = [];
    for (const [name, rel] of Object.entries(SCREENS)) {
      const src = stripTs(read(rel));
      for (const cls of RETIRED) if (new RegExp(`(["'\` ])${cls}(?=["'\` ])`).test(src)) left.push(`${name}: ${cls}`);
    }
    const css = stripCss(read('pwa/src/fleet/fleet.css'));
    for (const cls of RETIRED) if (new RegExp(`\\.${cls}(?![\\w-])`).test(css)) left.push(`fleet.css: .${cls}`);
    expect(left).toEqual([]);
  });
});
