// Desktop polish Task C21 (D-8172; chat reading spec 2026-11-06 sections 4.1 and 4.2, row R15): a PR or commit name in chat opens
// the repository the message means, or stays text, never a wrong repository. The rule, first that applies wins:
//   1. `owner/repo#n` names its repository and links there in any session;
//   2. a bare `#n` or commit links where the SAME message names one repository for it (a pull, issue or commit address, or
//      `owner/repo#n`), and stays text where it names two;
//   3. otherwise a bare name links to the home repository only when the message names no other repository and the session
//      claims no open run whose project's repository is not the home one (an unnamed repository counts as not home);
//   4. the home repository, as before.
// Neutral names only: the home repository `org-a/project-a`, another `org-b/project-b`, a third `org-c/project-c`.
import { describe, expect, it } from 'vitest';
import type { ProjectRow, RunSummary } from '../../shared/api';
import { markRuns, type Mark } from '../src/lib/chatMarks';
import { claimsRunElsewhere, refHref, type ChatRefContext } from '../src/lib/chatRefs';
import { messageRepos, repoKey } from '../src/lib/chatRepoEvidence';

const HOME: ChatRefContext = {
  repo: 'org-a/project-a', project: 'project-a', branch: null, knownRuns: new Set(), knownItems: new Set(), runsElsewhere: false,
};
/** A coordinator whose open run works in another repository. */
const CROSS: ChatRefContext = { ...HOME, runsElsewhere: true };

/** Each PR and commit name of the message `text`, with the address the chat gives it (null: text), as the chat resolves it. */
function links(text: string, ctx: ChatRefContext): [string, string | null][] {
  const said = messageRepos(text);
  return markRuns(text).flatMap((r): [string, string | null][] => (
    r.kind === 'mark' && (r.mark.kind === 'pr' || r.mark.kind === 'commit')
      ? [[r.mark.text, refHref(r.mark, ctx, said)?.href ?? null]]
      : []));
}

const issue = (repo: string, n: number): string => `https://github.com/${repo}/issues/${n}`;

describe('a PR or commit opens the repository the message means (Task C21, D-8172)', () => {
  it('the screenshot case: a bare #666 beside an address of another repository\'s #666 opens that repository', () => {
    const text = '#666 (the complete reference) — OPEN — `github.com/org-b/project-b/pull/666`';
    expect(links(text, CROSS)).toEqual([['#666', issue('org-b/project-b', 666)]]);
    expect(links(text, HOME)).toEqual([['#666', issue('org-b/project-b', 666)]]);
  });

  it('the message\'s evidence is its whole text: a link target and a fenced block count too', () => {
    expect(links('See #42 [here](https://github.com/org-b/project-b/issues/42).', CROSS))
      .toEqual([['#42', issue('org-b/project-b', 42)]]);
    expect(links('Merged #42.\n\n```\ngh pr view https://github.com/org-b/project-b/pull/42\n```', CROSS))
      .toEqual([['#42', issue('org-b/project-b', 42)]]);
  });

  it('a bare #130 in a message that names another repository for other numbers stays text', () => {
    const text = '#130 is next; `github.com/org-b/project-b/pull/131` landed.';
    expect(links(text, CROSS)).toEqual([['#130', null]]);
    expect(links(text, HOME)).toEqual([['#130', null]]);
    expect(links('#130 waits on org-b/project-b#131.', HOME)).toEqual([['#130', null], ['org-b/project-b#131', issue('org-b/project-b', 131)]]);
  });

  it('a cross-repository coordinator\'s bare #512 with no evidence stays text', () => {
    expect(links('#512 is green.', CROSS)).toEqual([['#512', null]]);
    expect(links('Fixed in 4c677d328.', CROSS)).toEqual([['4c677d328', null]]);
  });

  it('owner/repo#n opens that repository in any session', () => {
    expect(links('org-b/project-b#12 merged.', CROSS)).toEqual([['org-b/project-b#12', issue('org-b/project-b', 12)]]);
    expect(links('org-b/project-b#12 merged.', HOME)).toEqual([['org-b/project-b#12', issue('org-b/project-b', 12)]]);
    expect(links('org-b/project-b#12 merged.', { ...HOME, repo: null })).toEqual([['org-b/project-b#12', issue('org-b/project-b', 12)]]);
  });

  it('a qualified name also tells the message\'s bare #n for the same number', () => {
    expect(links('org-b/project-b#12 merged; #12 closes it.', CROSS))
      .toEqual([['org-b/project-b#12', issue('org-b/project-b', 12)], ['#12', issue('org-b/project-b', 12)]]);
  });

  it('two repositories named for one number leave the bare #n as text', () => {
    const text = '#7: github.com/org-b/project-b/pull/7 and github.com/org-c/project-c/issues/7';
    expect(links(text, CROSS)).toEqual([['#7', null]]);
    expect(links(text, HOME)).toEqual([['#7', null]]);
    expect(links('#7: org-a/project-a#7 and github.com/org-b/project-b/pull/7', HOME))
      .toEqual([['#7', null], ['org-a/project-a#7', issue('org-a/project-a', 7)]]);
  });

  it('one repository named twice for the same number, in two spellings and cases, is still one', () => {
    expect(links('#7: github.com/Org-B/Project-B/pull/7, org-b/project-b#7', CROSS)[0]).toEqual(['#7', issue('Org-B/Project-B', 7)]);
  });

  it('a single-repository session\'s plain #123 opens the home repository, as before', () => {
    expect(links('Merged #123.', HOME)).toEqual([['#123', issue('org-a/project-a', 123)]]);
    expect(links('#123 is in; https://github.com/org-a/project-a/pull/124 next.', HOME))
      .toEqual([['#123', issue('org-a/project-a', 123)]]);
    expect(links('Merged #123.', { ...HOME, repo: 'Org-A/Project-A.git' })).toEqual([['#123', issue('Org-A/Project-A', 123)]]);
  });

  it('a commit with a commit address of another repository opens that repository', () => {
    const text = 'Fixed in 4c677d328 (github.com/org-b/project-b/commit/4c677d3281a2b3c4).';
    expect(links(text, CROSS)).toEqual([['4c677d328', 'https://github.com/org-b/project-b/commit/4c677d328']]);
    // Either side may be the shorter: the address may carry the short SHA and the prose the long one.
    expect(links('Fixed in 4c677d3281a2b3c4; see github.com/org-b/project-b/commit/4c677d328.', HOME)[0])
      .toEqual(['4c677d3281a2b3c4', 'https://github.com/org-b/project-b/commit/4c677d3281a2b3c4']);
  });

  it('a commit no address names, in a message that names another repository, stays text', () => {
    expect(links('Fixed in 4c677d328; see github.com/org-b/project-b/commit/abcdef1234.', HOME)).toEqual([['4c677d328', null]]);
  });

  it('a commit named by two repositories stays text', () => {
    const text = '4c677d328: github.com/org-b/project-b/commit/4c677d328 and github.com/org-c/project-c/commit/4c677d328';
    expect(links(text, HOME)).toEqual([['4c677d328', null]]);
  });

  it('a repository the console\'s grammar refuses links nowhere, and leaves the bare name beside it as text', () => {
    expect(links('--org-b/project-b#12 merged', HOME)).toEqual([['--org-b/project-b#12', null]]);
    // An unreadable qualified name is an unknown repository for its number: the bare #12 beside it stays text (review 1758 F1).
    expect(links('--org-b/project-b#12 and #12', HOME)).toEqual([['--org-b/project-b#12', null], ['#12', null]]);
    const said = messageRepos('a/..#5');
    const mark: Mark = { kind: 'pr', id: '5', text: 'a/..#5', repo: 'a/..' };
    expect(refHref(mark, HOME, said)).toBeNull();
  });
});

// Fix round 1 (review 1758): where the code cannot tell, the answer is text.
describe('fix round 1: the evidence reader\'s edges (Task C21, review 1758)', () => {
  it('F1: a GitHub address in any case is read, and one the grammar refuses is an unknown repository', () => {
    const rows: [string, string | null][] = [
      ['#12 GitHub.com/o/r', null],
      ['#12 GITHUB.COM/O/R/pull/12', issue('O/R', 12)],
      ['#12 https://Github.com/o/r/pull/12', issue('o/r', 12)],
      ['#12 github.com/o_o/r/pull/12', null],
      ['#12 github.com/o/-r/pull/12', null],
      ['#3 github.com/o/repo.git.git/pull/3', null],
      // An unknown repository with no number still names a repository other than home (rule 3a).
      ['#12 github.com/o_o/r', null],
      // A host that only ends in github.com is no GitHub address.
      ['#12 my-github.com/org-b/project-b/pull/12', issue('org-a/project-a', 12)],
      ['#12 x.github.com/org-b/project-b/pull/12', issue('org-a/project-a', 12)],
    ];
    for (const [text, href] of rows) expect(links(text, HOME), text).toEqual([[text.split(' ')[0], href]]);
  });

  it('F2: the SSH form, the API, raw and archive hosts and gh --repo name a repository; an API page and a gh pr command are evidence', () => {
    const rows: [string, string | null][] = [
      ['#12 git@github.com:o/r.git', null],
      ['#12 api.github.com/repos/o/r/pulls/12', issue('o/r', 12)],
      ['#12 api.github.com/repos/o/r', null],
      ['#12 raw.githubusercontent.com/o/r/main/x', null],
      ['#12 codeload.github.com/o/r/tar.gz/main', null],
      ['#12 gh pr view 12 --repo o/r', issue('o/r', 12)],
      ['#12 gh pr view 12 -R o/r', issue('o/r', 12)],
      ['#12 gh issue view 12 --repo=o/r', issue('o/r', 12)],
      ['#13 gh pr view 12 --repo o/r', null],
      ['#12 gh pr list --repo o/r', null],
      ['#12 gh pr view 12 --repo "o/r"', issue('o/r', 12)],
      ['#12 in o/r', issue('org-a/project-a', 12)],
    ];
    for (const [text, href] of rows) expect(links(text, HOME), text).toEqual([[text.split(' ')[0], href]]);
  });

  it('F2: a gh command\'s repository flag stops at its command\'s end', () => {
    expect(links('#12: gh pr view 12; echo --repo o/r', HOME)).toEqual([['#12', issue('org-a/project-a', 12)]]);
  });

  // F3: the review's lists, each row resolved in a home-only session. A qualified name follows GitHub's own notation without
  // checking that the repository exists, so a prose pair can still link (R15); a path, a digit or one-character pair, an
  // upper-case pair and a file extension do not.
  it('F3: which slash pairs before #n are qualified names', () => {
    const link: [string, string][] = [
      ['src/thing#12', issue('src/thing', 12)],
      ['and/or#3', issue('and/or', 3)],
      ['client/server#1', issue('client/server', 1)],
      ['pwa/test#12', issue('pwa/test', 12)],
      ['server/src#12', issue('server/src', 12)],
      ['foo-bar/baz.qux#9', issue('foo-bar/baz.qux', 9)],
    ];
    for (const [text, href] of link) expect(links(text, HOME), text).toEqual([[text, href]]);
    const text = [
      'TCP/IP#4', '1/2#3', '24/7#1', 'I/O#5', 'N/A#1', 'src/lib/x.ts#12', 'config/app.yml#3', 'notes/a.md#2', 'v1.0/x#2',
      'docs/foo.md#12', 'https://example.com/a/b#12', './a/b#12', '~/a/b#12', 'a_b/c#3', 'x/a/b#1', 'a/b#12abc',
    ];
    for (const t of text) expect(links(t, HOME).filter(([, href]) => href !== null), t).toEqual([]);
    // A one-character repository is no qualified name, so a SHA before a slash reads as the commit it was on main.
    expect(links('abc1234/x#5', HOME)).toEqual([['abc1234', 'https://github.com/org-a/project-a/commit/abc1234']]);
  });

  it('F3: the evidence reader refuses what the grammar refuses', () => {
    expect(links('config/app.yml#3 then #3', HOME)).toEqual([['#3', issue('org-a/project-a', 3)]]);
    expect(links('see docs/plan.md#12 and #5', HOME)).toEqual([['#5', issue('org-a/project-a', 5)]]);
  });

  it('F4: both readers trim a qualified name\'s trailing dots the same way', () => {
    expect(links('#3 org-b/project-b..#3', HOME))
      .toEqual([['#3', issue('org-b/project-b', 3)], ['org-b/project-b..#3', issue('org-b/project-b', 3)]]);
    expect(links('org-b/project-b.#12', HOME)).toEqual([['org-b/project-b.#12', issue('org-b/project-b', 12)]]);
  });

  it('F6: only a name is evidence: a qualified name or a page number the boundary does not end counts for nothing', () => {
    expect(links('owner-b/repo-b#12x then #12', HOME)).toEqual([['#12', issue('org-a/project-a', 12)]]);
    expect(links('\u00e9owner-b/repo-b#12 then #12', HOME)).toEqual([['#12', issue('org-a/project-a', 12)]]);
    // A host the name boundary does not start (a letter before it) is no address at all.
    expect(links('#12 \u00e9github.com/o/r/pull/12', HOME)).toEqual([['#12', issue('org-a/project-a', 12)]]);
    // The page still names its repository, so the bare #12 beside it is text under rule 3a.
    expect(links('github.com/owner-b/repo-b/pull/12x and #12', HOME)).toEqual([['#12', null]]);
  });

  it('F9: a www. address is evidence', () => {
    expect(links('Merged #7, see https://www.github.com/org-b/project-b/pull/7', HOME)).toEqual([['#7', issue('org-b/project-b', 7)]]);
  });

  // F5: generous budgets, so load cannot flake them; a quadratic trim or a scan of every address per commit name takes seconds.
  it('F5: the reader is linear on a long dot run and over 1 MiB of addresses', () => {
    let t = performance.now();
    messageRepos(`github.com/o/${'.'.repeat(400_000)}x and github.com/o/r${'.'.repeat(400_000)}`);
    expect(performance.now() - t).toBeLessThan(2000);
    const line = 'see https://github.com/org-b/project-b/pull/123 and org-c/project-c#45, ';
    const mib = line.repeat(Math.ceil((1 << 20) / line.length));
    t = performance.now();
    const said = messageRepos(mib);
    expect(performance.now() - t).toBeLessThan(3000);
    expect([...said.named].sort()).toEqual(['org-b/project-b', 'org-c/project-c']);
  });

  it('F5: a commit name asks only the addresses that share its prefix', () => {
    const shas = Array.from({ length: 20_000 }, (_, i) => (0x1000000 + i).toString(16) + 'abc');
    const said = messageRepos(shas.map((sha) => `github.com/org-b/project-b/commit/${sha}`).join('\n'));
    const t = performance.now();
    for (const sha of shas) expect(refHref({ kind: 'commit', id: sha, text: sha }, HOME, said)?.href).toContain('/org-b/project-b/');
    expect(performance.now() - t).toBeLessThan(3000);
  });
});

describe('messageRepos reads what one message says about repositories (Task C21)', () => {
  it('collects every repository the message names, by key', () => {
    const said = messageRepos('see https://github.com/org-b/project-b, org-c/project-c#3 and github.com/org-a/project-a/pull/9.');
    expect([...said.named].sort()).toEqual(['org-a/project-a', 'org-b/project-b', 'org-c/project-c']);
  });

  it('a sentence\'s full stop or a .git is not part of a repository', () => {
    expect([...messageRepos('Cloned github.com/org-b/project-b.').named]).toEqual(['org-b/project-b']);
    expect([...messageRepos('Cloned https://github.com/org-b/project-b.git now').named]).toEqual(['org-b/project-b']);
  });

  it('a host that only ends in github.com, or a path that only contains owner/repo#n, names nothing', () => {
    expect([...messageRepos('notgithub.com/org-b/project-b/pull/1').named]).toEqual([]);
    expect([...messageRepos('x/org-b/project-b#1').named]).toEqual([]);
  });

  it('repoKey reads a slug with the console\'s one grammar, in lower case', () => {
    expect(repoKey('Org-A/Project-A.git')).toBe('org-a/project-a');
    expect(repoKey('https://github.com/org-a/project-a')).toBe('org-a/project-a');
    expect(repoKey('org-a')).toBeNull();
  });
});

describe('the qualified name in the grammar (Task C21)', () => {
  const marks = (text: string): Mark[] => markRuns(text).flatMap((r) => (r.kind === 'mark' ? [r.mark] : []));

  it('owner/repo#n is one PR name carrying its repository', () => {
    expect(marks('see org-b/project-b#12 now')).toStrictEqual([
      { kind: 'pr', id: '12', text: 'org-b/project-b#12', repo: 'org-b/project-b' },
    ]);
  });

  it('a bare #n carries no repository', () => {
    expect(marks('see #12 now')).toStrictEqual([{ kind: 'pr', id: '12', text: '#12' }]);
  });

  it('after a path, a host or a word it is no name, and it ends at a word end', () => {
    expect(marks('x/org-b/project-b#12')).toEqual([]);
    expect(marks('github.com/org-b/project-b#12')).toEqual([]);
    expect(marks('org-b/project-b#12abc')).toEqual([]);
    expect(marks('a-org-b/project-b#12')[0]!.repo).toBe('a-org-b/project-b');
  });

  it('a document path and a commit before a slash read as before', () => {
    expect(marks('docs/superpowers/plans/p.md#12')).toStrictEqual([
      { kind: 'doc', id: 'docs/superpowers/plans/p.md', text: 'docs/superpowers/plans/p.md' },
    ]);
    expect(marks('4c677d328/x')).toStrictEqual([{ kind: 'commit', id: '4c677d328', text: '4c677d328' }]);
  });

  it('its own words are no negator and it takes a status label', () => {
    expect(markRuns('no-op/no#5 merged')).toEqual([
      { kind: 'mark', mark: { kind: 'pr', id: '5', text: 'no-op/no#5', repo: 'no-op/no' } },
      { kind: 'text', text: ' ' },
      { kind: 'status', text: 'merged', tone: 'merged' },
    ]);
  });
});

describe('claimsRunElsewhere: does this session coordinate work in another repository (Task C21, rule 3b)', () => {
  const run = (over: Partial<RunSummary>): RunSummary => ({ claimedBy: 'sess-a', project: 'project-a', state: 'working', ...over }) as RunSummary;
  const project = (name: string, slug: string | null): ProjectRow => ({
    name, workdir: `/w/${name}`, repo: slug === null ? { state: 'absent' } : { state: 'named', slug },
  });
  const projects = [project('project-a', 'org-a/project-a'), project('project-b', 'org-b/project-b'), project('project-x', null)];

  it('no run, or only runs in the home repository: no', () => {
    expect(claimsRunElsewhere('sess-a', 'org-a/project-a', [], projects)).toBe(false);
    expect(claimsRunElsewhere('sess-a', 'org-a/project-a', [run({})], projects)).toBe(false);
    expect(claimsRunElsewhere('sess-a', 'Org-A/Project-A.git', [run({})], projects)).toBe(false);
  });

  it('an open run of its own in another repository: yes', () => {
    expect(claimsRunElsewhere('sess-a', 'org-a/project-a', [run({}), run({ project: 'project-b' })], projects)).toBe(true);
  });

  it('a run whose project has no named repository makes it cross-repository', () => {
    expect(claimsRunElsewhere('sess-a', 'org-a/project-a', [run({ project: 'project-x' })], projects)).toBe(true);
    expect(claimsRunElsewhere('sess-a', 'org-a/project-a', [run({ project: 'project-unknown' })], projects)).toBe(true);
    expect(claimsRunElsewhere('sess-a', 'org-a/project-a', [run({})], null)).toBe(true);
    // With no home repository, no claimed open run can be shown to be home.
    expect(claimsRunElsewhere('sess-a', null, [run({ project: 'project-x' })], projects)).toBe(true);
    expect(claimsRunElsewhere('sess-a', null, [run({})], projects)).toBe(true);
  });

  it('a closed run, or another session\'s, does not count', () => {
    expect(claimsRunElsewhere('sess-a', 'org-a/project-a', [run({ project: 'project-b', state: 'done' })], projects)).toBe(false);
    expect(claimsRunElsewhere('sess-a', 'org-a/project-a', [run({ project: 'project-b', state: 'failed' })], projects)).toBe(false);
    expect(claimsRunElsewhere('sess-a', 'org-a/project-a', [run({ project: 'project-b', claimedBy: 'sess-b' })], projects)).toBe(false);
  });
});
