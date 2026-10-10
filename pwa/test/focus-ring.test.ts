// Keyboard focus is the design system's, and it is a census.
//
// WHAT WAS WRONG. `@ccrc/ui` carried ZERO `:focus-visible` rules across every
// component it ships. The ring lived in one blanket rule in the app's
// `base.css`, which has two consequences a package should not accept: no
// component could show a focus state in Storybook (that stylesheet is not
// loaded there), so a design system shipping 24 components could neither
// demonstrate nor review keyboard focus for any of them; and no component
// could vary its ring, having none of its own.
//
// THIS CHANGED NO PIXELS, and the build proves it rather than the prose:
// `FOCUS_RING` compiles to `outline-style: var(--tw-outline-style)` (registered
// `initial-value: solid`), `outline-width: 2px`, `outline-color: var(--accent)`
// and `outline-offset: 2px` — which is exactly what base.css's
// `outline: 2px solid var(--accent); outline-offset: 2px` compiles to in the
// same bundle. In the app the unlayered blanket rule wins on cascade order and
// paints what it always painted; in Storybook these utilities are what draw.
//
// WHY A CENSUS AND NOT A LIST. Six components were given the ring first and
// SEVEN MORE still rendered a focusable control without one — measured, not
// guessed. A list would have frozen that half-done state; a census makes the
// next component that renders a `<button>` red until it joins.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { loadThemes, ratio } from '../design/audit.mjs';
import { FOCUS_RING } from '@ccrc/ui';

const UI_SRC = path.join(import.meta.dirname, '..', '..', 'ui', 'src');
const BASE_CSS = readFileSync(
  path.join(import.meta.dirname, '..', 'src', 'styles', 'base.css'), 'utf8');

/** Component sources only — stories render whatever they like. */
function componentFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...componentFiles(p));
    else if (e.name.endsWith('.tsx') && !e.name.endsWith('.stories.tsx')) out.push(p);
  }
  return out;
}

/** Comment-free source. A `<button>` named in prose is not a control, and
 *  `typed-label.tsx` describes one in its header — the reason this strip
 *  exists rather than a bare grep. */
const codeOnly = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');

const RENDERS_CONTROL = /<(button|input|textarea)([\s>]|$)/;

const files = componentFiles(UI_SRC).map((f) => ({
  rel: path.relative(UI_SRC, f).split(path.sep).join('/'),
  code: codeOnly(readFileSync(f, 'utf8')),
}));

describe('every focusable control in @ccrc/ui carries the ring', () => {
  it('found controls to check — the census is not vacuously empty', () => {
    // Without this the suite passes by matching nothing, which is how a census
    // guard dies. Measured 13 component files rendering a control today.
    const controls = files.filter((f) => RENDERS_CONTROL.test(f.code));
    expect(controls.length).toBeGreaterThanOrEqual(12);
  });

  it('carries one FOCUS_RING per control, not one per FILE', () => {
    // PER CONTROL, and that distinction was measured rather than assumed. The
    // first spelling of this test asked only whether the file MENTIONED
    // FOCUS_RING; deleting the ring from one of tool-card's three buttons left
    // it green, because the other two still mentioned it. A census that counts
    // files cannot see a control regress inside a file that already passes.
    const short = files
      .map((f) => {
        // A control REMOVED FROM THE TAB ORDER needs no ring, and that is a
        // rule rather than an escape hatch: `tabIndex={-1}` means the thing
        // cannot be keyboard-focused, so a focus style on it would be dead
        // code pretending to be coverage. AttachButton's `<input type="file">`
        // is the live case — `display: none` AND `tabIndex={-1}`, clicked
        // through a ref by the visible button beside it.
        const controls = [...f.code.matchAll(/<(button|input|textarea)\b[^>]*>/g)]
          .filter((m) => !/tabIndex=\{-1\}|tabindex="-1"|type="hidden"/.test(m[0])).length;
        // Uses, not mentions: the import line names it once and rings nothing.
        const uses = [...f.code.matchAll(/\bFOCUS_RING\b/g)].length
          - (/import \{[^}]*\bFOCUS_RING\b[^}]*\} from/.test(f.code) ? 1 : 0);
        return { rel: f.rel, controls, uses };
      })
      .filter((f) => f.controls > 0 && f.uses < f.controls)
      .map((f) => `${f.rel}: ${f.controls} control(s), ${f.uses} ring(s)`);
    expect(
      short,
      'every <button>/<input> a component renders owns a focus ring — import FOCUS_RING from lib/focus',
    ).toEqual([]);
  });

  it('is the ring base.css already drew, token for token', () => {
    // The two must not drift: the app's rule wins the cascade, so a FOCUS_RING
    // that said something else would be invisible in the app and WRONG in
    // Storybook — the worst shape, because only the design system would lie.
    expect(FOCUS_RING).toContain('focus-visible:outline-2');
    expect(FOCUS_RING).toContain('focus-visible:outline-accent');
    expect(FOCUS_RING).toContain('focus-visible:outline-offset-2');
    expect(FOCUS_RING).not.toContain('focus:');          // never a mouse press
    const rule = /:focus-visible\s*\{([^}]*)\}/.exec(BASE_CSS)?.[1] ?? '';
    expect(rule.replace(/\s+/g, ' ')).toContain('outline: 2px solid var(--accent)');
    expect(rule.replace(/\s+/g, ' ')).toContain('outline-offset: 2px');
  });

  it('clears WCAG 2.1 SC 1.4.11 (3:1) on every ground, in every palette', () => {
    // A focus indicator is a non-text contrast requirement. --accent is the
    // ring; --bg-page, --bg-surface and --bg-raised are what a focused control
    // sits on. Measured 4.57 at worst (GitHub Light, on raised).
    const { DARK, byName } = loadThemes(path.join(import.meta.dirname, '..'));
    const all: [string, Record<string, string>][] = [['DARK', DARK], ...Object.entries(byName)];
    const thin = all.flatMap(([name, theme]) =>
      ['var(--bg-page)', 'var(--bg-surface)', 'var(--bg-raised)']
        .map((ground) => ({ name, ground, r: ratio('var(--accent)', [ground], theme) }))
        .filter(({ r }) => r < 3)
        .map(({ ground, r }) => `${name} ring on ${ground} = ${r.toFixed(2)}`));
    expect(thin).toEqual([]);
  });
});
