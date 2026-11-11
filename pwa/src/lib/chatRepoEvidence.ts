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
/** The REST API's repository address, and its pulls and issues; and its commits, `commits/<sha>` or `git/commits/<sha>`,
 *  with or without a sub-path after the SHA (`/status`, `/check-runs`; Task C23 fix round 2, review 1800 B). */
const API = new RegExp(
  `${HOST_START}api\\.github\\.com/repos/(${SEG})/(${SEG})(?:/(?:(?:pulls|issues)/(\\d+)|(?:git/)?commits/([0-9a-f]{7,40})))?`,
  'gi',
);
/** The raw-file and archive hosts: they name a repository and no number. */
const RAW = new RegExp(`${HOST_START}(?:raw\\.githubusercontent|codeload\\.github)\\.com/(${SEG})/(${SEG})`, 'gi');
/** The path of `gh api`, with or without its leading slash, and its pulls and issues, ending at the word's end, `/`, `?` or `#`;
 *  or its commit, `commits/<sha>` or `git/commits/<sha>`, ending the same way, so a sub-path after the SHA (`/status`) names it
 *  too (Task C23 fix round 1, review 1795 F2: the way a pull page and a commit page are both addresses; fix round 2, review
 *  1800 B). */
const GH_API_PATH = new RegExp(
  `^/?repos/(${SEG})/(${SEG})(?:/(?:(?:pulls|issues)/(\\d+)|(?:git/)?commits/([0-9a-fA-F]{7,40}))(?=$|[/?#]))?`,
);
/** A `gh api` path word anywhere in a message, for the net (Task C22, review 1769 F2): `repos/o/r`, with or without its leading
 *  slash, where a word starts (no letter, digit, `_`, `.`, `/` or `-` before it, so `api.github.com/repos/…` and
 *  `src/repos/…` are not one). */
const GH_PATH_WORD = new RegExp(`(?<![\\w./-])/?repos/(${SEG})/(${SEG})`, 'g');
/** `GH_REPO=o/r`, the environment `gh` reads its repository from, and its YAML `env:` spelling `GH_REPO: o/r` (Task C22, review
 *  1769 F8). */
const GH_REPO_ENV = /GH_REPO(?:=|:[ \t]*)(['"]?)([^\s'"`;&|]+)/g;

/** A letter or a digit, in any script, read by whole code point: what may not stand beside a `gh` word. */
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const letterOrDigit = (cp: number | undefined): boolean => cp !== undefined && LETTER_OR_DIGIT.test(String.fromCodePoint(cp));

/** Where the `gh` word starting at `at` ends, or null where none starts there (Task C22, review 1769 F4): `gh` in any case, or
 *  `gh.exe`, with no letter or digit directly before or after it. Punctuation, a quote, a backtick, a bracket, an apostrophe
 *  (`gh's`) and the text's start or end are boundaries, so `gh-pages` holds one. */
function ghWordEnd(text: string, at: number): number | null {
  if (at > 0) {
    const pair = at >= 2 && /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(text.slice(at - 2, at));
    if (letterOrDigit(text.codePointAt(pair ? at - 2 : at - 1))) return null;
  }
  const exe = text.slice(at + 2, at + 6).toLowerCase() === '.exe' && !letterOrDigit(text.codePointAt(at + 6));
  const end = exe ? at + 6 : at + 2;
  return letterOrDigit(text.codePointAt(end)) ? null : end;
}

/** A whole word that is a `gh` word (`ghWordEnd`): it ends the command before it. */
const GH_COMMAND_WORD = /^gh(?:\.exe)?$/i;

/** What a word of a `gh` command is: a flag, the value of the flag before it, or a positional. */
type Role = 'flag' | 'value' | 'positional';

/** One word of a `gh` command: its text with quotes removed, whether any of it was quoted, its role, and where it starts and
 *  ends in the message. */
interface Word {
  readonly text: string;
  readonly quoted: boolean;
  readonly role: Role;
  readonly at: number;
  readonly end: number;
}

/** Where a word a command read stands in the message: the net counts a repository flag or path inside one as that command's. */
interface Span {
  readonly at: number;
  readonly end: number;
}

/** The length of the line continuation at `at` (a backslash, then a line break or a CRLF), or 0 where none stands there: the
 *  shell deletes it, so inside a `gh` command the command goes on on the next line (Task C23, review 1778 P1), and a word it is
 *  glued inside goes on too, its two halves joined (fix round 1, review 1795 F1 and C3). Only an unescaped backslash starts
 *  one: the run of backslashes ending at `at` must be odd, since each pair is one escaped backslash (review 1795 C2). The run
 *  is counted only where a line break follows, so each run is counted once. */
function continuation(text: string, at: number): number {
  if (text.charAt(at) !== '\\') return 0;
  const length = text.charAt(at + 1) === '\n' ? 2 : text.charAt(at + 1) === '\r' && text.charAt(at + 2) === '\n' ? 3 : 0;
  if (length === 0) return 0;
  let k = at;
  while (k > 0 && text.charAt(k - 1) === '\\') k -= 1;
  return (at - k) % 2 === 0 ? length : 0;
}

/** `text` as the shell joins it, every continuation (`continuation`) deleted, and `raw[i]`, where the joined text's `i`th
 *  character stands in `text` (`raw[text.length]` is `text`'s length), so the net can read a split flag and still tell which
 *  command's words it stands in (Task C23 fix round 2, review 1800 A). One pass; the text itself where it holds none. */
function shellJoined(text: string): { readonly text: string; readonly raw: (at: number) => number } {
  if (!/\\\r?\n/.test(text)) return { text, raw: (at) => at };
  const raw = new Int32Array(text.length + 1);
  const pieces: string[] = [];
  let n = 0;
  let from = 0;
  for (let i = 0; i < text.length; i += 1) {
    const length = continuation(text, i);
    if (length === 0) {
      raw[n] = i;
      n += 1;
      continue;
    }
    pieces.push(text.slice(from, i));
    i += length - 1;
    from = i + 1;
  }
  pieces.push(text.slice(from));
  raw[n] = text.length;
  return { text: pieces.join(''), raw: (at) => raw[at]! };
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

/** The flags `gh` itself has as booleans (Task C20 fix rounds 1 and 2, reviews 1766 F2 and 1768 G1 and G2), by the command
 *  group they are read in: `api` for `gh api`, and `prIssue` for every `gh pr` and `gh issue` command. Source: `gh` 2.103.3's
 *  own help (c20.md): a flag listed there with no value type, less any flag that takes a value in another command of its group
 *  (`-a`, `-c`, `-e`, `-l`, `-m`, `-r`, `-s` and `--comment` in `pr` and `issue`); `-i` is `--include` in `api` but the
 *  interval in `pr checks`. Every other flag written without `=`, and every flag of any other group, takes the next word as
 *  its value: those groups' commands carry no number, so a set there could change nothing the chat reads. A boolean this list
 *  misses costs at most a link to text, never a home link. In `pr` and `issue`: every repository flag of a `gh` message names
 *  its repository whether or not its command reads it (`repoFlags`, review 1768's net), and a command that loses its repository
 *  flag gives its number to an unknown repository (`ghCommand`). In `api`, whose repository is its path: every `repos/o/r`
 *  word of a `gh` message names its repository too (Task C22, review 1769 F2; at Task C20 a path taken as a missed boolean's
 *  value could open home). An entry it wrongly held could read a flag's value as the command's number, so it holds only what
 *  that help lists, and the test compares it entry by entry. */
export const GH_BOOLEAN_FLAGS: { readonly api: ReadonlySet<string>; readonly prIssue: ReadonlySet<string> } = {
  api: new Set(['--allow-escape-sequences', '--include', '-i', '--paginate', '--silent', '--slurp', '--verbose']),
  prIssue: new Set([
    '--admin', '--allow-escape-sequences', '--approve', '--auto', '--checkout', '--clobber', '--comments', '--conflict-status',
    '--create-if-none', '--delete-branch', '-d', '--delete-last', '--detach', '--disable-auto', '--draft', '--dry-run',
    '--edit-last', '--editor', '--fail-fast', '--fill', '--fill-first', '--fill-verbose', '--force', '-f', '--list', '--merge',
    '--name-only', '--no-maintainer-edit', '--patch', '--rebase', '--recurse-submodules', '--remove-milestone',
    '--remove-parent', '--remove-type', '--request-changes', '--required', '--skip-existing', '--squash', '--undo', '--watch',
    '--web', '-w', '--yes',
  ]),
};

/** A `gh` command group with a boolean set (`GH_BOOLEAN_FLAGS`), or null for every other group. */
type Group = keyof typeof GH_BOOLEAN_FLAGS;

/** Whether `-<letter>` is one of `gh`'s booleans in command group `group` (`GH_BOOLEAN_FLAGS`; a group with no set has none). */
const isBoolean = (flag: string, group: Group | null): boolean => group !== null && GH_BOOLEAN_FLAGS[group].has(flag);

/** Whether the flag `flag`, read in command group `group`, takes the next word as its value: written without `=`, and not one
 *  of `gh`'s booleans for that group. A run of short flags (`-dw`, `-iXGET`, `-XPATCH`) is read as `gh` reads it, letter by
 *  letter: booleans until the first letter that takes a value, which takes the rest of the word as that value, glued on, so the
 *  word takes the next one only where that letter is its last (Task C22, review 1769 F2). */
function takesValue(flag: string, group: Group | null): boolean {
  if (flag.includes('=')) return false;
  if (flag.startsWith('--') || flag.length <= 2) return !isBoolean(flag, group);
  for (let k = 1; k < flag.length; k += 1) {
    if (!isBoolean(`-${flag.charAt(k)}`, group)) return k === flag.length - 1;
  }
  return false;
}

/** A command's own number written `#n` where its number stands, read where the command ends at it (`ghWords`). */
const HASH_NUMBER = /#(\d+)(?!\w)/y;

/** The own words of the `gh` command whose arguments start at `from`, each with its role, and where the command ends. A
 *  command ends at `endsCommand`, at the next unquoted `gh` word (whose start it answers, so that word is read as a command of
 *  its own), at an unquoted word starting with `#` (a shell comment; review 1766 F7), or at the first bare word past its
 *  positionals (`gh pr|issue <verb> <n>` has three, `gh api <path>` two): there prose or another program begins
 *  (`gh pr view 12 then cp -R o/r`), and nothing after it is read as the command's. The word after a flag that takes a value
 *  (`takesValue`) is that value, never a flag of its own (review 1766 F9). Quotes group a word and hide what is in them, so
 *  `--body "see -R o/r"` holds no flag. A quote with no closing one before its line's end voids the command only when it
 *  begins inside the command's own words: the command is then `voided`, decided by `ghCommand` from the words before that
 *  quote, and ends just past it, so a later command is still read (review 1762 F3); a prose apostrophe past the command
 *  touches nothing it read (review 1766 F1). Where a `pr` or `issue` command ends at a `#n` word standing where its number
 *  stands, `hashed` is that number (review 1768 G3). A line continuation is deleted, as the shell deletes it (`continuation`,
 *  Task C23, review 1778 P1 and review 1795 F1): whitespace between words, a join inside one. Where an unquoted `gh` word
 *  stands where a flag's value is expected, the command ends there as anywhere, and is `cut`: `ghCommand` gives its number to
 *  no repository (Task C23, review 1778 A2). One forward scan: a quote's search reads up to the next quote of its kind,
 *  which a closed quote consumes, and a void one is never reached again, so each stretch is read about once however many
 *  quotes the message holds. */
function ghWords(
  text: string,
  from: number,
): { words: Word[]; end: number; voided: boolean; cut: boolean; hashed: string | null } {
  const words: Word[] = [];
  let positionals = 0;
  let room = 3;
  let group: Group | null = null;
  let expecting = false;
  let cur = '';
  let quoted = false;
  let reading = false;
  let start = from;
  let i = from;
  let cut = false;
  /** Whether the word being read stands past the command's positionals, where only a flag is still the command's own. */
  const past = (): boolean => !expecting && positionals === room;
  /** Closes the word being read: true when the command ends at its start (an unquoted `gh`, or a word past the positionals
   *  that is no flag), else it joins the command's words with its role. */
  const close = (): boolean => {
    if (!reading) return false;
    const word = { text: cur, quoted, at: start, end: i };
    reading = false;
    cur = '';
    quoted = false;
    if (!word.quoted && GH_COMMAND_WORD.test(word.text)) {
      cut = expecting;
      return true;
    }
    if (expecting) {
      words.push({ ...word, role: 'value' });
      expecting = false;
    } else if (word.text.startsWith('-')) {
      words.push({ ...word, role: 'flag' });
      expecting = takesValue(word.text, group);
    } else if (positionals === room) {
      return true;
    } else {
      words.push({ ...word, role: 'positional' });
      if (positionals === 0 && word.text === 'api') {
        group = 'api';
        room = 2;
      } else if (positionals === 0 && (word.text === 'pr' || word.text === 'issue')) {
        group = 'prIssue';
      }
      positionals += 1;
    }
    return false;
  };
  for (; i < text.length; i += 1) {
    const c = text.charAt(i);
    if (endsCommand(text, i)) break;
    // Deleted, as the shell deletes it: between words it is whitespace, inside one it joins the halves.
    const joined = continuation(text, i);
    if (joined > 0) {
      i += joined - 1;
      continue;
    }
    if (/\s/.test(c)) {
      if (close()) return { words, end: start, voided: false, cut, hashed: null };
      continue;
    }
    if (!reading) {
      if (c === '#') {
        HASH_NUMBER.lastIndex = i;
        const own = group === 'prIssue' && positionals === 2 && !expecting ? HASH_NUMBER.exec(text) : null;
        return { words, end: i, voided: false, cut, hashed: own === null ? null : own[1]! };
      }
      reading = true;
      start = i;
    }
    if (c === '"' || c === "'") {
      const shut = text.indexOf(c, i + 1);
      if (shut === -1 || text.slice(i + 1, shut).includes('\n')) {
        return past()
          ? { words, end: start, voided: false, cut, hashed: null }
          : { words, end: i + 1, voided: true, cut, hashed: null };
      }
      cur += text.slice(i + 1, shut);
      quoted = true;
      i = shut;
    } else {
      cur += c;
    }
  }
  if (close()) return { words, end: start, voided: false, cut, hashed: null };
  return { words, end: i, voided: false, cut, hashed: null };
}

/** A sentence's start inside a flag's value: a full stop followed by an upper-case letter. */
const SENTENCE_IN_VALUE = /\.(?=[A-Z])/;

/** The repository a repository flag's value names, for a command and for the net alike: unknown where the value holds a
 *  sentence's start (`-R o/r.Then`, or a real `owner/Lib.Json`; never cut to a shorter name, review 1766 F3) or the grammar
 *  refuses it. */
function flagRepo(value: string): SaidRepo {
  return SENTENCE_IN_VALUE.test(value) ? unknown(value) : said(value);
}

/** The repository of a repository flag the chat cannot read, and of a number whose command lost its repository flag. */
const LOST: SaidRepo = unknown('gh:lost');

/** A word spelled as a repository flag: `--repo`, `--repo=...`, or a run of short flags up to its first `R` (`-R`, `-sR`, and
 *  `-Rowner/repo` or `-R=owner/repo` with the value glued on). */
const REPO_FLAG_WORD = /^(?:--repo(?:=|$)|-[A-Za-z]*?R)/;

/** What one `gh` command says: the repository of its LAST `--repo`, `--repo=` or `-R` flag (as `gh` takes it), or of its `gh api`
 *  path, and the number that repository is evidence for: a `gh pr|issue <verb> <n>` command's own number, or the API path's; or
 *  the commit, `sha` in lower case, its API path names (Task C23 fix round 1, review 1795 F2).
 *  `lost` (review 1768 G1 and G4): the command holds a repository flag it cannot read (a value word spelled as one, which
 *  `gh` takes as that value; a run such as `-sR` or a glued `-Rowner/repo`; a `-R` with no value after it), or it is
 *  `voided` and its words name a repository: its number then belongs to a repository the chat cannot tell, so a bare name
 *  is text even where another command or address names that number elsewhere. `repo` is null where no flag was read: the
 *  net names what the flag says. A voided command naming none is decided as if absent (review 1766 F1); a `cut` one (`ghWords`)
 *  gives its number to an unknown repository whether or not it names one (Task C23, review 1778 A2). `claims` are the words
 *  the net counts as this command's: none of its repository flags where it gives no number, so each of them, read or lost, is
 *  a candidate for every number the message gives a repository (Task C23, review 1778 A1 and P2); an `api` path its command
 *  read stays its command's, with or without a number (`api-path-claim-unchanged`). */
function ghCommand(
  words: readonly Word[],
  voided: boolean,
  cut: boolean,
): { repo: SaidRepo | null; number: string | null; sha: string | null; lost: boolean; claims: Span[] } | null {
  const [head, verbOrPath, third] = words.filter((w) => w.role === 'positional');
  const numbered = (head?.text === 'pr' || head?.text === 'issue') && third !== undefined && /^#?\d+$/.test(third.text);
  const number = numbered ? third.text.replace('#', '') : null;
  if (head?.text === 'api' && verbOrPath !== undefined) {
    const m = GH_API_PATH.exec(verbOrPath.text);
    if (m !== null) {
      const sha = m[4] === undefined ? null : m[4].toLowerCase();
      return { repo: said(`${m[1]!}/${m[2]!}`), number: m[3] ?? null, sha, lost: voided || cut, claims: [verbOrPath] };
    }
  }
  let flag: string | null = null;
  let lost = false;
  // The words this command reads as a repository flag, its own or lost: the net counts what it finds in them as this
  // command's, and every other repository flag as no command's (Task C22, review 1769 F3).
  const claims: Span[] = [];
  // A quoted argument is one word, so a flag inside it (`--body "see -R o/r"`) is never a word of its own, and neither is a
  // flag's value (`--body "--repo=o/r"`); a word that is exactly a quoted flag (`'-R'`) reaches `gh` as that flag once the
  // shell removes its quotes. An unquoted value spelled as a repository flag is one `gh` reads as that value, so the
  // command's repository is lost (review 1768 G1).
  words.forEach((w, i) => {
    if (w.role === 'value') {
      if (!w.quoted && REPO_FLAG_WORD.test(w.text)) {
        lost = true;
        claims.push(w);
      }
      return;
    }
    if (w.role !== 'flag') return;
    if (w.text === '--repo' || w.text === '-R') {
      const next = words[i + 1];
      if (next?.role === 'value') flag = next.text;
      else lost = true;
    } else if (w.text.startsWith('--repo=')) flag = w.text.slice('--repo='.length);
    else if (REPO_FLAG_WORD.test(w.text)) lost = true;
    else return;
    claims.push(w);
  });
  if (flag === null && !lost && !cut) return null;
  const repo = flag === null ? null : flagRepo(flag);
  return { repo, number, sha: null, lost: lost || voided || cut, claims: number === null ? [] : claims };
}

/** A repository flag's spelling where a word starts (no letter, digit, `_` or `-` before it): `--repo`, or a run of short
 *  flags up to its first `R`, its value spaced or glued on (`-R o/r`, `-sR o/r`, `-Ro/r`, `-R=o/r`). */
const REPO_FLAG = /(?<![\w-])(?:--repo(?![\w-])|-[A-Za-z]*?R)/g;
/** A character that ends a repository flag's unquoted value. */
const VALUE_END = /[\s`;&|,()<>"']/;

/** The value of the repository flag whose spelling ends at `at`, read no further than `limit`, where the next repository flag's
 *  spelling starts: after `=`, after spaces or tabs, or glued on; a quoted value has its quotes removed. Null where none can
 *  be read: nothing there, a line break first, or a quote not closed on its line before `limit` (the grammar trims a line
 *  break, so a quote closed on a later line is refused here). A value never runs past the next flag, so each character is
 *  read once however many flags a run of them holds (Task C22, review 1769 F1). An unquoted value that runs into the next
 *  flag is cut there, so it is unreadable too: what was cut off may have named another repository (Task C23, review 1778 L2-2:
 *  `-R o/r.-R=o/r` names no `o/r` from its first flag). */
function repoFlagValue(text: string, at: number, limit: number): string | null {
  let k = at;
  const c = text.charAt(k);
  if (c === '=') k += 1;
  else if (c === ' ' || c === '\t') {
    // A flag starts at a `-`, never inside a run of spaces, so this run ends at `limit` at the latest.
    while (text.charAt(k) === ' ' || text.charAt(k) === '\t') k += 1;
  }
  const q = text.charAt(k);
  if (q === '"' || q === "'") {
    for (let e = k + 1; e < limit; e += 1) {
      const ch = text.charAt(e);
      if (ch === q) return text.slice(k + 1, e);
      if (ch === '\n') return null;
    }
    return null;
  }
  let e = k;
  while (e < limit && !VALUE_END.test(text.charAt(e))) e += 1;
  // A flag starts at `limit` unless it is the text's end, and no value ends at a flag's `-`, so reaching it cut the value.
  return e === k || (e === limit && e < text.length) ? null : text.slice(k, e);
}

/** What the net found (`repoFlags`): every repository it names by key, those no command claimed, and whether it read any
 *  repository flag at all. */
interface Net {
  readonly named: Map<string, SaidRepo>;
  readonly unclaimed: Map<string, SaidRepo>;
  flags: boolean;
}

/** Whether the net's find at `index` stands in a word a command read (`claims`, in message order): `cursor` walks the claims
 *  with the finds, which come in message order too, so the walk is one pass. */
function claimedAt(claims: readonly Span[], cursor: { i: number }, index: number): boolean {
  while (cursor.i < claims.length && claims[cursor.i]!.end <= index) cursor.i += 1;
  return cursor.i < claims.length && claims[cursor.i]!.at <= index;
}

/** The net (Task C20 fix round 2, review 1768; Task C22, review 1769): every repository flag in a message that holds a `gh`
 *  word names its repository for rule 3, wherever it stands: inside or outside the command the reader reads, after a flag it
 *  lost, in a quoted body, after a `#` word. One the chat cannot read names an unknown repository. So does every `gh api`
 *  path word `repos/o/r` (review 1769 F2). So a parser corner that loses a command's repository flag or path costs at most a
 *  link to text, never a home link. `ghCommand` still decides which number a repository is for; a repository the net finds
 *  in no word a command read (`claims`) is no command's, so it is a candidate for every number the message gives a
 *  repository (`messageRepos`, review 1769 F3). A flag of another program (`cp -R src/lib`) in such a message names its word
 *  too, and its bare names are text. It reads the message as the shell joins it (`shellJoined`), so a flag spelling split by a
 *  continuation is read in every context (Task C23 fix round 2, review 1800 A). One forward pass: each flag's value ends where
 *  the next flag starts (`repoFlagValue`). */
function repoFlags(message: string, claims: readonly Span[]): Net {
  // The net reads the text as the shell joins it, so a flag split by a continuation (`-` then `R`) is read; a find's offset
  // is mapped back to the message, where the claims stand.
  const { text, raw } = shellJoined(message);
  const net: Net = { named: new Map(), unclaimed: new Map(), flags: false };
  const found = (r: SaidRepo, claimed: boolean): void => {
    if (!net.named.has(r.key)) net.named.set(r.key, r);
    if (!claimed && !net.unclaimed.has(r.key)) net.unclaimed.set(r.key, r);
  };
  const flagCursor = { i: 0 };
  const flags = text.matchAll(REPO_FLAG);
  for (let m = flags.next(); !m.done; ) {
    const next = flags.next();
    const at = m.value.index;
    const value = repoFlagValue(text, at + m.value[0].length, next.done ? text.length : next.value.index);
    net.flags = true;
    found(value === null ? LOST : flagRepo(value), claimedAt(claims, flagCursor, raw(at)));
    m = next;
  }
  const pathCursor = { i: 0 };
  for (const m of text.matchAll(GH_PATH_WORD)) found(said(`${m[1]!}/${m[2]!}`), claimedAt(claims, pathCursor, raw(m.index)));
  return net;
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
  /** A commit address: SHA `sha`, in lower case, in repository `r`, each pair once. */
  const atCommit = (sha: string, r: SaidRepo): void => {
    const at = exact.get(sha) ?? new Map<string, SaidRepo>();
    if (!at.has(r.key)) {
      at.set(r.key, r);
      addresses.push({ repo: r, sha });
    }
    exact.set(sha, at);
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
    if (m[4] !== undefined) atCommit(m[4].toLowerCase(), r);
  }
  for (const m of text.matchAll(API)) {
    const r = addressed(m, m[1]!, m[2]!);
    if (r === null) continue;
    named.add(r.key);
    if (wordAfter(text, m.index + m[0].length)) continue;
    if (m[3] !== undefined) atNumber(m[3], r);
    if (m[4] !== undefined) atCommit(m[4].toLowerCase(), r);
  }
  for (const m of text.matchAll(RAW)) {
    const r = addressed(m, m[1]!, m[2]!);
    if (r !== null) named.add(r.key);
  }
  for (const m of text.matchAll(GH_REPO_ENV)) {
    if (!wordBefore(text, m.index)) named.add(said(m[2]!).key);
  }
  // `gh` commands, each read from its own words to its own end, so a flag reaches only its command's number (review 1760 F1).
  // The net runs in a message that holds a `gh` word (`ghWordEnd`, Task C22 review 1769 F4); a command is read where a space
  // follows that word (review 1760 F6).
  let holdsGh = false;
  const hashed: string[] = [];
  const claims: Span[] = [];
  const gh = /gh/gi;
  for (let m = gh.exec(text); m !== null; m = gh.exec(text)) {
    const end = ghWordEnd(text, m.index);
    if (end === null) continue;
    holdsGh = true;
    if (!/\s/.test(text.charAt(end))) {
      gh.lastIndex = end;
      continue;
    }
    const read = ghWords(text, end);
    const command = ghCommand(read.words, read.voided, read.cut);
    if (command !== null) {
      if (command.repo !== null) named.add(command.repo.key);
      const owner = command.lost || command.repo === null ? LOST : command.repo;
      if (command.number !== null) atNumber(command.number, owner);
      if (command.sha !== null) atCommit(command.sha, owner);
      // One push per claim, never a spread: one command may hold more words than a call takes arguments (review 1778 L2-1).
      for (const span of command.claims) claims.push(span);
    }
    if (read.hashed !== null) hashed.push(read.hashed);
    gh.lastIndex = Math.max(read.end, end);
  }
  let unclaimed: ReadonlyMap<string, SaidRepo> = new Map();
  if (holdsGh) {
    const net = repoFlags(text, claims);
    for (const key of net.named.keys()) named.add(key);
    unclaimed = net.unclaimed;
    // A command ended by its own `#n` (a shell comment, review 1766 F7) read no repository for it. Where the message names
    // one by a flag, that number is in a repository the chat cannot tell (review 1768 G3).
    if (net.flags) for (const n of hashed) atNumber(n, LOST);
  }
  for (const q of qualifiedNames(text)) {
    const r = qualifiedRepo(q.repo);
    named.add(r.key);
    atNumber(q.id, r);
  }
  // A repository the net found in no command's words is a candidate for every number the message gives a repository, so a
  // number with another repository is text (Task C22, review 1769 F3), and for every commit it gives one, as an address of
  // that commit in that repository (Task C23, review 1778 L3-5). A number or commit given none goes to rule 3, which that
  // repository already decides. Two such candidates tell one repository from many, so each takes at most two of them.
  if (unclaimed.size > 0) {
    const extra: SaidRepo[] = [];
    for (const r of unclaimed.values()) if (extra.push(r) === 2) break;
    for (const at of numbers.values()) for (const r of extra) if (!at.has(r.key)) at.set(r.key, r);
    // Each SHA is a key already, so the writer adds no key to the map this walks.
    for (const sha of exact.keys()) for (const r of extra) atCommit(sha, r);
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
