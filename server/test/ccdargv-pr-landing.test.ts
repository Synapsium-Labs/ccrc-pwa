import { describe, it, expect } from 'vitest';
import { CCD_ARGV } from '../src/ccdargv.js';

describe('CCD_ARGV.prLanding (D-6784)', () => {
  it('the argv is pr-landing --project p --sessions a:41,b:42', () => {
    expect([...CCD_ARGV.prLanding('project-a', [{ id: 'a', pr: 41 }, { id: 'b', pr: 42 }])])
      .toEqual(['pr-landing', '--project', 'project-a', '--sessions', 'a:41,b:42']);
  });
  it('an id with a comma or a colon is refused by the builder', () => {
    for (const id of ['a,b', 'a:b', '', 'a b', 'a;b']) {
      expect(() => CCD_ARGV.prLanding('project-a', [{ id, pr: 41 }]), id).toThrow();
    }
  });
  it('a pr of 0, 07 or -1 is refused by the builder', () => {
    for (const pr of [0, '07', -1, '1e3', 1.5, 1_000_000_000]) {
      expect(() => CCD_ARGV.prLanding('project-a', [{ id: 'a', pr }]), String(pr)).toThrow();
    }
  });
});
