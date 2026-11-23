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
    if (o.transcript === true) writeFileSync(join(run, 'subagents', 'agent-a1.jsonl'), '{"fixture":true}\n');
  }
  return { configDir, cwd, sessionId };
}

describe('characterization of main (d7c8b5866b): step 0b on the measured shapes', () => {
  it('the arm argv grants exactly Agent and Bash, by those names', () => {
    expect(WANT).toEqual(['Agent', 'Bash']);
  });

  it('a clean init passes every init check', () => {
    expect(D.initChecksOf([CLEAN], WANT)).toMatchObject({ tools: { state: 'pass' }, mcp: { state: 'pass' }, plugins: { state: 'pass' }, skill: { state: 'pass' } });
  });

  it('the measured init: tools Task and Bash fail against Agent and Bash; six plugins fail; the history skill missing fails', () => {
    const c = D.initChecksOf([MEASURED], WANT);
    expect(c.tools.state).toBe('fail');
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
    expect(v).toEqual({ passed: false, failed: ['persistence', 'tools', 'plugins', 'skill'], unmeasured: [] });
    expect(D.step0bFailureDetail('restricted', checks, v)).toBe('step0b restricted: failed persistence tools plugins skill; unmeasured -; '
      + 'the skill is not listed under restricted: re-run step0b with --settings-mode fallback (Q26)');
  });
});
