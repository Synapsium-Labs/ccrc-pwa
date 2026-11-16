// server/test/ccd-route-spawn.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { makeCcdHarness, seedAccountsSh, type CcdHarness, toolAdjToken as adj, sessionTmpToken, sessionPanePath } from './ccdWsHelpers.js';
import { programFile } from './consolidationCensus.js';
import { paneFragment } from './worktreeIdentityFixture.js';   // path-identity W3 (R8): the pane's entry-identity writer, read from ccd's composer

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
  `cd '${h.home}' && ${paneFragment(h, 'myid', h.home)}true; cd '${h.home}' && exec env COLORTERM=truecolor ${h.sh('_resume_env')}${adj(h)}${sessionTmpToken(h)} ${sessionPanePath(h)} '${h.home}/.local/bin/claude' --effort high ${sidflag} --dangerously-skip-permissions`;
/** The NON-Anthropic lane every inert case needs: a roster whose `gpt` account is
 *  `exec.kind: 'external'`, plus the wrapper on PATH. `_is_anthropic_backend` reads
 *  the roster, so the account row IS the fixture. */
const gptLane = (): void => {
  seedAccountsSh(h.home, {
    version: 1, accounts: [
      { id: 'claude', label: 'a', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
      { id: 'gpt', label: 'g', configDirSuffix: '.gpt-cfg', exec: { kind: 'external' }, homeAble: true, hue: 'magenta', telemetry: 'none' },
    ],
  });
  fs.writeFileSync(path.join(h.home, '.local', 'bin', 'gpt'), '#!/bin/sh\n', { mode: 0o755 });
};

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
      `cd '${h.home}' && ${paneFragment(h, 'myid', h.home)}true; cd '${h.home}' && exec env COLORTERM=truecolor ${env}${adj(h)} CLAUDE_CODE_SUBAGENT_MODEL=sonnet${sessionTmpToken(h)} ${sessionPanePath(h)} '${h.home}/.local/bin/claude' `
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

  it('a non-Anthropic lane: --model passes, no env, effort AND workflow AND subagent stamped inert, nothing else reaches the argv', () => {
    // `subagent` joined the stamp in slice 6 Task 3 (it closes slice 4's deferred
    // minor). The env key is Claude Code's own and this arm composes no `routeenv`
    // at all, so a record carrying `subagent=sonnet` had its third field dropped in
    // silence — the same overloaded silence the effort and workflow words removed.
    gptLane();
    seed('myid', 'gpt');
    h.sh(`_reg_set myid class opus; _reg_set myid effort ultracode; _reg_set myid subagent sonnet`);
    const [primary] = spawnBoth('myid');
    expect(primary).toContain(`'${h.home}/.local/bin/gpt' --model opus --resume`);
    expect(primary).not.toContain('--settings');
    expect(primary).not.toContain('CLAUDE_CODE_SUBAGENT_MODEL');
    expect(h.reg('myid', 'inert')).toBe('effort,workflow,subagent');
  });

  it('a non-Anthropic lane with ONLY a subagent stamps inert=subagent alone — no effort, no workflow to report', () => {
    gptLane();
    seed('myid', 'gpt');
    h.sh(`_reg_set myid subagent sonnet`);
    const [primary] = spawnBoth('myid');
    expect(primary).not.toContain('CLAUDE_CODE_SUBAGENT_MODEL');
    expect(h.reg('myid', 'inert')).toBe('subagent');
  });

  it("a non-Anthropic lane's routeapplied claims no subagent: the stamp says what was COMPOSED", () => {
    // The `routeapplied` half of the same contradiction: written unguarded, this line
    // put `subagent=sonnet` beside `inert=subagent` — two records of one spawn
    // disagreeing, and the applier comparing against a state nobody set.
    gptLane();
    seed('myid', 'gpt');
    h.sh(`_reg_set myid class opus; _reg_set myid subagent sonnet`);
    spawnBoth('myid');
    expect(h.reg('myid', 'routeapplied')).toBe('class=opus');
  });

  it('an Anthropic lane with a subagent stamps NO inert — the env carries the key, so it really was applied (the control)', () => {
    seed('myid');
    h.sh(`_reg_set myid subagent sonnet`);
    const [primary] = spawnBoth('myid');
    expect(primary).toContain('CLAUDE_CODE_SUBAGENT_MODEL=sonnet ');
    expect(h.reg('myid', 'inert')).toBeNull();
    expect(h.reg('myid', 'routeapplied')).toBe('subagent=sonnet');
  });

  it('a non-Anthropic lane with a plain effort and no workflow stamps inert=effort only', () => {
    gptLane();
    seed('myid', 'gpt'); h.sh(`_reg_set myid effort high`);
    spawnBoth('myid');
    expect(h.reg('myid', 'inert')).toBe('effort');
  });

  it('a non-Anthropic lane with effort auto stamps no inert (S1-R6): there is nothing not applied', () => {
    gptLane();
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

/** A CODEX lane (D-8631): `telemetry: 'codex'`, `exec.kind: 'external'` — the shape
 *  `ccd-backend-vs-placement.test.ts` uses — beside the `none` lane `gptLane` plants, which
 *  stays the third-backend control. */
const codexLane = (): void => {
  seedAccountsSh(h.home, {
    version: 1, accounts: [
      { id: 'claude', label: 'a', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
      { id: 'lane-a', label: 'la', configDirSuffix: '.lane-a', exec: { kind: 'external' }, homeAble: true, hue: 'blue', telemetry: 'codex' },
      { id: 'gpt', label: 'g', configDirSuffix: '.gpt-cfg', exec: { kind: 'external' }, homeAble: true, hue: 'magenta', telemetry: 'none' },
    ],
  });
  for (const w of ['lane-a', 'gpt']) fs.writeFileSync(path.join(h.home, '.local', 'bin', w), '#!/bin/sh\n', { mode: 0o755 });
};
const WORKFLOWS = (): void => { fs.writeFileSync(path.join(h.home, '.cc-sessions', 'codex-lane-workflows'), ''); };
const efforts = (line: string): string[] => [...line.matchAll(/--effort (\S+)/g)].map((m) => m[1]!);

describe('a Codex lane carries the record\'s effort as an Anthropic lane does (D-8631)', () => {
  beforeEach(() => { codexLane(); });

  it('(d) effort=high: --effort high on BOTH lines, no inert, routeapplied claims it', () => {
    seed('myid', 'lane-a'); h.sh('_reg_set myid effort high');
    for (const l of spawnBoth('myid')) expect(efforts(l)).toEqual(['high']);
    expect(h.reg('myid', 'inert')).toBeNull();
    expect(h.reg('myid', 'routeapplied')).toBe('effort=high');
  });

  it('(e) class=opus effort=ultracode subagent=sonnet: --model opus --effort xhigh, nothing else; inert=workflow,subagent', () => {
    seed('myid', 'lane-a'); h.sh('_reg_set myid class opus; _reg_set myid effort ultracode; _reg_set myid subagent sonnet');
    for (const l of spawnBoth('myid')) {
      expect(l).toContain(`'${h.home}/.local/bin/lane-a' --model opus --effort xhigh --`);
      expect(efforts(l)).toEqual(['xhigh']);
      expect(l).not.toContain('ultracode');
      expect(l).not.toContain('--settings');
      expect(l).not.toContain('CLAUDE_CODE_SUBAGENT_MODEL');
    }
    expect(h.reg('myid', 'inert')).toBe('workflow,subagent');
    expect(h.reg('myid', 'routeapplied')).toBe('class=opus effort=ultracode');
  });

  it('(f) effort=max: --effort max', () => {
    seed('myid', 'lane-a'); h.sh('_reg_set myid class opus; _reg_set myid effort max');
    for (const l of spawnBoth('myid')) expect(efforts(l)).toEqual(['max']);
  });

  it('control: workflow=on with the switch absent composes no --settings and stamps inert=workflow', () => {
    seed('myid', 'lane-a'); h.sh('_reg_set myid class opus; _reg_set myid effort high; _reg_set myid workflow on');
    for (const l of spawnBoth('myid')) {
      expect(l).not.toContain('--settings');
      expect(efforts(l)).toEqual(['high']);
    }
    expect(h.reg('myid', 'inert')).toBe('workflow');
  });

  it('control: a lane that is neither Anthropic nor Codex keeps today\'s stamp and composes no flag', () => {
    seed('myid', 'gpt'); h.sh('_reg_set myid class opus; _reg_set myid effort high');
    for (const l of spawnBoth('myid')) expect(efforts(l)).toEqual([]);
    expect(h.reg('myid', 'inert')).toBe('effort');
  });
});

// The operator's switch for question (a): `$REG/codex-lane-workflows`, an existence marker with NO writer in the tree.
describe('the codex-lane-workflows switch (D-8631)', () => {
  beforeEach(() => { codexLane(); });

  it('present, effort=ultracode: the Anthropic arm\'s argv (--effort ultracode and the workflow --settings); inert names subagent only', () => {
    WORKFLOWS();
    seed('myid', 'lane-a'); h.sh('_reg_set myid class opus; _reg_set myid effort ultracode; _reg_set myid subagent sonnet');
    for (const l of spawnBoth('myid')) {
      expect(l).toContain(`--model opus --settings '{"enableWorkflows":true,"ultracode":true}' --effort ultracode --`);
      expect(efforts(l)).toEqual(['ultracode']);
      expect(l).not.toContain('CLAUDE_CODE_SUBAGENT_MODEL');
    }
    expect(h.reg('myid', 'inert')).toBe('subagent');
    expect(h.reg('myid', 'routeapplied')).toBe('class=opus effort=ultracode workflow=on');
  });

  it('present, workflow=on: the workflow --settings, and the level as recorded', () => {
    WORKFLOWS();
    seed('myid', 'lane-a'); h.sh('_reg_set myid class opus; _reg_set myid effort high; _reg_set myid workflow on');
    for (const l of spawnBoth('myid')) expect(l).toContain(`--model opus --settings '{"enableWorkflows":true}' --effort high --`);
    expect(h.reg('myid', 'inert')).toBeNull();
  });

  it('present, on a lane that is neither Anthropic nor Codex: nothing changes', () => {
    WORKFLOWS();
    seed('myid', 'gpt'); h.sh('_reg_set myid class opus; _reg_set myid effort ultracode; _reg_set myid subagent sonnet');
    for (const l of spawnBoth('myid')) {
      expect(l).not.toContain('--settings');
      expect(efforts(l)).toEqual([]);
    }
    expect(h.reg('myid', 'inert')).toBe('effort,workflow,subagent');
  });

  it('absent: case (e) unchanged — --effort xhigh, no --settings', () => {
    seed('myid', 'lane-a'); h.sh('_reg_set myid class opus; _reg_set myid effort ultracode');
    for (const l of spawnBoth('myid')) {
      expect(efforts(l)).toEqual(['xhigh']);
      expect(l).not.toContain('--settings');
    }
    expect(h.reg('myid', 'inert')).toBe('workflow');
  });

  // The marker is the operator's, by hand. The ONE line in the shipped tree that may name it is ccd's read in
  // `_spawn_start`; any other code line naming it, in any shipped root and any language, is a writer in waiting.
  // A comment line is the FILE'S LANGUAGE's: a leading `*` is a JSDoc continuation in TS/JS only, and in a shell file
  // it is a `*)` default case arm, which is code — so a writer planted there must stay visible to the scan.
  const JS_FILE = /\.(ts|tsx|js|mjs|cjs)$/;
  const codeLines = (file: string, text: string): string[] => text.split('\n')
    .filter((l) => !(JS_FILE.test(file) ? /^\s*(\/\/|\*|\/\*)/ : /^\s*#/).test(l));

  it('CONTROL: the scan keeps a shell case arm and drops only real comment lines', () => {
    const named = (file: string, text: string): string[] => codeLines(file, text).filter((l) => l.includes('codex-lane-workflows'));
    expect(named('ccd/x', '  *) touch "$REG/codex-lane-workflows" ;;\n')).toHaveLength(1);
    expect(named('deploy/x.sh', '    * ) : > "$REG/codex-lane-workflows" ;;\n')).toHaveLength(1);
    expect(named('ccd/x', '  # touch "$REG/codex-lane-workflows"\n')).toEqual([]);
    expect(named('server/src/x.ts', ' * `codex-lane-workflows` in a doc block\n// codex-lane-workflows\n/* codex-lane-workflows */\n')).toEqual([]);
    expect(named('server/src/x.ts', "fs.writeFileSync('codex-lane-workflows', '');\n")).toHaveLength(1);
  });

  it('has no writer in the shipped tree: its one code line is the spawn\'s read', () => {
    const root = path.resolve(__dirname, '..', '..');
    const SKIP = new Set(['node_modules', 'dist', '.git', 'coverage']);
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) return SKIP.has(e.name) ? [] : walk(p);
      return e.name.endsWith('.md') ? [] : [p];
    });
    const files = [...['ccd', 'deploy', 'shared', 'server/src', 'agent/src', 'pwa/src'].flatMap((r) => walk(path.join(root, r))),
      ...['install.sh'].map((f) => path.join(root, f)).filter((f) => fs.existsSync(f))];
    expect(files.length, 'the walk reached the shipped tree').toBeGreaterThan(200);
    const hits = files.flatMap((f) => codeLines(f, fs.readFileSync(f, 'utf8')).filter((l) => l.includes('codex-lane-workflows')).map((l) => `${programFile(path.relative(root, f))}: ${l.trim()}`));   // a library of ccd is ccd/ccd (D-8048)
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatch(/^ccd\/ccd: .*\[\[ -e "\$REG\/codex-lane-workflows" \]\]/);
  });
});

describe('the pressure-reap key follows the execution kind, not the provider', () => {
  it('an external Claude Code shim receives the pressure key on primary and retry without adopting Anthropic route semantics', () => {
    gptLane(); seed('myid', 'gpt');
    h.sh('_reg_set myid class opus; _reg_set myid effort high; _reg_set myid subagent sonnet; _reg_set myid workflow on');
    const [primary, retry] = spawnBoth('myid');
    for (const line of [primary!, retry!]) {
      expect(line.match(/CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1/g)).toHaveLength(1);
      expect(line.indexOf('CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1'))
        .toBeLessThan(line.indexOf('/.local/bin/gpt'));
      expect(line).toContain(`'${h.home}/.local/bin/gpt' --model opus `);
      expect(line).not.toContain('--remote-control');
      expect(line).not.toContain('--settings');
      expect(line).not.toContain('--effort');
      expect(line).not.toContain('CLAUDE_CODE_SUBAGENT_MODEL');
    }
    expect(h.reg('myid', 'inert')).toBe('effort,workflow,subagent');
  });
});

/** D-5241 (plan Task 14): the tool-child priority. `CCD_OS` is set in the snippet, after ccd is sourced, so
 *  both arms run on any host; the Linux arm's VALUE is exercised by `ccd-tool-adj.test.ts`. */
describe('_spawn_start: CLAUDE_CODE_SHELL_PREFIX names ccd-tool-adj on Linux only (D-5241)', () => {
  const spawnOn = (os: 'linux' | 'darwin'): string[] => {
    h.sh(`CCD_OS=${os}; ${RESUME_DIES} rm -f "$HOME/pane-up"; _spawn_start myid resume 2>/dev/null`);
    const lines = newSessions();
    expect(lines).toHaveLength(2);
    return lines.map(composed);
  };
  const token = (): string =>
    `CCD_TOOL_ADJ_INNER="\${CLAUDE_CODE_SHELL_PREFIX-}" CLAUDE_CODE_SHELL_PREFIX='${h.home}/.local/bin/ccd-tool-adj'`;

  it('Linux: BOTH lines carry the prefix, after the resume env and before the wrapper', () => {
    seed('myid');
    const env = h.sh('_resume_env');
    const [primary, retry] = spawnOn('linux');
    const expected = (sidflag: string): string =>
      `cd '${h.home}' && ${paneFragment(h, 'myid', h.home, 'linux')}true; cd '${h.home}' && exec env COLORTERM=truecolor ${env} ${token()}${sessionTmpToken(h)} ${sessionPanePath(h)} '${h.home}/.local/bin/claude' --effort high ${sidflag} --dangerously-skip-permissions`;
    expect(primary).toBe(expected(`--resume '${UUID}'`));
    expect(retry).toBe(expected(`--session-id '${UUID}'`));
  });

  it('Darwin: neither line carries it, and both are today\'s lines', () => {
    seed('myid');
    const env = h.sh('_resume_env');
    const [primary, retry] = spawnOn('darwin');
    expect(primary).not.toContain('CLAUDE_CODE_SHELL_PREFIX');
    expect(retry).not.toContain('CLAUDE_CODE_SHELL_PREFIX');
    expect(primary).toBe(`cd '${h.home}' && ${paneFragment(h, 'myid', h.home, 'darwin')}true; cd '${h.home}' && exec env COLORTERM=truecolor ${env}${sessionTmpToken(h)} ${sessionPanePath(h)} '${h.home}/.local/bin/claude' --effort high --resume '${UUID}' --dangerously-skip-permissions`);
  });

  it('the composed line, run by a shell, hands the child the prefix and WRAPS an existing one', () => {
    seed('myid');
    const [primary] = spawnOn('linux');
    const out = path.join(h.home, 'child-env');
    fs.writeFileSync(path.join(h.home, '.local', 'bin', 'claude'),
      `#!/bin/sh\nprintf '%s\\n%s\\n' "$CLAUDE_CODE_SHELL_PREFIX" "$CCD_TOOL_ADJ_INNER" > '${out}'\n`, { mode: 0o755 });
    execFileSync('sh', ['-c', primary!], { env: { PATH: process.env['PATH'] ?? '', CLAUDE_CODE_SHELL_PREFIX: '/opt/inner-prefix' } });
    expect(fs.readFileSync(out, 'utf8')).toBe(`${h.home}/.local/bin/ccd-tool-adj\n/opt/inner-prefix\n`);
    execFileSync('sh', ['-c', primary!], { env: { PATH: process.env['PATH'] ?? '' } });
    expect(fs.readFileSync(out, 'utf8')).toBe(`${h.home}/.local/bin/ccd-tool-adj\n\n`);
  });

  it('a path Claude Code would split at " -" spawns without the prefix, and says so', () => {
    const r = h.sh(`CCD_OS=linux; HOME='/srv/a -b'; _tool_adj_env 2>&1; echo "[$(_tool_adj_env 2>/dev/null)]"`);
    expect(r).toContain('cannot be a CLAUDE_CODE_SHELL_PREFIX');
    expect(r).toContain('[]');
  });
});
