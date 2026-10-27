// Part of the `ccrc update` suite, split by describe block from the former single file (D-6767).
// The shared box, tarball and runner fixtures live in `ccrc-updateFixture.ts`; this file holds only
// the cases of its own describe blocks, with their titles and bodies unchanged. Its siblings are
// `ccrc-update-*.test.ts`.

import { describe, it, expect, afterEach } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { killGroup } from './spawnGroup.js';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync, lstatSync, chmodSync, readdirSync, appendFileSync, rmSync, symlinkSync, openSync, closeSync, constants as fsConstants } from 'node:fs';
import path, { join, dirname } from 'node:path';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { assertNoRealTool, CONTAINED_TOOLS } from './containedTools.js';
import { itLinux } from './platformFixtures.js';
import { installVersionedTree, keepDigest } from './installTreeFixture.js';
import { UPDATE_DEADLINE_HARD_CAP_FACTOR } from '../src/update/dispatch.js';
import { emptyDelegationCheckpoint } from '../src/coord/delegation-model.js';
import { encodeDelegationCheckpoint } from '../src/coord/delegation-checkpoint.js';
import { buildDelegationJournalRecord, encodeDelegationJournalRecord } from '../src/coord/delegation-journal.js';
import { SPINE_CONTAINMENT_PROBE, spineRunCalls, codexRoster, externalCodexRow, plantExternalLauncher, plantForeignUsage, stateCallsNaming } from './codexLaneFixture.js';
import {
  REPO,
  BASH,
  FLOCK,
  type Result,
  updateEnv,
  replantDoctorStubs,
  plantOldBox,
  plantCoordDb,
  writeManifest,
  shippedStamp,
  fullTree,
  stubTree,
  packRelease,
  runUpdate,
  freshUpdateBox,
  plantKillModeDropIn,
  UNIT_LINES,
  treeDigest,
  localUrls,
  announcedBackupDir,
  sourcedCcrc,
  OLD_SHA,
  plantRestoreBox,
  reportWrites,
  lastReport,
  REAL_DATE,
  V1_SHA,
  V2_SHA,
  CCD_SENTINEL,
  KEPT_SPINE,
  fileText,
  linkOf,
  plantW6Box,
  keptVersion,
  rollbackRun,
  onKeptV1,
  verKeptAnswer,
} from './ccrc-updateFixture.js';

// ── F1 (review 179, fix round 1 item 1; D-3466): the killed-flip state ───────
// A `--from cli|pwa` update from a completed, tagged install, killed between
// `_inst_tree`'s flip and `_inst_stamp`, leaves `~/ccrc` on the NEW version,
// the stamp on the OLD build, `previous` naming that old build, and no
// `~/.ccrc/installed` (`cmd_update` removed it before the staged spine). C27
// refused the watchdog's bare `rollback --from watchdog` there, and the
// watchdog never retries. The rule (six conditions, measured by ONE function,
// `_rollback_killed_flip_state`): C27 admits that state, and whenever
// conditions (1) to (3) hold the rollback may only FLIP — re-measured under
// the lock, whatever `--to` or `--from` says, detached child included.
describe('the killed-flip state: C27 admits the one rollback a killed update needs, and only by flip (review 179 F1, D-3466)', () => {
  /** A kept version's own `ccd/ccrc` that DECLARES its versions root — the probe
   *  `cmd_update` reads (`^BOX_VERSIONS_ROOT=`) to tell a W6 spine from an older one.
   *  The sh stub exits before it reaches the line; only its text matters. */
  const KEPT_SPINE_W6 = `${KEPT_SPINE}# a W6 ccrc declares its versions root; cmd_update's own probe reads this line\nBOX_VERSIONS_ROOT="$HOME/ccrc-versions"\n`;
  const SENTENCE = /^ccrc: rollback: ~\/\.ccrc\/previous names v1\.0\.0, but it cannot be trusted here — \$HOME\/ccrc points at \$HOME\/ccrc-versions\/v2\.0\.0 while this box's stamp reads v1\.0\.0, so the last move was made by something that does not keep the layout /m;
  const phasesOf = (home: string): string[] => reportWrites(home).map((w) => String(w['phase']));

  /** The state a killed update leaves, planted from measured facts: v1.0.0 kept
   *  complete beside `~/ccrc -> v2.0.0` (the flip that happened), the box stamp
   *  byte-equal to v1.0.0's kept stamp (never restamped), `previous` naming
   *  v1.0.0, floor at v2.0.0, and NO completed-install record. */
  function killedFlipBox(prefix: string, o: { oldSpine?: string } = {}): { home: string; v1: string; v2: string } {
    const home = freshUpdateBox(prefix);
    const v1 = installVersionedTree(home, 'v1.0.0', { link: false, stamp: { sha: V1_SHA, version: 'v1.0.0' } });
    writeFileSync(join(v1, 'ccd', 'ccrc'), o.oldSpine ?? KEPT_SPINE_W6, { mode: 0o755 });
    keepDigest(v1, home);   // the spine is part of the kept bytes (D-3465)
    const v2 = installVersionedTree(home, 'v2.0.0', { link: true, stamp: { sha: V2_SHA, version: 'v2.0.0' } });
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    copyFileSync(join(v1, '.ccrc-stamp.json'), join(home, '.ccrc', 'build.json'));
    writeFileSync(join(home, '.ccrc', 'floor'), 'v2.0.0\n');
    writeFileSync(join(home, '.ccrc', 'previous'), `v1.0.0\n${V1_SHA}\n`);
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=server\nCCRC_HOST=127.0.0.1\nCCRC_PORT=7788\n');
    return { home, v1, v2 };
  }
  /** A published v1.0.0 the run COULD download — so "no re-install ran" below
   *  measures the run's restraint, not an empty URL space. */
  const publishV1 = (home: string): void => {
    packRelease(home, fullTree(home, { version: 'v1.0.0', sha: V1_SHA }), { tag: 'v1.0.0', latest: false });
  };
  /** No re-install ran: no rsync, no npm, nothing downloaded past the
   *  existence question (`SHA256SUMS`), no staged spine, no kept spine, and the
   *  link where it was. */
  const expectNoReinstall = (home: string, link: string): void => {
    expect(existsSync(join(home, 'rsync-argv')), 'rsync ran — a re-install into a tree the units run').toBe(false);
    expect(existsSync(join(home, 'npm-argv')), 'npm ran — a re-install into a tree the units run').toBe(false);
    expect(localUrls(home).filter((u) => !u.endsWith('/SHA256SUMS')), 'a release was downloaded').toEqual([]);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
    expect(existsSync(join(home, 'kept-spine-argv')), "the kept version's spine ran").toBe(false);
    expect(linkOf(home)).toBe(link);
  };
  /** The reason line's tail, by `_kf_remedy` (wave 9 R9-F1, D-3827, round-2 ruling R-D). It re-measures when it prints:
   *  the hand install, only where the role is known and the version is kept complete, its own `ccd/ccrc` versioned and
   *  (on a fleet box) its agent deps present; otherwise NO command and no recipe. */
  const handInstall = (role: string): string =>
    `re-installing v1.0.0 is a typed act, not a rollback's: bash ~/ccrc-versions/v1.0.0/ccd/ccrc install --role ${role} (it installs from that version's own kept directory: no download, no tree copy, no npm ci)`;
  const NO_COMMAND = 'no safe one-line repair is known for this state, so this line names no command — nothing on this box was changed';
  /** Refused with C27's sentence, nothing moved. `tail` is what the reason line ends in. */
  const expectRefused = (home: string, r: Result, link: string, reason?: string, tail: string = NO_COMMAND): void => {
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toMatch(SENTENCE);
    // The reason line, when conditions (1) to (3) held and (4)-(6) did not; none otherwise.
    if (reason === undefined) expect(r.stderr).not.toContain('the killed-flip state does not hold');
    else {
      expect(r.stderr).toContain(`rollback: the killed-flip state does not hold — ${reason}`);
      // R-B1 (as reshaped by wave 9 R9-F1): the sentence's own remedy (`--to vX.Y.Z`) meets this refusal again, so
      // the line's tail says what the box can safely do instead — a typed hand install where it was measured safe
      // just now, otherwise that no safe one-line repair is known. Never the in-place `update --to … --downgrade`.
      expect(r.stderr).toContain(`${reason} — ${tail}\n`);
      if (tail === NO_COMMAND) {
        expect(tail, 'the no-command tail names a recipe').not.toMatch(/README|bash ~\/ccrc-versions/);
        expect(r.stderr, 'a no-command refusal named a recipe').not.toContain('README');
        expect(r.stderr, 'a no-command refusal named a command').not.toContain('bash ~/ccrc-versions');
      } else {
        expect(r.stderr, 'the hand-install refusal named a recipe').not.toContain('README');
      }
    }
    expect(r.stderr, 'the in-place re-install is never advised (R9-F1)').not.toContain('ccrc update --to');
    expect(r.stderr).toContain('Nothing on this box was changed — name the target: ccrc rollback --to vX.Y.Z');
    expectNoReinstall(home, link);
    expect(existsSync(join(home, '.ccrc', 'installed')) ? fileText(join(home, '.ccrc', 'installed')) : null,
      'a refused rollback wrote the record').toBe(recordBefore.get(home) ?? null);
  };
  const recordBefore = new Map<string, string | null>();
  const note = (home: string): string => {
    recordBefore.set(home, existsSync(join(home, '.ccrc', 'installed')) ? fileText(join(home, '.ccrc', 'installed')) : null);
    return home;
  };
  /** After a successful rollback by flip: link, stamp and record agree on v1.0.0. */
  const expectAgreesOnV1 = (home: string, v1: string): void => {
    expect(linkOf(home)).toBe(v1);
    expect(fileText(join(home, '.ccrc', 'build.json'))).toBe(fileText(join(v1, '.ccrc-stamp.json')));
    expect(fileText(join(home, '.ccrc', 'installed'))).toBe(fileText(join(v1, '.ccrc-installed')));
    expect(JSON.parse(fileText(join(home, '.ccrc', 'build.json')))).toMatchObject({ version: 'v1.0.0', sha: V1_SHA });
    expect(fileText(join(home, '.ccrc', 'previous')), 'a rollback never rewrites previous').toBe(`v1.0.0\n${V1_SHA}\n`);
    expect(fileText(join(home, '.ccrc', 'floor')), 'the floor never lowers').toBe('v2.0.0\n');
  };

  // ── the two positive shapes ───────────────────────────────────────────────
  it('the killed-between-flip-and-stamp shape (planted from the measured leftovers): a bare `rollback --from watchdog` FLIPS back — link, stamp and record then agree on the old build, no release-host question, no download, no re-install', () => {
    const { home, v1 } = killedFlipBox('ccrc-fx-b-killed-flip-');
    writeFileSync(join(home, 'fixture-release-http'), '404\n');   // a run that asks the host is refused at exit 2
    expect(existsSync(join(home, '.ccrc', 'installed')), 'the fixture must be the state: no record').toBe(false);
    const r = rollbackRun(home, ['--from', 'watchdog']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stderr).not.toContain('it cannot be trusted here');
    expect(r.stdout).toContain('rollback: v1.0.0 is kept at $HOME/ccrc-versions/v1.0.0 — no release-host question and no download');
    expect(r.stdout).toContain('rollback: this box runs v1.0.0 again — flipped back to $HOME/ccrc-versions/v1.0.0, no download');
    expect(localUrls(home)).toEqual([]);
    expectAgreesOnV1(home, v1);
    expect(existsSync(join(home, 'kept-spine-argv')), "the kept version's own spine did not run").toBe(true);
    // (the SIGNED arm: `killedFlipBox`'s record is one line) the spine a rollback re-runs never installs node
    // (spec 2026-10-26-node-runtime-under-nvm): even an operator's
    // terminal rollback, which `ccd/ccrc-node` would otherwise let `nvm install` on a TTY
    expect(fileText(join(home, 'kept-spine-nodenoinstall')).trim()).toBe('1');
    expect(existsSync(join(home, 'rsync-argv'))).toBe(false);
    expect(existsSync(join(home, 'npm-argv'))).toBe(false);
    expect(lastReport(home)).toMatchObject({ phase: 'done', detail: 'rolled back by flip to v1.0.0', from: 'watchdog' });
    expect(phasesOf(home)).toEqual(['installing', 'checking', 'restarting', 'restarting', 'done']);
  });

  // `killedFlipBox`'s kept record is the one-line SIGNED form, so the case above exercises `_ver_flip_back`'s signed
  // arm; this one plants the unsigned two-line form for the other. Both arms must hand the spine NODE_NO_INSTALL=1.
  it('the UNSIGNED arm of the flip hands its spine NODE_NO_INSTALL=1 too — no rollback installs node, whichever way the kept version was installed', () => {
    const { home, v1 } = killedFlipBox('ccrc-fx-b-killed-flip-unsigned-');
    writeFileSync(join(v1, '.ccrc-installed'), `${V1_SHA}\nunsigned\n`);
    keepDigest(v1, home);
    const r = rollbackRun(home, ['--from', 'watchdog']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(existsSync(join(home, 'kept-spine-argv')), "the kept version's own spine did not run").toBe(true);
    expect(fileText(join(home, 'kept-spine-nodenoinstall')).trim()).toBe('1');
  });

  it('the same shape produced by a REAL killed update — the staged spine and its updater SIGKILLed at `_inst_stamp`, after `_inst_tree`\'s flip — then the watchdog\'s bare rollback: the state the real code leaves is the state the rule admits', () => {
    const home = onKeptV1('ccrc-fx-b-killed-real-');
    const v1 = join(home, 'ccrc-versions', 'v1.0.0');
    const v2 = join(home, 'ccrc-versions', 'v2.0.0');
    const keptStamp = fileText(join(v1, '.ccrc-stamp.json'));
    const keptRec = fileText(join(v1, '.ccrc-installed'));
    // v2.0.0's own spine, made to die where OOM would kill the run: at the
    // start of `_inst_stamp`. It takes its parent (the updater) with it — a
    // unit's cgroup kill takes both. Only the release copy is patched.
    const tree = fullTree(home, { version: 'v2.0.0', sha: V2_SHA });
    const spine = join(tree, 'ccd', 'ccrc');
    const src = fileText(spine);
    expect(src.match(/^_inst_stamp\(\) \{/gm), 'the fixture patch anchor is gone').toHaveLength(1);
    writeFileSync(spine, src.replace(/^_inst_stamp\(\) \{/m, () => '_inst_stamp() { kill -9 "$PPID" "$$"; '));
    rmSync(join(tree, 'MANIFEST'));
    writeManifest(tree);
    packRelease(home, tree, { tag: 'v2.0.0' });
    const up = runUpdate(home, ['--from', 'cli']);
    expect(up.code, `the update must have been killed — stdout: ${up.stdout}`).not.toBe(0);
    // The leftovers, measured: link on the new version, the stamp still the old build's, no record.
    expect(linkOf(home), 'the flip did not happen before the kill').toBe(v2);
    expect(fileText(join(home, '.ccrc', 'build.json')), 'the stamp moved before the kill').toBe(keptStamp);
    expect(existsSync(join(home, '.ccrc', 'installed')), 'the record survived').toBe(false);
    expect(fileText(join(home, '.ccrc', 'previous')).split('\n')[0]).toBe('v1.0.0');
    for (const f of ['curl-argv', 'update-json-writes', 'systemctl-calls', 'rsync-argv', 'npm-argv']) rmSync(join(home, f), { force: true });
    writeFileSync(join(home, 'fixture-release-http'), '404\n');
    const r = rollbackRun(home, ['--from', 'watchdog']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toContain('rollback: v1.0.0 is kept at $HOME/ccrc-versions/v1.0.0 — no release-host question and no download');
    expect(localUrls(home)).toEqual([]);
    expect(linkOf(home)).toBe(v1);
    expect(fileText(join(home, '.ccrc', 'build.json'))).toBe(keptStamp);
    expect(fileText(join(home, '.ccrc', 'installed'))).toBe(keptRec);
    expect(fileText(join(home, '.ccrc', 'previous')).split('\n')[0]).toBe('v1.0.0');
    expect(fileText(join(home, '.local', 'libexec', 'ccrc', 'ccd')), "v1.0.0's own spine re-placed its ccd body").toContain(CCD_SENTINEL);
  }, 120_000);

  it('the arm-1-then-arm-3 shape, produced by a REAL failed update (arm 1 flips back and its gate fails, ~/ccrc points at the new version again, arm 2 refuses, arm 3 restores no stamp), then a bare rollback typed by hand (`--from cli`): it flips back to the kept previous version', () => {
    const home = onKeptV1('ccrc-fx-b-arm1-arm3-');
    const v1 = join(home, 'ccrc-versions', 'v1.0.0');
    const v2 = join(home, 'ccrc-versions', 'v2.0.0');
    const keptStamp = fileText(join(v1, '.ccrc-stamp.json'));
    const keptRec = fileText(join(v1, '.ccrc-installed'));
    // v1.0.0 is no longer published, so arm 2 refuses and arm 3 runs.
    rmSync(join(home, 'releases', 'download', 'v1.0.0'), { recursive: true, force: true });
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: V2_SHA }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-health-deny'), 'v2.0.0\nv1.0.0\n');
    const up = runUpdate(home);
    expect(up.code, `stderr: ${up.stderr}\nstdout: ${up.stdout}`).toBe(4);
    expect(up.stdout).toMatch(/^update: REVERTED \(arm 3\): /m);
    // The leftovers, measured.
    expect(linkOf(home), 'arm 1 leaves ~/ccrc on the new version').toBe(v2);
    expect(existsSync(join(home, '.ccrc', 'installed')), 'arm 3 removed the record').toBe(false);
    expect(fileText(join(home, '.ccrc', 'build.json')), 'arm 3 restores no stamp: arm 1\'s restore of v1.0.0\'s stays').toBe(keptStamp);
    expect(fileText(join(home, '.ccrc', 'previous')).split('\n')[0]).toBe('v1.0.0');
    // The gate answers for v1.0.0 again, and no release is asked or downloaded.
    rmSync(join(home, 'fixture-health-deny'));
    for (const f of ['curl-argv', 'update-json-writes', 'systemctl-calls', 'rsync-argv', 'npm-argv']) rmSync(join(home, f), { force: true });
    writeFileSync(join(home, 'fixture-release-http'), '404\n');
    const r = rollbackRun(home);   // bare, --from cli (the default)
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stderr).not.toContain('it cannot be trusted here');
    expect(r.stdout).toContain('rollback: v1.0.0 is kept at $HOME/ccrc-versions/v1.0.0 — no release-host question and no download');
    expect(localUrls(home)).toEqual([]);
    expect(linkOf(home)).toBe(v1);
    expect(fileText(join(home, '.ccrc', 'build.json'))).toBe(keptStamp);
    expect(fileText(join(home, '.ccrc', 'installed'))).toBe(keptRec);
  }, 120_000);

  // ── the controls: each refuses with C27's sentence and runs no re-install ─
  it('control (the pre-W4 detour): previous disagrees with the layout and the killed-flip state does NOT hold — refused, and no re-install even with the release published', () => {
    const home = freshUpdateBox('ccrc-fx-b-prew4-');
    plantW6Box(home, 'v1.0.0', V1_SHA, 'server');
    writeFileSync(join(home, '.ccrc', 'build.json'), shippedStamp('v1.1.0', 'c'.repeat(40)));
    writeFileSync(join(home, '.ccrc', 'previous'), `v2.0.0\n${V2_SHA}\n`);
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: V2_SHA }), { tag: 'v2.0.0', latest: false });
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: rollback: ~\/\.ccrc\/previous names v2\.0\.0, but it cannot be trusted here — \$HOME\/ccrc points at \$HOME\/ccrc-versions\/v1\.0\.0 while this box's stamp reads v1\.1\.0, /m);
    expectNoReinstall(home, join(home, 'ccrc-versions', 'v1.0.0'));
    expect(localUrls(home)).toEqual([]);
  });

  it('control (condition 2): a `deploy.sh`-shaped hot-fix — the box stamped at previous\'s tag over the newer version, with ~/.ccrc/installed PRESENT — is refused, bare from cli and from the watchdog', () => {
    const { home, v2 } = killedFlipBox('ccrc-fx-b-deploysh-');
    publishV1(home);
    writeFileSync(join(home, '.ccrc', 'installed'), `${V2_SHA}\n`);   // the record deploy.sh never touched
    note(home);
    for (const from of [['--from', 'cli'], ['--from', 'watchdog']]) {
      expectRefused(home, rollbackRun(home, from), v2);
    }
  });

  it('control (condition 4): the killed-flip state whose target is NOT kept (its kept record is gone) — refused bare, and `--to` it dies under the lock with the same sentence, downloading nothing', () => {
    const { home, v1, v2 } = killedFlipBox('ccrc-fx-b-notkept-');
    rmSync(join(v1, '.ccrc-installed'));
    publishV1(home);
    note(home);
    const why = 'the target is not kept complete (no kept install record)';
    expectRefused(home, rollbackRun(home), v2, why);
    expectRefused(home, rollbackRun(home, ['--to', 'v1.0.0']), v2, why);
    expect(lastReport(home), 'a --to run under the lock closes its report').toMatchObject({ phase: 'failed', from: 'rollback', target: 'v1.0.0' });
  });

  it('under the lock the state\'s OWN re-measurement decides the flip: a target the pre-lock read found not kept but that the locked re-measure finds kept (the world changed between the two — `_ver_kept` answers 2 once, then truthfully) is flipped to, never re-installed', () => {
    const { home, v1 } = killedFlipBox('ccrc-fx-b-race-');
    publishV1(home);
    mkdirSync(join(home, 'tmp'), { recursive: true });
    const env: NodeJS.ProcessEnv = { ...updateEnv(home), TMPDIR: join(home, 'tmp'), CCRC_RELEASE_BASE_URL: `local://${home}/releases`, CCRC_UPDATE_HEALTH_S: '0' };
    delete env['CCRC_UPDATE_LOCK_HELD'];
    replantDoctorStubs(home);
    const script = [
      '. "$1"',
      'eval "$(declare -f _ver_kept | sed "1s/_ver_kept/_real_ver_kept/")"',
      'n=0',
      '_ver_kept() { n=$((n+1)); if [ "$n" -eq 1 ]; then VER_WHY="fixture: not yet"; return 2; fi; _real_ver_kept "$@"; }',
      'cmd_rollback --to v1.0.0 --from pwa',
    ].join('\n');
    const r = spawnSync(BASH, ['-c', script, 'ccrc-under-test', join(REPO, 'ccd', 'ccrc')], { env, encoding: 'utf8' });
    expect(r.status, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(linkOf(home)).toBe(v1);
    expect(existsSync(join(home, 'kept-spine-argv')), "the kept version's own spine ran").toBe(true);
    expect(existsSync(join(home, 'rsync-argv')), 'a re-install ran').toBe(false);
    expect(existsSync(join(home, 'npm-argv')), 'a re-install ran').toBe(false);
    expect(localUrls(home).filter((u) => !u.endsWith('/SHA256SUMS')), 'a release was downloaded').toEqual([]);
  });

  it('control (condition 4 is item 2\'s answer): the killed-flip state whose target was WRITTEN THROUGH since it was kept (deploy.sh\'s rsync through the link, the record untouched) — refused bare, and `--to` it dies under the lock: the record file alone does not make it kept', () => {
    const { home, v1, v2 } = killedFlipBox('ccrc-fx-b-writtenthrough-');
    appendFileSync(join(v1, 'server', 'dist', 'server', 'src', 'index.js'), '// a working tree, rsynced through the link\n');
    expect(verKeptAnswer(home)).toMatch(/^rc=3 why=its tree is no longer the one that was kept/);
    publishV1(home);
    note(home);
    for (const args of [[], ['--to', 'v1.0.0']]) {
      const r = rollbackRun(home, args);
      expectRefused(home, r, v2, "the target was written through since it was kept (its tree is no longer the one that was kept — something wrote through it since (deploy.sh, an older ccrc's spine, or a restore copy))");
    }
  });

  it('control (condition 5): the killed-flip state whose target\'s kept stamp has another sha — refused bare, and `--to` it dies under the lock', () => {
    const { home, v1, v2 } = killedFlipBox('ccrc-fx-b-othersha-');
    writeFileSync(join(v1, '.ccrc-stamp.json'), `${JSON.stringify({ sha: 'e'.repeat(40), ref: 'main', builtAt: '2026-09-23T00:00:00Z', dirty: false, version: 'v1.0.0' })}\n`);
    expect(verKeptAnswer(home), 'the control is broken: the version must still be KEPT, so only (5) refuses').toBe('rc=0 why=');
    publishV1(home);
    note(home);
    const why = "the target's kept stamp is not this box's stamp (another build's sha)";
    // `_kf_remedy` re-measures at print time: this version is still kept complete with a versioned spine, so the
    // hand install is named (role server, from ccrc.env).
    expectRefused(home, rollbackRun(home), v2, why, handInstall('server'));
    expectRefused(home, rollbackRun(home, ['--to', 'v1.0.0']), v2, why, handInstall('server'));
  });

  it('control (conditions 5 and 6 together): a kept pre-W6 target whose kept stamp has another sha — refused with condition 5\'s reason, and the tail names no command (wave 9 R9-F1)', () => {
    // `_rollback_killed_flip_state` returns at (5) before it reads (6), so the reason is (5)'s — but the spine here is
    // pre-W6, and a hand install from it would run its `npm ci` in `~/ccrc`, the tree the units run. An implementation
    // that trusted which condition failed would print the hand install here; `_kf_remedy` measures again.
    const { home, v1, v2 } = killedFlipBox('ccrc-fx-b-othersha-prew6-', { oldSpine: KEPT_SPINE });
    writeFileSync(join(v1, '.ccrc-stamp.json'), `${JSON.stringify({ sha: 'e'.repeat(40), ref: 'main', builtAt: '2026-09-23T00:00:00Z', dirty: false, version: 'v1.0.0' })}\n`);
    expect(verKeptAnswer(home), 'the control is broken: the version must still be KEPT, so only (5) and (6) refuse').toBe('rc=0 why=');
    expect(verKeptAnswer(home, 'v1.0.0', 'server')).toBe('rc=0 why=');
    publishV1(home);
    note(home);
    const why = "the target's kept stamp is not this box's stamp (another build's sha)";
    expectRefused(home, rollbackRun(home), v2, why);
    expectRefused(home, rollbackRun(home, ['--to', 'v1.0.0']), v2, why);
  });

  it('control (condition 6): the killed-flip state whose target is a KEPT pre-W6 version (its ccd/ccrc has no BOX_VERSIONS_ROOT — its own spine would `npm ci` in ~/ccrc, which the units run) — refused bare, and `--to` it dies under the lock', () => {
    const { home, v2 } = killedFlipBox('ccrc-fx-b-prew6-', { oldSpine: KEPT_SPINE });
    expect(verKeptAnswer(home), 'the control is broken: the version must still be KEPT, so only (6) refuses').toBe('rc=0 why=');
    publishV1(home);
    note(home);
    const why = "the target's own ccd/ccrc predates versioned installs, so its spine would npm ci in the tree the units run";
    expectRefused(home, rollbackRun(home), v2, why);
    expectRefused(home, rollbackRun(home, ['--to', 'v1.0.0']), v2, why);
  });

  it('control (condition 1): the target is not the stamp\'s version — the stamp reads v3.0.0 over the kept v1.0.0\'s sha — refused', () => {
    const { home, v2 } = killedFlipBox('ccrc-fx-b-target-');
    writeFileSync(join(home, '.ccrc', 'build.json'), shippedStamp('v3.0.0', V1_SHA));
    publishV1(home);
    note(home);
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: rollback: ~\/\.ccrc\/previous names v1\.0\.0, but it cannot be trusted here — \$HOME\/ccrc points at \$HOME\/ccrc-versions\/v2\.0\.0 while this box's stamp reads v3\.0.0, /m);
    expectNoReinstall(home, v2);
  });

  it('control (condition 3): ~/ccrc already names the target and its install did not complete, the target NOT kept, the release published — `rollback --to` it re-installs IN PLACE as it always did (D-3426): the run goes on to update\'s own path, never the killed-flip refusal', () => {
    const home = freshUpdateBox('ccrc-fx-b-samename-');
    plantW6Box(home, 'v1.0.0', V1_SHA, 'server');
    rmSync(join(home, '.ccrc', 'installed'));
    rmSync(join(home, 'ccrc-versions', 'v1.0.0', '.ccrc-installed'));   // not kept
    publishV1(home);
    const r = rollbackRun(home, ['--to', 'v1.0.0']);
    expect(r.stderr).not.toContain('it cannot be trusted here');
    expect(r.stderr).not.toContain('the killed-flip state');
    expect(r.stdout).toContain('rollback: returning this box to v1.0.0 (named by --to; asked by --from cli) — update\'s own path');
    expect(existsSync(join(home, 'rsync-argv')), 'the re-install did not run — the control proves nothing').toBe(true);
  });

  it('control (unreadable stamp): keeps today\'s behaviour — no verdict from C27, so the run proceeds (the kept version flips back)', () => {
    const { home, v1 } = killedFlipBox('ccrc-fx-b-unreadable-');
    writeFileSync(join(home, '.ccrc', 'build.json'), 'not json\n');
    writeFileSync(join(home, 'fixture-release-http'), '404\n');
    const r = rollbackRun(home);
    expect(r.stderr).not.toContain('it cannot be trusted here');
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(linkOf(home)).toBe(v1);
  });

  // PLATFORM-ONLY: --detach is Linux-only (decision 17) — the macOS answer is
  // `itDarwin('--detach refuses on macOS by name …')` above.
  itLinux('control (the detached child): `rollback --to v1.0.0 --detach --from pwa` in the killed-flip state with the target NOT kept — the parent hands the run on, and the CHILD (which gets `--to` and never runs C27) dies with C27\'s sentence: no rsync, no npm, nothing downloaded, the report closed `failed`', () => {
    const { home, v1, v2 } = killedFlipBox('ccrc-fx-b-detached-');
    rmSync(join(v1, '.ccrc-installed'));
    publishV1(home);
    const parent = rollbackRun(home, ['--to', 'v1.0.0', '--detach', '--from', 'pwa']);
    expect(parent.code, `stderr: ${parent.stderr}\nstdout: ${parent.stdout}`).toBe(0);
    const argv = fileText(join(home, 'systemd-run-argv')).split('\n').filter((l) => l !== '');
    expect(argv).toEqual([expect.stringMatching(/ ccrc-detach rollback --to v1\.0\.0 --from pwa$/)]);
    expect(lastReport(home)).toMatchObject({ phase: 'queued', from: 'pwa' });
    // The recorder does not run the child: run its argv, as the unit would.
    const child = rollbackRun(home, ['--to', 'v1.0.0', '--from', 'pwa']);
    expect(child.code, `stderr: ${child.stderr}\nstdout: ${child.stdout}`).toBe(1);
    expect(child.stderr).toMatch(SENTENCE);
    expect(child.stderr).toContain('rollback: the killed-flip state does not hold — the target is not kept complete (no kept install record)');
    expectNoReinstall(home, v2);
    expect(lastReport(home)).toMatchObject({ phase: 'failed', from: 'rollback', target: 'v1.0.0' });
  });

  // ── flip-only: the rule keys on the state, not on C27 having run ─────────
  it.each([
    ['bare, --from cli', [] as string[]],
    ['bare, --from watchdog', ['--from', 'watchdog']],
    ['`--to` the tag, --from pwa (C27 never runs)', ['--to', 'v1.0.0', '--from', 'pwa']],
    ['`--to` the tag, --from cli', ['--to', 'v1.0.0']],
  ])('flip-only: in the killed-flip state a flip that cannot be made (the one rename refused) dies with C27\'s sentence and NEVER falls through to `update --to … --downgrade`, whose re-install would rsync --delete and `npm ci` into the tree the units run — %s', (_what, args) => {
    const { home, v2 } = killedFlipBox('ccrc-fx-b-fliponly-');
    publishV1(home);
    mkdirSync(join(home, 'ccrc.new'));   // `_plat_ln_swap` refuses to clear it: the flip cannot be made
    note(home);
    const r = rollbackRun(home, args);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toMatch(SENTENCE);
    // The rename is what fails; the version is kept complete, so the tail is the hand install (wave 9 R9-F1).
    expect(r.stderr).toContain(`rollback: the killed-flip state holds, so this rollback may only flip, and the flip could not be made (the one rename that points $HOME/ccrc at $HOME/ccrc-versions/v1.0.0 failed) — it does not fall back to a re-install — ${handInstall('server')}\n`);
    expect(r.stderr, 'the in-place re-install is never advised (R9-F1)').not.toContain('ccrc update --to');
    expect(r.stdout).not.toContain('rolling back by re-install instead');
    expectNoReinstall(home, v2);
    expect(existsSync(join(home, '.ccrc', 'installed'))).toBe(false);
    if (args.includes('--from') && args[args.indexOf('--from') + 1] !== 'cli') {
      expect(lastReport(home)['phase'], 'the report was left non-terminal').toBe('failed');
    }
  });

  // ── wave 9 R9-F1 (D-3827): `_kf_remedy`, the reason line's tail, over fixture version dirs ─────────────────────
  // It decides from a measurement it takes ITSELF, when it prints — `_ver_kept` under the role it was handed, the
  // version's own `ccd/ccrc` carrying `^BOX_VERSIONS_ROOT=`, and (a fleet box) `agent/node_modules` — never from which
  // condition of `_rollback_killed_flip_state` failed. The role is always named: a bare `ccrc install` defaults to role
  // `both` and never reads the recorded role, so on a fleet box it would check and install the server build.
  describe('_kf_remedy: the hand install only where measured safe, never the in-place update, never a recipe (wave 9 R9-F1)', () => {
    type Row = { what: string; role: string; expected: string; kept: RegExp };
    const keptBox = (prefix: string, o: { spine?: string; agentDeps?: boolean; keep?: boolean } = {}): { home: string; v1: string } => {
      const home = freshUpdateBox(prefix);
      const v1 = installVersionedTree(home, 'v1.0.0', { link: false, stamp: { sha: V1_SHA, version: 'v1.0.0' } });
      writeFileSync(join(v1, 'ccd', 'ccrc'), o.spine ?? KEPT_SPINE_W6, { mode: 0o755 });
      if (o.agentDeps === true) mkdirSync(join(v1, 'agent', 'node_modules'), { recursive: true });
      keepDigest(v1, home);   // the spine and the deps dir are part of the kept bytes (D-3465)
      return { home, v1 };
    };
    const remedy = (home: string, role: string): { out: string; stderr: string; status: number | null } => {
      const r = spawnSync(BASH, ['-c', '. "$1"; _kf_remedy v1.0.0 "$2"', 'ccrc-under-test', join(REPO, 'ccd', 'ccrc'), role],
        { env: updateEnv(home), encoding: 'utf8' });
      return { out: r.stdout, stderr: r.stderr, status: r.status };
    };
    const rows: Row[] = [
      { what: 'kept complete, a versioned ccd/ccrc, role server — the hand install, naming --role server', role: 'server',
        expected: handInstall('server'), kept: /^rc=0 why=$/ },
      { what: 'the same under role fleet WITH agent/node_modules — the hand install, naming --role fleet', role: 'fleet',
        expected: handInstall('fleet'), kept: /^rc=0 why=$/ },
      { what: 'role fleet WITHOUT agent/node_modules — no command (its kept arm would run npm ci in place)', role: 'fleet',
        expected: NO_COMMAND, kept: /^rc=0 why=$/ /* fleet without agent deps is still KEPT: only the deps term refuses */ },
      { what: 'kept complete with a PRE-W6 ccd/ccrc — no command (its spine runs npm ci in ~/ccrc)', role: 'server',
        expected: NO_COMMAND, kept: /^rc=0 why=$/ /* the pre-W6 spine is still KEPT: only the spine term refuses */ },
      { what: 'WRITTEN THROUGH since it was kept (a byte appended after the digest, _ver_kept rc 3), a versioned ccd/ccrc — no command', role: 'server',
        expected: NO_COMMAND, kept: /^rc=3 / },
      { what: 'not kept (no directory) — no command', role: 'server', expected: NO_COMMAND, kept: /^rc=1 / },
      { what: 'incomplete (no install record) — no command', role: 'server', expected: NO_COMMAND, kept: /^rc=2 why=no kept install record/ },
      { what: 'an EMPTY role, the version otherwise kept complete — no command (a bare install would default to role both)', role: '',
        expected: NO_COMMAND, kept: /^rc=0 why=$/ /* an empty role reads both: kept, yet no command */ },
    ];
    const setups: Array<(name: string) => { home: string; v1: string }> = [
      (n) => keptBox(n),
      (n) => keptBox(n, { agentDeps: true }),
      (n) => keptBox(n),
      (n) => keptBox(n, { spine: KEPT_SPINE }),
      (n) => {
        const b = keptBox(n);
        appendFileSync(join(b.v1, 'server', 'dist', 'server', 'src', 'index.js'), '// written through after the digest\n');
        return b;
      },
      (n) => {
        const b = keptBox(n);
        rmSync(b.v1, { recursive: true, force: true });
        return b;
      },
      (n) => {
        const b = keptBox(n);
        rmSync(join(b.v1, '.ccrc-installed'));
        return b;
      },
      (n) => keptBox(n),
    ];
    it.each(rows.map((row, i) => [row.what, i] as const))('_kf_remedy: %s', (_what, i) => {
      const row = rows[i]!;
      const { home } = setups[i]!(`ccrc-fx-b-kf-remedy-${i}-`);
      // the control, so a row cannot pass for another reason: `_ver_kept`'s own answer for this fixture under this role
      expect(verKeptAnswer(home, 'v1.0.0', row.role)).toMatch(row.kept);
      const r = remedy(home, row.role);
      expect(r.status, r.stderr).toBe(0);
      expect(r.out).toBe(`${row.expected}\n`);
      expect(r.out, 'the in-place re-install is never advised').not.toContain('ccrc update --to');
      expect(r.out).not.toContain('--downgrade');
      if (row.expected === NO_COMMAND) {
        expect(r.out, 'a no-command row named a recipe').not.toMatch(/README|recipe/);
        expect(r.out, 'a no-command row named a command').not.toContain('bash ~/ccrc-versions');
      } else {
        expect(r.out).toContain(`--role ${row.role} (`);
        expect(r.out).not.toMatch(/README|recipe/);
      }
    });
    it('_kf_remedy: `_ver_kept` writes nothing to stdout (the remedy runs it inside $(…) on the reason line)', () => {
      const { home } = keptBox('ccrc-fx-b-kf-quiet-');
      const r = spawnSync(BASH, ['-c', '. "$1"; _ver_kept v1.0.0 server', 'ccrc-under-test', join(REPO, 'ccd', 'ccrc')],
        { env: updateEnv(home), encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toBe('');
    });
  });
});

describe('ccrc update and rollback: ~/ccrc-backups is pruned after a completed run, never its own (wave 8 item B)', () => {
  // Describe-local kill list, copied as a pattern from the lock describe's
  // `holders`/`lingerers` (never referenced — that describe's array is its
  // own), for P12's background lock holder. Only `lingerers` (pid-file
  // based) is used here — P12's holder is a fixture-side spawn, never a
  // `ChildProcess` this file holds a handle to, so `holders` is dropped
  // (fix round 1, item 4: it was declared and iterated but never pushed to).
  const lingerers: string[] = [];
  afterEach(() => {
    for (const f of lingerers.splice(0)) {
      if (!existsSync(f)) continue;
      const pid = Number(readFileSync(f, 'utf8').trim());
      if (!Number.isInteger(pid) || pid <= 1) continue;
      try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  });

  const backupRoot = (home: string): string => join(home, 'ccrc-backups');
  /** Every timestamped dir directly under `~/ccrc-backups`, lexically sorted
   *  (chronological for this fixed-width shape) — never a hand-made sibling. */
  const backupDirs = (home: string): string[] => {
    const root = backupRoot(home);
    if (!existsSync(root)) return [];
    return readdirSync(root).filter((d) => /^\d{8}-\d{6}$/.test(d)).sort();
  };
  /** Plants one timestamped dir, optionally carrying a `coord.db` snapshot
   *  or a tree entry (`agent-dist`, one of the two names `_bak_gc` reads). */
  const plantDir = (home: string, name: string, opts: { coordDb?: boolean; tree?: boolean } = {}): string => {
    const dir = join(backupRoot(home), name);
    mkdirSync(dir, { recursive: true });
    // A REAL database since the coordination snapshot (delegation broker wave 3): the keep set asks the classifier, and a
    // text placeholder is not a valid snapshot (`_bak_snap_class`; a bare, valid DB with no delegation table is `legacy`).
    if (opts.coordDb) {
      const db = new DatabaseSync(join(dir, 'coord.db'));
      db.exec('CREATE TABLE fixture (x INTEGER); INSERT INTO fixture VALUES (42);');
      db.close();
    }
    if (opts.tree) mkdirSync(join(dir, 'agent-dist'), { recursive: true });
    return dir;
  };
  /** Bounded (3 s) wait until the box clock's own `date +%Y%m%d-%H%M%S`
   *  reads strictly past `after`, so a dir planted next cannot land in the
   *  same second as a setup update's own lock floor. */
  const waitPastClock = (after: string): void => {
    const t0 = Date.now();
    for (;;) {
      const now = spawnSync(REAL_DATE, ['+%Y%m%d-%H%M%S'], { encoding: 'utf8' }).stdout.trim();
      if (now > after) return;
      if (Date.now() - t0 > 3000) throw new Error(`timed out waiting for the box clock to pass ${after} (stuck at ${now})`);
      spawnSync('sleep', ['0.1']);
    }
  };
  /** Every case in this describe drives no `--detach` and touches neither
   *  tmux nor gh — Step 2's blanket assertion, in one place. */
  const assertNoExtras = (home: string): void => {
    expect(existsSync(join(home, 'systemd-run-argv')), 'systemd-run was touched — no case here drives --detach').toBe(false);
    expect(existsSync(join(home, 'tmux-argv')), 'the tmux recorder was touched').toBe(false);
    expect(existsSync(join(home, 'gh-calls')), 'the gh recorder was touched').toBe(false);
  };
  /** `ccrc backup` (P17, B-M14b): the same runner shape as `runUpdate`, for
   *  the ONE verb this describe otherwise never drives. */
  const runBackup = (home: string, args: string[] = [], extraEnv: NodeJS.ProcessEnv = {}): Result => {
    mkdirSync(join(home, 'tmp'), { recursive: true });
    const env = { ...updateEnv(home), TMPDIR: join(home, 'tmp'), ...extraEnv };
    replantDoctorStubs(home);
    const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'backup', ...args], { env, encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  /** `flipBox` (the rollback-by-flip describe's own), copied as a pattern —
   *  a SYNTHETIC W6 box on v2.0.0 with v1.0.0 kept beside it, no real
   *  `ccrc update` ever run, so no backup dir exists until this case's own
   *  `rollbackRun`. P8b and P9 use it; P4 needs a REAL prior update (its
   *  setup backup dirs are the point) and uses `onKeptV1` instead. */
  const makeFlipBox = (prefix: string, opts: { unsigned?: boolean } = {}): { home: string; kept: string } => {
    const home = freshUpdateBox(prefix);
    plantW6Box(home, 'v2.0.0', V2_SHA, 'server');
    const kept = keptVersion(home, 'v1.0.0', V1_SHA, { unsigned: opts.unsigned });
    writeFileSync(join(home, '.ccrc', 'previous'), `v1.0.0\n${V1_SHA}\n`);
    return { home, kept };
  };
  const withSweep = (home: string): void => {
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    writeFileSync(join(home, 'fixture-sweep-active'), UNIT_LINES);
  };

  it('P1: the happy prune — update v1→v2 with 12 old dirs and CCRC_BACKUP_KEEP=3 keeps the newest 3 plus everything protected', () => {
    const home = freshUpdateBox('ccrc-fx-b-p1-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const oldDirs: string[] = [];
    for (let d = 1; d <= 12; d++) {
      const name = `202501${String(d).padStart(2, '0')}-000000`;
      plantDir(home, name);
      oldDirs.push(name);
    }
    plantDir(home, '20991231-235959');
    mkdirSync(join(backupRoot(home), 'pre-flip-agent-dist'), { recursive: true });
    const r = runUpdate(home, [], { CCRC_BACKUP_KEEP: '3' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const backup = announcedBackupDir(r.stdout, home);
    // KEEP counts EVERY timestamped dir, protected ones included (D-3593):
    // of the 14 total (12 old + this run's own + the 9999 dir), KEEP=3
    // leaves the newest 3 BY COUNT — this run's own and 9999 are two of
    // those three by construction, so exactly ONE old dir (the newest)
    // survives by count; the other eleven are the removal set.
    const kept = oldDirs.slice(11);
    const removed = oldDirs.slice(0, 11);
    for (const name of kept) expect(existsSync(join(backupRoot(home), name)), name).toBe(true);
    for (const name of removed) {
      expect(existsSync(join(backupRoot(home), name)), name).toBe(false);
      expect(r.stdout).toMatch(new RegExp(`^update: backups: pruned \\$HOME/ccrc-backups/${name}`, 'm'));
    }
    expect(existsSync(backup)).toBe(true);
    expect(existsSync(join(backupRoot(home), '20991231-235959'))).toBe(true);
    expect(existsSync(join(backupRoot(home), 'pre-flip-agent-dist'))).toBe(true);
    expect(lastReport(home)['phase']).toBe('done');
    assertNoExtras(home);
  });

  it('P2: KEEP=0 with no live coord.db — the newest dir holding a PLANTED coord.db survives as the earlier snapshot, and a hand-made sibling is never touched', () => {
    const home = freshUpdateBox('ccrc-fx-b-p2-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    plantDir(home, '20250101-000000');
    plantDir(home, '20250102-000000', { coordDb: true });
    plantDir(home, '20250103-000000');
    plantDir(home, '20991231-235959');
    mkdirSync(join(backupRoot(home), 'pre-flip-agent-dist'), { recursive: true });
    const r = runUpdate(home, [], { CCRC_BACKUP_KEEP: '0' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const backup = announcedBackupDir(r.stdout, home);
    expect(existsSync(backup)).toBe(true);
    expect(existsSync(join(backupRoot(home), '20991231-235959'))).toBe(true);
    expect(existsSync(join(backupRoot(home), '20250102-000000')), 'the newest dir holding a coord.db').toBe(true);
    expect(existsSync(join(backupRoot(home), '20250101-000000'))).toBe(false);
    expect(existsSync(join(backupRoot(home), '20250103-000000'))).toBe(false);
    expect(existsSync(join(backupRoot(home), 'pre-flip-agent-dist'))).toBe(true);
    assertNoExtras(home);
  });

  it('P2b: KEEP=0 with a LIVE coord.db — this run\'s own backup carries one, and the newest EARLIER snapshot survives too (the protected one is never picked as the extra keep)', () => {
    const home = freshUpdateBox('ccrc-fx-b-p2b-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantCoordDb(home);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    plantDir(home, '20250105-000000', { coordDb: true });
    plantDir(home, '20250110-000000', { coordDb: true });
    plantDir(home, '20250111-000000');
    const r = runUpdate(home, [], { CCRC_BACKUP_KEEP: '0' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const backup = announcedBackupDir(r.stdout, home);
    expect(existsSync(join(backup, 'coord.db')), 'this run\'s own backup snapshot').toBe(true);
    expect(existsSync(join(backupRoot(home), '20250110-000000'))).toBe(true);
    expect(existsSync(join(backupRoot(home), '20250105-000000'))).toBe(false);
    expect(existsSync(join(backupRoot(home), '20250111-000000'))).toBe(false);
    assertNoExtras(home);
  });

  it('P3: this run\'s own backup, named BELOW its own floor by a clock step, still survives — by exact path, never by the floor comparison', () => {
    const home = freshUpdateBox('ccrc-fx-b-p3-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    for (let d = 1; d <= 3; d++) plantDir(home, `2019010${d}-000000`);
    mkdirSync(join(home, '.local', 'bin'), { recursive: true });
    writeFileSync(join(home, 'date-plan'), '20200101-000005\n20200101-000000\n');
    writeFileSync(join(home, '.local', 'bin', 'date'), [
      '#!/bin/sh',
      'printf \'%s\\n\' "$1" >> "$HOME/date-calls"',
      'if [ "$1" = "+%Y%m%d-%H%M%S" ] && [ -s "$HOME/date-plan" ]; then',
      '  IFS= read -r v < "$HOME/date-plan"',
      '  { tail -n +2 "$HOME/date-plan" > "$HOME/date-plan.next"; mv "$HOME/date-plan.next" "$HOME/date-plan"; } 2>/dev/null',
      '  printf \'%s\\n\' "$v"',
      '  exit 0',
      'fi',
      `exec ${REAL_DATE} "$@"`,
    ].join('\n') + '\n', { mode: 0o755 });
    const r = runUpdate(home, [], { CCRC_BACKUP_KEEP: '0' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const backup = announcedBackupDir(r.stdout, home);
    expect(backup).toBe(join(backupRoot(home), '20200101-000000'));
    expect(existsSync(backup)).toBe(true);
    for (let d = 1; d <= 3; d++) {
      expect(existsSync(join(backupRoot(home), `2019010${d}-000000`)), `2019010${d}-000000`).toBe(false);
    }
    const calls = readFileSync(join(home, 'date-calls'), 'utf8').split('\n').filter((l) => l === '+%Y%m%d-%H%M%S');
    expect(calls.length, 'the floor call and the backup-name call').toBeGreaterThanOrEqual(2);
    assertNoExtras(home);
  });

  it('P4: a FLIP rollback takes no backup of its own — the setup\'s own dirs are pruned by the same rule as a planted one, its newest tree backup kept', () => {
    const home = onKeptV1('ccrc-fx-b-p4-');
    const setup1 = backupDirs(home);
    expect(setup1.length, 'onKeptV1 must leave exactly one backup dir (Step 1 measurement)').toBe(1);
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: V2_SHA }), { tag: 'v2.0.0' });
    const up = runUpdate(home);
    expect(up.code, `the move onto v2.0.0 must complete — stderr: ${up.stderr}\nstdout: ${up.stdout}`).toBe(0);
    for (const f of ['curl-argv', 'update-json-writes', 'systemctl-calls', 'tmux-argv', 'gh-calls']) rmSync(join(home, f), { force: true });
    const setup2 = backupDirs(home);
    expect(setup2.length, 'the move to v2.0.0 must leave a second backup dir').toBe(2);
    waitPastClock(setup2[setup2.length - 1]!);
    plantDir(home, '20250101-000000', { coordDb: true });
    plantDir(home, '20250102-000000');
    const r = rollbackRun(home, [], { CCRC_BACKUP_KEEP: '0' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).not.toMatch(/^update: backup:/m);   // a flip takes no backup of its own
    // Since the coordination snapshot every update's backup carries a manifest, so the newer setup dirs are VALID v1 snapshots (their
    // members absent on this box). The planted bare-DB dir is OLDER and legacy, so it holds DATA and they do not: the newest
    // data-bearing snapshot is its own keep (D-4641), and this row means again what it always meant.
    expect(existsSync(join(backupRoot(home), '20250101-000000')), 'the newest earlier snapshot that holds data (a coord.db)').toBe(true);
    expect(existsSync(join(backupRoot(home), '20250102-000000'))).toBe(false);
    expect(existsSync(join(backupRoot(home), setup2[1]!)), 'the newer setup dir carries the tree entry — the earlier tree backup — and a v1 manifest').toBe(true);
    expect(existsSync(join(backupRoot(home), setup2[0]!)), 'the older setup dir is not protected — nothing else keeps it').toBe(false);
    expect(r.stdout).toMatch(new RegExp(`^rollback: backups: pruned \\$HOME/ccrc-backups/${setup2[0]}`, 'm'));
    // Fix round 2, item 1: this case's own kept-version spine runs a REAL
    // `cmd_install`, whose doctor pass legitimately calls tmux and gh — so
    // "shows only what the case drove" means the EXACT bytes, not their
    // absence. Recorders were cleared right after setup's own real updates
    // (above), so what remains is only this run's. Measured (healthyBox's
    // doctor-stub tmux/gh, contained): `tmux -V` and `tmux display-message
    // -p '#{version}'`; `gh auth status --hostname github.com`.
    expect(existsSync(join(home, 'systemd-run-argv')), 'systemd-run was touched — no case here drives --detach').toBe(false);
    expect(readFileSync(join(home, 'tmux-argv'), 'utf8')).toBe('-V\ndisplay-message -p #{version}\n');
    expect(readFileSync(join(home, 'gh-calls'), 'utf8')).toBe('auth status --hostname github.com\n');
  }, 60_000);

  it('P5: no prune on a failed gate (exit 4) — the parent\'s own backup and every planted dir survive', () => {
    const home = freshUpdateBox('ccrc-fx-b-p5-');
    plantRestoreBox(home);
    plantDir(home, '20250101-000000');
    plantDir(home, '20250102-000000');
    const r = runUpdate(home, [], { CCRC_BACKUP_KEEP: '0' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    const backup = announcedBackupDir(r.stdout, home);
    expect(existsSync(backup)).toBe(true);
    expect(existsSync(join(backupRoot(home), '20250101-000000'))).toBe(true);
    expect(existsSync(join(backupRoot(home), '20250102-000000'))).toBe(true);
    expect(r.stdout).not.toMatch(/backups:/);
    assertNoExtras(home);
  });

  it('P6: no prune on --no-gate — the parent\'s own backup and every planted dir survive', () => {
    const home = freshUpdateBox('ccrc-fx-b-p6-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    plantDir(home, '20250101-000000');
    const r = runUpdate(home, ['--no-gate'], { CCRC_BACKUP_KEEP: '0' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const backup = announcedBackupDir(r.stdout, home);
    expect(existsSync(backup)).toBe(true);
    expect(existsSync(join(backupRoot(home), '20250101-000000'))).toBe(true);
    expect(r.stdout).not.toMatch(/backups:/);
    assertNoExtras(home);
  });

  // Fix round 2 (controller ruling): itLinux — `fixture-try-restart-fail` lives only in the systemctl stub's try-restart arm, which Darwin's launchctl sweep never reaches.
  itLinux('P7: no prune on a sweep death — the announced backup and every planted dir survive', () => {
    const home = freshUpdateBox('ccrc-fx-b-p7-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    writeFileSync(join(home, 'fixture-sweep-active'), UNIT_LINES);
    writeFileSync(join(home, 'fixture-try-restart-fail'), '');
    plantDir(home, '20250101-000000');
    plantDir(home, '20250102-000000');
    const r = runUpdate(home, [], { CCRC_BACKUP_KEEP: '0' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    const backup = announcedBackupDir(r.stdout, home);
    expect(existsSync(backup)).toBe(true);
    expect(existsSync(join(backupRoot(home), '20250101-000000'))).toBe(true);
    expect(existsSync(join(backupRoot(home), '20250102-000000'))).toBe(true);
    expect(r.stdout).not.toMatch(/backups: pruned/);
    // The sweep's own try-restart records to `systemctl-calls`, never
    // `systemd-run-argv` (that stub is `--detach` only) — reaching the
    // sweep does not change what this assertion checks.
    assertNoExtras(home);
  });

  it('P8a: exit 3 (a spine that completed under a failing doctor, D-3114) still prunes', () => {
    const home = freshUpdateBox('ccrc-fx-b-p8a-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantCoordDb(home);
    rmSync(join(home, '.gitconfig'));   // forces the trailing doctor's git_email FAIL
    packRelease(home, fullTree(home, {
      version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000',
    }), { tag: 'v2.0.0' });
    plantDir(home, '20250101-000000');
    plantDir(home, '20250102-000000');
    // Fix round 1, item 2: KEEP=1, per the brief. KEEP counts every
    // timestamped dir, this run's own included (D-3593): of the 3 total (2
    // old + this run's own), KEEP=1 leaves the newest 1 by count — this
    // run's own, dated today, by construction — so BOTH old dirs are the
    // removal set; neither carries a coord.db or a tree entry, so nothing
    // else protects them.
    const r = runUpdate(home, [], { CCRC_BACKUP_KEEP: '1' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(3);
    const backup = announcedBackupDir(r.stdout, home);
    expect(existsSync(backup)).toBe(true);
    expect(r.stdout).toMatch(/^update: backups: pruned \$HOME\/ccrc-backups\/20250101-000000/m);
    expect(r.stdout).toMatch(/^update: backups: pruned \$HOME\/ccrc-backups\/20250102-000000/m);
    expect(existsSync(join(backupRoot(home), '20250101-000000'))).toBe(false);
    expect(existsSync(join(backupRoot(home), '20250102-000000'))).toBe(false);
    expect(lastReport(home)['phase']).toBe('done');
    // Fix round 2, item 1: this case stages a REAL `fullTree`, whose staged
    // `cmd_install` runs a real doctor pass that legitimately calls tmux and
    // gh — see P4's identical note. No separate setup update ran here
    // (`plantOldBox` places files, it does not run `ccrc update`), so the
    // recorders hold only this run's own calls with no clearing needed.
    expect(existsSync(join(home, 'systemd-run-argv')), 'systemd-run was touched — no case here drives --detach').toBe(false);
    expect(readFileSync(join(home, 'tmux-argv'), 'utf8')).toBe('-V\ndisplay-message -p #{version}\n');
    expect(readFileSync(join(home, 'gh-calls'), 'utf8')).toBe('auth status --hostname github.com\n');
  }, 60_000);

  it('P8b: exit 3 on a rollback flip whose kept spine completed under a failing doctor (D-3461) still prunes', () => {
    const { home } = makeFlipBox('ccrc-fx-b-p8b-');
    writeFileSync(join(home, 'fixture-kept-spine-exit'), '1\n');
    writeFileSync(join(home, 'fixture-kept-spine-completes'), 'yes\n');
    withSweep(home);
    plantDir(home, '20250101-000000');
    plantDir(home, '20250102-000000');
    const r = rollbackRun(home, [], { CCRC_BACKUP_KEEP: '1' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(3);
    expect(r.stdout).toMatch(/^rollback: backups: pruned \$HOME\/ccrc-backups\/20250101-000000/m);
    expect(existsSync(join(backupRoot(home), '20250101-000000'))).toBe(false);
    expect(existsSync(join(backupRoot(home), '20250102-000000'))).toBe(true);
    expect(lastReport(home)['phase']).toBe('done');
    assertNoExtras(home);
  });

  it('P9: a failed flip gate exits 1 before any prune', () => {
    const { home } = makeFlipBox('ccrc-fx-b-p9-');
    writeFileSync(join(home, 'fixture-health-pin'), 'v9.9.9\n');
    withSweep(home);
    plantDir(home, '20250101-000000');
    const r = rollbackRun(home, [], { CCRC_BACKUP_KEEP: '0' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(existsSync(join(backupRoot(home), '20250101-000000'))).toBe(true);
    expect(r.stdout).not.toMatch(/backups:/);
    assertNoExtras(home);
  });

  // Fix round 1, item 3: `itLinux` alone for the platform (the suite-wide,
  // unstated idiom), but root's skip gets its OWN branch with a title that
  // SAYS why — root can `rm -rf` inside a 0500 directory regardless (it
  // owns the removal, permission bits don't bind it), so this case cannot
  // force the removal failure it measures and folding that into a bare
  // `skipIf` would report a green "skip" with no reason visible anywhere.
  if (process.getuid?.() === 0) {
    it.skip('P10: a prune failure only WARNs — update.json still reads done (root bypasses the 0500 mode this case uses to force a removal failure — nothing here is measurable as root)', () => { /* stated skip only */ });
  } else {
    itLinux('P10: a prune failure only WARNs — update.json still reads done', () => {
      const home = freshUpdateBox('ccrc-fx-b-p10-');
      plantOldBox(home, { version: 'v1.0.0' });
      packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
      const roDir = join(backupRoot(home), '20250101-000000', 'ro');
      mkdirSync(roDir, { recursive: true });
      writeFileSync(join(roDir, 'f'), 'unremovable\n');
      plantDir(home, '20250102-000000', { tree: true });
      chmodSync(roDir, 0o500);
      try {
        const r = runUpdate(home, [], { CCRC_BACKUP_KEEP: '0' });
        expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
        expect(r.stdout).toMatch(/^update: backups: WARN: could not prune \$HOME\/ccrc-backups\/20250101-000000 — every newer backup is intact$/m);
        expect(existsSync(join(backupRoot(home), '20250101-000000', 'ro', 'f'))).toBe(true);
        expect(lastReport(home)['phase']).toBe('done');
        assertNoExtras(home);
      } finally {
        chmodSync(roDir, 0o700);
      }
    });
  }

  it.each([['abc'], ['10000']])('P11: a bad CCRC_BACKUP_KEEP (%s) only WARNs and prunes nothing', (bad) => {
    const home = freshUpdateBox(`ccrc-fx-b-p11-${bad}-`);
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    plantDir(home, '20250101-000000');
    const r = runUpdate(home, [], { CCRC_BACKUP_KEEP: bad });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(new RegExp(`^update: backups: WARN: CCRC_BACKUP_KEEP='${bad}' is not a whole number from 0 to 9999, as set in the environment — nothing pruned$`, 'm'));
    expect(existsSync(join(backupRoot(home), '20250101-000000'))).toBe(true);
    assertNoExtras(home);
  });

  // R34 (wave 17, D-5320): `_keep_ok`'s class is enumerated, so a non-ASCII decimal digit is refused under a UTF-8
  // locale as well (a `[0-9]` range accepted U+0663 there, and the prune then died on an arithmetic error). The
  // row measures its own premise first and skips, with the reason, where this bash and locale do not reproduce the range.
  const rangeAcceptsNonAscii = spawnSync(BASH, ['-c', `[[ $'\\xd9\\xa3' =~ ^[0-9]{1,4}$ ]]`], { env: { LC_ALL: 'en_US.UTF-8', PATH: process.env.PATH ?? '' } }).status === 0;
  it.skipIf(!rangeAcceptsNonAscii)('P11b: a non-ASCII digit in CCRC_BACKUP_KEEP (U+0663) only WARNs and prunes nothing under en_US.UTF-8 (D-5320)', () => {
    const home = freshUpdateBox('ccrc-fx-b-p11b-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    plantDir(home, '20250101-000000');
    const r = runUpdate(home, [], { CCRC_BACKUP_KEEP: '٣', LC_ALL: 'en_US.UTF-8' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^update: backups: WARN: CCRC_BACKUP_KEEP='٣' is not a whole number from 0 to 9999, as set in the environment — nothing pruned$/m);
    expect(existsSync(join(backupRoot(home), '20250101-000000'))).toBe(true);
    assertNoExtras(home);
  });

  // Fix round 2 (controller ruling): itLinux — this fixture's `fixture-sweep-hold-lock` knob lives only in the systemctl stub's try-restart arm (Darwin's launchctl sweep never reaches it), and its `flock -F` is util-linux only.
  itLinux('P12: another ccrc holding ~/.ccrc/update.lock at prune time — skipped, nothing removed', () => {
    const home = freshUpdateBox('ccrc-fx-b-p12-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-hold-lock'), '');
    plantDir(home, '20250101-000000');
    const r = runUpdate(home, [], { CCRC_BACKUP_KEEP: '0' });
    lingerers.push(join(home, 'sweep-lock-holder-pid'));
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^update: backups: skipped — another ccrc run holds ~\/\.ccrc\/update\.lock; nothing was pruned$/m);
    expect(existsSync(join(backupRoot(home), '20250101-000000'))).toBe(true);
    // Reaching the sweep's try-restart records to `systemctl-calls`, never
    // `systemd-run-argv` — see P7's note.
    assertNoExtras(home);
  });

  it('P13: the refused (unpublished-tag) rollback prunes nothing', () => {
    const home = freshUpdateBox('ccrc-fx-b-p13-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantDir(home, '20250101-000000');
    const r = rollbackRun(home, ['--to', 'v7.7.7'], { CCRC_BACKUP_KEEP: '0' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(2);
    expect(existsSync(join(backupRoot(home), '20250101-000000'))).toBe(true);
    expect(r.stdout).not.toMatch(/backups:/);
    assertNoExtras(home);
  });

  it('P14: the floor sits INSIDE the removal set — both dirs at or after it survive though only the newer is kept by count', () => {
    const home = freshUpdateBox('ccrc-fx-b-p14-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    plantDir(home, '20991231-235958');
    plantDir(home, '20991231-235959');
    plantDir(home, '20250101-000000');
    const r = runUpdate(home, [], { CCRC_BACKUP_KEEP: '1' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(existsSync(join(backupRoot(home), '20991231-235958')), 'above the floor, saved though not kept by count').toBe(true);
    expect(existsSync(join(backupRoot(home), '20991231-235959')), 'above the floor AND kept by count').toBe(true);
    expect(existsSync(join(backupRoot(home), '20250101-000000'))).toBe(false);
    assertNoExtras(home);
  });

  it('P15: another run\'s tree backup (server-dist or agent-dist) is the newest-earlier kept, even at KEEP=0', () => {
    const home = freshUpdateBox('ccrc-fx-b-p15-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    plantDir(home, '20250103-000000', { tree: true });
    mkdirSync(join(backupRoot(home), '20250104-000000', 'skill'), { recursive: true });
    const r = runUpdate(home, [], { CCRC_BACKUP_KEEP: '0' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(existsSync(join(backupRoot(home), '20250103-000000'))).toBe(true);
    expect(existsSync(join(backupRoot(home), '20250104-000000'))).toBe(false);
    assertNoExtras(home);
  });

  it('P16: KEEP is a COUNT of every timestamped dir of any origin, not merely the class being pruned', () => {
    const home = freshUpdateBox('ccrc-fx-b-p16-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const s = backupDirs(home).length;   // 0 on this fresh fixture: no setup update ran
    const m = 1;   // Step 1 measurement: one timestamped dir per `ccrc update` on this fixture (no prior skill/hook state to re-back-up)
    const keep = s + m + 1 + 2;
    for (let d = 1; d <= 12; d++) plantDir(home, `202501${String(d).padStart(2, '0')}-000000`);
    plantDir(home, '20991231-235959');
    const r = runUpdate(home, [], { CCRC_BACKUP_KEEP: String(keep) });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const survivors = backupDirs(home);
    expect(survivors, `KEEP=${keep} (s=${s} m=${m}), survivors=${JSON.stringify(survivors)}`).toHaveLength(keep);
    expect(existsSync(join(backupRoot(home), '20250112-000000'))).toBe(true);
    expect(existsSync(join(backupRoot(home), '20250111-000000'))).toBe(true);
    expect(existsSync(join(backupRoot(home), '20250110-000000'))).toBe(false);
    assertNoExtras(home);
  });

  it('P17: `ccrc backup`\'s own prune echo is byte-identical to main\'s (B-M14b control)', () => {
    const home = freshUpdateBox('ccrc-fx-b-p17-');
    plantDir(home, '20250101-000000');
    plantDir(home, '20250102-000000');
    const r = runBackup(home, [], { CCRC_BACKUP_KEEP: '1' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toContain(
      `backup: pruned ${join(backupRoot(home), '20250101-000000')} (keeping the newest 1 timestamped backups; hand-made siblings are never touched)`);
    assertNoExtras(home);
  });

  // wave 9 R10g (D-3825, D-3826): `ccrc backup`'s prune keeps what `_bak_gc` keeps — through the ONE helper
  // `_bak_keepset` — and takes ~/.ccrc/update.lock for the prune only. Nested here so `runBackup`, `plantDir`,
  // `backupRoot` and `assertNoExtras` are in scope; the enclosing describe has no `holders`, so this one declares its own.
  describe('ccrc backup: the prune keeps what _bak_gc keeps, and takes the lock (wave 9 R10g)', () => {
    const holders: ChildProcess[] = [];
    afterEach(() => {
      for (const h of holders.splice(0)) h.kill('SIGKILL');
    });
    const lockPath = (home: string): string => join(home, '.ccrc', 'update.lock');
    /** A FRESH open and a non-blocking flock — the probe's own measurement (the lock describe's, copied as a pattern). */
    const lockFree = (home: string): boolean =>
      spawnSync(BASH, ['-c', 'exec 9>>"$1" && flock -n 9', '_', lockPath(home)]).status === 0;
    const waitUntil = (cond: () => boolean, what: string): void => {
      const t0 = Date.now();
      while (!cond()) {
        if (Date.now() - t0 > 10_000) throw new Error(`timed out waiting for ${what}`);
        spawnSync('sleep', ['0.05']);
      }
    };
    /** ONE process takes flock on the lock file and becomes `sleep` (exec keeps the pid and the descriptor). Returns
     *  once a fresh probe fails. */
    const holdLock = (home: string): ChildProcess => {
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      const h = spawn(BASH, ['-c', 'exec 9>>"$1" && flock 9 && exec sleep 30', '_', lockPath(home)], { stdio: 'ignore' });
      holders.push(h);
      waitUntil(() => !lockFree(home), 'the fixture holder to take the lock');
      return h;
    };
    /** The directory the backup announced: `backup: <dir> (coord.db snapshot, …`. */
    const ownDir = (r: Result): string => {
      const m = /^backup: (\S+) \(coord\.db snapshot/m.exec(r.stdout);
      expect(m, `no "backup: <dir>" line — stdout: ${r.stdout}\nstderr: ${r.stderr}`).not.toBeNull();
      return m![1]!;
    };
    const has = (home: string, name: string): boolean => existsSync(join(backupRoot(home), name));

    it('B1: CCRC_BACKUP_KEEP=0 never removes the backup it just made, and removes both planted older dirs', () => {
      const home = freshUpdateBox('ccrc-w9-r10g-b1-');
      plantDir(home, '20250101-000000');
      plantDir(home, '20250102-000000');
      const r = runBackup(home, [], { CCRC_BACKUP_KEEP: '0' });
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      const own = ownDir(r);
      expect(existsSync(own), `this run's own backup ${own} must survive KEEP=0`).toBe(true);
      expect(has(home, '20250101-000000')).toBe(false);
      expect(has(home, '20250102-000000')).toBe(false);
      assertNoExtras(home);
    });

    it('B2: KEEP=0 keeps the newest earlier tree backup and the newest earlier coord.db snapshot, and removes an unprotected dir', () => {
      const home = freshUpdateBox('ccrc-w9-r10g-b2-');
      mkdirSync(join(plantDir(home, '20250101-000000'), 'server-dist'), { recursive: true });
      plantDir(home, '20250102-000000', { coordDb: true });
      plantDir(home, '20250103-000000');
      const r = runBackup(home, [], { CCRC_BACKUP_KEEP: '0' });
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(has(home, '20250101-000000'), 'the newest earlier tree backup').toBe(true);
      expect(has(home, '20250102-000000'), 'the newest earlier coord.db snapshot').toBe(true);
      expect(has(home, '20250103-000000'), 'nothing protects the empty one').toBe(false);
      assertNoExtras(home);
    });

    it('B3: while another process holds ~/.ccrc/update.lock the prune says so, removes nothing, and ccrc backup exits 0', () => {
      const home = freshUpdateBox('ccrc-w9-r10g-b3-');
      plantDir(home, '20250101-000000');
      plantDir(home, '20250102-000000');
      holdLock(home);
      const r = runBackup(home, [], { CCRC_BACKUP_KEEP: '0' });
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(r.stdout).toContain('backup: prune skipped — another ccrc run holds ~/.ccrc/update.lock; nothing was pruned');
      expect(existsSync(ownDir(r))).toBe(true);
      expect(has(home, '20250101-000000')).toBe(true);
      expect(has(home, '20250102-000000')).toBe(true);
      assertNoExtras(home);
    });

    it('B4: the floor ALONE — a dir named after this run began survives KEEP=0, though it is neither its own path nor a snapshot nor a tree', () => {
      const home = freshUpdateBox('ccrc-w9-r10g-b4-');
      plantDir(home, '20991231-235959');
      const r = runBackup(home, [], { CCRC_BACKUP_KEEP: '0' });
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(has(home, '20991231-235959'), 'only the floor protects it').toBe(true);
      expect(existsSync(ownDir(r))).toBe(true);
      assertNoExtras(home);
    });

    it('B5: with no flock on PATH the prune says so, removes nothing, and ccrc backup exits 0 (the backup was taken first)', () => {
      const home = freshUpdateBox('ccrc-w9-r10g-b5-');
      plantDir(home, '20250101-000000');
      plantDir(home, '20250102-000000');
      // `ccrc-uninstall.test.ts`'s `pathWithout` idiom: ONE link farm of every command on the parent's PATH, except
      // flock and every CONTAINED_TOOLS name (those resolve to the fixture's stubs and poisons in $HOME/.local/bin).
      // `pathWithoutFlock` links nine tools and `ccrc backup` outruns them before its prune.
      const bin = join(home, '.local', 'bin');
      expect(existsSync(join(bin, 'flock')), 'updateEnv must plant no flock').toBe(false);
      const farm = join(home, 'no-flock-backup-bin');
      mkdirSync(farm);
      const skip = new Set<string>(['flock', ...CONTAINED_TOOLS]);
      for (const dir of (process.env['PATH'] ?? '/usr/bin:/bin').split(':')) {
        let names: string[] = [];
        try { names = readdirSync(dir); } catch { continue; }
        for (const name of names) {
          if (skip.has(name)) continue;
          skip.add(name);
          symlinkSync(join(dir, name), join(farm, name));
        }
      }
      const env = { ...updateEnv(home), PATH: `${bin}:${farm}` };
      assertNoRealTool(env, home);
      expect(spawnSync(BASH, ['-c', 'command -v flock'], { env, encoding: 'utf8' }).stdout.trim(), 'no flock under this PATH').toBe('');
      const r = runBackup(home, [], { CCRC_BACKUP_KEEP: '0', PATH: env.PATH });
      const own = ownDir(r);   // BEFORE the skip line: a backup that died cannot pass as a prune that skipped
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(r.stdout).toContain('backup: prune skipped — flock is not on PATH, so ~/.ccrc/update.lock cannot be taken; nothing was pruned');
      expect(existsSync(own)).toBe(true);
      expect(has(home, '20250101-000000')).toBe(true);
      expect(has(home, '20250102-000000')).toBe(true);
      assertNoExtras(home);
    });

    it('B8: _bak_prune called with no recorded floor prunes nothing and says why — exit 0', () => {
      const home = freshUpdateBox('ccrc-w9-r10g-b8-');
      plantDir(home, '20250101-000000');
      plantDir(home, '20250102-000000');
      const script = ['set -uo pipefail', '. "$1"', 'UPD_BAK_FLOOR=""', 'rc=0; _bak_prune || rc=$?', 'echo "rc=$rc"'].join('\n');
      const r = spawnSync(BASH, ['-c', script, 'floor-guard', join(REPO, 'ccd', 'ccrc')],
        { env: { ...updateEnv(home), CCRC_BACKUP_KEEP: '0' }, encoding: 'utf8' });
      expect(r.stdout, `stderr: ${r.stderr}`).toContain(
        "backup: prune skipped — this run's start time was not recorded, so nothing can say which backups are its own; nothing was pruned");
      expect(r.stdout).toContain('rc=0');
      expect(has(home, '20250101-000000')).toBe(true);
      expect(has(home, '20250102-000000')).toBe(true);
    });

    it('B9: with ~/.ccrc/update.lock a DIRECTORY (the lock cannot be measured) the prune says so, removes nothing, and ccrc backup exits 0', () => {
      const home = freshUpdateBox('ccrc-w9-r10g-b9-');
      plantDir(home, '20250101-000000');
      plantDir(home, '20250102-000000');
      // `exec 9>>dir` fails, and `_ver_lock_try` answers rc 3 — the `*)` arm of `_bak_prune`'s case, which B3 (rc 1),
      // B5 (rc 2) and B8 (no floor) do not reach. Falling through to the prune would remove both planted dirs.
      mkdirSync(lockPath(home), { recursive: true });
      const r = runBackup(home, [], { CCRC_BACKUP_KEEP: '0' });
      const own = ownDir(r);   // BEFORE the skip line: a backup that died cannot pass as a prune that skipped
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(r.stdout).toContain('backup: prune skipped — ~/.ccrc/update.lock could not be measured; nothing was pruned');
      expect(existsSync(own)).toBe(true);
      expect(has(home, '20250101-000000')).toBe(true);
      expect(has(home, '20250102-000000')).toBe(true);
      assertNoExtras(home);
    });

    it('B10: the clock steps BACK between the floor and the backup (an NTP step, a DST fall-back) — this run\'s own dir sorts below the floor, and its own-path guard alone keeps it at KEEP=0', () => {
      // Fix round 1, F3 (review 265): `cmd_backup` reads the floor with `date +%Y%m%d-%H%M%S`, then `_upd_backup` names
      // its dir with a second such call. A `date` in the fixture's own bin (first on updateEnv's PATH) answers that
      // format with 20300101-000000 the first time and 20250601-000000 after, so the floor does NOT cover the own dir:
      // only `[ "$d" = "$UPD_BACKUP_DIR" ] && continue` does. Every other format runs the system's date. No real clock
      // is touched.
      const home = freshUpdateBox('ccrc-w9-r10g-b10-');
      plantDir(home, '20250101-000000');
      const realDate = ['/bin/date', '/usr/bin/date'].find((p) => existsSync(p));
      expect(realDate, 'a system date for every other format').toBeDefined();
      const calls = join(home, 'date-ts-calls');
      const stub = join(home, '.local', 'bin', 'date');
      writeFileSync(stub, [
        '#!/bin/sh',
        'if [ "$#" -eq 1 ] && [ "$1" = "+%Y%m%d-%H%M%S" ]; then',
        `  echo x >> '${calls}'`,
        `  if [ "$(wc -l < '${calls}')" -eq 1 ]; then echo 20300101-000000; else echo 20250601-000000; fi`,
        '  exit 0',
        'fi',
        `exec '${realDate}' "$@"`,
        '',
      ].join('\n'));
      chmodSync(stub, 0o755);
      const r = runBackup(home, [], { CCRC_BACKUP_KEEP: '0' });
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      const own = ownDir(r);
      expect(own, 'the backup took the stepped-back second, below the floor').toBe(join(backupRoot(home), '20250601-000000'));
      expect(readFileSync(calls, 'utf8').split('\n').filter(Boolean).length, 'the floor read, then the backup\'s name').toBeGreaterThanOrEqual(2);
      expect(existsSync(own), `this run's own backup ${own} must survive a floor that does not cover it`).toBe(true);
      expect(has(home, '20250101-000000'), 'the prune ran: the unprotected earlier dir went').toBe(false);
      assertNoExtras(home);
    });

    it('_bak_gc and _bak_prune each call _bak_keepset, and the snapshot test is spelled once: through _bak_snap_class, never a bare [ -f coord.db ]', () => {
      const src = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
      const body = (name: string): string => {
        const m = new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?\\n\\}$`, 'm').exec(src);
        expect(m, `ccd/ccrc has no ${name}`).not.toBeNull();
        return m![0];
      };
      // A CALL (a command word at the start of a line), never a mention in a comment.
      expect(body('_bak_gc'), '_bak_gc').toMatch(/^ +_bak_keepset(\s|$)/m);
      expect(body('_bak_prune'), '_bak_prune').toMatch(/^ +_bak_keepset(\s|$)/m);
      expect(src.split('[ -f "$d/coord.db" ]').length - 1, 'a bare coord.db test would discard a sidecar-only snapshot').toBe(0);
      expect(src.split('_bak_snap_class "$d"').length - 1, 'the classifier is asked in one place').toBe(1);
    });

    it('_bak_gc and _bak_prune spell no keep clause of their own: each calls _bak_removable, and the filter is written once (R14(a), D-5318)', () => {
      const src = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
      const body = (name: string): string => {
        const m = new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?\\n\\}$`, 'm').exec(src);
        expect(m, `ccd/ccrc has no ${name}`).not.toBeNull();
        return m![0];
      };
      for (const fn of ['_bak_gc', '_bak_prune']) {
        expect(body(fn), `${fn} calls the one filter`).toMatch(/^ +_bak_removable "\$d" \|\| continue/m);
        expect(body(fn), `${fn} spells no keep clause`).not.toContain('[ "$d" = "$BAK_KEEP_');
      }
      expect(src.split('[ "$d" = "$BAK_KEEP_').length - 1, 'the three keep clauses are spelled once, in _bak_removable').toBe(3);
      expect(body('_bak_removable'), 'the helper fails closed on an unparsable floor').toMatch(/\[\[ "\$UPD_BAK_FLOOR" =~ \^\[0-9\]\{8\}-\[0-9\]\{6\}\$ \]\] \|\| return 1/);
    });

    // E2/E3 (R14(a), D-5318): the helper's ANSWERS, not its spelling. The own dir (20250109) sits BELOW the floor, so the own-dir
    // clause alone keeps it; 20250110 and 20250111 are kept by the floor clause alone; each keep by its own clause.
    it('_bak_removable answers removable for exactly the unprotected names, and nothing at all on an unparsable floor (E2, E3; D-5318)', () => {
      const home = freshUpdateBox('ccrc-fx-e2-removable-');
      const names = ['20250101', '20250102', '20250103', '20250104', '20250105', '20250109', '20250110', '20250111'];
      const row = (floor: string): string => [
        'R="$HOME/ccrc-backups"',
        `UPD_BAK_FLOOR='${floor}'; UPD_BACKUP_DIR="$R/20250109-000000"`,
        'BAK_KEEP_SNAP="$R/20250102-000000"; BAK_KEEP_DATA="$R/20250103-000000"; BAK_KEEP_TREE="$R/20250104-000000"',
        `for n in ${names.join(' ')}; do _bak_removable "$R/$n-000000" && printf '%s ' "$n"; done; echo`,
      ].join('\n');
      const e2 = sourcedCcrc(home, row('20250110-000000'));
      expect(e2.code, `stderr: ${e2.stderr}`).toBe(0);
      expect(e2.stdout.trim().split(/\s+/), 'removable: neither own, at or after the floor, nor any of the three keeps').toEqual(['20250101', '20250105']);
      const e3 = sourcedCcrc(home, row('garbage'));
      expect(e3.code, `stderr: ${e3.stderr}`).toBe(0);
      expect(e3.stdout.trim(), 'an unparsable floor keeps everything').toBe('');
    });
  });

  // fix round 1 item 9 (review 196 F10), REVERSED by wave 17 (R10i, D-5319): a timestamp-named SYMLINK is NOT a timestamped
  // backup. The glob matches its name, but `_bak_list` now lists directories that are not links (`[ -d ]` follows one), so a
  // link is never counted in the newest-N window, never holds a keep through its target, and is never pruned. It used to be
  // counted and REMOVED AS A LINK (its target untouched); that was the wrong half of the rule, because a link in the window
  // pushed a real backup out of it. Two link cases (a fixture dir outside ~/ccrc-backups, and onKeptV1's real kept v1.0.0 —
  // this box carries no v0.0.50) plus a plain timestamp-named file, which is not a timestamped backup either; all three must
  // survive. CCRC_BACKUP_KEEP=0 and every planted name below the run's lock second (2025…) would put each of them in the
  // removal set if it were listed. Assertions read the FILESYSTEM (lstat for the links, a content digest for their targets),
  // never the `pruned` echo — a `rm -rf -- "$d/"` on a symlink would empty the target and still print it.
  it('P18: a timestamp-named symlink is not a backup: never listed, never pruned, its target untouched; a timestamp-named plain file is not a backup and survives (R10i reversed, D-5319)', () => {
    const home = onKeptV1('ccrc-fx-b-p18-');
    const v1 = join(home, 'ccrc-versions', 'v1.0.0');
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: V2_SHA }), { tag: 'v2.0.0' });
    const up = runUpdate(home);
    expect(up.code, `the move onto v2.0.0 must complete — stderr: ${up.stderr}\nstdout: ${up.stdout}`).toBe(0);
    for (const f of ['curl-argv', 'update-json-writes', 'systemctl-calls', 'tmux-argv', 'gh-calls']) rmSync(join(home, f), { force: true });
    const outside = join(home, 'fixture-outside-backup-root');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'marker.txt'), 'outside target content\n');
    const linkToOutside = join(backupRoot(home), '20250101-000000');
    symlinkSync(outside, linkToOutside);
    const linkToKept = join(backupRoot(home), '20250102-000000');
    symlinkSync(v1, linkToKept);
    const plainFile = join(backupRoot(home), '20250103-000000');
    writeFileSync(plainFile, 'a plain file, not a timestamped backup directory\n');
    const outsideBefore = treeDigest(outside);
    const keptBefore = treeDigest(v1);
    const plainBefore = fileText(plainFile);
    expect(Object.keys(outsideBefore).length, 'the outside fixture must carry a real file').toBeGreaterThan(0);
    expect(Object.keys(keptBefore).length, 'the kept v1.0.0 tree must carry real files').toBeGreaterThan(0);
    const r = rollbackRun(home, [], { CCRC_BACKUP_KEEP: '0' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const linkGone = (p: string): boolean => { try { lstatSync(p); return false; } catch { return true; } };
    expect(linkGone(linkToOutside), 'the link to the outside target is not a backup: it survives').toBe(false);
    expect(lstatSync(linkToOutside).isSymbolicLink(), 'and it is still a link').toBe(true);
    expect(linkGone(linkToKept), 'the link to the kept version is not a backup: it survives').toBe(false);
    expect(lstatSync(linkToKept).isSymbolicLink(), 'and it is still a link').toBe(true);
    expect(treeDigest(outside), 'the outside target\'s content must survive untouched').toEqual(outsideBefore);
    expect(treeDigest(v1), 'the kept version\'s content must survive untouched').toEqual(keptBefore);
    expect(existsSync(plainFile), 'the plain timestamp-named file is not a timestamped backup').toBe(true);
    expect(fileText(plainFile)).toBe(plainBefore);
  }, 60_000);   // a move onto v2.0.0 plus a rollback: 13.7-17 s alone, timed out 3 of 6 at load 30-50 (final review)

  // P18b/P18c (wave 17, D-5319): the harm a listed link did, through the sourced `_bak_prune` so that no other dir is listed
  // (a full update or rollback adds the run's own backup and the prior move's holds, which take newest-N slots of their own).
  // KEEP=1 and a floor in 2030 put every planted dir below the floor, so only the window and the keeps decide.
  const pruneSourced = (home: string): Result =>
    sourcedCcrc(home, 'UPD_BAK_FLOOR=20300101-000000; UPD_BACKUP_DIR=""; CCRC_BACKUP_KEEP=1; _bak_prune');
  const isLink = (p: string): boolean => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };

  it('P18b: a PLAIN real backup older than a timestamp-named link to a plain target: at KEEP=1 the real one is kept (the link takes no newest-N slot), the link and its target stay', () => {
    const home = freshUpdateBox('ccrc-fx-b-p18b-');
    const real = join(backupRoot(home), '20250101-000000');
    mkdirSync(real, { recursive: true });
    writeFileSync(join(real, 'some-file'), 'a plain real backup: no tree entry, no snapshot name\n');
    const target = join(home, 'plain-target');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'marker.txt'), 'the link\'s target\n');
    const link = join(backupRoot(home), '20250102-000000');
    symlinkSync(target, link);
    const targetBefore = treeDigest(target);
    const r = pruneSourced(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout, 'the prune ran: a skipped prune would leave every dir and prove nothing').not.toMatch(/prune skipped/);
    expect(existsSync(real) && !isLink(real), 'the real backup is the newest-1 by the one rule: a link is not counted').toBe(true);
    expect(isLink(link), 'the link is not a backup: it stays').toBe(true);
    expect(treeDigest(target), 'its target is untouched').toEqual(targetBefore);
    expect(r.stdout).not.toMatch(/^backup: pruned/m);
  });

  it('P18c: a link whose target holds server-dist, newer than a real tree backup outside the newest-N window: the real one stays protected as the tree keep', () => {
    const home = freshUpdateBox('ccrc-fx-b-p18c-');
    const tree = join(backupRoot(home), '20250101-000000');
    mkdirSync(join(tree, 'server-dist'), { recursive: true });
    const plain = join(backupRoot(home), '20250102-000000');
    mkdirSync(plain, { recursive: true });
    writeFileSync(join(plain, 'some-file'), 'a plain real backup, the newest-1\n');
    const target = join(home, 'tree-target');
    mkdirSync(join(target, 'server-dist'), { recursive: true });
    writeFileSync(join(target, 'server-dist', 'marker.txt'), 'the link\'s target holds a tree entry\n');
    const link = join(backupRoot(home), '20250103-000000');
    symlinkSync(target, link);
    const targetBefore = treeDigest(target);
    const r = pruneSourced(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout, 'the prune ran: a skipped prune would leave every dir and prove nothing').not.toMatch(/prune skipped/);
    expect(existsSync(tree), 'the real tree backup is the newest earlier tree backup: a link\'s target is never the tree keep').toBe(true);
    expect(existsSync(plain), 'the newest real dir holds the one newest-N slot').toBe(true);
    expect(isLink(link), 'the link stays').toBe(true);
    expect(treeDigest(target), 'its target is untouched').toEqual(targetBefore);
  });
});

/** `KEY=value` strings as an environment object, a later key winning as it does for `env -i` (wave 24's contained spawns). */
function envPairs(list: readonly string[]): Record<string, string> {
  return Object.fromEntries(list.map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]));
}

// ── Delegation broker wave 3, Task 8B: the coordination snapshot's callers ──────────────────────────────────────────────
// `_upd_backup` runs `deploy/coordination-snapshot.mjs capture` LAST, `_bak_keepset` asks its classifier, and neither the backup
// set nor arm 3 of the restore ever carries the sidecars. Every case is a fixture HOME; the helper's own rows (capture, classify,
// restore, recover) are in `coordination-snapshot.test.ts`.
describe('ccrc backup and update: the coordination snapshot callers (delegation broker wave 3, Task 8B)', () => {
  const HELPER = join(REPO, 'deploy', 'coordination-snapshot.mjs');
  const backupRoot = (home: string): string => join(home, 'ccrc-backups');
  const CP_REV1 = encodeDelegationCheckpoint({ ...emptyDelegationCheckpoint(), revision: 1 });
  const CP_REV2 = encodeDelegationCheckpoint({ ...emptyDelegationCheckpoint(), revision: 2 });
  /** One whole journal record: the wave-23 rows plant it beside a checkpoint and a database, so a capture holds all three members. */
  const W23_JOURNAL = Buffer.from(encodeDelegationJournalRecord(buildDelegationJournalRecord({
    sequence: 1, acceptedAt: '2026-10-15T10:00:00.000Z', previousDigest: null,
    entry: {
      kind: 'evidence-accepted',
      event: {
        v: 1, eventKind: 'SessionStart', source: 'startup', observedAt: '2026-10-15T09:59:00.000Z', sessionId: 'lane-a-demo', parentIncarnation: 'g1',
        claudeSessionId: '11111111-2222-3333-4444-555555555555', eventId: 'e'.repeat(64), bucket: '2026101509', startOffset: 0, endOffset: 120,
      },
    },
  })));
  const manifestOf = (dir: string): string => join(dir, 'coordination-snapshot.json');

  /** A `node` in front of the real one on PATH: it records which of the two helpers ran and, at the capture, what the backup
   *  directory held at that moment; `FX_CLASSIFY_FAIL=1` makes the classifier fail the way a broken helper does (exit 70). */
  const nodeShim = (home: string): string => {
    const bin = join(home, 'shim');
    mkdirSync(bin, { recursive: true });
    // This directory is where `command -v node` lands, so `_node_select` (ccd/ccrc-node) wants npm and npx in it:
    // the fixture's own two, linked (the recorder npm stays the one that runs).
    for (const n of ['npm', 'npx']) {
      rmSync(join(bin, n), { force: true });
      symlinkSync(join(home, '.local', 'bin', n), join(bin, n));
    }
    writeFileSync(join(bin, 'node'), [
      '#!/bin/sh',
      'case "$2" in',
      '  *backup-coord.mjs) echo sqlite >> "$HOME/node-order" ;;',
      '  *coordination-snapshot.mjs)',
      '    echo "helper $3" >> "$HOME/node-order"',
      // The classifier cannot be loaded (node exits 1 with no output), or answers a well-formed word with the WRONG exit code.
      '    if { [ "$3" = classify ] || [ "$3" = validate ]; } && [ -n "$FX_CLASSIFY_EXIT1" ]; then exit 1; fi',
      '    if { [ "$3" = classify ] || [ "$3" = validate ]; } && [ -n "$FX_CLASSIFY_MISMATCH" ]; then printf "none: shim\\ndata: no\\n"; exit 0; fi',
      // An environment that prints a line on STDERR (a debugger banner), or a classifier whose stdout has a third line.
      '    if { [ "$3" = classify ] || [ "$3" = validate ]; } && [ -n "$FX_CLASSIFY_STDERR" ]; then echo "Debugger listening on ws://127.0.0.1:0/fixture" >&2; fi',
      `    if { [ "$3" = classify ] || [ "$3" = validate ]; } && [ -n "$FX_CLASSIFY_EXTRA" ]; then PATH='${updateEnv(home).PATH ?? ''}'; o="$(node "$@")"; r=$?; printf '%s\\nextra: line\\n' "$o"; exit $r; fi`,
      '    if [ "$3" = capture ]; then echo "present: $(ls -A "$5" | tr "\\n" " ")" >> "$HOME/node-order"; fi',
      // Wave 23 (D-6346): `thin` answers FX_THIN_EXIT when it is set, and a copy of the report as it stands when it is asked.
      '    if [ "$3" = thin ] && [ -f "$HOME/.ccrc/update.json" ]; then cp "$HOME/.ccrc/update.json" "$HOME/thin-saw-update.json"; fi',
      // ...and whether ~/.ccrc/update.lock is held as it is asked: a fresh open conflicts with the caller's flock (review 794, F11).
      '    if [ "$3" = thin ]; then if flock -n "$HOME/.ccrc/update.lock" true 2>/dev/null; then echo free; else echo held; fi > "$HOME/thin-lock-state"; fi',
      // ...and the arguments it was asked with, one a line (D-6464's `--until`).
      '    if [ "$3" = thin ]; then printf "%s\\n" "$@" > "$HOME/thin-args"; fi',
      '    if [ "$3" = thin ] && [ -n "$FX_THIN_EXIT" ]; then exit "$FX_THIN_EXIT"; fi',
      '    if { [ "$3" = classify ] || [ "$3" = validate ]; } && [ -n "$FX_CLASSIFY_FAIL" ]; then exit 70; fi ;;',
      'esac',
      // On to whatever `node` the fixture box would otherwise have resolved (its verifier shim included), not the real one.
      `PATH='${updateEnv(home).PATH ?? ''}'; exec node "$@"`,
      '',
    ].join('\n'), { mode: 0o755 });
    // D-6464: `FX_JQ_UPDATED_AT` answers cmd_update's read-back of the re-stamp's `updatedAt`; every other jq call is the real one.
    writeFileSync(join(bin, 'jq'), [
      '#!/bin/sh',
      'if [ -n "$FX_JQ_UPDATED_AT" ] && [ "$2" = ".updatedAt | numbers" ]; then printf "%s\\n" "$FX_JQ_UPDATED_AT"; exit 0; fi',
      `PATH='${updateEnv(home).PATH ?? ''}'; exec jq "$@"`,
      '',
    ].join('\n'), { mode: 0o755 });
    return bin;
  };
  const withShim = (home: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ PATH: `${nodeShim(home)}:${updateEnv(home).PATH ?? ''}`, ...extra });
  const nodeOrder = (home: string): string[] => (existsSync(join(home, 'node-order')) ? readFileSync(join(home, 'node-order'), 'utf8').split('\n').filter(Boolean) : []);

  const runBackup = (home: string, args: string[] = [], extraEnv: NodeJS.ProcessEnv = {}): Result => {
    mkdirSync(join(home, 'tmp'), { recursive: true });
    const env = { ...updateEnv(home), TMPDIR: join(home, 'tmp'), ...extraEnv };
    replantDoctorStubs(home);
    const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'backup', ...args], { env, encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  const ownDir = (r: Result): string => {
    const m = /^backup: (\S+)/m.exec(r.stdout);
    if (m === null) throw new Error(`no "backup:" line in:\n${r.stdout}`);
    return m[1]!;
  };
  const helper = (home: string, args: string[]): Result => {
    const r = spawnSync(process.execPath, ['--no-warnings', HELPER, ...args], { env: { HOME: home, PATH: process.env['PATH'] ?? '' }, encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  const plantLiveCheckpoint = (home: string, bytes: Uint8Array = CP_REV1): void => {
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'delegation-checkpoint.json'), bytes);
  };
  type Kind = 'v1-sidecars' | 'v1-empty' | 'legacy-db' | 'invalid' | 'tree' | 'tree+v1' | 'tree+v1-full' | 'plain';
  /** One timestamped backup dir of a given kind. 'v1-sidecars' is a REAL helper capture of a checkpoint (no journal, no DB). */
  const plantDir = (home: string, name: string, kind: Kind): string => {
    const dir = join(backupRoot(home), name);
    mkdirSync(dir, { recursive: true });
    if (kind === 'v1-sidecars' || kind === 'v1-empty' || kind === 'tree+v1' || kind === 'invalid') {
      const mini = mkTmp('ccrc-fx-snap-mini-');
      mkdirSync(join(mini, '.ccrc'));
      if (kind !== 'v1-empty') writeFileSync(join(mini, '.ccrc', 'delegation-checkpoint.json'), CP_REV1);
      const r = helper(mini, ['capture', '--dir', dir]);
      expect(r.code, r.stderr).toBe(0);
    }
    if (kind === 'invalid') {
      // A healthy DB beside a manifest that no longer holds up: it must NOT be taken for a legacy snapshot.
      const db = new DatabaseSync(join(dir, 'coord.db'));
      db.exec('CREATE TABLE fixture (x INTEGER)');
      db.close();
      writeFileSync(manifestOf(dir), readFileSync(manifestOf(dir), 'utf8').replace('"version":1', '"version":2'));
    }
    if (kind === 'legacy-db') {
      const db = new DatabaseSync(join(dir, 'coord.db'));
      db.exec('CREATE TABLE fixture (x INTEGER)');
      db.close();
    }
    if (kind === 'tree+v1-full') {
      // A REAL capture of a live journal, checkpoint and database (the wave-23 rows count and thin these), plus a tree entry.
      const mini = mkTmp('ccrc-fx-snap-full-');
      mkdirSync(join(mini, '.ccrc'));
      writeFileSync(join(mini, '.ccrc', 'delegation-checkpoint.json'), CP_REV1);
      writeFileSync(join(mini, '.ccrc', 'delegation-events.log'), W23_JOURNAL);
      plantCoordDb(mini);
      const db = new DatabaseSync(join(dir, 'coord.db'));
      db.exec('CREATE TABLE fixture (x INTEGER); INSERT INTO fixture VALUES (42);');
      db.close();
      const r = helper(mini, ['capture', '--dir', dir]);
      expect(r.code, r.stderr).toBe(0);
    }
    if (kind === 'tree' || kind === 'tree+v1' || kind === 'tree+v1-full') mkdirSync(join(dir, 'agent-dist'), { recursive: true });
    return dir;
  };

  it('`_upd_backup` order: a unique directory, the SQLite snapshot, the existing backup set, and only THEN the coordination capture, which writes the manifest last', () => {
    const home = freshUpdateBox('ccrc-fx-8b-order-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantCoordDb(home);
    plantLiveCheckpoint(home);
    const r = runBackup(home, [], withShim(home));
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const dir = ownDir(r);
    const order = nodeOrder(home);
    expect(order.slice(0, 3).map((l) => l.replace(/:.*/, '')), order.join(' | ')).toEqual(['sqlite', 'helper capture', 'present']);
    const present = order[2]!.replace(/^present: /, '').trim().split(/\s+/);
    // At the moment of the capture the SQLite snapshot and the rest of the set were already in place, and the manifest was not.
    expect(present).toContain('coord.db');
    expect(present.length, `the backup set was copied before the capture: ${present.join(' ')}`).toBeGreaterThan(2);
    expect(present).not.toContain('coordination-snapshot.json');
    expect(present).not.toContain('delegation-checkpoint.json');
    // Afterwards: the manifest, the checkpoint sidecar, and a snapshot that validates.
    expect(readdirSync(dir)).toEqual(expect.arrayContaining([...present, 'coordination-snapshot.json', 'delegation-checkpoint.json']));
    expect(helper(home, ['classify', '--from', dir])).toMatchObject({ code: 0, stdout: 'v1\n' });
    expect(r.stdout).toMatch(/\(coord\.db snapshot, coordination sidecars and manifest, dists, ccd and its body, units — taken before anything was installed\)/);
    expect(JSON.parse(readFileSync(manifestOf(dir), 'utf8'))).toMatchObject({
      members: { delegationCheckpoint: { present: true }, delegationJournal: { present: false }, coordDb: { present: true } },
      delegation: { state: 'initialized', checkpointRevision: 1 },
    });
  });

  it('a box with nothing to snapshot still gets a manifest (a fleet box): every member absent, and the backup continues', () => {
    const home = freshUpdateBox('ccrc-fx-8b-empty-');
    plantOldBox(home, { version: 'v1.0.0' });
    const r = runBackup(home);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    const m = JSON.parse(readFileSync(manifestOf(ownDir(r)), 'utf8'));
    expect(m.delegation).toEqual({ state: 'absent', checkpointRevision: null, anchor: null, journal: null });
    expect(m.members.coordDb.present).toBe(false);
  });

  it('continue ONLY after a durable manifest: a capture that fails stops `ccrc backup`, and stops `ccrc update` before anything is installed', () => {
    const bad = (home: string): void => { plantLiveCheckpoint(home, new TextEncoder().encode('{"v":1}\n')); };
    const home = freshUpdateBox('ccrc-fx-8b-fail-backup-');
    plantOldBox(home, { version: 'v1.0.0' });
    bad(home);
    const r = runBackup(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: the coordination snapshot failed — refusing to install with an incomplete backup/m);
    expect(r.stderr).toMatch(/coordination snapshot: bad-shape/);
    const dirs = readdirSync(backupRoot(home));
    expect(dirs).toHaveLength(1);
    expect(existsSync(manifestOf(join(backupRoot(home), dirs[0]!))), 'no manifest after a failed capture').toBe(false);
    expect(readdirSync(join(backupRoot(home), dirs[0]!)).filter((f) => /delegation|coordination/.test(f)), 'no helper-owned file is left').toEqual([]);

    const home2 = freshUpdateBox('ccrc-fx-8b-fail-update-');
    plantOldBox(home2, { version: 'v1.0.0' });
    plantCoordDb(home2);
    bad(home2);
    packRelease(home2, fullTree(home2, { version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000' }), { tag: 'v2.0.0' });
    const u = runUpdate(home2);
    expect(u.code, `stderr: ${u.stderr}\nstdout: ${u.stdout}`).toBe(1);
    expect(u.stderr).toMatch(/the coordination snapshot failed — refusing to install with an incomplete backup/);
    expect(existsSync(join(home2, 'ccrc', 'server', 'OLD-MARKER')), 'the old tree must still be in place').toBe(true);
    expect(existsSync(join(home2, 'ccrc', 'ccd', 'ccrc-doctor-checks')), 'nothing of the new tree was installed').toBe(false);
  });

  // D-4655: a torn journal tail no longer stops a backup, an update or the fallback deploy. Capture leaves it out, says so ONCE, and the
  // callers pass that line to the operator and go on. The rows of the helper itself are in `coordination-snapshot.test.ts`.
  describe('a torn journal tail is left out with a warning, never a refusal (D-4655)', () => {
    const RECORD = buildDelegationJournalRecord({
      sequence: 1, acceptedAt: '2026-10-15T10:00:00.000Z', previousDigest: null,
      entry: {
        kind: 'evidence-accepted',
        event: {
          v: 1, eventKind: 'SessionStart', source: 'startup', observedAt: '2026-10-15T09:59:00.000Z', sessionId: 'lane-a-demo', parentIncarnation: 'g1',
          claudeSessionId: '11111111-2222-3333-4444-555555555555', eventId: 'e'.repeat(64), bucket: '2026101509', startOffset: 0, endOffset: 120,
        },
      },
    });
    const WHOLE = Buffer.from(encodeDelegationJournalRecord(RECORD));
    const FRAGMENT = Buffer.from('{"acceptedAt":"2026-10-15T1');
    const plantJournal = (home: string, bytes: Buffer): void => {
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      writeFileSync(join(home, '.ccrc', 'delegation-events.log'), bytes);
    };
    const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

    it('`ccrc backup` exits 0, prints the helper\'s warning (bytes, sha256, the backup directory) after its result line, and the snapshot holds the prefix', () => {
      const home = freshUpdateBox('ccrc-fx-8c-backup-');
      plantOldBox(home, { version: 'v1.0.0' });
      plantJournal(home, Buffer.concat([WHOLE, FRAGMENT]));
      const r = runBackup(home);
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      const dir = ownDir(r);
      const warning = r.stdout.split('\n').filter((l) => /^backup: WARN: /.test(l));
      expect(warning, r.stdout).toHaveLength(1);
      expect(warning[0]).toContain(`left out ${FRAGMENT.length} bytes (sha256 ${sha(FRAGMENT)})`);
      expect(warning[0]).toContain(dir);
      expect(r.stdout.indexOf('backup: WARN:'), 'after the result line').toBeGreaterThan(r.stdout.indexOf(`backup: ${dir}`));
      expect(readFileSync(join(dir, 'delegation-events.log'))).toEqual(WHOLE);
      expect(JSON.parse(readFileSync(manifestOf(dir), 'utf8')).delegation.journalTailOmitted).toEqual({ bytes: FRAGMENT.length, sha256: sha(FRAGMENT) });
      expect(helper(home, ['classify', '--from', dir])).toMatchObject({ code: 0, stdout: 'v1\n' });
      expect(readFileSync(join(home, '.ccrc', 'delegation-events.log')), 'capture never writes the live journal').toEqual(Buffer.concat([WHOLE, FRAGMENT]));
    });

    it('a whole journal prints no warning', () => {
      const home = freshUpdateBox('ccrc-fx-8c-whole-');
      plantOldBox(home, { version: 'v1.0.0' });
      plantJournal(home, WHOLE);
      const r = runBackup(home);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).not.toMatch(/WARN: left out/);
    });

    it('`ccrc update` goes on past it: the install completes and the warning is in the transcript (the directory redacted like every update-family path)', () => {
      const home = freshUpdateBox('ccrc-fx-8c-update-');
      plantOldBox(home, { version: 'v1.0.0' });
      plantCoordDb(home);
      plantJournal(home, Buffer.concat([WHOLE, FRAGMENT]));
      packRelease(home, fullTree(home, { version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000' }), { tag: 'v2.0.0' });
      const u = runUpdate(home);
      expect(u.code, `stderr: ${u.stderr}\nstdout: ${u.stdout}`).toBe(0);
      const warning = u.stdout.split('\n').filter((l) => /^update: backup: WARN: /.test(l));
      expect(warning, u.stdout).toHaveLength(1);
      expect(warning[0]).toContain(`left out ${FRAGMENT.length} bytes (sha256 ${sha(FRAGMENT)})`);
      expect(warning[0], 'redacted like every update-family path').toContain('~/ccrc-backups/');
      expect(warning[0]).not.toContain(home);
      expect(existsSync(join(home, 'ccrc', 'ccd', 'ccrc-doctor-checks')), 'the new tree was installed').toBe(true);
    });

    it('a journal that is CORRUPT, not merely torn, still stops the backup and the update before anything is installed', () => {
      const bad = Buffer.concat([Buffer.from(WHOLE.toString('utf8').replace(RECORD.digest, '0'.repeat(64))), FRAGMENT]);
      const home = freshUpdateBox('ccrc-fx-8c-corrupt-');
      plantOldBox(home, { version: 'v1.0.0' });
      plantJournal(home, bad);
      const r = runBackup(home);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/the coordination snapshot failed — refusing to install with an incomplete backup/);
      expect(r.stderr).toMatch(/digest-mismatch/);
      expect(r.stdout).not.toMatch(/WARN: left out/);
      const home2 = freshUpdateBox('ccrc-fx-8c-corrupt-update-');
      plantOldBox(home2, { version: 'v1.0.0' });
      plantCoordDb(home2);
      plantJournal(home2, bad);
      packRelease(home2, fullTree(home2, { version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000' }), { tag: 'v2.0.0' });
      const u = runUpdate(home2);
      expect(u.code).toBe(1);
      expect(existsSync(join(home2, 'ccrc', 'server', 'OLD-MARKER')), 'the old tree must still be in place').toBe(true);
    });
  });

  it('the backup set and its listing never carry the sidecars: no row of `_upd_backup_set` or `_upd_backup_pairs` names them', () => {
    const home = freshUpdateBox('ccrc-fx-8b-pairs-');
    plantOldBox(home, { version: 'v1.0.0' });
    const pairs = sourcedCcrc(home, '_upd_backup_pairs');
    expect(pairs.code, pairs.stderr).toBe(0);
    expect(pairs.stdout.split('\n').filter(Boolean).length).toBeGreaterThan(8);
    expect(pairs.stdout).not.toMatch(/delegation|coordination|coord\.db/);
    const src = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    const set = /^_upd_backup_set\(\) \{[\s\S]*?\n\}$/m.exec(src)![0];
    expect(set).not.toMatch(/delegation|coordination|coord\.db/);
  });

  it('arm 3 of the restore never puts old sidecars over live ones: a record the server wrote during the update survives the revert (W3-M31)', () => {
    const home = freshUpdateBox('ccrc-fx-8b-arm3-');
    plantRestoreBox(home, {
      child: 'broken',
      onInstall: [
        // What a running server does while an update installs: it journals and checkpoints again.
        'printf \'a journal the server wrote during the update\\n\' > "$HOME/.ccrc/delegation-events.log"',
        'cp "$HOME/fixture-newer-checkpoint" "$HOME/.ccrc/delegation-checkpoint.json"',
      ],
    });
    plantCoordDb(home);
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    plantLiveCheckpoint(home, CP_REV1);
    writeFileSync(join(home, 'fixture-newer-checkpoint'), CP_REV2);
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 3\): copied the pre-update backup back/m);
    // The backup holds the OLD checkpoint (revision 1); the live files are what the server wrote after it, and arm 3 left them alone.
    const backup = announcedBackupDir(r.stdout, home);
    expect(readFileSync(join(backup, 'delegation-checkpoint.json'))).toEqual(Buffer.from(CP_REV1));
    expect(readFileSync(join(home, '.ccrc', 'delegation-checkpoint.json'))).toEqual(Buffer.from(CP_REV2));
    expect(readFileSync(join(home, '.ccrc', 'delegation-events.log'), 'utf8')).toBe('a journal the server wrote during the update\n');
  });

  describe('retention: four independent keep sets, decided by the classifier (W3-M28, W3-M39)', () => {
    const backupHome = (prefix: string): string => {
      const home = freshUpdateBox(prefix);
      plantOldBox(home, { version: 'v1.0.0' });
      return home;
    };
    const has = (home: string, name: string): boolean => existsSync(join(backupRoot(home), name));

    it('a valid sidecar snapshot with NO coord.db is kept as the newest earlier snapshot (W3-M28)', () => {
      const home = backupHome('ccrc-fx-8b-keep-sidecars-');
      plantDir(home, '20250101-000000', 'plain');
      plantDir(home, '20250102-000000', 'v1-sidecars');
      expect(existsSync(join(backupRoot(home), '20250102-000000', 'coord.db'))).toBe(false);
      plantDir(home, '20250103-000000', 'plain');
      const r = runBackup(home, [], { CCRC_BACKUP_KEEP: '0' });
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(has(home, '20250102-000000'), 'the valid sidecar snapshot').toBe(true);
      expect(has(home, '20250101-000000')).toBe(false);
      expect(has(home, '20250103-000000')).toBe(false);
      expect(existsSync(ownDir(r))).toBe(true);
    });

    it('through `ccrc update`'+"'"+'s own prune (_bak_gc) too', () => {
      const home = backupHome('ccrc-fx-8b-keep-update-');
      packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
      plantDir(home, '20250101-000000', 'plain');
      plantDir(home, '20250102-000000', 'v1-sidecars');
      plantDir(home, '20250103-000000', 'plain');
      const r = runUpdate(home, [], { CCRC_BACKUP_KEEP: '0' });
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(has(home, '20250102-000000'), 'the valid sidecar snapshot').toBe(true);
      expect(has(home, '20250101-000000')).toBe(false);
      expect(has(home, '20250103-000000')).toBe(false);
    });

    it('the snapshot keep and the tree keep are independent: a tree-only dir and a snapshot-only dir are BOTH kept (W3-M39)', () => {
      const home = backupHome('ccrc-fx-8b-keep-indep-');
      plantDir(home, '20250101-000000', 'tree');
      plantDir(home, '20250102-000000', 'v1-sidecars');
      plantDir(home, '20250103-000000', 'plain');
      const r = runBackup(home, [], { CCRC_BACKUP_KEEP: '0' });
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(has(home, '20250101-000000'), 'the newest earlier tree backup').toBe(true);
      expect(has(home, '20250102-000000'), 'the newest earlier valid coordination snapshot').toBe(true);
      expect(has(home, '20250103-000000')).toBe(false);
    });

    it('a dir that is both the newest tree backup and the newest snapshot keeps itself ONCE, and an older tree-only dir is not kept on its account', () => {
      const home = backupHome('ccrc-fx-8b-keep-both-');
      plantDir(home, '20250101-000000', 'tree');
      plantDir(home, '20250102-000000', 'tree+v1');
      const r = runBackup(home, [], { CCRC_BACKUP_KEEP: '0' });
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(has(home, '20250102-000000')).toBe(true);
      expect(has(home, '20250101-000000')).toBe(false);
    });

    it('the newest-N keep and the current operation\'s dir are also independent of both: KEEP=2 keeps the newest two timestamps whatever they hold', () => {
      const home = backupHome('ccrc-fx-8b-keep-n-');
      for (const n of ['20250101', '20250102', '20250103', '20250104']) plantDir(home, `${n}-000000`, 'plain');
      plantDir(home, '20250100-000000', 'v1-sidecars');
      plantDir(home, '20241231-000000', 'tree');
      const r = runBackup(home, [], { CCRC_BACKUP_KEEP: '2' });
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      // Of the seven dirs (six planted + this run's), the newest two by count are this run's and 20250104; the snapshot and the tree keep add two more.
      expect(has(home, '20250104-000000')).toBe(true);
      expect(has(home, '20250100-000000'), 'the newest earlier valid snapshot').toBe(true);
      expect(has(home, '20241231-000000'), 'the newest earlier tree backup').toBe(true);
      for (const n of ['20250101', '20250102', '20250103']) expect(has(home, `${n}-000000`), n).toBe(false);
    });

    it('an INVALID manifest never counts as a snapshot, whatever healthy DB sits beside it: the older valid one is the keep', () => {
      const home = backupHome('ccrc-fx-8b-keep-invalid-');
      plantDir(home, '20250101-000000', 'v1-sidecars');
      plantDir(home, '20250102-000000', 'invalid');
      const r = runBackup(home, [], { CCRC_BACKUP_KEEP: '0' });
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(has(home, '20250101-000000'), 'the older VALID snapshot').toBe(true);
      expect(has(home, '20250102-000000'), 'an invalid snapshot is not kept as one').toBe(false);
    });

    it('a manifest-less dir with a healthy DB (legacy) is a snapshot too', () => {
      const home = backupHome('ccrc-fx-8b-keep-legacy-');
      plantDir(home, '20250101-000000', 'legacy-db');
      plantDir(home, '20250102-000000', 'plain');
      const r = runBackup(home, [], { CCRC_BACKUP_KEEP: '0' });
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(has(home, '20250101-000000')).toBe(true);
      expect(has(home, '20250102-000000')).toBe(false);
    });

    it('a classifier FAILURE deletes nothing and warns, in both pruners', () => {
      const home = backupHome('ccrc-fx-8b-keep-fail-');
      plantDir(home, '20250101-000000', 'plain');
      plantDir(home, '20250102-000000', 'v1-sidecars');
      plantDir(home, '20250103-000000', 'plain');
      const r = runBackup(home, [], withShim(home, { CCRC_BACKUP_KEEP: '0', FX_CLASSIFY_FAIL: '1' }));
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(r.stdout).toMatch(/^backup: prune skipped — the coordination snapshot classifier failed/m);
      for (const n of ['20250101-000000', '20250102-000000', '20250103-000000']) expect(has(home, n), n).toBe(true);
      expect(r.stdout).not.toMatch(/^backup: pruned/m);

      const home2 = backupHome('ccrc-fx-8b-keep-fail-update-');
      packRelease(home2, stubTree(home2, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
      plantDir(home2, '20250101-000000', 'plain');
      plantDir(home2, '20250102-000000', 'v1-sidecars');
      const u = runUpdate(home2, [], withShim(home2, { CCRC_BACKUP_KEEP: '0', FX_CLASSIFY_FAIL: '1' }));
      expect(u.code, `stderr: ${u.stderr}\nstdout: ${u.stdout}`).toBe(0);
      expect(u.stdout).toMatch(/^update: backups: WARN: the coordination snapshot classifier failed/m);
      expect(has(home2, '20250101-000000')).toBe(true);
      expect(has(home2, '20250102-000000')).toBe(true);
    });

    it('a dir with no coordination name at all is not even shown to the classifier', () => {
      const home = backupHome('ccrc-fx-8b-keep-prefilter-');
      plantDir(home, '20250101-000000', 'tree');
      plantDir(home, '20250102-000000', 'plain');
      const r = runBackup(home, [], withShim(home, { CCRC_BACKUP_KEEP: '0' }));
      expect(r.code, `stderr: ${r.stderr}`).toBe(0);
      const classified = nodeOrder(home).filter((l) => l === 'helper validate' || l === 'helper classify');
      expect(classified, 'no dir of this fixture holds a coordination name').toEqual([]);
    });
  });

  describe('retention: the fifth keep set, the newest valid snapshot that HOLDS DATA (D-4641)', () => {
    const home0 = (prefix: string): string => {
      const home = freshUpdateBox(prefix);
      plantOldBox(home, { version: 'v1.0.0' });
      return home;
    };
    const has = (home: string, name: string): boolean => existsSync(join(backupRoot(home), name));

    it('an older data-bearing v1 and a newer EMPTY v1: both are kept (the empty one is the newest valid, the older one the newest with data)', () => {
      const home = home0('ccrc-fx-8b-data-v1-');
      plantDir(home, '20250101-000000', 'v1-sidecars');
      plantDir(home, '20250102-000000', 'v1-empty');
      plantDir(home, '20250103-000000', 'plain');
      const r = runBackup(home, [], { CCRC_BACKUP_KEEP: '0' });
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(has(home, '20250102-000000'), 'the newest valid snapshot, though empty').toBe(true);
      expect(has(home, '20250101-000000'), 'the newest one that holds data').toBe(true);
      expect(has(home, '20250103-000000')).toBe(false);
    });

    it('an older LEGACY snapshot and a newer empty v1: both are kept (P4\'s meaning), through `ccrc update`\'s own prune too', () => {
      const home = home0('ccrc-fx-8b-data-legacy-');
      packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
      plantDir(home, '20250101-000000', 'legacy-db');
      plantDir(home, '20250102-000000', 'v1-empty');
      plantDir(home, '20250103-000000', 'plain');
      const r = runUpdate(home, [], { CCRC_BACKUP_KEEP: '0' });
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(has(home, '20250102-000000')).toBe(true);
      expect(has(home, '20250101-000000'), 'the legacy DB is data').toBe(true);
      expect(has(home, '20250103-000000')).toBe(false);
    });

    it('a newer data-bearing v1 and an older data-bearing v1: only the newer is kept by this set', () => {
      const home = home0('ccrc-fx-8b-data-two-');
      plantDir(home, '20250101-000000', 'v1-sidecars');
      plantDir(home, '20250102-000000', 'v1-sidecars');
      const r = runBackup(home, [], { CCRC_BACKUP_KEEP: '0' });
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(has(home, '20250102-000000')).toBe(true);
      expect(has(home, '20250101-000000')).toBe(false);
    });

    it('several empty snapshots above the data-bearing one: only the newest empty one and the data one survive, and the independent tree keep is unaffected', () => {
      const home = home0('ccrc-fx-8b-data-many-');
      plantDir(home, '20250100-000000', 'tree');
      plantDir(home, '20250101-000000', 'v1-sidecars');
      plantDir(home, '20250102-000000', 'v1-empty');
      plantDir(home, '20250103-000000', 'v1-empty');
      const r = runBackup(home, [], { CCRC_BACKUP_KEEP: '0' });
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(has(home, '20250103-000000'), 'the newest valid').toBe(true);
      expect(has(home, '20250101-000000'), 'the newest with data').toBe(true);
      expect(has(home, '20250100-000000'), 'the newest tree backup').toBe(true);
      expect(has(home, '20250102-000000'), 'an empty snapshot that is neither').toBe(false);
    });

    it('one filter, two pruners (R14(a), D-5318): `ccrc backup` and an update\'s `_bak_gc` leave the IDENTICAL set of planted dirs — own dir, floor, snapshot, data and tree keeps', () => {
      const plant = (home: string): void => {
        plantDir(home, '20250101-000000', 'plain');          // removable
        plantDir(home, '20250102-000000', 'tree');           // the newest earlier tree backup
        plantDir(home, '20250103-000000', 'v1-sidecars');    // the newest earlier snapshot that holds data
        plantDir(home, '20250104-000000', 'v1-empty');       // the newest earlier valid snapshot
        plantDir(home, '20250105-000000', 'plain');          // removable
        plantDir(home, '29991231-000000', 'plain');          // named at or after this run's lock second: the floor keeps it
      };
      const planted = ['20250101-000000', '20250102-000000', '20250103-000000', '20250104-000000', '20250105-000000', '29991231-000000'];
      const left = (home: string): string[] => planted.filter((n) => has(home, n));
      const viaBackup = home0('ccrc-fx-8b-diff-backup-');
      plant(viaBackup);
      const b = runBackup(viaBackup, [], { CCRC_BACKUP_KEEP: '0' });
      expect(b.code, `stderr: ${b.stderr}\nstdout: ${b.stdout}`).toBe(0);
      expect(existsSync(ownDir(b)), 'the backup\'s own dir is kept').toBe(true);
      const viaUpdate = home0('ccrc-fx-8b-diff-update-');
      packRelease(viaUpdate, stubTree(viaUpdate, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
      plant(viaUpdate);
      const u = runUpdate(viaUpdate, [], { CCRC_BACKUP_KEEP: '0' });
      expect(u.code, `stderr: ${u.stderr}\nstdout: ${u.stdout}`).toBe(0);
      expect(existsSync(announcedBackupDir(u.stdout, viaUpdate)), 'the update\'s own backup dir is kept, as the backup\'s is').toBe(true);
      expect(left(viaBackup), 'ccrc backup keeps the three keeps and the floor').toEqual(['20250102-000000', '20250103-000000', '20250104-000000', '29991231-000000']);
      expect(left(viaUpdate), 'an update\'s _bak_gc leaves the same set').toEqual(left(viaBackup));
    });

    it('the prune message names what it kept', () => {
      const home = home0('ccrc-fx-8b-data-msg-');
      packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
      plantDir(home, '20250101-000000', 'plain');
      const r = runUpdate(home, [], { CCRC_BACKUP_KEEP: '0' });
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(r.stdout).toMatch(/the newest earlier tree backup, the newest earlier valid coordination snapshot and the newest earlier one that holds data;/);
      expect(r.stdout).not.toMatch(/the newest earlier coord\.db snapshot/);
    });
  });

  // Wave 23 (centralised update, D-6346 to D-6360): after the prune an update and `ccrc backup` thin the coordination data set of every
  // backup past the newest CCRC_BACKUP_DATA_KEEP that carry one. The helper's own rows are in `coordination-snapshot.test.ts`; these are the
  // CALLER's: the knob, who thins and who does not, the lines, the exits, the report.
  describe('W23: update and ccrc backup thin the data set past CCRC_BACKUP_DATA_KEEP (D-6346, D-6347, D-6350)', () => {
    // Describe-local kill list for the lock holder of B4, the pruner describe's pattern.
    const lingerers: string[] = [];
    afterEach(() => {
      for (const f of lingerers.splice(0)) {
        if (!existsSync(f)) continue;
        const pid = Number(readFileSync(f, 'utf8').trim());
        if (!Number.isInteger(pid) || pid <= 1) continue;
        try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
      }
    });
    const NAMES = ['20250101-000000', '20250102-000000', '20250103-000000', '20250104-000000', '20250105-000000'];
    /** A box whose update or backup takes a data-bearing backup of its own: a database and a checkpoint to capture. */
    const box = (prefix: string): string => {
      const home = freshUpdateBox(prefix);
      plantOldBox(home, { version: 'v1.0.0' });
      plantCoordDb(home);
      plantLiveCheckpoint(home);
      return home;
    };
    const dirOf = (home: string, name: string): string => join(backupRoot(home), name);
    const word = (home: string, name: string): string => helper(home, ['classify', '--from', dirOf(home, name)]).stdout.trim();
    const listing = (home: string, name: string): string[] => readdirSync(dirOf(home, name)).sort();
    const recordOf = (home: string, name: string): Record<string, unknown> =>
      JSON.parse(readFileSync(join(dirOf(home, name), 'coordination-thinned.json'), 'utf8'));
    /** Every entry of the named dirs, a file by its content digest: what "byte-identical" compares. */
    const fingerprint = (home: string, names: string[]): Record<string, string[]> =>
      Object.fromEntries(names.map((n) => [n, readdirSync(dirOf(home, n), { recursive: true, encoding: 'utf8' }).sort().map((f) => {
        const p = join(dirOf(home, n), f);
        return statSync(p).isFile() ? `${f}:${createHash('sha256').update(readFileSync(p)).digest('hex')}` : `${f}/`;
      })]));
    const plantFull = (home: string, names: string[] = NAMES): void => { for (const n of names) plantDir(home, n, 'tree+v1-full'); };
    /** The line `thin` prints for a dir it thinned, led by `lead`. */
    const thinLine = (lead: string, name: string, keep = 3): RegExp => new RegExp(
      `^${lead} thinned ${name}: dropped its coordination data set \\(\\d+M: coord\\.db, delegation-events\\.log, delegation-checkpoint\\.json, coordination-snapshot\\.json\\); `
      + `its code is kept, and coordination-thinned\\.json records when and why \\(CCRC_BACKUP_DATA_KEEP=${keep}\\)$`, 'm');
    /** A REAL thinned dir at `name`: three full captures thinned at a keep of 2 in a scratch box, the oldest copied in. */
    const plantThinned = (home: string, name: string): void => {
      const t = mkTmp('ccrc-fx-w23-thinned-');
      for (const n of ['30000101-000001', '30000101-000002', '30000101-000003']) plantDir(t, n, 'tree+v1-full');
      const r = helper(t, ['thin', '--keep', '2', '--by', 'backup', '--own', dirOf(t, '30000101-000003'), '--dir', dirOf(t, '30000101-000002'), '--dir', dirOf(t, '30000101-000001')]);
      expect(r.code, `${r.stderr}\n${r.stdout}`).toBe(0);
      cpSync(dirOf(t, '30000101-000001'), dirOf(home, name), { recursive: true });
      expect(listing(home, name)).toEqual(['agent-dist', 'coordination-thinned.json']);
    };
    /** The checkout's ccrc (or another file) sourced, then `script`, in the fixture box's environment; `timeout` (ms) bounds a row a hang must fail. */
    const sourced = (home: string, script: string, env: NodeJS.ProcessEnv = {}, ccrc: string = join(REPO, 'ccd', 'ccrc'), timeout?: number): Result => {
      const r = spawnSync(BASH, ['-c', `. "$1"; ${script}`, 'ccrc-under-test', ccrc], { env: { ...updateEnv(home), ...env }, encoding: 'utf8', timeout });
      return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    };
    const stubUpdate = (home: string): void => { packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' }); };

    it('W23-B1: ccrc backup with five earlier full dirs and the default keeps three data sets (its own and the two newest earlier) and thins the other three, code kept, one line each, by backup', () => {
      const home = box('ccrc-fx-w23-b1-');
      plantFull(home);
      const r = runBackup(home);
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      const thinned = ['20250103-000000', '20250102-000000', '20250101-000000'];
      for (const n of thinned) {
        expect(listing(home, n), n).toEqual(['agent-dist', 'coordination-thinned.json']);
        expect(recordOf(home, n), n).toMatchObject({ by: 'backup', rule: { knob: 'CCRC_BACKUP_DATA_KEEP', keep: 3 }, source: 'v1' });
        expect(r.stdout, n).toMatch(thinLine('backup:', n));
      }
      const at = thinned.map((n) => r.stdout.indexOf(`backup: thinned ${n}:`));
      expect(at, 'newest first').toEqual([...at].sort((a, b) => a - b));
      expect(r.stdout).toMatch(/^backup: coordination data sets: 3 kept, 3 thinned this run, 0 left as they are$/m);
      for (const n of ['20250105-000000', '20250104-000000']) expect(helper(home, ['validate', '--from', dirOf(home, n)]).stdout, n).toMatch(/^v1: /);
      expect(word(home, path.basename(ownDir(r))), 'this run\'s own').toBe('v1');
    });

    it('W23-B2: an update whose gate passes thins the same way, after its prune, under update: backups:, and its records say by update', () => {
      const home = box('ccrc-fx-w23-b2-');
      stubUpdate(home);
      plantFull(home);
      const r = runUpdate(home);
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      for (const n of ['20250103-000000', '20250102-000000', '20250101-000000']) {
        expect(listing(home, n), n).toEqual(['agent-dist', 'coordination-thinned.json']);
        expect(recordOf(home, n), n).toMatchObject({ by: 'update', rule: { keep: 3 } });
        expect(r.stdout, n).toMatch(thinLine('update: backups:', n));
      }
      expect(r.stdout).toMatch(/^update: backups: coordination data sets: 3 kept, 3 thinned this run, 0 left as they are$/m);
      expect(word(home, '20250105-000000')).toBe('v1');
      expect(word(home, '20250104-000000')).toBe('v1');
      expect(word(home, path.basename(announcedBackupDir(r.stdout, home))), 'this run\'s own').toBe('v1');
    });

    it('W23-B3: a CCRC_BACKUP_DATA_KEEP of 0, 1, 00, 10000, x or ٣ refuses: an update WARNs and thins nothing, and its count prune runs; ccrc backup says so after its backup, prunes by count and exits 1 (D-6590)', () => {
      const four = NAMES.slice(0, 4);
      // At CCRC_BACKUP_KEEP=0 the count prune removes the three older dirs; the newest earlier one is the keep-set's (tree, snapshot, data).
      const [older, kept] = [four.slice(0, 3), ['20250104-000000']];
      const home = box('ccrc-fx-w23-b3-update-');
      stubUpdate(home);
      plantFull(home, four);
      const before = fingerprint(home, kept);
      const u = runUpdate(home, [], { CCRC_BACKUP_DATA_KEEP: '1', CCRC_BACKUP_KEEP: '0' });
      expect(u.code, `stderr: ${u.stderr}\nstdout: ${u.stdout}`).toBe(0);
      expect(u.stdout).toMatch(/^update: backups: WARN: CCRC_BACKUP_DATA_KEEP='1' is not a whole number from 2 to 9999, as set in the environment — nothing thinned$/m);
      expect(u.stdout).not.toMatch(/^update: backups: thinned/m);
      for (const n of older) expect(u.stdout, n).toMatch(new RegExp(`^update: backups: pruned \\$HOME/ccrc-backups/${n} `, 'm'));
      for (const n of older) expect(existsSync(dirOf(home, n)), n).toBe(false);
      expect(fingerprint(home, kept), 'the keep-set\'s dir is byte-identical').toEqual(before);
      for (const v of ['0', '1', '00', '10000', 'x', '٣']) {
        const h = box('ccrc-fx-w23-b3-backup-');
        plantFull(h, four);
        const b4 = fingerprint(h, kept);
        const r = runBackup(h, [], { CCRC_BACKUP_DATA_KEEP: v, CCRC_BACKUP_KEEP: '0' });
        expect(r.code, `${v}: stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
        expect(r.stderr, v).toMatch(/^ccrc: CCRC_BACKUP_DATA_KEEP='[^']*' is not a whole number from 2 to 9999, as set in the environment — nothing was thinned$/m);
        expect(r.stdout, v).toMatch(/^backup: \S+/m);
        expect(r.stdout, v).not.toMatch(/^backup: thinned/m);
        expect(readdirSync(backupRoot(h)).sort(), `${v}: the backup was taken first, then the count prune ran`).toEqual([...kept, path.basename(ownDir(r))]);
        expect(fingerprint(h, kept), v).toEqual(b4);
      }
    });

    itLinux('W23-B4: a failed gate (exit 4), --no-gate, a --from restore child and another holder of update.lock thin nothing', () => {
      const expectUntouched = (home: string, before: Record<string, string[]>, out: string, by: string): void => {
        expect(fingerprint(home, NAMES), by).toEqual(before);
        expect(out, by).not.toMatch(/thinned|thinning|coordination data sets/);
      };
      // The failed gate: P5's box.
      const g = freshUpdateBox('ccrc-fx-w23-b4-gate-');
      plantRestoreBox(g);
      plantFull(g);
      const gBefore = fingerprint(g, NAMES);
      const gr = runUpdate(g);
      expect(gr.code, `stderr: ${gr.stderr}\nstdout: ${gr.stdout}`).toBe(4);
      expectUntouched(g, gBefore, gr.stdout, 'failed gate');
      // --no-gate: P6's.
      const n = freshUpdateBox('ccrc-fx-w23-b4-nogate-');
      plantOldBox(n, { version: 'v1.0.0' });
      stubUpdate(n);
      plantFull(n);
      const nBefore = fingerprint(n, NAMES);
      const nr = runUpdate(n, ['--no-gate']);
      expect(nr.code, `stderr: ${nr.stderr}\nstdout: ${nr.stdout}`).toBe(0);
      expectUntouched(n, nBefore, nr.stdout, '--no-gate');
      // Another holder of update.lock at prune time: P12's.
      const l = freshUpdateBox('ccrc-fx-w23-b4-lock-');
      plantOldBox(l, { version: 'v1.0.0' });
      stubUpdate(l);
      plantKillModeDropIn(l);
      writeFileSync(join(l, 'fixture-sweep-hold-lock'), '');
      plantFull(l);
      const lBefore = fingerprint(l, NAMES);
      const lr = runUpdate(l);
      lingerers.push(join(l, 'sweep-lock-holder-pid'));
      expect(lr.code, `stderr: ${lr.stderr}\nstdout: ${lr.stdout}`).toBe(0);
      expect(lr.stdout).toMatch(/^update: backups: skipped — another ccrc run holds ~\/\.ccrc\/update\.lock; nothing was pruned$/m);
      expectUntouched(l, lBefore, lr.stdout, 'lock holder');
      // The arm-2 child: a REAL `ccrc update --no-gate --from restore` under the parent's lock (the FULL-flavour arm-2 box).
      const c = freshUpdateBox('ccrc-fx-w23-b4-child-');
      plantOldBox(c, { version: 'v1.0.0' });
      writeFileSync(join(c, '.ccrc', 'installed'), `${OLD_SHA}\n`);
      packRelease(c, stubTree(c, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
      packRelease(c, fullTree(c, { version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000' }), { tag: 'v2.0.0' });
      writeFileSync(join(c, 'fixture-health-pin'), 'v1.0.0\n');
      plantFull(c);
      const cBefore = fingerprint(c, NAMES);
      const cr = runUpdate(c);
      expect(cr.code, `stderr: ${cr.stderr}\nstdout: ${cr.stdout}`).toBe(4);
      expect(cr.stdout, 'the child really ran').toMatch(/^update: sweep: skipped — a --from restore run returns the supervisors' own build/m);
      expectUntouched(c, cBefore, cr.stdout, 'restore child');
    }, 240_000);

    it('W23-B5: a dir named at or after this run\'s lock second is neither counted nor thinned', () => {
      const home = box('ccrc-fx-w23-b5-');
      plantFull(home, ['20250101-000000', '20250102-000000', '20250103-000000', '20250110-000001', '29991231-000000']);
      const r = sourced(home, [
        'R="$HOME/ccrc-backups"',
        'UPD_BAK_FLOOR=20250110-000000; UPD_BACKUP_DIR="$R/20250110-000001"',
        'CCRC_BACKUP_DATA_KEEP=2; _bak_data_keep || { echo "knob: $BAK_DATA_KEEP_WHY"; exit 1; }',
        '_bak_list; _bak_keepset; echo "keepset rc $?"',
        '_bak_thin backup "row:"; echo "rc $?"',
      ].join('\n'));
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(r.stdout).toMatch(/^keepset rc 0$/m);
      expect(r.stdout).toMatch(thinLine('row:', '20250102-000000', 2));
      expect(r.stdout).toMatch(thinLine('row:', '20250101-000000', 2));
      expect(r.stdout).toMatch(/^row: coordination data sets: 2 kept, 2 thinned this run, 0 left as they are$/m);
      expect(r.stdout).toMatch(/^rc 0$/m);
      for (const n of ['29991231-000000', '20250110-000001', '20250103-000000']) expect(word(home, n), n).toBe('v1');
      for (const n of ['20250102-000000', '20250101-000000']) expect(word(home, n), n).toBe('thinned');
    });

    it('W23-B6: own named below an earlier full dir (a clock stepped back) is still counted first', () => {
      const home = box('ccrc-fx-w23-b6-');
      plantFull(home, ['20250101-000000', '20250105-000000', '20250106-000000', '20250107-000000']);
      const r = sourced(home, [
        'R="$HOME/ccrc-backups"',
        'UPD_BAK_FLOOR=20250110-000000; UPD_BACKUP_DIR="$R/20250101-000000"',
        'CCRC_BACKUP_DATA_KEEP=2; _bak_data_keep || exit 1',
        '_bak_list; _bak_keepset; _bak_thin backup "row:"; echo "rc $?"',
      ].join('\n'));
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(r.stdout).toMatch(/^rc 0$/m);
      for (const n of ['20250101-000000', '20250107-000000']) expect(word(home, n), `${n} stays`).toBe('v1');
      for (const n of ['20250105-000000', '20250106-000000']) expect(word(home, n), `${n} is thinned`).toBe('thinned');
    });

    it('W23-B7: the classifier failing stops the prune and the thinning alike', () => {
      const home = box('ccrc-fx-w23-b7-');
      plantFull(home);
      const before = fingerprint(home, NAMES);
      const r = runBackup(home, [], withShim(home, { FX_CLASSIFY_FAIL: '1' }));
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(r.stdout).toMatch(/^backup: prune skipped — the coordination snapshot classifier failed/m);
      expect(r.stdout).not.toMatch(/thinned|thinning/);
      expect(nodeOrder(home)).not.toContain('helper thin');
      expect(fingerprint(home, NAMES)).toEqual(before);
    });

    it('W23-B8: a thinned dir is never a snapshot keep: the next prune treats it as a code-only dir', () => {
      const home = box('ccrc-fx-w23-b8-');
      for (const n of ['20250101-000000', '20250102-000000', '20250103-000000']) plantThinned(home, n);
      const r = runBackup(home, [], { CCRC_BACKUP_KEEP: '0' });
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(existsSync(dirOf(home, '20250103-000000')), 'the newest earlier tree backup is kept by the tree keep').toBe(true);
      expect(existsSync(dirOf(home, '20250102-000000'))).toBe(false);
      expect(existsSync(dirOf(home, '20250101-000000'))).toBe(false);
      expect(r.stdout).not.toMatch(/thinned|WARN/);
    });

    it('W23-B9: the helper failing (exit 70) or missing from the tree is one WARN line each, worded apart, and the run\'s exit is unchanged', () => {
      const home = box('ccrc-fx-w23-b9-');
      stubUpdate(home);
      plantFull(home);
      const u = runUpdate(home, [], withShim(home, { FX_THIN_EXIT: '70' }));
      expect(u.code, `stderr: ${u.stderr}\nstdout: ${u.stdout}`).toBe(0);
      expect(u.stdout).toMatch(/^update: backups: WARN: the coordination data set could not be thinned \(the helper exited 70\) — every backup it had not reached is untouched$/m);
      for (const n of NAMES) expect(word(home, n), n).toBe('v1');
      // The helper missing from the running tree. Only thinned dirs below the floor: a full one would stop `_bak_keepset`'s classifier first (B7's arm).
      const h = freshUpdateBox('ccrc-fx-w23-b9-missing-');
      plantOldBox(h, { version: 'v1.0.0' });
      for (const n of ['20250101-000000', '20250102-000000']) plantThinned(h, n);
      const tree = join(h, 'older-tree', 'ccd');
      mkdirSync(tree, { recursive: true });
      copyFileSync(join(REPO, 'ccd', 'ccrc'), join(tree, 'ccrc'));
      expect(existsSync(join(h, 'older-tree', 'deploy'))).toBe(false);
      const m = sourced(h, 'UPD_BAK_FLOOR=20300101-000000; UPD_BACKUP_DIR=""; _bak_gc update; echo "rc $?"', {}, join(tree, 'ccrc'));
      expect(m.code, `stderr: ${m.stderr}\nstdout: ${m.stdout}`).toBe(0);
      expect(m.stdout).toMatch(/^update: backups: WARN: deploy\/coordination-snapshot\.mjs is missing from this tree, so nothing was thinned$/m);
      expect(m.stdout).not.toMatch(/could not be thinned|thinning skipped/);
      expect(m.stdout).toMatch(/^rc 1$/m);
    });

    it('W23-B10: thin refusing (exit 3) makes _bak_gc return 1 with no WARN of its own, and the prune lines are unchanged', () => {
      const run = (thinExit: string): Result => {
        const home = box(`ccrc-fx-w23-b10-${thinExit}-`);
        plantDir(home, '20250101-000000', 'plain');
        plantFull(home, ['20250102-000000', '20250103-000000', '20250104-000000']);
        return sourced(home, 'UPD_BAK_FLOOR=20300101-000000; UPD_BACKUP_DIR=""; _bak_gc update; echo "rc $?"',
          { ...withShim(home, { FX_THIN_EXIT: thinExit }), CCRC_BACKUP_KEEP: '3', CCRC_BACKUP_DATA_KEEP: '2' });
      };
      const refused = run('3');
      const quiet = run('0');
      expect(refused.code, `stderr: ${refused.stderr}\nstdout: ${refused.stdout}`).toBe(0);
      expect(refused.stdout).toMatch(/^rc 1$/m);
      expect(quiet.stdout).toMatch(/^rc 0$/m);
      expect(refused.stdout).not.toMatch(/could not be thinned|WARN/);
      const pruned = (r: Result): string[] => r.stdout.split('\n').filter((l) => /^update: backups: pruned /.test(l));
      expect(pruned(refused)).toHaveLength(1);
      expect(pruned(refused)).toEqual(pruned(quiet));
    });

    it('W23-B11: a ccrc backup inside an update\'s unlocked sweep keeps that update\'s pre-update backup at the lowest keep', () => {
      const home = box('ccrc-fx-w23-b11-');
      plantFull(home, ['20250101-000000', '20250102-000000', '20250103-000000', '20250104-000000']);
      // The update's report, as the sweep leaves it: another process's, `restarting`.
      const report = '{"target":"v9.9.9","phase":"restarting","startedAt":1,"updatedAt":1,"detail":null,"from":"cli","pid":999999}\n';
      writeFileSync(join(home, '.ccrc', 'update.json'), report);
      const r = runBackup(home, [], { CCRC_BACKUP_DATA_KEEP: '2' });
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(word(home, '20250104-000000'), 'the update\'s own pre-update backup is the newest earlier data set, so it is counted').toBe('v1');
      for (const n of ['20250101-000000', '20250102-000000', '20250103-000000']) expect(word(home, n), n).toBe('thinned');
      expect(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8'), 'a backup writes no report').toBe(report);
    });

    it('W23-B12: the knob set only in ~/.ccrc/ccrc.env is honoured: 9999 thins nothing, and 1 there is refused like 1 in the environment', () => {
      const four = NAMES.slice(0, 4);
      const home = box('ccrc-fx-w23-b12-big-');
      plantFull(home, four);
      writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_BACKUP_DATA_KEEP=9999\n');
      const r = runBackup(home);
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(r.stdout).not.toMatch(/thinned|thinning/);
      for (const n of four) expect(word(home, n), n).toBe('v1');
      const bad = box('ccrc-fx-w23-b12-one-');
      plantFull(bad, four);
      writeFileSync(join(bad, '.ccrc', 'ccrc.env'), 'CCRC_BACKUP_DATA_KEEP=1\n');
      const b = runBackup(bad);
      expect(b.code, `stderr: ${b.stderr}\nstdout: ${b.stdout}`).toBe(1);
      expect(b.stderr).toMatch(/^ccrc: CCRC_BACKUP_DATA_KEEP='1' is not a whole number from 2 to 9999, as set in the box's ccrc.env — nothing was thinned$/m);
      // The process environment wins over the file.
      const e = box('ccrc-fx-w23-b12-env-');
      plantFull(e, four);
      writeFileSync(join(e, '.ccrc', 'ccrc.env'), 'CCRC_BACKUP_DATA_KEEP=1\n');
      const er = runBackup(e, [], { CCRC_BACKUP_DATA_KEEP: '9999' });
      expect(er.code, `stderr: ${er.stderr}\nstdout: ${er.stdout}`).toBe(0);
      expect(er.stdout).not.toMatch(/thinned|thinning/);
    });

    it('W23-B13: a rollback by flip never thins, and _bak_thin reads a helper that predates thinning by name: one skipped line, rc 0, no WARN', () => {
      const home = box('ccrc-fx-w23-b13-');
      plantFull(home);
      const before = fingerprint(home, NAMES);
      const g = sourced(home, 'UPD_BAK_FLOOR=20300101-000000; UPD_BACKUP_DIR=""; _bak_gc rollback; echo "rc $?"', { CCRC_BACKUP_DATA_KEEP: '2' });
      expect(g.code, `stderr: ${g.stderr}\nstdout: ${g.stdout}`).toBe(0);
      expect(g.stdout).not.toMatch(/thinned|thinning/);
      expect(fingerprint(home, NAMES), 'a rollback touched no data set').toEqual(before);
      // A tree whose helper has no `thin`: a stub that is not the real one.
      const tree = join(home, 'older-tree');
      mkdirSync(join(tree, 'ccd'), { recursive: true });
      mkdirSync(join(tree, 'deploy'), { recursive: true });
      copyFileSync(join(REPO, 'ccd', 'ccrc'), join(tree, 'ccd', 'ccrc'));
      writeFileSync(join(tree, 'deploy', 'coordination-snapshot.mjs'), '// a helper from before thinning\n');
      const s = sourced(home, [
        'UPD_BAK_FLOOR=20300101-000000; UPD_BACKUP_DIR=""; BAK_KEEP_DATA=""; CCRC_BACKUP_DATA_KEEP=2',
        '_bak_data_keep || exit 1; _bak_list; _bak_thin update "update: backups:"; echo "rc $?"',
      ].join('\n'), {}, join(tree, 'ccd', 'ccrc'));
      expect(s.code, `stderr: ${s.stderr}\nstdout: ${s.stdout}`).toBe(0);
      expect(s.stdout).toBe('update: backups: thinning skipped — this tree\'s coordination-snapshot helper predates it; nothing was thinned\nrc 0\n');
      expect(fingerprint(home, NAMES)).toEqual(before);
    });

    it('W23-B14: on a downgrade, a thinned own backup is reported as thinned, never as one that held no coord.db', () => {
      const home = box('ccrc-fx-w23-b14-');
      const run = (setup: (dir: string) => void): Result => {
        const dir = join(home, 'own-backup');
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(join(dir, 'agent-dist'), { recursive: true });
        setup(dir);
        return sourced(home, `UPD_VERSION=v1.0.0; UPD_BACKUP_DIR="${dir}"; _upd_report "old" "v2.0.0"`);
      };
      const thinned = run((d) => writeFileSync(join(d, 'coordination-thinned.json'), '{}\n'));
      expect(thinned.code, `stderr: ${thinned.stderr}`).toBe(0);
      expect(thinned.stdout).toMatch(/^update: rollback:   \(this run's backup no longer holds coord\.db: a later ccrc run thinned it; 'ccrc coordination-snapshot validate --from \S+' says when and by which verb — restore from a backup that still carries one\)$/m);
      expect(thinned.stdout).not.toContain('(no coord.db existed before this run');
      const neither = run(() => undefined);
      expect(neither.stdout).toMatch(/^update: rollback:   \(no coord\.db existed before this run — there is nothing to restore\)$/m);
      expect(neither.stdout).not.toContain('no longer holds coord.db');
    });

    itLinux('W23-B15: a completed update re-stamps its report as restarting, pruning and thinning, before _bak_gc runs; a report another pid wrote is not re-stamped', () => {
      const home = box('ccrc-fx-w23-b15-');
      stubUpdate(home);
      plantFull(home, ['20250101-000000']);
      const r = runUpdate(home, [], withShim(home));
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      const saw = JSON.parse(readFileSync(join(home, 'thin-saw-update.json'), 'utf8')) as Record<string, unknown>;
      expect(saw['phase']).toBe('restarting');
      expect(saw['detail']).toBe('pruning and thinning ~/ccrc-backups');
      expect(Number(saw['updatedAt'])).toBeGreaterThanOrEqual(Number(saw['startedAt']));
      // A foreign report written mid-sweep (the sweep describe's knob) is left as it is.
      const f = box('ccrc-fx-w23-b15-foreign-');
      stubUpdate(f);
      plantKillModeDropIn(f);
      writeFileSync(join(f, 'fixture-sweep-units'), UNIT_LINES);
      writeFileSync(join(f, 'fixture-sweep-active'), UNIT_LINES);
      writeFileSync(join(f, 'fixture-sweep-foreign-report'), 'yes\n');
      plantFull(f, ['20250101-000000']);
      const fr = runUpdate(f, [], withShim(f));
      expect(fr.code, `stderr: ${fr.stderr}\nstdout: ${fr.stdout}`).toBe(0);
      const fsaw = JSON.parse(readFileSync(join(f, 'thin-saw-update.json'), 'utf8')) as Record<string, unknown>;
      expect(fsaw).toEqual({ target: 'v9.9.9', phase: 'resolving', startedAt: 1, updatedAt: 1, detail: null, from: 'cli', pid: 999999 });
    });

    itLinux('W23-B19: thin runs while this run holds ~/.ccrc/update.lock, for an update and for ccrc backup (review 794, F11)', () => {
      const u = box('ccrc-fx-w23-b19-update-');
      stubUpdate(u);
      plantFull(u, ['20250101-000000']);
      const r = runUpdate(u, [], withShim(u));
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(readFileSync(join(u, 'thin-lock-state'), 'utf8'), 'the update thins under its lock').toBe('held\n');
      const b = box('ccrc-fx-w23-b19-backup-');
      plantFull(b, ['20250101-000000']);
      const br = runBackup(b, [], withShim(b));
      expect(br.code, `stderr: ${br.stderr}\nstdout: ${br.stdout}`).toBe(0);
      expect(readFileSync(join(b, 'thin-lock-state'), 'utf8'), 'ccrc backup thins under its lock').toBe('held\n');
    });

    it('W23-B20: an update passes thin a time budget, the re-stamp\'s own instant plus the deadline less the 235 s margin; ccrc backup passes none (D-6464)', () => {
      /** One update through the shim: the report thin saw, and the `--until` it was given. */
      const update = (prefix: string, extra: NodeJS.ProcessEnv = {}): { saw: { updatedAt: number }; until: number } => {
        const u = box(prefix);
        stubUpdate(u);
        plantFull(u, ['20250101-000000']);
        const r = runUpdate(u, [], withShim(u, { CCRC_UPDATE_DEADLINE_MS: '900000', ...extra }));
        expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
        const saw = JSON.parse(readFileSync(join(u, 'thin-saw-update.json'), 'utf8'));
        expect(saw, 'thin sees the re-stamp').toMatchObject({ phase: 'restarting', detail: 'pruning and thinning ~/ccrc-backups' });
        const args = readFileSync(join(u, 'thin-args'), 'utf8').split('\n');
        expect(args.filter((a) => a === '--until'), 'one bound').toHaveLength(1);
        return { saw, until: Number(args[args.indexOf('--until') + 1]) };
      };
      const plain = update('ccrc-fx-w23-b20-update-');
      expect(plain.until, 'the re-stamp plus 900 s, less 235').toBe(plain.saw.updatedAt + 900 - 235);
      // The instant is the one read back from the report, not the second before it: a read-back that answers otherwise wins.
      expect(update('ccrc-fx-w23-b20-readback-', { FX_JQ_UPDATED_AT: '1700000000' }).until).toBe(1700000000 + 900 - 235);
      // A read-back that is not whole seconds falls back to the second read just before the re-stamp, never later than it.
      const odd = update('ccrc-fx-w23-b20-odd-', { FX_JQ_UPDATED_AT: '1700000000.5' });
      expect(odd.until).toBeLessThanOrEqual(odd.saw.updatedAt + 900 - 235);
      expect(odd.until).toBeGreaterThanOrEqual(odd.saw.updatedAt + 900 - 235 - 5);
      const b = box('ccrc-fx-w23-b20-backup-');
      plantFull(b, ['20250101-000000']);
      const br = runBackup(b, [], withShim(b, { CCRC_UPDATE_DEADLINE_MS: '900000' }));
      expect(br.code, `stderr: ${br.stderr}\nstdout: ${br.stdout}`).toBe(0);
      const bargs = readFileSync(join(b, 'thin-args'), 'utf8').split('\n');
      expect(bargs, 'ccrc backup thins').toContain('thin');
      expect(bargs, 'with no bound').not.toContain('--until');
    });

    it('W23-B16: _bak_thin with an empty or unparsable floor returns 1 and passes nothing', () => {
      for (const floor of ['', 'garbage', '20250110']) {
        const home = box('ccrc-fx-w23-b16-');
        plantFull(home, NAMES.slice(0, 3));
        const r = sourced(home, `UPD_BAK_FLOOR='${floor}'; UPD_BACKUP_DIR=""; BAK_KEEP_DATA=""; CCRC_BACKUP_DATA_KEEP=2; _bak_data_keep; _bak_list; _bak_thin update "x:"; echo "rc $?"`, withShim(home));
        expect(r.code, `${floor}: stderr: ${r.stderr}`).toBe(0);
        expect(r.stdout, floor).toBe('rc 1\n');
        expect(nodeOrder(home), floor).not.toContain('helper thin');
        for (const n of NAMES.slice(0, 3)) expect(word(home, n), `${floor}: ${n}`).toBe('v1');
      }
    });

    it('W23-B17: a ccrc.env line the reader does not take refuses like an invalid value: an export line, a spaced = and a key led by a vertical tab, nothing thinned, the file named and never its bytes (D-6365, D-6590)', () => {
      const four = NAMES.slice(0, 4);
      for (const [tag, text] of [['export', 'export CCRC_BACKUP_DATA_KEEP=9999\n'], ['spaced', 'CCRC_BACKUP_DATA_KEEP = 9999\n'], ['vtab', '\vCCRC_BACKUP_DATA_KEEP=9999\n']] as const) {
        const home = box(`ccrc-fx-w23-b17-${tag}-`);
        plantFull(home, four);
        const before = fingerprint(home, four);
        writeFileSync(join(home, '.ccrc', 'ccrc.env'), text);
        const r = runBackup(home);
        expect(r.code, `${tag}: stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
        expect(r.stderr, tag).toMatch(/^ccrc: CCRC_BACKUP_DATA_KEEP cannot be measured: ~\/\.ccrc\/ccrc\.env names it on a line this reader does not take \(it reads only a plain KEY=value line\) — nothing was thinned$/m);
        expect(r.stdout + r.stderr, `${tag}: the refusal never prints the file's bytes`).not.toContain('9999');
        expect(fingerprint(home, four), `${tag}: no data set was touched`).toEqual(before);
      }
    });

    // D-6365's ONE positive rule (review 806, F1 and F4), asked of `_bak_data_keep` directly, a row per shape on each side.
    const K = 'CCRC_BACKUP_DATA_KEEP';
    const bytes = (...parts: (string | number[])[]): Buffer =>
      Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'utf8') : Buffer.from(p))));
    const REFUSED: readonly (readonly [string, Buffer])[] = [
      ['+=', bytes(`${K}+=9999\n`)],
      [':=', bytes(`${K}:=9999\n`)],
      ['a space before =', bytes(`${K} =9999\n`)],
      ['a tab before =', bytes(`${K}\t=9999\n`)],
      ['a UTF-8 NBSP before =', bytes(`${K} =9999\n`)],
      ['a UTF-8 NBSP lead', bytes(` ${K}=9999\n`)],
      ['a Latin-1 0xA0 lead', bytes([0xa0], `${K}=9999\n`)],
      ['a 0xFF lead', bytes([0xff], `${K}=9999\n`)],
      ['a vertical-tab lead', bytes(`\v${K}=9999\n`)],
      ['an export of the knob', bytes(`export ${K}=9999\n`)],
      ['the bare name with no =', bytes(`${K}\n`)],
      ['an odd line beside a plain one', bytes(`${K}=4\nexport ${K}=9999\n`)],
      // systemd ends a line at a bare CR, so what follows it is a line of its own there (fix round 2's own review).
      ['a bare CR inside another key\'s line', bytes(`FOO=1\r${K}=9999\n`)],
      ['a bare CR inside a comment', bytes(`# note\r${K}=9999\n`)],
      // Every position is tested, not the first occurrence only: systemd reads `${K}=9999` as a line of its own (review 847, R8).
      ['a bare CR after an _OLD key, then the knob', bytes(`${K}_OLD=1\r${K}=9999\n`)],
    ];
    /** Each with the keep it reads: the line's value, or the default 3 where the line is not the knob's. */
    const READ: readonly (readonly [string, Buffer, number])[] = [
      ['a comment naming the knob', bytes(`# ${K}=9999\n`), 3],
      ['a ;-comment naming the knob', bytes(`; ${K}=9999\n`), 3],
      ['the _OLD suffix key', bytes(`${K}_OLD=9999\n`), 3],
      ['an OLD_ prefix key', bytes(`OLD_${K}=9999\n`), 3],
      ['a value that mentions the knob', bytes(`NOTE=see ${K}=4\n`), 3],
      ['an export of another key whose value mentions the knob', bytes(`export NOTE=${K}=4\n`), 3],
      ['CRLF', bytes(`${K}=4\r\n`), 4],
      ['a tab lead', bytes(`\t${K}=4\n`), 4],
      ['a quoted value', bytes(`${K}="4"\n`), 4],
      ['an absent key', bytes('CCRC_BACKUP_KEEP=4\n'), 3],
      // The value is read through the unit model (review 817, F1 and F8): bytes in any locale, trimmed as systemd trims it.
      ['a Latin-1 é in a comment above the knob', bytes('# tuned for the caf', [0xe9], `\n${K}=9\n`), 9],
      ['a trailing space', bytes(`${K}=4 \n`), 4],
      ['a trailing tab', bytes(`${K}=4\t\n`), 4],
      ['a trailing space before CRLF', bytes(`${K}=4 \r\n`), 4],
      // A ccrc.env whose bytes never hold the knob as a whole token cannot set it, so it reads 3 whatever the model or systemd makes of
      // the rest (the coordinator's ruling on review 839): the model is not asked, so none of these stops the prune.
      ['a valid UTF-8 value and no knob', bytes('NOTE=café\n'), 3],
      ['a lone UTF-8 lead byte in a value and no knob', bytes('FOO=', [0xc3], '\n'), 3],
      ['a bare CR inside a comment and no knob', bytes('# a\rb\n'), 3],
      ['a comment ending in two CRs and no knob', bytes('# note\r\r\n'), 3],
      ['a bare CR inside a value and no knob', bytes('FOO=a\rb\n'), 3],
      ['a quoted value spanning lines over a UTF-8 comment and no knob', bytes('FOO="x\n# café\n"\n'), 3],
      // Only a whole token counts: an `_OLD` or `OLD_` key beside a value the model refuses still reads 3.
      ['an _OLD suffix key beside a non-ASCII value', bytes(`${K}_OLD=9999\nNOTE=café\n`), 3],
      ['an OLD_ prefix key beside a non-ASCII value', bytes(`OLD_${K}=9999\nNOTE=café\n`), 3],
      // A comment line (no CR inside it) names no setting (ruling 16, D-6604), so the model is not asked and its refusal of NOTE never reaches the knob.
      ['a comment naming the knob above a non-ASCII value', bytes(`# ${K} is tuned below\nNOTE=café\n`), 3],
    ];
    const UNTAKEN = `rc 1 keep  why ${K} cannot be measured: ~/.ccrc/ccrc.env names it on a line this reader does not take (it reads only a plain KEY=value line)\n`;
    /** What the unit model cannot decide refuses with its own clause, naming the file (review 817, F1 and F2): each with that clause's opening. */
    const SHAPE = `names ${K} in a shape this reader does not decide`;
    const UNDECIDED: readonly (readonly [string, Buffer, string])[] = [
      ['a double-quoted value spanning lines over a later knob line', bytes(`${K}=9\nFOO="x\n${K}=2\n"\n`), SHAPE],
      ['a single-quoted value spanning lines over a later knob line', bytes(`${K}=9\nFOO='x\n${K}=2\n'\n`), SHAPE],
      ['a backslash continuation over a later knob line', bytes(`${K}=9\nFOO=x\\\n${K}=2\n`), SHAPE],
      ['a comment ending in a backslash over a later knob line', bytes(`${K}=9\n# note \\\n${K}=2\n`), SHAPE],
      ['the only knob line inside another key\'s quoted value', bytes(`FOO="x\n${K}=2\n"\n`), SHAPE],
      // systemd skips a file whose values are not valid UTF-8, which the model does not check, so it decides neither 9 nor the default.
      ['a lone UTF-8 lead byte ending another key\'s value above the knob', bytes('FOO=', [0xc3], `\n${K}=9\n`), 'line 1 has a non-ASCII byte in a NAME=value line'],
      ['a CR lead', bytes(`\r${K}=4\n`), 'line 1 has a carriage return inside a line'],
    ];
    /** `_bak_data_keep` over a ccrc.env holding `text`, the whole shell under LC_ALL=`locale`, on the Linux arm of the unit model
     *  (`_box_unit_env`; a macOS box models its launchd job's bash, `_box_unit_env_shell`, which refuses a CR anywhere). */
    const dataKeep = (home: string, text: Buffer | null, locale: string, env: NodeJS.ProcessEnv = {}): string => {
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      if (text === null) rmSync(join(home, '.ccrc', 'ccrc.env'), { force: true });
      else writeFileSync(join(home, '.ccrc', 'ccrc.env'), text);
      const r = sourced(home, 'CCD_OS=linux; _bak_data_keep; echo "rc $? keep ${BAK_DATA_KEEP} why ${BAK_DATA_KEEP_WHY}"', { LC_ALL: locale, ...env });
      expect(r.code, r.stderr).toBe(0);
      return r.stdout;
    };
    const undecided = (out: string, clause: string, shape: string): void => {
      expect(out.startsWith(`rc 1 keep  why ${K} cannot be measured: ~/.ccrc/ccrc.env ${clause}`), `${shape}: ${out}`).toBe(true);
      expect(out, `${shape}: the refusal never prints the file's bytes`).not.toMatch(/=\d/);
    };
    /** The UTF-8 half's locale: C.UTF-8, else en_US.UTF-8, and only one `locale -a` lists; null skips that half, by name. */
    const UTF8: string | null = (() => {
      const flat = (l: string): string => l.trim().toLowerCase().replace(/-/g, '');
      const listed = (spawnSync('locale', ['-a'], { encoding: 'utf8' }).stdout ?? '').split('\n').map(flat);
      return ['C.UTF-8', 'en_US.UTF-8'].find((l) => listed.includes(flat(l))) ?? null;
    })();

    it.each(REFUSED)('W23-B17: %s refuses under LC_ALL=C, as unmeasured (D-6365, review 806 F1)', (_shape, text) => {
      expect(dataKeep(freshUpdateBox('ccrc-fx-w23-b17r-'), text, 'C')).toBe(UNTAKEN);
    });

    it.each(READ)('W23-B17: %s reads under LC_ALL=C, never refused (D-6365, review 806 F1, F4; review 817 F1, F8; review 839)', (_shape, text, keep) => {
      expect(dataKeep(freshUpdateBox('ccrc-fx-w23-b17a-'), text, 'C')).toBe(`rc 0 keep ${keep} why \n`);
    });

    it.each(UNDECIDED)('W23-B17: %s is a shape the unit model does not decide, so it refuses under LC_ALL=C, as unmeasured (D-6365, review 817 F1, F2)', (shape, text, clause) => {
      undecided(dataKeep(freshUpdateBox('ccrc-fx-w23-b17d-'), text, 'C'), clause, shape);
    });

    // ccrc.env alone (the coordinator's ruling on review 839): no process that thins receives the exposure file, so nothing there is
    // read for the knob, whether it names the knob, names it empty, cannot be read or cannot be decided.
    const EXPOSED: readonly (readonly [string, (exp: string) => void])[] = [
      ['an exposure file that names the knob', (exp) => { writeFileSync(exp, `CCRC_AUTH=on\n${K}=2\n`); }],
      ['an exposure file that names the knob with an empty value', (exp) => { writeFileSync(exp, `${K}=\n`); }],
      ['an exposure file that cannot be read', (exp) => { writeFileSync(exp, 'CCRC_AUTH=on\n'); chmodSync(exp, 0o000); }],
      ['an exposure file holding an internationalised origin', (exp) => { writeFileSync(exp, bytes('CCRC_ORIGIN=https://b', [0xc3, 0xbc], 'cher.example\n')); }],
    ];
    /** `dataKeep` in a fresh box whose exposure file is planted by `plant`, beside a ccrc.env holding `text` (null: none). */
    const exposed = (plant: (exp: string) => void, text: Buffer | null, locale: string): string => {
      const home = freshUpdateBox('ccrc-fx-w23-b17x-');
      const exp = join(home, '.ccrc', 'exposure.env');
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      plant(exp);
      try { return dataKeep(home, text, locale); } finally { chmodSync(exp, 0o600); }
    };
    it.each(EXPOSED)('W23-B17: %s beside ccrc.env\'s 9 reads 9: only the environment or ccrc.env sets the knob (D-6365, review 839)', (_shape, plant) => {
      expect(exposed(plant, bytes(`${K}=9\n`), 'C')).toBe('rc 0 keep 9 why \n');
    });
    it('W23-B17: with no ccrc.env, an exposure file that names the knob reads the default 3 (D-6365, review 839)', () => {
      expect(exposed(EXPOSED[0]![1], null, 'C')).toBe('rc 0 keep 3 why \n');
    });
    it('W23-B17: an undecidable ccrc.env still refuses with the exposure file left out, with one beside it or none (D-6365, review 839)', () => {
      const span = UNDECIDED[0]!;
      undecided(dataKeep(freshUpdateBox('ccrc-fx-w23-b17p-'), span[1], 'C'), span[2], `${span[0]}, no exposure file`);
      undecided(exposed((exp) => { writeFileSync(exp, 'CCRC_AUTH=on\n'); }, span[1], 'C'), span[2], `${span[0]}, an exposure file beside it`);
    });
    it('W23-B17: on macOS the model is asked even when no line names the knob, since the launchd job\'s bash can build the name: a backslash-newline inside it and a quoted declare refuse, a plain file reads 3 (D-6347, D-6365, review 839)', () => {
      const darwin = (text: Buffer, locale: string): string => {
        const home = freshUpdateBox('ccrc-fx-w23-b17m-');
        mkdirSync(join(home, '.ccrc'), { recursive: true });
        writeFileSync(join(home, '.ccrc', 'ccrc.env'), text);
        const r = sourced(home, 'CCD_OS=darwin; _bak_data_keep; echo "rc $? keep ${BAK_DATA_KEEP} why ${BAK_DATA_KEEP_WHY}"', { LC_ALL: locale });
        expect(r.code, r.stderr).toBe(0);
        return r.stdout;
      };
      for (const loc of ['C', ...(UTF8 === null ? [] : [UTF8])]) {
        undecided(darwin(bytes(`CCRC_ROLE=server\nCCRC_BACKUP_DATA_KEE\\\nP=50\n`), loc), 'line 2 is not a plain NAME=value line', `${loc}: the name split by a backslash-newline`);
        undecided(darwin(bytes('declare CCRC_BACKUP_DATA_"KEEP"=50\n'), loc), 'line 1 is not a plain NAME=value line', `${loc}: a quoted declare`);
        expect(darwin(bytes('CCRC_ROLE=server\n'), loc), `${loc}: a plain file that never names the knob`).toBe('rc 0 keep 3 why \n');
      }
    });
    it.each(UNDECIDED)('W23-B17: the environment\'s 5 wins beside %s, with no refusal (D-6360, D-6365, review 839 F2)', (_shape, text) => {
      expect(dataKeep(freshUpdateBox('ccrc-fx-w23-b17v-'), text, 'C', { [K]: '5' })).toBe('rc 0 keep 5 why \n');
    });

    it('W23-B17: a ccrc.env that holds a NUL byte, and a scan that cannot run or is killed, could not be scanned: each refuses (D-6365, fix round 2)', () => {
      const SCANNED = `rc 1 keep  why ${K} cannot be measured: ~/.ccrc/ccrc.env could not be scanned\n`;
      // bash's `read` drops a NUL, so the line `_box_env_value` reads is not the one in the file.
      for (const text of [bytes(`export CCRC_BACKUP\u0000_DATA_KEEP=9999\n`), bytes(`${K}=4\nNOTE=\u0000\n`), bytes('NOTE=x\u0000y\n')]) {
        expect(dataKeep(freshUpdateBox('ccrc-fx-w23-b17n-'), text, 'C')).toBe(SCANNED);
      }
      for (const [why, body] of [['an awk that cannot run', 'exit 127'], ['an awk that is killed', 'kill -TERM $$']]) {
        const home = freshUpdateBox('ccrc-fx-w23-b17k-');
        const bin = join(home, 'awk-shim');
        mkdirSync(bin, { recursive: true });
        writeFileSync(join(bin, 'awk'), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
        mkdirSync(join(home, '.ccrc'), { recursive: true });
        writeFileSync(join(home, '.ccrc', 'ccrc.env'), `export ${K}=9999\n`);
        const r = sourced(home, '_bak_data_keep; echo "rc $? keep ${BAK_DATA_KEEP} why ${BAK_DATA_KEEP_WHY}"', { LC_ALL: 'C', PATH: `${bin}:${updateEnv(home).PATH ?? ''}` });
        expect(r.stdout, why).toBe(SCANNED);
      }
    });

    it.skipIf(UTF8 === null)(`W23-B17: under a UTF-8 locale (${UTF8 ?? 'none: locale -a lists neither C.UTF-8 nor en_US.UTF-8, so this half is skipped'}) every shape answers as under LC_ALL=C, because the scan and the unit model read bytes (D-3833, D-3979, D-6365, review 806 F1, review 817 F1, review 839 F4)`, () => {
      const loc = UTF8!;
      const charmap = spawnSync('locale', ['charmap'], { env: { ...process.env, LC_ALL: loc }, encoding: 'utf8' }).stdout ?? '';
      expect(charmap.trim(), `${loc} is a UTF-8 locale on this runner`).toBe('UTF-8');
      const home = freshUpdateBox('ccrc-fx-w23-b17u-');
      for (const [shape, text] of REFUSED) expect(dataKeep(home, text, loc), shape).toBe(UNTAKEN);
      for (const [shape, text, keep] of READ) expect(dataKeep(home, text, loc), shape).toBe(`rc 0 keep ${keep} why \n`);
      for (const [shape, text, clause] of UNDECIDED) undecided(dataKeep(home, text, loc), clause, shape);
      for (const [shape, text] of UNDECIDED) expect(dataKeep(home, text, loc, { [K]: '5' }), `the environment beside ${shape}`).toBe('rc 0 keep 5 why \n');
      for (const [shape, plant] of EXPOSED) expect(exposed(plant, bytes(`${K}=9\n`), loc), shape).toBe('rc 0 keep 9 why \n');
      expect(exposed(EXPOSED[0]![1], null, loc), 'no ccrc.env').toBe('rc 0 keep 3 why \n');
    });

    /** 12 code-only backups beside a ccrc.env that never names the knob, then `_bak_gc update` at CCRC_BACKUP_KEEP=10 on the named arm. */
    const pruneTwelve = (os: 'linux' | 'darwin'): { home: string; names: string[]; g: Result } => {
      const home = box(`ccrc-fx-w23-b17g-${os}-`);
      const names = Array.from({ length: 12 }, (_, i) => `202501${String(i + 1).padStart(2, '0')}-000000`);
      for (const n of names) plantDir(home, n, 'tree');
      writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=server\nNOTE=café\n');
      return { home, names, g: sourced(home, `CCD_OS=${os}; UPD_BAK_FLOOR=20300101-000000; UPD_BACKUP_DIR=""; _bak_gc update; echo "rc $?"`, { CCRC_BACKUP_KEEP: '10' }) };
    };
    it('W23-B17: a ccrc.env that never names the knob does not stop the prune: _bak_gc update prunes 12 backups to 10 at CCRC_BACKUP_KEEP=10, with no WARN (review 839; on the Linux arm, review 847)', () => {
      const { home, names, g } = pruneTwelve('linux');
      expect(g.code, `stderr: ${g.stderr}\nstdout: ${g.stdout}`).toBe(0);
      expect(g.stdout).not.toMatch(/WARN/);
      expect(g.stdout).toMatch(/^rc 0$/m);
      for (const n of names.slice(0, 2)) expect(g.stdout).toMatch(new RegExp(`^update: backups: pruned \\$HOME/ccrc-backups/${n}`, 'm'));
      expect(readdirSync(backupRoot(home)).sort(), 'the newest ten are left').toEqual(names.slice(2));
    });

    it('W23-B17: on macOS the same ccrc.env stops the thinning only: the Darwin model refuses NOTE=café for CCRC_BACKUP_DATA_KEEP, _bak_gc WARNs, prunes 12 backups to 10 and returns 1 (review 839 departure 1, review 847, D-6590)', () => {
      const { home, names, g } = pruneTwelve('darwin');
      expect(g.code, `stderr: ${g.stderr}\nstdout: ${g.stdout}`).toBe(0);
      expect(g.stdout).toMatch(/^update: backups: WARN: CCRC_BACKUP_DATA_KEEP cannot be measured: ~\/\.ccrc\/ccrc\.env line 2 is not a plain NAME=value line\b.* — nothing thinned$/m);
      expect(g.stdout.split('\n').filter((l) => / WARN: /.test(l)), 'the one WARN').toHaveLength(1);
      expect(g.stdout).toMatch(/^rc 1$/m);
      for (const n of names.slice(0, 2)) expect(g.stdout).toMatch(new RegExp(`^update: backups: pruned \\$HOME/ccrc-backups/${n}`, 'm'));
      expect(readdirSync(backupRoot(home)).sort(), 'the newest ten are left').toEqual(names.slice(2));
    });

    /** A whole-file fault refuses both keeps (D-6587, D-6590): each its own WARN, and neither act runs. */
    const BOTH_UNREADABLE = [
      'update: backups: WARN: CCRC_BACKUP_KEEP cannot be measured: ~/.ccrc/ccrc.env is there but cannot be read — nothing pruned',
      'update: backups: WARN: CCRC_BACKUP_DATA_KEEP cannot be measured: ~/.ccrc/ccrc.env is there but cannot be read — nothing thinned',
    ];
    it.skipIf(process.getuid?.() === 0)('W23-B18: a ccrc.env that is there but cannot be read refuses both keeps, never falls back to the default: nothing pruned, nothing thinned, the lock never taken (D-6365, D-6590)', () => {
      const four = NAMES.slice(0, 4);
      const home = box('ccrc-fx-w23-b18-');
      plantFull(home, four);
      const before = fingerprint(home, four);
      const lock = join(home, '.ccrc', 'update.lock');
      expect(existsSync(lock), 'no lock file before the call').toBe(false);
      const env = join(home, '.ccrc', 'ccrc.env');
      writeFileSync(env, 'CCRC_BACKUP_DATA_KEEP=9999\n');
      chmodSync(env, 0o000);
      const g = sourced(home, 'UPD_BAK_FLOOR=20300101-000000; UPD_BACKUP_DIR=""; _bak_gc update; echo "rc $?"');
      chmodSync(env, 0o600);
      expect(g.code, `stderr: ${g.stderr}\nstdout: ${g.stdout}`).toBe(0);
      for (const line of BOTH_UNREADABLE) expect(g.stdout.split('\n'), line).toContain(line);
      expect(g.stdout).toMatch(/^rc 1$/m);
      expect(existsSync(lock), 'refused before the lock').toBe(false);
      expect(g.stdout, 'no prune line and no thinning line').not.toMatch(/^update: backups: (pruned|thinned|coordination data sets)/m);
      expect(fingerprint(home, four), 'no data set was touched').toEqual(before);
    });

    it.each([
      ['a dangling link', (env: string): void => { symlinkSync(join(dirname(env), 'no-such.env'), env); }],
      ['a directory', (env: string): void => { mkdirSync(env); }],
      // Opened, a FIFO with no writer blocks for ever, so the row runs under a bound and a hang fails it (review 839 F1).
      ['a FIFO', (env: string): void => { expect(spawnSync('mkfifo', [env]).status).toBe(0); }],
    ] as const)('W23-B18: %s at ccrc.env cannot be read, so both keeps refuse, never falling back to the default: nothing pruned, nothing thinned, the lock never taken (D-6365, D-6590, review 806 F5, review 839 F1)', (_shape, plant) => {
      const four = NAMES.slice(0, 4);
      const home = box('ccrc-fx-w23-b18x-');
      plantFull(home, four);
      const before = fingerprint(home, four);
      const lock = join(home, '.ccrc', 'update.lock');
      expect(existsSync(lock), 'no lock file before the call').toBe(false);
      const env = join(home, '.ccrc', 'ccrc.env');
      rmSync(env, { force: true });
      plant(env);
      let g: Result;
      try {
        g = sourced(home, 'UPD_BAK_FLOOR=20300101-000000; UPD_BACKUP_DIR=""; _bak_gc update; echo "rc $?"', {}, join(REPO, 'ccd', 'ccrc'), 60_000);
      } finally {
        // The bound kills bash, not a grandchild blocked opening the FIFO; a writer that opens and closes it lets that one see EOF.
        if (lstatSync(env, { throwIfNoEntry: false })?.isFIFO()) closeSync(openSync(env, fsConstants.O_RDWR | fsConstants.O_NONBLOCK));
      }
      expect(g.code, `stderr: ${g.stderr}\nstdout: ${g.stdout}`).toBe(0);
      for (const line of BOTH_UNREADABLE) expect(g.stdout.split('\n'), line).toContain(line);
      expect(g.stdout).toMatch(/^rc 1$/m);
      expect(existsSync(lock), 'refused before the lock').toBe(false);
      expect(g.stdout, 'no prune line and no thinning line').not.toMatch(/^update: backups: (pruned|thinned|coordination data sets)/m);
      expect(fingerprint(home, four), 'no data set was touched').toEqual(before);
    });

    it('W23-S1: the own-dir and floor filter is spelled once, in _bak_ours, and _bak_keepset, _bak_removable and _bak_thin each call it', () => {
      const src = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
      const body = (name: string): string => {
        const m = new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?\\n\\}$`, 'm').exec(src);
        expect(m, `ccd/ccrc has no ${name}`).not.toBeNull();
        return m![0];
      };
      expect(src.split('= "$UPD_BACKUP_DIR" ]').length - 1, 'the own-dir clause').toBe(1);
      expect(src.split('${UPD_BAK_FLOOR//-/}').length - 1, 'the floor comparison').toBe(1);
      expect(body('_bak_ours'), 'the one spelling').toContain('= "$UPD_BACKUP_DIR" ]');
      for (const fn of ['_bak_keepset', '_bak_removable', '_bak_thin']) expect(body(fn), fn).toMatch(/^ +.*_bak_ours "\$d"/m);
    });

    describe('W24: a refused keep stops only its own act (D-6590)', () => {
      const holders: ChildProcess[] = [];
      afterEach(() => { for (const h of holders.splice(0)) h.kill('SIGKILL'); });
      const TWELVE = Array.from({ length: 12 }, (_, i) => `202501${String(i + 1).padStart(2, '0')}-000000`);
      const FOUR = NAMES.slice(0, 4);
      const GC = (lead: 'update' | 'rollback'): string => `UPD_BAK_FLOOR=20300101-000000; UPD_BACKUP_DIR=""; _bak_gc ${lead}; echo "rc $?"`;
      const lockOf = (home: string): string => join(home, '.ccrc', 'update.lock');
      const envOf = (home: string): string => join(home, '.ccrc', 'ccrc.env');
      /** Code-only backups: no data set and no tree, so no keep-set member is among them and only the count decides. */
      const plantCodeOnly = (home: string, names: string[]): void => { for (const n of names) plantDir(home, n, 'plain'); };
      const prunedLine = (lead: string, n: string): RegExp => new RegExp(`^${lead}: backups: pruned \\$HOME/ccrc-backups/${n} `, 'm');
      const lines = (r: Result, pick: RegExp): string[] => r.stdout.split('\n').filter((l) => pick.test(l));
      /** ONE process holds ~/.ccrc/update.lock (the pruner describe's holder, as a pattern); returns once a fresh probe fails. */
      const holdLock = (home: string): void => {
        mkdirSync(join(home, '.ccrc'), { recursive: true });
        holders.push(spawn(BASH, ['-c', 'exec 9>>"$1" && flock 9 && exec sleep 30', '_', lockOf(home)], { stdio: 'ignore' }));
        for (const t0 = Date.now(); spawnSync(BASH, ['-c', 'exec 9>>"$1" && flock -n 9', '_', lockOf(home)]).status === 0;) {
          if (Date.now() - t0 > 10_000) throw new Error('the fixture holder never took the lock');
          spawnSync('sleep', ['0.05']);
        }
      };

      it('W24-B1: an update with CCRC_BACKUP_DATA_KEEP=1 prunes by count and thins nothing', () => {
        const home = box('ccrc-fx-w24-b1-');
        plantCodeOnly(home, TWELVE);
        const g = sourced(home, GC('update'), { CCRC_BACKUP_KEEP: '10', CCRC_BACKUP_DATA_KEEP: '1' });
        expect(g.code, `stderr: ${g.stderr}\nstdout: ${g.stdout}`).toBe(0);
        expect(g.stdout).toMatch(/^update: backups: WARN: CCRC_BACKUP_DATA_KEEP='1' is not a whole number from 2 to 9999, as set in the environment — nothing thinned$/m);
        for (const n of TWELVE.slice(0, 2)) expect(g.stdout, n).toMatch(prunedLine('update', n));
        expect(readdirSync(backupRoot(home)).sort(), 'the newest ten are left').toEqual(TWELVE.slice(2));
        expect(g.stdout).not.toMatch(/^update: backups: (thinned|coordination data sets)/m);
        expect(g.stdout).toMatch(/^rc 1$/m);
      });

      it('W24-B2: an update with CCRC_BACKUP_KEEP=x thins and prunes nothing by count', () => {
        const home = box('ccrc-fx-w24-b2-');
        plantFull(home);
        const g = sourced(home, GC('update'), { CCRC_BACKUP_KEEP: 'x' });
        expect(g.code, `stderr: ${g.stderr}\nstdout: ${g.stdout}`).toBe(0);
        expect(g.stdout).toMatch(/^update: backups: WARN: CCRC_BACKUP_KEEP='x' is not a whole number from 0 to 9999, as set in the environment — nothing pruned$/m);
        expect(g.stdout).not.toMatch(/^update: backups: pruned /m);
        for (const n of NAMES.slice(0, 2)) {
          expect(listing(home, n), n).toEqual(['agent-dist', 'coordination-thinned.json']);
          expect(g.stdout, n).toMatch(thinLine('update: backups:', n));
        }
        expect(readdirSync(backupRoot(home)).sort(), 'every dir is still there').toEqual(NAMES);
        expect(g.stdout).toMatch(/^rc 1$/m);
      });

      it('W24-B3: a rollback never reads CCRC_BACKUP_DATA_KEEP', () => {
        const home = box('ccrc-fx-w24-b3-');
        plantCodeOnly(home, TWELVE);
        const g = sourced(home, GC('rollback'), { CCRC_BACKUP_DATA_KEEP: '1' });
        expect(g.code, `stderr: ${g.stderr}\nstdout: ${g.stdout}`).toBe(0);
        for (const n of TWELVE.slice(0, 2)) expect(g.stdout, n).toMatch(prunedLine('rollback', n));
        expect(readdirSync(backupRoot(home)).sort()).toEqual(TWELVE.slice(2));
        expect(g.stdout).not.toMatch(/CCRC_BACKUP_DATA_KEEP/);
        expect(g.stdout).toMatch(/^rc 0$/m);
      });

      it('W24-B4: ccrc backup says each refusal on stderr, runs the other act, and exits 1', () => {
        const DATA = /^ccrc: CCRC_BACKUP_DATA_KEEP='1' is not a whole number from 2 to 9999, as set in the environment — nothing was thinned$/m;
        const KEEP = /^ccrc: CCRC_BACKUP_KEEP='x' is not a whole number from 0 to 9999, as set in the environment — nothing was pruned$/m;
        const NO_THIN = /thinned|thinning|coordination data set/;
        // The data keep refused: the count prune runs at CCRC_BACKUP_KEEP=0, and nothing is thinned.
        const d = box('ccrc-fx-w24-b4-data-');
        plantFull(d, FOUR);
        const kept = fingerprint(d, ['20250104-000000']);
        const dr = runBackup(d, [], { CCRC_BACKUP_DATA_KEEP: '1', CCRC_BACKUP_KEEP: '0' });
        expect(dr.code, `stderr: ${dr.stderr}\nstdout: ${dr.stdout}`).toBe(1);
        expect(dr.stderr).toMatch(DATA);
        for (const n of FOUR.slice(0, 3)) expect(dr.stdout, n).toMatch(new RegExp(`^backup: pruned \\S+/${n} `, 'm'));
        expect(readdirSync(backupRoot(d)).sort(), 'the keep-set\'s data keep and this run\'s own').toEqual(['20250104-000000', path.basename(ownDir(dr))]);
        expect(fingerprint(d, ['20250104-000000'])).toEqual(kept);
        expect(dr.stdout, 'nothing thinned').not.toMatch(NO_THIN);
        // The count keep refused: nothing is pruned, and the thinning runs.
        const k = box('ccrc-fx-w24-b4-keep-');
        plantFull(k, FOUR);
        const kr = runBackup(k, [], { CCRC_BACKUP_KEEP: 'x' });
        expect(kr.code, `stderr: ${kr.stderr}\nstdout: ${kr.stdout}`).toBe(1);
        expect(kr.stderr).toMatch(KEEP);
        expect(kr.stdout).not.toMatch(/^backup: pruned /m);
        for (const n of FOUR.slice(0, 2)) expect(kr.stdout, n).toMatch(thinLine('backup:', n));
        expect(readdirSync(backupRoot(k))).toHaveLength(5);
        // Both refused: neither act runs.
        const b = box('ccrc-fx-w24-b4-both-');
        plantFull(b, FOUR);
        const before = fingerprint(b, FOUR);
        const br = runBackup(b, [], { CCRC_BACKUP_DATA_KEEP: '1', CCRC_BACKUP_KEEP: 'x' });
        expect(br.code, `stderr: ${br.stderr}\nstdout: ${br.stdout}`).toBe(1);
        expect(br.stderr).toMatch(DATA);
        expect(br.stderr).toMatch(KEEP);
        expect(fingerprint(b, FOUR), 'every planted dir is byte-identical').toEqual(before);
        expect(readdirSync(backupRoot(b))).toHaveLength(5);
        // A lock-held skip after a refusal still exits 1 (every early return returns 1 once a refusal was printed).
        const l = box('ccrc-fx-w24-b4-lock-');
        plantFull(l, FOUR);
        holdLock(l);
        const lr = runBackup(l, [], { CCRC_BACKUP_DATA_KEEP: '1' });
        expect(lr.code, `stderr: ${lr.stderr}\nstdout: ${lr.stdout}`).toBe(1);
        expect(lr.stdout).toContain('backup: prune skipped — another ccrc run holds ~/.ccrc/update.lock; nothing was pruned');
        expect(lr.stderr).toMatch(DATA);
      }, 120_000);

      it('W24-B5: an update with both refused touches nothing and returns 1 before the lock', () => {
        const home = box('ccrc-fx-w24-b5-');
        plantFull(home, FOUR);
        const before = fingerprint(home, FOUR);
        expect(existsSync(lockOf(home)), 'no lock file before the call').toBe(false);
        const g = sourced(home, GC('update'), { CCRC_BACKUP_KEEP: 'x', CCRC_BACKUP_DATA_KEEP: '1' });
        expect(g.code, `stderr: ${g.stderr}\nstdout: ${g.stdout}`).toBe(0);
        expect(g.stdout).toMatch(/^update: backups: WARN: CCRC_BACKUP_KEEP='x' is not a whole number from 0 to 9999, as set in the environment — nothing pruned$/m);
        expect(g.stdout).toMatch(/^update: backups: WARN: CCRC_BACKUP_DATA_KEEP='1' is not a whole number from 2 to 9999, as set in the environment — nothing thinned$/m);
        expect(g.stdout).toMatch(/^rc 1$/m);
        expect(fingerprint(home, FOUR), 'every planted dir is byte-identical').toEqual(before);
        expect(existsSync(lockOf(home)), 'refused before the lock').toBe(false);
      });

      it('W24-B6: a ccrc.env no reader can scan refuses both keeps at once, in _bak_gc and in ccrc backup', () => {
        const shapes: (readonly [string, string | Buffer, string])[] = [['a NUL byte', Buffer.from('NOTE=x\0y\n'), 'could not be scanned']];
        if (process.getuid?.() !== 0) shapes.push(['mode 000', 'NOTE=x\n', 'is there but cannot be read']);
        for (const [shape, text, clause] of shapes) {
          const why = (k: string): string => `${k} cannot be measured: ~/.ccrc/ccrc.env ${clause}`;
          const plant = (home: string): void => {
            plantFull(home, FOUR);
            writeFileSync(envOf(home), text);
            if (shape === 'mode 000') chmodSync(envOf(home), 0o000);
          };
          const g0 = box('ccrc-fx-w24-b6-gc-');
          plant(g0);
          const before = fingerprint(g0, FOUR);
          expect(existsSync(lockOf(g0)), `${shape}: no lock file before the call`).toBe(false);
          let g: Result;
          try { g = sourced(g0, GC('update')); } finally { chmodSync(envOf(g0), 0o600); }
          expect(g.code, `${shape}: stderr: ${g.stderr}\nstdout: ${g.stdout}`).toBe(0);
          expect(g.stdout.split('\n'), shape).toContain(`update: backups: WARN: ${why('CCRC_BACKUP_KEEP')} — nothing pruned`);
          expect(g.stdout.split('\n'), shape).toContain(`update: backups: WARN: ${why('CCRC_BACKUP_DATA_KEEP')} — nothing thinned`);
          expect(g.stdout, shape).toMatch(/^rc 1$/m);
          expect(fingerprint(g0, FOUR), `${shape}: every planted dir is byte-identical`).toEqual(before);
          expect(existsSync(lockOf(g0)), `${shape}: refused before the lock`).toBe(false);
          const b0 = box('ccrc-fx-w24-b6-backup-');
          plant(b0);
          const b4 = fingerprint(b0, FOUR);
          let r: Result;
          try { r = runBackup(b0); } finally { chmodSync(envOf(b0), 0o600); }
          expect(r.code, `${shape}: stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
          expect(r.stderr.split('\n'), shape).toContain(`ccrc: ${why('CCRC_BACKUP_KEEP')} — nothing was pruned`);
          expect(r.stderr.split('\n'), shape).toContain(`ccrc: ${why('CCRC_BACKUP_DATA_KEEP')} — nothing was thinned`);
          expect(fingerprint(b0, FOUR), `${shape}: every planted dir is byte-identical`).toEqual(b4);
          expect(readdirSync(backupRoot(b0)).filter((n) => !FOUR.includes(n)), `${shape}: this run's own backup is the only new dir`).toEqual([path.basename(ownDir(r))]);
        }
      }, 120_000);

      it('W24-B7: the prune line says where its keep came from', () => {
        for (const [where, file, env] of [
          ['the box\'s ccrc.env', 'CCRC_BACKUP_KEEP=10\n', {}],
          ['the environment', null, { CCRC_BACKUP_KEEP: '10' }],
          ['the default', null, {}],
        ] as const) {
          const home = box('ccrc-fx-w24-b7-');
          plantCodeOnly(home, TWELVE);
          if (file !== null) writeFileSync(envOf(home), file);
          const g = sourced(home, GC('update'), env);
          expect(g.code, `${where}: stderr: ${g.stderr}\nstdout: ${g.stdout}`).toBe(0);
          const pruned = lines(g, /^update: backups: pruned /);
          expect(pruned, where).toHaveLength(2);
          for (const l of pruned) expect(l, where).toContain(`(kept: the newest 10 timestamped backups (CCRC_BACKUP_KEEP from ${where}),`);
        }
      });

      it('W24-B8: a rollback whose keep is refused touches nothing and returns 1 before the lock', () => {
        const home = box('ccrc-fx-w24-b8-');
        plantFull(home, FOUR);
        const before = fingerprint(home, FOUR);
        expect(existsSync(lockOf(home)), 'no lock file before the call').toBe(false);
        const g = sourced(home, GC('rollback'), { CCRC_BACKUP_KEEP: 'x' });
        expect(g.code, `stderr: ${g.stderr}\nstdout: ${g.stdout}`).toBe(0);
        expect(g.stdout).toMatch(/^rollback: backups: WARN: CCRC_BACKUP_KEEP='x' is not a whole number from 0 to 9999, as set in the environment — nothing pruned$/m);
        expect(g.stdout).toMatch(/^rc 1$/m);
        expect(fingerprint(home, FOUR), 'every planted dir is byte-identical').toEqual(before);
        expect(existsSync(lockOf(home)), 'refused before the lock').toBe(false);
      });

      /** `ccrc backup` with an environment of exactly HOME, the row's PATH and a TMPDIR inside the box, the two bus paths the
       *  row's shims need (inside the box), and `extra` (as `env -i` would leave it); no other variable, so no CCRC_ setting
       *  reaches it but what `extra` names. */
      const bareBackup = (home: string, extra: string[] = []): Result => {
        mkdirSync(join(home, 'tmp'), { recursive: true });
        replantDoctorStubs(home);
        const u = updateEnv(home);
        const env = { HOME: home, PATH: u['PATH'] ?? '', TMPDIR: join(home, 'tmp'), XDG_RUNTIME_DIR: u['XDG_RUNTIME_DIR'] ?? '',
          DBUS_SESSION_BUS_ADDRESS: u['DBUS_SESSION_BUS_ADDRESS'] ?? '', ...envPairs(extra) };
        assertNoRealTool(env, home);
        const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'backup'], { env, encoding: 'utf8' });
        return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
      };
      /** A box with `n` earlier plain backups and `text` appended to its ccrc.env; `env -i` `ccrc backup`; what is left. */
      const bare = (prefix: string, n: number, text: string, extra: string[] = []): { left: string[]; planted: string[]; own: string } => {
        const home = box(prefix);
        const planted = TWELVE.slice(0, n);
        plantCodeOnly(home, planted);
        if (text !== '') appendFileSync(envOf(home), text);
        const r = bareBackup(home, extra);
        expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
        return { left: readdirSync(backupRoot(home)).sort(), planted, own: path.basename(ownDir(r)) };
      };

      it('W24-P1: under env -i (a detached run, a timer, an ssh shell), ccrc backup reads CCRC_BACKUP_KEEP from ccrc.env', () => {
        const { left, planted, own } = bare('ccrc-fx-w24-p1-', 4, 'CCRC_BACKUP_KEEP=2\n');
        expect(left).toEqual([planted[3], own]);
      });

      it('W24-P2: a set environment wins over ccrc.env', () => {
        const { left, planted, own } = bare('ccrc-fx-w24-p2-', 4, 'CCRC_BACKUP_KEEP=2\n', ['CCRC_BACKUP_KEEP=3']);
        expect(left).toEqual([...planted.slice(2), own]);
      });

      it('W24-P3: with neither, the default 10', () => {
        const { left, planted, own } = bare('ccrc-fx-w24-p3-', 11, '');
        expect(left).toEqual([...planted.slice(2), own]);
      });

      it('W24-P5: no unit or detached argv carries a CCRC_ setting, so the reader\'s file read is the only source', () => {
        for (const unit of ['ccrc-update-watchdog.service', 'ccrc-models.service']) {
          const text = readFileSync(join(REPO, 'deploy', 'systemd', unit), 'utf8');
          expect(text, unit).not.toMatch(/^EnvironmentFile=/m);
          expect(text.split('\n').filter((l) => /^Environment=.*CCRC_/.test(l)), unit).toEqual([]);
        }
        const src = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
        for (const fn of ['_upd_detach', '_svc_run_detached']) {
          const m = new RegExp(`^${fn}\\(\\) \\{[\\s\\S]*?\\n\\}$`, 'm').exec(src);
          expect(m, `ccd/ccrc has no ${fn}`).not.toBeNull();
          const code = m![0].split('\n').filter((l) => !/^\s*#/.test(l));
          expect(code.length, `${fn}: its body was read`).toBeGreaterThan(3);
          expect(code.filter((l) => /--setenv|-E |CCRC_[A-Z0-9_]+=/.test(l)), fn).toEqual([]);
        }
      });
    });
  });

  describe('W24: ccrc reads its own settings through _ccrc_knob — the environment, else the box\'s ccrc.env, else the default (D-6587, D-6589)', () => {
    /** D-6588's names, parsed from ccd/ccrc's one CCRC_SETTINGS line and never typed here; with no such line every row reds by this name. */
    const SETTINGS: readonly string[] = /^CCRC_SETTINGS=\(([A-Z0-9_ ]+)\)$/m.exec(readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8'))?.[1]?.split(' ')
      ?? ['CCRC_SETTINGS_LINE_MISSING'];
    const KEEPS = SETTINGS.filter((k) => k.endsWith('_KEEP'));
    const ECHO = 'echo "rc $? val ${KNOB} from ${KNOB_FROM} why ${KNOB_WHY}"';
    const KEEP_ECHO = 'echo "rc $? keep ${KEEP} why ${KEEP_WHY}"';
    const envFile = (home: string): string => join(home, '.ccrc', 'ccrc.env');
    /** A fresh box whose ccrc.env holds `text` (null: no file). */
    const boxWith = (prefix: string, text: string | Buffer | null): string => {
      const home = freshUpdateBox(prefix);
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      if (text === null) rmSync(envFile(home), { force: true });
      else writeFileSync(envFile(home), text);
      return home;
    };
    /** `script` in the sourced checkout ccrc, every setting unset first (updateEnv sets one), so a row's environment is its own.
     *  Its stderr must be empty: the reader never prints. */
    const knob = (home: string, script: string): string => {
      const r = sourcedCcrc(home, `unset ${SETTINGS.join(' ')}; ${script}`);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stderr, 'the reader printed').toBe('');
      return r.stdout;
    };

    it('W24-R1: the environment wins, else ccrc.env, else the default; an exported empty value is unset', () => {
      const home = boxWith('ccrc-fx-w24-r1-', 'CCRC_BACKUP_KEEP=5\n');
      expect(knob(home, `export CCRC_BACKUP_KEEP=7; _ccrc_knob CCRC_BACKUP_KEEP 10; ${ECHO}`)).toBe('rc 0 val 7 from environment why \n');
      expect(knob(home, `_ccrc_knob CCRC_BACKUP_KEEP 10; ${ECHO}`)).toBe('rc 0 val 5 from file why \n');
      expect(knob(home, `export CCRC_BACKUP_KEEP=; _ccrc_knob CCRC_BACKUP_KEEP 10; ${ECHO}`), 'an exported empty value').toBe('rc 0 val 5 from file why \n');
      writeFileSync(envFile(home), 'CCRC_ROLE=server\n');
      expect(knob(home, `_ccrc_knob CCRC_BACKUP_KEEP 10; ${ECHO}`), 'no line').toBe('rc 0 val 10 from default why \n');
      rmSync(envFile(home));
      expect(knob(home, `_ccrc_knob CCRC_BACKUP_KEEP 10; ${ECHO}`), 'no file').toBe('rc 0 val 10 from default why \n');
    });

    it('W24-R2: file mode reads ccrc.env alone', () => {
      const home = boxWith('ccrc-fx-w24-r2-', 'CCRC_BACKUP_KEEP=5\n');
      expect(knob(home, `export CCRC_BACKUP_KEEP=7; _ccrc_knob CCRC_BACKUP_KEEP 10 file; ${ECHO}`)).toBe('rc 0 val 5 from file why \n');
      writeFileSync(envFile(home), 'CCRC_ROLE=server\n');
      expect(knob(home, `export CCRC_BACKUP_KEEP=7; _ccrc_knob CCRC_BACKUP_KEEP "" file; ${ECHO}`)).toBe('rc 0 val  from default why \n');
    });

    it('W24-R3: a name outside CCRC_SETTINGS is never read, from the file or the environment', () => {
      const home = boxWith('ccrc-fx-w24-r3-', 'CCRC_ACCOUNTS=/x\n');
      expect(knob(home, `export CCRC_ACCOUNTS=/y; _ccrc_knob CCRC_ACCOUNTS ""; ${ECHO}`))
        .toBe('rc 1 val  from  why CCRC_ACCOUNTS is not one of ccrc\'s settings (CCRC_SETTINGS), so it is never read from a file\n');
    });

    it.each(SETTINGS)('W24-R4: %s — unmeasured is not unset: an export line, a NUL byte and an unreadable file each refuse', (k) => {
      // The NUL and mode-000 shapes name no setting at all, so they also prove a whole-file fault refuses every key (D-6587).
      const shapes: (readonly [string, string | Buffer, string])[] = [
        ['an export line', `export ${k}=5\n`, 'names it on a line this reader does not take (it reads only a plain KEY=value line)'],
        ['a NUL byte', Buffer.from('NOTE=x\u0000y\n', 'utf8'), 'could not be scanned'],
      ];
      if (process.getuid?.() !== 0) shapes.push(['mode 000', 'NOTE=x\n', 'is there but cannot be read']);
      for (const [shape, text, clause] of shapes) {
        const home = boxWith('ccrc-fx-w24-r4-', text);
        if (shape === 'mode 000') chmodSync(envFile(home), 0o000);
        const why = `${k} cannot be measured: ~/.ccrc/ccrc.env ${clause}`;
        try {
          expect(knob(home, `_ccrc_knob ${k} ""; ${ECHO}`), shape).toBe(`rc 1 val  from  why ${why}\n`);
          if (KEEPS.includes(k)) expect(knob(home, `_keep_knob ${k} 3; ${KEEP_ECHO}`), `_keep_knob, ${shape}`).toBe(`rc 1 keep  why ${why}\n`);
        } finally { chmodSync(envFile(home), 0o600); }
      }
    });

    it('W24-R5: the exposure file is never read for a setting', () => {
      const home = boxWith('ccrc-fx-w24-r5-', 'CCRC_ROLE=server\n');
      writeFileSync(join(home, '.ccrc', 'exposure.env'), 'CCRC_BACKUP_KEEP=2\n');
      expect(knob(home, `_ccrc_knob CCRC_BACKUP_KEEP 10; ${ECHO}`)).toBe('rc 0 val 10 from default why \n');
      // A comment naming the key names nothing (ruling 16, D-6604), so the model is not asked and the exposure file stays unread.
      writeFileSync(envFile(home), 'CCRC_ROLE=server\n# CCRC_BACKUP_KEEP is set elsewhere\n');
      expect(knob(home, `_ccrc_knob CCRC_BACKUP_KEEP 10; ${ECHO}`), 'a comment names nothing').toBe('rc 0 val 10 from default why \n');
      // A line that can assign another key and holds the name in its value does name it, so the model IS asked, and still the exposure file stays unread.
      writeFileSync(envFile(home), 'CCRC_ROLE=server\nFOO=CCRC_BACKUP_KEEP\n');
      expect(knob(home, `_ccrc_knob CCRC_BACKUP_KEEP 10; ${ECHO}`), 'the model asked').toBe('rc 0 val 10 from default why \n');
    });

    it('W24-R6: another file is read only when the caller names it, and only for that call', () => {
      const home = boxWith('ccrc-fx-w24-r6-', 'CCRC_ROLE=server\n');
      writeFileSync(join(home, 'other.env'), 'CCRC_UPDATE_DEADLINE_MS=600000\n');
      expect(knob(home, `BOX_ENV_FILE="$HOME/other.env" _ccrc_knob CCRC_UPDATE_DEADLINE_MS "" file; ${ECHO}; echo "after $BOX_ENV_FILE"`))
        .toBe(`rc 0 val 600000 from file why \nafter ${home}/.ccrc/ccrc.env\n`);
    });

    it('W24-R7: an empty value in ccrc.env reads the default, and says it was named empty', () => {
      const home = boxWith('ccrc-fx-w24-r7-', 'CCRC_VERSIONS_KEEP=\n');
      expect(knob(home, `_ccrc_knob CCRC_VERSIONS_KEEP 3; ${ECHO}`)).toBe('rc 0 val 3 from empty why \n');
      writeFileSync(envFile(home), 'CCRC_UPDATE_DEADLINE_MS=\n');
      expect(knob(home, `_ccrc_knob CCRC_UPDATE_DEADLINE_MS "" file; ${ECHO}`)).toBe('rc 0 val  from empty why \n');
    });

    /** Knob-less files the Darwin model cannot decide, each with the clause it refuses with. */
    const KNOBLESS: readonly (readonly [string, string, string])[] = [
      ['NOTE=café', 'NOTE=café\n', 'is not a plain NAME=value line'],
      ['CCRC_PROJECTS_ROOT=~/code', 'CCRC_PROJECTS_ROOT=~/code\n', 'is not a plain NAME=value line'],
      ['a CRLF file', 'CCRC_ROLE=server\r\n', 'carries a carriage return'],
    ];
    it.each(KNOBLESS)('W24-R8: a knob-less ccrc.env the Darwin model cannot decide reads the default for every setting but CCRC_BACKUP_DATA_KEEP, which keeps wave 23\'s departure (%s)', (_shape, text, clause) => {
      const home = boxWith('ccrc-fx-w24-r8-', text);
      expect(knob(home, `CCD_OS=linux; _ccrc_knob CCRC_VERSIONS_KEEP 3; ${ECHO}`), 'linux').toBe('rc 0 val 3 from default why \n');
      expect(knob(home, `CCD_OS=darwin; _ccrc_knob CCRC_VERSIONS_KEEP 3; ${ECHO}`), 'darwin').toBe('rc 0 val 3 from default why \n');
      const kept = knob(home, `CCD_OS=darwin; _ccrc_knob CCRC_BACKUP_DATA_KEEP 3; ${ECHO}`);
      expect(kept.startsWith(`rc 1 val  from  why CCRC_BACKUP_DATA_KEEP cannot be measured: ~/.ccrc/ccrc.env line 1 ${clause}`), kept).toBe(true);
      writeFileSync(envFile(home), `CCRC_VERSIONS_KEEP=2\n${text}`);
      const named = knob(home, `CCD_OS=darwin; _ccrc_knob CCRC_VERSIONS_KEEP 3; ${ECHO}`);
      expect(named.startsWith(`rc 1 val  from  why CCRC_VERSIONS_KEEP cannot be measured: ~/.ccrc/ccrc.env line 2 ${clause}`), named).toBe(true);
    });

    it('W24-R9: _keep_knob is the one bounded keep', () => {
      const home = boxWith('ccrc-fx-w24-r9-', 'CCRC_BACKUP_KEEP=0002\n');
      const FROM = `${KEEP_ECHO}; echo "from $KEEP_FROM"`;
      expect(knob(home, `_keep_knob CCRC_BACKUP_KEEP 10; ${FROM}`)).toBe('rc 0 keep 2 why \nfrom the box\'s ccrc.env\n');
      expect(knob(home, `export CCRC_BACKUP_KEEP=0005; _keep_knob CCRC_BACKUP_KEEP 10; ${FROM}`)).toBe('rc 0 keep 5 why \nfrom the environment\n');
      writeFileSync(envFile(home), 'CCRC_BACKUP_KEEP=\n');
      expect(knob(home, `_keep_knob CCRC_BACKUP_KEEP 10; ${FROM}`), 'named empty').toBe('rc 0 keep 10 why \nfrom the default\n');
      writeFileSync(envFile(home), 'CCRC_BACKUP_KEEP=x\n');
      expect(knob(home, `_keep_knob CCRC_BACKUP_KEEP 10; ${KEEP_ECHO}`)).toBe('rc 1 keep  why CCRC_BACKUP_KEEP=\'x\' is not a whole number from 0 to 9999, as set in the box\'s ccrc.env\n');
      writeFileSync(envFile(home), 'CCRC_BACKUP_DATA_KEEP=1\n');
      expect(knob(home, `_keep_knob CCRC_BACKUP_DATA_KEEP 3 2; ${KEEP_ECHO}`)).toBe('rc 1 keep  why CCRC_BACKUP_DATA_KEEP=\'1\' is not a whole number from 2 to 9999, as set in the box\'s ccrc.env\n');
      // U+0663 is a decimal digit to a UTF-8 `=~` range, never to `_keep_ok`; under LC_ALL=C its two bytes print as `??`.
      expect(knob(home, `export LC_ALL=C CCRC_BACKUP_KEEP=٣; _keep_knob CCRC_BACKUP_KEEP 10; ${KEEP_ECHO}`))
        .toBe('rc 1 keep  why CCRC_BACKUP_KEEP=\'??\' is not a whole number from 0 to 9999, as set in the environment\n');
    });

    // D-6605 (fix round 1, F12): a keep refused for its value names the source that won, and prints no byte of the file but
    // that value: an environment value of spaces wins over the file's 5 and is refused as the environment's; a file's `x` as
    // ccrc.env's. The file's other line (and its 5) never reach the sentence.
    it('W24-R16: a keep refused for its value names where the value came from (D-6605)', () => {
      const home = boxWith('ccrc-fx-w24-r10-', 'CCRC_ROLE=both\nCCRC_BACKUP_KEEP=5\n');
      const env = knob(home, `export CCRC_BACKUP_KEEP=' '; _keep_knob CCRC_BACKUP_KEEP 10; ${KEEP_ECHO}`);
      expect(env).toBe('rc 1 keep  why CCRC_BACKUP_KEEP=\' \' is not a whole number from 0 to 9999, as set in the environment\n');
      writeFileSync(envFile(home), 'CCRC_ROLE=both\nCCRC_BACKUP_KEEP=x\n');
      const file = knob(home, `_keep_knob CCRC_BACKUP_KEEP 10; ${KEEP_ECHO}`);
      expect(file).toBe('rc 1 keep  why CCRC_BACKUP_KEEP=\'x\' is not a whole number from 0 to 9999, as set in the box\'s ccrc.env\n');
      expect(env + file).not.toContain('CCRC_ROLE');
    });

    it('W24-R10: a refused keep clears KEEP_FROM too, so a caller never reads the source of the keep before it', () => {
      // The first call sets KEEP_FROM; the second refuses, once invalid and once unmeasured, and must leave it empty.
      for (const [shape, text] of [['invalid', 'CCRC_BACKUP_KEEP=x\n'], ['unmeasured', 'export CCRC_BACKUP_KEEP=1\n']] as const) {
        const home = boxWith('ccrc-fx-w24-r10-', text);
        expect(knob(home, '_keep_knob CCRC_VERSIONS_KEEP 3; echo "from [$KEEP_FROM]"; _keep_knob CCRC_BACKUP_KEEP 10; echo "rc $? from [$KEEP_FROM]"'), shape)
          .toBe('from [the default]\nrc 1 from []\n');
      }
    });

    it('W24-R11: a scan that cannot run prints nothing and refuses as unscanned', () => {
      // The read path before the model runs no tool but awk (`_box_env_has_nul` is a bash `read`), so a bin with no awk in it is
      // the whole fixture PATH: the scan exits 127, and bash would print `awk: command not found` on stderr unless the reader silences it.
      const home = boxWith('ccrc-fx-w24-r11-', 'CCRC_BACKUP_KEEP=5\n');
      const bin = join(home, 'no-awk-bin');
      mkdirSync(bin, { recursive: true });
      mkdirSync(join(home, 'tmp'), { recursive: true });
      const r = spawnSync(BASH, ['-c', `. "$1"; type -P awk || echo 'no awk'; _ccrc_knob CCRC_BACKUP_KEEP 10; ${ECHO}`,
        'ccrc-under-test', join(REPO, 'ccd', 'ccrc')], { env: { HOME: home, PATH: bin, TMPDIR: join(home, 'tmp') }, encoding: 'utf8' });
      expect(r.stdout).toBe('no awk\nrc 1 val  from  why CCRC_BACKUP_KEEP cannot be measured: ~/.ccrc/ccrc.env could not be scanned\n');
      expect(r.stderr, 'the reader printed').toBe('');
      expect(r.status).toBe(0);
    });

    // ── Ruling 16 (D-6604): a comment line names no setting, so the shipped example's `# KEY=` lines (D-6597) plus one
    // unrelated line the platform's model cannot decide leave every setting at its default, as a knob-less file does (R8).
    // The example is read at test time, never pasted; each platform model gets an odd line it refuses.
    const EXAMPLE = (): Buffer => readFileSync(join(REPO, 'deploy', 'ccrc.env.example'));
    const ODD = { linux: 'CCRC_VAPID_SUBJECT=mailto:josé@example.com\n', darwin: 'CCRC_PROJECTS_ROOT=~/code\n' } as const;
    const exampleWith = (os: keyof typeof ODD, ...lines: string[]): Buffer => Buffer.concat([EXAMPLE(), ...[...lines, ODD[os]].map((l) => Buffer.from(l, 'utf8'))]);
    const refused = (k: string): string => `rc 1 val  from  why ${k} cannot be measured: ~/.ccrc/ccrc.env `;

    it.each(['linux', 'darwin'] as const)('W24-R12: a copy of ccrc.env.example plus one line the %s model cannot decide reads the default for every setting it only mentions in a comment (ruling 16, D-6604)', (os) => {
      const home = boxWith('ccrc-fx-w24-r12-', exampleWith(os));
      for (const k of SETTINGS) {
        const got = knob(home, `CCD_OS=${os}; _ccrc_knob ${k} 7; ${ECHO}`);
        // Wave 23's departure (ruling 10): on macOS the data keep asks the model whatever the scan says, so the odd line refuses it.
        if (os === 'darwin' && k === 'CCRC_BACKUP_DATA_KEEP') expect(got.startsWith(refused(k)), got).toBe(true);
        else expect(got, k).toBe('rc 0 val 7 from default why \n');
      }
    });

    it.each(['linux', 'darwin'] as const)('W24-R13: on %s a comment line with a CR inside it still names the setting after the CR, which systemd reads as a line of its own (ruling 16, D-6604)', (os) => {
      const home = boxWith('ccrc-fx-w24-r13-', exampleWith(os, '# note\rCCRC_VERSIONS_KEEP=1\n'));
      const cr = knob(home, `CCD_OS=${os}; _ccrc_knob CCRC_VERSIONS_KEEP 7; ${ECHO}`);
      expect(cr.startsWith(refused('CCRC_VERSIONS_KEEP')), cr).toBe(true);
    });

    it.each(['linux', 'darwin'] as const)('W24-R14: on %s a real assignment beside the odd line still refuses its key, while a key the file only comments reads the default (ruling 16, D-6604)', (os) => {
      const home = boxWith('ccrc-fx-w24-r14-', exampleWith(os, 'CCRC_VERSIONS_KEEP=2\n'));
      const set = knob(home, `CCD_OS=${os}; _ccrc_knob CCRC_VERSIONS_KEEP 7; ${ECHO}`);
      expect(set.startsWith(refused('CCRC_VERSIONS_KEEP')), set).toBe(true);
      expect(knob(home, `CCD_OS=${os}; _ccrc_knob CCRC_BACKUP_KEEP 7; ${ECHO}`), 'a key the file only comments').toBe('rc 0 val 7 from default why \n');
    });

    it.each(['linux', 'darwin'] as const)('W24-R15: on %s a CRLF comment naming CCRC_RELEASE_BASE_URL beside the odd line reads the default: a CR that ends its line is the line\'s end, never a second line (ruling 16, D-6604)', (os) => {
      // A CR followed by nothing is CRLF's line end, so the comment names nothing (R13's CR has a line after it). Alone and in a copy of the example.
      const CRLF = '# CCRC_RELEASE_BASE_URL=https://mirror.example/releases\r\n';
      for (const [shape, text] of [['alone', Buffer.from(CRLF + ODD[os], 'utf8')], ['in a copy of the example', exampleWith(os, CRLF)]] as const) {
        const home = boxWith('ccrc-fx-w24-r15-', text);
        expect(knob(home, `CCD_OS=${os}; _ccrc_knob CCRC_RELEASE_BASE_URL 7; ${ECHO}`), shape).toBe('rc 0 val 7 from default why \n');
      }
    });

    // ── Task 3 (D-6591, D-6592, D-6593, D-6601, D-6602, D-6603): one deadline reading on both sides, the keep-set bounded by it,
    // and the gate window from ccrc.env. The watchdog's rows (W24-D4, W24-D5) sit beside its fixture, and the flip run of W24-K5
    // beside the rollback-by-flip fixture.
    const DL_WARN = (lead: string): string => `${lead}: backups: WARN: CCRC_UPDATE_DEADLINE_MS does not read as one whole number of `
      + 'milliseconds everywhere the server may take it from (the environment, the box\'s ccrc.env, the exposure file), so no verification '
      + 'starts this run past the keep-set\'s first full one — the next update continues';
    const KEEPSET_WARN = (lead: string): string => `${lead}: backups: WARN: this run's time budget ran out before the keep-set found the `
      + 'newest valid coordination snapshot — nothing pruned or thinned; the next update continues';
    const exposureFile = (home: string): string => join(home, '.ccrc', 'exposure.env');
    /** `script` in the sourced checkout ccrc with an environment of exactly HOME, the box's contained PATH, TMPDIR and `extra` (as
     *  `env -i` would leave it), so no CCRC_ name reaches it but what `extra` lists; `wrap` is a command the bash runs under
     *  (`timeout 5`), reached by an outer bash's `exec`, so its exit status is the wrapper's own. */
    const bareSourced = (home: string, script: string, extra: string[] = [], wrap: string[] = []): Result => {
      mkdirSync(join(home, 'tmp'), { recursive: true });
      const via = wrap.length === 0 ? [] : ['-c', 'exec "$@"', 'wrap', ...wrap, BASH];
      const r = spawnSync(BASH, [...via, '-c', `. "$1"; ${script}`, 'ccrc-under-test', join(REPO, 'ccd', 'ccrc')],
        { env: { HOME: home, PATH: updateEnv(home)['PATH'] ?? '', TMPDIR: join(home, 'tmp'), ...envPairs(extra) }, encoding: 'utf8' });
      return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    };
    /** `_upd_deadline_ms <mode>` and its rc, as `<stdout> rc <n>`; it never prints on stderr. */
    const deadline = (home: string, mode: '' | 'min' | 'max', extra: string[] = []): string => {
      const r = bareSourced(home, `_upd_deadline_ms ${mode}; echo " rc $?"`, extra);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stderr, 'the reading printed on stderr').toBe('');
      return r.stdout;
    };
    /** The checkout's ccrc sourced, then `script`, in the fixture box's environment with `env` over it (W23's `sourced`). */
    const sourcedWith = (home: string, script: string, env: NodeJS.ProcessEnv = {}): Result => {
      const r = spawnSync(BASH, ['-c', `. "$1"; ${script}`, 'ccrc-under-test', join(REPO, 'ccd', 'ccrc')],
        { env: { ...updateEnv(home), ...env }, encoding: 'utf8' });
      return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    };
    /** Wave 23's update box (W23's `box`, `stubUpdate` and `plantFull`, local to that describe): a database and a checkpoint to
     *  capture, a v2.0.0 release to move to, and earlier full backups. */
    const updBox = (prefix: string): string => {
      const home = freshUpdateBox(prefix);
      plantOldBox(home, { version: 'v1.0.0' });
      plantCoordDb(home);
      plantLiveCheckpoint(home);
      packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
      return home;
    };
    const FLOOR = 'UPD_BAK_FLOOR=20300101-000000; UPD_BACKUP_DIR=""';
    const validateCalls = (home: string): number => nodeOrder(home).filter((l) => l === 'helper validate').length;
    /** Every entry under ~/ccrc-backups, a file by its content digest: what "byte-identical" compares. */
    const backups = (home: string): string[] => readdirSync(backupRoot(home), { recursive: true, encoding: 'utf8' }).sort().map((f) => {
      const p = join(backupRoot(home), f);
      return statSync(p).isFile() ? `${f}:${createHash('sha256').update(readFileSync(p)).digest('hex')}` : `${f}/`;
    });
    const K_NAMES = ['20250101-000000', '20250102-000000', '20250103-000000'];
    /** Three earlier dirs, each a manifest that does not hold up beside a coord.db: every classifier call is a full one (it holds a
     *  coord.db) and answers `invalid`, through the node shim, which records each call. `v1At` names one that holds a valid data set. */
    const kBox = (prefix: string, v1At?: string): string => {
      const home = freshUpdateBox(prefix);
      for (const n of K_NAMES) plantDir(home, n, n === v1At ? 'tree+v1-full' : 'invalid');
      return home;
    };
    const ago = (s: number): number => Math.floor(Date.now() / 1000) - s;

    it('W24-D1: the plain reading', () => {
      const home = boxWith('ccrc-fx-w24-d1-', null);
      expect(deadline(home, '', ['CCRC_UPDATE_DEADLINE_MS=700000']), 'the environment').toBe('700000 rc 0\n');
      writeFileSync(envFile(home), 'CCRC_UPDATE_DEADLINE_MS=600000\n');
      expect(deadline(home, ''), 'the file').toBe('600000 rc 0\n');
      rmSync(envFile(home));
      expect(deadline(home, ''), 'neither').toBe('900000 rc 0\n');
      writeFileSync(envFile(home), 'CCRC_UPDATE_DEADLINE_MS=600000\n');
      expect(deadline(home, '', ['CCRC_UPDATE_DEADLINE_MS=6e5']), 'a set environment that cannot be read never falls through to the file')
        .toBe('900000 rc 1\n');
      for (const v of ['6e5', '0600000', '600000.0']) {
        writeFileSync(envFile(home), `CCRC_UPDATE_DEADLINE_MS=${v}\n`);
        expect(deadline(home, ''), v).toBe('900000 rc 1\n');
      }
    });

    it('W24-D2: min takes the smallest of the environment, ccrc.env and the exposure file, a named-empty file counts as 900000, and any reading it cannot decide makes it 0', () => {
      const home = boxWith('ccrc-fx-w24-d2-', 'CCRC_UPDATE_DEADLINE_MS=\n');
      expect(deadline(home, 'min', ['CCRC_UPDATE_DEADLINE_MS=1200000']), 'scenario a').toBe('900000 rc 0\n');
      writeFileSync(envFile(home), 'CCRC_UPDATE_DEADLINE_MS=1200000\n');
      writeFileSync(exposureFile(home), 'CCRC_UPDATE_DEADLINE_MS=\n');
      expect(deadline(home, 'min'), 'scenario b').toBe('900000 rc 0\n');
      writeFileSync(envFile(home), 'CCRC_UPDATE_DEADLINE_MS=600000\n');
      rmSync(exposureFile(home));
      const env = ['CCRC_UPDATE_DEADLINE_MS=700000'];
      expect(deadline(home, 'min', env), 'the environment and the file').toBe('600000 rc 0\n');
      writeFileSync(exposureFile(home), 'CCRC_UPDATE_DEADLINE_MS=500000\n');
      expect(deadline(home, 'min', env), 'and the exposure file').toBe('500000 rc 0\n');
      writeFileSync(exposureFile(home), 'CCRC_UPDATE_DEADLINE_MS=+500000\n');
      expect(deadline(home, 'min', env), 'a named value that is not canonical').toBe('0 rc 1\n');
      if (process.getuid?.() !== 0) {
        writeFileSync(exposureFile(home), 'CCRC_UPDATE_DEADLINE_MS=500000\n');
        chmodSync(exposureFile(home), 0o000);
        try { expect(deadline(home, 'min', env), 'an exposure file that cannot be read').toBe('0 rc 1\n'); }
        finally { chmodSync(exposureFile(home), 0o600); }
      }
      rmSync(exposureFile(home));
      writeFileSync(envFile(home), Buffer.from('CCRC_UPDATE_DEADLINE_MS=600000\nNOTE=x\u0000y\n', 'utf8'));
      expect(deadline(home, 'min', env), 'a NUL byte in ccrc.env').toBe('0 rc 1\n');
      rmSync(envFile(home));
      expect(deadline(home, 'min', env), 'no files').toBe('700000 rc 0\n');
    });

    it('W24-D3: _bak_gc update passes thin the smallest bound, and none it can use when the deadline is undecided', () => {
      /** One update through W23-B20's shim, `plant` run on the box first: the report thin saw, its `--until`, and the stdout. */
      const update = (prefix: string, plant: (home: string) => void): { saw: { updatedAt: number }; until: number; out: string[] } => {
        const u = updBox(prefix);
        for (const n of ['20250101-000000']) plantDir(u, n, 'tree+v1-full');
        plant(u);
        const r = runUpdate(u, [], withShim(u));
        expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
        const saw = JSON.parse(readFileSync(join(u, 'thin-saw-update.json'), 'utf8'));
        expect(saw, 'thin sees the re-stamp').toMatchObject({ phase: 'restarting', detail: 'pruning and thinning ~/ccrc-backups' });
        const args = readFileSync(join(u, 'thin-args'), 'utf8').split('\n');
        expect(args.filter((a) => a === '--until'), 'one bound').toHaveLength(1);
        return { saw, until: Number(args[args.indexOf('--until') + 1]), out: r.stdout.split('\n') };
      };
      const exposed = update('ccrc-fx-w24-d3-exposure-', (h) => writeFileSync(exposureFile(h), 'CCRC_UPDATE_DEADLINE_MS=600000\n'));
      expect(exposed.until, 'the exposure file\'s 600 s, the smallest reading').toBe(exposed.saw.updatedAt + 600 - 235);
      expect(exposed.out).not.toContain(DL_WARN('update'));
      const undecided = update('ccrc-fx-w24-d3-undecided-', (h) => appendFileSync(envFile(h), 'CCRC_UPDATE_DEADLINE_MS=6e5\n'));
      expect(undecided.out).toContain(DL_WARN('update'));
      expect(undecided.until, 'the re-stamp less the margin: already past').toBe(undecided.saw.updatedAt - 235);
      // The hard cap (D-6601, D-6744): a report started 3.5 deadlines back, re-stamped now. The re-stamp's term would be now + 665;
      // the control plane's hard cap, less the 63 s its start can lead the report's (W24-K6 derives it), is earlier.
      const home = updBox('ccrc-fx-w24-d3-cap-');
      plantDir(home, '20250101-000000', 'tree+v1-full');
      const now = ago(0);
      const started = now - 3150;
      const r = sourcedWith(home, `${FLOOR}; UPD_THIN_AT=${now}; UPD_REPORT_STARTED=${started}; _bak_gc update; echo "rc $?"`, withShim(home));
      expect(r.stdout, `stderr: ${r.stderr}`).toMatch(/^rc 0$/m);
      const args = readFileSync(join(home, 'thin-args'), 'utf8').split('\n');
      expect(Number(args[args.indexOf('--until') + 1]), 'the hard cap\'s term').toBe(started + 4 * 900 - 63 - 235);
    });

    it('W24-D6: _upd_deadline_ms max', () => {
      const home = boxWith('ccrc-fx-w24-d6-', 'CCRC_UPDATE_DEADLINE_MS=1800000\n');
      const env = ['CCRC_UPDATE_DEADLINE_MS=300000'];
      expect(deadline(home, 'max', env), 'the file over the environment').toBe('1800000 rc 0\n');
      writeFileSync(exposureFile(home), 'CCRC_UPDATE_DEADLINE_MS=2000000\n');
      expect(deadline(home, 'max', env), 'the exposure file').toBe('2000000 rc 0\n');
      rmSync(exposureFile(home));
      writeFileSync(envFile(home), 'CCRC_UPDATE_DEADLINE_MS=\n');
      expect(deadline(home, 'max', env), 'a named-empty file is the server\'s 900000').toBe('900000 rc 0\n');
      writeFileSync(envFile(home), 'CCRC_UPDATE_DEADLINE_MS=2e6\n');
      expect(deadline(home, 'max'), 'a reading it cannot decide').toBe('900000 rc 1\n');
    });

    it('W24-D7: max on rc 1 prints the largest reading it could decide, never 900000 in its place', () => {
      const home = boxWith('ccrc-fx-w24-d7-', 'CCRC_UPDATE_DEADLINE_MS=1200000\n');
      writeFileSync(exposureFile(home), 'CCRC_UPDATE_DEADLINE_MS=6e5\n');
      expect(deadline(home, 'max')).toBe('1200000 rc 1\n');
    });

    it('W24-K1: past its bound the keep-set makes its first full verification and no other, and answers 3', () => {
      const home = kBox('ccrc-fx-w24-k1-');
      const r = sourcedWith(home, `${FLOOR}; _bak_list; _bak_keepset "$(( $(date +%s) - 1 ))"; echo "rc $? [$BAK_KEEP_SNAP] [$BAK_KEEP_DATA] [$BAK_KEEP_TREE]"`,
        withShim(home));
      expect(r.stdout, `stderr: ${r.stderr}`).toBe('rc 3 [] [] []\n');
      expect(validateCalls(home), nodeOrder(home).join(' | ')).toBe(1);
    });

    it('W24-K2: before its bound, and with no bound, it walks until it finds a valid data set', () => {
      for (const until of ['"$(( $(date +%s) + 3600 ))"', '""']) {
        const home = kBox('ccrc-fx-w24-k2-', K_NAMES[1]);
        const r = sourcedWith(home, `${FLOOR}; _bak_list; _bak_keepset ${until}; echo "rc $? [$BAK_KEEP_DATA]"`, withShim(home));
        expect(r.stdout, `${until}: stderr: ${r.stderr}`).toBe(`rc 0 [${join(backupRoot(home), K_NAMES[1]!)}]\n`);
        expect(validateCalls(home), until).toBe(2);
      }
    });

    it('W24-K3: an update whose keep-set reaches the bound prunes and thins nothing', () => {
      const home = kBox('ccrc-fx-w24-k3-');
      const before = backups(home);
      // A keep of 1, so a keep-set that did not stop would prune the two older dirs by count.
      const r = sourcedWith(home, `${FLOOR}; UPD_THIN_AT=${ago(700)}; _bak_gc update; echo "rc $?"`, withShim(home, { CCRC_BACKUP_KEEP: '1' }));
      expect(r.stdout.split('\n'), `stderr: ${r.stderr}`).toEqual([KEEPSET_WARN('update'), 'rc 1', '']);
      expect(validateCalls(home)).toBe(1);
      expect(nodeOrder(home), 'nothing thinned').not.toContain('helper thin');
      expect(backups(home), 'every dir byte-identical').toEqual(before);
    });

    it('W24-K4: a walk of cheap calls is never stopped: manifest-only and code-only dirs past the bound prune by count', () => {
      const pruned = (n: string): string => `update: backups: pruned $HOME/ccrc-backups/${n} `;
      // A code-only dir is deploy.sh's shape, an `agent-dist` entry and no manifest ('tree'): the newest such is the tree keep, so
      // the oldest pair keeps its newer one past the count, and a newest one is inside the count anyway.
      const shapes: (readonly [string, readonly (readonly [string, 'v1-empty' | 'tree'])[], readonly string[]])[] = [
        ['code-only oldest', [['20250101-000000', 'tree'], ['20250102-000000', 'tree'], ['20250103-000000', 'v1-empty'],
          ['20250104-000000', 'v1-empty'], ['20250105-000000', 'v1-empty'], ['20250106-000000', 'v1-empty'], ['20250107-000000', 'v1-empty']],
        ['20250101-000000', '20250103-000000', '20250104-000000']],
        ['a code-only deploy.sh backup newest', [['20250101-000000', 'v1-empty'], ['20250102-000000', 'v1-empty'], ['20250103-000000', 'v1-empty'],
          ['20250104-000000', 'v1-empty'], ['20250105-000000', 'v1-empty'], ['20250106-000000', 'tree']],
        ['20250101-000000', '20250102-000000', '20250103-000000']],
      ];
      for (const [shape, dirs, gone] of shapes) {
        const home = boxWith('ccrc-fx-w24-k4-', 'CCRC_UPDATE_DEADLINE_MS=6e5\n');
        for (const [n, kind] of dirs) plantDir(home, n, kind);
        // The fleet box's shape: a manifest alone, `data: no`.
        expect(readdirSync(join(backupRoot(home), '20250103-000000')), shape).toEqual(['coordination-snapshot.json']);
        const r = sourcedWith(home, `${FLOOR}; UPD_THIN_AT=${ago(700)}; _bak_gc update; echo "rc $?"`, withShim(home, { CCRC_BACKUP_KEEP: '3' }));
        const out = r.stdout.split('\n');
        expect(validateCalls(home), `${shape}: every manifest classified`).toBe(5);
        expect(out, `${shape}: stderr: ${r.stderr}`).toContain(DL_WARN('update'));
        expect(out, shape).not.toContain(KEEPSET_WARN('update'));
        expect(out.at(-2), shape).toBe('rc 1');
        expect(out.filter((l) => l.includes(': backups: pruned ')).map((l) => l.slice(0, pruned('20250101-000000').length)), shape)
          .toEqual(gone.map(pruned));
        expect(readdirSync(backupRoot(home)).sort(), shape).toEqual(dirs.map(([n]) => n).filter((n) => !gone.includes(n)));
      }
    });

    it('W24-K5: a rollback by flip re-stamps and bounds its keep-set (D-6601)', () => {
      const home = kBox('ccrc-fx-w24-k5-');
      const before = backups(home);
      const r = sourcedWith(home, `${FLOOR}; UPD_THIN_AT=${ago(700)}; _bak_gc rollback; echo "rc $?"`, withShim(home, { CCRC_BACKUP_KEEP: '1' }));
      expect(r.stdout.split('\n'), `stderr: ${r.stderr}`).toEqual([KEEPSET_WARN('rollback'), 'rc 1', '']);
      expect(validateCalls(home)).toBe(1);
      expect(backups(home), 'nothing pruned').toEqual(before);
      // The flip arm's text: the re-stamp after the sweep and directly before the prune. Its run is pinned beside the flip fixture.
      const src = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
      const body = /^cmd_rollback\(\) \{[\s\S]*?\n\}$/m.exec(src)?.[0].split('\n') ?? [];
      const gc = body.findIndex((l) => /^\s+_bak_gc rollback /.test(l));
      expect(gc, 'cmd_rollback calls _bak_gc rollback').toBeGreaterThan(0);
      expect(body[gc - 1], 'the line before it').toMatch(/^\s+_bak_restamp "pruning ~\/ccrc-backups"$/);
      expect(body.slice(0, gc - 1).some((l) => /^\s+_upd_sweep$/.test(l)), 'after the sweep').toBe(true);
    });

    it('W24-K6: the hard-cap term is the sum of the start chain\'s own ceilings, derived from their sources (D-6744)', () => {
      const src = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
      const fn = (name: string): string => new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?\\n\\}$`, 'm').exec(src)?.[0] ?? '';
      const until = fn('_bak_gc').split('\n').filter((l) => /^\s+until=\$\(\(/.test(l));
      expect(until, 'one until line in _bak_gc').toHaveLength(1);
      // The control plane's factor by import, never by its source text (ARCH-06's ratchet counts a text pin on server/src).
      const term = Number(new RegExp(`hc=\\$\\(\\( ${UPDATE_DEADLINE_HARD_CAP_FACTOR} \\* dl \\/ 1000 - ([0-9]+) - margin \\)\\)`).exec(until[0])?.[1] ?? 'NaN');
      const proto = readFileSync(join(REPO, 'shared', 'agent-protocol.ts'), 'utf8');
      const ms = (name: string): number => Number((new RegExp(`^export const ${name} = ([0-9_]+);$`, 'm').exec(proto)?.[1] ?? 'NaN').replace(/_/g, ''));
      // The four sources: the spawn's bound; the release-host probe's validated ceiling, by its name, counted twice (a re-install
      // rollback's parent probes before it detaches and its child repeats the probe); and the fleet-health call `_upd_fleet_warn`
      // makes before the first `_upd_phase`, which `_box_health` bounds by CCRC_HEALTH_TIMEOUT, at its default.
      const spawn = (ms('UPDATE_SPAWN_TIMEOUT_MS') + ms('UPDATE_SPAWN_DRAIN_MS')) / 1000;
      const ceiling = Number(/_upd_validate_timeout CCRC_RELEASE_PROBE_MAX_TIME [\s\S]*?" ([0-9]+)\n/.exec(fn('_upd_asset_listed'))?.[1] ?? 'NaN');
      const health = Number(/^: "\$\{CCRC_HEALTH_TIMEOUT:=([0-9]+)\}"$/m.exec(src)?.[1] ?? 'NaN');
      expect(fn('_upd_fleet_warn'), 'the fleet-health call').toMatch(/^\s+_box_health "\$addr" \|\| return 0$/m);
      expect(fn('_box_health'), 'its bound').toContain('curl -s --max-time "$CCRC_HEALTH_TIMEOUT" ');
      for (const [what, v] of [['spawn', spawn], ['probe ceiling', ceiling], ['health default', health]] as const) {
        expect(v, what).toBeGreaterThan(0);
      }
      expect(term, `the until line: ${until[0]}`).toBe(spawn + 2 * ceiling + health);
    });

    it('W24-H1: the gate window is read from ccrc.env, the environment wins, and an unreadable line waits 90', () => {
      const gate = (home: string, extra: string[] = []): Result => bareSourced(home,
        '_upd_gate_probe() { UPD_GATE_WHY="fixture: never up"; return 1; }; _upd_gate server v2.0.0', extra, ['timeout', '5']);
      const home = boxWith('ccrc-fx-w24-h1-', 'CCRC_UPDATE_HEALTH_S=0\n');
      let r = gate(home);
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
      expect(r.stdout).toMatch(/^update: gate FAILED after 0s — fixture: never up$/m);
      writeFileSync(envFile(home), 'export CCRC_UPDATE_HEALTH_S=7\n');
      r = gate(home, ['CCRC_UPDATE_HEALTH_S=0']);
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
      expect(r.stdout).toMatch(/^update: gate FAILED after 0s /m);
      expect(r.stdout).not.toContain('WARN');
      writeFileSync(envFile(home), 'export CCRC_UPDATE_HEALTH_S=0\n');
      r = gate(home);
      expect(r.stdout.split('\n')).toContain('update: WARN: CCRC_UPDATE_HEALTH_S cannot be measured: ~/.ccrc/ccrc.env names it on a line this reader '
        + 'does not take (it reads only a plain KEY=value line) — using 90');
      expect(r.code, 'still waiting at 5 s').toBe(124);
    }, 20_000);

    // D-6747 (fix round 1, F6): digits the shell's integer test cannot compare (more than 18) are an unusable value, from the
    // file and from the environment alike: the gate WARNs and waits 90, never failing at its first probe. The probe moves the
    // shell's clock 30 s and `sleep` returns at once, so the window the gate used is the second count it reports.
    for (const big of ['9223372036854775808', '99999999999999999999']) {
      for (const from of ['ccrc.env', 'the environment'] as const) {
        it(`W24-H2: CCRC_UPDATE_HEALTH_S=${big} from ${from} waits 90 and says so (D-6747)`, () => {
          const home = boxWith('ccrc-fx-w24-h2-', from === 'ccrc.env' ? `CCRC_UPDATE_HEALTH_S=${big}\n` : 'CCRC_ROLE=both\n');
          const r = bareSourced(home, 'sleep() { :; }; _upd_gate_probe() { SECONDS=$((SECONDS + 30)); UPD_GATE_WHY="fixture: never up"; '
            + 'return 1; }; _upd_gate server v2.0.0', from === 'ccrc.env' ? [] : [`CCRC_UPDATE_HEALTH_S=${big}`], ['timeout', '10']);
          expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
          const out = r.stdout.split('\n');
          expect(out).toContain(`update: WARN: CCRC_UPDATE_HEALTH_S='${big}' is not a number of seconds (digits only, at most 18) — using 90`);
          expect(out).toContain('update: gate FAILED after 90s — fixture: never up');
          expect(r.stderr).not.toContain('integer expression expected');
        });
      }
    }
    // Ruling 6's other side (fix round 1, B1 review I1): an ordinary multi-digit window is USABLE, from either source, and so is
    // one of exactly 18 characters, so a guard that widens, or slips to 18, reds here. The same harness: four probes 30 s apart,
    // and the gate ends at 120, not 90.
    for (const win of ['120', '000000000000000120']) {
      for (const from of ['ccrc.env', 'the environment'] as const) {
        it(`W24-H3: CCRC_UPDATE_HEALTH_S=${win} from ${from} is used as written, with no WARN (ruling 6)`, () => {
          const home = boxWith('ccrc-fx-w24-h3-', from === 'ccrc.env' ? `CCRC_UPDATE_HEALTH_S=${win}\n` : 'CCRC_ROLE=both\n');
          const r = bareSourced(home, 'sleep() { :; }; _upd_gate_probe() { SECONDS=$((SECONDS + 30)); UPD_GATE_WHY="fixture: never up"; '
            + 'return 1; }; _upd_gate server v2.0.0', from === 'ccrc.env' ? [] : [`CCRC_UPDATE_HEALTH_S=${win}`], ['timeout', '10']);
          expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
          expect(r.stdout).not.toContain('WARN');
          expect(r.stdout.split('\n')).toContain('update: gate FAILED after 120s — fixture: never up');
        });
      }
    }

    // ── Task 4 (D-6594): the release mirror is a setting. W24-U2 holds `_upd_resolve`'s refusal, which the rollout pin (the
    // deploying machine's base) runs too; W24-U6's ssh stub reaches `cmd_rollout` in this file, and a leg with an `export` base
    // line in the deploying HOME's ccrc.env would pin that twin (it has none yet).
    const MIRROR = 'http://127.0.0.1:9/releases';
    const BASE_WHY = 'ccrc: CCRC_RELEASE_BASE_URL cannot be measured: ~/.ccrc/ccrc.env names it on a line this reader does not take '
      + '(it reads only a plain KEY=value line)';
    const DEFAULT_BASE = ((): string => {
      const src = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
      const pick = (name: string): string => new RegExp(`^${name}="([^"]+)"$`, 'm').exec(src)?.[1] ?? `${name}_LINE_MISSING`;
      return `https://github.com/${pick('CCRC_RELEASE_OWNER')}/${pick('CCRC_RELEASE_REPO')}/releases`;
    })();
    const curlUrls = (home: string): string[] => (existsSync(join(home, 'curl-argv'))
      ? readFileSync(join(home, 'curl-argv'), 'utf8').split('\n').filter((l) => l !== '') : []);
    /** `script` in the sourced checkout ccrc, as `sourcedWith`, but with the recording curl planted over the loopback front that
     *  `updateEnv` plants (`runUpdate`'s order), so `curl-argv` holds every URL asked. */
    const sourcedRecording = (home: string, script: string, env: NodeJS.ProcessEnv = {}): Result => {
      mkdirSync(join(home, 'tmp'), { recursive: true });
      const e = { ...updateEnv(home), TMPDIR: join(home, 'tmp'), ...env };
      replantDoctorStubs(home);
      const r = spawnSync(BASH, ['-c', `. "$1"; ${script}`, 'ccrc-under-test', join(REPO, 'ccd', 'ccrc')], { env: e, encoding: 'utf8' });
      return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    };
    /** `_upd_release_base` and its rc, sourced under `env -i`, as `<stdout> rc <n>`. */
    const releaseBase = (home: string, extra: string[] = []): Result => bareSourced(home, '_upd_release_base; echo " rc $?"', extra);

    it('W24-U1: the release base is the environment\'s, else ccrc.env\'s, else the derived default', () => {
      const home = boxWith('ccrc-fx-w24-u1-', `CCRC_RELEASE_BASE_URL=${MIRROR}\n`);
      let r = releaseBase(home);
      expect([r.stdout, r.stderr], 'the file').toEqual([`${MIRROR} rc 0\n`, '']);
      r = releaseBase(home, ['CCRC_RELEASE_BASE_URL=http://127.0.0.1:8/releases']);
      expect([r.stdout, r.stderr], 'the environment beside it').toEqual(['http://127.0.0.1:8/releases rc 0\n', '']);
      rmSync(envFile(home));
      r = releaseBase(home);
      expect([r.stdout, r.stderr], 'neither').toEqual([`${DEFAULT_BASE} rc 0\n`, '']);
    });

    it('W24-U2: a mirror line ccrc cannot read stops the update before anything changes', () => {
      const home = freshUpdateBox('ccrc-fx-w24-u2-');
      plantOldBox(home, { version: 'v1.0.0' });
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      appendFileSync(envFile(home), `export CCRC_RELEASE_BASE_URL=${MIRROR}\n`);
      const tree = treeDigest(join(home, 'ccrc'));
      const r = runUpdate(home, ['--to', 'v9.9.9'], { CCRC_RELEASE_BASE_URL: '' });
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
      expect(r.stderr.split('\n')).toContain(`${BASE_WHY} — nothing on this box was changed`);
      expect(curlUrls(home).filter((u) => !u.endsWith('/api/fleet/health')), 'a release URL was fetched').toEqual([]);
      expect(treeDigest(join(home, 'ccrc')), '~/ccrc').toEqual(tree);
    });

    it('W24-U3: _upd_asset_listed answers 3 for the same line, and a rollback says the base, never curl', () => {
      const home = boxWith('ccrc-fx-w24-u3-', `export CCRC_RELEASE_BASE_URL=${MIRROR}\n`);
      const s = sourcedRecording(home, '_upd_asset_listed v9.9.9 SHA256SUMS; echo "rc $?"');
      expect(s.stdout, `stderr: ${s.stderr}`).toBe('rc 3\n');
      expect(s.stderr.split('\n')).toContain(BASE_WHY);
      expect(curlUrls(home), 'the host was asked').toEqual([]);
      const r = rollbackRun(home, ['--to', 'v9.9.9'], { CCRC_RELEASE_BASE_URL: '' });
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
      expect(r.stderr.split('\n')).toContain(BASE_WHY);
      expect(r.stderr).toContain(`rollback: ${BASE_WHY.slice('ccrc: '.length)} — nothing on this box was changed`);
      expect(r.stderr).not.toContain('curl failed');
      expect(curlUrls(home), 'the host was asked').toEqual([]);
    });

    // F8, F9 (fix round 1): the failed report's detail, which is all the console reads, carries the reader's value-free cause,
    // and stays a node fault: a `provenance: ` lead would make it a verdict on a release nobody judged.
    it('W24-U5: a refused base\'s failed report says why, as a node fault, for update and rollback alike (F8, F9)', () => {
      const why = `${BASE_WHY.slice('ccrc: '.length)} - nothing on this box was changed`;   // the report's writer spells the dash ASCII
      const home = freshUpdateBox('ccrc-fx-w24-u5-');
      plantOldBox(home, { version: 'v1.0.0' });
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      appendFileSync(envFile(home), `export CCRC_RELEASE_BASE_URL=${MIRROR}\n`);
      const u = runUpdate(home, ['--to', 'v9.9.9', '--from', 'pwa'], { CCRC_RELEASE_BASE_URL: '' });
      expect(u.code, `stderr: ${u.stderr}`).toBe(1);
      expect([lastReport(home)['phase'], lastReport(home)['detail']], 'update').toEqual(['failed', why]);
      const r = rollbackRun(home, ['--to', 'v9.9.9', '--from', 'pwa'], { CCRC_RELEASE_BASE_URL: '' });
      expect(r.code, `stderr: ${r.stderr}`).toBe(1);
      expect([lastReport(home)['phase'], lastReport(home)['detail']], 'rollback').toEqual(['failed', `rollback: ${why}`]);
    });

    // F11 (fix round 1; B2 review, Minors 1 and 5): rollout over a box whose `--check` answers each of the four arms. The
    // deploying machine is this file's update fixture (`freshUpdateBox`, `updateEnv`: its combined curl serves the local://
    // pin), with only `ssh` planted. The stub runs the remote command for real, in the box's own fixture HOME with this
    // tree's ccrc first on its PATH and no environment base (a real ssh forwards none), so the refusal is the box's own
    // reader's. Switch files pick the other arms: `ssh-255` (ssh's own failure), `ssh-nonsense` (exit 0, no check line)
    // and `ssh-nobin` (a remote PATH of /usr/bin:/bin, where no ccrc lives, so bash answers 127).
    it('W24-U6: rollout names a box\'s refused check as the refusal it is, and ssh\'s 255, rc 0 and 127 each in their own words (F11)', () => {
      const home = freshUpdateBox('ccrc-fx-w24-u6-');
      const box = join(home, 'box');
      mkdirSync(join(box, '.ccrc'), { recursive: true });
      mkdirSync(join(box, 'bin'), { recursive: true });
      mkdirSync(join(box, 'tmp'), { recursive: true });
      mkdirSync(join(home, 'tmp'), { recursive: true });
      writeFileSync(join(box, '.ccrc', 'ccrc.env'), `CCRC_ROLE=both\nexport CCRC_RELEASE_BASE_URL=${MIRROR}\n`);
      writeFileSync(join(box, 'bin', 'ccrc'), `#!/bin/sh\nexec '${BASH}' '${join(REPO, 'ccd', 'ccrc')}' "$@"\n`, { mode: 0o755 });
      mkdirSync(join(home, 'releases', 'download', 'v2.0.0'), { recursive: true });
      writeFileSync(join(home, 'releases', 'download', 'v2.0.0', 'SHA256SUMS'), `${'0'.repeat(64)}  ccrc-v2.0.0.tar.gz\n`);
      writeFileSync(join(home, 'deploy.env'), `CCRC_BOX=user@box-a\nCCRC_AGENT_BOX=user@box-a\nCCRC_SSH_KEY=${join(home, 'id_fixture')}\n`);
      const env: NodeJS.ProcessEnv = { ...updateEnv(home), TMPDIR: join(home, 'tmp'), CCRC_DEPLOY_ENV: join(home, 'deploy.env'),
        CCRC_RELEASE_BASE_URL: `local://${home}/releases` };
      for (const k of ['CCRC_BOX', 'CCRC_AGENT_BOX', 'CCRC_SSH_KEY', 'CCRC_SSH_PORT']) delete env[k];
      replantDoctorStubs(home);
      writeFileSync(join(home, '.local', 'bin', 'ssh'), [
        '#!/bin/sh',
        'while [ $# -gt 0 ]; do case "$1" in -p|-i|-o) shift 2 ;; -*) shift ;; *) break ;; esac; done',
        `shift; cmd="$*"; p='${box}/bin':"$PATH"; [ -f "$HOME/ssh-nobin" ] && p=/usr/bin:/bin`,
        'case "$cmd" in *"--check"*) [ -f "$HOME/ssh-255" ] && { echo "fixture ssh: connection closed" >&2; exit 255; }',
        '  [ -f "$HOME/ssh-nonsense" ] && { echo nonsense; exit 0; } ;; esac',
        `HOME='${box}' TMPDIR='${box}/tmp' CCRC_RELEASE_BASE_URL= PATH="$p" exec '${BASH}' -c "$cmd"`,
      ].join('\n'), { mode: 0o755 });
      assertNoRealTool(env, home);
      const rollout = (): Result => {
        const p = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'rollout', '--to', 'v2.0.0'], { env, encoding: 'utf8' });
        return { code: p.status ?? -1, stdout: p.stdout ?? '', stderr: p.stderr ?? '' };
      };
      const last = (got: string, tail: string): string =>
        `ccrc: rollout: the box box's 'ccrc update --check' printed no check line (got: ${got}) — ${tail} nothing was touched`;
      const leg = (sw: string | null, got: string, tail: string): Result => {
        for (const f of ['ssh-255', 'ssh-nonsense', 'ssh-nobin']) rmSync(join(home, f), { force: true });
        if (sw !== null) writeFileSync(join(home, sw), '');
        const r = rollout();
        expect(r.code, `${sw ?? 'refusal'}: stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(2);
        expect(r.stderr.trimEnd().split('\n').pop(), sw ?? 'refusal').toBe(last(got, tail));
        return r;
      };
      expect(leg(null, 'nothing', 'its check refused (exit 1); the lines above say why —').stderr).toContain(`box: ${BASE_WHY}`);
      leg('ssh-255', 'nothing', 'ssh failed (exit 255), so the check may not have run there; the lines above say why —');
      leg('ssh-nonsense', 'nonsense', 'is ccrc installed there, and new enough to know --check?');
      expect(['/usr/bin/ccrc', '/bin/ccrc'].filter((f) => existsSync(f)), 'the 127 leg\'s premise: no ccrc on /usr/bin:/bin').toEqual([]);
      leg('ssh-nobin', 'nothing', 'its shell found no ccrc to run (exit 127); is ccrc installed there?');
      expect(curlUrls(home), 'the pin was fetched through the combined curl').toContain(`local://${home}/releases/download/v2.0.0/SHA256SUMS`);
    });

    it('W24-U4: on macOS a knob-less line the Darwin model rejects leaves the release base at its default, and a named base beside it refuses', () => {
      const knobless = 'CCRC_ROLE=both\nCCRC_PROJECTS_ROOT=~/code\n';
      const home = boxWith('ccrc-fx-w24-u4-', knobless);
      let r = bareSourced(home, 'CCD_OS=darwin; _upd_release_base; echo " rc $?"');
      expect([r.stdout, r.stderr], 'knob-less').toEqual([`${DEFAULT_BASE} rc 0\n`, '']);
      const u = freshUpdateBox('ccrc-fx-w24-u4-update-');
      plantOldBox(u, { version: 'v1.0.0' });
      mkdirSync(join(u, '.ccrc'), { recursive: true });
      writeFileSync(envFile(u), knobless);
      // CCD_OS is decided when ccrc is sourced, so the update runs as `cmd_update` in a shell that set it after the source.
      const up = sourcedRecording(u, 'CCD_OS=darwin; cmd_update --to v9.9.9');
      expect(curlUrls(u), `stderr: ${up.stderr}`).toContain(`${DEFAULT_BASE}/download/v9.9.9/SHA256SUMS`);
      expect(up.stderr).not.toContain('CCRC_RELEASE_BASE_URL');
      writeFileSync(envFile(home), `CCRC_RELEASE_BASE_URL=${MIRROR}\nCCRC_PROJECTS_ROOT=~/code\n`);
      r = bareSourced(home, 'CCD_OS=darwin; _upd_release_base; echo " rc $?"');
      expect(r.stdout, 'nothing on stdout').toBe(' rc 1\n');
      expect(r.stderr.startsWith('ccrc: CCRC_RELEASE_BASE_URL cannot be measured: ~/.ccrc/ccrc.env line 2 is not a plain NAME=value line'), r.stderr)
        .toBe(true);
    });
  });

  describe('a classifier that cannot run, or answers out of its table, prunes NOTHING and says why (I1, R25)', () => {
    const home0 = (prefix: string): string => {
      const home = freshUpdateBox(prefix);
      plantOldBox(home, { version: 'v1.0.0' });
      plantDir(home, '20250101-000000', 'plain');
      plantDir(home, '20250102-000000', 'v1-sidecars');
      plantDir(home, '20250103-000000', 'plain');
      return home;
    };
    const all = ['20250101-000000', '20250102-000000', '20250103-000000'];
    /** `_bak_prune`, sourced from a ccrc at `ccrcPath`, over this box's backups, with every planted dir below the floor. */
    const prune = (home: string, ccrcPath: string, env: NodeJS.ProcessEnv = {}): Result => {
      const r = spawnSync(BASH, ['-c', '. "$1"; UPD_BAK_FLOOR=20300101-000000; UPD_BACKUP_DIR=""; CCRC_BACKUP_KEEP=0; _bak_prune', 'ccrc-under-test', ccrcPath],
        { env: { ...updateEnv(home), ...env }, encoding: 'utf8' });
      return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    };
    const intact = (home: string): void => { for (const n of all) expect(existsSync(join(backupRoot(home), n)), n).toBe(true); };

    it('the helper is missing from the running tree (a rollback to a tree that predates it): prune skipped, the reason says so', () => {
      const home = home0('ccrc-fx-8b-i1-nohelper-');
      const tree = join(home, 'older-tree', 'ccd');
      mkdirSync(tree, { recursive: true });
      copyFileSync(join(REPO, 'ccd', 'ccrc'), join(tree, 'ccrc'));
      expect(existsSync(join(home, 'older-tree', 'deploy'))).toBe(false);
      const r = prune(home, join(tree, 'ccrc'));
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(r.stdout).toMatch(/^backup: prune skipped — the coordination snapshot classifier failed \(deploy\/coordination-snapshot\.mjs is not in the running ccrc tree .*\), so nothing can say/m);
      expect(r.stdout).toMatch(/nothing was pruned$/m);
      expect(r.stdout).not.toMatch(/^backup: pruned/m);
      intact(home);
    });

    it('node cannot load the helper (it exits 1 with no output): that is a FAILURE, never "none"', () => {
      const home = home0('ccrc-fx-8b-i1-exit1-');
      const r = prune(home, join(REPO, 'ccd', 'ccrc'), withShim(home, { FX_CLASSIFY_EXIT1: '1' }));
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(r.stdout).toMatch(/^backup: prune skipped — the coordination snapshot classifier failed \(the classifier answered exit 1, ""\)/m);
      expect(r.stdout).not.toMatch(/^backup: pruned/m);
      intact(home);
    });

    it('a well-formed word with the wrong exit code (rc 0 and `none`) is a failure too', () => {
      const home = home0('ccrc-fx-8b-i1-mismatch-');
      const r = prune(home, join(REPO, 'ccd', 'ccrc'), withShim(home, { FX_CLASSIFY_MISMATCH: '1' }));
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(r.stdout).toMatch(/^backup: prune skipped — the coordination snapshot classifier failed \(the classifier answered exit 0, "none: shim"\)/m);
      expect(r.stdout).not.toMatch(/^backup: pruned/m);
      intact(home);
    });

    it('a line on STDERR does not spoil a good answer: the shim writes one and runs the real helper, and the prune proceeds normally (N2)', () => {
      const home = home0('ccrc-fx-8b-n2-stderr-');
      const r = prune(home, join(REPO, 'ccd', 'ccrc'), withShim(home, { FX_CLASSIFY_STDERR: '1' }));
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(r.stdout).not.toMatch(/prune skipped/);
      expect(existsSync(join(backupRoot(home), '20250102-000000')), 'the valid snapshot is the keep').toBe(true);
      expect(existsSync(join(backupRoot(home), '20250101-000000')), 'a plain dir is pruned').toBe(false);
      expect(existsSync(join(backupRoot(home), '20250103-000000')), 'a plain dir is pruned').toBe(false);
    });

    it('the stderr temp file is removed on every classification: a private TMPDIR is empty afterwards (N7)', () => {
      const home = home0('ccrc-fx-8b-n7-tmp-');
      const priv = join(home, 'private-tmp');
      mkdirSync(priv);
      // The shim writes a stderr line, so the temp file carries something worth leaking; the prune classifies the v1 dir.
      const r = prune(home, join(REPO, 'ccd', 'ccrc'), withShim(home, { FX_CLASSIFY_STDERR: '1', TMPDIR: priv }));
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(nodeOrder(home).filter((l) => l === 'helper validate').length, 'the classifier ran').toBeGreaterThan(0);
      expect(readdirSync(priv)).toEqual([]);
    });

    it('a classifier whose stdout has a THIRD line is a failure: nothing pruned, the reason says so (N2)', () => {
      const home = home0('ccrc-fx-8b-n2-third-');
      const r = prune(home, join(REPO, 'ccd', 'ccrc'), withShim(home, { FX_CLASSIFY_EXTRA: '1' }));
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(r.stdout).toMatch(/^backup: prune skipped — the coordination snapshot classifier failed \(the classifier's answer had more than two lines\)/m);
      intact(home);
    });

    it('node missing from PATH is a failure, and `ccrc update`\'s own prune warns and keeps everything on a node exiting 1', () => {
      const home = home0('ccrc-fx-8b-i1-update-');
      packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
      const u = runUpdate(home, [], withShim(home, { CCRC_BACKUP_KEEP: '0', FX_CLASSIFY_EXIT1: '1' }));
      expect(u.code, `stderr: ${u.stderr}\nstdout: ${u.stdout}`).toBe(0);
      expect(u.stdout).toMatch(/^update: backups: WARN: the coordination snapshot classifier failed \(the classifier answered exit 1, ""\)/m);
      intact(home);
      const home2 = home0('ccrc-fx-8b-i1-nonode-');
      // `command -v node` answers 1, as on a box whose PATH has no node (the rest of PATH stays, so flock and the others still resolve).
      const r = spawnSync(BASH, ['-c', '. "$1"; command() { if [ "$1 $2" = "-v node" ]; then return 1; fi; builtin command "$@"; }; UPD_BAK_FLOOR=20300101-000000; UPD_BACKUP_DIR=""; CCRC_BACKUP_KEEP=0; _bak_prune', 'x', join(REPO, 'ccd', 'ccrc')],
        { env: updateEnv(home2), encoding: 'utf8' });
      expect(r.stdout).toMatch(/classifier failed \(node is not on PATH\)/);
      intact(home2);
    });
  });

  it('`ccrc coordination-snapshot validate|restore|recover` reaches the helper and exits with its code: 0 v1, 1 none, 2 invalid, 70 for usage (I2)', () => {
    const home = freshUpdateBox('ccrc-fx-8b-verb-');
    plantOldBox(home, { version: 'v1.0.0' });
    const dir = plantDir(home, '20250101-000000', 'v1-sidecars');
    const ccrc = (args: string[], env: NodeJS.ProcessEnv = {}, script = join(REPO, 'ccd', 'ccrc')): Result => {
      const r = spawnSync(BASH, [script, 'coordination-snapshot', ...args], { env: { ...updateEnv(home), ...env }, encoding: 'utf8' });
      return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    };
    expect(ccrc(['validate', '--from', dir])).toMatchObject({ code: 0, stdout: 'v1: a valid manifest, initialized delegation, coord.db absent\ndata: yes\n' });
    expect(ccrc(['validate', '--from', join(backupRoot(home), '20250199-000000')]).code).toBe(2);
    const empty = plantDir(home, '20250102-000000', 'plain');
    expect(ccrc(['validate', '--from', empty])).toMatchObject({ code: 1, stdout: 'none: no manifest, no sidecars and no coord.db\ndata: no\n' });
    // `recover` with nothing to recover is the helper's `none` and exits 0 (it needs no service measurement).
    expect(ccrc(['recover'])).toMatchObject({ code: 0, stdout: 'coordination restore recovery: none\n' });
    for (const bad of [[], ['validate'], ['validate', '--from'], ['restore', dir], ['recover', 'now'], ['explode']]) {
      const r = ccrc(bad);
      expect(r.code, bad.join(' ')).toBe(70);
      expect(r.stderr, bad.join(' ')).toMatch(/usage: ccrc coordination-snapshot/);
    }
    expect(ccrc(['--help']).stdout).toMatch(/coordination-snapshot/);
    // A missing helper and a missing node are 70 too, never `_ccrc_die`'s 1 (which is `none`).
    const bare = join(home, 'bare-tree', 'ccd');
    mkdirSync(bare, { recursive: true });
    copyFileSync(join(REPO, 'ccd', 'ccrc'), join(bare, 'ccrc'));
    const noHelper = ccrc(['validate', '--from', dir], {}, join(bare, 'ccrc'));
    expect(noHelper.code).toBe(70);
    expect(noHelper.stderr).toMatch(/the helper deploy\/coordination-snapshot\.mjs is missing from this tree/);
    const emptyBin = join(home, 'empty-bin');
    mkdirSync(emptyBin);
    const noNode = spawnSync(BASH, ['-c', 'PATH="$3"; exec "$1" "$2" coordination-snapshot validate --from "$4"', 'x', BASH, join(REPO, 'ccd', 'ccrc'), emptyBin, dir], { env: updateEnv(home), encoding: 'utf8' });
    expect(noNode.status).toBe(70);
    expect(noNode.stderr).toMatch(/node is required by 'ccrc coordination-snapshot'/);
  });

  itLinux('restore and recover take ~/.ccrc/update.lock: another ccrc run holding it is a refusal (exit 2) that changes nothing (M2)', () => {
    const home = freshUpdateBox('ccrc-fx-8b-verb-lock-');
    plantOldBox(home, { version: 'v1.0.0' });
    const dir = plantDir(home, '20250101-000000', 'v1-sidecars');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    const lock = join(home, '.ccrc', 'update.lock');
    writeFileSync(lock, '');
    // `flock` FORKS its command, so killing `flock` alone left `sleep 60` running past the run (#172, D-5894): the
    // holder leads a process group of its own, and the `finally` ends that group through the handle this test holds.
    const holder = spawn(FLOCK, ['-n', lock, 'sleep', '60'], { stdio: 'ignore', detached: true });
    try {
      // Wait (bounded) until the holder really has the lock: a fresh `flock -n` on it must fail.
      const t0 = Date.now();
      while (spawnSync(FLOCK, ['-n', lock, 'true']).status === 0) {
        if (Date.now() - t0 > 5000) throw new Error('the lock holder never took the lock');
        spawnSync('sleep', ['0.1']);
      }
      const run = (args: string[]): Result => {
        const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'coordination-snapshot', ...args], { env: updateEnv(home), encoding: 'utf8' });
        return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
      };
      for (const args of [['restore', '--from', dir], ['recover']]) {
        const r = run(args);
        expect(r.code, args.join(' ')).toBe(2);
        expect(r.stderr, args.join(' ')).toMatch(/another ccrc run holds ~\/\.ccrc\/update\.lock — nothing was changed/);
      }
      expect(existsSync(join(home, '.ccrc', 'coordination-restore.json'))).toBe(false);
      // `validate` reads only and takes no lock.
      expect(run(['validate', '--from', dir]).code).toBe(0);
    } finally {
      if (holder.pid !== undefined) killGroup(holder.pid);   // the group this test itself started
    }
  });
});

describe('ccrc update: the codex steps ride the staged spine (Plan 2b-2 Task 10)', () => {
  it('the harness contains the transient-unit launcher: it resolves inside this HOME and refuses', () => {
    const home = freshUpdateBox('ccrc-update-sdrun-contained-');
    const r = spawnSync(BASH, ['-c', SPINE_CONTAINMENT_PROBE], { env: updateEnv(home), encoding: 'utf8' });
    expect(r.stdout).toContain(`at=${join(home, '.local', 'bin', 'systemd-run')}\n`);
    expect(r.stdout).toMatch(/^run-rc=97$/m);
    expect(r.stdout).toMatch(/^env-rc=0$/m);
    expect(spineRunCalls(home).join('\n')).toContain('--unit=fixture-containment-probe.service');
  });

  it('an update re-runs both codex steps, in spine order: the runtime before the services, the restart after them', () => {
    // `cmd_update` runs the STAGED tree's `cmd_install` as a process
    // (m-spine §1), so a runtime rebuild and a stale-tier restart ride every
    // update with no `_upd_*` code at all; this is the proof that they do, and
    // that the staged spine keeps D-3485's order.
    const home = freshUpdateBox('ccrc-update-codex-steps-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantCoordDb(home);
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const out = r.stdout.split('\n');
    const at = (re: RegExp): number => out.findIndex((l) => re.test(l));
    const runtime = at(/^install: codex runtime: none — no codex lane in the roster$/);
    const services = at(/^install: services: /);
    const tiers = at(/^install: codex tiers: none — no codex lane in the roster$/);
    expect(runtime, 'the staged spine never ran _inst_codex_runtime').toBeGreaterThan(-1);
    expect(tiers, 'the staged spine never ran _inst_codex_tiers').toBeGreaterThan(-1);
    expect(runtime).toBeLessThan(services);
    expect(tiers).toBeGreaterThan(services);
    expect(spineRunCalls(home)).toEqual([]);
  });
});

// Plan 3a Task 10, re-seated by Plan 4: the merge is itself an inert rollout. The REAL update onto this tree, on a box
// whose roster has no codex lane — its one GPT-shaped row, `ext-a`, is `external` (the shape the GPT lanes had before
// their flip) and has the launcher such a row owes — on the box the "codex steps ride the staged spine" describe above
// uses. The other repository's files it once ran over (`plantLiveShape`) are retired with that repository's lane, and
// so is the snapshot of them. One ccgpt- unit stays on the box, the other repository's flat usage timer, enabled, so
// that the state-changing-verb check has a unit to catch: a flat one, never an instance for `ext-a`, which would make
// the converge withhold that row and hide a converge that took it for a codex lane.
describe('Plan 3a Task 10 — ccrc update onto this tree on a box with no codex lane (Plan 4)', () => {
  itLinux('a real update on a box with no codex lane names no ccgpt- unit in a state-changing verb, and builds nothing (Plan 4)', () => {
    const home = freshUpdateBox('ccrc-update-no-codex-lane-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantCoordDb(home);
    codexRoster(home, [], [externalCodexRow('ext-a')]);
    plantExternalLauncher(home, 'ext-a');
    plantForeignUsage(home, null);
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const calls = existsSync(join(home, 'systemctl-calls'))
      ? readFileSync(join(home, 'systemctl-calls'), 'utf8').split('\n').filter(Boolean) : [];
    expect(stateCallsNaming(calls, /\bccgpt-/), 'a state-changing systemctl verb named a ccgpt- unit').toEqual([]);
    expect(calls.filter((a) => /^--user enable --now ccrc-codex-usage@/.test(a)),
      'an instance was enabled on a box with no codex lane').toEqual([]);
    expect(spineRunCalls(home)).toEqual([]);
    expect(existsSync(join(home, '.ccrc', 'runtime', 'codex')), 'a runtime was built').toBe(false);
    expect(existsSync(join(home, '.ccrc', 'codex')), 'lane state was written').toBe(false);
    expect(r.stdout.split('\n').filter((l) => l.startsWith('SKIP codex: ')), 'the staged spine\'s closing doctor')
      .toHaveLength(1);
  }, 120_000);
});

// R20a (centralised-update wave 13): each test's fixture homes go in a root `afterEach`, not all at once in the
// file's `afterAll`. Measured at 9221416a: the three parts of this file leave 648 homes, about 99,700 entries and
// 2.47 GB to that one hook, which overran vitest's 20 s hook timeout on CI shards at 670d25fd and 7b0a5454. It sits
// at the END of the file so no line above moves: a top-level hook registers on the root suite wherever it is
// written, because vitest collects the whole file before it runs a test.
removeTmpFixturesEachTest();

