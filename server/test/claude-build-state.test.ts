// The fleet's newest Claude Code build, what a restart reaches on each lane, and each session's place against both
// (D-8276): `fleetClaudeLatest`, `claudeBuildOf` and `claudeBuildCounts` (`shared/claudeVersion.ts`), the one reading
// the roll lane acts on and the console draws. A restart does NOT reach the fleet's newest build: the launcher picks
// the lane's own recorded build before the highest installed one (binary-lifecycle spec §2.2, "installed is not
// running"), so what a restart reaches is measured per lane (`wrapper`): the newest build an awake session on that lane
// runs. A session behind the fleet's newest that its own lane cannot move is behind, with no reach. Pure: no fixture
// HOME, no process.
import { describe, expect, it } from 'vitest';
import { claudeBuildCounts, claudeBuildOf, fleetClaudeLatest, laneClaudeLatest, type ClaudeBuildRow } from '../../shared/claudeVersion.js';

const row = (version: string | null, o: Partial<ClaudeBuildRow> = {}): ClaudeBuildRow =>
  ({ version, wrapper: 'lane-a', archivedAt: null, hibernatedAt: null, ...o });

describe('fleetClaudeLatest (D-8276)', () => {
  it('is the newest well-formed build an awake session runs, compared numerically', () => {
    expect(fleetClaudeLatest([row('2.1.99'), row('2.1.302'), row('2.1.296')])).toBe('2.1.302');
    expect(fleetClaudeLatest([row('2.2.0'), row('2.1.302')])).toBe('2.2.0');
  });

  it('ignores an unmeasured, malformed, archived or hibernated row', () => {
    expect(fleetClaudeLatest([row(null), row(''), row('v2.9.0'), row('2.9.0-beta'), row('2.1.296')])).toBe('2.1.296');
    expect(fleetClaudeLatest([row('2.9.0', { archivedAt: 1 }), row('2.9.1', { hibernatedAt: 1 }), row('2.1.296')])).toBe('2.1.296');
  });

  it('is null with no measured awake session', () => {
    expect(fleetClaudeLatest([])).toBeNull();
    expect(fleetClaudeLatest([row(null), row('2.1.300', { archivedAt: 5 })])).toBeNull();
  });

  it('reads a row whose hibernatedAt is absent (an older peer) as awake', () => {
    expect(fleetClaudeLatest([{ version: '2.1.300', wrapper: 'lane-a', archivedAt: null }])).toBe('2.1.300');
  });

});

describe('laneClaudeLatest (D-8276)', () => {
  it('is the newest build an awake session on THAT lane runs: what a restart there reaches', () => {
    const rows = [row('2.1.302', { wrapper: 'lane-a' }), row('2.1.296', { wrapper: 'lane-b' }), row('2.1.300', { wrapper: 'lane-b' })];
    expect(laneClaudeLatest(rows, 'lane-a')).toBe('2.1.302');
    expect(laneClaudeLatest(rows, 'lane-b')).toBe('2.1.300');
    expect(laneClaudeLatest(rows, 'lane-c')).toBeNull();
    expect(laneClaudeLatest([row('2.1.303', { wrapper: 'lane-b', hibernatedAt: 1 }), row('2.1.296', { wrapper: 'lane-b' })], 'lane-b'))
      .toBe('2.1.296');
  });
});

describe('claudeBuildOf (D-8276)', () => {
  it('a session behind the fleet\'s newest names both, and the newer build a restart on its lane reaches', () => {
    expect(claudeBuildOf(row('2.1.296'), '2.1.302', '2.1.302'))
      .toEqual({ kind: 'behind', build: '2.1.296', latest: '2.1.302', reach: '2.1.302' });
    expect(claudeBuildOf(row('2.1.296'), '2.1.302', '2.1.300'), 'its lane reaches only .300')
      .toEqual({ kind: 'behind', build: '2.1.296', latest: '2.1.302', reach: '2.1.300' });
  });

  it('a session behind the fleet\'s newest that its own lane cannot move has no reach', () => {
    expect(claudeBuildOf(row('2.1.296'), '2.1.302', '2.1.296')).toEqual({ kind: 'behind', build: '2.1.296', latest: '2.1.302', reach: null });
    expect(claudeBuildOf(row('2.1.296'), '2.1.302', null), 'an unmeasured lane reaches nothing known')
      .toEqual({ kind: 'behind', build: '2.1.296', latest: '2.1.302', reach: null });
    expect(claudeBuildOf(row('2.1.296'), '2.1.302', 'junk')).toEqual({ kind: 'behind', build: '2.1.296', latest: '2.1.302', reach: null });
  });

  it('a session on the newest build is current', () => {
    expect(claudeBuildOf(row('2.1.302'), '2.1.302', '2.1.302')).toEqual({ kind: 'current', build: '2.1.302' });
  });

  it('a session whose build is unmeasured, malformed or archived is unmeasured; a hibernated one is asleep', () => {
    expect(claudeBuildOf(row(null), '2.1.302', '2.1.302')).toEqual({ kind: 'unmeasured' });
    expect(claudeBuildOf(row('2.1'), '2.1.302', '2.1.302')).toEqual({ kind: 'unmeasured' });
    expect(claudeBuildOf(row('2.1.296', { archivedAt: 3 }), '2.1.302', '2.1.302')).toEqual({ kind: 'unmeasured' });
    expect(claudeBuildOf(row('2.1.296', { hibernatedAt: 3 }), '2.1.302', '2.1.302')).toEqual({ kind: 'asleep' });
  });

  it('with no newest build known, a measured session is current: nothing says it is behind', () => {
    expect(claudeBuildOf(row('2.1.296'), null, null)).toEqual({ kind: 'current', build: '2.1.296' });
  });
});

describe('claudeBuildCounts (D-8276)', () => {
  it('counts the fleet against its own newest build, and how many of those behind a restart can move', () => {
    const rows = [
      row('2.1.302'), row('2.1.296'), row('2.1.300'), row(null),
      row('2.1.296', { wrapper: 'lane-b' }), row('2.1.296', { wrapper: 'lane-b' }),
      row('2.1.290', { hibernatedAt: 9 }), row('2.1.1', { archivedAt: 9 }),
    ];
    expect(claudeBuildCounts(rows)).toEqual({ latest: '2.1.302', behind: 4, reachable: 2, current: 1, unmeasured: 2, asleep: 1 });
  });

  it('an empty fleet has nothing behind and no newest build', () => {
    expect(claudeBuildCounts([])).toEqual({ latest: null, behind: 0, reachable: 0, current: 0, unmeasured: 0, asleep: 0 });
  });
});
