// server/test/ccd-launch-surface-moves.test.ts
//
// Overlord W1 sandbox, Task 6 (PR A2; plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-sandbox.md`, question 5,
// "never kill what cannot be respawned"). A route whose `profiledigest` stands spawns only when the row it reads hashes to
// the field (`_profile_digest_ok`); `_spawn_start` dies otherwise (PR A, slug profile-refusal-dies-in-spawn-start). These
// cases drive every path that respawns a pane over a digest that differs, in a fixture HOME with tmux and the unit
// manager recorded: the supervised respawn (`cmd_supervise`, `cmd_ensure`), `cmd_start` on an existing row, `cmd_swap`
// (the operator's and the auto-swap's), and `_swap_refuse`'s restart.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { committedDigest } from './sim/launchProfileSets.js';

const ID = 'lane-a-overlord';
const UUID = 'b7001948-2222-4bcc-b60b-0cfc0dc3d199';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const DIGEST = committedDigest('overlord');
const OTHER = 'f'.repeat(64);

let h: CcdHarness;
beforeEach(() => {
  h = makeCcdHarness('ccrc-ccd-launch-moves-');
  // The client a surfaced spawn's door process runs: the spawn refuses without it (review 2735 departure 3, review 2756 F3).
  fs.mkdirSync(path.join(h.home, '.local', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(h.home, '.local', 'bin', 'ccrc-api'), '#!/bin/sh\nexit 3\n', { mode: 0o755 });
});
afterEach(() => { h.cleanup(); });

/** The unit manager and tmux log instead of acting; no pane is up; the unit's start FAILS, so a swap's tail and a
 *  refusal's restart reach the real `cmd_ensure`, whose spawn is the one the digest decides. */
const STUBS = `sleep() { :; };
  _svc_start() { echo "_svc_start $*" >> "$HOME/ccd-calls"; return 1; };
  _svc_stop() { echo "_svc_stop $*" >> "$HOME/ccd-calls"; return 0; };
  _svc_reset_failed() { :; }; _svc_enable() { :; }; _have_systemctl() { return 1; };
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; case "\${1:-}" in has-session) echo "can't find session: x" >&2; return 1 ;; esac; return 0; };`;

/** An Overlord row on `lane-a`'s config dir `.claude`, in a git workspace, with a transcript to carry. */
const seed = (digest: string): void => {
  const wd = path.join(h.home, 'projects', 'overlord');
  fs.mkdirSync(wd, { recursive: true });
  h.sh(`git -C '${wd}' init -q`);
  h.sh(`_reg_set ${ID} uuid ${UUID}
    _reg_set ${ID} wrapper claude
    _reg_set ${ID} project overlord
    _reg_set ${ID} workdir '${wd}'
    _reg_set ${ID} profile overlord
    _reg_set ${ID} profiledigest ${digest}`);
  const mdir = fs.realpathSync(wd).replace(/[/._]/g, '-');
  fs.mkdirSync(path.join(h.home, '.claude', 'projects', mdir), { recursive: true });
  fs.writeFileSync(path.join(h.home, '.claude', 'projects', mdir, `${UUID}.jsonl`), '{"type":"message"}\n');
};
const run = (snippet: string): { code: number; out: string } => {
  try { return { code: 0, out: h.sh(`${STUBS} ${snippet} 2>&1`, { TMUX: '' }) }; }
  catch (e) {
    const err = e as { status?: number; stdout?: Buffer | string };
    return { code: err.status ?? 1, out: String(err.stdout ?? '') };
  }
};
const log = (): string[] => {
  const p = path.join(h.home, '.cc-sessions', 'swap.log');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};
const refusedLines = (): string[] => log().filter((l) => l.includes('launch-profile-refused'));
const swappedLines = (): string[] => log().filter((l) => / swap lane-a-overlord: /.test(l));
const calls = (): string[] => h.calls();
const panesMade = (): string[] => calls().filter((c) => c.startsWith('tmux new-session'));
const kills = (): string[] => calls().filter((c) => c.startsWith('tmux kill-session'));

describe('a supervised respawn over a digest that differs stays refused (the ruled outcome, unchanged by A2)', () => {
  it('cmd_ensure under the unit: no pane, one journal line, a failing status', () => {
    seed(OTHER);
    const r = run(`CCD_IN_UNIT=1 cmd_ensure ${ID}`);
    expect(r.code).not.toBe(0);
    expect(panesMade()).toEqual([]);
    expect(refusedLines()).toHaveLength(1);
  });
  it('cmd_supervise: no pane, one journal line, a failing status the unit counts toward its start limit', () => {
    seed(OTHER);
    const r = run(`cmd_supervise ${ID}`);
    expect(r.code).not.toBe(0);
    expect(panesMade()).toEqual([]);
    expect(refusedLines()).toHaveLength(1);
  });
});

describe('the moves, over a digest that differs', () => {
  it('cmd_start of an existing row refuses before it writes anything: the stop marker stays, no pane', () => {
    seed(OTHER);
    h.sh(`: > "$HOME/.cc-sessions/${ID}.stopped"`);
    const r = run(`CCD_IN_UNIT=1 cmd_start ${ID}`);
    expect(r.code).not.toBe(0);
    expect(panesMade()).toEqual([]);
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', `${ID}.stopped`))).toBe(true);
    expect(refusedLines()).toHaveLength(1);
    expect(refusedLines()[0]).toContain('start');
    expect(r.out, 'the refusal names its remedy (fix round 1 F8)').toContain(`ccd route --session ${ID} --set profiledigest=`);
  });
  it('cmd_swap refuses before the teardown: the pane is not killed, wrapper stays, no swap line', () => {
    seed(OTHER);
    const r = run(`cmd_swap ${ID} claude-d`);
    expect(r.code).not.toBe(0);
    expect(kills()).toEqual([]);
    expect(calls().filter((c) => c.startsWith('_svc_stop'))).toEqual([]);
    expect(h.reg(ID, 'wrapper')).toBe('claude');
    expect(swappedLines()).toEqual([]);
    expect(refusedLines()).toHaveLength(1);
    expect(refusedLines()[0]).toContain('swap to claude-d');
    expect(h.reg(ID, 'swapblocked')).toContain('launch profile');
  });
  it('the auto-swap (a rescue dispatch) refuses the same way, before its act gates', () => {
    seed(OTHER);
    const r = run(`_swap_rescue_act_gate() { echo "act-gate" >> "$HOME/ccd-calls"; return 0; };
      CCD_SWAP_AUTO=1 CCD_SWAP_ARM=rescue cmd_swap ${ID} claude-d`);
    expect(r.code).not.toBe(0);
    expect(calls()).not.toContain('act-gate');
    expect(kills()).toEqual([]);
    expect(h.reg(ID, 'wrapper')).toBe('claude');
    expect(swappedLines()).toEqual([]);
    expect(refusedLines()).toHaveLength(1);
  });
  it("_swap_refuse's restart, once the pane is gone and the digest moved under it, starts nothing", () => {
    seed(DIGEST);
    // The carry finds nothing after the flush (the uuid rotates at the kill), so the swap is refused with a restart;
    // the kill also moves the digest, so the restart is the move the probe must stop.
    const r = run(`tmux() { echo "tmux $*" >> "$HOME/ccd-calls"
        case "\${1:-}" in
          kill-session) _reg_set ${ID} uuid ${UUID_B}; _reg_set ${ID} profiledigest ${OTHER} ;;
          has-session) echo "can't find session: x" >&2; return 1 ;;
        esac; return 0; };
      cmd_swap ${ID} claude-d`);
    expect(r.code).not.toBe(0);
    expect(kills()).toHaveLength(1);
    expect(calls().filter((c) => c.startsWith('_svc_start'))).toEqual([]);
    expect(panesMade()).toEqual([]);
    expect(h.reg(ID, 'wrapper')).toBe('claude');
    expect(refusedLines()).toHaveLength(1);
    expect(refusedLines()[0]).toContain('restart');
    expect(h.reg(ID, 'swapblocked'), 'the row says the session is down (F2)').toContain('the session is down, not restarted');
  });
});

/** The banner hook, recording each notice. */
const notifyHook = (): void => {
  const f = path.join(h.home, '.cc-sessions', 'notify.sh');
  fs.writeFileSync(f, '#!/bin/sh\nprintf \'%s\\n\' "$1" >> "$HOME/notices"\n');
  fs.chmodSync(f, 0o755);
};
const notices = (): string[] => {
  const p = path.join(h.home, 'notices');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};
const mcpPath = (): string => path.join(h.home, 'projects', 'overlord', '.mcp.json');

describe('with the digest equal, a workspace the spawn would refuse refuses each move the same way (fix round 1 F1)', () => {
  it('cmd_swap: no kill-session, wrapper unmoved, no swap line, launch-profile-refused naming the source', () => {
    seed(DIGEST);
    fs.writeFileSync(mcpPath(), '{}\n');
    const r = run(`cmd_swap ${ID} claude-d`);
    expect(r.code).not.toBe(0);
    expect(kills()).toEqual([]);
    expect(calls().filter((c) => c.startsWith('_svc_stop'))).toEqual([]);
    expect(h.reg(ID, 'wrapper')).toBe('claude');
    expect(swappedLines()).toEqual([]);
    expect(refusedLines()).toHaveLength(1);
    expect(refusedLines()[0]).toContain('swap to claude-d: a project source stands: .mcp.json');
  });
  it('cmd_start: refused before the stop marker or any lifecycle write, naming its remedy', () => {
    seed(DIGEST);
    fs.writeFileSync(mcpPath(), '{}\n');
    h.sh(`: > "$HOME/.cc-sessions/${ID}.stopped"`);
    const before = log();
    const r = run(`CCD_IN_UNIT=1 cmd_start ${ID}`);
    expect(r.code).not.toBe(0);
    expect(panesMade()).toEqual([]);
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', `${ID}.stopped`))).toBe(true);
    expect(log().filter((l) => !l.includes('launch-profile-refused'))).toStrictEqual(before);
    expect(refusedLines()).toHaveLength(1);
    expect(refusedLines()[0]).toContain('start: a project source stands: .mcp.json');
    expect(r.out).toContain(`ccd route --session ${ID} --set profiledigest=`);
  });
  it("_swap_refuse's restart, when a source appears under it, starts nothing and says the session is down (F2)", () => {
    seed(DIGEST);
    notifyHook();
    const r = run(`tmux() { echo "tmux $*" >> "$HOME/ccd-calls"
        case "\${1:-}" in
          kill-session) _reg_set ${ID} uuid ${UUID_B}; echo '{}' > '${mcpPath()}' ;;
          has-session) echo "can't find session: x" >&2; return 1 ;;
        esac; return 0; };
      cmd_swap ${ID} claude-d`);
    expect(r.code).not.toBe(0);
    expect(kills()).toHaveLength(1);
    expect(calls().filter((c) => c.startsWith('_svc_start'))).toEqual([]);
    expect(panesMade()).toEqual([]);
    expect(refusedLines()).toHaveLength(1);
    expect(refusedLines()[0]).toContain('restart on claude after a refused swap: a project source stands: .mcp.json');
    const banner = notices().filter((n) => n.startsWith('cc swap BLOCKED'));
    expect(banner).toHaveLength(1);
    expect(banner[0]).toContain(`cc swap BLOCKED: ${ID} is down, not restarted`);
    expect(banner[0]).not.toContain('stays on');
    expect(h.reg(ID, 'swapblocked')).toContain('the session is down, not restarted: launch profile: a project source stands: .mcp.json');
  });
  it('a row without profiledigest swaps as today though the workspace holds a source: the check never runs', () => {
    seed(OTHER);
    h.sh(`rm -f "$HOME/.cc-sessions/${ID}.profiledigest"`);
    fs.writeFileSync(mcpPath(), '{}\n');
    run(`cmd_swap ${ID} claude-d`);
    expect(h.reg(ID, 'wrapper')).toBe('claude-d');
    expect(refusedLines()).toEqual([]);
  });
});

describe('with the digest equal, each move goes as today', () => {
  it('cmd_swap moves the row and journals the swap', () => {
    seed(DIGEST);
    run(`cmd_swap ${ID} claude-d`);
    expect(kills()).toHaveLength(1);
    expect(h.reg(ID, 'wrapper')).toBe('claude-d');
    expect(swappedLines()).toHaveLength(1);
    expect(refusedLines(), 'the surfaced spawn after the swap was not refused').toEqual([]);
  });
  it('a row without profiledigest swaps as today', () => {
    seed(OTHER);
    h.sh(`rm -f "$HOME/.cc-sessions/${ID}.profiledigest"`);
    run(`cmd_swap ${ID} claude-d`);
    expect(h.reg(ID, 'wrapper')).toBe('claude-d');
    expect(refusedLines()).toEqual([]);
  });
});
