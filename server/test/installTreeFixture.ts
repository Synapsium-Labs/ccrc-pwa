// installTreeFixture.ts — the ONE definition of the `ccrc install` fixture
// tree, shared by `ccrc-install.test.ts` and `ccrc-install-graphify.test.ts`.
//
// Both suites used to carry their own copy of `TREE_FILES` / `TREE_STUBS` /
// `installFixtureTree`, each citing the other's header as the reason: a
// `.test.ts` file registers `describe`/`it` blocks as a SIDE EFFECT of being
// imported, so importing one sibling test file from another to reuse its
// helpers would register that whole suite a second time. That reasoning
// still holds — it just argues for a THIRD file with no `describe` in it,
// not for two copies. This file is that third file: it imports nothing from
// vitest and registers no tests, so both suites can import it directly.
//
// The cost of the two-copy shape was real: an edit to one `TREE_FILES` that
// missed the other broke 34 tests in the file nobody touched. This module
// makes that a structural impossibility rather than a discipline.
import {
  copyFileSync, cpSync, mkdirSync, statSync, chmodSync, writeFileSync,
} from 'node:fs';
import path, { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');

/** Every path the fixture tree is built from, repo-relative. Tasks 8-9 add
 *  lines here (the unit files) as the steps that read them land.
 *
 *  A DIRECTORY entry is copied whole; every other entry is one file. The
 *  recursive branch exists because `deploy/systemd/` is four drop-ins under
 *  three directories and listing them one by one is a fixture that goes stale
 *  the moment a fifth lands (Task 6 review, Minor 5). */
export const TREE_FILES = [
  // The four executables that ship in `ccd/` and resolve each other through
  // `CCRC_HERE`: `ccrc` itself, plus the check table, the wrapper-shape
  // contract and `ccrc-adopt`. Absent siblings are not a smaller fixture —
  // `cmd_doctor` and `cmd_wrappers` refuse by name when one is missing, so the
  // doctor tail (Task 8) would fail for a fixture reason.
  'ccd/ccrc',
  // D-1160: the sweep's shipped default noise list. `_inst_graph_noise`
  // refuses a tree without it, which is the point — a placed tree missing it
  // would leave the box refusing builds over ccrc's own artifacts.
  'ccd/graph-noise.default.list',
  'ccd/ccrc-doctor-checks',
  'ccd/ccrc-wrapper-shape',
  'ccd/ccrc-adopt',
  // The generators, reached as `$CCRC_HERE/../deploy/<name>.mjs` — the same
  // "one directory up from this script" resolution `cmd_wrappers` uses, true
  // in a checkout and at `~/ccrc/deploy` on a deployed box.
  'deploy/gen-accounts.mjs',
  'deploy/gen-wrappers.mjs',
  // The roster SEED `_inst_roster` places on a box that has none. The
  // realistic "the operator already has a roster" fixture is no repo file any
  // more — the shipped five-account migration roster left the tree with the
  // stage-5 de-brand (spec §5, D-202) — so FIVE_ACCOUNT_ROSTER (in
  // `ccrc-install.test.ts`) serialises `DEFAULT_TEST_ROSTER` instead: a roster
  // with `claude-b` in it, so "generated FROM the installed roster" stays
  // provable rather than merely plausible.
  'deploy/accounts.default.json',
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
  // ── Task 7: what `_inst_bins` and `_inst_files` place ──────────────────
  // `ccd` itself is 570 KB and is copied whole rather than stubbed, because
  // the assertion it serves ("`~/.local/bin/ccd` is a byte copy of the tree's
  // ccd") is satisfied by any two identical stubs — while the things that
  // actually go wrong are installing a symlink, a truncated copy, or the
  // wrong file, all of which a real payload catches and a 12-byte one does
  // not.
  'ccd/ccd',
  'ccd/ccd-cap-scopes',
  // graphify Task 10: the sweep executable `_inst_bins` ships alongside the
  // other two, unconditionally (mirrors the `ccd-cap-scopes` line — only the
  // UNIT and its ENABLE are role-gated, per `_inst_units`/`_inst_enable`).
  'ccd/ccd-graph-sweep',
  // The account-health probe (spec 2026-09-07 §A): `_inst_bins` ships it beside
  // the sweep, on the same gate — not Darwin, every role.
  'ccd/ccd-account-health',
  // spec 2026-09-07 §C: the telemetry keepalive `_inst_bins` ships beside
  // the other two on the non-Darwin arm. Only its UNIT and its ENABLE are
  // role-gated, per `_inst_units`/`_inst_enable`. NB fixture INPUT only — the
  // assertions that make this land are in the two suites, not here.
  'ccd/ccd-telemetry-keepalive',
  'ccd/session-hook.sh',
  'ccd/install-session-hooks.sh',
  'ccd/tmux.conf',
  'ccd/statusline-command.sh',
  'deploy/notify.sh',
  // The first DIRECTORY entry. Nothing in Task 7 reads it — `_inst_tree`
  // copies it as part of `deploy/`, and Task 8's `_inst_units` installs the
  // drop-ins out of it. It is here now so the recursive branch above ships
  // with a user rather than as untested fixture machinery.
  'deploy/systemd',
  // ── Task 8: the two unit files that do NOT live under `deploy/systemd/`,
  // and the script `_inst_enable` runs after the service is started. The
  // supervisor unit ships in `ccd/` beside the script that instantiates it;
  // `ccrc.service` ships at the top of `deploy/`. `verify-service.sh` is
  // reached as `$CCRC_HERE/../deploy/verify-service.sh`, so it has to be in
  // the tree the verb is RUN from and not merely in the one it places.
  'deploy/ccrc.service',
  'ccd/claude-session@.service',
  'deploy/verify-service.sh',
  // ── Stage 4 Task 5: the agent's unit, which `--role fleet` installs and
  // every other role still refuses (its REQUIRED EnvironmentFile is the
  // reasoned exclusion — the role gate replaced the blanket refusal).
  'deploy/ccrc-agent.service',
  // ── Stage 3a Task 9: the passphrase hasher. This install writes NO
  // passphrase (the seed-once doctrine applied to a credential, and the
  // `curl … | bash` stdin hazard `cmd_passwd`'s tty refusal exists for), but
  // the run ENDS with doctor, whose `auth` check reaches this file through
  // `$CCRC_HERE/../deploy/` to measure what is (not) there. Without it in the
  // tree, that check would report a bug in ccrc on every fixture box.
  'deploy/gen-auth-hash.mjs',
  // ── The two SKILL TREES and their two installers (worker-skill Task 4).
  // `_inst_skills` places each tree into `~/.cc-sessions/` and then RUNS the
  // installer it just placed beside it, so all four are read out of the tree
  // this fixture builds. They are DIRECTORY entries for the same reason
  // `deploy/systemd` is: the coordinator skill is a SKILL.md plus a
  // `references/` directory whose contents its own installer refuses to run
  // without, and a hand-listed fixture would go stale the moment a fourth
  // reference lands.
  'ccd/coordinator-skill',
  'ccd/worker-skill',
  'ccd/install-coordinator-skill.sh',
  'ccd/install-worker-skill.sh',
  // graphify Task 3: `_inst_graphify_skill` stages this beside the other two
  // installers, through the same `_inst_atomic`. It ships alone — no
  // `ccd/graphify-skill` tree — because its SRC is assembled from the
  // installed package at run time, never vendored (spec §B).
  'ccd/install-graphify-skill.sh',
];

/** The three BUILD ARTIFACTS `_inst_tree` refuses to place a tree without.
 *  They are build output, not repository files, so the fixture WRITES them
 *  instead of copying them — and it writes placeholders, because the step
 *  measures that the path EXISTS (a box cannot run a server or agent it
 *  never built) and a real bundle would make every test that builds a
 *  fixture tree slower for nothing. The tests that want the refusal delete
 *  one. */
export const TREE_STUBS: Record<string, string> = {
  'server/dist/server/src/index.js': '// fixture: stands in for the built server\n',
  'server/dist-pwa/index.html': '<!doctype html><title>fixture PWA</title>\n',
  // D-1159: the agent entry point `ccrc-agent.service` runs. Present for the
  // same reason the two above are — a fleet box cannot run an agent it never
  // built — and deleted by the one test that wants that refusal.
  'agent/dist/agent/src/index.js': '// fixture: stands in for the built agent\n',
};

/** Builds a fixture tree out of `TREE_FILES` + `TREE_STUBS`, preserving each
 *  file's mode (the `ccd/` scripts are 0755 in the repository and one of them
 *  is `exec`d by `cmd_adopt`). `sub` is the directory under `$HOME` it lands
 *  in: `checkout` for the ordinary case, `ccrc` for the one test that runs the
 *  verb from the tree it would otherwise be copying onto itself. Returns the
 *  tree root. */
export function installFixtureTree(home: string, sub = 'checkout'): string {
  const root = join(home, sub);
  for (const rel of TREE_FILES) {
    const src = join(REPO, rel);
    const dest = join(root, rel);
    mkdirSync(dirname(dest), { recursive: true });
    if (statSync(src).isDirectory()) { cpSync(src, dest, { recursive: true }); continue; }
    copyFileSync(src, dest);
    chmodSync(dest, statSync(src).mode & 0o777);
  }
  for (const [rel, body] of Object.entries(TREE_STUBS)) {
    const dest = join(root, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, body);
  }
  return root;
}
