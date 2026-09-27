// WHAT `script(1)` ACTUALLY DOES ON EACH USERLAND — the measurement D-2614 was
// missing, and now has.
//
// `ccd/ccd-account-auth` mints credentials for its two pane-bound methods by
// running the child under `script(1)`, spelled two ways (`_auth_script_argv`):
//
//     util-linux   script -qfc "<cmd>" /dev/null
//     BSD/macOS    script -q /dev/null <cmd> <args…>
//
// …with a FIFO on the SHELL's stdin (`<"$AUTH_RUN/in.child"`), which is how
// `_auth_forward_code` gets the operator's device code into the child. The fd
// map at the top of that file states the channel: fd 7 in from the operator,
// fd 9 out to the child's stdin.
//
// ── ROUND 1 (macos-latest, 2026-09-12) — THE CAUSE IS SETTLED ──────────────
//
//     stdin = FIFO      →  rc 1, "script: tcgetattr/ioctl: Operation not
//                          supported on socket" — refused before the child runs
//     stdin = /dev/null →  rc 0, child runs
//
// D-2614's hypothesis was right, and the objection raised against it was wrong
// for a reason worth keeping. The objection read FreeBSD's `script.c` —
//
//     if (tcgetattr(STDIN_FILENO, &tt) == -1 || ioctl(…, TIOCGWINSZ, …) == -1) {
//             if (errno != ENOTTY)        /* For debugger. */
//                     err(1, "tcgetattr/ioctl");
//
// — and concluded a FIFO is forgiven, because a FIFO "is" ENOTTY. **It is not
// on macOS**: FIFOs there are implemented over the socket layer, so `tcgetattr`
// answers **ENOTSUP** ("Operation not supported on socket"), the `errno !=
// ENOTTY` guard is TRUE, and `err(1, …)` runs. The ERRNO decides, not the fd
// type — which no amount of reading the fd's name would have revealed.
//
// The `/dev/null` control is the load-bearing half: BSD does **not** require a
// tty here, only a stdin whose `tcgetattr` fails in the way it tolerates. So
// the fix need not be "give it a pty" or "take the code channel off a method".
//
// ── ROUND 2 — WHAT THIS FILE NOW ASKS ─────────────────────────────────────
//
// Which stdin shapes does BSD accept, and does any accepted one still CARRY
// BYTES? `/dev/null` is accepted and carries nothing, which is no use to
// `_auth_forward_code`. A regular file carries bytes but cannot deliver one
// that arrives later. A PIPE is live. **If a pipe is accepted, the fix is a
// shape swap on the darwin arm and nothing about the code channel has to
// move** — `cat "$AUTH_RUN/in.child" | script …` rather than `script … <fifo`.
// If no live shape is accepted, the fix is structural and needs a ruling on
// which method keeps the channel.
//
// The darwin cases are written so the ANSWER travels in the assertion MESSAGE,
// because a red on a leg no box here can run is otherwise only the news that
// something is wrong.
import { describe, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { itLinux, itDarwin } from './platformFixtures.js';

type Shape = 'fifo' | 'pipe' | 'devnull' | 'file' | 'inherit';

/** Does this shape carry bytes the child could still be waiting for? Only a
 *  LIVE one is a candidate to replace the FIFO. */
const LIVE: Record<Shape, boolean> = {
  fifo: true, pipe: true, devnull: false, file: false, inherit: false,
};

/** Run `script` as `_auth_script_argv` spells it for this platform, over a
 *  child whose exit code we choose, with the SHELL's stdin in one shape. */
function probe(opts: { childExit: number; stdin: Shape }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccrc-script-probe-'));
  try {
    const fifo = JSON.stringify(path.join(dir, 'in.child'));
    const reg = JSON.stringify(path.join(dir, 'regular'));
    const child = `/bin/sh -c 'exit ${opts.childExit}'`;
    const spelling = process.platform === 'darwin'
      ? `script -q /dev/null ${child}`
      : `script -qfc ${JSON.stringify(child)} /dev/null`;

    // `exec 9<>` on the FIFO case holds it open for writing exactly as
    // `_auth_open_pipes` does — without it the reader sees EOF at once and the
    // case would measure a closed pipe rather than a live one.
    //
    // `PIPESTATUS[1]` on the pipe case: `$?` there is already `script`, but
    // naming the stage keeps it honest if one is ever added.
    const program: Record<Shape, string[]> = {
      fifo: [`mkfifo -m 600 ${fifo}`, `exec 9<>${fifo}`, `${spelling} <${fifo}`, 'echo "SCRIPT_RC=$?"'],
      pipe: [`printf 'x\\n' | ${spelling}`, 'echo "SCRIPT_RC=${PIPESTATUS[1]}"'],
      devnull: [`${spelling} </dev/null`, 'echo "SCRIPT_RC=$?"'],
      file: [`printf 'x\\n' > ${reg}`, `${spelling} <${reg}`, 'echo "SCRIPT_RC=$?"'],
      inherit: [`${spelling}`, 'echo "SCRIPT_RC=$?"'],
    };
    const r = spawnSync('bash', ['-c', program[opts.stdin].join('\n')], {
      encoding: 'utf8', timeout: 30_000,
    });
    const m = /SCRIPT_RC=(\d+)/.exec(r.stdout ?? '');
    return { rc: m ? Number(m[1]) : null, stderr: (r.stderr ?? '').trim(), spelling };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const SHAPES: Shape[] = ['fifo', 'pipe', 'devnull', 'file', 'inherit'];

/** Sweep every shape once and render the table. This is the instrument: the
 *  whole answer has to survive into an assertion message. */
function sweep(childExit: number) {
  const rows = SHAPES.map((stdin) => ({ stdin, ...probe({ childExit, stdin }) }));
  const table = rows
    .map((r) => `    ${r.stdin.padEnd(8)} live=${String(LIVE[r.stdin]).padEnd(5)} rc=${String(r.rc).padEnd(4)} ${r.stderr.slice(0, 120)}`)
    .join('\n');
  return { rows, table };
}

describe('script(1) — the contract `_auth_script_argv` depends on (D-2614, D-2661)', () => {
  // ── THE ONE THAT DECIDES THE FIX ─────────────────────────────────────────
  // Accepted AND live is what `_auth_forward_code` needs. If this passes, the
  // darwin arm swaps shape and the code channel stays where it is. If it
  // fails, the table in the message says what IS accepted, and the fix becomes
  // a decision about which method keeps the channel rather than a swap.
  // PLATFORM-ONLY: util-linux accepts a FIFO outright (the control below
  // measures exactly that), so "which shape is accepted" is not a question
  // GNU has a non-trivial answer to. The contrast lives in the control.
  itDarwin('BSD: some LIVE stdin shape is accepted — that is what decides the fix', () => {
    const { rows, table } = sweep(0);
    const liveOk = rows.filter((r) => LIVE[r.stdin] && r.rc === 0).map((r) => r.stdin);
    expect(
      liveOk,
      'no live stdin shape is accepted by BSD script, so the code channel cannot simply change shape.\n'
      + `  spelling: ${rows[0]!.spelling}\n${table}`,
    ).not.toEqual([]);
  });

  // The control that proved the cause in round 1, kept because it is what says
  // "not a tty requirement" — the sentence the whole fix rests on.
  // PLATFORM-ONLY: this is the control WITHIN the BSD investigation — it
  // exists to show BSD wants a tolerable errno rather than a tty. GNU never
  // refuses in the first place, so the same probe there measures nothing.
  itDarwin('BSD: /dev/null is accepted, so this is not a tty requirement', () => {
    const r = probe({ childExit: 0, stdin: 'devnull' });
    expect(r.rc, `BSD script refused /dev/null.\n  spelling: ${r.spelling}\n  stderr: ${r.stderr}`).toBe(0);
  });

  // ── EXIT-STATUS PROPAGATION, asked only of a shape that RUNS ─────────────
  // Round 1 could not answer this: with a FIFO the child never ran, so rc 1 was
  // `script`'s own error and said nothing about propagation. Asked over
  // `/dev/null`, which does run, it is answerable — and it matters because
  // `_auth_setup_token` branches on `rc` to choose between `expired`, `failed`
  // and `done`. Recorded, not wished for: this asserts that rc DISTINGUISHES a
  // failed child from a good one, the property the helper actually relies on,
  // not any particular convention.
  // PLATFORM-ONLY: the util-linux side of THIS question is the control
  // below, which asserts the opposite outcome (rc 0 without --return). The
  // two are a pair in substance; they are not a `platformContrast` because
  // BSD needs /dev/null here and util-linux is asked over a FIFO.
  itDarwin('BSD: rc distinguishes a child that failed from one that did not', () => {
    const seven = probe({ childExit: 7, stdin: 'devnull' });
    const zero = probe({ childExit: 0, stdin: 'devnull' });
    expect(
      seven.rc === zero.rc,
      `BSD script reports the same rc (${seven.rc}) for a child that exited 7 and one that exited 0,`
      + ` so \`_auth_setup_token\`'s rc branches cannot tell them apart.\n  spelling: ${seven.spelling}`,
    ).toBe(false);
  });

  // ── THE LINUX CONTROL ────────────────────────────────────────────────────
  // The same questions of util-linux, so the difference is measured in one file
  // rather than remembered. MEASURED GREEN on this box 2026-09-12.
  // PLATFORM-ONLY: this IS the Linux control for the whole file, named for
  // its userland because the point is that util-linux and BSD disagree. It
  // answers the darwin cases above rather than pairing with any one.
  itLinux('util-linux: runs the child over a FIFO, and reports rc 0 WITHOUT --return', () => {
    const seven = probe({ childExit: 7, stdin: 'fifo' });
    const zero = probe({ childExit: 0, stdin: 'fifo' });
    expect(zero.rc, `util-linux script over a FIFO.\n  stderr: ${zero.stderr}`).toBe(0);
    // `_auth_script_argv` passes no `-e`/`--return`, so a FAILING child is
    // expected to surface as rc 0 here — which is precisely why the helper
    // carries its own "exited 0 but printed no token" guard. If this ever
    // becomes 7, that guard stops being the only thing catching a silent mint
    // and `_auth_setup_token`'s rc branches need re-reading.
    //
    // NOTE THE ASYMMETRY THIS PINS: on macOS the same child is expected to be
    // DISTINGUISHABLE by rc (the case above), so the two userlands disagree
    // about a failing mint and only one of them tells the helper.
    expect(seven.rc, `util-linux propagated a child failure it is not expected to.\n  stderr: ${seven.stderr}`).toBe(0);
  });
});
