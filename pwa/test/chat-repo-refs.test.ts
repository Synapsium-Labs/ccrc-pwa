// Desktop polish Task C21 (D-8172; chat reading spec 2026-11-06 sections 4.1 and 4.2, row R15): a PR or commit name in chat opens
// the repository the message means, or stays text; where the code cannot tell, text. The rule, first that applies wins:
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

// Review 1760 F10: budgets measured against their mutants (c21.md): each bound is about 20 to 90 times the real code's time and 10
// to 26 times below its mutant's.
const COMMIT_N = 20_000;
const COMMIT_BOUND_MS = 500;
const REPEAT_N = 20_000;
const REPEAT_BOUND_MS = 500;
const NAMED_BOUND_MS = 600;
// Task C20 (review 1762 F5 and F3): measured against their mutants in c20.md.
const SHARED_PREFIX_N = 12_000;
const SHARED_PREFIX_BOUND_MS = 500;
const GH_QUOTES_BOUND_MS = 1500;

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
    // A one-character repository is refused, so `abc1234/x#5` is a qualified name the chat cannot tell: text (review 1760 F7).
    expect(links('abc1234/x#5', HOME)).toEqual([['abc1234/x#5', null]]);
    // Review 1760 F3: the widened list of file extensions.
    for (const t of [
      'cmd/main.go#12', 'src/lib.rs#3', 'include/foo.h#2', 'app/main.c#7', 'etc/nginx.conf#4', 'src/App.vue#5', 'lib/util.rb#6',
      'pkg/Main.java#7', 'public/logo.svg#2', 'docs/spec.pdf#3', 'styles/app.scss#9', 'cfg/app.ini#1', 'src/x.cpp#2',
    ]) expect(links(t, HOME), t).toEqual([[t, null]]);
  });

  // Review 1760 F2 (a): a qualified name the exceptions refuse is an UNKNOWN repository, so its bare sibling is text too.
  it('F3: a refused qualified name is an unknown repository, and its bare sibling stays text', () => {
    expect(links('config/app.yml#3 then #3', HOME)).toEqual([['config/app.yml#3', null], ['#3', null]]);
    expect(links('app/models.rb#7 then #7', HOME)).toEqual([['app/models.rb#7', null], ['#7', null]]);
    expect(links('vercel/next.js#123 is fixed; see #123', HOME)).toEqual([['vercel/next.js#123', null], ['#123', null]]);
    expect(links('see vercel/next.js#123 and also #7', HOME)).toEqual([['vercel/next.js#123', null], ['#7', null]]);
    expect(links('vercel/nextjs#123 is fixed; see #123', HOME))
      .toEqual([['vercel/nextjs#123', issue('vercel/nextjs', 123)], ['#123', issue('vercel/nextjs', 123)]]);
    // A document path is a document, not a refused repository: the bare #5 beside it still opens home.
    expect(links('see docs/plan.md#12 and #5', HOME)).toEqual([['#5', issue('org-a/project-a', 5)]]);
  });

  // Review 1760 F7: one reader decides, after its trim of trailing dots and `.git`.
  it('F3: the exceptions are asked of the repository readRepo read', () => {
    for (const t of ['config/app.yml.#3', 'notes/a.md.#2', 'ow/repo.ts.git#3', 'vercel/next.js.#1']) {
      expect(links(t, HOME), t).toEqual([[t, null]]);
    }
  });

  it('F4: both readers trim a qualified name\'s trailing dots the same way', () => {
    expect(links('#3 org-b/project-b..#3', HOME))
      .toEqual([['#3', issue('org-b/project-b', 3)], ['org-b/project-b..#3', issue('org-b/project-b', 3)]]);
    expect(links('org-b/project-b.#12', HOME)).toEqual([['org-b/project-b.#12', issue('org-b/project-b', 12)]]);
  });

  it('F6: only a name is evidence: a qualified name or a page number the boundary does not end counts for nothing', () => {
    expect(links('owner-b/repo-b#12x then #12', HOME)).toEqual([['#12', issue('org-a/project-a', 12)]]);
    expect(links('\u00e9owner-b/repo-b#12 then #12', HOME)).toEqual([['#12', issue('org-a/project-a', 12)]]);
    // A host the name boundary does not start (a letter or `_` before it) names an unknown repository: text (review 1760 F5).
    expect(links('#12 \u00e9github.com/o/r/pull/12', HOME)).toEqual([['#12', null]]);
    expect(links('\u4fee\u590d\u89c1github.com/owner-b/repo-b/pull/12 \u3002 #12 \u5df2\u5408\u5e76', HOME)).toEqual([['#12', null]]);
    expect(links('\u89c1api.github.com/repos/owner-b/repo-b/pulls/12 #12', HOME)).toEqual([['#12', null]]);
    expect(links('_github.com/owner-b/repo-b/pull/12_ #12', HOME)).toEqual([['#12', null]]);
    // With a scheme in front, the same address is read.
    expect(links('\u4fee\u590d\u89c1https://github.com/owner-b/repo-b/pull/12 \u3002 #12', HOME)).toEqual([['#12', issue('owner-b/repo-b', 12)]]);
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

  // Review 1760 F10: the bound sits between the real code and a scan of every address, with room on both sides (c21.md has the
  // measured margin).
  it('F5: a commit name asks only the addresses that share its prefix', () => {
    const shas = Array.from({ length: COMMIT_N }, (_, i) => (0x1000000 + i).toString(16) + 'abc');
    const said = messageRepos(shas.map((sha) => `github.com/org-b/project-b/commit/${sha}`).join('\n'));
    const t = performance.now();
    const hrefs = shas.map((sha) => refHref({ kind: 'commit', id: sha, text: sha }, HOME, said)?.href ?? '');
    const took = performance.now() - t;
    expect(hrefs.every((h) => h.includes('/org-b/project-b/'))).toBe(true);
    expect(took).toBeLessThan(COMMIT_BOUND_MS);
  });

  // Review 1760 F9: the same commit address many times is one address.
  it('F5: one commit address repeated many times costs one', () => {
    const sha = 'abcdef1234';
    const said = messageRepos(`github.com/org-b/project-b/commit/${sha} ${sha}\n`.repeat(REPEAT_N));
    const t = performance.now();
    for (let i = 0; i < REPEAT_N; i += 1) refHref({ kind: 'commit', id: sha, text: sha }, HOME, said);
    const took = performance.now() - t;
    expect(took).toBeLessThan(REPEAT_BOUND_MS);
  });

  // Review 1760 F8: "names another repository" costs the same for every bare name in a message.
  it('F5: many repositories and many bare names in one message stay cheap', () => {
    const repos = Array.from({ length: 20_000 }, (_, i) => `github.com/org-b/project-${i}`).join(' ');
    const said = messageRepos(repos);
    const mark: Mark = { kind: 'pr', id: '1', text: '#1' };
    const t = performance.now();
    for (let i = 0; i < 120_000; i += 1) refHref(mark, HOME, said);
    const took = performance.now() - t;
    expect(took).toBeLessThan(NAMED_BOUND_MS);
  });
});

// Fix round 2 (review 1760): the gh reader, emphasis, and what is not read.
describe('fix round 2: gh commands, emphasis and the unread spellings (Task C21, review 1760)', () => {
  const home = (n: number): string => issue('org-a/project-a', n);

  it('F1: a gh flag reaches only its own command\'s number, and a command ends where the ruling says', () => {
    const rows: [string, [string, string | null][]][] = [
      ['Ran gh pr view 12, then gh pr view 40 --repo owner-b/repo-b. #12 is green', [['#12', null]]],
      ["Ran `gh pr view 12` and `gh pr view 40 -R 'owner-b/repo-b'`; #12 is green.", [['#12', null]]],
      ['gh pr view 12 then cp -R owner-b/repo-b /x; #12', [['#12', home(12)]]],
      ['gh pr view 12, then grep -R src/lib . and #12 is fine', [['#12', home(12)]]],
      ['gh pr comment 12 --body "see -R owner-c/repo-c" --repo owner-b/repo-b and #12', [['#12', issue('owner-b/repo-b', 12)]]],
      ['gh pr view 12 --repo owner-b/repo-b and gh pr view 12 --repo owner-c/repo-c #12', [['#12', null]]],
      ['gh pr view 12 -R owner-b/repo-b -R owner-c/repo-c #12', [['#12', issue('owner-c/repo-c', 12)]]],
      // The number is the command's third positional, wherever its flags stand.
      ['gh pr view --repo owner-b/repo-b 12 and #12', [['#12', issue('owner-b/repo-b', 12)]]],
      // A quoted flag value is a value; a word that is exactly a quoted flag is that flag, as the shell passes it.
      ['gh issue view 12 -R "owner-b/repo-b" and #12', [['#12', issue('owner-b/repo-b', 12)]]],
      ["gh issue view 12 '-R' owner-b/repo-b and #12", [['#12', issue('owner-b/repo-b', 12)]]],
      // A quoted gh is an argument, not the next command.
      ['gh pr comment 12 --body "gh" --repo owner-b/repo-b and #12', [['#12', issue('owner-b/repo-b', 12)]]],
      // A comma or a full stop before a space ends the command, before any positional bound would.
      ['I ran gh pr list, --repo owner-b/repo-b next, then #12', [['#12', home(12)]]],
      ['I ran gh pr list. --repo owner-b/repo-b is next for #12', [['#12', home(12)]]],
    ];
    for (const [text, expected] of rows) expect(links(text, HOME), text).toEqual(expected);
  });

  it('F6: gh api paths are evidence, GH_REPO names a repository, and the gh word starts at the name boundary', () => {
    const rows: [string, [string, string | null][]][] = [
      ['gh api repos/owner-b/repo-b/pulls/12 and #12', [['#12', issue('owner-b/repo-b', 12)]]],
      ['gh api /repos/owner-b/repo-b/issues/12/comments and #12', [['#12', issue('owner-b/repo-b', 12)]]],
      ['gh api repos/owner-b/repo-b and #12', [['#12', null]]],
      ['GH_REPO=owner-b/repo-b gh pr view 12 and #12', [['#12', null]]],
      ['\u00e9gh pr view 12 --repo owner-b/repo-b and #12', [['#12', home(12)]]],
      ['sigh pr view 12 --repo owner-b/repo-b and #12', [['#12', home(12)]]],
    ];
    for (const [text, expected] of rows) expect(links(text, HOME), text).toEqual(expected);
  });

  // Not read, by the ruling (R15 lists them): each leaves the bare #12 where main left it.
  it('F6: the spellings that are not read', () => {
    for (const text of [
      'gh pr view 12 -Rowner-b/repo-b and #12', 'gh repo clone owner-b/repo-b and #12', '#12 in owner-b/repo-b',
      'In owner-b/repo-b, #12 is green', 'gitlab.com/owner-b/repo-b/-/merge_requests/12 #12',
      'gh pr view 12 \\\n  --repo owner-b/repo-b and #12',
    ]) expect(links(text, HOME).filter(([t]) => t === '#12'), text).toEqual([['#12', home(12)]]);
  });

  it('F4: in raw text a qualified name under _ is no name, under * it is (the render half is in chat-links)', () => {
    expect(links('_owner-b/repo-b#12_ then #12', HOME)).toEqual([['#12', home(12)]]);
    expect(links('__owner-b/repo-b#12__ then #12', HOME)).toEqual([['#12', home(12)]]);
    expect(links('*owner-b/repo-b#12* then #12', HOME))
      .toEqual([['owner-b/repo-b#12', issue('owner-b/repo-b', 12)], ['#12', issue('owner-b/repo-b', 12)]]);
  });
});

// Task C20 (D-8187): reviews 1762 and 1766 on the evidence reader. Every reproduction in either report is a row.
describe('Task C20: the gh reader, reserved pages and the commit index (reviews 1762 and 1766)', () => {
  const home = (n: number): string => issue('org-a/project-a', n);
  const rows = (table: [string, [string, string | null][]][]): void => {
    for (const [text, expected] of table) expect(links(text, HOME), text).toEqual(expected);
  };

  // Review 1766 F2 and F5: the flags gh 2.103.3's own help lists with no value type (c20.md), as this test's own copy, so a
  // flag dropped from the reader's list reds its row.
  const BOOLEANS_API = ['--allow-escape-sequences', '--include', '-i', '--paginate', '--silent', '--slurp', '--verbose'];
  const BOOLEANS_OTHER = [
    '--admin', '--allow-escape-sequences', '--approve', '--auto', '--comments', '--conflict-status', '--create-if-none',
    '--delete-branch', '-d', '--delete-last', '--detach', '--disable-auto', '--draft', '--dry-run', '--edit-last', '--editor',
    '--fail-fast', '--fill', '--fill-first', '--fill-verbose', '--force', '-f', '--merge', '--name-only',
    '--no-maintainer-edit', '--patch', '--rebase', '--recurse-submodules', '--remove-milestone', '--remove-parent',
    '--remove-type', '--request-changes', '--required', '--squash', '--undo', '--watch', '--web', '-w', '--yes',
  ];

  it('F1 (review 1762): review 1762\'s reproductions, and a word starting with # ends the command (review 1766 F7)', () => {
    rows([
      ['gh pr merge --squash 40 -R owner-b/repo-b #12 is next', [['#12', null]]],
      ['gh pr view --web 40 -R owner-b/repo-b #12 merged', [['#12', null]]],
      ['gh pr list -R owner-b/repo-b #12 is ours and merged', [['#12', null]]],
      ['gh pr create --repo owner-b/repo-b #12 was home', [['#12', null]]],
      // The known give-up of the old direction: --squash is a boolean, so 40 is the command's own number.
      ['gh pr merge --squash 40 -R owner-b/repo-b and #40', [['#40', issue('owner-b/repo-b', 40)]]],
      ['gh issue close --reason completed 12 -R owner-b/repo-b and #12', [['#12', issue('owner-b/repo-b', 12)]]],
      ['gh pr list --limit 12 -R owner-b/repo-b and #12', [['#12', null]]],
      ['gh pr view 12 -R owner-b/repo-b #12', [['#12', issue('owner-b/repo-b', 12)]]],
      // A flag written with `=` holds its own value, so the next word is the command's own.
      ['gh pr view --repo=owner-b/repo-b 12 and #12', [['#12', issue('owner-b/repo-b', 12)]]],
      // gh api has two positionals: the word after its path is prose, so a later flag is not read.
      ['gh api user then -R owner-b/repo-b and #12', [['#12', home(12)]]],
      // A quoted '#12' reaches gh as its number, as the shell passes it.
      ["gh pr view '#12' -R owner-b/repo-b and #12", [['#12', issue('owner-b/repo-b', 12)], ['#12', issue('owner-b/repo-b', 12)]]],
      // An unquoted #-word is a shell comment: the command ends there, and what follows it is not read.
      ['`gh pr list -R owner-b/repo-b # 12 open`; #12 is ours', [['#12', null]]],
      ['gh pr view #12 40 -R owner-b/repo-b; #40', [['#12', home(12)], ['#40', home(40)]]],
    ]);
  });

  it('F2 (review 1762): a boolean flag before a gh api path leaves the path read', () => {
    rows([
      ['gh api --paginate repos/owner-b/repo-b/pulls/12/comments and #12', [['#12', issue('owner-b/repo-b', 12)]]],
      ['gh api --paginate /repos/owner-b/repo-b/issues/12 #12', [['#12', issue('owner-b/repo-b', 12)]]],
      ['gh api -i repos/owner-b/repo-b/pulls/12 #12', [['#12', issue('owner-b/repo-b', 12)]]],
      ['`gh api --paginate repos/owner-b/repo-b/pulls/12/comments` and #12 has 3 comments', [['#12', issue('owner-b/repo-b', 12)]]],
      ['```\ngh api --paginate repos/owner-b/repo-b/pulls/12/comments\n```\nand #12 has 3 comments', [['#12', issue('owner-b/repo-b', 12)]]],
      // The controls: a flag that takes a value, and no flag.
      ['gh api -X GET repos/owner-b/repo-b/pulls/12 and #12', [['#12', issue('owner-b/repo-b', 12)]]],
      ["gh api -H 'Accept: x' repos/owner-b/repo-b/pulls/12 and #12", [['#12', issue('owner-b/repo-b', 12)]]],
    ]);
  });

  it('F2 (review 1766): a flag gh has with a value keeps the repository named after it', () => {
    const b = (n: number): string => issue('owner-b/repo-b', n);
    rows([
      ['`gh pr comment 123 --body-file f.md --repo owner-b/repo-b`: #123', [['#123', b(123)]]],
      ['```\ngh pr comment 123 --body-file f.md --repo owner-b/repo-b\n```\nPosted on #123.', [['#123', b(123)]]],
      ['gh pr edit 40 --add-label ready --repo owner-b/repo-b and #40', [['#40', b(40)]]],
      ['gh pr checks 40 --watch --interval 30 --repo owner-b/repo-b. #40 is green.', [['#40', b(40)]]],
      ['gh pr merge 40 --squash --subject "fix: x" -R owner-b/repo-b and #40', [['#40', b(40)]]],
      ['gh pr diff 40 --color never -R owner-b/repo-b #40', [['#40', b(40)]]],
      ['gh pr edit 40 --milestone v2 -R owner-b/repo-b and #40', [['#40', b(40)]]],
      ['gh issue close 12 -r completed -R owner-b/repo-b and #12', [['#12', b(12)]]],
      ['gh api --cache 1h repos/owner-b/repo-b/pulls/12 and #12', [['#12', b(12)]]],
      ['gh pr merge 40 --match-head-commit abc1234 -R owner-b/repo-b and #40', [['abc1234', null], ['#40', b(40)]]],
      // A digit value is the flag's, never the command's number.
      ['`gh issue list --milestone 3 --repo owner-b/repo-b`; #3 is ours', [['#3', null]]],
    ]);
  });

  it('F5 (review 1766): each of gh\'s boolean flags leaves the next word the command\'s own; any other flag takes it', () => {
    for (const flag of BOOLEANS_OTHER) {
      const text = `gh pr view ${flag} 12 -R owner-b/repo-b and #12`;
      expect(links(text, HOME), text).toEqual([['#12', issue('owner-b/repo-b', 12)]]);
    }
    for (const flag of BOOLEANS_API) {
      const text = `gh api ${flag} repos/owner-b/repo-b/pulls/12 and #12`;
      expect(links(text, HOME), text).toEqual([['#12', issue('owner-b/repo-b', 12)]]);
    }
    rows([
      // A flag gh does not list as a boolean takes the next word, so 12 is its value and the command names no number.
      ['gh pr view --not-a-gh-flag 12 -R owner-b/repo-b and #12', [['#12', null]]],
      ['gh pr view 12 --not-a-gh-flag x -R owner-b/repo-b and #12', [['#12', issue('owner-b/repo-b', 12)]]],
      // -i is a boolean in gh api only: in pr checks it takes the interval.
      ['gh pr checks 40 -i 30 -R owner-b/repo-b and #40', [['#40', issue('owner-b/repo-b', 40)]]],
    ]);
  });

  it('F3 (review 1762 F3, review 1766 F1): an open quote voids its command only inside the command\'s own words', () => {
    const b = (n: number): string => issue('owner-b/repo-b', n);
    rows([
      ["gh pr view 12 (it's green), then `gh pr view 40 -R owner-b/repo-b` and #12", [['#12', null]]],
      ["I checked gh pr view 12 and it's green. Then gh pr view 40 -R owner-b/repo-b and #12", [['#12', null]]],
      // A quote in the prose after the command touches nothing the command read.
      ["gh pr view 12 -R owner-b/repo-b and it's green, #12", [['#12', b(12)]]],
      ["Ran gh pr view 40 -R owner-b/repo-b and it's green, so #40 can land.", [['#40', b(40)]]],
      ["gh pr checks 40 --repo owner-b/repo-b shows it's green and #40 is ready", [['#40', b(40)]]],
      ["gh api repos/owner-b/repo-b/pulls/40 and it's merged. #40", [['#40', b(40)]]],
      ["gh pr view 12 -R owner-b/repo-b it's red; #12", [['#12', b(12)]]],
      ["gh pr view 40 -R owner-b/repo-b doesn't show #40 as merged", [['#40', b(40)]]],
      ["gh pr view 12 -R owner-b/repo-b and #12 it's green", [['#12', b(12)]]],
      ['gh pr view 12 -R owner-b/repo-b and "green, #12', [['#12', b(12)]]],
      // A quote left open inside the command's own words voids it: the command names nothing, and its bare name is decided
      // as if the command were absent.
      ["gh pr view 12 -R 'owner-b/repo-b\n#12", [['#12', home(12)]]],
      ["gh pr view 12 -R owner-b/repo-b --body 'oops\n#12", [['#12', home(12)]]],
      // A quote that closes only on a later line is open at its own line's end.
      ["gh pr view 12 -R 'owner-b/repo-b\nmore' and #12", [['#12', home(12)]]],
      // Two apostrophes close each other, as the shell reads them: `-c` takes the quoted run as its value, so the one command
      // is PR 12 in owner-b (review 1762's third shape).
      ["gh pr view 12 -c it's fine; also gh pr view 40 we're -R owner-b/repo-b. #12", [['#12', b(12)]]],
    ]);
  });

  it('F6 and F9: a word that is exactly a quoted flag is that flag; a flag\'s value or a quoted argument is no flag', () => {
    rows([
      ["gh pr view 12 '--repo' owner-b/repo-b and #12", [['#12', issue('owner-b/repo-b', 12)]]],
      ['gh pr view 12 "--repo" owner-b/repo-b and #12', [['#12', issue('owner-b/repo-b', 12)]]],
      ['gh pr view 12 --body "--repo owner-b/repo-b" and #12', [['#12', home(12)]]],
      // Review 1766 F9: the word after a flag that takes a value is that value, even when it is spelled as a flag.
      ['gh pr comment 12 -R owner-b/repo-b --body "--repo=owner-c/repo-c" and #12', [['#12', issue('owner-b/repo-b', 12)]]],
      ["gh pr comment 12 -R owner-b/repo-b --body '-R' owner-c/repo-c and #12", [['#12', issue('owner-b/repo-b', 12)]]],
      ['gh pr comment 12 --body "--repo=owner-c/repo-c" and #12', [['#12', home(12)]]],
    ]);
  });

  it('F8: a reserved first path segment names no repository, and the bare name follows the other rules', () => {
    rows([
      ['![shot](https://github.com/user-attachments/assets/0f1e2d3c) fixed in #12', [['#12', home(12)]]],
      ['see https://github.com/orgs/org-b/projects/3 and #12', [['#12', home(12)]]],
      ['see https://github.com/Settings/profile and #12', [['#12', home(12)]]],
      // Review 1766 F8, recorded: on a pull path too, where main opened a page that does not exist.
      ['https://github.com/topics/x/pull/12 and #12', [['#12', home(12)]]],
    ]);
    expect([...messageRepos('https://github.com/orgs/org-b/projects/3 github.com/topics/x').named]).toEqual([]);
  });

  it('F9 (review 1762, ruled again by review 1766 F3): a flag value with a full stop before an upper-case letter is unknown', () => {
    rows([
      ['gh pr view 12 -R owner-b/repo-b.Then #12', [['#12', null]]],
      ['gh pr view 12 --repo=owner-b/repo-b.Next #12', [['#12', null]]],
      ['gh pr view 12 -R owner-b/Lib.Json and #12', [['#12', null]]],
      ['gh pr view 12 -R vercel/next.JS and #12', [['#12', null]]],
      // A lower-case extension is a repository name as before.
      ['gh pr view 12 -R owner-b/Chart.js and #12', [['#12', issue('owner-b/Chart.js', 12)]]],
    ]);
  });

  it('F10: a line break ends a command; an extension is compared in lower case; an all-digit segment is refused', () => {
    rows([
      ['gh pr view -R owner-b/repo-b\n12 more, and #12', [['#12', null]]],
      ['gh pr view -R owner-b/repo-b\n\n12 more, and #12', [['#12', null]]],
      ['Org/notes.TS#3 and #3', [['Org/notes.TS#3', null], ['#3', null]]],
      ['2024/2025#3 and #3', [['2024/2025#3', null], ['#3', null]]],
      ['abc/12345#5 and #5', [['abc/12345#5', null], ['#5', null]]],
    ]);
  });

  it('F3: the gh reader stays linear over 1 MiB of apostrophes and quotes', () => {
    // Many commands, each closing a quote or leaving one open, all on one line but for the one shape that ends in a break.
    for (const unit of ["gh pr view 1 'a'; ", 'gh -b "a" | ', "gh pr view 1 it's ", "gh pr view 1 it's\n", "gh '"]) {
      const text = unit.repeat(Math.ceil((1 << 20) / unit.length));
      const t = performance.now();
      messageRepos(text);
      expect(performance.now() - t, unit).toBeLessThan(GH_QUOTES_BOUND_MS);
    }
  });

  // F5: distinct SHAs sharing one seven-character prefix cost one range each (c20.md has the measured margin against the
  // bucket scan it replaced).
  it('F5: commit addresses sharing a seven-character prefix stay cheap, the bare SHA and the bare prefix alike', () => {
    const shas = Array.from({ length: SHARED_PREFIX_N }, (_, i) => `abcdef1${i.toString(16).padStart(8, '0')}`);
    const one = messageRepos(shas.map((sha) => `https://github.com/org-b/project-b/commit/${sha} ${sha}`).join('\n'));
    let t = performance.now();
    const hrefs = shas.map((sha) => refHref({ kind: 'commit', id: sha, text: sha }, HOME, one)?.href ?? '');
    let took = performance.now() - t;
    expect(hrefs.every((h, i) => h === `https://github.com/org-b/project-b/commit/${shas[i]!}`)).toBe(true);
    expect(took).toBeLessThan(SHARED_PREFIX_BOUND_MS);
    const many = messageRepos(shas.map((sha, i) => `https://github.com/org-b/project-${i}/commit/${sha} abcdef1`).join('\n'));
    t = performance.now();
    for (let i = 0; i < SHARED_PREFIX_N; i += 1) {
      expect(refHref({ kind: 'commit', id: 'abcdef1', text: 'abcdef1' }, HOME, many)).toBeNull();
    }
    took = performance.now() - t;
    expect(took).toBeLessThan(SHARED_PREFIX_BOUND_MS);
  });

  it('F5: a commit name still meets an address whose SHA is shorter or longer than its own', () => {
    const said = messageRepos('github.com/org-b/project-b/commit/abcdef12 and github.com/org-c/project-c/commit/1234567890ab'
      + ' and github.com/org-b/project-b/commit/fedcba9');
    const commit = (sha: string): string | null => refHref({ kind: 'commit', id: sha, text: sha }, HOME, said)?.href ?? null;
    expect(commit('abcdef1234')).toBe('https://github.com/org-b/project-b/commit/abcdef1234');
    expect(commit('abcdef1')).toBe('https://github.com/org-b/project-b/commit/abcdef1');
    expect(commit('1234567')).toBe('https://github.com/org-c/project-c/commit/1234567');
    expect(commit('abcdef13')).toBeNull();
    expect(commit('fedcba98')).toBe('https://github.com/org-b/project-b/commit/fedcba98');
    const two = messageRepos('github.com/org-b/project-b/commit/abcdef12 github.com/org-c/project-c/commit/abcdef1234');
    expect(refHref({ kind: 'commit', id: 'abcdef123', text: 'abcdef123' }, HOME, two)).toBeNull();
    expect(refHref({ kind: 'commit', id: 'abcdef12ff', text: 'abcdef12ff' }, HOME, two)?.href)
      .toBe('https://github.com/org-b/project-b/commit/abcdef12ff');
    // Two addresses of one repository sort before a third repository's: the range still tells two.
    const three = messageRepos(['abcdef10', 'abcdef11'].map((sha) => `github.com/org-b/project-b/commit/${sha}`).join(' ')
      + ' github.com/org-c/project-c/commit/abcdef12');
    expect(refHref({ kind: 'commit', id: 'abcdef1', text: 'abcdef1' }, HOME, three)).toBeNull();
    expect(refHref({ kind: 'commit', id: 'abcdef11', text: 'abcdef11' }, HOME, three)?.href)
      .toBe('https://github.com/org-b/project-b/commit/abcdef11');
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

  it('a host directly after a letter names an unknown repository, and a path that only contains owner/repo#n names nothing', () => {
    expect([...messageRepos('notgithub.com/org-b/project-b/pull/1').named]).toEqual(['?host:github.com/org-b/project-b/pull/1']);
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
