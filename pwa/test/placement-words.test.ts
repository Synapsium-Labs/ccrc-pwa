// The add control's sentence and the sheet's "lands on" line (named workspaces S7). `addWorkspaceLabel` is pinned
// here BEFORE it was refactored to share its clauses with `landsOnLine` (characterization first: these cases were
// green against the old ladder, and a move changes only what they import); `landsOnLine` is the new reader.
import { describe, expect, it } from 'vitest';
import type { ProjectedHome } from '../../shared/api';
import { addWorkspaceLabel, landsOnLine, type ProjectPlacementRead } from '../src/fleet/placementWords';
import { TEST_ROSTER } from './rosterFixture';

const forecast: ProjectedHome = { wrapper: 'claude9', score: 9 } as ProjectedHome;
const measured = (placement: unknown, pool: unknown = { state: 'untagged' }): ProjectPlacementRead =>
  ({ kind: 'measured', pool, placement } as ProjectPlacementRead);

const label = (read: ProjectPlacementRead, projected?: ProjectedHome | null): string =>
  addWorkspaceLabel('alpha', read, projected, TEST_ROSTER);

describe('addWorkspaceLabel, pinned', () => {
  it('a measured forecast names the account and its headroom', () => {
    expect(label(measured({ kind: 'projected', ...forecast }))).toBe('New workspace on alpha — team·alt, 91% free');
  });

  it('a legacy row with no readable tag falls back to the global projection', () => {
    expect(label({ kind: 'legacy' }, forecast)).toBe('New workspace on alpha — team·alt, 91% free');
  });

  it('a class nobody can serve says so', () => {
    expect(label(measured({ kind: 'none', pool: null, class: 'fable' }))).toBe('New workspace on alpha — no lane can serve fable');
  });

  it('nothing placeable names the pool when there is one', () => {
    expect(label(measured({ kind: 'none', pool: null }))).toMatch(/^New workspace on alpha — .*all disabled$/);
    expect(label(measured({ kind: 'none', pool: 'pool-a' }, { state: 'tagged', name: 'pool-a' })))
      .toMatch(/^New workspace on alpha — (nothing is in pool pool-a|nothing in pool pool-a is placeable, .* all disabled)$/);
  });

  it('a legacy row with an empty projection says all disabled', () => {
    expect(label({ kind: 'legacy' }, null)).toMatch(/^New workspace on alpha — .*all disabled$/);
  });

  it('a failed or missing read says so, and they are not folded', () => {
    expect(label({ kind: 'failed' })).toBe('New workspace on alpha — placement check failed; reopen ccrc to retry');
    expect(label({ kind: 'missing' })).toBe('New workspace on alpha — project absent from the latest placement check; reload ccrc');
  });

  it('a pending read, or a legacy one with no projection asked for, makes no claim', () => {
    expect(label({ kind: 'pending' })).toBe('New workspace on alpha');
    expect(label({ kind: 'legacy' })).toBe('New workspace on alpha');
  });
});

describe('landsOnLine', () => {
  const line = (read: ProjectPlacementRead, projected?: ProjectedHome | null): string | null =>
    landsOnLine(read, projected, TEST_ROSTER);

  it('names the account and its headroom for a forecast, measured or legacy', () => {
    expect(line(measured({ kind: 'projected', ...forecast }))).toBe('Lands on team·alt — 91% free.');
    expect(line({ kind: 'legacy' }, forecast)).toBe('Lands on team·alt — 91% free.');
  });

  it('says what is wrong where nothing can be placed, in the same words as the control', () => {
    expect(line(measured({ kind: 'none', pool: null, class: 'fable' }))).toBe('No lane can serve fable.');
    expect(line({ kind: 'failed' })).toBe('Placement check failed; reopen ccrc to retry.');
    expect(line({ kind: 'missing' })).toBe('Project absent from the latest placement check; reload ccrc.');
    expect(line(measured({ kind: 'none', pool: null }))).toMatch(/all disabled\.$/);
  });

  it('says nothing where the control says nothing', () => {
    expect(line({ kind: 'pending' })).toBeNull();
    expect(line({ kind: 'legacy' })).toBeNull();
  });
});
