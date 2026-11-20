// Session helpers H1b (D-8862): the hook roster's READ TIME reaches the decision (review 2900 F6, review 2961 F7). Figure 2's
// `launched` compares a launch result's time with the roster's read time (`HookReading.at`), which the feed used to drop:
// `FeedReading.hook` was the bare raw read. Now the reading carries `hookAt` beside it: the published copy's `at`, else the
// moment the feed's own fallback read returned. And the feed is the ONE place that orders them: a reading never carries a
// roster read earlier than one it already handed on (one memory per feed), so the decision's drop witness never compares a
// roster with an older one. Neutral fixture names.
//
// RED FIRST: committed before the code, against origin/main, where a reading has no `hookAt`.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Deps } from '../src/server.js';
import { feedFor, type FeedReading } from '../src/sessionFeed.js';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { ccdRunner } from '../src/lifecycle.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { KeyedQueue } from '../src/inject/queue.js';
import type { HookStateRawRead } from '../src/hookstate.js';
import { mkTmp } from './tmpHelpers.js';
import { fakeTime } from './fakeTime.js';
import { seedRoster } from './helpers.js';

const ID = 'claude-a-project-a';
const UUID = 'a'.repeat(36);

let home: string;
let deps: Deps;
beforeEach(() => {
  home = mkTmp('ccrc-feed-hook-at-');
  seedRoster(home);
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const run: Runner = async () => ({ ran: true, code: 0, stdout: '', stderr: '' });
  const cfg = loadConfig({ CCRC_HOME: home });
  deps = { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(), time: fakeTime().ports };
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const roster = (ids: string[]): HookStateRawRead => ({
  ok: true, sessionId: UUID, identity: 'current',
  state: {
    state: 'working', updatedAt: Date.now(), event: null, ask: null, graphQueries: 0, graphGateDenials: 0, interrupted: false,
    subagents: ids.map((id, i) => ({ id, name: 'Explore', startedAt: i })),
  },
});

/** The feed subscribes to the bus when it is made, so a copy is published (`first`) after that and before the join. */
const subscribe = async (bus: Bus, first: () => void = () => {}): Promise<{ readings: FeedReading[]; poll: () => Promise<void> }> => {
  const readings: FeedReading[] = [];
  const feed = feedFor(deps, bus, ID);
  first();
  await feed.join({ onReading: async (r) => { readings.push(r); } }, { file: path.join(home, 'x.jsonl'), cfgDir: path.join(home, '.claude-a'), uuid: UUID });
  return { readings, poll: () => feed.poll() };
};

describe('FeedReading.hookAt: the roster\'s read time (review 2900 F6)', () => {
  it('a fresh published copy: the reading carries its `at` beside its raw read', async () => {
    const bus = new Bus();
    const at = Date.now() - 1_500;
    const raw = roster(['a1']);
    const { readings } = await subscribe(bus, () => { bus.emit(`hook:${ID}`, { at, uuid: UUID, raw }); });
    expect(readings).toHaveLength(1);
    expect(readings[0]!.hookAt).toBe(at);
    expect(readings[0]!.hook).toBe(raw);
  });

  it('no published copy: the feed\'s own read is stamped when it returned (never null, never the reading\'s start)', async () => {
    writeFileSync(path.join(home, '.cc-sessions', `${ID}.hookstate.json`), JSON.stringify({
      v: 1, state: 'working', event: null, sessionId: UUID, pid: 1, updatedAt: Date.now(), ask: null, subagents: [], graphQueries: 0, graphGateDenials: 0,
    }));
    const before = Date.now();
    const { readings } = await subscribe(new Bus());
    const after = Date.now();
    expect(readings[0]!.hook?.ok).toBe(true);
    expect(readings[0]!.hookAt).not.toBeNull();
    expect(readings[0]!.hookAt!).toBeGreaterThanOrEqual(before);
    expect(readings[0]!.hookAt!).toBeLessThanOrEqual(after);
    expect(readings[0]!.hookAt!).toBeGreaterThanOrEqual(readings[0]!.startedAt);
  });

  it('a session that did not resolve reads no hook state and so carries no read time', async () => {
    const readings: FeedReading[] = [];
    await feedFor(deps, new Bus(), ID).join({ onReading: async (r) => { readings.push(r); } }, null);
    expect(readings[0]!.hook).toBeNull();
    expect(readings[0]!.hookAt).toBeNull();
  });
});

describe('the feed hands readings on in nondecreasing roster read time (review 2961 F7)', () => {
  it('a published copy OLDER than the one already handed on is not handed on: the newer read stands, its time with it', async () => {
    const bus = new Bus();
    const newer = Date.now() - 1_000;
    const { readings, poll } = await subscribe(bus, () => { bus.emit(`hook:${ID}`, { at: newer, uuid: UUID, raw: roster(['a1', 'a2']) }); });
    bus.emit(`hook:${ID}`, { at: newer - 5_000, uuid: UUID, raw: roster(['a1']) });
    await poll();
    expect(readings.map((r) => r.hookAt)).toEqual([newer, newer]);
    expect(readings[1]!.hook).toEqual(readings[0]!.hook);
  });

  it('a later copy is handed on; an equal time is the same read and is handed on as it is', async () => {
    const bus = new Bus();
    const t = Date.now() - 3_000;
    const { readings, poll } = await subscribe(bus, () => { bus.emit(`hook:${ID}`, { at: t, uuid: UUID, raw: roster(['a1']) }); });
    bus.emit(`hook:${ID}`, { at: t, uuid: UUID, raw: roster(['a1', 'a3']) });
    await poll();
    bus.emit(`hook:${ID}`, { at: t + 1_000, uuid: UUID, raw: roster(['a3']) });
    await poll();
    expect(readings.map((r) => r.hookAt)).toEqual([t, t, t + 1_000]);
    const listed = (r: FeedReading): string[] => (r.hook?.ok ? r.hook.state.subagents.map((s) => s.id ?? '') : []);
    expect(readings.map(listed)).toEqual([['a1'], ['a1', 'a3'], ['a3']]);
  });

  it('a read of another identity is not compared with this one\'s: the order is per uuid read', async () => {
    const bus = new Bus();
    const t = Date.now() - 1_000;
    const { readings, poll } = await subscribe(bus, () => { bus.emit(`hook:${ID}`, { at: t, uuid: UUID, raw: roster(['a1']) }); });
    bus.emit(`hook:${ID}`, { at: t + 500, uuid: 'b'.repeat(36), raw: roster(['zz']) });
    await poll();
    // the other uuid's copy is not this stream's: the feed reads its own file (absent here), stamped now
    expect(readings[1]!.hook).toEqual({ ok: false, reason: 'absent' });
    expect(readings[1]!.hookAt!).toBeGreaterThanOrEqual(t);
  });
});
