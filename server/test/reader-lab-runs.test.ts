// The reader lab door's state (native Docs reader, the reader lab plan of 2026-11-03, Task 2; the rich-docs spec's rows
// M10.2, M10.5, M10.6, M10.7, M10.17): `server/src/readerLab/runs.ts`, its clock handed in. A run opens under a nonce the
// route minted, for the session that opened it, and lives as long as the lab run's own caps allow plus five minutes; four
// can be open and a fifth evicts the oldest; a run counts at most 1024 requests and is then saturated; what it keeps of a
// request is classes; with no run open nothing is counted; a run answers only its owner.
import { describe, expect, it } from 'vitest';
import {
  LAB_BUSY_SPIN_MS, LAB_DRAW_SETTLE_MS, LAB_MOUNTS, LAB_MOUNT_WAIT_MS, LAB_PROBE_NAMES, LAB_SETTLE_MS, LAB_STEPS,
  LAB_TAP_WAIT_MS, type LabProbeTally,
} from '../../shared/readerLab.js';
import {
  READER_LAB_RUNS_MAX, READER_LAB_RUN_HITS_MAX, READER_LAB_RUN_TTL_MS, createReaderLabRuns, labOriginClass, labSiteClass,
  type LabObservation,
} from '../src/readerLab/runs.js';

const N1 = 'AAAAAAAAAAAAAAAAAAAAAA';
/** Two owners, as the route's digests stand in the store: opaque strings. */
const ME = 'owner-a';
const OTHER = 'owner-b';
/** The i-th of several distinct well-formed nonces. */
const nonceOf = (i: number): string => `${String(i).padStart(2, '0')}${'B'.repeat(20)}`;
const CROSS: LabObservation = { cookie: false, upgrade: false, site: 'cross-site', origin: 'null' };
const ZERO: LabProbeTally = {
  hits: 0, cookie: 0, upgrade: 0,
  site: { 'same-origin': 0, 'same-site': 0, 'cross-site': 0, none: 0, absent: 0, other: 0 },
  origin: { null: 0, absent: 0, present: 0 },
};

describe('the reader lab run store (reader lab plan, Task 2)', () => {
  it('a run lives as long as the lab run\'s own caps allow, plus five minutes: between fifteen and twenty minutes (M10.6)', () => {
    const caps = LAB_TAP_WAIT_MS + LAB_STEPS * LAB_SETTLE_MS + LAB_BUSY_SPIN_MS + LAB_MOUNTS * (LAB_MOUNT_WAIT_MS + LAB_DRAW_SETTLE_MS);
    expect(READER_LAB_RUN_TTL_MS).toBe(caps + 5 * 60_000);
    expect(READER_LAB_RUN_TTL_MS).toBeGreaterThanOrEqual(15 * 60_000);
    expect(READER_LAB_RUN_TTL_MS).toBeLessThanOrEqual(20 * 60_000);
  });

  it('an opened run reads every probe name with a zero tally, and expires its life after it opened', () => {
    const runs = createReaderLabRuns();
    runs.open(N1, ME, 1000);
    const v = runs.read(N1, ME, 1000)!;
    expect([v.openedAt, v.expiresAt]).toEqual([1000, 1000 + READER_LAB_RUN_TTL_MS]);
    expect(Object.keys(v.probes)).toEqual([...LAB_PROBE_NAMES]);
    for (const n of LAB_PROBE_NAMES) expect(v.probes[n], n).toEqual(ZERO);
    expect([v.counted, v.ignored, v.saturated]).toEqual([0, 0, false]);
  });

  it('a counted request adds to its name\'s hits and to exactly its classes, and to nothing else', () => {
    const runs = createReaderLabRuns();
    runs.open(N1, ME, 0);
    expect(runs.count(N1, 'cookie-fetch', { cookie: true, upgrade: false, site: 'same-origin', origin: 'absent' }, 1)).toBe('counted');
    expect(runs.count(N1, 'cookie-websocket', { cookie: false, upgrade: true, site: 'cross-site', origin: 'null' }, 2)).toBe('counted');
    const v = runs.read(N1, ME, 3)!;
    expect(v.probes['cookie-fetch']).toEqual({ ...ZERO, hits: 1, cookie: 1, site: { ...ZERO.site, 'same-origin': 1 }, origin: { ...ZERO.origin, absent: 1 } });
    expect(v.probes['cookie-websocket']).toEqual({ ...ZERO, hits: 1, upgrade: 1, site: { ...ZERO.site, 'cross-site': 1 }, origin: { ...ZERO.origin, null: 1 } });
    expect(v.probes['cookie-xhr']).toEqual(ZERO);
    expect(v.counted).toBe(2);
  });

  it('a name outside the vocabulary is counted as ignored and changes no tally', () => {
    const runs = createReaderLabRuns();
    runs.open(N1, ME, 0);
    for (const name of ['nope', '__proto__', 'csp-', 'COOKIE-FETCH']) expect(runs.count(N1, name, CROSS, 1), name).toBe('ignored-name');
    const v = runs.read(N1, ME, 2)!;
    expect([v.counted, v.ignored]).toEqual([4, 4]);
    for (const n of LAB_PROBE_NAMES) expect(v.probes[n], n).toEqual(ZERO);
  });

  it('with no run open, or under a nonce of another shape or another run, nothing is counted (M10.5)', () => {
    const runs = createReaderLabRuns();
    expect(runs.count(N1, 'cookie-fetch', CROSS, 0)).toBe('no-run');
    runs.open(N1, ME, 0);
    for (const n of ['', 'A'.repeat(21), `${N1}A`, nonceOf(1), '../x']) expect(runs.count(n, 'cookie-fetch', CROSS, 1), n).toBe('no-run');
    expect(runs.read(N1, ME, 2)!.counted).toBe(0);
    expect(runs.read('A'.repeat(21), ME, 2)).toBeNull();
    // A full store is untouched by a probe on a nonce nobody opened (well-formed or not): none is evicted, none is
    // created, and no run's counts move.
    const full = createReaderLabRuns();
    for (let i = 1; i <= READER_LAB_RUNS_MAX; i += 1) {
      full.open(nonceOf(i), ME, i);
      full.count(nonceOf(i), 'cookie-fetch', CROSS, i);
    }
    for (const n of [nonceOf(READER_LAB_RUNS_MAX + 1), '../x']) expect(full.count(n, 'cookie-fetch', CROSS, 5), n).toBe('no-run');
    expect(full.openCount(5)).toBe(READER_LAB_RUNS_MAX);
    for (let i = 1; i <= READER_LAB_RUNS_MAX; i += 1) {
      const v = full.read(nonceOf(i), ME, 5);
      expect([v?.counted, v?.ignored, v?.probes['cookie-fetch'].hits], String(i)).toEqual([1, 0, 1]);
    }
    expect(full.read(nonceOf(READER_LAB_RUNS_MAX + 1), ME, 5)).toBeNull();
  });

  it('a run is gone at its expiry: it reads null and counts nothing (M10.6)', () => {
    const runs = createReaderLabRuns();
    runs.open(N1, ME, 0);
    expect(runs.count(N1, 'busy-start', CROSS, READER_LAB_RUN_TTL_MS - 1)).toBe('counted');
    expect(runs.count(N1, 'busy-end', CROSS, READER_LAB_RUN_TTL_MS)).toBe('no-run');
    expect(runs.read(N1, ME, READER_LAB_RUN_TTL_MS)).toBeNull();
    expect(runs.openCount(READER_LAB_RUN_TTL_MS)).toBe(0);
  });

  it('four runs can be open; a fifth evicts the oldest, whoever opened it, and leaves the other three as they were (M10.6)', () => {
    expect(READER_LAB_RUNS_MAX).toBe(4);
    const runs = createReaderLabRuns();
    for (let i = 1; i <= 4; i += 1) {
      runs.open(nonceOf(i), ME, i);
      runs.count(nonceOf(i), 'busy-start', CROSS, i);
    }
    runs.open(nonceOf(5), OTHER, 5);
    expect(runs.openCount(5)).toBe(4);
    expect(runs.read(nonceOf(1), ME, 5)).toBeNull();
    for (let i = 2; i <= 4; i += 1) expect(runs.read(nonceOf(i), ME, 5)!.probes['busy-start'].hits, String(i)).toBe(1);
    expect(runs.read(nonceOf(5), OTHER, 5)!.counted).toBe(0);
  });

  it('a run counts at most 1024 requests, then reads saturated and counts nothing more (M10.6)', () => {
    expect(READER_LAB_RUN_HITS_MAX).toBe(1024);
    const runs = createReaderLabRuns();
    runs.open(N1, ME, 0);
    for (let i = 0; i < READER_LAB_RUN_HITS_MAX; i += 1) expect(runs.count(N1, 'cookie-image', CROSS, 1)).toBe('counted');
    expect(runs.read(N1, ME, 1)!.saturated).toBe(true);
    expect(runs.count(N1, 'cookie-image', CROSS, 1)).toBe('saturated');
    expect(runs.count(N1, 'nope', CROSS, 1)).toBe('saturated');
    const v = runs.read(N1, ME, 1)!;
    expect([v.counted, v.ignored, v.probes['cookie-image'].hits]).toEqual([1024, 0, 1024]);
  });

  it('close ends a run once: true, then false; it then reads null and counts nothing', () => {
    const runs = createReaderLabRuns();
    runs.open(N1, ME, 0);
    expect(runs.close(N1, ME)).toBe(true);
    expect(runs.close(N1, ME)).toBe(false);
    expect(runs.read(N1, ME, 0)).toBeNull();
    expect(runs.count(N1, 'busy-start', CROSS, 0)).toBe('no-run');
  });

  it('a run answers only its owner: another reads null, as an unknown nonce does, and cannot close it; counting asks no owner (M10.17)', () => {
    const runs = createReaderLabRuns();
    runs.open(N1, ME, 0);
    expect(runs.count(N1, 'busy-start', CROSS, 1)).toBe('counted');
    expect(runs.read(N1, OTHER, 2)).toBeNull();
    expect(runs.read(nonceOf(9), ME, 2)).toBeNull();
    expect(runs.close(N1, OTHER)).toBe(false);
    expect(runs.read(N1, ME, 2)!.probes['busy-start'].hits).toBe(1);
    expect(runs.close(N1, ME)).toBe(true);
  });

  it('opening refuses a nonce of the wrong shape: only the route mints nonces, so that is a defect (M10.2)', () => {
    const runs = createReaderLabRuns();
    for (const n of ['', 'A'.repeat(21), `${N1}=`, 'a/b']) expect(() => runs.open(n, ME, 0), n).toThrow(TypeError);
    expect(runs.openCount(0)).toBe(0);
  });

  it('a read is a copy: changing it changes nothing in the run (M10.7)', () => {
    const runs = createReaderLabRuns();
    runs.open(N1, ME, 0);
    runs.count(N1, 'busy-start', CROSS, 0);
    const v = runs.read(N1, ME, 0)! as unknown as { probes: Record<string, { hits: number; site: Record<string, number> }> };
    v.probes['busy-start']!.hits = 99;
    v.probes['busy-start']!.site['cross-site'] = 99;
    expect(runs.read(N1, ME, 0)!.probes['busy-start'])
      .toEqual({ ...ZERO, hits: 1, site: { ...ZERO.site, 'cross-site': 1 }, origin: { ...ZERO.origin, null: 1 } });
  });

  it('Sec-Fetch-Site and Origin become classes; no header text is kept (M10.7)', () => {
    expect(['same-origin', 'same-site', 'cross-site', 'none', undefined, '', 'SAME-ORIGIN', 'cross-site, same-origin', 42]
      .map((h) => labSiteClass(h))).toEqual(['same-origin', 'same-site', 'cross-site', 'none', 'absent', 'absent', 'other', 'other', 'other']);
    expect(['null', undefined, '', 'https://box.example', 'NULL'].map((h) => labOriginClass(h)))
      .toEqual(['null', 'absent', 'absent', 'present', 'present']);
  });
});
