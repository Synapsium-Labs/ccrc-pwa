// server/test/ccd-lifecycle-emit.test.ts
//
// The lifecycle journal's own vocabulary and clock, read by EXECUTING ccd rather
// than grepping it — `wrapper-roster-fixture.test.ts`'s rule: compare a SET
// against ccd's own answer space, BOTH DIRECTIONS, never "each row got an
// answer". `_LC_ACTS` is a declared bash array, so `"${_LC_ACTS[@]}"` is the
// strongest reading available.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LIFECYCLE_ACTS, LIFECYCLE_OUTCOMES, LC_ACT_UNKNOWN, LC_OUTCOME_UNKNOWN } from '../../shared/api.js';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { NO_TMUX, readJournal, measOf, decOf } from './lifecycleHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-lc-emit-'); });
afterEach(() => { h.cleanup(); });

const lines = (s: string): string[] => s.split('\n').map((l) => l.trim()).filter(Boolean);

describe('_LC_ACTS / _LC_OUTCOMES — the closed vocabularies, bound to L0', () => {
  it('is set-equal to LIFECYCLE_ACTS minus the degrade name, BOTH directions', () => {
    // Mutant: drop `attic-drop` from `_LC_ACTS` -> this fails with
    // `expected [ …20 acts… ] to deeply equal [ …21 acts… ]`, and an act ccd
    // emits would degrade to `unknown` on a build that models it perfectly well.
    const want = LIFECYCLE_ACTS.filter((a) => a !== LC_ACT_UNKNOWN);
    expect(want.length, 'guards the guard: an empty want passes everything').toBe(21);
    const got = lines(h.sh('printf "%s\\n" "${_LC_ACTS[@]}"'));
    expect([...got].sort()).toEqual([...want].sort());
    expect(got, 'unknown is the READER\'s degrade, never a call site\'s choice')
      .not.toContain(LC_ACT_UNKNOWN);
  });

  it('spells every act kebab-lowercase', () => {
    // Independent claims — one per act — so a failure on one act must not
    // hide whether the other 20 also fail. expect.soft per the standing rule
    // (this file's sibling `lifecycle-constants-twin.test.ts:108-109`).
    for (const a of lines(h.sh('printf "%s\\n" "${_LC_ACTS[@]}"'))) {
      expect.soft(a, `${a} is not kebab-lowercase`).toMatch(/^[a-z][a-z-]*$/);
    }
  });

  it('is set-equal to LIFECYCLE_OUTCOMES minus the degrade name, BOTH directions', () => {
    // Symmetric with the acts case above, and for the same reason: the
    // vocabulary is the set of ACCEPTABLE INPUTS, and the degrade word is the
    // OUTPUT `_lc_emit` produces when an input is not in that set. If a
    // caller's token could legitimately BE `unknown`, "the outcome genuinely
    // was unknown" and "the caller passed a token we could not recognise"
    // would collapse into one value, and `badoutcome` — which exists to
    // preserve the raw token — would become unreachable for that input.
    const want = LIFECYCLE_OUTCOMES.filter((o) => o !== LC_OUTCOME_UNKNOWN);
    expect(want.length, 'guards the guard: an empty want passes everything').toBe(4);
    const got = lines(h.sh('printf "%s\\n" "${_LC_OUTCOMES[@]}"'));
    expect([...got].sort()).toEqual([...want].sort());
    expect(got, 'unknown is the READER\'s degrade, never a call site\'s choice')
      .not.toContain(LC_OUTCOME_UNKNOWN);
  });
});

describe('_lc_now_ns — 19 digits, always', () => {
  it('answers 19 ASCII digits on a box whose date supports %N', () => {
    expect(h.sh('_lc_now_ns')).toMatch(/^[0-9]{19}$/);
  });

  it('still answers 19 digits when date cannot do %N — never the literal N', () => {
    // Mutant: delete the `[[ "$ns" =~ ^[0-9]{19}$ ]] ||` fallback rung -> this
    // fails with `expected '1787327575N' to match /^[0-9]{19}$/`, and the
    // generation filename would sort wrong for ever after.
    const out = h.sh('date() { case "$*" in *%N*) echo "1787327575N" ;; *) echo 1787327575 ;; esac; }; _lc_now_ns');
    expect(out).toMatch(/^[0-9]{19}$/);
    expect(out).toBe('1787327575000000000');
  });

  it('answers 19 digits even when date cannot be run at all', () => {
    expect(h.sh('date() { return 127; }; _lc_now_ns')).toMatch(/^[0-9]{19}$/);
  });
});

describe('_lc_tx — a correlation id, minted at the call site, never a global', () => {
  it('is uid-shaped and distinct across two calls in one process', () => {
    const out = h.sh('a=$(_lc_tx); b=$(_lc_tx); printf "%s\\n%s\\n" "$a" "$b"');
    const [a, b] = lines(out);
    // Independent claims about two DIFFERENT variables — expect.soft per the
    // standing rule, so a shape failure on `a` does not hide whether `b`
    // (a separate `_lc_tx()` call) also misbehaves.
    expect.soft(a).toMatch(/^[0-9]{19}\.[0-9]+\.[0-9]+$/);
    expect.soft(b).toMatch(/^[0-9]{19}\.[0-9]+\.[0-9]+$/);
    expect.soft(a).not.toBe(b);
  });
});

describe('_lc_obs — kernel-observed, memoised, never a decision', () => {
  // Terminated with `;` after the closing `}` — a function definition is a
  // compound command, and several call sites below splice another statement
  // right after `${OBS}` on the SAME line (no newline to serve as the
  // separator bash otherwise needs): `f() { :; } g() { :; }` is a syntax
  // error, `f() { :; }; g() { :; }` is not.
  const OBS = `_lc_obs_probe() { _lc_obs; printf '%s' "$_LC_OBS"; };`;

  it('classifies a supervisor cgroup and keeps the raw path verbatim', () => {
    const raw = '/user.slice/user-1000.slice/user@1000.service/app.slice/claude-session@ccrc-pwa-still-river.service';
    const o = JSON.parse(h.sh(`${OBS}
      _lc_cgroup_read() { printf '%s' '${raw}'; }
      _lc_obs_probe`)) as Record<string, unknown>;
    expect(o['cg']).toBe('supervisor');
    expect(o['cgraw'], 'the raw path is NEVER dropped — it is the unforgeable half').toBe(raw);
  });

  it.each([
    ['/user.slice/x/app.slice/ccrc-agent.service', 'agent'],
    ['/user.slice/x/app.slice/tmux-spawn-3f2a.scope', 'pane'],
    ['/user.slice/user-1000.slice/session-7.scope', 'login'],
    ['/some/thing/nobody/modelled', 'unknown'],
  ])('resolves %s to %s', (raw, want) => {
    const o = JSON.parse(h.sh(`${OBS} _lc_cgroup_read() { printf '%s' '${raw}'; }; _lc_obs_probe`)) as Record<string, unknown>;
    expect(o['cg']).toBe(want);
  });

  it('a pane inside a SUPERVISOR cgroup reads `pane` — the precedence is deliberate', () => {
    // Mutant: move the `claude-session@*.service` arm above the
    // `tmux-spawn-*.scope` one -> this fails with `expected 'supervisor' to be
    // 'pane'`. The supervisor is what STARTED the process; the pane scope is
    // where it is RUNNING, and the innermost fact is the observed one.
    const raw = '/user.slice/user@1000.service/app.slice/claude-session@x.service/tmux-spawn-9.scope';
    const o = JSON.parse(h.sh(`${OBS} _lc_cgroup_read() { printf '%s' '${raw}'; }; _lc_obs_probe`)) as Record<string, unknown>;
    expect(o['cg']).toBe('pane');
  });

  it('says WHY there is no pane rather than answering a bare null', () => {
    const o = JSON.parse(h.sh(`${OBS}
      _lc_cgroup_read() { printf '%s' '/x'; }
      ${NO_TMUX}
      command() { if [[ "$2" == tmux ]]; then return 1; fi; builtin command "$@"; }
      _lc_obs_probe`)) as Record<string, unknown>;
    expect(o['pane']).toBeNull();
    expect(o['paneWhy'], 'a null with no reason is the overloaded null this file bans').toBe('no-tmux');
  });

  it('says `not-listed` when tmux is there and does not answer — the harness default', () => {
    const o = JSON.parse(h.sh(`${OBS} _lc_cgroup_read() { printf '%s' '/x'; }; _lc_obs_probe`)) as Record<string, unknown>;
    expect(o['paneWhy'], 'the harness plants a REFUSING tmux, so this is the default answer')
      .toBe('not-listed');
    expect(h.tmuxCalls(), 'and it reached the poison, never the live server').toEqual(['list-panes -a -F #{session_name} #{pane_pid}']);
  });

  it('names the tmux session when an ancestor pid is a pane pid', () => {
    const o = JSON.parse(h.sh(`${OBS}
      _lc_cgroup_read() { printf '%s' '/x'; }
      tmux() { echo "cc-claude2 $$"; }
      _lc_obs_probe`)) as Record<string, unknown>;
    expect(o['pane']).toBe('cc-claude2');
    expect(o['paneWhy']).toBe('ok');
  });

  it('carries ssh as the CONNECTION STRING and tty as a boolean', () => {
    // L0's LifecycleObs: `ssh: string | null`, `tty: boolean | null`. A boolean
    // ssh would throw away the only address the record ever sees.
    const o = JSON.parse(h.sh(`${OBS}
      _lc_cgroup_read() { printf '%s' '/x'; }
      SSH_CONNECTION='10.0.0.2 51000 10.0.0.9 22'
      _lc_obs_probe`)) as Record<string, unknown>;
    expect(o['ssh']).toBe('10.0.0.2 51000 10.0.0.9 22');
    expect(typeof o['tty']).toBe('boolean');
  });

  it('survives an UNSET $SSH_CONNECTION and answers ssh:null — the fleet-wide hazard', () => {
    // ccd runs `set -uo pipefail`: a bare `"$SSH_CONNECTION"` read is FATAL to
    // the whole invocation for every caller that is not an interactive ssh
    // login, which is most of the fleet. `unset` here (rather than relying on
    // the harness's ambient env, which happens not to carry it) makes the
    // absence explicit rather than incidental, so this test still means what
    // it says even if a future harness starts forwarding the operator's shell
    // env. Two independent claims — process survival and the null shape — so
    // expect.soft per the standing rule.
    const out = h.sh(`unset SSH_CONNECTION
      ${OBS}
      _lc_cgroup_read() { printf '%s' '/x'; }
      _lc_obs_probe`);
    const o = JSON.parse(out) as Record<string, unknown>;
    expect.soft(o['ssh'], 'unset reads as null — not a thrown error, not an empty string mistaken for set').toBeNull();
    expect.soft(typeof o['tty'], 'the rest of the fragment still measures normally').toBe('boolean');
  });

  it('MEMOISES — /proc and tmux are read once per process, not once per event', () => {
    // Mutant: delete the `[[ -z "$_LC_OBS" ]] || return 0` guard -> this fails
    // with `expected 3 to be 1`, and every emit re-shells `tmux list-panes`.
    const out = h.sh(`${OBS}
      _lc_cgroup_read() { printf '%s' '/x'; }
      tmux() { echo tmuxcall >> "$HOME/obs-calls"; echo "none 999999"; }
      _lc_obs; _lc_obs; _lc_obs
      wc -l < "$HOME/obs-calls"`);
    expect(Number(out.trim())).toBe(1);
  });

  it('answers the four bytes `null` — never a fabricated object — when python3 is gone', () => {
    const out = h.sh(`${OBS}
      _lc_cgroup_read() { printf '%s' '/x'; }
      python3() { return 127; }
      _lc_obs_probe`);
    expect(out.trim()).toBe('null');
  });

  it('never writes to stdout or stderr of its own accord', () => {
    expect(h.sh(`_lc_cgroup_read() { printf '%s' '/x'; }; _lc_obs 2>&1; printf END`)).toBe('END');
  });
});
