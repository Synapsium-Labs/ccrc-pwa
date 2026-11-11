import { describe, it, expect } from 'vitest';
import type { TimePorts } from '../src/time/ports.js';
import { TIMER_MAX_MS } from '../src/time/rules.js';
import { fakeTime, FAKE_T0, mulberry32 } from './fakeTime.js';

interface Rig { ports: TimePorts; tick(ms: number): void; warnings(): string[] }
const flush = (): Promise<void> => new Promise((r) => { setImmediate(r); });
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function timeContract(name: string, make: () => Rig): void {
  describe(`the time ports contract: ${name}`, () => {
    it('a call fires once, no sooner than its delay, with the clock at its due time', () => {
      const r = make(); const seen: number[] = [];
      const m0 = r.ports.clock.mono();
      r.ports.scheduler.after(1000, () => { seen.push(r.ports.clock.mono() - m0); });
      r.tick(999); expect(seen).toEqual([]);
      r.tick(1); expect(seen).toEqual([1000]);
      r.tick(5000); expect(seen).toEqual([1000]);
    });
    it('calls fire in due order, equal dues in scheduling order', () => {
      const r = make(); const order: string[] = [];
      r.ports.scheduler.after(20, () => order.push('b'));
      r.ports.scheduler.after(10, () => order.push('a'));
      r.ports.scheduler.after(20, () => order.push('c'));
      r.tick(20); expect(order).toEqual(['a', 'b', 'c']);
    });
    it('a cancelled call never fires; cancel is idempotent and harmless after firing', () => {
      const r = make(); let n = 0;
      const cancel = r.ports.scheduler.after(10, () => { n++; });
      cancel(); cancel(); r.tick(10); expect(n).toBe(0);
      const late = r.ports.scheduler.after(10, () => { n++; });
      r.tick(10); late(); expect(n).toBe(1);
    });
    it('a throwing or rejecting call is one warning line, and the next call still fires', async () => {
      const r = make(); const after: number[] = [];
      r.ports.scheduler.after(10, () => { throw new Error('boom'); });
      r.ports.scheduler.after(10, async () => { throw new Error('late'); });
      r.ports.scheduler.after(20, () => after.push(1));
      r.tick(20); await flush();
      expect(r.warnings()).toEqual(['ccrc-server: a scheduled call failed: boom', 'ccrc-server: a scheduled call failed: late']);
      expect(after).toEqual([1]);
    });
    it('a delay it cannot keep is refused, never shortened', () => {
      const r = make();
      for (const ms of [-1, NaN, TIMER_MAX_MS + 1]) expect(() => r.ports.scheduler.after(ms, () => {})).toThrow(RangeError);
    });
    it('wall and mono move together as time passes', () => {
      const r = make(); const w0 = r.ports.clock.wall(); const m0 = r.ports.clock.mono();
      r.tick(1500);
      expect(r.ports.clock.wall() - w0).toBe(1500);
      expect(r.ports.clock.mono() - m0).toBe(1500);
    });
    it('entropy: shapes and ranges', () => {
      const e = make().ports.entropy;
      expect(e.hex(16)).toMatch(/^[0-9a-f]{32}$/);
      expect(() => e.hex(15)).toThrow(RangeError);
      expect(e.uuid()).toMatch(UUID_V4);
      expect(e.below(1)).toBe(0);
      const seen = new Set(Array.from({ length: 200 }, () => e.below(8)));
      expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      expect(() => e.below(0)).toThrow(RangeError);
      expect(() => e.below(2 ** 32 + 1)).toThrow(RangeError);
    });
  });
}

timeContract('the fake', () => { const f = fakeTime(); return { ports: f.ports, tick: (ms) => f.advance(ms), warnings: () => f.warnings }; });

describe('the fake alone', () => {
  it('starts at FAKE_T0 and mono 0 by default', () => {
    const f = fakeTime();
    expect([f.ports.clock.wall(), f.ports.clock.mono()]).toEqual([FAKE_T0, 0]);
  });
  it('mulberry32 is the test tree\'s generator: seed 1 draws what docs-grammar.test.ts\'s copy draws', () => {
    const n = mulberry32(1);
    expect([n(), n()]).toEqual([0.6270739405881613, 0.002735721180215478]);
  });
  it('golden draws for seed 1, so a recorded seed replays on any build', () => {
    const e = fakeTime({ seed: 1 }).ports.entropy;
    expect([e.below(2 ** 32), e.below(2 ** 32), e.below(2 ** 32)]).toEqual([2693262067, 11749833, 2265367787]);
    expect(fakeTime({ seed: 1 }).ports.entropy.hex(16)).toBe('f3ea87a0c949b300ebc40687fd2726fb');
    expect(fakeTime({ seed: 1 }).ports.entropy.uuid()).toBe('f3ea87a0-c949-4300-abc4-0687fd2726fb');
    expect(fakeTime({ seed: 2 }).ports.entropy.below(2 ** 32)).toBe(3153583793);
  });
  it('stepWall moves the wall alone and fires nothing', () => {
    const f = fakeTime(); let n = 0;
    f.ports.scheduler.after(10, () => { n++; });
    f.stepWall(-60_000);
    expect([f.ports.clock.wall(), f.ports.clock.mono(), n, f.pending()]).toEqual([FAKE_T0 - 60_000, 0, 0, 1]);
  });
  it('restart drops every pending call, moves the wall by the gap, and starts mono at 0', () => {
    const f = fakeTime(); let n = 0;
    f.advance(5000);
    f.ports.scheduler.after(10, () => { n++; });
    f.restart(3_600_000);
    f.advance(10);
    expect([f.ports.clock.wall(), f.ports.clock.mono(), n, f.pending()]).toEqual([FAKE_T0 + 5000 + 3_600_000 + 10, 10, 0, 0]);
  });
  it('a call scheduled by a firing call fires in the same advance when it falls due', () => {
    const f = fakeTime(); const at: number[] = [];
    f.ports.scheduler.after(10, () => { f.ports.scheduler.after(5, () => at.push(f.ports.clock.mono())); });
    f.advance(15);
    expect(at).toEqual([15]);
  });
});
