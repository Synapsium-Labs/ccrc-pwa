// The move INTO wave 11 (centralised update management, R12's script half; R13 f, D-3982): the PRE-wave-11
// `_upd_sweep` — FROZEN in `fixtures/upd-sweep-pre-wave11.bash`, exactly as every release from v0.0.60 through
// v0.0.84 ships it — sourced over this tree's `ccd/ccrc` and run against THIS tree's `deploy/verify-service.sh`.
//
// WHY THIS FILE EXISTS. The live auto-update that carries a release runs the box's OLD sweep with the NEW script,
// by construction. Every citation below is by CONTENT (a function and its quoted line), never by line number:
//   - the detached update re-execs the launcher: `_upd_detach`'s
//     `_svc_run_detached /bin/sh -c 'PATH="$HOME/.local/bin:$PATH" exec "$HOME/.local/bin/ccrc" "$@"'`;
//   - the launcher execs `~/ccrc/ccd/ccrc` BEFORE the flip: `_inst_shim`'s heredoc line
//     `exec "$CCRC_SHIPPED" "$@"`;
//   - the old sweep resolves the script at the moment it calls it:
//     `local verify="$BOX_TREE_DIR/deploy/verify-service.sh"`,
//     with `BOX_TREE_DIR="$HOME/ccrc"` — and by then the link names the NEW tree.
// The old caller dies on any non-zero exit (`|| _ccrc_die "$u was restarted and did not stay up …`), so only an
// exit 0 from the script protects that move. agent/test/deploy-verify.test.ts proves the script's exit; THIS file
// proves the old caller, byte for byte, honours it: a stamped stop returns 0, a purged one returns 0, an
// unstamped one dies exactly as it did.
//
// THE MOVE INTO WAVE 11 runs the frozen bytes with this tree's script. Wave 10's version of this file sourced
// `main`'s CURRENT sweep and said so ("re-home it on a frozen copy when wave 11 reshapes the sweep"); wave 11
// reshapes it, so the sweep under test is the fixture's text, not the tree's. X0 pins the fixture's sha256, X0c
// pins the seven tree helpers the frozen function calls (a helper the tree changes is frozen into the fixture
// first), and X0b pins that the next move still resolves the script at call time.
//
// THE TECHNIQUE is `ccrc-update.test.ts`'s `sourcedCcrc`: a shell that SOURCES `ccd/ccrc` — its dispatch is
// guarded by `BASH_SOURCE[0] == $0`, so sourcing defines functions and runs no verb — then sources the frozen
// file, which redefines `_upd_sweep`, and calls it, on a fixture HOME whose `systemctl` is a stub. The builders
// live in `sweepFixture.ts` (wave 11's window file uses them too).
//
// SAFETY. A fixture HOME only, and an env built from scratch (never `...process.env`). Every tool the sweep or
// the script could reach that is not a stub is a POISON that records to `$HOME/<name>-poison` and exits 97, and
// `assertContained` proves, before every spawn, that each one resolves inside the fixture's bin and that the user
// bus names sit under the fixture HOME. Nothing here runs a real ccd, ccrc, systemctl, journalctl, tmux, gh or
// ssh, or reads a real registry.
import { describe, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { itLinux } from './platformFixtures.js';
import {
  CCRC_SRC, FROZEN_SWEEP, SWEEP_OK, makeBox, assertContained, runSweep, calls, poisonFiles, type UnitPlant,
} from './sweepFixture.js';

const DEMO_GOOD = 'claude-session@demo-good.service';
const DEMO_GONE = 'claude-session@demo-gone.service';
const STAMP = '1791151850 ccd';

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** The four strings the header cites by content (X0b): each must be in `ccd/ccrc` and in this file's own header. */
const CITED = [
  `_svc_run_detached /bin/sh -c 'PATH="$HOME/.local/bin:$PATH" exec "$HOME/.local/bin/ccrc" "$@"'`,
  'exec "$CCRC_SHIPPED" "$@"',
  'local verify="$BOX_TREE_DIR/deploy/verify-service.sh"',
  'BOX_TREE_DIR="$HOME/ccrc"',
] as const;

/** The released bytes' digest (v0.0.60 through v0.0.84, the same at every tag measured). */
const FROZEN_SWEEP_SHA = 'd01e0a056196d5dc113ed51976d38959f893a11bb99821bd4f6758c039dacd42';

/** The helpers the frozen sweep (and its die) call, as v0.0.84 shipped them (X0c). */
const HELPER_SHAS: ReadonlyArray<readonly [string, string]> = [
  ['_ccrc_die', 'e7e1f481267223048b0910f900cd7a3f7a48d569d82f1bdb963a1a6dd0fdc018'],
  ['_upd_redact', '572ccbf1220059570ce48128c6e45152bb76f5472bcd894cfdbac8b550a40586'],
  ['_upd_phase', 'd6d3453123096c8e8d99b032464bad7e7f5782b47bd7e5e5627d57c596e8ce52'],
  ['_upd_json_str', 'fb88a5e9d342a2ebef1eb4e4ffde92841d5d117de713507ac6f88f2ce495dff2'],
  ['_tmp_guard', 'e82e65af95b11acd398aa3d83f0522f31f8e3567e801c4c2d70f04e25c659104'],
  ['_exit_add', '6936453d935739d982dc714dd0b44ce8fd1947e59cf6bb4638a2ffca8bbca0f8'],
  ['_exit_run', '2691a2221fb27401bec42bb08c2f42a8078c58a845a367efe5ebe9e1c001a1aa'],
];

/** X0c's one extraction rule: a one-line `^<name>() {.*}$` is its line; otherwise the text from `^<name>() [{(]`
 *  through the first later line that is exactly `}` or `)`, each line plus `\n`. */
function extractHelper(src: string, name: string): string | null {
  const lines = src.split('\n');
  const one = new RegExp(`^${name}\\(\\) \\{.*\\}$`);
  const open = new RegExp(`^${name}\\(\\) [{(]`);
  const i = lines.findIndex((l) => open.test(l));
  if (i < 0) return null;
  if (one.test(lines[i]!)) return `${lines[i]!}\n`;
  let out = '';
  for (let j = i; j < lines.length; j++) {
    out += `${lines[j]!}\n`;
    if (j > i && (lines[j] === '}' || lines[j] === ')')) return out;
  }
  return null;
}

const goodUnit: UnitPlant = { unit: DEMO_GOOD, active: ['active'], mainPid: ['4242'] };
const goneUnit = (active: string[], mainPid: string[]): UnitPlant => ({ unit: DEMO_GONE, active, mainPid });

const stampedStop = () => makeBox({
  units: [goodUnit, goneUnit(['active', 'inactive', 'inactive'], ['5151'])],
  registry: { 'demo-good.uuid': 'u1\n', 'demo-gone.uuid': 'u2\n', 'demo-gone.stopped': `${STAMP}\n` },
});
const unstampedStop = () => makeBox({
  units: [goodUnit, goneUnit(['active', 'inactive', 'inactive'], ['5151'])],
  registry: { 'demo-good.uuid': 'u1\n', 'demo-gone.uuid': 'u2\n' },
});
// A `demo-gone.generation` with no `.uuid`: a MID-PURGE registry shape the script never reads. D-2605 removes
// `.generation` last, so a FULLY purged row has none; this plant is not a fact the purge keeps (F6).
const purgedBeforeLoop = () => makeBox({
  units: [goodUnit, goneUnit(['inactive', 'inactive'], [])],
  registry: { 'demo-good.uuid': 'u1\n', 'demo-gone.generation': '1\n' },
});

/** The call log up to and including demo-good's second verification: the first 11 lines of every case. */
const FIRST_11 = [
  '--user list-units claude-session@* --plain --no-legend',
  `--user show -p KillMode ${DEMO_GOOD}`,
  `--user show -p KillMode ${DEMO_GONE}`,
  '--user show -p KillMode claude-session@ccrc-update-preflight.service',
  '--user try-restart claude-session@*',
  '--user list-units claude-session@* --state=failed --plain --no-legend',
  '--user list-units claude-session@* --state=active --plain --no-legend',
  `--user is-active ${DEMO_GOOD}`,
  `--user show -p MainPID --value ${DEMO_GOOD}`,
  `--user is-active ${DEMO_GOOD}`,
  `--user show -p MainPID --value ${DEMO_GOOD}`,
];

/** X2's exact log: demo-good verified, then demo-gone read active, MainPID, inactive, and re-read inactive by the classifier. */
const X2_LOG = [
  ...FIRST_11,
  `--user is-active ${DEMO_GONE}`,
  `--user show -p MainPID --value ${DEMO_GONE}`,
  `--user is-active ${DEMO_GONE}`,
  `--user is-active ${DEMO_GONE}`,
];

const STATUS_LINE = `--user status --no-pager --lines=0 ${DEMO_GONE}`;

const GOOD_LINE = `verified: ${DEMO_GOOD} active, MainPID 4242 stable across 0s`;
const STAMPED_LINE = `stopped on purpose: ${DEMO_GONE} settled 'inactive', and ccd's stop stamp `
  + `~/.cc-sessions/demo-gone.stopped is present (reads '${STAMP}') — a deliberate stop, not a crash`;
const PURGED_LINE = `stopped on purpose: ${DEMO_GONE} settled 'inactive', and its registry row is purged `
  + '(no ~/.cc-sessions/demo-gone.uuid) — a deliberate stop, not a crash';

describe('the move INTO wave 11: the pre-wave-11 _upd_sweep (frozen, v0.0.60–v0.0.84), sourced over this tree\'s ccd/ccrc, with this tree\'s verify-service.sh', () => {
  itLinux('X0 the frozen bytes are the released bytes', () => {
    const frozen = readFileSync(FROZEN_SWEEP, 'utf8');
    const m = /^_upd_sweep\(\) \{\n[\s\S]*?\n\}\n/m.exec(frozen);
    expect(m, 'the fixture holds no `_upd_sweep() { … }` text').not.toBeNull();
    const body = m![0];
    expect(sha256(body), 'the frozen sweep is no longer the released text — it is never edited; restore it from `git show v0.0.84:ccd/ccrc`').toBe(FROZEN_SWEEP_SHA);
    expect(body).toContain('local verify="$BOX_TREE_DIR/deploy/verify-service.sh"');
    expect(body).toContain('bash "$verify" "$u" \\');
    // The Linux arm's own quote, not the plan's shorter prefix (D-3950): the Darwin arm carries that prefix too.
    expect(body).toContain('|| _ccrc_die "$u was restarted and did not stay up — read: systemctl --user status $u.');
  }, 60_000);

  itLinux('X0b the header\'s content citations hold in this tree', () => {
    const ccrc = readFileSync(CCRC_SRC, 'utf8');
    const header = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\nimport ')[0]!;
    for (const quoted of CITED) {
      expect(ccrc, `ccd/ccrc no longer holds the cited text: ${quoted}`).toContain(quoted);
      expect(header, `this file's header no longer cites: ${quoted}`).toContain(quoted);
    }
    // The NEXT move still resolves the script at call time: the tree's own sweep keeps the line.
    const m = /_upd_sweep\(\) \{([\s\S]*?)\n\}/.exec(ccrc);
    expect(m, '_upd_sweep() { … } not found in ccd/ccrc').not.toBeNull();
    expect(m![1]!).toContain('local verify="$BOX_TREE_DIR/deploy/verify-service.sh"');
  }, 60_000);

  itLinux('X0c the frozen sweep\'s helpers are v0.0.84\'s', () => {
    const ccrc = readFileSync(CCRC_SRC, 'utf8');
    for (const [name, want] of HELPER_SHAS) {
      const text = extractHelper(ccrc, name);
      expect(text, `${name} not found in ccd/ccrc`).not.toBeNull();
      expect(sha256(text!), `${name} differs from v0.0.84's copy — freeze v0.0.84's copy into `
        + 'fixtures/upd-sweep-pre-wave11.bash (below the function) before changing it').toBe(want);
    }
  }, 60_000);

  itLinux('X1 containment: every tool resolves inside the fixture bin, and the bus names sit under the fixture HOME', () => {
    const box = stampedStop();
    assertContained(box);
    expect(box.env['XDG_RUNTIME_DIR']!.startsWith(box.home)).toBe(true);
    expect(box.env['DBUS_SESSION_BUS_ADDRESS']!.startsWith(`unix:path=${box.home}`)).toBe(true);
    expect(box.env['HOME']).toBe(box.home);
    // The check covers the env the spawn carries: an override that moves the bus off the fixture HOME is refused
    // BEFORE any spawn (no systemctl call is recorded).
    expect(() => runSweep(box, { frozen: FROZEN_SWEEP, env: { XDG_RUNTIME_DIR: '/run/user/0' } }))
      .toThrow(/assertNoRealTool: XDG_RUNTIME_DIR=\/run\/user\/0/);
    expect(calls(box)).toEqual([]);
  }, 60_000);

  itLinux('X2 stamped stop caught in the window: the sweep returns 0', () => {
    const box = stampedStop();
    const r = runSweep(box, { frozen: FROZEN_SWEEP });
    expect(r.code, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`).toBe(0);
    expect(r.stdout).toContain(GOOD_LINE);
    expect(r.stdout).toContain(STAMPED_LINE);
    expect(r.stdout).toContain(SWEEP_OK);
    expect(r.stderr).not.toContain('did not stay up');
    expect(r.stderr).not.toContain('DEPLOY FAILED');
    expect(calls(box)).toEqual(X2_LOG);
    expect(poisonFiles(box)).toEqual([]);
  }, 60_000);

  itLinux('X3 unstamped stop: dies with the old bytes\' own sentence (characterisation)', () => {
    const box = unstampedStop();
    const r = runSweep(box, { frozen: FROZEN_SWEEP });
    expect(r.code, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`).toBe(1);
    expect(r.stderr).toContain(`ccrc: ${DEMO_GONE} was restarted and did not stay up — read: `
      + `systemctl --user status ${DEMO_GONE}. The pre-update backup is complete at ${box.home}/ccrc-backups/fixture`);
    expect(r.stderr).toContain(`DEPLOY FAILED — ${DEMO_GONE}`);
    expect(r.stdout).not.toContain('update: sweep: every live');
    expect(calls(box).at(-1)).toBe(STATUS_LINE);
    expect(poisonFiles(box)).toEqual([]);
  }, 60_000);

  itLinux('X3b unstamped stop under the new script: the exact call log, classifier re-read then status', () => {
    const box = unstampedStop();
    runSweep(box, { frozen: FROZEN_SWEEP });
    expect(calls(box)).toEqual([...X2_LOG, STATUS_LINE]);
    expect(poisonFiles(box)).toEqual([]);
  }, 60_000);

  itLinux('X4 reclaimed and purged before the loop reaches it (v0.0.79\'s shape): returns 0', () => {
    const box = purgedBeforeLoop();
    const r = runSweep(box, { frozen: FROZEN_SWEEP });
    expect(r.code, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`).toBe(0);
    expect(r.stdout).toContain(GOOD_LINE);
    expect(r.stdout).toContain(PURGED_LINE);
    expect(r.stdout).toContain(SWEEP_OK);
    expect(r.stderr).not.toContain('did not stay up');
    expect(calls(box)).toEqual([
      ...FIRST_11,
      `--user is-active ${DEMO_GONE}`,
      `--user is-active ${DEMO_GONE}`,
    ]);
    expect(poisonFiles(box)).toEqual([]);
  }, 60_000);
});
