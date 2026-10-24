// `ccrc install`, part 4 of the ccrc-install-*.test.ts family (D-6767): linger, accounts, hooks, skills, the landing
// block and the whole verb twice. Shared fixtures and the original file header live in ccrc-installFixture.ts.
// LOAD-TIME INSTALLS in this file: `converged` and `skillBox`.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, chmodSync, readdirSync, rmSync } from 'node:fs';
import path, { join } from 'node:path';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';
import { itLinux, itDarwin, IS_DARWIN } from './platformFixtures.js';
import { GPT_LANE_BINS } from './codexLaneFixture.js';
import { here, REPO, BASH, PYTHON3, treeRoot, ccrcIn, treeFile, placed, FIXTURE_BINS, freshBox, freshBoxNoUpstream, ccrcEnv, replantDoctorStubs, runInstall, read, mtime, preexisting, strays, FIVE_ACCOUNT_ROSTER, gitInit, unitDir, UNIT_FILES, systemctlCalls, loginctlCalls, type Result } from './ccrc-installFixture.js';

removeTmpFixturesEachTest();

describe('ccrc install: linger, the account dirs, the hooks and the wrappers', () => {
  const converged = ((): { home: string; r: Result } => {
    const home = freshBox('ccrc-install-converge-');
    return { home, r: runInstall(home) };
  })();

  it('the run this describe measures succeeded', () => {
    expect(converged.r.code, converged.r.stderr).toBe(0);
  });

  itLinux('asks logind for linger, by uid, and says so', () => {
    // Every ccd session is a `systemd --user` unit; without linger,
    // /run/user/$UID is torn down with the last login session and the whole
    // fleet goes with it. The remedy doctor prints uses the UID too, so the
    // call and the advice are one command.
    const { home, r } = converged;
    expect(loginctlCalls(home).some((c) => /^enable-linger \d+$/.test(c)),
      'nothing ever asked logind to enable linger').toBe(true);
    expect(r.stdout).toMatch(/^install: linger: enabled for uid \d+ — this box's units survive logout$/m);
  });

  itLinux('reports a linger it cannot enable and CONTINUES — doctor is what says so', () => {
    // THE ONE STEP THAT SURVIVES ITS OWN FAILURE. Enabling linger needs a
    // privilege the operator may not have (`sudo loginctl enable-linger` is the
    // remedy, and this process is not root). Dying here would abort an install
    // at its tenth step, on a box where everything before it converged, over a
    // thing one command fixes — so the step prints that command and returns 0,
    // and the four steps after it still run. The verdict comes from doctor,
    // which is the last word by design: FAIL linger, exit 1.
    const home = freshBox('ccrc-install-linger-refused-');
    writeFileSync(join(home, 'fixture-linger-refuse'), 'yes\n');
    const r = runInstall(home);
    expect(r.stdout).toMatch(/^install: linger: could not enable — run: sudo loginctl enable-linger \d+$/m);
    // …the steps AFTER it ran, which is the half that makes this a "continue"
    // rather than a die with a friendlier sentence.
    for (const step of ['dirs: ', 'hooks: ', 'skills: ', 'wrappers: ',
      'done — converged with 1 degraded step \\(linger\\)']) {
      expect(r.stdout, `the install stopped at linger: no "install: ${step}" line`)
        .toMatch(new RegExp(`^install: ${step}`, 'm'));
    }
    // …and the box is still reported honestly: doctor's own linger check FAILs,
    // with the same remedy, and its exit code is the verb's.
    expect(r.stdout).toMatch(/^FAIL linger: /m);
    expect(r.stdout).toMatch(/^ {2}remedy: run: sudo loginctl enable-linger \d+$/m);
    expect(r.code).toBe(1);
  });

  // macOS's half of the same step. There is nothing to ask and nothing that
  // could fail, so the assertions are about what the transcript SAYS: the
  // operator has to learn that this box loses a guarantee a Linux fleet host
  // keeps, and they must not learn it as a degraded step (see the launchd
  // describe above for why that distinction is load-bearing).
  itDarwin('says linger is not a macOS concept, asks logind nothing, and does not degrade', () => {
    expect(converged.r.code, converged.r.stderr).toBe(0);
    expect(converged.r.stdout).toMatch(/^install: linger: not a macOS concept/m);
    // Names the guarantee that is missing, in the operator's terms.
    expect(converged.r.stdout).toMatch(/stop at logout and start again at login/);
    // And points at the standing report rather than leaving it to this one run.
    expect(converged.r.stdout).toMatch(/ccrc doctor/);
    expect(existsSync(join(converged.home, 'loginctl-calls')),
      'logind was asked something on a box that has none').toBe(false);
    expect(converged.r.stdout).toMatch(/^install: done — every step above converged$/m);
  });

  it('creates every account config dir the roster names, so the hooks land in all of them', () => {
    // THE GAP THIS STEP CLOSES: `install-session-hooks.sh` iterates the roster's
    // config dirs and `continue`s past any that is not there — right for a
    // deploy onto a months-old fleet host, and exactly wrong on a fresh box,
    // where NONE of them exists. Without `_inst_dirs` the installer walks the
    // whole roster, skips every entry and exits 0, leaving a box whose sessions
    // report nothing. Measured with the five-account roster, because the
    // default one's single dir is created by `_inst_files` anyway and would
    // make this assertion pass with the step deleted.
    const home = freshBox('ccrc-install-dirs-');
    preexisting(home, 'accounts.json', FIVE_ACCOUNT_ROSTER);
    writeFileSync(join(home, '.local', 'bin', 'gpt'),
      '#!/usr/bin/env bash\nexec /usr/bin/env gpt "$@"\n', { mode: 0o755 });
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(
      /^install: dirs: config directory in place for 5 account\(s\) named by \$HOME\/\.ccrc\/accounts\.sh$/m);
    for (const d of ['.claude', '.claude-a', '.claude-b', '.claude-gpt', '.claude-d']) {
      expect(existsSync(join(home, d)), `${d} was never created`).toBe(true);
      // …and the hooks installer, run from the INSTALLED path right after,
      // found each one and converged its settings.json.
      const s = join(home, d, 'settings.json');
      expect(existsSync(s), `${d}/settings.json — the hooks installer skipped this dir`).toBe(true);
      const j = JSON.parse(read(s)) as {
        hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
        statusLine: { command: string };
      };
      expect(j.hooks['SessionStart']![0]!.hooks[0]!.command).toContain('/session-hook.sh');
      expect(j.statusLine.command).toContain('/statusline-command.sh');
    }
  });

  it('runs the wrapper converger with no flags, and the default roster writes none', () => {
    // `cmd_wrappers` is called as a FUNCTION (same file), so its own lines —
    // per-account verdicts, refusals with remedies, the summary — reach the
    // operator unaltered. The default roster holds one `upstream` account,
    // which this verb never writes under any flag, so the converged answer is
    // zero wrappers written: the run proves the roster and `$HOME/.local/bin`
    // agree, which is what doctor judges two steps later.
    const { home, r } = converged;
    expect(r.stdout).toMatch(
      /^summary: 1 account\(s\) in .*\/\.ccrc\/accounts\.json — 0 generated, 1 upstream, 0 external, 0 codex \(upstream and external are never written\); 0 written, /m);
    expect(r.stdout).toMatch(/^install: wrappers: converged /m);
    // Nothing but the five executables `_inst_bins` installs (graphify Task 10
    // adds `ccd-graph-sweep`) and R3's one SYMLINK — no wrapper, no temp file,
    // no staged leftover — beside what the fixture itself planted.
    //
    // `graphify` is here because `_inst_graphify_engine` now converges
    // `$HOME/.local/bin/graphify` onto the pinned venv (R3, D-1346): the one
    // path a session's bare `graphify` resolves to. It is on BOTH platform
    // arms, unlike the two above it — `_inst_bins` gates `ccd-cap-scopes` on
    // cgroups and `ccd-graph-sweep` on a systemd timer, while the converge is
    // gated only on the server role, which this fixture is not.
    expect(readdirSync(join(home, '.local', 'bin'))
      .filter((b) => !FIXTURE_BINS.includes(b)).sort())
      .toEqual(process.platform === 'darwin'
        // `ccd-account-auth` is on BOTH arms — unlike cap-scopes (cgroup-bound)
        // and the three timer-bound ones, macOS is a supported box for it. The
        // GPT lane's five join it for the same reason: none is timer-bound to
        // this arm — `ccrc-codex` (the launcher every Codex wrapper execs) and
        // `ccgpt-runtime` are commands, `ccgpt-proxy.py` is the shim a tier
        // runs, `ccgpt-auth.py` is the auth library the lane's other files will load,
        // `ccgpt-usage.py` is placed for hand-running. Gated `!= server`,
        // which this `both` install is not. `ccrc-codex` and `ccgpt-runtime`
        // joined in the commit that placed them, and no earlier than the
        // commits that wrote them (fix round 1, Finding 1). NEVER `ccgpt`
        // (D-3478).
        // wave 17 (D-5313): `ccrc-api`, the closed client the role skills call, is on BOTH arms for every role but server.
        ? ['ccd', 'ccd-account-auth', 'ccrc', 'ccrc-api', 'graphify', ...GPT_LANE_BINS].sort()
        // account-pool-membership wave 1, Task 4 fix round 1 (F1): `ccd-pool-sync`
        // joins the non-Darwin list on the timer-bound names' own terms. THIS
        // ASSERTION IS THE MUTATION SITE for that line in `_inst_bins`: it is
        // an exact set, so deleting the install reds here rather than leaving
        // `ccd-pool-sync.timer` enabled against a 203/EXEC. Programme wave 4:
        // `ccd-update-sync` joins on the same terms, and this set is the
        // mutation site for its line too (spec §18 "the puller is installed
        // where its timer looks").
        // history spec §9.5: `ccd-history-sweep` joins on the timer-bound names' terms, behind its role gate (this install is `both`).
        : ['ccd', 'ccd-account-auth', 'ccd-account-health', 'ccd-cap-scopes', 'ccd-graph-sweep', 'ccd-history-sweep',
           'ccd-pool-sync', 'ccd-scope-sweep', 'ccd-telemetry-keepalive', 'ccd-tmp-sweep', 'ccd-tool-adj', 'ccd-update-sync', 'ccd-usage-sweep',
           'ccd-usage-sweep.py', 'ccrc', 'ccrc-api', 'graphify', ...GPT_LANE_BINS].sort());
  });

  it('_inst_bins\' own closing line names every executable it placed', () => {
    // account-pool-membership wave 1, Task 4 fix round 2 (B6). That echo is a
    // SECOND, hand-kept census of the same set the assertion above measures,
    // and it shipped one wave behind it: `ccd-pool-sync` landed in
    // `_inst_bins` in fix round 1 and the sentence that tells the operator
    // what arrived never gained the name. Nothing could see it, because the
    // only pin on that line was `/^install: bins: /`.
    //
    // DERIVED FROM THE BIN DIRECTORY, so the next executable added is caught
    // by the same mechanism rather than by someone remembering this line —
    // `macos-platform.test.ts#shebangged`'s rule under D-1250. `graphify` is
    // excluded because `_inst_graphify_engine`'s symlink into the pinned venv
    // is not one of `_inst_bins`' copies.
    //
    // Plan 2b-1 Task 2: the blanket `!b.endsWith('.py')` this line used to
    // carry is gone. A `.py` file is exempt only when a non-`.py` SIBLING
    // execs it and that sibling's own name in the echo covers it — named
    // explicitly, not by suffix, so a `.py` with no such sibling is caught
    // rather than silently waved through. Fix round 1, Finding 4: the
    // reviewer mutated this list both ways — dropping `ccd-usage-sweep.py`
    // reds, dropping `ccgpt-proxy.py` stayed GREEN, because the echo names
    // `ccgpt-proxy.py` explicitly regardless (it is not a timer-only
    // artifact), so it bound nothing and is gone. One entry survives:
    const PY_SIDECARS_COVERED_BY_SIBLING = [
      'ccd-usage-sweep.py', // engine carried by ccd-usage-sweep's own name
    ];
    // `ccgpt-auth.py`, `ccgpt-usage.py` (and `ccgpt-proxy.py`, above) have NO such sibling —
    // each must be named explicitly in the echo below on its own, and so must
    // `ccgpt-runtime` and `ccrc-codex`, which are dotless and so never exempt.
    const { home, r } = converged;
    const line = r.stdout.split('\n').find((l) => l.startsWith('install: bins:'));
    expect(line, 'no `install: bins:` line in the transcript at all').toBeDefined();
    const placed = readdirSync(join(home, '.local', 'bin'))
      .filter((b) => !FIXTURE_BINS.includes(b) && b !== 'graphify'
        && !PY_SIDECARS_COVERED_BY_SIBLING.includes(b))
      .sort();
    // Fix round 1, Finding 5: the floor is the DARWIN-ARM minimum — `ccd`,
    // `ccd-account-auth`, `ccrc`, `ccrc-api` and the GPT lane's five, nine since
    // codex bridge Stage 1 Task 5 placed `ccgpt-auth.py` (seven since Plan 2b-2
    // placed `ccgpt-runtime` and `ccrc-codex`; wave 17's `ccrc-api` made it
    // eight and this floor was not raised then) — the smaller of the two
    // platforms, so it holds on both. Like `gen-wrappers.test.ts`'s
    // `TOOLCHAIN_EXECUTABLES` floor, this is a RATCHET: it only ever needs to
    // rise as names are added, never fall, and a fall here means the
    // derivation lost members rather than that fewer names shipped.
    expect(placed.length, 'the bin directory listed nothing — the derivation, not the echo, is broken')
      .toBeGreaterThanOrEqual(9);
    // C-I (fix wave B, item 14): `.toContain(b)` is SUBSTRING containment on
    // `line`, one whole string — `ccd` and `ccd-usage-sweep` are each a
    // PREFIX of another name this same census carries (`ccd-account-auth`,
    // `ccd-cap-scopes`, … and `ccd-usage-sweep.py` respectively), so deleting
    // either bare name from the real echo would leave this pin GREEN as long
    // as its longer sibling still printed. PLAIN `\b` does not close this —
    // a hyphen is a NON-word character, so `\bccd\b` still matches the `ccd`
    // inside `ccd-account-auth` (the boundary fires on the hyphen itself,
    // measured). The name must not be immediately flanked by a word
    // character OR a hyphen on either side.
    for (const b of placed) {
      const escaped = b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(line, `${b} is in $HOME/.local/bin and the install transcript never says it arrived`)
        .toMatch(new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`));
    }
  });

  it('never calls ccrc\'s own executables orphans (D-93)', () => {
    // MEASURED BEFORE THE FIX: every install printed
    //   ORPHAN ccd: …/.local/bin/ccd carries ccrc's marker and no account in
    //   the roster claims it
    //   remedy: add an account "ccd" … or remove …/.local/bin/ccd by hand
    // four lines above this same transcript's own closing advice, "next: add
    // your first session with: ccd menu". Self-destructive advice about the
    // binary the next line tells the operator to run, on the first verb a new
    // user types.
    //
    // The cause is not a mistake to be undone: `ccd/ccd:2` carries the
    // provenance marker DELIBERATELY (41bdf60, gated by ownership.test.ts), so
    // that ccrc's own shipped `ccd` reads `ccrc-unmodified` and the installer
    // may replace it. The orphan walk simply must not treat ccrc's own
    // toolchain as a candidate account wrapper — `TOOLCHAIN_EXECUTABLES` in
    // deploy/gen-wrappers.mjs.
    const { home, r } = converged;
    expect(existsSync(join(home, '.local', 'bin', 'ccd')),
      'the fixture never installed the ccd this is about').toBe(true);
    expect(r.stdout, 'ccrc told the operator to delete its own ccd')
      .not.toMatch(/^ORPHAN /m);
    // …and the count in the converger's own summary agrees, which is the field
    // the pre-existing assertion stopped one short of.
    expect(r.stdout).toMatch(/^summary: 1 account\(s\) in .*; 0 written, 0 converged, 0 refused, 0 orphaned$/m);
    // The general orphan REPORT is untouched — ccrc-wrappers.test.ts pins a
    // synthetic leftover still being reported, and this must not have widened
    // into "no orphans are ever named".
  });

  it('a refused wrapper is a failed install', () => {
    // `--force`/`--adopt` are the flags that decide what may be overwritten and
    // this step passes neither, so a file ccrc did not write is REFUSED — with
    // the converger's own remedy — and the install stops. The alternative is an
    // install that reports success over a box whose wrappers it could not
    // converge, which is the state `ccrc wrappers` exists to make impossible.
    const home = freshBox('ccrc-install-wrappers-refused-');
    preexisting(home, 'accounts.json', FIVE_ACCOUNT_ROSTER);
    writeFileSync(join(home, '.local', 'bin', 'gpt'),
      '#!/usr/bin/env bash\nexec /usr/bin/env gpt "$@"\n', { mode: 0o755 });
    // A file at a GENERATED account's path that ccrc did not write: neither
    // ccrc-unmodified nor equivalent, so no flag this step passes can rewrite
    // it.
    writeFileSync(join(home, '.local', 'bin', 'claude-b'),
      '#!/bin/sh\n# mine, and not ccrc\'s\nexec /usr/bin/env claude "$@"\n', { mode: 0o755 });
    const r = runInstall(home);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^ccrc: wrapper convergence refused — read the lines above$/m);
    // The converger's own account-level refusal is what "the lines above" means,
    // and it is still on stdout rather than re-worded into the die.
    expect(r.stdout).toMatch(/^REFUSE claude-b: /m);
    // …and it did not run doctor over a box it had just refused to finish.
    expect(r.stdout).not.toMatch(/^summary: \d+ checks/m);
  });
});

describe('ccrc install: all four skills reach every rostered account', () => {
  // ── THE ASYMMETRY THIS STEP CLOSES ──────────────────────────────────────
  // `deploy/deploy.sh agent <host>` has shipped the coordinator skill to the
  // fleet host since Build 7 and now ships the worker and reviewer skills
  // beside it — but a box that installs ITSELF got none of them, because no
  // step of this verb had ever heard of a skill. That is not a cosmetic gap:
  // all three installers exist because skills resolve per `CLAUDE_CONFIG_DIR`
  // and a session's ACCOUNT drifts on swap while its id does not, so a
  // coordinator (or a worker, or a reviewer) placed with no pinned account
  // must find its skill in EVERY rostered home. On a
  // self-installed box it found one in none of them, and the failure is silent:
  // the model simply does not have the protocol and improvises.
  //
  // Measured with the FIVE-account roster deliberately, exactly as `_inst_dirs`
  // is: the default roster's single `.claude` is created by `_inst_files`
  // anyway, so a one-dir fixture would go green against an installer that only
  // ever touched the first home.
  const skillBox = ((): { home: string; r: Result } => {
    const home = freshBox('ccrc-install-skills-');
    preexisting(home, 'accounts.json', FIVE_ACCOUNT_ROSTER);
    writeFileSync(join(home, '.local', 'bin', 'gpt'),
      '#!/usr/bin/env bash\nexec /usr/bin/env gpt "$@"\n', { mode: 0o755 });
    return { home, r: runInstall(home) };
  })();
  const ROSTER_DIRS = ['.claude', '.claude-a', '.claude-b', '.claude-gpt', '.claude-d'];

  it('the run this describe measures succeeded, and says what it did in one line', () => {
    expect(skillBox.r.code, skillBox.r.stderr).toBe(0);
    expect(skillBox.r.stdout).toMatch(/^install: skills: /m);
  });

  it('lands ALL FOUR skills in every account config dir the roster names', () => {
    const { home } = skillBox;
    for (const d of ROSTER_DIRS) {
      for (const [name, src] of [
        ['ccrc-coordinator', 'coordinator-skill'], ['ccrc-worker', 'worker-skill'],
        ['ccrc-reviewer', 'reviewer-skill'], ['ccrc-history', 'history-skill'],
      ] as const) {
        const md = join(home, d, 'skills', name, 'SKILL.md');
        expect(existsSync(md), `${d}: ${name} never reached this home`).toBe(true);
        expect(readFileSync(md), `${d}: ${name} is not the shipped skill`)
          .toEqual(readFileSync(placed(home, 'ccd', src, 'SKILL.md')));
      }
      // …and ccrc-history's MIT notice travelled with it (ccrc history spec §12): its installer refuses a source
      // without the sidecar, and `cp -a` is what carries it into each home.
      expect(readFileSync(join(home, d, 'skills', 'ccrc-history', 'LICENSE.lossless-claw')),
        `${d}: ccrc-history arrived without its LICENSE.lossless-claw`)
        .toEqual(readFileSync(placed(home, 'ccd', 'history-skill', 'LICENSE.lossless-claw')));
      // …and the coordinator's tree arrived WHOLE, not as its first file. Its
      // own installer refuses a partial source by name, so this is the
      // assertion that says the refusal never had to fire — and the worker
      // skill points a live worker at exactly these paths, relative to its own
      // installed directory.
      const refs = join(home, d, 'skills', 'ccrc-coordinator', 'references');
      expect(readdirSync(refs).sort(), `${d}: the coordinator's references/ is incomplete`)
        .toEqual(readdirSync(join(REPO, 'ccd', 'coordinator-skill', 'references')).sort());
    }
  });

  it('stages each skill tree under ~/.cc-sessions, where the fleet deploy puts it', () => {
    // ONE PATH FOR BOTH LANES. `deploy.sh` rsyncs each tree to
    // `~/.cc-sessions/<name>` and runs the installer against that copy; this
    // verb places the same four directories at the same four paths from the
    // tree it just put at `~/ccrc`. A box therefore looks the same afterwards
    // whichever lane converged it — which is what makes the installers' own
    // `CCRC_SKILL_SRC` default correct on a self-installed box.
    const { home } = skillBox;
    for (const name of ['coordinator-skill', 'worker-skill', 'reviewer-skill', 'history-skill']) {
      const staged = join(home, '.cc-sessions', name);
      expect(existsSync(staged), `${name} was never staged in ~/.cc-sessions`).toBe(true);
      expect(readFileSync(join(staged, 'SKILL.md')))
        .toEqual(readFileSync(placed(home, 'ccd', name, 'SKILL.md')));
    }
    expect(readdirSync(join(home, '.cc-sessions', 'coordinator-skill', 'references')).sort())
      .toEqual(readdirSync(join(REPO, 'ccd', 'coordinator-skill', 'references')).sort());
  });

  it('runs each installer against the copy it staged, never out of the tree', () => {
    // `_inst_hooks`' doctrine, applied to the two installers that arrived with
    // it: the box's OWN copy is the one that runs, because that is the copy
    // every future run and every operator reaches, and running the tree's copy
    // instead leaves the installed one untested by the very run that placed it.
    //
    // MEASURED AS TEXT, and the reason is a property of this step rather than a
    // shortcut: `_inst_tree_copy` makes the staging copy FROM the placed tree
    // in the same step, so at the moment the installer runs the two sources are
    // byte-identical and no fixture can tell them apart by outcome. The same
    // situation `_inst_stamp`'s path pin and `_inst_env`'s are in, and the same
    // answer — scan the shell, in the function's own body.
    const src = read(join(REPO, 'ccd', 'ccrc'));
    const body = /_inst_skills\(\) \{([\s\S]*?)\n\}/.exec(src);
    expect(body, 'ccd/ccrc has no _inst_skills').toBeTruthy();
    const lines = body![1]!.split('\n').filter((l) => l.includes('CCRC_SKILL_SRC'));
    expect(lines.length, 'no line in _inst_skills sets CCRC_SKILL_SRC at all')
      .toBeGreaterThan(0);
    for (const l of lines) {
      expect(l, 'the installer must read the copy staged under $HOME/.cc-sessions')
        .toContain('CCRC_SKILL_SRC="$HOME/.cc-sessions/');
      expect(l, 'CCRC_SKILL_SRC points back into the placed tree').not.toContain('BOX_TREE_DIR');
      expect(l, 'CCRC_SKILL_SRC points back into the placed tree').not.toContain('$tree');
    }
    // …and the SCRIPT that runs is the staged one too, by the same rule: every
    // `bash` this step invokes reaches into `$HOME/.cc-sessions`, never into
    // the tree it placed.
    const runs = body![1]!.split('\n').filter((l) => /\bbash\b/.test(l));
    expect(runs.length, '_inst_skills runs no installer at all').toBeGreaterThan(0);
    for (const l of runs) {
      expect(l, 'the installer that RUNS must be the box’s own copy')
        .toContain('bash "$HOME/.cc-sessions/install-');
    }
  });

  it('a second run rewrites neither skill — the installers converge, and so does the staging', () => {
    // Idempotence measured on the INODE, which is what the installers' own
    // `diff -r -q` check promises: a rewrite replaces the file rather than
    // leaving it. `_inst_tree_copy` owes the same on the staging side, and for
    // the same reason `_inst_atomic` does — a converger that rewrites what it
    // did not change is one an operator cannot use to see what a run did.
    const home = freshBox('ccrc-install-skills-idem-');
    expect(runInstall(home).code).toBe(0);
    const watched = [
      join(home, '.claude', 'skills', 'ccrc-coordinator', 'SKILL.md'),
      join(home, '.claude', 'skills', 'ccrc-coordinator', 'references', 'wave-lifecycle.md'),
      join(home, '.claude', 'skills', 'ccrc-worker', 'SKILL.md'),
      join(home, '.claude', 'skills', 'ccrc-reviewer', 'SKILL.md'),
      join(home, '.claude', 'skills', 'ccrc-history', 'SKILL.md'),
      join(home, '.claude', 'skills', 'ccrc-history', 'LICENSE.lossless-claw'),
      join(home, '.cc-sessions', 'coordinator-skill', 'SKILL.md'),
      join(home, '.cc-sessions', 'worker-skill', 'SKILL.md'),
      join(home, '.cc-sessions', 'reviewer-skill', 'SKILL.md'),
      join(home, '.cc-sessions', 'history-skill', 'SKILL.md'),
    ];
    const before = watched.map((p) => [statSync(p).ino, mtime(p)]);
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(watched.map((p) => [statSync(p).ino, mtime(p)])).toEqual(before);
    // No backup directory either: the installers back a home up only when they
    // are about to REPLACE it, so a second run that made one is a second run
    // that rewrote a converged home.
    expect(existsSync(join(home, 'ccrc-backups')), 'a converged re-run took a backup').toBe(false);
    expect(strays(home)).toEqual([]);
  });

  it('an installer that refuses is a FAILED install, named, and doctor never runs', () => {
    // The step contract, and `_inst_hooks`' reasoning applied to skills: a box
    // whose sessions have no protocol is not a finished install, and the one
    // thing worse than failing here is reporting success over it. The die names
    // the installer, so "read its lines above" points at the refusal that
    // actually happened rather than re-wording it.
    const home = freshBox('ccrc-install-skills-refused-');
    const blocked = join(home, '.claude', 'skills');
    mkdirSync(blocked, { recursive: true });
    chmodSync(blocked, 0o500);
    try {
      const r = runInstall(home);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/^ccrc: install-coordinator-skill\.sh refused/m);
      // The installer's OWN sentence is what "the lines above" means, and it is
      // still there in its own words.
      expect(r.stderr).toMatch(/install-coordinator-skill: could not stage into /);
      // …and the run STOPPED: the steps after it never ran, and doctor — the
      // verb's last word — never got to report on a box this install did not
      // finish.
      expect(r.stdout).toMatch(/^install: hooks: /m);
      expect(r.stdout).not.toMatch(/^install: skills: /m);
      expect(r.stdout).not.toMatch(/^install: wrappers: /m);
      expect(r.stdout).not.toMatch(/^summary: \d+ checks/m);
    } finally {
      chmodSync(blocked, 0o700);
    }
  });
});

describe('ccrc install: the landing block, and doctor as the last word', () => {
  it("the doctor tail's tmux_skew verdict comes from the FIXTURE's tmux, never the host's (branch review)", () => {
    // Hermeticity pin: before the fixture grew its own tmux stub, the skew
    // check dialed whatever server holds this UID's real socket — the verdict
    // depended on the HOST (red on a legitimately-skewed box, a 15s stall per
    // full-verb test under a wedged one). The stub's versions are 9.9/9.9 —
    // numbers no packaged tmux prints — so this line proving 9.9 is what
    // proves the host was never asked.
    const home = freshBox('ccrc-install-doctor-hermetic-');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^PASS tmux_skew: client 9\.9, running server 9\.9 — versions agree$/m);
  });

  it('ends with doctor, and a fresh box ends green: 0 warned (D-139), 0 failed, exit 0', () => {
    const home = freshBox('ccrc-install-doctor-ok-');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    // The CLEAN variant of the closing line — the degraded one is asserted on
    // its own fixture in the doctor-fails test below.
    expect(r.stdout).toMatch(/^install: done — every step above converged$/m);
    expect(r.stdout).not.toMatch(/degraded/);
    // Doctor's summary is the LAST line, because doctor is the last command:
    // the verb's exit code is its verdict.
    const lines = r.stdout.split('\n').filter(Boolean);
    expect(lines[lines.length - 1]).toMatch(/^summary: \d+ checks \(\d+ skipped\), /);
    // A FRESH INSTALL ENDS GREEN — operator ruling, Task 9 review (D-139).
    // `auth` joined the table in stage 3a and first shipped WARNing about the
    // box this verb deliberately leaves without a passphrase, which turned
    // every clean install yellow and taught operators to skim the colour that
    // is supposed to mean something. It PASSes now, carrying the arming
    // instructions as next-steps text, and this line is back to `0 warned`.
    // A macOS box closes green with EXACTLY ONE warn, and it is not a fault
    // this verb could have avoided: `linger` has no counterpart on a platform
    // where a LaunchAgent lives and dies with the login session. `0 failed` is
    // the part that means "this install worked", and it holds on both.
    // The box-token arming (row 2a, 4553) keeps that: a fresh BOTH-role install has neither the server's token and state
    // files nor a fleet token file, and `box-token` reads PASS with its sentence (operator, D-139 over Decision 2 (a),
    // 2026-10-12): no value has been minted here yet and the server mints one at boot, or its log says why that mint
    // failed (a failed first mint leaves the same disk as a fresh box, so the sentence names it, review 391 F3). Only a
    // box that once held a value and lost it is a FAIL. So the count is `0 warned` again (the one `linger` warn on macOS), and `0 failed`.
    const warned = process.platform === 'darwin' ? 1 : 0;
    expect(r.stdout).toMatch(new RegExp(
      `^summary: \\d+ checks \\(\\d+ skipped\\), \\d+ verdicts — \\d+ passed, ${warned} warned, 0 failed$`, 'm'));
    expect(r.stdout, 'box-token reads PASS on a fresh box, naming the fact').toMatch(
      /^PASS box-token: server: token-absent — .* no value has been minted here yet, and the server mints one at boot, or its log says why that mint failed; fleet: fleet-token-absent — .* no value has been handed to this box yet, and the server's next rotation hands one$/m);
    expect(r.stdout.split('\n').filter((l) => /^WARN /.test(l)).filter((l) => !l.startsWith('WARN linger: '))).toEqual([]);
    // …and the gate check really RAN and really found the box uncredentialed:
    // `0 warned` must not be reachable by the check having vanished.
    expect(r.stdout).toMatch(/^PASS auth: no passphrase file at .*nothing is gated/m);
    // …and `history` (spec 2026-10-05 §9.6) is among the checks that PASSed, on its grace word: the shim landed
    // seconds ago and no sweep has ticked. A WARN there would turn every fresh install yellow again
    // (D-4168). macOS places no shim, so the check SKIPs there.
    if (process.platform === 'darwin') expect(r.stdout).toMatch(/^SKIP history: /m);
    else expect(r.stdout).toMatch(/^PASS history: first-tick-pending: /m);
  });

  it('writes ~/.ccrc/installed LAST, naming the stamped sha — and a spine that dies before its end leaves none', () => {
    // The completed-install record (spec §5). It cannot ride in build.json:
    // `_inst_stamp` sits mid-spine because the server restarted by
    // `_inst_enable` reads the stamp at boot, so a stamp-only signal would
    // read "installed" on a box whose skills never landed.
    const home = freshBox('ccrc-install-installed-');
    const sha = gitInit(treeRoot(home));
    const ok = runInstall(home);
    expect(ok.code, ok.stderr).toBe(0);
    expect(readFileSync(join(home, '.ccrc', 'installed'), 'utf8')).toBe(`${sha}\nunsigned\n`);
    // Line 2 (design §5, D-3117): `unsigned` unless the
    // updater asserted it verified the bundle — a plain `ccrc install` from
    // a checkout verified nothing. Fix round 1 item 20 / review 155 C35:
    // CCRC_UPDATE_VERIFIED is honoured ONLY from `cmd_update`'s own staged
    // spine (its `CCRC_UPDATE_SPINE=$$` marker, checked by $PPID) — this
    // verb is invoked directly, with no such marker, so a hand-exported
    // CCRC_UPDATE_VERIFIED=1 must be stripped exactly like install.sh
    // already strips it, and the record still reads unsigned.
    const verified = freshBox('ccrc-install-installed-verified-');
    const vsha = gitInit(treeRoot(verified));
    expect(runInstall(verified, ['install'], { CCRC_UPDATE_VERIFIED: '1' }).code).toBe(0);
    expect(readFileSync(join(verified, '.ccrc', 'installed'), 'utf8')).toBe(`${vsha}\nunsigned\n`);

    expect(ok.stdout).toMatch(/^install: installed: [0-9a-f]{40} \(the spine completed/m);
    // Ordering: the line is printed AFTER the wrappers step's own line.
    const lines = ok.stdout.split('\n');
    expect(lines.findIndex((l) => l.startsWith('install: installed:')))
      .toBeGreaterThan(lines.findIndex((l) => l.startsWith('install: wrappers:')));

    // A fault INSIDE the spine, after the stamp: the reviewer skill's
    // installer refuses when its SKILL.md is missing, which kills
    // `_inst_skills` — the exact shape of the 2026-09-17 incident.
    const broken = freshBox('ccrc-install-installed-fault-');
    gitInit(treeRoot(broken));
    rmSync(treeFile(broken, 'ccd/reviewer-skill/SKILL.md'));
    const r = runInstall(broken);
    expect(r.code).toBe(1);
    expect(existsSync(join(broken, '.ccrc', 'build.json')), 'the stamp is written mid-spine, as designed').toBe(true);
    expect(existsSync(join(broken, '.ccrc', 'installed')), 'a spine that died must leave NO completed-install record').toBe(false);
    // AN EXPLICIT BOUND (final review F4): three whole install spines, legitimately. Measured alone
    // (one file, `-t`): 6.8 s at load average 12 (2026-09-28), 7.6 s at load 30 (the final review) —
    // a third of the 20 s default before any load spike, which is the bound that was wrong.
  }, 60_000);

  // Review fix round 1 I1: EVERY released `cmd_update` before this wave ran
  // its staged spine as `env CCRC_UPDATE_VERIFIED=1 bash "$UPD_TREE/ccd/ccrc"
  // install`, with no `CCRC_UPDATE_SPINE` at all — so the first update onto
  // this wave's build would record a genuinely verified install as
  // unsigned, fleet-wide. `_inst_legacy_verified_parent` is the transition
  // arm: it honours CCRC_UPDATE_VERIFIED=1 when this process's OWN PARENT
  // (measured, `ps -o args=`) is itself a `ccrc … update` invocation.
  // Emulated here as a FORK (not an exec), so the install process's own
  // $PPID resolves, via `ps`, to the fixture's argv — exactly the shape a
  // real legacy `cmd_update` leaves behind. The fixture is named `ccrc`
  // itself (in its own directory), so the process `ps -o args=` reports for
  // it names a word ending in `ccrc` — the shape
  // `_inst_legacy_verified_parent` matches.
  it('CCRC_UPDATE_VERIFIED is honoured when the PARENT process is a legacy `ccrc … update` (review fix round 1 I1)', () => {
    const legacy = freshBox('ccrc-install-installed-legacy-parent-');
    const legacySha = gitInit(treeRoot(legacy));
    const legacyDir = join(legacy, 'legacy-ccrc-fixture');
    mkdirSync(legacyDir, { recursive: true });
    const legacyCcrc = join(legacyDir, 'ccrc');
    writeFileSync(legacyCcrc,
      '#!/bin/sh\n'
      + `env CCRC_UPDATE_VERIFIED=1 bash '${ccrcIn(treeRoot(legacy))}' install\n`
      + 'exit $?\n', { mode: 0o755 });
    expect(runInstall(legacy, ['update'], {}, { from: legacyCcrc }).code).toBe(0);
    expect(readFileSync(join(legacy, '.ccrc', 'installed'), 'utf8')).toBe(`${legacySha}\n`);
  });

  // Pin (2): the SAME fixture, but the parent's own verb is NOT `update` —
  // the transition arm must not fire, and the record stays unsigned.
  it('CCRC_UPDATE_VERIFIED stays stripped when the parent\'s verb is NOT `update` (review fix round 1 I1)', () => {
    const legacyOther = freshBox('ccrc-install-installed-legacy-other-verb-');
    const legacyOtherSha = gitInit(treeRoot(legacyOther));
    const legacyOtherDir = join(legacyOther, 'legacy-ccrc-fixture');
    mkdirSync(legacyOtherDir, { recursive: true });
    const legacyOtherCcrc = join(legacyOtherDir, 'ccrc');
    writeFileSync(legacyOtherCcrc,
      '#!/bin/sh\n'
      + `env CCRC_UPDATE_VERIFIED=1 bash '${ccrcIn(treeRoot(legacyOther))}' install\n`
      + 'exit $?\n', { mode: 0o755 });
    expect(runInstall(legacyOther, ['rollback'], {}, { from: legacyOtherCcrc }).code).toBe(0);
    expect(readFileSync(join(legacyOther, '.ccrc', 'installed'), 'utf8')).toBe(`${legacyOtherSha}\nunsigned\n`);
  });

  // Pin (3), fix round 1 item 0 / batch A rereview N1: the tightened regex is
  // ANCHORED at the start of the parent's own argv, not a substring search —
  // a `bash -c '…'` command STRING whose TEXT happens to contain the words
  // `ccrc update` (a compound `ssh box 'ccrc update --to vX --force || ccrc
  // install'`, or a Bash-tool shell whose command text mentions both) must
  // NOT match: argv[1] there is the literal `-c`, never a path ending in
  // `ccrc`. Built by hand (not `runInstall`'s `from`, which always shapes the
  // parent as `bash <script-path> <args>`): the parent here IS the `bash -c`
  // invocation itself — the `install` child is forked (not exec'd) from
  // inside that `-c` string, so its own $PPID resolves, via `ps`, to this
  // exact `bash -c '…'` argv.
  it('CCRC_UPDATE_VERIFIED stays stripped when the parent is a `bash -c` STRING that only MENTIONS `ccrc update` (fix round 1 item 0 / batch A rereview N1)', () => {
    const home = freshBox('ccrc-install-installed-bashc-mention-');
    const sha = gitInit(treeRoot(home));
    const ccrc = ccrcIn(treeRoot(home));
    const env = ccrcEnv(home);
    replantDoctorStubs(home);
    // The trailing `exit $?` (the fixture legacy-parent tests' own idiom,
    // above) is LOAD-BEARING: without a statement after the install
    // command, bash's own tail-call exec optimisation would REPLACE this
    // `bash -c` process's image with the install process directly, so the
    // install's own $PPID would resolve to whatever spawned THIS test's
    // `bash -c` (the test runner), never to a `bash -c '...'` argv at all —
    // the mutation this pin exists to catch would then be invisible to it.
    const cmd = 'bash probe.sh; true # ccrc update --to v1\n'
      + `env CCRC_UPDATE_VERIFIED=1 bash '${ccrc}' install\n`
      + 'exit $?\n';
    const r = spawnSync(BASH, ['-c', cmd], { env, encoding: 'utf8' });
    expect(r.status, r.stderr ?? '').toBe(0);
    expect(readFileSync(join(home, '.ccrc', 'installed'), 'utf8')).toBe(`${sha}\nunsigned\n`);
  });

  // Pin (4), fix round 1 item 0(a) / batch B rereview N1: the regex's
  // optional leading word is narrowed to a bash/sh interpreter (basename
  // only, an optional path before it), never ANY word — a
  // `python3 <path>/ccrc update` parent is N1's own forging shape and must
  // NOT honour CCRC_UPDATE_VERIFIED. Spawned via `PYTHON3` directly (never
  // the fixture's own stub, which answers only `-m venv <path>` and exits 90
  // on anything else), against a FILE NAMED `ccrc` so its own path ends in
  // `ccrc` — the same shape the legacy-parent fixtures above use. The
  // python script does `subprocess.run` (never `os.exec*`), for the same
  // reason the `bash -c` pin's trailing `exit $?` is load-bearing: python3
  // must stay the running parent throughout, so the install child's own
  // $PPID resolves, via `ps`, to this exact `python3 <path>/ccrc update`
  // argv.
  it('CCRC_UPDATE_VERIFIED stays stripped when the parent is `python3 <path>/ccrc update`, not a bash/sh interpreter (fix round 1 item 0 / batch B rereview N1)', () => {
    const home = freshBox('ccrc-install-installed-python-parent-');
    const sha = gitInit(treeRoot(home));
    const ccrc = ccrcIn(treeRoot(home));
    const pyDir = join(home, 'legacy-ccrc-fixture-py');
    mkdirSync(pyDir, { recursive: true });
    const pyCcrc = join(pyDir, 'ccrc');
    writeFileSync(pyCcrc,
      'import os, subprocess, sys\n'
      + 'env = dict(os.environ)\n'
      + "env['CCRC_UPDATE_VERIFIED'] = '1'\n"
      + `r = subprocess.run(['${BASH}', ${JSON.stringify(ccrc)}, 'install'], env=env)\n`
      + 'sys.exit(r.returncode)\n');
    const env = ccrcEnv(home);
    replantDoctorStubs(home);
    const r = spawnSync(PYTHON3, [pyCcrc, 'update'], { env, encoding: 'utf8' });
    expect(r.status, r.stderr ?? '').toBe(0);
    expect(readFileSync(join(home, '.ccrc', 'installed'), 'utf8')).toBe(`${sha}\nunsigned\n`);
  });

  it('says, in one line, that it wrote no passphrase and what arming the gate takes', () => {
    // Three variables in one sentence, because `CCRC_AUTH=on` alone produces a
    // console that can read and cannot act: the same unvalidated `CCRC_ORIGIN`
    // gates every /ws/* upgrade and every non-exempt write, and the server
    // cannot warn about a wrong one at boot (behind `tailscale serve` it never
    // learns the hostname it is reached under). An operator working from this
    // transcript is the one who needs to be told all three at once.
    const home = freshBox('ccrc-install-gate-line-');
    const r = runInstall(home);
    const line = r.stdout.split('\n').find((l) => l.startsWith('install: gate: ')) ?? '';
    expect(line, r.stdout).toContain('NO PWA passphrase');
    expect(line).toContain('ccrc passwd');
    expect(line).toContain('CCRC_AUTH=on');
    expect(line).toContain('CCRC_RP_ID');
    expect(line).toContain('CCRC_ORIGIN');
    // …and the install really did not write one. A passphrase this run invented
    // would be a credential nobody chose, and one it PROMPTED for cannot be
    // read at all under `curl … | bash`, where stdin is the script itself.
    expect(existsSync(join(home, '.ccrc', 'auth.scrypt'))).toBe(false);
  });

  // ── wave 8 item G, D-3598: the gate line follows the FILE too ────────────
  // A fresh install cannot say "no passphrase" honestly on a box that already
  // has one — a re-run over an already-passworded, already-exposed box lands
  // here too. The file is resolved through `_box_auth_path`, the flag through
  // `_box_unit_env`. With a passphrase file, an exposure file that cannot be
  // read prints "not measured"; otherwise a measured CCRC_AUTH=on, from
  // either file with the later one winning, names the file that decides, and
  // so does the OFF remedy — it names ccrc.env by default, or the exposure
  // file when that is the one that would arm it. With no passphrase file, a
  // measured CCRC_AUTH=on names the file that decides too. Wave 9 R10b
  // (D-3829) corrects the rest of this block: there, an exposure file that
  // cannot be read prints its own "not measured" line (G2g), and an exposure
  // file that decides the flag without turning it on gets an arming remedy
  // naming that file (G2h); every other case (the flag read from ccrc.env, or
  // no file at all) prints main's else-arm line, naming ccrc.env.
  const gateLine = (out: string): string => out.split('\n').find((l) => l.startsWith('install: gate: ')) ?? '';

  it('G2b: a passphrase file at the default path with the flag OFF — "a PWA passphrase file is at", and the OFF remedy names ccrc.env', () => {
    const home = freshBox('ccrc-install-gate-file-off-');
    preexisting(home, 'auth.scrypt', 'fixture-not-a-real-secret\n');
    const r = runInstall(home);
    const line = gateLine(r.stdout);
    expect(line, r.stdout).toContain('a PWA passphrase file is at');
    expect(line).toContain(join(home, '.ccrc', 'auth.scrypt'));
    expect(line).toContain('the gate is OFF');
    expect(line).toContain(join(home, '.ccrc', 'ccrc.env'));
    expect(line).not.toContain('NO PWA passphrase');
  });

  it('G2c: an absolute CCRC_AUTH_SECRET_PATH, with the file present there and absent at the default — the present arm, naming the redirected path', () => {
    const home = freshBox('ccrc-install-gate-redirect-');
    const elsewhere = join(home, 'secrets', 'gate.scrypt');
    mkdirSync(join(home, 'secrets'), { recursive: true });
    writeFileSync(elsewhere, 'fixture-not-a-real-secret\n');
    preexisting(home, 'ccrc.env', `CCRC_AUTH_SECRET_PATH=${elsewhere}\n`);
    const r = runInstall(home);
    const line = gateLine(r.stdout);
    expect(line, r.stdout).toContain('a PWA passphrase file is at');
    expect(line).toContain(elsewhere);
    expect(line).not.toContain(join(home, '.ccrc', 'auth.scrypt'));
  });

  it('G2d: a RELATIVE CCRC_AUTH_SECRET_PATH — install cannot say whether this box has a passphrase', () => {
    const home = freshBox('ccrc-install-gate-relative-');
    preexisting(home, 'ccrc.env', 'CCRC_AUTH_SECRET_PATH=secrets/gate.scrypt\n');
    const r = runInstall(home);
    const line = gateLine(r.stdout);
    expect(line, r.stdout).toMatch(/RELATIVE \(secrets\/gate\.scrypt\)/);
    expect(line).toContain('make it absolute');
    expect(line).toContain("ccrc doctor's auth check");
  });

  it('G2e: a passphrase present and the exposure file CCRC_AUTH=on — names the file that decided it, and never says "armed"', () => {
    const home = freshBox('ccrc-install-gate-exp-on-');
    preexisting(home, 'auth.scrypt', 'fixture-not-a-real-secret\n');
    preexisting(home, 'exposure.env', 'CCRC_ORIGIN=https://box.example.com\nCCRC_RP_ID=box.example.com\nCCRC_AUTH=on\n');
    const r = runInstall(home);
    const line = gateLine(r.stdout);
    // Anchored at the START — the OFF branch's own remedy text ALSO contains
    // the substring "CCRC_AUTH=on in <exposure file>" (its arming words), so
    // an unanchored `.toContain` cannot tell the ARMED line from the OFF
    // line's own next-steps text.
    expect(line, r.stdout).toMatch(
      new RegExp(`^install: gate: CCRC_AUTH=on in ${join(home, '.ccrc', 'exposure.env').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, and a PWA passphrase file is at `));
    expect(line).not.toContain('the gate is OFF');
    expect(line).not.toContain('armed');
  });

  it('G2f: no passphrase file and the exposure file CCRC_AUTH=on — failing SHUT, no "To arm the gate"', () => {
    const home = freshBox('ccrc-install-gate-exp-shut-');
    preexisting(home, 'exposure.env', 'CCRC_ORIGIN=https://box.example.com\nCCRC_RP_ID=box.example.com\nCCRC_AUTH=on\n');
    const r = runInstall(home);
    const line = gateLine(r.stdout);
    expect(line, r.stdout).toContain('the gate is failing SHUT');
    expect(line).toContain(`CCRC_AUTH=on in ${join(home, '.ccrc', 'exposure.env')}`);
    expect(line).not.toContain('To arm the gate');
  });

  // ── wave 9 R10b (D-3829): the no-passphrase arm's two own lines ──────────
  // D-3598 kept the no-passphrase line byte-identical in every case but a measured `on`. Two cases now print their
  // own: the exposure file there and unreadable (rc 2) — "not measured", as the present-passphrase arm says — and
  // the exposure file deciding the flag (`BUE_SRC` is the exposure file), whose arming remedy names that file, as
  // that arm's `gate_how` already does. The fresh-box line (the pin above) is byte-identical in every other case.
  it.skipIf(IS_DARWIN || process.getuid?.() === 0)('G2g: no passphrase and an UNREADABLE exposure file — "not measured", naming the file, never the fresh-box arming line (wave 9 R10b)', () => {
    const home = freshBox('ccrc-install-gate-nopass-exp-unreadable-');
    const exposure = join(home, '.ccrc', 'exposure.env');
    preexisting(home, 'exposure.env', 'CCRC_ORIGIN=https://box.example.com\nCCRC_RP_ID=box.example.com\nCCRC_AUTH=on\n');
    chmodSync(exposure, 0o000);
    const r = runInstall(home);
    const line = gateLine(r.stdout);
    expect(line, r.stdout).toBe(
      `install: gate: this box has NO PWA passphrase, and ${exposure} is there and cannot be read, so whether CCRC_AUTH is on (and the gate failing shut) was not measured — ccrc doctor's auth check says what to do`);
    expect(line).not.toContain('To arm the gate');
  });

  it('G2h: no passphrase and the exposure file CCRC_AUTH=off — the arming remedy names the exposure file, which overrides ccrc.env, not ccrc.env alone (wave 9 R10b)', () => {
    const home = freshBox('ccrc-install-gate-nopass-exp-off-');
    const exposure = join(home, '.ccrc', 'exposure.env');
    preexisting(home, 'exposure.env', 'CCRC_ORIGIN=https://box.example.com\nCCRC_RP_ID=box.example.com\nCCRC_AUTH=off\n');
    const r = runInstall(home);
    const line = gateLine(r.stdout);
    expect(line, r.stdout).toMatch(new RegExp(
      `^install: gate: this box has NO PWA passphrase — install never writes one\\. To arm the gate: ccrc passwd, then set CCRC_AUTH=on in ${
        exposure.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, which overrides ${
        join(home, '.ccrc', 'ccrc.env').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(ccrc expose writes it with CCRC_RP_ID and CCRC_ORIGIN\\), then: .+$`));
    expect(line).not.toContain('together with CCRC_RP_ID and CCRC_ORIGIN in');
    expect(line).not.toContain('not measured');
  });

  // ── wave 9 R10e (D-3823): a SECOND unmeasured state, rc 3 ─────────────────
  // A readable env file names the flag in a shape the reader cannot decide (on macOS: either file is not plain
  // assignments). The line says so from `_box_unit_env`'s own `BUE_WHY`, in both arms; it never borrows the rc-2
  // sentence ("is there and cannot be read"), which is about an exposure file the reader cannot open.
  /** The platform's own clause of a not-measured verdict about `file` (ccrc-doctorFixture.ts's `expectUndecided`). */
  const expectUndecided = (detail: string, file: string): void => {
    expect(detail).toContain(file);
    expect(detail).toContain('was not measured');
    expect(detail).not.toContain('cannot be read');
    if (IS_DARWIN) expect(detail).toContain(`${file} line `);
    else expect(detail).toContain('in a shape this reader does not decide');
  };

  it('I1: a passphrase present and the exposure file `CCRC_AUTH = on` — "not measured", worded from the reader\'s own cause, never as an unreadable file', () => {
    const home = freshBox('ccrc-install-gate-exp-spaced-');
    preexisting(home, 'auth.scrypt', 'fixture-not-a-real-secret\n');
    const exposure = join(home, '.ccrc', 'exposure.env');
    preexisting(home, 'exposure.env', 'CCRC_ORIGIN=https://box.example.com\nCCRC_RP_ID=box.example.com\nCCRC_AUTH = on\n');
    const r = runInstall(home);
    const line = gateLine(r.stdout);
    expect(line, r.stdout).toMatch(new RegExp(
      `^install: gate: a PWA passphrase file is at .*auth\\.scrypt, and ${exposure.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    expect(line).toContain('so whether CCRC_AUTH is on was not measured');
    expectUndecided(line, exposure);
  });

  it('I2: no passphrase and ccrc.env `CCRC_AUTH = on` — the rc-3 line naming ccrc.env, not the fresh-box line', () => {
    const home = freshBox('ccrc-install-gate-env-spaced-');
    preexisting(home, 'ccrc.env', 'CCRC_FLEET=local\nCCRC_AUTH = on\n');
    const envFile = join(home, '.ccrc', 'ccrc.env');
    const r = runInstall(home);
    const line = gateLine(r.stdout);
    expect(line, r.stdout).toMatch(new RegExp(
      `^install: gate: this box has NO PWA passphrase, and ${envFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    expect(line).toContain('so whether CCRC_AUTH is on was not measured');
    expectUndecided(line, envFile);
    expect(line).not.toContain('install never writes one');
  });

  it('reads the PWA address back out of the env file it installed', () => {
    // ONE SOURCE OF TRUTH, and the case that makes it matter: an operator whose
    // `ccrc.env` says something other than the default. That file is
    // user-owned, so a re-run keeps it — and a landing block that printed
    // `127.0.0.1:7788` regardless would be telling that operator to open an
    // address their box does not listen on.
    const home = freshBox('ccrc-install-addr-');
    // `localhost`, not a routable name: both differ from the default this
    // line would print if it ignored the file, and only a LOOPBACK one keeps
    // doctor's `update-exposure` check (W4, design 2026-09-20 §12) from
    // FAILing a box whose gate this run deliberately left off.
    preexisting(home, 'ccrc.env', 'CCRC_FLEET=local\nCCRC_HOST=localhost\nCCRC_PORT=8123\n');
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(
      /^install: PWA: http:\/\/localhost:8123\/ \(CCRC_HOST\/CCRC_PORT in .*\/\.ccrc\/ccrc\.env change this\)$/m);
    expect(r.stdout).toMatch(/^install: next: add your first session with: ccd menu {3}\(and read .*\/\.ccrc\/ccrc\.env\)$/m);
  });

  it('falls back to the documented default when the env file names neither key', () => {
    // The fallback is not a guess either: `server/src/config.ts` boots on the
    // same two values when the file is silent, so this line describes the box
    // rather than merely being polite about it.
    const home = freshBox('ccrc-install-addr-default-');
    preexisting(home, 'ccrc.env', '# an operator who deleted everything but the comment\n');
    const r = runInstall(home);
    expect(r.stdout).toMatch(/^install: PWA: http:\/\/127\.0\.0\.1:7788\//m);
  });

  it('a box doctor fails on exits 1, with every install step still printed', () => {
    // The two halves are one contract: the exit code is doctor's verdict, and
    // the transcript above it is the install's. Losing either — a 0 beside a
    // FAIL, or a 1 with no record of what converged — leaves an operator with a
    // number and no way to tell which half of the run it is about.
    const home = freshBox('ccrc-install-doctor-fails-');
    // THE LEVER IS PLATFORM-SPECIFIC, THE CONTRACT IS NOT. Linger is how a
    // Linux box is made to fail doctor; on macOS linger is a standing WARN by
    // construction and can never be a FAIL. The first cut's Darwin lever was
    // a downed service (`fixture-unit-…` = inactive) — which stopped being a
    // doctor-only lever the day `_inst_enable_darwin` gained its stay-up
    // gate: ONE launchctl stub serves the install spine and the doctor tail
    // alike, so a job that reads down fails the INSTALL at step 10 and
    // doctor never runs (measured on the macos leg, twice — the second time
    // because the fix script asserted this block existed and forgot to
    // replace it). The lever is now a world-readable exposure.env: doctor's
    // exposure check FAILs on the mode, and no install step ever reads it.
    const failing = process.platform === 'darwin' ? 'exposure' : 'linger';
    if (failing === 'exposure') {
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      writeFileSync(join(home, '.ccrc', 'exposure.env'),
        'CCRC_ORIGIN=https://box.example.com\nCCRC_RP_ID=box.example.com\nCCRC_AUTH=on\n',
        { mode: 0o644 });
    } else {
      writeFileSync(join(home, 'fixture-linger-refuse'), 'yes\n');
    }
    const r = runInstall(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(new RegExp(`^FAIL ${failing}: `, 'm'));
    for (const step of ['roster', 'accounts\\.sh', 'ccrc\\.env', 'tree', 'bins', 'files',
      'stamp', 'units', 'services', 'linger', 'dirs', 'hooks', 'skills', 'wrappers']) {
      expect(r.stdout, `no "install: ${step}:" line survived the failing doctor`)
        .toMatch(new RegExp(`^install: ${step}: `, 'm'));
    }
    // …and the closing line MEASURES rather than claims: this run had a step
    // that neither converged nor died, and says so. "every step above
    // converged" here would be a false sentence four lines under the step that
    // reported it could not (fix round 1, Minor 1).
    // The closing line MEASURES this run. On Linux the fixture's refused
    // linger is a degraded step and the line counts it; on macOS linger is not
    // a step that can degrade — there is nothing to enable — so a correct run
    // closes clean even though doctor went on to fail on something else.
    // Which is the point of the two halves being separate sentences.
    expect(r.stdout).toMatch(process.platform === 'darwin'
      ? /^install: done — every step above converged$/m
      : /^install: done — converged with 1 degraded step \(linger\)$/m);
    // The NEGATIVE half belongs to the Linux case only: there, claiming
    // "every step converged" four lines under a step that said it could not
    // would be the false sentence this assertion was written to catch. On
    // macOS that sentence is the TRUE one, because no step degraded.
    if (process.platform !== 'darwin') {
      expect(r.stdout).not.toMatch(/^install: done — every step above converged$/m);
    }
  });

  it('a fresh VM with no Claude Code installed is told to install it, not to edit its roster (A2-NEW)', () => {
    // The e2e the 2d fixtures hid: `freshBox` always planted the fake upstream
    // binary, so no test in this file ever ran the FULL `ccrc install`
    // transcript against the box a real fresh VM actually is — `bash
    // install.sh` seeded the default roster (one `upstream` account,
    // `claude`), Claude Code was never installed, and the closing `ccrc
    // doctor` is the FIRST thing that measures the gap. The first sentence a
    // fresh operator reads has to be actionable.
    const home = freshBoxNoUpstream('ccrc-install-no-claude-');
    const r = runInstall(home);
    expect(r.code).toBe(1);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL wrappers: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/claude has no executable at \$HOME\/\.local\/bin\/claude/);
    // MEASURED RED (before A2-NEW): this remedy read "the roster is the
    // source of truth … 'ccrc adopt --out /tmp/accounts.json'" — the
    // roster-sync remedy, which cannot fix an absent binary and sends a
    // fresh-VM operator looking at the wrong file.
    expect(lines[i + 1]).toMatch(/install Claude Code/);
    expect(lines[i + 1]).not.toMatch(/ccrc adopt/);
    // …and every install step above still converged clean — `_inst_wrappers`
    // only writes GENERATED accounts, the default roster has none, so there
    // is nothing for that step to degrade on. This is doctor's OWN verdict,
    // run as the verb's last word, over an install that otherwise finished:
    // the FIRST sentence a fresh operator reads is actionable precisely
    // because it is not buried under an unrelated step failure.
    expect(r.stdout).toMatch(/^install: done — every step above converged$/m);
    expect(r.stdout).not.toMatch(/degraded/);
  });
});

describe('ccrc install: running the WHOLE verb twice', () => {
  // Tasks 6-7 measured idempotence per step. This is the same property for the
  // finished verb: the promise in `--help` ("re-running converges; it never
  // damages an existing install") is about `ccrc install`, not about eight of
  // its fourteen steps, and the steps that arrived in Task 8 are the ones with
  // the most to damage — a settings.json an operator has customised, a wrapper
  // they wrote, a unit systemd is running out of right now.
  it('changes nothing but the build stamp, and leaves no temp file anywhere', () => {
    const home = freshBox('ccrc-install-idem-whole-');
    gitInit(treeRoot(home));   // so the stamp step really writes, and rewrites
    const first = runInstall(home);
    expect(first.code, first.stderr).toBe(0);

    // Every `_inst_atomic` destination, plus the ccrc-owned file written by
    // other means. `build.json` is DELIBERATELY ABSENT from this list: its
    // `builtAt` measures the run that wrote it, so rewriting it is what that
    // step is for — assertion 4 below is that it DID change, which is the other
    // half of the same rule.
    const targets = [
      join(home, '.ccrc', 'accounts.sh'),
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
      join(home, '.cc-sessions', 'session-hook.sh'),
      join(home, '.cc-sessions', 'install-session-hooks.sh'),
      join(home, '.cc-sessions', 'notify.sh'),
      join(home, '.cc-sessions', 'install-coordinator-skill.sh'),
      join(home, '.cc-sessions', 'install-worker-skill.sh'),
      join(home, '.cc-sessions', 'install-reviewer-skill.sh'),
      join(home, '.cc-sessions', 'install-history-skill.sh'),
      // graphify Task 3: staged beside them, through the same `_inst_atomic`.
      join(home, '.cc-sessions', 'install-graphify-skill.sh'),
      // …and the four staged skill TREES, which are not `_inst_atomic`
      // destinations at all: `_inst_tree_copy` converges a directory, and the
      // file inside it is what a re-run must not rewrite (worker-skill Task 4,
      // reviewer-skill Task 10).
      join(home, '.cc-sessions', 'coordinator-skill', 'SKILL.md'),
      join(home, '.cc-sessions', 'worker-skill', 'SKILL.md'),
      join(home, '.cc-sessions', 'reviewer-skill', 'SKILL.md'),
      join(home, '.cc-sessions', 'history-skill', 'SKILL.md'),
      join(home, '.tmux.conf'),
      join(home, '.claude', 'statusline-command.sh'),
      // THE JOB FILES THIS PLATFORM ACTUALLY HAS. `UNIT_FILES` is systemd's
      // set — four units and two drop-ins — and none of it exists on macOS,
      // where `_inst_units` writes exactly one plist and launchd has neither
      // templates nor drop-ins.
      ...(process.platform === 'darwin'
        ? [join(home, 'Library', 'LaunchAgents', 'app.ccrc.ccrc.plist')]
        : UNIT_FILES.map(([dest]) => unitDir(home, ...dest.split('/')))),
    ];
    const before = targets.map(mtime);
    const jsonBefore = read(join(home, '.ccrc', 'accounts.json'));
    const envBefore = read(join(home, '.ccrc', 'ccrc.env'));
    const settingsBefore = read(join(home, '.claude', 'settings.json'));
    const stampBefore = read(join(home, '.ccrc', 'build.json'));
    const stampMtimeBefore = mtime(join(home, '.ccrc', 'build.json'));
    const callsBefore = systemctlCalls(home).map((c) => c.argv);

    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);

    // 1. The two USER-OWNED files are byte-identical, which is the rule this
    //    verb would do the most damage by breaking.
    expect(read(join(home, '.ccrc', 'accounts.json'))).toBe(jsonBefore);
    expect(read(join(home, '.ccrc', 'ccrc.env'))).toBe(envBefore);
    // 2. …and so is the settings.json the hooks installer converged: it
    //    re-derives the same JSON and skips the write, so an operator's own
    //    statusLine (which it seeds only when absent) survives every re-run.
    expect(read(join(home, '.claude', 'settings.json'))).toBe(settingsBefore);
    // 3. Every converger target keeps its mtime — the measurement that
    //    separates "the file still says the right thing" from "nothing was
    //    rewritten", and the only one an operator can use to see what a run
    //    actually did.
    expect(targets.map(mtime)).toEqual(before);
    // 4. …except the stamp, which measures THIS run and must not be stale.
    //    MEASURED BY MTIME, not by content, and the difference is a real flake
    //    this assertion had: `builtAt` is `date -u +%Y-%m-%dT%H:%M:%SZ`
    //    (ccrc:2381) — SECOND resolution — while `sha`, `ref` and `dirty` are
    //    identical across two runs of one checkout. Two installs completing
    //    inside the same wall-clock second therefore produce a byte-identical
    //    stamp, and a content comparison calls that a failure to rewrite. It is
    //    not: mtime is the measurement this test already trusts for every other
    //    target three lines up, and "was rewritten" is what assertion 4 means.
    //    The content check that survives is the one that is time-independent:
    //    the stamp still describes THIS checkout, so a stale or absent rewrite
    //    is still caught by the sha.
    const stampAfter = read(join(home, '.ccrc', 'build.json'));
    expect(mtime(join(home, '.ccrc', 'build.json'))).not.toBe(stampMtimeBefore);
    expect(JSON.parse(stampAfter).sha).toBe(JSON.parse(stampBefore).sha);
    expect(String(JSON.parse(stampAfter).sha)).toMatch(/^[0-9a-f]{40}$/);
    // 5. The systemd calls are the same three, in the same order. `enable
    //    --now` on an enabled unit is a no-op by design; what would NOT be safe
    //    is a second run that started restarting things, which is how an
    //    install turns into an outage on a box with live sessions.
    expect(systemctlCalls(home).map((c) => c.argv).slice(callsBefore.length))
      .toEqual(callsBefore);
    // 6. And no run left a temp sibling behind, in any directory a step writes
    //    into — including the two drop-in dirs and the escaped one.
    expect(strays(home)).toEqual([]);
  });
});
