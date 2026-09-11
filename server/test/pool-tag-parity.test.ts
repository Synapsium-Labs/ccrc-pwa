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
/** A UTF-8 locale this box actually has, or null. `en_US.UTF-8` is present on
 *  the fleet box and on CI's ubuntu image but is NOT universal, and a test that
 *  silently passes because the locale was missing would pin nothing — so the
 *  absence is reported as a skip with a reason, never as a green. */
const utf8Locale = ((): string | null => {
  try {
    const names = execFileSync('locale', ['-a'], { encoding: 'utf8' }).split('\n');
    return names.find((n) => /^(C|en_US)\.(utf8|UTF-8)$/i.test(n.trim()))?.trim() ?? null;
  } catch { return null; }
})();

describe('ccd/ccd _project_pool_state is LOCALE-INDEPENDENT (D-2520)', () => {
  let h: CcdHarness;
  beforeEach(() => {
    h = makeCcdHarness('ccrc-pool-tag-locale-');
    seedAccountsSh(h.home, POOLED_TEST_ROSTER);
  });
  afterEach(() => { h.cleanup(); });

  it('guards the guard: a UTF-8 locale is available to contrast against C', () => {
    // If this ever fails, the block below is measuring ONE locale twice and
    // proving nothing. Better to say so out loud than to pass quietly.
    expect(utf8Locale, 'no C.UTF-8 or en_US.UTF-8 on this box; the locale ' +
      'contrast below cannot run and must not be read as evidence').not.toBeNull();
  });

  // The rows whose verdict MOVED with the locale before the shadow landed:
  // glibc classifies U+3000 and U+205F as space under a UTF-8 locale and not
  // under C, and `[a-z]` collates non-ASCII letters into range under a UTF-8
  // locale. Every row is driven anyway — the defect was never confined to
  // these, they are just the ones that were measured moving.
  it.each(POOL_TAG_CASES.map((c) => [c.name, c] as const))(
    'same answer under C and under a UTF-8 locale: %s', (_n, c) => {
      if (utf8Locale === null) return;       // reported by the guard above
      plant(h.home, c.bytes);
      const snippet = `{ _project_pool_state ${JSON.stringify(PROJECT)}; } 2>&1`;
      const underC = h.sh(snippet, { LC_ALL: 'C' });
      const underUtf8 = h.sh(snippet, { LC_ALL: utf8Locale });
      expect(underC, `${c.name}: C and ${utf8Locale} disagree — ${c.why}`).toBe(underUtf8);
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

  it.each(COLLATION_TRAPS)('_pool_name_valid rejects %j in every locale', (name) => {
    for (const loc of ['C', utf8Locale].filter((l): l is string => l !== null)) {
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
    for (const loc of ['C', utf8Locale].filter((l): l is string => l !== null)) {
      expect(h.sh('_pool_name_valid "pool-a"; echo $?', { LC_ALL: loc }), loc).toBe('0');
    }
  });
});
