// server/test/ccd-stop-argv-order.test.ts
//
// stop sends --surface BEFORE the id (path identity W1a, spec §2.3, §2.4).
//
// The server's two stop builders, run through the REAL `cmd_stop`, sourced in
// a fixture HOME. With the id first, an id spelled `--surface` reached ccd as
// `stop --surface --surface pwa`: the loop read the first two tokens as the
// pair, and the residue `pwa` was stopped. With the pair first, the loop
// consumes one closed-grammar pair and the residue is the id, so
// `stop --surface pwa --surface` dies on the usage line. A project spelled
// `--surface` redirected the legacy pair form the same way, to
// `<wrapper>-pwa`.
//
// A new file, not a case in `ccd-session-state.test.ts`, because that suite is
// a known load flake (CLAUDE.md).
//
// STANDING NOTE: this file matches `ccd-workspaces.test.ts`'s `/^ccd.*\.ts$/`
// containment scan. Its one bash spawn goes through `ghContainedEnv` and asks
// for systemd and tmux containment, and HOME is always `makeCcdHarness`'s
// fixture, never the live one.
//
// THE PAIR PARTS (path identity W1a, a coordinator ruling at plan review). The
// second describe runs the SERVER, not ccd: `/stop` and the archive door over
// planted legacy rows, through Task 2's `appFor` in its own `mkTmp` fixture
// HOME, with a runner that records argv and never execs.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { CCD_ARGV, type CcdArgv } from '../src/ccdargv.js';
import type { Runner } from '../src/exec.js';
import type { FleetState } from '../src/fleetstate.js';
import { CCD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { inheritedEnv } from './gitEnvStrip.js';
import { appFor } from './idGateFixture.js';
import { decOf, eventsOf, readJournal } from './lifecycleHelpers.js';
import { asManagerCalls } from './platformFixtures.js';
import { mkTmp } from './tmpHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-stop-order-'); });
afterEach(() => { h.cleanup(); });

const ID = 'demo-quiet-mesa';
const REGDIR = (): string => path.join(h.home, '.cc-sessions');

/** Every manager and tmux call lands in `$HOME/ccd-calls`, never on a box. */
const STOP = `systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; }; `
  + `launchctl() { echo "launchctl $*" >> "$HOME/ccd-calls"; }; `
  + `tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; };`;

/** The builder's argv after its verb, each token single-quoted for bash. */
const argsOf = (argv: CcdArgv): string =>
  argv.slice(1).map((t) => `'${t.replace(/'/g, `'\\''`)}'`).join(' ');

/** Captures the exit status and stderr of a refusal, which `h.sh` would throw on. */
const run = (snippet: string): { code: number; stdout: string; stderr: string } => {
  const r = spawnSync('bash', ['-c', `source "${CCD}"; ${snippet}`], {
    encoding: 'utf8', cwd: h.home, timeout: 15000,
    env: ghContainedEnv(h.home, { ...inheritedEnv(), HOME: h.home }, { systemd: true, tmux: true }),
  });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

describe('stop sends --surface before the id (spec §2.3, §2.4)', () => {
  it("cmd_stop run on stopId's argv stops the id and stamps surface pwa", () => {
    const argv = CCD_ARGV.stopId(ID, 'pwa');
    expect([...argv]).toEqual(['stop', '--surface', 'pwa', ID]);
    const r = run(`${STOP} cmd_stop ${argsOf(argv)}`);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe(`stopped ${ID}`);
    expect(asManagerCalls(h.calls())).toEqual([
      // `cmd_stop`'s own `_lc_done` is the first lifecycle emit in this
      // process, so `_lc_obs`'s once-per-process pane probe comes first.
      `tmux list-panes -a -F #{session_name} #{pane_pid}`,
      `systemctl --user disable --now claude-session@${ID}`,
      `tmux kill-session -t =cc-${ID}:`,
    ]);
    expect(h.reg(ID, 'stopped')).toMatch(/^\d{10} pwa$/);
    const stops = eventsOf(h.home, 'stop');
    expect(stops).toHaveLength(1);
    expect(stops[0]!['id']).toBe(ID);
    expect(decOf(stops[0]!)['surface']).toBe('pwa');
  });

  it("cmd_stop run on stopPair's argv stops <wrapper>-<project>", () => {
    const argv = CCD_ARGV.stopPair('claude-a', 'demo', 'pwa');
    expect([...argv]).toEqual(['stop', '--surface', 'pwa', 'claude-a', 'demo']);
    const r = run(`${STOP} cmd_stop ${argsOf(argv)}`);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe('stopped claude-a-demo');
    expect(asManagerCalls(h.calls())).toEqual([
      `tmux list-panes -a -F #{session_name} #{pane_pid}`,
      'systemctl --user disable --now claude-session@claude-a-demo',
      'tmux kill-session -t =cc-claude-a-demo:',
    ]);
    expect(h.reg('claude-a-demo', 'stopped')).toMatch(/^\d{10} pwa$/);
    const stops = eventsOf(h.home, 'stop');
    expect(stops).toHaveLength(1);
    expect(stops[0]!['id']).toBe('claude-a-demo');
    expect(decOf(stops[0]!)['surface']).toBe('pwa');
  });

  it('an id spelled --surface is refused by usage, and a planted row named pwa is not stopped', () => {
    fs.writeFileSync(path.join(REGDIR(), 'pwa.uuid'), `${'1'.repeat(36)}\n`);
    const argv = CCD_ARGV.stopId('--surface', 'pwa');
    const r = run(`${STOP} cmd_stop ${argsOf(argv)}`);
    // The redirect the trailing order allowed: a stop of `pwa`, a session nobody named.
    expect(h.reg('pwa', 'stopped'), 'pwa was stopped: the id was read as the flag').toBeNull();
    expect(readJournal(h.home), 'a lifecycle line was written').toEqual([]);
    expect(asManagerCalls(h.calls()), 'a unit or a pane was touched').toEqual([]);
    expect(r.stdout).not.toContain('stopped');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('usage: ccd stop');
    expect(fs.existsSync(path.join(REGDIR(), 'pwa.uuid')), 'the planted row is left as it was').toBe(true);
    expect([...argv]).toEqual(['stop', '--surface', 'pwa', '--surface']);
  });

  it('a project spelled --surface is refused by usage, and no <wrapper>-pwa is stopped', () => {
    // The pair form's redirect. Trailing, `stop claude-a --surface --surface pwa`
    // keeps `claude-a`, eats `--surface --surface` as the pair, and recomputes
    // `claude-a-pwa`. Leading, the second `--surface` has no value and dies.
    fs.writeFileSync(path.join(REGDIR(), 'claude-a-pwa.uuid'), `${'2'.repeat(36)}\n`);
    const argv = CCD_ARGV.stopPair('claude-a', '--surface', 'pwa');
    const r = run(`${STOP} cmd_stop ${argsOf(argv)}`);
    expect(h.reg('claude-a-pwa', 'stopped'), 'claude-a-pwa was stopped: the project was read as the flag')
      .toBeNull();
    expect(readJournal(h.home), 'a lifecycle line was written').toEqual([]);
    expect(asManagerCalls(h.calls()), 'a unit or a pane was touched').toEqual([]);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('usage: ccd stop');
    expect([...argv]).toEqual(['stop', '--surface', 'pwa', 'claude-a', '--surface']);
  });

  it('with no surface, the bare form still stops', () => {
    const one = CCD_ARGV.stopId(ID, null);
    const pair = CCD_ARGV.stopPair('claude-a', 'demo', null);
    expect([...one]).toEqual(['stop', ID]);
    expect([...pair]).toEqual(['stop', 'claude-a', 'demo']);
    const r1 = run(`${STOP} cmd_stop ${argsOf(one)}`);
    expect(r1.code, r1.stderr).toBe(0);
    expect(r1.stdout.trim()).toBe(`stopped ${ID}`);
    expect(h.reg(ID, 'stopped')).toMatch(/^\d{10} cli$/);
    const r2 = run(`${STOP} cmd_stop ${argsOf(pair)}`);
    expect(r2.code, r2.stderr).toBe(0);
    expect(r2.stdout.trim()).toBe('stopped claude-a-demo');
    expect(h.reg('claude-a-demo', 'stopped')).toMatch(/^\d{10} cli$/);
    // cmd_stop's own `cli` default is not a declaration: the journal says `none`.
    const stops = eventsOf(h.home, 'stop');
    expect(stops).toHaveLength(2);
    expect(stops.map((e) => decOf(e)['surface'])).toEqual(['none', 'none']);
  });
});

// THE PAIR PARTS. `stopPair`'s project is a legacy row's `.project`, and its
// wrapper the row's `.wrapper` when the id does not end in `-<project>`: fields
// no id gate reads. `cmd_stop`'s `--surface=*` arm strips a token of that
// spelling from ANY position, so a field reading `--surface=<word>` made the
// pair a one-argument stop of the OTHER token, in the leading, trailing and
// bare forms alike. Both callers of `stopArgvFor` now ask `stopPairRefused` in
// their identity arm and answer 503 `registry-unmeasurable`, with no argv
// composed.

/** Records every argv and never execs. tmux answers that the pane is GONE, so the archive door's fail-closed turn
 *  read is `idle` for a rostered wrapper, and only the identity arm stands between a request and its stop. */
const gonePane = (): { runner: Runner; calls: string[][] } => {
  const calls: string[][] = [];
  const runner: Runner = async (_cmd, args) => {
    calls.push([...args]);
    if (args[0] === 'has-session') return { code: 1, stdout: '', stderr: `can't find session: ${args[2] ?? ''}` };
    return { code: 0, stdout: '', stderr: '' };
  };
  return { runner, calls };
};

/** A legacy row (no `.workspace` file), with the fields `/stop` and the archive door read. */
const seedLegacy = (home: string, id: string, wrapper: string, project: string): void => {
  const reg = path.join(home, '.cc-sessions');
  fs.mkdirSync(reg, { recursive: true });
  const fields = { wrapper, project, workdir: path.join(home, 'projects', 'demo'), uuid: `u-${id}`, started: '1' };
  for (const [k, v] of Object.entries(fields)) fs.writeFileSync(path.join(reg, `${id}.${k}`), v);
};

const WITH_SURFACE: FleetState = {
  connected: true, downSince: null, ccdVerbs: ['stop', 'stop-surface'], rosterFp: null, build: null,
};
const REFUSED = { ok: false, error: 'registry-unmeasurable' };

describe('stop refuses a legacy pair part that is not a registry id', () => {
  let opened: FastifyInstance[] = [];
  afterEach(async () => { for (const a of opened) await a.close(); opened = []; });

  /** The server over its own fixture HOME. No `fleetState` is the no-evidence default, so the bare form. */
  const rig = async (fleetState?: FleetState) => {
    const home = mkTmp('ccrc-stop-pair-');
    const { runner, calls } = gonePane();
    const { app } = await appFor(home, runner, fleetState === undefined ? {} : { fleetState });
    opened.push(app);
    return { home, app, stops: () => calls.filter((c) => c[0] === 'stop') };
  };

  it('/stop refuses a pair part: a .project spelled --surface=pwa, 503 and no stopPair argv', async () => {
    // The id does not end in `---surface=pwa`, so the pair is the row's `.wrapper` and `.project`. Composed in the
    // leading form, it was `stop --surface pwa claude-a --surface=pwa`, a stop of `claude-a`.
    const r = await rig(WITH_SURFACE);
    seedLegacy(r.home, 'claude-a-demo', 'claude-a', '--surface=pwa');
    const res = await r.app.inject({ method: 'POST', url: '/api/sessions/claude-a-demo/stop' });
    expect(r.stops(), 'a stopPair argv was composed and sent').toEqual([]);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual(REFUSED);
  });

  it('/stop refuses a pair part: a dash-leading fallback .wrapper, 503 and no stopPair argv', async () => {
    // The id does not end in `-demo`, so the wrapper is the row's `.wrapper`. Composed with no capability evidence,
    // it was the bare `stop --surface=pwa demo`, a stop of `demo`.
    const r = await rig();
    seedLegacy(r.home, 'claude-a-legacy', '--surface=pwa', 'demo');
    const res = await r.app.inject({ method: 'POST', url: '/api/sessions/claude-a-legacy/stop' });
    expect(r.stops(), 'a stopPair argv was composed and sent').toEqual([]);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual(REFUSED);
  });

  it('the archive door refuses a pair part before its turn read: a .project spelled --surface=pwa, 503 and no stop', async () => {
    // `claude-a` has a config dir and its pane is gone, so the turn reads idle and nothing else refuses. Composed, it
    // was the bare `stop claude-a --surface=pwa`, a stop of `claude-a`.
    const r = await rig();
    seedLegacy(r.home, 'claude-a-demo', 'claude-a', '--surface=pwa');
    const res = await r.app.inject({ method: 'POST', url: '/api/sessions/claude-a-demo/archive' });
    expect(r.stops(), 'a stopPair argv was composed and sent').toEqual([]);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual(REFUSED);
  });

  it('the archive door refuses a pair part before its turn read: a dash-leading fallback .wrapper, 503 and no stop', async () => {
    // A roster id never begins with `-`, so this wrapper has no config dir. Without the identity arm's refusal, the
    // fail-closed turn read answers first, 409 `status-unknown`; the refusal stands before that read.
    const r = await rig();
    seedLegacy(r.home, 'claude-a-legacy', '--surface=pwa', 'demo');
    const res = await r.app.inject({ method: 'POST', url: '/api/sessions/claude-a-legacy/archive' });
    expect(r.stops(), 'a stopPair argv was composed and sent').toEqual([]);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual(REFUSED);
  });
});
