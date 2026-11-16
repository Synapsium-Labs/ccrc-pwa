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
import { GH_BOOLEAN_FLAGS, messageRepos, repoKey } from '../src/lib/chatRepoEvidence';

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
// Task C22 (review 1769 F1): measured against round 2's net in c22.md.
const GH_FLAG_RUN_BOUND_MS = 1500;
// Task C23 fix round 1 (review 1795 F5): measured against a quadratic mutant in c23.md. Task C24 (review 1808 M1): the two
// commit-candidate pins read 3 MiB, so a native indexOf writer goes red with room (c24.md).
const GH_COMMIT_CANDIDATES_BOUND_MS = 1500;
const GH_COMMIT_CANDIDATES_BYTES = 3 << 20;
// Task C24 fix round 1 (review 1819's merge-queue run, where the 1 MiB storm test took 5,562 ms): a test that reads one large
// message or several carries its own timeout, every message at its bound plus room to build the strings, so vitest's default
// 5 s per test cannot fail one whose every message is within its bound. The per-message bound stays the linearity assertion.
const LARGE_BUILD_MS = 5000;
const largeTimeout = (messages: number, boundMs: number): number => messages * boundMs + LARGE_BUILD_MS;
const F5_READER_TIMEOUT_MS = 2000 + 3000 + LARGE_BUILD_MS;

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
    // The flag never reaches the command's number; since review 1768's net it names its repository, so the name is text.
    expect(links('#12: gh pr view 12; echo --repo o/r', HOME)).toEqual([['#12', null]]);
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
  }, F5_READER_TIMEOUT_MS);

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
      // A flag past the command's end never reaches its number. Since review 1768's net, every repository flag of a gh
      // message names its repository wherever it stands, another program's too, so the bare name is text (c20.md).
      ['gh pr view 12 then cp -R owner-b/repo-b /x; #12', [['#12', null]]],
      ['gh pr view 12, then grep -R src/lib . and #12 is fine', [['#12', null]]],
      // With no gh word in the message there is no net: another program's flag names nothing.
      ['cp -R owner-b/repo-b /x; #12', [['#12', home(12)]]],
      // Task C22 (review 1769 F3): the net's flag in the body is no command's, so owner-c is a candidate for #12 too: text.
      ['gh pr comment 12 --body "see -R owner-c/repo-c" --repo owner-b/repo-b and #12', [['#12', null]]],
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
      ['I ran gh pr list, --repo owner-b/repo-b next, then #12', [['#12', null]]],
      ['I ran gh pr list. --repo owner-b/repo-b is next for #12', [['#12', null]]],
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
      'gh repo clone owner-b/repo-b and #12', '#12 in owner-b/repo-b', 'In owner-b/repo-b, #12 is green',
      'gitlab.com/owner-b/repo-b/-/merge_requests/12 #12',
    ]) expect(links(text, HOME).filter(([t]) => t === '#12'), text).toEqual([['#12', home(12)]]);
    // Since review 1768's net (Task C20), a glued -R names its repository: text.
    expect(links('gh pr view 12 -Rowner-b/repo-b and #12', HOME)).toEqual([['#12', null]]);
    // Since Task C23 (review 1778 P1) a continued line is the command's own, so its flag is the number's: owner-b.
    expect(links('gh pr view 12 \\\n  --repo owner-b/repo-b and #12', HOME)).toEqual([['#12', issue('owner-b/repo-b', 12)]]);
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

  // Review 1766 F2 and F5, review 1768 G1 and G7: the flags gh 2.103.3's own help lists with no value type (c20.md), as this
  // test's own copy, so a flag dropped from the reader's list reds its row, and one added to it reds the comparison.
  const BOOLEANS_API = ['--allow-escape-sequences', '--include', '-i', '--paginate', '--silent', '--slurp', '--verbose'];
  const BOOLEANS_PR_ISSUE = [
    '--admin', '--allow-escape-sequences', '--approve', '--auto', '--checkout', '--clobber', '--comments', '--conflict-status',
    '--create-if-none', '--delete-branch', '-d', '--delete-last', '--detach', '--disable-auto', '--draft', '--dry-run',
    '--edit-last', '--editor', '--fail-fast', '--fill', '--fill-first', '--fill-verbose', '--force', '-f', '--list', '--merge',
    '--name-only', '--no-maintainer-edit', '--patch', '--rebase', '--recurse-submodules', '--remove-milestone',
    '--remove-parent', '--remove-type', '--request-changes', '--required', '--skip-existing', '--squash', '--undo', '--watch',
    '--web', '-w', '--yes',
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
      // (Since review 1768's net the flag names its repository, so the bare name is text, never home.)
      ['gh api user then -R owner-b/repo-b and #12', [['#12', null]]],
      // A quoted '#12' reaches gh as its number, as the shell passes it.
      ["gh pr view '#12' -R owner-b/repo-b and #12", [['#12', issue('owner-b/repo-b', 12)], ['#12', issue('owner-b/repo-b', 12)]]],
      // An unquoted #-word is a shell comment: the command ends there, and what follows it is not read.
      ['`gh pr list -R owner-b/repo-b # 12 open`; #12 is ours', [['#12', null]]],
      // The flag after the #-word is not the command's, but it names its repository (review 1768's net): text, not home.
      ['gh pr view #12 40 -R owner-b/repo-b; #40', [['#12', null], ['#40', null]]],
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
    for (const flag of BOOLEANS_PR_ISSUE) {
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
      // A quote left open inside the command's own words voids it: the command opens nothing. Its repository flag still
      // names a repository, and its number is in one the chat cannot tell (review 1768 G4), so the bare name is text.
      ["gh pr view 12 -R 'owner-b/repo-b\n#12", [['#12', null]]],
      ["gh pr view 12 -R owner-b/repo-b --body 'oops\n#12", [['#12', null]]],
      // A quote that closes only on a later line is open at its own line's end.
      ["gh pr view 12 -R 'owner-b/repo-b\nmore' and #12", [['#12', null]]],
      // A voided command with no repository flag is decided as if absent (review 1766 F1).
      ["gh pr view 12 --body 'oops\n#12", [['#12', home(12)]]],
      // Two apostrophes close each other, as the shell reads them: `-c` takes the quoted run as its value, so the one command
      // is PR 12 in owner-b (review 1762's third shape).
      ["gh pr view 12 -c it's fine; also gh pr view 40 we're -R owner-b/repo-b. #12", [['#12', b(12)]]],
    ]);
  });

  it('F6 and F9: a word that is exactly a quoted flag is that flag; a flag\'s value or a quoted argument is no flag', () => {
    rows([
      ["gh pr view 12 '--repo' owner-b/repo-b and #12", [['#12', issue('owner-b/repo-b', 12)]]],
      ['gh pr view 12 "--repo" owner-b/repo-b and #12', [['#12', issue('owner-b/repo-b', 12)]]],
      // A flag inside a quoted body is no flag of the command, but it names its repository (review 1768's net).
      ['gh pr view 12 --body "--repo owner-b/repo-b" and #12', [['#12', null]]],
      // Review 1766 F9: the word after a flag that takes a value is that value, even when it is spelled as a flag, so the
      // command's PR 12 is owner-b's. Since Task C22 (review 1769 F3) the net's flag inside that value is no command's, and a
      // candidate for #12 too: text.
      ['gh pr comment 12 -R owner-b/repo-b --body "--repo=owner-c/repo-c" and #12', [['#12', null]]],
      ["gh pr comment 12 -R owner-b/repo-b --body '-R' owner-c/repo-c and #12", [['#12', null]]],
      ['gh pr comment 12 --body "--repo=owner-c/repo-c" and #12', [['#12', null]]],
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

  // Many commands, each closing a quote or leaving one open, all on one line but for the one shape that ends in a break.
  // Review 1768's net reads every repository flag: an open quote after each, a run and a glued value, and a quoted value
  // broken by a line.
  const quoteUnits = [
    "gh pr view 1 'a'; ", 'gh -b "a" | ', "gh pr view 1 it's ", "gh pr view 1 it's\n", "gh '",
    "gh x -R 'a ", 'gh -sRx --repo=y ', 'gh x -R "a\n',
  ];
  it('F3: the gh reader stays linear over 1 MiB of apostrophes and quotes', () => {
    for (const unit of quoteUnits) {
      const text = unit.repeat(Math.ceil((1 << 20) / unit.length));
      const t = performance.now();
      messageRepos(text);
      expect(performance.now() - t, unit).toBeLessThan(GH_QUOTES_BOUND_MS);
    }
  }, largeTimeout(quoteUnits.length, GH_QUOTES_BOUND_MS));

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

// Task C20 fix round 2 (D-8187): review 1768. Every reproduction in its report is a row: each gives the attributed repository
// or text, never home, because every repository flag of a gh message names its repository (the net) and a command that
// loses its repository flag gives its number to a repository the chat cannot tell.
describe('Task C20 fix round 2: a lost repository flag gives text, never home (review 1768)', () => {
  const home = (n: number): string => issue('org-a/project-a', n);
  const b = (n: number): string => issue('owner-b/repo-b', n);
  const rows = (table: [string, [string, string | null][]][]): void => {
    for (const [text, expected] of table) expect(links(text, HOME), text).toEqual(expected);
  };
  const BOOLEANS_API = ['--allow-escape-sequences', '--include', '-i', '--paginate', '--silent', '--slurp', '--verbose'];

  it('G7: the boolean sets are gh\'s help, entry by entry, both ways (an entry added or dropped reds)', () => {
    expect(Object.keys(GH_BOOLEAN_FLAGS).sort()).toEqual(['api', 'prIssue']);
    expect([...GH_BOOLEAN_FLAGS.api].sort()).toEqual([...BOOLEANS_API].sort());
    expect([...GH_BOOLEAN_FLAGS.prIssue].sort()).toEqual([
      '--admin', '--allow-escape-sequences', '--approve', '--auto', '--checkout', '--clobber', '--comments',
      '--conflict-status', '--create-if-none', '--delete-branch', '--delete-last', '--detach', '--disable-auto', '--draft', '--dry-run',
      '--edit-last', '--editor', '--fail-fast', '--fill', '--fill-first', '--fill-verbose', '--force', '--list', '--merge',
      '--name-only', '--no-maintainer-edit', '--patch', '--rebase', '--recurse-submodules', '--remove-milestone',
      '--remove-parent', '--remove-type', '--request-changes', '--required', '--skip-existing', '--squash', '--undo',
      '--watch', '--web', '--yes', '-d', '-f', '-w',
    ].sort());
    // The report's M07 and M10: a value flag wrongly listed would make its value the command's number or path.
    rows([
      ['gh pr view -m 12 -R owner-b/repo-b and #12', [['#12', null]]],
      // Since Task C22 (review 1769 F2) the net names a lost path's repository: text, never home.
      ['gh api --method repos/owner-b/repo-b/pulls/12 and #12', [['#12', null]]],
    ]);
  });

  it('G1: a boolean the list leaves out, before -R, loses the flag: text, never home', () => {
    rows([
      ['gh pr merge 40 -s -R owner-b/repo-b and #40 is in', [['#40', null]]],
      ['gh pr merge 40 -m -R owner-b/repo-b and #40 is in', [['#40', null]]],
      ['gh pr merge 40 -r -R owner-b/repo-b and #40 is in', [['#40', null]]],
      ['gh pr merge 40 -d -s -R owner-b/repo-b and #40 is in', [['#40', null]]],
      ['gh pr merge 40 --auto -s -R owner-b/repo-b and #40 is in', [['#40', null]]],
      ['gh pr merge 40 -s --repo=owner-b/repo-b and #40 is in', [['#40', null]]],
      ['`gh pr merge 40 -s -R owner-b/repo-b` and #40 is in', [['#40', null]]],
      ['```\ngh pr merge 40 -s -R owner-b/repo-b\n```\nMerged #40.', [['#40', null]]],
      ['gh pr view 40 -c -R owner-b/repo-b and #40 has the thread', [['#40', null]]],
      ['gh issue view 12 -c -R owner-b/repo-b and #12', [['#12', null]]],
      ['gh pr review 40 -a -R owner-b/repo-b and #40 is approved', [['#40', null]]],
      ['gh pr review 40 --comment -b "lgtm" -R owner-b/repo-b and #40', [['#40', null]]],
      ['gh pr comment 40 -e -R owner-b/repo-b and #40', [['#40', null]]],
      ['gh pr view 12 -c -R owner-b/repo-b and 1234567abc', [['1234567abc', null]]],
      // issue develop's booleans are now in the list (gh's help), so its number keeps its repository.
      ['gh issue develop 12 --checkout -R owner-b/repo-b and #12', [['#12', b(12)]]],
      ['gh issue develop 12 --list -R owner-b/repo-b and #12', [['#12', b(12)]]],
      // A lost flag never lets another command or address give the number a wrong repository.
      ['Checked `gh pr view 12 -c -R owner-b/repo-b` and `gh pr view 12 -R owner-c/repo-c`: #12 is green', [['#12', null]]],
      ['gh pr merge 40 -s -R owner-b/repo-b; gh pr view 40 -R owner-c/repo-c; #40', [['#40', null]]],
      ['gh pr view 12 -c -R owner-b/repo-b, and owner-c/repo-c#12; #12 is the one',
        [['owner-c/repo-c#12', issue('owner-c/repo-c', 12)], ['#12', null]]],
      ['gh pr merge 40 -R owner-c/repo-c -s -R owner-b/repo-b and #40', [['#40', null]]],
      // A value spelled as a flag stays the value (review 1766 F9), and the command's repository is lost.
      ['gh pr comment 12 -R owner-b/repo-b --body -R owner-c/repo-c and #12', [['#12', null]]],
      // So is a -R with no value after it.
      ['gh pr view 12 -R # later; gh pr view 12 -R owner-c/repo-c; #12', [['#12', null]]],
      // Controls: a listed boolean before -R, -R before the flag, and a flag after the repository keep the link.
      ['gh pr merge 40 --squash -R owner-b/repo-b and #40', [['#40', b(40)]]],
      ['gh pr merge 40 -R owner-b/repo-b -s and #40', [['#40', b(40)]]],
      ['gh pr view 40 -R owner-b/repo-b --comments and #40', [['#40', b(40)]]],
    ]);
  });

  it('G2: a group with no boolean set reads every flag as taking a value, and its repository flag is named', () => {
    rows([
      ['gh run view 123 --log-failed -R owner-b/repo-b; the failure is #12', [['#12', null]]],
      ['gh run rerun 123 --failed -R owner-b/repo-b, then #12 went green', [['#12', null]]],
      ['gh run watch 123 --exit-status -R owner-b/repo-b and #12', [['#12', null]]],
      ['gh run view 123 --log -R owner-b/repo-b and #12', [['#12', null]]],
      ['gh release create v1.2 --generate-notes -R owner-b/repo-b and #12', [['#12', null]]],
      ['gh release create v1.2 --latest -R owner-b/repo-b and #12', [['#12', null]]],
      ['gh release create v1.2 -p -R owner-b/repo-b and #12', [['#12', null]]],
      ['gh workflow view ci.yml -y -R owner-b/repo-b and #12', [['#12', null]]],
      ['gh run list -a -R owner-b/repo-b and #12', [['#12', null]]],
      ['gh cache delete -a -R owner-b/repo-b and #12', [['#12', null]]],
      ['gh secret set TOKEN -u -R owner-b/repo-b and #12', [['#12', null]]],
      ['gh search prs --merged --repo owner-b/repo-b #12', [['#12', null]]],
      ['gh search issues --no-assignee --repo owner-b/repo-b and #12', [['#12', null]]],
      ['Ran `gh run view 99 --log-failed -R owner-b/repo-b`; the fix is 1234567abc', [['1234567abc', null]]],
      // -d and -f take a value in these groups: they are in no set of theirs.
      ['gh label create bug -d "Something" -R owner-b/repo-b for #12', [['#12', null]]],
      ['gh workflow run release.yml -f tag=v1 -R owner-b/repo-b after #12 merged', [['#12', null]]],
      // Controls: the home repository named is home.
      ['gh run view 123 --log -R org-a/project-a and #12', [['#12', home(12)]]],
    ]);
  });

  it('G3: a command written with its own #n ends there (review 1766 F7), and a repository flag after it gives text', () => {
    rows([
      ['gh pr view #12 -R owner-b/repo-b and #12 is green', [['#12', null], ['#12', null]]],
      ['gh pr merge #12 --squash -R owner-b/repo-b; #12 is in', [['#12', null], ['#12', null]]],
      ['gh pr view #12 --repo=owner-b/repo-b and #12', [['#12', null], ['#12', null]]],
      ['`gh pr checks #12 --repo owner-b/repo-b`: #12', [['#12', null], ['#12', null]]],
      ['gh issue view #7 -R owner-b/repo-b: #7 is the bug', [['#7', null], ['#7', null]]],
      ['gh pr view #12 -R owner-b/repo-b then gh pr view #13 -R owner-c/repo-c; #12 and #13',
        [['#12', null], ['#13', null], ['#12', null], ['#13', null]]],
      // Its number is in a repository the chat cannot tell, so another command naming that number does not decide it.
      ['gh pr view #12 -R owner-b/repo-b and gh pr view 12 -R owner-c/repo-c; #12', [['#12', null], ['#12', null]]],
      // Controls: with no repository flag in the message, a #n command is as before, home.
      ['gh pr view #12 and #12', [['#12', home(12)], ['#12', home(12)]]],
      // Only a pr or issue command's own number, where it stands, is read from a #-word; another command's number decides.
      ['gh pr view 40 #12; gh pr view 12 -R owner-c/repo-c and #12',
        [['#12', issue('owner-c/repo-c', 12)], ['#12', issue('owner-c/repo-c', 12)]]],
      ['gh run view #12; gh pr view 12 -R owner-c/repo-c and #12',
        [['#12', issue('owner-c/repo-c', 12)], ['#12', issue('owner-c/repo-c', 12)]]],
      ['gh pr view --json #12; gh pr view 12 -R owner-c/repo-c and #12',
        [['#12', issue('owner-c/repo-c', 12)], ['#12', issue('owner-c/repo-c', 12)]]],
      ['gh pr view #12x; gh pr view 12 -R owner-c/repo-c and #12', [['#12', issue('owner-c/repo-c', 12)]]],
    ]);
  });

  it('G4: a voided command keeps its repository flag named: the bare name is text', () => {
    rows([
      ["I ran gh pr comment 12 -R owner-b/repo-b -b don't merge yet, and #12 waits.", [['#12', null]]],
      ["gh pr comment 12 -R owner-b/repo-b --body it's-done and #12", [['#12', null]]],
      ["gh pr view 12 -R owner-b/repo-b -t it's #12", [['#12', null]]],
      ["gh api repos/owner-b/repo-b/pulls/12 -H it's #12", [['#12', null]]],
      ["gh pr checks -R owner-b/repo-b doesn't pass for #12", [['#12', null]]],
      ["gh pr list -R owner-b/repo-b doesn't show #12", [['#12', null]]],
      ["gh pr view -R owner-b/repo-b it's green, #12", [['#12', null]]],
      ["gh run list -R owner-b/repo-b doesn't list #12", [['#12', null]]],
      ["gh pr checks -R owner-b/repo-b won't pass for #12", [['#12', null]]],
      ['gh pr comment 12 -R owner-b/repo-b --body "first line\nsecond line" and #12', [['#12', null]]],
      ['```\ngh pr comment 12 -R owner-b/repo-b --body "first line\nsecond line"\n```\n#12 got the comment', [['#12', null]]],
      ['```\ngh pr create -R owner-b/repo-b --title "x" --body "$(cat <<\'EOF\'\nbody\nEOF\n)"\n```\nopened #12',
        [['#12', null]]],
      ['gh pr comment 12 -R owner-b/repo-b --body "a\nb"; gh pr view 12 -R owner-c/repo-c; #12', [['#12', null]]],
      // Control: the number before -R with prose after keeps its repository.
      ["gh pr view 12 -R owner-b/repo-b doesn't show #12", [['#12', b(12)]]],
    ]);
  });

  it('G6: the net reads -R in a run of short flags, glued and with =', () => {
    rows([
      ['gh pr merge 40 -sR owner-b/repo-b and #40', [['#40', null]]],
      ['gh pr merge 40 -dsR owner-b/repo-b and #40', [['#40', null]]],
      ['gh pr view 12 -Rowner-b/repo-b and #12', [['#12', null]]],
      ['gh pr view 12 -R=owner-b/repo-b and #12', [['#12', null]]],
      ['gh pr merge 40 -sR owner-b/repo-b; gh pr view 40 -R owner-c/repo-c; #40', [['#40', null]]],
      // Outside a pr or issue command only the net reads the run.
      ['gh run list -sR owner-b/repo-b and #12', [['#12', null]]],
    ]);
  });

  it('the net: every repository flag of a gh message names its repository, and only in a gh message', () => {
    rows([
      // Another program's flag in a gh message names its word (accepted, c20.md); with no gh word, nothing.
      ['gh pr list; cp -R src/lib /x and #12', [['#12', null]]],
      ['cp -R src/lib /x and #12', [['#12', home(12)]]],
      // A flag the chat cannot read names an unknown repository: an open quote, nothing after it, a sentence in its value.
      ["gh pr list -R 'owner-b/repo-b\nand #12", [['#12', null]]],
      ['gh pr list and pass -R\n#12', [['#12', null]]],
      ['gh pr list; cp -R owner-b/Lib.Json /x and #12', [['#12', null]]],
      ['gh pr list --repo "owner-b/repo-b" and #12', [['#12', null]]],
      // The home repository named by a flag is home, in each spelling the net reads.
      ['gh pr list -R org-a/project-a and #12', [['#12', home(12)]]],
      ['gh run view 1 --repo=org-a/project-a and #12', [['#12', home(12)]]],
      ['gh run view 1 -R "org-a/project-a" and #12', [['#12', home(12)]]],
      ['gh run list -R org-a/project-a, then #12', [['#12', home(12)]]],
      ['gh run list -sR=org-a/project-a and #12', [['#12', home(12)]]],
      // A quoted value broken by a line is unreadable, the home repository's too.
      ["gh run view 1 -R 'org-a/project-a\n' and #12", [['#12', null]]],
      // Not a flag: a word that only contains one.
      ['gh pr list; non-Rust x-R y --repository z and #12', [['#12', home(12)]]],
    ]);
    expect([...messageRepos('gh pr list; cp -R owner-b/repo-b /x').named]).toEqual(['owner-b/repo-b']);
  });
});

// Task C22 (D-8196): review 1769. The net reads in linear time, a lost gh api path gives text or its repository, a
// repository flag no command claimed is a candidate for every number, and a gh word is any gh with no letter or digit beside it.
// Every change fails toward text.
describe('Task C22: the gh net in linear time, and its last gaps fail toward text (review 1769)', () => {
  const home = (n: number): string => issue('org-a/project-a', n);
  const b = (n: number): string => issue('owner-b/repo-b', n);
  const c = (n: number): string => issue('owner-c/repo-c', n);
  const rows = (table: [string, [string, string | null][]][]): void => {
    for (const [text, expected] of table) expect(links(text, HOME), text).toEqual(expected);
  };

  const runUnits = ['-R=', '--repo=', '-R/', '-R:', '-sR=', '--repo.'];
  it('F1: a spaceless run of repository flags reads in linear time and memory (c22.md has the margins)', () => {
    // Each flag's value ends where the next flag starts, so the run is read once; round 2 re-read the rest of it per flag.
    for (const unit of runUnits) {
      const text = `gh ${unit.repeat(Math.ceil((1 << 20) / unit.length))}`;
      const t = performance.now();
      const said = messageRepos(text);
      expect(performance.now() - t, unit).toBeLessThan(GH_FLAG_RUN_BOUND_MS);
      expect(said.named.size, unit).toBeLessThanOrEqual(2);
    }
  }, largeTimeout(runUnits.length, GH_FLAG_RUN_BOUND_MS));

  it('F1: a value still reads as before where no flag starts inside it', () => {
    rows([
      ['gh pr view 12 -R=owner-b/repo-b and #12', [['#12', null]]],
      ['gh pr list --repo=owner-b/repo-b; gh pr view 12 --repo=owner-b/repo-b and #12', [['#12', b(12)]]],
      // A value that would run into the next flag ends there: both are unknown, and the bare name is text.
      ['gh pr list -R=-R=owner-b/repo-b and #12', [['#12', null]]],
      ['gh pr list -R "owner-b/repo-b -R x" and #12', [['#12', null]]],
    ]);
    expect([...messageRepos('gh pr list -R=-R=owner-b/repo-b').named].sort()).toEqual(['?gh:lost', 'owner-b/repo-b']);
    // For the net, a quote not closed before the next flag is unreadable, and the next flag reads its own value; the command
    // reader still takes the whole quoted word as its value.
    expect([...messageRepos('gh pr list -R "owner-b/repo-b -R x"').named].sort())
      .toEqual(['?gh:lost', '?owner-b/repo-b -r x', '?x']);
  });

  it('F2: a glued short flag value is one word and takes no next word, so the api path is read', () => {
    rows([
      ['gh api -XPATCH repos/owner-b/repo-b/issues/12 -f state=closed; #12 is closed', [['#12', b(12)]]],
      ['gh api -XGET repos/owner-b/repo-b/pulls/12; #12', [['#12', b(12)]]],
      ['gh api -Hx:y repos/owner-b/repo-b/pulls/12 and #12', [['#12', b(12)]]],
      ['gh api -q.title repos/owner-b/repo-b/pulls/12 and #12', [['#12', b(12)]]],
      ['gh api -iXGET repos/owner-b/repo-b/pulls/12 and #12', [['#12', b(12)]]],
      // A commit path names its sha in its repository (Task C23 fix round 1, review 1795 F2): the bare commit opens it.
      ['gh api -XGET repos/owner-b/repo-b/commits/1234567abc and 1234567abc',
        [['1234567abc', 'https://github.com/owner-b/repo-b/commit/1234567abc']]],
      // Controls: the spaced spellings, as before.
      ['gh api -X PATCH repos/owner-b/repo-b/issues/12 and #12', [['#12', b(12)]]],
      ['gh api --method PATCH repos/owner-b/repo-b/issues/12 and #12', [['#12', b(12)]]],
      ['gh api -X=GET repos/owner-b/repo-b/pulls/12 and #12', [['#12', b(12)]]],
      // A run of booleans whose last letter takes a value takes the next word: here the method, so the path follows.
      ['gh api -iX GET repos/owner-b/repo-b/pulls/12 and #12', [['#12', b(12)]]],
      // In pr and issue too: a glued value before -R leaves -R the command's.
      ['gh pr view 12 -L5 -R owner-b/repo-b and #12', [['#12', b(12)]]],
      // A run of booleans whose last letter takes a value takes the next word, as gh reads it; the command reader still
      // attributes only -R, --repo and --repo=, so the run loses its repository.
      ['gh pr merge 40 -dR owner-b/repo-b and #40', [['#40', null]]],
    ]);
  });

  it('F2: a lost api path gives text, never home: every repos/o/r word of a gh message names its repository', () => {
    rows([
      // An unclosed quote on the path itself: text, as on main.
      ["gh api 'repos/owner-b/repo-b/pulls/12 and #12", [['#12', null]]],
      ['gh api "repos/owner-b/repo-b/pulls/12 and #12', [['#12', null]]],
      // A multi-line quoted --jq before the path, bare and fenced.
      ["gh api --jq '.title\n| ascii' repos/owner-b/repo-b/pulls/12 and #12", [['#12', null]]],
      ["```\ngh api --jq '.title\n| ascii' repos/owner-b/repo-b/pulls/12\n```\n#12 is the one", [['#12', null]]],
      // A line continuation before the path: since Task C23 (review 1778 P1) it is whitespace, so the path is read.
      ['gh api \\\n  repos/owner-b/repo-b/pulls/12 and #12', [['#12', b(12)]]],
      ['```\ngh api \\\n  /repos/owner-b/repo-b/pulls/12\n```\n#12', [['#12', b(12)]]],
      // A boolean the api set does not hold (a future gh flag) takes the path as its value.
      ['gh api --unknown-bool repos/owner-b/repo-b/pulls/12 and #12', [['#12', null]]],
      // A lost path is no command's, so another command naming its number elsewhere does not decide it (F3); a read path is
      // its command's, so it is no candidate for another number.
      ['gh api --unknown-bool repos/owner-b/repo-b/pulls/12; gh pr view 12 -R owner-c/repo-c; #12', [['#12', null]]],
      ['gh api repos/owner-b/repo-b/pulls/12; gh pr view 13 -R owner-c/repo-c; #13', [['#13', c(13)]]],
      // A path word in prose of a gh message names its repository too, the way -R does.
      ['gh pr list, then the endpoint /repos/owner-b/repo-b/pulls; #12', [['#12', null]]],
      // Controls: no gh word, no net; a placeholder or a longer path names nothing; home named is home.
      ['the endpoint repos/owner-b/repo-b/pulls/12 and #12', [['#12', home(12)]]],
      ['gh pr list; gh api repos/{owner}/{repo}/pulls and #12', [['#12', home(12)]]],
      ['gh pr list; see src/repos/owner-b/repo-b and #12', [['#12', home(12)]]],
      ['gh pr list --json title; repos/org-a/project-a/pulls and #12', [['#12', home(12)]]],
    ]);
  });

  it('F3: a repository flag no command claimed is a candidate for every number the message gives a repository', () => {
    rows([
      ['```\ngh pr view 12 \\\n--repo owner-b/repo-b --json state\ngh pr view 12 --repo owner-c/repo-c --json state\n```\n'
        + '#12 is merged in both', [['#12', null]]],
      ['gh issue edit 12 13 --add-label bug -R owner-b/repo-b; gh issue view 12 -R owner-c/repo-c; #12', [['#12', null]]],
      ['gh issue edit 12 13 --add-label bug -R owner-b/repo-b\r\ngh issue view 12 -R owner-c/repo-c\r\n#12', [['#12', null]]],
      ['gh pr view 12 \\\n--repo owner-b/repo-b\nowner-c/repo-c#12 and #12', [['owner-c/repo-c#12', c(12)], ['#12', null]]],
      // The two shapes newer than main.
      ['gh pr merge 40 now -R owner-b/repo-b, then owner-c/repo-c#40 and #40', [['owner-c/repo-c#40', c(40)], ['#40', null]]],
      ['gh pr view 12 --list 30 -R owner-b/repo-b; gh -R owner-c/repo-c pr view 12; #12', [['#12', null]]],
      // Controls: an unclaimed flag naming the same repository leaves one; a number with no repository goes to rule 3, so an
      // unclaimed flag never makes a link of its own; claimed flags are their commands'.
      ['gh pr view 12 -R owner-b/repo-b; cp -R owner-b/repo-b /x; #12', [['#12', b(12)]]],
      ['cp -R src/lib /x; gh pr list; #12', [['#12', null]]],
      // Since Task C23 (review 1778 P1) the continued line is the command's, so its flag is the number's.
      ['gh pr view 12 \\\n--repo owner-b/repo-b\n#12', [['#12', b(12)]]],
      ['gh pr view 12 -R owner-b/repo-b; gh pr view 13 -R owner-c/repo-c; #12 and #13', [['#12', b(12)], ['#13', c(13)]]],
      // A lost command's flag is that command's too: its value spelled as a flag, a run, a glued spelling.
      ['gh pr merge 40 -s -R owner-b/repo-b; gh pr view 41 -R owner-c/repo-c; #41', [['#41', c(41)]]],
      ['gh pr merge 40 -sR owner-b/repo-b; gh pr view 41 -R owner-c/repo-c; #41', [['#41', c(41)]]],
      ['gh pr view 40 -Rowner-b/repo-b; gh pr view 41 -R owner-c/repo-c; #41', [['#41', c(41)]]],
      // Two unclaimed repositories, one of them the number's own: still two, text.
      ['gh pr view 12 -R owner-b/repo-b; cp -R owner-b/repo-b /x; cp -R owner-c/repo-c /y; #12', [['#12', null]]],
    ]);
  });

  it('F4: a gh word is gh in any case, or gh.exe, with no letter or digit beside it', () => {
    rows([
      ['Pass `-R owner-b/repo-b` to `gh`: #12 is there', [['#12', null]]],
      ['I passed -R owner-b/repo-b to gh, and #12 merged.', [['#12', null]]],
      ["gh's -R owner-b/repo-b flag; #12 merged", [['#12', null]]],
      ['gh: -R owner-b/repo-b; #12', [['#12', null]]],
      ['(gh) -R owner-b/repo-b; #12', [['#12', null]]],
      ['[gh] -R owner-b/repo-b; #12', [['#12', null]]],
      ['"gh" -R owner-b/repo-b; #12', [['#12', null]]],
      // At the text's end, with and without a trailing line break: the pair agrees.
      ['#12 merged after -R owner-b/repo-b with gh', [['#12', null]]],
      ['#12 merged after -R owner-b/repo-b with gh\n', [['#12', null]]],
      ['GH pr view 12 -R owner-b/repo-b and #12', [['#12', b(12)]]],
      ['gh.exe pr view 12 -R owner-b/repo-b and #12', [['#12', b(12)]]],
      ['GH.EXE pr view 12 --repo owner-b/repo-b; #12', [['#12', b(12)]]],
      // The accepted cost: gh-pages holds a gh word, so another program's -R makes the bare name text.
      ['Pushed gh-pages, then cp -R dist /x; #12', [['#12', null]]],
      // A letter or a digit in any script beside it makes no gh word (the CJK shape stays as on main: recorded in c22.md).
      ['修复见gh pr view 12 -R owner-b/repo-b and #12', [['#12', home(12)]]],
      ['ghost -R owner-b/repo-b and #12', [['#12', home(12)]]],
      ['a high -R owner-b/repo-b and #12', [['#12', home(12)]]],
      ['gh2 -R owner-b/repo-b and #12', [['#12', home(12)]]],
      // A letter outside the BMP is read whole, as one letter.
      ['𝐀gh pr view 12 -R owner-b/repo-b and #12', [['#12', home(12)]]],
      // A gh word in any case ends the command before it, so the next one reads its own words.
      ['gh GH pr view 12 -R owner-b/repo-b and #12', [['#12', b(12)]]],
      // gh then a full stop is a gh word: `.exec` is no `.exe`.
      ['gh.exec -R owner-b/repo-b and #12', [['#12', null]]],
    ]);
  });

  it('F8: the YAML env spelling GH_REPO: o/r names its repository', () => {
    rows([
      ['```yaml\nenv:\n  GH_REPO: owner-b/repo-b\nrun: gh pr view 12\n```\n#12', [['#12', null]]],
      ['GH_REPO: "owner-b/repo-b" and #12', [['#12', null]]],
      ['GH_REPO:\towner-b/repo-b and #12', [['#12', null]]],
      // Controls: the home repository is home; a word ending in GH_REPO is none.
      ['GH_REPO: org-a/project-a and #12', [['#12', home(12)]]],
      ['MY_GH_REPO: owner-b/repo-b and #12', [['#12', home(12)]]],
    ]);
  });
});

describe('Task C23: a command claims its repository flags only where it gives a number (review 1778)', () => {
  const home = (n: number): string => issue('org-a/project-a', n);
  const b = (n: number): string => issue('owner-b/repo-b', n);
  const c = (n: number): string => issue('owner-c/repo-c', n);
  const commitB = 'https://github.com/owner-b/repo-b/commit/1234567abc';
  const rows = (table: [string, [string, string | null][]][]): void => {
    for (const [text, expected] of table) expect(links(text, HOME), text).toEqual(expected);
  };
  /** `text`, then a second source naming #12 in owner-c/repo-c, and a bare #12. */
  const second = (text: string): [string, [string, string | null][]] => [
    `${text}; owner-c/repo-c#12 and #12`, [['owner-c/repo-c#12', c(12)], ['#12', null]],
  ];
  /** `text`, then a pull page of owner-c/repo-c's #12, and a bare #12. */
  const page = (text: string): [string, [string, string | null][]] => [
    `${text}; https://github.com/owner-c/repo-c/pull/12 and #12`, [['#12', null]],
  ];

  it('A1, P2 and the spaced -s -R: a command with no number of its own claims no repository flag', () => {
    rows([
      // A glued run before the number takes no next word, so the repository is a positional and the number is past them.
      second('gh pr merge -sR owner-b/repo-b 12'),
      second('gh pr merge -sdR owner-b/repo-b 12'),
      second('gh -dR owner-b/repo-b pr view 12'),
      page('gh pr merge -sR owner-b/repo-b 12'),
      page('gh -dR owner-b/repo-b pr view 12'),
      // The spaced -s takes -R as its value (main's hole).
      second('gh pr merge -s -R owner-b/repo-b 12'),
      page('gh pr merge -s -R owner-b/repo-b 12'),
      // A value flag that swallows the number (P2).
      second('gh pr merge -s 12 -R owner-b/repo-b'),
      second('gh pr merge -m 12 -R owner-b/repo-b'),
      second('gh pr list -e 12 --repo owner-b/repo-b'),
      page('gh pr merge -s 12 --repo=owner-b/repo-b'),
      // Controls, as before: the run after the number; -R, --repo and a run before it.
      second('gh pr merge 12 -sR owner-b/repo-b'),
      second('gh pr merge -R owner-b/repo-b 12'),
      second('gh pr merge --repo owner-b/repo-b 12'),
      second('gh pr merge -dR owner-b/repo-b 12'),
      ['gh pr merge -R owner-b/repo-b 12 and #12', [['#12', b(12)]]],
      ['gh pr merge 12 -sR owner-b/repo-b and #12', [['#12', null]]],
      // A command that gives its number keeps its flags: another command's number is still decided by its own.
      ['gh pr view 12 -R owner-b/repo-b; gh pr view 13 -R owner-c/repo-c; #12 and #13', [['#12', b(12)], ['#13', c(13)]]],
      // The accepted cost: a numberless command's flag is a candidate for every number, so this owner-c link is text now.
      ['gh pr list -R owner-b/repo-b; gh pr view 13 -R owner-c/repo-c; #13', [['#13', null]]],
      // Its own repository still names one.
      ['gh pr list -R owner-b/repo-b; gh pr view 13 -R owner-b/repo-b; #13', [['#13', b(13)]]],
      // A gh api path is no repository flag: a path its command read stays that command's, with a number or without one
      // (c23.md, api-path-claim-unchanged).
      ['gh api repos/owner-b/repo-b; gh pr view 13 -R owner-c/repo-c; #13', [['#13', c(13)]]],
    ]);
  });

  it('P1: a line continuation is whitespace inside a gh command, so a flag on the first line is the next line\'s number\'s', () => {
    rows([
      ['gh pr view --repo owner-b/repo-b \\\n12\nowner-c/repo-c#12 and #12', [['owner-c/repo-c#12', c(12)], ['#12', null]]],
      ['gh -R owner-b/repo-b \\\npr view 12\nowner-c/repo-c#12 and #12', [['owner-c/repo-c#12', c(12)], ['#12', null]]],
      ['gh pr view --repo owner-b/repo-b \\\r\n12\r\nowner-c/repo-c#12 and #12', [['owner-c/repo-c#12', c(12)], ['#12', null]]],
      // With no second source the command's repository is the number's: a link, where it was text.
      ['gh pr view --repo owner-b/repo-b \\\n12\n#12', [['#12', b(12)]]],
      ['gh -R owner-b/repo-b \\\npr view 12\n#12', [['#12', b(12)]]],
      ['gh pr view --repo owner-b/repo-b \\\r\n12\r\n#12', [['#12', b(12)]]],
      // Controls: a backslash not at a line's end is a word; a line break with no backslash still ends the command.
      ['gh pr view 12 \\ -R owner-b/repo-b and #12', [['#12', null]]],
      ['gh pr view --repo owner-b/repo-b\n12 and #12', [['#12', null]]],
    ]);
  });

  it('A2: a gh word where a flag value stands ends the command, and the command it ends gives its number to no repository', () => {
    rows([
      page('gh pr view 12 --title GH -R owner-b/repo-b'),
      ['gh pr view 12 --title GH -R owner-b/repo-b and #12', [['#12', null]]],
      page('gh pr view 12 --title Gh -R owner-b/repo-b'),
      page('gh pr view 12 --title gh.exe -R owner-b/repo-b'),
      page('gh pr view 12 --title GH.EXE -R owner-b/repo-b'),
      page('gh pr view 12 --title gh -R owner-b/repo-b'),
      second('gh issue edit 12 --add-label GH -R owner-b/repo-b'),
      second('gh pr comment -b GH 12 -R owner-b/repo-b'),
      // The void command's number is unknown even where the command after it gives a number of its own.
      second('gh pr view 12 --title GH pr view 13 -R owner-b/repo-b'),
      second('gh pr view 12 --title GH'),
      // A cut command with no flag at all gives its number to no repository: home on main, text now (c23.md).
      ['gh pr view 12 --title gh\n#12', [['#12', null]]],
      // A flag read before the cut does not save the number; an api command cut after its path gives the path's number to no
      // repository too.
      ['gh pr view 12 -R owner-b/repo-b --title GH and #12', [['#12', null]]],
      ['gh api repos/owner-b/repo-b/pulls/12 --jq GH and #12', [['#12', null]]],
      // Controls: a quoted value is a value and reads normally; a gh word where no value is expected ends the command, which
      // keeps its number.
      ['gh pr view 12 --title "GH" -R owner-b/repo-b and #12', [['#12', b(12)]]],
      second('gh pr view 12 --title "GH" -R owner-b/repo-b'),
      ['gh pr view 12 -R owner-b/repo-b gh pr view 13 -R owner-c/repo-c; #12 and #13', [['#12', b(12)], ['#13', c(13)]]],
    ]);
  });

  const wordPrefixes = ['gh ', 'gh pr view 12 '];
  const wordUnits = ['-R ', '--repo ', '-R a ', "'-R' "];
  it('L2-1: one command holding many flag words reads in linear time, with no spread into call arguments (c23.md)', () => {
    for (const prefix of wordPrefixes) {
      for (const unit of wordUnits) {
        const text = `${prefix}${unit.repeat(Math.ceil((1 << 20) / unit.length))}`;
        const t = performance.now();
        const said = messageRepos(text);
        expect(performance.now() - t, `${prefix}${unit}`).toBeLessThan(GH_FLAG_RUN_BOUND_MS);
        expect(said.named.size, `${prefix}${unit}`).toBeLessThanOrEqual(3);
      }
    }
  }, largeTimeout(wordPrefixes.length * wordUnits.length, GH_FLAG_RUN_BOUND_MS));

  it('L3-1: a quoted value that names the command\'s own repository leaves it the number\'s', () => {
    rows([['gh pr comment 12 -R owner-b/repo-b --body "--repo=owner-b/repo-b" and #12', [['#12', b(12)]]]]);
  });

  it('L3-5: an unclaimed flag is a candidate for a commit the message gives a repository, as for a number', () => {
    rows([
      [`${commitB}; gh pr list; cp -R owner-c/repo-c /x; 1234567abc`, [['1234567abc', null]]],
      [`${commitB}; gh pr list; cp -R owner-c/repo-c /x; 1234567a`, [['1234567a', null]]],
      // Two candidates, the first the address's own: still two repositories.
      [`${commitB}; gh pr list; cp -R owner-b/repo-b /x; cp -R owner-c/repo-c /y; 1234567abc`, [['1234567abc', null]]],
      // Controls: no unclaimed flag, or one naming the address's own repository, leaves the address's repository.
      [`${commitB}; gh pr list; 1234567abc`, [['1234567abc', `${commitB}`]]],
      [`${commitB}; gh pr list; cp -R owner-b/repo-b /x; 1234567abc`, [['1234567abc', `${commitB}`]]],
      // A qualified name in the same message still opens its own repository (rule 1).
      [`${commitB}; gh pr list; cp -R owner-c/repo-c /x; 1234567abc and owner-b/repo-b#12`,
        [['1234567abc', null], ['owner-b/repo-b#12', b(12)]]],
    ]);
  });

  it('review 1795 F1, C2, C3: a continuation is read as the shell reads it', () => {
    const lf = (t: string): string => t;
    const crlf = (t: string): string => t.replaceAll('\\\n', '\\\r\n');
    for (const nl of [lf, crlf]) {
      rows([
        // F1: glued inside a word, it joins the two halves (the shell deletes the pair); it never closes the word.
        [nl('gh pr view 12 -R owner-b/repo\\\n-b and #12'), [['#12', b(12)]]],
        [nl('gh pr view 12 -R org-a/project-a\\\nx; see https://github.com/owner-c/repo-c/pull/13 and #12'),
          [['#12', issue('org-a/project-ax', 12)]]],
        [nl('gh pr view 12 --repo=o/r.\\\n12 and #12'), [['#12', issue('o/r.12', 12)]]],
        [nl("gh pr view 12 -R 'owner-b/repo'\\\n-b and #12"), [['#12', b(12)]]],
        // The joined value names #12 in owner-b, a second source in owner-c: text.
        [nl('gh pr view 12 -R owner-b/repo\\\n-b; owner-c/repo-c#12 and #12'), [['owner-c/repo-c#12', c(12)], ['#12', null]]],
        // C3: a continuation inside a flag's spelling joins it too.
        [nl('gh pr view 12 -\\\nR owner-b/repo-b and #12'), [['#12', b(12)]]],
        [nl('gh pr view 12 --re\\\npo owner-b/repo-b and #12'), [['#12', b(12)]]],
        // An odd run is a continuation: two of its backslashes are one escaped backslash, and the third joins.
        [nl('gh pr view 12 -R owner-b/repo\\\\\\\n-b and #12'), [['#12', null]]],
      ]);
    }
    rows([
      // C2: an even run is escaped backslashes, so the line break ends the command, as on main.
      ['gh pr list -R owner-b/repo-b --title x\\\\\n12\n#12', [['#12', null]]],
      ['gh pr view 12 --body foo\\\\\n-R owner-b/repo-b and #12', [['#12', null]]],
      ['gh pr view 12 -R owner-b/repo-b --title x\\\\\n#12', [['#12', b(12)]]],
      // The next line's flag is no word of the command the line break ended.
      ['gh pr view 12 --title x\\\\\n -R owner-b/repo-b\n#12', [['#12', null]]],
      ['gh pr view 12 --title x\\\\\r\n -R owner-b/repo-b\r\n#12', [['#12', null]]],
    ]);
  });

  it('review 1795 F2: a gh api commits path names its sha in its repository, as a pulls path names a number', () => {
    rows([
      ['gh api repos/owner-b/repo-b/commits/1234567abc; https://github.com/owner-c/repo-c/commit/1234567abc and 1234567abc',
        [['1234567abc', null]]],
      ['gh api repos/owner-b/repo-b/commits/1234567abc and 1234567abc', [['1234567abc', `${commitB}`]]],
      ['gh api /repos/owner-b/repo-b/commits/1234567ABC and 1234567a',
        [['1234567a', 'https://github.com/owner-b/repo-b/commit/1234567a']]],
      // A lost or cut command gives its sha to no repository.
      ["gh api repos/owner-b/repo-b/commits/1234567abc --jq 'x and 1234567abc", [['1234567abc', null]]],
      ['gh api repos/owner-b/repo-b/commits/1234567abc --jq GH and 1234567abc', [['1234567abc', null]]],
      // A sub-path after the sha names it too (fix round 2, review 1800 B: this row opened owner-c until then), so the sha is
      // named in two repositories: text.
      ['gh api repos/owner-b/repo-b/commits/1234567abc/comments; https://github.com/owner-c/repo-c/commit/1234567abc and 1234567abc',
        [['1234567abc', null]]],
      // Recorded (api-path-claim-unchanged): a numberless pulls path stays its command's, so the address decides.
      ["gh api repos/owner-b/repo-b/pulls --jq '.[] | select(.number==12)'; https://github.com/owner-c/repo-c/pull/12 and #12",
        [['#12', c(12)]]],
    ]);
  });

  it('review 1795 F5: the commit-candidate loop stays linear over many commit addresses', () => {
    const head = 'gh pr list; cp -R owner-b/repo-b /x; cp -R owner-c/repo-c /y; ';
    const parts: string[] = [];
    for (let i = 0, size = head.length; size < GH_COMMIT_CANDIDATES_BYTES; i += 1) {
      const part = `https://github.com/owner-d/repo-d/commit/a${i.toString(16).padStart(9, '0')} `;
      parts.push(part);
      size += part.length;
    }
    const text = head + parts.join('');
    const t = performance.now();
    const said = messageRepos(text);
    expect(performance.now() - t).toBeLessThan(GH_COMMIT_CANDIDATES_BOUND_MS);
    expect(said.commits.sorted.length).toBe(parts.length * 3);
  }, largeTimeout(1, GH_COMMIT_CANDIDATES_BOUND_MS));

  it('review 1800 A: the net reads the message as the shell joins it, so a split flag spelling is read in every context', () => {
    const lf = (t: string): string => t;
    const crlf = (t: string): string => t.replaceAll('\\\n', '\\\r\n');
    for (const nl of [lf, crlf]) {
      for (const ctx of [HOME, CROSS]) {
        // A gh api command claims only its path, so its split flag is a candidate for the path's commit and number.
        expect(links(nl('gh api repos/org-a/project-a/commits/1234567abc -\\\nR owner-b/repo-b and 1234567abc'), ctx))
          .toEqual([['1234567abc', null]]);
      }
      rows([
        [nl('gh api repos/owner-c/repo-c/commits/1234567abc --re\\\npo owner-b/repo-b and 1234567abc'), [['1234567abc', null]]],
        [nl('gh pr list -\\\nR owner-b/repo-b; gh api repos/owner-c/repo-c/commits/1234567abc and 1234567abc'),
          [['1234567abc', null]]],
        // The same shapes before this round: a numberless command, another program's flag, a gh api pulls path (R2 too).
        [nl('gh pr list -\\\nR owner-b/repo-b; https://github.com/owner-c/repo-c/pull/12 and #12'), [['#12', null]]],
        [nl('gh pr view 12 && cp -\\\nR owner-b/repo-b x and #12'), [['#12', null]]],
        [nl('gh api repos/owner-c/repo-c/pulls/12 -\\\nR owner-b/repo-b and #12'), [['#12', null]]],
        [nl('gh pr list -\\\nR owner-b/repo-b; gh pr view 13 -R owner-c/repo-c; #13'), [['#13', null]]],
        // Controls: a split flag its command reads is that command's; the net still names a flag only in a gh message.
        [nl('gh pr view 12 -\\\nR owner-b/repo-b; gh pr view 13 -R owner-c/repo-c; #12 and #13'), [['#12', b(12)], ['#13', c(13)]]],
        [nl('cp -\\\nR owner-b/repo-b x and #12'), [['#12', home(12)]]],
        // A path its command read after a continuation is still that command's (the offset map).
        [nl('gh pr view 12 -\\\nR owner-b/repo-b; gh api repos/owner-c/repo-c/pulls/13; #12 and #13'), [['#12', b(12)], ['#13', c(13)]]],
      ]);
    }
  });

  it('review 1800 B: an API commits address and a commits sub-path name their sha, in a gh api path and in an address', () => {
    rows([
      ['gh api repos/owner-b/repo-b/commits/1234567abc; https://api.github.com/repos/owner-c/repo-c/commits/1234567abc and 1234567abc',
        [['1234567abc', null]]],
      ['gh api repos/owner-b/repo-b/commits/1234567abc; gh api repos/owner-c/repo-c/commits/1234567abc/status and 1234567abc',
        [['1234567abc', null]]],
      // An API commits address alone opens its own repository's commit; so do its sub-paths and git/commits.
      ['https://api.github.com/repos/owner-c/repo-c/commits/1234567abc and 1234567abc',
        [['1234567abc', 'https://github.com/owner-c/repo-c/commit/1234567abc']]],
      ['https://api.github.com/repos/owner-c/repo-c/commits/1234567abc/check-runs and 1234567abc',
        [['1234567abc', 'https://github.com/owner-c/repo-c/commit/1234567abc']]],
      ['gh api repos/owner-b/repo-b/git/commits/1234567abc and 1234567abc', [['1234567abc', `${commitB}`]]],
      ['gh api repos/owner-b/repo-b/commits/1234567abc/pulls; https://api.github.com/repos/owner-c/repo-c/git/commits/1234567abc and 1234567abc',
        [['1234567abc', null]]],
      // A sha the boundary does not end is none.
      ['https://api.github.com/repos/owner-c/repo-c/commits/1234567abcx and 1234567abc', [['1234567abc', null]]],
      // A commits or pulls path that runs on into a word names no sha and no number.
      ['gh api repos/owner-b/repo-b/commits/1234567abcz and 1234567abc', [['1234567abc', null]]],
      ['gh api repos/owner-b/repo-b/pulls/12x and #12', [['#12', null]]],
      // Read in any case, kept in lower case.
      ['https://api.github.com/repos/owner-c/repo-c/commits/1234567ABC and 1234567abc',
        [['1234567abc', 'https://github.com/owner-c/repo-c/commit/1234567abc']]],
      // Carried (c23.md): a blob page is no commit address yet, so the path's repository wins, as a commit page does on main.
      ['gh api repos/owner-b/repo-b/commits/1234567abc; https://github.com/owner-c/repo-c/blob/1234567abc/x.ts and 1234567abc',
        [['1234567abc', `${commitB}`]]],
    ]);
  });

  it('review 1800 F6: a commits path names a sha of 7 to 40 hex only, and each (repository, sha) pair once', () => {
    expect(messageRepos('gh api repos/owner-b/repo-b/commits/abc123').commits.sorted).toEqual([]);
    expect(messageRepos('gh api repos/owner-b/repo-b/commits/abc1234').commits.sorted.length).toBe(1);
    expect(messageRepos(`${commitB} and ${commitB} and gh api repos/owner-b/repo-b/commits/1234567abc`).commits.sorted.length)
      .toBe(1);
  });

  it('review 1800 F5-gap: many distinct unclaimed flags beside many commit addresses stay linear', () => {
    const parts: string[] = ['gh pr list; '];
    let size = parts[0]!.length;
    let n = 0;
    for (; size < GH_COMMIT_CANDIDATES_BYTES; n += 1) {
      const part = `-R o/r${n.toString(36)} github.com/o/r/commit/a${n.toString(16).padStart(6, '0')} `;
      parts.push(part);
      size += part.length;
    }
    const t = performance.now();
    const said = messageRepos(parts.join(''));
    expect(performance.now() - t).toBeLessThan(GH_COMMIT_CANDIDATES_BOUND_MS);
    // Each commit takes its page's repository and at most two candidates.
    expect(said.commits.sorted.length).toBe(n * 3);
  }, largeTimeout(1, GH_COMMIT_CANDIDATES_BOUND_MS));

  it('L2-2: a value the net cuts at the next flag names an unknown repository, never home', () => {
    rows([
      ['gh pr list; -R org-a/project-a.-R=org-a/project-a; #12', [['#12', null]]],
      // Controls: values that end before the next flag read as before.
      ['gh pr list; -R org-a/project-a -R=org-a/project-a; #12', [['#12', home(12)]]],
      ['gh pr list; -R org-a/project-a; #12', [['#12', home(12)]]],
      // A value that ends at the text's end is whole, not cut.
      ['#12; gh pr list -R org-a/project-a', [['#12', home(12)]]],
    ]);
  });
});

describe('Task C24: the net reads the raw and the joined text, and reads quotes as the shell does (review 1808)', () => {
  const home = (n: number): string => issue('org-a/project-a', n);
  const b = (n: number): string => issue('owner-b/repo-b', n);
  const c = (n: number): string => issue('owner-c/repo-c', n);
  const lf = (t: string): string => t;
  const crlf = (t: string): string => t.replaceAll('\\\n', '\\\r\n');
  const rows = (ctx: ChatRefContext, table: [string, [string, string | null][]][]): void => {
    for (const [text, expected] of table) expect(links(text, ctx), `${ctx.runsElsewhere ? 'CROSS' : 'HOME'}: ${text}`).toEqual(expected);
  };

  it('F1: a continuation glued to the word before a flag or a repos/ word no longer hides what the raw text names', () => {
    for (const nl of [lf, crlf]) {
      for (const ctx of [HOME, CROSS]) {
        rows(ctx, [
          [nl('gh pr view 12 --title foo\\\n--repo owner-b/repo-b and #12'), [['#12', null]]],
          [nl('gh pr comment\\\n-R owner-b/repo-b and #12'), [['#12', null]]],
          [nl('gh pr list; see\\\nrepos/owner-b/repo-b/pulls/12 and #12'), [['#12', null]]],
          // The shell reads `owner-b/repo-b--repo`, a repository nobody means: the raw reading names org-a/project-a too.
          [nl('gh pr view 12 -R owner-b/repo-b\\\n--repo org-a/project-a; #12'), [['#12', null]]],
        ]);
        // Controls: a space before the backslash, or an indented next line, keeps the flag a word of its own: the command's.
        // A path its command read stays that command's in both readings, each walking the claims with its own cursor.
        rows(ctx, [
          [nl('gh api repos/owner-b/repo-b/pulls/12; gh api repos/owner-c/repo-c/pulls/13 \\\nand #12 and #13'), [['#12', b(12)], ['#13', c(13)]]],
          [nl('gh pr view 12 --title foo \\\n--repo owner-b/repo-b and #12'), [['#12', b(12)]]],
          [nl('gh pr view 12 --title foo\\\n  --repo owner-b/repo-b and #12'), [['#12', b(12)]]],
        ]);
      }
    }
    // The review's generated class: a word character, then a continuation, then a flag or a path, gives text in a home session.
    const tails = ['--repo owner-b/repo-b', '--repo=owner-b/repo-b', '-R owner-b/repo-b', '-Rowner-b/repo-b', '-R=owner-b/repo-b',
      '-sR owner-b/repo-b', "--repo 'owner-b/repo-b'", 'repos/owner-b/repo-b/pulls/12', '/repos/owner-b/repo-b/pulls/12'];
    for (const before of ['foo', 'x1', 'x-']) {
      for (const tail of tails) {
        for (const head of ['gh pr view 12 --title ', 'gh pr list; see ']) {
          for (const nl of ['\\\n', '\\\r\n']) {
            const text = `${head}${before}${nl}${tail} and #12`;
            expect(links(text, HOME), text).toEqual([['#12', null]]);
          }
        }
      }
    }
  });

  it('F2: an api.github.com address split before repos/ or its slash gives text, and so does one split anywhere else', () => {
    for (const nl of [lf, crlf]) {
      for (const ctx of [HOME, CROSS]) {
        rows(ctx, [
          [nl('gh pr view 12 -R owner-b/repo-b; curl https://api.github.com/\\\nrepos/owner-c/repo-c/pulls/12; #12'), [['#12', null]]],
          [nl('gh pr view 12 -R owner-b/repo-b; curl https://api.github.com\\\n/repos/owner-c/repo-c/pulls/12; #12'), [['#12', null]]],
          [nl('gh api repos/owner-b/repo-b/commits/1234567abc; curl https://api.github.com/\\\nrepos/owner-c/repo-c/commits/1234567abc and 1234567abc'),
            [['1234567abc', null]]],
          [nl('https://github.com/owner-b/repo-b/pull/12; gh api https://api.github.com/\\\nrepos/owner-c/repo-c/pulls/12; #12'),
            [['#12', null]]],
          // The address readers' older gap: an address split elsewhere is read joined as well as raw, so it names its number.
          [nl('gh pr view 12 -R owner-b/repo-b; curl https://api.github.com/repos/owner-c/re\\\npo-c/pulls/12; #12'), [['#12', null]]],
          [nl('https://github.com/owner-b/repo-b/pull/12; https://github.com/owner-c/repo-c/pu\\\nll/12; #12'), [['#12', null]]],
        ]);
      }
      rows(HOME, [
        [nl('gh pr checks; curl https://api.github.com\\\n/repos/owner-c/repo-c/pulls/12; #12'), [['#12', null]]],
        // What only the joined reading finds may only add: a split address alone names owner-c, but gives #12 no repository.
        [nl('see https://github.com/owner-c/repo-c/pu\\\nll/12 and #12'), [['#12', null]]],
        [nl('see https://github.com/owner-c/repo-c/commit/1234\\\n567abc and 1234567abc'), [['1234567abc', null]]],
        // It adds a repository to a name the raw reading gives one: the same one leaves the link, another makes it text.
        [nl('https://github.com/owner-c/repo-c/pull/12; https://github.com/owner-c/repo-c/pu\\\nll/12 and #12'), [['#12', c(12)]]],
        // A joined number the name boundary does not end is none, as in the raw reading.
        [nl('https://github.com/owner-b/repo-b/pull/12; https://github.com/owner-c/repo-c/pu\\\nll/12x and #12'), [['#12', b(12)]]],
        [nl('https://github.com/owner-b/repo-b/commit/1234567abc; https://github.com/owner-c/repo-c/commit/1234\\\n567abc and 1234567abc'),
          [['1234567abc', null]]],
        [nl('https://github.com/owner-c/repo-c/commit/1234567abc; https://github.com/owner-c/repo-c/commit/1234\\\n567abc and 1234567abc'),
          [['1234567abc', 'https://github.com/owner-c/repo-c/commit/1234567abc']]],
      ]);
    }
  });

  it('F3: a continuation inside single quotes or $\'..\' is not joined, as in the shell; inside double quotes it is', () => {
    for (const ctx of [HOME, CROSS]) {
      rows(ctx, [
        ["gh pr list -R 'org-a/proj\\\nect-a'; #12", [['#12', null]]],
        ["gh pr list -R $'org-a/proj\\\nect-a'; #12", [['#12', null]]],
        ["gh pr list -R'org-a/proj\\\nect-a'; #12", [['#12', null]]],
      ]);
    }
    // Read through the address readers: owner-b's page names #12, and a split owner-c page adds owner-c to it only where it
    // is joined, which makes #12 text. Unjoined (in single quotes) it names no number, so #12 opens owner-b.
    const pull = 'https://github.com/owner-c/repo-c/pu\\\nll/12';
    const withB = (t: string): string => `https://github.com/owner-b/repo-b/pull/12; ${t} and #12`;
    for (const nl of [lf, crlf]) {
      rows(HOME, ([
      [withB(`'${pull}'`), [['#12', b(12)]]],
      [withB(`$'${pull}'`), [['#12', b(12)]]],
      [withB(`"${pull}"`), [['#12', null]]],
      [withB(pull), [['#12', null]]],
      // In $'..' a backslash escapes the quote after it, so the span goes on; in '..' it does not.
      [withB(`$'it\\'s ${pull}'`), [['#12', b(12)]]],
      [withB(`'x\\' ${pull}`), [['#12', null]]],
      // A quote between two letters is prose, and a quote no closing one follows before a bare line break is a character.
      [withB(`it's at ${pull}, don't`), [['#12', null]]],
      [`${withB(`'tis ${pull}`)}\nthe end'`, [['#12', null]]],
      // An escaped quote opens nothing; a span's closing quote opens no other.
      [withB(`\\'${pull}'`), [['#12', null]]],
      [withB(`'x' ${pull} 'y'`), [['#12', null]]],
    ] as [string, [string, string | null][]][]).map(([t, e]) => [nl(t), e]));
    }
  });

  it('F4: a word glued after a closing quote belongs to the value, as the shell glues it', () => {
    for (const nl of [lf, crlf]) {
      rows(HOME, [
        [nl("cp -R 'org-a/project-a'x /y; gh pr list; #12"), [['#12', null]]],
        [nl("gh pr list; cp -R \\\n'org-a/project-a'\\\n-x /y; #12"), [['#12', null]]],
        [nl('gh pr list -R "org-a/\\\nproject-a"x; #12'), [['#12', null]]],
        [nl("gh pr list -R 'org-a/project-a'x; #12"), [['#12', null]]],
        [nl("gh pr list; -R='org-a/project-a'1; #12"), [['#12', null]]],
        // Controls: the value alone, and prose punctuation after the quote, still name the home repository.
        [nl("gh pr list -R 'org-a/project-a'; #12"), [['#12', home(12)]]],
        [nl("gh pr list; cp -R 'org-a/project-a' /y; #12"), [['#12', home(12)]]],
        [nl("gh pr list; cp -R 'org-a/project-a'. Then #12"), [['#12', home(12)]]],
        [nl("gh pr list; cp -R 'org-a/project-a'), then #12"), [['#12', home(12)]]],
      ]);
    }
    expect([...messageRepos("gh pr list; cp -R 'owner-b/repo-b'x /y").named]).toContain('owner-b/repo-bx');
  });

  it('M5: the address, GH_REPO, qualified-name and gh-word readers read the joined text as well as the raw', () => {
    for (const nl of [lf, crlf]) {
      rows(HOME, [
        [nl('G\\\nH_REPO=owner-b/repo-b; gh pr list -R \\\norg-a/project-a; #12'), [['#12', null]]],
        // Control: without GH_REPO the shell reads only the home repository; so with the continuation glued after -R or =.
        [nl('gh pr list -R \\\norg-a/project-a; #12'), [['#12', home(12)]]],
        [nl('gh pr list -R\\\norg-a/project-a; #12'), [['#12', home(12)]]],
        [nl('gh pr list -R=\\\norg-a/project-a; #12'), [['#12', home(12)]]],
        // A gh word the join forms makes the net run (review 1800 F3, which opened home): its flag names owner-b.
        [nl('g\\\nh pr view 12 -R owner-b/repo-b and #12'), [['#12', null]]],
        [nl('g\\\nh api repos/owner-b/repo-b/commits/1234567abc; https://api.github.com/repos/owner-c/repo-c/commits/1234567abc and 1234567abc'),
          [['1234567abc', null]]],
        // A qualified name split by a continuation names its repository, and adds it to a number the raw reading gives one.
        [nl('owner-b/re\\\npo-b#12 and #12'), [['#12', null]]],
        [nl('owner-b/re\\\npo-b#12; https://github.com/owner-c/repo-c/pull/12 and #12'), [['#12', null]]],
        [nl('owner-b/re\\\npo-b#12; https://github.com/owner-b/repo-b/pull/12 and #12'), [['#12', b(12)]]],
      ]);
    }
  });

  it('M6 and M8: owner/repo@sha is not read; repro 1\'s other shapes give text in a cross session too', () => {
    expect(links('Fixed in org-b/project-b@abc1234.', HOME)).toEqual([['abc1234', 'https://github.com/org-a/project-a/commit/abc1234']]);
    expect(links('Fixed in org-b/project-b@abc1234.', CROSS)).toEqual([['abc1234', null]]);
    for (const nl of [lf, crlf]) {
      rows(CROSS, [
        [nl('gh api repos/owner-c/repo-c/commits/1234567abc --re\\\npo owner-b/repo-b and 1234567abc'), [['1234567abc', null]]],
        [nl('gh pr list -\\\nR owner-b/repo-b; gh api repos/owner-c/repo-c/commits/1234567abc and 1234567abc'),
          [['1234567abc', null]]],
      ]);
    }
  });

  const stormUnits = ["'\\\n", "$'\\'\\\n", "x'y\\\n'z ", "'a\\\\\n", '"\'\\\n', "-R 'o/r'x\\\n", '-R \\\n\\\n', "g\\\nh -R\\\n'o/r'\\\n "];
  it('the joined reading stays linear: quote, continuation and glued-tail storms at 1 MiB', () => {
    for (const unit of stormUnits) {
      const text = `gh pr view 12 ${unit.repeat(Math.ceil((1 << 20) / unit.length))}`;
      const t = performance.now();
      messageRepos(text);
      expect(performance.now() - t, unit).toBeLessThan(GH_FLAG_RUN_BOUND_MS);
    }
  }, largeTimeout(stormUnits.length, GH_FLAG_RUN_BOUND_MS));
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
