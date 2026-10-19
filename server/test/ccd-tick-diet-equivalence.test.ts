// The supervisor tick diet's differential harness (#387, tick-diet spec §9, plan Task 2).
//
// WHAT IT PROVES. Every helper the diet converts keeps its name, stdout, stderr, rc and registry bytes (spec §6.1 rule
// 1, invariant I4), and every `_to` out-var form leaves exactly what `v=$(legacy …); rc=$?` leaves. "The same" means
// the same as the code the diet REPLACED, so that code is vendored, frozen, as `_legacy_*` in
// `fixtures/tick-diet-legacy.bash`, and every row runs the legacy twin and the live helper side by side, in the same
// fixture HOME, under `C` and under the UTF-8 locale the supervisors run under.
//
// THE PARTS, and the order a reader needs them in:
//  - E0, the legacy pin. The fixture's sha256 (a); each body, with the rename map reversed, against
//    `git show 0d0ea592:ccd/ccd` (b); and every live helper those bodies reach, TRANSITIVELY, at its 0d0ea592
//    definition (c). Without (c) a legacy body could drift by its callees while its own text stayed pinned.
//  - E1, the out-var census (plan Task 2 Step 4, Review Focus 2). A static read of `ccd/ccd`: no call passes an out-var
//    name that is a local of the form it calls, or of a form that form forwards its out-var to. A collision there is
//    silent: `printf -v` lands in the callee's own local and the caller keeps its old value.
//  - E2, the runner's own proofs: it can red, it isolates sides, and a hang is a bounded, NAMED failure.
//  - E3, the rows, per locale. W1's are here; W2 and W3 add theirs, red first, from `tickDietCorpus.ts`.
//  - E5, W2's limits rows (D-4962), per locale: every limits row and 500 random ones through both forms, the
//    structural row that says which side of spec §6.3's domain each row fell on, and the one rc edge inside that domain
//    (E5e: grep's SIGPIPE, which no builtin can equal). (E5 sits above E4 in the file.)
//  - E6, W2's share rows (D-4962, plan Task 10): `_share_pct_to` and its per-`_swap_target` memo, inside and outside
//    the memo scope, including the empty-key departure (D-5042).
//  - E7, W2 Task 9's rows (D-4962), per locale: `_limit_field` and `_limit_field_to` over every limits row at three
//    clocks, both fields and four maxages; into its callers' names; the one-read row; and `_avail`/`_limit_score`
//    against their vendored legacy, called bare as the tick calls them. (E6 and E7 also sit above E4 in the file.)
//  - E8, W3 Task 13's registry rows (D-4963), per locale: `_reg_get`, `_reg_get_to`, `_reg_read` and `_reg_read_to`
//    over every registry row and 500 random ones; into the names the tick's hot sites pass; the open-failure ladder
//    driven by a field that vanishes between the type check and the open; and the one stated edge, `_reg_get`'s raw
//    stdout, with the static census that says no call site reads it (E8d). (E8 also sits above E4 in the file.)
//  - E9, W3 Task 15's route rows (D-4963), per locale: every `ROUTE_ROWS` record through the route chain's printing
//    forms, their `_to` forms and `_route_apply_pending`'s rc, each side asserting the quiet chain left the registry
//    (`swap.log`, the floor markers) byte-unchanged; and the `_to` forms into the names their call sites pass. (E9 also
//    sits above E4 in the file.)
//  - E10, W3 Task 16's rows (D-4963), per locale: every `HOME_ROWS` row through `$(_home_measured)` and
//    `_home_measured_to`, the latter also into `home`; the printing form's one stated edge, its raw stdout on the
//    fallback arm, with the static census that says no call site reads it (E10d); and every `AUTHDEAD_ROWS` marker
//    through `_authdead`, whose `cat` became `_file_read_to`. (E10 also sits above E4 in the file.)
//  - E4, the corpus module: deterministic, and every row plants the shape it names.
//
// RED FIRST, AND STILL A GREEN COMMIT. A row whose live helper has not landed yet is PENDING: its live side must fail,
// with `<name>: command not found`. That is the red the plan asks for at Task 2 (its "rc 127 rows"), measured rather
// than assumed, and it keeps the commit green. The task that lands a helper takes it out of `PENDING` in the
// same commit — first, which turns its rows red against the missing helper, and then green once it is written (E1d
// checks that `PENDING` matches what `ccd/ccd` defines, in both directions).
//
// THE RUNNER. A batch is one bash process, bounded by `BOUNDED` (a hang is the bound's rc, 142, never a stuck suite),
// that sources `ccd/ccd` and then the fixture. Each SIDE of each row runs in a subshell, against a freshly wiped
// `$REG` and `$LIMITS_DIR` the row's setup has planted, and leaves its raw stdout, stderr and rc in files, with the
// registry tree it left behind moved aside for comparison. Files rather than one JSON line per row (the plan's
// wording): the bytes need no encoding, and a hung side is named by the first `rc` file that is missing.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  makeCcdHarness, ghContainedEnv, CCD, BOUNDED, FIXTURE_MOUNTINFO, type CcdHarness,
} from './ccdWsHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';
import { DEFAULT_TEST_ROSTER } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import {
  AUTHDEAD_ROWS, HOME_ROWS,
  FILE_ROW_SETS, LIMIT_KEYS, LIMITS_IN_CAP_SIGPIPE, LIMITS_REWRITE, LIMITS_ROWS, LIMITS_TS, RANDOM_ALPHABET, REGISTRY_ROWS, ROUTE_ROWS,
  blocksByName, inLimitsDomain, needsNonRoot, randomRows, type FileRow, type RouteRow,
} from './tickDietCorpus.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const FIXTURE = path.join(HERE, 'fixtures', 'tick-diet-legacy.bash');

/** The base every tick-diet wave is measured against (plan §Base). */
const LEGACY_SHA = '0d0ea592166496be5eccb948313e381bcb2b87c8';
/** E0a. Re-pinned only by the commit that vendors one more helper, the one edit the fixture takes (its header says
 *  how); never to turn a red green. */
const FIXTURE_SHA256 = '9f42511c1935940fa9d15b18e2a5910f8cf7b49995e3c3c5ae4a8f8cc2d40716';
/** The sixteen vendored bodies, in the fixture's order: plan Task 2 Step 1's fourteen, then `_limit_score` and
 *  `_avail` (W2 Task 9, for its callers' rows). */
const VENDORED = [
  '_reg_get', '_reg_read', '_authdead', '_cfg_dir', '_limit_json_num', '_limit_field', '_share_pct',
  '_home_measured', '_route_peek', '_route_effort_for', '_route_applied_get', '_route_wanted',
  '_route_pending_word', '_route_apply_pending', '_limit_score', '_avail',
] as const;
/** The live helpers plan Task 2 Step 1 names as the bodies' direct callees. E0c derives the transitive set itself;
 *  this list only proves the derivation sees at least what the plan saw. */
const PLAN_DIRECT_HELPERS = [
  '_route_valid', '_route_get', '_route_inert_has', '_route_pair_note', '_id_wrapper', '_authdead_expired',
  '_route_any', '_ccrc_cfg_dir',
];
/** Live helpers in E0c's closure that call a VENDORED name's LIVE form, which the diet converts by design. Both reach
 *  `_reg_get` from the journaling side of `_route_get` (the non-quiet arm of `_route_effort_for`, and the note floors
 *  under it), which no tick-diet wave converts and no planned row drives: the quiet arm reads `_legacy_route_peek`,
 *  which stays inside the fixture. A row that drives the journaling arm first vendors `_route_get` and
 *  `_route_note_floored` into the fixture (its header says how), so its legacy side reads `_legacy_reg_get`. Any NEW
 *  edge reds E0c. */
const ACCEPTED_EDGES = ['_route_get -> _reg_get', '_route_note_floored -> _reg_get'];

/** Every out-var form the plan's §Interfaces names, with the task that lands it. E1 asserts that the forms `ccd/ccd`
 *  defines are exactly these minus `PENDING`, so a form nobody planned is caught before its callers are. */
const PLANNED_FORMS: Readonly<Record<string, string>> = {
  _now_s_to: 'W1 Task 4 (D-4961)',
  _cfg_dir_to: 'W1 Task 5',
  _limit_text_to: 'W2 Task 8 (D-4962)',
  _limit_num_in_to: 'W2 Task 8 (D-4962)',
  _limit_json_num_to: 'W2 Task 8 (D-4962)',
  _limit_pick_to: 'W2 Task 9 (D-4962)',
  _limit_field_to: 'W2 Task 9 (D-4962)',
  _share_pct_to: 'W2 Task 10 (D-4962)',
  _file_read_to: 'W3 Task 13 (D-4963)',
  _reg_get_to: 'W3 Task 13 (D-4963)',
  _reg_read_to: 'W3 Task 13 (D-4963)',
  _route_peek_to: 'W3 Task 15 (D-4963)',
  _route_effort_for_to: 'W3 Task 15 (D-4963)',
  _route_applied_get_to: 'W3 Task 15 (D-4963)',
  _route_wanted_to: 'W3 Task 15 (D-4963)',
  _route_pending_word_to: 'W3 Task 15 (D-4963)',
  _home_measured_to: 'W3 Task 16 (D-4963)',
};
/** What has NOT landed in `ccd/ccd` yet: the planned forms, plus `_now_s`, the one printing form whose name is new.
 *  The task that lands a name deletes it here in the same commit (the header's "RED FIRST"). D-4961 (Task 4) landed
 *  `_now_s_to` and `_now_s`; Task 5 landed `_cfg_dir_to`; W2 Task 8 (D-4962) landed `_limit_text_to`,
 *  `_limit_num_in_to` and `_limit_json_num_to`; W2 Task 9 (D-4962) landed `_limit_pick_to` and `_limit_field_to`;
 *  W2 Task 10 (D-4962) landed `_share_pct_to`; W3 Task 13 (D-4963) landed `_file_read_to`, `_reg_get_to` and
 *  `_reg_read_to`; W3 Task 15 (D-4963) landed `_route_peek_to`, `_route_effort_for_to`, `_route_applied_get_to`,
 *  `_route_wanted_to` and `_route_pending_word_to`; W3 Task 16 (D-4963) landed `_home_measured_to`; the rest of W3 removes
 *  its own. */
const LANDED: ReadonlySet<string> = new Set([
  '_now_s_to', '_now_s', '_cfg_dir_to', '_limit_text_to', '_limit_num_in_to', '_limit_json_num_to',
  '_limit_pick_to', '_limit_field_to', '_share_pct_to', '_file_read_to', '_reg_get_to', '_reg_read_to',
  '_route_peek_to', '_route_effort_for_to', '_route_applied_get_to', '_route_wanted_to', '_route_pending_word_to',
  '_home_measured_to',
]);
const PENDING: ReadonlySet<string> = new Set(
  [...Object.keys(PLANNED_FORMS), '_now_s'].filter((n) => !LANDED.has(n)),
);

const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
/** Single-quotes one bash word. */
const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
const show = (b: Buffer | string | null): string => {
  const s = b === null ? '<none>' : typeof b === 'string' ? b : b.toString('latin1');
  return JSON.stringify(s.length > 400 ? `${s.slice(0, 400)}…(${s.length} bytes)` : s);
};

// ── function text ───────────────────────────────────────────────────────────────────────────────────────────────────

/** A top-level definition line: `name() {` at column 0, any blanks before the `{` (`_lc_done()   {`). */
const DEF_LINE = /^([A-Za-z_][A-Za-z0-9_]*)\(\)[ \t]*\{/;

interface FnText { name: string; block: string; start: number; end: number }

/** Every top-level function definition, one pass over the lines (`ccd/ccd` has hundreds), with the raw `text` its
 *  block covers and that block's offset range. The STRUCTURE is read from `structure`, the same text with comments and
 *  heredoc bodies blanked (`stripShellComments`, line count kept), so neither can open or close a function.
 *  - A definition line whose code already ends in `}` is a one-liner: `_reg_get` and `_cfg_dir` are.
 *  - A multi-line function ends at the next column-0 `}`, or, when the next definition line comes first, at the last
 *    line above that one whose code ends in `}`: `_lc_intent` closes at the end of its second code line. A function
 *    never swallows the next (E1f). */
function functionsOf(text: string, structure: string = text): FnText[] {
  const out: FnText[] = [];
  const raw = text.split('\n');
  const lines = structure.split('\n');
  const offs: number[] = [];
  raw.reduce((off, l) => { offs.push(off); return off + l.length + 1; }, 0);
  const endsCode = (l: string): boolean => /\}\s*$/.test(l);
  const close = (name: string, from: number, to: number): void => {
    const block = `${raw.slice(from, to + 1).join('\n')}\n`;
    out.push({ name, block, start: offs[from]!, end: offs[from]! + block.length });
  };
  const closeAbove = (o: { name: string; from: number }, i: number): void => {
    let j = i - 1;
    while (j > o.from && !endsCode(lines[j]!)) j--;
    close(o.name, o.from, j > o.from ? j : i - 1);
  };
  let open: { name: string; from: number } | null = null;
  lines.forEach((l, i) => {
    const m = DEF_LINE.exec(l);
    if (m) {
      if (open !== null) closeAbove(open, i);
      open = null;
      if (endsCode(l)) close(m[1]!, i, i);
      else open = { name: m[1]!, from: i };
    } else if (open !== null && l.trimEnd() === '}') {
      close(open.name, open.from, i);
      open = null;
    }
  });
  if (open !== null) closeAbove(open, lines.length);
  return out;
}

const parsed = new Map<string, FnText[]>();
/** One top-level function's raw text, `functionsOf`'s way (comments included, as `git show` has them). `null` when
 *  the file defines no such function. */
function fnBlock(text: string, name: string): string | null {
  let fns = parsed.get(text);
  if (!fns) { fns = functionsOf(text, stripShellComments(text)); parsed.set(text, fns); }
  return fns.find((f) => f.name === name)?.block ?? null;
}

// ── a small shell reader, for the census ───────────────────────────────────────────────────────────────────────────

/** `text` with every shell comment and heredoc body blanked (line count kept), so the census reads code only. Quote
 *  state carries across lines; a `#` starts a comment only at a word start outside quotes. Good enough for `ccd/ccd`'s
 *  style, which is what it reads; E1's synthetic rows pin the shapes it must get right. */
function stripShellComments(text: string): string {
  const out: string[] = [];
  let quote: '' | "'" | '"' | "$'" = '';
  let heredoc: { tag: string; dash: boolean } | null = null;
  for (const line of text.split('\n')) {
    if (heredoc) {
      if ((heredoc.dash ? line.replace(/^\t+/, '') : line) === heredoc.tag) heredoc = null;
      out.push('');
      continue;
    }
    let res = '';
    let pending: { tag: string; dash: boolean } | null = null;
    for (let i = 0; i < line.length;) {
      const c = line[i]!;
      if (quote === "'") { res += c; if (c === "'") quote = ''; i++; continue; }
      if (quote === "$'" || quote === '"') {
        if (c === '\\') { res += line.slice(i, i + 2); i += 2; continue; }
        res += c; if ((quote === '"' && c === '"') || (quote === "$'" && c === "'")) quote = ''; i++; continue;
      }
      if (c === '\\') { res += line.slice(i, i + 2); i += 2; continue; }
      if (c === "'") { quote = "'"; res += c; i++; continue; }
      if (c === '$' && line[i + 1] === "'") { quote = "$'"; res += "$'"; i += 2; continue; }
      if (c === '"') { quote = '"'; res += c; i++; continue; }
      if (c === '#' && (i === 0 || /[\s;|&(]/.test(line[i - 1]!))) break;
      if (c === '<' && line[i + 1] === '<' && line[i + 2] !== '<') {
        const m = /^<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/.exec(line.slice(i));
        if (m) { pending = { tag: m[3]!, dash: m[1] === '-' }; res += m[0]; i += m[0].length; continue; }
      }
      res += c; i++;
    }
    out.push(res);
    if (pending) heredoc = pending;
  }
  return out.join('\n');
}

/** The index just past the balanced `open…close` run that starts at `s[i] === open`, quotes inside honoured. */
function skipBalanced(s: string, i: number, open: string, close: string): number {
  let depth = 0;
  for (let k = i; k < s.length;) {
    const c = s[k]!;
    if (c === '\\') { k += 2; continue; }
    if (c === "'" ) { const j = s.indexOf("'", k + 1); k = j < 0 ? s.length : j + 1; continue; }
    if (c === '"') { k = skipDouble(s, k); continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return k + 1;
    k++;
  }
  return s.length;
}
/** The index just past the double-quoted string that starts at `s[i] === '"'`, nested `$( )` honoured. */
function skipDouble(s: string, i: number): number {
  for (let k = i + 1; k < s.length;) {
    const c = s[k]!;
    if (c === '\\') { k += 2; continue; }
    if (c === '"') return k + 1;
    if (c === '$' && s[k + 1] === '(') { k = skipBalanced(s, k + 1, '(', ')'); continue; }
    k++;
  }
  return s.length;
}
/** One shell word from `i` (leading blanks skipped): `[word, end]`. A word ends at an unquoted blank, newline, `;`,
 *  `&`, `|` or a closing `)`/`}` that is not its own. */
function readWord(s: string, i: number): [string, number] {
  while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++;
  const from = i;
  while (i < s.length) {
    const c = s[i]!;
    if (/[\s;&|)]/.test(c)) break;
    if (c === '\\') { i += 2; continue; }
    if (c === "'") { const j = s.indexOf("'", i + 1); i = j < 0 ? s.length : j + 1; continue; }
    if (c === '$' && s[i + 1] === "'") {
      let k = i + 2;
      while (k < s.length && s[k] !== "'") k += s[k] === '\\' ? 2 : 1;
      i = k + 1; continue;
    }
    if (c === '"') { i = skipDouble(s, i); continue; }
    if (c === '$' && s[i + 1] === '(') { i = skipBalanced(s, i + 1, '(', ')'); continue; }
    if (c === '$' && s[i + 1] === '{') { i = skipBalanced(s, i + 1, '{', '}'); continue; }
    if (c === '(') { i = skipBalanced(s, i, '(', ')'); continue; }
    i++;
  }
  return [s.slice(from, i), i];
}

/** Every variable a function body declares local: each `local`, and each `declare`/`typeset` without `-g` (and not a
 *  `-f`/`-F`/`-p` query), at command position. Read from the comment-stripped body. */
function localsOf(body: string): Set<string> {
  const names = new Set<string>();
  const re = /(^|[\s;&|({])(local|declare|typeset)(?=[ \t])/g;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    let i = m.index + m[0].length;
    const words: string[] = [];
    for (;;) {
      const [w, end] = readWord(body, i);
      if (w === '') break;
      words.push(w); i = end;
    }
    const opts = words.filter((w) => w.startsWith('-')).join('');
    if (m[2] !== 'local' && /[gfFp]/.test(opts)) continue;
    for (const w of words) {
      const n = /^([A-Za-z_][A-Za-z0-9_]*)(?:=|\[|$)/.exec(w);
      if (n && !w.startsWith('-')) names.add(n[1]!);
    }
  }
  return names;
}

interface CensusFinding { kind: 'collision' | 'dynamic' | 'not-a-form'; caller: string; form: string; word: string; via: string[] }

/** Plan Task 2 Step 4: the out-var census over a source text.
 *  - A FORM is a function named `*_to` that writes its out-var: `printf -v "$1"`, or a `local X="$1"; shift` binding
 *    later written with `printf -v "$X"`, or that hands that out-var on as the first argument of another form. A `*_to`
 *    function that is neither is a `not-a-form` finding: the suffix is the convention every reader trusts.
 *  - A form's FORBIDDEN words are its own locals, plus the forbidden words of every form it forwards its out-var to:
 *    the name passes through each of them, and any one of their locals would catch it.
 *  - Each call `F <word>` outside a forward must name a literal variable not in F's forbidden set (`collision`), and
 *    must name it literally (`dynamic`: a census that cannot read the name cannot vouch for it). */
function outVarCensus(source: string): { forms: string[]; findings: CensusFinding[] } {
  const code = stripShellComments(source);
  const fns = functionsOf(code);
  const byName = new Map(fns.map((f) => [f.name, f]));
  const outRef = (body: string): string => /local\s+([A-Za-z_][A-Za-z0-9_]*)="\$1";\s*shift\b/.exec(body)?.[1] ?? '1';
  const isOutWord = (w: string, ref: string): boolean => w === `"$${ref}"` || w === `$${ref}` || w === `"\${${ref}}"`;
  // A call is the form's name at COMMAND position: a line start; after `;` `&` `|` `(` `{` `!`, or a case pattern's
  // `)`; after a keyword that takes a command (`time` and `time -p` included); and behind any assignment or
  // redirection prefixes (`LC_ALL=C <form> v`). So `declare -F <form>` or `command -v <form>` is never read as a call,
  // and neither is `command <form>`, which bash runs with function lookup suppressed (E1b's negative row). A prefix
  // word's pieces start with disjoint characters (`"`, `'`, anything else), so the match stays linear on a long line.
  const word1 = `(?:"(?:[^"\\\\]|\\\\.)*"|'[^']*'|[^\\s;&|()<>"'])`;
  const prefixWord = `(?:[A-Za-z_][A-Za-z0-9_]*(?:\\[[^\\]\\s]*\\])?\\+?=(?:${word1})*|[0-9]*(?:[<>]{1,2}&?|&>>?)[ \\t]*(?:${word1})+)[ \\t]+`;
  const callsIn = (body: string, names: Iterable<string>): { form: string; word: string; at: number }[] => {
    const out: { form: string; word: string; at: number }[] = [];
    for (const n of names) {
      const re = new RegExp(`((?:^[ \\t]*|[;&|(){!][ \\t]*|\\b(?:then|do|else|elif|if|while|until|time(?:[ \\t]+-p)?)[ \\t]+)(?:${prefixWord})*)${n}(?=[ \\t])`, 'gm');
      for (let m = re.exec(body); m; m = re.exec(body)) {
        const [word] = readWord(body, m.index + m[0].length);
        out.push({ form: n, word, at: m.index + m[1]!.length });
      }
    }
    return out;
  };
  const toNames = fns.filter((f) => f.name.endsWith('_to')).map((f) => f.name);
  const forms = new Set<string>();
  for (const n of toNames) {
    const body = byName.get(n)!.block;
    const ref = outRef(body);
    if (body.includes(`printf -v "$${ref}"`) || /\blocal -n\b/.test(body)) forms.add(n);
  }
  for (let grew = true; grew;) {
    grew = false;
    for (const n of toNames) {
      if (forms.has(n)) continue;
      const body = byName.get(n)!.block;
      if (callsIn(body, forms).some((c) => isOutWord(c.word, outRef(body)))) { forms.add(n); grew = true; }
    }
  }
  const findings: CensusFinding[] = [];
  for (const n of toNames) if (!forms.has(n)) findings.push({ kind: 'not-a-form', caller: n, form: n, word: '', via: [] });
  const forwards = (n: string): string[] => {
    const body = byName.get(n)!.block;
    return callsIn(body, forms).filter((c) => isOutWord(c.word, outRef(body))).map((c) => c.form);
  };
  const forbidden = (n: string, seen: string[] = []): Map<string, string[]> => {
    const out = new Map<string, string[]>();
    for (const l of localsOf(byName.get(n)!.block)) out.set(l, [...seen, n]);
    for (const g of forwards(n)) {
      if (seen.includes(g) || g === n) continue;
      for (const [w, via] of forbidden(g, [...seen, n])) if (!out.has(w)) out.set(w, via);
    }
    return out;
  };
  const enclosing = (at: number): string => fns.find((f) => at >= f.start && at < f.end)?.name ?? '<top level>';
  for (const c of callsIn(code, forms)) {
    const caller = enclosing(c.at);
    if (forms.has(caller) && isOutWord(c.word, outRef(byName.get(caller)!.block))) continue;   // a forward
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.word)) {
      findings.push({ kind: 'dynamic', caller, form: c.form, word: c.word, via: [] });
      continue;
    }
    const via = forbidden(c.form).get(c.word);
    if (via) findings.push({ kind: 'collision', caller, form: c.form, word: c.word, via });
  }
  return { forms: [...forms].sort(), findings };
}

// ── the runner ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** One side of a row: a bash function body, run in a subshell whose cwd is the side's own directory. */
interface Side { readonly label: string; readonly body: string }
/** A row: a setup that plants `$REG`/`$LIMITS_DIR` afresh before EACH side, and the sides (legacy first). `needs`
 *  names the live helpers it calls, for the PENDING rule. */
interface Row { readonly id: string; readonly setup?: string; readonly sides: readonly Side[]; readonly needs?: readonly string[] }
interface SideResult {
  ran: boolean; out: Buffer; err: string; rc: number | null; val: Buffer | null; aux: string;
  tree: string[]; setupRc: number | null; setupLog: string; dateLog: string[];
  /** Whatever the body wrote to `$PWD/note`: a probe row's own side channel. */
  note: string;
}
interface Batch { status: number | null; stderr: string; results: Map<string, SideResult[]>; hung: string | null }

/** The rc `BOUNDED` exits with when its alarm fires: a hung batch. */
const HUNG_RC = 142;

/** Bash's own location prefix (`<file>: line N: `), which differs between the fixture and `ccd/ccd` for the same
 *  message; everything after it is compared exactly. */
const normErr = (s: string): string => s.replace(/^[^\n]*?: line \d+: /gm, '');

/** The shadows `__diet_caller` plants: names common as locals in `ccd/ccd`, so a form that writes one of them without
 *  `local` (dynamic scoping) changes the caller's copy, and the aux file shows it. */
const SHADOWS = ['v', 'f', 'val', 'ts', 'now', 'w', 'rc', 'out', 't', 'h', 'e', 'cls', 'deg', 'eff', 'want', 'id', 'x', 'sf'];

/** Variables bash moves on its own between two reads, so a call that does nothing would "change" them (E2a's no-op
 *  side pins the list), plus `BASH_REMATCH`: spec §6.1 accepts its clobber, and each wave audits its readers. */
const FRAME_VOLATILE: ReadonlySet<string> = new Set([
  '_', 'BASH_COMMAND', 'BASH_LINENO', 'BASH_SOURCE', 'BASH_ARGC', 'BASH_ARGV', 'BASH_ARGV0', 'FUNCNAME', 'LINENO',
  'RANDOM', 'SRANDOM', 'SECONDS', 'EPOCHSECONDS', 'EPOCHREALTIME', 'BASH_MONOSECONDS', 'BASHPID', 'PIPESTATUS',
  'BASH_SUBSHELL', 'HISTCMD', 'COLUMNS', 'LINES', 'BASH_REMATCH',
]);
/** The globals a converted helper writes BY DESIGN, each with the §Interfaces entry that declares it: a row's live
 *  side may change these and still equal its legacy side. A name joins only with the interface that declares it. */
const FRAME_MEMOS: ReadonlySet<string> = new Set([
  '_CCD_CFG_DIR_MEMO',   // `_cfg_dir_to`'s per-wrapper memo, for the process's life (plan Task 5)
]);

/** `declare -p`'s listing as name -> its entry. An entry is one line where bash quotes a control byte as `$'…'`
 *  (5.x), and runs on over the lines of a multi-line value where an older bash quotes it with `"…"`. */
function declared(b: Buffer | null): Map<string, string> {
  const m = new Map<string, string>();
  let cur: string | null = null;
  const lines = (b ?? Buffer.alloc(0)).toString('latin1').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();   // the listing's own final newline, which ends no value
  for (const l of lines) {
    const d = /^declare -\S+ ([A-Za-z_][A-Za-z0-9_]*)/.exec(l);
    if (d) { cur = d[1]!; m.set(cur, l); } else if (cur !== null) m.set(cur, `${m.get(cur)!}\n${l}`);
  }
  return m;
}
/** Every variable that existed before the call and changed (value or attributes) or went, as `changed NAME` lines:
 *  the caller frame's own locals (`__dc_*`, `SHADOWS`, the out-var) and the volatile and memo sets aside. */
function frameChanges(before: Buffer | null, after: Buffer | null, outVar: string): string {
  if (before === null || after === null) return '';
  const a = declared(before);
  const b = declared(after);
  const skip = (n: string): boolean => FRAME_VOLATILE.has(n) || FRAME_MEMOS.has(n) || n.startsWith('__dc_')
    || SHADOWS.includes(n) || n === outVar;
  return [...a.keys()].filter((n) => !skip(n) && a.get(n) !== b.get(n)).sort().map((n) => `changed ${n}\n`).join('');
}

/** The batch prelude. `__diet_side` wipes and re-plants the trees, runs the setup and then the body in separate
 *  subshells (so neither leaks into the next side), and moves the trees aside for the node-side comparison.
 *  `__diet_caller var cmd` evaluates `cmd` in a caller frame whose locals are `SHADOWS` (sentinel `__S`), then writes
 *  the out-var's bytes to `val`, and to `aux` every shadow that is not the out-var and every global the call CREATED
 *  (`BASH_REMATCH` excluded: spec §6.1 accepts its clobber, and each wave audits its readers). It lists every variable
 *  with `declare -p` before and after the call, and `runBatch` adds to `aux` each one that existed before and changed
 *  (`frameChanges`): a form that writes a global outside `SHADOWS` is seen too. */
const PRELUDE = `
source "$DIET_CCD" || exit 90
source "$DIET_LEGACY" || exit 91
__diet_side() {
  local __ds_d="$1"
  command rm -rf -- "$REG" "$LIMITS_DIR" "$DIET_TARGETS"
  command mkdir -p -- "$REG" "$LIMITS_DIR" "$DIET_TARGETS" "$__ds_d" || exit 92
  ( cd -- "$__ds_d" && "$2" ) >"$__ds_d/setup.log" 2>&1; printf '%s' "$?" >"$__ds_d/setup.rc"
  ( cd -- "$__ds_d" && DIET_SIDE="$__ds_d" && "$3" ) >"$__ds_d/out" 2>"$__ds_d/err"; printf '%s' "$?" >"$__ds_d/rc"
  command mv -- "$REG" "$__ds_d/reg"; command mv -- "$LIMITS_DIR" "$__ds_d/lim"
}
__diet_caller() {
  local __dc_var="$1" __dc_cmd="$2" __dc_rc=0 __dc_n=
  local ${SHADOWS.map((n) => `${n}=__S`).join(' ')}
  local -- "$__dc_var=__S"
  local -A __dc_seen=()
  while IFS= read -r __dc_n; do __dc_seen[$__dc_n]=1; done < <(compgen -v)
  printf '%s' "$__dc_var" >"$DIET_SIDE/var"; declare -p >"$DIET_SIDE/vars.before"
  eval "$__dc_cmd"; __dc_rc=$?
  declare -p >"$DIET_SIDE/vars.after"
  {
    while IFS= read -r __dc_n; do
      [[ -n "\${__dc_seen[$__dc_n]+x}" || "$__dc_n" == BASH_REMATCH ]] || printf 'leaked %s\\n' "$__dc_n"
    done < <(compgen -v)
    for __dc_n in ${SHADOWS.join(' ')}; do [[ "$__dc_n" == "$__dc_var" ]] || printf '%s=%s\\n' "$__dc_n" "\${!__dc_n}"; done
  } >"$DIET_SIDE/aux"
  printf '%s' "\${!__dc_var}" >"$DIET_SIDE/val"
  return "$__dc_rc"
}
`;

/** The bytes each planted row needs, keyed by sha256; `runBatch` writes them under `$DIET_BLOBS` before the spawn. */
const BLOBS = new Map<string, Buffer>();

/** Bash that plants `row` at `at` (a path under `$REG` or `$LIMITS_DIR`). Link targets live under `$DIET_TARGETS`,
 *  one path for every side, so a tree or a message that names a target reads the same on both sides. */
function plant(row: FileRow, at: string): string {
  const blob = (): string => { const k = sha256(row.bytes); BLOBS.set(k, row.bytes); return `"$DIET_BLOBS/${k}"`; };
  const tgt = (n: string): string => `"$DIET_TARGETS/${n}"`;
  switch (row.shape) {
    case 'regular': return `command cp -- ${blob()} ${at}`;
    case 'absent': return ':';
    case 'directory': return `command mkdir -- ${at}`;
    case 'fifo': return `command mkfifo -- ${at}`;
    case 'mode-000': return `command cp -- ${blob()} ${at} && command chmod 000 ${at}`;
    case 'symlink-regular': return `command cp -- ${blob()} ${tgt('regular')} && command ln -s -- ${tgt('regular')} ${at}`;
    case 'symlink-dangling': return `command ln -s -- ${tgt('missing')} ${at}`;
    case 'symlink-fifo': return `command mkfifo -- ${tgt('fifo')} && command ln -s -- ${tgt('fifo')} ${at}`;
    case 'symlink-devzero': return `command ln -s -- /dev/zero ${at}`;
    case 'parent-unsearchable': {
      const dir = `"$(dirname -- ${at})"`;
      return `command cp -- ${blob()} ${at} && command chmod 600 ${dir}`;
    }
  }
}

/** One side's registry and limits trees, as lines: relative path, type, mode, and size and sha256 for a readable file,
 *  the target for a link. A directory without its owner bits is opened after its mode is recorded. */
function snapshot(root: string): string[] {
  const out: string[] = [];
  const walk = (abs: string, rel: string): void => {
    let st: fs.Stats;
    try { st = fs.lstatSync(abs); } catch { return; }
    const mode = (st.mode & 0o7777).toString(8);
    if (st.isSymbolicLink()) { out.push(`${rel} link ${fs.readlinkSync(abs)}`); return; }
    if (st.isFIFO()) { out.push(`${rel} fifo ${mode}`); return; }
    if (st.isDirectory()) {
      out.push(`${rel} dir ${mode}`);
      if ((st.mode & 0o700) !== 0o700) fs.chmodSync(abs, 0o700);
      for (const n of fs.readdirSync(abs).sort()) walk(path.join(abs, n), `${rel}/${n}`);
      return;
    }
    if (st.isFile()) {
      let sum = 'unreadable';
      try { sum = sha256(fs.readFileSync(abs)); } catch { /* mode 000 as non-root: the mode line says it */ }
      out.push(`${rel} file ${mode} ${st.size} ${sum}`);
      return;
    }
    out.push(`${rel} other ${mode}`);
  };
  walk(root, path.basename(root));
  return out;
}

/** A shim dir holding a `date` that logs to `$DIET_DATE_LOG` (when set) and execs the real one, so a row can see
 *  whether a helper ran `date`. Resolved from the parent's PATH before anything is prepended. */
function plantShims(home: string): string {
  const real = (process.env['PATH'] ?? '').split(':').map((d) => path.join(d, 'date'))
    .find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } });
  if (!real) throw new Error('no `date` on PATH — the clock rows need it');
  const dir = path.join(home, '.diet-shims');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'date'),
    `#!/bin/sh\n[ -n "$DIET_DATE_LOG" ] && printf '%s\\n' "$*" >> "$DIET_DATE_LOG"\nexec ${q(real)} "$@"\n`, { mode: 0o755 });
  return dir;
}

let batchSeq = 0;
/** Runs `rows` in one bounded bash under `locale`, and reads every side back. */
function runBatch(h: CcdHarness, rows: readonly Row[], locale: string, boundS = 120): Batch {
  const ids = new Set<string>();
  for (const r of rows) { if (ids.has(r.id)) throw new Error(`duplicate row id ${r.id}`); ids.add(r.id); }
  const base = path.join(h.home, '.diet', `batch-${++batchSeq}`);
  const blobs = path.join(h.home, '.diet', 'blobs');
  fs.mkdirSync(blobs, { recursive: true });
  const parts = [PRELUDE];
  rows.forEach((row, i) => {
    parts.push(`__diet_u${i}() {\n:\n${row.setup ?? ''}\n}`);
    row.sides.forEach((s, k) => parts.push(`__diet_b${i}_${k}() {\n:\n${s.body}\n}`));
  });
  rows.forEach((row, i) => row.sides.forEach((_s, k) => parts.push(`__diet_side "$DIET_OUT/${i}/${k}" __diet_u${i} __diet_b${i}_${k}`)));
  for (const [k, b] of BLOBS) { const p = path.join(blobs, k); if (!fs.existsSync(p)) fs.writeFileSync(p, b); }
  fs.mkdirSync(base, { recursive: true });
  const script = path.join(base, 'batch.bash');
  fs.writeFileSync(script, `${parts.join('\n')}\n`);
  const shims = plantShims(h.home);
  const r: SpawnSyncReturns<string> = spawnSync('bash', ['-c', `${BOUNDED} ${boundS} bash "$0"`, script], {
    cwd: h.home, encoding: 'utf8', maxBuffer: 64 << 20,
    env: ghContainedEnv(h.home, {
      ...inheritedEnv(), HOME: h.home, CCD_MOUNTINFO: path.join(h.home, FIXTURE_MOUNTINFO), LC_ALL: locale,
      DIET_CCD: CCD, DIET_LEGACY: FIXTURE, DIET_OUT: base, DIET_BLOBS: blobs,
      DIET_TARGETS: path.join(h.home, '.diet', 'targets'), PATH: `${shims}:${process.env['PATH'] ?? ''}`,
    }, { systemd: true, tmux: true }),
  });
  const results = new Map<string, SideResult[]>();
  let hung: string | null = null;
  rows.forEach((row, i) => {
    results.set(row.id, row.sides.map((_s, k) => {
      const d = path.join(base, String(i), String(k));
      const read = (n: string): Buffer | null => { try { return fs.readFileSync(path.join(d, n)); } catch { return null; } };
      const rc = read('rc');
      if (rc === null && hung === null) hung = `${row.id} [${row.sides[k]!.label}]`;
      const setupRc = read('setup.rc');
      return {
        ran: rc !== null, out: read('out') ?? Buffer.alloc(0), err: normErr((read('err') ?? Buffer.alloc(0)).toString('latin1')),
        rc: rc === null ? null : Number(rc.toString()), val: read('val'),
        aux: (read('aux') ?? Buffer.alloc(0)).toString('latin1')
          + frameChanges(read('vars.before'), read('vars.after'), (read('var') ?? Buffer.alloc(0)).toString('latin1')),
        tree: [...snapshot(path.join(d, 'reg')), ...snapshot(path.join(d, 'lim'))],
        setupRc: setupRc === null ? null : Number(setupRc.toString()), setupLog: (read('setup.log') ?? Buffer.alloc(0)).toString('latin1'),
        dateLog: (read('date.log') ?? Buffer.alloc(0)).toString('latin1').split('\n').filter(Boolean),
        note: (read('note') ?? Buffer.alloc(0)).toString('latin1'),
      };
    }));
  });
  if (r.status === 90 || r.status === 91 || r.status === 92) {
    throw new Error(`the batch could not start (rc ${r.status}): ${r.stderr.slice(0, 2000)}`);
  }
  return { status: r.status, stderr: r.stderr, results, hung };
}

/** Every aspect in which two sides differ, rendered for a failure message. Empty means equal. */
function diffSides(a: SideResult, b: SideResult): string[] {
  const d: string[] = [];
  if (!a.ran || !b.ran) d.push(`ran: ${a.ran} vs ${b.ran}`);
  if (!a.out.equals(b.out)) d.push(`stdout: ${show(a.out)} vs ${show(b.out)}`);
  if (a.err !== b.err) d.push(`stderr: ${show(a.err)} vs ${show(b.err)}`);
  if (a.rc !== b.rc) d.push(`rc: ${a.rc} vs ${b.rc}`);
  if ((a.val === null) !== (b.val === null) || (a.val && b.val && !a.val.equals(b.val))) d.push(`out-var: ${show(a.val)} vs ${show(b.val)}`);
  if (a.aux !== b.aux) d.push(`caller frame: ${show(a.aux)} vs ${show(b.aux)}`);
  if (a.tree.join('\n') !== b.tree.join('\n')) d.push(`registry: ${show(a.tree.join(' | '))} vs ${show(b.tree.join(' | '))}`);
  return d;
}

/** A printing-form row: `legacy args` against `live args`, raw stdout and all. */
function printRow(id: string, legacy: string, live: string, args: readonly string[], setup = '', needs: readonly string[] = []): Row {
  const call = (fn: string): string => `__diet_caller v ${q(`${fn} ${args.map(q).join(' ')}`)}`;
  return { id, setup, needs: [live, ...needs], sides: [{ label: legacy, body: call(legacy) }, { label: live, body: call(live) }] };
}
/** An out-var row: `var=$(legacy args); rc=$?` against `to var args; rc=$?`, in a caller frame of shadows. */
function toRow(id: string, legacy: string, to: string, args: readonly string[], setup = '', outVar = 'v'): Row {
  const a = args.map(q).join(' ');
  return {
    id, setup, needs: [to],
    sides: [
      { label: legacy, body: `__diet_caller ${outVar} ${q(`${outVar}=$(${legacy} ${a})`)}` },
      { label: to, body: `__diet_caller ${outVar} ${q(`${to} ${outVar} ${a}`)}` },
    ],
  };
}

const pendingOf = (row: Row): string[] => (row.needs ?? []).filter((n) => PENDING.has(n));

/** The one assertion every differential row makes: equal sides, or, while a helper it needs is PENDING, the red of a
 *  missing function on the live side (`<name>: command not found`, rc 127 for a direct call; a row that goes on past
 *  the missing call fails later, under `set -u`, and that is still the same red). */
function expectEquivalent(row: Row, res: SideResult[], locale: string): void {
  const where = `${row.id} under ${locale}`;
  for (const s of res) {
    expect(s.setupRc, `${where}: the setup failed: ${s.setupLog}`).toBe(0);
  }
  const pending = pendingOf(row);
  const live = res[res.length - 1]!;
  if (pending.length > 0) {
    expect(live.rc, `${where}: PENDING (${pending.join(', ')}), so the live side cannot succeed`).not.toBe(0);
    expect(pending.some((n) => live.err.includes(`${n}: command not found`)),
      `${where}: PENDING (${pending.join(', ')}), but the live side failed for another reason: ${show(live.err)}`).toBe(true);
    return;
  }
  expect(diffSides(res[0]!, live).join('\n'), `${where}: legacy and live differ`).toBe('');
  expect(live.aux, `${where}: the live call left a global behind`).not.toMatch(/^leaked /m);
}

// ── the locale ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** The first UTF-8 locale under which bash counts the two-byte `é` as ONE character: `platform-hazards.test.ts`'s
 *  `LOC` idiom (a test file cannot be imported from another), spawned contained because this is a `ccd*` file. */
const UTF8_LOCALE: string | null = (() => {
  const home = mkTmp('ccrc-diet-loc-');
  for (const loc of ['C.UTF-8', 'en_US.UTF-8']) {
    const r = spawnSync('bash', ['-c', `x=$'\\xc3\\xa9'; printf '%s' "\${#x}"`], {
      encoding: 'utf8', timeout: 15_000,
      env: ghContainedEnv(home, { PATH: process.env['PATH'] ?? '', HOME: home, LC_ALL: loc }, { systemd: true, tmux: true }),
    });
    if (r.status === 0 && r.stdout === '1') return loc;
  }
  return null;
})();
/** Both halves of plan Task 2 Step 3. With no UTF-8 locale the second half is skipped on Darwin, saying so, and reds on
 *  Linux, where the supervisors run under one. */
const LOCALES: readonly { name: string; locale: string | null }[] = [
  { name: 'C', locale: 'C' },
  { name: 'the UTF-8 locale', locale: UTF8_LOCALE },
];
const NO_UTF8 = 'no UTF-8 locale takes effect in bash here (C.UTF-8, en_US.UTF-8)';

/** Runs a contained one-off bash script in `h`'s HOME, bounded, and returns its stdout (throws on a non-zero rc). */
function runScript(h: CcdHarness, script: string, env: NodeJS.ProcessEnv = {}): string {
  const file = path.join(h.home, '.diet', `script-${++batchSeq}.bash`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, script);
  const r = spawnSync('bash', ['-c', `${BOUNDED} 120 bash "$0"`, file], {
    cwd: h.home, encoding: 'utf8', maxBuffer: 64 << 20,
    env: ghContainedEnv(h.home, { ...inheritedEnv(), HOME: h.home, CCD_MOUNTINFO: path.join(h.home, FIXTURE_MOUNTINFO), ...env },
      { systemd: true, tmux: true }),
  });
  if (r.status !== 0) throw new Error(`script rc ${r.status}:\n${r.stderr.slice(0, 4000)}`);
  return r.stdout;
}

// ── E0: the legacy pin ─────────────────────────────────────────────────────────────────────────────────────────────

describe('E0 the frozen legacy bodies are the code the tick diet replaced (tick-diet spec §9, plan Task 2 Step 2)', () => {
  const fixture = fs.readFileSync(FIXTURE, 'utf8');
  const legacySource = (): string => {
    expect(() => execFileSync('git', ['rev-parse', '--verify', '--quiet', `${LEGACY_SHA}^{commit}`], { cwd: REPO, stdio: 'pipe' }),
      `${LEGACY_SHA} is unreachable — this checkout is too shallow to prove the legacy bodies, and a pin that cannot `
      + 'be shown to hold is not a pin').not.toThrow();
    return execFileSync('git', ['show', `${LEGACY_SHA}:ccd/ccd`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 << 20 });
  };
  let h: CcdHarness;
  beforeAll(() => { h = makeCcdHarness('ccrc-diet-e0-'); });
  afterAll(() => h.cleanup());

  it('E0a the fixture is byte-for-byte the frozen file, and its header names the base and every vendored name', () => {
    expect(sha256(fs.readFileSync(FIXTURE)), 'fixtures/tick-diet-legacy.bash changed — it is never edited; restore it '
      + `(each body is \`git show ${LEGACY_SHA.slice(0, 8)}:ccd/ccd\`'s, renamed)`).toBe(FIXTURE_SHA256);
    const header = fixture.split('\n').filter((l) => l.startsWith('#')).join('\n');
    expect(header).toContain(LEGACY_SHA);
    for (const n of VENDORED) expect(header, `the rename map does not name ${n}`).toContain(`\`${n}\``);
    const defined = [...fixture.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)\(\) \{/gm)].map((m) => m[1]);
    expect(defined).toEqual(VENDORED.map((n) => `_legacy${n}`));
  });

  it('E0b each _legacy body, with the rename map reversed, is the base\'s body exactly', () => {
    const base = legacySource();
    const unmap = new RegExp(`\\b_legacy(${VENDORED.join('|')})\\b`, 'g');
    for (const n of VENDORED) {
      const want = fnBlock(base, n);
      expect(want, `${n} is not defined at ${LEGACY_SHA.slice(0, 8)}`).not.toBeNull();
      const got = fnBlock(fixture, `_legacy${n}`);
      expect(got, `the fixture holds no _legacy${n}`).not.toBeNull();
      expect(got!.replace(unmap, '$1'), `_legacy${n} is not ${n} as ${LEGACY_SHA.slice(0, 8)} has it`).toBe(want);
    }
  });

  it('E0c every live helper the legacy bodies reach, transitively, has its base definition at HEAD', () => {
    const old = path.join(h.home, '.diet', 'ccd-legacy-base');
    fs.mkdirSync(path.dirname(old), { recursive: true });
    fs.writeFileSync(old, legacySource());
    // Walks `declare -f` (comment-free) from each `_legacy_X`, through every word that names a function, stopping at a
    // vendored name's live form. Then prints each reached live helper's definition, under the base and under HEAD.
    const walk = `
source "$DIET_BASE" || exit 90
source "$DIET_LEGACY" || exit 91
declare -A __seen=() __vend=()
for __n in $DIET_VENDORED; do __vend[$__n]=1; done
__queue=(); for __n in $DIET_VENDORED; do __queue+=("_legacy$__n"); done
while ((\${#__queue[@]})); do
  __f=\${__queue[0]}; __queue=("\${__queue[@]:1}")
  [[ -n "\${__seen[$__f]+x}" ]] && continue; __seen[$__f]=1
  [[ "$__f" == _legacy_* ]] || printf 'LIVE %s\\n' "$__f"
  while IFS= read -r __w; do
    [[ "$__w" == "$__f" ]] && continue
    declare -F "$__w" >/dev/null || continue
    if [[ -n "\${__vend[$__w]+x}" ]]; then printf 'EDGE %s -> %s\\n' "$__f" "$__w"; continue; fi
    __queue+=("$__w")
  done < <(declare -f "$__f" | command tail -n +2 | command grep -oE '[A-Za-z_][A-Za-z0-9_]*' | command sort -u)
done
`;
    const walked = runScript(h, walk, { DIET_BASE: old, DIET_LEGACY: FIXTURE, DIET_VENDORED: VENDORED.join(' ') })
      .split('\n').filter(Boolean);
    const live = walked.filter((l) => l.startsWith('LIVE ')).map((l) => l.slice(5)).sort();
    const edges = walked.filter((l) => l.startsWith('EDGE ')).map((l) => l.slice(5)).sort();
    expect(edges.filter((e) => e.startsWith('_legacy')),
      'a _legacy body calls a vendored name\'s LIVE form — a missed rename').toEqual([]);
    expect(edges, 'a live helper in the closure calls a converted helper (see ACCEPTED_EDGES)').toEqual([...ACCEPTED_EDGES].sort());
    for (const n of PLAN_DIRECT_HELPERS) expect(live, `the walk missed ${n}, which the plan names`).toContain(n);
    const dump = (src: string): Map<string, string> => {
      const out = runScript(h, `source "$DIET_SRC" || exit 90\nfor __n in $DIET_NAMES; do printf '@@ %s\\n' "$__n"; declare -f "$__n" || printf 'MISSING\\n'; done\n`,
        { DIET_SRC: src, DIET_NAMES: live.join(' ') });
      const m = new Map<string, string>();
      for (const chunk of out.split(/^@@ /m).filter(Boolean)) { const nl = chunk.indexOf('\n'); m.set(chunk.slice(0, nl), chunk.slice(nl + 1)); }
      return m;
    };
    const before = dump(old);
    const now = dump(CCD);
    for (const n of live) {
      expect(now.get(n), `${n} changed since ${LEGACY_SHA.slice(0, 8)}, and a _legacy body reaches it — vendor the base's `
        + `copy into fixtures/tick-diet-legacy.bash as _legacy${n} first (the fixture header says how)`).toBe(before.get(n));
    }
  }, 120_000);
});

// ── E1: the out-var census ─────────────────────────────────────────────────────────────────────────────────────────

/** The plan's W2 limits forms (§Interfaces, abridged to the lines the census reads), `_limit_field_to` renamed in
 *  place with its legacy locals, the printing form, one caller, a commented-out call and a heredoc that spells a call.
 *  The census must read this as five forms and no finding; each mutant below plants one defect. */
const CENSUS_SRC = [
  '_limit_text_to() {   # var file -> rc 0: var = the file\'s text, INSIDE the stated domain | 3: outside it',
  "  local LC_ALL=C __lt_t='' __lt_ran='' __lt_rc __lt_ws=$' \\t\\n\\v\\f\\r'",
  "  printf -v \"$1\" '%s' ''",
  '  [[ -f "$2" && -r "$2" ]] || return 3',
  "  { __lt_ran=1; IFS= read -r -d '' -n 65536 __lt_t; } 2>/dev/null < \"$2\"; __lt_rc=$?",
  "  printf -v \"$1\" '%s' \"$__lt_t\"; return 0",
  '}',
  '_limit_num_in_to() {   # var text key -> rc 0: var = the FIRST match\'s digits | 1: none',
  "  local LC_ALL=C __ln_c=$'[ \\t\\v\\f\\r]*' __ln_re                # literal bytes: a match never crosses a newline",
  '  __ln_re="\\"$3\\"${__ln_c}:${__ln_c}([0-9]+)"',
  "  if [[ \"$2\" =~ $__ln_re ]]; then printf -v \"$1\" '%s' \"${BASH_REMATCH[1]}\"; return 0; fi",
  "  printf -v \"$1\" '%s' ''; return 1",
  '}',
  '_limit_json_num_to() {   # var file key -> var and rc exactly as `v=$(_limit_json_num file key)` leaves them',
  '  local __lj_t __lj_v __lj_rc',
  '  if _limit_text_to __lj_t "$2"; then _limit_num_in_to "$1" "$__lj_t" "$3"; return; fi',
  "  __lj_v=$(grep -oE \"\\\"$3\\\"[[:space:]]*:[[:space:]]*[0-9]+\" \"$2\" | head -1 | grep -oE '[0-9]+$'); __lj_rc=$?   # the legacy pipeline",
  "  printf -v \"$1\" '%s' \"$__lj_v\"; return \"$__lj_rc\"",
  '}',
  '_limit_pick_to() {   # var in text file key',
  '  if [[ -n "$2" ]]; then _limit_num_in_to "$1" "$3" "$5"; else _limit_json_num_to "$1" "$4" "$5"; fi',
  '}',
  '_limit_field_to() {   # var wrapper five|seven [maxage-secs] -> var = that limit %, or "" when unknown',
  '  local __lf_out="$1"; shift; local f="$LIMITS_DIR/$1.json" field="$2" maxage="${3:-0}" val ts now reset __lf_t=\'\' __lf_in=1; printf -v "$__lf_out" \'\'',
  '  [[ -f "$f" ]] || return 0; _limit_text_to __lf_t "$f" || __lf_in=',
  '  _limit_pick_to val "$__lf_in" "$__lf_t" "$f" "$field"',
  '  _limit_pick_to ts "$__lf_in" "$__lf_t" "$f" ts',
  '  printf -v "$__lf_out" \'%s\' "$val"',
  '}',
  "_limit_field() { local __lfw_v; _limit_field_to __lfw_v \"$@\"; printf '%s' \"$__lfw_v\"; }   # the printing form",
  '_avail() {   # wrapper',
  '  local w="$1" five seven',
  '  _limit_field_to five "$w" five 0; _limit_field_to seven "$w" seven 0',
  '  # _limit_field_to val "$w" five 0   <- a comment, never a call',
  '}',
  '_doc() {',
  "  cat <<'TXT'",
  '_limit_field_to val "$w" five 0',
  'TXT',
  '}',
  '',
].join('\n');
const CENSUS_FORMS = ['_limit_field_to', '_limit_json_num_to', '_limit_num_in_to', '_limit_pick_to', '_limit_text_to'];

describe('E1 the out-var census: no call passes a name its form would catch in a local (plan Task 2 Step 4, Review Focus 2)', () => {
  let h: CcdHarness;
  beforeAll(() => { h = makeCcdHarness('ccrc-diet-e1-'); });
  afterAll(() => h.cleanup());

  it('E1a it reads the plan\'s own W2 forms as five forms and no finding, and reads their locals through $\'…\' values', () => {
    expect(outVarCensus(CENSUS_SRC)).toEqual({ forms: CENSUS_FORMS, findings: [] });
    const code = stripShellComments(CENSUS_SRC);
    expect([...localsOf(fnBlock(code, '_limit_text_to')!)].sort()).toEqual(['LC_ALL', '__lt_ran', '__lt_rc', '__lt_t', '__lt_ws']);
    expect([...localsOf(fnBlock(code, '_limit_field_to')!)].sort())
      .toEqual(['__lf_in', '__lf_out', '__lf_t', 'f', 'field', 'maxage', 'now', 'reset', 'ts', 'val']);
  });

  it('E1b it names each planted defect: the plan\'s `_limit_field_to val …`, a collision through a forward, a dynamic name, a `_to` that is no form', () => {
    const plant = (from: string, to: string): string => {
      expect(CENSUS_SRC, `the census source no longer holds ${from}`).toContain(from);
      return CENSUS_SRC.replace(from, () => to);   // a function: a `$'` in the text is no replacement pattern
    };
    expect(outVarCensus(plant('_limit_field_to five "$w" five 0', '_limit_field_to val "$w" five 0')).findings)
      .toEqual([{ kind: 'collision', caller: '_avail', form: '_limit_field_to', word: 'val', via: ['_limit_field_to'] }]);
    expect(outVarCensus(plant('_limit_pick_to ts ', '_limit_pick_to __ln_re ')).findings)
      .toEqual([{ kind: 'collision', caller: '_limit_field_to', form: '_limit_pick_to', word: '__ln_re', via: ['_limit_pick_to', '_limit_num_in_to'] }]);
    expect(outVarCensus(plant('local w="$1" five seven', 'local w="$1" five seven n=five; _limit_field_to "$n" "$w" five 0')).findings)
      .toEqual([{ kind: 'dynamic', caller: '_avail', form: '_limit_field_to', word: '"$n"', via: [] }]);
    expect(outVarCensus(`${CENSUS_SRC}_frob_to() { echo "$1"; }\n`).findings)
      .toEqual([{ kind: 'not-a-form', caller: '_frob_to', form: '_frob_to', word: '', via: [] }]);
    // And the negative: a form named as a WORD, not run, is no call.
    expect(outVarCensus(`${CENSUS_SRC}_has_it() { declare -F _limit_field_to >/dev/null || command -v _limit_pick_to >/dev/null; }\n`).findings)
      .toEqual([]);
  });

  /** Every command position a call can sit in besides a line start and the separators E1b's rows already use. The
   *  case arm is ccd's house style for a one-line dispatch. */
  const CALL_POSITIONS: readonly { position: string; call: string }[] = [
    { position: 'a one-line case arm', call: 'case "$w" in a) _limit_field_to val "$w" five 0 ;; esac' },
    { position: 'an arm of a multi-line case', call: 'case "$w" in\n    a|b) _limit_field_to val "$w" five 0 ;;\n    *) : ;;\n  esac' },
    { position: 'a parenthesised case pattern', call: 'case "$w" in (a) _limit_field_to val "$w" five 0 ;; esac' },
    { position: 'an assignment prefix', call: 'LC_ALL=C _limit_field_to val "$w" five 0' },
    { position: 'two assignment prefixes, one quoted', call: 'X="a b" Y=$\'c\\td\' _limit_field_to val "$w" five 0' },
    { position: 'a redirection prefix', call: '2>/dev/null _limit_field_to val "$w" five 0' },
    { position: '`time`', call: 'time _limit_field_to val "$w" five 0' },
    { position: '`time -p` after `&&`', call: '[[ -n "$w" ]] && time -p _limit_field_to val "$w" five 0' },
  ];
  it.each(CALL_POSITIONS)('E1b a call in $position is read as a call, and its collision named', ({ call }) => {
    const from = '_limit_field_to five "$w" five 0';
    expect(CENSUS_SRC).toContain(from);
    expect(outVarCensus(CENSUS_SRC.replace(from, () => call)).findings)
      .toEqual([{ kind: 'collision', caller: '_avail', form: '_limit_field_to', word: 'val', via: ['_limit_field_to'] }]);
  });

  it('E1b `command <form>` is no call: bash\'s `command` skips functions, so the form never runs', () => {
    const from = '_limit_field_to five "$w" five 0';
    expect(outVarCensus(CENSUS_SRC.replace(from, () => 'command _limit_field_to val "$w" five 0 || :')).findings).toEqual([]);
  });

  /** Definition shapes `ccd/ccd` really uses (`_lc_done()   {`, and `_lc_intent`'s close at the end of a code line),
   *  each hiding a form the census must still see. */
  const DEF_SHAPES: readonly { shape: string; src: string; want: CensusFinding }[] = [
    {
      shape: 'a one-line `_to` with blanks before its `{` that is no form',
      src: '_frob_to()   { echo "$1"; }\n',
      want: { kind: 'not-a-form', caller: '_frob_to', form: '_frob_to', word: '', via: [] },
    },
    {
      shape: 'a multi-line form with blanks before its `{`',
      src: '_frob_to()   {\n  local __fr_v=x\n  printf -v "$1" \'%s\' "$__fr_v"\n}\n_user() { _frob_to __fr_v; }\n',
      want: { kind: 'collision', caller: '_user', form: '_frob_to', word: '__fr_v', via: ['_frob_to'] },
    },
    {
      shape: 'a form after a function whose `}` closes a code line',
      src: '_lc_like() { local a="${1-}"\n             : "$a"; }\n_frob_to() { local __fr_v; printf -v "$1" \'%s\' x; }\n_user() { _frob_to __fr_v; }\n',
      want: { kind: 'collision', caller: '_user', form: '_frob_to', word: '__fr_v', via: ['_frob_to'] },
    },
  ];
  it.each(DEF_SHAPES)('E1e the census reads $shape', ({ src, want }) => {
    expect(outVarCensus(src).findings).toEqual([want]);
  });

  it('E1f the census parses every function ccd/ccd defines, each once, and none swallows the next', () => {
    const code = stripShellComments(fs.readFileSync(CCD, 'utf8'));
    const lines = code.split('\n');
    const defs = lines.flatMap((l) => { const m = DEF_LINE.exec(l); return m ? [m[1]!] : []; });
    expect(defs.length, 'no definition line found — the pattern no longer matches ccd/ccd').toBeGreaterThan(500);
    const fns = functionsOf(code);
    expect(fns.map((f) => f.name), 'a definition the census does not see as its own function').toEqual(defs);
    for (const f of fns) {
      expect(f.block.split('\n').slice(1).filter((l) => DEF_LINE.test(l)), `${f.name}'s block holds another definition`).toEqual([]);
    }
  });

  it('E1c ccd/ccd: its forms are exactly the planned ones that have landed, and no call collides', () => {
    const { forms, findings } = outVarCensus(fs.readFileSync(CCD, 'utf8'));
    const render = (f: CensusFinding): string => `${f.kind}: ${f.caller} calls ${f.form} ${f.word}${f.via.length ? ` (a local of ${f.via.join(' -> ')})` : ''}`;
    expect(findings.map(render).join('\n'), 'an out-var name a form would catch in a local, or one the census cannot read').toBe('');
    expect(forms, 'the out-var forms ccd/ccd defines are not the planned ones minus PENDING — a landed form leaves '
      + 'PENDING in the commit that lands it, and an unplanned one joins PLANNED_FORMS')
      .toEqual(Object.keys(PLANNED_FORMS).filter((n) => !PENDING.has(n)).sort());
  });

  it('E1d PENDING is what ccd/ccd does not define yet, in both directions', () => {
    const names = [...Object.keys(PLANNED_FORMS), '_now_s'];
    const out = runScript(h, `source "$DIET_CCD" || exit 90\nfor __n in $DIET_NAMES; do declare -F "$__n" >/dev/null && printf '%s\\n' "$__n"; done; exit 0\n`,
      { DIET_CCD: CCD, DIET_NAMES: names.join(' ') });
    const defined = new Set(out.split('\n').filter(Boolean));
    for (const n of names) {
      expect(defined.has(n), PENDING.has(n)
        ? `${n} is defined in ccd/ccd but still PENDING — the task that lands it removes it from PENDING`
        : `${n} left PENDING but ccd/ccd does not define it (${PLANNED_FORMS[n] ?? 'W1 Task 4 (D-4961)'})`).toBe(!PENDING.has(n));
    }
  });
});

// ── E2: the runner's own proofs ────────────────────────────────────────────────────────────────────────────────────

describe('E2 the runner can red, isolates every side, and bounds a hang (plan Task 2 Step 3)', () => {
  let h: CcdHarness;
  beforeAll(() => { h = makeCcdHarness('ccrc-diet-e2-'); });
  afterAll(() => h.cleanup());

  it('E2a a difference in stdout, the registry, the out-var or the caller frame is reported, and a leaked or overwritten global is seen', () => {
    const rows: Row[] = [
      { id: 'stdout', sides: [{ label: 'a', body: 'printf a' }, { label: 'b', body: 'printf b' }] },
      { id: 'registry', sides: [{ label: 'a', body: ':' }, { label: 'b', body: 'printf x > "$REG/x.f"' }] },
      { id: 'out-var', sides: [{ label: 'a', body: "__diet_caller v 'v=1'" }, { label: 'b', body: "__diet_caller v 'v=2'" }] },
      { id: 'frame', sides: [{ label: 'a', body: "__diet_caller v ':'" }, { label: 'b', body: "__diet_caller v 'f=clobbered'" }] },
      { id: 'leak', sides: [{ label: 'a', body: "__diet_caller v ':'" }, { label: 'b', body: "__diet_caller v 'diet_leaked=1'" }] },
      // A global that exists before the call and is not one of the SHADOWS: overwritten, and unset.
      { id: 'global', sides: [{ label: 'a', body: "diet_g=0; __diet_caller v ':'" }, { label: 'b', body: "diet_g=0; __diet_caller v 'diet_g=1'" }] },
      { id: 'global-unset', sides: [{ label: 'a', body: "diet_g=0; __diet_caller v ':'" }, { label: 'b', body: "diet_g=0; __diet_caller v 'unset diet_g'" }] },
      { id: 'ccd-global', sides: [{ label: 'a', body: "__diet_caller v ':'" }, { label: 'b', body: "__diet_caller v 'LIMITS_DIR=/elsewhere'" }] },
      // A write a converted helper makes by design (`FRAME_MEMOS`: Task 5's per-wrapper memo) is not a change.
      { id: 'memo', sides: [{ label: 'a', body: "declare -gA _CCD_CFG_DIR_MEMO=(); __diet_caller v ':'" }, { label: 'b', body: "declare -gA _CCD_CFG_DIR_MEMO=(); __diet_caller v '_CCD_CFG_DIR_MEMO[x]=1'" }] },
    ];
    const b = runBatch(h, rows, 'C');
    expect(b.hung).toBeNull();
    const d = (id: string): string[] => { const r = b.results.get(id)!; return diffSides(r[0]!, r[1]!); };
    expect(d('stdout')).toEqual(['stdout: "a" vs "b"']);
    expect(d('registry')).toEqual([expect.stringMatching(/^registry: /)]);
    expect(d('out-var')).toEqual(['out-var: "1" vs "2"']);
    expect(d('frame')).toEqual([expect.stringMatching(/^caller frame: .*f=__S.*f=clobbered/)]);
    expect(b.results.get('leak')![1]!.aux).toMatch(/^leaked diet_leaked$/m);
    expect(b.results.get('leak')![0]!.aux).not.toMatch(/^leaked /m);
    expect(d('global')).toEqual([expect.stringMatching(/^caller frame: .*changed diet_g/)]);
    expect(d('global-unset')).toEqual([expect.stringMatching(/^caller frame: .*changed diet_g/)]);
    expect(d('ccd-global')).toEqual([expect.stringMatching(/^caller frame: .*changed LIMITS_DIR/)]);
    expect(d('memo')).toEqual([]);
    // A call that does nothing changes nothing: every variable bash moves on its own is outside the comparison.
    expect(b.results.get('global')![0]!.aux, 'a no-op call recorded a change').not.toMatch(/^changed /m);
  }, 60_000);

  it('E2b each side starts from a wiped registry and a fresh shell: nothing a side writes or defines reaches the next', () => {
    const probe = '[[ -e "$REG/x.f" ]] && printf seen-file; declare -F diet_stub >/dev/null && printf seen-fn; printf .';
    const rows: Row[] = [
      { id: 'one', sides: [{ label: 'writes', body: 'printf x > "$REG/x.f"; diet_stub() { :; }' }, { label: 'probes', body: probe }] },
      { id: 'two', sides: [{ label: 'probes', body: probe }] },
    ];
    const b = runBatch(h, rows, 'C');
    expect(b.results.get('one')![1]!.out.toString()).toBe('.');
    expect(b.results.get('two')![0]!.out.toString()).toBe('.');
  }, 60_000);

  it('E2c a side that blocks is bounded, and named: the batch ends at its deadline and says which row hung', () => {
    const rows: Row[] = [
      { id: 'before', sides: [{ label: 'ok', body: 'printf ok' }] },
      { id: 'hang', setup: 'command mkfifo -- "$PWD/ff"', sides: [{ label: 'blocked', body: 'read -r x < "$PWD/ff"' }] },
      { id: 'after', sides: [{ label: 'never', body: 'printf never' }] },
    ];
    const t0 = Date.now();
    const b = runBatch(h, rows, 'C', 5);   // 5 s: the row before the hang must finish inside it, on a loaded box too
    expect(b.status, `the batch was not cut at its deadline: ${b.stderr}`).toBe(HUNG_RC);
    expect(b.hung).toBe('hang [blocked]');
    expect(b.results.get('before')![0]!.out.toString()).toBe('ok');
    expect(b.results.get('after')![0]!.ran).toBe(false);
    expect(Date.now() - t0).toBeLessThan(30_000);
  }, 60_000);

  it('E2d stderr is compared after bash\'s own location prefix, and only that, is dropped', () => {
    expect(normErr('/a/ccd/ccd: line 22950: x: bad array subscript\nbash: line 3: y: command not found\n'))
      .toBe('x: bad array subscript\ny: command not found\n');
    expect(normErr('grep: /h/.cc-limits/w.json: Is a directory\n')).toBe('grep: /h/.cc-limits/w.json: Is a directory\n');
  });

  it('E2e the `declare -p` reader sees a change on any line of a multi-line value, as bash 5.1 prints one, and skips the frame\'s own names', () => {
    const before = Buffer.from('declare -- g="1"\ndeclare -- s="a\nb"\ndeclare -- v="__S"\ndeclare -- _="x"\ndeclare -- __dc_rc="0"\n');
    const after = Buffer.from('declare -- g="1"\ndeclare -- s="a\nc"\ndeclare -- v="1"\ndeclare -- _="y"\ndeclare -- __dc_rc="1"\n');
    expect(frameChanges(before, after, 'v')).toBe('changed s\n');
    expect(frameChanges(before, Buffer.from('declare -- s="a\nb"\n'), 'v'), 'a global the call unset').toBe('changed g\n');
  });
});

// ── E3: the W1 rows ────────────────────────────────────────────────────────────────────────────────────────────────

/** `_session_probe`'s direct-branch test, read from the LIVE `ccd/ccd`: the `if …; then` line whose next line runs
 *  `tmux has-session` with no deadline. At `main` it is `[[ $(type -t tmux) == function ]]`; D-4960 makes it
 *  `declare -F tmux >/dev/null`. Reading it, rather than restating either, is what makes E3a a row about the shipped
 *  text. */
function probePredicate(): string {
  const block = fnBlock(fs.readFileSync(CCD, 'utf8'), '_session_probe');
  if (block === null) throw new Error('ccd/ccd defines no _session_probe');
  const lines = block.split('\n');
  const hits = lines.flatMap((l, i) => (/^\s*out=\$\(tmux has-session/.test(lines[i + 1] ?? '')
    ? [/^\s*if (.+); then\s*$/.exec(l)?.[1] ?? ''] : []));
  if (hits.length !== 1 || hits[0] === '') {
    throw new Error(`_session_probe's direct branch is not one \`if …; then\` above \`out=$(tmux has-session\` (found ${hits.length})`);
  }
  return hits[0]!;
}
const LEGACY_PROBE_TEST = '[[ $(type -t tmux) == function ]]';
/** The three shapes `type -t` can give for tmux here, and the branch each must take. */
const TMUX_SHAPES: readonly { shape: string; setup: string; branch: string }[] = [
  { shape: 'a function', setup: 'tmux() { :; }', branch: 'direct' },
  { shape: 'a file on PATH', branch: 'deadline',
    setup: 'unset -f tmux; command mkdir -p -- "$PWD/tbin" && printf \'#!/bin/sh\\n\' > "$PWD/tbin/tmux" && command chmod +x "$PWD/tbin/tmux"; PATH="$PWD/tbin"; hash -r' },
  { shape: 'absent', setup: 'unset -f tmux; PATH="$PWD/no-such-dir"; hash -r', branch: 'deadline' },
];

/** The ids `_cfg_dir_to` is compared over (plan Task 2 Step 5): every id of `DEFAULT_TEST_ROSTER`, the roster
 *  `makeCcdHarness` seeds (derived, so these rows grow with it), an unknown id, an id that a roster id only PREFIXES,
 *  the empty word, a glob, a trailing blank, and a payload that would run if anything evaluated the word as code — it
 *  must create no file. */
const PAYLOAD = 'REG[$(touch "$HOME/PWNED")]';
const CFG_IDS: readonly string[] = [
  ...DEFAULT_TEST_ROSTER.accounts.map((a) => a.id), 'nosuch', 'claude-a-proj', '', '*', 'claude ', PAYLOAD,
];
const label = (s: string): string => (s === '' ? '<empty>' : s === PAYLOAD ? '<payload>' : JSON.stringify(s));

interface ProbeRow extends Row { readonly check: (s: SideResult) => void }

/** The clock rows (D-4961). `_now_s` has no legacy body — its legacy is `$(date +%s)` itself — so each is a probe:
 *  one side, its answer bounded by two real `date` reads taken around it, and the `date` shim's log saying whether the
 *  helper itself ran the `date` that PATH finds (only that one: see the first row). */
function clockRows(): ProbeRow[] {
  const bounded = (call: string, pre = ''): string => [
    pre,
    '__a=$(command date +%s)',
    'DIET_DATE_LOG="$PWD/date.log"; export DIET_DATE_LOG',
    `${call}; __r=$?`,
    'unset DIET_DATE_LOG',
    '__b=$(command date +%s)',
    'printf \'%s %s %s\' "$__a" "$__b" "${EPOCHSECONDS:+epochseconds}" > "$PWD/note"',
    'return "$__r"',
  ].join('\n');
  const within = (s: SideResult, got: string): void => {
    const [a, b] = s.note.split(' ').map(Number);
    expect(got, 'not an epoch').toMatch(/^\d+$/);
    expect(Number(got)).toBeGreaterThanOrEqual(a!);
    expect(Number(got)).toBeLessThanOrEqual(b!);
  };
  const frameClean = (s: SideResult): void => {
    expect(s.aux, 'the call left a global behind').not.toMatch(/^leaked /m);
    expect(s.aux.split('\n').filter(Boolean).every((l) => l.endsWith('=__S')), `the caller frame changed: ${s.aux}`).toBe(true);
  };
  return [
    {
      id: 'now: $EPOCHSECONDS, no date function — the real time, into a caller variable named `now`, with no exec of the `date` on PATH',
      needs: ['_now_s_to'], sides: [{ label: '_now_s_to', body: bounded("__diet_caller now '_now_s_to now'") }],
      check: (s) => {
        expect(s.rc).toBe(0);
        within(s, s.val!.toString());
        frameClean(s);
        // The shim sees only the `date` that PATH finds: a fast path that ran `/bin/date` or `command -p date` would
        // pass here. The fork-budget harness (`ccd-tick-budget.test.ts`) counts every fork a tick makes, and that is
        // where such a fork reds.
        if (s.note.endsWith('epochseconds')) expect(s.dateLog, 'the fast path ran the `date` on PATH').toEqual([]);
      },
    },
    {
      id: 'now: the printing form prints the same epoch, with no trailing newline',
      needs: ['_now_s'], sides: [{ label: '_now_s', body: bounded("__diet_caller v '_now_s'") }],
      check: (s) => { expect(s.rc).toBe(0); within(s, s.out.toString()); frameClean(s); },
    },
    {
      id: 'now: a `date` FUNCTION is honoured by both forms (the stubs of eleven suites)',
      needs: ['_now_s_to', '_now_s'],
      sides: [{ label: 'stubbed', body: "date() { echo 42; }\n__diet_caller now '_now_s_to now'; __r=$?\n_now_s > \"$PWD/note\"\nreturn \"$__r\"" }],
      check: (s) => { expect(s.rc).toBe(0); expect(s.val!.toString()).toBe('42'); expect(s.note).toBe('42'); frameClean(s); },
    },
    {
      id: 'now: with EPOCHSECONDS unset, the `date` path — one exec of `date +%s`, and the real time',
      needs: ['_now_s_to'],
      sides: [{ label: 'unset', body: bounded("__diet_caller now '_now_s_to now'", 'unset EPOCHSECONDS') }],
      check: (s) => {
        expect(s.rc, s.err).toBe(0);
        within(s, s.val!.toString());
        expect(s.dateLog).toEqual(['+%s']);
        frameClean(s);
      },
    },
  ];
}

/** Every W1 row: the probe-branch rows (D-4960), the `_cfg_dir_to` rows (Task 5) and the clock rows (D-4961). */
function w1Rows(): { tmux: (Row & { branch: string })[]; cfg: (Row & { want?: string })[]; clock: ProbeRow[] } {
  const pred = probePredicate();
  const tmux = TMUX_SHAPES.map(({ shape, setup, branch }) => ({
    id: `probe branch: tmux is ${shape}`, branch,
    sides: [LEGACY_PROBE_TEST, pred].map((t, k) => ({
      label: k === 0 ? 'legacy test' : 'live test',
      body: `${setup}\nif ${t}; then printf direct; else printf deadline; fi`,
    })),
  }));
  const cfg: (Row & { want?: string })[] = [];
  for (const id of CFG_IDS) {
    cfg.push(printRow(`_cfg_dir ${label(id)}`, '_legacy_cfg_dir', '_cfg_dir', [id]));
    cfg.push(toRow(`_cfg_dir_to ${label(id)}`, '_legacy_cfg_dir', '_cfg_dir_to', [id]));
  }
  cfg.push(toRow('_cfg_dir_to into `sf`, its call sites\' variable', '_legacy_cfg_dir', '_cfg_dir_to', ['claude-a'], '', 'sf'));
  const seq = (one: (v: string, w: string) => string): string =>
    `__seq() { local a b c d e; ${[['a', 'claude-a'], ['b', 'claude-b'], ['c', 'claude-a'], ['d', ''], ['e', 'claude-b']]
      .map(([v, w]) => one(v!, w!)).join('; ')}; printf '%s|%s|%s|%s|%s' "$a" "$b" "$c" "$d" "$e"; }\n__diet_caller v __seq`;
  cfg.push({
    id: '_cfg_dir_to: two wrappers, the empty word and a repeat in one process each get their own answer',
    needs: ['_cfg_dir_to'],
    sides: [
      { label: 'legacy', body: seq((v, w) => `${v}=$(_legacy_cfg_dir ${q(w)})`) },
      { label: 'live', body: seq((v, w) => `_cfg_dir_to ${v} ${q(w)}`) },
    ],
  });
  const stub = `_cfg_dir() { printf 'stub:%s\\n' "$1"; }`;
  cfg.push({
    id: '_cfg_dir_to: a `_cfg_dir` stub defined before the first call is honoured', want: 'stub:claude-a',
    needs: ['_cfg_dir_to'],
    sides: [
      { label: 'the stub, captured', body: `${stub}\n__diet_caller v 'v=$(_cfg_dir claude-a)'` },
      { label: 'live', body: `${stub}\n__diet_caller v '_cfg_dir_to v claude-a'` },
    ],
  });
  const inFn = (call: string): string => `command bash -c ${q(`f() { source "$1" && source "$2"; }; f "$1" "$2" || exit 9; ${call}`)} _ "$DIET_CCD" "$DIET_LEGACY"`;
  cfg.push({
    id: '_cfg_dir_to: ccd sourced inside a function (its memo must be a global)',
    needs: ['_cfg_dir_to'],
    sides: [
      { label: 'legacy', body: inFn('v=$(_legacy_cfg_dir claude-a); w=$(_legacy_cfg_dir claude-b); x=$(_legacy_cfg_dir claude-a); printf "%s|%s|%s" "$v" "$w" "$x"') },
      { label: 'live', body: inFn('_cfg_dir_to v claude-a; _cfg_dir_to w claude-b; _cfg_dir_to x claude-a; printf "%s|%s|%s" "$v" "$w" "$x"') },
    ],
  });
  return { tmux, cfg, clock: clockRows() };
}

describe.each(LOCALES)('E3 the W1 rows under $name (tick-diet spec §6.2, plan Task 2 Step 5)', ({ locale }) => {
  const rows = w1Rows();
  let h: CcdHarness;
  let batch: Batch | null = null;
  beforeAll(() => {
    h = makeCcdHarness('ccrc-diet-e3-');
    if (locale !== null) batch = runBatch(h, [...rows.tmux, ...rows.cfg, ...rows.clock], locale);
  }, 300_000);
  afterAll(() => h.cleanup());
  /** The batch, or a skip on Darwin / a red on Linux when this half has no locale to run under. */
  const got = (ctx: { skip: (note?: string) => never }): Batch => {
    if (locale === null) {
      if (process.platform === 'darwin') ctx.skip(NO_UTF8);
      throw new Error(`${NO_UTF8} — the supervisors run under one, so this half cannot be skipped here`);
    }
    return batch!;
  };

  it('E3x the batch ran every row to the end, inside its deadline', (ctx) => {
    const b = got(ctx);
    expect(b.hung, `a row never finished: ${b.stderr.slice(0, 2000)}`).toBeNull();
    expect(b.status).toBe(0);
    expect(fs.existsSync(path.join(h.home, 'PWNED')), 'the payload id ran as code').toBe(false);
  });

  it('E3a `_session_probe`\'s direct-branch test agrees with `type -t tmux == function` for a function, a file and nothing (D-4960)', (ctx) => {
    const b = got(ctx);
    for (const row of rows.tmux) {
      const res = b.results.get(row.id)!;
      expectEquivalent(row, res, locale!);
      expect(res[1]!.out.toString(), `${row.id}: the wrong branch`).toBe(row.branch);
    }
  });

  it('E3b `_cfg_dir` and `_cfg_dir_to` answer as `_legacy_cfg_dir` for every id, payload included (plan Task 5)', (ctx) => {
    const b = got(ctx);
    for (const row of rows.cfg) {
      const res = b.results.get(row.id)!;
      expectEquivalent(row, res, locale!);
      if (row.want !== undefined && pendingOf(row).length === 0) expect(res[1]!.val!.toString()).toBe(row.want);
    }
    // Non-vacuity: the legacy sides really answered — a roster id has a config dir, an unknown one has none.
    expect(b.results.get('_cfg_dir_to "claude-a"')![0]!.val!.toString()).toBe(path.join(h.home, '.claude-a'));
    expect(b.results.get('_cfg_dir_to "nosuch"')![0]!.val!.toString()).toBe('');
  });

  it('E3c `_now_s_to` and `_now_s`: the real time without running the `date` on PATH, a `date` function honoured, and the `date` path without EPOCHSECONDS (D-4961)', (ctx) => {
    const b = got(ctx);
    for (const row of rows.clock) {
      const res = b.results.get(row.id)!;
      const s = res[0]!;
      expect(s.setupRc).toBe(0);
      const pending = pendingOf(row);
      if (pending.length > 0) {
        expect(pending.some((n) => s.err.includes(`${n}: command not found`)),
          `${row.id}: PENDING (${pending.join(', ')}), but it failed for another reason: ${show(s.err)}`).toBe(true);
        continue;
      }
      row.check(s);
    }
  });
});

// ── E5: the W2 limits rows (D-4962) ────────────────────────────────────────────────────────────────────────────────

/** Where every limits row plants its file, as the bash word the sides evaluate: `$LIMITS_DIR` is the fixture HOME's
 *  `.cc-limits`, expanded when `__diet_caller` evals the call, never quoted into the call by `q()`. */
const LIM_AT = '"$LIMITS_DIR/diet.json"';
const AS_ROOT = process.getuid?.() === 0;
/** The `LIMITS_ROWS` rows `_limit_json_num` is driven over. Not the shapes an UNGUARDED reader blocks on
 *  (`blocksByName`): grep opens the path by name, legacy and fallback alike, so a FIFO or a link to `/dev/zero` would
 *  hang BOTH sides — `_limit_text_to`'s `-f` refuses them, and the pipeline it hands them to blocks as it always did
 *  (`_limit_field`'s own `-f` is what keeps them off the tick). Under root, not the rows whose meaning needs a non-root
 *  reader either (`needsNonRoot`: root reads a mode-000 file and searches a mode-0600 directory). */
const LIM_ROWS: readonly FileRow[] = LIMITS_ROWS.filter((r) => !blocksByName(r) && !(AS_ROOT && needsNonRoot(r)));
/** The random corpus's seed: the one E4a pins. */
const LIM_SEED = 4962;

/** One side over a whole limits file: the six keys, each through the printing form and then the out-var form, with
 *  every answer, rc and separator on stdout (the helper is defined in the side's body; only its NAME goes through
 *  `__diet_caller`, whose frame of shadows holds `v`). One row per file, rather than twelve, keeps each batch to
 *  seconds: a side's fixed cost (the wiped trees, the subshells, the frame listing) is most of a one-call row. */
const lj6 = (print: string, to: (key: string) => string): string => [
  '__lj6() {',
  '  local k r',
  `  for k in ${LIMIT_KEYS.join(' ')}; do`,
  `    printf '[%s]' "$k"; ${print} ${LIM_AT} "$k"; r=$?; printf '<rc=%s>' "$r"`,
  `    ${to('"$k"')}; r=$?; printf '{%s|%s}\\n' "$v" "$r"`,
  '  done',
  '}',
  '__diet_caller v __lj6',
].join('\n');
const LJ6_LEGACY = lj6('_legacy_limit_json_num', (k) => `v=$(_legacy_limit_json_num ${LIM_AT} ${k})`);
const LJ6_LIVE = lj6('_limit_json_num', (k) => `_limit_json_num_to v ${LIM_AT} ${k}`);

interface DomainRow extends Row { readonly row: FileRow }

/** Every W2 Task 8 row (plan Task 8 Step 1, tick-diet spec §6.3):
 *  - `files`: each `LIMITS_ROWS` file, the six keys through `_limit_json_num` (raw stdout, grep's trailing newline
 *    included) and then `_limit_json_num_to v`, against `_legacy_limit_json_num` and `v=$(_legacy_limit_json_num …)`;
 *  - `named`: `_limit_json_num_to` into `val` (key `five`) and `ts` (key `ts`), `_limit_field`'s own variable names,
 *    one call per row, so the out-var and the caller frame are compared for exactly that call;
 *  - `random`: `randomRows(4962, 500)`, as `files`;
 *  - `domain`: structural, not differential. `_limit_text_to`'s rc says which side of spec §6.3's domain a row fell
 *    on, and a `grep` function says whether `_limit_json_num_to` ran the pipeline. An out-of-domain row that took the
 *    fast path could still give grep's answer (the size cap is a memory bound, not an answer change), so only this
 *    row sees the cap and the regular-and-readable guard go;
 *  - `sigpipe`: structural too, the one rc edge INSIDE the domain (`LIMITS_IN_CAP_SIGPIPE`). The legacy's rc there is
 *    grep's SIGPIPE, a race between grep's writes and `head -1`'s exit, so no differential row can hold it: the side
 *    prints the live answer, `|`, then the legacy's, and notes the domain, the path taken and each rc. */
function w2LimitsRows(): { files: Row[]; named: Row[]; random: Row[]; domain: DomainRow[]; sigpipe: Row } {
  const side = (label: string, cmd: string, outVar: string): Side => ({ label, body: `__diet_caller ${outVar} ${q(cmd)}` });
  const both = (id: string, r: FileRow): Row => ({
    id, setup: plant(r, LIM_AT), needs: ['_limit_json_num_to'],
    sides: [{ label: 'legacy', body: LJ6_LEGACY }, { label: 'live', body: LJ6_LIVE }],
  });
  const named: Row[] = [];
  const domain: DomainRow[] = [];
  for (const r of LIM_ROWS) {
    const setup = plant(r, LIM_AT);
    for (const [ov, k] of [['val', 'five'], ['ts', 'ts']] as const) {
      named.push({
        id: `_limit_json_num_to ${ov} ${r.id} ${k}`, setup, needs: ['_limit_json_num_to'],
        sides: [side('legacy', `${ov}=$(_legacy_limit_json_num ${LIM_AT} ${k})`, ov), side('live', `_limit_json_num_to ${ov} ${LIM_AT} ${k}`, ov)],
      });
    }
    domain.push({
      id: `_limit_text_to ${r.id}`, row: r, setup, needs: ['_limit_text_to', '_limit_json_num_to'],
      sides: [{
        label: 'domain',
        body: [
          'grep() { : > "$PWD/grep.ran"; command grep "$@"; }',
          `__diet_caller t ${q(`_limit_text_to t ${LIM_AT}`)}; __r=$?`,
          `_limit_json_num_to __x ${LIM_AT} five >/dev/null 2>&1`,
          'if [[ -e "$PWD/grep.ran" ]]; then __p=pipeline; else __p=builtins; fi',
          'printf \'%s %s\' "$__r" "$__p" > "$PWD/note"',
          'return "$__r"',
        ].join('\n'),
      }],
    });
  }
  return {
    files: LIM_ROWS.map((r) => both(`six keys, both forms: ${r.id}`, r)),
    named,
    random: randomRows(LIM_SEED, 500).map((r) => both(`six keys, both forms: ${r.id}`, r)),
    domain,
    sigpipe: {
      id: `rc edge: ${LIMITS_IN_CAP_SIGPIPE.id}`, setup: plant(LIMITS_IN_CAP_SIGPIPE, LIM_AT),
      needs: ['_limit_text_to', '_limit_json_num_to'],
      sides: [{
        label: 'edge',
        body: [
          'grep() { : > "$PWD/grep.ran"; command grep "$@"; }',
          `_limit_text_to __t ${LIM_AT}; __d=$?`,
          `_limit_json_num ${LIM_AT} ts; __lr=$?`,
          `_limit_json_num_to __v ${LIM_AT} ts; __vr=$?`,
          'if [[ -e "$PWD/grep.ran" ]]; then __p=pipeline; else __p=builtins; fi',
          'unset -f grep',
          "printf '|'",
          `_legacy_limit_json_num ${LIM_AT} ts; __gr=$?`,
          'printf \'%s %s %s %s %s %s\' "$__d" "$__p" "$__lr" "$__v" "$__vr" "$__gr" > "$PWD/note"',
        ].join('\n'),
      }],
    },
  };
}

describe.each(LOCALES)('E5 the W2 limits rows under $name (tick-diet spec §6.3, D-4962, plan Task 8)', ({ locale }) => {
  const rows = w2LimitsRows();
  let h: CcdHarness;
  let fixed: Batch | null = null;
  let random: Batch | null = null;
  beforeAll(() => {
    h = makeCcdHarness('ccrc-diet-e5-');
    if (locale !== null) {
      fixed = runBatch(h, [...rows.files, ...rows.named, ...rows.domain, rows.sigpipe], locale, 300);
      random = runBatch(h, rows.random, locale, 300);
    }
  }, 700_000);
  afterAll(() => h.cleanup());
  const got = (ctx: { skip: (note?: string) => never }): { fixed: Batch; random: Batch } => {
    if (locale === null) {
      if (process.platform === 'darwin') ctx.skip(NO_UTF8);
      throw new Error(`${NO_UTF8} — the supervisors run under one, so this half cannot be skipped here`);
    }
    return { fixed: fixed!, random: random! };
  };

  it('E5x both batches ran every row to the end, inside their deadlines', (ctx) => {
    for (const b of Object.values(got(ctx))) {
      expect(b.hung, `a row never finished: ${b.stderr.slice(0, 2000)}`).toBeNull();
      expect(b.status).toBe(0);
    }
  });

  it('E5a every limits row, every key: `_limit_json_num` prints, and `_limit_json_num_to` leaves, what the legacy pipeline did (D-4962)', (ctx) => {
    const b = got(ctx).fixed;
    for (const row of rows.files) expectEquivalent(row, b.results.get(row.id)!, locale!);
    // Non-vacuity: the legacy sides really answered — a match prints grep's digits and newline, the spaced writer's
    // last key is read, and a missing file reaches grep, whose own complaint both sides must then share.
    const legacy = (id: string): SideResult => b.results.get(`six keys, both forms: ${id}`)![0]!;
    expect(legacy('compact').out.toString('latin1')).toMatch(/^\[five\]23\n<rc=0>\{23\|0\}\n\[seven\]41\n/);
    expect(legacy('json-dump-spaced').out.toString('latin1')).toMatch(/\[fiveWindowMinutes\]300\n<rc=0>\{300\|0\}\n$/);
    expect(legacy('absent').err).not.toBe('');
    // A value carried WITH a non-zero rc (grep killed by SIGPIPE under `pipefail`): the printing form prints it.
    expect(legacy('over-cap-many-matches').out.toString('latin1')).toMatch(/^\[five\]1\n<rc=[1-9]\d*>\{1\|[1-9]\d*\}\n/);
  });

  it('E5b `_limit_json_num_to` into `val` and `ts`, `_limit_field`\'s own names, one call per row (D-4962)', (ctx) => {
    const b = got(ctx).fixed;
    for (const row of rows.named) expectEquivalent(row, b.results.get(row.id)!, locale!);
    expect(b.results.get('_limit_json_num_to val compact five')![0]!.val!.toString('latin1')).toBe('23');
    expect(b.results.get('_limit_json_num_to ts compact ts')![0]!.val!.toString('latin1')).toBe('1760000000');
  });

  it(`E5c ${LIM_SEED}'s 500 random limits files: both forms, all six keys, as the legacy pipeline (D-4962)`, (ctx) => {
    const b = got(ctx).random;
    for (const row of rows.random) expectEquivalent(row, b.results.get(row.id)!, locale!);
  });

  it('E5d the fast path takes exactly spec §6.3\'s domain, and every other row runs the pipeline (D-4962)', (ctx) => {
    const b = got(ctx).fixed;
    for (const row of rows.domain) {
      const s = b.results.get(row.id)![0]!;
      expect(s.setupRc, `${row.id}: the setup failed: ${s.setupLog}`).toBe(0);
      const pending = pendingOf(row);
      if (pending.length > 0) {
        expect(pending.some((n) => s.err.includes(`${n}: command not found`)),
          `${row.id}: PENDING (${pending.join(', ')}), but it failed for another reason: ${show(s.err)}`).toBe(true);
        continue;
      }
      const inside = inLimitsDomain(row.row);
      expect(s.note, `${row.id}: ${inside ? 'inside' : 'outside'} the domain, so \`_limit_text_to\` answers `
        + `${inside ? 0 : 3} and \`_limit_json_num_to\` runs ${inside ? 'no grep' : 'the pipeline'}`)
        .toBe(inside ? '0 builtins' : '3 pipeline');
      expect(s.val!.equals(inside ? row.row.bytes : Buffer.alloc(0)), `${row.id}: the text read is not the file's bytes`).toBe(true);
      expect(s.aux, `${row.id}: the call left a global behind`).not.toMatch(/^leaked /m);
      expect(s.aux.split('\n').filter(Boolean).every((l) => l.endsWith('=__S')), `${row.id}: the caller frame changed: ${s.aux}`).toBe(true);
    }
    // The edges, by name, so a moved edge reads as itself.
    const note = (id: string): string => b.results.get(`_limit_text_to ${id}`)!.at(0)!.note;
    expect(note('size-65535'), 'size-65535 is inside the 64 KiB cap').toBe('0 builtins');
    for (const id of ['size-65536', 'size-64KiB-plus-1', 'nul-at-end', 'nul-after-lead-byte', 'invalid-utf8', 'non-ascii-elsewhere',
      'directory', 'absent', ...(AS_ROOT ? [] : ['mode-000', 'dir-unsearchable'])]) {
      expect(note(id), `${id} is outside the domain`).toBe('3 pipeline');
    }
  });

  it('E5e the one rc edge inside the domain: a file under the cap whose matches outrun the pipe gets the legacy\'s digits with rc 0, where the legacy\'s grep dies of SIGPIPE (D-4962; D-5040, limit-json-num-in-cap-sigpipe-rc)', (ctx) => {
    const s = got(ctx).fixed.results.get(rows.sigpipe.id)![0]!;
    expect(s.setupRc, `the setup failed: ${s.setupLog}`).toBe(0);
    expect(s.err, 'the edge row wrote to stderr').toBe('');
    expect(inLimitsDomain(LIMITS_IN_CAP_SIGPIPE), 'the corpus states the row inside the domain').toBe(true);
    const [d, p, lr, v, vr, gr] = s.note.split(' ');
    expect({ d, p }, 'inside the domain, so `_limit_text_to` answers 0 and the fast path runs no grep').toEqual({ d: '0', p: 'builtins' });
    // Stdout is the contract every caller reads (each assigns a `$( )`): the printing form prints the legacy's bytes.
    expect(s.out.toString('latin1'), 'live, then `|`, then the legacy: the first match and grep\'s newline on each side').toBe('1\n|1\n');
    expect({ lr, v, vr }, 'the fast core answers the first match with rc 0').toEqual({ lr: '0', v: '1', vr: '0' });
    // The legacy's rc is 141 when grep's later writes find `head -1` gone (measured 141 on every platform the plan
    // names), and 0 only if head drained the pipe first; either way it is not a property of the bytes.
    expect(['0', '141'], `the legacy's rc: ${gr}`).toContain(gr);
  });
});

// ── E6: the W2 share rows (D-4962, plan Task 10) ─────────────────────────────────────────────────────────────────────

/** A fresh `finishedAt`, taken ONCE when the suite loads: both sides of a row then plant identical bytes (the
 *  registry tree is compared), and it stays inside `SHARE_FRESH_S` (8 h) for any run. A literal date would turn every
 *  "fresh" row stale 8 h after it was written, and the non-vacuity rows red. */
const SHARE_FRESH = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const SHARE_STALE = '2020-01-01T00:00:00Z';

function shareFile(finishedAt: string, perAccount: Record<string, unknown>): string {
  const content = JSON.stringify({ finishedAt, perAccount });
  return `command mkdir -p -- "$REG/usage/sweep" && command printf '%s' ${q(content)} > "$REG/usage/sweep/latest.json"`;
}

/** E6a rows: `_share_pct_to` outside the memo scope matches `_legacy_share_pct` for every sweep shape. */
function e6aRows(): Row[] {
  const rows: Row[] = [];
  const add = (id: string, setup: string, outVar = 'v') => {
    rows.push(toRow(`share memo off: ${id}`, '_legacy_share_pct', '_share_pct_to', ['claude-a'], setup, outVar));
  };
  add('fresh 0.5', shareFile(SHARE_FRESH, { 'claude-a': { fableShare: { estimate: 0.5 } } }));
  add('fresh 0.125', shareFile(SHARE_FRESH, { 'claude-a': { fableShare: { estimate: 0.125 } } }));
  add('fresh 0', shareFile(SHARE_FRESH, { 'claude-a': { fableShare: { estimate: 0 } } }));
  add('stale 0.5', shareFile(SHARE_STALE, { 'claude-a': { fableShare: { estimate: 0.5 } } }));
  add('no row', shareFile(SHARE_FRESH, {}));
  add('null', shareFile(SHARE_FRESH, { 'claude-a': { fableShare: { estimate: null } } }));
  add('true', shareFile(SHARE_FRESH, { 'claude-a': { fableShare: { estimate: true } } }));
  add('broken json', `command mkdir -p -- "$REG/usage/sweep" && command printf '%s' 'not json' > "$REG/usage/sweep/latest.json"`);
  add('no file', `command mkdir -p -- "$REG/usage/sweep"`);
  add('directory', `command mkdir -p -- "$REG/usage/sweep/latest.json"`);
  if (!AS_ROOT) add('mode 000', `${shareFile(SHARE_FRESH, { 'claude-a': { fableShare: { estimate: 0.5 } } })} && command chmod 000 "$REG/usage/sweep/latest.json"`);
  // `_serviceable`'s own out-var name, to pin the migrated call site.
  add('fresh 0.5 into fig', shareFile(SHARE_FRESH, { 'claude-a': { fableShare: { estimate: 0.5 } } }), 'fig');
  add('stale 0.5 into fig', shareFile(SHARE_STALE, { 'claude-a': { fableShare: { estimate: 0.5 } } }), 'fig');
  return rows;
}

/** E6b rows: the memo serves a repeat call from one scope without re-running `_share_pct`. */
function e6bRows(): Row[] {
  const sweeps = [
    { id: 'fresh 0.5', setup: shareFile(SHARE_FRESH, { 'claude-a': { fableShare: { estimate: 0.5 } } }) },
    { id: 'stale', setup: shareFile(SHARE_STALE, { 'claude-a': { fableShare: { estimate: 0.5 } } }) },
    { id: 'no row', setup: shareFile(SHARE_FRESH, {}) },
    { id: 'no file', setup: `command mkdir -p -- "$REG/usage/sweep"` },
  ];
  return sweeps.map(({ id, setup }) => ({
    id: `share memo on: ${id}`,
    setup,
    needs: ['_share_pct_to'],
    sides: [
      { label: 'legacy', body: `__diet_caller v 'v=$(_legacy_share_pct claude-a); v=$(_legacy_share_pct claude-a)'` },
      { label: 'live', body: `__diet_caller v '__diet_memo_scope() { local CCD_SHARE_MEMO_ON=1; local -A CCD_SHARE_MEMO=(); _share_pct_to v claude-a; _share_pct_to v claude-a; }; __diet_memo_scope'` },
    ],
  }));
}

/** E6c row: an empty wrapper is no memo key; the shell survives and the call runs each time. */
const E6C_ROW: Row = {
  id: 'share memo on: empty wrapper',
  setup: shareFile(SHARE_FRESH, { 'claude-a': { fableShare: { estimate: 0.5 } } }),
  needs: ['_share_pct_to'],
  sides: [
    { label: 'legacy', body: `__diet_caller v 'v=$(_legacy_share_pct ""); v=$(_legacy_share_pct "")'` },
    { label: 'live', body: `__diet_caller v '__diet_memo_scope() { local CCD_SHARE_MEMO_ON=1; local -A CCD_SHARE_MEMO=(); _share_pct_to v ""; _share_pct_to v ""; }; __diet_memo_scope'` },
  ],
};

describe.each(LOCALES)('E6 the W2 share rows under $name (tick-diet spec §6.3, D-4962, plan Task 10)', ({ locale }) => {
  const rows = [...e6aRows(), ...e6bRows(), E6C_ROW];
  let h: CcdHarness;
  let batch: Batch | null = null;
  beforeAll(() => {
    h = makeCcdHarness('ccrc-diet-e6-');
    if (locale !== null) batch = runBatch(h, rows, locale);
  }, 300_000);
  afterAll(() => h.cleanup());

  const got = (ctx: { skip: (note?: string) => never }): Batch => {
    if (locale === null) {
      if (process.platform === 'darwin') ctx.skip(NO_UTF8);
      throw new Error(`${NO_UTF8} — the supervisors run under one, so this half cannot be skipped here`);
    }
    return batch!;
  };

  it('E6x the batch ran every row to the end, inside its deadline', (ctx) => {
    const b = got(ctx);
    expect(b.hung, `a row never finished: ${b.stderr.slice(0, 2000)}`).toBeNull();
    expect(b.status).toBe(0);
  });

  it('E6a `_share_pct_to` off matches `_legacy_share_pct` for every sweep shape, including `_serviceable`\'s `fig` (D-4962)', (ctx) => {
    const b = got(ctx);
    for (const row of e6aRows()) expectEquivalent(row, b.results.get(row.id)!, locale!);
    // Non-vacuity: python3 really ran in the contained env.
    expect(b.results.get('share memo off: fresh 0.5')![0]!.val!.toString()).toBe('50');
    expect(b.results.get('share memo off: fresh 0.5')![0]!.rc).toBe(0);
    expect(b.results.get('share memo off: stale 0.5')![0]!.rc).toBe(2);
  });

  it('E6b inside one memo scope, a repeat call leaves the legacy value AND rc (the second answer comes from the memo; seams row (a) counts the python3 runs) (D-4962)', (ctx) => {
    const b = got(ctx);
    for (const row of e6bRows()) expectEquivalent(row, b.results.get(row.id)!, locale!);
    // Non-vacuity: the legacy sides really answered with the expected rcs.
    expect(b.results.get('share memo on: stale')![0]!.rc).toBe(2);
    expect(b.results.get('share memo on: no row')![0]!.rc).toBe(1);
    expect(b.results.get('share memo on: no file')![0]!.rc).toBe(1);
  });

  it('E6c an empty wrapper is no memo key: both calls run and the shell survives (D-4962; D-5042, share-memo-empty-key)', (ctx) => {
    const b = got(ctx);
    expectEquivalent(E6C_ROW, b.results.get(E6C_ROW.id)!, locale!);
  });
});

// ── E7: W2 Task 9's rows — `_limit_field_to`, its one read, and its callers (D-4962) ────────────────────────────────

/** The wrapper every E7 call names: `_limit_field diet …` reads `$LIMITS_DIR/diet.json`, where `LIM_AT` plants. */
const LF_W = 'diet';
/** The clocks a `date` FUNCTION answers (plan Task 9 Step 1, "a `date` stub on each side of the resets"), against
 *  `LIMITS_TS` (T): before every reset; past `fiveResetAt` = T+18000 and the five fallback's 18000 s; past
 *  `sevenResetAt` = T+604800 and the seven fallback's 604800 s. `_now_s_to` honours a `date` function (D-4961). */
const LF_CLOCKS: readonly number[] = [LIMITS_TS + 30, LIMITS_TS + 18001, LIMITS_TS + 604801];
/** `maxage`: omitted (`_serviceable`'s two-argument call, written `''`), and the plan's 0, 60 and 999999. */
const LF_MAXAGES: readonly string[] = ['', '0', '60', '999999'];
/** Every `LIMITS_ROWS` row, the blocking shapes included (`_limit_field`'s `-f` comes before any open, legacy and live
 *  alike); under root, not the rows whose meaning needs a non-root reader. */
const LF_ROWS: readonly FileRow[] = LIMITS_ROWS.filter((r) => !(AS_ROOT && needsNonRoot(r)));
/** The live names W2 Task 9 lands; every E7 row needs them. */
const LF_NEEDS: readonly string[] = ['_limit_field_to', '_limit_pick_to'];
/** A `date` function at the first clock, for the one-call rows. */
const LF_STUB = `date() { printf '%s\\n' ${LIMITS_TS + 30}; }`;

/** One side over a whole limits file: every clock x field x maxage. The printing form runs inside `( … )`: the contract
 *  is `$(_limit_field …)`'s stdout and rc, and a bare legacy call would abort its whole side on the leading-zero `ts`
 *  row. Then the out-var form into `v`, set to `__P` first, so a form that does not empty its out-var shows. */
const lfSide = (print: string, to: string, clocks: readonly number[], maxages: readonly string[]): string => [
  '__lfx() {',
  '  local c fl m r',
  `  for c in ${clocks.join(' ')}; do`,
  `    eval "date() { printf '%s\\\\n' $c; }"`,
  '    for fl in five seven; do',
  `      for m in ${maxages.map((m) => (m === '' ? "''" : m)).join(' ')}; do`,
  `        printf '[%s %s %s]' "$c" "$fl" "$m"`,
  `        ( ${print} ${LF_W} "$fl" \${m:+"$m"} ); r=$?; printf '<rc=%s>' "$r"`,
  `        v=__P; ${to}; r=$?; printf '{%s|%s}\\n' "$v" "$r"`,
  '      done',
  '    done',
  '  done',
  '}',
  '__diet_caller v __lfx',
].join('\n');
/** One side of a caller row: `_avail` and `_limit_score` at each clock, called BARE in the side's own shell, as the tick
 *  calls them, so a `_limit_field_to` that aborted its caller's shell would end the side. */
const lfCallers = (avail: string, score: string): string => [
  '__lfc() {',
  '  local c r',
  `  for c in ${LF_CLOCKS.join(' ')}; do`,
  `    eval "date() { printf '%s\\\\n' $c; }"`,
  `    printf '[%s]' "$c"; ${avail} ${LF_W}; r=$?; printf '<avail rc=%s>' "$r"`,
  `    ${score} ${LF_W}; r=$?; printf '<score rc=%s>\\n' "$r"`,
  '  done',
  '}',
  '__diet_caller v __lfc',
].join('\n');

/** Every W2 Task 9 row (plan Task 9 Step 1, tick-diet spec §6.3, D-4962):
 *  - `files`: each limits row, 24 calls (3 clocks x 2 fields x 4 maxages) through both forms, against the legacy;
 *  - `named`: `_limit_field_to` into `five`, `seven` and `fig`, the names its three callers pass;
 *  - `rewrite`: the one-read row. A `_limit_pick_to` shadow rewrites the file after the FIRST key: one read answers from
 *    the text read before it (the legacy over the untouched file), and three reads would not. `control` is the
 *    rewritten file alone, through the legacy: it answers "", so the row can red;
 *  - `callers`: `_avail` and `_limit_score` against `_legacy_avail` and `_legacy_limit_score` (vendored at W2 Task 9),
 *    over E5's `LIM_ROWS` (no blocking shape: `_limit_score`'s `fivewin` read opens the path with no `-f` first);
 *  - `random`: the first 100 of `randomRows(4962, …)`, 4 calls each (the first clock, both fields, maxage 0 and 60). */
function w2FieldRows(): { files: Row[]; named: Row[]; rewrite: Row[]; control: Row; callers: Row[]; random: Row[] } {
  const lf = (id: string, r: FileRow, clocks: readonly number[], maxages: readonly string[]): Row => ({
    id, setup: plant(r, LIM_AT), needs: LF_NEEDS,
    sides: [
      { label: 'legacy', body: lfSide('_legacy_limit_field', `v=$(_legacy_limit_field ${LF_W} "$fl" \${m:+"$m"})`, clocks, maxages) },
      { label: 'live', body: lfSide('_limit_field', `_limit_field_to v ${LF_W} "$fl" \${m:+"$m"}`, clocks, maxages) },
    ],
  });
  const byId = (id: string): FileRow => {
    const r = LIMITS_ROWS.find((x) => x.id === id);
    if (!r) throw new Error(`no LIMITS_ROWS row ${id}`);
    return r;
  };
  const named: Row[] = [];
  for (const id of ['compact', 'absent', 'ts-leading-zero-89']) {
    for (const [ov, fl, m] of [['five', 'five', '0'], ['seven', 'seven', '0'], ['fig', 'seven', '']] as const) {
      const args = m === '' ? `${LF_W} ${fl}` : `${LF_W} ${fl} ${m}`;
      named.push({
        id: `_limit_field_to ${ov} ${id}`, setup: plant(byId(id), LIM_AT), needs: LF_NEEDS,
        sides: [
          { label: 'legacy', body: `${LF_STUB}\n__diet_caller ${ov} ${q(`${ov}=$(_legacy_limit_field ${args})`)}` },
          { label: 'live', body: `${LF_STUB}\n__diet_caller ${ov} ${q(`_limit_field_to ${ov} ${args}`)}` },
        ],
      });
    }
  }
  const { before, after } = LIMITS_REWRITE;
  const shadow = [
    'eval "__diet_real_pick_to() $(declare -f _limit_pick_to | command tail -n +2)"',
    '_limit_pick_to() {',
    '  __diet_real_pick_to "$@"; local __r=$?',
    '  if [[ ! -e "$PWD/swapped" ]]; then',
    '    : > "$PWD/swapped"; command cp -- "$DIET_TARGETS/after" "$LIMITS_DIR/diet.json"; printf swapped > "$PWD/note"',
    '  fi',
    '  return "$__r"',
    '}',
  ].join('\n');
  const legacyFive60 = `${LF_STUB}\n__diet_caller v ${q(`v=$(_legacy_limit_field ${LF_W} five 60)`)}`;
  const rewrite: Row[] = [{
    id: 'rewrite between reads', needs: LF_NEEDS,
    setup: [plant(before, LIM_AT), plant(after, '"$DIET_TARGETS/after"'), plant(before, '"$DIET_TARGETS/before"')].join('\n'),
    sides: [
      { label: 'legacy', body: legacyFive60 },
      {
        label: 'live',
        // The file is put back after the call, so the two sides' limits trees compare equal.
        body: [shadow, LF_STUB, `__diet_caller v ${q(`_limit_field_to v ${LF_W} five 60`)}; __r=$?`,
          'command cp -- "$DIET_TARGETS/before" "$LIMITS_DIR/diet.json"', 'return "$__r"'].join('\n'),
      },
    ],
  }];
  const control: Row = { id: 'rewrite control: the rewritten file alone', setup: plant(after, LIM_AT), sides: [{ label: 'legacy', body: legacyFive60 }] };
  return {
    files: LF_ROWS.map((r) => lf(`_limit_field 24 calls, both forms: ${r.id}`, r, LF_CLOCKS, LF_MAXAGES)),
    named,
    rewrite,
    control,
    // Not the blocking shapes: `_limit_score`'s `fivewin` read is `_limit_json_num` with no `-f` first, so a FIFO or a
    // link to /dev/zero would block BOTH sides (E5's `LIM_ROWS` rule).
    callers: LIM_ROWS.map((r): Row => ({
      id: `_avail and _limit_score: ${r.id}`, setup: plant(r, LIM_AT), needs: LF_NEEDS,
      sides: [{ label: 'legacy', body: lfCallers('_legacy_avail', '_legacy_limit_score') }, { label: 'live', body: lfCallers('_avail', '_limit_score') }],
    })),
    random: randomRows(LIM_SEED, 100).map((r) => lf(`_limit_field 4 calls, both forms: ${r.id}`, r, [LIMITS_TS + 30], ['0', '60'])),
  };
}

describe.each(LOCALES)('E7 W2 Task 9 under $name: `_limit_field_to`, its one read, its callers (tick-diet spec §6.3, D-4962)', ({ locale }) => {
  const rows = w2FieldRows();
  let h: CcdHarness;
  let fixed: Batch | null = null;
  let random: Batch | null = null;
  beforeAll(() => {
    h = makeCcdHarness('ccrc-diet-e7-');
    if (locale !== null) {
      fixed = runBatch(h, [...rows.files, ...rows.named, ...rows.rewrite, rows.control, ...rows.callers], locale, 600);
      random = runBatch(h, rows.random, locale, 600);
    }
  }, 1_300_000);
  afterAll(() => h.cleanup());
  const got = (ctx: { skip: (note?: string) => never }): { fixed: Batch; random: Batch } => {
    if (locale === null) {
      if (process.platform === 'darwin') ctx.skip(NO_UTF8);
      throw new Error(`${NO_UTF8} — the supervisors run under one, so this half cannot be skipped here`);
    }
    return { fixed: fixed!, random: random! };
  };
  const out = (b: Batch, id: string): string => b.results.get(id)![0]!.out.toString('latin1');
  const T = LIMITS_TS;

  it('E7x both batches ran every row to the end, inside their deadlines', (ctx) => {
    for (const b of Object.values(got(ctx))) {
      expect(b.hung, `a row never finished: ${b.stderr.slice(0, 2000)}`).toBeNull();
      expect(b.status).toBe(0);
    }
  });

  it('E7a every limits row, 3 clocks x both fields x 4 maxages: `_limit_field` prints, and `_limit_field_to` leaves, what the legacy did (D-4962)', (ctx) => {
    const b = got(ctx).fixed;
    for (const row of rows.files) expectEquivalent(row, b.results.get(row.id)!, locale!);
    // Non-vacuity: the legacy sides really answered — a fresh value, a reset window, an emptied out-var, the abort.
    const leg = (id: string): string => out(b, `_limit_field 24 calls, both forms: ${id}`);
    expect(leg('compact')).toContain(`[${T + 30} five ]23<rc=0>{23|0}\n`);
    expect(leg('compact')).toContain(`[${T + 30} seven 60]41<rc=0>{41|0}\n`);
    expect(leg('compact')).toContain(`[${T + 18001} five 0]<rc=0>{|0}\n`);
    expect(leg('compact')).toContain(`[${T + 18001} seven 0]41<rc=0>{41|0}\n`);
    expect(leg('absent')).toContain(`[${T + 30} five 0]<rc=0>{|0}\n`);
    expect(leg('ts-leading-zero-89')).toContain(`[${T + 30} five 0]<rc=1>{|1}\n`);
    expect(b.results.get('_limit_field 24 calls, both forms: ts-leading-zero-89')![0]!.err).toContain('value too great for base');
  });

  it('E7b `_limit_field_to` into `five`, `seven` and `fig`, the names its three callers pass, one call per row (D-4962)', (ctx) => {
    const b = got(ctx).fixed;
    for (const row of rows.named) expectEquivalent(row, b.results.get(row.id)!, locale!);
    expect(b.results.get('_limit_field_to five compact')![0]!.val!.toString('latin1')).toBe('23');
    expect(b.results.get('_limit_field_to fig compact')![0]!.val!.toString('latin1')).toBe('41');
    expect(b.results.get('_limit_field_to five ts-leading-zero-89')![0]!.rc).toBe(1);
  });

  it('E7c the one read: a file rewritten after the first key still answers from the text read before it (D-4962)', (ctx) => {
    const b = got(ctx).fixed;
    for (const row of rows.rewrite) expectEquivalent(row, b.results.get(row.id)!, locale!);
    const [legacy, live] = b.results.get('rewrite between reads')!;
    expect(legacy!.val!.toString('latin1'), 'the file before the rewrite answers 50').toBe('50');
    expect(live!.note, 'the shadow rewrote the file after the first key').toBe('swapped');
    expect(b.results.get(rows.control.id)![0]!.val!.toString('latin1'),
      'the rewritten file alone answers "", so a second read of the file would have changed the answer').toBe('');
  });

  it('E7d `_avail` and `_limit_score`, called bare as the tick calls them, answer as their vendored legacy (D-4962)', (ctx) => {
    const b = got(ctx).fixed;
    for (const row of rows.callers) expectEquivalent(row, b.results.get(row.id)!, locale!);
    const leg = (id: string): string => out(b, `_avail and _limit_score: ${id}`);
    expect(leg('compact')).toContain(`[${T + 30}]<avail rc=0>41<score rc=0>\n`);
    expect(leg('five-at-ceiling')).toContain(`[${T + 30}]<avail rc=1>98<score rc=0>\n`);
    expect(leg('ts-leading-zero-89')).toContain(`[${T + 30}]<avail rc=0><score rc=0>\n`);
  });

  it(`E7e the first 100 of ${LIM_SEED}'s random limits files: both forms, both fields, maxage 0 and 60 (D-4962)`, (ctx) => {
    const b = got(ctx).random;
    for (const row of rows.random) expectEquivalent(row, b.results.get(row.id)!, locale!);
  });
});

// ── E8: W3 Task 13's registry rows — `_file_read_to`, `_reg_get_to`, `_reg_read_to` (D-4963) ───────────────────────

/** Where every registry row plants its field: `$REG/diet.f`, so the helpers read id `diet`, field `f` (E4d's path). */
const REG_AT = '"$REG/diet.f"';
/** W3's random corpus seed (E4a pins that it draws other rows than W2's 4962). */
const REG_SEED = 4963;
/** Every `REGISTRY_ROWS` row, the blocking shapes INCLUDED: both readers ask their type checks (`-L`, `-f`) before
 *  any open, legacy and live alike, so a FIFO or a link to /dev/zero is never opened, and a hang here is the finding
 *  (plan Review Focus 6), which the batch's bound names. Under root, not the rows whose meaning needs a non-root
 *  reader (`needsNonRoot`). */
const RG_ROWS: readonly FileRow[] = REGISTRY_ROWS.filter((r) => !(AS_ROOT && needsNonRoot(r)));
/** The live names W3 Task 13 lands; every E8 row needs them. */
const RG_NEEDS: readonly string[] = ['_file_read_to', '_reg_get_to', '_reg_read_to'];
const regRow = (id: string): FileRow => {
  const r = REGISTRY_ROWS.find((x) => x.id === id);
  if (!r) throw new Error(`no REGISTRY_ROWS row ${id}`);
  return r;
};

/** One side over one field: four calls, each answer and rc on stdout.
 *  - `_reg_get` through `$( )`, which is how every call site in `ccd/ccd` reads it (E8d; its raw stdout is E8f's);
 *  - the `_to` form into `v`, set to `__P` first, so a form that does not empty its out-var shows;
 *  - `_reg_read`'s RAW stdout: its legacy body already printed `$(cat)`'s value, so its printing contract is raw;
 *  - `_reg_read_to` into `rv`, set to `__P` first. NOT into `v`: `_reg_read_to` is `_reg_read` renamed in place, and
 *    keeps its legacy locals `f` and `v` (plan §Interfaces), so `v` is a name it would catch in its own local and the
 *    caller's `v` would keep `__P` (measured; E8g holds the census that forbids it; D-5268). */
const rg4 = (get: string, getTo: string, read: string, readTo: string): string => [
  '__rg4() {',
  '  local r rv',
  `  v=$(${get} diet f); r=$?; printf '[get %s|%s]\\n' "$v" "$r"`,
  `  v=__P; ${getTo}; r=$?; printf '[get_to %s|%s]\\n' "$v" "$r"`,
  `  ${read} diet f; r=$?; printf '<read rc=%s>\\n' "$r"`,
  `  rv=__P; ${readTo}; r=$?; printf '[read_to %s|%s]\\n' "$rv" "$r"`,
  '}',
  '__diet_caller v __rg4',
].join('\n');
const RG4_LEGACY = rg4('_legacy_reg_get', 'v=$(_legacy_reg_get diet f)', '_legacy_reg_read', 'rv=$(_legacy_reg_read diet f)');
const RG4_LIVE = rg4('_reg_get', '_reg_get_to v diet f', '_reg_read', '_reg_read_to rv diet f');

/** The open-failure ladder's driver (plan Task 13, its last mutation row): the field is deleted between the type
 *  check and the open. The legacy side's `cat` is a function that deletes its last argument first; the live side's
 *  `_file_read_to` is a shadow that does the same and then runs the real one. Each writes `vanished` to its note, so
 *  a side that never reached the open reds by name. The shadow is planted only when `_file_read_to` exists: before it
 *  lands, the live side reads through the legacy `cat` and answers rc 0, which is this row's red. */
const VANISH_LEGACY = 'cat() { command rm -f -- "${@: -1}"; printf vanished > "$PWD/note"; command cat "$@"; }';
const VANISH_LIVE = [
  'if declare -F _file_read_to >/dev/null; then',
  '  eval "__diet_real_file_read_to() $(declare -f _file_read_to | command tail -n +2)"',
  '  _file_read_to() { command rm -f -- "$2"; printf vanished > "$PWD/note"; __diet_real_file_read_to "$@"; }',
  'fi',
].join('\n');

/** The rows whose `_reg_get` RAW stdout differs from the legacy `cat`'s (E8f, D-5268): a readable regular field that ends in
 *  a newline or holds a NUL. `$( )` drops both, every call site reads through one (E8d), and the printing form prints
 *  what `$( )` leaves. */
const rawGetDiverges = (r: FileRow): boolean =>
  r.shape === 'regular' && (r.bytes.includes(0) || (r.bytes.length > 0 && r.bytes[r.bytes.length - 1] === 0x0a));

/** Every W3 Task 13 row (plan Task 13 Step 1, tick-diet spec §6.4):
 *  - `files`: each `REGISTRY_ROWS` row through `rg4`, against the legacy;
 *  - `named`: the `_to` forms into the variables the tick's hot sites pass (plan Task 14's table), one call per row, so
 *    the out-var and the caller frame are compared for exactly that call;
 *  - `random`: `randomRows(4963, 500)`, as `files`;
 *  - `vanish`: the ladder (above), for `_reg_read`, `_reg_read_to` and `_reg_get_to`;
 *  - `raw`: structural, `_reg_get`'s raw stdout against the legacy's raw bytes and its captured value (E8f). */
function w3RegRows(): { files: Row[]; named: Row[]; random: Row[]; vanish: Row[]; raw: DomainRow[] } {
  const both = (id: string, r: FileRow): Row => ({
    id, setup: plant(r, REG_AT), needs: RG_NEEDS,
    sides: [{ label: 'legacy', body: RG4_LEGACY }, { label: 'live', body: RG4_LIVE }],
  });
  const named: Row[] = [];
  const NAMED_IDS = ['plain', 'three-newlines', 'nul-inside', 'missing-field', 'symlink-regular', ...(AS_ROOT ? [] : ['mode-000'])];
  for (const id of NAMED_IDS) {
    const setup = plant(regRow(id), REG_AT);
    for (const ov of ['last', 'scan', 'blocked', 'lastswap', 'wrapper']) {
      named.push(toRow(`_reg_get_to ${ov} ${id}`, '_legacy_reg_get', '_reg_get_to', ['diet', 'f'], setup, ov));
    }
    named.push(toRow(`_reg_read_to wrapper ${id}`, '_legacy_reg_read', '_reg_read_to', ['diet', 'f'], setup, 'wrapper'));
  }
  const vanish = ([
    ['_reg_read', 'v', '_legacy_reg_read diet f', '_reg_read diet f'],
    ['_reg_read_to', 'rv', 'rv=$(_legacy_reg_read diet f)', '_reg_read_to rv diet f'],
    ['_reg_get_to', 'v', 'v=$(_legacy_reg_get diet f)', '_reg_get_to v diet f'],
  ] as const).map(([fn, ov, legacy, live]): Row => ({
    id: `vanish: ${fn}`, setup: plant(regRow('plain'), REG_AT), needs: RG_NEEDS,
    sides: [
      { label: 'legacy', body: `${VANISH_LEGACY}\n__diet_caller ${ov} ${q(legacy)}` },
      { label: 'live', body: `${VANISH_LIVE}\n__diet_caller ${ov} ${q(live)}` },
    ],
  }));
  const raw = RG_ROWS.map((r): DomainRow => ({
    id: `_reg_get raw: ${r.id}`, row: r, setup: plant(r, REG_AT), needs: RG_NEEDS,
    sides: [{
      label: 'raw',
      body: [
        '_reg_get diet f > "$PWD/live.raw"; __a=$?',
        '_legacy_reg_get diet f > "$PWD/legacy.raw"; __b=$?',
        '__v=$(_legacy_reg_get diet f) 2>/dev/null; printf \'%s\' "$__v" > "$PWD/legacy.cap"',
        'if command cmp -s "$PWD/live.raw" "$PWD/legacy.raw"; then __r=raw-equal; else __r=raw-differs; fi',
        'if command cmp -s "$PWD/live.raw" "$PWD/legacy.cap"; then __c=captured; else __c=not-captured; fi',
        'printf \'%s %s %s %s\' "$__r" "$__c" "$__a" "$__b" > "$PWD/note"',
      ].join('\n'),
    }],
  }));
  return {
    files: RG_ROWS.map((r) => both(`registry, four calls: ${r.id}`, r)),
    named,
    random: randomRows(REG_SEED, 500).map((r) => both(`registry, four calls: ${r.id}`, r)),
    vanish,
    raw,
  };
}

/** Every `_reg_get` call in `src`'s code that is NOT the first word of a command substitution, as `line: text`: a
 *  caller that would see the printing form's raw stdout, which E8f states differs from the legacy `cat`'s for a field
 *  ending in a newline or holding a NUL. The definition is no call, and a word right after a backquote is the head of
 *  the old-style substitution (it is also how prose inside a quoted program text, which `stripShellComments` keeps,
 *  names the helper). Conservative: a call inside a `$( )` but not at its head is reported. */
function rawRegGetCalls(src: string): string[] {
  const out: string[] = [];
  stripShellComments(src).split('\n').forEach((l, i) => {
    for (const m of l.matchAll(/(^|[^A-Za-z0-9_])_reg_get(?![A-Za-z0-9_])/g)) {
      const at = (m.index ?? 0) + m[1]!.length;
      if (/^_reg_get\(\)/.test(l.slice(at))) continue;
      if (!/(?:\$\(\s*|`)$/.test(l.slice(0, at))) out.push(`${i + 1}: ${l.trim()}`);
    }
  });
  return out;
}

describe('E8d no call site reads `_reg_get`\'s raw stdout: every call is the head of a `$( )` (D-4963)', () => {
  it('E8d ccd/ccd calls `_reg_get` only as `$(_reg_get …)`, and the census names a raw call when one is planted', () => {
    const src = fs.readFileSync(CCD, 'utf8');
    const code = stripShellComments(src);
    const calls = (code.match(/(^|[^A-Za-z0-9_])_reg_get(?![A-Za-z0-9_(])/gm) ?? []).length;
    expect(calls, 'the census found no call — its pattern no longer matches ccd/ccd').toBeGreaterThan(100);
    expect(rawRegGetCalls(src), 'a `_reg_get` call outside a `$( )` reads the printing form\'s raw stdout, which drops '
      + 'a field\'s trailing newlines and NULs (E8f) — capture it, or call `_reg_get_to`').toEqual([]);
    // The census's own red: one raw call, and one inside a `$( )` but behind another word, each named.
    const planted = `${src}\n_diet_raw() { _reg_get "$1" f > "$2"; x=$(LC_ALL=C _reg_get "$1" f); }\n`;
    expect(rawRegGetCalls(planted)).toEqual([
      `${planted.split('\n').length - 1}: _diet_raw() { _reg_get "$1" f > "$2"; x=$(LC_ALL=C _reg_get "$1" f); }`,
      `${planted.split('\n').length - 1}: _diet_raw() { _reg_get "$1" f > "$2"; x=$(LC_ALL=C _reg_get "$1" f); }`,
    ]);
  });
});

describe('E8g the out-var census forbids the legacy locals `_reg_read_to` kept in place (plan §Interfaces, D-4963)', () => {
  it('E8g a caller passing `v` or `f` to `_reg_read_to` is a named collision, and ccd/ccd has none', () => {
    const src = fs.readFileSync(CCD, 'utf8');
    expect(outVarCensus(src).forms, 'the census does not see `_reg_read_to` as a form').toContain('_reg_read_to');
    const planted = `${src}\n_diet_v() { local w; _reg_read_to v "$1" wrapper; _reg_read_to f "$1" wrapper; _reg_read_to w "$1" wrapper; }\n`;
    expect(outVarCensus(planted).findings.filter((f) => f.caller === '_diet_v')).toEqual([
      { kind: 'collision', caller: '_diet_v', form: '_reg_read_to', word: 'v', via: ['_reg_read_to'] },
      { kind: 'collision', caller: '_diet_v', form: '_reg_read_to', word: 'f', via: ['_reg_read_to'] },
    ]);
  });
});

describe.each(LOCALES)('E8 W3 Task 13 under $name: `_reg_get`, `_reg_read` and their `_to` forms (tick-diet spec §6.4, D-4963)', ({ locale }) => {
  const rows = w3RegRows();
  let h: CcdHarness;
  let fixed: Batch | null = null;
  let random: Batch | null = null;
  beforeAll(() => {
    h = makeCcdHarness('ccrc-diet-e8-');
    if (locale !== null) {
      fixed = runBatch(h, [...rows.files, ...rows.named, ...rows.vanish, ...rows.raw], locale, 600);
      random = runBatch(h, rows.random, locale, 600);
    }
  }, 1_300_000);
  afterAll(() => h.cleanup());
  const got = (ctx: { skip: (note?: string) => never }): { fixed: Batch; random: Batch } => {
    if (locale === null) {
      if (process.platform === 'darwin') ctx.skip(NO_UTF8);
      throw new Error(`${NO_UTF8} — the supervisors run under one, so this half cannot be skipped here`);
    }
    return { fixed: fixed!, random: random! };
  };
  const out = (b: Batch, id: string): string => b.results.get(id)![0]!.out.toString('latin1');

  it('E8x both batches ran every row to the end, inside their deadlines: no reader opened a FIFO or /dev/zero', (ctx) => {
    for (const b of Object.values(got(ctx))) {
      expect(b.hung, `a row never finished: ${b.stderr.slice(0, 2000)}`).toBeNull();
      expect(b.status).toBe(0);
    }
  });

  it('E8a every registry row: `$(_reg_get)`, `_reg_get_to`, `_reg_read` and `_reg_read_to` leave what the legacy `cat` did (D-4963)', (ctx) => {
    const b = got(ctx).fixed;
    for (const row of rows.files) expectEquivalent(row, b.results.get(row.id)!, locale!);
    // Non-vacuity: the legacy sides really answered — every trailing newline stripped, a NUL dropped, a resolving
    // link refused by both readers, a vanished registry and an unreadable field told apart by `_reg_read`.
    const leg = (id: string): string => out(b, `registry, four calls: ${id}`);
    expect(leg('three-newlines')).toBe('[get abc|0]\n[get_to abc|0]\nabc<read rc=0>\n[read_to abc|0]\n');
    expect(leg('nul-inside')).toContain('[get ab|0]\n');
    expect(leg('symlink-regular')).toBe('[get |1]\n[get_to |1]\n<read rc=2>\n[read_to |2]\n');
    expect(leg('missing-field')).toBe('[get |1]\n[get_to |1]\n<read rc=1>\n[read_to |1]\n');
    expect(leg('fifo')).toContain('<read rc=2>\n');
    if (!AS_ROOT) {
      expect(leg('mode-000')).toBe('[get |1]\n[get_to |1]\n<read rc=2>\n[read_to |2]\n');
      expect(leg('reg-unsearchable')).toContain('<read rc=2>\n');
    }
    expect(b.results.get('registry, four calls: nul-inside')![0]!.err).toContain('ignored null byte');
  });

  it('E8b `_reg_get_to` and `_reg_read_to` into the names the tick\'s hot sites pass, one call per row (D-4963)', (ctx) => {
    const b = got(ctx).fixed;
    for (const row of rows.named) expectEquivalent(row, b.results.get(row.id)!, locale!);
    expect(b.results.get('_reg_get_to last three-newlines')![0]!.val!.toString('latin1')).toBe('abc');
    expect(b.results.get('_reg_read_to wrapper symlink-regular')![0]!.rc).toBe(2);
  });

  it(`E8c ${REG_SEED}'s 500 random registry fields: the four calls, as the legacy \`cat\` (D-4963)`, (ctx) => {
    const b = got(ctx).random;
    for (const row of rows.random) expectEquivalent(row, b.results.get(row.id)!, locale!);
  });

  it('E8e a field that vanishes between the type check and the open: absent (rc 1), as the failed `cat` left it, never unreadable (D-4963)', (ctx) => {
    const b = got(ctx).fixed;
    for (const row of rows.vanish) {
      const res = b.results.get(row.id)!;
      expectEquivalent(row, res, locale!);
      for (const s of res) expect(s.note, `${row.id}: a side never reached the open, so nothing vanished`).toBe('vanished');
      expect(res[0]!.rc, `${row.id}: the legacy answer`).toBe(1);
    }
  });

  it('E8f `_reg_get`\'s raw stdout is what `$( )` leaves: the legacy `cat`\'s bytes, except a field\'s trailing newlines and NULs (D-4963)', (ctx) => {
    const b = got(ctx).fixed;
    for (const row of rows.raw) {
      const s = b.results.get(row.id)![0]!;
      expect(s.setupRc, `${row.id}: the setup failed: ${s.setupLog}`).toBe(0);
      const [r, c, a, l] = s.note.split(' ');
      expect({ c, a }, `${row.id}: the printing form prints the captured value with the legacy's rc`).toEqual({ c: 'captured', a: l });
      expect(r, `${row.id}: raw stdout ${rawGetDiverges(row.row) ? 'drops the trailing newlines or NULs' : 'is the legacy\'s'}`)
        .toBe(rawGetDiverges(row.row) ? 'raw-differs' : 'raw-equal');
    }
    // Non-vacuity: the edge is real, both ways.
    expect(b.results.get('_reg_get raw: three-newlines')![0]!.note).toMatch(/^raw-differs /);
    expect(b.results.get('_reg_get raw: plain')![0]!.note).toMatch(/^raw-equal /);
  });
});

// ── E9: W3 Task 15's route rows — the route chain's out-var forms (D-4963) ─────────────────────────────────────────

/** The forms W3 Task 15 lands; every E9 row needs them. */
const RT_NEEDS: readonly string[] = [
  '_route_peek_to', '_route_effort_for_to', '_route_applied_get_to', '_route_wanted_to', '_route_pending_word_to',
];
const RT_FIELDS = ['class', 'degraded', 'effort', 'inert', 'routeapplied'] as const;
/** Bash that plants one route record as `$REG/diet.<field>`, each value as `_reg_set` writes it (`printf '%s'`). */
const plantRoute = (r: RouteRow): string =>
  RT_FIELDS.filter((f) => r[f] !== undefined).map((f) => `printf '%s' ${q(r[f]!)} > "$REG/diet.${f}"`).join('\n') || ':';
const routeRow = (id: string): RouteRow => {
  const r = ROUTE_ROWS.find((x) => x.id === id);
  if (!r) throw new Error(`no ROUTE_ROWS row ${id}`);
  return r;
};

/** The registry as one listing, read with builtins: every entry's name and, for a regular file, its bytes `%q`-quoted.
 *  Written to a file before and after the calls, so a side that appended a `swap.log` line, left a floor marker or
 *  rewrote a field says so in its note (plan Task 15 Step 1: "the quiet arm writes nothing"). */
const RT_SNAP = [
  '__rt_snap() {',
  '  local p c',
  '  for p in "$REG"/* "$REG"/.[!.]*; do',
  '    [[ -e "$p" || -L "$p" ]] || continue',
  '    c=; [[ -f "$p" && ! -L "$p" ]] && IFS= read -r -d \'\' c < "$p"',
  '    printf \'%s=%q\\n\' "${p##*/}" "$c"',
  '  done',
  '}',
].join('\n');

/** One side over one route record: each chain helper's printing form RAW (its contract: the legacy printed a
 *  captured value), then its `_to` form into `rv`, set to `__P` first, so a form that does not empty its out-var
 *  shows; `_route_apply_pending`'s rc (it prints nothing and has no `_to` form); and, in the note, whether the
 *  registry moved. NOT into `v`: `_route_peek_to` is `_route_peek` renamed in place and keeps its legacy local `v`
 *  (plan §Interfaces), so `v` is a name it would catch in its own local (E1's census forbids it). */
const rtChain = (legacy: boolean): string => {
  const print = (n: string): string => (legacy ? `_legacy${n}` : n);
  const to = (n: string, args: string): string => (legacy ? `rv=$(_legacy${n} ${args})` : `${n}_to rv ${args}`);
  const both = (n: string, args: string, tag: string): string[] => [
    `  ${print(n)} ${args}; r=$?; printf '<%s rc=%s>\\n' ${q(tag)} "$r"`,
    `  rv=__P; ${to(n, args)}; r=$?; printf '[%s %s|%s]\\n' ${q(tag)} "$rv" "$r"`,
  ];
  return [
    RT_SNAP,
    '__rt() {',
    '  local r rv',
    '  __rt_snap > "$PWD/reg.before"',
    ...both('_route_pending_word', 'diet', 'pending_word'),
    `  ${print('_route_apply_pending')} diet; r=$?; printf '<apply_pending rc=%s>\\n' "$r"`,
    ...both('_route_wanted', 'diet', 'wanted'),
    ...['class', 'degraded', 'effort', 'inert'].flatMap((f) => both('_route_peek', `diet ${f}`, `peek ${f}`)),
    ...['', 'opus', 'haiku'].flatMap((c) => both('_route_effort_for', `diet ${q(c)} quiet`, `effort_for ${c || '<none>'} quiet`)),
    ...['class', 'effort'].flatMap((f) => both('_route_applied_get', `diet ${f}`, `applied_get ${f}`)),
    '  __rt_snap > "$PWD/reg.after"',
    '  if command cmp -s "$PWD/reg.before" "$PWD/reg.after"; then printf unchanged > "$PWD/note"; else printf changed > "$PWD/note"; fi',
    '}',
    '__diet_caller v __rt',
  ].join('\n');
};
const RT_LEGACY = rtChain(true);
const RT_LIVE = rtChain(false);

/** The records E9b drives one call at a time: nothing at all, a record fully applied, a served `degraded` rung with an
 *  inert effort, every field refused, an invalid class with a valid effort, and haiku with a level. */
const RT_NAMED_IDS = [
  'class=absent,degraded=absent,effort=absent,inert=absent,routeapplied=absent',
  'class=valid,degraded=absent,effort=valid,inert=absent,routeapplied=both',
  'class=valid,degraded=valid,effort=auto,inert=effort,routeapplied=class-only',
  'class=default,degraded=invalid,effort=invalid,inert=junk,routeapplied=junk',
  'class=invalid,degraded=absent,effort=valid,inert=absent,routeapplied=absent',
  'class=haiku,effort=valid',
];

/** Every W3 Task 15 row (plan Task 15 Step 1, tick-diet spec §6.4):
 *  - `chain`: each `ROUTE_ROWS` record (every combination of the five fields' cases, plus haiku with each effort)
 *    through `rtChain`, against the legacy;
 *  - `named`: each form into the variable its call sites pass (`_swap_target`'s and `_route_wanted_to`'s `cls`,
 *    `_route_wanted_to`'s `deg` and `ine`, `_route_effort_for_to`'s `e`, `_route_wanted_to`'s `eff`,
 *    `_route_pending_word_to`'s `want` and `ap`, `_route_apply_pending`'s `w`), one call per row, so the out-var and
 *    the caller frame are compared for exactly that call. Each starts from the frame's `__S`, so a form that does not
 *    empty its out-var first leaks it on every record whose answer is empty. */
function w3RouteRows(): { chain: Row[]; named: Row[] } {
  const chain = ROUTE_ROWS.map((r): Row => ({
    id: `route chain: ${r.id}`, setup: plantRoute(r), needs: RT_NEEDS,
    sides: [{ label: 'legacy', body: RT_LEGACY }, { label: 'live', body: RT_LIVE }],
  }));
  const named: Row[] = [];
  for (const id of RT_NAMED_IDS) {
    const setup = plantRoute(routeRow(id));
    const one = (to: string, legacy: string, args: readonly string[], ov: string): void => {
      const rest = args.slice(1).map((a) => ` ${a}`).join('');
      named.push({ ...toRow(`${to} ${ov}${rest}: ${id}`, legacy, to, args, setup, ov), needs: RT_NEEDS });
    };
    one('_route_peek_to', '_legacy_route_peek', ['diet', 'class'], 'cls');
    one('_route_peek_to', '_legacy_route_peek', ['diet', 'degraded'], 'deg');
    one('_route_peek_to', '_legacy_route_peek', ['diet', 'inert'], 'ine');
    one('_route_peek_to', '_legacy_route_peek', ['diet', 'effort'], 'e');
    one('_route_effort_for_to', '_legacy_route_effort_for', ['diet', 'opus', 'quiet'], 'eff');
    one('_route_effort_for_to', '_legacy_route_effort_for', ['diet', 'haiku', 'quiet'], 'eff');
    one('_route_applied_get_to', '_legacy_route_applied_get', ['diet', 'class'], 'ap');
    one('_route_applied_get_to', '_legacy_route_applied_get', ['diet', 'effort'], 'ap');
    one('_route_wanted_to', '_legacy_route_wanted', ['diet'], 'want');
    one('_route_pending_word_to', '_legacy_route_pending_word', ['diet'], 'w');
  }
  return { chain, named };
}

describe.each(LOCALES)('E9 W3 Task 15 under $name: the route chain\'s out-var forms (tick-diet spec §6.4, D-4963)', ({ locale }) => {
  const rows = w3RouteRows();
  let h: CcdHarness;
  let batch: Batch | null = null;
  beforeAll(() => {
    h = makeCcdHarness('ccrc-diet-e9-');
    if (locale !== null) batch = runBatch(h, [...rows.chain, ...rows.named], locale, 900);
  }, 1_000_000);
  afterAll(() => h.cleanup());
  const got = (ctx: { skip: (note?: string) => never }): Batch => {
    if (locale === null) {
      if (process.platform === 'darwin') ctx.skip(NO_UTF8);
      throw new Error(`${NO_UTF8} — the supervisors run under one, so this half cannot be skipped here`);
    }
    return batch!;
  };

  it('E9x the batch ran every row to the end, inside its deadline', (ctx) => {
    const b = got(ctx);
    expect(b.hung, `a row never finished: ${b.stderr.slice(0, 2000)}`).toBeNull();
    expect(b.status).toBe(0);
  });

  it('E9a every route record: the chain\'s printing forms, their `_to` forms and `_route_apply_pending`\'s rc answer as the legacy did, and the quiet chain writes nothing (D-4963)', (ctx) => {
    const b = got(ctx);
    for (const row of rows.chain) {
      const res = b.results.get(row.id)!;
      expectEquivalent(row, res, locale!);
      for (const [k, s] of res.entries()) {
        expect(s.note, `${row.id} [${row.sides[k]!.label}]: the quiet chain moved the registry (swap.log, a floor marker or a field)`)
          .toBe('unchanged');
      }
    }
    // Non-vacuity: the legacy sides answered every shape the gate decides on — a class pending, nothing pending, the
    // served `degraded` rung with an inert effort, and haiku's level dropped without a note.
    const leg = (id: string): string => b.results.get(`route chain: ${id}`)![0]!.out.toString('latin1');
    expect(leg('class=valid,degraded=absent,effort=valid,inert=absent,routeapplied=absent'))
      .toMatch(/^class=opus<pending_word rc=0>\n\[pending_word class=opus\|0\]\n<apply_pending rc=0>\nopus high<wanted rc=0>\n/);
    expect(leg('class=valid,degraded=absent,effort=valid,inert=absent,routeapplied=both'))
      .toMatch(/^<pending_word rc=0>\n\[pending_word \|0\]\n<apply_pending rc=1>\n/);
    expect(leg('class=valid,degraded=valid,effort=valid,inert=effort,routeapplied=class-only'))
      .toMatch(/^class=sonnet<pending_word rc=0>\n\[pending_word class=sonnet\|0\]\n<apply_pending rc=0>\nsonnet <wanted rc=0>\n/);
    expect(leg('class=haiku,effort=valid')).toContain('\n[effort_for haiku quiet |0]\n');
    expect(leg('class=absent,degraded=absent,effort=absent,inert=absent,routeapplied=absent'))
      .toContain('\n<apply_pending rc=1>\n');
  });

  it('E9b the `_to` forms into the names their call sites pass, one call per row (D-4963)', (ctx) => {
    const b = got(ctx);
    for (const row of rows.named) expectEquivalent(row, b.results.get(row.id)!, locale!);
    const val = (id: string): string => b.results.get(id)![0]!.val!.toString('latin1');
    expect(val('_route_peek_to cls class: class=valid,degraded=absent,effort=valid,inert=absent,routeapplied=both')).toBe('opus');
    expect(val('_route_peek_to cls class: class=absent,degraded=absent,effort=absent,inert=absent,routeapplied=absent')).toBe('');
    expect(val('_route_pending_word_to w: class=valid,degraded=valid,effort=auto,inert=effort,routeapplied=class-only')).toBe('class=sonnet');
  });
});

// ── E10: W3 Task 16's rows — `_home_measured_to` and `_authdead`'s builtin read (D-4963) ───────────────────────────

/** Where every `.home` row plants its field: `$REG/diet.home`, so the home read asks for id `diet`, which names no
 *  account, so the fallback arm answers `_id_wrapper`'s default. */
const HOME_AT = '"$REG/diet.home"';
/** The wrapper every authdead row plants its marker for: a harness roster id. */
const AD_WRAPPER = DEFAULT_TEST_ROSTER.accounts[1]!.id;
const AD_AT = `"$REG/${AD_WRAPPER}-authdead"`;
const HM_ROWS: readonly FileRow[] = HOME_ROWS.filter((r) => !(AS_ROOT && needsNonRoot(r)));
const AD_ROWS: readonly FileRow[] = AUTHDEAD_ROWS.filter((r) => !(AS_ROOT && needsNonRoot(r)));
const HM_NEEDS: readonly string[] = ['_home_measured_to'];

/** One side over one `.home` row: the printing form through `$( )` (how `_auto_swap_check` read it before this task),
 *  and the `_to` form into `hv`, set to `__P` first, so a form that does not empty its out-var on the rc-2 arm shows. */
const hm2 = (get: string, to: string): string => [
  '__hm2() {',
  '  local r hv',
  `  v=__P; v=$(${get} diet); r=$?; printf '[get %s|%s]\\n' "$v" "$r"`,
  `  hv=__P; ${to}; r=$?; printf '[to %s|%s]\\n' "$hv" "$r"`,
  '}',
  '__diet_caller v __hm2',
].join('\n');
const HM2_LEGACY = hm2('_legacy_home_measured', 'hv=$(_legacy_home_measured diet)');
const HM2_LIVE = hm2('_home_measured', '_home_measured_to hv diet');

/** Every W3 Task 16 row (plan Task 16 Step 1, tick-diet spec §6.4):
 *  - `home`: each `HOME_ROWS` row through `hm2`, against the legacy;
 *  - `named`: `_home_measured_to` into `home`, the name `_auto_swap_check` passes, one call per row;
 *  - `raw`: structural, the printing form's raw stdout against the legacy's raw bytes and its captured value (E10c);
 *  - `authdead`: each `AUTHDEAD_ROWS` row, `_authdead <wrapper>` against `_legacy_authdead <wrapper>`. */
function w3HomeRows(): { home: Row[]; named: Row[]; raw: DomainRow[]; authdead: Row[] } {
  return {
    home: HM_ROWS.map((r): Row => ({
      id: `home, two calls: ${r.id}`, setup: plant(r, HOME_AT), needs: HM_NEEDS,
      sides: [{ label: 'legacy', body: HM2_LEGACY }, { label: 'live', body: HM2_LIVE }],
    })),
    named: HM_ROWS.map((r) => toRow(`_home_measured_to home ${r.id}`, '_legacy_home_measured', '_home_measured_to', ['diet'], plant(r, HOME_AT), 'home')),
    raw: HM_ROWS.map((r): DomainRow => ({
      id: `_home_measured raw: ${r.id}`, row: r, setup: plant(r, HOME_AT), needs: HM_NEEDS,
      sides: [{
        label: 'raw',
        body: [
          '_home_measured diet > "$PWD/live.raw"; __a=$?',
          '_legacy_home_measured diet > "$PWD/legacy.raw"; __b=$?',
          '__v=$(_legacy_home_measured diet) 2>/dev/null; printf \'%s\' "$__v" > "$PWD/legacy.cap"',
          'if command cmp -s "$PWD/live.raw" "$PWD/legacy.raw"; then __r=raw-equal; else __r=raw-differs; fi',
          'if command cmp -s "$PWD/live.raw" "$PWD/legacy.cap"; then __c=captured; else __c=not-captured; fi',
          'if command cmp -s "$PWD/legacy.raw" "$PWD/legacy.cap"; then __l=legacy-raw-is-captured; else __l=legacy-raw-differs; fi',
          'printf \'%s %s %s %s %s\' "$__r" "$__c" "$__a" "$__b" "$__l" > "$PWD/note"',
        ].join('\n'),
      }],
    })),
    authdead: AD_ROWS.map((r): Row => ({
      id: `authdead: ${r.id}`, setup: plant(r, AD_AT), needs: ['_file_read_to'],
      sides: [
        { label: 'legacy', body: `__diet_caller v ${q(`_legacy_authdead ${AD_WRAPPER}; printf '<authdead rc=%s>' "$?"`)}` },
        { label: 'live', body: `__diet_caller v ${q(`_authdead ${AD_WRAPPER}; printf '<authdead rc=%s>' "$?"`)}` },
      ],
    })),
  };
}

/** Every call to the printing `_home_measured` in `src`'s code that is NOT the first word of a command substitution,
 *  as `line: text` — E8d's census (`rawRegGetCalls`) for this name: such a caller would see E10c's raw-stdout edge
 *  (D-5270). */
function rawHomeMeasuredCalls(src: string): string[] {
  const out: string[] = [];
  stripShellComments(src).split('\n').forEach((l, i) => {
    for (const m of l.matchAll(/(^|[^A-Za-z0-9_])_home_measured(?![A-Za-z0-9_])/g)) {
      const at = (m.index ?? 0) + m[1]!.length;
      if (/^_home_measured\(\)/.test(l.slice(at))) continue;
      if (!/(?:\$\(\s*|`)$/.test(l.slice(0, at))) out.push(`${i + 1}: ${l.trim()}`);
    }
  });
  return out;
}

describe('E10d no call site reads `_home_measured`\'s raw stdout: every call is the head of a `$( )` (D-4963)', () => {
  it('E10d ccd/ccd calls the printing `_home_measured` only as `$(_home_measured …)`, and the census names a planted raw call', () => {
    const src = fs.readFileSync(CCD, 'utf8');
    expect(/^_home_measured\(\)/m.test(stripShellComments(src)), 'the census\'s name no longer defines a function in ccd/ccd')
      .toBe(true);
    expect(rawHomeMeasuredCalls(src), 'a `_home_measured` call outside a `$( )` reads the printing form\'s raw stdout, '
      + 'which drops the fallback arm\'s trailing newline (E10c) — capture it, or call `_home_measured_to`').toEqual([]);
    const planted = `${src}\n_diet_raw() { _home_measured "$1" > "$2"; x=$(LC_ALL=C _home_measured "$1"); y=$(_home_measured "$1"); }\n`;
    const at = planted.split('\n').length - 1;
    const line = `${at}: _diet_raw() { _home_measured "$1" > "$2"; x=$(LC_ALL=C _home_measured "$1"); y=$(_home_measured "$1"); }`;
    expect(rawHomeMeasuredCalls(planted)).toEqual([line, line]);
  });
});

describe.each(LOCALES)('E10 W3 Task 16 under $name: `_home_measured_to` and `_authdead`\'s builtin read (tick-diet spec §6.4, D-4963)', ({ locale }) => {
  const rows = w3HomeRows();
  let h: CcdHarness;
  let batch: Batch | null = null;
  beforeAll(() => {
    h = makeCcdHarness('ccrc-diet-e10-');
    if (locale !== null) batch = runBatch(h, [...rows.home, ...rows.named, ...rows.raw, ...rows.authdead], locale, 600);
  }, 700_000);
  afterAll(() => h.cleanup());
  const got = (ctx: { skip: (note?: string) => never }): Batch => {
    if (locale === null) {
      if (process.platform === 'darwin') ctx.skip(NO_UTF8);
      throw new Error(`${NO_UTF8} — the supervisors run under one, so this half cannot be skipped here`);
    }
    return batch!;
  };
  const out = (id: string): string => batch!.results.get(id)![0]!.out.toString('latin1');

  it('E10x the batch ran every row to the end, inside its deadline', (ctx) => {
    const b = got(ctx);
    expect(b.hung, `a row never finished: ${b.stderr.slice(0, 2000)}`).toBeNull();
    expect(b.status).toBe(0);
  });

  it('E10a every `.home` row: `$(_home_measured)` and `_home_measured_to` answer as the legacy did (D-4963)', (ctx) => {
    const b = got(ctx);
    for (const row of rows.home) expectEquivalent(row, b.results.get(row.id)!, locale!);
    // Non-vacuity: the legacy answered each arm — decided from `.home`, the fallback, and rc 2 for an unreadable one.
    expect(out('home, two calls: valid-newline')).toBe('[get claude-a|0]\n[to claude-a|0]\n');
    expect(out('home, two calls: absent')).toMatch(/^\[get [^|\n]+\|0\]\n/);
    expect(out('home, two calls: symlink-regular')).toBe('[get |2]\n[to |2]\n');
    if (!AS_ROOT) expect(out('home, two calls: reg-unsearchable')).toBe('[get |2]\n[to |2]\n');
  });

  it('E10b `_home_measured_to` into `home`, the name `_auto_swap_check` passes, one call per row (D-4963)', (ctx) => {
    const b = got(ctx);
    for (const row of rows.named) expectEquivalent(row, b.results.get(row.id)!, locale!);
    expect(b.results.get('_home_measured_to home valid')![0]!.val!.toString('latin1')).toBe('claude-a');
    expect(b.results.get('_home_measured_to home symlink-regular')![0]!.rc).toBe(2);
  });

  it('E10c the printing form\'s raw stdout is what `$( )` leaves: the legacy\'s bytes, except the fallback arm\'s trailing newline (D-4963)', (ctx) => {
    const b = got(ctx);
    for (const row of rows.raw) {
      const s = b.results.get(row.id)![0]!;
      expect(s.setupRc, `${row.id}: the setup failed: ${s.setupLog}`).toBe(0);
      const [r, c, a, l, leg] = s.note.split(' ');
      expect({ c, a }, `${row.id}: the printing form prints the captured value with the legacy's rc`).toEqual({ c: 'captured', a: l });
      expect(r, `${row.id}: raw stdout differs exactly where the legacy's raw stdout was not its captured value`)
        .toBe(leg === 'legacy-raw-differs' ? 'raw-differs' : 'raw-equal');
    }
    // Non-vacuity: the edge is real, both ways.
    expect(b.results.get('_home_measured raw: absent')![0]!.note).toMatch(/^raw-differs /);
    expect(b.results.get('_home_measured raw: valid')![0]!.note).toMatch(/^raw-equal /);
  });

  it('E10e every authdead marker: `_authdead` answers as the legacy did, its `cat` now a builtin read (D-4963)', (ctx) => {
    const b = got(ctx);
    for (const row of rows.authdead) expectEquivalent(row, b.results.get(row.id)!, locale!);
    expect(out('authdead: absent')).toBe('<authdead rc=1>');
    expect(out('authdead: malformed')).toBe('<authdead rc=1>');
    expect(out('authdead: symlink-regular')).toBe('<authdead rc=1>');
  });
});

// ── E4: the corpus module ──────────────────────────────────────────────────────────────────────────────────────────

describe('E4 the corpus: deterministic, covering, and every row plants the shape it names (plan Task 2 Step 6)', () => {
  let h: CcdHarness;
  beforeAll(() => { h = makeCcdHarness('ccrc-diet-e4-'); });
  afterAll(() => h.cleanup());

  it('E4a randomRows is a function of its seed, draws every symbol of the alphabet, and lands near the match boundary', () => {
    const a = randomRows(4962, 500);
    const b = randomRows(4962, 500);
    expect(a.map((r) => r.bytes.toString('latin1'))).toEqual(b.map((r) => r.bytes.toString('latin1')));
    expect(randomRows(4963, 500).map((r) => r.bytes.toString('latin1'))).not.toEqual(a.map((r) => r.bytes.toString('latin1')));
    expect(new Set(a.map((r) => r.id)).size).toBe(500);
    const all = a.map((r) => r.bytes.toString('latin1')).join('');
    for (const sym of RANDOM_ALPHABET) expect(all.includes(sym), `the alphabet's ${JSON.stringify(sym)} never drawn`).toBe(true);
    // A row the fast path's own pattern would match (`"key"`, `[ \t\v\f\r]*`, `:`, `[ \t\v\f\r]*`, digits).
    const hit = /"(five|seven|ts|fiveResetAt|sevenResetAt|fiveWindowMinutes)"[ \t\x0b\x0c\r]*:[ \t\x0b\x0c\r]*[0-9]/;
    const hits = a.filter((r) => hit.test(r.bytes.toString('latin1'))).length;
    expect(hits, 'too few random rows hold a match to exercise the match arm').toBeGreaterThanOrEqual(150);
    expect(hits, 'too few random rows hold no match').toBeLessThanOrEqual(475);
  });

  it('E4b ROUTE_ROWS is every combination plan Task 15 names, once', () => {
    expect(ROUTE_ROWS).toHaveLength(4 * 3 * 4 * 3 * 4 + 4);
    expect(new Set(ROUTE_ROWS.map((r) => r.id)).size).toBe(ROUTE_ROWS.length);
    expect(ROUTE_ROWS.filter((r) => r.class === 'haiku').map((r) => r.effort ?? null).sort())
      .toEqual(['auto', 'high', 'turbo', null].sort());
  });

  it('E4c inLimitsDomain states spec §6.3\'s domain at its edges', () => {
    const byId = new Map(LIMITS_ROWS.map((r) => [r.id, r]));
    const dom = (id: string): boolean => inLimitsDomain(byId.get(id)!);
    expect(['compact', 'json-dump-spaced', 'crlf', 'tab-and-vt', 'size-65535', 'symlink-regular'].filter((id) => !dom(id))).toEqual([]);
    expect(['size-65536', 'size-64KiB-plus-1', 'nul-at-end', 'nul-after-lead-byte', 'invalid-utf8', 'non-ascii-elsewhere',
      'em-space-before-colon', 'bom', 'del-byte', 'directory', 'fifo', 'mode-000', 'absent', 'dir-unsearchable'].filter(dom)).toEqual([]);
  });

  it('E4d every file row of every set plants the shape it names, byte for byte', () => {
    const rows: Row[] = [];
    const want = new Map<string, FileRow>();
    for (const [set, list] of Object.entries(FILE_ROW_SETS)) {
      const at = set === 'LIMITS_ROWS' ? '"$LIMITS_DIR/diet.json"' : '"$REG/diet.f"';
      for (const r of list) {
        const id = `${set}/${r.id}`;
        if (want.has(id)) throw new Error(`duplicate row id ${id}`);
        want.set(id, r);
        rows.push({ id, setup: plant(r, at), sides: [{ label: 'plant', body: ':' }] });
      }
    }
    const b = runBatch(h, rows, 'C');
    expect(b.hung).toBeNull();
    for (const [id, r] of want) {
      const s = b.results.get(id)![0]!;
      expect(s.setupRc, `${id}: ${s.setupLog}`).toBe(0);
      const name = id.startsWith('LIMITS_ROWS/') ? 'lim/diet.json' : 'reg/diet.f';
      const entry = s.tree.find((l) => l.startsWith(`${name} `)) ?? null;
      const parent = s.tree.find((l) => l.startsWith(`${name.split('/')[0]} `))!;
      const sum = `${r.bytes.length} ${sha256(r.bytes)}`;
      switch (r.shape) {
        case 'absent': expect(entry, id).toBeNull(); break;
        case 'regular': expect(entry, id).toMatch(new RegExp(`^\\S+ file \\d+ ${sum}$`)); break;
        case 'mode-000': expect(entry, id).toMatch(new RegExp(`^\\S+ file 0 ${r.bytes.length} `)); break;
        case 'directory': expect(entry, id).toMatch(/ dir /); break;
        case 'fifo': expect(entry, id).toMatch(/ fifo /); break;
        case 'symlink-regular': expect(entry, id).toMatch(/ link .*\/regular$/); break;
        case 'symlink-dangling': expect(entry, id).toMatch(/ link .*\/missing$/); break;
        case 'symlink-fifo': expect(entry, id).toMatch(/ link .*\/fifo$/); break;
        case 'symlink-devzero': expect(entry, id).toMatch(/ link \/dev\/zero$/); break;
        case 'parent-unsearchable':
          expect(parent, id).toMatch(/ dir 600$/);
          expect(entry, id).toMatch(new RegExp(`^\\S+ file \\d+ ${sum}$`));
          break;
      }
    }
  }, 120_000);
});
