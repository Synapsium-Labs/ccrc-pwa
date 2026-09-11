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

const localeWhere = (probe: string): string | null => {
  let names: string[];
  try {
    names = execFileSync('locale', ['-a'], { encoding: 'utf8' }).split('\n');
  } catch { return null; }
  for (const raw of names) {
    const loc = raw.trim();
    if (loc === '' || !/utf-?8$/i.test(loc)) continue;
    try {
      const out = execFileSync('bash', ['-c', probe], {
        encoding: 'utf8', env: { ...process.env, LC_ALL: loc }, timeout: 10_000,
      }).trim();
      if (out === 'yes') return loc;
    } catch { /* locale unusable for this probe; try the next */ }
  }
  return null;
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

describe('ccd/ccd _project_pool_state is LOCALE-INDEPENDENT (D-2520)', () => {
  let h: CcdHarness;
  beforeEach(() => {
    h = makeCcdHarness('ccrc-pool-tag-locale-');
    seedAccountsSh(h.home, POOLED_TEST_ROSTER);
  });
  afterEach(() => { h.cleanup(); });

  it('guards the guard: the locale PROBE works, whatever this box happens to have', () => {
    // Asserts the MACHINERY, not the host. `localeWhere` returning null must
    // mean "this box has no such locale" and never "the probe is broken", or
    // every skip below is silently meaningless.
    expect(localeWhere('echo yes'), 'the probe found no usable UTF-8 locale at ' +
      'all, so a null result above cannot be read as a fact about collation')
      .not.toBeNull();
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
