// The fixture HOME `ccd/ccrc-api` runs in, and the runner that runs it (D-7320; K5 tail, Task Q3h). Moved here from
// `ccrc-api.test.ts`, which built them inline, so `claimant-client-pin.test.ts` runs the client in the same HOME,
// with the same contained PATH (`ghContainedEnv`'s poisoned `tmux`, `systemctl` and `gh`), the same token document
// and the same `agent.env`, and never a copy of them. Nothing here touches the live HOME.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCRC_API, ghContainedEnv } from './ccdWsHelpers.js';

/** The token file as it really ships: a `#`-comment preamble above ONE value
 *  line. Measured on the fleet host 2026-08-26 — 23 preamble lines above a
 *  64-char value — and reproduced here because a fixture holding a bare token
 *  would let a `cat`-shaped read pass this whole file. */
export const tokenDoc = (token: string): string =>
  ['# ccrc box token — do not commit, do not print.',
   '# The server reads this with coord/token.ts\'s extractToken:',
   '# first non-blank, non-# line, whitespace stripped.',
   '',
   token, ''].join('\n');

/** The client's two config files in `home`: `~/.ccrc/agent.env` naming `serverUrl`, and the box token document. */
export function writeClientHome(home: string, serverUrl: string, token: string): void {
  fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  fs.mkdirSync(path.join(home, '.cc-secrets'), { recursive: true });
  fs.writeFileSync(path.join(home, '.ccrc', 'agent.env'),
    `CCRC_AGENT_TOKEN=irrelevant\nCCRC_SERVER_URL=${serverUrl}\n`);
  fs.writeFileSync(path.join(home, '.cc-secrets', 'ccrc-mail.token'), tokenDoc(token), { mode: 0o600 });
}

/** `stdinEpipe`: the child left before it read all of its stdin (a refusal that
 *  never reads it). That is the child's answer, not a harness failure, so it is
 *  recorded here and every other stdin error still throws. */
export type Run = { stdout: string; stderr: string; status: number; stdinEpipe: boolean };

/** Runs the client (or `cmd`, a fixed driver script that runs it) in `home`. ASYNC, and that is not a style choice:
 *  a fake server a suite starts listens in THIS process, so a synchronous `execFileSync` would block the event
 *  loop for as long as the child runs — the server could never accept the
 *  connection, and every call would sit until curl's own `-m` bound expired.
 *  Measured while writing `ccrc-api.test.ts`: 30047ms per case, `seen` empty, which reads
 *  exactly like a broken client and is not one.
 *
 *  Never rejects on a non-zero exit: the exit status is part of what these tests
 *  measure, so turning it into an exception would hide it. */
export function runClient(home: string, args: string[], input?: string,
                          overrides?: Record<string, string | undefined>, cmd: string = CCRC_API): Promise<Run> {
  const env = ghContainedEnv(home, { ...process.env, HOME: home }, { systemd: true, tmux: true });
  // EXPLICIT, NEVER INHERITED. `process.env` is spread above, so a developer
  // running this suite inside a tmux pane hands the child a real TMUX_PANE and
  // the "no pane" case would measure their terminal instead of the fixture.
  // `undefined` DELETES — the state cron and CI are actually in.
  for (const [k, v] of Object.entries(overrides ?? {})) {
    if (v === undefined) delete env[k]; else env[k] = v;
  }
  return new Promise<Run>((resolve) => {
    const child = spawn(cmd, args, { env });
    let stdout = '', stderr = '', stdinEpipe = false;
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.stdin.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code !== 'EPIPE') throw e;
      stdinEpipe = true;
    });
    // stdin is CLOSED unless a test supplies input. Left open, `--json -` would
    // block in `cat` forever — the client is right to wait, so the harness must
    // be explicit about there being nothing to read.
    if (input !== undefined) child.stdin.end(input); else child.stdin.end();
    child.on('close', (code) => resolve({ stdout, stderr, status: code ?? -1, stdinEpipe }));
  });
}
