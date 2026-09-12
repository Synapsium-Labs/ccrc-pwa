// WHAT `script(1)` ACTUALLY DOES ON EACH USERLAND — the measurement D-2614 is
// missing.
//
// `ccd/ccd-account-auth` mints credentials for its two pane-bound methods by
// running the child under `script(1)`, spelled two ways (`_auth_script_argv`):
//
//     util-linux   script -qfc "<cmd>" /dev/null
//     BSD/macOS    script -q /dev/null <cmd> <args…>
//
// …with a FIFO on the SHELL's stdin (`<"$AUTH_RUN/in.child"`), which is how
// `_auth_forward_code` gets the operator's device code into the child.
//
// On macOS every case that EXECUTES fails with `the mint exited 1` (D-2614),
// while the three cases that only assert the argv STRING pass. The branch
// booked a hypothesis it could not measure from a Linux box — that BSD
// `script` calls `tcgetattr` on its own stdin and exits 1 when that is not a
// terminal. This file exists because that hypothesis is **weak on reading the
// source**: FreeBSD's `script.c` tolerates exactly that case —
//
//     if (tcgetattr(STDIN_FILENO, &tt) == -1 || ioctl(…, TIOCGWINSZ, …) == -1) {
//             if (errno != ENOTTY)        /* For debugger. */
//                     err(1, "tcgetattr/ioctl");
//             if (openpty(&master, &slave, NULL, NULL, NULL) == -1)
//     …
//
// — and `tcgetattr` on a FIFO sets `ENOTTY`, the one errno that branch
// forgives. So the stated cause may well not be the real one, and a fix built
// on it would be a change to a CREDENTIAL-MINTING path justified by a guess.
//
// There is a second candidate the branch never considered, and it fits the
// symptom (`exited 1`) at least as well: **exit-status propagation differs
// between the two implementations.** util-linux `script` returns the CHILD's
// status only with `-e`/`--return`, which `_auth_script_argv` does not pass —
// so on Linux a failing child can surface as rc 0 and be caught later by the
// helper's own "exited 0 but printed no token" guard. If BSD `script`
// propagates instead, the identical child turns into `the mint exited 1` on
// macOS alone, with nothing about stdin involved at all.
//
// These two causes call for OPPOSITE fixes — one changes what stdin is, the
// other changes how rc is read — so guessing costs a wrong change to a
// credential path plus a ~40-minute CI cycle to find out. The cases below
// answer both questions on the machine that can actually answer them, and
// leave a permanent statement of the contract `_auth_script_argv` depends on.
//
// Every case is DARWIN-ONLY by `itDarwin` except the linux control, which
// measures the same two questions of util-linux so the two answers can be read
// side by side in one place rather than inferred.
import { describe, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { itLinux, itDarwin } from './platformFixtures.js';

/** Run `script` the way `_auth_script_argv` spells it for this platform, over
 *  a child whose exit code we choose, with the SHELL's stdin in one of three
 *  shapes. Returns what the caller of the real helper would see: `script`'s
 *  own rc, plus both streams.
 *
 *  `stdin` is a bash redirection fragment spliced after the command, exactly
 *  where the helper puts its own `<"$AUTH_RUN/in.child"`. */
function probe(opts: { childExit: number; stdin: 'fifo' | 'devnull' | 'inherit' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccrc-script-probe-'));
  try {
    const fifo = path.join(dir, 'in.child');
    const q = JSON.stringify(fifo);
    // The child: a program with no terminal needs of its own, so the ONLY
    // thing that can vary the result is `script` and the stdin shape.
    const child = `/bin/sh -c 'exit ${opts.childExit}'`;
    const spelling = process.platform === 'darwin'
      ? `script -q /dev/null ${child}`
      : `script -qfc ${JSON.stringify(child)} /dev/null`;
    const redirect = opts.stdin === 'fifo' ? `<${q}`
      : opts.stdin === 'devnull' ? '</dev/null'
        : '';
    // `exec 9<>` holds the FIFO open for WRITING from this shell, exactly as
    // `_auth_open_pipes` does — without it the reader sees EOF immediately and
    // the case would measure a closed pipe rather than a live one.
    const program = [
      opts.stdin === 'fifo' ? `mkfifo -m 600 ${q}` : ':',
      opts.stdin === 'fifo' ? `exec 9<>${q}` : ':',
      `${spelling} ${redirect}`,
      'echo "SCRIPT_RC=$?"',
    ].join('\n');
    const r = spawnSync('bash', ['-c', program], { encoding: 'utf8', timeout: 30_000 });
    const m = /SCRIPT_RC=(\d+)/.exec(r.stdout ?? '');
    return {
      rc: m ? Number(m[1]) : null,
      stdout: r.stdout ?? '',
      stderr: r.stderr ?? '',
      spelling,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The whole measurement in one string, so a RED case in CI carries the answer
 *  rather than only the fact that it failed. This is the point of the file: on
 *  a platform no box here can run, the assertion message IS the instrument. */
const report = (r: ReturnType<typeof probe>) =>
  `\n  spelling: ${r.spelling}\n  script rc: ${r.rc}\n  stderr: ${JSON.stringify(r.stderr.slice(0, 400))}`;

describe('script(1) — the contract `_auth_script_argv` depends on (D-2614, D-2661)', () => {
  // ── QUESTION 1: does a FIFO on stdin make `script` refuse to run at all? ──
  // This is the branch's stated hypothesis. If it is right, this case fails
  // and the rc/stderr in the message name the reason. If it is wrong, the case
  // passes and the hypothesis is dead — which is just as useful.
  itDarwin('BSD: a FIFO on stdin does NOT stop it running the child', () => {
    const r = probe({ childExit: 0, stdin: 'fifo' });
    expect(r.rc, `BSD script refused a FIFO on stdin.${report(r)}`).toBe(0);
  });

  itDarwin('BSD: /dev/null on stdin runs the child too — the control for the FIFO case', () => {
    const r = probe({ childExit: 0, stdin: 'devnull' });
    expect(r.rc, `BSD script refused /dev/null on stdin.${report(r)}`).toBe(0);
  });

  // ── QUESTION 2: does it propagate the CHILD's exit status? ────────────────
  // The candidate the branch never considered. `the mint exited 1` is what the
  // helper reports when its `wait` sees rc 1 — so if BSD propagates and
  // util-linux does not, the two platforms disagree about a FAILING child
  // without anything being wrong with stdin at all.
  //
  // Deliberately NOT asserted as a specific value: which way BSD answers is
  // the open question, and pinning the answer we happen to want would make
  // this a wish rather than a measurement. It asserts only that the child
  // RAN — the rc is carried out in the message either way.
  itDarwin('BSD: how it reports a child that exits 7 — recorded, not wished for', () => {
    const seven = probe({ childExit: 7, stdin: 'fifo' });
    const zero = probe({ childExit: 0, stdin: 'fifo' });
    // Whatever the convention is, it must be CONSISTENT: rc cannot be the same
    // for a child that succeeded and one that failed AND also be meaningful.
    // This is the one thing `_auth_setup_token` genuinely relies on, since it
    // reads `rc` to decide between `expired`, `failed` and `done`.
    expect(
      { exit7: seven.rc, exit0: zero.rc },
      `BSD script exit-status propagation.${report(seven)}\n  (child exit 0 gave rc ${zero.rc})`,
    ).toEqual({ exit7: 7, exit0: 0 });
  });

  // ── THE LINUX CONTROL ────────────────────────────────────────────────────
  // Same two questions, asked of util-linux, so the difference is measured in
  // one file instead of remembered. If this case is RED, the helper's Linux
  // behaviour is not what its own callers assume and D-2614 is the smaller
  // half of the problem.
  itLinux('util-linux: runs the child over a FIFO, and reports rc 0 WITHOUT --return', () => {
    const seven = probe({ childExit: 7, stdin: 'fifo' });
    const zero = probe({ childExit: 0, stdin: 'fifo' });
    expect(zero.rc, `util-linux script over a FIFO.${report(zero)}`).toBe(0);
    // `_auth_script_argv` passes no `-e`/`--return`, so a FAILING child is
    // expected to surface as rc 0 here — which is precisely why the helper
    // carries its own "exited 0 but printed no token" guard. If this ever
    // becomes 7, that guard stops being the only thing catching a silent mint
    // and `_auth_setup_token`'s rc branches need re-reading.
    expect(seven.rc, `util-linux propagated a child failure it is not expected to.${report(seven)}`).toBe(0);
  });
});
