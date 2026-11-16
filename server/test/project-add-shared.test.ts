// Add a project from the console (spec 2026-11-04 §3): the L0 vocabulary the sheet and the route both parse with,
// `shared/projectAdd.ts`. Pure string work, so every case is an input and its answer. The url a parse answers is the
// one ccd clones, so its two shapes are pinned exactly: ccd's own match admits those two and nothing else.
import { describe, it, expect } from 'vitest';
import {
  deriveProjectName, isNewProjectName, parseGithubRepo, PROJECT_NAME_MAX,
} from '../../shared/projectAdd.js';

// Built with `AT` so the public tree carries no contiguous address-shaped token (topology-clean's email class).
const AT = '@';
const HTTPS = (o: string, r: string): string => `https://github.com/${o}/${r}.git`;

describe('parseGithubRepo: the shapes it accepts', () => {
  it.each([
    ['example/repo', 'example', 'repo'],
    ['https://github.com/example/repo', 'example', 'repo'],
    ['https://github.com/example/repo.git', 'example', 'repo'],
    ['https://github.com/example/repo/', 'example', 'repo'],
    ['https://github.com/example/repo.git/', 'example', 'repo'],
    ['example/repo.git', 'example', 'repo'],
    ['example/my.repo_name-2', 'example', 'my.repo_name-2'],
    // A repo may lead with a dot or an underscore (GitHub's own `.github`, a `_tools`); an owner may not.
    ['example/.github', 'example', '.github'],
    ['example/_tools', 'example', '_tools'],
    ['example/.github.git', 'example', '.github'],
    ['example/...', 'example', '...'],
    ['https://github.com/example/.github', 'example', '.github'],
    ['Example-1/repo', 'Example-1', 'repo'],
    // The scheme-less paste of a browser's address bar, normalised to HTTPS.
    ['github.com/example/repo', 'example', 'repo'],
    ['github.com/example/repo.git', 'example', 'repo'],
    ['github.com/example/repo/', 'example', 'repo'],
    ['github.com/example/repo.git/', 'example', 'repo'],
  ])('%s is %s/%s over HTTPS', (input, owner, repo) => {
    expect(parseGithubRepo(input)).toEqual({ owner, repo, url: HTTPS(owner, repo) });
  });

  it('the SSH shape keeps its transport: the url is the SSH one, with .git', () => {
    expect(parseGithubRepo('git@github.com:example/repo.git'))
      .toEqual({ owner: 'example', repo: 'repo', url: 'git@github.com:example/repo.git' });
    expect(parseGithubRepo('git@github.com:example/repo'))
      .toEqual({ owner: 'example', repo: 'repo', url: 'git@github.com:example/repo.git' });
    expect(parseGithubRepo('git@github.com:example/.github'))
      .toEqual({ owner: 'example', repo: '.github', url: 'git@github.com:example/.github.git' });
  });

  it('surrounding blanks are trimmed; inner blanks are not a repo', () => {
    expect(parseGithubRepo('  example/repo \n')).toEqual({ owner: 'example', repo: 'repo', url: HTTPS('example', 'repo') });
    expect(parseGithubRepo('\thttps://github.com/example/repo\t')?.url).toBe(HTTPS('example', 'repo'));
    expect(parseGithubRepo('example/ repo')).toBeNull();
    expect(parseGithubRepo('example /repo')).toBeNull();
  });
});

describe('parseGithubRepo: everything else answers null', () => {
  it.each([
    ['another host', 'https://gitlab.com/example/repo'],
    ['a subdomain of github', 'https://www.github.com/example/repo'],
    ['a host that ends in github.com', 'https://notgithub.com/example/repo'],
    ['plain http', 'http://github.com/example/repo'],
    ['an ssh:// url', 'ssh://git@github.com/example/repo.git'],
    ['a file url', 'file:///srv/repo.git'],
    ['the ext transport', 'ext::sh -c touch% /tmp/x'],
    ['a scheme-less form on another host', 'gitlab.com/example/repo'],
    ['a scheme-less form with an extra segment', 'github.com/example/repo/tree'],
    ['github.com/<owner> read as the short shape: its owner, github.com, has a dot', 'github.com/example'],
    ['a scheme-less SSH-looking form', 'git@github.com/example/repo'],
    ['an SSH form on another host', `git${AT}gitlab.com:example/repo.git`],
    ['an extra path segment', 'https://github.com/example/repo/tree/main'],
    ['an extra segment in the short form', 'example/repo/extra'],
    ['an extra segment in the SSH form', 'git@github.com:example/repo/extra.git'],
    ['a query string', 'https://github.com/example/repo?tab=readme'],
    ['a fragment', 'https://github.com/example/repo#readme'],
    ['credentials in the url', `https://user:token${AT}github.com/example/repo`],
    ['a port', 'https://github.com:443/example/repo'],
    ['an owner that leads with a dash', '-example/repo'],
    ['an owner that leads with a dash, https', 'https://github.com/-example/repo'],
    ['a repo that leads with a dash', 'example/-repo'],
    ['an owner that leads with a dot', '.example/repo'],
    ['an owner that leads with an underscore', '_example/repo'],
    ['an owner with a dot (GitHub owners have none)', 'owner.with.dot/repo'],
    ['an owner with an underscore', 'owner_x/repo'],
    ['an owner with a dot, https', 'https://github.com/owner.x/repo'],
    ['an owner with a dot, SSH', 'git@github.com:owner.x/repo.git'],
    ['a dot repo', 'example/.'],
    ['a dot-dot repo', 'example/..'],
    ['a dot-dot repo, https', 'https://github.com/example/..'],
    ['a dot repo once .git is stripped', 'example/..git'],
    ['a dot-dot repo once .git is stripped', 'example/...git'],
    ['a repo that is only .git', 'example/.git'],
    ['a repo named x.git.git', 'example/repo.git.git'],
    ['an owner alone', 'example'],
    ['an empty string', ''],
    ['blanks only', '   '],
    ['a doubled slash', 'example//repo'],
    ['a trailing slash on the short form', 'example/repo/'],
    ['a non-ASCII letter', 'example/répo'],
    ['an upper-case host', 'https://GitHub.com/example/repo'],
  ])('%s: %s', (_what, input) => {
    expect(parseGithubRepo(input)).toBeNull();
  });
});

describe('isNewProjectName', () => {
  it(`takes a leading letter or digit, then [A-Za-z0-9._-], up to ${PROJECT_NAME_MAX} bytes`, () => {
    expect(PROJECT_NAME_MAX).toBe(64);
    for (const ok of ['project-a', 'a', '9lives', 'my.project_2', 'A-b.c_d']) expect(isNewProjectName(ok), ok).toBe(true);
    expect(isNewProjectName('a'.repeat(64))).toBe(true);
    expect(isNewProjectName('a'.repeat(65))).toBe(false);
  });

  it.each([
    ['empty', ''], ['a leading dot', '.hidden'], ['a leading dash', '-flag'], ['a leading underscore', '_under'],
    ['a slash', 'a/b'], ['a blank', 'a b'], ['dot-dot', '..'], ['a .git suffix', 'repo.git'], ['only .git', '.git'],
    ['a newline', 'a\nb'], ['a non-ASCII letter', 'projét'],
  ])('refuses %s: %j', (_what, s) => {
    expect(isNewProjectName(s)).toBe(false);
  });
});

describe('deriveProjectName', () => {
  it("is the repo's own name, .git already stripped by the parse", () => {
    const r = parseGithubRepo('https://github.com/example/repo.git');
    expect(r).not.toBeNull();
    expect(deriveProjectName(r!)).toBe('repo');
  });

  it('is null for a repo name that leads with a dot or an underscore: the operator names that project', () => {
    expect(deriveProjectName(parseGithubRepo('example/.github')!)).toBeNull();
    expect(deriveProjectName(parseGithubRepo('example/_tools')!)).toBeNull();
  });

  it(`is null for a repo name past ${PROJECT_NAME_MAX} bytes, which the parse still accepts`, () => {
    const long = parseGithubRepo(`example/${'r'.repeat(65)}`);
    expect(long?.repo).toBe('r'.repeat(65));
    expect(deriveProjectName(long!)).toBeNull();
    expect(deriveProjectName(parseGithubRepo(`example/${'r'.repeat(64)}`)!)).toBe('r'.repeat(64));
  });
});
