import { describe, it, expect } from 'vitest';
import {
  COLD_ROW_REREAD_MS, rowTemperature, hotRowReuse, isCleanRecord, rowKeyEqual, type RowKey,
} from '../src/rowTemperature.js';
import { HOLD_UNREADABLE, STRANDED_UNREADABLE, SUBSTRATE_UNREADABLE, type SessionRecord } from '../src/registry.js';
import type { SessionVerdict } from '../src/exec.js';

const rec = (over: Partial<SessionRecord> = {}): SessionRecord => ({
  hibernatedAt: null, namedByOperator: false, title: null,
  id: 'sess-a', wrapper: 'lane-a', project: 'project-a', projectEvidence: 'measured', workdir: '/w/sess-a', uuid: 'u-sess-a',
  started: true, home: null, pool: null, lastswap: null,
  workspace: 'sess-a', branch: 'ws/sess-a', branchEvidence: 'named', base: 'origin/main',
  prPhase: null, prNumber: null, prCheckedAt: null, archivedAt: null, archivedBytes: null, held: null,
  substrate: null, stopped: { at: 1, surface: 'cli' } as SessionRecord['stopped'], supervisedAt: null,
  swapBlocked: null, stranded: null, spawn: null, lastEnd: null, lifecycleUnmeasured: [],
  unmeasured: [], route: null, child: { kind: 'none' },
  ...over,
});
const key: RowKey = { names: ['sess-a', 'sess-a.stopped'], times: [10, 20] };
const gone: SessionVerdict = { verdict: 'gone' };
const NOW = 1_000_000;
const prev = (over: Partial<SessionRecord> = {}, k: RowKey = key, readAt = NOW - 1000) =>
  ({ record: rec(over), key: k, readAt });

describe('rowTemperature', () => {
  it('no previous read is hot', () => {
    expect(rowTemperature(undefined, gone, key, NOW)).toBe('hot');
  });
  it.each([
    ['unmeasured', { unmeasured: ['wrapper'] } as Partial<SessionRecord>],
    ['lifecycleUnmeasured', { lifecycleUnmeasured: ['stopped'] } as Partial<SessionRecord>],
    ['held unreadable', { held: HOLD_UNREADABLE } as Partial<SessionRecord>],
  ])('an unclean previous read is hot (%s)', (_n, over) => {
    expect(rowTemperature(prev(over), gone, key, NOW)).toBe('hot');
  });
  it.each([
    ['projectEvidence unreadable', { projectEvidence: 'unreadable' } as Partial<SessionRecord>],
    ['branchEvidence unreadable', { branchEvidence: 'unreadable' } as Partial<SessionRecord>],
    ['route', { route: { fields: {}, degraded: null, inert: [], unreadable: ['model'] } } as unknown as Partial<SessionRecord>],
    ['substrate', { substrate: { at: 0, text: SUBSTRATE_UNREADABLE } } as Partial<SessionRecord>],
    ['stranded', { stranded: { at: 0, reason: STRANDED_UNREADABLE } } as Partial<SessionRecord>],
    ['child', { child: { kind: 'unreadable' } } as Partial<SessionRecord>],
    ['denySettings', { denySettings: { kind: 'unreadable' } } as Partial<SessionRecord>],
    ['childShell', { childShell: { kind: 'unreadable' } } as Partial<SessionRecord>],
  ])('an unreadable %s is hot', (_n, over) => {
    expect(isCleanRecord(rec(over))).toBe(false);
    expect(rowTemperature(prev(over), gone, key, NOW)).toBe('hot');
  });
  it('markers that read fine keep the row clean', () => {
    expect(isCleanRecord(rec({ projectEvidence: 'absent', branchEvidence: 'absent' }))).toBe(true);
    expect(isCleanRecord(rec({ branchEvidence: 'empty', child: { kind: 'child', runId: 7 }, denySettings: { kind: 'none' }, childShell: { kind: 'pinned', shell: '/bin/bash' } }))).toBe(true);
  });
  it('a row with neither stopped nor archived is hot', () => {
    expect(rowTemperature(prev({ stopped: null, archivedAt: null }), gone, key, NOW)).toBe('hot');
  });
  it('an archived row with no stop is cold', () => {
    expect(rowTemperature(prev({ stopped: null, archivedAt: 5 }), gone, key, NOW)).toBe('cold');
  });
  it('a cold row named live by the listing is hot', () => {
    expect(rowTemperature(prev(), { verdict: 'live' }, key, NOW)).toBe('hot');
  });
  it('an unknown verdict is hot', () => {
    expect(rowTemperature(prev(), { verdict: 'unknown', detail: 'x' }, key, NOW)).toBe('hot');
  });
  it('a null verdict (no listing) is hot', () => {
    expect(rowTemperature(prev(), null, key, NOW)).toBe('hot');
  });
  it('a changed name set is hot', () => {
    expect(rowTemperature(prev(), gone, { names: ['sess-a'], times: [10] }, NOW)).toBe('hot');
  });
  it('a changed mtime is hot', () => {
    expect(rowTemperature(prev(), gone, { names: key.names, times: [10, 21] }, NOW)).toBe('hot');
  });
  it('times present on one side only is hot; absent on both compares names alone', () => {
    expect(rowTemperature(prev(), gone, { names: key.names, times: null }, NOW)).toBe('hot');
    const nt: RowKey = { names: key.names, times: null };
    expect(rowTemperature(prev({}, nt), gone, nt, NOW)).toBe('cold');
  });
  it('a read 30 s old is hot', () => {
    expect(rowTemperature(prev({}, key, NOW - COLD_ROW_REREAD_MS), gone, key, NOW)).toBe('hot');
    expect(rowTemperature(prev({}, key, NOW - COLD_ROW_REREAD_MS + 1), gone, key, NOW)).toBe('cold');
  });
  it('a negative age is hot', () => {
    expect(rowTemperature(prev({}, key, NOW + 5), gone, key, NOW)).toBe('hot');
  });
  it('all conditions met is cold', () => {
    expect(rowTemperature(prev(), gone, { names: [...key.names], times: [10, 20] }, NOW)).toBe('cold');
  });
});

describe('hotRowReuse', () => {
  it('is false without times', () => {
    const nt: RowKey = { names: key.names, times: null };
    expect(hotRowReuse(prev({}, nt), nt, NOW)).toBe(false);
  });
  it('is true for a clean row with an equal keyed-by-times key, false on a change or an unclean row', () => {
    expect(hotRowReuse(prev(), { names: [...key.names], times: [10, 20] }, NOW)).toBe(true);
    expect(hotRowReuse(prev(), { names: key.names, times: [10, 99] }, NOW)).toBe(false);
    expect(hotRowReuse(prev({ unmeasured: ['uuid'] }), key, NOW)).toBe(false);
    expect(hotRowReuse(undefined, key, NOW)).toBe(false);
  });
  it('is false at an age of 30 s or more, and at a negative age', () => {
    expect(hotRowReuse(prev({}, key, NOW - COLD_ROW_REREAD_MS + 1), key, NOW)).toBe(true);
    expect(hotRowReuse(prev({}, key, NOW - COLD_ROW_REREAD_MS), key, NOW)).toBe(false);
    expect(hotRowReuse(prev({}, key, NOW - 10 * COLD_ROW_REREAD_MS), key, NOW)).toBe(false);
    expect(hotRowReuse(prev({}, key, NOW + 5), key, NOW)).toBe(false);
  });
});

describe('isCleanRecord / rowKeyEqual', () => {
  it('names the clean predicate', () => {
    expect(isCleanRecord(rec())).toBe(true);
    expect(isCleanRecord(rec({ held: HOLD_UNREADABLE }))).toBe(false);
    expect(isCleanRecord(rec({ held: 'program:x' }))).toBe(true);
  });
  it('rowKeyEqual compares names, then times', () => {
    expect(rowKeyEqual(key, { names: [...key.names], times: [10, 20] })).toBe(true);
    expect(rowKeyEqual(key, { names: ['x'], times: [10, 20] })).toBe(false);
    expect(rowKeyEqual(key, { names: key.names, times: [10] })).toBe(false);
  });
});
