// `ccd account-pane` — the one ccd verb this feature adds, and the two
// properties it exists to have: the pane is created through
// `_tmux_new_session` (so it lands in the capped tmux scope), and NOTHING in
// ccd ever presses a key into it.
//
// THE AGENT GRANT IS NOT HERE, DELIBERATELY (D-1865). `EXEC_WHITELIST` is the
// agent package's and `CCD_ARGV` is the server's, and
// `whitelist-subset.test.ts` asserts every granted ccd prefix is reachable
// from some CCD_ARGV entry — so the grant and its builder must land in one
// wave, which is wave 2. This wave ships the VERB.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeCcdHarness, ghContainedEnv, harnessBin, CCD, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-pane-'); });
afterEach(() => { h.cleanup(); });

/** The dispatcher, run the way the box runs it: the real file as a PROGRAM.
 *  `ccd-archive.test.ts`'s `runCcd` is the model — a caps arm that exists is
 *  not the same fact as an arm that calls the function it names. */
const runCcd = (...args: string[]): { code: number; stdout: string; stderr: string } => {
  const stub = harnessBin(h.home);
  // A RECORDING tmux, written into `harnessBin` where it REPLACES the
  // harness's contained refuser rather than racing it (`ccdWsHelpers.ts`
  // states that contract on `harnessBin`; `ccd-archive.test.ts` and
  // `ccd-supervised-start.test.ts` do the same for `systemctl`). A
  // shell-function stub cannot be used here because the dispatcher runs ccd
  // as a SUBPROCESS.
  //
  // `list-sessions` ALWAYS SUCCEEDS, and that is a deliberate choice, not
  // laziness. `_tmux_new_session` takes a fast path when a server is already
  // up — `tmux list-sessions … && { tmux new-session "$@"; return $?; }` —
  // and every fleet box always has one, so the fast path IS the production
  // path for an auth pane. Its slow path runs the harness's poisoned
  // `systemd-run`, whose refusal goes to STDERR unredirected, which would
  // make `expect(r.stderr).toBe('')` below unsatisfiable for a reason that
  // has nothing to do with this verb. The scope-placement half is
  // `ccd-tmux-server.test.ts`'s subject and is asserted there.
  fs.writeFileSync(path.join(stub, 'tmux'),
    '#!/bin/sh\n'
    + 'echo "tmux $*" >> "$HOME/ccd-calls"\n'
    + 'case "$1" in\n'
    + '  new-session)   : > "$HOME/pane-up" ;;\n'
    + '  kill-session)  [ -e "$HOME/pane-up" ] || exit 1; rm -f "$HOME/pane-up" ;;\n'
    + '  has-session)   [ -e "$HOME/pane-up" ] || { echo "can\'t find session: $3" >&2; exit 1; } ;;\n'
    + '  list-sessions) : ;;\n'
    + 'esac\n'
    + 'exit 0\n', { mode: 0o755 });
  const opts = {
    encoding: 'utf8' as const, cwd: h.home,
    env: ghContainedEnv(h.home,
      { ...process.env, HOME: h.home, PATH: `${stub}:${process.env.PATH ?? ''}` },
      { systemd: true, tmux: true }),
  };
  try { return { code: 0, stdout: execFileSync('bash', [CCD, ...args], opts).trim(), stderr: '' }; }
  catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? '').trim(), stderr: String(err.stderr ?? '') };
  }
};

describe('ccd account-pane — the argv contract', () => {
  it('refuses a bare invocation and names its own usage', () => {
    const r = runCcd('account-pane');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('usage: ccd account-pane --id <id>');
  });

  it('refuses when the first token is not --id — the flag is the anchor, not decoration', () => {
    // The shape `cmd_coord_pause` uses. Wave 2 enrols this verb in
    // REQUIRED_VERB_FLAG so a one-token GRANT is a compile error; this is the
    // half that holds on the box, where there is no whitelist at all.
    const r = runCcd('account-pane', 'claude-a', '--method', 'setup-token');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('usage: ccd account-pane --id <id>');
  });

  it('refuses an id no roster account claims', () => {
    const r = runCcd('account-pane', '--id', 'claude-zzz', '--method', 'setup-token');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('unknown-account: claude-zzz');
  });

  it('refuses an id that is not ID_RE-shaped, BEFORE it is interpolated anywhere', () => {
    const r = runCcd('account-pane', '--id', '../etc', '--method', 'setup-token');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('bad id');
    // Nothing was NAMED and nothing was CREATED. Asserted on the pane name
    // rather than on an empty call log, because ccd's own source-time preamble
    // is free to shell out and this test is not about that.
    expect(h.calls().join('\n')).not.toContain('cc-auth-');
    expect(h.calls().filter((c) => c.startsWith('tmux new-session'))).toEqual([]);
  });

  it('refuses a method it does not implement', () => {
    const r = runCcd('account-pane', '--id', 'claude-a', '--method', 'telepathy');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('bad-method: telepathy');
  });
});

describe('ccd account-pane — the pane', () => {
  it('creates cc-auth-<id> at 120x40 running the helper, and answers JSON', () => {
    const r = runCcd('account-pane', '--id', 'claude-a', '--method', 'setup-token');
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ pane: 'cc-auth-claude-a', method: 'setup-token' });
    const newSession = h.calls().filter((c) => c.startsWith('tmux new-session'));
    expect(newSession).toHaveLength(1);
    expect(newSession[0]).toBe(
      `tmux new-session -d -s cc-auth-claude-a -x 120 -y 40 exec '${h.home}/.local/bin/ccd-account-auth' 'claude-a' 'setup-token'`);
  });

  it('presses NO key into the pane it just made', () => {
    // The whole reason this verb is not `_spawn`: `_spawn_settle` drives
    // `_accept_first_run_prompts`, which sends Down and Enter. A robot that
    // answers a sign-in has dismissed it.
    runCcd('account-pane', '--id', 'claude-a', '--method', 'setup-token');
    expect(h.calls().filter((c) => c.startsWith('tmux send-keys'))).toEqual([]);
    expect(h.calls().filter((c) => c.includes('supervise'))).toEqual([]);
  });

  it('is idempotent: a second start refuses with auth-in-progress rather than racing', () => {
    expect(runCcd('account-pane', '--id', 'claude-a', '--method', 'setup-token').code).toBe(0);
    const again = runCcd('account-pane', '--id', 'claude-a', '--method', 'setup-token');
    expect(again.code).toBe(1);
    expect(again.stderr).toContain('auth-in-progress: cc-auth-claude-a');
    expect(h.calls().filter((c) => c.startsWith('tmux new-session'))).toHaveLength(1);
  });

  it('--cancel kills the pane, and says so when there was none', () => {
    runCcd('account-pane', '--id', 'claude-a', '--method', 'setup-token');
    const killed = runCcd('account-pane', '--id', 'claude-a', '--cancel');
    expect(killed.code).toBe(0);
    expect(JSON.parse(killed.stdout)).toEqual({ cancelled: 'cc-auth-claude-a' });
    expect(h.calls()).toContain('tmux kill-session -t cc-auth-claude-a');
    const none = runCcd('account-pane', '--id', 'claude-a', '--cancel');
    expect(none.code).toBe(0);
    expect(JSON.parse(none.stdout)).toEqual({ cancelled: null });
  });
});

describe('ccd account-pane — the structural guards', () => {
  const src = fs.readFileSync(CCD, 'utf8');

  /** The function's EXECUTABLE text: whole-line comments dropped, exactly the
   *  cut `macos-platform.test.ts`'s `executableText` makes. Without it the
   *  assertion below is unsatisfiable by construction — `cmd_account_pane`'s
   *  own header says `_spawn` three times, and it says it precisely because
   *  the reason not to use `_spawn` belongs beside the code that does not. A
   *  guard that forbids naming the thing it forbids is a guard nobody can
   *  ship past. */
  const executable = (body: string): string =>
    body.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

  it('goes through _tmux_new_session and never through _spawn', () => {
    const body = /\ncmd_account_pane\(\) \{[\s\S]*?\n\}\n/.exec(src);
    expect(body, 'ccd/ccd has no cmd_account_pane').toBeTruthy();
    expect(body![0]).toContain('_tmux_new_session -d -s "$pane" -x 120 -y 40');
    expect(executable(body![0]), 'the auth pane must never be a _spawn — see the header')
      .not.toMatch(/_spawn(_start|_settle)?\b/);
    expect(executable(body![0]), 'this verb sends no keys').not.toContain('send-keys');
  });

  it('EVERY tmux send-keys in ccd targets a REGISTRY id, so no typer can reach cc-auth-*', () => {
    // The auth pane's name is `cc-auth-<id>`, and `_tmux` turns a registry id
    // into `cc-<id>` — so the only way a ccd typer could reach an auth pane is
    // a send-keys with a literal target. RE-MEASURED 2026-09-11 on this
    // branch: `grep -n 'tmux send-keys' ccd/ccd` returns NINE lines (11547,
    // 11699, 11702, 11707, 11710, 11713, 12114, 12118, 13651) carrying
    // FOURTEEN occurrences, because five of those lines send twice. Every one
    // names `$t` or `$(_tmux "$id")`; this is the assertion that keeps the
    // fifteenth honest. The floor is asserted on LINES, which is what the loop
    // iterates.
    const lines = src.split('\n').filter((l) => l.includes('tmux send-keys'));
    expect(lines.length, 'the scan matched no send-keys at all').toBeGreaterThanOrEqual(9);
    for (const l of lines) {
      expect(l, `send-keys with a target ccd did not derive from a registry id: ${l.trim()}`)
        .toMatch(/tmux send-keys -t "(\$t|\$\(_tmux "\$id"\))"/);
    }
  });

  it('the verb is dispatched, advertised and named in the usage line', () => {
    // `ccd-archive.test.ts` holds caps and the dispatcher in exact parity in
    // both directions; these three are the same fact said where a reader of
    // this feature will look for it.
    expect(src).toMatch(/^ {2}account-pane\) shift; cmd_account_pane "\$@" ;;$/m);
    expect(src).toMatch(/^account-pane$/m);
    expect(/\*\) echo "usage: ccd \{[^"]*\}/.exec(src)![0]).toContain('account-pane');
  });
});
