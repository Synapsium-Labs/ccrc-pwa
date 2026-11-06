// server/test/ccd-session-path.test.ts
//
// D-8050: every session starts with `$HOME/.local/bin` on its PATH. A pane's PATH is the tmux server's, which a
// supervised session inherits from the service manager, and that PATH does not hold the folder, so a bare `ccrc`,
// `ccd`, `ccrc-api` or `graphify` failed. These cases take the command string `_spawn_start` hands tmux and RUN it,
// from a PATH without the folder, through a stand-in wrapper of each account kind. The wrapper reports what its own
// process resolves, which is the PATH Claude Code then writes into its shell snapshot.
//
// FIXTURE HOME ONLY: ccd runs as sourced functions and no tmux server is started.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeCcdHarness, sessionPanePath, type CcdHarness } from './ccdWsHelpers.js';

const UUID = 'deadbeef-0000-4000-8000-000000000000';
const BOX_PATH = '/usr/bin:/bin';
const TOOL = 'fleet-tool-under-test';

/** `_spawn_start` emits BOTH lines when the `--resume` pane dies: the same substrate as `ccd-spawn-split.test.ts`. */
const RESUME_DIES = `sleep() { :; };
    tmux() {
      echo "tmux $*" >> "$HOME/ccd-calls"
      case "$1" in
        new-session)  case "$*" in *--session-id*) : > "$HOME/pane-up" ;; esac ;;
        has-session)  [[ -e "$HOME/pane-up" ]] ;;
        list-sessions) return 0 ;;
      esac
    };`;

/** The last step of each account kind, as `ccrc wrappers` writes it: every kind ends in an exec of a file in the folder. */
const REPORT = `#!/bin/sh\nprintf 'tool=%s\\npath=%s\\n' "$(command -v ${TOOL})" "$PATH" > "$HOME/session-report"\n`;
const KINDS = [
  { kind: 'upstream', wrapper: 'claude', target: null },
  { kind: 'generated', wrapper: 'lane-a', target: 'claude' },
  { kind: 'codex', wrapper: 'lane-b', target: 'ccrc-codex' },
] as const;

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-session-path-'); });
afterEach(() => { h.cleanup(); });

const bin = (): string => path.join(h.home, '.local', 'bin');
const put = (file: string, text: string): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, { mode: 0o755 });
};
const wrapperOf = ({ wrapper, target }: (typeof KINDS)[number]): void => {
  if (target === null) { put(path.join(bin(), wrapper), REPORT); return; }
  put(path.join(bin(), target), REPORT);
  put(path.join(bin(), wrapper), `#!/usr/bin/env bash\nexport CLAUDE_CONFIG_DIR="$HOME/.${wrapper}"\nexec "$HOME/.local/bin/${target}" "$@"\n`);
};
const spawnLines = (wrapper: string, workdir = h.home): string[] => {
  h.sh(`_reg_set myid wrapper ${wrapper}
        _reg_set myid workdir '${workdir}'
        _reg_set myid uuid ${UUID}`);
  h.sh(`${RESUME_DIES} rm -f "$HOME/pane-up"; _spawn_start myid resume 2>/dev/null`);
  const lines = h.calls().filter((c) => c.startsWith('tmux new-session'));
  expect(lines).toHaveLength(2);
  return lines.map((l) => {
    const m = /^tmux new-session -d -s \S+ -x \d+ -y \d+ (.*)$/.exec(l);
    expect(m, l).not.toBeNull();
    return m![1]!;
  });
};
/** What the pane does with the string: the same `-c` tmux gives its default shell, with only the pane's HOME and PATH. */
const runPane = (command: string, pathValue = BOX_PATH, shell = '/bin/sh'): Record<string, string> => {
  fs.rmSync(path.join(h.home, 'session-report'), { force: true });
  try {
    execFileSync(shell, ['-c', command], { env: { HOME: h.home, PATH: pathValue }, stdio: 'ignore', cwd: h.home });
  } catch { /* a pane that fails is a missing report, which each case reads */ }
  const report = path.join(h.home, 'session-report');
  if (!fs.existsSync(report)) return {};
  return Object.fromEntries(fs.readFileSync(report, 'utf8').trim().split('\n').map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1)];
  }));
};

describe('a started session has $HOME/.local/bin on its PATH (D-8050)', () => {
  it.each(KINDS)('$kind account: a bare tool in the folder resolves, on the primary line and on the retry', (account) => {
    wrapperOf(account);
    put(path.join(bin(), TOOL), '#!/bin/sh\n');
    const lines = spawnLines(account.wrapper);
    for (const line of lines) {
      expect(runPane(line).tool, line).toBe(path.join(bin(), TOOL));
    }
  });

  it.each(['/bin/sh', 'bash'])('runs the same under %s, the shell tmux may be configured with', (shell) => {
    wrapperOf(KINDS[0]);
    put(path.join(bin(), TOOL), '#!/bin/sh\n');
    const [primary] = spawnLines('claude');
    const resolved = shell === 'bash' ? execFileSync('/bin/sh', ['-c', 'command -v bash'], { encoding: 'utf8' }).trim() : shell;
    expect(runPane(primary!, BOX_PATH, resolved).tool).toBe(path.join(bin(), TOOL));
  });

  it('the folder is added last, so a tool the box already resolves keeps answering', () => {
    wrapperOf(KINDS[0]);
    const system = path.join(h.home, 'system-bin');
    put(path.join(system, TOOL), '#!/bin/sh\n');
    put(path.join(bin(), TOOL), '#!/bin/sh\n');
    const [primary] = spawnLines('claude');
    const report = runPane(primary!, `${system}:${BOX_PATH}`);
    expect(report.tool).toBe(path.join(system, TOOL));
    expect(report.path).toBe(`${system}:${BOX_PATH}:${bin()}`);
  });

  it.each([
    ['first', (b: string) => `${b}:${BOX_PATH}`],
    ['in the middle', (b: string) => `/usr/bin:${b}:/bin`],
    ['last', (b: string) => `${BOX_PATH}:${b}`],
  ])('a PATH that already holds the folder %s is left exactly as it was', (_where, pathOf) => {
    wrapperOf(KINDS[0]);
    const [primary] = spawnLines('claude');
    expect(runPane(primary!, pathOf(bin())).path).toBe(pathOf(bin()));
  });

  it('a directory that merely ends the same way does not count as the folder', () => {
    wrapperOf(KINDS[0]);
    const [primary] = spawnLines('claude');
    const other = `/opt${bin()}`;
    expect(runPane(primary!, `${other}:${BOX_PATH}`).path).toBe(`${other}:${BOX_PATH}:${bin()}`);
  });

  it('a workdir the pane cannot enter still stops the exec', () => {
    wrapperOf(KINDS[0]);
    const gone = path.join(h.home, 'gone');
    fs.mkdirSync(gone);
    const lines = spawnLines('claude', gone);
    fs.rmdirSync(gone);
    for (const line of lines) expect(runPane(line)).toEqual({});
  });

  it('the command names no machine: HOME and PATH stay literal for the pane to expand', () => {
    wrapperOf(KINDS[0]);
    const step = sessionPanePath(h);
    expect(step).toContain('$HOME/.local/bin');
    expect(step).not.toContain(h.home);
    for (const line of spawnLines('claude')) expect(line).toContain(`true; ${step}; cd '`);
  });
});
