// `$REG/<account>-authdead` is the account-health probe's durable verdict, in the
// tree's one fault format — `"<epoch> <reason>"`, the shape `swapblocked` already
// uses (`_swap_refuse`, ccd/ccd:13793). This file pins the READER and the NAMESPACE; the two
// placement consumers are pinned in the describes Task 2 adds below.
//
// THE DIGITS GATE IS NOT COSMETIC. ccd runs under `set -u`, and every reader of a
// stamped marker in this file validates the epoch as digits BEFORE any arithmetic
// touches it (`_auto_swap_check`'s `bts`, ccd/ccd:12093-12094) — a hand-edited or
// half-written field otherwise emits an unbound-variable line on every supervise
// tick. `_authdead` is a predicate rather than an arithmetic reader, so the gate
// buys something else here: it is what makes a TRUNCATED marker read as "no
// verdict" instead of as a verdict nobody wrote.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
let home: string;

const sh = (s: string, env: NodeJS.ProcessEnv = {}): string => h.sh(s, env);
const ok = (snippet: string): boolean => sh(`${snippet} && echo yes || echo no`) === 'yes';
const marker = (w: string): string => path.join(home, '.cc-sessions', `${w}-authdead`);
const mark = (w: string, body: string): void => fs.writeFileSync(marker(w), body);

beforeEach(() => { h = makeCcdHarness('ccrc-ccd-authdead-'); home = h.home; });
afterEach(() => { h.cleanup(); });

describe('_authdead', () => {
  it('is false when no marker exists', () => {
    expect(ok('_authdead claude')).toBe(false);
  });

  it('is true for the shipped format, "<epoch> <reason>"', () => {
    mark('claude', '1757203200 auth-401');
    expect(ok('_authdead claude')).toBe(true);
  });

  it('is true for a bare epoch with no reason — the reason is a note, the stamp is the fact', () => {
    mark('claude', '1757203200');
    expect(ok('_authdead claude')).toBe(true);
  });

  it('is FALSE for an empty file — a marker nobody finished writing is not a verdict', () => {
    mark('claude', '');
    expect(ok('_authdead claude')).toBe(false);
  });

  it('is FALSE when the first field is not digits', () => {
    mark('claude', 'yesterday auth-401');
    expect(ok('_authdead claude')).toBe(false);
  });

  it('answers per account, never fleet-wide', () => {
    mark('claude-a', '1757203200 auth-401');
    expect(ok('_authdead claude-a')).toBe(true);
    expect(ok('_authdead claude')).toBe(false);
    expect(ok('_authdead claude-b')).toBe(false);
  });

  it('prints nothing on either path — it is a predicate, not a reader', () => {
    mark('claude', '1757203200 auth-401');
    expect(sh('_authdead claude; _authdead claude-b; echo END')).toBe('END');
  });
});

describe('the marker is DOTLESS, so no registry glob can eat it', () => {
  // Every registry glob in ccd is suffix-shaped and runs the same one-dot rule
  // (`[[ "$suffix" == *.* ]] && continue`) at THREE sites: `_reg_purge`,
  // `_ws_slug_free` and `_ws_slug_residue`. All three glob `"$REG/$id".*`,
  // which requires a literal dot AFTER the id — so a
  // dotless `<account>-authdead` is invisible to them even when a session id
  // collides with it byte for byte. Asserted rather than assumed, because the
  // collision is what a per-account marker in the session namespace risks and it
  // is exactly the class `_reg_purge`'s own header records as measured.
  it('survives _reg_purge of a session whose id IS the marker name', () => {
    const reg = path.join(home, '.cc-sessions');
    mark('claude-authdead', '1757203200 auth-401');
    fs.writeFileSync(path.join(reg, 'claude-authdead.uuid'), 'u\n');
    fs.writeFileSync(path.join(reg, 'claude-authdead.wrapper'), 'claude\n');
    sh('_reg_purge claude-authdead');
    expect(fs.existsSync(path.join(reg, 'claude-authdead.uuid')), 'the session row survived').toBe(false);
    expect(fs.existsSync(marker('claude-authdead')), 'the marker was swept').toBe(true);
  });

  it('does not make a colliding slug read as occupied', () => {
    // The other direction of the same rule: `_ws_slug_free` must not see the
    // dotless marker either, or the marker would wedge a slug forever.
    mark('demo-quiet', '1757203200 auth-401');
    expect(ok('_ws_slug_free demo quiet')).toBe(true);
  });
});

const writeLimits = (w: string, five: number, seven: number): void =>
  fs.writeFileSync(path.join(home, '.cc-limits', `${w}.json`),
    JSON.stringify({ five, seven, ts: Math.floor(Date.now() / 1000) }));

describe('_ws_least_loaded drops an auth-dead lane from SCORING, never from the fallback', () => {
  it('does not place a new workspace on the cheapest lane when that lane is auth-dead', () => {
    writeLimits('claude', 50, 50);
    writeLimits('claude-a', 5, 5);        // cheapest, but dead
    writeLimits('claude-b', 40, 40);
    writeLimits('claude-d', 60, 60);
    mark('claude-a', '1757203200 auth-401');
    expect(sh('_ws_least_loaded')).toBe('claude-b');
  });

  it('STILL ANSWERS when every home-able lane is auth-dead — the `first` fallback is reachable', () => {
    // THE CASE THE SKIP IS PLACED FOR. A health skip written ABOVE
    // `[[ -z "$first" ]] && first="$w"` empties the fallback here, this
    // function echoes "", and `cmd_ws_add` dies with no destination on a fleet
    // whose accounts are all merely UNVERIFIED. Eligibility must survive; only
    // preference changes.
    writeLimits('claude', 50, 50);
    writeLimits('claude-a', 5, 5);
    writeLimits('claude-b', 40, 40);
    writeLimits('claude-d', 60, 60);
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) mark(w, '1757203200 auth-401');
    expect(sh('_ws_least_loaded')).toBe('claude');   // roster declaration order
  });

  it('an auth-dead lane can still BE the fallback when it is the first placeable one', () => {
    // No telemetry anywhere: nothing is scorable at all, so both the skip and
    // the score branch are moot and `first` decides. That `first` is allowed to
    // be a condemned lane is the whole content of the previous case, stated
    // where it is visible without four markers.
    mark('claude', '1757203200 auth-401');
    expect(sh('_ws_least_loaded')).toBe('claude');
  });
});

describe('_swap_target ranks an auth-dead lane LAST, and never makes it ineligible', () => {
  const seedSession = (id: string, wrapper: string): void => {
    const reg = path.join(home, '.cc-sessions');
    fs.writeFileSync(path.join(reg, `${id}.uuid`), 'u\n');
    fs.writeFileSync(path.join(reg, `${id}.wrapper`), `${wrapper}\n`);
    fs.writeFileSync(path.join(reg, `${id}.home`), `${wrapper}\n`);
  };

  it('prefers a measured healthy lane over a cheaper auth-dead one', () => {
    seedSession('claude-demo', 'claude');
    writeLimits('claude', 99, 99);        // cur: pinned, must leave
    writeLimits('claude-a', 5, 5);        // cheapest, but dead
    writeLimits('claude-b', 40, 40);
    writeLimits('claude-d', 60, 60);
    mark('claude-a', '1757203200 auth-401');
    expect(sh('_swap_target claude-demo claude claude')).toBe('claude-b');
  });

  it('STILL RESCUES onto an auth-dead lane when it is the only destination left', () => {
    // The rescue lane's rule, and the thing to pin hardest: an over-eager
    // verdict must cost PREFERENCE, never a destination. A `continue` here
    // leaves `best` empty, `_swap_target` prints nothing, `_auto_swap_check`
    // returns silently, and a session with a lost-auth screen up stays wedged
    // with no swap.log line and no notification.
    //
    // `|| true` IS LOAD-BEARING, and it is here so this case can FAIL rather
    // than ERROR. `_swap_target`'s last statement is `[[ -n "$best" ]] && echo
    // "$best"`, so an empty `best` makes the function — and the `bash -c`
    // around it — exit 1, and `makeCcdHarness`'s `sh` is `execFileSync`, which
    // THROWS on a non-zero exit. Without the `|| true` the mutation that turns
    // the guard into a `continue` would blow up inside the harness instead of
    // reporting `expected '' to be 'claude-d'`, and an unmeasurable mutation is
    // the one thing this table may not have.
    seedSession('claude-demo', 'claude');
    writeLimits('claude', 99, 99);        // cur: pinned
    writeLimits('claude-a', 99, 99);      // over the ceiling — _avail rejects
    writeLimits('claude-b', 99, 99);      // over the ceiling — _avail rejects
    writeLimits('claude-d', 5, 5);        // the only available lane, and dead
    mark('claude-d', '1757203200 auth-401');
    expect(sh('_swap_target claude-demo claude claude || true')).toBe('claude-d');
  });

  it('RANKS BELOW unmeasured, losing to a silent lane it would beat on roster order', () => {
    // SAYING IT OUT LOUD, as the version of this case that pinned the two as
    // EQUAL asked the edit that separated them to. They are no longer equal:
    // auth-dead is 101, one tier below unmeasured's 100, so `claude-a` loses to
    // `claude-b` here DESPITE winning roster order — which is exactly what the
    // old equality could not express, because at a shared 100 the strict `<`
    // handed the rescue to whichever condemned lane came first.
    //
    // Why the tier and not the tie: an auth-dead lane cannot refresh its own
    // telemetry (nothing runs there to render a statusline), so within hours it
    // reads unmeasured anyway and `sc` is already 100 from `: "${sc:=100}"`. At
    // a shared 100 the guard's whole effect was the window in which a dead lane
    // still carried fresh both-halves telemetry — here, `claude-a`'s 5/5.
    seedSession('claude-demo', 'claude');
    writeLimits('claude', 99, 99);        // cur: pinned
    writeLimits('claude-a', 5, 5);        // dead -> 101, not the 5 it measures
    mark('claude-a', '1757203200 auth-401');
    // claude-b and claude-d have no telemetry file at all -> unmeasured -> 100
    expect(sh('_swap_target claude-demo claude claude')).toBe('claude-b');
  });

  it('loses to a healthy lane when NEITHER has telemetry — the steady state', () => {
    // THE CASE THE OLD EQUALITY LOST, and the reason for the tier. This is not
    // a corner: it is what an auth-dead lane looks like a few hours after the
    // probe marks it, every time, because it cannot report and `_limit_field`
    // retracts the sample whose window has ended. Both lanes are scoreless, so
    // the ONLY thing separating them is the health verdict — at `sc=100` the
    // strict `<` gave the rescue to `claude-a` on roster order alone, sending a
    // hard-blocked session to the one account measured as not authenticating.
    seedSession('claude-demo', 'claude');
    writeLimits('claude', 99, 99);        // cur: pinned, must leave
    mark('claude-a', '1757203200 auth-401');   // dead, and no telemetry -> 101
    // claude-b, claude-d: healthy and silent -> unmeasured -> 100
    expect(sh('_swap_target claude-demo claude claude')).toBe('claude-b');
  });
});

describe('a successful spawn is evidence, and clears the marker', () => {
  // §A.6's second owner. The probe (owner one) clears on a 403 within its
  // 15-minute cadence; this narrows the stale window to zero for the case where
  // an operator has just fixed the credential and started a session on it.
  //
  // rc 0 ONLY, and that is the whole discipline. `cmd_start` clears
  // `swapblocked` on the ATTEMPT (ccd/ccd:13102) because a swap refusal is a stale
  // banner an operator supersedes by acting. An auth-dead marker is a
  // MEASUREMENT: clearing it on an attempt would erase a true fault with no
  // evidence. rc 2 is "waiting for login" and rc 5 is "hard-blocked at startup
  // (limit/spend banner, or lost auth)" — both are the OPPOSITE of evidence.
  // `|| true` IS LOAD-BEARING. `_spawn_settle` ends in `return "$prompt_rc"`,
  // so the rc 2 and rc 5 cases make the `bash -c` exit 2 and 5
  // — and `makeCcdHarness`'s `sh` is `execFileSync`, which THROWS on any
  // non-zero exit (ccd runs `set -uo pipefail`, no `-e`, so nothing else
  // rescues it). Swallowing the code here is what makes those two cases assert
  // rather than error, which is the only way Step 5's second mutation can be
  // measured at all.
  const settle = (id: string, rc: number): string =>
    sh(`_accept_first_run_prompts() { return ${rc}; }; _tmux() { echo t; };`
      + ` _inject_spawn_effort() { :; }; _lc_done() { :; }; _spawn_settle ${id} "" || true`);

  const seedOn = (id: string, wrapper: string): void => {
    const reg = path.join(home, '.cc-sessions');
    fs.writeFileSync(path.join(reg, `${id}.uuid`), 'u\n');
    fs.writeFileSync(path.join(reg, `${id}.wrapper`), `${wrapper}\n`);
  };

  it('clears the marker for the account the session actually spawned on', () => {
    seedOn('claude-demo', 'claude-a');
    mark('claude-a', '1757203200 auth-401');
    settle('claude-demo', 0);
    expect(fs.existsSync(marker('claude-a'))).toBe(false);
  });

  it('leaves every OTHER account\'s marker standing', () => {
    seedOn('claude-demo', 'claude-a');
    mark('claude-a', '1757203200 auth-401');
    mark('claude-b', '1757203200 auth-401');
    settle('claude-demo', 0);
    expect(fs.existsSync(marker('claude-b'))).toBe(true);
  });

  it('does NOT clear on rc 2 — "waiting for login" is the opposite of evidence', () => {
    seedOn('claude-demo', 'claude-a');
    mark('claude-a', '1757203200 auth-401');
    settle('claude-demo', 2);
    expect(fs.existsSync(marker('claude-a'))).toBe(true);
  });

  it('does NOT clear on rc 5 — hard-blocked at startup, which includes lost auth', () => {
    seedOn('claude-demo', 'claude-a');
    mark('claude-a', '1757203200 auth-401');
    settle('claude-demo', 5);
    expect(fs.existsSync(marker('claude-a'))).toBe(true);
  });
});
