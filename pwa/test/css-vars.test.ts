// Every var(--x) under src/ names a custom property that src/ defines.
//
// WHY THIS EXISTS. `.acct-meter[data-band='crit'] .acct-fill` read
// `var(--limit-crit, #f85149)`. The token is spelled `--limit-critical`, so the
// declared fallback — a GitHub red belonging to no palette, identical in both
// themes — is what the critical usage meter actually painted, in every build,
// for as long as the rule existed.
//
// Nothing could see it. An undefined custom property does not warn, does not
// fail a build, and does not fall out of a visual diff (the bar is red either
// way). design/audit.mjs cannot see it either, and not by oversight: a var()
// FALLBACK is a colour the auditor is structurally unable to attribute to a
// token, so the gate printed ALL PASS over a rule that had left the palette.
//
// The guard is therefore not about colour at all — it is about the seam. A
// misspelled token is an overloaded null: `var()` collapses "this token, which
// exists" and "no such token, use the literal" into one silent value at the
// exact place a stylesheet reaches for the design system.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every `.css` under `dir`, discovered — never listed. A list of files is the
 *  same drift class as a list of colours (see design/audit.mjs's header). */
function stylesheets(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile() && e.name.endsWith('.css')) out.push(path.join(e.parentPath, e.name));
  }
  return out.sort();
}

type Unresolved = { readonly token: string; readonly where: string };

/** Every source directory the app's stylesheets are spread across. TWO now:
 *  tokens.css and the primitives' styling live in @ccrc/ui, so a scan of this
 *  package alone would report every single token as unresolved — and, worse,
 *  a scan of ui alone would call the app's rules resolved while nothing checked
 *  them. The seam this guard exists to watch is exactly the one the package
 *  boundary just introduced. */
const srcDirs = (root: string): string[] =>
  [path.join(root, 'src'), path.join(root, '..', 'ui', 'src')].filter((d) => fs.existsSync(d));

/** Custom properties referenced across those directories that none of them
 *  defines. */
function unresolved(root: string): Unresolved[] {
  const defined = new Set<string>();
  const sheets = srcDirs(root).flatMap(stylesheets).map((f) => ({
    rel: path.relative(root, f),
    // Comments quote tokens that were deliberately NOT adopted, and quote
    // whole declarations verbatim — both would register as definitions.
    text: fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
  }));
  for (const s of sheets) {
    for (const m of s.text.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) defined.add(m[1] as string);
  }
  const out: Unresolved[] = [];
  for (const s of sheets) {
    for (const m of s.text.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) {
      const token = m[1] as string;
      if (defined.has(token)) continue;
      const line = s.text.slice(0, m.index).split('\n').length;
      out.push({ token, where: `${s.rel}:${line}` });
    }
  }
  return out;
}

describe('every var() under src/ resolves to a token src/ defines', () => {
  it('finds enough to be measuring something', () => {
    // Vacuity guard: a regex that matched nothing would make the case below
    // green forever — the shape of a fake gate.
    expect(srcDirs(ROOT).flatMap(stylesheets).length).toBeGreaterThanOrEqual(5);
  });

  it('leaves nothing unresolved', () => {
    expect(unresolved(ROOT)).toEqual([]);
  });

  it('and reds on the exact defect it was written for', () => {
    // The measured RED. Without it this file is a comment, not a mechanism:
    // `toEqual([])` passes just as happily against a checker that can no longer
    // parse anything.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccrc-cssvars-'));
    try {
      // The fixture reproduces the real sibling layout — <tmp>/pwa beside
      // <tmp>/ui — because that is what srcDirs walks.
      fs.cpSync(path.join(ROOT, 'src'), path.join(dir, 'pwa/src'), { recursive: true });
      fs.cpSync(path.join(ROOT, '../ui/src'), path.join(dir, 'ui/src'), { recursive: true });
      const f = path.join(dir, 'pwa/src/fleet/fleet.css');
      fs.writeFileSync(
        f,
        fs.readFileSync(f, 'utf8').replace('var(--limit-critical)', 'var(--limit-crit, #f85149)'),
      );
      expect(unresolved(path.join(dir, 'pwa'))).toEqual([
        { token: '--limit-crit', where: expect.stringContaining('fleet.css:') },
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
