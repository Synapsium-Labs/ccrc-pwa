// ONE METER, ON THE PALETTE (D-5098).
//
// Three meters drew a usage window three ways: `LimitBar`'s rows (a 4px track
// from `LIMIT_TRACK`), `AccountMeterRow`'s `.acct-meter` (5px, painted by
// fleet.css with a crit red, `#f85149`, that belonged to no palette, on a
// `--bg-well` track that is near-black in Daylight), and `AccountRow`'s
// `Gauge`, assembled by hand from the first one's parts. Every one of them now
// draws through `Meter`, and the meter owns its box: its height, radius,
// track, overflow and fill. An app sheet is unlayered and beats the meter's
// utilities, so a sheet that sizes, rounds or paints a meter would silently
// keep a skin's meter shape off the screen; that is why the second case below
// reads every stylesheet under pwa/src, not just fleet.css.
//
// The hook classes `acct-meter`, `acct-fill` and `data-band` stay on the
// rendered elements: fleet-screen.test.tsx counts `.acct-fill`.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { Meter } from '@ccrc/ui';
import type { AccountUsage } from '../../shared/api';
import { AccountsScreen } from '../src/screens/AccountsScreen';
import { api } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { useFleetStore } from '../src/stores/fleet';
import { TEST_ROSTER } from './rosterFixture';

const PWA_SRC = path.join(import.meta.dirname, '..', 'src');
const UI_SRC = path.join(import.meta.dirname, '..', '..', 'ui', 'src');
const STYLES = path.join(UI_SRC, 'styles');

const read = (p: string): string => readFileSync(p, 'utf8');
const stripCssComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '');
const stripTsComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');

function walk(dir: string, keep: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full, keep));
    else if (keep(e.name)) out.push(full);
  }
  return out;
}

type Rule = { selectors: string[]; decls: { prop: string; value: string }[] };

/** Every innermost rule of a sheet, media-nested ones included. */
function rules(css: string): Rule[] {
  return [...stripCssComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m) => ({
      selectors: (m[1] ?? '').split(',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean),
      decls: (m[2] ?? '').split(';').map((d) => {
        const i = d.indexOf(':');
        return i < 0 ? null : { prop: d.slice(0, i).trim(), value: d.slice(i + 1).trim() };
      }).filter((d): d is { prop: string; value: string } => d !== null && d.prop !== ''),
    }))
    .filter((r) => r.selectors.length > 0 && !r.selectors[0]!.startsWith('@'));
}

const METER_HOOK = /\.(acct-meter|acct-fill|meter|meter-fill|limit-track|limit-fill)(?![\w-])/;

const nowSec = Math.floor(Date.now() / 1000);
const acct = (over: Partial<AccountUsage>): AccountUsage => ({
  wrapper: 'claude', five: 0, seven: 0, ts: nowSec - 3600,
  fiveResetAt: null, sevenResetAt: null,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false, ...over,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navigate('/');
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], blocked: false }));
});

describe('the meter is on the palette', () => {
  it('fleet.css carries no meter colour: no #f85149, and no --bg-well on .acct-meter', () => {
    const fleet = read(path.join(PWA_SRC, 'fleet', 'fleet.css'));
    expect(stripCssComments(fleet).toLowerCase()).not.toContain('#f85149');
    const wells = rules(fleet)
      .filter((r) => r.selectors.some((s) => /\.acct-meter(?![\w-])/.test(s)))
      .filter((r) => r.decls.some((d) => d.value.includes('--bg-well')))
      .map((r) => r.selectors.join(', '));
    expect(wells).toEqual([]);
  });

  it('no app sheet sizes or rounds a meter: no height, border-radius or background on .acct-meter or .acct-fill in any stylesheet under pwa/src', () => {
    const offenders: string[] = [];
    for (const f of walk(PWA_SRC, (n) => n.endsWith('.css'))) {
      for (const r of rules(read(f))) {
        const hit = r.selectors.filter((s) => METER_HOOK.test(s));
        if (hit.length === 0) continue;
        for (const d of r.decls) {
          if (/^(height|min-height|max-height|border-radius|background(-color|-image)?|mask(-image)?)$/.test(d.prop)) {
            offenders.push(`${path.relative(PWA_SRC, f)}: ${hit.join(', ')} { ${d.prop}: ${d.value} }`);
          }
        }
      }
    }
    expect(offenders, 'the meter owns its box; pass trackClassName/fillClassName for hooks only').toEqual([]);
  });

  it("the meter's track is --limit-track and its crit fill is --limit-critical", () => {
    const { container } = render(<Meter pct={91} band="crit" />);
    const track = container.querySelector('.meter');
    const fill = container.querySelector('.meter-fill');
    expect(track).toHaveClass('bg-limit-track', 'rounded-full', 'overflow-hidden');
    // Its height is the skin's token, so Instrument's 8px cannot fall back to a
    // literal (D-5447).
    expect(track).toHaveClass('h-(--meter-h)');
    expect(fill).toHaveClass('bg-limit-critical');
    expect(fill).toHaveStyle({ width: '91%' });
    expect(track).toHaveAttribute('data-band', 'crit');
  });

  it('one implementation: no element outside meter.tsx paints a limit track or fill', () => {
    const offenders: string[] = [];
    const files = [
      ...walk(PWA_SRC, (n) => /\.tsx?$/.test(n)),
      ...walk(UI_SRC, (n) => /\.tsx?$/.test(n)),
    ];
    for (const f of files) {
      const rel = path.relative(path.join(UI_SRC, '..', '..'), f);
      if (rel === path.join('ui', 'src', 'primitives', 'meter.tsx')) continue;
      // A re-export names the vocabulary without drawing anything with it.
      const code = stripTsComments(read(f)).replace(/^\s*export\s*\{[^}]*\}\s*from\s*'[^']*';?\s*$/gm, '');
      for (const pat of ['LIMIT_TRACK', 'fillVariants(', 'bg-limit-', 'limit-fill']) {
        if (code.includes(pat)) offenders.push(`${rel}: ${pat}`);
      }
      // A meter drawn by hand with the old hook classes (D-5447). Lowercase
      // `className=` only, so `Meter`'s own `trackClassName`/`fillClassName`
      // props, which pass the hooks to it, are not drawing anything.
      if (/\bclassName=[^>\n]*\bacct-(meter|fill)(?![\w-])/.test(code)) offenders.push(`${rel}: hand-drawn acct-meter/acct-fill`);
    }
    expect(offenders).toEqual([]);
  });

  it('an unmeasured window draws no fill; a measured 0% draws a zero-width fill', () => {
    const { container: none } = render(<Meter pct={null} band="ok" />);
    expect(none.querySelector('.meter')).not.toBeNull();
    expect(none.querySelector('.meter-fill')).toBeNull();
    cleanup();
    const { container: zero } = render(<Meter pct={0} band="ok" />);
    const fill = zero.querySelector('.meter-fill');
    expect(fill).not.toBeNull();
    expect(fill).toHaveStyle({ width: '0%' });
  });

  it('a disabled lane\'s meter is off while data-band still reports crit', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue({
      accounts: [acct({ wrapper: 'claude', five: 92, disabled: true })], projected: null, roster: TEST_ROSTER,
    });
    render(<AccountsScreen />);
    const row = (await screen.findByText('team·max')).closest('[data-disabled]') as HTMLElement;
    expect(row).toHaveAttribute('data-disabled', 'true');
    const meter = row.querySelector(".acct-meter[data-band='crit']");
    expect(meter).not.toBeNull();
    const fill = meter!.querySelector('.acct-fill');
    expect(fill).toHaveClass('limit-fill--off', 'bg-ink-tertiary');
    expect(fill).not.toHaveClass('bg-limit-critical');
  });
});

describe('the meter has a shape, and the shape is a skin token', () => {
  const meterCss = (): string => read(path.join(UI_SRC, 'primitives', 'meter.css'));

  it('the segment mask reads --meter-segments and --meter-gap, and :root makes it continuous', () => {
    const css = stripCssComments(meterCss());
    expect(css).toMatch(/mask-image\s*:[^;]*repeating-linear-gradient/);
    expect(css).toContain('var(--meter-segments)');
    expect(css).toContain('var(--meter-gap)');
    const tokens = stripCssComments(read(path.join(STYLES, 'tokens.css')));
    const root = tokens.slice(tokens.indexOf(':root {'), tokens.indexOf('}', tokens.indexOf(':root {')));
    expect(root).toMatch(/--meter-h:\s*5px;/);
    expect(root).toMatch(/--meter-segments:\s*1;/);
    expect(root).toMatch(/--meter-gap:\s*0px;/);
    const skins = stripCssComments(read(path.join(STYLES, 'skins.css')));
    const inst = skins.slice(skins.indexOf(":root[data-skin='instrument'] {"));
    const block = inst.slice(0, inst.indexOf('}'));
    expect(block).toMatch(/--meter-h:\s*8px;/);
    expect(block).toMatch(/--meter-segments:\s*10;/);
    expect(block).toMatch(/--meter-gap:\s*2px;/);
  });

  it('meter.css holds no colour literal: its mask is built from currentColor and transparent only', () => {
    const css = stripCssComments(meterCss());
    const masks = rules(css).flatMap((r) => r.decls).filter((d) => /mask/.test(d.prop));
    expect(masks.length).toBeGreaterThan(0);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i);
    const ALLOWED = new Set([
      'repeating-linear-gradient', 'to', 'right', 'calc', 'var', 'currentcolor', 'transparent',
      '--meter-segments', '--meter-gap', '--meter-seg', 'px', '%',
    ]);
    const words = masks.flatMap((d) => d.value.match(/--?[a-z][\w-]*|[a-z][\w-]*/gi) ?? [])
      .map((w) => w.toLowerCase()).filter((w) => !ALLOWED.has(w));
    expect(words).toEqual([]);
  });
});
