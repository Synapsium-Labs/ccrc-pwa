/**
 * `--cross-pool` — the deliberate crossing, and the marker that makes it stick
 * (spec §5.7, ruling 8).
 *
 * Without the marker the design undoes every crossing within one 5-second
 * tick: the re-seed rewrites `.home`, `_swap_target`'s `force=pool` treats the
 * crossed account as a must-leave, and the affinity arm moves the session back
 * at the next idle boundary. `prefer --cross-pool` would be a no-op.
 *
 * FIXTURE HOME ONLY (`makeCcdHarness`). Task 4's own cases below drove only
 * `_auto_swap_check` (the tick) — none of them calls a manual verb, so none
 * touched `cmd_swap`, `systemctl`/`launchctl`/`tmux`, or `TMUX` on its own.
 * Task 5 is what exercises `cmd_swap`, `--cross-pool`'s flag loop, the
 * detached self-swap retry and the deploy-window strand below. Task 6 is
 * what exercises `cmd_start`, `cmd_enable`, `cmd_prefer` and `cmd_ensure`'s
 * strand clear, and consumes every helper this file imports — `WS_ADD`
 * included, as `START_STUBS` below.
 *
 * WHAT TASK 5 DELIVERED, for the manual-verb cases below: systemd and tmux
 * logging instead of acting (`SWAP_STUBS`, `SELF`); `sleep` stubbed because
 * `cmd_swap`'s flush wait is a second of real time per case; `TMUX` emptied
 * at the call site so the detached self-swap branch is never taken from a
 * suite that may itself be running inside tmux, except in the two cases that
 * are ABOUT that branch.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { CCD, ghContainedEnv, makeCcdHarness, seedAccountsSh, WS_ADD, type CcdHarness }
  from './ccdWsHelpers.js';
import { POOLED_TEST_ROSTER } from './fixtures/poolRule.js';
import { eventsOf, measOf, decOf } from './lifecycleHelpers.js';

let h: CcdHarness;
beforeEach(() => {
  h = makeCcdHarness('ccrc-ccd-crosspool-');
  seedAccountsSh(h.home, POOLED_TEST_ROSTER);
});
afterEach(() => { h.cleanup(); });

const UUID = 'b7001948-2222-4bcc-b60b-0cfc0dc3d199';
const ID = 'claude-demo';
const PANE_PID = '4242';

const reg = (f: string): string => path.join(h.home, '.cc-sessions', f);
const swapLog = (): string =>
  fs.existsSync(reg('swap.log')) ? fs.readFileSync(reg('swap.log'), 'utf8') : '';
const logLines = (verb: string): string[] =>
  swapLog().split('\n').filter((l) => l.includes(` ${verb} `));
const notices = (): string =>
  fs.existsSync(path.join(h.home, 'notify-log'))
    ? fs.readFileSync(path.join(h.home, 'notify-log'), 'utf8') : '';
const noticeLines = (): string[] => notices().split('\n').filter(Boolean);

const plantNotify = (): void => {
  fs.writeFileSync(reg('notify.sh'),
    '#!/bin/sh\nprintf \'%s\\n\' "$1" >> "$HOME/notify-log"\n', { mode: 0o755 });
};
const tagPool = (project: string, pool: string): void => {
  fs.mkdirSync(reg('pools'), { recursive: true });
  fs.writeFileSync(path.join(reg('pools'), project), pool);
};
const writeLimits = (w: string, five: number, seven: number): void => {
  fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`),
    JSON.stringify({ five, seven, ts: Math.floor(Date.now() / 1000) }));
};

const SWAP_STUBS = 'systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; return 0; };'
  + ' launchctl() { echo "launchctl $*" >> "$HOME/ccd-calls"; return 0; };'
  + ' tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 0; }; sleep() { :; };';

/** The registry row cmd_swap reads. Returns `mdir` — the munge of the resolved
 *  workdir, computed here exactly as ccd's `tr '/._' '---'` computes it. */
const seedRow = (wrapper = 'claude'): string => {
  const wd = path.join(h.home, 'projects', 'demo');
  fs.mkdirSync(wd, { recursive: true });
  h.sh(`_reg_set ${ID} uuid ${UUID}
    _reg_set ${ID} wrapper ${wrapper}
    _reg_set ${ID} home ${wrapper}
    _reg_set ${ID} project demo
    _reg_set ${ID} workdir ${wd}
    _reg_set ${ID} started 1`);
  return fs.realpathSync(wd).replace(/[/._]/g, '-');
};

const plant = (cfg: string, pdir: string, body: string): void => {
  const dir = path.join(h.home, cfg, 'projects', pdir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${UUID}.jsonl`), body);
};

const shFail = (snippet: string, env: NodeJS.ProcessEnv = {}):
{ code: number; stdout: string; stderr: string } => {
  try { return { code: 0, stdout: h.sh(snippet, env), stderr: '' }; }
  catch (e) {
    const err = e as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
  }
};

/** The tick, with `_swap_target` and `_auto_swap_check` REAL. */
const BLOCKED = `
  tmux() { case "\${1:-}" in
             capture-pane) echo "API Error: 429 Too Many Requests" ;;
             list-panes)   echo ${PANE_PID} ;;
           esac; return 0; };
  _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };
`;
const QUIET = `
  tmux() { case "\${1:-}" in
             capture-pane) printf '%s\\n' "❯ " ;;
             list-panes)   echo ${PANE_PID} ;;
           esac; return 0; };
  _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };
`;
const tick = (stubs: string, n = 1): string =>
  h.sh(`${stubs} for ((i=0;i<${n};i++)); do _auto_swap_check ${ID}; done`);

/** A landed crossing, written the way `cmd_swap --cross-pool` writes it, so
 *  the marker cases do not depend on Task 5's verb changes. `lastswap` is
 *  removed because a real crossing stamps it and every gate below would then
 *  close before the tick reached anything worth measuring. */
const crossed = (pool: string, acct: string): void => {
  h.sh(`_reg_set ${ID} crosspool "$(date +%s) ${pool} ${acct}"; rm -f "$HOME/.cc-sessions/${ID}.lastswap"`);
};

describe('the crossing marker expires', () => {
  it('survives ten ticks while the project pool and the account both hold', () => {
    seedRow(); tagPool('demo', 'pool-a');
    h.sh(`_reg_set ${ID} wrapper claude-b`);       // crossed onto pool-b
    crossed('pool-a', 'claude-b');
    writeLimits('claude', 99, 99);                 // home is at the ceiling: no return-home
    writeLimits('claude-b', 5, 5);
    tick(QUIET, 10);
    expect(h.reg(ID, 'wrapper')).toBe('claude-b');
    expect(h.reg(ID, 'home')).toBe('claude');
    expect(h.reg(ID, 'crosspool')).toMatch(/^\d{10} pool-a claude-b$/);
    expect(h.calls().join('\n'), 'the pool machinery left the row alone').not.toContain('dispatch');
  });

  it('a RETAG ends it, and swap.log says why', () => {
    seedRow(); tagPool('demo', 'pool-a');
    h.sh(`_reg_set ${ID} wrapper claude-b`);
    crossed('pool-a', 'claude-b');
    writeLimits('claude-b', 5, 5);
    tagPool('demo', 'pool-b');                     // the operator changed their mind
    tick(QUIET);
    expect(h.reg(ID, 'crosspool')).toBeNull();
    expect(swapLog()).toContain(`crosspool-ended ${ID}: project pool is now named pool-b`);
  });

  it('an UNTAG ends it too', () => {
    seedRow(); tagPool('demo', 'pool-a');
    h.sh(`_reg_set ${ID} wrapper claude-b`);
    crossed('pool-a', 'claude-b');
    fs.rmSync(path.join(reg('pools'), 'demo'));
    tick(QUIET);
    expect(h.reg(ID, 'crosspool')).toBeNull();
    expect(swapLog()).toContain(`crosspool-ended ${ID}: project pool is now untagged`);
  });

  it('an automatic RESCUE lands IN POOL, and the move itself ends the crossing', () => {
    seedRow(); tagPool('demo', 'pool-a');
    h.sh(`_reg_set ${ID} wrapper claude-b`);
    crossed('pool-a', 'claude-b');
    writeLimits('claude', 99, 99);                 // home at the ceiling, so no return-home
    writeLimits('claude-a', 5, 5);
    tick(BLOCKED);
    expect(h.calls().join('\n'), 'automatic moves never cross').toContain(`dispatch ${ID} -> claude-a`);
    // The landing is what ends it. `_dispatch_swap` is a stub here, so do what
    // the dispatched `cmd_swap` would have done to the row.
    h.sh(`_reg_set ${ID} wrapper claude-a; rm -f "$HOME/.cc-sessions/${ID}.lastswap"`);
    tick(BLOCKED);
    expect(h.reg(ID, 'crosspool')).toBeNull();
    expect(swapLog()).toContain(`crosspool-ended ${ID}: moved off claude-b`);
  });
});

describe('an undecidable or unreadable record decides nothing, or lies', () => {
  // Review round 1, Important 1. UNDECIDABLE IS NOT A DECISION: an unreadable
  // or malformed PROJECT tag is neither a retag, an untag, nor a move — it is
  // "nobody can say", and folding it into either arm would invent a fourth,
  // destructive way for a deliberate crossing to end. A transient permission
  // hiccup on `$POOLS_DIR` must never be able to end every live crossing on
  // the fleet box inside one tick, irreversibly. `cmd_swap --cross-pool`
  // (Task 5) is now a writer that COULD re-establish a wrongly-cleared
  // crossing, but only once an operator notices and re-issues it by hand —
  // there is still no automatic recovery, which is what this test guards.
  // Task 6 adds `start`/`prefer`'s writers.
  it.skipIf(process.getuid?.() === 0)(
    'an UNDECIDABLE project tag leaves a VALID marker untouched', () => {
      seedRow(); tagPool('demo', 'pool-a');
      h.sh(`_reg_set ${ID} wrapper claude-b`);
      crossed('pool-a', 'claude-b');
      writeLimits('claude-b', 5, 5);
      const tag = path.join(reg('pools'), 'demo');
      fs.chmodSync(tag, 0o000);              // unreadable: nobody decides
      try {
        tick(QUIET);
      } finally {
        fs.chmodSync(tag, 0o644);
      }
      expect(h.reg(ID, 'crosspool')).toMatch(/^\d{10} pool-a claude-b$/);
      expect(swapLog()).not.toContain('crosspool-ended');
    });

  // The SECOND, separate half: the MARKER's own record — not the project
  // tag — is what is broken. `pool` reads empty, so the naive reason
  // ("project pool is now $pps") would say "project pool is now named
  // pool-a" while the project pool IS, literally, still pool-a — a
  // self-contradicting line that sends the operator hunting for a retag
  // nobody performed. This must get its own third reason instead.
  //
  // RENAMED (merge review, M9). This case was called "…OWN record is
  // unreadable…", and its fixture writes `_reg_set <id> crosspool ""` — a
  // zero-byte READABLE file. So it never built unreadability at all, while
  // the sibling case one describe up builds real unreadability with
  // `chmod 000`: the technique was in hand and went to the project tag, not
  // to the marker. Naming it "unreadable" is why the gap M8 records in
  // `_crosspool_tick`'s header shipped LOOKING covered — a green case whose
  // title claimed a condition its fixture could not produce.
  //
  // C1 HAS LANDED, and this case is where it shows first. The shipped log line
  // used to read `marker record is unreadable` for BOTH conditions, and that
  // was not a naming slip: `_reg_get` is `cat … 2>/dev/null`, so at that seam
  // empty and unreadable WERE the same value and no reason string could tell
  // them apart. `_reg_read` (C1) tells them apart, so the reason is now the
  // condition that actually held — and the two have OPPOSITE outcomes: an
  // EMPTY record is permanently unusable and ends the crossing, an UNREADABLE
  // one may be readable again next tick and must not.
  it("a marker whose OWN record is EMPTY ends with an honest reason, never a fabricated retag", () => {
    seedRow(); tagPool('demo', 'pool-a');
    h.sh(`_reg_set ${ID} crosspool ""; rm -f "$HOME/.cc-sessions/${ID}.lastswap"`);
    tick(QUIET);
    expect(h.reg(ID, 'crosspool')).toBeNull();
    expect(swapLog()).toContain(`crosspool-ended ${ID}: marker record is empty`);
    expect(swapLog(), 'must not fabricate a retag the project pool never had')
      .not.toContain('project pool is now named pool-a');
  });

  // The THIRD broken-record condition, which the fold could not name either: a
  // record whose bytes were read whole and simply do not carry a pool token.
  // `read -r ts pool acct <<<"1788888888"` leaves `pool` empty exactly as an
  // empty record does, so before C1 this logged `unreadable` too — a third
  // condition wearing the first one's name.
  it('a MALFORMED marker record says so — the bytes were read and they name no pool', () => {
    seedRow(); tagPool('demo', 'pool-a');
    h.sh(`_reg_set ${ID} crosspool "1788888888"; rm -f "$HOME/.cc-sessions/${ID}.lastswap"`);
    tick(QUIET);
    expect(h.reg(ID, 'crosspool')).toBeNull();
    expect(swapLog()).toContain(`crosspool-ended ${ID}: marker record is malformed`);
    expect(swapLog(), 'must not fabricate a retag the project pool never had')
      .not.toContain('project pool is now named pool-a');
  });
});

describe('`_reg_read` — the distinguishing read C1 is built on', () => {
  // Every arm of this helper gets a case of its own, INCLUDING the two that
  // `_crosspool_tick` cannot reach through its own `-e` pre-gate. A guard no
  // case can red is an unpinned guard, and this helper is the thing later
  // callers will trust: its contract is pinned here, at the helper, not
  // inferred from the one function that consumes it today.
  const rc = (snippet: string): string => h.sh(`${snippet} >/dev/null; echo $?`);

  it('a READABLE field answers the value, rc 0', () => {
    seedRow();
    expect(h.sh(`_reg_read ${ID} wrapper`)).toBe('claude');
    expect(rc(`_reg_read ${ID} wrapper`)).toBe('0');
  });

  it('an EMPTY field is rc 0 with an empty value — NOT absent', () => {
    // The distinction C1 buys, at its smallest: `_reg_get` answers `""` for
    // both of these and `_crosspool_tick` used to end a crossing on either.
    seedRow();
    h.sh(`_reg_set ${ID} crosspool ""`);
    expect(rc(`_reg_read ${ID} crosspool`)).toBe('0');
    expect(h.sh(`_reg_read ${ID} crosspool`)).toBe('');
  });

  it('an ABSENT field is rc 1', () => {
    seedRow();
    expect(rc(`_reg_read ${ID} nosuchfield`)).toBe('1');
  });

  it.skipIf(process.getuid?.() === 0)('an UNREADABLE field is rc 2', () => {
    seedRow();
    const w = reg(`${ID}.wrapper`);
    fs.chmodSync(w, 0o000);
    try { expect(rc(`_reg_read ${ID} wrapper`)).toBe('2'); }
    finally { fs.chmodSync(w, 0o644); }
  });

  it('a FIELD THAT IS A DIRECTORY is rc 2 — and this one works at every uid', () => {
    // The root-safe way to build unreadability (D-1997). `cat` refuses a
    // directory with EISDIR whoever runs it, so unlike `chmod 000` this case
    // is not skipped for root — and `-e` stays TRUE, so a caller's `-e`
    // pre-gate is still passed and the read is genuinely reached. A dangling
    // symlink would not do: it fails `-e`, and the pre-gate would return first.
    seedRow();
    const w = reg(`${ID}.wrapper`);
    fs.rmSync(w); fs.mkdirSync(w);
    expect(rc(`_reg_read ${ID} wrapper`)).toBe('2');
  });

  // A MISSING `$REG` GETS NO CASE, AND THAT IS MEASURED RATHER THAN OVERLOOKED.
  // `ccd` runs `mkdir -p "$REG"` at source time (`grep -n 'mkdir -p "\$REG"'
  // ccd/ccd`), so by the time any function in it runs the directory is back:
  // a test that renames it away measures rc 1 for a genuinely-absent field in a
  // freshly-created registry, not the branch it meant to reach. The positive
  // `-d && -x` pairing still covers it deliberately — `_project_pool_state`'s
  // own paragraph is the normative statement of why an unreachable branch is
  // still written to refuse, and it is not restated here (D-1996). The two
  // anomalies that ARE reachable through that `mkdir -p` each have a case: a
  // `$REG` that is a regular file (mkdir cannot convert it) and one that is
  // unsearchable (mkdir succeeds and changes nothing).

  it('a registry directory that is a REGULAR FILE is rc 2, not rc 1', () => {
    // The other half of the positive `-d && -x` pairing: the single `! -x`
    // conjunct this replaced was false here, so every field read ABSENT.
    seedRow();
    const dir = path.join(h.home, '.cc-sessions');
    const moved = path.join(h.home, '.cc-sessions-moved');
    fs.renameSync(dir, moved);
    fs.writeFileSync(dir, 'not a directory');
    try { expect(rc(`_reg_read ${ID} wrapper`)).toBe('2'); }
    finally { fs.rmSync(dir); fs.renameSync(moved, dir); }
  });

  it('a DANGLING SYMLINK is rc 2, not rc 1 — it exists and cannot be read', () => {
    // `-e` follows symlinks, so this is the case the `|| -L` arm exists for.
    seedRow();
    fs.symlinkSync('/nonexistent/target', reg(`${ID}.dangling`));
    expect(rc(`_reg_read ${ID} dangling`)).toBe('2');
  });

  it.skipIf(process.getuid?.() === 0)(
    'an UNSEARCHABLE registry directory is rc 2 for every field — not rc 1', () => {
      // The arm with the widest blast radius, and the one no caller can reach
      // through a `-e` pre-gate: without it a single mode change on `$REG`
      // would report every field on every row ABSENT, which is the fold this
      // read exists to remove wearing its most convincing disguise.
      seedRow();
      const dir = path.join(h.home, '.cc-sessions');
      fs.chmodSync(dir, 0o000);
      try { expect(rc(`_reg_read ${ID} wrapper`)).toBe('2'); }
      finally { fs.chmodSync(dir, 0o755); }
    });
});

describe('C1 — the tick MEASURES its own inputs, so a transient failure never ends a crossing', () => {
  // THE CARRY, CLOSED. `_crosspool_tick`'s own header named this gap in prose
  // and shipped under an embargo: `_reg_get` is `cat … 2>/dev/null`, folding
  // ABSENT, UNREADABLE and EMPTY into one `""`, and the arms that END a
  // crossing could not tell a value they had measured from one they had not.
  // `_reg_read` is the distinguishing read (rc 0 / 1 / 2) and the rule it
  // enforces is the one the PROJECT TAG already had: UNDECIDABLE IS NOT A
  // DECISION. A transient permission hiccup on `$REG` must not end a live
  // crossing inside one tick, irreversibly, with no writer able to restore it.
  //
  // WHERE THE READS ACTUALLY LIVE, because a guard on the expirer alone does
  // not close this: the marker's own bytes are read in exactly one place,
  // `_crosspool_valid`, whose three consumers are the expirer, `_swap_target`
  // and `cmd_swap`; and `cur`/`home` are read once at the top of the tick and
  // consumed by every decision it makes. So the distinguishing read is spent
  // at those two points, not at the arms downstream of them.
  //
  // `chmod 000` is the only technique that builds real unreadability and it
  // cannot build it for root — hence `skipIf`, matching the project-tag case
  // two describes up. The two ZERO-BYTE cases carry no `skipIf`: they need no
  // permission trick, and they are the ones an rc-only guard lets through.

  it.skipIf(process.getuid?.() === 0)(
    'an UNREADABLE `.wrapper` never fabricates a move off the crossed account', () => {
      // `cur` reaches the tick from `.wrapper`. Before C1 a failed read
      // presented as `""`, `_crosspool_valid`'s account clause could not match
      // it, and the tick logged `moved off claude-b` — a move that never
      // happened, asserted from a read that never succeeded.
      seedRow(); tagPool('demo', 'pool-a');
      h.sh(`_reg_set ${ID} wrapper claude-b`);
      crossed('pool-a', 'claude-b');
      const w = reg(`${ID}.wrapper`);
      fs.chmodSync(w, 0o000);
      try { tick(QUIET); } finally { fs.chmodSync(w, 0o644); }
      expect(String(h.reg(ID, 'crosspool'))).toMatch(/^\d{10} pool-a claude-b$/);
      expect(swapLog(), 'the current account was never measured, so no move may be claimed')
        .not.toContain('crosspool-ended');
    });

  it('a ZERO-BYTE `.wrapper` is read-nothing, not read-a-value — and decides nothing either', () => {
    // THE CASE AN rc-ONLY GUARD LETS THROUGH, and the reason the tick tests
    // `-n` as well as rc 0. This file is READ SUCCESSFULLY: `_reg_read` answers
    // rc 0, so a guard that only asks "did the read succeed" passes it, and the
    // empty value flows on into the arms that treat `""` as an account —
    // reaching the same fabricated `moved off` the unreadable case reaches, by
    // a different route and with every read reporting success (D-1993).
    seedRow(); tagPool('demo', 'pool-a');
    h.sh(`_reg_set ${ID} wrapper claude-b`);
    crossed('pool-a', 'claude-b');
    fs.writeFileSync(reg(`${ID}.wrapper`), '');
    tick(QUIET);
    expect(String(h.reg(ID, 'crosspool'))).toMatch(/^\d{10} pool-a claude-b$/);
    expect(swapLog()).not.toContain('crosspool-ended');
  });

  it.skipIf(process.getuid?.() === 0)(
    'an UNREADABLE `.home` never fabricates a move off the crossed account', () => {
      // The `prefer`-shaped crossing: the marker records the HOME account, so
      // `home` is the argument that has to match.
      seedRow(); tagPool('demo', 'pool-a');
      h.sh(`_reg_set ${ID} home claude-b`);
      crossed('pool-a', 'claude-b');
      const hf = reg(`${ID}.home`);
      fs.chmodSync(hf, 0o000);
      try { tick(QUIET); } finally { fs.chmodSync(hf, 0o644); }
      expect(String(h.reg(ID, 'crosspool'))).toMatch(/^\d{10} pool-a claude-b$/);
      expect(swapLog()).not.toContain('crosspool-ended');
    });

  it('an UNREADABLE `.home` — built the ROOT-SAFE way, so this one is never skipped', () => {
    // The twin of the `chmod 000` case above, and the reason it exists: a root
    // run skips every `chmod` case, and a suite that reports green while the
    // whole mechanism is unpinned is worse than no suite (D-1997). A DIRECTORY
    // in the field's place is refused by `cat` at every uid (EISDIR) and keeps
    // `-e` true, so the read is genuinely reached rather than short-circuited.
    seedRow(); tagPool('demo', 'pool-a');
    h.sh(`_reg_set ${ID} home claude-b`);
    crossed('pool-a', 'claude-b');
    const hf = reg(`${ID}.home`);
    fs.rmSync(hf); fs.mkdirSync(hf);
    tick(QUIET);
    expect(String(h.reg(ID, 'crosspool'))).toMatch(/^\d{10} pool-a claude-b$/);
    expect(swapLog()).not.toContain('crosspool-ended');
  });

  it('a ZERO-BYTE `.home` falls back like an absent one — the fallback is a DECIDED answer', () => {
    // The other half of the `-n`/rc distinction, and the half that goes the
    // OTHER way. An empty `.home` is not undecidable: `_home_for` has always
    // answered `_id_wrapper` for it, a row that never had a `.home` is old
    // rather than unmeasurable, and `_home_measured` must agree with
    // `_home_for` on every decided input or the two disagree about one row.
    // Here that fallback is `claude`, which is NOT the crossed account, so the
    // crossing legitimately ends — what is asserted is that it ends for the
    // MEASURED reason and names it.
    seedRow(); tagPool('demo', 'pool-a');
    h.sh(`_reg_set ${ID} home claude-b`);
    crossed('pool-a', 'claude-b');
    fs.writeFileSync(reg(`${ID}.home`), '');
    expect(h.sh(`_home_measured ${ID}`), 'empty is decided: the id-prefix fallback').toBe('claude');
    tick(QUIET);
    expect(swapLog()).toContain(`crosspool-ended ${ID}: moved off claude-b`);
  });

  it.skipIf(process.getuid?.() === 0)(
    '`_home_for` answers a DIFFERENT account for an unreadable `.home`, not an empty one', () => {
      // The measured correction C1 turned up (D-1986), and the reason
      // `_home_measured` had to exist rather than an `-n` test being enough:
      // `_home_for` is `h=$(_reg_get "$1" home); [[ -n "$h" ]] && echo "$h" ||
      // _id_wrapper "$1"`, so a failed read does not present as `""` — it
      // presents as the account encoded in the id prefix, a real account name
      // that no read produced. A substituted name can also MATCH the marker
      // and keep a crossing alive on a value nobody measured.
      seedRow();
      h.sh(`_reg_set ${ID} home claude-b`);
      expect(h.sh(`_home_for ${ID}`), 'readable: the recorded home').toBe('claude-b');
      const hf = reg(`${ID}.home`);
      fs.chmodSync(hf, 0o000);
      try {
        expect(h.sh(`_home_for ${ID}`), 'unreadable: the id prefix, substituted silently')
          .toBe('claude');
        expect(h.sh(`_home_measured ${ID}; echo "rc=$?"`), 'the measured sibling refuses instead')
          .toBe('rc=2');
      } finally { fs.chmodSync(hf, 0o644); }
    });

  it.skipIf(process.getuid?.() === 0)(
    'an UNREADABLE record stops `_swap_target` too — the marker survives AND the session stays', () => {
      // THE HALF A GUARD ON THE EXPIRER ALONE DOES NOT REACH (D-1991).
      // `_crosspool_valid` is the one reader of the marker's bytes, and
      // `_swap_target` asks it the same question on the same tick. While the
      // expirer correctly left the marker standing, `_swap_target` read "no
      // crossing", set `force=pool` on a wrong-pool current account and
      // relocated the session off the very account the crossing protects —
      // preserving the marker and undoing the crossing anyway.
      seedRow('claude-b'); tagPool('demo', 'pool-a');   // crossed onto pool-b
      crossed('pool-a', 'claude-b');
      writeLimits('claude', 5, 5);                      // a healthy pool-a destination
      writeLimits('claude-a', 9, 9);
      const marker = reg(`${ID}.crosspool`);
      fs.chmodSync(marker, 0o000);
      try { tick(QUIET); } finally { if (fs.existsSync(marker)) fs.chmodSync(marker, 0o644); }
      expect(String(h.reg(ID, 'crosspool')), 'the marker survives an input nobody could read')
        .toMatch(/^\d{10} pool-a claude-b$/);
      expect(swapLog(), 'an unreadable record is not a reason to end a crossing')
        .not.toContain('crosspool-ended');
      expect(h.reg(ID, 'home'), 'and nothing re-seeds the home behind it').toBe('claude-b');
      expect(swapLog(), 'no rehome may ride an undecidable crossing')
        .not.toContain(` rehome ${ID}:`);
      // AND THE HALF THE TICK CANNOT SHOW. A `.not.toContain('dispatch')` here
      // would be ornamental: under QUIET the affinity arm needs a process
      // status file reading `"status":"idle"` that no fixture in this suite
      // plants, so it returns long before dispatching whatever `_swap_target`
      // answered. Ask `_swap_target` directly instead — it is the function the
      // guard is in, and its answer IS the relocation.
      fs.chmodSync(marker, 0o000);
      try {
        // RC 2, NOT rc 0 WITH EMPTY STDOUT (#67 review, S4). The first
        // version of this case asserted `.toBe('')` alone, which was true for
        // "nobody can say" AND for "stay put, everything is fine" — so it
        // pinned the fold instead of the fix. Read the answer, not the silence.
        expect(h.sh(`_swap_target ${ID} claude-b claude-b; echo "rc=$?"`),
          'an unreadable marker is not a licence to relocate — and it says so as rc 2')
          .toBe('rc=2');
      } finally { fs.chmodSync(marker, 0o644); }
      expect(h.sh(`_swap_target ${ID} claude-b claude-b; echo "rc=$?"`),
        'readable again: the crossing is honoured, the session stays, and THAT is rc 0')
        .toBe('rc=0');
    });

  it('a record that fails the FIRST read and succeeds on the second still decides nothing', () => {
    // The tick reads the record TWICE — once through `_crosspool_valid` for the
    // verdict, once for the reason — and the two can disagree, because a
    // permission hiccup is a moment, not a state. Without the tick honouring
    // `_crosspool_valid`'s rc 2, the second read wins: the record parses, its
    // pool matches, and the `else` arm logs `moved off claude-b` for a crossing
    // whose account clause was never evaluated at all. Shadowing `_reg_read` is
    // the only way to build a flip deterministically; the harness already
    // shadows `tmux` and `_dispatch_swap` the same way.
    seedRow(); tagPool('demo', 'pool-a');
    h.sh(`_reg_set ${ID} wrapper claude-b`);
    crossed('pool-a', 'claude-b');                 // a VALID crossing, readable on disk
    const FLIP = `
      eval "_reg_read_orig() $(declare -f _reg_read | tail -n +2)";
      _reg_read() {
        if [[ "\${2:-}" == crosspool && ! -e "$HOME/flipped" ]]; then
          : > "$HOME/flipped"; return 2
        fi
        _reg_read_orig "$@"
      };
    `;
    const rc = h.sh(`${FLIP} _crosspool_tick ${ID} claude-b claude "named pool-a"; echo "rc=$?"`);
    expect(rc, 'the first read failed, so nobody can say').toBe('rc=2');
    expect(String(h.reg(ID, 'crosspool'))).toMatch(/^\d{10} pool-a claude-b$/);
    expect(swapLog()).not.toContain('crosspool-ended');
  });

  it('the ABSENT halves of the two guards go OPPOSITE ways, and each way is pinned', () => {
    // The diff's most-argued decision, and it was pinned by nothing: each guard
    // could be flipped to the other's polarity with the suite green. ABSENT
    // `.wrapper` REFUSES — "there is no `.wrapper`" is not evidence of a move —
    // while ABSENT `.home` PROCEEDS, because `_home_for`'s `_id_wrapper`
    // fallback is a decided answer for a row that never had one. Root-safe:
    // absence is free to build.
    seedRow(); tagPool('demo', 'pool-a');
    h.sh(`_reg_set ${ID} wrapper claude-b`);
    crossed('pool-a', 'claude-b');
    fs.rmSync(reg(`${ID}.wrapper`));
    tick(QUIET);
    expect(String(h.reg(ID, 'crosspool')), 'no current account was measured: decide nothing')
      .toMatch(/^\d{10} pool-a claude-b$/);
    expect(swapLog()).not.toContain('crosspool-ended');
  });

  it('an ABSENT `.home` is DECIDED, so a retag still ends the crossing', () => {
    // The opposite polarity, and the reason the two guards cannot share one.
    // If ABSENT refused here too, a pre-2026-07-28 row with no `.home` would
    // answer rc 2 on every tick for ever: its marker could never be expired by
    // a retag or an untag, the crossing would be immortal and the pool
    // machinery switched off on that row — the exact hazard
    // `_crosspool_tick`'s own opening paragraph exists to prevent.
    seedRow(); tagPool('demo', 'pool-a');
    h.sh(`_reg_set ${ID} wrapper claude-b`);
    crossed('pool-a', 'claude-b');
    fs.rmSync(reg(`${ID}.home`));
    tagPool('demo', 'pool-b');                       // the operator changed their mind
    tick(QUIET);
    expect(h.reg(ID, 'crosspool')).toBeNull();
    expect(swapLog()).toContain(`crosspool-ended ${ID}: project pool is now named pool-b`);
  });

  it('the marker record ABSENT at the read logs nothing — a race is not a reason', () => {
    // The record went away between the `-e` pre-gate and the read. rc 1 leaves
    // `raw=""`, which without this arm falls into the EMPTY reason and writes
    // `marker record is empty` about a record the tick never read — a
    // fabricated line, which is the class C1 exists to remove. Shadowing
    // `_reg_read` is what makes the race deterministic.
    seedRow(); tagPool('demo', 'pool-a');
    h.sh(`_reg_set ${ID} wrapper claude-b`);
    crossed('pool-a', 'claude-b');
    h.sh(`_reg_read() { [[ "\${2:-}" == crosspool ]] && return 1; cat -- "$HOME/.cc-sessions/$1.$2" 2>/dev/null; };
          ${QUIET} _auto_swap_check ${ID}`);
    expect(swapLog()).not.toContain('crosspool-ended');
  });

  it('a DANGLING SYMLINK marker stops `_swap_target` too — the pre-gate is shared, so it must agree', () => {
    // `_crosspool_valid` has its OWN `-e` pre-gate, and the tick's second
    // measured read masks a `-L` missing from it — but `_swap_target` and
    // `cmd_swap` call the predicate directly and have no such second read. For
    // them a bare `-e` answers "no crossing stands" for a path `_reg_read`
    // calls unreadable, and `force=pool` relocates the session off it (D-1994).
    seedRow('claude-b'); tagPool('demo', 'pool-a');
    crossed('pool-a', 'claude-b');
    writeLimits('claude', 5, 5);
    const marker = reg(`${ID}.crosspool`);
    fs.rmSync(marker);
    fs.symlinkSync('/nonexistent/target', marker);
    expect(h.sh(`_crosspool_valid ${ID} "named pool-a" claude-b; echo "rc=$?"`)).toBe('rc=2');
    expect(h.sh(`_swap_target ${ID} claude-b claude-b; echo "rc=$?"`),
      'a marker path nobody can measure is not a licence to relocate — rc 2, not silence')
      .toBe('rc=2');
  });

  it('a marker path that is a DANGLING SYMLINK decides nothing — and no re-seed rides it', () => {
    // The `-e` pre-gate used to answer "no crossing stands" for a path
    // `_reg_read` calls unreadable (D-1994), and under C1's caller that answer
    // is the one value that positively ENABLES the home re-seed. So the cheap
    // gate could authorise the clobber the expensive one refuses.
    seedRow('claude-b'); tagPool('demo', 'pool-a');
    crossed('pool-a', 'claude-b');
    writeLimits('claude', 5, 5);
    const marker = reg(`${ID}.crosspool`);
    fs.rmSync(marker);
    fs.symlinkSync('/nonexistent/target', marker);
    tick(QUIET);
    expect(h.reg(ID, 'home'), 'an unmeasurable marker path is not a licence to re-seed')
      .toBe('claude-b');
    expect(swapLog()).not.toContain(` rehome ${ID}:`);
  });

  it('standing still is SAID — once per episode, not once per tick', () => {
    // C1 traded a destructive answer for a standing-still, and that trade is
    // only sound if the standing-still is observable (D-1995). Nothing in ccd
    // ever re-chmods a registry file, so an unmeasurable field parks the row
    // for ever; `$REG/swap.log` is the operator's only window onto it. One
    // line per EPISODE — a plain echo here would be 720 an hour per stuck row.
    seedRow(); tagPool('demo', 'pool-a');
    h.sh(`_reg_set ${ID} wrapper claude-b`);
    crossed('pool-a', 'claude-b');
    const marker = reg(`${ID}.crosspool`);
    fs.rmSync(marker); fs.mkdirSync(marker);          // uid-independent unreadability
    tick(QUIET, 3);
    expect(logLines('tick-undecidable'), 'three ticks, one line').toHaveLength(1);
    expect(swapLog()).toContain(`tick-undecidable ${ID}: crosspool could not be measured`);
    // …and the stamp clears the moment the row decides again, so the NEXT
    // episode is audible too rather than being swallowed by the first.
    fs.rmdirSync(marker);
    crossed('pool-a', 'claude-b');
    tick(QUIET);
    expect(h.reg(ID, 'tickstuck'), 'a decided row carries no stamp').toBeNull();
  });

  it('`_swap_target` stands still on an unmeasurable marker — the ROOT-SAFE twin', () => {
    // Same mechanism as the `chmod 000` case above, built with a directory so
    // it runs at every uid (D-1997). `_swap_target` is asked directly because
    // its answer IS the relocation, and the affinity arm that would carry it
    // needs a process status file no fixture in this suite plants.
    seedRow('claude-b'); tagPool('demo', 'pool-a');
    crossed('pool-a', 'claude-b');
    writeLimits('claude', 5, 5);
    const marker = reg(`${ID}.crosspool`);
    fs.rmSync(marker); fs.mkdirSync(marker);
    expect(h.sh(`_swap_target ${ID} claude-b claude-b; echo "rc=$?"`),
      'an unreadable marker is not a licence to relocate off the crossed account')
      .toBe('rc=2');
    fs.rmdirSync(marker);
    crossed('pool-a', 'claude-b');
    expect(h.sh(`_swap_target ${ID} claude-b claude-b; echo "rc=$?"`),
      'readable again: the crossing is honoured and the session stays').toBe('rc=0');
  });

  it.skipIf(process.getuid?.() === 0)(
    '`_crosspool_valid` itself answers rc 2 — the third answer every consumer inherits', () => {
      seedRow(); tagPool('demo', 'pool-a');
      crossed('pool-a', 'claude-b');
      const marker = reg(`${ID}.crosspool`);
      fs.chmodSync(marker, 0o000);
      try {
        expect(h.sh(`_crosspool_valid ${ID} "named pool-a" claude-b; echo "rc=$?"`))
          .toBe('rc=2');
      } finally { fs.chmodSync(marker, 0o644); }
      expect(h.sh(`_crosspool_valid ${ID} "named pool-a" claude-b; echo "rc=$?"`),
        'readable again: it answers the question')
        .toBe('rc=0');
    });
});

/** The self-swap fixture: `tmux display-message` answers with this session's
 *  own name and TMUX is set, so `cmd_swap` takes the detach arm. The SEAM is
 *  shadowed rather than the tool — `_svc_run_detached` is what ccd calls, and
 *  only its Linux arm is systemd-run. */
const SELF = `
  systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; return 0; };
  launchctl() { echo "launchctl $*" >> "$HOME/ccd-calls"; return 0; };
  sleep() { :; };
  tmux() { case "\${1:-}" in display-message) echo "cc-${ID}";; esac;
    echo "tmux $*" >> "$HOME/ccd-calls"; return 0; };
  _svc_run_detached() { echo "detached $*" >> "$HOME/ccd-calls"; return 0; };
`;

describe('cmd_swap refuses a crossing that was not asked for', () => {
  it('dies BEFORE the detach arm — synchronously, with nothing dispatched', () => {
    // The guard slot matters: below the detach arm this refusal would happen in
    // a process nobody is waiting for, and the PWA's 502 would carry nothing.
    const mdir = seedRow(); plant('.claude', mdir, 'HISTORY\n'); tagPool('demo', 'pool-a');
    const r = shFail(`${SELF} cmd_swap ${ID} claude-b`, { TMUX: '/tmp/x,1,0' });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(
      "pool-mismatch: claude-b is in pool 'pool-b' and project 'demo' is in pool 'pool-a'");
    expect(r.stderr).toContain(`ccd swap --cross-pool ${ID} claude-b`);
    expect(h.calls().join('\n'), 'the detach arm was never reached').not.toContain('detached');
    expect(h.reg(ID, 'wrapper')).toBe('claude');
  });

  it('`--force` is NOT the override — it means transcript loss and nothing else', () => {
    const mdir = seedRow(); plant('.claude', mdir, 'HISTORY\n'); tagPool('demo', 'pool-a');
    const r = shFail(`${SWAP_STUBS} cmd_swap --force ${ID} claude-b`, { TMUX: '' });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('pool-mismatch: claude-b is in pool');
    expect(h.reg(ID, 'wrapper')).toBe('claude');
    // Review round 1, Important 2. `CCD_SWAP_AUTO` is unset on this call (a
    // shell invocation, not a dispatched unit), so the strand-mark inside the
    // guard's else arm must not fire — an operator's plain mistyped swap (or
    // the same tap from the PWA) is not the deploy-window scenario §5.8.4
    // exists for, and must not write `.stranded`, log a `stranded` line, or
    // burn the strand-notify floor against the next GENUINE strand.
    expect(h.reg(ID, 'stranded')).toBeNull();
  });

  it('refuses on an UNDECIDABLE tag even with the flag — nobody decides, so nobody crosses', () => {
    const mdir = seedRow(); plant('.claude', mdir, 'HISTORY\n'); tagPool('demo', 'Pool Orate');
    const r = shFail(`${SWAP_STUBS} cmd_swap --cross-pool ${ID} claude-b`, { TMUX: '' });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(
      `pool tag for demo is malformed: ${h.home}/.cc-sessions/pools/demo`);
    expect(r.stderr).toContain('nothing was touched');
    expect(h.reg(ID, 'wrapper')).toBe('claude');
  });
});

describe('cmd_swap crosses on purpose', () => {
  it('writes the marker, ONE `cross-pool` line and `dec.crosspool 1`', () => {
    const mdir = seedRow(); plant('.claude', mdir, 'HISTORY\n'); tagPool('demo', 'pool-a');
    expect(h.sh(`${SWAP_STUBS} cmd_swap --cross-pool ${ID} claude-b`, { TMUX: '' }))
      .toContain(`swapped ${ID}: claude -> claude-b`);
    expect(h.reg(ID, 'wrapper')).toBe('claude-b');
    expect(h.reg(ID, 'crosspool')).toMatch(/^\d{10} pool-a claude-b$/);
    expect(logLines('cross-pool')).toHaveLength(1);
    expect(swapLog()).toContain(
      `cross-pool ${ID}: claude -> claude-b [project=demo pool=pool-a target-pool=pool-b]`);
    const rows = eventsOf(h.home, 'swap');
    expect(rows).toHaveLength(1);
    expect(decOf(rows[0]!)['crosspool']).toBe('1');
    expect(measOf(rows[0]!)).toMatchObject({ from: 'claude', wrapper: 'claude-b' });
  });

  it('writes NO marker and no crossing flag for an ordinary in-pool swap', () => {
    const mdir = seedRow(); plant('.claude', mdir, 'HISTORY\n'); tagPool('demo', 'pool-a');
    h.sh(`${SWAP_STUBS} cmd_swap ${ID} claude-a`, { TMUX: '' });
    expect(h.reg(ID, 'crosspool')).toBeNull();
    expect(logLines('cross-pool')).toHaveLength(0);
    expect(decOf(eventsOf(h.home, 'swap')[0]!)['crosspool']).toBeUndefined();
  });

  it('the detached retry keeps the operator`s decision — the flag rides the unit argv', () => {
    const mdir = seedRow(); plant('.claude', mdir, 'HISTORY\n'); tagPool('demo', 'pool-a');
    h.sh(`${SELF} cmd_swap --cross-pool ${ID} claude-b`, { TMUX: '/tmp/x,1,0' });
    const argv = h.calls().filter((c) => c.startsWith('detached ')).join('\n');
    expect(argv, 'the detach really happened').toContain(`swap`);
    expect(argv).toContain('--cross-pool');
    // Logged ONCE, at the success tail: this arm re-execs and runs the guard a
    // second time, so a line written at the guard would be written twice.
    expect(logLines('cross-pool')).toHaveLength(0);
    // Review round 1, Important 1. The detach arm RETURNS before the carry
    // ever runs — nothing has moved yet, the re-exec'd unit is what will
    // actually do it — so the marker must not exist on THIS process's
    // registry. `_crosspool_mark` belongs solely at the success tail; written
    // at the guard instead, it would name a crossing this call never
    // performed, and a later death (a failed transcript pre-flight, a
    // missing config-dir mapping, `systemd-run` itself failing) would leave
    // it standing — the pool machinery switched off for good on an account
    // the session never reached.
    expect(h.reg(ID, 'crosspool')).toBeNull();
  });

  it('a landed swap CLEARS a standing strand', () => {
    const mdir = seedRow(); plant('.claude', mdir, 'HISTORY\n');
    h.sh(`_reg_set ${ID} stranded "1700000000 no candidate"`);
    h.sh(`${SWAP_STUBS} cmd_swap ${ID} claude-a`, { TMUX: '' });
    expect(h.reg(ID, 'stranded')).toBeNull();
    expect(logLines('unstranded')).toHaveLength(1);
  });

  it('a STANDING crossing lets the same target land with NO flag — the automatic path`s own escape', () => {
    // Review round 1, Important 3. This is the arm `_swap_target`'s "home
    // recovered, go back" branch and `_auto_swap_check`'s own dispatch
    // (CCD_SWAP_AUTO=1, no --cross-pool) depend on: the pool machinery
    // itself chose this exact move once, under a marker that still stands,
    // so the guard must not re-refuse it as an undeclared crossing. Without
    // this arm every such automatic move would strand the row and banner
    // the operator every SWAP_COOLDOWN — silently, because nothing in this
    // suite exercises `cmd_swap` with a standing marker AND no flag.
    const mdir = seedRow(); plant('.claude', mdir, 'HISTORY\n'); tagPool('demo', 'pool-a');
    crossed('pool-a', 'claude-b');
    expect(h.sh(`${SWAP_STUBS} cmd_swap ${ID} claude-b`, { TMUX: '' }))
      .toContain(`swapped ${ID}: claude -> claude-b`);
    expect(h.reg(ID, 'wrapper')).toBe('claude-b');
    expect(h.reg(ID, 'stranded')).toBeNull();
  });
});

describe('cmd_swap\'s CCD_SWAP_AUTO strand filter (§5.8.4) — a sound filter, not a deploy-window simulation', () => {
  it('a pool-aware cmd_swap reached with CCD_SWAP_AUTO=1 strands loudly on an undeclared crossing', () => {
    // CORRECTED (final whole-branch review, I-2): this fixture does NOT model
    // the pre-deploy supervisor §5.8.4 was built for, and its previous name
    // and comment claimed otherwise. `CCD_SWAP_AUTO` is set ONLY by the NEW
    // `_dispatch_swap` (confirm: `git show 58ef97b6:ccd/ccd | grep -c
    // CCD_SWAP_AUTO` is 0) — a supervisor still running the OLD inode calls
    // its OWN pre-deploy `_dispatch_swap`, which never sets the variable at
    // all. A pool-blind `_swap_target` and a `CCD_SWAP_AUTO=1`-setting
    // `_dispatch_swap` live in ONE bash process image and cannot disagree the
    // way this fixture forces them to — the premise below ("the environment
    // the real one sets") was false.
    //
    // What this case DOES genuinely measure: a pool-aware `cmd_swap` reached
    // with `CCD_SWAP_AUTO=1` set (as only a post-deploy `_dispatch_swap` ever
    // sets it) strands LOUDLY — marker + banner, both floor-debounced —
    // instead of silently, whenever `_swap_target`'s own pre-filter hands it
    // a target the guard refuses. That half of the mechanism is real and
    // pinned here. The pre-deploy window itself is closed by `deploy.sh`'s
    // supervisor sweep (`try-restart claude-session@*`, behind its
    // `KillMode=process` preflight), not by this variable, because an old
    // supervisor's own `_dispatch_swap` predates it. The one case where the
    // pre-filter and the guard can still disagree post-sweep is the
    // retag-races-a-dispatched-unit's-jitter window spec §5.8.4 accepts as
    // P-8 — no stale supervisor involved there either.
    const mdir = seedRow(); plant('.claude', mdir, 'HISTORY\n');
    tagPool('demo', 'pool-a'); plantNotify();
    const AUTO_GATED_SUPERVISOR = `
      systemctl() { :; }; launchctl() { :; }; sleep() { :; };
      tmux() { case "\${1:-}" in capture-pane) echo "API Error: 429 Too Many Requests";; esac; return 0; };
      _swap_target() { echo claude-b; };
      # A SUBSHELL, because that is what the real one is: _dispatch_swap runs
      # cmd_swap in a transient systemd unit, and cmd_swap's guard reaches
      # \`die\` (echo + exit 1). In-process that would exit the whole test shell.
      _dispatch_swap() { ( CCD_SWAP_AUTO=1 cmd_swap "$1" "$2" ) >/dev/null 2>&1 || true; };`;
    h.sh(`${AUTO_GATED_SUPERVISOR} _auto_swap_check ${ID}`);
    expect(h.reg(ID, 'wrapper'), 'nothing moved').toBe('claude');
    expect(h.reg(ID, 'stranded')).toMatch(/^\d{10} /);
    expect(noticeLines()).toHaveLength(1);
    // Review round 1, Important 4. PINNED WHOLE, not by prefix: the stock
    // "no account in pool $pdesc can take it" sentence is FALSE here — an
    // in-pool account (claude-a) genuinely could take the session — so the
    // banner must say what actually happened (an undeclared crossing this
    // guard refused) rather than a misleading pool census. MEASURED.
    expect(noticeLines()[0]).toBe(
      `cc swap STRANDED: ${ID} is blocked on claude — claude-b refused as a `
      + 'cross-pool crossing nobody asked for — likely a supervisor still '
      + 'running a pre-deploy ccd; the remedy is the claude-session@* unit sweep');
    expect(h.reg(ID, 'lastswap'),
      'the stamp stays: retracting it would re-dispatch the same choice every 5 s')
      .toMatch(/^\d{10}$/);
  });

  it('_dispatch_swap really sets CCD_SWAP_AUTO in the unit it launches', () => {
    seedRow();
    h.sh('_svc_run_detached() { echo "detached $*" >> "$HOME/ccd-calls"; return 0; };'
      + ` _dispatch_swap ${ID} claude-a`);
    const argv = h.calls().filter((c) => c.startsWith('detached ')).join('\n');
    // Review round 1, Minor 1: placement-aware, not merely present-anywhere.
    // `CCD_SWAP_AUTO=1 exec …` exports it into the re-exec'd `ccd`'s
    // environment; `CCD_SWAP_AUTO=1;` (a bare assignment, semicolon-terminated
    // with no `exec` after it) would satisfy `.toContain('CCD_SWAP_AUTO=1')`
    // while never actually reaching the child process — a mutation that made
    // the whole deploy-window mechanism inert while this suite stayed green.
    expect(argv).toContain('CCD_SWAP_AUTO=1 exec ');
  });
});

/** Everything `cmd_start`/`cmd_ensure` reach that must not leave the fixture.
 *  `_alive` is forced false: WS_ADD's `tmux() { :; }` returns 0 for
 *  `has-session`, which would send every case down the already-running no-op. */
const START_STUBS = `${WS_ADD} _alive() { return 1; }; _have_systemctl() { return 1; };`;

/** `shFail` above is built on `h.sh`'s `execFileSync`, which — like every
 *  Node sync exec convenience wrapper — pipes a SUCCESSFUL child's stderr
 *  straight to the parent's own stderr rather than capturing it, so a
 *  warning emitted on a zero-exit run (the revival case just below) is
 *  invisible to `shFail`'s `stderr: ''` success arm: the assertion would
 *  read empty forever, pass or fail, regardless of what `cmd_start` actually
 *  printed. `ccd-start-id.test.ts`'s own `run()` hit the identical problem
 *  for the registry-wins warning and fixed it the same way: `spawnSync`
 *  captures both streams unconditionally. */
const run = (snippet: string): { code: number; stdout: string; stderr: string } => {
  const r = spawnSync('bash', ['-c', `source "${CCD}"; ${snippet}`], {
    encoding: 'utf8', cwd: h.home, timeout: 15000,
    env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }),
  });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

describe('cmd_start and the pool', () => {
  it('refuses to CREATE out of pool, and touches nothing', () => {
    tagPool('demo', 'pool-a');
    fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
    const r = shFail(`${START_STUBS} cmd_start claude-b demo`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("pool-mismatch: claude-b is in pool 'pool-b'");
    expect(r.stderr).toContain('ccd start --cross-pool claude-b demo');
    expect(fs.existsSync(reg('claude-b-demo.uuid')), 'nothing was created').toBe(false);
  });

  it('refuses on an UNDECIDABLE tag even with the flag — nobody decides, so nobody crosses', () => {
    // Coordinator review, fix round 1, Important 1. This guard shipped
    // (`[[ "$prc" -eq 2 ]] && die …`) but nothing exercised it: deleting the
    // line was GREEN, and a malformed or unreadable tag would CREATE THE
    // SESSION SILENTLY instead of refusing and naming the file to fix.
    // `cmd_swap`'s own equivalent case, three describes up in this file, is
    // what this one mirrors.
    //
    // CORRECTED (merge review, M4): this said "left all 189 baseline cases
    // green". Same defect as the digits in `cmd_prefer`'s sibling case below
    // — an unnamed denominator is not a measurement, and M4 named only the
    // other instance. The reproducible version, suite set and all, is
    // written out once in that sibling case's comment. Measured against it,
    // deleting `cmd_start`'s own guard (the `[[ "$prc" -eq 2 ]] && die …`
    // under its `[[ -z "$regw" ]]` arm) is 2 failed / 294 passed, and the
    // semantic red is THIS case.
    tagPool('demo', 'Pool Orate');
    fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
    const r = shFail(`${START_STUBS} cmd_start --cross-pool claude-b demo`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(
      `pool tag for demo is malformed: ${h.home}/.cc-sessions/pools/demo`);
    expect(r.stderr).toContain('nothing was touched');
    expect(fs.existsSync(reg('claude-b-demo.uuid')), 'nothing was created').toBe(false);
    // Important 2, closed by the same fix: narrowing the guard to
    // `"$prc" -eq 2 && -z "$cross"` (making an undecidable tag overridable
    // by the flag) is caught by this exact case too — it passes `--cross-
    // pool` and still expects the refusal.
  });

  it('WARNS rather than refusing on a REVIVAL — the registry already won the account', () => {
    // Ruling 5's auto path owns this move; refusing here would refuse to
    // restart a session the retag put in the wrong pool.
    tagPool('demo', 'pool-a');
    const wd = path.join(h.home, 'projects', 'demo');
    fs.mkdirSync(wd, { recursive: true });
    h.sh(`_reg_set claude-b-demo uuid ${UUID}
      _reg_set claude-b-demo wrapper claude-b
      _reg_set claude-b-demo project demo
      _reg_set claude-b-demo workdir ${wd}`);
    const r = run(`${START_STUBS} cmd_start claude-b demo`);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("which is not in project 'demo''s pool 'pool-a'");
    expect(h.reg('claude-b-demo', 'wrapper')).toBe('claude-b');
  });

  it('creates WITH the flag, seeds the crossed home, and writes the marker', () => {
    tagPool('demo', 'pool-a');
    fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
    h.sh(`${START_STUBS} cmd_start --cross-pool claude-b demo`);
    expect(h.reg('claude-b-demo', 'wrapper')).toBe('claude-b');
    expect(h.reg('claude-b-demo', 'home')).toBe('claude-b');
    expect(h.reg('claude-b-demo', 'crosspool')).toMatch(/^\d{10} pool-a claude-b$/);
  });

  it('a REVIVAL clears a standing strand', () => {
    seedRow();
    h.sh(`_reg_set ${ID} stranded "1700000000 no candidate"`);
    h.sh(`${START_STUBS} cmd_start ${ID}`);
    expect(h.reg(ID, 'stranded')).toBeNull();
  });

  it('a REVIVAL with --cross-pool writes no marker — a revival is not a creation', () => {
    // Coordinator review, fix round 1, Important 3 (first hole). Dropping
    // `-z "$regw"` from the MARKER line (a separate condition from the pool-
    // policy guard's own `-z "$regw"` a few lines up) is green today: an
    // existing wrong-pool row revived with `--cross-pool` would then write a
    // standing crossing marker, converting a revival ruling 5's auto path
    // owns into a deliberate crossing nobody declared — the flag has nothing
    // to do on a revival at all, since the registry already won the account.
    tagPool('demo', 'pool-a');
    const wd = path.join(h.home, 'projects', 'demo');
    fs.mkdirSync(wd, { recursive: true });
    h.sh(`_reg_set claude-b-demo uuid ${UUID}
      _reg_set claude-b-demo wrapper claude-b
      _reg_set claude-b-demo project demo
      _reg_set claude-b-demo workdir ${wd}`);
    h.sh(`${START_STUBS} cmd_start --cross-pool claude-b demo`);
    expect(h.reg('claude-b-demo', 'crosspool'), 'nothing to mark — the flag has no effect on a revival')
      .toBeNull();
  });

  it('creates IN POOL with the flag anyway — a no-op crossing, and no marker', () => {
    // Coordinator review, fix round 1, Important 3 (second hole). Dropping
    // `"$prc" -eq 1` from the marker line is green today: creating WITH the
    // flag on an account that is already in the project's pool would record
    // a crossing that never happened, and `_crosspool_valid` then holds that
    // fabricated marker valid indefinitely — the next genuine retag would
    // read as pre-authorised by a crossing nothing actually did.
    tagPool('demo', 'pool-a');
    fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
    h.sh(`${START_STUBS} cmd_start --cross-pool claude demo`);   // claude is IN pool-a already
    expect(h.reg('claude-demo', 'wrapper')).toBe('claude');
    expect(h.reg('claude-demo', 'crosspool'), 'nothing was crossed — no marker to write').toBeNull();
  });
});

describe('cmd_enable strips the flag BEFORE it computes the id', () => {
  it('journals `enable` for `<wrapper>-<project>`, never for the flag', () => {
    tagPool('demo', 'pool-a');
    fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
    h.sh(`${START_STUBS} cmd_enable --cross-pool claude-b demo`);
    const rows = eventsOf(h.home, 'enable');
    expect(rows).toHaveLength(1);
    expect(rows[0]!['id']).toBe('claude-b-demo');
    expect(h.reg('claude-b-demo', 'crosspool'), 'the flag reached cmd_start too')
      .toMatch(/^\d{10} pool-a claude-b$/);
  });
});

describe('cmd_prefer', () => {
  it('journals a `rehome` for the first time (D-1677)', () => {
    seedRow(); tagPool('demo', 'pool-a');
    expect(h.sh(`cmd_prefer ${ID} claude-a`)).toContain(`home for ${ID} set to claude-a`);
    expect(h.reg(ID, 'home')).toBe('claude-a');
    const rows = eventsOf(h.home, 'rehome');
    expect(rows).toHaveLength(1);
    expect(measOf(rows[0]!)).toMatchObject({ from: 'claude', home: 'claude-a', reason: 'prefer' });
    expect(decOf(rows[0]!)['crosspool'], 'nothing was crossed').toBeUndefined();
    expect(h.reg(ID, 'crosspool')).toBeNull();
  });

  it('refuses a crossing that was not asked for', () => {
    seedRow(); tagPool('demo', 'pool-a');
    const r = shFail(`cmd_prefer ${ID} claude-b`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('pool-mismatch: claude-b is in pool');
    expect(r.stderr).toContain(`ccd prefer --cross-pool ${ID} claude-b`);
    expect(h.reg(ID, 'home'), 'nothing was touched').toBe('claude');
  });

  it('refuses on an UNDECIDABLE tag even with the flag — nobody decides, so nobody crosses', () => {
    // Coordinator review, fix round 1, Important 1. Before this case existed,
    // deleting the guard was GREEN — that is the defect it closes. It is
    // `cmd_prefer`'s own equivalent of `cmd_start`'s and `cmd_swap`'s
    // undecidable-tag refusal, above; Important 2's narrowed-guard mutation
    // is the other half of the pair.
    //
    // CORRECTED (merge review, M4). This comment used to say the deletion
    // "left 119 of the baseline 189 cases green". Those digits named no
    // suite set, so nobody could re-run them and they were not a
    // measurement — an unnamed denominator is a number-shaped opinion.
    // Re-measured 2026-09-07 at the shipping tip, with the set stated:
    //   cd server && ./node_modules/.bin/vitest run \
    //     test/ccd-crosspool.test.ts test/ccd-project-pool.test.ts \
    //     test/pools-existence-pairing.test.ts \
    //     test/ccd-lifecycle-contain.test.ts test/lifecycle-wire.test.ts \
    //     test/ccd-archive.test.ts test/ccd-workspaces.test.ts
    // — the union of every suite naming `cmd_prefer` or `cmd_start`, so the
    // set covers the CHANGED CALL SITES rather than this file alone.
    // Baseline: 7 files / 296 tests / 0 failed. Delete any ONE of the three
    // verbs' two-line `[[ "$prc" -eq 2 ]] && die …` and it is 2 failed /
    // 294 passed — the semantic red being that verb's own case here
    // (`cmd_start and the pool`, `cmd_swap refuses a crossing that was not
    // asked for`, or `cmd_prefer`), plus `pools-existence-pairing`'s
    // "guards the guard", which blocks functions out by line and reds on
    // any deletion. One semantic detection each, one structural byproduct.
    //
    // All three verbs were measured because the first attempt at this
    // correction mislabelled a call site: the `_pool_ok` line reached by
    // deleting at what looked like `cmd_start`'s guard is `cmd_swap`'s
    // (`grep -n '_pool_ok "$target"' ccd/ccd`, inside `cmd_swap`; `cmd_start`'s
    // is `_pool_ok "$wrapper"` under its `[[ -z "$regw" ]]` arm). The
    // numbers were right and the attribution was wrong, which is its own
    // failure mode — so all three are named here rather than two inferred
    // from one run.
    seedRow(); tagPool('demo', 'Pool Orate');
    const r = shFail(`cmd_prefer --cross-pool ${ID} claude-b`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(
      `pool tag for demo is malformed: ${h.home}/.cc-sessions/pools/demo`);
    expect(r.stderr).toContain('nothing was touched');
    expect(h.reg(ID, 'home'), 'nothing was touched').toBe('claude');
  });

  it('--cross-pool on an IN-POOL wrapper is a no-op crossing — no marker, no dec.crosspool', () => {
    // Coordinator review, fix round 1, Important 4. Dropping `"$prc" -eq 1`
    // from the marker/dec line is green today: `ccd prefer --cross-pool`
    // onto a wrapper that is ALREADY in the project's pool would still
    // journal `dec.crosspool 1` and write a marker for a move that crosses
    // nothing — a false operator-intent record on the one row this task
    // exists to make truthful.
    seedRow(); tagPool('demo', 'pool-a');
    h.sh(`cmd_prefer --cross-pool ${ID} claude-a`);   // claude-a is IN pool-a, same as claude
    expect(h.reg(ID, 'home')).toBe('claude-a');
    expect(h.reg(ID, 'crosspool'), 'nothing was crossed — no marker to write').toBeNull();
    expect(decOf(eventsOf(h.home, 'rehome')[0]!)['crosspool'], 'nothing was crossed').toBeUndefined();
  });

  it('`--cross-pool` moves the HOME, marks it, and the re-seed leaves it alone', () => {
    // Without the marker this is a no-op within 5 s: the re-seed would rewrite
    // `.home` back into pool-a on the very next tick.
    seedRow(); tagPool('demo', 'pool-a'); writeLimits('claude-a', 5, 5);
    h.sh(`cmd_prefer --cross-pool ${ID} claude-b`);
    expect(h.reg(ID, 'home')).toBe('claude-b');
    expect(h.reg(ID, 'crosspool')).toMatch(/^\d{10} pool-a claude-b$/);
    expect(decOf(eventsOf(h.home, 'rehome')[0]!)['crosspool']).toBe('1');
    tick(QUIET, 10);
    expect(h.reg(ID, 'home'), 'the re-seed must not undo a deliberate crossing').toBe('claude-b');
    expect(eventsOf(h.home, 'rehome'), 'and it must not journal one either').toHaveLength(1);
  });
});

describe('cmd_ensure clears the strand only for a human act', () => {
  const strand = (): void => { h.sh(`_reg_set ${ID} stranded "1700000000 no candidate"`); };

  it('an operator `ccd ensure` clears it', () => {
    seedRow(); strand();
    h.sh(`${START_STUBS} cmd_ensure ${ID}`);
    expect(h.reg(ID, 'stranded')).toBeNull();
  });

  it('a supervisor re-entering its OWN unit keeps it', () => {
    // CCD_IN_UNIT is `cmd_supervise`'s own marker. Clearing there would erase
    // the marker `_auto_swap_check` wrote seconds earlier, in a different
    // process, and the next tick would re-mark and re-banner.
    seedRow(); strand();
    h.sh(`${START_STUBS} cmd_ensure ${ID}`, { CCD_IN_UNIT: '1' });
    expect(h.reg(ID, 'stranded')).not.toBeNull();
  });

  it('`_swap_refuse`s in-process fallback keeps it too — the second guard', () => {
    seedRow(); strand();
    h.sh(`${START_STUBS} CCD_KEEP_SWAPBLOCK=1 cmd_ensure ${ID}`);
    expect(h.reg(ID, 'stranded')).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R1/R2 — the #67 review's findings, measured. C1's first version put two
// guards at the TOP of `_auto_swap_check` and returned from the WHOLE tick, and
// everything the LIMIT-RESCUE lane needs sits below them. The result traded an
// inert defect (C1's own, embargoed — no `.crosspool` marker exists on the box)
// for a live one on every session: a row whose `.home` merely became unreadable
// was never evacuated when it hit a limit, every five seconds, forever, with no
// marker and no banner. On `origin/main` `_home_for` fell back to a valid
// account and that rescue was entirely sound, so this was strictly a regression.
describe('R1 — an unmeasurable input costs the CROSSING, never the rescue', () => {
  const unreadable = (field: string): string => {
    // A DIRECTORY in the field's place, not `chmod 000`: `cat` refuses with
    // EISDIR at every uid including root, and `-e` stays true, so this case
    // needs no `skipIf` and measures the same rung on the machine most likely
    // to run the suite as root. The same technique the C1 cases above use.
    const p = reg(`${ID}.${field}`);
    fs.rmSync(p, { force: true });
    fs.mkdirSync(p);
    return p;
  };

  it('an unreadable `.home` still lets a limit-blocked session be RESCUED', () => {
    // THE REGRESSION, end to end. `claude` is pinned at the ceiling and
    // `claude-a` is wide open, so a healthy tick evacuates. The only thing
    // wrong with this row is that its `.home` cannot be read — which the
    // crossing decision needs and the rescue does not.
    seedRow(); plantNotify();
    writeLimits('claude', 99, 99);
    writeLimits('claude-a', 1, 1);
    unreadable('home');
    tick(BLOCKED);
    expect(h.calls().join('\n'), 'the rescue must still fire — this is what regressed')
      .toContain(`dispatch ${ID} -> claude-a`);
    expect(swapLog(), 'and it is logged as a rescue').toContain(`auto-rescue ${ID}:`);
    // AND THE CROSSING HALF IS STILL REFUSED, which is the half `.home` really
    // does decide. Nothing may re-seed a home nobody could read.
    expect(swapLog(), 'no rehome may ride an unmeasurable home')
      .not.toContain(` rehome ${ID}:`);
    expect(swapLog(), 'and the stand-still is still SAID').toContain('tick-undecidable');
  });

  it('an unreadable `.home` never lets the session go BACK to it — the empty-name walk', () => {
    // WHY `hrc` IS AN ARGUMENT AND NOT AN EMPTY `home`. Measured, and it is
    // the reason this fix is shaped the way it is: `_account_ok ""` is TRUE,
    // because `[[ -x "$WRAPPER_DIR/" ]]` tests the DIRECTORY and a directory is
    // searchable. So passing `""` as home would walk straight into the
    // home-recovered arm — D-1993's defect wearing `_swap_target`'s clothes.
    expect(h.sh('_account_ok ""; echo "rc=$?"'),
      'the premise: an empty account name PASSES _account_ok').toBe('rc=0');
    seedRow(); plantNotify();
    writeLimits('claude', 99, 99);
    writeLimits('claude-a', 1, 1);
    unreadable('home');
    tick(BLOCKED);
    const argv = h.calls().join('\n');
    expect(argv, 'never a dispatch to the empty account name').not.toMatch(/dispatch \S+ -> *$/m);
    expect(argv, 'the rescue picked a REAL account').toContain('-> claude-a');
  });

  it('an unreadable `.wrapper` STRANDS LOUDLY rather than standing still in silence', () => {
    // The one value the tick genuinely cannot proceed without — `cur` is
    // `_swap_target`'s first input and `_strand_why` names it in every
    // sentence. So it still returns; what changed is that it no longer returns
    // with nothing an operator can see. `swap.log` is not a surface: measured,
    // `grep -rn 'swap\.log' server/src agent/src shared pwa/src` finds three
    // hits and all three are comments. `.stranded` IS one.
    seedRow(); plantNotify();
    writeLimits('claude', 99, 99);
    unreadable('wrapper');
    tick(BLOCKED);
    expect(String(h.reg(ID, 'stranded')),
      'the row carries a strand the server can put on the phone')
      .toMatch(/^\d{10} wrapper could not be measured/);
    expect(noticeLines().join('\n'), 'and a banner fires').toContain('STRANDED');
    expect(swapLog(), 'and the swap.log line is still there for the box')
      .toContain('tick-undecidable');
  });

  it('…but NOT when the pane is merely quiet — an unmeasured field is not a strand', () => {
    // The discipline that keeps the line above from being the very defect it
    // replaces. A session standing still on an unreadable field may be idle,
    // mid-turn, or perfectly happy; marking it stranded would be a fabricated
    // positive claim, which is what S5 is about one seam up.
    seedRow(); plantNotify();
    unreadable('wrapper');
    tick(QUIET);
    expect(h.reg(ID, 'stranded'), 'a quiet pane is not stranded').toBeNull();
    expect(noticeLines(), 'and nothing is announced').toHaveLength(0);
  });
});

describe('R2 — `_swap_target` answers THREE conditions, and the caller acts on all three', () => {
  it('an undecidable crossing record strands with ITS OWN cause, not `_strand_why`’s sentence', () => {
    // The fabricated strand. With `_swap_target` folding "nobody can say" into
    // "stay put", an empty answer plus a hard-blocked pane became
    // `_strand_mark` with the stock reason — "no account in pool X can take
    // it" — a DURABLE POSITIVE CLAIM, on the phone and in a banner, that is
    // flatly false when an in-pool account is sitting there free. A strand is
    // louder and more convincing than the relocation C1 removed, so
    // fabricating one is the worse end of the same defect.
    seedRow('claude-b'); tagPool('demo', 'pool-a'); plantNotify();
    crossed('pool-a', 'claude-b');
    writeLimits('claude-b', 99, 99);
    writeLimits('claude', 1, 1);            // an in-pool account IS free
    const marker = reg(`${ID}.crosspool`);
    fs.rmSync(marker); fs.mkdirSync(marker);   // unreadable at every uid
    tick(BLOCKED);
    const stranded = String(h.reg(ID, 'stranded'));
    expect(stranded, 'it strands — silence would be the other half of R1')
      .toMatch(/^\d{10} the crossing record could not be read/);
    expect(stranded, 'and it must NOT claim nobody could take it')
      .not.toContain('no account in pool');
    expect(h.calls().join('\n'), 'and nothing is dispatched off an unread crossing')
      .not.toContain('dispatch');
  });
});

describe('R4 — the observability of standing still is itself pinned', () => {
  it('`_tick_undecidable` is silent and harmless when its own log cannot be written', () => {
    // WHAT THIS CASE MEASURES, AND WHAT IT DOES NOT — said out loud because the
    // first version of it measured NOTHING. It asserted that the line is
    // written "even when the stamp cannot be written", over a fixture in which
    // the stamp wrote perfectly well; the mutation it was written for left the
    // suite green. Measured, then rewritten. The ornamental-assertion class
    // again, in the case added to close a review finding about observability.
    //
    // What IS falsifiable here: `_tick_undecidable` runs inside the 5-second
    // supervise loop, so when its append cannot land it must fail QUIETLY —
    // otherwise every row in that state emits shell errors into the supervise
    // journal on every tick, which is the review's "three new stderr lines per
    // row per tick" and is strictly worse than the silence it replaces.
    //
    // A DIRECTORY at `swap.log`: the append fails with EISDIR at every uid,
    // including root, so this needs no `skipIf`.
    // STDERR IS CAPTURED TO A FILE, not read off `shFail` — measured, and this
    // is the third assertion today that turned out to be structurally
    // unfalsifiable: `shFail`'s SUCCESS branch hard-codes `stderr: ''`
    // (`ccdWsHelpers`-shaped helper, defined above), so
    // `expect(r.stderr).toBe('')` is true for every command that exits 0,
    // whatever it printed. A redirect inside the snippet is the only place the
    // real bytes exist.
    seedRow();
    const log = reg('swap.log');
    fs.rmSync(log, { force: true });
    fs.mkdirSync(log);
    const errFile = path.join(h.home, 'tick-err');
    const out = h.sh(`_tick_undecidable ${ID} wrapper 2>"${errFile}"; echo "rc=$?"`);
    expect(fs.readFileSync(errFile, 'utf8'),
      'no shell noise into the supervise journal, every tick, per row').toBe('');
    expect(out, 'and it never fails the tick around it').toBe('rc=0');
    fs.rmdirSync(log);
  });

  it('the debounce holds: one line per episode, not one per tick', () => {
    seedRow();
    h.sh(`_tick_undecidable ${ID} wrapper`);
    const once = swapLog().split('\n').filter((l) => l.includes('tick-undecidable')).length;
    expect(once, 'the first call says it').toBe(1);
    h.sh(`_tick_undecidable ${ID} wrapper; _tick_undecidable ${ID} wrapper`);
    expect(swapLog().split('\n').filter((l) => l.includes('tick-undecidable')).length,
      'and the stamp the first one left silences the rest of the episode').toBe(once);
    h.sh(`_tick_decided ${ID}`);
    h.sh(`_tick_undecidable ${ID} wrapper`);
    expect(swapLog().split('\n').filter((l) => l.includes('tick-undecidable')).length,
      'a decided tick ends the episode, and the next one is announced again').toBe(once + 1);
  });

  it('`_reg_read` refuses a FIFO on a TYPE check — it never opens one', () => {
    // `_reg_read` runs inside the `cmd_supervise` loop. `cat` on a FIFO with
    // no writer blocks in `open(2)` forever: no exit code, no stdout, a
    // supervisor hung permanently. `_project_pool_state` already carries this
    // precondition and the paragraph arguing it; `_reg_read` copied that
    // function's level ORDER and dropped its loudest guard. The 5s timeout is
    // the assertion: without the type check this call never returns.
    seedRow();
    const p = reg(`${ID}.wrapper`);
    fs.rmSync(p, { force: true });
    execFileSync('mkfifo', [p]);
    // `timeout 5` in a CHILD shell, so a regression fails this case in five
    // seconds with rc 124 instead of wedging the whole suite — the failure mode
    // is a hang, and a test for a hang must not be able to hang.
    const out = h.sh(`timeout 5 bash -c 'source "${CCD}"; _reg_read ${ID} wrapper'; echo "rc=$?"`);
    expect(out, 'a FIFO is UNREADABLE, decided without opening it (124 = it hung)')
      .toBe('rc=2');
  });
});

describe('the SECOND crossing read in `_swap_target` is guarded too', () => {
  it('the SECOND crossing read is guarded too — a hiccup between the two is a moment, not a state', () => {
    // THE ROW THAT CLAIMED A CENSUS AND MEASURED HALF OF IT (#67 review).
    // `_swap_target` asks `_crosspool_valid` twice — once about `cur`, once
    // about `home` — and C1's mutation table covered both `return` lines as
    // one row. Deleting the SECOND alone leaves the suite green: all three
    // reds came from the first. A permission hiccup between two reads a
    // microsecond apart is a MOMENT, not a state, so the second arm is
    // genuinely reachable and was genuinely unpinned.
    //
    // The `FLIP` shadow this file already uses for `_crosspool_tick` is the
    // only way to build the flip deterministically — here inverted: the first
    // read must SUCCEED and the second must fail.
    seedRow('claude-b'); tagPool('demo', 'pool-a');
    crossed('pool-a', 'claude-b');
    const SECOND_FAILS = `
      eval "_reg_read_orig() $(declare -f _reg_read | tail -n +2)";
      _reg_read() {
        if [[ "\${2:-}" == crosspool ]]; then
          if [[ -e "$HOME/first-done" ]]; then return 2; fi
          : > "$HOME/first-done"
        fi
        _reg_read_orig "$@"
      };
    `;
    expect(h.sh(`${SECOND_FAILS} _swap_target ${ID} claude-b claude; echo "rc=$?"`),
      'the second read failed, so nobody can say — and it must say so as rc 2')
      .toBe('rc=2');
  });
});
