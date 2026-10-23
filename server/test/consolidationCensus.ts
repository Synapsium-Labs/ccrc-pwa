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
import { parsedFile } from './scan/symbols.js';
import { scheduleFacts, type ScheduleFacts } from './scan/parse.js';

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

/** The readers a `runCcd(` result may be handed to whole, each of which reads `ran` FIRST (D-6034, D-6840). */
export const RAN_CARRY_READERS: readonly string[] = [
  'cutShort', 'sweepFailureReason', 'failureDetail', 'classifyAddFailure', 'classifyTitleFailure', 'archiveOutcome',
];

/** `classify` is a generic name: it counts as a carry reader only in the file that defines the one that reads `ran` first. */
export const RAN_CARRY_READERS_BY_FILE: Readonly<Record<string, readonly string[]>> = {
  'server/src/docs/ccdsource.ts': ['classify'],
};

/** How a `runCcd(` site answers the not-ran arm (ARCH-10, #543; the PR lists each site's chosen arm):
 *  - `explicit`: the site reads `ran === false` itself, before any reader of the runner's words;
 *  - `carried`: the site hands the whole result to a reader in `RAN_CARRY_READERS`, which reads `ran` first;
 *  - `ok-only`: the site reads only `ok` (and the stdout of an ok answer, or the runner's `stderr` as a plain failure
 *    sentence). The not-ran arm carries `ok: false`, so `tsc` narrows the ran arm by `ok` itself and the site's failure
 *    path is the one the arm always took: no refusal, box word, die or composition error is read off it. Pinned by
 *    `RAN_TABLE`, never by this file's regexes. */
export type RanArm = 'explicit' | 'carried' | 'ok-only';

/** A `runCcd(` site the census cannot classify by reading the code around it, pinned by its file, its trimmed text and
 *  which of the identical lines in that file it is (`nth`, from 1), so a moved line keeps its row. */
export interface RanTableRow { readonly file: string; readonly text: string; readonly nth: number; readonly arm: RanArm }

/** The reviewed arm of every `runCcd(` site the code around it does not show: an unassigned result, a result handed
 *  to a `queue.run` callback, and every site that reads `ok` only. A site that appears in no row, and shows no narrowing
 *  or carry in the next `RAN_NARROW_WINDOW` code lines, is unaccounted, and the census test fails. */
export const RAN_TABLE: readonly RanTableRow[] = [
  { file: 'server/src/archiveAct.ts', text: 'const res = await ports.runCcd(ports.stopArgv());', nth: 1, arm: 'ok-only' },
  { file: 'server/src/archiveAct.ts', text: 'const archived = await ports.runCcd(archiveArgv);', nth: 1, arm: 'carried' },
  { file: 'server/src/archiveAct.ts', text: 'const res = await ports.runCcd(ports.stopArgv());', nth: 2, arm: 'ok-only' },
  { file: 'server/src/coord/childReclaim.ts', text: 'const res = await deps.runCcd(argv);', nth: 3, arm: 'ok-only' },
  { file: 'server/src/coord/childSpent.ts', text: 'const res = await deps.runCcd(argv);', nth: 1, arm: 'ok-only' },
  { file: 'server/src/coord/close.ts', text: "const done = decideClose({ step: 'fleet', res: await deps.runCcd(verb.argv) });", nth: 1, arm: 'ok-only' },
  { file: 'server/src/coord/close.ts', text: 'const res = await deps.runCcd(argv);', nth: 1, arm: 'ok-only' },
  { file: 'server/src/coord/collectOrphanTree.ts', text: 'try { return parseOrphanCensus((await deps.runCcd(CCD_ARGV.wsOrphanCensus())).stdout); } catch { return { kind: \'unreadable\' }; }', nth: 1, arm: 'ok-only' },
  { file: 'server/src/coord/collectOrphanTree.ts', text: 'try { return parseOrphanAudit((await deps.runCcd(CCD_ARGV.wsOrphanAudit(hex))).stdout, hex); }', nth: 1, arm: 'ok-only' },
  { file: 'server/src/coord/collectOrphanTree.ts', text: 'const r = await deps.runCcd(CCD_ARGV.wsOrphan(spend.token, hex, spend.rescue, sweepDec(deps.fleetState, \'orphan-tree sweep\')));', nth: 1, arm: 'ok-only' },
  { file: 'server/src/coord/dispatch.ts', text: 'const res = await deps.runCcd(argv);', nth: 1, arm: 'ok-only' },
  { file: 'server/src/coord/dispatch.ts', text: 'const res = await deps.runCcd(CCD_ARGV.ensure(sessionId));', nth: 1, arm: 'ok-only' },
  { file: 'server/src/coord/dispatch.ts', text: 'const holdRes = await deps.runCcd(holdArgv);', nth: 1, arm: 'ok-only' },
  { file: 'server/src/coord/dispatch.ts', text: 'const routeRes = await deps.runCcd(', nth: 1, arm: 'ok-only' },
  { file: 'server/src/coord/fingerprint.ts', text: 'const res = await deps.runCcd(argv);', nth: 1, arm: 'ok-only' },
  { file: 'server/src/coord/routes.ts', text: 'const res = await deps.runCcd(argv);', nth: 1, arm: 'ok-only' },
  { file: 'server/src/coord/routes.ts', text: 'const res = await deps.runCcd(argv);', nth: 2, arm: 'ok-only' },
  { file: 'server/src/coord/routes.ts', text: 'const res = await deps.runCcd(argv);', nth: 3, arm: 'ok-only' },
  { file: 'server/src/coord/routes.ts', text: 'const res = await deps.runCcd(CCD_ARGV.reclaimPause(body.state));', nth: 1, arm: 'ok-only' },
  { file: 'server/src/docs/ccdsource.ts', text: 'return { ok: true, res: await deps.runCcd(CCD_ARGV.docsIndex()) };', nth: 1, arm: 'carried' },
  { file: 'server/src/docs/ccdsource.ts', text: 'res: await deps.runCcd(CCD_ARGV.docsTree(call.project, call.ref === null ? null : docsRefText(call.ref))),', nth: 1, arm: 'carried' },
  { file: 'server/src/docs/ccdsource.ts', text: 'res: await deps.runCcd(call.pin.kind === \'committed\'', nth: 1, arm: 'carried' },
  { file: 'server/src/docs/ccdsource.ts', text: 'return { ok: true, res: await deps.runCcd(CCD_ARGV.docsFetch(project, branch)) };', nth: 1, arm: 'carried' },
  { file: 'server/src/server.ts', text: 'const res = await deps.runCcd(argv);', nth: 1, arm: 'ok-only' },
  { file: 'server/src/server.ts', text: 'const res = await deps.runCcd(argv);', nth: 2, arm: 'ok-only' },
  { file: 'server/src/server.ts', text: 'return late !== null ? { refused: late } : { ran: await deps.runCcd(argv) };', nth: 1, arm: 'explicit' },
  { file: 'server/src/server.ts', text: 'const r = await sendDeps.queue.run(id, () => deps.runCcd(argv));', nth: 1, arm: 'ok-only' },
  { file: 'server/src/server.ts', text: 'const r = await sendDeps.queue.run(id, () => deps.runCcd(argv));', nth: 2, arm: 'ok-only' },
  { file: 'server/src/server.ts', text: 'const res = await sendDeps.queue.run(id, () => deps.runCcd(argv));', nth: 1, arm: 'carried' },
  { file: 'server/src/server.ts', text: 'const res = await deps.runCcd(argv);', nth: 4, arm: 'ok-only' },
  { file: 'server/src/server.ts', text: 'const res = await sendDeps.queue.run(id, () => deps.runCcd(argv));', nth: 2, arm: 'explicit' },
  { file: 'server/src/watch.ts', text: 'const res = await this.deps.queue.run(r.id, () => this.deps.runCcd(', nth: 1, arm: 'ok-only' },
  { file: 'server/src/watch.ts', text: 'const res = await this.deps.runCcd(CCD_ARGV.ensure(d.toId));', nth: 1, arm: 'ok-only' },
];

/** One `runCcd(` site and how it answers the not-ran arm; `null` when nothing accounts for it. */
export interface RanSite extends CensusSite { readonly arm: RanArm | null }

/** D-6034, D-6840 (ARCH-10, #543): every `runCcd(` call expression under `server/src`, with how it answers
 *  the not-ran arm. A site is `explicit` when the variable it assigns (`res = await deps.runCcd(...)`, with or without
 *  `const`/`let`) is read as `<name>.ran === false` within the next `RAN_NARROW_WINDOW` code lines, and before a line
 *  that opens with `}` at column 0 (the end of the declaration the call sits in); `carried` when that name is an
 *  argument of a `RAN_CARRY_READERS` call in the same window; otherwise the site's row in `RAN_TABLE`, else `null`.
 *  A line that RETURNS the call's bare result (`return await ...runCcd(`, a pass-through wrapper) folds nothing and is
 *  not a site, nor is a method signature (`runCcd(argv: CcdArgv): ...`). */
export function runCcdSiteArms(root: string = REPO, table: readonly RanTableRow[] = RAN_TABLE): RanSite[] {
  const out: RanSite[] = [];
  for (const f of sourceFiles(root, 'server/src')) {
    const file = path.relative(root, f).split(path.sep).join('/');
    const lines = readFileSync(f, 'utf8').split('\n');
    const seen = new Map<string, number>();
    lines.forEach((text, i) => {
      const code = codeOf(text);
      if (!/\brunCcd\s*\(/.test(code) || /^\s*return\s+(?:await\s+)?[\w.]*\brunCcd\s*\(/.test(code)) return;
      if (/\brunCcd\s*\(\s*\w+\s*:/.test(code)) return;
      const key = text.trim();
      const nth = (seen.get(key) ?? 0) + 1;
      seen.set(key, nth);
      const name = /(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*await\s+[\w.]*\brunCcd\s*\(/.exec(code)?.[1];
      let arm: RanArm | null = null;
      if (name !== undefined) {
        const narrow = new RegExp(`\\b${name}\\.ran\\s*===\\s*false\\b`);
        const carry = new RegExp(`\\b(?:${[...RAN_CARRY_READERS, ...(RAN_CARRY_READERS_BY_FILE[file] ?? [])].join('|')})\\(\\s*${name}\\b`);
        const stderrRead = new RegExp(`\\b${name}\\.stderr\\b`);
        let readStderr = false;
        for (const l of lines.slice(i + 1, i + 1 + RAN_NARROW_WINDOW)) {
          if (/^\}/.test(l)) break;
          const c = codeOf(l);
          // The narrowing must come BEFORE the first read of the runner's words: a `ran === false` after a `.stderr` read is late.
          if (narrow.test(c)) { if (!readStderr) arm = 'explicit'; break; }
          if (stderrRead.test(c)) readStderr = true;
          if (carry.test(c)) { arm = 'carried'; break; }
        }
      }
      arm ??= table.find((r) => r.file === file && r.text === key && r.nth === nth)?.arm ?? null;
      out.push({ file, line: i + 1, text, arm });
    });
  }
  return out;
}

/** The sites nothing accounts for. Step 2 drove this to 0, and `consolidation-census.test.ts` pins it there. */
export function runCcdOldFoldSites(root: string = REPO, table: readonly RanTableRow[] = RAN_TABLE): CensusSite[] {
  return runCcdSiteArms(root, table).filter((s) => s.arm === null).map(({ file, line, text }) => ({ file, line, text }));
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

/**
 * D-5861 (Task C1g; ARCH-76 #811; spec §2.3's change-latch row): the hand-rolled "warn once until it changes" latches of
 * class `cls` in `server/src/watch.ts`. A site is one `last*` field of the class, in one method, that the method (1) compares with
 * `!==` or `===` against a key (not a literal), at most two lines before a `console.warn` (or, for a check-and-set that returns early, on the line before the assignment) and (2) assigns (`this.lastX = …` or
 * `this.lastX.set(…)`) somewhere in the same method. Read from the parsed methods and their `console.warn` calls
 * (`scan/symbols.ts`), one site per field and method, anchored on the comparing line. Exit target (C1g): 0 on
 * `FleetWatcher`; `changeLatchReported` is the same query over `DelegationLane`, held by another series, reported by name.
 * KNOWN WIDTH: a warn written on a `catch` line is not a latch's sentence; a latch whose comparison and assignment sit on different lines of one statement is seen on its comparing
 * line; a set latch (`lastInventoryIssues`, a `.has(`), a flag re-armed on success and a field not named `last*` are
 * other shapes and are not seen.
 */
/** How many lines after the comparison its `console.warn` may sit. */
const LATCH_WARN_WINDOW = 2;

function changeLatchSitesOf(cls: string, root: string): CensusSite[] {
  const file = path.join(root, 'server/src/watch.ts');
  if (!existsSync(file)) return [];
  const parsed = parsedFile(file);
  const lines = parsed.text.split('\n');
  const out: CensusSite[] = [];
  for (const m of parsed.symbols) {
    if (m.kind !== 'method' || !m.name.startsWith(`${cls}.`)) continue;
    const warns = parsed.calls.filter((c) => c.head === 'console' && c.name === 'warn' && c.start >= m.start && c.end <= m.end)
      .map((c) => c.line)
      // A warn on a `catch` line reports a failure, not a standing cause: an hourly retry beside it is a throttle.
      .filter((ln) => !/\bcatch\b/.test(lines[ln - 1] ?? ''));
    if (warns.length === 0) continue;
    const LITERAL = /^(?:null|undefined|true|false)$/;
    const compared = new Map<string, number>();
    const assigned = new Set<string>();
    for (let ln = m.line; ln <= m.endLine; ln++) {
      const code = codeOf(lines[ln - 1] ?? '');
      const hits: string[] = [];
      // A key against the field, either way round; a literal operand (`!== 0`, `=== null`, `!== 'busy'`) is a throttle
      // or a state test, never a key.
      for (const c of code.matchAll(/([A-Za-z_$][\w$.]*)\s*(?:!==|===)\s*this\.(last\w+)\b/g)) if (!LITERAL.test(c[1]!)) hits.push(c[2]!);
      for (const c of code.matchAll(/this\.(last\w+)(?:\.get\([^)]*\))?\s*(?:!==|===)\s*([A-Za-z_$][\w$.]*)/g)) if (!LITERAL.test(c[2]!)) hits.push(c[1]!);
      // The sentence follows the comparison within a line or two, or the comparison's very next line records the key (a
      // check-and-set that returns early) and the sentence comes later in the method. A day or hour throttle that has a
      // warn somewhere else in its body is neither.
      const next = codeOf(lines[ln] ?? '');
      const near = warns.some((w) => w >= ln && w <= ln + LATCH_WARN_WINDOW);
      const checkAndSet = (f: string): boolean => new RegExp(`this\\.${f}\\s*=(?!=)`).test(next) && warns.some((w) => w > ln);
      for (const f of hits) if (!compared.has(f) && (near || checkAndSet(f))) compared.set(f, ln);
      for (const a of code.matchAll(/this\.(last\w+)(?:\s*=(?!=)|\.set\()/g)) assigned.add(a[1]!);
    }
    for (const [f, ln] of compared) {
      if (assigned.has(f)) out.push({ file: 'server/src/watch.ts', line: ln, text: lines[ln - 1]! });
    }
  }
  return out;
}

/** `FleetWatcher`'s hand-rolled change latches (D-5861): 6 on `60866e4ed`, 0 once C1g has moved them. */
export function changeLatchSites(root: string = REPO): CensusSite[] {
  return changeLatchSitesOf('FleetWatcher', root);
}

/** The same query over `DelegationLane` (`#lastMarkWarnHour`), reported by name and never ratcheted while another
 *  series holds that class; it becomes a latch in the first PR after that series has merged or closed (D-5861). */
export function changeLatchReported(root: string = REPO): CensusSite[] {
  return changeLatchSitesOf('DelegationLane', root);
}

/**
 * D-5867 (Task C1l; ARCH-66 (#801); spec K7, §2.3's redaction row): the JS/TS modules that spell redaction rule
 * patterns of their own, as repo-relative file names, sorted. `shared/redact.mjs`, the one rule table, is counted: the
 * exit is that it is the only one (3 before this series, 2 after PR 1, 1 after PR 2). A file is a rule table when its
 * code lines hold a mask word (`[REDACTED]`, `[redacted]`, `REDACTED_MARK` or the docs `***`) and at least two of the
 * three shapes every table spells: a `Bearer` pattern, an `Authorization` header pattern and a `token=` query pattern (also as the alternation
 * `(?:access_token|token)=`).
 * Code lines only (`codeOf`), so a comment that names a shape does not count. KNOWN WIDTH: a table that spells none of
 * the three shapes is not seen; the session masker (`accounts/mask.ts`) masks known keys by their exact bytes and is
 * not a table.
 */
export function redactRuleTables(root: string = REPO): string[] {
  const out: string[] = [];
  for (const dir of ['shared', 'server/src', 'agent/src', 'pwa/src', 'ccd/history']) {
    for (const f of sourceFiles(root, dir)) {
      const code = readFileSync(f, 'utf8').split('\n').map(codeOf).join('\n');
      const mask = /\[REDACTED\]|\[redacted\]|\bREDACTED_MARK\b|'\*\*\*'|\*\*\*@/.test(code);
      const shapes = [/\bBearer\b/, /\bAuthorization\b/, /token\)?=/i].filter((re) => re.test(code)).length;
      if (mask && shapes >= 2) out.push(path.relative(root, f).split(path.sep).join('/'));
    }
  }
  return out.sort();
}

/**
 * D-5862 (Task C1h; ARCH-68 #803; spec K11, §2.3's clock row): the watcher's lane schedule, four queries over
 * `server/src/watch.ts`, read from its syntax tree (`scan/parse.ts`'s `scheduleFacts`, the one parser importer), never from a
 * count typed by hand. Exit targets (C1h): `laneClockFields` and `laneClockShapes` list only W4's two clocks (and
 * `DelegationLane#lastSweepAt`, reported, while another series holds that class); `singleFlightGuards` lists only
 * `ticking`, `dispatchRun` and `dispatchAgain`, and W4's two; `cadenceLiterals` is empty.
 * KNOWN WIDTH: a clock or guard reached through a computed name, a field of another class and a literal assembled from
 * pieces (`60 * 1000`, which is read, but `MINUTE * 5` is not a literal) are other shapes; a cadence compared through
 * a local alias (`const gap = now - this.lastX; if (gap < 5000)`) is not seen.
 */

/** The fields that were a lane's throttle clock on `a8a5b9f56`, by name: 25 in `FleetWatcher` (23 on `Date.now()`, 2 on
 *  the monotonic clock) and W4's two, which a later series moves. */
export const LANE_CLOCK_NAMES: readonly string[] = [
  'lastCapsAt', 'lastCatalogueAt', 'lastInventoryAt', 'lastServerCapsAt',
  'lastTaskSweep', 'lastUsageSweep', 'lastPrSweep', 'lastNameSweep', 'lastDivergenceSweep', 'lastLifecycleSweep',
  'lastReadinessSweep', 'lastLedgerReconcile', 'lastLedgerFloor',
  'lastClaimRenew', 'lastClaimLapse', 'lastStallSweep', 'lastIdleNudgeAt', 'lastMailSweep', 'lastAskSweep',
  'lastApprovalPrune', 'lastDigestBeat',
  'lastChildReclaimSweep', 'lastCollectSweep', 'lastArchivedExpirySweep', 'lastDeadCoordinatorSweep',
  'lastStopDoneSweep', 'lastHibernateSweep',
];

/** The fields that were a lane's single-flight guard on `a8a5b9f56` (the stuck-run stamp, the booleans, the promises and
 *  the one queued rerun), by name. */
export const SINGLE_FLIGHT_NAMES: readonly string[] = [
  'ticking', 'collectSweeping', 'stallSweepRunning', 'idleNudgeRunning', 'archivedExpirySweeping', 'stopDoneSweeping',
  'hibernateSweeping', 'deadCoordinatorSweeping', 'serverCapsRun', 'deadCoordinatorPassRun', 'inventoryRun',
  'inventoryRerunPending', 'dispatchRun', 'dispatchAgain', 'prSweepStartedAt',
];

/** The facts of `server/src/watch.ts` (or a fixture's), with the file's lines; `null` when the tree has none. */
function watcherFacts(root: string, rel = 'server/src/watch.ts'): { facts: ScheduleFacts; lines: string[]; file: string } | null {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) return null;
  const parsed = parsedFile(abs);
  return { facts: scheduleFacts(parsed), lines: parsed.text.split('\n'), file: rel };
}

const siteAt = (w: { lines: string[]; file: string }, line: number): CensusSite => ({ file: w.file, line, text: w.lines[line - 1] ?? '' });

/** The named lane clocks (`LANE_CLOCK_NAMES`) still declared as fields of `FleetWatcher`. */
export function laneClockFields(root: string = REPO): CensusSite[] {
  const w = watcherFacts(root);
  return w === null ? [] : w.facts.fields.filter((f) => f.cls === 'FleetWatcher' && LANE_CLOCK_NAMES.includes(f.name)).map((f) => siteAt(w, f.line));
}

/** `DelegationLane#lastSweepAt`, a cadence clock in a class another series holds: reported by name, never ratcheted. */
export function laneClockReported(root: string = REPO): CensusSite[] {
  const w = watcherFacts(root);
  return w === null ? [] : w.facts.fields.filter((f) => f.cls === 'DelegationLane' && f.name === 'lastSweepAt').map((f) => siteAt(w, f.line));
}

/** Numeric fields of `FleetWatcher` that are compared with a constant and are NOT a lane's throttle: `lastStallJudgedAt` is
 *  the stall watch's gap rule (slug `stall-clocks-drop-on-an-unobserved-gap`, D-3750), a state test on how long the watch
 *  went unobserved, which decides whether to drop its clocks and does not decide whether a lane runs. */
export const LANE_CLOCK_SHAPE_EXEMPT: readonly string[] = ['lastStallJudgedAt'];

/** The structural query: a numeric field of `FleetWatcher` (bar `LANE_CLOCK_SHAPE_EXEMPT`) compared as
 *  `<now> - this.X <op> CONST` (`<`, `<=`, `>`, `>=`), CONST an UPPER_CASE name, a numeric literal or a product of those. So a
 *  new, unnamed clock is caught. */
export function laneClockShapes(root: string = REPO): CensusSite[] {
  const w = watcherFacts(root);
  if (w === null) return [];
  const numeric = new Set(w.facts.fields.filter((f) => f.cls === 'FleetWatcher' && f.numeric && !LANE_CLOCK_SHAPE_EXEMPT.includes(f.name)).map((f) => f.name));
  return w.facts.comparisons.filter((c) => c.cls === 'FleetWatcher' && numeric.has(c.field) && c.other !== 'other').map((c) => siteAt(w, c.line));
}

/** The single-flight guards (`SINGLE_FLIGHT_NAMES`) still declared as fields of `FleetWatcher`. */
export function singleFlightGuards(root: string = REPO): CensusSite[] {
  const w = watcherFacts(root);
  return w === null ? [] : w.facts.fields.filter((f) => f.cls === 'FleetWatcher' && SINGLE_FLIGHT_NAMES.includes(f.name)).map((f) => siteAt(w, f.line));
}

/** A bare millisecond literal (a numeric literal of 1000 or more, `60_000`, or a product with one, `60 * 1000`) compared
 *  against a `last…` clock: `<now> - this.last… <op> LITERAL`. A cadence is a row of `LANE_SCHEDULE`. */
export function cadenceLiterals(root: string = REPO): CensusSite[] {
  const w = watcherFacts(root);
  return w === null ? [] : w.facts.comparisons.filter((c) => c.field.startsWith('last') && c.literalMs).map((c) => siteAt(w, c.line));
}

/** The three cadences the spec declares as derivations, each `export const NAME = OTHER;` where it lives (`laneSchedule.ts`
 *  or `watch.ts`): `reference` is true when the declaration's initializer is a bare name, false when it is a literal or an
 *  expression, and `file` is null when no declaration is found. A derivation is a reference, never a second literal. */
export const DECLARED_DERIVATIONS: readonly string[] = ['COLLECT_OBSERVE_INTERVAL_MS', 'STALL_SWEEP_MS', 'DELEGATION_SWEEP_MS'];

export function declaredDerivations(root: string = REPO): Array<{ name: string; file: string | null; reference: boolean }> {
  const found = new Map<string, { file: string; reference: boolean }>();
  for (const rel of ['server/src/laneSchedule.ts', 'server/src/watch.ts']) {
    const w = watcherFacts(root, rel);
    if (w === null) continue;
    for (const c of w.facts.constants) if (DECLARED_DERIVATIONS.includes(c.name)) found.set(c.name, { file: rel, reference: c.reference });
  }
  return DECLARED_DERIVATIONS.map((name) => ({ name, file: found.get(name)?.file ?? null, reference: found.get(name)?.reference ?? false }));
}
