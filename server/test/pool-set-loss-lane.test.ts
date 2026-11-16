// The pool-set plan's Task 10 (`docs/superpowers/plans/2026-11-14-overlord-w1/w1-pool-set.md`): the lane that pushes the
// operator when a placing box's `ccd caps` lacks a capability floor word while a session carries the fact that needs it.
// Once per loss: the same facts on the next tick send nothing, a failed archive included; a restart reads the archived key.
// The push double records what reaches the push service; nothing leaves the test.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NotifyLog } from '../src/notifylog.js';
import { CAP_FLOOR_FACTS, PoolSetLossLane, type PoolSetLossLaneDeps } from '../src/poolSetLossLane.js';
import type { SessionRecord } from '../src/registry.js';
import type { PushPayload } from '../src/push.js';
import type { RouteField } from '../../shared/api.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(() => { vi.restoreAllMocks(); removeTmpFixtures(); });

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** A registry record carrying these route fields (read) and these listed-but-unreadable ones. */
const rec = (id: string, fields: Partial<Record<RouteField, string>>, unreadable: RouteField[] = []): SessionRecord =>
  ({ id, route: { fields, degraded: null, inert: [], unreadable } }) as unknown as SessionRecord;

async function setup(caps: string[] | null, sha: string | null = 'a'.repeat(40)) {
  const home = mkTmp('ccrc-pool-set-loss-');
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const sent: PushPayload[] = [];
  const fleetState = { ccdVerbs: caps, build: sha === null ? null : { sha } } as unknown as PoolSetLossLaneDeps['fleetState'];
  const deps: PoolSetLossLaneDeps = { coord, notifyLog, fleetState, push: { notify: async (p: PushPayload) => { sent.push(p); } } };
  return { coord, notifyLog, sent, deps, home, lane: new PoolSetLossLane(() => deps) };
}

describe('the push when a placing box loses pool-set while a set stands (Task 10)', () => {
  it('caps without the word and a set standing push once, session id empty, opening Settings', async () => {
    const s = await setup(['ws-add', 'pool-answer']);
    s.lane.check([rec('lane-a-overlord', { poolset: 'pool-a' }), rec('lane-b-project-a', { class: 'opus' })]);
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]).toMatchObject({ sessionId: '', tag: 'pool-set-lost', url: '/settings', title: 'The fleet box lost pool-set' });
    expect(s.sent[0]!.body).toContain('a poolset stands for lane-a-overlord');
    expect(s.sent[0]!.body).not.toContain('lane-b-project-a');
    expect(s.coord.hasNotice('coord', '', `pool-set-lost:${'a'.repeat(40)}:pool-set=lane-a-overlord`)).toBe(true);
  });

  it('the next tick with the same facts pushes nothing; a new build pushes again', async () => {
    const s = await setup([]);
    const records = [rec('lane-a-overlord', { poolset: 'pool-a' })];
    s.lane.check(records);
    s.lane.check(records);
    expect(s.sent).toHaveLength(1);
    (s.deps.fleetState as { build: { sha: string } }).build = { sha: 'b'.repeat(40) };
    s.lane.check(records);
    expect(s.sent).toHaveLength(2);
  });

  it('a new set pushes again', async () => {
    const s = await setup([]);
    s.lane.check([rec('lane-a-overlord', { poolset: 'pool-a' })]);
    s.lane.check([rec('lane-a-overlord', { poolset: 'pool-a' }), rec('lane-b-overlord', { poolset: 'pool-b' })]);
    expect(s.sent).toHaveLength(2);
    expect(s.sent[1]!.body).toContain('lane-a-overlord, lane-b-overlord');
  });

  it('caps with the word, caps unmeasured, or no set push nothing', async () => {
    for (const caps of [['pool-set'], null]) {
      const s = await setup(caps);
      s.lane.check([rec('lane-a-overlord', { poolset: 'pool-a' })]);
      expect(s.sent, JSON.stringify(caps)).toEqual([]);
    }
    const s = await setup([]);
    s.lane.check([rec('lane-a-project-a', { class: 'opus' })]);
    expect(s.sent).toEqual([]);
  });

  it('an unreadable set alone pushes, and the body says it could not be read', async () => {
    const s = await setup([], null);
    s.lane.check([rec('lane-a-overlord', {}, ['poolset'])]);
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]!.body).toContain('(unreadable for lane-a-overlord)');
    expect(s.coord.hasNotice('coord', '', 'pool-set-lost:unmeasured:pool-set=lane-a-overlord')).toBe(true);
  });

  it('a restart reads the archived key and pushes nothing', async () => {
    const s = await setup([]);
    const records = [rec('lane-a-overlord', { poolset: 'pool-a' })];
    s.lane.check(records);
    const restarted = new PoolSetLossLane(() => s.deps);
    restarted.check(records);
    expect(s.sent).toHaveLength(1);
  });

  it('a hasNotice that throws still sends', async () => {
    const s = await setup([]);
    vi.spyOn(s.coord, 'hasNotice').mockImplementation(() => { throw new Error('database is locked'); });
    s.lane.check([rec('lane-a-overlord', { poolset: 'pool-a' })]);
    expect(s.sent).toHaveLength(1);
  });

  it('an archive write that fails never re-sends the same loss on the next tick (an edge, not a level)', async () => {
    const s = await setup([]);
    vi.spyOn(s.coord, 'recordFeedEvent').mockImplementation(() => { throw new Error('disk full'); });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const records = [rec('lane-a-overlord', { poolset: 'pool-a' })];
    s.lane.check(records);
    s.lane.check(records);
    s.lane.check(records);
    expect(s.sent).toHaveLength(1);
  });

  it('more than five sessions: five named, the rest counted', async () => {
    const s = await setup([]);
    s.lane.check(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((x) => rec(`lane-${x}-overlord`, { poolset: 'pool-a' })));
    expect(s.sent[0]!.body).toContain('lane-e-overlord and 2 more');
    expect(s.sent[0]!.body).not.toContain('lane-f-overlord');
  });

  it('the table: a second row on a copy is honoured by the push with no code change', async () => {
    const s = await setup(['pool-set']);
    const rows = [...CAP_FLOOR_FACTS, { fact: 'profiledigest' as const, word: 'launch-surface-v1' }];
    const lane = new PoolSetLossLane(() => s.deps, rows);
    lane.check([rec('lane-a-overlord', { poolset: 'pool-a', profiledigest: 'd' })]);
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]!.title).toBe('The fleet box lost launch-surface-v1');
    expect(s.sent[0]!.body).toContain('a profiledigest stands for lane-a-overlord');
    expect(s.sent[0]!.body).not.toContain('pool-set');
  });

  it('CAP_FLOOR_FACTS is the twin of ccd/ccrc\'s CAP_FLOOR_ROWS, fact and word, row for row', () => {
    const text = readFileSync(path.join(ROOT, 'ccd/ccrc'), 'utf8');
    const m = /^CAP_FLOOR_ROWS=\(\n([\s\S]*?)\n\)$/m.exec(text);
    expect(m, 'CAP_FLOOR_ROWS=( … ) not found in ccd/ccrc').not.toBeNull();
    const bash = m![1]!.split('\n').map((l) => /^\s*'([^'|]+)\|([^'|]+)\|[^']*'\s*$/.exec(l)).map((r) => (r === null ? null : { fact: r[1], word: r[2] }));
    expect(bash.every((r) => r !== null), 'a CAP_FLOOR_ROWS line is not one quoted fact|word|remedy row').toBe(true);
    expect(bash).toStrictEqual(CAP_FLOOR_FACTS.map((r) => ({ fact: r.fact, word: r.word })));
  });

  it('a tick that throws inside the lane warns and does not throw', async () => {
    const s = await setup([]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const lane = new PoolSetLossLane(() => { throw new Error('no deps'); });
    expect(() => lane.check([rec('lane-a-overlord', { poolset: 'pool-a' })])).not.toThrow();
    expect(warn.mock.calls.some((c) => String(c[0]).includes('pool set: loss check failed'))).toBe(true);
    expect(s.sent).toEqual([]);
  });
});
