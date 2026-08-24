/**
 * D3: a deliberate stop becomes a recorded fact, supervision is measured by a
 * heartbeat, and a dead row says WHICH KIND of dead it is (spec §4.1-§4.4).
 *
 * On 2026-08-11 an agent-surface `stop` removed a session's boot persistence
 * and the row went dead-but-listed, indistinguishable from a crash. Meanwhile
 * a second session ran for 22 minutes with a tmux pane and NO systemd unit —
 * no auto-swap, no uuid-sync, no auto-compact — and died with nothing
 * recording that it had. `ALIVE=no` was the one word `ccd ls` had for both,
 * plus for a row that had never started at all.
 *
 * The server cannot ask systemd anything (the agent's read whitelist permits
 * ~/.cc-sessions and ~/.claude*, not ~/.config/systemd), so the supervisor
 * PUBLISHES what it knows and both sides read one directory. These tests drive
 * the bash twin; the TypeScript twin and the shared fixture land later.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-session-state-'); });
afterEach(() => { h.cleanup(); });

const ID = 'demo-quiet-mesa';
const REGDIR = (): string => path.join(h.home, '.cc-sessions');

/** Captures stderr on a SUCCESSFUL run too (the harness's `sh` pipes it to the
 *  parent), and times out so an argv-parse bug hangs one case, not the suite. */
const run = (snippet: string): { code: number; stdout: string; stderr: string } => {
  const r = spawnSync('bash', ['-c', `source "${CCD}"; ${snippet}`], {
    encoding: 'utf8', cwd: h.home, timeout: 15000,
    env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true }),
  });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

describe('_ws_unsupervise records a deliberate stop', () => {
  const NOSYS = `systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; };`;

  it('stamps epoch plus the default surface `ccd`, and drops the heartbeat', () => {
    // The default is `ccd` because the four internal call sites — ws-rm,
    // ws-archive, ws-reap and forget — ARE ccd acting on its own account.
    // Kills the mutant that stamps nowhere but cmd_stop: without the stamp
    // inside this choke point every archived workspace classifies `orphan`
    // for ever.
    fs.writeFileSync(path.join(REGDIR(), `${ID}.supervised`), String(Math.floor(Date.now() / 1000)));
    h.sh(`${NOSYS} _ws_unsupervise ${ID}`);
    expect(h.reg(ID, 'stopped')).toMatch(/^\d{10} ccd$/);
    expect(h.reg(ID, 'supervised')).toBeNull();
    expect(h.calls()).toEqual([`systemctl --user disable --now claude-session@${ID}`]);
  });

  it('records the surface it was handed', () => {
    h.sh(`${NOSYS} _ws_unsupervise ${ID} pwa`);
    expect(h.reg(ID, 'stopped')).toMatch(/^\d{10} pwa$/);
  });

  it('normalizes a word outside the closed set to `unknown` — it is text off the wire', () => {
    // Kills the mutant that writes the caller's word through unvalidated,
    // which would put arbitrary wire text (spaces and all) into a registry
    // field the server parses as two fields.
    expect(h.sh(`${NOSYS} _ws_unsupervise ${ID} 'pwa hax'; cat "$REG/${ID}.stopped"`))
      .toMatch(/^\d{10} unknown$/);
  });

  it('an EXPLICIT empty surface normalizes to `unknown`, not to the internal `ccd` default', () => {
    // Review finding (MINOR #4): `${2:-ccd}` defaults on empty too, so a
    // caller declaring `--surface ''` — an empty word genuinely off the wire
    // — fell through the closed-set check entirely and stamped `ccd`,
    // misattributing a real stop to ccd acting on its own account. `${2-ccd}`
    // (no colon) defaults ONLY when $2 is truly absent, which is the shape
    // of the four internal call sites that pass no second argument at all —
    // covered separately by the "default surface `ccd`" test above.
    h.sh(`${NOSYS} _ws_unsupervise ${ID} ''`);
    expect(h.reg(ID, 'stopped')).toMatch(/^\d{10} unknown$/);
  });

  it('stamps even when systemd refuses — the intent is a fact either way', () => {
    // The disable is already swallowed (`2>/dev/null || true`), so a box with
    // no lingering must still record that somebody stopped this row. Kills
    // the mutant that stamps only after a successful systemctl.
    h.sh(`systemctl() { return 1; }; _ws_unsupervise ${ID} cli`);
    expect(h.reg(ID, 'stopped')).toMatch(/^\d{10} cli$/);
  });

  it('warns on stderr when systemd refuses the disable — the mirror of _ws_supervise\'s own warning', () => {
    // Review finding (IMPORTANT #2): the old inlined `cmd_stop` warned
    // `ccd: warn: could not disable unit claude-session@<id> (it may
    // resurrect if it was enabled)` on this exact failure. Routing through
    // this choke point swallowed it (`2>/dev/null || true`), so an operator
    // on a box with lingering off or a missing unit file got an unqualified
    // "stopped" with nothing saying the disable did not take, while its
    // mirror `_ws_supervise` still warns on the same failure one function up.
    const r = run(`systemctl() { return 1; }; _ws_unsupervise ${ID} cli`);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain(`could not disable unit claude-session@${ID}`);
  });

  it('_ws_supervise clears the stamp — supervision supersedes an earlier stop', () => {
    h.sh(`${NOSYS} _ws_unsupervise ${ID} pwa`);
    h.sh(`${NOSYS} _ws_supervise ${ID}`);
    expect(h.reg(ID, 'stopped')).toBeNull();
  });

  it('a SUCCESSFUL spawn clears it too — the direct path only, success only', () => {
    // Success only, deliberately: `_spawn` clears `.stopped` on `prompt_rc ==
    // 0` and leaves it standing on a failure — ccd-spawn-verdict.test.ts:146
    // pins that half of the contract, and this test must not contradict it.
    // The failed-revival path is NOT `_spawn`'s to fix at all: on the
    // supervised path (`ccd start`/`ccd enable`/`ccd ensure` outside a unit)
    // `_spawn` runs in a DIFFERENT PROCESS, so when the unit never comes up —
    // a crash-looped FAILED unit, `enable --now` itself failing,
    // `_supervised_start`'s own 30s timeout — `_spawn` never runs in this
    // process and never gets the chance. That case is fixed at the verb level
    // instead (cmd_start/cmd_ensure, tested below), on attempt rather than
    // success.
    h.sh(`_reg_set ${ID} wrapper claude-a
      _reg_set ${ID} workdir "$HOME"
      _reg_set ${ID} uuid b7001948-0000-4c2f-9a1b-0cfc0dc3d199`);
    h.sh(`systemctl() { :; }; _ws_unsupervise ${ID} agent`);
    expect(h.reg(ID, 'stopped')).not.toBeNull();
    h.sh(`_accept_first_run_prompts() { return 0; }; _inject_spawn_effort() { :; };
      tmux() { :; }; _spawn ${ID} resume`);
    expect(h.reg(ID, 'stopped')).toBeNull();
  });
});

describe('a failed revival still clears .stopped, at the verb level', () => {
  // Review finding (IMPORTANT #1): before this fix, `.stopped` was cleared in
  // exactly two places — `_ws_supervise` and a SUCCESSFUL `_spawn` — and
  // NEITHER is on `ccd start`/`ccd enable`/`ccd ensure`'s path: `_ws_supervise`
  // is reached only from ws-add/ws-restore, and `_supervised_start` inlines
  // its own `enable --now` rather than routing through it. So spec §4.1's
  // clause naming those three verbs was unimplemented — measured: stop from
  // the PWA, revive two days later via `POST /api/sessions/:id/ensure`,
  // resume dies rc 3, and the row still prints "stopped by pwa, 2d ago"
  // because `_session_state` checks the stop stamp BEFORE `started`. Fixed by
  // clearing `.stopped` at the verb level, unconditionally on ATTEMPT (mirror
  // of the existing `swapblocked` clear, same altitude, same reasoning): a
  // failed revival must read `orphan` — the honest signal that someone tried
  // — never a stale `stopped` that hides the attempt.
  const seed = (): void => {
    h.sh(`_reg_set ${ID} uuid b7001948-0000-4c2f-9a1b-0cfc0dc3d199
      _reg_set ${ID} project demo
      _reg_set ${ID} workdir "$HOME"
      _reg_set ${ID} wrapper claude-a
      _reg_set ${ID} started 1`);
    h.sh(`systemctl() { :; }; _ws_unsupervise ${ID} pwa`);
  };

  it('cmd_start clears a stale .stopped even when the revival attempt fails, and the row reads `orphan`', () => {
    seed();
    const r = run(`_alive() { return 1; }; _supervised_start() { return 3; };
      cmd_start ${ID}`);
    expect(r.code).toBe(3);
    expect(h.reg(ID, 'stopped')).toBeNull();
    expect(h.sh(`_alive() { return 1; }; _session_state ${ID}`)).toBe('orphan');
  });

  it('cmd_ensure clears a stale .stopped even when the revival attempt fails, and the row reads `orphan`', () => {
    seed();
    const r = run(`_alive() { return 1; }; _supervised_start() { return 4; };
      cmd_ensure ${ID}`);
    expect(r.code).toBe(4);
    expect(h.reg(ID, 'stopped')).toBeNull();
    expect(h.sh(`_alive() { return 1; }; _session_state ${ID}`)).toBe('orphan');
  });
});

describe('cmd_stop', () => {
  const STOP = `systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; }; `
    + `tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; };`;

  it('strips the flag BEFORE the arity rule — `ccd stop <id> --surface pwa` is a one-id stop', () => {
    // THE case that breaks if the order is wrong: with the flag still in
    // argv, `$# -ge 2` reads this as a two-argument stop and `_id` mints
    // `<id>---surface`, aiming the stop at a session that does not exist
    // while the real one keeps running.
    expect(h.sh(`${STOP} cmd_stop ${ID} --surface pwa`)).toBe(`stopped ${ID}`);
    expect(h.calls()).toEqual([
      `systemctl --user disable --now claude-session@${ID}`,
      `tmux kill-session -t cc-${ID}`,
    ]);
    expect(h.reg(ID, 'stopped')).toMatch(/^\d{10} pwa$/);
  });

  it('takes the flag before the id as well', () => {
    expect(h.sh(`${STOP} cmd_stop --surface agent ${ID}`)).toBe(`stopped ${ID}`);
    expect(h.reg(ID, 'stopped')).toMatch(/^\d{10} agent$/);
  });

  it('still recomputes <wrapper>-<project> for the legacy two-argument form, flag and all', () => {
    expect(h.sh(`${STOP} cmd_stop claude-a demo --surface pwa`)).toBe('stopped claude-a-demo');
    expect(h.reg('claude-a-demo', 'stopped')).toMatch(/^\d{10} pwa$/);
  });

  it('records `cli` when nobody declared a surface', () => {
    // A declaration, not an authentication. A session shelling `ccd stop`
    // from its own Bash tool passes no flag and is honestly `cli` — which is
    // exactly what it looks like from the box. Kills the mutant that lets
    // cmd_stop fall through to _ws_unsupervise's internal `ccd` default.
    h.sh(`${STOP} cmd_stop ${ID}`);
    expect(h.reg(ID, 'stopped')).toMatch(/^\d{10} cli$/);
  });

  it('refuses a --surface with nothing after it instead of spinning on a failed shift', () => {
    // ccd runs under `set -uo pipefail` with NO `-e`: a bare `shift 2` at the
    // end of argv fails, shifts nothing, and the parse loop never terminates.
    const r = run(`${STOP} cmd_stop ${ID} --surface`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('usage: ccd stop');
  });

  it('refuses an empty argv once the flags are gone', () => {
    const r = run(`${STOP} cmd_stop --surface pwa`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('usage: ccd stop');
  });

  it('warns when systemd refuses the disable, and still prints the success line', () => {
    // Review finding (IMPORTANT #2), from cmd_stop's own call site: a
    // deliberate stop is recorded (and the pane is still killed) even when
    // the unit disable fails, but the operator must be told the disable
    // itself did not take — see the matching `_ws_unsupervise` test above.
    const r = run(`systemctl() { return 1; }; tmux() { :; }; cmd_stop ${ID}`);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe(`stopped ${ID}`);
    expect(r.stderr).toContain(`could not disable unit claude-session@${ID}`);
  });
});

describe('the supervisor heartbeat', () => {
  it('stamps BEFORE cmd_ensure, which can block for fifteen minutes', () => {
    // §4.2: cmd_ensure sits inside _accept_first_run_prompts for up to 15
    // minutes while a 700k-token resume works through its gates. A heartbeat
    // that started with the watch loop would classify every large resume
    // `unsupervised` — the loudest possible false alarm, fired precisely when
    // the fleet is doing the most work. The stub reads the stamp from inside
    // ensure, so "after" cannot pass.
    //
    // REWRITTEN for D-B8-14: the watch loop asks `_session_probe`, not
    // `_alive`, so the old `_alive() { return 1; }` stub went dark — the loop
    // would probe the REAL substrate, read the silence as `unknown`, and spin
    // for ever (unknown refuses to exit by design). The stub now speaks the
    // probe's own contract, and `gone` is the loop's only exit.
    h.sh(`_reg_set ${ID} uuid u`);
    const r = run(`_session_probe() { PROBE_VERDICT=gone; PROBE_DETAIL=; }; systemctl() { :; }; sleep() { :; };
      cmd_ensure() { echo "ensure saw: $(cat "$HOME/.cc-sessions/$1.supervised" 2>/dev/null || echo none)"; };
      cmd_supervise ${ID}`);
    expect(r.stdout).toMatch(/ensure saw: \d{10}/);
  });

  it('re-stamps from the watch loop, not only at entry', () => {
    // The loop ticks every 5s and the freshness window is 120s, so a
    // supervisor that stamped once at entry would go stale UNDER ITS OWN
    // LIVE SESSION after two minutes. Eight simulated ticks cross the 30s
    // beat exactly once: entry stamp + one loop stamp = 2.
    //
    // REWRITTEN for D-B8-14, same reason as above: the counter now drives
    // `_session_probe` — eight `live` answers, then `gone`, the only exit.
    h.sh(`_reg_set ${ID} uuid u`);
    run(`n=0; _session_probe() { n=$((n+1)); PROBE_DETAIL="";
        if (( n <= 8 )); then PROBE_VERDICT=live; else PROBE_VERDICT=gone; fi; };
      systemctl() { :; }; sleep() { :; }; cmd_ensure() { :; };
      _sync_uuid() { :; }; _auto_swap_check() { :; }; _auto_compact_check() { :; };
      _reg_set() { printf '%s' "$3" > "$REG/$1.$2"; echo "stamp $2" >> "$HOME/ccd-calls"; };
      cmd_supervise ${ID}`);
    // THAT `_reg_set` REPLACED THE REAL ONE for the run above. It is a
    // RECORDING stub — the `stamp <field>` log is the only thing this test
    // reads — and it is deliberately BYTE-EQUIVALENT to the shipped writer
    // but NOT MECHANISM-EQUIVALENT: the old truncating redirect, no tmp, no
    // rename. Any `h.reg(...)` assertion in a block carrying this stub would
    // measure THE STUB'S bytes, not ccd's; atomicity is pinned in
    // `ccd-reg-set-atomic.test.ts`, never here. Do not "fix" the stub to
    // rename — a stub that renamed would still not be the real function.
    expect(h.calls().filter((l) => l === 'stamp supervised').length).toBe(2);
  });

  it('a swap re-stamps while it carries, so the window classifies `restarting`', () => {
    // §4.2: cmd_swap stops the unit, carries the files and starts it again.
    // Between those the row is not alive and, after 120s of a `cp -a`
    // fallback over a 188MB sidecar, would stop looking watched — "the fleet
    // marked a session abandoned while it was being carefully moved". No
    // `.supervised` is planted here, so the only stamps are the swap's own —
    // and there are TWO of them, checked at two DIFFERENT points, so deleting
    // either alone is caught. The first (right after the teardown flush,
    // before the carry) is what covers a carry that itself runs long — the
    // stated reason it exists — so it is read from INSIDE the (stubbed)
    // carry, not only at the restart the second stamp alone would satisfy
    // (review finding, MINOR #6: `start:restarting` alone cannot tell the two
    // stamps apart).
    fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
    h.sh(`_reg_set ${ID} uuid b7001948-0000-4c2f-9a1b-0cfc0dc3d199
      _reg_set ${ID} project demo
      _reg_set ${ID} workdir "$HOME/projects/demo"
      _reg_set ${ID} wrapper claude-d
      _reg_set ${ID} started 1`);
    // A real transcript where the post-D1 locator will find it, so the swap
    // carries rather than refusing (§2.4).
    h.sh(`wd=$(readlink -f "$HOME/projects/demo"); mdir=$(echo "$wd" | tr '/._' '---')
      mkdir -p "$HOME/.claude-d/projects/$mdir"
      printf '{"type":"message"}\\n' > "$HOME/.claude-d/projects/$mdir/b7001948-0000-4c2f-9a1b-0cfc0dc3d199.jsonl"`);
    run(`CCD_SWAP_DETACHED=1
      _alive() { return 1; }; tmux() { :; }; cmd_ensure() { :; }; sleep() { :; };
      _swap_carry_jsonl() { echo "mid-carry:$(_session_state ${ID})" >> "$HOME/ccd-calls"; return 0; };
      systemctl() { [[ "$*" == *"start claude-session@"* ]] \
        && echo "start:$(_session_state ${ID})" >> "$HOME/ccd-calls"; return 0; };
      cmd_swap ${ID} claude-a`);
    expect(h.calls()).toContain('mid-carry:restarting');
    expect(h.calls()).toContain('start:restarting');
  });
});

describe('_session_state drives §4.3\'s table', () => {
  /** Plant exactly the four inputs the table takes, then ask ccd. `_alive` is
   *  stubbed because a tmux pane is the one input a unit test cannot have;
   *  every other input is a real file in a real registry. */
  const askState = (o: {
    alive: boolean;
    supervisedAgo: number | null;   // seconds; null = no heartbeat file at all
    stopped: boolean;
    started: boolean;
  }): string => {
    const reg = REGDIR();
    for (const f of ['supervised', 'stopped', 'started']) {
      fs.rmSync(path.join(reg, `${ID}.${f}`), { force: true });
    }
    fs.writeFileSync(path.join(reg, `${ID}.uuid`), 'u');
    const now = Math.floor(Date.now() / 1000);
    if (o.supervisedAgo !== null) {
      fs.writeFileSync(path.join(reg, `${ID}.supervised`), String(now - o.supervisedAgo));
    }
    if (o.stopped) fs.writeFileSync(path.join(reg, `${ID}.stopped`), `${now - 300} pwa`);
    if (o.started) fs.writeFileSync(path.join(reg, `${ID}.started`), '1');
    return h.sh(`_alive() { return ${o.alive ? 0 : 1}; }; _session_state ${ID}`);
  };

  it('a live pane under a fresh heartbeat is `running`', () => {
    expect(askState({ alive: true, supervisedAgo: 5, stopped: false, started: true })).toBe('running');
  });

  it('a live pane with a stale heartbeat is `unsupervised`', () => {
    // What a pre-fix `ccd start` minted: a pane with no unit — no auto-swap,
    // no auto-compact, no uuid-sync, and nothing to record its death. Kills
    // the mutant that answers `running` for any live pane, which would erase
    // the entire defect this column exists to name.
    expect(askState({ alive: true, supervisedAgo: 600, stopped: false, started: true })).toBe('unsupervised');
  });

  it('a live pane with no heartbeat at all is `unsupervised`, not `running`', () => {
    expect(askState({ alive: true, supervisedAgo: null, stopped: false, started: true })).toBe('unsupervised');
  });

  it('a dead row with a stop stamp is `stopped`, even while the heartbeat is still fresh', () => {
    // §4.3's ordering rule as a test: the stop stamp is checked BEFORE the
    // heartbeat in the not-alive branch, so a stop taken inside the 120s
    // freshness window reads `stopped` immediately instead of `restarting`.
    expect(askState({ alive: false, supervisedAgo: 5, stopped: true, started: true })).toBe('stopped');
    expect(askState({ alive: false, supervisedAgo: null, stopped: true, started: false })).toBe('stopped');
  });

  it('a dead row under a fresh heartbeat and no stop stamp is `restarting`', () => {
    // Between Restart=always cycles, or mid-swap. Not a fault.
    expect(askState({ alive: false, supervisedAgo: 5, stopped: false, started: true })).toBe('restarting');
  });

  it('a dead row with nothing watching and a start on record is `orphan`', () => {
    expect(askState({ alive: false, supervisedAgo: 600, stopped: false, started: true })).toBe('orphan');
    expect(askState({ alive: false, supervisedAgo: null, stopped: false, started: true })).toBe('orphan');
  });

  it('a row that never had a session is `never-started`, never `orphan`', () => {
    // Kills the mutant that drops the `started` test: every fresh registry
    // row would otherwise print `orphan` the moment it is created.
    expect(askState({ alive: false, supervisedAgo: 600, stopped: false, started: false })).toBe('never-started');
    expect(askState({ alive: false, supervisedAgo: null, stopped: false, started: false })).toBe('never-started');
  });

  it('the freshness window is 120 seconds, checked from both sides', () => {
    // 120 -> 10 makes the 60s heartbeat stale (`orphan`); 120 -> 300 makes
    // the 200s one fresh (`restarting`). Both margins are wide enough that
    // the clock ccd reads a beat later cannot flake either assertion.
    expect(askState({ alive: false, supervisedAgo: 60, stopped: false, started: true })).toBe('restarting');
    expect(askState({ alive: false, supervisedAgo: 200, stopped: false, started: true })).toBe('orphan');
  });

  it('a FUTURE-dated heartbeat is stale, not fresh forever', () => {
    // Review finding (MINOR #5): the freshness check was only `now - sup <
    // 120`. A future stamp (clock skew, or a hand-edited registry) makes
    // `now - sup` negative, which satisfies `< 120` unconditionally — the
    // row would read `restarting` for ever instead of ageing out to `orphan`.
    // A negative `supervisedAgo` plants exactly that: `now - (-N)` = a
    // timestamp N seconds in the future.
    expect(askState({ alive: false, supervisedAgo: -99999999999, stopped: false, started: true })).toBe('orphan');
  });

  it('a garbage heartbeat is no heartbeat, not a fresh one', () => {
    // The field is ccd's own, but it is a file on disk: a truncated or
    // hand-edited stamp must degrade to "nobody is watching", never to a
    // silently-fresh `running`.
    fs.writeFileSync(path.join(REGDIR(), `${ID}.uuid`), 'u');
    fs.writeFileSync(path.join(REGDIR(), `${ID}.supervised`), 'not-a-number');
    fs.writeFileSync(path.join(REGDIR(), `${ID}.started`), '1');
    expect(h.sh(`_alive() { return 0; }; _session_state ${ID}`)).toBe('unsupervised');
    expect(h.sh(`_alive() { return 1; }; _session_state ${ID}`)).toBe('orphan');
  });
});

describe('ccd ls', () => {
  it('replaces the ALIVE column with STATE and leaves the gpt trailer verbatim', () => {
    // §4.4: `ALIVE=no` said the same word about a session somebody stopped,
    // one that died unwatched and one that never started. Nothing parses
    // `ccd ls` — no server/agent/pwa caller, no other test — but
    // ccd-limits.test.ts pins _gpt_status's strings verbatim, so the trailer
    // is NOT this task's to touch, and that is asserted here rather than
    // hoped for.
    h.sh(`_reg_set ${ID} uuid u
      _reg_set ${ID} wrapper claude-d
      _reg_set ${ID} workdir /data/projects/demo
      _reg_set ${ID} started 1`);
    const out = run(`_alive() { return 1; }; cmd_ls`).stdout;
    expect(out).toContain('STATE');
    expect(out).not.toContain('ALIVE');
    expect(out).toMatch(new RegExp(`${ID}\\s+claude-d\\s+orphan\\s+/data/projects/demo`));
    expect(out).toContain('gpt overflow lane: not installed  —  0 session(s) currently on it');
  });

  it('prints the same word for a stopped row that _session_state does', () => {
    h.sh(`_reg_set ${ID} uuid u
      _reg_set ${ID} wrapper claude-d
      _reg_set ${ID} workdir /data/projects/demo
      _reg_set ${ID} started 1`);
    h.sh(`systemctl() { :; }; _ws_unsupervise ${ID} pwa`);
    const out = run(`_alive() { return 1; }; cmd_ls`).stdout;
    expect(out).toMatch(new RegExp(`${ID}\\s+claude-d\\s+stopped\\s+`));
  });
});
