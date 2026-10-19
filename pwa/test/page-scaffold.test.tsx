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
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { EmptyState, PageScaffold, Section } from '@ccrc/ui';
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
    const literal = /\bmax-w-\[[^\]]*\d[^\]]*\]|max-width:\s*\d/;
    const src = stripTs(read('ui/src/primitives/page-scaffold.tsx'));
    expect(src, 'a literal column width in the scaffold').not.toMatch(literal);
    for (const wide of [false, true]) {
      const { container, unmount } = scaffold({ wide });
      const body = container.querySelector('[data-page-body]');
      expect(body, 'the scaffold names its body').not.toBeNull();
      const classes = body!.className.split(/\s+/);
      expect(classes).toContain(wide ? 'max-w-(--page-max-wide)' : 'max-w-(--page-max)');
      expect(classes.filter((c) => /^max-w-/.test(c))).toHaveLength(1);
      unmount();
    }
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
    expect(screen.getByRole('navigation', { name: 'sections' })).toBeInTheDocument();
    const body = container.querySelector('[data-page-body]')!;
    expect(body.className.split(/\s+/)).toContain('max-w-(--page-max)');
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
});

describe('EmptyState (D-5102)', () => {
  it('says its sentence, and passes data attributes through for the state it names', () => {
    render(<EmptyState data-state="error" action={<button type="button">Retry</button>}>Nothing yet.</EmptyState>);
    const p = screen.getByText('Nothing yet.');
    expect(p.closest('[data-state]')?.getAttribute('data-state')).toBe('error');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
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
