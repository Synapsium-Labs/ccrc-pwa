// THE ASK SURFACES SPEAK PLAINLY (D-6325, plan docs/superpowers/plans/2026-10-22-desktop-polish.md, Task T1b).
//
// ccrc has names for its own machinery: the hook's JSON is "the envelope", Claude Code's free-text row is "the own-words
// row", the terminal is "the pane". They are right inside the code and wrong on the screen, where the operator knows a
// question, an "Other" option and "the terminal". This census walks the TypeScript syntax tree of the files an ask
// surface's words live in and refuses a forbidden word in any position an operator reads. It reuses
// the walker `literal-census.test.ts` also uses (`literalWalker.ts`: `parseTs`, `isSpecifier`, one copy, a helper module so
// that importing it registers no tests) rather than copying it.
//
// WHAT IT SCANS, by POSITION and never by shape (a class string that happens to say "pane" is not copy):
//   - JSX text;
//   - the string values of the attributes `aria-label`, `title`, `placeholder`, `alt`, `label`, `sublabel` and `kicker`;
//   - a string that is a parameter's default (`function H({ kicker = '…' })`);
//   - a string in a JSX child expression (`{cond ? 'a' : 'b'}`);
//   - sentence constants: a top-level `const` holding a string, a template, or an arrow that returns one (exported or
//     not: a private constant is rendered all the same), and a top-level function's returned strings;
//   - the sentence values of a `Record` table (a top-level const typed `Record<…>`);
//   - the first argument of `toast(…)`, which is a sentence the operator reads;
//   - `api.ts` only: the Error literal in the returned API object's `projects` method, which reports a malformed
//     project-list response. The two `wrong-representation` Errors in the docs loaders are internal machine
//     discriminants, so this position does not read them.
// It never scans `className`, `data-*`, object keys, import specifiers, route literals or comments.
//
// WIDER THAN THE PLAN'S LIST, ON PURPOSE (D-6325, T1b; T3a and T3d extend this file and inherit the choice). The plan
// names JSX text, six attributes, exported sentence constants and Record values. This scan also reads private top-level
// constants, strings a top-level function returns, parameter defaults, strings in JSX child expressions and the first
// argument of `toast(...)`. The reason is that the sentences an operator reads are not kept only where the plan looked:
// `ROW_HOLDS_OTHER` and its siblings are private constants rendered through `{…}`, `cursorPlace` and `ownWordsCount`
// return their sentences, and the kicker `Claude is asking` was a parameter default, which a narrower walk cannot see. A
// word the narrow rule would have missed is caught, and the measured cost is nothing: no position added here produced a
// false positive on the tree. Narrow it only by a change that says which sentence it then leaves unseen.
//
// WHOLE WORDS, case-insensitive, except the exact lowercase literal `claude is asking` (the sentence-case
// `Claude is asking` is the new kicker and is right). A word leaves the list only by a change that says why.
//
// THE FILES: the five ask-surface word homes, `lib/refusalWords.ts`'s two `dialog-open` sentences which the composer
// says when an ask is up, and `lib/api.ts`'s project-list Error. The docs loaders' internal machine discriminants stay out.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import ts from 'typescript';
import { isSpecifier, parseTs } from './literalWalker';

const SESSION = path.join(import.meta.dirname, '..', 'src', 'session');
const REFUSAL_WORDS = path.join(import.meta.dirname, '..', 'src', 'lib', 'refusalWords.ts');
const API = path.join(import.meta.dirname, '..', 'src', 'lib', 'api.ts');

/** The words an operator never reads, each with what is said instead and why. */
const FORBIDDEN: readonly { readonly word: RegExp; readonly name: string; readonly say: string; readonly why: string }[] = [
  {
    word: /\bown-words\b/i, name: 'own-words', say: 'the answer box in the terminal, or "Other"',
    why: "ccrc's internal name for Claude Code's free-text row; the operator sees an Other option",
  },
  {
    word: /\bown words row\b/i, name: 'own words row', say: 'the answer box in the terminal, or "Other"',
    why: 'the same internal name, spelled without the hyphen',
  },
  {
    word: /\benvelope\b/i, name: 'envelope', say: 'the question',
    why: "the hook's internal name for Claude's own copy of a question; the operator sees a question",
  },
  {
    word: /\bpane\b/i, name: 'pane', say: 'the terminal',
    why: 'one word for one thing: the terminal is what the operator opens, and "pane" is its tmux name',
  },
  {
    word: /\bCoordinator row\b/i, name: 'Coordinator row', say: 'the coordinator\'s name, in a held line',
    why: 'a registry word; the ask surface says who may answer first in a sentence',
  },
  {
    word: /\bhot-file\b/i, name: 'hot-file', say: 'what the file holds',
    why: "the hook's file name for its live state; never a word for the operator",
  },
  {
    // Case-SENSITIVE on purpose: the lowercase literal was the old kicker's source text; the kicker is sentence case now.
    word: /claude is asking/, name: 'claude is asking', say: 'Claude is asking',
    why: 'sentence case; the header now says who asks, so the kicker starts a sentence',
  },
];

/** Every string in `expr` that the expression can evaluate to, for the shapes a sentence takes: a literal, a template, a
 *  conditional's two arms, a `&&` / `||` / `??` right side, and a parenthesised or cast expression. */
function leaves(expr: ts.Node | undefined): ts.Node[] {
  if (expr === undefined) return [];
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr) || ts.isTemplateExpression(expr)) return [expr];
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) {
    return leaves(expr.expression);
  }
  if (ts.isConditionalExpression(expr)) return [...leaves(expr.whenTrue), ...leaves(expr.whenFalse)];
  if (ts.isBinaryExpression(expr)) return leaves(expr.right);
  return [];
}

/** The text a string-like node says. A template's expressions are dropped (they are values, not words). */
const textOf = (n: ts.Node): string => {
  if (ts.isTemplateExpression(n)) return n.head.text + n.templateSpans.map((s) => ` ${s.literal.text}`).join('');
  return (n as ts.StringLiteral).text;
};

/** The strings a function or arrow returns, at its own level. */
function returned(fn: ts.Node): ts.Node[] {
  const out: ts.Node[] = [];
  const body = ts.isFunctionDeclaration(fn) || ts.isArrowFunction(fn) || ts.isFunctionExpression(fn) ? fn.body : undefined;
  if (body === undefined) return out;
  if (!ts.isBlock(body)) return leaves(body);
  const visit = (n: ts.Node): void => {
    if (ts.isFunctionLike(n) && n !== fn) return;
    if (ts.isReturnStatement(n)) out.push(...leaves(n.expression));
    n.forEachChild(visit);
  };
  body.forEachChild(visit);
  return out;
}

const SENTENCE_ATTRS = new Set(['aria-label', 'title', 'placeholder', 'alt', 'label', 'sublabel', 'kicker']);

/** One operator-visible string: where it is, which position kind found it, and what it says. */
export interface Visible {
  readonly line: number;
  readonly position: string;
  readonly text: string;
}

/** Every operator-visible string in `source`, by position (see the header). `only` limits the Record tables read to the
 *  named keys (refusalWords.ts's two `dialog-open` sentences). */
export function visibleStrings(file: string, text?: string, only?: readonly string[]): Visible[] {
  const src = parseTs(file, text);
  const found: Visible[] = [];
  const seen = new Set<ts.Node>();
  const add = (n: ts.Node, position: string): void => {
    if (seen.has(n) || isSpecifier(n)) return;
    seen.add(n);
    found.push({ line: src.getLineAndCharacterOfPosition(n.getStart()).line + 1, position, text: textOf(n) });
  };
  /** Every string under a JSX child expression, not descending into nested JSX (its own positions read it). */
  const underChild = (n: ts.Node): void => {
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) return;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) {
      add(n, 'a string in a JSX child');
      return;
    }
    n.forEachChild(underChild);
  };
  const isRecordType = (t: ts.TypeNode | undefined): boolean => t !== undefined && /\bRecord</.test(t.getText(src));
  const recordValues = (init: ts.Expression): void => {
    const obj = ts.isObjectLiteralExpression(init) ? init : null;
    if (obj === null) return;
    for (const p of obj.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      const key = ts.isStringLiteral(p.name) || ts.isIdentifier(p.name) ? p.name.text : null;
      if (only !== undefined && (key === null || !only.includes(key))) continue;
      for (const v of leaves(p.initializer)) add(v, 'a Record table value');
    }
  };

  const visit = (n: ts.Node): void => {
    if (ts.isJsxText(n) && n.text.trim() !== '') add(n, 'JSX text');
    if (ts.isJsxAttribute(n) && SENTENCE_ATTRS.has(n.name.getText(src)) && n.initializer !== undefined) {
      const init = n.initializer;
      if (ts.isStringLiteral(init)) add(init, `the ${n.name.getText(src)} attribute`);
      else if (ts.isJsxExpression(init)) for (const v of leaves(init.expression)) add(v, `the ${n.name.getText(src)} attribute`);
    }
    if (ts.isJsxExpression(n) && n.parent !== undefined && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))) {
      n.forEachChild(underChild);
    }
    if (only === undefined && (ts.isParameter(n) || ts.isBindingElement(n)) && n.initializer !== undefined) {
      for (const v of leaves(n.initializer)) add(v, 'a parameter default');
    }
    if (ts.isCallExpression(n) && n.expression.getText(src) === 'toast') {
      for (const v of leaves(n.arguments[0])) add(v, 'a toast');
    }
    n.forEachChild(visit);
  };

  // Top level only: constants, tables and functions. (A sentence assembled deep inside a component is a JSX position or
  // a toast, which the walk above reads; a bare local string is not copy.)
  if (only === undefined) visit(src);
  if (only === undefined && path.basename(file) === 'api.ts') {
    const projectErrors = (n: ts.Node): void => {
      if (ts.isNewExpression(n) && n.expression.getText(src) === 'Error') {
        for (const v of leaves(n.arguments?.[0])) add(v, 'an api.projects Error');
      }
      n.forEachChild(projectErrors);
    };
    const projectMethod = (n: ts.Node): void => {
      if (ts.isPropertyAssignment(n) && n.name.getText(src) === 'projects'
        && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) {
        projectErrors(n.initializer.body);
      }
      n.forEachChild(projectMethod);
    };
    src.forEachChild(projectMethod);
  }
  for (const st of src.statements) {
    if (only === undefined && ts.isFunctionDeclaration(st)) {
      for (const v of returned(st)) add(v, 'a returned sentence');
    }
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (d.initializer === undefined) continue;
      if (isRecordType(d.type)) {
        recordValues(d.initializer);
        continue;
      }
      if (only !== undefined) continue;
      for (const v of leaves(d.initializer)) add(v, 'a sentence constant');
      if (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) {
        for (const v of returned(d.initializer)) add(v, 'a returned sentence');
      }
    }
  }
  return found;
}

/** The forbidden words found in `strings`, as `file:line  name  in position: "text"` lines. */
export function offences(file: string, strings: readonly Visible[]): string[] {
  const out: string[] = [];
  for (const s of strings) {
    for (const f of FORBIDDEN) {
      if (f.word.test(s.text)) out.push(`${path.basename(file)}:${s.line}  "${f.name}" in ${s.position} (say ${f.say}): ${s.text.slice(0, 90)}`);
    }
  }
  return out;
}

const OWNED = ['AskParts.tsx', 'askWords.ts', 'EnvelopeSheet.tsx', 'DialogSheet.tsx', 'askLive.ts'].map((f) => path.join(SESSION, f));
const PALETTE = ['registry.ts', 'sessionEntries.ts'].map((f) => path.join(import.meta.dirname, '..', 'src', 'command', f));
const STRIP_FOLD = path.join(import.meta.dirname, '..', 'src', 'fleet', 'stripFold.ts');

describe('the ask surfaces speak plainly (D-6325)', () => {
  it.each(OWNED.map((f) => [path.basename(f), f] as const))('%s says none of the forbidden words where an operator reads', (_name, file) => {
    expect(offences(file, visibleStrings(file)), 'rewrite the sentence; the table above says what to say').toEqual([]);
  });

  // The top search's words (D-6714, T5a): the palette's word home and the session entries' labels and groups.
  it.each(PALETTE.map((f) => [path.relative(path.join(import.meta.dirname, '..', 'src'), f), f] as const))(
    '%s (the top search) says none of the forbidden words where an operator reads',
    (_name, file) => {
      const strings = visibleStrings(file);
      expect(strings.length, 'the scan reads its sentences').toBeGreaterThan(0);
      expect(offences(file, strings), 'rewrite the sentence; the table above says what to say').toEqual([]);
    },
  );

  it('fleet/stripFold.ts (the lanes fold\'s words) says none of the forbidden words where an operator reads', () => {
    const strings = visibleStrings(STRIP_FOLD);
    expect(strings.length, 'the scan reads its sentences').toBeGreaterThan(0);
    expect(offences(STRIP_FOLD, strings), 'rewrite the sentence; the table above says what to say').toEqual([]);
  });

  it("refusalWords.ts's dialog-open sentences and api.projects' error pass too", () => {
    const refusalStrings = visibleStrings(REFUSAL_WORDS, undefined, ['dialog-open']);
    const projectErrorStrings = visibleStrings(API).filter((s) => s.position === 'an api.projects Error');
    const strings = [...refusalStrings, ...projectErrorStrings];
    expect(strings.map((s) => s.text), 'all three sentences are read').toHaveLength(3);
    expect(offences(REFUSAL_WORDS, refusalStrings)).toEqual([]);
    expect(offences(API, projectErrorStrings)).toEqual([]);
  });

  it("reads api.projects' inline Error by position, so a forbidden replacement fails", () => {
    const source = readFileSync(API, 'utf8');
    const changed = source.replace("The server's project list could not be read.", 'The pane could not be read.');
    expect(changed).not.toBe(source);
    const errors = visibleStrings(API, changed).filter((s) => s.position === 'an api.projects Error');
    expect(offences(API, errors)).toHaveLength(1);
  });

  it('reads sentences at all: every owned file has operator-visible strings', () => {
    for (const f of OWNED) expect(visibleStrings(f).length, path.basename(f)).toBeGreaterThan(3);
  });

  it('keeps every forbidden word with a replacement and a reason', () => {
    expect(FORBIDDEN.map((f) => f.name)).toEqual([
      'own-words', 'own words row', 'envelope', 'pane', 'Coordinator row', 'hot-file', 'claude is asking',
    ]);
    for (const f of FORBIDDEN) {
      expect(f.say.length, f.name).toBeGreaterThan(3);
      expect(f.why.length, f.name).toBeGreaterThan(20);
    }
  });
});

describe('the scanner reads positions, not shapes', () => {
  /** Offences in a snippet read as a `.tsx` file, so a mutant of the scanner is caught here and not only on the tree. */
  const scan = (code: string, only?: readonly string[]): string[] =>
    offences('probe.tsx', visibleStrings('probe.tsx', code, only));

  it.each([
    ['JSX text', 'export const A = () => <p>The envelope is bad</p>;'],
    ['an aria-label', 'export const A = () => <input aria-label="the pane" />;'],
    ['a title', 'export const A = () => <b title="own-words row" />;'],
    ['a placeholder in an expression', 'export const A = (x: boolean) => <input placeholder={x ? "ok" : "hot-file"} />;'],
    ['a label', 'export const A = () => <Row label="Coordinator row" />;'],
    ['a sublabel', 'export const A = () => <Row sublabel="own words row" />;'],
    ['an alt', 'export const A = () => <img alt="the envelope" />;'],
    ['a string in a JSX child', 'export const A = (x: boolean) => <p>{x ? "fine" : "the pane"}</p>;'],
    ['an exported sentence constant', 'export const S = "answer on the pane";'],
    ['a private sentence constant', 'const S = "own-words";'],
    ['a template constant', 'export const S = `the ${x} envelope`;'],
    ['a sentence-returning arrow', 'export const S = (n: number) => `In the terminal ${n} on the pane`;'],
    ['a returned sentence', 'export function f(x: boolean) { if (x) return "own-words"; return "ok"; }'],
    ['a Record table value', 'const T: Readonly<Record<string, string>> = { a: "fine", b: "the envelope" };'],
    ['a toast', 'toast("claude is asking");'],
    ['a kicker attribute', 'export const A = () => <AskHeader kicker="claude is asking" />;'],
    ['a parameter default', 'export function H({ kicker = "claude is asking" }: { kicker?: string }) { return kicker; }'],
    ['a plain parameter default', 'export const H = (kicker: string = "the pane") => kicker;'],
  ])('flags %s', (_name, code) => {
    expect(scan(code).length).toBe(1);
  });

  it.each([
    ['className', 'export const A = () => <div className="ask-envelope pane" />;'],
    ['a data attribute', 'export const A = () => <div data-source="envelope" data-pane="pane" />;'],
    ['an object key', 'const T: Record<string, string> = { envelope: "fine", pane: "fine" };'],
    ['a non-Record object', 'const T = { kind: "pane" };'],
    ['an import specifier', 'import { x } from "../pane/envelope";\nexport const A = x;'],
    ['a route literal', 'export const A = (id: string) => fetch(`/api/${id}/pane/history`);'],
    ['a comment', '// the pane and the envelope\n/* own-words */\nexport const A = 1;'],
    ['a word inside a longer word', 'export const S = "panel envelopes panes";'],
    ['the sentence-case kicker', 'export const S = "Claude is asking";'],
    ['a type-level string', 'export type K = "pane" | "envelope";'],
  ])('does not flag %s', (_name, code) => {
    expect(scan(code)).toEqual([]);
  });

  it('flags the exact lowercase literal only', () => {
    expect(scan('export const S = "claude is asking";')).toHaveLength(1);
    expect(scan('export const S = "Claude is asking";')).toEqual([]);
    expect(scan('export const S = "CLAUDE IS ASKING";')).toEqual([]);
  });

  it('reads only the named keys of a Record when asked (api.ts)', () => {
    const code = 'const T: Record<string, string> = { "dialog-open": "fine", "other": "the pane" };';
    expect(scan(code, ['dialog-open'])).toEqual([]);
    expect(scan(code)).toHaveLength(1);
  });
});

// The inspector's words (D-6334, T3d): the six sections and the routing line's word table.
describe('the inspector speaks plainly (D-6334)', () => {
  const SRC_ROOT = path.join(import.meta.dirname, '..', 'src');
  const INSPECTOR = [
    ...['TasksSection', 'MailSection', 'PrSection', 'RoutingSection', 'LaneSection', 'HistorySection']
      .map((f) => path.join(SRC_ROOT, 'inspector', `${f}.tsx`)),
    path.join(SRC_ROOT, 'session', 'routingLine.ts'),
  ];
  it.each(INSPECTOR.map((f) => [path.relative(SRC_ROOT, f), f] as const))(
    '%s (the inspector) says none of the forbidden words where an operator reads',
    (_name, file) => {
      const strings = visibleStrings(file);
      expect(strings.length, 'the scan reads its sentences').toBeGreaterThan(0);
      expect(offences(file, strings), 'rewrite the sentence; the table above says what to say').toEqual([]);
    },
  );
});
