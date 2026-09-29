// A fixture box for the agent-role cases that run the REAL `ccd/ccrc` as the `--detach` parent (D-3411, D-3413): the
// agent's twin of `server/test/updateRealBox.ts` (the agent's tests do not import the server package's), holding the
// same containment — the env handed to the spawner is built FROM SCRATCH (HOME is the fixture, PATH is
// `<home>/bin:/usr/local/bin:/usr/bin:/bin`, never the operator's `~/.local/bin`), and a poisoned RECORDING
// `systemd-run` and `systemctl` sit first on that PATH (each appends its argv to `<home>/<name>-argv`; systemd-run either
// exits 97 or, with `systemdRun: 'hang'`, records its pid and blocks in `sleep`, and neither ever starts a unit), and
// `curl` is a stub (answers 200, or with `curl: 'sleep'` records its pid and sleeps past any bound).
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CCD_DIR = path.resolve(here, '..', '..', 'ccd');
export const CCRC_SRC = path.join(CCD_DIR, 'ccrc');

/** A TERMINAL report: byte-identity after a refused op means something only when there is a report to keep. */
export const TERMINAL_REPORT = '{"target":"v0.0.5","phase":"done","startedAt":1790000000,"updatedAt":1790000100,"detail":null,"from":"cli","pid":1}\n';

/** The launcher's bytes, out of `_inst_shim`'s own heredoc — the file `ccrc install` places at `~/.local/bin/ccrc`. */
export function shimBytes(): string {
  const src = readFileSync(CCRC_SRC, 'utf8');
  const m = /^_inst_shim\(\) \{[^\n]*\n {2}cat <<'CCRC_SHIM'\n([\s\S]*?)\nCCRC_SHIM\n/m.exec(src);
  if (m === null) throw new Error("_inst_shim's heredoc not found in ccd/ccrc");
  return `${m[1]}\n`;
}

function plant(file: string, body: string): void {
  writeFileSync(file, body);
  chmodSync(file, 0o755);
}

/** How the two stubs behave (D-3400 amended, D-3413). `systemdRun: 'hang'` RECORDS its argv and its own pid
 *  (`<home>/systemd-run-pid`) and then blocks in `sleep` — the real parent has written `queued` and waits in it, the
 *  state the bound kills; it still never starts a unit. `curl: 'sleep'` records and sleeps past any bound, so a
 *  `rollback` parent is stopped BEFORE its `queued` write. Neither ever touches the network or a unit manager. */
export interface RealBoxOpts { systemdRun?: 'poison' | 'hang'; curl?: 'ok' | 'sleep' }

/** Plants the box under `home` and returns the from-scratch env for the spawner. */
export function plantRealBox(home: string, opts: RealBoxOpts = {}): NodeJS.ProcessEnv {
  const bin = path.join(home, 'bin');
  mkdirSync(bin, { recursive: true });
  mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  mkdirSync(path.join(home, 'ccrc'), { recursive: true });
  symlinkSync(CCD_DIR, path.join(home, 'ccrc', 'ccd'));
  plant(path.join(home, '.local', 'bin', 'ccrc'), shimBytes());
  for (const name of ['systemd-run', 'systemctl']) {
    const hang = name === 'systemd-run' && opts.systemdRun === 'hang';
    plant(path.join(bin, name), `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/${name}-argv"\n${
      hang ? 'echo $$ > "$HOME/systemd-run-pid"\nexec sleep 300' : 'exit 97'}\n`);
  }
  plant(path.join(bin, 'curl'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/curl-argv"\n${
    opts.curl === 'sleep' ? 'echo $$ > "$HOME/curl-pid"\nexec sleep 300' : 'printf 200\nexit 0'}\n`);
  writeFileSync(path.join(home, '.ccrc', 'update.json'), TERMINAL_REPORT);
  return { HOME: home, PATH: `${bin}:/usr/local/bin:/usr/bin:/bin` };
}
