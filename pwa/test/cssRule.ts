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
 *  not a pass. */
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
