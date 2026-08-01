import { describe, it, expect } from 'vitest';
import {
  boundRow, checksFor, draftPr, isFullLine, isMergedRow, parsePrLines, phaseFor,
  prView, unknownView,
  type CcdPrLine, type CcdPrRow,
} from '../src/prstate.js';
import type { TaskItem } from '../../shared/api.js';

const row = (over: Partial<CcdPrRow> = {}): CcdPrRow => ({
  number: 42, state: 'MERGED', headRefName: 'ws/quiet-basin', headRefOid: 'deadbee',
  baseRefName: 'main', isCrossRepository: false, mergedAt: '2026-07-20T10:00:00Z',
  mergeCommit: { oid: '7a68ca0' }, url: 'https://github.com/o/r/pull/42', title: 'the work',
  isDraft: false, statusCheckRollup: null, ours: true, ...over,
});

const line = (over: Partial<CcdPrLine> = {}): CcdPrLine => ({
  id: 'demo-quiet-basin', project: 'demo', repo: 'o/r', branch: 'ws/quiet-basin',
  base: 'origin/main', baseShort: 'main', tip: 'f'.repeat(40), ahead: 1, dirty: 0,
  commits: [{ sha: 'aaaaaaa', subject: 'the work', body: '' }], template: null,
  rows: [], phase: 'none', number: null, checkedAt: 1785300000000, reason: null, ...over,
});

describe('parsePrLines', () => {
  it('parses one object per line', () => {
    const out = parsePrLines(`${JSON.stringify(line())}\n${JSON.stringify(line({ id: 'demo-still-cove' }))}\n`);
    expect(out).toHaveLength(2);
  });

  it('skips a truncated line instead of throwing — tick() is void-dispatched', () => {
    // An uncaught parse throw here would take the whole process down.
    const out = parsePrLines(`${JSON.stringify(line())}\n{"id":"demo-tru`);
    expect(out).toHaveLength(1);
  });

  it('recognises the WHOLE-REPO failure object, which carries no id', () => {
    expect(parsePrLines('{"phase":"unknown","reason":"timeout"}')).toEqual([{ phase: 'unknown', reason: 'timeout' }]);
  });

  it('recognises the PER-SESSION failure object, which carries an id but no rows', () => {
    // `_pr_state_one` names the session in its failure object precisely so one
    // registry-incomplete workspace cannot back its whole project off. That id
    // must NOT make this read as a full line: `phaseFor` would then call
    // `boundRow(undefined, …)` and throw inside a void-dispatched sweep, taking
    // every project after it down with the throw. `rows` is the discriminator.
    expect(parsePrLines('{"id":"demo-still-cove","phase":"unknown","reason":"error"}'))
      .toEqual([{ id: 'demo-still-cove', phase: 'unknown', reason: 'error' }]);
    expect(isFullLine(parsePrLines('{"id":"demo-still-cove","phase":"unknown","reason":"error"}')[0]!))
      .toBe(false);
  });

  it('maps an unrecognised reason to error rather than letting it through', () => {
    expect(parsePrLines('{"phase":"unknown","reason":"banana"}')).toEqual([{ phase: 'unknown', reason: 'error' }]);
    expect(parsePrLines('{"id":"demo-x","phase":"unknown","reason":"banana"}'))
      .toEqual([{ id: 'demo-x', phase: 'unknown', reason: 'error' }]);
  });

  it('never lets a non-string id smuggle in as a per-session id — falls back to whole-repo', () => {
    // A malformed line whose `id` is not a string names no real session:
    // reading it as a per-session failure would carry a non-string id onto the
    // wire as `CcdPrSessionFailure.id`, which the type promises is a string.
    expect(parsePrLines('{"phase":"unknown","reason":"error","id":123}'))
      .toEqual([{ phase: 'unknown', reason: 'error' }]);
  });

  it('skips an object that is none of the three recognised shapes, rather than reading it as a failure', () => {
    // Neither a full line (no rows/id pair) nor a failure (`phase` is not
    // 'unknown'): a stray JSON object here is noise, not a "we could not read
    // GitHub" answer, and reporting it as one would fabricate a read failure
    // that never happened.
    expect(parsePrLines('{"foo":1}')).toEqual([]);
    expect(parsePrLines('{"phase":"merged"}')).toEqual([]);
  });
});

describe('the merge predicate', () => {
  it('holds only when every conjunct holds', () => {
    expect(isMergedRow(row(), 'main', 'ws/quiet-basin')).toBe(true);
  });

  it.each([
    ['a fork PR', { isCrossRepository: true }],
    ['a different base', { baseRefName: 'release/9' }],
    ['a different head', { headRefName: 'ws/still-cove' }],
    ['no mergedAt', { mergedAt: null }],
    ['no merge commit', { mergeCommit: null }],
    ['a non-oid merge commit', { mergeCommit: { oid: 'not-a-sha' } }],
    ['a head not reachable from our tip', { ours: false }],
    ['state OPEN', { state: 'OPEN' }],
  ])('fails on %s', (_name, over) => {
    expect(isMergedRow(row(over), 'main', 'ws/quiet-basin')).toBe(false);
  });

  it('never reads mergeable or mergeStateStatus', async () => {
    // They return the literal string "UNKNOWN" on merged PRs, which is exactly
    // the case this predicate exists to decide.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/prstate.ts', import.meta.url), 'utf8');
    expect(src).not.toContain('mergeStateStatus');
    expect(src).not.toContain('mergeable');
  });
});

describe('boundRow', () => {
  it('takes the highest number AFTER binding', () => {
    const rows = [row({ number: 99, isCrossRepository: true }), row({ number: 42 }), row({ number: 7 })];
    expect(boundRow(rows, 'main', 'ws/quiet-basin')!.number).toBe(42);
  });

  it('is null when nothing binds', () => {
    expect(boundRow([row({ ours: false })], 'main', 'ws/quiet-basin')).toBeNull();
  });

  it('refuses a row bound to a DIFFERENT branch, however well everything else matches', () => {
    // The `is_ours` class this plan was already bitten by once (Task 3's
    // review: an unpinned `headRefOid` let a row naming a different ref bind
    // and report merged). `headRefName` is a conjunct, not a hint — a row for
    // `ws/still-cove` must never bind a query for `ws/quiet-basin` just
    // because its cross-repo, base and `ours` fields all check out.
    expect(boundRow([row({ headRefName: 'ws/still-cove' })], 'main', 'ws/quiet-basin')).toBeNull();
  });
});

describe('checks', () => {
  it('is null — not pending — when no checks are configured', () => {
    expect(checksFor(row({ statusCheckRollup: null }))).toEqual({ checks: null, checkNames: null });
    expect(checksFor(row({ statusCheckRollup: [] }))).toEqual({ checks: null, checkNames: null });
  });

  it('names the FAILING checks only, capped, as inert text', () => {
    const c = checksFor(row({ statusCheckRollup: [
      { name: 'build', conclusion: 'SUCCESS' },
      { name: 'e2e', conclusion: 'FAILURE' },
      { name: 'lint', conclusion: 'TIMED_OUT' },
    ] }));
    expect(c.checks).toBe('fail');
    expect(c.checkNames).toEqual(['e2e', 'lint']);
  });

  it('truncates an attacker-supplied check name and caps how many arrive', () => {
    // Fork PRs are accepted continuously on public repos (MegaMek/megamek),
    // and these names reach the UI. They are inert text there, but they are
    // still bytes crossing a wire and into a React tree.
    const many = Array.from({ length: 40 }, (_, i) => ({ name: 'x'.repeat(500) + i, conclusion: 'FAILURE' }));
    const c = checksFor(row({ statusCheckRollup: many }));
    expect(c.checkNames).toHaveLength(10);
    expect(c.checkNames![0]!.length).toBeLessThanOrEqual(120);
  });

  it('is pending when anything is still running and nothing failed', () => {
    expect(checksFor(row({ statusCheckRollup: [
      { name: 'build', status: 'IN_PROGRESS' }, { name: 'lint', conclusion: 'SUCCESS' },
    ] })).checks).toBe('pending');
  });

  it('reports fail on a SINGLE failing check — a lone failure needs no second to be believed', () => {
    // Off-by-one guard: `failing.length > 0`, not `> 1`. The three-check
    // fixture above already has two failures and cannot see this boundary.
    expect(checksFor(row({ statusCheckRollup: [
      { name: 'build', conclusion: 'SUCCESS' }, { name: 'e2e', conclusion: 'FAILURE' },
    ] })).checks).toBe('fail');
  });
});

describe('phaseFor', () => {
  it('is merged, with mergedAt, when the bound row is merged', () => {
    const s = phaseFor(line({ rows: [row()] }));
    expect(s.phase).toBe('merged');
    expect(s.number).toBe(42);
    expect(s.mergedAt).toBe(Date.parse('2026-07-20T10:00:00Z'));
  });

  it('is no-commits when the branch has nothing past base', () => {
    expect(phaseFor(line({ ahead: 0, rows: [] })).phase).toBe('no-commits');
  });

  it('is none when there are commits and no bound PR', () => {
    expect(phaseFor(line({ ahead: 3, rows: [] })).phase).toBe('none');
  });

  it('is unknown — never merged — when gh says MERGED and a conjunct failed', () => {
    const s = phaseFor(line({ rows: [row({ mergeCommit: null })] }));
    expect(s.phase).toBe('unknown');
    // NOT `error`: that renders as "GitHub could not be read." about a read
    // that succeeded. Same token ccd writes, which Step 6 pins.
    expect(s.reason).toBe('merge-unproven');
  });

  it('distinguishes draft, open and closed', () => {
    expect(phaseFor(line({ rows: [row({ state: 'OPEN', mergedAt: null, mergeCommit: null, isDraft: true })] })).phase).toBe('draft');
    expect(phaseFor(line({ rows: [row({ state: 'OPEN', mergedAt: null, mergeCommit: null })] })).phase).toBe('open');
    expect(phaseFor(line({ rows: [row({ state: 'CLOSED', mergedAt: null, mergeCommit: null })] })).phase).toBe('closed');
  });

  it('carries ahead and checkedAt through', () => {
    const s = phaseFor(line({ ahead: 4 }));
    expect(s.ahead).toBe(4);
    expect(s.checkedAt).toBe(1785300000000);
  });

  it('is null, not -1, when gh omits the row\'s own number', () => {
    // Deviation 10's rule, extended: a missing `number` is UNMEASURED, and
    // `-1` would fabricate a value into a phase decision the wire treats as
    // real — the same token-forgery class this plan has closed repeatedly.
    const s = phaseFor(line({ rows: [row({ number: undefined })] }));
    expect(s.number).toBeNull();
  });
});

describe('prView keeps the last good value on a failed read', () => {
  const prev = { phase: 'merged' as const, number: 42, url: 'u', title: 't', checks: null,
    checkNames: null, ahead: 3, reason: null, checkedAt: 111, mergedAt: 5, retryAt: null };

  it('greys to unknown while keeping the number and the OLD checkedAt', () => {
    const v = prView({ phase: 'unknown', reason: 'timeout' }, null, prev);
    expect(v.pr.phase).toBe('unknown');
    expect(v.pr.reason).toBe('timeout');
    expect(v.pr.number).toBe(42);
    expect(v.pr.checkedAt).toBe(111);      // "last checked 6m ago", honestly
    expect(v.draft).toBeNull();
  });

  it('reports unchecked with no previous value at all', () => {
    expect(prView(null, null, null).pr).toEqual({
      phase: 'unchecked', number: null, url: null, title: null, checks: null, checkNames: null,
      ahead: 0, reason: null, checkedAt: null, mergedAt: null, retryAt: null,
    });
  });

  it('keeps the PREVIOUS value when the line is null and one exists — no read was attempted this tick', () => {
    // A null `line` means the sweep has nothing new for this session yet, not
    // that nothing was ever known. Losing `prev` here would flash a live
    // fleet card back to "unchecked" between sweeps.
    expect(prView(null, null, prev).pr).toEqual(prev);
  });

  it('greys a PER-SESSION failure exactly like a whole-repo one, and unknownView matches', () => {
    // The two failure shapes differ only in whose fault it was, which matters
    // to the sweep's backoff and not at all to one session's view.
    const perSession = prView({ id: 'demo-still-cove', phase: 'unknown', reason: 'error' }, null, prev);
    const wholeRepo = prView({ phase: 'unknown', reason: 'error' }, null, prev);
    expect(perSession).toEqual(wholeRepo);
    // And the route's inline branches must produce the SAME object as the
    // failure path — one shape for "we could not look", not three.
    expect(unknownView('error', prev)).toEqual(wholeRepo);
    // A complete PrState every time: never `{}`, never a null `pr`.
    expect(unknownView('unsupported').pr).toEqual({
      phase: 'unknown', number: null, url: null, title: null, checks: null, checkNames: null,
      ahead: 0, reason: 'unsupported', checkedAt: null, mergedAt: null, retryAt: null,
    });
  });

  it('defaults an UNSPECIFIED failure reason to error, not timeout', () => {
    // A lie in the UI about why we could not look is worse than a generic
    // "could not read GitHub" — `error` is the honest default, and `timeout`
    // would claim a specific cause that was never observed.
    expect(prView({ phase: 'unknown', reason: null }, null, null).pr.reason).toBe('error');
  });

  it('offers a draft ONLY in phase none', () => {
    expect(prView(line({ ahead: 1, rows: [] }), null, null).draft).not.toBeNull();
    expect(prView(line({ ahead: 0, rows: [] }), null, null).draft).toBeNull();
    expect(prView(line({ rows: [row()] }), null, null).draft).toBeNull();
  });

  it('carries the facts line the composer shows', () => {
    const v = prView(line({ ahead: 3, dirty: 2, rows: [] }), null, null);
    expect(v.facts).toEqual({ branch: 'ws/quiet-basin', baseShort: 'main', repo: 'o/r', commits: 3, dirty: 2 });
  });

  it('passes UNMEASURED through as null rather than coercing it to 0', () => {
    // Deviations 10 and 11. `?? 0` anywhere on this path is the whole thing
    // undone at the last hop: the composer would print "0 commits" for a branch
    // that never resolved and stay silent about a tree it never read.
    const v = prView(line({ ahead: null, tip: null, dirty: null, rows: [] }), null, null);
    expect(v.facts).toEqual({ branch: 'ws/quiet-basin', baseShort: 'main', repo: 'o/r', commits: null, dirty: null });
    // …while `PrState.ahead`, which the cap renders as a number, coerces — and
    // the PHASE is `none`, never `no-commits`, because nothing was counted.
    expect(v.pr.ahead).toBe(0);
    expect(v.pr.phase).toBe('none');
  });
});

describe('draftPr', () => {
  const tasks: TaskItem[] = [
    { id: '1', subject: 'Read the spec', activeForm: 'Reading', description: '', status: 'completed' },
    { id: '2', subject: 'Write the verb', activeForm: 'Writing', description: '', status: 'in_progress' },
  ];

  it('uses the single commit subject verbatim', () => {
    expect(draftPr(line(), null).title).toBe('the work');
  });

  it('uses the FIRST commit subject when there are several — later ones are fixups', () => {
    // ccd emits `git log base..branch`, which is newest-first, so "first" here
    // means oldest. Getting this backwards titles every multi-commit PR
    // "fix typo".
    const l = line({ commits: [
      { sha: 'c', subject: 'fix typo', body: '' },
      { sha: 'b', subject: 'add tests', body: '' },
      { sha: 'a', subject: 'add the pr-open verb', body: 'because the write must be bounded' },
    ] });
    expect(draftPr(l, null).title).toBe('add the pr-open verb');
  });

  it('skips fixup-shaped subjects when choosing the title', () => {
    const l = line({ commits: [
      { sha: 'b', subject: 'wip', body: '' },
      { sha: 'a', subject: 'fixup! add the verb', body: '' },
      { sha: 'z', subject: 'squash! more', body: '' },
    ] });
    // All fixup-shaped -> the de-slugified branch.
    expect(draftPr(l, null).title).toBe('quiet-basin');
  });

  it('falls back to the de-slugified branch with zero commits', () => {
    expect(draftPr(line({ commits: [] }), null).title).toBe('quiet-basin');
  });

  it('uses the repo TEMPLATE when there is one and does not override it', () => {
    const b = draftPr(line({ template: '## Why\n\n<!-- explain -->\n' }), tasks).body;
    expect(b.startsWith('## Why')).toBe(true);
    expect(b).toContain('## Plan');
  });

  it('uses the first commit body paragraph when there is no template', () => {
    const l = line({ commits: [
      { sha: 'b', subject: 'add tests', body: '' },
      { sha: 'a', subject: 'add the verb', body: 'because the write must be bounded\n\nmore detail' },
    ] });
    expect(draftPr(l, null).body).toContain('because the write must be bounded');
  });

  it('renders the session plan as checkboxes', () => {
    const b = draftPr(line(), tasks).body;
    expect(b).toContain('## Plan');
    expect(b).toContain('- [x] Read the spec');
    expect(b).toContain('- [ ] Write the verb');
  });

  it('omits the Plan section entirely when the session has no task list', () => {
    expect(draftPr(line(), null).body).not.toContain('## Plan');
  });

  it('lists the commits oldest-first with short shas', () => {
    const l = line({ commits: [
      { sha: 'bbbbbbbbbb', subject: 'add tests', body: '' },
      { sha: 'aaaaaaaaaa', subject: 'add the verb', body: '' },
    ] });
    const b = draftPr(l, null).body;
    expect(b).toContain('## Commits');
    expect(b.indexOf('aaaaaaa add the verb')).toBeLessThan(b.indexOf('bbbbbbb add tests'));
  });

  it('always ends with the ccrc trailer, and is never empty', () => {
    // An EMPTY --body suppresses the repo template, so ccd refuses one. This
    // is the guarantee that we never send one.
    const b = draftPr(line({ commits: [], template: null }), null).body;
    expect(b.trim().length).toBeGreaterThan(0);
    expect(b).toContain('Opened from ccrc workspace `demo-quiet-basin` (`ws/quiet-basin` → `main`).');
  });
});

// The draft body is what gets posted to GitHub on `pr-open`: every section
// boundary and fallback below is exact-matched, not merely `.toContain`ed,
// because a boundary a `.toContain` cannot see (a truncation, a blank leading
// paragraph, a missing trailing newline) is invisible right up until it ships
// in a real PR.
describe('draftPr composition — exact title and body', () => {
  it('composes an exact, fully-specified draft for a representative multi-commit line', () => {
    const l = line({
      commits: [
        { sha: 'bbbbbbbBBBB', subject: 'add tests', body: '' },
        { sha: 'aaaaaaaAAAA', subject: 'add the verb',
          body: 'because the write must be bounded\nacross two lines\n\nmore detail, a second paragraph' },
      ],
    });
    const tasks: TaskItem[] = [
      { id: '1', subject: 'Read the spec', activeForm: 'Reading', description: '', status: 'completed' },
      { id: '2', subject: 'Write the verb', activeForm: 'Writing', description: '', status: 'in_progress' },
    ];
    const { title, body } = draftPr(l, tasks);
    expect(title).toBe('add the verb');
    expect(body).toBe(
      // The first paragraph only — its OWN internal newline survives (M47:
      // splitting on a single `\n` instead of a blank line would cut this
      // after "bounded").
      'because the write must be bounded\nacross two lines\n\n'
      + '## Plan\n- [x] Read the spec\n- [ ] Write the verb\n\n'
      // Oldest-first, and SHORT shas (M51: a `slice(0, 40)` would print the
      // full `aaaaaaaAAAA...`/`bbbbbbbBBBB...` string here instead).
      + '## Commits\n- aaaaaaa add the verb\n- bbbbbbb add tests\n\n'
      + 'Opened from ccrc workspace `demo-quiet-basin` (`ws/quiet-basin` → `main`).\n', // trailing \n: M52
    );
  });

  it('titles a lone commit verbatim even when it is fixup-shaped — one commit speaks for the whole PR', () => {
    // M43: disabling the `commits.length === 1` branch falls through to the
    // fixup filter, which empties on a SOLITARY fixup-shaped commit and
    // mis-titles the PR from the de-slugified branch instead of the commit
    // that is, in this case, the entire PR.
    const l = line({ commits: [{ sha: 'f'.repeat(40), subject: 'fixup! oops', body: '' }] });
    expect(draftPr(l, null).title).toBe('fixup! oops');
  });

  it('never uses a blank template — falls through exactly as if there were none', () => {
    // M45: `line.template.trim()` is still what gets pushed even under the
    // mutant, so a whitespace-only template becomes an EMPTY leading
    // paragraph rather than being skipped outright.
    const l = line({ template: '   \n  ', commits: [] });
    expect(draftPr(l, null).body).toBe(
      'Opened from ccrc workspace `demo-quiet-basin` (`ws/quiet-basin` → `main`).\n',
    );
  });

  it('never uses an empty commit body as the opening paragraph', () => {
    // M46: same shape of bug as M45, on the commit-body fallback instead of
    // the template.
    const l = line({ commits: [{ sha: 'f'.repeat(40), subject: 'add the verb', body: '   ' }] });
    expect(draftPr(l, null).body).toBe(
      '## Commits\n- fffffff add the verb\n\n'
      + 'Opened from ccrc workspace `demo-quiet-basin` (`ws/quiet-basin` → `main`).\n',
    );
  });

  it('omits the Plan section for an EMPTY task list, same as for none', () => {
    // M48: `tasks !== null` alone is true for `[]` too, which would render a
    // bare "## Plan" heading with no items under it.
    expect(draftPr(line(), []).body).not.toContain('## Plan');
  });

  it('omits the Commits section entirely with zero commits, never a bare heading', () => {
    // M50: dropping `commits.length > 0` would render "## Commits" with
    // nothing under it.
    expect(draftPr(line({ commits: [] }), null).body).not.toContain('## Commits');
  });
});
