// Two markup blocks that render the same tree are a component that has not
// been written yet — and this is the census that will not let a third appear.
//
// WHY A SECOND CENSUS. `shape-census.test.ts` measures STYLESHEET RULES: two
// rules declaring the same thing. It is blind, by construction, to the other
// half of the duplication, and `.pool-row` is the case that proved it. One
// rule in `fleet.css`, correctly shared — and the twenty lines of markup
// around it written out twice, in `PoolSheet.tsx` and `AccountPoolSheet.tsx`.
// The CSS census sees one rule and says nothing. A reader asked why that one
// was skipped, and the honest answer was that no mechanism could see it.
//
// WHAT THIS ONE DOES, in two halves:
//
//  1. BLOCKS. Every JSX element in BOTH packages is reduced to a STRUCTURAL
//     signature — tag name, its static `className` if it has one, and the
//     same of each child element, recursively. Props, text and expressions
//     are dropped: what is left is the SHAPE of the tree. Two elements with
//     the same signature are the same block written twice.
//
//  2. LITERALS. Every static `className` of two words or more, with its words
//     sorted. Two call sites spelling the same utility string are the same
//     decision written twice — which is how `qc-consequence text-base
//     leading-normal text-ink-secondary mb-5` reached SEVEN call sites, one
//     of them inside `@ccrc/ui`'s own `QuickConfirm`, the component the other
//     six were copying.
//
//  3. LEAVES. Every element with NO element children, a hook class, and two
//     or more attributes besides `className` — keyed on tag, class and the
//     sorted attribute NAMES. This half exists because the other two have
//     floors (three elements, two words) and a one-word leaf is under both:
//     `span.acct-pool[aria-label,title]` was written out twice with the same
//     `pool · <name>` used as both accessible name and tooltip, and the spawn
//     and unreadable chips were each written twice across two files, title
//     template included. Three real copies, invisible to this file until it
//     grew this half.
//
// THREE ELEMENTS IS THE FLOOR, MEASURED. At four the census loses
// `div.pool-list(button.pool-row, button.pool-row)`, the trio of `qc-actions`
// confirm rows and the session menu's item — every duplicate a reader would
// actually want named. At two it starts naming a wrapper and its only child:
// `div.auth-block-head(h2.auth-block-title)` is a heading in its box, not a
// shape anybody would extract. Three is the window where a signature means
// "one block, written twice".
//
// STORIES ARE OUT OF SCOPE. A story exists to render the same layout several
// times with different props; its repetition is the point.
//
// WHAT IT IS NOT. Like the shape census, it has no opinion about whether a
// block SHOULD become a component. Several below should not. The registry is
// where that argument is made once, in both directions, instead of being
// rediscovered every wave.
//
// MEASURED, not asserted. Five mutations, each run against the whole file:
//
//   | mutation                                            | result     |
//   |-----------------------------------------------------|------------|
//   | a new 3-element block copied into two app files      | 1 red      |
//   | the `.pool-list` entry deleted from the registry     | 1 red      |
//   | an entry registered for a block that does not exist  | 1 red      |
//   | a two-word className literal copied into two files   | 3 red      |
//   | the file walk returns an empty list                  | 3 red      |
//   | a 3-element block copied twice INSIDE @ccrc/ui       | 1 red      |
//   | one block copied ACROSS the two packages             | 1 red      |
//
// Baseline: 5 passed.
//
// The leaf half was measured the same way, after the three copies it found
// were extracted (`PoolTag`, `LastSpawnChip`, `UnmeasuredChip`):
//
//   | mutation                                            | result     |
//   |-----------------------------------------------------|------------|
//   | PoolTag's span hand-drawn into a second app file    | 1 red      |
//   | the `span.sess-held` entry deleted                  | 1 red      |
//   | an entry for a leaf that does not exist             | 1 red      |
//   | the leaf walk returns an empty map                  | 2 red      |
//   | `LastSpawnChip` hand-drawn back into RunRow         | 1 red      |
//
// Baseline: 7 passed. The last row is why "reads markup at all" exists: a
// census that silently finds nothing reports a serene zero duplicates.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const PKG = path.join(import.meta.dirname, '..', '..');

/** The app's own markup, plus `@ccrc/ui`'s. Unlike the shape census — which
 *  deliberately leaves the package out, because a duplicate inside one package
 *  is that package's own review to catch — the LITERAL half has to read both:
 *  the `qc-consequence` string's seventh copy is in `confirm.tsx`, and a
 *  census that could not see it would have reported six copies of a string
 *  with no owner. */
function tsxFiles(tag: string, root: string): [string, string][] {
  const out: [string, string][] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const p = path.join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.tsx') && !p.endsWith('.stories.tsx')) {
        out.push([`${tag}/${path.relative(root, p)}`, p]);
      }
    }
  };
  walk(root);
  return out;
}

const APP = tsxFiles('pwa', path.join(PKG, 'pwa', 'src'));
const UI = tsxFiles('ui', path.join(PKG, 'ui', 'src'));

const parse = (file: string): ts.SourceFile =>
  ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

type Jsx = ts.JsxElement | ts.JsxSelfClosingElement;

const opening = (n: Jsx): ts.JsxOpeningLikeElement => (ts.isJsxElement(n) ? n.openingElement : n);

/** The static `className`, `{NAME}` for a bare constant, `'*'` for anything
 *  else computed, `''` for none.
 *
 *  THE CONSTANT CASE IS NOT COSMETIC. Naming a copied class string — which is
 *  what the literal half of this census asks for — turns `className="qc-actions
 *  grid gap-2"` into `className={QC_ACTIONS}`. Read as `'*'` that block would
 *  have no literal class anywhere in it, `hooked` would drop it, and the
 *  duplication it still carries would vanish from the census the moment
 *  somebody did the right thing about the string. Measured: the four confirm
 *  rows disappeared on exactly that edit. A bare identifier is as static as a
 *  literal, so it is read as one.
 *
 *  A `cn(...)` call or a template still answers `'*'`: it marks the element
 *  HOOKED — two blocks that both compute one are the same shape as far as the
 *  tree goes — but it can never match a literal, which keeps a call site from
 *  being read as a copy of a string it may not produce. */
function classOf(n: Jsx): string {
  for (const a of opening(n).attributes.properties) {
    if (!ts.isJsxAttribute(a) || a.name.getText() !== 'className') continue;
    const init = a.initializer;
    if (init !== undefined && ts.isStringLiteral(init)) return init.text;
    if (init !== undefined && ts.isJsxExpression(init) && init.expression !== undefined
      && ts.isIdentifier(init.expression)) return `{${init.expression.text}}`;
    return '*';
  }
  return '';
}

/** Child ELEMENTS, however deeply an expression buries them. A `.map()` body,
 *  a ternary's arms and a `&&`'s right side all render children here, and a
 *  census that only read `node.children` would see an empty list wherever the
 *  app renders a list — which is most of the places worth measuring. */
function kids(n: Jsx): Jsx[] {
  if (!ts.isJsxElement(n)) return [];
  const out: Jsx[] = [];
  const visit = (x: ts.Node): void => {
    if (ts.isJsxElement(x) || ts.isJsxSelfClosingElement(x)) { out.push(x); return; }
    x.forEachChild(visit);
  };
  for (const c of n.children) visit(c);
  return out;
}

const sig = (n: Jsx): string => {
  const cls = classOf(n);
  const head = cls === '' ? opening(n).tagName.getText() : `${opening(n).tagName.getText()}.${cls}`;
  const cs = kids(n).map(sig);
  return cs.length === 0 ? head : `${head}(${cs.join(',')})`;
};

const size = (n: Jsx): number => 1 + kids(n).reduce((a, k) => a + size(k), 0);

/** A block with no literal class anywhere in it is structure the stylesheet
 *  never names — a `<div><span/><span/></div>` of pure layout. Two of those
 *  agreeing says nothing: there is no shared decision under them to extract. */
const hooked = (n: Jsx): boolean => (classOf(n) !== '' && classOf(n) !== '*') || kids(n).some(hooked);

const MIN_ELEMENTS = 3;

/** BOTH packages. The block half read `pwa/src` alone until this wave, on the
 *  argument the shape census still makes for stylesheets: a duplicate inside
 *  one package is that package's own review to catch. THIS BRANCH FALSIFIED
 *  THAT. `BareRow` was extracted from eight rules in three stylesheets, two of
 *  them inside `@ccrc/ui` itself, and nobody had seen either until a census
 *  looked — so the package's reviews demonstrably do not catch it.
 *
 *  It finds nothing today (31 component files, 37 blocks of three elements or
 *  more, zero duplicated), and that is the point of a census rather than an
 *  argument against one: it refuses the FIRST duplicate, including one that
 *  spans the two packages. Measured by injecting one. */
function blocks(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const [name, file] of [...APP, ...UI]) {
    const src = parse(file);
    const visit = (n: ts.Node): void => {
      if (ts.isJsxElement(n) && size(n) >= MIN_ELEMENTS && hooked(n)) {
        const line = src.getLineAndCharacterOfPosition(n.getStart()).line + 1;
        const at = `${name}:${line}`;
        const s = sig(n);
        const prev = found.get(s);
        if (prev === undefined) found.set(s, [at]); else prev.push(at);
      }
      n.forEachChild(visit);
    };
    visit(src);
  }
  return found;
}

function literals(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const [name, file] of [...APP, ...UI]) {
    const src = parse(file);
    const visit = (n: ts.Node): void => {
      if (ts.isJsxAttribute(n) && n.name.getText() === 'className') {
        const init = n.initializer;
        let lit: string | null = null;
        if (init !== undefined && ts.isStringLiteral(init)) lit = init.text;
        else if (init !== undefined && ts.isJsxExpression(init) && init.expression !== undefined
          && ts.isNoSubstitutionTemplateLiteral(init.expression)) lit = init.expression.text;
        if (lit !== null) {
          const words = lit.trim().split(/\s+/).filter((w) => w !== '');
          // One word is a hook class, not a decision: `className="pool-row"`
          // at two call sites is the stylesheet being USED, which is the point
          // of a hook class. Two words is the smallest copied composition.
          if (words.length >= 2) {
            const line = src.getLineAndCharacterOfPosition(n.getStart()).line + 1;
            const key = words.slice().sort().join(' ');
            const at = `${name}:${line}`;
            const prev = found.get(key);
            if (prev === undefined) found.set(key, [at]); else prev.push(at);
          }
        }
      }
      n.forEachChild(visit);
    };
    visit(src);
  }
  return found;
}

/** THE THIRD HALF, and the measured reason it exists. The two above have
 *  floors that are right for what they measure and blind in the same place:
 *  the block half starts at THREE elements, the literal half at TWO words. A
 *  LEAF with a one-word hook class is under both — and three real copies lived
 *  there. `span.acct-pool[aria-label,title]` was written out in `AccountRow`
 *  and in `NewSessionSheet`'s project row, same class, same attributes, same
 *  `pool · <name>` text used as both the accessible name and the tooltip.
 *  `span.sess-spawn[data-spawn,title]` and
 *  `span.sess-unmeasured[data-unmeasured,title]` were each written twice
 *  across two files, title template included. None of them was visible to
 *  this file until it grew this half.
 *
 *  A leaf is counted when it has NO element children, a literal or named
 *  class (the block half's `hooked` rule, for its reason), and TWO OR MORE
 *  attributes besides `className`. The attribute floor is what keeps the
 *  stylesheet being USED out of the census: `<span className="pool-row">` at
 *  two call sites is a hook class doing its job, and `.pool-row` is the case
 *  the file header opens with. Two attributes on top of it is a composition —
 *  a title AND a data attribute, an aria-label AND a tooltip — and that is
 *  what drifts when it is written twice.
 *
 *  ATTRIBUTE NAMES, NEVER VALUES: two leaves that differ only in what they
 *  pass are the same decision about what to render, which is the whole
 *  question. Registered entries below say which of those are genuinely two
 *  things. */
function leaves(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const [name, file] of [...APP, ...UI]) {
    const src = parse(file);
    const visit = (n: ts.Node): void => {
      if ((ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) && kids(n).length === 0) {
        const cls = classOf(n);
        if (cls !== '' && cls !== '*') {
          const attrs = opening(n).attributes.properties
            .filter((a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText() !== 'className')
            .map((a) => a.name.getText())
            .sort();
          if (attrs.length >= 2) {
            const key = `${opening(n).tagName.getText()}.${cls}[${attrs.join(',')}]`;
            const line = src.getLineAndCharacterOfPosition(n.getStart()).line + 1;
            const at = `${name}:${line}`;
            const prev = found.get(key);
            if (prev === undefined) found.set(key, [at]); else prev.push(at);
          }
        }
      }
      n.forEachChild(visit);
    };
    visit(src);
  }
  return found;
}

const duplicated = (m: Map<string, string[]>): string[] =>
  [...m.entries()].filter(([, v]) => v.length >= 2).map(([k]) => k).sort();

/** EVERY duplicated block in the app, with the reason it is still two blocks.
 *
 *  An entry is a decision, not an exemption: either these blocks mean
 *  different things, or this is the next extraction and the reason says what
 *  it is waiting on. Checked in both directions — an entry whose block is gone
 *  is stale and reds, because a list of excuses nobody can delete is how a
 *  census rots. */
const REGISTERED_BLOCKS: Record<string, string> = {
  // No NEXT. Every block below is argued, not deferred.
  'div.acct-rows(AccountMeterRow,AccountMeterRow)':
    'DIFFERENT THINGS, and the census found the difference rather than the '
    + 'sameness. Both render the 5h and 7d meters, but `AccountsStrip` guards '
    + 'each on null — its own comment says "only render a window that exists — '
    + 'gpt (Codex Pro) is weekly-only" — while `AccountsScreen` renders both '
    + 'unconditionally and passes `?? null` through. A missing window is '
    + 'therefore ABSENT on the board and EMPTY on the accounts screen. That is '
    + 'a design question for the operator, not something to fold silently: a '
    + 'shared component would have to carry a flag for it, which is the same '
    + 'two behaviours with one more name.',
  'div.acct-list(AccountRow,p.acct-none)':
    'DIFFERENT THINGS. Both sheets list accounts and both say something when '
    + 'the list is empty, but they are answering different questions — '
    + '`NewSessionSheet` offers every lane an operator left on, `SwapSheet` '
    + 'offers the ones a RUNNING session may move to, and each passes '
    + '`AccountRow` a different set of facts. The shared part is `AccountRow`, '
    + 'which they already share.',
  'div.{QC_ACTIONS}(Button,Button)':
    'DIFFERENT THINGS, in the BUTTONS. The container is a copied string and '
    + 'the literal half of this census has it. What sits inside is not one '
    + 'shape: `ArchiveSheet` renders two primaries (archive, and stop-only), '
    + '`UpdateMoveSheet` renders its primary only when there is something to '
    + 'move, and `QuickConfirm` — the component all of them are copying — '
    + 'renders exactly two with no busy state. A component for the pair would '
    + 'take one prop per difference and win nothing.',
};

/** The same, for copied className literals. */
const REGISTERED_LITERALS: Record<string, string> = {
  // ── NEXT ────────────────────────────────────────────────────────────────
  'settings-legend settings-theme-group':
    'DIFFERENT THINGS. Two hook classes on one element, twice, inside the '
    + 'theme picker — a legend that is also a group head. Two classes is not a '
    + 'composition; it is one element wearing both of its names.',
};

/** The same, for copied LEAVES. Five today, and the argument for each is
 *  about the difference the signature cannot see. */
const REGISTERED_LEAVES: Record<string, string> = {
  // No NEXT. Every leaf below is argued, not deferred.
  'Button.sess-sheet-remove[disabled,onClick,title,variant]':
    'DIFFERENT THINGS, and the sheet only ever renders ONE of them: `Clean up '
    + 'workspace…` on an archived workspace, `Forget session…` on a dead '
    + 'non-workspace row — mutually exclusive by construction. What they share '
    + 'is the substrate-fault gate (`disabled`/`title`), which is one '
    + 'expression used twice, and a component taking it as a prop would be the '
    + 'same gate with one more name.',
  'Button.{GO}[disabled,onClick,variant]':
    'THE SHARED DECISION IS ALREADY NAMED. `GO` is the quiet control\'s '
    + 'eleven declarations plus this sheet\'s own three, a constant this file '
    + 'defines and both buttons wear. What differs is everything else: the '
    + 'main Start button is gated on the kickoff verdict, the placement and a '
    + 'collision, and the recovery panel\'s Retry only on its own in-flight '
    + 'flag — and they are never on screen together.',
  'TextInput.{TEXT_INPUT_STACKED}[aria-describedby,aria-invalid,aria-label,onChange,placeholder,value]':
    'TWO FIELDS OF ONE FORM — the program\'s slug and its title. Same '
    + 'attribute set because both are labelled, validated text inputs, which '
    + 'is what a form field is; the values, the labels and the error each one '
    + 'points at are all different, and the shared styling is '
    + '`TEXT_INPUT_STACKED`, a named constant in `@ccrc/ui`.',
  'span.proj-ready[data-verdict,title]':
    'DIFFERENT CLAIMS, in the two arms of one ternary. The first says a '
    + 'readiness measurement is IN FLIGHT (`data-verdict="pending"`, a fixed '
    + 'title and the pending glyph); the second states the verdict it came '
    + 'back with. Folding them would mean a component whose job is to decide '
    + 'which of two sentences to render — which is the ternary.',
  'span.sess-held[data-held,title]':
    'DIFFERENT CONTENT, same chip. The session line renders the hold REASON as '
    + 'the chip\'s text; the archive row renders ` · held` after the slug, '
    + 'with the reason in the title only, because that cell is already the '
    + 'workspace\'s name. One is a word, the other a suffix.',
};

describe('markup census', () => {
  it('registers every duplicated block', () => {
    const dups = duplicated(blocks());
    const missing = dups.filter((d) => REGISTERED_BLOCKS[d] === undefined);
    expect(missing, 'a block rendered twice is a component nobody wrote — register it or extract it').toEqual([]);
  });

  it('keeps no stale block entry', () => {
    const dups = new Set(duplicated(blocks()));
    const stale = Object.keys(REGISTERED_BLOCKS).filter((k) => !dups.has(k));
    expect(stale, 'this block is no longer duplicated — drop the entry').toEqual([]);
  });

  it('registers every copied className literal', () => {
    const dups = duplicated(literals());
    const missing = dups.filter((d) => REGISTERED_LITERALS[d] === undefined);
    expect(missing, 'a class string spelled twice is a constant nobody named').toEqual([]);
  });

  it('keeps no stale literal entry', () => {
    const dups = new Set(duplicated(literals()));
    const stale = Object.keys(REGISTERED_LITERALS).filter((k) => !dups.has(k));
    expect(stale, 'this literal is no longer copied — drop the entry').toEqual([]);
  });

  it('registers every duplicated leaf', () => {
    const dups = duplicated(leaves());
    const missing = dups.filter((d) => REGISTERED_LEAVES[d] === undefined);
    expect(missing, 'a leaf written twice is a chip nobody wrote — register it or extract it').toEqual([]);
  });

  it('keeps no stale leaf entry', () => {
    const dups = new Set(duplicated(leaves()));
    const stale = Object.keys(REGISTERED_LEAVES).filter((k) => !dups.has(k));
    expect(stale, 'this leaf is no longer duplicated — drop the entry').toEqual([]);
  });

  it('reads markup at all', () => {
    // The whole census is a parse away from reporting a serene zero. If the
    // file walk or the TSX parse ever silently finds nothing, every test above
    // passes and the guard is gone.
    expect(APP.length).toBeGreaterThan(40);
    expect(UI.length).toBeGreaterThan(20);
    expect(blocks().size).toBeGreaterThan(100);
    expect(literals().size).toBeGreaterThan(30);
    expect(leaves().size).toBeGreaterThan(40);
  });
});
