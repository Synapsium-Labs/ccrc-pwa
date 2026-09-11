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
import { makeCcdHarness, seedAccountsSh, type CcdHarness } from './ccdWsHelpers.js';
import { POOL_TAG_CASES, stateWordForCcd } from './fixtures/poolTag.js';
import { POOLED_TEST_ROSTER } from './fixtures/poolRule.js';
import { loadConfig } from '../src/config.js';
import { localIO } from '../src/io.js';
import { POOLS_DIR_NAME, poolFor, readProjectPools } from '../src/pools.js';
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

/** A locale in which bash's `[a-z]` really does collate a non-ASCII letter into
 *  range — the condition D-2522's shadow exists to neutralise. */
const collatingLocale = localeWhere(
  '[[ "pool-"$(printf "\\xc3\\xa9") =~ ^[a-z][a-z0-9-]{0,31}$ ]] && echo yes || echo no',
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

  it('guards the guard: a locale that classifies U+3000 as space exists here', () => {
    // Without this the block below contrasts two locales that AGREE, which is
    // what made the first version of this file green under mutation.
    expect(wideSpaceLocale, 'no locale on this box classifies U+3000 as ' +
      '[[:space:]]; the contrast below cannot run and must not be read as ' +
      'evidence that the shadow works').not.toBeNull();
  });

  // The rows whose verdict MOVED with the locale before the shadow landed:
  // glibc classifies U+3000 and U+205F as space under a UTF-8 locale and not
  // under C, and `[a-z]` collates non-ASCII letters into range under a UTF-8
  // locale. Every row is driven anyway — the defect was never confined to
  // these, they are just the ones that were measured moving.
  it.each(POOL_TAG_CASES.map((c) => [c.name, c] as const))(
    'same answer under C and under a UTF-8 locale: %s', (_n, c) => {
      if (wideSpaceLocale === null) return;   // reported by the guard above
      plant(h.home, c.bytes);
      const snippet = `{ _project_pool_state ${JSON.stringify(PROJECT)}; } 2>&1`;
      const underC = h.sh(snippet, { LC_ALL: 'C' });
      const underUtf8 = h.sh(snippet, { LC_ALL: wideSpaceLocale });
      expect(underC, `${c.name}: C and ${wideSpaceLocale} disagree — ${c.why}`).toBe(underUtf8);
      // and both are the table's answer, so "deterministic" cannot be satisfied
      // by being consistently wrong.
      expect(underC, c.why).toBe(stateWordForCcd(c.expect));
    });
});

// ---------------------------------------------------------------------------
// D-2522 — the WRITER and the reader must accept the same names
// ---------------------------------------------------------------------------
describe('the ccd verb never writes a tag the server cannot read (D-2522)', () => {
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

  it('guards the guard: a locale whose [a-z] collates non-ASCII exists here', () => {
    // THE defect this block exists for only manifests in a locale with real
    // collation. `C.utf8` is UTF-8 and collates by codepoint, so selecting a
    // UTF-8 locale by NAME can pick one that cannot show the bug — measured,
    // and it is what made this block pass with the guard deleted.
    expect(collatingLocale, 'no locale on this box collates a non-ASCII letter ' +
      'into [a-z]; the rows below cannot exercise D-2522 and must not be read ' +
      'as evidence').not.toBeNull();
  });

  it.each(COLLATION_TRAPS)('_pool_name_valid rejects %j in every locale', (name) => {
    for (const loc of ['C', collatingLocale].filter((l): l is string => l !== null)) {
      const rc = h.sh(
        `_pool_name_valid ${JSON.stringify(name)}; echo $?`, { LC_ALL: loc },
      );
      expect(rc, `${name} was accepted under LC_ALL=${loc}; bash [a-z] is a ` +
        'COLLATION range, so the locale shadow in _pool_name_valid is what ' +
        'makes this a codepoint range like the TypeScript regex').toBe('1');
    }
  });

  it('guards the guard: a plain ASCII name is still ACCEPTED in every locale', () => {
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
  const ccrcRoot = path.resolve(
    path.dirname(new URL(import.meta.url).pathname), '..', '..',
  );
  const checks = path.join(ccrcRoot, 'ccd', 'ccrc-doctor-checks');

  /** Runs the doctor's pool check against a fixture HOME and says whether it
   *  called this project malformed. PATH is emptied exactly as
   *  `pool-name-parity.test.ts` does, so no real binary can be reached. */
  const doctorSaysMalformed = (bytes: string, locale: string): boolean => {
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
      return r.includes(`pools-malformed: ${PROJECT}`);
    } catch (e) {
      const out = String((e as { stdout?: string }).stdout ?? '');
      return out.includes(`pools-malformed: ${PROJECT}`);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  };

  it.each(POOL_TAG_CASES.map((c) => [c.name, c] as const))(
    'same verdict as the table, in every locale: %s', (_n, c) => {
      const want = c.expect.state === 'malformed';
      for (const loc of ['C', collatingLocale, wideSpaceLocale]
        .filter((l): l is string => l !== null)) {
        expect(doctorSaysMalformed(c.bytes, loc),
          `${c.name} under LC_ALL=${loc} — ${c.why}`).toBe(want);
      }
    });
});
