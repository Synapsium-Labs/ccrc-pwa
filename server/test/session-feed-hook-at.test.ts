// Session helpers H1b (D-8862): the hook roster's READ TIME reaches the decision (review 2900 F6, review 2961 F7). Figure 2's
// `launched` compares a launch result's time with the roster's read time (`HookReading.at`), which the feed used to drop:
// `FeedReading.hook` remains the bare raw read. The helper arm carries the published copy's `at`, else the
// moment the feed's own fallback read returned. And the HELPER ROSTER alone is ordered (`model.ts#orderHelperHook`, applied
// by the feed to `FeedReading.helperHook`; every other hook consumer reads `hook`, the latest raw read, review 3033 F7): a
// reading never carries a roster read earlier than one it already handed on (one memory per feed), so the decision's drop
// witness never compares a roster with an older one. Since H1c (D-8873, review 3033 F4) a read more than the feed's
// freshness window (`PUBLISHED_FRESH_MS`, 10 s) older than the last is a clock step, not a lag, and is taken, so the roster
// freezes for at most that long after the clock steps back. Neutral fixture names.
//
// RED FIRST: committed before the code, against origin/main, where a reading has no `helperHook.at`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Deps } from '../src/server.js';
import { PUBLISHED_FRESH_MS, feedFor, type FeedReading } from '../src/sessionFeed.js';
import { orderHelperHook, type HelperHookReading, type HookRosterRead } from '../src/workflows/model.js';
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

describe('FeedReading.helperHook: the roster\'s read time (review 2900 F6)', () => {
  it('a fresh published copy: the reading carries its `at` beside its raw read', async () => {
    const bus = new Bus();
    const at = Date.now() - 1_500;
    const raw = roster(['a1']);
    const { readings } = await subscribe(bus, () => { bus.emit(`hook:${ID}`, { at, uuid: UUID, raw }); });
    expect(readings).toHaveLength(1);
    expect(readings[0]!.helperHook?.at).toBe(at);
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
    expect(readings[0]!.helperHook?.at).not.toBeNull();
    expect(readings[0]!.helperHook!.at).toBeGreaterThanOrEqual(before);
    expect(readings[0]!.helperHook!.at).toBeLessThanOrEqual(after);
    expect(readings[0]!.helperHook!.at).toBeGreaterThanOrEqual(readings[0]!.startedAt);
  });

  it('a session that did not resolve reads no hook state and so carries no read time', async () => {
    const readings: FeedReading[] = [];
    await feedFor(deps, new Bus(), ID).join({ onReading: async (r) => { readings.push(r); } }, null);
    expect(readings[0]!.hook).toBeNull();
    expect(readings[0]!.helperHook).toBeNull();
  });
});

describe('only the helper roster has nondecreasing read time (review 2961 F7)', () => {
  it('an older publication reaches the raw hook consumers but not the helper roster', async () => {
    const bus = new Bus();
    const newer = Date.now() - 1_000;
    const { readings, poll } = await subscribe(bus, () => { bus.emit(`hook:${ID}`, { at: newer, uuid: UUID, raw: roster(['a1', 'a2']) }); });
    const olderRaw = roster(['a1']);
    bus.emit(`hook:${ID}`, { at: newer - 5_000, uuid: UUID, raw: olderRaw });
    await poll();
    expect(readings.map((r) => r.helperHook?.at)).toEqual([newer, newer]);
    expect(readings[1]!.helperHook).toBe(readings[0]!.helperHook);
    expect(readings[1]!.hook).toBe(olderRaw);
  });

  it('a later copy is handed on; an equal time is the same read and is handed on as it is', async () => {
    const bus = new Bus();
    const t = Date.now() - 3_000;
    const { readings, poll } = await subscribe(bus, () => { bus.emit(`hook:${ID}`, { at: t, uuid: UUID, raw: roster(['a1']) }); });
    bus.emit(`hook:${ID}`, { at: t, uuid: UUID, raw: roster(['a1', 'a3']) });
    await poll();
    bus.emit(`hook:${ID}`, { at: t + 1_000, uuid: UUID, raw: roster(['a3']) });
    await poll();
    expect(readings.map((r) => r.helperHook?.at)).toEqual([t, t, t + 1_000]);
    const listed = (r: FeedReading): string[] => (r.helperHook?.raw.ok ? r.helperHook.raw.state.subagents.map((s) => s.id ?? '') : []);
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
    expect(readings[1]!.helperHook!.at).toBeGreaterThanOrEqual(t);
  });
});

describe('the order and the stamp, pinned after the first mutation round', () => {
  it('after the identity moves (a rotation), the new identity\'s read is handed on even when it is older than the last one of the old', async () => {
    const bus = new Bus();
    const t = Date.now() - 1_000;
    const readings: FeedReading[] = [];
    const feed = feedFor(deps, bus, ID);
    const sub = { onReading: async (r: FeedReading) => { readings.push(r); } };
    bus.emit(`hook:${ID}`, { at: t, uuid: UUID, raw: roster(['a1']) });
    await feed.join(sub, { file: path.join(home, 'x.jsonl'), cfgDir: path.join(home, '.claude-a'), uuid: UUID });
    const other = 'b'.repeat(36);
    const rawB = roster(['b1']);
    feed.setFacts(sub, { file: path.join(home, 'y.jsonl'), cfgDir: path.join(home, '.claude-a'), uuid: other });
    bus.emit(`hook:${ID}`, { at: t - 2_000, uuid: other, raw: rawB });
    await feed.poll();
    expect(readings[1]!.hook).toBe(rawB);
    expect(readings[1]!.helperHook?.at).toBe(t - 2_000);
  });

  it('the feed\'s own read is stamped when it RETURNED, not when the reading began', async () => {
    writeFileSync(path.join(home, '.cc-sessions', `${ID}.hookstate.json`), JSON.stringify({
      v: 1, state: 'working', event: null, sessionId: UUID, pid: 1, updatedAt: Date.now(), ask: null, subagents: [], graphQueries: 0, graphGateDenials: 0,
    }));
    const slow = {
      ...localIO,
      readFileMeasured: async (p: string, ...rest: unknown[]) => {
        if (p.endsWith('.hookstate.json')) await new Promise((r) => setTimeout(r, 60));
        return (localIO.readFileMeasured as (p: string, ...r: unknown[]) => ReturnType<typeof localIO.readFileMeasured>)(p, ...rest);
      },
    };
    deps = { ...deps, io: slow };
    const { readings } = await subscribe(new Bus());
    expect(readings[0]!.hook?.ok).toBe(true);
    expect(readings[0]!.helperHook!.at - readings[0]!.startedAt).toBeGreaterThanOrEqual(50);
  });
});

// H1c (D-8873, review 3033 F4): the helper roster's freeze after a backward clock step, bounded. RED FIRST against
// origin/main, where any older read is held until the clock passes the last one.
describe('the helper roster after the clock steps back: held for at most PUBLISHED_FRESH_MS (review 3033 F4)', () => {
  const raw = (ids: string[]): HookRosterRead => ({ ok: true, identity: 'current', state: { updatedAt: 0, subagents: ids.map((id) => ({ id, name: 'Explore', startedAt: 0 })) } });
  const at = (t: number, ids: string[], uuid = UUID): HelperHookReading => ({ uuid, at: t, raw: raw(ids) });
  const T = 1_800_000_000_000;

  it('the window is the feed\'s freshness window: a lag can be no longer, because an older copy is not the reading', () => {
    expect(PUBLISHED_FRESH_MS).toBe(10_000);
  });

  it('an older read within the window is a lag and is held; one older than the window is a clock step and is taken', () => {
    const last = at(T, ['a1', 'a2']);
    expect(orderHelperHook(last, at(T - 1, ['a1']), PUBLISHED_FRESH_MS)).toBe(last);
    expect(orderHelperHook(last, at(T - PUBLISHED_FRESH_MS, ['a1']), PUBLISHED_FRESH_MS)).toBe(last);
    const stepped = at(T - PUBLISHED_FRESH_MS - 1, ['a1']);
    expect(orderHelperHook(last, stepped, PUBLISHED_FRESH_MS)).toBe(stepped);
  });

  it('a newer or equal read, a first read and another identity\'s read are taken as before', () => {
    const last = at(T, ['a1']);
    for (const next of [at(T, ['a2']), at(T + 1, ['a2']), at(T - 60_000, ['zz'], 'b'.repeat(36))]) expect(orderHelperHook(last, next, PUBLISHED_FRESH_MS)).toBe(next);
    const first = at(T - 60_000, ['a1']);
    expect(orderHelperHook(null, first, PUBLISHED_FRESH_MS)).toBe(first);
  });

  it('through the feed: after a step back of a minute, the next reading hands the helper roster the new read at once', async () => {
    const bus = new Bus();
    const t = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(t);
    try {
      const { readings, poll } = await subscribe(bus, () => { bus.emit(`hook:${ID}`, { at: t, uuid: UUID, raw: roster(['a1', 'a2']) }); });
      clock.mockReturnValue(t - 60_000);
      bus.emit(`hook:${ID}`, { at: t - 60_000, uuid: UUID, raw: roster(['a1']) });
      await poll();
      expect(readings.at(-1)!.helperHook!.at).toBe(t - 60_000);
    } finally { clock.mockRestore(); }
  });
});
