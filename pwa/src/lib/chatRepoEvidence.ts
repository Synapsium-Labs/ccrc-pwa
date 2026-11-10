// What one chat message says about GitHub repositories (desktop polish Task C21, D-8172; chat reading spec 2026-11-06 R15): the
// evidence `refHref` reads to decide which repository a bare `#n` or commit means, or that it means none it can tell. A session
// lives in one project but may coordinate runs whose work lands in other repositories, so the home repository is not the
// answer for every name: a wrong link is worse than no link, and where the code cannot tell, the answer is text.
//
// L1, Session Conversation: pure, no React, no store, no DOM. It reads the message's WHOLE raw text, code spans, link targets
// and fenced code included, because an address in a code span is exactly where a session writes the repository it means. Its
// scope is one chat event: an address in one message is no evidence for a name in the next (review 1758 F7). It is asked at
// render time and memoised per message by its caller, never in the parse worker: `chatMarks.ts` stays the grammar of names and
// imports nothing (`markdown-purity.test.ts`), and this module reads its qualified names and its one boundary from there (F6).
//
// Fix round 1 (review 1758): a repository spelled in a way the console's one grammar refuses is an UNKNOWN repository, never
// dropped, so it counts as "another repository" and a bare name beside it stays text (F1); the host match ignores case (F1); the
// SSH form, the API, raw and codeload hosts and `gh … --repo/-R` name a repository too (F2); one trailing-dot trim, linear, in
// `readRepo`, the one reader every address is built from (F4, F5).
import { parseGithubRepo, type GithubRepo } from '../../../shared/projectAdd';
import { qualifiedNames, wordAfter, wordBefore, type Mark } from './chatMarks';

/** A repository a message names: `named`, one the console's grammar reads, by its key (`repoKey`) and `owner/repo` for the
 *  address; or `unknown`, spelled where a repository stands but refused by that grammar, by a key of its own that is never a
 *  named one's. An unknown repository is never linked to, and is never the home one. */
export type SaidRepo =
  | { readonly kind: 'named'; readonly key: string; readonly slug: string }
  | { readonly kind: 'unknown'; readonly key: string };

/** A commit address: the repository it names and its SHA in lower case. */
interface SaidCommit {
  readonly repo: SaidRepo;
  readonly sha: string;
}

/** What one message names. `named`: every repository's key, unknown ones included. `numbers`: for a PR or issue number, each
 *  repository the message names that number in, by key. `commits`: the commit addresses, by the first seven characters of their
 *  SHA (every SHA the grammar reads has at least seven), so a commit name asks only the addresses that can share its prefix. */
export interface MessageRepos {
  readonly named: ReadonlySet<string>;
  readonly numbers: ReadonlyMap<number, ReadonlyMap<string, SaidRepo>>;
  readonly commits: ReadonlyMap<string, readonly SaidCommit[]>;
}

/** `slug` without its trailing dots (a sentence's full stop), by a backward scan: linear in the dots, where a `/\.+$/` replace
 *  is quadratic on a long dot run (review 1758 F5). */
function trimDots(slug: string): string {
  let end = slug.length;
  while (end > 0 && slug.charCodeAt(end - 1) === 0x2e) end -= 1;
  return slug.slice(0, end);
}

/** The repository `slug` names, read by the console's one GitHub grammar (`parseGithubRepo`: the short form, an https or SSH
 *  address, `.git` dropped) after one trim of trailing dots, or null where that grammar refuses it. The ONE reader every chat
 *  address is built from (`chatRefs.ts#githubPage`) and every key is taken from, so the two readers agree (review 1758 F4). */
export function readRepo(slug: string): GithubRepo | null {
  return parseGithubRepo(trimDots(slug));
}

/** The key two spellings of one repository share: `readRepo`'s owner and name in lower case, since GitHub's own names are
 *  case-insensitive. `null` for anything that grammar refuses. */
export function repoKey(slug: string): string | null {
  const gh = readRepo(slug);
  return gh === null ? null : `${gh.owner}/${gh.repo}`.toLowerCase();
}

/** A repository as a message spells it (`owner/repo`, or an address `readRepo` reads), as a said repository: named where
 *  `readRepo` reads it, else unknown. */
function said(raw: string): SaidRepo {
  const gh = readRepo(raw);
  return gh === null
    ? { kind: 'unknown', key: `?${raw.toLowerCase()}` }
    : { kind: 'named', key: `${gh.owner}/${gh.repo}`.toLowerCase(), slug: `${gh.owner}/${gh.repo}` };
}

/** A segment where an owner or a repository stands in an address: wider than the grammar, which decides (`said`). */
const SEG = '[\\w.-]+';
/** Not inside a longer host name or path (`notgithub.com`, `x.github.com`). */
const HOST_START = '(?<![\\w.-])';
/** A GitHub page: `github.com/<owner>/<repo>` with any scheme or `www.`, or the SSH form `git@github.com:<owner>/<repo>`, in any
 *  case; then, optionally, a pull, issue or commit page. */
const PAGE = new RegExp(
  `${HOST_START}(?:www\\.)?github\\.com[/:](${SEG})/(${SEG})(?:/(?:(?:pull|issues)/(\\d+)|commit/([0-9a-f]{7,40})))?`,
  'gi',
);
/** The REST API's repository address, and its pulls and issues. */
const API = new RegExp(`${HOST_START}api\\.github\\.com/repos/(${SEG})/(${SEG})(?:/(?:pulls|issues)/(\\d+))?`, 'gi');
/** The raw-file and archive hosts: they name a repository and no number. */
const RAW = new RegExp(`${HOST_START}(?:raw\\.githubusercontent|codeload\\.github)\\.com/(${SEG})/(${SEG})`, 'gi');
/** A `gh` command, up to the end of its line or the next `;`, `&` or `|`. */
const GH = /(?<![\w.-])gh\s+([^\n;&|]*)/g;
/** The repository flag of a `gh` command: `--repo o/r`, `--repo=o/r` or `-R o/r`, the value optionally quoted. */
const GH_REPO = /(?:^|\s)(?:--repo(?:=|\s+)|-R\s+)['"]?([^\s'"]+)/;
/** A `gh pr|issue <verb> <n>` command's number. */
const GH_NUMBER = /^(?:pr|issue)\s+[\w-]+\s+#?(\d+)(?![\w])/;

/** One message's evidence, read in one pass of each pattern over its raw text. */
export function messageRepos(text: string): MessageRepos {
  const named = new Set<string>();
  const numbers = new Map<number, Map<string, SaidRepo>>();
  const commits = new Map<string, SaidCommit[]>();
  const name = (r: SaidRepo): void => { named.add(r.key); };
  const atNumber = (n: string, r: SaidRepo): void => {
    const id = Number(n);
    const at = numbers.get(id) ?? new Map<string, SaidRepo>();
    if (!at.has(r.key)) at.set(r.key, r);
    numbers.set(id, at);
  };
  for (const m of text.matchAll(PAGE)) {
    if (wordBefore(text, m.index)) continue;
    const r = said(`${m[1]!}/${m[2]!}`);
    name(r);
    // A number or a SHA is evidence only where the name boundary ends it (`pull/12x` is not #12).
    if (wordAfter(text, m.index + m[0].length)) continue;
    if (m[3] !== undefined) atNumber(m[3], r);
    if (m[4] !== undefined) {
      const sha = m[4].toLowerCase();
      const at = commits.get(sha.slice(0, 7)) ?? [];
      at.push({ repo: r, sha });
      commits.set(sha.slice(0, 7), at);
    }
  }
  for (const m of text.matchAll(API)) {
    if (wordBefore(text, m.index)) continue;
    const r = said(`${m[1]!}/${m[2]!}`);
    name(r);
    if (m[3] !== undefined && !wordAfter(text, m.index + m[0].length)) atNumber(m[3], r);
  }
  for (const m of text.matchAll(RAW)) {
    if (!wordBefore(text, m.index)) name(said(`${m[1]!}/${m[2]!}`));
  }
  for (const m of text.matchAll(GH)) {
    const command = m[1]!;
    const flag = GH_REPO.exec(command);
    if (flag === null) continue;
    const r = said(flag[1]!);
    name(r);
    const n = GH_NUMBER.exec(command);
    if (n !== null) atNumber(n[1]!, r);
  }
  for (const q of qualifiedNames(text)) {
    const r = said(q.repo);
    name(r);
    atNumber(q.id, r);
  }
  return { named, numbers, commits };
}

/** The repositories `message` names for the bare PR or commit `mark`, by key: the pages of its number, or the commit addresses
 *  where one SHA is a prefix of the other. Empty for a run, an item or a document. */
export function reposFor(mark: Mark, message: MessageRepos): ReadonlyMap<string, SaidRepo> {
  if (mark.kind === 'pr') return message.numbers.get(Number(mark.id)) ?? new Map();
  if (mark.kind !== 'commit') return new Map();
  const sha = mark.id.toLowerCase();
  const out = new Map<string, SaidRepo>();
  for (const c of message.commits.get(sha.slice(0, 7)) ?? []) {
    if ((c.sha.startsWith(sha) || sha.startsWith(c.sha)) && !out.has(c.repo.key)) out.set(c.repo.key, c.repo);
  }
  return out;
}
