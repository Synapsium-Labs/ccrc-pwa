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
import { spawnSync } from 'node:child_process';
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
const REPORT = `#!/bin/sh\nprintf 'tool=%s\\npath=%s\\npid=%s\\nargs=%s\\npwd=%s\\n' "$(command -v ${TOOL})" "$PATH" "$$" "$#:$*" "$PWD" > "$HOME/session-report"\n`;
/** Each shell a pane may have, as `ccd-workdirid.test.ts` lists them: `sh` and `bash` everywhere, the rest where installed. */
const onPath = (name: string): string =>
  (process.env['PATH'] ?? '').split(':').filter(Boolean).map((d) => path.join(d, name)).find((f) => fs.existsSync(f)) ?? '';
const SHELLS: ReadonlyArray<readonly [string, string, boolean]> = [
  ['sh', '/bin/sh', true], ['bash', onPath('bash'), true],
  ['dash', onPath('dash'), false], ['zsh', onPath('zsh'), false], ['fish', onPath('fish'), false],
];
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
/** `os` picks the arm, as `CCD_OS` does in `ccd-route-spawn.test.ts`. Darwin is the arm whose whole line a fish pane can
 *  read: on Linux the tool-child's `${...-}` is not fish syntax, so that pane parses nothing with or without this step. */
const spawnLines = (wrapper: string, workdir = h.home, os?: 'linux' | 'darwin'): string[] => {
  h.sh(`_reg_set myid wrapper ${wrapper}
        _reg_set myid workdir '${workdir}'
        _reg_set myid uuid ${UUID}`);
  h.sh(`${os === undefined ? '' : `CCD_OS=${os}; `}${RESUME_DIES} rm -f "$HOME/pane-up"; _spawn_start myid resume 2>/dev/null`);
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
  // A pane that fails is a missing report, which each case reads.
  const { pid } = spawnSync(shell, ['-c', command], { env: { HOME: h.home, PATH: pathValue }, stdio: 'ignore', cwd: h.home });
  const report = path.join(h.home, 'session-report');
  if (!fs.existsSync(report)) return {};
  const fields = Object.fromEntries(fs.readFileSync(report, 'utf8').trim().split('\n').map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1)];
  }));
  return { ...fields, panePid: String(pid) };
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

  for (const [name, shell, needed] of SHELLS) {
    it.skipIf(!needed && shell === '')(`under ${name}, a shell a pane may have: both lines start the wrapper with the folder last`, () => {
      expect(shell, `${name} is on the suite's PATH`).not.toBe('');
      wrapperOf(KINDS[0]);
      put(path.join(bin(), TOOL), '#!/bin/sh\n');
      for (const line of spawnLines('claude', h.home, 'darwin')) {
        const report = runPane(line, BOX_PATH, shell);
        expect(report.tool, line).toBe(path.join(bin(), TOOL));
        expect(report.path).toBe(`${BOX_PATH}:${bin()}`);
      }
    });
  }

  it('every word outside single quotes is one all those shells read, so no pane has to run on a fish binary to prove it', () => {
    wrapperOf(KINDS[0]);
    for (const line of spawnLines('claude', h.home, 'darwin')) {
      const outside = line.replace(/'[^']*'/g, "''");
      expect(outside, 'a shell that cannot parse one word runs none of the string').not.toMatch(/\b(case|esac|if|fi|for|while|done)\b|[{}]|\$\(/);
    }
  });

  it('the wrapper keeps the pane: no process stays between them, and its arguments arrive whole', () => {
    wrapperOf(KINDS[0]);
    const lines = spawnLines('claude');
    const report = runPane(lines[1]!);
    expect(report.pid).toBe(report.panePid);
    expect(report.args).toBe(`5:--effort high --session-id ${UUID} --dangerously-skip-permissions`);
  });

  it('a workdir reached through a link keeps its logical spelling, as the pane entered it', () => {
    wrapperOf(KINDS[0]);
    const real = path.join(h.home, 'real');
    const link = path.join(h.home, 'link');
    fs.mkdirSync(real);
    fs.symlinkSync(real, link);
    for (const line of spawnLines('claude', link)) expect(runPane(line).pwd).toBe(link);
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

  it('the graphify gate\'s own command, and a bare graphify, answer in a started session (D-8333)', () => {
    const hook = fs.readFileSync(path.join(__dirname, '..', '..', 'ccd', 'session-hook.sh'), 'utf8');
    const run = /^GRAPH_RUN='(.*)'$/m.exec(hook)?.[1];
    expect(run, 'the hook defines the command it teaches').toBeTruthy();
    put(path.join(bin(), 'graphify'), '#!/bin/sh\nprintf \'Traversal: %s\\n\' "$*"\n');
    put(path.join(bin(), 'claude'), `#!/bin/sh\n{ ${run} query "gate"; graphify query "bare"; } > "$HOME/session-report" 2>&1\n`);
    for (const line of spawnLines('claude')) {
      fs.rmSync(path.join(h.home, 'session-report'), { force: true });
      spawnSync('/bin/sh', ['-c', line], { env: { HOME: h.home, PATH: BOX_PATH }, stdio: 'ignore', cwd: h.home });
      expect(fs.readFileSync(path.join(h.home, 'session-report'), 'utf8'), line).toBe('Traversal: query gate\nTraversal: query bare\n');
    }
  });

  it('the command names no machine: HOME and PATH stay literal for the pane to expand', () => {
    wrapperOf(KINDS[0]);
    const step = sessionPanePath(h);
    expect(step).toContain('$HOME/.local/bin');
    expect(step).not.toContain(h.home);
    for (const line of spawnLines('claude')) expect(line).toContain(` ${step} '${bin()}/claude' `);
  });
});
