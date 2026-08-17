// Wave 3 §3.3. `_auto_swap_check` runs on the 5-second supervise tick and
// relocates a session between accounts. Two arms, already distinct in shipped
// code, and this file is the whole reason the distinction is safe to rely on:
//
//   RESCUE  — `_pane_hard_blocked` matched (limit/spend banner, or auth lost).
//             Swaps IMMEDIATELY, deliberately bypassing the idle gate, because
//             the session is stuck anyway. UNTOUCHED by this wave.
//   AFFINITY— returning home, or leaving because home hit SWAP_CEILING. Gated
//             on a clean turn boundary, otherwise unconditional. This one now
//             DEFERS while `$REG/<id>.hold` exists.
//
// A mid-wave worker must not have its session restarted and its transcript
// copied to another account because telemetry drifted. A BLOCKED mid-wave
// worker must still be rescued, or the hold becomes a way to strand a wedged
// wave. The existing `_auto_swap_check` suite (ccd-swap-refuse.test.ts) drives
// ONLY the rescue arm, so without this file the affinity defer would ship with
// no test at all in either direction.
//
// FIXTURE HOME ONLY (`makeCcdHarness`) — HOME is ccd's single isolation
// boundary and nothing here may reach the live registry, tmux, or systemd.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-auto-swap-hold-'); });
afterEach(() => { h.cleanup(); });

const ID = 'claude-demo';
const PANE_PID = '4242';

/** A live-looking session on `claude`, written with `_reg_set` — the same
 *  writer ccd uses. `lastswap`/`swapblocked` are deliberately absent so both
 *  cooldown gates are open and the test is about the hold rung alone. */
const seed = (): void => {
  fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
  h.sh(`_reg_set ${ID} uuid 11111111-1111-4111-8111-111111111111
    _reg_set ${ID} project demo
    _reg_set ${ID} workdir "$HOME/projects/demo"
    _reg_set ${ID} wrapper claude
    _reg_set ${ID} started 1`);
};

/** The AFFINITY arm's fixture, which nothing in the tree had: a pane at a
 *  clean prompt (no `esc to interrupt`, a `❯`), a pane pid, and a status file
 *  that says idle with a `statusUpdatedAt` far older than SWAP_CEIL_QUIET
 *  (30 s) — every gate open except the one under test. `_swap_target` and
 *  `_avail` are stubbed so the decision is not a function of the fixture
 *  roster's live telemetry. */
const AFFINITY_STUBS = `
  tmux() { case "\${1:-}" in
             capture-pane) printf '%s\\n' "❯ " ;;
             list-panes)   echo ${PANE_PID} ;;
           esac; return 0; };
  _swap_target() { echo claude2; }; _avail() { return 0; };
  _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };
`;

/** The RESCUE arm's fixture: a real limit banner, matched by the REAL
 *  `_pane_hard_blocked` (deliberately not stubbed — the classifier IS the
 *  discriminator this test is about). */
const RESCUE_STUBS = `
  tmux() { case "\${1:-}" in
             capture-pane) echo "API Error: 429 Too Many Requests" ;;
           esac; return 0; };
  _swap_target() { echo claude2; }; _avail() { return 0; };
  _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };
`;

const idleStatus = (): void => {
  const dir = path.join(h.home, '.claude', 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${PANE_PID}.json`),
    JSON.stringify({ status: 'idle', statusUpdatedAt: 1 }));
};

const hold = (reason = 'program:build8 wave:2/4 run:17'): void => {
  fs.writeFileSync(path.join(h.home, '.cc-sessions', `${ID}.hold`), reason);
};

describe('_auto_swap_check and a held workspace', () => {
  it('relocates an UNHELD session on the affinity path (the fixture really is open)', () => {
    // Written first and asserted first: without it, every negative below is
    // vacuous — a fixture that never dispatches proves nothing about a rung.
    seed(); idleStatus();
    h.sh(`${AFFINITY_STUBS} _auto_swap_check ${ID}`);
    expect(h.calls().join('\n')).toContain(`dispatch ${ID} -> claude2`);
  });

  it('does NOT relocate a HELD session on the affinity path', () => {
    seed(); idleStatus(); hold();
    h.sh(`${AFFINITY_STUBS} _auto_swap_check ${ID}`);
    expect(h.calls().join('\n')).not.toContain('dispatch');
    expect(h.reg(ID, 'lastswap'), 'a deferred tick stamps nothing').toBeNull();
  });

  it('STILL RESCUES a held session that is hard-blocked — a hold must not strand a wedged wave', () => {
    // The mutant this kills is placing the rung ahead of the rescue branch,
    // which reads as "a hold forbids relocation" and is the reading that
    // loses a wave: a worker on a rate-limited account with a hold standing
    // would never be evacuated, and the hold is exactly what stops a human
    // noticing quickly.
    seed(); hold();
    h.sh(`${RESCUE_STUBS} _auto_swap_check ${ID}`);
    expect(h.calls().join('\n')).toContain(`dispatch ${ID} -> claude2`);
  });

  it('defers on a present-but-unreadable hold — `-e` not `-f`', () => {
    // Matching the four existing hold readers: doubt reads as HELD. `-f`
    // sails straight past a directory at that path.
    seed(); idleStatus();
    fs.mkdirSync(path.join(h.home, '.cc-sessions', `${ID}.hold`));
    h.sh(`${AFFINITY_STUBS} _auto_swap_check ${ID}`);
    expect(h.calls().join('\n')).not.toContain('dispatch');
  });

  it('relocates again once the hold is released', () => {
    seed(); idleStatus(); hold();
    h.sh(`${AFFINITY_STUBS} _auto_swap_check ${ID}`);
    expect(h.calls().join('\n')).not.toContain('dispatch');
    fs.rmSync(path.join(h.home, '.cc-sessions', `${ID}.hold`));
    h.sh(`${AFFINITY_STUBS} _auto_swap_check ${ID}`);
    expect(h.calls().join('\n')).toContain(`dispatch ${ID} -> claude2`);
  });
});
