// The supervisor tick diet's differential harness (#387, tick-diet spec §9, plan Task 2).
//
// WHAT IT PROVES. Every helper the diet converts keeps its name, stdout, stderr, rc and registry bytes (spec §6.1 rule
// 1, invariant I4), and every `_to` out-var form leaves exactly what `v=$(legacy …); rc=$?` leaves. "The same" means
// the same as the code the diet REPLACED, so that code is vendored, frozen, as `_legacy_*` in
// `fixtures/tick-diet-legacy.bash`, and every row runs the legacy twin and the live helper side by side, in the same
// fixture HOME, under `C` and under the UTF-8 locale the supervisors run under.
//
// SEVERAL FILES (D-6767). This file runs the locale-free parts (E0, E1, E2, E4 and the static censuses E8d, E8g and
// E10d). The rows under `C` are `ccd-tick-diet-equivalence-rows` and `-route.test.ts` (the table is
// `ccd-tick-diet-equivalenceFixture.ts`'s); `ccd-tick-diet-equivalence-utf8-limits`, `-utf8-registry` and `-utf8-route.test.ts` run the same rows under the UTF-8 locale. The
// runner, the row builders and the per-locale blocks (E3, E5 to E10) live in `ccdTickDietRunner.ts`, whose
// `registerLocaleRows` each of those files calls with its own entry of `LOCALES` and its own blocks. A full test name is unchanged by the split.
//
// THE PARTS, and the order a reader needs them in:
//  - E0, the legacy pin. The fixture's sha256 (a); each body, with the rename map reversed, against
//    `git show 0d0ea592:ccd/ccd` (b); and every live helper those bodies reach, TRANSITIVELY, at its 0d0ea592
//    definition (c). Without (c) a legacy body could drift by its callees while its own text stayed pinned.
//  - E1, the out-var census (plan Task 2 Step 4, Review Focus 2). A static read of `ccd/ccd`: no call passes an out-var
//    name that is a local of the form it calls, or of a form that form forwards its out-var to. A collision there is
//    silent: `printf -v` lands in the callee's own local and the caller keeps its old value.
//  - E2, the runner's own proofs: it can red, it isolates sides, and a hang is a bounded, NAMED failure.
//  - E3, the rows, per locale (in `ccdTickDietRunner.ts`). W1's are there; W2 and W3 add theirs, red first, from
//    `tickDietCorpus.ts`.
//  - E5, W2's limits rows (D-4962), per locale: every limits row and 500 random ones through both forms, the
//    structural row that says which side of spec §6.3's domain each row fell on, and the one rc edge inside that domain
//    (E5e: grep's SIGPIPE, which no builtin can equal). (E5's rows live in `ccdTickDietRunner.ts`.)
//  - E6, W2's share rows (D-4962, plan Task 10): `_share_pct_to` and its per-`_swap_target` memo, inside and outside
//    the memo scope, including the empty-key departure (D-5042).
//  - E7, W2 Task 9's rows (D-4962), per locale: `_limit_field` and `_limit_field_to` over every limits row at three
//    clocks, both fields and four maxages; into its callers' names; the one-read row; and `_avail`/`_limit_score`
//    against their vendored legacy, called bare as the tick calls them. (E6's and E7's rows live in
//    `ccdTickDietRunner.ts` too.)
//  - E8, W3 Task 13's registry rows (D-4963), per locale: `_reg_get`, `_reg_get_to`, `_reg_read` and `_reg_read_to`
//    over every registry row and 500 random ones; into the names the tick's hot sites pass; the open-failure ladder
//    driven by a field that vanishes between the type check and the open; and the one stated edge, `_reg_get`'s raw
//    stdout, with the static census that says no call site reads it (E8d, which stays in this file). (E8's rows live
//    in `ccdTickDietRunner.ts`.)
//  - E9, W3 Task 15's route rows (D-4963), per locale: every `ROUTE_ROWS` record through the route chain's printing
//    forms, their `_to` forms and `_route_apply_pending`'s rc, each side asserting the quiet chain left the registry
//    (`swap.log`, the floor markers) byte-unchanged; and the `_to` forms into the names their call sites pass. (E9's
//    rows live in `ccdTickDietRunner.ts`.)
//  - E10, W3 Task 16's rows (D-4963), per locale: every `HOME_ROWS` row through `$(_home_measured)` and
//    `_home_measured_to`, the latter also into `home`; the printing form's one stated edge, its raw stdout on the
//    fallback arm, with the static census that says no call site reads it (E10d, which stays in this file); and
//    every `AUTHDEAD_ROWS` marker through `_authdead`, whose `cat` became `_file_read_to`. (E10's rows live in
//    `ccdTickDietRunner.ts`.)
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
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, CCD, type CcdHarness, ccdSource } from './ccdWsHelpers.js';
import {
  REPO,
  FIXTURE,
  PLANNED_FORMS,
  PENDING,
  sha256,
  show,
  DEF_LINE,
  functionsOf,
  fnBlock,
  stripShellComments,
  Row,
  normErr,
  frameChanges,
  plant,
  runBatch,
  diffSides,
  runScript,
  label,
  rawRegGetCalls,
  rawHomeMeasuredCalls,
} from './ccdTickDietRunner.js';
import {
  FILE_ROW_SETS, LIMITS_ROWS, RANDOM_ALPHABET, ROUTE_ROWS, inLimitsDomain, randomRows, type FileRow,
} from './tickDietCorpus.js';

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

/** The rc `BOUNDED` exits with when its alarm fires: a hung batch. */
const HUNG_RC = 142;


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
    const code = stripShellComments(ccdSource());
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
    const { forms, findings } = outVarCensus(ccdSource());
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

describe('E8d no call site reads `_reg_get`\'s raw stdout: every call is the head of a `$( )` (D-4963)', () => {
  it('E8d ccd/ccd calls `_reg_get` only as `$(_reg_get …)`, and the census names a raw call when one is planted', () => {
    const src = ccdSource();
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
    const src = ccdSource();
    expect(outVarCensus(src).forms, 'the census does not see `_reg_read_to` as a form').toContain('_reg_read_to');
    const planted = `${src}\n_diet_v() { local w; _reg_read_to v "$1" wrapper; _reg_read_to f "$1" wrapper; _reg_read_to w "$1" wrapper; }\n`;
    expect(outVarCensus(planted).findings.filter((f) => f.caller === '_diet_v')).toEqual([
      { kind: 'collision', caller: '_diet_v', form: '_reg_read_to', word: 'v', via: ['_reg_read_to'] },
      { kind: 'collision', caller: '_diet_v', form: '_reg_read_to', word: 'f', via: ['_reg_read_to'] },
    ]);
  });
});

describe('E10d no call site reads `_home_measured`\'s raw stdout: every call is the head of a `$( )` (D-4963)', () => {
  it('E10d ccd/ccd calls the printing `_home_measured` only as `$(_home_measured …)`, and the census names a planted raw call', () => {
    const src = ccdSource();
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
