// The design system's contrast gate, run as a test.
//
// There is ONE auditor — design/audit.mjs — and both the gate command
// (`node design/contrast-check.mjs`, the one the plan and all three reviews
// quote) and this file call it. That is the whole point of this round's css
// work, so read the header of design/audit.mjs first: it explains why a
// hand-typed token table and a hand-typed pair list are the shape that let a
// 2.44:1 blocker and a fifteen-pair opacity failure ship under a green gate,
// and why the previous fix — a SECOND auditor in this file with its own
// 15-entry DECLARED_PAIRS copy of the stylesheet — reproduced the same class
// one directory away.
//
// What is left in this file is only what a test can do and a gate cannot:
//   * arithmetic controls — seven ratios the team computed by hand over three
//     years of tokens.css comments, so a drift in the maths moves here first;
//   * structural assertions about the audit itself (it measured a non-trivial
//     number of things; nothing is registered that no longer exists);
//   * MUTATION proofs — a copy of the stylesheets is mutated on disk and the
//     REAL gate command is run against it, once per escape route that has
//     actually been used to smuggle a failure past this gate.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GROUNDS,
  INHERITED_GROUNDS,
  KEYFRAME_TROUGHS,
  OPACITY_REGISTRY,
  SELF_GROUNDED_EXEMPT,
  audit,
  bgImageOf,
  bgOf,
  blockBody,
  compoundChain,
  contrast,
  customProps,
  paintOf,
  declOf,
  keyframeTroughs,
  loadThemes,
  opacityNumber,
  over,
  ratio,
  resolveColor,
  ruleKey,
  rulesOf,
  selectorList,
  stylesheets,
  subjectCompound,
  variantSuffix,
} from '../design/audit.mjs';

const ROOT = process.cwd();

// ── tmp fixtures ────────────────────────────────────────────────────────────
// This file called mkdtempSync bare and never removed the directory: 688
// /tmp/contrast-* dirs had accumulated by the time it was found, the oldest
// dated the day this branch's work started, and a mutation sweep runs the
// suite 50-120 times.
//
// afterEACH, not afterAll: an afterAll cannot be observed from inside the file
// it runs for, so the previous fix needed a second, per-test `finally` to have
// anything to pin — and then the hook itself was dead weight (removing it left
// the suite green and leaked nothing). One mechanism, and the test below
// observes it by reading the path the PREVIOUS test recorded.
const madeTmp: string[] = [];
const removed: string[] = [];
function mkTmp(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  madeTmp.push(dir);
  return dir;
}
function removeTmpFixtures(): void {
  for (const dir of madeTmp.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
    removed.push(dir);
  }
}
afterEach(removeTmpFixtures);

/** A throwaway copy of everything the gate reads: design/*.mjs and every
 *  stylesheet, at the same relative paths (audit.mjs resolves the package root
 *  from import.meta.url, so the copy audits ITSELF, not the real tree). */
function gateTree(): string {
  const dir = mkTmp('contrast-');
  mkdirSync(path.join(dir, 'design'), { recursive: true });
  for (const f of ['audit.mjs', 'contrast-check.mjs']) {
    cpSync(path.join(ROOT, 'design', f), path.join(dir, 'design', f));
  }
  for (const rel of stylesheets(ROOT)) {
    const dest = path.join(dir, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    cpSync(path.join(ROOT, rel), dest);
  }
  return dir;
}

const edit = (dir: string, rel: string, fn: (s: string) => string): void => {
  const p = path.join(dir, rel);
  const before = readFileSync(p, 'utf8');
  const after = fn(before);
  if (after === before) throw new Error(`mutation for ${rel} changed nothing — the anchor moved`);
  writeFileSync(p, after);
};

/** Run the REAL gate command against a mutated copy of the tree. */
function runGate(dir: string = ROOT): { status: number | null; stdout: string } {
  const r = spawnSync(process.execPath, [path.join(dir, 'design/contrast-check.mjs')], {
    encoding: 'utf8',
  });
  return { status: r.status, stdout: r.stdout };
}

// ── the live tree ───────────────────────────────────────────────────────────
const report = audit(ROOT);
const { DARK, LIGHT } = loadThemes(ROOT);
const THEMES: readonly (readonly [string, Record<string, string>])[] = [
  ['DARK ', DARK],
  ['LIGHT', LIGHT],
];
const live = runGate();
const out = live.stdout;

/** "PASS 4.58 (min 4.5) LIGHT ask header chip / accent-tint #0E7B3F on #DFF2E5" */
const measured = (label: string): { ratio: number; min: number } => {
  const line = out.split('\n').find((l) => l.includes(label));
  if (line === undefined) throw new Error(`contrast gate measures no pair matching "${label}"`);
  const [, r, min] = /^\w+\s+([\d.]+)\s+\(min ([\d.]+)\)/.exec(line.trim()) ?? [];
  return { ratio: Number(r), min: Number(min) };
};

describe('the gate command', () => {
  it('passes every pair it measures', () => {
    expect(out).not.toMatch(/^FAIL/m);
    expect(out).toMatch(/\nALL \d+ PASS/);
  });

  // Docs run the gate standalone (`… && node design/contrast-check.mjs`), so
  // the exit status — not just the printed summary — has to carry the verdict.
  // A gate that prints "2 FAILURES" and exits 0 is a gate no chain can trip on.
  it('exits 0 when every pair passes', () => {
    expect(live.status).toBe(0);
  });

  it('measures far more than the 94 token pairs it used to', () => {
    const n = Number(/\nALL (\d+) PASS/.exec(out)?.[1]);
    expect(n).toBeGreaterThan(200);
  });

  it('names every stylesheet it read, so a missing one is visible in the output', () => {
    for (const rel of report.sheets) expect(out).toContain(rel);
  });
});

// ── mutation proofs ─────────────────────────────────────────────────────────
// Each case is a route that HAS been used to get a live WCAG failure past this
// gate, or that a reviewer measured as still open. They run the real gate
// binary against a mutated copy of the real tree, so nothing here can pass by
// the test and the gate disagreeing about what the auditor does.
describe('the gate fails a mutated tree', () => {
  let lastTree: string | undefined;

  const expectFail = (rel: string, mutate: (s: string) => string): string => {
    const dir = gateTree();
    lastTree = dir;
    edit(dir, rel, mutate);
    const r = runGate(dir);
    expect(r.stdout).toMatch(/^FAIL/m);
    expect(r.status).not.toBe(0);
    return r.stdout;
  };

  it('a token in tokens.css is retuned below the floor', () => {
    // Proves the gate PARSES tokens.css rather than carrying a copy of it:
    // there is no hex in design/ left to mutate.
    expectFail('src/styles/tokens.css', (s) => s.replace('--ink-primary:   #ECF0EC', '--ink-primary:   #151815'));
  });

  it('a rule takes the finding-1 shape (paper ink on the dark well)', () => {
    // gates #1, the BLOCKER: --ink-secondary on --bg-well is 2.44 in light.
    const o = expectFail('src/session/chat.css', (s) =>
      s.replace('.pr-check-names { color: var(--status-dead-text);', '.pr-check-names { color: var(--ink-secondary); background: var(--bg-well);'));
    expect(o).toMatch(/FAIL.*LIGHT chat\.css \.pr-check-names/);
  });

  it('the finding-1 shape is hidden in src/styles/base.css', () => {
    // verify2-css P3: base.css was absent from the auditor's SHEETS list, so a
    // rule with this exact shape passed green. Stylesheets are DISCOVERED now.
    const o = expectFail('src/styles/base.css', (s) =>
      s.replace('::selection {', '.base-mutant { color: var(--ink-secondary); background: var(--bg-well); }\n::selection {'));
    expect(o).toMatch(/FAIL.*LIGHT base\.css \.base-mutant/);
  });

  it('a markdown CALLOUT VARIANT rebinds its tint to the well', () => {
    // verify2-css P1, the exact escape the previous auditor could not see: the
    // five variants set no `color`, so a hand-written DECLARED_PAIRS list was
    // the only thing measuring them and it was a literal copy. Now the base
    // rule is re-measured once per variant.
    const o = expectFail('src/session/chat.css', (s) =>
      s.replace(
        "[data-callout='warning']   { --callout-hue: var(--status-attention-text); --callout-tint: var(--status-attention-tint); }",
        "[data-callout='warning']   { --callout-hue: var(--status-attention-text); --callout-tint: var(--bg-well); }",
      ));
    expect(o).toMatch(/FAIL.*LIGHT chat\.css \.msg-assist \.callout \[as .*warning/);
  });

  it("a callout variant's label hue is made invisible against its own tint", () => {
    // The second half of P1: `--callout-hue: var(--status-attention-tint)`
    // paints the ::before label the same colour as the panel behind it (1.00).
    const o = expectFail('src/session/chat.css', (s) =>
      s.replace(
        "[data-callout='warning']   { --callout-hue: var(--status-attention-text);",
        "[data-callout='warning']   { --callout-hue: var(--status-attention-tint);",
      ));
    expect(o).toMatch(/FAIL.*chat\.css \.msg-assist \.callout::before \[as .*warning/);
  });

  // ── the three spellings that forged the "unforgeable" claim ───────────────
  // verify3-css P1. The variant check used to compare whole selector STRINGS
  // with startsWith, so each of these reintroduced the reported 2.44:1 blocker
  // — --ink-secondary body ink on the light-theme well — with the gate printing
  // ALL 234 PASS and exiting 0. Every one is an ordinary way to write CSS; the
  // grouped one is how anybody writes two variants that share a tint, and the
  // tree already groups selectors for exactly that (`.dot--busy, .dot--attention`).
  const CALLOUT_BEFORE = '.msg-assist .callout::before {';
  const forge = (rule: string): ((s: string) => string) =>
    (s) => s.replace(CALLOUT_BEFORE, `${rule}\n${CALLOUT_BEFORE}`);

  it.each([
    [
      'GROUPED with a second variant',
      ".msg-assist .callout[data-callout='warning'], .msg-assist .callout[data-callout='caution'] { --callout-tint: var(--bg-well); }",
    ],
    [
      'given an extra ancestor',
      ".msg-assist .md-body .callout[data-callout='warning'] { --callout-tint: var(--bg-well); }",
    ],
    [
      "qualified on the variant's ancestor",
      ".msg-assist[data-md] .callout[data-callout='warning'] { --callout-tint: var(--bg-well); }",
    ],
    [
      'written without the ancestor at all',
      ".callout[data-callout='rogue'] { --callout-tint: var(--bg-well); }",
    ],
  ])('a callout variant %s still cannot hide the well', (_n, rule) => {
    const o = expectFail('src/session/chat.css', forge(rule));
    expect(o).toMatch(/FAIL\s+2\.44 .*LIGHT chat\.css \.msg-assist \.callout \[as /);
    expect(o).toMatch(/FAIL\s+2\.44 .*LIGHT chat\.css \.msg-assist \.callout::before \[as /);
  });

  it('a callout variant hides the well from ANOTHER stylesheet', () => {
    // The same-file filter was a filter, not a fact: a component sheet
    // retinting a primitive is ordinary, and the browser does not care which
    // file a custom property was rebound in.
    const o = expectFail('src/fleet/fleet.css', (s) =>
      `${s}\n.msg-assist .callout[data-callout='crossfile'] { --callout-tint: var(--bg-well); }\n`);
    expect(o).toMatch(/FAIL\s+2\.44 .*LIGHT chat\.css \.msg-assist \.callout \[as fleet\.css /);
  });

  it("a pseudo-element spells its host differently from the rule that paints it", () => {
    // The same string comparison, one function down: the ::before host was
    // looked up by exact `file selector` key, so a pseudo hanging off a
    // differently-spelled host was silently unmeasured.
    const o = expectFail('src/session/chat.css', (s) =>
      `${s}\n.msg-assist .md-body .callout::before { color: var(--callout-tint); }\n`);
    expect(o).toMatch(/FAIL\s+1\.00 .*chat\.css \.msg-assist \.md-body \.callout::before/);
  });

  // ── the value the browser paints, not the first one written ───────────────
  // verify3-css P2. `declOf` took the FIRST matching declaration; CSS applies
  // the LAST. `background: <fallback>; background: var(--x)` is the standard
  // progressive-enhancement idiom, so this was one ordinary rule away from
  // auditing every duplicated property against a value nothing paints.
  it.each([
    [
      'a duplicated `background` — the second one is what paints',
      '.e7-mutant { color: var(--ink-secondary); background: var(--bg-surface); background: var(--bg-well); }',
      /FAIL\s+2\.44 .*LIGHT chat\.css \.e7-mutant/,
    ],
    [
      'a duplicated `color` — the second one is what paints',
      '.e7b-mutant { background: var(--bg-well); color: var(--ink-on-well); color: var(--ink-secondary); }',
      /FAIL\s+2\.44 .*LIGHT chat\.css \.e7b-mutant/,
    ],
    [
      'a duplicated `opacity` — the second one is what fades',
      '.e10-mutant { opacity: 1; opacity: 0.72; }',
      /unregistered fade chat\.css \.e10-mutant 0\.72/,
    ],
    [
      '`background: none` reset, then a `background-color` longhand',
      '.e1-mutant { color: var(--ink-secondary); background: none; background-color: var(--bg-well); }',
      /FAIL\s+2\.44 .*LIGHT chat\.css \.e1-mutant/,
    ],
  ])('the gate measures %s', (_n, rule, want) => {
    expect(expectFail('src/session/chat.css', (s) => `${s}\n${rule}\n`)).toMatch(want);
  });

  // ── the VARIANT SHAPE, not the four spellings of it ───────────────────────
  // final2-gates F1, the MAJOR: `contextsFor` returned only the base unless the
  // base declared custom properties, and then admitted only variants that
  // REBOUND one of them. A variant that overrode `color` directly was never
  // measured — which is how `.code-block-copy:hover,
  // .code-block-copy[data-copied]` shipped 11px uppercase mono text at 3.03:1
  // in the light theme with this gate printing ALL 234 PASS.
  //
  // Three rounds have each closed one spelling of "variant". These are the
  // other ways the SHAPE occurs, enumerated with the auditor's own exports
  // rather than from memory, and each one is a route that was green before this
  // commit. Every mutant reintroduces the same reported blocker (--ink-secondary
  // on the light-theme well, 2.44) so nothing here can pass by measuring
  // something else.
  it.each([
    [
      'overrides `color` on a :hover of a self-grounded rule',
      'src/session/chat.css',
      '.pr-body-preview:hover { color: var(--ink-secondary); }',
      /FAIL\s+2\.44 .*LIGHT chat\.css \.pr-body-preview \[as \.pr-body-preview:hover\]/,
    ],
    [
      'overrides `color` from ANOTHER stylesheet',
      'src/fleet/fleet.css',
      ".pr-body-preview[data-x] { color: var(--ink-secondary); }",
      /FAIL\s+2\.44 .*LIGHT chat\.css \.pr-body-preview \[as fleet\.css \.pr-body-preview\[data-x\]\]/,
    ],
    [
      'swaps only the GROUND under an inherited ink',
      'src/session/chat.css',
      '.metachip.is-rogue { background: var(--bg-well); }',
      /FAIL\s+2\.44 .*LIGHT chat\.css \.metachip \[as \.metachip\.is-rogue\]/,
    ],
    [
      'restates the WHOLE selector a second time, colour only',
      'src/session/chat.css',
      '.pr-body-preview { color: var(--ink-secondary); }',
      /FAIL\s+2\.44 .*LIGHT chat\.css \.pr-body-preview \[as \.pr-body-preview\]/,
    ],
    [
      'restates the whole selector a second time, ground only',
      'src/session/chat.css',
      '.metachip { background: var(--bg-well); }',
      /FAIL\s+2\.44 .*LIGHT chat\.css \.metachip \[as \.metachip\]/,
    ],
    [
      'splits the ink and the ground across two rules with the SAME qualifier',
      'src/session/chat.css',
      '.metachip:hover { color: var(--ink-secondary); }\n.metachip:hover { background: var(--bg-well); }',
      /FAIL\s+2\.44 .*LIGHT chat\.css \.metachip \[as \.metachip:hover \+ \.metachip:hover\]/,
    ],
    [
      'is a DESCENDANT of a self-grounded rule its own selector names',
      'src/session/chat.css',
      '.msg-assist pre .rogue { color: var(--ink-secondary); }',
      /FAIL\s+2\.44 .*LIGHT chat\.css \.msg-assist pre \.rogue \[in chat\.css \.msg-assist pre\]/,
    ],
  ])('a rule that %s cannot hide the well', (_n, rel, rule, want) => {
    expect(expectFail(rel as string, (s) => `${s}\n${rule}\n`)).toMatch(want);
  });

  it('the live rule the MAJOR was found in is measured, in both themes', () => {
    // Not a mutation — a pin on the live tree, because the defect was that
    // NOTHING measured this rule. Both rows must exist and both must clear 4.5:
    // the label is --text-2xs (11px) uppercase mono, so it is body text.
    const rows = report.measured.filter((m) =>
      m.label.includes('chat.css .code-block-copy [as .code-block-copy:hover, .code-block-copy[data-copied]]'));
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.floor).toBe(4.5);
      expect(r.detail).toContain('var(--accent-on-well)');
      expect(r.ratio, r.label).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('retuning --accent-on-well back to the theme accent fails the gate', () => {
    // The bind between the fix and the gate: --accent flips with the theme and
    // the light one is tuned for paper, so on the well bar it is 3.03. If
    // anybody "simplifies" this token away, the gate says so.
    const o = expectFail('src/session/chat.css', (s) =>
      s.replace('color: var(--accent-on-well);\n  border-color: color-mix(in srgb, var(--accent-on-well) 40%, transparent);',
        'color: var(--accent);\n  border-color: color-mix(in srgb, var(--accent) 40%, transparent);'));
    expect(o).toMatch(/FAIL\s+3\.0\d .*LIGHT chat\.css \.code-block-copy \[as \.code-block-copy:hover/);
  });

  // ── background-image: read, or fail loudly. Never skipped ─────────────────
  // final2-gates F3. `bgOf` matched only `background` / `background-color`, so
  // a rule that painted its own opaque ground with a gradient and put
  // unreadable text on it was skipped SILENTLY — contradicting this file's own
  // claim that an unparsed paint is a FAIL and never a skip. There is no live
  // instance today; this is the hole the next gradient walks through, and the
  // design system already uses gradients (.attach-strip, .md-table-wrap,
  // .skel-line).
  it.each([
    ['the `background-image` longhand', '.forge-bgimg { color: var(--ink-secondary); background-image: linear-gradient(var(--bg-well), var(--bg-well)); }'],
    ['a url() image', '.forge-bgurl { color: var(--ink-secondary); background-image: url(x.png); }'],
    ['an image inside the `background` shorthand', '.forge-bgshort { color: var(--ink-secondary); background: linear-gradient(#fff, #fff); }'],
    ['an image ground introduced by a VARIANT', '.metachip.is-grad { background-image: linear-gradient(#fff, #fff); }'],
  ])('%s is an unmeasurable paint and therefore a FAILURE', (_n, rule) => {
    const o = expectFail('src/session/chat.css', (s) => `${s}\n${rule}\n`);
    expect(o).toMatch(/background-image .* is a paint that cannot be reduced to a colour/);
  });

  // ── CASE. CSS property names are ASCII case-insensitive; this file was not ──
  // final2-gates F2. `COLOR:` / `BACKGROUND:` / `OPACITY:` are declarations a
  // browser paints, and every one of them was invisible to declOf, bgOf and the
  // fade sweep — so the reported 2.44:1 blocker shape forged the whole gate to
  // ALL 234 PASS just by being written in uppercase. Nobody hand-writes
  // `COLOR:`, but "the gate reads a different stylesheet than the browser" is
  // the class, not the spelling.
  it.each([
    [
      'the blocker shape in UPPERCASE',
      '.forge-upper { COLOR: var(--ink-secondary); BACKGROUND: var(--bg-well); }',
      /FAIL\s+2\.44 .*LIGHT chat\.css \.forge-upper/,
    ],
    [
      'the blocker shape in MiXeD case, longhand background',
      '.forge-mixed { CoLoR: var(--ink-secondary); Background-Color: var(--bg-well); }',
      /FAIL\s+2\.44 .*LIGHT chat\.css \.forge-mixed/,
    ],
    [
      'an element fade spelled OPACITY',
      '.forge-op { OPACITY: 0.4; }',
      /unregistered fade chat\.css \.forge-op 0\.4/,
    ],
    [
      'a whole animation spelled @KEYFRAMES with an UPPERCASE stop',
      '@KEYFRAMES forge-kf { FROM { OPACITY: 0.2; } to { opacity: 1; } }',
      /unregistered keyframe trough chat\.css forge-kf 0\.2/,
    ],
  ])('the gate reads %s exactly as a browser does', (_n, rule, want) => {
    expect(expectFail('src/session/chat.css', (s) => `${s}\n${rule}\n`)).toMatch(want);
  });

  it('an UPPERCASE stop cannot deepen an already-registered trough unseen', () => {
    // The subtlest half of F2: the registry key is `file name min`, so an
    // uppercase stop inside an animation that is ALREADY registered lowered the
    // real trough without changing the key — the registry stayed green over a
    // deeper dip. Both directions fire now: the new minimum is unregistered and
    // the old one is stale.
    const o = expectFail('src/session/chat.css', (s) =>
      s.replace('@keyframes working-dot {', '@keyframes working-dot { 10% { OPACITY: 0.05; }'));
    expect(o).toMatch(/unregistered keyframe trough chat\.css working-dot 0\.05/);
    expect(o).toMatch(/stale keyframes registry entry: chat\.css working-dot 0\.25/);
  });

  it('a new element fade is added with no contrast decision', () => {
    const o = expectFail('src/session/chat.css', (s) =>
      s.replace('.pr-check-names {', '.sess-meta-mutant { opacity: 0.72; }\n.pr-check-names {'));
    expect(o).toMatch(/unregistered fade chat\.css \.sess-meta-mutant 0\.72/);
  });

  it('the same fade is spelled `opacity: 72%`', () => {
    // verify2-css P2: `Number('72%')` is NaN and the previous auditor FILTERED
    // NaN out of the fade set, so this shipped unregistered and unmeasured.
    const o = expectFail('src/session/chat.css', (s) =>
      s.replace('.pr-check-names {', '.sess-meta-mutant { opacity: 72%; }\n.pr-check-names {'));
    expect(o).toMatch(/unregistered fade chat\.css \.sess-meta-mutant 0\.72/);
  });

  it('the same fade is spelled `opacity: 0.72 !important`', () => {
    // Same NaN hole; `!important` is already used in this audited file set.
    const o = expectFail('src/session/chat.css', (s) =>
      s.replace('.pr-check-names {', '.sess-meta-mutant { opacity: 0.72 !important; }\n.pr-check-names {'));
    expect(o).toMatch(/unregistered fade chat\.css \.sess-meta-mutant 0\.72/);
  });

  it('a registered fade is deepened past the floor of a pair it composites', () => {
    const o = expectFail('src/components/primitives.css', (s) =>
      s.replace('    opacity: 0.85;', '    opacity: 0.7;'));
    expect(o).toMatch(/unregistered fade primitives\.css/);
  });

  it('an unregistered @keyframes opacity trough is introduced', () => {
    // The list of troughs was hand-typed and already wrong (dot-breathe 0.55
    // was missing from it), so the list is discovered and checked.
    const o = expectFail('src/components/primitives.css', (s) =>
      s.replace('@keyframes skel-shimmer {', '@keyframes mutant-fade { from { opacity: 0.2; } to { opacity: 1; } }\n@keyframes skel-shimmer {'));
    expect(o).toMatch(/unregistered keyframe trough primitives\.css mutant-fade 0\.2/);
  });

  // ── the branches that say "the auditor could not measure this" ────────────
  // verify3-css P3. Every one of these was correct code with DECORATIVE
  // coverage: each could be replaced with a bare `continue` and all 145 tests
  // stayed green, and two of them are exactly the claims the round-3 report
  // makes in prose ("a gate FAILURE rather than a skip", "unregistered, stale
  // and non-literal stops are all gate failures"). A gate whose failure
  // branches are untested is not a gate — an unmeasurable thing must FAIL, and
  // that is the direction nothing was checking.
  it('an `opacity` the auditor cannot read as a number is a FAILURE, not a skip', () => {
    const o = expectFail('src/session/chat.css', (s) => `${s}\n.e11-mutant { opacity: var(--x-fade); }\n`);
    expect(o).toMatch(/chat\.css \.e11-mutant: opacity "var\(--x-fade\)" is not a static value/);
  });

  it('a @keyframes stop the auditor cannot read as a number is a FAILURE, not a skip', () => {
    const o = expectFail('src/components/primitives.css', (s) =>
      s.replace('@keyframes skel-shimmer {', '@keyframes mutant-var { from { opacity: var(--x); } to { opacity: 1; } }\n@keyframes skel-shimmer {'));
    expect(o).toMatch(/@keyframes primitives\.css mutant-var has an opacity stop that is not a static value/);
  });

  it('a translucent background with no GROUNDS entry is a FAILURE, not a skip', () => {
    // A rule whose fill is a wash cannot be measured without knowing what it
    // is washed OVER, and that is the one thing this file still hand-writes.
    // Skipping such a rule is how a translucent tint ships unmeasured.
    const o = expectFail('src/session/chat.css', (s) =>
      `${s}\n.e12-mutant { color: var(--ink-primary); background: color-mix(in srgb, var(--bg-well) 50%, transparent); }\n`);
    expect(o).toMatch(/chat\.css \.e12-mutant: background .* is translucent and has no GROUNDS entry/);
  });

  it('a KEYFRAME_TROUGHS entry left behind by a renamed animation is a FAILURE', () => {
    // The stale direction for OPACITY_REGISTRY was pinned; the stale direction
    // for KEYFRAME_TROUGHS was not, so `keyframes: []` passed the whole suite.
    const o = expectFail('src/session/chat.css', (s) => s.replace('@keyframes attach-spin {', '@keyframes attach-spin-2 {'));
    expect(o).toMatch(/stale keyframes registry entry: chat\.css attach-spin 1/);
  });

  // The same sweep, run over EVERY failure branch in audit.mjs rather than the
  // four the review named: each `problems.push` was neutered in turn and each
  // `stale` direction set to []. Five more branches and three more stale
  // directions were green under that, so they are pinned here too.
  it('a PSEUDO-ELEMENT painting with a colour the auditor cannot resolve is a FAILURE', () => {
    // The colour of the ::before label, replaced — not prepended: declOf reads
    // the LAST declaration now, so a prepended one would be overwritten.
    const o = expectFail('src/session/chat.css', (s) =>
      s.replace('  color: var(--callout-hue);\n', '  color: var(--no-such-token);\n'));
    expect(o).toMatch(/chat\.css \.msg-assist \.callout::before.*unknown custom property --no-such-token/);
  });

  it('an INHERITED_GROUNDS entry whose rule was renamed away is a FAILURE', () => {
    const o = expectFail('src/fleet/fleet.css', (s) =>
      s.replace('.proj-archived-body .sess-line:not(.sess-line--active) .sess-label {',
        '.proj-archived-body .sess-line:not(.sess-line--active) .sess-label-renamed {'));
    // Two branches, one mutation: the hand-written ground names a rule that is
    // gone, and the registry key is stale.
    expect(o).toMatch(/stale INHERITED_GROUNDS entry: no rule fleet\.css \.proj-archived-body/);
    expect(o).toMatch(/stale inherited registry entry: fleet\.css \.proj-archived-body/);
  });

  it('an INHERITED_GROUNDS rule that stops setting a colour of its own is a FAILURE', () => {
    // The whole point of the entry is that the GROUND is hand-written and the
    // COLOUR is read from the stylesheet. A rule that inherits its colour has
    // nothing left for the auditor to read, so the entry measures nothing.
    const o = expectFail('src/fleet/fleet.css', (s) =>
      s.replace('.proj-archived-body .sess-line:not(.sess-line--active) .sess-label {\n  color: var(--ink-secondary);',
        '.proj-archived-body .sess-line:not(.sess-line--active) .sess-label {\n  color: inherit;'));
    expect(o).toMatch(/INHERITED_GROUNDS fleet\.css \.proj-archived-body.* sets no colour of its own/);
  });

  it('an INHERITED_GROUNDS rule painting with an unresolvable colour is a FAILURE', () => {
    const o = expectFail('src/fleet/fleet.css', (s) =>
      s.replace('.proj-archived-body .sess-line:not(.sess-line--active) .sess-label {\n  color: var(--ink-secondary);',
        '.proj-archived-body .sess-line:not(.sess-line--active) .sess-label {\n  color: var(--no-such-token);'));
    expect(o).toMatch(/fleet\.css \.proj-archived-body.*unknown custom property --no-such-token/);
  });

  it('an OPACITY_REGISTRY pair the auditor cannot resolve is a FAILURE', () => {
    // The pairs are hand-written in audit.mjs, so the mutant goes there — the
    // gate tree carries its own copy of the auditor, which is the point.
    const o = expectFail('design/audit.mjs', (s) =>
      s.replace("[['running tool dot on a card', 'var(--status-busy)'", "[['running tool dot on a card', 'var(--no-such-token)'"));
    expect(o).toMatch(/chat\.css \.tool-dot--run 0\.8 — running tool dot on a card: unknown custom property/);
  });

  it('a GROUNDS entry whose rule stopped being self-grounded is a FAILURE', () => {
    const o = expectFail('src/session/chat.css', (s) => s.replace('.code-block-copy {\n', '.code-block-copy-renamed {\n'));
    expect(o).toMatch(/stale grounds registry entry: chat\.css \.code-block-copy /);
  });

  it('a SELF_GROUNDED_EXEMPT entry left behind by a renamed rule is a FAILURE', () => {
    const o = expectFail('src/session/chat.css', (s) => s.replace('.send-btn:disabled {\n', '.send-btn-renamed:disabled {\n'));
    expect(o).toMatch(/stale exempt registry entry: chat\.css \.send-btn:disabled /);
  });

  it('a rule paints with a colour the auditor cannot resolve', () => {
    // The failure direction that matters most: an unparsed colour must be a
    // FAIL, never a silent skip.
    const o = expectFail('src/styles/base.css', (s) =>
      s.replace('  background: var(--bg-page);\n  color: var(--ink-primary);', '  background: CanvasText;\n  color: var(--ink-primary);'));
    expect(o).toMatch(/unparsed colour expression/);
  });

  it('the tint token and the solid it derives from are retuned apart', () => {
    // verify2-css P5: the 12% wash used to be written out in three stylesheets
    // and five test rows. Now tokens.css owns it and this pin binds the two
    // spellings of it together.
    const o = expectFail('src/styles/tokens.css', (s) =>
      s.replace('--status-dead-tint-solid: color-mix(in srgb, var(--status-dead) 12%, var(--bg-surface))',
        '--status-dead-tint-solid: color-mix(in srgb, var(--status-dead) 20%, var(--bg-surface))'));
    expect(o).toMatch(/dead-tint-solid/);
  });

  it('a registry entry is left behind pointing at a rule that is gone', () => {
    const o = expectFail('src/fleet/fleet.css', (s) => s.replace('.bell:disabled {\n  opacity: 0.35;', '.bell:disabled {\n  opacity: 1;'));
    expect(o).toMatch(/stale opacity registry entry: fleet\.css \.bell:disabled 0\.35/);
  });

  // The pin for the /tmp leak: the removal has to be observable from the NEXT
  // test, because a hook cannot be observed from inside the test it runs for.
  it('leaves no /tmp fixture behind', () => {
    expect(lastTree).toBeDefined();
    expect(existsSync(lastTree as string)).toBe(false);
    expect(madeTmp).toEqual([]);
    expect(removed.length).toBeGreaterThan(0);
  });
});

// ── labelled token pairs the design system promises ─────────────────────────
describe('token pairs the gate must keep measuring', () => {
  // 11px text (--text-2xs) is body text, not a UI glyph: 4.5, not 3:1.
  it.each([
    'DARK  ask header chip / accent-tint',
    'LIGHT ask header chip / accent-tint',
    'DARK  preview toggle / sheet',
    'LIGHT preview toggle / sheet',
  ])('measures %s at the 4.5 body threshold', (label) => {
    const { ratio: r, min } = measured(label);
    expect(min).toBe(4.5);
    expect(r).toBeGreaterThanOrEqual(4.5);
  });

  // Originally the project-group header, which had no ground of its own, so
  // both of the things it put the attention hue behind sat on the bare page.
  // The dot (now .proj-card-attn, on a card surface) is a glyph at 3:1; the
  // projected-account line was 11px text at 4.5, which is why it took
  // --status-attention-TEXT — LIGHT's dot hue reads 3.58 on the page and would
  // fail the body threshold. Both pairs stay as defensive floors.
  it.each([
    ['DARK  attention dot / page', 3],
    ['LIGHT attention dot / page', 3],
    ['DARK  attention-text / page', 4.5],
    ['LIGHT attention-text / page', 4.5],
  ])('measures %s at the %s threshold', (label, floor) => {
    const { ratio: r, min } = measured(label);
    expect(min).toBe(floor);
    expect(r).toBeGreaterThanOrEqual(floor);
  });

  // The PR keycap's merged dot (Task 15) is a non-text graphical object, so
  // 3:1 — not the 4.5 body-text floor. Both themes clear 4.5 too (8.06 dark,
  // 5.93 light), so without pinning the min itself here, a mutant that
  // loosened the pair's threshold to 4.5 would still print PASS and survive.
  it.each([
    'DARK  pr-merged / raised',
    'LIGHT pr-merged / raised',
  ])('measures %s at the 3:1 UI threshold, not 4.5 body', (label) => {
    const { ratio: r, min } = measured(label);
    expect(min).toBe(3);
    expect(r).toBeGreaterThanOrEqual(3);
  });

  // Build 2, attention UX: the two-glyph rule's new `done` and `cleanup`
  // buckets (StatusDot's ✓ and ♻). Both dots are non-text graphical objects
  // on the same two grounds every other status dot is measured on — a
  // project card (--bg-surface) and the terminal lamp floor (--bg-well,
  // .sess-lamp) — so 3:1, not the 4.5 body floor.
  it.each([
    ['DARK  done dot / surface', 3],
    ['LIGHT done dot / surface', 3],
    ['DARK  done dot / lamp well', 3],
    ['LIGHT done dot / lamp well', 3],
    ['DARK  cleanup dot / surface', 3],
    ['LIGHT cleanup dot / surface', 3],
    ['DARK  cleanup dot / lamp well', 3],
    ['LIGHT cleanup dot / lamp well', 3],
  ])('measures %s at the %s UI threshold', (label, floor) => {
    const { ratio: r, min } = measured(label);
    expect(min).toBe(floor);
    expect(r).toBeGreaterThanOrEqual(floor);
  });

  // The `-text` half of each — a defensive floor at the 4.5 body threshold,
  // the same shape `attention-text` and `dead-text` already keep above, for
  // the day something paints a word rather than a dot with either token.
  it.each([
    ['DARK  done-text / surface', 4.5],
    ['LIGHT done-text / surface', 4.5],
    ['DARK  cleanup-text / surface', 4.5],
    ['LIGHT cleanup-text / surface', 4.5],
  ])('measures %s at the %s body threshold', (label, floor) => {
    const { ratio: r, min } = measured(label);
    expect(min).toBe(floor);
    expect(r).toBeGreaterThanOrEqual(floor);
  });
});

// ── the arithmetic ──────────────────────────────────────────────────────────
describe('the auditor itself', () => {
  // Ratios the team computed by hand, over three years of tokens.css comments.
  // If the parser or the maths drifts, these move first.
  it.each([
    ['ink-tertiary on the light well', 'var(--ink-tertiary)', ['var(--bg-well)'], LIGHT, 3.167],
    ['dark violet on the LIGHT raised', '#C7A7F4', ['var(--bg-raised)'], LIGHT, 1.746],
    ['pr-merged on raised, dark', 'var(--pr-merged)', ['var(--bg-raised)'], DARK, 8.057],
    ['pr-merged on raised, light', 'var(--pr-merged)', ['var(--bg-raised)'], LIGHT, 5.932],
    ['ink-tertiary on raised, dark', 'var(--ink-tertiary)', ['var(--bg-raised)'], DARK, 5.27],
    ['ink-tertiary on raised, light', 'var(--ink-tertiary)', ['var(--bg-raised)'], LIGHT, 4.864],
    // alpha compositing: the EXIT pill is 12% --status-dead over a card
    ['dead-text on the EXIT pill', 'var(--status-dead-text)', ['var(--bg-surface)', 'var(--status-dead-tint)'], DARK, 5.884],
  ])('reproduces the hand-computed %s', (_n, fg, bg, theme, want) => {
    expect(ratio(fg as string, bg as string[], theme as Record<string, string>)).toBeCloseTo(want as number, 2);
  });

  it('resolves var() chains rather than only literals', () => {
    // --pr-merged -> --acct-violet -> a hex, per theme.
    expect(resolveColor('var(--pr-merged)', DARK)).toEqual(resolveColor('#C7A7F4', DARK));
    expect(resolveColor('var(--pr-merged)', LIGHT)).toEqual(resolveColor('#6D3FB4', LIGHT));
  });

  it.each(THEMES)('%s mixes colour in PREMULTIPLIED alpha, per CSS Color 5', (_n, theme) => {
    // color-mix(in srgb, C p%, transparent) is C at p% alpha — NOT p% of C's
    // channels at p% alpha, which is a colour 1-p of the way to black. The
    // first auditor interpolated raw channels and got the second answer, which
    // is why --status-dead-tint could not be expressed as a mix at all.
    const dead = resolveColor('var(--status-dead)', theme);
    const wash = resolveColor('color-mix(in srgb, var(--status-dead) 12%, transparent)', theme);
    for (const i of [0, 1, 2]) expect(wash[i]).toBeCloseTo(dead[i] as number, 6);
    expect(wash[3]).toBeCloseTo(0.12, 6);
  });

  it.each(THEMES)('%s binds --status-dead-tint-solid to the translucent tint it derives from', (_n, theme) => {
    // verify2-css P5. Nothing used to hold the 12% and the base hue together:
    // the three surfaces that needed the pre-composited value wrote the mix
    // out in full, so retuning tokens.css silently diverged from all three.
    const composited = over(resolveColor('var(--status-dead-tint)', theme), resolveColor('var(--bg-surface)', theme));
    expect(resolveColor('var(--status-dead-tint-solid)', theme)).toEqual(composited);
  });

  it('refuses to silently pass a colour it cannot parse', () => {
    expect(() => resolveColor('CanvasText', DARK)).toThrow(/unparsed colour/);
    expect(() => resolveColor('var(--no-such-token)', DARK)).toThrow(/unknown custom property/);
  });

  it('reads BOTH theme blocks out of tokens.css, not a copy of them', () => {
    expect(DARK['--bg-surface']).toBe('#141715');
    expect(LIGHT['--bg-surface']).toBe('#FFFFFF');
    // The light block is an override: values it does not re-declare fall
    // through from :root. --bg-well IS re-declared (deliberately still dark);
    // the syntax palette is not.
    expect(LIGHT['--bg-well']).toBe('#141715');
    expect(LIGHT['--syn-comment']).toBe(DARK['--syn-comment']);
  });

  it.each([
    ['0.72', 0.72],
    ['.72', 0.72],
    ['72%', 0.72],
    ['0.72 !important', 0.72],
    ['72% !important', 0.72],
    ['1', 1],
    ['0', 0],
    ['var(--x)', null],
    ['calc(1 - 0.28)', null],
  ])('reads `opacity: %s` as %s', (raw, want) => {
    expect(opacityNumber(raw as string)).toBe(want);
  });

  it.each([
    // body, prop, the value the BROWSER ends up with
    ['color: var(--a)', 'color', 'var(--a)'],
    ['color: var(--a); color: var(--b)', 'color', 'var(--b)'],
    ['color: var(--a); color: var(--b); color: var(--c)', 'color', 'var(--c)'],
    ['opacity: 1; opacity: 0.72', 'opacity', '0.72'],
    // A longer property name is not a declaration of the shorter one.
    ['background-image: url(x)', 'background', null],
    ['-webkit-background: red', 'background', null],
    ['border-color: red', 'color', null],
    // Property names are ASCII case-insensitive (CSS Syntax 3 §3.1) …
    ['COLOR: var(--a)', 'color', 'var(--a)'],
    ['CoLoR: var(--a); color: var(--b)', 'color', 'var(--b)'],
    ['color: var(--a); COLOR: var(--b)', 'color', 'var(--b)'],
    ['OPACITY: 0.4', 'opacity', '0.4'],
    // … but CUSTOM property names are NOT (CSS Variables 1 §2), so the fold
    // must stop at `--`. Reading `--Callout-Tint` as `--callout-tint` would
    // make the auditor measure a token the browser never resolves.
    ['--Callout-Tint: var(--a)', '--callout-tint', null],
    ['--callout-tint: var(--a)', '--callout-tint', 'var(--a)'],
  ])('declOf(%s, %s) is the LAST declaration: %s', (body, prop, want) => {
    expect(declOf(body as string, prop as string)).toBe(want);
  });

  it.each([
    // `background` and `background-color` write ONE cascaded value, so the
    // answer is source order — neither is the other's fallback.
    ['background: none; background-color: var(--bg-well)', 'var(--bg-well)'],
    ['background-color: var(--bg-well); background: none', 'none'],
    ['background: var(--bg-surface); background: var(--bg-well)', 'var(--bg-well)'],
    ['background-color: var(--a); background-color: var(--b)', 'var(--b)'],
    ['color: red', null],
    ['background-image: url(x); background-position: 0 0', null],
    ['BACKGROUND: var(--bg-well)', 'var(--bg-well)'],
    ['Background-Color: var(--bg-well)', 'var(--bg-well)'],
  ])('bgOf(%s) is %s', (body, want) => {
    expect(bgOf(body as string)).toBe(want);
  });

  it('resolves colour functions however they are cased', () => {
    // `VAR()`, `RGB()`, `COLOR-MIX(IN SRGB, …)` are all functions a browser
    // evaluates; the token name inside stays case-sensitive.
    expect(resolveColor('VAR(--bg-well)', DARK)).toEqual(resolveColor('var(--bg-well)', DARK));
    expect(resolveColor('RGBA(255, 0, 0, 0.5)', DARK)).toEqual([255, 0, 0, 0.5]);
    expect(resolveColor('COLOR-MIX(IN SRGB, #FFFFFF 50%, #000000)', DARK))
      .toEqual(resolveColor('color-mix(in srgb, #FFFFFF 50%, #000000)', DARK));
    expect(() => resolveColor('var(--BG-WELL)', DARK)).toThrow(/unknown custom property/);
  });

  it('finds both theme blocks however the selectors are cased', () => {
    // blockBody used indexOf, so `:ROOT` — a selector browsers match — read as
    // "no :root block" and threw at gate time.
    const tokens = readFileSync(path.join(ROOT, 'src/styles/tokens.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(blockBody(tokens.replace(':root {', ':ROOT {'), ':root')).toBe(blockBody(tokens, ':root'));
  });

  it('exposes exactly the report shape the types promise', () => {
    // The .d.mts beside audit.mjs is hand-written, i.e. a drift risk of the
    // same class as everything else here. This is the runtime check on it.
    expect(Object.keys(report).sort()).toEqual(
      ['counts', 'fades', 'measured', 'problems', 'sheets', 'stale', 'themes', 'troughs', 'uncovered'],
    );
    expect(Object.keys(report.stale).sort()).toEqual(
      ['exempt', 'grounds', 'inherited', 'keyframes', 'opacity'],
    );
    expect(Object.keys(report.counts).sort()).toEqual(
      ['descendant', 'faded', 'inherited', 'keyframes', 'pseudo', 'rules', 'selfGrounded',
        'selfGroundedContexts', 'uncovered'],
    );
  });
});

// ── stylesheet discovery ────────────────────────────────────────────────────
describe('every stylesheet under src/ is audited', () => {
  it('discovers them from disk rather than from a list', () => {
    // verify2-css P3: src/styles/base.css was missing from a hardcoded SHEETS
    // array, which exempted it from BOTH audits while the array looked
    // complete. A list of files is the same drift class as a list of colours.
    expect(report.sheets).toEqual([
      'src/components/primitives.css',
      'src/fleet/fleet.css',
      'src/session/chat.css',
      'src/styles/base.css',
      'src/styles/shell.css',
      'src/styles/tokens.css',
    ]);
  });

  it.each(stylesheets(ROOT))('parses rules out of %s', (rel) => {
    expect(rulesOf(ROOT, rel).length).toBeGreaterThan(0);
  });

  it('finds a non-trivial number of rules and self-grounded pairs', () => {
    // A parser that silently matched nothing would make every case here
    // vacuously green — the exact shape of a fake gate.
    expect(report.counts.rules).toBeGreaterThanOrEqual(400);
    expect(report.counts.selfGrounded).toBeGreaterThanOrEqual(50);
    expect(report.counts.pseudo).toBeGreaterThanOrEqual(3);
    expect(report.measured.length).toBeGreaterThanOrEqual(120);
  });

  it('reports no structural problem', () => {
    expect(report.problems).toEqual([]);
  });

  // ── the census of what the auditor cannot measure ─────────────────────────
  // The through-line of every forge this gate has survived is the same: it
  // measures the shapes someone thought of, and CSS has more shapes than that.
  // So the audit computes its own blind spot instead of describing it, and this
  // is the bind on the description: `uncovered` must be EXACTLY the rules whose
  // ground cannot be recovered from the stylesheets. Re-derived here from the
  // primitives, independently of how audit() partitions them — if a rule that
  // names a painter, or restates a painter's subject, ever lands in the census
  // again (which is what the MAJOR was), this fails.
  describe('the uncovered census', () => {
    const rules = stylesheets(ROOT).flatMap((rel) => rulesOf(ROOT, rel));
    const paints = (r: { body: string }): boolean => paintOf(r.body).paints;
    const painters = rules.filter((r) => declOf(r.body, 'color') !== null && paints(r));

    it('is non-empty and smaller than the set it is drawn from', () => {
      // Vacuity guards in both directions: an empty census would make the
      // assertion below trivially true, and a census equal to every colour rule
      // would mean nothing is measured at all.
      const colourRules = rules.filter((r) => declOf(r.body, 'color') !== null);
      expect(report.uncovered.length).toBeGreaterThan(0);
      expect(report.uncovered.length).toBeLessThan(colourRules.length - 40);
      expect(report.counts.uncovered).toBe(report.uncovered.length);
    });

    it('contains no rule whose ground the selector itself gives away', () => {
      const recoverable = report.uncovered.filter((k) => {
        const rule = rules.find((r) => ruleKey(r) === k);
        if (rule === undefined) return true;
        return painters.some(
          (h) =>
            ruleKey(h) !== k
            && (variantSuffix(rule.selector, h.selector) !== null
              || selectorList(rule.selector).some((s) =>
                compoundChain(s).slice(0, -1).some((anc) =>
                  selectorList(h.selector).some((hs) => subjectCompound(hs) === anc)))),
        );
      });
      expect(recoverable).toEqual([]);
    });

    it('every entry really does set a colour and supply no ground', () => {
      for (const k of report.uncovered) {
        const rule = rules.find((r) => ruleKey(r) === k);
        expect(rule, k).toBeDefined();
        expect(declOf((rule as { body: string }).body, 'color'), k).not.toBeNull();
        expect(paints(rule as { body: string }), k).toBe(false);
      }
    });

    it('the gate prints the count, so the blind spot is in the output', () => {
      expect(out).toMatch(
        new RegExp(`# ${report.counts.uncovered} rules set a colour with no ground this auditor can recover`),
      );
    });
  });

  it('grounds the two rules on the code block bar that nothing measured', () => {
    // The MAJOR's neighbourhood, enumerated rather than fixed one at a time:
    // .code-block-copy and .code-block-lang are the two texts on
    // .code-block-bar, and the bar (--well-bar-bg, 5% ink over the well) is what
    // is behind them — not --bg-well, which the GROUNDS entry used to claim and
    // which flattered every ratio here.
    for (const sel of ['.code-block-copy', '.code-block-lang']) {
      const rows = report.measured.filter((m) => m.label.endsWith(`chat.css ${sel}`));
      expect(rows.map((m) => m.label), sel).toHaveLength(2);
      for (const r of rows) expect(r.ratio, r.label).toBeGreaterThanOrEqual(4.5);
    }
    expect(GROUNDS['chat.css .code-block-copy']?.under).toEqual(['var(--well-bar-bg)']);
    expect(INHERITED_GROUNDS['chat.css .code-block-lang']?.under).toEqual(['var(--well-bar-bg)']);
  });

  it('clears its floor on every pair, in both themes', () => {
    expect(report.measured.filter((m) => !m.ok).map((m) => `${m.label} ${m.ratio.toFixed(2)}`)).toEqual([]);
  });

  const REGISTRIES: readonly (readonly [keyof typeof report.stale, number])[] = [
    ['grounds', Object.keys(GROUNDS).length],
    ['exempt', Object.keys(SELF_GROUNDED_EXEMPT).length],
    ['inherited', Object.keys(INHERITED_GROUNDS).length],
    ['opacity', Object.keys(OPACITY_REGISTRY).length],
    ['keyframes', Object.keys(KEYFRAME_TROUGHS).length],
  ];
  it.each(REGISTRIES)('has no stale %s registry entry, and it is not empty (%i)', (kind, live) => {
    expect(report.stale[kind]).toEqual([]);
    // A registry that has emptied itself would make "no stale entries"
    // vacuously true, which is the fake-gate shape.
    expect(live).toBeGreaterThan(0);
  });

  it('gives a reason for every rule it exempts or hand-grounds', () => {
    // An exemption without a reason is a hole with a comment over it.
    for (const [k, why] of Object.entries(SELF_GROUNDED_EXEMPT)) expect(why.length, k).toBeGreaterThan(20);
    for (const [k, g] of Object.entries({ ...GROUNDS, ...INHERITED_GROUNDS })) {
      expect(g.why.length, k).toBeGreaterThan(20);
      expect(g.under.length, k).toBeGreaterThan(0);
    }
  });
});

// ── nothing outside tokens.css re-types a colour without a bind ─────────────
// final2-gates F6 / verify3-ui-css P7. index.html hand-types --bg-page four
// times and vite.config.ts twice, and nothing held any of them to tokens.css:
// retuning --bg-page left the pre-paint flash, the browser chrome and the
// install splash on the old colour, silently. None of the six can be a var()
// (a <meta> takes no custom property; the pre-paint <style> runs before any
// stylesheet exists; the manifest is JSON), so the answer is a BIND, not a
// deduplication — the same answer this whole file gives everywhere else.
//
// The sweep below is the part that matters: it walks the package and finds
// EVERY hex that equals a tokens.css colour, so a seventh copy in a seventh
// file is a failure rather than a discovery three rounds later. That is the
// same reason design/audit.mjs discovers stylesheets instead of listing them.
describe('every hand-typed copy of a tokens.css colour is bound to it', () => {
  const hexes = (s: string): string[] => (s.match(/#[0-9a-fA-F]{6}\b/g) ?? []).map((h) => h.toUpperCase());
  const tokenHexes = new Set(
    [...Object.values(DARK), ...Object.values(LIGHT)]
      .filter((v) => /^#[0-9a-fA-F]{6}$/.test(v))
      .map((v) => v.toUpperCase()),
  );

  /** Files allowed to contain a hex that equals a token, each with WHY it is
   *  allowed and where the bind that holds it lives. A file not named here is
   *  a failure — that is the point of the sweep. */
  const BOUND: Record<string, string> = {
    'index.html': 'the four pre-paint / theme-color literals — bound by the case below',
    'vite.config.ts': 'the PWA manifest background_color + theme_color — bound by the case below',
    'design/mockup.html': 'a self-contained static mockup that says it carries a verbatim copy of the token block — bound property-by-property by the case below',
    'design/DIRECTION.md': 'the palette table the design doc calls "the map" — bound row-by-row by the case below',
    'design/contrast-check.mjs': 'one hex inside a prose comment explaining why a pair takes attention-TEXT and not the dot hue; no colour is typed into the gate itself (palette() looks every one up by token)',
    'test/contrast.test.ts': 'the hand-computed arithmetic controls this file exists to carry, each already asserted against resolveColor',
    'test/fleet-css.test.ts': 'one hex inside a prose comment about --accent and --status-busy sharing a value',
    'src/session/TerminalDrawer.tsx': 'the xterm 16-colour ANSI palette. The four that matter (background, foreground, cursor, cursorAccent) already come from tokenValue(); the ANSI 16 are a separate table that reuses seven brand hues and adds eight bright variants that are not tokens. Reported, not bound — the file is outside the css lane',
  };

  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git', 'public', 'coverage'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (e.isFile() && /\.(ts|tsx|html|css|mjs|md|json)$/.test(e.name)) out.push(p);
    }
    return out;
  };

  it('finds no copy in a file that is not bound here', () => {
    const found = new Set<string>();
    for (const abs of walk(ROOT)) {
      const rel = path.relative(ROOT, abs).split(path.sep).join('/');
      if (rel === 'src/styles/tokens.css') continue;
      // CSS comments cite measured hexes as prose all over this tree; strip
      // them the way the auditor does, so only DECLARATIONS count.
      const src = readFileSync(abs, 'utf8');
      const body = rel.endsWith('.css') ? src.replace(/\/\*[\s\S]*?\*\//g, '') : src;
      if (hexes(body).some((h) => tokenHexes.has(h))) found.add(rel);
    }
    // Vacuity guard: a sweep that matched nothing would pass this trivially.
    expect(found.size).toBeGreaterThan(4);
    expect([...found].sort().filter((f) => !(f in BOUND))).toEqual([]);
    // …and the other direction: a BOUND entry for a file that no longer
    // re-types anything is a comment pretending to be a gate.
    expect(Object.keys(BOUND).sort().filter((f) => !found.has(f))).toEqual([]);
  });

  it('gives a reason for every file it allows', () => {
    for (const [f, why] of Object.entries(BOUND)) expect(why.length, f).toBeGreaterThan(20);
  });

  it("index.html's four literals are --bg-page in the theme the markup names", () => {
    const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const dark = (DARK['--bg-page'] as string).toUpperCase();
    const light = (LIGHT['--bg-page'] as string).toUpperCase();
    const meta = [...html.matchAll(/<meta name="theme-color"([^>]*)>/g)].map((m) => m[1]);
    expect(meta).toHaveLength(2);
    expect(hexes(meta[0] as string)).toEqual([dark]);
    expect((meta[1] as string).includes('prefers-color-scheme: light')).toBe(true);
    expect(hexes(meta[1] as string)).toEqual([light]);
    const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
    expect(hexes(blockBody(style, 'html {'))).toEqual([dark]);
    expect(hexes(blockBody(style, "html[data-theme='light']"))).toEqual([light]);
    // Nothing else in the file may carry a token colour.
    expect(hexes(html).filter((h) => tokenHexes.has(h))).toEqual([dark, light, dark, light]);
  });

  it("vite.config.ts's manifest colours are the dark --bg-page", () => {
    // The manifest is deliberately dark-only (the app is dark-first; light is an
    // in-app [data-theme] override), so both entries take the DARK value.
    const cfg = readFileSync(path.join(ROOT, 'vite.config.ts'), 'utf8');
    const dark = (DARK['--bg-page'] as string).toUpperCase();
    for (const key of ['background_color', 'theme_color']) {
      const m = new RegExp(`${key}:\\s*'(#[0-9a-fA-F]{6})'`).exec(cfg);
      expect(m?.[1], key).toBeDefined();
      expect((m?.[1] ?? '').toUpperCase(), key).toBe(dark);
    }
  });

  it("design/mockup.html's copied token block still equals tokens.css", () => {
    // The file's own comment says "verbatim copy of src/styles/tokens.css". A
    // verbatim copy that nothing compares is the drift class audit.mjs was
    // written to end; this compares it with the auditor's own primitives.
    const src = readFileSync(path.join(ROOT, 'design/mockup.html'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    let checked = 0;
    for (const [open, theme] of [[':root', DARK], ["[data-theme='light']", LIGHT]] as const) {
      for (const [k, v] of Object.entries(customProps(blockBody(src, open)))) {
        if (theme[k] === undefined) continue;
        expect(v.replace(/\s+/g, ''), `mockup.html ${open} ${k}`)
          .toBe((theme[k] ?? '').replace(/\s+/g, ''));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("design/DIRECTION.md's palette table still equals tokens.css", () => {
    const md = readFileSync(path.join(ROOT, 'design/DIRECTION.md'), 'utf8');
    let checked = 0;
    for (const line of md.split('\n')) {
      const cells = line.split('|').map((c) => c.trim());
      if (cells.length < 6) continue;
      const names = (cells[2]?.match(/`([^`]+)`/g) ?? []).map((s) => s.slice(1, -1));
      const head = names[0];
      if (head === undefined || !head.startsWith('--')) continue;
      // `--status-busy` / `-text` names --status-busy and --status-busy-text.
      const full = names.map((n) => (n.startsWith('--') ? n : `${head}${n}`));
      for (const [cell, theme] of [[cells[3], DARK], [cells[4], LIGHT]] as const) {
        const vals = ((cell ?? '').match(/`([^`]+)`/g) ?? []).map((s) => s.slice(1, -1));
        vals.forEach((v, i) => {
          const name = full[i];
          if (name === undefined || !/^#[0-9a-fA-F]{6}$/.test(v) || theme[name] === undefined) return;
          expect(v.toUpperCase(), `DIRECTION.md ${name}`).toBe((theme[name] ?? '').toUpperCase());
          checked++;
        });
      }
    }
    expect(checked).toBeGreaterThan(40);
  });
});

// ── markdown callouts, the P1 case ──────────────────────────────────────────
describe('every markdown callout variant is measured from the stylesheet', () => {
  const VARIANTS = ['note', 'tip', 'important', 'warning', 'caution'] as const;

  it.each(VARIANTS)("measures the %s callout's body ink on its own tint", (v) => {
    const rows = report.measured.filter(
      (m) => m.label.includes('.msg-assist .callout [as') && m.label.includes(`'${v}'`),
    );
    expect(rows.map((m) => m.label)).toHaveLength(2);
    for (const row of rows) expect(row.ok, `${row.label} ${row.ratio.toFixed(2)}`).toBe(true);
  });

  it.each(VARIANTS)("measures the %s callout's ::before label on its own tint", (v) => {
    const rows = report.measured.filter(
      (m) => m.label.includes('.msg-assist .callout::before [as') && m.label.includes(`'${v}'`),
    );
    expect(rows.map((m) => m.label)).toHaveLength(2);
    for (const row of rows) expect(row.ok, `${row.label} ${row.ratio.toFixed(2)}`).toBe(true);
  });

  it('takes the tints from the stylesheet, not from a list in this file', () => {
    // The bind: every variant's --callout-tint is read off the rule. If a
    // variant is added, the base rule is re-measured through it with no
    // registration anywhere.
    const rules = rulesOf(ROOT, 'src/session/chat.css');
    const variants = rules.filter((r) => /^\.msg-assist \.callout\[data-callout='\w+'\]$/.test(r.selector));
    expect(variants.map((r) => r.selector)).toHaveLength(VARIANTS.length);
    for (const r of variants) {
      expect(declOf(r.body, '--callout-tint'), r.selector).not.toBeNull();
      expect(declOf(r.body, '--callout-hue'), r.selector).not.toBeNull();
    }
  });

  it('measures EVERY rule that rebinds --callout-tint, however it is spelled', () => {
    // verify3-css P1: the assertion above counts only the five single-compound
    // spellings, so a sixth variant written as a grouped selector, with an
    // extra ancestor, or in another stylesheet left it green while walking the
    // blocker straight past the gate. This is the spelling-agnostic bind —
    // every rule anywhere under src/ that rebinds the property the callout
    // paints with must appear as a measured context of the base rule.
    const rebinders = stylesheets(ROOT)
      .flatMap((rel) => rulesOf(ROOT, rel))
      .filter((r) => r.selector !== '.msg-assist .callout' && declOf(r.body, '--callout-tint') !== null);
    expect(rebinders.map(ruleKey)).toHaveLength(VARIANTS.length);
    for (const r of rebinders) {
      const as = r.file === 'chat.css' ? r.selector : ruleKey(r);
      expect(
        report.measured.some((m) => m.label.endsWith(`chat.css .msg-assist .callout [as ${as}]`)),
        `no measured context for ${ruleKey(r)}`,
      ).toBe(true);
    }
  });

  it.each([
    // sel, base, the qualifier it adds (null = not a variant)
    [".msg-assist .callout[data-callout='warning']", ".msg-assist .callout", "[data-callout='warning']"],
    [".msg-assist .callout[data-callout='w'], .msg-assist .callout[data-callout='c']", '.msg-assist .callout', "[data-callout='w']"],
    [".msg-assist .md-body .callout[data-callout='w']", '.msg-assist .callout', "[data-callout='w']"],
    [".msg-assist[data-md] .callout[data-callout='w']", '.msg-assist .callout', "[data-callout='w']"],
    ["main > .callout[data-callout='w']", '.msg-assist .callout', "[data-callout='w']"],
    ['.msg-assist .md-body .callout', '.msg-assist .callout', ''],
    // A variant of a GROUPED base — rulesOf stores `.dot--busy, .dot--attention` whole.
    ['.dot--attention.is-loud', '.dot--busy, .dot--attention', '.is-loud'],
    // Not variants: a different element, a descendant, a pseudo, a prefix that
    // is not a compound boundary.
    ['.msg-assist .callout strong', '.msg-assist .callout', null],
    [".msg-assist .callout[data-callout='w']::before", '.msg-assist .callout', null],
    ['.calloutish', '.callout', null],
    ['.callout-wrap', '.callout', null],
    ['.msg-assist .callout', '.msg-assist .callout', null],
  ])('variantSuffix(%s, %s) is %s', (sel, base, want) => {
    expect(variantSuffix(sel as string, base as string)).toBe(want);
  });

  it('splits selector lists and finds subjects without tripping over nesting', () => {
    expect(selectorList(":is(.a, .b) .c, .d[x~='y, z']")).toEqual([':is(.a, .b) .c', ".d[x~='y, z']"]);
    expect(subjectCompound('.a > .b + .c ~ .d')).toBe('.d');
    expect(subjectCompound(":not(.a, .b) .c[data-x='p q']")).toBe(".c[data-x='p q']");
    // The descendant route walks this chain looking for a named painter.
    expect(compoundChain('.a > .b + .c ~ .d')).toEqual(['.a', '.b', '.c', '.d']);
    expect(compoundChain(":is(.a, .b) .c[data-x='p q']")).toEqual([':is(.a, .b)', ".c[data-x='p q']"]);
  });

  it.each([
    // body, the image paint the auditor must refuse to reduce to a colour
    ['background-image: linear-gradient(#fff, #000)', 'linear-gradient(#fff, #000)'],
    ['background-image: url(a.png)', 'url(a.png)'],
    ['background: repeating-linear-gradient(#fff, #000)', 'repeating-linear-gradient(#fff, #000)'],
    ['BACKGROUND-IMAGE: URL(a.png)', 'URL(a.png)'],
    // …and the shapes that are NOT images
    ['background-image: none', null],
    ['background: var(--bg-well)', null],
    ['color: red', null],
  ])('bgImageOf(%s) is %s', (body, want) => {
    expect(bgImageOf(body as string)).toBe(want as string | null);
  });

  it.each([
    ['background: var(--bg-well)', true],
    ['background-image: url(a.png)', true],
    ['background: none', false],
    ['background-image: none', false],
    ['color: red', false],
  ])('paintOf(%s).paints is %s', (body, want) => {
    // `paints` is the question "does this rule supply a ground of its own".
    // Answering it with bgOf alone is what made an image ground invisible.
    expect(paintOf(body as string).paints).toBe(want);
  });
});

// ── element opacity ─────────────────────────────────────────────────────────
describe('every static opacity is registered and composited', () => {
  it('finds the fades at all', () => {
    expect(report.counts.faded).toBeGreaterThanOrEqual(6);
  });

  it.each(report.fades.map((f) => f.key))('%s is registered with a contrast decision', (k) => {
    expect(Object.keys(OPACITY_REGISTRY)).toContain(k);
  });

  it('records a reason, or pairs, for each — never a bare exemption', () => {
    for (const [k, entry] of Object.entries(OPACITY_REGISTRY)) {
      if ('noText' in entry) expect(entry.noText.length, k).toBeGreaterThan(20);
      else expect(entry.pairs.length, k).toBeGreaterThan(0);
    }
  });

  it('leaves no fade recorded as below its floor', () => {
    // There used to be one: the down-fleet list fade, kept with a
    // "characterisation pin" that named the WRONG worst pair (the .sess-meta
    // middot at 3.34, while the attention lamp dot sat at 2.67 against a 3:1
    // floor) and, by being a knownBelowFloor entry, made the floor test SKIP
    // every other pair of that fade. The fade is gone (fleet.css), so the
    // escape hatch it needed is gone with it: a fade now either composites no
    // coloured content or clears every floor it touches.
    //
    // verify3-css P4: the assertion that used to sit here read
    // `expect(Object.keys(entry).sort()).toEqual(expect.arrayContaining([]))`,
    // which matches literally any key set — including
    // ['knownBelowFloor','whatever'] — while reading like a second guard over
    // the real one below it. Replaced with the shape check it was pretending
    // to be: an entry is EXACTLY one of the two legal shapes, so there is no
    // third key for a hatch to be reintroduced under.
    for (const [k, entry] of Object.entries(OPACITY_REGISTRY)) {
      expect(['pairs', 'noText'], k).toContain(Object.keys(entry).sort().join('+'));
      expect('knownBelowFloor' in entry, k).toBe(false);
    }
  });

  it('the GATE, not just this file, rejects an entry with neither pairs nor noText', () => {
    // The escape hatch survived in the gate binary: `if (!('pairs' in entry))
    // continue;` meant `node design/contrast-check.mjs` — the single auditor
    // this round elevated — printed ALL 232 PASS and exited 0 for a
    // knownBelowFloor entry, and only the suite objected. A gate and a suite
    // that disagree about whether the hatch exists is the hatch.
    const dir = gateTree();
    edit(dir, 'design/audit.mjs', (s) =>
      s.replace(
        "    pairs: [['running tool dot on a card', 'var(--status-busy)', ['var(--bg-surface)'], 3]],",
        "    knownBelowFloor: 'the escape hatch this round claims to have deleted',",
      ));
    const r = runGate(dir);
    expect(r.stdout).toMatch(/OPACITY_REGISTRY chat\.css \.tool-dot--run 0\.8 is \{knownBelowFloor\}/);
    expect(r.stdout).toMatch(/^FAIL/m);
    expect(r.status).not.toBe(0);
  });

  it('archived rows carry no element opacity', () => {
    const rules = rulesOf(ROOT, 'src/fleet/fleet.css').filter((r) => r.selector.includes('.proj-archived-body'));
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.filter((r) => declOf(r.body, 'opacity') !== null).map(ruleKey)).toEqual([]);
  });

  it('the fleet list carries no element opacity when the socket is down', () => {
    // The escalation this round settled: .fleet[data-conn='down'] .fleet-list
    // { opacity: 0.75 } faded live body text to 3.34 and the lamp dots to 2.67
    // in the light theme. FleetScreen's .offline-banner announces the same
    // state in words, at full strength, in exactly the cases the rule fired.
    //
    // verify3-css P5: the round-3 report said of that banner "Nothing tests
    // it" and routed a render assertion to the ui-tsx lane. The claim was
    // false and the referral is WITHDRAWN — both states are already pinned by
    // test/fleet-screen.test.tsx ("shows a persistent offline banner when conn
    // is 'down'…") and test/offline.test.ts ("shows hydrated cards behind a
    // last-known banner while connecting"), and each fails if the banner is
    // removed or re-gated. Measured, not assumed: four mutants on
    // FleetScreen.tsx (either banner deleted; either banner's condition
    // narrowed) each failed exactly one of those two tests.
    const faded = rulesOf(ROOT, 'src/fleet/fleet.css')
      .filter((r) => r.selector.includes("data-conn") && declOf(r.body, 'opacity') !== null);
    expect(faded.map(ruleKey)).toEqual([]);
  });
});

// ── animation troughs ───────────────────────────────────────────────────────
describe('every @keyframes opacity trough is registered', () => {
  it.each(keyframeTroughs(ROOT).map((t) => t.key))('%s appears in KEYFRAME_TROUGHS', (k) => {
    expect(Object.keys(KEYFRAME_TROUGHS)).toContain(k);
  });

  it('includes dot-breathe, which the previous disclosure of this set omitted', () => {
    // The previous round listed the troughs by hand as "working-glyph .35,
    // working-dot .25, tool-breathe .55, task-breathe .55" and shipped that as
    // the complete set. dot-breathe 0.55 — the status lamps, the most visible
    // animation in the app — was missing from it. The set is discovered now.
    expect(report.troughs.map((t) => t.key)).toContain('primitives.css dot-breathe 0.55');
  });

  it('states the reduced-motion steady state for each looping trough', () => {
    for (const [k, why] of Object.entries(KEYFRAME_TROUGHS)) expect(why.length, k).toBeGreaterThan(20);
  });
});

// ── a spot check the maths cannot fake ──────────────────────────────────────
describe('the three well-trap rules the blocker was found in', () => {
  it.each([
    ['chat.css', '.pr-body-preview'],
    ['chat.css', '.dlg-reply-input'],
    ['chat.css', '.msg-attach-gone'],
  ])('%s %s is measured against the well it paints itself on', (file, selector) => {
    const rows = report.measured.filter((m) => m.label.endsWith(`${file} ${selector}`));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.detail).toContain('var(--bg-well)');
      expect(row.ratio).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the light-theme well really is the trap the comments describe', () => {
    // --ink-secondary is tuned for paper and dies on the glass. This is the
    // reported blocker's number, and it is why those three rules take
    // --ink-on-well / --syn-comment instead.
    expect(ratio('var(--ink-secondary)', ['var(--bg-well)'], LIGHT)).toBeCloseTo(2.438, 2);
    expect(contrast(resolveColor('var(--ink-on-well)', LIGHT), resolveColor('var(--bg-well)', LIGHT)))
      .toBeCloseTo(13.978, 2);
  });
});
