// The predicted-conflict chip's words (landing order wave 4b; D-7480, D-7481). Pure: `landingOf` is the one reader, the
// summary is total over what the radar can say, and absence is never "no conflict".
import { describe, expect, it } from 'vitest';
import { RADAR_PROBE_FRESH_S, type SessionLanding } from '../../shared/api';
import {
  CHIP_LINES_MAX, CHIP_PATHS_MAX, conflictChipSentence, conflictChipState, conflictChipWord, conflictSummaryOf, landingOf,
} from '../src/fleet/conflictWords';
import { fleetSession } from './fleetFixture';

const NOW = Date.parse('2026-10-29T12:00:00.000Z');
// The radar's own stamp shape (`isRadarStamp`): whole seconds, no millis.
const iso = (agoS: number): string => new Date(NOW - agoS * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

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
    expect(both.conflicted).toEqual([{ project: 'proj-a', pr: 12, against: { pr: 14 }, paths: ['src/x.ts'], pathsCut: false }]);
    expect(conflictChipWord(both)).toBe('1 predicted conflict');
    expect(conflictChipSentence(both)).toContain('PRs #12 and #14 conflict in src/x.ts');
    // Reported by the higher PR alone: still under the lower number.
    const only = conflictSummaryOf([sess('b', b)], NOW)!;
    expect(only.conflicted).toEqual([{ project: 'proj-a', pr: 12, against: { pr: 14 }, paths: ['src/x.ts'], pathsCut: false }]);
  });

  it('rejects a landing whose at is not the radar\'s stamp (millis, a space) as no landing', () => {
    expect(landingOf(sess('a', landing({ at: '2026-10-29T11:59:30.000Z' })), NOW)).toBeNull();
    expect(landingOf(sess('a', landing({ at: '2026-10-29 11:59:30' })), NOW)).toBeNull();
  });

  it('says what was cut, what was not measured, and when the oldest reading was measured', () => {
    const s = conflictSummaryOf([
      sess('a', landing({ at: iso(600), base: { state: 'conflict', paths: ['src/a.ts'], pathsCut: true }, unmeasuredWith: [15], cut: { heads: true, pairs: false, unbound: false } })),
      sess('b', landing({ pr: 14 })),
    ], NOW)!;
    expect(s.oldestAt).toBe(iso(600));
    const sentence = conflictChipSentence(s);
    expect(sentence).toContain('PR #12 conflicts with main in src/a.ts (more paths not recorded)');
    expect(sentence).toContain('Not every open PR or pair of PRs was measured');
    expect(sentence).not.toContain('(list cut)');
    expect(sentence).toContain('1 not measured: #12 with #15');
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
    expect(s.unmeasured).toHaveLength(2);
    expect(conflictChipSentence(s)).toContain('2 not measured: #12 with #14, #12 with #15');
  });

  it('counts the same pair numbers of two projects separately, and an unmeasured base beside them', () => {
    const s = conflictSummaryOf([
      sess('a', landing({ pr: 12, unmeasuredWith: [14] }), 'proj-a'),
      sess('b', landing({ pr: 12, unmeasuredWith: [14], base: { state: 'unmeasured' } }), 'proj-b'),
    ], NOW)!;
    expect(s.unmeasured).toHaveLength(3);
  });
});

describe('the sentence names the project when the fleet spans projects, and says what is not paired', () => {
  const base = (paths: string[]) => landing({ base: { state: 'conflict', paths } });

  it('prefixes each line with its project when more than one project has a landing', () => {
    const s = conflictSummaryOf([sess('a', base(['src/a.ts']), 'proj-a'), sess('b', base(['src/b.ts']), 'proj-b')], NOW)!;
    expect(s.projects).toBe(2);
    const sentence = conflictChipSentence(s);
    expect(sentence).toContain('proj-a: PR #12 conflicts with main in src/a.ts');
    expect(sentence).toContain('proj-b: PR #12 conflicts with main in src/b.ts');
  });

  it('prefixes a pair line the same way', () => {
    const a = landing({ conflicts: [{ pr: 14, paths: ['src/x.ts'], pathsCut: false }] });
    const s = conflictSummaryOf([sess('a', a, 'proj-a'), sess('b', landing({ pr: 30 }), 'proj-b')], NOW)!;
    expect(conflictChipSentence(s)).toContain('proj-a: PRs #12 and #14 conflict in src/x.ts');
  });

  it('leaves the sentence unchanged with one project, however many sessions', () => {
    const s = conflictSummaryOf([sess('a', base(['src/a.ts']), 'proj-a'), sess('b', landing({ pr: 14 }), 'proj-a')], NOW)!;
    expect(s.projects).toBe(1);
    expect(conflictChipSentence(s)).toContain('. PR #12 conflicts with main in src/a.ts');
    expect(conflictChipSentence(s)).not.toContain('proj-a');
  });

  it('adds "N not paired" for a landing the radar left out of its pairs, beside the unchanged word', () => {
    const s = conflictSummaryOf([sess('a', landing({ paired: false })), sess('b', landing({ pr: 14, paired: false })), sess('c', landing({ pr: 15 }))], NOW)!;
    expect(s.unpaired).toHaveLength(2);
    expect(conflictChipWord(s)).toBe('Conflicts partly measured');
    expect(conflictChipSentence(s)).toContain('2 not paired: #12, #14');
  });

  it('says nothing of pairing when every landing is paired', () => {
    expect(conflictChipSentence(conflictSummaryOf([sess('a', landing())], NOW)!)).not.toContain('not paired');
  });
});

describe('the sentence is capped, and each cut says what it is (landing order wave 5a; 4b F6)', () => {
  const PATH_CUT = '(more paths not recorded)';
  const LIST_CUT = 'Not every open PR or pair of PRs was measured';
  const UNBOUND = "A PR on a session's branch was not matched to its session, so it was not compared with the others";
  const conflictAt = (pr: number, paths: string[]) => landing({ pr, base: { state: 'conflict', paths } });

  it('pins the caps by their literal values', () => {
    expect(CHIP_PATHS_MAX).toBe(3);
    expect(CHIP_LINES_MAX).toBe(5);
  });

  it('names at most three paths on a line, and says how many more', () => {
    const five = conflictChipSentence(conflictSummaryOf([sess('a', conflictAt(12, ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts']))], NOW)!);
    expect(five).toContain('PR #12 conflicts with main in src/a.ts, src/b.ts, src/c.ts and 2 more.');
    expect(five).not.toContain('src/d.ts');
    const three = conflictChipSentence(conflictSummaryOf([sess('a', conflictAt(12, ['src/a.ts', 'src/b.ts', 'src/c.ts']))], NOW)!);
    expect(three).toContain('PR #12 conflicts with main in src/a.ts, src/b.ts, src/c.ts.');
    expect(three).not.toContain(' more');
  });

  it('lists at most five conflict lines, then "and N more"', () => {
    const at = (prs: number[]) => conflictChipSentence(conflictSummaryOf(prs.map((pr) => sess(`s${pr}`, conflictAt(pr, ['src/a.ts']))), NOW)!);
    const parts = at([11, 12, 13, 14, 15, 16, 17]).split('. ');
    expect(parts.slice(0, 7)).toEqual([
      '7 predicted conflicts',
      ...[11, 12, 13, 14, 15].map((pr) => `PR #${pr} conflicts with main in src/a.ts`),
      'and 2 more',
    ]);
    expect(parts[7]).toMatch(/^measured \d\d:\d\d$/);
    expect(at([11, 12, 13, 14, 15])).not.toContain('more');
  });

  it.each([
    ['a path list the radar cut', { base: { state: 'conflict', paths: ['src/a.ts'], pathsCut: true } }, PATH_CUT],
    ["the radar's heads cut", { cut: { heads: true, pairs: false, unbound: false } }, LIST_CUT],
    ["the radar's pairs cut", { cut: { heads: false, pairs: true, unbound: false } }, LIST_CUT],
    ['an unbound head', { cut: { heads: false, pairs: false, unbound: true } }, UNBOUND],
  ] as const)('%s has its own words, and only those', (_name, over, words) => {
    const sentence = conflictChipSentence(conflictSummaryOf([sess('a', landing(over as Partial<SessionLanding>))], NOW)!);
    for (const w of [PATH_CUT, LIST_CUT, UNBOUND]) expect(sentence.includes(w), w).toBe(w === words);
    expect(sentence).not.toContain('(list cut)');
  });

  it('says a path cut on its own line, for a base line and a pair line', () => {
    const s = conflictSummaryOf([sess('a', landing({
      base: { state: 'conflict', paths: ['src/a.ts'], pathsCut: true },
      conflicts: [{ pr: 14, paths: ['src/x.ts'], pathsCut: true }],
    }))], NOW)!;
    const sentence = conflictChipSentence(s);
    expect(sentence).toContain('PR #12 conflicts with main in src/a.ts (more paths not recorded)');
    expect(sentence).toContain('PRs #12 and #14 conflict in src/x.ts (more paths not recorded)');
  });

  it('names what "not measured" counts, a base merge and a pair, within the cap', () => {
    expect(conflictChipSentence(conflictSummaryOf([sess('a', landing({ base: { state: 'unmeasured' } }))], NOW)!))
      .toContain('1 not measured: #12 with main');
    expect(conflictChipSentence(conflictSummaryOf([sess('a', landing({ unmeasuredWith: [13, 14, 15, 16, 17] }))], NOW)!))
      .toContain('5 not measured: #12 with #13, #12 with #14, #12 with #15 and 2 more');
  });

  it('orders the named merges by project and PR, base first, and names the project across projects', () => {
    const s = conflictSummaryOf([
      sess('b', landing({ unmeasuredWith: [14], base: { state: 'unmeasured' } }), 'proj-b'),
      sess('a', landing({ unmeasuredWith: [14] }), 'proj-a'),
    ], NOW)!;
    expect(conflictChipSentence(s)).toContain('3 not measured: proj-a #12 with #14, proj-b #12 with main, proj-b #12 with #14');
  });

  it('names what "not paired" counts, within the cap and across projects', () => {
    const five = conflictSummaryOf([11, 12, 13, 14, 15].map((pr) => sess(`s${pr}`, landing({ pr, paired: false }))), NOW)!;
    expect(conflictChipSentence(five)).toContain('5 not paired: #11, #12, #13 and 2 more');
    const two = conflictSummaryOf([sess('b', landing({ paired: false }), 'proj-b'), sess('a', landing({ pr: 30, paired: false }), 'proj-a')], NOW)!;
    expect(conflictChipSentence(two)).toContain('2 not paired: proj-a #30, proj-b #12');
  });

  it("bounds review 1225's measured fleet: 10 PRs, 55 conflicts, 20 paths of 300 characters", () => {
    const long = Array.from({ length: 20 }, (_, i) => `src/${String(i).padStart(2, '0')}/${'x'.repeat(293)}`);
    const prs = Array.from({ length: 10 }, (_, i) => 101 + i);
    const s = conflictSummaryOf(prs.map((pr) => sess(`s${pr}`, landing({
      pr, base: { state: 'conflict', paths: long, pathsCut: true },
      conflicts: prs.filter((o) => o !== pr).map((o) => ({ pr: o, paths: long, pathsCut: true })),
    }))), NOW)!;
    expect(s.conflicted).toHaveLength(55);
    const sentence = conflictChipSentence(s);
    const parts = sentence.split('. ');
    const shown = `${long.slice(0, 3).join(', ')} and 17 more (more paths not recorded)`;
    expect(parts[0]).toBe('55 predicted conflicts');
    expect(parts.filter((p) => /^PRs? #/.test(p))).toHaveLength(5);
    expect(parts[1]).toBe(`PR #101 conflicts with main in ${shown}`);
    expect(parts[5]).toBe(`PRs #101 and #105 conflict in ${shown}`);
    expect(parts[6]).toBe('and 50 more');
    expect(sentence.length).toBeLessThanOrEqual(5_000);
  });

  it('orders the parts: word, lines, tail, the cut sentences, the clauses, the time', () => {
    const s = conflictSummaryOf([sess('a', landing({
      pr: 12, paired: false, unmeasuredWith: [19],
      base: { state: 'conflict', paths: ['src/a.ts'] },
      conflicts: [14, 15, 16, 17, 18].map((pr) => ({ pr, paths: ['src/x.ts'], pathsCut: false })),
      cut: { heads: true, pairs: false, unbound: true },
    }))], NOW)!;
    const parts = conflictChipSentence(s).split('. ');
    expect(parts.slice(0, 11)).toEqual([
      '6 predicted conflicts',
      'PR #12 conflicts with main in src/a.ts',
      ...[14, 15, 16, 17].map((pr) => `PRs #12 and #${pr} conflict in src/x.ts`),
      'and 1 more',
      LIST_CUT,
      UNBOUND,
      '1 not measured: #12 with #19',
      '1 not paired: #12',
    ]);
    expect(parts[11]).toMatch(/^measured \d\d:\d\d$/);
    expect(parts).toHaveLength(12);
  });
});
