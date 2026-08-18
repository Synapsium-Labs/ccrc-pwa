// D-B8-3 — arithmetic injection, swept and pinned.
//
// The class, stated once. Bash evaluates a variable's CONTENTS as an
// arithmetic expression, and a command substitution inside an array subscript
// EXECUTES. So a field holding `REG[$(cmd)]` runs `cmd` in EVERY arithmetic
// context that reads it — and arithmetic contexts are not only `(( ))` and
// `$(( ))`: `[[ x -ge|-lt|... y ]]` and array subscripts are too. The guard is
// not a `-n` test — that still hands the arithmetic its operand. Only
// `=~ ^[0-9]+$` placed FIRST inside the same `[[ ]]` guards, because that is
// what makes `&&` short-circuit before the arithmetic operand is evaluated.
//
// THREAT MODEL — say it plainly, as the commit does. None of the five swept
// sites is wire-reachable: the fields they read (`lastswap`, `lastcompact`)
// are written only by ccd's own `_reg_set` from `$(date +%s)`, and
// `SWAP_JITTER` is agent-set env, not wire-set. Exploiting one already needs
// write access to `~/.cc-sessions` as the fleet UNIX user. This is defence in
// depth against a TORN or hand-edited registry field, not a live-vulnerability
// fix. The one live wire-reachable instance was `cmd_ensure`'s positional,
// closed in 73bc0fe.
//
// Each payload test plants `REG[$(touch <marker>)]` in the source a site reads
// and asserts the marker never appears. Before the guards it appears (RED);
// after, `=~ ^[0-9]+$` short-circuits and it does not. The structural test
// then pins that a future edit dropping any guard is red even where no payload
// test walks that exact path.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { CCD, makeCcdHarness } from './ccdWsHelpers.js';

describe('arithmetic-injection containment (D-B8-3): no swept site evaluates a torn field', () => {
  it('_auto_swap_check does not evaluate a payload planted in lastswap', () => {
    const h = makeCcdHarness('arith-swap');
    // A torn or hand-edited `lastswap` is the threat model — not a wire caller.
    // Stubs keep the rest of the tick inert; the payload fires (or not) at the
    // cooldown line, which is reached before any swap decision.
    h.sh(
      '_reg_set myid wrapper claude; _reg_set myid home claude;'
      + " _reg_set myid lastswap 'REG[$(touch \"$HOME/PWNED-swap\")]';"
      + ' _home_for(){ echo claude; }; _swap_target(){ return 1; };'
      + ' _dispatch_swap(){ :; }; tmux(){ :; };'
      + ' _auto_swap_check myid || :');
    expect(existsSync(path.join(h.home, 'PWNED-swap'))).toBe(false);
    h.cleanup();
  });

  it('_auto_compact_check does not evaluate a payload planted in lastcompact', () => {
    const h = makeCcdHarness('arith-compact');
    h.sh(
      " _reg_set myid lastcompact 'REG[$(touch \"$HOME/PWNED-compact\")]';"
      + ' tmux(){ :; }; _pane_ctx_pct(){ :; };'
      + ' _auto_compact_check myid || :');
    expect(existsSync(path.join(h.home, 'PWNED-compact'))).toBe(false);
    h.cleanup();
  });

  it('_auto_compact_check does not evaluate a payload planted in lastswap', () => {
    const h = makeCcdHarness('arith-compact-swap');
    // lastcompact left unset so the lastcompact gate falls through to the
    // lastswap gate — the second arithmetic site inside the same function.
    h.sh(
      " _reg_set myid lastswap 'REG[$(touch \"$HOME/PWNED-compactswap\")]';"
      + ' tmux(){ :; }; _pane_ctx_pct(){ :; };'
      + ' _auto_compact_check myid || :');
    expect(existsSync(path.join(h.home, 'PWNED-compactswap'))).toBe(false);
    h.cleanup();
  });

  it('_spawn_start does not evaluate a payload planted in lastswap', () => {
    const h = makeCcdHarness('arith-spawn');
    // wrapper/workdir/uuid non-empty so the `incomplete registry` die does not
    // fire first; _tmux_server_ensure and tmux stubbed so the fromswap line is
    // reached and nothing real spawns. mode=new avoids the resume settle.
    h.sh(
      '_reg_set myid wrapper claude; _reg_set myid workdir "$HOME"; _reg_set myid uuid u1;'
      + " _reg_set myid lastswap 'REG[$(touch \"$HOME/PWNED-spawn\")]';"
      + ' _tmux_server_ensure(){ :; }; tmux(){ :; };'
      + ' _spawn_start myid new || :');
    expect(existsSync(path.join(h.home, 'PWNED-spawn'))).toBe(false);
    h.cleanup();
  });

  it('_dispatch_swap does not evaluate a payload sitting in SWAP_JITTER', () => {
    const h = makeCcdHarness('arith-jitter');
    // MEASURED, and it corrects the plan's table: this site is NOT reachable
    // from the environment. `ccd:54` is a bare `SWAP_JITTER=120`, not
    // `${SWAP_JITTER:-120}`, so sourcing ccd overwrites whatever the caller
    // exported — the operand is always ccd's own literal. Passing the payload
    // as env therefore proves nothing, and a test written that way is green
    // for a reason unrelated to the guard.
    //
    // So the hostile value is assigned AFTER the source, which is how it could
    // actually arrive: the day someone respells line 54 as `${SWAP_JITTER:-120}`
    // to make it tunable, or a future caller assigns it. The `-gt` is itself an
    // arithmetic context, reached before the `$(( RANDOM % ... ))`. The guard
    // degrades to jitter=0 — the documented pre-jitter behaviour.
    h.sh(
      ' SWAP_JITTER=\'REG[$(touch "$HOME/PWNED-jitter")]\';'
      + ' _dispatch_swap myid claude2 || :');
    expect(existsSync(path.join(h.home, 'PWNED-jitter'))).toBe(false);
    h.cleanup();
  });

  it('ccd assigns SWAP_JITTER unconditionally — the reason the env cannot reach that arithmetic', () => {
    // Pins the fact the test above depends on. If line 54 ever becomes
    // `${SWAP_JITTER:-120}`, this goes red and the reader is sent to the guard
    // that then starts carrying real weight instead of defence in depth.
    const src = readFileSync(CCD, 'utf8');
    expect(src).toMatch(/^SWAP_JITTER=[0-9]+\s/m);
    expect(src).not.toMatch(/^SWAP_JITTER=\$\{/m);
  });
});

describe('structural: every swept site guards its arithmetic operand with =~ ^[0-9] (mutation tripwire)', () => {
  // The population is fixed and enumerated. Each entry names a STABLE fragment
  // of the arithmetic (unchanged by the fix) and the token of the FIRST
  // arithmetic context on the line — the guard must sit before it. Drop a
  // guard and that site's row goes red naming the function, whether or not a
  // payload test happens to walk that path.
  const SITES: { fn: string; anchors: string[]; arith: string }[] = [
    { fn: '_auto_swap_check (lastswap cooldown)',   anchors: ['$((now - last))', 'SWAP_COOLDOWN'],    arith: '$((' },
    { fn: '_auto_compact_check (lastcompact)',      anchors: ['$((now - last))', 'COMPACT_COOLDOWN'], arith: '$((' },
    { fn: '_auto_compact_check (lastswap)',         anchors: ['$((now - lastswap))', 'COMPACT_COOLDOWN'], arith: '$((' },
    { fn: '_spawn_start (fromswap)',                anchors: ['- lastswap ))', '-lt 300'],            arith: '$((' },
    { fn: '_dispatch_swap (SWAP_JITTER)',           anchors: ['RANDOM % (SWAP_JITTER + 1)'],          arith: '-gt' },
  ];
  const codeLines = readFileSync(CCD, 'utf8').split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('[['));   // the five sites are all `[[ … ]]` guards, never comments

  for (const site of SITES) {
    it(`${site.fn} carries =~ ^[0-9] before its arithmetic`, () => {
      const matches = codeLines.filter((l) => site.anchors.every((a) => l.includes(a)));
      expect(matches, `expected exactly one guarded line for ${site.fn}`).toHaveLength(1);
      const line = matches[0]!;
      const guardIdx = line.indexOf('=~ ^[0-9]');
      const arithIdx = line.indexOf(site.arith);
      expect(guardIdx, `${site.fn}: no \`=~ ^[0-9]\` guard on the line — a torn field would reach the arithmetic`).toBeGreaterThanOrEqual(0);
      expect(guardIdx, `${site.fn}: the \`=~ ^[0-9]\` guard sits AFTER the arithmetic; it must be first inside the same [[ ]] to short-circuit`).toBeLessThan(arithIdx);
    });
  }
});

describe('_pane_ctx_pct is the one sanitiser the compact arithmetic depends on (Step 7)', () => {
  it('returns digits-only for a pane carrying a payload', () => {
    const h = makeCcdHarness('arith-panepct');
    // `_auto_compact_check` feeds this output to `[[ "$pct" -ge THRESHOLD ]]`,
    // an arithmetic context. Pane text is genuinely attacker-influenced (a
    // session prints what it likes); this grep chain ending in `[0-9]+` is the
    // single point that keeps a payload out of that arithmetic. Do NOT add a
    // second guard downstream — one authoritative sanitiser is the right shape;
    // an unnamed dependency on it is not, which is why this test names it.
    const out = h.sh('_pane_ctx_pct \'ctx REG[$(touch "$HOME/PWNED-pane")] 45%\'');
    expect(out).toMatch(/^[0-9]*$/);
    expect(existsSync(path.join(h.home, 'PWNED-pane'))).toBe(false);
    h.cleanup();
  });
});

describe("_spawn_start's only failure mode is die (Step 8, D-B8-4)", () => {
  it('has no bare non-zero return — the split installed a door and this keeps it shut', () => {
    const h = makeCcdHarness('arith-spawnret');
    // Tasks 7/8 made every caller `_spawn_start "$id" <mode> || return $?`.
    // That early return skips `_reg_claim` (and `_ws_supervise` at ws-add /
    // ws-restore) — the exact writes Wave 1 moved earlier. It is unobservable
    // ONLY because `_spawn_start` has no `return` of its own: every failure is
    // a `die`. Add one non-zero `return` and cmd_ws_add leaves a live pane no
    // row claims and no unit watches — F8's shape, back through the split's door.
    const body = h.sh('type _spawn_start');
    expect(
      body,
      '`_spawn_start` grew a `return`; every `|| return $?` caller now skips `_reg_claim` — give those callers a claim on the failure path before landing this.',
    ).not.toMatch(/\breturn\s+[1-9]/);
    h.cleanup();
  });
});
