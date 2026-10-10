// Two app rules that say the same thing are a component that has not been
// written yet — and this is the census that will not let a third appear.
//
// WHY THIS EXISTS. Every design-system wave so far found its duplicates by
// READING: `.accounts-door`/`.settings-door` byte-identical, `.btn-primary`
// written out at 54 call sites, three copies of ten declarations behind
// `TextInput`, five copies of eleven behind the quiet control. Each was found
// by a person noticing, and the stylesheet usually said so itself in a comment
// — "Same self-grounded pair as `.coord-toggle` … not reinvented" — which is a
// request that the next copy also be a copy, not a mechanism that stops one.
//
// The fifth copy of the quiet control proved the point. `.program-start-go`
// carried the same eleven declarations in the same file as the four being
// folded, and nobody had connected it to them; a census written for the four
// came back red naming it. That is the whole argument for this file: the
// reading does not scale, and the stylesheet is 5.3k lines.
//
// WHAT IT DOES. It clusters every app rule of four declarations or more by
// what it DECLARES — property and value, normalised and sorted — and calls two
// rules the same shape when they agree on 72% of their declarations. Every
// cluster it finds must be REGISTERED below with a reason, or this reds. The
// registry is checked in both directions, so an entry whose cluster has been
// migrated away is stale and reds too: a list of excuses nobody can delete is
// how a census rots.
//
// 72% IS MEASURED, NOT CHOSEN. At 0.80 the four quiet-control rules still
// cluster but `.program-start-door` (one font size apart) splits off, which is
// precisely the copy a reader would miss. At 0.65 it starts pairing rules that
// merely share a flex idiom — `.chat-meta` with `.update-banner-actions` — and
// the registry fills with noise that teaches nobody anything. 0.72 is the
// window where a cluster means "one shape, written twice".
//
// WHAT IT IS NOT. It is not a style linter and it has no opinion about
// whether a cluster SHOULD be a component. Several below should not be: two
// rules can share declarations and mean different things, and the registry is
// where that gets argued once instead of rediscovered every wave. What it
// refuses is the silent third copy.
//
// THE FOUR CENSUSES, and what each one is blind to — written here so the next
// reader does not rediscover a hole by hitting it:
//
//   * `shape-census` (this file): stylesheet RULES in both packages,
//     clustered by what they declare. Blind to anything not in a stylesheet.
//   * `markup-census`: JSX trees of three elements or more, `className=`
//     literals of two words or more, and LEAVES with two attributes beyond
//     the class. Blind to a class string that lives in a constant.
//   * `control-census`: every hand-drawn interactive element, and how each
//     one reaches a thumb.
//   * `literal-census`: every string of 25+ characters written in two files —
//     a sentence in a `Record`, a `title=`, a `console.warn`. Blind to
//     nothing structural, because it reads no structure at all.
//
// Each exists because the one before it was measured blind to a real copy.
// THIS WAVE'S MEASUREMENTS, since both halves changed:
//
//   | mutation                                            | result     |
//   |-----------------------------------------------------|------------|
//   | a `@ccrc/ui` sheet dropped from the walk            | 1 red      |
//   | a fifth eyebrow planted in @ccrc/ui                 | 1 red (*)  |
//   | a fifth eyebrow planted in the app                  | 1 red      |
//   | the `.mail-strip + .task-strip` entry deleted       | 1 red      |
//
// (*) by the SIGNATURE half, not by clustering — a single new copy has no
// partner to pair with, which is exactly what that half exists for, and it
// is how this table was found to be worth running at all: the clustering
// alone stayed green.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ATTENTION_DOT, BARE_ROW, CONTROL_ROW, CONTROL_ROW_NOTE, COUNT_BADGE, COVER_SCREEN,
  EYEBROW, KEYCAP, LIST_ROW, MONO_PATH, RESET_LIST, TEXT_INPUT, TEXT_INPUT_INLINE,
  buttonVariants,
} from '@ccrc/ui';

const read = (...seg: string[]): string =>
  readFileSync(path.join(import.meta.dirname, '..', 'src', ...seg), 'utf8');

/** BOTH PACKAGES' stylesheets. `@ccrc/ui`'s were deliberately out of scope
 *  until this wave, on the argument that a duplicate THERE is a duplicate
 *  inside one package, which its own reviews see.
 *
 *  THAT ARGUMENT IS FALSIFIED, by the same measurement that falsified it for
 *  the markup census one file over. The EYEBROW — mono, 2xs, medium,
 *  uppercase, tracked out — was declared SEVEN times: three app rules, three
 *  `@ccrc/ui` rules and once inline in `sheet.tsx`'s own class string. Four
 *  of the seven were invisible here, because two of them are in this package
 *  and the pairs they would have clustered with were too. Nobody's review
 *  caught them in six waves of this branch; a census reading one package
 *  could not.
 *
 *  The two kinds of finding are both worth having and are NOT the same kind:
 *  a cluster spanning the packages says the app re-invented the design
 *  system, and a cluster inside `@ccrc/ui` says the design system has two
 *  names for one shape. Both are registered below, each with its own
 *  argument. */
const uiRead = (...seg: string[]): string =>
  readFileSync(path.join(import.meta.dirname, '..', '..', 'ui', 'src', ...seg), 'utf8');

const SHEETS: [string, string][] = [
  ['fleet.css', read('fleet', 'fleet.css')],
  ['chat.css', read('session', 'chat.css')],
  ['shell.css', read('styles', 'shell.css')],
  ['base.css', read('styles', 'base.css')],
  ['ui/mail-card.css', uiRead('components', 'mail-card.css')],
  ['ui/mail-strip.css', uiRead('components', 'mail-strip.css')],
  ['ui/prose.css', uiRead('components', 'prose.css')],
  ['ui/task-card.css', uiRead('components', 'task-card.css')],
  ['ui/task-strip.css', uiRead('components', 'task-strip.css')],
  ['ui/tool-card.css', uiRead('components', 'tool-card.css')],
  ['ui/attach-button.css', uiRead('components', 'attach-button.css')],
  ['ui/attach-tray.css', uiRead('components', 'attach-tray.css')],
  ['ui/build-line.css', uiRead('components', 'build-line.css')],
  ['ui/typed-label.css', uiRead('components', 'typed-label.css')],
  ['ui/option-row.css', uiRead('primitives', 'option-row.css')],
  ['ui/reset.css', uiRead('styles', 'reset.css')],
];

interface Rule { sheet: string; sel: string; decls: string[] }

/** Top-level rules only, comments stripped. A nested at-rule's body is skipped
 *  by construction: this matches `selector { … }` with no braces inside, so a
 *  `@media` wrapper never becomes a "rule" and its children are matched on
 *  their own — which is what we want, since a media query's override is a
 *  fragment, not a shape. */
function rules(): Rule[] {
  const out: Rule[] = [];
  for (const [sheet, src] of SHEETS) {
    const clean = src.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of clean.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
      const sel = (m[1] ?? '').trim().replace(/\s+/g, ' ');
      if (sel === '' || sel.startsWith('@')) continue;
      const decls = (m[2] ?? '')
        .split(';')
        .map((d) => d.trim().replace(/\s+/g, ' '))
        .filter((d) => d !== '')
        .sort();
      // Four is the floor. Below it a "shape" is a couple of declarations that
      // any two rules might share by accident — `display: flex; gap: …` is an
      // idiom, not a component.
      if (decls.length >= 4) out.push({ sheet, sel, decls });
    }
  }
  return out.sort((a, b) => (a.sheet + a.sel < b.sheet + b.sel ? -1 : 1));
}

const SAME = 0.72;

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  let both = 0;
  for (const x of A) if (B.has(x)) both += 1;
  return both / (A.size + B.size - both);
}

/** Greedy clustering against a seed, in a stable order — the first rule in
 *  sheet/selector order seeds, and everything close to IT joins. Not
 *  transitive on purpose: A-B close and B-C close does not make A-C one
 *  shape, and a transitive walk would chain unrelated rules into one giant
 *  cluster the moment a bridging rule appeared. */
function clusters(): Rule[][] {
  const all = rules();
  const taken = new Set<number>();
  const out: Rule[][] = [];
  for (let i = 0; i < all.length; i += 1) {
    if (taken.has(i)) continue;
    const seed = all[i];
    if (seed === undefined) continue;
    const group = [seed];
    taken.add(i);
    for (let j = i + 1; j < all.length; j += 1) {
      const other = all[j];
      if (taken.has(j) || other === undefined) continue;
      if (jaccard(seed.decls, other.decls) >= SAME) {
        group.push(other);
        taken.add(j);
      }
    }
    if (group.length >= 2) out.push(group);
  }
  return out;
}

/** A cluster's identity: its members, named. Stable across edits that do not
 *  change WHICH rules are the same shape — so tuning a value inside one of
 *  them does not churn this file. */
const keyOf = (g: Rule[]): string =>
  g.map((r) => `${r.sheet} ${r.sel}`).sort().join(' + ');

/** EVERY duplicated shape in the app, with the reason it is still two rules.
 *
 *  An entry here is a decision, not an exemption: either these rules mean
 *  different things and always will, or this is the next migration and the
 *  reason says what is blocking it. Adding a line is cheap and that is fine —
 *  what it is not is silent. */
const REGISTERED: Record<string, string> = {
  // ── NEXT: one shape, written twice, and nothing stopping the fold ───────
  // Empty, and it was eight entries deep until this wave. Every app-internal
  // cluster whose rules lived in ONE sheet is now ONE GROUPED RULE: the three
  // empty-state paragraphs, the card idiom under .accounts-row, the two
  // "not on this card" blocks, the three wrapping action rows, the four inline
  // meta slots on a run row, the third sheet body, the two type-ramp sentences
  // in chat.css, the two inline meta lines on the project card, and the six
  // truncating mono cells of the session line. A grouped selector is what this
  // repo already reached for when `.abandon-sheet, .archive-conflict-sheet`
  // needed its descendant measured ONCE instead of twice, and it is what the
  // registry's own `why:` lines kept arguing for while the rules stayed apart.
  //
  // What is left below is not debt. Each one either spans two sheets (which a
  // grouped selector cannot reach, and which the gate's key format no longer
  // blocks — see design/audit.mjs's `ruleKey`) or has a reason of its own.

  // ── DIFFERENT THINGS: these rules agree and will keep agreeing ──────────
  ['chat.css .chat-meta + fleet.css .settings-release-actions, .settings-node-actions, '
    + '.update-banner-actions']:
    'DIFFERENT THINGS. Five declarations — flex, centred, wrapping, one gap '
    + 'token, one row-gap — which is the most common five in the tree. This is '
    + 'a utility that these elements write as a rule because they already have '
    + 'classes for other reasons. '
    + 'AND IT IS THE LINE AGAINST `RESET_LIST`, which went the other way in '
    + 'the same wave: that one is a SEMANTIC reset — a `<ul>` that must not '
    + 'look like a list, a decision about what the element IS — while this is '
    + 'layout glue that means nothing beyond itself. A constant for every '
    + 'common quadruple of utilities is a second spelling of Tailwind, and '
    + 'the registry would stop being able to tell the two apart.',
  'chat.css .compaction--sys .compaction-label + fleet.css .sess-subagent-name':
    'DIFFERENT THINGS. Four declarations that spell `truncate`: min-width 0, '
    + 'hidden, ellipsis, nowrap. A component here would be a `<span>` with a '
    + 'utility on it.',
  ['fleet.css .child-reclaim-banner .child-reclaim-item + fleet.css .settings-node-head '
    + '+ fleet.css .settings-release-head']:
    'DIFFERENT THINGS. Four declarations of wrapping flex with a min-width '
    + 'floor — the same idiom as the actions rows above, in a different part '
    + 'of the tree.',
  'fleet.css .proj-dir + fleet.css .sheet-panel .proj-ready-why':
    'DIFFERENT THINGS, and measurably so: DIFFERENT GROUNDS. '
    + 'Both sit in column 2 of a grid in mono `--fs-2xs`, and the overlap is '
    + 'that grid and that ramp — but one sits on the project card '
    + '(--bg-surface) and the other on a sheet (--bg-sheet), and '
    + "INHERITED_GROUNDS keys ONE ground per rule. Grouped, half the rule "
    + 'would be measured against a ground it never sits on: a false PASS in '
    + 'place of a duplicate, which is the worse of the two.',
  // ── Both packages, since this wave. Seven of the eight below are inside
  // `@ccrc/ui` or span it, and none was visible to this file before.
  'chat.css .compaction + ui/tool-card.css .toolcard':
    'GROUND, NOT CHROME. The same card shell, and it cannot move. Four declarations, identical: '
    + 'surface, hairline, --r-md, overflow hidden. What makes it immovable is '
    + 'the `background`: both rules are SELF-GROUNDED, which is what lets the '
    + 'contrast gate measure their descendants through route 2b, and a ground '
    + 'that moved into a utility string would take the route with it. Strip '
    + 'the ground and three declarations are left, under this census\'s own '
    + 'floor. The shape moves, the ground stays — so here the shape is the '
    + 'ground, and it stays.',
  'ui/mail-card.css .mail-card .mail-card-kind + ui/mail-strip.css .mail-strip .mail-strip-kind':
    'GROUND, NOT CHROME. One label on two surfaces — the mail kind word, on the card and on the '
    + 'strip row. It is the EYEBROW at `--weight-regular` rather than medium, '
    + 'which is why it is not that constant; its tracking is now '
    + '`--ls-caps-sm`, the token this wave named after finding the literal '
    + 'seven times. Two rules remain because each is scoped to its own '
    + 'self-grounded host (`.mail-card` / `.mail-strip`), which is how the '
    + 'gate measures them; one shared rule would have no host at all.',
  'ui/mail-strip.css .mail-strip .mail-strip-abandoned + ui/mail-strip.css .mail-strip .mail-strip-blocked':
    'DIFFERENT THINGS. Two marks of one shape saying opposite things: `blocked` is a mail '
    + 'the operator must act on, `abandoned` is one nobody will. They differ '
    + 'only in ink today, and folding them would mean one rule plus a data '
    + 'attribute — the same two states with one more name, and a gate entry '
    + 'for each either way.',
  'ui/mail-strip.css .mail-strip + ui/task-strip.css .task-strip':
    'SHAPE ALREADY MIGRATED. The strip skin, and the ruling that leaves it twinned is already made '
    + 'and already written down: `CollapsibleStrip`\'s own header says it '
    + 'owns the SHAPE and not the SKIN, because hoisting the base rules into '
    + 'one sheet rekeys every contrast-gate entry naming the old one '
    + '(`<basename> <selector>`), and the skins are not in fact identical — '
    + '`.mail-strip` sets `color` to make itself self-grounded for route 1 '
    + 'and `.task-strip` does not. This cluster is that decision, measured.',
  'ui/mail-strip.css .mail-strip .mail-strip-summary + ui/task-strip.css .task-summary':
    'SHAPE ALREADY MIGRATED. The same ruling as the strip root above: the shape is '
    + '`CollapsibleStrip`\'s `summary` slot, which both already go through. '
    + 'What clusters is the skin each strip keeps on purpose.',
  'ui/mail-strip.css .mail-strip-count + ui/task-strip.css .task-count':
    'SHAPE ALREADY MIGRATED. The same ruling — `CollapsibleStrip`\'s `count` slot. Byte-identical '
    + 'skins, in two sheets whose keys the gate holds.',
  'ui/mail-strip.css .mail-strip-headline + ui/task-strip.css .task-headline':
    'SHAPE ALREADY MIGRATED. The same ruling — `CollapsibleStrip`\'s `headline` slot.',
  'ui/mail-strip.css .mail-strip-rows + ui/task-strip.css .task-rows':
    'SHAPE ALREADY MIGRATED. The same ruling — the rows region `CollapsibleStrip` renders only while '
    + 'open.',
};

describe('every duplicated shape in the app stylesheets is registered', () => {
  const found = clusters();

  it('found clusters to judge — the census is not vacuously empty', () => {
    // Without this it passes by finding nothing, which is how a census dies:
    // a parser change stops matching rules and the guard goes quiet rather
    // than red. Measured 14 clusters over 5,459 lines of app CSS today.
    expect(found.length).toBeGreaterThanOrEqual(10);
    expect(found.flat().length).toBeGreaterThanOrEqual(25);
  });

  it('names no shape this registry has not seen', () => {
    const unregistered = found.map(keyOf).filter((k) => REGISTERED[k] === undefined);
    expect(unregistered).toEqual([]);
  });

  it('carries no stale entry — a migrated shape leaves this file', () => {
    const live = new Set(found.map(keyOf));
    expect(Object.keys(REGISTERED).filter((k) => !live.has(k))).toEqual([]);
  });

  it('gives every entry a reason that says which kind it is', () => {
    // FOUR VERDICTS AND NO FIFTH. Two are the original pair: this is the next
    // migration, or these rules mean different things. "Leave it for now" is
    // still not a verdict.
    //
    // The other two arrived with `@ccrc/ui`'s sheets, and neither could exist
    // while this census read one package. `SHAPE ALREADY MIGRATED` is a
    // cluster whose shape IS a component already — `CollapsibleStrip` owns
    // the strip, and its own header argues why the three skins stay in three
    // sheets. `GROUND, NOT CHROME` is a cluster held together by the thing
    // that may not move: a `background` makes a rule self-grounded, which is
    // how the contrast gate reaches its descendants, so hoisting it would
    // take the measurement with it and leave three declarations behind.
    const VERDICTS = ['NEXT', 'DIFFERENT THINGS', 'SHAPE ALREADY MIGRATED', 'GROUND, NOT CHROME'];
    for (const [k, why] of Object.entries(REGISTERED)) {
      expect(VERDICTS.some((v) => why.startsWith(v)), k).toBe(true);
      expect(why.length, k).toBeGreaterThan(60);
    }
  });
});


// ── THE OTHER DIRECTION ──────────────────────────────────────────────────
//
// Clustering finds a shape written TWICE. It cannot find a shape written once
// — and a rule that re-implements a component that has already migrated is
// exactly that: a singleton, with no partner left in any stylesheet to pair
// with. Measured, and it is not hypothetical: a `.new-row` carrying all twelve
// of `<ListRow>`'s declarations was injected into chat.css and the census
// above stayed GREEN, because the two rules it would have matched are gone.
//
// So each migrated shape leaves a SIGNATURE behind: the handful of
// declarations that, together, mean "this is that component again". Any app
// rule carrying all of them must be a registered carrier or this reds. The
// signature is deliberately short — four or five declarations, not twelve — so
// that a near-copy is caught too, which is the one the fifth quiet control
// taught this project to look for.
const MIGRATED: Record<string, string[]> = {
  '<Button variant="quiet">': [
    'background: var(--bg-raised)',
    'border: 1px solid var(--edge-subtle)',
    'color: var(--ink-secondary)',
    'var(--family-mono)',
  ],
  '<ControlRow>': [
    'flex-wrap: wrap',
    'min-height: var(--tap-min)',
    'padding: var(--sp-1) var(--sp-3)',
    'border-radius: var(--r-md)',
  ],
  '<ListRow>': [
    'min-height: 52px',
    'border-bottom: 1px solid var(--edge-subtle)',
    'background: none',
    'cursor: pointer',
  ],
  '<CoverScreen>': [
    'position: fixed',
    'inset: 0',
    'z-index: var(--z-block)',
    'justify-content: center',
    'padding: var(--sp-6)',
  ],
  '<BareRow>': [
    'width: 100%',
    'background: none',
    'border: 0',
    'cursor: pointer',
    'text-align: left',
  ],
  // Keycap's signature is the one declaration no other shape has: a bottom
  // border twice the width of the other three. That asymmetry IS the keycap.
  '<Keycap>': [
    'border-bottom-width: 2px',
    'border-radius: var(--r-sm)',
    'place-items: center',
    'letter-spacing: var(--ls-caps)',
  ],
  '<CountBadge>': [
    'background: var(--status-attention-tint)',
    'color: var(--status-attention-text)',
    'border-radius: var(--r-full)',
    'padding: 0 6px',
  ],
  'CONTROL_ROW_NOTE': [
    'flex-basis: 100%',
    'margin: 0',
    'font-size: var(--fs-2xs)',
  ],
  'MONO_PATH': [
    'display: block',
    'font-family: var(--family-mono)',
    'font-size: var(--fs-xs)',
    'color: var(--ink-secondary)',
  ],
  'ATTENTION_DOT': [
    "content: ''",
    'width: 6px',
    'height: 6px',
    'background: var(--status-attention)',
  ],
  // The eyebrow's four, as the three stylesheet copies spelled them. It is
  // the signature a FIFTH copy would carry however it is written: the size,
  // the caps tracking, the transform and the medium weight. Planting one in
  // `@ccrc/ui` left the clustering above green — there is no partner left to
  // pair with, which is this half's whole reason for existing.
  'EYEBROW': [
    'var(--fs-2xs)',
    'var(--ls-caps)',
    'text-transform: uppercase',
    'var(--weight-medium)',
  ],
  '<TextInput>': [
    'min-height: var(--tap-min)',
    'background: var(--bg-raised)',
    'border: 1px solid var(--edge-strong)',
    'font-size: var(--fs-input)',
  ],
};

/** Rules that legitimately carry a signature and are NOT that component.
 *  Registered rather than excluded by a cleverer pattern: the pattern IS the
 *  point, so a rule that looks like a migrated shape has to be named here with
 *  the reason it is not one. */
const CARRIERS: Record<string, string> = {
  'EYEBROW chat.css .dlg-header-chip':
    'a PILL, not a label: it carries the eyebrow\'s four and then paints '
    + 'itself — accent tint, accent ink, r-full, its own padding — and its '
    + 'line-height is 1.4 where every real eyebrow is 1, because a pill needs '
    + 'the room its padding implies. Wearing EYEBROW would be four utilities '
    + 'to undo one of them',
  '<Button variant="quiet"> fleet.css .offline-banner':
    'a sticky status strip, not a control — no cursor, no press, --sp-8 tall '
    + 'rather than the tap floor',
  '<Button variant="quiet"> fleet.css .settings-badge':
    'a pill READOUT — r-full rather than r-md, 1.4 leading, no cursor and no press',
};

describe('no app rule re-implements a shape that has already migrated', () => {
  // THE APP'S SHEETS ALONE, unlike the clustering above. The question here is
  // "did the app re-invent a component?", and `@ccrc/ui`'s own rules are the
  // wrong place to ask it: `option-row.css .opt` carries `<ListRow>`'s
  // signature and `task-strip.css .task-line` carries `<BareRow>`'s, because
  // each is a SIBLING primitive built from the same four declarations in the
  // package that owns them both. Scanning them would mean registering two
  // carriers whose only reason is "this is the design system", which teaches
  // nobody anything and dilutes a list whose two real entries each name a
  // rule that LOOKS like a control and is not one.
  const appRules = rules().filter((r) => !r.sheet.startsWith('ui/'));

  it('has rules to scan — the signature check is not vacuously empty', () => {
    expect(appRules.length).toBeGreaterThanOrEqual(200);
  });

  it('every component this registry names still exists, carrying what it absorbed', () => {
    // A signature is only a mechanism while the component it describes is
    // still the thing shipping those declarations. These four assertions are
    // what reds if a migration is QUIETLY REVERSED inside the design system —
    // the hairline dropped from the list row, the ground dropped from the
    // quiet control — which no stylesheet scan can see, because by then there
    // is no stylesheet rule left to scan.
    const quiet = buttonVariants({ variant: 'quiet', size: 'fit' });
    for (const u of ['bg-raised', 'border-edge-subtle', 'text-ink-secondary', 'font-mono']) {
      expect(quiet, u).toContain(u);
    }
    for (const u of ['flex-wrap', 'min-h-tap', 'px-3', 'py-1', 'rounded-md', 'border-edge-subtle']) {
      expect(CONTROL_ROW, u).toContain(u);
    }
    // The list row's two defining numbers: a hairline UNDER it, and 52px —
    // eight above the tap floor, which is what separates neighbours a thumb is
    // dragging over. Both were in both original rules; neither had a guard
    // until a mutation removed each in turn and nothing went red.
    for (const u of ['min-h-[52px]', 'border-b', 'border-edge-subtle', 'bg-transparent']) {
      expect(LIST_ROW, u).toContain(u);
    }
    expect(LIST_ROW).not.toContain('min-h-tap');
    for (const u of ['min-h-tap', 'bg-raised', 'text-input']) expect(TEXT_INPUT, u).toContain(u);
    for (const u of ['rounded-sm', 'border-edge-strong', 'px-2']) {
      expect(TEXT_INPUT_INLINE, u).toContain(u);
    }
    // The cover's three load-bearing declarations: it is OUT of flow, it is
    // above everything, and it fills the viewport. Drop any one and the screen
    // behind it becomes reachable, which is the only thing a cover does.
    for (const u of ['fixed', 'inset-0', 'z-block']) expect(COVER_SCREEN, u).toContain(u);
    for (const u of ['w-full', 'min-h-tap', 'border-0', 'bg-transparent', 'text-left']) {
      expect(BARE_ROW, u).toContain(u);
    }
    // The count badge's pair is the loudest thing on the screen and the only
    // one saying something is waiting; both halves of it live here.
    for (const u of ['bg-status-attention-tint', 'text-status-attention-text', 'rounded-full',
      'tabular-nums']) {
      expect(COUNT_BADGE, u).toContain(u);
    }
    // `basis-full` is the whole of what the note does — without it the line
    // does not wrap onto its own row and squeezes the control instead.
    expect(CONTROL_ROW_NOTE).toContain('basis-full');
    // `break-all` is the declaration that makes a long path a shape rather
    // than a type ramp; two of the three rules that merged here lacked it.
    expect(MONO_PATH).toContain('break-all');
    for (const u of ["before:content-['']", 'before:size-[6px]', 'before:bg-status-attention']) {
      expect(ATTENTION_DOT, u).toContain(u);
    }
    for (const u of ['border-b-2', 'rounded-sm', 'min-w-tap', 'min-h-tap', 'tracking-caps',
      'enabled:active:translate-y-px']) {
      expect(KEYCAP, u).toContain(u);
    }
    // And it supplies NO ground: both are descendant rules in the app's own
    // sheets, one of them a `color-mix` neither half of the gate could follow
    // into a variant.
    expect(KEYCAP).not.toMatch(/\bbg-/);

    // THE EYEBROW'S SIX, and the two resets that are easiest to lose. Every
    // one of the three rules this absorbed used the `font:` SHORTHAND, which
    // resets `font-style` and `font-variant` on its way past; longhand
    // utilities do not, so dropping `not-italic` would italicise an eyebrow
    // inside any italic host and nothing else would notice.
    for (const u of ['font-mono', 'text-2xs', 'font-medium', 'uppercase', 'leading-none',
      'tracking-caps', 'not-italic', 'normal-nums']) {
      expect(EYEBROW, u).toContain(u);
    }
    // And it carries NO colour: `--ink-tertiary`, `--syn-comment` and
    // `--ink-on-well` are three different inks on three different grounds,
    // each measured by the contrast gate in its own rule. A colour here would
    // be one of them claiming to be all three.
    expect(EYEBROW).not.toMatch(/\btext-ink-|\btext-syn-/);

    // The list reset's four, and the gap it deliberately does not set: each
    // of the four lists picks its own row rhythm.
    for (const u of ['list-none', 'm-0', 'p-0', 'grid']) expect(RESET_LIST, u).toContain(u);
    expect(RESET_LIST).not.toMatch(/\bgap-/);
  });

  it('names no rule carrying a migrated signature that this registry has not seen', () => {
    const found: string[] = [];
    for (const [component, signature] of Object.entries(MIGRATED)) {
      for (const rule of appRules) {
        const body = rule.decls.join('; ');
        if (signature.every((d) => body.includes(d))) {
          found.push(`${component} ${rule.sheet} ${rule.sel}`);
        }
      }
    }
    expect(found.filter((k) => CARRIERS[k] === undefined)).toEqual([]);
    // Not vacuous: every registered carrier is a rule that really is there.
    for (const k of Object.keys(CARRIERS)) expect(found, k).toContain(k);
  });
});
