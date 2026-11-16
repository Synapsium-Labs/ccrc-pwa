import { describe, it, expect } from 'vitest';
import { CCD_ARGV } from '../src/ccdargv.js';
describe('CCD_ARGV.prStatePr (landing order wave 5c)', () => {
  it('the argv is pr-state --project p --pr n, the project before the number', () => {
    expect([...CCD_ARGV.prStatePr('project-a', 41)]).toEqual(['pr-state', '--project', 'project-a', '--pr', '41']);
    expect([...CCD_ARGV.prStatePr('project-a', '41')]).toEqual(['pr-state', '--project', 'project-a', '--pr', '41']);
    expect(CCD_ARGV.prStatePr('project-a', 999_999_999)[4]).toBe('999999999');
  });
  it('refuses a pr that is not a positive integer with no leading zero', () => {
    for (const pr of [0, -1, 1.5, '041', '1e3', '', ' 41', '41 ', 1_000_000_000, Number.NaN]) {
      expect(() => CCD_ARGV.prStatePr('project-a', pr as number), String(pr)).toThrow(/positive integer with no leading zero/);
    }
  });
  it('prLanding keeps its own refusal through the shared check (characterization, green before and after)', () => {
    expect(() => CCD_ARGV.prLanding('project-a', [{ id: 'a', pr: '041' }])).toThrow(/positive integer with no leading zero/);
  });
});
