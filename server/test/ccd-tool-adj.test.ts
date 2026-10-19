// server/test/ccd-tool-adj.test.ts
//
// D-5241 (plan 2026-10-16 Task 14, spec §5.10): `ccd/ccd-tool-adj`, the
// CLAUDE_CODE_SHELL_PREFIX `ccd` gives every Linux session. Claude Code hands
// it the whole command as ONE string (Task 13 step 7), so the passthrough cases
// below run on every host; the score cases read /proc/self/oom_score_adj, which
// only Linux has, so they are Linux only (skipped on macOS for that reason: the
// script there ignores the failed write and only passes the command on).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { itLinux } from './platformFixtures.js';
import { ghContainedEnv } from './ccdWsHelpers.js';

const ADJ = path.resolve(__dirname, '../../ccd/ccd-tool-adj');

let dir: string;
beforeEach(() => { dir = mkTmp('ccrc-tool-adj-'); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

/** Run the prefix the way Claude Code's Bash tool does: `<shell> -c -l "<prefix> '<snippet>'"` — here without
 *  `-l`, so no login profile of the test host is read. `start` is the score the caller sets first. The child's
 *  PATH goes through `ghContainedEnv` with the systemd and tmux poisons, like every bash spawn in a ccd test file
 *  (ccd-workspaces.test.ts's scan): ccd-tool-adj reaches none of them, and a snippet that did would red here. */
const viaShell = (snippet: string, env: Record<string, string> = {}, start?: number): string => {
  const q = `'${snippet.replace(/'/g, "'\\''")}'`;
  const pre = start === undefined ? '' : `echo ${start} > /proc/self/oom_score_adj && `;
  return execFileSync('bash', ['-c', `${pre}exec '${ADJ}' ${q}`], {
    encoding: 'utf8',
    env: ghContainedEnv(dir, { PATH: process.env['PATH'] ?? '', HOME: dir, ...env }, { systemd: true, tmux: true }),
  });
};
/** The Bash tool's snippet in the shape 2.1.302 builds it ([B]; Task 13 step 7 measured one): a snapshot source,
 *  the extglob guard, `eval '<command>'`, then the cwd write. The paths are this test's own. */
const toolSnippet = (command: string): string =>
  `source ${dir}/snapshot.sh 2>/dev/null || true && { shopt -u extglob || setopt NO_EXTENDED_GLOB NO_BARE_GLOB_QUAL; } >/dev/null 2>&1 || true`
  + ` && eval '${command.replace(/'/g, "'\\''")}' < /dev/null && pwd -P >| '${dir}/cwd'`;
const SCORE = 'cat /proc/self/oom_score_adj';

describe('ccd-tool-adj passes its ONE string through a shell, byte for byte (every host)', () => {
  it('spaces, single and double quotes, and $ survive', () => {
    const out = viaShell(`printf '%s|' a 'b  c' "d'e" '$HOME'; echo`);
    expect(out).toBe(`a|b  c|d'e|$HOME|\n`);
  });

  it('a Bash tool snippet runs whole: its command, then its cwd write', () => {
    const out = viaShell(toolSnippet(`printf '%s\\n' "x y"`));
    expect(out).toBe('x y\n');
    expect(fs.readFileSync(path.join(dir, 'cwd'), 'utf8').trim()).toBe(fs.realpathSync(process.cwd()));
  });

  it('the exit status and stdin pass through', () => {
    expect(() => viaShell('exit 7')).toThrow(expect.objectContaining({ status: 7 }));
    const out = execFileSync(ADJ, ['tr a-z A-Z'], { input: 'hook payload', encoding: 'utf8' });
    expect(out).toBe('HOOK PAYLOAD');
  });

  it('an MCP server: Claude Code spawns the prefix directly with one quoted command line', () => {
    const out = execFileSync(ADJ, [`'printf' '%s|' 'one arg' 'two'`], { encoding: 'utf8' });
    expect(out).toBe('one arg|two|');
  });

  it('an existing prefix (CCD_TOOL_ADJ_INNER) is wrapped: it gets the same one string', () => {
    const inner = path.join(dir, 'inner');
    fs.writeFileSync(inner, '#!/bin/sh\nprintf "inner argc=%s [%s]\\n" "$#" "$1"\n', { mode: 0o755 });
    const out = viaShell(`echo 'a  b'`, { CCD_TOOL_ADJ_INNER: inner });
    expect(out).toBe(`inner argc=1 [echo 'a  b']\n`);
  });

  it('an inner value naming ccd-tool-adj itself is dropped (no self-wrap loop)', () => {
    const out = viaShell('echo ran', { CCD_TOOL_ADJ_INNER: ADJ });
    expect(out).toBe('ran\n');
  });
});

describe('ccd-tool-adj raises the Bash tool, and only it, to 800 (Linux: /proc/self/oom_score_adj)', () => {
  /** The score every child here inherits. Never written DOWN by a test: lowering one's score needs privilege, and a
   *  CI runner may start above 0. The cases that need a base under 800 say so. */
  const base = (): number => Number(fs.readFileSync('/proc/self/oom_score_adj', 'utf8').trim());

  itLinux('a Bash tool snippet runs at 800, and so does its child (the plan\'s step-6 check)', () => {
    expect(base()).toBeLessThan(800);
    expect(viaShell(toolSnippet(SCORE)).trim()).toBe('800');
    expect(viaShell(toolSnippet(`bash -c '${SCORE}'`)).trim()).toBe('800');
  });

  itLinux('raise, never lower: a caller already at 900 stays at 900', () => {
    expect(base()).toBeLessThanOrEqual(900);
    expect(viaShell(toolSnippet(SCORE), {}, 900).trim()).toBe('900');
  });

  itLinux('a hook or statusline command runs unchanged, at the score it arrived with', () => {
    const b = String(base());
    expect(viaShell(SCORE).trim()).toBe(b);
    expect(viaShell(`bash -c true; ${SCORE}`).trim()).toBe(b);
  });

  itLinux('an MCP server command line runs unchanged too', () => {
    const out = execFileSync(ADJ, [`'cat' '/proc/self/oom_score_adj'`], { encoding: 'utf8' });
    expect(out.trim()).toBe(String(base()));
  });

  itLinux('the wrapped inner prefix also runs at 800 for a tool snippet', () => {
    const inner = path.join(dir, 'inner');
    fs.writeFileSync(inner, `#!/bin/sh\ncat /proc/self/oom_score_adj\n`, { mode: 0o755 });
    expect(viaShell(toolSnippet('true'), { CCD_TOOL_ADJ_INNER: inner }).trim()).toBe('800');
  });
});
