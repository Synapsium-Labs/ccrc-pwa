// Reading a stylesheet as TEXT is the only way anything in this suite can
// assert a CSS rule: vitest runs with `css: false` (there is no `css` key in
// vite.config.ts), so jsdom evaluates no stylesheet at all and
// `getComputedStyle` reports nothing any rule could have set. A real-browser
// runner is the tool that would replace this, and it is not on this branch.
// So the scrape is the right tool — a `min-height` that quietly stops existing
// on the one button that deletes a worktree is worth catching, and nothing
// else here can catch it.
//
// What the scrape must NOT be is coupled to the FORMATTING of files another
// lane owns and is editing right now (fix round 3, verifier P5: three separate
// hand-rolled copies of this helper existed, one of which demanded exactly one
// space before the brace, and one assertion pinned three literal spaces after
// a colon). Every reader in this suite now goes through here, so the coupling
// is one function and not one per file, and it tolerates everything a
// formatter may reasonably change:
//
//   - comments anywhere, including inside the rule;
//   - the selector appearing anywhere in a GROUPED selector list;
//   - any whitespace, newlines included, around selectors, commas and braces;
//   - any whitespace inside a declaration, and inside `var( … )`;
//   - the quote style of an attribute selector's value — `[data-state='x']`,
//     `[data-state="x"]` and `[data-state=x]` are one selector, and prettier
//     rewrites the first into the second.
//
// What it still fails on is exactly what the tests are about: the declaration
// going missing, or its value changing.
//
// Known limit, deliberate: a declaration whose VALUE contains a semicolon or
// braces (a `url(data:…;base64,…)`) is not parsed correctly by
// `declValue`. Nothing in this codebase has one, and pretending to be a real
// CSS parser here would be a worse trade than this comment.

/** Whitespace as a formatter may move it: collapsed, and never significant
 *  next to a paren or comma. `var( --tap-min )` and `var(--tap-min)` are the
 *  same declaration and must compare equal. */
export function norm(text: string): string {
  return text.trim().replace(/\s+/g, ' ').replace(/\s*([(),])\s*/g, '$1');
}

/** `text` with every comment removed — a comment never carries a declaration,
 *  so prose mentioning `44px` must not satisfy, or break, an assertion about
 *  declarations. */
export function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Comments blanked to spaces of the same length: a comment containing a brace
 *  must not confuse the walk below, and blanking (rather than deleting) keeps
 *  every offset aligned with the ORIGINAL text, so the rule that comes back is
 *  the real one, comments and all. Callers that want a comment-free view of a
 *  rule ask for it explicitly with `stripComments`; fleet-css.test.ts
 *  deliberately asserts on a comment inside a rule. */
function blankComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
}

/** `norm` for a SELECTOR: additionally unquotes attribute values, which carry
 *  no meaning for any selector in this codebase and which prettier rewrites
 *  from `'` to `"` on sight. Declaration values do NOT go through here — a
 *  quote in a `content:` is significant. */
export function normSel(sel: string): string {
  return norm(sel).replace(/=(['"])(.*?)\1\]/g, '=$2]');
}

/** The first rule whose selector list CONTAINS `sel` as a whole selector, as
 *  its normalised selector list plus its raw declaration block.
 *  Grouping-tolerant: `.a,\n.b {` is a rule for `.b`. Nested blocks (`@media`)
 *  are walked into, since the inner rules match on their own. Throws when
 *  there is no such rule — a rule renamed out from under a test is a failure,
 *  not a pass.
 *
 *  FIRST, AND ONLY EXACTLY THIS SELECTOR — which is a real hole when the
 *  assertion is about what the ELEMENT ends up with rather than about what one
 *  rule says: a second rule later in the same block, or a
 *  higher-specificity `.app-shell .shell-detail`, wins the cascade and this
 *  reader never sees it. Measured on the D-161 guard: three separate mutants
 *  put `overflow: hidden` back on the detail pane with the suite still green.
 *  {@link declaredValues} is the reader for that kind of assertion; this one
 *  stays for the assertions that really are about one rule's own text
 *  (fleet-css.test.ts reads a comment out of a rule body). */
function findRule(text: string, sel: string): { selectors: string[]; body: string } {
  const scan = blankComments(text);
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(scan); m !== null; m = re.exec(scan)) {
    const prelude = m[1] ?? '';
    const body = m[2] ?? '';
    const selectors = prelude.split(',').map((s) => normSel(s)).filter((s) => s !== '');
    if (selectors.includes(normSel(sel))) {
      const start = m.index + prelude.length + 1;   // just past the '{'
      return { selectors, body: text.slice(start, start + body.length) };
    }
  }
  throw new Error(`no rule for ${sel}`);
}

/** The declaration block of the rule `findRule` finds. */
export function ruleIn(text: string, sel: string): string {
  return findRule(text, sel).body;
}

/** The whole normalised selector list of the rule `findRule` finds — for the
 *  assertions that are about the GROUPING itself ("every coloured cell on this
 *  row is in the one rule that neutralises them"), where reading the group back
 *  out of the file as a text slice is the hand-rolled scrape this file
 *  replaces. */
export function selectorsOf(text: string, sel: string): string[] {
  return findRule(text, sel).selectors;
}

/** The body of the at-rule whose prelude matches `prelude`, so a test about a
 *  rule INSIDE `@media (forced-colors: active)` can say so, rather than
 *  slicing the file at a literal and hoping the next same-named rule is the
 *  one inside. Whitespace-tolerant on both sides of the colon too, since a
 *  media feature is `(name: value)` and a formatter may close that gap.
 *  Throws when there is no such at-rule. */
export function atBlock(text: string, prelude: string): string {
  const scan = blankComments(text);
  const key = (s: string): string => norm(s).replace(/\s*:\s*/g, ':');
  const want = key(prelude);
  for (let at = scan.indexOf('@'); at >= 0; at = scan.indexOf('@', at + 1)) {
    const open = scan.indexOf('{', at);
    if (open < 0) break;
    if (key(scan.slice(at, open)) !== want) continue;
    let depth = 1;
    let i = open + 1;
    for (; i < scan.length && depth > 0; i += 1) {
      if (scan[i] === '{') depth += 1;
      else if (scan[i] === '}') depth -= 1;
    }
    if (depth !== 0) break;              // unbalanced: not a block we can trust
    return text.slice(open + 1, i - 1);
  }
  throw new Error(`no at-rule for ${prelude}`);
}

/** The normalised value of `prop` in a declaration block, or null when the
 *  block does not set it. The LAST wins, as the cascade says it does. */
export function declValue(rule: string, prop: string): string | null {
  let found: string | null = null;
  for (const decl of stripComments(rule).split(';')) {
    const colon = decl.indexOf(':');
    if (colon < 0) continue;
    if (norm(decl.slice(0, colon)) !== norm(prop)) continue;
    found = norm(decl.slice(colon + 1));
  }
  return found;
}

// ── the cascade-aware reader: what does the ELEMENT end up with? ────────────
//
// Everything above answers "what does THIS rule say". A guard about a
// behaviour — "the detail pane scrolls down and never sideways" — is about the
// element, and the element is the sum of every rule that targets it. Two ways
// the rule-at-a-time reader passes a broken stylesheet, both measured on
// shell.css:
//
//   1. A LATER RULE WINS AND IS NEVER READ. `.shell-detail { overflow: hidden }`
//      appended to the same @media block, or `.app-shell .shell-detail
//      { overflow: hidden }` at any position, puts the pane back to clipped and
//      `ruleIn` still returns the first rule, still reading `overflow-y: auto`.
//   2. AN EQUIVALENT SPELLING FAILS. `overflow: clip auto` is the same
//      declaration as `overflow-x: clip; overflow-y: auto` — and is what
//      lightningcss emits into the shipped bundle — but a longhand reader sees
//      null for both axes.
//
// So this reader collects EVERY rule that targets the element, expands the
// shorthands, and hands back every value in source order. The tests assert on
// the whole list rather than on the winner, which is deliberately stricter
// than the cascade: last-in-source is not the same as highest-specificity, and
// a guard that tried to model specificity would be a CSS engine. "No rule
// targeting this element may declare a value outside the contract" needs
// neither.

/** The compound selectors of one selector, outermost first: `.a > .b .c` is
 *  `['.a', '.b', '.c']`. Combinators carry no meaning for the questions this
 *  reader answers (does this rule target that element at all), so `>`, `+` and
 *  `~` are treated exactly like a descendant space. */
function compounds(sel: string): string[] {
  return normSel(sel).split(/\s*[>+~]\s*|\s+/).filter((c) => c !== '');
}

/** Does the rule written as `member` style the element `sel` names?
 *
 *  `sel`'s SUBJECT (its last compound — the element a selector actually
 *  styles) must be `member`'s subject, allowing `member` to carry extra
 *  qualifiers on it (`:hover`, `[data-x]`, a second class), and every ancestor
 *  `sel` names must appear in `member`'s chain in order, allowing `member` to
 *  name MORE ancestors (that is how a higher-specificity restatement is
 *  caught). So `.app-shell .shell-detail` and `.shell-detail:hover` both
 *  target `.shell-detail`; `.shell-detail-wide`, `.shell-detail .chat` and
 *  `.chat .shell-detail-x` do not.
 *
 *  A `::pseudo-element` subject is NOT the element — `.x::before` paints a
 *  generated box, and a declaration there says nothing about `.x` — so those
 *  members are skipped, the same call `design/audit.mjs`'s `variantSuffix`
 *  makes for the same reason. */
function targets(member: string, sel: string): boolean {
  const want = compounds(sel);
  const got = compounds(member);
  if (want.length === 0 || got.length < want.length) return false;
  const wantSubject = want[want.length - 1]!;
  const gotSubject = got[got.length - 1]!;
  if (gotSubject.includes('::')) return false;
  const extra = gotSubject.startsWith(wantSubject) ? gotSubject.slice(wantSubject.length) : null;
  // '' is the same subject; a qualifier START is a narrower subject. Anything
  // else (`-wide`, `x`) is a DIFFERENT class whose name merely begins the same.
  if (extra === null || !(extra === '' || /^[.#:[]/.test(extra))) return false;
  let at = 0;
  for (const ancestor of want.slice(0, -1)) {
    while (at < got.length - 1 && got[at] !== ancestor) at += 1;
    if (at >= got.length - 1) return false;
    at += 1;
  }
  return true;
}

/** Every rule targeting `sel` ({@link targets}), in source order, each as its
 *  normalised selector list plus its raw declaration block. Throws when there
 *  are none, for {@link findRule}'s reason: a renamed class is a failure. */
export function rulesFor(text: string, sel: string): { selectors: string[]; body: string }[] {
  const scan = blankComments(text);
  const re = /([^{}]+)\{([^{}]*)\}/g;
  const out: { selectors: string[]; body: string }[] = [];
  for (let m = re.exec(scan); m !== null; m = re.exec(scan)) {
    const prelude = m[1] ?? '';
    const body = m[2] ?? '';
    const selectors = prelude.split(',').map((sl) => normSel(sl)).filter((sl) => sl !== '');
    if (!selectors.some((member) => targets(member, sel))) continue;
    const start = m.index + prelude.length + 1;      // just past the '{'
    out.push({ selectors, body: text.slice(start, start + body.length) });
  }
  if (out.length === 0) throw new Error(`no rule targeting ${sel}`);
  return out;
}

/** The longhands each shorthand this codebase actually writes can set, and
 *  which position in the shorthand's value feeds each one. Deliberately tiny:
 *  a general shorthand expander is a CSS engine, and every entry here exists
 *  because a real stylesheet in this repo (or the build's own output) writes
 *  that shorthand for a property a guard asserts on. */
const SHORTHAND: Record<string, { of: string; slot: number }> = {
  'overflow-x': { of: 'overflow', slot: 0 },
  'overflow-y': { of: 'overflow', slot: 1 },
};

/** Every declaration in `rule`, in source order, comments stripped. */
function declarations(rule: string): { prop: string; value: string }[] {
  const out: { prop: string; value: string }[] = [];
  for (const decl of stripComments(rule).split(';')) {
    const colon = decl.indexOf(':');
    if (colon < 0) continue;
    out.push({ prop: norm(decl.slice(0, colon)), value: norm(decl.slice(colon + 1)) });
  }
  return out;
}

/** Every value `rule` gives `prop`, in source order, counting the shorthands in
 *  {@link SHORTHAND}: `overflow: clip auto` answers `overflow-x` with `clip`
 *  and `overflow-y` with `auto`, and the one-value form answers both with it. */
export function longhandValues(rule: string, prop: string): string[] {
  const want = norm(prop);
  const short = SHORTHAND[want];
  const out: string[] = [];
  for (const { prop: p, value } of declarations(rule)) {
    if (p === want) { out.push(value); continue; }
    if (short === undefined || p !== short.of) continue;
    const parts = value.split(' ');
    out.push(parts[short.slot] ?? parts[0]!);
  }
  return out;
}

/** Every value that any rule targeting `sel` declares for `prop`, in source
 *  order, shorthands expanded. `[]` means nothing sets it — which is a real
 *  answer, unlike a missing rule (that throws). */
export function declaredValues(text: string, sel: string, prop: string): string[] {
  return rulesFor(text, sel).flatMap((r) => longhandValues(r.body, prop));
}

/** The value that WINS for `prop` on `sel` by source order, or null when
 *  nothing sets it. Later-in-source only: a higher-specificity rule EARLIER in
 *  the file really does win in a browser and does not here, which is why the
 *  guards assert on {@link declaredValues} — every declared value inside the
 *  contract — and use this only where "which one shows" is the question. */
export function effectiveValue(text: string, sel: string, prop: string): string | null {
  const all = declaredValues(text, sel, prop);
  return all.length === 0 ? null : all[all.length - 1]!;
}
