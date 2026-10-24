/**
 * `ccd pr-landing` (PR-landing stage 1, spec 3.3, plan PL-1): the checks lane's read. One GraphQL query reads every
 * named PR by number, two GETs read the base's required-check names (cached 600 s), and the binding is the code
 * `pr-state` binds with. Read-only, of gh and of `$REG`: the censuses below hold both.
 *
 * FIXTURE HOMEs ONLY (`makePrHarness`). `gh` is a shell function that answers before PATH does and records every argv;
 * a snippet that forgot it would meet the base harness's poisoned `gh`, never the host's real token.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { CCD, WS_ADD } from './ccdWsHelpers.js';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ccd-prlanding-'); });
afterEach(() => { h.cleanup(); });

const ccdSeconds = (name: string): number => {
  const m = new RegExp(`^${name}=(\\d+)`, 'm').exec(readFileSync(CCD, 'utf8'));
  if (!m) throw new Error(`ccd no longer defines ${name} as a bare integer assignment`);
  return Number(m[1]);
};

/** A `gh` recording every call's argv NUL-separated (a record ends in 0x1e), answering the GraphQL read from
 *  `gql.json`, the rules read from `rules.json` and the branch view from `branch.json`, each with its own rc file. */
const GH = `
gh() {
  { printf '%s\\0' "$@"; printf '\\x1e'; } >> "$HOME/gh-landing.log"
  local rc=0
  case "$1 $2" in
    'api graphql') [[ -f "$HOME/gql-rc" ]] && rc=$(cat "$HOME/gql-rc"); [[ -f "$HOME/gql.json" ]] && cat "$HOME/gql.json"; return "$rc" ;;
  esac
  case "$1 $2" in
    'api repos/o/r/rules/branches/'*) [[ -f "$HOME/rules-rc" ]] && rc=$(cat "$HOME/rules-rc")
      if [[ -f "$HOME/rules-\${2##*/}.json" ]]; then cat "$HOME/rules-\${2##*/}.json"; elif [[ -f "$HOME/rules.json" ]]; then cat "$HOME/rules.json"; fi; return "$rc" ;;
    'api repos/o/r/branches/'*) if [[ -f "$HOME/branch-\${2##*/}.json" ]]; then cat "$HOME/branch-\${2##*/}.json"; elif [[ -f "$HOME/branch.json" ]]; then cat "$HOME/branch.json"; fi; return 0 ;;
    'pr list') echo '[]'; return 0 ;;
  esac
  return 1
};
timeout() { case "$1" in -*) return 125 ;; esac; { printf 'timeout %s\\n' "$1"; } >> "$HOME/gh-timeouts"; shift; "$@"; };
`;

const put = (name: string, body: unknown): void => {
  fs.writeFileSync(path.join(h.home, name), typeof body === 'string' ? body : JSON.stringify(body));
};
const calls = (): string[][] => {
  const f = path.join(h.home, 'gh-landing.log');
  return fs.existsSync(f)
    ? fs.readFileSync(f, 'utf8').split('\x1e').filter((r) => r !== '').map((r) => r.split('\0').filter((t, i, a) => i < a.length - 1 || t !== ''))
    : [];
};
const timeouts = (): string[] => {
  const f = path.join(h.home, 'gh-timeouts');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
};

/** A workspace plus one commit; returns the tip the binding is pointed at. */
const workspace = (project: string, slug: string): string => {
  h.makeGhRepo(project);
  h.sh(`${WS_ADD} CCD_WS_SLUG=${slug} cmd_ws_add ${project}`);
  const wt = path.join(h.home, 'worktrees', project, slug);
  fs.writeFileSync(path.join(wt, 'f.txt'), `work ${slug}\n`);
  h.git(wt, 'add', 'f.txt');
  h.git(wt, 'commit', '-m', `the work ${slug}`);
  return h.git(wt, 'rev-parse', 'HEAD');
};
const second = (project: string, slug: string): string => {
  h.sh(`${WS_ADD} CCD_WS_SLUG=${slug} cmd_ws_add ${project}`);
  const wt = path.join(h.home, 'worktrees', project, slug);
  fs.writeFileSync(path.join(wt, 'f.txt'), `work ${slug}\n`);
  h.git(wt, 'add', 'f.txt');
  h.git(wt, 'commit', '-m', `the work ${slug}`);
  return h.git(wt, 'rev-parse', 'HEAD');
};

type Ctx = Record<string, unknown>;
const run = (name: string, conclusion: string | null, over: Ctx = {}): Ctx => ({
  __typename: 'CheckRun', name, status: conclusion === null ? 'IN_PROGRESS' : 'COMPLETED', conclusion,
  databaseId: 1000, checkSuite: { app: { databaseId: 15368 }, workflowRun: { databaseId: 77 } }, isRequired: true, ...over,
});
const status = (context: string, state: string, over: Ctx = {}): Ctx => ({
  __typename: 'StatusContext', context, state, isRequired: true, ...over,
});
/** One alias's PR object, in `gh pr list`'s shape plus the head commit's rollup contexts. */
const pr = (number: number, slug: string, tip: string, contexts: Ctx[] = [], over: Ctx = {}): Ctx => ({
  number, state: 'OPEN', isDraft: false, isCrossRepository: false, headRefName: `ws/${slug}`, baseRefName: 'main',
  headRefOid: tip, commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: contexts } } } }] }, ...over,
});
const answer = (prs: (Ctx | null)[]): unknown => ({
  data: { repository: Object.fromEntries(prs.map((p, i) => [`p${i}`, p])) },
});
const emptyRules = (): void => { put('rules.json', []); put('branch.json', { protected: false }); };

const landing = (project: string, pairs: string): { code: number; lines: Record<string, any>[]; stderr: string } => {
  const r = h.run(`cd "$HOME" && ${GH} cmd_pr_landing --project ${project} --sessions ${pairs}`);
  return { code: r.code, stderr: r.stderr, lines: r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>) };
};

describe('pr-landing argv', () => {
  it('a session of another project is refused', () => {
    workspace('demo', 'quiet-basin');
    h.makeGhRepo('other');
    const r = h.run(`${GH} cmd_pr_landing --project other --sessions demo-quiet-basin:41`);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(calls()).toEqual([]);
  });

  it('17 ids are refused', () => {
    workspace('demo', 'quiet-basin');
    const pairs = Array.from({ length: 17 }, (_, i) => `demo-quiet-basin${i}:${40 + i}`).join(',');
    const r = h.run(`${GH} cmd_pr_landing --project demo --sessions ${pairs}`);
    expect(r.code).toBe(1);
    expect(calls()).toEqual([]);
  });

  it('an id with a space is refused', () => {
    workspace('demo', 'quiet-basin');
    const r = h.run(`${GH} cmd_pr_landing --project demo --sessions "demo-quiet basin:41"`);
    expect(r.code).toBe(1);
    expect(calls()).toEqual([]);
  });

  it.each(['0', '07', '12a'])('a <pr> of %s is refused', (n) => {
    workspace('demo', 'quiet-basin');
    const r = h.run(`${GH} cmd_pr_landing --project demo --sessions demo-quiet-basin:${n}`);
    expect(r.code).toBe(1);
    expect(calls()).toEqual([]);
  });

  it('a glob in the sessions argument is never expanded', () => {
    workspace('demo', 'quiet-basin');
    fs.writeFileSync(path.join(h.home, 'x:41'), '');
    const r = h.run(`cd "$HOME" && ${GH} cmd_pr_landing --project demo --sessions '*:41'`);
    expect(r.code).toBe(1);
  });
});

describe('the GraphQL read', () => {
  it('one call answers three sessions', () => {
    const t0 = workspace('demo', 'quiet-basin');
    const t1 = second('demo', 'still-cove');
    const t2 = second('demo', 'brisk-ridge');
    put('gql.json', answer([pr(41, 'quiet-basin', t0), pr(42, 'still-cove', t1), pr(43, 'brisk-ridge', t2)]));
    emptyRules();
    const r = landing('demo', 'demo-quiet-basin:41,demo-still-cove:42,demo-brisk-ridge:43');
    expect(r.lines.map((l) => [l.id, l.bound, l.number])).toEqual([
      ['demo-quiet-basin', true, 41], ['demo-still-cove', true, 42], ['demo-brisk-ridge', true, 43]]);
    expect(calls().filter((c) => c[0] === 'api' && c[1] === 'graphql')).toHaveLength(1);
    expect(timeouts()).toContain(`timeout ${ccdSeconds('PR_LANDING_GQL_TIMEOUT')}`);
  });

  it('the document selects the App id under checkSuite, never on the CheckRun itself (GitHub validates this, the fixture gh does not)', () => {
    const t0 = workspace('demo', 'quiet-basin');
    put('gql.json', answer([pr(41, 'quiet-basin', t0)]));
    emptyRules();
    landing('demo', 'demo-quiet-basin:41');
    const q = calls().find((c) => c[1] === 'graphql')!.find((a) => a.startsWith('query='))!;
    const checkRun = /\.\.\. on CheckRun \{([^]*?isRequired\([^)]*\))/.exec(q)![1]!;
    expect(checkRun.replace(/\s+/g, ' ').trim()).toBe(
      'name status conclusion databaseId checkSuite { app { databaseId } workflowRun { databaseId } } isRequired(pullRequestNumber: $n0)');
  });

  it("a CheckRun's App id is read from checkSuite.app", () => {
    const t0 = workspace('demo', 'quiet-basin');
    put('gql.json', answer([pr(41, 'quiet-basin', t0, [run('build', 'SUCCESS', { checkSuite: { app: { databaseId: 777 }, workflowRun: { databaseId: 5 } } })])]));
    emptyRules();
    const l = landing('demo', 'demo-quiet-basin:41').lines[0]!;
    expect(l.required[0]).toMatchObject({ appId: 777, runId: 5 });
  });

  it('the document for 3 sessions declares exactly $n0..$n2', () => {
    const t0 = workspace('demo', 'quiet-basin');
    const t1 = second('demo', 'still-cove');
    const t2 = second('demo', 'brisk-ridge');
    put('gql.json', answer([pr(4173, 'quiet-basin', t0), pr(4274, 'still-cove', t1), pr(4375, 'brisk-ridge', t2)]));
    emptyRules();
    landing('demo', 'demo-quiet-basin:4173,demo-still-cove:4274,demo-brisk-ridge:4375');
    const argv = calls().find((c) => c[1] === 'graphql')!;
    const q = argv.find((a) => a.startsWith('query='))!;
    const decl = /^query\(([^)]*)\)/.exec(q.slice('query='.length))![1]!;
    expect([...decl.matchAll(/\$(\w+): (\w+!?)/g)].map((m) => `${m[1]}:${m[2]}`)).toEqual(
      ['o:String!', 'r:String!', 'n0:Int!', 'n1:Int!', 'n2:Int!']);
    expect(q).not.toMatch(/\$n3\b/);
    expect(q).toMatch(/repository\(owner: \$o, name: \$r\)/);
    expect(q).toContain('p2: pullRequest(number: $n2)');
    expect(q).not.toContain('p3:');
  });

  it('the PR number reaches gh only as -F n0=<int>', () => {
    const t0 = workspace('demo', 'quiet-basin');
    put('gql.json', answer([pr(4173, 'quiet-basin', t0)]));
    emptyRules();
    landing('demo', 'demo-quiet-basin:4173');
    const argv = calls().find((c) => c[1] === 'graphql')!;
    expect(argv).toContain('n0=4173');
    expect(argv[argv.indexOf('n0=4173') - 1]).toBe('-F');
    expect(argv.filter((a) => a.includes('4173'))).toEqual(['n0=4173']);
    expect(argv.find((a) => a.startsWith('query='))).not.toContain('4173');
    expect(argv).toContain('o=o');
    expect(argv).toContain('r=r');
  });

  it('a landing PR older than the newest 100 still binds, and no `gh pr list` call is made', () => {
    const t0 = workspace('demo', 'quiet-basin');
    put('gql.json', answer([pr(3, 'quiet-basin', t0)]));
    emptyRules();
    const r = landing('demo', 'demo-quiet-basin:3');
    expect(r.lines[0]).toMatchObject({ id: 'demo-quiet-basin', bound: true, number: 3 });
    expect(calls().filter((c) => c[0] === 'pr')).toEqual([]);
  });

  it('an alias answered with no object is unmeasured pr-unreadable, never bound:false', () => {
    const t0 = workspace('demo', 'quiet-basin');
    second('demo', 'still-cove');
    put('gql.json', answer([pr(41, 'quiet-basin', t0), null]));
    emptyRules();
    const r = landing('demo', 'demo-quiet-basin:41,demo-still-cove:42');
    expect(r.lines[1]).toEqual({ id: 'demo-still-cove', unmeasured: ['pr-unreadable'] });
    expect(r.lines[0]!.bound).toBe(true);
  });

  it('gh exiting 1 with a body whose one alias is null still binds the sibling and reads the null as pr-unreadable', () => {
    const t0 = workspace('demo', 'quiet-basin');
    second('demo', 'still-cove');
    const body = answer([pr(41, 'quiet-basin', t0), null]) as Record<string, unknown>;
    body.errors = [{ type: 'NOT_FOUND', path: ['repository', 'p1'], message: 'Could not resolve to a PullRequest' }];
    put('gql.json', JSON.stringify(body));
    put('gql-rc', '1');
    emptyRules();
    const r = landing('demo', 'demo-quiet-basin:41,demo-still-cove:42');
    expect(r.lines[1]).toEqual({ id: 'demo-still-cove', unmeasured: ['pr-unreadable'] });
    expect(r.lines[0]!.bound).toBe(true);
  });

  it('gh exiting 1 with no usable body is unmeasured graphql', () => {
    workspace('demo', 'quiet-basin');
    put('gql.json', '{"errors":[{"message":"Field x doesn\'t exist"}]}');
    put('gql-rc', '1');
    expect(landing('demo', 'demo-quiet-basin:41').lines).toEqual([{ id: 'demo-quiet-basin', unmeasured: ['graphql'] }]);
  });

  it('the GraphQL call timing out answers unmeasured graphql and still prints one line per id', () => {
    workspace('demo', 'quiet-basin');
    second('demo', 'still-cove');
    put('gql-rc', '124');
    const r = landing('demo', 'demo-quiet-basin:41,demo-still-cove:42');
    expect(r.code).toBe(0);
    expect(r.lines).toEqual([{ id: 'demo-quiet-basin', unmeasured: ['graphql'] }, { id: 'demo-still-cove', unmeasured: ['graphql'] }]);
    expect(calls().filter((c) => c[1] !== 'graphql')).toEqual([]);
  });

  it('an answer that is not the shape the query asks for is unmeasured graphql', () => {
    workspace('demo', 'quiet-basin');
    put('gql.json', '<html>bad gateway</html>');
    expect(landing('demo', 'demo-quiet-basin:41').lines).toEqual([{ id: 'demo-quiet-basin', unmeasured: ['graphql'] }]);
  });
});

describe('the required contexts', () => {
  const one = (ctxs: Ctx[], over: Ctx = {}): Record<string, any> => {
    const t0 = workspace('demo', 'quiet-basin');
    put('gql.json', answer([pr(41, 'quiet-basin', t0, ctxs, over)]));
    emptyRules();
    return landing('demo', 'demo-quiet-basin:41').lines[0]!;
  };

  it('a check name containing $(touch x) and a newline is carried as JSON and nothing runs', () => {
    const name = 'build $(touch x)\n`touch y`';
    const l = one([run(name, 'SUCCESS')]);
    expect(l.required[0].name).toBe(name);
    expect(fs.existsSync(path.join(h.home, 'x'))).toBe(false);
    expect(fs.existsSync(path.join(h.home, 'y'))).toBe(false);
    expect(fs.existsSync('x')).toBe(false);
  });

  it('a name in the rules read but absent from the rollup is listed in rulesNamed with no context', () => {
    const t0 = workspace('demo', 'quiet-basin');
    put('gql.json', answer([pr(41, 'quiet-basin', t0, [run('lint', 'SUCCESS')])]));
    put('rules.json', [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'lint' }, { context: 'e2e' }] } },
      { type: 'deletion' }]);
    put('branch.json', { protected: true, protection: { required_status_checks: { contexts: ['unit'], checks: [{ context: 'sec', app_id: 1 }] } } });
    const l = landing('demo', 'demo-quiet-basin:41').lines[0]!;
    expect(l.rulesNamed).toEqual(['lint', 'e2e']);
    expect(l.protectionNamed).toEqual(['unit', 'sec']);
    expect(l.required.map((c: Ctx) => c.name)).toEqual(['lint']);
    expect(l.unmeasured).toEqual([]);
  });

  it('a protection check with app_id lists its name in pinnedNames', () => {
    const t0 = workspace('demo', 'quiet-basin');
    put('gql.json', answer([pr(41, 'quiet-basin', t0, [run('lint', 'SUCCESS')])]));
    put('rules.json', [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'lint', integration_id: 15368 }, { context: 'e2e' }] } }]);
    put('branch.json', { protected: true, protection: { required_status_checks: { contexts: ['unit'], checks: [{ context: 'sec', app_id: 15368 }, { context: 'any', app_id: -1 }] } } });
    const l = landing('demo', 'demo-quiet-basin:41').lines[0]!;
    expect([...l.pinnedNames].sort()).toEqual(['lint', 'sec']);
  });

  it('a line with no pinned name carries an empty pinnedNames', () => {
    const t0 = workspace('demo', 'quiet-basin');
    put('gql.json', answer([pr(41, 'quiet-basin', t0, [run('lint', 'SUCCESS')])]));
    put('rules.json', [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'lint' }] } }]);
    put('branch.json', { protected: true, protection: { required_status_checks: { contexts: ['unit'] } } });
    expect(landing('demo', 'demo-quiet-basin:41').lines[0]!.pinnedNames).toEqual([]);
  });

  it('a status under a pinned name is carried although GitHub does not mark it required', () => {
    const t0 = workspace('demo', 'quiet-basin');
    put('gql.json', answer([pr(41, 'quiet-basin', t0, [status('deploy', 'SUCCESS', { isRequired: false }), run('other', 'SUCCESS', { isRequired: false })])]));
    put('rules.json', [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'deploy', integration_id: 7 }] } }]);
    put('branch.json', { protected: true, protection: { required_status_checks: { contexts: [] } } });
    const l = landing('demo', 'demo-quiet-basin:41').lines[0]!;
    expect(l.required.map((c: Ctx) => c.name)).toEqual(['deploy']);
    expect(l.pinnedNames).toEqual(['deploy']);
  });

  it('a check run from another App under a pinned name, not marked required, is not carried', () => {
    const t0 = workspace('demo', 'quiet-basin');
    put('gql.json', answer([pr(41, 'quiet-basin', t0, [
      run('lint', 'SUCCESS', { isRequired: false, checkSuite: { app: { databaseId: 999 }, workflowRun: { databaseId: 5 } } }),
    ])]));
    put('rules.json', [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'lint', integration_id: 15368 }] } }]);
    put('branch.json', { protected: false });
    const l = landing('demo', 'demo-quiet-basin:41').lines[0]!;
    expect(l.required).toEqual([]);
    expect(l.rulesNamed).toEqual(['lint']);
    expect(l.pinnedNames).toEqual(['lint']);
  });

  it('a status under a pinned name is carried and pinnedNames lists it (the protection document pins too)', () => {
    const t0 = workspace('demo', 'quiet-basin');
    put('gql.json', answer([pr(41, 'quiet-basin', t0, [status('sec', 'SUCCESS', { isRequired: false }), status('free', 'SUCCESS', { isRequired: false })])]));
    put('rules.json', []);
    put('branch.json', { protected: true, protection: { required_status_checks: { checks: [{ context: 'sec', app_id: 15368 }, { context: 'free', app_id: -1 }] } } });
    const l = landing('demo', 'demo-quiet-basin:41').lines[0]!;
    expect(l.required.map((c: Ctx) => c.name)).toEqual(['sec']);
    expect(l.pinnedNames).toEqual(['sec']);
  });

  it('a same-named non-required check run failing does not make the line red', () => {
    const t0 = workspace('demo', 'quiet-basin');
    put('gql.json', answer([pr(41, 'quiet-basin', t0, [
      run('lint', 'SUCCESS', { databaseId: 1 }),
      run('lint', 'FAILURE', { databaseId: 2, isRequired: false, checkSuite: { app: { databaseId: 999 }, workflowRun: { databaseId: 6 } } }),
    ])]));
    put('rules.json', [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'lint', integration_id: 15368 }] } }]);
    put('branch.json', { protected: false });
    const l = landing('demo', 'demo-quiet-basin:41').lines[0]!;
    expect(l.required).toHaveLength(1);
    expect(l.required[0]).toMatchObject({ name: 'lint', state: 'SUCCESS', appId: 15368, checkId: 1 });
  });

  it('a check run with an empty conclusion and IN_PROGRESS keeps its status', () => {
    const l = one([run('build', null)]);
    expect(l.required[0]).toMatchObject({ name: 'build', state: 'IN_PROGRESS', appId: 15368, checkId: 1000, runId: 77 });
  });

  it('a rerun attempt of the same workflow run carries the same runId and a new checkId', () => {
    const t0 = workspace('demo', 'quiet-basin');
    emptyRules();
    put('gql.json', answer([pr(41, 'quiet-basin', t0, [run('build', 'FAILURE', { databaseId: 1000 })])]));
    const a = landing('demo', 'demo-quiet-basin:41').lines[0]!.required[0];
    put('gql.json', answer([pr(41, 'quiet-basin', t0, [run('build', 'SUCCESS', { databaseId: 1001 })])]));
    const b = landing('demo', 'demo-quiet-basin:41').lines[0]!.required[0];
    expect(a.runId).toBe(77);
    expect(b.runId).toBe(a.runId);
    expect(b.checkId).not.toBe(a.checkId);
  });

  it('a commit status carries checkId: null', () => {
    const l = one([status('ci/legacy', 'SUCCESS', { createdAt: '2026-10-01T10:00:00Z' })]);
    expect(l.required[0]).toEqual({ name: 'ci/legacy', appId: null, state: 'SUCCESS', checkId: null, runId: null });
  });

  it('a context that is not marked required is not in the required list', () => {
    const l = one([run('build', 'SUCCESS'), run('optional', 'SUCCESS', { isRequired: false })]);
    expect(l.required.map((c: Ctx) => c.name)).toEqual(['build']);
  });

  it('41 required contexts are cut at 32 with requiredCut: true', () => {
    const l = one(Array.from({ length: 41 }, (_, i) => run(`job-${i}`, 'SUCCESS', { databaseId: 2000 + i })));
    expect(l.required).toHaveLength(32);
    expect(l.requiredCut).toBe(true);
  });

  it('a name is cut to 120 bytes', () => {
    const l = one([run('é'.repeat(100), 'SUCCESS')]);
    expect(Buffer.byteLength(l.required[0].name)).toBeLessThanOrEqual(120);
  });

  it('a closed bound PR carries state CLOSED, and a draft isDraft: true', () => {
    expect(one([], { state: 'CLOSED' })).toMatchObject({ bound: true, state: 'CLOSED', isDraft: false });
  });

  it('a draft carries isDraft: true', () => {
    expect(one([], { isDraft: true })).toMatchObject({ bound: true, state: 'OPEN', isDraft: true });
  });
});

describe('the rules cache', () => {
  const cachePath = (): string => path.join(h.home, '.cc-sessions', 'pr-landing', 'demo.rules.main.json');
  const restCalls = (): string[][] => calls().filter((c) => c[0] === 'api' && c[1] !== 'graphql');
  const setup = (): void => {
    const t0 = workspace('demo', 'quiet-basin');
    put('gql.json', answer([pr(41, 'quiet-basin', t0, [run('lint', 'SUCCESS')])]));
    put('rules.json', [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'lint' }] } }]);
    put('branch.json', { protected: false });
  };

  it('a cache miss makes exactly two REST calls, and a hit none', () => {
    setup();
    landing('demo', 'demo-quiet-basin:41');
    expect(restCalls().map((c) => c[1])).toEqual(['repos/o/r/rules/branches/main', 'repos/o/r/branches/main']);
    expect(timeouts().filter((t) => t === `timeout ${ccdSeconds('PR_LANDING_REST_TIMEOUT')}`)).toHaveLength(2);
    expect(fs.existsSync(cachePath())).toBe(true);
    fs.rmSync(path.join(h.home, 'gh-landing.log'));
    const l = landing('demo', 'demo-quiet-basin:41').lines[0]!;
    expect(restCalls()).toEqual([]);
    expect(l.rulesNamed).toEqual(['lint']);
  });

  it('a fresh cache is used and a stale one re-read', () => {
    setup();
    landing('demo', 'demo-quiet-basin:41');
    const doc = JSON.parse(fs.readFileSync(cachePath(), 'utf8'));
    doc.rules = { names: ['cached-name'], cut: false };
    doc.at = Math.floor(Date.now() / 1000) - 599 + 5;
    fs.writeFileSync(cachePath(), JSON.stringify(doc));
    fs.rmSync(path.join(h.home, 'gh-landing.log'));
    expect(landing('demo', 'demo-quiet-basin:41').lines[0]!.rulesNamed).toEqual(['cached-name']);
    expect(restCalls()).toEqual([]);
    doc.at = Math.floor(Date.now() / 1000) - 601;
    fs.writeFileSync(cachePath(), JSON.stringify(doc));
    expect(landing('demo', 'demo-quiet-basin:41').lines[0]!.rulesNamed).toEqual(['lint']);
    expect(restCalls()).toHaveLength(2);
  });

  it('an unreadable cache is a miss', () => {
    setup();
    fs.mkdirSync(path.dirname(cachePath()), { recursive: true });
    fs.writeFileSync(cachePath(), '{not json');
    expect(landing('demo', 'demo-quiet-basin:41').lines[0]!.rulesNamed).toEqual(['lint']);
    expect(restCalls()).toHaveLength(2);
  });

  it('a read failure is a miss, is named, and is never cached', () => {
    setup();
    put('rules-rc', '1');
    const l = landing('demo', 'demo-quiet-basin:41').lines[0]!;
    expect(l.unmeasured).toEqual(['rules']);
    expect(l.bound).toBe(true);
    expect(fs.existsSync(cachePath())).toBe(false);
  });

  it('REST reads go to at most one uncached base per call; the next pass fills the other', () => {
    const t0 = workspace('demo', 'quiet-basin');
    const t1 = second('demo', 'tall-fern');
    h.git(path.join(h.home, 'projects', 'demo'), 'branch', 'release', 'HEAD');
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-tall-fern.base'), 'origin/release\n');
    put('gql.json', answer([pr(41, 'quiet-basin', t0, [run('lint', 'SUCCESS')]), pr(42, 'tall-fern', t1, [run('e2e', 'SUCCESS')], { baseRefName: 'release' })]));
    put('rules-main.json', [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'lint' }] } }]);
    put('rules-release.json', [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'e2e' }] } }]);
    put('branch.json', { protected: false });
    const first = landing('demo', 'demo-quiet-basin:41,demo-tall-fern:42').lines;
    expect(restCalls().map((c) => c[1]).sort()).toEqual(['repos/o/r/branches/main', 'repos/o/r/rules/branches/main']);
    expect(first.map((l) => l.rulesNamed)).toEqual([['lint'], []]);
    expect(first.map((l) => l.unmeasured)).toEqual([[], ['rules', 'protection']]);
    expect(fs.existsSync(cachePath())).toBe(true);
    expect(fs.existsSync(cachePath().replace('main', 'release'))).toBe(false);
    fs.rmSync(path.join(h.home, 'gh-landing.log'));
    const second2 = landing('demo', 'demo-quiet-basin:41,demo-tall-fern:42').lines;
    expect(restCalls().map((c) => c[1]).sort()).toEqual(['repos/o/r/branches/release', 'repos/o/r/rules/branches/release']);
    expect(second2.map((l) => l.rulesNamed)).toEqual([['lint'], ['e2e']]);
    expect(second2.map((l) => l.unmeasured)).toEqual([[], []]);
    fs.rmSync(path.join(h.home, 'gh-landing.log'));
    expect(landing('demo', 'demo-quiet-basin:41,demo-tall-fern:42').lines.map((l) => l.rulesNamed)).toEqual([['lint'], ['e2e']]);
    expect(restCalls()).toEqual([]);
  });

  it('no REST call is made when nothing bound', () => {
    workspace('demo', 'quiet-basin');
    put('gql.json', answer([null]));
    landing('demo', 'demo-quiet-basin:41');
    expect(restCalls()).toEqual([]);
  });
});

describe('the binding', () => {
  it('a PR whose base is not the workspace registry base answers bound:false and prints no required list', () => {
    const t0 = workspace('demo', 'quiet-basin');
    put('gql.json', answer([pr(41, 'quiet-basin', t0, [run('lint', 'SUCCESS')], { baseRefName: 'release' })]));
    emptyRules();
    expect(landing('demo', 'demo-quiet-basin:41').lines).toEqual([{ id: 'demo-quiet-basin', bound: false }]);
  });

  it('a branch-drift workspace answers unmeasured branch-drift and writes nothing', () => {
    const t0 = workspace('demo', 'quiet-basin');
    const wt = path.join(h.home, 'worktrees', 'demo', 'quiet-basin');
    h.git(wt, 'checkout', '-q', '-b', 'feat/x');
    put('gql.json', answer([pr(41, 'quiet-basin', t0)]));
    emptyRules();
    const before = regTree();
    const r = landing('demo', 'demo-quiet-basin:41');
    expect(r.lines).toEqual([{ id: 'demo-quiet-basin', unmeasured: ['branch-drift'] }]);
    expect(regTree()).toEqual(before);
  });

  /** For every binding fixture `pr-state` uses, `pr-landing` named with that PR's number binds exactly when `pr-state` does. */
  it('answers bound:true exactly when pr-state binds that PR', () => {
    const tip = workspace('demo', 'quiet-basin');
    const stranger = h.git(path.join(h.home, 'projects', 'demo'), 'rev-parse', 'HEAD');
    const fixtures: [string, Ctx][] = [
      ['bound', {}],
      ['not ours', { headRefOid: '1234567' }],
      ['cross-repository', { isCrossRepository: true }],
      ['other base', { baseRefName: 'release' }],
      ['other branch', { headRefName: 'ws/elsewhere' }],
    ];
    void stranger;
    let boundBoth = 0, unboundBoth = 0;
    for (const [label, over] of fixtures) {
      const row = pr(42, 'quiet-basin', tip, [], over);
      const { commits: _c, ...listRow } = row;
      void _c;
      fs.writeFileSync(path.join(h.home, 'gh-rows.json'), JSON.stringify([{ ...listRow, mergedAt: null, mergeCommit: null, url: 'u', title: 't' }]));
      const state = JSON.parse(h.sh(`
gh() { printf '%s\\n' "$*" >> "$HOME/gh-calls"; cat "$HOME/gh-rows.json"; };
timeout() { shift; "$@"; };
cmd_pr_state --session demo-quiet-basin`).split('\n')[0]!);
      put('gql.json', answer([row]));
      emptyRules();
      const l = landing('demo', 'demo-quiet-basin:42').lines[0]!;
      expect(l.bound === true, label).toBe(state.number === 42);
      if (label === 'bound') expect([state.number, l.bound, l.number], label).toEqual([42, true, 42]);
      if (l.bound === true && state.number === 42) boundBoth++;
      if (l.bound !== true && state.number !== 42) unboundBoth++;
    }
    expect(boundBoth).toBeGreaterThanOrEqual(1);
    expect(unboundBoth).toBeGreaterThanOrEqual(1);
  });
});

/** Every file of the fixture registry, outside `pr-landing/`, with its content hash. */
function regTree(): Record<string, string> {
  const reg = path.join(h.home, '.cc-sessions');
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      const rel = path.relative(reg, p);
      if (rel === 'pr-landing') continue;
      if (e.isDirectory()) { out[`${rel}/`] = 'dir'; walk(p); } else out[rel] = createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    }
  };
  walk(reg);
  return out;
}

describe('read-only censuses', () => {
  it('across every fixture path the gh argvs are only graphql queries and api GETs', () => {
    const t0 = workspace('demo', 'quiet-basin');
    second('demo', 'still-cove');
    emptyRules();
    put('gql.json', answer([pr(41, 'quiet-basin', t0, [run('lint', 'FAILURE')]), null]));
    landing('demo', 'demo-quiet-basin:41,demo-still-cove:42');
    put('gql-rc', '124');
    landing('demo', 'demo-quiet-basin:41');
    put('gql-rc', '0'); put('rules-rc', '1');
    landing('demo', 'demo-quiet-basin:41');
    const all = calls();
    expect(all.length).toBeGreaterThan(3);
    for (const argv of all) {
      expect(argv[0], argv.join(' ')).toBe('api');
      expect(argv.some((a) => /^(-X|--method)$/.test(a)), argv.join(' ')).toBe(false);
      if (argv[1] === 'graphql') expect(argv.find((a) => a.startsWith('query='))).not.toMatch(/mutation/i);
      else expect(argv[1]).toMatch(/^repos\/o\/r\/(rules\/)?branches\/main$/);
    }
  });

  it('across every fixture path no registry file outside pr-landing/ is created, modified or appended', () => {
    const t0 = workspace('demo', 'quiet-basin');
    second('demo', 'still-cove');
    emptyRules();
    h.sh('_reg_set demo-quiet-basin prphase open; _reg_set demo-quiet-basin prnumber 41');
    const before = regTree();
    put('gql.json', answer([pr(41, 'quiet-basin', t0, [run('lint', 'FAILURE')]), null]));
    landing('demo', 'demo-quiet-basin:41,demo-still-cove:42');
    put('gql.json', answer([pr(99, 'quiet-basin', t0, [], { baseRefName: 'release' })]));
    landing('demo', 'demo-quiet-basin:99');
    put('gql-rc', '124');
    landing('demo', 'demo-quiet-basin:41');
    expect(regTree()).toEqual(before);
    expect(Object.keys(before).some((k) => /prstate|prhistory/.test(k) && k.endsWith('.lock'))).toBe(false);
  });

  it('is dispatched, advertised in caps and named in the usage line', () => {
    expect(h.sh('cmd_caps').split('\n')).toContain('pr-landing');
    expect(h.sh('cmd_caps').split('\n')).toContain('pr-landing-v1');
    const src = readFileSync(CCD, 'utf8');
    expect(src).toContain('pr-landing) shift; cmd_pr_landing "$@" ;;');
  });
});
