// Part of the `ccrc update` suite, split by describe block from the former single file (D-6767).
// The shared box, tarball and runner fixtures live in `ccrc-updateFixture.ts`; this file holds only
// the cases of its own describe blocks, with their titles and bodies unchanged. Its siblings are
// `ccrc-update-*.test.ts`.

import { describe, it, expect } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, lstatSync, chmodSync, readdirSync, appendFileSync, renameSync, rmSync, symlinkSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { assertNoRealTool } from './containedTools.js';
import { itLinux, itDarwin } from './platformFixtures.js';
import { installVersionedTree } from './installTreeFixture.js';
import { } from './codexLaneFixture.js';
import {
  REPO,
  REAL_NODE,
  BASH,
  allowCurlPort,
  curlFrontPassed,
  updateEnv,
  replantDoctorStubs,
  plantOldBox,
  plantCoordDb,
  plantCollectJournal,
  expectJournalUntouched,
  journalCopiesUnder,
  LEAVE_JOURNAL_LINE,
  plantCompletedRecord,
  writeManifest,
  shippedStamp,
  fullTree,
  stubTree,
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
  pathWithoutJq,
  reportWrites,
  lastReport,
  V1_SHA,
  V2_SHA,
  linkOf,
  plantW6Box,
  keptVersion,
  rollbackRun,
} from './ccrc-updateFixture.js';

describe('updateEnv: containment (wave 9 R10d)', () => {
  it('updateEnv hands out no env under which a real ssh, scp, systemctl, systemd-run, launchctl, tmux, gh or curl can run, and no real user bus (wave 9 R10d)', () => {
    const home = mkTmp('ccrc-update-contained-');
    expect(() => assertNoRealTool(updateEnv(home), home)).not.toThrow();
  });

  it('updateEnv is a SPINE builder: it hands `adoptPlantedSystemd` nothing to rename — no .codex-systemctl or .codex-systemd-run delegate (wave 9 R10d)', () => {
    // `managers: true` would plant poisons that `adoptPlantedSystemd` renames to `.codex-*` delegates the fronts forward
    // to: every `--detach` systemd-run would answer 97. The twin of ccrc-containment.test.ts's (g), at this builder.
    const home = mkTmp('ccrc-update-spine-');
    updateEnv(home);
    const bin = join(home, '.local', 'bin');
    for (const n of ['.codex-systemctl', '.codex-systemd-run']) expect(existsSync(join(bin, n)), n).toBe(false);
  });
});

describe('ccrc update: the argument surface', () => {
  it('update -h prints usage on STDOUT at exit 0 — a verb with flags explains them', () => {
    const home = freshUpdateBox('ccrc-update-help-');
    const r = runUpdate(home, ['-h']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/usage: ccrc \{/);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
  });

  it('an unknown argument is a usage error, exit 2, before anything is fetched', () => {
    const home = freshUpdateBox('ccrc-update-badarg-');
    const r = runUpdate(home, ['--bogus']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^ccrc: unknown argument: --bogus/m);
    expect(existsSync(join(home, 'curl-argv')), 'a fetch ran before the refusal').toBe(false);
  });

  it('--to refuses a value that is not vX.Y.Z-shaped, exit 2', () => {
    const home = freshUpdateBox('ccrc-update-badto-');
    const r = runUpdate(home, ['--to', 'latest']);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/--to expects a release tag shaped vX\.Y\.Z/);
    expect(existsSync(join(home, 'curl-argv'))).toBe(false);
  });
});

describe('ccrc update: preflight (D-3140 — jq joins the tool list)', () => {
  it('a jq-less box is refused by name, before anything is fetched', () => {
    const home = freshUpdateBox('ccrc-update-nojq-');
    const r = runUpdate(home, [], { PATH: pathWithoutJq(home) });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: jq is required by 'ccrc update' but is not on PATH — nothing on this box was changed/m);
    expect(existsSync(join(home, 'curl-argv')), 'a fetch ran before the refusal').toBe(false);
  });
});

describe('ccrc update: fetch + verify, then back up, then install, then report', () => {
  it('happy path: replaces ~/ccrc from the verified tree and reports both build.json versions', () => {
    const home = freshUpdateBox('ccrc-update-happy-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantCoordDb(home);
    packRelease(home, fullTree(home, {
      version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000',
    }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    // The health gate ran on the REAL spine's result (design §11): the
    // staged `_inst_env` wrote ccrc.env's address, `_inst_stamp` the version.
    expect(r.stdout).toMatch(/^update: gate: both answers on v2\.0\.0 \(ccrc\.service up, \/health at 127\.0\.0\.1:7788 answers v2\.0\.0\)$/m);
    // A verified bundle (packRelease's default) makes this a ONE-line marker
    // — provenance verified, no `unsigned` line 2 (D-3117, Task 12).
    expect(readFileSync(join(home, '.ccrc', 'installed'), 'utf8'))
      .toBe('newsha0000000000000000000000000000000000\n');
    expect(existsSync(join(home, '.ccrc', 'install-step')), 'a completed spine left its step marker').toBe(false);
    // The old tree is GONE and the staged one is in its place: the marker the
    // previous install left does not survive the rsync --delete, and the
    // shipped executables do arrive.
    expect(existsSync(join(home, 'ccrc', 'server', 'OLD-MARKER')),
      'the old tree survived under the new one').toBe(false);
    expect(existsSync(join(home, 'ccrc', 'ccd', 'ccrc-doctor-checks'))).toBe(true);
    // The box's stamp is now the SHIPPED one — the release artifact's own
    // identity, installed because an extracted tarball is not a repository
    // git could measure (build-release.sh writes it; _inst_stamp installs it).
    const stamp = JSON.parse(readFileSync(join(home, '.ccrc', 'build.json'), 'utf8')) as Record<string, unknown>;
    expect(stamp['version']).toBe('v2.0.0');
    expect(stamp['sha']).toBe('newsha0000000000000000000000000000000000');
    // The report names both versions, from → to.
    expect(r.stdout).toMatch(/^update: build: v1\.0\.0 \(oldsha[0-9a-f]*\) -> v2\.0\.0 \(newsha[0-9a-f]*\)$/m);
    // The backup was taken (its completeness is the ordering test's subject).
    const backup = announcedBackupDir(r.stdout, home);
    expect(existsSync(join(backup, 'coord.db'))).toBe(true);
  });

  // Fix round 1 item 12 / review 155 C22, AMENDED by fix round 2 F4 (review
  // 167): every release-host curl call this run makes, pinned by FLAG SET
  // through the stub's full-argv recorder (`curlFullArgv`, never the
  // url-only `curl-argv`). The tarball keeps its round-1 shape (connect
  // timeout AND a stall bound — `--speed-limit`/`--speed-time` — NEVER a
  // total `--max-time`: a slow but LIVE download must be let finish); the
  // bundle — a SMALL probe — keeps its connect timeout AND total bound.
  // SHA256SUMS, round 1's OTHER small-file fetch, no longer matches the
  // tarball's class: it is SMALL BY DESIGN (`_upd_resolve`'s own derivation
  // comment), so it now ALSO carries a total `--max-time` and a
  // `--max-filesize`, on top of the connect+stall pair it always had.
  it('SHA256SUMS gets connect+stall+total+filesize bounds; the tarball keeps connect+stall only; the bundle keeps connect+total (fix round 1 item 12 / review 155 C22; fix round 2 F4, review 167)', () => {
    const home = freshUpdateBox('ccrc-update-timeouts-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantCoordDb(home);
    packRelease(home, fullTree(home, {
      version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000',
    }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    const argvUrl = (line: string): string => line.trim().split(/\s+/).pop() ?? '';
    const argv = curlFullArgv(home);
    const sums = argv.find((l) => argvUrl(l).endsWith('/SHA256SUMS'));
    const tarball = argv.find((l) => argvUrl(l).endsWith('.tar.gz'));
    const bundle = argv.find((l) => argvUrl(l).endsWith('.sigstore.json'));
    expect(sums, argv.join('\n')).toBeDefined();
    expect(tarball, argv.join('\n')).toBeDefined();
    expect(bundle, argv.join('\n')).toBeDefined();
    expect(sums!).toMatch(/--connect-timeout \d+/);
    expect(sums!).toMatch(/--speed-limit \d+/);
    expect(sums!).toMatch(/--speed-time \d+/);
    expect(sums!).toMatch(/--max-time \d+/);
    expect(sums!).toMatch(/--max-filesize \d+/);
    expect(tarball!).toMatch(/--connect-timeout \d+/);
    expect(tarball!).toMatch(/--speed-limit \d+/);
    expect(tarball!).toMatch(/--speed-time \d+/);
    expect(tarball!).not.toMatch(/--max-time/);
    expect(tarball!).not.toMatch(/--max-filesize/);
    expect(bundle!).toMatch(/--connect-timeout \d+/);
    expect(bundle!).toMatch(/--max-time \d+/);
    expect(bundle!).not.toMatch(/--speed-limit|--speed-time/);
    expect(bundle!).not.toMatch(/--max-filesize/);
  });

  // Fix round 2, F4 (review 167), CORRECTED by W6 Task 8A (review 173's F4b):
  // a release host that ACCEPTS the TCP connection and then TRICKLES bytes
  // forever. The first version of this pin trickled at 10 B/s — BELOW the
  // 1024 B/s stall floor — so the stall bound (or the test's own kill) could
  // end it and F4's real input, a host that never stops but never stalls, was
  // never exercised. This one sends 256 bytes every 100 ms (2560 B/s, above the
  // floor, so no stall can end it), with the size bound lifted to the
  // validator's ceiling (2 s of 2560 B/s is ~5 KB, well under it) and the stall
  // window shortened to 1 s (so a trickle below the floor WOULD have ended
  // early): only SHA256SUMS's total `--max-time` is left to end the transfer,
  // and the assertions below measure that it did, at its own bound and not
  // before. A real `net.createServer`, NEVER a stubbed curl (modelled on the
  // never-answering-socket pin for `_upd_asset_listed`, fix round 1 item 12 /
  // review 155 C32, below) — `updateEnv` alone (whose curl is, since wave 9
  // D-3819, the LOOPBACK FRONT: it execs the REAL curl only for the one port
  // this case lists in `$HOME/curl-allow-ports`, and the case asserts the front
  // passed its URL), like that pin, NEVER
  // `runUpdate`/`freshUpdateBox`'s own `replantDoctorStubs`, which would shadow
  // the real curl with the LOCAL-URL-only fixture shim (it never writes `-o`'s
  // destination file for a bare `http://` URL, so a run through it "fails" for
  // a fixture reason having nothing to do with the bound this pins).
  // THE HOST IS A SEPARATE PROCESS, and that is not incidental: these pins run
  // the real `ccrc` through `spawnSync`, which BLOCKS this process's event
  // loop for as long as the child lives — an in-process `net.createServer`
  // would accept the connection in the kernel and never get to write a byte.
  // That is what the first version of the F4 trickle pin actually was: an
  // accept-and-never-answer host, whatever its handler said (measured under
  // W6 Task 8A: the handler never ran, and curl ended on its stall bound).
  // The host child answers HTTP/1.0 with NO Content-Length and writes
  // `bytes` every `everyMs` until it is told to stop, then prints how much it
  // sent, so a test can assert the rate the host really held.
  const HOST_JS = [
    "const { createServer } = require('node:net');",
    "const [bytes, everyMs] = [Number(process.argv[1]), Number(process.argv[2])];",
    "let sent = 0; const chunk = 'a'.repeat(bytes);",
    "const s = createServer((sock) => {",
    "  sock.write('HTTP/1.0 200 OK\\r\\nContent-Type: text/plain\\r\\n\\r\\n');",
    "  const iv = setInterval(() => { try { sock.write(chunk); sent += bytes; } catch (e) {} }, everyMs);",
    "  sock.on('close', () => clearInterval(iv)); sock.on('error', () => clearInterval(iv));",
    "});",
    "s.listen(0, '127.0.0.1', () => process.stdout.write(String(s.address().port) + '\\n'));",
    "process.on('SIGTERM', () => { process.stdout.write('sent ' + sent + '\\n'); process.exit(0); });",
  ].join('\n');
  const startHost = async (bytes: number, everyMs: number): Promise<{ port: number; stop: () => Promise<number> }> => {
    const child = spawn(process.execPath, ['-e', HOST_JS, String(bytes), String(everyMs)], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout!.on('data', (d: Buffer) => { out += d.toString(); });
    // `close`, not `exit`: the host prints its count as it exits, and `exit` can fire before that last chunk is
    // read, which reads as "sent 0".
    const closed = new Promise<void>((resolve) => { child.once('close', () => resolve()); });
    const port = await new Promise<number>((resolve, reject) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        const m = /^(\d+)\n/.exec(out);
        if (m) { clearInterval(iv); resolve(Number(m[1])); }
        else if (Date.now() - t0 > 10_000) { clearInterval(iv); reject(new Error('the fixture host never listened')); }
      }, 20);
    });
    const stop = async (): Promise<number> => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await closed;
      const m = /sent (\d+)/.exec(out);
      return m ? Number(m[1]) : 0;
    };
    return { port, stop };
  };

  itLinux('SHA256SUMS from a release host that trickles above the stall floor forever is ended by its total bound alone, named in the sentence (F4, review 167; F4b, review 173)', async () => {
    // 256 bytes every 100 ms = 2560 B/s: above the 1024 B/s floor, so no
    // stall can end it; the size bound is lifted to the validator's ceiling
    // (2 s of 2560 B/s is ~5 KB, far under it); the stall WINDOW is shortened
    // to 1 s so a trickle below the floor would have ended early. Only the
    // total `--max-time` is left, and the assertions measure that it fired,
    // at its own bound and not before.
    const host = await startHost(256, 100);
    let sent = 0;
    try {
      const home = mkTmp('ccrc-update-sums-trickle-');
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      const env = {
        ...updateEnv(home),
        CCRC_RELEASE_BASE_URL: `http://127.0.0.1:${host.port}/rel`,
        CCRC_RELEASE_SUMS_MAX_TIME: '2',
        CCRC_RELEASE_SUMS_MAX_FILESIZE: '1048576',
        CCRC_RELEASE_SPEED_TIME: '1',
        CCRC_RELEASE_CONNECT_TIMEOUT: '2',
      };
      allowCurlPort(home, host.port);
      const t0 = Date.now();
      const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'update'],
        { env, encoding: 'utf8', timeout: 20_000 });
      const elapsedMs = Date.now() - t0;
      sent = await host.stop();
      expect(curlFrontPassed(home), 'the real curl was reached through the loopback front').toContain(`http://127.0.0.1:${host.port}/`);
      expect(r.status, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
      // Ended by the OVERRIDDEN total bound (2 s): not before it (a stall or a
      // size bound would have ended it sooner), and not left trickling to
      // curl's own defaults or to this test's own kill.
      expect(elapsedMs, `took ${elapsedMs}ms; stderr: ${r.stderr}`).toBeGreaterThanOrEqual(1800);
      expect(elapsedMs, `took ${elapsedMs}ms`).toBeLessThan(10_000);
      // The host really was above the floor the whole time.
      expect(sent / (elapsedMs / 1000), `sent ${sent} bytes in ${elapsedMs}ms; stderr: ${r.stderr}`).toBeGreaterThan(1500);
      expect(r.stderr).toMatch(/curl: \(28\) Operation timed out after 2\d{3} milliseconds/);
      expect(r.stderr).toMatch(/download failed: .*\/SHA256SUMS \(is there a release, or did the connection stall.*or did it time out after 2s \/ exceed 1048576 bytes\)/);
    } finally {
      await host.stop();
    }
  }, 30_000);

  // W6 Task 8A (review 173's F4b): the SIZE bound, measured. Until now it had
  // only the argv regex in the flag-set pin above, so a default raised to
  // 1048576 would have stayed green. A host that answers a close-delimited
  // body (HTTP/1.0, NO Content-Length — the case curl cannot judge from the
  // headers) and keeps sending fast is ended by `--max-filesize` alone, well
  // inside the total bound, which is set high here so it cannot be what fires:
  // the fetch must refuse in a couple of seconds, naming the SHIPPED size bound.
  // FLOOR: curl 8.4.0. Below it curl ignores `--max-filesize` for a body of
  // unknown length (its manual says so), and only the time bound holds — so
  // this case is skipped there, not weakened.
  const curlV = /curl (\d+)\.(\d+)\.(\d+)/.exec(spawnSync('curl', ['--version'], { encoding: 'utf8' }).stdout ?? '');
  const curlHasUnknownLengthMaxFilesize = curlV !== null
    && (Number(curlV[1]) > 8 || (Number(curlV[1]) === 8 && Number(curlV[2]) >= 4));
  it.skipIf(process.platform === 'darwin' || !curlHasUnknownLengthMaxFilesize)('SHA256SUMS whose body has no Content-Length and never stops is refused at --max-filesize, the shipped 4096 bytes named in the sentence (F4b, review 173)', async () => {
    // 1 KiB every 10 ms = ~100 KB/s: the shipped 4096 bytes arrive in well
    // under a second, while a bound raised to a megabyte would run for ~10 s.
    const host = await startHost(1024, 10);
    try {
      const home = mkTmp('ccrc-update-sums-oversize-');
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      const env: NodeJS.ProcessEnv = {
        ...updateEnv(home),
        CCRC_RELEASE_BASE_URL: `http://127.0.0.1:${host.port}/rel`,
        CCRC_RELEASE_SUMS_MAX_TIME: '30',
        CCRC_RELEASE_CONNECT_TIMEOUT: '2',
      };
      delete env['CCRC_RELEASE_SUMS_MAX_FILESIZE'];
      allowCurlPort(home, host.port);
      const t0 = Date.now();
      const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccrc'), 'update'],
        { env, encoding: 'utf8', timeout: 25_000 });
      const elapsedMs = Date.now() - t0;
      expect(curlFrontPassed(home), 'the real curl was reached through the loopback front').toContain(`http://127.0.0.1:${host.port}/`);
      expect(r.status, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
      // Ended by the size bound: curl 63, quickly — and the 30 s total bound
      // (set high on purpose) is nowhere near.
      expect(r.stderr).toMatch(/curl: \(63\)/);
      expect(elapsedMs, `took ${elapsedMs}ms`).toBeLessThan(5_000);
      expect(r.stderr).toMatch(/download failed: .*\/SHA256SUMS \(.*or did it time out after 30s \/ exceed 4096 bytes\)/);
    } finally {
      await host.stop();
    }
  }, 40_000);

  it('happy path on a VERSIONED box (W6 Task 2): v2.0.0 is placed in ~/ccrc-versions/v2.0.0, ~/ccrc flips to it, and v1.0.0\'s directory is byte-unchanged', () => {
    // The staged spine is the real one (FULL flavour), so this is the
    // install path `ccrc update` really takes on a box that is already on the
    // W6 layout: the staged tree names itself from its shipped build.json
    // (`_inst_version_name` rule 3), is placed beside the running version,
    // and the link is renamed only after its deps are in place.
    const home = freshUpdateBox('ccrc-update-versioned-');
    plantOldBox(home, { version: 'v1.0.0' });
    rmSync(join(home, 'ccrc'), { recursive: true, force: true });
    installVersionedTree(home, 'v1.0.0', { stamp: { sha: '1'.repeat(40), version: 'v1.0.0' } });
    plantCoordDb(home);
    packRelease(home, fullTree(home, {
      version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000',
    }), { tag: 'v2.0.0' });
    const before = treeDigest(join(home, 'ccrc-versions', 'v1.0.0'));
    const r = runUpdate(home);
    // FIRST, before the exit code: a run that wrote into the running version
    // (the rsync's destination naming `~/ccrc` instead of the new version
    // directory) dies later, at its own exit code, and this is the assertion
    // that must name the defect (review 179 item 15).
    expect(treeDigest(join(home, 'ccrc-versions', 'v1.0.0')),
      'the update wrote into the version it was replacing').toEqual(before);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(lstatSync(join(home, 'ccrc')).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(join(home, 'ccrc-versions', 'v2.0.0'));
    expect(r.stdout).toMatch(/^install: tree: placed v2\.0\.0 at \$HOME\/ccrc-versions\/v2\.0\.0$/m);
    expect(r.stdout).toMatch(/^install: tree: \$HOME\/ccrc -> \$HOME\/ccrc-versions\/v2\.0\.0 \(was \$HOME\/ccrc-versions\/v1\.0\.0\) — one rename$/m);
    expect(readFileSync(join(home, 'npm-cwd'), 'utf8').trim().split('\n')[0])
      .toBe(join(home, 'ccrc-versions', 'v2.0.0', 'server'));
    // The new version keeps the stamp and record this update left on the box.
    expect(readFileSync(join(home, 'ccrc-versions', 'v2.0.0', '.ccrc-installed'), 'utf8'))
      .toBe(readFileSync(join(home, '.ccrc', 'installed'), 'utf8'));
    expect(readFileSync(join(home, 'ccrc-versions', 'v2.0.0', '.ccrc-stamp.json'), 'utf8'))
      .toBe(readFileSync(join(home, '.ccrc', 'build.json'), 'utf8'));
  });

  it('a VERSIONED box whose staged npm ci fails replaced nothing: exit 1 BEFORE the gate, no restore, and v1.0.0 — the running version — byte-unchanged (D-3457)', () => {
    // The commonest failure — the registry is down — kills the W6 spine
    // inside `_inst_tree` (marker `_inst_tree`), after the rsync into
    // ~/ccrc-versions/v2.0.0 and BEFORE the flip. Wave 4 alone reads that
    // marker as "the tree WAS replaced", gates a unit still on v1.0.0, fails,
    // and its arm-2 child re-installs v1.0.0 IN PLACE: rsync --delete and
    // npm ci inside the running version.
    const home = freshUpdateBox('ccrc-update-versioned-npmfail-');
    plantOldBox(home, { version: 'v1.0.0' });
    rmSync(join(home, 'ccrc'), { recursive: true, force: true });
    installVersionedTree(home, 'v1.0.0', { stamp: { sha: '1'.repeat(40), version: 'v1.0.0' } });
    plantCoordDb(home);
    const planted = plantCompletedRecord(home);
    packRelease(home, fullTree(home, {
      version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000',
    }), { tag: 'v2.0.0' });
    const before = treeDigest(join(home, 'ccrc-versions', 'v1.0.0'));
    // Ahead of the recorder npm that `runUpdate` re-plants on every call
    // (the `a spine that DIED …` case's idiom).
    mkdirSync(join(home, 'fail-bin'), { recursive: true });
    writeFileSync(join(home, 'fail-bin', 'npm'),
      '#!/bin/sh\necho "npm ERR! code ENOTFOUND registry.npmjs.org" >&2\nexit 1\n', { mode: 0o755 });
    const r = runUpdate(home, [], { PATH: `${join(home, 'fail-bin')}:${updateEnv(home)['PATH'] ?? ''}` });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: the staged install \(which ends with doctor\) exited 1 — spine died at _inst_tree, before its flip: nothing was replaced \(\$HOME\/ccrc still points at \$HOME\/ccrc-versions\/v1\.0\.0\); put back as they were: completed-install record, caps; read its lines above\. The backup taken BEFORE it ran is complete at \S+\/ccrc-backups\/\S+$/m);
    expect(readFileSync(join(home, '.ccrc', 'install-step'), 'utf8')).toBe('_inst_tree\n');
    expect(r.stdout, 'a death that replaced nothing was gated').not.toMatch(/^update: gate/m);
    expect(r.stdout, 'a death that replaced nothing was restored').not.toMatch(/^update: (arm|REVERTED)/m);
    const phases = reportWrites(home).map((w) => w['phase']);
    expect(phases, 'the report went through the gate').not.toContain('checking');
    expect(phases, 'the report went through a restore').not.toContain('restoring');
    expect(lastReport(home)).toMatchObject({ phase: 'failed', detail: 'spine died at _inst_tree', target: 'v2.0.0' });
    expect(readlinkSync(join(home, 'ccrc'))).toBe(join(home, 'ccrc-versions', 'v1.0.0'));
    expect(treeDigest(join(home, 'ccrc-versions', 'v1.0.0')),
      'the running version was written into').toEqual(before);
    // D-3462: the run cleared the record and the caps before its spine, and a
    // death that replaced nothing puts both back as they were.
    expect(readFileSync(join(home, '.ccrc', 'installed'), 'utf8'), 'the completed-install record was left removed')
      .toBe(planted.installed);
    expect(readFileSync(join(home, '.ccrc', 'ccrc-caps'), 'utf8'), 'the caps were left removed').toBe(planted.caps);
  });

  it('an update to a version name that is a SYMLINK is refused by the spine before any write: exit 1 as nothing replaced, the link target and the running version byte-unchanged (D-3464)', () => {
    const home = freshUpdateBox('ccrc-update-linked-name-');
    plantOldBox(home, { version: 'v1.0.0' });
    rmSync(join(home, 'ccrc'), { recursive: true, force: true });
    installVersionedTree(home, 'v1.0.0', { stamp: { sha: '1'.repeat(40), version: 'v1.0.0' } });
    plantCoordDb(home);
    const elsewhere = join(home, 'elsewhere-4');
    mkdirSync(join(elsewhere, 'server'), { recursive: true });
    writeFileSync(join(elsewhere, 'server', 'MINE'), 'not ccrc\n');
    writeFileSync(join(elsewhere, '.ccrc-installed'), 'b'.repeat(40) + '\n');
    symlinkSync(elsewhere, join(home, 'ccrc-versions', 'v2.0.0'));
    packRelease(home, fullTree(home, {
      version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000',
    }), { tag: 'v2.0.0' });
    const target = treeDigest(elsewhere);
    const running = treeDigest(join(home, 'ccrc-versions', 'v1.0.0'));
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toContain('$HOME/ccrc-versions/v2.0.0 is not a directory ccrc placed — nothing was written');
    expect(r.stderr).toContain('spine died at _inst_tree, before its flip: nothing was replaced');
    expect(treeDigest(elsewhere), 'the link target was written through').toEqual(target);
    expect(treeDigest(join(home, 'ccrc-versions', 'v1.0.0'))).toEqual(running);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(join(home, 'ccrc-versions', 'v1.0.0'));
  });

  it('a REAL-DIRECTORY (pre-W6) box whose staged npm ci fails replaced nothing either: exit 1 BEFORE the gate, no restore, and the directory byte-unchanged (D-3458)', () => {
    // The controller's ruling on the pre-flight scan: Task 2 left
    // `_upd_tree_untouched`'s `directory` row "Task 3's to revisit" and
    // Task 3 never did. Since W6, a `directory` layout is placed exactly
    // like `absent` — the new version is placed FULLY at
    // ~/ccrc-versions/<name> before `_inst_migrate` ever moves the real
    // directory — so an `npm ci` failure here dies before a single byte of
    // ~/ccrc has moved, exactly like the VERSIONED case above.
    const home = freshUpdateBox('ccrc-update-directory-npmfail-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantCoordDb(home);
    const planted = plantCompletedRecord(home);
    packRelease(home, fullTree(home, {
      version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000',
    }), { tag: 'v2.0.0' });
    const before = treeDigest(join(home, 'ccrc'));
    mkdirSync(join(home, 'fail-bin'), { recursive: true });
    writeFileSync(join(home, 'fail-bin', 'npm'),
      '#!/bin/sh\necho "npm ERR! code ENOTFOUND registry.npmjs.org" >&2\nexit 1\n', { mode: 0o755 });
    const r = runUpdate(home, [], { PATH: `${join(home, 'fail-bin')}:${updateEnv(home)['PATH'] ?? ''}` });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toContain('spine died at _inst_tree, before its flip: nothing was replaced '
      + '($HOME/ccrc is still the pre-versioned directory; the migration did not leave it moved); '
      + 'put back as they were: completed-install record, caps; read its lines above.');
    // D-3462: the record and the caps the run cleared before its spine are back, byte for byte.
    expect(readFileSync(join(home, '.ccrc', 'installed'), 'utf8')).toBe(planted.installed);
    expect(readFileSync(join(home, '.ccrc', 'ccrc-caps'), 'utf8')).toBe(planted.caps);
    expect(readFileSync(join(home, '.ccrc', 'install-step'), 'utf8')).toBe('_inst_tree\n');
    expect(r.stdout, 'a death that replaced nothing was gated').not.toMatch(/^update: gate/m);
    expect(r.stdout, 'a death that replaced nothing was restored').not.toMatch(/^update: (arm|REVERTED)/m);
    const phases = reportWrites(home).map((w) => w['phase']);
    expect(phases, 'the report went through the gate').not.toContain('checking');
    expect(phases, 'the report went through a restore').not.toContain('restoring');
    expect(lastReport(home)).toMatchObject({ phase: 'failed', detail: 'spine died at _inst_tree', target: 'v2.0.0' });
    const st = lstatSync(join(home, 'ccrc'));
    expect(!st.isSymbolicLink() && st.isDirectory(), '~/ccrc was migrated away').toBe(true);
    expect(treeDigest(join(home, 'ccrc')), 'the real directory was written into').toEqual(before);
    expect(existsSync(join(home, 'ccrc.migrating')), 'a migration was started').toBe(false);
    expect(existsSync(join(home, '.ccrc', 'migrating-to'))).toBe(false);
  });

  it('_upd_tree_untouched (VERSIONED layouts): nothing replaced only for a W6 spine, a new name, and a layout that still reads what it read before', () => {
    const home = freshUpdateBox('ccrc-update-untouched-');
    installVersionedTree(home, 'v1.0.0');
    // Two staged trees: one whose ccrc declares the versions root (a W6
    // spine) and one whose ccrc does not (a spine older than W6).
    mkdirSync(join(home, 'stage-w6', 'ccd'), { recursive: true });
    writeFileSync(join(home, 'stage-w6', 'ccd', 'ccrc'), 'BOX_VERSIONS_ROOT="$HOME/ccrc-versions"\n');
    mkdirSync(join(home, 'stage-old', 'ccd'), { recursive: true });
    writeFileSync(join(home, 'stage-old', 'ccd', 'ccrc'), 'BOX_TREE_DIR="$HOME/ccrc"\n');
    const ask = (h: string, tree: string, version: string, pl: string, pc: string): string =>
      sourcedCcrc(h, `UPD_TREE='${join(home, tree)}'; UPD_VERSION='${version}'; `
        + `_upd_tree_untouched '${pl}' '${pc}'; echo "rc=$?"`).stdout.trim();
    // A W6 spine, a new name, the link where it was: nothing replaced.
    expect(ask(home, 'stage-w6', 'v2.0.0', 'linked', 'v1.0.0'))
      .toBe('$HOME/ccrc still points at $HOME/ccrc-versions/v1.0.0\nrc=0');
    // The same name: the in-place reinstall wrote INTO the running version (M17).
    expect(ask(home, 'stage-w6', 'v1.0.0', 'linked', 'v1.0.0')).toBe('rc=1');
    // A spine older than W6 writes THROUGH ~/ccrc (M16).
    expect(ask(home, 'stage-old', 'v2.0.0', 'linked', 'v1.0.0')).toBe('rc=1');
    // The link points somewhere else than it did before the spine (M18).
    expect(ask(home, 'stage-w6', 'v2.0.0', 'linked', 'v0.9.0')).toBe('rc=1');
    // Was foreign, reads linked now: not the same word.
    expect(ask(home, 'stage-w6', 'v2.0.0', 'foreign', '')).toBe('rc=1');

    // A FOREIGN ~/ccrc still foreign: `_inst_tree` refused it before a byte.
    const alien = freshUpdateBox('ccrc-update-untouched-foreign-');
    mkdirSync(join(alien, 'elsewhere'));
    symlinkSync(join(alien, 'elsewhere'), join(alien, 'ccrc'));
    expect(ask(alien, 'stage-w6', 'v2.0.0', 'foreign', ''))
      .toBe('$HOME/ccrc is still a link whose target is not a version directory under $HOME/ccrc-versions, which the spine refused to place over\nrc=0');
    expect(ask(alien, 'stage-old', 'v2.0.0', 'foreign', '')).toBe('rc=1');

    // W6 Task 3 (D-3458): a `directory` layout that still reads `directory`
    // — no `~/ccrc.migrating`, no link — proves the real directory was
    // never touched: every write before `_inst_migrate`'s move lands in
    // `~/ccrc-versions/<name>`, never in `~/ccrc` itself. `_ver_layout`
    // never reads `~/.ccrc/migrating-to`, so a marker left over from a
    // failed aside-move would not change this reading either.
    const dir = freshUpdateBox('ccrc-update-untouched-dir-');
    mkdirSync(join(dir, 'ccrc', 'server'), { recursive: true });
    expect(ask(dir, 'stage-w6', 'v2.0.0', 'directory', ''))
      .toBe('$HOME/ccrc is still the pre-versioned directory; the migration did not leave it moved\nrc=0');
    // A spine older than W6 still writes THROUGH ~/ccrc even on a directory
    // layout (no BOX_VERSIONS_ROOT line at all).
    expect(ask(dir, 'stage-old', 'v2.0.0', 'directory', '')).toBe('rc=1');
    // The layout moved on since the pre-measurement: a migration completed
    // (a real link beside a real ~/ccrc.migrating is `migrated`), so the
    // real directory was NOT left untouched.
    const migrated = freshUpdateBox('ccrc-update-untouched-dir-migrated-');
    installVersionedTree(migrated, 'v9.9.9');
    mkdirSync(join(migrated, 'ccrc.migrating'), { recursive: true });
    expect(ask(migrated, 'stage-w6', 'v2.0.0', 'directory', '')).toBe('rc=1');
  });

  it('a spine that COMPLETED under a failing doctor exits 3, not 1: the record is written, the report prints, and the line says the box IS on the new build (D-3114)', () => {
    // Measured 2026-09-20 on the live server box: record written, box on the
    // new build, four pre-existing doctor FAILs, `ccrc update` exit 1 — and
    // rollout read that 1 as "did not move". The record is written LAST by
    // the spine, so its presence after a non-zero staged install means the
    // spine ran to its end and the trailing doctor is what said 1.
    const home = freshUpdateBox('ccrc-update-doctor-failed-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantCoordDb(home);
    rmSync(join(home, '.gitconfig'));   // the box's own health: git_email FAILs, the spine does not
    packRelease(home, fullTree(home, {
      version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000',
    }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(3);
    // The health gate ran on the REAL spine's result (design §11): the
    // staged `_inst_env` wrote ccrc.env's address, `_inst_stamp` the version.
    expect(r.stdout).toMatch(/^update: gate: both answers on v2\.0\.0 \(ccrc\.service up, \/health at 127\.0\.0\.1:7788 answers v2\.0\.0\)$/m);
    expect(r.stdout).toMatch(/^FAIL git_email: /m);
    expect(r.stdout).toMatch(/^update: the staged install completed \(the record is written\) but its trailing doctor exited 1 — this box IS on v2\.0\.0; the FAIL lines above are the box's health, not the update's/m);
    // Line 2 (design 2026-09-20 §5, D-3117): a verified bundle (packRelease's
    // default) makes `cmd_update` assert CCRC_UPDATE_VERIFIED=1 for this
    // spine, so the marker is ONE line — verified, not `unsigned` (Task 12).
    expect(readFileSync(join(home, '.ccrc', 'installed'), 'utf8')).toBe('newsha0000000000000000000000000000000000\n');
    expect(existsSync(join(home, '.ccrc', 'install-step')), 'a completed spine left its step marker').toBe(false);
    expect(r.stdout).toMatch(/^update: build: v1\.0\.0 \(oldsha[0-9a-f]*\) -> v2\.0\.0 \(newsha[0-9a-f]*\)$/m);
    expect(r.stderr).not.toMatch(/the staged install \(which ends with doctor\) exited/);
    expect(r.stdout).not.toMatch(/died inside _inst_installed/);
    // Task 1 (design §10): the report's last word is `done` — the box MOVED
    // — and its detail says whose the FAIL lines are. Exit 3 is unchanged.
    // The em dash in the shipped sentence reaches the report as `-`
    // (`_upd_json_str` spells the file's three non-ASCII characters in ASCII
    // before its printable-ASCII filter).
    const rep = JSON.parse(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')) as Record<string, unknown>;
    expect(rep['phase']).toBe('done');
    expect(rep['target']).toBe('v2.0.0');
    expect(rep['detail']).toBe('doctor exited 1 - the box moved; its health is ccrc doctor\'s');
  });

  it('a floor write that fails inside _inst_installed is named as that, not as doctor: the box IS on the new build, its floor not raised, exit 3 (M1)', () => {
    // W1 minor M1. `_inst_installed` places the completed-install record and
    // THEN raises the floor; a floor write that fails dies there — after the
    // record, before the trailing doctor ever ran — and the record's
    // presence alone read that death as "its trailing doctor exited 1".
    // Task 4's step marker tells the two apart: `_inst_installed` removes it
    // only on its completed returns, so a death inside its floor block
    // leaves it naming `_inst_installed`.
    const home = freshUpdateBox('ccrc-update-floor-write-dies-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantCoordDb(home);
    packRelease(home, fullTree(home, {
      version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000',
    }), { tag: 'v2.0.0' });
    // Task 4's knob in the harness's recording `mv`: it refuses exactly the
    // one move that places ~/.ccrc/floor (`_inst_floor`'s `mv -f -- "$ftmp"
    // "$BOX_FLOOR_FILE"`) and execs the real mv for every other — the record,
    // the step marker, update.json — so the spine runs to that line and no
    // further.
    writeFileSync(join(home, 'fixture-mv-fail'), '/.ccrc/floor\n');
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(3);
    expect(r.stderr).toMatch(/writing \S+\/\.ccrc\/floor failed/);
    // Task 5's gate ran on the new build and passed — exit 3, not 4, is
    // that pass (a failed gate here would be Task 6's restore).
    expect(r.stdout).toMatch(/^update: gate: both answers on v2\.0\.0 /m);
    expect(r.stdout).toMatch(/^update: the staged install placed its completed-install record, then died inside _inst_installed \(writing ~\/\.ccrc\/floor — read its line above\); this box IS on v2\.0\.0 and its floor was not raised$/m);
    expect(r.stdout).not.toMatch(/trailing doctor exited/);
    expect(readFileSync(join(home, '.ccrc', 'installed'), 'utf8')).toBe('newsha0000000000000000000000000000000000\n');
    expect(existsSync(join(home, '.ccrc', 'floor'))).toBe(false);
    expect(readFileSync(join(home, '.ccrc', 'install-step'), 'utf8')).toBe('_inst_installed\n');
    // Task 1's report: the console reads the same cause, not doctor's.
    const rep = JSON.parse(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')) as Record<string, unknown>;
    expect(rep['phase']).toBe('done');
    expect(rep['detail']).toBe('the floor write died inside _inst_installed - the box moved; its floor was not raised');
  });

  it('a spine that DIED after _inst_tree moved the tree (at _inst_bins) is gated, fails the gate on the OLD build, and exits 4 with the backup named — and leaves NO completed-install record (D-3114, design §11)', () => {
    // W6 Task 3 (D-3458): `plantOldBox` is a real-directory box, and since W6
    // that layout is placed exactly like `absent` — the version is placed
    // FULLY, deps included, before `_inst_migrate` ever moves the real
    // directory. An `npm ci` failure (this case's original lever) therefore
    // dies BEFORE the migration and leaves `~/ccrc` untouched — the shape
    // `_upd_tree_untouched`'s `directory` row now reads as "nothing was
    // replaced" (its own describe, below), not this case's "after the tree
    // moved". So the death is moved one step later, to `_inst_bins` — the
    // step right after `_inst_tree`, reached only once the migration has
    // already linked `~/ccrc` — with the harness's recording `mv` refusing
    // one destination `_inst_atomic` renames onto: `~/.local/bin/ccd-account-auth`,
    // placed on every role and both arms. (It named `~/.local/bin/ccd` until
    // D-3696: ccd's pair is published by its own helper's `os.replace`, which
    // no `mv` stub sees — so the lever moved to the next `_inst_atomic`.)
    const home = freshUpdateBox('ccrc-update-died-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantCoordDb(home);
    writeFileSync(join(home, '.ccrc', 'installed'), 'oldsha0000000000000000000000000000000000\n');
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000' }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-mv-fail'), '/.local/bin/ccd-account-auth\n');
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(4);
    expect(r.stdout).toMatch(/^update: gate FAILED after \d+s — /m);
    // Task 6: its v1.0.0 is unpublished, so arm 2 refuses and arm 3 runs —
    // and arm 3 removes ~/.ccrc/installed rather than restoring it, so the
    // no-record line holds.
    expect(r.stdout).toMatch(/^update: arm2-refused: v1\.0\.0 ships no bundle — /m);
    expect(r.stdout).toMatch(/^update: REVERTED \(arm 3\): /m);
    expect(r.stderr).toMatch(/update: v2\.0\.0 was installed, but the box did not come back healthy on it \(.*\) — exit 4\. The backup taken BEFORE the install is complete at/);
    // The tree DID move this time — the migration linked ~/ccrc before the
    // death at the very next step.
    expect(readFileSync(join(home, '.ccrc', 'install-step'), 'utf8')).toBe('_inst_bins\n');
    expect(existsSync(join(home, '.ccrc', 'installed')), 'a died spine must leave no record — not even the old build\'s').toBe(false);
    expect(r.stdout).not.toMatch(/^update: build: /m);
  });

  // D-3147: `~/.ccrc/ccrc-caps` is written only by `_inst_caps` and removed
  // only by uninstall; `cmd_update` clears `~/.ccrc/installed` before the
  // staged spine but must clear caps too — otherwise a staged spine that
  // never reaches `_inst_caps` (a pre-W1 rollback spine, or one that dies
  // before that step) leaves a stale `verify` cap sitting beside a fresh
  // one-line marker, which spec §6 reads as `provenance: verified` for an
  // install nobody verified. `stubTree`'s staged `ccd/ccrc` is exactly such
  // a spine — it exits 0 without ever writing caps.
  it('caps are cleared beside the marker before the staged spine runs, so a staged tree that never writes caps leaves none stale (D-3147)', () => {
    const home = freshUpdateBox('ccrc-update-caps-cleared-');
    plantOldBox(home, { version: 'v1.0.0' });
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'ccrc-caps'), 'os linux\nverify\nnode-id\nfloor\n');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(existsSync(join(home, '.ccrc', 'ccrc-caps')),
      'a caps file the staged spine never wrote must not survive the update').toBe(false);
  });

  it('checksum mismatch: refuses loudly and changes NOTHING — no backup, no install, ~/ccrc byte-identical', () => {
    const home = freshUpdateBox('ccrc-update-tamper-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', tamper: true });
    const before = treeDigest(join(home, 'ccrc'));
    const stampBefore = readFileSync(join(home, '.ccrc', 'build.json'), 'utf8');
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/checksum verification FAILED/);
    expect(treeDigest(join(home, 'ccrc'))).toEqual(before);
    expect(readFileSync(join(home, '.ccrc', 'build.json'), 'utf8')).toBe(stampBefore);
    expect(existsSync(join(home, 'ccrc-backups')), 'a backup ran for a refused artifact').toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv')), 'the staged install ran despite a bad checksum').toBe(false);
  });

  it('MANIFEST mismatch after an honest outer checksum: refuses, changes nothing', () => {
    // The outer checksum guards TRANSPORT; the MANIFEST guards the SET. A file
    // corrupted after the MANIFEST was generated ships in a tarball whose
    // SHA256SUMS is perfectly honest — only the per-file verify can catch it.
    const home = freshUpdateBox('ccrc-update-manifest-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }),
      { tag: 'v2.0.0', corruptInner: 'MARKER' });
    const before = treeDigest(join(home, 'ccrc'));
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/MANIFEST verification FAILED/);
    expect(treeDigest(join(home, 'ccrc'))).toEqual(before);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
  });

  it('the backup is COMPLETE before the install step runs — a fault between the two leaves it whole', () => {
    // The ordering pin. The staged install dies at its first instruction (the
    // stub exits 1) — everything the backup promises must already be on disk:
    // reordering backup after install (the mutation this test exists to
    // redden) leaves an operator whose failed update destroyed the only copy.
    const home = freshUpdateBox('ccrc-update-ordering-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantCoordDb(home);
    // A box already on ccd's pair (D-3696): its body is the other half the
    // backup must hold before anything is installed.
    mkdirSync(join(home, '.local', 'libexec', 'ccrc'), { recursive: true });
    writeFileSync(join(home, '.local', 'libexec', 'ccrc', 'ccd'), '#!/usr/bin/env bash\n# the OLD ccd body\n', { mode: 0o644 });
    packRelease(home, stubTree(home, { version: 'v2.0.0', installExit: 1 }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/ccrc-backups/);
    const backup = announcedBackupDir(r.stdout, home);
    // coord.db: a real snapshot (VACUUM INTO writes a database, not a copy of
    // uncertain bytes) …
    const snap = readFileSync(join(backup, 'coord.db'));
    expect(snap.subarray(0, 15).toString('utf8')).toBe('SQLite format 3');
    // … the old ccd, byte for byte — both halves of its pair …
    expect(readFileSync(join(backup, 'ccd'), 'utf8'))
      .toBe(readFileSync(join(home, '.local', 'bin', 'ccd'), 'utf8'));
    expect(readFileSync(join(backup, 'ccd-body'), 'utf8'))
      .toBe(readFileSync(join(home, '.local', 'libexec', 'ccrc', 'ccd'), 'utf8'));
    // … the job files this box actually has, and the dists. The NAMES are
    // per-platform (systemd units vs launchd plists) and so is the set:
    // launchd has no template unit, because there is nothing to instantiate —
    // `ccd` writes one plist per session at enable time.
    if (process.platform === 'darwin') {
      expect(existsSync(join(backup, 'app.ccrc.ccrc.plist'))).toBe(true);
    } else {
      expect(existsSync(join(backup, 'ccrc.service'))).toBe(true);
      expect(existsSync(join(backup, 'claude-session@.service'))).toBe(true);
    }
    expect(existsSync(join(backup, 'server-dist', 'old.js'))).toBe(true);
    expect(existsSync(join(backup, 'agent-dist', 'old.js'))).toBe(true);
  });

  it('--to vX.Y.Z fetches the named tag\'s URL space, and a downgrade prints the coord.db restore lines without copying the db', () => {
    const home = freshUpdateBox('ccrc-update-rollback-');
    plantOldBox(home, { version: 'v2.0.0' });
    plantCoordDb(home);
    const dbBytes = readFileSync(join(home, '.ccrc', 'coord.db'));
    packRelease(home, stubTree(home, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
    const r = runUpdate(home, ['--to', 'v1.0.0']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    // All three fetches went to the pinned tag's download path, in order —
    // the bundle joins the set (design §5, Task 12).
    expect(localUrls(home)).toEqual([
      `local://${home}/releases/download/v1.0.0/SHA256SUMS`,
      `local://${home}/releases/download/v1.0.0/ccrc-v1.0.0.tar.gz`,
      `local://${home}/releases/download/v1.0.0/ccrc-v1.0.0.tar.gz.sigstore.json`,
    ]);
    // The rollback report: the restore is PRINTED, never performed —
    // migrations are forward-only and an older server reads a newer coord.db.
    // Fix round 1 item 11 / review 155 C17: this hint line is redacted like
    // every other announcement now, so it reads `~/ccrc-backups/…`, never
    // the fixture's own absolute HOME (`announcedBackupDir`'s own real path
    // is still what the filesystem checks elsewhere in this file use).
    expect(r.stdout).toMatch(/^update: rollback: /m);
    expect(r.stdout).toContain('NOT restored');
    expect(r.stdout).toMatch(/cp ~\/ccrc-backups\/\d{8}-\d{6}\/coord\.db/);
    // The rollback lines name this platform's own stop verb.
    expect(r.stdout).toContain(process.platform === 'darwin'
      ? 'launchctl bootout' : 'systemctl --user stop ccrc.service');
    // The live db was read (VACUUM INTO) and never written.
    expect(readFileSync(join(home, '.ccrc', 'coord.db')).equals(dbBytes),
      'update wrote the live coord.db').toBe(true);
    // No skew was reported and none was asked about (no server address).
    expect(r.stdout).not.toMatch(/WARN/);
  });

  it('a downgrade prints the leave-the-journal line, and the journal bytes are unchanged and absent from the backup (path-identity spec 2026-10-12 §5.3)', () => {
    const home = freshUpdateBox('ccrc-update-rollback-journal-');
    plantOldBox(home, { version: 'v2.0.0' });
    plantCoordDb(home);
    const journal = plantCollectJournal(home);
    packRelease(home, stubTree(home, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
    const r = runUpdate(home, ['--to', 'v1.0.0']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^update: rollback: v2\.0\.0 -> v1\.0\.0 is a DOWNGRADE/m);
    expect(r.stdout).toMatch(LEAVE_JOURNAL_LINE);
    // One line, inside the snapshot arm, after the cp it qualifies: the operator reads it before running anything.
    const out = r.stdout.split('\n');
    const cpAt = out.findIndex((l) => /^update: rollback: {3}cp ~\/ccrc-backups\/\d{8}-\d{6}\/coord\.db /.test(l));
    expect(cpAt, 'the coord.db cp line').toBeGreaterThan(-1);
    expect(out.findIndex((l) => LEAVE_JOURNAL_LINE.test(l))).toBeGreaterThan(cpAt);
    expect(out.filter((l) => LEAVE_JOURNAL_LINE.test(l))).toHaveLength(1);
    expectJournalUntouched(journal, 'the downgrade');
    expect(journalCopiesUnder(announcedBackupDir(r.stdout, home)), 'the backup holds a copy of the journal').toEqual([]);
    // CONTROL: with no coord.db before the run there is no snapshot to restore, and no leave line beside nothing.
    const bare = freshUpdateBox('ccrc-update-rollback-journal-nodb-');
    plantOldBox(bare, { version: 'v2.0.0' });
    const bareJournal = plantCollectJournal(bare);
    packRelease(bare, stubTree(bare, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
    const b = runUpdate(bare, ['--to', 'v1.0.0']);
    expect(b.code, `stderr: ${b.stderr}\nstdout: ${b.stdout}`).toBe(0);
    expect(b.stdout).toMatch(/^update: rollback: {3}\(no coord\.db existed before this run/m);
    expect(b.stdout).not.toMatch(LEAVE_JOURNAL_LINE);
    expectJournalUntouched(bareJournal, 'the downgrade with no coord.db');
  });

  it('the recorded role reaches the staged install — CCRC_ROLE=fleet becomes --role fleet, absence becomes none', () => {
    const home = freshUpdateBox('ccrc-update-role-');
    plantOldBox(home, { version: 'v1.0.0' });
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=fleet\n');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, r.stderr).toBe(0);
    const argv = readFileSync(join(home, 'staged-ccrc-argv'), 'utf8').split('\n').filter((l) => l !== '');
    expect(argv[0]).toMatch(/\/ccd\/ccrc$/);
    expect(argv.slice(1)).toEqual(['install', '--role', 'fleet']);
    // Without a recorded role the staged install is invoked bare — its own
    // default (both) decides, exactly as a fresh `ccrc install` would. A
    // SEPARATE box (fix round 1 item 16 / review 155 C25): the stub install
    // never places a completed-install record, so a second run on the SAME
    // box would be a genuine (non-converged) reinstall reaching its own
    // `_upd_backup` — and a real-clock second shared with the first run's
    // backup is exactly the collision item 16 now refuses; a fresh box
    // avoids the race rather than freezing the clock for a case that was
    // never about backups at all.
    const bare = freshUpdateBox('ccrc-update-role-bare-');
    plantOldBox(bare, { version: 'v1.0.0' });
    mkdirSync(join(bare, '.ccrc'), { recursive: true });
    writeFileSync(join(bare, '.ccrc', 'ccrc.env'), '# no role recorded\n');
    packRelease(bare, stubTree(bare, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r2 = runUpdate(bare);
    expect(r2.code, r2.stderr).toBe(0);
    const argv2 = readFileSync(join(bare, 'staged-ccrc-argv'), 'utf8').split('\n').filter((l) => l !== '');
    expect(argv2.slice(1)).toEqual(['install']);
  });
});

describe('ccrc update: previous, and a spine that dies (design §10–§11; W4 Task 4)', () => {
  const OLD_SHA = 'oldsha0000000000000000000000000000000000';
  const report = (home: string): Record<string, unknown> =>
    JSON.parse(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')) as Record<string, unknown>;
  const previous = (home: string): string => readFileSync(join(home, '.ccrc', 'previous'), 'utf8');
  const stubBox = (prefix: string, installExit = 0): string => {
    const home = freshUpdateBox(prefix);
    plantOldBox(home, { version: 'v1.0.0' });
    // A COMPLETED install on v1.0.0 — the record names the stamp's sha — so
    // the stamp is a baseline and `previous` is written from it
    // (D-3254 keeps it otherwise).
    writeFileSync(join(home, '.ccrc', 'installed'), `${OLD_SHA}\n`);
    packRelease(home, stubTree(home, { version: 'v2.0.0', installExit }), { tag: 'v2.0.0' });
    return home;
  };

  it('previous is written BEFORE the staged install: two lines, the running tag and sha, mode 0644 (§18 "previous is written before the install")', () => {
    const home = stubBox('ccrc-update-prev-');
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readFileSync(join(home, 'staged-saw-previous'), 'utf8')).toBe(`v1.0.0\n${OLD_SHA}\n`);
    expect(previous(home)).toBe(`v1.0.0\n${OLD_SHA}\n`);
    expect(statSync(join(home, '.ccrc', 'previous')).mode & 0o777).toBe(0o644);
    expect(r.stdout).toMatch(new RegExp(`^update: previous: v1\\.0\\.0 \\(${OLD_SHA}\\) — the tag a restore or a bare 'ccrc rollback' returns to$`, 'm'));
  });

  it('an unversioned box writes `untagged` — its stamp sha when it has one, `unstamped` when it has none (D-3231)', () => {
    const home = freshUpdateBox('ccrc-update-prev-untagged-');
    plantOldBox(home);
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'),
      `{"sha":"${OLD_SHA}","ref":"main","builtAt":"2026-08-20T00:00:00Z","dirty":false}\n`);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    let r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readFileSync(join(home, 'staged-saw-previous'), 'utf8')).toBe(`untagged\n${OLD_SHA}\n`);
    expect(r.stdout).toMatch(/^update: previous: untagged \(oldsha0+\) — this build carries no release tag, so an automatic restore of it is arm 3 and a bare 'ccrc rollback' refuses \(name one with --to\)$/m);
    const bare = freshUpdateBox('ccrc-update-prev-unstamped-');
    plantOldBox(bare);
    packRelease(bare, stubTree(bare, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    r = runUpdate(bare);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readFileSync(join(bare, 'staged-saw-previous'), 'utf8')).toBe('untagged\nunstamped\n');
  });

  // `restore` is not typed here: bare, it is refused at exit 2 (Task 6); its `previous: kept` is read off the real child in Task 6's FULL case.
  // `rollback`/`watchdog` are refused on the CLI door too, since fix round 1
  // item 10 / review 155 C16 (both are now CALLER words, like `restore`) —
  // their real "kept, below the floor" behaviour is measured end-to-end on
  // the real caller elsewhere ("bare `ccrc rollback` returns to previous…",
  // "`ccrc rollback --from watchdog` — the REAL in-process path…"). THIS
  // test's own subject is `_upd_write_previous`'s own branch on `$UPD_FROM`
  // in isolation, so it calls the function directly (`sourcedCcrc`, Task
  // 3's idiom), the same way item 10's caller-marker guard never reaches —
  // that guard lives in `cmd_update`'s argument-refusal block, one layer
  // above the function this test targets.
  it.each([['rollback'], ['watchdog']])('a --from %s run does NOT rewrite previous — it returns to a known tag, not a new baseline (§18 "…and not by a restore")', (from) => {
    const home = freshUpdateBox(`ccrc-update-prev-keep-${from}-`);
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'previous'), 'v0.9.0\nbaselinesha\n');
    const r = sourcedCcrc(home, `UPD_FROM=${from} _upd_write_previous v2.0.0 ${OLD_SHA}`);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readFileSync(join(home, '.ccrc', 'previous'), 'utf8')).toBe('v0.9.0\nbaselinesha\n');
    expect(r.stdout).toMatch(new RegExp(`^update: previous: kept \\(v0\\.9\\.0\\) — a --from ${from} run returns to a known tag; it is not a new baseline$`, 'm'));
  });

  // D-3254, amended in place by fix round 1 item 2 / review 155 C1 (D-3283's
  // OWN pre-amendment text, which this test used to pin, argued the
  // opposite — see the ruling quoted in ccd/ccrc's own D-3283 comment).
  // `previous` names the LAST DIFFERENT release that ran before the current
  // one: a same-tag `--force` reinstall (`ccrc update --to <running tag>
  // --force`, and every `rollout --force` on a converged box) is not a MOVE,
  // so it leaves `previous` UNTOUCHED — whether or not THIS box's own
  // install of that tag ever completed. Writing the running build there (as
  // this test used to require) would make a later bare `ccrc rollback` roll
  // the box FORWARD onto the tag whose reinstall just failed. The restore
  // target this argument used to worry about is answered structurally
  // instead: `_upd_restore_arm2` now skips itself outright on a same-tag
  // run (its own test, in the "automatic restore" describe).
  it('a --force reinstall of the tag the box already runs, even a COMPLETED baseline, keeps previous — a same-tag run is not a move (fix round 1 item 2 / review 155 C1, amends D-3283)', () => {
    const home = freshUpdateBox('ccrc-update-prev-reinstall-');
    plantOldBox(home, { version: 'v2.0.0' });
    // The record names the RUNNING stamp's OWN sha: this box completed
    // installing v2.0.0 before this rerun. That no longer matters — a
    // same-tag reinstall keeps `previous` regardless.
    writeFileSync(join(home, '.ccrc', 'installed'), `${OLD_SHA}\n`);
    writeFileSync(join(home, '.ccrc', 'previous'), 'v1.0.0\nbaselinesha\n');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home, ['--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(existsSync(join(home, 'staged-ccrc-argv')), 'the reinstall never ran — the keep below would be vacuous').toBe(true);
    expect(readFileSync(join(home, 'staged-saw-previous'), 'utf8')).toBe('v1.0.0\nbaselinesha\n');
    expect(previous(home)).toBe('v1.0.0\nbaselinesha\n');
    expect(r.stdout).toMatch(/^update: previous: kept \(v1\.0\.0\) — this box's stamp already reads v2\.0\.0, the tag this run installs; a reinstall is not a new baseline$/m);
  });

  // The keep D-3254 (a) actually protects: the record is present but names a
  // DIFFERENT sha than the running stamp — the running build's OWN install
  // never completed (this record is a stale leftover from an earlier build
  // that happened to carry the same tag), so it is not yet a baseline.
  it('a --force reinstall of the tag the box already runs, with a record naming a DIFFERENT sha, keeps previous — the running build has not itself completed (D-3254 (a))', () => {
    const home = freshUpdateBox('ccrc-update-prev-reinstall-stale-record-');
    plantOldBox(home, { version: 'v2.0.0' });
    // Present, but NOT the running stamp's own sha.
    writeFileSync(join(home, '.ccrc', 'installed'), 'differentsha00000000000000000000000000\n');
    writeFileSync(join(home, '.ccrc', 'previous'), 'v1.0.0\nbaselinesha\n');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home, ['--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(existsSync(join(home, 'staged-ccrc-argv')), 'the reinstall never ran — the keep below would be vacuous').toBe(true);
    expect(readFileSync(join(home, 'staged-saw-previous'), 'utf8')).toBe('v1.0.0\nbaselinesha\n');
    expect(previous(home)).toBe('v1.0.0\nbaselinesha\n');
    expect(r.stdout).toMatch(/^update: previous: kept \(v1\.0\.0\) — this box's stamp already reads v2\.0\.0, the tag this run installs; a reinstall is not a new baseline$/m);
  });

  // Review fix round 1 I2: the same-tag keep is UNCONDITIONAL — it does
  // NOT need a well-formed `previous` to have something worth keeping
  // (unlike the absent-record keep D-3254 protects for a DIFFERENT tag,
  // below), because a same-tag run writes nothing in the first place. This
  // test used to pin the opposite (writing the running tag as `previous`
  // when none existed to keep) — that write is exactly what let a `rollout
  // --force` on a converged, never-rolled-back box invent a `previous`
  // pointing at itself.
  it('a --force reinstall of the tag the box already runs, with NO previous file at all, keeps (none) and writes nothing (review fix round 1 I2)', () => {
    const first = freshUpdateBox('ccrc-update-prev-reinstall-none-');
    plantOldBox(first, { version: 'v2.0.0' });
    writeFileSync(join(first, '.ccrc', 'installed'), `${OLD_SHA}\n`);
    packRelease(first, stubTree(first, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r2 = runUpdate(first, ['--force']);
    expect(r2.code, `stderr: ${r2.stderr}\nstdout: ${r2.stdout}`).toBe(0);
    expect(r2.stdout).toMatch(/^update: previous: kept \(none\) — this box's stamp already reads v2\.0\.0, the tag this run installs; a reinstall is not a new baseline$/m);
    expect(existsSync(join(first, '.ccrc', 'previous')), 'a same-tag run must never INVENT a previous').toBe(false);
  });

  // Review fix round 1 I2's second pin: a MALFORMED `previous` (not the
  // two-line grammar) is likewise left exactly as it was — never
  // overwritten with the running tag, and never "repaired".
  it('a --force reinstall of the tag the box already runs, with a MALFORMED previous file, keeps (unreadable) and writes nothing (review fix round 1 I2)', () => {
    const home = freshUpdateBox('ccrc-update-prev-reinstall-malformed-');
    plantOldBox(home, { version: 'v2.0.0' });
    writeFileSync(join(home, '.ccrc', 'installed'), `${OLD_SHA}\n`);
    writeFileSync(join(home, '.ccrc', 'previous'), 'not the right shape at all\n');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home, ['--force']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^update: previous: kept \(unreadable\) — this box's stamp already reads v2\.0\.0, the tag this run installs; a reinstall is not a new baseline$/m);
    expect(previous(home)).toBe('not the right shape at all\n');
  });

  it('a box whose last install never completed (stamp v2.0.0, no record) keeps previous on an update to ANOTHER tag (D-3254)', () => {
    const home = freshUpdateBox('ccrc-update-prev-incomplete-');
    plantOldBox(home, { version: 'v2.0.0' });   // no `installed`: the spine that stamped v2.0.0 died before its record
    writeFileSync(join(home, '.ccrc', 'previous'), 'v1.0.0\nbaselinesha\n');
    // v3.0.0, not v2.0.0: the same-tag arm cannot be what keeps it.
    packRelease(home, stubTree(home, { version: 'v3.0.0' }), { tag: 'v3.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readFileSync(join(home, 'staged-saw-previous'), 'utf8')).toBe('v1.0.0\nbaselinesha\n');
    expect(previous(home)).toBe('v1.0.0\nbaselinesha\n');
    expect(r.stdout).toMatch(/^update: previous: kept \(v1\.0\.0\) — this box's stamp has no completed-install record, so an earlier update's spine never finished and the stamp is not a new baseline$/m);
    // …and with NO previous to keep, the same box writes its stamp as today:
    // the arm keeps a baseline, it never invents an absence.
    const fresh = freshUpdateBox('ccrc-update-prev-incomplete-none-');
    plantOldBox(fresh, { version: 'v2.0.0' });
    packRelease(fresh, stubTree(fresh, { version: 'v3.0.0' }), { tag: 'v3.0.0' });
    const r2 = runUpdate(fresh);
    expect(r2.code, `stderr: ${r2.stderr}\nstdout: ${r2.stdout}`).toBe(0);
    expect(previous(fresh)).toBe(`v2.0.0\n${OLD_SHA}\n`);
  });

  it('a previous that cannot be written is REMOVED, never left stale — and the update proceeds saying so', () => {
    const home = stubBox('ccrc-update-prev-mvfail-');
    writeFileSync(join(home, '.ccrc', 'previous'), 'v0.5.0\nstalesha\n');
    writeFileSync(join(home, 'fixture-mv-fail'), '/.ccrc/previous\n');
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^update: WARN: could not write ~\/\.ccrc\/previous — removed the stale one so no restore can target the wrong tag; this update proceeds without an automatic arm-2 restore$/m);
    expect(existsSync(join(home, '.ccrc', 'previous')), 'the stale previous survived').toBe(false);
    expect(existsSync(join(home, 'staged-saw-no-previous'))).toBe(true);
    expect(readdirSync(join(home, '.ccrc')).filter((f) => f.startsWith('previous.tmp.'))).toEqual([]);
  });

  it('a previous that can be neither written nor removed stops the update BEFORE the staged install', () => {
    const home = stubBox('ccrc-update-prev-stuck-');
    mkdirSync(join(home, '.ccrc', 'previous', 'in-the-way'), { recursive: true });
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/could not write ~\/\.ccrc\/previous, and could not remove the stale one either/);
    expect(existsSync(join(home, 'staged-ccrc-argv')), 'the staged install ran').toBe(false);
    expect(report(home)).toMatchObject({ phase: 'failed' });
  });

  it('a spine that dies BEFORE _inst_tree: exit 1, "nothing was replaced", update.json failed: spine died at <step> (§11)', () => {
    const home = stubBox('ccrc-update-spine-before-', 1);
    writeFileSync(join(home, 'fixture-install-step'), '_inst_node_id\n');
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: the staged install \(which ends with doctor\) exited 1 — spine died at _inst_node_id, before _inst_tree: nothing was replaced; put back as they were: completed-install record; read its lines above\. The backup taken BEFORE it ran is complete at \S+\/ccrc-backups\/\S+$/m);
    // D-3462: the record this box carried is back — this death replaced nothing.
    expect(existsSync(join(home, '.ccrc', 'installed')), 'the cleared record was left removed').toBe(true);
    expect(report(home)).toMatchObject({ phase: 'failed', detail: 'spine died at _inst_node_id', target: 'v2.0.0' });
  });

  it.each([['_inst_tree'], ['_inst_bins'], ['_inst_skills'], ['_inst_from_a_newer_spine']])('a spine that dies at %s reads AT OR AFTER _inst_tree — an unknown step is the safe direction (§18 "a spine death after the tree moved reverts", Task 4 half)', (step) => {
    const home = stubBox(`ccrc-update-spine-after-${step.replace(/^_/, '')}-`, 1);
    writeFileSync(join(home, 'fixture-install-step'), `${step}\n`);
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    // W4 Task 5: the moved arm is GATED now; the gate passes, so the run
    // exits 1 naming --force (D-3240).
    expect(r.stderr).toContain(`update: the box moved and answers on v2.0.0, but its install never completed (spine died at ${step}) — rerun: ccrc update --to v2.0.0 --force`);
    expect(report(home)).toMatchObject({ phase: 'failed', detail: `spine died at ${step}` });
  });

  it('no step marker and an unmoved stamp (a spine older than W4) exits 1 WITHOUT claiming nothing was replaced — and a STALE marker from an earlier failed install never classifies this run (D-3252)', () => {
    const home = stubBox('ccrc-update-spine-none-', 1);
    writeFileSync(join(home, '.ccrc', 'install-step'), '_inst_skills\n');   // left by an earlier failed `ccrc install`
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('spine died at an unrecorded step (no step marker; a spine older than W4 writes none), and whether the tree was replaced is not known (the stamp, written only after _inst_tree, did not move); read its lines above.');
    expect(r.stderr, 'an unmarked death claimed a measurement nobody made').not.toMatch(/nothing was replaced/);
    expect(report(home)).toMatchObject({
      phase: 'failed', detail: 'spine died at an unrecorded step (no step marker; a spine older than W4 writes none)',
    });
    expect(existsSync(join(home, '.ccrc', 'install-step'))).toBe(false);
  });

  it('no step marker but a MOVED stamp (a pre-W4 spine that reached _inst_stamp) reads AT OR AFTER _inst_tree — the stamp is written only after the tree (D-3252)', () => {
    const home = stubBox('ccrc-update-spine-none-restamped-', 1);
    writeFileSync(join(home, 'fixture-restamp'), '');
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(existsSync(join(home, '.ccrc', 'install-step')), 'the fixture wrote a marker — this case is about a spine that writes none').toBe(false);
    expect(r.stdout).toMatch(/^update: the staged spine recorded no step \(a spine older than W4 writes none\), but ~\/\.ccrc\/build\.json no longer names the build this run replaced — _inst_stamp ran after _inst_tree, so the tree WAS placed$/m);
    // W4 Task 5: an unmarked spine whose stamp moved is gated like any other
    // moved death; the gate passes, so the run exits 1 naming --force.
    expect(r.stderr).toContain('update: the box moved and answers on v2.0.0, but its install never completed (spine died at an unrecorded step) — rerun: ccrc update --to v2.0.0 --force');
    expect(report(home)).toMatchObject({ phase: 'failed', detail: 'spine died at an unrecorded step' });
  });

  it('FULL flavour: the REAL staged spine records _inst_skills as it enters it, and a death there reads at-or-after the tree (§11 Pins, "spine death")', () => {
    const home = freshUpdateBox('ccrc-update-spine-skills-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantCoordDb(home);
    const tree = fullTree(home, { version: 'v2.0.0', sha: 'newsha0000000000000000000000000000000000' });
    writeFileSync(join(tree, 'ccd', 'install-coordinator-skill.sh'),
      '#!/bin/bash\necho "fixture: the coordinator skill installer refuses" >&2\nexit 1\n', { mode: 0o755 });
    rmSync(join(tree, 'MANIFEST'));   // writeManifest lists every file — the old MANIFEST would list itself
    writeManifest(tree);
    packRelease(home, tree, { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toMatch(/fixture: the coordinator skill installer refuses/);
    expect(readFileSync(join(home, '.ccrc', 'install-step'), 'utf8')).toBe('_inst_skills\n');
    expect(r.stderr).toContain('update: the box moved and answers on v2.0.0, but its install never completed (spine died at _inst_skills) — rerun: ccrc update --to v2.0.0 --force');
    expect(existsSync(join(home, '.ccrc', 'installed'))).toBe(false);
    expect(report(home)).toMatchObject({ phase: 'failed', detail: 'spine died at _inst_skills' });
  });

  it('_upd_step_moved classifies by the RUNNING tree\'s CCRC_INST_SPINE; _upd_spine_step answers none, the step, or unreadable', () => {
    const home = freshUpdateBox('ccrc-update-step-moved-');
    const cases: Array<[string, number]> = [
      ['none', 1], ['_inst_banner', 1], ['_inst_node_id', 1],
      ['_inst_tree', 0], ['_inst_bins', 0], ['_inst_skills', 0], ['_inst_installed', 0],
      ['_inst_from_a_newer_spine', 0], ['unreadable', 0],
    ];
    const r = sourcedCcrc(home, [
      ...cases.map(([s]) => `_upd_step_moved ${s}; echo "${s}=$?"`),
      'f="$HOME/.ccrc/install-step"; mkdir -p "$HOME/.ccrc"; rm -f "$f"',
      'echo "step:$(_upd_spine_step)"',
      'printf \'%s\\n\' _inst_hooks > "$f"; echo "step:$(_upd_spine_step)"',
      'printf \'%s\\n\' \'_inst_hooks; echo injected\' > "$f"; echo "step:$(_upd_spine_step)"',
      ': > "$f"; echo "step:$(_upd_spine_step)"',
    ].join('\n'));
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.trim().split('\n')).toEqual([
      ...cases.map(([s, rc]) => `${s}=${rc}`),
      'step:none', 'step:_inst_hooks', 'step:unreadable', 'step:unreadable',
    ]);
  });

  it('_upd_stamp_moved: rc 0 only for a stamp that parses to ANOTHER sha — absent, the same sha or a malformed stamp is rc 1, and BOX_BUILD is restored', () => {
    const home = freshUpdateBox('ccrc-update-stamp-moved-');
    const stamp = (sha: string): string =>
      `printf '%s\\n' '{"sha":"${sha}","ref":"main","builtAt":"2026-08-20T00:00:00Z","dirty":false}' > "$HOME/.ccrc/build.json"`;
    const r = sourcedCcrc(home, [
      'mkdir -p "$HOME/.ccrc"; rm -f "$HOME/.ccrc/build.json"',
      '_upd_stamp_moved oldsha; echo "absent=$?"',
      stamp('oldsha'), '_upd_stamp_moved oldsha; echo "same=$?"',
      stamp('newsha'), '_upd_stamp_moved oldsha; echo "moved=$?"',
      '_upd_stamp_moved ""; echo "from-unstamped=$?"',
      'printf \'not json\\n\' > "$HOME/.ccrc/build.json"; _upd_stamp_moved oldsha; echo "malformed=$?"',
      'BOX_BUILD=(keep me); _upd_stamp_moved oldsha; echo "restored=${BOX_BUILD[*]}"',
    ].join('\n'));
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.trim().split('\n')).toEqual([
      'absent=1', 'same=1', 'moved=0', 'from-unstamped=0', 'malformed=1', 'restored=keep me',
    ]);
  });

  it('_upd_read_previous answers five ways and never dies: tag, absent, untagged, malformed, not-a-file', () => {
    const home = freshUpdateBox('ccrc-update-read-prev-');
    const r = sourcedCcrc(home, [
      'p="$HOME/.ccrc/previous"; mkdir -p "$HOME/.ccrc"',
      'show() { _upd_read_previous; echo "$1=$? [$UPD_PREV_TAG] [$UPD_PREV_SHA]"; }',
      'show absent',
      'printf \'%s\\n\' v1.2.3 abc123 > "$p"; show tag',
      'printf \'%s\\n\' untagged abc123 > "$p"; show untagged',
      'printf \'%s\\n\' untagged unstamped > "$p"; show unstamped',
      'printf \'%s\\n\' latest abc123 > "$p"; show not-a-tag',
      'printf \'%s\\n\' v1.2.3 > "$p"; show one-line',
      'printf \'%s\\n\' v1.2.3 abc123 extra > "$p"; show three-lines',
      'printf \'v1.2.3\\n\\n\' > "$p"; show empty-sha',
      'rm -f "$p"; mkdir "$p"; show directory',
    ].join('\n'));
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.trim().split('\n')).toEqual([
      'absent=1 [] []',
      'tag=0 [v1.2.3] [abc123]',
      'untagged=2 [untagged] [abc123]',
      'unstamped=2 [untagged] [unstamped]',
      'not-a-tag=3 [] []',
      'one-line=3 [] []',
      'three-lines=3 [] []',
      'empty-sha=3 [] []',
      'directory=3 [] []',
    ]);
  });
});

describe('ccrc update: provenance (design §5; the verifier is the INSTALLED one, decision 12)', () => {
  const OWNER = ((): string => {
    const m = /^CCRC_RELEASE_OWNER="([^"]+)"$/m.exec(readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8'));
    return m![1]!;
  })();
  const REPO_NAME = ((): string => {
    const m = /^CCRC_RELEASE_REPO="([^"]+)"$/m.exec(readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8'));
    return m![1]!;
  })();
  const verifyArgv = (home: string): string[] => (existsSync(join(home, 'verify-argv'))
    ? readFileSync(join(home, 'verify-argv'), 'utf8').split('\n').filter((l) => l !== '') : []);

  it('the bundle is fetched after the tarball and verified by the INSTALLED tree\'s verifier, with --tag, before extraction; the spine is told (§18 "the INSTALLED verifier is used")', () => {
    const home = freshUpdateBox('ccrc-update-prov-ok-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(localUrls(home)).toEqual([
      `local://${home}/releases/latest/download/SHA256SUMS`,
      `local://${home}/releases/latest/download/ccrc-v2.0.0.tar.gz`,
      `local://${home}/releases/latest/download/ccrc-v2.0.0.tar.gz.sigstore.json`,
    ]);
    const argv = verifyArgv(home);
    expect(argv.length).toBe(1);
    const a = argv[0]!.split(' ');
    // `node --no-warnings <verifier> …`: the verifier is resolved beside the
    // ccrc under test (`$CCRC_HERE/../deploy/`), never under the staging dir.
    expect(a[0]).toBe('--no-warnings');
    expect(a[1]).toBe(`${join(REPO, 'ccd')}/../deploy/verify-provenance.mjs`);
    expect(a[1]!.startsWith(join(home, 'tmp'))).toBe(false);
    const flag = (f: string): string => a[a.indexOf(f) + 1]!;
    expect(flag('--blob')).toMatch(/\/ccrc-v2\.0\.0\.tar\.gz$/);
    expect(flag('--bundle')).toMatch(/\/ccrc-v2\.0\.0\.tar\.gz\.sigstore\.json$/);
    expect(flag('--tag')).toBe('v2.0.0');
    expect(flag('--owner')).toBe(OWNER);
    expect(flag('--repo')).toBe(REPO_NAME);
    expect(r.stdout).toMatch(/^update: verified ccrc-v2\.0\.0\.tar\.gz \(transport checksum, provenance, then the per-file MANIFEST\)$/m);
    expect(readFileSync(join(home, 'staged-ccrc-env'), 'utf8')).toBe('1\n');
  });

  it('D-3141: nothing is extracted before provenance is settled — the verifier itself observes no staging tree yet', () => {
    // The plan's mutation row 12 ("move the verifier call below `tar -xzf`")
    // measured GREEN against every assertion above: `_upd_resolve`'s EXIT
    // trap sweeps the whole staging dir on every exit, so nothing left on
    // disk after the fact can tell "never extracted" apart from "extracted,
    // then swept". This pin reads what the shim itself saw AT THE MOMENT it
    // was invoked, before any exit/sweep could happen.
    const home = freshUpdateBox('ccrc-update-prov-staging-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readFileSync(join(home, 'staging-at-verify'), 'utf8')).toBe('no\n');
  });

  it('a FAILING bundle refuses: nothing extracted, no backup, ~/ccrc byte-identical — and --allow-unsigned does not apply (§18 "--allow-unsigned permits absence only")', () => {
    const home = freshUpdateBox('ccrc-update-prov-fail-');
    plantOldBox(home, { version: 'v1.0.0' });
    const before = treeDigest(join(home, 'ccrc'));
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-verify-exit'), '1\n');
    let r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/provenance verification FAILED for ccrc-v2\.0\.0\.tar\.gz .* refusing to extract or install/);
    expect(treeDigest(join(home, 'ccrc'))).toEqual(before);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
    r = runUpdate(home, ['--allow-unsigned']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/--allow-unsigned does not apply to a bundle that FAILS/);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
  });

  // D-6842: the REAL verifier, not the node shim: a hostile release host serves
  // the right SHA256SUMS and tarball and, as the bundle, a file whose second
  // line is terminal control. Node's JSON.parse error quotes about the first ten
  // characters of a long bad line (the whole of a short one), so the first case
  // is the review's line and the other two put the title set and the OSC 52
  // write where that quote reaches them. `refuse` prints each byte outside
  // printable ASCII as `?`; nothing raw reaches stderr, stdout or update.json.
  const ESC = '\x1b';
  const BEL = '\x07';
  const CLEAR = `${ESC}[2J`;
  const HOME_CURSOR = `${ESC}[H`;
  const TITLE = `${ESC}]0;title${BEL}`;
  const OSC52 = `${ESC}]52;c;aGVsbG8=${BEL}`;
  it.each([
    ['clear screen, cursor home, a title set and an OSC 52 write', `${CLEAR}${HOME_CURSOR}${TITLE}${OSC52}`, '?[2J?[H?]0'],
    ['a title set alone', TITLE, '?]0;title?'],
    ['an OSC 52 clipboard write alone', OSC52, '?]52;c;aGVsbG8=?'],
    // Not only C0: DEL, a C1 CSI (two UTF-8 bytes) and a multibyte letter are each outside printable ASCII too.
    ['a DEL, a C1 CSI and a multibyte letter', '\x7f\u009béx', '"?????x"'],
  ])('a hostile bundle (%s) is refused by the real verifier, and its refusal line carries no raw escape byte (D-6842)', (_what, line, shown) => {
    const home = freshUpdateBox('ccrc-update-prov-escape-');
    plantOldBox(home, { version: 'v1.0.0' });
    const before = treeDigest(join(home, 'ccrc'));
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'releases', 'latest', 'download', 'ccrc-v2.0.0.tar.gz.sigstore.json'), `{"a":1}\n${line}\n`);
    // A `node` ahead of the shim on PATH, so `_upd_fetch` runs the checkout's
    // own deploy/verify-provenance.mjs; the shim execs this same node for
    // every other invocation.
    const realBin = join(home, 'real-node-bin');
    mkdirSync(realBin, { recursive: true });
    writeFileSync(join(realBin, 'node'), `#!/bin/sh\nexec '${REAL_NODE}' "$@"\n`);
    chmodSync(join(realBin, 'node'), 0o755);
    // The update chooses its node first and wants npm and npx beside it (`ccd/ccrc-node`): this directory is now the
    // chosen one, so it carries the fixture's own two.
    for (const n of ['npm', 'npx']) symlinkSync(join(home, '.local', 'bin', n), join(realBin, n));
    const r = runUpdate(home, [], { PATH: `${realBin}:${updateEnv(home)['PATH']}` });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(existsSync(join(home, 'verify-argv')), 'the shim answered, not the real verifier').toBe(false);
    expect(r.stderr).toMatch(/^verify-provenance: Unexpected token '\?', .* is not valid JSON$/m);
    expect(r.stderr).toMatch(/provenance verification FAILED for ccrc-v2\.0\.0\.tar\.gz .* refusing to extract or install/);
    expect(r.stderr).toContain(shown);
    const report = readFileSync(join(home, '.ccrc', 'update.json'), 'utf8');
    for (const [where, text] of [['stderr', r.stderr], ['stdout', r.stdout], ['update.json', report]] as const) {
      expect(text.includes(ESC), `${where} holds a raw ESC`).toBe(false);
      expect(text.includes(BEL), `${where} holds a raw BEL`).toBe(false);
      for (const seq of [CLEAR, HOME_CURSOR, `${ESC}]0;`, `${ESC}]52;`]) expect(text.includes(seq), `${where} holds ${JSON.stringify(seq)}`).toBe(false);
    }
    expect(treeDigest(join(home, 'ccrc'))).toEqual(before);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
  });

  // D-3142: a verifier that cannot RUN at all (a usage error, or node/the
  // script itself missing) is a DIFFERENT fact from a verifier that ran and
  // refused the bundle — folding both into "FAILED" tells the operator the
  // RELEASE is bad when the box could not even perform the check, and closes
  // --allow-unsigned's escape hatch for the wrong reason.
  it('a verifier that exits 2 (usage error) is reported as unable to RUN, not as a bundle that FAILED (D-3142)', () => {
    const home = freshUpdateBox('ccrc-update-prov-vrc2-');
    plantOldBox(home, { version: 'v1.0.0' });
    const before = treeDigest(join(home, 'ccrc'));
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-verify-exit'), '2\n');
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/could not RUN the installed verifier \(.*verify-provenance\.mjs exited 2\) — this is not a verdict on the bundle; nothing on this box was changed/);
    expect(r.stderr).not.toMatch(/provenance verification FAILED/);
    expect(treeDigest(join(home, 'ccrc'))).toEqual(before);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
  });

  it('a verifier that exits 127 (node/the script itself missing) gets the same "could not RUN" sentence (D-3142)', () => {
    const home = freshUpdateBox('ccrc-update-prov-vrc127-');
    plantOldBox(home, { version: 'v1.0.0' });
    const before = treeDigest(join(home, 'ccrc'));
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-verify-exit'), '127\n');
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/could not RUN the installed verifier \(.*verify-provenance\.mjs exited 127\) — this is not a verdict on the bundle; nothing on this box was changed/);
    expect(r.stderr).not.toMatch(/provenance verification FAILED/);
    expect(treeDigest(join(home, 'ccrc'))).toEqual(before);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
  });

  // D-3144: the verifier itself now speaks exit 3 for its own
  // dependency-load failure (a partial `npm ci` under server/node_modules)
  // — this is the ccrc-side half of that pin: exit 3 is just one more
  // member of the SAME non-{0,1} vocabulary 2 and 127 above already
  // exercise, so it must fall into this `elif` arm exactly as they do,
  // never into the `vrc -eq 1` "FAILED" arm.
  //
  // NOT A REGRESSION PIN FOR D-3144's OWN FIX, and it must not be relied on
  // as one (whole-branch fix-round re-review): it drives the recording stub
  // through `fixture-verify-exit`, never the real verify-provenance.mjs, so
  // it exercises this `elif` arm — which D-3144 did not touch — and would
  // stay GREEN if the verifier's dependency-load catch were reverted to
  // exiting 1. What reds on that revert is the verifier-side case in
  // `verify-provenance.test.ts` ('cannot load its own dependencies').
  // This case's job is the shell-side contract: that the arm treats an
  // unfamiliar non-{0,1} code the same way it treats the two it knows.
  it('a verifier that exits 3 (a dependency it could not load) gets the same "could not RUN" sentence, never "FAILED" (D-3144)', () => {
    const home = freshUpdateBox('ccrc-update-prov-vrc3-');
    plantOldBox(home, { version: 'v1.0.0' });
    const before = treeDigest(join(home, 'ccrc'));
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    writeFileSync(join(home, 'fixture-verify-exit'), '3\n');
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/could not RUN the installed verifier \(.*verify-provenance\.mjs exited 3\) — this is not a verdict on the bundle; nothing on this box was changed/);
    expect(r.stderr).not.toMatch(/provenance verification FAILED/);
    expect(treeDigest(join(home, 'ccrc'))).toEqual(before);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
  });

  it('an ABSENT bundle refuses without --allow-unsigned, and proceeds with it — recorded as unsigned (§18 "--allow-unsigned is recorded")', () => {
    const home = freshUpdateBox('ccrc-update-prov-absent-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', bundle: false });
    let r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/the release ships no provenance bundle .* installs only with --allow-unsigned \(recorded on the box as unsigned\)/);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(verifyArgv(home)).toEqual([]);
    r = runUpdate(home, ['--allow-unsigned']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    // D-3143 then D-3284: curl -f's exit 22 means ANY HTTP status >= 400, not
    // specifically 404 — so only a MEASURED 404 (via -w) reaches this WARN.
    expect(r.stdout).toMatch(/^update: WARN: .*sigstore\.json is absent \(the release host answered 404\) — proceeding on the transport checksum alone because --allow-unsigned was typed; this install will be recorded as unsigned$/m);
    // m9 (Ruling 32): the closing transcript line for this success path was
    // previously unasserted — pin it distinct from the verified-bundle case's
    // own closing line (the OK-flavour test above).
    expect(r.stdout).toMatch(/^update: verified ccrc-v2\.0\.0\.tar\.gz \(transport checksum, then the per-file MANIFEST — provenance NOT verified, --allow-unsigned\)$/m);
    expect(readFileSync(join(home, 'staged-ccrc-env'), 'utf8')).toBe('unset\n');
  });

  it('env -u actually strips an AMBIENT CCRC_UPDATE_VERIFIED=1 on the unsigned path — the "marker records unsigned" case, deliberately polluted (the env-u pin)', () => {
    // Without this, `env -u CCRC_UPDATE_VERIFIED` could be deleted from
    // `cmd_update`'s staged-install invocation and every existing test would
    // stay green, because nothing ever POLLUTES the ambient environment
    // before calling `runUpdate`. Here it is deliberately polluted, and the
    // FULL-flavour marker (`.ccrc/installed`, the real spine) is what proves
    // `env -u` actually strips it rather than relying on it never being set.
    const home = freshUpdateBox('ccrc-update-prov-envu-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantCoordDb(home);
    const sha = 'newsha0000000000000000000000000000000002';
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha }), { tag: 'v2.0.0', bundle: false });
    const r = runUpdate(home, ['--allow-unsigned'], { CCRC_UPDATE_VERIFIED: '1' });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readFileSync(join(home, '.ccrc', 'installed'), 'utf8')).toBe(`${sha}\nunsigned\n`);
  });

  it('FULL flavour: a verified update writes a one-line marker; an --allow-unsigned one writes `unsigned` on line 2', () => {
    const home = freshUpdateBox('ccrc-update-prov-marker-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantCoordDb(home);
    const sha = 'newsha0000000000000000000000000000000001';
    packRelease(home, fullTree(home, { version: 'v2.0.0', sha }), { tag: 'v2.0.0' });
    let r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readFileSync(join(home, '.ccrc', 'installed'), 'utf8')).toBe(`${sha}\n`);
    const home2 = freshUpdateBox('ccrc-update-prov-marker-unsigned-');
    plantOldBox(home2, { version: 'v1.0.0' });
    plantCoordDb(home2);
    packRelease(home2, fullTree(home2, { version: 'v2.0.0', sha }), { tag: 'v2.0.0', bundle: false });
    r = runUpdate(home2, ['--allow-unsigned']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readFileSync(join(home2, '.ccrc', 'installed'), 'utf8')).toBe(`${sha}\nunsigned\n`);
  });

  it('verification runs AFTER sha256sum -c (a tampered tarball never reaches the verifier) and BEFORE tar -x (§18 "verification precedes extraction")', () => {
    const home = freshUpdateBox('ccrc-update-prov-order-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', tamper: true });
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/checksum verification FAILED/);
    expect(verifyArgv(home)).toEqual([]);
    // The failing-verifier case above proves the other side: refused before
    // extraction, so no staged tree, no backup, no spine.
  });

  it('a bundle download that fails for a reason other than 404 is not "absent" — refused even with --allow-unsigned', () => {
    const home = freshUpdateBox('ccrc-update-prov-net-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    // The stub curl exits 22 for a missing file (curl's own 404 shape); the
    // fixture exit models every other failure — here curl's 7, "could not
    // connect" — which is NOT absence and which --allow-unsigned never admits.
    writeFileSync(join(home, 'fixture-curl-exit'), '7\n');
    const r = runUpdate(home, ['--allow-unsigned']);
    expect(r.code).toBe(1);
    // D-3284: verdict-first now — "not a verdict on this release" survives
    // the 200-char cut even when the URL is long; the URL itself follows.
    expect(r.stderr).toMatch(/a transient fetch failure \(curl exit 7, not a 404\) fetching the provenance bundle — not a verdict on this release: .*sigstore\.json/);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
  });

  it('D-3140: build.json unreadable/malformed at the staged tree ("{"), refuses with the rc-N sentence and installs nothing', () => {
    const home = freshUpdateBox('ccrc-update-prov-buildjson-');
    plantOldBox(home, { version: 'v1.0.0' });
    // Built by hand rather than via stubTree: the MANIFEST must be generated
    // exactly ONCE, over the tree's final bytes (build-release.sh's own
    // shape) — a malformed build.json that is still MANIFEST-honest, so the
    // run reaches `_box_build_fields`'s parse and no earlier guard.
    const tree = join(home, 'payload-v2.0.0-badjson');
    mkdirSync(join(tree, 'ccd'), { recursive: true });
    writeFileSync(join(tree, 'ccd', 'ccrc'),
      '#!/bin/sh\nprintf \'%s\\n\' "$0" "$@" > "$HOME/staged-ccrc-argv"\n'
      + 'printf \'%s\\n\' "${CCRC_UPDATE_VERIFIED:-unset}" > "$HOME/staged-ccrc-env"\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(tree, 'MARKER'), 'release payload\n');
    writeFileSync(join(tree, 'build.json'), '{');
    writeManifest(tree);
    packRelease(home, tree, { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/the extracted tree's build\.json is unreadable or malformed \(rc \d+\) — refusing to install/);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
  });
});

describe('ccrc update: --check refuses --downgrade and --allow-unsigned like --force (D-3139)', () => {
  it.each([
    ['--downgrade'],
    ['--allow-unsigned'],
  ])('--check and %s are exclusive — same refusal shape as --check/--force, exit 2, nothing fetched', (flag) => {
    const home = freshUpdateBox(`ccrc-update-check-excl-${flag.replace(/^--/, '')}-`);
    const r = runUpdate(home, ['--check', flag]);
    expect(r.code).toBe(2);
    // m4 (Ruling 32): the flag name is interpolated per case — the old
    // three-way alternation let a `--downgrade` case pass even if the code
    // emitted "--allow-unsigned" (or vice versa), since either alternative
    // satisfies it.
    expect(r.stderr).toMatch(new RegExp(`update: --check and ${flag} are exclusive`));
    expect(existsSync(join(home, 'curl-argv')), 'a fetch ran before the refusal').toBe(false);
  });
});

describe('ccrc update: the fleet-behind warning (D-150 aware)', () => {
  it('a server whose /api/fleet/health says skewed earns a WARN naming fleet-box-first', () => {
    const home = freshUpdateBox('ccrc-update-skew-');
    plantOldBox(home, { version: 'v1.0.0' });
    writeFileSync(join(home, 'fixture-health-body'),
      '{"mode":"remote","connected":true,"downSince":null,"build":"skewed","roster":"agreed"}\n');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home, [], { CCRC_ADDR: '127.0.0.1:7788' });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^update: WARN: .*skewed.*fleet box first/im);
  });

  it('a 401 from the session gate skips the comparison SILENTLY — the gate answered, not the build (D-150)', () => {
    const home = freshUpdateBox('ccrc-update-401-');
    plantOldBox(home, { version: 'v1.0.0' });
    writeFileSync(join(home, 'fixture-health-body'),
      '{"error":"unauthenticated","verdict":"no session cookie"}\n');
    writeFileSync(join(home, 'fixture-health-code'), '401\n');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home, [], { CCRC_ADDR: '127.0.0.1:7788' });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).not.toMatch(/WARN/);
    // The update itself proceeded: the staged install ran.
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(true);
  });
});

describe('ccrc update: the supervisor sweep (Task 7 — R1, granted 2026-08-21)', () => {
  // The one scoped exception to CLAUDE.md's never-touch rule: update's step-4
  // sweep may try-restart `claude-session@*` units, but ONLY behind the
  // mandatory KillMode=process preflight — without KillMode=process a
  // try-restart is a fleet kill (every session is a child of ONE tmux server
  // sitting in whichever claude-session@ cgroup created it), so an absent
  // drop-in refuses the SWEEP, never fails the UPDATE. All against the
  // RECORDING systemctl stub above — no real systemd, no real sweep, ever.
  // `plantKillModeDropIn` and `UNIT_LINES` are at FILE scope — the gate's
  // `converged()` needs both, so that its "NO sweep" assertion has a sweep
  // to be the absence of.

  itLinux('with KillMode=process resolving per unit, the sweep runs: preflight, try-restart, the failed warn query, the active verify query — in that argv order', () => {
    const home = freshUpdateBox('ccrc-update-sweep-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    writeFileSync(join(home, 'fixture-sweep-active'), UNIT_LINES);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    // The ONLY systemctl traffic in a stub-flavour run is the health gate's
    // unit probe (design §11 — it runs BEFORE the sweep) and the sweep's, so
    // the whole recording is the order pin: the gate, then enumerate,
    // preflight EVERY unit plus
    // the uninstantiated template probe, try-restart, then the two state
    // queries — warn about failed, verify active.
    const calls = readFileSync(join(home, 'systemctl-calls'), 'utf8')
      .split('\n').filter((l) => l !== '');
    expect(calls).toEqual([
      '--user is-active ccrc.service',
      '--user list-units claude-session@* --plain --no-legend',
      '--user show -p KillMode claude-session@alpha.service',
      '--user show -p KillMode claude-session@beta.service',
      '--user show -p KillMode claude-session@ccrc-update-preflight.service',
      '--user try-restart claude-session@*',
      '--user list-units claude-session@* --state=failed --plain --no-legend',
      '--user list-units claude-session@* --state=active --plain --no-legend',
    ]);
    // Panes are NEVER touched: no tmux invocation happened at all (the tmux
    // stub records every call), and no recorded argv so much as names it.
    expect(existsSync(join(home, 'tmux-argv')), 'the sweep reached for tmux').toBe(false);
    expect(calls.join('\n')).not.toMatch(/tmux/);
    expect(r.stdout).toMatch(/^update: sweep: /m);
    expect(r.stdout).not.toMatch(/DEGRADED/);
  });

  // G-M8 control: the pre-restart set is read from the ACTIVE column, not
  // from "every listed unit" — a unit the unfiltered listing shows as
  // already FAILED (never active) must not be warned about as an unverified
  // vanish, and must not appear in the old success line's implicit claim.
  itLinux('G1b-control: a unit already FAILED in the unfiltered listing (never active) is not warned about and does not block the old success line', () => {
    const home = freshUpdateBox('ccrc-update-sweep-prefailed-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'),
      `${UNIT_LINES}claude-session@gamma.service loaded failed failed fixture supervisor\n`);
    writeFileSync(join(home, 'fixture-sweep-active'), UNIT_LINES);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stderr).not.toMatch(/claude-session@gamma\.service was active before try-restart/);
    expect(r.stdout).toMatch(
      /^update: sweep: every live claude-session@ supervisor now runs the ccd this update installed \(KillMode=process verified per unit before any restart; panes untouched\)$/m);
  });

  // Fix round 1 item 5 / review 155 C2 (your Q5), narrowed by review fix
  // round 1 m2: the lock is released BEFORE the sweep (§10 requires it), so
  // a SECOND `ccrc update` can take it mid-sweep and write its own
  // in-flight report. Only the WRITE this run makes after that point — the
  // closing `_upd_phase done` — must not clobber that newer run's report:
  // it runs only while update.json still names THIS run's own pid, and
  // skips with one line otherwise. `_upd_report`'s own announcement writes
  // NOTHING to disk (operator output only) and always runs regardless. The
  // reviewer's own probe shape: the systemctl stub's try-restart arm writes
  // a foreign report (a different pid) mid-sweep.
  itLinux('a foreign report written mid-sweep survives this run\'s closing phase write, which skips with one line — but the build line still prints (review fix round 1 m2, narrowing item 5 / review 155 C2, your Q5)', () => {
    const home = freshUpdateBox('ccrc-update-sweep-foreign-report-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    writeFileSync(join(home, 'fixture-sweep-active'), UNIT_LINES);
    writeFileSync(join(home, 'fixture-sweep-foreign-report'), 'yes\n');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    // The run's OWN exit code is unaffected by the skip — it still reports
    // success to ITS OWN caller; only the JSON write is skipped.
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(
      /^update: report: skipped — ~\/\.ccrc\/update\.json no longer names this run's pid \(\d+\); a newer update took the lock this run released before the sweep, and this run's final phase write would have overwritten its in-flight one$/m);
    // The foreign report SURVIVES — this run never overwrote it with a
    // closing `done`.
    const rep = JSON.parse(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')) as Record<string, unknown>;
    expect(rep).toEqual({
      target: 'v9.9.9', phase: 'resolving', startedAt: 1, updatedAt: 1, detail: null, from: 'cli', pid: 999999,
    });
    // `_upd_report` writes NOTHING to disk, so it always runs — the build
    // line prints even though the JSON write it precedes was skipped.
    expect(r.stdout).toMatch(/^update: build: v1\.0\.0 \(oldsha0+\) -> v1\.0\.0 \(oldsha0+\)$/m);
    // The sweep itself still ran — the skip is only the closing phase write.
    expect(r.stdout).toMatch(/^update: sweep: /m);
  });

  // ── wave 8 item G: the success line claims no more than was measured ────
  // A claim of "every … now runs the ccd this update installed" is false
  // when nothing was active before try-restart ran (there was nothing to
  // verify), and false for a unit that WAS active before and is not seen
  // active or failed after (this sweep did not verify it — it is named).

  itLinux('G1a: NO fixture-sweep-units and no fixture-sweep-active — the pre-restart set is truly empty: the zero line, never the old success line', () => {
    const home = freshUpdateBox('ccrc-update-sweep-zero-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantKillModeDropIn(home);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(
      /^update: sweep: no claude-session@ supervisor was active when the sweep began, so try-restart had nothing running to restart \(KillMode=process verified before the restart; panes untouched\)$/m);
    expect(r.stdout).not.toContain('every live claude-session@ supervisor now runs the ccd this update installed');
    expect(r.stderr).not.toMatch(/was active before try-restart/);
  });

  itLinux('G1b: UNIT_LINES in both fixture-sweep-units and fixture-sweep-active — the old success line, byte-identical; no zero line, no new warning', () => {
    const home = freshUpdateBox('ccrc-update-sweep-full-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    writeFileSync(join(home, 'fixture-sweep-active'), UNIT_LINES);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(
      /^update: sweep: every live claude-session@ supervisor now runs the ccd this update installed \(KillMode=process verified per unit before any restart; panes untouched\)$/m);
    expect(r.stdout).not.toContain('no claude-session@ supervisor was active when the sweep began');
    expect(r.stderr).not.toMatch(/was active before try-restart/);
  });

  itLinux('G1d: UNIT_LINES in fixture-sweep-units, fixture-sweep-active ABSENT — both units named on stderr as unverified, but the old success line still prints', () => {
    const home = freshUpdateBox('ccrc-update-sweep-vanish-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).not.toContain('no claude-session@ supervisor was active when the sweep began');
    expect(r.stderr).toMatch(
      /^update: warning: claude-session@alpha\.service was active before try-restart and is not active after it — this sweep did not verify it\. On the box: systemctl --user status claude-session@alpha\.service$/m);
    expect(r.stderr).toMatch(
      /^update: warning: claude-session@beta\.service was active before try-restart and is not active after it — this sweep did not verify it\. On the box: systemctl --user status claude-session@beta\.service$/m);
    expect(r.stdout).toMatch(
      /^update: sweep: every live claude-session@ supervisor now runs the ccd this update installed \(KillMode=process verified per unit before any restart; panes untouched\)$/m);
  });

  itLinux('with the drop-in ABSENT the sweep is REFUSED — loud, naming the drop-in — and the update still exits 0 with a degraded line', () => {
    const home = freshUpdateBox('ccrc-update-sweep-refused-');
    plantOldBox(home, { version: 'v1.0.0' });
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    // The sweep is refused, not the update: the run completes, reports, exits 0.
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^update: build: /m);
    // Loud, and it names both the resolved value and the drop-in that fixes it.
    expect(r.stderr).toMatch(/sweep REFUSED/);
    expect(r.stderr).toContain('KillMode=process');
    expect(r.stderr).toContain('claude-session@.service.d');
    expect(r.stdout).toMatch(/^update: DEGRADED: the supervisor sweep/m);
    // Refused means NOTHING was restarted: the preflight stopped at the first
    // bad unit and no try-restart ever hit the recording.
    const calls = readFileSync(join(home, 'systemctl-calls'), 'utf8');
    expect(calls).not.toMatch(/try-restart/);
    expect(existsSync(join(home, 'tmux-argv'))).toBe(false);
  });

  // ── fix round 1 item 1 (D-3599, review 196 F1): the sweep claims nothing ──
  // it did not measure. (a) the unfiltered pre-sweep listing fails — the
  // sweep REFUSES, restarting nothing, rather than print a zero line nobody
  // measured. G1b's setup (both fixture-sweep-units/-active carry UNIT_LINES,
  // KillMode=process drop-in present, so a successful listing would sweep
  // clean), with ONLY the unfiltered listing failing.
  itLinux('(a) the unfiltered pre-sweep listing fails — the sweep is REFUSED, not the old zero line: stderr names the rc, stdout is DEGRADED with no "Fix the KillMode above" and no restart, no zero line, no old success line, no restart call', () => {
    const home = freshUpdateBox('ccrc-update-sweep-listing-fail-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    writeFileSync(join(home, 'fixture-sweep-active'), UNIT_LINES);
    writeFileSync(join(home, 'fixture-sweep-units-fail'), '');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stderr).toMatch(
      /^update: sweep REFUSED — systemctl --user list-units "claude-session@\*" --plain --no-legend failed \(rc 93\), so the supervisors to be checked could not be listed\.$/m);
    expect(r.stdout).toMatch(
      /^update: DEGRADED: the supervisor sweep did not run — every live claude-session@ supervisor keeps executing the PREVIOUS ccd until restarted\. Once systemctl --user list-units 'claude-session@\*' answers, confirm KillMode=process on each unit, then restart them\.$/m);
    expect(r.stdout).not.toContain('Fix the KillMode above');
    expect(r.stdout).not.toContain('no claude-session@ supervisor was active when the sweep began');
    expect(r.stdout).not.toContain('every live claude-session@ supervisor now runs the ccd this update installed');
    const calls = readFileSync(join(home, 'systemctl-calls'), 'utf8');
    expect(calls).not.toMatch(/try-restart/);
    expect(existsSync(join(home, 'tmux-argv'))).toBe(false);
    // The refusal is the KillMode refusal's own exit code and update.json —
    // never a new failure (review 196's ruling, item 1).
    const rep = JSON.parse(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')) as Record<string, unknown>;
    expect(rep).toMatchObject({ phase: 'done', detail: null, from: 'cli' });
    // R10k (wave 17, D-5315): the report says the sweep did not run, and why, in its eighth key.
    expect(rep['sweep']).toBe('refused: listing');
  });

  // The UPDATE path's KillMode refusal (wave 17, D-5315): no drop-in, so the fixture's `show -p KillMode` answers
  // systemd's control-group default; the sweep is refused, restarts nothing, and the update's own `done` records it.
  itLinux('the update\'s sweep REFUSED over KillMode is recorded: exit 0, DEGRADED, no try-restart, phase done, detail null, sweep refused: killmode (R10k, D-5315)', () => {
    const home = freshUpdateBox('ccrc-update-sweep-killmode-record-');
    plantOldBox(home, { version: 'v1.0.0' });
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    writeFileSync(join(home, 'fixture-sweep-active'), UNIT_LINES);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stderr).toMatch(/^update: sweep REFUSED — claude-session@alpha\.service resolves to KillMode=control-group/m);
    expect(r.stdout).toMatch(/^update: DEGRADED: the supervisor sweep did not run — every live claude-session@ supervisor keeps executing the PREVIOUS ccd until restarted/m);
    expect(readFileSync(join(home, 'systemctl-calls'), 'utf8')).not.toMatch(/try-restart/);
    expect(JSON.parse(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')) as Record<string, unknown>)
      .toMatchObject({ phase: 'done', detail: null, from: 'cli', sweep: 'refused: killmode' });
  });

  // (a) on the OTHER caller — a rollback by flip reaches `_upd_sweep` from
  // `cmd_rollback` itself, not through `cmd_update`, so the refusal is pinned
  // at that call site too (review 179 item 5's pattern, applied to D-3599).
  itLinux('(a) on a rollback BY FLIP: the unfiltered pre-sweep listing fails and the flip\'s own sweep is REFUSED the same way — the flip itself still completes, exit 0, phase done', () => {
    const home = freshUpdateBox('ccrc-rollback-flip-sweep-listing-fail-');
    plantW6Box(home, 'v2.0.0', V2_SHA, 'server');
    const kept = keptVersion(home, 'v1.0.0', V1_SHA);
    writeFileSync(join(home, '.ccrc', 'previous'), `v1.0.0\n${V1_SHA}\n`);
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    writeFileSync(join(home, 'fixture-sweep-active'), UNIT_LINES);
    writeFileSync(join(home, 'fixture-sweep-units-fail'), '');
    const r = rollbackRun(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(linkOf(home)).toBe(kept);
    expect(r.stderr).toMatch(
      /^update: sweep REFUSED — systemctl --user list-units "claude-session@\*" --plain --no-legend failed \(rc 93\), so the supervisors to be checked could not be listed\.$/m);
    expect(r.stdout).toMatch(
      /^update: DEGRADED: the supervisor sweep did not run — every live claude-session@ supervisor keeps executing the PREVIOUS ccd until restarted\. Once systemctl --user list-units 'claude-session@\*' answers, confirm KillMode=process on each unit, then restart them\.$/m);
    expect(r.stdout).not.toContain('Fix the KillMode above');
    expect(r.stdout).not.toContain('no claude-session@ supervisor was active when the sweep began');
    const calls = existsSync(join(home, 'systemctl-calls')) ? readFileSync(join(home, 'systemctl-calls'), 'utf8') : '';
    expect(calls).not.toMatch(/try-restart/);
    expect(JSON.parse(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')) as Record<string, unknown>)
      .toMatchObject({ phase: 'done', from: 'rollback', sweep: 'refused: listing' });
  });

  // (b) the verify (`--state=active`) listing fails — DEGRADED in place of
  // the per-unit "not active after it" warnings and the old success line;
  // the restart itself already happened (its rc is untouched), so
  // try-restart IS in the recording.
  itLinux('(b) the verify listing fails after a real restart — a warning and a DEGRADED line replace the per-unit warnings and the old success line, rc stays 0', () => {
    const home = freshUpdateBox('ccrc-update-sweep-verify-fail-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    writeFileSync(join(home, 'fixture-sweep-active-fail'), '');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stderr).toMatch(
      /^update: warning: the post-restart set could not be listed \(systemctl --user list-units "claude-session@\*" --state=active --plain --no-legend failed, rc 94\) — no supervisor was verified\.$/m);
    expect(r.stdout).toMatch(
      /^update: DEGRADED: every live claude-session@ supervisor was restarted, and none of them was verified by this sweep\.$/m);
    expect(r.stderr).not.toMatch(/was active before try-restart/);
    expect(r.stdout).not.toContain('every live claude-session@ supervisor now runs the ccd this update installed');
    expect(r.stdout).not.toContain('no claude-session@ supervisor was active when the sweep began');
    const calls = readFileSync(join(home, 'systemctl-calls'), 'utf8');
    expect(calls).toMatch(/--user try-restart claude-session@\*/);
    // R10k (wave 17, D-5315): the report keeps `phase: done` and `detail: null` (review 196 item 1) and says so in `sweep`.
    expect(JSON.parse(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')) as Record<string, unknown>)
      .toMatchObject({ phase: 'done', detail: null, sweep: 'unverified: relist' });
  });

  // G1a with the verify listing ALSO failing: `before` measures truly empty
  // (no fixture-sweep-units at all), so (b)'s fork must not fire — the zero
  // line prints exactly as G1a's plain case does, and no DEGRADED (b) line.
  itLinux('G1a with the verify listing failing too: still the zero line, never a (b) DEGRADED line — nothing was restarted, so nothing needed verifying', () => {
    const home = freshUpdateBox('ccrc-update-sweep-zero-verify-fail-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-active-fail'), '');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(
      /^update: sweep: no claude-session@ supervisor was active when the sweep began, so try-restart had nothing running to restart \(KillMode=process verified before the restart; panes untouched\)$/m);
    expect(r.stdout).not.toMatch(/DEGRADED/);
    expect(r.stderr).not.toMatch(/post-restart set could not be listed/);
  });

  // ── The Darwin siblings: the same outcomes, launchd's vocabulary ─────────
  // The macOS counterpart of the R1 preflight is `AbandonProcessGroup`, read
  // from the plist on disk; the restart is `launchctl kickstart -k`, which
  // without that key kills the job's whole process group — the shared tmux
  // server included. These four run against the recording launchctl stub in
  // `updateEnv`, never a real launchd.
  const plantSessionPlist = (home: string, id: string,
    opts: { abandons?: boolean; loaded?: boolean } = {}): void => {
    const { abandons = true, loaded = true } = opts;
    const agents = join(home, 'Library', 'LaunchAgents');
    mkdirSync(agents, { recursive: true });
    const key = abandons ? '<key>AbandonProcessGroup</key><true/>' : '';
    writeFileSync(join(agents, `app.ccrc.session.${id}.plist`),
      '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>'
      + `<key>Label</key><string>app.ccrc.session.${id}</string>${key}</dict></plist>\n`);
    if (loaded) appendFileSync(join(home, 'launchctl-loaded'), `app.ccrc.session.${id}.plist\n`);
  };

  itDarwin('with AbandonProcessGroup in every job file, the sweep kickstarts each loaded session and re-measures it still up', () => {
    const home = freshUpdateBox('ccrc-update-sweep-darwin-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantSessionPlist(home, 'alpha');
    plantSessionPlist(home, 'beta');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const calls = readFileSync(join(home, 'launchctl-calls'), 'utf8');
    expect(calls).toMatch(/^kickstart -k gui\/\d+\/app\.ccrc\.session\.alpha$/m);
    expect(calls).toMatch(/^kickstart -k gui\/\d+\/app\.ccrc\.session\.beta$/m);
    // Panes are NEVER touched, on this platform exactly as on the other.
    expect(existsSync(join(home, 'tmux-argv')), 'the sweep reached for tmux').toBe(false);
    expect(r.stdout).toMatch(/^update: sweep: /m);
    expect(r.stdout).toContain('2 restarted and re-measured still up');
    expect(r.stdout).not.toMatch(/DEGRADED/);
  });

  // Wave 8 item G, G1c: zero loaded session jobs (no plist planted at all —
  // `_svc_list_sessions` enumerates nothing) give the Darwin zero line, never
  // a false "N restarted and re-measured still up".
  itDarwin('G1c: with NO session plist at all, the sweep kickstarts nothing and says so — never "restarted and re-measured still up"', () => {
    const home = freshUpdateBox('ccrc-update-sweep-darwin-zero-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(existsSync(join(home, 'launchctl-calls')) ? readFileSync(join(home, 'launchctl-calls'), 'utf8') : '')
      .not.toMatch(/kickstart/);
    expect(r.stdout).toMatch(
      /^update: sweep: no loaded claude-session@ supervisor on this box, so nothing was restarted \(AbandonProcessGroup is checked per job file when there is one\)$/m);
    expect(r.stdout).not.toContain('restarted and re-measured still up');
    expect(r.stdout).not.toMatch(/DEGRADED/);
  });

  // G1c's direct twin — `sourcedCcrc`'s technique (CCD_OS forced after the
  // `.`) reaches `_upd_sweep`'s Darwin arm from a Linux runner too, so this
  // one line's mutation is measurable on every box this suite runs on, not
  // only a macOS leg.
  it('G1c-direct: _upd_sweep\'s Darwin arm (CCD_OS forced), zero plists — the zero line, never "restarted and re-measured still up"', () => {
    const home = freshUpdateBox('ccrc-update-sweep-darwin-direct-zero-');
    const r = sourcedCcrc(home, 'CCD_OS=darwin; UPD_BACKUP_DIR="$HOME/ccrc-backups/fixture"; _upd_sweep');
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(
      /^update: sweep: no loaded claude-session@ supervisor on this box, so nothing was restarted \(AbandonProcessGroup is checked per job file when there is one\)$/m);
    expect(r.stdout).not.toContain('restarted and re-measured still up');
    expect(existsSync(join(home, 'launchctl-calls')) ? readFileSync(join(home, 'launchctl-calls'), 'utf8') : '')
      .not.toMatch(/kickstart/);
  });

  // ── Wave 11 (R12), Task 7: the Darwin arm — one shared window, one re-check ──
  // D0–D2, D4 and D6–D8 reach the arm from any runner (`sourcedCcrc` forces CCD_OS after
  // the `.`), and D3 from a Linux runner (wave 12, R19a; D-4068); the launchctl stub is
  // `updateEnv`'s own, and the window knobs are 0.
  const SWEEP_D = 'CCD_OS=darwin; UPD_BACKUP_DIR="$HOME/ccrc-backups/fixture"; ';
  const IDS3 = ['alpha', 'beta', 'gamma'];
  const darwinBox = (prefix: string, ids: string[]): string => {
    const home = freshUpdateBox(prefix);
    for (const id of ids) plantSessionPlist(home, id);
    return home;
  };
  const calls = (home: string): string[] => readFileSync(join(home, 'launchctl-calls'), 'utf8').split('\n').filter(Boolean);
  const plantReport = (home: string, pid: number): string => {
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    const body = `{"target":"v0.0.85","phase":"resolving","startedAt":1700000000,"updatedAt":1700000001,"detail":null,"from":"auto","pid":${pid}}\n`;
    writeFileSync(join(home, '.ccrc', 'update.json'), body);
    return body;
  };
  const OWN_REPORT = 'UPD_REPORTING=1; UPD_REPORT_PID=4242; UPD_REPORT_TARGET=v0.0.85; UPD_FROM=auto; UPD_REPORT_STARTED=1; ';

  it('D0: the Darwin arm\'s dies go through the guard — no bare _ccrc_die, exactly two _upd_sweep_die calls (wave 11, D-3973)', () => {
    const src = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    const m = /_upd_sweep\(\) \{([\s\S]*?)\n\}/.exec(src);
    expect(m, '_upd_sweep() { … } not found in ccd/ccrc').not.toBeNull();
    const sweep = m![1]!;
    const d0 = sweep.indexOf('"$CCD_OS" = darwin');
    expect(d0, '_upd_sweep lost its Darwin arm').toBeGreaterThan(-1);
    const dEnd = sweep.indexOf('\n  fi', d0);
    expect(dEnd, "_upd_sweep's Darwin arm never closes").toBeGreaterThan(d0);
    const darwin = sweep.slice(d0, dEnd);
    expect(darwin).not.toContain('_ccrc_die');
    expect(darwin.match(/_upd_sweep_die "/g)?.length ?? 0).toBe(2);
  });

  it('D1: ONE shared window — every job is kicked, then every job is read, then every job is read again (wave 11, D-3975)', () => {
    const home = darwinBox('ccrc-update-sweep-d1-', IDS3);
    const r = sourcedCcrc(home, `${SWEEP_D}_upd_sweep`);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toContain('3 restarted and re-measured still up');
    expect(r.stderr).not.toContain('re-check:');
    const all = calls(home);
    let lastKick = -1;
    all.forEach((l, i) => { if (l.startsWith('kickstart ')) lastKick = i; });
    expect(lastKick, 'no kickstart was recorded').toBeGreaterThan(-1);
    const after = all.slice(lastKick + 1);
    expect(after.length, after.join('\n')).toBe(6);
    expect(after.map((l) => l.replace(/^print gui\/\d+\/app\.ccrc\.session\./, '')))
      .toEqual(['alpha', 'beta', 'gamma', 'alpha', 'beta', 'gamma']);
    for (const l of after) expect(l).toMatch(/^print gui\/\d+\/app\.ccrc\.session\.[a-z]+$/);
  });

  it('D2: a job that churns through its re-check is named, with the counts, and no backup is promised (wave 11, D-3974)', () => {
    const home = darwinBox('ccrc-update-sweep-d2-', IDS3);
    writeFileSync(join(home, 'fixture-pid-churn.app.ccrc.session.beta'), 'yes\n');
    const r = sourcedCcrc(home, `${SWEEP_D}_upd_sweep`);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toContain('update: sweep: re-check: claude-session@beta.service did not stay up (pid ');
    expect(r.stderr).toContain('update: sweep: re-check: claude-session@beta.service failed its re-check too');
    expect(r.stderr).toContain('ccrc: sweep: 1 of 3 launchd session jobs did not stay up on a first window; a re-check failed, '
      + '0 left un-re-checked — install complete, nothing was rolled back (first failed re-check: claude-session@beta.service, pid ');
    expect(r.stderr).not.toContain('backup');
    expect(r.stdout).not.toContain('restarted and re-measured still up');
  });

  const D3_BODY = (shim: string): string =>
    `${SWEEP_D}${shim}${OWN_REPORT}_upd_sweep`;
  const d3 = (home: string, shim: string): void => {
    writeFileSync(join(home, 'fixture-pid-churn.app.ccrc.session.beta'), 'yes\n');
    const plant = plantReport(home, 999999);
    const r = sourcedCcrc(home, D3_BODY(shim));
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')).toBe(plant);
    expect(r.stdout).toContain('update: report: skipped — ');
  };
  // `_upd_report_readable` reads the file's size through `_plat_size`, which under a forced
  // CCD_OS=darwin runs BSD `stat -f %z` — a Linux runner's GNU stat refuses that and the foreign report
  // would read as this run's own. D3 stands the platform primitive in with GNU `stat -c %s`, which BSD
  // stat refuses in turn, so D3 is Linux-only; D3d (macOS) runs the real one (wave 12, R19a; D-4068).
  itLinux('D3: a foreign report survives the Darwin die (GNU stat stands in for the platform size primitive) (wave 11, D-3973)', () => {
    d3(darwinBox('ccrc-update-sweep-d3-', IDS3), '_plat_size() { stat -c %s "$@"; }; ');
  });
  itDarwin('D3d: a foreign report survives the Darwin die, the real _plat_size (wave 11, D-3973)', () => {
    d3(darwinBox('ccrc-update-sweep-d3d-', IDS3), '');
  });

  it('D4: the single-unit contract the gate and _inst_enable lean on — two prints, the one-job detail (wave 11, D-3975)', () => {
    const home = darwinBox('ccrc-update-sweep-d4-', ['alpha']);
    const one = 'CCD_OS=darwin; _ccrc_job_stayed_up claude-session@alpha.service; echo "rc=$? detail=$CCRC_STAYED_DETAIL"';
    const ok = sourcedCcrc(home, one);
    expect(ok.code, ok.stderr).toBe(0);
    expect(ok.stdout).toMatch(/^rc=0 detail=pid 4242 -> 4242 across 0s\+0s$/m);
    expect(calls(home).filter((l) => l.startsWith('print ')).length).toBe(2);
    writeFileSync(join(home, 'fixture-pid-churn'), 'yes\n');
    const bad = sourcedCcrc(home, one);
    expect(bad.code, bad.stderr).toBe(0);
    expect(bad.stdout).toMatch(/^rc=1 detail=pid 4\d+ -> 4\d+ across 0s\+0s$/m);
  });

  it('D6: the Darwin cap keeps the facts — a 31-character id, the report detail at most 200 characters (wave 11, D-3974)', () => {
    const id = `demo-${'x'.repeat(26)}`;
    expect(id.length).toBe(31);
    const home = darwinBox('ccrc-update-sweep-d6-', [id]);
    writeFileSync(join(home, 'fixture-pid-churn'), 'yes\n');
    plantReport(home, 4242);
    const r = sourcedCcrc(home, `${SWEEP_D}${OWN_REPORT}_upd_sweep`);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    const j = JSON.parse(readFileSync(join(home, '.ccrc', 'update.json'), 'utf8')) as { phase: string; detail: string };
    expect(j.phase).toBe('failed');
    expect(j.detail.length).toBeLessThanOrEqual(200);
    for (const want of ['1 of 1', 'did not stay up', 'nothing was rolled back']) expect(j.detail, want).toContain(want);
  });

  it('D7: the re-check passes a job that recovered (wave 11, D-3983)', () => {
    const home = darwinBox('ccrc-update-sweep-d7-', IDS3);
    writeFileSync(join(home, 'fixture-pid-churn-first.app.ccrc.session.beta'), '2\n');
    const r = sourcedCcrc(home, `${SWEEP_D}_upd_sweep`);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stderr).toContain('re-check: claude-session@beta.service passed its re-check');
    expect(r.stdout).toContain('3 restarted and re-measured still up');
  });

  it('D8: every job churning makes exactly ONE re-check, then the update dies (Reading 17, wave 11, D-3983)', () => {
    const home = darwinBox('ccrc-update-sweep-d8-', IDS3);
    writeFileSync(join(home, 'fixture-pid-churn'), 'yes\n');
    const r = sourcedCcrc(home, `${SWEEP_D}_upd_sweep`);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr.match(/re-measuring it once more, alone/g)?.length ?? 0).toBe(1);
    expect(r.stderr.match(/and is not re-checked/g)?.length ?? 0).toBe(2);
    expect(r.stderr).toContain('3 of 3 launchd session jobs did not stay up on a first window; a re-check failed, 2 left un-re-checked');
  });

  itDarwin('a job file missing AbandonProcessGroup REFUSES the sweep — loud on stderr, DEGRADED on stdout, and NO kickstart for ANY session', () => {
    const home = freshUpdateBox('ccrc-update-sweep-darwin-refused-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantSessionPlist(home, 'alpha');
    plantSessionPlist(home, 'beta', { abandons: false });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    // The sweep is refused, not the update: the run completes, reports, exits 0.
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^update: build: /m);
    expect(r.stderr).toMatch(/sweep REFUSED/);
    expect(r.stderr).toContain('AbandonProcessGroup');
    // The remedy names the BARE id `ccd start` actually takes.
    expect(r.stderr).toContain('ccd start beta');
    expect(r.stderr).not.toContain('ccd start beta.service');
    // The transcript line rides STDOUT, as the Linux arm's does — the stream
    // divergence was measured (>&2 on the Darwin line only) and fixed; a
    // stdout-only capture must not read as a clean update.
    expect(r.stdout).toMatch(/^update: DEGRADED: the supervisor sweep/m);
    expect(r.stderr).not.toMatch(/^update: DEGRADED/m);
    const calls = existsSync(join(home, 'launchctl-calls'))
      ? readFileSync(join(home, 'launchctl-calls'), 'utf8') : '';
    expect(calls).not.toMatch(/kickstart/);
    expect(existsSync(join(home, 'tmux-argv'))).toBe(false);
  });

  itDarwin('a kicked supervisor whose pid did not hold across the window FAILS the update, naming how many and the first job, and no backup no path restores (wave 11, D-3974)', () => {
    const home = freshUpdateBox('ccrc-update-sweep-darwin-loop-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantSessionPlist(home, 'alpha');
    // Every `launchctl print` answers a fresh pid: a crash loop as launchd
    // shows one. kickstart itself still exits 0 — the gap under test.
    writeFileSync(join(home, 'fixture-pid-churn'), 'yes\n');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, 'a supervisor that did not stay up must FAIL the update').not.toBe(0);
    expect(r.stderr).toMatch(/did not stay up/);
    // Wave 11 (D-3974): the facts, and no promise of a backup nothing restores from.
    expect(r.stderr).toContain('sweep: 1 of 1 launchd session jobs');
    expect(r.stderr).not.toContain('pre-update backup');
  });

  itDarwin('a session carrying the start-limit stamp is warned about and skipped — not kicked, not fatal', () => {
    const home = freshUpdateBox('ccrc-update-sweep-darwin-failed-');
    plantOldBox(home, { version: 'v1.0.0' });
    plantSessionPlist(home, 'alpha');
    // gamma was booted out by the start-limit emulation: stamp on disk, job
    // no longer loaded — `_svc_list_sessions` still enumerates its plist.
    plantSessionPlist(home, 'gamma', { loaded: false });
    mkdirSync(join(home, '.cc-sessions'), { recursive: true });
    writeFileSync(join(home, '.cc-sessions', 'gamma.svcfailed'), '1\n');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stderr).toMatch(/^update: warning: claude-session@gamma\.service is FAILED/m);
    expect(r.stderr).toContain('ccd start gamma');
    const calls = readFileSync(join(home, 'launchctl-calls'), 'utf8');
    expect(calls).toMatch(/^kickstart -k gui\/\d+\/app\.ccrc\.session\.alpha$/m);
    expect(calls).not.toMatch(/kickstart -k gui\/\d+\/app\.ccrc\.session\.gamma/);
    expect(r.stdout).toContain('1 restarted and re-measured still up');
  });
});

describe('ccrc update: source pins', () => {
  // ── ONE release identity, two entry points, held equal (the D-92 idiom) ──
  // `install.sh --release` runs before any ccrc exists on the box, so it
  // cannot read ccrc's pair, and ccrc runs on boxes install.sh has left —
  // the cross-file second spelling is structural, so it is PINNED equal
  // rather than promised equal.
  it('the release owner/repo pair is spelled in install.sh and ccd/ccrc, and the two agree', () => {
    const pick = (src: string, file: string, name: string): string => {
      const m = new RegExp(`^${name}="([^"]+)"$`, 'm').exec(src);
      expect(m, `${file} does not spell ${name}`).not.toBeNull();
      return m![1]!;
    };
    const inst = readFileSync(join(REPO, 'install.sh'), 'utf8');
    const ccrc = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    expect(pick(ccrc, 'ccd/ccrc', 'CCRC_RELEASE_OWNER'))
      .toBe(pick(inst, 'install.sh', 'CCRC_RELEASE_OWNER'));
    expect(pick(ccrc, 'ccd/ccrc', 'CCRC_RELEASE_REPO'))
      .toBe(pick(inst, 'install.sh', 'CCRC_RELEASE_REPO'));
  });

  // ── The bash floor — three spellings, held to one value (same idiom) ────
  // install.sh's macOS preflight, `ccrc install`'s Darwin gate and the
  // README each state the floor, in three different logical forms, and
  // nothing held them equal (PR #11 review): a floor bump applied to one
  // site goes green in CI and admits a box the other site then refuses —
  // after paying for npm ci and a vite build. The two predicates are
  // extracted BY THEIR OWN SPELLINGS and reduced to (major, minor); a
  // rewritten predicate that no longer matches is a red here, not a silent
  // second spelling.
  it('the bash floor is the SAME major.minor in install.sh, ccd/ccrc and the README', () => {
    const inst = readFileSync(join(REPO, 'install.sh'), 'utf8');
    const ccrc = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    const readme = readFileSync(join(REPO, 'README.md'), 'utf8');

    // install.sh: [ maj -lt X ] || { [ maj -eq X ] && [ min -lt Y ] }
    const i = /\[ "\$bmaj" -lt (\d+) \] \|\| \{ \[ "\$bmaj" -eq (\d+) \] && \[ "\$bmin" -lt (\d+) \]; \}/.exec(inst);
    expect(i, 'install.sh lost its bash-floor predicate (or respelled it — update this pin WITH the spelling)').not.toBeNull();
    expect(i![1], 'install.sh compares two different majors').toBe(i![2]);
    const instFloor = `${i![1]}.${i![3]}`;

    // ccd/ccrc: [ maj -lt X+1 ] && { [ maj -lt X ] || [ min -lt Y ] }
    const c = /\[ "\$\{BASH_VERSINFO\[0\]:-0\}" -lt (\d+) \] \\\n\s*&& \{ \[ "\$\{BASH_VERSINFO\[0\]:-0\}" -lt (\d+) \] \|\| \[ "\$\{BASH_VERSINFO\[1\]:-0\}" -lt (\d+) \]; \}/.exec(ccrc);
    expect(c, 'ccd/ccrc lost its bash-floor predicate (or respelled it — update this pin WITH the spelling)').not.toBeNull();
    expect(Number(c![1]), 'ccrc\'s outer cap must be floor-major + 1 or the predicate means a different floor')
      .toBe(Number(c![2]) + 1);
    const ccrcFloor = `${c![2]}.${c![3]}`;

    expect(ccrcFloor, 'install.sh and ccd/ccrc refuse below DIFFERENT floors').toBe(instFloor);
    expect(readme, `README.md no longer states the bash ≥ ${instFloor} floor`)
      .toContain(`bash ≥ ${instFloor}`);
    // Both refusal messages must keep NAMING the floor they enforce.
    expect(inst).toContain(`ccd needs ${instFloor} or newer`);
    expect(ccrc).toContain(`ccd needs ${instFloor} or newer`);
  });
});

describe('ccrc update --check: what runs here vs what is published (spec §6)', () => {
  const parse = parseCheck;

  it('behind: an older version on the box, exit 1, SHA256SUMS fetched and nothing else, nothing written', () => {
    const home = freshUpdateBox('ccrc-update-check-behind-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const before = treeDigest(join(home, 'ccrc'));
    const r = runUpdate(home, ['--check']);
    expect(r.code).toBe(1);
    expect(parse(r.stdout)).toEqual({ box: 'v1.0.0', sha: 'oldsha0000000000000000000000000000000000', target: 'v2.0.0', caps: CAPS_NOW, floor: 'none', projection: 'not-configured', state: 'behind' });
    expect(r.stdout).toMatch(/^this box: v1\.0\.0 \(oldsha[0-9a-f]*\) · latest: v2\.0\.0 — behind$/m);
    expect(localUrls(home)).toEqual([`local://${home}/releases/latest/download/SHA256SUMS`]);
    expect(treeDigest(join(home, 'ccrc'))).toEqual(before);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
  });

  it('writes NOTHING under HOME (spec §11) — the whole home is byte-identical, not just the three places we thought to look', () => {
    // The three assertions above name places a write WE EXPECTED would land
    // (`~/ccrc`, `~/ccrc-backups`, the staged install's argv record). Spec
    // §11's claim is larger and nothing observed it: `--check` writes
    // nothing AT ALL. A recursive before/after listing is the observation —
    // it catches the write nobody predicted, which is the only kind that
    // matters here.
    //
    // Two exclusions, both the HARNESS writing rather than the verb: the
    // staging dir under `$TMPDIR` (which `updateEnv` puts at `<home>/tmp`,
    // update's own mktemp -d space, removed by its EXIT trap) and
    // `<home>/curl-argv`, the fixture curl's recording of the one fetch the
    // case above already pins.
    const home = freshUpdateBox('ccrc-update-check-writes-nothing-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    // `runUpdate` builds its environment on EVERY call, and building it
    // plants fixtures under HOME (`updateEnv`'s `fixture-graphify-pkg` and
    // its `ghContainedEnv` poison, then `replantDoctorStubs`' copies over
    // the top of it). Doing that once BEFORE the snapshot, IN RUNUPDATE'S
    // OWN ORDER, is what keeps this case measuring the VERB: both are
    // idempotent and byte-identical on the second call, so anything that
    // moves between the two listings below was written by `ccrc update
    // --check` itself. (The order matters — `replantDoctorStubs` is what
    // leaves `.local/bin/gh` as the doctor stub rather than the poison.)
    updateEnv(home);
    replantDoctorStubs(home);
    const before = homeSnapshot(home);
    const r = runUpdate(home, ['--check']);
    expect(r.code).toBe(1);
    expect(homeSnapshot(home)).toEqual(before);
  });

  it('writes NOTHING on a versioned box either — the ~/ccrc link, both kept versions and the stamp are unchanged (W6 Task 7)', () => {
    // The case above, on the layout W6 leaves a box in: `~/ccrc` a LINK into
    // `~/ccrc-versions/v9.9.1`, a second kept version beside it. `--to`, so
    // the target is named rather than resolved: this case measures what
    // `--check` WRITES, and `--to` never resolves the target from the projection (it is read only for `projection=`). The W6 guard
    // is an lstat, not a snapshot line, so the listing itself stays the only
    // thing under test.
    const home = freshUpdateBox('ccrc-update-check-writes-nothing-w6-');
    installVersionedTree(home, 'v9.9.1', { stamp: { sha: 'oldsha0000000000000000000000000000000000', version: 'v9.9.1' } });
    installVersionedTree(home, 'v9.9.0', { link: false, stamp: { sha: 'b'.repeat(40), version: 'v9.9.0' } });
    expect(lstatSync(join(home, 'ccrc')).isSymbolicLink(), 'the fixture is not a W6 box').toBe(true);
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'), shippedStamp('v9.9.1', 'oldsha0000000000000000000000000000000000'));
    writeFileSync(join(home, '.ccrc', 'installed'), 'oldsha0000000000000000000000000000000000\n');
    packRelease(home, stubTree(home, { version: 'v9.9.2' }), { tag: 'v9.9.2', latest: false });
    // `runUpdate`'s own environment plants, once, in its own order — the
    // reason is the case above's.
    updateEnv(home);
    replantDoctorStubs(home);
    const before = homeSnapshot(home);
    const r = runUpdate(home, ['--check', '--to', 'v9.9.2']);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stdout.split('\n')[0]).toMatch(/^check: box=v9\.9\.1 sha=\S+ target=v9\.9\.2 (.* )?state=behind$/);
    expect(homeSnapshot(home)).toEqual(before);
  });

  it('homeSnapshot records a regular file by its content digest: a rewrite to the same length is a difference (T2, final review)', () => {
    // The size-only line was the link's twin: a record rewritten to another
    // sha of the same length (`<sha>\n` is always 41 bytes) left the listing
    // byte-identical, so a "writes nothing" case passed over a rewritten file.
    const home = mkTmp('ccrc-update-snapshot-content-');
    mkdirSync(join(home, '.ccrc'));
    writeFileSync(join(home, '.ccrc', 'installed'), `${'a'.repeat(40)}\n`);
    const before = homeSnapshot(home);
    writeFileSync(join(home, '.ccrc', 'installed'), `${'b'.repeat(40)}\n`);
    expect(homeSnapshot(home)).not.toEqual(before);
    writeFileSync(join(home, '.ccrc', 'installed'), `${'a'.repeat(40)}\n`);
    expect(homeSnapshot(home), 'unchanged bytes read as unchanged').toEqual(before);
  });

  it('homeSnapshot records a link by its target: a flip between two same-length version names is a difference (W6 Task 7)', () => {
    // The harness's own pin. A symlink used to be a leaf recorded as
    // `<rel>\t<lstat size>`, and a link's lstat size is the LENGTH of its
    // target: `~/ccrc -> …/v9.9.1` and `~/ccrc -> …/v9.9.0` recorded the
    // SAME line, so a `--check` that flipped the box passed the case above.
    const home = mkTmp('ccrc-update-snapshot-link-');
    installVersionedTree(home, 'v9.9.1');
    installVersionedTree(home, 'v9.9.0', { link: false });
    const before = homeSnapshot(home);
    // The flip as `_plat_ln_swap` performs it: a staged link renamed over the old one.
    symlinkSync(join(home, 'ccrc-versions', 'v9.9.0'), join(home, 'ccrc.new'));
    renameSync(join(home, 'ccrc.new'), join(home, 'ccrc'));
    const after = homeSnapshot(home);
    expect(after).not.toEqual(before);
    expect(after).toContain(`ccrc -> ${join(home, 'ccrc-versions', 'v9.9.0')}`);
    expect(after.filter((l) => l.startsWith('ccrc-versions/v9.9.1/')).length,
      'the versions root was not walked on its own').toBeGreaterThan(0);
  });

  it('--check and --force are exclusive — one refusal, exit 2, nothing fetched', () => {
    // `--check` MEASURES; `--force` reinstalls a converged box. The check arm
    // returns before `--force` is ever read, so the pair used to mean "drop
    // the flag you also typed" in silence.
    const home = freshUpdateBox('ccrc-update-check-force-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home, ['--check', '--force']);
    expect(r.code, `stdout: ${r.stdout}`).toBe(2);
    expect(r.stderr).toMatch(/--check and --force are exclusive/);
    // Before anything is fetched: the refusal is an argument-surface one.
    expect(existsSync(join(home, 'curl-argv')), 'a fetch ran before the refusal').toBe(false);
  });

  it('current: same version AND the completed-install record names the stamped sha, exit 0', () => {
    const home = freshUpdateBox('ccrc-update-check-current-');
    plantOldBox(home, { version: 'v2.0.0' });
    writeFileSync(join(home, '.ccrc', 'installed'), 'oldsha0000000000000000000000000000000000\n');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home, ['--check']);
    expect(r.code, r.stderr).toBe(0);
    expect(parse(r.stdout).state).toBe('current');
    expect(r.stdout).toMatch(/— current$/m);
  });

  it('incomplete: same version but no (or a stale) completed-install record, exit 1 — rollout must not skip it', () => {
    const home = freshUpdateBox('ccrc-update-check-incomplete-');
    plantOldBox(home, { version: 'v2.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    let r = runUpdate(home, ['--check']);
    expect(r.code).toBe(1);
    expect(parse(r.stdout).state).toBe('incomplete');
    writeFileSync(join(home, '.ccrc', 'installed'), 'stalesha00000000000000000000000000000000\n');
    r = runUpdate(home, ['--check']);
    expect(parse(r.stdout).state).toBe('incomplete');
  });

  it('unversioned: a deploy.sh stamp (no version), exit 1, and --to labels the target', () => {
    const home = freshUpdateBox('ccrc-update-check-unversioned-');
    plantOldBox(home);
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'),
      '{"sha":"deploysha0000000000000000000000000000000","ref":"HEAD","builtAt":"2026-09-17T17:16:09Z","dirty":false}\n');
    packRelease(home, stubTree(home, { version: 'v1.0.0' }), { tag: 'v1.0.0', latest: false });
    const r = runUpdate(home, ['--check', '--to', 'v1.0.0']);
    expect(r.code).toBe(1);
    expect(parse(r.stdout)).toEqual({ box: 'unversioned', sha: 'deploysha0000000000000000000000000000000', target: 'v1.0.0', caps: CAPS_NOW, floor: 'none', projection: 'not-configured', state: 'unversioned' });
    expect(r.stdout).toMatch(/^this box: unversioned \(deploysha[0-9a-f]*\) · target: v1\.0\.0 — a release install would be the first on this box$/m);
    expect(localUrls(home)).toEqual([`local://${home}/releases/download/v1.0.0/SHA256SUMS`]);
  });

  it('unstamped: no build.json at all reads as unversioned with sha=none', () => {
    const home = freshUpdateBox('ccrc-update-check-unstamped-');
    plantOldBox(home);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    const r = runUpdate(home, ['--check']);
    expect(r.code).toBe(1);
    expect(parse(r.stdout)).toMatchObject({ box: 'unversioned', sha: 'none', state: 'unversioned' });
  });

  // W4 Task 12 (plan D-3232), plus `projection=` (fix round 1 item 22 /
  // review 155, your Q8): every field rollout reads sits BEFORE state=,
  // because rollout takes state as everything after the LAST `state=`.
  it('the machine line is box, sha, target, caps, floor, projection, state — in that order, state last', () => {
    const home = freshUpdateBox('ccrc-update-check-fields-');
    plantOldBox(home, { version: 'v1.0.0' });
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--check', '--to', 'v2.0.0']);
    expect(r.code, r.stderr).toBe(1);
    // No role/timer/intent planted: this box's projection reads
    // not-configured, same word `ccrc channel` would print for it.
    expect(checkLine(r.stdout)).toBe(
      `check: box=v1.0.0 sha=oldsha0000000000000000000000000000000000 target=v2.0.0 caps=${CAPS_NOW} floor=none projection=not-configured state=behind`);
  });

  // Plan D-3248: `--check` is answered by the
  // running ccrc, so it prints `_ccrc_cap_words`, never the file.
  it('caps= is what the RUNNING ccrc can do, never the file — a stale ~/.ccrc/ccrc-caps does not narrow it, and --check leaves it alone', () => {
    const home = freshUpdateBox('ccrc-update-check-caps-');
    plantOldBox(home, { version: 'v1.0.0' });
    writeFileSync(join(home, '.ccrc', 'ccrc-caps'), 'os plan9\nverify\n');
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--check', '--to', 'v2.0.0']);
    expect(parse(r.stdout).caps).toBe(CAPS_NOW);
    expect(readFileSync(join(home, '.ccrc', 'ccrc-caps'), 'utf8')).toBe('os plan9\nverify\n');
  });

  it('floor= answers what the install path would read — none, the tag, malformed — and --check never refuses on it', () => {
    const cases: Array<[string | null, string]> = [[null, 'none'], ['v1.0.0', 'v1.0.0'], ['three', 'malformed']];
    for (const [content, word] of cases) {
      const home = freshUpdateBox(`ccrc-update-check-floorword-${word}-`);
      plantOldBox(home, { version: 'v1.0.0' });
      if (content !== null) writeFileSync(join(home, '.ccrc', 'floor'), `${content}\n`);
      packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
      const r = runUpdate(home, ['--check', '--to', 'v2.0.0']);
      expect(r.code, `${word}: ${r.stderr}`).toBe(1);
      expect(parse(r.stdout)).toMatchObject({ floor: word, state: 'behind' });
      expect(r.stderr, word).toBe('');
      expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    }
  });

  // F2 (fix round 1): the malformed note itself was asserted by no case
  // (only unreadable's, which skips as root) — and the brief's own `read …
  // || floor=""` clause says a floor line with no trailing newline is
  // malformed too, on both paths.
  it('a malformed floor (garbage, or a tag with no trailing newline) prints its own note, never the unreadable one', () => {
    const cases: Array<[string, string]> = [['three\n', 'garbage'], ['v3.0.0', 'no trailing newline']];
    for (const [content, why] of cases) {
      const home = freshUpdateBox(`ccrc-update-check-floorword-malformed-${why.replace(/\s+/g, '-')}-`);
      plantOldBox(home, { version: 'v1.0.0' });
      writeFileSync(join(home, '.ccrc', 'floor'), content);
      packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
      const r = runUpdate(home, ['--check', '--to', 'v2.0.0']);
      expect(r.code, why).toBe(1);
      expect(parse(r.stdout), why).toMatchObject({ floor: 'malformed', state: 'behind' });
      expect(r.stdout, why).toMatch(/^this box's floor \(~\/\.ccrc\/floor\) is malformed — 'ccrc update' refuses until it is fixed by hand$/m);
      expect(r.stdout, why).not.toMatch(/floor.*is unreadable/);
    }
  });

  it.skipIf(process.getuid?.() === 0)('an unreadable floor reads floor=unreadable — its own word, never folded into none or malformed', () => {
    const home = freshUpdateBox('ccrc-update-check-floorword-unreadable-');
    plantOldBox(home, { version: 'v1.0.0' });
    writeFileSync(join(home, '.ccrc', 'floor'), 'v3.0.0\n');
    chmodSync(join(home, '.ccrc', 'floor'), 0o000);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0', latest: false });
    const r = runUpdate(home, ['--check', '--to', 'v2.0.0']);
    expect(r.code).toBe(1);
    expect(parse(r.stdout)).toMatchObject({ floor: 'unreadable', state: 'behind' });
    expect(r.stdout).toMatch(/^this box's floor \(~\/\.ccrc\/floor\) is unreadable — 'ccrc update' refuses until it is fixed by hand$/m);
  });
});

describe('ccrc update: the "already there" gate (spec §5)', () => {
  const converged = (prefix: string): string => {
    const home = freshUpdateBox(prefix);
    plantOldBox(home, { version: 'v2.0.0' });
    plantCoordDb(home);
    // The stub release's stamp sha is what stubTree writes: newsha…; the box
    // must carry the SAME sha for the gate's second comparison to hold.
    writeFileSync(join(home, '.ccrc', 'build.json'),
      '{"sha":"newsha0000000000000000000000000000000000","ref":"release","builtAt":"2026-08-21T00:00:00Z","dirty":false,"version":"v2.0.0"}\n');
    writeFileSync(join(home, '.ccrc', 'installed'), 'newsha0000000000000000000000000000000000\n');
    // EVERYTHING A SWEEP NEEDS, so that "NO sweep" below is a statement
    // about the GATE. Without the KillMode=process drop-in the preflight
    // refuses the sweep on its own, so deleting the gate would leave the
    // recording just as free of `try-restart` — the assertion would be
    // green for a reason that has nothing to do with what it claims to
    // pin. With the drop-in planted and two live units enumerated, an
    // un-gated run DOES record `--user try-restart claude-session@*`
    // (measured: see the plan's mutation table).
    plantKillModeDropIn(home);
    writeFileSync(join(home, 'fixture-sweep-units'), UNIT_LINES);
    writeFileSync(join(home, 'fixture-sweep-active'), UNIT_LINES);
    packRelease(home, stubTree(home, { version: 'v2.0.0' }), { tag: 'v2.0.0' });
    return home;
  };

  it('three matching shas → nothing to do: exit 0, tarball verified, NO backup, NO install, NO sweep', () => {
    const home = converged('ccrc-update-gate-skip-');
    const r = runUpdate(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^update: this box already runs v2\.0\.0 \(newsha[0-9a-f]*\) and that install completed — nothing to do \(pass --force to reinstall\)$/m);
    // All three fetches happened (the gate's exact stage reads the staged
    // stamp, so fetch + verify runs before the gate returns)…
    expect(localUrls(home)).toEqual([
      `local://${home}/releases/latest/download/SHA256SUMS`,
      `local://${home}/releases/latest/download/ccrc-v2.0.0.tar.gz`,
      `local://${home}/releases/latest/download/ccrc-v2.0.0.tar.gz.sigstore.json`,
    ]);
    // …and nothing after them.
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
    const calls = existsSync(join(home, 'systemctl-calls')) ? readFileSync(join(home, 'systemctl-calls'), 'utf8') : '';
    expect(calls).not.toMatch(/try-restart|restart/);
  });

  it('--force skips the gate: the same box installs and sweeps', () => {
    const home = converged('ccrc-update-gate-force-');
    const r = runUpdate(home, ['--force']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).not.toMatch(/nothing to do/);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(true);
  });

  // THE CONTROL FOR THE "NO SWEEP" ASSERTION ABOVE. An absence proves nothing
  // unless the same fixture can produce the presence: the skip case's
  // `expect(calls).not.toMatch(/try-restart/)` was vacuous while `converged()`
  // planted no KillMode=process drop-in, because the preflight would have
  // refused the sweep with the gate deleted too. This case runs the IDENTICAL
  // fixture, differing only by `--force`, and measures the try-restart the
  // skip case says is absent. Linux-only because it names systemd's argv;
  // the launchd siblings live in the sweep describe above.
  itLinux('…and on that same fixture the sweep really does try-restart — so the skip case\'s "no sweep" is a real absence', () => {
    const home = converged('ccrc-update-gate-force-sweeps-');
    const r = runUpdate(home, ['--force']);
    expect(r.code, r.stderr).toBe(0);
    const calls = readFileSync(join(home, 'systemctl-calls'), 'utf8');
    expect(calls).toMatch(/--user try-restart claude-session@\*/);
  });

  it('same version, record absent → proceeds', () => {
    const home = converged('ccrc-update-gate-norecord-');
    rmSync(join(home, '.ccrc', 'installed'));
    const r = runUpdate(home);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(true);
  });

  it('same version, record names an older sha → proceeds', () => {
    const home = converged('ccrc-update-gate-stale-');
    writeFileSync(join(home, '.ccrc', 'installed'), 'oldsha0000000000000000000000000000000000\n');
    const r = runUpdate(home);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(true);
  });

  it('same version, the RELEASE carries a different sha (a moved tag) → proceeds', () => {
    const home = converged('ccrc-update-gate-moved-');
    writeFileSync(join(home, '.ccrc', 'build.json'),
      '{"sha":"boxsha00000000000000000000000000000000000","ref":"release","builtAt":"2026-08-21T00:00:00Z","dirty":false,"version":"v2.0.0"}\n');
    writeFileSync(join(home, '.ccrc', 'installed'), 'boxsha00000000000000000000000000000000000\n');
    const r = runUpdate(home);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(true);
  });

  it('a different version never consults the record', () => {
    const home = converged('ccrc-update-gate-differs-');
    writeFileSync(join(home, '.ccrc', 'build.json'),
      '{"sha":"newsha0000000000000000000000000000000000","ref":"release","builtAt":"2026-08-21T00:00:00Z","dirty":false,"version":"v1.0.0"}\n');
    const r = runUpdate(home);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(true);
  });
});

describe('ccrc update: the tag is bound (design §5, decision 4)', () => {
  it('--to v0.0.9 against a SHA256SUMS naming ccrc-v0.0.3.tar.gz refuses BEFORE any backup, tag to tag (§18 "the tag is bound before backup")', () => {
    const home = freshUpdateBox('ccrc-update-bind-sums-');
    plantOldBox(home, { version: 'v0.0.1' });
    packRelease(home, stubTree(home, { version: 'v0.0.3' }), { tag: 'v0.0.9', latest: false, asName: 'ccrc-v0.0.3.tar.gz' });
    const r = runUpdate(home, ['--to', 'v0.0.9']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/the release at v0\.0\.9 names a ccrc-v0\.0\.3\.tar\.gz \(version v0\.0\.3, not v0\.0\.9\) — refusing/);
    expect(localUrls(home)).toEqual([`local://${home}/releases/download/v0.0.9/SHA256SUMS`]);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
  });

  it('--to v0.0.9 against a SHA256SUMS naming ccrc-v0.0.9.tar.gz proceeds — the comparison never strips a side', () => {
    const home = freshUpdateBox('ccrc-update-bind-ok-');
    plantOldBox(home, { version: 'v0.0.1' });
    packRelease(home, stubTree(home, { version: 'v0.0.9' }), { tag: 'v0.0.9', latest: false });
    const r = runUpdate(home, ['--to', 'v0.0.9']);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
  });

  it('an extracted build.json whose version is not the resolved one refuses; nothing installed (§18 "the extracted version is bound")', () => {
    const home = freshUpdateBox('ccrc-update-bind-stamp-');
    plantOldBox(home, { version: 'v0.0.1' });
    const before = treeDigest(join(home, 'ccrc'));
    packRelease(home, stubTree(home, { version: 'v2.0.1' }), { tag: 'v2.0.0' });
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/the extracted tree's build\.json says version 'v2\.0\.1' but the release was resolved as v2\.0\.0 — refusing/);
    expect(treeDigest(join(home, 'ccrc'))).toEqual(before);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
  });
});

// D-3148 (pre-existing, stage 4; fixed here as a revertable scope
// expansion, its own commit): `_upd_resolve`'s shape check on the tarball
// name SHA256SUMS carries is a glob (`ccrc-*.tar.gz`), which a traversing
// name like `ccrc-x/../../../../evil.tar.gz` satisfies — and
// `curl -o "$UPD_STAGE/$UPD_TARNAME"` would create or clobber that path
// BEFORE any checksum or provenance check. Hand-crafted, not via
// `packRelease`/`asName`, because that helper's `tar -czf`/`sha256sum`
// pipeline would itself try to create a file at the traversing path on the
// HOST filesystem — a fixture hazard, not the subject under test.
describe('ccrc update: the tarball name is bounded — no path separator (D-3148)', () => {
  it('a SHA256SUMS naming a traversing tarball path refuses before any tarball fetch, and creates nothing outside the staging dir', () => {
    const home = freshUpdateBox('ccrc-update-tarname-traversal-');
    plantOldBox(home, { version: 'v1.0.0' });
    const relDir = join(home, 'releases', 'latest', 'download');
    mkdirSync(relDir, { recursive: true });
    const traversalName = 'ccrc-x/../../../../evil.tar.gz';
    writeFileSync(join(relDir, 'SHA256SUMS'), `${'a'.repeat(64)}  ${traversalName}\n`);
    const r = runUpdate(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/SHA256SUMS names a tarball with a path separator \(got: ccrc-x\/\.\.\/\.\.\/\.\.\/\.\.\/evil\.tar\.gz\) — refusing/);
    // Only the SHA256SUMS fetch happened — never a fetch of the tarball itself.
    expect(localUrls(home)).toEqual([`local://${home}/releases/latest/download/SHA256SUMS`]);
    expect(existsSync(join(home, 'evil.tar.gz'))).toBe(false);
    expect(existsSync(join(home, 'ccrc-backups'))).toBe(false);
    expect(existsSync(join(home, 'staged-ccrc-argv'))).toBe(false);
  });
});

// R20a (centralised-update wave 13): each test's fixture homes go in a root `afterEach`, not all at once in the
// file's `afterAll`. Measured at 9221416a: the three parts of this file leave 648 homes, about 99,700 entries and
// 2.47 GB to that one hook, which overran vitest's 20 s hook timeout on CI shards at 670d25fd and 7b0a5454. It sits
// at the END of the file so no line above moves: a top-level hook registers on the root suite wherever it is
// written, because vitest collects the whole file before it runs a test.
removeTmpFixturesEachTest();

