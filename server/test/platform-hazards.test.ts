// TWO QUESTIONS NO BOX HERE CAN ANSWER, asked of the platform that can.
//
// Both are left open by the D-2614 work and both are macOS-only, so this file
// is an INSTRUMENT rather than a guard: the darwin cases are written so the
// ANSWER travels in the assertion MESSAGE, because a red on a leg no box here
// runs is otherwise only the news that something is wrong. That shape is what
// closed D-2614 in one CI cycle after two rounds of reasoning got it backwards.
//
// ── D-2661: THE DEADLINE THAT DOES NOT FIRE ───────────────────────────────
// A 6-second `CCRC_AUTH_TIMEOUT` was measured running 60 046 ms on the `login`
// lane — the fixture's hard cap — so the deadline did not end the run. D-2738
// REFUTED the suspected cause: coreutils is installed on both macOS legs and
// `gtimeout` is on the default PATH, so "the binary is missing" is not it.
// D-2736's pump backstop now bounds the CONSEQUENCE, which means the symptom is
// masked and the cause is still unknown — the reason this asks the shim
// DIRECTLY rather than through the helper.
//
// Two candidates, and they need different fixes:
//   (a) the deadline does not fire at all;
//   (b) it fires, kills its direct child, and a DESCENDANT keeps the output
//       FIFO open so the reader never sees EOF. Measured on Linux across six
//       configurations: EOF always arrived once the deadline fired, including
//       with a setsid'd grandchild confirmed alive. If BSD differs, (b) is the
//       mechanism and it is the thing to fix.
//
// ── D-2739: WHAT A RECURSIVE GREP DOES TO A FIFO ──────────────────────────
// `ccd-account-auth.test.ts`'s canary case walks the fixture HOME, and the
// helper puts FIFOs in it. A 25-minute macOS job was cancelled with a `grep`
// alive in its orphan cleanup. GNU grep 3.11 skips devices under `-r` (measured
// here, returns at once); BSD is UNMEASURED and is the suspect. The call is
// already bounded so it reports instead of eating a job — this asks WHY.
import { describe, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { itLinux, itDarwin } from './platformFixtures.js';

const HELPER = path.resolve(__dirname, '../../ccd/ccd-account-auth');
const CANARY = 'CANARY_PLATFORM_HAZARD_TOKEN';

/** Run a bash program bounded by NODE, not by the shim under test — using
 *  `timeout` to measure `timeout` would be circular. Returns what happened,
 *  including whether it had to be cut. */
function bash(program: string, ms = 20_000): { cut: boolean; stdout: string; ms: number } {
  const t0 = Date.now();
  const r = spawnSync('bash', ['-c', program], { encoding: 'utf8', timeout: ms, stdio: ['ignore', 'pipe', 'pipe'] });
  const cut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  return { cut, stdout: (r.stdout ?? '') + (r.stderr ?? ''), ms: Date.now() - t0 };
}

const field = (out: string, key: string): string => {
  const m = new RegExp('^' + key + '=(.*)$', 'm').exec(out);
  return m ? m[1]!.trim() : '(absent)';
};

// ── D-2739 ────────────────────────────────────────────────────────────────
describe('a recursive grep over a tree that contains a FIFO (D-2739)', () => {
  /** A tree shaped like the fixture HOME: one ordinary file carrying the
   *  token, and a FIFO with a writer HELD OPEN, exactly as `_auth_open_pipes`
   *  holds fd 9. Without the held writer the reader sees EOF at once and the
   *  case measures a closed pipe rather than a live one. */
  const program = (extra = ''): string => `
    D=$(mktemp -d)
    mkdir -p "$D/tree/.auth/run"
    printf '%s\\n' '${CANARY}' > "$D/tree/plain.txt"
    mkfifo -m 600 "$D/tree/.auth/run/in.child"
    exec 9<>"$D/tree/.auth/run/in.child"
    ${extra}
    grep -rl '${CANARY}' "$D/tree" > "$D/hits" 2>"$D/err"; echo "RC=$?"
    echo "HITS=$(wc -l < "$D/hits" | tr -d ' ')"
    echo "ERR=$(head -c 120 "$D/err" | tr '\\n' ' ')"
    exec 9<&-; rm -rf "$D"
  `;

  itDarwin('BSD: it TERMINATES — if this reds, the FIFO is why the macOS job was cancelled', () => {
    const r = bash(program());
    expect(
      r.cut,
      'BSD grep -r BLOCKED on a FIFO with a live writer. That is D-2739\'s mechanism, and it means any\n'
      + 'recursive read of a tree the helper has touched can wedge until something kills it.\n'
      + `  elapsed: ${r.ms}ms (cut by the harness)\n  output so far: ${r.stdout.slice(0, 200)}`,
    ).toBe(false);
    expect(
      field(r.stdout, 'RC'),
      `BSD grep -r returned non-zero over the tree.\n  rc=${field(r.stdout, 'RC')}\n`
      + `  err=${field(r.stdout, 'ERR')}\n  full: ${r.stdout.slice(0, 200)}`,
    ).toBe('0');
  });

  itDarwin('BSD: does -r follow a SYMLINK out of the tree? (the second D-2739 candidate)', () => {
    // BSD and GNU have historically disagreed here, and a fixture HOME that
    // symlinks anywhere large would explain a slow walk without any FIFO.
    const r = bash(`
      D=$(mktemp -d); mkdir -p "$D/tree" "$D/outside"
      printf '%s\\n' '${CANARY}' > "$D/outside/hidden.txt"
      ln -s "$D/outside" "$D/tree/link"
      grep -rl '${CANARY}' "$D/tree" > "$D/hits" 2>/dev/null; echo "RC=$?"
      echo "FOLLOWED=$(grep -c hidden.txt "$D/hits" 2>/dev/null || echo 0)"
      rm -rf "$D"
    `);
    // RECORDED, not wished for: either answer is a fact worth having, so this
    // asserts only that we got one, and prints which.
    expect(
      r.cut,
      `the symlink probe itself was cut after ${r.ms}ms — that is its own finding`,
    ).toBe(false);
    expect(
      ['0', '1'],
      `MEASURED on BSD: grep -r ${field(r.stdout, 'FOLLOWED') === '1' ? 'FOLLOWS' : 'does NOT follow'}`
      + ` a symlink out of the tree (FOLLOWED=${field(r.stdout, 'FOLLOWED')}, rc=${field(r.stdout, 'RC')}).`,
    ).toContain(field(r.stdout, 'FOLLOWED'));
  });

  itLinux('GNU: skips the device and returns at once — the control', () => {
    const r = bash(program());
    expect(r.cut, `GNU grep blocked on a FIFO, which contradicts the measured control. ${r.stdout.slice(0, 200)}`).toBe(false);
    expect(field(r.stdout, 'HITS'), `GNU grep did not find the plain file. ${r.stdout.slice(0, 200)}`).toBe('1');
  });
});

// ── D-2661 ────────────────────────────────────────────────────────────────
describe('the deadline shim, asked directly (D-2661)', () => {
  /** Source the real helper and drive `_auth_timeout` itself. `CCRC_AUTH_NO_MAIN`
   *  is the helper's own test seam. Reports which binary it chose, because
   *  "which one ran" is half the question D-2738 left open. */
  const shim = (secs: string, child: string, extra = ''): string => `
    export CCRC_AUTH_NO_MAIN=1 HOME=$(mktemp -d)
    source ${JSON.stringify(HELPER)}
    echo "PICKED=$(command -v timeout >/dev/null 2>&1 && echo timeout || (command -v gtimeout >/dev/null 2>&1 && echo gtimeout || echo pure-bash-fallback))"
    ${extra}
    t0=$SECONDS
    _auth_timeout ${secs} bash -c ${JSON.stringify(child)} >/dev/null 2>&1
    echo "RC=$?"
    echo "ELAPSED=$((SECONDS-t0))"
  `;

  itDarwin('BSD: the deadline FIRES on an ordinary sleeper — candidate (a)', () => {
    const r = bash(shim('2', 'sleep 60'), 30_000);
    expect(
      r.cut,
      `_auth_timeout did not return at all on macOS with a 2s deadline (harness cut at ${r.ms}ms).\n`
      + `  picked: ${field(r.stdout, 'PICKED')}\n  THIS IS D-2661's candidate (a): the deadline never fires.`,
    ).toBe(false);
    expect(
      field(r.stdout, 'RC'),
      'the deadline did not report 124 on macOS.\n'
      + `  picked=${field(r.stdout, 'PICKED')} rc=${field(r.stdout, 'RC')} elapsed=${field(r.stdout, 'ELAPSED')}s\n`
      + '  If rc is 0 with a low elapsed, the shim returned WITHOUT waiting; if elapsed is ~60, it did not cut.',
    ).toBe('124');
  });

  itDarwin('BSD: it still ends a child that IGNORES SIGTERM', () => {
    const r = bash(shim('2', 'trap "" TERM; sleep 60'), 40_000);
    expect(
      r.cut,
      `a TERM-ignoring child was never cut on macOS (harness cut at ${r.ms}ms).\n`
      + `  picked: ${field(r.stdout, 'PICKED')}\n  A deadline that only TERMs cannot end this — D-2661 candidate.`,
    ).toBe(false);
    expect(
      field(r.stdout, 'ELAPSED'),
      `MEASURED: a TERM-ignoring child under a 2s deadline took ${field(r.stdout, 'ELAPSED')}s`
      + ` and returned rc=${field(r.stdout, 'RC')} (picked ${field(r.stdout, 'PICKED')}).`,
    ).not.toBe('(absent)');
  });

  itDarwin('BSD: after the deadline fires, does the output FIFO reach EOF? — candidate (b)', () => {
    // THE ONE THAT MATTERS. `_auth_pump` leaves only on EOF, and EOF needs every
    // writer of the FIFO to close. On Linux, EOF arrived in all six
    // configurations tried, including a setsid'd grandchild confirmed alive.
    const r = bash(`
      export CCRC_AUTH_NO_MAIN=1 HOME=$(mktemp -d)
      source ${JSON.stringify(HELPER)}
      D=$(mktemp -d); mkfifo -m 600 "$D/out"
      # a child that outlives its parent and keeps the inherited stdout open
      _auth_timeout 2 bash -c 'bash -c "sleep 60" & sleep 60' >"$D/out" 2>&1 &
      W=$!
      exec 8<"$D/out"
      t0=$SECONDS; GOT=none
      while :; do
        IFS= read -r -t 0.5 -u 8 line; rc=$?
        if (( rc == 1 )); then GOT=eof; break; fi
        if (( SECONDS - t0 > 15 )); then GOT=never; break; fi
      done
      echo "EOF=$GOT"
      echo "AFTER=$((SECONDS-t0))"
      kill $W 2>/dev/null; pkill -P $$ 2>/dev/null; exec 8<&-; rm -rf "$D"
    `, 40_000);
    expect(
      field(r.stdout, 'EOF'),
      'THE OUTPUT FIFO NEVER REACHED EOF after the deadline fired on macOS. That is D-2661 candidate (b)\n'
      + 'and it is the mechanism: a surviving descendant holds the write end, `_auth_pump` loops for ever,\n'
      + 'and only D-2736\'s backstop ends the run. The fix is to end the DESCENDANTS, not to wait longer.\n'
      + `  eof=${field(r.stdout, 'EOF')} after=${field(r.stdout, 'AFTER')}s  cut=${r.cut}`,
    ).toBe('eof');
  });

  itLinux('GNU: the same three, as the control this box CAN answer', () => {
    const plain = bash(shim('2', 'sleep 60'), 30_000);
    expect(field(plain.stdout, 'RC'), `linux control: ${plain.stdout.slice(0, 200)}`).toBe('124');
    expect(field(plain.stdout, 'PICKED'), 'linux should find GNU timeout first').toBe('timeout');
  });
});
