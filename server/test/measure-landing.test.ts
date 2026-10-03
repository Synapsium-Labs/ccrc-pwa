// `deploy/measure-landing.py` — the landing-order programme's instrument
// (spec 2026-09-23 §10). It runs by hand on the fleet box, where the host `gh`
// carries a repo-WRITE token, so the property that matters most is the one it
// states first: it READS. Two halves pin that, and neither trusts the other:
// the static half reads the file's own argv literals; the behavioural half runs
// a subcommand against a recording `gh` stub and reads what was actually asked.
// The same two halves hold its second door, `~/.local/bin/ccrc-api`, whose
// table also carries POST rows: only `runs list` and `mail list` may pass.
// The rest pins the pure decisions every baseline number is derived from, each
// by a case that goes red when its rule is bent (the plan's mutation table).
//
// Every python3 spawn carries PYTHONDONTWRITEBYTECODE: loading the tool as a
// module would otherwise leave `deploy/__pycache__/` behind (gitignored, but a
// directory walk of `deploy/` would read it — the ccgpt harness's precedent).
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.resolve(here, '..', '..', 'deploy', 'measure-landing.py');
const src = readFileSync(TOOL, 'utf8');
const PYENV = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };
const LOAD = [
  'import importlib.util, json, sys',
  `s = importlib.util.spec_from_file_location("ml", ${JSON.stringify(TOOL)})`,
  'm = importlib.util.module_from_spec(s); s.loader.exec_module(m)',
];

/** Evaluate one Python expression against the imported module `m`, with `a`
 *  bound to the JSON argument, and return its JSON value. The module is
 *  loaded by path (its name has a hyphen) and its `main` never runs. */
const py = (expr: string, a: unknown = null): any => {
  const code = [...LOAD, 'a = json.loads(sys.stdin.read())', `print(json.dumps(${expr}))`].join('\n');
  const r = spawnSync('python3', ['-c', code], { input: JSON.stringify(a), encoding: 'utf8', env: PYENV });
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout);
};

/** A fixture HOME whose PATH starts with a recording `gh` (the given case arms)
 *  and whose `~/.local/bin/ccrc-api` records too. Nothing real is reachable. */
const stubHome = (ghCases: string[] = [], apiCases: string[] = []): { home: string; env: NodeJS.ProcessEnv } => {
  const home = mkTmp('ccrc-measure-landing-');
  const bin = join(home, 'bin');
  const local = join(home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  mkdirSync(local, { recursive: true });
  writeFileSync(join(bin, 'gh'), ['#!/bin/sh', 'printf \'%s\\n\' "$*" >> "$HOME/gh-calls"',
    'case "$*" in', ...ghCases, '  *) echo \'{}\' ;;', 'esac'].join('\n') + '\n', { mode: 0o755 });
  writeFileSync(join(local, 'ccrc-api'), ['#!/bin/sh', 'printf \'%s\\n\' "$*" >> "$HOME/api-calls"',
    'case "$*" in', ...apiCases, '  *) echo \'{}\' ;;', 'esac'].join('\n') + '\n', { mode: 0o755 });
  return { home, env: { ...PYENV, HOME: home, PATH: `${bin}:${process.env['PATH'] ?? ''}` } };
};
const calls = (home: string, file: string): string[] | null =>
  existsSync(join(home, file)) ? readFileSync(join(home, file), 'utf8').trim().split('\n') : null;
const tool = (h: { home: string; env: NodeJS.ProcessEnv }, args: string[]) =>
  spawnSync('python3', [TOOL, ...args, '--out', join(h.home, 'out')], { encoding: 'utf8', cwd: h.home, env: h.env });
const inModule = (h: { home: string; env: NodeJS.ProcessEnv }, stmt: string) =>
  spawnSync('python3', ['-c', [...LOAD, stmt].join('\n')], { encoding: 'utf8', env: h.env });

describe('measure-landing: it reads GitHub and never writes it', () => {
  it('runs gh from exactly one argv, and that argv is a GET', () => {
    const argv = [...src.matchAll(/subprocess\.run\(\[\s*'gh'[^\]]*\]/g)].map((m) => m[0]);
    expect(argv, 'gh is run from more or fewer than one place').toHaveLength(1);
    expect(argv[0]).toBe("subprocess.run(['gh', 'api', '-X', 'GET', path]");
    expect(src, 'a second method is spelled somewhere').not.toMatch(/'(POST|PUT|PATCH|DELETE)'|--method|--field|'-f'|'-F'/);
  });

  it('runs git for object reads only — cat-file and show', () => {
    const verbs = [...src.matchAll(/\['git', '-C', clone, '([a-z-]+)'/g)].map((m) => m[1]);
    expect(new Set(verbs)).toEqual(new Set(['cat-file', 'show']));
    expect(src.match(/subprocess\.run\(\['git'/g) ?? [], 'git is run outside the -C clone form').toHaveLength(verbs.length);
  });

  it('refuses a path that is not a plain REST read, before gh runs', () => {
    const h = stubHome();
    for (const bad of ['-X POST repos/o/r/pulls/1/merge', 'repos/o/r/pulls/1 --method PUT', 'graphql', '/repos/o/r']) {
      const r = inModule(h, `m._gh(${JSON.stringify(bad)})`);
      expect(r.status, `${bad} was not refused`).not.toBe(0);
      expect(r.stderr).toContain('refused a GitHub path');
    }
    expect(calls(h.home, 'gh-calls'), 'gh ran for a refused path').toBeNull();
  });

  it('refuses a path with a `..` segment: the grammar is no way round the graphql refusal', () => {
    // Each of these matched the character-class grammar and, resolved by the
    // server, names `graphql` (or another endpoint) the plain-REST pin refuses.
    const h = stubHome();
    for (const bad of ['repos/a/b/../../../graphql', 'repos/../../graphql?query=%7Bviewer%7D', 'repos/a/b/..', 'repos/../b/x']) {
      const r = inModule(h, `m._gh(${JSON.stringify(bad)})`);
      expect(r.status, `${bad} was not refused`).not.toBe(0);
      expect(r.stderr).toContain('refused a GitHub path');
    }
    // A name that merely CONTAINS dots is a name, not a traversal.
    for (const ok of ['repos/a/b.c', 'repos/a/b/contents/x..y', 'repos/a/b/commits/v1..v2', 'repos/a/b/actions/runs?created=2026-09-08..2026-09-22']) {
      const r = inModule(h, `assert m.GH_PATH.match(${JSON.stringify(ok)}), ${JSON.stringify(ok)}`);
      expect(r.status, `${ok} was refused: ${r.stderr}`).toBe(0);
    }
    expect(calls(h.home, 'gh-calls'), 'gh ran for a refused path').toBeNull();
  });

  it('asks GitHub only GETs, measured through a recording stub', () => {
    const h = stubHome([
      '  *rules/branches/main*) echo \'[{"type":"required_status_checks","parameters":{"required_status_checks":[{"context":"test (server)"}]}}]\' ;;',
      '  *required_status_checks*) echo \'{"contexts":["build-pwa"]}\' ;;',
    ]);
    const r = tool(h, ['required', 'o/r']);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).required).toEqual(['build-pwa', 'test (server)']);
    expect(calls(h.home, 'gh-calls')).toEqual([
      'api -X GET repos/o/r/rules/branches/main',
      'api -X GET repos/o/r/branches/main/protection/required_status_checks',
    ]);
  });

  it('reaches ccrc-api from one door, for its two list verbs only (static and behavioural)', () => {
    // The client's table carries POST rows (runs close, mail send, ledger
    // allocate); a hand-run instrument that reached one would write the
    // coordination store. Every `_api(` call site names a list verb, and the
    // door itself refuses anything else before the client runs.
    const sites = [...src.matchAll(/_api\('([a-z]+)', '([a-z-]+)'/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(new Set(sites)).toEqual(new Set(['runs list', 'mail list']));
    expect(src.match(/_api\(/g)!.length - 1, 'an _api call site names its verb some other way').toBe(sites.length);
    const h = stubHome();
    for (const bad of ["'runs', 'close', '7'", "'mail', 'send', '--json', '-'", "'ledger', 'allocate'"]) {
      const r = inModule(h, `m._api(${bad})`);
      expect(r.status, `_api(${bad}) was not refused`).not.toBe(0);
      expect(r.stderr).toContain('refused a ccrc-api verb that is not a list read');
    }
    expect(calls(h.home, 'api-calls'), 'ccrc-api ran for a refused verb').toBeNull();
  });
});

describe('measure-landing: an input it could not read is never a number', () => {
  it('required: refuses a repository whose required contexts read as nothing, and caches nothing', () => {
    // Both endpoints answer, and neither names a context (or both fail): an
    // empty set would make every later verdict green, and a cached one would
    // make it so on every re-run.
    const h = stubHome(['  *rules/branches/main*) echo \'[]\' ;;']);
    const r = tool(h, ['required', 'o/r']);
    expect(r.status, 'an empty required set was accepted').not.toBe(0);
    expect(r.stderr).toContain('no required status context could be read');
    expect(existsSync(join(h.home, 'out', 'cache', 'required-o_r.json')), 'the empty read was cached').toBe(false);
  });

  it('absorptions: refuses a run with no --fleet-login before it reads anything', () => {
    const h = stubHome();
    const r = tool(h, ['absorptions', 'o/r']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('--fleet-login L1,L2 is required');
    expect(calls(h.home, 'gh-calls'), 'gh ran before the fleet was named').toBeNull();
  });

  it('inversions: refuses a run with no --fleet-login before it reads anything, a cache write included', () => {
    // `cmd_inversions(repo, req(), …, fleet_logins(args))` evaluated `req()` first:
    // two GETs and a cache file before the refusal the docstring promises. The stub
    // must answer a REAL required context: with its default `{}` answers the read is
    // an empty set that the empty-set refusal rejects before anything is cached, so
    // the cache stays empty under either evaluation order and pins nothing.
    const h = stubHome(['  *required_status_checks*) echo \'{"contexts":["build-pwa"]}\' ;;']);
    const r = tool(h, ['inversions', 'o/r']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('--fleet-login L1,L2 is required');
    // Soft, so a failure of the first does not hide the second: each is a pin of its own.
    expect.soft(calls(h.home, 'gh-calls'), 'gh ran before the fleet was named').toBeNull();
    const cache = join(h.home, 'out', 'cache');
    expect.soft(existsSync(cache) ? readdirSync(cache) : [], 'a cache file was written before the fleet was named').toEqual([]);
  });

  it('mail-latency: a full newest-first page is truncation, never data; a run with no claimant is skipped', () => {
    const at = Date.parse('2026-09-10T12:00:00Z');
    const row = (i: number) => ({ at: at + i, state: 'delivered' });
    const full = JSON.stringify({ ok: true, mail: Array.from({ length: 500 }, (_, i) => row(i)) });
    const one = JSON.stringify({ ok: true, mail: [row(0)] });
    const h = stubHome([], [
      '  *"runs list"*) echo \'{"runs":[{"claimedBy":null},{"claimedBy":"coord-full"},{"claimedBy":"coord-one"}]}\' ;;',
      `  *"--to coord-full"*) echo '${full}' ;;`,
      `  *"--to coord-one"*) echo '${one}' ;;`,
    ]);
    const r = tool(h, ['mail-latency']);
    expect(r.status, r.stderr).toBe(0);
    const d = JSON.parse(r.stdout);
    expect(d.coordinators, 'a null claimant was counted as a coordinator').toBe(2);
    expect(d.truncatedCoordinators, 'a full page was read as the whole history').toBe(1);
    expect(d.unmatched, "the truncated coordinator's mail was counted").toBe(1);
    expect(calls(h.home, 'api-calls')!.filter((c) => c.startsWith('mail list'))
      .every((c) => c.endsWith('--limit 500')), 'a mail read asked for the default page').toBe(true);
  });
  it('mail-latency: a closed-runs read at its cap is truncation, named in the output, never the whole history', () => {
    // `runs list --closed 1` answers every ACTIVE run plus only the newest 500
    // closed ones (`runs()`'s asymmetric clamp). Rows of an active run are not
    // closed ones: 3 active + 499 closed is under the cap, 3 active + 500 is not.
    const closedRows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: 1000 + i, claimedBy: 'coord-c', state: 'merged' }));
    const active = [{ id: 1, claimedBy: 'coord-c', state: 'working' }, { id: 2, claimedBy: 'coord-c', state: 'dispatched' },
      { id: 3, claimedBy: 'coord-c', state: 'unknown' }];
    const arms = (n: number) => [
      `  *"runs list --closed 1"*) echo '${JSON.stringify({ runs: [...active, ...closedRows(n)] })}' ;;`,
      `  *"runs list"*) echo '${JSON.stringify({ runs: active })}' ;;`,
      '  *"--to coord-c"*) echo \'{"ok":true,"mail":[]}\' ;;',
    ];
    const at = tool(stubHome([], arms(500)), ['mail-latency']);
    expect(at.status, at.stderr).toBe(0);
    expect(JSON.parse(at.stdout).runsTruncated, 'a closed-runs read at its cap was read as the whole history').toBe(true);
    const under = tool(stubHome([], arms(499)), ['mail-latency']);
    expect(under.status, under.stderr).toBe(0);
    expect(JSON.parse(under.stdout).runsTruncated, 'active runs were counted against the closed cap').toBe(false);
    expect(JSON.parse(under.stdout).closedRuns).toBe(499);
  });

  it('mail-latency: the closed-runs read is made BEFORE the open one, so a run closing between them counts as closed', () => {
    // The order is the whole of the skew argument (the comment above the two reads): a run
    // that closes between them is then in the closed read and absent from the open one, so
    // any skew OVERcounts toward `runsTruncated`; the other order drops it from both and
    // could read 500 - k as under the cap. A stateless stub answers each read the same
    // either way round, and swapping which read binds which name goes red for the wrong
    // reason, so the order is read from what the stub was ASKED, in the order it was asked.
    const h = stubHome([], [
      '  *"runs list --closed 1"*) echo \'{"runs":[{"id":1,"claimedBy":"coord-o","state":"working"}]}\' ;;',
      '  *"runs list"*) echo \'{"runs":[{"id":1,"claimedBy":"coord-o","state":"working"}]}\' ;;',
      '  *"--to coord-o"*) echo \'{"ok":true,"mail":[]}\' ;;',
    ]);
    const r = tool(h, ['mail-latency']);
    expect(r.status, r.stderr).toBe(0);
    expect(calls(h.home, 'api-calls')!.filter((c) => c.startsWith('runs list')),
      'the open runs read was made before the closed one: a run closing between them drops out of both').toEqual(['runs list --closed 1', 'runs list']);
  });

  it('mail-latency: every input left out is counted by name — an undelivered mail, a run with no claimant', () => {
    const at = Date.parse('2026-09-10T12:00:00Z');
    const mail = [
      { at, state: 'delivered' }, { at: at + 1, state: 'queued' }, { at: at + 2, state: 'rejected' },
      { at: at + 3, state: 'some-future-state' },
      // A mail the coordinator WAS nudged, then parked `rejected` when its run closed
      // (`cancelOutstandingDeliveries`): the read carries no `deliveredAt`, so it is
      // `undelivered` too — the docstring says so. This row adds no red the `at + 2`
      // `rejected` row above does not already give (`cmd_mail_latency` branches on
      // `state` alone and never reads `lastError`); it guards a FUTURE split keyed on
      // `lastError`, which only this row would red.
      { at: at + 4, state: 'rejected', lastError: 'run closed' },
      { at: Date.parse('2026-01-01T00:00:00Z'), state: 'queued' },   // outside the window: not an input of it
    ];
    const h = stubHome([], [
      '  *"runs list"*) echo \'{"runs":[{"id":1,"claimedBy":null},{"id":2,"claimedBy":null},{"id":3,"claimedBy":"coord-u"}]}\' ;;',
      `  *"--to coord-u"*) echo '${JSON.stringify({ ok: true, mail })}' ;;`,
    ]);
    const r = tool(h, ['mail-latency']);
    expect(r.status, r.stderr).toBe(0);
    const d = JSON.parse(r.stdout);
    expect(d.undelivered, 'a window mail that was never delivered or acked was left out silently').toBe(4);
    expect(d.runsWithoutClaimant, 'a run with no claimant was dropped without a count').toBe(2);
    expect(d.unmatched, 'an undelivered mail was counted as unmatched').toBe(1);
    const per = JSON.parse(readFileSync(join(h.home, 'out', 'mail-latency-2026-09-08-2026-09-22.json'), 'utf8')).perCoordinator['coord-u'];
    expect(per.undelivered).toBe(4);
  });
  it('mail-latency: its docstring says `undelivered` includes mail parked rejected at its run\'s close, which may have been nudged', () => {
    // `unmatched` and `minutes` count mail still read `delivered` or `acked`. A mail a
    // coordinator WAS handed and never acked reads `rejected` once its run closes, so
    // "counts only mail a coordinator was handed" overclaimed for `undelivered`'s
    // complement. The wire has no `deliveredAt` to split the two; the docstring owns it.
    const doc: string = py('m.cmd_mail_latency.__doc__').replace(/\s+/g, ' ');
    expect(doc).toContain("parked `rejected` at its run's close");
    expect(doc).toContain('may have been nudged');
    expect(doc, 'the overclaim is back').not.toContain('count only mail a coordinator was handed');
  });

  it('mail-latency: a refused or failed ccrc-api read is an error, never an empty page', () => {
    // The client exits 0 on EVERY HTTP answer, a 4xx body included, and exits 3
    // on a transport failure while still printing {"ok":false}. Read as data,
    // either would be `mail: []` — a coordinator counted with n 0, unmatched 0.
    const arms = (denied: string) => [
      '  *"runs list"*) echo \'{"runs":[{"claimedBy":"coord-a"},{"claimedBy":"coord-b"}]}\' ;;',
      `  *"--to coord-a"*) ${denied} ;;`,
      '  *"--to coord-b"*) echo \'{"ok":true,"mail":[]}\' ;;',
    ];
    const refused = stubHome([], arms('echo \'{"ok":false,"error":"unauthorized"}\''));
    const r = tool(refused, ['mail-latency']);
    expect(r.status, 'a refused read (exit 0, ok:false) was read as an empty page').not.toBe(0);
    expect(r.stderr).toContain('ccrc-api answered no data');
    expect(r.stderr).toContain('unauthorized');
    const down = stubHome([], arms('echo \'{"ok":false,"error":"transport"}\'; exit 3'));
    const t = tool(down, ['mail-latency']);
    expect(t.status, 'a transport failure (exit 3) was read as an empty page').not.toBe(0);
    expect(t.stderr).toContain('ccrc-api answered no data');
    // A body of some other shape (no ok, no list under the verb's key — a
    // framework's own 500) and a refused `runs list` are refused the same way.
    const odd = tool(stubHome([], arms('echo \'{"statusCode":500,"error":"Internal Server Error"}\'')), ['mail-latency']);
    expect(odd.status, 'a body with no mail list was read as an empty page').not.toBe(0);
    expect(odd.stderr).toContain('ccrc-api answered no data');
    const noRuns = tool(stubHome([], ['  *"runs list"*) echo \'{"ok":false,"error":"unauthorized"}\' ;;']), ['mail-latency']);
    expect(noRuns.status, 'a refused runs list was read as no coordinators').not.toBe(0);
    expect(noRuns.stderr).toContain('ccrc-api answered no data for \'runs list\'');
  });
});

describe('measure-landing: the decisions every baseline is derived from', () => {
  const C = (name: string, conclusion: string | null, completed_at = '2026-09-10T00:00:00Z') =>
    ({ name, conclusion, completed_at });

  it('required_state: green, red, and the unmeasured middle — a cancel is not a red, a re-run supersedes', () => {
    expect(py('m.required_state(a, ["build","test"])', [C('build', 'success'), C('test', 'success')])).toBe('green');
    expect(py('m.required_state(a, ["build","test"])', [C('build', 'success'), C('test', 'failure')])).toBe('red');
    expect(py('m.required_state(a, ["build","test"])', [C('build', 'success'), C('test', 'cancelled')])).toBe('unmeasured');
    expect(py('m.required_state(a, ["build","test"])', [C('build', 'success')])).toBe('unmeasured');
    expect(py('m.required_state(a, ["build","test"])', [C('build', 'success'), C('test', 'failure'),
      C('mac', 'failure'), C('test', 'success', '2026-09-10T01:00:00Z')]), 'the re-run is the verdict').toBe('green');
    expect(py('m.required_state(a, [])', [C('x', 'failure')]), 'no required context is not a verdict').toBe('unmeasured');
  });

  it('required_state: an in-progress LATEST attempt is unmeasured, never decided by an earlier one', () => {
    const running = (name: string) => ({ name, conclusion: null, completed_at: null });
    expect(py('m.required_state(a, ["test"])', [C('test', 'failure'), running('test')]), 'failure then running').toBe('unmeasured');
    expect(py('m.required_state(a, ["test"])', [running('test'), C('test', 'failure')]), 'the order of the list is not the order of the attempts').toBe('unmeasured');
    expect(py('m.required_state(a, ["test"])', [C('test', 'success'), running('test')]), 'success then running').toBe('unmeasured');
    expect(py('m.required_state(a, ["build","test"])', [C('build', 'failure'), C('test', 'success'), running('test')]),
      "another context's red still decides").toBe('red');
  });

  it('red_intervals: opens on red, closes only on green, and an open one ends at the window', () => {
    expect(py('m.red_intervals([tuple(x) for x in a], "END")', [
      ['t1', 'red'], ['t2', 'unmeasured'], ['t3', 'red'], ['t4', 'green'], ['t5', 'green'], ['t6', 'red'],
    ])).toEqual([['t1', 't4'], ['t6', 'END']]);
  });

  it("merge_of_main: a merge of the PR's own branch is not one; update-branch and a local merge are told apart", () => {
    const commit = (msg: string, p2: string, committer = 'dev', login: string | null = 'dev') => ({
      parents: [{ sha: 'p1' }, { sha: p2 }],
      commit: { message: msg, committer: { name: committer }, author: { name: 'dev' } },
      committer: login ? { login } : null, author: { login: 'dev' },
    });
    const own = ['p1', 'own2'];
    expect(py('m.merge_of_main(a[0], set(a[1]))', [commit("Merge remote-tracking branch 'origin/main' into ws/x", 'main9'), own])).toBe('local');
    expect(py('m.merge_of_main(a[0], set(a[1]))', [commit("Merge branch 'main' into ws/x", 'main9', 'GitHub', 'web-flow'), own])).toBe('update-branch');
    expect(py('m.merge_of_main(a[0], set(a[1]))', [commit("Merge remote-tracking branch 'origin/main' into ws/x", 'own2'), own]),
      'the second parent is the PR\'s own commit').toBeNull();
    expect(py('m.merge_of_main(a[0], set(a[1]))', [commit("Merge branch 'feature/y' into ws/x", 'other'), own])).toBeNull();
  });

  it('repeat_share: every merge past a PR\'s first is a repeat', () => {
    expect(py('m.repeat_share(a)', [1, 1, 2, 3, 3, 3])).toEqual([6, 3, 3]);
  });

  it('fleet_logins: the fleet is a set, from the list the operator names', () => {
    expect(py('sorted(m.fleet_logins({"fleet-login": a}))', 'fleet-a,fleet-b')).toEqual(['fleet-a', 'fleet-b']);
  });

  it('sync_kind: the transcript classifier, including the probe and the aborts it must not count', () => {
    const k = (cmd: string): unknown => py('m.sync_kind(a)', cmd);
    expect(k('git merge origin/main')).toBe('merge');
    expect(k('git pull --rebase origin main')).toBe('pull');
    expect(k('git merge --no-commit --no-ff origin/main')).toBe('probe');
    expect(k('gh pr update-branch 12')).toBe('update-branch');
    expect(k('git merge --abort')).toBeNull();
    expect(k('git merge-tree --write-tree HEAD origin/main')).toBeNull();
  });

  it('episode_class: conflict first, then ritual only when nothing was edited and no agent ran', () => {
    expect(py('m.episode_class(a)', { conflict: true, edits: 0, agents: 0 })).toBe('conflict');
    expect(py('m.episode_class(a)', { conflict: false, edits: 0, agents: 0 })).toBe('ritual');
    expect(py('m.episode_class(a)', { conflict: false, edits: 2, agents: 0 })).toBe('mixed');
  });
});
