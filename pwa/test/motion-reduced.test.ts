// Every rule that moves is named by a prefers-reduced-motion rule.
//
// WHY THIS EXISTS. The design-system waves found the same defect three times,
// each time by reading rather than by a red suite, and each time in a
// different stylesheet:
//
//   - `.chat-back` was in chat.css's reduced-motion block; `.accounts-back`,
//     `.mail-back`, `.runs-back` and `.settings-back` were in no block at all.
//     Four of five back chevrons animated for a reader who had asked nothing
//     to animate.
//   - Neither header door was in any block. Both animated.
//   - `.acct-fill` animates its WIDTH as a usage window fills. The block named
//     `.acct-list .acct-row`, which looks like coverage and is not: `transition`
//     does not inherit, and that row declares none of its own.
//
// The pattern is always the same — a control is written, its press transition
// is copied from a neighbour, and the neighbour's entry in the reduced-motion
// block is not. Nothing could see it: the contrast gate measures colour, the
// tap-floor scrape measures size, and vitest runs with `css: false` so no test
// in this repo computes a style at all. The only reader was a person.
//
// So the census is computed, not listed. A rule that declares `transition` or
// `animation` must have its selector named by a `prefers-reduced-motion` rule
// in the same stylesheet, or be registered below with a reason.
//
// NAMING IS NOT COVERAGE, which this guard learned the hard way. A media
// query adds NO specificity, so a `prefers-reduced-motion` block can only beat
// a rule declared BEFORE it. Adding `.acct-fill` (fleet.css:804) to the block
// at fleet.css:728 set `transition: none` and then the rule's own `transition`
// re-declared it seventy lines later and won — measured: the change did
// nothing at all. fleet.css carries a SECOND block at the end for exactly the
// rules declared after the first one. So this file checks both halves: that a
// moving selector is named, and that the block naming it sits later in the
// file than the rule it governs.
//
// WHAT THIS DOES NOT CLAIM. It checks that the preference is HONOURED, not
// that it is honoured well. `transition: none` and `animation: none` are the
// vocabulary the app already uses; tokens.css's own rule — "Disable loops
// outright; never zero their periods" — is a separate claim this guard has no
// opinion on. It also matches selectors TEXTUALLY: a block naming
// `.acct-list .acct-row` does not cover a bare `.acct-row`, which is exactly
// the distinction that let `.acct-fill` through, so the strictness is the
// point rather than an awkwardness to work around.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { stylesheets, PWA_ROOT } from '../design/audit.mjs';

const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '');

/** A `prefers-reduced-motion` block's body, brace-balanced from the `{` that
 *  opens the at-rule — NOT `[\s\S]*?\n\}`, which stops at the first nested
 *  rule's closing brace and would silently see only the block's first entry. */
function reducedMotionBodies(css: string): { body: string; end: number }[] {
  const out: { body: string; end: number }[] = [];
  for (const m of css.matchAll(/@media[^{]*prefers-reduced-motion[^{]*\{/g)) {
    const open = css.indexOf('{', m.index ?? 0);
    let depth = 0;
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') {
        depth -= 1;
        if (depth === 0) { out.push({ body: css.slice(open + 1, i), end: i }); break; }
      }
    }
  }
  return out;
}

const norm = (s: string): string => s.trim().replace(/\s+/g, ' ');

type Rule = { readonly file: string; readonly selector: string; readonly body: string };

function rulesIn(css: string, file: string): Rule[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m) => ({ file, selector: norm(m[1] ?? ''), body: m[2] ?? '' }))
    .filter((r) => r.selector !== '' && !r.selector.startsWith('@'));
}

/** Selectors a reduced-motion block names, mapped to the END OFFSET of the
 *  furthest block that names them. A rule is only beaten by a block that sits
 *  after it, so the offset is the half of the answer that naming alone misses. */
function covered(css: string, file: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const { body, end } of reducedMotionBodies(css)) {
    for (const r of rulesIn(body, file)) {
      for (const s of r.selector.split(',')) {
        const k = `${file} ${norm(s)}`;
        out.set(k, Math.max(out.get(k) ?? 0, end));
      }
    }
  }
  return out;
}

/** Rules that declare motion, OUTSIDE any reduced-motion block. `: none` is
 *  excluded because that is the cure, not the symptom — a block's own entries
 *  would otherwise report themselves. */
function moving(css: string, file: string): { key: string; at: number }[] {
  // Blanked, not deleted: removing the blocks would shift every later offset
  // and the position comparison below would be measuring a different file.
  const outside = css.replace(/@media[^{]*prefers-reduced-motion[^{]*\{[\s\S]*?\n\}/g,
    (m) => ' '.repeat(m.length));
  const out: { key: string; at: number }[] = [];
  for (const m of outside.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = norm(m[1] ?? '');
    const body = m[2] ?? '';
    if (selector === '' || selector.startsWith('@')) continue;
    if (!/(^|[;\s])(transition|animation)\s*:/.test(body) || /:\s*none/.test(body)) continue;
    // The rule's END offset — what a later block has to beat.
    const at = (m.index ?? 0) + m[0].length;
    for (const s of selector.split(',')) out.push({ key: `${file} ${norm(s)}`, at });
  }
  return out;
}

const sheets = stylesheets(PWA_ROOT) as string[];
const all = sheets.map((rel) => {
  const css = stripComments(readFileSync(path.join(PWA_ROOT as string, rel), 'utf8'));
  const file = rel.split('/').pop() ?? rel;
  return { rel, file, moving: moving(css, file), covered: covered(css, file) };
});

/** Motion deliberately left running under the preference, with the reason.
 *  Checked in BOTH directions below — an entry whose rule no longer declares
 *  motion is stale and reds, the shape `contrast.test.ts` applies to its own
 *  registries. */
const EXEMPT: Record<string, string> = {};

describe('every moving rule honours prefers-reduced-motion', () => {
  it('found motion to check — the scan is not vacuously empty', () => {
    // Without this the suite passes by matching nothing, which is how a census
    // guard dies. Measured 17 moving rules across both packages today.
    const total = all.reduce((n, s) => n + s.moving.length, 0);
    expect(total).toBeGreaterThanOrEqual(15);
  });

  it('found the reduced-motion blocks too — both halves, or the check is one-sided', () => {
    const total = all.reduce((n, s) => n + s.covered.size, 0);
    expect(total).toBeGreaterThanOrEqual(15);
  });

  it('names every moving selector in a reduced-motion rule', () => {
    const unnamed = all.flatMap((s) =>
      s.moving.filter((m) => !s.covered.has(m.key) && EXEMPT[m.key] === undefined).map((m) => m.key));
    expect(
      unnamed,
      'add the selector to its stylesheet’s prefers-reduced-motion block, or register it in EXEMPT with a reason',
    ).toEqual([]);
  });

  it('positions every naming block AFTER the rule it governs', () => {
    // The half that naming alone misses. A media query adds no specificity, so
    // a block earlier in the file loses to the rule's own later `transition`.
    // Measured on fleet.css: naming .acct-fill (804) in the block at 728 did
    // nothing, which is why there is a second block at the end of that file.
    const defeated = all.flatMap((s) => s.moving
      .filter((m) => {
        const blockEnd = s.covered.get(m.key);
        return blockEnd !== undefined && blockEnd < m.at && EXEMPT[m.key] === undefined;
      })
      .map((m) => `${m.key} — named by a block that ends before the rule does`));
    expect(
      defeated,
      'move the override into a prefers-reduced-motion block placed LATER in the file than the rule',
    ).toEqual([]);
  });

  it('registers no exemption for a rule that no longer moves', () => {
    const live = new Set(all.flatMap((s) => s.moving.map((m) => m.key)));
    expect(Object.keys(EXEMPT).filter((k) => !live.has(k))).toEqual([]);
  });
});
