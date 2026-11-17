// D-6926 (a root-cause fix from the landing measurement): a pull request that is not a ledger pull request
// may not modify or delete an existing file under docs/superpowers/programs/ or docs/superpowers/plans/.
// It may ADD a per-task note under docs/superpowers/programs/<programme>/<task-or-pr>.md (D-8719; before it, the
// route was docs/superpowers/plans/<plan>/); the coordinator folds the notes into the ledger in one ledger pull
// request per wave. D-8719's layout arm: a file ADDED, COPIED or RENAMED INTO docs/superpowers/specs/ or
// docs/superpowers/plans/ must take the review judge's layout (format F1) on every branch, with no trailer escape. A `Ledger-Edit: <reason>` trailer on the HEAD
// commit of the change is the escape hatch (only the head commit's trailers count), and the guard reports it. Fixture repositories only: every git
// child runs with the repository-redirecting variables removed, so a test can never write into the real repo.
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { isGitRedirectVar } from './scrub-git-env.mjs';
import { classifyChange, layoutViolations } from '../../.github/ci/ledger-guard.mjs';

const GUARD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.github', 'ci', 'ledger-guard.mjs');

const cleanEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!isGitRedirectVar(k)) env[k] = v;
  delete env.GITHUB_HEAD_REF; delete env.GITHUB_EVENT_NAME; delete env.GITHUB_STEP_SUMMARY;
  return { ...env, ...extra };
};
const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', ...args],
    { cwd, encoding: 'utf8', env: cleanEnv(), stdio: 'pipe' });
const put = (dir: string, rel: string, text: string): void => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), text);
};

/** A repo whose `main` holds a programme ledger and a plan; returns it with `origin/main` set. */
function fixture(): string {
  const dir = mkTmp('ledger-guard-');
  git(dir, 'init', '-q', '-b', 'main');
  put(dir, 'docs/superpowers/programs/x.md', '| row | open |\n');
  put(dir, 'docs/superpowers/plans/2026-01-01-p.md', '# plan\n');
  put(dir, 'docs/superpowers/plans/p/t0.md', 'note\n');
  put(dir, 'src/a.txt', 'a\n');
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(dir, 'checkout', '-q', '-b', 'work');
  return dir;
}
const commit = (dir: string, msg: string): void => { git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', msg); };

function run(dir: string, branch: string, extra: Record<string, string> = {}, args: string[] = []) {
  const summary = path.join(dir, '.summary');
  const r = spawnSync('node', [GUARD, '--repo', dir, '--base', 'origin/main', ...args], {
    encoding: 'utf8', env: cleanEnv({ GITHUB_HEAD_REF: branch, GITHUB_EVENT_NAME: 'pull_request', GITHUB_STEP_SUMMARY: summary, ...extra }),
  });
  let sum = ''; try { sum = readFileSync(summary, 'utf8'); } catch { /* none written */ }
  return { code: r.status, out: `${r.stdout}${r.stderr}`, sum };
}

describe('ledger-guard CLI', () => {
  it('(1) a feature branch editing a programme ledger fails', () => {
    const d = fixture();
    put(d, 'docs/superpowers/programs/x.md', '| row | done |\n'); commit(d, 'edit ledger');
    const r = run(d, 'feat/thing');
    expect(r.code).toBe(1);
    expect(r.out).toContain('docs/superpowers/programs/x.md');
  });

  it('(1b) editing, deleting or renaming an existing plan fails; the same edit on a plan note fails too', () => {
    const d = fixture();
    put(d, 'docs/superpowers/plans/2026-01-01-p.md', '# plan 2\n'); commit(d, 'edit plan');
    expect(run(d, 'feat/thing').code).toBe(1);
    git(d, 'reset', '-q', '--hard', 'origin/main');
    git(d, 'rm', '-q', 'docs/superpowers/plans/2026-01-01-p.md'); commit(d, 'delete plan');
    expect(run(d, 'feat/thing').code).toBe(1);
    git(d, 'reset', '-q', '--hard', 'origin/main');
    git(d, 'mv', 'docs/superpowers/plans/2026-01-01-p.md', 'docs/elsewhere.md'); commit(d, 'rename plan away');
    expect(run(d, 'feat/thing').code).toBe(1);
    git(d, 'reset', '-q', '--hard', 'origin/main');
    put(d, 'docs/superpowers/plans/p/t0.md', 'note 2\n'); commit(d, 'edit an existing plan note');
    const n = run(d, 'feat/thing');
    expect(n.code).toBe(1);
    expect(n.out).toContain('docs/superpowers/plans/p/t0.md');
  });

  it('(2) a feature branch adding a per-task note, a new plan or a new programme file passes', () => {
    const d = fixture();
    put(d, 'docs/superpowers/programs/p/t1.md', 'note\n');
    put(d, 'docs/superpowers/plans/2026-02-02-q.md', '# new\n');
    put(d, 'src/a.txt', 'b\n'); commit(d, 'add note');
    const r = run(d, 'feat/thing');
    expect(r.code).toBe(0);
  });

  it('(3) a ledger/ branch editing a programme ledger passes', () => {
    const d = fixture();
    put(d, 'docs/superpowers/programs/x.md', '| row | done |\n'); commit(d, 'fold');
    expect(run(d, 'ledger/x').code).toBe(0);
  });

  it('(4) the Ledger-Edit trailer passes and is reported in the step summary', () => {
    const d = fixture();
    put(d, 'docs/superpowers/programs/x.md', '| row | done |\n');
    commit(d, 'edit ledger\n\nLedger-Edit: D-' + '9999 the row is this change\'s own');
    const r = run(d, 'feat/thing');
    expect(r.code).toBe(0);
    expect(r.sum).toContain('Ledger-Edit');
    expect(r.sum).toContain('D-' + '9999');
    expect(r.sum).toContain('docs/superpowers/programs/x.md');
  });

  it('(4a) a trailer on an earlier commit, not the head commit, does not count', () => {
    const d = fixture();
    put(d, 'docs/superpowers/programs/x.md', '| row | done |\n');
    commit(d, 'edit ledger\n\nLedger-Edit: D-' + '9999 the row is this change\'s own');
    put(d, 'src/a.txt', 'later\n'); commit(d, 'a later commit with no trailer');
    expect(run(d, 'feat/thing').code).toBe(1);
  });

  it('(4b) a trailer with no reason does not count', () => {
    const d = fixture();
    put(d, 'docs/superpowers/programs/x.md', '| row | done |\n');
    commit(d, 'edit ledger\n\nLedger-Edit:');
    expect(run(d, 'feat/thing').code).toBe(1);
  });

  it('(5) a shallow clone skips with a notice', () => {
    const d = fixture();
    put(d, 'docs/superpowers/programs/x.md', '| row | done |\n'); commit(d, 'edit ledger');
    const shallow = mkTmp('ledger-guard-shallow-');
    git(shallow, 'clone', '-q', '--depth', '1', `file://${d}`, 'c');
    const c = path.join(shallow, 'c');
    git(c, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    const r = run(c, 'feat/thing');
    expect(r.code).toBe(0);
    expect(r.out.toLowerCase()).toContain('shallow');
  });

  it('a merge-queue run skips with a notice (the head branch is not known there)', () => {
    const d = fixture();
    put(d, 'docs/superpowers/programs/x.md', '| row | done |\n'); commit(d, 'edit ledger');
    const r = run(d, '', { GITHUB_EVENT_NAME: 'merge_group' });
    expect(r.code).toBe(0);
    expect(r.out).toContain('merge_group');
  });

  it('warn mode reports the violation and exits 0; enforce is the default', () => {
    const d = fixture();
    put(d, 'docs/superpowers/programs/x.md', '| row | done |\n'); commit(d, 'edit ledger');
    const w = run(d, 'feat/thing', {}, ['--mode', 'warn']);
    expect(w.code).toBe(0);
    expect(w.out).toContain('docs/superpowers/programs/x.md');
    expect(run(d, 'feat/thing').code).toBe(1);
  });

  it('a branch with no name (a detached local run) is treated as a feature branch', () => {
    const d = fixture();
    put(d, 'docs/superpowers/programs/x.md', '| row | done |\n'); commit(d, 'edit ledger');
    expect(run(d, '').code).toBe(1);
  });
});

// D-8719: the layout arm. The repo's review judge (format F1) refuses a NEW file under the specs or plans directory that
// is not a dated spec, its promise-ids file or a dated plan directly in that directory; the guard mirrors it in-repo.
const SPEC_OK = 'docs/superpowers/specs/2026-03-03-a-thing-design.md';
const IDS_OK = 'docs/superpowers/specs/2026-03-03-a-thing-design.promise-ids.json';
const PLAN_OK = 'docs/superpowers/plans/2026-03-03-a-thing.md';
const slug = (n: number): string => 'a'.repeat(n);

describe('ledger-guard CLI: the layout arm (D-8719)', () => {
  const refused = (paths: string[], branch = 'feat/thing', msg = 'add'): ReturnType<typeof run> => {
    const d = fixture();
    for (const p of paths) put(d, p, 'x\n');
    commit(d, msg);
    return run(d, branch);
  };

  it('(L1) an added task note at plans/<plan>/x.md fails, names the path and points at the programs route', () => {
    const r = refused(['docs/superpowers/plans/p/x.md']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('layout');
    expect(r.out).toContain('docs/superpowers/plans/p/x.md');
    expect(r.out).toContain('docs/superpowers/programs/<programme>/<task-or-pr>.md');
  });

  it('(L2) an added spec without -design fails', () => {
    const r = refused(['docs/superpowers/specs/2026-03-03-a-thing.md']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('docs/superpowers/specs/2026-03-03-a-thing.md');
    expect(r.out).toContain('YYYY-MM-DD-<slug>-design.md');
  });

  it('(L3) an added .html spec fails: a new spec is markdown', () => {
    expect(refused(['docs/superpowers/specs/2026-03-03-a-thing-design.html']).code).toBe(1);
  });

  it('(L4) a 41-character slug fails; 40 characters pass, in a plan, a spec and a promise-ids file', () => {
    expect(refused([`docs/superpowers/plans/2026-03-03-${slug(41)}.md`]).code).toBe(1);
    expect(refused([`docs/superpowers/specs/2026-03-03-${slug(41)}-design.md`]).code).toBe(1);
    expect(refused([`docs/superpowers/specs/2026-03-03-${slug(41)}-design.promise-ids.json`]).code).toBe(1);
    expect(refused([
      `docs/superpowers/plans/2026-03-03-${slug(40)}.md`,
      `docs/superpowers/specs/2026-03-03-${slug(40)}-design.md`,
      `docs/superpowers/specs/2026-03-03-${slug(40)}-design.promise-ids.json`,
    ]).code).toBe(0);
  });

  it('(L5) a double-hyphen slug fails, in a plan and in a spec', () => {
    expect(refused(['docs/superpowers/plans/2026-03-03-a--thing.md']).code).toBe(1);
    expect(refused(['docs/superpowers/specs/2026-03-03-a--thing-design.md']).code).toBe(1);
  });

  it('(L6) a file added in a subdirectory of specs/ or plans/ fails, even with a valid name', () => {
    const r = refused(['docs/superpowers/specs/2026-03-03-x/2026-03-03-a-thing-design.md']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('docs/superpowers/specs/2026-03-03-x/2026-03-03-a-thing-design.md');
    const p = refused(['docs/superpowers/plans/2026-03-03-x/2026-03-03-a-thing.md']);
    expect(p.code).toBe(1);
    expect(p.out).toContain('docs/superpowers/plans/2026-03-03-x/2026-03-03-a-thing.md');
  });

  it('(L7) a rename INTO plans/<dir>/ fails by its target; a rename into a valid plan name passes', () => {
    const d = fixture();
    git(d, 'mv', 'src/a.txt', 'docs/superpowers/plans/p/moved.md'); commit(d, 'rename in');
    const r = run(d, 'feat/thing');
    expect(r.code).toBe(1);
    expect(r.out).toContain('docs/superpowers/plans/p/moved.md');
    const ok = fixture();
    git(ok, 'mv', 'src/a.txt', PLAN_OK); commit(ok, 'rename in');
    expect(run(ok, 'feat/thing').code).toBe(0);
  });

  it('(L8) it holds on a ledger/ branch too', () => {
    expect(refused(['docs/superpowers/plans/p/x.md'], 'ledger/p').code).toBe(1);
  });

  it('(L9) no Ledger-Edit trailer escapes it', () => {
    const r = refused(['docs/superpowers/plans/p/x.md'], 'feat/thing', 'add\n\nLedger-Edit: D-' + '9999 a reason');
    expect(r.code).toBe(1);
    expect(r.out).toContain('layout');
  });

  it('(L10) a path git quotes (a character outside the slug set) under plans/ fails', () => {
    expect(refused(['docs/superpowers/plans/2026-03-03-café.md']).code).toBe(1);
  });

  it('(L11) warn mode reports a layout violation and exits 0', () => {
    const d = fixture();
    put(d, 'docs/superpowers/plans/p/x.md', 'x\n'); commit(d, 'add');
    const w = run(d, 'feat/thing', {}, ['--mode', 'warn']);
    expect(w.code).toBe(0);
    expect(w.out).toContain('docs/superpowers/plans/p/x.md');
  });

  it('(P1) a valid spec, plan and promise-ids file pass', () => {
    expect(refused([SPEC_OK, PLAN_OK, IDS_OK]).code).toBe(0);
  });

  it('(P2) an added programs/<programme>/x.md passes', () => {
    expect(refused(['docs/superpowers/programs/p/x.md']).code).toBe(0);
  });

  it('(P3) an edit to an existing nested note is not a layout violation (the edit arm still owns it)', () => {
    const d = fixture();
    put(d, 'docs/superpowers/plans/p/t0.md', 'note 2\n'); commit(d, 'edit an existing plan note');
    expect(run(d, 'ledger/p').code).toBe(0);
  });

  it('(P4) a deleted nested note is not a layout violation', () => {
    const d = fixture();
    git(d, 'rm', '-q', 'docs/superpowers/plans/p/t0.md'); commit(d, 'delete a note');
    expect(run(d, 'ledger/p').code).toBe(0);
  });
});

describe('the ledger guard job in ci.yml (D-6926: armed)', () => {
  // Read the job's own block so a mode set elsewhere in the workflow cannot satisfy the pin.
  const CI = path.resolve(path.dirname(GUARD), '..', 'workflows', 'ci.yml');
  const job = (): string => {
    const text = readFileSync(CI, 'utf8');
    const start = text.indexOf('\n  ledger-guard:\n');
    expect(start).toBeGreaterThan(-1);
    const rest = text.slice(start + 1);
    const next = rest.slice(1).search(/\n  [A-Za-z#]/);
    return next < 0 ? rest : rest.slice(0, next + 1);
  };

  it('runs in enforce mode, so a violation fails the check', () => {
    expect(job()).toMatch(/^ {6}LEDGER_GUARD_MODE: enforce$/m);
    expect(job()).not.toMatch(/LEDGER_GUARD_MODE: warn/);
  });

  it('runs the guard script against the pull request base', () => {
    expect(job()).toContain('node .github/ci/ledger-guard.mjs --repo "$GITHUB_WORKSPACE" --base "origin/${{ github.base_ref }}"');
  });
});

describe('classifyChange', () => {
  it('only existing files under the two ledger trees are violations', () => {
    const v = classifyChange([
      'M\tdocs/superpowers/programs/x.md',
      'D\tdocs/superpowers/plans/a.md',
      'R100\tdocs/superpowers/plans/b.md\tdocs/c.md',
      'A\tdocs/superpowers/plans/p/t.md',
      'A\tdocs/superpowers/programs/new.md',
      'M\tdocs/superpowers/specs/s.md',
      'M\tserver/src/a.ts',
    ]);
    expect(v).toEqual([
      'docs/superpowers/programs/x.md', 'docs/superpowers/plans/a.md', 'docs/superpowers/plans/b.md',
    ]);
  });
});

describe('layoutViolations (D-8719)', () => {
  it('only an added, copied or renamed-in file under specs/ or plans/ outside the layout is a violation', () => {
    const v = layoutViolations([
      'A\tdocs/superpowers/plans/p/t.md',
      `A\t${PLAN_OK}`,
      `A\t${SPEC_OK}`,
      `A\t${IDS_OK}`,
      'A\tdocs/superpowers/plans/2026-03-03-a-thing-design.promise-ids.json',
      'C90\tdocs/superpowers/plans/2026-01-01-p.md\tdocs/superpowers/plans/copy.md',
      'R100\tsrc/a.txt\tdocs/superpowers/specs/nested/2026-03-03-a-thing-design.md',
      'R100\tdocs/superpowers/plans/old.md\tdocs/elsewhere.md',
      'M\tdocs/superpowers/plans/p/t0.md',
      'D\tdocs/superpowers/plans/p/t0.md',
      'A\tdocs/superpowers/programs/p/x.md',
      'A\tdocs/superpowers/specsx/whatever.md',
      'A\t"docs/superpowers/plans/2026-03-03-caf\\303\\251.md"',
    ]).map((x) => x.path);
    expect(v).toEqual([
      'docs/superpowers/plans/p/t.md',
      'docs/superpowers/plans/2026-03-03-a-thing-design.promise-ids.json',
      'docs/superpowers/plans/copy.md',
      'docs/superpowers/specs/nested/2026-03-03-a-thing-design.md',
      '"docs/superpowers/plans/2026-03-03-caf\\303\\251.md"',
    ]);
  });

  it('names the shape a spec path and a plan path should take', () => {
    const [spec, plan] = layoutViolations(['A\tdocs/superpowers/specs/x.md', 'A\tdocs/superpowers/plans/x.md']);
    expect(spec.shape).toContain('docs/superpowers/specs/YYYY-MM-DD-<slug>-design.md');
    expect(plan.shape).toContain('docs/superpowers/plans/YYYY-MM-DD-<slug>.md');
    expect(plan.shape).toContain('docs/superpowers/programs/<programme>/<task-or-pr>.md');
  });
});

// Mutation table (run against the real guard; each mutant must turn at least one row red):
//  m1 treat every branch as a ledger branch            -> rows (1), (1b), (4b) red
//  m2 flag added files too                             -> row (2) red
//  m3 ignore the trailer                               -> row (4) red
//  m4 accept an empty trailer reason                   -> row (4b) red
//  m5 do not skip on a shallow clone                   -> row (5) red
//  m6 warn mode still exits 1                          -> warn row red
//  m7 forget rename sources                            -> row (1b) rename step red
//  m8 read trailers from every commit, not the head    -> row (4a) red
//  m9 exempt files nested under a plan directory       -> row (1b) plan-note step red
// D-8719's layout arm (measured 2026-11-17, each mutant restored from a saved copy; c43.md has the table):
//  M10 remove the arm                                  -> rows (L1)-(L11) red
//  M11 drop the 40-character slug bound                -> row (L4) red
//  M12 let a slug hold a double hyphen                 -> row (L5) red
//  M13 judge only the basename (specs/ or plans/)      -> row (L6) red, and layoutViolations' first row for specs/
//  M14 let a ledger branch skip the arm                -> row (L8) red
//  M15 let a Ledger-Edit trailer escape the arm        -> row (L9) red
//  M16 ignore a rename's target                        -> row (L7) and layoutViolations' first row red
//  M17 judge a rename by its source                    -> row (L7) and layoutViolations' first row red
//  M18 allow a new .html spec                          -> row (L3) red
//  M19 leave a quoted path unplaced                    -> row (L10) and layoutViolations' first row red
//  M20 drop the programs route from the plan shape     -> the shape row red
//  M21 count an edit as new                            -> row (P3) and layoutViolations' first row red
//  M22 count a deletion as new                         -> row (P4) and layoutViolations' first row red
//  M23 refuse the promise-ids file                     -> rows (L4), (P1) and layoutViolations' first row red
//  M24 warn mode fails on a layout violation           -> row (L11) red
