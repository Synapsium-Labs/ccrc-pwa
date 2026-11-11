// The fleet's expected Claude Code build and each session's place against it (D-8276): `fleetClaudeLatest`,
// `claudeBuildOf` and `claudeBuildCounts` (`shared/claudeVersion.ts`), the one reading the roll lane acts on and the
// console draws. Every pane on the node launches the one installed binary, so the newest build any awake session runs
// is the build a restart lands on; a session on an older one is behind. Pure: no fixture HOME, no process.
import { describe, expect, it } from 'vitest';
import { claudeBuildCounts, claudeBuildOf, fleetClaudeLatest, type ClaudeBuildRow } from '../../shared/claudeVersion.js';

const row = (version: string | null, o: Partial<ClaudeBuildRow> = {}): ClaudeBuildRow =>
  ({ version, archivedAt: null, hibernatedAt: null, ...o });

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
    expect(fleetClaudeLatest([{ version: '2.1.300', archivedAt: null }])).toBe('2.1.300');
  });
});

describe('claudeBuildOf (D-8276)', () => {
  it('a session on an older build than the newest is behind, naming both', () => {
    expect(claudeBuildOf(row('2.1.296'), '2.1.302')).toEqual({ kind: 'behind', build: '2.1.296', latest: '2.1.302' });
  });

  it('a session on the newest build is current', () => {
    expect(claudeBuildOf(row('2.1.302'), '2.1.302')).toEqual({ kind: 'current', build: '2.1.302' });
  });

  it('a session whose build is unmeasured, malformed or archived is unmeasured; a hibernated one is asleep', () => {
    expect(claudeBuildOf(row(null), '2.1.302')).toEqual({ kind: 'unmeasured' });
    expect(claudeBuildOf(row('2.1'), '2.1.302')).toEqual({ kind: 'unmeasured' });
    expect(claudeBuildOf(row('2.1.296', { archivedAt: 3 }), '2.1.302')).toEqual({ kind: 'unmeasured' });
    expect(claudeBuildOf(row('2.1.296', { hibernatedAt: 3 }), '2.1.302')).toEqual({ kind: 'asleep' });
  });

  it('with no newest build known, a measured session is current: nothing says it is behind', () => {
    expect(claudeBuildOf(row('2.1.296'), null)).toEqual({ kind: 'current', build: '2.1.296' });
  });
});

describe('claudeBuildCounts (D-8276)', () => {
  it('counts the fleet against its own newest build', () => {
    const rows = [row('2.1.302'), row('2.1.296'), row('2.1.300'), row(null), row('2.1.290', { hibernatedAt: 9 }), row('2.1.1', { archivedAt: 9 })];
    expect(claudeBuildCounts(rows)).toEqual({ latest: '2.1.302', behind: 2, current: 1, unmeasured: 2, asleep: 1 });
  });

  it('an empty fleet has nothing behind and no newest build', () => {
    expect(claudeBuildCounts([])).toEqual({ latest: null, behind: 0, current: 0, unmeasured: 0, asleep: 0 });
  });
});
