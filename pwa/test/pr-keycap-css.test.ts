// jsdom applies no stylesheet, so PrKeycap's phase/checks colour mapping
// cannot be asserted through a render (same limitation fleet-css.test.ts
// documents for fleet.css) — reading the stylesheet as text is what stops it
// regressing silently. Two things this file exists to pin specifically:
// `unchecked` must not read as `none` (hollow+dashed vs hollow+solid), and
// the two new tokens (`--pr-merged`, `--pr-dim`) must stay ALIASES of
// `--acct-violet` / `--ink-tertiary` rather than drifting back into a
// second hardcoded copy of either colour (see tokens.css's own comment).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { declValue, ruleIn } from './cssRule';

const chatCss = readFileSync(
  path.join(import.meta.dirname, '..', 'src', 'session', 'chat.css'), 'utf8');
const tokensCss = readFileSync(
  path.join(import.meta.dirname, '..', 'src', 'styles', 'tokens.css'), 'utf8');

// Shared rule reader (test/cssRule.ts), not a third hand-rolled copy — fix
// round 3, verifier P5. chat.css and tokens.css belong to the ui-css lane and
// are being edited in parallel; the scrape must break on a changed
// declaration, never on a changed indent.

const rule = (sel: string): string => ruleIn(chatCss, sel);

describe('the PR keycap CSS', () => {
  it('never shrinks below the 44px tap floor, and tightens only the inline padding', () => {
    const base = rule('.keycap--pr');
    expect(base).toContain('min-width: var(--tap-min)');
    expect(base).toContain('padding-inline: 6px');
    expect(base).toContain('gap: 3px');
  });

  it('sizes the legend and glyph off the shared 2xs scale, not a one-off literal', () => {
    expect(rule('.keycap--pr .pr-legend')).toContain('var(--text-2xs)');
    expect(rule('.keycap--pr .pr-glyph')).toContain('font-size: var(--text-2xs)');
  });

  it('draws the dot from currentColor, so every phase/checks rule below only ever sets `color`', () => {
    const dot = rule('.keycap--pr .pr-dot');
    expect(dot).toContain('border: 1px solid currentColor');
    expect(dot).toContain('background: currentColor');
  });

  it('empties the dot for no-commits and draft — nothing to report yet, not a status', () => {
    expect(rule(".keycap--pr[data-phase='no-commits'] .pr-dot")).toContain('background: none');
    expect(rule(".keycap--pr[data-phase='draft'] .pr-dot")).toContain('background: none');
  });

  it('gives unchecked a hollow, dashed dot — distinct from none\'s hollow solid one', () => {
    const unchecked = rule(".keycap--pr[data-phase='unchecked'] .pr-dot");
    expect(unchecked).toContain('border-style: dashed');
    expect(unchecked).toContain('background: none');
    const none = rule(".keycap--pr[data-phase='none'] .pr-dot");
    expect(none).not.toContain('dashed');
    expect(none).toContain('background: none');
  });

  it('gives unknown the same hollow-dashed treatment as unchecked', () => {
    const unknown = rule(".keycap--pr[data-phase='unknown'] .pr-dot");
    expect(unknown).toContain('border-style: dashed');
    expect(unknown).toContain('background: none');
  });

  it('colours the merged dot with --pr-merged, and closed with --pr-dim', () => {
    expect(rule(".keycap--pr[data-phase='merged'] .pr-dot")).toContain('color: var(--pr-merged)');
    expect(rule(".keycap--pr[data-phase='closed']")).toContain('color: var(--pr-dim)');
    expect(rule(".keycap--pr[data-phase='closed'] .pr-legend")).toContain('text-decoration: line-through');
  });

  it('maps the three CI outcomes to the existing status hues, not new ones', () => {
    expect(rule(".keycap--pr[data-checks='pass'] .pr-dot")).toContain('color: var(--status-busy)');
    expect(rule(".keycap--pr[data-checks='fail'] .pr-dot")).toContain('color: var(--status-dead)');
    expect(rule(".keycap--pr[data-checks='pending'] .pr-dot")).toContain('color: var(--status-attention)');
  });

  it('keeps --pr-merged and --pr-dim as ALIASES, not a second hardcoded colour', () => {
    // A literal hex here would need its own light-theme override to clear the
    // 3:1 contrast floor (see tokens.css's comment); aliasing an
    // already-themed token is what makes the single declaration correct in
    // both themes at once.
    // Fix round 4, controller item 1: this pair used to be raw `toContain` on
    // the file text, pinning the FOUR spaces tokens.css currently aligns
    // `--pr-dim`'s value with — the same shape the shared reader exists to
    // kill. Read the declaration out of `:root` instead, so re-aligning the
    // column is free and changing the alias is not.
    const root = ruleIn(tokensCss, ':root');
    expect(declValue(root, '--pr-merged')).toBe('var(--acct-violet)');
    expect(declValue(root, '--pr-dim')).toBe('var(--ink-tertiary)');
  });
});
