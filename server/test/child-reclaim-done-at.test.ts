// Child-reclamation wave 6, Task 12 (spec §5.9): the vanish re-read's SECOND
// trigger.
//
// ccd purges a reclaimed child's registry row and only then journals the
// reclaim's `done`, and the journal mirror ingests on its own clock, never
// awaited by the tick. So wave 5's board re-read on the vanish usually runs
// while the mirror still holds only `intent`, and the chip reads null. What
// this file pins:
//   • the mirror keeps the newest `at` of a reclaim `done` it has COMMITTED,
//     in memory, only ever rising;
//   • the coord frame carries it as the optional `childReclaimDoneAt`, omitted
//     while nothing is measured, on both of the frame's arms;
//   • a child-marked id leaving the listing resets the mirror's clock (an
//     assignment, never an await), so the fact is usually measured on that
//     same tick;
//   • the PWA has ONE reader of the field.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bus } from '../src/bus.js';
import { FleetWatcher, LC_SWEEP_MS } from '../src/watch.js';
import { localIO, type FleetIO } from '../src/io.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { JournalMirror } from '../src/coord/mirror.js';
import { LC_CAP_TOKEN, childReclaimDoneHighWater } from '../src/coord/mirrorplan.js';
import { parseJournalLine } from '../src/coord/journalparse.js';
import { childMarkLeftListing } from '../src/coord/childReclaim.js';
import { genFile } from './lifecycleHelpers.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { codeOnly } from './sourceScan.js';
import { LC_DIR_NAME, type ChildMark, type CoordStatus } from '../../shared/api.js';

const G1 = '1758500000000000000';
const T = 1_758_500_000_000;
const NOW = 1_785_300_000_000;
const A = 'demo-quiet-mesa';
const B = 'demo-clear-cove';

// `lifecycle-sweep.test.ts`'s idiom: only `Date` is faked, so `fs` and the
// microtask queue behave, and the mirror's clock gate reads the faked clock.
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const advance = (ms: number): void => { vi.setSystemTime(Date.now() + ms); };

let seq = 0;
const ev = (id: string, act: string, outcome: string, at: number | null): Record<string, unknown> =>
  ({ uid: `w6d.1.${++seq}`, ...(at === null ? {} : { at }), act, outcome, id });
const appendTo = (dir: string) => (...rows: Record<string, unknown>[]): void =>
  fs.appendFileSync(path.join(dir, genFile(G1)), rows.map((r) => `${JSON.stringify(r)}\n`).join(''));

/** A bare mirror over a fixture registry, every path under the fixture HOME. */
const mirrorRig = () => {
  const home = mkTmp('ccrc-cr-doneat-');
  const registryDir = path.join(home, '.cc-sessions');
  const dir = path.join(registryDir, LC_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  const store = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const m = new JournalMirror({ io: { ...localIO }, registryDir, store,
    ccdVerbs: () => [LC_CAP_TOKEN], now: () => Date.now(), staleAfterMs: LC_SWEEP_MS * 3 });
  return { m, store, append: appendTo(dir) };
};

/** A full registry row, `child-reclaim-watch-view.test.ts`'s `seed`, written
 *  into the fixture registry. */
const seed = (reg: string, id: string, over: Record<string, string> = {}): void => {
  const slug = id.replace(/^demo-/, '');
  const fields: Record<string, string> = {
    wrapper: 'claude', project: 'demo', workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
    workspace: slug, branch: `ws/${slug}`, base: 'origin/main', ...over,
  };
  for (const [k, v] of Object.entries(fields)) fs.writeFileSync(path.join(reg, `${id}.${k}`), v);
};
const unseed = (reg: string, id: string): void => {
  for (const f of fs.readdirSync(reg)) if (f.startsWith(`${id}.`)) fs.rmSync(path.join(reg, f));
};

/** A watcher with a coordination database and a lifecycle-capable ccd, every
 *  path under the fixture HOME; `testDeps`' runner is the guarded stub, so no
 *  ccd and no tmux runs. Captures every `coord` frame the bus carries. */
const tickRig = () => {
  const home = mkTmp('ccrc-cr-doneat-tick-');
  const deps = testDeps(home);
  const io: FleetIO = { ...localIO };
  const registryDir = deps.cfg.registryDir;
  const dir = path.join(registryDir, LC_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const bus = new Bus();
  const frames: CoordStatus[] = [];
  bus.on('coord', (c: CoordStatus) => { frames.push(c); });
  const w = new FleetWatcher(
    { ...deps, io, coord,
      fleetState: { connected: true, downSince: null, ccdVerbs: ['ws-rm', LC_CAP_TOKEN] } } as never,
    bus,
  );
  return { w, io, registryDir, frames, append: appendTo(dir) };
};

const rowsOf = (...o: Record<string, unknown>[]) => o.map((x) => parseJournalLine(JSON.stringify(x)));

describe('childReclaimDoneHighWater — the mirror’s one decision (pure)', () => {
  it('takes the newest at of a reclaim done row, and of nothing else', () => {
    expect(childReclaimDoneHighWater(null, rowsOf(
      ev(A, 'reclaim', 'done', T + 4), ev(B, 'reclaim', 'done', T + 2),
      ev(A, 'reclaim', 'refused', T + 9), ev(A, 'reclaim', 'failed', T + 8),
      ev(A, 'reclaim', 'intent', T + 12), ev(B, 'reap', 'done', T + 11),
      ev(B, 'create', 'done', T + 13), ev(B, 'reclaim', 'done', null),
      // The sibling act that shares the tail: an expiry's `done` is not a reclaim's, and the board would otherwise
      // re-read the archive on every expiry end.
      ev(B, 'expire', 'done', T + 14),
    ))).toBe(T + 4);
  });

  it('answers null for none, and never falls below what it was handed', () => {
    expect(childReclaimDoneHighWater(null, [])).toBeNull();
    expect(childReclaimDoneHighWater(null, rowsOf(ev(A, 'reap', 'done', T)))).toBeNull();
    expect(childReclaimDoneHighWater(T + 50, rowsOf(ev(A, 'reclaim', 'done', T + 4)))).toBe(T + 50);
    expect(childReclaimDoneHighWater(T + 50, rowsOf(ev(A, 'reclaim', 'done', T + 60)))).toBe(T + 60);
  });
});

describe('JournalMirror.childReclaimDoneAt (wave 6)', () => {
  it('is null before any sweep, and after a sweep that committed no reclaim done', async () => {
    const r = mirrorRig();
    expect(r.m.childReclaimDoneAt()).toBeNull();
    r.append(ev(A, 'reclaim', 'intent', T), ev(A, 'reclaim', 'refused', T + 1));
    await r.m.sweep();
    expect(r.store.lifecycleFor({ limit: 10 }), 'the fixture did not ingest').toHaveLength(2);
    expect(r.m.childReclaimDoneAt()).toBeNull();
  });

  it('records the newest committed reclaim done, and only ever rises', async () => {
    const r = mirrorRig();
    r.append(ev(A, 'reclaim', 'done', T + 4), ev(B, 'reclaim', 'done', T + 2));
    await r.m.sweep();
    expect(r.m.childReclaimDoneAt()).toBe(T + 4);
    r.append(ev(B, 'reclaim', 'done', T + 1));       // a late line, older than the one held
    await r.m.sweep();
    expect(r.m.childReclaimDoneAt(), 'the value fell').toBe(T + 4);
    r.append(ev(B, 'reclaim', 'done', T + 20));
    await r.m.sweep();
    expect(r.m.childReclaimDoneAt()).toBe(T + 20);
  });

  it('raises nothing when the ingest fails: the frame may only name a row GET /api/runs can read', async () => {
    const r = mirrorRig();
    r.append(ev(A, 'reclaim', 'done', T + 4));
    vi.spyOn(r.store, 'ingestJournal').mockImplementationOnce(() => { throw new Error('disk full'); });
    await r.m.sweep();                                // never throws: sweep() swallows
    expect(r.m.childReclaimDoneAt(), 'raised before the row was committed').toBeNull();
    await r.m.sweep();                                // the cursor did not move, so the row comes again
    expect(r.m.childReclaimDoneAt()).toBe(T + 4);
  });
});

describe('the coord frame carries childReclaimDoneAt (wave 6)', () => {
  it('omits the field while the mirror has committed no reclaim done — absence, never a made-up value', async () => {
    const r = tickRig();
    await r.w.tick();
    expect(r.w.currentCoord()).not.toBeNull();
    expect(r.w.currentCoord()).not.toHaveProperty('childReclaimDoneAt');
  });

  it('carries the value, and re-emits the frame only when it changes', async () => {
    const r = tickRig();
    r.append(ev(A, 'reclaim', 'done', T + 4));
    await r.w.sweepLifecycle();                       // the FIRST sweep always runs
    await r.w.tick();                                 // its own sweep is gated: Date is frozen
    expect(r.w.currentCoord()?.childReclaimDoneAt).toBe(T + 4);
    const n = r.frames.length;
    await r.w.tick();
    expect(r.frames.length, 'an unchanged value re-emitted the frame').toBe(n);
    r.append(ev(B, 'reclaim', 'done', T + 9));
    advance(LC_SWEEP_MS + 1);
    await r.w.sweepLifecycle();
    await r.w.tick();
    expect(r.frames.length).toBe(n + 1);
    expect(r.frames.at(-1)?.childReclaimDoneAt).toBe(T + 9);
  });

  it('carries it on the unmeasurable arm too: the value is the mirror’s, not the listing’s', async () => {
    const r = tickRig();
    r.append(ev(A, 'reclaim', 'done', T + 4));
    await r.w.sweepLifecycle();
    r.io.readdir = async () => null;                  // the registry no longer lists
    await r.w.tick();
    expect(r.w.currentCoord()).toMatchObject({ pause: 'unmeasurable', childReclaimDoneAt: T + 4 });
  });
});

describe('a child leaving the listing resets the mirror clock (wave 6)', () => {
  it('childMarkLeftListing: only a child-marked id that is gone, and never on the first listing', () => {
    const child: ChildMark = { kind: 'child', runId: 41 };
    const m = (...e: [string, ChildMark][]) => new Map<string, ChildMark>(e);
    expect(childMarkLeftListing(null, m())).toBe(false);
    expect(childMarkLeftListing(m([A, child]), m())).toBe(true);
    expect(childMarkLeftListing(m([A, child]), m([A, child]))).toBe(false);
    expect(childMarkLeftListing(m([A, child]), m([B, child]))).toBe(true);
    expect(childMarkLeftListing(m([A, { kind: 'none' }]), m())).toBe(false);
    expect(childMarkLeftListing(m([A, { kind: 'unreadable' }]), m())).toBe(false);
  });

  it('sweeps on the tick that sees a child vanish, and not on one that sees a plain row vanish', async () => {
    const r = tickRig();
    seed(r.registryDir, A, { child: '41' });
    seed(r.registryDir, B);
    // `sweepLifecycle` calls `sweep()` synchronously, before its first await,
    // so after an awaited tick the count is exact even though the tick never
    // awaits the sweep itself.
    const sweeps = vi.spyOn(JournalMirror.prototype, 'sweep');
    await r.w.tick();
    expect(sweeps, 'the first tick sweeps: the clock starts at 0').toHaveBeenCalledTimes(1);
    advance(2_000);
    unseed(r.registryDir, B);                         // a plain row leaves
    await r.w.tick();
    expect(sweeps, 'a plain row reset the clock').toHaveBeenCalledTimes(1);
    advance(2_000);                                   // still inside LC_SWEEP_MS
    unseed(r.registryDir, A);                         // the child leaves
    await r.w.tick();
    expect(sweeps).toHaveBeenCalledTimes(2);
    advance(1_000);
    await r.w.tick();
    expect(sweeps, 'the reset sweep did not re-arm the clock').toHaveBeenCalledTimes(2);
  });

  it('resets nothing across an unlistable tick, and resets once the next listing proves the child gone', async () => {
    const r = tickRig();
    seed(r.registryDir, A, { child: '41' });
    const sweeps = vi.spyOn(JournalMirror.prototype, 'sweep');
    await r.w.tick();
    const readdir = r.io.readdir;
    r.io.readdir = async () => null;                  // the whole-fleet listing fails
    unseed(r.registryDir, A);
    advance(1_000);
    await r.w.tick();
    expect(sweeps, 'an unlistable tick reset the clock').toHaveBeenCalledTimes(1);
    r.io.readdir = readdir;
    advance(1_000);
    await r.w.tick();
    expect(sweeps).toHaveBeenCalledTimes(2);
  });
});

describe('the PWA has ONE reader of CoordStatus.childReclaimDoneAt', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const pwaSources = (dir = path.join(root, 'pwa', 'src')): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return pwaSources(full);
      return /\.tsx?$/.test(e.name) ? [full] : [];
    });

  // Code-only counts (`codeOnly`): a sentence ABOUT the field is not a read.
  // childReclaimWords.ts holds two: the cast's key and the property read.
  it('childReclaimDoneAtOf, in childReclaimWords.ts', () => {
    const reads = Object.fromEntries(pwaSources()
      .map((f) => [path.relative(root, f),
        (codeOnly(fs.readFileSync(f, 'utf8')).match(/\bchildReclaimDoneAt\b/g) ?? []).length] as const)
      .filter(([, n]) => n > 0));
    expect(reads).toEqual({ 'pwa/src/fleet/childReclaimWords.ts': 2 });
  });
});
