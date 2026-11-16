// D-8071 (spec §11.1, F6): a run row is named by the title the run was opened with. An older server sends no
// `runTitle`, and the row is named as before.
import { describe, it, expect } from 'vitest';
import { runRowName } from '../src/fleet/runWords';

const run = { program: 'programme-a', programTitle: 'Programme A', wave: 3, waveOf: 5 as number | null };

describe('runRowName', () => {
  it('prefers runTitle', () => {
    expect(runRowName({ ...run, runTitle: 'Wave three work' })).toBe('Wave three work · wave 3 of 5');
  });
  it('an older server with no runTitle names the row as today', () => {
    expect(runRowName(run)).toBe('Programme A · wave 3 of 5');
    expect(runRowName({ ...run, runTitle: null })).toBe('Programme A · wave 3 of 5');
    expect(runRowName({ ...run, runTitle: '  ' })).toBe('Programme A · wave 3 of 5');
  });
});
