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

  it.each(['fifo', 'directory', 'devzero-symlink', 'dangling-symlink'])(
    'refuses when the PROJECT FIELD itself cannot be read (%s) — the verb half of R3', (shape) => {
      // THE HALF ROUND 3 LEFT. It converted the tick's two `.project` reads and
      // left the VERBS — and the verbs are the half a PWA tap reaches. `_reg_get`
      // folds UNREADABLE into `""`, `_project_pool_state ""` answers `untagged`,
      // and `untagged` is the ONE state `_pool_ok` admits every account under —
      // so both `die` arms were skipped and the session moved out of its pool
      // silently, with no crossing marker.
      //
      // THREE OF THESE SHAPES ALREADY DID THIS ON `origin/main`; two could not,
      // because they HUNG instead. This branch's `-f` on `_reg_get` turned those
      // two hangs into the same silent move — so it widened the hole from three
      // shapes to five rather than opening it. Said here because the first draft
      // of the fix's own comment claimed the branch created all five, and that is
      // false for three of them.
      const mdir = seedRow(); plant('.claude', mdir, 'HISTORY\n'); tagPool('demo', 'pool-a');
      const p = reg(`${ID}.project`);
      fs.rmSync(p, { force: true, recursive: true });
      if (shape === 'fifo') execFileSync('mkfifo', [p]);
      else if (shape === 'directory') fs.mkdirSync(p);
      else if (shape === 'devzero-symlink') fs.symlinkSync('/dev/zero', p);
      else fs.symlinkSync('/nonexistent/nowhere', p);

      const r = shFail(`${SWAP_STUBS} cmd_swap ${ID} claude-b`, { TMUX: '' });
      expect(r.code, `${shape}: the verb refuses`).not.toBe(0);
      expect(r.stderr, 'and names the FIELD, not the pool tag')
        .toContain(`the project field for ${ID} could not be read`);
      expect(h.reg(ID, 'wrapper'), 'the session did not move').toBe('claude');
      expect(h.reg(ID, 'crosspool'), 'and no crossing was recorded').toBeNull();
      fs.rmSync(p, { force: true, recursive: true });
    });

  it('the flag does not override it either — there is no pool X to cross FROM', () => {
    const mdir = seedRow(); plant('.claude', mdir, 'HISTORY\n'); tagPool('demo', 'pool-a');
    const p = reg(`${ID}.project`);
    fs.rmSync(p, { force: true }); fs.mkdirSync(p);
    const r = shFail(`${SWAP_STUBS} cmd_swap --cross-pool ${ID} claude-b`, { TMUX: '' });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(`the project field for ${ID} could not be read`);
    expect(h.reg(ID, 'wrapper')).toBe('claude');
    fs.rmSync(p, { recursive: true });
  });

  it('but an UNTAGGABLE box still swaps — the same gate the tick carries', () => {
    // The regression guard, in the opposite direction. With no `pools/` at all,
    // `_project_pool_state` answers `untagged` for every name, so the unread
    // field could not have changed the verdict — and refusing there would break
    // the one relocation verb on every box that never tagged a project.
    const mdir = seedRow(); plant('.claude', mdir, 'HISTORY\n');
    expect(fs.existsSync(reg('pools')), 'this case is about a box with no pools').toBe(false);
    const p = reg(`${ID}.project`);
    fs.rmSync(p, { force: true }); fs.mkdirSync(p);
    const r = shFail(`${SWAP_STUBS} cmd_swap ${ID} claude-b`, { TMUX: '' });
    expect(r.code, 'the swap still happens').toBe(0);
    expect(h.reg(ID, 'wrapper')).toBe('claude-b');
    fs.rmSync(p, { recursive: true });
  });

  it('`cmd_prefer` carries it too — it rewrites `.home`, so it PINS a session out of pool', () => {
    const mdir = seedRow(); plant('.claude', mdir, 'HISTORY\n'); tagPool('demo', 'pool-a');
    const p = reg(`${ID}.project`);
    fs.rmSync(p, { force: true }); fs.mkdirSync(p);
    const r = shFail(`${SWAP_STUBS} cmd_prefer ${ID} claude-b`, { TMUX: '' });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(`the project field for ${ID} could not be read`);
    expect(h.reg(ID, 'home'), 'the home was not re-pinned').toBe('claude');
    fs.rmSync(p, { recursive: true });
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
      .toMatch(/^\d{10} the row's own account field could not be measured/);
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

// ─────────────────────────────────────────────────────────────────────────────
// The #69 review's round. Five lenses on the C1 follow-up, every finding then
// handed to a separate refute pass; twelve reproduced here before anything was
// changed, and one — the per-tick `tmux capture-pane` cost — killed by that
// reproduction (`_auto_compact_check` already captures unconditionally on the
// same row, so the lane doubles a cost it does not introduce; and both proposed
// remedies measured as defects). Every case below is one that went RED against
// PR #69 exactly as shipped.
const NOPANE = `
  tmux() { case "\${1:-}" in
             capture-pane) : ;;
             list-panes)   echo ${PANE_PID} ;;
           esac; return 0; };
  _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };
`;

describe('S1 — the pool tag gets the third answer too, and the strand says which', () => {
  const undecidableTag = (): void => {
    // A DIRECTORY at the tag path: `cat` refuses with EISDIR at every uid, so
    // no `skipIf`, and `_project_pool_state` answers `unreadable`.
    const p = reg(`pools/demo`);
    fs.rmSync(p, { force: true });
    fs.mkdirSync(p, { recursive: true });
  };

  it('CONTROL — a readable tag rescues onto the in-pool account', () => {
    // The control is what proves the fixture is CAPABLE of a rescue, so a red
    // below is the fold and not the setup. Without it the two cases that follow
    // would pass over a fixture that could never have dispatched anything.
    seedRow(); tagPool('demo', 'pool-a'); plantNotify();
    writeLimits('claude', 99, 99);
    writeLimits('claude-a', 1, 1);
    tick(BLOCKED);
    expect(h.calls().join('\n')).toContain(`dispatch ${ID} -> claude-a`);
    expect(noticeLines(), 'and nothing is announced').toHaveLength(0);
  });

  it('an UNREADABLE tag stands still — and never claims nobody could take it', () => {
    // THE FABRICATED SENTENCE. Before this round the caller wrote
    //   "…is blocked on claude and no account in pool (untagged) can take it"
    // with `claude-a` sitting free at 1/1. BOTH halves are false: the project
    // IS tagged `pool-a` — `(untagged)` is `_strand_mark`'s `pdesc` default
    // folding `unreadable` into untagged — and nobody found any account unable
    // to take it, because nobody decided.
    //
    // STANDING STILL IS STILL RIGHT. This case does NOT assert a rescue: on an
    // undecidable tag, refusing to place is the ruled-correct safe side, and
    // "fixing" the candidate loop to treat rc 2 as a pass would silently lift
    // the constraint. Only the sentence changes.
    seedRow(); tagPool('demo', 'pool-a'); plantNotify();
    writeLimits('claude', 99, 99);
    writeLimits('claude-a', 1, 1);
    undecidableTag();
    tick(BLOCKED);
    const notice = noticeLines().join('\n');
    expect(notice, 'it must not claim a census it never took').not.toContain('no account in pool');
    expect(notice, 'and it must not call a tagged project untagged').not.toContain('(untagged)');
    expect(notice, 'it names the condition and the file').toContain('pool tag could not be read');
    expect(swapLog(), 'and the stand-still is said on the box too')
      .toContain(`tick-undecidable ${ID}: pool`);
    expect(h.calls().join('\n'), 'nothing is placed on an unread constraint').not.toContain('dispatch');
  });

  it('a MALFORMED tag is the same answer — and needs no directory trick', () => {
    // An ORDINARY file whose bytes are not a legal token: reachable by a 2am
    // `echo` and by no privilege at all, which is why it is worth its own case
    // beside the EISDIR one.
    seedRow(); tagPool('demo', 'Pool Orate'); plantNotify();
    writeLimits('claude', 99, 99);
    writeLimits('claude-a', 1, 1);
    tick(BLOCKED);
    expect(noticeLines().join('\n')).not.toContain('no account in pool');
    expect(noticeLines().join('\n')).toContain('pool tag could not be read');
  });
});

describe('S2 — the marker follows the truth, from BOTH of the tick’s exits', () => {
  const unreadable = (field: string): string => {
    const p = reg(`${ID}.${field}`);
    fs.rmSync(p, { force: true });
    fs.mkdirSync(p);
    return p;
  };

  it('a strand set on the wrapper path CLEARS when the pane recovers', () => {
    // The coordinator proved this one before the review returned. The caller
    // returns at the `wrapper` guard ABOVE the tick's only automatic
    // healthy-pane clear, so the marker could be set from that path and never
    // retracted by it — a durable positive claim that only a human verb could
    // take back.
    seedRow(); plantNotify();
    writeLimits('claude', 99, 99);
    unreadable('wrapper');
    tick(BLOCKED);
    expect(String(h.reg(ID, 'stranded')), 'precondition: it stranded')
      .toMatch(/^\d{10} the row's own account field could not be measured/);
    tick(QUIET, 5);
    expect(h.reg(ID, 'stranded'), 'a recovered pane must not still claim STRANDED').toBeNull();
    expect(logLines('unstranded'), 'and it is said ONCE, not once per tick').toHaveLength(1);
  });

  it('an UNMEASURABLE pane clears nothing — the clear must not move one line up', () => {
    // The other half, and the reason the clear sits on the classifier rather
    // than on the capture. An empty capture is a pane nobody could read;
    // clearing there would be the fabricated clear C1 exists to prevent.
    seedRow(); plantNotify();
    writeLimits('claude', 99, 99);
    unreadable('wrapper');
    tick(BLOCKED);
    const first = String(h.reg(ID, 'stranded'));
    tick(NOPANE, 3);
    expect(String(h.reg(ID, 'stranded')), 'an unread pane retracts nothing').toBe(first);
  });

  it('and a LATER genuine strand is sayable again — the debounce no longer swallows it', () => {
    // THE CONSEQUENCE AN OPERATOR FEELS, and the half the original finding
    // understated. With a stale marker standing, `_strand_mark`'s
    // `[[ ! -e … ]]` debounce swallowed every later real strand on that row:
    // the commit whose thesis is that standing still must be SAID had made a
    // class of standing-still permanently unsayable.
    seedRow(); plantNotify();
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) writeLimits(w, 99, 99);
    unreadable('wrapper');
    tick(BLOCKED);
    tick(QUIET);
    fs.rmSync(reg(`${ID}.wrapper`), { recursive: true, force: true });
    h.sh(`_reg_set ${ID} wrapper claude`);
    tick(BLOCKED);
    expect(logLines('stranded'), 'two episodes, two lines').toHaveLength(2);
    expect(String(h.reg(ID, 'stranded')), 'and the marker names the CURRENT cause')
      .not.toContain('account field could not be measured');
  });
});

describe('S5 — the guards the last round shipped unpinned', () => {
  it('…but NOT when the pane is merely quiet — an unread CROSSING is not a strand', () => {
    // R2's arm shipped with `[[ -n "$hard_blocked" ]]` and nothing measuring
    // it: delete that guard and a healthy idle session is stranded, with the
    // whole 1662-case ccd sweep green. rc 2 says "nobody can say" about a
    // DESTINATION; it says nothing at all about the session. This is R1's own
    // quiet-pane discipline, applied to the sibling condition.
    seedRow('claude-b'); tagPool('demo', 'pool-a'); plantNotify();
    crossed('pool-a', 'claude-b');
    writeLimits('claude-b', 99, 99);
    writeLimits('claude', 1, 1);
    const marker = reg(`${ID}.crosspool`);
    fs.rmSync(marker); fs.mkdirSync(marker);
    tick(QUIET);
    expect(h.reg(ID, 'stranded'), 'a quiet pane is not stranded').toBeNull();
    expect(noticeLines(), 'and nothing is announced').toHaveLength(0);
  });

  it('the debounce holds THROUGH THE TICK: an unmeasurable `.home` says it once', () => {
    // WHAT THE HELPER-LEVEL CASE CANNOT SEE. The R4 case above calls
    // `_tick_undecidable`/`_tick_decided` by hand, so it pins the stamp and
    // nothing about WHO calls which. The row's verdict is decided in
    // `_auto_swap_check`: `ctrc` is INITIALISED to 2 — `_crosspool_tick`'s own
    // "nobody can say" — because on an unmeasurable `.home` the crossing tick
    // is SKIPPED and no answer was produced. Initialise it to 1 instead and the
    // row claims a MEASURED "no crossing stands": the verdict line takes its
    // `else`, `_tick_decided` deletes the stamp the `home` arm wrote three
    // lines earlier, and the next tick re-writes and re-logs — 720 lines an
    // hour per stuck row, the exact storm D-1995 exists to prevent.
    seedRow(); tagPool('demo', 'pool-a');
    const p = reg(`${ID}.home`);
    fs.rmSync(p, { force: true }); fs.mkdirSync(p);
    tick(QUIET, 5);
    expect(logLines('tick-undecidable'), 'once per episode, not once per tick').toHaveLength(1);
    expect(String(h.reg(ID, 'tickstuck')), 'and the stamp names the field').toContain('home');
  });
});

describe('S3 — the type check reaches `_reg_get` too, not just its measured sibling', () => {
  it('every non-regular field type answers instead of blocking, through BOTH readers', () => {
    // C1 closed the hang for `_reg_read` and then added a new unguarded read to
    // the supervise loop through `_reg_get` — so the class was half closed, and
    // the half left open is the one with 135 call sites. `timeout` in a child
    // shell is the assertion: a test for a hang must not be able to hang.
    seedRow();
    const cases: Array<[string, () => void]> = [
      ['fifo', () => execFileSync('mkfifo', [reg(`${ID}.project`)])],
      ['devzero-symlink', () => fs.symlinkSync('/dev/zero', reg(`${ID}.project`))],
      ['directory', () => fs.mkdirSync(reg(`${ID}.project`))],
    ];
    for (const [name, make] of cases) {
      fs.rmSync(reg(`${ID}.project`), { force: true, recursive: true });
      make();
      const out = h.sh(
        `timeout 5 bash -c 'source "${CCD}"; _reg_get ${ID} project'; echo "rc=$?"`);
      expect(out, `${name}: answered, and rc 124 would mean it hung`).toBe('rc=1');
    }
    fs.rmSync(reg(`${ID}.project`), { force: true, recursive: true });
  });

  it('every input that answered before answers the same VALUE, and one rc moves', () => {
    // The widening adds no distinction and narrows none — that is what makes it
    // safe across 133 call sites, and it is the half worth pinning, because it
    // is the half a future reader will doubt.
    //
    // RETITLED AND RE-ASSERTED (#69 review round 3). This case was called "and
    // every input that answered before still answers the SAME", and its own
    // last assertion measured an input that does NOT: `cat /dev/null` exits 0,
    // so `/dev/null` went rc 0 -> rc 1 when the type check landed. The message
    // said it had been "refused on content before" — it was not refused at all.
    // A case whose title certifies a history its own assertion contradicts is
    // worse than no case: the next person to make `_reg_get`'s exit status mean
    // something reads the title, trusts it, and reasons from a baseline the
    // suite has already measured as false. What is TRUE, and is what licenses
    // the change fleet-wide, is that the VALUE is unchanged for all five and no
    // call site can see the status — pinned separately below.
    seedRow();
    const f = reg(`${ID}.project`);
    fs.writeFileSync(f, 'demo');
    expect(h.sh(`_reg_get ${ID} project`), 'a regular file reads').toBe('demo');
    fs.rmSync(f);
    expect(h.sh(`_reg_get ${ID} project; echo "rc=$?"`), 'absent is empty, rc 1').toBe('rc=1');
    fs.symlinkSync('/nonexistent/nowhere', f);
    expect(h.sh(`_reg_get ${ID} project; echo "rc=$?"`), 'a dangling symlink is empty').toBe('rc=1');
    fs.rmSync(f);
    fs.symlinkSync('/dev/null', f);
    expect(h.sh(`printf '[%s]' "$(_reg_get ${ID} project)"`),
      '/dev/null answers the empty string, exactly as it did before the type check')
      .toBe('[]');
    expect(h.sh(`_reg_get ${ID} project; echo "rc=$?"`),
      '/dev/null is the ONE input whose rc moved: cat exits 0, the -f guard returns 1')
      .toBe('rc=1');
    fs.rmSync(f);
  });

  it('no call site can see that rc — which is what licenses the change, not the inputs', () => {
    // THE MEASURED PROPERTY THAT REPLACES A FALSE ONE (#69 review round 3).
    // `_reg_get`'s comment argued its own safety from the INPUTS ("rc 1 either
    // way"), and one of the five named inputs falsifies it. The argument that
    // actually holds is about the CALLERS, and unlike the other it is
    // measurable: every invocation is a `$(…)` capture whose status nothing
    // reads. Pin it here so the first rc-consuming caller reds this case and
    // inherits the duty, rather than inheriting a sentence.
    const src = fs.readFileSync(CCD, 'utf8');
    const lines = src.split('\n')
      .filter((l) => l.includes('_reg_get "') && !l.trim().startsWith('#'));
    expect(lines.length, 'the census moved; re-measure the comment too')
      .toBeGreaterThan(100);
    const outsideCapture = lines.filter((l) => !/\$\(_reg_get "/.test(l));
    expect(outsideCapture, 'an invocation outside a capture COULD branch on the rc')
      .toEqual([]);
    const rcReaders = lines.filter((l) => /=\$\(_reg_get "[^)]*\)\s*(\|\||&&)/.test(l));
    expect(rcReaders, 'an assignment followed by || or && branches on the rc')
      .toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// #69 REVIEW ROUND 3. Every case below reds on the round-2 tree, and each red
// names the condition it is about — the discipline this series keeps failing
// at is not "write a test", it is "write a test whose red is not about
// something adjacent". Where a case discriminates against TWO wrong fixes
// (round 2's storm and the obvious over-correction into silence), it says so.
// ───────────────────────────────────────────────────────────────────────────

const calls = (): string =>
  fs.existsSync(path.join(h.home, 'ccd-calls'))
    ? fs.readFileSync(path.join(h.home, 'ccd-calls'), 'utf8') : '';

/** An UNREADABLE pool tag, built the root-safe way (D-1997): a directory is
 *  refused with EISDIR at every uid, where `chmod 000` is not. */
const undecidablePoolTag = (project = 'demo'): void => {
  fs.mkdirSync(reg('pools'), { recursive: true });
  const f = path.join(reg('pools'), project);
  fs.rmSync(f, { force: true, recursive: true });
  fs.mkdirSync(f);
};

describe('R1 — the tick takes ONE verdict, once every read has answered', () => {
  it('an undecidable POOL TAG says it once per episode, not once per tick', () => {
    // ROUND 2's REGRESSION, MEASURED. The verdict sat 108 lines above the pool
    // answer and cleared the stamp on every tick where the CROSSING read
    // decided — which is every row with no crossing marker, i.e. every row on
    // the box. The `strc == 2` arm then re-wrote it. One `swap.log` append, one
    // `_reg_set` (tmp write + atomic rename) and one `rm` per row per five
    // seconds, for ever, into an unrotated file — and on a HEALTHY QUIET pane,
    // because `_strand_mark` is gated on `hard_blocked` and the tick's voice
    // is not. Reverting the verdict's move reds this at 5.
    seedRow(); undecidablePoolTag();
    tick(QUIET, 5);
    expect(logLines('tick-undecidable'), 'once per episode, not once per tick')
      .toHaveLength(1);
    expect(logLines('tick-undecidable')[0], 'and it names the POOL, not the crossing')
      .toContain('pool could not be measured');
    expect(String(h.reg(ID, 'tickstuck')).split(' ')[1], 'the stamp names the field it is about')
      .toBe('pool');
    expect(noticeLines(), 'a quiet pane is announced to nobody').toHaveLength(0);
  });

  it('a CHANGED condition is said; the same one is not — and that discriminates both ways', () => {
    // THE CASE THAT KILLS THE OBVIOUS OVER-CORRECTION. Moving the verdict alone
    // is not enough: the debounce tested bare EXISTENCE, so the first condition
    // of a row silenced every later one for as long as the stamp stood, and
    // `ccd` never re-chmods a registry file. Here `.home` goes unreadable, then
    // recovers onto an unreadable POOL TAG — two real episodes, one after the
    // other. Round 2's tree reds this at 4 (the storm); a fix that only hoists
    // the verdict reds it at 1 (the swallow), with the stamp still naming a
    // condition that ended. Only a debounce that compares the FIELD gives 2.
    seedRow(); undecidablePoolTag();
    const home = reg(`${ID}.home`);
    fs.rmSync(home, { force: true }); fs.mkdirSync(home);
    tick(QUIET, 3);
    expect(logLines('tick-undecidable'), 'episode one, said once').toHaveLength(1);
    expect(String(h.reg(ID, 'tickstuck'))).toContain('home');

    fs.rmSync(home, { recursive: true }); fs.writeFileSync(home, 'claude');
    tick(QUIET, 3);
    const said = logLines('tick-undecidable');
    expect(said, 'the second episode is a DIFFERENT condition and gets its own line')
      .toHaveLength(2);
    expect(said[0], 'first the home').toContain('home could not be measured');
    expect(said[1], 'then the pool — not a repeat of the home').toContain('pool could not be measured');
    expect(String(h.reg(ID, 'tickstuck')).split(' ')[1], 'and the stamp follows the truth')
      .toBe('pool');
  });

  it('the clear is gated on the verdict, not on `_swap_target` having answered', () => {
    // MY OWN REGRESSION, CAUGHT BY THE SUITE WHILE THIS FIX WAS BEING WRITTEN.
    // An `hrc` 2 row still reaches the bottom of the tick with a perfectly good
    // destination — `_swap_target` skips the home arm and ranks the pool loop
    // instead — so a clear placed there and NOT gated on the verdict retracts,
    // every tick, the stamp the verdict just wrote. Five ticks, five lines: the
    // storm being removed, reintroduced 100 lines below its own removal.
    seedRow('claude-b'); plantNotify();
    writeLimits('claude-b', 1, 1); writeLimits('claude', 1, 1);
    const home = reg(`${ID}.home`);
    fs.rmSync(home, { force: true }); fs.mkdirSync(home);
    tick(QUIET, 5);
    expect(logLines('tick-undecidable'), 'one line, whatever `_swap_target` found')
      .toHaveLength(1);
    expect(String(h.reg(ID, 'tickstuck'))).toContain('home');
  });

  it('and a row that decides clears the stamp, so the NEXT episode is said too', () => {
    // The other half of the same guard: if the clear never fires, one episode
    // per row per lifetime is all `swap.log` ever gets. Delete the clear and
    // this reds at 1.
    seedRow(); undecidablePoolTag();
    tick(QUIET, 2);
    expect(logLines('tick-undecidable')).toHaveLength(1);
    fs.rmSync(path.join(reg('pools'), 'demo'), { recursive: true });
    fs.writeFileSync(path.join(reg('pools'), 'demo'), 'pool-a');
    tick(QUIET, 2);
    expect(h.reg(ID, 'tickstuck'), 'a decided row carries no stamp').toBeNull();
    undecidablePoolTag();
    tick(QUIET, 2);
    expect(logLines('tick-undecidable'), 'a NEW episode of the same condition is said again')
      .toHaveLength(2);
  });
});

describe('R2 — the FIFO hang class, closed on the whole tick and not just one reader', () => {
  it('`_authdead` answers instead of blocking, and answers the SAME for every input that answered', () => {
    // NOT COVERED BY ROUND 2's `_reg_get` GUARD, and that is the finding: this
    // path is the DOTLESS `$REG/<account>-authdead`, not `$REG/<id>.<field>`.
    // Both call sites are inside ACCOUNT loops on the tick, so one bad file
    // wedges every row that reaches the loop. `timeout` in a child shell is the
    // assertion — a test for a hang must not be able to hang.
    seedRow();
    const f = reg('claude-authdead');
    const rc = (): string =>
      h.sh(`timeout 5 bash -c 'source "${CCD}"; _authdead claude'; echo "rc=$?"`);

    execFileSync('mkfifo', [f]);
    expect(rc(), 'a FIFO with no writer: answered, and rc 124 would mean it hung').toBe('rc=1');
    fs.rmSync(f);
    fs.symlinkSync('/dev/zero', f);
    expect(rc(), 'an unbounded character device: answered').toBe('rc=1');
    fs.rmSync(f);

    // The inputs that answered before must answer identically, or this is a
    // narrowing rather than a type check.
    expect(rc(), 'absent').toBe('rc=1');
    fs.writeFileSync(f, '');
    expect(rc(), 'empty is not a verdict').toBe('rc=1');
    fs.writeFileSync(f, 'garbage');
    expect(rc(), 'a torn marker is not a verdict').toBe('rc=1');
    fs.writeFileSync(f, '1700000000 lost-auth');
    expect(rc(), 'a well-formed marker still condemns').toBe('rc=0');
    fs.rmSync(f);
    fs.mkdirSync(f);
    expect(rc(), 'a directory').toBe('rc=1');
    fs.rmSync(f, { recursive: true });
  });

  it('the session-status file is typed before it is grepped, on the compact lane', () => {
    // `grep FILE` opens by name and blocks for ever on a FIFO, inside the same
    // 5-second tick — the identical class, at a read `_reg_get`'s guard cannot
    // see because it is not a registry field at all. Behaviour-identical for
    // every input that answers today: absent, a directory and `/dev/null` all
    // make grep produce nothing and the lane returns on the line below.
    seedRow();
    const pane = 'ctx ▓▓▓▓ 80%\\n❯ ';
    const stubs = `
      tmux() { case "\${1:-}" in
                 capture-pane) printf '%s\\n' "${pane}" ;;
                 list-panes)   echo ${PANE_PID} ;;
               esac; return 0; };
      _dispatch_compact() { echo "compact $1" >> "$HOME/ccd-calls"; };`;
    const sfDir = h.sh(`printf '%s' "$(_cfg_dir claude)/sessions"`);
    fs.mkdirSync(sfDir, { recursive: true });
    const sf = path.join(sfDir, `${PANE_PID}.json`);

    execFileSync('mkfifo', [sf]);
    const out = h.sh(
      `timeout 5 bash -c 'source "${CCD}"; ${stubs} _auto_compact_check ${ID}'; echo "rc=$?"`);
    expect(out, 'a FIFO status file: the lane returns, and rc 124 would mean it hung')
      .toContain('rc=0');
    expect(calls(), 'and it compacts nothing off a file it could not read').not.toContain('compact');
    fs.rmSync(sf);
  });

  it('and it says WHICH — an absent status file and an unopenable one are different sentences', () => {
    // THE MERGE WITH #70 IS WHAT MADE THIS A DISTINCTION WORTH KEEPING. On the
    // pre-merge tree the line below the guard only returned, so folding every
    // failure into `|| return 0` was genuinely behaviour-identical and the
    // guard's own comment said so. #70 turned that line into a
    // `status-unreadable` note — and the first spelling of this guard then
    // narrowed a distinction it had received, silently, for exactly the inputs
    // it newly admits. `ccd-auto-compact.test.ts`'s case caught it, and its
    // second spelling reported "not a regular file" about a file that was
    // simply ABSENT, which is a false sentence.
    //
    // Both conditions keep the same NOTE WORD — neither says anything about
    // idleness — and get their own detail, because "there is no file" and
    // "there is something here I refuse to open" send an operator to different
    // places. Collapse the `if/elif` to a bare `[[ -f ]] || return 0` and the
    // FIFO case below reds with no note at all.
    seedRow();
    const pane = 'ctx ▓▓▓▓ 80%\n❯ ';
    const stubs = `
      tmux() { case "\${1:-}" in
                 capture-pane) printf '%s\\n' "${pane}" ;;
                 list-panes)   echo ${PANE_PID} ;;
               esac; return 0; };
      _dispatch_compact() { echo "compact $1" >> "$HOME/ccd-calls"; };`;
    const sfDir = h.sh(`printf '%s' "$(_cfg_dir claude)/sessions"`);
    fs.mkdirSync(sfDir, { recursive: true });
    const sf = path.join(sfDir, `${PANE_PID}.json`);
    // THE FIELD is `compactskip` (`<epoch> <reason>`); the DETAIL goes only to
    // swap.log, behind `_compact_note`'s own `COMPACT_NOTE_FLOOR`. So the floor
    // stamp is cleared between the two phases — otherwise the second sentence
    // is debounced away and this case would pass by measuring nothing.
    const skip = (): string => String(h.reg(ID, 'compactskip') ?? '');
    const lastSkipLine = (): string => logLines('compact-skip').slice(-1)[0] ?? '';

    // A TEST FOR A HANG MUST NOT BE ABLE TO HANG (#69 review round 4 gate).
    // The sibling case 50 lines up says exactly that and bounds its FIFO drive
    // in `timeout 5`; this one planted the same FIFO with a bare `h.sh`, so a
    // regression in the guard wedged the vitest worker instead of failing the
    // case. Measured: deleting the guard produced no summary line after 600 s
    // and two live `_auto_compact_check` processes, and the run had to be
    // SIGKILLed. The stubs go to a FILE rather than into the nested `bash -c`
    // string — they carry both quote characters, and a `timeout 5 bash -c '…'`
    // wrapper around them would have to reason about which quote closes what.
    const stubFile = path.join(h.home, 'compact-stubs.sh');
    fs.writeFileSync(stubFile, stubs);
    const drive = (): string => h.sh(
      `timeout 5 bash -c 'source "${CCD}"; source "${stubFile}"; _auto_compact_check ${ID}'`
      + `; echo "rc=$?"`);

    // ABSENT — byte-identical to what the lane says with no guard at all.
    fs.rmSync(sf, { force: true });
    expect(drive(), 'absent: the lane returns rather than hanging').toContain('rc=0');
    expect(skip(), 'absent: the field is status-unreadable, never not-idle')
      .toContain('status-unreadable');
    expect(lastSkipLine(), 'and the sentence says there is no status there')
      .toContain('no status in');

    // NON-REGULAR — the same field, a different sentence.
    fs.rmSync(reg(`${ID}.compactnote`), { force: true });
    execFileSync('mkfifo', [sf]);
    expect(drive(), 'a FIFO: rc 124 here would mean the guard let it block')
      .toContain('rc=0');
    expect(skip(), 'a FIFO: still status-unreadable, never not-idle')
      .toContain('status-unreadable');
    expect(lastSkipLine(), 'and the sentence names what was actually measured')
      .toContain('not a regular file');
    fs.rmSync(sf);
  });
});

describe('B4 — the guards this round shipped that nothing could red', () => {
  // MEASURED, NOT ASSUMED: eight guards were mutated one at a time against the
  // four ccd pool suites. Four already redded (`_swap_target`'s project guard,
  // the verdict's `hrc` and `prc` lines, `_pool_untaggable`'s `-L` half); the
  // four below did not, and each guards a condition measured to hang, storm or
  // silence a row. "A comment is a request; a red suite is a mechanism."

  it('an UNREADABLE `.tickstuck` is not read as "no stamp" — that would storm', () => {
    // `_tick_undecidable` reads the stamp through `_reg_read` precisely so that
    // rc 2 can mean ALREADY-SAID. Fold it into "absent" and the debounce is
    // defeated through the fold instead of through the clear: the row writes a
    // line and a registry cycle every five seconds, in exactly the condition the
    // function exists to report. The stamp is a DIRECTORY here, the root-safe
    // unreadability this tree uses (D-1997).
    seedRow(); plantNotify();
    undecidablePoolTag();
    const stamp = reg(`${ID}.tickstuck`);
    fs.rmSync(stamp, { force: true }); fs.mkdirSync(stamp);
    tick(QUIET, 4);
    expect(logLines('tick-undecidable'),
      'an unreadable stamp answers ALREADY-SAID — four ticks, no line').toHaveLength(0);
    fs.rmSync(stamp, { recursive: true });
  });

  it('the SWAP lane types its status file too — deleting that rung hangs the tick', () => {
    // The compact lane's copy is pinned by "and it says WHICH"; this one was
    // not, and its guard is the one that stops a FIFO wedging the supervisor.
    // Reaching it needs the AFFINITY path — a row off its home with the home
    // available — because the read sits below the rescue arms, which is why no
    // earlier case touched it.
    // `seedRow` sets home AND wrapper to the same account, so `_swap_target`
    // takes its "home is fine: stay" shortcut and the tick returns two hundred
    // lines above the read. The home has to differ, or this case measures the
    // shortcut — measured, the first spelling did exactly that and stayed green
    // under the mutation it names.
    seedRow('claude-b'); plantNotify();
    h.sh(`_reg_set ${ID} home claude`);
    writeLimits('claude-b', 60, 60); writeLimits('claude', 1, 1);
    const sfDir = h.sh(`printf '%s' "$(_cfg_dir claude-b)/sessions"`);
    fs.mkdirSync(sfDir, { recursive: true });
    const sf = path.join(sfDir, `${PANE_PID}.json`);
    execFileSync('mkfifo', [sf]);
    const out = h.sh(
      `timeout 5 bash -c 'source "${CCD}"; ${QUIET} _auto_swap_check ${ID}'; echo "rc=$?"`);
    expect(out, 'a FIFO status file: the lane returns, and rc 124 would mean it hung')
      .toContain('rc=0');
    expect(calls(), 'and it dispatches nothing off a file it could not read')
      .not.toContain('dispatch');
    fs.rmSync(sf);
  });

  it('an unreadable CROSSING RECORD stamps `crosspool` — the verdict line for it', () => {
    // AND THE FIXTURE NEEDS A FRESH `lastswap`, or the case measures nothing.
    // Without it the tick runs on to `_swap_target`, which refuses on the same
    // unreadable record and says `crosspool` from its own arm — so deleting the
    // verdict's `ctrc` line stays GREEN and the two lines look interchangeable.
    // They are not: the verdict runs ABOVE the cooldown gates and the `strc` arm
    // below them, so a row inside `SWAP_COOLDOWN` is reported by the verdict
    // alone. Measured — the first spelling of this case was green under the very
    // mutation it names, which is the "mutually redundant, only a pair-deletion
    // reds" shape the review filed against two other lines here.
    seedRow('claude-b'); tagPool('demo', 'pool-a'); plantNotify();
    crossed('pool-a', 'claude-b');
    const marker = reg(`${ID}.crosspool`);
    fs.rmSync(marker); fs.mkdirSync(marker);
    h.sh(`_reg_set ${ID} lastswap "$(date +%s)"`);
    tick(QUIET, 2);
    expect(String(h.reg(ID, 'tickstuck')), 'the stamp names the crossing record')
      .toContain('crosspool');
    expect(logLines('tick-undecidable')[0], 'and so does the line').toContain('crosspool');
    fs.rmSync(marker, { recursive: true });
  });

  it('`_pool_untaggable` refuses on an UNMEASURABLE registry — it never licenses a guess', () => {
    // The predicate answers "no project here can be in any pool", and it gates
    // every refusal this round added. Its registry-level test is what stops it
    // answering that from a box it could not read: with `$REG` unsearchable the
    // honest answer is rc 1 (something COULD be tagged), never rc 0. Deleting
    // that line makes an unreadable box look like an un-adopted one, which
    // re-opens the constraint lift through the gate meant to bound it.
    seedRow();
    const runOn = (mode: number): string => {
      fs.chmodSync(reg(''), mode);
      try { return h.sh(`_pool_untaggable; echo "rc=$?"`); }
      finally { fs.chmodSync(reg(''), 0o755); }
    };
    expect(h.sh('_pool_untaggable; echo "rc=$?"'), 'no pools dir: nothing can be tagged')
      .toBe('rc=0');
    // a registry that is a FILE, not a directory — the root-safe shape, since
    // `chmod 000` is a no-op for root and this must measure at every uid.
    const regPath = reg('');
    const stash = `${h.home}/reg-stash`;
    fs.renameSync(regPath, stash);
    // MODE 0755, AND THE MODE IS THE MEASUREMENT (#69 review round 4 gate).
    // A 0644 file fails `-x` as well as `-d`, so with `-d` deleted the guard
    // still refused and this fixture could not say WHICH half caught it —
    // measured: dropping `-d` left the whole set green. An EXECUTABLE regular
    // file passes `-x` at every uid, so only `-d` can refuse it.
    fs.writeFileSync(regPath, 'not a directory', { mode: 0o755 });
    expect(h.sh('_pool_untaggable; echo "rc=$?"'),
      'an unmeasurable registry refuses — it does not answer "untaggable"').toBe('rc=1');
    fs.rmSync(regPath); fs.renameSync(stash, regPath);
    // TWO CONDITIONS IN ONE GUARD, AND THE FILE SHAPE ONLY MEASURES ONE (#69
    // review round 4 gate). `[[ -d "$REG" && -x "$REG" ]]` fails for a
    // non-directory AND for a directory nobody may enter; the fixture above
    // kills `-d` only, and `runOn` was BUILT for the `-x` half and then never
    // called — `void runOn` acknowledged the dead code instead of removing the
    // gap. It is called now. The condition is D-1997's: `chmod 000` is a no-op
    // for root, so the only uid-independent shape is the one above, and this
    // half is measured wherever the suite is not root (CI and every dev box).
    if (process.getuid?.() !== 0) {
      expect(runOn(0o000), 'an UNSEARCHABLE registry refuses too — the `-x` half')
        .toBe('rc=1');
    }
  });
});

describe('B2 — the stamp must not stick ON either', () => {
  it('a cooldown gate clears a stamp whose condition ENDED, so the next episode is said', () => {
    // THE INVERSION. Round 2 stormed because the clear ran BEFORE the setter;
    // round 3 moved the clear to the bottom of the tick, below four `return 0`
    // gates — and so a fault that ENDS while one of those gates holds leaves a
    // stale stamp standing, and the debounce then swallows the NEXT genuine
    // episode of that same field for as long as the gate holds. Round 3
    // disclosed a suppressed repeat "inside one cooldown" as the accepted cost;
    // this case is that cost measured, and it is worth closing where closing it
    // is honest.
    //
    // A ROW INSIDE `SWAP_COOLDOWN` DECIDED — that is what a fresh `lastswap`
    // means — so clearing there cannot be a fabricated clear. The empty-pane
    // gate is deliberately NOT given the same treatment: a pane nobody could
    // capture is a row nothing was measured about, and that stamp must stand.
    seedRow(); plantNotify();
    undecidablePoolTag();
    tick(QUIET, 2);
    expect(logLines('tick-undecidable'), 'episode one').toHaveLength(1);

    // the tag is fixed, and the row swaps — so the next ticks return at the
    // cooldown gate, above the clear.
    fs.rmSync(path.join(reg('pools'), 'demo'), { recursive: true });
    fs.writeFileSync(path.join(reg('pools'), 'demo'), 'pool-a');
    h.sh(`_reg_set ${ID} lastswap "$(date +%s)"`);
    tick(QUIET, 2);
    expect(h.reg(ID, 'tickstuck'),
      'the condition ended and the row decided — the stamp must not survive the cooldown')
      .toBeNull();

    // a genuinely NEW episode of the SAME field must now be said again
    undecidablePoolTag();
    tick(QUIET, 2);
    expect(logLines('tick-undecidable'), 'episode two is said, not swallowed').toHaveLength(2);
  });

  it('but an UNCAPTURABLE pane clears nothing — that row was never measured', () => {
    // The other direction, and the reason the cooldown gates are treated
    // differently from the pane gate. An empty capture is a pane nobody could
    // read; clearing on it would be the fabricated clear this whole series
    // exists to prevent, and it is the one gate that can hold indefinitely.
    // THE FIXTURE HAS TO END THE CONDITION FIRST, or the case measures nothing:
    // with the tag still broken the verdict re-sets `$stuck` every tick, so a
    // clear wrongly added at this gate would be gated off anyway and the
    // mutation would pass. Measured — the first spelling of this case did
    // exactly that and stayed green under the very mutation it names.
    seedRow(); plantNotify();
    undecidablePoolTag();
    tick(QUIET, 1);
    expect(String(h.reg(ID, 'tickstuck')).split(' ')[1]).toBe('pool');

    // the tag is fixed — but the pane goes dark before any tick can decide, so
    // nothing about this row is measured from here on.
    fs.rmSync(path.join(reg('pools'), 'demo'), { recursive: true });
    fs.writeFileSync(path.join(reg('pools'), 'demo'), 'pool-a');
    tick(NOPANE, 3);
    expect(String(h.reg(ID, 'tickstuck')).split(' ')[1],
      'a pane nobody could read decides nothing — including that the row recovered')
      .toBe('pool');
    expect(logLines('tick-undecidable'), 'and nothing is re-said').toHaveLength(1);

    // and once the pane IS readable the ordinary clear does its job.
    tick(QUIET, 1);
    expect(h.reg(ID, 'tickstuck'), 'the stamp lifts on the first tick that could measure')
      .toBeNull();
  });
});

describe('B5 — `_swap_target` SAYS which condition it could not decide', () => {
  // ROUND 3 ADDED A FOURTH rc-2 CONDITION AND LEFT THE CALLER GUESSING.
  // `_swap_target` refuses for four distinct reasons; the caller used to
  // re-derive which from `hrc` and `prc` — two measurements of two DIFFERENT
  // moments than the one that actually refused — and defaulted to `crosspool`.
  // The exit code now carries the answer: 2 crossing, 3 the row's `.project`,
  // 4 the pool rule. Crossing KEEPS 2, so every existing rc-2 assertion in this
  // file stays green by construction.
  //
  // The two races below are the reason the inner reads exist at all, so they are
  // the right fixtures: they make the field break BETWEEN the caller's read and
  // `_swap_target`'s own, which is the only way to reach these codes.
  const raceWrapper = (mutate: string): string =>
    `eval "_real_swap_target() $(declare -f _swap_target | tail -n +2)"; `
    + `_swap_target() { ${mutate}; _real_swap_target "$@"; }; `;

  it('a `.project` that breaks INSIDE the tick names the project, not the crossing record', () => {
    // THE DEFECT, VERBATIM: this used to strand naming `.crosspool` — a file the
    // fixture does not even create — and stamp the debounce `crosspool`, so the
    // next genuine crossing episode on the row was swallowed too.
    seedRow(); tagPool('demo', 'pool-a'); plantNotify();
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) writeLimits(w, 99, 99);
    h.sh(`${BLOCKED} ${raceWrapper(`rm -rf "$REG/$1.project"; mkdir -p "$REG/$1.project"`)} `
      + `_auto_swap_check ${ID}`);
    expect(fs.existsSync(reg(`${ID}.crosspool`)),
      'the fixture has no crossing record at all — naming it would be fabricated').toBe(false);
    expect(String(h.reg(ID, 'tickstuck')).split(' ')[1], 'the stamp names the project')
      .toBe('project');
    expect(String(h.reg(ID, 'stranded')), 'and so does the operator sentence')
      .toContain('project\'s own registry field could not be read');
    expect(String(h.reg(ID, 'stranded')), 'naming the ROW\'s own field — `$2` at the call site')
      .toContain(reg(`${ID}.project`));
    expect(String(h.reg(ID, 'stranded')), 'never the crossing record')
      .not.toContain('crossing record');
  });

  it('a pool TAG that breaks inside the tick names the pool, not the crossing record', () => {
    seedRow(); tagPool('demo', 'pool-a'); plantNotify();
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) writeLimits(w, 99, 99);
    h.sh(`${BLOCKED} ${raceWrapper(`rm -rf "$REG/pools/demo"; mkdir -p "$REG/pools/demo"`)} `
      + `_auto_swap_check ${ID}`);
    // THE WORD, NOT A SUBSTRING OF IT (#69 review round 4 gate). `.toContain('pool')`
    // is satisfied by `crosspool`, which is the exact confusion this case exists
    // to refuse — the assertion passed under the collapse it names. The field is
    // `<epoch> <word>`, so the word is what gets compared.
    expect(String(h.reg(ID, 'tickstuck')).split(' ')[1], 'the stamp names the pool')
      .toBe('pool');
    expect(String(h.reg(ID, 'stranded')), 'and the sentence names the tag file')
      .toContain("pool tag could not be read");
    expect(String(h.reg(ID, 'stranded'))).not.toContain('crossing record');
  });

  it('the stamp and the strand sentence never name two different files in one tick', () => {
    // THE DOUBLE FAULT, which is the one case that diverged in ORDINARY state
    // rather than through a race: crossing record unreadable AND pool tag
    // unreadable sent `.tickstuck` to `crosspool` and `.stranded` to the pool
    // sentence. Both surfaces now derive from one word through
    // `_undecidable_cause`, so they cannot drift.
    seedRow(); plantNotify();
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) writeLimits(w, 99, 99);
    undecidablePoolTag();
    crossed('pool-a', 'claude-b');
    const marker = reg(`${ID}.crosspool`);
    fs.rmSync(marker); fs.mkdirSync(marker);
    tick(BLOCKED);
    const word = String(h.reg(ID, 'tickstuck')).split(' ')[1];
    const sentence = String(h.reg(ID, 'stranded'));
    const named = ['crosspool', 'pool', 'project', 'home']
      .filter((w) => (w === 'crosspool' ? sentence.includes('crossing record')
        : w === 'pool' ? sentence.includes('pool tag')
          : w === 'project' ? sentence.includes('own registry field')
            : sentence.includes('home account')));
    expect(named, 'the sentence names exactly one condition').toHaveLength(1);
    expect(named[0], `the stamp says ${word}; the sentence must agree`).toBe(word);
  });

  it('an exit code this build does not name is reported as ignorance, never as a healthy file', () => {
    // The `*` arm. Unreachable today ON PURPOSE: it exists so that the next
    // `return N` added upstream is reported as "this build does not name it"
    // rather than silently inheriting `_strand_why`'s stock "no account in pool
    // X can take it" — a fabricated positive claim about accounts nobody asked.
    seedRow(); tagPool('demo', 'pool-a'); plantNotify();
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) writeLimits(w, 99, 99);
    h.sh(`${BLOCKED} _swap_target() { return 7; }; _auto_swap_check ${ID}`);
    expect(String(h.reg(ID, 'stranded')), 'it says it does not know')
      .toContain('this build does not name');
    expect(String(h.reg(ID, 'stranded')), 'and never a pool census')
      .not.toContain('can take it');
    expect(String(h.reg(ID, 'tickstuck')), 'the stamp carries the code itself').toContain('rc7');
  });
});

describe('R2b — the thirteenth read, found only after the #70 merge sweep', () => {
  it('`_lc_err` answers instead of blocking — the counter that reports a broken journal', () => {
    // THE ONE A CENSUS HAD ALREADY CLEARED. An earlier sweep walked the tick
    // closure, reached `_lc_emit`, cleared it on `_lc_live`'s `[[ -f ]]` guard
    // over the JOURNAL GLOB — and never looked at the failure arm of the very
    // append it was clearing. Five arms of `_lc_emit` call `_lc_err`, one of
    // them that append's own `|| { _lc_err; return 0; }`, and `_lc_err` opened
    // `$_LC_DIR/errors` with a bare `cat` and no type test of any kind.
    //
    // It is on the 5-second tick: `_auto_swap_check`'s `_lc_done rehome` ->
    // `_lc_emit` -> `_lc_err`. `timeout` in a child shell is the assertion, and
    // rc 124 is what a wedged supervisor looks like.
    seedRow();
    const lc = reg('.lifecycle');
    fs.mkdirSync(lc, { recursive: true });
    const errs = path.join(lc, 'errors');

    execFileSync('mkfifo', [errs]);
    expect(h.sh(`timeout 5 bash -c 'source "${CCD}"; _lc_err'; echo "rc=$?"`),
      'a FIFO with no writer: answered, and rc 124 would mean it hung').toBe('rc=0');

    // ...and through the caller, on the arm that fires when the journal itself
    // could not be written — the state this counter exists for.
    fs.chmodSync(lc, 0o555);
    expect(h.sh(`timeout 5 bash -c 'source "${CCD}"; _lc_emit swap ok ${ID} tx1'; echo "rc=$?"`),
      'and through `_lc_emit` with the journal directory unwritable').toBe('rc=0');
    fs.chmodSync(lc, 0o755);
    fs.rmSync(errs);

    // Every input that answered before answers the same: the counter is a
    // FLOOR, and the regex below the read already restarts it on anything that
    // is not digits, so a non-regular file lands in the arm a garbage one does.
    const count = (): string => h.sh(`_lc_err; printf '[%s]' "$(cat "${errs}" 2>/dev/null)"`);
    expect(count(), 'absent: the counter starts at 1').toBe('[1]');
    expect(count(), 'and increments').toBe('[2]');
    fs.writeFileSync(errs, 'garbage');
    expect(count(), 'a torn counter restarts at 1, as it always did').toBe('[1]');
    fs.rmSync(errs); fs.mkdirSync(errs);
    expect(count(), 'a directory: the READ answers empty and the WRITE cannot land — '
      + 'the counter is simply lost, which is what a floor being a floor means')
      .toBe('[]');
    expect(fs.statSync(errs).isDirectory(), 'and nothing clobbered it').toBe(true);
    fs.rmSync(errs, { recursive: true });
  });
});

describe('R3 — an unreadable `.project` stops the tick, but ONLY where a pool could exist', () => {
  it('a tagged box stands still and says so, instead of relocating across pools', () => {
    // THE CONSTRAINT LIFT ROUND 2 OPENED. `_reg_get` folds UNREADABLE into
    // `""`, `_project_pool_state` answers `untagged` for `""`, and `untagged`
    // is the ONE state `_pool_ok` admits every account under — so an unreadable
    // `.project` silently made a pool-tagged project unconstrained, and the
    // next limit block relocated the session out of its pool with no strand and
    // no line. Measured on the round-2 tree: `dispatch claude-demo -> claude-b`.
    seedRow(); tagPool('demo', 'pool-a'); plantNotify();
    writeLimits('claude', 99, 99); writeLimits('claude-b', 1, 1);
    const p = reg(`${ID}.project`);
    fs.rmSync(p, { force: true }); fs.mkdirSync(p);
    tick(BLOCKED);
    expect(calls(), 'no relocation off a tag nobody measured').not.toContain('dispatch');
    expect(logLines('tick-undecidable')[0], 'and the standing still is SAID')
      .toContain('project could not be measured');
    expect(String(h.reg(ID, 'stranded')), 'the strand names the condition, not a pool census')
      .toContain("the project's own registry field could not be read");
    expect(notices(), 'and the banner names the account that WAS measured')
      .toContain('blocked on claude');
    expect(notices(), 'never the placeholder for one that was not')
      .not.toContain('<unmeasured>');
  });

  it('but an UNTAGGABLE box still rescues — the regression the obvious fix ships', () => {
    // THE OPPOSITE DIRECTION, AND IT IS THE HALF THAT MAKES THIS SAFE.
    // `$POOLS_DIR` has one `mkdir` in the tree, so until an operator tags a
    // first project the directory is absent and `_project_pool_state` answers
    // `untagged` for EVERY name — the unread field could not have changed the
    // verdict, and refusing there would kill the limit rescue on every box that
    // has not adopted pools to close a hole it does not have. That is the #67
    // R1 shape: an inert defect traded for a live one. Drop the
    // `_pool_untaggable` gate and this reds with no dispatch at all.
    seedRow(); plantNotify();
    expect(fs.existsSync(reg('pools')), 'this case is about a box with no pools').toBe(false);
    writeLimits('claude', 99, 99); writeLimits('claude-b', 1, 1);
    const p = reg(`${ID}.project`);
    fs.rmSync(p, { force: true }); fs.mkdirSync(p);
    tick(BLOCKED);
    expect(calls(), 'the rescue still fires').toContain('dispatch');
    expect(h.reg(ID, 'stranded'), 'and nothing is stranded').toBeNull();
  });
});

describe('R4 — the strand marker is a CURRENT-STATE claim and follows the truth', () => {
  it('a changed cause replaces the marker; the log line and the epoch do not move', () => {
    // ROUND 2's S2 FIX WAS HALF A FIX. It retracts a stale marker only through
    // a HEALTHY pane — and when the unreadable field recovers while the pane
    // stays blocked, `_strand_mark`'s `-e` debounce swallows the genuine strand
    // that follows, so the operator reads a registry fault that lasted one tick
    // for the rest of a five-hour window. The marker is what `registry.ts`
    // ships VERBATIM to every surface.
    seedRow(); tagPool('demo', 'pool-a'); plantNotify();
    // EVERY account at the ceiling, because the finding is about a row with
    // NOWHERE TO GO: leave one free and a destination exists, the tick clears
    // the strand outright, and the case measures the clear instead of the
    // frozen cause it is about.
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) writeLimits(w, 99, 99);
    h.sh(`_reg_set ${ID} stranded "1700000000 wrapper could not be measured"`);
    tick(BLOCKED);
    const mark = String(h.reg(ID, 'stranded'));
    expect(mark, 'the cause the tick can now measure replaces the stale one')
      .not.toContain('wrapper could not be measured');
    expect(mark, 'and it is the real census, naming candidates by name')
      .toContain('claude-a');
    expect(mark.split(' ')[0], 'the episode keeps its own epoch — `stranded.at` is "since when"')
      .toBe('1700000000');
    expect(logLines('stranded'), 'the APPEND keeps its per-episode floor').toHaveLength(0);
  });

  it('an UNREADABLE marker is not rewritten, and leaks no shell error doing it', () => {
    // THE FOLD THE OBVIOUS VERSION OF THIS FIX WALKS INTO: read the old cause
    // with `_reg_get` and a marker that is a DIRECTORY reads `""`, which
    // compares unequal to every cause, so the tick commits a write to a path it
    // proved only `-e` for — one unsuppressed `mv: cannot overwrite directory`
    // per stranded row per tick, for ever, from the two `_strand_mark` calls in
    // `_auto_swap_check` that carry no redirect group. `_reg_read` stands still.
    seedRow(); tagPool('demo', 'pool-a'); plantNotify();
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) writeLimits(w, 99, 99);
    const m = reg(`${ID}.stranded`);
    fs.rmSync(m, { force: true }); fs.mkdirSync(m);
    const r = shFail(`${BLOCKED} { for ((i=0;i<3;i++)); do _auto_swap_check ${ID}; done; } 2>"$HOME/tick-err"`);
    expect(r.code, 'the tick still completes').toBe(0);
    const errs = fs.readFileSync(path.join(h.home, 'tick-err'), 'utf8').split('\n').filter(Boolean);
    expect(errs, 'nothing decided off an unmeasured read, so nothing to complain about')
      .toEqual([]);
    expect(fs.statSync(m).isDirectory(), 'and the marker is left exactly as found').toBe(true);
    fs.rmSync(m, { recursive: true });
  });
});

describe('R6 — the stderr group round 2 shipped unpinned', () => {
  it('a `swap.log` that is a DIRECTORY produces no shell error through the strand arm', () => {
    // ROUND 2's GROUP WAS THE ONE CHANGE OF EIGHT NOBODY MUTATED, and the whole
    // ccd sweep is green without it — the only red is the provenance stamp,
    // which is a red naming the wrong case. Pinned here the root-safe way
    // (D-1997): `>>` onto a DIRECTORY fails with "Is a directory" at every uid,
    // where `chmod 000` is a no-op for root. That is also the exact failure the
    // sibling comment says this spelling exists to catch, so the pin measures
    // the argument the code makes. Delete the `{ …; } 2>/dev/null` and this
    // reds naming `swap.log`.
    seedRow();
    const p = reg(`${ID}.wrapper`);
    fs.rmSync(p, { force: true }); fs.mkdirSync(p);
    fs.rmSync(reg('swap.log'), { force: true });
    fs.mkdirSync(reg('swap.log'));
    const r = shFail(`${BLOCKED} { _tick_strand_undecidable ${ID} wrapper; } 2>"$HOME/tick-err"`);
    expect(r.code).toBe(0);
    const errs = fs.readFileSync(path.join(h.home, 'tick-err'), 'utf8').split('\n').filter(Boolean);
    expect(errs, 'the group silences the failed append inside `_strand_mark`').toEqual([]);
    fs.rmSync(reg('swap.log'), { recursive: true });
  });
});

describe('B6 — the round-4 guards nothing could red, and the sentences nothing could read', () => {
  // MEASURED BY THE COORDINATOR AND RE-MEASURED HERE BEFORE ANY OF IT WAS
  // WRITTEN, because a green mutation is ambiguous on its own — an unpinned
  // guard, an unreachable line and a mutation that never applied all look
  // alike. Every case below carries the mutation that reds it and, where the
  // same guard exists twice, the sibling that already redded.

  it('the SWAPBLOCKED cooldown gate clears a stale stamp too — the half "Pinned in both directions" claimed', () => {
    // ROUND 4 SHIPPED TWO CLEARS AND ONE MEASUREMENT. `_swap_refuse` DELETES
    // `.lastswap` and stamps `.swapblocked`, so after a refusal the swapblocked
    // gate is the ONLY gate holding for the whole `SWAPBLOCK_COOLDOWN` — the
    // unpinned half was the one carrying the refusal case, which is the case
    // the pair exists for. Mutation: replace the clear on that arm with `:`;
    // before this case the whole ccd+pools set stayed green (11 files / 354).
    //
    // THE LASTSWAP GATE MUST NOT BE THE ONE THAT FIRES, or this measures the
    // half that was already measured — the trap three of round 4's own pins
    // fell into (D-2260). `seedRow` writes no `.lastswap`, and the assertion
    // below says so rather than trusting it.
    seedRow(); plantNotify();
    h.sh(`_reg_set ${ID} tickstuck "1700000000 project"`);
    h.sh(`_reg_set ${ID} swapblocked "$(date +%s) rate-limited"`);
    expect(fs.existsSync(reg(`${ID}.lastswap`)),
      'no lastswap: the gate above this one cannot be the one that clears').toBe(false);
    expect(h.reg(ID, 'tickstuck'), 'the stale stamp is standing before the tick')
      .toContain('project');
    tick(QUIET);
    expect(h.reg(ID, 'tickstuck'),
      'a refused swap is a decision too: the stamp is retracted at the swapblocked gate')
      .toBe(null);
  });

  it('and an UNTAGGABLE box still PREFERS — `cmd_prefer` carries the gate `cmd_swap` was measured on', () => {
    // THE CONTROL IS WHAT MAKES THIS A FINDING. Four sites carry
    // ` && ! _pool_untaggable`; dropping it at `cmd_prefer` left the whole
    // ccd+pools set green, and dropping the byte-identical text at `cmd_swap`
    // redded `but an UNTAGGABLE box still swaps` immediately. Same guard, same
    // line, one verb measured and one not — and the case that DOES name
    // `cmd_prefer` two describes up tags the pool, so `_pool_untaggable` is
    // false there and the gate cannot change its verdict.
    const mdir = seedRow(); plant('.claude', mdir, 'HISTORY\n');
    expect(fs.existsSync(reg('pools')), 'this case is about a box with no pools').toBe(false);
    const p = reg(`${ID}.project`);
    fs.rmSync(p, { force: true }); fs.mkdirSync(p);
    const r = shFail(`${SWAP_STUBS} cmd_prefer ${ID} claude-b`, { TMUX: '' });
    expect(r.code, 'the prefer still happens — nothing could have been out of pool').toBe(0);
    expect(h.reg(ID, 'home'), 'and the home is re-pinned as asked').toBe('claude-b');
    fs.rmSync(p, { recursive: true });
  });

  it('`cmd_start` on the id form SAYS the project field could not be read', () => {
    // B3'S THIRD VERB READER. `_reg_get` folded the unreadable field to `""`,
    // `_project_pool_state ""` answers `untagged`, and `untagged` permits every
    // account — so the pool block decided "in pool" and printed nothing. What
    // it silences here is the WARNING and not the die: the die is creation-only
    // (`-z "$regw"`), and this read runs only on the id form, where an empty
    // `regw` has already died at `no wrapper recorded`. `run` rather than
    // `shFail` because the warning rides a ZERO exit.
    seedRow(); tagPool('demo', 'pool-a');
    const p = reg(`${ID}.project`);
    fs.rmSync(p, { force: true }); fs.mkdirSync(p);
    const r = run(`${START_STUBS} cmd_start ${ID}`);
    expect(r.stderr, 'the operator is told the field could not be read')
      .toContain(`the project field for ${ID} could not be read`);
    expect(r.stderr, 'and it names the file to fix').toContain(`${ID}.project`);
    fs.rmSync(p, { recursive: true });
  });

  it('an untaggable box says NOTHING there — the guard is a report, not a new refusal', () => {
    // The other direction, and the reason the warning carries `! _pool_untaggable`
    // exactly as the two dies do: with no `pools/` at all no project can be in a
    // pool, so an unreadable tag field could not have changed any verdict and a
    // warning would be noise on every box that never tagged anything.
    seedRow();
    expect(fs.existsSync(reg('pools')), 'no pools on this box').toBe(false);
    const p = reg(`${ID}.project`);
    fs.rmSync(p, { force: true }); fs.mkdirSync(p);
    const r = run(`${START_STUBS} cmd_start ${ID}`);
    expect(r.stderr, 'nothing to say: nothing could have been out of pool')
      .not.toContain('could not be read');
    fs.rmSync(p, { recursive: true });
  });

  it('the EARLY returns say what the LATE one says — one condition, one sentence', () => {
    // `_tick_strand_undecidable` built its own string while the late path
    // rendered the same condition through `_undecidable_cause`, so an
    // unreadable `.project` wrote two different `.stranded` sentences depending
    // on which guard caught it — and these two call sites are the EARLY
    // returns, so the common case was the one that named no file. The header
    // claiming both surfaces "cannot drift apart" was written above the drift.
    seedRow(); tagPool('demo', 'pool-a'); plantNotify();
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) writeLimits(w, 99, 99);
    const p = reg(`${ID}.project`);
    fs.rmSync(p, { force: true }); fs.mkdirSync(p);
    tick(BLOCKED);
    const early = String(h.reg(ID, 'stranded'));
    fs.rmSync(p, { recursive: true });
    expect(early, 'the early return renders through `_undecidable_cause`')
      .toContain("the project's own registry field could not be read");
    expect(early, 'and it names the file, which the hand-built sentence never did')
      .toContain(`${ID}.project`);
    expect(early, 'the hand-built sentence is gone')
      .not.toContain('project could not be measured');
    expect(early, 'and it is byte-identical to what the LATE path renders')
      .toContain(h.sh(`_undecidable_cause project ${ID} demo`));
  });

  it('and the WRAPPER word has an arm of its own, so the fold did not send it to `*`', () => {
    // The word only the early return passes. Without an arm it would have
    // landed in the `*` case and told the operator this build does not name a
    // condition it names — a fold that makes the sentence worse is not a fold.
    seedRow(); plantNotify();
    const w = reg(`${ID}.wrapper`);
    fs.rmSync(w, { force: true }); fs.mkdirSync(w);
    tick(BLOCKED);
    const said = String(h.reg(ID, 'stranded'));
    fs.rmSync(w, { recursive: true });
    expect(said, 'the account field is named').toContain('account field could not be measured');
    expect(said, 'and so is its path').toContain(`${ID}.wrapper`);
    expect(said, 'never the unknown-condition arm').not.toContain('does not name');
  });

  it('and it says COULD NOT BE MEASURED, because that guard fires on three conditions', () => {
    // THE VERB HAS TO BE TRUE OF ALL THREE (#69 review round 5, its own refute
    // pass). The wrapper guard is `[[ "$wrc" -ne 0 || -z "$wrapper" ]]`, and its
    // own comment two lines up says why: "Read failure and read-nothing are
    // different conditions with the same remedy here." The first cut of the
    // folded sentence said "could not be READ", which is true of the directory
    // fixture the case above plants and false of the other two — a zero-byte
    // field is read successfully, and an absent one is not there to read. The
    // marker would then have asserted a read failure that did not happen while
    // swap.log, on the same tick, still said the true thing.
    for (const [label, plant] of [
      ['zero-byte', (f: string): void => { fs.writeFileSync(f, ''); }],
      ['absent', (f: string): void => { fs.rmSync(f, { force: true }); }],
    ] as const) {
      seedRow(); plantNotify();
      const f = reg(`${ID}.wrapper`);
      fs.rmSync(f, { force: true }); plant(f);
      tick(BLOCKED);
      const said = String(h.reg(ID, 'stranded'));
      expect(said, `${label}: the account field is named`).toContain('account field');
      expect(said, `${label}: and the verb is one that is true of it`)
        .toContain('could not be measured');
      expect(said, `${label}: never a read that never happened`)
        .not.toContain('could not be read');
      fs.rmSync(reg(`${ID}.stranded`), { force: true });
      fs.rmSync(reg('swap.log'), { force: true });
    }
  });

  it('a TORN epoch in the marker degrades to now — the guard its own comment asserts', () => {
    // A GUARD WITH NO MECHANISM, FOUND IN THIS ROUND'S OWN REFUTE PASS, and the
    // exact shape the round-4 gate refused to merge: `_strand_mark`'s rewrite
    // arm carries `[[ "$pat" =~ ^[0-9]+$ ]] || pat="$now"` and the paragraph
    // above it asserts "a torn stamp degrades to `$now` rather than writing a
    // non-numeric field the wire would have to fail shut on" — measured,
    // deleting the fallback left the whole ccd+pools set green. Round 5 rewrote
    // that very paragraph without measuring the sentence it left standing.
    seedRow(); tagPool('demo', 'pool-a'); plantNotify();
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) writeLimits(w, 99, 99);
    // A hand-edited or half-written first token, with a cause that differs from
    // what the tick will measure — the rewrite arm is the only one that reads it.
    h.sh(`_reg_set ${ID} stranded "TORN wrapper could not be measured"`);
    tick(BLOCKED);
    const mark = String(h.reg(ID, 'stranded'));
    expect(mark, 'the cause was rewritten, so the rewrite arm is what ran')
      .toContain('claude-a');
    expect(mark.split(' ')[0], 'and the torn epoch became a number rather than being carried')
      .toMatch(/^\d{10}$/);
  });

  it('`_undecidable_cause` reads its arguments in the order its header states', () => {
    // POSITIONAL ARGUMENTS, PINNED AT THE CALL SITE — which is the altitude the
    // finding is about, and the one a unit drive cannot reach. `word id project`:
    // the `project` arm interpolates `$REG/$2.project` and the `pool` arm
    // `$POOLS_DIR/$3`, so swapping `$2` and `$3` where the tick passes them
    // renders a file that does not exist, on the exact surface this round added
    // to stop that happening. 213 tests passed under that swap — and so did an
    // earlier cut of THIS case, which drove the function with literal arguments
    // and so measured the arms while claiming to measure the caller.
    seedRow(); plantNotify();
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) writeLimits(w, 99, 99);
    undecidablePoolTag();
    tick(BLOCKED);
    const said = String(h.reg(ID, 'stranded'));
    expect(said, 'the pool arm names the PROJECT, which is `$3`')
      .toContain(`${reg('pools')}/demo`);
    expect(said, 'never the row id, which is what a swapped pair renders')
      .not.toContain(`${reg('pools')}/${ID}`);

    // The arms themselves, driven directly — the other half of the pair, and
    // the one that catches a swap made INSIDE the `case` rather than at its caller.
    expect(h.sh(`_undecidable_cause project ${ID} demo`), 'the project arm names the ROW')
      .toContain(reg(`${ID}.project`));
    expect(h.sh(`_undecidable_cause pool ${ID} demo`), 'the pool arm names the PROJECT')
      .toContain(`${reg('pools')}/demo`);
    expect(h.sh(`_undecidable_cause zebra ${ID} demo`), 'and an unknown word is said, not invented')
      .toContain('does not name (zebra)');
  });

  it('the `home` arm is reachable, and it is the one the precedence picks', () => {
    // Reachable through `stuck=home`, never through `$strc` — `_swap_target`
    // has no home rc of its own — so removing the `hrc` arm from the caller's
    // `case` was right and the sentence still had no test. The double fault is
    // what reaches it: `.home` unreadable sets `stuck=home`, and an unreadable
    // crossing record makes `_swap_target` refuse, which is what carries the
    // tick into the arm that writes the sentence at all.
    seedRow(); plantNotify();
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) writeLimits(w, 99, 99);
    crossed('pool-a', 'claude-b');
    const marker = reg(`${ID}.crosspool`);
    fs.rmSync(marker); fs.mkdirSync(marker);
    const home = reg(`${ID}.home`);
    fs.rmSync(home, { force: true }); fs.mkdirSync(home);
    tick(BLOCKED);
    const said = String(h.reg(ID, 'stranded'));
    const word = String(h.reg(ID, 'tickstuck')).split(' ')[1];
    fs.rmSync(marker, { recursive: true }); fs.rmSync(home, { recursive: true });
    expect(word, 'precedence: the deepest read that failed is home').toBe('home');
    expect(said, 'and the sentence is the home one, not the crossing record')
      .toContain('the home account could not be measured');
    expect(said, 'the two surfaces still name one condition').not.toContain('crossing record');
  });
});
