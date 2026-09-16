// server/test/ccd-route-spawn.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, seedAccountsSh, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-route-spawn-'); });
afterEach(() => { h.cleanup(); });

/** The substrate `ccd-spawn-split.test.ts` uses to make `_spawn_start` emit
 *  BOTH spawn lines: the `--resume` new-session leaves no pane, the
 *  `--session-id` retry does. */
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
const newSessions = (): string[] => h.calls().filter((c) => c.startsWith('tmux new-session'));
const composed = (line: string): string => {
  const m = /^tmux new-session -d -s \S+ -x \d+ -y \d+ (.*)$/.exec(line);
  expect(m, line).not.toBeNull();
  return m![1]!;
};
const spawnBoth = (id: string): string[] => {
  h.sh(`${RESUME_DIES} rm -f "$HOME/pane-up"; _spawn_start ${id} resume 2>/dev/null`);
  const lines = newSessions();
  expect(lines).toHaveLength(2);
  return lines.map(composed);
};
/** Today's argv, spelled from ccd's own `_resume_env` (one definition, read twice —
 *  the `ccd-spawn-split.test.ts` rule). */
const today = (sidflag: string): string =>
  `cd '${h.home}' && exec env COLORTERM=truecolor ${h.sh('_resume_env')} '${h.home}/.local/bin/claude'  ${sidflag} --dangerously-skip-permissions`;

describe('_spawn_start carries the routing record (routing spec 2026-09-14 §5.2, §5.4)', () => {
  it('NO record: both lines are byte-identical to today\'s', () => {
    seed('myid');
    const [primary, retry] = spawnBoth('myid');
    expect(primary).toBe(today(`--resume '${UUID}'`));
    expect(retry).toBe(today(`--session-id '${UUID}'`));
  });

  it('class and subagent: --model and the env on BOTH lines, the retry pinned on its own; ultracode rides --settings and --effort too (Task 8)', () => {
    seed('myid');
    h.sh(`_reg_set myid class opus; _reg_set myid effort ultracode; _reg_set myid subagent sonnet`);
    const [primary, retry] = spawnBoth('myid');
    const env = h.sh('_resume_env');
    const expected = (sidflag: string): string =>
      `cd '${h.home}' && exec env COLORTERM=truecolor ${env} CLAUDE_CODE_SUBAGENT_MODEL=sonnet '${h.home}/.local/bin/claude' `
      + `--model opus --settings '{"enableWorkflows":true,"ultracode":true}' --effort ultracode ${sidflag} --dangerously-skip-permissions`;
    expect(primary).toBe(expected(`--resume '${UUID}'`));
    expect(retry).toBe(expected(`--session-id '${UUID}'`));
    expect(h.reg('myid', 'inert')).toBeNull();
  });

  it('class default passes no --model; an unrecognised class passes none and is noted', () => {
    seed('myid'); h.sh(`_reg_set myid class default; _reg_set myid subagent haiku`);
    const [a] = spawnBoth('myid');
    expect(a).not.toContain('--model');
    expect(a).toContain('CLAUDE_CODE_SUBAGENT_MODEL=haiku ');
    h.sh(`rm -f "$HOME/ccd-calls" "$HOME/pane-up"; _reg_set myid class gemini`);
    const [b] = spawnBoth('myid');
    expect(b).not.toContain('--model');
    expect(fs.readFileSync(path.join(h.home, '.cc-sessions', 'swap.log'), 'utf8')).toMatch(/route-reject myid: field class/);
  });

  it('the effort override ENV is never composed; the record\'s level rides --effort instead (Task 8)', () => {
    seed('myid'); h.sh(`_reg_set myid class opus; _reg_set myid effort max`);
    const [a] = spawnBoth('myid');
    expect(a).not.toMatch(/CLAUDE_CODE_EFFORT/);
    expect(a).toContain('--effort max');
  });

  it('effort high alone (no workflow) rides --effort on BOTH lines, no --settings', () => {
    seed('myid'); h.sh(`_reg_set myid class opus; _reg_set myid effort high`);
    const [primary, retry] = spawnBoth('myid');
    for (const l of [primary, retry]) {
      expect(l).toContain('--effort high');
      expect(l).not.toContain('--settings');
    }
  });

  it('effort auto composes neither --effort nor --settings — the lane decides', () => {
    seed('myid'); h.sh(`_reg_set myid class opus; _reg_set myid effort auto`);
    const [a] = spawnBoth('myid');
    expect(a).not.toContain('--effort');
    expect(a).not.toContain('--settings');
  });

  // arm 3 honoured both keys (controller ruling S1-R8):
  it('effort ultracode composes --settings with both keys on BOTH lines; workflow on alone composes enableWorkflows only', () => {
    seed('myid'); h.sh(`_reg_set myid class opus; _reg_set myid effort ultracode`);
    const [p1, r1] = spawnBoth('myid');
    for (const l of [p1, r1]) expect(l).toContain(`--model opus --settings '{"enableWorkflows":true,"ultracode":true}' --`);
    h.sh(`rm -f "$HOME/ccd-calls" "$HOME/pane-up"; _reg_set myid effort high; _reg_set myid workflow on`);
    const [p2] = spawnBoth('myid');
    expect(p2).toContain(`--model opus --settings '{"enableWorkflows":true}' --`);
  });

  it('workflow=off on an Anthropic lane composes {"enableWorkflows":false} and stamps NO inert (slice 4 measured the false key)', () => {
    // Slice 1 composed nothing for `off` and stamped `inert=workflow`, because
    // only the TRUE key had been measured and an unmeasured flag is not composed
    // on a guess. Slice 4 measured it (2026-09-15, Claude Code 2.1.273): the
    // false key is HONOURED and is a real lever — `/effort ultracode` is then
    // refused verbatim and `/config` matches no `workflow` row at all. So the
    // field IS applied now and the inert stamp would be a false claim.
    seed('myid');
    h.sh(`_reg_set myid class opus; _reg_set myid effort high; _reg_set myid workflow off`);
    const [primary, retry] = spawnBoth('myid');
    for (const l of [primary, retry]) expect(l).toContain(`--model opus --settings '{"enableWorkflows":false}' --effort high`);
    expect(h.reg('myid', 'inert')).toBeNull();
  });

  it('workflow=on on an Anthropic lane stamps no inert — it really was applied', () => {
    seed('myid');
    h.sh(`_reg_set myid class opus; _reg_set myid effort high; _reg_set myid workflow on`);
    const [primary] = spawnBoth('myid');
    expect(primary).toContain(`--settings '{"enableWorkflows":true}'`);
    expect(h.reg('myid', 'inert')).toBeNull();
  });

  it('ultracode with workflow=off stamps no inert: ultracode implies workflows ON, and that IS composed', () => {
    seed('myid');
    h.sh(`_reg_set myid class opus; _reg_set myid effort ultracode; _reg_set myid workflow off`);
    const [primary] = spawnBoth('myid');
    expect(primary).toContain(`--settings '{"enableWorkflows":true,"ultracode":true}'`);
    expect(h.reg('myid', 'inert')).toBeNull();
  });

  it('the RC flag and --model are separated by exactly one space, in the production shape (Task 6 minor)', () => {
    // `${rcflag:+ }` — the separator only the box-flag-ON shape exercises. With
    // the flag off `$rcflag` is empty and `launchflags` is `$routeflags` alone,
    // so every other case here would pass with the separator deleted.
    seed('myid');
    fs.writeFileSync(path.join(h.home, '.ccrc', 'remote-control'), 'on\n');
    h.sh(`_reg_set myid class opus`);
    const [primary, retry] = spawnBoth('myid');
    for (const l of [primary, retry]) expect(l).toContain(`--remote-control 'myid' --model opus `);
  });

  it('a swap landing (lastswap within 300s) carries every field — the continuity the operator ruled', () => {
    seed('myid');
    h.sh(`_reg_set myid class fable; _reg_set myid effort xhigh; _reg_set myid subagent sonnet; _reg_set myid workflow off
          _reg_set myid lastswap $(( $(date +%s) - 10 ))`);
    const [primary, retry] = spawnBoth('myid');
    for (const l of [primary, retry]) {
      expect(l).toContain('--model fable');
      expect(l).toContain('CLAUDE_CODE_SUBAGENT_MODEL=sonnet');
    }
    expect(h.sh(`${RESUME_DIES} rm -f "$HOME/pane-up"; _spawn_start myid resume 2>/dev/null; echo "[$SPAWN_FROMSWAP]"`)).toBe('[1]');
  });

  it('a non-Anthropic lane: --model passes, no env, effort and workflow stamped inert, nothing else reaches the argv', () => {
    seedAccountsSh(h.home, {
      version: 1, accounts: [
        { id: 'claude', label: 'a', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
        { id: 'gpt', label: 'g', configDirSuffix: '.gpt-cfg', exec: { kind: 'external' }, homeAble: true, hue: 'magenta', telemetry: 'none' },
      ],
    });
    fs.writeFileSync(path.join(h.home, '.local', 'bin', 'gpt'), '#!/bin/sh\n', { mode: 0o755 });
    seed('myid', 'gpt');
    h.sh(`_reg_set myid class opus; _reg_set myid effort ultracode; _reg_set myid subagent sonnet`);
    const [primary] = spawnBoth('myid');
    expect(primary).toContain(`'${h.home}/.local/bin/gpt' --model opus --resume`);
    expect(primary).not.toContain('--settings');
    expect(primary).not.toContain('CLAUDE_CODE_SUBAGENT_MODEL');
    expect(h.reg('myid', 'inert')).toBe('effort,workflow');
  });

  it('a non-Anthropic lane with a plain effort and no workflow stamps inert=effort only', () => {
    seedAccountsSh(h.home, {
      version: 1, accounts: [
        { id: 'claude', label: 'a', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
        { id: 'gpt', label: 'g', configDirSuffix: '.gpt-cfg', exec: { kind: 'external' }, homeAble: true, hue: 'magenta', telemetry: 'none' },
      ],
    });
    fs.writeFileSync(path.join(h.home, '.local', 'bin', 'gpt'), '#!/bin/sh\n', { mode: 0o755 });
    seed('myid', 'gpt'); h.sh(`_reg_set myid effort high`);
    spawnBoth('myid');
    expect(h.reg('myid', 'inert')).toBe('effort');
  });

  it('a non-Anthropic lane with effort auto stamps no inert (S1-R6): there is nothing not applied', () => {
    seedAccountsSh(h.home, {
      version: 1, accounts: [
        { id: 'claude', label: 'a', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
        { id: 'gpt', label: 'g', configDirSuffix: '.gpt-cfg', exec: { kind: 'external' }, homeAble: true, hue: 'magenta', telemetry: 'none' },
      ],
    });
    fs.writeFileSync(path.join(h.home, '.local', 'bin', 'gpt'), '#!/bin/sh\n', { mode: 0o755 });
    seed('myid', 'gpt'); h.sh(`_reg_set myid effort auto`);
    spawnBoth('myid');
    expect(h.reg('myid', 'inert')).toBeNull();
  });

  it('inert is CLEARED again on an Anthropic lane (a rehome back)', () => {
    seed('myid'); h.sh(`_reg_set myid inert effort,workflow; _reg_set myid effort ultracode`);
    spawnBoth('myid');
    expect(h.reg('myid', 'inert')).toBeNull();
  });
});
