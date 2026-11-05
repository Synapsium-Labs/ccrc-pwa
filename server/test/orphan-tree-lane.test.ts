// FLEET DISK RETENTION DR-19 (D-6631; spec 2026-10-23 section 2.3). The orphan-worktree lane: population from the census,
// the licence (two unchanged tokens at least an hour apart), pacing, the arming markers, the pause, the feed and the
// health counts. Every case drives the real lane (`OrphanTreeSweep`, the L3 executor and the L1 folds) over a fake ccd and
// a fake registry listing; nothing here runs a verb on a box.
import { describe, it, expect, vi } from 'vitest';
import { collectOrphanTree } from '../src/coord/collectOrphanTree.js';
import { OrphanTreeSweep, type OrphanSweepDeps } from '../src/orphanTreeSweep.js';
import {
  ORPHAN_LICENCE_MS, ORPHAN_CENSUS_MS, ORPHAN_CENSUS_PRESSURE_MS, ORPHAN_RETRY_MS, ORPHAN_AUDITS_PER_PASS, ORPHAN_AUDITS_PER_PASS_PRESSURE, orphanPressure, orphanCensusRetryAt, orphanCensusDue, orphanInsideVerdict, orphanLicence,
  orphanCoordinatorSet, orphanTruncatedRow, orphanTruncatedWaitMs, parseOrphanAudit, parseOrphanCensus, orphanAuditEndsHoldWait,
} from '../src/orphanTreeLane.js';
import { readDiskHealth } from '../../shared/disk.js';
import { ORPHAN_TREE_LIVE_MARKER, ORPHAN_TREE_RESCUE_LIVE_MARKER, RECLAIM_PAUSE_MARKER } from '../../shared/switches.js';
import type { CcdResult } from '../src/lifecycle.js';
import type { OrphanLeaseHold } from '../src/coord/delegation-orphan-hold.js';
import { beatLeaseHold } from '../src/orphanTreeBeat.js';
import { checkpointWithLease } from './delegationLeaseFixture.js';

const HOUR = ORPHAN_LICENCE_MS;
const MIN = 60_000;
const hexOf = (p: string): string => Buffer.from(p).toString('hex');
const tok = (c: string): string => c.repeat(64);

interface Tree { cls: string; audit: Record<string, unknown>; inside?: string | null }
const clean = (c: string): Record<string, unknown> => ({ verdict: 'token', refusal: null, detail: '', token: tok(c), rescueToken: null });
const refused = (word: string, detail = ''): Record<string, unknown> => ({ verdict: 'refused', refusal: word, detail, token: null, rescueToken: null });
const rung11 = (c: string): Record<string, unknown> => ({ verdict: 'refused', refusal: 'nested-checkout', detail: 'a loose fixture repository', token: null, rescueToken: tok(c) });
const rung9 = (c: string): Record<string, unknown> => ({ verdict: 'refused', refusal: 'head-not-on-remote', detail: 'two commits on no remote', token: null, rescueToken: tok(c) });

function rig(verbs: string[] | null = ['orphan-v1', 'reclaim-pause-v1', 'actor-flags-v1']) {
  const trees = new Map<string, Tree>();
  const markers = new Set<string>();
  const calls: string[][] = [];
  const feed: Array<{ title: string; body: string }> = [];
  let mono = 1_000_000;
  let truncated = false;
  let garbled = false;
  let censusTakesMs = 0;
  const coordinators = new Set<string>();
  let coordsReadable = true;
  // Registry rows by id: true = workspace (the default), false = plain session / main checkout, null = unreadable, 'throw' = the read throws.
  const wsKinds = new Map<string, boolean | null | 'throw'>();
  const ok = (stdout: string): CcdResult => ({ ran: true, ok: true, stdout, stderr: '', killed: false, signal: null });
  let pressure = false;
  // The delegation hold (PR4): free unless a case sets it; every ask is recorded with the path and class it was handed.
  let leaseHold: (p: string, cls: string | null) => Promise<OrphanLeaseHold> = async () => ({ kind: 'free' });
  const holdAsks: Array<{ path: string; cls: string | null }> = [];
  const deps: OrphanSweepDeps = {
    io: { readdirMeasured: async () => ({ ok: true, entries: [...markers] }) } as unknown as OrphanSweepDeps['io'],
    registryDir: '/reg',
    runCcd: async (argv) => {
      const a = [...argv];
      calls.push(a);
      if (a[0] === 'ws-audit' && a[1] === '--orphans') {
        mono += censusTakesMs;
        if (garbled) return ok('not a census');
        return ok(JSON.stringify({ mode: 'orphans', truncated, rows: [...trees].map(([hex, t]) => ({ pathHex: hex, class: t.cls, ...(t.inside === undefined ? {} : { inside: t.inside }) })) }));
      }
      if (a[0] === 'ws-audit' && a[1] === '--orphan-hex') {
        const t = trees.get(a[2]!)!;
        return ok(JSON.stringify({ mode: 'orphan', pathHex: a[2], class: t.cls, ...t.audit }));
      }
      if (a[0] === 'ws-orphan') {
        const hex = a[a.indexOf('--tree-hex') + 1]!;
        trees.delete(hex);
        return ok(JSON.stringify({ removed: true, pathHex: hex, class: 'claude', branch: 'left', pinned: 0 }));
      }
      throw new Error(`unexpected ccd ${a.join(' ')}`);
    },
    fleetState: verbs === null ? undefined : { ccdVerbs: verbs },
    queue: { run: (_k, fn) => fn() },
    mono: () => mono,
    epochNow: () => 1,
    pressure: () => pressure,
    record: (title, body) => { feed.push({ title, body }); },
    isWorkspace: async (id) => { const k = wsKinds.has(id) ? wsKinds.get(id)! : true; if (k === 'throw') throw new Error('row unreadable'); return k; },
    coordinators: () => { if (!coordsReadable) throw new Error('store unreadable'); return coordinators; },
    leaseHold: async (p, cls) => { holdAsks.push({ path: p, cls }); return leaseHold(p, cls); },
  };
  const sweep = new OrphanTreeSweep(deps);
  const acts = (): string[][] => calls.filter((c) => c[0] === 'ws-orphan');
  return {
    deps, sweep, trees, markers, calls, feed, acts,
    add: (p: string, cls: string, audit: Record<string, unknown>): string => { const h = hexOf(p); trees.set(h, { cls, audit }); return h; },
    advance: (ms: number): void => { mono += ms; },
    truncate: (v: boolean): void => { truncated = v; },
    garbled: (v: boolean): void => { garbled = v; },
    pressured: (v: boolean): void => { pressure = v; },
    censusTakes: (ms: number): void => { censusTakesMs = ms; },
    coordinators, wsKinds, unreadable: (v: boolean): void => { coordsReadable = !v; },
    holdAsks, hold: (f: (p: string, cls: string | null) => Promise<OrphanLeaseHold>): void => { leaseHold = f; },
    addInside: (p: string, cls: string, audit: Record<string, unknown>, inside: string): string => { const h = hexOf(p); trees.set(h, { cls, audit, inside }); return h; },
  };
}

const censuses = (r: ReturnType<typeof rig>): number => r.calls.filter((c) => c[1] === '--orphans').length;

describe('L1: the readers and the licence', () => {
  it('one observation never licenses; the same token an hour later does; a different token restarts', () => {
    const obs = { token: tok('a'), rescue: false, atMono: 10 };
    expect(orphanLicence(null, tok('a'), 10 + 5 * HOUR)).toBe('first');
    expect(orphanLicence(obs, tok('a'), 10 + HOUR - 1)).toBe('early');
    expect(orphanLicence(obs, tok('a'), 10 + HOUR)).toBe('licensed');
    expect(orphanLicence(obs, tok('b'), 10 + 5 * HOUR)).toBe('changed');
  });

  it('a census with one malformed row is unreadable, and an audit for another tree is unreadable', () => {
    const row = { pathHex: '2f61', class: 'claude' };
    expect(parseOrphanCensus(JSON.stringify({ mode: 'orphans', truncated: false, rows: [row] })).kind).toBe('census');
    expect(parseOrphanCensus(JSON.stringify({ mode: 'orphans', truncated: false, rows: [row, { pathHex: 'zz', class: 'claude' }] })).kind).toBe('unreadable');
    expect(parseOrphanCensus(JSON.stringify({ mode: 'orphans', truncated: false, rows: [{ pathHex: '2f61', class: 'weird' }] })).kind).toBe('unreadable');
    const doc = JSON.stringify({ mode: 'orphan', pathHex: '2f61', verdict: 'token', token: tok('a') });
    expect(parseOrphanAudit(doc, '2f61').kind).toBe('token');
    expect(parseOrphanAudit(doc, '2f62').kind).toBe('unreadable');
    expect(parseOrphanAudit(JSON.stringify({ mode: 'orphan', pathHex: '2f61', verdict: 'token', token: 'short' }), '2f61').kind).toBe('unreadable');
  });

  it('the back-off doubles from ORPHAN_RETRY_MS and stops at the pass cadence; the retry instant is the wait after now', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 40].map((s) => orphanTruncatedWaitMs(s, ORPHAN_CENSUS_MS) / MIN)).toEqual([15, 30, 60, 120, 240, 360, 360, 360]);
    expect([1, 2, 3, 4].map((s) => orphanTruncatedWaitMs(s, ORPHAN_CENSUS_PRESSURE_MS) / MIN)).toEqual([15, 30, 60, 60]);
    expect(orphanCensusRetryAt(10 * HOUR, ORPHAN_RETRY_MS)).toEqual({ kind: 'at', mono: 10 * HOUR + ORPHAN_RETRY_MS });
    expect(orphanCensusRetryAt(10 * HOUR, 30 * MIN)).toEqual({ kind: 'at', mono: 10 * HOUR + 30 * MIN });
    for (const pressure of [false, true]) {
      expect(orphanCensusDue(null, 0, pressure)).toBe(true);
      expect(orphanCensusDue({ kind: 'at', mono: 100 }, 99, pressure), `at, 1 ms before, pressure ${pressure}`).toBe(false);
      expect(orphanCensusDue({ kind: 'at', mono: 100 }, 100, pressure), `at, on time, pressure ${pressure}`).toBe(true);
    }
    expect(orphanCensusDue({ kind: 'after', mono: 100 }, 100 + ORPHAN_CENSUS_MS - 1, false)).toBe(false);
    expect(orphanCensusDue({ kind: 'after', mono: 100 }, 100 + ORPHAN_CENSUS_MS, false)).toBe(true);
    expect(orphanCensusDue({ kind: 'after', mono: 100 }, 100 + ORPHAN_CENSUS_PRESSURE_MS - 1, true)).toBe(false);
    expect(orphanCensusDue({ kind: 'after', mono: 100 }, 100 + ORPHAN_CENSUS_PRESSURE_MS, true)).toBe(true);
  });
});

describe('shadow: the lane records and runs no verb', () => {
  it('a passing tree is "would be removed" after its licence, and no ws-orphan runs', async () => {
    const r = rig();
    r.add('/p/.claude/worktrees/a', 'claude', clean('a'));
    await r.sweep.pass();
    expect(r.feed).toEqual([]);
    r.advance(HOUR);
    await r.sweep.pass();
    expect(r.feed.map((f) => f.title)).toEqual(['orphan worktree would be removed']);
    expect(r.feed[0]!.body).toContain('/p/.claude/worktrees/a');
    expect(r.acts()).toEqual([]);
    r.advance(ORPHAN_CENSUS_MS + HOUR);
    await r.sweep.pass();
    expect(r.feed.length, 'a repeat of the same outcome says nothing').toBe(1);
    expect(r.acts()).toEqual([]);
  });

  it('the rescue marker alone does not arm anything', async () => {
    const r = rig();
    r.markers.add(ORPHAN_TREE_RESCUE_LIVE_MARKER);
    r.add('/p/.claude/worktrees/a', 'claude', clean('a'));
    await r.sweep.pass(); r.advance(HOUR); await r.sweep.pass();
    expect(r.acts()).toEqual([]);
  });
});

describe('armed: the licence, the one act per pass, and the rescue arm', () => {
  it('the second unchanged audit an hour later acts, without --force and without --rescue', async () => {
    const r = rig();
    r.markers.add(ORPHAN_TREE_LIVE_MARKER);
    const h = r.add('/p/.claude/worktrees/a', 'claude', clean('a'));
    await r.sweep.pass();
    expect(r.acts(), 'one sighting never acts').toEqual([]);
    r.advance(HOUR - 1);
    await r.sweep.pass();
    expect(r.acts(), 'not yet an hour').toEqual([]);
    r.advance(1);
    await r.sweep.pass();
    expect(r.acts()).toHaveLength(1);
    expect(r.acts()[0]!.slice(0, 5)).toEqual(['ws-orphan', '--expect', tok('a'), '--tree-hex', h]);
    expect(r.acts()[0]).not.toContain('--force');
    expect(r.acts()[0]).not.toContain('--rescue');
    expect(r.feed.map((f) => f.title)).toEqual(['orphan worktree removed']);
  });

  it('a changed token restarts the licence', async () => {
    const r = rig();
    r.markers.add(ORPHAN_TREE_LIVE_MARKER);
    const h = r.add('/p/.claude/worktrees/a', 'claude', clean('a'));
    await r.sweep.pass();
    r.trees.get(h)!.audit = clean('b');
    r.advance(HOUR);
    await r.sweep.pass();
    expect(r.acts(), 'the token moved, so this is a first sighting').toEqual([]);
    r.advance(HOUR);
    await r.sweep.pass();
    expect(r.acts()).toHaveLength(1);
    expect(r.acts()[0]).toContain(tok('b'));
  });

  it('at most one act per pass across every tree', async () => {
    const r = rig();
    r.markers.add(ORPHAN_TREE_LIVE_MARKER);
    r.add('/p1/.claude/worktrees/a', 'claude', clean('a'));
    r.add('/p2/.claude/worktrees/b', 'claude', clean('b'));
    r.add('/p3/.superpowers/worktrees/c', 'superpowers', clean('c'));
    await r.sweep.pass();
    r.advance(HOUR);
    await r.sweep.pass();
    expect(r.acts()).toHaveLength(1);
    r.advance(1000);
    await r.sweep.pass();
    expect(r.acts()).toHaveLength(2);
  });

  it('a learning pass audits at most two trees', async () => {
    const r = rig();
    for (const n of ['a', 'b', 'c', 'd', 'e']) r.add(`/p/.claude/worktrees/${n}`, 'claude', clean(n));
    await r.sweep.pass();
    expect(r.calls.filter((c) => c[1] === '--orphan-hex')).toHaveLength(2);
  });

  it('a head-not-on-remote tree is left without the rescue marker, and rescued and removed with it', async () => {
    const r = rig();
    r.markers.add(ORPHAN_TREE_LIVE_MARKER);
    const h = r.add('/p/.claude/worktrees/a', 'claude', rung9('e'));
    await r.sweep.pass();
    expect(r.feed.map((f) => f.title)).toEqual(['orphan worktree left']);
    expect(r.feed[0]!.body).toContain('commits on no remote');
    r.advance(ORPHAN_CENSUS_MS); await r.sweep.pass(); r.advance(HOUR); await r.sweep.pass();
    expect(r.acts(), 'no rescue marker: left').toEqual([]);
    expect(r.feed).toHaveLength(1);
    r.markers.add(ORPHAN_TREE_RESCUE_LIVE_MARKER);
    r.advance(ORPHAN_CENSUS_MS); await r.sweep.pass();
    expect(r.acts()).toEqual([]);
    r.advance(HOUR); await r.sweep.pass();
    expect(r.acts()).toHaveLength(1);
    expect(r.acts()[0]!.slice(0, 6)).toEqual(['ws-orphan', '--expect', tok('e'), '--tree-hex', h, '--rescue']);
    expect(r.feed.at(-1)!.title).toBe('orphan worktree removed');
    expect(r.feed.at(-1)!.body).toContain('pinned');
  });
});

describe('gates', () => {
  it('reclaim-paused stops audits and acts, and breaks the first sighting', async () => {
    const r = rig();
    r.markers.add(ORPHAN_TREE_LIVE_MARKER);
    r.add('/p/.claude/worktrees/a', 'claude', clean('a'));
    await r.sweep.pass();
    r.markers.add(RECLAIM_PAUSE_MARKER);
    r.advance(HOUR);
    const before = r.calls.length;
    await r.sweep.pass();
    expect(r.calls.length, 'a paused pass asks ccd nothing').toBe(before);
    r.markers.delete(RECLAIM_PAUSE_MARKER);
    await r.sweep.pass();
    expect(r.acts(), 'the pause broke the first sighting: this audit is a first one').toEqual([]);
  });

  it('a box without orphan-v1 is skipped: no census, no audit, no act', async () => {
    for (const verbs of [['reclaim-pause-v1'], null]) {
      const r = rig(verbs);
      r.markers.add(ORPHAN_TREE_LIVE_MARKER);
      r.add('/p/.claude/worktrees/a', 'claude', clean('a'));
      await r.sweep.pass(); r.advance(HOUR); await r.sweep.pass();
      expect(r.calls).toEqual([]);
    }
  });

  it('a truncated census audits nothing new', async () => {
    const r = rig();
    r.add('/p/.claude/worktrees/a', 'claude', clean('a'));
    r.truncate(true);
    await r.sweep.pass();
    expect(r.calls.filter((c) => c[1] === '--orphan-hex')).toEqual([]);
  });

  // #1565 (D-6987): a truncated census is asked again on a back-off, not after the full cadence.
  it('a truncated census is asked again on a back-off: 15, 30, 60, 120 and 240 min, then 6 h', async () => {
    const r = rig();
    r.add('/p/.claude/worktrees/a', 'claude', clean('a'));
    r.truncate(true);
    await r.sweep.pass();
    expect(censuses(r)).toBe(1);
    let n = 1;
    for (const wait of [15, 30, 60, 120, 240, 360, 360]) {
      r.advance(wait * MIN - 1); await r.sweep.pass();
      expect(censuses(r), `before ${wait} min`).toBe(n);
      r.advance(1); await r.sweep.pass(); n += 1;
      expect(censuses(r), `at ${wait} min`).toBe(n);
    }
  });

  it('under pressure the truncated back-off stops at the hourly cadence: 15, 30, 60, then 60 min', async () => {
    const r = rig(); r.pressured(true);
    r.add('/p/.claude/worktrees/a', 'claude', clean('a'));
    r.truncate(true);
    await r.sweep.pass();
    expect(censuses(r)).toBe(1);
    let n = 1;
    for (const wait of [15, 30, 60, 60]) {
      r.advance(wait * MIN - 1); await r.sweep.pass();
      expect(censuses(r), `before ${wait} min`).toBe(n);
      r.advance(1); await r.sweep.pass(); n += 1;
      expect(censuses(r), `at ${wait} min`).toBe(n);
    }
  });

  it('under pressure the census is hourly, and not otherwise', async () => {
    for (const p of [true, false]) {
      const r = rig(); r.pressured(p); r.add('/p/.claude/worktrees/a', 'claude', clean('a'));
      await r.sweep.pass(); r.advance(ORPHAN_CENSUS_PRESSURE_MS); await r.sweep.pass();
      expect(censuses(r), `pressure ${p}`).toBe(p ? 2 : 1);
    }
  });

  it('under pressure a pass offers 4 learning audits, else 2', async () => {
    for (const p of [true, false]) {
      const r = rig(); r.pressured(p);
      for (const c of 'abcde') r.add(`/p/.claude/worktrees/${c}`, 'claude', clean(c));
      await r.sweep.pass();
      expect(r.calls.filter((c) => c[1] === '--orphan-hex')).toHaveLength(p ? ORPHAN_AUDITS_PER_PASS_PRESSURE : ORPHAN_AUDITS_PER_PASS);
    }
  });

  it('orphanPressure is true only on a held pressure block; null is unknown and reads as none', () => {
    expect(orphanPressure(null)).toBe(false);
    expect(orphanPressure({ pressure: false })).toBe(false);
    expect(orphanPressure({ pressure: true })).toBe(true);
  });

  it('a whole census resets the back-off', async () => {
    const r = rig();
    r.add('/p/.claude/worktrees/a', 'claude', clean('a'));
    r.truncate(true);
    await r.sweep.pass(); r.advance(15 * MIN); await r.sweep.pass(); r.advance(30 * MIN); await r.sweep.pass();
    r.truncate(false); r.advance(60 * MIN); await r.sweep.pass();
    expect(censuses(r)).toBe(4);
    r.truncate(true); r.advance(ORPHAN_CENSUS_MS); await r.sweep.pass();
    expect(censuses(r)).toBe(5);
    r.advance(ORPHAN_RETRY_MS - 1); await r.sweep.pass();
    expect(censuses(r), 'the streak started over').toBe(5);
    r.advance(1); await r.sweep.pass();
    expect(censuses(r)).toBe(6);
  });

  // D-6989: an unreadable census keeps its flat retry.
  it('an unreadable census is asked again after ORPHAN_RETRY_MS, and not before', async () => {
    const r = rig();
    r.add('/p/.claude/worktrees/a', 'claude', clean('a'));
    r.garbled(true);
    await r.sweep.pass();
    expect(censuses(r)).toBe(1);
    for (let i = 2; i <= 4; i += 1) {
      r.advance(ORPHAN_RETRY_MS - 1); await r.sweep.pass();
      expect(censuses(r), `before retry ${i}`).toBe(i - 1);
      r.advance(1); await r.sweep.pass();
      expect(censuses(r), `at retry ${i}`).toBe(i);
    }
    expect(r.feed).toEqual([]);
  });

  it('an unreadable census between truncated ones neither resets nor extends the back-off', async () => {
    const r = rig();
    r.add('/p/.claude/worktrees/a', 'claude', clean('a'));
    r.truncate(true);
    await r.sweep.pass(); r.advance(15 * MIN); await r.sweep.pass();
    r.garbled(true); r.advance(30 * MIN); await r.sweep.pass(); r.garbled(false);
    r.advance(ORPHAN_RETRY_MS); await r.sweep.pass();
    expect(censuses(r)).toBe(4);
    r.advance(60 * MIN - 1); await r.sweep.pass();
    expect(censuses(r), 'the third truncated census in a row waits 60 min').toBe(4);
    r.advance(1); await r.sweep.pass();
    expect(censuses(r)).toBe(5);
  });

  it('a truncated census keeps the memory it learned before, and audits nothing that pass', async () => {
    const r = rig();
    r.add('/p/.claude/worktrees/a', 'claude', refused('dirty'));
    await r.sweep.pass();
    const before = r.sweep.health();
    const audits = r.calls.filter((c) => c[1] === '--orphan-hex').length;
    r.add('/p/.claude/worktrees/b', 'claude', clean('b'));
    r.truncate(true); r.advance(ORPHAN_CENSUS_MS); await r.sweep.pass();
    expect(r.sweep.health()).toEqual(before);
    expect(r.calls.filter((c) => c[1] === '--orphan-hex'), 'a due tree in memory is not audited either').toHaveLength(audits);
    r.truncate(false); r.advance(ORPHAN_RETRY_MS); await r.sweep.pass();
    expect(r.feed.filter((f) => f.title === 'orphan worktree left')).toHaveLength(1);
  });

  // #1565 (D-7864; review 990 F1): a pending retry is a due instant, so a later pass's pressure never moves it.
  const arms: ReadonlyArray<readonly [string, (r: ReturnType<typeof rig>) => void]> = [
    ['truncated', (r) => r.truncate(true)],
    ['unreadable', (r) => r.garbled(true)],
  ];

  it('pressure rising over a pending retry does not shorten it', async () => {
    for (const [arm, set] of arms) {
      const r = rig();
      r.add('/p/.claude/worktrees/a', 'claude', clean('a'));
      set(r);
      await r.sweep.pass();
      expect(censuses(r), arm).toBe(1);
      r.pressured(true);
      r.advance(ORPHAN_RETRY_MS - 1); await r.sweep.pass();
      expect(censuses(r), `${arm}: 1 ms before the retry`).toBe(1);
      r.advance(1); await r.sweep.pass();
      expect(censuses(r), `${arm}: at the retry`).toBe(2);
    }
  });

  it('a back-off capped at the 6 h cadence is not cut short when pressure rises after it', async () => {
    const r = rig();
    r.add('/p/.claude/worktrees/a', 'claude', clean('a'));
    r.truncate(true);
    await r.sweep.pass();
    for (const wait of [15, 30, 60, 120, 240]) {
      r.advance(wait * MIN); await r.sweep.pass();
    }
    expect(censuses(r), 'streak driven to 6').toBe(6);
    r.pressured(true);
    r.advance(ORPHAN_CENSUS_PRESSURE_MS); await r.sweep.pass();
    expect(censuses(r), 'an hour after pressure rises').toBe(6);
    r.advance(360 * MIN - ORPHAN_CENSUS_PRESSURE_MS - 1); await r.sweep.pass();
    expect(censuses(r), '1 ms before the 6 h retry').toBe(6);
    r.advance(1); await r.sweep.pass();
    expect(censuses(r), 'at the 6 h retry').toBe(7);
  });

  it('pressure clearing over a pending retry does not lengthen it', async () => {
    for (const [arm, set] of arms) {
      const r = rig();
      r.add('/p/.claude/worktrees/a', 'claude', clean('a'));
      r.pressured(true);
      set(r);
      await r.sweep.pass();
      expect(censuses(r), arm).toBe(1);
      r.pressured(false);
      r.advance(ORPHAN_RETRY_MS - 1); await r.sweep.pass();
      expect(censuses(r), `${arm}: 1 ms before the retry`).toBe(1);
      r.advance(1); await r.sweep.pass();
      expect(censuses(r), `${arm}: at the retry`).toBe(2);
    }
  });

  it('after a whole census the cadence is the reading pass\'s: rising pressure brings the next census to an hour', async () => {
    const r = rig();
    r.add('/p/.claude/worktrees/a', 'claude', clean('a'));
    await r.sweep.pass();
    expect(censuses(r)).toBe(1);
    r.pressured(true);
    r.advance(ORPHAN_CENSUS_PRESSURE_MS - 1); await r.sweep.pass();
    expect(censuses(r)).toBe(1);
    r.advance(1); await r.sweep.pass();
    expect(censuses(r)).toBe(2);
  });

  it('the classes ccd reports and the lane never audits stay unaudited', async () => {
    const r = rig();
    r.add('/elsewhere/tree', 'other', clean('a'));
    r.add('/p/.claude/worktrees/ghost', 'not-a-worktree', clean('b'));
    await r.sweep.pass();
    expect(r.calls.filter((c) => c[1] === '--orphan-hex')).toEqual([]);
  });
});

describe('the feed and the health block', () => {
  it('one row per change of outcome, none per repeat', async () => {
    const r = rig();
    const h = r.add('/p/.claude/worktrees/a', 'claude', refused('dirty', '3 files'));
    await r.sweep.pass();
    r.advance(ORPHAN_CENSUS_MS); await r.sweep.pass();
    r.advance(ORPHAN_CENSUS_MS); await r.sweep.pass();
    expect(r.feed.map((f) => f.title)).toEqual(['orphan worktree left']);
    r.trees.get(h)!.audit = refused('in-use');
    r.advance(ORPHAN_CENSUS_MS); await r.sweep.pass();
    expect(r.feed).toHaveLength(2);
    expect(r.feed[1]!.body).toContain('a process holds it');
  });

  it('disk.orphanTrees counts by class and outcome, and reads back through the one reader', async () => {
    const r = rig();
    expect(r.sweep.health(), 'unknown before the first census').toBeNull();
    r.add('/p/.claude/worktrees/a', 'claude', refused('dirty'));
    r.add('/p/.claude/worktrees/b', 'claude', clean('b'));
    r.add('/w/p/still-cove', 'ccd-root', clean('c'));
    r.add('/x', 'other', clean('d'));
    await r.sweep.pass();
    const h = r.sweep.health()!;
    expect(h.byClass).toEqual({ 'ccd-root': 1, claude: 2, superpowers: 0, other: 1, 'not-a-worktree': 0 });
    expect(h.byOutcome).toEqual({ pending: 2, would: 0, left: 1, removed: 0 });
    const block = { at: 1, level: 'ok', pressure: false, filesystems: [], expectedMounts: [], holders: [], orphanTrees: h };
    expect(readDiskHealth({ disk: block })!.orphanTrees).toEqual(h);
    expect(readDiskHealth({ disk: { ...block, orphanTrees: { byClass: {}, byOutcome: {} } } })!.orphanTrees, 'malformed drops alone').toBeUndefined();
    expect(readDiskHealth({ disk: { ...block, orphanTrees: undefined } })!.orphanTrees).toBeUndefined();
  });

  // #1565 (D-6988): one row and one log line per truncated census, naming the rows seen, the time taken and the wait.
  it('each truncated census writes one feed row and one log line with the rows it saw, the time it took and the wait', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const said = (): number => warn.mock.calls.filter((c) => String(c[0]).startsWith('ccrc-server: orphan census truncated')).length;
    try {
      const r = rig();
      r.add('/p/.claude/worktrees/a', 'claude', clean('a'));
      r.add('/p/.claude/worktrees/b', 'claude', clean('b'));
      r.truncate(true); r.censusTakes(59_700);
      await r.sweep.pass(); await r.sweep.pass();
      expect(r.feed, 'a pass with no census due writes nothing').toEqual([orphanTruncatedRow(2, 59_700, ORPHAN_RETRY_MS)]);
      expect(r.feed[0]!.title).toBe('orphan census truncated');
      expect(r.feed[0]!.body).toContain('after 2 rows in 59.7 s');
      expect(r.feed[0]!.body).toContain('asked again in 15 min');
      expect(said()).toBe(1);
      r.advance(ORPHAN_RETRY_MS); await r.sweep.pass();
      expect(r.feed).toHaveLength(2);
      expect(r.feed[1]!.body).toContain('asked again in 30 min');
      expect(said()).toBe(2);
    } finally { warn.mockRestore(); }
  });

  it('a truncated census leaves health unknown before the first whole census', async () => {
    const r = rig();
    r.add('/p/.claude/worktrees/a', 'claude', clean('a'));
    r.truncate(true);
    await r.sweep.pass();
    expect(r.sweep.health()).toBeNull();
  });
});

describe('the executor stops on its own, whatever the pass did', () => {
  const hex = hexOf('/p/.claude/worktrees/a');
  const exec = (listings: string[][], calls: string[][]) => {
    let n = 0;
    const deps = {
      io: { readdirMeasured: async () => ({ ok: true, entries: listings[Math.min(n++, listings.length - 1)]! }) } as never,
      registryDir: '/reg', epochNow: () => 1, fleetState: { ccdVerbs: ['orphan-v1'] }, leaseHold: async () => ({ kind: 'free' }),
      runCcd: async (argv: readonly string[]) => {
        calls.push([...argv]);
        return { ran: true, ok: true, stdout: JSON.stringify({ mode: 'orphan', pathHex: hex, verdict: 'token', token: tok('a') }), stderr: '', killed: false, signal: null };
      },
    };
    return collectOrphanTree(deps as never, hex, 'claude', { token: tok('a'), rescue: false, atMono: 0 }, () => 2 * HOUR, 1);
  };

  it('a pause standing at the job asks ccd nothing', async () => {
    const calls: string[][] = [];
    expect(await exec([[ORPHAN_TREE_LIVE_MARKER, RECLAIM_PAUSE_MARKER]], calls)).toEqual({ kind: 'stopped', why: 'paused' });
    expect(calls).toEqual([]);
  });

  it('a pause raised after the audit stops the act: the last listing is read again', async () => {
    const calls: string[][] = [];
    expect(await exec([[ORPHAN_TREE_LIVE_MARKER], [ORPHAN_TREE_LIVE_MARKER, RECLAIM_PAUSE_MARKER]], calls)).toEqual({ kind: 'stopped', why: 'paused' });
    expect(calls.map((c) => c[0] + ' ' + c[1])).toEqual(['ws-audit --orphan-hex']);
  });

  it('an unlistable registry reads as a pause', async () => {
    const calls: string[][] = [];
    const deps = {
      io: { readdirMeasured: async () => ({ ok: false, reason: 'unreadable' }) } as never, registryDir: '/reg', epochNow: () => 1,
      fleetState: { ccdVerbs: ['orphan-v1'] }, leaseHold: async () => ({ kind: 'free' }), runCcd: async (a: readonly string[]) => { calls.push([...a]); throw new Error('no'); },
    };
    expect(await collectOrphanTree(deps as never, hex, 'claude', null, () => 0, 1)).toEqual({ kind: 'stopped', why: 'paused' });
    expect(calls).toEqual([]);
  });

  it('a moved connection epoch stops the act', async () => {
    const calls: string[][] = [];
    const deps = {
      io: { readdirMeasured: async () => ({ ok: true, entries: [ORPHAN_TREE_LIVE_MARKER] }) } as never, registryDir: '/reg', epochNow: () => 2,
      fleetState: { ccdVerbs: ['orphan-v1'] }, leaseHold: async () => ({ kind: 'free' }),
      runCcd: async (a: readonly string[]) => { calls.push([...a]); return { ran: true, ok: true, stdout: JSON.stringify({ mode: 'orphan', pathHex: hex, verdict: 'token', token: tok('a') }), stderr: '', killed: false, signal: null }; },
    };
    expect(await collectOrphanTree(deps as never, hex, 'claude', { token: tok('a'), rescue: false, atMono: 0 }, () => 2 * HOUR, 1)).toEqual({ kind: 'stopped', why: 'epoch' });
    expect(calls.some((c) => c[0] === 'ws-orphan')).toBe(false);
  });
});

describe('DR-23: trees nested inside a workspace', () => {
  const armed = (r: ReturnType<typeof rig>): void => { r.markers.add(ORPHAN_TREE_LIVE_MARKER); };
  const audits = (r: ReturnType<typeof rig>): string[][] => r.calls.filter((c) => c[1] === '--orphan-hex');

  it('inside a coordinator: a candidate, audited, licensed and removed like any other', async () => {
    const r = rig(); armed(r); r.coordinators.add('lane-a');
    r.addInside('/p/.claude/worktrees/ghost', 'claude', clean('a'), 'lane-a');
    await r.sweep.pass(); r.advance(HOUR); await r.sweep.pass();
    expect(r.acts()).toHaveLength(1);
  });

  it('a <main>/.claude/worktrees tree inside a row that is no workspace (plain session, main checkout) is a candidate', async () => {
    const r = rig(); armed(r); r.wsKinds.set('demo-main', false);
    r.addInside('/p/.claude/worktrees/ghost', 'claude', clean('a'), 'demo-main');
    await r.sweep.pass(); r.advance(HOUR); await r.sweep.pass();
    expect(r.acts()).toHaveLength(1);
    expect(r.feed.filter((f) => f.body.includes('goes with its workspace'))).toHaveLength(0);
  });

  it('a containing row that cannot be read (null or a throw) keeps the tree: no audit, no act', async () => {
    for (const k of [null, 'throw'] as const) {
      const r = rig(); armed(r); r.wsKinds.set('demo-main', k);
      r.addInside('/p/.claude/worktrees/ghost', 'claude', clean('a'), 'demo-main');
      await r.sweep.pass(); r.advance(HOUR); await r.sweep.pass();
      expect(audits(r)).toEqual([]);
      expect(r.acts()).toEqual([]);
    }
  });

  it('inside a worker: reported once as going with its workspace, never audited or removed', async () => {
    const r = rig(); armed(r);
    r.addInside('/p/.claude/worktrees/ghost', 'claude', clean('a'), 'worker-a');
    await r.sweep.pass(); r.advance(ORPHAN_CENSUS_MS); await r.sweep.pass(); r.advance(ORPHAN_CENSUS_MS); await r.sweep.pass();
    expect(audits(r)).toEqual([]);
    expect(r.acts()).toEqual([]);
    expect(r.feed.filter((f) => f.body.includes('goes with its workspace'))).toHaveLength(1);
  });

  it('the claim read unreadable: not a candidate, and nothing is audited', async () => {
    const r = rig(); armed(r); r.coordinators.add('lane-a'); r.unreadable(true);
    r.addInside('/p/.claude/worktrees/ghost', 'claude', clean('a'), 'lane-a');
    await r.sweep.pass(); r.advance(HOUR); await r.sweep.pass();
    expect(audits(r)).toEqual([]);
    expect(r.acts()).toEqual([]);
  });

  it('a claim read that fails between the audits holds the act and the second audit; once readable the act proceeds', async () => {
    const r = rig(); armed(r); r.coordinators.add('lane-a');
    r.addInside('/p/.claude/worktrees/ghost', 'claude', clean('a'), 'lane-a');
    await r.sweep.pass();
    expect(audits(r)).toHaveLength(1);
    r.unreadable(true); r.advance(HOUR); await r.sweep.pass();
    expect(r.acts()).toEqual([]);
    expect(audits(r), 'no new audit while the coordinator list is unreadable').toHaveLength(1);
    r.unreadable(false); r.advance(HOUR); await r.sweep.pass();
    expect(r.acts()).toHaveLength(1);
  });

  it('a census whose claim read fails says so once per episode', async () => {
    const r = rig(); armed(r); r.unreadable(true);
    r.addInside('/p/.claude/worktrees/ghost', 'claude', clean('a'), 'lane-a');
    await r.sweep.pass(); r.advance(ORPHAN_CENSUS_MS); await r.sweep.pass(); r.advance(ORPHAN_CENSUS_MS); await r.sweep.pass();
    expect(r.feed.filter((f) => f.body.includes('coordinator list could not be read'))).toHaveLength(1);
  });

  it('a worker tree that leaves the census is forgotten, so it is reported again if it returns', async () => {
    const r = rig(); armed(r);
    const h = r.addInside('/p/.claude/worktrees/ghost', 'claude', clean('a'), 'worker-a');
    await r.sweep.pass();
    r.trees.delete(h); r.advance(ORPHAN_CENSUS_MS); await r.sweep.pass();
    r.addInside('/p/.claude/worktrees/ghost', 'claude', clean('a'), 'worker-a');
    r.advance(ORPHAN_CENSUS_MS); await r.sweep.pass();
    expect(r.feed.filter((f) => f.body.includes('goes with its workspace'))).toHaveLength(2);
  });

  it('a coordinator whose runs are all terminal is still a candidate, and the act goes ahead', async () => {
    const claims = new Map<string, unknown>([['lane-a', 7]]);
    const set = orphanCoordinatorSet({ everClaimedIds: () => claims.keys(), openCoordinatorIds: () => [] });
    expect(set?.has('lane-a')).toBe(true);
    const r = rig(); armed(r); for (const id of set!) r.coordinators.add(id);
    r.addInside('/p/.claude/worktrees/ghost', 'claude', clean('a'), 'lane-a');
    await r.sweep.pass(); r.advance(HOUR); await r.sweep.pass();
    expect(r.acts()).toHaveLength(1);
  });

  it('a displacement-only claimant is a candidate; one that never claimed anything is reported only', () => {
    const claims = new Map<string, unknown>([['displaced', 'unplaced'], ['open-one', 'open']]);
    const set = orphanCoordinatorSet({ everClaimedIds: () => claims.keys(), openCoordinatorIds: () => ['open-one'] });
    expect(orphanInsideVerdict('displaced', set, () => true)).toBe('candidate');
    expect(orphanInsideVerdict('open-one', set, () => true)).toBe('candidate');
    expect(orphanInsideVerdict('worker-w', set, () => true)).toBe('goes-with-workspace');
  });

  it('either claim read throwing is null, which keeps the tree', () => {
    const boom = (): never => { throw new Error('x'); };
    expect(orphanCoordinatorSet({ everClaimedIds: boom, openCoordinatorIds: () => [] })).toBeNull();
    expect(orphanCoordinatorSet({ everClaimedIds: () => [], openCoordinatorIds: boom })).toBeNull();
    expect(orphanInsideVerdict('lane-a', null, () => true)).toBe('unmeasured');
    expect(orphanInsideVerdict('plain', null, () => false)).toBe('candidate');
    expect(orphanInsideVerdict('plain', new Set(), () => null)).toBe('unmeasured');
  });

  it('a tree inside nothing is unaffected, and a census row with a malformed inside is unreadable', () => {
    const row = (inside: unknown): string => JSON.stringify({ mode: 'orphans', truncated: false, rows: [{ pathHex: '61', class: 'claude', inside }] });
    expect(parseOrphanCensus(row(null))).toMatchObject({ kind: 'census', rows: [{ inside: null }] });
    expect(parseOrphanCensus(row('lane-a'))).toMatchObject({ kind: 'census', rows: [{ inside: 'lane-a' }] });
    expect(parseOrphanCensus(row('../x'))).toEqual({ kind: 'unreadable' });
    expect(parseOrphanCensus(row('a'.repeat(200)))).toMatchObject({ kind: 'census', rows: [{ inside: 'a'.repeat(200) }] });
    expect(parseOrphanCensus(row('-x'))).toEqual({ kind: 'unreadable' });
    expect(parseOrphanCensus(row(7))).toEqual({ kind: 'unreadable' });
  });

  it('the rescue token stays behind its own marker for a nested tree', async () => {
    const r = rig(); armed(r); r.coordinators.add('lane-a');
    r.addInside('/p/.claude/worktrees/ghost', 'claude', rung9('a'), 'lane-a');
    await r.sweep.pass(); r.advance(HOUR); await r.sweep.pass();
    expect(r.acts()).toEqual([]);
  });

  it('a rung-11-only rescue token is left under orphan-tree-live alone, and spent with --rescue under both markers', async () => {
    const r = rig(); r.markers.add(ORPHAN_TREE_LIVE_MARKER); r.coordinators.add('lane-a');
    const h = r.addInside('/p/.claude/worktrees/wf_x', 'claude', rung11('b'), 'lane-a');
    await r.sweep.pass(); r.advance(HOUR); await r.sweep.pass();
    expect(r.acts(), 'no rescue marker: left').toEqual([]);
    expect(r.feed[0]!.body).toContain('rescue arm is not armed');
    r.markers.add(ORPHAN_TREE_RESCUE_LIVE_MARKER);
    r.advance(ORPHAN_CENSUS_MS); await r.sweep.pass(); r.advance(HOUR); await r.sweep.pass();
    expect(r.acts()).toHaveLength(1);
    expect(r.acts()[0]!.slice(0, 6)).toEqual(['ws-orphan', '--expect', tok('b'), '--tree-hex', h, '--rescue']);
  });
});

describe('an unreadable containing row is reported once per tree', () => {
  it('says why the tree is kept, once across censuses, and again after the tree is gone and returns', async () => {
    const r = rig();
    r.wsKinds.set('demo-main', null);
    const h = r.addInside('/p/.claude/worktrees/a', 'claude', clean('a'), 'demo-main');
    await r.sweep.pass();
    const said = (): string[] => r.feed.filter((f) => f.body.includes('its containing row could not be read')).map((f) => f.body);
    expect(said()).toHaveLength(1);
    expect(said()[0]).toContain('/p/.claude/worktrees/a');
    r.advance(ORPHAN_CENSUS_MS); await r.sweep.pass();
    expect(said(), 'a repeat says nothing').toHaveLength(1);
    expect(r.acts()).toEqual([]);
    r.trees.delete(h);
    r.advance(ORPHAN_CENSUS_MS); await r.sweep.pass();
    r.addInside('/p/.claude/worktrees/a', 'claude', clean('a'), 'demo-main');
    r.advance(ORPHAN_CENSUS_MS); await r.sweep.pass();
    expect(said()).toHaveLength(2);
  });
});

// Delegation broker wave 5 PR4 (Task 5.4.3, D-7828, D-7811, D-7850): the server skip. The executor asks the delegation hold after
// the audit and before the licence, with the census row's class and the tree's EXACT decoded path; `held` and `not-ready` compose
// no `ws-orphan`, and `not-ready` stops only `claude`/`superpowers` trees.
describe('the delegation hold', () => {
  /** Passes until each ripe tree has been offered the act: a first sighting, an hour, then one act per pass. */
  const settle = async (r: ReturnType<typeof rig>, passes = 4): Promise<void> => {
    await r.sweep.pass();
    r.advance(HOUR);
    for (let i = 0; i < passes; i += 1) { await r.sweep.pass(); r.advance(1); }
  };

  it('W5-O13: a held tree composes no ws-orphan; a free one composes exactly what it did before', async () => {
    const held = rig(); held.markers.add(ORPHAN_TREE_LIVE_MARKER);
    const h = held.add('/p/.claude/worktrees/a', 'claude', clean('a'));
    held.hold(async () => ({ kind: 'held', leaseId: 'l-1', state: 'retained', until: '2026-12-01T00:00:00.000Z' }));
    await settle(held);
    expect(held.acts()).toEqual([]);
    expect(held.holdAsks.length).toBeGreaterThan(0);
    expect(held.holdAsks[0]).toEqual({ path: '/p/.claude/worktrees/a', cls: 'claude' });
    expect(held.trees.has(h)).toBe(true);
    const free = rig(); free.markers.add(ORPHAN_TREE_LIVE_MARKER);
    const f = free.add('/p/.claude/worktrees/a', 'claude', clean('a'));
    await settle(free);
    expect(free.acts()).toEqual([['ws-orphan', '--expect', tok('a'), '--tree-hex', f, '--surface', 'agent', '--actor', 'orphan-tree sweep']]);
  });

  it('W5-O13: the real hold over a ready checkpoint matches a long path, and one holding a tab, byte for byte', async () => {
    const long = `/p/.claude/worktrees/${'x'.repeat(320)}`;
    for (const p of [long, '/p/.claude/worktrees/a\tb']) {
      expect(p.length > 300 || p.includes('\t')).toBe(true);
      const cp = checkpointWithLease({ canonicalPath: p, disposition: 'retained', cleanupDueAt: '2099-01-01T00:00:00.000Z' });
      const r = rig(); r.markers.add(ORPHAN_TREE_LIVE_MARKER);
      r.add(p, 'claude', clean('a'));
      r.hold(beatLeaseHold(() => cp));
      await settle(r);
      expect(r.holdAsks[0]).toEqual({ path: p, cls: 'claude' });
      expect(await beatLeaseHold(() => cp)(p, 'claude')).toMatchObject({ kind: 'held', state: 'retained' });
      expect(r.acts()).toEqual([]);
    }
  });

  it('W5-O13b: an unready checkpoint stops the claude tree, composes the ccd-root tree as before, and is counted', async () => {
    const r = rig(); r.markers.add(ORPHAN_TREE_LIVE_MARKER);
    const c = r.add('/p/.claude/worktrees/a', 'claude', clean('a'));
    const w = r.add('/w/p/still-cove', 'ccd-root', clean('c'));
    r.hold(beatLeaseHold(() => null));
    await settle(r);
    expect(r.acts().map((a) => a[a.indexOf('--tree-hex') + 1])).toEqual([w]);
    expect(r.acts()).toEqual([['ws-orphan', '--expect', tok('c'), '--tree-hex', w, '--surface', 'agent', '--actor', 'orphan-tree sweep']]);
    expect(r.trees.has(c)).toBe(true);
    expect(r.holdAsks.map((a) => a.cls).sort()).toEqual(['ccd-root', 'claude']);
    expect(r.sweep.health()!.leaseUnready).toBe(1);
    expect(r.feed.map((x) => x.title)).toEqual(['orphan worktree removed']);   // the stop says nothing
  });

  it('W5-O13c: a tree the lane holds no row for has an unknown class, which an unready checkpoint stops, never frees', async () => {
    const r = rig(); r.markers.add(ORPHAN_TREE_LIVE_MARKER);
    const h = r.add('/p/.claude/worktrees/a', 'claude', clean('a'));
    const obs = { token: tok('a'), rescue: false, atMono: 0 };
    const deps = { ...r.deps, leaseHold: beatLeaseHold(() => null) };
    expect(await collectOrphanTree(deps, h, null, obs, () => 10 * HOUR, 1)).toEqual({ kind: 'stopped', why: 'lease-unready' });
    expect(r.acts()).toEqual([]);
    const cp = checkpointWithLease({ canonicalPath: '/p/other', disposition: 'retained', cleanupDueAt: '2099-01-01T00:00:00.000Z' });
    expect(await collectOrphanTree({ ...r.deps, leaseHold: beatLeaseHold(() => cp) }, h, null, obs, () => 10 * HOUR, 1))
      .toMatchObject({ kind: 'result', result: { kind: 'removed' } });                  // CONTROL: a ready checkpoint reads any class
  });

  it('W5-O13d: the lease-unready count clears on any later outcome and when the census drops the tree, and counts a returning tree once', async () => {
    const r = rig(); r.markers.add(ORPHAN_TREE_LIVE_MARKER);
    const p = '/p/.claude/worktrees/a';
    const h = r.add(p, 'claude', clean('a'));
    r.hold(beatLeaseHold(() => null));
    await settle(r);
    expect(r.sweep.health()!.leaseUnready).toBe(1);
    // the box's own `leased` answers the next learning audit: the tree is no longer unready, the count goes
    r.trees.set(h, { cls: 'claude', audit: refused('leased', 'lease l-1 holds this tree (adopted) until 2099-01-01T00:00:00.000Z, and for 3600 s after') });
    r.advance(ORPHAN_RETRY_MS); await r.sweep.pass();
    expect(r.calls.filter((c) => c[1] === '--orphan-hex').length).toBeGreaterThan(1);
    expect(r.sweep.health()!.leaseUnready).toBeUndefined();
    // stopped again, then the census no longer lists it, then lists it again
    r.trees.set(h, { cls: 'claude', audit: clean('a') });
    r.advance(ORPHAN_CENSUS_MS); await settle(r);
    expect(r.sweep.health()!.leaseUnready).toBe(1);
    r.trees.delete(h);
    r.advance(ORPHAN_CENSUS_MS); await r.sweep.pass();
    expect(r.sweep.health()!.leaseUnready).toBeUndefined();
    r.add(p, 'claude', clean('a'));
    r.advance(ORPHAN_CENSUS_MS); await r.sweep.pass();
    expect(r.sweep.health()!.leaseUnready, 'a returning tree is not counted before it is stopped again').toBeUndefined();
    r.advance(1); await settle(r);
    expect(r.sweep.health()!.leaseUnready, 'and once after').toBe(1);
  });

  it('W5-O13h: a learning audit after which an act follows leaves the lease-unready count; the act that follows decides it', async () => {
    const r = rig(); r.markers.add(ORPHAN_TREE_LIVE_MARKER);
    const h = r.add('/p/.claude/worktrees/a', 'claude', clean('a'));
    r.hold(beatLeaseHold(() => null));
    await settle(r);
    expect(r.sweep.health()!.leaseUnready).toBe(1);
    const audits = (): number => r.calls.filter((c) => c[1] === '--orphan-hex').length;
    const before = audits();
    r.advance(ORPHAN_RETRY_MS); await r.sweep.pass();                     // the learning audit answers `token`: an act follows
    expect(audits()).toBe(before + 1);
    expect(r.sweep.health()!.leaseUnready, 'a token audit measures nothing about readiness').toBe(1);
    r.trees.set(h, { cls: 'claude', audit: refused('dirty', 'one modified file') });
    r.advance(ORPHAN_LICENCE_MS); await r.sweep.pass();                   // the act that follows: its audit refuses, an outcome other
                                                                          // than lease-unready, so the entry goes (W5-O13d has the
                                                                          // learning audit's own refusal, the box's `leased`)
    expect(audits()).toBe(before + 2);
    expect(r.sweep.health()!.leaseUnready).toBeUndefined();
    // the rule itself (L1): only a refusal or an unarmed rescuable ends the wait
    const answers = [
      { kind: 'token', token: tok('a') }, { kind: 'rescuable', word: 'head-not-on-remote', rescueToken: tok('b'), detail: '' },
      { kind: 'refused', word: 'leased', detail: '' }, { kind: 'unmeasured', detail: '' }, { kind: 'unreadable', detail: '' },
    ] as const;
    expect(answers.map((a) => [orphanAuditEndsHoldWait(a as never, false), orphanAuditEndsHoldWait(a as never, true)]))
      .toEqual([[false, false], [true, false], [true, true], [false, false], [false, false]]);
  });

  it('W5-O13e: the box\'s `leased` refusal is said as a sentence, its expiry an ISO instant', async () => {
    const r = rig();
    const detail = 'lease l-1 holds this tree (adopted) until 2099-01-01T00:00:00.000Z, and for 3600 s after';
    r.add('/p/.claude/worktrees/a', 'claude', refused('leased', detail));
    await r.sweep.pass();
    const left = r.feed.filter((x) => x.title === 'orphan worktree left');
    expect(left).toHaveLength(1);
    expect(left[0]!.body).toBe(`/p/.claude/worktrees/a (claude): a delegation lease holds it (${detail})`);
    expect(left[0]!.body).not.toMatch(/ccd answered|epoch ms/);
  });

  it('W5-O13f: readDiskHealth reads leaseUnready above zero and leaves it out when absent or malformed', () => {
    const counts = { byClass: { 'ccd-root': 0, claude: 1, superpowers: 0, other: 0, 'not-a-worktree': 0 }, byOutcome: { pending: 1, would: 0, left: 0, removed: 0 } };
    const block = (orphanTrees: unknown) => ({ disk: { at: 1, level: 'ok', pressure: false, filesystems: [], expectedMounts: [], holders: [], orphanTrees } });
    expect(readDiskHealth(block({ ...counts, leaseUnready: 2 }))!.orphanTrees).toEqual({ ...counts, leaseUnready: 2 });
    expect(readDiskHealth(block(counts))!.orphanTrees).toEqual(counts);
    for (const bad of [-1, 1.5, '2', null]) {
      expect(readDiskHealth(block({ ...counts, leaseUnready: bad }))!.orphanTrees, String(bad)).toEqual(counts);
    }
  });
});
