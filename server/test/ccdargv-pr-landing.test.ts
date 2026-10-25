import { describe, it, expect } from 'vitest';
import { CCD_ARGV } from '../src/ccdargv.js';

describe('CCD_ARGV.prLanding (D-6784)', () => {
  it('the argv is pr-landing --project p --sessions a:41,b:42', () => {
    expect([...CCD_ARGV.prLanding('project-a', [{ id: 'a', pr: 41 }, { id: 'b', pr: 42 }])])
      .toEqual(['pr-landing', '--project', 'project-a', '--sessions', 'a:41,b:42']);
  });
  it('an id with a comma, a colon or a leading dash is refused by the builder', () => {
    for (const id of ['a,b', 'a:b', '', 'a b', 'a;b', '--x', '-a']) {
      expect(() => CCD_ARGV.prLanding('project-a', [{ id, pr: 41 }]), id).toThrow();
    }
  });
  it('a pr of 0, 07 or -1 is refused by the builder', () => {
    for (const pr of [0, '07', -1, '1e3', 1.5, 1_000_000_000]) {
      expect(() => CCD_ARGV.prLanding('project-a', [{ id: 'a', pr }]), String(pr)).toThrow();
    }
  });
  it('an empty list and a list of 17 are refused; 16 is the most one call names', () => {
    expect(() => CCD_ARGV.prLanding('project-a', [])).toThrow(/1 to 16/);
    const pairs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${String(i)}`, pr: i + 1 }));
    expect(() => CCD_ARGV.prLanding('project-a', pairs(17))).toThrow(/1 to 16/);
    expect(CCD_ARGV.prLanding('project-a', pairs(16))[4]?.split(',')).toHaveLength(16);
  });
  it('the same id twice in one call is refused by the builder', () => {
    expect(() => CCD_ARGV.prLanding('project-a', [{ id: 'a', pr: 41 }, { id: 'a', pr: 42 }])).toThrow(/once per call/);
  });
  it('a dot or a digit may lead an id; only a dash may not', () => {
    expect(CCD_ARGV.prLanding('project-a', [{ id: '.a', pr: 1 }, { id: '9-b', pr: 2 }])[4]).toBe('.a:1,9-b:2');
  });
});
