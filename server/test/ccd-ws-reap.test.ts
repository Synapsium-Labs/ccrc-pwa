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
 *  the reap path is exercised against the case it exists for.
 *
 *  `ignore` writes a `.gitignore` INTO THE MERGED WORK — into the branch's
 *  commits AND into main's squash of them, exactly as `squashMovedBase` does in
 *  `ccd-ws-audit.test.ts`, and for the reason recorded there: committing it to
 *  the branch AFTER the squash landed adds a commit that is genuinely not in
 *  the merge, so the ladder refuses `tree-differs` and the test becomes about a
 *  refusal instead of about what it says it is about. */
function ready(ignore: string[] = []): { main: string; wt: string; tip: string } {
  const main = h.makeGhRepo('demo');
  h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
  const wt = path.join(h.home, 'worktrees', 'demo', 'quiet-basin');
  for (const n of ['1', '2', '3']) {
    fs.writeFileSync(path.join(wt, `f${n}.txt`), `work ${n}\n`);
    h.git(wt, 'add', `f${n}.txt`); h.git(wt, 'commit', '-m', `work ${n}`);
  }
  if (ignore.length) {
    fs.writeFileSync(path.join(wt, '.gitignore'), `${ignore.join('\n')}\n`);
    h.git(wt, 'add', '.gitignore'); h.git(wt, 'commit', '-m', 'ignore');
  }
  const tip = h.git(wt, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(main, 'other.txt'), 'someone else\n');
  h.git(main, 'add', 'other.txt'); h.git(main, 'commit', '-m', 'unrelated');
  for (const n of ['1', '2', '3']) fs.writeFileSync(path.join(main, `f${n}.txt`), `work ${n}\n`);
  if (ignore.length) fs.writeFileSync(path.join(main, '.gitignore'), `${ignore.join('\n')}\n`);
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
 * Is the reap lock FREE? — the only question worth asking about it, and not the
 * same question as "does the lock file exist".
 *
 * `flock` is an advisory lock the kernel attaches to an open file description
 * and releases when the last copy of that description closes — a normal exit, a
 * `die`, a SIGKILL, an OOM kill, a reboot. The FILE it is attached to is never
 * unlinked (ccd says why at the lock), so its existence says nothing at all;
 * what a test has to be able to see is whether anyone still holds it. A
 * non-blocking acquire from a throwaway descriptor is that question, asked the
 * same way ccd asks it.
 */
const lockFree = (): boolean => {
  const lock = path.join(h.home, '.cc-sessions', '.reap-demo-quiet-basin.lock');
  if (!fs.existsSync(lock)) return true;
  return h.sh(`( exec {fd}>>"${lock}" && flock -n "$fd" && echo free ) || echo held`) === 'free';
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

  it('names state-changed when an ignored file GREW between audit and tap', () => {
    // The fingerprint used to hash the ignored PATHS, so the set was the only
    // thing it could see. Measured: growing `build/out.o` from 9 bytes to
    // 400,000 left the token IDENTICAL and the reap deleted 400,215 bytes under
    // a sheet that said 9 — the size arrived in the reap's own output, after the
    // fact. The records carry `sensitive\tbytes\tpath`, so hashing THEM is what
    // makes the bytes a fingerprinted fact.
    const { wt, main } = ready(['build/']);
    fs.mkdirSync(path.join(wt, 'build'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'build', 'out.o'), 'x'.repeat(9));
    const tok = tokenOf();
    fs.writeFileSync(path.join(wt, 'build', 'out.o'), 'x'.repeat(400000));
    expect(refused(tok, wt, main).refused).toBe('state-changed');
  }, 30000);

  it('names state-changed when a file appears INSIDE an already-ignored directory', () => {
    // The other half of the same blindness, and the one that composes with the
    // inside-the-directory scan: a whole nested git repository dropped into an
    // ignored directory (measured at 27,141 bytes) changed neither the entry
    // set nor the entry's own byte count in the old digest.
    const { wt, main } = ready(['build/']);
    fs.mkdirSync(path.join(wt, 'build'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'build', 'out.o'), 'x'.repeat(9));
    const tok = tokenOf();
    fs.writeFileSync(path.join(wt, 'build', 'second.o'), 'x'.repeat(9));
    expect(refused(tok, wt, main).refused).toBe('state-changed');
  }, 30000);

  it('names state-changed when a CLIP is pasted between the sheet and the tap', () => {
    // `~/.cc-clips/<id>` is `rm -rf`'d at (h) — full-resolution screenshots —
    // and the fingerprint could not see it at all: measured, pasting two clips
    // after the audit left the token IDENTICAL and the reap deleted them. A
    // change to WHAT GETS DELETED that no human consented to in any form is the
    // one thing D2 exists to refuse.
    const { wt, main } = ready();
    const clips = path.join(h.home, '.cc-clips', 'demo-quiet-basin');
    fs.mkdirSync(clips, { recursive: true });
    fs.writeFileSync(path.join(clips, 'a.png'), 'x');
    const tok = tokenOf();
    // And the sheet could not have LISTED it either, which is the other half:
    // consent to a deletion the document never names is not consent.
    const a = JSON.parse(h.sh(`${GH_STUB} ${ARCH} cmd_ws_audit --session demo-quiet-basin`));
    expect(a.clips).toEqual([{ name: 'a.png', bytes: 1 }]);
    fs.writeFileSync(path.join(clips, 'b.png'), 'pasted after the sheet rendered');
    expect(refused(tok, wt, main).refused).toBe('state-changed');
    expect(fs.existsSync(path.join(clips, 'b.png')), 'and it is still there').toBe(true);
  }, 30000);

  it('leaves the worktree, the branch and the registry intact on EVERY refusal', () => {
    const { wt, main } = ready();
    const tok = tokenOf();
    h.sh(`cd "${wt}" && git stash list >/dev/null; touch "${wt}/x"`);
    // All three assertions live in `refused`; this test is what pins them to a
    // refusal whose verdict is deliberately not named — any refusal will do.
    expect(refused(tok, wt, main).refused).toBeTruthy();
    // And the lock goes back. A refusal keeps the workspace, so a lock still
    // HELD here is not litter — it is `in-progress`, for ever, to every later
    // attempt, with no reap running and nothing to kill. The lock FILE stays on
    // disk by design (see `lockFree` and ccd's own comment at the lock): what
    // has to go back is the kernel's advisory lock on it, and that is what this
    // asserts.
    expect(lockFree(), 'a refusal must give the lock back').toBe(true);
  }, 30000);

  it('declines a genuinely concurrent invocation with in-progress', () => {
    // A REAL second holder, not a hand-made lock file. Under `flock` the lock
    // is a property of an open file description a live process owns, so the
    // only way to occupy it is to have a process occupying it — which is also
    // the only state the refusal is allowed to describe.
    const { wt, main } = ready();
    const tok = tokenOf();
    const lock = path.join(h.home, '.cc-sessions', '.reap-demo-quiet-basin.lock');
    const out = h.sh(`${GH_STUB} ${ARCH}
      : > "${lock}"
      flock "${lock}" -c 'touch "$HOME/held"; sleep 25' >/dev/null 2>&1 &
      hp=$!
      for _ in $(seq 200); do [[ -f "$HOME/held" ]] && break; sleep 0.05; done
      [[ -f "$HOME/held" ]] || { echo "holder never took the lock"; kill "$hp" 2>/dev/null; exit 1; }
      cmd_ws_reap --expect ${tok} --session demo-quiet-basin
      kill -9 "$hp" 2>/dev/null; wait "$hp" 2>/dev/null || true`);
    const o = JSON.parse(out);
    expect(o.refused).toBe('in-progress');
    expect(o.reaped, 'a refusal must never also report a reap').toBeUndefined();
    expect(fs.existsSync(wt), 'a declined reap destroys nothing').toBe(true);
    expect(h.git(main, 'branch', '--list', 'ws/quiet-basin')).toContain('ws/quiet-basin');
    // AND IT DOES NOT RELEASE THE LOCK IT NEVER TOOK. The loser closes its own
    // descriptor and touches nothing else; the winner's lock is the kernel's,
    // on a different open file description, and no `rm` or `rmdir` on the loser's
    // path can reach it. (Under the old mkdir lock the loser's own EXIT trap
    // could — which is why the trap was armed only after the mkdir.)
    expect(lockFree(), 'the holder still holds it after the loser is refused').toBe(false);
  }, 30000);

  it('a kill -9 mid-reap leaves nothing to clear — the KERNEL drops the lock', () => {
    // THE CRASH THIS BOX IS FOR. An EXIT trap does not run on SIGKILL, on an
    // OOM kill or on a power loss, so a trap-released lock survives its own
    // process and answers `in-progress` for ever — with the breadcrumb, i.e.
    // the entire recovery mechanism, sitting one refusal behind it and no ccd
    // verb able to clear it. `flock` on a descriptor is released by the kernel
    // when the last descriptor closes, which a SIGKILL does.
    //
    // The reap is BLOCKED, not stubbed to exit: `read < fifo` blocks in the
    // shell itself (open(2) on a fifo with no writer), so the process holding
    // the lock is the process being killed and no child inherits the
    // descriptor. `exit 9` from a stub — the technique the other two kill
    // fixtures use — exercises the orderly path and cannot reach this at all.
    const { wt, main } = ready();
    const tok = tokenOf();
    const BLOCK = ARCH.replace('_ws_unsupervise() { echo "unsupervise $1" >> "$HOME/ccd-calls"; };',
      '_ws_unsupervise() { echo "unsupervise $1" >> "$HOME/ccd-calls"; read -r _ < "$HOME/blockfifo"; };');
    expect(BLOCK).not.toBe(ARCH);   // a .replace() that matched nothing is a silent no-op
    const probe = h.sh(`${GH_STUB} ${BLOCK}
      mkfifo "$HOME/blockfifo"
      # COUNTED, not \`grep -q\`: \`ready()\` archived this workspace, and
      # \`cmd_ws_archive\` unsupervises too — so the line is already in the log
      # before the reap starts and a presence test would fall straight through
      # and kill a process that had not reached (c) yet.
      n0=$(grep -c unsupervise "$HOME/ccd-calls" 2>/dev/null || true)
      ( cmd_ws_reap --expect ${tok} --session demo-quiet-basin >"$HOME/reap.out" 2>&1 ) &
      p=$!
      for _ in $(seq 400); do
        n1=$(grep -c unsupervise "$HOME/ccd-calls" 2>/dev/null || true)
        (( n1 > n0 )) && break; sleep 0.05
      done
      (( n1 > n0 )) || { echo "never reached (d)"; kill -9 "$p" 2>/dev/null; exit 1; }
      echo "breadcrumb=$(cat "$HOME/.cc-sessions/demo-quiet-basin.reaping" 2>/dev/null)"
      kill -9 "$p"; wait "$p" 2>/dev/null || true
      echo "killed=yes"`);
    expect(probe, `the fixture must have died inside the (c)-(d) window: ${probe}`)
      .toContain('breadcrumb=worktree');
    expect(probe).toContain('killed=yes');
    // The kernel gave it back. Nothing ran to make that true.
    expect(lockFree(), 'a SIGKILLed holder must not leave the lock held').toBe(true);
    // And the recovery mechanism is reachable again: the very next invocation
    // resumes from the breadcrumb and finishes.
    const out = JSON.parse(reap(tok).stdout);
    expect(out.reaped).toBe('demo-quiet-basin');
    expect(out.resumed).toBe('worktree');
    expect(fs.existsSync(wt)).toBe(false);
    expect(h.git(main, 'branch', '--list', 'ws/quiet-basin')).toBe('');
  }, 30000);

  it('gives the lock back when the FUNCTION returns, not when the shell exits', () => {
    // `flock` locks an open file description, and two `open()`s of one path in
    // one process are two descriptions the kernel treats as strangers — so a
    // descriptor left open by the first call refuses the second, in the same
    // shell, with no other process involved. ccd is sourced by its own tests
    // and by `ccd` itself, so "the shell exits eventually" is not the same
    // statement as "the lock went back".
    const { wt, main } = ready();
    const tok = tokenOf();
    const out = h.sh(`${GH_STUB} ${ARCH}
      cmd_ws_reap --expect ${'0'.repeat(64)} --session demo-quiet-basin
      cmd_ws_reap --expect ${tok} --session demo-quiet-basin`).split('\n');
    expect(JSON.parse(out[0]!).refused, 'the first call refuses and gives the lock back').toBe('state-changed');
    expect(JSON.parse(out[1]!).reaped, `the second call must not see its own leftover descriptor: ${out[1]}`)
      .toBe('demo-quiet-basin');
    expect(fs.existsSync(wt)).toBe(false);
    expect(h.git(main, 'branch', '--list', 'ws/quiet-basin')).toBe('');
  }, 30000);

  it('refuses to run the destructive verb unserialised when flock is missing', () => {
    // The lock is the ONLY thing standing between two concurrent reaps, and it
    // is now `flock(2)` rather than a directory ccd could always create. On a
    // box without util-linux that is not a degraded mode to fall back into: it
    // is the guard being absent, so the verb refuses to run at all. `command`
    // is shimmed rather than PATH being emptied, because ccd asks the question
    // with `command -v` and every other stub in this file spells its passthrough
    // `command git`/`command find` — the shim has to leave those alone.
    //
    // In a SUBSHELL: refusing is `die`, i.e. `exit 1`, which in the sourcing
    // shell would end the snippet before its own `echo` could report.
    const { wt, main } = ready();
    const tok = tokenOf();
    const NOFLOCK = 'command() { [[ "${1-}" == -v && "${2-}" == flock ]] && return 1;'
      + ' builtin command "$@"; };';
    expect(h.sh(`${GH_STUB} ${ARCH} ${NOFLOCK} `
      + `( cmd_ws_reap --expect ${tok} --session demo-quiet-basin ) >out2.json 2>err2.txt; echo "exit=$?"`))
      .toBe('exit=1');
    expect(fs.readFileSync(path.join(h.home, 'out2.json'), 'utf8'),
      'a refusal to run prints no document at all').toBe('');
    expect(fs.readFileSync(path.join(h.home, 'err2.txt'), 'utf8')).toContain('flock');
    expect(fs.existsSync(wt), 'and nothing is destroyed').toBe(true);
    expect(h.git(main, 'branch', '--list', 'ws/quiet-basin')).toContain('ws/quiet-basin');
    expect(h.reg('demo-quiet-basin', 'uuid')).not.toBeNull();
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

  it('names the sensitive paths on the EVALUATED path too, not only on resume', () => {
    // `_reap_paths_json` says it is "shared by BOTH refusal sites … so the two
    // cannot describe the same finding differently", and until this fixture
    // existed only the resume site had one. Delete the `paths=` line on this
    // side and every other test stays green while the sheet loses the one thing
    // that makes `sensitive-ignored` actionable: the name of the file to move.
    //
    // No `tokenOf()`: `sensitive-ignored` is Phase B, which runs before Phase C
    // and long before the token is compared, so any 64-hex string reaches it —
    // and an audit would refuse to issue one for this state anyway.
    // TWO of them, because one pins no separator: `[".env"]` is what a missing
    // comma still produces, and `[".env""id_rsa"]` — the shape a human's list of
    // files to rescue takes without it — is not JSON at all.
    const { wt, main } = ready();
    fs.appendFileSync(path.join(wt, '.gitignore'), '.env\nid_rsa\n');
    h.git(wt, 'add', '.gitignore'); h.git(wt, 'commit', '-m', 'ignore env');
    fs.writeFileSync(path.join(wt, '.env'), 'SECRET_API_KEY=1\n');
    fs.writeFileSync(path.join(wt, 'id_rsa'), 'PRIVATE KEY\n');
    const o = refused('0'.repeat(64), wt, main);
    expect(o.refused).toBe('sensitive-ignored');
    expect([...o.paths].sort()).toEqual(['.env', 'id_rsa']);
    expect(o.detail).toContain('.env');
    expect(fs.readFileSync(path.join(wt, '.env'), 'utf8')).toBe('SECRET_API_KEY=1\n');
    expect(fs.readFileSync(path.join(wt, 'id_rsa'), 'utf8')).toBe('PRIVATE KEY\n');
  }, 30000);

  it('sees a secret one directory BELOW a collapsed ignored directory', () => {
    // THE HOLE UNDER THE ONE GUARD §7 GIVES NO OVERRIDE. `--ignored=matching`
    // collapses a wholly ignored directory to a SINGLE entry, so
    // `_ws_sensitive_match` was handed `build/` and nothing ever looked inside.
    // Measured before the scan existed: verdict `reapable`, a token issued,
    // `sensitive: []`, a sheet reading "not in git · 1 entry, 39 B — build/",
    // and `build/.env` — holding a live key — gone afterwards. Moving one secret
    // one directory deeper defeated the whole §0 promise.
    //
    // Three shapes in one fixture: the flat case, a second name so the list is
    // a list, and `deep/a/b/c/credentials.json`, because a depth-1 peek would
    // pass the first two and still lose the third.
    const { wt, main } = ready(['build/']);
    fs.mkdirSync(path.join(wt, 'build', 'deep', 'a', 'b', 'c'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'build', '.env'), 'SECRET_API_KEY=live_sk_xxx\n');
    fs.writeFileSync(path.join(wt, 'build', 'id_rsa'), 'PRIVATE KEY\n');
    fs.writeFileSync(path.join(wt, 'build', 'deep', 'a', 'b', 'c', 'credentials.json'), '{"aws":1}\n');
    fs.writeFileSync(path.join(wt, 'build', 'out.o'), 'ordinary rubbish\n');

    // git really does collapse it — the fixture is about the collapse, so the
    // collapse is asserted rather than assumed.
    const a = JSON.parse(h.sh(`${GH_STUB} ${ARCH} cmd_ws_audit --session demo-quiet-basin`));
    expect(a.ignored.map((e: { path: string }) => e.path)).toEqual(['build/']);
    expect(a.ignored[0].sensitive, 'the ENTRY is what the sheet lists and what rm -rf destroys').toBe(true);
    expect(a.verdict).toBe('sensitive-ignored');
    expect(a.token, 'a state that refuses is never issued a token').toBeUndefined();

    const o = refused('0'.repeat(64), wt, main);
    expect(o.refused).toBe('sensitive-ignored');
    // The paths NAMED are the files found, not the entry: "move build/.env
    // somewhere else" is a remedy, "build/ is sensitive" is not.
    expect([...o.paths].sort())
      .toEqual(['build/.env', 'build/deep/a/b/c/credentials.json', 'build/id_rsa']);
    expect(fs.readFileSync(path.join(wt, 'build', '.env'), 'utf8')).toBe('SECRET_API_KEY=live_sk_xxx\n');
  }, 30000);

  it('refuses when it could not walk all of an ignored directory', () => {
    // Same polarity as the two `git status` reads beside it: find prints
    // `Permission denied` and carries on, so the entries it could not reach are
    // simply ABSENT — which is the answer that says "no secrets here" about
    // files nobody enumerated. Any diagnostic is a read that did not complete.
    const { wt, main } = ready(['build/']);
    fs.mkdirSync(path.join(wt, 'build', 'locked'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'build', 'locked', '.env'), 'SECRET=1\n');
    fs.chmodSync(path.join(wt, 'build', 'locked'), 0o000);
    try {
      const o = refused('0'.repeat(64), wt, main);
      expect(o.refused).toBe('tree-unreadable');
      expect(o.detail, 'the operator is told WHICH directory').toContain('build/');
    } finally {
      fs.chmodSync(path.join(wt, 'build', 'locked'), 0o755);
    }
  }, 30000);

  it('separates the scan\'s two failure rungs — a bad status, and a diagnostic', () => {
    // ONE FIXTURE PINS NEITHER. The `chmod 000` case above fails BOTH rungs at
    // once (find exits non-zero AND prints), so with either guard deleted the
    // other still refuses and each survives a sweep individually — the exact
    // shape `removes its scratch file on EVERY path that refuses` exists for in
    // `_ws_collect_ignored`. So: one fixture where find FAILS silently, and one
    // where it SUCCEEDS and complains. `find` appears once in ccd, at this
    // scan, so shadowing it reaches nothing else.
    const { wt, main } = ready(['build/']);
    fs.mkdirSync(path.join(wt, 'build'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'build', 'out.o'), 'ordinary rubbish\n');
    const QUIETFAIL = `find() { command find "$@" 2>/dev/null; return 1; };`;
    const NOISYOK = `find() { command find "$@"; echo "find: something happened" >&2; return 0; };`;
    for (const [name, stub] of [['rc', QUIETFAIL], ['stderr', NOISYOK]] as const) {
      const r = h.run(`${GH_STUB} ${ARCH} ${stub} `
        + `cmd_ws_reap --expect ${'0'.repeat(64)} --session demo-quiet-basin`);
      expect(r.code, `${name}: stderr ${r.stderr}`).toBe(0);
      expect(JSON.parse(r.stdout).refused, `the ${name} rung must refuse on its own`)
        .toBe('tree-unreadable');
      expect(fs.existsSync(wt)).toBe(true);
    }
    expect(h.git(main, 'branch', '--list', 'ws/quiet-basin')).toContain('ws/quiet-basin');
  }, 30000);

  it('refuses, with the remedy, when the scan runs out of its budget', () => {
    // The bound is a DEADLINE for the whole workspace rather than a per-entry
    // timeout, so 226 ignored entries cannot cost 226 timeouts. Measured on
    // this box against the tree `--ignored=matching` was chosen for
    // (custom-tools: 226 collapsed entries, 355,392 entries beneath them) the
    // whole scan costs 3.4 s, so the 30 s budget is ~9x the largest real tree
    // here and does not fire in practice — which is exactly why the expiry path
    // needs a fixture rather than a real tree. `timeout` is a shell function in
    // this harness (it is shadowed so the gh wrapper cannot be bypassed), so
    // failing it for `find` alone is the faithful stand-in for the real 124.
    const { wt, main } = ready(['build/']);
    fs.mkdirSync(path.join(wt, 'build'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'build', 'out.o'), 'ordinary rubbish\n');
    const SLOW = `timeout() { [[ "$*" == *" find "* ]] && return 124; `
      + `printf 'timeout %s\\n' "$*" >> "$HOME/gh-calls"; shift; "$@"; };`;
    const r = h.run(`${GH_STUB} ${SLOW} ${ARCH} cmd_ws_reap --expect ${'0'.repeat(64)} --session demo-quiet-basin`);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    const o = JSON.parse(r.stdout);
    expect(o.refused).toBe('tree-unreadable');
    expect(o.detail, 'a permanent refusal with no override must carry its remedy')
      .toContain('remove or move the largest ignored directory');
    expect(fs.existsSync(wt)).toBe(true);
    expect(h.git(main, 'branch', '--list', 'ws/quiet-basin')).toContain('ws/quiet-basin');
  }, 30000);

  it('pins the two matchers to ONE list', () => {
    // `_ws_sensitive_match` and the `find` predicate are the same §7 guard asked
    // in two places, and two hand-maintained copies of it is the drift this
    // design cannot afford. Both are derived from `_WS_SENSITIVE_GLOBS`; this is
    // what says they still agree, name by name, including the negatives the list
    // exists to keep out.
    const yes = ['.env', '.env.local', 'production.env', 'My Project.env', 'deploy key.pem',
      'id_rsa', 'id_ed25519', 'id_dsa', 'x.p12', 'v.kdbx', 'credentials.json',
      'prod db.sqlite', 'x.sqlite3', 'x.db', 'x.dump', 'x.sql', 'secrets', 'secrets.yml'];
    const no = ['env.sample', 'environment', 'README.md', 'out.o', 'id_helper.ts',
      'index.js', 'package-lock.json', 'notes.txt'];
    const ask = (names: string[]): string[] => h.sh(
      `for n in ${names.map((n) => `'${n}'`).join(' ')}; do `
      + `m=no; _ws_sensitive_match "$n" && m=yes; `
      + `f=no; [[ -n "$(find "$HOME/matchdir" -mindepth 1 -name "$n" \\( "\${_WS_SENSITIVE_FIND[@]}" \\) -print -quit)" ]] && f=yes; `
      + `echo "$n $m $f"; done`,
    ).split('\n');
    fs.mkdirSync(path.join(h.home, 'matchdir'), { recursive: true });
    for (const n of [...yes, ...no]) fs.writeFileSync(path.join(h.home, 'matchdir', n), 'x');
    for (const line of ask([...yes, ...no])) {
      const [name, byCase, byFind] = line.split(' ').slice(-3);
      expect(byFind, `find and _ws_sensitive_match disagree about ${name}`).toBe(byCase);
    }
    for (const line of ask(yes)) expect(line, `${line} must be secret-shaped`).toMatch(/ yes yes$/);
    for (const line of ask(no)) expect(line, `${line} must NOT be secret-shaped`).toMatch(/ no no$/);
  });
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
    // The number it REPORTS is the number it PINNED. `%H` prints one line per
    // reflog ENTRY, not per commit — this fixture's own reflog repeats five
    // shas thirteen times — so without the `sort -u` the count is entry-shaped
    // while the refs are commit-shaped, and the sheet says "17 commits kept"
    // over eight.
    expect(out.attic).toBe(t.attic.length);
  }, 30000);

  it('pins the tip when the reflog cannot be read, and makes no ref from a non-sha', () => {
    // Two lines of `_ws_attic_pin` in one fixture, both of them about what
    // happens when the reflog is not the well-behaved list of shas it normally
    // is. The tip is appended UNCONDITIONALLY, so a reflog that answers nothing
    // usable still leaves the branch's own commit pinned before the ref is
    // deleted — that commit is the only one deletion can strand. And every
    // candidate is shape-checked first, because the next two statements put it
    // into a git argv and then into a REF NAME: `refs/heads/main` is a string
    // `update-ref` resolves quite happily, so without the check the attic grows
    // `refs/ccrc/attic/<id>/refs/heads/main` — a ref made out of a name.
    //
    // The suffix match is exact: `$*` ends with `--format=%H` for the attic's
    // read and with `%gs` for the tombstone's, so only one of the two is failed.
    const { main, tip } = ready();
    const tok = tokenOf();
    const BADLOG = `git() { [[ "$*" == *"--format=%H" ]] && { printf '%s\\n' refs/heads/main not-a-sha; return 0; }; command git "$@"; };`;
    const r = h.run(`${GH_STUB} ${ARCH} ${BADLOG} cmd_ws_reap --expect ${tok} --session demo-quiet-basin`);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.reaped).toBe('demo-quiet-basin');
    expect(out.attic).toBe(1);
    const t = JSON.parse(fs.readFileSync(String(out.tombstone), 'utf8'));
    expect(t.attic).toEqual([`refs/ccrc/attic/demo-quiet-basin/${tip}`]);
    expect(h.git(main, 'cat-file', '-t', tip)).toBe('commit');
  }, 30000);

  it('pins the tip even past the 200-ref cap, because the CAP is on the reflog', () => {
    // `{ reflog; printf tip; } | sort -u | head -200` applies the cap to the
    // UNION, so the tip is just another line in hex-sort order and drops out
    // whenever 200 distinct shas sort before it. Measured end to end on a
    // workspace with 231 commits: 237 distinct reflog shas, the tip at rank 201,
    // `tip pinned in attic? 0`. That is the one commit a squash merge leaves
    // outside main — the whole reason the attic exists — and once
    // `origin/<branch>` is auto-deleted on merge and the next `fetch --prune`
    // runs it is dangling, with the two-week fuse §5.5(a) exists to remove. The
    // cap belongs to the reflog; the tip is appended after it.
    //
    // The reflog is STUBBED rather than grown to 300 real commits, because the
    // fixture has to be deterministic: whether a real tip sorts inside the first
    // 200 of 205 is a ~2% coin toss, and a test that pins a cap only sometimes
    // pins nothing. Every fake sorts strictly before the tip by construction
    // (same prefix, one hex digit lower at the first non-zero position), and
    // none of them resolves, so `cat-file -e` drops all 300 and what is left in
    // the attic is exactly the fact under test.
    const { main, tip } = ready();
    const tok = tokenOf();
    const HEX = '0123456789abcdef';
    const i = [...tip].findIndex((c) => c !== '0');
    const lower = tip.slice(0, i) + HEX[HEX.indexOf(tip[i]!) - 1];
    const fakes = Array.from({ length: 300 },
      (_v, n) => (lower + n.toString(16).padStart(40 - lower.length, '0')));
    expect(new Set(fakes).size, 'the fakes must be distinct').toBe(300);
    for (const f of fakes) expect(f < tip, `${f} must sort before the tip`).toBe(true);
    fs.writeFileSync(path.join(h.home, 'fakereflog'), `${fakes.join('\n')}\n`);
    const BIGLOG = `git() { [[ "$*" == *"--format=%H" ]] && { cat "$HOME/fakereflog"; return 0; }; command git "$@"; };`;
    const r = h.run(`${GH_STUB} ${ARCH} ${BIGLOG} cmd_ws_reap --expect ${tok} --session demo-quiet-basin`);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.reaped).toBe('demo-quiet-basin');
    const t = JSON.parse(fs.readFileSync(String(out.tombstone), 'utf8'));
    expect(t.attic, 'the tip is pinned however many refs sorted in front of it')
      .toEqual([`refs/ccrc/attic/demo-quiet-basin/${tip}`]);
    expect(out.attic).toBe(1);
    expect(h.git(main, 'cat-file', '-t', tip)).toBe('commit');
  }, 30000);

  it('records in the tombstone the ignored manifest it destroyed, field for field', () => {
    // `git worktree remove` deletes the gitignored content too, so this array is
    // the ONLY record of what went with it — and until this fixture existed the
    // whole loop that builds it was unreached, because every other fixture here
    // has an empty ignored set. The record is `sensitive\tbytes\tpath` and the
    // path goes LAST precisely because `-z` leaves a TAB in a filename intact:
    // read the other way round this entry becomes `"path":"0"` with the
    // filename in the `sensitive` field, which is the deviation-18 defect
    // wearing the tombstone's clothes rather than the audit's.
    const { wt } = ready(['*.log']);
    fs.writeFileSync(path.join(wt, 'a\tb.log'), 'x'.repeat(64));
    const tok = tokenOf();
    const out = JSON.parse(reap(tok).stdout);
    expect(out.reaped).toBe('demo-quiet-basin');
    const t = JSON.parse(fs.readFileSync(String(out.tombstone), 'utf8'));
    expect(t.ignored).toEqual([{ path: 'a\tb.log', bytes: 64, sensitive: false }]);
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
    // COUNTED, not `toContain`. `cmd_ws_archive` (ccd:1064) kills the same pane
    // with the same argv, and `ready()` runs it — so the line is already in the
    // log before the reap starts and a `toContain` passes with (e) deleted.
    // Measured: the mutation sweep reported that assertion's mutant SURVIVED,
    // which is what an assertion that cannot fail looks like from outside.
    const KILL = 'tmux kill-session -t cc-demo-quiet-basin';
    const killsBefore = h.calls().filter((l) => l === KILL).length;
    const out = JSON.parse(reap(tok).stdout);
    expect(out.reaped).toBe('demo-quiet-basin');
    expect(out.proof).toBe('patch-id');
    expect(fs.existsSync(wt)).toBe(false);
    expect(h.git(main, 'branch', '--list', 'ws/quiet-basin')).toBe('');
    expect(h.reg('demo-quiet-basin', 'uuid')).toBeNull();
    expect(h.reg('demo-quiet-basin', 'reaping')).toBeNull();
    expect(h.calls()).toContain('unsupervise demo-quiet-basin');
    // (e), which is not (d): the unit and the pane are two different things to
    // stop, and leaving the pane alive holds the deleted directory open as some
    // shell's cwd.
    expect(h.calls().filter((l) => l === KILL).length,
      'the reap kills the pane itself — the archive having killed one earlier proves nothing')
      .toBe(killsBefore + 1);
    // `null`, never `""`: this is the field Task 17's sheet branches on to tell
    // "we finished the job" from "we finished a job someone else started", and
    // an empty string is truthy nowhere and present everywhere.
    expect(out.resumed).toBeNull();
  }, 30000);

  it('journals before it destroys — a kill at (d) leaves a resumable workspace', () => {
    // THE ORDERING, executable. The attic (a) and the tombstone (b) are written
    // BEFORE the breadcrumb (c), and the breadcrumb before `_ws_unsupervise`
    // (d) — so the process is killed here, inside the (c)–(d) window, and every
    // artifact the recovery needs must already be on disk while nothing has yet
    // been destroyed. Reverse (b) and (c) and this is the state where the
    // workspace is marked half-reaped with no tombstone to resume from: the
    // `branch-moved` refusal for ever, which is the wedge §5.6 exists to end.
    //
    // `exit 9` from a stubbed ccd function is the faithful stand-in for the
    // SIGTERM the outer timeout sends: the process really dies, and the lock
    // comes back because the process died — the kernel closes its descriptor.
    // That is now true of every death, which is why `a kill -9 mid-reap leaves
    // nothing to clear` is a separate fixture rather than a variation on this
    // one: `exit 9` cannot distinguish a lock an EXIT trap released from one
    // the kernel did, and under the shipped-and-replaced trap form the two
    // signals gave opposite answers.
    const { wt, main } = ready();
    const tok = tokenOf();
    const KILL = ARCH.replace('_ws_unsupervise() { echo "unsupervise $1" >> "$HOME/ccd-calls"; };',
      '_ws_unsupervise() { exit 9; };');
    expect(KILL).not.toBe(ARCH);   // a .replace() that matched nothing is a silent no-op
    const r = h.run(`${GH_STUB} ${KILL} cmd_ws_reap --expect ${tok} --session demo-quiet-basin`);
    expect(r.code, 'the fixture must really have died mid-tail').toBe(9);
    expect(fs.existsSync(wt), 'nothing is destroyed before (d)').toBe(true);
    expect(h.git(main, 'branch', '--list', 'ws/quiet-basin')).toContain('ws/quiet-basin');
    const tomb = path.join(h.home, '.cc-sessions', '.reaped', 'demo-quiet-basin.json');
    expect(fs.existsSync(tomb), '(b) is on disk before (c)').toBe(true);
    expect(JSON.parse(fs.readFileSync(tomb, 'utf8')).tip)
      .toBe(h.git(main, 'rev-parse', 'refs/heads/ws/quiet-basin'));
    expect(h.reg('demo-quiet-basin', 'reaping'), '(c) is on disk before (d)').toBe('worktree');
    expect(h.sh('cmd_ws_attic --session demo-quiet-basin'), '(a) is on disk before both').not.toBe('');
    // And the journal is what makes it finishable: the very next invocation
    // resumes rather than refusing, with the lock free because the trap ran.
    const out = JSON.parse(reap(tok).stdout);
    expect(out.reaped).toBe('demo-quiet-basin');
    expect(out.resumed).toBe('worktree');
    expect(fs.existsSync(wt)).toBe(false);
    expect(h.git(main, 'branch', '--list', 'ws/quiet-basin')).toBe('');
    // The resumed run counts the attic it INHERITED rather than reporting zero:
    // the refs the killed run pinned are what the sheet has to name, and the
    // resume is the run the human is looking at.
    expect(out.attic).toBeGreaterThan(0);
  }, 30000);

  it('advances the journal to clips BEFORE it removes them', () => {
    // The last breadcrumb, and the only window with no function boundary to
    // interrupt at — so `rm` itself is the clock. `-rf` is the discriminator
    // and it is the whole reason this stub works: the reap runs `rm -f` several
    // times before it gets here (`_ws_collect_ignored`'s two scratch files,
    // Phase B's stderr capture), and a blanket `rm() { exit 7; }` dies inside
    // the AUDIT half with nothing journalled at all — measured, `reaping` read
    // null and the test failed for a reason that had nothing to do with clips.
    // `rm -rf` appears exactly once in the file, at (h).
    //
    // A resume reading `clips` and one reading `branch` take the same path
    // through the tail, so this value is diagnostic rather than a branch
    // condition — which is precisely why nothing else can see it, and why it
    // would otherwise be a line that could be deleted with the suite green.
    const { main } = ready();
    fs.mkdirSync(path.join(h.home, '.cc-clips', 'demo-quiet-basin'), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.cc-clips', 'demo-quiet-basin', 'a.png'), 'x');
    const tok = tokenOf();
    const r = h.run(`${GH_STUB} ${ARCH} rm() { [[ "$1" == -rf ]] && exit 7; command rm "$@"; }; `
      + `cmd_ws_reap --expect ${tok} --session demo-quiet-basin`);
    expect(r.code, 'the fixture must really have died at the rm').toBe(7);
    expect(h.reg('demo-quiet-basin', 'reaping')).toBe('clips');
    // (g) is already done by then — the journal never runs ahead of the work.
    expect(h.git(main, 'branch', '--list', 'ws/quiet-basin')).toBe('');
  }, 30000);

  it('stops on a worktree removal it could not do, and keeps the registry', () => {
    // The one failure in the destructive sequence that is not a race: git
    // refuses, or the directory is held open. Losing the registry here would
    // leave a live worktree nothing in ccrc can name — so the rule is STOP, and
    // the session is already stopped, so `ws-restore` is the way back. The
    // breadcrumb stays at `worktree` because that is exactly where it stopped.
    const { wt, main } = ready();
    const tok = tokenOf();
    const NOWT = `git() { [[ "$*" == *"worktree remove"* ]] && { echo "fatal: nope" >&2; return 1; }; command git "$@"; };`;
    const r = h.run(`${GH_STUB} ${ARCH} ${NOWT} cmd_ws_reap --expect ${tok} --session demo-quiet-basin`);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    const o = JSON.parse(r.stdout);
    expect(o.refused).toBe('worktree-remove-failed');
    expect(o.detail).toContain('nope');       // git's own words, not ccd's guess
    expect(o.reaped).toBeUndefined();
    expect(fs.existsSync(wt)).toBe(true);
    expect(h.git(main, 'branch', '--list', 'ws/quiet-basin')).toContain('ws/quiet-basin');
    expect(h.reg('demo-quiet-basin', 'uuid')).not.toBeNull();
    expect(h.reg('demo-quiet-basin', 'reaping')).toBe('worktree');
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
    // A directory beside the file, so `[[ -f "$f" ]]` has something to reject:
    // without it a subdirectory joins the manifest as a clip whose "size" is
    // the inode's, and `toEqual` is what makes that a failure rather than an
    // extra entry nobody looks at.
    fs.mkdirSync(path.join(clips, 'thumbs'));
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
    const tomb = path.join(h.home, '.cc-sessions', '.reaped', 'demo-quiet-basin.json');
    const journal = fs.readFileSync(tomb, 'utf8');
    const r = h.run(`${GH_STUB} ${ARCH} cmd_ws_reap --expect ${tok} --session demo-quiet-basin`);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.reaped).toBe('demo-quiet-basin');
    expect(out.resumed).toBe('worktree');
    expect(h.git(main, 'branch', '--list', 'ws/quiet-basin')).toBe('');
    expect(h.reg('demo-quiet-basin', 'uuid')).toBeNull();
    // AND THE JOURNAL IS NOT REWRITTEN. A resume that re-ran (a) and (b) would
    // overwrite the tombstone from a world where the worktree is already gone:
    // the ignored manifest of what was destroyed, the proof rung, the PR — all
    // replaced by the empty values readable now. That document is the only
    // thing left that describes the deletion, so it is written once.
    expect(fs.readFileSync(tomb, 'utf8')).toBe(journal);
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

  it('re-proves Phase B on resume — the DIRTY read is checked too, not just the ignored one', () => {
    // The block's comment claims "both reads checked"; the fixture above fails
    // only the ignored one, so this is the other half. An unreadable
    // `status --porcelain` counts zero lines, and zero lines is exactly what a
    // clean tree looks like — the same shape as the archive manifest's
    // deviation-6 defect, on the path that has no token to fall back on.
    // `--ignored` is excluded from the stub so the failure is unambiguous.
    const { wt, main } = ready();
    const tok = tokenOf();
    h.sh('_reg_set demo-quiet-basin reaping worktree');
    fs.mkdirSync(path.join(h.home, '.cc-sessions', '.reaped'), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.cc-sessions', '.reaped', 'demo-quiet-basin.json'),
      JSON.stringify({ id: 'demo-quiet-basin', project: 'demo', branch: 'ws/quiet-basin',
        tip: h.git(main, 'rev-parse', 'refs/heads/ws/quiet-basin') }));
    const NOSTATUS = `git() { [[ "$*" == *"status --porcelain"* && "$*" != *"--ignored"* ]] && return 128; command git "$@"; };`;
    const r = h.run(`${GH_STUB} ${ARCH} ${NOSTATUS} cmd_ws_reap --expect ${tok} --session demo-quiet-basin`);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    const o = JSON.parse(r.stdout);
    expect(o.refused).toBe('tree-unreadable');
    expect(o.detail).toContain('the tree at');   // not the ignored-set sentence
    expect(fs.existsSync(wt)).toBe(true);
    expect(h.reg('demo-quiet-basin', 'reaping')).toBe('worktree');
  }, 30000);

  it('re-proves Phase D1 on resume — a status it cannot read is not reaped either', () => {
    // `_ws_status` fails closed on a NON-ZERO exit as well as on an
    // unrecognised word, and the resume path has to honour both: a pane whose
    // pid cannot be read is a session that may well be mid-turn. Without the
    // `|| { status-unknown … }` arm the failure falls through as an empty
    // string, which is not `busy`, and the worktree goes.
    const { wt, main } = ready();
    const tok = tokenOf();
    h.sh('_reg_set demo-quiet-basin reaping worktree');
    fs.mkdirSync(path.join(h.home, '.cc-sessions', '.reaped'), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.cc-sessions', '.reaped', 'demo-quiet-basin.json'),
      JSON.stringify({ id: 'demo-quiet-basin', project: 'demo', branch: 'ws/quiet-basin',
        tip: h.git(main, 'rev-parse', 'refs/heads/ws/quiet-basin') }));
    // Alive, with a pane, whose pid does not read back — `_ws_status` returns 1.
    const NOPID = ARCH
      .replace('_alive() { return 1; };', '_alive() { return 0; };')
      .replace('tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 1; };',
               'tmux() { case "$1" in list-panes) : ;; *) echo "tmux $*" >> "$HOME/ccd-calls" ;; esac; };');
    expect(NOPID.includes('list-panes')).toBe(true);   // both replaces really matched
    expect(NOPID.includes('_alive() { return 0; };')).toBe(true);
    const r = h.run(`${GH_STUB} ${NOPID} cmd_ws_reap --expect ${tok} --session demo-quiet-basin`);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    expect(JSON.parse(r.stdout).refused).toBe('status-unknown');
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

  it('refuses a breadcrumb with no tombstone behind it', () => {
    // The half-state a hand-edited registry or a lost filesystem write leaves:
    // `reaping` says a removal started, and the document that says WHAT it was
    // removing is not there. `tombtip` reads empty, and empty is not a tip — it
    // is the absence of the only proof this path has, since Phase C is
    // deliberately not re-run here. With the branch also gone the two empties
    // COMPARE EQUAL, so without the `-z` conjunct the run walks past its own
    // proof and reports a reap for a workspace it never established anything
    // about, clearing the registry on the way.
    const { wt, main, tip } = ready();
    const tok = tokenOf();
    h.sh('_reg_set demo-quiet-basin reaping worktree');
    h.git(main, 'worktree', 'remove', wt);
    h.git(main, 'update-ref', '-d', 'refs/heads/ws/quiet-basin', tip);
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', '.reaped', 'demo-quiet-basin.json')))
      .toBe(false);
    const r = h.run(`${GH_STUB} ${ARCH} cmd_ws_reap --expect ${tok} --session demo-quiet-basin`);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    const o = JSON.parse(r.stdout);
    expect(o.refused).toBe('branch-moved');
    expect(o.reaped).toBeUndefined();
    expect(h.reg('demo-quiet-basin', 'uuid')).not.toBeNull();
    expect(h.reg('demo-quiet-basin', 'reaping')).toBe('worktree');
  }, 30000);

  it('resumes against the tombstone tip, so the CAS is still a CAS', () => {
    // `REAP_TIP="$tombtip"` is the line that makes the resume's delete a
    // compare-and-swap at all, and it is invisible until the branch moves
    // between the tombstone check and the delete. Measured on git 2.43:
    // `update-ref -d <ref> ""` deletes UNCONDITIONALLY at exit 0 — an empty
    // old-value reads as "no old value given", exactly like the all-zeros name
    // — so with that assignment gone the resume stops proving anything and
    // removes whatever the ref points at now.
    //
    // The branch is moved from a stub of `_ws_gc_bytes`, which `_ws_reap_tail`
    // calls first: the stub is a CLOCK, standing in for another box pushing in
    // the window, and nothing here is a claim about that function. The
    // replacement commit carries the same tree for the reason the evaluated-path
    // CAS test gives.
    const { wt, main, tip } = ready();
    const tok = tokenOf();
    const moved = h.git(main, 'commit-tree', `${tip}^{tree}`, '-p', tip, '-m', 'someone else pushed');
    h.sh('_reg_set demo-quiet-basin reaping worktree');
    fs.mkdirSync(path.join(h.home, '.cc-sessions', '.reaped'), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.cc-sessions', '.reaped', 'demo-quiet-basin.json'),
      JSON.stringify({ id: 'demo-quiet-basin', project: 'demo', branch: 'ws/quiet-basin', tip }));
    h.git(main, 'worktree', 'remove', wt);
    const MOVE = `_ws_gc_bytes() { git -C "${main}" update-ref refs/heads/ws/quiet-basin ${moved} ${tip}; echo 0; };`;
    const r = h.run(`${GH_STUB} ${ARCH} ${MOVE} cmd_ws_reap --expect ${tok} --session demo-quiet-basin`);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    const o = JSON.parse(r.stdout);
    expect(o.refused).toBe('branch-moved');
    expect(o.reaped).toBeUndefined();
    expect(h.git(main, 'rev-parse', 'refs/heads/ws/quiet-basin')).toBe(moved);
    expect(h.reg('demo-quiet-basin', 'uuid')).not.toBeNull();
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

  it('resumes from a clips breadcrumb, where the branch is SUPPOSED to be gone', () => {
    // THE WEDGE THE PER-PHASE RULE EXISTS TO END. §5.6 says "re-validate
    // `refs/heads/$branch == $tip` from the tombstone, THEN continue from the
    // recorded phase" — and applied unconditionally that re-validation is a
    // contradiction for `reaping=clips`, because (g) has already CAS-deleted
    // the branch by then. `live` reads empty, `tombtip` is a sha, so the gate
    // says "moved" for the one phase in which gone is the correct state, and
    // it says it FOREVER: the clips directory leaks, the registry row survives
    // with no worktree and no branch, `ccd ls` and the PWA keep showing it, and
    // the detail claims nothing was deleted after the worktree when in fact
    // everything up to and including the branch was.
    //
    // This is also the fixture that pins (g)'s `show-ref` gate in the SKIP
    // direction. `if true` there survives every other test in the file: with
    // the gate gone, this resume runs `update-ref -d` on a ref that is already
    // deleted, git fails, and the run refuses `branch-moved` without clearing
    // the registry — i.e. it manufactures this same wedge on the one path that
    // would otherwise finish.
    const { main } = ready();
    const clips = path.join(h.home, '.cc-clips', 'demo-quiet-basin');
    fs.mkdirSync(clips, { recursive: true });
    fs.writeFileSync(path.join(clips, 'a.png'), 'full resolution, and unrecoverable');
    const tok = tokenOf();
    const r = h.run(`${GH_STUB} ${ARCH} rm() { [[ "$1" == -rf ]] && exit 7; command rm "$@"; }; `
      + `cmd_ws_reap --expect ${tok} --session demo-quiet-basin`);
    expect(r.code, 'the fixture must really have died at the clips rm').toBe(7);
    expect(h.reg('demo-quiet-basin', 'reaping')).toBe('clips');
    expect(h.git(main, 'branch', '--list', 'ws/quiet-basin'), '(g) is done by then').toBe('');
    expect(fs.existsSync(clips), 'and (h) is not').toBe(true);

    const out = JSON.parse(reap(tok).stdout);
    expect(out.reaped, 'a clips resume must FINISH, not refuse for ever').toBe('demo-quiet-basin');
    expect(out.resumed).toBe('clips');
    expect(fs.existsSync(clips), 'the clips it stopped in front of are gone').toBe(false);
    expect(h.reg('demo-quiet-basin', 'uuid'), 'and the row clears itself').toBeNull();
    expect(h.reg('demo-quiet-basin', 'reaping')).toBeNull();
  }, 30000);
});
