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
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { itLinux, itDarwin, platformContrast } from './platformFixtures.js';

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

  // ANSWERED 2026-09-14, and the answer is the one this case was written to
  // rule out: BSD grep -r BLOCKS. Measured on macos-latest — the walk never
  // returned and the harness cut it at 20 026 ms, where GNU returns in 83 ms.
  // So D-2739's suspected mechanism is confirmed, and a TIMEOUT on the caller
  // was never the right remedy: it converts a silent wedge into a loud one and
  // still reads no files. `ccd-account-auth.test.ts`'s canary walk now uses
  // `find -type f`, which cannot reach a device at all.
  //
  // This PINS the platform fact, so it stays green while the behaviour holds
  // and goes red the day BSD grep changes — at which point the remedy can be
  // revisited rather than silently over-applied.
  // A GENUINE CONTRAST, so it is written as one (D-2765). The two arms assert
  // OPPOSITE outcomes over an identical tree, which is the whole finding — and
  // `platformContrast` is the only shape that cannot be written with one of
  // them missing.
  platformContrast('a recursive grep over a tree containing a live FIFO', {
    darwin: ['BSD BLOCKS on it — D-2739, measured', () => {
      const r = bash(program(), 10_000);
      expect(
        r.cut,
        'BSD grep -r COMPLETED over a tree containing a live FIFO. That contradicts the 2026-09-14\n'
        + 'measurement (cut at 20026ms) and means D-2739\'s remedy may no longer be needed.\n'
        + `  elapsed: ${r.ms}ms  output: ${r.stdout.slice(0, 200)}`,
      ).toBe(true);
    }],
    linux: ['GNU skips the device and returns at once', () => {
      const r = bash(program());
      expect(r.cut, `GNU grep blocked on a FIFO, which contradicts the measured control. ${r.stdout.slice(0, 200)}`).toBe(false);
      expect(field(r.stdout, 'HITS'), `GNU grep did not find the plain file. ${r.stdout.slice(0, 200)}`).toBe('1');
    }],
  });

  // PLATFORM-ONLY: GNU's answer here is not in question — `-r` does not follow
  // symlinks and `-R` does, which is documented and stable. This case exists
  // only to rule the symlink OUT as a second cause of D-2739 on BSD, and it
  // measured negative. A GNU arm would assert a fact nobody doubted.
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

  // THE SECOND GENUINE CONTRAST — and the one the D-2765 lesson came from. The
  // Linux arm is not decoration: it is what distinguishes "BSD's deadline
  // behaves this way" from "every deadline does".
  platformContrast('the deadline on an ordinary sleeper', {
    darwin: ['BSD fires it — D-2661 candidate (a), refuted', () => {
      const r = bash(shim('2', 'sleep 60'), 30_000);
      expect(
        r.cut,
        `_auth_timeout did not return at all on macOS with a 2s deadline (harness cut at ${r.ms}ms).\n`
        + `  picked: ${field(r.stdout, 'PICKED')}\n  THIS IS D-2661's candidate (a): the deadline never fires.`,
      ).toBe(false);
      expect(
        field(r.stdout, 'RC'),
        'the deadline did not report 124 on macOS.\n'
        + `  picked=${field(r.stdout, 'PICKED')} rc=${field(r.stdout, 'RC')} elapsed=${field(r.stdout, 'ELAPSED')}s`,
      ).toBe('124');
    }],
    linux: ['GNU fires it too, and picks the unprefixed binary', () => {
      const r = bash(shim('2', 'sleep 60'), 30_000);
      expect(field(r.stdout, 'RC'), `linux control: ${r.stdout.slice(0, 200)}`).toBe('124');
      expect(field(r.stdout, 'PICKED'), 'linux should find GNU timeout first').toBe('timeout');
    }],
  });

  // NOT A PLATFORM QUESTION, and calling it one was the error (D-2765). This
  // case first ran only on darwin and red there, which read as "BSD cannot cut
  // a TERM-ignoring child". The Linux control that would have discriminated
  // was never written — and when it was, Linux behaved IDENTICALLY: the shim
  // never returned and the harness cut it at 25 s. `timeout`/`gtimeout` send
  // TERM and, without `-k`, never escalate to KILL.
  //
  // So this is a defect in the shim, on every platform, BOOKED AS D-2764 and
  // deliberately not fixed here: `_auth_timeout` is pinned byte-for-byte to
  // `_plat_timeout`, which lives in four shipped files behind ccd's tmux
  // liveness probe, its gh queries and the doctor's checks. That is a change
  // to deployed code and belongs in its own PR, not in a measurement one.
  //
  // IT PINS TODAY'S BEHAVIOUR ON PURPOSE. When D-2764 lands, this case goes
  // RED — which is the mechanism that forces whoever fixes it to come here and
  // invert it, rather than leaving a stale assertion behind.
  it('the deadline does NOT escalate to KILL — on BOTH platforms (D-2764, booked)', () => {
    const r = bash(shim('2', 'trap "" TERM; sleep 30'), 8_000);
    expect(
      r.cut,
      'the shim ENDED a TERM-ignoring child. If D-2764 has been fixed, invert this case;\n'
      + 'if it has not, the shim changed underneath us and that is worth knowing.\n'
      + `  elapsed: ${r.ms}ms  picked: ${field(r.stdout, 'PICKED')}  rc: ${field(r.stdout, 'RC')}`,
    ).toBe(true);
  });

  // PLATFORM-ONLY: the Linux answer to this one is already measured and is not
  // in dispute — EOF arrived in all six configurations tried, including a
  // setsid'd grandchild confirmed alive. This asks it of the platform where
  // D-2661 was observed, which is the only place the answer was unknown.
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

});
