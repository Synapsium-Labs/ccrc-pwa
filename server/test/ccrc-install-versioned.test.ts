// `ccrc install`, part 2 of the ccrc-install-*.test.ts family (D-6767): the step order and the versioned tree.
// Shared fixtures and the original file header live in ccrc-installFixture.ts.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync, rmSync, symlinkSync, utimesSync, lstatSync, readlinkSync } from 'node:fs';
import path, { join } from 'node:path';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { ccrcContainedEnv } from './ccrcContainment.js';
import { assertNoRealTool } from './containedTools.js';
import { itLinux, itDarwin } from './platformFixtures.js';
import { installFixtureTree, installVersionedTree, keepDigest } from './installTreeFixture.js';
import { here, REPO, realPath, BASH, treeRoot, ccrcIn, placed, healthyDoctorBox, freshBox, ccrcEnv, runInstall, SHA256_TOOL, pathWithout, read, strays, gitInit, type Result } from './ccrc-installFixture.js';

removeTmpFixturesEachTest();

describe('ccrc install: the order is stated in one place', () => {
  it('cmd_install is the sequence, and the roster precedes the ccd it installs', () => {
    // `ccd` refuses to run AT ALL without `~/.ccrc/accounts.sh` — its own
    // `|| die`, on every invocation — so an install that put `ccd` on PATH
    // before the roster projection existed would leave a box whose every ccd
    // command dies, for exactly as long as the gap. That is `deploy.sh`'s
    // "THE ROSTER LANDS BEFORE ccd" rule, and it is the reason `cmd_install`
    // is a fixed sequence rather than a set of steps.
    const src = read(join(REPO, 'ccd', 'ccrc'));
    // D-3241 (W4 Task 4): the sequence is `CCRC_INST_SPINE`,
    // declared ONCE, because `cmd_update`'s spine-death classifier must know
    // which steps precede `_inst_tree` and a second hand list of the spine
    // would be the two-copies defect single-definition.test.ts refuses.
    // `cmd_install` iterates it through `_inst_step`, which writes the
    // install-step marker before each step.
    const spine = /^CCRC_INST_SPINE=\(([\s\S]*?)\n\)/m.exec(src);
    expect(spine, 'ccd/ccrc has no CCRC_INST_SPINE').toBeTruthy();
    const steps = spine![1]!.split('\n').map((l) => l.trim()).filter((l) => l !== '');
    // Every line of the array is exactly one step name — a line the order
    // assertion below could not read is a step it would not see.
    expect(steps.filter((l) => !/^_inst_[a-z_]+$/.test(l))).toEqual([]);
    for (const s of steps) expect(src, `${s} is in the spine but never defined`).toMatch(new RegExp(`^${s}\\(\\) \\{`, 'm'));
    const body = /cmd_install\(\) \{([\s\S]*?)\n\}/.exec(src);
    expect(body, 'ccd/ccrc has no cmd_install').toBeTruthy();
    // No step is called outside the array: a bare call runs with no
    // install-step marker, so a death in it would be misclassified.
    // W6 Task 3: the two doctor tails — the fleet arm's and the verb's last
    // line — are the ONLY bare `_inst_*` calls left. `_inst_doctor_tail` is
    // not a step: it runs after `_inst_installed` removed the marker, where
    // a death leaves the completed-install record (D-3114's reading), so no
    // marker has anything to name. Named exactly, so a real step called bare
    // still reds this line.
    expect(body![1]!.split('\n').map((l) => l.trim()).filter((l) => /^_inst_[a-z_]+$/.test(l)),
      'cmd_install calls a step outside CCRC_INST_SPINE').toEqual(['_inst_doctor_tail', '_inst_doctor_tail']);
    expect(body![1]).toMatch(/^\s*for inst_fn in "\$\{CCRC_INST_SPINE\[@\]\}"; do _inst_step "\$inst_fn"; done$/m);
    expect(steps).toEqual([
      '_inst_banner',
      '_inst_roster',
      '_inst_accounts_sh',
      '_inst_env',
      // Stage 4, Task 5. In the seed-once cluster (it writes a user-owned
      // file, or keeps it) and BEFORE `_inst_units`: on a fleet box the agent
      // unit's REQUIRED EnvironmentFile must exist by the time the unit lands
      // and `_inst_enable` asks systemd to start it. On every other role the
      // step is a silent no-op, which is what keeps the default transcript
      // byte-identical to Stage 2d's.
      '_inst_agent_env',
      // Stage 2e, Task 2. Beside the other two seed-once steps and BEFORE the
      // tree: nothing later in this sequence reads the flag, so its position
      // is a grouping rather than a dependency — the three files an operator
      // owns are seeded together, and the transcript reads that way too.
      '_inst_rc',
      // design 2026-09-20 §3: seed-once identity, with the other seed-once files
      '_inst_node_id',
      '_inst_tree',
      '_inst_bins',
      '_inst_files',
      '_inst_stamp',
      // §9: what THIS install can do, beside the stamp that says what it is
      '_inst_caps',
      // spec 2026-10-26-node-runtime-under-nvm: publishes the chosen node (three links and the manager's PATH
      // fragment, then a reload) BEFORE the units land and are enabled, so the first restart already finds node.
      '_inst_node',
      // Task 8. Three orderings in this half are load-bearing and each one is
      // measured by a test of its own below: the units land before anything
      // enables them, the account config dirs exist before the hooks installer
      // walks them, and the wrapper converger runs before doctor judges what it
      // wrote.
      '_inst_units',
      // Plan 2b-2 Task 10 (D-3485). The Codex lanes' LiteLLM runtime,
      // BEFORE `_inst_enable`, for two measured reasons. First, `_inst_enable`
      // arms `ccrc-models.timer`, whose `ccrc models refresh --all` re-renders
      // a codex lane's config and stops/starts its tiers through the functions
      // that resolve `ccgpt-runtime python` — so the generation they resolve
      // must already be this run's. Second, `_inst_codex_tiers` below measures
      // staleness AGAINST it: a build placed after the restart step restarts
      // tiers onto the OLD runtime (m-spine H4). After `_inst_bins`, which
      // places the builder. A failed build DEGRADES (`codex-runtime`).
      '_inst_codex_runtime',
      '_inst_enable',
      // Plan 2b-2 Task 10 (D-3485). Restart-after-update as a BARE
      // step rather than code inside `_inst_enable`: it is visible in this
      // list, and `_inst_enable` returns early on Darwin, where the nohup
      // arm's tiers must still be restarted. Not `_upd_sweep` — the one
      // sanctioned toucher of `claude-session@*` (spec §7.4). After
      // `_inst_bins` (the shim's code) and `_inst_codex_runtime` (the
      // generation): the two things a tier's staleness is measured against.
      // Codex bridge Stage 2, Task 11. Right BEFORE the tier restart, which
      // reads each lane's mode from lane.json: a lane.json rendered before
      // the bridge reads stale and is re-rendered here, through the one
      // writer, so the tiers step and the doctor read a current one. A
      // failure DEGRADES (`codex-lanes`).
      '_inst_codex_lanes',
      // Only running, verified-own, stale tiers, by stop+start; a failure
      // DEGRADES (`codex-tiers`).
      '_inst_codex_tiers',
      '_inst_linger',
      '_inst_dirs',
      // graphify Task 2. After `_inst_dirs` and before `_inst_hooks`, per the
      // task brief: the engine venv has no dependency on the account config
      // dirs or the hooks installer either way, so the position is the
      // brief's own placement rather than a dependency this file measures.
      '_inst_graphify_engine',
      '_inst_hooks',
      // Worker-skill Task 4. Beside `_inst_hooks` and after it, in deploy.sh's
      // own order (`install-session-hooks.sh`, then the three skill installers):
      // both steps run an INSTALLED converge script over the config dirs
      // `_inst_dirs` has just created, and neither reads what the other wrote.
      // What IS load-bearing is that it follows `_inst_dirs` — the skill
      // installers `continue` past a config dir that does not exist, so on a
      // fresh box run before that step they would skip the whole roster and
      // exit 0.
      '_inst_skills',
      // graphify Task 3. Right after `_inst_skills`, a SEPARATE function
      // rather than a third name inside its loop: that loop pins
      // `CCRC_SKILL_SRC` to a vendored `~/.cc-sessions` tree, and this
      // skill's source of truth is the installed package instead (spec §B).
      '_inst_graphify_skill',
      // D-1160. Immediately before the exclude writer, because the two are the
      // sweep's two preconditions and they read best together: this one keeps
      // ccrc's OWN artifacts (`.remember/`, `.superpowers/`, `.claude/`,
      // `CLAUDE.local.md`) out of every corpus, the next keeps `graphify-out/`
      // out of every `git status`. Neither reads what the other wrote, so the
      // position is a grouping rather than a dependency — but it must follow
      // `_inst_tree`, since it copies the list out of the PLACED tree.
      // D-1245. The READ side moved OUT of the operator's account-wide
      // CLAUDE.md and into the artifacts ccrc owns outright (the session
      // hook's SessionStart card, worker clause 12, the PATH converge, and
      // the `graphQueries` counter the hook already writes). What
      // is left here is the REMOVER, in `_inst_graph_hooks_off`'s own shape:
      // a step whose whole job is taking back what an earlier layer planted.
      '_inst_graph_always_on_off',
      '_inst_graph_noise',
      // graphify Task 4 (D-996/D'). Right after `_inst_graphify_skill`, per
      // the task brief: the sweep's `check-ignore` precondition needs a
      // writer that converges every project/worktree's common-dir exclude.
      // No later step reads what this one writes, so the position is the
      // brief's own placement rather than a measured dependency.
      '_inst_graph_excludes',
      // Workspace-cleanup fix. Right after `_inst_graph_excludes`, same walk
      // and same reason: `ws-add` writes the `node_modules`/`cdk.out` exclude
      // pair into every NEW workspace, and this is the backfill for a
      // project or workspace `ws-add` never touched, or touched before the
      // pair existed. Position is a grouping (both converge the same
      // per-project info/exclude), not a measured dependency.
      '_inst_ws_build_excludes',
      // graphify Task 10 (O3/O6b). Right after `_inst_graph_excludes`, per
      // the task brief: no later step reads what it does, so the position is
      // the brief's own placement rather than a measured dependency.
      '_inst_graph_hooks_off',
      '_inst_wrappers',
      // Accounts plan Task A11 (D-5518, G35). The lane-state backfill: after
      // the wrappers, so every lane it writes for is a converged one, and
      // before the completed-install record, which must stay last.
      '_inst_lane_state',
      // Release/rollout design §5, Task 3. LAST, deliberately: this is the
      // completed-install record, so it must run only once every step above
      // has already converged or died.
      '_inst_installed',
    ]);
  });

  it('ends with _inst_doctor_tail, whose exit code is cmd_doctor\'s, and nothing runs after it (W6 Task 3)', () => {
    // THE VERB'S EXIT CODE IS DOCTOR'S, and that is only true while the tail
    // is the LAST command in the function AND the tail hands doctor's rc back
    // untouched: a line added after either — a summary, a tidy-up, one more
    // echo — silently replaces the verdict with that line's own status, and
    // every "a broken box exits 1" assertion in this file would go green
    // against an install that reported success on a failing box. The tail
    // runs doctor FIRST and captures its rc, because what it does next (the
    // migration's gate) must never become the verdict.
    const src = read(join(REPO, 'ccd', 'ccrc'));
    const body = /cmd_install\(\) \{([\s\S]*?)\n\}/.exec(src);
    const lines = body![1]!.split('\n').map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'));
    expect(lines[lines.length - 1]).toBe('_inst_doctor_tail');
    const tail = /^_inst_doctor_tail\(\) \{\n([\s\S]*?)\n\}/m.exec(src);
    expect(tail, 'ccd/ccrc has no _inst_doctor_tail').not.toBeNull();
    const t = tail![1]!.split('\n').map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'));
    expect(t[1], 'the tail does something before it runs doctor').toBe('cmd_doctor || drc=$?');
    expect(t[t.length - 1]).toBe('return "$drc"');
  });
});

// ── W6 Task 2: the versioned tree ─────────────────────────────────────────
// `_inst_tree` places into `~/ccrc-versions/<name>/` and flips `~/ccrc` (a
// symlink since W6) onto it with one rename, after the deps. The subjects,
// in order: the layout reader and the namer, measured by SOURCING the ccrc
// under test (its BASH_SOURCE guard keeps the verb table from dispatching);
// then the verb itself on every guard arm — a fresh box, a new name while
// another version runs, a re-run from the running version, a run of another
// placed version's own ccrc, an incomplete one, a failing npm, the refusals;
// then the kept stamp and record, and the Darwin preflight.
describe('ccrc install: the versioned tree (W6 Task 2)', () => {
  const REAL_MV = realPath('mv');
  const vroot = (home: string, ...rel: string[]): string => join(home, 'ccrc-versions', ...rel);

  /** Every file under `dir`, relative path -> bytes (base64), links as their
   *  value: the "byte-unchanged" measurement a running version is held to. */
  const treeBytes = (dir: string): Record<string, string> => {
    const out: Record<string, string> = {};
    const walk = (d: string, prefix: string): void => {
      for (const e of readdirSync(d).sort()) {
        const p = join(d, e);
        const rel = prefix === '' ? e : `${prefix}/${e}`;
        const st = lstatSync(p);
        if (st.isSymbolicLink()) out[rel] = `link:${readlinkSync(p)}`;
        else if (st.isDirectory()) walk(p, rel);
        else out[rel] = readFileSync(p).toString('base64');
      }
    };
    walk(dir, '');
    return out;
  };

  /** Runs `snippet` in a bash that has sourced `ccrc`, HOME the fixture's,
   *  `gh` contained, every CCRC_* input deleted (`ccrcEnv`'s rule), and the
   *  tools a placement would reach — npm, rsync, curl, systemctl, launchctl —
   *  POISONED at the head of PATH: a snippet that got further than it should
   *  (the red run of the crashed-arm case, say) must fail loudly, never fetch
   *  or copy for real. */
  const sourcedEnv = (home: string): NodeJS.ProcessEnv => {
    const poison = join(home, 'sourced-poison');
    mkdirSync(poison, { recursive: true });
    for (const t of ['npm', 'rsync', 'curl', 'systemctl', 'launchctl']) {
      writeFileSync(join(poison, t), `#!/bin/sh\necho "sourced harness: ${t} must not run" >&2\nexit 97\n`, { mode: 0o755 });
    }
    // Wave 9 R10d (D-3818): from `ccrcContainedEnv`, with its own `sourced-poison` still prepended — it answers first.
    const env = ccrcContainedEnv(home, process.env, { managers: true, curl: 'poison' });
    env['PATH'] = `${poison}:${env['PATH'] ?? ''}`;
    for (const k of Object.keys(env)) if (k.startsWith('CCRC_')) delete env[k];
    return env;
  };
  const sourced = (home: string, ccrc: string, snippet: string): Result => {
    const env = sourcedEnv(home);
    const r = spawnSync(BASH, ['-c', `source "$1" || exit 99\n${snippet}`, 'sourced', ccrc],
      { env, encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  const layout = (home: string): string =>
    sourced(home, join(REPO, 'ccd', 'ccrc'),
      '_ver_layout; printf \'%s|%s|%s\\n\' "$VER_LAYOUT" "$VER_CURRENT" "$VER_WHY"').stdout.trim();
  const nameOf = (home: string, src: string): string =>
    sourced(home, join(REPO, 'ccd', 'ccrc'), `_inst_version_name "$(cd '${src}' && pwd -P)"`).stdout.trim();

  /** A stamp in `build-release.sh`'s shape, written into a source tree. */
  const shipStamp = (root: string, sha: string, version?: string): void => {
    writeFileSync(join(root, 'build.json'), `${JSON.stringify({
      sha, ref: 'release', builtAt: '2026-09-23T00:00:00Z', dirty: false,
      ...(version === undefined ? {} : { version }),
    })}\n`);
  };

  /** `mv`, recorded by nothing and executed for real — except at the two
   *  kept-copy renames, where a knob file makes it SIGKILL the ccrc that ran
   *  it (the stamp copy) or refuse (the record copy). `_plat_mv_notdir` runs
   *  in ccrc's own shell, so `$PPID` is the run itself. */
  const mvKnobs = [
    '#!/bin/sh',
    'for last in "$@"; do :; done',
    'case "$last" in',
    '  */.ccrc-stamp.json) [ -f "$HOME/fixture-kill-at-stamp-copy" ] && { kill -KILL "$PPID"; exit 1; } ;;',
    '  */.ccrc-digest) [ -f "$HOME/fixture-kill-at-digest-copy" ] && { kill -KILL "$PPID"; exit 1; }',
    '                  [ -f "$HOME/fixture-fail-at-digest-copy" ] && { echo "fixture mv: refusing $last" >&2; exit 1; } ;;',
    '  */.ccrc-installed) [ -f "$HOME/fixture-fail-at-record-copy" ] && { echo "fixture mv: refusing $last" >&2; exit 1; } ;;',
    'esac',
    `exec ${REAL_MV} "$@"`,
  ].join('\n') + '\n';
  /** `ln`, recorded (argv, one line per call) and executed for real: the
   *  call-site half of spec §18's "the flip is a rename" — `_inst_tree` must
   *  stage `~/ccrc.new` and rename it, never `ln -sfn` onto `~/ccrc` itself. */
  const lnRecorder = `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/ln-argv"\nexec ${realPath('ln')} "$@"\n`;

  it('sourcedEnv hands out no env under which a real ssh, scp, systemctl, systemd-run, launchctl, tmux, gh or curl can run, and no real user bus (wave 9 R10d)', () => {
    const home = mkTmp('ccrc-sourced-contained-');
    expect(() => assertNoRealTool(sourcedEnv(home), home)).not.toThrow();
  });

  it('_ver_layout: seven words, one per shape of ~/ccrc — and a WHY built from its own words, never the link\'s', () => {
    const home = mkTmp('ccrc-ver-layout-');
    expect(layout(home)).toBe('absent||');
    mkdirSync(join(home, 'ccrc.migrating'));
    expect(layout(home)).toBe('crashed||');
    rmSync(join(home, 'ccrc.migrating'), { recursive: true });
    mkdirSync(join(home, 'ccrc'));
    expect(layout(home)).toBe('directory||');
    mkdirSync(join(home, 'ccrc.migrating'));
    expect(layout(home)).toMatch(/^unreadable\|\|a directory beside a \$HOME\/ccrc\.migrating — two trees/);
    rmSync(join(home, 'ccrc'), { recursive: true });
    rmSync(join(home, 'ccrc.migrating'), { recursive: true });
    installVersionedTree(home, 'v1.2.3');
    expect(layout(home)).toBe('linked|v1.2.3|');
    mkdirSync(join(home, 'ccrc.migrating'));
    expect(layout(home)).toBe('migrated|v1.2.3|');
    rmSync(join(home, 'ccrc.migrating'), { recursive: true });
    // FOREIGN: every link this ccrc would never have written — a RELATIVE
    // target, a path outside the versions root, a dangling version name, a
    // directory under the root whose name is not a version name, a version
    // name that is itself a link.
    const foreign = /^foreign\|\|a link whose target is not a version directory under \$HOME\/ccrc-versions$/;
    const relink = (target: string): void => {
      rmSync(join(home, 'ccrc'));
      symlinkSync(target, join(home, 'ccrc'));
    };
    relink(join('ccrc-versions', 'v1.2.3'));
    expect(layout(home)).toMatch(foreign);
    mkdirSync(join(home, 'elsewhere-9f3c'));
    relink(join(home, 'elsewhere-9f3c'));
    expect(layout(home)).toMatch(foreign);
    expect(layout(home), 'the link\'s bytes reached VER_WHY').not.toContain('elsewhere-9f3c');
    relink(vroot(home, 'v9.9.9'));
    expect(layout(home)).toMatch(foreign);
    mkdirSync(vroot(home, 'not-a-version'));
    relink(vroot(home, 'not-a-version'));
    expect(layout(home)).toMatch(foreign);
    // …and a version NAME under the root that is itself a link, to a real
    // directory elsewhere: `-d` follows it and the name and the prefix both
    // match, so only the `[ -L "$val" ]` clause sees it (mutation M8b).
    mkdirSync(join(home, 'elsewhere-2'));
    symlinkSync(join(home, 'elsewhere-2'), vroot(home, 'v1.2.4'));
    relink(vroot(home, 'v1.2.4'));
    expect(layout(home)).toMatch(foreign);
    // UNREADABLE: a regular file at the name; a .migrating that is not a dir.
    rmSync(join(home, 'ccrc'));
    writeFileSync(join(home, 'ccrc'), 'not a tree\n');
    expect(layout(home)).toBe('unreadable||neither a directory nor a link');
    rmSync(join(home, 'ccrc'));
    writeFileSync(join(home, 'ccrc.migrating'), 'not a tree\n');
    expect(layout(home)).toBe('unreadable||absent beside a $HOME/ccrc.migrating that is not a directory');
  });

  it('_inst_version_name: a placed version names itself; git beats a stray build.json; build.json names an artifact; a deploy.sh tree is named by the box stamp; nothing measured is unstamped, fresh each time', () => {
    const home = mkTmp('ccrc-ver-name-');
    // 1. a placed version — and a dot-named sibling under the root is NOT one
    installVersionedTree(home, 'v1.2.3', { link: false });
    expect(nameOf(home, vroot(home, 'v1.2.3'))).toBe('v1.2.3');
    const incoming = vroot(home, '.v4.5.6.incoming.1');
    mkdirSync(incoming, { recursive: true });
    shipStamp(incoming, 'd'.repeat(40), 'v4.5.6');
    expect(nameOf(home, incoming)).toBe('v4.5.6');
    // 2. git: untagged, then a non-release tag (still untagged), then a release tag;
    //    a stray build.json beside the repository never outvotes it
    const repo = join(home, 'repo');
    installFixtureTree(home, 'repo');
    const sha = gitInit(repo);
    shipStamp(repo, 'e'.repeat(40), 'v9.9.9');
    expect(nameOf(home, repo)).toBe(`untagged-${sha.slice(0, 12)}`);
    const tag = (t: string): void => {
      const r = spawnSync('git', ['-C', repo, 'tag', t],
        { env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`fixture git tag failed: ${r.stderr}`);
    };
    tag('release-7');
    expect(nameOf(home, repo)).toBe(`untagged-${sha.slice(0, 12)}`);
    tag('v2.3.4');
    expect(nameOf(home, repo)).toBe('v2.3.4');
    // 3. an artifact's build.json: its version; no version -> untagged-<sha12>;
    //    a sha that is not hex names nothing and falls through
    const art = join(home, 'artifact');
    mkdirSync(art);
    shipStamp(art, 'f'.repeat(40), 'v3.0.1');
    expect(nameOf(home, art)).toBe('v3.0.1');
    shipStamp(art, '0123456789abcdef0123456789abcdef01234567');
    expect(nameOf(home, art)).toBe('untagged-0123456789ab');
    shipStamp(art, 'not-a-sha');
    expect(nameOf(home, art)).toMatch(/^unstamped-[0-9a-f]{12}$/);
    // 4. the live ~/ccrc of a pre-versioned box, named by the box's own stamp
    const deployed = mkTmp('ccrc-ver-name-deployed-');
    mkdirSync(join(deployed, 'ccrc'));
    mkdirSync(join(deployed, '.ccrc'));
    writeFileSync(join(deployed, '.ccrc', 'build.json'),
      '{"sha":"1111111111111111111111111111111111111111","ref":"main","builtAt":"2026-09-01T00:00:00Z","dirty":false,"version":"v0.0.7"}\n');
    expect(nameOf(deployed, join(deployed, 'ccrc'))).toBe('v0.0.7');
    // 5. nothing measures it: unstamped, and never the same name twice
    const bare = join(home, 'bare');
    mkdirSync(bare);
    const a = nameOf(home, bare);
    const b = nameOf(home, bare);
    expect(a).toMatch(/^unstamped-[0-9a-f]{12}$/);
    expect(b).toMatch(/^unstamped-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });

  it('a staged tree INSIDE another git work tree is named and stamped by its own build.json, never by the enclosing repository\'s HEAD (D-3463)', () => {
    // A TMPDIR under a git-tracked HOME: the release tarball is extracted into
    // an untracked subdirectory of a repository. `git -C <stage> rev-parse
    // HEAD` answers for the ENCLOSING repository there.
    const home = mkTmp('ccrc-ver-name-enclosed-');
    const encl = join(home, 'encl');
    installFixtureTree(home, 'encl');
    const esha = gitInit(encl);
    const stage = join(encl, 'stage');
    mkdirSync(join(stage, 'ccd'), { recursive: true });
    shipStamp(stage, 'c'.repeat(40), 'v1.5.0');
    // git really does answer for the enclosing repository from here (the hazard exists)
    expect(spawnSync('git', ['-C', stage, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()).toBe(esha);
    expect(nameOf(home, stage)).toBe('v1.5.0');
    // no build.json either: not the enclosing commit — unstamped
    rmSync(join(stage, 'build.json'));
    expect(nameOf(home, stage)).toMatch(/^unstamped-[0-9a-f]{12}$/);
    // and the enclosing repository ITSELF (its own top level) is still named from git
    expect(nameOf(home, encl)).toBe(`untagged-${esha.slice(0, 12)}`);
    // the stamp: `_inst_stamp` reads the shipped build.json of the enclosed tree
    shipStamp(stage, 'c'.repeat(40), 'v1.5.0');
    const r = sourced(home, join(REPO, 'ccd', 'ccrc'), `CCRC_HERE='${stage}/ccd'; _inst_stamp`);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain(`install: stamp: ${'c'.repeat(40)} (release, v1.5.0, shipped in the release artifact)`);
    const stamp = readFileSync(join(home, '.ccrc', 'build.json'), 'utf8');
    expect(stamp).toContain('c'.repeat(40));
    expect(stamp, 'the stamp took the enclosing repository\'s sha').not.toContain(esha);
  });

  it('an exported GIT_DIR naming ANOTHER repository changes nothing a git read answers: the name, the stamp\'s sha, ref, dirty and version all come from the source\'s own repository (final-review fix wave, Step 0c; fix round 1)', () => {
    // `git -C <src> <verb>` under an ambient GIT_DIR answers for that
    // repository, and `_inst_git_own` (which unsets it) then agrees that <src>
    // is a top level — a name and a stamp taken from another tree's commit,
    // branch, tag and worktree state. `other` differs from `repo` in all four:
    // another commit, a `v9.9.9` release tag at its HEAD, another branch, and a
    // modified tracked file.
    const home = mkTmp('ccrc-ver-name-git-dir-');
    installFixtureTree(home, 'repo');
    installFixtureTree(home, 'other');
    const repo = join(home, 'repo');
    const other = join(home, 'other');
    writeFileSync(join(other, 'ONLY-IN-OTHER'), 'a different commit\n');
    const sha = gitInit(repo);
    const osha = gitInit(other);
    expect(osha, 'the two fixture repositories share a commit — the pin would prove nothing').not.toBe(sha);
    const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
    const ogit = (...args: string[]): void => {
      const r = spawnSync('git', ['-C', other, ...args], { env: gitEnv, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`fixture git ${args.join(' ')} failed: ${r.stderr}`);
    };
    ogit('tag', 'v9.9.9');
    ogit('checkout', '-q', '-b', 'other-branch');
    // Dirty in the INDEX and in the WORKTREE, both: stage one change, then
    // modify the file again. `git add` alone leaves the worktree clean (so an
    // ambient-GIT_DIR read of `diff --quiet` would answer clean and the pin
    // would not see it), and an edit alone leaves the index clean (so the same
    // is true of `diff --cached --quiet`). Each of `_inst_stamp`'s two dirty
    // reads answers `other`'s state as dirty if it is ever unshielded.
    writeFileSync(join(other, 'ONLY-IN-OTHER'), 'staged after the commit\n');
    ogit('add', 'ONLY-IN-OTHER');
    writeFileSync(join(other, 'ONLY-IN-OTHER'), 'modified again after it was staged\n');
    // (`other`'s tracked file is now dirty in its index AND its worktree; `repo` is clean, on fixture-branch, untagged.)
    const env = `export GIT_DIR='${other}/.git' GIT_WORK_TREE='${other}'; `;
    const n = sourced(home, join(REPO, 'ccd', 'ccrc'), `${env}_inst_version_name "$(cd '${repo}' && pwd -P)"`);
    expect(n.code, n.stderr).toBe(0);
    expect(n.stdout.trim(), 'the name took the ambient GIT_DIR repository\'s release tag').toBe(`untagged-${sha.slice(0, 12)}`);
    const r = sourced(home, join(REPO, 'ccd', 'ccrc'), `${env}CCRC_HERE='${repo}/ccd'; _inst_stamp`);
    expect(r.code, r.stderr).toBe(0);
    const stamp = JSON.parse(readFileSync(join(home, '.ccrc', 'build.json'), 'utf8')) as Record<string, unknown>;
    expect(stamp['sha']).toBe(sha);
    expect(stamp['ref'], 'the stamp\'s ref is another repository\'s branch').toBe('fixture-branch');
    expect(stamp['dirty'], 'the stamp\'s dirty is another repository\'s index or worktree state').toBe(false);
    expect('version' in stamp, 'the stamp carries another repository\'s release tag').toBe(false);
  });

  it('a fresh box: the tree lands in ~/ccrc-versions/<name>/, never at the live name, and ~/ccrc becomes an absolute link to it — after the deps, by one rename', () => {
    const home = freshBox('ccrc-install-ver-fresh-');
    const sha = gitInit(treeRoot(home));
    const name = `untagged-${sha.slice(0, 12)}`;
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(lstatSync(join(home, 'ccrc')).isSymbolicLink(), '~/ccrc is not a link').toBe(true);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(vroot(home, name));
    // The rsync's destination is the version directory, never $HOME/ccrc.
    const argv = read(join(home, 'rsync-argv')).trim().split('\n');
    expect(argv).toHaveLength(1);
    expect(argv[0]!.split(' ').at(-1)).toBe(`${vroot(home, name)}/`);
    expect(read(join(home, 'npm-cwd')).trim().split('\n')).toEqual([vroot(home, name, 'server')]);
    const lines = r.stdout.split('\n');
    const at = (re: RegExp): number => lines.findIndex((l) => re.test(l));
    const placedAt = at(new RegExp(`^install: tree: placed ${name} at \\$HOME/ccrc-versions/${name}$`));
    const depsAt = at(/^install: tree: server runtime deps in place$/);
    const flipAt = at(new RegExp(`^install: tree: \\$HOME/ccrc -> \\$HOME/ccrc-versions/${name} \\(was nothing\\) — one rename$`));
    expect(placedAt, r.stdout).toBeGreaterThanOrEqual(0);
    expect(depsAt).toBeGreaterThan(placedAt);
    expect(flipAt, 'the flip ran before the deps were in place').toBeGreaterThan(depsAt);
    expect(existsSync(join(home, 'ccrc.new')), 'the staged link was left behind').toBe(false);
    // The version keeps the box's stamp and record, written after the record.
    expect(read(vroot(home, name, '.ccrc-stamp.json'))).toBe(read(join(home, '.ccrc', 'build.json')));
    expect(read(vroot(home, name, '.ccrc-installed'))).toBe(read(join(home, '.ccrc', 'installed')));
    expect(statSync(vroot(home, name, '.ccrc-installed')).mode & 0o777).toBe(0o644);
    const keptAt = at(new RegExp(`^install: versions: kept ${name}'s stamp and install record in \\$HOME/ccrc-versions/${name} — what a flip back restores$`));
    expect(keptAt, r.stdout).toBeGreaterThan(at(/^install: installed: /));
    expect(strays(home)).toEqual([]);
  });

  it('a new name while ~/ccrc points at another version: rsync into ~/ccrc-versions/<new>/, flip, and the running version\'s directory is byte-unchanged', () => {
    const home = freshBox('ccrc-install-ver-new-');
    installVersionedTree(home, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    shipStamp(treeRoot(home), 'b'.repeat(40), 'v9.9.1');
    // A file only the RUNNING version has. Its tree is otherwise the source's
    // own bytes, so an rsync that landed in it would rewrite equal bytes and
    // the digest below would stay green; `--delete` removes this one.
    writeFileSync(vroot(home, 'v9.9.0', 'server', 'ONLY-IN-THE-RUNNING-VERSION'), 'a unit may be running this\n');
    keepDigest(vroot(home, 'v9.9.0'), home);   // the plant is part of v9.9.0's kept bytes (D-3465)
    const before = treeBytes(vroot(home, 'v9.9.0'));
    const r = runInstall(home, ['install'], {}, { stubs: { ln: lnRecorder } });
    // FIRST, before the exit code: a run that wrote into the running version
    // dies later, at its own exit code, and this is the assertion that must
    // name the defect (review 179 item 15).
    expect(treeBytes(vroot(home, 'v9.9.0')), 'the running version was written into').toEqual(before);
    expect(r.code, r.stderr).toBe(0);
    // The flip went through the staged name: `ln` wrote `~/ccrc.new`, and no
    // `ln` in the whole run targeted `~/ccrc` itself (unlink + symlink).
    const lns = read(join(home, 'ln-argv')).trim().split('\n');
    expect(lns.filter((l) => l.endsWith(` ${join(home, 'ccrc.new')}`))).toEqual([
      `-sfn -- ${vroot(home, 'v9.9.1')} ${join(home, 'ccrc.new')}`,
    ]);
    expect(lns.filter((l) => l.endsWith(` ${join(home, 'ccrc')}`)), 'an ln targeted the live link').toEqual([]);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(vroot(home, 'v9.9.1'));
    expect(read(join(home, 'rsync-argv')).trim().split(' ').at(-1)).toBe(`${vroot(home, 'v9.9.1')}/`);
    expect(r.stdout).toMatch(/^install: tree: placed v9\.9\.1 at \$HOME\/ccrc-versions\/v9\.9\.1$/m);
    expect(r.stdout).toMatch(/^install: tree: \$HOME\/ccrc -> \$HOME\/ccrc-versions\/v9\.9\.1 \(was \$HOME\/ccrc-versions\/v9\.9\.0\) — one rename$/m);
    expect(JSON.parse(read(vroot(home, 'v9.9.1', '.ccrc-stamp.json'))).version).toBe('v9.9.1');
  });

  it.each(['a symlink to a real directory', 'a regular file'] as const)('a version NAME that is %s is refused BEFORE any write: nothing is voided, copied or installed into whatever it names (D-3464)', (kind) => {
    const home = freshBox('ccrc-install-ver-linked-name-');
    installVersionedTree(home, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    shipStamp(treeRoot(home), 'b'.repeat(40), 'v9.9.1');
    // The name the run would place into. A link into a directory that even
    // carries a kept record — the record the copy arm voids first.
    const elsewhere = join(home, 'elsewhere-3');
    if (kind === 'a regular file') {
      writeFileSync(vroot(home, 'v9.9.1'), 'not a tree\n');
    } else {
      mkdirSync(join(elsewhere, 'server'), { recursive: true });
      writeFileSync(join(elsewhere, 'server', 'MINE'), 'not ccrc\n');
      writeFileSync(join(elsewhere, '.ccrc-installed'), `${'b'.repeat(40)}\n`);
      symlinkSync(elsewhere, vroot(home, 'v9.9.1'));
    }
    const before = kind === 'a regular file' ? '' : treeBytes(elsewhere);
    const running = treeBytes(vroot(home, 'v9.9.0'));
    const r = runInstall(home, ['install'], {}, { stubs: { ln: lnRecorder } });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toContain('ccrc: $HOME/ccrc-versions/v9.9.1 is not a directory ccrc placed — nothing was written; $HOME/ccrc and $HOME/ccrc-versions were not touched');
    if (kind !== 'a regular file') {
      expect(treeBytes(elsewhere), 'the link\'s target was written through').toEqual(before);
      expect(existsSync(join(elsewhere, '.ccrc-installed')), 'the target\'s kept record was voided').toBe(true);
    } else {
      expect(readFileSync(vroot(home, 'v9.9.1'), 'utf8')).toBe('not a tree\n');
    }
    expect(existsSync(join(home, 'rsync-argv')), 'rsync ran').toBe(false);
    expect(existsSync(join(home, 'npm-argv')), 'npm ci ran').toBe(false);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(vroot(home, 'v9.9.0'));
    expect(treeBytes(vroot(home, 'v9.9.0'))).toEqual(running);
  });

  it('a re-run from the version ~/ccrc points at: the pre-W6 sentence, no copy, no npm ci, no flip — and the stamp comes from the version\'s own kept copy', () => {
    const home = mkTmp('ccrc-install-ver-rerun-');
    installVersionedTree(home, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    healthyDoctorBox(home);
    const digestBefore = read(vroot(home, 'v9.9.0', '.ccrc-digest'));
    const r = runInstall(home, ['install'], {}, { from: join(home, 'ccrc', 'ccd', 'ccrc') });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^install: tree: already running from \$HOME\/ccrc$/m);
    expect(existsSync(join(home, 'rsync-argv')), 'rsync ran against the running version').toBe(false);
    expect(r.stdout).toMatch(/^install: tree: v9\.9\.0 is kept \(its install record is present and its digest re-measures equal\) — no npm ci$/m);
    expect(existsSync(join(home, 'npm-argv')), 'npm ci emptied the running version\'s node_modules').toBe(false);
    expect(r.stdout).not.toMatch(/one rename$/m);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(vroot(home, 'v9.9.0'));
    expect(r.stdout).toMatch(/^install: stamp: 9{40} \(main, v9\.9\.0, kept with its version\)$/m);
    expect(JSON.parse(read(join(home, '.ccrc', 'build.json'))).version).toBe('v9.9.0');
    // D-3465 (b): a CLEAN version re-takes its keep on the digest it recorded,
    // which this run leaves as it was.
    expect(r.stdout).toMatch(/^install: versions: kept v9\.9\.0's stamp and install record in \$HOME\/ccrc-versions\/v9\.9\.0/m);
    expect(read(vroot(home, 'v9.9.0', '.ccrc-digest'))).toBe(digestBefore);
  });

  it('a run of ANOTHER placed version\'s own ccrc flips to it without copying; a complete one fetches no deps, an incomplete one does', () => {
    const home = mkTmp('ccrc-install-ver-other-');
    installVersionedTree(home, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    installVersionedTree(home, 'v9.9.1', { link: false, stamp: { sha: 'c'.repeat(40), version: 'v9.9.1' } });
    healthyDoctorBox(home);
    const before = treeBytes(vroot(home, 'v9.9.0'));
    const r = runInstall(home, ['install'], {}, { from: vroot(home, 'v9.9.1', 'ccd', 'ccrc') });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^install: tree: v9\.9\.1 is already placed at \$HOME\/ccrc-versions\/v9\.9\.1 — installing from it, no copy$/m);
    expect(existsSync(join(home, 'rsync-argv')), 'a placed version was copied onto itself').toBe(false);
    expect(existsSync(join(home, 'npm-argv'))).toBe(false);
    expect(r.stdout).toMatch(/^install: tree: \$HOME\/ccrc -> \$HOME\/ccrc-versions\/v9\.9\.1 \(was \$HOME\/ccrc-versions\/v9\.9\.0\) — one rename$/m);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(vroot(home, 'v9.9.1'));
    expect(treeBytes(vroot(home, 'v9.9.0'))).toEqual(before);

    const inc = mkTmp('ccrc-install-ver-incomplete-');
    installVersionedTree(inc, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    installVersionedTree(inc, 'v9.9.1', { link: false, complete: false });
    healthyDoctorBox(inc);
    const ri = runInstall(inc, ['install'], {}, { from: vroot(inc, 'v9.9.1', 'ccd', 'ccrc') });
    expect(ri.code, ri.stderr).toBe(0);
    expect(read(join(inc, 'npm-cwd')).trim().split('\n')).toEqual([vroot(inc, 'v9.9.1', 'server')]);
    expect(readlinkSync(join(inc, 'ccrc'))).toBe(vroot(inc, 'v9.9.1'));
  });

  it('an npm ci that fails leaves ~/ccrc where it was — the flip is the LAST act of _inst_tree', () => {
    const home = freshBox('ccrc-install-ver-npmfail-');
    installVersionedTree(home, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    shipStamp(treeRoot(home), 'b'.repeat(40), 'v9.9.1');
    const r = runInstall(home, ['install'], {}, {
      stubs: { npm: '#!/bin/sh\necho "npm ERR! code ENOTFOUND registry.npmjs.org" >&2\nexit 1\n' },
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(
      /^ccrc: npm ci in \$HOME\/ccrc-versions\/v9\.9\.1\/server failed — the service cannot start without runtime deps$/m);
    expect(readlinkSync(join(home, 'ccrc')), '~/ccrc was flipped onto a tree with no deps').toBe(vroot(home, 'v9.9.0'));
    expect(r.stdout).not.toMatch(/one rename$/m);
  });

  it('a re-placement that dies leaves its version INCOMPLETE — the kept record goes before the first byte is written', () => {
    const home = freshBox('ccrc-install-ver-void-');
    const sha = gitInit(treeRoot(home));
    const name = `untagged-${sha.slice(0, 12)}`;
    expect(runInstall(home).code).toBe(0);
    expect(existsSync(vroot(home, name, '.ccrc-installed')), 'the first run kept no record').toBe(true);
    expect(existsSync(vroot(home, name, '.ccrc-digest')), 'the first run kept no digest').toBe(true);
    const r = runInstall(home, ['install'], {}, {
      stubs: { npm: '#!/bin/sh\necho "npm ERR! fixture" >&2\nexit 1\n' },
    });
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(new RegExp(`^install: tree: reinstalled ${name} in place at `, 'm'));
    expect(existsSync(vroot(home, name, '.ccrc-installed')),
      'a version whose re-placement died still says it holds a finished install').toBe(false);
    // D-3465 (e): the digest goes with the record — it describes the bytes the rsync replaced.
    expect(existsSync(vroot(home, name, '.ccrc-digest')),
      'a version whose re-placement died still carries the digest of the bytes it replaced').toBe(false);
  });

  it('refuses to place or flip over a ~/ccrc this ccrc did not make — a foreign link, a regular file — and touches neither it nor the versions root', () => {
    const home = freshBox('ccrc-install-ver-foreign-');
    mkdirSync(join(home, 'elsewhere'));
    symlinkSync(join(home, 'elsewhere'), join(home, 'ccrc'));
    const r = runInstall(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: \$HOME\/ccrc is a link whose target is not a version directory under \$HOME\/ccrc-versions — refusing to place or flip a tree over something this ccrc did not make; \$HOME\/ccrc and \$HOME\/ccrc-versions were not touched$/m);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(join(home, 'elsewhere'));
    expect(readdirSync(join(home, 'elsewhere'))).toEqual([]);
    expect(existsSync(vroot(home))).toBe(false);
    expect(existsSync(join(home, 'rsync-argv'))).toBe(false);

    const file = freshBox('ccrc-install-ver-file-');
    writeFileSync(join(file, 'ccrc'), 'not a tree\n');
    const rf = runInstall(file);
    expect(rf.code).toBe(1);
    expect(rf.stderr).toMatch(/^ccrc: \$HOME\/ccrc is neither a directory nor a link — refusing to place or flip/m);
    expect(read(join(file, 'ccrc'))).toBe('not a tree\n');
    expect(existsSync(vroot(file))).toBe(false);
  });

  it('_inst_tree names a crashed migration a bug and places nothing (the resume that precedes it is W6 Task 3\'s)', () => {
    const home = freshBox('ccrc-install-ver-crashed-');
    mkdirSync(join(home, 'ccrc.migrating', 'server'), { recursive: true });
    const r = sourced(home, ccrcIn(treeRoot(home)), 'INST_ROLE=both; _inst_tree');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: a migration of \$HOME\/ccrc is incomplete — this run should have completed it first$/m);
    expect(existsSync(vroot(home))).toBe(false);
    expect(existsSync(join(home, 'ccrc'))).toBe(false);
  });

  it('the kept record is written LAST: a run killed at the stamp copy leaves no record copy, and a refused record copy takes the stamp copy with it', () => {
    const killed = freshBox('ccrc-install-ver-kill-');
    const sha = gitInit(treeRoot(killed));
    const name = `untagged-${sha.slice(0, 12)}`;
    writeFileSync(join(killed, 'fixture-kill-at-stamp-copy'), '');
    const r = runInstall(killed, ['install'], {}, { stubs: { mv: mvKnobs } });
    expect(r.code, 'the run was not killed at the stamp copy').toBe(-1);
    expect(existsSync(join(killed, '.ccrc', 'installed')), 'the fixture killed the run before the record').toBe(true);
    expect(existsSync(vroot(killed, name, '.ccrc-installed')),
      'a version that never kept its stamp is marked complete').toBe(false);
    expect(existsSync(vroot(killed, name, '.ccrc-stamp.json'))).toBe(false);
    expect(existsSync(vroot(killed, name, '.ccrc-digest')), 'a digest was written before the stamp copy').toBe(false);

    const refused = freshBox('ccrc-install-ver-refuse-');
    const rsha = gitInit(treeRoot(refused));
    const rname = `untagged-${rsha.slice(0, 12)}`;
    writeFileSync(join(refused, 'fixture-fail-at-record-copy'), '');
    const rr = runInstall(refused, ['install'], {}, { stubs: { mv: mvKnobs } });
    expect(rr.code, rr.stderr).toBe(0);
    expect(rr.stdout).toMatch(new RegExp(`^install: versions: WARN: could not keep ${rname}'s stamp and install record in its directory — no flip can return to it; arm 2 still can$`, 'm'));
    expect(existsSync(vroot(refused, rname, '.ccrc-stamp.json')), 'half a pair survived').toBe(false);
    expect(existsSync(vroot(refused, rname, '.ccrc-installed'))).toBe(false);
    expect(existsSync(vroot(refused, rname, '.ccrc-digest')), 'half a set survived: the digest outlived its refused record').toBe(false);
    expect(strays(refused)).toEqual([]);
  });

  // D-3465: the record is still LAST, and the digest goes BEFORE it.
  it('the kept DIGEST is written before the record: a run killed at the digest copy leaves a stamp copy and NO record; a refused digest copy takes the stamp copy with it and writes no record', () => {
    const killed = freshBox('ccrc-install-ver-digest-kill-');
    const sha = gitInit(treeRoot(killed));
    const name = `untagged-${sha.slice(0, 12)}`;
    writeFileSync(join(killed, 'fixture-kill-at-digest-copy'), '');
    const r = runInstall(killed, ['install'], {}, { stubs: { mv: mvKnobs } });
    expect(r.code, 'the run was not killed at the digest copy').toBe(-1);
    expect(existsSync(vroot(killed, name, '.ccrc-stamp.json')), 'the fixture killed the run before the stamp copy landed').toBe(true);
    expect(existsSync(vroot(killed, name, '.ccrc-installed')),
      'the record was written before the digest: a version marked complete with nothing to say what its bytes are').toBe(false);
    expect(existsSync(vroot(killed, name, '.ccrc-digest'))).toBe(false);

    const refused = freshBox('ccrc-install-ver-digest-refuse-');
    const rsha = gitInit(treeRoot(refused));
    const rname = `untagged-${rsha.slice(0, 12)}`;
    writeFileSync(join(refused, 'fixture-fail-at-digest-copy'), '');
    const rr = runInstall(refused, ['install'], {}, { stubs: { mv: mvKnobs } });
    expect(rr.code, rr.stderr).toBe(0);
    expect(rr.stdout).toMatch(new RegExp(`^install: versions: WARN: could not keep ${rname}'s stamp and install record in its directory — no flip can return to it; arm 2 still can$`, 'm'));
    for (const f of ['.ccrc-stamp.json', '.ccrc-digest', '.ccrc-installed']) {
      expect(existsSync(vroot(refused, rname, f)), `${f} survived a refused digest copy`).toBe(false);
    }
    expect(strays(refused)).toEqual([]);
  });

  /** `_ver_kept <name> <role>` on the fixture box, sourced: `rc=<n> why=<VER_WHY>`. */
  const keptAnswer = (home: string, name: string, role = 'both'): string => {
    const r = sourced(home, join(REPO, 'ccd', 'ccrc'),
      `rc=0; _ver_kept '${name}' '${role}' || rc=$?; printf 'rc=%s why=%s\\n' "$rc" "$VER_WHY"`);
    return r.stdout.split('\n').find((l) => l.startsWith('rc=')) ?? `no answer: ${r.stderr}`;
  };

  it('a run that PLACES the tree (how=copy) records a fresh digest: `1:<64 hex>`, mode 644, equal to a re-measure of the version through the shipped recipe — and the version reads kept', () => {
    const home = freshBox('ccrc-install-ver-digest-recorded-');
    const sha = gitInit(treeRoot(home));
    const name = `untagged-${sha.slice(0, 12)}`;
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    const digest = read(vroot(home, name, '.ccrc-digest'));
    expect(digest).toMatch(/^1:[0-9a-f]{64}\n$/);
    expect(statSync(vroot(home, name, '.ccrc-digest')).mode & 0o777).toBe(0o644);
    const again = sourced(home, join(REPO, 'ccd', 'ccrc'),
      `_ver_digest_of 1 '${vroot(home, name)}' && printf '%s\\n' "$VER_DIGEST_NOW"`);
    expect(again.stdout.trim()).toBe(digest.trim());
    expect(keptAnswer(home, name)).toBe('rc=0 why=');
    expect(strays(home)).toEqual([]);
  });

  it('a placing run whose digest CANNOT be measured keeps nothing: the WARN names why, and neither the stamp copy, the digest nor the record survives — never a kept version with no statement about its bytes (D-3465 (c))', () => {
    const home = mkTmp('ccrc-install-ver-digest-unmeasured-');
    const root = installVersionedTree(home, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'), read(join(root, '.ccrc-stamp.json')));
    writeFileSync(join(home, '.ccrc', 'installed'), `${'9'.repeat(40)}\n`);
    const r = sourced(home, join(REPO, 'ccd', 'ccrc'), "_plat_sha256() { return 1; }; _ver_keep_state install v9.9.0");
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain("install: versions: WARN: could not keep v9.9.0's stamp and install record in its directory (its digest could not be measured (a file could not be read)) — no flip can return to it; arm 2 still can");
    for (const f of ['.ccrc-stamp.json', '.ccrc-digest', '.ccrc-installed']) {
      expect(existsSync(join(root, f)), `${f} survived`).toBe(false);
    }
  });

  // ── (b) and (d): the launcher over a tree something wrote through ─────────
  /** A W6 box whose pointed-at v9.9.0 is kept, then written through the way
   *  deploy.sh does (a file into the tree; the BOX stamp reshaped to another
   *  build and its record rewritten) — the input the review reproduced. */
  const writtenThroughBox = (prefix: string, opts: { digest?: boolean } = {}): { home: string; kept: string; boxStamp: string } => {
    const home = mkTmp(prefix);
    const kept = installVersionedTree(home, 'v9.9.0', { digest: opts.digest, stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    healthyDoctorBox(home);
    writeFileSync(join(kept, 'agent', 'WRITTEN-THROUGH'), 'a working tree X, rsynced through the link\n');
    const boxStamp = `${JSON.stringify({ sha: 'e'.repeat(40), ref: 'main', builtAt: '2026-09-25T00:00:00Z', dirty: false })}\n`;
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'), boxStamp);
    writeFileSync(join(home, '.ccrc', 'installed'), `${'e'.repeat(40)}\n`);
    return { home, kept, boxStamp };
  };

  it('`ccrc install` from the launcher over a WRITTEN-THROUGH pointed-at version: its keep is NOT taken again, the kept stamp is not installed as the box\'s, npm ci runs (the skip is gone) — and the version stays not kept (D-3465 (b), (d); review 179 F2)', () => {
    const { home, kept, boxStamp } = writtenThroughBox('ccrc-install-ver-launcher-wt-');
    expect(keptAnswer(home, 'v9.9.0'), 'the control is broken: the written-through tree must read as such').toMatch(/^rc=3 /);
    const stampBefore = read(join(kept, '.ccrc-stamp.json'));
    const recordBefore = read(join(kept, '.ccrc-installed'));
    const digestBefore = read(join(kept, '.ccrc-digest'));
    const r = runInstall(home, ['install'], {}, { from: join(home, 'ccrc', 'ccd', 'ccrc') });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^install: tree: already running from \$HOME\/ccrc$/m);
    // (d) the npm-ci skip takes the bytes' answer: this is an in-place npm ci.
    expect(r.stdout).not.toMatch(/is kept \(its install record is present and its digest re-measures equal\) — no npm ci/);
    expect(read(join(home, 'npm-cwd')).trim().split('\n')).toEqual([vroot(home, 'v9.9.0', 'server')]);
    // (d) the kept-stamp fallback takes it too: the box keeps ITS stamp.
    expect(r.stdout).toMatch(/^install: stamp: v9\.9\.0's kept stamp is not installed — it is not a kept version \(its tree is no longer the one that was kept /m);
    expect(read(join(home, '.ccrc', 'build.json'))).toBe(boxStamp);
    // (b) the keep is not taken again, and nothing the version kept moved.
    expect(r.stdout).toMatch(/^install: versions: v9\.9\.0 is NOT kept again by this run — its tree is no longer the one that was kept /m);
    expect(r.stdout).not.toMatch(/^install: versions: kept v9\.9\.0's stamp/m);
    expect(read(join(kept, '.ccrc-stamp.json'))).toBe(stampBefore);
    expect(read(join(kept, '.ccrc-installed'))).toBe(recordBefore);
    expect(read(join(kept, '.ccrc-digest'))).toBe(digestBefore);
    expect(keptAnswer(home, 'v9.9.0'), 'the launcher made a written-through version kept').toMatch(/^rc=3 /);
  });

  it('`ccrc install` from the launcher over a version kept BEFORE digests existed: the recorded digest it needs is absent, so it is not kept again — no digest is invented by a run that placed nothing — and npm ci runs', () => {
    const { home, kept } = writtenThroughBox('ccrc-install-ver-launcher-nodigest-', { digest: false });
    rmSync(join(kept, 'agent', 'WRITTEN-THROUGH'));   // clean bytes: the ONLY defect is the missing digest
    expect(keptAnswer(home, 'v9.9.0')).toMatch(/^rc=2 why=no kept digest /);
    const r = runInstall(home, ['install'], {}, { from: join(home, 'ccrc', 'ccd', 'ccrc') });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(read(join(home, 'npm-cwd')).trim().split('\n')).toEqual([vroot(home, 'v9.9.0', 'server')]);
    expect(r.stdout).toMatch(/^install: versions: v9\.9\.0 is NOT kept again by this run — no kept digest /m);
    expect(existsSync(join(kept, '.ccrc-digest')), 'a run that placed nothing recorded a digest').toBe(false);
    expect(keptAnswer(home, 'v9.9.0')).toMatch(/^rc=2 why=no kept digest /);
  });

  it('a run of ANOTHER placed version\'s ccrc, that version written through: it is flipped to (an operator\'s explicit act) but not kept again, its kept stamp is not installed, and it runs npm ci (D-3465 (b), (d))', () => {
    const home = mkTmp('ccrc-install-ver-other-wt-');
    installVersionedTree(home, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    const other = installVersionedTree(home, 'v9.9.1', { link: false, stamp: { sha: 'c'.repeat(40), version: 'v9.9.1' } });
    healthyDoctorBox(home);
    writeFileSync(join(other, 'shared', 'WRITTEN-THROUGH'), 'x\n');
    const digestBefore = read(join(other, '.ccrc-digest'));
    const r = runInstall(home, ['install'], {}, { from: vroot(home, 'v9.9.1', 'ccd', 'ccrc') });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^install: tree: v9\.9\.1 is already placed at /m);
    expect(read(join(home, 'npm-cwd')).trim().split('\n')).toEqual([vroot(home, 'v9.9.1', 'server')]);
    expect(r.stdout).toMatch(/^install: stamp: v9\.9\.1's kept stamp is not installed — it is not a kept version /m);
    // With no kept stamp installed the box has no stamp at all, so no record is written and nothing is kept.
    expect(r.stdout).toMatch(/^install: installed: not recorded — this box has no readable build stamp/m);
    expect(r.stdout).not.toMatch(/^install: versions: kept v9\.9\.1's stamp/m);
    expect(read(join(other, '.ccrc-digest'))).toBe(digestBefore);
    expect(keptAnswer(home, 'v9.9.1')).toMatch(/^rc=3 /);
  });

  it('the other refusal: a source tree that is NOT a placed version but carries a stray kept stamp is PLACED by copy (how=copy) — its kept stamp is refused as "not a version under $HOME/ccrc-versions", and because that run flipped `~/ccrc` the stale box stamp is removed too (review 179 I1)', () => {
    const home = freshBox('ccrc-install-ver-stray-stamp-');
    const tree = treeRoot(home);
    writeFileSync(join(tree, '.ccrc-stamp.json'), `${JSON.stringify({ sha: 'd'.repeat(40), ref: 'main', builtAt: '2026-09-23T00:00:00Z', dirty: false, version: 'v9.9.9' })}\n`);
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'), `${JSON.stringify({ sha: 'e'.repeat(40), ref: 'main', builtAt: '2026-09-20T00:00:00Z', dirty: false })}\n`);
    writeFileSync(join(home, '.ccrc', 'installed'), `${'e'.repeat(40)}\n`);
    const r = runInstall(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^install: tree: placed /m);
    expect(r.stdout).toMatch(/^install: stamp: the kept stamp beside this tree is not installed — this run placed the tree by copy, and only a version already placed under \$HOME\/ccrc-versions is read for its kept stamp$/m);
    expect(r.stdout).toMatch(/^install: stamp: removed the box's stamp \(it names untagged-eeeeeeeeeeee, not unstamped-[0-9a-f]{12}, the version this run moved \$HOME\/ccrc to\) — ccrc version will say unstamped$/m);
    expect(existsSync(join(home, '.ccrc', 'build.json')), 'the box kept a stamp naming a build it no longer runs').toBe(false);
    expect(r.stdout).toMatch(/^install: installed: not recorded — this box has no readable build stamp/m);
  });

  it('`_inst_stamp_shipped` resolves no path physically: it reads the version name `_inst_tree` measured (`INST_TREE_HOW`/`INST_TREE_NAME`) — constraint 3 lists the only physical resolutions, and a second `pwd -P` on `~/ccrc` is not among them (review 179 M6). A literal-absence pin, honest as one', () => {
    const src = read(join(REPO, 'ccd', 'ccrc'));
    const start = src.indexOf('\n_inst_stamp_shipped() {');
    expect(start, '_inst_stamp_shipped is gone or renamed — update this pin WITH the name').toBeGreaterThan(0);
    const end = src.indexOf('\n}\n', start);
    const body = src.slice(start, end);
    expect(body).toContain('INST_TREE_NAME');
    for (const banned of ['pwd -P', 'readlink -f', 'realpath', 'cd -P']) {
      expect(body, `_inst_stamp_shipped resolves a path physically (${banned})`).not.toContain(banned);
    }
  });

  it('the digest is an install-path tool now: with `sha256sum` (`shasum` on macOS) ABSENT from PATH a placing run cannot measure the tree, so it keeps NOTHING — the WARN names why, no stamp copy, digest or record is written, and the version never reads kept (review 179 M2, D-3465 (c))', () => {
    const home = freshBox('ccrc-install-ver-no-sha256-');
    const sha = gitInit(treeRoot(home));
    const name = `untagged-${sha.slice(0, 12)}`;
    const r = runInstall(home, ['install'], { PATH: pathWithout(home, SHA256_TOOL) });
    expect(r.stdout, `stderr: ${r.stderr}`).toMatch(new RegExp(`^install: versions: WARN: could not keep ${name}'s stamp and install record in its directory \\(its digest could not be measured \\(`, 'm'));
    for (const f of ['.ccrc-stamp.json', '.ccrc-digest', '.ccrc-installed']) {
      expect(existsSync(vroot(home, name, f)), `${f} was written by a run that could not measure the tree`).toBe(false);
    }
    // never "kept": a version with no record reads incomplete (rc 2), whatever the PATH
    expect(keptAnswer(home, name)).toMatch(/^rc=2 why=no /);
  });

  it('_ver_keep_state records a fresh digest only for the version THIS run placed: a placed name that `~/ccrc` no longer names records nothing — a concurrent plain install re-pointed the link between this run\'s flip and its keep (review 179 M3, D-3465 (b))', () => {
    const home = mkTmp('ccrc-install-ver-placed-name-');
    const root = installVersionedTree(home, 'v9.9.0', { digest: false, stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'), read(join(root, '.ccrc-stamp.json')));
    writeFileSync(join(home, '.ccrc', 'installed'), `${'9'.repeat(40)}\n`);
    expect(keptAnswer(home, 'v9.9.0')).toMatch(/^rc=2 why=no kept digest /);
    // this run placed v9.9.1, but ~/ccrc names v9.9.0 by now: the bytes under v9.9.0 are not this run's
    const other = sourced(home, join(REPO, 'ccd', 'ccrc'), '_ver_keep_state install v9.9.1');
    expect(other.code, other.stderr).toBe(0);
    expect(other.stdout).toContain('install: versions: this run placed v9.9.1, but $HOME/ccrc names v9.9.0 by now — no fresh digest is recorded for bytes this run did not place');
    expect(other.stdout).toMatch(/^install: versions: v9\.9\.0 is NOT kept again by this run — no kept digest /m);
    expect(existsSync(join(root, '.ccrc-digest')), 'a digest was blessed over bytes this run did not place').toBe(false);
    expect(keptAnswer(home, 'v9.9.0')).toMatch(/^rc=2 why=no kept digest /);
    // control: the name it placed IS the name ~/ccrc has — a fresh digest, and the version reads kept
    const same = sourced(home, join(REPO, 'ccd', 'ccrc'), '_ver_keep_state install v9.9.0');
    expect(same.code, same.stderr).toBe(0);
    expect(same.stdout).toMatch(/^install: versions: kept v9\.9\.0's stamp and install record /m);
    expect(read(join(root, '.ccrc-digest'))).toMatch(/^1:[0-9a-f]{64}\n$/);
    expect(keptAnswer(home, 'v9.9.0')).toBe('rc=0 why=');
  });

  it('_ver_keep_state with NO placed name (a `running`/`placed` spine, or a pre-W6 spine that wrote in place) takes the keep again exactly when the recorded digest re-measures equal — re-placed bytes that measure equal are re-kept, bytes that differ are not (review 179 M4; D-3465 (b))', () => {
    const home = mkTmp('ccrc-install-ver-rekeep-');
    const root = installVersionedTree(home, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'), read(join(root, '.ccrc-stamp.json')));
    writeFileSync(join(home, '.ccrc', 'installed'), `${'9'.repeat(40)}\n`);
    const digest = read(join(root, '.ccrc-digest'));
    const eq = sourced(home, join(REPO, 'ccd', 'ccrc'), "_ver_keep_state update ''");
    expect(eq.stdout).toMatch(/^update: versions: kept v9\.9\.0's stamp and install record /m);
    expect(read(join(root, '.ccrc-digest'))).toBe(digest);
    writeFileSync(join(root, 'shared', 'WRITTEN-THROUGH'), 'x\n');
    const differ = sourced(home, join(REPO, 'ccd', 'ccrc'), "_ver_keep_state update ''");
    expect(differ.stdout).toMatch(/^update: versions: v9\.9\.0 is NOT kept again by this run — its tree is no longer the one that was kept /m);
    expect(read(join(root, '.ccrc-digest')), 'the digest was rewritten over bytes this run did not place').toBe(digest);
  });

  /** A W6 box that ALREADY completed an install of v9.9.0 (pointed at, kept,
   *  its stamp and record in `~/.ccrc`) plus a second placed version v9.9.1
   *  that is not pointed at. The state the review's I1 probe started from —
   *  the existing `ANOTHER placed version` pin starts from a box with NO
   *  stamp, which is why it could not see the carry-forward. */
  const stampedBoxWithOther = (prefix: string, other: { writeThrough: boolean }): { home: string; oldRoot: string; otherRoot: string } => {
    const home = mkTmp(prefix);
    const oldRoot = installVersionedTree(home, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    const otherRoot = installVersionedTree(home, 'v9.9.1', { link: false, stamp: { sha: 'c'.repeat(40), version: 'v9.9.1' } });
    healthyDoctorBox(home);
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'), read(join(oldRoot, '.ccrc-stamp.json')));
    writeFileSync(join(home, '.ccrc', 'installed'), `${'9'.repeat(40)}\n`);
    if (other.writeThrough) writeFileSync(join(otherRoot, 'shared', 'WRITTEN-THROUGH'), 'x\n');
    return { home, oldRoot, otherRoot };
  };

  it('a run of ANOTHER placed version\'s ccrc, that version written through, from a box that ALREADY carries a stamp: the flip happens, so the box stamp that names the build the box LEFT is removed — the install is not recorded as completed for a build that is not running, and `ccrc version` says unstamped (D-3465 (d); review 179 I1)', () => {
    const { home, otherRoot } = stampedBoxWithOther('ccrc-install-ver-other-wt-stamped-', { writeThrough: true });
    expect(keptAnswer(home, 'v9.9.1'), 'the control is broken: the placed tree must read as written through').toMatch(/^rc=3 /);
    const r = runInstall(home, ['install'], {}, { from: vroot(home, 'v9.9.1', 'ccd', 'ccrc') });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^install: tree: v9\.9\.1 is already placed at /m);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(otherRoot);
    // the stamp that named v9.9.0's build is gone, and the run says so
    expect(existsSync(join(home, '.ccrc', 'build.json')), 'the box kept a stamp naming the build it just left').toBe(false);
    expect(r.stdout).toMatch(/^install: stamp: v9\.9\.1's kept stamp is not installed — it is not a kept version /m);
    expect(r.stdout).toMatch(/^install: stamp: removed the box's stamp \(it names v9\.9\.0, not v9\.9\.1, the version this run moved \$HOME\/ccrc to\) — ccrc version will say unstamped$/m);
    // so `_inst_installed` takes its no-stamp arm: nothing is recorded as completed, nothing is kept
    expect(r.stdout).toMatch(/^install: installed: not recorded — this box has no readable build stamp/m);
    expect(r.stdout).not.toMatch(/^install: installed: 9{40} /m);
    expect(r.stdout).not.toMatch(/^install: versions: kept v9\.9\.1's stamp/m);
    // what the box then says of itself
    const v = runInstall(home, ['version'], {}, { from: join(home, 'ccrc', 'ccd', 'ccrc') });
    expect(`${v.stdout}${v.stderr}`).toMatch(/unstamped \(no /m);
    expect(keptAnswer(home, 'v9.9.1')).toMatch(/^rc=3 /);
  });

  it('control: the same flip onto a version that IS kept installs that version\'s kept stamp, so the box names the build it now runs (nothing is removed)', () => {
    const { home } = stampedBoxWithOther('ccrc-install-ver-other-kept-stamped-', { writeThrough: false });
    expect(keptAnswer(home, 'v9.9.1')).toBe('rc=0 why=');
    const r = runInstall(home, ['install'], {}, { from: vroot(home, 'v9.9.1', 'ccd', 'ccrc') });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).not.toMatch(/removed the box's stamp/);
    expect(JSON.parse(read(join(home, '.ccrc', 'build.json'))).sha).toBe('c'.repeat(40));
  });

  it('control: `ccrc install` from the LAUNCHER (how=running) over a written-through pointed-at version keeps the box stamp — it names the version `~/ccrc` still points at, so nothing is removed', () => {
    const { home, boxStamp } = writtenThroughBox('ccrc-install-ver-launcher-wt-stamp-keep-');
    const r = runInstall(home, ['install'], {}, { from: join(home, 'ccrc', 'ccd', 'ccrc') });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).not.toMatch(/removed the box's stamp/);
    expect(read(join(home, '.ccrc', 'build.json'))).toBe(boxStamp);
  });

  // Wave 9 R8i (D-3828): a skip writes nothing, so a box stamp that is still there afterwards STAYS — and the
  // skip line must not say `ccrc version will say unstamped` over it. The run is FROM the version `~/ccrc` points
  // at, so `_inst_tree` itself answers `running` (INST_TREE_HOW is set in-process, never read from the environment)
  // and `_inst_stamp_unname` returns 1 for it before it touches the stamp; the tree carries no `build.json`, the
  // kept stamp beside it is the fallback `_inst_stamp_shipped` reads, that version is NOT kept (no digest, rc 2),
  // and git is off PATH, so `_inst_stamp` lands on its no-git skip with the box's stamp still on disk.
  it('a skipped stamp over a box stamp that STAYS says so — the launcher run, no build.json in the tree, the version not kept, git off PATH: the line names the existing stamp, never `unstamped` (wave 9 R8i, D-3828)', () => {
    const { home, boxStamp } = writtenThroughBox('ccrc-install-stamp-stays-skip-', { digest: false });
    expect(existsSync(join(home, 'ccrc', 'build.json')), 'the control is broken: the tree must carry no build.json').toBe(false);
    expect(keptAnswer(home, 'v9.9.0'), 'the control is broken: the version must be not kept').toMatch(/^rc=2 why=no kept digest /);
    const r = runInstall(home, ['install'], { PATH: pathWithout(home, 'git') }, { from: join(home, 'ccrc', 'ccd', 'ccrc') });
    expect(r.stdout).toMatch(/^install: tree: already running from \$HOME\/ccrc$/m);
    expect(r.stdout).toMatch(
      /^install: stamp: skipped \(no git on PATH\) — the box's existing stamp \(~\/\.ccrc\/build\.json\) stays — ccrc version reports what it says$/m);
    expect(r.stdout, 'a stamp that stays was called unstamped').not.toMatch(/will say unstamped/);
    expect(read(join(home, '.ccrc', 'build.json')), 'the skip rewrote or removed the stamp').toBe(boxStamp);
  });

  // ── N1 (re-review of fix round 1): the removal is for a stamp that names
  //    ANOTHER version. The name compared is the one `_inst_tree` placed or
  //    flipped to (`INST_TREE_NAME`): the stamp's `version` when it has one,
  //    else `untagged-<sha12>`; an `unstamped-*` target is never a stamp's
  //    name, and a stamp that cannot be read names nothing comparable.
  it('a hand repair onto a digestless version whose box stamp ALREADY names it (a killed flip\'s leftovers): the flip is a no-op, the stamp stays, the install is recorded for the build that runs, and no line says the box "just left" it (D-3465 (d); re-review N1 shape A)', () => {
    const home = mkTmp('ccrc-install-ver-stamp-names-target-');
    installVersionedTree(home, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    const other = installVersionedTree(home, 'v9.9.1', { link: false, digest: false, stamp: { sha: 'c'.repeat(40), version: 'v9.9.1' } });
    healthyDoctorBox(home);
    // the killed flip's leftovers: the stamp is v9.9.1's, the record is not written
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'), read(join(other, '.ccrc-stamp.json')));
    const stampBefore = read(join(home, '.ccrc', 'build.json'));
    expect(keptAnswer(home, 'v9.9.1'), 'the control is broken: the version must read digestless (unmeasured)').toMatch(/^rc=2 why=no kept digest /);
    const r = runInstall(home, ['install'], {}, { from: vroot(home, 'v9.9.1', 'ccd', 'ccrc') });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(other);
    expect(r.stdout).toMatch(/^install: stamp: v9\.9\.1's kept stamp is not installed — it is not a kept version /m);
    expect(r.stdout, 'the run says the box left the build it is moving to').not.toMatch(/removed the box's stamp/);
    expect(r.stdout).toMatch(/^install: stamp: the box's stamp already names v9\.9\.1, the version this run moved \$HOME\/ccrc to — it stays$/m);
    expect(r.stdout, 'a stamp that stays is not "skipped, ccrc version will say unstamped"').not.toMatch(/^install: stamp: skipped/m);
    expect(existsSync(join(home, '.ccrc', 'build.json')), 'the stamp that names the version this run moved to was removed').toBe(true);
    expect(read(join(home, '.ccrc', 'build.json'))).toBe(stampBefore);
    expect(r.stdout).toMatch(/^install: installed: c{40} /m);
    expect(read(join(home, '.ccrc', 'installed'))).toBe(`${'c'.repeat(40)}\nunsigned\n`);
  });

  it('the same hand repair onto a version that is WRITTEN THROUGH (its digest re-measures unequal): the box stamp names it, but nothing shows those bytes to be that build — the stamp is removed whatever it names, no completed install is recorded, and `ccrc version` does not read `complete` (D-3465 (d); FX-A2 review M1)', () => {
    const home = mkTmp('ccrc-install-ver-stamp-names-written-through-');
    installVersionedTree(home, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    const other = installVersionedTree(home, 'v9.9.1', { link: false, stamp: { sha: 'c'.repeat(40), version: 'v9.9.1' } });
    healthyDoctorBox(home);
    // the killed flip's leftovers, exactly as the digestless pin plants them ...
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'), read(join(other, '.ccrc-stamp.json')));
    // ... but the version was kept WITH a digest and something has written through it since
    mkdirSync(join(other, 'shared'), { recursive: true });
    writeFileSync(join(other, 'shared', 'WRITTEN-THROUGH'), 'a deploy.sh rsync through the link\n');
    expect(keptAnswer(home, 'v9.9.1'), 'the control is broken: the version must read written through').toMatch(/^rc=3 why=its tree is no longer the one that was kept/);
    const r = runInstall(home, ['install'], {}, { from: vroot(home, 'v9.9.1', 'ccd', 'ccrc') });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(other);
    expect(r.stdout).toMatch(/^install: stamp: v9\.9\.1's kept stamp is not installed — it is not a kept version \(its tree is no longer the one that was kept/m);
    expect(r.stdout, 'a stamp over written-through bytes stayed because it names the target').not.toMatch(/already names/);
    expect(r.stdout).toMatch(/^install: stamp: removed the box's stamp \(it names v9\.9\.1, the version this run moved \$HOME\/ccrc to, but that version's tree was written through since it was kept/m);
    expect(existsSync(join(home, '.ccrc', 'build.json')), 'the stamp survived over written-through bytes').toBe(false);
    expect(r.stdout).toMatch(/^install: installed: not recorded — this box has no readable build stamp/m);
    expect(existsSync(join(home, '.ccrc', 'installed')), 'a completed install was recorded over written-through bytes').toBe(false);
    const v = runInstall(home, ['version'], {}, { from: join(home, 'ccrc', 'ccd', 'ccrc') });
    expect(v.stdout).not.toMatch(/^install: complete/m);
    expect(v.stdout).toMatch(/unstamped/);
    expect(keptAnswer(home, 'v9.9.1'), 'the run laundered a keep').toMatch(/^rc=3 /);
  });

  it('a launcher migration of a real ~/ccrc whose target directory holds a LEFTOVER kept stamp: the box stamp names the migrated version, so it stays, and no line says "this tree is not a version" of a tree that IS the version by then (D-3465 (d); re-review N1 shape B)', () => {
    const home = mkTmp('ccrc-install-ver-migrate-leftover-');
    const root = installFixtureTree(home, 'ccrc');
    healthyDoctorBox(home);
    const stamp = `${JSON.stringify({ sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-09-23T00:00:00Z', dirty: false, version: 'v9.9.2' })}\n`;
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'build.json'), stamp);
    // the migrated version's name is the stamp's version; its directory already holds a kept stamp
    mkdirSync(vroot(home, 'v9.9.2'), { recursive: true });
    writeFileSync(vroot(home, 'v9.9.2', '.ccrc-stamp.json'), stamp);
    const r = runInstall(home, ['install'], {}, { from: ccrcIn(root) });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^install: tree: migrating — \$HOME\/ccrc is a directory; v9\.9\.2 is complete at /m);
    expect(readlinkSync(join(home, 'ccrc'))).toBe(vroot(home, 'v9.9.2'));
    expect(r.stdout, 'a false "not a version" line: the migration had just made it one').not.toMatch(/this tree is not a version under/);
    expect(r.stdout).not.toMatch(/removed the box's stamp/);
    expect(r.stdout).toMatch(/^install: stamp: the box's stamp already names v9\.9\.2, the version this run moved \$HOME\/ccrc to — it stays$/m);
    expect(r.stdout, 'a stamp that stays is not "skipped, ccrc version will say unstamped"').not.toMatch(/^install: stamp: skipped/m);
    expect(read(join(home, '.ccrc', 'build.json'))).toBe(stamp);
    expect(r.stdout).toMatch(/^install: installed: a{40} /m);
    // the migration made the copy the version `~/ccrc` names, so it is kept with a fresh digest
    expect(keptAnswer(home, 'v9.9.2')).toBe('rc=0 why=');
  });

  it('a stamp with NO `version` names `untagged-<sha12>`: flipped onto that very name it stays; a stamp that cannot be read names nothing comparable, so it is removed and the line says it could not be read (D-3465 (d); N1\'s rule)', () => {
    const untagged = `untagged-${'c'.repeat(12)}`;
    const mk = (prefix: string): { home: string; other: string } => {
      const home = mkTmp(prefix);
      installVersionedTree(home, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
      const other = installVersionedTree(home, untagged, { link: false, digest: false, stamp: { sha: 'c'.repeat(40) } });
      healthyDoctorBox(home);
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      return { home, other };
    };
    const a = mk('ccrc-install-ver-stamp-untagged-');
    writeFileSync(join(a.home, '.ccrc', 'build.json'), read(join(a.other, '.ccrc-stamp.json')));
    const ra = runInstall(a.home, ['install'], {}, { from: vroot(a.home, untagged, 'ccd', 'ccrc') });
    expect(ra.code, `stderr: ${ra.stderr}\nstdout: ${ra.stdout}`).toBe(0);
    expect(readlinkSync(join(a.home, 'ccrc'))).toBe(a.other);
    expect(ra.stdout).not.toMatch(/removed the box's stamp/);
    expect(ra.stdout).toMatch(new RegExp(`^install: stamp: the box's stamp already names ${untagged}, the version this run moved \\$HOME/ccrc to — it stays$`, 'm'));
    expect(ra.stdout, 'a stamp that stays is not "skipped, ccrc version will say unstamped"').not.toMatch(/^install: stamp: skipped/m);
    expect(existsSync(join(a.home, '.ccrc', 'build.json'))).toBe(true);
    expect(read(join(a.home, '.ccrc', 'build.json')), 'the stamp that names the target changed').toBe(read(join(a.other, '.ccrc-stamp.json')));
    expect(read(join(a.home, '.ccrc', 'installed')), 'the install was not recorded for the build that runs').toBe(`${'c'.repeat(40)}\nunsigned\n`);
    const u = mk('ccrc-install-ver-stamp-unreadable-');
    writeFileSync(join(u.home, '.ccrc', 'build.json'), 'not json {\n');
    const ru = runInstall(u.home, ['install'], {}, { from: vroot(u.home, untagged, 'ccd', 'ccrc') });
    expect(ru.code, `stderr: ${ru.stderr}\nstdout: ${ru.stdout}`).toBe(0);
    expect(ru.stdout).toMatch(/^install: stamp: removed the box's stamp \(it could not be read, so it cannot be shown to name a version this box is on\) — ccrc version will say unstamped$/m);
    expect(existsSync(join(u.home, '.ccrc', 'build.json'))).toBe(false);
  });

  itDarwin('refuses on macOS without python3, before anything is written — the flip is one rename through os.replace', () => {
    const home = freshBox('ccrc-install-ver-nopython-');
    const r = runInstall(home, ['install'], { PATH: pathWithout(home, 'python3') }, { omit: ['python3'] });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: python3 is required by 'ccrc install' on macOS — the \$HOME\/ccrc flip is one rename\(2\) through os\.replace/m);
    expect(existsSync(join(home, '.ccrc', 'accounts.json'))).toBe(false);
    expect(existsSync(vroot(home))).toBe(false);
    expect(existsSync(join(home, 'ccrc'))).toBe(false);
  });

  it('the macOS python3 preflight, measured on a gating leg: CCD_OS forced to darwin, a python3 that is on PATH but does not run is refused before anything is written (F7, C-Minor-3)', () => {
    const home = freshBox('ccrc-install-ver-darwin-forced-');
    const bin = join(home, 'forced-darwin-bin');
    mkdirSync(bin, { recursive: true });
    for (const t of ['launchctl', 'tmux', 'flock']) writeFileSync(join(bin, t), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(bin, 'python3'),
      '#!/bin/sh\necho "xcode-select: note: No developer tools were found, requesting install." >&2\nexit 1\n', { mode: 0o755 });
    // The stubs shadow everything after them; the real PATH follows for bash's own tools.
    const r = sourced(home, join(REPO, 'ccd', 'ccrc'),
      `PATH='${bin}':"$PATH"; CCD_OS=darwin; cmd_install --role both; echo "survived rc=$?"`);
    expect(r.code, r.stdout).toBe(1);
    expect(r.stdout).not.toContain('survived');
    expect(r.stderr).toMatch(/^ccrc: python3 is required by 'ccrc install' on macOS — the \$HOME\/ccrc flip is one rename\(2\) through os\.replace/m);
    expect(existsSync(join(home, '.ccrc', 'accounts.json'))).toBe(false);
    expect(existsSync(vroot(home))).toBe(false);
    expect(existsSync(join(home, 'ccrc'))).toBe(false);
  });

  itDarwin('refuses on macOS when the python3 on PATH does not RUN — /usr/bin/python3 is an xcode-select stub until the Command Line Tools are installed — before anything is written', () => {
    // The shape a real Mac without the Command Line Tools has: `command -v
    // python3` answers /usr/bin/python3, and running it prints the
    // xcode-select note and exits non-zero. The case above (no python3 on
    // PATH at all) cannot happen on macOS; this one is the one that does.
    const home = freshBox('ccrc-install-ver-stubpython-');
    const r = runInstall(home, ['install'], {}, {
      stubs: { python3: '#!/bin/sh\necho "xcode-select: note: No developer tools were found, requesting install." >&2\nexit 1\n' },
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: python3 is required by 'ccrc install' on macOS — the \$HOME\/ccrc flip is one rename\(2\) through os\.replace/m);
    expect(existsSync(join(home, '.ccrc', 'accounts.json'))).toBe(false);
    expect(existsSync(vroot(home))).toBe(false);
    expect(existsSync(join(home, 'ccrc'))).toBe(false);
    expect(existsSync(join(home, 'rsync-argv')), 'a tree was placed before the refusal').toBe(false);
  });

  // PLATFORM-ONLY: the GC's running-unit read on macOS is plutil over the
  // job's plist, which this harness's plutil stub answers with nothing — an
  // unmeasured read, so a macOS install WARNs and prunes nothing (the safe
  // direction, pinned in ccrc-update-*.test.ts, where the Darwin read itself is
  // measured by forcing CCD_OS in a sourced shell).
  itLinux('after an install whose doctor passed, the GC keeps the newest CCRC_VERSIONS_KEEP beside the pointed-at one and prunes the rest (W6 Task 5)', () => {
    const home = freshBox('ccrc-install-w6-gc-');
    ['v1.0.4', 'v1.0.3', 'v1.0.2', 'v1.0.1', 'v1.0.0'].forEach((n, i) => {
      const root = installVersionedTree(home, n, { link: i === 0, stamp: { sha: 'b'.repeat(40), version: n } });
      const t = 1_800_000_000 - i * 100;
      utimesSync(join(root, '.ccrc-installed'), t, t);
    });
    // The projection a `both` box reads (W2's server writes it): in force and
    // naming no tag, so every one of the GC's inputs measures.
    const now = Math.floor(Date.now() / 1000);
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'update-intent'), [
      'epoch 1', `issued ${now - 60}`, `lease ${now + 840}`, 'channel stable',
      'desired none', 'desired-stable none', 'desired-dev none', 'auto off', 'end',
    ].join('\n') + '\n', { mode: 0o600 });
    const r = runInstall(home);
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(r.stdout).toMatch(/^install: versions: pruned \$HOME\/ccrc-versions\/v1\.0\.1 \(complete, not among the newest 3\)$/m);
    expect(r.stdout).toMatch(/^install: versions: pruned \$HOME\/ccrc-versions\/v1\.0\.0 \(complete, not among the newest 3\)$/m);
    const left = readdirSync(join(home, 'ccrc-versions')).sort();
    const placedName = left.find((n) => n.startsWith('unstamped-'));
    expect(placedName, left.join(' ')).toMatch(/^unstamped-[0-9a-f]{12}$/);
    expect(left).toEqual([placedName!, 'v1.0.2', 'v1.0.3', 'v1.0.4'].sort());
    // …and it ran BEHIND the gate: after doctor's summary, never before it.
    expect(r.stdout.indexOf('install: versions: pruned'))
      .toBeGreaterThan(r.stdout.search(/^summary: /m));
  });

  // W6 Task 5 introduces a remover that can run BESIDE a plain install, which
  // takes no lock: `ccrc versions --prune` removes an incomplete directory
  // (the one this run is placing), and another run's automatic GC removes a
  // complete one that nothing protects yet. `_plat_ln_swap` never checks its
  // target, so the flip measures it again (D-3456).
  it('a new version removed before the flip — a prune beside a plain install — is refused, and ~/ccrc keeps the version it names (W6 Task 5)', () => {
    const home = freshBox('ccrc-install-w6-vanished-');
    installVersionedTree(home, 'v9.9.0', { stamp: { sha: '9'.repeat(40), version: 'v9.9.0' } });
    shipStamp(treeRoot(home), 'b'.repeat(40), 'v9.9.1');
    // This run's last npm ci (the default role runs none in the agent)
    // succeeds and then stands in for the concurrent prune: the directory
    // it ran in is gone before the flip.
    const r = runInstall(home, ['install'], {}, {
      stubs: {
        npm: '#!/bin/sh\nmkdir -p node_modules\n'
          + 'case "$PWD" in */ccrc-versions/v9.9.1/server) rm -rf -- "${PWD%/server}" ;; esac\nexit 0\n',
      },
    });
    expect(r.code, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: the new tree at \$HOME\/ccrc-versions\/v9\.9\.1 is gone before the flip — a prune may have run beside this install; \$HOME\/ccrc was not touched, and the install can be run again$/m);
    expect(readlinkSync(join(home, 'ccrc')), '~/ccrc was flipped onto a tree that is gone').toBe(vroot(home, 'v9.9.0'));
    expect(existsSync(join(home, 'ccrc', 'ccd', 'ccrc'))).toBe(true);
    expect(r.stdout).not.toMatch(/one rename$/m);
  });
});
