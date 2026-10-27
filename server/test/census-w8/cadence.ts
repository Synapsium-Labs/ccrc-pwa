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
