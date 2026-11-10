// What one chat message says about GitHub repositories (desktop polish Task C21, D-8172; chat reading spec 2026-11-06 R15): the
// evidence `refHref` reads to decide which repository a bare `#n` or commit means, or that it means none it can tell. A session
// lives in one project but may coordinate runs whose work lands in other repositories, so the home repository is not the
// answer for every name: a wrong link is worse than no link.
//
// L1, Session Conversation: pure, no React, no store, no DOM. It reads the message's WHOLE raw text, code spans, link targets
// and fenced code included, because an address in a code span is exactly where a session writes the repository it means. It
// is asked at render time and memoised per message by its caller, never in the parse worker: `chatMarks.ts` stays the grammar
// of names and imports nothing (`markdown-purity.test.ts`).
import { parseGithubRepo } from '../../../shared/projectAdd';
import { GITHUB_OWNER_PATTERN as OWNER, GITHUB_REPO_PATTERN as REPO } from './chatMarks';

/** A repository a message names: the key it is compared by (`repoKey`), and `owner/repo` as first written, for the address. */
interface NamedRepo {
  readonly key: string;
  readonly slug: string;
}

/** What one message names. `named`: every repository, by key. `numbers`: for a PR or issue number, each repository the message
 *  names that number in (`github.com/<o>/<r>/pull/<n>`, `.../issues/<n>` or `<o>/<r>#<n>`), by key. `commits`: each commit
 *  address (`github.com/<o>/<r>/commit/<sha>`), its SHA in lower case. */
export interface MessageRepos {
  readonly named: ReadonlySet<string>;
  readonly numbers: ReadonlyMap<number, ReadonlyMap<string, string>>;
  readonly commits: readonly (NamedRepo & { readonly sha: string })[];
}

/** The key two spellings of one repository share: `owner/repo` as the console's one GitHub grammar reads it (`parseGithubRepo`:
 *  the short form, an https address, `.git` dropped), in lower case, since GitHub's own names are case-insensitive. `null` for
 *  anything that grammar refuses. */
export function repoKey(slug: string): string | null {
  const gh = parseGithubRepo(slug);
  return gh === null ? null : `${gh.owner}/${gh.repo}`.toLowerCase();
}

// An owner and a repository in `parseGithubRepo`'s segment grammar (`chatMarks.ts` holds the patterns); each match is re-read by
// `parseGithubRepo` itself. A repository segment loses its trailing dots (a sentence's full stop) before it is read.
/** A GitHub address: `github.com/<owner>/<repo>`, with any scheme or `www.`, not inside a longer host name; then, optionally, a
 *  pull, issue or commit page. */
const ADDRESS = new RegExp(
  `(?<![A-Za-z0-9.-])(?:www\\.)?github\\.com/(${OWNER})/(${REPO})(?:/(?:(?:pull|issues)/(\\d+)(?!\\d)|commit/([0-9A-Fa-f]{7,40})(?![0-9A-Za-z])))?`,
  'g',
);
/** `owner/repo#n` standing on its own: not after a word character, a path or a host. */
const QUALIFIED = new RegExp(`(?<![A-Za-z0-9_./-])(${OWNER})/(${REPO})#(\\d{1,6})(?!\\d)`, 'g');

function named(owner: string, repo: string): NamedRepo | null {
  const slug = `${owner}/${repo.replace(/\.+$/, '')}`;
  const key = repoKey(slug);
  return key === null ? null : { key, slug: slug.replace(/\.git$/, '') };
}

/** One message's evidence, read in one pass of each pattern over its raw text. */
export function messageRepos(text: string): MessageRepos {
  const names = new Set<string>();
  const numbers = new Map<number, Map<string, string>>();
  const commits: (NamedRepo & { sha: string })[] = [];
  const atNumber = (n: string, r: NamedRepo): void => {
    const id = Number(n);
    const at = numbers.get(id) ?? new Map<string, string>();
    if (!at.has(r.key)) at.set(r.key, r.slug);
    numbers.set(id, at);
  };
  for (const m of text.matchAll(ADDRESS)) {
    const r = named(m[1]!, m[2]!);
    if (r === null) continue;
    names.add(r.key);
    if (m[3] !== undefined) atNumber(m[3], r);
    if (m[4] !== undefined) commits.push({ ...r, sha: m[4].toLowerCase() });
  }
  for (const m of text.matchAll(QUALIFIED)) {
    const r = named(m[1]!, m[2]!);
    if (r === null) continue;
    names.add(r.key);
    atNumber(m[3]!, r);
  }
  return { named: names, numbers, commits };
}
