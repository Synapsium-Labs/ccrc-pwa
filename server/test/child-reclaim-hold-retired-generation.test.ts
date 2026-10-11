// Child reclamation wave 8 (spec §5.7). The lane's hold-retired memory is keyed by the workspace
// generation each sighting was made under, and the release job re-reads that generation nearest its argv.
// There are three layers: L1's `childReclaimHoldRetiredStep` decides what one sighting does to the memory;
// the release job's step 7 re-reads; and the lane applies the step and carries the generation on the
// release request. The harm this closes is pacing only. The job re-proves six facts before step 7, and a
// re-mint's own hold is protected by its own live minting run. FIXTURE HOME ONLY.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { releaseRetiredChildHold, type ChildReclaimDeps, type ChildReclaimReleaseRequest } from '../src/coord/childReclaim.js';
import { childReclaimHoldRetiredStep, type ChildReclaimGenerationIdentity } from '../src/childReclaimSweep.js';
import type { FleetIO } from '../src/io.js';
import type { Runner } from '../src/exec.js';
import { holdReason, type ChildReclaimGenerationKey } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { G1, G2, laneFixture, type Lane } from './childReclaimGenerationFixture.js';

afterEach(() => { vi.restoreAllMocks(); });

const value = (v: string): ChildReclaimGenerationKey => ({ kind: 'value', v });
const ABSENT: ChildReclaimGenerationKey = { kind: 'absent' };

describe('childReclaimHoldRetiredStep — what one hold-retired sighting does to the memory (L1)', () => {
  const K1: ChildReclaimGenerationIdentity = { bornAt: 100, markerRunId: 7, generation: value(G1) };

  it('no stored key: a first sighting, keyed by all three', () => {
    expect(childReclaimHoldRetiredStep(undefined, 100, 7, value(G1))).toEqual({ kind: 'first', key: K1 });
  });

  it('an EQUAL stored key: the second sighting, carrying the generation the release re-reads', () => {
    expect(childReclaimHoldRetiredStep(K1, 100, 7, value(G1))).toEqual({ kind: 'second', generation: value(G1) });
    expect(childReclaimHoldRetiredStep({ ...K1, generation: ABSENT }, 100, 7, ABSENT))
      .toEqual({ kind: 'second', generation: ABSENT });
  });

  it.each<[string, number | null, number, ChildReclaimGenerationKey]>([
    ['another generation value', 100, 7, value(G2)],
    ['no generation where the stored key had one', 100, 7, ABSENT],
    ['another birth', 101, 7, value(G1)],
    ['a marker naming another run', 100, 8, value(G1)],
  ])('an UNEQUAL stored key (%s): a first sighting, whose key REPLACES the stored one', (_what, bornAt, run, gen) => {
    expect(childReclaimHoldRetiredStep(K1, bornAt, run, gen))
      .toEqual({ kind: 'first', key: { bornAt, markerRunId: run, generation: gen } });
  });

  it('a null birth never matches, a stored null included', () => {
    const unplaced = { ...K1, bornAt: null };
    expect(childReclaimHoldRetiredStep(unplaced, null, 7, value(G1))).toEqual({ kind: 'first', key: unplaced });
  });

  it('an unreadable generation is no key: the memory forgets the id, whatever it held', () => {
    expect(childReclaimHoldRetiredStep(K1, 100, 7, { kind: 'unreadable' })).toEqual({ kind: 'forget' });
    expect(childReclaimHoldRetiredStep(undefined, 100, 7, { kind: 'unreadable' })).toEqual({ kind: 'forget' });
  });
});

const RID = 'demo-quiet-basin';

/** `child-reclaim.test.ts`'s `rrig`, with the row's generation and one log of the job's io and ccd calls,
 *  in order. A terminal run of `demo`, its programme closed, and the row carrying that run's close-claim
 *  hold text. `ws-release` answers `released`. */
const rrig = async (o: { readonly generation?: string | null | 'dir'; readonly paused?: boolean;
  readonly io?: (b: FleetIO) => FleetIO } = {}) => {
  const home = mkTmp('ccrc-child-release-generation-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const log: string[] = [];
  const run: Runner = async (_cmd, args) => {
    log.push(`ccd:${args[0]}`);
    return args[0] === 'ws-release' ? { code: 0, stdout: `released ${RID}\n`, stderr: '' }
      : { code: 1, stdout: '', stderr: `unscripted ${args[0]}` };
  };
  const base = testDeps(home, run);
  const logged: FleetIO = {
    ...base.io,
    readdir: async (p: string, timeoutMs?: number, signal?: AbortSignal) => { log.push('readdir'); return base.io.readdir(p, timeoutMs, signal); },
    readFileMeasured: async (p: string, timeoutMs?: number, signal?: AbortSignal) => {
      log.push(`read:${path.basename(p)}`);
      return base.io.readFileMeasured(p, timeoutMs, signal);
    },
  };
  const deps: ChildReclaimDeps = { coord, io: o.io?.(logged) ?? logged, cfg: base.cfg, runCcd: base.runCcd,
    fleetState: { connected: true, downSince: null, rosterFp: null, build: null, ccdVerbs: ['ws-release', 'actor-flags-v1'] } };
  const r = coord.openRun({ program: 'demo', title: 'demo', project: 'demo', wave: 1, waveOf: null, claimedBy: 'demo-coord' });
  if (!('id' in r)) throw new Error(`openRun refused: ${JSON.stringify(r)}`);
  expect(coord.closeRun({ runId: r.id, finalState: 'failed', causedBy: 'test', handoffCommit: null, program: 'demo',
    viaClosing: false }).ok).toBe(true);
  const reason = holdReason('demo', 2, null, null);
  const fields: Record<string, string> = { uuid: `u-${RID}`, wrapper: 'claude', project: 'demo', workdir: `/w/${RID}`,
    workspace: 'quiet-basin', branch: 'ws/quiet-basin', base: 'origin/main', started: '1', child: String(r.id), hold: reason };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${RID}.${k}`), v);
  const genPath = path.join(reg, `${RID}.generation`);
  const g = o.generation === undefined ? G1 : o.generation;
  if (g === 'dir') mkdirSync(genPath);
  else if (g !== null) writeFileSync(genPath, g);
  if (o.paused === true) writeFileSync(path.join(reg, 'reclaim-paused'), '');
  const req = (generation: ChildReclaimGenerationKey): ChildReclaimReleaseRequest =>
    ({ sessionId: RID, runId: r.id, reason, program: 'demo', accountedRunId: r.id, generation });
  return { deps, log, req, releases: (): string[] => log.filter((l) => l === 'ccd:ws-release') };
};

describe('releaseRetiredChildHold — step 7, the generation, re-read nearest the argv', () => {
  it('the generation both sightings were made under still stands: released', async () => {
    const f = await rrig();
    expect(await releaseRetiredChildHold(f.deps, f.req(value(G1)))).toBe('released');
    const a = await rrig({ generation: null });
    expect(await releaseRetiredChildHold(a.deps, a.req(ABSENT)), 'absent against absent').toBe('released');
  });

  it.each<[string, string | null, ChildReclaimGenerationKey]>([
    ['a different value', G2, value(G1)],
    ['absent against a value', null, value(G1)],
    ['a value against absent', G1, ABSENT],
  ])('%s answers changed, and composes no ws-release', async (_what, file, carried) => {
    const f = await rrig({ generation: file });
    expect(await releaseRetiredChildHold(f.deps, f.req(carried))).toBe('changed');
    expect(f.releases()).toEqual([]);
  });

  it.each<[string, string]>([['a directory', 'dir'], ['37 bytes', `${G1}\n`]])(
    'an unreadable generation (%s) answers failed, never changed, and composes no ws-release', async (_what, file) => {
      const f = await rrig({ generation: file });
      expect(await releaseRetiredChildHold(f.deps, f.req(value(G1)))).toBe('failed');
      expect(f.releases()).toEqual([]);
    });

  it('a read that rejects answers failed', async () => {
    const f = await rrig({ io: (b) => ({ ...b,
      readFileMeasured: async (p: string, timeoutMs?: number, signal?: AbortSignal) => {
        if (path.basename(p) === `${RID}.generation`) throw new Error('EIO');
        return b.readFileMeasured(p, timeoutMs, signal);
      } }) });
    await expect(releaseRetiredChildHold(f.deps, f.req(value(G1)))).resolves.toBe('failed');
    expect(f.releases()).toEqual([]);
  });

  it('it is the LAST read: after the switch, and directly before ws-release', async () => {
    const f = await rrig();
    expect(await releaseRetiredChildHold(f.deps, f.req(value(G1)))).toBe('released');
    expect(f.log.slice(-2)).toEqual([`read:${RID}.generation`, 'ccd:ws-release']);
    expect(f.log.lastIndexOf('readdir')).toBeLessThan(f.log.indexOf(`read:${RID}.generation`));
  });

  it('a raised switch answers first: the generation is not read at all', async () => {
    const f = await rrig({ generation: G2, paused: true });
    expect(await releaseRetiredChildHold(f.deps, f.req(value(G1)))).toBe('changed');
    expect(f.log).not.toContain(`read:${RID}.generation`);
  });
});

describe('the hold-retired memory at the lane: keyed by generation (spec §5.7)', () => {
  /** demo-a under its own run's close-claim hold, that run's programme closed: `hold-retired` every pass. */
  const heldChild = (f: Lane, generation: string | null): void => {
    const r = f.openRun(); f.abandon(r);
    f.plant('demo-a', { child: String(r.id), hold: holdReason(r.program, 2, null, null),
      ...(generation === null ? {} : { generation }) });
  };

  it('a sighting over another generation is a FIRST sighting; its key replaces the stored one, and the next sighting of it releases', async () => {
    const f = laneFixture();
    heldChild(f, G1);
    await f.pass();                                          // N: the first sighting, over G1
    f.remint('demo-a', G2);
    f.next(); await f.pass();                                // N+1: over G2
    expect(f.releases(), 'a sighting of another generation is never the second').toEqual([]);
    f.next(); await f.pass();                                // N+2: over G2 again
    expect(f.releases(), 'G2 replaced G1 as the stored key, and the release carries G2').toHaveLength(1);
  });

  it('a re-mint while the release job waits on the session’s queue: its re-read answers changed, and no ws-release is composed', async () => {
    const f = laneFixture();
    heldChild(f, G1);
    await f.pass();                                          // the first sighting
    f.next();
    let free!: () => void;
    const occupied = f.queue.run('demo-a', () => new Promise<void>((resolve) => { free = resolve; }));
    const realRun = f.queue.run.bind(f.queue);
    let queued!: () => void;
    const releaseQueued = new Promise<void>((resolve) => { queued = resolve; });
    vi.spyOn(f.queue, 'run').mockImplementation(((key: string, fn: () => Promise<unknown>) => {
      const p = realRun(key, fn);
      if (key === 'demo-a') queued();
      return p;
    }) as typeof f.queue.run);
    const second = f.pass();                                 // the second sighting queues the job behind the occupier
    await releaseQueued;
    f.remint('demo-a', G2);
    free(); await occupied; await second;
    expect(f.releases(), 'the job’s own re-read found another generation').toEqual([]);
    expect(readdirSync(f.reg), 'the hold stands').toContain('demo-a.hold');
  });

  it('a child unlisted for one pass needs two fresh sightings when it returns: the prune carries over', async () => {
    const f = laneFixture();
    heldChild(f, G1);
    await f.pass();                                          // the first sighting
    f.next();
    const all = await f.listing();
    await f.sweepOn({ records: all.records.filter((r) => r.id !== 'demo-a'),
      names: all.names.filter((n) => !n.startsWith('demo-a.')) });
    f.next(); await f.pass();                                // listed again: a FIRST sighting
    expect(f.releases()).toEqual([]);
    f.next(); await f.pass();                                // its second
    expect(f.releases()).toHaveLength(1);
  });

  it('every delete and clear of the memory carries over: the census', () => {
    // The second sighting's (shared with `forget`), the ineligible arm's, the eligible arm's and the
    // vanished-row prune's deletes, and the two pass-level clears (the mirror or coordination fail-shut,
    // and the switches' return).
    const src = readFileSync(path.join(__dirname, '../src/watch.ts'), 'utf8');
    expect(src.match(/this\.childReclaimHoldRetiredSeen\.delete\(/g) ?? []).toHaveLength(4);
    expect(src.match(/this\.childReclaimHoldRetiredSeen\.clear\(\)/g) ?? []).toHaveLength(2);
    expect(src).toMatch(/for \(const id of \[\.\.\.this\.childReclaimHoldRetiredSeen\.keys\(\)\]\) \{/);
  });
});
