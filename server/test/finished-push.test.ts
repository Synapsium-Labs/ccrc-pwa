import { describe, it, expect } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import { FleetWatcher } from '../src/watch.js';
import type { PushPayload } from '../src/push.js';
import { finishedAfter, type FinishedHookFact } from '../src/coord/finished.js';
import type { TurnMark, TurnMarkRead } from '../src/coord/stall.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

/**
 * D-5233 (`finished-needs-a-main-stop`, spec §5.3): the "✓ Finished" push at a live busy→idle edge needs a main-thread
 * Stop inside that busy episode. The episode starts at the busy row's `statusUpdatedAt`; the evidence is the turn
 * marker (`ok`, `done`, `stopAt` not before `turnAt`, `stopAt` at or after the episode start less 2 s); an `absent`
 * marker falls back to a hookstate `done` from a `Stop` in the episode. Every other marker reading pushes nothing.
 *
 * The pure rule first, then the same cases through the watcher (a fake tick pair: busy at T0, idle at T2).
 */

const SEC = 1000;
const T0 = 1_800_000_000_000;
const UUID = '00000000-0000-4000-8000-000000000001';

const okMark = (over: Partial<TurnMark> = {}): TurnMarkRead => ({
  crons: null,
  ok: true, sessionId: UUID, state: 'done', event: 'Stop', at: T0 + SEC, turnAt: T0 + SEC / 2, stopAt: T0 + SEC,
  bg: 0, bgKinds: [], bgIds: [], err: null, restartAt: null, lostBg: 0, lostKinds: [], lostIds: [], graceUntil: null,
  ...over,
});
const unread = (reason: 'absent' | 'unmeasured' | 'malformed' | 'foreign' | 'stale'): TurnMarkRead => ({ ok: false, reason });
const hook = (event: string | null, updatedAt: number, state = 'done'): FinishedHookFact => ({ state, event, updatedAt });

describe('finishedAfter — the pure rule (D-5233)', () => {
  it('(a) a done marker whose Stop falls inside the episode pushes', () => {
    expect(finishedAfter(okMark(), null, T0)).toBe(true);
  });

  it('(a) a Stop within the 2 s slack before the episode start still pushes; one just past it does not', () => {
    expect(finishedAfter(okMark({ turnAt: T0 - 3 * SEC, stopAt: T0 - 2 * SEC, at: T0 - 2 * SEC }), null, T0)).toBe(true);
    expect(finishedAfter(okMark({ turnAt: T0 - 3 * SEC, stopAt: T0 - 2 * SEC - 1, at: T0 - 2 * SEC - 1 }), null, T0)).toBe(false);
  });

  it('(b) a compaction-only stretch: the last Stop predates the episode, no push', () => {
    expect(finishedAfter(okMark({ turnAt: T0 - 60 * SEC, stopAt: T0 - 30 * SEC, at: T0 + SEC, event: 'PostCompact' }), null, T0))
      .toBe(false);
  });

  it('(c) an Escape-ended turn: marker working, the turn newer than the last Stop, no push', () => {
    expect(finishedAfter(okMark({ state: 'working', event: 'UserPromptSubmit', turnAt: T0 + 5 * SEC, stopAt: T0 + SEC }), null, T0))
      .toBe(false);
  });

  it('(c) a done marker whose turn is newer than its Stop is not a finished turn', () => {
    expect(finishedAfter(okMark({ turnAt: T0 + 5 * SEC, stopAt: T0 + SEC }), null, T0)).toBe(false);
  });

  it('a done marker with no Stop stamp pushes nothing', () => {
    expect(finishedAfter(okMark({ stopAt: null }), null, T0)).toBe(false);
  });

  it('(d) a stale marker (a restart) pushes nothing, whatever the hookstate says', () => {
    expect(finishedAfter(unread('stale'), hook('Stop', T0 + SEC), T0)).toBe(false);
  });

  it('(e) unmeasured, malformed and foreign markers push nothing, whatever the hookstate says', () => {
    for (const r of ['unmeasured', 'malformed', 'foreign'] as const) {
      expect(finishedAfter(unread(r), hook('Stop', T0 + SEC), T0), r).toBe(false);
    }
  });

  it('(f) an absent marker falls back to a hookstate done from a Stop in the episode', () => {
    expect(finishedAfter(unread('absent'), hook('Stop', T0 + SEC), T0)).toBe(true);
  });

  it('(f) an absent marker with a hookstate done from a compaction pushes nothing', () => {
    expect(finishedAfter(unread('absent'), hook('PostCompact', T0 + SEC), T0)).toBe(false);
  });

  it('(f) an absent marker with a hookstate Stop from before the episode, or a working state, pushes nothing', () => {
    expect(finishedAfter(unread('absent'), hook('Stop', T0 - SEC), T0)).toBe(false);
    expect(finishedAfter(unread('absent'), hook('Stop', T0 + SEC, 'working'), T0)).toBe(false);
  });

  it('(f) an absent marker and no hookstate read at all keep the old behaviour (absent means old): push', () => {
    expect(finishedAfter(unread('absent'), null, T0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Through the watcher. Harness shape copied from `push-copy.test.ts` (one session, a live-status file the tests flip
// busy→idle, a tmux runner that answers that session's pid), plus the turn marker and the hookstate under test.

const ID = 'lane-a-project-a';
const PROJECT = 'project-a';
const PID = 41001;

interface Fixture {
  tick: () => Promise<void>;
  sent: PushPayload[];
  /** Rewrite the live file: `status` stamped at `at`, the process started at `startedAt`. */
  live: (status: 'busy' | 'idle', at: number, startedAt?: number) => void;
  /** Remove the live file: the read is `no-state` (an older build, or one that has not published yet). */
  noLive: () => void;
  mark: (fields: Record<string, unknown>) => void;
  markRaw: (content: string) => void;
  markUnreadable: () => void;
  hookstate: (state: string, event: string, updatedAt: number) => void;
}

function fixture(busyAt: number, startedAt: number): Fixture {
  const home = mkTmp('ccrc-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const cfgDir = path.join(home, '.claude');
  mkdirSync(path.join(cfgDir, 'sessions'), { recursive: true });
  const fields: Record<string, string> = { wrapper: 'claude', project: PROJECT, workdir: `/w/${ID}`, uuid: UUID, started: '1' };
  for (const [f, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${ID}.${f}`), v);
  let procStart = startedAt;
  const live = (status: 'busy' | 'idle', at: number, started?: number): void => {
    if (started !== undefined) procStart = started;
    writeFileSync(path.join(cfgDir, 'sessions', `${PID}.json`), JSON.stringify({
      pid: PID, sessionId: UUID, cwd: '/d', status, statusUpdatedAt: at, startedAt: procStart,
    }));
  };
  live('busy', busyAt);
  const noLive = (): void => rmSync(path.join(cfgDir, 'sessions', `${PID}.json`));
  const runner: Runner = async (_cmd, args) => {
    if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') return { code: 0, stdout: `${PID}\n`, stderr: '' };
    if (args[0] === 'capture-pane') return { code: 0, stdout: 'ready\n❯ \n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const sent: PushPayload[] = [];
  const push = { notify: async (p: PushPayload) => { sent.push(p); } };
  const w = new FleetWatcher({ ...testDeps(home, runner), push: push as never }, new Bus(), 10_000,
    path.join(home, 'state-cache.json'));
  const markPath = path.join(reg, `${ID}.turn.json`);
  return {
    tick: () => w.tick(),
    sent,
    live,
    noLive,
    mark: (over) => writeFileSync(markPath, JSON.stringify({
      v: 1, sessionId: UUID, state: 'done', event: 'Stop', at: busyAt + SEC, turnAt: busyAt + SEC / 2, stopAt: busyAt + SEC,
      bg: 0, bgKinds: '', bgIds: '', err: null, restartAt: null, lostBg: 0, lostKinds: '', lostIds: '', ...over,
    })),
    markRaw: (content) => writeFileSync(markPath, content),
    // A directory where the marker belongs: the read fails with something other than ENOENT, so it is `unmeasured`.
    markUnreadable: () => mkdirSync(markPath),
    hookstate: (state, event, updatedAt) => writeFileSync(path.join(reg, `${ID}.hookstate.json`), JSON.stringify({
      v: 1, state, event, sessionId: UUID, pid: 1, updatedAt, ask: null, subagents: [],
    })),
  };
}

const finished = (sent: readonly PushPayload[]): PushPayload[] => sent.filter((p) => p.title.startsWith('✓ Finished'));

describe('the watcher pushes Finished only when a main Stop falls inside the busy episode (D-5233)', () => {
  // T0 is the busy write, a minute ago; T2 is now. Wall-clock stamps: the hookstate reader ages a file out by them.
  const setup = (): { f: Fixture; t0: number } => {
    const t0 = Date.now() - 60 * SEC;
    return { f: fixture(t0, t0 - 600 * SEC), t0 };
  };

  it('(a) a done marker whose Stop falls inside the episode pushes once', async () => {
    const { f, t0 } = setup();
    await f.tick();                                    // priming: busy since T0
    f.mark({ turnAt: t0 + SEC, stopAt: t0 + 2 * SEC, at: t0 + 2 * SEC });
    f.live('idle', Date.now());
    await f.tick();
    expect(finished(f.sent)).toHaveLength(1);
  });

  it('(b) a compaction-only stretch (the last Stop predates the episode) pushes nothing', async () => {
    const { f, t0 } = setup();
    f.mark({ turnAt: t0 - 120 * SEC, stopAt: t0 - 90 * SEC, at: t0 + SEC, event: 'PostCompact' });
    await f.tick();
    f.live('idle', Date.now());
    await f.tick();
    expect(finished(f.sent)).toHaveLength(0);
  });

  it('(c) an Escape-ended turn (marker working, its turn newer than the last Stop) pushes nothing', async () => {
    const { f, t0 } = setup();
    f.mark({ state: 'working', event: 'UserPromptSubmit', turnAt: t0 + SEC, stopAt: t0 - 30 * SEC, at: t0 + SEC });
    await f.tick();
    f.live('idle', Date.now());
    await f.tick();
    expect(finished(f.sent)).toHaveLength(0);
  });

  it('(d) a restart (the marker is stale against the new process) pushes nothing', async () => {
    const { f, t0 } = setup();
    f.mark({ turnAt: t0 + SEC, stopAt: t0 + 2 * SEC, at: t0 + 2 * SEC });
    await f.tick();
    f.live('idle', Date.now(), t0 + 10 * SEC);         // a new process, started after the marker's last write
    await f.tick();
    expect(finished(f.sent)).toHaveLength(0);
  });

  it('(e) an unmeasured, malformed or foreign marker pushes nothing, even beside a hookstate Stop', async () => {
    const cases: [string, (f: Fixture) => void][] = [
      ['unmeasured', (f) => f.markUnreadable()],
      ['malformed', (f) => f.markRaw('not json')],
      ['foreign', (f) => f.mark({ sessionId: '00000000-0000-4000-8000-000000000002' })],
    ];
    for (const [name, seed] of cases) {
      const { f, t0 } = setup();
      seed(f);
      f.hookstate('done', 'Stop', t0 + 2 * SEC);
      await f.tick();
      f.live('idle', Date.now());
      await f.tick();
      expect(finished(f.sent), name).toHaveLength(0);
    }
  });

  it('(f) an absent marker falls back to the hookstate: done from a Stop in the episode pushes', async () => {
    const { f, t0 } = setup();
    await f.tick();
    f.hookstate('done', 'Stop', t0 + 2 * SEC);
    f.live('idle', Date.now());
    await f.tick();
    expect(finished(f.sent)).toHaveLength(1);
  });

  it('(f) an absent marker beside a hookstate done from a PostCompact pushes nothing', async () => {
    const { f, t0 } = setup();
    await f.tick();
    f.hookstate('done', 'PostCompact', t0 + 2 * SEC);
    f.live('idle', Date.now());
    await f.tick();
    expect(finished(f.sent)).toHaveLength(0);
  });

  it('(f) no live file at the edge (`no-state`): an absent marker still reaches the hookstate fallback and pushes', async () => {
    const { f, t0 } = setup();
    await f.tick();
    f.hookstate('done', 'Stop', t0 + 2 * SEC);
    f.noLive();
    await f.tick();
    expect(finished(f.sent)).toHaveLength(1);
  });

  it('(d) no live file at the edge: a readable marker cannot be judged against a process start, so no push', async () => {
    const { f, t0 } = setup();
    await f.tick();
    f.mark({ turnAt: t0 + SEC, stopAt: t0 + 2 * SEC, at: t0 + 2 * SEC });
    f.noLive();
    await f.tick();
    expect(finished(f.sent)).toHaveLength(0);
  });

  it('(g) delegated work: busy since T0, the Stop at T1, idle at T3 — exactly one push, at T3', async () => {
    const { f, t0 } = setup();
    await f.tick();                                    // priming: busy since T0
    f.mark({ turnAt: t0 + SEC, stopAt: t0 + 2 * SEC, at: t0 + 2 * SEC, bg: 1, bgKinds: 'workflow', bgIds: 'w00000001' });
    await f.tick();                                    // T1: the main turn ended, the live file is still busy
    expect(finished(f.sent)).toHaveLength(0);
    f.live('idle', Date.now());
    await f.tick();                                    // T3: the delegated work ended
    expect(finished(f.sent)).toHaveLength(1);
    await f.tick();
    expect(finished(f.sent)).toHaveLength(1);
  });

  it('a second turn re-opens the episode: its own Stop pushes, an old Stop does not', async () => {
    const { f, t0 } = setup();
    await f.tick();
    f.mark({ turnAt: t0 + SEC, stopAt: t0 + 2 * SEC, at: t0 + 2 * SEC });
    f.live('idle', t0 + 3 * SEC);
    await f.tick();
    expect(finished(f.sent)).toHaveLength(1);
    // A compaction-only busy stretch afterwards: its episode starts at its own busy write, after the old Stop.
    f.live('busy', t0 + 30 * SEC);
    await f.tick();
    f.live('idle', Date.now());
    await f.tick();
    expect(finished(f.sent)).toHaveLength(1);
  });
});
