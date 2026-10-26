// The consolidation wave's census module (D-5849; ARCH-40 (#775); spec 2026-10-19 §5.1 rule 3). Every count a wave's
// exit or a PR body quotes comes from one of these NAMED queries, run on the PR's tip, never typed. Each query returns
// the sites it found (`{ file, line, text }`), so a count is the list's length and a PR body can print the list.
// `consolidation-census.test.ts` holds each query against a fixture tree and finds its cited site on the real one.
// A count is pinned only once its series reaches its target: a census reports until then, and the may-only-shrink pin
// lands in the commit that reaches it (spec §5.1 rule 3, rev 2).
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
 * count typed by hand. Exit targets (C1h): `laneClockFields` and `laneClockShapes` list only W4's two clocks
 * (`DelegationLane#lastSweepAt` became the `delegation` row, so `laneClockReported` lists nothing); `singleFlightGuards` lists only
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

/** `DelegationLane#lastSweepAt`, a cadence clock in a class another series held: reported by name, and empty since it became the `delegation` row (D-5862). */
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

/**
 * D-5864 (Task C1j; ARCH-51 #786; spec K13's listing half): every place `server/src/watch.ts` lists the registry, from its
 * syntax tree (`scan/symbols.ts`, over `scan/parse.ts`), never from a count typed by hand. A site is a call of `readRegistry(`
 * or `readRegistryMeasured(`, or of a `readdir(` whose first argument names `registryDir`, inside a method of the class.
 * Each is tagged by the method it sits in:
 * - `selection`: it chooses rows for a lane. Exit target (C1j): exactly one, in `FleetWatcher.tick`; the lanes take the
 *   tick's `FleetReadModel`.
 * - `act`: it is read at the act and stays fresh, by name (`ACT_LISTING_METHODS`): the mail lane's last switch read
 *   before it delivers, and the divergence census's listing, taken after git's records on purpose; and the tick's own bare
 *   `readdir`, the snapshot write's re-confirmation when the fleet shrank.
 * - `tests-only`: a lane's own read when called with no model, reached by tests alone (`TESTS_ONLY_LISTING_METHODS`);
 *   the registry-refused census pins that `tick()` hands each lane its model.
 * A method not named in either list is `selection`, so a new lane that lists for itself is counted as one.
 * KNOWN WIDTH: `assembleFleet`'s marker listing inside `readLimits` (`limits.ts`) is another file's, reported in the PR body
 * and left to the request-time readers' work (ARCH-52, W2); a listing reached through an alias, a helper or a `readdir`
 * whose argument is a local that holds `registryDir` is not seen.
 */
export const ACT_LISTING_METHODS: readonly string[] = ['FleetWatcher.mailPass', 'FleetWatcher.divergencesPass'];
export const TESTS_ONLY_LISTING_METHODS: readonly string[] = ['FleetWatcher.fleetFor', 'FleetWatcher.sweepHookStates', 'FleetWatcher.detectDialogs'];
export const SELECTION_LISTING_METHOD = 'FleetWatcher.tick';

export type ListingTag = 'selection' | 'act' | 'tests-only';
export interface RegistryListingSite extends CensusSite { readonly method: string; readonly tag: ListingTag }

export function registryListingSites(root: string = REPO): RegistryListingSite[] {
  const file = path.join(root, 'server/src/watch.ts');
  if (!existsSync(file)) return [];
  const parsed = parsedFile(file);
  const lines = parsed.text.split('\n');
  const out: RegistryListingSite[] = [];
  for (const c of parsed.calls) {
    const isReader = c.name === 'readRegistry' || c.name === 'readRegistryMeasured';
    const isListing = c.name === 'readdir' && (c.args[0]?.text ?? '').includes('registryDir');
    if (!isReader && !isListing) continue;
    const inner = parsed.symbols.filter((s) => s.kind === 'method' && s.name.startsWith('FleetWatcher.') && s.start <= c.start && c.end <= s.end)
      .sort((a, b) => b.start - a.start)[0];
    if (inner === undefined) continue;
    // The tick's own bare `readdir(registryDir)` is the snapshot write's shrink re-confirmation, taken only when the fleet shrank.
    const tag: ListingTag = ACT_LISTING_METHODS.includes(inner.name) || (inner.name === SELECTION_LISTING_METHOD && isListing) ? 'act'
      : TESTS_ONLY_LISTING_METHODS.includes(inner.name) ? 'tests-only' : 'selection';
    out.push({ file: 'server/src/watch.ts', line: c.line, text: lines[c.line - 1]!, method: inner.name, tag });
  }
  return out;
}

// ARCH-52 (#787; spec 2026-10-19 §5.5 exit "SessionStream polls: 4 -> 0, dialog frames per change per socket: 2 -> 1"; D-6977).
// The two counts below are the exit's PIN: unlike the series above they have reached their target, so
// `consolidation-census.test.ts` holds them to it and they may only stay there.

/** The per-session reads `SessionStream` made every 2 s before ARCH-52: the pane (`tmux.capture`, `parseDialog` and the
 *  transcript's ask, `readPendingAsk` / `alignAsk`), the plan (`readTasks`), the hookstate (`readHookStateRaw`,
 *  `readHookStateRawMeasured`) and the mail (`outstandingMailFor`). Call expressions in `server/src/sessionws.ts`; an
 *  import, a comment and a method NAMED in prose are not calls. 0 on `ba36d7420`: they live in `sessionFeed.ts`, once
 *  per open session.
 *  KNOWN WIDTH: only `server/src/sessionws.ts` is read, and only these call names; a poll moved to another file, or made
 *  through a renamed or aliased reader, is not seen. */
export function sessionStreamPollSites(root: string = REPO): CensusSite[] {
  const re = /(?:\btmux\.capture|\bparseDialog|\breadPendingAsk|\balignAsk|\breadTasks|\breadHookStateRaw(?:Measured)?|\boutstandingMailFor)\s*\(/g;
  return sitesOf(root, ['server/src'], re, (f) => f !== 'server/src/sessionws.ts');
}

/** The files under `server/src` that build a `{ type: 'dialog' }` or `{ type: 'dialog_cleared' }` wire frame: one site
 *  per file (its first literal). 1 on `ba36d7420` (`sessionws.ts`'s `nextDialogFrame`, which a poll's reading and an
 *  answer both go through); the watcher's own copy, the second producer, is gone. */
export function dialogFrameProducers(root: string = REPO): CensusSite[] {
  const seen = new Set<string>();
  return sitesOf(root, ['server/src'], /\btype:\s*'dialog(?:_cleared)?'/g).filter((s) => !seen.has(s.file) && seen.add(s.file));
}

/**
 * ARCH-76 (#811) follow-up (D-6991): the definitions of a `warn…Once` helper under `server/src` and
 * `shared/`, outside `server/src/changeLatch.ts`. A definition is a code line that declares the name with `function`,
 * `const` or `let`; a call, an import or a comment naming it is not one. "Warn once until it changes" is `changeLatch`; a
 * helper that is something else stays only as a row of `ONCE_WARN_ALLOWED`, with its reason, so the ratchet counts it on
 * purpose. KNOWN WIDTH: a once-latch with another name (a bare `Set` check before a `console.warn`) is not seen.
 */
export function onceWarnDefinitions(root: string = REPO): CensusSite[] {
  return sitesOf(root, ['server/src', 'shared'], /\b(?:function\s*\*?|const|let)\s+warn\w*Once\b/g,
    (f) => f === 'server/src/changeLatch.ts');
}

/** The `warn…Once` definitions kept on purpose, by file, each with why it is not a change latch. This list only shrinks. */
export const ONCE_WARN_ALLOWED: ReadonlyArray<{ readonly file: string; readonly reason: string }> = [
  // tmp-sweep-mail.test.ts's characterization: a key that comes back after another key or a clean pass stays silent.
  { file: 'server/src/tmpSweepLane.ts', reason: 'once-ever, not a change latch, D-6991' },
];

// ── W3: operator questions (D-TBD-question-census; Task Q3a; ARCH-56 (#791), ARCH-57 (#792), ARCH-58 (#793)) ─────────
// W3's counted exits (plan docs/superpowers/plans/2026-10-26-consolidation-w3-questions.md). Every query is read from
// the syntax tree (`scan/symbols.ts`, over `scan/parse.ts`), and every one REPORTS: nothing below is ratcheted here.
// Each may-only-shrink pin lands in the commit that reaches its wave target (spec §5.1 rule 3), in Q3c to Q3f.
// KNOWN WIDTH, every query below: a member reached through a computed name, an alias or a destructured binding is not
// seen, and a route is only an `app.<verb>('<literal path>', …)` registration.

/** The `FleetWatcher` fields that carry a held question, by name (a closed list, checked against the class's fields:
 *  a name that is no longer a field leaves the census). */
export const QUESTION_HOLD_CARRIER_NAMES: readonly string[] = ['heldAsks', 'heldApprovals', 'lapsedAsks', 'pendingReseed'];

/** The question state `registerCoordRoutes` holds in a closure local, made once per server (never module scope). */
export const ROUTE_QUESTION_STATE_NAMES: readonly string[] = ['approvalInputs'];

/** One carrier of question state: where it is declared, and its owner (the class, or the function whose local it is). */
export interface QuestionCarrierSite extends CensusSite { readonly name: string; readonly owner: string }

/** W3's question hold carriers: `FleetWatcher`'s fields in `QUESTION_HOLD_CARRIER_NAMES` (4 at the base), then each
 *  `ROUTE_QUESTION_STATE_NAMES` binding declared inside `registerCoordRoutes` (`approvalInputs`, 1). 5 at the base. After
 *  Q3d and Q3e the same names are looked for in `coord/questions.ts`'s `createQuestions`, so the owner column says where
 *  each carrier lives, and a module-scope binding of one of them reports the owner `module scope`. */
export function questionHoldCarriers(root: string = REPO): QuestionCarrierSite[] {
  const out: QuestionCarrierSite[] = [];
  const names = [...QUESTION_HOLD_CARRIER_NAMES, ...ROUTE_QUESTION_STATE_NAMES];
  const w = watcherFacts(root);
  if (w !== null) {
    for (const f of w.facts.fields) {
      if (f.cls === 'FleetWatcher' && QUESTION_HOLD_CARRIER_NAMES.includes(f.name)) out.push({ ...siteAt(w, f.line), name: f.name, owner: 'FleetWatcher' });
    }
  }
  for (const [rel, fn] of [['server/src/coord/routes.ts', 'registerCoordRoutes'], ['server/src/coord/questions.ts', 'createQuestions']] as const) {
    const abs = path.join(root, rel);
    if (!existsSync(abs)) continue;
    const parsed = parsedFile(abs);
    const lines = parsed.text.split('\n');
    const owner = parsed.symbols.find((s) => s.name === fn);
    for (const b of parsed.bindings) {
      if (!names.includes(b.name)) continue;
      const inside = owner !== undefined && b.start >= owner.start && b.end <= owner.end;
      const atTop = b.scopeStart === 0;
      if (!inside && !atTop) continue;
      out.push({ file: rel, line: b.line, text: lines[b.line - 1] ?? '', name: b.name, owner: inside ? fn : 'module scope' });
    }
  }
  return out;
}

/** The pane-edge maps: what the pane showed, per session. Not question state (D-TBD-question-census): reported, never
 *  ratcheted. */
export const QUESTION_PANE_EDGE_NAMES: readonly string[] = ['dialogIds', 'actionlessAsks', 'settlingAsks'];

/** `FleetWatcher`'s pane-edge maps still declared (3 at the base). */
export function questionPaneEdges(root: string = REPO): CensusSite[] {
  const w = watcherFacts(root);
  return w === null ? [] : w.facts.fields.filter((f) => f.cls === 'FleetWatcher' && QUESTION_PANE_EDGE_NAMES.includes(f.name)).map((f) => siteAt(w, f.line));
}

/** The store methods whose call lapses, releases or prunes a question row: what makes a method a question sweep. */
export const QUESTION_SWEEP_ACTS: readonly string[] = ['releaseAsk', 'lapseApproval', 'staleApproval', 'pruneApprovalInputs', 'pruneAskQuestions'];

/** One question sweep entry point: the `FleetWatcher` method `tick` calls, at the line `tick` calls it. */
export interface SweepEntrySite extends CensusSite { readonly method: string }

/** W3's question sweep entry points: the `FleetWatcher` methods `tick`'s own body calls (`this.<m>(`) that reach a
 *  `QUESTION_SWEEP_ACTS` store call, directly or through the `this.` methods they call (arrows inside them included).
 *  At the base, `sweepAsks` (through `askPass`) and `sweepApprovals` (2). A public half that `tick` does not call itself is
 *  not an entry point. */
export function questionSweepEntries(root: string = REPO): SweepEntrySite[] {
  const abs = path.join(root, 'server/src/watch.ts');
  if (!existsSync(abs)) return [];
  const parsed = parsedFile(abs);
  const lines = parsed.text.split('\n');
  const method = (name: string) => parsed.symbols.find((s) => s.name === `FleetWatcher.${name}`);
  const callsOf = (s: { start: number; end: number }) => parsed.calls.filter((c) => c.start >= s.start && c.end <= s.end);
  const own = (callee: string): string | null => /^this\.(\w+)$/.exec(callee)?.[1] ?? null;
  const reaches = (name: string, seen: Set<string>): boolean => {
    if (seen.has(name)) return false;
    seen.add(name);
    const s = method(name);
    if (s === undefined) return false;
    const cs = callsOf(s);
    if (cs.some((c) => c.name !== null && QUESTION_SWEEP_ACTS.includes(c.name) && own(c.callee) === null)) return true;
    return cs.some((c) => { const m = own(c.callee); return m !== null && reaches(m, seen); });
  };
  const tick = method('tick');
  if (tick === undefined) return [];
  const out: SweepEntrySite[] = [];
  const done = new Set<string>();
  for (const c of callsOf(tick)) {
    const m = own(c.callee);
    if (m === null || done.has(m)) continue;
    done.add(m);
    if (reaches(m, new Set())) out.push({ file: 'server/src/watch.ts', line: c.line, text: lines[c.line - 1] ?? '', method: m });
  }
  return out;
}

/** Who a question door answers for: the dispatched child's parent (`claimant`), the operator at the PWA (`operator`), or
 *  nobody (`navigation`: it moves the pane and answers nothing). */
export type QuestionDoorTag = 'claimant' | 'operator' | 'navigation';

/** The question doors by path, each with its principal. A POST whose path has a question door's shape and is not a
 *  row here is reported `untagged`, and the census test reds. */
export const QUESTION_DOOR_TAGS: Readonly<Record<string, QuestionDoorTag>> = {
  '/api/asks/:id/answer': 'claimant',
  '/api/asks/:id/release': 'claimant',
  '/api/approvals/:id/rule': 'claimant',
  '/api/approvals/:id/release': 'claimant',
  '/api/sessions/:id/ask': 'operator',
  '/api/sessions/:id/dialog': 'operator',
  '/api/sessions/:id/dialog/text': 'operator',
  '/api/sessions/:id/dialog/multi': 'operator',
  '/api/sessions/:id/dialog/tab': 'navigation',
};

/** A question door's shape: a verb under an ask's or an approval's id, an operator's answer or dialog door under a
 *  session's id, or anything under `/api/questions/`. `POST /api/approvals` (the raise) and the session's own
 *  `/hold`/`/release` are not. */
const QUESTION_DOOR_SHAPE = /^\/api\/(?:(?:asks|approvals)\/:id\/[^/]+|sessions\/:id\/(?:ask|dialog(?:\/[^/]+)?)|questions\/.*)$/;

/** The files whose route registrations the door census reads. */
const QUESTION_DOOR_FILES: readonly string[] = ['server/src/coord/routes.ts', 'server/src/server.ts'];

/** One route registration: its method, its path and the call's span (for "which route holds this call"). */
interface RouteRegistration { readonly verb: string; readonly path: string; readonly start: number; readonly end: number; readonly line: number }

const ROUTE_CALLEE = /^(?:app|fastify|instance|server)\.(get|post|put|patch|delete)$/;

function routeRegistrations(parsed: ReturnType<typeof parsedFile>): RouteRegistration[] {
  return parsed.calls.flatMap((c) => {
    const m = ROUTE_CALLEE.exec(c.callee);
    const p = c.args[0];
    return m !== null && p?.kind === 'string' ? [{ verb: m[1]!.toUpperCase(), path: p.text, start: c.start, end: c.end, line: c.line }] : [];
  });
}

/** One question door: the route, as `POST <path>`, and its tag. */
export interface QuestionDoorSite extends CensusSite { readonly route: string; readonly tag: QuestionDoorTag | 'untagged' }

/** W3's question doors: the POST registrations in `coord/routes.ts` and `server.ts` whose path has a question door's
 *  shape, tagged from `QUESTION_DOOR_TAGS`. 9 at the base: 4 claimant, 4 operator, 1 navigation. */
export function questionDoors(root: string = REPO): QuestionDoorSite[] {
  const out: QuestionDoorSite[] = [];
  for (const rel of QUESTION_DOOR_FILES) {
    const abs = path.join(root, rel);
    if (!existsSync(abs)) continue;
    const parsed = parsedFile(abs);
    const lines = parsed.text.split('\n');
    for (const r of routeRegistrations(parsed)) {
      if (r.verb !== 'POST' || !QUESTION_DOOR_SHAPE.test(r.path)) continue;
      out.push({ file: rel, line: r.line, text: lines[r.line - 1] ?? '', route: `POST ${r.path}`, tag: QUESTION_DOOR_TAGS[r.path] ?? 'untagged' });
    }
  }
  return out;
}

/** One watcher door-in: the public `FleetWatcher` method a route calls to touch question state, at its declaration. */
export interface DoorInSite extends CensusSite { readonly method: string; readonly callers: readonly string[] }

/** W3's watcher door-ins: the public (not `private`) `FleetWatcher` methods whose body reads `this.<carrier>` for a
 *  `QUESTION_HOLD_CARRIER_NAMES` field, and that `coord/routes.ts` or `server.ts` calls (`<x>.<method>(`, by name). At
 *  the base, `releaseHeldAsk`, `answeredLate`, `releaseHeldApproval` and `approvalRuled` (4); each lists the routes that
 *  call it. */
export function questionDoorIns(root: string = REPO): DoorInSite[] {
  const abs = path.join(root, 'server/src/watch.ts');
  if (!existsSync(abs)) return [];
  const parsed = parsedFile(abs);
  const lines = parsed.text.split('\n');
  const touches = (s: { start: number; end: number }): boolean => {
    const body = parsed.text.slice(s.start, s.end).split('\n').map(codeOf).join('\n');
    return QUESTION_HOLD_CARRIER_NAMES.some((c) => new RegExp(`\\bthis\\.${c}\\b`).test(body));
  };
  const candidates = parsed.symbols.filter((s) => s.kind === 'method' && s.name.startsWith('FleetWatcher.')
    && !/^\s*(?:(?:static|async|override)\s+)*private\b/.test(parsed.text.slice(s.start, s.start + 40)) && touches(s));
  const callers = new Map<string, string[]>();
  for (const rel of QUESTION_DOOR_FILES) {
    const f = path.join(root, rel);
    if (!existsSync(f)) continue;
    const p = parsedFile(f);
    const routes = routeRegistrations(p);
    for (const c of p.calls) {
      if (c.name === null || c.head === 'this') continue;
      const route = routes.filter((r) => r.start <= c.start && c.end <= r.end).sort((a, b) => b.start - a.start)[0];
      const key = route === undefined ? rel : `${route.verb} ${route.path}`;
      const list = callers.get(c.name) ?? [];
      if (!list.includes(key)) list.push(key);
      callers.set(c.name, list);
    }
  }
  return candidates.flatMap((s) => {
    const name = s.name.slice('FleetWatcher.'.length);
    const by = callers.get(name);
    return by === undefined ? [] : [{ file: 'server/src/watch.ts', line: s.line, text: lines[s.line - 1] ?? '', method: name, callers: by }];
  });
}

/** The `CoordStore` question methods, a CLOSED list (D-TBD-question-census): every public `CoordStore` method whose
 *  name says ask, approval or question is on it, or on `NOT_QUESTION_STORE_METHODS`, and the census test reds on a
 *  method on neither (`coordStoreQuestionShapedMethods`). 32. */
export const QUESTION_STORE_METHODS: readonly string[] = [
  'askById', 'insertAsk', 'asksForParent', 'heldAskFor', 'currentAskFor', 'currentAsksFor', 'takeAskForAnswer', 'untakeAsk',
  'settleAsk', 'releaseAsk', 'declineAsk', 'staleAsk', 'restampAsk', 'heldQuestionRows', 'heldApprovalRowsByChild',
  'approvalById', 'approvalsForChild', 'heldApprovalsFor', 'approvalsInState', 'insertApproval', 'takeApprovalForRule',
  'declineApproval', 'lapseApproval', 'markApprovalOperator', 'markApprovalOperatorRows', 'staleApproval',
  'pruneApprovalInputs', 'pruneAskQuestions', 'digestAsks', 'digestApprovals', 'askForCorrection', 'driftHeldQuestions',
];

/** Public `CoordStore` methods whose names look like a question method and are not one, each with why. */
export const NOT_QUESTION_STORE_METHODS: Readonly<Record<string, string>> = {
  raiseReviewCapAsk: "the review cap's own raise row (D-6795), not the asks table",
  digestDay: "the digest's send ledger, not a question table",
  claimDigestDay: "the digest's send ledger, not a question table",
};

/** The public `CoordStore` methods (no `private`) whose name says ask, approval, question or digest: the set
 *  `QUESTION_STORE_METHODS` and `NOT_QUESTION_STORE_METHODS` must partition. */
export function coordStoreQuestionShapedMethods(root: string = REPO): string[] {
  const abs = path.join(root, 'server/src/coord/store.ts');
  if (!existsSync(abs)) return [];
  const parsed = parsedFile(abs);
  return parsed.symbols
    .filter((s) => s.kind === 'method' && s.name.startsWith('CoordStore.')
      && !/^\s*(?:(?:static|async|override)\s+)*private\b/.test(parsed.text.slice(s.start, s.start + 40)))
    .map((s) => s.name.slice('CoordStore.'.length))
    .filter((n) => /ask|approv|question|digest/i.test(n))
    .sort();
}

/** The one question-store call W3 leaves where it is, by name: the hook's poll is on the signing path, which no W3 diff
 *  touches (D-TBD-question-census). */
export const QUESTION_STORE_EXCLUDED: ReadonlyArray<{ readonly file: string; readonly symbol: string; readonly method: string }> = [
  { file: 'server/src/coord/routes.ts', symbol: 'GET /api/approvals/:id/ruling', method: 'approvalById' },
];

/** One question-store call: the enclosing route (`POST /api/asks/:id/answer`) or else the innermost named symbol
 *  (`FleetWatcher.askPass`, `buildDigest`), the method, and whether `QUESTION_STORE_EXCLUDED` names it. */
export interface QuestionStoreCallSite extends CensusSite { readonly symbol: string; readonly method: string; readonly excluded: boolean }

/** W3's question-store calls outside the store: every call of a `QUESTION_STORE_METHODS` name (`<x>.<method>(`, never
 *  `this.<method>(`) in `server/src` and `shared/`, outside `coord/store.ts` and `coord/questions.ts`. 48 at the base in 6
 *  files (`watch.ts` 22, `coord/routes.ts` 14, `server.ts` 5, `coord/digest.ts` 4, `fleet.ts` 2, `coord/driftLane.ts` 1),
 *  1 of them excluded by name: 47 counted. Q3f's may-only-shrink pin holds the whole list at the excluded row. */
export function questionStoreCallsOutside(root: string = REPO): QuestionStoreCallSite[] {
  const out: QuestionStoreCallSite[] = [];
  for (const dir of ['server/src', 'shared']) {
    for (const f of sourceFiles(root, dir)) {
      const file = path.relative(root, f).split(path.sep).join('/');
      if (file === 'server/src/coord/store.ts' || file === 'server/src/coord/questions.ts') continue;
      const parsed = parsedFile(f);
      const lines = parsed.text.split('\n');
      const routes = routeRegistrations(parsed);
      for (const c of parsed.calls) {
        if (c.name === null || !QUESTION_STORE_METHODS.includes(c.name) || c.callee === c.name || /^this\.\w+$/.test(c.callee)) continue;
        const route = routes.filter((r) => r.start <= c.start && c.end <= r.end).sort((a, b) => b.start - a.start)[0];
        const sym = parsed.symbols.filter((s) => s.kind !== 'class' && s.start <= c.start && c.end <= s.end).sort((a, b) => b.start - a.start)[0];
        const symbol = route !== undefined ? `${route.verb} ${route.path}` : sym?.name ?? '(module)';
        const excluded = QUESTION_STORE_EXCLUDED.some((x) => x.file === file && x.symbol === symbol && x.method === c.name);
        out.push({ file, line: c.line, text: lines[c.line - 1] ?? '', symbol, method: c.name, excluded });
      }
    }
  }
  return out;
}

/** One definition of an envelope-pairing rule: which side of the wire defines it, and the name. */
export interface PairingRuleSite extends CensusSite { readonly side: 'server' | 'pwa'; readonly name: string }

const pairingDefinitions = (root: string, names: Readonly<Record<'server' | 'pwa', readonly string[]>>): PairingRuleSite[] => {
  const out: PairingRuleSite[] = [];
  for (const [side, dirs] of [['server', ['server/src', 'shared']], ['pwa', ['pwa/src']]] as const) {
    if (names[side].length === 0) continue;
    const re = new RegExp(`\\b(?:function\\s+|const\\s+|let\\s+)(${names[side].map(esc).join('|')})\\b`, 'g');
    for (const s of sitesOf(root, dirs, re)) {
      for (const m of codeOf(s.text).matchAll(re)) out.push({ ...s, side, name: m[1]! });
    }
  }
  return out;
};

/** The normalize-and-prefix rule's definitions (a `function`, `const` or `let` of the name): server `pairMatches`,
 *  PWA `prefixMatches`. 2 at the base, one per side; Q3g keeps the server at 1 (moved into `pane/askPairing.ts`, with
 *  `transcript/ask.ts` re-exporting it), and W7 takes the PWA's to 0. */
export function envelopePairingRules(root: string = REPO): PairingRuleSite[] {
  return pairingDefinitions(root, { server: ['pairMatches', 'prefixMatches'], pwa: ['prefixMatches', 'pairMatches'] });
}

/** The pairing's title-matching definitions (`titleMatches`, `WRAP_BAR_RE`), either side. At the base only the PWA's
 *  (`askLive.ts`, 2 names); server-side envelope pairing 0, until Q3g's port. */
export function envelopePairingTitleRules(root: string = REPO): PairingRuleSite[] {
  return pairingDefinitions(root, { server: ['titleMatches', 'WRAP_BAR_RE'], pwa: ['titleMatches', 'WRAP_BAR_RE'] });
}

/** The W3 task that moves each question-store call, by `file | enclosing symbol` (the plan's Q3a table). A counted call
 *  whose key is not here has no owner, and the census test reds. Rows only leave this table. */
export const QUESTION_STORE_OWNERS: Readonly<Record<string, 'Q3b' | 'Q3d' | 'Q3e' | 'Q3f'>> = {
  'server/src/watch.ts | FleetWatcher.stallWorkerFor': 'Q3d',
  'server/src/watch.ts | FleetWatcher.detectDialogs': 'Q3d',
  'server/src/watch.ts | FleetWatcher.loadReseed': 'Q3d',
  'server/src/watch.ts | FleetWatcher.staleReseedRow': 'Q3d',
  'server/src/watch.ts | FleetWatcher.reseedFromRows': 'Q3d',
  'server/src/watch.ts | FleetWatcher.restampHeldAsk': 'Q3d',
  'server/src/watch.ts | FleetWatcher.askPass': 'Q3d',
  'server/src/watch.ts | FleetWatcher.tryHoldApproval': 'Q3d',
  'server/src/watch.ts | FleetWatcher.sweepApprovals': 'Q3d',
  'server/src/watch.ts | FleetWatcher.releaseHeldApproval': 'Q3d',
  'server/src/watch.ts | FleetWatcher.settleClearedApproval': 'Q3d',
  'server/src/watch.ts | FleetWatcher.tryHold': 'Q3d',
  'server/src/watch.ts | FleetWatcher.hold': 'Q3d',
  'server/src/coord/routes.ts | GET /api/asks': 'Q3b',
  'server/src/coord/routes.ts | GET /api/approvals/:id': 'Q3b',
  'server/src/coord/routes.ts | POST /api/approvals': 'Q3e',
  'server/src/coord/routes.ts | POST /api/asks/:id/answer': 'Q3f',
  'server/src/coord/routes.ts | POST /api/asks/:id/release': 'Q3f',
  'server/src/coord/routes.ts | POST /api/approvals/:id/rule': 'Q3f',
  'server/src/coord/routes.ts | POST /api/approvals/:id/release': 'Q3f',
  'server/src/server.ts | POST /api/sessions/:id/dialog': 'Q3f',
  'server/src/server.ts | POST /api/sessions/:id/ask': 'Q3f',
  'server/src/coord/digest.ts | buildDigest': 'Q3b',
  'server/src/coord/digest.ts | correctDigestRow': 'Q3b',
  'server/src/fleet.ts | readHeldApprovals': 'Q3b',
  'server/src/fleet.ts | readCurrentAsks': 'Q3b',
  'server/src/coord/driftLane.ts | pass': 'Q3b',
};
