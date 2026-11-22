// The doctor's reads of `ccd caps` (model classes follow-up `doctor-caps-one-reader`, wave 7 review F6). Three checks ask
// which words this box's ccd advertises: `docs` (the Docs screen's two words), `cap-floor` (a standing fact's word) and
// `model-advance-blocked` (`alias-launch-v1`; its cases live in `ccrc-doctor-model-advance.test.ts`, beside the lane
// fixtures they need). This file pins the first two checks' output on a measured answer, with and without the words
// each reads, and on an unmeasured one (a failed read, a read past its bound, no ccd), each check run alone, sourced as
// `cmd_doctor` sources it, against a fixture HOME (`healthy()`) and a stub ccd.
import { describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSyncGroup } from './spawnGroup.js';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';
import { BASH, CCRC_SRC, CHECKS_SRC, doctorEnv, healthy, installDoctorHooks, shq } from './ccrc-doctorFixture.js';
import { DOCS_INDEX_READY, docsIndexStubScript } from './docsIndexFixtures.js';

removeTmpFixturesEachTest();
installDoctorHooks();

/** `$HOME/.local/bin/ccd`, replaced by `script` (a whole `#!/bin/sh` file), or removed when `script` is null. */
function plantCcd(home: string, script: string | null): void {
  const p = join(home, '.local', 'bin', 'ccd');
  rmSync(p, { force: true });
  if (script === null) return;
  mkdirSync(join(home, '.local', 'bin'), { recursive: true });
  writeFileSync(p, script, { mode: 0o755 });
}

/** A ccd that answers `docs-index` with the ready fixture and `caps` with `capsArm`, a line of shell. */
const docsCcd = (capsArm: string): string =>
  `#!/bin/sh\ncase "$1" in\n  caps) ${capsArm} ;;\n  *) printf '%s\\n' '${JSON.stringify(DOCS_INDEX_READY)}' ;;\nesac\n`;

/** Runs one check alone, as `cmd_doctor` runs it, and answers its verdict line, the line after it and its code. */
function check(home: string, name: string, extra: NodeJS.ProcessEnv = {}): { line: string; next: string; code: number; ms: number } {
  const t0 = Date.now();
  const r = spawnSyncGroup(BASH, ['-c', `set -uo pipefail\n. ${shq(CCRC_SRC)}\n. ${shq(CHECKS_SRC)}\n_check_${name}`],
    { env: { ...doctorEnv(home), ...extra }, encoding: 'utf8', timeout: 60_000 });
  const lines = (r.stdout ?? '').split('\n');
  const i = lines.findIndex((l) => l.startsWith('PASS ') || l.startsWith('WARN ') || l.startsWith('FAIL ') || l.startsWith('SKIP '));
  expect(i, `a verdict line: ${r.stdout}${r.stderr}`).toBeGreaterThanOrEqual(0);
  return { line: lines[i]!, next: lines[i + 1] ?? '', code: r.status ?? -1, ms: Date.now() - t0 };
}

const N = DOCS_INDEX_READY.projects.length;
const K = DOCS_INDEX_READY.projects.filter((p) => p.state === 'ready').length;
const DOCS_LINE = `${N} projects under ccd's projects root, ${K} served by Docs`;
const DOCS_TAIL = 'so Docs here has no per-doc history or no vision and promise sections';

describe('docs: what the caps read measured', () => {
  it('a measured list holding both words: PASS', () => {
    const home = healthy('ccrc-caps-docs-both-');
    plantCcd(home, docsIndexStubScript(JSON.stringify(DOCS_INDEX_READY), ['docs-log-v1', 'docs-sections-v2']));
    const r = check(home, 'docs');
    expect(r.line).toBe(`PASS docs: ${DOCS_LINE}`);
    expect(r.code).toBe(0);
  });

  it('a measured list without docs-log-v1: WARN naming it, remedy ccrc update', () => {
    const home = healthy('ccrc-caps-docs-nolog-');
    plantCcd(home, docsIndexStubScript(JSON.stringify(DOCS_INDEX_READY), ['docs-sections-v2']));
    const r = check(home, 'docs');
    expect(r.line).toBe(`WARN docs: ${DOCS_LINE}; this ccd does not list docs-log-v1, ${DOCS_TAIL}`);
    expect(r.next).toBe('  remedy: ccrc update');
    expect(r.code).toBe(2);
  });

  it('a measured list without either word: WARN naming both, remedy ccrc update', () => {
    const home = healthy('ccrc-caps-docs-neither-');
    plantCcd(home, docsCcd(`printf '%s\\n' caps ws-add`));
    const r = check(home, 'docs');
    expect(r.line).toBe(`WARN docs: ${DOCS_LINE}; this ccd does not list docs-log-v1 docs-sections-v2, ${DOCS_TAIL}`);
    expect(r.next).toBe('  remedy: ccrc update');
    expect(r.code).toBe(2);
  });
});

describe('cap-floor: what the caps read measured', () => {
  /** A box where a poolset stands for lane-b-overlord, so the check reads `ccd caps`. */
  function standing(prefix: string, script: string | null): string {
    const home = healthy(prefix);
    mkdirSync(join(home, '.cc-sessions'), { recursive: true });
    writeFileSync(join(home, '.cc-sessions', 'lane-b-overlord.poolset'), 'pool-a\n');
    plantCcd(home, script);
    return home;
  }
  const UNMEASURED = 'FAIL cap-floor: unmeasured: a fact stands, and this box\'s ccd caps did not answer';
  const UNMEASURED_FIX = '  remedy: run $HOME/.local/bin/ccd caps by hand to see why; ccrc update installs a ccd that answers';

  it('a measured list holding the word: PASS', () => {
    const r = check(standing('ccrc-caps-floor-pass-', `#!/bin/sh\nprintf '%s\\n' ws-add pool-set\n`), 'cap-floor');
    expect(r.line).toBe('PASS cap-floor: every standing fact\'s capability is advertised by this box\'s ccd');
    expect(r.code).toBe(0);
  });

  it('a measured list without the word: FAIL naming it and the id', () => {
    const r = check(standing('ccrc-caps-floor-lacks-', `#!/bin/sh\nprintf '%s\\n' ws-add hibernate\n`), 'cap-floor');
    expect(r.line).toBe('FAIL cap-floor: this box\'s ccd lacks pool-set while a poolset stands for lane-b-overlord, so it fails open there');
    expect(r.next).toMatch(/^ {2}remedy: ccrc update to a release whose ccd advertises pool-set, or /);
    expect(r.code).toBe(1);
  });

  it('a read that exits non-zero: FAIL unmeasured, its text and remedy as they were', () => {
    const r = check(standing('ccrc-caps-floor-exit-', '#!/bin/sh\nexit 1\n'), 'cap-floor');
    expect(r.line).toBe(UNMEASURED);
    expect(r.next).toBe(UNMEASURED_FIX);
    expect(r.code).toBe(1);
  });

  it('a read past its bound: FAIL unmeasured within the bound', () => {
    const r = check(standing('ccrc-caps-floor-hang-', '#!/bin/sh\nwhile :; do :; done\n'), 'cap-floor', { CCRC_DOCTOR_DOCS_TIMEOUT: '1' });
    expect(r.line).toBe(UNMEASURED);
    expect(r.next).toBe(UNMEASURED_FIX);
    expect(r.ms).toBeLessThan(20_000);
  });

  it('no ccd at all: FAIL unmeasured', () => {
    const r = check(standing('ccrc-caps-floor-noccd-', null), 'cap-floor');
    expect(r.line).toBe(UNMEASURED);
    expect(r.next).toBe(UNMEASURED_FIX);
  });
});
