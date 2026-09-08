// `ccrc models …` (§10) — what the verb group DOES.
// `server/test/ccrc-cli.test.ts` owns its DISCOVERABILITY (the usage line),
// which is the split that file states verb by verb.
//
// A TOP-LEVEL verb, not a subverb of `ccrc account`: round-2 ruling 5, because
// `cmd_account` is the account-connections branch's and is not on `main`.
//
// The fixture is `ccrc-doctor-graphify.test.ts`'s box, for its reasons: HOME is
// a throwaway `mkTmp`; `ccrc` is invoked through `<home>/ccrc/ccd/ccrc`, the
// shape a deployed box has (deploy.sh rsyncs `ccd` whole) and the shape
// `CCRC_HERE` resolves `../deploy/models-op.mjs` against; `gh`, `curl`,
// `systemctl` and `launchctl` are poisoned beside it. This verb shells out to
// node and to the probe and to nothing else, which the cases below assert.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { CODEX } from './fixtures/modelCases.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const CCRC_SRC = join(REPO, 'ccd', 'ccrc');
const CODEX_RAW = join(here, 'fixtures', 'catalogues', 'codex-raw-2026-09-08.json');
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();

const ROSTER = {
  version: 1,
  accounts: [
    { id: 'claude', label: 'claude', configDirSuffix: '.claude',
      exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    { id: 'claude-a', label: 'claude-a', configDirSuffix: '.claude-a',
      exec: { kind: 'generated' }, homeAble: true, hue: 'violet', telemetry: 'anthropic' },
    { id: 'gpt', label: 'gpt', configDirSuffix: '.claude-gpt',
      exec: { kind: 'external' }, homeAble: false, hue: 'magenta', telemetry: 'none' },
    { id: 'router', label: 'router', configDirSuffix: '.claude-router',
      exec: { kind: 'external' }, homeAble: false, hue: 'blue', telemetry: 'none' },
  ],
};

let home: string;

/** A box carrying the tree `ccrc` resolves against — `ccrc-doctor-graphify.
 *  test.ts`'s `installCcrc`, with `ccrc-models-probe` added to the symlinked
 *  `ccd/` set because `ccrc models refresh` execs it out of `$CCRC_HERE`.
 *  `deploy` and `shared` are symlinked WHOLE: `deploy/models-op.mjs` imports
 *  three `../shared/*.mjs` modules and node resolves them through the link's
 *  realpath. */
function box(roster: unknown = ROSTER): string {
  const h = mkTmp('ccrc-models-verb-');
  const ccd = join(h, 'ccrc', 'ccd');
  fs.mkdirSync(ccd, { recursive: true });
  for (const f of ['ccrc', 'ccrc-wrapper-shape', 'ccrc-doctor-checks', 'ccrc-models-probe']) {
    fs.symlinkSync(join(REPO, 'ccd', f), join(ccd, f));
  }
  fs.symlinkSync(join(REPO, 'deploy'), join(h, 'ccrc', 'deploy'));
  fs.symlinkSync(join(REPO, 'shared'), join(h, 'ccrc', 'shared'));
  fs.mkdirSync(join(h, '.ccrc'), { recursive: true });
  fs.writeFileSync(join(h, '.ccrc', 'accounts.json'), `${JSON.stringify(roster, null, 2)}\n`);
  env(h);
  return h;
}

function env(h: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const e = ghContainedEnv(h, { ...process.env, HOME: h, ...extra });
  const poison = (name: string, says: string): void =>
    fs.writeFileSync(join(h, '.local', 'bin', name),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/${name}-poison"\n`
      + `echo "${says}" >&2\nexit 97\n`, { mode: 0o755 });
  poison('curl', 'ccrc tests must never reach a real server');
  poison('systemctl', 'ccrc tests must never query this box\'s real systemd');
  poison('launchctl', 'ccrc tests must never query this box\'s real launchd');
  return e;
}

interface Result { code: number; stdout: string; stderr: string }
function run(args: string[], extra: NodeJS.ProcessEnv = {}): Result {
  const r = spawnSync(BASH, [join(home, 'ccrc', 'ccd', 'ccrc'), ...args],
    { env: env(home, extra), encoding: 'utf8', input: '' });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** The contract: stdout is EXACTLY one JSON object and nothing else. */
function oneObject(r: Result): Record<string, unknown> {
  const lines = r.stdout.split('\n');
  expect(lines[lines.length - 1], `stdout is not newline-terminated: ${JSON.stringify(r.stdout)}`).toBe('');
  expect(lines.length, `stdout carried ${lines.length - 1} lines, not one`).toBe(2);
  return JSON.parse(lines[0]!) as Record<string, unknown>;
}

const poisonLog = (name: string): string[] => {
  const p = join(home, `${name}-poison`);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};

const registryOf = (id: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(join(home, '.ccrc', 'models', `${id}.classes.json`), 'utf8'));

const writeCatalogue = (id: string, cat: unknown = CODEX): void => {
  fs.mkdirSync(join(home, '.ccrc', 'models'), { recursive: true });
  fs.writeFileSync(join(home, '.ccrc', 'models', `${id}.json`), JSON.stringify(cat));
};

beforeEach(() => { home = box(); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

describe('the models dispatcher', () => {
  it('spells its per-lane subcommand list once, at file scope', () => {
    // The dispatcher below and the refusal that lists what this build
    // implements must read ONE string, or a subcommand can dispatch while the
    // refusal claims it does not exist.
    const src = fs.readFileSync(CCRC_SRC, 'utf8');
    const m = /^MODELS_SUBS="([^"]*)"$/m.exec(src);
    expect(m, 'ccd/ccrc has no file-scope MODELS_SUBS').toBeTruthy();
    expect(m![1]!.split(' ').filter(Boolean).sort()).toEqual(['init', 'show']);
  });

  it('spells the reserved first-token words once, at file scope', () => {
    // Deviation B-4: `refresh` and `litellm` are box-wide subcommands in the
    // slot an account id otherwise occupies, and an account id may legally BE
    // one of those words.
    const src = fs.readFileSync(CCRC_SRC, 'utf8');
    const m = /^MODELS_RESERVED="([^"]*)"$/m.exec(src);
    expect(m, 'ccd/ccrc has no file-scope MODELS_RESERVED').toBeTruthy();
    expect(m![1]!.split(' ').filter(Boolean).sort()).toEqual(['litellm', 'refresh']);
  });

  it('with nothing after it refuses at exit 2 with a body', () => {
    const r = run(['models']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('missing-argument');
  });

  it('with an id and no subcommand names the ones this build has', () => {
    const r = run(['models', 'gpt']);
    expect(r.code).toBe(2);
    const b = oneObject(r);
    expect(b['error']).toBe('missing-subcommand');
    expect(String(b['detail'])).toContain('show');
  });

  it('an unknown subcommand refuses at exit 2 rather than reaching node', () => {
    const r = run(['models', 'gpt', 'frobnicate']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-subcommand');
    expect(fs.existsSync(join(home, 'gh-poison'))).toBe(false);
  });

  it('an id that is not an id refuses at exit 2, before node', () => {
    const r = run(['models', '../escape', 'show']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('bad-account-id');
  });

  it('REFUSES an account literally named `refresh`, naming the collision (deviation B-4)', () => {
    // `ID_RE` allows it, and the grammar cannot allow both readings. The
    // refusal is at exit 2, on the ROSTER, and names the fix.
    fs.rmSync(home, { recursive: true, force: true });
    home = box({ ...ROSTER, accounts: [...ROSTER.accounts,
      { id: 'refresh', label: 'refresh', configDirSuffix: '.claude-refresh',
        exec: { kind: 'external' }, homeAble: false, hue: 'green', telemetry: 'none' }] });
    const r = run(['models', 'refresh', '--all']);
    expect(r.code).toBe(2);
    const b = oneObject(r);
    expect(b['error']).toBe('reserved-account-id');
    expect(String(b['detail'])).toContain('rename');
  });

  it('a reserved word this build has no arm for yet says so, and does not read it as an id', () => {
    // Tasks 9 and 10 replace this expectation with the real arms. Until then
    // the grammar is already in force: `refresh` is never an account id here.
    const r = run(['models', 'refresh', '--all']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-subcommand');
  });
});

describe('ccrc models <id> show', () => {
  it('answers one JSON object and a human summary on STDERR', () => {
    const r = run(['models', 'gpt', 'show']);
    expect(r.code).toBe(0);
    const b = oneObject(r);
    expect(b['ok']).toBe(true);
    expect(b['id']).toBe('gpt');
    expect(b['registry']).toBeNull();
    // The verb's contract is one object on stdout; a person still needs a
    // sentence, so it goes where a sentence goes.
    expect(r.stderr).toMatch(/never probed/);
    expect(r.stderr).toMatch(/no class registry yet/);
  });

  it('--json prints the object and NOTHING on stderr', () => {
    const r = run(['models', 'gpt', 'show', '--json']);
    expect(r.code).toBe(0);
    expect(oneObject(r)['ok']).toBe(true);
    expect(r.stderr).toBe('');
  });

  it('summarises a probed, seeded lane: the four unclassified, the missing fable, the subagent', () => {
    writeCatalogue('gpt');
    run(['models', 'gpt', 'init', 'codex']);
    const r = run(['models', 'gpt', 'show']);
    expect(r.code).toBe(0);
    const b = oneObject(r);
    expect((b['derived'] as { unclassified: string[] }).unclassified).toHaveLength(4);
    expect(r.stderr).toContain('gpt-6-astra');
    expect(r.stderr).toMatch(/fable\s+—/);
    expect(r.stderr).toMatch(/subagents run as sonnet/);
  });

  it('an anthropic lane answers read-only and says why', () => {
    const r = run(['models', 'claude-a', 'show']);
    expect(r.code).toBe(0);
    expect(oneObject(r)['registry']).toBeNull();
    expect(r.stderr).toMatch(/Claude Code's own defaults/);
  });

  it('names a drifted settings key in the summary, with the remedy', () => {
    writeCatalogue('gpt');
    run(['models', 'gpt', 'init', 'codex']);
    const p = join(home, '.claude-gpt', 'settings.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.env.ANTHROPIC_MODEL = 'wrong';
    fs.writeFileSync(p, JSON.stringify(j, null, 2));
    const r = run(['models', 'gpt', 'show']);
    expect(oneObject(r)['settingsDrift']).toEqual(['ANTHROPIC_MODEL']);
    expect(r.stderr).toMatch(/settings\.json has drifted/);
  });

  it('an ORPHAN registry — no roster row for this id — answers orphan:true rather than refusing (§11)', () => {
    writeCatalogue('gpt');
    run(['models', 'gpt', 'init', 'codex']);
    fs.writeFileSync(join(home, '.ccrc', 'models', 'ghost.classes.json'),
      fs.readFileSync(join(home, '.ccrc', 'models', 'gpt.classes.json'), 'utf8'));
    const r = run(['models', 'ghost', 'show']);
    expect(r.code).toBe(0);
    const b = oneObject(r);
    expect(b['orphan']).toBe(true);
    expect((b['derived'] as { available: string[] }).available).toEqual([]);
  });

  it('a refusal still carries exactly one JSON object on stdout', () => {
    fs.rmSync(join(home, '.ccrc', 'accounts.json'));
    const r = run(['models', 'gpt', 'show']);
    expect(r.code).toBe(1);
    expect(oneObject(r)['error']).toBe('roster-absent');
  });

  it('reaches node and NOTHING else — no curl, no systemctl, no gh', () => {
    run(['models', 'gpt', 'show']);
    expect(poisonLog('curl')).toEqual([]);
    expect(poisonLog('systemctl')).toEqual([]);
    expect(fs.existsSync(join(home, 'gh-poison'))).toBe(false);
  });

  it('takes only --json', () => {
    const r = run(['models', 'gpt', 'show', '--wat']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-argument');
  });
});

describe('ccrc models <id> init', () => {
  it('seeds the gpt registry and materialises, at exit 0', () => {
    const r = run(['models', 'gpt', 'init', 'codex']);
    expect(r.code).toBe(0);
    expect(oneObject(r)['created']).toBe(true);
    expect((registryOf('gpt')['classes'] as Record<string, unknown>)['opus']).toBe('gpt-5.6-sol');
    expect(registryOf('gpt')['subagent']).toBe('sonnet');
    const settings = JSON.parse(fs.readFileSync(join(home, '.claude-gpt', 'settings.json'), 'utf8'));
    expect(settings.env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe('ccrc-unavailable-fable');
  });

  it('needs a probe kind', () => {
    const r = run(['models', 'gpt', 'init']);
    expect(r.code).toBe(2);
    expect(String(oneObject(r)['detail'])).toContain('probe');
  });

  it('refuses an unknown probe kind at exit 2, before node runs', () => {
    const r = run(['models', 'gpt', 'init', 'gemini']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-probe');
  });

  it('refuses `openai` with its own sentence — that is a PROVIDER, not a probe kind', () => {
    const r = run(['models', 'gpt', 'init', 'openai']);
    expect(r.code).toBe(2);
    expect(String(oneObject(r)['detail'])).toMatch(/spelled "codex"/);
  });

  it('refuses `anthropic` with its own sentence', () => {
    const r = run(['models', 'claude-a', 'init', 'anthropic']);
    expect(r.code).toBe(2);
    expect(String(oneObject(r)['detail'])).toMatch(/Claude Code's own defaults/);
  });

  it('passes --base-url through for a compatible lane', () => {
    const r = run(['models', 'router', 'init', 'compatible', '--base-url', 'https://api.cortecs.ai']);
    expect(r.code).toBe(0);
    expect(registryOf('router')['baseUrl']).toBe('https://api.cortecs.ai');
  });

  it('an openrouter lane is created unseeded and prints the remedy', () => {
    const r = run(['models', 'router', 'init', 'openrouter']);
    expect(r.code).toBe(0);
    const b = oneObject(r);
    expect(b['created']).toBe(true);
    expect(String(b['remedy'])).toMatch(/discovery add/);
  });

  it('takes no extra argument', () => {
    const r = run(['models', 'gpt', 'init', 'codex', 'extra']);
    expect(r.code).toBe(2);
    expect(oneObject(r)['error']).toBe('unknown-argument');
  });
});
