import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WS_ADD } from './ccdWsHelpers.js';
import { CFG_DIR, GH_STUB, makePrHarness, mergedRow, type PrHarness } from './ccdPrHelpers.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ccd-reap-'); });
afterEach(() => { h.cleanup(); });

const ARCH = `_ws_unsupervise() { echo "unsupervise $1" >> "$HOME/ccd-calls"; };
  _ws_supervise() { :; }; _spawn() { :; };
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 1; }; _alive() { return 1; };`;

/** The same genuine squash-with-a-moved-base fixture the audit tests use, so
 *  the reap path is exercised against the case it exists for. */
function ready(): { main: string; wt: string; tip: string } {
  const main = h.makeGhRepo('demo');
  h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
  const wt = path.join(h.home, 'worktrees', 'demo', 'quiet-basin');
  for (const n of ['1', '2', '3']) {
    fs.writeFileSync(path.join(wt, `f${n}.txt`), `work ${n}\n`);
    h.git(wt, 'add', `f${n}.txt`); h.git(wt, 'commit', '-m', `work ${n}`);
  }
  const tip = h.git(wt, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(main, 'other.txt'), 'someone else\n');
  h.git(main, 'add', 'other.txt'); h.git(main, 'commit', '-m', 'unrelated');
  for (const n of ['1', '2', '3']) fs.writeFileSync(path.join(main, `f${n}.txt`), `work ${n}\n`);
  h.git(main, 'add', '-A'); h.git(main, 'commit', '-m', 'squash (#42)');
  const merge = h.git(main, 'rev-parse', 'HEAD');
  h.git(main, 'push', 'origin', 'main');
  h.git(wt, 'push', '-u', 'origin', 'ws/quiet-basin');
  h.ghRows([mergedRow({ headRefOid: tip, mergeCommit: { oid: merge } })]);
  h.sh(`${ARCH} cmd_ws_archive --session demo-quiet-basin`);
  return { main, wt, tip };
}

const tokenOf = (): string =>
  JSON.parse(h.sh(`${GH_STUB} ${ARCH} cmd_ws_audit --session demo-quiet-basin`)).token;

const reap = (tok: string) =>
  h.run(`${GH_STUB} ${ARCH} cmd_ws_reap --expect ${tok} --session demo-quiet-basin`);

/**
 * Read EVERY refusal through this. `ws-reap` is the only destructive verb in
 * the design, so a refusal has exactly one meaning: nothing was destroyed. The
 * definition of done names that explicitly — "every negative case asserts the
 * worktree still exists afterwards" — and a checklist item is not an executable
 * assertion, so it lives here, once, and every negative `it` below goes through
 * it. `refusal()` in `ccd-ws-audit.test.ts` is the same device for the
 * read-only verb.
 *
 * `wt`/`main` are nullable for the one fixture that removes the worktree
 * ITSELF (the branch-moved case): asserting it still exists there would assert
 * the opposite of the fixture. Pass null and say so inline — never silently.
 */
const refused = (tok: string, wt: string | null, main: string | null): Record<string, any> => {
  const r = reap(tok);
  expect(r.code, `a refusal is an ANSWER — exit 0 with JSON on stdout. stderr: ${r.stderr}`).toBe(0);
  const o = JSON.parse(r.stdout);
  expect(o.refused, 'expected a refusal, got no `refused` key').toBeTruthy();
  expect(o.reaped, 'a refusal must never also report a reap').toBeUndefined();
  expect(h.reg('demo-quiet-basin', 'uuid'), 'the registry survives every refusal').not.toBeNull();
  if (wt !== null) expect(fs.existsSync(wt), 'a refusal must never remove the worktree').toBe(true);
  if (main !== null) {
    expect(h.git(main, 'branch', '--list', 'ws/quiet-basin'),
      'a refusal must never delete the branch').toContain('ws/quiet-basin');
  }
  return o;
};

/**
 * EVERY `it` that builds a fixture carries `}, 30000);`, and that is a measured
 * decision rather than a habit. One `ready()` is a repo, a worktree, six
 * commits and two pushes; every `tokenOf()` and every `reap()` on top of it is
 * a whole `_ws_reap_eval` — a gh read, a mandatory `git fetch`, and a
 * patch-id proof. Two such runs land ON vitest's 5 s default rather than under
 * it, and the audit suite already paid for that lesson twice: an unbudgeted
 * 4.3 s test flaked at 5062 ms inside a mutation sweep and reported a mutant
 * KILLED that survives three re-runs. A test that fails on load does not pin
 * anything — it fabricates evidence for whatever ran while it was flapping.
 * This box carries a routine load average of ~8 from other agents.
 */

describe('argv', () => {
  it('pins --expect first — an unconfirmed reap cannot even be spelled', () => {
    expect(h.run('cmd_ws_reap --session demo-quiet-basin').code).toBe(1);
    expect(h.run('cmd_ws_reap --expect abc --session demo-quiet-basin').stderr).toMatch(/bad token/);
    expect(h.run(`cmd_ws_reap --session demo-quiet-basin --expect ${'a'.repeat(64)}`).code).toBe(1);
    expect(h.run(`cmd_ws_reap --expect ${'a'.repeat(64)} --session "a b"`).stderr).toMatch(/bad session id/);
  });

  it('implements no force or override flag of any kind', () => {
    // Comments are stripped: they deliberately say "no --force", and the
    // assertion is about executable text. `systemctl --user disable --now` is
    // legitimate and unrelated, so `--now` is checked only inside the reap
    // path rather than over the whole file.
    const src = fs.readFileSync(path.resolve(__dirname, '../../../ccrc-portability/ccd'), 'utf8');
    const code = src.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    for (const banned of ['--drop-ignored', '--force-branch', 'ignored=discard']) {
      expect(code, `ccd must not contain ${banned}`).not.toContain(banned);
    }
    // `branch -D` is banned as something ccd RUNS, which is not the same test as
    // "the bytes do not appear" — and the difference is a line this plan cites
    // approvingly two describes below. `cmd_ws_rm`, when it refuses to touch a
    // branch it could not corroborate, PRINTS the command for the operator to
    // run themselves ("kept branch … delete it with: git … branch -D …"), and
    // that message is the wedge the resume path exists to end rather than a
    // second door into it. Task 8 retires `ws-rm` from ccrc and deliberately
    // leaves it in ccd for a terminal user, so the line stays. So the ban is
    // per LINE and the one surviving line is named: a second occurrence
    // anywhere, in an echo or not, fails — which is stricter than the substring
    // ban it replaces, and is the only form the shipped file can pass.
    const dashD = code.split('\n').map((l) => l.trim()).filter((l) => l.includes('branch -D'));
    expect(dashD, 'exactly one line may mention branch -D').toHaveLength(1);
    expect(dashD[0], 'and it must be cmd_ws_rm printing it for a human, never running it')
      .toMatch(/^\|\| echo "kept branch \$branch \(unmerged, or still in use\)/);
    const fnBody = (name: string): string => {
      const i = code.indexOf(`${name}() {`);
      expect(i, `${name} not found in ccd`).toBeGreaterThan(-1);
      const rest = code.slice(i + name.length + 5);
      const next = rest.search(/\n(?:cmd_|_ws_|_pr_|_gh_|_attic_|_reap_)[a-z_]+\(\)/);
      return next < 0 ? rest : rest.slice(0, next);
    };
    for (const name of ['_ws_reap_eval', 'cmd_ws_reap', '_ws_reap_tail', 'cmd_ws_audit']) {
      for (const banned of ['--now', '--force']) {
        expect(fnBody(name), `${name} must not contain ${banned}`).not.toContain(banned);
      }
    }
  });
});

describe('refusals are answers', () => {
  it('exits 0 and prints {"refused":…} rather than failing', () => {
    const { wt, main } = ready();
    const o = refused('0'.repeat(64), wt, main);
    expect(o.refused).toBe('state-changed');
    expect(o.detail).toContain('expected');
  }, 30000);

  it('names state-changed when a fingerprinted fact moved between audit and tap', () => {
    const { wt, main } = ready();
    const tok = tokenOf();
    fs.writeFileSync(path.join(wt, 'late.txt'), 'typed after the sheet rendered\n');
    // A stale sheet, a second tab and a replayed curl all land here.
    expect(refused(tok, wt, main).refused).toBe('dirty-tree');
  }, 30000);

  it('leaves the worktree, the branch and the registry intact on EVERY refusal', () => {
    const { wt, main } = ready();
    const tok = tokenOf();
    h.sh(`cd "${wt}" && git stash list >/dev/null; touch "${wt}/x"`);
    // All three assertions live in `refused`; this test is what pins them to a
    // refusal whose verdict is deliberately not named — any refusal will do.
    expect(refused(tok, wt, main).refused).toBeTruthy();
  }, 30000);

  it('declines a concurrent invocation with in-progress', () => {
    const { wt, main } = ready();
    const tok = tokenOf();
    fs.mkdirSync(path.join(h.home, '.cc-sessions', '.reap-demo-quiet-basin.lock'));
    expect(refused(tok, wt, main).refused).toBe('in-progress');
  }, 30000);

  it('refuses rather than writing a tombstone it cannot quote', () => {
    // `_json_str`'s one remaining failure is python3 not being RUNNABLE, and it
    // reports that on its exit status — which every one of the ~20
    // substitutions below swallows by construction, because they sit inside
    // printf ARGUMENT LISTS. `cmd_ws_audit` (ccd:2153) and `_ws_manifest`
    // (ccd:1109) each probe once up front for exactly that reason, and this is
    // the THIRD caller that builds a whole record: `_ws_tombstone` writes the
    // one document that outlives the workspace. Without the probe the resume
    // path — the one path that reaches the destructive tail without ever
    // calling `_pr_py`, which would otherwise refuse first — deletes and then
    // reports it in a document that does not parse.
    //
    // `-c` is `_json_str`'s invocation form and nothing else's here; `_pr_py`
    // runs `python3 /dev/fd/3`. In a SUBSHELL because refusing is `die`, i.e.
    // `exit 1`, which in the sourcing shell would end the snippet before its
    // own `echo` could report.
    const { wt, main } = ready();
    const tok = tokenOf();
    const NOPY = `python3() { [[ "\${1-}" == -c ]] && return 127; command python3 "$@"; };`;
    expect(h.sh(`${GH_STUB} ${ARCH} ${NOPY} `
      + `( cmd_ws_reap --expect ${tok} --session demo-quiet-basin ) >out.json 2>err.txt; echo "exit=$?"`))
      .toBe('exit=1');
    expect(fs.readFileSync(path.join(h.home, 'out.json'), 'utf8'),
      'a refusal must print NO document, not a document with holes in it').toBe('');
    expect(fs.readFileSync(path.join(h.home, 'err.txt'), 'utf8')).toContain('python3');
    expect(fs.existsSync(wt), 'and it must refuse BEFORE anything is destroyed').toBe(true);
    expect(h.git(main, 'branch', '--list', 'ws/quiet-basin')).toContain('ws/quiet-basin');
    expect(h.reg('demo-quiet-basin', 'uuid')).not.toBeNull();
    // Before the lock, too — a die that left the lock behind would answer
    // `in-progress` to every later attempt, with no reap running.
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', '.reap-demo-quiet-basin.lock'))).toBe(false);
  }, 30000);
});

describe('destruction order', () => {
  it('pins the amended-away commit in the attic BEFORE anything is touched', () => {
    // git worktree remove deletes $GIT_DIR/worktrees/<slug>/logs and deleting
    // a branch ref deletes its reflog, so an amended-away commit becomes a
    // dangling object with a two-week gc fuse and no name. Attic refs make
    // those commits referenced instead, at ~50 bytes each.
    const { wt, main } = ready();
    const orphan = h.git(wt, 'rev-parse', 'HEAD');   // about to be amended away
    // The amend is CONTENT-PRESERVING — message only. An amend that changed
    // the tree would move the tip's content away from the squash, the ladder
    // would refuse `tree-differs`, `tokenOf()` would come back undefined and
    // this test would be about a refusal instead of about the attic.
    h.git(wt, 'commit', '--amend', '-m', 'work 3 (reworded)');
    const amended = h.git(wt, 'rev-parse', 'HEAD');
    expect(amended).not.toBe(orphan);
    h.git(wt, 'push', '--force-with-lease', 'origin', 'ws/quiet-basin');
    h.ghRows([mergedRow({ headRefOid: amended, mergeCommit: { oid: h.git(main, 'rev-parse', 'refs/heads/main') } })]);
    const tok = tokenOf();
    expect(tok, 'the fixture must still be reapable or this tests nothing').toMatch(/^[0-9a-f]{64}$/);
    const out = JSON.parse(reap(tok).stdout);
    expect(out.reaped).toBe('demo-quiet-basin');
    expect(out.attic).toBeGreaterThan(0);
    const refs = h.sh('cmd_ws_attic --session demo-quiet-basin');
    // The specific sha, not just "some ref": the orphan is the whole claim.
    expect(refs).toContain(`refs/ccrc/attic/demo-quiet-basin/${orphan}`);
    expect(h.git(main, 'cat-file', '-t', orphan)).toBe('commit');
    // And the tombstone carries the ref NAMES (spec §5.5(b)), not the count
    // (which is (j)'s, on stdout, asserted above). `ws-attic --drop` releases
    // the refs, and after that this document is the only record of which
    // commits were pinned — so `[]`, or the number, would each be a document
    // that has forgotten the thing it exists to remember.
    const t = JSON.parse(fs.readFileSync(String(out.tombstone), 'utf8'));
    expect(t.attic).toContain(`refs/ccrc/attic/demo-quiet-basin/${orphan}`);
  }, 30000);

  it('writes the tombstone outside the registry glob it later removes', () => {
    ready();
    // Read the wrapper NOW: step (i) is `rm -f $REG/<id>.*`, so after the reap
    // there is no registry left to read it from — that is the whole reason the
    // tombstone has to carry the transcript path itself.
    const wrapper = h.reg('demo-quiet-basin', 'wrapper')!;
    const tok = tokenOf();
    const out = JSON.parse(reap(tok).stdout);
    const tomb = path.join(h.home, '.cc-sessions', '.reaped', 'demo-quiet-basin.json');
    expect(out.tombstone).toBe(tomb);
    const t = JSON.parse(fs.readFileSync(tomb, 'utf8'));
    expect(t.branch).toBe('ws/quiet-basin');
    expect(t.proof).toBe('patch-id');
    expect(t.pr).toBe(42);
    // ws-rm deleted $REG/<id>.uuid and with it the id->transcript mapping.
    // Derived from the wrapper, never hardcoded: _ws_least_loaded may pick
    // claude2 (~/.claude-personal) and `.claude/projects/` would then be a
    // substring that never appears.
    expect(String(t.transcript)).toContain(`${CFG_DIR[wrapper]!}/projects/`);
    expect(Array.isArray(t.ignored)).toBe(true);
    expect(Array.isArray(t.attic)).toBe(true);
    expect(Array.isArray(t.clips)).toBe(true);
  }, 30000);

  it('removes the worktree, CAS-deletes the branch, and clears the registry LAST', () => {
    const { wt, main } = ready();
    const tok = tokenOf();
    const out = JSON.parse(reap(tok).stdout);
    expect(out.reaped).toBe('demo-quiet-basin');
    expect(out.proof).toBe('patch-id');
    expect(fs.existsSync(wt)).toBe(false);
    expect(h.git(main, 'branch', '--list', 'ws/quiet-basin')).toBe('');
    expect(h.reg('demo-quiet-basin', 'uuid')).toBeNull();
    expect(h.reg('demo-quiet-basin', 'reaping')).toBeNull();
    expect(h.calls()).toContain('unsupervise demo-quiet-basin');
  }, 30000);

  it('refuses when the branch moved under the CAS, and never orphans it', () => {
    // THE compare-and-swap itself, which no other fixture in this file reaches:
    // the resume-path `branch-moved` test below refuses at the tombstone/live
    // comparison, several statements before `update-ref -d` runs. Here the
    // branch moves DURING the reap — a push from another box, another agent's
    // commit — in the window between `_ws_reap_eval` reading REAP_TIP and the
    // tail deleting the ref. Injected at `_ws_unsupervise`, which the tail
    // calls at (d), after the attic and the tombstone and before the worktree
    // goes: a stub of a ccd function, never a patch to ccd.
    //
    // The replacement commit carries the SAME TREE as the tip on purpose. A
    // different tree would leave the worktree dirty against its own HEAD and
    // `git worktree remove` would refuse first, so the run would never reach
    // the ref at all and this would be a `worktree-remove-failed` test wearing
    // a CAS test's name.
    //
    // Both halves of the CAS are what this pins: drop the `$REAP_TIP` operand
    // and the delete succeeds against a ref nobody proved (the branch check in
    // `refused` fails); drop the `|| { … branch-moved … }` and the run walks on
    // to `rm -f $REG/<id>.*` and reports a clean reap over an orphaned branch
    // (the registry check fails). An orphaned branch is a bug, not an outcome.
    const { main, tip } = ready();
    const tok = tokenOf();
    const moved = h.git(main, 'commit-tree', `${tip}^{tree}`, '-p', tip, '-m', 'someone else pushed');
    const MOVE = ARCH.replace('_ws_unsupervise() { echo "unsupervise $1" >> "$HOME/ccd-calls"; };',
      `_ws_unsupervise() { echo "unsupervise $1" >> "$HOME/ccd-calls"; `
      + `git -C "${main}" update-ref refs/heads/ws/quiet-basin ${moved} ${tip}; };`);
    expect(MOVE).not.toBe(ARCH);   // a .replace() that matched nothing is a silent no-op
    const r = h.run(`${GH_STUB} ${MOVE} cmd_ws_reap --expect ${tok} --session demo-quiet-basin`);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    const o = JSON.parse(r.stdout);
    expect(o.refused).toBe('branch-moved');
    expect(o.reaped).toBeUndefined();
    // `wt: null` — the worktree is gone by design here: (f) succeeded and (g)
    // is what refused. The branch and the registry are the whole assertion.
    expect(h.git(main, 'branch', '--list', 'ws/quiet-basin')).toContain('ws/quiet-basin');
    expect(h.git(main, 'rev-parse', 'refs/heads/ws/quiet-basin')).toBe(moved);
    expect(h.reg('demo-quiet-basin', 'uuid')).not.toBeNull();
    // Resumable, and resumable from the RIGHT step: the worktree really is gone.
    expect(h.reg('demo-quiet-basin', 'reaping')).toBe('branch');
  }, 30000);

  it('records clip FILENAMES and sizes, not a count, and asserts the parent', () => {
    // Full-resolution originals, not thumbnails: 3.8 MB single files observed.
    const clips = path.join(h.home, '.cc-clips', 'demo-quiet-basin');
    ready();
    fs.mkdirSync(clips, { recursive: true });
    fs.writeFileSync(path.join(clips, 'clip-a.png'), 'x'.repeat(2048));
    const tok = tokenOf();
    const out = JSON.parse(reap(tok).stdout);
    const t = JSON.parse(fs.readFileSync(String(out.tombstone), 'utf8'));
    expect(t.clips).toEqual([{ name: 'clip-a.png', bytes: 2048 }]);
    expect(fs.existsSync(clips)).toBe(false);
  }, 30000);

  it('never touches the transcript or the shared info/exclude', () => {
    const { main, wt } = ready();
    const exclude = path.join(main, '.git', 'info', 'exclude');
    const before = fs.readFileSync(exclude, 'utf8');
    // Seed the real transcript this reap must not touch. makeCcdHarness creates
    // .cc-sessions, .cc-limits and .local/bin ONLY, and nothing in ws-add or
    // _transcript_path creates a config dir — so asserting `~/.claude` exists
    // afterwards would assert something no code under test ever makes true.
    // The path is <cfg>/projects/<workdir with . / _ all mapped to ->/<uuid>.jsonl,
    // the same munge server/src/munge.ts applies.
    const wrapper = h.reg('demo-quiet-basin', 'wrapper')!;
    const uuid = h.reg('demo-quiet-basin', 'uuid')!;
    const tdir = path.join(h.home, CFG_DIR[wrapper]!, 'projects', wt.replace(/[./_]/g, '-'));
    fs.mkdirSync(tdir, { recursive: true });
    const transcript = path.join(tdir, `${uuid}.jsonl`);
    fs.writeFileSync(transcript, '{"type":"user"}\n');
    const tok = tokenOf();
    const out = JSON.parse(reap(tok).stdout);
    expect(out.reaped).toBe('demo-quiet-basin');
    expect(fs.readFileSync(exclude, 'utf8')).toBe(before);   // shared across every worktree
    // The transcript is the session's memory and survives the workspace by
    // design; the tombstone's pointer is the only thing left that names it,
    // because ws-rm used to delete $REG/<id>.uuid and the mapping with it.
    expect(fs.readFileSync(transcript, 'utf8')).toBe('{"type":"user"}\n');
    const t = JSON.parse(fs.readFileSync(String(out.tombstone), 'utf8'));
    expect(t.transcript).toBe(transcript);
  }, 30000);
});

describe('partial failure and resume', () => {
  it('resumes from the breadcrumb instead of refusing worktree-missing', () => {
    // One SIGTERM at the outer timeout used to wedge the workspace forever
    // while the tombstone reported it cleaned up, and the only exit was a
    // hand-run ccd ws-rm — which, with the worktree and its record already gone,
    // refuses to touch the branch and hands you a `branch -D` to run yourself
    // (ccd:402-407). Correct of it, and still a wedge: the resume path is what
    // finishes the job.
    const { wt, main } = ready();
    const tok = tokenOf();
    // Simulate a reap killed after the worktree went but before the branch did.
    h.sh(`_reg_set demo-quiet-basin reaping worktree`);
    fs.mkdirSync(path.join(h.home, '.cc-sessions', '.reaped'), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.cc-sessions', '.reaped', 'demo-quiet-basin.json'),
      JSON.stringify({ id: 'demo-quiet-basin', project: 'demo', branch: 'ws/quiet-basin',
        tip: h.git(main, 'rev-parse', 'refs/heads/ws/quiet-basin') }));
    h.git(main, 'worktree', 'remove', wt);
    const r = h.run(`${GH_STUB} ${ARCH} cmd_ws_reap --expect ${tok} --session demo-quiet-basin`);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.reaped).toBe('demo-quiet-basin');
    expect(out.resumed).toBe('worktree');
    expect(h.git(main, 'branch', '--list', 'ws/quiet-basin')).toBe('');
    expect(h.reg('demo-quiet-basin', 'uuid')).toBeNull();
  }, 30000);

  it('re-proves Phase B on resume when the worktree is STILL THERE — dirty', () => {
    // The breadcrumb is written at (c), BEFORE `git worktree remove` at (f),
    // so one SIGTERM inside that window leaves reaping=worktree with the
    // worktree intact. §5.3 is unconditional — every guard is evaluated at the
    // instant of deletion — so an edit made between the two runs must still
    // stop this, even though an audit called it reapable minutes ago.
    const { wt, main } = ready();
    const tok = tokenOf();
    h.sh('_reg_set demo-quiet-basin reaping worktree');
    fs.mkdirSync(path.join(h.home, '.cc-sessions', '.reaped'), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.cc-sessions', '.reaped', 'demo-quiet-basin.json'),
      JSON.stringify({ id: 'demo-quiet-basin', project: 'demo', branch: 'ws/quiet-basin',
        tip: h.git(main, 'rev-parse', 'refs/heads/ws/quiet-basin') }));
    // NOT removed: the crash happened before (f).
    fs.writeFileSync(path.join(wt, 'late.txt'), 'typed while the reap was dead\n');
    expect(refused(tok, wt, main).refused).toBe('dirty-tree');
    expect(fs.existsSync(path.join(wt, 'late.txt'))).toBe(true);
    // The breadcrumb is LEFT in place: the tail is still resumable, it just is
    // not resumable right now. Clearing it here would strand the workspace.
    expect(h.reg('demo-quiet-basin', 'reaping')).toBe('worktree');
  }, 30000);

  it('re-proves Phase B on resume — a .env written in the gap is not deleted', () => {
    // The concrete loss the resume path used to allow. The token is taken
    // while the tree is clean, exactly as a real sheet would have; everything
    // after it happens in the window where ccrc was not running.
    const { wt, main } = ready();
    const tok = tokenOf();
    fs.appendFileSync(path.join(wt, '.gitignore'), '.env\n');
    h.git(wt, 'add', '.gitignore'); h.git(wt, 'commit', '-m', 'ignore env');
    h.git(wt, 'push', 'origin', 'ws/quiet-basin');
    fs.writeFileSync(path.join(wt, '.env'), 'SECRET_API_KEY=1\n');
    h.sh('_reg_set demo-quiet-basin reaping worktree');
    fs.mkdirSync(path.join(h.home, '.cc-sessions', '.reaped'), { recursive: true });
    // Written AFTER the branch moved, so the tip matches and the branch-moved
    // guard is not what refuses — Phase B is.
    fs.writeFileSync(path.join(h.home, '.cc-sessions', '.reaped', 'demo-quiet-basin.json'),
      JSON.stringify({ id: 'demo-quiet-basin', project: 'demo', branch: 'ws/quiet-basin',
        tip: h.git(main, 'rev-parse', 'refs/heads/ws/quiet-basin') }));
    const out = refused(tok, wt, main);
    expect(out.refused).toBe('sensitive-ignored');
    // Named, so it can be moved — and shaped by the SAME `_reap_paths_json` the
    // evaluated path uses, so the two refusals cannot describe it differently.
    expect(out.paths).toContain('.env');
    expect(fs.readFileSync(path.join(wt, '.env'), 'utf8')).toBe('SECRET_API_KEY=1\n');
  }, 30000);

  it('re-proves Phase B on resume — a tree it cannot READ is not deleted', () => {
    // The resume path has no token to fall back on: nothing downstream compares a
    // fingerprint, so an unreadable tree counting 0 dirty files and an unreadable
    // ignored set yielding an empty REAP_SENSITIVE walk straight through both
    // guards into `git worktree remove`. An index.lock contention in the crash
    // window is enough. Only the ignored-set read is failed, so the dirty guard is
    // not what refuses.
    const { wt, main } = ready();
    const tok = tokenOf();
    h.sh('_reg_set demo-quiet-basin reaping worktree');
    fs.mkdirSync(path.join(h.home, '.cc-sessions', '.reaped'), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.cc-sessions', '.reaped', 'demo-quiet-basin.json'),
      JSON.stringify({ id: 'demo-quiet-basin', project: 'demo', branch: 'ws/quiet-basin',
        tip: h.git(main, 'rev-parse', 'refs/heads/ws/quiet-basin') }));
    const NOIGN = `git() { [[ "$*" == *"--ignored=matching"* ]] && return 128; command git "$@"; };`;
    const r = h.run(`${GH_STUB} ${ARCH} ${NOIGN} cmd_ws_reap --expect ${tok} --session demo-quiet-basin`);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).refused).toBe('tree-unreadable');
    expect(fs.existsSync(wt)).toBe(true);
    expect(h.reg('demo-quiet-basin', 'reaping')).toBe('worktree');
  }, 30000);

  it('re-proves Phase D1 on resume — a session still running is not reaped', () => {
    // The crash window between (c) and (d): the breadcrumb exists, the session
    // was never stopped. Phase B passes (clean, pushed) and would let it through.
    const { wt, main } = ready();
    const tok = tokenOf();
    h.sh('_reg_set demo-quiet-basin reaping worktree');
    fs.mkdirSync(path.join(h.home, '.cc-sessions', '.reaped'), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.cc-sessions', '.reaped', 'demo-quiet-basin.json'),
      JSON.stringify({ id: 'demo-quiet-basin', project: 'demo', branch: 'ws/quiet-basin',
        tip: h.git(main, 'rev-parse', 'refs/heads/ws/quiet-basin') }));
    const cfg = path.join(h.home, '.claude', 'sessions');
    fs.mkdirSync(cfg, { recursive: true });
    fs.writeFileSync(path.join(cfg, '4242.json'), '{"status":"busy","statusUpdatedAt":1}');
    const BUSY = ARCH
      .replace('_alive() { return 1; };', '_alive() { return 0; };')
      .replace('tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 1; };',
               'tmux() { case "$1" in list-panes) echo 4242 ;; *) echo "tmux $*" >> "$HOME/ccd-calls" ;; esac; };');
    const r = h.run(`${GH_STUB} ${BUSY} cmd_ws_reap --expect ${tok} --session demo-quiet-basin`);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).refused).toBe('session-busy');
    expect(fs.existsSync(wt)).toBe(true);
    expect(h.reg('demo-quiet-basin', 'reaping')).toBe('worktree');
  }, 30000);

  it('stops and keeps the registry when the branch moved under the CAS', () => {
    const { wt, main } = ready();
    const tok = tokenOf();
    h.sh(`_reg_set demo-quiet-basin reaping worktree`);
    fs.mkdirSync(path.join(h.home, '.cc-sessions', '.reaped'), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.cc-sessions', '.reaped', 'demo-quiet-basin.json'),
      JSON.stringify({ id: 'demo-quiet-basin', project: 'demo', branch: 'ws/quiet-basin',
        tip: '0'.repeat(40) }));
    h.git(main, 'worktree', 'remove', wt);
    // `wt: null` — THIS fixture removed the worktree, standing in for a reap
    // killed after (f). Asserting it still exists would assert the opposite of
    // the setup. The branch check still applies, and is the point:
    // an orphaned branch is a bug, not an outcome, and is never swallowed.
    expect(refused(tok, null, main).refused).toBe('branch-moved');
    expect(h.reg('demo-quiet-basin', 'reaping')).toBe('worktree');
  }, 30000);
});
