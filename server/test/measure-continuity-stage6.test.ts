// `deploy/measure-continuity.py`'s stage-6 row (session-continuity spec §9;
// wave 4): OOM stops of pane scopes whose session had been idle 30 minutes or
// more with a live background shell — the class Claude Code's pressure reap
// chooses by — beside every pane-scope OOM stop. Its week after wave 4's deploy
// is baseline B. The instrument is READ-ONLY; this suite feeds it a hand-built
// journal export (`--journal`), a fixture HOME's lifecycle journal and
// transcripts, and binds the lifecycle reader to an event the REAL ccd wrote.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

const TOOL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../deploy/measure-continuity.py');

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-measure-continuity-s6-'); });
afterEach(() => { h.cleanup(); });

type Row = Record<string, number | string | Record<string, number>>;
/** The whole stage-6 reading. XDG_RUNTIME_DIR is a fixture directory: no case reads a real box's verdict record. */
const stage = (extra: string[] = []): { reap_class_oom: Row; inert_scopes: Row } => {
  const xdg = path.join(h.home, 'xdg'); fs.mkdirSync(xdg, { recursive: true });
  const out = execFileSync('python3', [TOOL, '--home', h.home, '--stage', '6', '--journal', path.join(h.home, 'journal.json'), ...extra, '--json'],
    { encoding: 'utf8', env: { ...process.env, TZ: 'UTC', XDG_RUNTIME_DIR: xdg } });
  return (JSON.parse(out) as { stage6: { reap_class_oom: Row; inert_scopes: Row } }).stage6;
};
const run = (extra: string[] = []): Row => stage(extra).reap_class_oom;

const T = Date.parse('2026-10-06T12:00:00Z') / 1000;            // the hour every stop below happens in
const iso = (t: number): string => new Date(t * 1000).toISOString();
const unit = (n: number): string => `tmux-spawn-0000000${n}-0000-4000-8000-000000000000.scope`;
const uuidOf = (sid: string): string => `${Buffer.from(sid).toString('hex').padEnd(8, '0').slice(0, 8)}-0000-4000-8000-000000000000`;

/** `journalctl --user -o json` lines, as the instrument asks for them: a scope's start and its OOM stop. */
const journal: string[] = [];
const started = (n: number, t: number): void => {
  journal.push(JSON.stringify({ __REALTIME_TIMESTAMP: String(Math.round(t * 1e6)), USER_UNIT: unit(n), JOB_TYPE: 'start', JOB_RESULT: 'done' }));
};
const oom = (n: number, t: number): void => {
  journal.push(JSON.stringify({ __REALTIME_TIMESTAMP: String(Math.round(t * 1e6)), USER_UNIT: unit(n), UNIT_RESULT: 'oom-kill' }));
};
/** ccd's lifecycle `spawn` event, in the shape `_lc_emit` writes (bound to the real writer below). */
const spawned = (sid: string, t: number): void => {
  const d = path.join(h.home, '.cc-sessions', '.lifecycle');
  fs.mkdirSync(d, { recursive: true });
  fs.appendFileSync(path.join(d, 'journal-1.ndjson'), JSON.stringify({ v: 1, at: Math.round(t * 1000), act: 'spawn', outcome: 'done', id: sid }) + '\n');
};
/** Claude Code's rows, in the shapes measured on the fleet box: a Bash `run_in_background` start
 *  (its tool_result), the `<task-notification>` that ends one, and an ordinary turn. */
const rows = {
  turn: (t: number): string => JSON.stringify({ type: 'assistant', timestamp: iso(t), message: { role: 'assistant', content: [{ type: 'text', text: 'Working.' }] } }),
  bg: (t: number, task: string): string => JSON.stringify({ type: 'user', timestamp: iso(t), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: `Command running in background with ID: ${task}. Output is being written to: /tmp/x/${task}.output` }] } }),
  note: (t: number, task: string): string => JSON.stringify({ type: 'user', timestamp: iso(t), message: { role: 'user', content: `<task-notification>\n<task-id>${task}</task-id>\n<status>completed</status>\n</task-notification>` } }),
  system: (t: number): string => JSON.stringify({ type: 'system', timestamp: iso(t), content: 'Remote Control disconnected' }),
};
const session = (sid: string, lines: string[]): void => {
  fs.writeFileSync(path.join(h.home, '.cc-sessions', `${sid}.uuid`), uuidOf(sid));
  const d = path.join(h.home, '.claude', 'projects', `-p-${sid}`);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, `${uuidOf(sid)}.jsonl`), lines.join('\n') + '\n');
};
const flush = (): void => { fs.writeFileSync(path.join(h.home, 'journal.json'), journal.join('\n') + '\n'); journal.length = 0; };

describe('stage 6 counts what its row says (TZ=UTC, a hand-built journal)', () => {
  it('the reap\'s class, the idle and the busy stops, and every stop it cannot map or measure', () => {
    fs.mkdirSync(path.join(h.home, '.cc-sessions'), { recursive: true });
    // 1 — idle for an hour with a background shell no notification ended: THE REAP'S CLASS
    started(1, T - 7200); spawned('reap', T - 7196); oom(1, T);
    session('reap', [rows.turn(T - 7000), rows.bg(T - 6000, 'b1'), rows.turn(T - 3600)]);
    // 2 — a turn ten minutes before the stop: busy
    started(2, T - 7300); spawned('busy', T - 7295); oom(2, T + 1);
    session('busy', [rows.bg(T - 6000, 'b2'), rows.turn(T - 600)]);
    // 3 — idle, but its one background shell was ended by a notification: idle with no live shell
    started(3, T - 7400); spawned('done', T - 7394); oom(3, T + 2);
    session('done', [rows.bg(T - 6000, 'b3'), rows.note(T - 5000, 'b3'), rows.turn(T - 4000)]);
    // 4 — idle; its shell was started BEFORE this process's spawn, so it died with the old one
    started(4, T - 7500); spawned('old', T - 7493); oom(4, T + 3);
    session('old', [rows.bg(T - 8000, 'b4'), rows.turn(T - 4000)]);
    // 5 — a system row inside the window is no input: still the reap's class
    started(5, T - 7600); spawned('sys', T - 7592); oom(5, T + 4);
    session('sys', [rows.bg(T - 6000, 'b5'), rows.turn(T - 4000), rows.system(T - 60)]);
    // 6 — two sessions spawned in the same window: unmapped
    started(6, T - 9000); spawned('twin-a', T - 8998); spawned('twin-b', T - 8996); oom(6, T + 5);
    // 7 — a scope whose start the journal no longer holds: unmapped
    oom(7, T + 6);
    // 8 — mapped, but the session's row has no uuid any more: unmeasured
    started(8, T - 9500); spawned('gone', T - 9497); oom(8, T + 7);
    // 9 — another session's spawn 3 s BEFORE this scope's start is not this scope's: mapped to the one after it
    started(9, T - 9900); spawned('early', T - 9903); spawned('late', T - 9897); oom(9, T + 8);
    session('late', [rows.bg(T - 6000, 'b9'), rows.turn(T - 3600)]);
    // 10 — an OOM stop before --since is not counted
    started(10, T - 100000); spawned('before', T - 99998); oom(10, T - 90000);
    session('before', [rows.bg(T - 95000, 'b10')]);
    // 11 — a scope that ended for any other reason is not an OOM stop
    started(11, T - 7700); spawned('clean', T - 7699);
    journal.push(JSON.stringify({ __REALTIME_TIMESTAMP: String((T + 9) * 1e6), USER_UNIT: unit(11), UNIT_RESULT: 'exit-code' }));
    // 12 — its last turn 45 minutes before the stop, its shell live: the reap's class at 30 minutes (busy at 60)
    started(12, T - 7800); spawned('edge', T - 7795); oom(12, T + 10);
    session('edge', [rows.bg(T - 6000, 'b12'), rows.turn(T - 2700)]);
    flush();
    const r = run(['--since', '2026-10-06']);
    expect(r.pane_scope_oom_stops).toBe(10);
    expect(r.reap_class).toBe(4);
    expect(r.reap_class_by_session).toEqual({ edge: 1, late: 1, reap: 1, sys: 1 });
    expect(r.busy_within_the_idle_window).toBe(1);
    expect(r.idle_without_a_live_background_shell).toBe(2);
    expect(r.unmapped).toBe(2);
    expect(r.unmapped_by_reason).toEqual({ 'no start record': 1, 'two sessions spawned together': 1 });
    expect(r.unmeasured).toBe(1);
  });

  it('a spawn two scopes started before is claimed by neither: ccd writes no spawn event for a same-rc respawn inside 300 s', () => {
    fs.mkdirSync(path.join(h.home, '.cc-sessions'), { recursive: true });
    // scope 1 started with NO spawn event of its own (a same-rc respawn within five minutes writes none);
    // scope 2 started a second later, and session y's spawn landed in BOTH scopes' windows. Scope 1's stop
    // must not be charged to y, whose transcript would read as the reap's class.
    started(1, T - 3000); started(2, T - 2999); spawned('y', T - 2995); oom(1, T);
    session('y', [rows.bg(T - 2900, 'by'), rows.turn(T - 2800)]);
    flush();
    const r = run();
    expect(r.pane_scope_oom_stops).toBe(1);
    expect(r.reap_class).toBe(0);
    expect(r.reap_class_by_session).toEqual({});
    expect(r.unmapped).toBe(1);
    expect(r.unmapped_by_reason).toEqual({ 'two scopes started before one spawn': 1 });
  });

  it('a journal it cannot read is said, never counted as zero', () => {
    expect(run()).toEqual({ journal: 'unreadable' });
  });
});

describe('stage 6\'s second metric: inert dead scopes that survive a day, read off the sweep\'s verdict record now', () => {
  const UP = 100 * 86400;
  const record = (lines: string[]): void => {
    const xdg = path.join(h.home, 'xdg'); fs.mkdirSync(xdg, { recursive: true });
    fs.writeFileSync(path.join(xdg, 'ccd-scope-sweep.state'), [`# ccd-scope-sweep v1 tick=1 up=${UP} mode=shadow`, ...lines].join('\n') + '\n');
  };
  const dead = (n: number, ago: number, verdict: string): string =>
    `dead tmux-spawn-0000000${n}-0000-4000-8000-000000000000.scope first=${UP - ago} cpu0=7 verdict=${verdict} why=none server=gone procs=1 mem=1 sockets=0 youngest=1 oldest=1 age=1 pids=1`;

  it('counts the dead, the inert (every stop predicate held), and the inert dead a day or more', () => {
    record([dead(1, 25 * 3600, 'would-stop'), dead(2, 2 * 86400, 'held'), dead(3, 23 * 3600, 'stop-failed'), dead(4, 3 * 86400, 'report'),
      'old tmux-spawn-00000005-0000-4000-8000-000000000000.scope pid=9 age=90000 comm=bash']);
    expect(stage().inert_scopes).toEqual({ mode: 'shadow', dead: 4, inert: 3, inert_dead_a_day_or_more: 2 });
  });

  it('no record is `absent`, never zero', () => {
    expect(stage().inert_scopes).toEqual({ record: 'absent' });
  });
});

describe('the lifecycle reader is bound to the event the real ccd writes', () => {
  it('a spawn ccd journalled maps the scope that started in the seconds before it', () => {
    h.sh('_lc_done spawn s-real "" meas.rc 0 meas.wrapper claude');
    const files = fs.readdirSync(path.join(h.home, '.cc-sessions', '.lifecycle')).filter((f) => f.startsWith('journal-'));
    expect(files.length, 'ccd wrote its lifecycle journal').toBeGreaterThan(0);
    const ev = JSON.parse(fs.readFileSync(path.join(h.home, '.cc-sessions', '.lifecycle', files[0]!), 'utf8').trim().split('\n').pop()!) as { at: number };
    const t0 = ev.at / 1000 - 3;
    started(1, t0); oom(1, t0 + 7200);
    session('s-real', [rows.bg(t0 + 100, 'b1'), rows.turn(t0 + 200)]);
    flush();
    const r = run();
    expect(r.reap_class_by_session).toEqual({ 's-real': 1 });
  });
});
