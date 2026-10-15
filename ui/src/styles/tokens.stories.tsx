// The token reference — DISCOVERED, never typed.
//
// The README explains the rules and nothing showed the values: to answer "what
// is `--ink-tertiary` in Gruvbox" you read a generated block in tokens.css and
// resolved an alias by hand. This page answers it by asking the document.
//
// IT READS THE CSSOM, which is the only source that cannot drift. A hand-kept
// list is the drift class this whole package argues against — `themes.ts`'s
// header says a list of things-to-audit rots the same way a list of colours
// does — and a build-time parse of tokens.css would be a SECOND parser beside
// `design/audit.mjs`'s, disagreeing with it eventually. Here the names come
// from the `:root` rules the browser actually loaded and every value is
// `getComputedStyle`'s, so an alias resolves because the browser resolved it
// and a palette renders because the palette is applied.
//
// WHICH MEANS THE TOOLBAR WORKS. `preview.ts` stamps the selected theme
// through the app's own `applyTheme`, so switching palettes re-renders this
// page in that palette — the page IS the palette, rather than a picture of one.
//
// THE TAILWIND BRIDGE IS SHOWN SEPARATELY and on purpose. `theme.css` maps
// `--color-*`, `--spacing-*`, `--text-*` onto these tokens so a utility can
// reach them, and those two layers answer different questions: "what colour is
// the secondary ink" and "which utility gets me there". `theme-bridge.test.ts`
// guards the mapping; this only shows it.
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';

/** Every custom property declared on `:root` by a loaded stylesheet, in
 *  declaration order, deduplicated.
 *
 *  `[data-theme]` blocks are SKIPPED: they declare the same names again for
 *  another palette, and the value shown comes from the computed style anyway —
 *  reading them would list each name a dozen times to no effect. A sheet the
 *  browser will not let us read (none here, but a CDN font sheet elsewhere)
 *  throws on `.cssRules`, so each is tried alone. */
function rootTokens(): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule)) continue;
      if (!/(^|,)\s*:root\s*(,|$)/.test(rule.selectorText)) continue;
      for (const prop of Array.from(rule.style)) {
        if (!prop.startsWith('--') || seen.has(prop)) continue;
        seen.add(prop);
        names.push(prop);
      }
    }
  }
  return names;
}

const valueOf = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Does this value paint? `color-mix()` and `oklch()` are as much a colour as
 *  a hex is, and this palette uses both. */
const isColour = (v: string): boolean =>
  /^(#|rgb|hsl|oklch|color-mix|transparent\b|currentColor\b)/i.test(v);

/** The families tokens.css itself is organised into, in its own order. A name
 *  that matches none lands in "other", which is the honest answer and also the
 *  prompt to add a family here when a new one appears. */
const FAMILIES: { title: string; note: string; match: RegExp }[] = [
  { title: 'Grounds', note: 'What a surface is painted with.', match: /^--bg-/ },
  { title: 'Ink', note: 'What text is painted with. Each one is measured against the grounds above.', match: /^--ink-/ },
  { title: 'Edges', note: 'Hairlines. Decorative — tokens.css makes no contrast claim for them.', match: /^--edge-/ },
  { title: 'Accent', note: 'The phosphor, and what is legible on it.', match: /^--accent/ },
  { title: 'Status', note: 'A session state. Never read out of colour alone — every one has a glyph or a word beside it.', match: /^--status-/ },
  { title: 'Accounts', note: 'The per-account hues, and their tints.', match: /^--acct-/ },
  { title: 'Limits', note: 'The usage gauge: its track and its three bands.', match: /^--limit-/ },
  { title: 'Diff', note: 'Added and removed, in a patch.', match: /^--diff-/ },
  { title: 'Syntax', note: 'The highlighter’s palette, inside a well.', match: /^--syn-/ },
  { title: 'Spacing', note: 'The step scale. 9px and 10px exist as literals in two components; both say why.', match: /^--sp-/ },
  { title: 'Type', note: 'Sizes, families, weights, leading, tracking.', match: /^--(fs|family|weight|lh|ls)-/ },
  { title: 'Radii', note: '', match: /^--r-/ },
  { title: 'Motion', note: 'Durations and curves. Every loop has a reduced-motion answer.', match: /^--(dur|curve|breathe)-/ },
  { title: 'Targets', note: 'The tap floor, and what a well may grow to.', match: /^--(tap|max)-/ },
];

const BRIDGE = /^--(color|spacing|text|font|leading|tracking|radius|shadow|ease|animate)-/;

function Swatch({ value }: { value: string }): ReactNode {
  return (
    <span
      aria-hidden="true"
      style={{ background: value }}
      className="inline-block size-6 shrink-0 rounded-sm border border-edge-subtle"
    />
  );
}

function Row({ name }: { name: string }): ReactNode {
  const value = valueOf(name);
  return (
    <div className="grid grid-cols-[1.5rem_minmax(0,14rem)_minmax(0,1fr)] items-center gap-3 py-1">
      {isColour(value) ? <Swatch value={value} /> : <span />}
      <code className="min-w-0 truncate font-mono text-2xs text-ink-primary">{name}</code>
      <code className="min-w-0 truncate font-mono text-2xs text-ink-tertiary">{value}</code>
    </div>
  );
}

function Group({ title, note, names }: { title: string; note: string; names: string[] }): ReactNode {
  if (names.length === 0) return null;
  return (
    <section className="grid gap-1">
      <h3 className="font-mono text-2xs font-medium uppercase tracking-caps text-ink-tertiary not-italic">
        {title}
      </h3>
      {note !== '' && <p className="m-0 max-w-[60ch] text-xs leading-normal text-ink-secondary">{note}</p>}
      <div className="grid border-t border-edge-subtle pt-1">
        {names.map((n) => <Row key={n} name={n} />)}
      </div>
    </section>
  );
}

function Reference({ bridge }: { bridge: boolean }): ReactNode {
  const all = rootTokens().filter((n) => (bridge ? BRIDGE.test(n) : !BRIDGE.test(n)));
  const taken = new Set<string>();
  const groups = FAMILIES.map((f) => {
    const names = all.filter((n) => f.match.test(n) && !taken.has(n));
    for (const n of names) taken.add(n);
    return { ...f, names };
  });
  const rest = all.filter((n) => !taken.has(n));
  return (
    <div className="grid gap-6 bg-page p-4 text-ink-primary">
      <p className="m-0 max-w-[60ch] text-sm leading-normal text-ink-secondary">
        {bridge
          ? 'The Tailwind bridge: the names a utility reaches a token by. theme.css maps each '
            + 'one onto a token above, and theme-bridge.test.ts guards that it is an alias and '
            + 'not a baked value.'
          : 'Every custom property this document declares on :root, with the value the browser '
            + 'resolved. Switch palettes in the toolbar — the page is the palette, not a picture '
            + 'of one.'}
      </p>
      {bridge
        ? <Group title="Bridge" note="" names={all} />
        : groups.map((g) => <Group key={g.title} title={g.title} note={g.note} names={g.names} />)}
      {!bridge && <Group title="Other" note="Matched no family above — the prompt to add one." names={rest} />}
    </div>
  );
}

const meta = {
  title: 'Foundations/Tokens',
  component: Reference,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The token reference, read off the CSSOM rather than typed. Names come from the '
          + ':root rules the browser loaded and every value is getComputedStyle’s, so an alias '
          + 'resolves because the browser resolved it and a palette renders because the palette '
          + 'is applied — switching themes in the toolbar re-renders this in that palette.',
      },
    },
  },
} satisfies Meta<typeof Reference>;
export default meta;

type Story = StoryObj<typeof meta>;

/** The design tokens themselves. */
export const Tokens: Story = { args: { bridge: false } };

/** The `@theme` bridge — how a utility class reaches one of the above. */
export const TailwindBridge: Story = { args: { bridge: true } };
