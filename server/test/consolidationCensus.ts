// The consolidation wave's census module (D-5849; ARCH-40 (#775); spec 2026-10-19 §5.1 rule 3). Every count a wave's
// exit or a PR body quotes comes from one of these NAMED queries, run on the PR's tip, never typed. Each query returns
// the sites it found (`{ file, line, text }`), so a count is the list's length and a PR body can print the list.
// `consolidation-census.test.ts` holds each query against a fixture tree and finds its cited site on the real one.
// No count is pinned here: a census reports until its series reaches its target, and the may-only-shrink pin lands in
// the commit that reaches it (spec §5.1 rule 3, rev 2).
//
// KNOWN WIDTH, every query: comments are dropped LINE by line. A line whose first token is `//`, `*` or `/*` is prose,
// and a trailing `// …` on a code line is cut. A line inside a block comment that does not start with `*`, and a call
// assembled from pieces, are not seen.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CCD } from './ccdWsHelpers.js';

/** The repository root: every query's default tree. A fixture tree passes its own root in its place. */
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** One site a query found: the repo-relative file, the 1-based line and the line's text as written. */
export interface CensusSite { readonly file: string; readonly line: number; readonly text: string }

/** Every `.ts`/`.tsx`/`.mjs` file under `root/dir`, sorted; declaration files and `__`-prefixed transient mutants
 *  (the `boot.test.ts` precedent in `single-definition.test.ts`'s `sources`) are skipped. */
function sourceFiles(root: string, dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d).sort()) {
      if (e.startsWith('__') || e === 'node_modules') continue;
      const p = path.join(d, e);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (/\.(?:tsx?|mjs)$/.test(e) && !/\.d\.[mc]?ts$/.test(e)) out.push(p);
    }
  };
  walk(path.join(root, dir));
  return out;
}

/** A line as code: `''` for a comment line, and a trailing `// …` cut (a `//` after `:` or a quote is a URL or a
 *  string, and stays). Line numbers are kept, because the caller indexes by them. */
export function codeOf(line: string): string {
  if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return '';
  return line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1');
}

/** Every match of `re` (global) on a code line of each file under `dirs`, one site per match. */
function sitesOf(root: string, dirs: readonly string[], re: RegExp, skip: (rel: string) => boolean = () => false): CensusSite[] {
  const out: CensusSite[] = [];
  for (const dir of dirs) {
    for (const f of sourceFiles(root, dir)) {
      const file = path.relative(root, f).split(path.sep).join('/');
      if (skip(file)) continue;
      readFileSync(f, 'utf8').split('\n').forEach((text, i) => {
        for (const _ of codeOf(text).matchAll(re)) out.push({ file, line: i + 1, text });
      });
    }
  }
  return out;
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `recordFeedEvent(` call expressions under `server/src`, outside `coord/store.ts` (which defines the door and may
 *  call itself). A method SIGNATURE (`recordFeedEvent(epoch: number, …)` opening a line) is a declaration, not a call.
 *  16 on `f64c27b65`. The feed's writer set is NOT pinned here; C1e lands it (D-5849). */
export function feedRecordCallSites(root: string = REPO): CensusSite[] {
  return sitesOf(root, ['server/src'], /\brecordFeedEvent\s*\(/g, (f) => f === 'server/src/coord/store.ts')
    .filter((s) => !/^\s*(?:(?:public|private|protected|async)\s+)*recordFeedEvent\s*\([^)]*:/.test(s.text));
}

/** `includes(RECLAIM_PAUSE_MARKER)` expressions under `server/src`: the private parsers of the pause switch. Files
 *  that merely NAME the marker (an import, a sentence template, a comment) are not parsers; `filesNaming` counts
 *  those. 10 expressions in 6 files on `f64c27b65`, against 12 files naming it. */
export function reclaimPauseParseSites(root: string = REPO): CensusSite[] {
  return sitesOf(root, ['server/src'], /\bincludes\(\s*RECLAIM_PAUSE_MARKER\s*\)/g);
}

/** `const <X> = '<name>'` (either quote, optionally typed, optionally exported) under `server/src` and `shared/`:
 *  the definitions of one marker literal. `mail-disabled`: 2 on `f64c27b65` (`coord/rundefs.ts`, exported;
 *  `watch.ts`, private). */
export function markerDefinitions(name: string, root: string = REPO): CensusSite[] {
  const re = new RegExp(`\\bconst\\s+[A-Za-z_$][\\w$]*\\s*(?::[^=]+)?=\\s*(['"])${esc(name)}\\1`, 'g');
  return sitesOf(root, ['server/src', 'shared'], re);
}

// ── ccd's function-to-context manifest (D-6054; ARCH-34 (#536)) ──────────────────────────────────────────────────
// `ccd/contexts.tsv` maps every function `ccd/ccd` defines to one context of the 08-10 spec (C1 to C9, or K). These
// queries read the launcher and the manifest; `ccd-contexts.test.ts` holds coverage and ratchets the cross-context
// count. KNOWN WIDTH, the call graph: a function's REGION runs from its definition to its first column-0 `}`, or to
// the next definition when it closes on an indented line (a one-liner, or a `{ …; }` continued below it). A REFERENCE
// is a defined name as a whole word on a code line of a region other than its own: a `#` comment line is dropped and
// a trailing ` # …` is cut, a `$name`/`${name` expansion and a `name=` assignment are variables, and a name inside a
// quoted message counts. One edge per (caller, callee) pair, at the caller's first reference.
// A column-0 `}` inside a heredoc body would end a region early and hide the calls after it: `ccdHeredocBraces`
// lists any such line, and the test's CONTROL holds that list empty.

/** The contexts a manifest row may name: the 08-10 spec's nine and K (kernels and platform, no aggregate). */
export const CCD_CONTEXTS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'K'] as const;
export type CcdContext = (typeof CCD_CONTEXTS)[number];

/** The launcher under `root`: `ccdWsHelpers.ts`'s `CCD`, the one spelling of its path, re-rooted for a fixture tree. */
export function ccdLauncherIn(root: string = REPO): string {
  return path.join(root, path.relative(REPO, CCD));
}

/** A definition `ccd/ccd` writes: a function name at column 0, `()`, optional spaces, `{`. */
export const CCD_FUNCTION_DEF = /^([A-Za-z_][A-Za-z0-9_]*)\(\) *\{/;

/** ccd's function definitions, one site per `name() {` line of `ccd/ccd` (the site's `text` is the line). */
export function ccdFunctionDefinitions(root: string = REPO): CensusSite[] {
  const out: CensusSite[] = [];
  readFileSync(ccdLauncherIn(root), 'utf8').split('\n').forEach((text, i) => {
    if (CCD_FUNCTION_DEF.test(text)) out.push({ file: 'ccd/ccd', line: i + 1, text });
  });
  return out;
}

/** The manifest's rows, one site per non-comment, non-blank line of `ccd/contexts.tsv` (`text` is the line). No
 *  manifest is no rows, so coverage lists every function rather than throwing. */
export function ccdContextRows(root: string = REPO): CensusSite[] {
  const out: CensusSite[] = [];
  const file = path.join(root, 'ccd', 'contexts.tsv');
  if (!existsSync(file)) return out;
  readFileSync(file, 'utf8').split('\n').forEach((text, i) => {
    if (text.trim() !== '' && !text.startsWith('#')) out.push({ file: 'ccd/contexts.tsv', line: i + 1, text });
  });
  return out;
}

/** A bash line as code: `''` for a comment line; a trailing ` # …` (a `#` after whitespace) cut. */
export function bashCodeOf(line: string): string {
  if (/^\s*#/.test(line)) return '';
  return line.replace(/\s#(?:\s.*)?$/, '');
}

/** One edge of ccd's call graph: `caller`'s region names `callee` first at `line` (1-based, in `ccd/ccd`). */
export interface CcdCallEdge { readonly caller: string; readonly callee: string; readonly line: number }

/** ccd's call graph: one edge per (caller, callee) pair, in definition order, then by first reference. */
export function ccdCallGraph(root: string = REPO): CcdCallEdge[] {
  const lines = readFileSync(ccdLauncherIn(root), 'utf8').split('\n');
  const defs: { name: string; at: number }[] = [];
  lines.forEach((l, i) => { const m = CCD_FUNCTION_DEF.exec(l); if (m) defs.push({ name: m[1]!, at: i }); });
  const names = new Set(defs.map((d) => d.name));
  const word = /(?<![A-Za-z0-9_$])(\$\{?)?([A-Za-z_][A-Za-z0-9_]*)(?![A-Za-z0-9_])(\+?=|\[)?/g;
  const out: CcdCallEdge[] = [];
  defs.forEach((d, k) => {
    const next = k + 1 < defs.length ? defs[k + 1]!.at : lines.length;
    let end = next;
    for (let j = d.at + 1; j < next; j++) if (lines[j]!.startsWith('}')) { end = j; break; }
    const seen = new Set<string>();
    for (let j = d.at; j < end; j++) {
      const code = j === d.at ? bashCodeOf(lines[j]!).replace(CCD_FUNCTION_DEF, '') : bashCodeOf(lines[j]!);
      for (const m of code.matchAll(word)) {
        const callee = m[2]!;
        if (m[1] !== undefined || m[3] !== undefined || callee === d.name || !names.has(callee) || seen.has(callee)) continue;
        seen.add(callee);
        out.push({ caller: d.name, callee, line: j + 1 });
      }
    }
  });
  return out;
}

/** The region rule's blind spot, made visible: a column-0 `}` inside a heredoc body opened in a function's region
 *  would end that region early, and every call after it would leave the graph (and the ratchet). One site per such
 *  line. A heredoc opens at `<<WORD`, `<<-WORD` or a quoted WORD on a code line (`<<<` is a here-string, not one) and
 *  closes at the line that is WORD (after leading tabs for `<<-`); one that never closes is a site too. */
export function ccdHeredocBraces(root: string = REPO): CensusSite[] {
  const lines = readFileSync(ccdLauncherIn(root), 'utf8').split('\n');
  const open = /(?<!<)<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/g;
  const out: CensusSite[] = [];
  let inFn = false;
  const pending: { word: string; tabs: boolean; at: number }[] = [];
  lines.forEach((text, i) => {
    if (pending.length > 0) {
      const h = pending[0]!;
      if ((h.tabs ? text.replace(/^\t+/, '') : text) === h.word) pending.shift();
      else if (inFn && text.startsWith('}')) out.push({ file: 'ccd/ccd', line: i + 1, text });
      return;
    }
    if (CCD_FUNCTION_DEF.test(text)) inFn = true;
    else if (text.startsWith('}')) inFn = false;
    if (!inFn) return;
    for (const m of bashCodeOf(text).matchAll(open)) pending.push({ word: m[3]!, tabs: m[1] === '-', at: i + 1 });
  });
  // A heredoc that never closes means this reader misparsed one; say so rather than read nothing after it.
  for (const h of pending) out.push({ file: 'ccd/ccd', line: h.at, text: `<<${h.word} never closes` });
  return out;
}

/** Cross-context references: edges whose two ends sit in different contexts by `ccd/contexts.tsv`, a call INTO K
 *  excepted (a kernel serves every context; a call OUT of K counts). One site per edge, at the reference's line,
 *  `text` = `caller (Cx) -> callee (Cy)`. An edge whose end has no row is skipped: coverage is the test's job. */
export function ccdCrossContextCalls(root: string = REPO): CensusSite[] {
  const ctx = new Map(ccdContextRows(root).map((r) => { const [n, c] = r.text.split('\t'); return [n!, c!] as const; }));
  return ccdCallGraph(root).flatMap((e) => {
    const a = ctx.get(e.caller); const b = ctx.get(e.callee);
    if (a === undefined || b === undefined || a === b || b === 'K') return [];
    return [{ file: 'ccd/ccd', line: e.line, text: `${e.caller} (${a}) -> ${e.callee} (${b})` }];
  });
}

/** The `$REG` marker vocabulary: the kebab-case values of every `const <X>_MARKER = '<name>'` on a code line under
 *  `server/src` and `shared/`. KNOWN WIDTH: a marker named outside a `_MARKER` constant (the stall watch's map keys)
 *  is not in it. */
function markerVocabulary(root: string): string[] {
  const re = /\bconst\s+[A-Z0-9_]*_MARKER\s*(?::[^=]+)?=\s*(['"])([a-z][a-z0-9-]*)\1/g;
  const names = new Set<string>();
  for (const s of sitesOf(root, ['server/src', 'shared'], re)) {
    for (const m of codeOf(s.text).matchAll(re)) names.add(m[2]!);
  }
  return [...names].sort();
}

/** Quoted marker-name literals (`'<name>'`, `"<name>"` or `` `<name>` ``, the whole name) on code lines under
 *  `server/src`, ONE SITE PER LITERAL (not per file, despite the name; group by `file` for files). Recorded; it gates
 *  nothing yet. NARROWER than the spec's "46 marker-name literals in server/src": the vocabulary is only the names a
 *  `const *_MARKER = '…'` defines (`markerVocabulary`), not the wider `$REG` vocabulary the spec counted (swap, usage,
 *  pool-epoch, tmproots and the other switches), so whoever first quotes this census records that gap (D-5849). */
export function markerLiteralFiles(root: string = REPO): CensusSite[] {
  const vocab = markerVocabulary(root);
  if (vocab.length === 0) return [];
  const re = new RegExp(`(['"\`])(?:${vocab.map(esc).join('|')})\\1`, 'g');
  return sitesOf(root, ['server/src'], re);
}

/** Files under `server/src` that name any of `needles` on ANY line, comments included: the "files that name it"
 *  count a parse census is told apart from. */
export function filesNaming(needles: readonly string[], root: string = REPO): string[] {
  return sourceFiles(root, 'server/src')
    .filter((f) => { const t = readFileSync(f, 'utf8'); return needles.some((n) => t.includes(n)); })
    .map((f) => path.relative(root, f).split(path.sep).join('/'))
    .sort();
}

/** How many code lines after a `runCcd(` call `runCcdOldFoldSites` reads for the call's `ran` narrowing. */
export const RAN_NARROW_WINDOW = 12;

/** D-6034 (ARCH-10, #543): `runCcd(` call expressions under `server/src` still on the OLD fold, which reads `ok` or a
 *  runner's forged code without first asking whether the command ran. A site is on the new fold when the variable it
 *  assigns (`res = await deps.runCcd(…)`, with or without `const`/`let`) is read as `<name>.ran === false` within the
 *  next `RAN_NARROW_WINDOW` code lines, and before a line that opens with `}` at column 0 (the end of the top-level
 *  declaration the call sits in). A line that RETURNS the call's bare result (`return await …runCcd(`, a pass-through
 *  wrapper) folds nothing, and is not a site. Step 2 drives this to 0, and its may-only-shrink pin lands then (spec
 *  §5.1 rule 3). KNOWN WIDTH: a narrowing further down, or in a function the result is handed to, is not seen, and the
 *  site is counted; so is a call whose result is not assigned to a name. */
export function runCcdOldFoldSites(root: string = REPO): CensusSite[] {
  const out: CensusSite[] = [];
  for (const f of sourceFiles(root, 'server/src')) {
    const file = path.relative(root, f).split(path.sep).join('/');
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((text, i) => {
      const code = codeOf(text);
      if (!/\brunCcd\s*\(/.test(code) || /^\s*return\s+(?:await\s+)?[\w.]*\brunCcd\s*\(/.test(code)) return;
      const name = /(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*await\s+[\w.]*\brunCcd\s*\(/.exec(code)?.[1];
      if (name !== undefined) {
        const narrow = new RegExp(`\\b${name}\\.ran\\s*===\\s*false\\b`);
        for (const l of lines.slice(i + 1, i + 1 + RAN_NARROW_WINDOW)) {
          if (/^\}/.test(l)) break;
          if (narrow.test(codeOf(l))) return;
        }
      }
      out.push({ file, line: i + 1, text });
    });
  }
  return out;
}

/** D-5866 (Task C1k; ARCH-71 #806): the W4 files W1b never edits. Their capability sites are reported, tagged
 *  `w4-held`, and W4 moves them. */
export const W4_HELD_FILES: readonly string[] = ['server/src/hibernateSweep.ts', 'server/src/stopDoneSweep.ts'];

/** What a capability site asks. `verb`: whether this box's ccd can run a `CCD_ARGV` row (every `ccdCan(` and every
 *  `verbSupported(`, and a `capSupported(` of some `CCD_CAN` row's token). `verb-precondition`: a `capSupported(` on
 *  a line that also asks `ccdCan(` of another row (the pause marker the collector needs beside its own token). `flag`:
 *  any other token, which an existing verb parses. `w4-held`: any site in `W4_HELD_FILES`. */
export type CapabilityTag = 'verb' | 'verb-precondition' | 'flag' | 'w4-held';

/** One capability site: where, in which form, the token it names (`null` for `verbSupported`, or an expression this
 *  census does not resolve), and its tag. */
export interface CapabilitySite extends CensusSite {
  readonly form: 'verbSupported' | 'capSupported' | 'ccdCan';
  readonly token: string | null;
  readonly tag: CapabilityTag;
}

/** The text of a call's second argument, from just after its `(` on one line; `null` when the call does not close on
 *  that line or has no second argument. */
function secondArg(code: string, open: number): string | null {
  let depth = 1; let comma = -1;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return comma < 0 ? null : code.slice(comma + 1, i).trim();
    } else if (c === ',' && depth === 1 && comma < 0) comma = i;
  }
  return null;
}

/**
 * D-5866 (Task C1k; ARCH-71 #806; spec §5.1 rule 3): every `verbSupported(`, `capSupported(` and `ccdCan(` call under
 * `server/src`, outside `ccdargv.ts` (which defines them), each tagged. THE TAG IS READ FROM `CCD_CAN`, never from a
 * list: a `capSupported(` token is resolved through `ccdargv.ts`'s own exports (an exported constant's value, or a
 * quoted literal), and is `verb` when it is some row's token. Exit target: no `verb`-tagged `verbSupported(` or
 * `capSupported(` outside `W4_HELD_FILES` (every verb question goes through `ccdCan`).
 * KNOWN WIDTH: "beside" is the same code line; a call whose arguments wrap onto the next line resolves no token, and
 * its tag is `flag` unless its form says otherwise.
 */
export async function capabilityChoiceSites(root: string = REPO): Promise<CapabilitySite[]> {
  const argv = await import('../src/ccdargv.js') as unknown as Record<string, unknown> & {
    CCD_CAN: Record<string, { readonly token: string } | 'none'>;
  };
  const rowTokens = new Set(Object.values(argv.CCD_CAN).flatMap((r) => (r === 'none' ? [] : [r.token])));
  const tokenOf = (expr: string | null): string | null => {
    if (expr === null) return null;
    const quoted = /^(['"])([^'"]*)\1$/.exec(expr);
    if (quoted) return quoted[2]!;
    const v = /^[A-Z_][A-Z0-9_]*$/.test(expr) ? argv[expr] : undefined;
    return typeof v === 'string' ? v : null;
  };
  const out: CapabilitySite[] = [];
  for (const f of sourceFiles(root, 'server/src')) {
    const file = path.relative(root, f).split(path.sep).join('/');
    if (file === 'server/src/ccdargv.ts') continue;
    readFileSync(f, 'utf8').split('\n').forEach((text, i) => {
      const code = codeOf(text);
      for (const m of code.matchAll(/\b(verbSupported|capSupported|ccdCan)\s*\(/g)) {
        const form = m[1] as CapabilitySite['form'];
        const token = form === 'capSupported' ? tokenOf(secondArg(code, m.index! + m[0].length)) : null;
        const beside = form === 'capSupported' && /\bccdCan\s*\(/.test(code);
        const tag: CapabilityTag = W4_HELD_FILES.includes(file) ? 'w4-held'
          : form !== 'capSupported' ? 'verb'
            : beside ? 'verb-precondition'
              : token !== null && rowTokens.has(token) ? 'verb' : 'flag';
        out.push({ file, line: i + 1, text, form, token, tag });
      }
    });
  }
  return out;
}
