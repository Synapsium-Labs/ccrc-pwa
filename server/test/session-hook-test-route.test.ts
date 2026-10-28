/**
 * The session hook's test-route arm (D-TBD-test-containment): tests and typechecks run through `ccrc test`. On a
 * PreToolUse a Bash call that starts `systemd-run` with a test or typecheck word is denied, with a reason that names
 * `ccrc test`; `ccrc test` itself, a systemd-run of anything else, and a test file whose name only mentions systemd-run
 * pass untouched, and a payload the arm cannot read fails open.
 *
 * Runs `ccd/session-hook.sh` for real in a fixture HOME. Never the live HOME.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const TOP = 'project-a-calm-mesa';
const CWD = '/srv/work/project-a';

let home: string;
beforeAll(() => {
  home = mkTmp('ccrc-test-route-hook-');
  const reg = path.join(home, '.cc-sessions');
  fs.mkdirSync(reg, { recursive: true });
  fs.writeFileSync(path.join(reg, `${TOP}.generation`), GENERATION);
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'tmux'), '#!/bin/sh\nprintf "cc-%s\\n" "${TMUX_PANE#%}"\n', { mode: 0o755 });
});
afterAll(() => { fs.rmSync(home, { recursive: true, force: true }); });

const env = (): NodeJS.ProcessEnv => ({
  ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
  TMUX_PANE: `%${TOP}`, CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION,
});
const run = (stdin: string): string => {
  const r = spawnSync('bash', [HOOK], { input: stdin, encoding: 'utf8', env: env() });
  expect(r.status, 'exit 0 on every path').toBe(0);
  expect(r.stderr, 'silent on stderr').toBe('');
  return r.stdout.trim();
};
/** The deny reason, or null when the hook printed no deny. */
const bash = (command: string): string | null => {
  const out = run(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: CWD }));
  if (out === '') return null;
  const e = JSON.parse(out) as { hookSpecificOutput: { permissionDecision?: string; permissionDecisionReason?: string } };
  return e.hookSpecificOutput.permissionDecision === 'deny' ? String(e.hookSpecificOutput.permissionDecisionReason) : null;
};

describe('the test-route arm denies a test or typecheck under a systemd-run of its own (D-TBD-test-containment)', () => {
  it.each([
    'systemd-run --user --scope -p MemoryMax=8G npx vitest run',
    'systemd-run --user --scope --slice=app.slice -- npx tsc --noEmit -p test/tsconfig.tests.json',
    'cd server && systemd-run --user --unit=t1 npm test',
    'env -u GIT_DIR systemd-run --user --scope npm run test:browser',
    '/usr/bin/systemd-run --user --scope ./node_modules/.bin/vitest run test/foo.test.ts',
    'systemd-run --user --scope npx playwright test',
    'systemd-run --user --scope npm run typecheck-tests',
    'true; systemd-run --user --scope npx stryker run',
  ])('%s is denied, with a reason that names ccrc test', (cmd) => {
    const why = bash(cmd);
    expect(why).toMatch(/run tests and typechecks through `ccrc test -- <command>`/);
    expect(why).toContain('never under a systemd-run of your own');
  });
});

describe('the test-route arm allows what is not a hand-placed test run (D-TBD-test-containment)', () => {
  it.each([
    'ccrc test -- npx vitest run --maxWorkers=2 test/foo.test.ts',
    'ccrc test -- npx tsc --noEmit -p test/tsconfig.tests.json',
    './node_modules/.bin/vitest run test/systemd-run.test.ts',
    'systemd-run --user --scope sleep 1',
    'grep -n systemd-run ccd/ccrc-test',
    'npx vitest run test/foo.test.ts',
  ])('%s is allowed', (cmd) => {
    expect(bash(cmd)).toBeNull();
  });
  it('a non-Bash tool naming systemd-run and vitest is allowed', () => {
    const out = run(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/x/systemd-run vitest' }, cwd: CWD }));
    expect(out).not.toMatch(/ccrc test/);
  });
});

describe('the test-route arm fails open (D-TBD-test-containment)', () => {
  it('a malformed payload that names systemd-run prints nothing and exits 0', () => {
    expect(run('{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"systemd-run vitest"')).toBe('');
  });
});
