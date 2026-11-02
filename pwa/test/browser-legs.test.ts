// The browser leg's split into CI legs (`browser/legs.ts`), as pure functions over file lists. The other half, that
// the sequencer's `--shard` answer partitions what vitest itself collects under the browser config, is in
// `test/browser-leg.test.ts`, beside the helper that asks vitest for that list.
//
// The claim CI rests on: every collected file runs in exactly one leg, whatever the measured times say, and every
// leg computes the same split. A file in no leg is a test that silently never runs again; a file in two runs twice.
import { describe, expect, it } from 'vitest';
import {
  MEASURED_SECONDS, UNMEASURED_SECONDS, assertPartition, legOf, legSeconds, secondsOf, splitLegs,
} from '../browser/legs';

const MEASURED = Object.keys(MEASURED_SECONDS);
const NEW = ['browser/zz-new.browser.test.ts', 'browser/aa-new.browser.test.tsx', 'browser/mm-new.browser.test.ts'];

/** A fixed reordering (reverse, then every other element first), so a test of order-independence is repeatable. */
function reorder<T>(xs: readonly T[]): T[] {
  const r = [...xs].reverse();
  return [...r.filter((_, i) => i % 2 === 0), ...r.filter((_, i) => i % 2 === 1)];
}

describe('assertPartition: a file in no leg, in two, or never collected, is a loud failure', () => {
  const files = ['browser/a.browser.test.ts', 'browser/b.browser.test.ts', 'browser/c.browser.test.ts'];

  it('passes a true partition, empty legs included', () => {
    expect(() => assertPartition(files, [[files[0]!, files[2]!], [], [files[1]!]])).not.toThrow();
  });

  it('a file in no leg throws, naming it', () => {
    expect(() => assertPartition(files, [[files[0]!], [files[1]!]])).toThrow(`${files[2]} is in no leg`);
  });

  it('a file in two legs throws, naming it and the count', () => {
    expect(() => assertPartition(files, [[...files], [files[1]!]])).toThrow(`${files[1]} is in 2 legs`);
    expect(() => assertPartition(files, [[...files, files[0]!]])).toThrow(`${files[0]} is in 2 legs`);
  });

  it('a leg naming a file that was not collected throws', () => {
    expect(() => assertPartition(files, [[...files, 'browser/gone.browser.test.ts']]))
      .toThrow('browser/gone.browser.test.ts is in a leg but was not collected');
  });
});

describe('splitLegs: a time-balanced partition that depends on the set of files only', () => {
  it('partitions the measured files, plus new ones, for every leg count from 1 to 6', () => {
    const files = [...MEASURED, ...NEW];
    for (let n = 1; n <= 6; n++) {
      const legs = splitLegs(files, n);
      expect(legs, `${n} legs`).toHaveLength(n);
      expect(legs.flat().sort(), `${n} legs`).toEqual([...files].sort());
    }
  });

  it('gives the same legs whatever order the files arrive in', () => {
    const files = [...MEASURED, ...NEW];
    expect(splitLegs(reorder(files), 3)).toEqual(splitLegs(files, 3));
    expect(splitLegs([...files].sort(), 3)).toEqual(splitLegs(files, 3));
  });

  it("today's measured files: the three slowest in three legs, and no leg more than 60 s off the mean", () => {
    const legs = splitLegs(MEASURED, 3);
    const slowest = [...MEASURED].sort((a, b) => secondsOf(b) - secondsOf(a)).slice(0, 3);
    expect(slowest.map((f) => legs.findIndex((l) => l.includes(f))).sort()).toEqual([0, 1, 2]);
    const mean = legSeconds(MEASURED) / 3;
    for (const l of legs) expect(Math.abs(legSeconds(l) - mean)).toBeLessThanOrEqual(60);
  });

  it('a new file, with no measured time, goes to the lightest leg and is charged UNMEASURED_SECONDS', () => {
    const before = splitLegs(MEASURED, 3).map(legSeconds);
    const lightest = before.indexOf(Math.min(...before));
    const after = splitLegs([...MEASURED, NEW[0]!], 3);
    expect(after[lightest]).toContain(NEW[0]);
    expect(secondsOf(NEW[0]!)).toBe(UNMEASURED_SECONDS);
    expect(after.map(legSeconds).reduce((a, b) => a + b)).toBe(before.reduce((a, b) => a + b) + UNMEASURED_SECONDS);
  });

  it('several new files spread over the legs rather than piling on one', () => {
    const many = Array.from({ length: 6 }, (_, i) => `browser/new-${i}.browser.test.ts`);
    const legs = splitLegs(many, 3);
    expect(legs.map((l) => l.length)).toEqual([2, 2, 2]);
  });

  it('refuses a file collected twice and a leg count that is not a positive integer', () => {
    expect(() => splitLegs([MEASURED[0]!, MEASURED[0]!], 3)).toThrow('a file was collected twice');
    for (const n of [0, -1, 1.5, Number.NaN]) expect(() => splitLegs(MEASURED, n), String(n)).toThrow('is not a leg count');
  });

  it('more legs than files leaves the extra legs empty, still a partition', () => {
    expect(splitLegs(NEW, 5).flat().sort()).toEqual([...NEW].sort());
    expect(splitLegs(NEW, 5).filter((l) => l.length === 0)).toHaveLength(2);
  });
});

describe('legOf: one leg of the split, 1-based as --shard spells it', () => {
  it('legs 1..n are splitLegs in order', () => {
    const legs = splitLegs(MEASURED, 3);
    for (let i = 1; i <= 3; i++) expect(legOf(MEASURED, i, 3)).toEqual(legs[i - 1]);
  });

  it('leg 0, a leg past the count, or a fractional leg throws', () => {
    for (const i of [0, 4, 1.5]) expect(() => legOf(MEASURED, i, 3), String(i)).toThrow(`no leg ${i} of 3`);
  });
});
