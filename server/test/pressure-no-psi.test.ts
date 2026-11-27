// A box with no PSI to read (the Windows port) still measures its memory headroom: the reading carries `psi: null`
// and the headroom, the pressure level stays `unmeasured`, and the wake gate's headroom floor still applies (D-8122).
import { describe, it, expect } from 'vitest';
import { memoryReadingOf, pressureBlock, type PressureState } from '../src/pressure.js';
import { wakeMemoryGate } from '../src/coord/wakeBudget.js';
import { localIO } from '../src/io.js';

const state = (headroomBytes: number): PressureState =>
  ({ last: { at: 1_000, psi: null, headroomBytes }, unansweredAt: null, inflightSince: null }) as PressureState;

describe('a pressure reading without PSI', () => {
  it('is unmeasured pressure with a measured headroom', () => {
    expect(memoryReadingOf(state(5e9), 1_500)).toEqual({ level: 'unmeasured', headroomBytes: 5e9 });
    expect(pressureBlock(state(5e9), true, 1_500)).toMatchObject({ level: 'unmeasured', memory: null, io: null });
  });

  it('feeds the wake gate its headroom floor: low headroom refuses, as on a box with PSI', () => {
    const cfg = { pressure: 'warn', headroomMinBytes: 1e9 } as Parameters<typeof wakeMemoryGate>[1];
    expect(wakeMemoryGate(memoryReadingOf(state(5e8), 1_500), cfg)).toEqual({ admit: false, refused: 'headroom-low' });
    expect(wakeMemoryGate(memoryReadingOf(state(5e9), 1_500), cfg)).toMatchObject({ admit: true });
  });

  it.skipIf(process.platform !== 'win32')('is what localIO answers on Windows', async () => {
    const r = await localIO.pressureMeasured();
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.psi).toBeNull(); expect(r.headroomBytes).toBeGreaterThan(0); }
  });
});
