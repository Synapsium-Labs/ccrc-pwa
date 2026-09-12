// ONE corpus of tag bytes, driven through BOTH readers of
// `$REG/pools/<project>`, asserting they answer the same thing.
//
// WHAT THIS CATCHES THAT THE TWO EXISTING SUITES COULD NOT.
// `project-pools-read.test.ts` drives the TypeScript reader and
// `ccd-project-pool.test.ts` drives the bash one. Both are thorough; neither can
// see a DIVERGENCE, because each asserts its own reader against its own
// hand-written expectations. They were held in step by cross-referencing
// comments ("the cap is mirrored below", "grep -n ... ccd/ccd"), and prose is
// not a mechanism: four divergences (D-2519..D-2522) sat in the tree with both
// suites green. `ccd-pool-ok.test.ts` already solved this one layer up for the
// pool RULE by driving `fixtures/poolRule.ts` through both languages. This is
// that move for the PARSE.
//
// THE TWO READERS ARE NOT ASKED TO AGREE BY CONSTRUCTION. Each block asserts its
// own reader against the SHARED expectation in `fixtures/poolTag.ts`; agreement
// is then a consequence, not an assertion that could be satisfied by asking one
// reader twice. `stateWordForCcd` is the single place the two vocabularies
// (`tagged <n>` / `named <n>`) are mapped.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CCD, makeCcdHarness, seedAccountsSh, type CcdHarness } from './ccdWsHelpers.js';
import { POOL_TAG_CASES, stateWordForCcd } from './fixtures/poolTag.js';
import { POOLED_TEST_ROSTER } from './fixtures/poolRule.js';
import { loadConfig } from '../src/config.js';
import { localIO } from '../src/io.js';
import { POOLS_DIR_NAME, poolFor, readProjectPools } from '../src/pools.js';
import { POOL_NAME_RE } from '../../shared/roster.js';
import { seedRoster } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const PROJECT = 'demo';

/** Writes the tag file with EXACT bytes — no trailing newline is added, because
 *  in this table the trailing byte IS the subject. */
const plant = (home: string, bytes: string): void => {
  const dir = path.join(home, '.cc-sessions', POOLS_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, PROJECT), bytes);
};

// ---------------------------------------------------------------------------
// The TypeScript reader
// ---------------------------------------------------------------------------
describe('server/src/pools.ts reads every tag in POOL_TAG_CASES as the table says', () => {
  let home: string;
  beforeEach(() => {
    home = mkTmp('ccrc-pool-tag-parity-ts-');
    seedRoster(home);
    fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  });
  afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

  it.each(POOL_TAG_CASES.map((c) => [c.name, c] as const))('%s', async (_n, c) => {
    plant(home, c.bytes);
    const reg = path.join(home, '.cc-sessions');
    const read = await readProjectPools(
      localIO, loadConfig({ CCRC_HOME: home }), await localIO.readdir(reg), 5_000,
    );
    expect(poolFor(read, PROJECT), c.why).toEqual(c.expect);
  });
});

// ---------------------------------------------------------------------------
// The bash reader
// ---------------------------------------------------------------------------
describe('ccd/ccd _project_pool_state reads every tag in POOL_TAG_CASES the same way', () => {
  let h: CcdHarness;
  beforeEach(() => {
    h = makeCcdHarness('ccrc-pool-tag-parity-ccd-');
    seedAccountsSh(h.home, POOLED_TEST_ROSTER);
  });
  afterEach(() => { h.cleanup(); });

  it.each(POOL_TAG_CASES.map((c) => [c.name, c] as const))('%s', (_n, c) => {
    plant(h.home, c.bytes);
    // stderr FOLDED IN: "the reader printed a word" and "the reader printed a
    // word and also complained" are different facts, and only one is passing.
    const got = h.sh(`{ _project_pool_state ${JSON.stringify(PROJECT)}; } 2>&1`);
    expect(got, c.why).toBe(stateWordForCcd(c.expect));
  });
});

// ---------------------------------------------------------------------------
// D-2520 — the same bytes must not decide differently in a different locale
// ---------------------------------------------------------------------------
/** Locales are chosen by MEASURING the property each block needs, never by
 *  name. This is not fussiness — it is the defect the mutation matrix caught in
 *  this very file. The first version picked `/^(C|en_US)\.(utf8|UTF-8)$/` off
 *  `locale -a`, which selects `C.utf8` on this box; `C.utf8` is a UTF-8 locale
 *  whose COLLATION is codepoint order, so bash's `[a-z]` behaves there exactly
 *  as it does under `C`. The contrast was between two locales that agree, and
 *  deleting the guard it was meant to pin left the suite GREEN.
 *
 *  A guard whose input is derived from the environment can only be exercised on
 *  an environment that HAS the property. So: probe for one, and if the box has
 *  none, say so out loud rather than pass quietly. */
/** bash's absolute path, resolved ONCE under this process's real PATH — the
 *  same move `pool-name-parity.test.ts` makes, and for the same reason. */
const BASH = execFileSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).trim();

/** Every UTF-8 locale this box LISTS, or `null` when `locale -a` itself cannot
 *  be run (a minimal container may ship no `locale` binary at all). Enumerated
 *  ONCE, because the guard below has to tell "this box lists none" from "this
 *  box lists some and the probe still found nothing" — and it cannot ask that
 *  question of a list `localeWhere` threw away. */
const utf8Locales = (): string[] | null => {
  try {
    return execFileSync('locale', ['-a'], { encoding: 'utf8' })
      .split('\n').map((raw) => raw.trim())
      .filter((loc) => loc !== '' && /utf-?8$/i.test(loc));
  } catch { return null; }
};
const UTF8_LOCALES = utf8Locales();

/** THE ONE PLACE a probe is spawned under a locale. Both the property probes
 *  and the delivery check below ride this, deliberately: a second copy of the
 *  `env` spread would let the delivery check pass while `localeWhere` dropped
 *  `LC_ALL` entirely, which is a check that pins its own copy and nothing
 *  else. */
const runUnder = (loc: string, script: string): string =>
  execFileSync('bash', ['-c', script], {
    encoding: 'utf8', env: { ...process.env, LC_ALL: loc }, timeout: 10_000,
  });

const localeWhere = (probe: string): string | null => {
  for (const loc of UTF8_LOCALES ?? []) {
    try {
      if (runUnder(loc, probe).trim() === 'yes') return loc;
    } catch { /* locale unusable for this probe; try the next */ }
  }
  return null;
};

/** Did `LC_ALL` actually ARRIVE, over the same channel the probes ride? Asked
 *  by having the shell echo back what it was handed.
 *
 *  THE PROBES CANNOT ANSWER THIS, and that is why it is a separate question.
 *  `echo yes` prints `yes` in every locale, so a channel that dropped `LC_ALL`
 *  would still report `found` — measured: a bogus `LC_ALL`, an unset one and an
 *  empty one all print `yes`. Every locale claim in this file rides delivery,
 *  so an undelivered `LC_ALL` would make both property probes answer about the
 *  AMBIENT locale, skip everything they gate, and leave the suite green and
 *  meaningless. */
const lcAllArrivingAs = (loc: string): string => {
  // A THROW IS AN ANSWER, not an exception to leak. `runUnder` throws when the
  // spawn fails or bash exits non-zero, and an unhandled throw inside the `it`
  // below would red a clean tree for a locale the box merely dislikes — which
  // is the exact failure shape this whole change exists to remove. Reported as
  // a value the assertion compares and names.
  try { return runUnder(loc, 'printf %s "${LC_ALL-}"'); }
  catch (e) { return `THREW: ${String((e as Error).message).slice(0, 120)}`; }
};

/** WHY a `localeWhere` probe came back null. THE ONE PLACE that question is
 *  decided, and the reason it is a function of two LITERALS rather than a
 *  branch inside the guard: a decision derived from the environment can only be
 *  exercised on an environment that has the property, so the decision itself is
 *  lifted out where a table can feed it every case from any box.
 *
 *  FOUR conditions, four values. `probe-broken` is a defect IN THIS FILE — the
 *  box lists UTF-8 locales and a trivially satisfiable probe still matched none,
 *  so `localeWhere` is not returning answers at all (bash unspawnable, stdout
 *  polluted, the probe string broken) and every skip below is silently
 *  meaningless. It does NOT mean `LC_ALL` failed to arrive: `echo yes` prints
 *  `yes` in every locale, so no break of delivery can reach this arm — that is
 *  a separate question, and `deliversLcAll` is where it is asked. The other two nulls are facts about the HOST, which
 *  a hermetic suite must report as skipped and must never turn red.
 *
 *  The guard below folds `no-locale-tool` and `no-utf8-locale` together, and
 *  that is deliberate rather than the rule being bent: folding two HONEST
 *  answers loses nothing a caller acts on, while folding an honest answer into
 *  a defect is what D-2588 was. They stay separate values so the distinction
 *  survives for the next caller and so a failure message can name which — the
 *  fold is the caller's choice to make, not a distinction the seam destroyed.
 *
 *  The first version of the guard asserted `not.toBeNull()`, which is
 *  `probe-broken` and `no-utf8-locale` carrying one value — measured RED on a
 *  box whose `locale -a` lists no UTF-8 locale, with the other 29 rows
 *  correctly skipping. */
export type ProbeVerdict = 'found' | 'no-locale-tool' | 'no-utf8-locale' | 'probe-broken';

export const probeVerdict = (
  candidates: readonly string[] | null,
  found: string | null,
): ProbeVerdict => {
  if (found !== null) return 'found';
  if (candidates === null) return 'no-locale-tool';
  return candidates.length === 0 ? 'no-utf8-locale' : 'probe-broken';
};

/** `skipIf` gates EXECUTION, not the TYPE, so a block it guards still sees
 *  `string | null`. Throwing here rather than defaulting is deliberate: a
 *  default of `'C'` would make a block that wrongly ran compare C against C,
 *  agree trivially, and pass — the precise failure this file already made once
 *  by picking a locale that could not show the defect. */
const required = (v: string | null, what: string): string => {
  if (v === null) {
    throw new Error(`${what} is null but its block ran — skipIf did not gate it`);
  }
  return v;
};

/** A locale in which bash's `[a-z]` really does collate a non-ASCII letter into
 *  range — the condition D-2522's shadow exists to neutralise. */
const collatingLocale = localeWhere(
  // THE GRAMMAR COMES FROM `POOL_NAME_RE`, not from a fifth hand-typed copy.
  // `pool-name-parity.test.ts` exists to hold three spellings equal; a literal
  // here would be a fourth that no scan can see, which is the exact shape of
  // the defect D-2522 is about.
  `[[ "pool-"$(printf "\\xc3\\xa9") =~ ${POOL_NAME_RE.source} ]] && echo yes || echo no`,
);

/** A locale in which `[[:space:]]` really does classify U+3000 as space — the
 *  condition D-2520's shadow exists to neutralise. */
const wideSpaceLocale = localeWhere(
  'v="pool-a$(printf "\\xe3\\x80\\x80")"; '
  + '[[ "${v%"${v##*[![:space:]]}"}" == "pool-a" ]] && echo yes || echo no',
);

// ---------------------------------------------------------------------------
// The skip conditions' own premise
// ---------------------------------------------------------------------------
// Every `skipIf` in this file reads a null from `localeWhere` as a fact about
// the HOST. This table is what makes that reading sound, and it is fed LITERALS
// on purpose: the guard one block down can only ever exercise the one arm THIS
// box happens to be in, so the arm that matters on some other box would ship
// unexecuted. Four arms, every box (D-2588).
describe('probeVerdict tells a host without the locale from a probe that never worked', () => {
  it.each([
    // candidates                    found          verdict            why
    [['en_US.utf8'],                 'en_US.utf8',  'found',           'the ordinary case'],
    [[],                             null,          'no-utf8-locale',  'a minimal container: `locale -a` runs and lists no UTF-8 locale. HONEST — skip, never red. This is the row the shipped guard got wrong'],
    [null,                           null,          'no-locale-tool',  '`locale` itself could not be run, so the question cannot even be asked'],
    [['en_US.utf8', 'C.utf8'],       null,          'probe-broken',    'THE defect arm: locales are listed and a trivially satisfiable probe still matched none, so localeWhere is not returning answers at all'],
    [[],                             'C.utf8',      'found',           'a hit outranks an empty list — pins the precedence rather than leaving it to argument order'],
  ] as const)('%j + %j -> %s', (candidates, found, want, why) => {
    expect(probeVerdict(candidates, found), why).toBe(want);
  });

  it('the four verdicts are distinct, so no two conditions share a value', () => {
    // The rule this file lives under: two conditions a caller handles
    // differently must not collapse to one value. A fold would still pass every
    // row above if both folded arms were spelled the same way there too.
    const all = [
      probeVerdict(['x.utf8'], 'x.utf8'),
      probeVerdict([], null),
      probeVerdict(null, null),
      probeVerdict(['x.utf8'], null),
    ];
    expect(new Set(all).size, `two conditions answer the same word: ${all.join(', ')}`).toBe(4);
  });
});

describe('ccd/ccd _project_pool_state is LOCALE-INDEPENDENT (D-2520)', () => {
  let h: CcdHarness;
  beforeEach(() => {
    h = makeCcdHarness('ccrc-pool-tag-locale-');
    seedAccountsSh(h.home, POOLED_TEST_ROSTER);
  });
  afterEach(() => { h.cleanup(); });

  it('guards the guard: a null probe is a fact about this BOX, never a broken probe', () => {
    // Asserts the MACHINERY, not the host. The two skip conditions above read a
    // null from `localeWhere` as "this box has no locale with that property";
    // that reading is only sound while a null cannot ALSO mean "the probe never
    // worked". `probeVerdict` is where the two are told apart, and only its
    // `probe-broken` arm is a defect here — a box that lists no UTF-8 locale,
    // or ships no `locale` binary, is answering honestly and must skip rather
    // than red. Asserting `not.toBeNull()` here instead is exactly the fold
    // this case exists to forbid (D-2588).
    const verdict = probeVerdict(UTF8_LOCALES, localeWhere('echo yes'));
    expect(verdict, `this box LISTS ${UTF8_LOCALES?.length ?? 0} UTF-8 locale(s) ` +
      'and `echo yes` still matched none of them, so `localeWhere` is not ' +
      'returning answers at all and every skip in this file is meaningless')
      .not.toBe('probe-broken');
  });

  // ...and the channel really carries LC_ALL. A SEPARATE question, because the
  // probe above cannot ask it: `echo yes` is locale-invariant, so a dropped
  // `LC_ALL` reads as `found`. Without this, every locale claim in the file
  // could be measuring the ambient locale and nothing would say so.
  // THE LOCALES THIS FILE ACTUALLY MAKES CLAIMS ABOUT — the two the probes
  // selected, plus the first candidate, which is the one the guard above
  // reaches. Deliberately NOT every locale the box lists: the question is
  // whether the CHANNEL carries `LC_ALL`, which one locale answers as well as
  // two hundred, and macOS lists close to two hundred UTF-8 locales. Spawning a
  // shell per locale to re-answer a settled question is how a guard becomes the
  // slowest and most fragile thing in a suite.
  const CLAIMED_LOCALES = [...new Set(
    [(UTF8_LOCALES ?? [])[0], collatingLocale, wideSpaceLocale]
      .filter((l): l is string => typeof l === 'string' && l !== ''),
  )];

  it.skipIf(CLAIMED_LOCALES.length === 0)(
    'guards the guard: LC_ALL really ARRIVES over the channel the probes ride', () => {
    for (const loc of CLAIMED_LOCALES) {
      // Asserts the VALUE that arrived, not a boolean a helper computed. A
      // helper returning `true` would satisfy a boolean assertion while
      // measuring nothing — mutation showed exactly that, so the comparison
      // lives here and `lcAllArrivingAs` only carries the value across.
      // The message names what was OBSERVED and what follows from it, never a
      // cause it cannot tell apart: a `THREW:` value means the spawn failed,
      // any other mismatch means the channel dropped `LC_ALL`. Both defeat
      // every locale claim in this file, and the received value says which.
      expect(lcAllArrivingAs(loc), `LC_ALL=${loc} did not come back from the ` +
        'spawned shell (a THREW: value means the spawn failed, any other ' +
        'mismatch means the channel dropped it) — either way every locale this ' +
        'file claims to measure would be the ambient one')
        .toBe(loc);
    }
  });

  // The rows whose verdict MOVED with the locale before the shadow landed:
  // glibc classifies U+3000 and U+205F as space under a UTF-8 locale and not
  // under C, and `[a-z]` collates non-ASCII letters into range under a UTF-8
  // locale. Every row is driven anyway — the defect was never confined to
  // these, they are just the ones that were measured moving.
  it.skipIf(wideSpaceLocale === null)
    .each(POOL_TAG_CASES.map((c) => [c.name, c] as const))(
    'same answer under C and under a UTF-8 locale: %s', (_n, c) => {
      plant(h.home, c.bytes);
      const snippet = `{ _project_pool_state ${JSON.stringify(PROJECT)}; } 2>&1`;
      const underC = h.sh(snippet, { LC_ALL: 'C' });
      const wide = required(wideSpaceLocale, 'wideSpaceLocale');
      const underUtf8 = h.sh(snippet, { LC_ALL: wide });
      expect(underC, `${c.name}: C and ${wide} disagree — ${c.why}`).toBe(underUtf8);
      // and both are the table's answer, so "deterministic" cannot be satisfied
      // by being consistently wrong.
      expect(underC, c.why).toBe(stateWordForCcd(c.expect));
    });
});

// ---------------------------------------------------------------------------
// D-2522 — the WRITER and the reader must accept the same names
// ---------------------------------------------------------------------------
describe('the harness really delivers LC_ALL to ccd (the channel every locale claim rides)', () => {
  let h: CcdHarness;
  beforeEach(() => {
    h = makeCcdHarness('ccrc-pool-tag-env-');
    seedAccountsSh(h.home, POOLED_TEST_ROSTER);
  });
  afterEach(() => { h.cleanup(); });

  // EVERY locale assertion in this file is delivered through `h.sh(snippet,
  // { LC_ALL })`. The probes above verify the PROPERTY over `execFileSync` — a
  // different channel. If `sh()` dropped or overrode the variable, both locale
  // blocks would compare two runs in the SAME locale, agree trivially, and pin
  // nothing, exactly the way choosing `C.utf8` by name did. Cheap to check, and
  // nothing else checks it.
  it('sh() passes LC_ALL through to the shell it spawns', () => {
    expect(h.sh('printf %s "$LC_ALL"', { LC_ALL: 'C' })).toBe('C');
    expect(h.sh('printf %s "$LC_ALL"', { LC_ALL: 'POSIX' })).toBe('POSIX');
  });
});

// ---------------------------------------------------------------------------
// The source-level pin: runs on EVERY box, including those that cannot show
// the behaviour
// ---------------------------------------------------------------------------
describe('the locale shadows are present in the source (D-2520/D-2522/D-2542)', () => {
  // `CCD` comes from `ccdWsHelpers.ts`, which `single-definition.test.ts`
  // requires to be the ONE file spelling the path to the ccd script — measured,
  // because an earlier draft joined it here and that scan went red. The doctor
  // sits beside it, so it is derived rather than spelled a second time.
  const ccdSrc = fs.readFileSync(CCD, 'utf8');
  const checksSrc = fs.readFileSync(path.join(path.dirname(CCD), 'ccrc-doctor-checks'), 'utf8');

  /** The body of a bash function, from its `name() {` to the first line that is
   *  a bare `}` at column 0 — enough for these four, all of which are written
   *  that way, and a miss throws rather than returning an empty string that
   *  would make every assertion below vacuous. */
  const body = (src: string, name: string): string => {
    const start = src.indexOf(`${name}() {`);
    if (start < 0) throw new Error(`${name} not found — this pin is measuring nothing`);
    const end = src.indexOf('\n}\n', start);
    if (end < 0) throw new Error(`${name} has no closing brace at column 0`);
    return src.slice(start, end);
  };

  it.each([
    ['_project_pool_state', 'the strip, the -n 64 cap and the grammar it calls'],
    ['_pool_name_valid', 'the grammar, at BOTH the reader and the writer'],
    ['_ws_project_valid', 'the project-name grammar the same verb also gates on'],
  ])('ccd/ccd %s shadows the locale — %s', (fn) => {
    expect(body(ccdSrc, fn), `${fn} lost its 'local LC_ALL=C'; on a box with a ` +
      'collating or wide-space locale its answers move with the environment')
      .toContain('local LC_ALL=C');
  });

  it('ccd/ccrc-doctor-checks _check_pools shadows the locale', () => {
    expect(body(checksSrc, '_check_pools')).toContain('local LC_ALL=C');
  });

  it('guards the guard: the extractor really reads a body, and a body without the shadow fails', () => {
    // Without this, a `body()` that silently returned '' would make all four
    // assertions above pass for the wrong reason.
    expect(body(ccdSrc, '_project_pool_state').length).toBeGreaterThan(200);
    expect(body(ccdSrc, '_lane_enabled')).not.toContain('local LC_ALL=C');
  });
});

// NAMED FOR WHAT IT RUNS. An earlier title said "the ccd verb never writes a tag
// the server cannot read", and the block does not run `ccd project-pool` — it
// drives `_pool_name_valid`, the gate `cmd_project_pool` puts in front of the
// write (ccd/ccd, the `_pool_name_valid "$pool"` call). That is the unit where
// the defect lives, and pinning it is what makes the verb safe; but the title
// has to say which of the two it measures.
describe('_pool_name_valid — the gate cmd_project_pool writes through (D-2522)', () => {
  let h: CcdHarness;
  beforeEach(() => {
    h = makeCcdHarness('ccrc-pool-tag-writer-');
    seedAccountsSh(h.home, POOLED_TEST_ROSTER);
  });
  afterEach(() => { h.cleanup(); });

  // `_pool_name_valid` is the gate `cmd_project_pool` puts in front of the
  // write. Before the locale shadow it ACCEPTED these under en_US.UTF-8 by
  // collation, so the supported verb could create a tag the TypeScript reader
  // answers `malformed` for — a file the console can never decide, produced by
  // the documented path rather than by a hand edit.
  const COLLATION_TRAPS = ['pool-\u00E9', 'pool-\u00E5', 'pool-\u00FC', 'pool-\u00F1'];

  // THE defect this block exercises only manifests in a locale with real
  // collation. `C.utf8` is UTF-8 and collates by CODEPOINT, so a box whose only
  // UTF-8 locale is `C.utf8` — a stock node container, and possibly the macOS
  // CI leg — cannot show the bug at all. That is a fact about the HOST, and the
  // suite is documented hermetic, so it must NOT become a red run there.
  // Skipped is visible in vitest's output; red would be a lie.
  // What covers those boxes instead is `the shadows are present in the source`
  // below: a guard whose input is derived from the environment can only be
  // EXERCISED where that environment exists, so it also needs a pin that reads
  // the source and runs everywhere.
  it.skipIf(collatingLocale === null)
    .each(COLLATION_TRAPS)('_pool_name_valid rejects %j in every locale', (name) => {
    for (const loc of ['C', collatingLocale].filter((l): l is string => l !== null)) {
      const rc = h.sh(
        `_pool_name_valid ${JSON.stringify(name)}; echo $?`, { LC_ALL: loc },
      );
      expect(rc, `${name} was accepted under LC_ALL=${loc}; bash [a-z] is a ` +
        'COLLATION range, so the locale shadow in _pool_name_valid is what ' +
        'makes this a codepoint range like the TypeScript regex').toBe('1');
    }
  });

  it.skipIf(collatingLocale === null)(
    'guards the guard: a plain ASCII name is still ACCEPTED in every locale', () => {
    // Without this, "rejects everything" would satisfy the block above.
    for (const loc of ['C', collatingLocale].filter((l): l is string => l !== null)) {
      expect(h.sh('_pool_name_valid "pool-a"; echo $?', { LC_ALL: loc }), loc).toBe('0');
    }
  });
});

// ---------------------------------------------------------------------------
// The THIRD reader: ccd/ccrc-doctor-checks
// ---------------------------------------------------------------------------
// `_check_pools` repeats the cap, the strip and the grammar a third time, and is
// pinned byte-equal to the other two spellings by `pool-name-parity.test.ts`.
// Byte-equal is not behaviour-equal while the locale is free, so the doctor gets
// the same shadow — and, since mutation showed nothing was driving it, the same
// corpus. A doctor that disagrees with the reader is a check reporting on a
// world its own subject does not live in.
describe('ccd/ccrc-doctor-checks _check_pools agrees with the other two readers', () => {
  // `fileURLToPath`, not `new URL(...).pathname` — the sibling suite this block
  // is modelled on uses it, and pathname keeps percent-encoding, so a checkout
  // under a path with a space resolves to a directory that does not exist.
  const ccrcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const checks = path.join(ccrcRoot, 'ccd', 'ccrc-doctor-checks');

  /** The doctor's verdict for this project, as one of three WORDS rather than a
   *  boolean. A boolean `saysMalformed` folds `pools-unreadable`, `pools-
   *  unlistable`, an unrecognised future verdict and an interpreter that never
   *  ran into the single value `false`, so every row expecting `tagged` would
   *  pass on all of them — the block would report parity while the doctor and
   *  the authority disagreed. Raised in review; it was a real hole. */
  const doctorVerdict = (bytes: string, locale: string): string => {
    const home = mkTmp('ccrc-pool-tag-doctor-');
    try {
      plant(home, bytes);
      fs.mkdirSync(path.join(home, 'projects', PROJECT), { recursive: true });
      // ABSOLUTE bash, resolved once under this process's real PATH. The
      // spawned shell gets PATH='' so no real binary can be reached from
      // inside the check (the containment `pool-name-parity.test.ts` uses) —
      // and that is exactly why the interpreter cannot be named 'bash' here:
      // with an empty PATH there would be nothing to resolve it against, and
      // the check dies before it classifies anything. Measured: naming it
      // 'bash' made all 15 rows of this block fail for that reason alone.
      const r = execFileSync(BASH, [
        '-c', `set -uo pipefail; . ${JSON.stringify(checks)}; _check_pools`,
      ], { encoding: 'utf8', cwd: home, env: { HOME: home, PATH: '', LC_ALL: locale } });
      return classify(r);
    } catch (e) {
      // A non-zero exit is NORMAL here: `_check_pools` returns 1 on FAIL. What
      // is not normal is no verdict line at all, and `classify` says so.
      return classify(String((e as { stdout?: string }).stdout ?? ''));
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  };

  /** Maps the doctor's own contract — `PASS|WARN|FAIL <name>: <detail>` — onto
   *  the two words this corpus knows, and refuses to guess at anything else. */
  const classify = (out: string): string => {
    if (out.includes(`pools-malformed: ${PROJECT}`)) return 'malformed';
    if (/^PASS pools:/m.test(out)) return 'tagged';
    const line = out.split('\n').find((l) => /^(PASS|WARN|FAIL) pools:/.test(l));
    return line ? `other: ${line.slice(0, 90)}` : `NO VERDICT LINE: ${out.slice(0, 90)}`;
  };

  it.each(POOL_TAG_CASES.map((c) => [c.name, c] as const))(
    'same verdict as the table, in every locale: %s', (_n, c) => {
      const want = c.expect.state === 'malformed' ? 'malformed' : 'tagged';
      for (const loc of ['C', collatingLocale, wideSpaceLocale]
        .filter((l): l is string => l !== null)) {
        // Asserts the WORD, so `pools-unreadable`, a new verdict, or a dead
        // interpreter all fail loudly instead of satisfying "not malformed".
        expect(doctorVerdict(c.bytes, loc),
          `${c.name} under LC_ALL=${loc} — ${c.why}`).toBe(want);
      }
    });
});
