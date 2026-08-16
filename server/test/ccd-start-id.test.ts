/**
 * `ccd start <id>` / `ccd enable <id>` — the one-argument form, and a start
 * that stops rewriting the account (spec §3.4, D2).
 *
 * Two defects, one verb. `<wrapper> <project>` recomputes `<wrapper>-<project>`,
 * but a session keeps its birth id across every swap, so an operator reading
 * `claude-dev0` off the board and typing it back mints a SECOND row. And the
 * unconditional `_reg_set wrapper` then pointed the ORIGINAL row at an account
 * whose config dir does not hold its transcript — the 21:32 incident's own
 * mechanism, reachable from a keyboard.
 *
 * Nothing here may reach systemd or tmux: `_supervised_start` (§3.1) logs its
 * argv instead, and `_alive` answers "no" so every case takes the start path
 * rather than the already-running short-circuit.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-start-id-'); });
afterEach(() => { h.cleanup(); });

const STUBS = `_supervised_start() { echo "supervised_start $*" >> "$HOME/ccd-calls"; }; `
  + `_alive() { return 1; };`;

/** The harness's own `sh` pipes stderr straight to the parent, and the warning
 *  under test is emitted on a SUCCESSFUL run — so this runner captures all
 *  three. `timeout` so a parse bug hangs the case, not the suite. */
const run = (snippet: string): { code: number; stdout: string; stderr: string } => {
  const r = spawnSync('bash', ['-c', `source "${CCD}"; ${snippet}`], {
    encoding: 'utf8', cwd: h.home, timeout: 15000,
    env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }),
  });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

/** A registry row exactly as the incident left it: the id says `claude2`, the
 *  `wrapper` field says `claude-dev0`, because auto-swap moved it. */
const seedRow = (id: string, wrapper: string, project: string): void => {
  fs.mkdirSync(path.join(h.home, 'projects', project), { recursive: true });
  h.sh(`_reg_set ${id} uuid b7001948-0000-4c2f-9a1b-0cfc0dc3d199
    _reg_set ${id} project ${project}
    _reg_set ${id} workdir "$HOME/projects/${project}"
    _reg_set ${id} wrapper ${wrapper}
    _reg_set ${id} started 1`);
};

describe('ccd start — the one-argument id form', () => {
  it('starts the id it was given whole, without re-deriving one', () => {
    // Kills the mutant that still runs `_id "$1" "$2"` on a single argument:
    // that starts `<id>-` (or dies), never the row the operator named.
    seedRow('claude2-expoAI-assistant', 'claude-dev0', 'expoAI-assistant');
    const r = run(`${STUBS} cmd_start claude2-expoAI-assistant`);
    expect(r.code).toBe(0);
    expect(h.calls()).toEqual(['supervised_start claude2-expoAI-assistant']);
    expect(r.stdout).toContain('started claude2-expoAI-assistant (resume)');
    // A workspace id (`<project>-<slug>`, no wrapper prefix) is the case the
    // two-argument form cannot express at all.
    expect(h.reg('claude2-expoAI-assistant', 'wrapper')).toBe('claude-dev0');
  });

  it('refuses a single argument it has no row for, and says how to create one', () => {
    // Kills the mutant that invents `PROJECTS_ROOT/<id>`: there is no workdir
    // to derive from an id alone, so the refusal names the creating form.
    const r = run(`${STUBS} cmd_start never-seen-this`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("no registry for 'never-seen-this'");
    expect(r.stderr).toContain('ccd start <wrapper> <project> [workdir]');
    expect(h.calls()).toEqual([]);
  });

  it('refuses an empty argv with a usage line naming both forms', () => {
    const r = run(`${STUBS} cmd_start`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('usage: ccd start <id> | ccd start <wrapper> <project> [workdir]');
  });

  it('rejects an id shape that would escape the registry directory', () => {
    // Same guard, same spelling as cmd_forget/cmd_ws_hold: the id becomes a
    // path under $REG.
    const r = run(`${STUBS} cmd_start '../../etc'`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('bad session id');
  });
});

describe('ccd start — the registry account wins over the argument', () => {
  it('leaves wrapper alone and warns when the two-argument form disagrees', () => {
    // THE INCIDENT, exactly: auto-swap moved claude2-expoAI-assistant to
    // claude-dev0; the operator typed the account off the board back in; the
    // unconditional `_reg_set wrapper` pointed the row at a config dir that
    // does not hold the transcript. Kills the mutant that keeps the write.
    seedRow('claude2-expoAI-assistant', 'claude-dev0', 'expoAI-assistant');
    const r = run(`${STUBS} cmd_start claude2 expoAI-assistant`);
    expect(r.code).toBe(0);
    expect(h.reg('claude2-expoAI-assistant', 'wrapper')).toBe('claude-dev0');
    expect(r.stderr).toContain('lives on claude-dev0, not claude2');
    expect(r.stderr).toContain('ccd swap claude2-expoAI-assistant claude2');
    // And it really started — a refusal here would strand the row.
    expect(h.calls()).toEqual(['supervised_start claude2-expoAI-assistant']);
  });

  it('does not warn when the argument agrees with the row', () => {
    // Kills the mutant that warns unconditionally, which teaches the operator
    // to ignore the one warning that matters.
    seedRow('claude2-expoAI-assistant', 'claude2', 'expoAI-assistant');
    const r = run(`${STUBS} cmd_start claude2 expoAI-assistant`);
    expect(r.code).toBe(0);
    expect(r.stderr).not.toContain('warn');
  });

  it('still creates a brand-new session from the two-argument form', () => {
    // The id form cannot create; this path still can, and the account it
    // names is the one that lands. Kills an over-eager "registry always wins"
    // that would leave a new row with no wrapper at all.
    fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
    const r = run(`${STUBS} cmd_start claude-corp demo`);
    expect(r.code).toBe(0);
    expect(h.reg('claude-corp-demo', 'wrapper')).toBe('claude-corp');
    expect(h.reg('claude-corp-demo', 'workdir')).toBe(path.join(h.home, 'projects', 'demo'));
    expect(h.reg('claude-corp-demo', 'started')).toBe('1');
    expect(r.stdout).toContain('started claude-corp-demo (new)');
  });

  it('honours an explicit workdir on the creating form', () => {
    fs.mkdirSync(path.join(h.home, 'elsewhere'), { recursive: true });
    const r = run(`${STUBS} cmd_start claude-corp demo "$HOME/elsewhere"`);
    expect(r.code).toBe(0);
    expect(h.reg('claude-corp-demo', 'workdir')).toBe(path.join(h.home, 'elsewhere'));
  });
});

describe('ccd enable', () => {
  it('takes the id form too — after §3.1 the two verbs are one act', () => {
    seedRow('claude2-expoAI-assistant', 'claude-dev0', 'expoAI-assistant');
    const r = run(`${STUBS} cmd_enable claude2-expoAI-assistant`);
    expect(r.code).toBe(0);
    expect(h.calls()).toEqual(['supervised_start claude2-expoAI-assistant']);
  });

  it('keeps its own usage line rather than borrowing start\'s', () => {
    // The verb is NOT retired: the agent whitelist and CCD_ARGV grant `start`
    // and `enable` separately, and layer 3 of whitelist-subset.test.ts fails
    // on a grant no route builds. If it stays, it answers as itself.
    const r = run(`${STUBS} cmd_enable`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('usage: ccd enable <id> | ccd enable <wrapper> <project> [workdir]');
  });
});

// §1.1 — the two IN-UNIT branches. `cmd_start`'s out-of-unit path is already
// fixed (#50: `_supervised_start` runs reset-failed + `enable --now` BEFORE any
// spawn and polls a bounded SUPERVISED_START_WAIT), so the spec's claim that it
// carries the identical F8 ordering is struck and this describe does not touch
// it.
describe('cmd_start / cmd_ensure: the in-unit branch takes the split form', () => {
  /** RECORDING halves, and the settle records the CLAIM AS IT STOOD WHEN IT
   *  RAN. That `started=` field is the discriminator: stubbing both halves
   *  proves nothing on its own, since `_spawn` is their composition and calls
   *  both either way. Only "what was written before the blocking half began"
   *  separates the split form from the old spawn-then-claim.
   *
   *  `_spawn_start` sets the GLOBAL and prints nothing — an `echo 0` stub would
   *  model exactly the shape D-B8-1 exists to keep out. `_spawn_settle` records
   *  its fromswap argument; it takes no third one, because the settle bound
   *  rides `CCD_SETTLE_BOUND` and `$3` under `set -u` would be fatal. */
  const HALVES = `_spawn_start() { echo "spawn_start $1 $2" >> "$HOME/ccd-calls"; SPAWN_FROMSWAP=0; };
    _spawn_settle() { echo "spawn_settle $1 $2 started=[$(_reg_get "$1" started)]" >> "$HOME/ccd-calls"; return 0; };
    _alive() { return 1; }; _resupervise_live() { return 1; };
    tmux() { :; }; systemctl() { :; }; sleep() { :; };`;

  const seedMinimal = (id: string): void => {
    h.sh(`_reg_set ${id} wrapper claude
          _reg_set ${id} workdir "$HOME"
          _reg_set ${id} uuid deadbeef-0000-4000-8000-000000000000`);
  };

  it('cmd_start claims BETWEEN the halves in-unit', () => {
    seedMinimal('claude-demo');
    h.sh(`CCD_IN_UNIT=1; ${HALVES} cmd_start claude-demo; :`);
    expect(h.calls()).toEqual([
      'spawn_start claude-demo new',
      'spawn_settle claude-demo 0 started=[1]',
    ]);
    expect(h.reg('claude-demo', 'started')).toBe('1');
  });

  it('cmd_start\'s SUPERVISED branch keeps its claim exactly where it was', () => {
    // Load-bearing when the unit never comes up: a failed revival must
    // classify `orphan`, not `never-started`.
    // `\s*` between the statements, not a literal space: bash deparses a
    // function from its parse tree and puts each command on its own line, so
    // the plan's `"$id"; rc=$?` could never match anything this tree emits.
    const t = h.sh('type cmd_start');
    expect(t).toMatch(/_supervised_start "\$id";\s*rc=\$\?;[\s\S]{0,2000}?_reg_claim "\$id"/);
  });

  it('cmd_ensure claims BETWEEN the halves in-unit, and does NOT supervise', () => {
    seedMinimal('claude-demo');
    h.sh(`CCD_IN_UNIT=1; ${HALVES} cmd_ensure claude-demo; :`);
    expect(h.calls()).toEqual([
      'spawn_start claude-demo new',
      'spawn_settle claude-demo 0 started=[1]',
    ]);
    // cmd_supervise IS the unit's ExecStart and reaches here with
    // CCD_IN_UNIT=1; supervising would have the unit enable --now itself on
    // every restart.
    expect(h.sh('type cmd_ensure')).not.toContain('_ws_supervise');
  });

  it('cmd_ensure picks resume once the row is claimed — the wrong-mode resurrection, fixed by the MOVE', () => {
    // Not by a new check: `ensure` picks mode=new when `started` is empty,
    // handing `--session-id '<uuid>'` to a wrapper for a uuid whose session-env
    // directory already exists (measured on the live orphan). With `started`
    // written at session-creation time it picks `resume`.
    seedMinimal('claude-demo');
    h.sh(`_reg_claim claude-demo; CCD_IN_UNIT=1; ${HALVES} cmd_ensure claude-demo; :`);
    expect(h.calls()[0]).toBe('spawn_start claude-demo resume');
  });

  it('the settle bound is still not an argv word — cmd_ensure passes _spawn_settle two positionals', () => {
    // Task 5's bound rides `CCD_SETTLE_BOUND`, a dynamically-scoped `local`.
    // A third positional here would be `cmd_ensure`'s second, and `cmd_ensure`
    // is whitelisted by prefix — an argv word that reaches `(( ))` is arbitrary
    // code as the fleet user (D-B8-3, 73bc0fe).
    const t = h.sh('type cmd_ensure');
    expect(t).toContain('_spawn_settle "$id" "$SPAWN_FROMSWAP"');
    expect(t).not.toMatch(/_spawn_settle "\$id" "\$SPAWN_FROMSWAP" /);
  });

  it('neither in-unit branch wraps _spawn_start in a command substitution (D-B8-1)', () => {
    for (const fn of ['cmd_start', 'cmd_ensure']) {
      const body = h.sh(`type ${fn}`);
      expect(body, fn).not.toMatch(/\$\(\s*_spawn_start/);
      expect(body, fn).toContain('SPAWN_FROMSWAP');
    }
  });
});
