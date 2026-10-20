// Child reclamation wave 9 (spec §5.10): the collector's reads.
//   - `readCollectPopulation` lists `tmproots/` and `tmpquarantine/` exactly. It asks the path's own kind first. A
//     proven absence is an empty listing, with nothing listed. A link, a file or any failure makes THAT listing
//     unmeasured. A listing that comes back null is resolved by a stat. `tmproots/` is read whole before
//     `tmpquarantine/` is begun.
//   - `collectSwitches` reads the pause and the live marker from one listing.
//   - `learnCollect` is the learning audit, through the one audit site.
// Fixture HOMEs on the real local io, and fakes where a fault cannot be built on disk. FIXTURE HOME ONLY.
import { describe, it, expect } from 'vitest';
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { localIO, type FleetIO } from '../src/io.js';
import { ACTOR_FLAGS_CAP, COLLECT_CAP, RECLAIM_PAUSE_CAP } from '../src/ccdargv.js';
import { COLLECT_LANE_LIVE_MARKER } from '../src/collectLane.js';
import { RECLAIM_PAUSE_MARKER } from '../src/coord/rundefs.js';
import { collectSwitches, learnCollect, readCollectPopulation } from '../src/coord/collectTempRoot.js';
import { ID, T0, rig } from './collectTempRootFixture.js';
import { mkTmp } from './tmpHelpers.js';

const registry = (): string => {
  const reg = path.join(mkTmp('ccrc-collect-reads-'), '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  return reg;
};

type ListingIO = Pick<FleetIO, 'lstatMeasured' | 'readdirMeasured' | 'statMeasured'>;
const UNREADABLE = { ok: false, reason: 'unreadable' } as const;
const ABSENT = { ok: false, reason: 'absent' } as const;
/** The local io, each member replaceable, recording what was asked of which leaf. A member that is not replaced is
 *  bound to `localIO`. A listing is recorded as `list <leaf>` whichever reader took it, and the plain, collapsing
 *  `readdir` (derived from the measured one, as `localIO`'s is) ALSO as `plain <leaf>`: the collector reads the
 *  measured listing (D-5969), so `plain` stays empty. */
const counted = (over: Partial<ListingIO> = {}) => {
  const asked: string[] = [];
  const measured: ListingIO['readdirMeasured'] = (p, t, s) => (over.readdirMeasured ?? localIO.readdirMeasured.bind(localIO))(p, t, s);
  const io: ListingIO & Pick<FleetIO, 'readdir'> = {
    lstatMeasured: async (p) => { asked.push(`lstat ${path.basename(p)}`); return (over.lstatMeasured ?? localIO.lstatMeasured.bind(localIO))(p); },
    readdirMeasured: async (p, t, s) => { asked.push(`list ${path.basename(p)}`); return measured(p, t, s); },
    readdir: async (p, t, s) => {
      asked.push(`list ${path.basename(p)}`, `plain ${path.basename(p)}`);
      const r = await measured(p, t, s);
      return r.ok ? [...r.entries] : null;
    },
    statMeasured: async (p) => { asked.push(`stat ${path.basename(p)}`); return (over.statMeasured ?? localIO.statMeasured.bind(localIO))(p); },
  };
  return { io, asked, of: (verb: string): string[] => asked.filter((a) => a.startsWith(`${verb} `)) };
};

/** An io whose registry listing answers `measured`, through either reader. */
const listingOf = (measured: FleetIO['readdirMeasured']): Pick<FleetIO, 'readdirMeasured' | 'readdir'> => ({
  readdirMeasured: measured,
  readdir: async (p, t, s) => { const r = await measured(p, t, s); return r.ok ? [...r.entries] : null; },
});

/** Root reads a mode-000 directory anyway, so the real-disk unreadable case cannot be built as root. */
const asRoot = process.getuid?.() === 0;

describe('readCollectPopulation — the two listings, read exactly', () => {
  it('both absent: two empty listings, and nothing is listed or stat-ed', async () => {
    const reg = registry();
    const c = counted();
    expect(await readCollectPopulation(c.io, reg)).toEqual({ tmproots: { kind: 'absent' }, tmpquarantine: { kind: 'absent' } });
    expect(c.of('list')).toEqual([]);
    expect(c.of('stat')).toEqual([]);
  });

  it('a directory lists every name as it stands, dot-leading ones included: the L1 population drops those', async () => {
    const reg = registry();
    mkdirSync(path.join(reg, 'tmproots'));
    for (const n of ['demo-a', '.demo-a.123.456.tmp', 'demo-b']) writeFileSync(path.join(reg, 'tmproots', n), '');
    mkdirSync(path.join(reg, 'tmpquarantine'));
    writeFileSync(path.join(reg, 'tmpquarantine', 'demo-c.1790000000000000000.4242'), '');
    const got = await readCollectPopulation(counted().io, reg);
    expect(got.tmproots.kind === 'listed' ? [...got.tmproots.names].sort() : got.tmproots)
      .toEqual(['.demo-a.123.456.tmp', 'demo-a', 'demo-b']);
    expect(got.tmpquarantine).toEqual({ kind: 'listed', names: ['demo-c.1790000000000000000.4242'] });
  });

  it('a symbolic link is never followed: that listing is unmeasured, nothing is listed through it, and the other listing stands', async () => {
    const reg = registry();
    mkdirSync(path.join(reg, 'elsewhere'));
    writeFileSync(path.join(reg, 'elsewhere', 'demo-a'), '');
    symlinkSync(path.join(reg, 'elsewhere'), path.join(reg, 'tmproots'));
    const c = counted();
    const got = await readCollectPopulation(c.io, reg);
    expect(got.tmproots.kind === 'unmeasured' ? got.tmproots.why : got.tmproots).toContain('symbolic link');
    expect(got.tmpquarantine).toEqual({ kind: 'absent' });
    expect(c.of('list')).toEqual([]);
  });

  it('a plain file is unmeasured, and says so', async () => {
    const reg = registry();
    writeFileSync(path.join(reg, 'tmproots'), '');
    const got = await readCollectPopulation(counted().io, reg);
    expect(got.tmproots.kind === 'unmeasured' ? got.tmproots.why : got.tmproots).toContain('plain file');
  });

  it.each<[string, ListingIO['lstatMeasured']]>([
    ['unreadable', async () => ({ ok: false, reason: 'unreadable' })],
    ['unmeasured, an agent too old to answer', async () => ({ ok: false, reason: 'unmeasured' })],
    ['a rejection', async () => { throw new Error('the agent link closed'); }],
  ])('an lstat that answers %s makes the listing unmeasured, never absent, and nothing is listed', async (_what, lstatMeasured) => {
    const c = counted({ lstatMeasured });
    const got = await readCollectPopulation(c.io, registry());
    expect(got.tmproots).toMatchObject({ kind: 'unmeasured' });
    expect(got.tmpquarantine).toMatchObject({ kind: 'unmeasured' });
    expect(c.of('list')).toEqual([]);
  });

  it('a directory whose listing comes back null and whose stat proves it absent (it went between the two reads) is empty', async () => {
    const reg = registry();
    mkdirSync(path.join(reg, 'tmproots'));
    const c = counted({ readdirMeasured: async () => UNREADABLE, statMeasured: async () => ABSENT });
    expect((await readCollectPopulation(c.io, reg)).tmproots).toEqual({ kind: 'absent' });
  });

  it.each<[string, Partial<ListingIO>]>([
    ['a stat that answers, the shape of a FIFO, a socket or a device', { readdirMeasured: async () => UNREADABLE }],
    ['a stat that answers unreadable', { readdirMeasured: async () => UNREADABLE, statMeasured: async () => UNREADABLE }],
    ['a listing that rejects', { readdirMeasured: async () => { throw new Error('EIO'); } }],
    ['a stat that rejects', { readdirMeasured: async () => UNREADABLE, statMeasured: async () => { throw new Error('EIO'); } }],
  ])('a null listing resolved by %s is unmeasured, never folded into absent', async (_what, over) => {
    const reg = registry();
    mkdirSync(path.join(reg, 'tmproots'));
    expect((await readCollectPopulation(counted(over).io, reg)).tmproots).toMatchObject({ kind: 'unmeasured' });
  });

  // D-5969 (ARCH-08b, #534): the listing is the MEASURED one. A proven absence is a positive answer and short-circuits;
  // an unlistable directory is reported as such — never folded into empty — and still falls back to the stat, which is
  // how an older agent's bare null (always `unreadable`) can still prove a directory gone.
  it('a listing measured absent is an empty listing, and nothing is stat-ed', async () => {
    const reg = registry();
    mkdirSync(path.join(reg, 'tmproots'));
    const c = counted({ readdirMeasured: async (p) => (path.basename(p) === 'tmproots' ? ABSENT : localIO.readdirMeasured(p)) });
    expect((await readCollectPopulation(c.io, reg)).tmproots).toEqual({ kind: 'absent' });
    expect(c.of('stat')).toEqual([]);
  });

  it('a listing measured unreadable, over a directory that stands, is unmeasured and says it could not be read', async () => {
    const reg = registry();
    mkdirSync(path.join(reg, 'tmproots'));
    const got = await readCollectPopulation(counted({ readdirMeasured: async () => UNREADABLE }).io, reg);
    expect(got.tmproots).toEqual({ kind: 'unmeasured', why: 'tmproots/ did not list (unreadable)' });
  });

  it.skipIf(asRoot)('a real directory this box cannot read is reported unmeasured, never an empty listing', async () => {
    const reg = registry();
    const dir = path.join(reg, 'tmproots');
    mkdirSync(dir);
    writeFileSync(path.join(dir, 'demo-a'), '');
    chmodSync(dir, 0o000);
    try {
      expect((await readCollectPopulation(counted().io, reg)).tmproots)
        .toEqual({ kind: 'unmeasured', why: 'tmproots/ did not list (unreadable)' });
    } finally { chmodSync(dir, 0o755); }
  });

  it('readable directories keep today\'s verdicts, and the plain collapsing listing is never read', async () => {
    const reg = registry();
    mkdirSync(path.join(reg, 'tmproots'));
    writeFileSync(path.join(reg, 'tmproots', 'demo-a'), '');
    mkdirSync(path.join(reg, 'tmpquarantine'));
    const c = counted();
    expect(await readCollectPopulation(c.io, reg))
      .toEqual({ tmproots: { kind: 'listed', names: ['demo-a'] }, tmpquarantine: { kind: 'listed', names: [] } });
    expect(c.of('plain')).toEqual([]);
  });

  it('names that are not strings are dropped at the adapter, the only place that can see them', async () => {
    const reg = registry();
    mkdirSync(path.join(reg, 'tmproots'));
    const c = counted({ readdirMeasured: async () => ({ ok: true, entries: ['demo-a', 7, null, 'demo-b'] as unknown as string[] }) });
    expect((await readCollectPopulation(c.io, reg)).tmproots).toEqual({ kind: 'listed', names: ['demo-a', 'demo-b'] });
  });

  it('reads tmproots/ BEFORE tmpquarantine/, one after the other: an id ccd collects between the two reads is in one listing or the other, never in neither', async () => {
    // ccd collects in this order: it writes the quarantine record, drops the witness, and drops the record last
    // (spec §5.10). A quarantine listing taken before the witness listing can see neither for an id mid-collection,
    // and the population would forget it once. Here ccd writes the record and drops the witness right after the
    // first listing answers, and the witness listing's own lstat is the slower one, so two reads run concurrently
    // would finish the quarantine listing first.
    const reg = registry();
    mkdirSync(path.join(reg, 'tmproots'));
    mkdirSync(path.join(reg, 'tmpquarantine'));
    const record = `${ID}.1790000000000000000.4242`;
    const box = { witness: true, record: false, stepped: false };
    const c = counted({
      lstatMeasured: async (p) => {
        if (path.basename(p) === 'tmproots') await new Promise((done) => { setTimeout(done, 50); });
        return localIO.lstatMeasured(p);
      },
      readdirMeasured: async (p) => {
        const names = path.basename(p) === 'tmproots' ? (box.witness ? [ID] : []) : (box.record ? [record] : []);
        if (!box.stepped) { box.stepped = true; box.record = true; box.witness = false; }
        return { ok: true, entries: names };
      },
    });
    expect(await readCollectPopulation(c.io, reg))
      .toEqual({ tmproots: { kind: 'listed', names: [ID] }, tmpquarantine: { kind: 'listed', names: [record] } });
    expect(c.asked, 'the witness listing is whole before the record listing is begun')
      .toEqual(['lstat tmproots', 'list tmproots', 'lstat tmpquarantine', 'list tmpquarantine']);
  });
});

describe('collectSwitches — the pause and the live marker, from ONE listing', () => {
  it('reads each from the one listing', async () => {
    const reg = registry();
    expect(await collectSwitches(localIO, reg)).toEqual({ paused: false, marker: false });
    writeFileSync(path.join(reg, COLLECT_LANE_LIVE_MARKER), '');
    expect(await collectSwitches(localIO, reg)).toEqual({ paused: false, marker: true });
    writeFileSync(path.join(reg, RECLAIM_PAUSE_MARKER), '');
    expect(await collectSwitches(localIO, reg)).toEqual({ paused: true, why: 'raised', marker: true });
  });

  it.each<[string, FleetIO['readdirMeasured'], 'absent' | 'unreadable']>([
    ['a listing measured unreadable', async () => UNREADABLE, 'unreadable'],
    ['a listing measured absent', async () => ABSENT, 'absent'],
    ['a listing that rejects', async () => { throw new Error('EIO'); }, 'unreadable'],
  ])('%s cannot rule a raised pause out: paused, and the pause says why it did not list', async (_what, measured, reason) => {
    expect(await collectSwitches(listingOf(measured), registry())).toStrictEqual({ paused: true, why: 'unlistable', reason });
  });

  it.skipIf(asRoot)('a real registry this box cannot read is paused, unlistable, unreadable — never an empty listing', async () => {
    const reg = registry();
    chmodSync(reg, 0o000);
    try {
      expect(await collectSwitches(localIO, reg)).toStrictEqual({ paused: true, why: 'unlistable', reason: 'unreadable' });
    } finally { chmodSync(reg, 0o755); }
  });

  it('a raised pause and a registry that did not list are two answers, never one: each pause says which', async () => {
    const reg = registry();
    writeFileSync(path.join(reg, RECLAIM_PAUSE_MARKER), '');
    const raised = await collectSwitches(localIO, reg);
    const unlistable = await collectSwitches(listingOf(async () => UNREADABLE), reg);
    expect(raised.paused && raised.why, 'reclaim-paused stands in the listing').toBe('raised');
    expect(unlistable.paused && unlistable.why, 'the listing could not be taken').toBe('unlistable');
  });
});

describe('learnCollect — the learning audit, through the one audit site', () => {
  it('asks the audit for the id, captures both generations as it composes, and stamps the answer as it arrives', async () => {
    const r = rig();
    r.hooks.audit = () => { r.lane.advance(7); r.lane.clearAll(); };
    const got = await learnCollect(r.deps, ID);
    expect(r.attempts).toEqual([['ws-audit', '--session', ID, '--collect']]);
    expect(got).toMatchObject({ kind: 'answered',
      audit: { value: { kind: 'collectable' }, composed: { lane: 0, id: 0 }, arrived: { mono: T0 + 7 } } });
    expect(r.deps.lane.generations(ID), 'the clear moved the lane generation after the audit was composed').toEqual({ lane: 1, id: 0 });
  });

  it.each<[string, readonly string[] | null]>([
    ['no collect-v1', ['ws-audit', 'ws-collect', RECLAIM_PAUSE_CAP, ACTOR_FLAGS_CAP]],
    ['no caps list at all', null],
    ['collect-v1 but no ws-audit', ['ws-collect', COLLECT_CAP, RECLAIM_PAUSE_CAP, ACTOR_FLAGS_CAP]],
  ])('%s: not asked, and nothing is composed', async (_what, caps) => {
    const r = rig({ caps });
    expect(await learnCollect(r.deps, ID)).toEqual({ kind: 'not-asked', why: 'caps' });
    expect(r.attempts).toEqual([]);
  });

  it('a runner that rejects is an answer with no document, never a throw', async () => {
    const r = rig();
    r.answerAudit(() => { throw new Error('the runner was killed'); });
    expect(await learnCollect(r.deps, ID)).toMatchObject({ kind: 'answered', audit: { value: { kind: 'no-document' } } });
  });
});
