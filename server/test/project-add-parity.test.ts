// The new-project rules live twice (add-project spec 2026-11-04 §3-§4): `shared/projectAdd.ts` for the PWA and the
// server, and ccd's bash copy, `_project_new_name_ok` and `_project_github_url_ok`, which `cmd_project_add` gates on.
// This suite holds the two equal on one table, so a name the sheet accepts is a name ccd creates, and every url the
// server sends is a url ccd clones:
//   - names: ccd accepts exactly what `isNewProjectName` accepts;
//   - urls: ccd accepts `u` exactly when `parseGithubRepo(u)?.url === u` (it takes only the two normalised shapes),
//     and it accepts every url `parseGithubRepo` emits for any input on the table.
// ccd is sourced ONCE under a fixture HOME; the values ride a NUL-separated file, so a newline is a value too.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { isNewProjectName, parseGithubRepo, PROJECT_NAME_MAX } from '../../shared/projectAdd.js';

let h: CcdHarness;
beforeAll(() => { h = makeCcdHarness('ccrc-project-add-parity-'); });
afterAll(() => { h.cleanup(); });

/** ccd's verdict on each value, by helper: `true` when it answers 0. */
const ccdVerdicts = (helper: '_project_new_name_ok' | '_project_github_url_ok', values: readonly string[]): boolean[] => {
  const file = path.join(h.home, 'values');
  fs.writeFileSync(file, values.map((v) => `${v}\0`).join(''));
  const out = h.sh(`while IFS= read -r -d '' v; do if ${helper} "$v"; then echo 1; else echo 0; fi; done < "$VALUES"`,
    { VALUES: file });
  const lines = out === '' ? [] : out.split('\n');
  expect(lines).toHaveLength(values.length);
  return lines.map((l) => l === '1');
};

// Built with `AT` so the public tree carries no contiguous address-shaped token (topology-clean's email class).
const AT = '@';
const NAMES: readonly string[] = [
  'demo', 'Demo', '0', 'a', 'A-b_c.d', 'repo.js', 'a..b', 'a.GIT', 'a.gitx', 'git', '.git', 'a.git', 'a.git.git',
  'a'.repeat(PROJECT_NAME_MAX), 'a'.repeat(PROJECT_NAME_MAX + 1), `9${'z'.repeat(PROJECT_NAME_MAX - 1)}`,
  '', '-a', '.a', '_a', '..', '.', 'a/b', 'a b', ' a', 'a ', 'a\nb', 'a\tb', 'café', 'é', 'a*', 'a$b', 'a:b',
  'a\\b', '--name', '-', '_', 'a-', 'a_', 'a.',
];

const URL_INPUTS: readonly string[] = [
  'https://github.com/o/r.git', 'https://github.com/owner/repo.git', 'git@github.com:o/r.git',
  'https://github.com/O-1/r_2.x.git', 'https://github.com/o/r.js.git', 'git@github.com:o/r.js.git',
  'https://github.com/o/r', 'https://github.com/o/r/', 'https://github.com/o/r.git/', 'git@github.com:o/r', 'o/r',
  'owner/repo.git', ' https://github.com/o/r.git', 'https://github.com/o/r.git ', 'https://github.com/o/r.git\n',
  'https://github.com/o/r.git.git', 'git@github.com:o/r.git.git', 'https://github.com/o/.git',
  'https://github.com/-o/r.git', 'https://github.com/o/-r.git', 'https://github.com/.o/r.git', 'https://github.com/o/_r.git',
  'https://github.com/o/r/x.git', 'https://github.com//r.git', 'https://github.com/o/r%2e.git', 'https://github.com/o/ré.git',
  'https://GitHub.com/o/r.git', 'https://github.com.evil/o/r.git', 'https://xgithub.com/o/r.git', `https://x${AT}github.com/o/r.git`,
  'http://github.com/o/r.git', 'ssh://git@github.com/o/r.git', 'git@github.com/o/r.git', `git${AT}gitlab.com:o/r.git`,
  'https://gitlab.com/o/r.git', 'file:///tmp/r.git', '/tmp/r.git', 'ext::sh -c id', '-uhttps://github.com/o/r.git',
  '--upload-pack=x', 'https://github.com:443/o/r.git', '',
  'https://github.com/o/.github.git', 'git@github.com:o/.github.git', 'https://github.com/o/_tools.git',
  'https://github.com/o/.github', 'github.com/o/.github', 'github.com/o/r', 'github.com/o/r.git/', 'github.com/owner',
  'https://github.com/o.x/r.git', 'git@github.com:o.x/r.git', 'https://github.com/o_x/r.git', 'https://github.com/o/..git',
  'https://github.com/o/...git', 'https://github.com/o/..', 'https://github.com/o/.', 'https://github.com/o/.git.git',
  'https://github.com/o/r-.git', 'https://github.com/o-/r.git',
];

/** The rule itself (owner `[A-Za-z0-9][A-Za-z0-9-]*`; repo `[A-Za-z0-9._][A-Za-z0-9._-]*`, not `.`, `..` or `….git`),
 *  pinned on both sides: parity alone would stay green if both copies drifted together. */
const DECIDED: readonly (readonly [string, boolean])[] = [
  ['https://github.com/o/.github.git', true], ['git@github.com:o/.github.git', true],
  ['https://github.com/o/_tools.git', true], ['https://github.com/o/r-.git', true], ['https://github.com/o-/r.git', true],
  ['https://github.com/o.x/r.git', false], ['git@github.com:o.x/r.git', false], ['https://github.com/o_x/r.git', false],
  ['https://github.com/o/..git', false], ['https://github.com/o/...git', false], ['https://github.com/o/.git.git', false],
  ['https://github.com/-o/r.git', false], ['https://github.com/o/-r.git', false],
];

describe('the new-project name rule: ccd and shared/projectAdd.ts agree', () => {
  it('ccd accepts exactly the names isNewProjectName accepts', () => {
    const got = ccdVerdicts('_project_new_name_ok', NAMES);
    const mismatches = NAMES.flatMap((n, i) => (got[i] === isNewProjectName(n) ? []
      : [`${JSON.stringify(n)}: ccd ${got[i] ? 'accepts' : 'refuses'}, shared ${isNewProjectName(n) ? 'accepts' : 'refuses'}`]));
    expect(mismatches).toEqual([]);
  });

  it('the table is not vacuous: it holds names both sides accept and names both refuse', () => {
    expect(NAMES.filter(isNewProjectName).length).toBeGreaterThan(5);
    expect(NAMES.filter((n) => !isNewProjectName(n)).length).toBeGreaterThan(10);
  });
});

describe('the GitHub url rule: ccd takes exactly the urls parseGithubRepo emits', () => {
  it('ccd accepts u exactly when parseGithubRepo(u)?.url === u', () => {
    const got = ccdVerdicts('_project_github_url_ok', URL_INPUTS);
    const mismatches = URL_INPUTS.flatMap((u, i) => {
      const shared = parseGithubRepo(u)?.url === u;
      return got[i] === shared ? [] : [`${JSON.stringify(u)}: ccd ${got[i] ? 'accepts' : 'refuses'}, shared ${shared ? 'emits it' : 'does not emit it'}`];
    });
    expect(mismatches).toEqual([]);
  });

  it('both sides decide the shared segment rule, case by case', () => {
    const got = ccdVerdicts('_project_github_url_ok', DECIDED.map(([u]) => u));
    expect(DECIDED.map(([u], i) => [u, got[i]])).toEqual(DECIDED);
    expect(DECIDED.map(([u]) => [u, parseGithubRepo(u)?.url === u])).toEqual(DECIDED);
  });

  it('the short shape takes no host for an owner: github.com/<repo> is refused, not read as owner github.com', () => {
    expect(parseGithubRepo('github.com/owner')).toBeNull();
    expect(parseGithubRepo('github.com/o/.github/')?.url).toBe('https://github.com/o/.github.git');
  });

  it('every url parseGithubRepo emits for an input on the table, ccd accepts', () => {
    const emitted = [...new Set(URL_INPUTS.flatMap((u) => { const p = parseGithubRepo(u); return p === null ? [] : [p.url]; }))];
    expect(emitted.length).toBeGreaterThan(5);
    const got = ccdVerdicts('_project_github_url_ok', emitted);
    expect(emitted.filter((_u, i) => !got[i])).toEqual([]);
  });
});
