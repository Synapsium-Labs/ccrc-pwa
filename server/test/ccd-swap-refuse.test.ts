/**
 * `ccd swap` refuses rather than completing when it cannot carry the
 * conversation (spec §2.4). A swap exists to MOVE a conversation; completing
 * one with nothing found trades a session's entire history for a rate-limit
 * reprieve, which is exactly the trade that made the 2026-08-11 incident.
 *
 * The exit code is the weakest channel and these tests barely lean on it. The
 * common invocation is from inside the session being swapped, where cmd_swap
 * detaches a transient unit and returns 0 to a caller that the swap then kills
 * (ccd:7022-7028) — so the refusal is asserted where it actually survives:
 * the `swapblocked` registry field, the notify.sh banner, and swap.log.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-swap-refuse-'); });
afterEach(() => { h.cleanup(); });

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

/** Everything cmd_swap reaches that must not leave the fixture: systemd, tmux,
 *  the flush sleep, and the ensure fallback. Each one LOGS, because half of
 *  these tests are assertions about which of them ran and which did not. */
const SWAP_STUBS = `
  systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; return 0; };
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 0; };
  sleep() { :; };
  cmd_ensure() { echo "cmd_ensure $*" >> "$HOME/ccd-calls"; return 0; };
`;

/** SWAP_STUBS with the REAL `cmd_ensure`, because stubbing it is what hid the
 *  critical defect below: the damage a refusal's restart used to do lived
 *  entirely INSIDE that function. `_spawn` is stubbed in its place — it is the
 *  real `cmd_ensure`'s own last resort when the unit will not come up, so its
 *  appearance in the call log is proof the whole real path ran. */
const REAL_ENSURE_STUBS = `
  systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; return 0; };
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; case "\${1:-}" in has-session) return 1;; esac; return 0; };
  sleep() { :; };
  _spawn() { echo "_spawn $*" >> "$HOME/ccd-calls"; return 0; };
  _spawn_start() { echo "_spawn_start $*" >> "$HOME/ccd-calls"; SPAWN_FROMSWAP=0; };
  _spawn_settle() { echo "_spawn_settle $1" >> "$HOME/ccd-calls"; return 0; };
`;

/** Everything past `_auto_swap_check`'s cooldown gate, so a test is about the
 *  gate alone: a hard-blocked pane (matched by the REAL `_pane_hard_blocked`),
 *  a target, headroom, and a dispatch that LOGS instead of running systemd-run. */
const AUTO_TICK_STUBS = `
  tmux() { case "\${1:-}" in capture-pane) echo "API Error: 429 Too Many Requests";; esac; return 0; };
  _swap_target() { echo claude2; }; _avail() { return 0; };
  _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };
`;

/** The tmux a refusal fixture needs: the pane is DEAD — `cmd_swap` killed it
 *  before the carry — and a `kill-session` rotates the registry uuid exactly as
 *  `_sync_uuid` does after a /clear, which is what makes the post-flush look
 *  find nothing. */
const deadRotate = (id: string): string =>
  `tmux() { echo "tmux $*" >> "$HOME/ccd-calls"
     case "\${1:-}" in
       kill-session) _reg_set ${id} uuid ${UUID_B} ;;
       has-session)  return 1 ;;
       capture-pane) echo "API Error: 429 Too Many Requests" ;;
     esac; return 0; };`;

const shFail = (snippet: string): { code: number; stderr: string; stdout: string } => {
  try { return { code: 0, stderr: '', stdout: h.sh(snippet) }; }
  catch (e) {
    const err = e as { status?: number; stderr?: Buffer; stdout?: Buffer };
    return { code: err.status ?? 1, stderr: String(err.stderr ?? ''), stdout: String(err.stdout ?? '') };
  }
};

/** A live-looking wrapper session on `claude`, written with `_reg_set` — the
 *  same writer ccd uses — rather than `cmd_start`, which would want tmux. */
const seed = (uuid = UUID_A, id = 'claude-demo'): string => {
  fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
  h.sh(`_reg_set ${id} uuid ${uuid}
    _reg_set ${id} project demo
    _reg_set ${id} workdir "$HOME/projects/demo"
    _reg_set ${id} wrapper claude
    _reg_set ${id} started 1`);
  return id;
};

/** A transcript in a project dir that is deliberately NOT the munge of the
 *  registry workdir — the uuid locator is what finds it, which is the whole
 *  point of D1. */
const plantTranscript = (account: string, munge: string, uuid: string): string => {
  const dir = path.join(h.home, account, 'projects', munge);
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${uuid}.jsonl`);
  fs.writeFileSync(f, '{"type":"message"}\n');
  return f;
};

const plantNotify = (): void => {
  fs.writeFileSync(path.join(h.home, '.cc-sessions', 'notify.sh'),
    '#!/bin/sh\nprintf \'%s\\n\' "$1" >> "$HOME/notify-log"\n', { mode: 0o755 });
};
const notices = (): string =>
  fs.existsSync(path.join(h.home, 'notify-log'))
    ? fs.readFileSync(path.join(h.home, 'notify-log'), 'utf8') : '';
const swapLog = (): string =>
  fs.existsSync(path.join(h.home, '.cc-sessions', 'swap.log'))
    ? fs.readFileSync(path.join(h.home, '.cc-sessions', 'swap.log'), 'utf8') : '';

describe('a swap that cannot carry the conversation', () => {
  it('refuses BEFORE anything is torn down, and the session stays where it is', () => {
    // Kills the pre-fix order (stop -> kill -> sleep -> look, ccd:7034-7037),
    // which turned a miss into a session that was dead AND historyless. The
    // glob is a read, so it costs nothing above the teardown.
    const id = seed();
    plantNotify();
    const r = shFail(`${SWAP_STUBS} cmd_swap ${id} claude2`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(`refusing to swap ${id}`);
    expect(h.calls().join('\n')).not.toContain(`stop claude-session@${id}`);
    expect(h.calls().join('\n')).not.toContain('kill-session');
    expect(h.reg(id, 'wrapper'), 'a refusal must not flip the account').toBe('claude');
  });

  it('leaves a durable field, a banner and a log line — the channels a detached swap needs', () => {
    // Mutant killed: "the stderr line is enough". It is not — the detached
    // self-swap path has already returned 0 to a caller it then kills.
    const id = seed();
    plantNotify();
    shFail(`${SWAP_STUBS} cmd_swap ${id} claude2`);
    expect(h.reg(id, 'swapblocked'))
      .toMatch(new RegExp(`^\\d{10} no transcript found for ${UUID_A} under claude$`));
    expect(notices()).toContain(`cc swap BLOCKED: ${id} stays on claude`);
    expect(swapLog()).toContain(`swap-refused ${id}: claude -> claude2`);
  });

  it('does NOT write lastswap — a refusal must not read as a swap landing', () => {
    // _spawn (ccd:6905-6910) treats a spawn within 300s of `lastswap` as the
    // swap ARRIVING, and answers the big-transcript resume gate with "resume
    // from summary", which auto-compacts — a refusal that stamped lastswap
    // would compact the very history it refused in order to protect.
    const id = seed();
    shFail(`${SWAP_STUBS} cmd_swap ${id} claude2`);
    expect(h.reg(id, 'lastswap')).toBeNull();
  });

  it('CLEARS a lastswap the AUTO-swap caller already stamped — a refusal is not a landing', () => {
    // The gap the manual-path test above does not cover: _auto_swap_check stamps
    // `lastswap` itself, BEFORE `_dispatch_swap` ever runs (both the hard-blocked
    // rescue arm and the return-home arm), so by the time this detached `cmd_swap`
    // decides to refuse, `lastswap` is already fresh — "never write it" is not
    // enough on THIS path, unlike the manual one. Replays _spawn's own fromswap
    // computation (ccd:6915-6917) verbatim: with a stale/absent lastswap, a resume
    // must not read as a swap landing and auto-compact.
    const id = seed();
    h.sh(`_reg_set ${id} lastswap "$(date +%s)"`);   // what _auto_swap_check already did
    shFail(`${SWAP_STUBS} cmd_swap ${id} claude2`);
    expect(h.reg(id, 'lastswap')).toBeNull();
    const fromswap = h.sh(`
      fromswap=0
      lastswap=$(_reg_get ${id} lastswap)
      [[ -n "$lastswap" && $(( $(date +%s) - lastswap )) -lt 300 ]] && fromswap=1
      echo "$fromswap"
    `);
    expect(fromswap).toBe('0');
  });

  it('re-reads the uuid after the flush and decides on THAT one — a /clear rotates it', () => {
    // The pre-flight is ADVISORY. Here uuid-A has a transcript and passes it;
    // the teardown rotates the registry to uuid-B (what _sync_uuid does after
    // a /clear), and uuid-B has nothing. Carrying A would hand the resumed
    // session a file it will never ask for. Kills both the mutant that globs
    // once and the mutant that keeps the pre-flight's uuid.
    const id = seed(UUID_A);
    plantTranscript('.claude', '-x-projects-demo', UUID_A);
    plantNotify();
    const rotate = `tmux() { [[ "\${1:-}" == kill-session ]] && _reg_set ${id} uuid ${UUID_B};
      echo "tmux $*" >> "$HOME/ccd-calls"; return 0; };`;
    const r = shFail(`${SWAP_STUBS} ${rotate} cmd_swap ${id} claude2`);
    expect(r.code).not.toBe(0);
    expect(h.reg(id, 'swapblocked'))
      .toContain(`no transcript found for ${UUID_B} under claude after flush`);
    expect(h.reg(id, 'wrapper')).toBe('claude');
    expect(h.reg(id, 'lastswap')).toBeNull();
    // Registry `wrapper` was never touched, so the unit puts it back exactly
    // where it was — on the account that still holds its history.
    expect(h.calls().join('\n')).toContain(`--user start claude-session@${id}`);
  });

  it('falls back to the REAL cmd_ensure when the unit will not start, and the marker survives it', () => {
    // FINAL REVIEW, CRITICAL — and the test that should have caught it was part
    // of the defect. Its predecessor stubbed `cmd_ensure` in SWAP_STUBS and
    // asserted only that the call happened, so the damage was stubbed away:
    // the real `cmd_ensure` finds the pane DEAD (cmd_swap killed it two lines
    // earlier), sails past its `_alive` early return, and `rm -f`s the
    // `swapblocked` field `_swap_refuse` had just written — the field its own
    // comment calls "the DURABLE one… Survives nobody watching". With both of
    // `_auto_swap_check`'s gates then open (`lastswap` deliberately cleared,
    // `swapblocked` erased) the next 5s supervise tick re-dispatched the swap;
    // the storm that follows is the test below this one.
    //
    // So: `cmd_ensure` is NOT stubbed here. `_spawn` is instead, which is the
    // real function's own last resort when the unit will not come up — its
    // appearance in the call log is the proof that the whole real path ran.
    const id = seed(UUID_A);
    plantTranscript('.claude', '-x-projects-demo', UUID_A);
    const noUnit = `systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; return 1; };`;
    shFail(`${REAL_ENSURE_STUBS} ${noUnit} ${deadRotate(id)} cmd_swap ${id} claude2`);
    expect(h.calls().join('\n'), 'the real cmd_ensure did not run — this test is stubbed hollow')
      .toContain(`_spawn ${id}`);
    expect(h.reg(id, 'swapblocked'),
      'the refusal erased the durable record it had just written')
      .toContain(`no transcript found for ${UUID_B} under claude after flush`);
  });

  it('clears a FAILED unit before restarting it — the state this build made reachable', () => {
    // Two realistic reasons that `systemctl start` fails here, and the second is
    // this build's own doing: (a) no unit installed, which the `|| cmd_ensure`
    // fallback above is for; (b) the unit is `failed` and rate-limited by §3.3's
    // StartLimitIntervalSec=120/StartLimitBurst=5. `_supervised_start` was given
    // a `reset-failed` for exactly (b); this arm had none, so a refusal on a
    // crash-looped row left the session down.
    const id = seed(UUID_A);
    plantTranscript('.claude', '-x-projects-demo', UUID_A);
    shFail(`${SWAP_STUBS} ${deadRotate(id)} cmd_swap ${id} claude2`);
    const sys = h.calls().filter((c) => c.startsWith('systemctl '));
    expect(sys).toEqual([
      `systemctl --user stop claude-session@${id}`,
      `systemctl --user reset-failed claude-session@${id}`,
      `systemctl --user start claude-session@${id}`,
    ]);
  });

  it('survives the SUPERVISOR that the restart brings back — a different process, seconds later', () => {
    // The half the `|| cmd_ensure` fallback does not cover and which bites on
    // every box that HAS a unit: `systemctl start` succeeds, the unit runs
    // `cmd_supervise`, and that calls `cmd_ensure` with the pane still dead —
    // erasing the marker from a process no `local` can reach. The discriminator
    // is CCD_IN_UNIT: a supervisor re-entering its own unit is not the
    // "deliberate revival" §2.4 says supersedes a refusal.
    const id = seed(UUID_A);
    plantTranscript('.claude', '-x-projects-demo', UUID_A);
    shFail(`${SWAP_STUBS} ${deadRotate(id)} cmd_swap ${id} claude2`);
    const blocked = h.reg(id, 'swapblocked');
    expect(blocked).toContain('no transcript found');
    // What the unit does next, in its own process.
    shFail(`${REAL_ENSURE_STUBS} ${deadRotate(id)} CCD_IN_UNIT=1; cmd_ensure ${id}`);
    expect(h.reg(id, 'swapblocked'), 'the supervisor erased the refusal it was sent to honour')
      .toBe(blocked);
  });

  it('and a HUMAN revive still supersedes it — the clear did not simply move away', () => {
    // The mutant this pair must both kill: "guard the clear everywhere". §2.4's
    // sentence is about an operator act, and `POST /api/sessions/:id/ensure` —
    // outside any unit, no CCD_KEEP_SWAPBLOCK — is exactly that act.
    const id = seed(UUID_A);
    h.sh(`_reg_set ${id} swapblocked "1754000000 stale refusal"`);
    shFail(`${REAL_ENSURE_STUBS} cmd_ensure ${id}`);
    expect(h.reg(id, 'swapblocked')).toBeNull();
  });

  it('does not re-dispatch on the next supervise tick, ten ticks running', () => {
    // The whole point of keeping the marker, and the storm it prevents.
    // Measured before the fix on this exact fixture: the marker was gone, both
    // gates were open, and the tick dispatched again.
    //
    // THE REAL `cmd_ensure` AND A UNIT THAT WILL NOT START, deliberately: with
    // `cmd_ensure` stubbed the marker survives even the unfixed ccd, so a
    // fixture that stubbed it would pass against the very defect it is named
    // for. `_dispatch_swap` LOGS rather than running, so the count is of
    // decisions, not side effects, and `lastswap` is cleared before each tick
    // so the ONLY thing that can gate them is the field the refusal wrote.
    const id = seed(UUID_A);
    plantTranscript('.claude', '-x-projects-demo', UUID_A);
    const noUnit = `systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; return 1; };`;
    shFail(`${REAL_ENSURE_STUBS} ${noUnit} ${deadRotate(id)} cmd_swap ${id} claude2`);
    expect(h.reg(id, 'swapblocked')).toContain('no transcript found');
    h.sh(`${AUTO_TICK_STUBS} for i in 1 2 3 4 5 6 7 8 9 10; do
      rm -f "$HOME/.cc-sessions/${id}.lastswap"; _auto_swap_check ${id}; done`);
    expect(h.calls().filter((c) => c.startsWith('dispatch '))).toEqual([]);
  });

  it('a completed swap clears a standing refusal', () => {
    // A control that revives a row and leaves its refusal banner standing
    // teaches the operator to ignore banners (spec §2.4).
    const id = seed(UUID_A);
    plantTranscript('.claude', '-x-projects-demo', UUID_A);
    fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.swapblocked`), '1754000000 stale');
    h.sh(`${SWAP_STUBS} cmd_swap ${id} claude2`);
    expect(h.reg(id, 'swapblocked')).toBeNull();
    expect(h.reg(id, 'wrapper')).toBe('claude2');
  });

  it('refuses a PARTIAL carry that missed mdir, and says which slot failed', () => {
    // FINAL REVIEW. The refusal machinery covered "every copy failed"; it did
    // not cover "the copy that mattered failed". Measured: copies landed
    // elsewhere, `carried` was 1, rc 0, and the swap completed — flipping
    // `wrapper` onto an account whose mdir slot is empty, which is D1's symptom
    // with a success line over it. The reason names mdir because an operator
    // reading a banner at 2am must not be sent looking for a full disk.
    const id = seed(UUID_A);
    // A second match somewhere else, so at least one copy DOES land: without it
    // this is the pre-existing "every copy failed" case and proves nothing new.
    plantTranscript('.claude', '-x-projects-demo', UUID_A);
    plantTranscript('.claude', '-y-projects-demo', UUID_A);
    const mdir = fs.realpathSync(path.join(h.home, 'projects', 'demo')).replace(/[/._]/g, '-');
    const locked = path.join(h.home, '.claude-personal', 'projects', mdir);
    fs.mkdirSync(locked, { recursive: true });
    fs.chmodSync(locked, 0o500);
    try {
      plantNotify();
      const r = shFail(`${SWAP_STUBS} cmd_swap ${id} claude2`);
      expect(r.code).not.toBe(0);
      expect(r.stdout, 'a partial carry printed a success line').not.toContain('swapped');
      expect(h.reg(id, 'wrapper')).toBe('claude');
      expect(h.reg(id, 'swapblocked')).toContain(`but the copy to ${mdir} failed`);
      expect(notices()).toContain(`cc swap BLOCKED: ${id} stays on claude`);
      // The arithmetic that exposes it was already being logged and simply
      // never branched on — it stays logged, in front of the refusal.
      expect(swapLog()).toMatch(/carry .*: 2 match\(es\), 2 copy\/copies, 3 destination\(s\)/);
      expect(swapLog()).toContain(`swap-refused ${id}`);
    } finally {
      fs.chmodSync(locked, 0o700);
    }
  });

  it('distinguishes "nothing found" from "found but the copy failed" in the reason', () => {
    // _swap_carry_jsonl's rc 1 covers two different causes (its own docstring: "nothing
    // found" OR "matches existed and every copy failed") without telling the caller
    // which. An operator diagnosing a full disk or an EACCES must not be pointed at "no
    // transcript found" — the wrong cause, and the wrong fix.
    const id = seed(UUID_A);
    plantTranscript('.claude', '-x-projects-demo', UUID_A);
    const copyFails = `cp() { return 1; };`;
    shFail(`${SWAP_STUBS} ${copyFails} cmd_swap ${id} claude2`);
    expect(h.reg(id, 'swapblocked'))
      .toContain(`transcript found for ${UUID_A} under claude but every copy failed`);
  });
});

describe('ccd swap --force', () => {
  it('restores the old behavior: nothing to carry, swap completes anyway', () => {
    // The operator has looked and decided there is genuinely nothing to carry.
    const id = seed();
    plantNotify();
    const out = h.sh(`${SWAP_STUBS} cmd_swap --force ${id} claude2`);
    expect(out).toContain(`swapped ${id}: claude -> claude2`);
    expect(h.reg(id, 'wrapper')).toBe('claude2');
    expect(h.reg(id, 'lastswap')).toMatch(/^\d{10}$/);
    expect(h.reg(id, 'swapblocked'), 'a forced swap is not a blocked one').toBeNull();
  });

  it('takes the flag on either side of the positionals, and never as a target', () => {
    // Flags are stripped BEFORE the positional parse. Without that,
    // `ccd swap --force <id> <target>` reads as a swap of a session named
    // "--force". Second lock: _is_valid_wrapper rejects the literal, so even
    // past the stripper (`--`) it cannot land in the target slot.
    const a = seed(UUID_A, 'claude-demo');
    h.sh(`${SWAP_STUBS} cmd_swap --force ${a} claude2`);
    expect(h.reg(a, 'wrapper')).toBe('claude2');

    const b = seed(UUID_A, 'claude-demo2');
    h.sh(`${SWAP_STUBS} cmd_swap ${b} claude2 --force`);
    expect(h.reg(b, 'wrapper')).toBe('claude2');

    const c = seed(UUID_A, 'claude-demo3');
    expect(shFail(`${SWAP_STUBS} cmd_swap ${c} --force`).code).not.toBe(0);
    expect(h.reg(c, 'wrapper'), 'a bare flag is a usage error, not a swap').toBe('claude');
    expect(shFail(`${SWAP_STUBS} cmd_swap ${c} -- --force`).stderr)
      .toContain("unknown wrapper '--force'");
  });
});

describe('_auto_swap_check and a refused session', () => {
  const AUTO_STUBS = AUTO_TICK_STUBS;

  it('skips a refusal younger than 1800s and stops skipping at the boundary', () => {
    // The supervise loop ticks every 5 seconds. Without this gate one refusal
    // becomes 720 banners and 720 swap.log lines an hour. Both sides of the
    // boundary are asserted so 1800 cannot drift to 900 (the swap cooldown it
    // sits beside) and `-lt` cannot become `-le` unnoticed.
    //
    // `date +%s` is PINNED, not merely raced against: the stamp and the check are two
    // separate `h.sh` calls, each sourcing a ~7,600-line script, and a cold run without
    // this pin measured that gap crossing a real wall-clock second often enough to flip
    // the assertion — `date +%s` truncates, so "stamped 1799s old" could read as 1800s
    // old by the time `_auto_swap_check`'s own `now=$(date +%s)` ran. Pinning both calls
    // to the SAME fixed epoch makes the elapsed time an exact integer (`NOW - (NOW -
    // age)` == `age`) independent of how long either process actually takes to start.
    const id = seed();
    const NOW = 1_700_000_000;
    const DATE_STUB = `date() { [[ "\${1:-}" == +%s ]] && echo ${NOW} || command date "$@"; };`;
    const stamp = (age: number): void => {
      h.sh(`${DATE_STUB} _reg_set ${id} swapblocked "$((${NOW} - ${age})) no transcript found"`);
    };

    stamp(1799);
    h.sh(`${DATE_STUB} ${AUTO_STUBS} _auto_swap_check ${id}`);
    expect(h.calls().join('\n')).not.toContain('dispatch');

    stamp(1801);
    h.sh(`${DATE_STUB} ${AUTO_STUBS} _auto_swap_check ${id}`);
    expect(h.calls().join('\n')).toContain(`dispatch ${id} -> claude2`);
  });

  it('a garbage stamp does not gate and does not emit an unbound-variable line', () => {
    // ccd runs under `set -u`: `$(( now - garbage ))` on a hand-edited or
    // half-written field errors on EVERY tick. The timestamp is validated as
    // digits rather than trusted.
    const id = seed();
    h.sh(`_reg_set ${id} swapblocked "not-an-epoch whatever"`);
    const r = shFail(`${AUTO_STUBS} _auto_swap_check ${id}`);
    expect(r.code).toBe(0);
    expect(r.stderr).not.toContain('unbound variable');
    expect(h.calls().join('\n')).toContain(`dispatch ${id} -> claude2`);
  });
});

describe('the refusal vocabulary', () => {
  it("stays out of the reap protocol's harvested token shapes", () => {
    // server/test/wsaudit.test.ts greps THIS FILE for four literal emission
    // shapes (its header lists them) and requires every token it harvests to
    // have a sentence in wsaudit.ts's SENTENCES map, in BOTH directions. That
    // vocabulary answers a machine; a swap refusal answers a human on stderr
    // and a row in the registry. The tempting way to spell "refused" in this
    // codebase is one of those four shapes, and reaching for it here would
    // fail wsaudit.test.ts for a reason its author would not expect — so the
    // choice is PINNED here rather than remembered.
    const src = fs.readFileSync(CCD, 'utf8');
    const from = src.indexOf('_swap_refuse() {');
    const to = src.indexOf('cmd_swap_self() {');
    expect(from, '_swap_refuse was not found in ccd').toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const slice = src.slice(from, to);
    expect(slice.length, 'the refusal slice collapsed — this test would pass vacuously')
      .toBeGreaterThan(500);
    for (const shape of [/_reap_refuse\s/, /"refused":"/, /"verdict":"/, /'!/]) {
      expect(slice, `the swap refusal is written in a harvested shape: ${shape}`)
        .not.toMatch(shape);
    }

    // And nothing anywhere in ccd emits a swap-flavoured token into that map.
    const tokens = new Set<string>();
    for (const m of src.matchAll(/_reap_refuse\s+([a-zA-Z][a-zA-Z0-9_-]*)\b/g)) tokens.add(m[1]!);
    for (const m of src.matchAll(/"refused":"([a-zA-Z0-9-]+)"/g)) tokens.add(m[1]!);
    for (const m of src.matchAll(/'!([a-zA-Z0-9-]+)/g)) tokens.add(m[1]!);
    for (const m of src.matchAll(/"verdict":"([a-zA-Z0-9-]+)"/g)) tokens.add(m[1]!);
    expect([...tokens].filter((t) => /swap|carry|transcript|blocked/i.test(t))).toEqual([]);
  });
});
