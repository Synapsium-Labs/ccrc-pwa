// `deploy/measure-working-state.py` (plan 2026-10-16-working-state-and-interruptions, Task M; spec §8). Every metric is
// pinned on a constructed fixture HOME with a known answer, as `measure-continuity`'s tests build theirs: Claude Code's
// live files under `.claude-lane-a/sessions/`, the registry (`.cc-sessions/`), the user journal (a `journalctl -o json`
// export), `swap.log`, the server's feed and mail (exports of `ccrc-api` answers) and main transcripts. The hookstate
// and turn-marker files are WRITTEN BY THE REAL HOOK (`ccd/session-hook.sh`, the harness copied from
// session-hook-background.test.ts) from payloads that copy the committed captures' key sets
// (`fixtures/hook/stop-bg-five-kinds.json`, `fixtures/delegation/2.1.280/`), with neutral ids; only their stamps are
// then moved, so the instrument reads the bytes the writer writes. The "no text leaves" rule is pinned by sentinels.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { CCD } from './ccdWsHelpers.js';
import { NON_DELEGATING_TASK_KINDS, sessionBucket, type FleetSession } from '../../shared/api.js';
import { HOOKSTATE_FRESH_MS } from '../src/hookstate.js';
import { liveStatusCoversDelegation } from '../src/livestate.js';
import { STALL_CHECK_PREFIX, STALL_REPORT_PREFIX } from '../src/coord/stall.js';

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'deploy', 'measure-working-state.py');
const HOOK = path.join(ROOT, 'ccd', 'session-hook.sh');
const FIVE_KINDS = path.join(__dirname, 'fixtures', 'hook', 'stop-bg-five-kinds.json');
const CAPTURE = (name: string): { event: string; payload: Record<string, unknown> }[] =>
  (JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'delegation', '2.1.280', `${name}.json`), 'utf8')) as {
    events: { event: string; payload: Record<string, unknown> }[];
  }).events;

const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const NOW_S = 1_790_000_000;
const NOW = NOW_S * 1000;
const MIN = 60_000;
const SENTINEL = 'SENTINEL-TRANSCRIPT-TEXT-7f3a';
const SENTINEL_SUBJECT = 'SENTINEL-MAIL-SUBJECT-91c2';

const sidOf = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let home: string;
beforeEach(() => {
  home = mkTmp('ccrc-mws-');
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  fs.mkdirSync(path.join(home, '.claude-lane-a', 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(home, '.claude-lane-a', 'projects', '-rig-repo'), { recursive: true });
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'tmux'), '#!/bin/sh\necho "cc-$FIXTURE_ID"\n', { mode: 0o755 });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const reg = (f: string): string => path.join(home, '.cc-sessions', f);
const run = (args: string[]) => spawnSync('python3', [SCRIPT, '--home', home, '--now', String(NOW_S), ...args], {
  encoding: 'utf8', env: { ...process.env, TZ: 'UTC', PYTHONDONTWRITEBYTECODE: '1', PATH: '/usr/bin:/bin' },
  timeout: 60_000,
});
const json = (args: string[]): Record<string, Record<string, unknown>> => {
  const r = run([...args, '--json']);
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout) as Record<string, Record<string, unknown>>;
};

/** A registry row: `<id>.uuid` and the hook's `<id>.generation`. */
const row = (id: string, sid: string): void => {
  fs.writeFileSync(reg(`${id}.uuid`), `${sid}\n`);
  fs.writeFileSync(reg(`${id}.generation`), GENERATION);
};

/** Move fields of a file the hook wrote (`undefined` deletes one); its other keys stay the writer's. */
const patch = (file: string, over: Record<string, unknown>): void => {
  if (!fs.existsSync(file)) return;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  for (const [k, v] of Object.entries(over)) { if (v === undefined) delete raw[k]; else raw[k] = v; }
  fs.writeFileSync(file, JSON.stringify(raw));
};

/** Run the REAL hook for row `id`, then move only the stamps named. A turn marker THIS run rewrote takes the
 *  hookstate's `updatedAt` as its `at` (and `stopAt`, when set); `mark` overrides either way. */
const hook = (id: string, sid: string, payload: Record<string, unknown>,
  hs: Record<string, unknown> = {}, mark: Record<string, unknown> = {}): void => {
  const turn = reg(`${id}.turn.json`);
  const turnBefore = fs.existsSync(turn) ? fs.readFileSync(turn, 'utf8') : null;
  execFileSync('bash', [HOOK], {
    input: JSON.stringify({ ...payload, session_id: sid, transcript_path: `/rig/fixhome/cfg/projects/-rig-repo/${sid}.jsonl` }),
    encoding: 'utf8',
    env: {
      ...process.env, HOME: home, FIXTURE_ID: id, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
      TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: sid, CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION,
    },
  });
  patch(reg(`${id}.hookstate.json`), hs);
  const rewrote = fs.existsSync(turn) && fs.readFileSync(turn, 'utf8') !== turnBefore;
  const stamps: Record<string, unknown> = {};
  if (rewrote && typeof hs['updatedAt'] === 'number') {
    stamps['at'] = hs['updatedAt'];
    if ((JSON.parse(fs.readFileSync(turn, 'utf8')) as Record<string, unknown>)['stopAt'] !== null) stamps['stopAt'] = hs['updatedAt'];
  }
  patch(turn, { ...stamps, ...mark });
};

/** Claude Code's live file, the key set `livestate.test.ts` builds. */
const live = (pid: number, sid: string, status: string, statusUpdatedAt: number,
  over: Record<string, unknown> = {}): void => {
  fs.writeFileSync(path.join(home, '.claude-lane-a', 'sessions', `${pid}.json`), JSON.stringify({
    pid, sessionId: sid, cwd: '/rig/repo', name: 'fixture', status, statusUpdatedAt,
    startedAt: NOW - 120 * MIN, version: '2.1.300', ...over,
  }));
};

const fiveKinds = (): Record<string, unknown> => JSON.parse(fs.readFileSync(FIVE_KINDS, 'utf8')) as Record<string, unknown>;
const stopWith = (tasks: unknown[]): Record<string, unknown> => ({ ...fiveKinds(), background_tasks: tasks });
const capturePayload = (name: string, event: string, pick: (p: Record<string, unknown>) => boolean = () => true) =>
  ({ ...CAPTURE(name).find((e) => e.event === event && pick(e.payload))!.payload });
const postCompact = (trigger: string): Record<string, unknown> =>
  ({ ...capturePayload('clear-compact-resume', 'PostCompact'), trigger });
const subagentStart = (agentId: string): Record<string, unknown> =>
  ({ ...capturePayload('agent-iso-bg', 'SubagentStart'), agent_id: agentId });
const sessionStartResume = (): Record<string, unknown> =>
  capturePayload('clear-compact-resume', 'SessionStart', (p) => p['source'] === 'resume');

/** A main transcript: Claude Code's row envelope, with a sentinel in every text it carries. */
const iso = (ms: number): string => new Date(ms).toISOString();
type Row = { at: number; kind: 'end' | 'tool' | 'result' | 'compact' | 'summary' | 'apierror' | 'side' };
const transcript = (sid: string, rows: Row[]): void => {
  const lines = rows.map((r, i) => {
    const base = { parentUuid: null, isSidechain: false, sessionId: sid, uuid: `r${i}`, timestamp: iso(r.at), cwd: '/rig/repo' };
    switch (r.kind) {
      case 'end': return { ...base, type: 'assistant', message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: SENTINEL }] } };
      case 'tool': return { ...base, type: 'assistant', message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: SENTINEL } }] } };
      case 'result': return { ...base, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: SENTINEL }] } };
      case 'compact': return { ...base, type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', compactMetadata: { trigger: 'manual', preTokens: 1 } };
      case 'summary': return { ...base, type: 'user', isCompactSummary: true, message: { role: 'user', content: SENTINEL } };
      case 'apierror': return { ...base, type: 'assistant', isApiErrorMessage: true, error: 'rate_limit', message: { role: 'assistant', stop_reason: 'stop_sequence', content: [{ type: 'text', text: SENTINEL }] } };
      case 'side': return { ...base, isSidechain: true, type: 'assistant', message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: SENTINEL }] } };
    }
  });
  fs.writeFileSync(path.join(home, '.claude-lane-a', 'projects', '-rig-repo', `${sid}.jsonl`),
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
};

const local = (ms: number): string => new Date(ms).toISOString().replace('T', ' ').slice(0, 19); // TZ=UTC in run()
const swapLog = (lines: [number, string][]): void => {
  fs.writeFileSync(reg('swap.log'), lines.map(([ms, l]) => `${local(ms)} ${l}`).join('\n') + '\n');
};
const journalFile = (recs: Record<string, unknown>[]): string => {
  const p = path.join(home, 'journal.json');
  fs.writeFileSync(p, recs.map((r) => JSON.stringify({ ...r, __REALTIME_TIMESTAMP: String(Math.round((r['at'] as number) * 1e6)), at: undefined })).join('\n') + '\n');
  return p;
};
const jEnd = (at: number, id: string) => ({ at, MESSAGE: `session ${id} ended; exiting for systemd restart`, _SYSTEMD_USER_UNIT: `claude-session@${id}.service` });
const jKill = (at: number, scope: string) => ({ at, USER_UNIT: `tmux-spawn-${scope}.scope`, MESSAGE: 'A process of this unit has been killed by the OOM killer.' });
const jFailed = (at: number, scope: string) => ({ at, USER_UNIT: `tmux-spawn-${scope}.scope`, MESSAGE: "tmux-spawn-x.scope: Failed with result 'oom-kill'.", UNIT_RESULT: 'oom-kill' });
const jStart = (at: number, id: string) => ({ at, USER_UNIT: `claude-session@${id}.service`, JOB_TYPE: 'start', JOB_RESULT: 'done', MESSAGE: 'Started claude-session.' });
const writeJson = (name: string, v: unknown): string => { const p = path.join(home, name); fs.writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v)); return p; };

// ── the second spellings ───────────────────────────────────────────────────────
describe('measure-working-state.py: its second spellings are bound to their homes', () => {
  const src = (): string => fs.readFileSync(SCRIPT, 'utf8');
  const tuple = (name: string): string[] => {
    const m = new RegExp(`^${name} = \\(([^)]*)\\)`, 'm').exec(src());
    expect(m, name).not.toBeNull();
    return m![1]!.split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean);
  };

  it('NON_DELEGATING is shared/api.ts’s NON_DELEGATING_TASK_KINDS (D-5231)', () => {
    expect(tuple('NON_DELEGATING')).toEqual([...NON_DELEGATING_TASK_KINDS]);
  });

  it('HOOKSTATE_FRESH_MS is hookstate.ts’s', () => {
    const m = /^HOOKSTATE_FRESH_MS = (\d+) \* (\d+) \* (\d+)$/m.exec(src());
    expect(m).not.toBeNull();
    expect(Number(m![1]) * Number(m![2]) * Number(m![3])).toBe(HOOKSTATE_FRESH_MS);
  });

  it('CARRIER_EVENTS is fleet.ts’s BACKGROUND_CARRIER_EVENTS (D-5272)', () => {
    const fleet = fs.readFileSync(path.join(ROOT, 'server', 'src', 'fleet.ts'), 'utf8');
    const m = /BACKGROUND_CARRIER_EVENTS: ReadonlySet<string> = new Set\(\[([^\]]*)\]\)/.exec(fleet);
    expect(m).not.toBeNull();
    expect(tuple('CARRIER_EVENTS')).toEqual(m![1]!.split(',').map((x) => x.trim().replace(/'/g, '')));
  });

  it('COVERS_DELEGATION_FROM is liveStatusCoversDelegation’s floor', () => {
    const [a, b, c] = tuple('COVERS_DELEGATION_FROM').map(Number) as [number, number, number];
    expect(liveStatusCoversDelegation(`${a}.${b}.${c}`)).toBe(true);
    expect(liveStatusCoversDelegation(`${a}.${b}.${c - 1}`)).toBe(false);
  });

  it('END_RE matches the line ccd writes, and the stall words are stall.ts’s', () => {
    expect(fs.readFileSync(CCD, 'utf8')).toContain('echo "session $id ended; exiting for systemd restart" >&2');
    expect(src()).toContain('END_RE = re.compile(r"^session (\\S+) ended; exiting for systemd restart$")');
    expect(src()).toContain(`STALL_CHECK_PREFIX = '${STALL_CHECK_PREFIX}'`);
    expect(src()).toContain(`STALL_REPORT_PREFIX = '${STALL_REPORT_PREFIX}'`);
    const stall = fs.readFileSync(path.join(ROOT, 'server', 'src', 'coord', 'stall.ts'), 'utf8');
    const sender = /^const STALL_SENDER = '([^']+)';$/m.exec(stall);
    expect(sender).not.toBeNull();
    expect(src()).toContain(`STALL_SENDER = '${sender![1]}'`);
  });

  // The displayed bucket the instrument counts is `sessionBucket`'s, fed as `fleet.ts` feeds it (an aged hookstate
  // is no hookstate; `background` only on a covering build, a carrier event and a `done`). Iterated over a matrix.
  it('shown_bucket agrees with sessionBucket on every non-attention case', () => {
    const cases: Record<string, unknown>[] = [];
    for (const status of ['busy', 'idle']) for (const since of [null, NOW - 10 * MIN]) for (const version of ['2.1.276', '2.1.300'])
      for (const hs of [null, ...['working', 'done'].flatMap((state) => ['Stop', 'SessionStart', 'SubagentStop', 'PostCompact', 'PostToolUse']
        .flatMap((event) => [NOW - 5 * MIN, NOW - 20 * MIN, NOW - 40 * MIN].flatMap((updatedAt) => [null, 0, 2]
          .map((bgDelegated) => ({ state, event, updatedAt, aliveAt: null, subagents: [], bgDelegated })))))])
        cases.push({ live: { status, since, startedAt: null, version }, hs });
    const py = spawnSync('python3', ['-c', [
      'import importlib.util, json, sys',
      `spec = importlib.util.spec_from_file_location("mws", ${JSON.stringify(SCRIPT)})`,
      'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
      'cases = json.load(sys.stdin)',
      `print(json.dumps([m.shown_bucket(c["live"], c["hs"], ${NOW}, True) for c in cases]))`,
    ].join('\n')], { input: JSON.stringify(cases), encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    expect(py.status, py.stderr).toBe(0);
    const got = JSON.parse(py.stdout) as string[];
    const want = cases.map((c) => {
      const l = c['live'] as { status: string; since: number | null; version: string };
      const h = c['hs'] as { state: 'working' | 'done'; event: string; updatedAt: number; bgDelegated: number | null } | null;
      const fresh = h !== null && NOW - h.updatedAt <= HOOKSTATE_FRESH_MS ? h : null;
      const background = fresh && fresh.state === 'done' && ['Stop', 'SubagentStart', 'SubagentStop'].includes(fresh.event)
        && fresh.bgDelegated !== null && liveStatusCoversDelegation(l.version) ? { count: fresh.bgDelegated, kinds: [] } : null;
      const s = { status: l.status, statusUpdatedAt: l.since, dialogPending: false, hookState: fresh?.state ?? null,
        archivedAt: null, pr: null, background } as unknown as FleetSession;
      return sessionBucket(s, fresh?.updatedAt ?? null, fresh?.event ?? null).bucket;
    });
    expect(cases.length, 'guards the guard: the matrix is not empty').toBeGreaterThan(200);
    expect(got).toEqual(want);
  });
});

// ── snapshot ───────────────────────────────────────────────────────────────────
describe('measure-working-state.py --section snapshot', () => {
  it('counts done-over-busy (with and without the D-5231 rung), the roster, PostCompact rows, idle ages and server-caps', () => {
    // A: delegated, written by today's hook (the pair) — working under D-5231, done before it.
    row('lane-a-project-a', sidOf(1));
    hook('lane-a-project-a', sidOf(1), fiveKinds(), { updatedAt: NOW - 1 * MIN });
    live(101, sidOf(1), 'busy', NOW - 10 * MIN);
    // B: delegated, the pre-D-5231 hook's key set (no pair) — done over busy under either server.
    row('lane-a-project-b', sidOf(2));
    hook('lane-a-project-b', sidOf(2), fiveKinds(), { updatedAt: NOW - 1 * MIN, bgDelegated: undefined, bgDelegatedKinds: undefined });
    live(102, sidOf(2), 'busy', NOW - 10 * MIN);
    // C: a Stop with only a shell left — D-75's wedge recovery, not delegation.
    row('project-a-quiet-basin', sidOf(3));
    hook('project-a-quiet-basin', sidOf(3), stopWith((fiveKinds()['background_tasks'] as Record<string, unknown>[])
      .filter((t) => t['type'] === 'shell')), { updatedAt: NOW - 2 * MIN });
    live(103, sidOf(3), 'busy', NOW - 10 * MIN);
    // D: idle with an aged working/PostCompact (auto), its last main event (a Stop) 3 h ago; no `crons` field.
    row('lane-b-project-d', sidOf(4));
    hook('lane-b-project-d', sidOf(4), stopWith([]), { updatedAt: NOW - 181 * MIN });
    hook('lane-b-project-d', sidOf(4), postCompact('auto'), { updatedAt: NOW - 180 * MIN });
    live(104, sidOf(4), 'idle', NOW - 179 * MIN);
    // E: idle with a fresh done/PostCompact (manual): a no-turn badge; last main event 7 h ago, a cron scheduled.
    row('lane-b-project-e', sidOf(5));
    hook('lane-b-project-e', sidOf(5), stopWith([]), { updatedAt: NOW - 420 * MIN });
    hook('lane-b-project-e', sidOf(5), postCompact('manual'), { updatedAt: NOW - 3 * MIN }, { crons: 1 });
    live(105, sidOf(5), 'idle', NOW - 10 * MIN);
    // F: two roster entries, one older than the live process; idle 25 h, nothing scheduled.
    row('lane-b-project-f', sidOf(6));
    hook('lane-b-project-f', sidOf(6), stopWith([]), { updatedAt: NOW - 1500 * MIN }, { crons: 0 });
    hook('lane-b-project-f', sidOf(6), subagentStart('a0000000000000001'));
    hook('lane-b-project-f', sidOf(6), subagentStart('a0000000000000002'));
    const f = JSON.parse(fs.readFileSync(reg('lane-b-project-f.hookstate.json'), 'utf8')) as { subagents: { startedAt: number }[] };
    expect(f.subagents.length, 'guards the guard: the real hook kept two entries').toBe(2);
    patch(reg('lane-b-project-f.hookstate.json'), {
      updatedAt: NOW - 1500 * MIN,
      subagents: [{ ...f.subagents[0], startedAt: NOW - 200 * MIN }, { ...f.subagents[1], startedAt: NOW - 60 * MIN }],
    });
    live(106, sidOf(6), 'idle', NOW - 1400 * MIN);
    // G: a registry row with no live file, and a torn live file.
    row('lane-b-project-g', sidOf(7));
    fs.writeFileSync(path.join(home, '.claude-lane-a', 'sessions', '199.json'), '{"sessionId":');
    fs.writeFileSync(reg('lane-b-project-g.hibernated'), '1');
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'server-caps'), `at ${NOW_S - 30}\ncaps dispatch-live-gate-v1 hook-main-state-v1\nend\n`);

    const s = json(['--section', 'snapshot'])['snapshot']!;
    expect(s).toMatchObject({
      rows: 7, live_sessions: 6, live_unreadable: 1, hookstate_files: 6,
      busy_sessions: 3,
      shown_done_while_busy: 2, shown_done_while_busy_delegated: 1,          // B, C; B delegated
      pre_d5231_done_while_busy: 3, pre_d5231_done_while_busy_delegated: 2, // A, B, C
      idle_working_postcompact: 1, compaction_done_badges: 1,
      roster_entries: 2, roster_files_with_entries: 1, roster_entries_older_than_process: 1, roster_files_with_stale: 1,
      idle_live_sessions: 3, idle_age_unknown: 0,
      idle_age_over_2h: 3, idle_age_over_4h: 2, idle_age_over_6h: 2, idle_age_over_12h: 1, idle_age_over_24h: 1,
      hold_scheduled: 1, hold_scheduled_unknown: 1,
      hibernated_markers: 1,
      server_caps: 'current', server_caps_age_s: 30, server_caps_words: ['dispatch-live-gate-v1', 'hook-main-state-v1'],
    });
  });

  it('server-caps: absent, incomplete (no end), stale past the 180 s lease', () => {
    expect(json(['--section', 'snapshot'])['snapshot']!['server_caps']).toBe('absent');
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'server-caps'), `at ${NOW_S - 30}\ncaps x\n`);
    expect(json(['--section', 'snapshot'])['snapshot']!['server_caps']).toBe('incomplete');
    fs.writeFileSync(path.join(home, '.ccrc', 'server-caps'), `at ${NOW_S - 181}\ncaps x\nend\n`);
    expect(json(['--section', 'snapshot'])['snapshot']!['server_caps']).toBe('stale');
  });

  it('a hookstate or marker naming another session is not this row’s', () => {
    row('lane-a-project-a', sidOf(1));
    hook('lane-a-project-a', sidOf(9), fiveKinds(), { updatedAt: NOW - 1 * MIN });
    live(101, sidOf(1), 'busy', NOW - 10 * MIN);
    const s = json(['--section', 'snapshot'])['snapshot']!;
    expect(s).toMatchObject({ hookstate_files: 0, pre_d5231_done_while_busy: 0 });
  });
});

// ── poll and samples ───────────────────────────────────────────────────────────
type Tick = { sid: string; busy: boolean; shown: string; pre: string; delegated: boolean; markdone: boolean; hook: unknown; hookfresh: boolean };
const tick = (over: Partial<Tick>): Tick =>
  ({ sid: 's', busy: false, shown: 'idle', pre: 'idle', delegated: false, markdone: false, hook: null, hookfresh: false, ...over });

describe('measure-working-state.py --section samples', () => {
  it('episodes per hour, delegation-caused, share of busy seconds, PostCompact badges and delegated ends', () => {
    const ticks = Array.from({ length: 10 }, (_, i) => {
      const rows: Tick[] = [];
      // s1: busy throughout; done over busy at 2-4 (delegated) and at 7 (not).
      const d1 = i >= 2 && i <= 4, d2 = i === 7;
      rows.push(tick({ sid: 's1', busy: true, shown: d1 || d2 ? 'done' : 'working', pre: d1 || d2 ? 'done' : 'working', delegated: d1 }));
      // s2: idle, one fresh done/PostCompact write seen at every tick: one badge.
      rows.push(tick({ sid: 's2', hook: ['done', 'PostCompact', NOW - MIN], hookfresh: true, shown: 'done', pre: 'done' }));
      // s3: delegated busy 0-4, shown working (D-5231), done before it; idle from 5 with the hookstate aged out. The
      // marker still lists the delegated work after the live file goes idle (it changes only on main events), so
      // only the busy->idle EDGE is an end, never each idle tick after it.
      rows.push(i <= 4 ? tick({ sid: 's3', busy: true, shown: 'working', pre: 'done', delegated: true, markdone: true })
        : tick({ sid: 's3', markdone: true, delegated: true }));
      // s4: delegated busy 0-2; idle from 3 and shown done.
      rows.push(i <= 2 ? tick({ sid: 's4', busy: true, shown: 'working', pre: 'working', delegated: true, markdone: true })
        : tick({ sid: 's4', markdone: true, delegated: true, shown: 'done', pre: 'done' }));
      return { t: NOW + i * 2000, rows };
    });
    const p = writeJson('samples.jsonl', ticks.map((t) => JSON.stringify(t)).join('\n') + '\n');
    const s = json(['--section', 'samples', '--samples', p])['samples']!;
    expect(s).toMatchObject({
      samples: 10, sessions: 4, span_s: 20, busy_session_seconds: 36,
      done_while_busy_episodes: 2, done_while_busy_episodes_delegated: 1, done_while_busy_seconds: 8,
      done_while_busy_episodes_per_hour: 360, done_while_busy_share_of_busy: 0.2222,
      pre_d5231_done_while_busy_episodes: 3, pre_d5231_done_while_busy_episodes_delegated: 2, pre_d5231_done_while_busy_seconds: 18,
      compaction_done_badges: 1,
      delegated_ends_with_done: 1, delegated_ends_with_no_done: 1,
    });
  });

  it('--poll writes digests, never ids, refuses an existing --out, and its file is a samples input', () => {
    row('lane-a-project-a', sidOf(1));
    hook('lane-a-project-a', sidOf(1), fiveKinds(), { updatedAt: Date.now() - MIN, bgDelegated: undefined, bgDelegatedKinds: undefined });
    live(101, sidOf(1), 'busy', Date.now() - 10 * MIN);
    const out = path.join(home, 'poll.jsonl');
    const r = run(['--poll', '2', '--interval', '0', '--out', out]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('samples_written: 2');
    const body = fs.readFileSync(out, 'utf8');
    expect(body).not.toContain('lane-a-project-a');
    expect(body).not.toContain(sidOf(1));
    const lines = body.trim().split('\n').map((l) => JSON.parse(l) as { rows: Tick[] });
    expect(lines).toHaveLength(2);
    expect(lines[0]!.rows[0]).toMatchObject({ busy: true, shown: 'done', pre: 'done', delegated: true });
    expect(lines[0]!.rows[0]!.sid).toMatch(/^[0-9a-f]{16}$/);
    const again = run(['--poll', '1', '--interval', '0', '--out', out]);
    expect(again.status).not.toBe(0);
    expect(fs.readFileSync(out, 'utf8')).toBe(body);
    const s = json(['--section', 'samples', '--samples', out])['samples']!;
    expect(s).toMatchObject({ samples: 2, done_while_busy_episodes: 1, done_while_busy_episodes_delegated: 1 });
  });
});

// ── pushes ─────────────────────────────────────────────────────────────────────
describe('measure-working-state.py --section pushes', () => {
  it('classifies every Finished push: turn end, compaction-only, mid-turn, restart, overload, uncertain, unclassifiable', () => {
    const T = NOW - 600 * MIN;
    const events: Record<string, unknown>[] = [];
    const push = (id: string, at: number) => events.push({ seq: events.length + 1, at, kind: 'done', sessionId: id, title: '✓ Finished', body: 'Finished — back to idle', runId: null });
    const sess = (n: number, id: string, rows: Row[]) => { row(id, sidOf(n)); transcript(sidOf(n), rows); };
    sess(1, 'p-turn', [{ at: T - 60_000, kind: 'tool' }, { at: T - 10_000, kind: 'end' }, { at: T - 5_000, kind: 'side' }]);
    push('p-turn', T);
    sess(2, 'p-compact', [{ at: T - 30_000, kind: 'end' }, { at: T + 600_000 - 20_000, kind: 'compact' }, { at: T + 600_000 - 19_000, kind: 'summary' }]);
    push('p-compact', T + 600_000);
    sess(3, 'p-mid', [{ at: T + 1_200_000 - 5_000, kind: 'tool' }, { at: T + 1_200_000 - 3_000, kind: 'result' }, { at: T + 1_200_000 + 30_000, kind: 'tool' }]);
    push('p-mid', T + 1_200_000);
    sess(4, 'p-restart', [{ at: T + 1_800_000 - 50_000, kind: 'tool' }]);
    push('p-restart', T + 1_800_000);
    const C = T + 2_400_000;                       // the overload cluster: five sessions inside 3 s
    for (let i = 0; i < 4; i++) { sess(10 + i, `p-over-${i}`, [{ at: C - 40_000, kind: 'tool' }]); push(`p-over-${i}`, C + i * 500); }
    sess(14, 'p-over-real', [{ at: C - 2_000, kind: 'end' }]);
    push('p-over-real', C + 1_000);
    row('p-none', sidOf(20));                      // a row with no transcript
    push('p-none', T + 3_000_000);
    sess(21, 'p-unsure', [{ at: T + 3_600_000 - 50_000, kind: 'tool' }]);
    push('p-unsure', T + 3_600_000);
    sess(22, 'p-api', [{ at: T + 4_200_000 - 4_000, kind: 'apierror' }]);   // a turn ended by an API error is a turn end
    push('p-api', T + 4_200_000);
    push('p-turn', T - 3 * 86_400_000);            // outside the window
    events.push({ seq: 99, at: T, kind: 'mail', sessionId: 'p-turn', title: SENTINEL_SUBJECT, body: SENTINEL_SUBJECT, runId: null });
    const feed = writeJson('feed.json', { events });
    const j = journalFile([jEnd((T + 1_800_000 - 20_000) / 1000, 'p-restart')]);
    const since = local(T - 86_400_000), until = local(T + 86_400_000);
    const r = run(['--section', 'pushes', '--feed', feed, '--journal', j, '--since', since, '--until', until, '--json']);
    expect(r.status, r.stderr).toBe(0);
    const s = (JSON.parse(r.stdout) as Record<string, Record<string, unknown>>)['pushes']!;
    expect(s).toMatchObject({
      finished_pushes: 12, push_turn_end: 3, push_compaction_only: 1, push_mid_turn: 1, push_restart: 1,
      push_overload: 4, push_uncertain: 1, push_unclassifiable: 1,
      push_false: 7, push_classifiable: 10, push_false_share: 0.7, push_false_per_day: 3.5,
      push_restart_rule: 'journal read',
    });
    for (const leak of [SENTINEL, SENTINEL_SUBJECT, 'p-turn', 'p-over', sidOf(1), home]) expect(r.stdout).not.toContain(leak);
  });
});

// ── deaths, re-drives and spawn latency ────────────────────────────────────────
describe('measure-working-state.py --section deaths / spawn', () => {
  it('session ends per day, OOM-associated by signature, kills after a restart, and re-drive loops', () => {
    const D0 = Date.UTC(2026, 9, 10, 0, 0, 0);
    const s = (ms: number): number => ms / 1000;
    const e1 = D0 + 3_600_000, e2 = D0 + 7_200_000, e3 = D0 + 10_800_000, e4 = D0 + 86_400_000 + 3_600_000;
    const j = journalFile([
      jKill(s(e1 - 5_000), 'p1'), jFailed(s(e1 - 4_000), 'p1'), jEnd(s(e1), 'lane-a-project-a'),
      jKill(s(e1 + 60_000), 'p5'),                                   // inside 120 s after a restart
      jKill(s(e2 - 10_000), 'p2'), jEnd(s(e2), 'lane-a-project-b'),  // OOM-associated, no Failed line
      jKill(s(e3 - 30_000), 'p3'), jEnd(s(e3), 'lane-a-project-a'),  // the kill is 30 s earlier: not associated
      jEnd(s(e4), 'project-a-quiet-basin'),
      jEnd(s(D0 - 86_400_000), 'lane-a-project-a'),                  // outside the window
      { at: s(e2 + 5_000), MESSAGE: SENTINEL, _SYSTEMD_USER_UNIT: 'claude-session@lane-a-project-a.service' },
    ]);
    swapLog([
      [e1 - 300_000, 'redrive lane-a-project-a: the transcript’s newest turn is the unsubmitted resume pair after 20s; typing the prompt [wrapper=lane-a]'],
      [e4 + 3_600_000, 'redrive project-a-quiet-basin: the transcript’s newest turn is the unsubmitted resume pair after 20s; typing the prompt [wrapper=lane-a]'],
    ]);
    const r = run(['--section', 'deaths', '--journal', j, '--since', '2026-10-10', '--until', '2026-10-12', '--json']);
    expect(r.status, r.stderr).toBe(0);
    const d = (JSON.parse(r.stdout) as Record<string, Record<string, unknown>>)['deaths']!;
    expect(d).toMatchObject({
      session_ends: 4, session_ends_per_day: 2, session_ends_by_day: { '2026-10-10': 3, '2026-10-11': 1 },
      oom_associated: 2, oom_associated_failed_line: 1, oom_associated_no_failed_line: 1,
      pane_scope_oom_kills: 4, oom_kills_within_120s_after_a_restart: 1,
      redrives: 2, redrives_followed_by_an_end_within_10m: 1,
    });
    for (const leak of [SENTINEL, 'lane-a-project', 'quiet-basin']) expect(r.stdout).not.toContain(leak);
  });

  it('pane come-up: the claude-session unit’s start to the turn marker’s restartAt, p50/p95/max', () => {
    const R = NOW - 60 * MIN;
    ([[1, 'lane-a-project-a'], [2, 'lane-a-project-b'], [3, 'project-a-quiet-basin']] as const).forEach(([n, id]) => {
      row(id, sidOf(n));
      hook(id, sidOf(n), sessionStartResume(), { updatedAt: R }, { restartAt: R });
      expect(fs.existsSync(reg(`${id}.turn.json`)), 'guards the guard: SessionStart wrote the marker').toBe(true);
    });
    const j = journalFile([
      jStart((R - 3_000) / 1000, 'lane-a-project-a'), jStart((R - 4_200) / 1000, 'lane-a-project-b'),
      jStart((R - 600_000) / 1000, 'project-a-quiet-basin'), jStart((R - 9_000) / 1000, 'project-a-quiet-basin'),
    ]);
    const s = json(['--section', 'spawn', '--journal', j])['spawn']!;
    expect(s).toMatchObject({ restarts_measured: 3, unit_start_to_restartAt_p50_s: 4.2,
      unit_start_to_restartAt_p95_s: 9, unit_start_to_restartAt_max_s: 9 });
  });
});

// ── swaps ──────────────────────────────────────────────────────────────────────
describe('measure-working-state.py --section swaps', () => {
  it('swap acts by kind, those that cut output (an API error is not output), and refusals by reason', () => {
    const T = NOW - 100 * MIN;
    const act = (n: number, id: string, at: number): [number, string] => [at, `swap ${id}: lane-a -> lane-b (uuid ${sidOf(n)})`];
    transcript(sidOf(1), [{ at: T + 50_000, kind: 'tool' }]);          // auto-home, output 10 s before: cut
    transcript(sidOf(2), [{ at: T - 100_000, kind: 'end' }]);         // auto-home, quiet: not cut
    transcript(sidOf(3), [{ at: T + 3_000, kind: 'apierror' }]);      // rescue over an API error: not cut
    transcript(sidOf(4), [{ at: T - 5_000, kind: 'tool' }]);          // rescue, output: cut
    transcript(sidOf(5), [{ at: T - 1_000, kind: 'end' }]);           // manual, output: cut
    swapLog([
      [T, 'auto-home lane-a-project-a: lane-a -> lane-b [home=lane-b]'], act(1, 'lane-a-project-a', T + 60_000),
      [T, 'auto-home lane-a-project-b: lane-a -> lane-b [home=lane-b]'], act(2, 'lane-a-project-b', T + 30_000),
      [T, 'auto-rescue lane-b-project-c: lane-a (blocked) -> lane-b [home=lane-a]'], act(3, 'lane-b-project-c', T + 5_000),
      [T - 20_000, 'auto-rescue lane-b-project-d: lane-a (blocked) -> lane-b [home=lane-a]'], act(4, 'lane-b-project-d', T),
      act(5, 'lane-b-project-e', T),
      [T - 400_000, 'auto-home lane-b-project-f: lane-a -> lane-b [home=lane-b]'], act(6, 'lane-b-project-f', T),
      [T, 'swap-refused lane-b-project-e: lane-a -> lane-b (session-busy)'],
      [T, 'swap-refused lane-b-project-f: lane-a -> lane-b (session-busy)'],
      [T, 'swap-refused lane-b-project-f: lane-a -> lane-b (status-unknown)'],
      act(1, 'lane-a-project-a', T - 30 * 86_400_000),                // outside the window
    ]);
    const s = json(['--section', 'swaps', '--since', local(T - 86_400_000), '--until', local(T + 86_400_000)])['swaps']!;
    expect(s).toMatchObject({
      'swaps_auto-home': 2, 'swaps_auto-home_cut_output': 1, 'swaps_auto-home_no_transcript': 0,
      swaps_rescue: 2, swaps_rescue_cut_output: 1,
      swaps_manual: 2, swaps_manual_cut_output: 1, swaps_manual_no_transcript: 1,
      'swaps_auto-pool': 0,
      swap_refusals_by_reason: { 'session-busy': 2, 'status-unknown': 1 },
    });
  });
});

// ── interrupts and stall notices ───────────────────────────────────────────────
describe('measure-working-state.py --section interrupts / stall', () => {
  it('interrupt events by source (an unknown word is unknown) and swap.log Escapes', () => {
    const ev = (at: number, body: string) => ({ seq: at, at, kind: 'interrupt', sessionId: 'lane-a-project-a', title: 'interrupt', body, runId: null });
    const feed = writeJson('feed.json', { events: [ev(NOW - MIN, 'escape-key sent'), ev(NOW - 2 * MIN, 'deny sent'),
      ev(NOW - 3 * MIN, 'deny sent'), ev(NOW - 4 * MIN, 'teleport sent'), ev(NOW - 40 * 86_400_000, 'keycap sent')] });
    swapLog([[NOW - MIN, 'escape lane-a-project-a: pane %1'], [NOW - 2 * MIN, 'escape lane-a-project-a: pane %1'],
      [NOW - 3 * MIN, 'swap lane-a-project-a: lane-a -> lane-b (uuid x)']]);
    const s = json(['--section', 'interrupts', '--feed', feed, '--since', local(NOW - 86_400_000)])['interrupts']!;
    expect(s).toMatchObject({ interrupt_events: 4, swaplog_escapes: 2,
      interrupt_events_by_source: { keycap: 0, 'escape-key': 1, deny: 2, 'drawer-escape': 0, 'drawer-ctrl-c': 0, unknown: 1 } });
  });

  it('stall notices by kind, deduplicated across mailboxes, from the stall sender only', () => {
    const m = (id: number, toId: string, at: number, subject: string, fromId = 'operator') =>
      ({ id, deliveryId: id * 10 + toId.length, at, fromId, toId, runId: 3, kind: 'status', subject, state: 'delivered' });
    const a = { ok: true, mail: [
      m(1, 'lane-a-project-a', NOW - MIN, `${STALL_CHECK_PREFIX} run 3 — quiet 20m, owed: a report`),
      m(2, 'lane-a-project-a', NOW - 2 * MIN, `${STALL_REPORT_PREFIX} run 3 — frozen: no hook event for 12m`),
      m(3, 'lane-a-project-a', NOW - 3 * MIN, `${STALL_REPORT_PREFIX} run 3 — worker silent 30m, stall-check unanswered`),
      m(4, 'lane-a-project-a', NOW - 4 * MIN, `${STALL_CHECK_PREFIX} ${SENTINEL_SUBJECT}`, 'lane-b-project-b'),
    ] };
    const b = { ok: true, mail: [a.mail[0], m(5, 'lane-b-project-b', NOW - 40 * 86_400_000, `${STALL_CHECK_PREFIX} old`)] };
    const mail = writeJson('mail.jsonl', `${JSON.stringify(a)}\n${JSON.stringify(b)}\n`);
    const r = run(['--section', 'stall', '--mail', mail, '--since', local(NOW - 86_400_000), '--json']);
    expect(r.status, r.stderr).toBe(0);
    const s = (JSON.parse(r.stdout) as Record<string, Record<string, unknown>>)['stall']!;
    expect(s).toMatchObject({ stall_notices: 3, stall_notices_by_kind: { check: 1, stall: 1, frozen: 1, dead: 0, failed: 0 } });
    expect(r.stdout).not.toContain(SENTINEL_SUBJECT);
  });
});

// ── read-only, and no text leaves ──────────────────────────────────────────────
describe('measure-working-state.py: read-only, and nothing but counts leaves', () => {
  it('a full run over a populated HOME changes no byte and prints no id, uuid, path or text', () => {
    row('lane-a-project-a', sidOf(1));
    hook('lane-a-project-a', sidOf(1), fiveKinds(), { updatedAt: NOW - MIN });
    live(101, sidOf(1), 'busy', NOW - 10 * MIN);
    transcript(sidOf(1), [{ at: NOW - MIN - 10_000, kind: 'end' }]);
    swapLog([[NOW - MIN, `swap lane-a-project-a: lane-a -> lane-b (uuid ${sidOf(1)})`]]);
    const feed = writeJson('feed.json', { events: [{ seq: 1, at: NOW - MIN, kind: 'done', sessionId: 'lane-a-project-a', title: SENTINEL_SUBJECT, body: SENTINEL_SUBJECT, runId: null }] });
    const j = journalFile([jEnd((NOW - MIN) / 1000, 'lane-a-project-a')]);
    const mail = writeJson('mail.json', { ok: true, mail: [{ id: 1, at: NOW - MIN, fromId: 'operator', toId: 'lane-a-project-a', subject: `${STALL_CHECK_PREFIX} ${SENTINEL_SUBJECT}` }] });
    const snap = (): string => execFileSync('bash', ['-c', 'cd "$1" && find . -type f -print0 | sort -z | xargs -0 shasum && find . -printf "%p %T@\\n" 2>/dev/null | sort || find . -exec stat -f "%N %m" {} + | sort', '_', home], { encoding: 'utf8' });
    const before = snap();
    const r = run(['--feed', feed, '--journal', j, '--mail', mail]);
    expect(r.status, r.stderr).toBe(0);
    for (const sec of ['snapshot', 'pushes', 'deaths', 'swaps', 'interrupts', 'stall', 'spawn']) expect(r.stdout).toContain(`== ${sec}\n`);
    expect(snap()).toBe(before);
    for (const leak of [SENTINEL, SENTINEL_SUBJECT, 'lane-a-project-a', sidOf(1), home, '/rig/repo']) expect(r.stdout).not.toContain(leak);
    expect(r.stdout).toMatch(/^swaps_manual_cut_output: 1$/m);
  });

  // With no export given, the journal and the server are read by their read-only commands, and only those: a fake
  // `journalctl` that refuses `-g` (a build without pcre2) and a fake `ccrc-api` record every argument vector.
  it('live reads: journalctl --user (bounded, -g then without), ccrc-api feed list and mail list, nothing else', () => {
    const bin = path.join(home, 'fake');
    fs.mkdirSync(bin);
    const log = path.join(home, 'calls.log');
    const endRec = JSON.stringify({ __REALTIME_TIMESTAMP: String((NOW - MIN) * 1000), MESSAGE: 'session lane-a-project-a ended; exiting for systemd restart' });
    fs.writeFileSync(path.join(bin, 'journalctl'), `#!/bin/sh\necho "journalctl $*" >> "${log}"\n` +
      `for a in "$@"; do case "$a" in -g*) exit 1;; esac; done\necho '${endRec}'\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'ccrc-api'), `#!/bin/sh\necho "ccrc-api $*" >> "${log}"\n` +
      `case "$1" in feed) echo '{"events":[]}';; mail) echo '{"ok":true,"mail":[]}';; esac\n`, { mode: 0o755 });
    row('lane-a-project-a', sidOf(1));
    const r = spawnSync('python3', [SCRIPT, '--home', home, '--now', String(NOW_S), '--json',
      '--section', 'deaths', '--section', 'pushes', '--section', 'stall'], {
      encoding: 'utf8', env: { ...process.env, TZ: 'UTC', PATH: `${bin}:/usr/bin:/bin`, PYTHONDONTWRITEBYTECODE: '1' } });
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as Record<string, Record<string, unknown>>;
    expect(out['deaths']).toMatchObject({ session_ends: 1 });
    expect(out['pushes']).toMatchObject({ finished_pushes: 0 });
    expect(out['stall']).toMatchObject({ stall_notices: 0 });
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n');
    const since = `--since=@${NOW_S - 8 * 86_400}`;
    const fields = '--output-fields=MESSAGE,USER_UNIT,_SYSTEMD_USER_UNIT,UNIT_RESULT,JOB_TYPE,JOB_RESULT';
    expect(calls).toEqual([
      `journalctl --user --no-pager -o json ${fields} ${since} -gexiting for systemd restart|killed by the OOM killer|oom-kill|claude-session@`,
      `journalctl --user --no-pager -o json ${fields} ${since}`,
      'ccrc-api feed list --limit 100000',
      'ccrc-api mail list --to lane-a-project-a --all 1 --limit 5000',
    ]);
  });

  it('runs no tmux: a tmux on PATH that records its calls is never called', () => {
    const bin = path.join(home, 'trap');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'tmux'), `#!/bin/sh\necho called >> "${path.join(home, 'tmux-called')}"\n`, { mode: 0o755 });
    row('lane-a-project-a', sidOf(1));
    live(101, sidOf(1), 'busy', NOW - 10 * MIN);
    const r = spawnSync('python3', [SCRIPT, '--home', home, '--now', String(NOW_S), '--section', 'snapshot'], {
      encoding: 'utf8', env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, PYTHONDONTWRITEBYTECODE: '1' } });
    expect(r.status, r.stderr).toBe(0);
    expect(fs.existsSync(path.join(home, 'tmux-called'))).toBe(false);
    expect(fs.readFileSync(SCRIPT, 'utf8')).not.toMatch(/["']tmux["']/);
  });
});
