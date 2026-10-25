// Part of the `ccrc update` suite, split by describe block from the former single file (D-6767).
// The shared box, tarball and runner fixtures live in `ccrc-updateFixture.ts`; this file holds only
// the cases of its own describe blocks, with their titles and bodies unchanged. Its siblings are
// `ccrc-update-*.test.ts`.

import { describe, it, expect, beforeAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, lstatSync, chmodSync, readdirSync, appendFileSync, renameSync, rmSync, symlinkSync, readlinkSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { ccrcContainedEnv } from './ccrcContainment.js';
import { assertNoRealTool } from './containedTools.js';
import { itLinux } from './platformFixtures.js';
import { markGenerated } from '../../shared/mark.mjs';
import { installVersionedTree, keepDigest } from './installTreeFixture.js';
import {
  REPO,
  realPath,
  BASH,
  REAL_PYTHON3,
  type Result,
  updateEnv,
  replantDoctorStubs,
  plantOldBox,
  writeManifest,
  shippedStamp,
  fullTree,
  stubTree,
  selfConvergedTree,
  packRelease,
  runUpdate,
  freshUpdateBox,
  plantKillModeDropIn,
  UNIT_LINES,
  homeSnapshot,
  treeDigest,
  localUrls,
  sourcedCcrc,
  reportWrites,
  lastReport,
  INTENT_NOW,
  intentDoc,
  plantIntent,
  plantRole,
  plantSyncTimer,
  plantClock,
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

/** The installed body for a tree's ccd source: ccd-entry-install.py swaps the source's line-2 placeholder, in place,
 *  for the marker `markGenerated` writes (install-time stamping; ccd-install-stamp.test.ts owns the rule). */
const installedBodyOf = (src: string): string => {
  const lines = readFileSync(src, 'utf8').split('\n');
  if ((lines[1] ?? '').startsWith('# ccrc:stamp-at-install')) lines.splice(1, 1);
  return markGenerated(lines.join('\n'));
};

describe('ccrc update: restore arm 1 — a flip back to the kept previous version (W6 Task 4)', () => {
  const GATE_DENIED = 'gate: GET http://127.0.0.1:7788/health got no answer (curl exited 7)';
  const phasesOf = (home: string): string[] => reportWrites(home).map((w) => String(w['phase']));

  it('a FULL gate failure on a box whose previous version is kept restores by arm 1: ~/ccrc flipped back, that version\'s own spine re-run, the gate once more — no release URL of the previous tag, and the stamp, the record and ~/.local/bin/ccd are the kept version\'s (spec §11 arm 1; §18 "the gate restores", "the automatic restore does not sweep"; Review Focus 1)', () => {
    const home = onKeptV1('ccrc-update-arm1-');
    const v1 = join(home, 'ccrc-versions', 'v1.0.0');
    // The kept copies, measured BEFORE this case's run. The spine a flip
    // back runs is this checkout's own, and its `_inst_installed` ends in
    // `_ver_keep_state install`, which copies the box's stamp and record
    // over these two files: a box-vs-kept-copy comparison AFTER the run is
    // equal by construction, whatever the bytes (a verified version
    // re-recorded `unsigned` would pass it). The snapshot is the subject.
    const keptStamp = fileText(join(v1, '.ccrc-stamp.json'));
    const keptRec = fileText(join(v1, '.ccrc-installed'));
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: V2_SHA }), { tag: 'v2.0.0' });
    // v2.0.0's server never comes up; v1.0.0's does, once its stamp is back.
    writeFileSync(join(home, 'fixture-health-deny'), 'v2.0.0\n');
    // A sweep that RAN would leave a try-restart: make one possible, so its
    // absence below is the restore's, not the preflight's.
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout).toMatch(/^update: gate FAILED after \d+s — GET http:\/\/127\.0\.0\.1:7788\/health got no answer \(curl exited 7\)$/m);
    expect(r.stdout).toContain('update: arm 1: v1.0.0 is kept at $HOME/ccrc-versions/v1.0.0 — flipping back to it (no download)');
    expect(r.stdout).toContain('update: flip: $HOME/ccrc -> $HOME/ccrc-versions/v1.0.0; its stamp and install record restored; its own spine re-placed the executables, hooks and units (no release download)');
    expect(r.stdout).toMatch(/^update: gate: both answers on v1\.0\.0 /m);
    expect(r.stdout).toContain(`update: REVERTED (arm 1): this box runs v1.0.0 again — $HOME/ccrc flipped back to $HOME/ccrc-versions/v1.0.0, no download — ${GATE_DENIED}`);
    expect(r.stdout).not.toMatch(/^update: arm2|^update: arm 2|REVERTED \(arm [23]\)/m);
    const last = lastReport(home);
    expect(last['phase']).toBe('reverted');
    expect(last['detail']).toBe(`arm1: flipped back to v1.0.0; ${GATE_DENIED}`);
    expect(last['target']).toBe('v2.0.0');
    // `_upd_gate` is the one writer of `checking`: "the gate once more" is a second one.
    expect(phasesOf(home).slice(-4)).toEqual(['checking', 'restoring', 'checking', 'reverted']);
    // No download of the tag it returned to: the run fetched v2.0.0 and nothing else.
    const urls = localUrls(home);
    expect(urls.length, 'the update fetched nothing at all — the control is broken').toBeGreaterThan(0);
    expect(urls.filter((u) => !u.startsWith(`local://${home}/releases/latest/download/`))).toEqual([]);
    // The flip, and the box's identity with it: the KEPT version's stamp
    // and record as they were before the run, and the kept copies unmoved.
    expect(linkOf(home)).toBe(v1);
    expect(fileText(join(home, '.ccrc', 'build.json'))).toBe(keptStamp);
    expect(fileText(join(home, '.ccrc', 'installed'))).toBe(keptRec);
    expect(fileText(join(v1, '.ccrc-stamp.json')), 'the kept stamp was rewritten').toBe(keptStamp);
    expect(fileText(join(v1, '.ccrc-installed')), 'the kept record was rewritten').toBe(keptRec);
    expect(fileText(join(home, '.local', 'libexec', 'ccrc', 'ccd'))).toBe(installedBodyOf(join(v1, 'ccd/ccd')));
    expect(fileText(join(home, '.local', 'libexec', 'ccrc', 'ccd'))).toContain(CCD_SENTINEL);
    // A return is not a new baseline, and the floor never lowers.
    expect(fileText(join(home, '.ccrc', 'previous'))).toBe(`v1.0.0\n${V1_SHA}\n`);
    expect(fileText(join(home, '.ccrc', 'floor'))).toBe('v2.0.0\n');
    if (process.platform !== 'darwin') {
      expect(fileText(join(home, 'systemctl-calls')), 'the automatic restore swept the supervisors').not.toMatch(/try-restart/);
    }
    // The exit-4 sentence names the FIRST gate's failure, not arm 1's passing
    // re-gate (D-3444).
    expect(r.stderr).toContain(`update: v2.0.0 was installed, but the box did not come back healthy on it (${GATE_DENIED.slice('gate: '.length)}) — exit 4.`);
  }, 60_000);

  // C26 (review 155; W6 Task 8A). Arm 2 runs its restore child from the tree
  // just installed. After `ccrc update --to <a release older than wave 4>
  // --downgrade` whose gate fails, that tree's `ccrc` does not know
  // `--no-gate` or `--from`, so the child exits 2 and arm 3 used to leave a
  // MIXED tree. The pre-update version directory is kept, so arm 1 — the flip
  // back — answers before arm 2 is reached.
  it('C26: a gate-failed downgrade onto a release older than wave 4 ends on ARM 1 — ~/ccrc flipped back to the previous version directory, byte-unchanged, and no mixed tree: the old tree\'s ccrc, which refuses --no-gate and --from, is never asked to be the restore child (review 155 C26; spec §11 arm 1)', () => {
    const home = freshUpdateBox('ccrc-update-arm1-preW4-');
    const cur = plantW6Box(home, 'v2.0.0', V2_SHA, 'server');
    // v2.0.0's own spine is the recorder, and it clears the stub shim's
    // `fixture-health-version` so that, once the kept stamp is back, /health
    // answers the box's stamp (v2.0.0) and not the release just "installed".
    writeFileSync(join(cur, 'ccd', 'ccrc'), KEPT_SPINE.replace('#!/bin/sh\n', '#!/bin/sh\nrm -f "$HOME/fixture-health-version"\n'), { mode: 0o755 });
    keepDigest(cur, home);   // the spine is part of v2.0.0's kept bytes (D-3465)
    // The release older than wave 4: its spine writes THROUGH ~/ccrc (it
    // predates versioned installs, so `_upd_legacy_target` hands it a
    // directory of its own) and places a `ccd/ccrc` that knows neither flag
    // arm 2's child needs. It stamps the box as its own release.
    packRelease(home, stubTree(home, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
    // v2.0.0 is published too (with its bundle), so that WITHOUT arm 1 arm 2
    // would go on to run its child — the hazard this pin is for — rather than
    // refusing at the bundle question.
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    writeFileSync(join(home, 'fixture-old-stamp.json'), shippedStamp('v1.0.0', V1_SHA));
    writeFileSync(join(home, 'fixture-on-install'), [
      'mkdir -p "$HOME/ccrc/ccd" && cat > "$HOME/ccrc/ccd/ccrc" <<\'PREW4\'',
      '#!/bin/sh',
      'printf \'%s\\n\' "$0" "$@" > "$HOME/pre-w4-ccrc-argv"',
      'case " $* " in *" --no-gate "*|*" --from "*) echo "ccrc: unknown option: $*" >&2; exit 2 ;; esac',
      'exit 0',
      'PREW4',
      'chmod 755 "$HOME/ccrc/ccd/ccrc"',
      'cp "$HOME/fixture-old-stamp.json" "$HOME/.ccrc/build.json"',
    ].join('\n') + '\n');
    writeFileSync(join(home, 'fixture-stub-installed'), 'yes\n');
    // Its release never comes up; v2.0.0's does, once its stamp is back.
    writeFileSync(join(home, 'fixture-health-deny'), 'v1.0.0\n');
    const curBefore = treeDigest(cur);
    const keptStamp = fileText(join(cur, '.ccrc-stamp.json'));
    const keptRec = fileText(join(cur, '.ccrc-installed'));
    const r = runUpdate(home, ['--to', 'v1.0.0', '--downgrade']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout).toMatch(/^update: gate FAILED after \d+s — /m);
    expect(r.stdout).toContain('update: arm 1: v2.0.0 is kept at $HOME/ccrc-versions/v2.0.0 — flipping back to it (no download)');
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 1\): this box runs v2\.0\.0 again — \$HOME\/ccrc flipped back to \$HOME\/ccrc-versions\/v2\.0\.0, no download — /m);
    // Arm 2 and arm 3 never ran: the old tree's ccrc was never the child,
    // and nothing says MIXED.
    expect(existsSync(join(home, 'pre-w4-ccrc-argv')), 'the old release\'s ccrc was run as arm 2\'s child').toBe(false);
    expect(r.stdout).not.toMatch(/arm 2|arm 3|MIXED|deploy\.sh/);
    expect(String(lastReport(home)['detail'])).toMatch(/^arm1: flipped back to v2\.0\.0; /);
    expect(lastReport(home)['phase']).toBe('reverted');
    // The previous version directory is what is active, byte for byte, with
    // its stamp and record the box's again; the floor is where it was.
    expect(linkOf(home)).toBe(cur);
    expect(treeDigest(cur), 'the version the update replaced was written').toEqual(curBefore);
    expect(fileText(join(home, '.ccrc', 'build.json'))).toBe(keptStamp);
    expect(fileText(join(home, '.ccrc', 'installed'))).toBe(keptRec);
    expect(fileText(join(home, '.ccrc', 'floor'))).toBe('v2.0.0\n');
    // The directory the old spine wrote into is not the active one. (It stays
    // kept: `_ver_keep_state update` marks a completed spine before the gate,
    // as it does for a W6 spine whose gate then fails — that is not this
    // item's, and no restore path reads it as `current`.)
    expect(linkOf(home)).not.toBe(join(home, 'ccrc-versions', 'v1.0.0'));
  }, 60_000);

  // The marker the dying spine leaves, as the stub npm writes it. Since D-3457
  // an `_inst_tree`-marked death before the flip is "nothing replaced" (exit 1,
  // no gate), so these are the two shapes `_upd_step_moved` still reads as
  // moved with `_upd_tree_untouched` never consulted: a newer spine's step
  // this ccrc's CCRC_INST_SPINE does not list, and an unreadable marker.
  it.each([
    ['a newer spine\'s step', '_inst_zz_newer_step', '_inst_zz_newer_step'],
    ['an unreadable marker', 'not a step name; rm -rf', 'unreadable'],
  ] as const)('a staged spine that dies before its flip with %s that reads as MOVED leaves ~/ccrc on the previous version: arm 1 restores it IN PLACE — its kept stamp, its own spine, the gate once more — with no download, no npm ci in the running version, and that version byte-unchanged (D-3445, D-3457)', (_what, marker, named) => {
    const home = onKeptV1('ccrc-update-arm1-in-place-');
    const v1 = join(home, 'ccrc-versions', 'v1.0.0');
    // A dependency the running version already holds. Arm 2's same-name
    // `npm ci` in v1.0.0 is what would empty this directory; the recorder npm
    // does not, so `npm-cwd` below is what measures that it never ran there.
    mkdirSync(join(v1, 'server', 'node_modules'), { recursive: true });
    writeFileSync(join(v1, 'server', 'node_modules', '.fixture-dep'), 'installed\n');
    const ccdBefore = treeDigest(join(v1, 'ccd'));
    const distBefore = treeDigest(join(v1, 'server', 'dist'));
    rmSync(join(home, 'npm-cwd'), { force: true });
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: V2_SHA }), { tag: 'v2.0.0' });
    // `npm ci` refuses in v2.0.0's new directory only (a registry hiccup,
    // the placement's likeliest failure); every other npm call records and
    // succeeds. Ahead of the recorder npm that `runUpdate` re-plants.
    mkdirSync(join(home, 'fail-bin'), { recursive: true });
    writeFileSync(join(home, 'fail-bin', 'npm'), [
      '#!/bin/sh',
      'printf \'%s\\n\' "$PWD" >> "$HOME/npm-cwd"',
      `case "$PWD" in */ccrc-versions/v2.0.0/*) echo "fixture npm: registry unreachable" >&2; printf '%s\\n' '${marker}' > "$HOME/.ccrc/install-step"; exit 1 ;; esac`,
      'mkdir -p node_modules',
      'exit 0',
    ].join('\n') + '\n', { mode: 0o755 });
    const r = runUpdate(home, [], { PATH: `${join(home, 'fail-bin')}:${updateEnv(home)['PATH'] ?? ''}` });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    // The spine died in `_inst_tree`'s npm ci, before its flip: `~/ccrc` never moved.
    expect(r.stdout).toMatch(/^update: gate FAILED after \d+s — \/health at 127\.0\.0\.1:7788 answers v1\.0\.0, not v2\.0\.0$/m);
    expect(r.stdout).not.toMatch(/^install: tree: \$HOME\/ccrc -> /m);
    expect(r.stdout).toContain('update: arm 1: $HOME/ccrc still points at v1.0.0, which is kept complete — re-running its own spine in place (no download)');
    // The kept spine ran FROM the running version: Task 2's `running` answer,
    // with its kept record present, so nothing was copied and no npm ci ran.
    expect(r.stdout).toMatch(/^install: tree: already running from \$HOME\/ccrc$/m);
    expect(r.stdout).toMatch(/^install: tree: v1\.0\.0 is kept \(its install record is present and its digest re-measures equal\) — no npm ci$/m);
    expect(r.stdout).toMatch(/^update: gate: both answers on v1\.0\.0 /m);
    expect(r.stdout).toMatch(new RegExp(`^update: REVERTED \\(arm 1\\): this box runs v1\\.0\\.0 again — \\$HOME/ccrc never left \\$HOME/ccrc-versions/v1\\.0\\.0; its own spine re-ran, no download — spine died at ${named}; gate: `, 'm'));
    expect(r.stdout).not.toMatch(/^update: arm 2|REVERTED \(arm [23]\)/m);
    expect(String(lastReport(home)['detail'])).toMatch(new RegExp(`^arm1: restored v1\\.0\\.0 in place; spine died at ${named}; gate: `));
    // No download of the tag it restored: the run fetched v2.0.0 and nothing else.
    const urls = localUrls(home);
    expect(urls.length, 'the update fetched nothing at all — the control is broken').toBeGreaterThan(0);
    expect(urls.filter((u) => !u.startsWith(`local://${home}/releases/latest/download/`))).toEqual([]);
    const npmDirs = fileText(join(home, 'npm-cwd')).split('\n').filter((l) => l !== '');
    expect(npmDirs.some((d) => d.includes('/ccrc-versions/v2.0.0/')), 'npm never ran in v2.0.0 — the control is broken').toBe(true);
    expect(npmDirs.filter((d) => d.includes('/ccrc-versions/v1.0.0')), 'npm ran in the running version').toEqual([]);
    // The running version is the one it was: its tree, its deps, its kept record.
    expect(linkOf(home)).toBe(v1);
    expect(treeDigest(join(v1, 'ccd')), 'an in-place rsync rewrote the running version').toEqual(ccdBefore);
    expect(treeDigest(join(v1, 'server', 'dist'))).toEqual(distBefore);
    expect(fileText(join(v1, 'server', 'node_modules', '.fixture-dep'))).toBe('installed\n');
    expect(existsSync(join(v1, '.ccrc-installed')), 'the running version stopped claiming completeness').toBe(true);
    expect(fileText(join(home, '.local', 'libexec', 'ccrc', 'ccd'))).toContain(CCD_SENTINEL);
  }, 60_000);

  it('arm 1 with ~/ccrc already ON the previous version restores it IN PLACE — unit pin, the arm called directly on a FULL box: its kept stamp, its own spine, the gate once more, no download, no npm ci in the running version, that version byte-unchanged (D-3445; the end-to-end case above reaches it through cmd_update; an `_inst_tree`-marked death never gets here, D-3457)', () => {
    const home = onKeptV1('ccrc-update-arm1-in-place-');
    const v1 = join(home, 'ccrc-versions', 'v1.0.0');
    // A dependency the running version already holds. Arm 2's same-name
    // `npm ci` in v1.0.0 is what would empty this directory; the recorder npm
    // below does not, so `npm-cwd` is what measures that none ran there.
    mkdirSync(join(v1, 'server', 'node_modules'), { recursive: true });
    writeFileSync(join(v1, 'server', 'node_modules', '.fixture-dep'), 'installed\n');
    const ccdBefore = treeDigest(join(v1, 'ccd'));
    const distBefore = treeDigest(join(v1, 'server', 'dist'));
    rmSync(join(home, 'npm-cwd'), { force: true });
    mkdirSync(join(home, 'fail-bin'), { recursive: true });
    writeFileSync(join(home, 'fail-bin', 'npm'), [
      '#!/bin/sh', 'printf \'%s\\n\' "$PWD" >> "$HOME/npm-cwd"', 'mkdir -p node_modules', 'exit 0',
    ].join('\n') + '\n', { mode: 0o755 });
    // What a run to v2.0.0 leaves when its gate failed with `~/ccrc` never
    // having left v1.0.0: `previous` names v1.0.0, and the record was cleared
    // before the staged spine.
    writeFileSync(join(home, '.ccrc', 'previous'), `v1.0.0\n${V1_SHA}\n`);
    rmSync(join(home, '.ccrc', 'installed'));
    // `sourcedCcrc` re-plants the poisoned `gh` (`updateEnv`), and a real kept
    // spine ends with doctor: on the poison it FAILs, which is now (F9) part of
    // what arm 1's line says. This case is about a CLEAN restore, so the doctor
    // stubs `runUpdate` re-plants before every run are re-planted by the script.
    const r = sourcedCcrc(home, [
      'cp "$HOME"/doctor-stubs/* "$HOME/.local/bin/"',
      'export PATH="$HOME/fail-bin:$PATH" CCRC_UPDATE_HEALTH_S=0',
      'UPD_VERSION=v2.0.0; UPD_REPORT_TARGET=v2.0.0; UPD_GATE_WHY="the first gate"',
      'rc=0; _upd_restore_arm1 "" "spine died at _inst_tree" v1.0.0 1 || rc=$?',
      'echo "rc=$rc first=$UPD_GATE_WHY"',
    ].join('\n'));
    expect(r.stdout, `stderr: ${r.stderr}`).toContain('update: arm 1: $HOME/ccrc still points at v1.0.0, which is kept complete — re-running its own spine in place (no download)');
    // The kept spine ran FROM the running version: Task 2's `running` answer,
    // with its kept record present, so nothing was copied and no npm ci ran.
    expect(r.stdout).toMatch(/^install: tree: already running from \$HOME\/ccrc$/m);
    expect(r.stdout).toMatch(/^install: tree: v1\.0\.0 is kept \(its install record is present and its digest re-measures equal\) — no npm ci$/m);
    expect(r.stdout).toMatch(/^update: gate: both answers on v1\.0\.0 /m);
    expect(r.stdout).toContain('update: REVERTED (arm 1): this box runs v1.0.0 again — $HOME/ccrc never left $HOME/ccrc-versions/v1.0.0; its own spine re-ran, no download — spine died at _inst_tree');
    expect(r.stdout).not.toMatch(/^update: arm 2|REVERTED \(arm [23]\)/m);
    expect(r.stdout).toMatch(/^rc=0 first=the first gate$/m);
    expect(lastReport(home)).toMatchObject({ phase: 'reverted', detail: 'arm1: restored v1.0.0 in place; spine died at _inst_tree' });
    expect(localUrls(home), 'arm 1 fetched something').toEqual([]);
    const npmDirs = existsSync(join(home, 'npm-cwd')) ? fileText(join(home, 'npm-cwd')).split('\n').filter((l) => l !== '') : [];
    expect(npmDirs.filter((d) => d.includes('/ccrc-versions/v1.0.0')), 'npm ran in the running version').toEqual([]);
    // The running version is the one it was: its tree, its deps, its kept record.
    expect(linkOf(home)).toBe(v1);
    expect(treeDigest(join(v1, 'ccd')), 'an in-place rsync rewrote the running version').toEqual(ccdBefore);
    expect(treeDigest(join(v1, 'server', 'dist'))).toEqual(distBefore);
    expect(fileText(join(v1, 'server', 'node_modules', '.fixture-dep'))).toBe('installed\n');
    expect(existsSync(join(v1, '.ccrc-installed')), 'the running version stopped claiming completeness').toBe(true);
    expect(fileText(join(home, '.local', 'libexec', 'ccrc', 'ccd'))).toContain(CCD_SENTINEL);
  }, 60_000);

  it('arm 1 whose kept spine COMPLETED under a failing doctor still reverts, and the report and the line say the doctor exited N — as arm 2\'s rc-3 arm does (F9; the flip stubbed to VER_SPINE_RC=3, the arm called directly)', () => {
    const home = freshUpdateBox('ccrc-update-arm1-doctor-');
    plantW6Box(home, 'v2.0.0', V2_SHA, 'server');
    keptVersion(home, 'v1.0.0', V1_SHA);
    writeFileSync(join(home, '.ccrc', 'previous'), `v1.0.0\n${V1_SHA}\n`);
    const r = sourcedCcrc(home, [
      '_ver_flip_back() { VER_SPINE_RC=3; return 0; }; _upd_gate() { return 0; }',
      'UPD_VERSION=v3.0.0; UPD_REPORT_TARGET=v3.0.0; UPD_GATE_WHY="the first gate"',
      'rc=0; _upd_restore_arm1 server "gate: fixture" v2.0.0 1 || rc=$?',
      'echo "rc=$rc"',
    ].join('\n'));
    expect(r.stdout, `stderr: ${r.stderr}`).toContain('update: REVERTED (arm 1): this box runs v1.0.0 again — $HOME/ccrc flipped back to $HOME/ccrc-versions/v1.0.0, no download, but its doctor exited 3 (\'ccrc doctor\' re-reads the FAIL lines) — gate: fixture');
    expect(r.stdout).toMatch(/^rc=0$/m);
    expect(lastReport(home)).toMatchObject({ phase: 'reverted', detail: 'arm1: flipped back to v1.0.0 (its doctor exited 3); gate: fixture' });
    // The clean spine reads as before (the control): no doctor clause.
    const clean = sourcedCcrc(home, [
      '_ver_flip_back() { VER_SPINE_RC=0; return 0; }; _upd_gate() { return 0; }',
      'UPD_VERSION=v3.0.0; UPD_REPORT_TARGET=v3.0.0; UPD_GATE_WHY="the first gate"',
      '_upd_restore_arm1 server "gate: fixture" v2.0.0 1; echo "rc=$?"',
    ].join('\n'));
    expect(clean.stdout, `stderr: ${clean.stderr}`).toContain('update: REVERTED (arm 1): this box runs v1.0.0 again');
    expect(clean.stdout).not.toContain('its doctor exited');
  });

  it('arm 1 whose own gate fails points ~/ccrc back at the new version and clears the record; arm 3 then voids THAT version\'s kept record, so no later flip returns to its MIXED tree (D-3443, D-3441)', () => {
    const home = onKeptV1('ccrc-update-arm1-fails-arm3-');
    const v1 = join(home, 'ccrc-versions', 'v1.0.0');
    const v2 = join(home, 'ccrc-versions', 'v2.0.0');
    // v1.0.0 is no longer published, so arm 2 refuses and arm 3 runs.
    rmSync(join(home, 'releases', 'download', 'v1.0.0'), { recursive: true, force: true });
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: V2_SHA }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-health-deny'), 'v2.0.0\nv1.0.0\n');
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout).toContain('update: flip: $HOME/ccrc -> $HOME/ccrc-versions/v1.0.0; its stamp and install record restored');
    expect(r.stdout).toContain(`update: arm 1 failed (${GATE_DENIED}) — $HOME/ccrc points at v2.0.0 again; falling to arm 2`);
    expect(r.stdout).toMatch(/^update: arm2-refused: v1\.0\.0 ships no bundle — /m);
    expect(r.stdout).toContain('update: arm 3: $HOME/ccrc-versions/v2.0.0 is where the copy lands, so it will hold a MIXED tree — its kept install record is removed first, so no flip returns to it');
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 3\): /m);
    expect(String(lastReport(home)['detail'])).toMatch(/^arm3: tree MIXED, deploy\.sh is the remedy; gate: /);
    expect(linkOf(home)).toBe(v2);
    expect(existsSync(join(v2, '.ccrc-installed')), 'the MIXED version still claims completeness').toBe(false);
    expect(existsSync(join(v1, '.ccrc-installed')), 'the void landed on the kept version').toBe(true);
    expect(existsSync(join(home, '.ccrc', 'installed'))).toBe(false);
    // …and no flip returns to it: v2.0.0 is no kept version now, so a rollback
    // to it asks the release host — which never published download/v2.0.0/ —
    // and refuses at exit 2, before anything moves.
    const rb = rollbackRun(home, ['--to', 'v2.0.0']);
    expect(rb.code, `stderr: ${rb.stderr}\nstdout: ${rb.stdout}`).toBe(2);
    expect(rb.stderr).toMatch(/^ccrc: rollback: v2\.0\.0 is not a published release \(its SHA256SUMS answered 404\)/m);
    expect(rb.stdout).not.toMatch(/is kept at/);
    expect(linkOf(home)).toBe(v2);
  }, 60_000);

  // W6 Task 8A (review 173's F1r: every write on an arm-3 path is true). On a
  // versioned box arm 3 says, BEFORE its copy, what it will leave in the
  // version `~/ccrc` points at — and that line must agree with the verdict it
  // prints after. A same-tag rerun whose staged sha equals the stamp's used to
  // print "it will hold a MIXED tree" and then "nothing is mixed".
  it.each([
    ['a completed record and the same sha: the same build', true,
      'and nothing is mixed there (the same build), but arm 3\'s copy is best effort',
      /nothing is mixed\. Read 'ccrc doctor' for why the gate failed/],
    ['no record and the same sha: the pre-update tree, which may itself be mixed', false,
      'so it may hold a MIXED tree',
      /the PRE-UPDATE tree, which may itself be MIXED\. Read 'ccrc doctor' for its state/],
  ] as const)('on a versioned box a same-tag arm 3 says what it leaves in the pointed-at version in the words of its own verdict — %s (F1r)', (_what, completed, lands, verdict) => {
    const home = freshUpdateBox('ccrc-update-arm3-void-line-');
    const cur = plantW6Box(home, 'v2.0.0', V2_SHA, 'server');
    if (!completed) rmSync(join(home, '.ccrc', 'installed'));
    // `previous` names the target, so arm 1 and arm 2 both skip and arm 3 runs.
    writeFileSync(join(home, '.ccrc', 'previous'), `v2.0.0\n${V2_SHA}\n`);
    packRelease(home, selfConvergedTree(home, 'v2.0.0', V2_SHA), { tag: 'v2.0.0', latest: false });
    writeFileSync(join(home, 'fixture-health-down'), 'yes\n');
    const r = runUpdate(home, ['--to', 'v2.0.0', '--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout).toContain(`update: arm 3: $HOME/ccrc-versions/v2.0.0 is where the copy lands, ${lands} — its kept install record is removed first, so no flip returns to it`);
    expect(r.stdout).toMatch(verdict);
    expect(existsSync(join(cur, '.ccrc-installed')), 'the pointed-at version still claims completeness').toBe(false);
    // The two never contradict: a MIXED promise beside a "nothing is mixed" verdict.
    if (completed) expect(r.stdout).not.toMatch(/will hold a MIXED tree|may hold a MIXED tree/);
    else expect(r.stdout).not.toMatch(/will hold a MIXED tree|nothing is mixed/);
  });

  it('arm 1 whose own gate fails hands arm 2 the NEW tree and a box that reads incomplete: the restore child re-installs v1.0.0 and its spine flips ~/ccrc off v2.0.0 — it cannot no-op on the stamp and record arm 1 restored (D-3443)', () => {
    const home = onKeptV1('ccrc-update-arm1-fails-arm2-');
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: V2_SHA }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-health-deny'), 'v2.0.0\nv1.0.0\n');
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout).toContain(`update: arm 1 failed (${GATE_DENIED}) — $HOME/ccrc points at v2.0.0 again; falling to arm 2`);
    expect(r.stdout).toMatch(/^update: arm 2: re-installing v1\.0\.0 \(the build this box ran before\)/m);
    // The child's staged spine found ~/ccrc on v2.0.0 and a v1.0.0 to place.
    expect(r.stdout).toContain('install: tree: $HOME/ccrc -> $HOME/ccrc-versions/v1.0.0 (was $HOME/ccrc-versions/v2.0.0) — one rename');
    expect(r.stdout).not.toMatch(/^update: this box already runs v1\.0\.0/m);
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 2\): this box runs v1\.0\.0 again, re-installed from its release — gate: /m);
    expect(lastReport(home)['phase']).toBe('reverted');
    expect(String(lastReport(home)['detail'])).toMatch(/^arm2: restored v1\.0\.0; gate: /);
    expect(linkOf(home)).toBe(join(home, 'ccrc-versions', 'v1.0.0'));
  }, 60_000);

  it('arm 1 refuses BEFORE any flip, naming why, and falls to arm 2: no previous, an untagged or malformed one, a box not versioned, one already on a previous tag that is not kept complete (on one that is, arm 1 restores in place — the FULL case above), a previous with no kept or an incomplete kept version (the arm, sourced)', () => {
    const prev = (h: string, body: string): void => writeFileSync(join(h, '.ccrc', 'previous'), body);
    const rows: Array<{ what: string; plant: (h: string) => void; says: string }> = [
      { what: 'no previous',
        plant: (h) => { plantW6Box(h, 'v2.0.0', V2_SHA); keptVersion(h, 'v1.0.0', V1_SHA); },
        says: 'update: arm 1: no ~/.ccrc/previous — arm 2' },
      { what: 'untagged previous',
        plant: (h) => { plantW6Box(h, 'v2.0.0', V2_SHA); keptVersion(h, 'v1.0.0', V1_SHA); prev(h, `untagged\n${V1_SHA}\n`); },
        says: 'update: arm 1: the previous build carried no tag — arm 2' },
      { what: 'malformed previous',
        plant: (h) => { plantW6Box(h, 'v2.0.0', V2_SHA); keptVersion(h, 'v1.0.0', V1_SHA); prev(h, 'three\n'); },
        says: 'update: arm 1: ~/.ccrc/previous is unreadable or malformed — arm 2' },
      { what: 'a real-directory box',
        plant: (h) => { plantOldBox(h, { version: 'v2.0.0' }); prev(h, `v1.0.0\n${V1_SHA}\n`); },
        says: 'update: arm 1: $HOME/ccrc is not versioned (directory) — arm 2' },
      { what: 'already on a previous tag that is not kept complete',
        plant: (h) => {
          rmSync(join(plantW6Box(h, 'v1.0.0', V1_SHA), '.ccrc-installed'));
          prev(h, `v1.0.0\n${V1_SHA}\n`);
        },
        says: 'update: arm 1: $HOME/ccrc-versions/v1.0.0 is incomplete (no kept install record) — arm 2' },
      { what: 'no kept version',
        plant: (h) => { plantW6Box(h, 'v2.0.0', V2_SHA); prev(h, `v1.0.0\n${V1_SHA}\n`); },
        says: 'update: arm 1: no kept version v1.0.0 under $HOME/ccrc-versions — arm 2' },
      { what: 'an incomplete kept version',
        plant: (h) => {
          plantW6Box(h, 'v2.0.0', V2_SHA);
          rmSync(join(keptVersion(h, 'v1.0.0', V1_SHA), '.ccrc-installed'));
          prev(h, `v1.0.0\n${V1_SHA}\n`);
        },
        says: 'update: arm 1: $HOME/ccrc-versions/v1.0.0 is incomplete (no kept install record) — arm 2' },
    ];
    for (const row of rows) {
      const home = freshUpdateBox('ccrc-update-arm1-refuse-');
      row.plant(home);
      const link = linkOf(home);
      // Wave 4 Task 3's file-scope `sourcedCcrc(home, script)`: one script string.
      const r = sourcedCcrc(home, 'rc=0; _upd_restore_arm1 both "gate: fixture" || rc=$?; echo "rc=$rc"');
      const said = r.stdout.split('\n').filter((l) => /^(update: |rc=)/.test(l));
      expect(said, `${row.what}: ${r.stderr}`).toEqual([row.says, 'rc=1']);
      expect(linkOf(home), `${row.what}: a refusal moved ~/ccrc`).toBe(link);
      expect(existsSync(join(home, 'kept-spine-argv')), `${row.what}: a refusal ran a spine`).toBe(false);
    }
  });

  it('_ver_kept: complete, absent, or incomplete with the first missing piece named — the role decides which build counts, and a tag-shaped name must be what its kept stamp says (the arms, sourced)', () => {
    const stampOf = (version: string | null): string => (version === null
      ? `{"sha":"${V1_SHA}","ref":"main","builtAt":"2026-09-23T00:00:00Z","dirty":false}\n`
      : `{"sha":"${V1_SHA}","ref":"main","builtAt":"2026-09-23T00:00:00Z","dirty":false,"version":"${version}"}\n`);
    const rows: Array<{ what: string; ask?: string; role: string; tree?: string;
      plant?: (root: string, home: string) => void; says: string }> = [
      { what: 'complete (both)', role: 'both', says: 'rc=0 why=' },
      { what: 'complete (an empty role reads both)', role: '', says: 'rc=0 why=' },
      { what: 'absent', ask: 'v0.9.0', role: 'both', says: 'rc=1 why=no kept version v0.9.0 under $HOME/ccrc-versions' },
      { what: 'a symlink is not a kept version', ask: 'v0.9.1', role: 'both',
        plant: (root, home) => symlinkSync(root, join(home, 'ccrc-versions', 'v0.9.1')),
        says: 'rc=1 why=no kept version v0.9.1 under $HOME/ccrc-versions' },
      { what: 'no ccd/ccrc', role: 'both', plant: (root) => rmSync(join(root, 'ccd', 'ccrc')), says: 'rc=2 why=no ccd/ccrc' },
      { what: 'no server build', role: 'server',
        plant: (root) => rmSync(join(root, 'server', 'dist', 'server', 'src', 'index.js')), says: 'rc=2 why=no server build' },
      { what: 'a fleet box needs no server build', role: 'fleet',
        // The build is removed BEFORE the digest is taken (D-3465): a tree
        // that lost a file after its keep reads written through, not kept.
        plant: (root, home) => { rmSync(join(root, 'server', 'dist', 'server', 'src', 'index.js')); keepDigest(root, home); },
        says: 'rc=0 why=' },
      { what: 'no agent build', role: 'fleet',
        plant: (root) => rmSync(join(root, 'agent', 'dist', 'agent', 'src', 'index.js')), says: 'rc=2 why=no agent build' },
      { what: 'no kept stamp', role: 'both', plant: (root) => rmSync(join(root, '.ccrc-stamp.json')), says: 'rc=2 why=no kept stamp' },
      { what: 'no kept install record', role: 'both',
        plant: (root) => rmSync(join(root, '.ccrc-installed')), says: 'rc=2 why=no kept install record' },
      { what: 'a stamp that does not parse', role: 'both',
        plant: (root) => writeFileSync(join(root, '.ccrc-stamp.json'), '{not json\n'), says: 'rc=2 why=its kept stamp does not parse' },
      { what: 'a stamp naming another tag', role: 'both',
        plant: (root) => writeFileSync(join(root, '.ccrc-stamp.json'), stampOf('v1.0.1')),
        says: 'rc=2 why=its kept stamp reads v1.0.1, not v1.0.0' },
      { what: 'an unversioned stamp under a tag name', role: 'both',
        plant: (root) => writeFileSync(join(root, '.ccrc-stamp.json'), stampOf(null)),
        says: 'rc=2 why=its kept stamp reads an unversioned build, not v1.0.0' },
      { what: 'an untagged name is not held to a version', ask: 'untagged-0123456789ab', tree: 'untagged-0123456789ab',
        role: 'both', says: 'rc=0 why=' },
    ];
    for (const row of rows) {
      const home = freshUpdateBox('ccrc-update-ver-kept-');
      const tree = row.tree ?? 'v1.0.0';
      const root = installVersionedTree(home, tree, {
        link: false, stamp: tree.startsWith('v') ? { sha: V1_SHA, version: tree } : { sha: V1_SHA },
      });
      row.plant?.(root, home);
      // The name and the role are plain tokens (a tag, `untagged-<hex>`, a
      // role word or ''), so single quotes carry them into the script intact.
      const r = sourcedCcrc(home,
        `rc=0; _ver_kept '${row.ask ?? tree}' '${row.role}' || rc=$?; printf 'rc=%s why=%s\\n' "$rc" "$VER_WHY"`);
      const said = r.stdout.split('\n').filter((l) => l.startsWith('rc='));
      expect(said, `${row.what}: ${r.stderr}`).toEqual([row.says]);
    }
  });
});

describe('ccrc rollback: by flip when the version is kept (W6 Task 4)', () => {
  const phasesOf = (home: string): string[] => reportWrites(home).map((w) => String(w['phase']));
  const calls = (home: string): string[] => (existsSync(join(home, 'systemctl-calls'))
    ? fileText(join(home, 'systemctl-calls')).split('\n').filter((l) => l !== '') : []);
  const withSweep = (home: string): void => {
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    writeFileSync(join(home, 'fixture-sweep-active'), UNIT_LINES);
  };
  /** A W6 server box on v2.0.0 with v1.0.0 kept beside it (its spine the
   *  recorder), and `previous` naming v1.0.0 — what the move onto v2.0.0 left. */
  const flipBox = (prefix: string, opts: { unsigned?: boolean } = {}): { home: string; kept: string } => {
    const home = freshUpdateBox(prefix);
    plantW6Box(home, 'v2.0.0', V2_SHA, 'server');
    const kept = keptVersion(home, 'v1.0.0', V1_SHA, { unsigned: opts.unsigned });
    writeFileSync(join(home, '.ccrc', 'previous'), `v1.0.0\n${V1_SHA}\n`);
    return { home, kept };
  };

  it('bare `ccrc rollback` to a kept version is a flip: no release-host question, no download; that version\'s own spine runs from the flipped tree — verified, no lock marker, no lock descriptor — then the gate, then the sweep behind its preflight (spec §11 "rollback after W5 is arm 1"; §18 "a standalone rollback sweeps behind the preflight"; D-3442)', () => {
    const { home, kept } = flipBox('ccrc-rollback-flip-');
    // Every release-host question would answer 404, so a rollback that asked
    // one would refuse at exit 2 (wave 4 Task 6's knob).
    writeFileSync(join(home, 'fixture-release-http'), '404\n');
    withSweep(home);
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toContain('rollback: v1.0.0 is kept at $HOME/ccrc-versions/v1.0.0 — no release-host question and no download');
    expect(localUrls(home)).toEqual([]);
    expect(linkOf(home)).toBe(kept);
    expect(fileText(join(home, 'kept-spine-argv')).split('\n').filter((l) => l !== ''))
      .toEqual([join(home, 'ccrc', 'ccd', 'ccrc'), 'install', '--role', 'server']);
    expect(fileText(join(home, 'kept-spine-env')).trim())
      .toBe(`verified=1 held=unset lockfd=${process.platform === 'linux' ? 'closed' : 'unmeasured'}`);
    // The kept spine stamps nothing (a pre-W6 spine's shape): the stamp is the
    // flip's own restore, the record the spine's.
    expect(fileText(join(home, '.ccrc', 'build.json'))).toBe(fileText(join(kept, '.ccrc-stamp.json')));
    expect(fileText(join(home, '.ccrc', 'installed'))).toBe(fileText(join(kept, '.ccrc-installed')));
    expect(fileText(join(home, '.ccrc', 'previous'))).toBe(`v1.0.0\n${V1_SHA}\n`);
    expect(fileText(join(home, '.ccrc', 'floor'))).toBe('v2.0.0\n');
    expect(r.stdout).toMatch(/^update: gate: server answers on v1\.0\.0 /m);
    expect(r.stdout).toContain('rollback: this box runs v1.0.0 again — flipped back to $HOME/ccrc-versions/v1.0.0, no download');
    // No resolving, fetching, verifying or backing-up: nothing was downloaded.
    expect(phasesOf(home)).toEqual(['installing', 'checking', 'restarting', 'restarting', 'done']);
    expect(lastReport(home)).toMatchObject({
      phase: 'done', detail: 'rolled back by flip to v1.0.0', target: 'v1.0.0', from: 'rollback',
    });
    if (process.platform === 'linux') {
      const c = calls(home);
      const gate = c.indexOf('--user is-active ccrc.service');
      const restartAt = c.indexOf('--user try-restart claude-session@*');
      expect(gate, c.join('\n')).toBeGreaterThan(-1);
      expect(restartAt, 'a rollback by flip must end in the supervisor sweep').toBeGreaterThan(gate);
      for (const u of ['alpha', 'beta']) {
        const at = c.indexOf(`--user show -p KillMode claude-session@${u}.service`);
        expect(at, `no KillMode preflight for ${u}`).toBeGreaterThan(-1);
        expect(at).toBeLessThan(restartAt);
      }
      expect(r.stdout).not.toMatch(/DEGRADED/);
    }
  });

  // Wave 24 (D-6601): a completed flip re-stamps its report before it prunes, so its keep-set runs inside the deadline the
  // console's lease measures from that write. The text half (after the sweep, directly before the prune) is W24-K5's.
  it('W24-K5: a rollback by flip, run from the console, writes a restarting report, pruning ~/ccrc-backups, after its sweep and before done', () => {
    const { home } = flipBox('ccrc-rollback-flip-w24-k5-');
    withSweep(home);
    const r = rollbackRun(home, ['--to', 'v1.0.0', '--from', 'pwa']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(reportWrites(home).map((w) => `${String(w['phase'])} ${String(w['detail'])}`).slice(-3))
      .toEqual(['restarting null', 'restarting pruning ~/ccrc-backups', 'done rolled back by flip to v1.0.0']);
  });

  // Review 179 fix round 1, item 5: a rollback by flip reaches `_upd_sweep`
  // from `cmd_rollback` itself, not through `cmd_update` — so its preflight is
  // pinned AT THIS CALL SITE. `withSweep` is deliberately NOT used: there is no
  // KillMode drop-in, so the fixture's `show -p KillMode` answers systemd's
  // control-group default, and a flip that swept anyway would kill every pane.
  itLinux('a rollback BY FLIP\'s sweep is behind its own KillMode=process preflight at the flip call site: with KillMode resolving control-group it is REFUSED — the sentence, DEGRADED, no `--user try-restart` — and the flip itself still completes (review 179 item 5; R1 inherited, never re-argued)', () => {
    const { home, kept } = flipBox('ccrc-rollback-flip-refused-');
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    writeFileSync(join(home, 'fixture-sweep-active'), UNIT_LINES);
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    // It IS the flip path (not the re-install path), so the call site is the flip's own.
    expect(r.stdout).toContain('rollback: v1.0.0 is kept at $HOME/ccrc-versions/v1.0.0 — no release-host question and no download');
    expect(linkOf(home)).toBe(kept);
    expect(r.stderr).toMatch(/^update: sweep REFUSED — claude-session@alpha\.service resolves to KillMode=control-group/m);
    expect(r.stdout).toMatch(/^update: DEGRADED: the supervisor sweep did not run — every live claude-session@ supervisor keeps executing the PREVIOUS ccd until restarted/m);
    const c = calls(home);
    // The preflight was asked (so the refusal is a measurement, not an absence)…
    expect(c, c.join('\n')).toContain('--user show -p KillMode claude-session@alpha.service');
    // …and nothing restarted a supervisor.
    expect(c.filter((l) => /--user try-restart/.test(l)), c.join('\n')).toEqual([]);
    expect(lastReport(home)).toMatchObject({ phase: 'done', from: 'rollback', sweep: 'refused: killmode' });
  });

  it('an unverified kept version stays unverified: its own spine runs WITHOUT CCRC_UPDATE_VERIFIED when its kept record says unsigned — a flip never promotes it (§18 "arm 2 never silently unsigns", applied to the flip; D-3439)', () => {
    const { home } = flipBox('ccrc-rollback-flip-unsigned-', { unsigned: true });
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(fileText(join(home, 'kept-spine-env'))).toMatch(/^verified=unset held=unset /);
    expect(fileText(join(home, '.ccrc', 'installed'))).toBe(`${V1_SHA}\nunsigned\n`);
  });

  // D-3461 (controller ruling, found reviewing Task 8's rehearsal R6): a
  // rollback by flip returned 0 after its gate passed even when the kept
  // spine's trailing doctor exited non-zero, while an update exits 3 on the
  // same FAILs and the Global Constraints' exit table reads `ccrc rollback`
  // the same way (D-3114). The table governs.
  it('a rollback by flip whose kept spine COMPLETED under a failing doctor exits 3, not 0: the gate passed, the box IS on the kept version, the terminal `done` report and the sweep still happen — and the same rollback under a passing doctor exits 0 (D-3461)', () => {
    const { home, kept } = flipBox('ccrc-rollback-flip-doctor3-');
    writeFileSync(join(home, 'fixture-kept-spine-exit'), '1\n');
    writeFileSync(join(home, 'fixture-kept-spine-completes'), 'yes\n');
    withSweep(home);
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(3);
    expect(r.stdout).toContain("update: gate: server answers on v1.0.0");
    expect(r.stdout).toContain("rollback: flip: v1.0.0's spine completed (its record is written) but its trailing doctor exited 1 — the FAIL lines above are the box's health; the gate decides");
    expect(r.stdout).toContain('rollback: this box runs v1.0.0 again — flipped back to $HOME/ccrc-versions/v1.0.0, no download');
    expect(r.stdout).toContain("rollback: the kept spine completed (its record is written) but its trailing doctor exited 1 — this box IS on v1.0.0; the FAIL lines above are the box's health, not the rollback's");
    expect(linkOf(home)).toBe(kept);
    expect(fileText(join(home, '.ccrc', 'installed'))).toBe(fileText(join(kept, '.ccrc-installed')));
    // The terminal report is written either way, as wave 4's update writes it for 3.
    expect(lastReport(home)).toMatchObject({
      phase: 'done', detail: "doctor exited 1 - the box moved; its health is ccrc doctor's", target: 'v1.0.0', from: 'rollback',
    });
    expect(phasesOf(home)).toEqual(['installing', 'checking', 'restarting', 'restarting', 'done']);
    if (process.platform === 'linux') {
      expect(calls(home), 'a moved box is swept, exit 3 or not').toContain('--user try-restart claude-session@*');
    }
    // The control: the same box under a passing doctor.
    const ok = flipBox('ccrc-rollback-flip-doctor0-');
    withSweep(ok.home);
    const r0 = rollbackRun(ok.home);
    expect(r0.code, `stderr: ${r0.stderr}\nstdout: ${r0.stdout}`).toBe(0);
    expect(r0.stdout).not.toMatch(/trailing doctor exited/);
    expect(lastReport(ok.home)).toMatchObject({ phase: 'done', detail: 'rolled back by flip to v1.0.0' });
  });

  // C27 (review 155; W6 Task 8A, the controller's ruling). The stale-`previous`
  // detour: a box rolls back to a release older than wave 4 (which never
  // rewrites `previous`), then that release's OWN updater moves it forward.
  // That updater predates W6, so it writes neither `previous` nor the layout:
  // `~/ccrc` still names the version directory it wrote through, and the
  // stamp names where it went. A bare rollback must not trust `previous`.
  const staleBox = (prefix: string, stamped: string): string => {
    const home = freshUpdateBox(prefix);
    // `~/ccrc -> ~/ccrc-versions/v1.0.0`, kept complete; its OWN updater moved
    // the box on to `stamped` by rewriting the box stamp only.
    plantW6Box(home, 'v1.0.0', V1_SHA, 'server');
    writeFileSync(join(home, '.ccrc', 'build.json'), shippedStamp(stamped, 'c'.repeat(40)));
    writeFileSync(join(home, '.ccrc', 'previous'), `v2.0.0\n${V2_SHA}\n`);
    // Every release-host question answers 404: a run that gets past the
    // check ends at exit 2 "not a published release", and one that is
    // refused by it ends at exit 1 having asked nothing.
    writeFileSync(join(home, 'fixture-release-http'), '404\n');
    return home;
  };

  it('a bare rollback REFUSES when previous disagrees with what the layout records: ~/ccrc points at v1.0.0, the stamp says v1.1.0, previous says v2.0.0 — the refusal names all three, asks for --to, and changes and asks nothing (C27)', () => {
    const home = staleBox('ccrc-rollback-stale-previous-', 'v1.1.0');
    // What the box's own state holds: the harness re-plants its stubs under
    // `.local/bin` on every run, which is not the verb writing.
    const own = (): string[] => homeSnapshot(home).filter((l) => /^(\.ccrc\/|ccrc)/.test(l));
    const before = own();
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: rollback: ~\/\.ccrc\/previous names v2\.0\.0, but it cannot be trusted here — \$HOME\/ccrc points at \$HOME\/ccrc-versions\/v1\.0\.0 while this box's stamp reads v1\.1\.0, /m);
    expect(r.stderr).toContain('name the target: ccrc rollback --to vX.Y.Z');
    // What the check measures is only that the link and the stamp disagree,
    // so the sentence claims no history: it names two possible movers and
    // says previous MAY not be the build before the last update.
    expect(r.stderr).toContain("so the last move was made by something that does not keep the layout (for example a pre-W6 release's updater after a rollback, or deploy.sh), and previous may not be the build before the last update. Nothing on this box was changed");
    expect(r.stderr).not.toContain('older than versioned installs moved it forward');
    expect(localUrls(home), 'the refusal asked the release host').toEqual([]);
    expect(linkOf(home)).toBe(join(home, 'ccrc-versions', 'v1.0.0'));
    expect(existsSync(join(home, '.ccrc', 'update.json')), 'a refusal before the lock wrote a report').toBe(false);
    expect(own()).toEqual(before);
    // The same words for a --to-less rollback typed by the watchdog: no `to`, no trust.
    const w = rollbackRun(home, ['--from', 'watchdog']);
    expect(w.code).toBe(1);
    expect(w.stderr).toContain('it cannot be trusted here');
  });

  it('the refusal is only for a DISAGREEMENT, and only for a bare rollback: an agreeing layout proceeds (the control — the same box with the stamp on v1.0.0 asks the release host about the never-kept v2.0.0, the common first rollback after the move onto W6), `--to` names its own target, and an unversioned layout keeps wave 4\'s behaviour (C27)', () => {
    // The control: stamp v1.0.0 agrees with the pointed-at v1.0.0.
    const agree = staleBox('ccrc-rollback-stale-previous-agree-', 'v1.0.0');
    let r = rollbackRun(agree);
    expect(r.stderr).not.toContain('it cannot be trusted here');
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: rollback: v2\.0\.0 is not a published release \(its SHA256SUMS answered 404\)/m);
    // The disagreeing box, told its target: the check is never consulted.
    const stale = staleBox('ccrc-rollback-stale-previous-to-', 'v1.1.0');
    r = rollbackRun(stale, ['--to', 'v2.0.0']);
    expect(r.stderr).not.toContain('it cannot be trusted here');
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(2);
    // An `untagged-<sha12>` name is compared with the stamp's sha12; an
    // `unstamped-*` name and an unreadable stamp have no verdict.
    const sha = 'd'.repeat(40);
    const untagged = staleBox('ccrc-rollback-stale-previous-untagged-', 'v1.1.0');
    renameSync(join(untagged, 'ccrc-versions', 'v1.0.0'), join(untagged, 'ccrc-versions', `untagged-${sha.slice(0, 12)}`));
    rmSync(join(untagged, 'ccrc'));
    symlinkSync(join(untagged, 'ccrc-versions', `untagged-${sha.slice(0, 12)}`), join(untagged, 'ccrc'));
    writeFileSync(join(untagged, '.ccrc', 'build.json'), `{"sha":"${sha}","ref":"main","builtAt":"2026-08-21T00:00:00Z","dirty":false}\n`);
    r = rollbackRun(untagged);
    expect(r.stderr, 'an untagged name whose sha12 the stamp agrees with is not a disagreement').not.toContain('it cannot be trusted here');
    writeFileSync(join(untagged, '.ccrc', 'build.json'), shippedStamp('v1.1.0', 'e'.repeat(40)));
    r = rollbackRun(untagged);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain('while this box\'s stamp reads v1.1.0');
    const unreadable = staleBox('ccrc-rollback-stale-previous-unreadable-', 'v1.1.0');
    writeFileSync(join(unreadable, '.ccrc', 'build.json'), 'not json\n');
    r = rollbackRun(unreadable);
    expect(r.stderr, 'an unreadable stamp is no verdict').not.toContain('it cannot be trusted here');
    // The commonest case, end to end (a FULL first move onto v1.0.0, whose
    // migration leaves `previous` naming the pre-migration tag — never a kept
    // version): its rollback must still proceed.
    const full = onKeptV1('ccrc-rollback-stale-previous-full-');
    expect(fileText(join(full, '.ccrc', 'previous')).split('\n')[0]).toBe('v0.9.0');
    writeFileSync(join(full, 'fixture-release-http'), '404\n');
    r = rollbackRun(full);
    expect(r.stderr, 'the first rollback after the move onto W6 was refused').not.toContain('it cannot be trusted here');
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(2);
    // A real-directory (unversioned) box: wave 4's behaviour, previous trusted.
    const dirBox = freshUpdateBox('ccrc-rollback-stale-previous-directory-');
    plantOldBox(dirBox, { version: 'v1.1.0' });
    writeFileSync(join(dirBox, '.ccrc', 'previous'), `v2.0.0\n${V2_SHA}\n`);
    writeFileSync(join(dirBox, 'fixture-release-http'), '404\n');
    r = rollbackRun(dirBox);
    expect(r.stderr).not.toContain('it cannot be trusted here');
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
  });

  it('a box already on the kept tag with its install completed has nothing to do — exit 0, nothing written; one whose install did NOT complete re-runs the kept spine, so D-3264\'s rerun (`ccrc rollback --to <v>`) works on a versioned box', () => {
    const home = freshUpdateBox('ccrc-rollback-flip-already-');
    const root = plantW6Box(home, 'v1.0.0', V1_SHA, 'server');
    writeFileSync(join(root, 'ccd', 'ccrc'), KEPT_SPINE, { mode: 0o755 });
    keepDigest(root, home);   // the spine is part of the kept bytes (D-3465)
    let r = rollbackRun(home, ['--to', 'v1.0.0']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toContain(`rollback: this box already runs v1.0.0 (${V1_SHA}) and that install completed — nothing to do (to reinstall it: ccrc update --to v1.0.0 --downgrade --force)`);
    expect(existsSync(join(home, 'kept-spine-argv'))).toBe(false);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
    expect(localUrls(home)).toEqual([]);
    // The same box after a kept spine died past `_inst_stamp`: the stamp
    // already on v1.0.0, and no completed-install record.
    rmSync(join(home, '.ccrc', 'installed'));
    r = rollbackRun(home, ['--to', 'v1.0.0']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).not.toMatch(/nothing to do/);
    expect(fileText(join(home, 'kept-spine-argv')).split('\n')[1]).toBe('install');
    expect(fileText(join(home, '.ccrc', 'installed'))).toBe(fileText(join(root, '.ccrc-installed')));
    expect(lastReport(home)['phase']).toBe('done');
  });

  it('a kept directory whose install never completed is NOT kept: the release host is asked as before, and an unpublished tag is refused at exit 2 (the control on the skip; passes before this task too)', () => {
    const { home, kept } = flipBox('ccrc-rollback-flip-incomplete-');
    rmSync(join(kept, '.ccrc-installed'));
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(2);
    expect(r.stdout).not.toMatch(/is kept at/);
    expect(r.stderr).toMatch(/^ccrc: rollback: v1\.0\.0 is not a published release \(its SHA256SUMS answered 404\)/m);
    expect(localUrls(home)).toEqual([`local://${home}/releases/download/v1.0.0/SHA256SUMS`]);
    expect(linkOf(home)).toBe(join(home, 'ccrc-versions', 'v2.0.0'));
  });

  it('a kept spine that does not complete: ~/ccrc stays on the kept version, the box reads incomplete, the report says why — exit 1, no gate, no sweep', () => {
    const { home, kept } = flipBox('ccrc-rollback-flip-spine-dies-');
    writeFileSync(join(home, 'fixture-kept-spine-exit'), '1\n');
    withSweep(home);
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toContain("ccrc: rollback: $HOME/ccrc points at $HOME/ccrc-versions/v1.0.0, but its own spine did not complete (its own spine exited 1 without writing its completed-install record) — read its lines above; 'ccrc update --check' says where this box stands");
    expect(linkOf(home)).toBe(kept);
    expect(existsSync(join(home, '.ccrc', 'installed'))).toBe(false);
    expect(lastReport(home)).toMatchObject({
      phase: 'failed',
      detail: 'rollback to v1.0.0: the kept spine did not complete; its own spine exited 1 without writing its completed-install record',
    });
    expect(phasesOf(home)).not.toContain('checking');
    expect(calls(home).join('\n')).not.toMatch(/try-restart/);
  });

  it('a rollback by flip whose gate fails is not restored (D-3243): failed \'rollback to <tag>: gate: …\', exit 1, no restore phase, no sweep', () => {
    const { home } = flipBox('ccrc-rollback-flip-gate-');
    // /health keeps answering the version rolled away from.
    writeFileSync(join(home, 'fixture-health-pin'), 'v2.0.0\n');
    withSweep(home);
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stdout).toMatch(/^update: gate FAILED after \d+s — \/health at 127\.0\.0\.1:7788 answers v2\.0\.0, not v1\.0\.0$/m);
    expect(r.stderr).toMatch(/^ccrc: rollback: v1\.0\.0 was installed but failed its health gate \(gate: \/health at 127\.0\.0\.1:7788 answers v2\.0\.0, not v1\.0\.0\) — no automatic restore runs for a --from rollback run/m);
    expect(lastReport(home)).toMatchObject({
      phase: 'failed', detail: 'rollback to v1.0.0: gate: /health at 127.0.0.1:7788 answers v2.0.0, not v1.0.0', from: 'rollback',
    });
    expect(phasesOf(home)).not.toContain('restoring');
    expect(calls(home).join('\n')).not.toMatch(/try-restart/);
  });

  it('a rollback by flip whose gate reason carries a home path is REDACTED on stderr as cmd_update redacts it (F10)', () => {
    const { home } = flipBox('ccrc-rollback-flip-gate-redact-');
    // An env file that declares a host and no port: the gate's reason names
    // the file's ABSOLUTE path (`_box_server_addr`), on the box that wrote it.
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=server\nCCRC_HOST=127.0.0.1\n');
    withSweep(home);
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: rollback: v1\.0\.0 was installed but failed its health gate \(gate: ~\/\.ccrc\/ccrc\.env declares CCRC_HOST but no CCRC_PORT\) — no automatic restore/m);
    expect(r.stderr, 'the box\'s absolute home reached stderr').not.toContain(home);
  });

  it('a kept version the flip cannot reach (the one rename refused) falls back to update\'s own re-install; that release\'s older spine gets no directory either, so it dies BEFORE anything is installed — the record as it was, no spine run', () => {
    const { home } = flipBox('ccrc-rollback-flip-rename-');
    // `_plat_ln_swap` refuses to clear a real directory at <link>.new (Task 1).
    mkdirSync(join(home, 'ccrc.new'));
    packRelease(home, stubTree(home, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
    const recBefore = fileText(join(home, '.ccrc', 'installed'));
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stdout).toContain('rollback: v1.0.0 could not be flipped to (the one rename that points $HOME/ccrc at $HOME/ccrc-versions/v1.0.0 failed) — rolling back by re-install instead');
    expect(r.stderr).toContain("could not give v1.0.0's older spine a directory of its own under $HOME/ccrc-versions — nothing was installed; $HOME/ccrc still points at v2.0.0");
    expect(linkOf(home)).toBe(join(home, 'ccrc-versions', 'v2.0.0'));
    expect(fileText(join(home, '.ccrc', 'installed'))).toBe(recBefore);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
    expect(existsSync(join(home, 'kept-spine-argv'))).toBe(false);
  });

  // R-B pins the OBSERVABLE: the report ends terminal. It cannot pin the
  // `UPD_REPORTING=1` the fall-through keeps — `cmd_update` opens its own
  // window again right after its own `_upd_lock`, so a reset to 0 in
  // `cmd_rollback` measures identically (mutation B1 in the task report).
  it('a flip that cannot be made falls through to update\'s own re-install, whose refusal closes update.json with a terminal `failed` — never the `installing` the flip path wrote (R-B)', () => {
    const { home } = flipBox('ccrc-rollback-flip-rename-report-');
    mkdirSync(join(home, 'ccrc.new'));   // `_plat_ln_swap` refuses to clear it: the flip cannot be made
    packRelease(home, stubTree(home, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stdout).toContain('— rolling back by re-install instead');
    expect(phasesOf(home)[0]).toBe('installing');
    expect(lastReport(home)['phase'], 'the report was left non-terminal: a watchdog would read an updater that died').toBe('failed');
  });

  it('a FULL rollback by flip: the kept version\'s REAL spine re-places ~/.local/bin/ccd, the stamp and the record are the kept version\'s, then the sweep — and not one release URL is asked (Review Focus 1)', () => {
    const home = onKeptV1('ccrc-rollback-flip-full-');
    const v1 = join(home, 'ccrc-versions', 'v1.0.0');
    // The kept copies, measured BEFORE this case's run. The spine a flip
    // back runs is this checkout's own, and its `_inst_installed` ends in
    // `_ver_keep_state install`, which copies the box's stamp and record
    // over these two files: a box-vs-kept-copy comparison AFTER the run is
    // equal by construction, whatever the bytes (a verified version
    // re-recorded `unsigned` would pass it). The snapshot is the subject.
    const keptStamp = fileText(join(v1, '.ccrc-stamp.json'));
    const keptRec = fileText(join(v1, '.ccrc-installed'));
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: V2_SHA }), { tag: 'v2.0.0' });
    const up = runUpdate(home);
    expect(up.code, `the move onto v2.0.0 must complete — stderr: ${up.stderr}\nstdout: ${up.stdout}`).toBe(0);
    expect(linkOf(home)).toBe(join(home, 'ccrc-versions', 'v2.0.0'));
    expect(fileText(join(home, '.local', 'libexec', 'ccrc', 'ccd')), 'v2.0.0 carries the kept sentinel — the control is broken').not.toContain(CCD_SENTINEL);
    for (const f of ['curl-argv', 'update-json-writes', 'systemctl-calls']) rmSync(join(home, f), { force: true });
    writeFileSync(join(home, 'fixture-release-http'), '404\n');
    withSweep(home);
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toContain('rollback: v1.0.0 is kept at $HOME/ccrc-versions/v1.0.0 — no release-host question and no download');
    expect(localUrls(home)).toEqual([]);
    expect(linkOf(home)).toBe(v1);
    expect(fileText(join(home, '.local', 'libexec', 'ccrc', 'ccd'))).toBe(installedBodyOf(join(v1, 'ccd/ccd')));
    expect(fileText(join(home, '.local', 'libexec', 'ccrc', 'ccd'))).toContain(CCD_SENTINEL);
    expect(fileText(join(home, '.ccrc', 'build.json'))).toBe(keptStamp);
    expect(fileText(join(home, '.ccrc', 'installed'))).toBe(keptRec);
    expect(fileText(join(v1, '.ccrc-stamp.json')), 'the kept stamp was rewritten').toBe(keptStamp);
    expect(fileText(join(v1, '.ccrc-installed')), 'the kept record was rewritten').toBe(keptRec);
    expect(fileText(join(home, '.ccrc', 'previous'))).toBe(`v1.0.0\n${V1_SHA}\n`);
    expect(fileText(join(home, '.ccrc', 'floor'))).toBe('v2.0.0\n');
    expect(lastReport(home)).toMatchObject({ phase: 'done', detail: 'rolled back by flip to v1.0.0', from: 'rollback' });
    if (process.platform === 'linux') {
      const c = calls(home);
      const restartAt = c.indexOf('--user try-restart claude-session@*');
      expect(restartAt, 'a rollback by flip must end in the supervisor sweep').toBeGreaterThan(c.indexOf('--user is-active ccrc.service'));
    }
  }, 60_000);

  it('a crashed migration is completed BEFORE the kept check, so a kept tag still reads kept — no release-host question, no download — and the flip\'s passed gate then removes ~/ccrc.migrating (W6 Task 3, D-3437)', () => {
    const { home, kept } = flipBox('ccrc-rollback-crashed-');
    // flipBox's v2.0.0 link turned into the crash pair a killed migration
    // leaves: the pre-versioned tree aside, the marker naming v2.0.0, no ~/ccrc.
    rmSync(join(home, 'ccrc'));
    mkdirSync(join(home, 'ccrc.migrating', 'server'), { recursive: true });
    writeFileSync(join(home, 'ccrc.migrating', 'server', 'OLD-MARKER'), 'the pre-versioned tree\n');
    writeFileSync(join(home, '.ccrc', 'migrating-to'), 'v2.0.0\n');
    // A rollback that asked the release host would refuse at exit 2.
    writeFileSync(join(home, 'fixture-release-http'), '404\n');
    withSweep(home);
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const lines = r.stdout.split('\n');
    const resumed = lines.indexOf('rollback: tree: completed a crashed migration — $HOME/ccrc was absent beside $HOME/ccrc.migrating; linked to $HOME/ccrc-versions/v2.0.0 (named by ~/.ccrc/migrating-to)');
    const keptAt = lines.indexOf('rollback: v1.0.0 is kept at $HOME/ccrc-versions/v1.0.0 — no release-host question and no download');
    expect(resumed, r.stdout).toBeGreaterThan(-1);
    expect(keptAt, 'the kept check read the crashed layout').toBeGreaterThan(resumed);
    expect(localUrls(home)).toEqual([]);
    expect(linkOf(home)).toBe(kept);
    expect(existsSync(join(home, 'ccrc.migrating')), 'the passed gate did not remove the old tree').toBe(false);
  }, 60_000);
});

describe('ccrc update: a spine older than W6 gets a directory named for its own tag (W6 Task 4)', () => {
  const NEW_SHA = 'newsha0000000000000000000000000000000000';
  /** An older release's spine, as the STUB shim runs it (`fixture-on-install`,
   *  wave 4 Task 6): it records whether the directory it was handed still
   *  claimed completeness; writes THROUGH $HOME/ccrc, as its `_inst_tree`'s
   *  rsync does; stamps the box with its release's stamp (its `_inst_stamp`);
   *  and — `fixture-stub-installed`, wave 4 Task 5 — writes the record. */
  const oldSpine = (home: string): void => {
    writeFileSync(join(home, 'fixture-old-stamp.json'), shippedStamp('v1.0.0', NEW_SHA));
    writeFileSync(join(home, 'fixture-on-install'), [
      'if [ -f "$HOME/ccrc/.ccrc-installed" ]; then echo present; else echo absent; fi > "$HOME/old-spine-saw-record"',
      // D-3465 (e): the digest goes with the record — it describes the bytes this spine is about to rewrite.
      'if [ -f "$HOME/ccrc/.ccrc-digest" ]; then echo present; else echo absent; fi > "$HOME/old-spine-saw-digest"',
      'mkdir -p "$HOME/ccrc/server" && printf \'written by the older spine\\n\' > "$HOME/ccrc/server/WROTE-BY-OLD-SPINE"',
      'cp "$HOME/fixture-old-stamp.json" "$HOME/.ccrc/build.json"',
    ].join('\n') + '\n');
    writeFileSync(join(home, 'fixture-stub-installed'), 'yes\n');
  };
  const dotEntries = (home: string): string[] =>
    readdirSync(join(home, 'ccrc-versions')).filter((n) => n.startsWith('.'));

  it('with no directory for the older tag, ~/ccrc is pointed at a COPY of the running version (its kept state removed) before that spine runs — every write lands there, the version it replaces is byte-unchanged, and the copy is kept complete once the spine completes (Review Focus 5; D-3440, D-3428)', () => {
    const home = freshUpdateBox('ccrc-update-legacy-copy-');
    const cur = plantW6Box(home, 'v2.0.0', V2_SHA);
    const before = treeDigest(cur);
    packRelease(home, stubTree(home, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
    oldSpine(home);
    const r = runUpdate(home, ['--to', 'v1.0.0', '--downgrade']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const v1 = join(home, 'ccrc-versions', 'v1.0.0');
    expect(r.stdout).toContain("update: tree: v1.0.0's spine predates versioned installs and writes through $HOME/ccrc — $HOME/ccrc now points at $HOME/ccrc-versions/v1.0.0 (a copy of v2.0.0) for it to write into");
    expect(linkOf(home)).toBe(v1);
    expect(treeDigest(cur), 'the older spine wrote into the version it replaced').toEqual(before);
    expect(existsSync(join(v1, 'server', 'WROTE-BY-OLD-SPINE'))).toBe(true);
    expect(fileText(join(home, 'old-spine-saw-record'))).toBe('absent\n');
    expect(fileText(join(home, 'old-spine-saw-digest')), 'the copy still carried v2.0.0\'s digest (D-3465 (e))').toBe('absent\n');
    // The copy began as v2.0.0's tree…
    expect(fileText(join(v1, 'ccd/ccd'))).toBe(fileText(join(cur, 'ccd/ccd')));
    // …and is now v1.0.0's, kept complete by cmd_update after that spine.
    expect(fileText(join(v1, '.ccrc-stamp.json'))).toBe(fileText(join(home, '.ccrc', 'build.json')));
    expect(fileText(join(v1, '.ccrc-installed'))).toBe(`${NEW_SHA}\n`);
    expect(r.stdout).toMatch(/^update: versions: kept v1\.0\.0's stamp and install record in \$HOME\/ccrc-versions\/v1\.0\.0/m);
    // The bytes the older spine wrote were PLACED by this run (D-3465 (b)), so
    // the keep after it records a fresh digest — the marker is inside it.
    expect(fileText(join(v1, '.ccrc-digest'))).toMatch(/^1:[0-9a-f]{64}\n$/);
    expect(verKeptAnswer(home, 'v1.0.0', ''), 'the copy is not kept on its fresh digest').toBe('rc=0 why=');
    expect(existsSync(join(cur, '.ccrc-digest')), 'the running version lost its digest').toBe(true);
    expect(dotEntries(home)).toEqual([]);
    expect(lastReport(home)['phase']).toBe('done');
  });

  it('with a kept directory for the older tag, ~/ccrc is pointed at IT — which stops claiming completeness before that spine writes into it, and regains it only when the spine completes', () => {
    const home = freshUpdateBox('ccrc-update-legacy-kept-');
    const cur = plantW6Box(home, 'v2.0.0', V2_SHA);
    const v1 = installVersionedTree(home, 'v1.0.0', { link: false, stamp: { sha: V1_SHA, version: 'v1.0.0' } });
    const before = treeDigest(cur);
    packRelease(home, stubTree(home, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
    oldSpine(home);
    const r = runUpdate(home, ['--to', 'v1.0.0', '--downgrade']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toContain("update: tree: v1.0.0's spine predates versioned installs and writes through $HOME/ccrc — $HOME/ccrc now points at $HOME/ccrc-versions/v1.0.0 (kept) for it to write into");
    expect(linkOf(home)).toBe(v1);
    expect(fileText(join(home, 'old-spine-saw-record')), 'the older spine was handed a directory that still claimed completeness').toBe('absent\n');
    expect(fileText(join(home, 'old-spine-saw-digest')), 'the older spine was handed a directory that still carried the digest of the bytes it rewrote (D-3465 (e))').toBe('absent\n');
    expect(existsSync(join(v1, 'server', 'WROTE-BY-OLD-SPINE'))).toBe(true);
    expect(treeDigest(cur)).toEqual(before);
    expect(fileText(join(v1, '.ccrc-installed'))).toBe(`${NEW_SHA}\n`);
    // Kept again on a FRESH digest, because this run's legacy spine placed the bytes.
    expect(fileText(join(v1, '.ccrc-digest'))).toMatch(/^1:[0-9a-f]{64}\n$/);
    expect(verKeptAnswer(home, 'v1.0.0', '')).toBe('rc=0 why=');
    expect(dotEntries(home)).toEqual([]);
  });

  it('no directory is handed over when the staged ccrc IS versioned (it names BOX_VERSIONS_ROOT), nor for a same-tag reinstall, which writes in place (the controls; D-3426)', () => {
    const home = freshUpdateBox('ccrc-update-legacy-w6-');
    const cur = plantW6Box(home, 'v2.0.0', V2_SHA);
    const tree = stubTree(home, { version: 'v1.0.0' });
    // A W6-shaped staged ccrc: the one line the check reads. The MANIFEST is
    // re-made after the edit, or the per-file verification refuses the tree.
    rmSync(join(tree, 'MANIFEST'));
    writeFileSync(join(tree, 'ccd', 'ccrc'),
      fileText(join(tree, 'ccd', 'ccrc')).replace('#!/bin/sh\n', '#!/bin/sh\nBOX_VERSIONS_ROOT="$HOME/ccrc-versions"\n'),
      { mode: 0o755 });
    writeManifest(tree);
    packRelease(home, tree, { tag: 'v1.0.0', latest: false });
    let r = runUpdate(home, ['--to', 'v1.0.0', '--downgrade']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).not.toMatch(/predates versioned installs/);
    expect(linkOf(home)).toBe(cur);
    // The same tag, an older spine: in place, no directory handed over.
    const same = freshUpdateBox('ccrc-update-legacy-same-');
    const sameCur = plantW6Box(same, 'v2.0.0', V2_SHA);
    packRelease(same, stubTree(same, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    r = runUpdate(same, ['--to', 'v2.0.0', '--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).not.toMatch(/predates versioned installs/);
    expect(linkOf(same)).toBe(sameCur);
  });

  it('when that directory cannot be made the update dies BEFORE anything is installed — ~/ccrc, the record and the caps as they were, the staged spine never run, no staging directory left', () => {
    const home = freshUpdateBox('ccrc-update-legacy-refused-');
    const cur = plantW6Box(home, 'v2.0.0', V2_SHA);
    writeFileSync(join(home, '.ccrc', 'ccrc-caps'), 'os linux\nverify\n');
    const rec = fileText(join(home, '.ccrc', 'installed'));
    packRelease(home, stubTree(home, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
    const root = join(home, 'ccrc-versions');
    chmodSync(root, 0o555);   // `cp -a` cannot create `.v1.0.0.incoming.<pid>` (the suite never runs as root)
    const r = ((): Result => {
      try { return runUpdate(home, ['--to', 'v1.0.0', '--downgrade']); } finally { chmodSync(root, 0o755); }
    })();
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toContain("ccrc: could not give v1.0.0's older spine a directory of its own under $HOME/ccrc-versions — nothing was installed; $HOME/ccrc still points at v2.0.0");
    expect(linkOf(home)).toBe(cur);
    expect(fileText(join(home, '.ccrc', 'installed'))).toBe(rec);
    expect(fileText(join(home, '.ccrc', 'ccrc-caps'))).toBe('os linux\nverify\n');
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
    expect(dotEntries(home)).toEqual([]);
    expect(lastReport(home)['phase']).toBe('failed');
    expect(String(lastReport(home)['detail'])).toMatch(/^could not give v1\.0\.0's older spine a directory of its own/);
  });

  it('a symlink or a regular file at ~/ccrc-versions/<older tag> is not a directory ccrc placed: the update dies BEFORE anything is installed, and nothing is written through the link (the refusal the copy and kept cases never reach)', () => {
    for (const shape of ['symlink', 'file'] as const) {
      const home = freshUpdateBox(`ccrc-update-legacy-not-a-dir-${shape}-`);
      const cur = plantW6Box(home, 'v2.0.0', V2_SHA);
      const rec = fileText(join(home, '.ccrc', 'installed'));
      const other = join(home, 'somewhere-else');
      mkdirSync(join(other, 'server'), { recursive: true });
      writeFileSync(join(other, 'server', 'THEIRS'), 'not a version\n');
      const otherBefore = treeDigest(other);
      if (shape === 'symlink') symlinkSync(other, join(home, 'ccrc-versions', 'v1.0.0'));
      else writeFileSync(join(home, 'ccrc-versions', 'v1.0.0'), 'a file\n');
      packRelease(home, stubTree(home, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
      oldSpine(home);
      const r = runUpdate(home, ['--to', 'v1.0.0', '--downgrade']);
      expect(r.code, `${shape}: stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
      expect(r.stderr).toContain("ccrc: could not give v1.0.0's older spine a directory of its own under $HOME/ccrc-versions — nothing was installed; $HOME/ccrc still points at v2.0.0 ($HOME/ccrc-versions/v1.0.0 is not a directory ccrc placed)");
      expect(linkOf(home), shape).toBe(cur);
      expect(fileText(join(home, '.ccrc', 'installed')), shape).toBe(rec);
      expect(existsSync(join(home, 'staged-ccrc-argv')), `${shape}: the staged spine ran`).toBe(false);
      expect(treeDigest(other), `${shape}: something was written through the link`).toEqual(otherBefore);
      expect(dotEntries(home), shape).toEqual([]);
    }
  });

  // D-3459 (controller ruling R-A): `_upd_legacy_target` points ~/ccrc at the
  // older spine's own directory BEFORE that spine runs. A spine that then dies
  // WITHOUT replacing anything (cmd_update's moved=0 arm) must not leave the
  // link there: exit 1 says "nothing was replaced", and the next restart would
  // run the voided older version, or the copy, under the unchanged stamp.
  describe('an older spine that dies before replacing anything gives ~/ccrc back (D-3459)', () => {
    const DIED = /^ccrc: the staged install \(which ends with doctor\) exited 1 — spine died at /m;
    /** A linked v2.0.0 box asked to move to an older v1.0.0 whose spine (the
     *  STUB shim, exit 1, no directory of its own) dies; `kept` also plants a
     *  kept, complete v1.0.0 beside it. Returns the box, v2.0.0's root, and
     *  v2.0.0's digest before the run. */
    const dyingBox = (prefix: string, kept: boolean): { home: string; cur: string; before: Record<string, string> } => {
      const home = freshUpdateBox(prefix);
      const cur = plantW6Box(home, 'v2.0.0', V2_SHA);
      if (kept) installVersionedTree(home, 'v1.0.0', { link: false, stamp: { sha: V1_SHA, version: 'v1.0.0' } });
      packRelease(home, stubTree(home, { version: 'v1.0.0', installExit: 1 }), { tag: 'v1.0.0', latest: false });
      return { home, cur, before: treeDigest(cur) };
    };

    it.each([['a copy of the running version', false], ['a kept directory', true]] as const)('a MARKED death before _inst_tree (%s): exit 1, ~/ccrc pointed back at the version it named before, that version byte-unchanged, and the sentence says so', (_what, kept) => {
      const { home, cur, before } = dyingBox('ccrc-update-legacy-back-marked-', kept);
      writeFileSync(join(home, 'fixture-install-step'), '_inst_node_id\n');
      const r = runUpdate(home, ['--to', 'v1.0.0', '--downgrade']);
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
      expect(r.stdout).toContain("update: tree: v1.0.0's spine predates versioned installs and writes through $HOME/ccrc");
      expect(r.stderr).toMatch(DIED);
      expect(r.stderr).toContain('spine died at _inst_node_id, before _inst_tree: nothing was replaced;');
      expect(r.stderr).toContain('$HOME/ccrc points back at $HOME/ccrc-versions/v2.0.0');
      expect(linkOf(home), 'the legacy flip was left in place').toBe(cur);
      expect(treeDigest(cur), 'the version this run replaces was written').toEqual(before);
      // The directory named for the older tag stays where it was put.
      expect(existsSync(join(home, 'ccrc-versions', 'v1.0.0'))).toBe(true);
      expect(existsSync(join(home, 'ccrc-versions', 'v1.0.0', '.ccrc-installed')), 'the older directory claims completeness').toBe(false);
      expect(lastReport(home)['phase']).toBe('failed');
    });

    it.each([['a copy of the running version', false], ['a kept directory', true]] as const)('an UNMARKED death (a spine older than W4 writes no step; its stamp did not move) reads the same (%s)', (_what, kept) => {
      const { home, cur, before } = dyingBox('ccrc-update-legacy-back-unmarked-', kept);
      const r = runUpdate(home, ['--to', 'v1.0.0', '--downgrade']);
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
      expect(existsSync(join(home, '.ccrc', 'install-step')), 'the fixture wrote a marker — this case is about a spine that writes none').toBe(false);
      expect(r.stderr).toMatch(DIED);
      expect(r.stderr).toContain('spine died at an unrecorded step (no step marker; a spine older than W4 writes none)');
      expect(r.stderr).toContain('$HOME/ccrc points back at $HOME/ccrc-versions/v2.0.0');
      expect(linkOf(home), 'the legacy flip was left in place').toBe(cur);
      expect(treeDigest(cur)).toEqual(before);
      expect(lastReport(home)['phase']).toBe('failed');
    });

    it('a flip back that fails is named, never silent: ~/ccrc still points at the older tag\'s directory, and the sentence says flipping it back to v2.0.0 failed', () => {
      const { home } = dyingBox('ccrc-update-legacy-back-fails-', false);
      // A caps file to be cleared and (before the fix wave) put back, so its
      // absence below is a measurement and not a vacuous zero.
      writeFileSync(join(home, '.ccrc', 'ccrc-caps'), 'os linux\nverify\n');
      writeFileSync(join(home, 'fixture-install-step'), '_inst_node_id\n');
      // The spine leaves a real directory at <link>.new, which `_plat_ln_swap`
      // refuses to clear (Task 1): the legacy flip itself (before the spine)
      // succeeded, the flip back cannot.
      writeFileSync(join(home, 'fixture-on-install'), 'mkdir "$HOME/ccrc.new"\n');
      const r = runUpdate(home, ['--to', 'v1.0.0', '--downgrade']);
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
      expect(r.stderr).toMatch(DIED);
      expect(r.stderr).toContain('$HOME/ccrc still points at $HOME/ccrc-versions/v1.0.0, and flipping it back to v2.0.0 failed');
      expect(r.stderr).not.toContain('points back at');
      expect(linkOf(home)).toBe(join(home, 'ccrc-versions', 'v1.0.0'));
      // Controller ruling (final-review fix wave, Step 0a): `~/ccrc` names the
      // OLDER tree, so a completed-install record (or caps) put back would vouch
      // for a build the box is not on, and a retry could be skipped as
      // converged. Neither file goes back, and the sentence says why.
      expect(existsSync(join(home, '.ccrc', 'installed')), 'the record was put back over a tree ~/ccrc no longer names').toBe(false);
      expect(existsSync(join(home, '.ccrc', 'ccrc-caps')), 'the caps were put back over a tree ~/ccrc no longer names').toBe(false);
      expect(r.stderr).toContain('; not put back — $HOME/ccrc names another tree: completed-install record, caps');
      expect(r.stderr).not.toContain('put back as they were');
    });

    it('a die BETWEEN the legacy flip and the staged spine flips back too (D-3459 amended): a directory squatting on ~/.ccrc/install-step refuses the marker clear, nothing is installed, and ~/ccrc is on the version it named before', () => {
      const { home, cur, before } = dyingBox('ccrc-update-legacy-back-clear-', false);
      mkdirSync(join(home, '.ccrc', 'install-step'), { recursive: true });
      const r = runUpdate(home, ['--to', 'v1.0.0', '--downgrade']);
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
      // The flip really happened first (the spine's directory was made) ...
      expect(r.stdout).toContain("update: tree: v1.0.0's spine predates versioned installs and writes through $HOME/ccrc");
      expect(r.stderr).toContain('cannot clear ~/.ccrc/install-step before the staged install');
      // ... and the die put it back, and said so.
      expect(r.stderr).toContain('Nothing was installed; $HOME/ccrc points back at $HOME/ccrc-versions/v2.0.0; put back as they were: completed-install record; remove it by hand and re-run');
      expect(existsSync(join(home, '.ccrc', 'installed')), 'the cleared record was not put back').toBe(true);
      expect(linkOf(home), 'the legacy flip was left in place').toBe(cur);
      expect(existsSync(join(home, 'staged-ccrc-argv')), 'a spine ran').toBe(false);
      expect(treeDigest(cur)).toEqual(before);
    });

    it('_upd_legacy_target never removes the directory ~/ccrc names: a swap that returned 1 with the link already on it (D-3424\'s concurrent plain install) dies and keeps that directory (F5)', () => {
      const home = freshUpdateBox('ccrc-update-legacy-swap-linked-');
      plantW6Box(home, 'v2.0.0', V2_SHA);
      const dir = join(home, 'ccrc-versions', 'v1.0.0');
      // A swap that links, THEN reports failure: the shape `_plat_ln_swap`
      // has when a concurrent install flips first.
      const r = sourcedCcrc(home,
        '_ver_layout; _plat_ln_swap() { ln -sfn "$1" "$2"; return 1; }; _upd_legacy_target v1.0.0; echo survived');
      expect(r.code, r.stderr).toBe(1);
      expect(r.stdout).not.toContain('survived');
      expect(r.stderr).toContain('could not give v1.0.0\'s older spine a directory of its own');
      expect(linkOf(home), 'the link names the directory').toBe(dir);
      expect(existsSync(join(dir, 'server')), 'the directory the link names was removed').toBe(true);
    });

    it('_upd_legacy_target\'s copy is moved onto an ABSENT name: a directory that appeared meanwhile makes the move fail, never nest the copy inside it (F5)', () => {
      const home = freshUpdateBox('ccrc-update-legacy-appeared-');
      const cur = plantW6Box(home, 'v2.0.0', V2_SHA);
      const r = sourcedCcrc(home,
        '_ver_layout; cp() { command cp "$@"; mkdir -p "$HOME/ccrc-versions/v1.0.0/appeared"; }; _upd_legacy_target v1.0.0; echo survived');
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
      expect(r.stdout).not.toContain('survived');
      expect(readdirSync(join(home, 'ccrc-versions', 'v1.0.0')), 'the copy was nested inside the directory that appeared').toEqual(['appeared']);
      expect(readdirSync(join(home, 'ccrc-versions')).sort(), 'the incoming copy was left behind').toEqual(['v1.0.0', 'v2.0.0']);
      expect(linkOf(home)).toBe(cur);
    });

    it('the moved=1 path is unchanged: a spine that dies AT or AFTER _inst_tree is gated, not flipped back (the control)', () => {
      const { home } = dyingBox('ccrc-update-legacy-back-moved-', false);
      writeFileSync(join(home, 'fixture-install-step'), '_inst_skills\n');
      const r = runUpdate(home, ['--to', 'v1.0.0', '--downgrade']);
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
      expect(r.stderr).not.toContain('points back at');
      expect(r.stderr).toContain('spine died at _inst_skills');
      expect(linkOf(home)).toBe(join(home, 'ccrc-versions', 'v1.0.0'));
    });
  });
});

describe('ccrc update and rollback: refused before anything moves — a ~/ccrc this ccrc did not make, and a flip macOS cannot make (W6 Task 4)', () => {
  it('a foreign ~/ccrc (a link into a directory ccrc did not place) is refused by update BEFORE the backup, any download or any spine, and by rollback before the release-host question — the link and what it names byte-unchanged (D-3429, amended by Task 4)', () => {
    const home = freshUpdateBox('ccrc-update-foreign-');
    const other = join(home, 'operators-tree');
    mkdirSync(join(other, 'server'), { recursive: true });
    writeFileSync(join(other, 'server', 'MINE'), "the operator's own tree\n");
    symlinkSync(other, join(home, 'ccrc'));
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    const before = treeDigest(other);
    // A published release whose spine writes THROUGH $HOME/ccrc — an older
    // spine, as the restore arms would have run it over the link.
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-on-install'),
      'mkdir -p "$HOME/ccrc/server" && printf \'written through the link\\n\' > "$HOME/ccrc/server/WROTE-THROUGH"\n');
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toContain('ccrc: update: $HOME/ccrc is a link whose target is not a version directory under $HOME/ccrc-versions — refusing to place or flip a tree over something this ccrc did not make; nothing was downloaded or installed, and $HOME/ccrc and $HOME/ccrc-versions were not touched');
    expect(localUrls(home), 'the refused update reached the release host').toEqual([]);
    expect(r.stdout).not.toMatch(/^update: backup: /m);
    expect(existsSync(join(home, 'staged-ccrc-argv')), 'a spine ran over the foreign link').toBe(false);
    expect(lastReport(home)['phase']).toBe('failed');
    const writes = reportWrites(home).length;
    // The same box, asked to roll back: refused before the release host is
    // asked (so no exit 2), and before the lock (so no report is written).
    const rb = rollbackRun(home, ['--to', 'v1.0.0']);
    expect(rb.code, `stderr: ${rb.stderr}\nstdout: ${rb.stdout}`).toBe(1);
    expect(rb.stderr).toContain('ccrc: rollback: $HOME/ccrc is a link whose target is not a version directory under $HOME/ccrc-versions — refusing to place or flip a tree over something this ccrc did not make; nothing on this box was changed');
    expect(localUrls(home), 'the refused rollback asked the release host').toEqual([]);
    expect(reportWrites(home).length, 'the refused rollback wrote a report').toBe(writes);
    // Neither run touched the link, what it names, or the versions root.
    expect(readlinkSync(join(home, 'ccrc'))).toBe(other);
    expect(treeDigest(other)).toEqual(before);
    expect(existsSync(join(home, 'ccrc-versions'))).toBe(false);
  });

  it('_ver_flip_back with a stamp that cannot be put back returns 2 with the completed-install record already CLEARED: the box reads incomplete, never current on the old build (F6)', () => {
    const home = freshUpdateBox('ccrc-update-flip-stamp-fails-');
    plantW6Box(home, 'v2.0.0', V2_SHA, 'server');
    keptVersion(home, 'v1.0.0', V1_SHA);
    // A directory at the stamp's own name: `_plat_mv_notdir` refuses to put
    // the kept stamp over it, after the flip has already happened.
    rmSync(join(home, '.ccrc', 'build.json'));
    mkdirSync(join(home, '.ccrc', 'build.json'));
    const r = sourcedCcrc(home,
      `rc=0; _ver_flip_back v1.0.0 server rollback || rc=$?; printf 'rc=%s why=%s\\n' "$rc" "$VER_WHY"`);
    expect(r.stdout.split('\n').filter((l) => l.startsWith('rc=')), r.stderr)
      .toEqual(['rc=2 why=its kept stamp could not be put back as this box\'s stamp']);
    expect(linkOf(home), 'the flip happened').toBe(join(home, 'ccrc-versions', 'v1.0.0'));
    expect(existsSync(join(home, '.ccrc', 'installed')), 'the box still reads current on the old build').toBe(false);
    expect(existsSync(join(home, 'kept-spine-argv')), 'the kept spine ran despite the failed stamp').toBe(false);
  });

  it('on macOS a python3 that is on PATH but does not RUN (the /usr/bin/python3 stub) is refused by _ver_can_flip too, with its own sentence — command -v is true there (F7; CCD_OS forced, sourced)', () => {
    const home = freshUpdateBox('ccrc-update-stubpy-probe-');
    const bin = join(home, 'stub-py-bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'python3'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const r = sourcedCcrc(home,
      `for os in darwin linux; do ( CCD_OS=$os; PATH='${bin}':"$PATH"; rc=0; _ver_can_flip || rc=$?; printf '%s rc=%s why=%s\\n' "$os" "$rc" "$VER_WHY" ); done`);
    expect(r.stdout.split('\n').filter((l) => / rc=/.test(l)), r.stderr).toEqual([
      'darwin rc=1 why=python3 is on PATH but does not run (on macOS /usr/bin/python3 is only a stub until the Xcode Command Line Tools are installed) — the $HOME/ccrc flip is one rename(2) through os.replace; install them: xcode-select --install',
      'linux rc=0 why=',
    ]);
  });

  it('on macOS without python3 the two flips this ccrc makes OUTSIDE a spine refuse before anything moves, naming python3 — never "the one rename failed" (_ver_can_flip, _ver_flip_back, _upd_legacy_target; CCD_OS forced, sourced; D-3419, amended by Task 4)', () => {
    // From this assignment on the sourced shell has builtins only.
    const NOPY = 'PATH="$HOME/no-such-bin"';
    const PY_WHY = 'python3 is not on PATH — on macOS the $HOME/ccrc flip is one rename(2) through os.replace; install the Xcode Command Line Tools: xcode-select --install';
    // The probe: Darwin only.
    let home = freshUpdateBox('ccrc-update-nopy-probe-');
    let r = sourcedCcrc(home,
      `for os in darwin linux; do ( CCD_OS=$os; ${NOPY}; rc=0; _ver_can_flip || rc=$?; printf '%s rc=%s why=%s\\n' "$os" "$rc" "$VER_WHY" ); done`);
    expect(r.stdout.split('\n').filter((l) => / rc=/.test(l)), r.stderr).toEqual([`darwin rc=1 why=${PY_WHY}`, 'linux rc=0 why=']);
    // `_ver_flip_back`: rc 1, nothing changed — which arm 1 reports as
    // `could not flip to <prev> (<why>)` and a rollback as `could not be
    // flipped to (<why>)`, python3 named in both.
    home = freshUpdateBox('ccrc-update-nopy-flip-');
    const cur = plantW6Box(home, 'v2.0.0', V2_SHA, 'server');
    keptVersion(home, 'v1.0.0', V1_SHA);
    const rec = fileText(join(home, '.ccrc', 'installed'));
    r = sourcedCcrc(home,
      `CCD_OS=darwin; ${NOPY}; rc=0; _ver_flip_back v1.0.0 server rollback || rc=$?; printf 'rc=%s why=%s\\n' "$rc" "$VER_WHY"`);
    expect(r.stdout.split('\n').filter((l) => l.startsWith('rc=')), r.stderr).toEqual([`rc=1 why=${PY_WHY}`]);
    expect(linkOf(home)).toBe(cur);
    expect(fileText(join(home, '.ccrc', 'installed'))).toBe(rec);
    expect(existsSync(join(home, 'kept-spine-argv'))).toBe(false);
    // `_upd_legacy_target`: dies with the refusal, python3 named, before any copy.
    home = freshUpdateBox('ccrc-update-nopy-legacy-');
    const cur2 = plantW6Box(home, 'v2.0.0', V2_SHA);
    r = sourcedCcrc(home, `_ver_layout; CCD_OS=darwin; ${NOPY}; _upd_legacy_target v1.0.0; echo survived`);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toContain(`ccrc: could not give v1.0.0's older spine a directory of its own under $HOME/ccrc-versions — nothing was installed; $HOME/ccrc still points at v2.0.0 (${PY_WHY})`);
    expect(r.stdout).not.toContain('survived');
    expect(linkOf(home)).toBe(cur2);
    expect(readdirSync(join(home, 'ccrc-versions')).sort()).toEqual(['v2.0.0']);
  });
});

// F4 and F12 (review 179, fix round 1 item 4): the Darwin arms a LINUX leg can
// measure. `CCD_OS` is set from `$OSTYPE` at source time and is NOT read from
// the environment, so every case here assigns it AFTER sourcing (`sourcedCcrc`'s
// contract) — a whole-process run would need `OSTYPE=darwin…` instead. What is
// real on that Linux box is only what the arm under test itself produces:
// `updateEnv`'s python3 stub hands `import os` and the `os.replace` program to
// the real interpreter (and RECORDS every argv it is asked, `python3-argv`),
// so the Darwin flip really renames; other Darwin arms a forced run reaches
// (`_plat_size`'s `stat -f %z`, `_plat_mtime`'s `stat -f %m`) are GNU `stat`'s
// error, so no case asserts anything they produce. The `python3-argv` lines are
// the evidence the Darwin arm ran at all: Linux flips by `mv -fT` and asks
// python3 nothing.
describe('the Darwin arms a Linux leg can measure: the flip gate and flip, and the loaded-not-running GC read (F4, F12)', () => {
  // The three positive Darwin cases hand `python3 -c` to the REAL interpreter
  // (`REAL_PYTHON3`, above), so they skip on a box with none — as the stub's
  // `-c` arm is spread in only when one resolved. The refusal cases below stub
  // python3 away themselves and run everywhere.
  const PY_PROBE = '-c import os';
  const PY_REPLACE = '-c import os, sys; os.replace(sys.argv[1], sys.argv[2])';
  const pyCalls = (home: string): string[] => (existsSync(join(home, 'python3-argv'))
    ? fileText(join(home, 'python3-argv')).split('\n').filter((l) => l !== '') : []);

  it.skipIf(REAL_PYTHON3 === '')('_ver_can_flip answers yes on macOS when python3 runs — the positive path of the gate (the probe RAN; Linux never asks)', () => {
    const home = freshUpdateBox('ccrc-update-darwin-canflip-');
    const r = sourcedCcrc(home,
      `for os in darwin linux; do ( CCD_OS=$os; rc=0; _ver_can_flip || rc=$?; printf '%s rc=%s why=[%s]\\n' "$os" "$rc" "$VER_WHY" ); done`);
    expect(r.stdout.split('\n').filter((l) => / rc=/.test(l)), r.stderr).toEqual(['darwin rc=0 why=[]', 'linux rc=0 why=[]']);
    expect(pyCalls(home), 'the Darwin probe did not run python3').toEqual([PY_PROBE]);
  });

  it.skipIf(REAL_PYTHON3 === '')('_ver_flip_back flips on macOS through os.replace: the link, the stamp and the record end on the kept version, and its own spine ran', () => {
    const home = freshUpdateBox('ccrc-update-darwin-flipback-');
    plantW6Box(home, 'v2.0.0', V2_SHA, 'server');
    const kept = keptVersion(home, 'v1.0.0', V1_SHA);
    const r = sourcedCcrc(home,
      `CCD_OS=darwin; rc=0; _ver_flip_back v1.0.0 server rollback || rc=$?; printf 'rc=%s why=[%s]\\n' "$rc" "$VER_WHY"`);
    expect(r.stdout.split('\n').filter((l) => l.startsWith('rc=')), `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toEqual(['rc=0 why=[]']);
    expect(linkOf(home), 'the flip did not happen').toBe(kept);
    expect(fileText(join(home, '.ccrc', 'build.json'))).toBe(fileText(join(kept, '.ccrc-stamp.json')));
    expect(fileText(join(home, '.ccrc', 'installed'))).toBe(fileText(join(kept, '.ccrc-installed')));
    expect(existsSync(join(home, 'kept-spine-argv')), 'the kept spine did not run').toBe(true);
    // The Darwin arm, not Linux's `mv -fT`: the probe, then the one rename.
    const calls = pyCalls(home);
    expect(calls[0]).toBe(PY_PROBE);
    expect(calls.filter((c) => c.startsWith(`${PY_REPLACE} `)), calls.join('\n')).toHaveLength(1);
  });

  it.skipIf(REAL_PYTHON3 === '')("_upd_legacy_target's success path flips on macOS: ~/ccrc names the tag's directory, and the pointed-at version is never written", () => {
    const home = freshUpdateBox('ccrc-update-darwin-legacy-');
    const cur = plantW6Box(home, 'v2.0.0', V2_SHA);
    const before = treeDigest(cur);
    const r = sourcedCcrc(home, '_ver_layout; CCD_OS=darwin; rc=0; _upd_legacy_target v1.0.0 || rc=$?; printf "rc=%s\\n" "$rc"');
    expect(r.stdout.split('\n').filter((l) => l.startsWith('rc=')), `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toEqual(['rc=0']);
    expect(linkOf(home)).toBe(join(home, 'ccrc-versions', 'v1.0.0'));
    expect(readdirSync(join(home, 'ccrc-versions')).sort()).toEqual(['v1.0.0', 'v2.0.0']);
    expect(treeDigest(cur), 'the version this run replaces was written').toEqual(before);
    const calls = pyCalls(home);
    expect(calls[0]).toBe(PY_PROBE);
    expect(calls.filter((c) => c.startsWith(PY_REPLACE))).toHaveLength(1);
  });

  // F12. The fixture-path `launchctl` stub (which `_svc_launchctl` honours off
  // /bin and /usr/bin) has a loaded-but-not-running arm, `fixture-launchctl-not-running`:
  // rc 0 and `state = waiting`. That is "the manager did not say", and the GC read
  // must stop on it — `_ver_running_names` is asked DIRECTLY, because a forced-Darwin
  // whole prune stops earlier, in `_ver_list` on `_plat_mtime`'s `stat -f %m`, and
  // would pass for that reason. The two controls in the same run keep the arm honest:
  // a job nobody loaded (rc 113) is `inactive` and runs nothing (rc 0), and the
  // loaded-not-running job is the only one that stops it.
  it('the Darwin GC read stops on a job that is loaded but not running (rc 1, "no answer") — and reads a job that is not loaded (rc 113) as stopped', () => {
    const home = freshUpdateBox('ccrc-update-darwin-notrunning-');
    plantW6Box(home, 'v2.0.0', V2_SHA);
    const probe = `CCD_OS=darwin; rc=0; _ver_running_names || rc=$?; printf 'rc=%s running=[%s] why=[%s]\\n' "$rc" "\${VER_RUNNING[*]}" "$VER_WHY"`;
    // control: nothing is loaded — launchctl answers 113, a POSITIVE "no such job"
    let r = sourcedCcrc(home, probe);
    expect(r.stdout, r.stderr).toBe('rc=0 running=[] why=[]\n');
    // the job is loaded, and the manager answers, but the job is not running
    writeFileSync(join(home, 'launchctl-loaded'), 'app.ccrc.ccrc.plist\napp.ccrc.ccrc-agent.plist\n');
    writeFileSync(join(home, 'fixture-launchctl-not-running'), 'yes\n');
    r = sourcedCcrc(home, probe);
    expect(r.stdout, r.stderr).toBe('rc=1 running=[] why=[the service manager did not say whether ccrc.service is running (no answer)]\n');
    // and `_ver_protect`, which the prune calls, stops with the same reason
    r = sourcedCcrc(home, `CCD_OS=darwin; rc=0; _ver_protect || rc=$?; printf 'rc=%s why=[%s]\\n' "$rc" "$VER_WHY"`);
    expect(r.stdout, r.stderr).toBe('rc=1 why=[the service manager did not say whether ccrc.service is running (no answer)]\n');
  });
});

// ── ccrc versions, and the GC (design 2026-09-20 §11 "GC"; W6 Task 5) ────
// Spec §18 "GC never removes a needed version", one case per guard, each with
// its CONTROL in the same run: CCRC_VERSIONS_KEEP=0 makes every complete,
// unprotected version prunable, so a planted version the guard does not
// cover is removed beside the one it does. The two units read STOPPED
// (`fixture-unit-state`, wave 4 Task 5's knob; on macOS the launchctl stub
// answers "no such job" for a job nobody bootstrapped) in every case but the
// running guard's, so no case is held green by a second guard.
describe('ccrc versions, and the GC that never removes a needed version (W6 Task 5)', () => {
  const REAL_READLINK = realPath('readlink');
  const REAL_STAT = realPath('stat');
  const REAL_RM = realPath('rm');
  const lit = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const versionDirs = (home: string): string[] => readdirSync(join(home, 'ccrc-versions')).sort();
  const stopUnits = (home: string): void => writeFileSync(join(home, 'fixture-unit-state'), 'inactive\n');
  const plantPrevious = (home: string, text: string): void => {
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'previous'), text);
  };

  /** A W6 box: each of `names` placed COMPLETE under ~/ccrc-versions, the
   *  FIRST linked from ~/ccrc; each kept install record's mtime set so the
   *  order given IS the age order (`names[1]` the newest of the rest) —
   *  `_ver_list` orders by that mtime, never by name. `incomplete` adds
   *  directories with no kept record. The box stamp names the pointed-at
   *  version, as a completed install leaves it. */
  function versionedBox(prefix: string, names: string[], incomplete: string[] = []): string {
    const home = freshUpdateBox(prefix);
    names.forEach((n, i) => {
      const stamp = /^v\d/.test(n) ? { sha: 'b'.repeat(40), version: n } : { sha: 'b'.repeat(40) };
      const root = installVersionedTree(home, n, { link: i === 0, stamp });
      const t = 1_800_000_000 - i * 100;
      utimesSync(join(root, '.ccrc-installed'), t, t);
    });
    for (const n of incomplete) installVersionedTree(home, n, { link: false, complete: false });
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'), shippedStamp(names[0]!, 'b'.repeat(40)));
    return home;
  }

  /** `ccrc versions` against the fixture box, in `runUpdate`'s environment and
   *  order (env built, then the doctor stubs re-planted). */
  function runVersions(home: string, args: string[] = [], extraEnv: NodeJS.ProcessEnv = {}): Result {
    const env = { ...updateEnv(home), ...extraEnv };
    replantDoctorStubs(home);
    const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'versions', ...args], { env, encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  }

  /** `readlink -f` answering EMPTY, rc 0 — what BSD's readlink before macOS
   *  12.3 (no -f) leaves a caller holding. Planted in the replant directory;
   *  every other readlink argv is the real binary. */
  function plantReadlinkFEmpty(home: string): void {
    writeFileSync(join(home, 'doctor-stubs', 'readlink'),
      '#!/bin/sh\n'
      + 'if [ "$1" = "-f" ] && [ -f "$HOME/fixture-readlink-f-empty" ]; then exit 0; fi\n'
      + `exec ${REAL_READLINK} "$@"\n`, { mode: 0o755 });
    writeFileSync(join(home, 'fixture-readlink-f-empty'), 'yes\n');
  }

  const LISTED = ['v1.0.4', 'v1.0.3', 'untagged-0123456789ab', 'v1.0.2', 'v1.0.1', 'v1.0.0'];
  const LAST_LINE = 'versions: 7 kept tree(s) under $HOME/ccrc-versions; CCRC_VERSIONS_KEEP=2 plus the protected set '
    + "(pointed-at, previous, the projection's desired tags, running units) — 'ccrc versions --prune' removes the prunable ones";

  it('lists every kept tree newest first, marks the pointed-at one, says why each is kept — and takes no lock', () => {
    // untagged-… sits BETWEEN v1.0.3 and v1.0.2 by age: neither name order puts it there.
    const home = versionedBox('ccrc-versions-list-', LISTED, ['unstamped-fedcba987654']);
    stopUnits(home);
    plantPrevious(home, `v1.0.1\n${'c'.repeat(40)}\n`);
    const before = versionDirs(home);
    const r = runVersions(home, [], { CCRC_VERSIONS_KEEP: '2' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout.split('\n')).toEqual([
      'versions: $HOME/ccrc -> $HOME/ccrc-versions/v1.0.4',
      '  * v1.0.4  complete  kept: pointed-at',
      '    v1.0.3  complete  kept: newest 2',
      '    untagged-0123456789ab  complete  kept: newest 2',
      '    v1.0.2  complete  prunable',
      '    v1.0.1  complete  kept: previous',
      '    v1.0.0  complete  prunable',
      '    unstamped-fedcba987654  incomplete  prunable by --prune only',
      LAST_LINE,
      '',
    ]);
    expect(versionDirs(home)).toEqual(before);
    expect(existsSync(join(home, '.ccrc', 'update.lock'))).toBe(false);
    // A stamp that disagrees with the pointed-at name is said, not hidden:
    // something (deploy.sh, a pre-W6 spine) wrote through the link.
    writeFileSync(join(home, '.ccrc', 'build.json'), shippedStamp('v1.0.3', 'b'.repeat(40)));
    const s = runVersions(home, [], { CCRC_VERSIONS_KEEP: '2' });
    expect(s.stdout.split('\n')[0]).toBe(
      'versions: $HOME/ccrc -> $HOME/ccrc-versions/v1.0.4 (its stamp reads v1.0.3 — something wrote through $HOME/ccrc)');
  });

  it('--prune removes only what nothing needs — complete ones past the newest N, and the incomplete — then lists what is left', () => {
    const home = versionedBox('ccrc-versions-prune-', LISTED, ['unstamped-fedcba987654']);
    stopUnits(home);
    plantPrevious(home, `v1.0.1\n${'c'.repeat(40)}\n`);
    const r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '2' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^versions: pruned \$HOME\/ccrc-versions\/v1\.0\.2 \(complete, not among the newest 2\)$/m);
    expect(r.stdout).toMatch(/^versions: pruned \$HOME\/ccrc-versions\/v1\.0\.0 \(complete, not among the newest 2\)$/m);
    expect(r.stdout).toMatch(/^versions: pruned \$HOME\/ccrc-versions\/unstamped-fedcba987654 \(incomplete\)$/m);
    expect(versionDirs(home)).toEqual(['untagged-0123456789ab', 'v1.0.1', 'v1.0.3', 'v1.0.4']);
    expect(r.stdout).toMatch(/^versions: 4 kept tree\(s\) under \$HOME\/ccrc-versions;/m);
    // Nothing left to remove: the second prune says so and removes nothing.
    const again = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '2' });
    expect(again.code).toBe(0);
    expect(again.stdout).toMatch(/^versions: nothing to prune — every kept tree is protected or among the newest 2$/m);
    expect(versionDirs(home)).toEqual(['untagged-0123456789ab', 'v1.0.1', 'v1.0.3', 'v1.0.4']);
  });

  it('the argument surface: -h is usage at exit 0; anything else is exit 2; a non-numeric CCRC_VERSIONS_KEEP refuses at exit 1 before the lock', () => {
    const home = versionedBox('ccrc-versions-args-', ['v1.0.1', 'v1.0.0']);
    let r = runVersions(home, ['-h']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^ {2}versions {2}list the kept release trees under ~\/ccrc-versions \(\* marks the one ~\/ccrc points at\);$/m);
    r = runVersions(home, ['--bogus']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: unknown argument: --bogus/m);
    r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: 'three' });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: versions: CCRC_VERSIONS_KEEP='three' is not a whole number from 0 to 9999, as set in the environment — nothing was pruned$/m);
    expect(versionDirs(home)).toEqual(['v1.0.0', 'v1.0.1']);
    expect(existsSync(join(home, '.ccrc', 'update.lock'))).toBe(false);
    // F8: listing is exit 0 by the exit table — a bad knob WARNs and lists, verdicts unmeasured.
    r = runVersions(home, [], { CCRC_VERSIONS_KEEP: 'three' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^versions: WARN: CCRC_VERSIONS_KEEP='three' is not a whole number from 0 to 9999, as set in the environment — listing only; nothing would be pruned$/m);
    expect(r.stdout).toMatch(/^ {2}\* v1\.0\.1 {2}complete {2}kept: CCRC_VERSIONS_KEEP could not be used \(the WARN above says why\)$/m);
    expect(r.stdout).toMatch(/^ {2}  v1\.0\.0 {2}complete {2}kept: CCRC_VERSIONS_KEEP could not be used \(the WARN above says why\)$/m);
    expect(versionDirs(home)).toEqual(['v1.0.0', 'v1.0.1']);
  });

  // F6 (review 179, fix round 1 item 6): ONE bounded validator, `^[0-9]{1,4}$`, for
  // every KEEP knob. `99999999999999999999` used to pass `^[0-9]+$`, and then
  // `[ -le ]` / `[ -lt ]` failed with rc 2 ("integer expression expected"), so
  // the short-circuit was skipped and every unprotected complete version was
  // pruned — by `--prune` and by the automatic GC after a passed gate — while
  // the plain listing called every one of them `prunable`.
  describe('the KEEP knob is ONE bounded number: a whole number from 0 to 9999, or nothing is pruned and nothing is called prunable (F6)', () => {
    const NAMES = ['v1.0.4', 'v1.0.3', 'v1.0.2', 'v1.0.1', 'v1.0.0'];
    const WHY = (v: string): string => `CCRC_VERSIONS_KEEP='${v}' is not a whole number from 0 to 9999, as set in the environment`;
    const HUGE = '99999999999999999999';

    it("the report's value is refused by the prune, the plain listing and the automatic GC — every version stays, none is called prunable", () => {
      const home = versionedBox('ccrc-versions-keep-huge-', NAMES);
      stopUnits(home);
      let r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: HUGE });
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
      expect(r.stderr).toContain(`ccrc: versions: ${WHY(HUGE)} — nothing was pruned`);
      expect(r.stdout).not.toMatch(/pruned/);
      expect(existsSync(join(home, '.ccrc', 'update.lock')), 'refused before the lock').toBe(false);
      expect(versionDirs(home)).toEqual([...NAMES].sort());
      // The plain listing lists (exit 0), names the knob and value, and marks no version prunable.
      r = runVersions(home, [], { CCRC_VERSIONS_KEEP: HUGE });
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(r.stdout).toContain(`versions: WARN: ${WHY(HUGE)} — listing only; nothing would be pruned`);
      expect(r.stdout, 'a version was listed as prunable').not.toMatch(/^ {2}[ *] \S+ {2}(?:in)?complete {2}prunable/m);
      expect(r.stdout).toMatch(/^ {4}v1\.0\.0 {2}complete {2}kept: CCRC_VERSIONS_KEEP could not be used \(the WARN above says why\)$/m);
      expect(r.stdout).toContain('CCRC_VERSIONS_KEEP=(could not be used)');
      // The automatic GC keeps its contract: a WARN, rc 1 (its callers ignore it), nothing removed.
      const a = sourcedCcrc(home, `CCRC_VERSIONS_KEEP=${HUGE}; _ver_gc update auto; echo "rc=$?"`);
      expect(a.stdout, a.stderr).toBe(`update: versions: WARN: ${WHY(HUGE)} — nothing pruned\nrc=1\n`);
      expect(a.stderr).toBe('');
      expect(versionDirs(home)).toEqual([...NAMES].sort());
    });

    it('controls: 9999 is a working knob (nothing to prune beside four versions), 10000 is refused, and leading zeros are decimal', () => {
      const home = versionedBox('ccrc-versions-keep-bounds-', NAMES);
      stopUnits(home);
      let r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '9999' });
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(r.stdout).toContain('versions: nothing to prune — 4 complete version(s) beside the pointed-at one, within CCRC_VERSIONS_KEEP=9999, and none incomplete');
      expect(versionDirs(home)).toEqual([...NAMES].sort());
      r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '10000' });
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
      expect(r.stderr).toContain(`ccrc: versions: ${WHY('10000')} — nothing was pruned`);
      expect(versionDirs(home)).toEqual([...NAMES].sort());
      // A leading zero is decimal, and the number is said as a number: `0008` is 8.
      r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0008' });
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(r.stdout).toContain('within CCRC_VERSIONS_KEEP=8, and none incomplete');
      // `0002` is two, never octal-or-error arithmetic: the newest 2 beside the pointed-at one stay.
      r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0002' });
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(r.stdout).toMatch(/^versions: pruned \$HOME\/ccrc-versions\/v1\.0\.0 \(complete, not among the newest 2\)$/m);
      expect(r.stdout).toMatch(/^versions: pruned \$HOME\/ccrc-versions\/v1\.0\.1 \(complete, not among the newest 2\)$/m);
      expect(versionDirs(home)).toEqual(['v1.0.2', 'v1.0.3', 'v1.0.4']);
    });

    it('the value in the sentence is sanitised as _upd_validate_timeout does and capped in length: no control byte, no newline, no more than 32 characters and an ellipsis', () => {
      const home = versionedBox('ccrc-versions-keep-sane-', NAMES);
      stopUnits(home);
      let r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: 'a\nb\x1b[31mc' });
      expect(r.code, r.stderr).toBe(1);
      expect(r.stderr).toContain(`ccrc: versions: ${WHY('a?b?[31mc')} — nothing was pruned\n`);
      r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: 'x'.repeat(200) });
      expect(r.code, r.stderr).toBe(1);
      expect(r.stderr).toContain(`ccrc: versions: ${WHY(`${'x'.repeat(32)}...`)} — nothing was pruned\n`);
      expect(r.stderr).not.toContain('x'.repeat(33));
      expect(versionDirs(home)).toEqual([...NAMES].sort());
    });

    it('belt: _ver_verdicts answers unmeasured — rc 1, nothing doomed, every verdict kept — when a numeric test ERRORS, never prune (the validator is bypassed on purpose)', () => {
      const home = versionedBox('ccrc-versions-keep-belt-', NAMES);
      const script = (keep: string): string => [
        '_ver_list; declare -gA VER_PROTECT=()',
        `rc=0; _ver_verdicts prune ${keep} 2>/dev/null || rc=$?`,
        'printf "rc=%s doomed=[%s] why=[%s]\\n" "$rc" "${VER_DOOMED[*]}" "$VER_WHY"',
        'for n in "${VER_NAMES[@]}"; do printf "%s=%s\\n" "$n" "${VER_VERDICT[$n]}"; done',
      ].join('\n');
      const bad = sourcedCcrc(home, script(HUGE));
      expect(bad.stdout.split('\n')[0], bad.stderr)
        .toBe('rc=1 doomed=[] why=[the keep count could not be compared (an integer expression expected) — no version is pruned on a guess]');
      expect(bad.stdout.split('\n').slice(1, 6), bad.stderr).toEqual(NAMES.map((n) => `${n}=kept: unmeasured`));
      // the control: the same call over a number answers, and dooms what no slot holds
      // (nothing is protected in this call, so the pointed-at name takes the one slot)
      const ok = sourcedCcrc(home, script('1'));
      expect(ok.stdout.split('\n')[0], ok.stderr).toBe('rc=0 doomed=[v1.0.3 v1.0.2 v1.0.1 v1.0.0] why=[]');
    });
  });

  it('a box whose ~/ccrc is still a directory: nothing is versioned, and --prune removes nothing', () => {
    const home = freshUpdateBox('ccrc-versions-dir-');
    plantOldBox(home, { version: 'v1.0.0' });
    let r = runVersions(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^versions: \$HOME\/ccrc is a directory — not versioned yet; the next ccrc install or update migrates it$/m);
    expect(r.stdout).toMatch(/^versions: 0 kept tree\(s\) under \$HOME\/ccrc-versions;/m);
    r = runVersions(home, ['--prune']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^versions: nothing to prune — \$HOME\/ccrc is not versioned \(directory\)$/m);
    expect(existsSync(join(home, 'ccrc', 'server', 'OLD-MARKER'))).toBe(true);
  });

  it('a crashed migration is said with a command that can complete it — the placed version\'s own ccrc by its path, never the shim on PATH, never deploy.sh', () => {
    const home = freshUpdateBox('ccrc-versions-crashed-');
    mkdirSync(join(home, 'ccrc.migrating', 'server'), { recursive: true });
    installVersionedTree(home, 'v1.0.0', { link: false, stamp: { sha: 'b'.repeat(40), version: 'v1.0.0' } });
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'migrating-to'), 'v1.0.0\n');
    let r = runVersions(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.split('\n')[0]).toBe('versions: a migration crashed — $HOME/ccrc is absent beside $HOME/ccrc.migrating; '
      + 'run bash $HOME/ccrc-versions/v1.0.0/ccd/ccrc install (or bash install.sh from a ccrc checkout) to complete it '
      + '— the ccrc on PATH cannot run until then, and deploy.sh would place a second tree beside it');
    expect(r.stdout).toMatch(/^ {4}v1\.0\.0 {2}complete {2}kept: nothing is pruned while \$HOME\/ccrc reads crashed$/m);
    // A marker that names no placed version: no install can complete it, and
    // the line says the by-hand remedies instead of a command that would die.
    writeFileSync(join(home, '.ccrc', 'migrating-to'), 'v9.9.9\n');
    r = runVersions(home);
    expect(r.stdout.split('\n')[0]).toBe('versions: a migration crashed — $HOME/ccrc is absent beside $HOME/ccrc.migrating; '
      + '~/.ccrc/migrating-to names no placed version, so no install can complete it — link it by hand '
      + '(ln -s $HOME/ccrc-versions/<name> $HOME/ccrc) or move it back (mv $HOME/ccrc.migrating $HOME/ccrc); '
      + 'not deploy.sh, which would place a second tree beside it');
    // The listing reads; it repairs nothing.
    expect(existsSync(join(home, 'ccrc'))).toBe(false);
  });

  it('guard — the pointed-at version is never pruned (spec §18)', () => {
    const home = versionedBox('ccrc-versions-g-current-', ['v1.0.1', 'v1.0.0']);
    stopUnits(home);
    const r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    // the control: a complete version nothing protects IS removed
    expect(r.stdout).toMatch(/^versions: pruned \$HOME\/ccrc-versions\/v1\.0\.0 \(complete, not among the newest 0\)$/m);
    expect(r.stdout).toMatch(/^ {2}\* v1\.0\.1 {2}complete {2}kept: pointed-at$/m);
    expect(versionDirs(home)).toEqual(['v1.0.1']);
    expect(lstatSync(join(home, 'ccrc')).isSymbolicLink()).toBe(true);
    expect(existsSync(join(home, 'ccrc', 'ccd', 'ccrc'))).toBe(true);
  });

  it('guard — the previous version (~/.ccrc/previous) is never pruned (spec §18)', () => {
    const home = versionedBox('ccrc-versions-g-prev-', ['v1.0.2', 'v1.0.1', 'v1.0.0']);
    stopUnits(home);
    plantPrevious(home, `v1.0.0\n${'c'.repeat(40)}\n`);
    const r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^versions: pruned \$HOME\/ccrc-versions\/v1\.0\.1 \(complete, not among the newest 0\)$/m);
    expect(r.stdout).toMatch(/^ {4}v1\.0\.0 {2}complete {2}kept: previous$/m);
    expect(versionDirs(home)).toEqual(['v1.0.0', 'v1.0.2']);
    // An UNTAGGED previous (wave 4's D-3231: line 1 `untagged`, line 2 the old
    // stamp's sha) names the directory `_inst_version_name` gave that build,
    // `untagged-<sha12>` (Task 8's R4 writes exactly this). It is kept too,
    // beside the same control.
    const u = versionedBox('ccrc-versions-g-prev-untagged-', ['v1.0.2', 'untagged-0123456789ab', 'v1.0.0']);
    stopUnits(u);
    plantPrevious(u, `untagged\n0123456789ab${'c'.repeat(28)}\n`);
    const s = runVersions(u, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
    expect(s.code, `stderr: ${s.stderr}\nstdout: ${s.stdout}`).toBe(0);
    expect(s.stdout).toMatch(/^versions: pruned \$HOME\/ccrc-versions\/v1\.0\.0 \(complete, not among the newest 0\)$/m);
    expect(s.stdout).toMatch(/^ {4}untagged-0123456789ab {2}complete {2}kept: previous$/m);
    expect(versionDirs(u)).toEqual(['untagged-0123456789ab', 'v1.0.2']);
  });

  // PLATFORM-ONLY: a macOS box is never centrally managed (decision 17) —
  // `_upd_intent_state` answers not-configured there whatever the file says,
  // so its projection names no tag to protect. What macOS keeps is pinned by
  // the pointed-at and previous cases above, which run on both.
  itLinux('guard — every tag the control plane projection names is never pruned (spec §18)', () => {
    const home = versionedBox('ccrc-versions-g-desired-', ['v1.0.4', 'v1.0.3', 'v1.0.2', 'v1.0.1', 'v1.0.0']);
    stopUnits(home);
    plantRole(home, 'fleet');
    plantSyncTimer(home);
    plantClock(home);
    plantIntent(home, intentDoc({ desired: 'v1.0.2', desiredStable: 'v1.0.2', desiredDev: 'v1.0.1' }));
    const r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^versions: pruned \$HOME\/ccrc-versions\/v1\.0\.0 \(complete, not among the newest 0\)$/m);
    expect(r.stdout).toMatch(/^versions: pruned \$HOME\/ccrc-versions\/v1\.0\.3 \(complete, not among the newest 0\)$/m);
    expect(r.stdout).toMatch(/^ {4}v1\.0\.2 {2}complete {2}kept: desired desired-stable$/m);
    expect(r.stdout).toMatch(/^ {4}v1\.0\.1 {2}complete {2}kept: desired-dev$/m);
    expect(versionDirs(home)).toEqual(['v1.0.1', 'v1.0.2', 'v1.0.4']);
  });

  // PLATFORM-ONLY: this is systemd's `show -p ExecStart` struct. The macOS
  // arm reads the job's plist instead; the case after this one measures that
  // arm on either platform by forcing CCD_OS in a sourced shell.
  itLinux('guard — a version a running unit argv[] names directly is never pruned, and path= is never what is read (spec §18)', () => {
    const home = versionedBox('ccrc-versions-g-running-', ['v1.0.2', 'v1.0.1', 'v1.0.0']);
    // Both units RUN (the stub's default answer). The agent's command names
    // v1.0.1's own path — a unit hand-edited to run from a physical path.
    writeFileSync(join(home, 'fixture-execstart-ccrc-agent.service'),
      `/usr/bin/env node ${home}/ccrc-versions/v1.0.1/agent/dist/agent/src/index.js\n`);
    const r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^versions: pruned \$HOME\/ccrc-versions\/v1\.0\.0 \(complete, not among the newest 0\)$/m);
    expect(r.stdout).toMatch(/^ {4}v1\.0\.1 {2}complete {2}kept: running$/m);
    // ccrc.service's command names $HOME/ccrc/…, which resolves through the link
    expect(r.stdout).toMatch(/^ {2}\* v1\.0\.2 {2}complete {2}kept: pointed-at running$/m);
    expect(versionDirs(home)).toEqual(['v1.0.1', 'v1.0.2']);
    const calls = readFileSync(join(home, 'systemctl-calls'), 'utf8').split('\n');
    expect(calls).toContain('--user show -p ExecStart ccrc.service');
    expect(calls).toContain('--user show -p ExecStart ccrc-agent.service');
  });

  it('the Darwin arm reads the job ProgramArguments through plutil, the quotes round the entry path stripped — and an empty answer is unmeasured', () => {
    const home = versionedBox('ccrc-versions-darwin-arm-', ['v1.0.2', 'v1.0.1']);
    const entry = `${home}/ccrc-versions/v1.0.1/server/dist/server/src/index.js`;
    // What `plutil -convert json` prints for `_inst_plist_server`'s job (its
    // `&amp;&amp;` is `&&` once parsed; the entry path single-quoted).
    writeFileSync(join(home, 'fixture-plist.json'), `${JSON.stringify({
      Label: 'app.ccrc.ccrc',
      ProgramArguments: ['/bin/bash', '-c',
        `set -a; [ -f '${home}/.ccrc/ccrc.env' ] && . '${home}/.ccrc/ccrc.env'; `
        + `[ -f '${home}/.ccrc/exposure.env' ] && . '${home}/.ccrc/exposure.env'; set +a; `
        + `exec /usr/bin/env node '${entry}'`],
    })}\n`);
    const probe = (plutil: string): Result => sourcedCcrc(home, [
      'CCD_OS=darwin',
      plutil,
      '_svc_is_active() { case "$1" in ccrc.service) printf active ;; *) printf inactive ;; esac; }',
      '_ver_running_names; rc=$?',
      'printf "rc=%s running=[%s] why=[%s]\\n" "$rc" "${VER_RUNNING[*]}" "$VER_WHY"',
    ].join('\n'));
    let r = probe('plutil() { [ "$1 $2 $3 $4" = "-convert json -o -" ] && cat "$HOME/fixture-plist.json"; }');
    expect(r.stdout, r.stderr).toBe('rc=0 running=[v1.0.1] why=[]\n');
    r = probe('plutil() { return 0; }');
    expect(r.stdout, r.stderr).toBe(
      "rc=1 running=[] why=[ccrc.service is running and its job file's ProgramArguments could not be read (plutil -convert json)]\n");
  });

  // PLATFORM-ONLY: every input here is one only a Linux box's reader asks —
  // systemd's is-active and ExecStart, `readlink -f` on the tokens those
  // yield, and a projection (macOS is never centrally managed, decision 17).
  // The input both platforms read, ~/.ccrc/previous, is the next case.
  itLinux('an input that cannot be measured prunes nothing, and the prune says which (unit state, ExecStart, readlink -f, the projection)', () => {
    const fixtures: Array<[string, (h: string) => void, (h: string) => string]> = [
      ['unit-state', (h) => writeFileSync(join(h, 'fixture-unit-state'), ''),
        () => 'the service manager did not say whether ccrc.service is running (no answer)'],
      ['execstart', (h) => writeFileSync(join(h, 'fixture-execstart-raw'),
        `ExecStart=/usr/bin/env node ${h}/ccrc/server/dist/server/src/index.js\n`),
      () => "ccrc.service's ExecStart did not parse as systemd's struct form"],
      ['readlink', (h) => plantReadlinkFEmpty(h),
        (h) => `ccrc.service's command names ${h}/ccrc/server/dist/server/src/index.js, which readlink -f could not resolve`],
      ['projection', (h) => {
        stopUnits(h); plantRole(h, 'fleet'); plantSyncTimer(h); plantClock(h);
        plantIntent(h, intentDoc({ issued: String(INTENT_NOW - 2000), lease: String(INTENT_NOW - 1000) }));
      }, () => "the control plane's projection is stale (its lease ended 1000s ago) — its desired tags cannot be read"],
    ];
    for (const [label, plant, why] of fixtures) {
      const home = versionedBox(`ccrc-versions-unmeasured-${label}-`, ['v1.0.1', 'v1.0.0']);
      plant(home);
      const r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
      expect(r.code, `${label}: ${r.stdout}${r.stderr}`).toBe(1);
      expect(r.stdout, label).toMatch(new RegExp(`^versions: prune skipped — ${lit(why(home))}; nothing was removed$`, 'm'));
      expect(r.stdout, label).toMatch(/^ {4}v1\.0\.0 {2}complete {2}kept: unmeasured$/m);
      expect(versionDirs(home), label).toEqual(['v1.0.0', 'v1.0.1']);
    }
  });

  // F3 (review 179, fix round 1 item 3): the `projection` row above plants a
  // STALE document, the one word `_ver_protect`'s catch-all arm answers by
  // name. `unreadable` and `malformed` are two more words with the same
  // arm, and CLAUDE.md names folding either into `not-configured` as the
  // forbidden shape ("stale and unreadable ... never folded"), so each is its
  // OWN case: a loop over rows would show only the first red of a fold. The
  // `unreadable` row is a `server` box with NO projection file — the shape
  // no case ran end to end before this one (an absent file on a server/both
  // box is unreadable, never `not-configured`).
  const projectionRows: Array<[string, (h: string) => void, string]> = [
    ['unreadable', (h) => { stopUnits(h); plantRole(h, 'server'); },
      "the control plane's projection is unreadable (absent) — its desired tags cannot be read"],
    ['malformed', (h) => { stopUnits(h); plantRole(h, 'server'); plantIntent(h, 'garbage\nend\n'); },
      "the control plane's projection is malformed (not exactly nine lines) — its desired tags cannot be read"],
  ];
  for (const [word, plant, why] of projectionRows) {
    itLinux(`${word === 'unreadable' ? 'an' : 'a'} ${word} projection prunes nothing, by hand and automatically — its own case, never folded into not-configured (F3)`, () => {
      const home = versionedBox(`ccrc-versions-unmeasured-proj-${word}-`, ['v1.0.1', 'v1.0.0']);
      plant(home);
      const r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
      expect(r.code, `${word}: ${r.stdout}${r.stderr}`).toBe(1);
      expect(r.stdout).toMatch(new RegExp(`^versions: prune skipped — ${lit(why)}; nothing was removed$`, 'm'));
      expect(r.stdout).toMatch(/^ {4}v1\.0\.0 {2}complete {2}kept: unmeasured$/m);
      expect(versionDirs(home)).toEqual(['v1.0.0', 'v1.0.1']);
      // The automatic GC reads the same input the same way: WARN, rc 1, nothing removed.
      const a = sourcedCcrc(home, 'CCRC_VERSIONS_KEEP=0; _ver_gc update auto; echo "rc=$?"');
      expect(a.stdout, a.stderr).toBe(`update: versions: WARN: nothing pruned — ${why}\nrc=1\n`);
      expect(versionDirs(home)).toEqual(['v1.0.0', 'v1.0.1']);
    });
  }

  // Both platforms: `_plat_mtime` is `stat -c %Y` or `stat -f %m`, and the
  // shim below fails either spelling the same way. It is not a fifth row of
  // the itLinux table above, so the macOS leg measures it too.
  it('a kept install record whose mtime cannot be read prunes nothing — the keep-N order would be a guess', () => {
    const home = versionedBox('ccrc-versions-unmeasured-mtime-', ['v1.0.1', 'v1.0.0']);
    stopUnits(home);
    // `stat` that fails for a kept install record, and only for one; every
    // other argv is the real binary (plantReadlinkFEmpty's idiom).
    writeFileSync(join(home, 'doctor-stubs', 'stat'),
      '#!/bin/sh\n'
      + 'for a in "$@"; do last="$a"; done\n'
      + 'if [ -f "$HOME/fixture-stat-record-fails" ]; then\n'
      + '  case "$last" in */.ccrc-installed) echo "stat: cannot statx \'$last\': Permission denied" >&2; exit 1 ;; esac\n'
      + 'fi\n'
      + `exec ${REAL_STAT} "$@"\n`, { mode: 0o755 });
    writeFileSync(join(home, 'fixture-stat-record-fails'), 'yes\n');
    const r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
    expect(r.code, `${r.stdout}${r.stderr}`).toBe(1);
    // The glob runs in name order and VER_WHY keeps the LAST record that failed.
    expect(r.stdout).toMatch(/^versions: prune skipped — the kept install record of v1\.0\.1 has no readable mtime; nothing was removed$/m);
    expect(r.stdout).toMatch(/^ {4}v1\.0\.0 {2}complete {2}kept: unmeasured$/m);
    expect(versionDirs(home)).toEqual(['v1.0.0', 'v1.0.1']);
  });

  it('a malformed ~/.ccrc/previous prunes nothing — by hand or automatically', () => {
    const home = versionedBox('ccrc-versions-prev-bad-', ['v1.0.1', 'v1.0.0']);
    stopUnits(home);
    plantPrevious(home, 'garbage\n');
    const r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
    expect(r.code, r.stdout).toBe(1);
    expect(r.stdout).toMatch(/^versions: prune skipped — ~\/\.ccrc\/previous is unreadable or malformed; nothing was removed$/m);
    const a = sourcedCcrc(home, 'CCRC_VERSIONS_KEEP=0; _ver_gc update auto; echo "rc=$?"');
    expect(a.stdout, a.stderr).toBe('update: versions: WARN: nothing pruned — ~/.ccrc/previous is unreadable or malformed\nrc=1\n');
    expect(versionDirs(home)).toEqual(['v1.0.0', 'v1.0.1']);
  });

  it('the automatic GC is silent, and measures nothing, when nothing is prunable whatever is protected', () => {
    const home = versionedBox('ccrc-versions-silent-', ['v1.0.1', 'v1.0.0']);
    // an input that WOULD stop a prune that measured it
    plantPrevious(home, 'garbage\n');
    const quiet = sourcedCcrc(home, '_ver_gc install auto; echo "rc=$?"');
    expect(quiet.stdout, quiet.stderr).toBe('rc=0\n');
    // the control: with one complete version more than CCRC_VERSIONS_KEEP, the
    // same box measures — and says why it stops
    const loud = sourcedCcrc(home, 'CCRC_VERSIONS_KEEP=0; _ver_gc install auto; echo "rc=$?"');
    expect(loud.stdout, loud.stderr).toBe('install: versions: WARN: nothing pruned — ~/.ccrc/previous is unreadable or malformed\nrc=1\n');
    expect(versionDirs(home)).toEqual(['v1.0.0', 'v1.0.1']);
  });

  it('the automatic GC never removes an incomplete version — a plain install may be placing it; --prune does', () => {
    const home = versionedBox('ccrc-versions-incomplete-', ['v1.0.2', 'v1.0.1'], ['untagged-0123456789ab']);
    stopUnits(home);
    const a = sourcedCcrc(home, 'CCRC_VERSIONS_KEEP=0; _ver_gc install auto; echo "rc=$?"');
    expect(a.stdout, a.stderr).toBe('install: versions: pruned $HOME/ccrc-versions/v1.0.1 (complete, not among the newest 0)\nrc=0\n');
    expect(versionDirs(home)).toEqual(['untagged-0123456789ab', 'v1.0.2']);
    const p = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
    expect(p.code, p.stdout).toBe(0);
    expect(p.stdout).toMatch(/^versions: pruned \$HOME\/ccrc-versions\/untagged-0123456789ab \(incomplete\)$/m);
    expect(versionDirs(home)).toEqual(['v1.0.2']);
  });

  // D-3460: the prune renames the version out of every reader's view in ONE
  // rename, THEN deletes. The `rm` stub is planted in the replant directory
  // (the seam `plantReadlinkFEmpty` and the `stat` shim use): for a path under
  // ccrc-versions/ it deletes `server/node_modules` and exits 1 — a removal
  // that dies part-way, in readdir order, with the kept record still standing.
  it('a prune whose rm dies part-way leaves NO half-deleted version under a version name — it was renamed out of view first (D-3460)', () => {
    const home = versionedBox('ccrc-versions-rm-dies-', ['v1.0.1', 'v1.0.0']);
    stopUnits(home);
    mkdirSync(join(home, 'ccrc-versions', 'v1.0.0', 'server', 'node_modules'), { recursive: true });
    writeFileSync(join(home, 'ccrc-versions', 'v1.0.0', 'server', 'node_modules', 'x'), 'x\n');
    writeFileSync(join(home, 'doctor-stubs', 'rm'),
      '#!/bin/sh\n'
      + 'for a in "$@"; do last="$a"; done\n'
      + 'case "$last" in */ccrc-versions/*)\n'
      + `  ${REAL_RM} -rf -- "$last/server/node_modules"; echo "rm: cannot remove '$last': fixture" >&2; exit 1 ;;\n`
      + 'esac\n'
      + `exec ${REAL_RM} "$@"\n`, { mode: 0o755 });
    const r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stdout).toMatch(/^versions: could not finish pruning \$HOME\/ccrc-versions\/v1\.0\.0 — it is already out of the version list and out of every reader's reach \(a rename took it there; that is not a proof that nothing runs from it\); its remains are at \$HOME\/ccrc-versions\/\.pruning-v1\.0\.0\.[0-9]+, which the next prune removes first, once its KEEP knob and \$HOME\/ccrc pass the prune's own checks \(a refused knob, or a \$HOME\/ccrc that is not a link to a version here, sweeps nothing\)$/m);
    // not listed, and no directory under the version's own name
    expect(r.stdout).not.toMatch(/^ {4}v1\.0\.0 /m);
    const dirs = versionDirs(home);
    expect(dirs.filter((d) => d === 'v1.0.0')).toEqual([]);
    const husk = dirs.filter((d) => /^\.pruning-v1\.0\.0\.[0-9]+$/.test(d));
    expect(husk, dirs.join(' ')).toHaveLength(1);
    // the husk is what the stub left: node_modules gone, the kept record still there
    expect(existsSync(join(home, 'ccrc-versions', husk[0]!, 'server', 'node_modules'))).toBe(false);
    expect(existsSync(join(home, 'ccrc-versions', husk[0]!, '.ccrc-installed'))).toBe(true);
    expect(dirs).toContain('v1.0.1');
  });

  it('the next prune finishes a leftover whose process is dead, and never touches one whose process is alive (D-3460)', () => {
    const home = versionedBox('ccrc-versions-leftover-', ['v1.0.1', 'v1.0.0']);
    stopUnits(home);
    const DEAD = 999999;
    expect(() => process.kill(DEAD, 0), 'the dead-pid fixture needs a pid nothing holds').toThrow();
    const dead = `.pruning-v0.0.1.${DEAD}`;
    const live = `.pruning-v0.0.1.${process.pid}`;
    for (const d of [dead, live]) {
      mkdirSync(join(home, 'ccrc-versions', d, 'server'), { recursive: true });
      writeFileSync(join(home, 'ccrc-versions', d, '.ccrc-installed'), 'x\n');
    }
    // a list-only run never sweeps
    const l = runVersions(home, [], { CCRC_VERSIONS_KEEP: '0' });
    expect(l.code, l.stderr).toBe(0);
    expect(versionDirs(home)).toContain(dead);
    const r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(new RegExp(`^versions: removed \\$HOME/ccrc-versions/${lit(dead)} \\(`, 'm'));
    expect(r.stdout).not.toContain(live);
    expect(versionDirs(home)).toEqual([live, 'v1.0.1']);
    // and neither one was ever listed as a version
    expect(r.stdout).not.toMatch(/^ {4}\.pruning/m);
  });

  // F7 (review 179, fix round 1 item 7). A dead-pid `.pruning-<name>.<pid>`
  // (the prune loop's rename target) and a dead-pid `.<tag>.incoming.<pid>`
  // (`_upd_legacy_target`'s staging directory, which NOTHING removed) are swept
  // ONCE per prune, right after the layout and knob checks — so before the
  // KEEP short-circuit, the empty-doomed return and `_ver_protect`'s
  // unmeasured return, each of which used to leave them behind. The sweep
  // removes nothing a reader could find (a rename took each directory out of
  // every reader's view); it is NOT a proof that nothing runs from one, which
  // is deferred item 3's root cause and stays on the residue list.
  describe('a dead process\'s leftover is swept once per prune, before anything can stop the prune (F7)', () => {
    const DEAD = 999999;
    const LIVE = process.pid;
    const dead = [`.pruning-v0.0.1.${DEAD}`, `.v0.0.2.incoming.${DEAD}`];
    const live = [`.pruning-v0.0.1.${LIVE}`, `.v0.0.2.incoming.${LIVE}`];
    const plantLeft = (home: string, names: string[]): void => {
      for (const d of names) {
        mkdirSync(join(home, 'ccrc-versions', d, 'server'), { recursive: true });
        writeFileSync(join(home, 'ccrc-versions', d, '.ccrc-installed'), 'x\n');
      }
    };
    const removedLine = (name: string): RegExp =>
      new RegExp(`^versions: removed \\$HOME/ccrc-versions/${lit(name)} \\(`, 'm');
    beforeAll(() => {
      expect(() => process.kill(DEAD, 0), 'the dead-pid fixture needs a pid nothing holds').toThrow();
    });

    it("the report's case: default KEEP, nothing to prune, a dead-pid leftover — the prune removes it (by hand and automatically), and says nothing to prune", () => {
      const home = versionedBox('ccrc-versions-sweep-nothing-', ['v1.0.1', 'v1.0.0']);
      stopUnits(home);
      plantLeft(home, dead);
      const r = runVersions(home, ['--prune']);
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      for (const d of dead) expect(r.stdout).toMatch(removedLine(d));
      expect(r.stdout).toMatch(/^versions: nothing to prune — 1 complete version\(s\) beside the pointed-at one, within CCRC_VERSIONS_KEEP=3, and none incomplete$/m);
      expect(versionDirs(home)).toEqual(['v1.0.0', 'v1.0.1']);
      // the automatic GC sweeps too, under its own lead, and is otherwise silent
      plantLeft(home, dead);
      const a = sourcedCcrc(home, '_ver_gc update auto; echo "rc=$?"');
      expect(a.stdout.split('\n').filter((l) => l !== ''), a.stderr).toEqual([
        ...dead.map((d) => `update: versions: removed $HOME/ccrc-versions/${d} (what ${d.startsWith('.pruning') ? 'an earlier prune' : 'an earlier update'} left, already out of the version list; its process is gone)`),
        'rc=0',
      ]);
      expect(versionDirs(home)).toEqual(['v1.0.0', 'v1.0.1']);
    });

    it('it is swept when every kept tree is protected (the empty-doomed return) and when an input cannot be measured (the unmeasured return, which still stops the prune)', () => {
      // empty-doomed: previous protects v1.0.1, so v1.0.0 takes the one slot and nothing is doomed
      let home = versionedBox('ccrc-versions-sweep-protected-', ['v1.0.2', 'v1.0.1', 'v1.0.0']);
      stopUnits(home);
      plantPrevious(home, `v1.0.1\n${'c'.repeat(40)}\n`);
      plantLeft(home, dead);
      let r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '1' });
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(r.stdout).toMatch(/^versions: nothing to prune — every kept tree is protected or among the newest 1$/m);
      for (const d of dead) expect(r.stdout).toMatch(removedLine(d));
      expect(versionDirs(home)).toEqual(['v1.0.0', 'v1.0.1', 'v1.0.2']);
      // unmeasured: a malformed previous stops the prune at rc 1 — after the sweep
      home = versionedBox('ccrc-versions-sweep-unmeasured-', ['v1.0.1', 'v1.0.0']);
      stopUnits(home);
      plantPrevious(home, 'garbage\n');
      plantLeft(home, dead);
      r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
      expect(r.stdout).toMatch(/^versions: prune skipped — ~\/\.ccrc\/previous is unreadable or malformed; nothing was removed$/m);
      for (const d of dead) expect(r.stdout).toMatch(removedLine(d));
      expect(versionDirs(home), 'the prune removed a version it could not measure').toEqual(['v1.0.0', 'v1.0.1']);
    });

    it('a leftover that cannot be removed fails the prune that could not remove it (rc 1) — through the short-circuit return too', () => {
      const home = versionedBox('ccrc-versions-sweep-rc-', ['v1.0.1', 'v1.0.0']);
      stopUnits(home);
      plantLeft(home, [dead[0]!]);
      writeFileSync(join(home, 'doctor-stubs', 'rm'),
        '#!/bin/sh\n'
        + 'for a in "$@"; do last="$a"; done\n'
        + 'case "$last" in */ccrc-versions/.pruning-*) echo "rm: cannot remove \'$last\': fixture" >&2; exit 1 ;; esac\n'
        + `exec ${REAL_RM} "$@"\n`, { mode: 0o755 });
      const r = runVersions(home, ['--prune']);
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
      expect(r.stdout).toContain(`versions: could not remove $HOME/ccrc-versions/${dead[0]} (what an earlier prune left, already out of the version list) — it stays out of every listing`);
      expect(r.stdout).toMatch(/^versions: nothing to prune — /m);
      expect(versionDirs(home)).toContain(dead[0]);
      // and through the empty-removal-set return: previous protects v1.0.1, v1.0.0 takes the one slot
      const p = versionedBox('ccrc-versions-sweep-rc-protected-', ['v1.0.2', 'v1.0.1', 'v1.0.0']);
      stopUnits(p);
      plantPrevious(p, `v1.0.1\n${'c'.repeat(40)}\n`);
      plantLeft(p, [dead[0]!]);
      writeFileSync(join(p, 'doctor-stubs', 'rm'), fileText(join(home, 'doctor-stubs', 'rm')), { mode: 0o755 });
      const q = runVersions(p, ['--prune'], { CCRC_VERSIONS_KEEP: '1' });
      expect(q.code, `stderr: ${q.stderr}\nstdout: ${q.stdout}`).toBe(1);
      expect(q.stdout).toMatch(/^versions: nothing to prune — every kept tree is protected or among the newest 1$/m);
      expect(versionDirs(p)).toContain(dead[0]);
    });

    it('control: a live pid is another process\'s work in flight and is never touched — beside a dead one, which goes', () => {
      const home = versionedBox('ccrc-versions-sweep-live-', ['v1.0.1', 'v1.0.0']);
      stopUnits(home);
      plantLeft(home, [...dead, ...live]);
      const r = runVersions(home, ['--prune']);
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      for (const d of dead) expect(r.stdout).toMatch(removedLine(d));
      for (const d of live) expect(r.stdout).not.toContain(d);
      expect(versionDirs(home)).toEqual([...live, 'v1.0.0', 'v1.0.1'].sort());
    });

    it('control: a refused knob measures nothing and sweeps nothing', () => {
      const home = versionedBox('ccrc-versions-sweep-knob-', ['v1.0.1', 'v1.0.0']);
      stopUnits(home);
      plantLeft(home, dead);
      const r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '99999999999999999999' });
      expect(r.code, r.stderr).toBe(1);
      const a = sourcedCcrc(home, 'CCRC_VERSIONS_KEEP=99999999999999999999; _ver_gc update auto; echo "rc=$?"');
      expect(a.stdout, a.stderr).toContain('rc=1');
      expect(versionDirs(home)).toEqual([...dead, 'v1.0.0', 'v1.0.1'].sort());
    });

    it('control: a dangling ~/ccrc reads foreign — the layout check comes first, and sweeps nothing', () => {
      const home = versionedBox('ccrc-versions-sweep-dangling-', ['v1.0.1', 'v1.0.0']);
      stopUnits(home);
      plantLeft(home, dead);
      rmSync(join(home, 'ccrc'));
      symlinkSync(join(home, 'ccrc-versions', 'v9.9.9'), join(home, 'ccrc'));
      const r = runVersions(home, ['--prune']);
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(r.stdout).toMatch(/^versions: nothing to prune — \$HOME\/ccrc is not versioned \(foreign\)$/m);
      expect(versionDirs(home)).toEqual([...dead, 'v1.0.0', 'v1.0.1'].sort());
    });

    it('control: a list-only run never sweeps', () => {
      const home = versionedBox('ccrc-versions-sweep-list-', ['v1.0.1', 'v1.0.0']);
      stopUnits(home);
      plantLeft(home, dead);
      const r = runVersions(home, []);
      expect(r.code, r.stderr).toBe(0);
      expect(versionDirs(home)).toEqual([...dead, 'v1.0.0', 'v1.0.1'].sort());
    });
  });

  it('--prune takes the update lock: a real holder refuses it at exit 1 and nothing is removed', () => {
    const home = versionedBox('ccrc-versions-lock-', ['v1.0.1', 'v1.0.0']);
    stopUnits(home);
    const lock = join(home, '.ccrc', 'update.lock');
    const holder = spawn('flock', [lock, 'sleep', '30'], { stdio: 'ignore', detached: true });
    try {
      // HELD is measured, never assumed from the spawn: a fresh flock -n fails.
      let held = false;
      for (let i = 0; i < 100 && !held; i++) {
        held = existsSync(lock) && spawnSync('flock', ['-n', lock, 'true']).status === 1;
        if (!held) spawnSync('sleep', ['0.05']);
      }
      expect(held).toBe(true);
      const r = runVersions(home, ['--prune'], { CCRC_VERSIONS_KEEP: '0' });
      expect(r.code, r.stdout).toBe(1);
      expect(r.stderr).toMatch(/^ccrc: update: another update holds ~\/\.ccrc\/update\.lock \(/m);
      expect(versionDirs(home)).toEqual(['v1.0.0', 'v1.0.1']);
    } finally {
      if (holder.pid !== undefined) {
        try { process.kill(-holder.pid, 'SIGKILL'); } catch { /* already gone */ }
      }
    }
  });

  it('_ver_list restores the caller nullglob, whichever way it was set', () => {
    const home = versionedBox('ccrc-versions-nullglob-', ['v1.0.1', 'v1.0.0']);
    const r = sourcedCcrc(home, [
      'shopt -u nullglob; _ver_list; shopt -q nullglob && echo on || echo off',
      'shopt -s nullglob; _ver_list; shopt -q nullglob && echo on || echo off',
      'printf "%s\\n" "${VER_NAMES[*]}"',
    ].join('\n'));
    expect(r.stdout, r.stderr).toBe('off\non\nv1.0.1 v1.0.0\n');
  });

  // PLATFORM-ONLY: on macOS the running read is plutil over the job's plist,
  // which this harness's plutil stub answers with nothing — an unmeasured
  // read, so the automatic GC WARNs and prunes nothing there (the safe
  // direction). The Darwin read itself is measured by the sourced case above.
  itLinux('an update whose health gate passed prunes behind it and keeps the previous', () => {
    const home = versionedBox('ccrc-versions-update-gc-', ['v1.0.4', 'v1.0.3', 'v1.0.2', 'v1.0.1', 'v1.0.0']);
    plantKillModeDropIn(home);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--to', 'v2.0.0']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    // The STUB spine's ccd/ccrc carries no BOX_VERSIONS_ROOT= line, so Task 4's
    // `_upd_legacy_target` gave it v2.0.0 (a copy of v1.0.4, its kept record
    // removed): five complete versions stand beside the pointed-at one. v1.0.4
    // is this run's `previous` (the stamp it replaced) and is protected, so it
    // takes no keep slot: the newest three of the REST stay (v1.0.3, v1.0.2,
    // v1.0.1) and only v1.0.0 goes. v1.0.1 staying is what measures the
    // previous guard here — without it v1.0.4 would fill a slot and v1.0.1
    // would be pruned too.
    expect(r.stdout).toMatch(/^update: versions: pruned \$HOME\/ccrc-versions\/v1\.0\.0 \(complete, not among the newest 3\)$/m);
    expect(r.stdout).not.toMatch(/^update: versions: pruned \$HOME\/ccrc-versions\/v1\.0\.1 /m);
    expect(versionDirs(home)).toEqual(['v1.0.1', 'v1.0.2', 'v1.0.3', 'v1.0.4', 'v2.0.0']);
    expect(readFileSync(join(home, '.ccrc', 'previous'), 'utf8').split('\n')[0]).toBe('v1.0.4');
  });
});

// W6 Task 8A (W4's worker's carry: the `*.tmp.$$` EXIT-trap class). A writer's
// `<dest>.tmp.$$` survives a SIGTERM, Ctrl-C or die caught between its
// creation and its rename unless something removes it at exit — and a shell
// has ONE EXIT trap, which every `trap '…' EXIT` REPLACES, so a per-function
// trap at each writer would have clobbered `_upd_resolve`'s staging trap (and
// `cmd_wrappers'`, and `cmd_rollout`'s). One chain (`_exit_add`, `_exit_run`,
// `_tmp_guard`) carries them all. The harness SOURCES the real `ccd/ccrc`
// under a fixture HOME and calls the real writers, with the step between the
// tmp's creation and its rename replaced by a `kill -TERM $$` on the shell
// itself; a CONTROL runs the same harness with `_tmp_guard` made a no-op, so
// a harness that could not see a leak would say so.
describe('ccrc: one EXIT chain — a killed writer leaves no <dest>.tmp.$$, and no per-function trap clobbers another (W6 Task 8A)', () => {
  const chainEnv = (home: string): NodeJS.ProcessEnv => {
    const env = ccrcContainedEnv(home, process.env, { managers: true, curl: 'poison' });
    for (const k of Object.keys(env)) if (k.startsWith('CCRC_')) delete env[k];
    return env;
  };
  it('chainEnv hands out no env under which a real ssh, scp, systemctl, systemd-run, launchctl, tmux, gh or curl can run, and no real user bus (wave 9 R10d)', () => {
    const home = mkTmp('ccrc-exit-chain-contained-');
    expect(() => assertNoRealTool(chainEnv(home), home)).not.toThrow();
  });
  const run = (home: string, body: string): { code: number; stdout: string; stderr: string } => {
    const r = spawnSync(BASH, ['-c', `set --; source "${join(REPO, 'ccd', 'ccrc')}"; mkdir -p "$HOME/.ccrc"; ${body}`],
      { env: chainEnv(home), encoding: 'utf8', timeout: 30_000 });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  const leftovers = (home: string): string[] =>
    readdirSync(join(home, '.ccrc')).filter((n) => /\.tmp\.\d+$/.test(n));

  itLinux('the chain runs EVERY arm on a SIGTERM (a staging tree and a temp file, neither clobbering the other), runs an entry once however often it is added, and never lets a subshell run its parent\'s arms', () => {
    const home = mkTmp('ccrc-exit-chain-');
    const r = run(home, [
      'stage="$HOME/stage-dir"; mkdir -p "$stage"; : > "$HOME/.ccrc/x.tmp.$$"',
      '_exit_add "rm -rf -- $(printf \'%q\' "$stage")"',
      '_tmp_guard "$HOME/.ccrc/x.tmp.$$"',
      '_exit_add "echo second >> \\"$HOME/ran-second\\""',
      '_exit_add "echo second >> \\"$HOME/ran-second\\""',
      // A subshell adds an arm of its own, and ends: it runs that arm and
      // NOT the parent's, so the parent's staging tree is still here after it.
      '( _exit_add "echo sub >> \\"$HOME/ran-sub\\"" )',
      '[ -d "$stage" ] && echo PARENT-STAGE-SURVIVED-THE-SUBSHELL',
      'kill -TERM $$',
      'echo NOT-REACHED',
    ].join('\n'));
    expect(r.stdout).toContain('PARENT-STAGE-SURVIVED-THE-SUBSHELL');
    expect(r.stdout).not.toContain('NOT-REACHED');
    expect(existsSync(join(home, 'stage-dir')), 'the staging arm did not run').toBe(false);
    expect(leftovers(home), 'the tmp guard did not run').toEqual([]);
    expect(readFileSync(join(home, 'ran-second'), 'utf8'), 'an entry added twice must run once').toBe('second\n');
    expect(readFileSync(join(home, 'ran-sub'), 'utf8')).toBe('sub\n');
  });

  it('`trap - EXIT` (the install prompt\'s stty restore ends with one) does not leave arms added AFTER it unarmed — the next add re-arms the chain', () => {
    const home = mkTmp('ccrc-exit-chain-rearm-');
    const r = run(home, [
      '_exit_add "echo one >> \\"$HOME/ran\\""',
      'trap - EXIT',
      '_exit_add "echo two >> \\"$HOME/ran\\""',
      'exit 0',
    ].join('\n'));
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(join(home, 'ran'), 'utf8')).toBe('one\ntwo\n');
  });

  // The clobber this chain exists to prevent, run through the REAL
  // `_upd_resolve`: a temp file guarded FIRST, then `_upd_resolve` makes its
  // staging tree and arms its own cleanup, then its download fails and it dies.
  // Both must be gone. Were `_upd_resolve`'s arm a plain `trap … EXIT` again,
  // it would REPLACE the chain and the guarded temp file would survive.
  itLinux('`_upd_resolve`\'s staging trap does not clobber a temp-file guard armed before it — both are removed when its download fails and it dies', () => {
    const home = mkTmp('ccrc-exit-chain-resolve-');
    mkdirSync(join(home, 'tmpdir'), { recursive: true });
    const r = run(home, [
      'export TMPDIR="$HOME/tmpdir"',
      'curl() { return 22; }',
      ': > "$HOME/.ccrc/guarded.tmp.$$"',
      '_tmp_guard "$HOME/.ccrc/guarded.tmp.$$"',
      '_upd_resolve v1.0.0',
      'echo NOT-REACHED',
    ].join('\n'));
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/download failed: /);
    expect(r.stdout).not.toContain('NOT-REACHED');
    expect(readdirSync(join(home, 'tmpdir')), 'the staging tree survived the die').toEqual([]);
    expect(leftovers(home), 'the guard armed before _upd_resolve was clobbered').toEqual([]);
  });

  // The four W4 writers, by name. Each step between the creation of the tmp
  // and its rename is replaced by the signal.
  const WRITERS: Array<[string, string, string]> = [
    ['_upd_phase (update.json)', 'chmod() { kill -TERM $$; }; UPD_FROM=cli; UPD_REPORT_STARTED=""; UPD_REPORT_TARGET=""',
      '_upd_phase fetching "the writer under test"'],
    ['_inst_floor (floor)', 'chmod() { kill -TERM $$; }; BOX_BUILD=(a b c d v1.0.0)',
      '_inst_floor'],
    ['_inst_step (install-step)', '_plat_mv_notdir() { kill -TERM $$; }',
      '_inst_step true'],
    ['_upd_write_previous (previous)', '_plat_mv_notdir() { kill -TERM $$; }; UPD_FROM=cli; UPD_VERSION=v2.0.0',
      '_upd_write_previous v1.0.0 aaaaaaaaaaaa'],
  ];
  for (const [name, prelude, call] of WRITERS) {
    itLinux(`${name}: killed between its temp file and its rename, it leaves no <dest>.tmp.$$ (and the same harness with the guard disabled DOES leave one — the control)`, () => {
      const guarded = mkTmp('ccrc-exit-chain-writer-');
      run(guarded, `${prelude}; ${call}`);
      expect(leftovers(guarded), `${name} left its temp file`).toEqual([]);
      const control = mkTmp('ccrc-exit-chain-control-');
      run(control, `_tmp_guard() { :; }; ${prelude}; ${call}`);
      expect(leftovers(control).length, `${name}: the harness could not see a leak`).toBe(1);
    });
  }
});

// ── F2 (review 179, fix round 1 item 2; D-3465): "kept" is a statement about
// the version's BYTES ─────────────────────────────────────────────────────────
// A kept version's record proves an install completed; it says nothing about
// the tree NOW. `deploy.sh` (rsync through the link, then `stamp_build` last),
// a pre-W6 updater run from a kept version, and arm 3's copy after a failed
// record removal all change the bytes without voiding the record. So the kept
// record carries a digest (`.ccrc-digest`, recipe id 1) and `_ver_kept`
// re-measures it for every version it is asked about.
//
// EVERY write-through case below runs from another version, or with a non-cli
// `--from`, or on a box whose stamp disagrees, so the `--from cli` pre-check
// ("already runs … nothing to do") never makes it green for the wrong reason.
describe('"kept" is a statement about the version\'s bytes: a digest in the record, re-measured by _ver_kept (review 179 F2, D-3465)', () => {
  const keptAnswer = verKeptAnswer;
  const HEX = 'f'.repeat(64);
  const WRITTEN_THROUGH = /^rc=3 why=its tree is no longer the one that was kept — something wrote through it since /;

  interface Row {
    what: string;
    plant: (root: string, home: string) => void;
    says: string | RegExp;
    link?: boolean;
  }
  const rows: Row[] = [
    { what: 'a clean version, not pointed at', plant: () => {}, says: 'rc=0 why=' },
    { what: 'a clean version, pointed at', plant: () => {}, says: 'rc=0 why=', link: true },
    { what: 'a file rewritten after the keep', plant: (root) => appendFileSync(join(root, 'ccd', 'ccrc-doctor-checks'), '\n# written through\n'), says: WRITTEN_THROUGH },
    { what: 'the same rewrite on the version ~/ccrc points at (the digest is re-measured for EVERY version)',
      plant: (root) => appendFileSync(join(root, 'ccd', 'ccrc-doctor-checks'), '\n# written through\n'), says: WRITTEN_THROUGH, link: true },
    { what: 'a file added after the keep', plant: (root) => writeFileSync(join(root, 'agent', 'ADDED'), 'x\n'), says: WRITTEN_THROUGH },
    { what: 'a file removed after the keep', plant: (root) => rmSync(join(root, 'deploy', 'gen-wrappers.mjs')), says: WRITTEN_THROUGH },
    { what: 'the executable bit cleared on ccd/ccrc (a mode is part of the bytes: recipe id 1 reads it with [ -x ], never stat)',
      plant: (root) => {
        expect(statSync(join(root, 'ccd', 'ccrc')).mode & 0o111, 'the fixture ccd/ccrc must carry an x bit, or this row is vacuous').not.toBe(0);
        chmodSync(join(root, 'ccd', 'ccrc'), 0o644);
      },
      says: WRITTEN_THROUGH },
    { what: 'the executable bit SET on a plain file',
      plant: (root, home) => {
        writeFileSync(join(root, 'shared', 'plain.txt'), 'plain\n');
        chmodSync(join(root, 'shared', 'plain.txt'), 0o644);
        keepDigest(root, home);
        chmodSync(join(root, 'shared', 'plain.txt'), 0o755);
      },
      says: WRITTEN_THROUGH },
    { what: 'a symlink retargeted (a link contributes its TARGET text, not what it points at)',
      plant: (root, home) => {
        symlinkSync('one', join(root, 'shared', 'lnk'));
        keepDigest(root, home);
        rmSync(join(root, 'shared', 'lnk'));
        symlinkSync('two', join(root, 'shared', 'lnk'));
      },
      says: WRITTEN_THROUGH },
    // The controls for what the digest does NOT cover.
    { what: 'control: node_modules at any depth is not covered (npm ci output is not stable bytes)',
      plant: (root) => {
        mkdirSync(join(root, 'server', 'node_modules', 'pkg'), { recursive: true });
        writeFileSync(join(root, 'server', 'node_modules', 'pkg', 'index.js'), 'x\n');
        mkdirSync(join(root, 'node_modules'), { recursive: true });
        writeFileSync(join(root, 'node_modules', 'top'), 'x\n');
      },
      says: 'rc=0 why=' },
    { what: 'control: a .DS_Store at any depth is not covered',
      plant: (root) => { writeFileSync(join(root, '.DS_Store'), 'x\n'); writeFileSync(join(root, 'deploy', '.DS_Store'), 'x\n'); },
      says: 'rc=0 why=' },
    { what: 'control: a top-level .ccrc-* name (the record files and their temps) is not covered',
      plant: (root) => { writeFileSync(join(root, '.ccrc-installed.tmp.4242'), 'x\n'); writeFileSync(join(root, '.ccrc-other'), 'x\n'); },
      says: 'rc=0 why=' },
    { what: 'control: only the TOP-LEVEL .ccrc-* names are excluded — a nested one is covered',
      plant: (root) => writeFileSync(join(root, 'deploy', '.ccrc-nested'), 'x\n'),
      says: WRITTEN_THROUGH },
    // Not kept, unmeasured: never folded into kept and never into written through.
    { what: 'no digest recorded (a version kept before digests existed)',
      plant: (root) => rmSync(join(root, '.ccrc-digest')),
      says: 'rc=2 why=no kept digest (this version was kept before digests existed, or its keep never finished)' },
    { what: 'a recipe id this ccrc does not know',
      plant: (root) => writeFileSync(join(root, '.ccrc-digest'), `9:${HEX}\n`),
      says: 'rc=2 why=its recorded digest names recipe 9, which this ccrc does not know' },
    { what: 'a digest that does not parse',
      plant: (root) => writeFileSync(join(root, '.ccrc-digest'), 'not a digest\n'),
      says: 'rc=2 why=its kept digest does not parse' },
    { what: 'a name holding a newline cannot be measured (refused, never guessed)',
      plant: (root) => writeFileSync(join(root, 'agent', 'a\nb'), 'x\n'),
      says: 'rc=2 why=its digest could not be measured (a path holds a newline or a backslash in a name)' },
    { what: 'a name holding a backslash cannot be measured either',
      plant: (root) => writeFileSync(join(root, 'agent', 'a\\b'), 'x\n'),
      says: 'rc=2 why=its digest could not be measured (a path holds a newline or a backslash in a name)' },
    // GNU `sha256sum` escapes a carriage return in a name exactly as it does a
    // newline or a backslash (its line then starts with `\`), and the batched read
    // refuses the line — by a different route than the two names above, with the
    // same answer: unmeasured. BSD `shasum` does not escape it, so this row is Linux's.
    ...(process.platform === 'darwin' ? [] : [{ what: 'a name holding a carriage return cannot be measured either (sha256sum escapes it, so the batched read refuses the line — a different route to the same answer)',
      plant: (root: string) => writeFileSync(join(root, 'agent', 'a\rb'), 'x\n'),
      says: 'rc=2 why=its digest could not be measured (a file could not be hashed)' }]),
    { what: 'a fifo cannot be measured',
      plant: (root) => { spawnSync('mkfifo', [join(root, 'agent', 'ff')]); },
      says: 'rc=2 why=its digest could not be measured (an entry that is neither a regular file, a directory nor a link (agent/ff))' },
  ];
  it.each(rows)('_ver_kept: $what', (row) => {
    const home = freshUpdateBox('ccrc-update-ver-digest-');
    const root = installVersionedTree(home, 'v1.0.0', { link: row.link === true, stamp: { sha: V1_SHA, version: 'v1.0.0' } });
    row.plant(root, home);
    const said = keptAnswer(home);
    if (typeof row.says === 'string') expect(said).toBe(row.says);
    else expect(said).toMatch(row.says);
  });

  // A box with no such locale has nothing to compare against: the case is SKIPPED
  // there, visibly, not passed.
  const utf8 = spawnSync('bash', ['-c', 'locale -a | grep -i "^en_US.utf-\\?8$" | head -1'], { encoding: 'utf8' }).stdout.trim();
  (utf8 === '' ? it.skip : it)('the digest is the same under LC_ALL=C and under a UTF-8 locale that collates differently (the sort is byte order, whatever the ambient locale says)', () => {
    // The control must be able to red: under this locale `a` sorts before `B`.
    const order = spawnSync('bash', ['-c', 'printf "B\\na\\n" | LC_ALL="$1" sort | head -1', 'x', utf8], { encoding: 'utf8' }).stdout.trim();
    expect(order, `${utf8} does not collate a before B — this control would be vacuous`).toBe('a');
    const home = freshUpdateBox('ccrc-update-ver-digest-locale-');
    const root = installVersionedTree(home, 'v1.0.0', { link: false, stamp: { sha: V1_SHA, version: 'v1.0.0' } });
    mkdirSync(join(root, 'shared', 'zz', 'a.d'), { recursive: true });
    for (const f of ['B', 'a', 'a-b', 'ab', 'a.b', 'A', 'z z']) writeFileSync(join(root, 'shared', 'zz', f), `${f}\n`);
    writeFileSync(join(root, 'shared', 'zz', 'a.d', 'f'), 'f\n');
    const digestUnder = (loc: string): string => {
      const r = spawnSync(BASH, ['-c', '. "$1"; _ver_digest_of 1 "$2" && printf "%s\\n" "$VER_DIGEST_NOW"', 'x', join(REPO, 'ccd', 'ccrc'), root],
        { env: { ...updateEnv(home), LC_ALL: loc }, encoding: 'utf8' });
      return r.stdout.trim();
    };
    const c = digestUnder('C');
    expect(c).toMatch(/^1:[0-9a-f]{64}$/);
    expect(digestUnder(utf8)).toBe(c);
  });

  // ── the three shapes, and the flips that must not happen ─────────────────
  /** A W6 server box on v2.0.0 with v1.0.0 kept beside it (its spine the
   *  recorder), `previous` naming v1.0.0, and every release-host question
   *  answering 404 — so a rollback that FLIPS (asks nothing) and one that
   *  falls to a re-install (asks the host, and is refused at exit 2) end in
   *  different places. */
  const flipBox = (prefix: string): { home: string; kept: string } => {
    const home = freshUpdateBox(prefix);
    plantW6Box(home, 'v2.0.0', V2_SHA, 'server');
    const kept = keptVersion(home, 'v1.0.0', V1_SHA);
    writeFileSync(join(home, '.ccrc', 'previous'), `v1.0.0\n${V1_SHA}\n`);
    writeFileSync(join(home, 'fixture-release-http'), '404\n');
    return { home, kept };
  };
  const expectNoFlip = (home: string, r: Result): void => {
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: rollback: v1\.0\.0 is not a published release \(its SHA256SUMS answered 404\)/m);
    expect(r.stdout).toContain('rollback: $HOME/ccrc-versions/v1.0.0 was written through since it was kept (its tree is no longer the one that was kept');
    expect(r.stdout).not.toMatch(/is kept at|no release-host question/);
    expect(localUrls(home), 'the release host was not asked').toEqual([`local://${home}/releases/download/v1.0.0/SHA256SUMS`]);
    expect(existsSync(join(home, 'kept-spine-argv')), 'the kept version\'s spine ran — a flip into a written-through tree').toBe(false);
    expect(linkOf(home)).toBe(join(home, 'ccrc-versions', 'v2.0.0'));
  };

  it('deploy.sh\'s failed-build shape — the tree written through, the stamp NOT touched: a bare rollback does not flip into it (it asks the release host as for any tag that is not kept)', () => {
    const { home, kept } = flipBox('ccrc-fx-a-nostamp-');
    appendFileSync(join(kept, 'server', 'dist', 'server', 'src', 'index.js'), '// a working tree, rsynced through the link\n');
    expectNoFlip(home, rollbackRun(home));
  });

  it('_ver_flip_back is a belt of its own: called directly on a written-through kept version it refuses with rc 1 BEFORE the flip, the link, the stamp, the record and the kept spine untouched — every caller that reaches it re-asks the bytes (arm 1 and a rollback by flip)', () => {
    const { home, kept } = flipBox('ccrc-fx-a-flipback-');
    appendFileSync(join(kept, 'server', 'dist', 'server', 'src', 'index.js'), '// written through\n');
    const stamp = fileText(join(home, '.ccrc', 'build.json'));
    const record = fileText(join(home, '.ccrc', 'installed'));
    const r = sourcedCcrc(home,
      `rc=0; _ver_flip_back v1.0.0 server rollback || rc=$?; printf 'rc=%s why=%s\\n' "$rc" "$VER_WHY"`);
    const said = r.stdout.split('\n').find((l) => l.startsWith('rc=')) ?? `no answer: ${r.stderr}`;
    expect(said).toMatch(/^rc=1 why=\$HOME\/ccrc-versions\/v1\.0\.0 was written through since it was kept \(its tree is no longer the one that was kept /);
    expect(linkOf(home)).toBe(join(home, 'ccrc-versions', 'v2.0.0'));
    expect(fileText(join(home, '.ccrc', 'build.json'))).toBe(stamp);
    expect(fileText(join(home, '.ccrc', 'installed'))).toBe(record);
    expect(existsSync(join(home, 'kept-spine-argv')), 'the kept version\'s spine ran').toBe(false);
  });

  it('the pre-W6 updater\'s shape — a kept X received Y\'s bytes (a file replaced, one gone, one added) and the kept copies were never told; the box then moved away from X; `rollback --to X` from a non-cli --from does not flip', () => {
    const { home, kept } = flipBox('ccrc-fx-a-prew6-');
    writeFileSync(join(kept, 'server', 'dist', 'server', 'src', 'index.js'), "// Y's server\n");
    rmSync(join(kept, 'deploy', 'gen-wrappers.mjs'));
    writeFileSync(join(kept, 'shared', 'FROM-Y'), "Y's\n");
    expectNoFlip(home, rollbackRun(home, ['--from', 'watchdog', '--to', 'v1.0.0']));
  });

  it('the restamped shape on the version ~/ccrc points at — deploy.sh reshaped the box stamp and the record is gone — `rollback --to` it does not flip either: the release host is asked', () => {
    const home = freshUpdateBox('ccrc-fx-a-restamp-cheap-');
    const root = plantW6Box(home, 'v1.0.0', V1_SHA, 'server');
    writeFileSync(join(root, 'ccd', 'ccrc'), KEPT_SPINE, { mode: 0o755 });
    keepDigest(root, home);
    writeFileSync(join(root, 'agent', 'MARKER'), 'a working tree X\n');
    writeFileSync(join(home, '.ccrc', 'build.json'), shippedStamp('v9.9.9', '9'.repeat(40)));
    rmSync(join(home, '.ccrc', 'installed'));
    writeFileSync(join(home, 'fixture-release-http'), '404\n');
    const r = rollbackRun(home, ['--to', 'v1.0.0']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(2);
    expect(r.stdout).toContain('rollback: $HOME/ccrc-versions/v1.0.0 was written through since it was kept');
    expect(r.stdout).not.toMatch(/is kept at|no release-host question/);
    expect(localUrls(home)).toEqual([`local://${home}/releases/download/v1.0.0/SHA256SUMS`]);
    expect(existsSync(join(home, 'kept-spine-argv'))).toBe(false);
  });

  it('the report\'s reproduction, end to end: a restamped write-through, then `rollback --to` that version — it is NOT kept, the re-install runs (the release is fetched), the marker is GONE afterwards, and the version is kept again on a fresh digest', () => {
    const home = onKeptV1('ccrc-fx-a-report-');
    const v1 = join(home, 'ccrc-versions', 'v1.0.0');
    expect(keptAnswer(home, 'v1.0.0', ''), 'the control is broken: a real update must leave v1.0.0 kept').toBe('rc=0 why=');
    // deploy.sh's shape: a working tree through the link, the stamp reshaped,
    // and the completed-install record gone.
    writeFileSync(join(v1, 'agent', 'WRITTEN-THROUGH'), 'a working tree X\n');
    writeFileSync(join(home, '.ccrc', 'build.json'), shippedStamp('v9.9.9', '9'.repeat(40)));
    rmSync(join(home, '.ccrc', 'installed'));
    expect(keptAnswer(home, 'v1.0.0', '')).toMatch(WRITTEN_THROUGH);
    const r = rollbackRun(home, ['--to', 'v1.0.0']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toContain('rollback: $HOME/ccrc-versions/v1.0.0 was written through since it was kept');
    expect(r.stdout).not.toMatch(/is kept at|no release-host question/);
    expect(localUrls(home).some((u) => u.endsWith('/download/v1.0.0/ccrc-v1.0.0.tar.gz')), localUrls(home).join('\n')).toBe(true);
    expect(existsSync(join(v1, 'agent', 'WRITTEN-THROUGH')), 'the marker survived: nothing was re-installed').toBe(false);
    expect(keptAnswer(home, 'v1.0.0', '')).toBe('rc=0 why=');
  }, 120_000);

  it('a FULL gate failure whose previous version was written through does not flip back into it: arm 1 names why and arm 2 re-installs it from its release', () => {
    const home = onKeptV1('ccrc-fx-a-arm1-');
    const v1 = join(home, 'ccrc-versions', 'v1.0.0');
    // The running version, written through with no restamp (deploy.sh's failed build).
    writeFileSync(join(v1, 'agent', 'WRITTEN-THROUGH'), 'a working tree X\n');
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: V2_SHA }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-health-deny'), 'v2.0.0\n');
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout).toContain('update: arm 1: $HOME/ccrc-versions/v1.0.0 was written through since it was kept (its tree is no longer the one that was kept');
    expect(r.stdout).not.toMatch(/flipping back to it|REVERTED \(arm 1\)/);
    expect(r.stdout).toMatch(/^update: arm 2: re-installing v1\.0\.0 /m);
    expect(existsSync(join(v1, 'agent', 'WRITTEN-THROUGH')), 'arm 2 did not re-install over the written-through tree').toBe(false);
  }, 120_000);

  // ── the listing says it; GC's verdicts are exactly today's ───────────────
  it('`ccrc versions` says `written-through` for a version whose tree is not the one that was kept — and the verdicts, the count and what --prune removes are exactly what they are for the same box with that version clean', () => {
    const NAMES = ['v1.0.4', 'v1.0.3', 'v1.0.2', 'v1.0.1', 'v1.0.0'];
    const box = (prefix: string, through: string[]): string => {
      const home = freshUpdateBox(prefix);
      NAMES.forEach((n, i) => {
        const root = installVersionedTree(home, n, { link: i === 0, stamp: { sha: 'b'.repeat(40), version: n } });
        const t = 1_800_000_000 - i * 100;
        utimesSync(join(root, '.ccrc-installed'), t, t);
        if (through.includes(n)) writeFileSync(join(root, 'agent', 'WRITTEN-THROUGH'), 'x\n');
      });
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      writeFileSync(join(home, '.ccrc', 'build.json'), shippedStamp('v1.0.4', 'b'.repeat(40)));
      writeFileSync(join(home, 'fixture-unit-state'), 'inactive\n');
      return home;
    };
    const versions = (home: string, args: string[] = []): Result => {
      const env = { ...updateEnv(home), CCRC_VERSIONS_KEEP: '2' };
      replantDoctorStubs(home);
      const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'versions', ...args], { env, encoding: 'utf8' });
      return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    };
    const clean = box('ccrc-fx-a-gc-clean-', []);
    const dirty = box('ccrc-fx-a-gc-dirty-', ['v1.0.3', 'v1.0.2', 'v1.0.0']);
    const cl = versions(clean);
    const dl = versions(dirty);
    expect(dl.code).toBe(cl.code);
    expect(dl.stdout).toMatch(/^ {4}v1\.0\.3 {2}written-through {2}kept: newest 2$/m);
    expect(dl.stdout).toMatch(/^ {4}v1\.0\.2 {2}written-through {2}kept: newest 2$/m);
    expect(dl.stdout).toMatch(/^ {4}v1\.0\.0 {2}written-through {2}prunable$/m);
    expect(dl.stdout).toMatch(/^ {2}\* v1\.0\.4 {2}complete {2}kept: pointed-at$/m);
    // The new word never feeds a verdict: replace it, and the two listings are the same bytes.
    expect(dl.stdout.replace(/written-through/g, 'complete')).toBe(cl.stdout);
    const cp = versions(clean, ['--prune']);
    const dp = versions(dirty, ['--prune']);
    expect(dp.code).toBe(cp.code);
    expect(dp.stdout.replace(/written-through/g, 'complete')).toBe(cp.stdout);
    expect(readdirSync(join(dirty, 'ccrc-versions')).sort()).toEqual(readdirSync(join(clean, 'ccrc-versions')).sort());
  }, 120_000);
});

// ── M1 (review 179 fix round 1): the listing's third word ─────────────────────
describe('`ccrc versions` says `unmeasured` for a version kept before digests existed — not `complete` (review 179 M1, D-3465 (d))', () => {
  it('a version with a record and no digest lists `unmeasured`; the verdicts, the count and what --prune removes are exactly what they are for the same box with that version clean', () => {
    const NAMES = ['v1.0.4', 'v1.0.3', 'v1.0.2', 'v1.0.1', 'v1.0.0'];
    const box = (prefix: string, predigest: string[]): string => {
      const home = freshUpdateBox(prefix);
      NAMES.forEach((n, i) => {
        const root = installVersionedTree(home, n, { link: i === 0, digest: !predigest.includes(n), stamp: { sha: 'b'.repeat(40), version: n } });
        const t = 1_800_000_000 - i * 100;
        utimesSync(join(root, '.ccrc-installed'), t, t);
      });
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      writeFileSync(join(home, '.ccrc', 'build.json'), shippedStamp('v1.0.4', 'b'.repeat(40)));
      writeFileSync(join(home, 'fixture-unit-state'), 'inactive\n');
      return home;
    };
    const versions = (home: string, args: string[] = []): Result => {
      const env = { ...updateEnv(home), CCRC_VERSIONS_KEEP: '2' };
      replantDoctorStubs(home);
      const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'versions', ...args], { env, encoding: 'utf8' });
      return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    };
    const clean = box('ccrc-fix1-m1-clean-', []);
    const pre = box('ccrc-fix1-m1-predigest-', ['v1.0.3', 'v1.0.0']);
    const cl = versions(clean);
    const pl = versions(pre);
    expect(pl.code).toBe(cl.code);
    expect(pl.stdout).toMatch(/^ {4}v1\.0\.3 {2}unmeasured {2}kept: newest 2$/m);
    expect(pl.stdout).toMatch(/^ {4}v1\.0\.0 {2}unmeasured {2}prunable$/m);
    expect(pl.stdout).toMatch(/^ {4}v1\.0\.2 {2}complete {2}kept: newest 2$/m);
    // The word never feeds a verdict: replace it, and the two listings are the same bytes.
    expect(pl.stdout.replace(/unmeasured/g, 'complete')).toBe(cl.stdout);
    const cp = versions(clean, ['--prune']);
    const pp = versions(pre, ['--prune']);
    expect(pp.code).toBe(cp.code);
    expect(pp.stdout.replace(/unmeasured/g, 'complete')).toBe(cp.stdout);
    expect(readdirSync(join(pre, 'ccrc-versions')).sort()).toEqual(readdirSync(join(clean, 'ccrc-versions')).sort());
  }, 120_000);
});

// R20a (centralised-update wave 13): each test's fixture homes go in a root `afterEach`, not all at once in the
// file's `afterAll`. Measured at 9221416a: the three parts of this file leave 648 homes, about 99,700 entries and
// 2.47 GB to that one hook, which overran vitest's 20 s hook timeout on CI shards at 670d25fd and 7b0a5454. It sits
// at the END of the file so no line above moves: a top-level hook registers on the root suite wherever it is
// written, because vitest collects the whole file before it runs a test.
removeTmpFixturesEachTest();

