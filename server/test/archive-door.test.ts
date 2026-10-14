// `POST /api/sessions/:id/archive` — the ONE "Archive" (workspace lifecycle spec §5.2), end to end through
// `buildServer`, over a fixture HOME: the registry rows, the worktree, the live status file and the hook state are
// files in it, the coordination store is a real `coord.db`, and every tmux and ccd call is a recorded double.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { Bus } from '../src/bus.js';
import type { FleetWatcher } from '../src/watch.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { NotifyLog } from '../src/notifylog.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { okRun } from './coordReadHelpers.js';

const PANE = 4242;
const COORDINATOR = 'demo-coordinator';
const CCD_VERBS = new Set(['ws-archive', 'stop', 'ws-release', 'ws-hold', 'ws-audit', 'ws-reclaim']);

interface BoxCfg {
  /** `tmux has-session` answers: a pane, or a clean "no such session". */
  alive?: boolean;
  /** `tmux has-session` cannot be asked — tmux's own words for a server it cannot reach (`unknown`, D-308). */
  tmuxUnknown?: boolean;
  /** `tmux list-panes` fails, so no pane pid is read. */
  noPanePid?: boolean;
  /** Called with every call's argv BEFORE it is answered — a turn that starts while the door is mid-way. */
  onCall?: (args: string[]) => void;
  /** The watcher's newest pane dialogs (`currentPending`): sessions with a dialog waiting on the operator. */
  pending?: string[];
  /** A ccd verb's answer, by verb; every other verb exits 0. */
  ccd?: Record<string, { code: number; stderr: string; stdout?: string }>;
  /** Remote mode's view of a worktree: the fleet agent's read roots (`checkPath`) exclude `~/worktrees`, so every
   *  stat under one answers `unreadable` (`remote/io.ts`), never `absent`. */
  worktreeUnreadable?: boolean;
}

let open: FastifyInstance[] = [];
afterEach(async () => { for (const a of open) await a.close(); open = []; });

const box = async (cfg: BoxCfg = {}, over: Partial<Deps> = {}) => {
  const home = mkTmp('ccrc-archive-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    cfg.onCall?.(args);
    const verb = args[0] ?? '';
    if (verb === 'has-session') {
      if (cfg.tmuxUnknown === true) {
        return { code: 1, stdout: '', stderr: 'error connecting to /tmp/tmux-1000/default (Resource temporarily unavailable)' };
      }
      return cfg.alive === false ? { code: 1, stdout: '', stderr: `can't find session: ${args[2] ?? ''}` }
        : { code: 0, stdout: '', stderr: '' };
    }
    if (verb === 'list-panes') {
      return cfg.noPanePid === true ? { code: 1, stdout: '', stderr: 'lost server' } : { code: 0, stdout: `${PANE}\n`, stderr: '' };
    }
    const scripted = cfg.ccd?.[verb];
    return scripted ? { code: scripted.code, stdout: scripted.stdout ?? '', stderr: scripted.stderr } : { code: 0, stdout: '', stderr: '' };
  };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const base = testDeps(home, run);
  const worktrees = `${path.sep}worktrees${path.sep}`;
  const io = cfg.worktreeUnreadable !== true ? base.io : { ...base.io,
    statMeasured: async (p: string) => (p.includes(worktrees) ? { ok: false as const, reason: 'unreadable' as const }
      : base.io.statMeasured(p)) };
  const watcher = cfg.pending === undefined ? undefined : { currentPending: () => new Set(cfg.pending),
    currentStatuslines: () => new Map(), stop: () => {} } as unknown as FleetWatcher;
  const app = await buildServer({ ...base, io, coord, ...over }, new Bus(), watcher);
  open.push(app);
  return { home, calls, app, coord, ccd: () => calls.filter((c) => CCD_VERBS.has(c[0] ?? '')) };
};

/** A registry row. `workspace: null` is a main checkout, whose id is `<wrapper>-<project>`. */
const seed = (home: string, id: string, o: { workspace?: string | null; worktree?: boolean } = {}): string => {
  const reg = path.join(home, '.cc-sessions');
  const ws = o.workspace === undefined ? id.replace(/^demo-/, '') : o.workspace;
  const workdir = ws === null ? path.join(home, 'projects', 'demo') : path.join(home, 'worktrees', 'demo', ws);
  if (o.worktree !== false) mkdirSync(workdir, { recursive: true });
  const fields: Record<string, string> = { wrapper: 'claude-a', project: 'demo', workdir, uuid: `u-${id}`, started: '1',
    ...(ws === null ? {} : { workspace: ws, branch: `ws/${ws}`, base: 'origin/main' }) };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
  return workdir;
};

/** Claude Code's own live file for the pane: what `status` is read from. */
const liveStatus = (home: string, status: string): void => {
  const dir = path.join(home, '.claude-a', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${PANE}.json`),
    JSON.stringify({ pid: PANE, sessionId: 'u', status, statusUpdatedAt: Date.now() - 60_000 }));
};

/** The live file of a pane whose Claude wrote a `sessionId` and NO `status` — `readLiveStateMeasured` reads it `ok` with
 *  `status: ''`, a word ccd's `grep -oE '"status":"[a-z_-]+"'` cannot extract (F1, review 243). */
const liveNoStatus = (home: string): void => {
  const dir = path.join(home, '.claude-a', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${PANE}.json`), JSON.stringify({ pid: PANE, sessionId: 'u' }));
};

/** The live file removed — a pane whose status nobody can read any more (`no-state`). */
const dropLiveStatus = (home: string): void => rmSync(path.join(home, '.claude-a', 'sessions', `${PANE}.json`), { force: true });

const post = (app: FastifyInstance, id: string, payload?: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: `/api/sessions/${id}/archive`, ...(payload === undefined ? {} : { payload }) });

const coordinates = (coord: CoordStore, n: number, program = 'lifecycle'): number[] =>
  Array.from({ length: n }, (_, i) => {
    const r = coord.openRun({ program, title: 'T', project: 'demo', wave: i + 1, waveOf: 3, claimedBy: COORDINATOR });
    if (!('id' in r)) throw new Error('fixture openRun refused');
    return r.id;
  });

describe('the one Archive — a workspace', () => {
  it('archives an idle workspace with ws-archive alone: nothing else is stopped first', async () => {
    const b = await box();
    seed(b.home, 'demo-amber');
    const res = await post(b.app, 'demo-amber');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, archived: true, stopped: false, ended: [] });
    expect(b.ccd()).toEqual([['ws-archive', '--session', 'demo-amber']]);
  });

  it('refuses a busy workspace 409 session-busy, reading the live file on the request — and touches nothing', async () => {
    const b = await box();
    seed(b.home, 'demo-amber');
    liveStatus(b.home, 'busy');
    const res = await post(b.app, 'demo-amber');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'session-busy' });
    expect(b.ccd()).toEqual([]);
  });

  it('reads the HOOK on the request too: a turn the hook reports in flight is busy though the live file says nothing', async () => {
    const b = await box();
    seed(b.home, 'demo-amber');
    writeFileSync(path.join(b.home, '.cc-sessions', 'demo-amber.hookstate.json'), JSON.stringify({
      v: 1, state: 'working', sessionId: 'u-demo-amber', updatedAt: Date.now(), event: 'PreToolUse' }));
    expect((await post(b.app, 'demo-amber')).json()).toEqual({ ok: false, error: 'session-busy' });
    expect(b.ccd()).toEqual([]);
  });

  it('reads the PANE too: a dialog waiting on the operator is busy though the live file and the hook say nothing', async () => {
    const b = await box({ pending: ['demo-amber'] });
    seed(b.home, 'demo-amber');
    expect((await post(b.app, 'demo-amber')).json()).toEqual({ ok: false, error: 'session-busy' });
    expect(b.ccd()).toEqual([]);
  });

  it('with `interrupt`, stops the busy workspace FIRST and then archives it', async () => {
    const b = await box();
    seed(b.home, 'demo-amber');
    liveStatus(b.home, 'busy');
    const res = await post(b.app, 'demo-amber', { interrupt: true });
    expect(res.json()).toEqual({ ok: true, archived: true, stopped: true, ended: [] });
    expect(b.ccd()).toEqual([['stop', 'demo-amber'], ['ws-archive', '--session', 'demo-amber']]);
  });

  // F7 (review 243, the coordinator's ruling): `interrupt` brings a STOP ahead of `ws-archive`'s own `_ws_status`, so
  // ccd cannot catch a pane nobody could read afterwards. The frame row folds tmux `unknown` to dead and leaves an
  // unread pid or an absent live file idle — it would have stopped the pane. With `interrupt` the read is fail-closed
  // for an ORDINARY workspace too (no runs, no `programme`): every unmeasured reading refuses before any verb.
  describe('an ordinary workspace archived with `interrupt` is read fail-closed before its stop (F7)', () => {
    it.each([
      ['tmux cannot be asked (`unknown`), the live file says busy', { tmuxUnknown: true }, true],
      ['the pane pid cannot be read, the live file says busy', { noPanePid: true }, true],
      ['there is no live file', {}, false],
    ] as const)('%s: 409 status-unknown, nothing stopped, nothing archived', async (_why, cfg, withLive) => {
      const b = await box(cfg);
      seed(b.home, 'demo-amber');
      if (withLive) liveStatus(b.home, 'busy');
      const res = await post(b.app, 'demo-amber', { interrupt: true });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ ok: false, error: 'status-unknown' });
      expect(b.ccd()).toEqual([]);
    });

    it('without `interrupt` the frame row and ccd decide, as before: an unreadable pid still archives through ws-archive alone', async () => {
      const b = await box({ noPanePid: true });
      seed(b.home, 'demo-amber');
      liveStatus(b.home, 'idle');
      const res = await post(b.app, 'demo-amber');
      expect(res.json()).toEqual({ ok: true, archived: true, stopped: false, ended: [] });
      expect(b.ccd()).toEqual([['ws-archive', '--session', 'demo-amber']]);
    });
  });

  it('refuses a workspace whose worktree is gone, before anything is stopped or archived', async () => {
    const b = await box();
    seed(b.home, 'demo-amber', { worktree: false });
    liveStatus(b.home, 'busy'); // `interrupt` now reads the turn fail-closed (F7): a readable one reaches the worktree check
    const res = await post(b.app, 'demo-amber', { interrupt: true });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'worktree-gone' });
    expect(b.ccd()).toEqual([]);
  });

  it('maps ccd\'s own session-busy — the race after the live read — to 409 session-busy', async () => {
    const b = await box({ ccd: { 'ws-archive': { code: 1, stderr: 'ccd: session-busy\n' } } });
    seed(b.home, 'demo-amber');
    const res = await post(b.app, 'demo-amber');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'session-busy', detail: 'ccd: session-busy' });
  });

  it('a manifest ccd cannot build, with nothing stopped, is 409 manifest-unbuildable — a "Stop only" refusal', async () => {
    const b = await box({ ccd: { 'ws-archive': { code: 1,
      stderr: 'ccd: cannot describe demo-amber truthfully — nothing was touched\n' } } });
    seed(b.home, 'demo-amber');
    expect((await post(b.app, 'demo-amber')).json())
      .toMatchObject({ ok: false, error: 'manifest-unbuildable' });
    expect(b.ccd()).toEqual([['ws-archive', '--session', 'demo-amber']]);
  });

  it('stopped, then refused: 200 {archived:false, stopped:true, refusal} — the row stays visible, stopped', async () => {
    const b = await box({ ccd: { 'ws-archive': { code: 1, stderr: 'ccd: status-unknown\n' } } });
    seed(b.home, 'demo-amber');
    liveStatus(b.home, 'busy');
    const res = await post(b.app, 'demo-amber', { interrupt: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, archived: false, stopped: true, ended: [], refusal: 'status-unknown',
      detail: 'ccd: status-unknown' });
  });

  it('refuses a body whose programme word is not "end", reading nothing', async () => {
    const b = await box();
    seed(b.home, 'demo-amber');
    expect((await post(b.app, 'demo-amber', { programme: 'keep' })).statusCode).toBe(400);
    expect(b.calls).toEqual([]);
  });
});

describe('the one Archive — a main checkout', () => {
  it('stops an idle main checkout with /stop\'s own argv, and never sends it to ws-archive', async () => {
    const b = await box();
    seed(b.home, 'claude-a-demo', { workspace: null });
    liveStatus(b.home, 'idle');
    const res = await post(b.app, 'claude-a-demo');
    expect(res.json()).toEqual({ ok: true, archived: true, stopped: true, ended: [] });
    expect(b.ccd()).toEqual([['stop', 'claude-a', 'demo']]);
  });

  it('refuses a busy main checkout without `interrupt`, and stops it with one', async () => {
    const b = await box();
    seed(b.home, 'claude-a-demo', { workspace: null });
    liveStatus(b.home, 'busy');
    expect((await post(b.app, 'claude-a-demo')).json()).toEqual({ ok: false, error: 'session-busy' });
    expect(b.ccd()).toEqual([]);
    expect((await post(b.app, 'claude-a-demo', { interrupt: true })).json()).toMatchObject({ archived: true, stopped: true });
    expect(b.ccd()).toEqual([['stop', 'claude-a', 'demo']]);
  });

  it('answers a failed stop as /stop does — 502 with ccd\'s stderr', async () => {
    const b = await box({ ccd: { stop: { code: 1, stderr: 'ccd: no tmux server\n' } } });
    seed(b.home, 'claude-a-demo', { workspace: null });
    liveStatus(b.home, 'idle');
    const res = await post(b.app, 'claude-a-demo');
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ ok: false, stderr: 'ccd: no tmux server\n' });
  });

  it('a stop that fails AFTER the programme was ended says both: ccd\'s stderr and the runs it ended', async () => {
    const b = await box({ ccd: { stop: { code: 1, stderr: 'ccd: no tmux server\n' } } });
    seed(b.home, 'claude-a-demo', { workspace: null });
    liveStatus(b.home, 'idle');
    const r = b.coord.openRun({ program: 'lifecycle', title: 'T', project: 'demo', wave: 1, waveOf: 3,
      claimedBy: 'claude-a-demo' });
    if (!('id' in r)) throw new Error('fixture openRun refused');
    const res = await post(b.app, 'claude-a-demo', { programme: 'end' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ ok: false, stderr: 'ccd: no tmux server\n',
      ended: [{ id: r.id, program: 'lifecycle', wave: 1, waveOf: 3 }] });
  });

  // `cmd_stop` refuses nothing, so the door's own read is a main checkout's only guard: it is read FAIL-CLOSED, by
  // `_ws_status`'s rule, where the fleet frame folds an unmeasured pane towards rest (D-309). A turn nobody could
  // MEASURE is `status-unknown` (D-3881), not `session-busy`: the PWA offers "Stop only" for the one and a busy
  // confirm that re-sends `interrupt` for the other, and `interrupt` consents only to a turn that was read.
  it.each([
    ['tmux cannot be asked (`unknown`, which the frame reads as dead)', { tmuxUnknown: true }],
    ['the pane pid cannot be read (the frame leaves `idle`)', { noPanePid: true }],
  ] as const)('a main checkout is not stopped when %s — 409 status-unknown, with or without `interrupt`, no verb', async (_why, cfg) => {
    const b = await box(cfg);
    seed(b.home, 'claude-a-demo', { workspace: null });
    liveStatus(b.home, 'busy');
    expect((await post(b.app, 'claude-a-demo')).json()).toEqual({ ok: false, error: 'status-unknown' });
    expect((await post(b.app, 'claude-a-demo', { interrupt: true })).json()).toEqual({ ok: false, error: 'status-unknown' });
    expect(b.ccd()).toEqual([]);
  });

  // F1 (review 243): ccd's `_ws_status` extracts the word with `grep -oE '"status":"[a-z_-]+"'` and returns 1 on none, so
  // a live file with a `sessionId` and no `status` is a state nobody could read — not "a word other than idle".
  it('a live file with no `status` word is unmeasured, not busy: 409 status-unknown, with and without `interrupt`, no verb', async () => {
    const b = await box();
    seed(b.home, 'claude-a-demo', { workspace: null });
    liveNoStatus(b.home);
    expect((await post(b.app, 'claude-a-demo')).json()).toEqual({ ok: false, error: 'status-unknown' });
    expect((await post(b.app, 'claude-a-demo', { interrupt: true })).json()).toEqual({ ok: false, error: 'status-unknown' });
    expect(b.ccd()).toEqual([]);
  });

  // Review 244, F1: ccd's grep finds no `"status":"<word>"` in a status that is not a string, so `_ws_status` cannot
  // read it. The parsed value used to be String()-ed first — `["idle"]` stopped the pane as idle (fail OPEN), `true`
  // read as a busy turn the operator could consent to lose. Both are unmeasured now: the reader keeps strings only.
  it.each([
    ['an array holding "idle"', ['idle']],
    ['a boolean', true],
  ] as const)('a live file whose `status` is %s is unmeasured: 409 status-unknown, with and without `interrupt`, no verb', async (_why, status) => {
    const b = await box();
    seed(b.home, 'claude-a-demo', { workspace: null });
    const dir = path.join(b.home, '.claude-a', 'sessions');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${PANE}.json`), JSON.stringify({ pid: PANE, sessionId: 'u', status }));
    expect((await post(b.app, 'claude-a-demo')).json()).toEqual({ ok: false, error: 'status-unknown' });
    expect((await post(b.app, 'claude-a-demo', { interrupt: true })).json()).toEqual({ ok: false, error: 'status-unknown' });
    expect(b.ccd()).toEqual([]);
  });

  // Review 244, F2, ruled: the config dir is read FIRST for both kinds of row — ccd's `_ws_status` order — so a main
  // checkout whose registry wrapper the roster no longer knows is unmeasured even when tmux proves its pane GONE. It
  // fails closed: no verb runs, and "Stop only" (`/stop`, which reads no verdict) remains the way to put it down.
  it('a GONE main checkout whose wrapper has no config dir is unmeasured: 409 status-unknown, with and without `interrupt`, no verb', async () => {
    const b = await box({ alive: false });
    seed(b.home, 'claude-a-demo', { workspace: null });
    writeFileSync(path.join(b.home, '.cc-sessions', 'claude-a-demo.wrapper'), 'claude-unrostered');
    expect((await post(b.app, 'claude-a-demo')).json()).toEqual({ ok: false, error: 'status-unknown' });
    expect((await post(b.app, 'claude-a-demo', { interrupt: true })).json()).toEqual({ ok: false, error: 'status-unknown' });
    expect(b.ccd()).toEqual([]);
  });

  it('a busy main checkout that coordinates is refused BEFORE its programme is ended — busy is the first check', async () => {
    const b = await box();
    seed(b.home, 'claude-a-demo', { workspace: null });
    liveStatus(b.home, 'busy');
    const r = b.coord.openRun({ program: 'lifecycle', title: 'T', project: 'demo', wave: 1, waveOf: 3,
      claimedBy: 'claude-a-demo' });
    if (!('id' in r)) throw new Error('fixture openRun refused');
    expect((await post(b.app, 'claude-a-demo', { programme: 'end' })).json()).toEqual({ ok: false, error: 'session-busy' });
    expect(okRun(b.coord.run(r.id))!.state).toBe('planned');
    expect(b.ccd()).toEqual([]);
  });

  it('a live main checkout with no live file could not be measured: 409 status-unknown, with and without `interrupt`', async () => {
    const b = await box();
    seed(b.home, 'claude-a-demo', { workspace: null });
    expect((await post(b.app, 'claude-a-demo')).json()).toEqual({ ok: false, error: 'status-unknown' });
    expect((await post(b.app, 'claude-a-demo', { interrupt: true })).json()).toEqual({ ok: false, error: 'status-unknown' });
    expect(b.ccd()).toEqual([]);
  });

  it('a turn that starts DURING the programme end is not lost: the stop re-reads busy at the act and refuses, naming the end', async () => {
    let home = '';
    const b = await box({ onCall: (args) => { if (args[0] === 'ws-release') liveStatus(home, 'busy'); } });
    home = b.home;
    seed(b.home, 'claude-a-demo', { workspace: null });
    seed(b.home, 'demo-w');
    liveStatus(b.home, 'idle');
    const r = b.coord.openRun({ program: 'lifecycle', title: 'T', project: 'demo', wave: 1, waveOf: 3,
      claimedBy: 'claude-a-demo' });
    if (!('id' in r)) throw new Error('fixture openRun refused');
    b.coord.markDispatched(r.id, 'demo-w', 'demo-w', 'ws/w', false);
    expect(b.coord.advance(r.id, 'dispatched', 'coordinator').ok).toBe(true);
    const res = await post(b.app, 'claude-a-demo', { programme: 'end' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'session-busy',
      ended: [{ id: r.id, program: 'lifecycle', wave: 1, waveOf: 3 }] });
    expect(b.ccd()).toEqual([['ws-release', '--session', 'demo-w']]);
  });

  it('a live file that VANISHES during the programme end is unmeasured at the stop: 409 status-unknown naming the end, no stop', async () => {
    let home = '';
    const b = await box({ onCall: (args) => { if (args[0] === 'ws-release') dropLiveStatus(home); } });
    home = b.home;
    seed(b.home, 'claude-a-demo', { workspace: null });
    seed(b.home, 'demo-w');
    liveStatus(b.home, 'idle');
    const r = b.coord.openRun({ program: 'lifecycle', title: 'T', project: 'demo', wave: 1, waveOf: 3,
      claimedBy: 'claude-a-demo' });
    if (!('id' in r)) throw new Error('fixture openRun refused');
    b.coord.markDispatched(r.id, 'demo-w', 'demo-w', 'ws/w', false);
    expect(b.coord.advance(r.id, 'dispatched', 'coordinator').ok).toBe(true);
    const res = await post(b.app, 'claude-a-demo', { programme: 'end' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'status-unknown',
      ended: [{ id: r.id, program: 'lifecycle', wave: 1, waveOf: 3 }] });
    expect(b.ccd()).toEqual([['ws-release', '--session', 'demo-w']]);
  });
});

describe('the one Archive — a coordinator (L5)', () => {
  it('refuses 409 coordinator-has-open-runs, naming the runs, and ends nothing', async () => {
    const b = await box();
    seed(b.home, COORDINATOR);
    const [r1, r2] = coordinates(b.coord, 2);
    const res = await post(b.app, COORDINATOR);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'coordinator-has-open-runs', runs: [
      { id: r1, program: 'lifecycle', wave: 1, waveOf: 3 }, { id: r2, program: 'lifecycle', wave: 2, waveOf: 3 }] });
    expect(okRun(b.coord.run(r1!))!.state).toBe('planned');
    expect(b.ccd()).toEqual([]);
  });

  it('with `programme:"end"`, abandons every run as the operator, then archives', async () => {
    const b = await box();
    seed(b.home, COORDINATOR);
    liveStatus(b.home, 'idle');
    const [r1, r2] = coordinates(b.coord, 2);
    const res = await post(b.app, COORDINATOR, { programme: 'end' });
    expect(res.json()).toEqual({ ok: true, archived: true, stopped: false, ended: [
      { id: r1, program: 'lifecycle', wave: 1, waveOf: 3 }, { id: r2, program: 'lifecycle', wave: 2, waveOf: 3 }] });
    for (const r of [r1!, r2!]) {
      expect(okRun(b.coord.run(r))!.state).toBe('failed');
      const ev = b.coord.db.prepare('SELECT causedBy FROM run_events WHERE runId = ? ORDER BY id DESC LIMIT 1')
        .get(r) as { causedBy: string };
      expect(ev.causedBy).toBe('operator');
    }
    expect(b.ccd()).toEqual([['ws-archive', '--session', COORDINATOR]]);
  });

  // D-3877, D-3881: ending a programme is irreversible, so a workspace's turn is read FAIL-CLOSED before it — by the
  // same rule as a main checkout's stop (`stopVerdict`) and with or without `interrupt`. The frame's own row folds
  // tmux `unknown` and an absent live file towards rest, and `ws-archive`'s `_ws_status` would then refuse
  // `status-unknown` AFTER the end. A turn nobody could measure is `status-unknown`, whatever the consents.
  describe('with `programme:"end"`, a workspace coordinator is read fail-closed BEFORE the end', () => {
    const unread: Record<string, BoxCfg> = {
      'tmux cannot be asked (`unknown`)': { tmuxUnknown: true },
      'it has no live file': {},
    };
    const bodies = { 'without `interrupt`': { programme: 'end' }, 'WITH `interrupt`': { programme: 'end', interrupt: true } };
    for (const [how, body] of Object.entries(bodies)) {
      it.each(Object.keys(unread))(`%s, ${how}: 409 status-unknown, no run ended, no ccd verb ran`, async (why) => {
        const b = await box(unread[why]);
        seed(b.home, COORDINATOR);
        if (why.startsWith('tmux')) liveStatus(b.home, 'idle');
        const [r1, r2] = coordinates(b.coord, 2);
        const res = await post(b.app, COORDINATOR, body);
        expect(res.statusCode).toBe(409);
        expect(res.json()).toEqual({ ok: false, error: 'status-unknown' });
        expect([r1!, r2!].map((r) => okRun(b.coord.run(r))!.state)).toEqual(['planned', 'planned']);
        expect(b.ccd()).toEqual([]);
      });
    }

    // F2 (review 243): ccd reads the config dir BEFORE the tmux verdict, so a GONE pane whose wrapper has no config dir
    // is a state nobody could read — never idle. The registry row names a wrapper the roster does not know.
    it.each(Object.keys(bodies))('a GONE pane whose wrapper has no config dir is unmeasured, never idle, %s: 409 status-unknown, nothing ended', async (how) => {
      const b = await box({ alive: false });
      seed(b.home, COORDINATOR);
      writeFileSync(path.join(b.home, '.cc-sessions', `${COORDINATOR}.wrapper`), 'claude-unrostered');
      const [r1, r2] = coordinates(b.coord, 2);
      const res = await post(b.app, COORDINATOR, bodies[how as keyof typeof bodies]);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ ok: false, error: 'status-unknown' });
      expect([r1!, r2!].map((r) => okRun(b.coord.run(r))!.state)).toEqual(['planned', 'planned']);
      expect(b.ccd()).toEqual([]);
    });

    it('control: a GONE pane whose wrapper HAS a config dir is idle — nothing to lose, the programme ends and it archives', async () => {
      const b = await box({ alive: false });
      seed(b.home, COORDINATOR);
      const [r1] = coordinates(b.coord, 1);
      expect((await post(b.app, COORDINATOR, { programme: 'end' })).json()).toMatchObject({ ok: true, archived: true });
      expect(okRun(b.coord.run(r1!))!.state).toBe('failed');
    });

    it('control: a MEASURED busy workspace is 409 session-busy without `interrupt`, and nothing is ended', async () => {
      const b = await box();
      seed(b.home, COORDINATOR);
      liveStatus(b.home, 'busy');
      const [r1] = coordinates(b.coord, 1);
      const res = await post(b.app, COORDINATOR, { programme: 'end' });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ ok: false, error: 'session-busy' });
      expect(okRun(b.coord.run(r1!))!.state).toBe('planned');
      expect(b.ccd()).toEqual([]);
    });

    it('control: a MEASURED busy workspace WITH `interrupt` is the operator\'s consent: stop, then ws-archive, runs ended', async () => {
      const b = await box();
      seed(b.home, COORDINATOR);
      liveStatus(b.home, 'busy');
      const [r1] = coordinates(b.coord, 1);
      const res = await post(b.app, COORDINATOR, { programme: 'end', interrupt: true });
      expect(res.json()).toMatchObject({ ok: true, archived: true, stopped: true });
      expect(okRun(b.coord.run(r1!))!.state).toBe('failed');
      expect(b.ccd().map((c) => c[0])).toEqual(['stop', 'ws-archive']);
    });

    it('control: an affirmatively idle workspace still ends its programme and archives', async () => {
      const b = await box();
      seed(b.home, COORDINATOR);
      liveStatus(b.home, 'idle');
      const [r1] = coordinates(b.coord, 1);
      expect((await post(b.app, COORDINATOR, { programme: 'end' })).json()).toMatchObject({ ok: true, archived: true });
      expect(okRun(b.coord.run(r1!))!.state).toBe('failed');
    });
  });

  it.each(['last', 'first'] as const)(
    'a run the abandon arm cannot move (here %s by id) is found BEFORE any run is ended: NOTHING is ended, stopped or archived',
    async (where) => {
      const b = await box();
      seed(b.home, COORDINATOR);
      liveStatus(b.home, 'busy');
      const [r1, r2] = coordinates(b.coord, 2);
      const stuck = where === 'last' ? r2! : r1!;
      b.coord.setSession(stuck, 'demo-worker');
      b.coord.db.prepare('UPDATE runs SET state = ? WHERE id = ?').run('closing', stuck);
      const res = await post(b.app, COORDINATOR, { programme: 'end', interrupt: true });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ ok: false, error: 'programme-partly-ended', closed: [],
        notClosed: [{ id: r1, program: 'lifecycle', wave: 1, waveOf: 3 }, { id: r2, program: 'lifecycle', wave: 2, waveOf: 3 }],
        refusal: { id: stuck, kind: 'bad-transition', detail: 'closing → closing' } });
      expect([r1!, r2!].map((r) => okRun(b.coord.run(r))!.state))
        .toEqual(where === 'last' ? ['planned', 'closing'] : ['closing', 'planned']);
      expect(b.ccd()).toEqual([]);
    });

  it('an abandon refused AT the act stops the door there: programme-partly-ended names what it closed, nothing is stopped or archived', async () => {
    const b = await box({ ccd: { 'ws-release': { code: 1, stderr: 'ccd: lock busy\n' } } });
    seed(b.home, COORDINATOR);
    seed(b.home, 'demo-w');
    liveStatus(b.home, 'busy');
    const [r1, r2] = coordinates(b.coord, 2);
    b.coord.markDispatched(r2!, 'demo-w', 'demo-w', 'ws/w', false);
    expect(b.coord.advance(r2!, 'dispatched', 'coordinator').ok).toBe(true);
    const res = await post(b.app, COORDINATOR, { programme: 'end', interrupt: true });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'programme-partly-ended',
      closed: [{ id: r1, program: 'lifecycle', wave: 1, waveOf: 3 }],
      notClosed: [{ id: r2, program: 'lifecycle', wave: 2, waveOf: 3 }],
      refusal: { id: r2, kind: 'fleetFailed', detail: 'ccd: lock busy' } });
    expect([r1!, r2!].map((r) => okRun(b.coord.run(r))!.state)).toEqual(['failed', 'dispatched']);
    expect(b.ccd()).toEqual([['ws-release', '--session', 'demo-w']]);
  });

  it('every refusable check runs before the programme is ended: a gone worktree ends nothing', async () => {
    const b = await box();
    seed(b.home, COORDINATOR, { worktree: false });
    liveStatus(b.home, 'idle');
    const [r1] = coordinates(b.coord, 1);
    expect((await post(b.app, COORDINATOR, { programme: 'end' })).json()).toEqual({ ok: false, error: 'worktree-gone' });
    expect(okRun(b.coord.run(r1!))!.state).toBe('planned');
  });

  it('an unreadable store refuses fail-shut with `runs: []`, programme or not', async () => {
    const b = await box();
    seed(b.home, COORDINATOR);
    liveStatus(b.home, 'idle');
    coordinates(b.coord, 1);
    b.coord.db.prepare(
      'INSERT INTO runs (id, program, wave, waveOf, project, state, claimedBy, openedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(4242, 'lifecycle', BigInt(Number.MAX_SAFE_INTEGER) + 1n, 3, 'demo', 'planned', COORDINATOR, Date.now());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const body of [undefined, { programme: 'end' }]) {
      // Wave 3b (the carried follow-up, D-2545's base behaviour): the refusal carries the store's own detail, and the
      // server logs it — it used to drop both.
      expect((await post(b.app, COORDINATOR, body)).json())
        .toEqual({ ok: false, error: 'coordinator-has-open-runs', runs: [], detail: expect.stringMatching(/\S/) });
    }
    expect(warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('could not be read'))).toHaveLength(2);
    warn.mockRestore();
    expect(b.ccd()).toEqual([]);
  });

  it('a store that THROWS is a store this box cannot read: the same fail-shut 409s, never a 500', async () => {
    const b = await box();
    seed(b.home, COORDINATOR);
    liveStatus(b.home, 'idle');
    b.coord.db.close();
    const plain = await post(b.app, COORDINATOR);
    expect(plain.statusCode).toBe(409);
    expect(plain.json()).toEqual({ ok: false, error: 'run-open', runs: [], detail: 'database is not open' });
    const forced = await post(b.app, COORDINATOR, { force: true, programme: 'end' });
    expect(forced.statusCode).toBe(409);
    expect(forced.json()).toEqual({ ok: false, error: 'coordinator-has-open-runs', runs: [], detail: 'database is not open' });
    expect(b.ccd()).toEqual([]);
  });

  it('ends the programme through the abandon door\'s own decision: a CHILD worker\'s reclaim is queued, as an abandon queues it', async () => {
    const home = mkTmp('ccrc-archive-notify-');
    const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
    await notifyLog.load();
    const queue = new KeyedQueue();
    const b = await box({}, { queue, notifyLog });
    seed(b.home, COORDINATOR);
    liveStatus(b.home, 'idle');
    seed(b.home, 'demo-child');
    const [r1] = coordinates(b.coord, 1);
    b.coord.markDispatched(r1!, 'demo-child', 'demo-child', 'ws/child', false);
    expect(b.coord.advance(r1!, 'dispatched', 'coordinator').ok).toBe(true);
    writeFileSync(path.join(b.home, '.cc-sessions', 'demo-child.child'), String(r1));
    expect((await post(b.app, COORDINATOR, { programme: 'end' })).json()).toMatchObject({ ok: true, archived: true });
    await queue.run('demo-child', async () => undefined);
    expect(b.coord.feedEvents(50).filter((e) => e.sessionId === 'demo-child').map((e) => e.title))
      .toEqual(['child reclaim deferred']);
    expect(b.ccd()).toEqual([['ws-release', '--session', 'demo-child'], ['ws-archive', '--session', COORDINATOR]]);
  });
});

describe('the one Archive — remote mode, where this box cannot read a worktree', () => {
  it('an unreadable worktree is not a refusal: ws-archive runs, and ccd measures the worktree itself', async () => {
    const b = await box({ worktreeUnreadable: true });
    seed(b.home, 'demo-amber');
    expect((await post(b.app, 'demo-amber')).json()).toEqual({ ok: true, archived: true, stopped: false, ended: [] });
    expect(b.ccd()).toEqual([['ws-archive', '--session', 'demo-amber']]);
  });

  it('a gone worktree only ccd can see: the programme was ended first, and the 409 names the runs it ended', async () => {
    const b = await box({ worktreeUnreadable: true, ccd: { 'ws-archive': { code: 1,
      stderr: `ccd: worktree is gone: /w — cannot describe it for the archive record; see: ccd ws-attic --session ${COORDINATOR}\n` } } });
    seed(b.home, COORDINATOR, { worktree: false });
    liveStatus(b.home, 'idle');
    const [r1] = coordinates(b.coord, 1);
    const res = await post(b.app, COORDINATOR, { programme: 'end' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'worktree-gone',
      ended: [{ id: r1, program: 'lifecycle', wave: 1, waveOf: 3 }] });
    expect(okRun(b.coord.run(r1!))!.state).toBe('failed');
    expect(b.ccd()).toEqual([['ws-archive', '--session', COORDINATOR]]);
  });
});

describe('the one Archive — the worker check, as it was', () => {
  it('refuses 409 run-open naming the runs, and `force` proceeds', async () => {
    const b = await box();
    seed(b.home, 'demo-amber');
    const r = b.coord.openRun({ program: 'lifecycle', title: 'T', project: 'demo', wave: 1, waveOf: 3, claimedBy: COORDINATOR });
    if (!('id' in r)) throw new Error('fixture openRun refused');
    b.coord.setSession(r.id, 'demo-amber');
    expect((await post(b.app, 'demo-amber')).json())
      .toEqual({ ok: false, error: 'run-open', runs: [{ id: r.id, program: 'lifecycle', wave: 1, waveOf: 3 }] });
    expect((await post(b.app, 'demo-amber', { force: true })).json()).toMatchObject({ ok: true, archived: true });
  });

  it('a dead row needs no interrupt: a stopped workspace is archived again, a crashed main checkout is stopped', async () => {
    const b = await box({ alive: false });
    seed(b.home, 'demo-amber');
    seed(b.home, 'claude-a-demo', { workspace: null });
    expect((await post(b.app, 'demo-amber')).json()).toMatchObject({ archived: true, stopped: false });
    expect((await post(b.app, 'claude-a-demo')).json()).toMatchObject({ archived: true, stopped: true });
  });
});

// WORKSPACE LIFECYCLE WAVE 3b — wave 2's carried follow-ups (review 240), taken now that the archive's end of life is
// real: the base's 404 fold for a registry that did not list, and `ws-archive`'s `already archived` read as success
// without checking that the measured-live pane was stopped.
describe('the archive door, wave 3b', () => {
  it('a registry that cannot be LISTED is 503 registry-unmeasurable — never folded into 404 unknown-session', async () => {
    const b = await box();
    seed(b.home, 'demo-amber');
    rmSync(path.join(b.home, '.cc-sessions'), { recursive: true, force: true });
    const res = await post(b.app, 'demo-amber');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, error: 'registry-unmeasurable' });
    expect(b.ccd()).toEqual([]);
  });

  it('the CONTROL: a registry that lists and does not name the id is still 404 unknown-session', async () => {
    const b = await box();
    const res = await post(b.app, 'demo-nobody');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ ok: false, error: 'unknown-session' });
  });

  it('`already archived` with a pane tmux proves UP: the door stops it, as the archive would have, and says so', async () => {
    const b = await box({ ccd: { 'ws-archive': { code: 0, stderr: '', stdout: 'already archived demo-amber\n' } } });
    seed(b.home, 'demo-amber');
    liveStatus(b.home, 'idle');
    const res = await post(b.app, 'demo-amber');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, archived: true, stopped: true, ended: [] });
    // The FULL argv: `/stop`'s own (`stopArgvFor`, a workspace id whole), not just the verb.
    expect(b.ccd()).toEqual([['ws-archive', '--session', 'demo-amber'], ['stop', 'demo-amber']]);
  });

  it('`already archived` with the pane GONE: archived, nothing stopped — as before', async () => {
    const b = await box({ alive: false, ccd: { 'ws-archive': { code: 0, stderr: '', stdout: 'already archived demo-amber\n' } } });
    seed(b.home, 'demo-amber');
    const res = await post(b.app, 'demo-amber');
    expect(res.json()).toEqual({ ok: true, archived: true, stopped: false, ended: [] });
    expect(b.ccd().map((c) => c[0])).toEqual(['ws-archive']);
  });

  it('`already archived` with the pane UP but the turn BUSY at the act: not stopped — the re-read is the stop\'s guard (review, Task 9)', async () => {
    let home = '';
    const b = await box({
      ccd: { 'ws-archive': { code: 0, stderr: '', stdout: 'already archived demo-amber\n' } },
      // A turn that starts after the door measured idle, while `ws-archive` ran.
      onCall: (args) => { if (args[0] === 'ws-archive') liveStatus(home, 'busy'); },
    });
    home = b.home;
    seed(b.home, 'demo-amber');
    liveStatus(b.home, 'idle');
    const res = await post(b.app, 'demo-amber');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, archived: true, stopped: false, ended: [] });
    expect(b.ccd()).toEqual([['ws-archive', '--session', 'demo-amber']]);
  });

  it('`already archived` with a pane tmux CANNOT be asked about (`unknown`): archived, nothing stopped — as before', async () => {
    const b = await box({ tmuxUnknown: true, ccd: { 'ws-archive': { code: 0, stderr: '', stdout: 'already archived demo-amber\n' } } });
    seed(b.home, 'demo-amber');
    liveStatus(b.home, 'idle');
    const res = await post(b.app, 'demo-amber');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, archived: true, stopped: false, ended: [] });
    expect(b.ccd()).toEqual([['ws-archive', '--session', 'demo-amber']]);
  });
});
