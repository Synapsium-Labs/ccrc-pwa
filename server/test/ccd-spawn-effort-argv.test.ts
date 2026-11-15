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
  it('a lane that is neither Anthropic nor Codex takes no --effort (the third-backend control, D-8631)', () => {
    twoLanes();
    seed('myid', 'gpt');
    for (const l of spawnBoth('myid')) expect(effortFlags(l)).toEqual([]);
  });
});

/** Three backends: Anthropic, a Codex lane (`telemetry: 'codex'`, `exec.kind: 'external'`, the
 *  shape `ccd-backend-vs-placement.test.ts` uses) and a lane that is neither (`telemetry: 'none'`). */
const twoLanes = (): void => {
  seedAccountsSh(h.home, {
    version: 1, accounts: [
      { id: 'claude', label: 'a', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
      { id: 'lane-a', label: 'la', configDirSuffix: '.lane-a', exec: { kind: 'external' }, homeAble: true, hue: 'blue', telemetry: 'codex' },
      { id: 'gpt', label: 'g', configDirSuffix: '.gpt-cfg', exec: { kind: 'external' }, homeAble: true, hue: 'magenta', telemetry: 'none' },
    ],
  });
  for (const w of ['lane-a', 'gpt']) fs.writeFileSync(path.join(h.home, '.local', 'bin', w), '#!/bin/sh\n', { mode: 0o755 });
};

// D-8631 — a Codex lane resolves the same effort an Anthropic lane does: the record's level, else SPAWN_EFFORT.
describe('a Codex lane takes SPAWN_EFFORT on the spawn argv as an Anthropic lane does (D-8631)', () => {
  beforeEach(() => { twoLanes(); });
  it('(a) no record: --effort high on BOTH the resume line and the --session-id retry', () => {
    seed('myid', 'lane-a');
    const [primary, retry] = spawnBoth('myid');
    expect(effortFlags(primary!)).toEqual(['high']);
    expect(effortFlags(retry!)).toEqual(['high']);
    expect(primary).toContain(`--effort high --resume '${UUID}'`);
    expect(retry).toContain(`--effort high --session-id '${UUID}'`);
  });
  it('(b) a record naming only class=opus: --model opus --effort high', () => {
    seed('myid', 'lane-a'); h.sh('_reg_set myid class opus');
    for (const l of spawnBoth('myid')) {
      expect(l).toContain('--model opus --effort high ');
      expect(effortFlags(l)).toEqual(['high']);
    }
  });
  it('(c) a recorded effort=medium wins and is not doubled', () => {
    seed('myid', 'lane-a'); h.sh('_reg_set myid class opus; _reg_set myid effort medium');
    for (const l of spawnBoth('myid')) expect(effortFlags(l)).toEqual(['medium']);
  });
  it('control: class=haiku and no effort takes no --effort (the haiku rule holds on both backends)', () => {
    seed('myid', 'lane-a'); h.sh('_reg_set myid class haiku');
    for (const l of spawnBoth('myid')) expect(effortFlags(l)).toEqual([]);
  });
  it('control: class=haiku effort=high takes no --effort, and the pair is noted', () => {
    seed('myid', 'lane-a'); h.sh('_reg_set myid class haiku; _reg_set myid effort high');
    for (const l of spawnBoth('myid')) expect(effortFlags(l)).toEqual([]);
    expect(fs.readFileSync(path.join(h.home, '.cc-sessions', 'swap.log'), 'utf8')).toMatch(/route-refuse myid: class haiku takes no effort level/);
  });
  it('control: a recorded effort=auto composes no flag and stamps no inert', () => {
    seed('myid', 'lane-a'); h.sh('_reg_set myid effort auto');
    for (const l of spawnBoth('myid')) expect(effortFlags(l)).toEqual([]);
    expect(h.reg('myid', 'inert')).toBeNull();
  });
  it('control: SPAWN_EFFORT empty disables it on a Codex lane too', () => {
    seed('myid', 'lane-a');
    for (const l of spawnBoth('myid', 'SPAWN_EFFORT="";')) expect(effortFlags(l)).toEqual([]);
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
