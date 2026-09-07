// `_default_pool` — the candidate set every session's auto-swapper draws from
// — is the home-able roster PLUS every rostered lane that is NOT home-able but
// is enabled: installed (`-x ~/.local/bin/<w>`) and not kill-switched
// (`~/.cc-sessions/<w>-disabled` absent). Operator decision 2026-09-07,
// reversing the 2026-07-26 rule under which a non-home-able lane joined a pool
// only when it was that one session's HOME.
//
// Two questions, two mechanisms, and this file pins them apart:
//   - HOME-ABILITY is placement: `_ws_least_loaded` iterates CCRC_HOME_ABLE and
//     nothing else, so an overflow lane is never where a workspace STARTS.
//   - THE KILL-SWITCH is the rotation opt-out: `touch $REG/<w>-disabled` removes
//     an overflow lane from every session's pool on the next tick, which is what
//     ccd's `GPT_DISABLE_FILE` comment ("touch to remove gpt from rotation
//     instantly") has claimed since it existed — and was not true for the six
//     weeks the 2026-07-26 rule stood.
//
// The harness never installs the roster's non-home-able account (`gpt` in
// `DEFAULT_TEST_ROSTER`), so every pre-existing suite sees exactly the pool it
// saw before this change; the cases below install it on purpose. Mutation
// check, measured before this file was committed: with `_default_pool`
// reverted to the 2026-07-26 body, FIVE of the thirteen cases go red — "adds a
// non-home-able lane once it is installed", "does not depend on the session's
// HOME", "the kill-switch removes it again" (its re-enable arm), "a hand-set
// registry `pool` list still overrides" (the other session's default) and
// "rotates onto the enabled overflow lane". The other eight are the invariants
// that must SURVIVE the change, and pin that nothing else moved.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
let home: string;

const sh = (s: string): string => h.sh(s);
const now = (): number => Math.floor(Date.now() / 1000);

/** The Anthropic shape `statusline-command.sh` writes: both windows, fresh. */
const writeLimits = (w: string, five: number, seven: number): void =>
  fs.writeFileSync(path.join(home, '.cc-limits', `${w}.json`),
    JSON.stringify({ five, seven, ts: now() }));

/** The Codex shape `ccgpt-usage` writes: weekly only, `five` null — the real
 *  `~/.cc-limits/gpt.json` on the reference box, not an invented one. */
const writeWeeklyOnly = (w: string, seven: number): void =>
  fs.writeFileSync(path.join(home, '.cc-limits', `${w}.json`),
    JSON.stringify({ five: null, seven, ts: now(), fiveResetAt: null, sevenResetAt: now() + 400_000 }));

const install = (w: string): void =>
  fs.writeFileSync(path.join(home, '.local', 'bin', w), '#!/bin/sh\n', { mode: 0o755 });

const disable = (w: string): void =>
  fs.writeFileSync(path.join(home, '.cc-sessions', `${w}-disabled`), '');

const HOME_ABLE = 'claude claude-a claude-b claude-d';

beforeEach(() => { h = makeCcdHarness('ccrc-ccd-default-pool-'); home = h.home; });
afterEach(() => { h.cleanup(); });

describe('_default_pool: the home-able roster, plus every ENABLED overflow lane', () => {
  it('lists only the home-able accounts while the overflow lane is not installed (the harness default)', () => {
    expect(sh('_default_pool claude-demo')).toBe(HOME_ABLE);
  });

  it('adds a non-home-able lane once it is installed and not kill-switched — after the home-able ones', () => {
    // Order is the tie-break `_swap_target`'s strict `<` falls back on, so it
    // is part of the contract: home-able first, overflow lanes after.
    install('gpt');
    expect(sh('_default_pool claude-demo')).toBe(`${HOME_ABLE} gpt`);
  });

  it('does not depend on the session\'s HOME: a session homed elsewhere sees the same overflow lane', () => {
    // The 2026-07-26 body read `$REG/<id>.home` and admitted the lane only when
    // it WAS that session's home. The pool is now a property of the box.
    install('gpt');
    sh('_reg_set claude-demo home claude-a');
    expect(sh('_default_pool claude-demo')).toBe(`${HOME_ABLE} gpt`);
    expect(sh('_default_pool claude-a-other')).toBe(`${HOME_ABLE} gpt`);
  });

  it('the kill-switch removes it again, for every session, without touching the home-able half', () => {
    install('gpt');
    disable('gpt');
    expect(sh('_default_pool claude-demo')).toBe(HOME_ABLE);
    expect(sh('_default_pool claude-a-other')).toBe(HOME_ABLE);
    fs.rmSync(path.join(home, '.cc-sessions', 'gpt-disabled'));
    expect(sh('_default_pool claude-demo')).toBe(`${HOME_ABLE} gpt`);
  });

  it('a home-able account stays listed even when kill-switched — the DESTINATION check filters it, not the pool', () => {
    // "disabled excludes a lane as a destination; it never evacuates a session
    // already there" lives in `_swap_target`'s loop (`ccd-account-ok.test.ts`).
    // A pool that dropped disabled home-able members would be a second copy of
    // that rule, and the two would drift.
    disable('claude-b');
    expect(sh('_default_pool claude-demo')).toBe(HOME_ABLE);
  });

  it('every token comes from the roster: a stale registry home naming a dropped account adds nothing', () => {
    // `_swap_target` word-splits this string unquoted, so an unrostered token
    // here would become a swap candidate. The old body vetted `$REG/<id>.home`
    // with `_is_valid_wrapper`; the new one never reads a registry field at all.
    install('ghost');
    sh('_reg_set claude-demo home ghost');
    expect(sh('_default_pool claude-demo')).toBe(HOME_ABLE);
  });

  it('a hand-set registry `pool` list still overrides the default verbatim', () => {
    install('gpt');
    sh('_reg_set claude-demo pool "claude-a claude-b"');
    expect(sh('_pool_for claude-demo')).toBe('claude-a claude-b');
    expect(sh('_pool_for claude-a-other')).toBe(`${HOME_ABLE} gpt`);
  });
});

describe('the rotation reaches an enabled overflow lane; placement never does', () => {
  it('a session at the ceiling on its home rotates onto the overflow lane when it is the least loaded', () => {
    install('gpt');
    writeLimits('claude', 99, 99);     // cur == home, over SWAP_CEILING: must leave
    writeLimits('claude-a', 90, 90);
    writeLimits('claude-b', 90, 90);
    writeLimits('claude-d', 90, 90);
    writeWeeklyOnly('gpt', 0);         // the real Codex shape: no 5h window, weekly at 0
    expect(sh('_swap_target claude-demo claude claude')).toBe('gpt');
  });

  it('...and comes back the moment home has headroom again', () => {
    install('gpt');
    writeLimits('claude', 5, 5);
    writeWeeklyOnly('gpt', 0);
    expect(sh('_swap_target claude-demo gpt claude')).toBe('claude');
  });

  it('an overflow lane at its own weekly cap is not a destination', () => {
    install('gpt');
    writeLimits('claude', 99, 99);
    writeLimits('claude-a', 50, 50);
    writeLimits('claude-b', 60, 60);
    writeLimits('claude-d', 60, 60);
    writeWeeklyOnly('gpt', 100);       // ccgpt-usage reporting the Codex weekly cap reached
    expect(sh('_swap_target claude-demo claude claude')).toBe('claude-a');
  });

  it('a kill-switched overflow lane is not a destination even when it is the cheapest', () => {
    install('gpt');
    disable('gpt');
    writeLimits('claude', 99, 99);
    writeLimits('claude-a', 50, 50);
    writeLimits('claude-b', 60, 60);
    writeLimits('claude-d', 60, 60);
    writeWeeklyOnly('gpt', 0);
    expect(sh('_swap_target claude-demo claude claude')).toBe('claude-a');
  });

  it('a home-able account wins a tie against the overflow lane — pool order is the tie-break', () => {
    install('gpt');
    writeLimits('claude', 99, 99);
    writeLimits('claude-a', 40, 40);
    writeLimits('claude-b', 60, 60);
    writeLimits('claude-d', 60, 60);
    writeWeeklyOnly('gpt', 40);
    expect(sh('_swap_target claude-demo claude claude')).toBe('claude-a');
  });

  it('_ws_least_loaded never places a workspace on the overflow lane, however free it looks', () => {
    // The same rows as `fixtures/leastLoaded.ts`'s `gpt-is-cheapest`, with the
    // lane INSTALLED this time — the one condition that fixture cannot express
    // and the one this change makes matter: enabled is what puts a lane in the
    // rotation, and it must still not put it in placement.
    install('gpt');
    writeLimits('claude', 70, 70);
    writeLimits('claude-a', 75, 75);
    writeLimits('claude-b', 60, 60);
    writeLimits('claude-d', 65, 65);
    writeWeeklyOnly('gpt', 0);
    expect(sh('_ws_least_loaded')).toBe('claude-b');
    expect(sh('_ws_least_loaded demo')).toBe('claude-b');
  });
});
