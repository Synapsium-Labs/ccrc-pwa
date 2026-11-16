/**
 * Adding a project from the console (add-project spec 2026-11-04 §3): the vocabulary the PWA's sheet and the server's
 * `planProjectAdd` (`server/src/projectAdd.ts`) both parse with, so the name a sheet prefills is the name the route
 * accepts. L0: imports nothing — the PWA bundles this file.
 *
 * ccd's `cmd_project_add` re-checks the name and the url with its own copy of these rules (it is bash);
 * `server/test/project-add-parity.test.ts` holds the two equal.
 */

/** The longest NEW project name, in bytes. A workspace id is `<project>-<slug>` capped at `WS_ID_MAX` (128,
 *  `shared/slug.ts`), so a new project leaves room for a slug. The names are ASCII, so characters are bytes. */
export const PROJECT_NAME_MAX = 64;

/** A name a NEW project may take: a leading letter or digit, then `[A-Za-z0-9._-]`, at most `PROJECT_NAME_MAX`, and not
 *  ending in `.git`. Stricter than `isWsProject` (no leading `_`), so every name this accepts ccd's `_ws_project_valid`
 *  accepts too. */
export function isNewProjectName(s: string): boolean {
  return s.length <= PROJECT_NAME_MAX && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s) && !s.endsWith('.git');
}

/** A GitHub repository the operator named, and the url ccd clones. */
export interface GithubRepo { owner: string; repo: string; url: string }

/** An owner: a leading letter or digit, then letters, digits and dashes. GitHub's own owner names have no dot and no
 *  underscore, so a dotted first segment (`github.com/owner` read as the short shape) is never an owner. */
const OWNER = '[A-Za-z0-9][A-Za-z0-9-]*';
/** A repo as typed, `.git` included: a leading letter, digit, dot or underscore (GitHub's own `.github`, a `_tools`),
 *  then `[A-Za-z0-9._-]`. Never a leading dash, so the url can never read as an option. */
const REPO = '[A-Za-z0-9._][A-Za-z0-9._-]*';
const SHORT = new RegExp(`^(${OWNER})/(${REPO})$`);
const HTTPS = new RegExp(`^(?:https://)?github\\.com/(${OWNER})/(${REPO})/?$`);
const SSH = new RegExp(`^git@github\\.com:(${OWNER})/(${REPO})$`);
const REPO_NAME = new RegExp(`^${REPO}$`);

/** A repo segment once ONE trailing `.git` is stripped: the repo grammar, not `.` or `..`, and not itself ending in `.git`. */
const isRepoName = (r: string): boolean => REPO_NAME.test(r) && r !== '.' && r !== '..' && !r.endsWith('.git');

/**
 * `owner/repo`, `[https://]github.com/owner/repo[.git][/]` or `git@github.com:owner/repo[.git]`, surrounding blanks
 * trimmed; every other host, scheme or extra path segment answers `null`. The url keeps the transport the operator
 * chose — the SSH shape clones over SSH, the other three over HTTPS — and always ends in `.git`, the two exact shapes
 * ccd's own match admits (`_project_github_url_ok`, with these same segment rules).
 */
export function parseGithubRepo(input: string): GithubRepo | null {
  const s = input.trim();
  const ssh = SSH.exec(s);
  const m = ssh ?? HTTPS.exec(s) ?? SHORT.exec(s);
  if (m === null) return null;
  const owner = m[1] as string;
  const repo = (m[2] as string).replace(/\.git$/, '');
  if (!isRepoName(repo)) return null;
  const url = ssh !== null ? `git@github.com:${owner}/${repo}.git` : `https://github.com/${owner}/${repo}.git`;
  return { owner, repo, url };
}

/** The name a cloned repo's project takes when the operator gives none: the repo's own, or `null` when that is not a
 *  name a new project may take (too long, or leading with a dot or an underscore, as `.github` does). */
export function deriveProjectName(repo: GithubRepo): string | null {
  return isNewProjectName(repo.repo) ? repo.repo : null;
}

/** `POST /api/projects`'s body. A clone's `name` is optional (the repo's own by default); an empty project names itself. */
export type ProjectAddBody =
  | { source: 'github'; repo: string; name?: string }
  | { source: 'empty'; name: string };

export type ProjectAddSource = ProjectAddBody['source'];

/** `POST /api/projects`'s 200: the project as it now stands under the projects root. */
export interface ProjectAddAnswer { ok: true; name: string; source: ProjectAddSource }
