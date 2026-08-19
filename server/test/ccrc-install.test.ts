// `ccrc install` — the verb that converges a single box from the shipped tree.
// Stage 2d Task 6 builds its SPINE and the three SEEDING steps
// (`_inst_roster`, `_inst_accounts_sh`, `_inst_env`); Tasks 7-9 add the tree
// copy, the executables and stamp, the units, hooks and wrappers, and the
// doctor tail. This file grows with them, which is why the fixture below is a
// tree rather than a pair of files.
//
// ── WHY THE FIXTURE IS A COPIED TREE, NOT SYMLINKS ────────────────────────
// `ccrc-doctor.test.ts` installs `ccrc` into its fixture as SYMLINKS at
// `<home>/ccrc/ccd/` — the shape of a deployed box — and that is right for
// doctor, which only ever READS the tree it is run from. Install is the other
// half: it reads the tree AND writes the box, and Task 7 makes it COPY that
// tree to `~/ccrc`. Two consequences decide the fixture here:
//
//   1. The tree is a CHECKOUT, at `<home>/checkout`, not `<home>/ccrc`.
//      Otherwise Task 7's `_inst_tree` would be copying a directory onto
//      itself, and every "the tree landed at ~/ccrc" assertion would pass
//      against a fixture that never moved a byte.
//   2. Every file is a real COPY, so a test may CORRUPT one (the shipped
//      roster seed, below) without touching this checkout. Through a symlink,
//      "corrupt the seed in the fixture tree" would mean corrupting
//      `deploy/accounts.default.json` in the repository — which is the sort of
//      test that passes once and then breaks everything.
//
// ── WHAT THE TREE HOLDS, AND WHY EACH PIECE IS IN IT ──────────────────────
// `TREE_FILES` is the whole list and is meant to GROW one line at a time as
// later tasks reach for more of the tree. Every entry is there because
// something the verb runs resolves it RELATIVE TO `ccrc` ITSELF (`CCRC_HERE`),
// so a missing entry does not read as "the fixture is thin" — it reads as the
// verb being broken. `the fixture tree is the one the generator needs` below
// is the guard that keeps that failure legible.
//
// ── CONTAINMENT ───────────────────────────────────────────────────────────
// `ccrcEnv`'s three boundaries, same as `ccrc-cli.test.ts` (whose comments own
// the reasoning): `ghContainedEnv`'s poisoned `gh` at the head of PATH, a
// hand-planted `curl`/`systemctl`/`loginctl` beside it, and every `CCRC_*`
// input deleted BY NAME so the fixture decides and never the ambient shell.
// The rest of PATH is left real on purpose — this verb RUNS `node`
// (deploy/gen-accounts.mjs projects the roster into bash), and a fixture-only
// PATH would be testing a box nobody has.
//
// HOME is a throwaway `mkTmp` directory in every test, because this verb
// WRITES: `~/.ccrc/accounts.json`, `~/.ccrc/accounts.sh`, `~/.ccrc/ccrc.env`
// today, and most of a box by Task 8. Nothing here may ever run against a real
// $HOME.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync,
  chmodSync, readdirSync, rmSync,
} from 'node:fs';
import path, { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');

/** Every file the fixture tree is built from, repo-relative. Tasks 7-9 add
 *  lines here (units, `session-hook.sh`, `tmux.conf`, `deploy/notify.sh` …) as
 *  the steps that read them land. */
const TREE_FILES = [
  // The four executables that ship in `ccd/` and resolve each other through
  // `CCRC_HERE`: `ccrc` itself, plus the check table, the wrapper-shape
  // contract and `ccrc-adopt`. Absent siblings are not a smaller fixture —
  // `cmd_doctor` and `cmd_wrappers` refuse by name when one is missing, so the
  // doctor tail (Task 8) would fail for a fixture reason.
  'ccd/ccrc',
  'ccd/ccrc-doctor-checks',
  'ccd/ccrc-wrapper-shape',
  'ccd/ccrc-adopt',
  // The generators, reached as `$CCRC_HERE/../deploy/<name>.mjs` — the same
  // "one directory up from this script" resolution `cmd_wrappers` uses, true
  // in a checkout and at `~/ccrc/deploy` on a deployed box.
  'deploy/gen-accounts.mjs',
  'deploy/gen-wrappers.mjs',
  // The roster SEED `_inst_roster` places on a box that has none…
  'deploy/accounts.default.json',
  // …and the five-account roster this fleet really runs, which ships beside it
  // (deploy.sh:196-206). It is not a seed candidate for a single box; it is
  // here because it is the realistic "the operator already has a roster" fixture
  // — a roster with `claude-corp` in it, so "generated FROM the installed
  // roster" is provable rather than merely plausible.
  'deploy/accounts.migration.json',
  // `gen-accounts.mjs` imports the first three; `gen-wrappers.mjs` imports
  // `wrapper.mjs` and two of the same three. They were written dependency-free
  // for exactly this bare-`node` caller, so this is the complete transitive
  // set — `the fixture tree is the one the generator needs` proves it by
  // running the generator inside the fixture rather than by re-reading the
  // imports here.
  'shared/generate.mjs',
  'shared/mark.mjs',
  'shared/roster-json.mjs',
  'shared/wrapper.mjs',
  // The node floor doctor reads out of the shipped `package.json`, for BOTH
  // box roles (`_check_node` looks for the server's, then the agent's). The
  // doctor tail arrives in Task 8; the files are cheap and their absence would
  // make that task's first run fail for a fixture reason.
  'server/package.json',
  'agent/package.json',
];

/** `<home>/checkout` — the shipped tree this box installs FROM. */
const treeRoot = (home: string): string => join(home, 'checkout');
/** The `ccrc` a test runs: the one INSIDE the fixture tree, so `CCRC_HERE`
 *  resolves to the fixture's `ccd/` and every sibling it reaches is a fixture
 *  file. */
const ccrcIn = (home: string): string => join(treeRoot(home), 'ccd', 'ccrc');
const treeFile = (home: string, rel: string): string => join(treeRoot(home), rel);

/** Builds `<home>/checkout` out of `TREE_FILES`, preserving each file's mode
 *  (the four `ccd/` scripts are 0755 in the repository and one of them is
 *  `exec`d by `cmd_adopt`). Returns the tree root. */
export function installFixtureTree(home: string): string {
  for (const rel of TREE_FILES) {
    const dest = treeFile(home, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(REPO, rel), dest);
    chmodSync(dest, statSync(join(REPO, rel)).mode & 0o777);
  }
  return treeRoot(home);
}

/** A box with a shipped tree on it and nothing else — no `~/.ccrc`, no
 *  `~/.local/bin` beyond the poisons the runner plants. */
function freshBox(prefix: string): string {
  const home = mkTmp(prefix);
  installFixtureTree(home);
  return home;
}

interface Result { code: number; stdout: string; stderr: string }

/** `ccrc-cli.test.ts:73-95`'s runner environment, and its reasoning applies
 *  here unchanged. The one addition a future task must remember: any new
 *  `CCRC_*` variable this verb learns to read goes in the delete list below,
 *  or a maintainer with it exported in their shell gets a different install
 *  than the fixture asked for. */
function ccrcEnv(home: string): NodeJS.ProcessEnv {
  const env = ghContainedEnv(home, { ...process.env, HOME: home });
  const poison = (name: string, says: string): void =>
    writeFileSync(join(home, '.local', 'bin', name),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/${name}-poison"\n`
      + `echo "${says}" >&2\nexit 97\n`, { mode: 0o755 });
  poison('curl', 'ccrc tests must never reach a real server');
  poison('systemctl', 'ccrc tests must never drive this box\'s real systemd');
  // `loginctl` joins the pair here (it is not in ccrc-cli's runner) because
  // Task 8's `_inst_linger` runs `loginctl enable-linger` — a WRITE to this
  // production box's logind, which the poison must be in front of before the
  // step that calls it exists, not after.
  poison('loginctl', 'ccrc tests must never touch this box\'s real logind');
  for (const k of ['CCRC_ADDR', 'CCRC_HEALTH_TIMEOUT', 'CCRC_DOCTOR_GH_TIMEOUT']) delete env[k];
  return env;
}

function runInstall(home: string, args: string[] = ['install'],
  extraEnv: NodeJS.ProcessEnv = {}): Result {
  const r = spawnSync('bash', [ccrcIn(home), ...args],
    { env: { ...ccrcEnv(home), ...extraEnv }, encoding: 'utf8' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const read = (p: string): string => readFileSync(p, 'utf8');
const dotCcrc = (home: string, name: string): string => join(home, '.ccrc', name);
const mtime = (p: string): number => statSync(p).mtimeMs;

/** Writes `~/.ccrc/<name>` before a run — how a test says "this box already
 *  had one of these". */
function preexisting(home: string, name: string, text: string): void {
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(dotCcrc(home, name), text);
}

/** Every `<file>.tmp.<pid>` left under `~/.ccrc`. Each step writes through a
 *  temp sibling and renames; a leftover means a step died between the two, and
 *  nothing on the box would ever clean it up. */
const strays = (home: string): string[] => {
  const d = join(home, '.ccrc');
  return existsSync(d) ? readdirSync(d).filter((f) => /\.tmp\./.test(f)) : [];
};

const DEFAULT_SEED = read(join(REPO, 'deploy', 'accounts.default.json'));
const MIGRATION_ROSTER = read(join(REPO, 'deploy', 'accounts.migration.json'));

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

  it('generates accounts.sh from it — marked, parseable, and 644', () => {
    const home = freshBox('ccrc-install-fresh-accounts-sh-');
    const r = runInstall(home);
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

  it('names the box and the tree before it changes anything', () => {
    // The two inputs every step is computed from. A run under the wrong HOME
    // (sudo) or out of the wrong tree (a stale `~/ccrc` rather than the
    // checkout just edited) SUCCEEDS at the wrong thing, so both are stated in
    // the transcript rather than deduced from the result.
    const home = freshBox('ccrc-install-banner-');
    const r = runInstall(home);
    const lines = r.stdout.split('\n');
    expect(lines[0]).toBe(`install: box: ${home} — single-box, local fleet mode on localhost`);
    expect(lines[1]).toBe(`install: tree: ${treeRoot(home)}`);
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
  // The rule `deploy/deploy.sh:196-206` states and this verb inherits:
  // `accounts.json` and `ccrc.env` are created once and never overwritten.
  // Everything in this describe is one half of that.
  it('keeps a roster the box already had, and generates accounts.sh FROM IT', () => {
    // The five-account roster this fleet really runs. `claude-corp` appears in
    // it and in nothing the seed could produce, so its presence in the
    // generated bash is proof the generator read the INSTALLED roster rather
    // than the shipped default — the local translation of deploy's
    // read-the-box's-copy-back rule.
    const home = freshBox('ccrc-install-kept-roster-');
    preexisting(home, 'accounts.json', MIGRATION_ROSTER);
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(read(dotCcrc(home, 'accounts.json'))).toBe(MIGRATION_ROSTER);
    expect(read(dotCcrc(home, 'accounts.sh'))).toContain('claude-corp');
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
      'CCRC_HOST=203.0.113.7',
      'CCRC_PORT=9999',
      'CCRC_AGENT_TOKEN=not-a-real-token-but-it-is-mine',
      '',
    ].join('\n');
    preexisting(home, 'ccrc.env', mine);
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(read(dotCcrc(home, 'ccrc.env'))).toBe(mine);
    expect(r.stdout).toMatch(/^install: ccrc\.env: kept \(user-owned, never overwritten\)$/m);
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
    writeFileSync(dotCcrc(home, 'accounts.json'), MIGRATION_ROSTER);
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(read(dotCcrc(home, 'accounts.sh'))).toContain('claude-corp');
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
