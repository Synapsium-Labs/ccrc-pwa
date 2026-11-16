// The capability floor of the Overlord W1 pool set (plan w1-pool-set.md, Task 8 and its Table 2), pinned end to end.
//
// While any `~/.cc-sessions/<id>.poolset` entry stands, no install and no rollback takes the box to a build whose stamp
// does not advertise the `pool-set` word in `ccdCaps`: `_upd_cap_floor_check` (ccd/ccrc) reads the stamp's `ccdCaps`
// through `_box_build_fields` (`BOX_BUILD[5]`) and refuses with exit 1 and "Nothing on this box was changed", the remedy
// leading the sentence. This suite drives the four call sites and the data table:
//   (a) `cmd_update`, on the staged tree's `build.json`;
//   (b) `cmd_rollback`'s kept (flip) branch, on the kept tree's stamp copy;
//   restore arm 1 (the previous version's kept stamp, WARN only) and restore arm 3 (no stamp, WARN only);
//   the table: one data row added to `CAP_FLOOR_ROWS` in a COPY of ccd/ccrc, no code changed, is read by the same check.
// `--from restore` and `--from watchdog` warn and proceed; `--force` never passes the refusal. All HOMEs are fixtures.

import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';
import { scaled } from './timeScale.js';
import { itLinux } from './platformFixtures.js';
import { keepDigest } from './installTreeFixture.js';
import { printableDetail } from '../src/update/inventory.js';
import {
  REPO, BASH, updateEnv, plantOldBox, writeManifest, fullTree, stubTree, packRelease, runUpdate, freshUpdateBox,
  sourcedCcrc, lastReport, plantW6Box, keptVersion, rollbackRun, onKeptV1, plantKillModeDropIn, UNIT_LINES, plantRestoreBox,
  fileText, linkOf, V1_SHA, V2_SHA, shippedStamp,
} from './ccrc-updateFixture.js';

removeTmpFixturesEachTest();

const REMEDY = 'the operator clears the set from their own shell, never a session: ccd route --session <id> --set poolset= --set acctorder=';
/** The remedy's way out, which the console's 200-character cut must keep (F5: only what exists today). */
const WAY_OUT = 'ccd route --session <id> --set poolset= --set acctorder=';
const LACKS = 'the target build lacks pool-set';
const ABSENT = 'builds before ccdCaps predate pool-set';
const MALFORMED = "the target's ccdCaps cannot be read";
const UNLISTABLE = 'make ~/.cc-sessions listable';
const NOTHING = 'Nothing on this box was changed';
const WARN_TAIL = (from: string): string => ` - proceeding because this run is --from ${from}`;
/** The pool set B2's override, at the refusal's front: the one typed way past the row, beside its remedy. */
const OVERRIDE = 'pass --below-cap pool-set, or ';
/** The WARN a passed row prints (pool set B2): what it passed, why, and for whom. */
const PASSED = (why: string, ids = 'lane-b-overlord'): string =>
  `update: WARN: --below-cap passed the capability floor for pool-set (${why}; a poolset stands for ${ids}) - a box below the word ignores that fact`;

/** A set standing for `id`: a regular file at `~/.cc-sessions/<id>.poolset`. */
function plantSet(home: string, id = 'lane-b-overlord'): string {
  const reg = join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const p = join(reg, `${id}.poolset`);
  writeFileSync(p, 'pool-a\n');
  return p;
}

/** Rewrite a stamp file's `ccdCaps`: `undefined` removes the key, anything else is written as given. */
function setCaps(stampPath: string, caps: unknown): void {
  const o = JSON.parse(readFileSync(stampPath, 'utf8')) as Record<string, unknown>;
  if (caps === undefined) delete o['ccdCaps']; else o['ccdCaps'] = caps;
  writeFileSync(stampPath, `${JSON.stringify(o)}\n`);
}

/** A STUB v2.0.0 release whose staged `build.json` carries `caps` (see `setCaps`), published as latest. */
function publishStub(home: string, caps: unknown): void {
  const tree = stubTree(home, { version: 'v2.0.0' });
  setCaps(join(tree, 'build.json'), caps);
  rmSync(join(tree, 'MANIFEST'));
  writeManifest(tree);
  packRelease(home, tree, { tag: 'v2.0.0' });
}

/** A box on v1.0.0 with the stub v2.0.0 published (its stamp caps as given): a bare update moves it. */
function movingBox(prefix: string, caps: unknown): string {
  const home = freshUpdateBox(prefix);
  plantOldBox(home, { version: 'v1.0.0' });
  publishStub(home, caps);
  return home;
}

/** What "nothing changed" means for the install: the stamp, the completed-install record, the `~/ccrc` link. */
function snapshot(home: string): { stamp: string; installed: string | null; link: string | null } {
  const inst = join(home, '.ccrc', 'installed');
  return {
    stamp: fileText(join(home, '.ccrc', 'build.json')),
    installed: existsSync(inst) ? fileText(inst) : null,
    link: linkOf(home),
  };
}

/** Asserts the refusal: exit 1, the remedy-led sentence on stderr, and the box exactly as it was. */
function expectRefused(home: string, before: ReturnType<typeof snapshot>, r: { code: number; stderr: string }, why: string): void {
  expect(r.code, `stderr: ${r.stderr}`).toBe(1);
  expect(r.stderr).toContain(`${OVERRIDE}${REMEDY}: ${why}; a poolset stands for lane-b-overlord. ${NOTHING}`);
  expect(snapshot(home)).toEqual(before);
}

describe('capability floor, call site (a): a bare update reads the staged stamp (Table 2)', () => {
  it('nothing stands (no registry at all): proceeds silently, and the update completes', () => {
    const home = movingBox('ccrc-capfloor-a-none-', undefined);
    expect(existsSync(join(home, '.cc-sessions'))).toBe(false);
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout + r.stderr).not.toContain('pool-set');
  });

  it('update --check names the words a standing fact needs on its check line, before state= (F6): none, pool-set, unmeasured', () => {
    const home = movingBox('ccrc-capfloor-check-', ['ws-add']);
    const needs = (): string => (runUpdate(home, ['--check']).stdout.match(/^check: .* needs=(\S+) projection=\S+ state=\S+$/m) ?? [])[1] ?? '<no line>';
    expect(needs()).toBe('none');
    plantSet(home);
    expect(needs()).toBe('pool-set');
    const reg = join(home, '.cc-sessions');
    chmodSync(reg, 0o300);
    try { expect(needs()).toBe('unmeasured'); } finally { chmodSync(reg, 0o700); }
  });

  it('a set standing for an id that starts with a dot is read too (F10)', () => {
    const home = movingBox('ccrc-capfloor-a-dot-', ['ws-add']);
    plantSet(home, '.lane-b-overlord');
    const before = snapshot(home);
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain(`${REMEDY}: ${LACKS}; a poolset stands for .lane-b-overlord. ${NOTHING}`);
    expect(snapshot(home)).toEqual(before);
  });

  it('a registry with no poolset entry: proceeds even though the target has no ccdCaps', () => {
    const home = movingBox('ccrc-capfloor-a-empty-', undefined);
    mkdirSync(join(home, '.cc-sessions'), { recursive: true });
    writeFileSync(join(home, '.cc-sessions', 'lane-b-overlord.hold'), 'x\n');
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
  });

  it('a set stands and the target holds pool-set: proceeds', () => {
    const home = movingBox('ccrc-capfloor-a-holds-', ['ws-add', 'pool-set']);
    plantSet(home);
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout + r.stderr).not.toContain('WARN: clear the set');
  });

  it.each([
    ['absent', undefined, ABSENT],
    ['malformed (a string)', 'x', MALFORMED],
    ['malformed (a token outside the grammar)', ['Pool Set'], MALFORMED],
    ['a list without the word', ['ws-add'], LACKS],
    ['the empty list', [], LACKS],
  ] as const)('a set stands and the target ccdCaps is %s: refused at exit 1, the remedy first, nothing changed', (_n, caps, why) => {
    const home = movingBox('ccrc-capfloor-a-refuse-', caps);
    plantSet(home);
    const before = snapshot(home);
    const r = runUpdate(home);
    expectRefused(home, before, r, why);
    expect(r.stderr.indexOf(REMEDY), 'the remedy leads the sentence').toBeLessThan(r.stderr.indexOf(why));
    // The refusal lands inside the reporting window: a console tap gets its failed row, and nothing was backed up.
    expect(lastReport(home)['phase']).toBe('failed');
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv')), 'the staged spine ran').toBe(false);
  });

  it('a registry that exists but cannot be listed (no read bit): refused with the "make ~/.cc-sessions listable" sentence', () => {
    const home = movingBox('ccrc-capfloor-a-unlistable-', ['pool-set']);
    plantSet(home);
    const reg = join(home, '.cc-sessions');
    const before = snapshot(home);
    chmodSync(reg, 0o300);
    try {
      const r = runUpdate(home);
      expect(r.code, `stderr: ${r.stderr}`).toBe(1);
      expect(r.stderr).toContain(`${UNLISTABLE}: it could not be listed, so nobody knows whether a fact stands that needs a capability. ${NOTHING}`);
      expect(snapshot(home)).toEqual(before);
    } finally { chmodSync(reg, 0o755); }
  });

  it('a DANGLING symlink at <id>.poolset counts as standing', () => {
    const home = movingBox('ccrc-capfloor-a-dangling-', ['ws-add']);
    const reg = join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    symlinkSync(join(home, 'nowhere-at-all'), join(reg, 'lane-b-overlord.poolset'));
    const before = snapshot(home);
    const r = runUpdate(home);
    expectRefused(home, before, r, LACKS);
  });

  it('a directory and a FIFO at <id>.poolset count as standing too', () => {
    for (const kind of ['dir', 'fifo'] as const) {
      const home = movingBox(`ccrc-capfloor-a-${kind}-`, ['ws-add']);
      const reg = join(home, '.cc-sessions');
      mkdirSync(reg, { recursive: true });
      const p = join(reg, 'lane-b-overlord.poolset');
      if (kind === 'dir') mkdirSync(p); else expect(spawnSync('mkfifo', [p]).status).toBe(0);
      const before = snapshot(home);
      expectRefused(home, before, runUpdate(home), LACKS);
    }
  });

  it('--force alone never passes the refusal', () => {
    const home = movingBox('ccrc-capfloor-a-force-', ['ws-add']);
    plantSet(home);
    const before = snapshot(home);
    const r = runUpdate(home, ['--force']);
    expectRefused(home, before, r, LACKS);
  });

  it('the refusal names every id that stands, in one sentence', () => {
    const home = movingBox('ccrc-capfloor-a-ids-', ['ws-add']);
    plantSet(home, 'lane-a-overlord');
    plantSet(home, 'lane-b-overlord');
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/a poolset stands for (lane-b-overlord lane-a-overlord|lane-a-overlord lane-b-overlord)\. Nothing on this box was changed/);
  });

  // A typed `--from restore` is refused by the lock-holder contract (only arm 2's child, under its parent's lock, may say
  // it), so the arm-2 child's own check is called directly on a staged stamp that lacks the word.
  it('--from restore (the arm-2 child\'s check, called directly) warns on stdout and returns 0', () => {
    const home = freshUpdateBox('ccrc-capfloor-a-restore-');
    plantSet(home);
    const stamp = join(home, 'staged-build.json');
    writeFileSync(stamp, shippedStamp('v2.0.0', 'c'.repeat(40)));
    setCaps(stamp, ['ws-add']);
    const r = sourcedCcrc(home, `rc=0; _upd_cap_floor_check "${stamp}" restore || rc=$?; echo "rc=$rc"`);
    expect(r.stdout).toContain(`update: WARN: ${REMEDY}: ${LACKS}; a poolset stands for lane-b-overlord${WARN_TAIL('restore')}`);
    expect(r.stdout).toContain('rc=0');
  });
});

describe('capability floor, call site (b): a rollback by flip reads the kept tree\'s stamp copy', () => {
  /** A W6 server box on v2.0.0 with v1.0.0 kept (its spine the recorder), the kept stamp copy's ccdCaps as given. */
  function flipBox(prefix: string, caps: unknown): { home: string; kept: string } {
    const home = freshUpdateBox(prefix);
    plantW6Box(home, 'v2.0.0', V2_SHA, 'server');
    const kept = keptVersion(home, 'v1.0.0', V1_SHA);
    writeFileSync(join(home, '.ccrc', 'previous'), `v1.0.0\n${V1_SHA}\n`);
    setCaps(join(kept, '.ccrc-stamp.json'), caps);
    keepDigest(kept, home);
    return { home, kept };
  }

  it('a set stands and the kept stamp copy lacks the word: refused, nothing flipped, nothing changed', () => {
    const { home } = flipBox('ccrc-capfloor-b-lacks-', ['ws-add']);
    plantSet(home);
    const before = snapshot(home);
    const r = rollbackRun(home);
    expectRefused(home, before, r, LACKS);
    expect(existsSync(join(home, 'kept-spine-argv')), 'the kept spine ran').toBe(false);
  });

  it('a set stands and the kept stamp copy has no ccdCaps at all: refused with the absent sentence', () => {
    const { home } = flipBox('ccrc-capfloor-b-absent-', undefined);
    plantSet(home);
    const before = snapshot(home);
    expectRefused(home, before, rollbackRun(home), ABSENT);
  });

  it('a set stands and the kept stamp copy holds the word: the flip proceeds', () => {
    const { home, kept } = flipBox('ccrc-capfloor-b-holds-', ['pool-set']);
    plantSet(home);
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(linkOf(home)).toBe(kept);
  });

  it('nothing stands: the flip proceeds although the kept stamp lacks the word', () => {
    const { home, kept } = flipBox('ccrc-capfloor-b-none-', undefined);
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(linkOf(home)).toBe(kept);
  });

  it('a hand-typed --from watchdog (no caller pid, or the wrong one), --from watchdog --detach and --from restore are refused before anything changes (F1)', () => {
    const { home, kept } = flipBox('ccrc-capfloor-b-typed-', ['ws-add']);
    plantSet(home);
    const link = linkOf(home);
    const report = existsSync(join(home, '.ccrc', 'update.json')) ? fileText(join(home, '.ccrc', 'update.json')) : null;
    const cases: Array<[string[], NodeJS.ProcessEnv]> = [
      [['--from', 'watchdog'], { CCRC_WATCHDOG_CALLER: '' }],
      [['--from', 'watchdog'], { CCRC_WATCHDOG_CALLER: '1' }],
      [['--from', 'watchdog', '--detach'], {}],
      [['--from', 'restore'], {}],
    ];
    for (const [args, env] of cases) {
      const r = rollbackRun(home, args, env);
      const from = args[1]!;
      expect(r.code, `${args.join(' ')}: ${r.stderr}`).toBe(2);
      expect(r.stderr).toContain(`rollback: --from ${from} is the unattended watchdog's own word, refused when typed by hand; nothing on this box was changed`);
      expect(linkOf(home)).toBe(link);
      expect(existsSync(join(home, '.ccrc', 'update.json')) ? fileText(join(home, '.ccrc', 'update.json')) : null).toBe(report);
    }
    expect(linkOf(home)).not.toBe(kept);
  });

  it('--from watchdog warns on stdout and flips', () => {
    const { home, kept } = flipBox('ccrc-capfloor-b-watchdog-', ['ws-add']);
    plantSet(home);
    const r = rollbackRun(home, ['--from', 'watchdog']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toContain(`update: WARN: ${REMEDY}: ${LACKS}; a poolset stands for lane-b-overlord${WARN_TAIL('watchdog')}`);
    expect(linkOf(home)).toBe(kept);
  });

  it('a console run (--from pwa): the refusal closes the report `failed`, and its detail cut to 200 characters with TEN 40-character ids standing still carries the remedy (the `ccd route` clear)', () => {
    const { home } = flipBox('ccrc-capfloor-b-console-', ['ws-add']);
    for (let i = 0; i < 10; i++) plantSet(home, `lane-${String(i).padStart(2, '0')}-${'x'.repeat(40)}`.slice(0, 40));
    const r = rollbackRun(home, ['--to', 'v1.0.0', '--from', 'pwa']);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    const last = lastReport(home);
    expect(last['phase']).toBe('failed');
    const detail = String(last['detail']);
    expect(detail).toContain(WAY_OUT);
    expect(detail.startsWith(`${OVERRIDE}${REMEDY}`)).toBe(true);
    const cut = printableDetail(detail);
    expect(cut.length).toBeLessThanOrEqual(200);
    expect(cut, 'the 200-character cut dropped the override (pool set B2)').toContain('--below-cap pool-set');
    expect(cut, 'the 200-character cut dropped the remedy').toContain(WAY_OUT);
    expect(cut).toContain(LACKS);
  });
});

describe('capability floor, the automatic restore: warns, never refuses', () => {
  const GATE_DENIED = 'gate: GET http://127.0.0.1:7788/health got no answer (curl exited 7)';

  it('arm 1 (END TO END): a gate failure on a box whose previous version is kept, with a set standing and the previous stamp lacking the word, WARNs and still flips back', () => {
    const home = onKeptV1('ccrc-capfloor-arm1-');
    const v1 = join(home, 'ccrc-versions', 'v1.0.0');
    expect(JSON.parse(fileText(join(v1, '.ccrc-stamp.json')))).not.toHaveProperty('ccdCaps');
    // v2.0.0 advertises the word, so call site (a) passes; its server never comes up, so the gate fails and arm 1 runs.
    const tree = fullTree(home, { version: 'v2.0.0', sha: V2_SHA });
    setCaps(join(tree, 'build.json'), ['pool-set']);
    rmSync(join(tree, 'MANIFEST'));
    writeManifest(tree);
    packRelease(home, tree, { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-health-deny'), 'v2.0.0\n');
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    plantSet(home);
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout).toContain('update: arm 1: v1.0.0 is kept at $HOME/ccrc-versions/v1.0.0 — flipping back to it (no download)');
    expect(r.stdout).toContain(`update: WARN: ${REMEDY}: ${ABSENT}; a poolset stands for lane-b-overlord${WARN_TAIL('restore')}`);
    expect(r.stdout).toContain(`update: REVERTED (arm 1): this box runs v1.0.0 again`);
    expect(r.stdout).toContain(GATE_DENIED);
    expect(linkOf(home)).toBe(v1);
  }, scaled(90_000));

  it('arm 3 (END TO END): a gate failure whose arm 2 refuses (no bundle), with a set standing, falls to arm 3, which WARNs and still copies the tree back (F3)', () => {
    const home = freshUpdateBox('ccrc-capfloor-arm3-e2e-');
    plantRestoreBox(home, {
      prevBundle: false,
      onInstall: ['printf \'newsha0000000000000000000000000000000000\\nunsigned\\n\' > "$HOME/.ccrc/installed"'],
    });
    publishStub(home, ['pool-set']);   // v2.0.0 advertises the word, so call site (a) passes and the install runs
    plantSet(home);
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout).toMatch(/^update: arm2-refused: /m);
    expect(r.stdout).toContain(`update: WARN: ${REMEDY}: the restored build's capabilities could not be read; a poolset stands for lane-b-overlord${WARN_TAIL('restore')}`);
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 3\): /m);
    expect(lastReport(home)['phase']).toBe('reverted');
  }, scaled(90_000));

  it('arm 3 (called directly, no stamp): `_upd_cap_floor_check - restore` WARNs "the restored build\'s capabilities could not be read" and returns 0', () => {
    const home = freshUpdateBox('ccrc-capfloor-arm3-');
    plantSet(home);
    const r = sourcedCcrc(home, 'rc=0; _upd_cap_floor_check - restore || rc=$?; echo "rc=$rc"');
    expect(r.stdout).toContain(`update: WARN: ${REMEDY}: the restored build's capabilities could not be read; a poolset stands for lane-b-overlord${WARN_TAIL('restore')}`);
    expect(r.stdout).toContain('rc=0');
  });

  it('arm 3 with nothing standing is silent', () => {
    const home = freshUpdateBox('ccrc-capfloor-arm3-none-');
    const r = sourcedCcrc(home, 'rc=0; _upd_cap_floor_check - restore || rc=$?; echo "rc=$rc"');
    expect(r.stdout.trim()).toBe('rc=0');
  });

  it('an unreadable stamp (rc N): the sentence names the rc, and a refusal for a hand-typed run', () => {
    const home = freshUpdateBox('ccrc-capfloor-rc-');
    plantSet(home);
    const r = sourcedCcrc(home, `_upd_cap_floor_check "${home}/no-such-stamp" cli`);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`${REMEDY}: the target's stamp could not be read (rc 3); a poolset stands for lane-b-overlord. ${NOTHING}`);
  });
});

describe('capability floor, THE TABLE: a data row added to CAP_FLOOR_ROWS is read by the same check, no code changed', () => {
  const ROW = "  'poolset|pool-set|the operator clears the set from their own shell, never a session: ccd route --session <id> --set poolset= --set acctorder='\n";
  const EXTRA = "  'profiledigest|launch-surface-v1|retire the launch profile in Settings'\n";

  /** A fixture home with a PATCHED COPY of ccd/ccrc (one more row, nothing else), and a stamp file with `caps`. */
  function patched(home: string, caps: string[]): { script: string; stamp: string } {
    const src = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    expect(src, 'the row line moved: the patch has nothing to anchor on').toContain(ROW);
    const script = join(home, 'ccrc-patched');
    writeFileSync(script, src.replace(ROW, ROW + EXTRA));
    const stamp = join(home, 'target-build.json');
    writeFileSync(stamp, shippedStamp('v2.0.0', 'c'.repeat(40)));
    setCaps(stamp, caps);
    return { script, stamp };
  }
  const check = (home: string, script: string, stamp: string, from = 'cli'): { code: number; stdout: string; stderr: string } => {
    const r = spawnSync(BASH, ['-c', '. "$1"; _upd_cap_floor_check "$2" "$3"', 'ccrc-under-test', script, stamp, from],
      { env: updateEnv(home), encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  const plantEntry = (home: string, name: string): void => {
    mkdirSync(join(home, '.cc-sessions'), { recursive: true });
    writeFileSync(join(home, '.cc-sessions', name), 'x\n');
  };

  it('a <id>.profiledigest entry stands, the target holds pool-set but not launch-surface-v1: refused, naming the word and the new remedy', () => {
    const home = freshUpdateBox('ccrc-capfloor-table-refuse-');
    const { script, stamp } = patched(home, ['pool-set']);
    plantEntry(home, 'lane-a-overlord.profiledigest');
    const r = check(home, script, stamp);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('retire the launch profile in Settings: the target build lacks launch-surface-v1; a profiledigest stands for lane-a-overlord');
    expect(r.stderr).not.toContain('lacks pool-set');
    expect(r.stderr).toContain(NOTHING);
  });

  it('both facts stand and the target lacks both words: one refusal names both rows', () => {
    const home = freshUpdateBox('ccrc-capfloor-table-both-');
    const { script, stamp } = patched(home, ['ws-add']);
    plantEntry(home, 'lane-a-overlord.profiledigest');
    plantSet(home);
    const r = check(home, script, stamp);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`${REMEDY}: ${LACKS}; a poolset stands for lane-b-overlord`);
    expect(r.stderr).toContain('retire the launch profile in Settings: the target build lacks launch-surface-v1; a profiledigest stands for lane-a-overlord');
  });

  it('the target holds both words: proceeds silently', () => {
    const home = freshUpdateBox('ccrc-capfloor-table-pass-');
    const { script, stamp } = patched(home, ['pool-set', 'launch-surface-v1']);
    plantEntry(home, 'lane-a-overlord.profiledigest');
    plantSet(home);
    const r = check(home, script, stamp);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toBe('');
  });

  it('the shipped ccd/ccrc, unpatched, ignores a profiledigest entry (the row is the only difference)', () => {
    const home = freshUpdateBox('ccrc-capfloor-table-shipped-');
    const { stamp } = patched(home, ['pool-set']);
    plantEntry(home, 'lane-a-overlord.profiledigest');
    const r = check(home, join(REPO, 'ccd', 'ccrc'), stamp);
    expect(r.code, r.stderr).toBe(0);
  });

  it('control: the patched copy is byte-identical to the shipped file but for the one row', () => {
    const home = freshUpdateBox('ccrc-capfloor-table-diff-');
    const { script } = patched(home, []);
    const a = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    expect(readFileSync(script, 'utf8')).toBe(a.replace(ROW, ROW + EXTRA));
    copyFileSync(script, join(home, 'unused'));
  });
});

describe('the override, --below-cap <word> (pool set B2, Task 9): passes its row alone, with a WARN, and reaches every re-exec', () => {
  it('update --below-cap pool-set passes the "lacks" refusal with the WARN, and the update completes', () => {
    const home = movingBox('ccrc-capfloor-bc-lacks-', ['ws-add']);
    plantSet(home);
    const r = runUpdate(home, ['--below-cap', 'pool-set']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toContain(PASSED(LACKS));
    expect(existsSync(join(home, 'staged-ccrc-argv')), 'the staged spine never ran').toBe(true);
  });

  it('it passes every other refusal of Table 2 too: absent, malformed, an unreadable stamp, an unlistable registry', () => {
    const home = freshUpdateBox('ccrc-capfloor-bc-rows-');
    plantSet(home);
    const stamp = join(home, 'staged-build.json');
    writeFileSync(stamp, shippedStamp('v2.0.0', 'c'.repeat(40)));
    for (const [caps, why] of [[undefined, ABSENT], ['pool-set', MALFORMED]] as const) {
      setCaps(stamp, caps);
      const r = sourcedCcrc(home, `rc=0; _upd_cap_floor_check "${stamp}" cli pool-set || rc=$?; echo "rc=$rc"`);
      expect(r.stdout, String(caps)).toContain(PASSED(why));
      expect(r.stdout, String(caps)).toContain('rc=0');
    }
    const gone = sourcedCcrc(home, `rc=0; _upd_cap_floor_check "${home}/no-such-stamp" cli pool-set || rc=$?; echo "rc=$rc"`);
    expect(gone.stdout).toContain(PASSED("the target's stamp could not be read (rc 3)"));
    expect(gone.stdout).toContain('rc=0');
    const reg = join(home, '.cc-sessions');
    chmodSync(reg, 0o300);
    try {
      // An unlistable registry passes only when the flag names every row's word, whatever the table holds.
      const r = sourcedCcrc(home, `rc=0; _upd_cap_floor_check "${stamp}" cli "$(_cap_floor_words)" || rc=$?; echo "rc=$rc"`);
      expect(r.stdout).toContain('update: WARN: --below-cap passed the capability floor for an unlistable ~/.cc-sessions');
      expect(r.stdout).toContain('rc=0');
      const refused = sourcedCcrc(home, `_upd_cap_floor_check "${stamp}" cli`);
      expect(refused.code).toBe(1);
      expect(refused.stderr).toMatch(/pass --below-cap pool-set(,[a-z0-9-]+)*, or make ~\/\.cc-sessions listable/);
      const one = sourcedCcrc(home, `rc=0; _upd_cap_floor_check "${stamp}" cli "$(_cap_floor_words),pool-set" || rc=$?; echo "rc=$rc"`);
      expect(one.stdout).toContain('rc=0');
    } finally { chmodSync(reg, 0o700); }
  });

  it('a word outside the table, a capital, an empty value or no value is a usage error (exit 2), and nothing changes', () => {
    const home = movingBox('ccrc-capfloor-bc-usage-', ['ws-add']);
    plantSet(home);
    const before = snapshot(home);
    for (const args of [['--below-cap', 'something-else'], ['--below-cap', 'Pool-Set'], ['--below-cap', ''], ['--below-cap', 'pool-set,'], ['--below-cap']]) {
      const r = runUpdate(home, args);
      expect(r.code, args.join(' ')).toBe(2);
      expect(r.stderr, args.join(' ')).toContain('--below-cap names capability floor words, comma-joined: pool-set');
      expect(r.stderr, args.join(' ')).toContain(' (got: ');
      expect(snapshot(home)).toEqual(before);
    }
    const rb = rollbackRun(home, ['--to', 'v1.0.0', '--below-cap', 'something-else']);
    expect(rb.code).toBe(2);
    expect(rb.stderr).toContain('--below-cap names capability floor words');
  });

  it('--force alone still refuses, and --check beside --below-cap is refused at exit 2 (the D-3139 shape)', () => {
    const home = movingBox('ccrc-capfloor-bc-force-', ['ws-add']);
    plantSet(home);
    const before = snapshot(home);
    expectRefused(home, before, runUpdate(home, ['--force']), LACKS);
    const c = runUpdate(home, ['--check', '--below-cap', 'pool-set']);
    expect(c.code).toBe(2);
    expect(c.stderr).toContain('update: --check and --below-cap are exclusive');
  });

  it('a Claude Code session (CLAUDECODE set) is refused the flag on update and rollback: exit 2, the operator\'s flag, nothing changed (fix round 1, F1)', () => {
    const home = movingBox('ccrc-capfloor-bc-session-', ['ws-add']);
    plantSet(home);
    const before = snapshot(home);
    for (const r of [runUpdate(home, ['--below-cap', 'pool-set'], { CLAUDECODE: '1' }),
      rollbackRun(home, ['--to', 'v1.0.0', '--below-cap', 'pool-set'], { CLAUDECODE: '1' })]) {
      expect(r.code, r.stderr).toBe(2);
      expect(r.stderr).toContain("--below-cap is the operator's flag, typed in their own shell: a Claude Code session never passes the capability floor; nothing was changed");
      expect(snapshot(home)).toEqual(before);
    }
    expect(runUpdate(home, [], { CLAUDECODE: '1' }).stderr, 'without the flag a session meets the floor itself').toContain(`${OVERRIDE}${REMEDY}`);
  });

  itLinux('a detached update carries the flag, last in the fixed order, to its child (forwarding 1)', () => {
    const home = movingBox('ccrc-capfloor-bc-detach-', ['ws-add']);
    plantSet(home);
    const r = runUpdate(home, ['--below-cap', 'pool-set', '--detach', '--to', 'v2.0.0', '--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(fileText(join(home, 'systemd-run-argv')).trim()).toBe(
      '--user --collect --quiet /bin/sh -c PATH="$HOME/.local/bin:$PATH" exec "$HOME/.local/bin/ccrc" "$@" '
      + 'ccrc-detach update --to v2.0.0 --from cli --force --below-cap pool-set');
  });
});

describe('the override on the rollback verb: its kept branch, its detach and its fall-through (pool set B2, Task 9)', () => {
  function flipBox(prefix: string, caps: unknown): { home: string; kept: string } {
    const home = freshUpdateBox(prefix);
    plantW6Box(home, 'v2.0.0', V2_SHA, 'server');
    const kept = keptVersion(home, 'v1.0.0', V1_SHA);
    writeFileSync(join(home, '.ccrc', 'previous'), `v1.0.0\n${V1_SHA}\n`);
    setCaps(join(kept, '.ccrc-stamp.json'), caps);
    keepDigest(kept, home);
    return { home, kept };
  }

  it('a kept tree that lacks the word: --below-cap pool-set flips with the WARN', () => {
    const { home, kept } = flipBox('ccrc-capfloor-bc-flip-', ['ws-add']);
    plantSet(home);
    const r = rollbackRun(home, ['--below-cap', 'pool-set']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toContain(PASSED(LACKS));
    expect(linkOf(home)).toBe(kept);
  });

  itLinux('a detached rollback carries the flag to its child (forwarding 2)', () => {
    const { home } = flipBox('ccrc-capfloor-bc-rbdetach-', ['ws-add']);
    plantSet(home);
    const r = rollbackRun(home, ['--to', 'v1.0.0', '--detach', '--from', 'pwa', '--below-cap', 'pool-set']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(fileText(join(home, 'systemd-run-argv')).trim()).toBe(
      '--user --collect --quiet /bin/sh -c PATH="$HOME/.local/bin:$PATH" exec "$HOME/.local/bin/ccrc" "$@" '
      + 'ccrc-detach rollback --to v1.0.0 --from pwa --below-cap pool-set');
  });

  it('a rollback to a version not kept falls through to the update, which refuses below the word; the flag rides the fall-through and passes (forwarding 3)', () => {
    const mk = (prefix: string): string => {
      const { home } = flipBox(prefix, ['pool-set']);
      const tree = stubTree(home, { version: 'v1.5.0' });
      setCaps(join(tree, 'build.json'), ['ws-add']);
      rmSync(join(tree, 'MANIFEST'));
      writeManifest(tree);
      packRelease(home, tree, { tag: 'v1.5.0', latest: false });
      plantSet(home);
      return home;
    };
    const refused = mk('ccrc-capfloor-bc-fall-no-');
    const r0 = rollbackRun(refused, ['--to', 'v1.5.0']);
    expect(r0.code, `stderr: ${r0.stderr}\nstdout: ${r0.stdout}`).toBe(1);
    expect(r0.stderr).toContain(`${OVERRIDE}${REMEDY}: ${LACKS}`);
    expect(existsSync(join(refused, 'staged-ccrc-argv'))).toBe(false);
    const passed = mk('ccrc-capfloor-bc-fall-yes-');
    const r1 = rollbackRun(passed, ['--to', 'v1.5.0', '--below-cap', 'pool-set']);
    expect(r1.stdout + r1.stderr).toContain(PASSED(LACKS));
    expect(existsSync(join(passed, 'staged-ccrc-argv')), `the fall-through refused: ${r1.stderr}`).toBe(true);
  });
});

describe('the override and THE TABLE: --below-cap names any row\'s word, and overrides only the row it names (pool set B2)', () => {
  const ROW = "  'poolset|pool-set|the operator clears the set from their own shell, never a session: ccd route --session <id> --set poolset= --set acctorder='\n";
  // A fictional row, so a row a later piece ships never collides with it.
  const EXTRA = "  'tablefact|table-word-v1|the remedy of a row this test adds'\n";
  function patched(home: string, caps: string[]): { script: string; stamp: string } {
    const src = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    expect(src, 'the row line moved: the patch has nothing to anchor on').toContain(ROW);
    const script = join(home, 'ccrc-patched');
    writeFileSync(script, src.replace(ROW, ROW + EXTRA));
    const stamp = join(home, 'target-build.json');
    writeFileSync(stamp, shippedStamp('v2.0.0', 'c'.repeat(40)));
    setCaps(stamp, caps);
    return { script, stamp };
  }
  const sh = (home: string, script: string, body: string): { code: number; stdout: string; stderr: string } => {
    const r = spawnSync(BASH, ['-c', `. "$1"; ${body}`, 'ccrc-under-test', script], { env: updateEnv(home), encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  const both = (prefix: string): { home: string; script: string; stamp: string } => {
    const home = freshUpdateBox(prefix);
    const p = patched(home, ['ws-add']);
    mkdirSync(join(home, '.cc-sessions'), { recursive: true });
    writeFileSync(join(home, '.cc-sessions', 'lane-a-overlord.tablefact'), 'x\n');
    plantSet(home);
    return { home, ...p };
  };

  it('both facts stand and the target lacks both words: --below-cap pool-set passes that row and still refuses the other, naming its override and remedy', () => {
    const { home, script, stamp } = both('ccrc-capfloor-bc-table-one-');
    const r = sh(home, script, `_upd_cap_floor_check "${stamp}" cli pool-set`);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(PASSED(LACKS));
    expect(r.stderr).toContain('pass --below-cap table-word-v1, or the remedy of a row this test adds: the target build lacks table-word-v1; a tablefact stands for lane-a-overlord');
    expect(r.stderr).not.toContain('lacks pool-set');
  });

  it('naming both words passes both, each with its WARN; with no flag one refusal names both words at its front', () => {
    const { home, script, stamp } = both('ccrc-capfloor-bc-table-both-');
    const r = sh(home, script, `rc=0; _upd_cap_floor_check "${stamp}" cli pool-set,table-word-v1 || rc=$?; echo "rc=$rc"`);
    expect(r.stdout).toContain('rc=0');
    expect(r.stdout).toContain('--below-cap passed the capability floor for pool-set (the target build lacks pool-set; a poolset stands for lane-b-overlord); table-word-v1 (');
    const none = sh(home, script, `_upd_cap_floor_check "${stamp}" cli`);
    expect(none.code).toBe(1);
    expect(none.stderr).toContain('pass --below-cap pool-set,table-word-v1, or ');
  });

  it('the argument check reads the table: table-word-v1 is a word in the patched copy and a usage error in the shipped file', () => {
    const { home, script } = both('ccrc-capfloor-bc-table-arg-');
    expect(sh(home, script, '_below_cap_arg 2 table-word-v1 && echo ok').stdout.trim()).toBe('ok');
    expect(sh(home, script, '_below_cap_arg 2 pool-set,table-word-v1 && echo ok').stdout.trim()).toBe('ok');
    const shipped = sh(home, join(REPO, 'ccd', 'ccrc'), '_below_cap_arg 2 table-word-v1 && echo ok');
    expect(shipped.code).toBe(2);
    expect(shipped.stdout).not.toContain('ok');
  });
});
