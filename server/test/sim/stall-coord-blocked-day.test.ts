// The coord-blocked arm of the stall watch driven for a seeded day (Overlord W1a worked example, spec §11.7): the
// control rows prove each invariant goes red on a hand-made sequence, then the seeded row runs the real decider.
import { describe, it, expect } from 'vitest';
import * as stall from '../../src/coord/stall.js';
import { COORD_BLOCKED_HELD_MS } from '../../src/coord/stall.js';
import { STALL_SWEEP_MS } from '../../src/laneSchedule.js';
import { COORD_BLOCKED_INVARIANTS, coordBlockedDay } from './coordBlockedDay.js';
import { assertScenario, simSeeds } from './run.js';
import type { SequenceLine } from './sequence.js';

type Row = [kind: string, id: string, state: string, actor: string, atOffset: number];
const START = Date.parse('2026-10-12T00:00:00Z');
const C = 'lane-a-coordinator';
function seqOf(rows: readonly Row[]): SequenceLine[] {
  return rows.map(([kind, id, state, actor, off], i) => ({ seq: i + 1, at: START + off, kind, id, state, actor }));
}
function byName(n: string) {
  const inv = COORD_BLOCKED_INVARIANTS.find((i) => i.name === n);
  if (inv === undefined) throw new Error(`no invariant ${n}`);
  return inv;
}

const SEEDS = Array.from({ length: 32 }, (_, i) => i + 1);
const FILE = 'test/sim/stall-coord-blocked-day.test.ts';

describe('the coord-blocked arm over a seeded day (Overlord W1a worked example, §11.7)', () => {
  it('CONTROL: CB-reach goes red on a mail held 31 minutes with no push', () => {
    const lines = seqOf([['mail', '1', 'queued', 'worker', 0], ['held', C, 'some', 'stalls', 60_000],
      ['sim', 'x', 'end', 'sim', COORD_BLOCKED_HELD_MS + STALL_SWEEP_MS + 1]]);
    expect(byName('CB-reach').check(lines)?.invariant).toBe('CB-reach');
  });
  it('CONTROL: CB-reach stays green while the link is unmeasured', () => {
    const lines = seqOf([['link', C, 'unmeasured', 'sim', 0], ['mail', '1', 'queued', 'worker', 0],
      ['held', C, 'some', 'stalls', 60_000], ['sim', 'x', 'end', 'sim', COORD_BLOCKED_HELD_MS + STALL_SWEEP_MS + 1]]);
    expect(byName('CB-reach').check(lines)).toBeNull();
  });
  const DOWN: Row[] = [['mail', '1', 'queued', 'worker', 0], ['held', C, 'some', 'stalls', 60_000],
    ['server', 'crash', 'down', 'sim', COORD_BLOCKED_HELD_MS], ['mail', '2', 'queued', 'worker', COORD_BLOCKED_HELD_MS + 300_000],
    ['server', 'boot', 'up', 'sim', COORD_BLOCKED_HELD_MS + 600_000]];
  const BOOT_AT = COORD_BLOCKED_HELD_MS + 600_000;
  it('CONTROL: CB-reach stays green while the server is down', () => {
    const lines = seqOf([...DOWN, ['sim', 'x', 'end', 'sim', BOOT_AT + STALL_SWEEP_MS - 1]]);
    expect(byName('CB-reach').check(lines)).toBeNull();
  });
  it('CONTROL: CB-reach restarts its clock at the boot, so a missing push a sweep later is red', () => {
    const lines = seqOf([...DOWN, ['sim', 'x', 'end', 'sim', BOOT_AT + STALL_SWEEP_MS + 1]]);
    expect(byName('CB-reach').check(lines)?.invariant).toBe('CB-reach');
  });
  it('CONTROL: CB-reach judges a crash line while the server is still up, so a push missed before the crash is red', () => {
    // Applied before it is judged, the crash would hide the miss: the server is down, then the boot restarts the clock.
    const lines = seqOf([['server', 'boot', 'up', 'sim', 0], ['mail', '1', 'queued', 'worker', 0],
      ['held', C, 'some', 'stalls', 60_000], ['server', 'crash', 'down', 'sim', COORD_BLOCKED_HELD_MS + STALL_SWEEP_MS + 1],
      ['server', 'boot', 'up', 'sim', COORD_BLOCKED_HELD_MS + 3 * STALL_SWEEP_MS],
      ['push', '0', 'rung-1', 'stalls', COORD_BLOCKED_HELD_MS + 3 * STALL_SWEEP_MS]]);
    expect(byName('CB-reach').check(lines)).toMatchObject({ invariant: 'CB-reach', seq: 4 });
  });
  it('CONTROL: CB-reach wants the push at the first sweep at or after the threshold, not one sweep later', () => {
    const late = (queuedAt: number, pushAt: number): SequenceLine[] => seqOf([['server', 'boot', 'up', 'sim', 0],
      ['mail', '1', 'queued', 'worker', queuedAt], ['held', C, 'some', 'stalls', queuedAt],
      ['verdict', C, 'rung-1', 'stalls', pushAt], ['push', String(queuedAt), 'rung-1', 'stalls', pushAt]]);
    // A mail queued on a sweep falls due on a sweep: the push is due at that sweep itself.
    expect(byName('CB-reach').check(late(0, COORD_BLOCKED_HELD_MS))).toBeNull();
    expect(byName('CB-reach').check(late(0, COORD_BLOCKED_HELD_MS + STALL_SWEEP_MS))?.invariant).toBe('CB-reach');
    // A mail queued half a sweep after one falls due between two: the next sweep is in time, and the sweep after is not.
    const half = STALL_SWEEP_MS / 2;
    expect(byName('CB-reach').check(late(half, COORD_BLOCKED_HELD_MS + STALL_SWEEP_MS))).toBeNull();
    expect(byName('CB-reach').check(late(half, COORD_BLOCKED_HELD_MS + 2 * STALL_SWEEP_MS))?.invariant).toBe('CB-reach');
  });
  it('CONTROL: CB-rung-never-falls goes red on rung-2 then rung-1 while mail stays held, and not across a boot or a release', () => {
    // The stretch is the lane's held lines; no episode line is needed, so a decider that returns none cannot hide a fall.
    const held: Row = ['held', C, 'some', 'stalls', 0];
    const two: Row = ['verdict', C, 'rung-2', 'stalls', 60_000];
    const one: Row = ['verdict', C, 'rung-1', 'stalls', 180_000];
    expect(byName('CB-rung-never-falls').check(seqOf([held, two, one]))?.invariant).toBe('CB-rung-never-falls');
    const boot: Row = ['server', 'boot', 'up', 'sim', 120_000];
    const heldAgain: Row = ['held', C, 'some', 'stalls', 120_000];
    expect(byName('CB-rung-never-falls').check(seqOf([held, two, boot, heldAgain, one]))).toBeNull();
    const none: Row = ['held', C, 'none', 'stalls', 120_000];
    expect(byName('CB-rung-never-falls').check(seqOf([held, two, none, heldAgain, one]))).toBeNull();
  });
  it('holds both invariants on every seed, and the seeds reach every edge', async () => {
    await assertScenario(coordBlockedDay(stall), COORD_BLOCKED_INVARIANTS, { seeds: simSeeds(SEEDS), testFile: FILE });
  });
});
