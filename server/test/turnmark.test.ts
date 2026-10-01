// Worker stall watch, wave 2 (spec §5.1): `readTurnMarkMeasured`, the reader of `$REG/<id>.turn.json`. One row (or
// table) per rung of its ladder, the first failure winning: the read (absent, unmeasured), the 4 KiB cap, the parse,
// `v` and the state word, the fifteen typed fields, the identity, then staleness against the live process. The ok arm
// and its derived `graceUntil` come last.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { localIO } from '../src/io.js';
import { readTurnMarkMeasured } from '../src/turnmark.js';
import { RESTART_GRACE_MS, type TurnMarkRead } from '../src/coord/stall.js';
import { mkTmp } from './tmpHelpers.js';
import { degradedReadIO } from './ioDoubles.js';

const ID = 'demo-quiet-basin';
const UUID = 'a'.repeat(36);
const OTHER = 'b'.repeat(36);
const T = 1_800_000_000_000;
const MIN = 60_000;
/** A live process that started an hour before the fixture line was written. */
const LIVE = { startedAt: T - 60 * MIN };
/** The line the hook writes, in the hook's key order: a `done` after one turn, two background tasks measured. */
const BASE: Record<string, unknown> = {
  v: 1, sessionId: UUID, state: 'done', event: 'Stop', at: T, turnAt: T - MIN, stopAt: T,
  bg: 2, bgKinds: 'monitor,subagent', bgIds: 'b989ocn62,a1', err: null, restartAt: null,
  lostBg: 0, lostKinds: '', lostIds: '',
};
const MALFORMED: TurnMarkRead = { ok: false, reason: 'malformed' };
const FOREIGN: TurnMarkRead = { ok: false, reason: 'foreign' };
const STALE: TurnMarkRead = { ok: false, reason: 'stale' };

/** A fresh registry directory holding exactly `content` as this id's marker. */
const seedRaw = (content: string): string => {
  const reg = path.join(mkTmp('ccrc-turnmark-'), '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  writeFileSync(path.join(reg, `${ID}.turn.json`), content);
  return reg;
};
/** The fixture line with `over` applied, one JSON line and a newline. */
const seed = (over: Record<string, unknown> = {}): string => seedRaw(`${JSON.stringify({ ...BASE, ...over })}\n`);
const read = (reg: string, uuid: string | null = UUID,
  live: { readonly startedAt: number | null } | null = LIVE): Promise<TurnMarkRead> =>
  readTurnMarkMeasured(localIO, reg, ID, uuid, live);

describe('readTurnMarkMeasured: the read', () => {
  it('no file is absent: a proven ENOENT (an older fleet build, or no main event yet)', async () => {
    const reg = path.join(mkTmp('ccrc-turnmark-'), '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    expect(await read(reg)).toEqual({ ok: false, reason: 'absent' });
  });

  it('a read that failed is unmeasured, never absent: the file is there and its bytes never came back', async () => {
    const reg = seed();
    const io = degradedReadIO((p) => p.endsWith(`${ID}.turn.json`));
    expect(await readTurnMarkMeasured(io, reg, ID, UUID, LIVE)).toEqual({ ok: false, reason: 'unmeasured' });
  });

  it('reads <registryDir>/<id>.turn.json and no other name: another row id finds nothing', async () => {
    const reg = seed();
    expect(await readTurnMarkMeasured(localIO, reg, 'demo-other-row', UUID, LIVE)).toEqual({ ok: false, reason: 'absent' });
  });
});

describe('readTurnMarkMeasured: the 4 KiB cap, in UTF-8 bytes, before any parse', () => {
  const padTo = (bytes: number): string => {
    const line = JSON.stringify(BASE);
    return line + ' '.repeat(bytes - Buffer.byteLength(line, 'utf8'));
  };

  it('exactly 4096 bytes is read', async () => {
    const content = padTo(4096);
    expect(Buffer.byteLength(content, 'utf8')).toBe(4096);
    expect((await read(seedRaw(content))).ok).toBe(true);
  });

  it('4097 bytes is malformed', async () => {
    expect(await read(seedRaw(padTo(4097)))).toEqual(MALFORMED);
  });

  it('bytes, not UTF-16 units: 2100 two-byte characters are under 4096 units and over 4096 bytes', async () => {
    const content = JSON.stringify({ ...BASE, event: 'é'.repeat(2100) });
    expect(content.length).toBeLessThan(4096);
    expect(Buffer.byteLength(content, 'utf8')).toBeGreaterThan(4096);
    expect(await read(seedRaw(content))).toEqual(MALFORMED);
  });
});

describe('readTurnMarkMeasured: the parse, v and the state word', () => {
  it('text that is not JSON is malformed', async () => {
    for (const text of ['', '{', '{"v":1,', 'v=1']) expect(await read(seedRaw(text)), JSON.stringify(text)).toEqual(MALFORMED);
  });

  it('JSON that is not a record is malformed', async () => {
    for (const text of ['[]', 'null', '"done"', '1', 'true', JSON.stringify([BASE])]) {
      expect(await read(seedRaw(text)), text.slice(0, 20)).toEqual(MALFORMED);
    }
  });

  it('a v other than the number 1 is malformed', async () => {
    for (const v of [2, 0, '1', null]) expect(await read(seed({ v })), JSON.stringify(v)).toEqual(MALFORMED);
  });

  it('a state word outside working, done and failed is malformed', async () => {
    for (const state of ['busy', 'idle', 'Done', '', null, 1]) {
      expect(await read(seed({ state })), JSON.stringify(state)).toEqual(MALFORMED);
    }
  });

  it('each of the three words reads', async () => {
    for (const state of ['working', 'done', 'failed']) {
      expect(await read(seed({ state })), state).toMatchObject({ ok: true, state });
    }
  });
});

describe('readTurnMarkMeasured: all fifteen fields, present, typed and bounded', () => {
  it('the fixture carries exactly the fifteen keys the hook writes, in its order', () => {
    expect(Object.keys(BASE)).toEqual([
      'v', 'sessionId', 'state', 'event', 'at', 'turnAt', 'stopAt', 'bg', 'bgKinds', 'bgIds', 'err', 'restartAt',
      'lostBg', 'lostKinds', 'lostIds',
    ]);
  });

  it('any one key missing is malformed', async () => {
    for (const key of Object.keys(BASE)) {
      const { [key]: _gone, ...rest } = BASE;
      expect(await read(seedRaw(JSON.stringify(rest))), key).toEqual(MALFORMED);
    }
  });

  const BAD: [string, unknown][] = [
    ['sessionId', 7], ['sessionId', null], ['event', null], ['event', 3],
    ['at', null], ['at', '1800000000000'], ['at', -1],
    ['turnAt', 1.5], ['turnAt', '1'], ['stopAt', -1], ['restartAt', 'x'], ['restartAt', -1e300],
    ['bg', -2], ['bg', 1.5], ['bg', '2'], ['bg', null], ['lostBg', -1], ['lostBg', 0.5], ['lostBg', null],
    ['bgKinds', 'a,'], ['bgKinds', ',a'], ['bgKinds', 'a,,b'], ['bgKinds', 'Monitor'], ['bgKinds', 'mcp task'],
    ['bgKinds', 'a'.repeat(201)], ['bgKinds', null], ['bgKinds', ['monitor']], ['lostKinds', 'x y'],
    ['lostKinds', 'a'.repeat(201)],
    ['bgIds', 'a b'], ['bgIds', 'a,,b'], ['bgIds', ','], ['bgIds', 'x'.repeat(65)],
    ['bgIds', Array.from({ length: 9 }, (_, i) => `id${i}`).join(',')], ['lostIds', 'é'], ['lostIds', null],
    ['err', 'Rate'], ['err', 'rate-limit'], ['err', 'a'.repeat(65)], ['err', 5],
  ];
  it('a field of the wrong type, or outside the bound the hook writes within, is malformed', async () => {
    for (const [key, value] of BAD) {
      expect(await read(seed({ [key]: value })), `${key}: ${JSON.stringify(value)}`).toEqual(MALFORMED);
    }
  });

  it('every epoch is an integer in [0, 8.64e15] (marker-epochs-bounded (D-3662)): stopAt -1e300, at 1.5 and at 9e15 are malformed', async () => {
    expect(await read(seed({ stopAt: -1e300 }))).toEqual(MALFORMED);
    expect(await read(seed({ at: 1.5 }))).toEqual(MALFORMED);
    expect(await read(seed({ at: 9e15 }))).toEqual(MALFORMED);
  });

  it('the bounds themselves are read (no live read, so no staleness judged here)', async () => {
    const GOOD: Record<string, unknown>[] = [
      { at: 0, turnAt: null, stopAt: null }, { at: 8.64e15, stopAt: 8.64e15 }, { restartAt: 0 },
      { bg: -1, bgKinds: '', bgIds: '' }, { bgKinds: 'a'.repeat(200) }, { bgKinds: 'mcp-task,auto-mode_scan' },
      { bgIds: Array.from({ length: 8 }, (_, i) => `${i}`.repeat(64)).join(',') },
      { lostBg: 3, lostKinds: 'shell', lostIds: 'b989ocn62' },
      { state: 'failed', err: '' }, { state: 'failed', err: 'a'.repeat(64) }, { event: '' },
    ];
    for (const over of GOOD) expect((await read(seed(over), UUID, null)).ok, JSON.stringify(over)).toBe(true);
  });
});

describe('readTurnMarkMeasured: identity (empty-uuid-is-foreign (D-3619))', () => {
  it('a sessionId equal to the registry uuid reads', async () => {
    expect((await read(seed())).ok).toBe(true);
  });

  it("another session's line is foreign", async () => {
    expect(await read(seed({ sessionId: OTHER }))).toEqual(FOREIGN);
  });

  it('a null registry uuid (a row with no identity) is foreign', async () => {
    expect(await read(seed(), null)).toEqual(FOREIGN);
  });

  it("an empty registry uuid is foreign, even against an empty sessionId: registry.ts starts uuid at ''", async () => {
    expect(await read(seed({ sessionId: '' }), '')).toEqual(FOREIGN);
    expect(await read(seed(), '')).toEqual(FOREIGN);
  });

  it('malformed outranks foreign: the shape is judged before the identity', async () => {
    expect(await read(seed({ v: 2, sessionId: OTHER }))).toEqual(MALFORMED);
  });
});

describe('readTurnMarkMeasured: staleness against the live process (turnMarkStale)', () => {
  it('a line written before the process started, never restarted since, is stale', async () => {
    expect(await read(seed({ at: T }), UUID, { startedAt: T + 1 })).toEqual(STALE);
  });

  it('a restart at or after the process start rescues it: that SessionStart was this process', async () => {
    expect((await read(seed({ at: T - 10, restartAt: T + 1 }), UUID, { startedAt: T + 1 })).ok).toBe(true);
    expect((await read(seed({ at: T - 10, restartAt: T + 5 }), UUID, { startedAt: T + 1 })).ok).toBe(true);
  });

  it('a restart before the process start does not rescue it', async () => {
    expect(await read(seed({ at: T - 10, restartAt: T - 5 }), UUID, { startedAt: T })).toEqual(STALE);
  });

  it('a line at the process start exactly is not stale: older means strictly before', async () => {
    expect((await read(seed({ at: T }), UUID, { startedAt: T })).ok).toBe(true);
  });

  it('a live file with no numeric startedAt reads the marker stale (stale-when-live-has-no-startedat (D-3655))', async () => {
    expect(await read(seed(), UUID, { startedAt: null })).toEqual(STALE);
  });

  it('no live read at all: the reader does not judge age, the caller does in L1', async () => {
    expect((await read(seed({ at: 0, turnAt: null, stopAt: null }), UUID, null)).ok).toBe(true);
  });

  it('foreign outranks stale: the identity is judged before the age', async () => {
    expect(await read(seed({ sessionId: OTHER }), UUID, { startedAt: null })).toEqual(FOREIGN);
  });
});

describe('readTurnMarkMeasured: the ok arm', () => {
  it('carries every field, the three lists split, no v, and a null graceUntil when nothing restarted', async () => {
    expect(await read(seed())).toEqual({
      ok: true, sessionId: UUID, state: 'done', event: 'Stop', at: T, turnAt: T - MIN, stopAt: T,
      bg: 2, bgKinds: ['monitor', 'subagent'], bgIds: ['b989ocn62', 'a1'], err: null, restartAt: null,
      lostBg: 0, lostKinds: [], lostIds: [], graceUntil: null,
    });
  });

  it("an empty list is [], never ['']", async () => {
    expect(await read(seed({ bgKinds: '', bgIds: '' }))).toMatchObject({ ok: true, bgKinds: [], bgIds: [] });
  });

  it('graceUntil: a restart that found a turn newer than the last Stop cut it short, and opens RESTART_GRACE_MS', async () => {
    const r = await read(seed({ event: 'SessionStart', at: T, turnAt: T - 10_000, stopAt: T - 10 * MIN, restartAt: T, bg: 0 }));
    expect(r).toMatchObject({ ok: true, graceUntil: T + RESTART_GRACE_MS });
  });

  it('graceUntil: a restart after a Stop (a clean restart) opens none', async () => {
    const r = await read(seed({ event: 'SessionStart', at: T, turnAt: T - 10 * MIN, stopAt: T - MIN, restartAt: T, bg: 0 }));
    expect(r).toMatchObject({ ok: true, graceUntil: null });
  });
});
