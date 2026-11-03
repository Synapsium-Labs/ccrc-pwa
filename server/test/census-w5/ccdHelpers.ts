// W5's ccd-helper census (D-7071; ARCH-45, Task C5d; plan 2026-10-27-consolidation-w5-ccd-helpers.md; spec K2, §5.1
// rules 1 and 3). This plan's own module for ARCH-45, as `accountMarkers.ts` is ARCH-72's account half: no series appends
// to `consolidationCensus.ts` (D-7043). It imports that file's helpers, `accountMarkers.ts`'s body splitter and
// `ccdWsHelpers.ts#ccdSource`, and is never re-exported from `consolidationCensus.ts`. Its FIXTURE and REAL rows live in
// the sibling `ccdHelpers.test.ts`; the characterization pins that read it live in `server/test/ccd-helpers-pin.test.ts`.
//
// WHAT IT COUNTS. ccd's verdict-setting refusal helpers (`_reap_refuse`, `_ws_collect_refuse`, and `_ws_refuse`, the one
// name C5e leaves), their calls and the words those calls refuse with; the functions that mint a token by hashing their
// own stdout; the reap-lock wrappers; and the tail steps' callers. C5e, C5f and C5g each move one of these counts and land
// the may-only-shrink pin in the commit that reaches it (spec §5.1 rule 3).
//
// KNOWN WIDTH. ccd's text is `ccdSource()`: `ccd/ccd` with each `# @ccd-lib:<id>` pointer replaced by its library region
// (D-6913), so an offset is an offset of that one text. A call is the helper's name as a whole word followed by a blank
// and an argument on the same line (a comment line counts unless code only is asked); a name in backticks with no
// argument, a definition and a name spelled inside another word are not calls. A word is the first argument when it is a
// bare `[A-Za-z][A-Za-z0-9_-]*`; anything else (`"${row#!}"`, `…`, `<token>`) is `null`. A function is a column-0
// definition through its closing brace (`accountMarkers.ts#bashBodies`); a nested definition belongs to its parent.
import { bashCodeOf, ccdCallGraph, REPO } from '../consolidationCensus.js';
import { ccdSource } from '../ccdWsHelpers.js';
import { bashBodies, ccdProgramBodies, maskQuoted, type BashBody } from './accountMarkers.js';

/** The two families a refusal belongs to. */
export type RefuseFamily = 'reap' | 'collect';

/** Every verdict-setting refusal helper name the census reads: the two on `main`, and the one C5e introduces. */
export const REFUSE_HELPER_NAMES: readonly string[] = ['_reap_refuse', '_ws_collect_refuse', '_ws_refuse'];

/** Each name's own family: `null` for the shared helper, which carries none. */
const NAME_FAMILY: Readonly<Record<string, RefuseFamily | null>> = {
  _reap_refuse: 'reap', _ws_collect_refuse: 'collect', _ws_refuse: null,
};

/** The two regions whose calls are collector family (every other call is reap family). */
export const COLLECT_REGIONS: ReadonlyArray<readonly [string, string]> = [
  ['COLLECT-BEGIN', 'COLLECT-END'], ['LOOSE-BEGIN', 'LOOSE-END'],
];

/** One call of a refusal helper. `offset` is into the text the query read; `line` is 1-based there. */
export interface RefuseCall {
  readonly offset: number;
  readonly line: number;
  readonly name: string;
  readonly fn: string | null;
  readonly word: string | null;
  readonly comment: boolean;
  readonly regionFamily: RefuseFamily;
  readonly nameFamily: RefuseFamily | null;
  readonly text: string;
}

/** The whole lines from the one holding `begin` to the one holding `end` (its newline included), as `[from, to)`
 *  offsets of `src`; `null` when neither marker is there. A marker without its pair throws: a lost marker would
 *  otherwise move every call of that region to the other family without a word. */
export function markedSpan(src: string, begin: string, end: string): [number, number] | null {
  const b = src.indexOf(begin);
  const e = src.indexOf(end);
  if (b < 0 && e < 0) return null;
  if (b < 0 || e < 0 || e < b) throw new Error(`ccd: the ${begin}/${end} pair is broken (${b}, ${e})`);
  const nl = src.indexOf('\n', e);
  return [src.lastIndexOf('\n', b) + 1, nl < 0 ? src.length : nl + 1];
}

/** `[from, to)` of the function `name`'s text in `src`, as the scanners slice it: from its `\n<name>() {` line to the
 *  first `\n}\n` after it. Throws when `src` does not define it. */
export function functionSpan(src: string, name: string): [number, number] {
  const from = src.indexOf(`\n${name}() {`);
  if (from < 0) throw new Error(`ccd: ${name} is not defined`);
  const to = src.indexOf('\n}\n', from);
  return [from, to < 0 ? src.length : to];
}

/** Each 1-based line's enclosing function (column-0 definitions only), or `null` at the top level. */
export function enclosingFunctions(src: string): (string | null)[] {
  const n = src.split('\n').length;
  const out: (string | null)[] = new Array<string | null>(n + 1).fill(null);
  for (const b of bashBodies(src)) {
    if (!b.fn) continue;
    for (const l of b.lines) out[l.line] = b.name;
  }
  return out;
}

const CALL = new RegExp(`(?<![A-Za-z0-9_])(${REFUSE_HELPER_NAMES.join('|')})(?![A-Za-z0-9_])[ \\t]+(\\S+)`, 'g');
const WORD = /^([A-Za-z][A-Za-z0-9_-]*)(?=$|[\s;)|&])/;

/** Every call of a verdict-setting refusal helper in `src`, in order (rev 10's count: 158, 155 on code lines and 3 on
 *  comment lines). Its region family is `collect` inside `COLLECT_REGIONS`, else `reap`. */
export function refuseCalls(src: string = ccdSource()): RefuseCall[] {
  const spans = COLLECT_REGIONS.map(([b, e]) => markedSpan(src, b, e)).filter((s): s is [number, number] => s !== null);
  const fns = enclosingFunctions(src);
  const out: RefuseCall[] = [];
  for (const m of src.matchAll(CALL)) {
    const offset = m.index;
    const ls = src.lastIndexOf('\n', offset) + 1;
    const le = src.indexOf('\n', offset);
    const text = src.slice(ls, le < 0 ? src.length : le);
    const line = src.slice(0, offset).split('\n').length;
    const w = WORD.exec(m[2]!);
    out.push({
      offset, line, name: m[1]!, fn: fns[line] ?? null, word: w ? w[1]! : null,
      comment: /^\s*#/.test(text),
      regionFamily: spans.some(([a, b]) => offset >= a && offset < b) ? 'collect' : 'reap',
      nameFamily: NAME_FAMILY[m[1]!] ?? null,
      text,
    });
  }
  return out;
}

/** A scope `refuseWords` reads: `[from, to)` offsets of the text, ranges inside it whose calls are dropped, and whether
 *  comment-line calls are dropped (they are kept unless `codeOnly`). `src` defaults to `ccdSource()`. */
export interface RefuseScope {
  readonly src?: string;
  readonly from?: number;
  readonly to?: number;
  readonly exclude?: ReadonlyArray<readonly [number, number]>;
  readonly codeOnly?: boolean;
}

/** The sorted, de-duplicated words of one region family's calls within `opts` (a `null` word adds none): the one
 *  harvest every scanner reads after C5e. */
export function refuseWords(family: RefuseFamily, opts: RefuseScope = {}): string[] {
  const src = opts.src ?? ccdSource();
  const from = opts.from ?? 0;
  const to = opts.to ?? src.length;
  const words = new Set<string>();
  for (const c of refuseCalls(src)) {
    if (c.regionFamily !== family || c.word === null) continue;
    if (c.offset < from || c.offset >= to) continue;
    if ((opts.exclude ?? []).some(([a, b]) => c.offset >= a && c.offset < b)) continue;
    if (opts.codeOnly && c.comment) continue;
    words.add(c.word);
  }
  return [...words].sort();
}

/** One definition of a refusal helper: its name, its 1-based line and its body (the code between its braces, each
 *  line's trailing comment cut, trimmed). */
export interface RefuseHelperDef { readonly name: string; readonly line: number; readonly body: string }

/** The definitions of the refusal helpers in `src` (base: 2, `_reap_refuse` and `_ws_collect_refuse`). */
export function refuseHelperDefs(src: string = ccdSource()): RefuseHelperDef[] {
  return bashBodies(src).filter((b) => b.fn && REFUSE_HELPER_NAMES.includes(b.name)).map((b) => {
    const code = b.lines.map((l) => bashCodeOf(l.raw)).join('\n');
    const open = code.indexOf('{');
    const close = code.lastIndexOf('}');
    return { name: b.name, line: b.lines[0]!.line, body: code.slice(open + 1, close).trim() };
  });
}

/** The pipe whose stdout is a token: `printf '%s\n' … | _plat_sha256 | cut -d' ' -f1`. */
const MINT = /^printf '%s\\n' [\s\S]*\|\s*_plat_sha256\s*\|\s*cut -d' ' -f1\s*$/;

/** One function body's commands at its top level: continued lines joined (a trailing `\` or a leading `|`), split at
 *  an unquoted `;`, `&&` or `||`. A command inside a `$( )` is never at the top level. */
function topLevelCommands(lines: readonly string[]): string[] {
  const logical: string[] = [];
  for (const raw of lines) {
    const code = bashCodeOf(raw);
    if (logical.length > 0 && (/\\$/.test(logical[logical.length - 1]!) || /^\s*\|/.test(code))) {
      logical[logical.length - 1] = `${logical[logical.length - 1]!.replace(/\\$/, '')} ${code.trim()}`;
    } else logical.push(code);
  }
  const out: string[] = [];
  for (const l of logical) {
    const masked = maskQuoted(l, /[;&|]/);
    let depth = 0;
    let at = 0;
    for (let i = 0; i < masked.length; i++) {
      const c = masked[i]!;
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (depth === 0 && (c === ';' || ((c === '&' || c === '|') && masked[i + 1] === c))) {
        out.push(l.slice(at, i));
        at = i + (c === ';' ? 1 : 2);
        if (c !== ';') i++;
      }
    }
    out.push(l.slice(at));
  }
  return out.map((c) => c.trim().replace(/^\{\s*/, '').replace(/\s*\}$/, '').trim()).filter((c) => c !== '');
}

/** The functions whose stdout is the hash (base: 2, `_ws_fingerprint` and `_ws_reclaim_fingerprint`): a `MINT` pipe at
 *  the body's top level. A digest assignment (`REAP_IGNDIGEST=$(…)`) holds the same pipe inside `$( )` and is data. */
export function tokenMinters(src: string = ccdSource()): string[] {
  return bashBodies(src).filter((b) => {
    if (!b.fn) return false;
    const lines = b.lines.map((l) => l.raw);
    lines[0] = lines[0]!.replace(/^[^{]*\{/, '');
    if (lines.length > 1) lines[lines.length - 1] = lines[lines.length - 1]!.replace(/\}\s*$/, '');
    else lines[0] = lines[0]!.replace(/\}\s*$/, '');
    return topLevelCommands(lines).some((c) => MINT.test(c));
  }).map((b) => b.name);
}

/** The reap lock's path, as ccd spells it (`"$REG/.reap-$id.lock"`, or its listing glob `"$REG/.reap-$id".lo[c]k`). */
const REAP_LOCK = /\.reap-\$\{?id\}?"?\.lo(?:ck|\[c\]k)/;

/** The functions that name the reap lock, split: `wrappers` open it, `flock -n` it and answer contention with the
 *  `{"refused":"in-progress",…}` document at rc 0 (base: 4); `others` name it in another shape (base: 4, reported). */
export function reapLockWrappers(src: string = ccdSource()): { wrappers: string[]; others: string[] } {
  const wrappers: string[] = [];
  const others: string[] = [];
  for (const b of bashBodies(src)) {
    if (!b.fn) continue;
    const code = b.lines.map((l) => bashCodeOf(l.raw)).join('\n');
    if (!REAP_LOCK.test(code)) continue;
    const wrapper = /\bflock -n\b/.test(code) && /printf '\{"refused":"in-progress"/.test(code) && /\breturn 0\b/.test(code);
    (wrapper ? wrappers : others).push(b.name);
  }
  return { wrappers, others };
}

/** The one reap-lock runner (D-7076; ARCH-45, C5g): ws-reap, ws-reclaim, ws-expire and ws-collect take the shared
 *  `.reap-<id>.lock` through it, each with its act and verb as literal words and its own in-progress sentence. */
export const REAP_LOCK_RUNNER = '_ws_reap_lock_run';

/** One call of the runner: its enclosing function (`null` at the top level), its act and verb when each is a literal
 *  word (else `null`), its busy sentence when it is one double-quoted argument after `"$id"` (else `null`), the
 *  command it runs (the rest of the line), and where it stands in the text the query read. */
export interface LockRunnerCall {
  readonly fn: string | null;
  readonly act: string | null;
  readonly verb: string | null;
  readonly busy: string | null;
  readonly cmd: string;
  readonly line: number;
  readonly offset: number;
  readonly text: string;
}

/** One line of the runner's own decline: its token when it is a literal word (else `null`), and the 1-based line of
 *  the command's first line with that logical line's text (continuations joined). */
export interface LockRunnerToken { readonly token: string | null; readonly line: number; readonly text: string }

/** One of the runner's `_lc_refuse "$act" "$id" <token> "<sentence>"` calls; `sentence` is `null` when it is not one
 *  double-quoted argument. */
export interface LockRunnerRefuse extends LockRunnerToken { readonly sentence: string | null }

/** The runner's own lines, once, by name: its `_lc_refuse` calls (flock unavailable, the lock unopenable), its
 *  `_lc_emit "$act" refused …` decline and its `{"refused":"in-progress",…}` printf. */
export interface LockRunnerSites {
  readonly name: string;
  readonly line: number;
  readonly refuses: readonly LockRunnerRefuse[];
  readonly emits: readonly LockRunnerToken[];
  readonly printfs: readonly LockRunnerToken[];
}

const LITERAL_TOKEN = /^[a-z][a-z0-9-]*$/;
const RUNNER_CALL = new RegExp(`(?<![A-Za-z0-9_$-])${REAP_LOCK_RUNNER}[ \\t]+(.*)$`);

/** A body's code lines joined at each trailing `\`, with the 1-based line each logical line starts on. */
function logicalLines(lines: BashBody['lines']): { line: number; code: string }[] {
  const out: { line: number; code: string }[] = [];
  let open = false;
  for (const l of lines) {
    const code = bashCodeOf(l.raw);
    if (open) out[out.length - 1]!.code = `${out[out.length - 1]!.code.replace(/\\$/, '')} ${code.trim()}`;
    else out.push({ line: l.line, code });
    open = /\\$/.test(out[out.length - 1]!.code);
  }
  return out;
}

/** The lock-decline sites the reap-lock runner holds (D-7076): every call of `REAP_LOCK_RUNNER` on a code line, in
 *  order, and the runner's own decline lines once, by name (`runner` is `null` while it is not defined). Read off the
 *  same text the census reads, so each `offset` compares with `src.indexOf(…)` offsets. */
export function lockDeclineSites(src: string = ccdSource()): { runner: LockRunnerSites | null; calls: LockRunnerCall[] } {
  const starts: number[] = [0, 0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  const bodies = bashBodies(src);
  const calls: LockRunnerCall[] = [];
  for (const b of bodies) {
    for (const l of logicalLines(b.lines)) {
      const m = RUNNER_CALL.exec(l.code);
      if (!m) continue;
      const args = m[1]!.trim();
      const a = /^(\S+)\s+(\S+)\s+"\$id"\s+"((?:[^"\\]|\\.)*)"\s+(.*)$/.exec(args);
      const words = args.split(/\s+/);
      calls.push({
        fn: b.fn ? b.name : null,
        act: /^[a-z]+$/.test(words[0] ?? '') ? words[0]! : null,
        verb: /^ws-[a-z]+$/.test(words[1] ?? '') ? words[1]! : null,
        busy: a ? a[3]! : null,
        cmd: a ? a[4]!.trim() : args,
        line: l.line,
        offset: starts[l.line]! + l.code.indexOf(REAP_LOCK_RUNNER),
        text: l.code.trim(),
      });
    }
  }
  const def = bodies.find((b) => b.fn && b.name === REAP_LOCK_RUNNER);
  if (!def) return { runner: null, calls };
  const refuses: LockRunnerRefuse[] = [];
  const emits: LockRunnerToken[] = [];
  const printfs: LockRunnerToken[] = [];
  const tok = (w: string | undefined): string | null => (w !== undefined && LITERAL_TOKEN.test(w) ? w : null);
  for (const l of logicalLines(def.lines)) {
    const text = l.code.trim();
    const r = /(?<![A-Za-z0-9_])_lc_refuse\s+"\$act"\s+"\$id"\s+(\S+)(?:\s+"((?:[^"\\]|\\.)*)")?/.exec(l.code);
    if (r) refuses.push({ token: tok(r[1]), sentence: r[2] ?? null, line: l.line, text });
    const e = /(?<![A-Za-z0-9_])_lc_emit\s+"\$act"\s+refused\s+"\$id"\s+""\s+verb\s+"\$verb"\s+refusal\s+(\S+)/.exec(l.code);
    if (e) emits.push({ token: tok(e[1]), line: l.line, text });
    const p = /\bprintf\s+'\{"refused":"([^"]*)"/.exec(l.code);
    if (p) printfs.push({ token: tok(p[1]), line: l.line, text });
  }
  return { runner: { name: def.name, line: def.lines[0]!.line, refuses, emits, printfs }, calls };
}

/** The tail steps ARCH-45 names (spec K2: the attic pin is two, a catalogue reason; D-7074), each a named helper. */
export const TAIL_STEP_HELPERS: readonly string[] = [
  '_reg_retire', '_ws_unsupervise', '_ws_tombstone', '_ws_tomb_str', '_ws_tomb_children', '_lc_intent', '_lc_done', '_lc_fail',
];

/** The five functions that end a workspace's life: reap's two and reclaim's three. */
export const TAIL_FNS: readonly string[] = ['_ws_reap_locked', '_ws_reap_tail', '_ws_reclaim_locked', '_ws_reclaim_tail', '_ws_reclaim_fail'];

/** The reap side of `TAIL_FNS`; the rest are the reclaim side. */
export const TAIL_REAP_SIDE: readonly string[] = ['_ws_reap_locked', '_ws_reap_tail'];

/** Each `TAIL_STEP_HELPERS` name's callers by function, sorted (`ccdCallGraph`: a function that names it as a whole word
 *  on a code line). `root` is the tree to read (a fixture passes its own). */
export function tailStepHelpers(root: string = REPO): Record<string, string[]> {
  const edges = ccdCallGraph(root);
  const out: Record<string, string[]> = {};
  for (const h of TAIL_STEP_HELPERS) out[h] = [...new Set(edges.filter((e) => e.callee === h).map((e) => e.caller))].sort();
  return out;
}

/** `name`'s callers among `TAIL_FNS`, sorted. */
export function tailCallers(name: string, root: string = REPO): string[] {
  return [...new Set(ccdCallGraph(root).filter((e) => e.callee === name && TAIL_FNS.includes(e.caller)).map((e) => e.caller))].sort();
}

/** The `_reg_purge` call lines outside `_reg_retire` (and outside its own definition): `<file>:<line>  <text>` (base: 0). */
export function regPurgeCallLines(root: string = REPO): string[] {
  const out: string[] = [];
  for (const b of ccdProgramBodies(root)) {
    if (b.name === '_reg_purge' || b.name === '_reg_retire') continue;
    for (const l of b.lines) {
      const code = bashCodeOf(l.raw);
      if (/(?<![A-Za-z0-9_$])_reg_purge(?![A-Za-z0-9_(=])/.test(code)) out.push(`${b.file}:${l.line}  ${l.raw.trim()}`);
    }
  }
  return out;
}
