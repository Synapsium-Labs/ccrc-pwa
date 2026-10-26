// Part of the `ccrc update` suite, split by describe block from the former single file (D-6767).
// The shared box, tarball and runner fixtures live in `ccrc-updateFixture.ts`; this file holds only
// the cases of its own describe blocks, with their titles and bodies unchanged. Its siblings are
// `ccrc-update-*.test.ts`.

import { describe, it, expect, afterEach } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync, lstatSync, chmodSync, readdirSync, appendFileSync, rmSync, symlinkSync, readlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { ccrcContainedEnv } from './ccrcContainment.js';
import { assertNoRealTool } from './containedTools.js';
import { itLinux, itDarwin, platformContrast } from './platformFixtures.js';
import { installVersionedTree } from './installTreeFixture.js';
import { assertSpineFrontContained } from './codexLaneFixture.js';
import { IN_FLIGHT_UPDATE_PHASES, UPDATE_PHASES } from '../../shared/api.js';
// Fix round 1 item 3 / review 155 C31: W2's OWN reader (never a hand copy),
// the same import pattern `update-intent-cross-side.test.ts` already uses.
import { reportFrom, type NodeFileRead } from '../src/update/inventory.js';
import {
  REPO,
  realPath,
  BASH,
  FLOCK,
  type Result,
  UPD_DEADLINE_BIN,
  runBounded,
  allowCurlPort,
  curlFrontPassed,
  updateEnv,
  replantDoctorStubs,
  plantOldBox,
  plantCoordDb,
  writeManifest,
  plantCollectJournal,
  expectJournalUntouched,
  journalCopiesUnder,
  LEAVE_JOURNAL_LINE,
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
  curlFullArgv,
  checkLine,
  CAPS_NOW,
  parseCheck,
  announcedBackupDir,
  sourcedCcrc,
  OLD_SHA,
  RESTORE_RECORDER,
  plantRestoreBox,
  restoreChildArgv,
  pathWithoutJq,
  pathWithoutFlock,
  pathWithoutCurl,
  reportWrites,
  lastReport,
  REPORT_KEYS,
  REPORT_TIME,
  REAL_DATE,
  INTENT_NOW,
  intentDoc,
  intentPath,
  plantIntent,
  plantRole,
  plantSyncTimer,
  plantClock,
  runChannel,
  managedFleetBox,
  PULLER_REMEDY,
  SERVER_REMEDY,
  esc,
  V2_SHA,
  fileText,
  onKeptV1,
} from './ccrc-updateFixture.js';

describe('ccrc update: the floor, on every path (design §9, decision 8)', () => {
  const plantFloor = (home: string, v: string): void => {
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'floor'), `${v}\n`);
  };

  it('latest/download naming a version below the floor is refused before any backup, with NO --to on the argv (§18 "the floor is checked on every path")', () => {
    const home = freshUpdateBox('ccrc-update-floor-latest-');
    plantOldBox(home, { version: 'v3.0.0' });
    plantFloor(home, 'v3.0.0');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/v2\.0\.0 \(resolved by latest\/download\) is below this box's floor v3\.0\.0/);
    expect(r.stderr).toMatch(/ccrc update --to v2\.0\.0 --downgrade/);
    // Review fix round 1 I5 (narrowing item 17 / review 155 C28): the
    // target's VERSION (v2.0.0) differs from the running stamp's (v3.0.0),
    // so `_upd_converged`'s first comparison already answers "not
    // converged" without ever needing the staged sha — the floor is
    // checked BEFORE the fetch here, exactly as before item 17, and the
    // refusal costs only the resolve-time SHA256SUMS read.
    expect(localUrls(home)).toEqual([`local://${home}/releases/latest/download/SHA256SUMS`]);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
    // The measured phases: resolving, then straight to failed — never
    // fetching/verifying, which a full fetch would have added.
    expect(reportWrites(home).map((w) => w['phase'])).toEqual(['resolving', 'failed']);
  });

  // W6 Task 8A (the floor's refusal after a restore; C28's root). The floor
  // is raised inside the staged spine, before the health gate, and a restore
  // never lowers it (spec §9 stands) — so a failed update that restored
  // leaves the floor above the running release. The refusal a later move
  // meets names the last update (to the floor's tag, its gate failed and it was restored), read from the last run's report,
  // and names the floor alone when that report does not say so.
  const REVERTED_REPORT = (target: string): string =>
    `{"target":"${target}","phase":"reverted","startedAt":1,"updatedAt":2,"detail":"arm1: flipped back to v1.0.0; gate: fixture","from":"cli","pid":1}\n`;
  const RAISED_BY = (floor: string): string =>
    ` — the last update, to ${floor}, failed its health gate and was restored`;

  // The shape a tail about the running release gets wrong: the update to the
  // floor's OWN tag failed its gate and was restored onto that same tag (a
  // `--force` reinstall of the floor's tag, arm 3 or arm 1 back to it), so
  // the box runs the floor's tag — not a release below it. The clause is the
  // ruled sentence exactly, and nothing more.
  it('a same-tag restore (the box runs the floor\'s own tag): the clause names the restored update and claims nothing about where the box runs', () => {
    const home = freshUpdateBox('ccrc-update-floor-same-tag-restore-');
    plantOldBox(home, { version: 'v3.0.0' });
    plantFloor(home, 'v3.0.0');
    writeFileSync(join(home, '.ccrc', 'update.json'),
      REVERTED_REPORT('v3.0.0').replace('arm1: flipped back to v1.0.0', 'arm3: restored v3.0.0 (same build, not mixed)'));
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--to', 'v2.0.0']);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain(`${RAISED_BY('v3.0.0')} — moving down is a typed act: ccrc update --to v2.0.0 --downgrade`);
    expect(r.stderr).toContain('the last update, to v3.0.0, failed its health gate and was restored — moving down');
    expect(r.stderr).not.toContain('the floor stands above');
    expect(r.stderr).not.toContain('above the release this box runs');
  });

  it('END TO END: a real update whose gate failed and restored leaves the floor above the running release, and the next move below it is refused naming the last update, restored after its gate failed (C28\'s root)', () => {
    const home = onKeptV1('ccrc-update-floor-restored-');
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: V2_SHA }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-health-deny'), 'v2.0.0\n');
    const up = runUpdate(home);
    expect(up.code, `stderr: ${up.stderr}\nstdout: ${up.stdout}`).toBe(4);
    expect(fileText(join(home, '.ccrc', 'floor'))).toBe('v2.0.0\n');
    expect(lastReport(home)).toMatchObject({ phase: 'reverted', target: 'v2.0.0' });
    // v1.0.0 is what runs, and it is below the floor: a forced reinstall
    // is a move down, and the refusal says why the floor stands where it does.
    const r = runUpdate(home, ['--to', 'v1.0.0', '--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toContain(`v1.0.0 (resolved by --to v1.0.0) is below this box's floor v2.0.0 (`);
    expect(r.stderr).toContain(`${RAISED_BY('v2.0.0')} — moving down is a typed act: ccrc update --to v1.0.0 --downgrade. Nothing on this box was changed`);
  }, 60_000);

  it.each([
    ['a report that says the update to the floor tag was restored', REVERTED_REPORT('v3.0.0'), true],
    ['a restored update to some OTHER tag', REVERTED_REPORT('v2.5.0'), false],
    ['a report of a COMPLETED update to the floor tag', REVERTED_REPORT('v3.0.0').replace('"reverted"', '"done"'), false],
    ['an absent report', null, false],
    ['a report that is not JSON', 'reverted v3.0.0\n', false],
    ['a report whose target is not a tag', REVERTED_REPORT('v3.0.0').replace('"v3.0.0"', '"v3.0.0; rm -rf"'), false],
  ] as const)('the floor\'s refusal names the restored update only when the last report says so — %s (floor-only otherwise, exactly as before)', (_what, report, named) => {
    const home = freshUpdateBox('ccrc-update-floor-named-');
    plantOldBox(home, { version: 'v3.0.0' });
    plantFloor(home, 'v3.0.0');
    if (report !== null) writeFileSync(join(home, '.ccrc', 'update.json'), report);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--to', 'v2.0.0']);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toMatch(/v2\.0\.0 \(resolved by --to v2\.0\.0\) is below this box's floor v3\.0\.0 \(\S+: the highest version this box completed an install of\)/);
    if (named) {
      expect(r.stderr).toContain(`${RAISED_BY('v3.0.0')} — moving down is a typed act: ccrc update --to v2.0.0 --downgrade`);
      expect(r.stderr, 'the clause claims nothing about where the box runs').not.toContain('the floor stands above');
    } else {
      expect(r.stderr).not.toContain('failed its health gate and was restored');
      expect(r.stderr).toMatch(/the highest version this box completed an install of\) — moving down is a typed act: ccrc update --to v2\.0\.0 --downgrade\. Nothing on this box was changed/);
    }
  });

  it('a report reached through a SYMLINK is unsafe to read and names nothing: the refusal is the floor alone (the one shared guard)', () => {
    const home = freshUpdateBox('ccrc-update-floor-named-link-');
    plantOldBox(home, { version: 'v3.0.0' });
    plantFloor(home, 'v3.0.0');
    writeFileSync(join(home, 'elsewhere.json'), REVERTED_REPORT('v3.0.0'));
    symlinkSync(join(home, 'elsewhere.json'), join(home, '.ccrc', 'update.json'));
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--to', 'v2.0.0']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('is below this box\'s floor v3.0.0');
    expect(r.stderr).not.toContain('failed its health gate and was restored');
  });

  it('--to below the floor is refused the same way, naming --to', () => {
    const home = freshUpdateBox('ccrc-update-floor-to-');
    plantOldBox(home, { version: 'v3.0.0' });
    plantFloor(home, 'v3.0.0');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--to', 'v2.0.0']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/v2\.0\.0 \(resolved by --to v2\.0\.0\) is below this box's floor v3\.0\.0/);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
  });

  // W1 minor M7: `--force` is never a way below the floor
  // (§18 "the floor is checked on every path"). Fix round 1 item 17 /
  // review 155 C28 REORDERED the converged no-op ahead of the floor check
  // (a converged no-op moves nothing, so the floor has nothing to guard) —
  // but `--force` disables the converged no-op itself (`[ "$force" -eq 0 ]
  // && _upd_converged`), so a forced install always reaches the floor check
  // regardless of the reorder, and still refuses before any backup or
  // staged spine.
  it('--force cannot take a box below its floor, by --to or by latest/download: W1\'s refusal, no backup, nothing staged (M7)', () => {
    const home = freshUpdateBox('ccrc-update-floor-force-');
    plantOldBox(home, { version: 'v3.0.0' });
    plantFloor(home, 'v3.0.0');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    let r = runUpdate(home, ['--to', 'v2.0.0', '--force']);
    expect(r.code, `stdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toMatch(/v2\.0\.0 \(resolved by --to v2\.0\.0\) is below this box's floor v3\.0\.0 .* moving down is a typed act: ccrc update --to v2\.0\.0 --downgrade/);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
    const latest = freshUpdateBox('ccrc-update-floor-force-latest-');
    plantOldBox(latest, { version: 'v3.0.0' });
    plantFloor(latest, 'v3.0.0');
    packRelease(latest, stubTree(latest, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    r = runUpdate(latest, ['--force']);
    expect(r.code, `stdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toMatch(/v2\.0\.0 \(resolved by latest\/download\) is below this box's floor v3\.0\.0/);
    expect(existsSync(join(latest, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(latest, 'staged-ccrc-argv'))).toBe(false);
    expect(readFileSync(join(latest, '.ccrc', 'floor'), 'utf8')).toBe('v3.0.0\n');
  });

  it('--downgrade proceeds, warns, and the floor is NOT lowered (§18 "--downgrade is the only way below the floor")', () => {
    const home = freshUpdateBox('ccrc-update-floor-downgrade-');
    plantOldBox(home, { version: 'v3.0.0' });
    plantFloor(home, 'v3.0.0');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--to', 'v2.0.0', '--downgrade']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^update: WARN: v2\.0\.0 is below this box's floor v3\.0\.0 .* --downgrade was typed; the floor stays v3\.0\.0/m);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(true);
    expect(readFileSync(join(home, '.ccrc', 'floor'), 'utf8')).toBe('v3.0.0\n');
  });

  it('at or above the floor proceeds without a word; no floor file is unconstrained', () => {
    const home = freshUpdateBox('ccrc-update-floor-ok-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantFloor(home, 'v1.0.0');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    let r = runUpdate(home);
    expect(r.code, r.stderr).toBe(0);
    // Not a bare /floor/ scan: the fixture HOME's own path is
    // `.../ccrc-update-floor-ok-<rand>/...` and appears in the ordinary
    // "update: fetching …" lines, so that substring is always present and
    // proves nothing. What must be ABSENT is the floor check's own voice —
    // the WARN or refusal phrasing `_upd_floor_check` uses when it has
    // something to say.
    expect(r.stdout).not.toMatch(/is below this box's floor|floor is malformed/);
    const bare = freshUpdateBox('ccrc-update-floor-none-');
    plantOldBox(bare, { version: 'v3.0.0' });
    packRelease(bare, stubTree(bare, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    r = runUpdate(bare);
    expect(r.code, r.stderr).toBe(0);
  });

  it('a malformed floor file refuses and names the file — never read as "no floor"', () => {
    const home = freshUpdateBox('ccrc-update-floor-bad-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantFloor(home, 'three');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    // Fix round 1 item 11 / review 155 C17: the verdict now leads the
    // sentence (D-3249), the path follows.
    expect(r.stderr).toMatch(/malformed floor \(got: 'three'\)/);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
  });

  // Task 11 Important (no D): the converged-box steady state — a box AT its
  // own floor, updating to that SAME version — rests entirely on
  // `_ver_newer`'s strict `>` and nothing pinned it. floor == target must
  // proceed silently, not warn as though it were below.
  it('the floor equal to the target proceeds without a word — not "below" (Task 11 Important)', () => {
    const home = freshUpdateBox('ccrc-update-floor-equal-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantFloor(home, 'v2.0.0');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).not.toMatch(/is below this box's floor/);
  });

  // Task 11 minor (no D): an UNREADABLE floor (the `read` itself fails) is a
  // different condition from a malformed one and must not collapse into it
  // (the overloaded-null-at-a-seam ban this file's own conventions apply
  // elsewhere). Root bypasses permission bits, so this is not measurable
  // running as root — skipped there, and said so.
  it.skipIf(process.getuid?.() === 0)('an unreadable floor file (permissions) dies with its own sentence, distinct from "malformed"', () => {
    const home = freshUpdateBox('ccrc-update-floor-unreadable-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantFloor(home, 'v3.0.0');
    chmodSync(join(home, '.ccrc', 'floor'), 0o000);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    // Fix round 1 item 11 / review 155 C17: the verdict now leads the
    // sentence (D-3249), the path follows.
    expect(r.stderr).toMatch(/unreadable: .*\.ccrc\/floor — fix its permissions by hand/);
    expect(r.stderr).not.toMatch(/malformed/);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
  });

  // M3 (W1 minor; plan D-3233). This case used to pin that
  // --check never READ the floor — which is exactly why rollout's preflight
  // could not see one. It reads it now, and still never refuses on it.
  it('--check reads the floor and never refuses on it: a target below it answers state=below-floor, exit 1, nothing written (M3)', () => {
    const home = freshUpdateBox('ccrc-update-floor-check-');
    plantOldBox(home, { version: 'v3.0.0' });
    plantFloor(home, 'v3.0.0');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--check', '--to', 'v2.0.0']);
    expect(r.code).toBe(1);
    expect(checkLine(r.stdout)).toBe(
      `check: box=v3.0.0 sha=oldsha0000000000000000000000000000000000 target=v2.0.0 caps=${CAPS_NOW} floor=v3.0.0 projection=not-configured state=below-floor`);
    expect(r.stdout).toMatch(/^this box: v3\.0\.0 \(oldsha[0-9a-f]*\) · target: v2\.0\.0 — below this box's floor v3\.0\.0; update refuses it without --downgrade$/m);
    // A measurement: the refusal's own voice is absent, nothing fetched past
    // SHA256SUMS, nothing backed up, the floor untouched. Fix round 1 item
    // 11 reordered the two die sentences (verdict leads); the negative
    // check follows the new wording.
    expect(r.stderr).not.toMatch(/is below this box's floor|malformed floor|unreadable: .*floor/);
    expect(localUrls(home)).toEqual([`local://${home}/releases/download/v2.0.0/SHA256SUMS`]);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(readFileSync(join(home, '.ccrc', 'floor'), 'utf8')).toBe('v3.0.0\n');
  });

  it('below-floor is strict and covers every non-current state: floor == target reads behind; an unversioned box below the floor reads below-floor; a box already current stays current (M3)', () => {
    const equal = freshUpdateBox('ccrc-update-floor-check-equal-');
    plantOldBox(equal, { version: 'v1.0.0' });
    plantFloor(equal, 'v2.0.0');
    packRelease(equal, stubTree(equal, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    expect(parseCheck(runUpdate(equal, ['--check', '--to', 'v2.0.0']).stdout).state).toBe('behind');

    const unversioned = freshUpdateBox('ccrc-update-floor-check-unversioned-');
    plantOldBox(unversioned);
    plantFloor(unversioned, 'v3.0.0');
    packRelease(unversioned, stubTree(unversioned, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    expect(parseCheck(runUpdate(unversioned, ['--check', '--to', 'v2.0.0']).stdout)).toMatchObject({ box: 'unversioned', state: 'below-floor' });

    const current = freshUpdateBox('ccrc-update-floor-check-current-');
    plantOldBox(current, { version: 'v2.0.0' });
    writeFileSync(join(current, '.ccrc', 'installed'), 'oldsha0000000000000000000000000000000000\n');
    plantFloor(current, 'v3.0.0');
    packRelease(current, stubTree(current, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(current, ['--check', '--to', 'v2.0.0']);
    expect(r.code, r.stderr).toBe(0);
    expect(parseCheck(r.stdout)).toMatchObject({ floor: 'v3.0.0', state: 'current' });
  });

  // Fix round 1 item 17 / review 155 C28 (your Q2): a converged no-op moves
  // nothing, so the floor has nothing to guard — `cmd_update`'s converged
  // no-op check now precedes its floor check. The review's own fixture: a
  // box on v1.0.0 with a completed record (an automatic arm-2 restore's
  // aftermath, say — the failed v2.0.0 install had already raised the floor
  // before it was backed out), floor v2.0.0, target resolving to v1.0.0. A
  // plain `ccrc update` must read this as "nothing to do", not `failed`; the
  // floor itself is never lowered by a no-op (D-3136's own principle: the
  // floor only rises).
  it('a converged box below its own raised floor is still a no-op, exit 0, never `failed` (fix round 1 item 17 / review 155 C28, your Q2)', () => {
    const home = freshUpdateBox('ccrc-update-floor-converged-');
    plantOldBox(home, { version: 'v1.0.0' });
    writeFileSync(join(home, '.ccrc', 'installed'), `${OLD_SHA}\n`);
    plantFloor(home, 'v2.0.0');
    // selfConvergedTree: the staged tree's OWN sha is made to match the
    // box's running stamp — `_upd_converged`'s real (three-way) comparison,
    // which this run must actually satisfy now that it runs BEFORE the
    // floor, not a shortcut that skips the fetch.
    packRelease(home, selfConvergedTree(home, 'v1.0.0', OLD_SHA), { tag: 'v1.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^update: this box already runs v1\.0\.0 \(\S+\) and that install completed — nothing to do \(pass --force to reinstall\)$/m);
    expect(r.stdout).not.toMatch(/is below this box's floor/);
    expect(r.stderr).toBe('');
    const rep = JSON.parse(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')) as Record<string, unknown>;
    expect(rep['phase']).toBe('done');
    expect(rep['detail']).toBe('already converged at v1.0.0');
    // The floor is never lowered by a no-op — D-3136's own principle,
    // restated by this task's ruling ("do not change when the floor is
    // raised").
    expect(readFileSync(join(home, '.ccrc', 'floor'), 'utf8')).toBe('v2.0.0\n');
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
  });
});

describe('ccrc update: update.json at every phase, and --from (design §10)', () => {
  // W2's L0 array, not a hand copy of spec §6 (W4a Task 15): the phases this
  // writer must produce are the ones the console's reader knows, by
  // construction. `unknown` is the READER's word for a report it cannot
  // parse; no writer ever writes it.
  const WRITTEN_PHASES = UPDATE_PHASES.filter((p) => p !== 'unknown');
  // `queued` is written only by `--detach`, which macOS refuses (decision 17),
  // so on Darwin it can never be written. Kept apart from PENDING because Task 6
  // deletes PENDING, and this set must outlive it.
  const DARWIN_UNREACHABLE = new Set<string>(process.platform === 'darwin' ? ['queued'] : []);
  const phases = (home: string): string[] => reportWrites(home).map((w) => String(w['phase']));
  const plantFloor = (home: string, v: string): void => {
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'floor'), `${v}\n`);
  };

  it('a moving run, a converged no-op and a refusal together write every wired phase, each by rename, seven keys in order and an eighth, `sweep`, after the sweep (§18 "update.json at every phase"; wave 17, D-5314)', () => {
    // 1. A run that moves the box (STUB flavour: update's own logic).
    const moved = freshUpdateBox('ccrc-update-json-moved-');
    plantOldBox(moved, { version: 'v1.0.0' });
    packRelease(moved, stubTree(moved, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    let r = runUpdate(moved);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    // W4 Task 5: the gate writes `checking` BEFORE the sweep's `restarting`
    // (design §11 — the gate precedes the sweep; nothing reads the order). Wave 23 (D-6356): a second `restarting`, the
    // re-stamp right before the prune and thinning take the lock again, so the deadline measures from it.
    expect(phases(moved)).toEqual(['resolving', 'fetching', 'verifying', 'backing-up', 'installing', 'checking', 'restarting', 'restarting', 'done']);
    expect(reportWrites(moved).map((w) => w['detail']).slice(-2, -1)).toEqual(['pruning and thinning ~/ccrc-backups']);
    // The stub box answers no KillMode, so its sweep is REFUSED, and the update's own `done` records that (R10k, D-5315):
    // exit 0, `detail` null, the word in `sweep`. On Darwin the arm reads job files instead, so only its presence is pinned.
    const movedSweep = lastReport(moved)['sweep'];
    if (process.platform === 'darwin') expect(typeof movedSweep, 'the sweep is recorded on the write after it (wave 17, D-5314)').toBe('string');
    else expect(movedSweep, 'the sweep is recorded on the write after it (wave 17, D-5314)').toBe('refused: killmode');
    expect(lastReport(moved)['detail']).toBeNull();

    // 2. The converged no-op (the "already there" gate's three shas agree).
    const same = freshUpdateBox('ccrc-update-json-same-');
    plantOldBox(same, { version: 'v2.0.0' });
    writeFileSync(join(same, '.ccrc', 'build.json'),
      shippedStamp('v2.0.0', 'newsha0000000000000000000000000000000000'));
    writeFileSync(join(same, '.ccrc', 'installed'), 'newsha0000000000000000000000000000000000\n');
    packRelease(same, stubTree(same, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    r = runUpdate(same);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(phases(same)).toEqual(['resolving', 'fetching', 'verifying', 'done']);
    expect(lastReport(same)['detail']).toBe('already converged at v2.0.0');
    expect(Object.keys(lastReport(same)), 'a converged no-op never swept, so it never records one').not.toContain('sweep');

    // 3. A refusal after the lock: a die is a `failed` report.
    const refused = freshUpdateBox('ccrc-update-json-refused-');
    plantOldBox(refused, { version: 'v1.0.0' });
    packRelease(refused, stubTree(refused, { version: 'v2.0.0' }), { tag: 'v2.0.0', bundle: false });
    r = runUpdate(refused);
    expect(r.code).toBe(1);
    expect(phases(refused)).toEqual(['resolving', 'fetching', 'verifying', 'failed']);

    // 4. A detached parent (W4 Task 3): `queued`, written before the spawn and
    //    nothing after it. The recorder stands in for systemd-run.
    const detached = freshUpdateBox('ccrc-update-json-detached-');
    plantOldBox(detached, { version: 'v1.0.0' });
    r = runUpdate(detached, ['--detach', '--to', 'v2.0.0']);
    if (process.platform === 'darwin') {
      expect(r.code).toBe(1);
      expect(phases(detached)).toEqual([]);
    } else {
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(phases(detached)).toEqual(['queued']);
    }

    // Task 6: the automatic restore writes the last two phases, `restoring`
    // and `reverted` (a gate that fails on the OLD /health version, arm 2).
    const restoreHome = freshUpdateBox('ccrc-update-json-restore-');
    plantRestoreBox(restoreHome);
    r = runUpdate(restoreHome);
    expect(r.code, `the restore fixture must reach _upd_restore — stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);

    const written = new Set([...phases(moved), ...phases(same), ...phases(refused), ...phases(detached), ...phases(restoreHome)]);
    expect(written.has('unknown'), 'a writer wrote the reader\'s word').toBe(false);
    expect([...new Set([...written, ...DARWIN_UNREACHABLE])].sort()).toEqual([...WRITTEN_PHASES].sort());

    for (const home of [moved, same, refused, restoreHome, ...(process.platform === 'darwin' ? [] : [detached])]) {
      const raw = readFileSync(join(home, 'update-json-writes'), 'utf8').split('\n').filter((l) => l !== '');
      // Wave 17 (D-5314): every write before the sweep keeps the seven keys; the writes after the sweep carry the eighth,
      // after them: the re-stamp before the prune and thinning (wave 23, D-6356) and the update's own `done`. The converged
      // no-op, the refusal and the restore never sweep, so they keep seven.
      const swept = home === moved;
      raw.forEach((l, i) => {
        const w = JSON.parse(l) as { phase: string };
        expect(Object.keys(w), `${home}: the ${w.phase} write`)
          .toEqual(swept && i >= raw.length - 2 ? [...REPORT_KEYS, 'sweep'] : REPORT_KEYS);
      });
      if (swept) expect(raw.filter((l) => l.includes('"sweep"')), 'only the writes after the sweep carry it').toHaveLength(2);
      // The file on disk IS the last rename, and no staged copy is left beside it.
      expect(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')).toBe(`${raw[raw.length - 1]}\n`);
      expect(readdirSync(join(home, '.ccrc')).filter((f) => f.startsWith('update.json.'))).toEqual([]);
    }
  });

  it('the report names the target once resolved, carries ONE startedAt and a non-decreasing updatedAt in unix seconds, `from` cli by default, and the run\'s pid', () => {
    const home = freshUpdateBox('ccrc-update-json-fields-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    // The test's own clock around the spawn, in seconds: the report's times
    // are THIS instant in THIS unit, not merely ten digits.
    const t0 = Math.floor(Date.now() / 1000);
    const r = runUpdate(home);
    const t1 = Math.ceil(Date.now() / 1000);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const w = reportWrites(home);
    // W4 Task 5: the gate's `checking` is the eighth report; the order and
    // the count are pinned together, so neither can drift alone. Wave 23 (D-6356) adds the second `restarting`, the
    // re-stamp before the prune and thinning.
    expect(w.map((x) => x['phase'])).toEqual(['resolving', 'fetching', 'verifying', 'backing-up', 'installing', 'checking', 'restarting', 'restarting', 'done']);
    // latest/download: nothing names a tag until SHA256SUMS has been read.
    expect(w[0]!['phase']).toBe('resolving');
    expect(w[0]!['target']).toBeNull();
    for (const x of w.slice(1)) expect(x['target']).toBe('v2.0.0');
    expect(new Set(w.map((x) => x['startedAt'])).size).toBe(1);
    expect(new Set(w.map((x) => x['pid'])).size).toBe(1);
    let prev = 0;
    for (const x of w) {
      expect(String(x['startedAt'])).toMatch(REPORT_TIME);
      expect(String(x['updatedAt'])).toMatch(REPORT_TIME);
      expect(Number(x['startedAt'])).toBeGreaterThanOrEqual(t0);
      expect(Number(x['updatedAt'])).toBeLessThanOrEqual(t1);
      expect(Number(x['updatedAt'])).toBeGreaterThanOrEqual(Math.max(prev, Number(x['startedAt'])));
      prev = Number(x['updatedAt']);
      expect(x['from']).toBe('cli');
      expect(Number.isInteger(x['pid'])).toBe(true);
      // No phase of a clean run carries one, except the re-stamp before the prune and thinning (wave 23, D-6356): the
      // second `restarting`, the write before `done`.
      expect(x['detail']).toBe(x === w[w.length - 2] ? 'pruning and thinning ~/ccrc-backups' : null);
    }
  });

  it('--from <word> and --from=<word> reach `from`; --to names the target from the first phase on', () => {
    const home = freshUpdateBox('ccrc-update-json-from-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    let r = runUpdate(home, ['--to', 'v2.0.0', '--from', 'pwa']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    let w = reportWrites(home);
    expect(w.length).toBeGreaterThan(0);
    for (const x of w) { expect(x['from']).toBe('pwa'); expect(x['target']).toBe('v2.0.0'); }
    const eq = freshUpdateBox('ccrc-update-json-from-eq-');
    plantOldBox(eq, { version: 'v1.0.0' });
    packRelease(eq, stubTree(eq, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    r = runUpdate(eq, ['--from=rollout']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    w = reportWrites(eq);
    for (const x of w) expect(x['from']).toBe('rollout');
  });

  const BAD_FROM: Array<[string[], RegExp]> = [
    [['--from', 'operator'], /^ccrc: --from expects one of cli pwa restore rollback watchdog rollout \(got: operator\)$/m],
    [['--from=CLI'], /^ccrc: --from expects one of cli pwa restore rollback watchdog rollout \(got: CLI\)$/m],
    [['--from'], /^ccrc: --from needs a value: one of cli pwa restore rollback watchdog rollout$/m],
  ];
  it.each(BAD_FROM)('%s is a usage error: exit 2, usage printed, nothing fetched, nothing reported (D-3228)', (args, msg) => {
    const home = freshUpdateBox('ccrc-update-json-badfrom-');
    const r = runUpdate(home, args);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(msg);
    expect(r.stderr).toMatch(/usage: ccrc \{/);
    expect(existsSync(join(home, 'curl-argv')), 'a fetch ran before the refusal').toBe(false);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
  });

  it('--check and --from are exclusive — D-3139\'s shape: exit 2, nothing fetched, nothing reported', () => {
    const home = freshUpdateBox('ccrc-update-json-check-from-');
    const r = runUpdate(home, ['--check', '--from', 'pwa']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: update: --check and --from are exclusive — --check measures and writes nothing, --from attributes a run that moves this box; pick one$/m);
    expect(existsSync(join(home, 'curl-argv')), 'a fetch ran before the refusal').toBe(false);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
  });

  it('a verdict on the RELEASE is reported `provenance: …` — the absent bundle and the failing one; a verifier that could not RUN is not (spec §8, D-3239)', () => {
    const detailOf = (home: string): string => {
      const rep = lastReport(home);
      expect(rep['phase']).toBe('failed');
      const d = String(rep['detail']);
      expect(d.length).toBeLessThanOrEqual(200);
      expect(d).toMatch(/^[ -~]*$/);
      return d;
    };
    const absent = freshUpdateBox('ccrc-update-json-prov-absent-');
    plantOldBox(absent, { version: 'v1.0.0' });
    packRelease(absent, stubTree(absent, { version: 'v2.0.0' }), { tag: 'v2.0.0', bundle: false });
    expect(runUpdate(absent).code).toBe(1);
    expect(detailOf(absent)).toMatch(/^provenance: the release ships no provenance bundle /);

    const failing = freshUpdateBox('ccrc-update-json-prov-fail-');
    plantOldBox(failing, { version: 'v1.0.0' });
    packRelease(failing, stubTree(failing, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    writeFileSync(join(failing, 'fixture-verify-exit'), '1\n');
    expect(runUpdate(failing).code).toBe(1);
    expect(detailOf(failing)).toMatch(/^provenance: provenance verification FAILED for ccrc-v2\.0\.0\.tar\.gz /);

    // A node fault, not a verdict: W2's sweep must NOT turn it into this
    // node's refusal of a good release.
    const norun = freshUpdateBox('ccrc-update-json-prov-norun-');
    plantOldBox(norun, { version: 'v1.0.0' });
    packRelease(norun, stubTree(norun, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    writeFileSync(join(norun, 'fixture-verify-exit'), '127\n');
    expect(runUpdate(norun).code).toBe(1);
    const d = detailOf(norun);
    expect(d).toMatch(/^could not RUN the installed verifier /);
    expect(d).not.toMatch(/^provenance:/);
  });

  // D-3284 (final review, B2, I-2): a MEASURED non-404 status on the bundle
  // fetch (a 503, a 403 rate limit) is a transient node fault, not "this
  // release ships no bundle" — it must NOT carry `UPD_FAIL_PREFIX`, or W2's
  // sweep (`startsWith('provenance:')`) turns a passing release, from a
  // release host that merely blipped, into a lasting per-node refusal
  // (D-3239). Only a MEASURED 404 keeps the prefix — pinned unchanged below.
  it.each([['503'], ['403']])('a bundle fetch answering a measured %s is a transient fetch failure, never "provenance: " — exit 1, the status is named (D-3284)', (status) => {
    const detailOf = (home: string): string => {
      const rep = lastReport(home);
      expect(rep['phase']).toBe('failed');
      return String(rep['detail']);
    };
    const home = freshUpdateBox(`ccrc-update-json-prov-http${status}-`);
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-bundle-http'), `${status}\n`);
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    const d = detailOf(home);
    expect(d).not.toMatch(/^provenance:/);
    // Verdict-first (D-3284): "not a verdict on this release" leads, so it
    // survives the 200-character cut even with a long release URL.
    expect(d).toMatch(/^a transient fetch failure \(curl exit 22, HTTP \d+, not a 404\) fetching the provenance bundle - not a verdict on this release:/);
    expect(r.stderr).toMatch(new RegExp(`a transient fetch failure \\(curl exit 22, HTTP ${status}, not a 404\\) fetching the provenance bundle — not a verdict on this release: .*sigstore\\.json`));
    // --allow-unsigned does not turn a transient fault into "absence" either.
    const withFlag = freshUpdateBox(`ccrc-update-json-prov-http${status}-flag-`);
    plantOldBox(withFlag, { version: 'v1.0.0' });
    packRelease(withFlag, stubTree(withFlag, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    writeFileSync(join(withFlag, 'fixture-bundle-http'), `${status}\n`);
    const r2 = runUpdate(withFlag, ['--allow-unsigned']);
    expect(r2.code, `stderr: ${r2.stderr}`).toBe(1);
    expect(detailOf(withFlag)).not.toMatch(/^provenance:/);
  });

  // 404 keeps its ORIGINAL behaviour: unchanged, still `provenance: `-prefixed,
  // still admitted under --allow-unsigned — the D-3284 fix narrows what
  // COUNTS as absence, it does not touch the 404 arm itself.
  it('a bundle fetch answering a measured 404 is unchanged: `provenance: `-prefixed, admitted only with --allow-unsigned (D-3284)', () => {
    const refused = freshUpdateBox('ccrc-update-json-prov-http404-refused-');
    plantOldBox(refused, { version: 'v1.0.0' });
    packRelease(refused, stubTree(refused, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    writeFileSync(join(refused, 'fixture-bundle-http'), '404\n');
    const r = runUpdate(refused);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(String(lastReport(refused)['detail'])).toMatch(/^provenance: the release ships no provenance bundle /);
    expect(r.stderr).toMatch(/the release ships no provenance bundle .*answered 404.*installs only with --allow-unsigned/);

    const admitted = freshUpdateBox('ccrc-update-json-prov-http404-admitted-');
    plantOldBox(admitted, { version: 'v1.0.0' });
    packRelease(admitted, stubTree(admitted, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    writeFileSync(join(admitted, 'fixture-bundle-http'), '404\n');
    const r2 = runUpdate(admitted, ['--allow-unsigned']);
    expect(r2.code, `stderr: ${r2.stderr}`).toBe(0);
    expect(r2.stdout).toMatch(/WARN: .*sigstore\.json is absent \(the release host answered 404\)/);
  });

  it('a detail is printable ASCII, at most 200 characters, cut BEFORE it is escaped: a die naming a hostile URL arrives exactly', () => {
    // CCRC_RELEASE_BASE_URL is the one knob that puts arbitrary bytes into a
    // die sentence: `_upd_resolve`'s "download failed: <url>/SHA256SUMS …".
    // Position by position: "download failed: " (17) + "local://" (8) +
    // `é` — two UTF-8 bytes, two `?` — + `"` + `q` + `\` = 30, then 170 of
    // the 300 x's reach the 200-character cut, which runs before the two
    // escapes, so no escape is ever split.
    const home = freshUpdateBox('ccrc-update-json-detail-');
    const r = runUpdate(home, [], { CCRC_RELEASE_BASE_URL: `local://é"q\\${'x'.repeat(300)}` });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/download failed: local:\/\//);
    const rep = lastReport(home);
    expect(rep['phase']).toBe('failed');
    expect(rep['detail']).toBe(`download failed: local://??"q\\${'x'.repeat(170)}`);
  });

  it('a report that cannot be written is a WARN line per phase and the update still completes — a directory squatting on the name is refused, never moved INTO', () => {
    const home = freshUpdateBox('ccrc-update-json-unwritable-');
    plantOldBox(home, { version: 'v1.0.0' });
    mkdirSync(join(home, '.ccrc', 'update.json'), { recursive: true });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^update: WARN: could not write ~\/\.ccrc\/update\.json \(phase resolving\) — the console will not see this phase; the update continues$/m);
    expect(r.stdout).toMatch(/^update: WARN: could not write ~\/\.ccrc\/update\.json \(phase done\) — /m);
    expect(existsSync(join(home, 'staged-ccrc-argv')), 'the update stopped for its report').toBe(true);
    expect(readdirSync(join(home, '.ccrc', 'update.json'))).toEqual([]);
    expect(readdirSync(join(home, '.ccrc')).filter((f) => f.startsWith('update.json.'))).toEqual([]);
  });

  it('--from restore|rollback|watchdog typed BY HAND on the update verb are all refused, exit 2, before anything is fetched — naming the verb to use (fix round 1 item 10 / review 155 C16, amends D-3257); --from pwa is refused by W1\'s sentence (spec §9)', () => {
    // The three CALLER words: `restore` (D-3257, unchanged), and now
    // `rollback`/`watchdog` too — each is spoken only by its one real
    // caller (`_upd_restore_arm2`'s child; `cmd_rollback`'s own in-process
    // call), never by an operator's hand-typed `ccrc update --from …`. Their
    // real WARN-below-the-floor behaviour is measured on the REAL caller,
    // not here: `restore`'s in Task 6's FULL restore case, `rollback`'s in
    // "bare `ccrc rollback` returns to previous…", `watchdog`'s in
    // "`ccrc rollback --from watchdog` — the REAL in-process path…".
    for (const from of ['restore', 'rollback', 'watchdog']) {
      const home = freshUpdateBox(`ccrc-update-json-floor-${from}-`);
      plantOldBox(home, { version: 'v3.0.0' });
      plantFloor(home, 'v3.0.0');
      packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
      const r = runUpdate(home, ['--to', 'v2.0.0', '--from', from]);
      expect(r.code, `${from} — stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(2);
      if (from === 'restore') {
        expect(r.stderr).toMatch(/--from restore is the automatic restore's own word .* ccrc update --to <tag> --downgrade/);
      } else {
        expect(r.stderr).toMatch(new RegExp(`--from ${from} is ccrc rollback's own word .* ccrc rollback --to <tag>`));
      }
      expect(existsSync(join(home, 'curl-argv')), `${from}: a fetch ran before the refusal`).toBe(false);
      expect(readFileSync(join(home, '.ccrc', 'floor'), 'utf8')).toBe('v3.0.0\n');
      expect(existsSync(join(home, 'staged-ccrc-argv')), `${from}: something was staged before the refusal`).toBe(false);
    }
    const pwa = freshUpdateBox('ccrc-update-json-floor-pwa-');
    plantOldBox(pwa, { version: 'v3.0.0' });
    plantFloor(pwa, 'v3.0.0');
    packRelease(pwa, stubTree(pwa, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(pwa, ['--to', 'v2.0.0', '--from', 'pwa']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/v2\.0\.0 \(resolved by --to v2\.0\.0\) is below this box's floor v3\.0\.0 .* ccrc update --to v2\.0\.0 --downgrade/);
    expect(existsSync(join(pwa, 'ccrc-backups'))).toBe(false);
    expect(lastReport(pwa)['phase']).toBe('failed');
  });

  // Fix round 1 item 10 / review 155 C16 — spoofing: neither door opens for
  // an EXPORTED marker of the same name (the value it would have to guess
  // is a pid that does not exist yet), and `_upd_lock`'s own $PPID-matching
  // for `restore` needs the SAME kind of externally-unknowable value.
  it('the process-local caller markers cannot be spoofed by exporting a variable of the same name (fix round 1 item 10 / review 155 C16)', () => {
    const home = freshUpdateBox('ccrc-update-json-floor-spoof-');
    plantOldBox(home, { version: 'v3.0.0' });
    plantFloor(home, 'v3.0.0');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    for (const [from, marker, value] of [
      ['rollback', 'UPD_FROM_CALLER_PID', '1'] as const,
      ['watchdog', 'UPD_FROM_CALLER_PID', '1'] as const,
      ['restore', 'CCRC_UPDATE_LOCK_HELD', '1'] as const,
    ]) {
      const r = runUpdate(home, ['--to', 'v2.0.0', '--from', from], { [marker]: value });
      expect(r.code, `${from}/${marker} — stderr: ${r.stderr}`).toBe(2);
      expect(existsSync(join(home, 'curl-argv')), `${from}: a fetch ran before the refusal`).toBe(false);
    }
  });

  // Review fix round 1, I2: the value `1` alone is not the real attack —
  // `exec` KEEPS THE PID, so a forger who controls the exec chain can
  // compute the RIGHT value (their own `$$`, which becomes the eventual
  // `ccrc update` process's own `$$` too) and export it in ahead of time.
  // The measured repro: `sh -c 'UPD_FROM_CALLER_PID=$$ exec bash "$0"
  // update … --from rollback' <ccrc>`. The file-scope `unset
  // UPD_FROM_CALLER_PID` (I2's fix, in the globals block) must still
  // refuse it — nothing on this box changed.
  it('the exec-preserved-pid forgery is still refused: `sh -c \'UPD_FROM_CALLER_PID=$$ exec bash "$0" update … --from rollback\'` (review fix round 1 I2)', () => {
    const home = freshUpdateBox('ccrc-update-json-floor-exec-forge-');
    plantOldBox(home, { version: 'v3.0.0' });
    plantFloor(home, 'v3.0.0');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const env = updateEnv(home);
    replantDoctorStubs(home);
    const ccrc = join(REPO, 'ccd', 'ccrc');
    const script = 'UPD_FROM_CALLER_PID=$$ exec bash "$0" update --to v2.0.0 --from rollback';
    const r = spawnSync(BASH, ['-c', script, ccrc], { env, encoding: 'utf8' });
    expect(r.status, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toMatch(/--from rollback is ccrc rollback's own word/);
    expect(existsSync(join(home, 'curl-argv')), 'a fetch ran before the refusal').toBe(false);
  });

  it('_ccrc_die reports `failed` only once the run is reporting, only from the run\'s own shell, with the prefix in front (the one hook)', () => {
    // `ccrc-install-*.test.ts`'s one-line-definition idiom: the ONE-LINE definition extracted
    // from the shipped file and run alone, `_upd_phase` shadowed by a recorder.
    // Fix round 1 item 11 / review 155 C17: `_ccrc_die` now calls
    // `_upd_redact` (a multi-line function, extracted by its own block regex,
    // never a one-liner), so this harness must pick that definition up too —
    // without it, `_ccrc_die`'s body hits "_upd_redact: command not found"
    // rather than the sentence this test means to measure.
    const src = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    const progLine = /^PROG=.*$/m.exec(src);
    const redactBlock = /^_upd_redact\(\) \{[\s\S]*?\n\}$/m.exec(src);
    const dieLine = /^_ccrc_die\(\) \{.*\}$/m.exec(src);
    expect(progLine, 'ccd/ccrc has no PROG=').not.toBeNull();
    expect(redactBlock, 'ccd/ccrc has no _upd_redact block').not.toBeNull();
    expect(dieLine, 'ccd/ccrc has no one-line _ccrc_die').not.toBeNull();
    const home = mkTmp('ccrc-update-die-hook-');
    const rec = join(home, 'phase-calls');
    const run = (body: string): Result => {
      const p = spawnSync(BASH, ['-c', [
        'set -uo pipefail', progLine![0], redactBlock![0], dieLine![0],
        `_upd_phase() { printf '%s|%s\\n' "$1" "$2" >> '${rec}'; }`,
        'UPD_FAIL_PREFIX=""', body,
        // Wave 9 R10d: this harness handed no env and so inherited the REAL HOME. An extracted-function harness
        // (builtins plus date/mkdir/chmod/mv/rm only), so it is exempt from assertNoRealTool, and PATH-less on purpose.
      ].join('\n')], { env: { HOME: home }, encoding: 'utf8' });
      return { code: p.status ?? -1, stdout: p.stdout ?? '', stderr: p.stderr ?? '' };
    };
    let r = run('UPD_REPORTING=0; _ccrc_die before the lock');
    expect(r.code).toBe(1);
    expect(existsSync(rec), 'a die before the run reports wrote a report').toBe(false);
    r = run('UPD_REPORTING=1; x="$(_ccrc_die inside a command substitution)"; echo "survived:$?"');
    expect(r.stdout).toMatch(/^survived:1$/m);
    expect(existsSync(rec), 'a subshell\'s die reported the RUN as failed').toBe(false);
    r = run('UPD_REPORTING=1; UPD_FAIL_PREFIX="provenance: "; _ccrc_die the release failed');
    expect(r.code).toBe(1);
    expect(r.stderr).toBe('ccrc: the release failed\n');
    expect(readFileSync(rec, 'utf8')).toBe('failed|provenance: the release failed\n');
  });

  // Fix round 1 item 11 / review 155 C17: `_upd_redact` itself, extracted
  // and called directly — a normal URL (no userinfo) and an unrelated '@'
  // past the authority (a query string) pass through BYTE FOR BYTE, never
  // mangled by a redaction that is too eager; a credentialed one loses only
  // the userinfo; the home directory becomes `~`, literally (not the
  // process's real $HOME re-expanded through the replacement side of a
  // bash substitution — the exact bug this fix's own first draft shipped,
  // measured: `${s//"$HOME"/~}` is a silent no-op, because a bare `~` on
  // the REPLACEMENT side of `${..//pattern/string}` undergoes tilde
  // expansion to the CURRENT $HOME before it is ever used as a literal).
  it('_upd_redact: a normal URL passes through unchanged, a credentialed one loses only the userinfo, and HOME becomes a literal ~ (fix round 1 item 11 / review 155 C17)', () => {
    const src = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    const redactBlock = /^_upd_redact\(\) \{[\s\S]*?\n\}$/m.exec(src);
    expect(redactBlock, 'ccd/ccrc has no _upd_redact block').not.toBeNull();
    const home = mkTmp('ccrc-update-redact-unit-');
    const call = (text: string): string => {
      const p = spawnSync(BASH, ['-c', [redactBlock![0], '_upd_redact "$1"'].join('\n'), '_', text],
        { env: { HOME: home }, encoding: 'utf8' });
      expect(p.status, p.stderr).toBe(0);
      return p.stdout;
    };
    // No userinfo: byte for byte, including a query-string '@' past the
    // authority (the comment above `_upd_redact`'s own strip states this).
    const plain = 'https://github.com/Synapsium-Labs/ccrc-pwa/releases/download/v1.0.0/SHA256SUMS';
    expect(call(plain)).toBe(plain);
    const withQueryAt = 'https://example.com/path?email=a@example.com&x=1';
    expect(call(withQueryAt)).toBe(withQueryAt);
    // Userinfo stripped, host and path untouched.
    expect(call('http://user:s3cretTOKEN@127.0.0.1:1/rel/download/v0.0.1/SHA256SUMS'))
      .toBe('http://127.0.0.1:1/rel/download/v0.0.1/SHA256SUMS');
    // HOME becomes a LITERAL tilde character, not the redaction's own
    // process $HOME re-expanded back in.
    expect(call(`${home}/.ccrc/floor`)).toBe('~/.ccrc/floor');
    // D-6748: a base with no scheme loses its userinfo at a token's start, with or without a ':' in it; prose's `user@host`,
    // an email, a query's email and a scoped package name stay byte for byte.
    expect(call('fetching user:s3cretTOKEN@127.0.0.1:1/rel/x and "tok@h/r"')).toBe('fetching 127.0.0.1:1/rel/x and "h/r"');
    // Fix round 3: a '<' or '"' past the run's first character is the password's; one that starts a token still ends prose.
    expect(call('see <u:p<w@h/r> and u:p"w@h/r')).toBe('see <h/r> and h/r');
    // Fix round 4, F1: a scheme followed by one slash or by three (curl authenticates with both) loses its userinfo, its
    // slashes kept as written.
    expect(call('fetching http:/u:s3cretTOKEN@h/r and https:///u:s3cretTOKEN@h/r')).toBe('fetching http:/h/r and https:///h/r');
    for (const kept of ['curl: (6) user@host', 'mail a@example.com today', 'https://h/r?email=a@example.com/y', '@scope/pkg']) {
      expect(call(kept), kept).toBe(kept);
    }
  });

  // Review fix round 1, M6: the OLD blind substring replace was not
  // anchored to a path boundary — HOME=/home/u turned /home/user2/f into
  // ~ser2/f (a bare PREFIX match), and a trailing-slash HOME turned
  // /home/u/.ccrc into ~.ccrc (the separating '/' consumed along with
  // HOME). Fixed: a trailing slash is stripped from HOME first; HOME of
  // '/' (or empty) is then skipped entirely; what remains is replaced only
  // where it is followed by '/' or ends a token. And N2: the userinfo
  // class excludes '?' and '#' too, so an authority with no '/' at all is
  // never collapsed.
  it('_upd_redact: HOME is anchored to a path boundary — HOME=/, a trailing-slash HOME, and a prefix that is not a real match (review fix round 1 M6, N2)', () => {
    const src = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    const redactBlock = /^_upd_redact\(\) \{[\s\S]*?\n\}$/m.exec(src);
    expect(redactBlock, 'ccd/ccrc has no _upd_redact block').not.toBeNull();
    const callWithHome = (text: string, home: string): string => {
      const p = spawnSync(BASH, ['-c', [redactBlock![0], '_upd_redact "$1"'].join('\n'), '_', text],
        { env: { HOME: home }, encoding: 'utf8' });
      expect(p.status, p.stderr).toBe(0);
      return p.stdout;
    };
    // HOME=/ replaces NOTHING — the old code turned every '/' in the
    // sentence into '~', garbling a plain URL.
    expect(callWithHome('cmd http://h/p', '/')).toBe('cmd http://h/p');
    // A trailing-slash HOME behaves exactly like the same HOME without one.
    expect(callWithHome('/home/u/.ccrc/floor', '/home/u/')).toBe('~/.ccrc/floor');
    expect(callWithHome('/home/u/.ccrc/floor', '/home/u')).toBe('~/.ccrc/floor');
    // /home/u is a PREFIX of /home/user2, never a path-boundary match.
    expect(callWithHome('/home/user2/f', '/home/u')).toBe('/home/user2/f');
    // The true path IS still replaced, followed by '/', a quote, ':', ')',
    // or the end of the string.
    expect(callWithHome('/home/u/f', '/home/u')).toBe('~/f');
    expect(callWithHome('path "/home/u" here', '/home/u')).toBe('path "~" here');
    expect(callWithHome('PATH=/home/u:/usr/bin', '/home/u')).toBe('PATH=~:/usr/bin');
    expect(callWithHome('(cd /home/u)', '/home/u')).toBe('(cd ~)');
    expect(callWithHome('/home/u', '/home/u')).toBe('~');
    // N2: an authority with no '/' before the credential — a query string
    // ('?') or a fragment ('#') ending it instead — is left unchanged,
    // never collapsed into `scheme://host`.
    expect(callWithHome('https://h?a@b', '')).toBe('https://h?a@b');
    expect(callWithHome('https://h#a@b', '')).toBe('https://h#a@b');
  });

  // W6 Task 8A, review 167's F5 (cosmetic): the boundary BEFORE HOME. The
  // review's record of its three shapes is not in the tree, so these are the
  // three ways a HOME that is a SUFFIX of a longer path is met, one per
  // boundary AFTER it that already worked (`/`, `:`, end of string) — each
  // used to become `/srv~…`. The controls are the boundaries BEFORE it that
  // must keep redacting (start, a space, `=`, `:`, a quote, a `file://`).
  it('_upd_redact: HOME is anchored to a path boundary BEFORE it too — `/srv/home/u/x` stays whole, and every real start-of-path still redacts (review 167 F5)', () => {
    const src = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    const redactBlock = /^_upd_redact\(\) \{[\s\S]*?\n\}$/m.exec(src);
    expect(redactBlock, 'ccd/ccrc has no _upd_redact block').not.toBeNull();
    const call = (text: string): string => {
      const p = spawnSync(BASH, ['-c', [redactBlock![0], '_upd_redact "$1"'].join('\n'), '_', text],
        { env: { HOME: '/home/u' }, encoding: 'utf8' });
      expect(p.status, p.stderr).toBe(0);
      return p.stdout;
    };
    // The three shapes: followed by '/', by ':', and by the end of the string.
    expect(call('/srv/home/u/x')).toBe('/srv/home/u/x');
    expect(call('/srv/home/u:/usr/bin')).toBe('/srv/home/u:/usr/bin');
    expect(call('/srv/home/u')).toBe('/srv/home/u');
    // And one HOME inside a longer path amid a real one: only the real one goes.
    expect(call('/srv/home/u/x and /home/u/y')).toBe('/srv/home/u/x and ~/y');
    // The boundaries before HOME that stay.
    expect(call('/home/u/x')).toBe('~/x');
    expect(call('cd /home/u/x')).toBe('cd ~/x');
    expect(call('K=/home/u/x')).toBe('K=~/x');
    expect(call('/usr/bin:/home/u/bin')).toBe('/usr/bin:~/bin');
    expect(call('"/home/u/x"')).toBe('"~/x"');
    expect(call('file:///home/u/x')).toBe('file://~/x');
  });

  // Fix round 1 item 11 / review 155 C17: a CCRC_RELEASE_BASE_URL carrying
  // userinfo must not reach stdout, stderr or update.json — for `update`
  // AND for `rollback` (two different die sites: `_upd_resolve`'s
  // "download failed: …" and `_upd_asset_listed`'s pre-detach check). A
  // poisoned `curl` (always exit 99, never a real network call, no local://
  // stub in the way) makes every release-host fetch fail immediately and
  // deterministically, so this measures the REAL `_ccrc_die` -> `_upd_redact`
  // path end to end, not a fixture's own text.
  //
  // Review fix round 1, M3: the ROLLBACK half was vacuous with an always-
  // fail curl — `cmd_rollback` dies in `_upd_asset_listed`'s pre-check FIRST
  // (`_upd_asset_listed "$to" SHA256SUMS`, the very first curl call), whose
  // sentence ("could not ask the release host whether … exists") never
  // carries the URL at all, so that half never exercised the credentialed
  // URL reaching a die. Fixed: rollback's curl stub answers the FIRST call
  // (the pre-check) 200 and fails every call after it, so `cmd_rollback`'s
  // in-process `cmd_update` reaches `_upd_resolve`'s OWN SHA256SUMS fetch —
  // a die that DOES carry `$UPD_URL_DIR` — on the second call.
  it('a credentialed CCRC_RELEASE_BASE_URL never reaches stdout, stderr or update.json — update and rollback (fix round 1 item 11 / review 155 C17)', () => {
    const secret = 's3cretTOKEN';
    for (const verb of ['update', 'rollback'] as const) {
      const home = mkTmp(`ccrc-redact-secret-${verb}-`);
      mkdirSync(join(home, '.local', 'bin'), { recursive: true });
      if (verb === 'update') {
        writeFileSync(join(home, '.local', 'bin', 'curl'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
      } else {
        // Succeeds ONCE (the pre-check's -o /dev/null -w '%{http_code}'
        // probe, answered 200), fails every call after — so the second
        // call, `_upd_resolve`'s real SHA256SUMS fetch inside the in-
        // process `cmd_update`, is the one that dies, URL and all.
        writeFileSync(join(home, '.local', 'bin', 'curl'), [
          '#!/bin/sh',
          'n=0; [ -f "$HOME/curl-n" ] && n="$(cat "$HOME/curl-n")"',
          'n=$((n + 1)); echo "$n" > "$HOME/curl-n"',
          '[ "$n" -eq 1 ] || exit 99',
          'dest=""; wfmt=""; prev=""',
          'for a in "$@"; do',
          '  case "$prev" in -o) dest="$a" ;; -w) wfmt="$a" ;; esac',
          '  prev="$a"',
          'done',
          '[ -n "$dest" ] && [ "$dest" != "/dev/null" ] && : > "$dest"',
          '[ -n "$wfmt" ] && printf \'200\'',
          'exit 0',
        ].join('\n'), { mode: 0o755 });
      }
      const env = {
        ...ccrcContainedEnv(home, process.env, { managers: true, curl: 'poison' }),
        CCRC_RELEASE_BASE_URL: `http://user:${secret}@127.0.0.1:1/rel`,
      };
      assertNoRealTool(env, home);
      const args = verb === 'update' ? ['update', '--to', 'v0.0.1'] : ['rollback', '--to', 'v0.0.1', '--from', 'pwa'];
      const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), ...args], { env, encoding: 'utf8' });
      expect(r.stdout, `${verb} stdout`).not.toContain(secret);
      expect(r.stderr, `${verb} stderr`).not.toContain(secret);
      // A URL-bearing die must actually have fired (M3): "download failed"
      // is `_upd_resolve`'s own sentence, never `_upd_asset_listed`'s.
      expect(r.stderr, `${verb} stderr`).toMatch(/download failed:/);
      const jsonPath = join(home, '.ccrc', 'update.json');
      expect(existsSync(jsonPath), `${verb} wrote no update.json`).toBe(true);
      expect(readFileSync(jsonPath, 'utf8'), `${verb} update.json`).not.toContain(secret);
      // A measurement, not just an absence: something DID fail (the point
      // of this run), so a passing test is not vacuously green.
      expect(r.status, `${verb} must actually have refused`).not.toBe(0);
    }
  });

  // D-6748 (fix round 1, F7): a base in ccrc.env with NO scheme (`user:pass@host/r`, which curl takes as http) is masked by
  // `_upd_redact` as the scheme form is, on each of the three ways it would leave the box: the fetching line, the die line and
  // update.json's detail. The poisoned curl (exit 99) fails the first fetch, so `_upd_resolve`'s URL-bearing die fires.
  const schemeless = (prefix: string, base?: { url: string; from: 'file' | 'env' | 'env-bytes' }): { r: Result; secret: string; home: string } => {
    const secret = 's3cretTOKEN';
    const home = mkTmp(prefix);
    mkdirSync(join(home, '.local', 'bin'), { recursive: true });
    writeFileSync(join(home, '.local', 'bin', 'curl'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    const url = base?.url ?? `user:${secret}@127.0.0.1:1/rel`;
    if (base === undefined || base.from === 'file') writeFileSync(join(home, '.ccrc', 'ccrc.env'), `CCRC_RELEASE_BASE_URL=${url}\n`);
    const env = ccrcContainedEnv(home, process.env, { managers: true, curl: 'poison' });
    delete env['CCRC_RELEASE_BASE_URL'];
    if (base?.from === 'env') env['CCRC_RELEASE_BASE_URL'] = url;
    assertNoRealTool(env, home);
    // 'env-bytes': node passes an env value as UTF-8, so a raw invalid byte is made by printf's `%b` in a bash that then runs ccrc.
    const p = base?.from === 'env-bytes'
      ? spawnSync(BASH, ['-c', 'CCRC_RELEASE_BASE_URL="$(printf %b "$1")"; export CCRC_RELEASE_BASE_URL; exec "$BASH" "$2" update --to v0.0.1',
        '_', url, join(REPO, 'ccd', 'ccrc')], { env: { ...env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }, encoding: 'utf8' })
      : spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'update', '--to', 'v0.0.1'], { env, encoding: 'utf8' });
    const r = { code: p.status ?? -1, stdout: p.stdout ?? '', stderr: p.stderr ?? '' };
    expect(r.code, `it must refuse: ${r.stderr}`).not.toBe(0);
    return { r, secret, home };
  };
  const SCHEMELESS_URL = '127.0.0.1:1/rel/download/v0.0.1/SHA256SUMS';

  it('a scheme-less credentialed base in ccrc.env: the fetching line names the URL without its userinfo (D-6748)', () => {
    const { r, secret } = schemeless('ccrc-redact-schemeless-fetch-');
    expect(r.stdout.split('\n'), r.stdout).toContain(`update: fetching ${SCHEMELESS_URL} …`);
    expect(r.stdout).not.toContain(secret);
    expect(r.stdout).not.toContain('user:');
  });

  it('a scheme-less credentialed base in ccrc.env: the download-failed die names the URL without its userinfo (D-6748)', () => {
    const { r, secret } = schemeless('ccrc-redact-schemeless-die-');
    const die = r.stderr.split('\n').filter((l) => l.includes('download failed:'));
    expect(die, r.stderr).toHaveLength(1);
    expect(die[0]).toContain(SCHEMELESS_URL);
    expect(r.stderr).not.toContain(secret);
    expect(r.stderr).not.toContain('user:');
  });

  it('a scheme-less credentialed base in ccrc.env: update.json\'s detail names the URL without its userinfo (D-6748)', () => {
    const { secret, home } = schemeless('ccrc-redact-schemeless-json-');
    const raw = readFileSync(join(home, '.ccrc', 'update.json'), 'utf8');
    const detail = String(JSON.parse(raw).detail ?? '');
    expect(detail, raw).toContain('download failed:');
    expect(detail).toContain('127.0.0.1:1/rel/download/');
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain('user:');
  });

  // D-6748 (fix round 3, item 1): a password may hold a raw '<' or '"' (curl sends both in a scheme-less userinfo), so the mask
  // runs through them past the run's first character. Each row reads all three ways out: the fetching line, the one die line
  // and update.json's detail; no fragment of the userinfo may appear in any of them.
  // The third: an invalid UTF-8 byte (from the environment, as the file reader refuses a non-ASCII line) under a UTF-8 locale,
  // where bash's `=~` matches characters and an invalid byte ended every run, until `_upd_redact` read bytes (LC_ALL=C).
  const schemelessMasked = (from: 'file' | 'env' | 'env-bytes', pass: string): void => {
    const { r, home } = schemeless(`ccrc-redact-schemeless-${from}-`, { url: `fleetuser:${pass}@mirror.example/rel`, from });
    const url = 'mirror.example/rel/download/v0.0.1/SHA256SUMS';
    expect(r.stdout.split('\n'), r.stdout).toContain(`update: fetching ${url} …`);
    const die = r.stderr.split('\n').filter((l) => l.includes('download failed:'));
    expect(die, r.stderr).toHaveLength(1);
    expect(die[0]).toContain(url);
    const raw = readFileSync(join(home, '.ccrc', 'update.json'), 'utf8');
    const detail = String(JSON.parse(raw).detail ?? '');
    expect(detail, raw).toContain(`download failed: ${url}`);
    for (const [where, text] of [['stdout', r.stdout], ['stderr', r.stderr], ['update.json', raw]]) {
      for (const part of ['fleetuser', 'S3cr', 'etTOKEN']) expect(text, `${where} carries ${part}`).not.toContain(part);
    }
  };
  for (const [label, from, pass] of [['"', 'env', 'S3cr"etTOKEN'], ['an invalid UTF-8 byte', 'env-bytes', 'S3cr\\377etTOKEN']] as const) {
    it(`a scheme-less base whose password holds ${label} (${from === 'env' ? 'the environment' : 'the environment, a UTF-8 locale'}): the fetching line, the die line and update.json's detail carry no part of the userinfo (D-6748, fix round 3)`, () => {
      schemelessMasked(from, pass);
    });
  }
  // The '<' row reads ccrc.env, and that file is read differently per platform. On Linux the line is a value and the mask runs
  // through the '<'. On macOS the launchd job sources both env files with bash, so ccrc refuses a line bash would not read as a
  // plain NAME=value (intended): it never fetches, and the refusal names the line, never its value. The '<' mask itself is
  // still read there, through the environment, which macOS does not refuse.
  platformContrast('a scheme-less base whose password holds < (ccrc.env)', {
    linux: ['the fetching line, the die line and update.json\'s detail carry no part of the userinfo (D-6748, fix round 3)', () => {
      schemelessMasked('file', 'S3cr<etTOKEN');
    }],
    darwin: ['ccrc refuses the line before any fetch, and no part of the userinfo reaches stdout, stderr or update.json (D-6748, fix round 3)', () => {
      const { r, home } = schemeless('ccrc-redact-schemeless-file-', { url: 'fleetuser:S3cr<etTOKEN@mirror.example/rel', from: 'file' });
      const refusal = r.stderr.split('\n').filter((l) => l.includes('cannot be measured:'));
      expect(refusal, r.stderr).toHaveLength(1);
      expect(refusal[0]).toContain('CCRC_RELEASE_BASE_URL cannot be measured: ~/.ccrc/ccrc.env line 1 is not a plain NAME=value line');
      expect(r.stdout, r.stdout).not.toContain('update: fetching');
      const json = join(home, '.ccrc', 'update.json');
      const raw = existsSync(json) ? readFileSync(json, 'utf8') : '';
      for (const [where, text] of [['stdout', r.stdout], ['stderr', r.stderr], ['update.json', raw]]) {
        for (const part of ['fleetuser', 'S3cr', 'etTOKEN']) expect(text, `${where} carries ${part}`).not.toContain(part);
      }
    }],
  });
  // PLATFORM-ONLY: macOS refuses the '<' line in ccrc.env (the contrast above), so there the '<' mask is read from the environment.
  itDarwin('a scheme-less base whose password holds < (the environment, macOS): the fetching line, the die line and update.json\'s detail carry no part of the userinfo (D-6748, fix round 3)', () => {
    schemelessMasked('env', 'S3cr<etTOKEN');
  });

  // D-6748 (fix round 4, F1): a scheme followed by one slash (`http:/`) or by three (`https:///`): curl authenticates with
  // both, and `_upd_release_base` does not validate the scheme, so each reaches the three ways out, from ccrc.env and from
  // the environment alike. The userinfo goes and the slashes stay as written.
  for (const [scheme, from] of [['http:/', 'file'], ['http:/', 'env'], ['https:///', 'file'], ['https:///', 'env']] as const) {
    it(`a base spelled ${scheme} (${from === 'file' ? 'ccrc.env' : 'the environment'}): the fetching line, the die line and update.json's detail carry no part of the userinfo (D-6748, fix round 4)`, () => {
      const { r, home } = schemeless(`ccrc-redact-slashes-${from}-`, { url: `${scheme}fleetuser:S3cr3tTOKEN@mirror.example/rel`, from });
      const url = `${scheme}mirror.example/rel/download/v0.0.1/SHA256SUMS`;
      expect(r.stdout.split('\n'), r.stdout).toContain(`update: fetching ${url} …`);
      const die = r.stderr.split('\n').filter((l) => l.includes('download failed:'));
      expect(die, r.stderr).toHaveLength(1);
      expect(die[0]).toContain(url);
      const raw = readFileSync(join(home, '.ccrc', 'update.json'), 'utf8');
      const detail = String(JSON.parse(raw).detail ?? '');
      expect(detail, raw).toContain(`download failed: ${url}`);
      for (const [where, text] of [['stdout', r.stdout], ['stderr', r.stderr], ['update.json', raw]]) {
        for (const part of ['fleetuser', 'S3cr3t', 'TOKEN']) expect(text, `${where} carries ${part}`).not.toContain(part);
      }
    });
  }

  // D-6748 (fix round 5, review 926's F1): curl expands `{…}` and `[…]` in a URL before it parses it, so a base spelled
  // `http:{/}/u:p@h` authenticated while `_upd_redact` printed it whole. Every release curl passes `-g`: curl then refuses such
  // a base (rc 3) before it sends anything, and never globs the tarball name SHA256SUMS supplies. Read off the fixture curl's
  // full argv, one curl at a time, by the URL it fetched: `_upd_resolve`'s SHA256SUMS, `_upd_fetch`'s tarball and bundle, and
  // `_upd_asset_listed`'s probe (rollback's pre-check and arm 2's, one function).
  it('every release curl passes -g: SHA256SUMS, the tarball, the bundle and _upd_asset_listed\'s probe (D-6748, fix round 5)', () => {
    const home = freshUpdateBox('ccrc-update-globoff-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--to', 'v2.0.0']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const env = { ...updateEnv(home), TMPDIR: join(home, 'tmp'), CCRC_RELEASE_BASE_URL: `local://${home}/releases` };
    replantDoctorStubs(home);
    assertNoRealTool(env, home);
    const p = spawnSync(BASH, ['-c', '. "$1"; _upd_asset_listed v2.0.0 SHA256SUMS; echo "rc $?"', 'ccrc-under-test',
      join(REPO, 'ccd', 'ccrc')], { env, encoding: 'utf8' });
    expect(p.stdout, `stderr: ${p.stderr}`).toBe('rc 0\n');
    const argv = curlFullArgv(home);
    const url = (line: string): string => line.trim().split(/\s+/).pop() ?? '';
    const globoff = (line: string): boolean => line.trim().split(/\s+/).some((t) => t === '--globoff' || /^-[A-Za-z]*g[A-Za-z]*$/.test(t));
    const rel = `local://${home}/releases/download/v2.0.0/`;
    const calls: Array<[string, string[]]> = [
      ['SHA256SUMS (resolve, then the probe)', argv.filter((l) => url(l) === `${rel}SHA256SUMS`)],
      ['the tarball', argv.filter((l) => url(l) === `${rel}ccrc-v2.0.0.tar.gz`)],
      ['the bundle', argv.filter((l) => url(l) === `${rel}ccrc-v2.0.0.tar.gz.sigstore.json`)],
    ];
    expect(calls.map(([, ls]) => ls.length), argv.join('\n')).toEqual([2, 1, 1]);
    expect(calls[0][1][1], 'the second SHA256SUMS call is the probe').toMatch(/ -o \/dev\/null /);
    for (const [what, ls] of calls) for (const l of ls) expect(globoff(l), `${what}: ${l}`).toBe(true);
  });

  // D-6751 (fix round 5, review 926's F2): two values the release host supplies, SHA256SUMS's tarball name and the staged
  // build.json's version (under --allow-unsigned, nothing but the transport checksum vouches for it), are held to 200
  // characters where each is read. Neither curl's --max-filesize (curl 8.4.0 or later, the default knob) nor anything else bounds
  // them otherwise, and `_upd_redact`'s loops grow about x7-8 per doubling on the review's combined shape (a failing `"a` run,
  // then `<x@y/` units). The fixture curl serves each value whole, as an older curl or a raised knob would let through, at
  // 100 000 characters and at that shape at about 16 000: the run must die naming the length, every sentence that leaves the
  // box (the die line, the fetching lines, update.json's detail) must stay within 200 characters, and the run must end in 30 s.
  const worstShape = (n: number): string => `x${'"a'.repeat(Math.floor(n / 4))}@ ${'<x@y/'.repeat(Math.floor(n / 10))}`;
  const boundedRun = (home: string, args: string[], locale?: string): { r: Result; ms: number } => {
    mkdirSync(join(home, 'tmp'), { recursive: true });
    const env = { ...updateEnv(home), TMPDIR: join(home, 'tmp'), CCRC_RELEASE_BASE_URL: `local://${home}/releases`,
      ...(locale === undefined ? {} : { LANG: locale, LC_ALL: locale }) };
    replantDoctorStubs(home);
    assertSpineFrontContained(env, home);
    assertNoRealTool(env, home);
    const t0 = Date.now();
    // The spawn's own 90 s kill only ends a run the bound did not; the 30 s assertion below is the row's measure.
    const p = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'update', ...args], { env, encoding: 'utf8', timeout: 90_000 });
    return { r: { code: p.status ?? -1, stdout: p.stdout ?? '', stderr: p.stderr ?? '' }, ms: Date.now() - t0 };
  };
  const expectBounded = (home: string, run: { r: Result; ms: number }, lead: string, value: string): void => {
    const { r, ms } = run;
    expect(ms, `the run took ${ms} ms`).toBeLessThan(30_000);
    expect(r.code, `stderr: ${r.stderr.slice(0, 2000)}`).toBe(1);
    const die = r.stderr.split('\n').filter((l) => l.startsWith(`ccrc: ${lead} is `));
    expect(die, r.stderr.slice(0, 2000)).toHaveLength(1);
    expect(die[0]).toContain(`${lead} is ${value.length} bytes or not printable ASCII, not a ccrc release's (starts: ${value.slice(0, 40)}) — refusing`);
    expect(die[0].length, die[0]).toBeLessThanOrEqual(200);
    const fetching = r.stdout.split('\n').filter((l) => l.startsWith('update: fetching '));
    expect(fetching.length, r.stdout.slice(0, 2000)).toBeGreaterThan(0);
    for (const l of fetching) expect(l.length, l.slice(0, 300)).toBeLessThanOrEqual(200);
    const report = JSON.parse(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')) as Record<string, unknown>;
    expect(report['phase']).toBe('failed');
    expect(String(report['detail'])).toContain(`${lead} is ${value.length} bytes or not printable ASCII`);
    expect(String(report['detail']).length).toBeLessThanOrEqual(200);
    expect(r.stdout + r.stderr, 'more than 200 characters of the value left the box').not.toContain(value.slice(0, 201));
  };
  for (const [label, name] of [['100 000 characters', `ccrc-${'x'.repeat(100_000 - 12)}.tar.gz`],
    ['the combined worst shape at about 16 000 characters', worstShape(16_000)]] as const) {
    it(`SHA256SUMS naming a tarball of ${label}: the update dies at the read naming its length, every sentence within 200 characters, within 30 s (D-6751, fix round 5)`, () => {
      const home = freshUpdateBox('ccrc-update-bound-name-');
      plantOldBox(home, { version: 'v1.0.0' });
      const relDir = join(home, 'releases', 'latest', 'download');
      mkdirSync(relDir, { recursive: true });
      writeFileSync(join(relDir, 'SHA256SUMS'), `${'a'.repeat(64)}  ${name}\n`);
      expectBounded(home, boundedRun(home, []), 'SHA256SUMS\'s tarball name', name);
      expect(localUrls(home), 'only SHA256SUMS was fetched').toEqual([`local://${home}/releases/latest/download/SHA256SUMS`]);
    }, 150_000);
  }
  // R45: each die prints its 40-byte excerpt with every byte outside printable ASCII as `?`, read byte-wise (LC_ALL=C).
  it('a 300-character tarball name with an ESC and a CR in its first 40 characters: the die and update.json\'s detail show ? for each, never the byte (D-6751, R45)', () => {
    const home = freshUpdateBox('ccrc-update-bound-name-ctl-');
    plantOldBox(home, { version: 'v1.0.0' });
    const relDir = join(home, 'releases', 'latest', 'download');
    mkdirSync(relDir, { recursive: true });
    const name = `ccrc-\x1b[31mred\rcover-${'x'.repeat(300 - 27)}.tar.gz`;
    expect(name.length).toBe(300);
    writeFileSync(join(relDir, 'SHA256SUMS'), `${'a'.repeat(64)}  ${name}\n`);
    const { r } = boundedRun(home, []);
    expect(r.code, r.stderr).toBe(1);
    const shown = name.slice(0, 40).replace(/[\x1b\r]/g, '?');
    const report = JSON.parse(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')) as Record<string, unknown>;
    const detail = String(report['detail']);
    for (const [where, text] of [['stderr', r.stderr], ['update.json\'s detail', detail]] as const) {
      expect(text, `${where} carries ESC`).not.toContain('\x1b');
      expect(text, `${where} carries CR`).not.toContain('\r');
      expect(text, where).toContain(`is 300 bytes or not printable ASCII, not a ccrc release's (starts: ${shown})`);
    }
    const die = r.stderr.split('\n').filter((l) => l.startsWith("ccrc: SHA256SUMS's tarball name is "));
    expect(die, r.stderr).toHaveLength(1);
    expect(die[0].length, die[0]).toBeLessThanOrEqual(200);
  });
  for (const [label, version] of [['100 000 characters', `v${'x'.repeat(100_000 - 1)}`],
    ['the combined worst shape at about 16 000 characters', worstShape(16_000)]] as const) {
    it(`an unsigned release whose build.json names a version of ${label}: the update dies at the read naming its length, every sentence within 200 characters, within 30 s (D-6751, fix round 5)`, () => {
      const home = freshUpdateBox('ccrc-update-bound-version-');
      plantOldBox(home, { version: 'v1.0.0' });
      const tree = stubTree(home, { version: 'v2.0.0' });
      rmSync(join(tree, 'MANIFEST'));
      writeFileSync(join(tree, 'build.json'), `${JSON.stringify({ sha: 'newsha0000000000000000000000000000000000', ref: 'release',
        builtAt: '2026-08-21T00:00:00Z', dirty: false, version })}\n`);
      writeManifest(tree);
      packRelease(home, tree, { tag: 'v2.0.0', latest: false, bundle: false });
      expectBounded(home, boundedRun(home, ['--to', 'v2.0.0', '--allow-unsigned']), 'build.json\'s version', version);
      expect(existsSync(join(home, 'staged-ccrc-argv')), 'the staged install ran').toBe(false);
    }, 150_000);
  }

  // D-6751 (fix round 5 part 2, R46): a value of 200 bytes or fewer used to pass the bound and still carry raw ESC, BEL, CR
  // or a C1 byte to the operator's terminal (the fetching line, the later dies). Each value must also be printable ASCII,
  // matched byte-wise under LC_ALL=C, and its length is counted in bytes the same way, whatever the caller's locale.
  const sumsName = (home: string, name: string | Buffer): void => {
    const relDir = join(home, 'releases', 'latest', 'download');
    mkdirSync(relDir, { recursive: true });
    writeFileSync(join(relDir, 'SHA256SUMS'), Buffer.concat([Buffer.from(`${'a'.repeat(64)}  `), Buffer.from(name), Buffer.from('\n')]));
  };
  const nameDie = (r: Result): string[] => r.stderr.split('\n').filter((l) => l.startsWith("ccrc: SHA256SUMS's tarball name is "));
  const reportRaw = (home: string): Buffer => readFileSync(join(home, '.ccrc', 'update.json'));
  // A C0 byte but the newline, DEL, a C1 character, or U+FFFD (what a raw byte of 0x80 or more decodes to when it is not UTF-8).
  const HOSTILE = /[\x00-\x09\x0b-\x1f\x7f-\x9f\ufffd]/;
  // Every way out a hostile byte could take: stderr, every fetching line on stdout, and update.json.
  const expectNoHostileByte = (home: string, r: Result): void => {
    expect(r.stderr, 'stderr').not.toMatch(HOSTILE);
    for (const l of r.stdout.split('\n').filter((x) => x.startsWith('update: fetching '))) expect(l, 'a fetching line').not.toMatch(HOSTILE);
    expect(reportRaw(home).toString('utf8'), 'update.json').not.toMatch(HOSTILE);
  };
  it('a 30-byte tarball name carrying an OSC 52 clipboard write: the update dies at the read, and no ESC or BEL reaches stderr, a fetching line or update.json (D-6751, R46)', () => {
    const home = freshUpdateBox('ccrc-update-bound-name-osc-');
    plantOldBox(home, { version: 'v1.0.0' });
    const name = 'ccrc-\x1b]52;c;SGVsbG8=\x07v1.tar.gz';
    expect(Buffer.byteLength(name)).toBe(30);
    sumsName(home, name);
    const { r } = boundedRun(home, []);
    expect(r.code, r.stderr).toBe(1);
    expect(nameDie(r), r.stderr).toEqual(["ccrc: SHA256SUMS's tarball name is 30 bytes or not printable ASCII, not a ccrc release's (starts: ccrc-?]52;c;SGVsbG8=?v1.tar.gz) — refusing; nothing on this box was changed"]);
    expectNoHostileByte(home, r);
    expect(localUrls(home), 'only SHA256SUMS was fetched').toEqual([`local://${home}/releases/latest/download/SHA256SUMS`]);
  });
  /** The UTF-8 locale this host's bash really runs under: `C.UTF-8` on Linux runners, `en_US.UTF-8` on macOS. A locale
   *  that is not installed falls back to C silently and would hollow the UTF-8 arm, so the effect is measured, and a
   *  host with neither runs the arm under `C.UTF-8` and fails it rather than skipping (fix round 5's re-review, m2). */
  const UTF8 = ['C.UTF-8', 'en_US.UTF-8'].find((loc) => spawnSync(BASH, ['-c', `x=$'\\xc3\\xa9'; printf '%s' "\${#x}"`],
    { encoding: 'utf8', env: { LC_ALL: loc } }).stdout === '1') ?? 'C.UTF-8';
  for (const locale of [UTF8, 'C']) {
    it(`a tarball name with one byte 0x9b (a C1 CSI), the caller's locale ${locale}: the update dies at the read and the byte reaches no way out (D-6751, R46)`, () => {
      const home = freshUpdateBox('ccrc-update-bound-name-c1-');
      plantOldBox(home, { version: 'v1.0.0' });
      sumsName(home, Buffer.concat([Buffer.from('ccrc-'), Buffer.from([0x9b]), Buffer.from('2Jv1.tar.gz')]));
      const { r } = boundedRun(home, [], locale);
      expect(r.code, r.stderr).toBe(1);
      expect(nameDie(r), r.stderr).toEqual(["ccrc: SHA256SUMS's tarball name is 17 bytes or not printable ASCII, not a ccrc release's (starts: ccrc-?2Jv1.tar.gz) — refusing; nothing on this box was changed"]);
      expectNoHostileByte(home, r);
    });
  }
  it('a tarball name of exactly 200 bytes passes the bound, and one of 201 bytes dies at it (D-6751, R46)', () => {
    for (const [n, dies] of [[200, false], [201, true]] as const) {
      const home = freshUpdateBox(`ccrc-update-bound-name-edge-${n}-`);
      plantOldBox(home, { version: 'v1.0.0' });
      const name = `ccrc-${'x'.repeat(n - 12)}.tar.gz`;
      expect(name.length).toBe(n);
      sumsName(home, name);
      const { r } = boundedRun(home, []);
      expect(r.code, r.stderr).toBe(1);
      if (dies) {
        expect(nameDie(r), r.stderr).toEqual([`ccrc: SHA256SUMS's tarball name is 201 bytes or not printable ASCII, not a ccrc release's (starts: ${name.slice(0, 40)}) — refusing; nothing on this box was changed`]);
      } else {
        expect(nameDie(r), `${n} bytes: ${r.stderr}`).toEqual([]);
        // The fetching line names HOME as `~` (`_upd_redact`), so it is matched by its tail.
        const fetched = r.stdout.split('\n').filter((l) => l.startsWith('update: fetching ') && l.endsWith(`/releases/latest/download/${name} …`));
        expect(fetched, `it reached the tarball: ${r.stdout}`).toHaveLength(1);
        expect(r.stderr, 'and died fetching it').toContain(`ccrc: download failed: local://~/releases/latest/download/${name} `);
      }
    }
  });
  it('a tarball name of 201 bytes in 107 characters, the caller\'s locale UTF-8: the bound counts bytes and dies (D-6751, R46)', () => {
    const home = freshUpdateBox('ccrc-update-bound-name-mb-');
    plantOldBox(home, { version: 'v1.0.0' });
    const name = `ccrc-${'é'.repeat(94)}v.tar.gz`;
    expect([name.length, Buffer.byteLength(name)]).toEqual([107, 201]);
    sumsName(home, name);
    const { r } = boundedRun(home, [], UTF8);
    expect(r.code, r.stderr).toBe(1);
    expect(nameDie(r), r.stderr).toEqual([`ccrc: SHA256SUMS's tarball name is 201 bytes or not printable ASCII, not a ccrc release's (starts: ccrc-${'?'.repeat(35)}) — refusing; nothing on this box was changed`]);
  });
  // The same bound on build.json's version (the unsigned path). A C0 byte such as ESC is refused before it, by
  // `_box_build_fields` (its die names no value); a C1 byte is refused there only under a UTF-8 locale, so under C it
  // reaches this bound (review 926's m7). The edge and the byte count are pinned the same way as the name's.
  const unsignedVersion = (prefix: string, version: string, locale?: string): { home: string; r: Result } => {
    const home = freshUpdateBox(prefix);
    plantOldBox(home, { version: 'v1.0.0' });
    const tree = stubTree(home, { version: 'v2.0.0' });
    rmSync(join(tree, 'MANIFEST'));
    writeFileSync(join(tree, 'build.json'), `${JSON.stringify({ sha: 'newsha0000000000000000000000000000000000', ref: 'release',
      builtAt: '2026-08-21T00:00:00Z', dirty: false, version })}\n`);
    writeManifest(tree);
    packRelease(home, tree, { tag: 'v2.0.0', latest: false, bundle: false });
    const { r } = boundedRun(home, ['--to', 'v2.0.0', '--allow-unsigned'], locale);
    expect(r.code, r.stderr).toBe(1);
    expect(existsSync(join(home, 'staged-ccrc-argv')), 'the staged install ran').toBe(false);
    return { home, r };
  };
  const versionDie = (r: Result): string[] => r.stderr.split('\n').filter((l) => l.startsWith("ccrc: build.json's version is "));
  const MALFORMED = 'ccrc: the extracted tree\'s build.json is unreadable or malformed (rc 6)';
  it('an unsigned release whose build.json version carries an OSC 52 write: the update dies, and no ESC or BEL reaches any way out (D-6751, R46)', () => {
    const { home, r } = unsignedVersion('ccrc-update-bound-version-osc-', 'v\x1b]52;c;SGVsbG8=\x07');
    expect(r.stderr.split('\n').filter((l) => l.startsWith(MALFORMED)), r.stderr).toHaveLength(1);
    expectNoHostileByte(home, r);
  }, 150_000);
  for (const locale of [UTF8, 'C']) {
    it(`an unsigned release whose build.json version carries U+009B (a C1 CSI), the caller's locale ${locale}: the update dies, and the byte reaches no way out (D-6751, R46)`, () => {
      const { home, r } = unsignedVersion('ccrc-update-bound-version-c1-', 'v2.0.0\u009b2J', locale);
      if (locale === 'C') {
        expect(versionDie(r), r.stderr).toEqual(["ccrc: build.json's version is 10 bytes or not printable ASCII, not a ccrc release's (starts: v2.0.0??2J) — refusing; nothing outside the staging dir was touched"]);
      } else {
        expect(r.stderr.split('\n').filter((l) => l.startsWith(MALFORMED)), r.stderr).toHaveLength(1);
      }
      expectNoHostileByte(home, r);
    }, 150_000);
  }
  it('an unsigned release whose build.json version is exactly 200 bytes passes the bound, and one of 201 bytes dies at it (D-6751, R46)', () => {
    for (const [n, dies] of [[200, false], [201, true]] as const) {
      const version = `v${'x'.repeat(n - 1)}`;
      const { r } = unsignedVersion(`ccrc-update-bound-version-edge-${n}-`, version);
      if (dies) {
        expect(versionDie(r), r.stderr).toEqual([`ccrc: build.json's version is 201 bytes or not printable ASCII, not a ccrc release's (starts: ${version.slice(0, 40)}) — refusing; nothing outside the staging dir was touched`]);
      } else {
        expect(versionDie(r), `${n} bytes: ${r.stderr}`).toEqual([]);
        expect(r.stderr, 'it reached the version binding').toContain(`build.json says version '${version}' but the release was resolved as v2.0.0`);
      }
    }
  }, 300_000);
  it('an unsigned release whose build.json version is 201 bytes in 101 characters, the caller\'s locale UTF-8: the bound counts bytes and dies (D-6751, R46)', () => {
    const version = `v${'é'.repeat(100)}`;
    expect([version.length, Buffer.byteLength(version)]).toEqual([101, 201]);
    const { r } = unsignedVersion('ccrc-update-bound-version-mb-', version, UTF8);
    expect(versionDie(r), r.stderr).toEqual([`ccrc: build.json's version is 201 bytes or not printable ASCII, not a ccrc release's (starts: v${'?'.repeat(39)}) — refusing; nothing outside the staging dir was touched`]);
  }, 150_000);

  // Fix round 1 item 11 / review 155 C17: the floor death's update.json
  // DETAIL keeps its VERDICT (D-3249) even with a HOME long enough that the
  // RAW path alone would have exceeded `_upd_json_str`'s 200-character cut
  // — this is what the review originally measured broken ("<absolute
  // fixture home>/.ccrc/floor is unreada", the verdict word cut off, only
  // the path surviving). Harness-extracted (`_upd_redact`, `_ccrc_die`,
  // `_ver_newer`, `_upd_floor_check`, and `_upd_json_str` itself — the
  // function that actually performs the 200-character cut, never stubbed —
  // so this measures the REAL cut applied to the REAL redacted detail, the
  // same idiom the die-hook test above uses for `_ccrc_die` alone.
  it('a floor death\'s report detail keeps its verdict at the front even with a very long HOME (fix round 1 item 11 / review 155 C17)', () => {
    const src = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    const pick = (re: RegExp, what: string): string => {
      const m = re.exec(src);
      expect(m, `ccd/ccrc has no ${what}`).not.toBeNull();
      return m![0];
    };
    const detailOut = join(mkTmp('ccrc-update-floor-longhome-out-'), 'detail.json');
    const harness = [
      'set -uo pipefail',
      pick(/^PROG=.*$/m, 'PROG='),
      pick(/^_upd_redact\(\) \{[\s\S]*?\n\}$/m, '_upd_redact'),
      pick(/^_ccrc_die\(\) \{.*\}$/m, '_ccrc_die'),
      pick(/^_ver_newer\(\) \{[\s\S]*?\n\}$/m, '_ver_newer'),
      pick(/^_upd_floor_check\(\) \{[\s\S]*?\n\}$/m, '_upd_floor_check'),
      // `_upd_json_str` is `_upd_json_str() ( … )`, a subshell, not a `{…}`
      // block — a different close character to extract by.
      pick(/^_upd_json_str\(\) \([\s\S]*?\n\)$/m, '_upd_json_str'),
      // The REAL `_upd_phase` writes several other fields this harness has
      // no use for; only its DETAIL argument, run through the REAL
      // `_upd_json_str`, is what this pin measures.
      `_upd_phase() { _upd_json_str "\$2" > ${JSON.stringify(detailOut)}; }`,
      'UPD_FAIL_PREFIX=""',
      'UPD_REPORTING=1',
      // Batch E review fix round 1, X1: `_ccrc_die` redacts only while
      // `UPD_REDACT_ACTIVE=1`, set at the top of `cmd_update` (and its
      // update-family siblings) in the shipped file — this harness calls
      // `_upd_floor_check` directly, standing in for code that runs INSIDE
      // `cmd_update`, so it sets the same flag `cmd_update`'s own preamble
      // would have set by the time this helper runs.
      'UPD_REDACT_ACTIVE=1',
      'BOX_FLOOR_FILE="$HOME/.ccrc/floor"',
      '_upd_floor_check --to 0 cli',
    ].join('\n');
    // 180 'x's: "unreadable: " (12) + this path + "/.ccrc/floor" (12) would
    // be well over 200 raw; redacted to `~/.ccrc/floor` it is nowhere close.
    const longHome = join(mkTmp('ccrc-update-floor-longhome-'), 'x'.repeat(180));
    mkdirSync(join(longHome, '.ccrc'), { recursive: true });
    writeFileSync(join(longHome, '.ccrc', 'floor'), 'v9.9.9\n');
    chmodSync(join(longHome, '.ccrc', 'floor'), 0o000);
    let r: Result;
    try {
      const p = spawnSync(BASH, ['-c', harness],
        { env: { HOME: longHome, UPD_VERSION: 'v2.0.0' }, encoding: 'utf8' });
      r = { code: p.status ?? -1, stdout: p.stdout ?? '', stderr: p.stderr ?? '' };
    } finally {
      chmodSync(join(longHome, '.ccrc', 'floor'), 0o644);
    }
    expect(r.code, r.stderr).toBe(1);
    const detailJson = readFileSync(detailOut, 'utf8');
    expect(detailJson.length, detailJson).toBeLessThanOrEqual(202); // 200 chars + the two quotes
    const detail = JSON.parse(detailJson) as string;
    expect(detail).toMatch(/^unreadable: ~\/\.ccrc\/floor/);
    expect(detail).not.toContain(longHome);
  });

  // Review fix round 1, M1: `_upd_phase` ITSELF, called directly (never
  // through `_ccrc_die`, and with a detail this harness builds RAW — no
  // hand-redaction at any construction site, unlike every existing gate-
  // failure caller). Every current caller already redacts before calling
  // `_upd_phase` (at `$why`/`$gate_fail`'s own construction), so THIS is
  // the pin that isolates `_upd_phase`'s OWN choke point: deleting its
  // `detail="$(_upd_redact "$detail")"` line does not red any existing
  // integration pin (measured on a scratch tree), because every existing
  // caller's detail already arrives clean. This one proves the choke point
  // itself, independent of any caller's own hand-redaction.
  it('_upd_phase redacts its OWN detail argument, independent of any caller (review fix round 1 M1)', () => {
    const src = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    const pick = (re: RegExp, what: string): string => {
      const m = re.exec(src);
      expect(m, `ccd/ccrc has no ${what}`).not.toBeNull();
      return m![0];
    };
    const home = mkTmp('ccrc-update-phase-choke-');
    const jsonPath = join(home, '.ccrc', 'update.json');
    const harness = [
      'set -uo pipefail',
      pick(/^_upd_redact\(\) \{[\s\S]*?\n\}$/m, '_upd_redact'),
      pick(/^_upd_json_str\(\) \([\s\S]*?\n\)$/m, '_upd_json_str'),
      // W6 Task 8A: `_upd_phase` guards its temp file on the shared EXIT chain.
      pick(/^_EXIT_CHAIN=\(\)$/m, '_EXIT_CHAIN'),
      pick(/^_exit_run\(\) \{[\s\S]*?\n\}$/m, '_exit_run'),
      pick(/^_exit_add\(\) \{[\s\S]*?\n\}$/m, '_exit_add'),
      pick(/^_tmp_guard\(\) \{.*\}$/m, '_tmp_guard'),
      pick(/^_upd_phase\(\) \{[\s\S]*?\n\}$/m, '_upd_phase'),
      `BOX_UPDATE_JSON=${JSON.stringify(jsonPath)}`,
      'UPD_REPORT_TARGET=""', 'UPD_REPORT_STARTED=""', 'UPD_FROM=cli', 'UPD_SWEEP_WORD=""',
      // The raw detail: never wrapped in _upd_redact by this harness — if
      // `_upd_phase` did not redact it either, the home would land as-is.
      `_upd_phase failed "unreadable: $HOME/.ccrc/ccrc.env is not a regular file"`,
    ].join('\n');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    const r = spawnSync(BASH, ['-c', harness], { env: { HOME: home }, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const rep = JSON.parse(readFileSync(jsonPath, 'utf8')) as Record<string, unknown>;
    expect(String(rep['detail']), JSON.stringify(rep)).not.toContain(home);
    expect(rep['detail']).toBe('unreadable: ~/.ccrc/ccrc.env is not a regular file');
  });

  // Wave 17 (D-5314): `_upd_json_str` cuts a value at 200 characters, which would split the last unit id into a fragment
  // the doctor reads as a unit of its own. `_upd_sweep_set_down` therefore appends WHOLE ids only while the word stays
  // within 200, count first. Run through the real `_upd_phase`, so the STORED `sweep` is what is read. Without the cap
  // line twelve of these names give 264 characters and a stored last token `a` (measured).
  it('_upd_sweep_set_down keeps the recorded word within 200 characters and cuts only between WHOLE ids, the count first (wave 17, D-5314)', () => {
    const src = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    const pick = (re: RegExp, what: string): string => {
      const m = re.exec(src);
      expect(m, `ccd/ccrc has no ${what}`).not.toBeNull();
      return m![0];
    };
    const home = mkTmp('ccrc-update-sweep-word-cap-');
    const jsonPath = join(home, '.ccrc', 'update.json');
    const ids = Array.from({ length: 12 }, (_, i) => `acct-${i + 1}-project-alpha`);
    const harness = [
      'set -uo pipefail',
      pick(/^_upd_redact\(\) \{[\s\S]*?\n\}$/m, '_upd_redact'),
      pick(/^_upd_json_str\(\) \([\s\S]*?\n\)$/m, '_upd_json_str'),
      pick(/^_EXIT_CHAIN=\(\)$/m, '_EXIT_CHAIN'),
      pick(/^_exit_run\(\) \{[\s\S]*?\n\}$/m, '_exit_run'),
      pick(/^_exit_add\(\) \{[\s\S]*?\n\}$/m, '_exit_add'),
      pick(/^_tmp_guard\(\) \{.*\}$/m, '_tmp_guard'),
      pick(/^_upd_phase\(\) \{[\s\S]*?\n\}$/m, '_upd_phase'),
      pick(/^_upd_sweep_set_down\(\) \{[\s\S]*?\n\}$/m, '_upd_sweep_set_down'),
      `BOX_UPDATE_JSON=${JSON.stringify(jsonPath)}`,
      'UPD_REPORT_TARGET=""', 'UPD_REPORT_STARTED=""', 'UPD_FROM=cli', 'UPD_SWEEP_WORD=""',
      `_upd_sweep_set_down ${ids.map((id) => `claude-session@${id}.service`).join(' ')}`,
      '_upd_phase done',
    ].join('\n');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    const r = spawnSync(BASH, ['-c', harness], { env: { HOME: home }, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const word = String((JSON.parse(readFileSync(jsonPath, 'utf8')) as Record<string, unknown>)['sweep']);
    expect(word.startsWith('down: 12: '), word).toBe(true);
    expect(word.length, word).toBeLessThanOrEqual(200);
    const named = word.slice('down: 12: '.length).split(' ');
    expect(named.length, 'a long list loses names, never the whole list').toBeGreaterThan(0);
    expect(named.length, 'twelve of these names do not fit in 200 characters').toBeLessThan(12);
    // Every name after the count is an input id, whole, and in input order from the first.
    expect(named, word).toEqual(ids.slice(0, named.length));
  });

  // Wave 9 M1-M3 (D-3808): five harnesses run functions extracted from ccd/ccrc
  // under a PATH-less env, and a bare `bash` under that env resolves macOS's
  // /bin/bash 3.2 (no BASHPID, `\/` in a ${//} replacement). They spawn the
  // family's resolved BASH instead. This case reads the whole family of files
  // (the fixture and every part, D-6767), and the
  // needle is built from two halves so the case never matches its own text.
  it('no bare-`bash` spawn in this file hands its child an env — a PATH-less env resolves macOS\'s /bin/bash 3.2 (wave 9 M1–M3)', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const family = readdirSync(dir).filter((f) => /^ccrc-update(Fixture\.ts|-[a-z-]+\.test\.ts)$/.test(f)).sort();
    const NEEDLE = ['spawnSync(', "'bash'"].join('');
    const hits: string[] = [];
    for (const file of family) {
      const text = readFileSync(join(dir, file), 'utf8');
      for (let at = text.indexOf(NEEDLE); at !== -1; at = text.indexOf(NEEDLE, at + 1)) {
        hits.push(`${file}@${at}`);
        const end = text.indexOf('encoding:', at);
        const slice = text.slice(at, end === -1 ? text.length : end);
        expect(slice.includes('env:'),
          `${file} spawns bare bash with an env at offset ${at} — use BASH`).toBe(false);
      }
    }
    // The six env-less sites: the realPath and REAL_PYTHON3 probes, writeManifest,
    // the SHA256SUMS writer, and the two locale probes.
    expect(hits.length,
      `the ccrc-update files have ${hits.length} bare-bash spawns, expected exactly 6 — a new one must use BASH or be counted here`)
      .toBe(6);
  });
});

describe('ccrc update: one update at a time (the lock)', () => {
  const holders: ChildProcess[] = [];
  const lingerers: string[] = [];   // pid files a lingering fixture process wrote
  afterEach(() => {
    for (const h of holders.splice(0)) h.kill('SIGKILL');
    for (const f of lingerers.splice(0)) {
      if (!existsSync(f)) continue;
      // Guarded: `process.kill(0, …)` signals this whole process GROUP — the
      // test runner included — so an empty or garbled pid file kills nothing.
      const pid = Number(readFileSync(f, 'utf8').trim());
      if (!Number.isInteger(pid) || pid <= 1) continue;
      try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  });
  const lockPath = (home: string): string => join(home, '.ccrc', 'update.lock');
  /** A FRESH open and a non-blocking flock — the probe's own measurement. */
  const lockFree = (home: string): boolean =>
    spawnSync(BASH, ['-c', 'exec 9>>"$1" && flock -n 9', '_', lockPath(home)]).status === 0;
  const waitUntil = (cond: () => boolean, what: string): void => {
    const t0 = Date.now();
    while (!cond()) {
      if (Date.now() - t0 > 10_000) throw new Error(`timed out waiting for ${what}`);
      spawnSync('sleep', ['0.05']);
    }
  };
  /** A real holder: ONE process takes flock on the lock file and then
   *  becomes `sleep` (exec keeps the pid and the descriptor), so the pid
   *  killed is the pid holding it. Returns once a fresh probe fails. */
  const holdLock = (home: string): ChildProcess => {
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    const h = spawn(BASH, ['-c', 'exec 9>>"$1" && flock 9 && exec sleep 30', '_', lockPath(home)], { stdio: 'ignore' });
    holders.push(h);
    waitUntil(() => !lockFree(home), 'the fixture holder to take the lock');
    return h;
  };
  // A holder's report in the writer's own shape: unix SECONDS (rulings R1,
  // R14 — Task 1's `REPORT_TIME`), the seven keys in order.
  const HELD_REPORT = '{"target":"v9.9.9","phase":"installing","startedAt":1758585600,'
    + '"updatedAt":1758585601,"detail":null,"from":"pwa","pid":4242}\n';
  const stubBox = (prefix: string): string => {
    const home = freshUpdateBox(prefix);
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    return home;
  };

  it('a second run while the lock is held exits 1 naming the holder from update.json and touches NOTHING — update.json included; with the holder gone the identical run proceeds (§18 "one update at a time")', () => {
    const home = stubBox('ccrc-update-lock-held-');
    writeFileSync(join(home, '.ccrc', 'update.json'), HELD_REPORT);
    const h = holdLock(home);
    let r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: update: another update holds ~\/\.ccrc\/update\.lock \(pid 4242, target v9\.9\.9\)$/m);
    // A refused run reports nothing: the holder's report is the holder's.
    expect(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')).toBe(HELD_REPORT);
    expect(existsSync(join(home, 'curl-argv')), 'a fetch ran under someone else\'s lock').toBe(false);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
    // THE CONTROL: the same box, the same argv, the holder gone.
    h.kill('SIGKILL');
    waitUntil(() => lockFree(home), 'the killed holder to let go');
    r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(lastReport(home)['phase']).toBe('done');
  });

  it('the holder reads "unknown" for each field that is absent, not JSON, or of the wrong type or shape — each field judged on its own, nothing raw from the file printed', () => {
    const cases: Array<[string, string | null, string]> = [
      ['absent', null, 'pid unknown, target unknown'],
      ['not-json', 'garbage {\n', 'pid unknown, target unknown'],
      ['bad-fields', '{"pid":"4242; echo pwned","target":"latest; pwned"}\n', 'pid unknown, target unknown'],
      // The field-alignment pins: a split that ran BEFORE the fields were
      // typed let one field's value land in the other's slot.
      ['pid-null', '{"pid":null,"target":"v9.9.9"}\n', 'pid unknown, target v9.9.9'],
      ['pid-string', '{"pid":"4242 v1.2.3","target":"x"}\n', 'pid unknown, target unknown'],
      ['target-newline', '{"pid":4242,"target":"v1.0.0\\nv2"}\n', 'pid 4242, target unknown'],
    ];
    for (const [name, body, holder] of cases) {
      const home = freshUpdateBox(`ccrc-update-lock-holder-${name}-`);
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      if (body !== null) writeFileSync(join(home, '.ccrc', 'update.json'), body);
      holdLock(home);
      const r = runUpdate(home);
      expect(r.code, name).toBe(1);
      expect(r.stderr.split('\n'), name)
        .toContain(`ccrc: update: another update holds ~/.ccrc/update.lock (${holder})`);
      expect(r.stderr, name).not.toMatch(/pwned/);
    }
  });

  // Fix round 1 item 23-C21: `_upd_lock_holder`'s FIFO guard (now
  // `_upd_report_readable`, shared with item 9) ships with no test that
  // goes red when it is deleted — with the guard gone, a busy-lock refusal
  // would hang reading a FIFO instead of printing "pid unknown, target
  // unknown" promptly. Bounded by `runBounded` (GNU `timeout -k`) because
  // the hang would be inside jq, a grandchild of the update process.
  it.skipIf(UPD_DEADLINE_BIN === null)(
    'a FIFO at update.json with the lock held: exit 1 promptly with "pid unknown, target unknown", never blocked reading it (fix round 1 item 23-C21 / review 155 C21)', () => {
      const home = freshUpdateBox('ccrc-update-lock-holder-fifo-');
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      expect(spawnSync('mkfifo', [join(home, '.ccrc', 'update.json')]).status, 'mkfifo').toBe(0);
      holdLock(home);
      const env = { ...updateEnv(home), CCRC_RELEASE_BASE_URL: `local://${home}/releases` };
      replantDoctorStubs(home);
      const r = runBounded([BASH, join(REPO, 'ccd', 'ccrc'), 'update'], env, 5000);
      expect(r.code, r.stderr).toBe(1);
      expect(r.stderr).toMatch(/^ccrc: update: another update holds ~\/\.ccrc\/update\.lock \(pid unknown, target unknown\)$/m);
    }, 15000);

  it.skipIf(process.getuid?.() === 0)('a lock that cannot be MEASURED — the file there, not openable — is neither held nor free: the restore child refuses naming probe rc 3, and a plain run refuses to open it (ruling R16)', () => {
    // Plan D-3250: rc 3 folded into "held" would exempt
    // the child on no evidence. Skipped as root, the suite's idiom for a
    // mode-000 fixture: root opens it.
    const home = stubBox('ccrc-update-lock-unmeasured-');
    writeFileSync(lockPath(home), '');
    chmodSync(lockPath(home), 0o000);
    let r = runUpdate(home, [], { CCRC_UPDATE_LOCK_HELD: String(process.pid) });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr.split('\n')).toContain(`ccrc: update: CCRC_UPDATE_LOCK_HELD names this run's parent (pid ${process.pid}) but ~/.ccrc/update.lock could not be measured (probe rc 3) — refusing; a restore child runs only under a lock it can see`);
    expect(existsSync(join(home, 'curl-argv')), 'an unmeasured lock exempted the run').toBe(false);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
    // THE CONTROL: no marker, the same file — acquisition's own open fails,
    // by its own sentence, and nothing is fetched either.
    r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: cannot open ~\/\.ccrc\/update\.lock — nothing on this box was changed$/m);
    expect(existsSync(join(home, 'curl-argv'))).toBe(false);
  });

  it('a restore child — CCRC_UPDATE_LOCK_HELD naming its parent, the lock measured HELD — runs with no second acquire, and the marker reaches no grandchild', () => {
    const home = stubBox('ccrc-update-lock-child-');
    holdLock(home);   // the parent's descriptor, as the probe sees it: somebody holds the lock
    // spawnSync runs bash directly (no shell between), so the run's $PPID IS this process.
    const r = runUpdate(home, [], { CCRC_UPDATE_LOCK_HELD: String(process.pid) });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stderr).not.toMatch(/another update holds|CCRC_UPDATE_LOCK_HELD/);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(true);
    expect(readFileSync(join(home, 'staged-ccrc-lockenv'), 'utf8')).toBe('unset\n');
  });

  it('the same marker with NOBODY holding the lock is REFUSED — the env alone never exempts a run (§18 "the lock exemption is measured")', () => {
    for (const planted of [false, true]) {   // no lock file at all; a lock file nobody holds
      const home = stubBox(`ccrc-update-lock-forged-${planted ? 'file' : 'nofile'}-`);
      if (planted) writeFileSync(lockPath(home), '');
      const r = runUpdate(home, [], { CCRC_UPDATE_LOCK_HELD: String(process.pid) });
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(new RegExp(`^ccrc: update: CCRC_UPDATE_LOCK_HELD names this run's parent \\(pid ${process.pid}\\) but nobody holds ~/\\.ccrc/update\\.lock — refusing; a restore child runs only under its parent's lock$`, 'm'));
      expect(existsSync(join(home, 'curl-argv')), 'a forged marker reached the fetch').toBe(false);
      expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
      expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
    }
  });

  it('a marker naming ANOTHER pid is no exemption: with no holder the run acquires normally, with one it is refused like any third party', () => {
    const free = stubBox('ccrc-update-lock-otherpid-free-');
    let r = runUpdate(free, [], { CCRC_UPDATE_LOCK_HELD: '1' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readFileSync(join(free, 'staged-ccrc-lockenv'), 'utf8')).toBe('unset\n');
    const busy = stubBox('ccrc-update-lock-otherpid-busy-');
    writeFileSync(join(busy, '.ccrc', 'update.json'), HELD_REPORT);
    holdLock(busy);
    r = runUpdate(busy, [], { CCRC_UPDATE_LOCK_HELD: '1' });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: update: another update holds ~\/\.ccrc\/update\.lock \(pid 4242, target v9\.9\.9\)$/m);
  });

  it('no flock on PATH is refused by name before anything else runs — macOS\'s sentence names brew', () => {
    const home = freshUpdateBox('ccrc-update-lock-noflock-');
    const r = runUpdate(home, [], { PATH: pathWithoutFlock(home) });
    expect(r.code).toBe(1);
    if (process.platform === 'darwin') {
      expect(r.stderr).toMatch(/^ccrc: flock is required by 'ccrc update' — it serialises updates and refuses rather than racing — and macOS does not ship it\. Install it: brew install flock\. Nothing on this box was changed$/m);
    } else {
      expect(r.stderr).toMatch(/^ccrc: flock \(util-linux\) is required by 'ccrc update' — it serialises updates and refuses rather than racing; nothing on this box was changed$/m);
    }
    expect(r.stderr).not.toMatch(/curl is required/);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
  });

  it('a flock that could not RUN at all (e.g. rc 65, "Bad file descriptor") is refused as unlockable, never reported as a holder (fix round 1, D-3274)', () => {
    const home = freshUpdateBox('ccrc-update-lock-flockfail-');
    const bin = join(home, '.local', 'bin');
    mkdirSync(bin, { recursive: true });
    // First on PATH (ahead of the real flock `updateEnv`'s harness leaves
    // reachable): a flock that always fails for a reason that is not
    // contention — rc 1 is reserved for "someone else holds it".
    writeFileSync(join(bin, 'flock'), '#!/bin/sh\nexit 65\n', { mode: 0o755 });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: update: cannot lock ~\/\.ccrc\/update\.lock \(flock rc 65\) — this is not another update holding it; nothing on this box was changed$/m);
    expect(r.stderr).not.toMatch(/another update holds/);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
  });

  it('the staged spine inherits no lock descriptor: a process it leaves behind does not pin the lock once the run has exited', () => {
    const home = stubBox('ccrc-update-lock-spine-linger-');
    writeFileSync(join(home, 'fixture-spine-linger'), '');
    lingerers.push(join(home, 'spine-linger-pid'));
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(existsSync(join(home, 'spine-linger-pid')), 'the spine never lingered — the absence below would be vacuous').toBe(true);
    // THE DISCRIMINATOR: a run that takes the lock and then dies at the
    // preflight. Lock free → its own jq sentence; lock pinned → the lock's.
    const second = runUpdate(home, [], { PATH: pathWithoutJq(home) });
    expect(second.code).toBe(1);
    expect(second.stderr).not.toMatch(/another update holds/);
    expect(second.stderr).toMatch(/^ccrc: jq is required by 'ccrc update' but is not on PATH/m);
  });

  itLinux('the lock closes BEFORE the sweep: a restart that leaves a process behind does not pin it (§18 "the lock closes before the sweep")', () => {
    const home = stubBox('ccrc-update-lock-sweep-linger-');
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    writeFileSync(join(home, 'fixture-sweep-active'), UNIT_LINES);
    writeFileSync(join(home, 'fixture-sweep-linger'), '');
    lingerers.push(join(home, 'sweep-linger-pid'));
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readFileSync(join(home, 'systemctl-calls'), 'utf8')).toMatch(/^--user try-restart claude-session@\*$/m);
    expect(existsSync(join(home, 'sweep-linger-pid')), 'the sweep never lingered — the absence below would be vacuous').toBe(true);
    const second = runUpdate(home, [], { PATH: pathWithoutJq(home) });
    expect(second.code).toBe(1);
    expect(second.stderr).not.toMatch(/another update holds/);
    expect(second.stderr).toMatch(/^ccrc: jq is required by 'ccrc update' but is not on PATH/m);
  });
});

describe('ccrc update --detach (design §10; W4 Task 3)', () => {
  const lockPath = (home: string): string => join(home, '.ccrc', 'update.lock');
  const report = (home: string): Record<string, unknown> =>
    JSON.parse(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')) as Record<string, unknown>;
  const detachArgv = (home: string): string[] => (existsSync(join(home, 'systemd-run-argv'))
    ? readFileSync(join(home, 'systemd-run-argv'), 'utf8').split('\n').filter((l) => l !== '')
    : []);
  /** A REAL holder of ~/.ccrc/update.lock — `flock <lock> sleep 30` in a
   *  process group of its own — returned only once a fresh `flock -n` from
   *  here FAILS, so "held" is measured, never assumed from the spawn. */
  const holdLock = (home: string): ChildProcess => {
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    const p = spawn('flock', [lockPath(home), 'sleep', '30'], { stdio: 'ignore', detached: true });
    for (let i = 0; i < 100; i++) {
      if (spawnSync('flock', ['-n', lockPath(home), 'true']).status === 1) return p;
      spawnSync('sleep', ['0.05']);
    }
    try { process.kill(-p.pid!, 'SIGKILL'); } catch { /* already gone */ }
    throw new Error('the fixture holder never took ~/.ccrc/update.lock');
  };
  const release = (p: ChildProcess): void => {
    try { process.kill(-p.pid!, 'SIGKILL'); } catch { /* already gone */ }
  };
  const detachedBox = (prefix: string): string => {
    const home = freshUpdateBox(prefix);
    plantOldBox(home, { version: 'v1.0.0' });
    // A release the parent COULD fetch — so "nothing was fetched" below is a
    // measurement of the parent's restraint, not of an empty URL space.
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    return home;
  };

  itLinux('the re-exec goes through _svc_run_detached with the ABSOLUTE launcher and the spec argv, through the D-3282 PATH-prepend wrapper, writes queued, and returns 0 having done none of the work (§18 "--detach escapes the cgroup"; fix round 1 item 19 / review 155 C30)', () => {
    const home = detachedBox('ccrc-update-detach-');
    const t0 = Date.now();
    const r = runUpdate(home, ['--detach', '--to', 'v2.0.0']);
    const elapsed = Date.now() - t0;
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(elapsed, 'the parent waited on the run it detached').toBeLessThan(10_000);
    expect(detachArgv(home)).toEqual([
      '--user --collect --quiet /bin/sh -c PATH="$HOME/.local/bin:$PATH" exec "$HOME/.local/bin/ccrc" "$@" '
      + 'ccrc-detach update --to v2.0.0 --from cli',
    ]);
    expect(r.stdout).toMatch(/^update: detached — 'update --to v2\.0\.0' runs as a transient systemd --user unit; its progress is ~\/\.ccrc\/update\.json$/m);
    const rep = report(home);
    expect(rep).toMatchObject({ target: 'v2.0.0', phase: 'queued', detail: null, from: 'cli' });
    // Unix SECONDS (ruling R14), read through Task 1's file-scope REPORT_TIME,
    // never a second hand-written unit here.
    expect(String(rep['startedAt'])).toMatch(REPORT_TIME);
    expect(String(rep['updatedAt'])).toMatch(REPORT_TIME);
    expect(typeof rep['pid']).toBe('number');
    // The parent did NONE of the update's work — no fetch, no backup, no spine.
    expect(existsSync(join(home, 'curl-argv')), 'the parent fetched').toBe(false);
    expect(existsSync(join(home, 'ccrc-backups')), 'the parent backed up').toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv')), 'the parent installed').toBe(false);
  });

  // §16's first W4 fixture: "kills the parent after `queued` and asserts the
  // grandchild finishes". The parent is a process-group leader. Once the
  // detached run is parked mid-install, the WHOLE group is killed, which is
  // what a unit restart does to every process left in the unit's cgroup. A
  // run that escaped (setsid here, a transient unit on a real box) finishes.
  // A run that stayed in the group (`nohup … &`, the mutation) dies parked
  // and never writes `done`.
  itLinux('a parent whose whole process group is killed after queued leaves the detached run to finish — done, from another pid, the lock free after it (§16 the parent-kill fixture; §18 "--detach escapes the cgroup")', async () => {
    const home = detachedBox('ccrc-update-detach-parentkill-');
    writeFileSync(join(home, 'fixture-systemd-run-exec'), '');
    writeFileSync(join(home, 'fixture-install-wait'), '');
    // The absolute launcher in the argv is the checkout's ccrc, the code under test.
    writeFileSync(join(home, '.local', 'bin', 'ccrc'),
      `#!/bin/sh\nexec '${BASH}' '${join(REPO, 'ccd', 'ccrc')}' "$@"\n`, { mode: 0o755 });
    const pause = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));
    mkdirSync(join(home, 'tmp'), { recursive: true });
    const env = {
      ...updateEnv(home), TMPDIR: join(home, 'tmp'), CCRC_RELEASE_BASE_URL: `local://${home}/releases`,
    };
    replantDoctorStubs(home);
    const parent = spawn(BASH, [join(REPO, 'ccd', 'ccrc'), 'update', '--detach', '--to', 'v2.0.0'],
      { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    parent.stdout!.on('data', (b: Buffer) => { out += b.toString(); });
    parent.stderr!.on('data', (b: Buffer) => { err += b.toString(); });
    const parentCode = new Promise<number>((res) => parent.on('close', (c) => res(c ?? -1)));
    const detachedLog = (): string => (existsSync(join(home, 'detached.log'))
      ? readFileSync(join(home, 'detached.log'), 'utf8') : '(no detached.log)');
    let final: Record<string, unknown> = {};
    try {
      const code = await Promise.race([parentCode, pause(15_000).then(() => -2)]);
      expect(code, `the parent did not return on its own\nstderr: ${err}\nstdout: ${out}`).toBe(0);
      expect(out).toMatch(/^update: detached — 'update --to v2\.0\.0' runs as a transient systemd --user unit; its progress is ~\/\.ccrc\/update\.json$/m);
      // Parked: the staged spine has recorded its argv and is waiting for the go file.
      for (let until = Date.now() + 15_000; Date.now() < until && !existsSync(join(home, 'staged-ccrc-argv'));) await pause(50);
      expect(existsSync(join(home, 'staged-ccrc-argv')), `the detached run never reached its install\n${detachedLog()}`).toBe(true);
      const parked = report(home);
      expect(parked['phase']).toBe('installing');
      // CONTROL: the run is alive at the kill. A `done` below then means it
      // survived, not that it had already finished before the kill.
      expect(() => process.kill(Number(parked['pid']), 0), 'the run was gone before the kill — the pin below would be vacuous').not.toThrow();
      // THE KILL: every process still in the parent's group, the parent's own
      // pid as pgid. ESRCH is the escaped case, an empty group.
      try { process.kill(-parent.pid!, 'SIGKILL'); } catch { /* an empty group: nothing stayed behind */ }
      await pause(200);
      writeFileSync(join(home, 'fixture-install-go'), '');
      for (let until = Date.now() + 20_000; Date.now() < until;) {
        try { final = report(home); } catch { final = {}; }
        if (final['phase'] === 'done' || final['phase'] === 'failed') break;
        await pause(50);
      }
    } finally {
      writeFileSync(join(home, 'fixture-install-go'), '');
      try { process.kill(-parent.pid!, 'SIGKILL'); } catch { /* already gone */ }
    }
    expect(final, `the detached run did not finish after its parent's group was killed\n${detachedLog()}`)
      .toMatchObject({ phase: 'done', target: 'v2.0.0', detail: null, from: 'cli' });
    const seq = reportWrites(home);
    expect(seq.slice(0, 2).map((w) => w['phase'])).toEqual(['queued', 'resolving']);
    expect(seq.map((w) => w['phase'])).toContain('installing');
    expect(seq[0]!['pid'], 'queued is the parent\'s write').toBe(parent.pid);
    const runPids = new Set(seq.slice(1).map((w) => w['pid']));
    expect(runPids.size, 'the detached run wrote from more than one process').toBe(1);
    expect(runPids.has(parent.pid), 'the parent did the run itself').toBe(false);
    expect(readFileSync(join(home, 'staged-ccrc-argv'), 'utf8').split('\n')[1]).toBe('install');
    // The run's own lock goes with the run: free once it has exited.
    for (let until = Date.now() + 10_000; Date.now() < until
      && spawnSync('flock', ['-n', lockPath(home), 'true']).status !== 0;) await pause(50);
    expect(spawnSync('flock', ['-n', lockPath(home), 'true']).status, 'the finished run left the lock held').toBe(0);
  }, 60_000);

  // Review 179 fix round 1, item 8 (F8): a DETACHED run's floor refusal names
  // the floor ALONE. `_upd_detach` writes `queued` before the child runs, so
  // the child's `_upd_last_report` reads `queued` — never the `reverted` the
  // last update left — and cannot name a restored update. (The foreground
  // sentence, which reads the previous report before it writes anything, is
  // pinned in the floor describe; the CONTROL here is that same sentence on an
  // identical box.) `fixture-systemd-run-exec` runs the detached child for real.
  itLinux('a --detach run\'s floor refusal names the floor alone: the parent\'s `queued` write replaces the report the child would read, so the "restored after its gate failed" clause never appears — and the same box, run in the foreground, does name it (review 179 item 8)', async () => {
    const REVERTED = '{"target":"v3.0.0","phase":"reverted","startedAt":1,"updatedAt":2,"detail":"arm1: flipped back to v1.0.0; gate: fixture","from":"cli","pid":1}\n';
    const boxBelowFloor = (prefix: string): string => {
      const home = freshUpdateBox(prefix);
      plantOldBox(home, { version: 'v3.0.0' });
      writeFileSync(join(home, '.ccrc', 'floor'), 'v3.0.0\n');
      writeFileSync(join(home, '.ccrc', 'update.json'), REVERTED);
      packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
      return home;
    };
    const RESTORED = 'the last update, to v3.0.0, failed its health gate and was restored';
    // CONTROL: foreground, same box — the clause IS there, so its absence below
    // is the detach's doing and not a fixture that never reads a report.
    const fg = boxBelowFloor('ccrc-update-detach-floor-control-');
    const c = runUpdate(fg, ['--to', 'v2.0.0']);
    expect(c.code, `stderr: ${c.stderr}`).toBe(1);
    expect(c.stderr).toContain(RESTORED);
    // THE DETACHED RUN.
    const home = boxBelowFloor('ccrc-update-detach-floor-');
    writeFileSync(join(home, 'fixture-systemd-run-exec'), '');
    writeFileSync(join(home, '.local', 'bin', 'ccrc'),
      `#!/bin/sh\nexec '${BASH}' '${join(REPO, 'ccd', 'ccrc')}' "$@"\n`, { mode: 0o755 });
    mkdirSync(join(home, 'tmp'), { recursive: true });
    const env = { ...updateEnv(home), TMPDIR: join(home, 'tmp'), CCRC_RELEASE_BASE_URL: `local://${home}/releases` };
    replantDoctorStubs(home);
    const parent = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'update', '--detach', '--to', 'v2.0.0'],
      { env, encoding: 'utf8' });
    expect(parent.status, `stderr: ${parent.stderr}\nstdout: ${parent.stdout}`).toBe(0);
    const detachedLog = (): string => (existsSync(join(home, 'detached.log'))
      ? readFileSync(join(home, 'detached.log'), 'utf8') : '(no detached.log)');
    let final: Record<string, unknown> = {};
    for (let until = Date.now() + 20_000; Date.now() < until;) {
      try { final = report(home); } catch { final = {}; }
      if (final['phase'] === 'failed' || final['phase'] === 'done') break;
      await new Promise<void>((res) => setTimeout(res, 50));
    }
    expect(final, `the detached run never reported its refusal\n${detachedLog()}`).toMatchObject({ phase: 'failed', target: 'v2.0.0' });
    expect(reportWrites(home)[0], '`queued` is the parent\'s write, before the child reads any report').toMatchObject({ phase: 'queued' });
    const log = detachedLog();
    expect(log).toContain("v2.0.0 (resolved by --to v2.0.0) is below this box's floor v3.0.0 (");
    expect(log).toMatch(/the highest version this box completed an install of\) — moving down is a typed act: ccrc update --to v2\.0\.0 --downgrade\. Nothing on this box was changed/);
    expect(log, 'a detached refusal must not claim a restore it never read').not.toContain(RESTORED);
  }, 60_000);

  itLinux('--from and every typed flag ride the detached argv in ONE fixed order, whatever order they were typed in (D-3238)', () => {
    const home = detachedBox('ccrc-update-detach-flags-');
    const r = runUpdate(home,
      ['--allow-unsigned', '--detach', '--from', 'pwa', '--downgrade', '--to', 'v2.0.0', '--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(detachArgv(home)).toEqual([
      '--user --collect --quiet /bin/sh -c PATH="$HOME/.local/bin:$PATH" exec "$HOME/.local/bin/ccrc" "$@" '
      + 'ccrc-detach update --to v2.0.0 --from pwa --force --downgrade --allow-unsigned',
    ]);
    expect(report(home)).toMatchObject({ phase: 'queued', from: 'pwa', target: 'v2.0.0' });
  });

  itLinux('with a LIVE holder the parent is refused by the lock sentence and update.json is byte-identical — a queued write would overwrite a live run\'s report', () => {
    const home = detachedBox('ccrc-update-detach-busy-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    const live = '{"target":"v1.9.0","phase":"installing","startedAt":1,"updatedAt":2,"detail":null,"from":"cli","pid":4321}\n';
    writeFileSync(join(home, '.ccrc', 'update.json'), live);
    const holder = holdLock(home);
    let r: Result;
    try {
      r = runUpdate(home, ['--detach', '--to', 'v2.0.0']);
    } finally {
      release(holder);
    }
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: update: another update holds ~\/\.ccrc\/update\.lock \(pid 4321, target v1\.9\.0\)$/m);
    expect(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')).toBe(live);
    expect(detachArgv(home), 'a refused parent spawned anyway').toEqual([]);
  });

  itLinux('a lock the parent cannot MEASURE refuses the detach with its own sentence — neither the holder sentence nor a spawn, and no report (ruling R16)', () => {
    const home = detachedBox('ccrc-update-detach-unmeasured-');
    // A DIRECTORY where the lock file goes: it exists, and `exec {p}>>` on it
    // fails, so `_upd_lock_probe` answers 3. This holds at every uid, unlike a
    // `chmod 000` file, which root opens anyway.
    mkdirSync(lockPath(home), { recursive: true });
    const r = runUpdate(home, ['--detach', '--to', 'v2.0.0']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: update: ~\/\.ccrc\/update\.lock could not be measured \(probe rc 3\) — refusing to detach a run past a lock this box cannot see; nothing on this box was changed$/m);
    expect(r.stderr, 'rc 3 was folded into "held"').not.toMatch(/another update holds/);
    expect(existsSync(join(home, '.ccrc', 'update.json')), 'a queued report was written past an unmeasured lock').toBe(false);
    expect(detachArgv(home), 'rc 3 was folded into "free"').toEqual([]);
  });

  itLinux('a box with no flock on PATH refuses the detach with the flock sentence, not the busy or unmeasured one — no spawn, no report (rc-2 arm, mutation `2) ;;` must go RED)', () => {
    const home = detachedBox('ccrc-update-detach-noflock-');
    const r = runUpdate(home, ['--detach', '--to', 'v2.0.0'], { PATH: pathWithoutFlock(home) });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: flock \(util-linux\) is required by 'ccrc update' — it serialises updates and refuses rather than racing; nothing on this box was changed$/m);
    expect(existsSync(join(home, '.ccrc', 'update.json')), 'queued was written past a lock this box cannot probe').toBe(false);
    expect(detachArgv(home), 'the rc-2 arm spawned anyway').toEqual([]);
  });

  itLinux('the parent holds NO lock descriptor at the spawn: a child that lingers after the parent exits pins nothing (§18 "--detach precedes the lock")', () => {
    const home = detachedBox('ccrc-update-detach-nofd-');
    writeFileSync(join(home, 'fixture-systemd-run-linger'), '');
    let lingerPid = 0;
    try {
      const r1 = runUpdate(home, ['--detach', '--to', 'v2.0.0']);
      expect(r1.code, `stderr: ${r1.stderr}\nstdout: ${r1.stdout}`).toBe(0);
      lingerPid = Number(readFileSync(join(home, 'systemd-run-linger-pid'), 'utf8').trim());
      rmSync(join(home, 'fixture-systemd-run-linger'));
      // CONTROL: the inheritor is alive, so a free lock below is a finding
      // about the parent, not about a child that already exited.
      expect(() => process.kill(lingerPid, 0), 'the lingering child is gone — the pin below would be vacuous').not.toThrow();
      expect(spawnSync('flock', ['-n', lockPath(home), 'true']).status,
        'the detached child inherited a lock descriptor from its parent').toBe(0);
      const r2 = runUpdate(home, ['--detach', '--to', 'v2.0.0']);
      expect(r2.code, `stderr: ${r2.stderr}`).toBe(0);
    } finally {
      if (lingerPid > 0) { try { process.kill(lingerPid, 'SIGKILL'); } catch { /* already gone */ } }
    }
  });

  itLinux('a user manager that refuses to create the job is a failed report and exit 1 — nothing on the box changed', () => {
    const home = detachedBox('ccrc-update-detach-rc-');
    writeFileSync(join(home, 'fixture-systemd-run-exit'), '1\n');
    const r = runUpdate(home, ['--detach', '--to', 'v2.0.0']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: update: could not start the detached run \(systemd-run exited 1\) — nothing on this box was changed$/m);
    expect(report(home)).toMatchObject({ phase: 'failed', detail: 'detach: systemd-run exited 1', target: 'v2.0.0' });
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
  });

  it('--detach without --to is a usage error at exit 2 — nothing written, nothing spawned (D-3229)', () => {
    const home = detachedBox('ccrc-update-detach-noto-');
    const r = runUpdate(home, ['--detach']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: update: --detach needs --to <tag> — a detached run never resolves a channel; it has nobody to print its sentence to$/m);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
    expect(detachArgv(home)).toEqual([]);
    expect(existsSync(join(home, 'curl-argv'))).toBe(false);
  });

  it('--check and --detach are exclusive — the D-3139 shape, exit 2, nothing fetched', () => {
    const home = detachedBox('ccrc-update-detach-check-');
    const r = runUpdate(home, ['--check', '--detach', '--to', 'v2.0.0']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/update: --check and --detach are exclusive/);
    expect(existsSync(join(home, 'curl-argv')), 'a fetch ran before the refusal').toBe(false);
    expect(detachArgv(home)).toEqual([]);
  });

  it('the Darwin arm refuses BEFORE it probes, writes or spawns — measured on any platform through the sourced function (§18 "--detach refuses on Darwin")', () => {
    const home = detachedBox('ccrc-update-detach-darwin-src-');
    const r = sourcedCcrc(home, 'CCD_OS=darwin; _upd_detach update v2.0.0 cli');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: --detach is Linux-only \(decision 17\)$/m);
    expect(existsSync(join(home, '.ccrc', 'update.json')), 'the Darwin arm wrote a report').toBe(false);
    expect(detachArgv(home)).toEqual([]);
  });

  itDarwin('on macOS the full verb refuses at exit 1 with the decision-17 sentence, nothing written', () => {
    const home = detachedBox('ccrc-update-detach-darwin-');
    const r = runUpdate(home, ['--detach', '--to', 'v2.0.0']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: --detach is Linux-only \(decision 17\)$/m);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
    expect(existsSync(join(home, 'curl-argv'))).toBe(false);
  });
});

describe('ccrc update: the health gate (per OS, exit 3 vs 4 — design §11)', () => {
  // After the staged install returns and BEFORE the sweep, the run waits up
  // to CCRC_UPDATE_HEALTH_S for the role's signal: server/both — the unit up
  // and `/health` answering the STAGED version; fleet — the agent's unit up
  // and staying up. A doctor FAIL with the gate passing is D-3114's exit 3
  // ("moved, unhealthy"); a failed gate is exit 4 (Task 6 adds the restore
  // that exit 4 means). All against the recording stubs — updateEnv's
  // systemctl/launchctl and healthyBox's curl — never a real manager or port.
  const gateBox = (prefix: string, role?: 'server' | 'fleet' | 'both', installExit = 0): string => {
    const home = freshUpdateBox(prefix);
    plantOldBox(home, { version: 'v1.0.0' });
    if (role !== undefined) {
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      // What `_inst_env` seeds (a fleet box's env file names no server).
      writeFileSync(join(home, '.ccrc', 'ccrc.env'), role === 'fleet'
        ? 'CCRC_ROLE=fleet\n'
        : `CCRC_ROLE=${role}\nCCRC_HOST=127.0.0.1\nCCRC_PORT=7788\n`);
    }
    const tree = stubTree(home, { version: 'v2.0.0', installExit });
    packRelease(home, tree, { tag: 'v2.0.0' });
    // W4a Task 8: a server or `both` box's `ccrc update` with no --to follows
    // the control plane's projection, which the server process writes — so an
    // ABSENT one is `unreadable (absent)` and refused before the gate is ever
    // reached. Give the box what a real server box has: the frozen clock and
    // an in-force projection naming the v2.0.0 it publishes, packed at
    // download/v2.0.0 too. latest/download stays for the Darwin leg, whose
    // reader answers `not-configured` whatever is planted. A fleet box has no
    // ccd-update-sync.timer here, reads `not-configured`, and needs neither.
    if (role === 'server' || role === 'both') {
      plantClock(home);
      plantIntent(home, intentDoc({ desired: 'v2.0.0', desiredStable: 'v2.0.0' }));
      packRelease(home, tree, { tag: 'v2.0.0', latest: false });
    }
    return home;
  };
  /** Everything a sweep needs, so a "no sweep" assertion is about the gate —
   *  the gate describe's own copy of the converged() discipline above. */
  const withSweep = (home: string): void => {
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    writeFileSync(join(home, 'fixture-sweep-active'), UNIT_LINES);
  };
  const lines = (home: string, f: string): string[] => (existsSync(join(home, f))
    ? readFileSync(join(home, f), 'utf8').split('\n').filter((l) => l !== '') : []);
  /** The gate's probes only — `/api/fleet/health` (the fleet-first warning)
   *  also ends in `/health` and is not one. */
  const healthProbes = (home: string): string[] => lines(home, 'curl-argv')
    .filter((l) => /^http:\/\/[^/]+\/health$/.test(l));
  const reportOf = (home: string): Record<string, unknown> =>
    JSON.parse(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')) as Record<string, unknown>;

  itLinux('server: ccrc.service active and /health answering the staged version passes — and the gate runs BEFORE the sweep', () => {
    const home = gateBox('ccrc-update-gate-pass-', 'server');
    withSweep(home);
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^update: gate: server answers on v2\.0\.0 \(ccrc\.service up, \/health at 127\.0\.0\.1:7788 answers v2\.0\.0\)$/m);
    const calls = lines(home, 'systemctl-calls');
    const gate = calls.indexOf('--user is-active ccrc.service');
    expect(gate, calls.join('\n')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('--user try-restart claude-session@*')).toBeGreaterThan(gate);
    expect(healthProbes(home)).toEqual(['http://127.0.0.1:7788/health']);
    expect(reportOf(home)['phase']).toBe('done');
  });

  it('/health answering the OLD version past the deadline fails the gate: exit 4, a failed report naming it, no sweep and no from→to report (§11 Pins; §18 "the gate restores" — Task 6 adds the restore)', () => {
    const home = gateBox('ccrc-update-gate-old-', 'server');
    withSweep(home);
    writeFileSync(join(home, 'fixture-health-pin'), 'v1.0.0\n');
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout).toMatch(/^update: gate FAILED after \d+s — \/health at 127\.0\.0\.1:7788 answers v1\.0\.0, not v2\.0\.0$/m);
    expect(r.stderr).toMatch(/update: v2\.0\.0 was installed, but the box did not come back healthy on it \(\/health at 127\.0\.0\.1:7788 answers v1\.0\.0, not v2\.0\.0\) — exit 4\. The backup taken BEFORE the install is complete at \S*ccrc-backups/);
    const rep = reportOf(home);
    // Task 6: a failed gate restores. This box's v1.0.0 is unpublished, so
    // arm 2 refuses (no bundle to re-install from) and arm 3 copies back.
    expect(rep['phase']).toBe('reverted');
    expect(rep['detail']).toBe('arm3: tree MIXED, deploy.sh is the remedy; gate: /health at 127.0.0.1:7788 answers v1.0.0, not v2.0.0');
    // withSweep planted everything a sweep needs, so this absence is the gate's.
    expect(lines(home, 'systemctl-calls').join('\n')).not.toMatch(/try-restart/);
    expect(lines(home, 'launchctl-calls').join('\n')).not.toMatch(/kickstart -k \S+\/app\.ccrc\.session\./);   // arm 3 re-bootstraps and kickstarts the main job; the sweep never ran
    expect(r.stdout).not.toMatch(/^update: build: /m);
  });

  // Review fix round 1, M1: `_box_server_addr`'s rc-2 sentences embed the
  // absolute `$BOX_ENV_FILE` path ("… is not a regular file"), which
  // `_upd_health_version` copies straight into UPD_GATE_WHY — and from
  // there into every `_upd_phase` detail (`_upd_rollback_no_restore`,
  // `_upd_restore` and its two arms, `cmd_watchdog`) and several stdout/
  // stderr echoes (`_upd_gate`'s own two, `cmd_update`'s exit-4 line) that
  // never pass through `_ccrc_die`. A `.ccrc/ccrc.env` that is a directory
  // (never written by ccrc itself, but the same 0644-file-the-console-reads
  // class as C17's `$BOX_FLOOR_FILE`) reaches exactly this arm.
  it('a gate failure whose reason carries the fixture HOME is redacted everywhere — update.json detail, stdout and stderr (review fix round 1 M1)', () => {
    const home = gateBox('ccrc-update-gate-redact-', 'server');
    withSweep(home);
    // Corrupt ccrc.env into a directory AFTER gateBox writes it as a file.
    rmSync(join(home, '.ccrc', 'ccrc.env'));
    mkdirSync(join(home, '.ccrc', 'ccrc.env'));
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout, r.stdout).not.toContain(home);
    expect(r.stderr, r.stderr).not.toContain(home);
    const rep = reportOf(home);
    expect(String(rep['detail']), JSON.stringify(rep)).not.toContain(home);
    // A measurement, not just an absence: the verdict itself is still there,
    // with the redacted path standing in for the fixture HOME.
    expect(r.stdout).toMatch(/^update: gate FAILED after \d+s — ~\/\.ccrc\/ccrc\.env is not a regular file$/m);
    expect(r.stderr).toMatch(/did not come back healthy on it \(~\/\.ccrc\/ccrc\.env is not a regular file\)/);
    expect(String(rep['detail'])).toContain('~/.ccrc/ccrc.env is not a regular file');
  });

  itLinux('a unit that is not active fails the gate before /health is asked: exit 4, naming the unit and its state', () => {
    const home = gateBox('ccrc-update-gate-dead-', 'server');
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    const r = runUpdate(home);
    expect(r.code, r.stdout).toBe(4);
    expect(r.stdout).toMatch(/^update: gate FAILED after \d+s — ccrc\.service is failed \(systemctl --user is-active\), not active$/m);
    expect(healthProbes(home)).toEqual([]);
    expect(reportOf(home)['detail']).toBe('arm3: tree MIXED, deploy.sh is the remedy; gate: ccrc.service is failed (systemctl --user is-active), not active');
  });

  it('/health that does not answer fails the gate, naming curl\'s exit', () => {
    const home = gateBox('ccrc-update-gate-down-', 'server');
    writeFileSync(join(home, 'fixture-health-down'), 'yes\n');
    const r = runUpdate(home);
    expect(r.code, r.stdout).toBe(4);
    expect(r.stdout).toMatch(/^update: gate FAILED after \d+s — GET http:\/\/127\.0\.0\.1:7788\/health got no answer \(curl exited 7\)$/m);
  });

  it('/health answering with no version fails the gate — an unversioned answer is not the staged version', () => {
    const home = gateBox('ccrc-update-gate-nover-', 'server');
    writeFileSync(join(home, 'fixture-health-pin'), '');
    const r = runUpdate(home);
    expect(r.code, r.stdout).toBe(4);
    expect(r.stdout).toMatch(/^update: gate FAILED after \d+s — GET http:\/\/127\.0\.0\.1:7788\/health answered without a release version$/m);
  });

  it('the gate probes again until CCRC_UPDATE_HEALTH_S elapses: the old version first, the staged one two seconds later — passes', () => {
    const home = gateBox('ccrc-update-gate-retry-', 'server');
    writeFileSync(join(home, 'fixture-health-pin'), 'v1.0.0\n');
    writeFileSync(join(home, 'fixture-health-pin-probes'), '1\n');
    const r = runUpdate(home, [], { CCRC_UPDATE_HEALTH_S: '5' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(healthProbes(home)).toHaveLength(2);
    expect(r.stdout).toMatch(/^update: gate: server answers on v2\.0\.0 /m);
  });

  it('a doctor FAIL with the gate passing is exit 3 and a done report; the same with the gate failing is exit 4 — two failures, two exit codes (§18 "doctor FAIL does not restore")', () => {
    const home = gateBox('ccrc-update-gate-doctor-', 'server', 1);
    writeFileSync(join(home, 'fixture-stub-installed'), 'yes\n');
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(3);
    expect(r.stdout).toMatch(/^update: the staged install completed \(the record is written\) but its trailing doctor exited 1/m);
    expect(r.stdout).toMatch(/^update: gate: server answers on v2\.0\.0 /m);
    expect(reportOf(home)['phase']).toBe('done');
    const both = gateBox('ccrc-update-gate-doctor-and-gate-', 'server', 1);
    writeFileSync(join(both, 'fixture-stub-installed'), 'yes\n');
    writeFileSync(join(both, 'fixture-health-pin'), 'v1.0.0\n');
    const r2 = runUpdate(both);
    expect(r2.code, r2.stdout).toBe(4);
    expect(reportOf(both)['phase']).toBe('reverted');
  });

  itLinux('fleet: ccrc-agent.service active AND staying up (verify-service.sh\'s two samples) passes with no /health asked; a MainPID that churns behind `active` fails', () => {
    const home = gateBox('ccrc-update-gate-fleet-', 'fleet');
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^update: gate: fleet answers on v2\.0\.0 \(ccrc-agent\.service up and staying up\)$/m);
    const calls = lines(home, 'systemctl-calls');
    expect(calls).toContain('--user is-active ccrc-agent.service');
    expect(calls).toContain('--user show -p MainPID --value ccrc-agent.service');
    expect(calls).not.toContain('--user is-active ccrc.service');
    expect(healthProbes(home)).toEqual([]);
    const churn = gateBox('ccrc-update-gate-fleet-churn-', 'fleet');
    writeFileSync(join(churn, 'fixture-mainpid-churn'), 'yes\n');
    const r2 = runUpdate(churn);
    expect(r2.code, r2.stdout).toBe(4);
    expect(r2.stdout).toMatch(/^update: gate FAILED after \d+s — ccrc-agent\.service did not stay up \(deploy\/verify-service\.sh exited 1; systemctl --user status ccrc-agent\.service says why\)$/m);
  });

  itDarwin('Darwin server: the job\'s pid must hold across the window (_ccrc_job_stayed_up) — a churning ccrc job fails the gate, and systemctl is never called (§11 Pins)', () => {
    const home = gateBox('ccrc-update-gate-darwin-', 'server');
    writeFileSync(join(home, 'fixture-main-pid-churn'), 'yes\n');
    const r = runUpdate(home);
    expect(r.code, r.stdout).toBe(4);
    expect(r.stdout).toMatch(/^update: gate FAILED after \d+s — ccrc\.service did not stay up \(pid \d+ -> \d+ across 0s\+0s\)$/m);
    expect(existsSync(join(home, 'systemctl-calls')), 'the Darwin gate reached systemctl').toBe(false);
    expect(healthProbes(home)).toEqual([]);
  });

  it('a spine that died AFTER the tree moved runs the gate: passing → exit 1 naming --force, no sweep, the report stays "spine died"; failing → exit 4; a death BEFORE the tree runs no gate (§11 Pins; D-3240)', () => {
    const home = gateBox('ccrc-update-gate-spine-', 'server', 1);
    withSweep(home);
    writeFileSync(join(home, 'fixture-install-step'), '_inst_skills\n');
    let r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stdout).toMatch(/^update: gate: server answers on v2\.0\.0 /m);
    expect(r.stderr).toMatch(/update: the box moved and answers on v2\.0\.0, but its install never completed \(spine died at _inst_skills\) — rerun: ccrc update --to v2\.0\.0 --force/);
    // Re-asserted after the gate's own `checking` write.
    expect(reportOf(home)).toMatchObject({ phase: 'failed', detail: 'spine died at _inst_skills' });
    expect(lines(home, 'systemctl-calls').join('\n')).not.toMatch(/try-restart/);
    // …and failing the gate as well: exit 4, both causes in the report.
    const failing = gateBox('ccrc-update-gate-spine-fail-', 'server', 1);
    writeFileSync(join(failing, 'fixture-install-step'), '_inst_skills\n');
    writeFileSync(join(failing, 'fixture-health-pin'), 'v1.0.0\n');
    r = runUpdate(failing);
    expect(r.code, r.stdout).toBe(4);
    expect(reportOf(failing)['detail'])
      .toBe('arm3: tree MIXED, deploy.sh is the remedy; spine died at _inst_skills; gate: /health at 127.0.0.1:7788 answers v1.0.0, not v2.0.0');
    // …and BEFORE the tree: nothing was replaced, so nothing is measured.
    const early = gateBox('ccrc-update-gate-spine-early-', 'server', 1);
    writeFileSync(join(early, 'fixture-install-step'), '_inst_env\n');
    r = runUpdate(early);
    expect(r.code, r.stdout).toBe(1);
    expect(r.stdout).not.toMatch(/^update: gate/m);
    expect(lines(early, 'systemctl-calls')).not.toContain('--user is-active ccrc.service');
    expect(healthProbes(early)).toEqual([]);
  });

  // Task 5 review carry: no earlier case measured D-3240's --no-gate sentence
  // ("was not measured (--no-gate)") — arm 2's own child types exactly this
  // flag, so this arm must stay reachable and unrestored under it.
  it('a spine that died AFTER the tree moved, run with --no-gate: exit 1, "was not measured (--no-gate)", no restore (D-3240)', () => {
    const home = gateBox('ccrc-update-gate-spine-nogate-', 'server', 1);
    withSweep(home);
    writeFileSync(join(home, 'fixture-install-step'), '_inst_skills\n');
    const r = runUpdate(home, ['--no-gate']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stdout).toMatch(/^update: gate: skipped \(--no-gate\) — nothing measured whether v2\.0\.0 came back up on this box$/m);
    expect(r.stderr).toMatch(/update: the box moved and was not measured \(--no-gate\), but its install never completed \(spine died at _inst_skills\) — rerun: ccrc update --to v2\.0\.0 --force/);
    expect(reportOf(home)).toMatchObject({ phase: 'failed', detail: 'spine died at _inst_skills' });
    expect(lines(home, 'systemctl-calls').join('\n')).not.toMatch(/try-restart/);
    expect(restoreChildArgv(home), 'a --no-gate death is not restored').toBeNull();
  });

  it('--no-gate skips the gate: one line says so, nothing is probed, and the run completes (only the restore child passes it automatically)', () => {
    const home = gateBox('ccrc-update-gate-nogate-', 'server');
    writeFileSync(join(home, 'fixture-health-pin'), 'v1.0.0\n');
    const r = runUpdate(home, ['--no-gate']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^update: gate: skipped \(--no-gate\) — nothing measured whether v2\.0\.0 came back up on this box$/m);
    expect(healthProbes(home)).toEqual([]);
    expect(lines(home, 'systemctl-calls')).not.toContain('--user is-active ccrc.service');
    expect(reportOf(home)['phase']).toBe('done');
  });

  itLinux('--detach carries a typed --no-gate into the detached argv, after the other typed flags (the D-3139 trap: a flag the caller typed is never dropped), through the D-3282 PATH-prepend wrapper (fix round 1 item 19 / review 155 C30)', () => {
    const home = gateBox('ccrc-update-gate-detach-', 'server');
    const r = runUpdate(home, ['--detach', '--to', 'v2.0.0', '--no-gate']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    // The SAME `/bin/sh -c 'PATH="$HOME/.local/bin:$PATH" exec …'` shape
    // `ccrc-update-watchdog.service`'s own `ExecStart` uses (D-3282, fixed
    // by class) — never `--setenv=PATH=…`, which would bake in the CALLING
    // process's own PATH rather than reading the manager's fresh.
    expect(lines(home, 'systemd-run-argv')).toEqual([
      '--user --collect --quiet /bin/sh -c PATH="$HOME/.local/bin:$PATH" exec "$HOME/.local/bin/ccrc" "$@" '
      + 'ccrc-detach update --to v2.0.0 --from cli --no-gate',
    ]);
  });

  it('--check and --no-gate are exclusive — the D-3139 refusal shape, exit 2, nothing fetched', () => {
    const home = freshUpdateBox('ccrc-update-gate-check-');
    const r = runUpdate(home, ['--check', '--no-gate']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: update: --check and --no-gate are exclusive — --check measures and writes nothing, --no-gate skips the health gate of a run that moves this box; pick one$/m);
    expect(existsSync(join(home, 'curl-argv')), 'a fetch ran before the refusal').toBe(false);
  });

  it('a CCRC_UPDATE_HEALTH_S that is not a number of seconds is named and replaced by 90', () => {
    const home = gateBox('ccrc-update-gate-knob-', 'server');
    const r = runUpdate(home, [], { CCRC_UPDATE_HEALTH_S: 'soon' });
    expect(r.code, r.stdout).toBe(0);
    expect(r.stdout).toMatch(/^update: WARN: CCRC_UPDATE_HEALTH_S='soon' is not a number of seconds \(digits only, at most 18\) — using 90$/m);
  });

  // THE ARMS, SOURCED. `ccrc` recomputes CCD_OS from $OSTYPE at source time
  // (ccd/ccrc:109-114), so the Darwin arms of a whole `ccrc update` run only
  // on the macOS leg — which is non-required and measured unable to finish.
  // Sourced (the `_check_routing` idiom in ccrc-doctorFixture.ts), CCD_OS is
  // set AFTER the file computed it, and `_ccrc_job_stayed_up` is shadowed to
  // record its argument, so every leg measures which arm ran: the arm's
  // CHOICE is the subject here, the two-sample check is the itDarwin case's.
  const probe = (home: string, os: 'linux' | 'darwin', role: string): { rc: number; why: string } => {
    replantDoctorStubs(home);
    writeFileSync(join(home, 'fixture-health-pin'), 'v2.0.0\n');
    const script = [
      'set -uo pipefail',
      '. "$1"',
      'CCD_OS="$2"',
      '_ccrc_job_stayed_up() { printf \'%s\\n\' "$1" >> "$HOME/stayed-up-calls"; CCRC_STAYED_DETAIL="pid 4242 -> 4242 across 0s+0s"; [ ! -f "$HOME/fixture-shadow-churn" ]; }',
      'rc=0; _upd_gate_probe "$3" v2.0.0 || rc=$?',
      'printf \'rc=%s\\nwhy=%s\\n\' "$rc" "$UPD_GATE_WHY"',
    ].join('\n');
    const r = spawnSync(BASH, ['-c', script, 'gate-probe', join(REPO, 'ccd', 'ccrc'), os, role],
      { env: { ...updateEnv(home), CCRC_ADDR: '127.0.0.1:7788' }, encoding: 'utf8' });
    const rc = /^rc=(\d+)$/m.exec(r.stdout ?? '');
    const why = /^why=(.*)$/m.exec(r.stdout ?? '');
    if (rc === null || why === null) throw new Error(`the probe printed no verdict:\n${r.stdout}\n${r.stderr}`);
    return { rc: Number(rc[1]), why: why[1]! };
  };

  it('the arms, sourced: Darwin takes _ccrc_job_stayed_up and never reaches systemctl; Linux takes is-active (fleet: plus verify-service.sh); only server/both ask /health (§18 "the gate has per-OS arms")', () => {
    const ds = freshUpdateBox('ccrc-update-gate-arm-ds-');
    expect(probe(ds, 'darwin', 'server')).toEqual({ rc: 0, why: 'ccrc.service up, /health at 127.0.0.1:7788 answers v2.0.0' });
    expect(lines(ds, 'stayed-up-calls')).toEqual(['ccrc.service']);
    expect(existsSync(join(ds, 'systemctl-calls')), 'the Darwin arm reached systemctl').toBe(false);
    expect(healthProbes(ds)).toEqual(['http://127.0.0.1:7788/health']);

    const df = freshUpdateBox('ccrc-update-gate-arm-df-');
    expect(probe(df, 'darwin', 'fleet')).toEqual({ rc: 0, why: 'ccrc-agent.service up and staying up' });
    expect(lines(df, 'stayed-up-calls')).toEqual(['ccrc-agent.service']);
    expect(existsSync(join(df, 'systemctl-calls'))).toBe(false);
    expect(healthProbes(df)).toEqual([]);

    const dc = freshUpdateBox('ccrc-update-gate-arm-dc-');
    writeFileSync(join(dc, 'fixture-shadow-churn'), 'yes\n');
    expect(probe(dc, 'darwin', 'both')).toEqual({ rc: 1, why: 'ccrc.service did not stay up (pid 4242 -> 4242 across 0s+0s)' });
    expect(healthProbes(dc), 'the unit is measured before /health').toEqual([]);

    const ls = freshUpdateBox('ccrc-update-gate-arm-ls-');
    expect(probe(ls, 'linux', 'server')).toEqual({ rc: 0, why: 'ccrc.service up, /health at 127.0.0.1:7788 answers v2.0.0' });
    expect(lines(ls, 'systemctl-calls')).toEqual(['--user is-active ccrc.service']);
    expect(existsSync(join(ls, 'stayed-up-calls'))).toBe(false);

    const lf = freshUpdateBox('ccrc-update-gate-arm-lf-');
    expect(probe(lf, 'linux', 'fleet')).toEqual({ rc: 0, why: 'ccrc-agent.service up and staying up' });
    // Ours, then verify-service.sh's two samples (is-active + MainPID, twice).
    expect(lines(lf, 'systemctl-calls')).toEqual([
      '--user is-active ccrc-agent.service',
      '--user is-active ccrc-agent.service',
      '--user show -p MainPID --value ccrc-agent.service',
      '--user is-active ccrc-agent.service',
      '--user show -p MainPID --value ccrc-agent.service',
    ]);
    expect(existsSync(join(lf, 'stayed-up-calls'))).toBe(false);
    expect(healthProbes(lf)).toEqual([]);
  });
});

describe('ccrc update: the automatic restore (arms 2 and 3)', () => {
  it('a failed gate restores by arm 2: ONE synchronous child re-installs the previous tag with --no-gate --from restore, under the parent\'s lock, and the run exits 4 (§18 "the gate restores", "arm 2 re-installs the previous tag", "the automatic restore does not sweep")', () => {
    const home = freshUpdateBox('ccrc-update-restore-arm2-');
    plantRestoreBox(home);
    // A sweep that RAN would leave a try-restart in the recording: the drop-in
    // passes its preflight and two supervisors are live. Without both, a
    // "no try-restart" assertion is vacuous (plantKillModeDropIn's own note).
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(restoreChildArgv(home)).toEqual([
      join(home, 'ccrc', 'ccd', 'ccrc'), 'update', '--to', 'v1.0.0', '--no-gate', '--from', 'restore',
    ]);
    const last = lastReport(home);
    // The marker names the PARENT (its own $$ is the report's pid), the child
    // saw it as its $PPID, and the lock was held while the child ran.
    const env = /^held=(\d+) ppid=(\d+) locked=(yes|no)$/.exec(
      readFileSync(join(home, 'restore-child-env'), 'utf8').trim());
    expect(env, 'the child recorded no environment line').not.toBeNull();
    expect(env![1]).toBe(env![2]);
    expect(env![1]).toBe(String(last['pid']));
    expect(env![3], 'the parent released the lock before its restore child ran').toBe('yes');
    expect(last['phase']).toBe('reverted');
    expect(String(last['detail'])).toMatch(/^arm2: restored v1\.0\.0; gate: /);
    expect(last['target']).toBe('v2.0.0');
    expect(last['from']).toBe('cli');
    const phases = reportWrites(home).map((w) => w['phase']);
    expect(phases.slice(-3)).toEqual(['checking', 'restoring', 'reverted']);
    expect(phases).not.toContain('restarting');
    expect(phases).not.toContain('done');
    expect(phases).not.toContain('failed');
    expect(String(reportWrites(home).at(-2)!['detail'])).toMatch(/^gate: /);
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 2\): this box runs v1\.0\.0 again, re-installed from its release — gate: /m);
    expect(r.stdout).not.toMatch(/REVERTED \(arm 3\)/);
    // Arm 2 asked whether the previous release ships a bundle (the node was
    // verified), and fetched nothing else of it — the child does the install.
    expect(localUrls(home)).toContain(`local://${home}/releases/download/v1.0.0/ccrc-v1.0.0.tar.gz.sigstore.json`);
    expect(localUrls(home)).not.toContain(`local://${home}/releases/download/v1.0.0/ccrc-v1.0.0.tar.gz`);
    if (process.platform !== 'darwin') {
      const calls = readFileSync(join(home, 'systemctl-calls'), 'utf8');
      expect(calls, 'the automatic restore swept the supervisors').not.toMatch(/try-restart/);
    }
    expect(readFileSync(join(home, '.ccrc', 'previous'), 'utf8')).toBe(`v1.0.0\n${OLD_SHA}\n`);
  });

  // D-3275 (fix round 1): the child is a real `ccrc update` — exit 3 means
  // ITS spine completed and wrote its own record, and only its trailing
  // doctor FAILed (D-3114). That is a restore, not a failure: arm 3 over it
  // would delete the record the child just wrote and report a MIXED tree
  // that is not mixed, and on any box with a standing doctor FAIL no restore
  // could ever take arm 2.
  it('a restore child whose OWN doctor FAILs (exit 3) is still a restore: arm 2 accepts it, never falls to arm 3, and the child\'s own record survives (D-3275)', () => {
    const home = freshUpdateBox('ccrc-update-restore-doctor3-');
    plantRestoreBox(home);
    writeFileSync(join(home, 'fixture-restore-exit'), '3\n');
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 2\): this box runs v1\.0\.0 again, re-installed from its release, but its doctor reports FAIL lines \('ccrc doctor' re-reads them\) — gate: /m);
    expect(r.stdout).not.toMatch(/arm 2 failed/);
    expect(r.stdout).not.toMatch(/arm 3/);
    expect(r.stdout).not.toMatch(/REVERTED \(arm 3\)/);
    const last = lastReport(home);
    expect(last['phase']).toBe('reverted');
    expect(String(last['detail'])).toMatch(/^arm2: restored v1\.0\.0 \(its doctor exited 3\); gate: /);
    // The child's own record (D-3275's fixture extension) is untouched — only
    // arm 3 removes `~/.ccrc/installed`, and arm 3 never ran.
    expect(readFileSync(join(home, '.ccrc', 'installed'), 'utf8')).toBe('childsha0000000000000000000000000000000\n');
  });

  it('arm 2 passes --allow-unsigned only when the marker read `unsigned` BEFORE the install rewrote it (§18 "arm 2 never silently unsigns")', () => {
    const home = freshUpdateBox('ccrc-update-restore-unsigned-');
    plantRestoreBox(home, {
      marker: `${OLD_SHA}\nunsigned\n`,
      prevBundle: false,
      // The new spine writes a VERIFIED marker: reading it at restore time
      // instead of before the install would drop the flag.
      onInstall: ['printf \'newsha0000000000000000000000000000000000\\n\' > "$HOME/.ccrc/installed"'],
    });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(restoreChildArgv(home)).toEqual([
      join(home, 'ccrc', 'ccd', 'ccrc'), 'update', '--to', 'v1.0.0', '--no-gate', '--from', 'restore', '--allow-unsigned',
    ]);
    // Already unverified: nothing to ask the release host.
    expect(localUrls(home)).not.toContain(`local://${home}/releases/download/v1.0.0/ccrc-v1.0.0.tar.gz.sigstore.json`);
    expect(r.stdout).not.toMatch(/arm2-refused/);
    expect(String(lastReport(home)['detail'])).toMatch(/^arm2: restored v1\.0\.0; /);
  });

  it('a previously VERIFIED node whose previous release ships no bundle: arm 2 refuses with the by-hand sentence and falls to arm 3 — the child never runs', () => {
    const home = freshUpdateBox('ccrc-update-restore-refused-');
    plantRestoreBox(home, {
      prevBundle: false,
      // The new spine writes an UNSIGNED marker: reading it at restore time
      // would pass --allow-unsigned to a node that was verified.
      onInstall: ['printf \'newsha0000000000000000000000000000000000\\nunsigned\\n\' > "$HOME/.ccrc/installed"'],
    });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    // D-3285 (final review, B3(iii)): the spine already completed and
    // raised the floor to the new tag, so the by-hand command needs
    // --downgrade or the floor refuses it — `cmd_rollback`'s own D-3263
    // header already prints the same shape.
    expect(r.stdout).toMatch(/^update: arm2-refused: v1\.0\.0 ships no bundle — run ccrc update --to v1\.0\.0 --downgrade --allow-unsigned by hand$/m);
    expect(restoreChildArgv(home), 'arm 2 ran a child for a release it had just refused').toBeNull();
    const details = reportWrites(home).map((w) => String(w['detail']));
    expect(details).toContain('arm2-refused: v1.0.0 ships no bundle; run ccrc update --to v1.0.0 --downgrade --allow-unsigned by hand');
    const last = lastReport(home);
    expect(last['phase']).toBe('reverted');
    expect(String(last['detail'])).toMatch(/^arm3: tree MIXED, deploy\.sh is the remedy; gate: /);
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 3\): /m);
  });

  it('the hazard: arm 2 runs the NEW tree\'s ccd/ccrc — a broken one fails arm 2, and arm 3 copies the tree back by rename, never coord.db or memory, restarts the unit, and says MIXED', () => {
    const home = freshUpdateBox('ccrc-update-restore-arm3-');
    const darwin = process.platform === 'darwin';
    const unitRel = darwin ? 'Library/LaunchAgents/app.ccrc.ccrc.plist' : '.config/systemd/user/ccrc.service';
    mkdirSync(join(home, '.cc-sessions'), { recursive: true });
    writeFileSync(join(home, '.cc-sessions', 'session-hook.sh'), 'OLD hook\n', { mode: 0o755 });
    mkdirSync(join(home, '.ccrc', 'memory', 'fixture-proj'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'memory', 'fixture-proj', 'MEMORY.md'), 'before the update\n');
    plantRestoreBox(home, {
      child: 'broken',
      onInstall: [
        // What a spine that moved the tree leaves: a new dist, a new ccd
        // placed by rename (with a second name kept on its inode, so an
        // in-place restore would show through it), a new unit, a new hook —
        // and a session writing memory while the update ran.
        'rm -rf "$HOME/ccrc/server/dist" && mkdir -p "$HOME/ccrc/server/dist" && printf \'// NEW dist\\n\' > "$HOME/ccrc/server/dist/new.js"',
        'printf \'#!/bin/sh\\n# the NEW ccd\\n\' > "$HOME/.local/bin/ccd.new" && chmod 755 "$HOME/.local/bin/ccd.new" && mv -f "$HOME/.local/bin/ccd.new" "$HOME/.local/bin/ccd"',
        'ln -f "$HOME/.local/bin/ccd" "$HOME/new-ccd-link"',
        `printf 'NEW job file\\n' > "$HOME/${unitRel}"`,
        'printf \'NEW hook\\n\' > "$HOME/.cc-sessions/session-hook.sh"',
        'printf \'written while the update ran\\n\' > "$HOME/.ccrc/memory/fixture-proj/MEMORY.md"',
      ],
    });
    plantCoordDb(home);
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    const unitBefore = readFileSync(join(home, unitRel), 'utf8');
    const db = join(home, '.ccrc', 'coord.db');
    const dbBytes = readFileSync(db);
    const dbIno = statSync(db).ino;
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stderr).toMatch(/fixture: the new tree's ccd\/ccrc is broken/);
    expect(r.stdout).toMatch(/^update: arm 2 failed \(the restore child exited 1\) — falling to arm 3$/m);
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 3\): copied the pre-update backup back — the tree is MIXED \(new shared\/, ccd\/ and node_modules under the old dists\); the remedy is deploy\.sh\. Best effort\.$/m);
    // The tree rows came back …
    expect(existsSync(join(home, 'ccrc', 'server', 'dist', 'old.js'))).toBe(true);
    expect(existsSync(join(home, 'ccrc', 'server', 'dist', 'new.js'))).toBe(false);
    expect(readFileSync(join(home, '.local', 'bin', 'ccd'), 'utf8')).toBe('#!/bin/sh\n# the OLD ccd\n');
    expect(statSync(join(home, '.local', 'bin', 'ccd')).mode & 0o111).not.toBe(0);
    // … by RENAME: the new ccd's inode still holds the new bytes, so no live
    // supervisor executing it had its script rewritten underneath it.
    expect(readFileSync(join(home, 'new-ccd-link'), 'utf8')).toBe('#!/bin/sh\n# the NEW ccd\n');
    expect(readFileSync(join(home, '.cc-sessions', 'session-hook.sh'), 'utf8')).toBe('OLD hook\n');
    expect(readFileSync(join(home, unitRel), 'utf8')).toBe(unitBefore);
    // … and the live data did not: memory keeps the write made during the
    // update, coord.db is the same file with the same bytes.
    expect(readFileSync(join(home, '.ccrc', 'memory', 'fixture-proj', 'MEMORY.md'), 'utf8'))
      .toBe('written while the update ran\n');
    expect(statSync(db).ino).toBe(dbIno);
    expect(readFileSync(db).equals(dbBytes), 'arm 3 restored coord.db').toBe(true);
    if (darwin) {
      // launchd's daemon-reload + restart: bootout the job it holds (the NEW
      // definition — this fixture wrote `NEW job file` over the plist), then
      // bootstrap the restored plist. A bare `kickstart -k` would restart the
      // cached new definition.
      const lc = readFileSync(join(home, 'launchctl-calls'), 'utf8').split('\n');
      const out = lc.findIndex((l) => /^bootout \S+\/app\.ccrc\.ccrc$/.test(l));
      const back = lc.findIndex((l, i) => i > out && /^bootstrap \S+ \S+\/app\.ccrc\.ccrc\.plist$/.test(l));
      expect(out, `arm 3 never booted out the job launchd held:\n${lc.join('\n')}`).toBeGreaterThan(-1);
      expect(back, 'arm 3 never bootstrapped the restored plist after the bootout').toBeGreaterThan(out);
      expect(lc.some((l) => /^kickstart -k \S+\/app\.ccrc\.ccrc$/.test(l)), 'arm 3 kickstarted the cached definition').toBe(false);
      expect(existsSync(join(home, 'systemctl-calls')), 'a Darwin restore reached systemctl').toBe(false);
    } else {
      const calls = readFileSync(join(home, 'systemctl-calls'), 'utf8').split('\n');
      const reload = calls.indexOf('--user daemon-reload');
      const restart = calls.indexOf('--user restart ccrc.service');
      expect(reload, 'arm 3 restored unit files without daemon-reload').toBeGreaterThan(-1);
      expect(restart).toBeGreaterThan(reload);
      expect(calls.join('\n')).not.toMatch(/try-restart/);
    }
    const last = lastReport(home);
    expect(last['phase']).toBe('reverted');
    expect(String(last['detail'])).toMatch(/^arm3: tree MIXED, deploy\.sh is the remedy; gate: /);
  });

  it('an unversioned box has no tag to re-install: arm 2 says so and arm 3 runs', () => {
    const home = freshUpdateBox('ccrc-update-restore-untagged-');
    plantRestoreBox(home, { oldVersion: null });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(readFileSync(join(home, '.ccrc', 'previous'), 'utf8').split('\n')[0]).toBe('untagged');
    expect(r.stdout).toMatch(/^update: arm 2: previous build carried no tag — arm 3$/m);
    expect(restoreChildArgv(home)).toBeNull();
    expect(String(lastReport(home)['detail'])).toMatch(/^arm3: /);
  });

  // Fix round 1 item 2 / review 155 C1: arm 2 never "restores" to the tag
  // whose install just failed its gate. A same-tag `--force` reinstall
  // (this run's target IS the release that was already running) skips arm
  // 2 outright — re-installing that tag is exactly what just failed — and
  // falls straight to arm 3, the pre-update backup (which for a same-tag
  // run IS that same release). The reviewer's own probe: `update --to
  // v2.0.0 --force` on a v2.0.0 box whose gate fails ends with arm 3, NEVER
  // `REVERTED (arm 2)`, and `previous` still names v1.0.0.
  it('a same-tag --force reinstall whose gate fails skips arm 2 and falls straight to arm 3; previous still names the release before this run — a DIFFERENT staged sha keeps MIXED (fix round 1 item 2 / review 155 C1; review fix round 1 I3)', () => {
    const home = freshUpdateBox('ccrc-update-restore-sametag-');
    // NOT `plantRestoreBox({ oldVersion: 'v2.0.0' })`: that fixture's own
    // "old" and (unconditional) "target" packRelease calls both build a
    // `payload-v2.0.0` tree, and a same-tag run needs only ONE — a second
    // `stubTree` over the same path leaves a stale MANIFEST entry for
    // MANIFEST's own (about-to-be-overwritten) content, which then fails
    // its own digest check. Built directly instead, same tag, once.
    plantOldBox(home, { version: 'v2.0.0' });
    writeFileSync(join(home, '.ccrc', 'installed'), `${OLD_SHA}\n`);
    writeFileSync(join(home, '.ccrc', 'previous'), 'v1.0.0\nbaselinesha\n');
    // `stubTree`'s own sha (`newsha…`) DIFFERS from the box's OLD_SHA — a
    // same tag, but a REBUILD, not a repeat: arm 3 must still say MIXED.
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    // The gate fails regardless of version match — /health simply never
    // answers — so the same-tag skip is exercised on its own, not masked by
    // a version-mismatch gate failure that a same-tag run could never hit.
    writeFileSync(join(home, 'fixture-health-down'), 'yes\n');
    const r = runUpdate(home, ['--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout).toMatch(/^update: arm 2: this run's target is v2\.0\.0, the release that was already running — re-installing it is what just failed its gate; arm 3$/m);
    expect(restoreChildArgv(home)).toBeNull();
    expect(r.stdout).not.toMatch(/REVERTED \(arm 2\)/);
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 3\): copied the pre-update backup back — the tree is MIXED \(new shared\/, ccd\/ and node_modules under the old dists\); the remedy is deploy\.sh\. Best effort\.$/m);
    expect(String(lastReport(home)['detail'])).toBe('arm3: tree MIXED, deploy.sh is the remedy; gate: GET http://127.0.0.1:7788/health got no answer (curl exited 7)');
    expect(readFileSync(join(home, '.ccrc', 'previous'), 'utf8')).toBe('v1.0.0\nbaselinesha\n');
  });

  // Review fix round 1 I3's other half: the SAME sha under the same tag —
  // a genuine repeat, not a rebuild — so arm 3 must say the tree is NOT
  // mixed and name the honest remedy (the gate's own failure is this box's
  // health, not its code).
  it('a same-tag --force reinstall whose STAGED sha equals the running build\'s: arm 3 says not mixed, names ccrc doctor / a plain reinstall (review fix round 1 I3, D-3288)', () => {
    const home = freshUpdateBox('ccrc-update-restore-samebuild-');
    plantOldBox(home, { version: 'v2.0.0' });
    writeFileSync(join(home, '.ccrc', 'installed'), `${OLD_SHA}\n`);
    writeFileSync(join(home, '.ccrc', 'previous'), 'v1.0.0\nbaselinesha\n');
    // selfConvergedTree: the staged tree's OWN sha is made to match the
    // box's running stamp (OLD_SHA) — a genuine REPEAT of the release
    // already running, not a rebuild under the same tag.
    packRelease(home, selfConvergedTree(home, 'v2.0.0', OLD_SHA), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-health-down'), 'yes\n');
    const r = runUpdate(home, ['--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout).toMatch(/^update: arm 2: this run's target is v2\.0\.0, the release that was already running — re-installing it is what just failed its gate; arm 3$/m);
    expect(r.stdout).not.toMatch(/REVERTED \(arm 2\)/);
    expect(r.stdout).not.toMatch(/MIXED/);
    expect(r.stdout).not.toMatch(/deploy\.sh is the remedy/);
    expect(r.stdout).toMatch(
      /^update: REVERTED \(arm 3\): copied the pre-update backup back — this box's tree is v2\.0\.0 again, the SAME release that was running before this update; nothing is mixed\. Read 'ccrc doctor' for why the gate failed, or once fixed: ccrc update --to v2\.0\.0 --force\. Best effort\.$/m);
    expect(String(lastReport(home)['detail'])).toBe(
      'arm3: restored v2.0.0 (same build, not mixed); gate: GET http://127.0.0.1:7788/health got no answer (curl exited 7)');
    expect(readFileSync(join(home, '.ccrc', 'previous'), 'utf8')).toBe('v1.0.0\nbaselinesha\n');
  });

  // Fix round 2, F1 (review 167): the reviewer's own half-installed
  // same-tag probe — plantOldBox v2.0.0, NO `.ccrc/installed` (a prior
  // spine died after `_inst_stamp`, before the completed-install record —
  // `old_completed=0`), NO `.ccrc/previous` (so arm 2 falls to arm 3 via its
  // existing "absent" case, UNCHANGED by this round), the v2.0.0 release
  // packed so its STAGED sha equals the running stamp's own (`OLD_SHA`),
  // health down. Built directly (one `stubTree`/`selfConvergedTree` call for
  // the one tag), never `plantRestoreBox({ oldVersion: 'v2.0.0' })`, which
  // publishes a SECOND `payload-v2.0.0` tree and corrupts its own MANIFEST.
  // D-3288 (amended): `old_completed` must be 1, not just a staged-sha
  // match, before arm 3 may say "not mixed" — this box's backup is a
  // snapshot of a tree that was never proven whole, so arm 3 says only that
  // the PRE-UPDATE tree came back.
  it('a same-tag rerun over a half-installed tree (no completed-install record) never says "not mixed", even when the staged sha matches the running stamp (F1, D-3288 amended)', () => {
    const home = freshUpdateBox('ccrc-update-restore-halfinstalled-samebuild-');
    plantOldBox(home, { version: 'v2.0.0' });
    packRelease(home, selfConvergedTree(home, 'v2.0.0', OLD_SHA), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-health-down'), 'yes\n');
    const r = runUpdate(home, ['--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(existsSync(join(home, '.ccrc', 'previous'))).toBe(false);
    expect(restoreChildArgv(home)).toBeNull();
    expect(r.stdout).not.toMatch(/REVERTED \(arm 2\)/);
    expect(r.stdout).toMatch(/^update: arm 2: no ~\/\.ccrc\/previous — the build this box ran before is not recorded — arm 3$/m);
    // T1 (review 173): the old `not.toMatch(/not mixed/)` guarded nothing —
    // the sentence it meant to keep out says "nothing is mixed", which that
    // pattern never matched. Both spellings are the claim this case forbids.
    expect(r.stdout).not.toMatch(/nothing is mixed|not mixed/);
    expect(r.stdout).not.toMatch(/deploy\.sh is the remedy/);
    expect(r.stdout).toMatch(
      /^update: REVERTED \(arm 3\): copied the pre-update backup back — this box's tree is v2\.0\.0 again, the PRE-UPDATE tree, which may itself be MIXED\. Read 'ccrc doctor' for its state, or once healthy: ccrc update --to v2\.0\.0 --force\. Best effort\.$/m);
    expect(String(lastReport(home)['detail'])).toBe(
      'arm3: restored v2.0.0 (pre-update tree, may be mixed); gate: GET http://127.0.0.1:7788/health got no answer (curl exited 7)');
  });

  // Review 173's F1r (W6 Task 8A; the coordinator's ruling: THE STAGED SHA
  // DECIDES MIXED, whatever the record says). The reviewer's input: the stamp
  // names v2.0.0 at sha A, there is no completed-install record, `previous`
  // is absent or names v2.0.0, the v2.0.0 release stages sha B, and `update
  // --to v2.0.0 --force` fails its gate. The staged install's wholesale
  // copies (shared/, the tree's ccd/, node_modules, build.json) are sha B's
  // while arm 3 copies back only the backup's `tree` rows — the tree IS mixed,
  // and the verdict must say MIXED, never "may itself be MIXED".
  it.each([
    ['previous absent', null],
    ['previous naming the target', 'v2.0.0\nbaselinesha\n'],
  ] as const)('F1r: a same-tag rerun with NO completed record whose STAGED sha differs from the running stamp\'s is MIXED, never "may be mixed" — %s (review 173, D-3288 amended)', (_what, previous) => {
    const home = freshUpdateBox('ccrc-update-restore-f1r-');
    plantOldBox(home, { version: 'v2.0.0' });                   // stamp sha OLD_SHA, no record
    if (previous !== null) writeFileSync(join(home, '.ccrc', 'previous'), previous);
    // `stubTree`'s own sha (`newsha…`) is not OLD_SHA: sha B.
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-health-down'), 'yes\n');
    const r = runUpdate(home, ['--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(existsSync(join(home, '.ccrc', 'installed')), 'the fixture has a completed record — the input is wrong').toBe(false);
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 3\): copied the pre-update backup back — the tree is MIXED \(new shared\/, ccd\/ and node_modules under the old dists\); the remedy is deploy\.sh\. Best effort\.$/m);
    expect(r.stdout).not.toMatch(/may itself be MIXED|may be mixed|nothing is mixed|not mixed/i);
    expect(String(lastReport(home)['detail'])).toBe('arm3: tree MIXED, deploy.sh is the remedy; gate: GET http://127.0.0.1:7788/health got no answer (curl exited 7)');
    expect(lastReport(home)['phase']).toBe('reverted');
    // `previous` is written by no branch of arm 3, and this run kept it as it was.
    if (previous === null) expect(existsSync(join(home, '.ccrc', 'previous'))).toBe(false);
    else expect(fileText(join(home, '.ccrc', 'previous'))).toBe(previous);
  });

  // Fix round 2, F2 input (a) (review 167; rulings item 1): a same-tag rerun
  // with NO completed record still finds `previous` naming the EXACT tag
  // that just failed — the reviewer's own scenario: an earlier `update --to
  // v3.0.0` wrote `previous: v2.0.0` as ITS baseline, then its spine died
  // before the tree moved, so the box never actually left v2.0.0; a LATER
  // update resolving v2.0.0 again fails its gate too. `old_completed=0` (no
  // `.ccrc/installed`) means the FIRST arm-2 check (keyed on it) never
  // fires; only the SECOND check — `$UPD_PREV_TAG` against `$UPD_VERSION`,
  // read straight off `.ccrc/previous` — catches this. Built directly: the
  // fixture plants `previous` at the state the earlier (died) run would have
  // left it in, rather than actually running `ccrc update` twice.
  it('F2 (a): a same-tag rerun with no completed record still skips arm 2 when `previous` already names the tag that just failed (review 167)', () => {
    const home = freshUpdateBox('ccrc-update-restore-f2a-');
    plantOldBox(home, { version: 'v2.0.0' });
    // NO .ccrc/installed. `previous` already names v2.0.0 — written by an
    // earlier `update --to v3.0.0` whose spine died before the tree moved.
    writeFileSync(join(home, '.ccrc', 'previous'), `v2.0.0\n${OLD_SHA}\n`);
    // A RUNNABLE restore child (review 167 N1): without one, `~/ccrc/ccd/ccrc`
    // never exists and arm 2 falls to arm 3 for THAT reason on every tree,
    // fixed or not — the pin would then be red on 7a20ff8f for the wrong
    // cause. With the child placed, the check this pin is FOR is what decides
    // whether arm 2 ever reaches it: unfixed code has no second check, runs
    // the child (which always exits 0), and prints the false `REVERTED
    // (arm 2)` F2 describes; the check2 fix here skips arm 2 before ever
    // looking at the child.
    writeFileSync(join(home, 'fixture-restore-child'), RESTORE_RECORDER);
    writeFileSync(join(home, 'fixture-on-install'),
      'mkdir -p "$HOME/ccrc/ccd" && cp "$HOME/fixture-restore-child" "$HOME/ccrc/ccd/ccrc"\n');
    // Published TWICE: `latest/download` (this run's own no-`--to` fetch)
    // AND `download/v2.0.0` (arm 2's own bundle probe, `_upd_asset_listed
    // v2.0.0 …`, which is tag-scoped and never reads `latest`). Same tree,
    // no rebuild — `packRelease` only tars what `stubTree` already built.
    // The STAGED sha equals the running stamp's (`selfConvergedTree`): a
    // different one is MIXED since review 173's F1r (the staged sha decides),
    // and this case pins the F1/F2 interaction on the same-sha, no-record
    // verdict.
    const f2aTree = selfConvergedTree(home, 'v2.0.0', OLD_SHA);
    packRelease(home, f2aTree, { tag: 'v2.0.0' });
    packRelease(home, f2aTree, { tag: 'v2.0.0', latest: false });
    writeFileSync(join(home, 'fixture-health-down'), 'yes\n');
    const r = runUpdate(home, ['--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(restoreChildArgv(home)).toBeNull();
    expect(r.stdout).not.toMatch(/REVERTED \(arm 2\)/);
    expect(r.stdout).toMatch(
      /^update: arm 2: previous \(v2\.0\.0\) also names v2\.0\.0, the release that just failed its gate — re-installing it would not restore anything; arm 3$/m);
    expect(readFileSync(join(home, '.ccrc', 'previous'), 'utf8')).toBe(`v2.0.0\n${OLD_SHA}\n`);
    // The F1/F2 interaction the reviewer flagged: this same-tag, same-sha,
    // no-record run also falls into arm 3's `same_tag` branch, so it lands on
    // F1's own "may be mixed" line, never "not mixed" and never `deploy.sh`.
    expect(r.stdout).toMatch(
      /^update: REVERTED \(arm 3\): copied the pre-update backup back — this box's tree is v2\.0\.0 again, the PRE-UPDATE tree, which may itself be MIXED\. Read 'ccrc doctor' for its state, or once healthy: ccrc update --to v2\.0\.0 --force\. Best effort\.$/m);
    expect(String(lastReport(home)['detail'])).toMatch(/^arm3: restored v2\.0\.0 \(pre-update tree, may be mixed\); gate: /);
  });

  // Fix round 2, F2 input (b) (review 167; rulings item 1): the reviewer's
  // OTHER input — the stamp is v2.0.0 with NO completed record, `previous`
  // names v1.0.0, then `update --to v1.0.0 --downgrade`. `_upd_write_previous`
  // KEEPS v1.0.0 (D-3254 (b): no completed record, but a well-formed
  // `previous` to keep), so by the time the gate fails, `previous` names
  // EXACTLY the tag this run just failed to install — arm 2's second check
  // must catch it even though `old_version` (v2.0.0) and `UPD_VERSION`
  // (v1.0.0) plainly differ, so the FIRST check never even looks.
  it('F2 (b): a downgrade with no completed record skips arm 2 when `previous` already names the target that just failed (review 167)', () => {
    const home = freshUpdateBox('ccrc-update-restore-f2b-');
    plantOldBox(home, { version: 'v2.0.0' });
    // NO .ccrc/installed. `previous` already names v1.0.0.
    writeFileSync(join(home, '.ccrc', 'previous'), 'v1.0.0\nbaselinesha\n');
    // A RUNNABLE restore child (review 167 N1) — see F2 (a)'s comment for why
    // one is needed: without it, arm 2 falls to arm 3 on EVERY tree because
    // `~/ccrc/ccd/ccrc` is absent, not because of the check this pin is for.
    writeFileSync(join(home, 'fixture-restore-child'), RESTORE_RECORDER);
    writeFileSync(join(home, 'fixture-on-install'),
      'mkdir -p "$HOME/ccrc/ccd" && cp "$HOME/fixture-restore-child" "$HOME/ccrc/ccd/ccrc"\n');
    packRelease(home, stubTree(home, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
    writeFileSync(join(home, 'fixture-health-down'), 'yes\n');
    const r = runUpdate(home, ['--to', 'v1.0.0', '--downgrade']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(restoreChildArgv(home)).toBeNull();
    expect(r.stdout).not.toMatch(/REVERTED \(arm 2\)/);
    expect(r.stdout).toMatch(
      /^update: arm 2: previous \(v1\.0\.0\) also names v1\.0\.0, the release that just failed its gate — re-installing it would not restore anything; arm 3$/m);
    expect(readFileSync(join(home, '.ccrc', 'previous'), 'utf8')).toBe('v1.0.0\nbaselinesha\n');
  });

  // Review fix round 1 I4: item 2's same-tag skip narrows to a COMPLETED
  // install of the running tag. D-3240's own scenario — a spine that died
  // after `_inst_stamp` (the stamp reads the new tag, no completed-install
  // record) — reruns `ccrc update --to <v> --force`, which is a SAME-TAG
  // run by the stamp, but the box was never WHOLE on that tag: arm 2 must
  // still restore `previous` (v1.0.0, the last DIFFERENT, COMPLETED
  // release), never fall straight to arm 3 over the half-installed tree
  // this very rerun started from.
  it('a same-tag rerun over a HALF-installed tree (record absent) still lets arm 2 restore previous, a DIFFERENT release (review fix round 1 I4)', () => {
    const home = freshUpdateBox('ccrc-update-restore-halfinstalled-sametag-');
    plantOldBox(home, { version: 'v2.0.0' });   // stamp already reads v2.0.0 (the dead spine moved it)
    // NO .ccrc/installed at all: that spine died before its own record.
    writeFileSync(join(home, '.ccrc', 'previous'), 'v1.0.0\nbaselinesha\n');
    // v1.0.0: arm 2's own fetch target — a separate tree, no MANIFEST clash.
    packRelease(home, stubTree(home, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
    // v2.0.0 (this rerun's target, same tag as the stamp): swaps in the
    // RESTORE_RECORDER after its own "install" step, exactly as
    // `plantRestoreBox` does, so arm 2's child (which also runs
    // `$BOX_TREE_DIR/ccd/ccrc`, the SAME tree) hits the recorder rather
    // than a bare stub.
    writeFileSync(join(home, 'fixture-restore-child'), RESTORE_RECORDER);
    writeFileSync(join(home, 'fixture-on-install'),
      'mkdir -p "$HOME/ccrc/ccd" && cp "$HOME/fixture-restore-child" "$HOME/ccrc/ccd/ccrc"\n');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-health-pin'), 'v1.0.0\n');   // the gate never sees v2.0.0: FAILS
    // No --to: v2.0.0 is published as latest/download (packRelease's own
    // default), matching D-3240's prescribed rerun resolving the same way
    // the original (now half-installed) run did.
    const r = runUpdate(home, ['--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    // Arm 2 restores v1.0.0 — a REAL restore child ran, never the same-tag
    // skip line.
    expect(r.stdout).not.toMatch(/this run's target is v2\.0\.0, the release that was already running/);
    expect(restoreChildArgv(home)).toEqual([
      join(home, 'ccrc', 'ccd', 'ccrc'), 'update', '--to', 'v1.0.0', '--no-gate', '--from', 'restore',
    ]);
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 2\): this box runs v1\.0\.0 again, re-installed from its release — gate: /m);
    expect(r.stdout).not.toMatch(/REVERTED \(arm 3\)/);
    const last = lastReport(home);
    expect(last['phase']).toBe('reverted');
    expect(String(last['detail'])).toMatch(/^arm2: restored v1\.0\.0; gate: /);
  });

  it('a `previous` that went missing or unreadable after it was written falls to arm 3 by name — never a guessed tag', () => {
    const cases: Array<[string, string, RegExp]> = [
      ['absent', 'rm -f "$HOME/.ccrc/previous"', /^update: arm 2: no ~\/\.ccrc\/previous — the build this box ran before is not recorded — arm 3$/m],
      ['malformed', 'printf \'three\\n\' > "$HOME/.ccrc/previous"', /^update: arm 2: ~\/\.ccrc\/previous is unreadable or malformed — arm 3$/m],
    ];
    for (const [name, line, says] of cases) {
      const home = freshUpdateBox(`ccrc-update-restore-prev-${name}-`);
      plantRestoreBox(home, { onInstall: [line] });
      const r = runUpdate(home);
      expect(r.code, `${name}: stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
      expect(r.stdout, name).toMatch(says);
      expect(restoreChildArgv(home), name).toBeNull();
      expect(String(lastReport(home)['detail']), name).toMatch(/^arm3: /);
    }
  });

  it('a spine that died after the tree moved, then failed the gate, restores and exits 4 — the reason names the step (completes §18 "a spine death after the tree moved reverts")', () => {
    const home = freshUpdateBox('ccrc-update-restore-spine-');
    plantRestoreBox(home, { installExit: 1 });
    writeFileSync(join(home, 'fixture-install-step'), '_inst_skills\n');   // Task 4's knob
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    const details = reportWrites(home).map((w) => `${String(w['phase'])} ${String(w['detail'])}`);
    expect(details).toContain('failed spine died at _inst_skills');
    expect(restoreChildArgv(home)).toEqual([
      join(home, 'ccrc', 'ccd', 'ccrc'), 'update', '--to', 'v1.0.0', '--no-gate', '--from', 'restore',
    ]);
    expect(String(lastReport(home)['detail'])).toMatch(/^arm2: restored v1\.0\.0; spine died at _inst_skills; gate: /);
  });

  it('a fleet box\'s arm 3 restarts ccrc-agent.service — the unit that box has — and never ccrc.service', () => {
    const home = freshUpdateBox('ccrc-update-restore-fleet-');
    plantRestoreBox(home, { child: 'broken' });
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=fleet\n');
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');   // Task 5's knob: the fleet gate fails (Linux)…
    writeFileSync(join(home, 'fixture-main-pid-churn'), 'yes\n'); // …and its Darwin twin (launchd has no is-active)
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 3\): /m);
    if (process.platform === 'darwin') {
      const calls = readFileSync(join(home, 'launchctl-calls'), 'utf8');
      expect(calls).toMatch(/^bootout \S+\/app\.ccrc\.ccrc-agent$/m);
      expect(calls).toMatch(/^bootstrap \S+ \S+\/app\.ccrc\.ccrc-agent\.plist$/m);
      expect(calls).not.toMatch(/^bootout \S+\/app\.ccrc\.ccrc$/m);
      expect(calls).not.toMatch(/^bootstrap \S+ \S+\/app\.ccrc\.ccrc\.plist$/m);
    } else {
      const calls = readFileSync(join(home, 'systemctl-calls'), 'utf8');
      expect(calls).toMatch(/^--user restart ccrc-agent\.service$/m);
      expect(calls).not.toMatch(/^--user restart ccrc\.service$/m);
    }
  });

  it('a release host that answers 503 to the bundle question is not "ships no bundle": arm 2 runs the child without --allow-unsigned and lets its own fetch decide', () => {
    const home = freshUpdateBox('ccrc-update-restore-host-5xx-');
    // Planted by the new tree's install, i.e. AFTER the parent fetched its own
    // release: only arm 2's question meets the 503.
    plantRestoreBox(home, { onInstall: ['printf \'503\\n\' > "$HOME/fixture-release-http"'] });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    // Fix round 1 item 12: the message now names the probe's own timeout bound.
    expect(r.stdout).toMatch(/^update: arm 2: could not ask the release host whether v1\.0\.0 ships a bundle within \d+s \(curl failed, timed out, or the host answered neither 200 nor 404\) — the restore child's own fetch decides$/m);
    expect(r.stdout).not.toMatch(/arm2-refused/);
    expect(restoreChildArgv(home)).toEqual([
      join(home, 'ccrc', 'ccd', 'ccrc'), 'update', '--to', 'v1.0.0', '--no-gate', '--from', 'restore',
    ]);
    expect(String(lastReport(home)['detail'])).toMatch(/^arm2: restored v1\.0\.0; gate: /);
  });

  // F10 (fix round 1): `_upd_asset_listed`'s rc 3 is a base this box cannot read, never curl or the host. The new tree's install
  // adds an `export` mirror line beside the plain one the parent fetched through, so only arm 2's question meets the refusal.
  it('a release base arm 2 cannot read is named as that, not as curl, and the restore child still decides (F10)', () => {
    const home = freshUpdateBox('ccrc-update-restore-base-');
    plantRestoreBox(home, { onInstall: [`printf 'export CCRC_RELEASE_BASE_URL=local://%s/releases\\n' "$HOME" >> "$HOME/.ccrc/ccrc.env"`] });
    appendFileSync(join(home, '.ccrc', 'ccrc.env'), `CCRC_RELEASE_BASE_URL=local://${home}/releases\n`);
    const r = runUpdate(home, [], { CCRC_RELEASE_BASE_URL: '' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout.split('\n')).toContain('update: arm 2: CCRC_RELEASE_BASE_URL cannot be measured: ~/.ccrc/ccrc.env names it on a line '
      + 'this reader does not take (it reads only a plain KEY=value line), so no host was asked whether v1.0.0 ships a bundle — the '
      + 'restore child\'s own resolve decides');
    expect(r.stderr).toContain('ccrc: CCRC_RELEASE_BASE_URL cannot be measured: ~/.ccrc/ccrc.env names it on a line this reader does not take');
    expect(r.stdout).not.toContain('curl failed');
    expect(restoreChildArgv(home)).toEqual([
      join(home, 'ccrc', 'ccd', 'ccrc'), 'update', '--to', 'v1.0.0', '--no-gate', '--from', 'restore',
    ]);
  });

  it('a spine that COMPLETED and then failed its gate, restored by arm 3: the completed-install record goes, so the box reads incomplete — never converged on the release it backed out of', () => {
    const home = freshUpdateBox('ccrc-update-restore-unrecord-');
    // What a completed v2.0.0 spine leaves before the gate runs: its stamp and
    // its completed-install record, agreeing. That pair is what
    // `_upd_converged` and `update --check` read as "current at v2.0.0".
    const newSha = 'newsha0000000000000000000000000000000000';
    plantRestoreBox(home, {
      child: 'broken',
      onInstall: [
        `printf '%s\\n' '${shippedStamp('v2.0.0', newSha).trim()}' > "$HOME/.ccrc/build.json"`,
        `printf '%s\\n' '${newSha}' > "$HOME/.ccrc/installed"`,
      ],
    });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 3\): /m);
    expect(r.stdout).toMatch(/^update: arm 3: the completed-install record is gone — this box reads install: incomplete until deploy\.sh or a completed update records it again$/m);
    expect(existsSync(join(home, '.ccrc', 'installed')), 'arm 3 left the reverted build\'s record').toBe(false);
    // The stamp still names v2.0.0 (arm 3 copies no stamp back; the tree is
    // MIXED), so the honest word is `incomplete` — never `current`.
    const c = runUpdate(home, ['--check']);
    // RULING C1: `cmd_update --check`'s `incomplete` arm returns 1 (D-3266
    // keeps incomplete/exit 1) — not the 0 an earlier draft of this case typed.
    expect(c.code, `stderr: ${c.stderr}\nstdout: ${c.stdout}`).toBe(1);
    expect(c.stdout).toMatch(new RegExp(`^check: box=v2\\.0\\.0 sha=${newSha} target=v2\\.0\\.0 (.* )?state=incomplete$`, 'm'));   // Task 12 adds fields before `state=`
  });

  it('--from restore is refused unless this run is the child of an update holding the lock — it is not a typed way past the floor or the sweep', () => {
    const home = freshUpdateBox('ccrc-update-from-restore-bare-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    // No marker at all, and a marker naming a pid that is not this run's parent.
    for (const extra of [{}, { CCRC_UPDATE_LOCK_HELD: '1' }]) {
      const r = runUpdate(home, ['--to', 'v2.0.0', '--from', 'restore'], extra);
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(2);
      expect(r.stderr).toMatch(/^ccrc: update: --from restore is the automatic restore's own word — it runs only as the child of an update holding ~\/\.ccrc\/update\.lock \(it skips the floor, previous and the sweep\); to move this box to a tag by hand: ccrc update --to <tag> --downgrade$/m);
      expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
      expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
      expect(localUrls(home)).toEqual([]);
    }
  });

  it('FULL flavour: the arm-2 child is a REAL `ccrc update` that completes under the parent\'s lock — no lock sentence, no sweep, the previous tag re-installed (§18 "arm 2 runs under the parent\'s lock"; Review Focus 4)', () => {
    // The parent installs the FULL v2.0.0 tree (the real spine places the
    // real `ccd/ccrc` at ~/ccrc/ccd/ccrc), fails its gate, and arm 2 runs that
    // placed ccrc as a child against the STUB v1.0.0 release. The child's own
    // lock (Task 2) must INHERIT — marker = its $PPID, and a fresh flock -n
    // fails because the parent holds the lock — or it refuses with "another
    // update holds …" and every restore silently becomes arm 3.
    const home = freshUpdateBox('ccrc-update-restore-full-');
    plantOldBox(home, { version: 'v1.0.0' });
    writeFileSync(join(home, '.ccrc', 'installed'), `${OLD_SHA}\n`);
    packRelease(home, stubTree(home, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000' }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-health-pin'), 'v1.0.0\n');
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(`${r.stdout}\n${r.stderr}`).not.toMatch(/another update holds/);
    expect(`${r.stdout}\n${r.stderr}`).not.toMatch(/ambiguous redirect/);
    expect(r.stderr).not.toMatch(/--from restore is the automatic restore's own word/);
    // The child's own transcript: it kept `previous`, skipped the sweep, and
    // its staged install (the STUB v1.0.0 shim) actually ran.
    expect(r.stdout).toMatch(/^update: previous: kept \(v1\.0\.0\)/m);
    // The two exemptions a bare --from restore can no longer be typed to
    // reach (Step 1 (c)), measured here on the real child: the parent's
    // completed spine raised the floor to v2.0.0, and the restore goes below
    // it saying so, without lowering it (spec §9, Task 1's `--from` arm).
    expect(r.stdout).toMatch(/^update: WARN: v1\.0\.0 is below this box's floor v2\.0\.0 \(resolved by --to v1\.0\.0\) — proceeding because this run is --from restore; the floor stays v2\.0\.0$/m);
    expect(readFileSync(join(home, '.ccrc', 'floor'), 'utf8')).toBe('v2.0.0\n');
    expect(r.stdout).toMatch(/^update: sweep: skipped — a --from restore run returns the supervisors' own build; they never moved$/m);
    expect(existsSync(join(home, 'staged-ccrc-argv')), 'the restore child\'s staged install never ran').toBe(true);
    expect(localUrls(home)).toContain(`local://${home}/releases/download/v1.0.0/ccrc-v1.0.0.tar.gz`);
    const writes = reportWrites(home);
    expect(writes.some((w) => w['from'] === 'restore' && w['phase'] === 'installing'),
      'the child reported no install of its own').toBe(true);
    const last = lastReport(home);
    expect(last['phase']).toBe('reverted');
    expect(last['from']).toBe('cli');
    expect(String(last['detail'])).toMatch(/^arm2: restored v1\.0\.0; gate: /);
    expect(r.stdout).not.toMatch(/REVERTED \(arm 3\)/);
    expect(readFileSync(join(home, '.ccrc', 'previous'), 'utf8').split('\n')[0]).toBe('v1.0.0');
  });

  // Fix round 1 item 16 / review 155 C25: the backup directory has ONE-
  // SECOND resolution and `mkdir -p` used to accept one that already
  // exists — so arm 2's child, starting its own backup in the SAME SECOND
  // as the parent's (both real `ccrc update` runs, `date` frozen here so
  // the review's probe is deterministic rather than a real-clock race),
  // would `cp -a` its files INTO the parent's own backup directory,
  // corrupting it (overwriting `ccd`, nesting dists inside dists). Now the
  // child's OWN `_upd_backup` refuses outright — arm 2 falls to arm 3
  // reporting "arm 2 failed", and arm 3 restores the PARENT's backup,
  // which the child's refused mkdir never touched.
  it('the same-second parent and child: the child\'s backup refuses rather than corrupting the parent\'s, and arm 3 restores the UNCORRUPTED one (fix round 1 item 16 / review 155 C25)', () => {
    const home = freshUpdateBox('ccrc-update-restore-samesecond-backup-');
    plantOldBox(home, { version: 'v1.0.0' });
    writeFileSync(join(home, '.ccrc', 'installed'), `${OLD_SHA}\n`);
    packRelease(home, stubTree(home, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000' }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-health-pin'), 'v1.0.0\n');
    // ONE frozen backup timestamp for every `date +%Y%m%d-%H%M%S` this run's
    // processes make — the parent's own backup AND arm 2's child's, so the
    // collision is deterministic rather than a real-clock race. Everything
    // else (`+%s`, doctor's own date reads) passes through to the real
    // binary, untouched.
    writeFileSync(join(home, 'doctor-stubs', 'date'),
      '#!/bin/sh\n'
      + 'if [ "$#" -eq 1 ] && [ "$1" = "+%Y%m%d-%H%M%S" ]; then echo "20260101-000000"; exit 0; fi\n'
      + `exec ${REAL_DATE} "$@"\n`, { mode: 0o755 });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    const backupDir = join(home, 'ccrc-backups', '20260101-000000');
    // The child's own refusal, on ITS stderr (inherited straight through) —
    // never a corrupted copy. Fix round 1 item 11 / review 155 C17: the
    // absolute HOME is redacted to `~` by `_ccrc_die`'s own hook now, so
    // this reads `~/ccrc-backups/…`, never the fixture's own tmp path (the
    // FILESYSTEM checks below still use the real `backupDir`, unredacted).
    // Review fix round 1, N3: the verdict now leads (D-3249), matching the
    // reordered floor sentences.
    expect(r.stderr).toMatch(
      /^ccrc: already exists: ~\/ccrc-backups\/20260101-000000 \(another backup started in the same second\) — refusing to reuse a backup directory; nothing on this box was changed by this step$/m);
    expect(r.stdout).toMatch(/^update: arm 2 failed \(the restore child exited 1\) — falling to arm 3$/m);
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 3\): /m);
    expect(r.stdout).not.toMatch(/REVERTED \(arm 2\)/);
    // The PARENT's own backup — the only one that ever wrote a single file —
    // still holds the OLD (v1.0.0) tree it snapshotted before installing
    // v2.0.0, never overwritten by the child's refused attempt.
    expect(existsSync(join(backupDir, 'ccd'))).toBe(true);
    expect(readFileSync(join(backupDir, 'ccd'), 'utf8')).toContain('the OLD ccd');
    const last = lastReport(home);
    expect(last['phase']).toBe('reverted');
    expect(String(last['detail'])).toMatch(/^arm3: /);
  });

  it('arm 3 leaves the collector\'s generation journal byte-identical: no backup holds it, so nothing copies it back (path-identity spec 2026-10-12 §5.3)', () => {
    const home = freshUpdateBox('ccrc-update-restore-arm3-journal-');
    plantRestoreBox(home, { oldVersion: null });
    plantCoordDb(home);
    const journal = plantCollectJournal(home);
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout).toMatch(/^update: arm 2: previous build carried no tag — arm 3$/m);
    expect(String(lastReport(home)['detail'])).toMatch(/^arm3: /);
    expectJournalUntouched(journal, 'arm 3');
    expect(journalCopiesUnder(announcedBackupDir(r.stdout, home)), 'the backup arm 3 restored from holds a copy of the journal')
      .toEqual([]);
  });
});

// Final review, B4 — D-3259's own promise, unnumbered (no new deviation):
// arm 3's per-row placement, sourced directly with `_plat_mv_notdir`
// shadowed so a specific call can be made to fail without a real filesystem
// race. Every case needs `live` to already be a REAL directory (not a
// symlink) — the branch `_upd_restore_copy` takes the aside/stage path for
// at all.
describe('_upd_restore_copy (arm 3\'s per-row placement): the move-back is checked (B4, was unchecked)', () => {
  const setup = (prefix: string): { home: string; back: string; live: string } => {
    // freshUpdateBox, not bare mkTmp: `sourcedCcrc` runs under `updateEnv`,
    // which plants its stubs into `~/.local/bin` and expects it to exist.
    const home = freshUpdateBox(prefix);
    const back = join(home, 'back');
    const live = join(home, 'live');
    mkdirSync(back, { recursive: true });
    writeFileSync(join(back, 'NEW-CONTENT'), 'the backup copy\n');
    mkdirSync(live, { recursive: true });
    writeFileSync(join(live, 'CURRENT-CONTENT'), 'what the new install placed\n');
    return { home, back, live };
  };
  /** `n=2` fails the stage→live rename; `n=3` (if reached) fails the
   *  move-back. Every other call is the REAL `mv -fT`, so the fixture
   *  measures the function's own recovery, not a mocked filesystem. */
  const shadow = (failCalls: number[]): string => [
    'n=0',
    '_plat_mv_notdir() {',
    '  n=$((n + 1))',
    `  case " ${failCalls.join(' ')} " in *" \${n} "*) return 1 ;; esac`,
    '  mv -fT -- "$1" "$2"',
    '}',
  ].join('\n');

  itLinux('both the stage→live rename AND the move-back fail: rc 2, live is GONE, the new install\'s copy survives at aside', () => {
    const { home, back, live } = setup('ccrc-restore-copy-rc2-');
    const r = sourcedCcrc(home, [
      shadow([2, 3]),
      `_upd_restore_copy '${back}' '${live}'; echo "rc=$?"`,
    ].join('\n'));
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('rc=2');
    expect(existsSync(live), 'arm 3 must never claim the row was "left as placed" when live does not exist').toBe(false);
    const leftover = readdirSync(home).find((n) => n.startsWith('live.ccrc-replaced.'));
    expect(leftover, 'the new install\'s own copy must survive somewhere findable').toBeDefined();
    expect(readFileSync(join(home, leftover!, 'CURRENT-CONTENT'), 'utf8')).toBe('what the new install placed\n');
    // The staging copy of the backup is cleaned up either way.
    expect(readdirSync(home).some((n) => n.startsWith('live.ccrc-restore.'))).toBe(false);
  });

  itLinux('the stage→live rename fails but the move-back SUCCEEDS: rc 1, live is unchanged — the ordinary "left as placed" arm', () => {
    const { home, back, live } = setup('ccrc-restore-copy-rc1-');
    const r = sourcedCcrc(home, [
      shadow([2]),
      `_upd_restore_copy '${back}' '${live}'; echo "rc=$?"`,
    ].join('\n'));
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('rc=1');
    expect(existsSync(live)).toBe(true);
    expect(readFileSync(join(live, 'CURRENT-CONTENT'), 'utf8')).toBe('what the new install placed\n');
    expect(existsSync(join(live, 'NEW-CONTENT'))).toBe(false);
    // No aside or stage copy left behind — this is the ordinary failure arm.
    expect(readdirSync(home).some((n) => n.startsWith('live.ccrc-replaced.'))).toBe(false);
    expect(readdirSync(home).some((n) => n.startsWith('live.ccrc-restore.'))).toBe(false);
  });

  itLinux('every rename succeeds: rc 0, live now holds the backup, and a failed `rm -rf` on the pre-restore copy is a WARN, not a failure', () => {
    const { home, back, live } = setup('ccrc-restore-copy-rc0-');
    const r = sourcedCcrc(home, `_upd_restore_copy '${back}' '${live}'; echo "rc=$?"`);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('rc=0');
    expect(readFileSync(join(live, 'NEW-CONTENT'), 'utf8')).toBe('the backup copy\n');
    expect(existsSync(join(live, 'CURRENT-CONTENT'))).toBe(false);
    expect(readdirSync(home).some((n) => n.startsWith('live.ccrc-replaced.'))).toBe(false);

    // B4 (no new deviation): a `rm -rf` failure on the pre-restore copy is
    // disk debris, not a wrong claim about where the tree is — checked, but
    // only for a WARN.
    const { home: home2, back: back2, live: live2 } = setup('ccrc-restore-copy-rm-warn-');
    const r2 = sourcedCcrc(home2, [
      // Only the ONE call arm 3's fix added — removing the pre-restore
      // copy on the SUCCESS path — fails; every other `rm` (the stage
      // dir's own setup/teardown) is the real command, or the function
      // could never reach the row it is meant to test.
      'rm() {',
      '  case "$*" in',
      '    "-rf -- "*.ccrc-replaced.*) return 1 ;;',
      '  esac',
      '  command rm "$@"',
      '}',
      `_upd_restore_copy '${back2}' '${live2}'; echo "rc=$?"`,
    ].join('\n'));
    expect(r2.code, r2.stderr).toBe(0);
    expect(r2.stdout).toContain('rc=0');
    expect(r2.stderr).toMatch(/WARN: could not remove .*\.ccrc-replaced\..* \(the pre-restore copy of/);
    expect(readFileSync(join(live2, 'NEW-CONTENT'), 'utf8')).toBe('the backup copy\n');
  });

  // Final review, B4 (no new deviation): `_upd_restore_arm3`'s own wiring of
  // a `_upd_restore_copy` rc-2 row — shadowed directly here rather than
  // through a full spine, so this measures arm 3's MESSAGE, not the
  // filesystem race the tests above already cover.
  itLinux('arm 3 never says "left as the new install placed it" for a row `_upd_restore_copy` reports MISSING (B4)', () => {
    const home = freshUpdateBox('ccrc-restore-arm3-missing-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'installed'), 'somesha0000000000000000000000000000000\n');
    mkdirSync(join(home, 'backups'), { recursive: true });
    const r = sourcedCcrc(home, [
      // One row, forced to the rc-2 (move-back also failed) arm — the exact
      // naming convention `_upd_restore_copy` itself uses.
      `_upd_backup_pairs() { printf 'tree\\t%s/live-row\\t%s\\n' "$HOME" 'live-row'; }`,
      'mkdir -p "$HOME/backups/live-row"',
      '_upd_restore_copy() { return 2; }',
      'UPD_BACKUP_DIR="$HOME/backups"',
      '_upd_restore_arm3 server "gate: fixture reason"',
    ].join('\n'));
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(new RegExp(`arm 3: ${home}/live-row is now MISSING — the new install's copy could not be moved back and sits at ${home}/live-row\\.ccrc-replaced\\.\\d+ — move it back by hand`));
    expect(r.stdout).not.toMatch(/left as the new install placed it/);
    expect(r.stdout).toMatch(/tree is MIXED AND 1 path\(s\) are MISSING/);
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 3\): /m);
  });

  // Review 173's T3: arm 3's three verdicts each have a MISSING-rows form, and
  // only the MIXED one was pinned. One row forced to `_upd_restore_copy`'s
  // rc 2, the arm called directly with each verdict's inputs — the same
  // shadowing the B4 case above uses — and the sentence AND the report detail
  // asserted for each.
  const ARM3_SHA_A = 'a'.repeat(40);
  const ARM3_SHA_B = 'b'.repeat(40);
  it.each([
    // [verdict, old_sha, staged sha, old_completed, stdout, detail]
    ['same_tag (same sha, no record)', ARM3_SHA_A, ARM3_SHA_A, 0,
      /^update: REVERTED \(arm 3\): copied the pre-update backup back — this box's tree is v2\.0\.0 again, the PRE-UPDATE tree, which may itself be MIXED, AND 1 path\(s\) are MISSING \(read the arm 3 lines above for where\)\. Read 'ccrc doctor' for its state, or once healthy: ccrc update --to v2\.0\.0 --force\. Best effort\.$/m,
      /^arm3: restored v2\.0\.0 \(pre-update tree, may be mixed\) with 1 path\(s\) MISSING \(1 of 1 rows could not be copied back\); gate: fixture reason$/],
    ['same_build (same sha, completed record)', ARM3_SHA_A, ARM3_SHA_A, 1,
      /^update: REVERTED \(arm 3\): copied the pre-update backup back — this box's tree is v2\.0\.0 again \(the SAME release that was running before this update; nothing is mixed\) AND 1 path\(s\) are MISSING \(read the arm 3 lines above for where\)\. Read 'ccrc doctor' for why the gate failed, or once fixed: ccrc update --to v2\.0\.0 --force\. Best effort\.$/m,
      /^arm3: restored v2\.0\.0 \(same build, not mixed\) with 1 path\(s\) MISSING \(1 of 1 rows could not be copied back\); gate: fixture reason$/],
    ['MIXED (a staged sha that differs, a completed record)', ARM3_SHA_A, ARM3_SHA_B, 1,
      /^update: REVERTED \(arm 3\): copied the pre-update backup back — the tree is MIXED AND 1 path\(s\) are MISSING \(read the arm 3 lines above for where\); the remedy is deploy\.sh\. Best effort\.$/m,
      /^arm3: tree MIXED with 1 path\(s\) MISSING, deploy\.sh is the remedy \(1 of 1 rows could not be copied back\); gate: fixture reason$/],
    ['MIXED (a staged sha that differs, no record)', ARM3_SHA_A, ARM3_SHA_B, 0,
      /^update: REVERTED \(arm 3\): copied the pre-update backup back — the tree is MIXED AND 1 path\(s\) are MISSING \(read the arm 3 lines above for where\); the remedy is deploy\.sh\. Best effort\.$/m,
      /^arm3: tree MIXED with 1 path\(s\) MISSING, deploy\.sh is the remedy \(1 of 1 rows could not be copied back\); gate: fixture reason$/],
  ] as const)('arm 3\'s MISSING-rows form of each verdict says what is true, in its sentence and in update.json: %s (review 173 T3, F1r)', (_verdict, oldSha, stagedSha, oldCompleted, line, detail) => {
    const home = freshUpdateBox('ccrc-restore-arm3-missing-forms-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    mkdirSync(join(home, 'backups', 'live-row'), { recursive: true });
    const r = sourcedCcrc(home, [
      `_upd_backup_pairs() { printf 'tree\\t%s/live-row\\t%s\\n' "$HOME" 'live-row'; }`,
      '_upd_restore_copy() { return 2; }',
      'UPD_BACKUP_DIR="$HOME/backups"',
      'UPD_VERSION=v2.0.0',
      `UPD_STAGED_SHA=${stagedSha}`,
      `_upd_restore_arm3 server "gate: fixture reason" v2.0.0 ${oldSha} ${oldCompleted}`,
    ].join('\n'));
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(line);
    expect(String(lastReport(home)['detail'])).toMatch(detail);
    expect(lastReport(home)['phase']).toBe('reverted');
  });
});

describe('ccrc rollback (design §11 — a verb, not a recipe)', () => {
  // A rollback IS update's own path, run in-process under update's lock as
  // `cmd_update --to <tag> --downgrade --from rollback|watchdog`
  // (D-3236, D-3262), so
  // every harness piece is this file's: the STUB flavour, the local://
  // release space (a rollback target is a PINNED tag, so it lives under
  // download/<tag>/, never latest/), the systemctl recorder, Task 1's
  // update-json-writes recorder, Task 3's systemd-run recorder, Task 4's
  // install-step knob and Task 5's /health knobs. The sweep cases are
  // `itLinux` because KillMode is systemd's word; the Darwin siblings at the
  // end assert the same outcomes in launchd's.
  const PREV_SHA = 'a'.repeat(40);
  const PREV = `v1.0.0\n${PREV_SHA}\n`;
  const report = (home: string): Record<string, unknown> =>
    JSON.parse(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')) as Record<string, unknown>;
  const writtenPhases = (home: string): string[] => (existsSync(join(home, 'update-json-writes'))
    ? readFileSync(join(home, 'update-json-writes'), 'utf8').split('\n').filter((l) => l !== '')
      .map((l) => String((JSON.parse(l) as { phase: unknown }).phase))
    : []);
  const systemctlCalls = (home: string): string => (existsSync(join(home, 'systemctl-calls'))
    ? readFileSync(join(home, 'systemctl-calls'), 'utf8') : '');
  const sums = (home: string, tag: string): string =>
    `local://${home}/releases/download/${tag}/SHA256SUMS`;
  const pause = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

  /** The shape every real rollback starts from: a box on v2.0.0 whose install
   *  completed (the record equals `plantOldBox`'s stamp sha), whose floor the
   *  last update raised to v2.0.0, and a published v1.0.0 under
   *  download/v1.0.0/. `previous` is planted only when a case names one. */
  const rollbackBox = (prefix: string, opts: {
    previous?: string; marker?: string; bundle?: boolean; installExit?: number;
  } = {}): string => {
    const home = freshUpdateBox(prefix);
    plantOldBox(home, { version: 'v2.0.0' });
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'floor'), 'v2.0.0\n');
    writeFileSync(join(home, '.ccrc', 'installed'),
      opts.marker ?? 'oldsha0000000000000000000000000000000000\n');
    if (opts.previous !== undefined) writeFileSync(join(home, '.ccrc', 'previous'), opts.previous);
    packRelease(home, stubTree(home, { version: 'v1.0.0', installExit: opts.installExit }),
      { tag: 'v1.0.0', latest: false, bundle: opts.bundle });
    return home;
  };

  /** `runUpdate` with the verb swapped — the CHECKOUT's ccrc against the
   *  fixture box. No address is set: `updateEnv` deletes CCRC_ADDR exactly as
   *  for `runUpdate`, and the gate then probes `127.0.0.1:7788`, the one the
   *  curl stub answers (Task 5, D-3255), so
   *  `_upd_fleet_warn` stays as silent here as in every update case. The
   *  zero-second gate window is Task 5's `updateEnv` default, restated so a
   *  case here never waits 90 s if that default moves. No lock marker leaks
   *  in from the runner. */
  function runRollback(home: string, args: string[] = [],
    extraEnv: NodeJS.ProcessEnv = {}): Result {
    mkdirSync(join(home, 'tmp'), { recursive: true });
    const env: NodeJS.ProcessEnv = {
      ...updateEnv(home),
      TMPDIR: join(home, 'tmp'),
      CCRC_RELEASE_BASE_URL: `local://${home}/releases`,
      CCRC_UPDATE_HEALTH_S: '0',
      ...extraEnv,
    };
    delete env['CCRC_UPDATE_LOCK_HELD'];
    replantDoctorStubs(home);
    const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'rollback', ...args],
      { env, encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  }

  it('the argument surface: -h is usage at exit 0; an unknown argument, a mis-shaped --to and a --from outside the vocabulary are exit 2 — before anything is fetched', () => {
    const home = rollbackBox('ccrc-rollback-args-', { previous: PREV });
    let r = runRollback(home, ['-h']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^ {2}rollback {2}return this box to an earlier published release/m);
    r = runRollback(home, ['--bogus']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: unknown argument: --bogus/m);
    r = runRollback(home, ['--to', 'latest']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: rollback: --to expects a release tag shaped vX\.Y\.Z \(got: latest\)$/m);
    r = runRollback(home, ['--from', 'bogus']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: rollback: --from expects one of cli pwa restore rollback watchdog rollout \(got: bogus\)$/m);
    r = runRollback(home, ['--from']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: rollback: --from needs a value: one of cli pwa restore rollback watchdog rollout$/m);
    expect(existsSync(join(home, 'curl-argv')), 'a fetch ran before a usage refusal').toBe(false);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
  });

  it('no ~/.ccrc/previous: exit 1, "nothing to roll back to", naming --to — nothing fetched, no lock opened, no report written', () => {
    const home = rollbackBox('ccrc-rollback-noprev-');
    const r = runRollback(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: rollback: nothing to roll back to — ~\/\.ccrc\/previous is absent .*; name one: ccrc rollback --to vX\.Y\.Z$/m);
    expect(existsSync(join(home, 'curl-argv')), 'a missing previous fell back to a fetch').toBe(false);
    expect(existsSync(join(home, '.ccrc', 'update.lock'))).toBe(false);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
  });

  it('a previous that carries no tag, or cannot be read as one, refuses by name (exit 1) — never falls back to latest', () => {
    const untagged = rollbackBox('ccrc-rollback-untagged-', { previous: `untagged\n${PREV_SHA}\n` });
    let r = runRollback(untagged);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(
      `ccrc: rollback: the build before the last update carried no release tag (previous: untagged ${PREV_SHA}) — name one: ccrc rollback --to vX.Y.Z`);
    expect(existsSync(join(untagged, 'curl-argv'))).toBe(false);
    const bad = rollbackBox('ccrc-rollback-badprev-', { previous: 'three\n' });
    r = runRollback(bad);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: rollback: ~\/\.ccrc\/previous is unreadable or malformed \(line 1 must be a release tag vX\.Y\.Z or 'untagged'\)/m);
    expect(existsSync(join(bad, 'curl-argv'))).toBe(false);
  });

  // D-3285 (final review, B3(i)): a box already running `to`, with a
  // COMPLETED install of it, used to fall into `cmd_update`'s own converged
  // no-op — "pass --force to reinstall", a command `rollback` has no
  // `--force` for, and `update --force` is refused by the floor (M7).
  // Caught in `cmd_rollback` itself now, before any network call or lock.
  it('rolling back to the release already running, whose install completed, prints a runnable remedy and exits 0 — nothing fetched, no lock, no report (D-3285)', () => {
    const home = rollbackBox('ccrc-rollback-converged-');
    const r = runRollback(home, ['--to', 'v2.0.0']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toBe(
      'rollback: this box already runs v2.0.0 (oldsha0000000000000000000000000000000000)'
      + ' and that install completed — nothing to do'
      + ' (to reinstall it: ccrc update --to v2.0.0 --downgrade --force)\n');
    expect(existsSync(join(home, 'curl-argv')), 'a fetch ran before the converged check').toBe(false);
    expect(existsSync(join(home, '.ccrc', 'update.lock'))).toBe(false);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
  });

  // Bare `ccrc rollback` twice: the first run does not rewrite `previous`
  // (`--from rollback` is one of `_upd_write_previous`'s D-3254 keeps), so a
  // second bare run resolves the SAME tag from ~/.ccrc/previous — this is
  // the scenario the MUST-FIX text names directly.
  it('a bare rollback run twice: the second run is the converged case above, resolved from ~/.ccrc/previous (D-3285)', () => {
    const home = rollbackBox('ccrc-rollback-converged-twice-', { previous: 'v2.0.0\noldsha0000000000000000000000000000000000\n' });
    const r = runRollback(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^rollback: this box already runs v2\.0\.0 \(oldsha0+\) and that install completed — nothing to do \(to reinstall it: ccrc update --to v2\.0\.0 --downgrade --force\)$/m);
    expect(existsSync(join(home, 'curl-argv'))).toBe(false);
  });

  // The converged check reads the RUNNING stamp's own sha against the
  // record — a box whose completed-install record names a DIFFERENT sha (a
  // stale record from before the running build) is not converged and must
  // still roll back normally.
  it('a record naming a DIFFERENT sha than the running stamp is NOT converged — the rollback proceeds (D-3285)', () => {
    const home = rollbackBox('ccrc-rollback-not-converged-', {
      previous: PREV,
      marker: 'differentsha00000000000000000000000000\n',
    });
    // Publish v2.0.0 too, beside rollbackBox's default v1.0.0, so a genuine
    // (non-converged) rollback to the box's own running tag has somewhere
    // to fetch from.
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runRollback(home, ['--to', 'v2.0.0']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).not.toMatch(/nothing to do/);
    expect(existsSync(join(home, 'curl-argv')), 'the ordinary rollback path must still run').toBe(true);
  });

  // RE-REVIEW (same D-3285, one clause added): the converged pre-check's
  // early `return 0` writes no report at all. `cmd_watchdog` only records
  // when the rollback IT runs answers non-zero, so a `--from watchdog` (or
  // any non-`cli`) run landing on this early return would leave
  // `update.json` stuck `checking`/`restarting` forever — the next tick
  // sees the same stale report and rolls back again, looping. Fixed: the
  // pre-check now applies ONLY to `--from cli` (the default, a hand-typed
  // run); every other `--from` falls through to `cmd_update`'s own
  // converged no-op, which DOES write a terminal `done`.
  it('`ccrc rollback --from pwa` on a converged box reaches cmd_update\'s own converged path and ends update.json `done`, not untouched (re-review fix)', () => {
    const home = rollbackBox('ccrc-rollback-converged-pwa-');
    // Publish v2.0.0 (the box's own running tag), its build.json sha made to
    // match the box's own stamp — `_upd_converged`'s real comparison, which
    // the non-shortcut path this run now takes must actually satisfy.
    packRelease(home, selfConvergedTree(home, 'v2.0.0', 'oldsha0000000000000000000000000000000000'),
      { tag: 'v2.0.0', latest: false });
    const r = runRollback(home, ['--to', 'v2.0.0', '--from', 'pwa']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    // NOT cmd_rollback's own shortcut sentence (the pre-check is skipped for
    // this `--from`) — it reaches cmd_update's OWN converged message instead,
    // a DIFFERENT sentence that also happens to say "nothing to do".
    expect(r.stdout).not.toMatch(/this box already runs v2\.0\.0 .* and that install completed — nothing to do \(to reinstall it:/);
    expect(r.stdout).toMatch(/^update: this box already runs v2\.0\.0 \(oldsha0+\) and that install completed — nothing to do \(pass --force to reinstall\)$/m);
    expect(existsSync(join(home, 'curl-argv')), 'the ordinary (non-shortcut) path ran').toBe(true);
    expect(existsSync(join(home, '.ccrc', 'update.json')), 'update.json was left untouched').toBe(true);
    const rep = report(home);
    expect(rep['phase']).toBe('done');
    expect(rep['detail']).toBe('already converged at v2.0.0');
    // cmd_rollback always calls cmd_update with --from rollback|watchdog,
    // never its own --from verbatim (`run_from`, ccd/ccrc:12238-12239).
    expect(rep['from']).toBe('rollback');
  });

  // Mutation control for the fix above: WITHOUT the `--from cli` gate, this
  // case would take the shortcut, print "nothing to do" and leave
  // update.json untouched — the assertions above would both fail.
  it('a hand-typed (--from cli, the default) converged rollback still takes the shortcut: no report written (control for the pwa case above)', () => {
    const home = rollbackBox('ccrc-rollback-converged-cli-control-');
    const r = runRollback(home, ['--to', 'v2.0.0']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/nothing to do/);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
  });

  // The guarded read (D-3283's own shape, `_upd_write_previous`): an ABSENT
  // completed-install record must never leak a bash "No such file or
  // directory" onto this run's stderr — the pre-check's `[ -f … ] &&`
  // guard, not the trailing `2>/dev/null` alone, is what prevents it (a
  // redirection that fails to OPEN prints before a later `2>` in the same
  // simple command can catch it — measured: `2>/dev/null` positioned AFTER
  // a failing `<` does NOT suppress bash's own diagnostic).
  it('an ABSENT completed-install record leaks no "No such file or directory" from the hand-typed converged pre-check (re-review fix)', () => {
    const home = rollbackBox('ccrc-rollback-no-record-');
    rmSync(join(home, '.ccrc', 'installed'));
    const r = runRollback(home, ['--to', 'v2.0.0']);
    expect(r.stderr).not.toMatch(/No such file or directory/);
  });

  it('an unpublished tag is refused at exit 2 before the lock and before any backup — its SHA256SUMS is the ONE request (§18 "`rollback` refuses an unknown tag")', () => {
    const home = rollbackBox('ccrc-rollback-unknown-', { previous: PREV });
    const r = runRollback(home, ['--to', 'v7.7.7']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: rollback: v7\.7\.7 is not a published release \(its SHA256SUMS answered 404\) — nothing on this box was changed$/m);
    expect(localUrls(home)).toEqual([sums(home, 'v7.7.7')]);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, '.ccrc', 'update.lock'))).toBe(false);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
  });

  it('a release host that cannot be asked is exit 1 — unmeasured, never read as "not published"', () => {
    const home = rollbackBox('ccrc-rollback-unreachable-', { previous: PREV });
    // Ahead of the combined curl stub `runRollback` re-plants on every call:
    // curl's own "could not connect", which is not a 404.
    mkdirSync(join(home, 'fail-bin'), { recursive: true });
    writeFileSync(join(home, 'fail-bin', 'curl'),
      '#!/bin/sh\necho "curl: (7) Failed to connect: fixture" >&2\nexit 7\n', { mode: 0o755 });
    const r = runRollback(home, [], { PATH: `${join(home, 'fail-bin')}:${updateEnv(home)['PATH'] ?? ''}` });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: rollback: could not ask the release host whether v1\.0\.0 exists within \d+s \(curl failed, timed out, or the host answered neither 200 nor 404\) — nothing on this box was changed$/m);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
  });

  it('a release host answering 503 (or a 403 rate limit) is exit 1 too — curl -f\'s exit 22 is not a 404 until the status says so (Task 6, D-3261)', () => {
    const home = rollbackBox('ccrc-rollback-host-5xx-', { previous: PREV });
    writeFileSync(join(home, 'fixture-release-http'), '503\n');   // Task 6's knob on the combined curl
    const r = runRollback(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: rollback: could not ask the release host whether v1\.0\.0 exists within \d+s \(curl failed, timed out, or the host answered neither 200 nor 404\) — nothing on this box was changed$/m);
    expect(r.stderr).not.toMatch(/is not a published release/);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
  });

  itLinux('bare `ccrc rollback` returns to previous: update\'s own path below the floor, previous kept, the floor kept, the gate, THEN the sweep behind its KillMode preflight (§18 "a standalone rollback sweeps behind the preflight")', () => {
    const home = rollbackBox('ccrc-rollback-happy-', { previous: PREV });
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    writeFileSync(join(home, 'fixture-sweep-active'), UNIT_LINES);
    const r = runRollback(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^rollback: returning this box to v1\.0\.0 \(named by ~\/\.ccrc\/previous; asked by --from cli\) — update's own path, as --from rollback --downgrade/m);
    // Existence first, then update's own resolve → tarball → bundle.
    expect(localUrls(home)).toEqual([
      sums(home, 'v1.0.0'),
      sums(home, 'v1.0.0'),
      `local://${home}/releases/download/v1.0.0/ccrc-v1.0.0.tar.gz`,
      `local://${home}/releases/download/v1.0.0/ccrc-v1.0.0.tar.gz.sigstore.json`,
    ]);
    // Fix round 1 item 12 / review 155 C32: the FIRST SHA256SUMS ask is
    // `_upd_asset_listed`'s pre-detach check (cmd_rollback's own, BEFORE
    // update's spine) — a SMALL probe, connect+total bound. The SECOND is
    // `_upd_resolve`'s own SHA256SUMS fetch, inside cmd_update — connect
    // bound plus a STALL bound (by class with the tarball fetch beside it in
    // the same recording), AND, since fix round 2 F4 (review 167), its OWN
    // total `--max-time`/`--max-filesize` pair too. The two asks do NOT
    // carry the same flag classes (review 173's T2): both carry the connect
    // and total bounds, each from its own call site and knobs, but only
    // `_upd_resolve`'s carries the stall pair and `--max-filesize` — the
    // probe is a status question with no body to bound (`-o /dev/null`), the
    // fetch reads SHA256SUMS' bytes. The assertions below pin exactly that.
    const sumsArgv = curlFullArgv(home).filter((l) => l.includes('/SHA256SUMS'));
    expect(sumsArgv.length, curlFullArgv(home).join('\n')).toBe(2);
    expect(sumsArgv[0]).toMatch(/--connect-timeout \d+/);
    expect(sumsArgv[0]).toMatch(/--max-time \d+/);
    expect(sumsArgv[0]).not.toMatch(/--speed-limit|--speed-time/);
    expect(sumsArgv[0]).not.toMatch(/--max-filesize/);
    expect(sumsArgv[1]).toMatch(/--connect-timeout \d+/);
    expect(sumsArgv[1]).toMatch(/--speed-limit \d+/);
    expect(sumsArgv[1]).toMatch(/--speed-time \d+/);
    expect(sumsArgv[1]).toMatch(/--max-time \d+/);
    expect(sumsArgv[1]).toMatch(/--max-filesize \d+/);
    // Below the floor on purpose, and the floor is never lowered. Fix round
    // 1 item 25 / your Q6 (first bullet): `cmd_rollback` passes BOTH
    // `--downgrade` and `--from rollback` to `cmd_update`, so the caller
    // word must win — a bare `ccrc rollback` never typed `--downgrade`, and
    // the WARN must not claim it did.
    expect(r.stdout).toMatch(/^update: WARN: v1\.0\.0 is below this box's floor v2\.0\.0 \(resolved by --to v1\.0\.0\) — proceeding because this run is --from rollback; the floor stays v2\.0\.0$/m);
    expect(readFileSync(join(home, '.ccrc', 'floor'), 'utf8')).toBe('v2.0.0\n');
    // A rollback is a return to a known tag, not a new baseline (Task 4).
    expect(r.stdout).toMatch(/^update: previous: kept \(v1\.0\.0\)/m);
    expect(readFileSync(join(home, '.ccrc', 'previous'), 'utf8')).toBe(PREV);
    expect(readFileSync(join(home, 'staged-ccrc-argv'), 'utf8').split('\n')[1]).toBe('install');
    expect(r.stdout).toMatch(/^update: rollback: v2\.0\.0 -> v1\.0\.0 is a DOWNGRADE/m);
    // The gate, then the sweep, then done — and no restore phase at all.
    const phases = writtenPhases(home);
    expect(phases).not.toContain('restoring');
    expect(phases.indexOf('checking')).toBeGreaterThan(phases.indexOf('installing'));
    expect(phases.indexOf('restarting')).toBeGreaterThan(phases.indexOf('checking'));
    expect(phases[phases.length - 1]).toBe('done');
    const rep = report(home);
    expect(rep['target']).toBe('v1.0.0');
    expect(rep['from']).toBe('rollback');
    // The sweep ran, and ran BEHIND its preflight: every unit's KillMode read
    // back before the one try-restart.
    const calls = systemctlCalls(home).split('\n').filter((l) => l !== '');
    const restartAt = calls.indexOf('--user try-restart claude-session@*');
    expect(restartAt, 'a standalone rollback must end in the supervisor sweep').toBeGreaterThan(-1);
    for (const u of ['alpha', 'beta', 'ccrc-update-preflight']) {
      const at = calls.indexOf(`--user show -p KillMode claude-session@${u}.service`);
      expect(at, `no KillMode preflight for ${u}`).toBeGreaterThan(-1);
      expect(at).toBeLessThan(restartAt);
    }
    expect(r.stdout).toMatch(/^update: sweep: /m);
    expect(r.stdout).not.toMatch(/DEGRADED/);
    expect(existsSync(join(home, 'tmux-argv')), 'the sweep reached for tmux').toBe(false);
  });

  itLinux('`ccrc rollback --from watchdog` — the REAL in-process path, not the watchdog\'s own stub launcher — still goes below the floor with its WARN: the process-local caller marker item 10 adds does not block the caller it is FOR (fix round 1 item 10 / review 155 C16)', () => {
    const home = rollbackBox('ccrc-rollback-watchdog-caller-', { previous: PREV });
    const r = runRollback(home, ['--from', 'watchdog']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^rollback: returning this box to v1\.0\.0 \(named by ~\/\.ccrc\/previous; asked by --from watchdog\) — update's own path, as --from watchdog --downgrade/m);
    expect(r.stdout).toMatch(/^update: WARN: v1\.0\.0 is below this box's floor v2\.0\.0 \(resolved by --to v1\.0\.0\) — proceeding because this run is --from watchdog; the floor stays v2\.0\.0$/m);
    expect(readFileSync(join(home, '.ccrc', 'floor'), 'utf8')).toBe('v2.0.0\n');
    const rep = report(home);
    expect(rep['from']).toBe('watchdog');
  });

  itLinux('with KillMode not process, the rollback\'s sweep is REFUSED — DEGRADED verbatim, no try-restart — and the rollback still exits 0 (R1 inherited, never re-argued)', () => {
    const home = rollbackBox('ccrc-rollback-degraded-', { previous: PREV });
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    const r = runRollback(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stderr).toMatch(/sweep REFUSED — claude-session@alpha\.service resolves to KillMode=control-group/);
    expect(r.stdout).toMatch(/^update: DEGRADED: the supervisor sweep did not run — every live claude-session@ supervisor keeps executing the PREVIOUS ccd until restarted/m);
    expect(systemctlCalls(home)).not.toMatch(/try-restart/);
    expect(report(home)['phase']).toBe('done');
    expect(report(home)['sweep']).toBe('refused: killmode');
  });

  itLinux('--allow-unsigned rides along ONLY when this box\'s own record says unsigned: an unverified box returns to a bundle-less release; a verified one refuses, with the provenance prefix (D-3263)', () => {
    const unsigned = rollbackBox('ccrc-rollback-unsigned-', {
      previous: PREV, bundle: false, marker: 'oldsha0000000000000000000000000000000000\nunsigned\n',
    });
    let r = runRollback(unsigned);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^update: WARN: .*ccrc-v1\.0\.0\.tar\.gz\.sigstore\.json is absent \(the release host answered 404\) — proceeding on the transport checksum alone because --allow-unsigned was typed/m);
    expect(readFileSync(join(unsigned, 'staged-ccrc-env'), 'utf8')).toBe('unset\n');
    const verified = rollbackBox('ccrc-rollback-verified-', { previous: PREV, bundle: false });
    r = runRollback(verified);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/the release ships no provenance bundle .* installs only with --allow-unsigned/);
    expect(existsSync(join(verified, 'staged-ccrc-argv'))).toBe(false);
    expect(existsSync(join(verified, 'ccrc-backups'))).toBe(false);
    const rep = report(verified);
    expect(rep['phase']).toBe('failed');
    expect(String(rep['detail'])).toMatch(/^provenance: the release ships no provenance bundle/);
  });

  itLinux('a rollback while an update holds the lock is refused with update\'s own sentence — the live report is byte-identical, nothing backed up', () => {
    const home = rollbackBox('ccrc-rollback-locked-', { previous: PREV });
    const lock = join(home, '.ccrc', 'update.lock');
    writeFileSync(lock, '');
    const live = '{"target":"v2.0.0","phase":"installing","startedAt":1,"updatedAt":1,'
      + '"detail":null,"from":"cli","pid":4321}\n';
    writeFileSync(join(home, '.ccrc', 'update.json'), live);
    // Task 2's holder shape: ONE process takes the lock and becomes `sleep`,
    // so the pid killed is the pid holding it (a plain `flock <file> sleep`
    // hands the descriptor to a child that outlives a kill of `flock`).
    const holder = spawn(BASH, ['-c', 'exec 9>>"$1" && flock 9 && exec sleep 30', '_', lock], { stdio: 'ignore' });
    const lockFree = (): boolean =>
      spawnSync(BASH, ['-c', 'exec 9>>"$1" && flock -n 9', '_', lock]).status === 0;
    try {
      for (let i = 0; i < 400 && lockFree(); i++) pause(25);
      expect(lockFree(), 'the holder never took the lock').toBe(false);
      const r = runRollback(home);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/another update holds ~\/\.ccrc\/update\.lock \(pid 4321, target v2\.0\.0\)/);
      expect(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')).toBe(live);
      // The existence question ran (it precedes the lock); nothing after it did.
      expect(localUrls(home)).toEqual([sums(home, 'v1.0.0')]);
      expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
      expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
    } finally { holder.kill('SIGKILL'); }
  });

  for (const from of ['cli', 'watchdog'] as const) {
    itLinux(`a --from ${from} rollback whose gate fails is NOT restored: failed 'rollback to <tag>: gate: …', exit 1, no restore phase, no sweep (D-3243)`, () => {
      const home = rollbackBox(`ccrc-rollback-gate-${from}-`, { previous: PREV });
      // A sweep that ran would leave a try-restart: make it possible, so its
      // absence below is a measurement and not the preflight refusing.
      plantKillModeDropIn(home);
      writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
      // /health keeps answering the version rolled away from.
      writeFileSync(join(home, 'fixture-health-pin'), 'v2.0.0\n');
      const r = runRollback(home, ['--from', from]);
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
      expect(r.stdout).toMatch(/^update: gate FAILED after \d+s — /m);
      expect(r.stderr).toMatch(new RegExp(
        `^ccrc: rollback: v1\\.0\\.0 was installed but failed its health gate \\(gate: .*\\) — no automatic restore runs for a --from ${from === 'watchdog' ? 'watchdog' : 'rollback'} run`, 'm'));
      const rep = report(home);
      expect(rep['phase']).toBe('failed');
      expect(String(rep['detail'])).toMatch(/^rollback to v1\.0\.0: gate: /);
      expect(rep['from']).toBe(from === 'watchdog' ? 'watchdog' : 'rollback');
      const phases = writtenPhases(home);
      expect(phases).not.toContain('restoring');
      expect(phases).not.toContain('reverted');
      expect(r.stdout).not.toMatch(/REVERTED|arm 2/);
      expect(systemctlCalls(home)).not.toMatch(/try-restart/);
      expect(systemctlCalls(home)).not.toMatch(/^--user restart /m);
    });
  }

  itLinux('a rollback whose spine died after the tree, but whose gate passes, names `ccrc rollback --to` as the rerun — `update --force` would be refused by the floor (D-3264)', () => {
    const home = rollbackBox('ccrc-rollback-spine-', { previous: PREV, installExit: 1 });
    writeFileSync(join(home, 'fixture-install-step'), '_inst_skills\n');
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    const r = runRollback(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    const out = `${r.stdout}\n${r.stderr}`;
    expect(out).toMatch(/spine died at _inst_skills\) — rerun: ccrc rollback --to v1\.0\.0\b/);
    expect(out).not.toMatch(/rerun: ccrc update --to v1\.0\.0 --force/);
    expect(systemctlCalls(home)).not.toMatch(/try-restart/);
    expect(report(home)['phase']).toBe('failed');
  });

  // D-3285 (final review, B3(ii)): `_upd_rerun_hint`, sourced directly for
  // its full `UPD_FROM` vocabulary — `restore` is arm 2's own child, and its
  // dead-mid-install rerun is refused by the floor the PARENT's completed
  // spine already raised, exactly like `rollback` and `watchdog`.
  it('_upd_rerun_hint groups restore with rollback|watchdog — the floor refuses `--force` for all three (D-3285)', () => {
    const home = freshUpdateBox('ccrc-update-rerun-hint-');
    for (const from of ['rollback', 'watchdog', 'restore']) {
      const r = sourcedCcrc(home, `UPD_FROM=${from} UPD_VERSION=v1.0.0 _upd_rerun_hint`);
      expect(r.code, `${from}: ${r.stderr}`).toBe(0);
      expect(r.stdout, from).toBe('ccrc rollback --to v1.0.0');
    }
    for (const from of ['cli', 'pwa', 'rollout']) {
      const r = sourcedCcrc(home, `UPD_FROM=${from} UPD_VERSION=v1.0.0 _upd_rerun_hint`);
      expect(r.code, `${from}: ${r.stderr}`).toBe(0);
      expect(r.stdout, from).toBe('ccrc update --to v1.0.0 --force');
    }
  });

  // PLATFORM-ONLY: --detach is Linux-only (decision 17) — a transient
  // systemd --user unit has no launchd counterpart this wave ships; the
  // macOS answer is the refusal case directly below.
  itLinux('--detach resolves the target FIRST, asks its existence, then re-execs `rollback --to <tag> --from <who>` through systemd-run and returns — the default target reaches the detached argv (§11 pin)', () => {
    const home = rollbackBox('ccrc-rollback-detach-', { previous: PREV });
    const r = runRollback(home, ['--detach', '--from', 'pwa']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    // The D-3282 PATH-prepend wrapper (fix round 1 item 19 / review 155
    // C30), the SAME shape the watchdog unit's own `ExecStart` uses.
    expect(readFileSync(join(home, 'systemd-run-argv'), 'utf8').split('\n').filter((l) => l !== ''))
      .toEqual(['--user --collect --quiet /bin/sh -c PATH="$HOME/.local/bin:$PATH" exec "$HOME/.local/bin/ccrc" "$@" '
        + 'ccrc-detach rollback --to v1.0.0 --from pwa']);
    expect(r.stdout).toMatch(/^update: detached — 'rollback --to v1\.0\.0' runs as a transient systemd --user unit; its progress is ~\/\.ccrc\/update\.json$/m);
    const rep = report(home);
    expect(rep['phase']).toBe('queued');
    expect(rep['target']).toBe('v1.0.0');
    expect(rep['from']).toBe('pwa');
    expect(localUrls(home)).toEqual([sums(home, 'v1.0.0')]);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    // An explicit --to reaches it the same way, whatever previous says.
    const pinned = rollbackBox('ccrc-rollback-detach-to-', { previous: `v0.9.0\n${PREV_SHA}\n` });
    const p = runRollback(pinned, ['--to=v1.0.0', '--detach']);
    expect(p.code, `stderr: ${p.stderr}\nstdout: ${p.stdout}`).toBe(0);
    expect(readFileSync(join(pinned, 'systemd-run-argv'), 'utf8').trim())
      .toBe('--user --collect --quiet /bin/sh -c PATH="$HOME/.local/bin:$PATH" exec "$HOME/.local/bin/ccrc" "$@" '
        + 'ccrc-detach rollback --to v1.0.0 --from cli');
  });

  // Fix round 1 item 3 / review 155 C31: a `queued` report with nothing
  // past it wedges W5's `busy` handling and W2's lease sweep forever — no
  // fleet-box watchdog covers the rollback verb. Review 155's own recipe:
  // write `queued` EXACTLY as `_upd_detach` does, then run the detached
  // CHILD's own argv (`cmd_rollback --to <tag> --from pwa`, no `--detach`)
  // against a release that does not exist, so its own SECOND
  // `_upd_asset_listed` check (the parent's first check is not this test's
  // subject) answers 404. The queued report must not survive: W2's REAL
  // `reportFrom` must read a TERMINAL phase off what is left.
  itLinux('a detached rollback child whose second release-host check 404s ends the `queued` report in a TERMINAL `failed` phase — W2\'s real reportFrom never sees it stuck (fix round 1 item 3 / review 155 C31)', () => {
    const home = freshUpdateBox('ccrc-rollback-c31-queued-');
    replantDoctorStubs(home);
    const script = [
      `CCRC_RELEASE_BASE_URL="local://${home}/releases"`,
      'UPD_REPORT_TARGET=v0.0.9',
      'UPD_FROM=pwa',
      '_upd_phase queued',
      '( cmd_rollback --to v0.0.9 --from pwa )',
    ].join('\n');
    const r = sourcedCcrc(home, script);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: rollback: v0\.0\.9 is not a published release \(its SHA256SUMS answered 404\) — nothing on this box was changed$/m);
    const raw = readFileSync(join(home, '.ccrc', 'update.json'), 'utf8');
    const doc = JSON.parse(raw) as Record<string, unknown>;
    expect(doc.phase, `update.json: ${raw}`).toBe('failed');
    expect(doc.target).toBe('v0.0.9');
    expect(doc.from).toBe('pwa');
    expect(String(doc.detail)).toMatch(/^rollback: v0\.0\.9 is not a published release/);
    // W2's own reader — never IN_FLIGHT_UPDATE_PHASES (which `queued` is a
    // member of): a fleet node's `busy` handling and W2's lease sweep both
    // key on this, not on the raw JSON.
    const read: NodeFileRead = { ok: true, content: raw };
    const rep = reportFrom(read);
    expect(rep, `reportFrom(${raw})`).not.toBeNull();
    expect(rep!.phase).toBe('failed');
    expect(IN_FLIGHT_UPDATE_PHASES as readonly string[]).not.toContain(rep!.phase);
  });

  /** A REAL, live holder of ~/.ccrc/update.lock — `flock <file> sleep 30` in
   *  its own process group, returned once a fresh probe confirms contention.
   *  Review fix round 1 I1's own pins: the reporting window must never open
   *  before the lock, so a CONTENDED run must leave a live foreign report
   *  untouched. */
  const holdRollbackLock = (home: string): ChildProcess => {
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    const h = spawn('flock', [join(home, '.ccrc', 'update.lock'), 'sleep', '30'], { stdio: 'ignore', detached: true });
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      if (spawnSync('flock', ['-n', join(home, '.ccrc', 'update.lock'), 'true']).status !== 0) return h;
      spawnSync('sleep', ['0.02']);
    }
    try { process.kill(-h.pid!, 'SIGKILL'); } catch { /* already gone */ }
    throw new Error('the fixture holder never took ~/.ccrc/update.lock');
  };
  const releaseRollbackLock = (h: ChildProcess): void => {
    try { process.kill(-h.pid!, 'SIGKILL'); } catch { /* already gone */ }
  };

  // Review fix round 1, I1: the ORIGINAL item 3 shape opened its reporting
  // window BEFORE taking the lock, so a non-`cli` rollback whose
  // release-host check failed CLOBBERED a live run's own in-flight report.
  // Fixed by taking `~/.ccrc/update.lock` FIRST (this exact scope, a fresh
  // acquisition — `cmd_update`, called in-process later, inherits it rather
  // than re-acquiring). On CONTENTION, `_upd_busy_die` now forces
  // `UPD_REPORTING=0` before it dies, so this run writes NOTHING and the
  // live holder's own report survives byte-identical.
  itLinux('a LIVE foreign in-flight report, with the lock genuinely held, survives a --from pwa rollback child untouched (review fix round 1 I1)', () => {
    const home = freshUpdateBox('ccrc-rollback-i1-live-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    const nowSecs = Math.floor(Date.now() / 1000);
    const foreign = `${JSON.stringify({ target: 'v9.9.9', phase: 'installing', startedAt: nowSecs - 10,
      updatedAt: nowSecs - 5, detail: null, from: 'cli', pid: 424242 })}\n`;
    writeFileSync(join(home, '.ccrc', 'update.json'), foreign);
    const holder = holdRollbackLock(home);
    try {
      // A release host that would answer 404 if ever reached — it must
      // not be: the lock refusal happens first, before any network call.
      const env = { ...updateEnv(home), CCRC_RELEASE_BASE_URL: `local://${home}/releases` };
      const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'rollback', '--to', 'v0.0.9', '--from', 'pwa'],
        { env, encoding: 'utf8' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/another update holds ~\/\.ccrc\/update\.lock \(pid 424242, target v9\.9\.9\)/);
      expect(existsSync(join(home, 'curl-argv')), 'a fetch ran under someone else\'s lock').toBe(false);
      expect(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')).toBe(foreign);
    } finally { releaseRollbackLock(holder); }
  });

  // Review fix round 1, M4: item 3's own pin ran `cmd_rollback` inside a `( )`
  // subshell, where `$BASHPID != $$` disables `_ccrc_die`'s reporting hook —
  // so it covered the 404 arm (an EXPLICIT `_upd_phase` write) but not the
  // curl-failure or curl-absent arms, which route through `_ccrc_die`. These
  // two run the REAL script as a REAL top-level process. No
  // `replantDoctorStubs`: the fixture curl stub answers every non-local://
  // URL with a fake 200, so it must not be on PATH for a genuine curl
  // failure to occur.
  itLinux('M4: a real curl failure (refused port) writes a terminal `failed` report, read by W2\'s real reportFrom (review fix round 1 M4)', () => {
    const home = freshUpdateBox('ccrc-rollback-m4-curlfail-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    const q = sourcedCcrc(home, 'UPD_REPORT_TARGET=v0.0.9\nUPD_FROM=pwa\n_upd_phase queued');
    expect(q.code, `stderr: ${q.stderr}`).toBe(0);
    const env = { ...updateEnv(home), CCRC_RELEASE_BASE_URL: 'http://127.0.0.1:9' };
    allowCurlPort(home, 9);
    const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'rollback', '--to', 'v0.0.9', '--from', 'pwa'],
      { env, encoding: 'utf8' });
    expect(curlFrontPassed(home), 'the real curl was reached through the loopback front').toContain('http://127.0.0.1:9/');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/could not ask the release host whether v0\.0\.9 exists/);
    const raw = readFileSync(join(home, '.ccrc', 'update.json'), 'utf8');
    const rep = reportFrom({ ok: true, content: raw });
    expect(rep, `reportFrom(${raw})`).not.toBeNull();
    expect(rep!.phase).toBe('failed');
  });

  itLinux('M4: curl ABSENT from PATH also writes a terminal `failed` report, read by W2\'s real reportFrom (review fix round 1 M4)', () => {
    const home = freshUpdateBox('ccrc-rollback-m4-curlabsent-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    const q = sourcedCcrc(home, 'UPD_REPORT_TARGET=v0.0.9\nUPD_FROM=pwa\n_upd_phase queued');
    expect(q.code, `stderr: ${q.stderr}`).toBe(0);
    const env = { ...updateEnv(home), PATH: pathWithoutCurl(home) };
    const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'rollback', '--to', 'v0.0.9', '--from', 'pwa'],
      { env, encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/curl is required by 'ccrc rollback' but is not on PATH/);
    const raw = readFileSync(join(home, '.ccrc', 'update.json'), 'utf8');
    const rep = reportFrom({ ok: true, content: raw });
    expect(rep, `reportFrom(${raw})`).not.toBeNull();
    expect(rep!.phase).toBe('failed');
  });

  // Fix round 1 item 12 / review 155 C32: the pre-detach check
  // (`_upd_asset_listed`, via cmd_rollback's SHA256SUMS ask) against a
  // release host that ACCEPTS the TCP connection and never answers — a real
  // `net.createServer` that never writes, NEVER a stubbed curl (the loopback
  // front, D-3819, execs the REAL curl for this one listed port), so the REAL
  // curl's own `--max-time` bound is what is measured. `CCRC_RELEASE_PROBE_
  // MAX_TIME` is overridden small so this pin finishes in a few seconds
  // rather than the production default (15s, itself well under W5's 20s
  // spawn deadline — the exact bound this item exists to keep a slow host
  // under).
  itLinux('a release host that accepts the connection and never answers is refused within its own bound, named in the sentence (fix round 1 item 12 / review 155 C32)', async () => {
    const server = createNetServer((socket) => { socket.on('error', () => {}); /* accept; never write; never close */ });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const home = freshUpdateBox('ccrc-rollback-neverending-host-');
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      const env = {
        ...updateEnv(home),
        CCRC_RELEASE_BASE_URL: `http://127.0.0.1:${port}/rel`,
        CCRC_RELEASE_PROBE_MAX_TIME: '2',
        CCRC_RELEASE_CONNECT_TIMEOUT: '2',
      };
      allowCurlPort(home, port);
      const t0 = Date.now();
      const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'rollback', '--to', 'v0.0.9', '--from', 'pwa'],
        { env, encoding: 'utf8', timeout: 20_000 });
      const elapsedMs = Date.now() - t0;
      expect(curlFrontPassed(home), 'the real curl was reached through the loopback front').toContain(`http://127.0.0.1:${port}/`);
      expect(r.status, r.stderr).toBe(1);
      // Bounded by the OVERRIDDEN probe bound (2s), not left hanging to
      // curl's own (much longer) defaults or to this test's 20s kill.
      expect(elapsedMs, `took ${elapsedMs}ms`).toBeLessThan(10_000);
      expect(r.stderr).toMatch(
        /could not ask the release host whether v0\.0\.9 exists within 2s \(curl failed, timed out, or the host answered neither 200 nor 404\)/);
    } finally {
      server.close();
    }
  }, 20_000);

  // Review fix round 1 (review 155's own M5, distinct from this file's
  // earlier "fix round 1, M5" label below): the four CCRC_RELEASE_* knobs
  // are now validated by `_upd_validate_timeout`, a positive integer within
  // a sane max or the default plus one WARN naming the variable. `0` is
  // refused like any other bad value (curl reads `--max-time 0` as NO
  // LIMIT, which would silently reopen C32), and a non-numeric value falls
  // back rather than corrupting every fetch's own sentence with "abcs".
  it('a bad CCRC_RELEASE_* timeout override WARNs and falls back to the default — 0 and a non-numeric value (review fix round 1 M5)', () => {
    for (const [envVar, badValue, defaultVal] of [
      ['CCRC_RELEASE_PROBE_MAX_TIME', '0', '15'],
      ['CCRC_RELEASE_CONNECT_TIMEOUT', 'abc', '10'],
    ] as const) {
      const home = mkTmp(`ccrc-timeout-validate-${envVar}-`);
      mkdirSync(join(home, '.local', 'bin'), { recursive: true });
      writeFileSync(join(home, '.local', 'bin', 'curl'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
      const env = {
        ...ccrcContainedEnv(home, process.env, { managers: true, curl: 'poison' }),
        [envVar]: badValue,
      };
      assertNoRealTool(env, home);
      const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'rollback', '--to', 'v0.0.1', '--from', 'pwa'],
        { env, encoding: 'utf8' });
      // The probe's own ceiling is the pre-detach one (W6 Task 8A); the
      // connect knob keeps the generic 1..3600 sentence.
      const what = envVar === 'CCRC_RELEASE_PROBE_MAX_TIME'
        ? 'a whole number of seconds from 1 to 18 \\(the pre-detach check must answer inside W5\'s 20-second spawn deadline\\)'
        : 'a whole number of seconds from 1 to 3600';
      expect(r.stdout, `${envVar}=${badValue} stdout`).toMatch(
        new RegExp(`^update: WARN: ${envVar}='${badValue}' is not ${what} — using ${defaultVal}$`, 'm'));
      // A measurement, not just an absence: the run still went on to ask
      // the release host — `_upd_asset_listed`'s own die, which always
      // names PROBE_MAX_TIME's (corrected) value in "within Ns", whichever
      // of the two variables was the bad one.
      expect(r.stderr, `${envVar}=${badValue} stderr`).toMatch(/within 15s/);
    }
  });

  // W6 Task 8A: the pre-detach probe's own ceiling. `cmd_rollback --detach`
  // asks the release host BEFORE it detaches, under W5's 20-second spawn
  // deadline, so an override of the total bound above 18 s must not pass
  // silently — it WARNs and falls back to 15. Measured through `rollback`,
  // which reaches only `_upd_asset_listed`'s validation. 18 itself, and the
  // generic knobs' own ceiling (a connect bound of 3600), still pass.
  it('CCRC_RELEASE_PROBE_MAX_TIME above 18 s WARNs and falls back to 15 at the pre-detach probe; 18 passes (W6 Task 8A)', () => {
    const run = (value: string): { stdout: string; stderr: string } => {
      const home = mkTmp('ccrc-probe-cap-');
      mkdirSync(join(home, '.local', 'bin'), { recursive: true });
      writeFileSync(join(home, '.local', 'bin', 'curl'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
      const env = {
        ...ccrcContainedEnv(home, process.env, { managers: true, curl: 'poison' }),
        CCRC_RELEASE_PROBE_MAX_TIME: value,
      };
      assertNoRealTool(env, home);
      return spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'rollback', '--to', 'v0.0.1', '--from', 'pwa'],
        { env, encoding: 'utf8' });
    };
    const warn = (v: string): RegExp => new RegExp(
      `^update: WARN: CCRC_RELEASE_PROBE_MAX_TIME='${v}' is not a whole number of seconds from 1 to 18 \\(the pre-detach check must answer inside W5's 20-second spawn deadline\\) — using 15$`, 'm');
    for (const v of ['19', '25', '3600']) {
      const r = run(v);
      expect(r.stdout, `${v} stdout`).toMatch(warn(v));
      expect(r.stderr, `${v} stderr`).toMatch(/within 15s/);
    }
    const ok = run('18');
    expect(ok.stdout).not.toContain('WARN');
    expect(ok.stderr).toMatch(/within 18s/);
  });

  // Review fix round 1, M5, closing a coverage gap the mutation table found:
  // `rollback` reaches ONLY `_upd_asset_listed`'s own validation calls
  // (`cmd_rollback`'s pre-check runs before `_upd_resolve` ever does), so
  // the pin above does not red when `_upd_resolve`'s OWN validation calls
  // are deleted — measured on a scratch tree. `CCRC_RELEASE_SPEED_LIMIT`
  // and `CCRC_RELEASE_SPEED_TIME` are validated ONLY inside `_upd_resolve`
  // (SHA256SUMS's stall bound; `_upd_asset_listed` never reads them), so
  // testing them through `update` isolates that call site.
  it('CCRC_RELEASE_SPEED_LIMIT/_SPEED_TIME are validated in _upd_resolve, reached only by `update` (review fix round 1 M5)', () => {
    for (const [envVar, badValue, defaultVal] of [
      ['CCRC_RELEASE_SPEED_LIMIT', '-5', '1024'],
      ['CCRC_RELEASE_SPEED_TIME', '99999', '30'],
    ] as const) {
      const home = mkTmp(`ccrc-timeout-validate-${envVar}-`);
      mkdirSync(join(home, '.local', 'bin'), { recursive: true });
      writeFileSync(join(home, '.local', 'bin', 'curl'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
      const env = {
        ...ccrcContainedEnv(home, process.env, { managers: true, curl: 'poison' }),
        [envVar]: badValue,
      };
      assertNoRealTool(env, home);
      const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'update', '--to', 'v0.0.1'],
        { env, encoding: 'utf8' });
      const what = envVar === 'CCRC_RELEASE_SPEED_LIMIT'
        ? 'a whole number of bytes/second from 1 to 100000000' : 'a whole number of seconds from 1 to 3600';
      expect(r.stdout, `${envVar}=${badValue} stdout`).toMatch(
        new RegExp(`^update: WARN: ${envVar}='${badValue}' is not ${what} — using ${defaultVal}$`, 'm'));
      // A measurement: the run still went on to fetch, with the CORRECTED
      // value in the die's own sentence.
      expect(r.stderr, `${envVar}=${badValue} stderr`)
        .toContain(envVar === 'CCRC_RELEASE_SPEED_LIMIT' ? 'under 1024B/s' : 'for 30s');
    }
  });

  // Review fix round 1, M5: covered by I1 — once the lock is taken BEFORE
  // the window opens, a NON-contention `_upd_lock` failure (flock missing
  // from PATH, here) happens AFTER the window is already open and DOES
  // report — there is no live holder to clobber in that arm.
  itLinux('M5: flock missing from PATH, for a --from pwa rollback (no --detach), is a terminal `failed` report too (review fix round 1 M5)', () => {
    const home = freshUpdateBox('ccrc-rollback-m5-noflock-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    const q = sourcedCcrc(home, 'UPD_REPORT_TARGET=v0.0.9\nUPD_FROM=pwa\n_upd_phase queued');
    expect(q.code, `stderr: ${q.stderr}`).toBe(0);
    const env = { ...updateEnv(home), PATH: pathWithoutFlock(home) };
    const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'rollback', '--to', 'v0.0.9', '--from', 'pwa'],
      { env, encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/flock \(util-linux\) is required by 'ccrc update'/);
    const raw = readFileSync(join(home, '.ccrc', 'update.json'), 'utf8');
    const rep = reportFrom({ ok: true, content: raw });
    expect(rep, `reportFrom(${raw})`).not.toBeNull();
    expect(rep!.phase).toBe('failed');
  });

  itDarwin('--detach refuses on macOS by name before anything runs (decision 17)', () => {
    const home = rollbackBox('ccrc-rollback-detach-darwin-', { previous: PREV });
    const r = runRollback(home, ['--detach']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: --detach is Linux-only \(decision 17\)$/m);
    expect(existsSync(join(home, 'curl-argv'))).toBe(false);
    expect(existsSync(join(home, '.ccrc', 'update.json'))).toBe(false);
  });

  itDarwin('on macOS the same rollback runs by hand: below the floor, previous kept, the launchd gate arm, then the Darwin sweep — and systemctl is never called', () => {
    const home = rollbackBox('ccrc-rollback-darwin-', { previous: PREV });
    // The gate's Darwin arm samples ccrc.service's job pid through `launchctl
    // print`; the recording stub answers a stable pid only for a loaded job.
    appendFileSync(join(home, 'launchctl-loaded'), 'app.ccrc.ccrc.plist\n');
    const r = runRollback(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readFileSync(join(home, '.ccrc', 'floor'), 'utf8')).toBe('v2.0.0\n');
    expect(readFileSync(join(home, '.ccrc', 'previous'), 'utf8')).toBe(PREV);
    expect(report(home)['from']).toBe('rollback');
    expect(report(home)['phase']).toBe('done');
    expect(r.stdout).toMatch(/^update: sweep: /m);
    expect(existsSync(join(home, 'systemctl-calls'))).toBe(false);
  });

  // CARRY (Task 2 review): `cmd_update`'s converged no-op path calls
  // `_upd_unlock` before its own `return 0` (`ccd/ccrc`, just above the
  // "already runs … nothing to do" line) — nothing in this file's OWN
  // describe exercised it, because every earlier `runUpdate` case either
  // never converges or reaches convergence with `UPD_FROM=cli`, never
  // in-process under a caller that took the lock itself and expects it
  // back. `cmd_rollback` is that caller (D-3236: it runs `cmd_update`
  // IN-PROCESS, under the lock it took), so a rollback that lands on an
  // already-current tag is the one path that can prove the converged arm
  // still frees the lock it never re-acquires.
  //
  // A BLACK-BOX (separate-process) probe cannot pin this: `cmd_rollback`'s
  // call to `cmd_update` is its own last statement, and the dispatch case
  // is the script's last statement too, so the whole `ccrc` PROCESS exits
  // (and the kernel drops the flock with it) within a few instructions of
  // `_upd_unlock` either running or not — a second `runRollback` right
  // behind the first stays green either way. This case instead runs
  // `cmd_rollback` SOURCED, in the SAME shell that then probes the lock
  // immediately after it returns — no process boundary between the
  // (possibly-skipped) unlock and the probe, so a fresh `flock -n` on a
  // NEW open file description (`_upd_lock_probe`'s own, per its "per open
  // file description" comment) still contends with `UPD_LOCK_FD` if it
  // was left open in THIS process. Mutation: delete the `_upd_unlock` call
  // — this reds on `probe-inline=1` (held) instead of `probe-inline=0`.
  itLinux('the converged no-op path frees the lock before it returns — probed in-process, in the same shell cmd_rollback ran in, with no process exit between (CARRY: Task 2 review)', () => {
    const home = freshUpdateBox('ccrc-rollback-converged-');
    plantOldBox(home, { version: 'v2.0.0' });
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'floor'), 'v2.0.0\n');
    // The staged release's stamp sha is what stubTree writes: newsha…; the
    // box's OWN running stamp and completed record must carry the SAME sha
    // for `_upd_converged`'s three-way comparison to hold (the exact shape
    // `ccrc update`'s own "already there" gate describe uses), reached here
    // in-process through `cmd_rollback --to v2.0.0` — a rollback TO the tag
    // already running, the one shape that can hit the no-op branch.
    writeFileSync(join(home, '.ccrc', 'build.json'),
      '{"sha":"newsha0000000000000000000000000000000000","ref":"release","builtAt":"2026-08-21T00:00:00Z","dirty":false,"version":"v2.0.0"}\n');
    writeFileSync(join(home, '.ccrc', 'installed'), 'newsha0000000000000000000000000000000000\n');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    mkdirSync(join(home, 'tmp'), { recursive: true });
    replantDoctorStubs(home);
    const script = [
      `export CCRC_RELEASE_BASE_URL="local://${home}/releases"`,
      `export TMPDIR="${home}/tmp"`,
      'export CCRC_UPDATE_HEALTH_S=0',
      'cmd_rollback --to v2.0.0',
      'echo "rc-inline=$?"',
      '_upd_lock_probe; echo "probe-inline=$?"',
    ].join('\n');
    const r = sourcedCcrc(home, script);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/rc-inline=0/);
    expect(r.stdout).toMatch(/already runs v2\.0\.0/);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
    expect(r.stdout).toMatch(/probe-inline=0/);
  });

  itLinux('ccrc rollback, by hand and --from watchdog, prints the leave-the-journal line and leaves the journal byte-identical (path-identity spec 2026-10-12 §5.3)', () => {
    const cases: string[][] = [[], ['--from', 'watchdog']];
    for (const from of cases) {
      const by = from.length === 0 ? 'ccrc rollback' : `ccrc rollback ${from.join(' ')}`;
      const home = rollbackBox(`ccrc-rollback-journal-${from.length === 0 ? 'cli' : 'watchdog'}-`, { previous: PREV });
      plantCoordDb(home);
      const journal = plantCollectJournal(home);
      const r = runRollback(home, from);
      expect(r.code, `${by}\nstderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(r.stdout, by).toMatch(/^update: rollback: v2\.0\.0 -> v1\.0\.0 is a DOWNGRADE/m);
      expect(r.stdout, by).toMatch(LEAVE_JOURNAL_LINE);
      expectJournalUntouched(journal, by);
      expect(journalCopiesUnder(announcedBackupDir(r.stdout, home)), `${by}: the backup holds a copy of the journal`).toEqual([]);
    }
  });
});

describe('ccrc update: the projection (role-aware reader, --channel)', () => {
  // THE FALLBACK, AND ONLY WHERE IT IS HONEST (spec §9's table; §18 "absent
  // + no timer says so"): a node nothing manages follows stable — and says
  // so, rather than reading an absent projection as `stable` in silence.
  platformContrast('no control plane on this box: update follows latest/download and says which kind of box it is', {
    darwin: ['never centrally managed (decision 17), whatever the box records', () => {
      const home = freshUpdateBox('ccrc-update-intent-fallback-mac-');
      plantOldBox(home, { version: 'v1.0.0' });
      plantRole(home, 'server');
      plantClock(home);
      plantIntent(home, intentDoc());
      packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
      const r = runUpdate(home, ['--check']);
      expect(checkLine(r.stdout)).toMatch(/^check: box=v1\.0\.0 sha=\S+ target=v2\.0\.0 (.* )?state=behind$/);
      expect(r.stdout).toMatch(/^update: no control plane on this box \(macOS: not centrally managed\) — following stable$/m);
      expect(localUrls(home)).toEqual([`local://${home}/releases/latest/download/SHA256SUMS`]);
    }],
    linux: ['a fleet node with no ccd-update-sync.timer, and a node recording no role', () => {
      for (const role of ['fleet', null] as const) {
        const home = freshUpdateBox('ccrc-update-intent-fallback-');
        plantOldBox(home, { version: 'v1.0.0' });
        if (role !== null) plantRole(home, role);
        packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
        const r = runUpdate(home);
        expect(r.code, `role ${role}: ${r.stderr}`).toBe(0);
        expect(r.stdout).toMatch(/^update: no control plane on this box — following stable$/m);
        expect(localUrls(home)[0]).toBe(`local://${home}/releases/latest/download/SHA256SUMS`);
        expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(true);
      }
    }],
  });

  // Review Focus 2: the silent fallback is the failure. A fleet node whose
  // timer IS installed and whose projection is absent has never synced —
  // `unreadable`, refused, never the stable sentence.
  itLinux('fleet + the timer unit file installed + projection ABSENT → unreadable (never synced), the puller\'s remedy, nothing fetched', () => {
    const home = managedFleetBox('ccrc-update-intent-never-synced-');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(new RegExp(`^ccrc: update: ~/\\.ccrc/update-intent is unreadable \\(never synced\\) — ${esc(PULLER_REMEDY)}$`, 'm'));
    expect(r.stdout).not.toMatch(/following stable/);
    expect(localUrls(home)).toEqual([]);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
  });

  // §18 "the reader is role-aware": on server/both the server process is the
  // writer, so an absent projection is unreadable with NO timer consulted.
  // A latest release IS published, so a reader that fell back would visibly
  // fetch it.
  itLinux('server or both + projection absent → unreadable (absent) and the server-restart remedy, never stable', () => {
    for (const role of ['server', 'both'] as const) {
      const home = freshUpdateBox(`ccrc-update-intent-absent-${role}-`);
      plantOldBox(home, { version: 'v1.0.0' });
      plantRole(home, role);
      packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
      const r = runUpdate(home);
      expect(r.code, role).toBe(1);
      expect(r.stderr).toMatch(new RegExp(`^ccrc: update: ~/\\.ccrc/update-intent is unreadable \\(absent\\) — ${esc(SERVER_REMEDY)}$`, 'm'));
      expect(r.stdout, role).not.toMatch(/following stable/);
      expect(localUrls(home), role).toEqual([]);
    }
  });

  // Fix round 1 item 22 / review 155 (your Q8): the same absent projection,
  // on the same server/both box, but `--check` — the state Q8 names by
  // example ("an absent or stale projection"). It must not die either:
  // `check:` prints, `projection=unreadable` says why, and the box is
  // compared against itself with nothing fetched.
  itLinux('server or both + projection absent, on --check: `check:` still prints, `projection=unreadable`, never a death (fix round 1 item 22 / review 155, your Q8)', () => {
    for (const role of ['server', 'both'] as const) {
      const home = freshUpdateBox(`ccrc-update-intent-absent-check-${role}-`);
      plantOldBox(home, { version: 'v1.0.0' });
      plantRole(home, role);
      packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
      const r = runUpdate(home, ['--check']);
      expect(r.code, `${role}: ${r.stderr}`).toBe(1);
      expect(r.stderr, role).toBe('');
      expect(checkLine(r.stdout), role).toBe(
        `check: box=v1.0.0 sha=${OLD_SHA} target=v1.0.0 caps=${CAPS_NOW} floor=none projection=unreadable state=incomplete`);
      expect(r.stdout, role).toMatch(new RegExp(
        `^update: ~/\\.ccrc/update-intent is unreadable \\(absent\\) — ${esc(SERVER_REMEDY)}; --check compares this box against itself instead of a target it cannot resolve — 'ccrc update' itself still refuses$`, 'm'));
      expect(localUrls(home), role).toEqual([]);
    }
  });

  // m5 (review fix round 1): the sibling item 22 missed — an UNVERSIONED
  // server/both box has nothing to self-compare against either, but that
  // is not a reason to die: Q8's own rule ("--check always prints its
  // line") carves out no exception for it. `state=unversioned` is this
  // box's own DEFAULT state (never flipped to `behind`, since `box` never
  // gets a real version) — nothing new to compute, just not dying on the
  // way there.
  itLinux('server or both + projection absent + an UNVERSIONED box, on --check: `check:` still prints, state=unversioned, never a death (review fix round 1 m5)', () => {
    for (const role of ['server', 'both'] as const) {
      const home = freshUpdateBox(`ccrc-update-intent-absent-unversioned-check-${role}-`);
      plantOldBox(home);   // no version: no build.json at all
      plantRole(home, role);
      packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
      const r = runUpdate(home, ['--check']);
      expect(r.code, `${role}: ${r.stderr}`).toBe(1);
      expect(r.stderr, role).toBe('');
      expect(checkLine(r.stdout), role).toBe(
        `check: box=unversioned sha=none target=none caps=${CAPS_NOW} floor=none projection=unreadable state=unversioned`);
      // Review fix round 1, M10: the GENERIC broken-projection sentence
      // ("--check compares this box against itself") is untrue here — an
      // unversioned box has nothing to compare — overridden with the SAME
      // words the UPD_TARGET_NONE die uses, which also names --to.
      expect(r.stdout, role).toMatch(new RegExp(
        `^update: ~/\\.ccrc/update-intent is unreadable \\(absent\\) — ${esc(SERVER_REMEDY)}; this box records no release version to compare against — name one with --to <tag>$`, 'm'));
      expect(r.stdout, role).toMatch(/^this box: unversioned \(none\) · latest: none — a release install would be the first on this box$/m);
      expect(localUrls(home), role).toEqual([]);
    }
  });

  itLinux('an in-force projection names the target: download/<desired>, said on stdout, never latest/download', () => {
    const home = managedFleetBox('ccrc-update-intent-ok-');
    plantIntent(home, intentDoc());
    packRelease(home, stubTree(home, { version: 'v9.9.9' }), { tag: 'v9.9.9' });   // a DIFFERENT latest: never fetched
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^update: following the control plane — channel stable, desired v2\.0\.0$/m);
    expect(localUrls(home)[0]).toBe(`local://${home}/releases/download/v2.0.0/SHA256SUMS`);
    expect(localUrls(home).some((u) => u.includes('/latest/'))).toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(true);
  });

  itLinux('--channel dev selects desired-dev for one run; --channel=stable selects desired-stable (spec §9)', () => {
    const home = managedFleetBox('ccrc-update-intent-channel-');
    plantIntent(home, intentDoc({ desired: 'v2.0.0', desiredStable: 'v2.0.0', desiredDev: 'v2.1.0' }));
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    packRelease(home, stubTree(home, { version: 'v2.1.0' }), { tag: 'v2.1.0', latest: false });
    let r = runUpdate(home, ['--channel', 'dev']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^update: following the control plane — channel dev, desired v2\.1\.0$/m);
    expect(localUrls(home)[0]).toBe(`local://${home}/releases/download/v2.1.0/SHA256SUMS`);
    rmSync(join(home, 'curl-argv'));
    r = runUpdate(home, ['--check', '--channel=stable']);
    expect(checkLine(r.stdout)).toMatch(/ target=v2\.0\.0 /);
    expect(r.stdout).toMatch(/^this box: \S+ \(\S+\) · channel stable: v2\.0\.0 — /m);
  });

  // §18 "`--channel` refuses off the control plane": the fetch layer has no
  // URL that means "newest prerelease", so dev must never reach latest/.
  itLinux('--channel with no projection to resolve it refuses naming --to, and never reaches latest/download', () => {
    const home = freshUpdateBox('ccrc-update-intent-channel-off-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantRole(home, 'fleet');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    for (const args of [['--channel', 'dev'], ['--check', '--channel', 'dev']]) {
      const r = runUpdate(home, args);
      expect(r.code, args.join(' ')).toBe(1);
      expect(r.stderr).toMatch(/^ccrc: update: --channel needs the control plane \(no projection resolves on this box\); use --to <tag>$/m);
      expect(localUrls(home), args.join(' ')).toEqual([]);
    }
  });

  itLinux('a lease in the past is stale: a bare update is refused naming its age and the role\'s remedy', () => {
    const cases = [['fleet', PULLER_REMEDY], ['both', SERVER_REMEDY]] as const;
    for (const [role, remedy] of cases) {
      const home = freshUpdateBox(`ccrc-update-intent-stale-${role}-`);
      plantOldBox(home, { version: 'v1.0.0' });
      plantRole(home, role);
      if (role === 'fleet') plantSyncTimer(home);
      plantClock(home);
      plantIntent(home, intentDoc({ issued: String(INTENT_NOW - 1200), lease: String(INTENT_NOW - 300) }));
      packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
      const r = runUpdate(home);
      expect(r.code, `${role}: ${r.stderr}`).toBe(1);
      expect(r.stderr).toMatch(new RegExp(
        `^ccrc: update: the control plane's projection \\(~/\\.ccrc/update-intent\\) is stale — its lease ended 300s ago; ${esc(remedy)}$`, 'm'));
      expect(localUrls(home)).toEqual([]);
    }
  });

  // Fix round 1 item 22 / review 155 (your Q8): `--check` on the SAME stale
  // projection must not die — it always prints its `check:` line, with the
  // projection's own state reported in `projection=`, and compares the box
  // against itself (no target to fetch toward) exactly as a `none`
  // projection does. This is the SPLIT of the case above: the bare-update
  // arm above still refuses; only `--check` changes.
  itLinux('a lease in the past is stale: --check reports it in `projection=`, prints its check line and never dies (fix round 1 item 22 / review 155, your Q8)', () => {
    const cases = [['fleet', PULLER_REMEDY], ['both', SERVER_REMEDY]] as const;
    for (const [role, remedy] of cases) {
      const home = freshUpdateBox(`ccrc-update-intent-stale-check-${role}-`);
      plantOldBox(home, { version: 'v1.0.0' });
      plantRole(home, role);
      if (role === 'fleet') plantSyncTimer(home);
      plantClock(home);
      plantIntent(home, intentDoc({ issued: String(INTENT_NOW - 1200), lease: String(INTENT_NOW - 300) }));
      packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
      const r = runUpdate(home, ['--check']);
      // No completed-install record planted: same version, install never
      // completed — `incomplete`, exit 1 — but the check line still printed.
      expect(r.code, `${role}: ${r.stderr}`).toBe(1);
      expect(r.stderr, role).toBe('');
      expect(checkLine(r.stdout), role).toBe(
        `check: box=v1.0.0 sha=${OLD_SHA} target=v1.0.0 caps=${CAPS_NOW} floor=none projection=stale state=incomplete`);
      expect(r.stdout, role).toMatch(new RegExp(
        `^update: the control plane's projection \\(~/\\.ccrc/update-intent\\) is stale — its lease ended 300s ago; ${esc(remedy)}; --check compares this box against itself instead of a target it cannot resolve — 'ccrc update' itself still refuses$`, 'm'));
      expect(r.stdout, role).toMatch(
        /^this box: v1\.0\.0 \(\S+\) · latest: v1\.0\.0 — same version, but the install never completed \(ccrc version explains\); 'ccrc update --to v1\.0\.0' will reinstall \(with no --to, update refuses: its control plane projection is stale\)$/m);
      // Nothing fetched: the self-compare skips `_upd_resolve` entirely,
      // exactly as a `none` projection's self-compare does.
      expect(localUrls(home), role).toEqual([]);
    }
  });

  itLinux('a lease EQUAL to now is still in force — the comparison is strict', () => {
    const home = managedFleetBox('ccrc-update-intent-lease-now-');
    plantIntent(home, intentDoc({ issued: String(INTENT_NOW - 900), lease: String(INTENT_NOW) }));
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--check']);
    expect(r.stderr).not.toMatch(/stale/);
    expect(checkLine(r.stdout)).toMatch(/ target=v2\.0\.0 /);
    expect(r.stdout).toMatch(/^update: following the control plane — channel stable, desired v2\.0\.0$/m);
  });

  itLinux('a malformed projection is refused — never followed, never read as "no control plane"', () => {
    const home = managedFleetBox('ccrc-update-intent-malformed-');
    plantIntent(home, intentDoc().replace('end\n', ''));   // torn before its terminator
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(new RegExp(
      `^ccrc: update: ~/\\.ccrc/update-intent is malformed \\(its last line is not end\\) — refusing to follow a projection this reader does not recognise; ${esc(PULLER_REMEDY)}$`, 'm'));
    expect(r.stdout).not.toMatch(/following stable/);
    expect(localUrls(home)).toEqual([]);
  });

  // C23 (review 155, fix round 1 item 15): the same class of refusal, pinned
  // through `update --check` as well as `channel` (the grammar table
  // above), because a server/both box's own writer has no puller in front
  // of it — this reader is the only place these two checks run for it.
  // `--check` never dies on a malformed projection (item 22's own rule,
  // above): `check:` still prints, `projection=malformed`, and the box is
  // compared against itself — the same shape the stale/absent cases pin.
  itLinux('a `desired` that disagrees with its own channel is refused by `update --check` too (C23, fix round 1)', () => {
    const home = managedFleetBox('ccrc-update-intent-desired-mismatch-');
    plantIntent(home, intentDoc({ desired: 'v2.1.0' }));
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--check']);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toBe('');
    expect(checkLine(r.stdout)).toMatch(/ projection=malformed state=\S+$/);
    expect(r.stdout).toMatch(new RegExp(
      `^update: ~/\\.ccrc/update-intent is malformed \\(desired v2\\.1\\.0 disagrees with desired-stable v2\\.0\\.0\\) — refusing to follow a projection this reader does not recognise; ${esc(PULLER_REMEDY)}; --check compares this box against itself instead of a target it cannot resolve — 'ccrc update' itself still refuses$`, 'm'));
    expect(localUrls(home)).toEqual([]);
  });

  itLinux('a lease outside the day after its own issued is refused by `update --check` too (C23, fix round 1)', () => {
    const home = managedFleetBox('ccrc-update-intent-lease-window-');
    plantIntent(home, intentDoc({ issued: String(INTENT_NOW - 60), lease: String(INTENT_NOW - 61) }));
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--check']);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toBe('');
    expect(checkLine(r.stdout)).toMatch(/ projection=malformed state=\S+$/);
    expect(r.stdout).toMatch(new RegExp(
      `^update: ~/\\.ccrc/update-intent is malformed \\(lease ${INTENT_NOW - 61} does not fall in the day after issued ${INTENT_NOW - 60}\\) — refusing to follow a projection this reader does not recognise; ${esc(PULLER_REMEDY)}; --check compares this box against itself instead of a target it cannot resolve — 'ccrc update' itself still refuses$`, 'm'));
    expect(localUrls(home)).toEqual([]);
  });

  // m4: the AHEAD direction of the lease window had no `--check` pin either
  // (only the desired mismatch and the BELOW direction did).
  itLinux('a lease more than a day after its own issued is refused by `update --check` too (fix round 1 review m4)', () => {
    const home = managedFleetBox('ccrc-update-intent-lease-ahead-');
    const issued = INTENT_NOW - 60;
    const lease = issued + 86_400 + 1;
    plantIntent(home, intentDoc({ issued: String(issued), lease: String(lease) }));
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--check']);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toBe('');
    expect(checkLine(r.stdout)).toMatch(/ projection=malformed state=\S+$/);
    expect(r.stdout).toMatch(new RegExp(
      `^update: ~/\\.ccrc/update-intent is malformed \\(lease ${lease} does not fall in the day after issued ${issued}\\) — refusing to follow a projection this reader does not recognise; ${esc(PULLER_REMEDY)}; --check compares this box against itself instead of a target it cannot resolve — 'ccrc update' itself still refuses$`, 'm'));
    expect(localUrls(home)).toEqual([]);
  });

  // I2 (review 155 fix round 1 review): "pin both through ccrc channel, and
  // one through update --check" — the issued-ahead-of-clock direction,
  // through --check.
  itLinux('an issued more than a day ahead of this node\'s clock is refused by `update --check` too (I2, fix round 1 review)', () => {
    const home = managedFleetBox('ccrc-update-intent-issued-ahead-');
    const issued = INTENT_NOW + 315_360_000;
    plantIntent(home, intentDoc({ issued: String(issued), lease: String(issued + 900) }));
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--check']);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toBe('');
    expect(checkLine(r.stdout)).toMatch(/ projection=malformed state=\S+$/);
    expect(r.stdout).toMatch(new RegExp(
      `^update: ~/\\.ccrc/update-intent is malformed \\(issued ${issued} is more than a day ahead of this node clock \\(${INTENT_NOW}\\)\\) — refusing to follow a projection this reader does not recognise; ${esc(PULLER_REMEDY)}; --check compares this box against itself instead of a target it cannot resolve — 'ccrc update' itself still refuses$`, 'm'));
    expect(localUrls(home)).toEqual([]);
  });

  itLinux('`desired none` refuses and says where the reason is; --channel takes the other line when it names a tag', () => {
    const home = managedFleetBox('ccrc-update-intent-none-');
    plantIntent(home, intentDoc({ desired: 'none', desiredStable: 'none', desiredDev: 'v2.1.0' }));
    packRelease(home, stubTree(home, { version: 'v2.1.0' }), { tag: 'v2.1.0', latest: false });
    for (const [args, key] of [[[], 'desired'], [['--channel', 'stable'], 'desired-stable']] as const) {
      const r = runUpdate(home, [...args]);
      expect(r.code, key).toBe(1);
      expect(r.stderr).toMatch(new RegExp(
        `^ccrc: update: the control plane resolves no target for this box \\(${key} none\\) — nothing newer than this box's floor is eligible, or the server declined one; its reason is on the console's update screen \\(GET /api/updates, resolveDetail\\); name one with --to <tag>$`, 'm'));
      expect(localUrls(home), key).toEqual([]);
    }
    const r = runUpdate(home, ['--channel', 'dev']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(localUrls(home)[0]).toBe(`local://${home}/releases/download/v2.1.0/SHA256SUMS`);
  });

  // A CONVERGED managed node's projection IS `desired none`: W2 names a tag
  // only when one is strictly newer than the floor (`notNewerThanFloor`), and
  // a completed install raises the floor to the running tag. So --check reads
  // `none` as "nothing newer" and compares the box against ITSELF (plan
  // D-3266) — a refusing --check would answer
  // exit 1, with no machine line, on every healthy managed box. `update`
  // itself still refuses (spec §9).
  itLinux('--check on a converged box whose projection says `none` answers state=current, exit 0, fetching nothing; update itself still refuses', () => {
    const home = managedFleetBox('ccrc-update-intent-none-current-');
    writeFileSync(join(home, '.ccrc', 'installed'), 'oldsha0000000000000000000000000000000000\n');   // plantOldBox's stamp sha
    plantIntent(home, intentDoc({ desired: 'none', desiredStable: 'none' }));
    const sentence = (key: string): string => `update: the control plane resolves no target for this box (${key} none) — nothing newer than this box's floor is eligible, or the server declined one; its reason is on the console's update screen (GET /api/updates, resolveDetail)`;
    for (const [args, key] of [[['--check'], 'desired'], [['--check', '--channel', 'stable'], 'desired-stable']] as const) {
      const r = runUpdate(home, [...args]);
      expect(r.code, `${key}: ${r.stderr}`).toBe(0);
      expect(r.stdout.split('\n')[0], key).toMatch(/^check: box=v1\.0\.0 sha=oldsha0+ target=v1\.0\.0 (.* )?state=current$/);
      expect(r.stdout.split('\n'), key).toContain(sentence(key));
      expect(r.stdout).toMatch(new RegExp(`^this box: v1\\.0\\.0 \\(oldsha0+\\) · channel stable \\(${key} none\\): v1\\.0\\.0 — current$`, 'm'));
      expect(localUrls(home), key).toEqual([]);
    }
    // No completed-install record: incomplete, exit 1 — and the reinstall it
    // names carries --to, because a bare update refuses on this projection.
    rmSync(join(home, '.ccrc', 'installed'));
    let r = runUpdate(home, ['--check']);
    expect(r.code).toBe(1);
    expect(checkLine(r.stdout)).toMatch(/ target=v1\.0\.0 (.* )?state=incomplete$/);
    expect(r.stdout).toMatch(/— same version, but the install never completed \(ccrc version explains\); 'ccrc update --to v1\.0\.0' will reinstall \(with no --to, update refuses: the control plane names no target\)$/m);
    // The install path keeps spec §9's refusal, nothing fetched.
    r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: update: the control plane resolves no target for this box \(desired none\) — nothing newer than this box's floor is eligible/m);
    expect(localUrls(home)).toEqual([]);
    // A box with no stamped version has nothing to compare against: refused.
    const bare = freshUpdateBox('ccrc-update-intent-none-unversioned-');
    plantOldBox(bare);
    plantRole(bare, 'fleet');
    plantSyncTimer(bare);
    plantClock(bare);
    plantIntent(bare, intentDoc({ desired: 'none', desiredStable: 'none' }));
    r = runUpdate(bare, ['--check']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: update: the control plane resolves no target for this box \(desired none\) — .*; this box records no release version to compare against — name one with --to <tag>$/m);
    expect(checkLine(r.stdout)).toBe('');
    expect(localUrls(bare)).toEqual([]);
  });

  itLinux('--check with no --to reports what update WOULD install — the projection\'s desired, on a server box too — and writes nothing', () => {
    const home = freshUpdateBox('ccrc-update-intent-check-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantRole(home, 'server');
    plantClock(home);
    plantIntent(home, intentDoc());
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    updateEnv(home);
    replantDoctorStubs(home);
    const before = homeSnapshot(home);
    const r = runUpdate(home, ['--check']);
    expect(r.code).toBe(1);
    expect(r.stdout.split('\n')[0]).toMatch(/^check: box=v1\.0\.0 sha=\S+ target=v2\.0\.0 (.* )?state=behind$/);
    expect(r.stdout).toMatch(/^update: following the control plane — channel stable, desired v2\.0\.0$/m);
    expect(r.stdout).toMatch(/^this box: v1\.0\.0 \(\S+\) · channel stable: v2\.0\.0 — behind$/m);
    expect(localUrls(home)).toEqual([`local://${home}/releases/download/v2.0.0/SHA256SUMS`]);
    expect(homeSnapshot(home)).toEqual(before);
  });

  // §18 "the floor is checked on every path": the W1 check keys on the
  // RESOLVED version, and the projection is a third way to resolve it.
  itLinux('a projection-resolved target below the floor is refused before any backup, naming the control plane', () => {
    const home = freshUpdateBox('ccrc-update-intent-floor-');
    plantOldBox(home, { version: 'v3.0.0' });
    writeFileSync(join(home, '.ccrc', 'floor'), 'v3.0.0\n');
    plantRole(home, 'fleet');
    plantSyncTimer(home);
    plantClock(home);
    plantIntent(home, intentDoc());
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/v2\.0\.0 \(resolved by the control plane \(channel stable\)\) is below this box's floor v3\.0\.0/);
    // Review fix round 1 I5 (narrowing item 17 / review 155 C28): the
    // target's VERSION (v2.0.0) differs from the running stamp's (v3.0.0),
    // so the floor is checked BEFORE the fetch here — see the sibling
    // `latest/download` case's own comment.
    expect(localUrls(home)).toEqual([`local://${home}/releases/download/v2.0.0/SHA256SUMS`]);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
  });

  it('--channel is a usage error beside --to, with no value, or with any word but stable|dev — exit 2, nothing fetched', () => {
    const home = freshUpdateBox('ccrc-update-intent-argv-');
    const cases: Array<[string[], RegExp]> = [
      [['--channel', 'dev', '--to', 'v1.0.0'], /^ccrc: update: --channel and --to are exclusive — --to names the tag, --channel asks the control plane which one; pick one$/m],
      [['--to=v1.0.0', '--channel=stable'], /^ccrc: update: --channel and --to are exclusive/m],
      [['--channel', 'beta'], /^ccrc: --channel expects stable or dev \(got: beta\)$/m],
      [['--channel='], /^ccrc: --channel expects stable or dev \(got: nothing\)$/m],
      [['--channel'], /^ccrc: --channel needs a value: stable or dev$/m],
    ];
    for (const [args, says] of cases) {
      const r = runUpdate(home, args);
      expect(r.code, args.join(' ')).toBe(2);
      expect(r.stderr, args.join(' ')).toMatch(says);
      expect(existsSync(join(home, 'curl-argv')), `${args.join(' ')}: a fetch ran`).toBe(false);
    }
  });

  // The Darwin arm, measured on EVERY platform: `CCD_OS` is computed at
  // source time, so an assignment after the `.` is how a Linux run reaches
  // it (Task 3's `sourcedCcrc`). A projection, a role and a timer are all
  // present — the reader must answer before it looks at any of them.
  it('the reader answers not-configured on CCD_OS=darwin before it reads a byte, and --channel is refused there', () => {
    const home = freshUpdateBox('ccrc-update-intent-darwin-arm-');
    plantRole(home, 'fleet');
    plantSyncTimer(home);
    plantIntent(home, intentDoc());
    let r = sourcedCcrc(home, 'CCD_OS=darwin; _upd_intent_state; printf "%s|%s|%s\\n" "$UPD_INTENT_STATE" "$UPD_INTENT_WHY" "$UPD_INTENT_DESIRED"; _upd_target "" ""; printf "via=%s target=[%s]\\n" "$UPD_TARGET_VIA" "$UPD_TARGET"');
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.split('\n')).toEqual([
      'not-configured|macos|',
      'update: no control plane on this box (macOS: not centrally managed) — following stable',
      'via=latest/download target=[]',
      '',
    ]);
    r = sourcedCcrc(home, 'CCD_OS=darwin; _upd_target "" dev; echo unreachable');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: update: --channel needs the control plane \(no projection resolves on this box\); use --to <tag>$/m);
    expect(r.stdout).not.toMatch(/unreachable/);
  });

  // The clock-failure guard (`ccd/ccrc:12934-12938`): without it, an empty
  // `now="$(date +%s)"` reads as 0 in `(( now > 10#${vals[2]} ))`, so a lease
  // that cannot be measured reads as PERMANENTLY in force rather than
  // refusing — mutation `date() { :; }` must go RED here.
  itLinux('an unmeasurable clock (date +%s answers nothing) reads unreadable, never "0 — every lease in force"', () => {
    const home = managedFleetBox('ccrc-update-intent-clock-fail-');
    plantIntent(home, intentDoc());
    let r = sourcedCcrc(home,
      'date() { :; }; _upd_intent_state; printf "%s|%s\\n" "$UPD_INTENT_STATE" "$UPD_INTENT_WHY"');
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe('unreadable|the clock did not answer: date +%s\n');
    r = sourcedCcrc(home, 'date() { :; }; _upd_target "" ""; echo unreachable');
    expect(r.code).toBe(1);
    expect(r.stdout).not.toMatch(/unreachable/);
    expect(r.stderr).toMatch(new RegExp(
      `^ccrc: update: ~/\\.ccrc/update-intent is unreadable \\(the clock did not answer: date \\+%s\\) — ${esc(PULLER_REMEDY)}$`, 'm'));
  });
});

describe('ccrc channel (design 2026-09-20 §14 — read-only)', () => {
  itLinux('an in-force projection: the machine line carries the document, then one sentence; exit 0; nothing written', () => {
    const home = managedFleetBox('ccrc-channel-ok-');
    plantIntent(home, intentDoc({ channel: 'dev', desired: 'v2.1.0', auto: 'channel' }));
    updateEnv(home);
    replantDoctorStubs(home);
    const before = homeSnapshot(home);
    const r = runChannel(home);
    expect(r.code, r.stderr).toBe(0);
    const out = r.stdout.split('\n');
    expect(out[0]).toBe('channel: state=ok channel=dev desired=v2.1.0 desired-stable=v2.0.0 desired-dev=v2.1.0 auto=channel');
    expect(out[1]).toBe("this box follows channel dev: the control plane resolves v2.1.0 (stable v2.0.0, dev v2.1.0; auto channel) — 'ccrc update' with no --to installs v2.1.0; the channel is set from the console");
    expect(out.slice(2)).toEqual(['']);
    expect(homeSnapshot(home)).toEqual(before);
  });

  itLinux('every other state: its word, `-` for each field no document carries, and its exit code', () => {
    type Case = { name: string; plant: (h: string) => void; line: string; says: RegExp; code: number };
    const dash = 'channel=- desired=- desired-stable=- desired-dev=- auto=-';
    const cases: Case[] = [
      { name: 'none', plant: (h) => { plantRole(h, 'fleet'); plantSyncTimer(h); plantIntent(h, intentDoc({ desired: 'none', desiredStable: 'none' })); },
        line: 'channel: state=none channel=stable desired=none desired-stable=none desired-dev=v2.1.0 auto=off',
        says: /^this box follows channel stable: the control plane resolves no target for it \(desired none\) — its reason is on the console's update screen/m, code: 0 },
      { name: 'not-configured', plant: (h) => plantRole(h, 'fleet'),
        line: `channel: state=not-configured ${dash}`, says: /^no control plane on this box — 'ccrc update' follows stable$/m, code: 1 },
      { name: 'unreadable (never synced)', plant: (h) => { plantRole(h, 'fleet'); plantSyncTimer(h); },
        line: `channel: state=unreadable ${dash}`, says: new RegExp(`^~/\\.ccrc/update-intent is unreadable \\(never synced\\) — ${esc(PULLER_REMEDY)}$`, 'm'), code: 1 },
      { name: 'unreadable (absent, server)', plant: (h) => plantRole(h, 'server'),
        line: `channel: state=unreadable ${dash}`, says: new RegExp(`^~/\\.ccrc/update-intent is unreadable \\(absent\\) — ${esc(SERVER_REMEDY)}$`, 'm'), code: 1 },
      { name: 'stale', plant: (h) => { plantRole(h, 'server'); plantIntent(h, intentDoc({ issued: String(INTENT_NOW - 2000), lease: String(INTENT_NOW - 1100) })); },
        line: `channel: state=stale ${dash}`, says: /is stale — its lease ended 1100s ago; restart ccrc\.service/m, code: 1 },
      // No role recorded and no puller installed: the only writer of a
      // present copy is a server that DERIVED its role (W2's D-3174), so the
      // remedy is the server's — never a unit this box does not have.
      { name: 'stale, no role, no timer', plant: (h) => plantIntent(h, intentDoc({ issued: String(INTENT_NOW - 2000), lease: String(INTENT_NOW - 1100) })),
        line: `channel: state=stale ${dash}`, says: new RegExp(`is stale — its lease ended 1100s ago; ${esc(SERVER_REMEDY)}$`, 'm'), code: 1 },
      // …and with the timer unit file installed, the puller's.
      { name: 'stale, no role, timer', plant: (h) => { plantSyncTimer(h); plantIntent(h, intentDoc({ issued: String(INTENT_NOW - 2000), lease: String(INTENT_NOW - 1100) })); },
        line: `channel: state=stale ${dash}`, says: new RegExp(`is stale — its lease ended 1100s ago; ${esc(PULLER_REMEDY)}$`, 'm'), code: 1 },
    ];
    for (const c of cases) {
      const home = freshUpdateBox('ccrc-channel-state-');
      plantClock(home);
      c.plant(home);
      const r = runChannel(home);
      expect(r.stdout.split('\n')[0], c.name).toBe(c.line);
      expect(r.stdout, c.name).toMatch(c.says);
      expect(r.code, c.name).toBe(c.code);
    }
  });

  // The whole-document grammar (spec §9), case by case, through the verb.
  // Every row must answer `malformed` — except the two the grammar admits.
  itLinux('the grammar: every torn, reordered, widened or foreign document is malformed; a missing final newline is not', () => {
    const doc = intentDoc();
    const malformed: Array<[string, string | Buffer] | [string, string | Buffer, RegExp]> = [
      ['empty', ''],
      ['torn before end', doc.replace('end\n', '')],
      ['torn mid-line', doc.slice(0, doc.indexOf('desired-dev') + 9)],
      ['a blank line after end', `${doc}\n`],
      ['a tenth line', doc.replace('auto off\n', 'auto off\nauto off\n')],
      ['a blank line inside', doc.replace('channel stable\n', 'channel stable\n\n')],
      ['reordered', doc.replace(/^epoch 7\nissued (\d+)\n/, 'issued $1\nepoch 7\n')],
      ['CRLF', doc.replace(/\n/g, '\r\n')],
      ['a leading zero', doc.replace('epoch 7', 'epoch 07')],
      ['a negative number', doc.replace('epoch 7', 'epoch -7')],
      ['twenty digits (wraps positive in bash)', intentDoc({ lease: '99999999999999999999' })],
      ['two spaces', doc.replace('epoch 7', 'epoch  7')],
      ['a tag without its v', intentDoc({ desired: '2.0.0' })],
      ['a word for a tag', intentDoc({ desiredDev: 'latest' })],
      ['an unknown channel', intentDoc({ channel: 'beta' })],
      ['an unknown auto', intentDoc({ auto: 'on' })],
      ['a NUL byte', Buffer.concat([Buffer.from('epoch 7\0'), Buffer.from(doc.slice('epoch 7'.length))])],
      ['over the 65536-byte cap', doc.replace('epoch 7', `epoch 7${'0'.repeat(70_000)}`)],
      // C23 (review 155, fix round 1 item 15) and I2 (review 155 fix round 1
      // review): the puller's own value checks (ccd/ccd-update-sync's PASS
      // 3), re-checked here by the READER too — the puller is not in front
      // of a server/both box's own writer, so nothing else re-verifies
      // these on the node before this reader would otherwise trust them.
      // `why` (fix round 1 review m4) pins WHICH check fired, not merely
      // that some check did.
      ['desired disagrees with its own channel\'s resolution', intentDoc({ desired: 'v2.1.0' }),
        /desired v2\.1\.0 disagrees with desired-stable v2\.0\.0/],
      ['a lease before its own issued', intentDoc({ issued: String(INTENT_NOW - 60), lease: String(INTENT_NOW - 61) }),
        /lease \d+ does not fall in the day after issued \d+/],
      ['a lease more than a day after its own issued',
        intentDoc({ issued: String(INTENT_NOW - 60), lease: String(INTENT_NOW - 60 + 86_400 + 1) }),
        /lease \d+ does not fall in the day after issued \d+/],
      // I2: the reader also refuses an `issued` more than a day AHEAD of
      // this node's clock (the FUTURE half only — a past `issued` stays
      // `stale` via the lease, never `malformed`), and a timestamp wider
      // than the puller's own width bound (`SECONDS_DIGITS=11`,
      // ccd/ccd-update-sync's own PASS 3 `seconds()`).
      ['an issued more than a day ahead of this node\'s clock',
        intentDoc({ issued: String(INTENT_NOW + 315_360_000), lease: String(INTENT_NOW + 315_360_000 + 900) }),
        /issued \d+ is more than a day ahead of this node clock/],
      ['an issued wider than 11 digits', intentDoc({ issued: '2000000000000', lease: '2000000000900' }),
        /issued 2000000000000 carries 13 digits: unix seconds carry at most 11/],
      // Corrected (fix round 1 review m1): the earlier comment here claimed
      // this reader "still has no SECONDS-vs-MILLISECONDS check of its
      // own" — false as of I2, above. The WIDTH check now runs first and is
      // the one that actually fires on this document; the lease-window
      // check (which also happened to catch it, incidentally, before I2)
      // never gets a chance to.
      ['a 13-digit (ms-shaped) lease is grammatical, but is refused on its width', intentDoc({ lease: '2000000000000' }),
        /lease 2000000000000 carries 13 digits: unix seconds carry at most 11/],
    ];
    for (const [name, text, why] of malformed) {
      const home = managedFleetBox('ccrc-channel-grammar-');
      plantIntent(home, text);
      const r = runChannel(home);
      expect(r.stdout.split('\n')[0], name).toMatch(/^channel: state=malformed channel=- /);
      expect(r.stdout, name).toMatch(/is malformed \(.+\) — refusing to follow a projection this reader does not recognise; systemctl --user start ccd-update-sync\.service$/m);
      if (why) expect(r.stdout, name).toMatch(why);
      expect(r.code, name).toBe(1);
    }
    for (const [name, text] of [
      ['no final newline', doc.slice(0, -1)],
      // m3: the lease window's own edges are pinned, not just its interior —
      // both are INCLUSIVE (`_upd_intent_state` uses strict `<`/`>`, never
      // `<=`/`>=`), matching the puller's own `issued <= lease <= issued +
      // DAY`. `issued` is INTENT_NOW itself (not the usual `-60`) so `now`
      // never runs strictly past `lease` and flips these into `stale`.
      ['lease == issued (m3, the inclusive lower edge)', intentDoc({ issued: String(INTENT_NOW), lease: String(INTENT_NOW) })],
      ['lease == issued + 86400 (m3, the inclusive upper edge)',
        intentDoc({ issued: String(INTENT_NOW), lease: String(INTENT_NOW + 86_400) })],
    ] as const) {
      const home = managedFleetBox('ccrc-channel-grammar-ok-');
      plantIntent(home, text);
      const r = runChannel(home);
      expect(r.stdout.split('\n')[0], name).toMatch(/^channel: state=ok /);
    }
    const home = managedFleetBox('ccrc-channel-grammar-dir-');
    mkdirSync(intentPath(home), { recursive: true });
    const r = runChannel(home);
    expect(r.stdout).toMatch(/^channel: state=unreadable /);
    expect(r.stdout).toMatch(/is unreadable \(not a readable regular file\)/);
  }, 60_000);

  it('every argument is refused — the channel is set from the console (decision 15); -h prints usage', () => {
    const home = freshUpdateBox('ccrc-channel-argv-');
    plantIntent(home, intentDoc());
    const doc = readFileSync(intentPath(home));
    for (const args of [['dev'], ['stable'], ['--set', 'dev'], ['--channel=dev']]) {
      const r = runChannel(home, args);
      expect(r.code, args.join(' ')).toBe(2);
      expect(r.stderr).toMatch(/^ccrc: channel: set the channel from the console — a node never writes intent \(decision 15\)$/m);
      expect(r.stdout, args.join(' ')).toBe('');
    }
    expect(readFileSync(intentPath(home)).equals(doc)).toBe(true);
    const h = runChannel(home, ['-h']);
    expect(h.code).toBe(0);
    expect(h.stdout).toMatch(/usage: ccrc \{/);
  });
});

describe('ccrc watchdog: a re-measurement, never a timestamp alone (design §11)', () => {
  // THE REPORT'S OWN UNIT: unix SECONDS (rulings R1, R14). Task 1's
  // `_upd_phase` stamps `startedAt` and `updatedAt` with `date +%s`, and
  // `cmd_watchdog` reads its clock with the same call; the deadline alone is
  // milliseconds (`CCRC_UPDATE_DEADLINE_MS`, W2's `updateDeadlineMs`), divided
  // by 1000 at the one place it is compared. The real-writer case at the end
  // of this block is the one that goes red if the two sides ever disagree.
  const nowS = (): number => Math.floor(Date.now() / 1000);
  /** One minute: a 90 s report is stale, a 200 s one is past twice it. */
  const DEADLINE_MS = '60000';
  /** W2's own `IN_FLIGHT_UPDATE_PHASES` (shared/api.ts), not a hand copy of
   *  spec §6 (W4a Task 15): the order check below (`toEqual(IN_FLIGHT)`)
   *  measures `ccd/ccrc`'s bash array against W2's REAL array — exact set
   *  AND order — by construction. */
  const IN_FLIGHT: readonly string[] = IN_FLIGHT_UPDATE_PHASES;
  const NOT_IN_FLIGHT = UPDATE_PHASES.filter((p) => !IN_FLIGHT.includes(p));

  /** `$HOME/.local/bin/ccrc` — the launcher the watchdog's rollback runs
   *  through — as a RECORDER: its argv; whether ~/.ccrc/update.lock was FREE
   *  when it ran (the rollback takes that lock itself, so the watchdog must
   *  have let go of it); whether a lock marker reached it; an optional report
   *  it writes as its own; its exit code. What `ccrc rollback` DOES is Task
   *  7's subject — this block owns who calls it, when, and what is recorded
   *  around it. */
  const LAUNCHER = [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" >> "$HOME/launcher-argv"',
    'if flock -n "$HOME/.ccrc/update.lock" true; then echo free; else echo held; fi >> "$HOME/launcher-lock"',
    'printf \'%s\\n\' "${CCRC_UPDATE_LOCK_HELD:-unset}" >> "$HOME/launcher-marker"',
    '[ -f "$HOME/fixture-rollback-report" ] && cp "$HOME/fixture-rollback-report" "$HOME/.ccrc/update.json"',
    // F4 (fix round 1, Task 9): a launcher that leaves ~/.ccrc/update.lock
    // HELD when it exits — the refused-rollback re-lock guard's own
    // `&& flock -n "$UPD_LOCK_FD"` half, unpinned until now. Backgrounded so
    // it survives the launcher's own exit, and polled-for so the watchdog's
    // re-lock attempt is guaranteed to see it CONTENDED, never a race.
    'if [ -f "$HOME/fixture-rollback-leaves-holder" ]; then',
    '  flock "$HOME/.ccrc/update.lock" sleep 3 &',
    '  until ! flock -n "$HOME/.ccrc/update.lock" true 2>/dev/null; do sleep 0.02; done',
    'fi',
    // Review fix round 1, M1's own pin: swap update.json for a FIFO right
    // before this launcher exits, so the watchdog's re-lock-and-re-read
    // (the THIRD read, guarded by M1) meets a FIFO, never the report this
    // launcher was handed.
    '[ -f "$HOME/fixture-rollback-fifo-swap" ] && { rm -f "$HOME/.ccrc/update.json"; mkfifo "$HOME/.ccrc/update.json"; }',
    'code=0',
    '[ -f "$HOME/fixture-rollback-exit" ] && IFS= read -r code < "$HOME/fixture-rollback-exit"',
    'exit "$code"',
  ].join('\n') + '\n';

  const stampSha = (home: string): string =>
    (JSON.parse(readFileSync(join(home, '.ccrc', 'build.json'), 'utf8')) as { sha: string }).sha;
  /** A server box on stamp `version`, carrying the three facts "converged"
   *  is made of when a report names that version: the recorded role, the
   *  loopback address `_upd_gate_probe`'s `/health` read resolves through
   *  `_box_server_addr`, and a completed-install record naming the stamp's
   *  sha — read off the stamp, never retyped. `role: null` records none. */
  const watchBox = (prefix: string, opts: { version?: string; role?: string | null } = {}): string => {
    const home = freshUpdateBox(prefix);
    plantOldBox(home, { version: opts.version ?? 'v2.0.0' });
    const role = opts.role === undefined ? 'server' : opts.role;
    writeFileSync(join(home, '.ccrc', 'ccrc.env'),
      `${role === null ? '' : `CCRC_ROLE=${role}\n`}CCRC_HOST=127.0.0.1\nCCRC_PORT=7788\n`);
    writeFileSync(join(home, '.ccrc', 'installed'), `${stampSha(home)}\n`);
    writeFileSync(join(home, '.local', 'bin', 'ccrc'), LAUNCHER, { mode: 0o755 });
    return home;
  };

  type WatchReport = { target: string | null; phase: string; startedAt: number; updatedAt: number;
    detail: null; from: string; pid: number };
  const jsonPath = (home: string): string => join(home, '.ccrc', 'update.json');
  /** A report in Task 1's exact shape — seven keys, in order — last written
   *  `ageS` seconds ago. */
  const report = (home: string,
    r: { phase: string; ageS: number; target?: string | null; pid?: number; from?: string }): WatchReport => {
    const updatedAt = nowS() - r.ageS;
    const doc: WatchReport = {
      target: r.target === undefined ? 'v2.0.0' : r.target,
      phase: r.phase,
      startedAt: updatedAt - 45,
      updatedAt,
      detail: null,
      from: r.from ?? 'pwa',
      pid: r.pid ?? 4321,
    };
    writeFileSync(jsonPath(home), `${JSON.stringify(doc)}\n`);
    return doc;
  };
  const readReport = (home: string): Record<string, unknown> =>
    JSON.parse(readFileSync(jsonPath(home), 'utf8')) as Record<string, unknown>;
  const lines = (home: string, name: string): string[] => (existsSync(join(home, name))
    ? readFileSync(join(home, name), 'utf8').split('\n').filter((l) => l !== '') : []);
  /** The gate's own `/health` read ran: the watchdog MEASURED a healthy unit. */
  const healthProbed = (home: string): boolean =>
    lines(home, 'curl-argv').some((u) => u === 'http://127.0.0.1:7788/health');
  /** The probe STARTED at all. `_upd_gate_probe` measures the unit before it
   *  spends a `/health` request (Task 5), so on a box whose `fixture-unit-state`
   *  reads `failed` `healthProbed` is false whether or not a probe ran — the
   *  "nothing probed" negatives read the unit question instead. */
  const probed = (home: string): boolean =>
    lines(home, 'systemctl-calls').some((c) => c === '--user is-active ccrc.service');
  const lockFree = (home: string): boolean =>
    spawnSync('flock', ['-n', join(home, '.ccrc', 'update.lock'), 'true']).status === 0;

  const runWatchdog = (home: string, args: string[] = [],
    extraEnv: Record<string, string | undefined> = {}): Result => {
    mkdirSync(join(home, 'tmp'), { recursive: true });
    const env: NodeJS.ProcessEnv = {
      // D-3278 (fix round 1): three failing samples, `CCRC_WATCHDOG_PROBE_GAP_S`
      // apart, decide a rollback — defaulted to 0 here so a suite does not pay
      // real sleep time per failing-probe case; the gap test overrides it.
      ...updateEnv(home), TMPDIR: join(home, 'tmp'), CCRC_UPDATE_DEADLINE_MS: DEADLINE_MS,
      CCRC_WATCHDOG_PROBE_GAP_S: '0',
    };
    for (const [k, v] of Object.entries(extraEnv)) {
      if (v === undefined) delete env[k]; else env[k] = v;
    }
    replantDoctorStubs(home);
    const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'watchdog', ...args], { env, encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };

  const release = (pgid: number): void => {
    try { process.kill(-pgid, 'SIGKILL'); } catch { /* already gone */ }
  };
  /** A LIVE holder: a real `flock` on the real lock file, in its own process
   *  group, returned once the lock measurably IS held. `flock <file> sleep 30`
   *  hands its descriptor to the `sleep` child, which a kill of `flock` alone
   *  would leave holding the lock (Task 2's reason for its one-process
   *  `bash -c 'exec 9>>…'` holder); `release` kills the whole GROUP, so both go. */
  const holdLock = async (home: string): Promise<number> => {
    const holder = spawn('flock', [join(home, '.ccrc', 'update.lock'), 'sleep', '30'],
      { stdio: 'ignore', detached: true });
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      if (!lockFree(home)) return holder.pid!;
      await new Promise((res) => setTimeout(res, 20));
    }
    release(holder.pid!);
    throw new Error('the fixture holder never took ~/.ccrc/update.lock');
  };

  itLinux('leaves an absent, a settled, an unreadable and a fresh report alone — one line each, exit 0, nothing probed, nothing rolled back', () => {
    const home = watchBox('ccrc-watchdog-quiet-');
    // A box that WOULD be rolled back if any of these acted.
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    let r = runWatchdog(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe('watchdog: no update report\n');
    for (const phase of NOT_IN_FLIGHT) {
      report(home, { phase, ageS: 3600 });
      const before = readFileSync(jsonPath(home), 'utf8');
      r = runWatchdog(home);
      expect(r.code, `${phase}: ${r.stderr}`).toBe(0);
      expect(r.stdout).toBe(`watchdog: last update ${phase} — nothing to do\n`);
      expect(readFileSync(jsonPath(home), 'utf8')).toBe(before);
    }
    for (const bad of ['not json\n', '[1,2]\n', '{"phase":"installing"}\n',
      '{"phase":"installing","updatedAt":"yesterday"}\n', '{"phase":"installing","updatedAt":1.5}\n',
      // A MILLISECOND stamp (13 digits): not this file's unit (rulings R1,
      // R14), and past W2's UNIX_SECONDS_MAX — unreadable, never "fresh".
      `{"phase":"installing","updatedAt":${Date.now()}}\n`,
      '{"phase":"install\\u001bing","updatedAt":1}\n']) {
      writeFileSync(jsonPath(home), bad);
      r = runWatchdog(home);
      expect(r.code, `${bad}: ${r.stderr}`).toBe(0);
      expect(r.stdout).toBe('watchdog: ~/.ccrc/update.json is unreadable or malformed — not acting on what cannot be read\n');
      expect(readFileSync(jsonPath(home), 'utf8')).toBe(bad);
    }
    report(home, { phase: 'installing', ageS: 30 });
    r = runWatchdog(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^watchdog: update in progress \(installing, 3\ds old\)\n$/);
    expect(existsSync(join(home, 'launcher-argv'))).toBe(false);
    expect(probed(home)).toBe(false);
  });

  // Fix round 1 item 9 / review 155 C15: a FIFO at ~/.ccrc/update.json must
  // not block the watchdog's tick — `_upd_report_readable` refuses it
  // UNOPENED, before the first `jq`, so the run returns within its own
  // deadline rather than sitting wedged for the unit's whole
  // TimeoutStartSec. Bounded by `runBounded` (GNU `timeout -k`, the process
  // GROUP) because a plain spawnSync timeout cannot reach a hang inside
  // jq, a grandchild of the watchdog process.
  it.skipIf(process.platform !== 'linux' || UPD_DEADLINE_BIN === null)(
    'a FIFO at ~/.ccrc/update.json is refused UNOPENED, promptly, never blocking the tick (fix round 1 item 9 / review 155 C15)', () => {
      const home = watchBox('ccrc-watchdog-fifo-');
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      rmSync(jsonPath(home), { force: true });
      expect(spawnSync('mkfifo', [jsonPath(home)]).status, 'mkfifo').toBe(0);
      mkdirSync(join(home, 'tmp'), { recursive: true });
      const env: NodeJS.ProcessEnv = {
        ...updateEnv(home), TMPDIR: join(home, 'tmp'), CCRC_UPDATE_DEADLINE_MS: DEADLINE_MS,
        CCRC_WATCHDOG_PROBE_GAP_S: '0',
      };
      replantDoctorStubs(home);
      const r = runBounded([BASH, join(REPO, 'ccd', 'ccrc'), 'watchdog'], env, 5000);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toBe('watchdog: ~/.ccrc/update.json is unreadable or malformed — not acting on what cannot be read\n');
    }, 15000);

  itLinux('acts on exactly the nine in-flight phases — W2\'s IN_FLIGHT_UPDATE_PHASES — declared once in ccd/ccrc', () => {
    const src = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    const m = /^UPD_IN_FLIGHT_PHASES=\(([^)]*)\)$/m.exec(src);
    expect(m, 'ccd/ccrc declares no UPD_IN_FLIGHT_PHASES').toBeTruthy();
    expect(m![1]!.split(' ')).toEqual(IN_FLIGHT);
    expect(src.split('\n').filter((l) => l.startsWith('UPD_IN_FLIGHT_PHASES=')).length).toBe(1);
    const home = watchBox('ccrc-watchdog-inflight-');
    for (const phase of IN_FLIGHT) {
      report(home, { phase, ageS: 90 });
      const r = runWatchdog(home);
      expect(r.code, `${phase}: ${r.stderr}`).toBe(0);
      expect(readReport(home).phase, phase).toBe('failed');
      expect(readReport(home).detail, phase).toBe('abandoned by its updater; box measures converged at v2.0.0');
    }
  });

  // Fix round 1 item 23-C6 / review 155 C6, RE-PINNED per review fix round
  // 1 I4: an unknown/corrupted `from` is NOT item 18's retry signal (that
  // keys on the RAW word being literally `watchdog`, captured before this
  // coercion) — it is C6's own fallback, for JSON-injection safety on a
  // REWRITE only. So a genuinely stale report whose `from` is merely
  // unknown, on an UNHEALTHY box, is reverted exactly as any other stale
  // report would be — ONE revert attempt — and when that attempt is
  // refused, `cmd_watchdog`'s own rewrite (`_upd_phase`, using the COERCED
  // `UPD_FROM`) must still parse as JSON with `from: watchdog`.
  itLinux('an unknown/corrupted `from` on an unhealthy box is reverted as any other stale report — ONE revert attempt, and the rewrite is still valid JSON with from=watchdog (review fix round 1 I4 / fix round 1 item 23-C6 / review 155 C6)', () => {
    const home = watchBox('ccrc-watchdog-from-quote-');
    const doc = { target: 'v2.0.0', phase: 'installing', startedAt: nowS() - 135, updatedAt: nowS() - 90,
      detail: null, from: 'a"b', pid: 4242 };
    writeFileSync(jsonPath(home), `${JSON.stringify(doc)}\n`);
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    writeFileSync(join(home, 'fixture-rollback-exit'), '1\n');
    const r = runWatchdog(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stdout).toMatch(/— rolling back$/m);
    expect(lines(home, 'launcher-argv')).toEqual(['rollback --from watchdog']);
    const raw = readFileSync(jsonPath(home), 'utf8');
    let parsed: Record<string, unknown> = {};
    expect(() => { parsed = JSON.parse(raw) as Record<string, unknown>; }, `not valid JSON:\n${raw}`).not.toThrow();
    expect(parsed.from, raw).toBe('watchdog');
    expect(parsed.phase, raw).toBe('failed');
    expect(String(parsed.detail)).toMatch(/^watchdog: rollback refused \(exit 1\); box unhealthy: /);
  });

  itLinux('stale, no holder, and the box measures CONVERGED at the target: rewritten failed: abandoned…converged, the updater\'s attribution kept, NO rollback (§18 "the watchdog re-measures before it reverts")', () => {
    const home = watchBox('ccrc-watchdog-converged-');
    const was = report(home, { phase: 'installing', ageS: 90, from: 'pwa', pid: 4321 });
    const r = runWatchdog(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const now = readReport(home);
    expect(Object.keys(now)).toEqual(['target', 'phase', 'startedAt', 'updatedAt', 'detail', 'from', 'pid']);
    expect(now.phase).toBe('failed');
    expect(now.detail).toBe('abandoned by its updater; box measures converged at v2.0.0');
    expect(now.target).toBe('v2.0.0');
    expect(now.from).toBe('pwa');
    expect(now.pid).toBe(4321);
    expect(now.startedAt).toBe(was.startedAt);
    expect(now.updatedAt as number).toBeGreaterThan(was.updatedAt);
    expect(r.stdout).toMatch(/^watchdog: stale report \(installing, 9\ds\) on a box that measures converged at v2\.0\.0 and answers healthy — recorded as abandoned; nothing was reverted$/m);
    // It MEASURED — the gate's own /health read ran — and it did not revert.
    expect(healthProbed(home)).toBe(true);
    expect(existsSync(join(home, 'launcher-argv'))).toBe(false);
    // …and it let go: a later update is never refused by a watchdog that ended.
    expect(lockFree(home)).toBe(true);
  });

  itLinux('D-5329 (review 589 F1): a stale `restarting` report the watchdog closes on a passing probe carries `"sweep":"died: abandoned"`; a stale report in any other in-flight phase closes with NO sweep key', () => {
    // The one phase the supervisor sweep runs in: an updater closed there died
    // during or right after its sweep, and the doctor's update-sweep WARN reads
    // the word. Converged arm first.
    const home = watchBox('ccrc-watchdog-sweep-converged-');
    report(home, { phase: 'restarting', ageS: 90 });
    let r = runWatchdog(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    let now = readReport(home);
    expect(Object.keys(now)).toEqual(['target', 'phase', 'startedAt', 'updatedAt', 'detail', 'from', 'pid', 'sweep']);
    expect(now.phase).toBe('failed');
    expect(now.detail).toBe('abandoned by its updater; box measures converged at v2.0.0');
    expect(now.sweep).toBe('died: abandoned');
    // The "healthy on the target, install never completed" arm, same phase.
    const home2 = watchBox('ccrc-watchdog-sweep-incomplete-');
    writeFileSync(join(home2, '.ccrc', 'installed'), 'a-record-for-some-other-build\n');
    report(home2, { phase: 'restarting', ageS: 90 });
    r = runWatchdog(home2);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    now = readReport(home2);
    expect(now.phase).toBe('failed');
    expect(String(now.detail)).toMatch(/^abandoned by its updater; box answers healthy on v2\.0\.0 but its install never completed/);
    expect(now.sweep).toBe('died: abandoned');
    // A stale report in every other in-flight phase closes keyless, on both arms.
    // Every in-flight phase but `restarting`, read from ccd/ccrc's own array (not a hand copy), so a phase added there
    // is covered, and a condition widened to `checking` or `restoring` reds (review 593 F1).
    const inFlight = /^UPD_IN_FLIGHT_PHASES=\(([^)]*)\)/m.exec(readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8'))?.[1]?.trim().split(/\s+/) ?? [];
    expect(inFlight, 'ccd/ccrc\'s UPD_IN_FLIGHT_PHASES was not read').toContain('restarting');
    expect(inFlight.length, 'the nine in-flight phases').toBe(9);
    for (const phase of inFlight.filter((p) => p !== 'restarting')) {
      const h = watchBox(`ccrc-watchdog-nosweep-converged-${phase}-`);
      report(h, { phase, ageS: 90 });
      r = runWatchdog(h);
      expect(r.code, `${phase}: ${r.stderr}`).toBe(0);
      now = readReport(h);
      expect(now.phase, phase).toBe('failed');
      expect(Object.keys(now), phase).toEqual(['target', 'phase', 'startedAt', 'updatedAt', 'detail', 'from', 'pid']);
      const h2 = watchBox(`ccrc-watchdog-nosweep-incomplete-${phase}-`);
      writeFileSync(join(h2, '.ccrc', 'installed'), 'a-record-for-some-other-build\n');
      report(h2, { phase, ageS: 90 });
      r = runWatchdog(h2);
      expect(r.code, `${phase}: ${r.stderr}`).toBe(0);
      now = readReport(h2);
      expect(now.phase, phase).toBe('failed');
      expect(Object.keys(now), phase).toEqual(['target', 'phase', 'startedAt', 'updatedAt', 'detail', 'from', 'pid']);
    }
  });

  itLinux('stale, no holder, healthy but NOT converged: rewritten with what the box IS, never a rollback (D-3246, D-3268)', () => {
    // The updater died before the tree moved: healthy on the OLD build.
    const home = watchBox('ccrc-watchdog-healthy-old-', { version: 'v1.0.0' });
    report(home, { phase: 'fetching', ageS: 90, target: 'v2.0.0' });
    let r = runWatchdog(home);
    expect(r.code, r.stderr).toBe(0);
    expect(readReport(home).detail).toBe('abandoned by its updater; box measures healthy at v1.0.0, not at v2.0.0');
    expect(r.stdout).toMatch(/\(only a failing probe reverts\)$/m);
    expect(existsSync(join(home, 'launcher-argv'))).toBe(false);
    // On the target and healthy, but the spine never reached `_inst_installed`:
    // a box to FINISH, not to revert — and the sentence says how.
    const home2 = watchBox('ccrc-watchdog-healthy-incomplete-');
    writeFileSync(join(home2, '.ccrc', 'installed'), 'a-record-for-some-other-build\n');
    report(home2, { phase: 'installing', ageS: 90 });
    r = runWatchdog(home2);
    expect(r.code, r.stderr).toBe(0);
    expect(readReport(home2).detail).toBe('abandoned by its updater; box answers healthy on v2.0.0 but its install never completed (the completed-install record does not name its stamp); rerun: ccrc update --to v2.0.0 --force');
    expect(existsSync(join(home2, 'launcher-argv'))).toBe(false);
    // …and when the run that died was a ROLLBACK, `update --force` would be
    // refused below the floor (M7): the remedy is Task 7's `_upd_rerun_hint`.
    report(home2, { phase: 'installing', ageS: 90, from: 'rollback' });
    r = runWatchdog(home2);
    expect(r.code, r.stderr).toBe(0);
    expect(readReport(home2).detail).toBe('abandoned by its updater; box answers healthy on v2.0.0 but its install never completed (the completed-install record does not name its stamp); rerun: ccrc rollback --to v2.0.0');
    // D-3285 (final review, B3(ii)): `restore` — arm 2's own child — is the
    // SAME shape: the PARENT's completed spine already raised the floor to
    // the tag that just failed, so `update --to <prev> --force` is refused
    // there too; `_upd_rerun_hint` now groups `restore` with `rollback`.
    report(home2, { phase: 'installing', ageS: 90, from: 'restore' });
    r = runWatchdog(home2);
    expect(r.code, r.stderr).toBe(0);
    expect(readReport(home2).detail).toBe('abandoned by its updater; box answers healthy on v2.0.0 but its install never completed (the completed-install record does not name its stamp); rerun: ccrc rollback --to v2.0.0');
    // A report with no target (null) is never "converged", and stays null.
    const home3 = watchBox('ccrc-watchdog-healthy-notarget-');
    report(home3, { phase: 'resolving', ageS: 90, target: null });
    r = runWatchdog(home3);
    expect(r.code, r.stderr).toBe(0);
    expect(readReport(home3).detail).toBe('abandoned by its updater; box measures healthy at v2.0.0, not at its target');
    expect(readReport(home3).target).toBe(null);
  });

  itLinux('stale, no holder, healthy but NOT at the target, in a phase that may have moved the tree: left non-terminal and re-measured every tick, so a later failing probe still reverts it (D-3246, design §11)', () => {
    // The updater was killed INSIDE `_inst_tree`, `_inst_bins` or `_inst_files`,
    // which run before `_inst_stamp` and `_inst_enable`. The stamp still names
    // v1.0.0 and ccrc.service is still the old in-memory process, so the probe
    // passes on v1.0.0, over a tree that is partly v2.0.0 on disk. A terminal
    // `failed` here would answer "nothing to do" on the tick after ccrc.service
    // restarts onto that tree, which is design §11's own scenario.
    for (const phase of ['installing', 'restarting', 'checking', 'restoring']) {
      const home = watchBox(`ccrc-watchdog-healthy-moving-${phase}-`, { version: 'v1.0.0' });
      report(home, { phase, ageS: 90, target: 'v2.0.0' });
      const before = readFileSync(jsonPath(home), 'utf8');
      let r = runWatchdog(home);
      expect(r.code, `${phase}: ${r.stderr}`).toBe(0);
      expect(r.stdout).toMatch(new RegExp(`^watchdog: stale report \\(${phase}, 9\\ds\\) on a box that answers healthy at v1\\.0\\.0, not at v2\\.0\\.0 — its tree may be partly replaced; not acting, re-measuring every tick$`, 'm'));
      expect(readFileSync(jsonPath(home), 'utf8'), phase).toBe(before);
      // It MEASURED, and it let go of the lock.
      expect(healthProbed(home), phase).toBe(true);
      expect(existsSync(join(home, 'launcher-argv')), phase).toBe(false);
      expect(lockFree(home), phase).toBe(true);
      // ccrc.service restarts onto the half-placed tree and fails: the NEXT
      // tick still reverts, because nothing above closed the report.
      writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
      r = runWatchdog(home);
      expect(r.code, `${phase}: ${r.stderr}`).toBe(0);
      expect(lines(home, 'launcher-argv'), phase).toEqual(['rollback --from watchdog']);
    }
  });

  itLinux('stale, no holder, and the box FAILS its health probe: ccrc rollback --from watchdog, with the lock FREE and no marker; the rollback owns update.json after (§18 "the watchdog reverts a dead updater")', () => {
    const home = watchBox('ccrc-watchdog-revert-');
    report(home, { phase: 'installing', ageS: 90 });
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    // An ambient marker must never reach the rollback: it takes the lock itself.
    const r = runWatchdog(home, [], { CCRC_UPDATE_LOCK_HELD: String(process.pid) });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^watchdog: stale report \(installing, 9\ds\) and the box fails its health probe \(.+\) — rolling back$/m);
    expect(lines(home, 'launcher-argv')).toEqual(['rollback --from watchdog']);
    expect(lines(home, 'launcher-lock')).toEqual(['free']);
    expect(lines(home, 'launcher-marker')).toEqual(['unset']);
    expect(readReport(home).phase).toBe('installing');
    expect(lockFree(home)).toBe(true);
    // /health answering the OLD version on a box whose stamp moved — the
    // half-replaced tree restart-looping on the previous server — fails the
    // same probe.
    const home2 = watchBox('ccrc-watchdog-revert-oldhealth-');
    report(home2, { phase: 'restarting', ageS: 90 });
    writeFileSync(join(home2, 'fixture-health-pin'), 'v1.0.0\n');
    expect(runWatchdog(home2).code).toBe(0);
    expect(lines(home2, 'launcher-argv')).toEqual(['rollback --from watchdog']);
  });

  // RE-REVIEW regression (D-3285, one clause added): every OTHER test in
  // Fix round 1 item 8 / review 155 C14, REPLACING the re-review's own
  // outcome: a watchdog that MEASURED FAILURE never writes a success word.
  // The scenario is unchanged (previous names the box's own RUNNING,
  // COMPLETED tag — a bare `rollback --from watchdog` would converge on
  // nothing), but the re-review's fix — closing the report as `done` once
  // `cmd_rollback`'s own convergence path ran — is now ITSELF the C14
  // defect: it claims success on a box this run just measured UNHEALTHY.
  // `cmd_watchdog`'s own read-only pre-check (the same shape D-3285's
  // `cmd_rollback` pre-check and this function's own passing-probe arm
  // both use) now catches this BEFORE ever invoking `ccrc rollback` — so
  // the REAL binary substitution the re-review's test needed is no longer
  // reached, kept anyway as a control: were the pre-check ever bypassed,
  // this box's real `cmd_rollback` would converge exactly as before,
  // proving the pre-check's read matches what the real path would do.
  itLinux('a stale report on a box whose `previous` already names its own RUNNING, COMPLETED tag: `failed`, nothing to revert to — not `done` (fix round 1 item 8 / review 155 C14)', () => {
    const home = watchBox('ccrc-watchdog-revert-converged-');
    // The REAL binary, not the stub LAUNCHER — the control described above.
    cpSync(join(REPO, 'ccd', 'ccrc'), join(home, '.local', 'bin', 'ccrc'));
    chmodSync(join(home, '.local', 'bin', 'ccrc'), 0o755);
    // previous == the box's own running tag (v2.0.0, watchBox's default) —
    // the scenario needs: a bare `rollback --from watchdog` (no --to)
    // resolves `to` from here, and it names what this box is ALREADY on.
    writeFileSync(join(home, '.ccrc', 'previous'), 'v2.0.0\noldsha0000000000000000000000000000000000\n');
    // Published, its build.json sha matching the box's own stamp — the
    // shape `_upd_converged` needs to answer yes, were it reached for real.
    // `packRelease` derives `<home>/releases/…` itself — the same
    // `CCRC_RELEASE_BASE_URL` shape `runUpdate`'s own default uses.
    packRelease(home, selfConvergedTree(home, 'v2.0.0', 'oldsha0000000000000000000000000000000000'),
      { tag: 'v2.0.0', latest: false });
    report(home, { phase: 'checking', ageS: 90 });
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    const releaseUrl = `local://${home}/releases`;
    const r = runWatchdog(home, [], { CCRC_RELEASE_BASE_URL: releaseUrl });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    // Never reaches "— rolling back": the pre-check returns first.
    expect(r.stdout).not.toMatch(/rolling back/);
    expect(r.stdout).toMatch(/^watchdog: stale report \(checking, 9\ds\) fails its health probe \(.+\), but ~\/\.ccrc\/previous already names v2\.0\.0, the release this box is already converged on — recorded as abandoned; nothing was reverted$/m);
    const rep1 = readReport(home);
    expect(rep1['phase'], `stdout: ${r.stdout}`).toBe('failed');
    expect(rep1['detail']).toMatch(/^abandoned by its updater; nothing to revert to; box unhealthy: .+$/);
    expect(lockFree(home)).toBe(true);
    // Second tick: the report is now TERMINAL (`failed`), so the watchdog
    // takes the NOT_IN_FLIGHT "nothing to do" branch — it must not probe,
    // must not touch the lock, must not run rollback again.
    const before = readFileSync(jsonPath(home), 'utf8');
    const r2 = runWatchdog(home, [], { CCRC_RELEASE_BASE_URL: releaseUrl });
    expect(r2.code, `stderr: ${r2.stderr}`).toBe(0);
    expect(r2.stdout).toBe('watchdog: last update failed — nothing to do\n');
    expect(readFileSync(jsonPath(home), 'utf8')).toBe(before);
  });

  // Review fix round 1, M6 considered and NOT applied as literally worded
  // (see `ccd/ccrc`'s own comment at item 8's check, and the report's
  // Concerns): widening to "target is the running tag" ALONE, dropping the
  // completed-record requirement, was measured to make item 8 wrongly
  // intercept a box whose tree is mid-spine-kill (the record cleared by the
  // dying run itself, stamp not yet moved) — exactly the shape this file's
  // own REAL-kill test (design §16, Review Focus 5) needs reverted, not
  // abandoned. This is the CONTROL for that decision: `previous` names the
  // running tag, but the completed-install record is ABSENT (an incomplete
  // install, indistinguishable here from "a run just like the real-kill
  // test died leaving this exact shape") — item 8 must NOT intercept, and
  // a real revert attempt must still run.
  itLinux('previous names the running tag with an INCOMPLETE record: NOT "nothing to revert to" — a real revert attempt still runs (review fix round 1 M6, considered and not applied)', () => {
    const home = watchBox('ccrc-watchdog-revert-incomplete-');
    rmSync(join(home, '.ccrc', 'installed'), { force: true });
    writeFileSync(join(home, '.ccrc', 'previous'), 'v2.0.0\noldsha0000000000000000000000000000000000\n');
    report(home, { phase: 'checking', ageS: 90 });
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    const r = runWatchdog(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/— rolling back$/m);
    expect(lines(home, 'launcher-argv')).toEqual(['rollback --from watchdog']);
  });

  itLinux('a refused rollback is relayed; when it wrote nothing it is recorded, verdict first — when it wrote its own report, that report stands', () => {
    const home = watchBox('ccrc-watchdog-refused-');
    const was = report(home, { phase: 'installing', ageS: 90 });
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    writeFileSync(join(home, 'fixture-rollback-exit'), '1\n');
    let r = runWatchdog(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/^watchdog: ccrc rollback --from watchdog exited 1$/m);
    const now = readReport(home);
    expect(now.phase).toBe('failed');
    expect(String(now.detail)).toMatch(/^watchdog: rollback refused \(exit 1\); box unhealthy: ./);
    expect(now.startedAt).toBe(was.startedAt);
    expect(now.pid).toBe(was.pid);
    const home2 = watchBox('ccrc-watchdog-refused-own-');
    report(home2, { phase: 'installing', ageS: 90 });
    writeFileSync(join(home2, 'fixture-unit-state'), 'failed\n');
    writeFileSync(join(home2, 'fixture-rollback-exit'), '1\n');
    const own = `${JSON.stringify({ target: 'v1.0.0', phase: 'failed', startedAt: nowS(), updatedAt: nowS(),
      detail: 'rollback: nothing to roll back to', from: 'watchdog', pid: 777 })}\n`;
    writeFileSync(join(home2, 'fixture-rollback-report'), own);
    r = runWatchdog(home2);
    expect(r.code).toBe(1);
    expect(readFileSync(jsonPath(home2), 'utf8')).toBe(own);
  });

  // Review fix round 1, M1: the THIRD read (the refused-rollback re-lock's
  // own `after="$(jq …)"`) had no guard — a FIFO there would block this
  // tick for the unit's whole TimeoutStartSec. The launcher swaps
  // update.json for a FIFO right before it exits refused, so the watchdog's
  // re-lock-and-re-read meets it. Bounded (`runBounded`, GNU `timeout -k`):
  // a regression here is a hang, not an assertion failure.
  it.skipIf(process.platform !== 'linux' || UPD_DEADLINE_BIN === null)(
    'M1: a FIFO at update.json during the refused-rollback re-lock (the THIRD read) is refused too, never blocking the tick (review fix round 1 M1)', () => {
      const home = watchBox('ccrc-watchdog-m1-third-read-fifo-');
      report(home, { phase: 'installing', ageS: 90 });
      writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
      writeFileSync(join(home, 'fixture-rollback-exit'), '1\n');
      writeFileSync(join(home, 'fixture-rollback-fifo-swap'), '');
      mkdirSync(join(home, 'tmp'), { recursive: true });
      const env: NodeJS.ProcessEnv = {
        ...updateEnv(home), TMPDIR: join(home, 'tmp'), CCRC_UPDATE_DEADLINE_MS: DEADLINE_MS,
        CCRC_WATCHDOG_PROBE_GAP_S: '0',
      };
      replantDoctorStubs(home);
      const r = runBounded([BASH, join(REPO, 'ccd', 'ccrc'), 'watchdog'], env, 5000);
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
      expect(r.stdout).toMatch(/^watchdog: ccrc rollback --from watchdog exited 1$/m);
      // A FIFO now sits at the path — no readable regular report to assert.
    }, 15000);

  // Fix round 1 item 18 / review 155 C29: a killed watchdog rollback must
  // not be retried with no bound. Two ticks, one launcher that RECORDS ITS
  // OWN ARGV AND DIES (review C29's own measured shape): tick 0's report is
  // NOT yet `from: watchdog`, so the watchdog invokes `ccrc rollback --from
  // watchdog` for the first (and only allowed) time; the launcher simulates
  // being killed mid-flight — it leaves its OWN stale, in-flight report,
  // `from: watchdog`, and exits non-zero. Tick 1 must see that report, MUST
  // NOT invoke the launcher again (one line in launcher-argv, not two), and
  // must record `failed` — not retry.
  itLinux('a stale in-flight report whose `from` is already `watchdog` is never rolled back again — exactly one revert attempt across two ticks (fix round 1 item 18 / review 155 C29)', () => {
    const home = watchBox('ccrc-watchdog-killed-retry-');
    // ageS DIFFERS from the died report's own `updatedAt` below (120s vs
    // 90s) so the post-refusal "did the report move?" guard
    // (`$after != $upd`) reads a real change and never overwrites what the
    // launcher itself wrote.
    report(home, { phase: 'installing', ageS: 120, from: 'pwa' });
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    writeFileSync(join(home, 'fixture-rollback-exit'), '137\n');
    // The DYING launcher's own report: in-flight, `from: watchdog`, and
    // already STALE (updatedAt 90s in the past) — no real sleep needed, the
    // fixture controls the clock directly, exactly as `report()` does.
    const died = `${JSON.stringify({ target: 'v1.0.0', phase: 'installing', startedAt: nowS() - 135,
      updatedAt: nowS() - 90, detail: null, from: 'watchdog', pid: 5150 })}\n`;
    writeFileSync(join(home, 'fixture-rollback-report'), died);

    let r = runWatchdog(home);
    expect(r.code, `tick 0 — stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(137);
    expect(r.stdout).toMatch(/^watchdog: stale report \(installing, 1[12]\ds\) and the box fails its health probe \(.+\) — rolling back$/m);
    expect(r.stdout).toMatch(/^watchdog: ccrc rollback --from watchdog exited 137$/m);
    expect(readFileSync(jsonPath(home), 'utf8')).toBe(died);
    expect(lines(home, 'launcher-argv')).toEqual(['rollback --from watchdog']);

    r = runWatchdog(home);
    expect(r.code, `tick 1 — stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).not.toMatch(/rolling back/);
    // Review fix round 1 I4: this check now runs AFTER the re-measurement,
    // so the stdout line names the probe's own failure too. The age is
    // real elapsed wall-clock time since the "died" fixture's fixed
    // `updatedAt` (nowS() - 90), so a wildcard, not an exact 90s, tolerates
    // however long tick 0 itself took to run.
    expect(r.stdout).toMatch(
      /^watchdog: stale report \(installing, \d+s\), from watchdog, fails its health probe \(.+\) — a PRIOR watchdog rollback died mid-flight; not retrying, recorded as failed\n$/);
    // NOT invoked a second time.
    expect(lines(home, 'launcher-argv')).toEqual(['rollback --from watchdog']);
    const rep = readReport(home);
    expect(rep.phase).toBe('failed');
    expect(String(rep.detail)).toMatch(/^the watchdog's own rollback died; not retrying; box unhealthy: .+$/);
  });

  itLinux('a LIVE holder of ~/.ccrc/update.lock is never acted on — exit 0 and the sentence, nothing probed, the report byte-identical (§18 "the watchdog reverts a dead updater": the lock check)', async () => {
    const home = watchBox('ccrc-watchdog-live-');
    report(home, { phase: 'installing', ageS: 90, pid: 4321 });
    // The probe WOULD fail: only the lock stands between this box and a rollback.
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    const before = readFileSync(jsonPath(home), 'utf8');
    const holder = await holdLock(home);
    try {
      const r = runWatchdog(home);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toMatch(/^watchdog: updater pid 4321 holds ~\/\.ccrc\/update\.lock — its report is 9\ds old; not acting while it lives$/m);
      expect(readFileSync(jsonPath(home), 'utf8')).toBe(before);
      expect(existsSync(join(home, 'launcher-argv'))).toBe(false);
      expect(probed(home)).toBe(false);
    } finally { release(holder); }
  });

  itLinux('a holder whose report has not advanced in twice the deadline is recorded WEDGED — its pid, the instant it last reported — and nothing is reverted (§18 "the watchdog bounds a wedged holder")', async () => {
    const home = watchBox('ccrc-watchdog-wedged-');
    const was = report(home, { phase: 'installing', ageS: 200, pid: 4321, from: 'cli' });
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    const holder = await holdLock(home);
    try {
      const r = runWatchdog(home);
      expect(r.code, r.stderr).toBe(0);
      const now = readReport(home);
      expect(now.phase).toBe('failed');
      expect(now.detail).toBe(`watchdog: updater pid 4321 wedged holding ~/.ccrc/update.lock since ${String(was.updatedAt)}`);
      expect(now.pid).toBe(4321);
      expect(now.from).toBe('cli');
      expect(now.target).toBe('v2.0.0');
      expect(r.stdout).toMatch(/recorded as wedged; nothing was reverted$/m);
      expect(existsSync(join(home, 'launcher-argv'))).toBe(false);
      // The verdict is terminal: the next tick leaves it alone.
      expect(runWatchdog(home).stdout).toBe('watchdog: last update failed — nothing to do\n');
    } finally { release(holder); }
  });

  // Fix round 1 item 23-C7 / review 155 C7: nothing tested WHERE the wedged
  // threshold sits — the shipped cases use only a 90s report (well under
  // 2x the 60s deadline) and a 200s one (well past it), so any multiplier
  // between them (e.g. 3x instead of spec §11's 2x) would still pass. This
  // one sits strictly between 2x (120s) and 3x (180s) — 150s — and must be
  // WEDGED; a `2 * lim` -> `3 * lim` mutation reds this case alone.
  itLinux('a holder whose report is 150s old (strictly between 2x and 3x a 60s deadline) is ALSO recorded WEDGED — the multiplier is 2, not 3 (fix round 1 item 23-C7 / review 155 C7)', async () => {
    const home = watchBox('ccrc-watchdog-wedged-150-');
    const was = report(home, { phase: 'installing', ageS: 150, pid: 4321, from: 'cli' });
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    const holder = await holdLock(home);
    try {
      const r = runWatchdog(home);
      expect(r.code, r.stderr).toBe(0);
      const now = readReport(home);
      expect(now.phase).toBe('failed');
      expect(now.detail).toBe(`watchdog: updater pid 4321 wedged holding ~/.ccrc/update.lock since ${String(was.updatedAt)}`);
      expect(r.stdout).toMatch(/recorded as wedged; nothing was reverted$/m);
    } finally { release(holder); }
  });

  // Review fix round 1, M7 then M4: the 119s/121s pair bound the threshold
  // EXACTLY at 2x a 60s deadline, but item 0(b) asked for margins that
  // "survive a slow spawn" and a 1-second tolerance (`1(19|20)s`) does not —
  // `cmd_watchdog` reads its own `date +%s` only after `holdLock` (async,
  // polling) and this script's own bash startup, so a couple of seconds of
  // real spawn stall (measured: a 2s injected lag turns a 119s report into
  // 121s, crossing the 120s line) still reds the not-wedged half. Widened to
  // the brief's own example margins — 105s (well under 120) and 135s (well
  // over) — with the VERDICT and an AGE RANGE asserted, never an exact
  // second: the not-wedged range (100-119s) stays under the true 120s
  // threshold even with several seconds of stall, and the wedged range
  // (130-149s) stays over it the same way. Both mutation directions still
  // red on these two cases alone: `2 * lim` -> `3 * lim` (180s) would read
  // 135s as NOT wedged (135 < 180); `2 * lim` -> `1.5 * lim` (90s, as
  // `(lim * 3) / 2`, integer bash arithmetic) would read 105s as WEDGED
  // (105 > 90) — each flips exactly one of these two cases' verdict.
  itLinux('a holder\'s report well under 2x a 60s deadline (105s) is NOT wedged; well past it (135s) IS — margins survive a slow spawn (review fix round 1 M7, then M4)', async () => {
    const notWedgedHome = watchBox('ccrc-watchdog-wedged-105-');
    report(notWedgedHome, { phase: 'installing', ageS: 105, pid: 4321, from: 'cli' });
    writeFileSync(join(notWedgedHome, 'fixture-unit-state'), 'failed\n');
    const holder1 = await holdLock(notWedgedHome);
    try {
      const r = runWatchdog(notWedgedHome);
      expect(r.code, r.stderr).toBe(0);
      const m = /^watchdog: updater pid 4321 holds ~\/\.ccrc\/update\.lock — its report is (\d+)s old; not acting while it lives$/m
        .exec(r.stdout);
      expect(m, r.stdout).not.toBeNull();
      const age = Number(m![1]);
      expect(age, r.stdout).toBeGreaterThanOrEqual(100);
      expect(age, r.stdout).toBeLessThan(120);
    } finally { release(holder1); }

    const wedgedHome = watchBox('ccrc-watchdog-wedged-135-');
    const was = report(wedgedHome, { phase: 'installing', ageS: 135, pid: 4321, from: 'cli' });
    writeFileSync(join(wedgedHome, 'fixture-unit-state'), 'failed\n');
    const holder2 = await holdLock(wedgedHome);
    try {
      const r = runWatchdog(wedgedHome);
      expect(r.code, r.stderr).toBe(0);
      const now = readReport(wedgedHome);
      expect(now.phase).toBe('failed');
      expect(now.detail).toBe(`watchdog: updater pid 4321 wedged holding ~/.ccrc/update.lock since ${String(was.updatedAt)}`);
      const wm = /^watchdog: updater pid 4321 has held ~\/\.ccrc\/update\.lock with no report for (\d+)s, past twice the deadline — recorded as wedged; nothing was reverted$/m
        .exec(r.stdout);
      expect(wm, r.stdout).not.toBeNull();
      const age = Number(wm![1]);
      expect(age, r.stdout).toBeGreaterThanOrEqual(130);
      expect(age, r.stdout).toBeLessThan(150);
    } finally { release(holder2); }
  });

  itLinux('a lock that cannot be MEASURED is neither a live holder nor a free lock — exit 0 and the one sentence, nothing probed, nothing rewritten (ruling R16, D-3250)', () => {
    // Both of `_upd_lock_probe`'s rc-3 conditions (Task 2), on a report that
    // is past TWICE the deadline and a box whose probe would fail — so folding
    // rc 3 into "held" rewrites it as wedged, and folding it into "taken"
    // probes and rolls back. Only the rc-3 arm leaves both alone.
    const quiet = 'watchdog: the update lock could not be measured — not acting\n';
    // (1) The OPEN fails: a directory where the lock file belongs.
    const home = watchBox('ccrc-watchdog-lock-unopenable-');
    report(home, { phase: 'installing', ageS: 200 });
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    mkdirSync(join(home, '.ccrc', 'update.lock'));
    const before = readFileSync(jsonPath(home), 'utf8');
    let r = runWatchdog(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe(quiet);
    expect(readFileSync(jsonPath(home), 'utf8')).toBe(before);
    expect(probed(home)).toBe(false);
    expect(existsSync(join(home, 'launcher-argv'))).toBe(false);
    // (2) `flock -n` answers neither 0 (taken) nor contention's 1: a `flock`
    // on the fixture's PATH (its `~/.local/bin`, first) that fails the way a
    // bad descriptor does. `lockFree` uses the host's own flock, not this one.
    const home2 = watchBox('ccrc-watchdog-flock-unmeasured-');
    report(home2, { phase: 'installing', ageS: 200 });
    writeFileSync(join(home2, 'fixture-unit-state'), 'failed\n');
    writeFileSync(join(home2, '.local', 'bin', 'flock'),
      '#!/bin/sh\necho "flock: fixture: Bad file descriptor" >&2\nexit 64\n', { mode: 0o755 });
    const before2 = readFileSync(jsonPath(home2), 'utf8');
    r = runWatchdog(home2);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe(quiet);
    expect(readFileSync(jsonPath(home2), 'utf8')).toBe(before2);
    expect(probed(home2)).toBe(false);
    expect(existsSync(join(home2, 'launcher-argv'))).toBe(false);
  });

  itLinux('the deadline is CCRC_UPDATE_DEADLINE_MS, else ccrc.env\'s, else fifteen minutes — a positive integer of ms, or it is not read', () => {
    const home = watchBox('ccrc-watchdog-deadline-');
    const inProgress = /^watchdog: update in progress \(installing, 9\ds old\)$/m;
    report(home, { phase: 'installing', ageS: 90 });
    // No environment, no key: fifteen minutes, so 90 s is in progress.
    let r = runWatchdog(home, [], { CCRC_UPDATE_DEADLINE_MS: undefined });
    expect(r.stdout).toMatch(inProgress);
    // Not a positive integer: read as absent — never as zero, which would make
    // every live update stale the instant it wrote.
    for (const bad of ['0', 'soon', '-5', '']) {
      r = runWatchdog(home, [], { CCRC_UPDATE_DEADLINE_MS: bad });
      expect(r.stdout, `CCRC_UPDATE_DEADLINE_MS='${bad}'`).toMatch(inProgress);
    }
    // The environment wins over the file…
    appendFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_UPDATE_DEADLINE_MS=60000\n');
    r = runWatchdog(home, [], { CCRC_UPDATE_DEADLINE_MS: '600000' });
    expect(r.stdout).toMatch(inProgress);
    // …and the file — the key W2's server reads — is read when it has none.
    r = runWatchdog(home, [], { CCRC_UPDATE_DEADLINE_MS: undefined });
    expect(r.code, r.stderr).toBe(0);
    expect(readReport(home).detail).toBe('abandoned by its updater; box measures converged at v2.0.0');
    // Past fifteen minutes is stale on the default.
    const home2 = watchBox('ccrc-watchdog-deadline-default-');
    report(home2, { phase: 'installing', ageS: 16 * 60 });
    expect(runWatchdog(home2, [], { CCRC_UPDATE_DEADLINE_MS: undefined }).code).toBe(0);
    expect(readReport(home2).phase).toBe('failed');
  });

  // Wave 24 (D-6602): the watchdog takes the LARGEST deadline reading, for both of its thresholds, and says when one cannot be read.
  const W24_WATCHDOG_WARN = 'watchdog: WARN: CCRC_UPDATE_DEADLINE_MS does not read as one whole number of milliseconds everywhere the '
    + 'server may take it from (the environment, the box\'s ccrc.env, the exposure file) — using the largest reading ccrc could decide';

  itLinux('W24-D4: the watchdog warns on a deadline it cannot read and uses the largest it can', () => {
    const home = watchBox('ccrc-watchdog-w24-d4-');
    appendFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_UPDATE_DEADLINE_MS=6e5\n');
    report(home, { phase: 'installing', ageS: 700 });
    const r = runWatchdog(home, [], { CCRC_UPDATE_DEADLINE_MS: undefined });
    expect(r.code, r.stderr).toBe(0);
    const out = r.stdout.split('\n');
    expect(out[0]).toBe(W24_WATCHDOG_WARN);
    expect(out[1]).toMatch(/^watchdog: update in progress \(installing, 70\ds old\)$/);
    expect(existsSync(join(home, 'launcher-argv'))).toBe(false);
  });

  itLinux('W24-D5: the watchdog never wedges a live update the server still counts as inside its deadline', async () => {
    const home = watchBox('ccrc-watchdog-w24-d5-');
    appendFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_UPDATE_DEADLINE_MS=1800000\n');
    report(home, { phase: 'installing', ageS: 700 });
    const before = readFileSync(jsonPath(home), 'utf8');
    const pgid = await holdLock(home);
    try {
      // The environment's 300 s would make 700 s past twice the deadline; the server reads ccrc.env's 1800 s.
      const r = runWatchdog(home, [], { CCRC_UPDATE_DEADLINE_MS: '300000' });
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).not.toMatch(/wedged/);
      expect(r.stdout).toMatch(/^watchdog: update in progress \(installing, 70\ds old\)$/m);
      expect(readFileSync(jsonPath(home), 'utf8'), 'the report is not rewritten').toBe(before);
    } finally { release(pgid); }
  });

  itLinux('a fleet node has nothing to watch; an unrecorded role is the spine\'s default, both; any argument is a usage error', () => {
    const fleet = watchBox('ccrc-watchdog-fleet-', { role: 'fleet' });
    report(fleet, { phase: 'installing', ageS: 3600 });
    writeFileSync(join(fleet, 'fixture-unit-state'), 'failed\n');
    let r = runWatchdog(fleet);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe('watchdog: a fleet node is covered by the server\'s own deadline — nothing to watch here\n');
    expect(existsSync(join(fleet, 'launcher-argv'))).toBe(false);
    const bare = watchBox('ccrc-watchdog-norole-', { role: null });
    report(bare, { phase: 'installing', ageS: 90 });
    r = runWatchdog(bare);
    expect(r.code, r.stderr).toBe(0);
    expect(readReport(bare).detail).toBe('abandoned by its updater; box measures converged at v2.0.0');
    r = runWatchdog(bare, ['--now']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: unknown argument: --now$/m);
  });

  itDarwin('macOS is not centrally managed: exit 0 and the sentence, whatever the report says (decision 17)', () => {
    const home = watchBox('ccrc-watchdog-darwin-');
    report(home, { phase: 'installing', ageS: 3600 });
    const r = runWatchdog(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe('watchdog: macOS is not centrally managed (decision 17) — nothing to watch\n');
    expect(existsSync(join(home, 'launcher-argv'))).toBe(false);
  });

  itLinux('D-3276: a stale report in a pre-install phase with a failing probe is never rolled back — its tree cannot have moved', () => {
    for (const phase of ['fetching', 'backing-up']) {
      const home = watchBox(`ccrc-watchdog-preinstall-fail-${phase}-`);
      report(home, { phase, ageS: 90 });
      writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
      const r = runWatchdog(home);
      expect(r.code, `${phase}: ${r.stderr}`).toBe(0);
      const now = readReport(home);
      expect(now.phase, phase).toBe('failed');
      expect(String(now.detail), phase)
        .toMatch(/^abandoned by its updater; tree never moved, nothing reverted; box unhealthy: .+$/);
      expect(r.stdout, phase)
        .toMatch(/^watchdog: stale report \([a-z-]+, 9\ds\) fails its health probe \(.+\), but its tree never moved — recorded as abandoned; nothing was reverted$/m);
      expect(existsSync(join(home, 'launcher-argv')), phase).toBe(false);
      expect(lockFree(home), phase).toBe(true);
    }
  });

  // W6 Task 8A, review 167's F8: a watchdog rollback killed in any of the five
  // pre-install phases leaves a pre-install report whose raw `from` is
  // `watchdog`. D-3276's sentence ("tree never moved, nothing reverted") is
  // true of an update that never began and FALSE here: the update the
  // rollback was correcting did move the box, and the box is unhealthy on it.
  // Its own sentence says that, is terminal like C29's, and never retries.
  itLinux('F8: a watchdog rollback killed in a pre-install phase (a report from watchdog) with a failing probe is recorded with its own true sentence — never "tree never moved" — and is not retried', () => {
    for (const phase of ['queued', 'resolving', 'fetching', 'verifying', 'backing-up']) {
      const home = watchBox(`ccrc-watchdog-killed-rollback-${phase}-`);
      report(home, { phase, ageS: 90, from: 'watchdog', target: 'v1.0.0' });
      writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
      const r = runWatchdog(home);
      expect(r.code, `${phase}: ${r.stderr}`).toBe(0);
      const now = readReport(home);
      expect(now.phase, phase).toBe('failed');
      expect(String(now.detail), phase).toMatch(new RegExp(
        `^the watchdog's own rollback died at ${phase} before it moved anything; the box still runs the build the failed update left; not retrying; box unhealthy: .+$`));
      expect(String(now.detail), phase).not.toContain('tree never moved');
      expect(r.stdout, phase).toMatch(new RegExp(
        `^watchdog: stale report \\(${phase}, \\d+s\\), from watchdog, fails its health probe \\(.+\\) — a PRIOR watchdog rollback died at ${phase} before it moved anything; the box still runs the build the update it was correcting left; not retrying, recorded as failed$`, 'm'));
      expect(r.stdout, phase).not.toContain('tree never moved');
      expect(existsSync(join(home, 'launcher-argv')), `${phase}: it rolled back again`).toBe(false);
      expect(lockFree(home), phase).toBe(true);
    }
  });

  itLinux('D-3276: a stale report on an UNVERSIONED running tree with a failing probe is never rolled back', () => {
    // A deploy.sh-placed (or never-stamped) box: no ~/.ccrc/build.json at
    // all, so `_box_build_fields` answers non-zero and `cur_v` stays "".
    const home = freshUpdateBox('ccrc-watchdog-unversioned-');
    plantOldBox(home);
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=server\nCCRC_HOST=127.0.0.1\nCCRC_PORT=7788\n');
    writeFileSync(join(home, '.local', 'bin', 'ccrc'), LAUNCHER, { mode: 0o755 });
    report(home, { phase: 'installing', ageS: 90 });
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    const r = runWatchdog(home);
    expect(r.code, r.stderr).toBe(0);
    const now = readReport(home);
    expect(now.phase).toBe('failed');
    expect(String(now.detail))
      .toMatch(/^abandoned by its updater; unversioned tree, not reverting; box unhealthy: .+$/);
    expect(r.stdout)
      .toMatch(/^watchdog: stale report \(installing, 9\ds\) fails its health probe \(.+\) on an unversioned tree — recorded as abandoned; not reverting$/m);
    expect(existsSync(join(home, 'launcher-argv'))).toBe(false);
    expect(lockFree(home)).toBe(true);
  });

  itLinux('D-3277: the report moving between the first read and the lock stands the watchdog down — nothing rewritten, nothing rolled back', () => {
    const home = watchBox('ccrc-watchdog-moved-');
    report(home, { phase: 'installing', ageS: 90 });
    // A box that WOULD be rolled back if the stand-down did not fire.
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    // A fresh, TERMINAL report — modelling an updater that finished and
    // exited in the exact window between the watchdog's first (pre-lock)
    // read and its own `flock -n`.
    const movedDoc = {
      target: 'v2.0.0', phase: 'done', startedAt: 1, updatedAt: 999999999,
      detail: null, from: 'cli', pid: 4321,
    };
    const movedStr = `${JSON.stringify(movedDoc)}\n`;
    writeFileSync(join(home, 'fixture-flock-moved-report'), movedStr);
    // A `flock` shim ahead of the real one on PATH (this fixture's own
    // `.local/bin`, first): it rewrites update.json, then defers to the
    // REAL binary so the watchdog's own lock-take still succeeds (lrc=0) —
    // the locking semantics stay real, only the write in between is fixture.
    writeFileSync(join(home, '.local', 'bin', 'flock'),
      `#!/bin/sh\ncp "$HOME/fixture-flock-moved-report" "$HOME/.ccrc/update.json"\nexec ${FLOCK} "$@"\n`,
      { mode: 0o755 });
    const r = runWatchdog(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe('watchdog: the report moved while measuring — next tick\n');
    // The report is exactly what the SHIM wrote — the watchdog touched nothing.
    expect(readFileSync(jsonPath(home), 'utf8')).toBe(movedStr);
    expect(existsSync(join(home, 'launcher-argv'))).toBe(false);
    expect(healthProbed(home)).toBe(false);
    expect(probed(home)).toBe(false);
    expect(lockFree(home)).toBe(true);
  });

  // Review fix round 1, M2: the guard before D-3277's own re-read
  // (`_upd_report_readable || rrc2=$?`) shipped with no pin that reds when
  // it is deleted (measured: 27/27 green with it gone). Reusing THIS file's
  // own idiom immediately above — a `flock` shim ahead of the real one on
  // PATH, which mutates update.json then defers to the real binary, so the
  // watchdog's own lock-take still succeeds (lrc=0) and reaches the SECOND
  // read — except this shim swaps in a FIFO instead of a moved report.
  // Bounded (`runBounded`): a regression here is a hang, not merely a wrong
  // verdict.
  it.skipIf(process.platform !== 'linux' || UPD_DEADLINE_BIN === null)(
    'M2: a FIFO swapped in between the first read and D-3277\'s own second read is refused too, never blocking the tick (review fix round 1 M2)', () => {
      const home = watchBox('ccrc-watchdog-m2-second-read-fifo-');
      report(home, { phase: 'installing', ageS: 90 });
      writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
      writeFileSync(join(home, '.local', 'bin', 'flock'),
        `#!/bin/sh\nrm -f "$HOME/.ccrc/update.json"\nmkfifo "$HOME/.ccrc/update.json"\nexec ${FLOCK} "$@"\n`,
        { mode: 0o755 });
      mkdirSync(join(home, 'tmp'), { recursive: true });
      const env: NodeJS.ProcessEnv = {
        ...updateEnv(home), TMPDIR: join(home, 'tmp'), CCRC_UPDATE_DEADLINE_MS: DEADLINE_MS,
        CCRC_WATCHDOG_PROBE_GAP_S: '0',
      };
      replantDoctorStubs(home);
      // `replantDoctorStubs` copies from `doctor-stubs/`, which plants no
      // `flock` — the shim written above survives it. Re-planted here
      // anyway, AFTER, so this test never depends on that ordering fact
      // staying true.
      writeFileSync(join(home, '.local', 'bin', 'flock'),
        `#!/bin/sh\nrm -f "$HOME/.ccrc/update.json"\nmkfifo "$HOME/.ccrc/update.json"\nexec ${FLOCK} "$@"\n`,
        { mode: 0o755 });
      const r = runBounded([BASH, join(REPO, 'ccd', 'ccrc'), 'watchdog'], env, 5000);
      expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
      expect(r.stdout).toBe('watchdog: the report moved while measuring — next tick\n');
    }, 15000);

  itLinux('D-3278: the failing verdict needs three failing probe samples — one passing sample is a pass; all three failing rolls back with exactly 3 probes', () => {
    const healthCount = (home: string): number =>
      lines(home, 'curl-argv').filter((u) => u === 'http://127.0.0.1:7788/health').length;
    // Fails once, then passes: overall a PASS — no rollback, and the loop
    // stopped at 2 samples (it never spent a 3rd).
    const flip = watchBox('ccrc-watchdog-probe-flip-');
    report(flip, { phase: 'installing', ageS: 90 });
    writeFileSync(join(flip, 'fixture-health-fail-count'), '1\n');
    let r = runWatchdog(flip);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(flip, 'launcher-argv'))).toBe(false);
    expect(healthCount(flip)).toBe(2);
    // All three fail: rollback, and exactly 3 probes ran — never a 4th.
    const allFail = watchBox('ccrc-watchdog-probe-allfail-');
    report(allFail, { phase: 'installing', ageS: 90 });
    writeFileSync(join(allFail, 'fixture-health-fail-count'), '3\n');
    r = runWatchdog(allFail);
    expect(r.code, r.stderr).toBe(0);
    expect(lines(allFail, 'launcher-argv')).toEqual(['rollback --from watchdog']);
    expect(healthCount(allFail)).toBe(3);
  });

  itLinux('D-3278: the sampling gap is CCRC_WATCHDOG_PROBE_GAP_S — malformed reads as the five-second default (no die, no crash)', () => {
    const home = watchBox('ccrc-watchdog-probe-gap-malformed-');
    report(home, { phase: 'installing', ageS: 90 });
    writeFileSync(join(home, 'fixture-health-fail-count'), '1\n');
    const r = runWatchdog(home, [], { CCRC_WATCHDOG_PROBE_GAP_S: 'soon' });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/^watchdog: CCRC_WATCHDOG_PROBE_GAP_S='soon' is not digits-only — using 5$/m);
    // The malformed value did not stop the sample from running — a flip
    // still reads as a pass.
    expect(existsSync(join(home, 'launcher-argv'))).toBe(false);
  });

  itLinux('Minor F4: a refused rollback whose launcher leaves ~/.ccrc/update.lock HELD records nothing — the re-lock guard\'s "&&" half', () => {
    const home = watchBox('ccrc-watchdog-refused-heldlock-');
    const was = report(home, { phase: 'installing', ageS: 90 });
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    writeFileSync(join(home, 'fixture-rollback-exit'), '1\n');
    writeFileSync(join(home, 'fixture-rollback-leaves-holder'), '');
    const r = runWatchdog(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/^watchdog: ccrc rollback --from watchdog exited 1$/m);
    // The re-lock is CONTENDED (the launcher's own holder), so nothing is
    // recorded: the stale report the rollback was called on stands untouched.
    expect(readReport(home)).toEqual(was);
  }, 10_000);

  itLinux('Minor F5: jq missing is refused by name, exit 1, nothing measured', () => {
    const home = watchBox('ccrc-watchdog-nojq-');
    report(home, { phase: 'installing', ageS: 90 });
    const r = runWatchdog(home, [], { PATH: pathWithoutJq(home) });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(
      /^ccrc: watchdog: jq is not on PATH, so ~\/\.ccrc\/update\.json cannot be read — nothing was re-measured or reverted$/m);
    expect(existsSync(join(home, 'launcher-argv'))).toBe(false);
  });

  itLinux('Minor F5: flock missing is refused by name, exit 1, nothing measured', () => {
    const home = watchBox('ccrc-watchdog-noflock-');
    report(home, { phase: 'installing', ageS: 90 });
    const r = runWatchdog(home, [], { PATH: pathWithoutFlock(home) });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(
      /^ccrc: watchdog: flock \(util-linux\) is not on PATH, so a live updater cannot be told from a dead one — nothing was re-measured or reverted$/m);
    expect(existsSync(join(home, 'launcher-argv'))).toBe(false);
  });

  itLinux('Minor F5: date not answering unix seconds is refused by name, exit 1, nothing measured', () => {
    const home = watchBox('ccrc-watchdog-baddate-');
    report(home, { phase: 'installing', ageS: 90 });
    writeFileSync(join(home, '.local', 'bin', 'date'), '#!/bin/sh\necho not-a-number\n', { mode: 0o755 });
    const r = runWatchdog(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(
      /^ccrc: watchdog: date \+%s did not answer with unix seconds — nothing was re-measured or reverted$/m);
    expect(existsSync(join(home, 'launcher-argv'))).toBe(false);
  });

  itLinux('a REAL update killed mid-install: the watchdog reads the real writer\'s report in its own unit, leaves it while fresh, and reverts it once stale on a box that fails its probe (design §16, Review Focus 5)', async () => {
    const home = watchBox('ccrc-watchdog-killed-', { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    writeFileSync(join(home, 'fixture-install-hang'), '');
    mkdirSync(join(home, 'tmp'), { recursive: true });
    const env = {
      ...updateEnv(home), TMPDIR: join(home, 'tmp'), CCRC_RELEASE_BASE_URL: `local://${home}/releases`,
    };
    replantDoctorStubs(home);
    // Its own process group, so one kill takes the update AND its hung spine —
    // the OOM that ends a detached run mid-install.
    const child = spawn(BASH, [join(REPO, 'ccd', 'ccrc'), 'update', '--to', 'v2.0.0'],
      { env, detached: true, stdio: 'ignore' });
    let phase = '';
    try {
      const until = Date.now() + 15_000;
      while (Date.now() < until) {
        try { phase = String(readReport(home).phase); } catch { phase = ''; }
        if (phase === 'installing' && existsSync(join(home, 'staged-ccrc-argv'))) break;
        await new Promise((res) => setTimeout(res, 50));
      }
    } finally {
      release(child.pid!);
    }
    expect(phase, 'the update never reached its staged install').toBe('installing');
    const until = Date.now() + 5000;
    while (!lockFree(home) && Date.now() < until) await new Promise((res) => setTimeout(res, 20));
    expect(lockFree(home), 'the lock outlived the killed updater').toBe(true);
    const left = readReport(home);
    expect(left.phase).toBe('installing');
    expect(left.pid).toBe(child.pid);
    // FRESH on the default deadline. The writer's instant and the watchdog's
    // clock are one unit — seconds — or this reads as decades stale (a
    // seconds writer against a ms clock) or as from the future (the reverse).
    let r = runWatchdog(home, [], { CCRC_UPDATE_DEADLINE_MS: undefined });
    expect(r.stdout).toMatch(/^watchdog: update in progress \(installing, [0-9]{1,2}s old\)$/m);
    expect(existsSync(join(home, 'launcher-argv'))).toBe(false);
    // STALE (a 1 ms deadline — 0 s once divided, so the report must be at
    // least one whole second old), no holder, and the half-replaced server
    // will not stay up: the one case the watchdog reverts.
    while (nowS() <= (left.updatedAt as number)) await new Promise((res) => setTimeout(res, 50));
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    r = runWatchdog(home, [], { CCRC_UPDATE_DEADLINE_MS: '1' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(lines(home, 'launcher-argv')).toEqual(['rollback --from watchdog']);
    expect(lines(home, 'launcher-lock')).toEqual(['free']);
  }, 60_000);

  itLinux('the watchdog leaves the collector\'s generation journal byte-identical when it reverts (path-identity spec 2026-10-12 §5.3)', () => {
    const home = watchBox('ccrc-watchdog-journal-');
    const journal = plantCollectJournal(home);
    report(home, { phase: 'installing', ageS: 90 });
    writeFileSync(join(home, 'fixture-unit-state'), 'failed\n');
    const r = runWatchdog(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(lines(home, 'launcher-argv'), 'CONTROL: the watchdog reached its rollback').toEqual(['rollback --from watchdog']);
    expectJournalUntouched(journal, 'the watchdog');
  });
});

describe('ccrc update: the migration keeps the old tree until the gate (W6 Task 3)', () => {
  // On a pre-W6 box the W6 staged spine migrates `~/ccrc` (Task 3's install
  // half), but it runs under THIS run's `~/.ccrc/update.lock`, so its doctor
  // is not the gate and it keeps `~/ccrc.migrating`; `cmd_update` removes it
  // only once `_upd_gate` has passed. A crash pair left by an earlier run is
  // completed before anything else this verb does.
  const OLD_SHA = 'oldsha0000000000000000000000000000000000';
  const NEW_SHA = 'newsha0000000000000000000000000000000000';
  const REAL_LN = realPath('ln');
  const migrating = (home: string): string => join(home, 'ccrc.migrating');
  const resumed = (name: string): string =>
    `update: tree: completed a crashed migration — $HOME/ccrc was absent beside $HOME/ccrc.migrating; linked to $HOME/ccrc-versions/${name} (named by ~/.ccrc/migrating-to)`;
  const REMOVED = 'update: migration: $HOME/ccrc.migrating removed — the health gate passed';
  /** The FULL flavour over plantOldBox's REAL ~/ccrc — the migration fixture
   *  as it stands. */
  const fullBox = (prefix: string): string => {
    const home = freshUpdateBox(prefix);
    plantOldBox(home, { version: 'v1.0.0' });
    plantCoordDb(home);
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: NEW_SHA }), { tag: 'v2.0.0' });
    return home;
  };
  /** A crash pair an earlier run left: the pre-versioned tree aside, a
   *  complete v1.0.0 placed, the marker naming it, and no ~/ccrc at all. */
  const crashedPair = (home: string): void => {
    mkdirSync(join(migrating(home), 'server'), { recursive: true });
    writeFileSync(join(migrating(home), 'server', 'OLD-MARKER'), 'the pre-versioned tree\n');
    installVersionedTree(home, 'v1.0.0', { link: false, stamp: { sha: OLD_SHA, version: 'v1.0.0' } });
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'migrating-to'), 'v1.0.0\n');
    writeFileSync(join(home, '.ccrc', 'build.json'),
      `{"sha":"${OLD_SHA}","ref":"main","builtAt":"2026-08-20T00:00:00Z","dirty":false,"version":"v1.0.0"}\n`);
    writeFileSync(join(home, '.ccrc', 'installed'), `${OLD_SHA}\n`);
  };
  const at = (stdout: string, pred: (l: string) => boolean): number => stdout.split('\n').findIndex(pred);

  it('a pre-W6 box migrates inside the staged spine, which KEEPS ~/ccrc.migrating (this run holds the lock); cmd_update removes it only after _upd_gate passes (§18 "the migration keeps the old tree until the gate")', () => {
    const home = fullBox('ccrc-update-migrate-');
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(join(home, 'ccrc-versions', 'v2.0.0'));
    const linked = at(r.stdout, (l) => l === 'install: tree: $HOME/ccrc -> $HOME/ccrc-versions/v2.0.0 (the pre-versioned tree is kept at $HOME/ccrc.migrating until a health gate passes)');
    const kept = at(r.stdout, (l) => l === 'install: migration: $HOME/ccrc.migrating kept — an update holds ~/.ccrc/update.lock, and its health gate decides');
    const gate = at(r.stdout, (l) => l.startsWith('update: gate: both answers on v2.0.0 '));
    const removed = at(r.stdout, (l) => l === REMOVED);
    expect(linked, r.stdout).toBeGreaterThan(-1);
    expect(kept, 'the staged spine took its own doctor as the gate').toBeGreaterThan(linked);
    expect(gate).toBeGreaterThan(kept);
    expect(removed, 'the old tree went before the gate, or never').toBeGreaterThan(gate);
    expect(existsSync(migrating(home))).toBe(false);
    expect(existsSync(join(home, '.ccrc', 'migrating-to'))).toBe(false);
  });

  it('a FAILED gate never removes ~/ccrc.migrating: the run exits 4, and the pre-versioned tree and its marker are still there, byte for byte', () => {
    const home = fullBox('ccrc-update-migrate-gate-fail-');
    const before = treeDigest(join(home, 'ccrc'));
    writeFileSync(join(home, 'fixture-health-pin'), 'v1.0.0\n');   // /health keeps answering the OLD build
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(lstatSync(join(home, 'ccrc')).isSymbolicLink()).toBe(true);
    expect(treeDigest(migrating(home))).toEqual(before);
    expect(readFileSync(join(home, '.ccrc', 'migrating-to'), 'utf8')).toBe('v2.0.0\n');
    expect(r.stdout.split('\n')).not.toContain(REMOVED);
  });

  it('--no-gate measured nothing, so ~/ccrc.migrating is kept and the run says why', () => {
    const home = fullBox('ccrc-update-migrate-nogate-');
    const r = runUpdate(home, ['--no-gate']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const skipped = at(r.stdout, (l) => l.startsWith('update: gate: skipped (--no-gate)'));
    const kept = at(r.stdout, (l) => l === 'update: migration: $HOME/ccrc.migrating kept — --no-gate measured nothing');
    expect(skipped, r.stdout).toBeGreaterThan(-1);
    expect(kept).toBeGreaterThan(skipped);
    expect(lstatSync(migrating(home)).isDirectory()).toBe(true);
  });

  it('a crash pair is completed FIRST by ccrc update — before its backup, its install and its gate — and its old tree goes only after the gate passes (§18 "a crashed migration is completed first")', () => {
    const home = freshUpdateBox('ccrc-update-migrate-resume-');
    crashedPair(home);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const resume = at(r.stdout, (l) => l === resumed('v1.0.0'));
    const backup = at(r.stdout, (l) => l.startsWith('update: backup: '));
    const installing = at(r.stdout, (l) => l.startsWith('update: installing v2.0.0'));
    const gate = at(r.stdout, (l) => l.startsWith('update: gate: '));
    const removed = at(r.stdout, (l) => l === REMOVED);
    expect(resume, r.stdout).toBeGreaterThan(-1);
    expect(backup, 'something ran before the link was completed').toBeGreaterThan(resume);
    expect(installing).toBeGreaterThan(backup);
    expect(gate).toBeGreaterThan(installing);
    expect(removed).toBeGreaterThan(gate);
    expect(lstatSync(join(home, 'ccrc')).isSymbolicLink()).toBe(true);
    expect(existsSync(migrating(home))).toBe(false);
  });

  it('--check on a crashed box says so after its machine line and repairs NOTHING — no link, no marker change', () => {
    const home = freshUpdateBox('ccrc-update-migrate-check-');
    crashedPair(home);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    // runUpdate's own environment build, once, before the snapshot — the
    // `--check writes nothing` case's idiom, for the same reason.
    updateEnv(home);
    replantDoctorStubs(home);
    const before = homeSnapshot(home);
    const r = runUpdate(home, ['--check']);
    expect(r.code).toBe(1);
    const lines = r.stdout.split('\n');
    expect(lines[0]).toMatch(/^check: box=v1\.0\.0 /);
    // The remedy names a command that can run: the ccrc on PATH is the shim,
    // which execs the missing $HOME/ccrc/ccd/ccrc (crashedPair's marker names
    // the placed v1.0.0).
    expect(lines).toContain('this box\'s migration crashed ($HOME/ccrc is absent beside $HOME/ccrc.migrating) — '
      + 'run bash $HOME/ccrc-versions/v1.0.0/ccd/ccrc install (or bash install.sh from a ccrc checkout) to complete it '
      + '— the ccrc on PATH cannot run until then, and deploy.sh would place a second tree beside it');
    expect(homeSnapshot(home)).toEqual(before);
  });

  /** ONE `ln` ahead of the harness's PATH with two knobs, each disarmed on
   *  first use and each biting only an `ln` whose last argument is ~/ccrc —
   *  the staged spine's migration link. `fail` refuses it (exit 1); `kill`
   *  SIGKILLs the shell that ran it, i.e. the staged spine itself, so the
   *  parent's `inst_rc` reads 137 with the crash pair left behind. */
  const armLn = (home: string, knob: 'fixture-ln-fail-once' | 'fixture-ln-kill-once'): NodeJS.ProcessEnv => {
    mkdirSync(join(home, 'fail-bin'), { recursive: true });
    writeFileSync(join(home, 'fail-bin', 'ln'), '#!/bin/sh\n'
      + 'for last in "$@"; do :; done\n'
      + 'if [ "$last" = "$HOME/ccrc" ] && [ -f "$HOME/fixture-ln-fail-once" ]; then\n'
      + '  rm -f "$HOME/fixture-ln-fail-once"; echo "ln: fixture refusal" >&2; exit 1\n'
      + 'fi\n'
      + 'if [ "$last" = "$HOME/ccrc" ] && [ -f "$HOME/fixture-ln-kill-once" ]; then\n'
      + '  rm -f "$HOME/fixture-ln-kill-once"; kill -KILL "$PPID"; exit 1\n'
      + 'fi\n'
      + `exec ${REAL_LN} "$@"\n`, { mode: 0o755 });
    writeFileSync(join(home, knob), 'yes\n');
    return { PATH: `${join(home, 'fail-bin')}:${updateEnv(home)['PATH'] ?? ''}` };
  };

  it('a staged spine whose link cannot be placed moves ~/ccrc BACK before it dies, whichever updater is the parent — a W6 parent reads that as untouched and exits 1 with no gate or restore (D-3458); a wave-4 parent would gate and restore it instead (D-3436)', () => {
    const home = fullBox('ccrc-update-migrate-spine-ln-fail-');
    const r = runUpdate(home, [], armLn(home, 'fixture-ln-fail-once'));
    expect(existsSync(join(home, 'fixture-ln-fail-once')), 'the refusal never fired').toBe(false);
    expect(r.stderr).toContain('ccrc: $HOME/ccrc could not be linked to $HOME/ccrc-versions/v2.0.0, so it was moved back — nothing moved');
    // The move-back (D-3436) itself runs in the staged spine — W6's own
    // code — whichever updater drives this run, so no resume line is ever
    // printed either way: the layout reads `directory`, never `crashed`.
    expect(at(r.stdout, (l) => l === resumed('v2.0.0'))).toBe(-1);
    // What DOES depend on the parent is what happens next. This harness's
    // parent is always the CURRENT tree's own ccrc — a W6 parent — whose
    // `_upd_tree_untouched` carries the `directory` row (D-3458): the move
    // back left ~/ccrc exactly as it was, the same real directory byte for
    // byte, so THIS run reads NOTHING REPLACED — exit 1, never gated, never
    // restored. A wave-4 parent has no such row: it would read the death as
    // moved (its `_upd_step_moved` default) and gate, then restore, this
    // exact on-disk shape — the defect D-3436 describes. This harness
    // cannot drive that parent to prove it (`runUpdate` always runs the
    // current tree's ccrc as the outer process); D-3458's plan entry
    // records the distinction instead.
    expect(r.stderr).toContain('nothing was replaced ($HOME/ccrc is still the pre-versioned directory; '
      + 'the migration did not leave it moved)');
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stdout, 'a death that replaced nothing was gated').not.toMatch(/^update: gate/m);
    expect(r.stdout, 'a death that replaced nothing was restored').not.toMatch(/^update: (arm|REVERTED)/m);
    const st = lstatSync(join(home, 'ccrc'));
    expect(!st.isSymbolicLink() && st.isDirectory(), 'the tree was not moved back to a real ~/ccrc').toBe(true);
    expect(existsSync(migrating(home))).toBe(false);
    expect(existsSync(join(home, '.ccrc', 'migrating-to'))).toBe(false);
    expect(existsSync(join(home, 'ccrc-versions', 'v2.0.0', 'ccd', 'ccrc'))).toBe(true);
  });

  it('a staged spine KILLED inside the window is completed by cmd_update itself, before its gate and its restore arms — so arm 3 writes through the link and never recreates a real ~/ccrc beside ~/ccrc.migrating (D-3433)', () => {
    const home = fullBox('ccrc-update-migrate-spine-window-');
    const r = runUpdate(home, [], armLn(home, 'fixture-ln-kill-once'));
    expect(existsSync(join(home, 'fixture-ln-kill-once')), 'the kill never fired').toBe(false);
    const resume = at(r.stdout, (l) => l === resumed('v2.0.0'));
    const gate = at(r.stdout, (l) => l.startsWith('update: gate'));
    expect(resume, r.stdout).toBeGreaterThan(-1);
    expect(gate, 'the gate ran before the link was completed').toBeGreaterThan(resume);
    // The tree died at or after _inst_tree and its stamp never moved, so the
    // gate fails honestly and the box restores (exit 4) — through the LINK.
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(lstatSync(join(home, 'ccrc')).isSymbolicLink(), 'a restore arm recreated a real ~/ccrc').toBe(true);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(join(home, 'ccrc-versions', 'v2.0.0'));
    expect(lstatSync(migrating(home)).isDirectory()).toBe(true);
  });

  itLinux('--detach on a crash pair completes the link BEFORE it queues, because the run it hands off execs the launcher shim, which cannot start with no ~/ccrc (D-3437)', () => {
    const home = freshUpdateBox('ccrc-update-migrate-detach-');
    crashedPair(home);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--detach', '--to', 'v2.0.0']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const resume = at(r.stdout, (l) => l === resumed('v1.0.0'));
    const detached = at(r.stdout, (l) => l.startsWith('update: detached — \'update --to v2.0.0\''));
    expect(resume, r.stdout).toBeGreaterThan(-1);
    expect(detached, 'the run was handed off before the link was completed').toBeGreaterThan(resume);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(join(home, 'ccrc-versions', 'v1.0.0'));
    // wave 4 Task 3's recorder: exactly the spec argv, handed to a box whose
    // launcher can now run.
    expect(readFileSync(join(home, 'systemd-run-argv'), 'utf8').split('\n').filter((l) => l !== '')).toEqual([
      '--user --collect --quiet /bin/sh -c PATH="$HOME/.local/bin:$PATH" exec "$HOME/.local/bin/ccrc" "$@" '
      + 'ccrc-detach update --to v2.0.0 --from cli',
    ]);
  });
});

// R20a (centralised-update wave 13): each test's fixture homes go in a root `afterEach`, not all at once in the
// file's `afterAll`. Measured at 9221416a: the three parts of this file leave 648 homes, about 99,700 entries and
// 2.47 GB to that one hook, which overran vitest's 20 s hook timeout on CI shards at 670d25fd and 7b0a5454. It sits
// at the END of the file so no line above moves: a top-level hook registers on the root suite wherever it is
// written, because vitest collects the whole file before it runs a test.
removeTmpFixturesEachTest();

