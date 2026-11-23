// Step 0b's init and persistence checks on the shapes the current Claude Code build reported (Overlord W1a; the task note
// docs/superpowers/programs/overlord/quiz-pilot-checks.md). The checks live in deploy/history-replay.mjs and are shared by
// two callers: the history gate's own pilot (`step0b --section pilot|quiz`) and the single-arm quiz's `arms`
// (deploy/history-quiz-single.mjs). Both build their result from initChecksOf, persistenceMeasured and step0bVerdictOf, so a
// pin here binds both.
//
// The first describe block is the CHARACTERIZATION of `main` before this round's change (d7c8b5866b): it was committed green
// against that code first, then each intended change edited exactly the rows it names, in a commit of its own.
//
// ISOLATION: no driver subcommand runs and nothing is spawned. The one directory read is a mkTmp fixture config dir; no
// fixture names a real account, host or path. The plugin entries copy the field NAMES the build reports (name, path, source,
// version) with neutral values: five build entries and one marketplace entry, the marketplace named only by its class.
import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as drvMod from '../../deploy/history-replay.mjs';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

type R = Record<string, any>;
const D = drvMod as unknown as R;

removeTmpFixturesEachTest();

const WANT = D.armToolsOf(D.spawnArgv({ mode: 'arm', model: 'claude-opus-5-5', settingsMode: 'restricted', home: '/home/u' })) as string[];
/** The five entries the build reports as its own: `source` ends in `@builtin`, `path` is the word `builtin`. */
const BUILD_PLUGINS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'].map((n) => ({ name: n, path: 'builtin', source: `${n}@builtin` }));
/** The one entry installed from a marketplace into the account's config folder (neutral values, the field names as reported). */
const MARKET_PLUGIN = { name: 'market-one', path: '/fixture/config/plugins/cache/market-a/market-one/1.0.0', source: 'market-one@market-a', version: '1.0.0' };
/** One arm run's init as readStreamJson reads it, in the measured shape: the Agent tool under its wire name, six plugins. */
const MEASURED = { sessionId: 's', model: 'm', tools: ['Task', 'Bash'], mcpServers: [], plugins: [...BUILD_PLUGINS, MARKET_PLUGIN], skills: ['some-build-skill'], slashCommands: [] };
const CLEAN = { ...MEASURED, tools: ['Bash', 'Agent'], plugins: [], skills: ['ccrc-history'] };

/** A config dir whose projects/ holds what the Agent probe left: projects/<slug of cwd>/<session id>/ with no transcript. */
function leftover(o: { subagents?: boolean; transcript?: boolean } = {}): { configDir: string; cwd: string; sessionId: string } {
  const configDir = join(mkTmp('ccrc-step0b-left-'), '.claude');
  const cwd = '/tmp/ccrc-history-replay-fixture';
  const sessionId = '00000000-0000-4000-8000-0000000000c1';
  const run = join(configDir, 'projects', D.projectSlugOf(cwd) as string, sessionId);
  mkdirSync(run, { recursive: true });
  if (o.subagents === true) {
    mkdirSync(join(run, 'subagents'));
    if (o.transcript === true) writeFileSync(join(run, 'subagents', 'agent-a1.jsonl'), '{"content-never-read":true}\n');
  }
  return { configDir, cwd, sessionId };
}

describe('characterization of main (d7c8b5866b), as the rulings changed it: step 0b on the measured shapes', () => {
  it('the arm argv grants exactly Agent and Bash, by those names', () => {
    expect(WANT).toEqual(['Agent', 'Bash']);
  });

  it('a clean init passes every init check', () => {
    expect(D.initChecksOf([CLEAN], WANT)).toMatchObject({ tools: { state: 'pass' }, mcp: { state: 'pass' }, plugins: { state: 'pass' }, skill: { state: 'pass' } });
  });

  // Changed by ruling 1 (was: tools fail): the build's Task reads as Agent, so the reported set is the granted one.
  // Changed by ruling 2 (plugins still fail, now on the marketplace entry alone).
  it('the measured init: tools Task and Bash pass against Agent and Bash; the marketplace plugin fails; the history skill missing fails', () => {
    const c = D.initChecksOf([MEASURED], WANT);
    expect(c.tools.state).toBe('pass');
    expect(c.mcp.state).toBe('pass');
    expect(c.plugins.state).toBe('fail');
    expect(c.skill.state).toBe('fail');
  });

  it('the Agent probe\'s leftover session folder fails persistence through the project folder and the session id', () => {
    const l = leftover();
    const got = D.persistenceMeasured(l);
    expect([got.left, got.transcripts, got.project_dir]).toEqual([true, [`${D.projectSlugOf(l.cwd)}/${l.sessionId}`], true]);
    expect(D.persistenceCheckOf([got])).toEqual({ state: 'fail' });
  });

  it('the failure detail names the failed checks and, under restricted, the fallback re-run', () => {
    const checks: R = {
      'turn-bound': { state: 'pass' }, persistence: { state: 'fail' }, ...D.initChecksOf([MEASURED], WANT),
      ...Object.fromEntries(['spelling-1', 'spelling-2', 'spelling-3', 'deny-chain', 'deny-subst', 'deny-rg'].map((n) => [n, { state: 'pass' }])),
    };
    const v = D.step0bVerdictOf(checks);
    // Changed by ruling 1 (was: failed persistence tools plugins skill).
    expect(v).toEqual({ passed: false, failed: ['persistence', 'plugins', 'skill'], unmeasured: [] });
    expect(D.step0bFailureDetail('restricted', checks, v)).toBe('step0b restricted: failed persistence plugins skill; unmeasured -; '
      + 'the skill is not listed under restricted: re-run step0b with --settings-mode fallback (Q26)');
  });
});

describe('ruling 1: the wire-name alias, one table row, on the reported side only', () => {
  const one = (tools: unknown[], want: string[] = WANT): string => D.initChecksOf([{ ...CLEAN, tools }], want).tools.state;

  it('the table is exactly one row: Task reads as Agent', () => {
    expect(D.WIRE_TOOL_ALIASES).toEqual({ Task: 'Agent' });
    expect(Object.isFrozen(D.WIRE_TOOL_ALIASES)).toBe(true);
  });

  it('Task reported passes against Agent granted; CONTROL: Agent reported still passes', () => {
    expect(one(['Task', 'Bash'])).toBe('pass');
    expect(one(['Bash', 'Agent'])).toBe('pass');
  });

  it('the comparison stays exact: a name not in the table is never aliased, a repeat is never the set', () => {
    expect(one(['Task', 'Agent', 'Bash']), 'Task beside Agent is two Agents').toBe('fail');
    expect(one(['Tasks', 'Bash']), 'a near name').toBe('fail');
    expect(one(['task', 'Bash']), 'a case variant').toBe('fail');
    expect(one(['Task', 'Bash', 'Read']), 'an extra tool').toBe('fail');
    expect(one(['Task']), 'a missing tool').toBe('fail');
  });

  it('the alias is never applied to the granted side: a grant naming Task wants Task, and a reported Agent is not it', () => {
    expect(one(['Agent', 'Bash'], ['Bash', 'Task'])).toBe('fail');
    expect(one(['Task', 'Bash'], ['Bash', 'Task']), 'the reported Task reads as Agent, which the grant does not name').toBe('fail');
    expect(D.armToolsOf(['--tools', 'Task,Bash']), 'armToolsOf reads the argv as written').toEqual(['Bash', 'Task']);
  });

  it('grantedToolNamesOf keeps every other value as it is, in order', () => {
    expect(D.grantedToolNamesOf(['Bash', 'Task', 7, null, 'Agent'])).toEqual(['Bash', 'Agent', 7, null, 'Agent']);
  });
});

describe('ruling 2: a plugins entry is the build\'s own only when both fields say so', () => {
  const state = (plugins: unknown[]): string => D.initChecksOf([{ ...CLEAN, plugins }], WANT).plugins.state;

  it('the five build entries pass; with the marketplace entry the check fails', () => {
    expect(state(BUILD_PLUGINS)).toBe('pass');
    expect(state([...BUILD_PLUGINS, MARKET_PLUGIN])).toBe('fail');
    expect(state([]), 'CONTROL: none loaded passes').toBe('pass');
  });

  it('one field alone never admits an entry; a missing or non-string field fails as today', () => {
    const rows: Array<[string, unknown]> = [
      ['source @builtin, path elsewhere', { name: 'x', source: 'x@builtin', path: '/somewhere/x' }],
      ['path builtin, source a marketplace', { name: 'x', source: 'x@market-a', path: 'builtin' }],
      ['no path', { name: 'x', source: 'x@builtin' }],
      ['no source', { name: 'x', path: 'builtin' }],
      ['source not a string', { name: 'x', source: ['x@builtin'], path: 'builtin' }],
      ['path not the word', { name: 'x', source: 'x@builtin', path: 'Builtin' }],
      ['@builtin not at the end', { name: 'x', source: 'x@builtin-extra', path: 'builtin' }],
      ['a bare string', 'x@builtin'],
      ['null', null],
    ];
    for (const [why, entry] of rows) {
      expect(D.pluginClassOf(entry), why).toBe('other');
      expect(state([...BUILD_PLUGINS, entry]), why).toBe('fail');
    }
    expect(D.pluginClassOf(BUILD_PLUGINS[0]), 'CONTROL').toBe('build');
  });

  it('the result records each run\'s counts by class and each refused entry\'s name and source', () => {
    const c = D.initChecksOf([MEASURED, null, { ...CLEAN, plugins: null }, CLEAN, { ...CLEAN, plugins: [{ path: 'builtin' }] }], WANT);
    expect(c.plugins).toEqual({
      state: 'fail',
      loaded: [
        { build: 5, other: 1, refused: [{ name: 'market-one', source: 'market-one@market-a' }] },
        null,
        null,
        { build: 0, other: 0, refused: [] },
        { build: 0, other: 1, refused: [{ name: null, source: null }] },
      ],
    });
  });
});

describe('ruling 3: the leftover\'s shape is recorded, the verdict is unchanged', () => {
  it('a bare session folder: its two levels named with sizes, no subagents folder, no transcript; still a fail', () => {
    const l = leftover();
    const got = D.persistenceMeasured(l);
    const slug = D.projectSlugOf(l.cwd) as string;
    expect(D.persistenceCheckOf([got])).toEqual({ state: 'fail' });
    expect(got.shape.entries.map((e: R) => [e.path, e.kind])).toEqual([[slug, 'dir'], [`${slug}/${l.sessionId}`, 'dir']]);
    expect(got.shape.entries.every((e: R) => Number.isInteger(e.size))).toBe(true);
    expect([got.shape.subagents_dir, got.shape.transcript_file, got.shape.truncated, got.shape.unmeasured]).toEqual([false, false, false, undefined]);
  });

  it('a subagents folder with a transcript three levels down: the folder named, the transcript found but not named, no content read', () => {
    const l = leftover({ subagents: true, transcript: true });
    const got = D.persistenceMeasured(l);
    const slug = D.projectSlugOf(l.cwd) as string;
    expect(got.shape.entries.map((e: R) => e.path)).toEqual([slug, `${slug}/${l.sessionId}`, `${slug}/${l.sessionId}/subagents`]);
    expect([got.shape.subagents_dir, got.shape.transcript_file]).toEqual([true, true]);
    expect(JSON.stringify(got.shape)).not.toContain('content-never-read');
    expect(D.persistenceCheckOf([got])).toEqual({ state: 'fail' });
  });

  it('a transcript named by the session id under another project folder is a root of its own, with its size', () => {
    const configDir = join(mkTmp('ccrc-step0b-left2-'), '.claude');
    mkdirSync(join(configDir, 'projects', '-other'), { recursive: true });
    writeFileSync(join(configDir, 'projects', '-other', 'sess-b.jsonl'), 'abc');
    const got = D.persistenceMeasured({ configDir, sessionId: 'sess-b', cwd: '/tmp/run-b' });
    expect(got.shape.entries).toEqual([{ path: '-other/sess-b.jsonl', kind: 'file', size: 3 }]);
    expect(got.shape.transcript_file).toBe(true);
  });

  it('a clean run carries no shape; an unmeasured run carries none', () => {
    const configDir = join(mkTmp('ccrc-step0b-clean-'), '.claude');
    mkdirSync(join(configDir, 'projects'), { recursive: true });
    expect(D.persistenceMeasured({ configDir, sessionId: 's', cwd: '/tmp/run-a' })).toEqual({ left: false, transcripts: [], project_dir: false });
    expect(D.persistenceMeasured({ configDir, sessionId: null, cwd: '/tmp/run-a' })).toEqual({ left: true, transcripts: [], project_dir: null, unmeasured: 'no-session-id' });
  });

  it('the walk stops at its entry bound and says so', () => {
    const configDir = join(mkTmp('ccrc-step0b-many-'), '.claude');
    const dir = join(configDir, 'projects', '-many');
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < D.LEFTOVER_SHAPE_MAX_ENTRIES + 5; i += 1) writeFileSync(join(dir, `f${i}`), '');
    const shape = D.leftoverShapeOf(join(configDir, 'projects'), ['-many']);
    expect(shape.truncated).toBe(true);
    expect(shape.entries.length).toBe(D.LEFTOVER_SHAPE_MAX_ENTRIES);
  });
});
