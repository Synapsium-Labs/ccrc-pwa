// `ccrc install`, part 3 of the ccrc-install-*.test.ts family (D-6767): migration, the build stamp, the units and the
// launchd job. Shared fixtures and the original file header live in ccrc-installFixture.ts.
// LOAD-TIME INSTALLS in this file: `units` (the describeLinux block, whose body also runs on macOS) and `box` (the
// describeDarwin launchd block, whose body also runs on Linux).
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync, rmSync, symlinkSync, utimesSync, lstatSync, readlinkSync, realpathSync } from 'node:fs';
import path, { join } from 'node:path';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { describeLinux, describeDarwin, itLinux } from './platformFixtures.js';
import { installFixtureTree, installVersionedTree } from './installTreeFixture.js';
import { plantFakeRuntime } from './codexLaneFixture.js';
import { plantNvm, here, REPO, realPath, BASH, treeRoot, ccrcIn, treeFile, placed, freshBox, ccrcEnv, runInstall, runLauncherVersion, pathWithout, read, dotCcrc, preexisting, gitInit, unitDir, SLICE_DIR, UNIT_FILES, systemctlCalls, FLEET_URL, FLEET_TOKEN, runInstallTty, type Result } from './ccrc-installFixture.js';

removeTmpFixturesEachTest();

describe('ccrc install: the one-time migration and its crash recovery (W6 Task 3)', () => {
  // A box installed before versioned installs has a REAL directory at
  // `~/ccrc`. The first W6 install places the incoming tree FULLY at
  // `~/ccrc-versions/<name>`, moves the directory aside to `~/ccrc.migrating`
  // and links `~/ccrc` in its place — two syscalls, once per node (spec §11).
  // The old tree goes only after a gate has passed: a plain install's own
  // doctor while `~/.ccrc/update.lock` is FREE, an updater's `_upd_gate`
  // otherwise (D-3431). A crash inside the window is
  // completed FIRST by the next run, from `~/.ccrc/migrating-to` alone.
  const holders: ChildProcess[] = [];
  afterEach(() => {
    for (const h of holders.splice(0)) h.kill('SIGKILL');
  });
  const REAL_LN = realPath('ln');
  const lockPath = (home: string): string => dotCcrc(home, 'update.lock');
  /** A FRESH open and a non-blocking flock — wave 4's probe, from outside. */
  const lockFree = (home: string): boolean =>
    spawnSync(BASH, ['-c', 'exec 9>>"$1" && flock -n 9', '_', lockPath(home)]).status === 0;
  const waitUntil = (cond: () => boolean, what: string): void => {
    const t0 = Date.now();
    while (!cond()) {
      if (Date.now() - t0 > 10_000) throw new Error(`timed out waiting for ${what}`);
      spawnSync('sleep', ['0.05']);
    }
  };
  /** Wave 4's real holder: ONE process takes the flock and then becomes
   *  `sleep` (exec keeps the pid and the descriptor), so the pid killed is
   *  the pid holding it. Returns once a fresh probe fails. */
  const holdLock = (home: string): ChildProcess => {
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    const h = spawn(BASH, ['-c', 'exec 9>>"$1" && flock 9 && exec sleep 30', '_', lockPath(home)], { stdio: 'ignore' });
    holders.push(h);
    waitUntil(() => !lockFree(home), 'the fixture holder to take the lock');
    return h;
  };
  /** lstat, never stat: an absent or dangling `~/ccrc` must read `absent`,
   *  and a link must read as the link it is, not as its target. */
  const lkind = (p: string): 'absent' | 'link' | 'dir' | 'other' => {
    try {
      const st = lstatSync(p);
      return st.isSymbolicLink() ? 'link' : st.isDirectory() ? 'dir' : 'other';
    } catch { return 'absent'; }
  };
  /** Every entry under `dir`, relative path → its bytes — "byte-identical"
   *  as a value two listings can be compared by. */
  const treeBytes = (dir: string): Record<string, string> => {
    const out: Record<string, string> = {};
    const walk = (d: string, prefix: string): void => {
      for (const e of readdirSync(d).sort()) {
        const p = join(d, e);
        const rel = prefix === '' ? e : `${prefix}/${e}`;
        const st = lstatSync(p);
        if (st.isSymbolicLink()) out[rel] = `link:${readlinkSync(p)}`;
        else if (st.isDirectory()) { out[`${rel}/`] = 'dir'; walk(p, rel); }
        else out[rel] = readFileSync(p).toString('base64');
      }
    };
    walk(dir, '');
    return out;
  };
  /** Makes this box's doctor FAIL on a check no install step touches — the
   *  per-platform lever `a box doctor fails on exits 1` uses. */
  const failDoctor = (home: string): void => {
    if (process.platform === 'darwin') {
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      writeFileSync(join(home, '.ccrc', 'exposure.env'),
        'CCRC_ORIGIN=https://box.example.com\nCCRC_RP_ID=box.example.com\nCCRC_AUTH=on\n', { mode: 0o644 });
    } else {
      writeFileSync(join(home, 'fixture-linger-refuse'), 'yes\n');
    }
  };
  const healDoctor = (home: string): void => {
    rmSync(join(home, '.ccrc', 'exposure.env'), { force: true });
    rmSync(join(home, 'fixture-linger-refuse'), { force: true });
  };
  const migrating = (home: string): string => join(home, 'ccrc.migrating');
  /** A box with a PRE-W6 install: a real `~/ccrc` directory (with a marker
   *  file of its own), and a checkout that is a real one-commit repository,
   *  so the incoming tree's name is `untagged-<sha12>` — known in advance. */
  const preW6Box = (prefix: string): { home: string; name: string; before: Record<string, string> } => {
    const home = freshBox(prefix);
    const sha = gitInit(treeRoot(home));
    installFixtureTree(home, 'ccrc');
    writeFileSync(placed(home, 'OLD-MARKER'), 'the pre-versioned tree\n');
    return { home, name: `untagged-${sha.slice(0, 12)}`, before: treeBytes(placed(home)) };
  };
  const RESUMED = (name: string): string =>
    `install: tree: completed a crashed migration — $HOME/ccrc was absent beside $HOME/ccrc.migrating; linked to $HOME/ccrc-versions/${name} (named by ~/.ccrc/migrating-to)`;
  const REMOVED = 'install: migration: $HOME/ccrc.migrating removed — ccrc doctor passed; a plain install is its own gate';
  /** An `ln` that does `act` ONCE — to the first `ln` whose last argument is
   *  `~/ccrc`, the migration's link, while `$HOME/<knob>` exists, removing
   *  the knob first — and is the real `ln` for everything else. */
  const lnOnce = (knob: string, act: string): string => '#!/bin/sh\n'
    + 'for last in "$@"; do :; done\n'
    + `if [ "$last" = "$HOME/ccrc" ] && [ -f "$HOME/${knob}" ]; then rm -f "$HOME/${knob}"; ${act}; fi\n`
    + `exec ${REAL_LN} "$@"\n`;

  it('a doctor that FAILS keeps ~/ccrc.migrating byte for byte, beside its marker — and the next install whose doctor passes removes both (§18 "the migration keeps the old tree until the gate")', () => {
    const { home, name, before } = preW6Box('ccrc-install-migrate-doctor-fail-');
    failDoctor(home);
    let r = runInstall(home);
    expect(r.code, 'the lever did not make doctor fail — the keep below would be vacuous').toBe(1);
    expect(readlinkSync(placed(home))).toBe(join(home, 'ccrc-versions', name));
    expect(treeBytes(migrating(home))).toEqual(before);
    expect(read(dotCcrc(home, 'migrating-to'))).toBe(`${name}\n`);
    expect(r.stdout).toMatch(/^install: migration: \$HOME\/ccrc\.migrating kept — ccrc doctor did not pass; the next install or update whose gate passes removes it$/m);
    expect(r.stdout.split('\n')).not.toContain(REMOVED);
    // THE CONTROL: the same box with its doctor healed — the directory goes.
    healDoctor(home);
    r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.split('\n')).toContain(REMOVED);
    expect(lkind(migrating(home))).toBe('absent');
    expect(existsSync(dotCcrc(home, 'migrating-to'))).toBe(false);
    expect(readlinkSync(placed(home))).toBe(join(home, 'ccrc-versions', name));
  });

  it('a spine run while ~/.ccrc/update.lock is held is a STAGED spine: its doctor passing is not the gate, so ~/ccrc.migrating stays for the updater\'s gate to decide (D-3431)', () => {
    const { home } = preW6Box('ccrc-install-migrate-lock-held-');
    const h = holdLock(home);
    let r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^install: migration: \$HOME\/ccrc\.migrating kept — an update holds ~\/\.ccrc\/update\.lock, and its health gate decides$/m);
    expect(lkind(migrating(home))).toBe('dir');
    expect(lockFree(home), 'the install took, or broke, a lock it did not hold').toBe(false);
    // THE CONTROL: the holder gone, the identical install is its own gate.
    h.kill('SIGKILL');
    waitUntil(() => lockFree(home), 'the fixture holder to release the lock');
    r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.split('\n')).toContain(REMOVED);
    expect(lkind(migrating(home))).toBe('absent');
    expect(lockFree(home), 'the install left ~/.ccrc/update.lock held').toBe(true);
  });

  it('a crash inside the two-syscall window leaves exactly ~/ccrc.migrating and ~/.ccrc/migrating-to; the next install, run by the placed version\'s own path, links it BEFORE its banner (§18 "a crashed migration is completed first")', () => {
    const { home, name, before } = preW6Box('ccrc-install-migrate-crash-');
    const vdir = join(home, 'ccrc-versions', name);
    writeFileSync(join(home, 'fixture-ln-crash'), 'yes\n');
    // The migration's `ln -sn` runs in ccrc's OWN shell, so $PPID is the run.
    const lnStub = '#!/bin/sh\n'
      + 'printf \'%s\\n\' "$*" >> "$HOME/ln-argv"\n'
      + 'for last in "$@"; do :; done\n'
      + 'if [ "$last" = "$HOME/ccrc" ] && [ -f "$HOME/fixture-ln-crash" ]; then kill -KILL "$PPID"; exit 1; fi\n'
      + `exec ${REAL_LN} "$@"\n`;
    let r = runInstall(home, ['install'], {}, { stubs: { ln: lnStub } });
    expect(r.code, 'the run was not killed inside the window (-1 is the runner\'s null status)').toBe(-1);
    expect(r.stdout.split('\n')).toContain(`install: tree: migrating — $HOME/ccrc is a directory; ${name} is complete at $HOME/ccrc-versions/${name}`);
    // The link is placed with -n (D-3434).
    const lnCalls = read(join(home, 'ln-argv')).trim().split('\n');
    expect(lnCalls[lnCalls.length - 1]).toBe(`-sn -- ${vdir} ${placed(home)}`);
    // Exactly the crash pair: the old tree aside, the marker, the new version
    // FULLY placed before the window opened — and no ~/ccrc at all.
    expect(lkind(placed(home))).toBe('absent');
    expect(treeBytes(migrating(home))).toEqual(before);
    expect(read(dotCcrc(home, 'migrating-to'))).toBe(`${name}\n`);
    expect(existsSync(join(vdir, 'ccd', 'ccrc'))).toBe(true);
    expect(existsSync(join(vdir, 'server', 'node_modules')), 'the version was not placed FULLY before the window').toBe(true);
    // THE COMPLETION: disarmed, and run by the path the die sentence names
    // (the launcher shim cannot run with no ~/ccrc).
    rmSync(join(home, 'fixture-ln-crash'));
    r = runInstall(home, ['install'], {}, { from: join(vdir, 'ccd', 'ccrc') });
    expect(r.code, r.stderr).toBe(0);
    const lines = r.stdout.split('\n');
    expect(lines[0], 'the link was not completed FIRST').toBe(RESUMED(name));
    expect(lines[1]).toBe(`install: box: ${home}`);
    expect(readlinkSync(placed(home))).toBe(vdir);
    // A placed version installing from itself copies nothing (Task 2's (a)).
    expect(lines).toContain('install: tree: already running from $HOME/ccrc');
    expect(lines).toContain(REMOVED);
    expect(lkind(migrating(home))).toBe('absent');
  });

  it('the resume links what ~/.ccrc/migrating-to names — never a guess such as the newest directory (D-3432)', () => {
    const home = freshBox('ccrc-install-migrate-marker-');
    installFixtureTree(home, 'ccrc.migrating');
    const kept = installVersionedTree(home, 'v1.0.0', { link: false });
    // NEWER and incomplete: the directory a crashed run could have been
    // half-way through placing when it died.
    const newer = installVersionedTree(home, 'v9.9.9', { link: false, complete: false });
    utimesSync(kept, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
    utimesSync(newer, new Date(), new Date());
    preexisting(home, 'migrating-to', 'v1.0.0\n');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.split('\n')[0]).toBe(RESUMED('v1.0.0'));
    expect(lkind(placed(home))).toBe('link');
  });

  const refusals: Array<[string, string | null, string]> = [
    ['is absent', null, 'is absent'],
    ['names a version nobody placed', 'v7.7.7\n', 'does not name a placed version'],
    ['is not a version name at all', '../../etc\n', 'does not name a placed version'],
  ];
  it.each(refusals)('a crash pair whose ~/.ccrc/migrating-to %s is REFUSED before the banner, with both by-hand remedies, and nothing is changed', (_label, marker, says) => {
    const home = freshBox('ccrc-install-migrate-refused-');
    installFixtureTree(home, 'ccrc.migrating');
    installVersionedTree(home, 'v1.0.0', { link: false });
    if (marker !== null) preexisting(home, 'migrating-to', marker);
    const before = treeBytes(migrating(home));
    const r = runInstall(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`ccrc: a migration of $HOME/ccrc crashed and ~/.ccrc/migrating-to ${says} — nothing was changed. To go back: mv $HOME/ccrc.migrating $HOME/ccrc — or, to go forward: ln -s $HOME/ccrc-versions/<name> $HOME/ccrc`);
    expect(r.stdout, 'a step ran past the refusal').not.toMatch(/^install: /m);
    expect(lkind(placed(home))).toBe('absent');
    expect(treeBytes(migrating(home))).toEqual(before);
  });

  it('a lock that cannot be MEASURED is neither free nor held: ~/ccrc.migrating is kept with its own sentence even though the doctor passed (ruling R16)', () => {
    const { home, name } = preW6Box('ccrc-install-migrate-lock-unmeasured-');
    // A DIRECTORY at the lock path: the open fails whatever the uid (wave 4
    // Task 3's idiom), so `_ver_lock_try` answers 3.
    mkdirSync(lockPath(home), { recursive: true });
    const r = runInstall(home);
    // Measured red first (Step 4): if the directory also moved the doctor's
    // verdict, the keep below would be the doctor's, not the lock arm's.
    expect(r.code, `the doctor must pass here — ${r.stderr}`).toBe(0);
    expect(readlinkSync(placed(home))).toBe(join(home, 'ccrc-versions', name));
    expect(r.stdout).toMatch(/^install: migration: \$HOME\/ccrc\.migrating kept — ~\/\.ccrc\/update\.lock could not be taken or measured \(unmeasured\), so no gate is known to have passed$/m);
    expect(r.stdout.split('\n')).not.toContain(REMOVED);
    expect(lkind(migrating(home))).toBe('dir');
  });

  it('a link that cannot be placed moves ~/ccrc BACK: the pre-versioned directory byte for byte, no marker, the version complete — never a crash pair left for an updater to complete (D-3436)', () => {
    const { home, name, before } = preW6Box('ccrc-install-migrate-ln-fail-');
    const vdir = join(home, 'ccrc-versions', name);
    const stub = lnOnce('fixture-ln-fail-once', 'echo "ln: fixture refusal" >&2; exit 1');
    writeFileSync(join(home, 'fixture-ln-fail-once'), 'yes\n');
    let r = runInstall(home, ['install'], {}, { stubs: { ln: stub } });
    expect(existsSync(join(home, 'fixture-ln-fail-once')), 'the refusal never fired').toBe(false);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`ccrc: $HOME/ccrc could not be linked to $HOME/ccrc-versions/${name}, so it was moved back — nothing moved; $HOME/ccrc is still the directory it was, and ${name} is complete at $HOME/ccrc-versions/${name}`);
    expect(lkind(placed(home))).toBe('dir');
    expect(treeBytes(placed(home))).toEqual(before);
    expect(lkind(migrating(home))).toBe('absent');
    expect(lkind(dotCcrc(home, 'migrating-to'))).toBe('absent');
    expect(existsSync(join(vdir, 'ccd', 'ccrc'))).toBe(true);
    // THE CONTROL: the knob is spent, so the identical install migrates.
    r = runInstall(home, ['install'], {}, { stubs: { ln: stub } });
    expect(r.code, r.stderr).toBe(0);
    expect(readlinkSync(placed(home))).toBe(vdir);
    expect(r.stdout.split('\n')).toContain(REMOVED);
  });

  it('a link nested INSIDE a real directory that appeared at ~/ccrc is refused by the [ -L ] check, never reported as placed (D-3434)', () => {
    const { home, name } = preW6Box('ccrc-install-migrate-ln-nest-');
    writeFileSync(join(home, 'fixture-ln-nest-once'), 'yes\n');
    const r = runInstall(home, ['install'], {}, { stubs: { ln: lnOnce('fixture-ln-nest-once', 'mkdir -p "$HOME/ccrc"') } });
    expect(existsSync(join(home, 'fixture-ln-nest-once')), 'the stub never fired').toBe(false);
    // The real `ln -sn` nested the link and exited 0 — the shape `-n` cannot
    // refuse. Without it the case would be vacuous.
    expect(lkind(join(placed(home), name)), 'the real ln did not nest').toBe('link');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('ccrc: $HOME/ccrc was moved to $HOME/ccrc.migrating but the link could not be placed');
    expect(r.stdout.split('\n')).not.toContain(`install: tree: $HOME/ccrc -> $HOME/ccrc-versions/${name} (the pre-versioned tree is kept at $HOME/ccrc.migrating until a health gate passes)`);
    // The move back cannot replace the non-empty directory now standing at
    // ~/ccrc, so the old tree stays aside, whole.
    expect(lkind(migrating(home))).toBe('dir');
  });

  it('_inst_migrate re-measures the layout before it moves anything: a ~/ccrc that stopped being a directory while the version was placed is refused, and nothing moves (its step 0)', () => {
    const home = freshBox('ccrc-install-migrate-changed-');
    const v1 = installVersionedTree(home, 'v1.0.0');   // ~/ccrc is a LINK now
    installVersionedTree(home, 'v2.0.0', { link: false });
    const r = spawnSync(BASH, ['-c', '. "$1"; _inst_migrate v2.0.0', '_', ccrcIn(treeRoot(home))],
      { env: ccrcEnv(home), encoding: 'utf8' });
    expect(r.status, r.stdout).toBe(1);
    expect(r.stderr).toContain('ccrc: $HOME/ccrc changed while this run placed v2.0.0 (it now reads linked) — nothing moved; v2.0.0 is complete at $HOME/ccrc-versions/v2.0.0');
    expect(readlinkSync(placed(home))).toBe(v1);
    expect(lkind(migrating(home))).toBe('absent');
    expect(lkind(dotCcrc(home, 'migrating-to'))).toBe('absent');
  });
});

describe('ccrc install: workspace build-artifact excludes (_inst_ws_build_excludes)', () => {
  it('converges node_modules/cdk.out into a project AND its worktree, ignoring a node_modules SYMLINK there', () => {
    const home = freshBox('ccrc-install-ws-excl-');
    const repoA = join(home, 'projects', 'repoA');
    mkdirSync(repoA, { recursive: true });
    writeFileSync(join(repoA, 'a.txt'), 'x\n');
    gitInit(repoA);
    const ws1 = join(home, 'worktrees', 'repoA', 'ws1');
    mkdirSync(join(home, 'worktrees', 'repoA'), { recursive: true });
    const wtAdd = spawnSync('git', ['-C', repoA, 'worktree', 'add', ws1, '-b', 'ws1'], { encoding: 'utf8' });
    expect(wtAdd.status, wtAdd.stderr).toBe(0);

    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(
      /^install: workspace: build-artifact excludes converged \(node_modules, cdk\.out; \d+ new\)$/m);

    // EXACT LINES, for the reason ccd-workspaces.test.ts states beside its own
    // copy: a substring assertion is satisfied by the trailing-slash spelling,
    // which IS the bug. The absence pin is the half that reds on a regression.
    const excludeFile = join(repoA, '.git', 'info', 'exclude');
    const excl = readFileSync(excludeFile, 'utf8').split('\n');
    expect(excl).toContain('node_modules');
    expect(excl).toContain('cdk.out');
    expect(excl).not.toContain('node_modules/');
    expect(excl).not.toContain('cdk.out/');

    // The real defect (measured live on the fleet): a workspace whose
    // node_modules is a SYMLINK to a shared cache, which a trailing-slash
    // pattern does not match. This backfill's lines carry no trailing slash.
    mkdirSync(join(home, 'shared-cache'));
    symlinkSync(join(home, 'shared-cache'), join(ws1, 'node_modules'), 'dir');
    const checkIgnore = spawnSync('git', ['-C', ws1, 'check-ignore', '-q', 'node_modules'], { encoding: 'utf8' });
    expect(checkIgnore.status).toBe(0);
    const status = spawnSync('git', ['-C', ws1, 'status', '--porcelain'], { encoding: 'utf8' });
    expect(status.stdout).toBe('');

    // A second run converges the same lines, not a second copy of them.
    const first = readFileSync(excludeFile, 'utf8');
    const r2 = runInstall(home, ['install']);
    expect(r2.code, r2.stderr).toBe(0);
    expect(readFileSync(excludeFile, 'utf8')).toBe(first);
  });

  it('retrofits a repository reachable only through $HOME/worktrees', () => {
    const home = freshBox('ccrc-install-ws-excl-worktree-only-');
    const externalRepo = join(home, 'external', 'repoB');
    mkdirSync(externalRepo, { recursive: true });
    writeFileSync(join(externalRepo, 'b.txt'), 'x\n');
    gitInit(externalRepo);

    const wsOnly = join(home, 'worktrees', 'repoB', 'ws-only');
    mkdirSync(join(home, 'worktrees', 'repoB'), { recursive: true });
    const wtAdd = spawnSync(
      'git', ['-C', externalRepo, 'worktree', 'add', wsOnly, '-b', 'ws-only'],
      { encoding: 'utf8' },
    );
    expect(wtAdd.status, wtAdd.stderr).toBe(0);

    const r = runInstall(home, ['install']);
    expect(r.code, r.stderr).toBe(0);

    // The main checkout is deliberately outside $HOME/projects. Only the
    // linked worktree makes this repository discoverable, so deleting the
    // $HOME/worktrees scan root leaves this assertion red.
    const excludeFile = join(externalRepo, '.git', 'info', 'exclude');
    const excl = readFileSync(excludeFile, 'utf8').split('\n');
    expect(excl).toContain('node_modules');
    expect(excl).toContain('cdk.out');
    expect(excl).not.toContain('node_modules/');
    expect(excl).not.toContain('cdk.out/');
  });

  it('is skipped entirely on a server-role box', () => {
    const home = freshBox('ccrc-install-ws-excl-server-');
    const repoA = join(home, 'projects', 'repoA');
    mkdirSync(repoA, { recursive: true });
    writeFileSync(join(repoA, 'a.txt'), 'x\n');
    gitInit(repoA);

    const r = runInstall(home, ['install', '--role', 'server']);
    expect(r.code, r.stderr).toBe(0);
    const excludeFile = join(repoA, '.git', 'info', 'exclude');
    expect(existsSync(excludeFile) && readFileSync(excludeFile, 'utf8').includes('node_modules'))
      .toBe(false);
  });
});

describe('ccrc install: the build stamp', () => {
  // `~/.ccrc/build.json` is what a box SAYS it is running, and `ccrc version`
  // and `ccrc status` both read it. Until this task the only writer was
  // `deploy.sh`'s `stamp_build`, so a box installed by `ccrc install` reported
  // "unstamped" for ever — honest, and useless: a self-installed box could not
  // answer the one question every incident starts with.
  //
  // The same measurement-forgery rule deploy's own header states applies here:
  // a dirty tree may install, but the stamp SAYS dirty. A clean sha nobody
  // measured is the class this repo bans by name.
  const stampOf = (home: string): Record<string, unknown> =>
    JSON.parse(read(dotCcrc(home, 'build.json'))) as Record<string, unknown>;

  it('stamps the box with the sha, ref and cleanliness of the checkout it installed from', () => {
    const home = freshBox('ccrc-install-stamp-');
    const sha = gitInit(treeRoot(home));
    const r = runInstall(home, ['install'], {}, { umask: '077' });
    expect(r.code, r.stderr).toBe(0);
    const stamp = stampOf(home);
    expect(stamp['sha']).toBe(sha);
    expect(stamp['ref']).toBe('fixture-branch');
    expect(stamp['dirty']).toBe(false);
    expect(stamp['builtAt']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    // Stage 4, Task 1: no v* tag points at the fixture commit, so the stamp
    // carries NO version key at all — additive absence, not an empty value.
    expect('version' in stamp).toBe(false);
    // 0644 like deploy's, and asserted under a hostile umask so the mode can
    // only have come from a chmod — at 077 a plain redirect makes it 0600.
    expect(statSync(dotCcrc(home, 'build.json')).mode & 0o777).toBe(0o644);
    expect(r.stdout).toMatch(new RegExp(`^install: stamp: ${sha}`, 'm'));
  });

  it('stamps the version when a v* tag points at the installed commit (Stage 4, Task 1)', () => {
    // The tag IS the release identity, measured by `git tag --points-at HEAD`
    // — never assumed. The transcript line carries it too, so an operator
    // watching an install sees the release they got.
    const home = freshBox('ccrc-install-stamp-tag-');
    const root = treeRoot(home);
    const sha = gitInit(root);
    const tag = (name: string): void => {
      const r = spawnSync('git', ['-C', root, 'tag', name], {
        env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
        encoding: 'utf8',
      });
      if (r.status !== 0) throw new Error(`fixture git tag failed: ${r.stderr}`);
    };
    // A non-release tag at the same commit must NOT become the version — the
    // stamp claims an identity only a vX.Y.Z tag states.
    tag('release-candidate');
    tag('v2.0.1');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    const stamp = stampOf(home);
    expect(stamp['sha']).toBe(sha);
    expect(stamp['version']).toBe('v2.0.1');
    expect(r.stdout).toMatch(/^install: stamp: [0-9a-f]{40} \(fixture-branch, v2\.0\.1\)$/m);
  });

  // Wave 17 R8f (D-5317): `pathWithout`'s farm of real tools carries `head`, because the stamp's release-tag read
  // pipes through it; without it the version is dropped without failing the install, with only a "command not found"
  // line on stderr.
  it('H1: pathWithout links a runnable head into its farm, and omits it when head is the named absence (wave 17 R8f, D-5317)', () => {
    const farmOf = (path: string): string => path.split(':')[1] ?? '';
    const runnable = (dir: string): boolean => {
      try { return (statSync(join(dir, 'head')).mode & 0o111) !== 0; } catch { return false; }
    };
    const home = freshBox('ccrc-install-pathwithout-head-');
    expect(runnable(farmOf(pathWithout(home, 'git'))), 'the farm lacks a runnable head').toBe(true);
    expect(runnable(farmOf(pathWithout(home, 'head'))), 'head was linked although it is the named absence').toBe(false);
  });

  it('H2: an install from a checkout tagged v9.9.9, on a farm PATH, stamps version v9.9.9 (wave 17 R8f, D-5317)', () => {
    const home = freshBox('ccrc-install-stamp-farm-tag-');
    const root = treeRoot(home);
    const sha = gitInit(root);
    const t = spawnSync('git', ['-C', root, 'tag', 'v9.9.9'], {
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }, encoding: 'utf8',
    });
    if (t.status !== 0) throw new Error(`fixture git tag failed: ${t.stderr}`);
    // No tool is the subject here: a name no farm entry carries leaves the whole farm linked.
    const r = runInstall(home, ['install'], { PATH: pathWithout(home, 'nothing-is-missing') });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout, r.stderr).toMatch(/^install: stamp: [0-9a-f]{40} \(fixture-branch, v9\.9\.9\)$/m);
    const stamp = stampOf(home);
    expect(stamp['sha']).toBe(sha);
    expect(stamp['version'], 'the release tag was not read through the farm PATH').toBe('v9.9.9');
  });

  it('says dirty when the checkout has uncommitted work', () => {
    const home = freshBox('ccrc-install-stamp-dirty-');
    gitInit(treeRoot(home));
    writeFileSync(treeFile(home, 'ccd/tmux.conf'),
      `${read(treeFile(home, 'ccd/tmux.conf'))}# edited after the commit\n`);
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(stampOf(home)['dirty'], 'a dirty checkout stamped clean').toBe(true);
    expect(r.stdout).toMatch(/^install: stamp: [0-9a-f]{40} \(fixture-branch, dirty\)$/m);
  });

  it('skips — and says what that costs — when the tree is not a git checkout', () => {
    // The ordinary state of a DEPLOYED box: `~/ccrc` is an rsync of a tree,
    // never a repository (`deploy.sh#stamp_build` says so), so a re-install there has
    // nothing to measure. Skipping is the honest answer; inventing a sha, or
    // carrying the previous one forward, is the forgery. The line names the
    // consequence so an operator who later reads "unstamped" knows why.
    //
    // THE CAUSE IS GIT'S OWN SENTENCE, not this file's guess about it (fix
    // round 1, Important 1). In this arm the two agree — git says "not a git
    // repository" and it is not one — but that agreement is a fact of THIS
    // fixture, and the two arms below are where a single hand-written sentence
    // starts lying.
    const home = freshBox('ccrc-install-stamp-nogit-');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(
      /^install: stamp: skipped \(git rev-parse HEAD exited 128: .*not a git repository.*\) — ccrc version will say unstamped$/m);
    expect(existsSync(dotCcrc(home, 'build.json'))).toBe(false);
  });

  it('does not call a real checkout "not a git checkout" when git REFUSES it', () => {
    // FIX ROUND 1, IMPORTANT 1 — measured by the reviewer, reproduced here.
    // `detected dubious ownership` is git exiting 128 on a repository that IS
    // one: a clone owned by another user, or the same clone reached under
    // sudo. The old arm answered "not a git checkout", which sends the
    // operator to look for a repository that is right in front of them while
    // the box goes on reporting `unstamped` for ever — the exact condition
    // this step exists to end.
    const home = freshBox('ccrc-install-stamp-refused-');
    gitInit(treeRoot(home));
    const r = runInstall(home, ['install'], {}, {
      stubs: {
        // `config` is handed to the real git, and the rest refuses. The two are
        // different questions — "is this directory a repository I will read"
        // and "what is this box's commit identity" — and only the first is this
        // test's subject; doctor's `git_email` check asks the second at the end
        // of the same run, so a stub that refused both would make this a test
        // about two things.
        git: '#!/bin/sh\n'
          + `case "\${1:-}" in config) exec ${realPath('git')} "$@" ;; esac\n`
          + 'echo "fatal: detected dubious ownership in repository at \'/home/other/ccrc\'" >&2\n'
          + 'exit 128\n',
      },
    });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout, 'the skip still claims a cause it did not measure')
      .not.toMatch(/not a git checkout/);
    expect(r.stdout).toMatch(/^install: stamp: skipped \(git rev-parse HEAD exited 128: fatal: detected dubious ownership in repository at '\/home\/other\/ccrc'\) — ccrc version will say unstamped$/m);
    expect(existsSync(dotCcrc(home, 'build.json'))).toBe(false);
  });

  it('says GIT IS ABSENT when git is absent — a different sentence again', () => {
    // The third cause the one sentence used to cover. "not a git checkout"
    // sends an operator to inspect a directory; `apt install git` is the fix.
    // Same rule as `cmd_install`'s own node probe (round-1 review, Important
    // 1): a missing DEPENDENCY and a fact about the tree are two conditions an
    // operator acts on completely differently.
    const home = freshBox('ccrc-install-stamp-gitless-');
    gitInit(treeRoot(home));
    const r = runInstall(home, ['install'], { PATH: pathWithout(home, 'git') });
    expect(r.stdout).toMatch(
      /^install: stamp: skipped \(no git on PATH\) — ccrc version will say unstamped$/m);
    expect(r.stdout).not.toMatch(/not a git checkout/);
    expect(existsSync(dotCcrc(home, 'build.json'))).toBe(false);
    // …AND THE VERB EXITS 1, which is doctor's verdict and not this step's:
    // every install step converged (the transcript above says so, and the
    // wrappers summary is the last of them), and then doctor said this box has
    // no git. That is the coupling Task 8 introduced — `cmd_install` ends with
    // `cmd_doctor` and hands back its exit code — and a box with no git really
    // is not a finished fleet box: `ccd` clones a workspace per session. The
    // two FAIL lines name the cause, so the 1 cannot be mistaken for the stamp
    // step having failed (it did not; it SKIPPED, at exit 0).
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/^FAIL git: /m);
    expect(r.stdout).toMatch(/^install: wrappers: converged/m);
  });

  it('never echoes raw control bytes out of git', () => {
    // Passing a foreign tool's stderr through is only safe if what reaches the
    // terminal cannot MOVE THE CURSOR: `_box_build_fields:264-267` rejects a
    // stamp field carrying a control byte for exactly this reason ("a
    // backspace would let the printed sha lie on a terminal"). Same rule
    // here, one register over — and the line is truncated, because a git that
    // writes a megabyte of stderr must not become the install transcript.
    const home = freshBox('ccrc-install-stamp-cntrl-');
    gitInit(treeRoot(home));
    const r = runInstall(home, ['install'], {}, {
      stubs: {
        // `config` to the real git, for the reason the arm above states.
        git: '#!/bin/sh\n'
          + `case "\${1:-}" in config) exec ${realPath('git')} "$@" ;; esac\n`
          + 'printf \'fatal: \\033[31mred\\010\\010\\010nope\\r and more\\n'
          + 'second line nobody asked for\\n\' >&2\nexit 128\n',
      },
    });
    expect(r.code, r.stderr).toBe(0);
    const line = r.stdout.split('\n').find((l) => l.startsWith('install: stamp:'))!;
    expect(line, 'a control byte reached the transcript')
      .not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(line, 'git\'s second line rode along').not.toContain('second line nobody asked for');
    expect(line).toContain('fatal:');
  });

  it('and `ccrc version` on the installed box reads exactly what it wrote', () => {
    // The cross-verb proof, run through the launcher this same install put on
    // PATH: one writer, one reader, one box. A stamp only this suite can parse
    // would be a file, not a fact.
    const home = freshBox('ccrc-install-stamp-version-');
    const sha = gitInit(treeRoot(home));
    expect(runInstall(home).code).toBe(0);
    const r = runLauncherVersion(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain(sha);
    expect(r.stdout).toContain('fixture-branch');
  });

  it('writes the stamp through BOX_STAMP_FILE — the path is spelled once', () => {
    // D-88's rule, applied to the file this task turns into a written one.
    // `single-definition.test.ts` already pins that `$HOME/.ccrc/build.json`
    // appears in exactly one line of shell in this file; this is the other
    // half — that the new WRITER goes through that line rather than merely not
    // duplicating it (which deleting the step would also satisfy).
    const src = read(join(REPO, 'ccd', 'ccrc'));
    const body = /_inst_stamp\(\)[\s\S]*?\n\}/.exec(src);
    expect(body, 'ccd/ccrc has no _inst_stamp').toBeTruthy();
    expect(body![0]).toContain('BOX_STAMP_FILE');
    // Comment lines dropped, `single-definition.test.ts`'s own rule: the step's
    // prose is where the reasoning lives and may name the file freely; only a
    // LINE OF SHELL that names it is a second spelling.
    expect(body![0].split('\n').filter((l) => !l.trim().startsWith('#'))
      .filter((l) => l.includes('.ccrc/build.json')),
    'the stamp path is spelled out in a line of shell inside _inst_stamp').toEqual([]);
  });
});

describeLinux('ccrc install: the units, and the one this box must not be given', () => {
  /** One install, shared by the read-only assertions. `umask 077` for the
   *  reason the artifacts describe gives: at 022 a plain `cp` reproduces 0644
   *  by itself and the `chmod` could be deleted unnoticed. */
  const units = ((): { home: string; r: Result } => {
    const home = freshBox('ccrc-install-units-');
    return { home, r: runInstall(home, ['install'], {}, { umask: '077' }) };
  })();

  it('the run this describe measures succeeded', () => {
    expect(units.r.code, units.r.stderr).toBe(0);
    expect(units.r.stdout).toMatch(/^install: units: /m);
    expect(units.r.stdout).toMatch(/^install: services: /m);
  });

  // The count is DERIVED from `UNIT_FILES` itself, not hand-written: fix
  // round 1 (Finding 4) measured the title stuck at "ten" while the census
  // had grown to fourteen, the exact staleness this avoids repeating.
  //
  // Split by SUFFIX, not by position. `UNIT_FILES.length - 2` was the first
  // spelling and it is a hand-maintained constant wearing a derivation's
  // clothes: it is correct only while the two drop-ins are the last two rows,
  // so appending a unit file below them silently makes the title wrong by one
  // — the same defect, one wave later and harder to see. Every drop-in is a
  // `.conf`; no unit file is.
  const dropIns = UNIT_FILES.filter(([dest]) => dest.endsWith('.conf'));
  const unitFiles = UNIT_FILES.filter(([dest]) => !dest.endsWith('.conf'));
  it(`installs ${unitFiles.length} unit files and ${dropIns.length} drop-ins, byte for byte, at 644`, () => {
    // `deploy.sh#AGENT_BUILD_CMD`'s copy set, plus graphify Task 10's role-gated
    // sweep pair (the default install here is role `both`, so both land).
    // Byte equality rather than existence,
    // because the failure this catches is not an absent file: it is a unit
    // installed from the wrong place (the checkout instead of the placed tree,
    // or a stale copy), which exists, parses, and runs the wrong thing.
    const { home } = units;
    for (const [dest, src] of UNIT_FILES) {
      const p = unitDir(home, ...dest.split('/'));
      expect(existsSync(p), `${dest} never reached ~/.config/systemd/user`).toBe(true);
      expect(readFileSync(p), `${dest} is not the shipped file`)
        .toEqual(readFileSync(placed(home, ...src.split('/'))));
      expect(statSync(p).mode & 0o777, `${dest} has the wrong mode`).toBe(0o644);
    }
  });

  itLinux('places ccrc\'s OWN usage pair on both and fleet, and still writes no ccgpt-usage@ name on any role (Plan 3a Task 6)', () => {
    // 2b-1 item 13, rewritten deliberately. Until Plan 3a no role placed a
    // usage pair at all (D-3172): its only name was another repository's live
    // template on the fleet box (final review F-1). The pair now ships as
    // `ccrc-codex-usage@` and lands on both and fleet. The foreign name is
    // still never written, and with no codex lane rostered no instance is
    // enabled, which is the live box's shape once this merges. The
    // `--role server` describe pins the third role.
    const home = freshBox('ccrc-install-codex-usage-fleet-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'agent.env'),
      'CCRC_SERVER_URL=http://127.0.0.1:7788\nCCRC_AGENT_TOKEN=fixture-not-a-real-token\n');
    const r = runInstall(home, ['install', '--role', 'fleet']);
    expect(r.code, r.stderr).toBe(0);
    for (const [role, h, out] of [['both', units.home, units.r.stdout], ['fleet', home, r.stdout]] as const) {
      for (const u of ['ccrc-codex-usage@.service', 'ccrc-codex-usage@.timer']) {
        expect(readFileSync(unitDir(h, u)), `--role ${role}: ${u} is not the placed tree's copy`)
          .toEqual(readFileSync(placed(h, 'deploy', 'systemd', u)));
      }
      expect(readdirSync(unitDir(h)).filter((n) => n.startsWith('ccgpt-usage')),
        `--role ${role} wrote a name another repository owns on the live fleet box`).toEqual([]);
      expect(existsSync(placed(h, 'deploy', 'systemd', 'ccgpt-usage@.service')),
        'the old template name still ships in the placed tree').toBe(false);
      const argv = systemctlCalls(h).map((c) => c.argv).join('\n');
      expect(argv, `--role ${role}: a systemctl verb named another repository's unit`).not.toContain('ccgpt-usage');
      expect(argv, `--role ${role}: an instance was armed on a roster with no codex lane`).not.toContain('ccrc-codex-usage@');
      expect(out).toMatch(/^install: codex-usage: none — no codex lane in the roster$/m);
    }
  });

  itLinux('a FOREIGN ccgpt-usage@ unit pair and its enabled instance survive install --role fleet and uninstall, byte for byte', () => {
    // The fleet box's shape before Plan 4 removed another repository's copy (F-1), in a
    // fixture HOME: that repository's template pair at the two names, and an ENABLED instance of
    // it (the `timers.target.wants/` link `systemctl enable` makes). Every
    // fixture HOME before this case was empty there, so nothing could see an
    // install overwrite that pair or an uninstall delete it.
    const home = freshBox('ccrc-install-foreign-ccgpt-usage-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'agent.env'),
      'CCRC_SERVER_URL=http://127.0.0.1:7788\nCCRC_AGENT_TOKEN=fixture-not-a-real-token\n');
    const svc = unitDir(home, 'ccgpt-usage@.service');
    const timer = unitDir(home, 'ccgpt-usage@.timer');
    const wants = unitDir(home, 'timers.target.wants', 'ccgpt-usage@x.timer');
    mkdirSync(unitDir(home, 'timers.target.wants'), { recursive: true });
    const foreignSvc = '# FOREIGN-FIXTURE-7f3a: another repository owns this template\n[Service]\nType=oneshot\nExecStart=/bin/true %i\n';
    const foreignTimer = '# FOREIGN-FIXTURE-7f3a: another repository owns this template\n[Timer]\nOnCalendar=*:0/7\n';
    writeFileSync(svc, foreignSvc, { mode: 0o644 });
    writeFileSync(timer, foreignTimer, { mode: 0o644 });
    symlinkSync(timer, wants);
    const untouched = (stage: string): void => {
      expect(read(svc), `${stage}: the foreign ccgpt-usage@.service changed`).toBe(foreignSvc);
      expect(read(timer), `${stage}: the foreign ccgpt-usage@.timer changed`).toBe(foreignTimer);
      expect(lstatSync(wants).isSymbolicLink(), `${stage}: the enabled instance's wants link is gone`).toBe(true);
      expect(readlinkSync(wants), `${stage}: the wants link was repointed`).toBe(timer);
    };
    const inst = runInstall(home, ['install', '--role', 'fleet']);
    expect(inst.code, inst.stderr).toBe(0);
    untouched('after install --role fleet');
    // Plan 3a Task 6: ccrc's OWN pair lands BESIDE the foreign one, under its
    // own name, and (below) leaves with uninstall while the foreign one stays.
    for (const u of ['ccrc-codex-usage@.service', 'ccrc-codex-usage@.timer']) {
      expect(existsSync(unitDir(home, u)), `install --role fleet did not place ccrc's own ${u} beside the foreign pair`).toBe(true);
    }
    const un = runInstall(home, ['uninstall']);
    expect(un.code, `stderr: ${un.stderr}\nstdout: ${un.stdout}`).toBe(0);
    untouched('after uninstall');
    for (const u of ['ccrc-codex-usage@.service', 'ccrc-codex-usage@.timer']) {
      expect(existsSync(unitDir(home, u)), `uninstall left ccrc's own ${u}`).toBe(false);
    }
    expect(systemctlCalls(home).map((c) => c.argv).join('\n'), 'a systemctl verb named the foreign unit')
      .not.toContain('ccgpt-usage');
  });

  it('ccrc-codex-usage@.service runs the isolated runtime\'s interpreter under -I, with the cost map local and a start bound (D-3486, Plan 3a Task 6)', () => {
    // D-3164, the half Plan 2b-2 owns: the publisher's shebang is `env
    // python3`, and on the operator's fleet box that python imports a
    // third-party litellm fork from user site-packages — a SILENT wrong
    // interpreter. The unit now names the runtime `ccgpt-runtime` builds, and
    // this case holds it there in two halves: the TEXT (one ExecStart, `-I`,
    // the cost map local, no PATH line) and the AGREEMENT — the interpreter the
    // unit names, resolved, is the one `ccgpt-runtime python` answers on a box
    // that has a runtime. Plan 3a places the pair under ccrc's own name and arms
    // one instance per codex lane (the cases above and the converge describe).
    const unit = read(join(REPO, 'deploy', 'systemd', 'ccrc-codex-usage@.service'));
    const code = unit.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
    const execs = code.filter((l) => l.startsWith('ExecStart='));
    expect(execs, 'the unit must carry exactly one ExecStart').toHaveLength(1);
    expect(execs[0]).toBe('ExecStart=%h/.ccrc/runtime/codex/current/bin/python -I %h/.local/bin/ccgpt-usage.py');
    expect(code, 'the cost map is not local — every poll would fetch a mutable remote JSON (D-3484)')
      .toContain('Environment=LITELLM_LOCAL_MODEL_COST_MAP=True');
    expect(code).toContain('Environment=CCGPT_ACCOUNT_ID=%i');
    // Plan 3a Task 1: a oneshot has NO start timeout by default. The
    // publisher refuses a device sign-in in-process; this bounds everything
    // else a wedged refresh could hold. Task 6's rename carries the line.
    expect(code.filter((l) => l.startsWith('TimeoutStartSec=')), 'the usage poll must be bounded')
      .toEqual(['TimeoutStartSec=300']);
    expect(code.filter((l) => /^Environment=["']?PATH=/.test(l)), 'a PATH line cannot choose the interpreter (D-3164)')
      .toEqual([]);
    // A oneshot has no start timeout by default, and its timer starts no
    // second instance while one runs: a poll that hung would silence the
    // lane's usage row for good. Bounded, and inside one timer cycle. Its
    // count is Task 1's one exact pin above.
    const bound = code.filter((l) => /^TimeoutStartSec=\d+$/.test(l));
    const timer = read(join(REPO, 'deploy', 'systemd', 'ccrc-codex-usage@.timer'))
      .split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
    const cycle = timer.map((l) => /^OnUnitActiveSec=(\d+)min$/.exec(l)).find((m) => m !== null);
    expect(cycle, 'the usage timer\'s OnUnitActiveSec is not spelled in minutes — this pin has gone stale').toBeDefined();
    expect(Number(bound[0]!.slice('TimeoutStartSec='.length)), 'a poll may still be running when the next one is due')
      .toBeLessThan(Number(cycle![1]) * 60);
    // The converge, uninstall, account removal and doctor read ENABLEMENT as
    // this target's wants link (D-3726):
    // another target and every one of those readers goes blind.
    expect(timer, 'the usage timer is no longer wanted by timers.target').toContain('WantedBy=timers.target');

    // The agreement half, in a fixture HOME only. The runtime is planted by
    // `codexLaneFixture.ts`' `plantFakeRuntime`, the one planter of the
    // builder's layout in the test tree: a `gen-<UTC>-<n>` generation, a
    // RELATIVE `current` symlink, and a stamp derived from the shipped
    // `ccd/ccgpt-runtime`. So this case types no second copy of that layout.
    const home = mkTmp('ccrc-usage-unit-interp-');
    const rt = plantFakeRuntime(home);
    const r = spawnSync(BASH, [join(REPO, 'ccd', 'ccgpt-runtime'), 'python'],
      { env: { ...process.env, HOME: home }, encoding: 'utf8' });
    expect(r.status, `ccgpt-runtime python: ${r.stderr}`).toBe(0);
    expect(realpathSync(r.stdout.trim()), 'ccgpt-runtime python answered an interpreter the fixture did not plant')
      .toBe(realpathSync(rt.python));
    const named = execs[0]!.slice('ExecStart='.length).split(' ')[0]!.replace(/^%h\//, `${home}/`);
    expect(realpathSync(named), 'the unit names an interpreter the runtime builder does not answer')
      .toBe(realpathSync(r.stdout.trim()));
  });

  it('the installed ccrc.service reads ccrc.env first, then exposure.env, both optional', () => {
    // Stage 3b Task 1 (spec D3): exposure keys live in their own
    // ~/.ccrc/exposure.env, written by `ccrc expose`, never by touching the
    // seed-once ccrc.env. systemd's EnvironmentFile semantics make the LATER
    // file win for a key present in both — so the order below is the whole
    // mechanism by which `expose` overrides a hand-set placeholder — and the
    // leading `-` on each is what lets a box that never ran the verb (or has
    // no env file at all) boot anyway. Asserted as the exact ordered list, so
    // a dropped `-`, a swapped order, or a third line all land here.
    const unit = read(unitDir(units.home, 'ccrc.service'));
    expect(unit.split('\n').filter((l) => l.startsWith('EnvironmentFile='))).toEqual([
      'EnvironmentFile=-%h/.ccrc/ccrc.env',
      'EnvironmentFile=-%h/.ccrc/exposure.env',
    ]);
  });

  it('puts the slice drop-in in the ESCAPED directory name, and nowhere else', () => {
    // THE MUTATION THIS TEST EXISTS FOR: drop the `\x2d` and the drop-in lands
    // in `app-claude-session.slice.d`, where systemd — which escapes `-` in a
    // unit name before it looks — never reads it. Nothing fails, nothing warns:
    // every pane on the box just runs without its memory cap. So the assertion
    // is on the literal bytes of the directory name, and on the absence of the
    // plausible-looking one beside it.
    const { home } = units;
    expect(readdirSync(unitDir(home))).toContain(SLICE_DIR);
    expect(readdirSync(unitDir(home)),
      'the drop-in dir carries the repository spelling, which systemd never reads')
      .not.toContain('app-claude-session.slice.d');
    expect(existsSync(unitDir(home, SLICE_DIR, 'limits.conf'))).toBe(true);
  });

  it('D-5241: names the pane-scope drop-in directory with its TRAILING HYPHEN (systemd\'s prefix form), and nothing else', () => {
    // The mutation this exists for: without the hyphen the directory names a unit `tmux-spawn.scope` that never
    // exists, and every pane keeps `OOMPolicy=stop` with nothing failing (plan 2026-10-16 Task 13 step 1 measured
    // that the hyphenated prefix form reaches a new transient scope).
    const { home } = units;
    expect(readdirSync(unitDir(home))).toContain('tmux-spawn-.scope.d');
    expect(readdirSync(unitDir(home))).not.toContain('tmux-spawn.scope.d');
    expect(readdirSync(unitDir(home, 'tmux-spawn-.scope.d'))).toEqual(['50-oom-continue.conf']);
    expect(readdirSync(unitDir(home, 'ccrc-tmux-server.scope.d'))).toEqual(['50-oom-continue.conf']);
    for (const d of ['tmux-spawn-.scope.d', 'ccrc-tmux-server.scope.d']) {
      expect(read(unitDir(home, d, '50-oom-continue.conf')).split('\n').filter((l) => l && !l.startsWith('#')))
        .toEqual(['[Scope]', 'OOMPolicy=continue']);
    }
  });

  it('does NOT install ccrc-agent.service — a required EnvironmentFile with no file', () => {
    // The one unit in deploy's set this verb refuses to place. Its
    // `EnvironmentFile=%h/.ccrc/agent.env` has no leading `-`, so systemd
    // REQUIRES the file; a single box in local mode has no agent and no
    // agent.env, and installing the unit would manufacture one that can only
    // fail — visible for ever in `systemctl --user` and in doctor's own
    // `services` check, describing something nobody asked for.
    const { home } = units;
    expect(existsSync(unitDir(home, 'ccrc-agent.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccrc-agent.service.d'))).toBe(false);
    // …and no enable was attempted for it either, which is the half a mere
    // file-absence assertion would miss.
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccrc-agent');
  });

  it('installs no ccd-update-sync pair on the default role — the server process writes the projection there', () => {
    // programme wave 4 (design 2026-09-20 §9): the default role is `both`,
    // and on `both` the SERVER is the writer of `~/.ccrc/update-intent`. A
    // timer here would be a second writer of one path whose binary refuses
    // every 60 seconds (no agent.env), under a timer `_check_services` reads
    // as active. The BINARY is still on PATH — graph-sweep's rule: the timer
    // is the gate, never the binary.
    const { home } = units;
    expect(existsSync(unitDir(home, 'ccd-update-sync.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccd-update-sync.timer'))).toBe(false);
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccd-update-sync');
    expect(existsSync(join(home, '.local', 'bin', 'ccd-update-sync')),
      'the puller binary is missing on the default role').toBe(true);
  });

  it('reloads and enables in that order, and only after every unit file landed', () => {
    // TWO ORDERINGS IN ONE ASSERTION, because they fail the same way. systemd
    // reads the directory at `daemon-reload`; a unit enabled before its drop-in
    // exists runs WITHOUT the drop-in until something reloads again, and for
    // the slice cap that is a box whose panes are uncapped while its transcript
    // says they are not. The recorded snapshot is what each call SAW.
    const { home } = units;
    // The filter keeps STATE-CHANGING calls only; `is-active`, `show` and
    // `list-units` are all reads. `list-units` joined them when `_check_scopes`
    // landed — `cmd_install` ends with `cmd_doctor`, so every read doctor makes
    // is made during an install too, and a read has no place in an assertion
    // about the order of mutations.
    const calls = systemctlCalls(home).filter((c) => !c.argv.includes('is-active')
      && !c.argv.includes('show') && !c.argv.includes('list-units'));
    expect(calls.map((c) => c.argv)).toEqual([
      // `_inst_node`'s reload (the manager-PATH fragment), BEFORE any unit file: it is not about units.
      '--user daemon-reload',
      // `_inst_enable`'s reload, the one this test is about.
      '--user daemon-reload',
      '--user enable --now ccrc.service',
      '--user enable --now ccd-cap-scopes.timer',
      // account-pool-membership wave 1, Task 4 fix round 2 (ruling T4-R1):
      // `ccd-pool-sync.timer` is ABSENT here, and its absence is the
      // assertion. This describe's install is the default role, `both`, and
      // `both` is not `fleet` — so it gets no `~/.ccrc/agent.env`, which is
      // the one file `ccd-pool-sync` refuses without. Arming the timer here
      // would enable a oneshot that exits 1 every 60 seconds forever while
      // the TIMER (which is what `_check_services` measures) stays active, so
      // `ccrc doctor` would print PASS on a box the sync has never worked on.
      // The fleet-role describe below is where this enable is pinned present.
      // graphify Task 10 (O3/O6b): a THIRD enable, beside cap-scopes', for the
      // role-gated sweep timer — the default install here is role `both`, so
      // it fires. Degrades rather than dies on failure (`_inst_linger`'s own
      // idiom), which is why it is not folded into the `_ccrc_die`-guarded
      // loop above it.
      '--user enable --now ccd-graph-sweep.timer',
      // Routing slice 0 Task 7: another degrade-rather-than-die enable, on the
      // graph-sweep's own terms, for the usage-accounting sweep's timer.
      '--user enable --now ccd-usage-sweep.timer',
      // The temp-dir reaper's timer, on the same gate and the same
      // degrade-rather-than-die idiom as the two sweeps above it.
      '--user enable --now ccd-tmp-sweep.timer',
      '--user enable --now ccd-scope-sweep.timer',
      '--user enable --now ccd-account-health.timer',
      // spec 2026-09-07 §C: a FOURTH enable, role-gated exactly as the sweep's
      // and degrading rather than dying for the same reason.
      '--user enable --now ccd-telemetry-keepalive.timer',
      // C5: a FIFTH enable, role-gated on the same terms and degrading the
      // same way — a server box has no lanes for this timer to refresh.
      '--user enable --now ccrc-models.timer',
      // history spec §9.5: the history sweep's timer, on its unit files' gate,
      // degrading rather than dying like every timer in this list.
      '--user enable --now ccd-history-sweep.timer',
      // W4a Task 9: the server-role watchdog's timer — `!= fleet`, so this
      // role enables it — degrading rather than dying like every timer in
      // this list, and taking no restart (a oneshot holds no code).
      '--user enable --now ccrc-update-watchdog.timer',
      // THE RESTART, in deploy's own position (deploy.sh's `systemctl --user restart` after the enables): after both
      // enables, before the verify. `enable --now` on an already-active unit is
      // a no-op, and `ccrc.service` runs `node ~/ccrc/server/dist/…` — a process
      // pinned to the dist it started with. Without this line the SECOND
      // `ccrc install` rsyncs a new dist, stamps the new sha, prints "every step
      // above converged", and leaves the box serving the old code, with nothing
      // on a single box able to notice (`_check_fleet` SKIPs in local mode).
      // It is also what makes `verify-service.sh` — "Post-restart verification"
      // by its own header — measure this install's process rather than the
      // previous one's.
      '--user restart ccrc.service',
    ]);
    for (const c of calls.slice(1)) {   // all but the node reload (above)
      expect(c.onDisk, `${c.argv} ran before the unit files landed`)
        .toEqual(expect.arrayContaining(UNIT_FILES.map(([dest]) => dest)));
    }
  });

  it('refuses BY UNIT when systemd will not enable one', () => {
    // The remedy names the unit and the command that says why. "install failed"
    // would send an operator to read this script; `systemctl --user status
    // ccd-cap-scopes.timer` sends them to systemd's own sentence about it.
    const home = freshBox('ccrc-install-enable-fails-');
    writeFileSync(join(home, 'fixture-enable-fail'), 'ccd-cap-scopes.timer\n');
    const r = runInstall(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(
      /^ccrc: systemctl --user enable --now ccd-cap-scopes\.timer failed — read what it says: systemctl --user status ccd-cap-scopes\.timer$/m);
    // …and the run stopped there rather than carrying on to report a box it
    // could not finish converging.
    expect(r.stdout).not.toMatch(/^install: linger:/m);
  });

  it('a systemd that will not take the watchdog timer DEGRADES the install, never fails it', () => {
    // The watchdog bounds a FUTURE update; an install that converged must not
    // be failed over it. `_inst_linger`'s idiom, and every other timer's here.
    const home = freshBox('ccrc-install-watchdog-enable-fails-');
    writeFileSync(join(home, 'fixture-enable-fail'), 'ccrc-update-watchdog.timer\n');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toMatch(
      /^install: update-watchdog: could not enable ccrc-update-watchdog\.timer — run: systemctl --user enable --now ccrc-update-watchdog\.timer$/m);
    expect(r.stdout, 'the closing line claims a convergence the watchdog timer never had')
      .toMatch(/^install: done — converged with \d+ degraded steps? \([^)]*\bccrc-update-watchdog\.timer\b[^)]*\)$/m);
    expect(systemctlCalls(home).map((c) => c.argv)).toContain('--user restart ccrc.service');
  });

  it('the watchdog unit SKIPS on a tree with no watchdog verb: a restore or rollback onto an older release never turns it into a failed oneshot a minute', () => {
    // An arm-2 restore (Task 6) or `ccrc rollback --to` (Task 7) onto a
    // release older than W4a runs THAT release's spine, which neither knows
    // nor removes this pair. The timer stays enabled, and the launcher execs
    // whatever tree ~/ccrc holds. `ExecCondition=` rc 1-254 skips the run
    // without marking the unit failed (systemd.service(5)). Only 255 or a
    // signal counts as a failure.
    const unit = readFileSync(join(REPO, 'deploy', 'systemd', 'ccrc-update-watchdog.service'), 'utf8');
    const conds = unit.split('\n').filter((l) => l.startsWith('ExecCondition='));
    expect(conds).toEqual([`ExecCondition=/bin/sh -c 'grep -q "^cmd_watchdog()" %h/ccrc/ccd/ccrc'`]);
    // It precedes ExecStart, so it cannot be read as a second command after it.
    expect(unit.indexOf('ExecCondition=')).toBeLessThan(unit.indexOf('ExecStart='));
    const script = /^ExecCondition=\/bin\/sh -c '(.*)'$/.exec(conds[0]!)![1]!;
    const cond = (home: string): number | null =>
      spawnSync('/bin/sh', ['-c', script.replace(/%h/g, home)]).status;
    const src = readFileSync(join(REPO, 'ccd', 'ccrc'), 'utf8');
    const plant = (prefix: string, body: string): string => {
      const home = mkTmp(prefix);
      mkdirSync(join(home, 'ccrc', 'ccd'), { recursive: true });
      writeFileSync(join(home, 'ccrc', 'ccd', 'ccrc'), body);
      return home;
    };
    // This tree has the verb: the condition passes and ExecStart runs.
    expect(cond(plant('ccrc-watchdog-cond-this-', src))).toBe(0);
    // An older tree, which is this file without the verb's definition line:
    // skipped, and not a failure.
    const old = src.split('\n').filter((l) => !l.startsWith('cmd_watchdog()')).join('\n');
    expect(old).not.toBe(src);
    const rcOld = cond(plant('ccrc-watchdog-cond-old-', old));
    expect(rcOld).toBeGreaterThanOrEqual(1);
    expect(rcOld).toBeLessThanOrEqual(254);
    // No tree at all (grep's rc 2): skipped too, never 255.
    const rcNone = cond(mkTmp('ccrc-watchdog-cond-none-'));
    expect(rcNone).toBeGreaterThanOrEqual(1);
    expect(rcNone).toBeLessThanOrEqual(254);
  });

  it('the watchdog unit PREPENDS ~/.local/bin to the PATH it inherits, never REPLACES it (D-3282)', () => {
    // `ccrc.service` (ExecStart=/usr/bin/env node …) finds `node` through the
    // user manager's PATH — systemd defaults plus every environment.d
    // fragment (e.g. /snap/bin). A bare `Environment=PATH=…` on this unit
    // would REPLACE that PATH rather than extend it, so on a box whose node
    // is reachable only through one of those fragments, the rollback this
    // unit's one real act runs (`ccrc rollback --from watchdog`, a whole
    // `ccrc update`) would die at its own node preflight — silently
    // disabling the watchdog on exactly the boxes whose layout differs from
    // the four hard-coded directories.
    const unit = readFileSync(join(REPO, 'deploy', 'systemd', 'ccrc-update-watchdog.service'), 'utf8');
    const lines = unit.split('\n');
    expect(lines.some((l) => l.startsWith('Environment=PATH='))).toBe(false);
    const execStart = lines.filter((l) => l.startsWith('ExecStart='));
    expect(execStart).toEqual([
      `ExecStart=/bin/sh -c 'PATH="%h/.local/bin:$$PATH" exec %h/.local/bin/ccrc watchdog'`,
    ]);
  });

  it('fails the install when the started service does not stay up', () => {
    // `systemctl enable --now` returns the moment systemd FORKS, which is the
    // whole reason `deploy/verify-service.sh` exists: a server that throws
    // during ESM evaluation crash-loops every RestartSec=3 behind an install
    // that exited 0. Here the MainPID changes across the observation window —
    // the shape of a crash loop, and the one thing a single `is-active` sample
    // cannot see.
    const home = freshBox('ccrc-install-crashloop-');
    writeFileSync(join(home, 'fixture-mainpid-drift'), 'yes\n');
    const r = runInstall(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/CRASH-LOOPING/);
    expect(r.stderr).toMatch(
      /^ccrc: ccrc\.service was restarted and did not stay up, so this box has the unit and not the service/m);
    expect(r.stdout).not.toMatch(/^install: linger:/m);
  });

  it('refuses when the restart itself fails — the old server is still the one running', () => {
    // A restart systemd refuses (a unit that will not start at all) is a
    // different condition from a service that starts and then dies, and the two
    // remedies an operator reaches for are the same command with different
    // output. What must not happen is either being silent: the box is then
    // running the PREVIOUS install's server while every other artifact on it
    // claims the new build.
    const home = freshBox('ccrc-install-restart-fails-');
    writeFileSync(join(home, 'fixture-restart-fail'), 'yes\n');
    const r = runInstall(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(
      /^ccrc: systemctl --user restart ccrc\.service failed, so this box is still running the server the previous install started — read what it says: systemctl --user status ccrc\.service$/m);
    expect(r.stdout).not.toMatch(/^install: linger:/m);
  });

  it('says on the transcript that the service was restarted onto the new tree', () => {
    // The step's own line is what an operator reads when they wonder whether a
    // re-run actually replaced the running server. It names the thing the
    // restart is FOR — the tree this run placed — rather than saying "enabled"
    // and leaving the process question unanswered.
    expect(units.r.stdout).toMatch(
      /^install: services: ccrc\.service and ccd-cap-scopes\.timer enabled, and ccrc\.service restarted onto the tree this run placed$/m);
  });

  it('honours the CCRC_VERIFY_* knobs rather than waiting out a production window', () => {
    // The knobs are `verify-service.sh`'s own and this verb passes none of them
    // — it just does not clobber them. Proof that the script really ran (and
    // ran against the fixture's systemctl) is its verdict line in the
    // transcript, naming the MainPID the stub answered with.
    expect(units.r.stdout).toMatch(/^verified: ccrc\.service active, MainPID 4242 stable across 0s$/m);
  });

});

// spec 2026-10-26-node-runtime-under-nvm: every unit reaches `node` by NAME on the systemd user manager's PATH, and
// an nvm node is on the operator's shell PATH only. `_inst_node` publishes the chosen node through three links and a
// manager PATH fragment, BEFORE `_inst_units` and `_inst_enable`. These cases assert the artefacts and the order,
// not the exit code: they are about the step, and a box short of an unrelated tool (jq) must not hide it.
describeLinux('ccrc install: the node the units run (nvm-aware selection, `_inst_node`)', () => {
  const nodeBin = (home: string): string => join(home, '.local', 'libexec', 'ccrc', 'node-bin');
  const fragment = (home: string): string => join(home, '.config', 'environment.d', '50-ccrc-node.conf');
  const FRAGMENT = (home: string): string => [
    '# Written by ccrc (ccd/ccrc-node): systemd user units run node by name, and the user manager\'s PATH',
    '# lacks the directory a version manager keeps it in. Do not edit; ccrc re-writes it on install/update.',
    `PATH=${nodeBin(home)}:\${PATH}`,
    '',
  ].join('\n');

  it('publishes node, npm and npx as links to the chosen directory, and the fragment says so exactly', () => {
    const home = freshBox('ccrc-install-node-publish-');
    const r = runInstall(home);
    for (const b of ['node', 'npm', 'npx']) {
      expect(lstatSync(join(nodeBin(home), b)).isSymbolicLink(), `${b} is not a link`).toBe(true);
      expect(readlinkSync(join(nodeBin(home), b)), r.stderr).toBe(join(home, '.fixture-node', b));
    }
    expect(read(fragment(home))).toBe(FRAGMENT(home));
    expect(statSync(fragment(home)).mode & 0o777).toBe(0o644);
    expect(r.stdout).toMatch(new RegExp(`^install: node: v\\d+\\.\\d+\\.\\d+ at ${home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\.fixture-node \\(links in ${nodeBin(home).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}; manager PATH via ~/\\.config/environment\\.d/50-ccrc-node\\.conf\\)$`, 'm'));
  });

  it('reloads the manager AFTER the fragment is written and BEFORE the first restart', () => {
    const home = freshBox('ccrc-install-node-reload-order-');
    const r = runInstall(home);
    const argv = systemctlCalls(home).map((c) => c.argv);
    const reload = argv.indexOf('--user daemon-reload');
    expect(reload, `no daemon-reload recorded; stderr: ${r.stderr}`).toBeGreaterThanOrEqual(0);
    // the FIRST reload is `_inst_node`'s: it saw the fragment already on disk
    expect(read(join(home, 'fixture-reload-saw-fragment')).split('\n')[0]).toBe('present');
    // and it precedes every enable and the restart, all of which must exist: an install that died before enabling
    // would otherwise pass this vacuously
    for (const verb of ['enable', 'restart']) {
      const first = argv.findIndex((a) => a.startsWith(`--user ${verb} `));
      expect(first, `no ${verb} recorded; stderr: ${r.stderr}`).toBeGreaterThanOrEqual(0);
      expect(reload, `${verb} came before the node reload`).toBeLessThan(first);
    }
    const nodeAt = r.stdout.indexOf('install: node:');
    const unitsAt = r.stdout.indexOf('install: units:');
    expect(nodeAt, 'no node line').toBeGreaterThanOrEqual(0);
    expect(unitsAt, `no units line; stderr: ${r.stderr}`).toBeGreaterThanOrEqual(0);
    expect(nodeAt).toBeLessThan(unitsAt);
  });

  it('is idempotent: a second run leaves the same links and the same fragment, and no temp sibling', () => {
    const home = freshBox('ccrc-install-node-idempotent-');
    runInstall(home);
    const before = ['node', 'npm', 'npx'].map((b) => readlinkSync(join(nodeBin(home), b)));
    runInstall(home);
    expect(['node', 'npm', 'npx'].map((b) => readlinkSync(join(nodeBin(home), b)))).toEqual(before);
    expect(read(fragment(home))).toBe(FRAGMENT(home));
    expect(readdirSync(nodeBin(home)).sort()).toEqual(['node', 'npm', 'npx']);
    expect(readdirSync(join(home, '.config', 'environment.d'))).toEqual(['50-ccrc-node.conf']);
  });

  it('a box whose shell PATH has NO node but has an nvm tree installs, and runs gen-accounts on the chosen node', () => {
    const home = freshBox('ccrc-install-node-nvm-');
    const binOf = plantNvm(home, ['v22.99.0'], 'v22.99.0');
    const r = runInstall(home, ['install'], { PATH: pathWithout(home, 'node') });
    const dir = binOf('v22.99.0');
    expect(r.stdout, r.stderr).toContain(`install: node: v22.99.0 at ${dir} (links in ${nodeBin(home)};`);
    for (const b of ['node', 'npm', 'npx']) expect(readlinkSync(join(nodeBin(home), b))).toBe(join(dir, b));
    // the roster generator ran (its output exists) — and it could only have run on the chosen node: there is no
    // other on this PATH
    expect(existsSync(join(home, '.ccrc', 'accounts.sh'))).toBe(true);
    expect(existsSync(join(home, 'nvm-install-calls'))).toBe(false);
  });

  it('an nvm box whose only node is below the floor refuses BEFORE anything is written, and never runs `nvm install`', () => {
    const home = freshBox('ccrc-install-node-below-floor-');
    plantNvm(home, ['v18.0.0'], 'v18.0.0');
    const r = runInstall(home, ['install'], { PATH: pathWithout(home, 'node') });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: no usable node: no installed nvm node meets the floor \(>=\d+\.\d+\.\d+\); this run is not interactive.* Nothing on this box was written or changed\.$/m);
    expect(existsSync(join(home, 'nvm-install-calls'))).toBe(false);
    expect(existsSync(join(home, '.ccrc'))).toBe(false);
    expect(existsSync(nodeBin(home))).toBe(false);
    expect(existsSync(fragment(home))).toBe(false);
  });

  it('a box with no node and no nvm still gets the probe\'s own sentence', () => {
    const home = freshBox('ccrc-install-node-none-');
    const r = runInstall(home, ['install'], { PATH: pathWithout(home, 'node') });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: node is required by 'ccrc install' — .* Nothing on this box was written or changed\.$/m);
  });

  it('ccrc-models.service puts the node links directory first on its PATH, in the shipped file and the placed one', () => {
    const line = 'Environment=PATH=%h/.local/libexec/ccrc/node-bin:%h/.local/bin:/usr/local/bin:/usr/bin:/bin';
    expect(read(join(REPO, 'deploy', 'systemd', 'ccrc-models.service'))).toContain(`\n${line}\n`);
    const home = freshBox('ccrc-install-node-models-unit-');
    runInstall(home);
    expect(read(unitDir(home, 'ccrc-models.service'))).toContain(`\n${line}\n`);
  });
});

// PLATFORM-NEUTRAL, so it lives outside the Linux-only describe above: the
// property it pins — the two files name the SAME set of unit directories — is
// true on both platforms and is exactly what a half-finished port breaks.
// The Linux describe above measures four unit files, two drop-ins and a
// slice. macOS gets ONE job file, and the difference is not an omission —
// launchd has no template units (so there is nothing to install once for all
// sessions; `ccd` mints a plist per session), no drop-ins, and no cgroups (so
// there is no memory ceiling to install and no `ccd-cap-scopes` to run). What
// it DOES have to keep is every promise that survives translation: the job
// lands at 644, it is a valid plist, it reads the same two env files in the
// same order, and it is bootstrapped rather than merely written.
describeDarwin('ccrc install: the launchd job, and what macOS deliberately does not get', () => {
  const box = ((): { home: string; r: Result } => {
    const home = freshBox('ccrc-install-launchd-');
    return { home, r: runInstall(home, ['install'], {}, { umask: '077' }) };
  })();

  const plist = (): string =>
    join(box.home, 'Library', 'LaunchAgents', 'app.ccrc.ccrc.plist');

  it('the run this describe measures succeeded', () => {
    expect(box.r.code, box.r.stderr).toBe(0);
    expect(box.r.stdout).toMatch(/^install: units: /m);
  });

  it('installs exactly one job file, at 644', () => {
    expect(existsSync(plist()), 'app.ccrc.ccrc.plist never reached ~/Library/LaunchAgents')
      .toBe(true);
    expect(statSync(plist()).mode & 0o777, 'the job file has the wrong mode').toBe(0o644);
    // ONE file, not a directory of them: no template, no drop-ins, no timer.
    const dir = join(box.home, 'Library', 'LaunchAgents');
    expect(readdirSync(dir).sort()).toEqual(['app.ccrc.ccrc.plist']);
  });

  it('reads ccrc.env first, then exposure.env, both optional — systemd\'s EnvironmentFile order, kept', () => {
    // launchd cannot read an env file at all, so the job is a shell that
    // sources them. The ORDER is the mechanism by which `ccrc expose`
    // overrides a hand-set placeholder, and the `[ -f ]` guards are the `-`
    // that lets a box which never ran the verb boot anyway. Both must survive
    // the translation or the platform quietly loses a feature.
    const body = read(plist());
    const env1 = body.indexOf('/.ccrc/ccrc.env');
    const env2 = body.indexOf('/.ccrc/exposure.env');
    expect(env1, 'the job never reads ccrc.env').toBeGreaterThan(-1);
    expect(env2, 'the job never reads exposure.env').toBeGreaterThan(-1);
    expect(env1, 'exposure.env must be sourced AFTER ccrc.env — later wins')
      .toBeLessThan(env2);
    expect(body).toMatch(/\[ -f '[^']*\/\.ccrc\/ccrc\.env' \]/);
    expect(body).toMatch(/\[ -f '[^']*\/\.ccrc\/exposure\.env' \]/);
    expect(body, 'the assignments must be EXPORTED, which is what an EnvironmentFile does')
      .toContain('set -a;');
  });

  it('is a plist the system parser accepts', () => {
    // `launchctl bootstrap` answers a malformed plist with "Could not find
    // specified service" — a message about the wrong thing entirely. The
    // install lints before it places, and this is that guarantee measured
    // against the file that actually landed.
    const r = spawnSync('plutil', ['-lint', plist()], { encoding: 'utf8' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });

  it('carries PATH explicitly — a LaunchAgent does not inherit the login shell\'s', () => {
    // The difference between a working box and a mystery: launchd hands a job
    // its own minimal PATH, which holds neither Homebrew's bash (ccd needs
    // >= 4.2 and macOS ships 3.2) nor tmux.
    expect(read(plist())).toMatch(/<key>PATH<\/key>/);
  });

  it('bootstraps the job rather than only writing it', () => {
    const calls = read(join(box.home, 'launchctl-calls'));
    expect(calls, 'nothing was ever bootstrapped').toMatch(/^bootstrap gui\//m);
    expect(box.r.stdout).toMatch(/^install: services: app\.ccrc\.ccrc bootstrapped/m);
  });

  it('installs no ccd-cap-scopes, and says why', () => {
    // It caps tmux pane CGROUP scopes. macOS has none, so the binary would be
    // a permanent no-op on PATH and the transcript would name it as though the
    // box had gained something.
    expect(existsSync(join(box.home, '.local', 'bin', 'ccd-cap-scopes')),
      'an inert cap-scopes binary was installed anyway').toBe(false);
    expect(box.r.stdout).toMatch(/no ccd-cap-scopes/);
  });

  it('states the missing memory ceiling instead of implying parity', () => {
    expect(box.r.stdout).toMatch(/no per-session or fleet-wide memory ceiling/);
  });

  it('converges cleanly — linger is not a degraded step on a platform that has none', () => {
    // A degraded step is one that was supposed to happen and did not. Counting
    // linger here would make EVERY macOS install report DEGRADED forever,
    // which trains an operator to ignore the word on the day it means
    // something. The fact is carried by `ccrc doctor` as a standing WARN.
    expect(box.r.stdout).toMatch(/^install: linger: not a macOS concept/m);
    expect(box.r.stdout).toMatch(/^install: done — every step above converged$/m);
  });
});

// The launchd FAILURE branches — the Darwin siblings of the Linux describe's
// three failure tests, minus the one macOS does not implement: there is no
// separate `restart` step in `_inst_enable_darwin` (bootout+bootstrap IS the
// reload), so "refuses when the restart itself fails" has no Darwin condition
// to test. What remains is the refusal and the stay-up gate, and both were
// shipped without a test that reaches them — the `fixture-bootstrap-fail`
// knob in the launchctl stub existed with no writer.
describeDarwin('ccrc install: the launchd failure branches — the refusal, and the stay-up gate', () => {
  it('refuses BY LABEL when launchd will not bootstrap the job — the sibling of "refuses BY UNIT when systemd will not enable one"', () => {
    const home = freshBox('ccrc-install-bootfail-');
    writeFileSync(join(home, 'fixture-bootstrap-fail'), 'yes\n');
    const r = runInstall(home);
    expect(r.code, 'a bootstrap launchd refused must FAIL the install').not.toBe(0);
    expect(r.stderr).toMatch(/launchctl bootstrap failed for app\.ccrc\.ccrc/);
    // The remedy names the command this box actually has.
    expect(r.stderr).toMatch(/launchctl print gui\//);
    expect(r.stdout, 'the install must not report the step as done')
      .not.toMatch(/^install: services: app\.ccrc\.ccrc bootstrapped/m);
  });

  it('waits for an old job still shutting down after bootout, then bootstraps — a returned bootout is not a job that left', () => {
    // The measured failure: launchd answered `bootout` while the old server was
    // still in its graceful shutdown, the bootstrap was refused with 5, and the
    // update was reverted. Delete the wait and this install dies instead.
    const home = freshBox('ccrc-install-draining-');
    writeFileSync(join(home, 'fixture-draining'), '2\n');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(read(join(home, 'launchctl-calls')).match(/^bootstrap gui\/\S+ \S*app\.ccrc\.ccrc\.plist/gm),
      'the refused bootstrap was not tried again').toHaveLength(2);
    expect(r.stdout).toMatch(/^install: services: app\.ccrc\.ccrc bootstrapped/m);
  });

  it('the wait is bounded: an old job that never leaves still fails the install, and says it waited', () => {
    const home = freshBox('ccrc-install-draining-forever-');
    writeFileSync(join(home, 'fixture-draining'), '100000\n');
    const r = runInstall(home, undefined, { CCRC_BOOTOUT_WAIT_S: '1' });
    expect(r.code, 'a job launchd never let go of must FAIL the install').not.toBe(0);
    expect(r.stderr).toMatch(/launchctl bootstrap failed for app\.ccrc\.ccrc \(again after 1s waiting for the old job to leave\)/);
  });

  it('fails the install when the bootstrapped job does not stay up — fork-time success is not a service', () => {
    // Every `launchctl print` answers a fresh pid: a crash loop as launchd
    // shows one, while `bootstrap` itself still exits 0. The doctrine above
    // `_inst_enable` binds this arm too: a box whose service will not stay
    // up is a FAILED install, not a warning.
    const home = freshBox('ccrc-install-stayup-');
    writeFileSync(join(home, 'fixture-pid-churn'), 'yes\n');
    const r = runInstall(home);
    expect(r.code, 'a job that did not stay up must FAIL the install').not.toBe(0);
    expect(r.stderr).toMatch(/did not stay up/);
    expect(r.stderr).toMatch(/launchctl print gui\//);
  });
});

// The fleet lane's Darwin half. The Linux tests above pin `ccrc-agent.service`
// byte for byte against the shipped unit; there is no shipped plist to compare
// against — `_inst_units` GENERATES one — so what is pinned here is the
// property those tests are really about: a fleet box gets the AGENT's job and
// must never be given the server's.
describeDarwin('ccrc install --role fleet: the agent job, and the one this box must not be given', () => {
  // THROUGH A PTY, like the Linux fleet tests: `--role fleet` reads the agent
  // URL and token from a terminal ON PURPOSE and refuses a pipe, because under
  // `curl … | bash` stdin is the installer script and a read there would take
  // a line of shell as this fleet's bearer token.
  let once: Promise<{ home: string; r: Result }> | null = null;
  // Every case reads this one home, so it is made in a beforeAll, before the first case's mark:
  // removeTmpFixturesEachTest leaves it to the end-of-file sweep.
  let launchdHome = '';
  beforeAll(() => { launchdHome = freshBox('ccrc-install-fleet-launchd-'); }, 60_000);
  const box = (): Promise<{ home: string; r: Result }> => (once ??= (async () => {
    const home = launchdHome;
    const r = await runInstallTty(home, ['install', '--role', 'fleet'], [FLEET_URL, FLEET_TOKEN]);
    return { home, r };
  })());

  it('the run this describe measures succeeded', async () => {
    const { r } = await box();
    expect(r.code, r.stdout).toBe(0);
  });

  it('installs the AGENT job and NOT the server one', async () => {
    const { home } = await box();
    expect(readdirSync(join(home, 'Library', 'LaunchAgents')).sort())
      .toEqual(['app.ccrc.ccrc-agent.plist']);
  });

  it('bootstraps the agent, and never mentions the server job', async () => {
    const { home, r } = await box();
    const calls = read(join(home, 'launchctl-calls'));
    expect(calls).toMatch(/bootstrap /);
    expect(calls, 'the server job was named on a fleet box')
      .not.toContain('app.ccrc.ccrc.plist');
    expect(r.stdout).toMatch(/^install: services: app\.ccrc\.ccrc-agent bootstrapped/m);
  });
});

describe('ccrc install: the unit directory is spelled the same in both files', () => {
  it('names the same unit directory the doctor check table does', () => {
    // THE DELIBERATE SECOND SPELLING, held by a mechanism instead of a promise
    // (D-92, and `_check_path`'s own note about `WRAPPER_BIN_DIR` for the same
    // trade). `ccrc-doctor-checks` cannot read `ccrc`'s variable: it is sourced
    // under `set -u` by things that are not `ccrc` — ccrc-doctorFixture.ts's
    // `tableNames()` does exactly that — so a top-level
    // `CCRC_UNIT_DIR="$BOX_UNIT_DIR"` would make sourcing it fail outright, and
    // a `:-` fallback IS the second spelling with a branch in front. So: two
    // literals, compared.
    const ccrcSrc = read(join(REPO, 'ccd', 'ccrc'));
    const checksSrc = read(join(REPO, 'ccd', 'ccrc-doctor-checks'));
    //
    // TWO DIRECTORIES PER FILE SINCE macOS ARRIVED — systemd's unit directory
    // and launchd's LaunchAgents — so the property is now two pairs rather
    // than one, and this check got STRONGER rather than looser: it pins both.
    // A port that translated one file's arm and not the other's is exactly
    // the drift D-92 wrote this test for.
    const all = (re: RegExp, src: string) =>
      [...src.matchAll(re)].map((m) => m[1]!);
    const box = all(/^\s*BOX_UNIT_DIR="([^"]+)"$/gm, ccrcSrc);
    const table = all(/^\s*CCRC_UNIT_DIR="([^"]+)"$/gm, checksSrc);
    expect(box, 'ccd/ccrc declares no BOX_UNIT_DIR').not.toHaveLength(0);
    expect(table, 'ccd/ccrc-doctor-checks declares no CCRC_UNIT_DIR').not.toHaveLength(0);
    // Compared as SETS: the two files order their platform arms
    // independently, and what matters is that neither knows a directory the
    // other does not.
    expect([...box].sort()).toEqual([...table].sort());
    // …and they are the real directories, so the agreement is with the box
    // rather than only with itself. The Linux one is what this fixture really
    // found the units in.
    expect(box).toContain('$HOME/.config/systemd/user');
    expect(box).toContain('$HOME/Library/LaunchAgents');
  });
});
