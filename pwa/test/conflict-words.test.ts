// The predicted-conflict chip's words (landing order wave 4b; D-7480, D-7481). Pure: `landingOf` is the one reader, the
// summary is total over what the radar can say, and absence is never "no conflict".
import { describe, expect, it } from 'vitest';
import { RADAR_PROBE_FRESH_S, type SessionLanding } from '../../shared/api';
import {
  conflictChipSentence, conflictChipState, conflictChipWord, conflictSummaryOf, landingOf,
} from '../src/fleet/conflictWords';
import { fleetSession } from './fleetFixture';

const NOW = Date.parse('2026-10-29T12:00:00.000Z');
const iso = (agoS: number): string => new Date(NOW - agoS * 1000).toISOString();

const landing = (over: Partial<SessionLanding> = {}): SessionLanding => ({
  at: iso(30), pr: 12, head: 'abc1234', baseRef: 'main',
  base: { state: 'clean' }, paired: true, conflicts: [], unmeasuredWith: [],
  cut: { heads: false, pairs: false, unbound: false },
  ...over,
});
const sess = (id: string, l?: SessionLanding | Record<string, unknown>, project = 'proj-a') =>
  fleetSession({ id, project, ...(l === undefined ? {} : { landing: l as SessionLanding }) });

describe('landingOf — the one reader of FleetSession.landing', () => {
  it('reads absent as null, never as clean (an older server)', () => {
    expect(landingOf(sess('a'), NOW)).toBeNull();
  });
  it.each([
    ['not an object', 'x'], ['an array', []], ['no pr', { ...landing(), pr: undefined }],
    ['a bad base state', { ...landing(), base: { state: 'fine' } }],
    ['a non-boolean cut', { ...landing(), cut: { heads: 1, pairs: false, unbound: false } }],
  ])('reads a malformed key (%s) as null', (_name, bad) => {
    expect(landingOf(sess('a', bad as Record<string, unknown>), NOW)).toBeNull();
  });
  it('reads a valid landing', () => {
    expect(landingOf(sess('a', landing()), NOW)).toEqual(landing());
  });
  it('shows a landing at the window and hides one 1201 s old', () => {
    expect(landingOf(sess('a', landing({ at: iso(RADAR_PROBE_FRESH_S) })), NOW)).not.toBeNull();
    expect(landingOf(sess('a', landing({ at: iso(1201) })), NOW)).toBeNull();
  });
  it('shows a landing 61 s ahead of this clock: a behind device clock must not hide live landings (D-7481)', () => {
    expect(landingOf(sess('a', landing({ at: iso(-61) })), NOW)).not.toBeNull();
  });
});

describe('conflictSummaryOf and the words', () => {
  it('is null when no session has a fresh landing', () => {
    expect(conflictSummaryOf([], NOW)).toBeNull();
    expect(conflictSummaryOf([sess('a'), sess('b', landing({ at: iso(1201) }))], NOW)).toBeNull();
  });

  it('says "No predicted conflicts" only of clean landings, in the singular and the plural', () => {
    const one = conflictSummaryOf([sess('a', landing())], NOW)!;
    expect(conflictChipWord(one)).toBe('No predicted conflicts in 1 measured PR');
    expect(conflictChipState(one)).toBe('clean');
    const two = conflictSummaryOf([sess('a', landing()), sess('b', landing({ pr: 14 }))], NOW)!;
    expect(conflictChipWord(two)).toBe('No predicted conflicts in 2 measured PRs');
  });

  it('counts one PR once when two sessions name it', () => {
    expect(conflictSummaryOf([sess('a', landing()), sess('b', landing())], NOW)!.measured).toBe(1);
  });

  it('says "Conflicts partly measured" for each cut, an unmeasured base, an unpaired head and unmeasuredWith', () => {
    const cases: Array<[string, Partial<SessionLanding>]> = [
      ['pairs cut', { cut: { heads: false, pairs: true, unbound: false } }],
      ['heads cut', { cut: { heads: true, pairs: false, unbound: false } }],
      ['unbound head', { cut: { heads: false, pairs: false, unbound: true } }],
      ['unmeasured base', { base: { state: 'unmeasured' } }],
      ['unpaired head', { paired: false }],
      ['unmeasuredWith', { unmeasuredWith: [14] }],
    ];
    for (const [name, over] of cases) {
      const s = conflictSummaryOf([sess('a', landing(over))], NOW)!;
      expect(conflictChipWord(s), name).toBe('Conflicts partly measured');
      expect(conflictChipState(s), name).toBe('partial');
    }
  });

  it('lets one partial landing turn a fleet of clean ones partial', () => {
    const s = conflictSummaryOf([sess('a', landing()), sess('b', landing({ pr: 14, paired: false }))], NOW)!;
    expect(conflictChipWord(s)).toBe('Conflicts partly measured');
  });

  it('reads a base conflict, singular and plural, with its paths', () => {
    const one = conflictSummaryOf([sess('a', landing({ base: { state: 'conflict', paths: ['src/a.ts', 'src/b.ts'] } }))], NOW)!;
    expect(conflictChipWord(one)).toBe('1 predicted conflict');
    expect(conflictChipState(one)).toBe('conflict');
    expect(conflictChipSentence(one)).toContain('PR #12 conflicts with main in src/a.ts, src/b.ts');
    const two = conflictSummaryOf([
      sess('a', landing({ base: { state: 'conflict', paths: ['src/a.ts'] } })),
      sess('b', landing({ pr: 14, base: { state: 'conflict', paths: [] } })),
    ], NOW)!;
    expect(conflictChipWord(two)).toBe('2 predicted conflicts');
    expect(conflictChipSentence(two)).toContain('PR #14 conflicts with main.');
  });

  it('lists a pair once, under its lower PR, whichever side reported it', () => {
    const a = landing({ pr: 12, conflicts: [{ pr: 14, paths: ['src/x.ts'], pathsCut: false }] });
    const b = landing({ pr: 14, conflicts: [{ pr: 12, paths: ['src/x.ts'], pathsCut: false }] });
    const both = conflictSummaryOf([sess('a', a), sess('b', b)], NOW)!;
    expect(both.conflicted).toEqual([{ pr: 12, against: { pr: 14 }, paths: ['src/x.ts'], pathsCut: false }]);
    expect(conflictChipWord(both)).toBe('1 predicted conflict');
    expect(conflictChipSentence(both)).toContain('PRs #12 and #14 conflict in src/x.ts');
    // Reported by the higher PR alone: still under the lower number.
    const only = conflictSummaryOf([sess('b', b)], NOW)!;
    expect(only.conflicted).toEqual([{ pr: 12, against: { pr: 14 }, paths: ['src/x.ts'], pathsCut: false }]);
  });

  it('says what was cut, what was not measured, and when the oldest reading was measured', () => {
    const s = conflictSummaryOf([
      sess('a', landing({ at: iso(600), base: { state: 'conflict', paths: ['src/a.ts'], pathsCut: true }, unmeasuredWith: [15], cut: { heads: true, pairs: false, unbound: false } })),
      sess('b', landing({ pr: 14 })),
    ], NOW)!;
    expect(s.oldestAt).toBe(iso(600));
    const sentence = conflictChipSentence(s);
    expect(sentence).toContain('(list cut)');
    expect(sentence).toContain('1 not measured');
    expect(sentence).toMatch(/measured \d\d:\d\d$/);
  });

  it('carries every conflict into the name by PR number, base and path', () => {
    const s = conflictSummaryOf([sess('a', landing({
      base: { state: 'conflict', paths: ['src/a.ts'] }, conflicts: [{ pr: 14, paths: ['src/x.ts'], pathsCut: false }],
    }))], NOW)!;
    const name = conflictChipSentence(s);
    expect(name.startsWith('2 predicted conflicts. ')).toBe(true);
    expect(name).toContain('PR #12 conflicts with main in src/a.ts');
    expect(name).toContain('PRs #12 and #14 conflict in src/x.ts');
  });
});

// The radar is per project: PR #12 of one project is not PR #12 of another, so every key is scoped by the session's project.
describe('the summary keys each landing by its project (D-7480)', () => {
  it('counts the same PR number of two projects as two measured PRs, and a clean one never hides a partial one', () => {
    const s = conflictSummaryOf([sess('a', landing(), 'proj-a'), sess('b', landing({ paired: false }), 'proj-b')], NOW)!;
    expect(s.measured).toBe(2);
    expect(conflictChipWord(s)).toBe('Conflicts partly measured');
  });

  it('does not let a clean landing hide a conflicting one of the same number in another project', () => {
    const s = conflictSummaryOf([
      sess('a', landing(), 'proj-a'),
      sess('b', landing({ base: { state: 'conflict', paths: ['src/a.ts'] } }), 'proj-b'),
    ], NOW)!;
    expect(s.measured).toBe(2);
    expect(conflictChipWord(s)).toBe('1 predicted conflict');
  });

  it('is order-free: the conflicting project first reads the same', () => {
    const s = conflictSummaryOf([
      sess('b', landing({ base: { state: 'conflict' } }), 'proj-b'),
      sess('a', landing(), 'proj-a'),
    ], NOW)!;
    expect(conflictChipWord(s)).toBe('1 predicted conflict');
  });

  it('lists the same pair numbers in conflict in two projects twice, and each project\'s pair once', () => {
    const a = landing({ pr: 12, conflicts: [{ pr: 14, paths: ['src/x.ts'], pathsCut: false }] });
    const b = landing({ pr: 14, conflicts: [{ pr: 12, paths: ['src/x.ts'], pathsCut: false }] });
    const s = conflictSummaryOf([
      sess('a1', a, 'proj-a'), sess('a2', b, 'proj-a'), sess('b1', a, 'proj-b'), sess('b2', b, 'proj-b'),
    ], NOW)!;
    expect(s.conflicted).toHaveLength(2);
    expect(conflictChipWord(s)).toBe('2 predicted conflicts');
    expect(s.measured).toBe(4);
  });

  it('counts a base conflict of the same PR number in two projects twice', () => {
    const l = landing({ base: { state: 'conflict', paths: ['src/a.ts'] } });
    expect(conflictSummaryOf([sess('a', l, 'proj-a'), sess('b', l, 'proj-b')], NOW)!.conflicted).toHaveLength(2);
  });

  it('still counts one PR of one project once when two sessions name it', () => {
    expect(conflictSummaryOf([sess('a', landing(), 'proj-a'), sess('b', landing(), 'proj-a')], NOW)!.measured).toBe(1);
  });
});

describe('"N not measured"', () => {
  it('counts unmeasuredWith across sessions, and a pair reported from both of its PRs once', () => {
    const s = conflictSummaryOf([
      sess('a', landing({ pr: 12, unmeasuredWith: [14, 15] })),
      sess('b', landing({ pr: 14, unmeasuredWith: [12] })),
    ], NOW)!;
    expect(s.unmeasured).toBe(2);
    expect(conflictChipSentence(s)).toContain('2 not measured');
  });

  it('counts the same pair numbers of two projects separately, and an unmeasured base beside them', () => {
    const s = conflictSummaryOf([
      sess('a', landing({ pr: 12, unmeasuredWith: [14] }), 'proj-a'),
      sess('b', landing({ pr: 12, unmeasuredWith: [14], base: { state: 'unmeasured' } }), 'proj-b'),
    ], NOW)!;
    expect(s.unmeasured).toBe(3);
  });
});
