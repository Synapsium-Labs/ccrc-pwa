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

  it('a repository the console\'s grammar refuses links nowhere, and tells no bare name', () => {
    expect(links('--org-b/project-b#12 merged', HOME)).toEqual([['--org-b/project-b#12', null]]);
    expect(links('-x/y#12 and #12', HOME)).toEqual([['-x/y#12', null], ['#12', issue('org-a/project-a', 12)]]);
    const said = messageRepos('a/..#5');
    const mark: Mark = { kind: 'pr', id: '5', text: 'a/..#5', repo: 'a/..' };
    expect(refHref(mark, HOME, said)).toBeNull();
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
  });

  it('a closed run, or another session\'s, does not count', () => {
    expect(claimsRunElsewhere('sess-a', 'org-a/project-a', [run({ project: 'project-b', state: 'done' })], projects)).toBe(false);
    expect(claimsRunElsewhere('sess-a', 'org-a/project-a', [run({ project: 'project-b', state: 'failed' })], projects)).toBe(false);
    expect(claimsRunElsewhere('sess-a', 'org-a/project-a', [run({ project: 'project-b', claimedBy: 'sess-b' })], projects)).toBe(false);
  });
});
