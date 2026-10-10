// THE GATE'S OWN REFUSALS, measured IN PROCESS.
//
// `contrast.test.ts` already mutates a copy of the tree and runs the real gate
// as a SUBPROCESS — which is the right instrument for "does the command exit
// non-zero", and the wrong one for the sentences themselves: a subprocess's
// coverage is not this process's, so every refusal arm in `design/audit.mjs`
// read as unexercised (measured: 40 statements and 32 branches uncovered with
// the pwa suite green, the largest single block in the package).
//
// The instrument here is narrower and sharper: `audit(root)` takes the tree to
// read, so only the STYLESHEETS are copied — the auditor itself, and every
// registry inside it, is the REAL module. A registry entry whose rule this copy
// no longer has is therefore a genuinely stale entry, and the sentence it
// produces is the one an operator would read.
//
// WHY THESE SENTENCES EARN A TEST AT ALL. Each is the gate's answer to a
// registry that has drifted from the stylesheets, and a registry that outlives
// its rule is a comment pretending to be a gate. The arms are unreachable from
// the real tree by construction — it passes — so a forged tree is the only way
// to ask whether they still say anything.
import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  INHERITED_GROUNDS, KEYFRAME_TROUGHS, PWA_ROOT, audit, blockBody, customProps, loadThemes,
  ratio, resolveColor, stylesheets, subjectCompound,
} from '../design/audit.mjs';

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A copy of every stylesheet the gate reads, at the same relative paths —
 *  `<tmp>/pwa` beside `<tmp>/ui`, because `stylesheets()` spells the design
 *  system's sheets as `../ui/src/...` and the copy has to reproduce that
 *  sibling layout. `design/*.mjs` is NOT copied: the auditor under test is the
 *  real one. */
function sheetTree(): string {
  const parent = mkdtempSync(path.join(tmpdir(), 'audit-refusal-'));
  made.push(parent);
  const dir = path.join(parent, 'pwa');
  for (const rel of stylesheets(PWA_ROOT)) {
    const dest = path.join(dir, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    cpSync(path.join(PWA_ROOT, rel), dest);
  }
  return dir;
}

/** Rewrite one sheet in the copy, refusing a mutation that changed nothing —
 *  a silently-missed anchor is how a forged tree turns into a vacuous test
 *  (`contrast.test.ts`'s own `edit` makes the same refusal). */
const edit = (dir: string, rel: string, fn: (s: string) => string): void => {
  const p = path.join(dir, rel);
  const before = readFileSync(p, 'utf8');
  const after = fn(before);
  if (after === before) throw new Error(`mutation for ${rel} changed nothing — the anchor moved`);
  writeFileSync(p, after);
};

const problemsOf = (dir: string): string[] => audit(dir).problems as string[];

// The first INHERITED_GROUNDS entry, read from the registry rather than typed
// out: the entry that happens to be first is not the claim — "an entry whose
// rule is gone" is.
const [INHERITED_KEY] = Object.keys(INHERITED_GROUNDS);
const [INHERITED_FILE, INHERITED_SEL] = (INHERITED_KEY ?? '').split(' ');

describe('a clean tree is the control', () => {
  it('the stylesheets alone, audited by the real auditor, raise no problem', () => {
    const r = audit(sheetTree());
    expect(r.problems, 'the forged trees below mean nothing if this one is dirty').toEqual([]);
    expect((r.measured as unknown[]).length,
      'an empty audit would make every refusal below vacuous').toBeGreaterThan(1000);
  });
});

describe('a registry entry whose rule is gone', () => {
  it('names the entry AND the registry — twice, because two checks see it', () => {
    // The route check (section 4) cannot measure what is not there, and the
    // stale sweep at the end says the registry itself has drifted. Both
    // sentences are wanted: the first tells the reader which measurement was
    // lost, the second which registry to edit.
    const dir = sheetTree();
    edit(dir, `src/fleet/${INHERITED_FILE}`, (s) => {
      const at = s.indexOf(`${INHERITED_SEL} {`);
      if (at < 0) throw new Error(`no rule ${INHERITED_SEL} in the copy`);
      const close = s.indexOf('}', at);
      return s.slice(0, at) + s.slice(close + 1);
    });
    const problems = problemsOf(dir);
    expect(problems).toContain(`stale INHERITED_GROUNDS entry: no rule ${INHERITED_KEY}`);
    expect(problems).toContain(
      `stale inherited registry entry: ${INHERITED_KEY} matches no rule in the stylesheets`);
  });

  it('an entry whose rule no longer sets a colour says exactly that', () => {
    // A DIFFERENT condition from "no rule", and the distinction is the whole
    // reason the two sentences exist: the rule is there, so nothing is stale —
    // what is gone is the ink the entry was written to ground. Collapsing the
    // two would send the operator to delete a live registry entry.
    const dir = sheetTree();
    edit(dir, `src/fleet/${INHERITED_FILE}`, (s) => {
      const at = s.indexOf(`${INHERITED_SEL} {`);
      const close = s.indexOf('}', at);
      const body = s.slice(at, close);
      return s.slice(0, at) + body.replace(/\n\s*color:[^;]*;/, '') + s.slice(close);
    });
    const problems = problemsOf(dir);
    expect(problems).toContain(`INHERITED_GROUNDS ${INHERITED_KEY} sets no colour of its own`);
    expect(problems.filter((p) => p.startsWith('stale INHERITED_GROUNDS')),
      'the rule is still there — nothing is stale').toEqual([]);
  });

  it('an entry whose colour resolves to nothing reports the failure per THEME', () => {
    // `ratio` throws for a token no palette defines, and the catch is per
    // theme on purpose: a token that exists in one palette and not the other
    // is a real shape, and one sentence for both would hide which.
    const dir = sheetTree();
    edit(dir, `src/fleet/${INHERITED_FILE}`, (s) => {
      const at = s.indexOf(`${INHERITED_SEL} {`);
      const close = s.indexOf('}', at);
      const body = s.slice(at, close);
      return s.slice(0, at)
        + body.replace(/color:[^;]*;/, 'color: var(--ink-that-no-palette-defines);')
        + s.slice(close);
    });
    const said = problemsOf(dir).filter((p) => p.includes(INHERITED_KEY ?? '!'));
    expect(said.length, 'one sentence per theme, not one for both').toBeGreaterThanOrEqual(2);
    expect(said.every((p) => /ink-that-no-palette-defines/.test(p))).toBe(true);
  });
});

describe('a fade nobody registered', () => {
  it('names the rule, its exact opacity, and what an entry has to carry', () => {
    // The key is `<file> <selector> <value>` — the VALUE is part of it,
    // because the same rule at two opacities composites two different inks.
    const dir = sheetTree();
    edit(dir, 'src/fleet/fleet.css', (s) =>
      `${s}\n.forged-fade-for-the-gate {\n  color: var(--ink);\n  opacity: 0.42;\n}\n`);
    expect(problemsOf(dir)).toContain(
      'unregistered fade fleet.css .forged-fade-for-the-gate 0.42 — add it to OPACITY_REGISTRY'
      + ' with the pairs it composites or a reason it composites no coloured content');
  });

  it('an opacity that is not a static value cannot ship, and is not a fade', () => {
    // A `var()` opacity cannot be composited by a parser, so it is refused
    // rather than registered — and the refusal must come INSTEAD of the
    // unregistered-fade sentence, which would send the operator to write a
    // registry entry for a number nothing can read.
    const dir = sheetTree();
    edit(dir, 'src/fleet/fleet.css', (s) =>
      `${s}\n.forged-dynamic-fade {\n  color: var(--ink);\n  opacity: var(--some-fade);\n}\n`);
    const problems = problemsOf(dir);
    expect(problems).toContain(
      'fleet.css .forged-dynamic-fade: opacity "var(--some-fade)" is not a static value'
      + ' — it cannot be measured, so it cannot ship');
    expect(problems.filter((p) => p.includes('unregistered fade fleet.css .forged-dynamic-fade')),
      'a value nothing can read must not also be reported as an unregistered fade').toEqual([]);
  });

  it('a fully opaque or fully transparent opacity is neither a fade nor a refusal', () => {
    // The two ends of the range composite nothing: `1` is no fade at all and
    // `0` paints nothing. Registering them would be a registry of rules that
    // need no measurement.
    const dir = sheetTree();
    edit(dir, 'src/fleet/fleet.css', (s) =>
      `${s}\n.forged-opaque {\n  color: var(--ink);\n  opacity: 1;\n}\n`
      + `.forged-invisible {\n  color: var(--ink);\n  opacity: 0;\n}\n`);
    expect(problemsOf(dir).filter((p) => /forged-opaque|forged-invisible/.test(p))).toEqual([]);
  });
});

describe('a keyframe trough nobody registered', () => {
  it('names the trough key and what an entry has to carry', () => {
    const dir = sheetTree();
    edit(dir, '../ui/src/styles/theme.css', (s) =>
      `${s}\n@keyframes forged-pulse {\n  0% { opacity: 1; }\n  50% { opacity: 0.3; }\n  100% { opacity: 1; }\n}\n`);
    expect(problemsOf(dir)).toContain(
      'unregistered keyframe trough theme.css forged-pulse 0.3 — add it to KEYFRAME_TROUGHS'
      + ' with the elements it animates and their reduced-motion steady state');
  });

  it('a keyframe stop that is not a static value is refused, not registered', () => {
    const dir = sheetTree();
    edit(dir, '../ui/src/styles/theme.css', (s) =>
      `${s}\n@keyframes forged-dynamic {\n  0% { opacity: 1; }\n  50% { opacity: var(--trough); }\n}\n`);
    expect(problemsOf(dir)).toContain(
      '@keyframes theme.css forged-dynamic has an opacity stop that is not a static value');
  });

  it('a registered trough whose keyframes are gone is reported as stale', () => {
    // The other direction, and the one prose cannot hold: the registry names a
    // trough, the animation has been deleted, and nothing but this sweep
    // notices that the entry is now a comment.
    const [key] = Object.keys(KEYFRAME_TROUGHS);
    const name = (key ?? '').split(' ')[1];
    const dir = sheetTree();
    edit(dir, '../ui/src/styles/theme.css', (s) => {
      const at = s.indexOf(`@keyframes ${name} {`);
      if (at < 0) throw new Error(`no @keyframes ${name} in the copy`);
      // Two closing braces: the stops' and the at-rule's.
      const end = s.indexOf('\n}', s.indexOf('100%', at) >= 0 ? s.indexOf('100%', at) : at);
      return s.slice(0, at) + s.slice(end + 2);
    });
    expect(problemsOf(dir).some((p) => p.startsWith('stale keyframes registry entry:')),
      'a registered trough whose animation is gone passed in silence').toBe(true);
  });
});

// — the PARSER's own refusals —
//
// Every arm above forges a stylesheet; these call the exported helpers
// directly, because what they answer for is the auditor's TRUSTWORTHINESS
// rather than any rule's contrast. The header's standing claim is that an
// unparsed value is a FAIL and never a skip, and a parser that silently
// returned something for a value it could not read would make every PASS in
// the gate's `ALL … PASS` meaningless. None of these arms had a case.
describe('the auditor refuses what it cannot read, rather than guessing', () => {
  it('a missing block and an unbalanced one are two different sentences', () => {
    // `blockBody` is how every palette and every at-rule body is found. A
    // missing block is a stylesheet that does not declare what the auditor
    // was told to read; an unbalanced one is a stylesheet it cannot read AT
    // ALL, and the second is the more dangerous because the text is there.
    expect(() => blockBody(':host { color: red; }', ':root')).toThrow('no :root block');
    expect(() => blockBody(':root { color: red;', ':root')).toThrow('unbalanced braces after :root');
  });

  it('the search is case-insensitive, because a browser matches `:ROOT`', () => {
    expect(blockBody(':ROOT { --ink: #fff; }', ':root')).toContain('--ink');
    // …and the custom-property NAMES inside are not folded, per CSS Variables 1.
    expect(Object.keys(customProps('--Ink: #fff; --ink: #000;'))).toEqual(['--Ink', '--ink']);
  });

  it('a var() that resolves to itself is a cycle, not a hang', () => {
    // Twelve hops, then a sentence. Without the depth bound this is an
    // infinite recursion inside a build gate — a hung CI job with no output,
    // which is strictly worse than a red one.
    expect(() => resolveColor('var(--a)', { '--a': 'var(--b)', '--b': 'var(--a)' }))
      .toThrow(/var\(\) cycle/);
  });

  it('a custom property no palette declares is named, not defaulted', () => {
    expect(() => resolveColor('var(--nothing-declares-this)', {}))
      .toThrow('unknown custom property --nothing-declares-this');
  });

  it('an rgb() with too few channels, or a channel that is not a number, is refused', () => {
    expect(() => resolveColor('rgb(10 20)', {})).toThrow('bad rgb(): rgb(10 20)');
    expect(() => resolveColor('rgb(10 20 blue)', {})).toThrow(/bad rgb\(\)/);
  });

  it('an rgba() alpha is READ, not assumed — and an absent one is 1', () => {
    expect(resolveColor('rgba(255 0 0 / 0.5)', {})).toEqual([255, 0, 0, 0.5]);
    expect(resolveColor('rgb(255 0 0)', {})).toEqual([255, 0, 0, 1]);
  });

  it('a mix of two fully transparent colours is transparent, not a division by zero', () => {
    // The composite is PREMULTIPLIED, so the un-premultiply divides by the
    // result's alpha. Both ends transparent makes that alpha 0, and without
    // this arm every channel comes back NaN — which `contrast` then turns
    // into a ratio of NaN, and `NaN >= floor` is false, so the gate fails
    // with a number nobody can act on.
    expect(resolveColor('color-mix(in srgb, transparent 40%, transparent)', {}))
      .toEqual([0, 0, 0, 0]);
  });

  it('a value in no supported form at all is refused by name', () => {
    expect(() => resolveColor('oklch(0.7 0.1 250)', {})).toThrow(/unparsed colour expression/);
  });

  it('a background chain that does not START opaque is refused', () => {
    // The chain is painted back to front, so its first entry is the thing the
    // page actually paints on. A translucent one means the real ground is
    // somewhere further back and the ratio would be measured against a colour
    // nothing paints.
    expect(() => ratio('#fff', ['rgba(0 0 0 / 0.5)'], {}))
      .toThrow('background chain must start opaque, got rgba(0 0 0 / 0.5)');
  });

  it('a selector with no compound chain is its own subject', () => {
    // `subjectCompound`'s fallback. Reached by a selector `topLevel` splits
    // into nothing — and returning `undefined` there would make `ruleKey`
    // read `undefined` for the element a rule paints.
    expect(subjectCompound('.callout')).toBe('.callout');
    expect(subjectCompound('.msg .md-body .callout[data-x]')).toBe('.callout[data-x]');
    expect(subjectCompound('')).toBe('');
  });
});

describe('a forged rule the auditor cannot ground', () => {
  it('a background-image under text is a FAIL with a remedy, never a skip', () => {
    // The sentence names both legal answers — a reason in SELF_GROUNDED_EXEMPT
    // or a different design — because an image cannot be reduced to one
    // colour and "skip it" was the behaviour that shipped unreadable text
    // over a gradient.
    const dir = sheetTree();
    edit(dir, 'src/fleet/fleet.css', (s) =>
      `${s}\n.forged-gradient-ground {\n  color: var(--ink);\n`
      + '  background-image: linear-gradient(#000, #fff);\n}\n');
    const said = problemsOf(dir).filter((p) => p.includes('.forged-gradient-ground'));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('is a paint that cannot be reduced to a colour');
    expect(said[0], 'a refusal with no remedy is a dead end').toContain('SELF_GROUNDED_EXEMPT');
  });

  it('a translucent background with no GROUNDS entry is named per theme', () => {
    // A translucent ground has no ratio of its own: what is under it decides.
    // So the rule needs a GROUNDS entry naming the chain, and until it has
    // one the honest answer is that the measurement is impossible — once per
    // theme, since a token can be opaque in one palette and not the other.
    const dir = sheetTree();
    edit(dir, 'src/fleet/fleet.css', (s) =>
      `${s}\n.forged-scrim {\n  color: var(--ink);\n  background: rgba(0 0 0 / 0.4);\n}\n`);
    const said = problemsOf(dir).filter((p) => p.includes('.forged-scrim'));
    expect(said.length, 'one sentence per theme').toBeGreaterThanOrEqual(2);
    expect(said.every((p) => p.includes('is translucent and has no GROUNDS entry'))).toBe(true);
  });

  it('an unresolvable ink on a real ground says what to do about it', () => {
    const dir = sheetTree();
    edit(dir, 'src/fleet/fleet.css', (s) =>
      `${s}\n.forged-unknown-ink {\n  color: var(--ink-nothing-declares);\n`
      + '  background: var(--bg-page);\n}\n');
    const said = problemsOf(dir).filter((p) => p.includes('.forged-unknown-ink'));
    expect(said.length).toBeGreaterThanOrEqual(2);
    expect(said.every((p) => /add a GROUNDS entry or an exemption with a reason/.test(p))).toBe(true);
  });
});

// — the palette loader, and the tree walk —
describe('tokens.css is read strictly, because every measurement starts there', () => {
  const tokensRel = '../ui/src/styles/tokens.css';

  it('a tokens.css with no light theme is refused — the two named palettes are a contract', () => {
    // `DARK` and `LIGHT` are named on the result because the token-pair
    // contract and dozens of registry comments speak of them by name. A
    // tokens.css that declares neither would make `LIGHT` undefined and every
    // light-theme measurement silently vanish, which is the one failure mode
    // a contrast gate must not have.
    const dir = sheetTree();
    edit(dir, tokensRel, (s) => s.replaceAll("[data-theme='light']", "[data-theme='daylight']"));
    expect(() => loadThemes(dir)).toThrow('tokens.css declares no light theme');
  });

  it('an unbalanced palette block is refused by NAME', () => {
    // Not "unbalanced braces somewhere": the sentence carries the theme, so
    // the operator opens the right block. A palette whose braces do not close
    // would otherwise merge the rest of the file into it.
    const dir = sheetTree();
    edit(dir, tokensRel, (s) => {
      const at = s.indexOf("[data-theme='nord'] {");
      if (at < 0) throw new Error('no nord palette in the copy');
      const close = s.indexOf('\n}', at);
      return s.slice(0, close) + s.slice(close + 2);
    });
    expect(() => loadThemes(dir)).toThrow("unbalanced braces after [data-theme='nord']");
  });

  it('a palette declared twice is ONE theme whose later block overrides', () => {
    // Eleven palettes in, a block plus a later override of two of its tokens
    // is an ordinary thing to write. Counting it twice would measure the same
    // theme under two labels; taking only the first block would drop the
    // override silently, which is worse.
    const dir = sheetTree();
    edit(dir, tokensRel, (s) =>
      `${s}\n[data-theme='nord'] {\n  --ink-primary: #fefefe;\n}\n`);
    const themes = loadThemes(dir);
    const names = themes.all.map(([n]) => n);
    expect(names.filter((n) => /nord/i.test(n)), 'one palette, two blocks').toHaveLength(1);
    expect(themes.byName.nord?.['--ink-primary']).toBe('#fefefe');
  });

  it('a tree with no @ccrc/ui sibling audits the app sheets alone', () => {
    // The walk reaches OUT of the package for the design system's stylesheets,
    // and `existsSync` is what keeps that from throwing where the sibling is
    // absent — a consumer vendoring only the app's CSS, and every temp tree
    // built from one package.
    const alone = mkdtempSync(path.join(tmpdir(), 'audit-no-ui-'));
    made.push(alone);
    mkdirSync(path.join(alone, 'src'), { recursive: true });
    writeFileSync(path.join(alone, 'src', 'only.css'), '.x { color: #fff; }\n');
    const sheets = stylesheets(alone) as string[];
    expect(sheets).toEqual(['src/only.css']);
    expect(sheets.filter((s) => s.startsWith('../ui')), 'no sibling, no sheets from it').toEqual([]);
  });
});

describe('the last two parser refusals', () => {
  it('a block whose opening token carries no brace at all is refused', () => {
    // `balancedAt` answers null for "no `{` after here" as well as for "the
    // braces never close", and both are the same remedy — but the first is
    // the one a truncated file produces, and it is why the search for the
    // brace is separate from the walk that balances it.
    expect(() => blockBody(':root', ':root')).toThrow('unbalanced braces after :root');
  });

  it('an unbalanced @keyframes is refused by name, not skipped', () => {
    // The trough sweep reads every `@keyframes`, and an at-rule whose braces
    // do not close would swallow the rest of the sheet — so every animation
    // after it would stop being measured, in silence.
    const dir = sheetTree();
    edit(dir, '../ui/src/styles/theme.css', (s) =>
      `${s}\n@keyframes forged-unbalanced {\n  0% { opacity: 1; }\n  50% { opacity: 0.3; }\n`);
    expect(() => audit(dir)).toThrow('unbalanced braces after @keyframes forged-unbalanced');
  });

  it('two rules restating one base the SAME way are measured together, as one context', () => {
    // The cascade applies both, so the element they paint carries the union of
    // their declarations — and the union is a context no single rule
    // describes. An earlier draft merged INSTEAD of keeping the singles, which
    // re-opened three variant spellings; both are kept, and the merged row is
    // labelled with both names so the reader can find either.
    const dir = sheetTree();
    edit(dir, 'src/fleet/fleet.css', (s) =>
      `${s}\n.forged-base { color: var(--ink-primary); background: var(--bg-page); }\n`
      + '.forged-base.is-on { color: var(--ink-secondary); }\n');
    edit(dir, 'src/session/chat.css', (s) =>
      `${s}\n.forged-base.is-on { background: var(--bg-raised); }\n`);
    const labels = (audit(dir).measured as { label: string }[])
      .map((m) => m.label).filter((l) => l.includes('.forged-base'));
    expect(labels.some((l) => l.includes('[as .forged-base.is-on + chat.css .forged-base.is-on]')),
      'the two restatements were never measured as the one element they paint').toBe(true);
    expect(labels.some((l) => l.endsWith('[as .forged-base.is-on]')),
      'the singles must survive the merge').toBe(true);
  });
});

// — the exemption is honoured on EVERY route —
//
// `SELF_GROUNDED_EXEMPT` is the registry of rules whose ground cannot be
// measured and whose reason is written down. The auditor reaches a rule by
// four different routes, and each has to consult the registry itself: a rule
// exempt on the self-grounded route but measured on the descendant route would
// fail the gate for the exact reason it was exempted. None of those four
// checks had a case, because the real tree happens not to reach the exempt
// rules by the other three.
describe('an exempt rule stays exempt however the auditor reaches it', () => {
  it('as a variant, as a descendant, and as a pseudo-element of an exempt host', () => {
    const dir = sheetTree();

    // `.send-btn:disabled` is exempt. Taking its background away makes it a
    // colour-only rule, which is what sends it down the variant and
    // descendant routes — the two that would otherwise measure it against
    // `.send-btn`'s own ground.
    edit(dir, 'src/session/chat.css', (s) =>
      s.replace('.send-btn:disabled {\n  background: var(--edge-subtle);', '.send-btn:disabled {'));

    // A pseudo-element hanging off `.attach-strip`, which is exempt BECAUSE it
    // paints a scrim over a user image. The pseudo's own ground is that
    // image, so measuring it would measure the scrim against a colour nothing
    // paints — and the control below is the same pseudo on a host that is NOT
    // exempt, which must still be measured.
    edit(dir, '../ui/src/components/attach-tray.css', (s) =>
      `${s}\n.attach-strip::after { color: var(--ink-primary); }\n`);
    edit(dir, 'src/fleet/fleet.css', (s) =>
      `${s}\n.forged-plain-host { color: var(--ink-primary); background: var(--bg-page); }\n`
      + '.forged-plain-host::after { color: var(--ink-secondary); }\n');

    // And the third exempt key, `.chat-head .keycap:disabled`, is a pseudo
    // whose HOST the real tree does not paint — so the route stops before the
    // registry is consulted at all. Giving the host a ground is what carries
    // the rule to the check.
    edit(dir, 'src/session/chat.css', (s) =>
      `${s}\n.chat-head .keycap { color: var(--ink-primary); background: var(--bg-surface); }\n`);

    const r = audit(dir);
    const labels = (r.measured as { label: string }[]).map((m) => m.label);

    expect(labels.filter((l) => l.includes('.chat-head .keycap:disabled')),
      'the exempt pseudo was measured once its host had a ground').toEqual([]);
    expect(labels.filter((l) => l.includes('.send-btn:disabled')),
      'an exempt rule was measured once its ground went away').toEqual([]);
    expect(labels.filter((l) => l.includes('.attach-strip::after')),
      "a pseudo-element was measured against its exempt host's unmeasurable ground").toEqual([]);
    expect(r.problems, 'an exemption that is honoured raises nothing').toEqual([]);

    // THE CONTROL, and without it every assertion above would pass on an
    // auditor that measured no pseudo-elements at all.
    expect(labels.some((l) => l.includes('.forged-plain-host::after')),
      'the pseudo route is dead, so the three silences above prove nothing').toBe(true);
  });
});
