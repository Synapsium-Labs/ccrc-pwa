// What one chat message says about GitHub repositories (desktop polish Task C21, D-8172; chat reading spec 2026-11-06 R15): the
// evidence `refHref` reads to decide which repository a bare `#n` or commit means, or that it means none it can tell. A session
// lives in one project but may coordinate runs whose work lands in other repositories, so the home repository is not the
// answer for every name: where the code cannot tell, the answer is text.
//
// L1, Session Conversation: pure, no React, no store, no DOM. It reads the message's WHOLE raw text, code spans, link targets
// and fenced code included, because an address in a code span is exactly where a session writes the repository it means. Its
// scope is one chat event: an address in one message is no evidence for a name in the next (review 1758 F7). It is asked at
// render time and memoised per message by its caller, never in the parse worker: `chatMarks.ts` stays the grammar of names and
// imports nothing (`markdown-purity.test.ts`), and this module reads its qualified names and its one boundary from there.
//
// It is also the ONE reader of a repository the chat names (review 1760 F7): `readRepo` reads every spelling, and
// `qualifiedRepo` decides a qualified name (`owner/repo#n`) after that read, with the exceptions below, for rule 1 and for the
// evidence alike. A repository spelled where one stands but refused by the grammar, by an exception or by a host the name
// boundary does not start is UNKNOWN: never linked, never home, and a bare name beside it stays text (reviews 1758 F1,
// 1760 F2 and F5).
import { parseGithubRepo, type GithubRepo } from '../../../shared/projectAdd';
import { qualifiedNames, wordAfter, wordBefore } from './chatMarks';

/** A repository a message names: `named`, one the console's grammar reads, by its key (`repoKey`) and `owner/repo` for the
 *  address; or `unknown`, spelled where a repository stands but not one the chat can tell, by a key of its own that is never a
 *  named one's. An unknown repository is never linked to, and is never the home one. */
export type SaidRepo =
  | { readonly kind: 'named'; readonly key: string; readonly slug: string }
  | { readonly kind: 'unknown'; readonly key: string };

/** A commit address: the repository it names and its SHA in lower case. */
interface SaidCommit {
  readonly repo: SaidRepo;
  readonly sha: string;
}

/** A message's commit addresses, each (repository, SHA) once (review 1760 F9), indexed so that a commit name costs the same
 *  however many addresses share its prefix (review 1762 F5): `exact`, each SHA's repositories by key; `sorted`, every address
 *  in SHA order, so the addresses whose SHA starts with a name's are one range; and `nextOther[i]`, the first index past `i`
 *  whose repository is not `sorted[i]`'s (`sorted.length` where none is), so a range tells one repository from two at once. */
interface CommitIndex {
  readonly exact: ReadonlyMap<string, ReadonlyMap<string, SaidRepo>>;
  readonly sorted: readonly SaidCommit[];
  readonly nextOther: readonly number[];
}

/** What one message names. `named`: every repository's key, unknown ones included. `numbers`: for a PR or issue number, each
 *  repository the message names that number in, by key. `commits`: the commit addresses (`CommitIndex`). */
export interface MessageRepos {
  readonly named: ReadonlySet<string>;
  readonly numbers: ReadonlyMap<number, ReadonlyMap<string, SaidRepo>>;
  readonly commits: CommitIndex;
}

/** `slug` without its trailing dots (a sentence's full stop), by a backward scan: linear in the dots, where a `/\.+$/` replace
 *  is quadratic on a long dot run (review 1758 F5). */
function trimDots(slug: string): string {
  let end = slug.length;
  while (end > 0 && slug.charCodeAt(end - 1) === 0x2e) end -= 1;
  return slug.slice(0, end);
}

/** The repository `slug` names, read by the console's one GitHub grammar (`parseGithubRepo`: the short form, an https or SSH
 *  address, `.git` dropped) after one trim of trailing dots, or null where that grammar refuses it. Every chat address is built
 *  from it (`chatRefs.ts#githubPage`) and every key is taken from it, so the readers agree (review 1758 F4). */
export function readRepo(slug: string): GithubRepo | null {
  return parseGithubRepo(trimDots(slug));
}

/** The key two spellings of one repository share: `readRepo`'s owner and name in lower case, since GitHub's own names are
 *  case-insensitive. `null` for anything that grammar refuses. */
export function repoKey(slug: string): string | null {
  const gh = readRepo(slug);
  return gh === null ? null : `${gh.owner}/${gh.repo}`.toLowerCase();
}

/** The file extensions a qualified name's repository may not end in, once `readRepo` has read it (`src/lib/x.ts#12` is a path
 *  and a line, not a PR; reviews 1758 F3 and 1760 F3). Lower case, compared in lower case after the last dot. A list, so an
 *  extension it does not hold still reads as a repository. */
const FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'md', 'mdx', 'yml', 'yaml', 'json', 'sh', 'py', 'txt', 'html', 'css', 'toml', 'sql',
  'log', 'csv', 'lock', 'go', 'rs', 'rb', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'pl', 'lua', 'vue',
  'svelte', 'scss', 'less', 'svg', 'png', 'jpg', 'pdf', 'xml', 'ini', 'conf', 'cfg', 'env',
]);

/** Whether a read repository is refused as a qualified name's (review 1758 F3, option b): its name ends in a listed file
 *  extension, its owner or name is all digits or one character (`1/2#3`, `24/7#1`, `abc1234/x#5`), or both are upper case only
 *  (`TCP/IP#4`, `N/A#1`). What is left follows GitHub's own `owner/repo#n` notation without knowing that the repository exists,
 *  so a prose pair such as `client/server#1` still reads as one and may open a real but unrelated page (spec R15). */
function refusedAsQualified(gh: GithubRepo): boolean {
  const dot = gh.repo.lastIndexOf('.');
  if (dot >= 0 && FILE_EXTENSIONS.has(gh.repo.slice(dot + 1).toLowerCase())) return true;
  const slight = (seg: string): boolean => seg.length === 1 || /^\d+$/.test(seg);
  const upper = (seg: string): boolean => !/[a-z]/.test(seg) && /[A-Z]/.test(seg);
  return slight(gh.owner) || slight(gh.repo) || (upper(gh.owner) && upper(gh.repo));
}

const unknown = (raw: string): SaidRepo => ({ kind: 'unknown', key: `?${raw.toLowerCase()}` });

/** A repository as a message spells it (`owner/repo`, or an address `readRepo` reads): named where `readRepo` reads it, else
 *  unknown. */
function said(raw: string): SaidRepo {
  const gh = readRepo(raw);
  return gh === null ? unknown(raw) : { kind: 'named', key: `${gh.owner}/${gh.repo}`.toLowerCase(), slug: `${gh.owner}/${gh.repo}` };
}

/** A qualified name's repository (`owner/repo` of `owner/repo#n`), decided once for rule 1 and for the evidence: named where
 *  `readRepo` reads it and no exception refuses what it read, else unknown (review 1760 F2 and F7). */
export function qualifiedRepo(raw: string): SaidRepo {
  const gh = readRepo(raw);
  return gh === null || refusedAsQualified(gh) ? unknown(raw) : said(raw);
}

/** The first path segments of a `github.com` page that are GitHub's own pages, never an owner (review 1762 F8):
 *  `github.com/orgs/org-x/projects/3` and `github.com/user-attachments/assets/…` name no repository, so a bare name beside
 *  them is decided as if they were absent. Compared in lower case. */
const RESERVED_OWNERS: ReadonlySet<string> = new Set([
  'orgs', 'user-attachments', 'settings', 'marketplace', 'sponsors', 'features', 'topics', 'collections', 'notifications',
  'login', 'apps', 'enterprises',
]);

/** A segment where an owner or a repository stands in an address: wider than the grammar, which decides (`said`). */
const SEG = '[\\w.-]+';
/** Not inside a longer host name (`x.github.com`, `my-github.com`). A letter, digit or `_` directly before a host is the name
 *  boundary's to judge (`wordBefore`), and makes an unknown repository (review 1760 F5 and F12). */
const HOST_START = '(?<![.-])';
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
/** The path of `gh api`, with or without its leading slash, and its pulls and issues, ending at the word's end, `/`, `?` or `#`. */
const GH_API_PATH = new RegExp(`^/?repos/(${SEG})/(${SEG})(?:/(?:pulls|issues)/(\\d+)(?=$|[/?#]))?`);
/** `GH_REPO=o/r`, the environment `gh` reads its repository from. */
const GH_REPO_ENV = /GH_REPO=(['"]?)([^\s'"`;&|]+)/g;

/** One word of a `gh` command: its text with quotes removed, and whether any of it was quoted. */
interface Word {
  readonly text: string;
  readonly quoted: boolean;
}

/** Whether the character at `at` ends a `gh` command, outside quotes (review 1760 F1): a backtick, a line break, `;`, `&`, `|`, or
 *  prose punctuation (a comma or full stop followed by a space or the text's end). */
function endsCommand(text: string, at: number): boolean {
  const c = text.charAt(at);
  if (c === '`' || c === '\n' || c === ';' || c === '&' || c === '|') return true;
  if (c !== ',' && c !== '.') return false;
  const next = text.charAt(at + 1);
  return next === '' || /\s/.test(next);
}

/** The words of the `gh` command whose arguments start at `from`, and where the command ends: at `endsCommand`, at the next
 *  unquoted `gh` word (whose start it answers, so that word is read as a command of its own), or at the text's end. Quotes group
 *  a word and hide what is in them, so `--body "see -R o/r"` holds no flag. A quote with no closing one before the line's end
 *  (a prose apostrophe: `it's green`) voids the command, which then holds no words and ends just past that quote, so the reader
 *  scans on from there and a later command is still read (review 1762 F3). One forward scan: a quote's search reads up to the
 *  next quote of its kind, which a closed quote consumes, and a void one is never reached again, so each stretch is read about
 *  once however many quotes the message holds. */
function ghWords(text: string, from: number): { words: Word[]; end: number } {
  const words: Word[] = [];
  let cur = '';
  let quoted = false;
  let start = from;
  let i = from;
  /** Closes the word being read; true when it is an unquoted `gh`, which starts the next command. */
  const close = (): boolean => {
    if (cur === '' && !quoted) return false;
    const word = { text: cur, quoted };
    cur = '';
    quoted = false;
    if (!word.quoted && word.text === 'gh') return true;
    words.push(word);
    return false;
  };
  for (; i < text.length; i += 1) {
    const c = text.charAt(i);
    if (endsCommand(text, i)) break;
    if (/\s/.test(c)) {
      if (close()) return { words, end: start };
      continue;
    }
    if (cur === '' && !quoted) start = i;
    if (c === '"' || c === "'") {
      const shut = text.indexOf(c, i + 1);
      if (shut === -1 || text.slice(i + 1, shut).includes('\n')) return { words: [], end: i + 1 };
      cur += text.slice(i + 1, shut);
      quoted = true;
      i = shut;
    } else {
      cur += c;
    }
  }
  if (close()) return { words, end: start };
  return { words, end: i };
}

/** Whether `w` is a flag (`-R`, `--repo`, `--web`): a word starting with a dash once the shell has removed its quotes. */
const isFlag = (w: Word | undefined): boolean => w !== undefined && w.text.startsWith('-');

/** The `gh` flags that take a value, so the word after one is that value (review 1762 F1 and F2). Every other flag is boolean
 *  (`--web`, `--squash`, `--auto`, `--paginate`, `-i`), and the word after it is the command's own: `gh pr merge --squash 40`
 *  is PR 40, and `gh api --paginate repos/o/r/pulls/12` reads its path. A short form is listed where one of `gh`'s commands
 *  gives it a value, even where another gives it none. */
const GH_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-R', '--repo', '-b', '--body', '-t', '--title', '-B', '--base', '-H', '--head', '--header', '-X', '--method', '-f', '-F',
  '--field', '--raw-field', '-q', '--jq', '--json', '-c', '--comment', '-l', '--label', '-a', '--assignee', '-L', '--limit',
  '--reason', '--state', '--template', '--input', '--hostname',
]);

/** Whether `w` is a flag that takes the next word as its value (`GH_VALUE_FLAGS`; a `--flag=value` word holds its own). */
const takesValue = (w: Word | undefined): boolean => w !== undefined && GH_VALUE_FLAGS.has(w.text);

/** A flag's value up to a full stop followed by an upper-case letter, where a sentence begins (review 1762 F9):
 *  `-R o/r.Then #12` names `o/r`. */
function flagValue(value: string): string {
  const stop = /\.(?=[A-Z])/.exec(value);
  return stop === null ? value : value.slice(0, stop.index);
}

/** The command's own words: up to the first bare word past its positionals (`gh pr|issue <verb> <n>` has three, `gh api <path>`
 *  two), where prose or another program begins (`gh pr view 12 then cp -R o/r`). The word after a flag that takes a value
 *  (`takesValue`) is that value; the word after any other flag is the command's own. An unquoted word starting with `#` is
 *  prose, never a positional (review 1762 F1): `gh pr list -R o/r #12 is ours` gives `#12` no repository, since `pr list`
 *  takes no number and the shell would read `#12` as a comment. */
function ownWords(words: readonly Word[]): { own: readonly Word[]; positionals: readonly Word[] } {
  const room = words[0]?.text === 'api' ? 2 : 3;
  const positionals: Word[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i]!;
    if (isFlag(w) || takesValue(words[i - 1]) || (!w.quoted && w.text.startsWith('#'))) continue;
    if (positionals.length === room) return { own: words.slice(0, i), positionals };
    positionals.push(w);
  }
  return { own: words, positionals };
}

/** What one `gh` command says: the repository of its LAST `--repo`, `--repo=` or `-R` flag (as `gh` takes it, its value read
 *  by `flagValue`), or of its `gh api` path, and the number that repository is evidence for: a `gh pr|issue <verb> <n>`
 *  command's own number, or the API path's. */
function ghCommand(words: readonly Word[]): { repo: SaidRepo; number: string | null } | null {
  const { own, positionals } = ownWords(words);
  const [head, verbOrPath, third] = positionals;
  if (head?.text === 'api' && verbOrPath !== undefined) {
    const m = GH_API_PATH.exec(verbOrPath.text);
    if (m !== null) return { repo: said(`${m[1]!}/${m[2]!}`), number: m[3] ?? null };
  }
  let flag: string | null = null;
  // A quoted argument is one word, so a flag inside it (`--body "see -R o/r"`) is never a word of its own; a word that is
  // exactly a quoted flag (`'-R'`) reaches `gh` as that flag once the shell removes its quotes.
  own.forEach((w, i) => {
    if ((w.text === '--repo' || w.text === '-R') && i + 1 < own.length) flag = flagValue(own[i + 1]!.text);
    else if (w.text.startsWith('--repo=')) flag = flagValue(w.text.slice('--repo='.length));
  });
  if (flag === null) return null;
  const numbered = (head?.text === 'pr' || head?.text === 'issue') && third !== undefined && /^#?\d+$/.test(third.text);
  return { repo: said(flag), number: numbered ? third.text.replace('#', '') : null };
}

/** One message's evidence, read in one forward pass of each reader over its raw text. */
export function messageRepos(text: string): MessageRepos {
  const named = new Set<string>();
  const numbers = new Map<number, Map<string, SaidRepo>>();
  const exact = new Map<string, Map<string, SaidRepo>>();
  const addresses: SaidCommit[] = [];
  const atNumber = (n: string, r: SaidRepo): void => {
    const id = Number(n);
    const at = numbers.get(id) ?? new Map<string, SaidRepo>();
    if (!at.has(r.key)) at.set(r.key, r);
    numbers.set(id, at);
  };
  /** The repository an address names, or null when the name boundary does not start its host (`修复见github.com/…`,
   *  `_github.com/…`): that address names an unknown repository and is evidence for nothing (review 1760 F5). */
  const addressed = (m: RegExpMatchArray, owner: string, repo: string): SaidRepo | null => {
    if (!wordBefore(text, m.index!)) return said(`${owner}/${repo}`);
    named.add(unknown(`host:${m[0]}`).key);
    return null;
  };
  for (const m of text.matchAll(PAGE)) {
    if (RESERVED_OWNERS.has(m[1]!.toLowerCase())) continue;
    const r = addressed(m, m[1]!, m[2]!);
    if (r === null) continue;
    named.add(r.key);
    // A number or a SHA is evidence only where the name boundary ends it (`pull/12x` is not #12).
    if (wordAfter(text, m.index + m[0].length)) continue;
    if (m[3] !== undefined) atNumber(m[3], r);
    if (m[4] !== undefined) {
      const sha = m[4].toLowerCase();
      const at = exact.get(sha) ?? new Map<string, SaidRepo>();
      if (!at.has(r.key)) {
        at.set(r.key, r);
        addresses.push({ repo: r, sha });
      }
      exact.set(sha, at);
    }
  }
  for (const m of text.matchAll(API)) {
    const r = addressed(m, m[1]!, m[2]!);
    if (r === null) continue;
    named.add(r.key);
    if (m[3] !== undefined && !wordAfter(text, m.index + m[0].length)) atNumber(m[3], r);
  }
  for (const m of text.matchAll(RAW)) {
    const r = addressed(m, m[1]!, m[2]!);
    if (r !== null) named.add(r.key);
  }
  for (const m of text.matchAll(GH_REPO_ENV)) {
    if (!wordBefore(text, m.index)) named.add(said(m[2]!).key);
  }
  // `gh` commands, each read from its own words to its own end, so a flag reaches only its command's number (review 1760 F1).
  // A `gh` word starts where the name boundary starts one and a space follows it (review 1760 F6).
  for (let at = text.indexOf('gh'); at >= 0; at = text.indexOf('gh', at)) {
    if (wordBefore(text, at) || !/\s/.test(text.charAt(at + 2))) {
      at += 2;
      continue;
    }
    const { words, end } = ghWords(text, at + 2);
    const command = ghCommand(words);
    if (command !== null) {
      named.add(command.repo.key);
      if (command.number !== null) atNumber(command.number, command.repo);
    }
    at = Math.max(end, at + 2);
  }
  for (const q of qualifiedNames(text)) {
    const r = qualifiedRepo(q.repo);
    named.add(r.key);
    atNumber(q.id, r);
  }
  return { named, numbers, commits: commitIndex(exact, addresses) };
}

/** `CommitIndex` over a message's distinct commit addresses: one sort, and one backward pass for `nextOther`. */
function commitIndex(exact: ReadonlyMap<string, ReadonlyMap<string, SaidRepo>>, addresses: SaidCommit[]): CommitIndex {
  const sorted = addresses.sort((a, b) => (a.sha < b.sha ? -1 : a.sha > b.sha ? 1 : 0));
  const nextOther = new Array<number>(sorted.length);
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const next = i + 1;
    nextOther[i] = next === sorted.length || sorted[next]!.repo.key !== sorted[i]!.repo.key ? next : nextOther[next]!;
  }
  return { exact, sorted, nextOther };
}

/** The first index of `sorted` whose SHA is not below `sha`, by binary search. */
function firstFrom(sorted: readonly SaidCommit[], sha: string): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]!.sha < sha) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Whether `message` names a repository other than the home one (`home`, a `repoKey`, or null when the session has none): from
 *  the set's size, so it costs the same for every name in the message (review 1760 F8). */
export function namesOtherThan(message: MessageRepos, home: string | null): boolean {
  return message.named.size > (home !== null && message.named.has(home) ? 1 : 0);
}

/** The repositories `message` names for a bare PR (`kind` `pr`, its number) or commit (`commit`, its SHA), by key: every page
 *  of its number; for a commit, the addresses where one SHA is a prefix of the other, at most two, which is enough to tell one
 *  repository from many. A commit name costs one range of `sorted` (the addresses whose SHA starts with the name's) and one
 *  `exact` read per shorter prefix of seven characters or more (the addresses whose SHA the name's starts with), however many
 *  addresses share its prefix (review 1762 F5). */
export function reposFor(kind: 'pr' | 'commit', id: string, message: MessageRepos): ReadonlyMap<string, SaidRepo> {
  if (kind === 'pr') return message.numbers.get(Number(id)) ?? new Map();
  const sha = id.toLowerCase();
  const out = new Map<string, SaidRepo>();
  const add = (r: SaidRepo): void => {
    if (out.size < 2 && !out.has(r.key)) out.set(r.key, r);
  };
  const { exact, sorted, nextOther } = message.commits;
  // Every SHA in the range starts with the name's, and its next character is hex, below `g`.
  const from = firstFrom(sorted, sha);
  const to = firstFrom(sorted, `${sha}g`);
  if (from < to) {
    add(sorted[from]!.repo);
    if (nextOther[from]! < to) add(sorted[nextOther[from]!]!.repo);
  }
  for (let k = 7; k < sha.length && out.size < 2; k += 1) {
    for (const r of exact.get(sha.slice(0, k))?.values() ?? []) {
      add(r);
      if (out.size === 2) break;
    }
  }
  return out;
}
