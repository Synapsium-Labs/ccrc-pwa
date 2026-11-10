// server/test/ccd-spawn-effort-argv.test.ts
// D-8149 — the box-default effort rides the spawn argv; nothing is typed at settle.
//
// Claude Code 2.1.321 saves the plain `/effort <level>` form as the ACCOUNT's default
// for new sessions (the model's `effortLevel` in the config dir's user settings). A
// settle keystroke of that form therefore rewrote an account setting on every fresh
// session. The `--effort` flag is session-only, so a session with no effort field
// takes `SPAWN_EFFORT` there, on BOTH spawn lines, exactly as a recorded effort does.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ccdSource, makeCcdHarness, seedAccountsSh, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-spawn-effort-'); });
afterEach(() => { h.cleanup(); });

const RESUME_DIES = `sleep() { :; };
    tmux() {
      echo "tmux $*" >> "$HOME/ccd-calls"
      case "$1" in
        new-session)  case "$*" in *--session-id*) : > "$HOME/pane-up" ;; esac ;;
        has-session)  [[ -e "$HOME/pane-up" ]] ;;
        list-sessions) return 0 ;;
      esac
    };`;
const UUID = 'deadbeef-0000-4000-8000-000000000000';
const seed = (id: string, wrapper = 'claude'): void => {
  h.sh(`_reg_set ${id} wrapper ${wrapper}
        _reg_set ${id} workdir '${h.home}'
        _reg_set ${id} uuid ${UUID}`);
};
const spawnBoth = (id: string, pre = ''): string[] => {
  h.sh(`${RESUME_DIES} ${pre} rm -f "$HOME/pane-up"; _spawn_start ${id} resume 2>/dev/null`);
  const lines = h.calls().filter((c) => c.startsWith('tmux new-session'));
  expect(lines).toHaveLength(2);
  return lines;
};
const effortFlags = (line: string): string[] => [...line.matchAll(/--effort (\S+)/g)].map((m) => m[1]!);

describe('a session with no effort field takes SPAWN_EFFORT on the spawn argv (D-8149)', () => {
  it('no record: --effort high on BOTH the resume line and the --session-id retry', () => {
    seed('myid');
    const [primary, retry] = spawnBoth('myid');
    expect(effortFlags(primary!)).toEqual(['high']);
    expect(effortFlags(retry!)).toEqual(['high']);
    expect(primary).toContain(`--effort high --resume '${UUID}'`);
    expect(retry).toContain(`--effort high --session-id '${UUID}'`);
  });
  it('a record with a class and no effort: the default rides the argv beside --model', () => {
    seed('myid'); h.sh('_reg_set myid class sonnet');
    const [primary] = spawnBoth('myid');
    expect(primary).toContain('--model sonnet --effort high ');
    expect(effortFlags(primary!)).toEqual(['high']);
  });
  it('SPAWN_EFFORT empty disables it: no --effort at all', () => {
    seed('myid');
    for (const l of spawnBoth('myid', 'SPAWN_EFFORT="";')) expect(effortFlags(l)).toEqual([]);
  });
  it('a recorded effort wins and is not doubled', () => {
    seed('myid'); h.sh('_reg_set myid class opus; _reg_set myid effort medium');
    for (const l of spawnBoth('myid')) expect(effortFlags(l)).toEqual(['medium']);
  });
  it('a recorded effort of auto: the lane decides, the default is not added behind it', () => {
    seed('myid'); h.sh('_reg_set myid effort auto');
    for (const l of spawnBoth('myid')) expect(effortFlags(l)).toEqual([]);
  });
  it('never a top-level effortLevel in --settings (it would apply to every model)', () => {
    seed('myid');
    for (const l of spawnBoth('myid')) expect(l).not.toMatch(/effortLevel/);
  });
  it('a non-Anthropic lane takes no --effort', () => {
    seedAccountsSh(h.home, {
      version: 1, accounts: [
        { id: 'claude', label: 'a', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
        { id: 'gpt', label: 'g', configDirSuffix: '.gpt-cfg', exec: { kind: 'external' }, homeAble: true, hue: 'magenta', telemetry: 'none' },
      ],
    });
    fs.writeFileSync(path.join(h.home, '.local', 'bin', 'gpt'), '#!/bin/sh\n', { mode: 0o755 });
    seed('myid', 'gpt');
    for (const l of spawnBoth('myid')) expect(effortFlags(l)).toEqual([]);
  });
});

describe('the settle types no effort command (D-8149)', () => {
  it('_inject_spawn_effort and its settle call are gone', () => {
    expect(h.sh('type _inject_spawn_effort 2>&1 || true')).toMatch(/not found/);
    const src = ccdSource();
    expect(src).not.toMatch(/^\s*_inject_spawn_effort\b/m);
    expect(src).not.toMatch(/&&\s*_inject_spawn_effort/);
  });
});
