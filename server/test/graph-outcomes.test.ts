// Graphify revision 2, Task GR4 (D-7350, D-7366): a census of the words the graph sweep's outcomes are spelled in.
// Three texts must agree: the plan's outcome table (how a build ends: its outcome and `fail` class), spec §7's census
// vocabulary (the outcomes and fail classes a `repos[]` row may carry), and the sweep itself, whose every outcome is
// decided by one function, `_gs_end <outcome> <fail class, or -> <reason>`. A word in one and not the other is a red:
// a table line the census cannot record, a census word nothing writes, or a sweep word the doctor and the hook were
// never told about. The table adds exactly one word to the spec's fail classes, `unknown`, for a build that ended
// after `.started` without the wrapper naming a class, which never forces a full build (D-7366). The rows that DRIVE
// each table line through the sweep are in graph-repo-sweep.test.ts.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(__dirname, '../..');
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), 'utf8');
const PLAN = 'docs/superpowers/plans/2026-10-29-graphify-r2-shared-graphs.md';
const SPEC = 'docs/superpowers/specs/2026-10-28-graphify-shared-graphs-design.md';
const SWEEP = 'ccd/ccd-graph-sweep';

const ticked = (s: string): string[] => [...s.matchAll(/`([a-z][a-z-]*)`/g)].map((m) => m[1]!);
const sorted = (xs: Iterable<string>): string[] => [...new Set(xs)].sort();

/** The plan's outcome table: each line's Outcome words and its `fail` words (`—` is none). */
function tableWords(plan: string): { outcomes: string[]; fails: string[]; lines: number } {
  const start = plan.indexOf('## The outcome table');
  const end = plan.indexOf('\n## ', start + 1);
  expect(start, 'the plan has its outcome table').toBeGreaterThan(0);
  const rows = plan.slice(start, end).split('\n').filter((l) => /^\| /.test(l) && !/^\| (Exit|---)/.test(l));
  const outcomes: string[] = []; const fails: string[] = [];
  for (const r of rows) {
    const cells = r.split('|').slice(1, -1).map((c) => c.trim());
    expect(cells, r).toHaveLength(6);
    // the outcome cell names the publish checks' words after "then"; the rest is its first word
    outcomes.push(...ticked(cells[3]!));
    if (cells[4] !== '—') fails.push(...ticked(cells[4]!));
  }
  return { outcomes: sorted(outcomes), fails: sorted(fails), lines: rows.length };
}

/** Spec §7: the census's outcome words and its `fail` classes. */
function specWords(spec: string): { outcomes: string[]; retired: string[]; fails: string[] } {
  const s7 = spec.slice(spec.indexOf('## 7. Census'), spec.indexOf('## 8. Doctor'));
  const vocab = s7.slice(s7.indexOf('Outcomes: '), s7.indexOf('A fetch failure'));
  const retired = s7.slice(s7.indexOf('The\nwords'), s7.indexOf('leave the vocabulary'));
  const fail = /"fail": "([a-z|]+)"/.exec(s7);
  expect(fail, 'spec §7 spells the row\'s fail classes').not.toBeNull();
  // `fail` inside "(with `fail` set)" names the field, not an outcome
  return { outcomes: sorted(ticked(vocab).filter((w) => w !== 'fail')), retired: sorted(ticked(retired)), fails: sorted(fail![1]!.split('|').filter((w) => w !== '')) };
}

/** The sweep's own words: every `_gs_end <outcome> <fail>` call in a code line. */
function sweepWords(sweep: string): { outcomes: string[]; fails: string[] } {
  const code = sweep.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const calls = [...code.matchAll(/\b_gs_end ([a-z][a-z-]*) ([a-z-]+)/g)];
  return { outcomes: sorted(calls.map((m) => m[1]!)), fails: sorted(calls.map((m) => m[2]!).filter((f) => f !== '-')) };
}

describe('the outcome words: the plan\'s table, spec §7\'s census and the sweep agree (D-7350, D-7366)', () => {
  const table = tableWords(read(PLAN));
  const spec = specWords(read(SPEC));
  const sweep = sweepWords(read(SWEEP));

  it('the inputs are what they say', () => {
    expect(table.lines, 'the table\'s 14 lines').toBe(14);
    expect(spec.outcomes).toEqual(['excluded', 'failed', 'fresh', 'no-source', 'oom-killed', 'rebuilt', 'refreshed',
      'refused-by-guard', 'refused-shrink', 'skipped-backoff', 'skipped-budget', 'skipped-slots', 'timed-out']);
    expect(spec.fails).toEqual(['engine', 'publish', 'setup']);
    expect(spec.retired).toEqual(['never-built', 'refused-no-exclude', 'restamped', 'skipped-busy', 'stale-rebuilt']);
  });

  it('every outcome the table names is a census outcome', () => {
    expect(table.outcomes.filter((w) => !spec.outcomes.includes(w))).toEqual([]);
    expect(table.outcomes).toEqual(['failed', 'oom-killed', 'rebuilt', 'refreshed', 'refused-shrink', 'skipped-slots', 'timed-out']);
  });

  it('the table\'s fail classes are the census\'s plus exactly one, `unknown` (D-7366)', () => {
    expect(table.fails.filter((w) => !spec.fails.includes(w))).toEqual(['unknown']);
    expect(spec.fails.filter((w) => !table.fails.includes(w)), 'every census class is a line of the table').toEqual([]);
  });

  it('the sweep writes exactly the census\'s outcomes, every one of them, and no other', () => {
    expect(sweep.outcomes).toEqual(spec.outcomes);
  });

  it('the sweep\'s fail classes are the table\'s: the census\'s three and `unknown`', () => {
    expect(sweep.fails).toEqual(table.fails);
    expect(sweep.fails).toEqual(['engine', 'publish', 'setup', 'unknown']);
  });

  it('no retired word (spec §7), nor the per-tree sweep\'s skipped-locked, is left in the sweep\'s code', () => {
    const code = read(SWEEP).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    for (const w of [...spec.retired, 'skipped-locked']) expect(code, w).not.toMatch(new RegExp(`\\b${w}\\b`));
  });

  it('only the engine and publish classes force a full build: `_gs_decide` names exactly those two', () => {
    const decide = /^_gs_decide\(\) \{[\s\S]*?\n\}$/m.exec(read(SWEEP));
    expect(decide, 'the sweep defines _gs_decide').not.toBeNull();
    const arm = [...decide![0].matchAll(/failed:([a-z]+)/g)].map((m) => m[1]!).sort();
    expect(arm).toEqual(['engine', 'publish']);
    expect(decide![0]).not.toMatch(/failed:(unknown|setup)/);
  });

  it('calibration: a word added to one text and not the others is seen', () => {
    expect(tableWords(read(PLAN).replace('`timed-out` | — | the same kind |', '`timed-out-ish` | — | the same kind |')).outcomes)
      .toContain('timed-out-ish');
    expect(sweepWords('_gs_end half-done unknown "x"\n# _gs_end commented engine "y"\n')).toEqual({ outcomes: ['half-done'], fails: ['unknown'] });
    expect(specWords(read(SPEC).replace('`excluded`. A fetch', '`excluded`, `stuck`. A fetch')).outcomes).toContain('stuck');
  });
});
