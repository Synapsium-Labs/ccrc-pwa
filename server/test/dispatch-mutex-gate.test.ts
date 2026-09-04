// D-46's whole force is a CALLER property, not a property `dispatchRun`/
// `closeRun` enforce on their own (`coord-decide.test.ts`'s concurrent case
// measures this directly: two un-serialised calls both pass the transition
// guard and both reach `ccd ws-add`). Before the architecture-doc-increment-4
// split, that was structurally impossible to get wrong — the decision lived
// INSIDE `coordMutex.run(async () => { ... })`, so there was no way to call it
// unserialised. Now `dispatchRun`/`closeRun` are exported, ordinary functions,
// and the mutex is a habit of exactly two call sites in `routes.ts` — nothing
// stops a THIRD call site (a future route, a script, a test helper promoted
// into `src/`) from calling either one directly and reopening the exact
// concurrent-dispatch hazard review findings 4/11/23 closed.
//
// This is the same shape `verb-gate.test.ts` already uses for `verbSupported`:
// walk `server/src`, find every call site of the two guarded functions, and
// require each one to sit lexically inside a `coordMutex.run(...)` call.
// `server/test/coord-decide.test.ts` calls both functions directly with NO
// mutex, on purpose (that is the whole point of that file) — it lives under
// `server/test`, outside this scanner's walk, exactly as `verb-gate.test.ts`
// only walks `server/src` too.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '..', 'src');

/** Blank out comments and string/template bodies, preserving every byte
 *  position and newline — copied from `verb-gate.test.ts`'s own helper
 *  (unchanged) so a call site mentioned only in prose is invisible to the
 *  scanner and line numbers stay true. */
function blankCommentsAndStrings(text: string): string {
  const out = text.split('');
  const blank = (a: number, b: number): void => {
    for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '/' && d === '/') {
      const j = text.indexOf('\n', i);
      const e = j < 0 ? text.length : j;
      blank(i, e); i = e;
    } else if (c === '/' && d === '*') {
      const j = text.indexOf('*/', i + 2);
      const e = j < 0 ? text.length : j + 2;
      blank(i, e); i = e;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === '\\') j += 2;
        else if (text[j] === c) break;
        else j++;
      }
      blank(i + 1, Math.min(j, text.length));
      i = Math.min(j + 1, text.length);
    } else i++;
  }
  return out.join('');
}

interface Site { file: string; line: number; name: string; guarded: boolean }

// `coord.setCaps` joins the two bare functions, and the scanner needs no change
// to take it: `head` is the whole identifier chain including its dots, which is
// what already makes `coord.closeRun` a non-match for the bare `closeRun`
// target. The reason it belongs here is the same D-46 reason: `dispatchRun`
// reads `caps()` and `capsUsage()` across await boundaries
// (`coord/dispatch.ts:236-237`), so a caps write landing between those two
// reads is the identical un-serialised-decision hazard, and `POST
// /api/coord/caps` is the first and only writer (D-1240/D-1164).
const TARGETS = new Set(['dispatchRun', 'closeRun', 'coord.setCaps']);
const GUARD = 'coordMutex.run';

/** Index of the `)` matching the `(` at `open`, by plain depth counting —
 *  correct here because `code` has already had every comment and string/
 *  template body blanked, so no stray paren can hide inside one. */
function matchingCloseParen(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')') { depth--; if (depth === 0) return i; }
  }
  return code.length;
}

/** First non-whitespace character at or after `from`. */
function nextNonWs(code: string, from: number): string {
  let i = from;
  while (i < code.length && /\s/.test(code[i]!)) i++;
  return code[i] ?? '';
}

/** Find every BARE call of `dispatchRun`/`closeRun` — never a METHOD call on
 *  some other receiver (`CoordStore` has its own, unrelated `closeRun`
 *  method, called as `coord.closeRun(...)` from inside `close.ts` itself —
 *  matching only the full, undotted identifier chain keeps that a
 *  non-match), and never a DECLARATION. Declaration vs. call is decided by
 *  what follows the identifier's OWN matching close paren, not by what
 *  precedes the identifier: a declaration's parameter list is followed
 *  (after an optional `: ReturnType`) by the `{` of a body, so the first
 *  non-whitespace character past that close paren is `{` or `:`; a call
 *  expression's is not (`;`, `)`, `,`, …). This is what lets the scanner
 *  reject `CoordStore.closeRun`'s own class-method-shorthand declaration in
 *  `store.ts` (`closeRun(input: {…}): AdvanceResult {`) without an
 *  allowlist — it has no `function` keyword to key off, unlike
 *  `dispatch.ts`'s/`close.ts`'s own `export async function` declarations.
 *
 *  A call site sits inside a `coordMutex.run(...)` call iff one of the
 *  still-open openers above it — tracked with a plain parenthesis stack,
 *  the identifier chain immediately preceding each `(` — is
 *  `coordMutex.run`. */
function scanMutexCallSites(text: string, file: string): Site[] {
  const code = blankCommentsAndStrings(text);
  const lineOf = (i: number): number => code.slice(0, i).split('\n').length;
  const openers: string[] = [];
  const sites: Site[] = [];
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '(') {
      let j = i - 1;
      while (j >= 0 && /\s/.test(code[j]!)) j--;
      let k = j;
      while (k >= 0 && /[A-Za-z0-9_$.]/.test(code[k]!)) k--;
      const head = code.slice(k + 1, j + 1);
      if (TARGETS.has(head)) {
        const nxt = nextNonWs(code, matchingCloseParen(code, i) + 1);
        const isDeclaration = nxt === '{' || nxt === ':';
        if (!isDeclaration) {
          sites.push({
            file, line: lineOf(i), name: head,
            guarded: openers.some((o) => o === GUARD),
          });
        }
      }
      openers.push(head);
    } else if (c === ')') {
      openers.pop();
    }
  }
  return sites;
}

function tsFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (
    e.isDirectory() ? tsFilesUnder(path.join(dir, e.name))
      : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []
  ));
}

const ALL_SITES: Site[] = tsFilesUnder(srcRoot).sort().flatMap(
  (f) => scanMutexCallSites(readFileSync(f, 'utf8'), path.relative(srcRoot, f)),
);
const show = (s: Site): string => `${s.file}:${s.line} ${s.name}`;

// ── The scanner has to be shown to work before its silence means anything ──
describe('the scanner itself', () => {
  it('sees an unguarded call site', () => {
    const src = "export function build() {\n  return dispatchRun(deps, id, brief);\n}\n";
    const [s] = scanMutexCallSites(src, 'f.ts');
    expect(s).toMatchObject({ name: 'dispatchRun', guarded: false });
  });

  it('sees a guarded call site', () => {
    const src = "export function build() {\n"
      + "  return coordMutex.run(() => dispatchRun(deps, id, brief));\n}\n";
    const [s] = scanMutexCallSites(src, 'f.ts');
    expect(s).toMatchObject({ name: 'dispatchRun', guarded: true });
  });

  it('sees closeRun too, and both calls independently in one function', () => {
    const src = "export function build() {\n"
      + "  const a = coordMutex.run(() => dispatchRun(deps, id, brief));\n"
      + "  const b = coordMutex.run(() => closeRun(deps, id, body));\n"
      + "  return [a, b];\n}\n";
    const sites = scanMutexCallSites(src, 'f.ts');
    expect(sites.map((s) => [s.name, s.guarded])).toEqual([['dispatchRun', true], ['closeRun', true]]);
  });

  it('does not treat a NEIGHBOURING guarded call as covering an unguarded one', () => {
    const src = "export function build() {\n"
      + "  const a = coordMutex.run(() => dispatchRun(deps, id, brief));\n"
      + "  const b = closeRun(deps, id, body);\n"
      + "  return [a, b];\n}\n";
    const sites = scanMutexCallSites(src, 'f.ts');
    expect(sites.map((s) => [s.name, s.guarded])).toEqual([['dispatchRun', true], ['closeRun', false]]);
  });

  it('ignores the function DECLARATIONS themselves', () => {
    const src = "export async function dispatchRun(deps, id, brief) {\n  return null;\n}\n"
      + "export async function closeRun(deps, id, body) {\n  return null;\n}\n";
    expect(scanMutexCallSites(src, 'f.ts')).toEqual([]);
  });

  it('ignores a class-method-shorthand declaration with the SAME name and no `function` keyword', () => {
    // The real collision in this tree: CoordStore.closeRun (store.ts) is an
    // unrelated method, declared with a multi-line, nested-object parameter
    // type and a return-type annotation — the shape that broke a
    // preceding-token-only declaration check.
    const src = "class CoordStore {\n"
      + "  closeRun(input: {\n    runId: number; finalState: 'done' | 'failed';\n  }): AdvanceResult {\n"
      + "    return { ok: true };\n  }\n}\n";
    expect(scanMutexCallSites(src, 'f.ts')).toEqual([]);
  });

  it('ignores a call site and a guard that are only mentioned in a comment', () => {
    const src = "/** Do not call dispatchRun(deps, id, brief) here. */\n"
      + "// nor claim coordMutex.run() in prose\nexport const x = 1;\n";
    expect(scanMutexCallSites(src, 'f.ts')).toEqual([]);
  });
});

describe('D-46: dispatchRun/closeRun are never invoked outside CoordMutex', () => {
  it('finds call sites, and every one under server/src sits inside coordMutex.run(...)', () => {
    // A scan that found nothing would pass the assertion below vacuously —
    // require it to have actually found the two real call sites first.
    expect(ALL_SITES.length).toBeGreaterThan(0);
    // EVERY target, not a hand-named two: an entry added to `TARGETS` whose
    // call site the scanner never finds is decoration, and it satisfies the
    // all-guarded assertion below vacuously. Derived from the set itself, so a
    // future target inherits the floor without anyone remembering to add it
    // (self-review: `coord.setCaps` shipped with no such floor).
    for (const t of TARGETS) {
      expect(ALL_SITES.some((s) => s.name === t), `no call site found for target ${t}`).toBe(true);
    }
    expect(ALL_SITES.filter((s) => !s.guarded).map(show)).toEqual([]);
  });
});
