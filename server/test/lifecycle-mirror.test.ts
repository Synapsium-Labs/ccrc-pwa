// L3: the mirror EXECUTES `mirrorplan`'s decisions over `FleetIO`. It runs
// against `localIO` under a fixture HOME — a real directory, real bytes, real
// partial writes — because the seam it has to get right is the one between a
// read that returned bytes and a read that returned null.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { localIO, type FleetIO } from '../src/io.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { JournalMirror } from '../src/coord/mirror.js';
import { LC_CAP_TOKEN } from '../src/coord/mirrorplan.js';
import { genFile } from './lifecycleHelpers.js';
import { mkTmp } from './tmpHelpers.js';
import {
  LC_ACT_UNKNOWN, LC_DIR_NAME, LC_ERRORS_NAME, LC_GEN_PREFIX, LC_GEN_SUFFIX, LIFECYCLE_ACTS,
} from '../../shared/api.js';

const AN_ACT = LIFECYCLE_ACTS.find((a) => a !== LC_ACT_UNKNOWN)!;
const G1 = '1755780000000000000';
const G2 = '1755790000000000000';
const STALE_AFTER = 15_000;

const line = (uid: string, over: Record<string, unknown> = {}): string => JSON.stringify({
  uid, at: 1_755_780_000_123, act: AN_ACT, outcome: 'done', id: 'demo-quiet-basin', ...over,
});

interface Rig { mirror: JournalMirror; store: CoordStore; dir: string; registryDir: string; now: { v: number } }

/** A `CoordStore` proxy whose ONE named method throws — everything else forwards
 *  to the real store unchanged. Exercises "a store method that throws" as its
 *  own code path (fix round 1, F2), distinct from the io-layer throw the
 *  existing `never throws, whatever the io does` test already covers. */
const throwingStore = (real: CoordStore, method: 'recordGap' | 'ingestJournal'): CoordStore =>
  new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === method) return () => { throw new Error(`${String(prop)} exploded`); };
      return Reflect.get(target, prop, receiver);
    },
  }) as CoordStore;

const rig = (io: FleetIO = localIO, verbs: readonly string[] | null = ['ws-rm', LC_CAP_TOKEN]): Rig => {
  const home = mkTmp('ccrc-mirror-');
  const registryDir = path.join(home, '.cc-sessions');
  const dir = path.join(registryDir, LC_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  const store = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const now = { v: 1_000_000 };
  return {
    store, dir, registryDir, now,
    mirror: new JournalMirror({
      io, registryDir, store, ccdVerbs: () => verbs, now: () => now.v, staleAfterMs: STALE_AFTER,
    }),
  };
};

describe('JournalMirror.sweep', () => {
  it('ingests one generation and remembers where it stopped', async () => {
    const r = rig();
    const body = `${line('a.1')}\n${line('a.2')}\n`;
    fs.writeFileSync(path.join(r.dir, genFile(G1)), body);
    await r.mirror.sweep();
    expect(r.store.lifecycleFor({ limit: 50 }).map((e) => e.uid)).toEqual(['a.1', 'a.2']);
    expect(r.store.journalGenerations()[0]).toMatchObject({
      gen: G1, cursor: Buffer.byteLength(body, 'utf8'), retired: false,
    });
  });

  it('LEAVES A PARTIAL TRAILING LINE ALONE and picks it up once it is finished', async () => {
    const r = rig();
    const f = path.join(r.dir, genFile(G1));
    const whole = line('a.1');
    fs.writeFileSync(f, `${whole}\n${line('a.2').slice(0, 20)}`);
    await r.mirror.sweep();
    expect(r.store.lifecycleFor({ limit: 50 }).map((e) => e.uid)).toEqual(['a.1']);
    expect(r.store.journalGenerations()[0]!.cursor).toBe(Buffer.byteLength(`${whole}\n`, 'utf8'));

    fs.writeFileSync(f, `${whole}\n${line('a.2')}\n`);
    r.now.v += 5000;
    await r.mirror.sweep();
    expect(r.store.lifecycleFor({ limit: 50 }).map((e) => e.uid)).toEqual(['a.1', 'a.2']);
  });

  it('INSERTS an unparseable line as act:unknown with `raw` verbatim', async () => {
    const r = rig();
    const junk = 'ws-rm demo-quiet-basin  # a child wrote into the log';
    fs.writeFileSync(path.join(r.dir, genFile(G1)), `${line('a.1')}\n${junk}\n`);
    await r.mirror.sweep();
    const got = r.store.lifecycleFor({ limit: 50 });
    expect(got.map((e) => e.act)).toEqual([AN_ACT, LC_ACT_UNKNOWN]);
    expect(got[1]!.raw).toBe(junk);
  });

  it('RECORDS a gap when a generation is rotated away undrained', async () => {
    // DEVIATION from task-35-brief.md's literal test (recorded in
    // task-35-report.md, "Deviations found"): the brief's version appends a
    // SECOND complete line to `f1` and removes the file with no sweep in
    // between, so the mirror never has a chance to observe the append at all
    // — `planSweep` (already shipped, task 31, `mirrorplan.ts:125-139`)
    // decides "undrained" purely from `known.cursor < known.size` as of the
    // LAST SUCCESSFUL READ, and a full line ending in `\n` always leaves
    // `cursor === size`. That scenario is exactly the "DISCLOSED RESIDUAL"
    // `planSweep`'s own doc comment states by name and `task-30-32-report.md`
    // ("Anything noticed but not fixed") confirms is deliberate and already
    // reported, not a bug this task should paper over in L3 — doing so would
    // mean `mirror.ts` re-deciding what counts as a gap, which is the exact
    // policy duplication the ring rule forbids. This version instead leaves a
    // PARTIAL trailing line pending at the last successful read (the one
    // condition `planSweep`'s own pinned unit test, `records the undrained
    // bytes and retires the generation`, actually exercises), so the
    // generation is genuinely undrained when it is rotated away.
    const r = rig();
    const f1 = path.join(r.dir, genFile(G1));
    const partial = line('a.2').slice(0, 20);
    fs.writeFileSync(f1, `${line('a.1')}\n${partial}`);
    await r.mirror.sweep();
    // Rotate the generation away while that trailing partial line is still
    // pending — genuinely undrained, never observed complete.
    fs.rmSync(f1);
    fs.writeFileSync(path.join(r.dir, genFile(G2)), `${line('b.1')}\n`);
    r.now.v += 5000;
    await r.mirror.sweep();
    const gaps = r.store.lifecycleGaps(10);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ gen: G1, reason: 'rotated-away' });
    expect(r.store.lifecycleFor({ limit: 50 }).map((e) => e.uid)).toEqual(['a.1', 'b.1']);
  });

  it('RECORDS a gap on a shrink and re-reads the whole generation in the SAME sweep', async () => {
    // DEVIATION from task-35-brief.md's literal test (recorded in
    // task-35-report.md, "Deviations found"): the brief's version truncates
    // `f` from `[a.1, a.2]` down to `[a.2]` — a SUBSET of what sweep 1 already
    // ingested. `ingestJournal` is `INSERT OR IGNORE` and never deletes, so
    // both `a.1` and `a.2` are already durably present after sweep 1 whether
    // or not sweep 2's post-shrink re-read runs at all — measured directly:
    // deleting the `readFileFrom(file, 0)` re-read block (Step 6's own
    // mutant) still leaves this assertion GREEN, so the brief's literal
    // fixture cannot discriminate the mutant it names, despite the mutant
    // note's own predicted failure message. This version truncates to a
    // THIRD, never-before-seen line (`a.3`, shorter than the original two
    // lines so the shrink test still fires), so the final row list can only
    // contain it if the post-shrink re-read genuinely ran.
    const r = rig();
    const f = path.join(r.dir, genFile(G1));
    fs.writeFileSync(f, `${line('a.1')}\n${line('a.2')}\n`);
    await r.mirror.sweep();
    fs.writeFileSync(f, `${line('a.3')}\n`);          // truncated in place, replaced
    r.now.v += 5000;
    await r.mirror.sweep();
    expect(r.store.lifecycleGaps(10)[0]).toMatchObject({ gen: G1, reason: 'shrank' });
    // `uid` dedupes, so a.1/a.2 (already ingested pre-shrink) are not lost,
    // and a.3 (only ever present post-shrink) proves the re-read happened.
    expect(r.store.lifecycleFor({ limit: 50 }).map((e) => e.uid)).toEqual(['a.1', 'a.2', 'a.3']);
  });

  it('records a gap for a name it cannot ORDER — ONCE, not once per sweep', async () => {
    const r = rig();
    const broken = `${LC_GEN_PREFIX}1755000000N${LC_GEN_SUFFIX}`;
    fs.writeFileSync(path.join(r.dir, broken), `${line('x.1')}\n`);
    fs.writeFileSync(path.join(r.dir, genFile(G1)), `${line('a.1')}\n`);
    await r.mirror.sweep();
    r.now.v += 5000;
    await r.mirror.sweep();
    const gaps = r.store.lifecycleGaps(10);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ reason: 'unknown', lostFrom: null, lostTo: null });
    // The orderable generation is still read; one bad name does not stall the lane.
    expect(r.store.lifecycleFor({ limit: 50 }).map((e) => e.uid)).toEqual(['a.1']);
  });

  it('advances NOTHING when the directory cannot be listed — no loss, no reset dance', async () => {
    const r = rig();
    fs.writeFileSync(path.join(r.dir, genFile(G1)), `${line('a.1')}\n`);
    await r.mirror.sweep();
    const blind: FleetIO = { ...localIO, readdir: async () => null };
    const m2 = new JournalMirror({
      io: blind, registryDir: r.registryDir, store: r.store,
      ccdVerbs: () => ['ws-rm', LC_CAP_TOKEN], now: () => r.now.v + 5000, staleAfterMs: STALE_AFTER,
    });
    await m2.sweep();
    expect(r.store.journalGenerations()[0]!.retired).toBe(false);
    expect(r.store.lifecycleGaps(10)).toEqual([]);
  });

  it('does not sweep at all when ccd does not advertise lifecycle-v1', async () => {
    const r = rig(localIO, ['ws-rm', 'stop-surface']);
    fs.writeFileSync(path.join(r.dir, genFile(G1)), `${line('a.1')}\n`);
    await r.mirror.sweep();
    expect(r.store.lifecycleFor({ limit: 50 })).toEqual([]);
    expect(r.mirror.health().state).toBe('unavailable');
  });

  it('never throws, whatever the io does', async () => {
    const boom: FleetIO = {
      ...localIO,
      readdir: async () => { throw new Error('agent went away mid-readdir'); },
    };
    const r = rig(boom);
    await expect(r.mirror.sweep()).resolves.toBeUndefined();
  });
});

describe('JournalMirror.sweep — a store method that throws (fix round 1, F2)', () => {
  it('never throws when store.recordGap itself throws', async () => {
    // Drives the SAME undrained-rotation shape as the sweep test above, so
    // `recordGap` is actually reached this sweep, then swaps in a store whose
    // `recordGap` throws.
    const r = rig();
    const f = path.join(r.dir, genFile(G1));
    const partial = line('a.2').slice(0, 20);
    fs.writeFileSync(f, `${line('a.1')}\n${partial}`);
    await r.mirror.sweep();
    fs.rmSync(f);
    fs.writeFileSync(path.join(r.dir, genFile(G2)), `${line('b.1')}\n`);
    r.now.v += 5000;
    const m2 = new JournalMirror({
      io: localIO, registryDir: r.registryDir, store: throwingStore(r.store, 'recordGap'),
      ccdVerbs: () => ['ws-rm', LC_CAP_TOKEN], now: () => r.now.v, staleAfterMs: STALE_AFTER,
    });
    await expect(m2.sweep()).resolves.toBeUndefined();
  });

  it('never throws when store.ingestJournal itself throws', async () => {
    const r = rig();
    fs.writeFileSync(path.join(r.dir, genFile(G1)), `${line('a.1')}\n`);
    const m2 = new JournalMirror({
      io: localIO, registryDir: r.registryDir, store: throwingStore(r.store, 'ingestJournal'),
      ccdVerbs: () => ['ws-rm', LC_CAP_TOKEN], now: () => r.now.v, staleAfterMs: STALE_AFTER,
    });
    await expect(m2.sweep()).resolves.toBeUndefined();
  });
});

describe('JournalMirror.health', () => {
  it('reports the counts, the horizon, the server clock and the ccd-side error tally', async () => {
    const r = rig();
    fs.writeFileSync(path.join(r.dir, genFile(G1)),
      `${line('a.1', { at: 100 })}\n${line('a.2', { at: 300 })}\n`);
    fs.writeFileSync(path.join(r.dir, LC_ERRORS_NAME), '4\n');
    await r.mirror.sweep();
    expect(r.mirror.health()).toEqual({
      state: 'ok', newestAt: 300, horizon: 100, rows: 2,
      generations: 1, gaps: 0, writeErrors: 4, lastOk: 1_000_000,
    });
  });

  it('says writeErrors null when the counter has never been written — 0 would be a measured zero', async () => {
    const r = rig();
    fs.writeFileSync(path.join(r.dir, genFile(G1)), `${line('a.1')}\n`);
    await r.mirror.sweep();
    expect(r.mirror.health().writeErrors).toBeNull();
  });

  it('keeps the last measured writeErrors when the counter is present but unparseable — F1', async () => {
    // Fix round 1, F1: `readErrors`'s present-but-unparseable branch used to
    // fall to `null` — indistinguishable from "never written" — instead of
    // degrading the same way `unreadable` already does. Measured sequence:
    // 9 -> garbage must read 9 -> 9, never 9 -> null.
    const r = rig();
    fs.writeFileSync(path.join(r.dir, genFile(G1)), `${line('a.1')}\n`);
    fs.writeFileSync(path.join(r.dir, LC_ERRORS_NAME), '9\n');
    await r.mirror.sweep();
    expect(r.mirror.health().writeErrors).toBe(9);

    fs.writeFileSync(path.join(r.dir, LC_ERRORS_NAME), 'not-a-number\n');
    r.now.v += 5000;
    await r.mirror.sweep();
    expect(r.mirror.health().writeErrors).toBe(9);
  });

  it('keeps the last measured writeErrors when the counter file cannot be read — unreadable (F2)', async () => {
    // The sibling of the F1 test above, but for the io-level `unreadable`
    // branch specifically: a fake `FleetIO` whose `readFileMeasured` answers
    // `{ok:false, reason:'unreadable'}` for the errors file only, on the
    // SAME mirror instance (so `writeErrors` really is being carried across
    // sweeps in the running process, not merely re-derived by test scaffolding).
    let breakErrors = false;
    const flaky: FleetIO = {
      ...localIO,
      readFileMeasured: async (p) => (breakErrors && p.endsWith(LC_ERRORS_NAME)
        ? { ok: false, reason: 'unreadable' }
        : localIO.readFileMeasured(p)),
    };
    const r = rig(flaky);
    fs.writeFileSync(path.join(r.dir, genFile(G1)), `${line('a.1')}\n`);
    fs.writeFileSync(path.join(r.dir, LC_ERRORS_NAME), '9\n');
    await r.mirror.sweep();
    expect(r.mirror.health().writeErrors).toBe(9);

    breakErrors = true;
    r.now.v += 5000;
    await r.mirror.sweep();
    expect(r.mirror.health().writeErrors).toBe(9);
  });

  it('says `unknown` before any sweep has run', () => {
    expect(rig().mirror.health().state).toBe('unknown');
  });

  it('goes `stale` once three sweep intervals pass with no successful sweep', async () => {
    const r = rig();
    await r.mirror.sweep();
    expect(r.mirror.health().state).toBe('ok');
    r.now.v += STALE_AFTER;
    expect(r.mirror.health().state).toBe('stale');
  });
});
