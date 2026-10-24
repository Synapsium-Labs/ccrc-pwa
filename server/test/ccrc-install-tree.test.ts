// `ccrc install`, part 1 of the ccrc-install-*.test.ts family (D-6767): the tree, the seeding steps and the files the
// operator owns. Shared fixtures and the original file header live in ccrc-installFixture.ts.
// LOAD-TIME INSTALL in this file: `installed`, the describe-level `ccrc install` of 'the executables and files it installs'.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, chmodSync, readdirSync, rmSync, symlinkSync, utimesSync, lstatSync, readlinkSync, realpathSync } from 'node:fs';
import path, { join } from 'node:path';
import { createHash } from 'node:crypto';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { renderCcdEntry } from './ccdWsHelpers.js';
import { CONTAINED_TOOLS, assertNoRealTool, plantPoison } from './containedTools.js';
import { describeLinux, describeDarwin, itLinux, itDarwin } from './platformFixtures.js';
import { TREE_STUBS, installFixtureTree, rsyncRecorder } from './installTreeFixture.js';
import { GPT_LANE_BINS } from './codexLaneFixture.js';
import { INSTALL_FAMILY_FILES, here, REPO, LANE_BINS_IN_LINE, treeRoot, ccrcIn, treeFile, placed, versionDir, healthyDoctorBox, FIXTURE_BINS, freshBox, ccrcEnv, replantDoctorStubs, runInstall, runLauncherVersion, pathWithout, read, dotCcrc, mtime, preexisting, strays, DEFAULT_SEED, FIVE_ACCOUNT_ROSTER, gitInit, type Result } from './ccrc-installFixture.js';

removeTmpFixturesEachTest();

// Wave 9 M6 (D-3811). openrsync — macOS's /usr/bin/rsync — copies locally by
// forking `rsync --server …` through PATH, so a recorder first on PATH is
// reached a second time by the implementation's own re-exec. Samba rsync on
// Linux copies in-process and never does, so this twin runs a fake that DOES
// re-exec on every platform. The recorder must log the call ccrc made and
// hand the `--server` call straight on.
describe('the rsync recorder logs only the call ccrc made (wave 9 M6)', () => {
  const setup = (fakeBody: string): { dir: string; env: NodeJS.ProcessEnv } => {
    const dir = mkTmp('ccrc-rsync-recorder-');
    mkdirSync(join(dir, 'bin'));
    mkdirSync(join(dir, 'poison'));
    writeFileSync(join(dir, 'bin', 'rsync'), rsyncRecorder(join(dir, 'fake-openrsync')), { mode: 0o755 });
    writeFileSync(join(dir, 'fake-openrsync'), fakeBody, { mode: 0o755 });
    // A recorder that was not executable would fall through to this, never to the real rsync.
    writeFileSync(join(dir, 'poison', 'rsync'),
      '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/rsync-poison"\nexit 97\n', { mode: 0o755 });
    return { dir, env: { HOME: dir, PATH: `${dir}/bin:${dir}/poison:/usr/bin:/bin` } };
  };

  it('a local copy that re-execs `rsync --server` through PATH reaches the recorder twice and is logged once', () => {
    const { dir, env } = setup('#!/bin/sh\nif [ "$1" = --server ]; then touch "$HOME/server-ran"; exit 0; fi\n'
      + 'rsync --server --sender -logDtpre.iLsfxC . "$2"\nexit 0\n');
    const r = spawnSync('sh', [join(dir, 'bin', 'rsync'), '-a', 'src/', 'dst/'], { env, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(join(dir, 'rsync-argv'), 'utf8')).toBe('-a src/ dst/\n');
    expect(existsSync(join(dir, 'server-ran')), 'the fake\'s --server arm never ran through the recorder').toBe(true);
    expect(existsSync(join(dir, 'rsync-poison')), 'the recorder fell through to the poison').toBe(false);
  });

  it('control: a copy that never re-execs is logged once too', () => {
    const { dir, env } = setup('#!/bin/sh\nexit 0\n');
    const r = spawnSync('sh', [join(dir, 'bin', 'rsync'), '-a', 'src/', 'dst/'], { env, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(join(dir, 'rsync-argv'), 'utf8')).toBe('-a src/ dst/\n');
    expect(existsSync(join(dir, 'rsync-poison'))).toBe(false);
  });
});

describe('ccrc install: the shipped tree lands at $HOME/ccrc', () => {
  // WHY THE TREE IS COPIED AT ALL, since the verb is already running out of
  // one: `~/ccrc` is the layout every sibling contract assumes — the PATH shim
  // execs `~/ccrc/ccd/ccrc`, `_dr_pkg_candidates` reads the node floor at
  // `$CCRC_HERE/../{server,agent}/package.json`, and both deploy lanes rsync
  // into exactly this directory. An install that left the tree in a checkout
  // would leave a box that works only as long as nobody deletes the clone.
  it('refuses BY ARTIFACT when the checkout carries no server build', () => {
    // The refusal names the artifact and the command that makes it. "install
    // failed" would send an operator to read this script; "no server build at
    // <path>" sends them to `bash install.sh`, which is the whole distance
    // between the two messages.
    const home = freshBox('ccrc-install-nodist-');
    rmSync(treeFile(home, 'server/dist/server/src/index.js'));
    const r = runInstall(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(
      /^ccrc: no server build at .*\/checkout\/server\/dist — build first: bash install\.sh \(or npm run build in server\/ and pwa\/\)$/m);
    // BEFORE anything moved: the preflight is worth nothing if it fires after
    // the copy it is meant to gate.
    expect(existsSync(placed(home)), 'the tree was placed before it was checked').toBe(false);
    expect(existsSync(join(home, 'rsync-argv')), 'rsync ran anyway').toBe(false);
  });

  it('refuses BY ARTIFACT when the PWA bundle is missing — a different sentence', () => {
    // Two artifacts, two builds, two remedies (`npm run build` in server/ vs
    // in pwa/). Collapsing them into one "the tree is not built" is the
    // overloaded-seam mistake this file's own header bans.
    const home = freshBox('ccrc-install-nopwa-');
    rmSync(treeFile(home, 'server/dist-pwa/index.html'));
    const r = runInstall(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(
      /^ccrc: no PWA bundle at .*\/checkout\/server\/dist-pwa — build first: bash install\.sh \(or npm run build in pwa\/\)$/m);
    expect(existsSync(placed(home))).toBe(false);
  });

  it('refuses BY ARTIFACT when the agent build is missing — and only for a role that runs one (D-1159)', () => {
    // The third artifact, the third sentence. This one is role-gated because
    // the artifact is: `fleet` is the ONLY role that installs the agent unit
    // (`_inst_units`) or enables and restarts it (`_inst_enable`) — both test
    // `[ "$INST_ROLE" = fleet ]`. D-1161 corrected this gate from `!= server`,
    // which refused the DEFAULT role over a unit that role never installs, and
    // corrected this comment, which had asserted the opposite.
    //
    // WHAT THIS COSTS WHEN IT IS MISSING, measured on the reference fleet
    // before the preflight existed: `install.sh` builds server and pwa only, so
    // `ccrc install --role fleet` from a source checkout placed the tree, then
    // restarted a LIVE fleet's agent onto a directory with no entry point. The
    // agent died with MODULE_NOT_FOUND and the server lost its only path to the
    // box. A refusal before the copy is the whole difference.
    const home = freshBox('ccrc-install-noagent-');
    rmSync(treeFile(home, 'agent/dist/agent/src/index.js'));
    // `--role fleet` asks for the agent's URL and bearer token when
    // `~/.ccrc/agent.env` is absent, and refuses on a non-tty long before the
    // preflight under test. A box that has already been configured — which is
    // every box a re-install runs on, and the one this outage happened on —
    // carries it, so the fixture does too.
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'agent.env'),
      'CCRC_SERVER_URL=http://127.0.0.1:7788\nCCRC_AGENT_TOKEN=fixture-not-a-real-token\n');
    const r = runInstall(home, ['install', '--role', 'fleet']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(
      /^ccrc: no agent build at .*\/checkout\/agent\/dist — build first: bash install\.sh \(or npm run build in agent\/\)$/m);
    // BEFORE anything moved — the same property the two preflights above pin.
    expect(existsSync(placed(home)), 'the tree was placed before it was checked').toBe(false);
    expect(existsSync(join(home, 'rsync-argv')), 'rsync ran anyway').toBe(false);
  });

  it('does NOT demand an agent build for --role both, the DEFAULT role (D-1161)', () => {
    // The gate's sharp edge. `both` is a single box that serves AND runs
    // sessions, and it drives ccd directly in `local` mode — `_inst_units`
    // gives it `ccrc.service`, never `ccrc-agent.service`, and `_inst_enable`
    // never starts one. The first draft of the D-1159 preflight gated on
    // `!= server`, so it refused the default install over an artifact that role
    // has no use for: a new failure mode introduced by the fix for an old one.
    const home = freshBox('ccrc-install-noagent-both-');
    rmSync(treeFile(home, 'agent/dist/agent/src/index.js'));
    const r = runInstall(home, ['install', '--role', 'both']);
    expect(r.stderr, 'the default role must not be refused for a unit it never installs')
      .not.toMatch(/no agent build at/);
    expect(r.code, r.stderr).toBe(0);
  });

  it('--role server skips every per-account step — no config dir, hooks, skills, wrappers or session files are written on a box that hosts no sessions', () => {
    // 2026-09-19, measured on the live server box: the spine converged 17
    // accounts there — dirs, settings.json hooks (the operator's own ~/.claude
    // included), skills, wrappers, and their statusline moved aside — while
    // doctor's `skills` check SKIPs that role as "hosts no sessions". The
    // installer now says the same thing the doctor says.
    const home = freshBox('ccrc-install-server-skips-accounts-');
    gitInit(treeRoot(home));   // a readable stamp, so the record can name a sha
    const r = runInstall(home, ['install', '--role', 'server']);
    expect(r.code, r.stderr).toBe(0);
    for (const step of ['files', 'dirs', 'hooks', 'skills', 'wrappers']) {
      expect(r.stdout).toMatch(new RegExp(`^install: ${step}: skipped — a server-role box hosts no sessions`, 'm'));
    }
    expect(existsSync(join(home, '.claude', 'skills', 'ccrc-worker')), 'a skill was placed on a server-role box').toBe(false);
    expect(existsSync(join(home, '.claude', 'settings.json')), 'hooks were registered on a server-role box').toBe(false);
    expect(existsSync(join(home, '.cc-sessions', 'session-hook.sh')), 'session files were placed on a server-role box').toBe(false);
    // …and the record is still written LAST, so `update --check` reads a completed install.
    expect(existsSync(join(home, '.ccrc', 'installed'))).toBe(true);
  });

  it('does NOT demand an agent build for --role server (D-1159)', () => {
    // The gate is not decoration: a server-only box runs no agent unit, so an
    // absent agent build is not a fault there. Without this the preflight would
    // refuse installs it has no business refusing.
    const home = freshBox('ccrc-install-noagent-server-');
    rmSync(treeFile(home, 'agent/dist/agent/src/index.js'));
    const r = runInstall(home, ['install', '--role', 'server']);
    expect(r.stderr, 'a server-role install must not be refused for a missing agent')
      .not.toMatch(/no agent build at/);
  });

  it('installs the AGENT runtime deps too, on a fleet box (D-1161)', () => {
    // D-1159 made the agent's ENTRY POINT exist. It did not make the tree
    // STARTABLE: `_inst_tree`'s rsync excludes `node_modules` in both
    // directions and this step ran npm in `server/` only, so a fleet install
    // placed `agent/dist` beside no `agent/node_modules` — and `agent/src/
    // server.ts` imports `ws` on line 6. `_inst_enable` then restarts
    // `ccrc-agent.service` and node dies with the SAME ERR_MODULE_NOT_FOUND,
    // one import further in. The reference fleet escaped it only because an
    // earlier `deploy.sh agent` had left a node_modules behind, which is why
    // the postmortem saw the missing dist and stopped there.
    const home = freshBox('ccrc-install-npm-agent-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'agent.env'),
      'CCRC_SERVER_URL=http://127.0.0.1:7788\nCCRC_AGENT_TOKEN=fixture-not-a-real-token\n');
    const r = runInstall(home, ['install', '--role', 'fleet']);
    expect(r.code, r.stderr).toBe(0);
    // TWO npm ci calls, production-only, in that order — and in the PLACED
    // tree both times, never in the checkout.
    expect(read(join(home, 'npm-argv')).trim().split('\n')).toEqual([
      'ci --omit=dev --no-audit --no-fund',
      'ci --omit=dev --no-audit --no-fund',
    ]);
    expect(read(join(home, 'npm-cwd')).trim().split('\n')).toEqual([
      versionDir(home, 'server'),
      versionDir(home, 'agent'),
    ]);
    expect(existsSync(placed(home, 'agent', 'node_modules'))).toBe(true);
    expect(r.stdout).toMatch(/^install: tree: agent runtime deps in place$/m);
  });

  it('does NOT run npm in the agent on a role that runs no agent (D-1161)', () => {
    // The other side of the same gate: a `both` box has no agent unit, so an
    // npm ci there is work for nothing — and would fail on a tree whose agent
    // lockfile the box never needed.
    const home = freshBox('ccrc-install-npm-both-');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(read(join(home, 'npm-cwd')).trim().split('\n')).toEqual([versionDir(home, 'server')]);
    expect(r.stdout).not.toMatch(/agent runtime deps/);
  });

  it('places the five directories a box runs out of, with the builds inside them', () => {
    const home = freshBox('ccrc-install-tree-placed-');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    for (const d of ['server', 'agent', 'shared', 'deploy', 'ccd']) {
      expect(existsSync(placed(home, d)), `${d} did not reach $HOME/ccrc`).toBe(true);
    }
    // The shim's target, by the path the shim spells.
    expect(existsSync(placed(home, 'ccd', 'ccrc'))).toBe(true);
    // dist and dist-pwa are INCLUDED, and that is the deliberate divergence
    // from `deploy.sh` (which excludes `dist` and builds on the box): install
    // IS the box, so it ships the build the checkout already made.
    expect(existsSync(placed(home, 'server', 'dist', 'server', 'src', 'index.js'))).toBe(true);
    expect(read(placed(home, 'server', 'dist-pwa', 'index.html')))
      .toBe(TREE_STUBS['server/dist-pwa/index.html']);
    // W6 Task 2: placed into the version directory and flipped to; a
    // checkout nothing measures is `unstamped-<12 hex>`.
    expect(r.stdout).toMatch(/^install: tree: placed unstamped-[0-9a-f]{12} at \$HOME\/ccrc-versions\/unstamped-[0-9a-f]{12}$/m);
  });

  it('leaves node_modules, .git, env files and the mail token in the checkout', () => {
    // Every one of these is a real thing a checkout holds at install time. The
    // two secrets are the sharp ones: `deploy/ccrc.env` and
    // `deploy/ccrc-mail.token` are gitignored files carrying live tokens, and
    // rsync's `-a` would copy them at whatever mode the checkout has (0644
    // under a plain umask) into a second, unmanaged location — deploy.sh's own
    // excludes exist for exactly that (`:335-342`).
    const home = freshBox('ccrc-install-excludes-');
    mkdirSync(treeFile(home, 'server/node_modules/leftpad'), { recursive: true });
    writeFileSync(treeFile(home, 'server/node_modules/leftpad/index.js'), 'module.exports = 1\n');
    writeFileSync(treeFile(home, 'deploy/ccrc.env'), 'CCRC_AGENT_TOKEN=live-secret\n');
    writeFileSync(treeFile(home, 'deploy/ccrc-mail.token'), 'live-shared-secret\n');
    gitInit(treeRoot(home));
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(placed(home, 'server', 'node_modules', 'leftpad'))).toBe(false);
    expect(existsSync(placed(home, '.git')), 'the placed tree is a git repository').toBe(false);
    expect(existsSync(placed(home, 'deploy', 'ccrc.env'))).toBe(false);
    expect(existsSync(placed(home, 'deploy', 'ccrc-mail.token'))).toBe(false);
    // …and the excludes were spelled to rsync, not achieved by the fixture
    // being empty of them: the recorder saw the flags on the real command line.
    const argv = read(join(home, 'rsync-argv'));
    for (const ex of ['--exclude node_modules', '--exclude .git',
      "--exclude *.env", '--exclude ccrc-mail.token']) {
      expect(argv).toContain(ex);
    }
  });

  it('installs the server runtime deps INTO THE PLACED TREE, production only', () => {
    // `npm ci --omit=dev` and not `npm run build`: the divergence from deploy
    // recorded in the step's own comment. deploy builds on the box because it
    // ships sources across boxes; install IS the box, so the build is already
    // in the tree it just placed and only the runtime dependencies are missing.
    const home = freshBox('ccrc-install-npm-');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(read(join(home, 'npm-argv')).trim()).toBe('ci --omit=dev --no-audit --no-fund');
    // In the placed version's `server/`, never in the checkout: a box whose
    // service boots out of `~/ccrc` needs the deps in the tree it points at.
    expect(read(join(home, 'npm-cwd')).trim()).toBe(versionDir(home, 'server'));
    expect(existsSync(placed(home, 'server', 'node_modules'))).toBe(true);
    expect(r.stdout).toMatch(/^install: tree: server runtime deps in place$/m);
  });

  it('lets npm SAY WHY when the dependency install fails', () => {
    // FIX ROUND 1, IMPORTANT 2. This is the verb's most likely failure — a
    // registry hiccup, no network, a lockfile out of step with package.json —
    // and `>/dev/null 2>&1` left the operator with "npm ci … failed" and no
    // way to see which. The rule is written down one step over
    // (`_inst_accounts_sh`: "stderr is deliberately NOT captured … re-wording a
    // fix into a shrug helps nobody") and deploy already obeys it, since its
    // `npm ci` runs over ssh with both streams attached.
    //
    // npm's STDOUT is redirected to stderr rather than kept: an install
    // transcript is one `install: <step>: <result>` line per step on stdout,
    // and "added 41 packages in 3s" is not this run's result. Both halves are
    // asserted — the diagnosis reaches stderr, and stdout stays a transcript.
    const home = freshBox('ccrc-install-npm-fails-');
    const r = runInstall(home, ['install'], {}, {
      stubs: {
        npm: '#!/bin/sh\necho "npm notice: reaching the registry" \n'
          + 'echo "npm ERR! code ENOTFOUND registry.npmjs.org" >&2\nexit 1\n',
      },
    });
    expect(r.code).toBe(1);
    expect(r.stderr, 'npm\'s own diagnosis never reached the operator')
      .toContain('npm ERR! code ENOTFOUND registry.npmjs.org');
    // …and the step's refusal still stands beside it, naming the consequence.
    expect(r.stderr).toMatch(
      /^ccrc: npm ci in \$HOME\/ccrc-versions\/unstamped-[0-9a-f]{12}\/server failed — the service cannot start without runtime deps$/m);
    expect(r.stdout, 'npm\'s chatter landed in the install transcript')
      .not.toContain('npm notice');
    expect(r.stdout).not.toMatch(/^install: tree: server runtime deps in place$/m);
  });

  it('run FROM a real $HOME/ccrc, it MIGRATES rather than copying onto itself: the tree is placed as a version, $HOME/ccrc becomes the link, and the old directory goes only once the doctor gate has passed (W6 Task 3)', () => {
    // The box a deploy already touched, and the box a second pre-W6 `ccrc
    // install` ran on: `ccrc` is at `~/ccrc/ccd/ccrc`, a real directory. It
    // is no longer the destination — the tree goes to ~/ccrc-versions/<name>,
    // so there is nothing to copy onto itself — and the directory is moved
    // aside, not deleted, until this install's own gate (its doctor, with
    // the update lock free) has passed.
    const home = mkTmp('ccrc-install-selfcopy-');
    const root = installFixtureTree(home, 'ccrc');
    // The only fixture in this describe that does not come from `freshBox`
    // (its tree has to BE `~/ccrc`), so it asks for the doctor half by hand.
    healthyDoctorBox(home);
    const r = runInstall(home, ['install'], {}, { from: ccrcIn(root) });
    expect(r.code, r.stderr).toBe(0);
    // No git, no build.json and no box stamp: the source names itself
    // `unstamped-<12 hex>` (D-3425), read back off the link.
    const target = readlinkSync(placed(home));
    const name = path.basename(target);
    expect(name).toMatch(/^unstamped-[0-9a-f]{12}$/);
    expect(target).toBe(join(home, 'ccrc-versions', name));
    // ONE rsync, from the directory INTO the version — never onto itself.
    const argv = read(join(home, 'rsync-argv')).trim().split('\n');
    expect(argv).toHaveLength(1);
    expect(argv[0]!.endsWith(` ${join(home, 'ccrc-versions', name)}/`), argv[0]).toBe(true);
    expect(existsSync(join(home, 'ccrc-versions', name, 'ccrc')), 'the tree was copied inside itself').toBe(false);
    const lines = r.stdout.split('\n');
    expect(lines).toContain(`install: tree: migrating — $HOME/ccrc is a directory; ${name} is complete at $HOME/ccrc-versions/${name}`);
    expect(lines).toContain(`install: tree: $HOME/ccrc -> $HOME/ccrc-versions/${name} (the pre-versioned tree is kept at $HOME/ccrc.migrating until a health gate passes)`);
    // The old tree went AFTER the doctor had measured the box — the removal
    // line follows doctor's summary — and the marker went with it.
    const summary = r.stdout.lastIndexOf('\nsummary: ');
    const removed = r.stdout.indexOf('install: migration: $HOME/ccrc.migrating removed — ccrc doctor passed; a plain install is its own gate');
    expect(summary, 'doctor printed no summary').toBeGreaterThan(-1);
    expect(removed, r.stdout).toBeGreaterThan(summary);
    expect(existsSync(join(home, 'ccrc.migrating'))).toBe(false);
    expect(existsSync(dotCcrc(home, 'migrating-to'))).toBe(false);
    // …and the deps were installed in the VERSION, whose tree now runs.
    expect(read(join(home, 'npm-cwd')).trim()).toBe(join(home, 'ccrc-versions', name, 'server'));
  });

  it('refuses BY NAME when rsync is not on this box', () => {
    // The one tool this verb cannot substitute for. Without a by-name refusal
    // the failure arrives as `rsync: command not found` on stderr plus
    // "placing the tree at … failed", which names neither the missing package
    // nor the fix.
    const home = freshBox('ccrc-install-norsync-');
    const r = runInstall(home, ['install'], { PATH: pathWithout(home, 'rsync') },
      { omit: ['rsync'] });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: rsync is required to place the tree — sudo apt install rsync$/m);
    expect(existsSync(placed(home)), 'a half-made $HOME/ccrc was left behind').toBe(false);
    expect(existsSync(join(home, 'ccrc-versions')), 'the versions root was made before rsync was known to be there').toBe(false);
  });

  it('replaces a file whose size and mtime are unchanged but whose content is not', () => {
    // The release tarball is reproducible (`build-release.sh`: `--mtime=@0`),
    // so every file `ccrc update` extracts — and therefore every file it placed
    // last time — has mtime 0. rsync's default quick check compares size and
    // mtime only, so a changed file that kept its size was SKIPPED. v0.0.11 hit
    // exactly that: dist-pwa/index.html and sw.js are fixed-size templates
    // around equal-length content hashes, so the new bundle landed, --delete
    // removed the old one, and the old index.html kept pointing at it — a
    // black screen on any load the service worker did not answer.
    const home = freshBox('ccrc-install-same-size-');
    // W6 Task 2: one commit, so both runs name the same version and the
    // second rsyncs IN PLACE — the only placement where a file of the same
    // size and mtime is already at the destination for the quick check to skip.
    gitInit(treeRoot(home));
    expect(runInstall(home).code).toBe(0);
    const rel = 'server/dist-pwa/index.html';
    const before = read(placed(home, ...rel.split('/')));
    const after = before.replace(/./, c => (c === 'X' ? 'Y' : 'X'));
    expect(after.length).toBe(before.length);
    expect(after).not.toBe(before);
    writeFileSync(treeFile(home, rel), after);
    utimesSync(treeFile(home, rel), 0, 0);
    utimesSync(placed(home, ...rel.split('/')), 0, 0);
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^install: tree: reinstalled untagged-[0-9a-f]{12} in place at \$HOME\/ccrc-versions\/untagged-[0-9a-f]{12} \(the version \$HOME\/ccrc points at; same name, same release\)$/m);
    expect(read(placed(home, ...rel.split('/')))).toBe(after);
    expect(read(join(home, 'rsync-argv'))).toContain('--checksum');
  });

  it('a second run keeps the runtime deps the first one installed', () => {
    // `--delete` with `--exclude node_modules` protects the excluded path on
    // the RECEIVER (rsync does not delete what it was told to ignore, absent
    // `--delete-excluded`). Drop that exclude and every re-install wipes
    // `~/ccrc/server/node_modules` — on the live box, that is a server with no
    // runtime deps for however long the reinstall takes.
    const home = freshBox('ccrc-install-deps-survive-');
    // W6 Task 2: one commit, so the second run is the same version, in place.
    gitInit(treeRoot(home));
    expect(runInstall(home).code).toBe(0);
    writeFileSync(placed(home, 'server', 'node_modules', 'marker'), 'installed by run 1\n');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(placed(home, 'server', 'node_modules', 'marker'))).toBe(true);
  });
});

describe('ccrc install: the fixture tree', () => {
  it('is the one the generator needs — proven by running it inside the fixture', () => {
    // A scan over an empty list passes everything, and a fixture missing one
    // `shared/*.mjs` fails as "install died" three describes further down,
    // where the reason is invisible. This runs the generator the way the verb
    // runs it — from inside the tree, against the tree's own seed — so a
    // TREE_FILES list that has gone incomplete says so HERE, in one line.
    const home = freshBox('ccrc-install-tree-');
    const r = spawnSync('node',
      [treeFile(home, 'deploy/gen-accounts.mjs'), treeFile(home, 'deploy/accounts.default.json')],
      { encoding: 'utf8' });
    expect(r.stderr, 'the fixture tree cannot run its own generator').toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^# ccrc:generated 1 sha256=[0-9a-f]{64}$/m);
  });

  it('is a COPY — a test may corrupt it without touching this checkout', () => {
    const home = freshBox('ccrc-install-tree-copy-');
    writeFileSync(treeFile(home, 'deploy/accounts.default.json'), 'clobbered');
    expect(read(join(REPO, 'deploy', 'accounts.default.json'))).toBe(DEFAULT_SEED);
  });

  it('the fixture tree carries the five GPT-lane executables the repository ships, and no `ccgpt`', () => {
    // Plan 2b-2 wrote `ccgpt-runtime` and the launcher `ccrc-codex` unplaced,
    // because a file may land before its install line but never after it.
    // Both then joined `_inst_bins` and this fixture in one commit, and the
    // auth library `ccgpt-auth.py` joined the same way in codex bridge Stage 1
    // Task 5, so all five are COPIED from the repository like every other
    // executable. They are never stubbed: a stub once let a placement pass
    // here while a real tree would die (D-3165). The pin this case replaced
    // held the Plan 2b-2 pair OUT of the fixture tree (and `ccgpt-runtime` in
    // the repository) until their commit, and flipping it was that commit's
    // intended red.
    //
    // And NOT `ccgpt` (D-3478): on a live fleet box `$HOME/.local/bin/ccgpt`
    // is another repository's launcher, so the repository ships no file of that
    // name for any installer to place over it.
    const home = mkTmp('ccrc-tree-ccgpt-');
    const root = installFixtureTree(home);
    for (const rel of GPT_LANE_BINS.map((n) => `ccd/${n}`)) {
      const p = join(root, rel);
      expect(existsSync(p), `${rel} missing from the fixture tree`).toBe(true);
      expect(readFileSync(p), `${rel} is not the repository's bytes`).toEqual(readFileSync(join(REPO, rel)));
      // 0o111 — all five are placed 755 by `_inst_bins`, and copied at the repo's mode.
      expect(statSync(p).mode & 0o111, `${rel} is not executable`).toBeGreaterThan(0);
    }
    expect(existsSync(join(REPO, 'ccd', 'ccgpt')),
      'the repository ships ccd/ccgpt — an installer could place it over another repository\'s live launcher').toBe(false);
    expect(existsSync(join(root, 'ccd', 'ccgpt')), 'the fixture tree carries a ccd/ccgpt').toBe(false);
  });

  it('GPT_LANE_BINS is what _inst_bins\' GPT-lane gate places, in the order its closing line names them (final review F4, a text pin)', () => {
    // The ONE test-side list the install and uninstall suites share. The
    // product's two spellings of it, both inside the `!= server` gate: the
    // `_inst_atomic` calls, and the `lane_bins=` literal the closing line
    // carries. A sixth executable, a rename or a new order in either reds
    // here, before any case written from the constant can drift.
    const src = read(join(REPO, 'ccd', 'ccrc'));
    const fn = /^_inst_bins\(\) \{[^\n]*\n[\s\S]*?\n\}\n/m.exec(src)?.[0] ?? '';
    const gate = /^ {2}if \[ "\$INST_ROLE" != server \]; then\n([\s\S]*?)\n {2}fi\n/m.exec(fn)?.[1] ?? '';
    expect(gate, 'no `!= server` gate in _inst_bins this pin can read — re-anchor it').not.toBe('');
    const placed = [...gate.matchAll(/^\s*_inst_atomic "\$tree\/ccd\/([^"]+)"\s+"\$bin\/\1"\s+755$/gm)].map((m) => m[1]);
    expect(placed).toEqual([...GPT_LANE_BINS]);
    const said = /^\s*lane_bins=", ([^"]+)" lane_note=""$/m.exec(gate)?.[1];
    expect(said?.split(', ')).toEqual([...GPT_LANE_BINS]);
  });

  it('the whole-spine cases the final review measured near the 20 s default carry an explicit bound (final review F4, a text pin)', () => {
    // Each one's closing line, found from its own title: dropping a bound
    // reds here rather than as a load flake a week later.
    const src = INSTALL_FAMILY_FILES.map((f) => read(f)).join('\n');
    for (const title of [
      'writes ~/.ccrc/installed LAST, naming the stamped sha',
      'floor: written by the LAST step from the stamped tag',
      'ccrc version says when the install was placed unsigned',
      'a codex lane and a passing runtime: built, stamped',
      'a runtime whose probe FAILS degrades the install',
    ]) {
      const at = src.indexOf(`  it('${title}`);
      expect(at, `no case titled ${title}`).toBeGreaterThan(-1);
      const close = /^ {2}\}(?:, ([0-9_]+))?\);$/m.exec(src.slice(at));
      expect(close?.[1], `'${title}' runs under the default bound again`).toBe('60_000');
    }
  });
});

describe('ccrc install: a fresh box', () => {
  it('seeds the roster with the shipped default, byte for byte', () => {
    // BYTE FOR BYTE, not "an equivalent roster": `~/.ccrc/accounts.json` is
    // USER-OWNED config that ccrc will never rewrite, so whatever lands here
    // is what the operator inherits and edits. A seed that had been
    // re-serialised (key order, indentation) would be a file the operator did
    // not choose and cannot diff against the tree they installed from.
    const home = freshBox('ccrc-install-fresh-roster-');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(read(dotCcrc(home, 'accounts.json'))).toBe(DEFAULT_SEED);
    expect(r.stdout).toMatch(/^install: roster: seeded single-account default$/m);
  });

  it('generates accounts.sh from it — marked, parseable, and 644 under any umask', () => {
    // RUN UNDER `umask 077`, deliberately (round-1 review, Minor 1). The mode
    // assertion below is about `_inst_accounts_sh`'s explicit `chmod 644`, and
    // under the ordinary `umask 022` a plain `>` redirect produces 0644 all by
    // itself — so the assertion passed with the `chmod` DELETED, measured. The
    // guard's redness was an accident of whose shell ran the suite (this box
    // masks 0002 and did go red; CI at 022 did not). At 077 the redirect
    // produces 0600 and 0644 can only come from the chmod: re-measured, the
    // deletion is now 1 red here.
    const home = freshBox('ccrc-install-fresh-accounts-sh-');
    const r = runInstall(home, ['install'], {}, { umask: '077' });
    expect(r.code, r.stderr).toBe(0);
    const sh = dotCcrc(home, 'accounts.sh');
    // The provenance marker `shared/mark.mjs` writes. Its presence is what
    // makes this file recognisably ccrc-OWNED — the opposite rule to the two
    // seeded files, and what lets a later run replace it without asking.
    expect(read(sh)).toMatch(/^# ccrc:generated 1 sha256=[0-9a-f]{64}$/m);
    // `ccd` SOURCES this file on every invocation and dies without it, so
    // "bash can parse it" is the minimum bar for a box that works at all.
    const parsed = spawnSync('bash', ['-n', sh], { encoding: 'utf8' });
    expect(parsed.stderr).toBe('');
    expect(parsed.status).toBe(0);
    expect(statSync(sh).mode & 0o777).toBe(0o644);
    expect(r.stdout).toMatch(/^install: accounts\.sh: generated from \$HOME\/\.ccrc\/accounts\.json$/m);
  });

  it('writes ccrc.env for a single box: local fleet mode, localhost, this HOME', () => {
    const home = freshBox('ccrc-install-fresh-env-');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    const env = read(dotCcrc(home, 'ccrc.env'));
    expect(env).toMatch(/^CCRC_FLEET=local$/m);
    expect(env).toMatch(/^CCRC_HOST=127\.0\.0\.1$/m);
    expect(env).toMatch(/^CCRC_PORT=7788$/m);
    // Expanded at WRITE time, not left as a `$HOME` this file's readers would
    // have to expand: `_box_env_value` reads values literally and the server
    // reads this file through systemd's `EnvironmentFile=`, which does no
    // shell expansion at all.
    expect(env).toMatch(new RegExp(`^CCRC_PROJECTS_ROOT=${home}/projects$`, 'm'));
    // …and it points at the file that documents the keys it does NOT carry
    // (the tokens), rather than shipping them empty here.
    expect(env).toMatch(/deploy\/ccrc\.env\.example/);
    expect(r.stdout).toMatch(/^install: ccrc\.env: written \(localhost, local fleet mode\)$/m);
  });

  it("seeds the remote-control flag OFF — one line, and the trailing newline its reader requires", () => {
    // Stage 2e, Task 2. THE ASSERTION IS ON THE BYTES, and that is the whole
    // point of it: `ccd`'s `_rc_enabled` reads this file with
    // `IFS= read -r first < "$CCRC_RC_FILE"`, and bash's `read` returns
    // NON-ZERO at EOF-before-delimiter — so `printf 'on' > file` (no newline)
    // reads as OFF. The direction is fail-safe and deliberately left that way
    // (D-99), which makes the trailing newline this writer's obligation rather
    // than the reader's problem. A `toContain('off')` would pass with the
    // newline dropped, i.e. against a writer that produces a file whose only
    // honest reading is "unparseable".
    //
    // OFF on a FRESH box, not on: `--remote-control` publishes a session to
    // claude.ai, and a box nobody asked that of must not start doing it
    // because an installer defaulted it. The reference fleet gets `on` from
    // the other lane (deploy.sh), where the box's existing behaviour is the
    // reason.
    const home = freshBox('ccrc-install-fresh-rc-');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(read(dotCcrc(home, 'remote-control'))).toBe('off\n');
    expect(r.stdout).toMatch(
      /^install: remote-control: off \(fresh installs default off — edit ~\/\.ccrc\/remote-control to 'on' for claude\.ai discoverability\)$/m);
  });

  it('names the box and the tree — the two things it measured — before it changes anything', () => {
    // The two inputs every step is computed from. A run under the wrong HOME
    // (sudo) or out of the wrong tree (a stale `~/ccrc` rather than the
    // checkout just edited) SUCCEEDS at the wrong thing, so both are stated in
    // the transcript rather than deduced from the result.
    //
    // BOTH LINES ARE PINNED WHOLE, because the banner is the one thing here
    // that prints without deciding anything, and a printer nothing can go red
    // for is a comment. Measured: deleting the `tree` line, and garbling the
    // `box` line's format string, each turn this test red on its own.
    const home = freshBox('ccrc-install-banner-');
    const r = runInstall(home);
    const lines = r.stdout.split('\n');
    expect(lines[0]).toBe(`install: box: ${home}`);
    expect(lines[1]).toBe(`install: tree: ${treeRoot(home)}`);
    // …and it CLAIMS nothing. The banner used to end "— single-box, local fleet
    // mode on localhost", asserted before a byte had been read; the arm in
    // `the files the operator owns` below is the box where that is false.
    expect(lines[0]).not.toMatch(/fleet mode|localhost|127\.0\.0\.1/);
  });

  it('finishes clean: exit 0, nothing on stderr, no temp files left behind', () => {
    const home = freshBox('ccrc-install-clean-');
    const r = runInstall(home);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    expect(strays(home)).toEqual([]);
  });
});

describe('ccrc install: the files the operator owns', () => {
  // The rule `deploy/deploy.sh#ship_roster` and `#ship_env` state and this verb inherits:
  // `accounts.json` and `ccrc.env` are created once and never overwritten.
  // Everything in this describe is one half of that.
  it('keeps a roster the box already had, and generates accounts.sh FROM IT', () => {
    // The five-account test roster. `claude-b` appears in
    // it and in nothing the seed could produce, so its presence in the
    // generated bash is proof the generator read the INSTALLED roster rather
    // than the shipped default — the local translation of deploy's
    // read-the-box's-copy-back rule.
    const home = freshBox('ccrc-install-kept-roster-');
    preexisting(home, 'accounts.json', FIVE_ACCOUNT_ROSTER);
    // `gpt` is that roster's EXTERNAL account — somebody else's hand-written
    // launcher, which no ccrc verb ever writes. On the reference box it is 142
    // lines of bash; here it only has to exist, because doctor's `wrappers`
    // check runs at the end of this same install and an external account with
    // no executable is a genuine FAIL. (The three `generated` accounts need no
    // fixture: `_inst_wrappers` writes those itself, which is the point.)
    writeFileSync(join(home, '.local', 'bin', 'gpt'),
      '#!/usr/bin/env bash\n# somebody else\'s launcher; ccrc never writes this\nexec /usr/bin/env gpt "$@"\n',
      { mode: 0o755 });
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(read(dotCcrc(home, 'accounts.json'))).toBe(FIVE_ACCOUNT_ROSTER);
    expect(read(dotCcrc(home, 'accounts.sh'))).toContain('claude-b');
    expect(r.stdout).toMatch(/^install: roster: kept \(user-owned, never overwritten\)$/m);
  });

  it('keeps a ccrc.env the operator wrote, byte for byte', () => {
    // A real one carries tokens. Overwriting it — or "merging" into it — would
    // be this verb's most damaging possible bug, so the assertion is on the
    // whole file's bytes rather than on the keys it happens to name.
    const home = freshBox('ccrc-install-kept-env-');
    const mine = [
      '# my box, my rules',
      'CCRC_FLEET=remote',
      // LOOPBACK, and not by accident (W4, design 2026-09-20 §12): with the
      // gate off, a routable bind is exactly what doctor's `update-exposure`
      // check FAILs — this box's routes answer anyone who can reach it — and
      // this test is about a file being KEPT, not about that finding. The
      // `fleet`/`config` reasoning below is the same rule.
      'CCRC_HOST=127.0.0.1',
      'CCRC_PORT=9999',
      // Both agent keys, because `CCRC_FLEET=remote` with either one missing is
      // a config the server REFUSES TO BOOT on (server/src/index.ts, its `CCRC_FLEET=remote requires` refusal), and
      // doctor's `config` check reproduces that refusal at the end of this same
      // run. A half-configured remote box is a real state and it has its own
      // test in the `ccrc-doctor-*` test files; this test is about a file being kept, and
      // a fixture that was also secretly a broken-config fixture would fail for
      // the wrong reason.
      'CCRC_AGENT_URL=ws://198.51.100.7:7789',
      'CCRC_AGENT_TOKEN=not-a-real-token-but-it-is-mine',
      '',
    ].join('\n');
    preexisting(home, 'ccrc.env', mine);
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(read(dotCcrc(home, 'ccrc.env'))).toBe(mine);
    expect(r.stdout).toMatch(/^install: ccrc\.env: kept \(user-owned, never overwritten\)$/m);
    // …and the transcript does not tell this operator their box is in local
    // fleet mode on localhost, which is what the banner used to assert
    // unconditionally (round-1 review, Minor 2). This box says `remote`, the
    // run kept that file, and nothing in the run established otherwise: a
    // transcript that claimed it would be describing a box nobody has.
    expect(r.stdout).not.toMatch(/local fleet mode|localhost/);
  });

  it('keeps a remote-control flag the box already had, byte for byte, on every re-run', () => {
    // The THIRD file on the user-owned side of `deploy.sh#ship_roster`'s rule, and
    // the one whose overwrite is loudest: this flag decides what every session
    // on the box is SPAWNED AS, so a step that rewrote it would change the
    // shape of ~11 live panes at their next respawn — the exact outage D-99
    // records and the reason Task 1's ccd was deploy-blocked until this step
    // existed.
    //
    // TWO RUNS, because "seed once" and "never overwrite" are two claims and
    // only the second one is about a box that has already been installed. The
    // bytes are compared whole (not "contains on") for `_inst_env`'s reason:
    // an operator's file is theirs, including the newline they ended it with.
    const home = freshBox('ccrc-install-kept-rc-');
    preexisting(home, 'remote-control', 'on\n');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(read(dotCcrc(home, 'remote-control'))).toBe('on\n');
    expect(r.stdout).toMatch(/^install: remote-control: kept \(operator-owned\)$/m);
    const again = runInstall(home);
    expect(again.code, again.stderr).toBe(0);
    expect(read(dotCcrc(home, 'remote-control'))).toBe('on\n');
    expect(again.stdout).toMatch(/^install: remote-control: kept \(operator-owned\)$/m);
  });
});

describe('ccrc install: a roster that does not validate', () => {
  // "Validate before you mutate" in both directions: the roster the box HAS
  // and the seed the tree SHIPS. A box seeded with an unusable roster is
  // poisoned permanently — the very rule that makes the file safe to own
  // (never overwritten) is what stops the next run from repairing it.
  const BROKEN = '{"version":1,"accounts":[]}';

  it('refuses, passes the generator\'s own remedy through, and writes nothing', () => {
    const home = freshBox('ccrc-install-bad-roster-');
    preexisting(home, 'accounts.json', BROKEN);
    const r = runInstall(home);
    expect(r.code).toBe(1);
    // The generator's diagnosis reaches the operator VERBATIM, remedy line and
    // all, because `_inst_accounts_sh` captures stdout only. Re-wording it here
    // would replace a fix with a shrug.
    expect(r.stderr).toMatch(/^gen-accounts: remedy: Add at least one account/m);
    expect(r.stderr).toMatch(/^ccrc: \$HOME\/\.ccrc\/accounts\.json does not validate/m);
    // NOTHING else was written: not the bash projection of a roster that does
    // not parse, and not the env file two steps later. An install that half-ran
    // leaves a box in a state no one designed.
    expect(read(dotCcrc(home, 'accounts.json'))).toBe(BROKEN);
    expect(existsSync(dotCcrc(home, 'accounts.sh'))).toBe(false);
    expect(existsSync(dotCcrc(home, 'ccrc.env'))).toBe(false);
    expect(strays(home)).toEqual([]);
  });

  it('refuses to SEED a shipped seed that does not validate — before it lands', () => {
    // The tree's own seed, corrupted. This is `deploy.sh`'s `check_local_roster`
    // (F1) translated to one box, and the assertion that matters is the
    // ORDERING one: `accounts.json` must not exist afterwards. Placing it and
    // discovering the problem one step later would leave exactly the permanent
    // poisoning the check exists to prevent.
    const home = freshBox('ccrc-install-bad-seed-');
    writeFileSync(treeFile(home, 'deploy/accounts.default.json'), '{"version":1,"accounts":[]}');
    const r = runInstall(home);
    expect(r.code).toBe(1);
    // FIRST, and before the message: with the validation call deleted the run
    // still exits 1 (the generator refuses one step later, on the same bytes),
    // so an assertion order that checked the wording first would report the
    // mutation as a message change rather than as the permanent-poisoning bug
    // it is. Measured: this line is what goes red.
    expect(existsSync(dotCcrc(home, 'accounts.json')),
      'the seed was placed before it was validated').toBe(false);
    expect(r.stderr).toMatch(/^ccrc: the shipped roster seed does not validate/m);
    expect(existsSync(dotCcrc(home, 'accounts.sh'))).toBe(false);
    expect(strays(home)).toEqual([]);
  });

  it('refuses by NAME when the tree has no seed at all', () => {
    // "Run install from inside the shipped tree" is a different instruction
    // from "your roster is broken", and an operator who ran `ccrc install` off
    // a half-copied directory needs the first one.
    const home = freshBox('ccrc-install-no-seed-');
    rmSync(treeFile(home, 'deploy/accounts.default.json'));
    const r = runInstall(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: no roster seed at .*deploy\/accounts\.default\.json — run install from inside the shipped tree$/m);
    expect(existsSync(dotCcrc(home, 'accounts.json'))).toBe(false);
  });
});

describe('ccrc install: a box with no node', () => {
  // Round-1 review, Important 1. `install` is the ONE verb an operator runs on
  // a box that may genuinely not have node yet — and every roster step runs
  // `deploy/gen-accounts.mjs`, which IS node. Without a by-name probe the
  // interpreter's absence arrives as the generator "failing", i.e. as "your
  // config does not validate": a missing DEPENDENCY and a corrupt FILE
  // collapsed into one signal, which is the overloaded-seam mistake this
  // file's own header bans and which `cmd_wrappers` (ccd/ccrc:1184-1190)
  // already refuses in exactly this shape, ten lines up.
  it('refuses by name, before touching anything, and does not blame the config', () => {
    const home = freshBox('ccrc-install-no-node-');
    const r = runInstall(home, ['install'], { PATH: pathWithout(home, 'node') });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: node is required by 'ccrc install'/m);
    // The half that matters: nothing in the refusal points at the operator's
    // config. "does not validate" sends someone to debug a file that is fine.
    expect(r.stderr).not.toMatch(/does not validate/);
    expect(r.stderr).not.toMatch(/roster/);
    // …and it fires BEFORE the first step, so the run has neither printed a
    // transcript it is not going to finish nor created `~/.ccrc`.
    expect(r.stdout).toBe('');
    expect(existsSync(join(home, '.ccrc'))).toBe(false);
  });

  it('never tells the operator to move a roster they already have aside', () => {
    // The sharper half of the same finding: on an already-seeded box the
    // collapsed message read "$HOME/.ccrc/accounts.json does not validate — fix
    // it (or move it aside to reseed) and re-run" — a confident instruction to
    // disturb USER-OWNED config for a cause that has nothing to do with it.
    // The roster here is the five-account one this fleet really runs, and it is
    // perfectly valid.
    const home = freshBox('ccrc-install-no-node-seeded-');
    preexisting(home, 'accounts.json', FIVE_ACCOUNT_ROSTER);
    const r = runInstall(home, ['install'], { PATH: pathWithout(home, 'node') });
    expect(r.code).toBe(1);
    expect(r.stderr).not.toMatch(/move it aside/);
    expect(read(dotCcrc(home, 'accounts.json'))).toBe(FIVE_ACCOUNT_ROSTER);
    expect(existsSync(dotCcrc(home, 'accounts.sh'))).toBe(false);
    expect(existsSync(dotCcrc(home, 'ccrc.env'))).toBe(false);
  });
});

describeLinux('ccrc install: a box with no systemd', () => {
  // The sibling of the node probe above, added in fix round 1 (Minor 2). Every
  // ccrc service and every ccd session is a `systemd --user` unit, so a box
  // with no systemctl cannot run a fleet — but until the probe existed it
  // found that out at STEP 10, having already written `~/.ccrc`,
  // `~/.local/bin`, `~/ccrc` and the operator's `~/.tmux.conf`, and it said so
  // in a sentence whose remedy named the command the box does not have
  // (`systemctl --user status ccrc.service`).
  it('refuses by name BEFORE the first write, and does not blame the units', () => {
    const home = freshBox('ccrc-install-nosystemd-');
    const r = runInstall(home, ['install'], { PATH: pathWithout(home, 'systemctl') },
      { omit: ['systemctl'] });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(
      /^ccrc: systemctl is required by 'ccrc install' — every ccrc service and every ccd session is a systemd --user unit, and this box has no systemctl on PATH\./m);
    // The two conditions stay apart: this is not "systemd refused these units".
    expect(r.stderr).not.toMatch(/daemon-reload failed/);
    // NOTHING was written — the whole point of probing before the first step.
    // (`.local/bin` exists because the runner plants its stubs there; what must
    // not be in it is anything this verb installs.)
    expect(existsSync(join(home, '.ccrc')), '$HOME/.ccrc was created anyway').toBe(false);
    expect(existsSync(placed(home)), 'the tree was placed anyway').toBe(false);
    expect(existsSync(join(home, '.local', 'bin', 'ccd'))).toBe(false);
    expect(existsSync(join(home, '.tmux.conf'))).toBe(false);
    expect(r.stdout).toBe('');
  });
});

describe('ccrcEnv: containment (wave 9 R10d)', () => {
  it('ccrcEnv hands out no env under which a real ssh, scp, systemctl, systemd-run, launchctl, tmux, gh or curl can run, and no real user bus (wave 9 R10d)', () => {
    const home = mkTmp('ccrc-install-contained-');
    expect(() => assertNoRealTool(ccrcEnv(home), home)).not.toThrow();
  });
});

// The same probe, on the platform where the missing dependency is real. macOS
// ships neither tmux nor flock, and its /bin/bash is 3.2.57 — so on this
// platform the refusal an operator actually meets is one of THOSE, and it
// carries the same three promises the systemd one does: by name, before the
// first write, with a remedy that works.
// Wave 9 M7 (D-3812): runInstall's `noManager` option.
describe('runInstall: the noManager option (wave 9 M7)', () => {
  itLinux('noManager makes the final-env check require BOTH manager names absent — under ccrcEnv they resolve to the fixture front, so it refuses (wave 9 M7)', () => {
    expect(() => runInstall(freshBox('ccrc-install-nomgr-'), ['install'], {}, { noManager: true }))
      .toThrow(/systemd-run was expected absent/);
  }, 60_000);   // freshBox builds a whole tree: measured past the 20 s default under load 30-50 (final review)
});

describeDarwin('ccrc install: a macOS box missing what ccd needs', () => {
  // `omit` alone is not enough here: `runInstall` calls `replantDoctorStubs`
  // on every run, which copies `healthyDoctorBox`'s stubs back into
  // ~/.local/bin — so a tool this test wants ABSENT has to leave both places.
  // (Measured: without the second delete, tmux was re-planted, the gate never
  // fired, and the run died at the wrappers step for a reason this test is
  // not about.)
  // THE PATH IS BUILT EXPLICITLY, not by `pathWithout` alone, and the reason
  // is worth stating: `pathWithout` puts `~/.local/bin` at the HEAD, and that
  // directory is where the fixture's own stubs live — `ccrcEnv` plants them
  // and `replantDoctorStubs` puts them back on every run. A test about a tool
  // being ABSENT cannot leave that directory on PATH, because the stub of the
  // very tool it removed is in it. (Measured: with it, `launchctl` resolved to
  // the stub, the gate never fired, and the run died at the wrappers step for
  // a reason this test is not about.)
  //
  // Dropping it costs nothing HERE as to STUBS: every one of these probes
  // runs BEFORE the first of the fourteen steps, so no step is reached that
  // would want `claude`, `gh` or any other planted stub. It DOES cost something
  // on the macOS runner (wave 9 R10d, D-3821): `pathMissing` would keep only
  // `<home>/no-<tool>-bin`, which symlinks real binaries (`pathWithout`'s list)
  // — always `tmux` and, on darwin, `launchctl` — so with `~/.local/bin` gone a
  // real tmux and a real launchctl would resolve (gh, curl and ssh resolve
  // nowhere). So the PATH leads with a poison dir of its own, FIRST: a recording
  // poison for every contained name but the tool this case removes and the two
  // managers (the case reaches no manager — `noManager`). The probes only ask
  // `command -v` (the darwin dependency probes in ccd/ccrc), so a poison satisfies
  // a probe it is not the subject of.
  const pathMissing = (home: string, tool: string): string => {
    const full = pathWithout(home, tool);
    const poison = join(home, `no-${tool}-poison-bin`);
    mkdirSync(poison, { recursive: true });
    for (const n of CONTAINED_TOOLS) if (n !== tool && n !== 'systemctl' && n !== 'systemd-run') plantPoison(poison, n);
    return [poison, ...full.split(':').slice(1)].join(':');
  };

  it('refuses by name BEFORE the first write when tmux is absent', () => {
    const home = freshBox('ccrc-install-notmux-');
    const r = runInstall(home, ['install'], { PATH: pathMissing(home, 'tmux') },
      { omit: ['tmux'], noManager: true });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/tmux is required by ccrc/);
    expect(r.stderr).toMatch(/brew install tmux/);
    // NOTHING was written — the promise this probe exists to keep, and the
    // reason it sits ahead of the fourteen steps rather than inside them.
    expect(existsSync(join(home, '.ccrc')), '$HOME/.ccrc was created anyway').toBe(false);
    expect(existsSync(placed(home)), 'the tree was placed anyway').toBe(false);
    expect(existsSync(join(home, '.tmux.conf'))).toBe(false);
    expect(r.stdout).toBe('');
  });

  it('refuses when flock is absent, naming the formula that provides it', () => {
    const home = freshBox('ccrc-install-noflock-');
    const r = runInstall(home, ['install'], { PATH: pathMissing(home, 'flock') },
      { omit: ['flock'], noManager: true });
    expect(r.code).toBe(1);
    // ccd already refuses BY NAME at three workspace sites without it, so the
    // outcome this prevents is a box that installs cleanly and then cannot
    // make a single workspace.
    expect(r.stderr).toMatch(/flock is required by ccrc/);
    expect(r.stderr).toMatch(/brew install flock/);
    expect(existsSync(join(home, '.ccrc'))).toBe(false);
    expect(r.stdout).toBe('');
  });

  it('refuses when launchctl is absent — systemd\'s probe, on this platform', () => {
    const home = freshBox('ccrc-install-nolaunchctl-');
    const r = runInstall(home, ['install'], { PATH: pathMissing(home, 'launchctl') },
      { omit: ['launchctl'], noManager: true });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/launchctl is required by 'ccrc install'/);
    // The two conditions stay apart, exactly as they do on Linux: this is not
    // "launchd refused these jobs".
    expect(r.stderr).not.toMatch(/bootstrap failed/);
    expect(existsSync(join(home, '.ccrc'))).toBe(false);
    expect(r.stdout).toBe('');
  });
});

describe('ccrc install: re-running converges', () => {
  it('leaves the two seeded files alone and does not rewrite accounts.sh', () => {
    // Idempotence measured on MTIME, not on bytes: "the file still says the
    // right thing" is satisfied by a step that rewrites it every run, and a
    // converger that rewrites what it did not change is one an operator cannot
    // use to see what a run actually did. `_inst_accounts_sh` generates into a
    // variable and compares before it writes; this is the assertion that says
    // so.
    const home = freshBox('ccrc-install-idempotent-');
    expect(runInstall(home).code).toBe(0);
    const before = {
      roster: read(dotCcrc(home, 'accounts.json')),
      env: read(dotCcrc(home, 'ccrc.env')),
      shMtime: mtime(dotCcrc(home, 'accounts.sh')),
      sh: read(dotCcrc(home, 'accounts.sh')),
    };
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(read(dotCcrc(home, 'accounts.json'))).toBe(before.roster);
    expect(read(dotCcrc(home, 'ccrc.env'))).toBe(before.env);
    expect(read(dotCcrc(home, 'accounts.sh'))).toBe(before.sh);
    expect(mtime(dotCcrc(home, 'accounts.sh'))).toBe(before.shMtime);
    expect(r.stdout).toMatch(/^install: accounts\.sh: converged$/m);
    expect(strays(home)).toEqual([]);
  });

  it('DOES rewrite accounts.sh when the operator has edited the roster', () => {
    // The other half, and the reason the mtime assertion above is not simply
    // "this step never writes": a roster the operator changed between runs
    // must reach the bash projection `ccd` sources, or the box would run on a
    // roster nobody has any more.
    const home = freshBox('ccrc-install-regenerate-');
    expect(runInstall(home).code).toBe(0);
    const before = mtime(dotCcrc(home, 'accounts.sh'));
    writeFileSync(dotCcrc(home, 'accounts.json'), FIVE_ACCOUNT_ROSTER);
    // The external account that roster declares — see the kept-roster test
    // above: doctor's `wrappers` check runs at the end of this install too, and
    // an `external` account with no executable is a FAIL nobody here is asking
    // about.
    writeFileSync(join(home, '.local', 'bin', 'gpt'),
      '#!/usr/bin/env bash\nexec /usr/bin/env gpt "$@"\n', { mode: 0o755 });
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(read(dotCcrc(home, 'accounts.sh'))).toContain('claude-b');
    expect(mtime(dotCcrc(home, 'accounts.sh'))).not.toBe(before);
    expect(r.stdout).toMatch(/^install: accounts\.sh: generated from \$HOME\/\.ccrc\/accounts\.json$/m);
  });
});

describe('ccrc install: the env file is named once in the whole CLI', () => {
  it('install writes the file status and doctor read — through BOX_ENV_FILE', () => {
    // D-88. `ccd/ccrc:91-101` spells `~/.ccrc/ccrc.env` exactly once and says
    // why: "three copies of a path is how two of them end up reading a file the
    // third does not write." Task 6 made this file the WRITER as well as a
    // reader, so that sentence acquired a subject — and a second spelling in
    // `_inst_env` is precisely the drift it warns about. Text-scanned, in the
    // shape `single-definition.test.ts` uses for the build stamp: prose may
    // discuss the path anywhere, but a LINE OF SHELL that names it may exist
    // only once.
    const src = read(join(REPO, 'ccd', 'ccrc'));
    const code = src.split('\n').filter((l) => !l.trim().startsWith('#'));
    expect(code.filter((l) => l.includes('.ccrc/ccrc.env'))).toEqual([
      'BOX_ENV_FILE="$HOME/.ccrc/ccrc.env"',
    ]);
    // …and the writer really goes through it, rather than merely not spelling
    // the path (which deleting the step would also satisfy).
    const body = /_inst_env\(\)[\s\S]*?\n\}/.exec(src);
    expect(body, 'ccd/ccrc has no _inst_env').toBeTruthy();
    expect(body![0]).toContain('BOX_ENV_FILE');
  });
});

describe('ccrc install: the executables and files it installs', () => {
  // Every one of these is an artifact the fleet host RUNS and that no
  // installer placed before stage 1 (`deploy.sh`'s own "Stage 1:" note). They
  // divide into two kinds and the division is what `_inst_atomic` is for:
  //   - COPIES of a file in the tree (`ccd`, the cap-scopes enforcer, the two
  //     session hooks, notify, tmux.conf, the statusline), and
  //   - one GENERATED file, the launcher, whose bytes are pinned to the
  //     generator in deploy.sh (see its own test below).
  // `install_atomic`'s reasoning applies unchanged to all of them: bash
  // executes a script lazily from a saved byte offset, so overwriting the
  // inode of a script a process is running makes that process resume inside
  // the new bytes at the old offset. Every one lands by rename.

  /** One install onto a fresh box, shared by the read-only assertions below.
   *  Run at `umask 077`, which is what makes a mode assertion mean anything:
   *  at the ordinary 022 a plain `cp` reproduces the source's 0755 all by
   *  itself and the `chmod` could be deleted unnoticed (round-1 review, Minor
   *  1, measured on `_inst_accounts_sh`). At 077 the copy is 0700/0600 and any
   *  other mode can only come from the chmod. */
  const installed = ((): { home: string; r: Result } => {
    const home = freshBox('ccrc-install-artifacts-');
    return { home, r: runInstall(home, ['install'], {}, { umask: '077' }) };
  })();
  const mode = (p: string): number => statSync(p).mode & 0o777;

  it('the run this describe measures succeeded', () => {
    expect(installed.r.code, installed.r.stderr).toBe(0);
    expect(installed.r.stdout).toMatch(/^install: bins: /m);
    expect(installed.r.stdout).toMatch(/^install: files: /m);
  });

  it('ccd reaches PATH as an executable byte copy of the tree it was placed from', () => {
    // FROM THE PLACED TREE, not from the checkout. After `_inst_tree` the two
    // are identical, so the assertion cannot tell them apart — but the box's
    // own invariant can: the `ccd` on PATH and the `ccd` inside the tree the
    // launcher execs must be one version, and installing out of `~/ccrc` is
    // what makes that true by construction rather than by both happening to
    // come from the same run.
    // D-3696: what reaches PATH is now the LAUNCHER rendered from the placed
    // tree's template, and the byte copy is the BODY at libexec — the pair is
    // asserted whole below the original case.
    const { home } = installed;
    const bin = join(home, '.local', 'libexec', 'ccrc', 'ccd');
    expect(existsSync(bin), 'ccd\'s body never reached $HOME/.local/libexec/ccrc').toBe(true);
    // `'ccd/ccd'` as ONE segment, deliberately. `single-definition.test.ts`'s
    // extraction guard treats two adjacent quoted `ccd` arguments as a second
    // path to the REPOSITORY's ccd script (which must be reached only through
    // `ccdWsHelpers.ts`). This is a different file — the copy inside a fixture
    // box's `~/ccrc` — so the answer is to not wear that shape, rather than to
    // add this file to the guard's exclusion list and blind it to a real second
    // spelling arriving here later.
    expect(readFileSync(bin)).toEqual(readFileSync(placed(home, 'ccd/ccd')));
    expect(mode(bin)).toBe(0o644);
    // The launcher: the placed template rendered for the canonical python3 its
    // own shebang names and the body's digest — nothing else, byte for byte.
    const entry = join(home, '.local', 'bin', 'ccd');
    const python = /^#!(\S+) -IS\n/.exec(read(entry))?.[1];
    expect(python, 'the launcher does not open with an absolute isolated-python shebang').toMatch(/^\//);
    expect(read(entry)).toBe(renderCcdEntry(read(placed(home, 'ccd/ccd-entry.py')), python!,
      createHash('sha256').update(readFileSync(bin)).digest('hex')));
    expect(mode(entry)).toBe(0o755);
  });

  itLinux('ccd-cap-scopes lands beside it — the OOM guardrail is an executable too', () => {
    const { home } = installed;
    const bin = join(home, '.local', 'bin', 'ccd-cap-scopes');
    expect(readFileSync(bin)).toEqual(readFileSync(placed(home, 'ccd', 'ccd-cap-scopes')));
    expect(mode(bin)).toBe(0o755);
  });

  it('ccd-account-auth lands beside them on EVERY platform — macOS is supported', () => {
    // A plain `it`, where the two around it are `itLinux`. That is not an
    // oversight: `login` and `paste` drive a plain pipe and touch no
    // `script(1)`, so a Mac gets the DEFAULT path from this binary rather than
    // a no-op, and only the two pane methods degrade — inside the helper, at
    // runtime, with `pane-unsupported-here`.
    const { home } = installed;
    const bin = join(home, '.local', 'bin', 'ccd-account-auth');
    expect(readFileSync(bin)).toEqual(readFileSync(placed(home, 'ccd', 'ccd-account-auth')));
    expect(mode(bin)).toBe(0o755);
  });

  itLinux('ccd-graph-sweep lands beside it too (graphify Task 10, O3/O6b) — every role, but not Darwin', () => {
    // Mirrors the `ccd-cap-scopes` case above, byte for byte: `_inst_bins`
    // ships this one on every role the same way, and rides the same darwin
    // carve-out (its systemd timer never installs there; the script needs
    // GNU stat/date and flock(1)). Its UNIT and ENABLE are additionally
    // role-gated (server skips both) — see the `--role server` describe.
    const { home } = installed;
    const bin = join(home, '.local', 'bin', 'ccd-graph-sweep');
    expect(readFileSync(bin)).toEqual(readFileSync(placed(home, 'ccd', 'ccd-graph-sweep')));
    expect(mode(bin)).toBe(0o755);
  });

  itLinux('ccd-telemetry-keepalive lands beside it too (spec 2026-09-07 §C) — every role, but not Darwin', () => {
    // Mirrors the `ccd-graph-sweep` case above, byte for byte: `_inst_bins`
    // ships this one on every role the same way, and rides the same darwin
    // carve-out (its systemd timer never installs there; the script needs GNU
    // date/stat, flock(1) and jq). Its UNIT and ENABLE are additionally
    // role-gated (server skips both) — see the `--role server` describe.
    const { home } = installed;
    const bin = join(home, '.local', 'bin', 'ccd-telemetry-keepalive');
    expect(readFileSync(bin)).toEqual(readFileSync(placed(home, 'ccd', 'ccd-telemetry-keepalive')));
    expect(mode(bin)).toBe(0o755);
  });

  it('places the five GPT-lane executables on PATH, 755 — both platform arms', () => {
    // Unlike the three darwin-gated cases above, none of these is a timer-only
    // tool reserved to the systemd arm. `ccrc-codex` is the launcher every
    // generated Codex wrapper execs and `ccgpt-runtime` builds the runtime its
    // tiers run on — commands, on both arms, because the lifecycle's `nohup`
    // fallback makes a box with no user manager a supported one.
    // `ccgpt-proxy.py` is the shim a tier runs, and `ccgpt-usage.py` is placed
    // so an operator can run it by hand (no installer places its timer yet).
    // They ARE role-gated, `!= server` (spec §11): this install is role `both`,
    // the fleet describe pins `fleet`, and the `--role server` case pins their
    // absence.
    //
    // Fix round 1, Finding 1: each name joined `_inst_bins` no earlier than
    // the commit that wrote its source, because `_inst_atomic` dies on a
    // missing source by design. So this case covered only the two `.py`
    // files until Plan 2b-2 placed `ccgpt-runtime` and `ccrc-codex`, and it
    // was extended to four in the commit that placed them, and to five when
    // codex bridge Stage 1 Task 5 placed the auth library `ccgpt-auth.py`,
    // first.
    const { home } = installed;
    for (const name of GPT_LANE_BINS) {
      const bin = join(home, '.local', 'bin', name);
      expect(readFileSync(bin), `${name} was not placed`).toEqual(readFileSync(placed(home, 'ccd', name)));
      expect(mode(bin), `${name} mode`).toBe(0o755);
    }
  });

  itLinux('the DARWIN arm of _inst_bins, forced on Linux (OSTYPE=darwin23): the five GPT-lane executables on both and fleet, none on server', () => {
    // Final review F-8 (DAR-1): the two-arm placement and the Darwin closing
    // line were pinned only by `itDarwin`/`process.platform` branches, and no
    // CI leg runs those. `ccd/ccrc` takes its arm from `$OSTYPE` first
    // (ccd/ccrc's platform block), and bash keeps an OSTYPE it inherits, so
    // the child runs the Darwin arm here — `install: units:` naming
    // `$HOME/Library/LaunchAgents` is the control that it did.
    //
    // FORCED THROUGH `_inst_bins`, NOT THROUGH THE VERB. A later step of a
    // `both`/`fleet` install (the wrapper converger's `stat`) speaks BSD
    // userland on that arm, which a Linux box does not have, so the run exits
    // nonzero AFTER this function's work is done (measured: `stat answered for
    // 85 of the 17 id-shaped files`). The exit code is therefore not asserted:
    // what is asserted is everything `_inst_bins` did, which a step failing
    // later cannot undo.
    for (const role of ['both', 'fleet', 'server'] as const) {
      const home = freshBox(`ccrc-install-darwin-arm-${role}-`);
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      writeFileSync(join(home, '.ccrc', 'agent.env'),
        'CCRC_SERVER_URL=http://127.0.0.1:7788\nCCRC_AGENT_TOKEN=fixture-not-a-real-token\n');
      const r = runInstall(home, ['install', '--role', role], { OSTYPE: 'darwin23' });
      expect(r.stdout, `--role ${role}: the Darwin arm was not taken\n${r.stderr}`)
        .toMatch(/^install: units: .* in \$HOME\/Library\/LaunchAgents \(launchd\)$/m);
      const lane: string[] = role === 'server' ? [] : [...GPT_LANE_BINS];
      // wave 17 (D-5313): `ccrc-api` is on the Darwin arm too, off server only, like the lane's five.
      const api: string[] = role === 'server' ? [] : ['ccrc-api'];
      const bins = readdirSync(join(home, '.local', 'bin'))
        .filter((b) => !FIXTURE_BINS.includes(b) && b !== 'graphify').sort();
      expect(bins, `--role ${role}: what the Darwin arm of _inst_bins placed`)
        .toEqual(['ccd', 'ccd-account-auth', ...api, ...lane, 'ccrc'].sort());
      for (const name of lane) {
        const bin = join(home, '.local', 'bin', name);
        expect(readFileSync(bin), `${name} is not the placed tree's copy`).toEqual(readFileSync(placed(home, 'ccd', name)));
        expect(statSync(bin).mode & 0o777, `${name} mode`).toBe(0o755);
      }
      const line = r.stdout.split('\n').find((l) => l.startsWith('install: bins:'));
      expect(line, `--role ${role}: no \`install: bins:\` line`).toBeDefined();
      expect(line!, `--role ${role}: not the Darwin closing line`).toContain('macOS has none');
      if (role === 'server') {
        expect(line!, 'the server-role Darwin closing line claims a GPT-lane executable').not.toMatch(/ccgpt|ccrc-codex/);
        expect(line!, 'the server-role Darwin closing line names ccrc-api, which it never placed').not.toContain('ccrc-api');
      } else {
        expect(line!).toMatch(new RegExp(LANE_BINS_IN_LINE));
        expect(line!, `--role ${role}: the Darwin closing line does not name ccrc-api`).toMatch(/(?<![\w-])ccrc-api(?![\w-])/);
      }
    }
  });

  itLinux('ccd-tmp-sweep lands beside it too (the temp-dir reaper) — every role, but not Darwin', () => {
    // Mirrors the `ccd-graph-sweep` case above: `_inst_bins` ships it on every
    // role, on the same darwin carve-out (its only runner is a systemd timer
    // and it reads /proc). Its UNIT and ENABLE are additionally role-gated
    // (server skips both) — see the `--role server` describe.
    const { home } = installed;
    const bin = join(home, '.local', 'bin', 'ccd-tmp-sweep');
    expect(readFileSync(bin)).toEqual(readFileSync(placed(home, 'ccd', 'ccd-tmp-sweep')));
    expect(mode(bin)).toBe(0o755);
  });

  itLinux('ccd-scope-sweep lands beside it too (the pane-scope sweep) — every role, but not Darwin', () => {
    // Mirrors the reaper's case above: its only runner is a systemd timer and it
    // reads /proc and cgroups. Its UNIT and ENABLE are role-gated (server skips both).
    const { home } = installed;
    const bin = join(home, '.local', 'bin', 'ccd-scope-sweep');
    expect(readFileSync(bin)).toEqual(readFileSync(placed(home, 'ccd', 'ccd-scope-sweep')));
    expect(mode(bin)).toBe(0o755);
  });

  itLinux('ccd-tool-adj lands beside them (D-5241, the tool-child priority\'s shell prefix) — every role, but not Darwin', () => {
    // `ccd`'s `_spawn_start` names it in CLAUDE_CODE_SHELL_PREFIX on Linux only; macOS has no
    // /proc/self/oom_score_adj to raise, so it is not placed there (the Darwin describe pins the absence).
    const { home } = installed;
    const bin = join(home, '.local', 'bin', 'ccd-tool-adj');
    expect(readFileSync(bin)).toEqual(readFileSync(placed(home, 'ccd', 'ccd-tool-adj')));
    expect(mode(bin)).toBe(0o755);
  });

  itLinux('ccd-history-sweep lands too (history spec §9.5) — the one sweep shim role-gated off server boxes', () => {
    // `_inst_bins` places it behind a one-line `[ "$INST_ROLE" = server ] ||`
    // test: doctor and the CLI read its presence as "this box can hold a
    // store". This install is role `both`, so it lands; the `--role server`
    // case pins its absence, the fleet describe its presence there.
    const { home } = installed;
    const bin = join(home, '.local', 'bin', 'ccd-history-sweep');
    expect(readFileSync(bin)).toEqual(readFileSync(placed(home, 'ccd', 'ccd-history-sweep')));
    expect(mode(bin)).toBe(0o755);
  });

  it('ccrc-api lands too, a byte copy at 0755 on both arms (wave 17, D-5313)', () => {
    // The closed client every role skill calls. `_inst_bins` places it on BOTH
    // platform arms (hence `it`, not `itLinux`), behind the one-line role test
    // the history sweep's shim uses; this install is role `both`, so it lands.
    // At umask 077 the 0755 can only come from the chmod. The `--role server`
    // case pins its absence, and the closing line must name it.
    const { home, r } = installed;
    const bin = join(home, '.local', 'bin', 'ccrc-api');
    expect(readFileSync(bin)).toEqual(readFileSync(placed(home, 'ccd', 'ccrc-api')));
    expect(mode(bin)).toBe(0o755);
    expect(r.stdout).toMatch(/^install: bins: .*(?<![\w-])ccrc-api(?![\w-])/m);
  });

  itLinux('ccrc-api: README\'s link to the tree survives an install, still a link to the tree file (wave 17, D-5313)', () => {
    // README links `~/.local/bin/ccrc-api` to the tree's file with `ln -sfn`.
    // The source `_inst_atomic` compares is that link's own target, so its
    // `cmp` branch keeps the link; a copy that always replaced the file would
    // turn the link into a regular file that stops following updates.
    const home = freshBox('ccrc-install-api-link-');
    mkdirSync(join(home, '.local', 'bin'), { recursive: true });
    const dest = join(home, '.local', 'bin', 'ccrc-api');
    symlinkSync(join(home, 'ccrc', 'ccd', 'ccrc-api'), dest);
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(lstatSync(dest).isSymbolicLink(), 'the install turned README\'s link into a regular file').toBe(true);
    expect(realpathSync(dest)).toBe(realpathSync(placed(home, 'ccd', 'ccrc-api')));
  });

  it('the launcher is BYTE FOR BYTE what deploy.sh generates', () => {
    // THE AGREEMENT PIN. The launcher now has two generators — `deploy.sh`'s
    // `install_ccrc_shim` for a box reached over ssh, and `_inst_shim` for a
    // box installing itself — and two generators of one artifact is a drift
    // waiting to happen: a box whose launcher came from the older of them
    // fails in a way neither generator's own tests can see. Extract deploy's
    // heredoc (the mechanics `agent/test/deploy-verify.test.ts#shimBody`
    // uses) and compare it to the bytes THIS verb actually installed.
    //
    // It also means the behaviour tests deploy-verify already runs against
    // those bytes — argv forwarded, exit code passed through, a by-name
    // refusal when `~/ccrc/ccd/ccrc` is gone — hold for this copy without
    // being written twice.
    const deploySh = read(join(REPO, 'deploy', 'deploy.sh'));
    const fn = /install_ccrc_shim\(\) \{([\s\S]*?)\n\}/.exec(deploySh);
    expect(fn, 'deploy.sh has no install_ccrc_shim() helper').toBeTruthy();
    const heredoc = /<<'CCRC_SHIM'\n([\s\S]*?)\nCCRC_SHIM\n/.exec(fn![1]!);
    expect(heredoc, 'install_ccrc_shim does not generate the shim from a quoted heredoc')
      .toBeTruthy();

    const { home } = installed;
    const shim = join(home, '.local', 'bin', 'ccrc');
    expect(existsSync(shim), 'no ccrc launcher reached $HOME/.local/bin').toBe(true);
    expect(read(shim)).toBe(`${heredoc![1]!}\n`);
    expect(mode(shim)).toBe(0o755);
  });

  it('the installed launcher runs the shipped ccrc', () => {
    // Extracted-and-compared is not the same as works: the bytes could agree
    // and still be a launcher pointing at a tree this verb never placed. Run
    // it against the fixture HOME and let it answer.
    const { home } = installed;
    const r = runLauncherVersion(home);
    expect(r.stderr).toBe('');
    expect(r.code, 'the launcher did not reach the shipped ccrc').toBe(0);
    expect(r.stdout).toMatch(/^ccrc /);
  });

  it('the session hooks, notify and the tmux/statusline config land at their modes', () => {
    // The four artifacts stage 1 found the fleet host RUNNING with nothing
    // installing them, plus the hooks installer that converges settings.json.
    // `statusline-command.sh` is the sharp mode case: it is 0644 in the
    // repository and must be 0755 on the box, so a copy that preserved the
    // source mode (or a missing chmod) produces a statusline that never runs
    // and a box that silently writes no `~/.cc-limits` telemetry.
    const { home } = installed;
    const cases: Array<[string, string, number]> = [
      // The compaction card's helper (compaction-card spec §2): 0644, a script
      // `node` runs under the hook's `timeout`, never executed directly.
      [join(home, '.cc-sessions', 'compact-card.mjs'), placed(home, 'ccd', 'compact-card.mjs'), 0o644],
      [join(home, '.cc-sessions', 'session-hook.sh'), placed(home, 'ccd', 'session-hook.sh'), 0o755],
      [join(home, '.cc-sessions', 'install-session-hooks.sh'),
        placed(home, 'ccd', 'install-session-hooks.sh'), 0o755],
      [join(home, '.cc-sessions', 'notify.sh'), placed(home, 'deploy', 'notify.sh'), 0o755],
      // The four skill installers (worker-skill Task 4, reviewer-skill
      // Task 10) are the same kind of artifact as the hooks installer beside
      // them — a script the box EXECUTES — and land through the same
      // `_inst_atomic`. 0755 is not decoration here: `_inst_skills` runs each
      // one immediately afterwards, and a copy that arrived at the source's
      // mode under this describe's hostile umask would be a step that
      // installs a skill installer nobody can run.
      [join(home, '.cc-sessions', 'install-coordinator-skill.sh'),
        placed(home, 'ccd', 'install-coordinator-skill.sh'), 0o755],
      [join(home, '.cc-sessions', 'install-worker-skill.sh'),
        placed(home, 'ccd', 'install-worker-skill.sh'), 0o755],
      [join(home, '.cc-sessions', 'install-reviewer-skill.sh'),
        placed(home, 'ccd', 'install-reviewer-skill.sh'), 0o755],
      // ccrc history W1-B2: the fourth roster-reading skill installer, through the same `_inst_atomic`.
      [join(home, '.cc-sessions', 'install-history-skill.sh'),
        placed(home, 'ccd', 'install-history-skill.sh'), 0o755],
      // graphify Task 3: `_inst_graphify_skill` stages this beside the other
      // two, through the same `_inst_atomic`, right after `_inst_skills`.
      [join(home, '.cc-sessions', 'install-graphify-skill.sh'),
        placed(home, 'ccd', 'install-graphify-skill.sh'), 0o755],
      [join(home, '.tmux.conf'), placed(home, 'ccd', 'tmux.conf'), 0o644],
      [join(home, '.claude', 'statusline-command.sh'),
        placed(home, 'ccd', 'statusline-command.sh'), 0o755],
    ];
    for (const [dest, src, want] of cases) {
      expect(existsSync(dest), `${dest} was never installed`).toBe(true);
      expect(readFileSync(dest), `${dest} is not the shipped file`).toEqual(readFileSync(src));
      expect(mode(dest), `${dest} has the wrong mode`).toBe(want);
    }
  });

  it('a second run rewrites none of them, and leaves no temp file behind', () => {
    // Idempotence measured on MTIME, for `_inst_accounts_sh`'s reason: "the
    // file still says the right thing" is satisfied by a step that rewrites it
    // every run, and a converger that rewrites what it did not change is one
    // an operator cannot use to see what a run actually did. `_inst_atomic`
    // compares bytes before it stages anything; this is the assertion that
    // says so.
    const home = freshBox('ccrc-install-artifacts-idem-');
    expect(runInstall(home).code).toBe(0);
    const targets = [
      join(home, '.local', 'bin', 'ccd'),
      // `ccd-cap-scopes` caps tmux pane CGROUP scopes, so `_inst_bins` does not
      // place it on macOS — a binary that could only ever be a no-op there.
      // Listing it unconditionally would make this test stat a file the verb
      // was right not to install.
      // graphify Task 10: the sweep rides the same darwin carve-out — its
      // systemd timer never installs there, and the script needs GNU stat/date
      // and flock(1), which macOS does not ship.
      ...(process.platform === 'darwin'
        ? [] : [join(home, '.local', 'bin', 'ccd-cap-scopes'),
                join(home, '.local', 'bin', 'ccd-graph-sweep')]),
      // NOT in the spread above: this one is on both arms.
      join(home, '.local', 'bin', 'ccd-account-auth'),
      join(home, '.local', 'bin', 'ccrc'),
      join(home, '.cc-sessions', 'compact-card.mjs'),
      join(home, '.cc-sessions', 'session-hook.sh'),
      join(home, '.cc-sessions', 'install-session-hooks.sh'),
      join(home, '.cc-sessions', 'notify.sh'),
      // The four skill installers `_inst_skills` stages beside them, through
      // the same `_inst_atomic` (worker-skill Task 4, reviewer-skill Task 10).
      join(home, '.cc-sessions', 'install-coordinator-skill.sh'),
      join(home, '.cc-sessions', 'install-worker-skill.sh'),
      join(home, '.cc-sessions', 'install-reviewer-skill.sh'),
      join(home, '.cc-sessions', 'install-history-skill.sh'),
      // graphify Task 3: staged beside them, through the same `_inst_atomic`.
      join(home, '.cc-sessions', 'install-graphify-skill.sh'),
      join(home, '.tmux.conf'),
      join(home, '.claude', 'statusline-command.sh'),
    ];
    const before = targets.map(mtime);
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(targets.map(mtime)).toEqual(before);
    expect(strays(home)).toEqual([]);
  });

  it('repairs a mode someone changed — without rewriting the file', () => {
    // The other half of the byte-compare skip, and the reason it is a `chmod`
    // rather than an early `return`: a `ccd` an operator (or a bad copy) left
    // at 0600 is a box where every session supervisor gets EACCES, and bytes
    // that already match must not make the converger blind to it. `chmod`
    // moves ctime, never mtime, so repairing costs nothing the assertion above
    // measures.
    const home = freshBox('ccrc-install-mode-repair-');
    expect(runInstall(home).code).toBe(0);
    // Both halves of ccd's pair (D-3696), each at its own mode.
    for (const [bin, want] of [[join(home, '.local', 'bin', 'ccd'), 0o755], [join(home, '.local', 'libexec', 'ccrc', 'ccd'), 0o644]] as const) {
      chmodSync(bin, 0o600);
      const was = mtime(bin);
      const r = runInstall(home);
      expect(r.code, r.stderr).toBe(0);
      expect(mode(bin), 'a mode nobody repaired').toBe(want);
      expect(mtime(bin), 'the file was rewritten to fix a mode').toBe(was);
    }
  });

  it('keeps a personal ~/.tmux.conf aside before replacing it', () => {
    // The two files this verb installs into the OPERATOR's namespace rather
    // than into ccrc's own (`~/.tmux.conf`, `~/.claude/statusline-command.sh`)
    // may already be somebody's, written years before ccrc arrived. deploy.sh
    // overwrites both without asking because it runs against a box that is,
    // by definition, a fleet host; `ccrc install` runs against whatever
    // machine an operator typed it on. So the file that is about to be
    // replaced is copied aside first — `cmd_wrappers`' rule, and the same
    // naming shape, so the copy is never mistaken for something ccrc manages.
    const home = freshBox('ccrc-install-personal-');
    writeFileSync(join(home, '.tmux.conf'), '# mine, from 2019\nset -g mouse on\n');
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'statusline-command.sh'), '#!/bin/sh\necho mine\n');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    const saved = readdirSync(home).filter((f) => f.startsWith('.tmux.conf.pre-ccrc-'));
    expect(saved.length, 'the operator tmux.conf was replaced without a copy').toBe(1);
    expect(read(join(home, saved[0]!))).toBe('# mine, from 2019\nset -g mouse on\n');
    const savedStatus = readdirSync(join(home, '.claude'))
      .filter((f) => f.startsWith('statusline-command.sh.pre-ccrc-'));
    expect(savedStatus.length).toBe(1);
    // …and the shipped ones did land: keeping a copy is not declining to converge.
    expect(readFileSync(join(home, '.tmux.conf')))
      .toEqual(readFileSync(placed(home, 'ccd', 'tmux.conf')));
    expect(r.stdout).toMatch(/^install: files: kept .*\.tmux\.conf\.pre-ccrc-/m);
  });

  it('a second run makes no second copy — the file it would save is its own', () => {
    const home = freshBox('ccrc-install-personal-idem-');
    writeFileSync(join(home, '.tmux.conf'), '# mine\n');
    expect(runInstall(home).code).toBe(0);
    expect(runInstall(home).code).toBe(0);
    expect(readdirSync(home).filter((f) => f.startsWith('.tmux.conf.pre-ccrc-')).length).toBe(1);
  });
});
