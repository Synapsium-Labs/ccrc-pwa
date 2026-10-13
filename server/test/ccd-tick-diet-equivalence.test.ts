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
import { mkTmp } from './tmpHelpers.js';
import {
  FILE_ROW_SETS, LIMITS_ROWS, RANDOM_ALPHABET, ROUTE_ROWS, inLimitsDomain, randomRows, type FileRow,
} from './tickDietCorpus.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const FIXTURE = path.join(HERE, 'fixtures', 'tick-diet-legacy.bash');

/** The base every tick-diet wave is measured against (plan §Base). */
const LEGACY_SHA = '0d0ea592166496be5eccb948313e381bcb2b87c8';
/** E0a. Never re-measure this to make it green: the fixture is never edited (its header says why). */
const FIXTURE_SHA256 = 'a375acaf3e4510b527e693d0580dd160b84d38187ff5191fd935aad94c3dd3e0';
/** The fourteen vendored bodies, in the fixture's order (plan Task 2 Step 1). */
const VENDORED = [
  '_reg_get', '_reg_read', '_authdead', '_cfg_dir', '_limit_json_num', '_limit_field', '_share_pct',
  '_home_measured', '_route_peek', '_route_effort_for', '_route_applied_get', '_route_wanted',
  '_route_pending_word', '_route_apply_pending',
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
 *  which stays inside the fixture. A row that drives the journaling arm freezes `_route_get` and
 *  `_route_note_floored` here first, so its legacy side reads `_legacy_reg_get`. Any NEW edge reds E0c. */
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
 *  The task that lands a name deletes it here in the same commit (the header's "RED FIRST"). */
const PENDING: ReadonlySet<string> = new Set([...Object.keys(PLANNED_FORMS), '_now_s']);

const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
/** Single-quotes one bash word. */
const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
const show = (b: Buffer | string | null): string => {
  const s = b === null ? '<none>' : typeof b === 'string' ? b : b.toString('latin1');
  return JSON.stringify(s.length > 400 ? `${s.slice(0, 400)}…(${s.length} bytes)` : s);
};

// ── function text ───────────────────────────────────────────────────────────────────────────────────────────────────

/** One top-level function's text, from its `name() {` line through the column-0 `}` that closes it, or its one line.
 *  A definition line whose code (before a ` #` comment) already ends in `}` is a one-liner: `_reg_get` and `_cfg_dir`
 *  are. `null` when the file defines no such function. */
function fnBlock(text: string, name: string): string | null {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => l.startsWith(`${name}() {`));
  if (i < 0) return null;
  const def = lines[i]!;
  if (/\}\s*$/.test(def.replace(/\s+#.*$/, ''))) return `${def}\n`;
  const j = lines.findIndex((l, k) => k > i && l === '}');
  return j < 0 ? null : `${lines.slice(i, j + 1).join('\n')}\n`;
}

/** Every top-level function definition, `fnBlock`'s way, with the offset range its block covers in `text`. One pass
 *  over the lines: `ccd/ccd` has thousands of functions. */
function functionsOf(text: string): { name: string; block: string; start: number; end: number }[] {
  const out: { name: string; block: string; start: number; end: number }[] = [];
  const lines = text.split('\n');
  let off = 0;
  let open: { name: string; start: number; from: number } | null = null;
  lines.forEach((l, i) => {
    const m = open === null ? /^([A-Za-z_][A-Za-z0-9_]*)\(\) \{/.exec(l) : null;
    if (m) {
      if (/\}\s*$/.test(l.replace(/\s+#.*$/, ''))) out.push({ name: m[1]!, block: `${l}\n`, start: off, end: off + l.length + 1 });
      else open = { name: m[1]!, start: off, from: i };
    } else if (open !== null && l === '}') {
      const block = `${lines.slice(open.from, i + 1).join('\n')}\n`;
      out.push({ name: open.name, block, start: open.start, end: open.start + block.length });
      open = null;
    }
    off += l.length + 1;
  });
  return out;
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
  // A call is the form's name at COMMAND position — a line start, after `;` `&` `|` `(` `{` `!`, or after a keyword
  // that takes a command — so `declare -F <form>` or `command -v <form>` is never read as a call.
  const callsIn = (body: string, names: Iterable<string>): { form: string; word: string; at: number }[] => {
    const out: { form: string; word: string; at: number }[] = [];
    for (const n of names) {
      const re = new RegExp(`(^[ \\t]*|[;&|({!][ \\t]*|\\b(?:then|do|else|elif|if|while|until)[ \\t]+)${n}(?=[ \\t])`, 'gm');
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

/** The batch prelude. `__diet_side` wipes and re-plants the trees, runs the setup and then the body in separate
 *  subshells (so neither leaks into the next side), and moves the trees aside for the node-side comparison.
 *  `__diet_caller var cmd` evaluates `cmd` in a caller frame whose locals are `SHADOWS` (sentinel `__S`), then writes
 *  the out-var's bytes to `val`, and to `aux` every shadow that is not the out-var and every global the call CREATED
 *  (`BASH_REMATCH` excluded: spec §6.1 accepts its clobber, and each wave audits its readers). */
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
  eval "$__dc_cmd"; __dc_rc=$?
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
        rc: rc === null ? null : Number(rc.toString()), val: read('val'), aux: (read('aux') ?? Buffer.alloc(0)).toString('latin1'),
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
      expect(now.get(n), `${n} changed since ${LEGACY_SHA.slice(0, 8)}, and a _legacy body reaches it — freeze the base's `
        + 'copy into fixtures/tick-diet-legacy.bash (below the functions) before changing it').toBe(before.get(n));
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
      return CENSUS_SRC.replace(from, to);
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

  it('E2a a difference in stdout, the registry, the out-var or the caller frame is reported, and a leaked global is seen', () => {
    const rows: Row[] = [
      { id: 'stdout', sides: [{ label: 'a', body: 'printf a' }, { label: 'b', body: 'printf b' }] },
      { id: 'registry', sides: [{ label: 'a', body: ':' }, { label: 'b', body: 'printf x > "$REG/x.f"' }] },
      { id: 'out-var', sides: [{ label: 'a', body: "__diet_caller v 'v=1'" }, { label: 'b', body: "__diet_caller v 'v=2'" }] },
      { id: 'frame', sides: [{ label: 'a', body: "__diet_caller v ':'" }, { label: 'b', body: "__diet_caller v 'f=clobbered'" }] },
      { id: 'leak', sides: [{ label: 'a', body: "__diet_caller v ':'" }, { label: 'b', body: "__diet_caller v 'diet_leaked=1'" }] },
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

/** The ids `_cfg_dir_to` is compared over (plan Task 2 Step 5): every roster id of the harness's test roster, an
 *  unknown id, an id that only PREFIXES a roster id, the empty word, a glob, a trailing blank, and a payload that
 *  would run if anything evaluated the word as code — it must create no file. */
const PAYLOAD = 'REG[$(touch "$HOME/PWNED")]';
const CFG_IDS: readonly string[] = ['claude', 'claude-a', 'claude-b', 'gpt', 'claude-d', 'nosuch', 'claude-a-proj', '', '*', 'claude ', PAYLOAD];
const label = (s: string): string => (s === '' ? '<empty>' : s === PAYLOAD ? '<payload>' : JSON.stringify(s));

interface ProbeRow extends Row { readonly check: (s: SideResult) => void }

/** The clock rows (D-4961). `_now_s` has no legacy body — its legacy is `$(date +%s)` itself — so each is a probe:
 *  one side, its answer bounded by two real `date` reads taken around it, and the `date` shim's log saying whether the
 *  helper itself ran `date`. */
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
    expect(s.aux.split('\n').filter(Boolean).every((l) => l.endsWith('=__S')), `a caller local changed: ${s.aux}`).toBe(true);
  };
  return [
    {
      id: 'now: $EPOCHSECONDS, no date function — the real time, into a caller variable named `now`, with no date exec',
      needs: ['_now_s_to'], sides: [{ label: '_now_s_to', body: bounded("__diet_caller now '_now_s_to now'") }],
      check: (s) => {
        expect(s.rc).toBe(0);
        within(s, s.val!.toString());
        frameClean(s);
        if (s.note.endsWith('epochseconds')) expect(s.dateLog, 'the fast path ran `date`').toEqual([]);
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

  it('E3c `_now_s_to` and `_now_s`: the real time without a `date` exec, a `date` function honoured, and the `date` path without EPOCHSECONDS (D-4961)', (ctx) => {
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
