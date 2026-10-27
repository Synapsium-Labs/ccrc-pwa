// W8's cadence-chain census module (the 2026-10-26 consolidation W8 plan, Task C8-0's census split).
// The cadence chain (launchd and systemd timer cadences, ARCH-69)
// fills it with its census queries, in C8a, then C8b.
// Each query returns `CensusSite` rows the way `consolidationCensus.ts`'s own do, and it imports what it needs from
// `consolidationCensus.ts`; it never re-exports this module, so no import cycle forms, and every count a W8 PR body
// quotes comes from a named query of this module. It reads no imported value at top level (only types, and functions
// called inside a query). Its fixture and real-tree rows live in the sibling `cadence.test.ts`, which the chain's
// first task creates. No other chain edits this file; a chain's first task that finds it non-empty stops and
// reports.
//
// C8a (D-7053; ARCH-69 (#804), first half): the launchd cadence literals, the ddns transcript's cadence sentences and
// the shipped timers' cadence spellings. The sources read here are bash (`ccd/ccrc`, `ccd/ccd`) and systemd unit
// text, not TypeScript, so each query reads lines the way the census module's own ccd queries do (`bashCodeOf`,
// `CCD_FUNCTION_DEF`); `scan/parse.ts` parses TypeScript only.
// KNOWN WIDTH: a function is the lines from its `name() {` at column 0 to the next one; a cadence key split across
// two lines, or a value reached through an alias of an accepted local, is not seen.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { bashCodeOf, CCD_FUNCTION_DEF, ccdLauncherIn, REPO, type CensusSite } from '../consolidationCensus.js';

/** The two files whose generated plists the launchd census reads, by their path under a root. */
const launchdWriters = (root: string): Array<[string, string]> => [
  ['ccd/ccrc', path.join(root, 'ccd', 'ccrc')],
  ['ccd/ccd', ccdLauncherIn(root)],
];

const linesOf = (abs: string): string[] => (existsSync(abs) ? readFileSync(abs, 'utf8').split('\n') : []);

/** The one value shape a launchd cadence key may carry: a variable, named bare or braced. */
const ACCEPTED_VALUE = /<key>StartInterval<\/key><integer>\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?<\/integer>/;
const CADENCE_KEY = /<key>Start(?:Calendar)?Interval<\/key>/;

/** Every launchd cadence key (`<key>StartInterval</key>` or `<key>StartCalendarInterval</key>`) in `ccd/ccrc` and
 *  `ccd/ccd` whose value is not `<integer>$<name></integer>` with `<name>` a `local` of the same function, assigned
 *  there from `$(_timer_period_s …)` before the key's line. A literal, an inline `$(…)`, a variable from anywhere
 *  else and every `StartCalendarInterval` count. 1 at the base (`_exp_ddns_units`' literal 300); 0 after C8a. */
export function launchdCadenceLiterals(root: string = REPO): CensusSite[] {
  const out: CensusSite[] = [];
  for (const [file, abs] of launchdWriters(root)) {
    let locals = new Set<string>();
    let fromReader = new Set<string>();
    linesOf(abs).forEach((text, i) => {
      if (CCD_FUNCTION_DEF.test(text)) { locals = new Set(); fromReader = new Set(); return; }
      if (/^\s*#/.test(text)) return;
      const code = bashCodeOf(text);
      const decl = /^\s*local\s+(.*)$/.exec(code);
      if (decl) for (const w of decl[1]!.split(/\s+/)) { const n = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(w); if (n) locals.add(n[1]!); }
      const asg = /^\s*(?:local\s+)?([A-Za-z_][A-Za-z0-9_]*)="?\$\(_timer_period_s\b/.exec(code);
      if (asg) fromReader.add(asg[1]!);
      if (!CADENCE_KEY.test(text)) return;
      const v = ACCEPTED_VALUE.exec(text);
      if (v && locals.has(v[1]!) && fromReader.has(v[1]!)) return;
      out.push({ file, line: i + 1, text });
    });
  }
  return out;
}

/** One sentence of the ddns transcript that spells a cadence, with the arm it prints in. */
export interface TranscriptCadenceSite extends CensusSite { readonly arm: 'darwin' | 'linux' }

/** A duration in words or digits, the way a transcript spells one. */
const DURATION = /\bevery (?:\d+|one|two|three|four|five|six|ten|fifteen|twenty|thirty|sixty) (?:minutes?|seconds?|hours?)\b|\bevery (?:minute|second|hour)\b|\b\d+-(?:minute|second|hour)\b|\b\d+ (?:minutes?|seconds?|hours?)\b/;

/** Every non-comment line of `ccd/ccrc#_exp_ddns_units` that spells a duration, tagged with its arm: the Darwin arm is
 *  the function's lines up to its `if [ "$CCD_OS" = darwin ]` block's closing `fi`, the Linux arm the rest. A report,
 *  not a ratchet to 0: 3 at the base (two Darwin, one Linux); 1 after C8a, the Linux arm's enable sentence, kept by
 *  name (D-7053). */
export function ddnsTranscriptCadences(root: string = REPO): TranscriptCadenceSite[] {
  const out: TranscriptCadenceSite[] = [];
  let inside = false;
  let arm: 'darwin' | 'linux' = 'darwin';
  linesOf(path.join(root, 'ccd', 'ccrc')).forEach((text, i) => {
    const def = CCD_FUNCTION_DEF.exec(text);
    if (def) { inside = def[1] === '_exp_ddns_units'; arm = 'darwin'; return; }
    if (!inside) return;
    if (/^\}/.test(text)) { inside = false; return; }
    if (arm === 'darwin' && /^ {2}fi\s*$/.test(text)) { arm = 'linux'; return; }
    const code = bashCodeOf(text);
    if (code === '' || !DURATION.test(code)) return;
    out.push({ file: 'ccd/ccrc', line: i + 1, text, arm });
  });
  return out;
}

/** Every distinct cadence line (`OnUnitActiveSec=…` or `OnCalendar=…`, leading whitespace dropped, as
 *  `_timer_period_s` reads one) over the `.timer` files `deploy/systemd/` holds at run time, sorted. */
export function timerSpellings(root: string = REPO): string[] {
  const dir = path.join(root, 'deploy', 'systemd');
  const seen = new Set<string>();
  if (!existsSync(dir)) return [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.timer'))) {
    for (const raw of linesOf(path.join(dir, name))) {
      const line = raw.replace(/^\s+/, '');
      if (/^(?:OnUnitActiveSec|OnCalendar)=/.test(line)) seen.add(line);
    }
  }
  return [...seen].sort();
}

// ── C8b (D-7054; ARCH-69 (#804), second half): the doctor's restated cadences ──────────────────────────────────────
// `ccd/ccrc-doctor-checks` is read line by line, the way the queries above read `ccd/ccrc`. A function is the lines
// from its `name() {` at column 0 (check names carry a hyphen, so this file's own pattern allows one) to the next `}`
// at column 0; a one-line `name() { …; }` has no body. Every other line is top level.

/** A function definition of the doctor's table, hyphenated check names included. */
const DOCTOR_FUNCTION_DEF = /^([A-Za-z_][A-Za-z0-9_-]*)\(\) *\{/;

/** One non-comment line of the doctor's table, with the function it sits in (`null` at top level). */
interface DoctorLine { readonly line: number; readonly text: string; readonly code: string; readonly fn: string | null }

function doctorLines(root: string): DoctorLine[] {
  const out: DoctorLine[] = [];
  let fn: string | null = null;
  linesOf(path.join(root, 'ccd', 'ccrc-doctor-checks')).forEach((text, i) => {
    const def = DOCTOR_FUNCTION_DEF.exec(text);
    if (def) { fn = /\}\s*$/.test(text) ? null : def[1]!; return; }
    if (fn !== null && /^\}/.test(text)) { fn = null; return; }
    const code = bashCodeOf(text);
    if (code.trim() === '') return;
    out.push({ line: i + 1, text, code, fn });
  });
  return out;
}

/** A doctor line that restates a shipped timer's period, with the check it belongs to. `kept` names why a row is
 *  measured and not derived (a kept row is held by name, exactly, beside an otherwise empty list). */
export interface DoctorCadenceSite extends CensusSite { readonly check: string; readonly kept: string | null }

/** The named arm: the sites measured on `c71054fc6` (the plan's table), by function and token. `null` is top level;
 *  `check` is the check the row is reported under. */
const NAMED_DOCTOR_CADENCES: ReadonlyArray<readonly [fn: string | null, check: string, token: string]> = [
  ['_check_pool-sync', 'pool-sync', 'pool_sync_grace=$((2 * 60))'],
  ['_check_pool-sync', 'pool-sync', 'fires every 60s'],
  ['_check_pool-sync', 'pool-sync', '(up to ~60s)'],
  ['_check_pool-sync', 'pool-sync', '(every 60s)'],
  ['_check_update-sync', 'update-sync', 'update_sync_grace=$((2 * 60))'],
  ['_check_update-sync', 'update-sync', 'fires every 60s'],
  ['_check_update-sync', 'update-sync', '(up to ~60s)'],
  ['_check_graphify', 'graphify', '"$age" -gt 2700'],
  ['_check_models', 'models', '"$age" -gt 10800'],
  [null, 'codex', '_DR_CODEX_USAGE_STALE_S=2700'],
  [null, 'codex', '_DR_CODEX_USAGE_STALE_DIRECT_S=3600'],
  ['_check_scope-sweep', 'scope-sweep', 'CCRC_SCOPE_SWEEP_STALE_S:-300'],
  ['_check_scope-sweep', 'scope-sweep', 'the sweep runs every minute'],
  ['_check_server-caps', 'server-caps', '/health every minute'],
];

/** Measured and not derived, each by name and token, with its reason (D-7054). */
const KEPT_DOCTOR_CADENCES: ReadonlyArray<readonly [fn: string, check: string, token: string, why: string]> = [
  ['_dr_codex_usage', 'codex', 'the first poll runs five minutes after enable',
    'restates ccrc-codex-usage@.timer\'s OnActiveSec=5min, a first-run delay, not a period: _timer_period_s reads the period alone'],
  ['_check_scope-sweep', 'scope-sweep', 'CCRC_SCOPE_SWEEP_STALE_S:-300',
    'a call-bound setting (ccrc-settings-census.test.ts): written as a bare 300 s bound with the check (#299), never derived from ccd-scope-sweep.timer'],
];

/** Excluded from the query by name: they restate the server's own beat (`server/src/laneSchedule.ts#SERVER_CAPS_WRITE_MS`),
 *  not a shipped unit file, and no ccd logic reads TypeScript (O2 (b)). */
export const EXCLUDED_DOCTOR_CADENCES: ReadonlyArray<readonly [fn: string, token: string]> = [
  ['_check_server-caps', 'it rewrites the file every minute'],
  ['_check_server-caps', 'would derive the role both and write the file every minute'],
];

/** The reader's own helpers: the period is read there, not restated. */
const DOCTOR_CADENCE_READERS = new Set(['_dr_timer_period_s', '_dr_cycles_s']);

const NUMBER_WORD = 'two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|forty-five|fifty|sixty';
/** A duration spelled in a double-quoted string the doctor prints (or interpolates into what it prints). */
const DOCTOR_DURATION = new RegExp([
  String.raw`\bevery \d+(?:s|min|h)\b`, String.raw`\bevery minute\b`, String.raw`\bevery (?:${NUMBER_WORD}) minutes\b`,
  String.raw`\b\d+-minute\b`, String.raw`\bup to ~\d+`, String.raw`\b(?:\d+|${NUMBER_WORD}) minutes after\b`,
].join('|'));
const DOUBLE_QUOTED = /"(?:[^"\\]|\\.)*"/g;
/** An integer compared with `age`, either way round, or inside `(( … ))`. */
const AGE_COMPARE = /\$\{?age\}?"?\s+-(?:gt|lt|ge)\s+"?(\d+)|(\d+)"?\s+-(?:gt|lt|ge)\s+"?\$\{?age\b|\(\(\s*age\s*[<>]=?\s*(\d+)/g;
/** An assignment to a name containing grace, stale or bound; its value runs to the end of the statement. */
const BOUND_ASSIGN = /\b([A-Za-z_][A-Za-z0-9_]*)=([^;]*)/g;

/** Is `code` (one non-comment line) a structural restatement: a duration in a double-quoted string, or an integer
 *  literal >= 60 compared with `age` or assigned to a grace/stale/bound name. Display arithmetic (`/ 60`, `/ 3600`)
 *  is neither, so it is never matched. */
function structuralCadence(code: string): boolean {
  if ((code.match(DOUBLE_QUOTED) ?? []).some((q) => DOCTOR_DURATION.test(q))) return true;
  for (const m of code.matchAll(AGE_COMPARE)) if (Number(m[1] ?? m[2] ?? m[3]) >= 60) return true;
  for (const m of code.matchAll(BOUND_ASSIGN)) {
    if (!/grace|stale|bound/i.test(m[1]!)) continue;
    if ((m[2]!.match(/(?<![\w$])\d+(?!\w)/g) ?? []).some((n) => Number(n) >= 60)) return true;
  }
  return false;
}

/** Every line of `ccd/ccrc-doctor-checks` that restates a shipped timer's period: the named arm (the plan's sites, by
 *  function and token) and the structural arm (any line `structuralCadence` matches, outside the reader's helpers),
 *  one row per line. The two server-caps lines that restate the server's own beat are excluded by name; the rows in
 *  the kept set carry their reason. 14 non-excluded rows in 7 checks at the base (the scope-sweep default among them,
 *  kept as call-bound) plus the kept OnActiveSec note; after C8b, the kept set alone. */
export function doctorRestatedCadences(root: string = REPO): DoctorCadenceSite[] {
  const out: DoctorCadenceSite[] = [];
  for (const l of doctorLines(root)) {
    if (EXCLUDED_DOCTOR_CADENCES.some(([fn, token]) => l.fn === fn && l.code.includes(token))) continue;
    const named = NAMED_DOCTOR_CADENCES.find(([fn, , token]) => l.fn === fn && l.code.includes(token));
    const kept = KEPT_DOCTOR_CADENCES.find(([fn, , token]) => l.fn === fn && l.code.includes(token));
    const structural = !(l.fn !== null && DOCTOR_CADENCE_READERS.has(l.fn)) && structuralCadence(l.code);
    if (named === undefined && kept === undefined && !structural) continue;
    const check = named?.[1] ?? kept?.[1] ?? (l.fn === null ? '(top level)' : l.fn.replace(/^_check_/, ''));
    out.push({ file: 'ccd/ccrc-doctor-checks', line: l.line, text: l.text, check, kept: kept?.[3] ?? null });
  }
  return out;
}

/** Every top-level line of `ccd/ccrc-doctor-checks` (outside any function body, not a comment) that calls a `_dr_*`,
 *  `_box_*` or `_timer_*` function: a call that runs whenever the table is sourced, including by a row that sources it
 *  without ccrc, under `set -u`, with no BOX_TREE_DIR. A bare `$(` is not the shape (the head resolves CCRC_HERE through
 *  `$(cd … && pwd)`, which calls none of them). 0 at the base and after C8b. */
export function doctorSourceTimeCalls(root: string = REPO): CensusSite[] {
  return doctorLines(root)
    .filter((l) => l.fn === null && /(?<![A-Za-z0-9_$-])_(?:dr|box|timer)_[A-Za-z0-9_-]*/.test(l.code))
    .map((l) => ({ file: 'ccd/ccrc-doctor-checks', line: l.line, text: l.text }));
}
