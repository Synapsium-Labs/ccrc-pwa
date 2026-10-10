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
//  1. BLOCKS. Every JSX element in the app is reduced to a STRUCTURAL
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
//
// Baseline: 5 passed. The last row is why "reads markup at all" exists: a
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

/** The static `className`, `'*'` for a computed one, `''` for none. A computed
 *  className still marks the element as HOOKED — two blocks that both compute
 *  one are the same shape as far as the tree goes — but it can never match a
 *  literal, which keeps `cn(...)` call sites from being read as copies of a
 *  string they may not produce. */
function classOf(n: Jsx): string {
  for (const a of opening(n).attributes.properties) {
    if (!ts.isJsxAttribute(a) || a.name.getText() !== 'className') continue;
    const init = a.initializer;
    if (init !== undefined && ts.isStringLiteral(init)) return init.text;
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

function blocks(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const [name, file] of APP) {
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
  // ── NEXT: one block, written twice, and nothing stopping the extraction ──
  'ListRow.menu-item(span.menu-label,span.menu-hint)':
    'NEXT. The session menu row — a `ListRow` with a label and a dimmed hint '
    + 'naming the slash command behind it. Four copies, all in SessionHeader.tsx.',
  'div.acct-rows(AccountMeterRow,AccountMeterRow)':
    'NEXT. The 5h/7d meter pair. Two call sites that must agree on WHICH '
    + 'windows an account has — `AccountsStrip` guards each on null, '
    + '`AccountsScreen` renders both and passes null through.',
  'div.dlg-actions(Button,button.dlg-later)':
    'NEXT. "Open terminal to answer" beside "Not now", twice in DialogSheet.tsx '
    + '— the same two doors out of a question this app cannot render.',
  'div.pool-list(button.pool-row,button.pool-row)':
    'NEXT. The pool picker: every roster pool, then "no pool". `PoolSheet` and '
    + '`AccountPoolSheet` write it out identically. THIS IS THE BLOCK THAT '
    + 'ARGUED FOR THIS FILE — one `.pool-row` rule, correctly shared, and the '
    + 'markup around it copied where the stylesheet census could never look.',
  ['fieldset.settings-fieldset(legend.settings-legend,'
    + 'label.settings-option(input,span.settings-option-sentence))']:
    'NEXT. A radio group: legend, then one labelled radio per mode. Three '
    + 'copies in SettingsScreen.tsx — notifications, channel, auto-install.',
  'label.settings-option(input,span.settings-option-sentence)':
    'NEXT, inside the fieldset above: the labelled radio itself. It is listed '
    + 'separately because the census measures every element, and folding the '
    + 'fieldset folds this with it.',
  'label.route-field(span.route-field-label,select.route-select(option,option,option))':
    'NEXT. A labelled select. Three in NewSessionSheet.tsx — class, effort, '
    + 'workflows — of which the census pairs two: the third renders a '
    + 'different NUMBER of literal options, and an exact structural match '
    + 'cannot see past that. Documented rather than tuned, for the reason the '
    + 'shape census documents its own 0.72 window.',
  'select.route-select(option,option,option)':
    'NEXT, inside the field above.',
  ['ul.child-reclaim-attention(li.child-reclaim-item('
    + 'span.child-reclaim-who,span.child-reclaim-sentence))']:
    'NEXT. `ExpiryAttention` and `DeadCoordinatorAttention` are twenty-two '
    + 'line files that differ in three expressions: the words helper, the key, '
    + 'and the aria-label. The cleanup row renders both, one under the other.',
  'li.child-reclaim-item(span.child-reclaim-who,span.child-reclaim-sentence)':
    'NEXT, the line inside that list — which `ChildReclaimBanner` writes a '
    + 'third time for its own lane.',
  'span.settings-theme-body(span.settings-theme-name,span.settings-note)':
    'NEXT. A name over its note, in the theme picker: once in the per-palette '
    + 'row and once inline for "Follow system", which is not a palette and so '
    + 'did not reach for the component the others use.',

  // ── DIFFERENT THINGS: these blocks agree and will keep agreeing ──────────
  'div.acct-list(AccountRow,p.acct-none)':
    'DIFFERENT THINGS. Both sheets list accounts and both say something when '
    + 'the list is empty, but they are answering different questions — '
    + '`NewSessionSheet` offers every lane an operator left on, `SwapSheet` '
    + 'offers the ones a RUNNING session may move to, and each passes '
    + '`AccountRow` a different set of facts. The shared part is `AccountRow`, '
    + 'which they already share.',
  'div.qc-actions grid gap-2(Button,Button)':
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
  'duration-fast ease-swift mb-2 motion-reduce:transition-none transition-[border-color]':
    'NEXT. A `TextInput` modifier — a bottom margin and a border-colour '
    + 'transition — spelled at four call sites across two sheets. It is not in '
    + '`TEXT_INPUT` because the app\'s other inputs do not animate, so moving '
    + 'it into the base would change them; it wants the name '
    + '`TEXT_INPUT_INLINE` already has next to it.',
  'gap-2 grid qc-actions':
    'NEXT. The confirm row\'s container, FIVE call sites, one of them inside '
    + '`QuickConfirm` itself — the four in the app are copies of the design '
    + 'system\'s own composition, hook class and utilities together.',
  'leading-normal mb-5 qc-consequence text-base text-ink-secondary':
    'NEXT. The consequence sentence above that row: SEVEN call sites, same '
    + 'story. `ArchiveSheet` writes the hook alone with no utilities at all, '
    + 'and its sentences are therefore NOT this shape — that sheet leans on '
    + '`.abandon-sheet`\'s own grid gap, which is a real difference in '
    + 'rendering and is preserved, not folded.',

  // ── DIFFERENT THINGS ────────────────────────────────────────────────────
  'settings-legend settings-theme-group':
    'DIFFERENT THINGS. Two hook classes on one element, twice, inside the '
    + 'theme picker — a legend that is also a group head. Two classes is not a '
    + 'composition; it is one element wearing both of its names.',
  'settings-option settings-theme':
    'DIFFERENT THINGS, the same way: the palette row is a settings option AND '
    + 'a theme swatch, and both stylesheets name it.',
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

  it('reads markup at all', () => {
    // The whole census is a parse away from reporting a serene zero. If the
    // file walk or the TSX parse ever silently finds nothing, every test above
    // passes and the guard is gone.
    expect(APP.length).toBeGreaterThan(40);
    expect(UI.length).toBeGreaterThan(20);
    expect(blocks().size).toBeGreaterThan(100);
    expect(literals().size).toBeGreaterThan(30);
  });
});
