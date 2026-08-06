// ws-hold / ws-release — a declared program claim on a workspace, under the
// isolated HOME harness. Adapted from the plan's sketch to the harness's real
// API: there is no `h.wsId`; the id is `${project}-${slug}`, exactly as
// ccd-archive.test.ts's own `workspace()` helper derives it (cmd_ws_add
// requires an existing project repo — `h.makeRepo` — and CCD_WS_SLUG pins the
// slug rather than letting `_ws_slug_new` pick one).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, WS_ADD, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-hold-'); });
afterEach(() => { h.cleanup(); });

// `stdout` is captured beside `stderr` because one of these tests asserts what
// the verb did NOT say: a refusal that still printed `held <id>: …` on stdout
// is exactly the defect the write guard exists to stop, and a code+stderr-only
// helper cannot see it.
const shFail = (snippet: string): { code: number; stderr: string; stdout: string } => {
  try { return { code: 0, stderr: '', stdout: h.sh(snippet) }; }
  catch (e) {
    const err = e as { status?: number; stderr?: Buffer; stdout?: Buffer };
    return { code: err.status ?? 1, stderr: String(err.stderr ?? ''), stdout: String(err.stdout ?? '') };
  }
};

/** A real workspace, named `demo-quiet-basin` — same idiom as
 *  ccd-archive.test.ts's `workspace()`, trimmed to just the id since these
 *  tests never need the worktree path. */
const workspaceId = (): string => {
  h.makeRepo('demo');
  h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
  return 'demo-quiet-basin';
};

/** The same workspace over a repo whose origin READS as GitHub — `makeGhRepo`,
 *  exactly as every reap/audit test builds it — with its branch PUSHED.
 *
 *  Both details are load-bearing for one assertion the `ws-reap` tests make:
 *  that the held rung preempts Phase C's `gh` call. `_ws_reap_eval` walks a
 *  ladder, and every rung it refuses on is a rung it never reaches gh from —
 *  measured on this very fixture, in the red run for these tests: over a plain
 *  `makeRepo` origin it answers `no-remote`, and over `makeGhRepo` with the
 *  branch unpushed it answers `no-upstream`, both with an EMPTY gh-poison log.
 *  Either would have made `expect(ghPoison()).toEqual([])` pass whether or not
 *  the rung existed. Pushed, the ladder runs on to Phase C, the harness's
 *  POISONED gh answers (no `GH_STUB` anywhere in this file — reaching gh is
 *  meant to be visible, not stubbed), the pre-rung answer is `gh-unreadable`
 *  and the poison log has a line in it. That is the state the assertion
 *  discriminates against. */
const ghWorkspaceId = (): string => {
  h.makeGhRepo('demo');
  h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
  h.git(path.join(h.home, 'worktrees', 'demo', 'quiet-basin'),
    'push', '-u', 'origin', 'ws/quiet-basin');
  return 'demo-quiet-basin';
};

/** `cmd_ws_archive` stops the session, and under test there is no tmux and no
 *  systemd — the same three stubs `ccd-ws-reap.test.ts` archives through, for
 *  the same reason. `_alive` returning 1 is the affirmative idle that verb
 *  demands. Carried into the `cmd_ws_reap` calls too, so that a reap which
 *  ever got PAST the held rung in a red run still could not reach the real
 *  tmux. */
const ARCH = `_ws_unsupervise() { echo "unsupervise $1" >> "$HOME/ccd-calls"; };
  _ws_supervise() { :; }; _spawn() { :; };
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 1; }; _alive() { return 1; };`;

describe('ccd ws-hold / ws-release', () => {
  it('holds a workspace: writes the reason verbatim', () => {
    const id = workspaceId();
    const out = h.sh(`cmd_ws_hold --session ${id} --reason "program:agent-evals wave:1/4"`);
    expect(out).toContain(`held ${id}`);
    expect(fs.readFileSync(path.join(h.home, '.cc-sessions', `${id}.hold`), 'utf8'))
      .toBe('program:agent-evals wave:1/4');
  });

  it('re-hold updates the reason in place, exit 0', () => {
    const id = workspaceId();
    h.sh(`cmd_ws_hold --session ${id} --reason "wave:1/4"`);
    h.sh(`cmd_ws_hold --session ${id} --reason "wave:2/4"`);
    expect(fs.readFileSync(path.join(h.home, '.cc-sessions', `${id}.hold`), 'utf8')).toBe('wave:2/4');
  });

  it('release unlinks; releasing an unheld workspace is a no-op at exit 0', () => {
    const id = workspaceId();
    h.sh(`cmd_ws_hold --session ${id} --reason "w"`);
    expect(h.sh(`cmd_ws_release --session ${id}`)).toContain(`released ${id}`);
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', `${id}.hold`))).toBe(false);
    expect(h.sh(`cmd_ws_release --session ${id}`)).toContain(`not held ${id}`);
  });

  it('refuses a main checkout — a hold there is a lie', () => {
    // A registry entry with no `workspace` field is a main checkout.
    h.sh(`mkdir -p "$HOME/.cc-sessions"
      printf u > "$HOME/.cc-sessions/claude-demo.uuid"
      printf claude > "$HOME/.cc-sessions/claude-demo.wrapper"`);
    const r = shFail(`cmd_ws_hold --session claude-demo --reason w`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('not a workspace');
  });

  it('refuses an archived workspace — restore first', () => {
    const id = workspaceId();
    h.sh(`printf 1786000000 > "$HOME/.cc-sessions/${id}.archived"`);
    const r = shFail(`cmd_ws_hold --session ${id} --reason w`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('archived');
  });

  it('refuses an empty reason — a hold nobody can explain is an orphan by construction', () => {
    const id = workspaceId();
    const r = shFail(`cmd_ws_hold --session ${id} --reason ""`);
    expect(r.code).not.toBe(0);
    // The sentence, not just the polarity. `expect(code).not.toBe(0)` alone was
    // green against the pre-task ccd (`cmd_ws_hold: command not found` exits
    // 127) — the one test of this file that never went red, so it proved
    // nothing. It also let a future edit fold this guard into the usage check
    // and answer `usage: ccd ws-hold` instead, which the standing rule
    // ("every refusal is named") forbids.
    expect(r.stderr).toContain('empty reason');
  });

  it('a failed registry write REFUSES — never `held` on stdout with no hold on disk', () => {
    const id = workspaceId();
    // A directory at the target path makes `printf > "$REG/$id.hold"` fail with
    // EISDIR for ANY uid, root included — the portable stand-in for the
    // read-only-FS / ENOSPC / quota failure measured with `chmod 500 "$REG"`.
    // Unguarded, `_reg_set` fails, ccd (`set -uo pipefail`, no `-e`) carries on,
    // and the verb prints `held <id>: <reason>` at exit 0 while nothing is held:
    // the orchestrator records the claim, the next archiveMerged sweep sees no
    // hold and archives the workspace mid-program.
    fs.mkdirSync(path.join(h.home, '.cc-sessions', `${id}.hold`));
    const r = shFail(`cmd_ws_hold --session ${id} --reason "program:evals wave:1/4"`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('NOT held');
    expect(r.stdout).not.toContain(`held ${id}:`);
  });

  it('caps lists both verbs', () => {
    const caps = h.sh('cmd_caps');
    expect(caps).toContain('ws-hold');
    expect(caps).toContain('ws-release');
  });
});

// Destroying a workspace that is by declaration mid-program must take two
// deliberate acts — release, then remove/reap — never one. Both destructive
// verbs gain the same `held` rung, with the reason echoed so the operator or
// orchestrator knows WHICH program refuses.
//
// THE TWO VERBS ANSWER IT DIFFERENTLY, and the difference is not cosmetic.
// `cmd_ws_rm`'s caller is a terminal, every refusal in it `die`s, and this one
// does too. `cmd_ws_reap`'s caller is the PWA: its own header says "a refusal
// prints on stdout and exits 0: it is an answer", and that convention is NOT
// confined to the recomputed-audit verdicts `_ws_reap_eval` produces — the
// flock contest's `in-progress` (ccd, inside `cmd_ws_reap` itself, on a path
// `_ws_reap_eval` never reaches) is a state refusal written exactly that way,
// as `ccd-ws-reap.test.ts`'s `refused()` helper spells out. So `held` is a
// TOKEN there, not a stderr string: `parseReap` (server/src/wsaudit.ts) reads
// `refused` out of stdout and collapses everything else to `refused:'error'`
// with the raw shell text as the sentence — a bash command on a phone screen.
// The token's copy lives in that file's `SENTENCES`, which
// `wsaudit.test.ts`'s linkage test holds exactly equal to the set of tokens
// ccd's source can emit; adding the rung without the entry fails there.
describe('held is a refusal rung on the destructive verbs', () => {
  it('ws-rm refuses a held workspace, naming the reason', () => {
    // FAILS without the `cmd_ws_rm` rung: ws-rm tears the workspace down.
    const id = workspaceId();
    h.sh(`cmd_ws_hold --session ${id} --reason "program:x wave:2/4"`);
    const r = shFail(`cmd_ws_rm ${id}`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('held');
    expect(r.stderr).toContain('program:x wave:2/4');
    // And nothing was torn down: the worktree is still there.
    const workdir = h.sh(`_reg_get ${id} workdir`);
    expect(fs.existsSync(workdir)).toBe(true);
  });

  it('ws-rm proceeds again after release', () => {
    const id = workspaceId();
    h.sh(`cmd_ws_hold --session ${id} --reason w`);
    h.sh(`cmd_ws_release --session ${id}`);
    // Whatever ws-rm does next is Task-agnostic — the pin is only that it gets
    // PAST the held rung: the refusal, if any, must not be `held`. DISCLOSED:
    // this one passes identically against the pre-task ccd (there was no rung
    // to get past), so it is a regression guard for the rung's polarity, not
    // evidence that the rung exists. The tests either side of it are that.
    const r = shFail(`cmd_ws_rm ${id}`);
    expect(r.stderr).not.toContain('held');
  });

  it('ws-rm reads an UNREADABLE hold as held — the fail-shut polarity, pinned', () => {
    // The spec's required `unreadable-hold-reads-as-held` case. FAILS without
    // it in two distinct ways: with `-f` in place of `-e` the rung does not
    // fire at all and ws-rm destroys a workspace a program declared mid-flight
    // (the polarity inverts); with `cat`'s `|| echo` fallback dropped the
    // refusal fires but says `held:  — release first`, naming no program at
    // all, which is the same sentence a released workspace would get.
    //
    // A DIRECTORY at the hold path is the portable stand-in, the same fixture
    // and the same reason as the failed-registry-write test above: `cat` on a
    // directory fails for ANY uid, root included, where `chmod 000` does not.
    // What it therefore pins is `-e` vs `-f` and the unreadable branch's copy;
    // it does NOT distinguish `-e` from `-r` (a directory is readable), and no
    // fixture that survives being run as root can.
    const id = workspaceId();
    fs.mkdirSync(path.join(h.home, '.cc-sessions', `${id}.hold`));
    const r = shFail(`cmd_ws_rm ${id}`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('held');
    expect(r.stderr).toContain('<unreadable — treat as held>');
    expect(fs.existsSync(h.sh(`_reg_get ${id} workdir`))).toBe(true);
  });

  it('ws-reap answers held — on an ARCHIVED workspace, in the state a reap would otherwise proceed on', () => {
    // THE STATE THE RUNG EXISTS FOR. `_ws_reap_eval` refuses `not-archived`,
    // so a workspace is only ever reapable once archived — a fixture that
    // never archives pins argv ordering and nothing else, and a rung narrowed
    // to `[[ -e …hold && ! -f …archived ]]` would survive it while firing in
    // zero real cases. Nothing gates the reachable sequence this builds:
    // hold -> ws-archive (which has no hold rung of its own) -> reap.
    //
    // FAILS without the rung, measured: `_ws_reap_eval` runs the ladder and
    // answers `gh-unreadable` — the harness's poisoned gh is what Phase C
    // reaches — with a line in the poison log. So `ghPoison()` being EMPTY is
    // the assertion that this rung preempts the gh call rather than merely
    // beating it to an answer, and `ghWorkspaceId` says what the fixture has
    // to carry for that to be true.
    const id = ghWorkspaceId();
    h.sh(`cmd_ws_hold --session ${id} --reason "program:x wave:2/4"`);
    h.sh(`${ARCH} cmd_ws_archive --session ${id}`);
    // A SHAPE-VALID token, not `whatever`: the pre-task `die "bad token"` made
    // `expect(code).not.toBe(0)` pass for the wrong reason, and the refusal
    // this rung owes the PWA is an ANSWER — exit 0, JSON on stdout.
    const out = h.sh(`${ARCH} cmd_ws_reap --expect ${'a'.repeat(64)} --session ${id}`);
    const o = JSON.parse(out);
    expect(o.refused).toBe('held');
    expect(o.reaped, 'a refusal must never also report a reap').toBeUndefined();
    expect(o.detail).toContain('program:x wave:2/4');
    expect(o.detail).toContain('ws-release');
    // It cost no gh call, no fetch and no breadcrumb: the rung is above the
    // recomputed audit, not inside it.
    expect(h.ghPoison(), 'the held rung must preempt Phase C entirely').toEqual([]);
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', `${id}.reaping`))).toBe(false);
    // And nothing was destroyed.
    expect(fs.existsSync(h.sh(`_reg_get ${id} workdir`))).toBe(true);
    expect(h.reg(id, 'uuid'), 'the registry survives every refusal').not.toBeNull();
  }, 30000);

  it('ws-reap reads an UNREADABLE hold as held too — same polarity, same archived state', () => {
    // The reap half of the required `unreadable-hold-reads-as-held` case: the
    // two rungs carry the same comment and must carry the same behaviour.
    // FAILS with `-f` for `-e` (the reap proceeds into `_ws_reap_eval` on a
    // held workspace) and with the `|| echo` fallback dropped (the detail
    // names no program).
    const id = ghWorkspaceId();
    h.sh(`cmd_ws_hold --session ${id} --reason "program:x"`);
    h.sh(`${ARCH} cmd_ws_archive --session ${id}`);
    // Replace the hold file with a directory: present, and unreadable by cat.
    fs.unlinkSync(path.join(h.home, '.cc-sessions', `${id}.hold`));
    fs.mkdirSync(path.join(h.home, '.cc-sessions', `${id}.hold`));
    const o = JSON.parse(h.sh(`${ARCH} cmd_ws_reap --expect ${'a'.repeat(64)} --session ${id}`));
    expect(o.refused).toBe('held');
    expect(o.detail).toContain('<unreadable — treat as held>');
    expect(h.ghPoison()).toEqual([]);
    expect(fs.existsSync(h.sh(`_reg_get ${id} workdir`))).toBe(true);
  }, 30000);
});
