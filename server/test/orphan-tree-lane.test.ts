// FLEET DISK RETENTION DR-19 (D-6631; spec 2026-10-23 section 2.3). The orphan-worktree lane: population from the census,
// the licence (two unchanged tokens at least an hour apart), pacing, the arming markers, the pause, the feed and the
// health counts. Every case drives the real lane (`OrphanTreeSweep`, the L3 executor and the L1 folds) over a fake ccd and
// a fake registry listing; nothing here runs a verb on a box.
import { describe, it, expect } from 'vitest';
import { collectOrphanTree } from '../src/coord/collectOrphanTree.js';
import { OrphanTreeSweep, type OrphanSweepDeps } from '../src/orphanTreeSweep.js';
import { ORPHAN_LICENCE_MS, ORPHAN_CENSUS_MS, orphanInsideVerdict, orphanLicence, orphanCoordinatorSet, parseOrphanAudit, parseOrphanCensus } from '../src/orphanTreeLane.js';
import { readDiskHealth } from '../../shared/disk.js';
import { ORPHAN_TREE_LIVE_MARKER, ORPHAN_TREE_RESCUE_LIVE_MARKER, RECLAIM_PAUSE_MARKER } from '../../shared/switches.js';
import type { CcdResult } from '../src/lifecycle.js';

const HOUR = ORPHAN_LICENCE_MS;
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
  const coordinators = new Set<string>();
  let coordsReadable = true;
  // Registry rows by id: true = workspace (the default), false = plain session / main checkout, null = unreadable, 'throw' = the read throws.
  const wsKinds = new Map<string, boolean | null | 'throw'>();
  const ok = (stdout: string): CcdResult => ({ ok: true, stdout, stderr: '', killed: false, signal: null });
  const deps: OrphanSweepDeps = {
    io: { readdirMeasured: async () => ({ ok: true, entries: [...markers] }) } as unknown as OrphanSweepDeps['io'],
    registryDir: '/reg',
    runCcd: async (argv) => {
      const a = [...argv];
      calls.push(a);
      if (a[0] === 'ws-audit' && a[1] === '--orphans') {
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
    pressure: () => false,
    record: (title, body) => { feed.push({ title, body }); },
    isWorkspace: async (id) => { const k = wsKinds.has(id) ? wsKinds.get(id)! : true; if (k === 'throw') throw new Error('row unreadable'); return k; },
    coordinators: () => { if (!coordsReadable) throw new Error('store unreadable'); return coordinators; },
  };
  const sweep = new OrphanTreeSweep(deps);
  const acts = (): string[][] => calls.filter((c) => c[0] === 'ws-orphan');
  return {
    sweep, trees, markers, calls, feed, acts,
    add: (p: string, cls: string, audit: Record<string, unknown>): string => { const h = hexOf(p); trees.set(h, { cls, audit }); return h; },
    advance: (ms: number): void => { mono += ms; },
    truncate: (v: boolean): void => { truncated = v; },
    coordinators, wsKinds, unreadable: (v: boolean): void => { coordsReadable = !v; },
    addInside: (p: string, cls: string, audit: Record<string, unknown>, inside: string): string => { const h = hexOf(p); trees.set(h, { cls, audit, inside }); return h; },
  };
}

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
});

describe('the executor stops on its own, whatever the pass did', () => {
  const hex = hexOf('/p/.claude/worktrees/a');
  const exec = (listings: string[][], calls: string[][]) => {
    let n = 0;
    const deps = {
      io: { readdirMeasured: async () => ({ ok: true, entries: listings[Math.min(n++, listings.length - 1)]! }) } as never,
      registryDir: '/reg', epochNow: () => 1, fleetState: { ccdVerbs: ['orphan-v1'] },
      runCcd: async (argv: readonly string[]) => {
        calls.push([...argv]);
        return { ok: true, stdout: JSON.stringify({ mode: 'orphan', pathHex: hex, verdict: 'token', token: tok('a') }), stderr: '', killed: false, signal: null };
      },
    };
    return collectOrphanTree(deps as never, hex, { token: tok('a'), rescue: false, atMono: 0 }, () => 2 * HOUR, 1);
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
      fleetState: { ccdVerbs: ['orphan-v1'] }, runCcd: async (a: readonly string[]) => { calls.push([...a]); throw new Error('no'); },
    };
    expect(await collectOrphanTree(deps as never, hex, null, () => 0, 1)).toEqual({ kind: 'stopped', why: 'paused' });
    expect(calls).toEqual([]);
  });

  it('a moved connection epoch stops the act', async () => {
    const calls: string[][] = [];
    const deps = {
      io: { readdirMeasured: async () => ({ ok: true, entries: [ORPHAN_TREE_LIVE_MARKER] }) } as never, registryDir: '/reg', epochNow: () => 2,
      fleetState: { ccdVerbs: ['orphan-v1'] },
      runCcd: async (a: readonly string[]) => { calls.push([...a]); return { ok: true, stdout: JSON.stringify({ mode: 'orphan', pathHex: hex, verdict: 'token', token: tok('a') }), stderr: '', killed: false, signal: null }; },
    };
    expect(await collectOrphanTree(deps as never, hex, { token: tok('a'), rescue: false, atMono: 0 }, () => 2 * HOUR, 1)).toEqual({ kind: 'stopped', why: 'epoch' });
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
    const set = orphanCoordinatorSet({ childReclaimCoordinatorClaims: () => claims, openCoordinatorIds: () => [] });
    expect(set?.has('lane-a')).toBe(true);
    const r = rig(); armed(r); for (const id of set!) r.coordinators.add(id);
    r.addInside('/p/.claude/worktrees/ghost', 'claude', clean('a'), 'lane-a');
    await r.sweep.pass(); r.advance(HOUR); await r.sweep.pass();
    expect(r.acts()).toHaveLength(1);
  });

  it('a displacement-only claimant is a candidate; one that never claimed anything is reported only', () => {
    const claims = new Map<string, unknown>([['displaced', 'unplaced'], ['open-one', 'open']]);
    const set = orphanCoordinatorSet({ childReclaimCoordinatorClaims: () => claims, openCoordinatorIds: () => ['open-one'] });
    expect(orphanInsideVerdict('displaced', set, () => true)).toBe('candidate');
    expect(orphanInsideVerdict('open-one', set, () => true)).toBe('candidate');
    expect(orphanInsideVerdict('worker-w', set, () => true)).toBe('goes-with-workspace');
  });

  it('either claim read throwing is null, which keeps the tree', () => {
    const boom = (): never => { throw new Error('x'); };
    expect(orphanCoordinatorSet({ childReclaimCoordinatorClaims: boom, openCoordinatorIds: () => [] })).toBeNull();
    expect(orphanCoordinatorSet({ childReclaimCoordinatorClaims: () => new Map(), openCoordinatorIds: boom })).toBeNull();
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
