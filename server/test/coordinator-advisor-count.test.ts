// The coordinator advisor's counting and cap (plan 2026-11-23-coordinator-advisor PR C and D; D-8970, D-8971): the forward
// reader on a real file, the count pass against a real coord.db, the registry's one reader of `$REG/<id>.advisorspawn`, the
// roll's `advisor-stale` reason, and the fleet readout. Fixture files under a per-test temp root only.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { localIO } from '../src/io.js';
import { ADVISOR_TAIL_BYTES, readAdvisorForward } from '../src/transcript/advisorRead.js';
import { advisorCountPass, advisorCounted } from '../src/continuity/advisorLane.js';
import { advisorReadoutsOf } from '../src/continuity/advisorReadout.js';
import { advisorSpawnOf, type SessionRecord } from '../src/registry.js';
import { autoRollVerdict, type AutoRollInput } from '../src/coord/rollTarget.js';
import { CLAUDE_ROLL_TARGETS_DEFAULT } from '../../shared/claudeVersion.js';
import { HIBERNATE_AFTER_MS_DEFAULT } from '../src/coord/hibernate.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';

const ID = 'lane-a-project-a';
const T = '2026-11-24T10:00:00.000Z';
const TMS = Date.parse(T);
const SPAWN_S = Math.floor(TMS / 1000) - 600;
const callLine = (msg: string, call: string): string => JSON.stringify({ type: 'assistant', isSidechain: false, timestamp: T,
  message: { id: msg, content: [{ type: 'server_tool_use', id: call, name: 'advisor', input: {} }],
    usage: { iterations: [{ type: 'advisor_message', model: 'claude-fable-5', input_tokens: 500, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }] } } });

describe('readAdvisorForward: whole lines from a kept offset (D-8971)', () => {
  it('answers whole lines and the offset past the last; a partial last line waits for its newline', async () => {
    const f = path.join(mkTmp('ccrc-adv-read-'), 't.jsonl');
    fs.writeFileSync(f, 'a\nb\npart');
    const r = await readAdvisorForward(localIO, f, 0);
    expect(r).toEqual({ ok: true, lines: ['a', 'b'], next: 4, restarted: false, skippedLong: false });
    fs.appendFileSync(f, 'ial\n');
    expect(await readAdvisorForward(localIO, f, 4)).toEqual({ ok: true, lines: ['partial'], next: 12, restarted: false, skippedLong: false });
  });
  it('a file it has no place in starts at its tail, at the first whole line (review F1)', async () => {
    const f = path.join(mkTmp('ccrc-adv-read-'), 't.jsonl');
    const filler = `${'x'.repeat(999)}\n`;
    fs.writeFileSync(f, filler.repeat(Math.ceil((2 * ADVISOR_TAIL_BYTES) / filler.length)) + 'last\n');
    const size = fs.statSync(f).size;
    const r = await readAdvisorForward(localIO, f, 'tail');
    if (!r.ok) throw new Error('read failed');
    expect(r.lines.every((l) => l === 'x'.repeat(999))).toBe(true);
    expect(r.next).toBeGreaterThanOrEqual(size - ADVISOR_TAIL_BYTES);
    // and a small file's tail is the whole file
    const g = path.join(mkTmp('ccrc-adv-read-'), 't.jsonl');
    fs.writeFileSync(g, 'a\nb\n');
    expect(await readAdvisorForward(localIO, g, 'tail')).toEqual({ ok: true, lines: ['a', 'b'], next: 4, restarted: false, skippedLong: false });
  });
  it('a file that shrank is read from its tail; an absent file is absent, never an empty read', async () => {
    const f = path.join(mkTmp('ccrc-adv-read-'), 't.jsonl');
    fs.writeFileSync(f, 'x\n');
    expect(await readAdvisorForward(localIO, f, 99)).toMatchObject({ ok: true, lines: ['x'], restarted: true });
    expect(await readAdvisorForward(localIO, `${f}.gone`, 0)).toEqual({ ok: false, reason: 'absent' });
  });
});

const coordAt = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-adv-count-'), 'coord.db')));
const rec = (o: Partial<SessionRecord>): SessionRecord => ({ id: ID, wrapper: 'lane-a', route: null, ...o }) as SessionRecord;
const routed = (advisor: string | undefined): SessionRecord['route'] =>
  ({ fields: advisor === undefined ? {} : { advisor }, degraded: null, inert: [], unreadable: [] }) as never;

describe('the count pass (D-8971)', () => {
  it('reads only advised sessions, counts each call once across passes, and keeps its offset', async () => {
    const coord = coordAt();
    const f = path.join(mkTmp('ccrc-adv-t-'), 't.jsonl');
    fs.writeFileSync(f, `${callLine('m1', 'c1')}\n${callLine('m1', 'c1')}\n`);
    const deps = { coord, io: localIO, transcriptOf: async () => f, now: () => TMS, log: () => {} };
    const advised = rec({ route: routed('fable'), advisorSpawn: { kind: 'applied', model: 'fable', at: SPAWN_S } });
    expect(advisorCounted(rec({}))).toBe(false);
    expect(advisorCounted(advised)).toBe(true);
    expect(await advisorCountPass(deps, [advised, rec({ id: 'lane-a-other' })])).toEqual({ read: 1, calls: 1, failed: 0 });
    fs.appendFileSync(f, `${callLine('m2', 'c2')}\n`);
    await advisorCountPass(deps, [advised]);
    await advisorCountPass(deps, [advised]);
    expect(coord.advisorDayCounts('2026-11-24').get(ID)).toEqual({ calls: 2, tokens: { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0 } });
    expect(coord.advisorReadState(ID)).toMatchObject({ file: f, offset: fs.statSync(f).size, spawnAt: SPAWN_S, requests: 2, lastCallAt: TMS });
  });
  it('a session whose spawn applied the flag is still counted once the route lost it (the overrun is measured)', () => {
    expect(advisorCounted(rec({ route: routed(undefined), advisorSpawn: { kind: 'applied', model: 'fable', at: SPAWN_S } }))).toBe(true);
    expect(advisorCounted(rec({ route: routed(undefined), advisorSpawn: { kind: 'off', at: SPAWN_S, fastDeath: false } }))).toBe(false);
  });
  it('a large transcript on a new path (a swap) is counted within a few passes, not hours (review F1)', async () => {
    const coord = coordAt();
    const dir = mkTmp('ccrc-adv-t-');
    const filler = `${JSON.stringify({ type: 'user', message: { content: 'y'.repeat(4000) } })}\n`;
    const big = filler.repeat(Math.ceil((8 * 1024 * 1024) / filler.length));
    const a = path.join(dir, 'a.jsonl');
    fs.writeFileSync(a, `${big}${callLine('m1', 'c1')}\n`);
    let file = a;
    const deps = { coord, io: localIO, transcriptOf: async () => file, now: () => TMS, log: () => {} };
    const advised = rec({ route: routed('fable'), advisorSpawn: { kind: 'applied', model: 'fable', at: SPAWN_S } });
    for (let i = 0; i < 5; i++) await advisorCountPass(deps, [advised]);
    expect(coord.advisorDayCounts('2026-11-24').get(ID)?.calls).toBe(1);
    const b = path.join(dir, 'b.jsonl');
    fs.writeFileSync(b, `${big}${callLine('m1', 'c1')}\n${callLine('m2', 'c2')}\n`);
    file = b;
    for (let i = 0; i < 5; i++) await advisorCountPass(deps, [advised]);
    expect(coord.advisorDayCounts('2026-11-24').get(ID)?.calls).toBe(2);
  });
  it('a transcript it cannot read records nothing and is counted as failed', async () => {
    const coord = coordAt();
    const deps = { coord, io: localIO, transcriptOf: async () => '/nonexistent/t.jsonl', now: () => TMS, log: () => {} };
    expect(await advisorCountPass(deps, [rec({ route: routed('opus') })])).toEqual({ read: 0, calls: 0, failed: 1 });
    expect(coord.advisorReadState(ID)).toBeNull();
  });
});

describe("advisorSpawnOf: `$REG/<id>.advisorspawn`'s one reader", () => {
  it.each([
    ['fable 1795486559', { kind: 'applied', model: 'fable', at: 1795486559 }],
    ['off 12', { kind: 'off', at: 12, fastDeath: false }],
    ['off fastdeath 12', { kind: 'off', at: 12, fastDeath: true }],
    ['sonnet 12', 'unreadable'], ['fable', 'unreadable'], ['', 'unreadable'],
  ] as const)('%j', (content, want) => {
    expect(advisorSpawnOf({ ok: true, content })).toEqual(want);
  });
  it('unlisted is no record; listed and gone is no record; unreadable stays unreadable', () => {
    expect(advisorSpawnOf(null)).toBeNull();
    expect(advisorSpawnOf({ ok: false, reason: 'absent' })).toBeNull();
    expect(advisorSpawnOf({ ok: false, reason: 'unreadable' })).toBe('unreadable');
  });
});

describe("the roll's advisor-stale reason (D-8970)", () => {
  const HOUR = 3_600_000;
  const NOW = TMS;
  const input = (o: Partial<AutoRollInput>): AutoRollInput => ({
    targets: CLAUDE_ROLL_TARGETS_DEFAULT, role: 'coordinator', longLived: false, continuityLive: false, overlord: false,
    release: NOW - 3 * HOUR, startedAt: NOW - 2 * HOUR, build: { kind: 'unmeasured' }, rolledFor: null, model: { kind: 'none' },
    rolledModelFor: null, entryPending: null, optedOut: { roll: false, hibernate: false },
    hibernation: { armed: false, afterMs: HIBERNATE_AFTER_MS_DEFAULT }, statusUpdatedAt: NOW - 2 * HOUR,
    sleep: {
      row: { id: ID, status: 'idle', archivedAt: null, bucket: 'idle', held: null, unmeasured: [], statusUnmeasured: false, dialogPending: false,
        background: null, subagents: null, stranded: null, swapBlocked: null, substrate: null },
      overlord: false, optedOut: false, store: { ok: true, openWorker: false, openClaimant: false, claim: false, mail: false }, viewer: false,
      sinceStartMs: 100 * HOUR,
      live: { kind: 'read', word: { ok: true, word: 'idle' }, mark: { ok: true, state: 'done', bg: 0, crons: 0, turnAt: NOW - 2 * HOUR - 60_000, stopAt: NOW - 2 * HOUR, restartAt: null } as never },
    } as never,
    now: NOW, ...o,
  });
  it('a session current on its release is rolled at idle when its advisor is stale, and says why', () => {
    expect(autoRollVerdict(input({}))).toEqual({ act: 'current' });
    expect(autoRollVerdict(input({ advisorStale: true }))).toMatchObject({ act: 'roll', advisor: true });
  });
  it('a busy session is not: the roll\'s idle gate holds it', () => {
    const busy = input({ advisorStale: true });
    const v = autoRollVerdict({ ...busy, sleep: { ...busy.sleep, live: { kind: 'read', word: { ok: true, word: 'busy' }, mark: (busy.sleep.live as unknown as { mark: never }).mark } } as never });
    expect(v.act).toBe('skip');
  });
  it('.no-roll opts it out like any other reason', () => {
    expect(autoRollVerdict(input({ advisorStale: true, optedOut: { roll: true, hibernate: false } }))).toEqual({ act: 'skip', reason: 'no-roll' });
  });
});

describe('the fleet readout (spec §6)', () => {
  it('only a touched session has one; it carries the state, today\'s count, the cap and the overrun', () => {
    const coord = coordAt();
    coord.setCoordinatorAdvisor({ choice: 'fable', cap: 1, scope: { kind: 'all' } }, 1);
    const state = { file: '/t', offset: 1, spawnAt: SPAWN_S, requests: 3, lastMessageId: 'm', available: 'true' as const, availableAt: TMS, lastCallAt: TMS, unreadable: 0, droppedDay: null };
    coord.recordAdvisorRead(ID, state, ['c1', 'c2'].map((callId) => ({ callId, day: '2026-11-24', at: TMS, model: null, tokens: null })), TMS, '2026-11-10');
    const out = advisorReadoutsOf(coord, [rec({ route: routed(undefined), advisorSpawn: { kind: 'applied', model: 'fable', at: SPAWN_S } }),
      rec({ id: 'lane-a-plain' })], TMS);
    expect([...out.keys()]).toEqual([ID]);
    expect(out.get(ID)).toEqual({ state: 'capped', model: 'fable', today: 2, cap: 1, overrun: 1, tokens: null, applies: 'roll' });
  });
});
