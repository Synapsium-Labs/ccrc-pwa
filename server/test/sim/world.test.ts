import { describe, it, expect } from 'vitest';
import { fakeTime } from '../fakeTime.js';
import { SimWorld, chance, pick } from './world.js';

const T0 = Date.parse('2026-10-12T00:00:00Z');
const world = (): SimWorld => new SimWorld({ wallMs: T0, seed: 1 });

describe('the simulator world, on the time-ports fake', () => {
  it('server and world timers due at the same instant run in the order they were scheduled', () => {
    const w = world(); const ran: string[] = [];
    w.server.scheduler.after(60_000, () => ran.push('a')); w.envAfter(60_000, () => ran.push('b'));
    w.server.scheduler.after(60_000, () => ran.push('c'));
    w.runUntil(60_000);
    expect(ran).toEqual(['a', 'b', 'c']);
  });
  it('runUntil moves both clocks to each timer, then to its end', () => {
    const w = world(); const c = w.server.clock; const seen: [number, number][] = [];
    w.server.scheduler.after(30_000, () => seen.push([c.wall(), c.mono()]));
    w.runUntil(90_000);
    expect(seen).toEqual([[T0 + 30_000, 30_000]]);
    expect([c.wall(), c.mono()]).toEqual([T0 + 90_000, 90_000]);
  });
  it('a cancelled server timer never runs', () => {
    const w = world(); let ran = false;
    const cancel = w.server.scheduler.after(10, () => { ran = true; }); cancel(); w.runUntil(20);
    expect(ran).toBe(false);
  });
  it('crash(600_000) drops server timers, keeps world timers and boots again 600 000 ms later', () => {
    const w = world(); const ran: string[] = [];
    w.onBoot(() => ran.push(`boot ${w.server.clock.mono()}`));
    w.server.scheduler.after(1_000_000, () => ran.push('server')); w.envAfter(1_000_000, () => ran.push('world'));
    w.crash(600_000);
    expect(w.isDown()).toBe(true);
    expect(() => w.crash(1)).toThrow(/down/);
    w.runUntil(2_000_000);
    expect(ran).toEqual(['boot 0', 'boot 600000', 'world']);
    expect(w.isDown()).toBe(false);
  });
  it('a world timer due while the server is down runs at its own time, before the boot', () => {
    const w = world(); const c = w.server.clock; const seen: [string, number, number][] = [];
    w.onBoot(() => seen.push(['boot', c.wall(), c.mono()]));
    w.envAfter(300_000, () => seen.push(['world', c.wall(), c.mono()]));
    w.crash(600_000); w.runUntil(600_000);
    expect(seen).toEqual([['boot', T0, 0], ['world', T0 + 300_000, 300_000], ['boot', T0 + 600_000, 600_000]]);
  });
  it('skewWall(5_000) moves the server\'s wall back and leaves mono and the host clock alone', () => {
    const w = world(); w.skewWall(5_000);
    expect([w.server.clock.wall(), w.server.clock.mono(), w.time.ports.clock.wall()]).toEqual([T0 - 5_000, 0, T0]);
  });
  it('server and world timers refuse a delay the fake refuses', () => {
    const w = world();
    for (const ms of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => w.server.scheduler.after(ms, () => {})).toThrow(RangeError);
      expect(() => w.envAfter(ms, () => {})).toThrow(RangeError);
    }
  });
  it('a world timer that re-arms itself at 0 ms stops at the budget, and the fake warns', () => {
    const w = new SimWorld({ wallMs: T0, seed: 1, maxCalls: 50 }); let n = 0;
    const again = (): void => { n++; w.envAfter(0, again); };
    w.envAfter(0, again);
    w.runUntil(1_000);
    expect(n).toBe(50);
    expect(w.time.warnings[0]).toMatch(/more than 50 scheduled calls/);
  });
  it('the server is handed the fake\'s one seeded chance', () => {
    const w = world();
    expect(w.server.entropy).toBe(w.time.ports.entropy);
  });
  it('chance and pick each take exactly one draw through below', () => {
    expect(chance(fakeTime({ seed: 1 }).ports.entropy, 0.5)).toBe(false);          // 2693262067 is not below 2 ** 31
    expect(pick(fakeTime({ seed: 1 }).ports.entropy, ['a', 'b', 'c', 'd'])).toBe('c'); // floor(2693262067 * 4 / 2 ** 32)
    const e = fakeTime({ seed: 1 }).ports.entropy; chance(e, 0.5);
    expect(e.below(2 ** 32)).toBe(11749833);                                         // the second draw
    expect(() => pick(e, [])).toThrow(RangeError);
  });
});
