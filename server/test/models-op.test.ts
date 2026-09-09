// `deploy/models-op.mjs` — the node half of the `ccrc models` verb group (§10).
// It owns the REGISTRY FILE's read, the mutation, the re-validation, the atomic
// write and the re-materialisation, so the bash verb above it is a dispatcher
// and nothing else.
//
// IT NEVER WRITES THE ROSTER. Ruling 280: the registry is its own per-account
// file, `~/.ccrc/models/<id>.classes.json`, and `exec.models` belongs to the
// account-connections spec. The roster is read for three facts and nothing more
// — does this id exist, what is its configDirSuffix, and is it an Anthropic
// lane (`telemetry === 'anthropic'`, deviation B-3).
//
// EVERY CASE RUNS AGAINST A `mkTmp` HOME. This program writes ~/.ccrc/models
// and a lane's settings.json; the live ones on the box this suite runs on are
// the operator's.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { CODEX } from './fixtures/modelCases.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const OP = path.join(REPO, 'deploy', 'models-op.mjs');

let home: string;
const rosterPath = (): string => path.join(home, '.ccrc', 'accounts.json');

/** A roster with the three shapes this file has to tell apart: the upstream
 *  account, an Anthropic lane (`telemetry: 'anthropic'`), and the two
 *  non-Anthropic lanes the design exists for. `exec` carries no provider —
 *  `origin/main`'s ExecSpec has none. */
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

function seed(roster: unknown = ROSTER): void {
  fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  fs.writeFileSync(rosterPath(), `${JSON.stringify(roster, null, 2)}\n`);
}

interface Result { code: number; body: Record<string, unknown>; stderr: string; stdout: string }
function op(...args: string[]): Result {
  const r = spawnSync(process.execPath, [OP, ...args],
    { env: { ...process.env, HOME: home }, encoding: 'utf8' });
  const stdout = r.stdout ?? '';
  // THE CONTRACT: exactly one JSON object on stdout, newline-terminated. A
  // helper rather than a `JSON.parse` per call site, because a progress line
  // before the answer would still parse at a call site that took
  // `.split('\n')[0]`.
  const lines = stdout.split('\n');
  expect(lines[lines.length - 1], `stdout is not newline-terminated: ${JSON.stringify(stdout)}`).toBe('');
  expect(lines.length, `stdout carried ${lines.length - 1} lines, not one`).toBe(2);
  return { code: r.status ?? -1, body: JSON.parse(lines[0]!), stderr: r.stderr ?? '', stdout };
}

/** Same contract as `op`, but async — required to launch several op
 *  processes so they actually overlap in the OS, which `spawnSync`, being
 *  synchronous, cannot do (C7's concurrent-materialise test). */
function opAsync(...args: string[]): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [OP, ...args], { env: { ...process.env, HOME: home } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      const lines = stdout.split('\n');
      resolve({ code: code ?? -1, body: JSON.parse(lines[0] ?? '{}'), stderr, stdout });
    });
  });
}

const regPath = (id: string): string => path.join(home, '.ccrc', 'models', `${id}.classes.json`);
const registryOf = (id: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(regPath(id), 'utf8'));
const classesOf = (id: string): Record<string, unknown> =>
  registryOf(id)['classes'] as Record<string, unknown>;
const settingsOf = (suffix: string): { env: Record<string, string> } =>
  JSON.parse(fs.readFileSync(path.join(home, suffix, 'settings.json'), 'utf8'));

const writeCatalogue = (id: string, cat: unknown = CODEX): void => {
  fs.mkdirSync(path.join(home, '.ccrc', 'models'), { recursive: true });
  fs.writeFileSync(path.join(home, '.ccrc', 'models', `${id}.json`), JSON.stringify(cat));
};

// The ownership whitelist (§5, §11) and a probe's `--endpoints` answer.
// Module-scope, not local to one `describe`: Fix round 1's Finding 1 made
// `discovery add` on an openrouter lane REQUIRE `--endpoints` (ruling
// 2026-09-08), so every discovery test on the `router` lane needs these now,
// not only the ones that exist to test the whitelist itself.
const whitelist = (providers: string[]): void => {
  fs.mkdirSync(path.join(home, '.handoff'), { recursive: true });
  fs.writeFileSync(path.join(home, '.handoff', 'providers-whitelist.json'), JSON.stringify({ providers }));
};
const endpoints = (names: string[]): string => {
  const p = path.join(home, 'endpoints.json');
  fs.writeFileSync(p, JSON.stringify({ data: { endpoints: names.map((n) => ({ provider_name: n })) } }));
  return p;
};

beforeEach(() => { home = mkTmp('ccrc-models-op-'); seed(); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

describe('argv', () => {
  it('an unknown op refuses at exit 2 with a body, never an empty stdout', () => {
    const r = op('frobnicate', '--file', rosterPath());
    expect(r.code).toBe(2);
    expect(r.body['ok']).toBe(false);
    expect(r.body['error']).toBe('bad-argv');
  });

  it('an unknown --key is a refusal, not a silently dropped flag', () => {
    const r = op('show', '--file', rosterPath(), '--id', 'gpt', '--wat', 'x');
    expect(r.code).toBe(2);
    expect(r.body['error']).toBe('bad-argv');
  });

  it('a value that itself starts with -- is refused rather than shifting every pair', () => {
    const r = op('show', '--file', '--id', 'gpt');
    expect(r.code).toBe(2);
    expect(r.body['error']).toBe('bad-argv');
  });

  it('a missing required key is named', () => {
    const r = op('show', '--file', rosterPath());
    expect(r.code).toBe(2);
    expect(String(r.body['detail'])).toContain('--id');
  });
});

describe('the roster read', () => {
  it('an absent roster refuses with the install remedy', () => {
    fs.rmSync(rosterPath());
    const r = op('show', '--file', rosterPath(), '--id', 'gpt');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('roster-absent');
  });

  it('an invalid roster carries the validator\'s own remedy VERBATIM', () => {
    seed({ version: 1, accounts: [{ id: 'x' }] });
    const r = op('show', '--file', rosterPath(), '--id', 'x');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('roster-invalid');
    expect(String(r.body['detail']).length).toBeGreaterThan(40);
  });

  it('an id the roster does not have refuses by name', () => {
    const r = op('show', '--file', rosterPath(), '--id', 'ghost');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('no-such-account');
  });

  it('NOTHING here ever rewrites the roster', () => {
    // Ruling 280, as a mechanism: every mutation below runs, and the roster's
    // bytes AND mtime are compared at the end. `exec.models` is the
    // account-connections spec's and does not exist on this branch.
    //
    // mtime, not just content, because it is a WEAKER assertion — measured: a
    // `writeFileSync(a.file, JSON.stringify(json, null, 2) + '\n')` inserted
    // at the tail of the mutation path (`json` being the exact object
    // `JSON.parse`d from this fixture) round-trips BYTE-IDENTICAL to what
    // `seed()` originally wrote, since `ROSTER` above is already 2-space
    // indented with the same key order `JSON.stringify` would produce. The
    // content comparison alone stayed green with that write live; mtime
    // moves on every `writeFileSync` regardless of content and is what
    // actually catches it.
    const before = fs.readFileSync(rosterPath(), 'utf8');
    const mtimeBefore = fs.statSync(rosterPath()).mtimeMs;
    writeCatalogue('gpt');
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'fable', '--model', 'gpt-6-astra');
    op('set-subagent', '--file', rosterPath(), '--id', 'gpt', '--class', 'opus');
    op('set-effort', '--file', rosterPath(), '--id', 'gpt', '--class', 'sonnet', '--level', 'xhigh');
    op('discovery', '--file', rosterPath(), '--id', 'gpt', '--action', 'catalogue');
    expect(fs.readFileSync(rosterPath(), 'utf8')).toBe(before);
    expect(fs.statSync(rosterPath()).mtimeMs).toBe(mtimeBefore);
  });
});

describe('lanes', () => {
  it('lists every account that can carry a registry, and flags the anthropic ones', () => {
    const r = op('lanes', '--file', rosterPath());
    expect(r.code).toBe(0);
    expect(r.body['lanes']).toEqual([
      { id: 'gpt', configDirSuffix: '.claude-gpt', anthropic: false, hasRegistry: false,
        registryInvalid: null, catalogueInvalid: null, probe: null, baseUrl: null },
      { id: 'router', configDirSuffix: '.claude-router', anthropic: false, hasRegistry: false,
        registryInvalid: null, catalogueInvalid: null, probe: null, baseUrl: null },
    ]);
  });

  it('reports probe and baseUrl once a registry exists', () => {
    op('init', '--file', rosterPath(), '--id', 'router', '--probe', 'compatible',
      '--base-url', 'https://api.cortecs.ai');
    const lanes = op('lanes', '--file', rosterPath()).body['lanes'] as Record<string, unknown>[];
    expect(lanes.find((l) => l['id'] === 'router')).toEqual({
      id: 'router', configDirSuffix: '.claude-router', anthropic: false,
      hasRegistry: true, registryInvalid: null, catalogueInvalid: null,
      probe: 'compatible', baseUrl: 'https://api.cortecs.ai',
    });
  });

  it('an upstream account is never a lane a registry can sit on', () => {
    const lanes = op('lanes', '--file', rosterPath()).body['lanes'] as { id: string }[];
    expect(lanes.map((l) => l.id)).not.toContain('claude');
  });

  // Fix round 1, Finding 2 (ruling): the old code passed `{ registry: null }`
  // whenever the CATALOGUE read failed, so a broken catalogue silently turned
  // `hasRegistry` false too — hiding the one lane `readCatalogue`'s own
  // refusal text names `ccrc models refresh <id>` as the remedy for, behind
  // "no registry at all". `readRegistry` now always runs, with `catalogue:
  // null` standing in for "could not be read", exactly the "never probed"
  // case `parseRegistry` already tolerates.
  it('a catalogue that exists but does not parse does not exclude the lane, and names it via catalogueInvalid', () => {
    // `init` itself refuses on an already-broken catalogue file (both share
    // the general op path's early `cat.err` gate), so the registry has to be
    // seeded FIRST, with no catalogue file present yet, and the catalogue
    // corrupted afterwards.
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    fs.writeFileSync(path.join(home, '.ccrc', 'models', 'gpt.json'), '{"probe":"gemini"}');
    const lanes = op('lanes', '--file', rosterPath()).body['lanes'] as Record<string, unknown>[];
    const row = lanes.find((l) => l['id'] === 'gpt')!;
    expect(row['hasRegistry']).toBe(true);
    expect(row['registryInvalid']).toBeNull();
    expect(row['probe']).toBe('codex');
    expect(String(row['catalogueInvalid'])).toContain('not a catalogue this build understands');
  });

  // The other half of the same ruling: a registry file that IS present but
  // does not parse/validate is still `hasRegistry: true` (the FILE exists —
  // `hasRegistry` reflects presence alone now, not validity), with `probe:
  // null` (there is no VALID probe kind to report) and `registryInvalid`
  // naming the validator's own message — the fixture `show`'s own
  // registry-invalid case uses: all four classes null but no `subagent` key.
  it('a registry that exists but does not parse/validate is still hasRegistry, named via registryInvalid, with probe null', () => {
    fs.mkdirSync(path.join(home, '.ccrc', 'models'), { recursive: true });
    fs.writeFileSync(regPath('gpt'),
      JSON.stringify({ probe: 'codex', classes: { haiku: null, sonnet: null, opus: null, fable: null } }));
    const lanes = op('lanes', '--file', rosterPath()).body['lanes'] as Record<string, unknown>[];
    const row = lanes.find((l) => l['id'] === 'gpt')!;
    expect(row['hasRegistry']).toBe(true);
    expect(row['probe']).toBeNull();
    expect(row['catalogueInvalid']).toBeNull();
    expect(String(row['registryInvalid'])).toContain('subagent');
  });
});

describe('show', () => {
  it('a lane with no registry reads as every class unavailable (§13.1)', () => {
    const r = op('show', '--file', rosterPath(), '--id', 'gpt');
    expect(r.code).toBe(0);
    expect(r.body['registry']).toBeNull();
    expect(r.body['anthropic']).toBe(false);
    expect(r.body['derived']).toEqual({ classified: [], unclassified: [], retired: [], available: [] });
    expect(r.body['catalogue']).toBeNull();
  });

  it('an anthropic lane answers registry:null and all four classes available', () => {
    const r = op('show', '--file', rosterPath(), '--id', 'claude-a');
    expect(r.code).toBe(0);
    expect(r.body['registry']).toBeNull();
    expect(r.body['anthropic']).toBe(true);
    expect((r.body['derived'] as { available: string[] }).available)
      .toEqual(['haiku', 'sonnet', 'opus', 'fable']);
  });

  it('summarises the catalogue rather than shipping it', () => {
    writeCatalogue('gpt');
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    const r = op('show', '--file', rosterPath(), '--id', 'gpt');
    expect(r.body['catalogue']).toEqual({ fetchedAt: CODEX.fetchedAt, stale: false, count: 9 });
    expect((r.body['derived'] as { unclassified: string[] }).unclassified)
      .toEqual(['gpt-6-astra', 'gpt-5.5', 'gpt-5.4-mini', 'gpt-5.3-codex-spark']);
  });

  it('a catalogue file that is not a catalogue refuses rather than reading as never-probed', () => {
    fs.mkdirSync(path.join(home, '.ccrc', 'models'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'models', 'gpt.json'), '{"probe":"gemini"}');
    const r = op('show', '--file', rosterPath(), '--id', 'gpt');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('catalogue-invalid');
  });

  it('a registry file that is not a registry refuses, naming the field', () => {
    fs.mkdirSync(path.join(home, '.ccrc', 'models'), { recursive: true });
    // `classes` must name all four keys explicitly (a model id or null) —
    // measured against `shared/models.mjs`'s current `parseRegistry`: an
    // OMITTED class key (`classes: {}`) is refused at `classes.haiku` before
    // the validator ever reaches `subagent`, since `classesRaw[cls]` is
    // `undefined`, not `null`. All four explicit `null`s is a legal
    // (unseeded) `classes`, so the missing `subagent` key is what this case
    // actually exercises.
    fs.writeFileSync(regPath('gpt'),
      JSON.stringify({ probe: 'codex', classes: { haiku: null, sonnet: null, opus: null, fable: null } }));
    const r = op('show', '--file', rosterPath(), '--id', 'gpt');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('registry-invalid');
    expect(r.body['field']).toBe('subagent');
  });

  it('names the settings keys that have drifted from the registry (§11)', () => {
    writeCatalogue('gpt');
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    const p = path.join(home, '.claude-gpt', 'settings.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'gpt-5.5';
    delete j.env.ANTHROPIC_SMALL_FAST_MODEL;
    fs.writeFileSync(p, JSON.stringify(j, null, 2));
    const r = op('show', '--file', rosterPath(), '--id', 'gpt');
    expect(r.code).toBe(0);
    expect(r.body['settingsDrift'])
      .toEqual(['ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL']);
  });

  it('reports NO drift right after a materialise, and none on a lane with no registry', () => {
    writeCatalogue('gpt');
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    expect(op('show', '--file', rosterPath(), '--id', 'gpt').body['settingsDrift']).toEqual([]);
    expect(op('show', '--file', rosterPath(), '--id', 'router').body['settingsDrift']).toEqual([]);
  });

  it('an ORPHAN registry — no roster row for this id — answers orphan:true, no class available (§11)', () => {
    // §11: `ccrc account remove` deliberately never deletes under
    // ~/.ccrc/models/, so a registry can outlive the roster row it was
    // classified for. There is no account to route a session through, so
    // every class reads as unavailable regardless of what the registry itself
    // assigns, and there is no settings.json to compare it against.
    writeCatalogue('gpt');
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    fs.writeFileSync(regPath('ghost'), fs.readFileSync(regPath('gpt'), 'utf8'));
    const r = op('show', '--file', rosterPath(), '--id', 'ghost');
    expect(r.code).toBe(0);
    expect(r.body['orphan']).toBe(true);
    expect((r.body['derived'] as { available: string[] }).available).toEqual([]);
    expect(r.body['settingsDrift']).toEqual([]);
  });
});

describe('init (§10, §13.1)', () => {
  it('seeds today\'s gpt registry for probe codex', () => {
    const r = op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    expect(r.code).toBe(0);
    expect(r.body['created']).toBe(true);
    expect(registryOf('gpt')).toEqual({
      probe: 'codex',
      classes: { haiku: 'gpt-5.6-luna', sonnet: 'gpt-5.6-terra', opus: 'gpt-5.6-sol', fable: null },
      subagent: 'sonnet',
      discovery: 'catalogue',
      effort: { haiku: 'high', sonnet: 'high', opus: 'max', fable: 'max' },
    });
  });

  it('materialises on success: the env block, the three-column TSV and the effort file', () => {
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    const s = settingsOf('.claude-gpt');
    expect(s.env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe('ccrc-unavailable-fable');
    expect(s.env.ANTHROPIC_MODEL).toBe('gpt-5.6-sol');
    expect(s.env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('gpt-5.6-terra');
    expect(fs.readFileSync(path.join(home, '.ccrc', 'models', 'gpt.classes.tsv'), 'utf8'))
      .toBe('haiku\tgpt-5.6-luna\tassigned\nsonnet\tgpt-5.6-terra\tassigned\n'
        + 'opus\tgpt-5.6-sol\tassigned\nfable\t\tunassigned\n');
    expect(JSON.parse(fs.readFileSync(path.join(home, '.ccrc', 'models', 'gpt.effort.json'), 'utf8')))
      .toEqual({ byModel: { 'gpt-5.6-luna': 'high', 'gpt-5.6-terra': 'high', 'gpt-5.6-sol': 'max' } });
  });

  it('is idempotent — a second init changes nothing and says so', () => {
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    const before = fs.readFileSync(regPath('gpt'), 'utf8');
    const r = op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    expect(r.code).toBe(0);
    expect(r.body['created']).toBe(false);
    expect(fs.readFileSync(regPath('gpt'), 'utf8')).toBe(before);
  });

  it('refuses to CHANGE the probe kind of a registry that exists', () => {
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    const r = op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'openrouter');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('probe-declared');
    expect(registryOf('gpt')['probe']).toBe('codex');
  });

  it('writes an UNSEEDED registry for openrouter, and materialises nothing (deviation B-1)', () => {
    const r = op('init', '--file', rosterPath(), '--id', 'router', '--probe', 'openrouter');
    expect(r.code).toBe(0);
    expect(r.body['created']).toBe(true);
    expect(registryOf('router')).toEqual({
      probe: 'openrouter',
      classes: { haiku: null, sonnet: null, opus: null, fable: null },
      subagent: 'sonnet',
      discovery: [],
    });
    expect(String(r.body['remedy'])).toMatch(/discovery add/);
    expect(fs.existsSync(path.join(home, '.claude-router', 'settings.json'))).toBe(false);
    // …and the TSV still exists, four lines, all unassigned: ccd reads it on
    // every spawn and an absent file is a different question from an empty lane.
    expect(fs.readFileSync(path.join(home, '.ccrc', 'models', 'router.classes.tsv'), 'utf8'))
      .toBe('haiku\t\tunassigned\nsonnet\t\tunassigned\nopus\t\tunassigned\nfable\t\tunassigned\n');
  });

  it('an unseeded compatible registry keeps the baseUrl it was given', () => {
    op('init', '--file', rosterPath(), '--id', 'router', '--probe', 'compatible',
      '--base-url', 'https://api.cortecs.ai');
    expect(registryOf('router')['baseUrl']).toBe('https://api.cortecs.ai');
    expect(registryOf('router')['discovery']).toBe('catalogue');
  });

  it('refuses compatible with no --base-url, and writes nothing', () => {
    const r = op('init', '--file', rosterPath(), '--id', 'router', '--probe', 'compatible');
    expect(r.code).toBe(1);
    expect(r.body['field']).toBe('baseUrl');
    expect(fs.existsSync(regPath('router'))).toBe(false);
  });

  it('refuses an anthropic lane by name', () => {
    const r = op('init', '--file', rosterPath(), '--id', 'claude-a', '--probe', 'codex');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('anthropic-lane');
    expect(fs.existsSync(regPath('claude-a'))).toBe(false);
  });

  it('refuses an unknown probe kind', () => {
    const r = op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'openai');
    expect(r.code).toBe(1);
    expect(r.body['field']).toBe('probe');
  });
});

describe('set-class', () => {
  beforeEach(() => {
    writeCatalogue('gpt');
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
  });

  it('assigns a class and re-materialises', () => {
    const r = op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'fable', '--model', 'gpt-6-astra');
    expect(r.code).toBe(0);
    expect(classesOf('gpt')['fable']).toBe('gpt-6-astra');
    expect(settingsOf('.claude-gpt').env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe('gpt-6-astra');
  });

  it('`none` clears a class and puts the sentinel back', () => {
    const r = op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'opus', '--model', 'none');
    expect(r.code).toBe(0);
    expect(classesOf('gpt')['opus']).toBeNull();
    const env = settingsOf('.claude-gpt').env;
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('ccrc-unavailable-opus');
    // …and ANTHROPIC_MODEL falls to sonnet rather than going missing.
    expect(env.ANTHROPIC_MODEL).toBe('gpt-5.6-terra');
  });

  it('ASSIGNING A CLASS CLEARS IT FROM THE MODEL THAT HAD IT — one model, one class', () => {
    // §8's radio-across-the-row rule, enforced here rather than only in the UI:
    // the verb exists for scripts and for doctor's remedies, and a script that
    // left one model in two classes would produce a lane where `/model opus`
    // and `/model sonnet` are the same thing with nothing saying so.
    //
    // The seeded registry's subagent is `sonnet` (SEEDS.codex), and this
    // assignment is about to clear sonnet's slot — moved off `sonnet` first,
    // to isolate the radio rule from the SEPARATE "subagent's slot went null"
    // refusal (measured: without this, `set-class opus gpt-5.6-terra` refuses
    // `registry-invalid`/`subagent`, not because of anything this test means
    // to exercise).
    op('set-subagent', '--file', rosterPath(), '--id', 'gpt', '--class', 'opus');
    const r = op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'opus', '--model', 'gpt-5.6-terra');
    expect(r.code).toBe(0);
    expect(classesOf('gpt')['opus']).toBe('gpt-5.6-terra');
    expect(classesOf('gpt')['sonnet']).toBeNull();
    expect((r.body['moved'] as string[]).join(' ')).toContain('sonnet');
  });

  // C11: the self-exclusion (`c !== a.class`) that keeps the TARGET class out
  // of its own `moved` list. No existing case re-assigns a class the model it
  // already holds, so dropping the clause survived unmeasured — `moved` would
  // have named the class that was just SET as one that lost its model, a
  // false statement in an `ok:true` body.
  it('a no-op reassignment — the model the class already holds — moves nothing (C11)', () => {
    const r = op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'sonnet', '--model', 'gpt-5.6-terra');
    expect(r.code).toBe(0);
    expect(r.body['moved']).toEqual([]);
    expect(classesOf('gpt')['sonnet']).toBe('gpt-5.6-terra');
  });

  it('refuses a class that is not one of the four', () => {
    const r = op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'subagent', '--model', 'gpt-5.5');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('unknown-class');
  });

  it('refuses a model the CATALOGUE does not list, naming it', () => {
    const r = op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'fable', '--model', 'gpt-9-nope');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('not-in-catalogue');
    expect(String(r.body['detail'])).toContain('gpt-9-nope');
  });

  it('accepts a model no catalogue can vouch for when there is NO catalogue at all', () => {
    fs.rmSync(path.join(home, '.ccrc', 'models', 'gpt.json'));
    const r = op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'fable', '--model', 'gpt-9-future');
    expect(r.code).toBe(0);
  });

  it('refuses an id that is not a model id', () => {
    const r = op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'fable', '--model', '/nope');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('bad-model-id');
  });

  it('adds the model to an EXPLICIT discovery list rather than refusing the assignment (compatible lane)', () => {
    // Fix round 1, Finding 1: an OPENROUTER lane's `set-class` never appends
    // implicitly any more — see the two `router` cases below — but a
    // `compatible` lane still does, since the ownership whitelist is an
    // openrouter-only property of the LANE (ruling 2026-09-08, spec §10).
    op('init', '--file', rosterPath(), '--id', 'router', '--probe', 'compatible', '--base-url', 'https://x');
    op('discovery', '--file', rosterPath(), '--id', 'router', '--action', 'add', '--model', 'a/b');
    const r = op('set-class', '--file', rosterPath(), '--id', 'router', '--class', 'sonnet', '--model', 'a/c');
    expect(r.code).toBe(0);
    expect(registryOf('router')['discovery']).toEqual(['a/b', 'a/c']);
  });

  it('openrouter set-class refuses an id not yet on the discovery list — it never appends implicitly (ruling 2026-09-08)', () => {
    op('init', '--file', rosterPath(), '--id', 'router', '--probe', 'openrouter');
    const r = op('set-class', '--file', rosterPath(), '--id', 'router', '--class', 'sonnet', '--model', 'a/c');
    expect(r.code).toBe(1);
    expect(r.body['field']).toBe('discovery');
    expect(String(r.body['detail'])).toMatch(/discovery add/);
    expect(classesOf('router')['sonnet']).toBeNull();
  });

  // minor: the openrouter not-discovered gate's own ERROR CODE, not
  // only `field`/`detail` — removing the gate does not open a write
  // (`parseRegistry`'s containment rule still refuses the same reassignment),
  // and THAT fallback refusal also carries `field: "discovery"` with a
  // remedy sentence that ALSO happens to contain the substring "discovery
  // add" (FIELD_REMEDY's generic template), so the case above passes either
  // way — measured: it does not red when this gate is deleted. Only the error
  // CODE ("not-discovered" vs. "registry-invalid") tells the two apart.
  it('openrouter set-class names the error "not-discovered", not merely a field/detail an unrelated refusal shares', () => {
    op('init', '--file', rosterPath(), '--id', 'router', '--probe', 'openrouter');
    const r = op('set-class', '--file', rosterPath(), '--id', 'router', '--class', 'sonnet', '--model', 'a/c');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('not-discovered');
  });

  it('openrouter set-class succeeds once discovery add has whitelisted the id, without appending twice', () => {
    op('init', '--file', rosterPath(), '--id', 'router', '--probe', 'openrouter');
    whitelist(['fireworks']);
    op('discovery', '--file', rosterPath(), '--id', 'router', '--action', 'add', '--model', 'a/c',
      '--endpoints', endpoints(['Fireworks']));
    const r = op('set-class', '--file', rosterPath(), '--id', 'router', '--class', 'sonnet', '--model', 'a/c');
    expect(r.code).toBe(0);
    expect(registryOf('router')['discovery']).toEqual(['a/c']);
  });

  it('refuses clearing the LAST class rather than writing a lane that routes nowhere (§11)', () => {
    op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'opus', '--model', 'none');
    op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'haiku', '--model', 'none');
    const r = op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'sonnet', '--model', 'none');
    expect(r.code).toBe(1);
    expect(String(r.body['detail'])).toMatch(/a lane needs at least one class/);
    // …and the registry is UNCHANGED: a refusal never half-writes.
    expect(classesOf('gpt')['sonnet']).toBe('gpt-5.6-terra');
  });

  it('refuses clearing the class the SUBAGENT points at, naming set-subagent', () => {
    // The seeded registry's subagent is `sonnet`. Clearing that slot would make
    // CLAUDE_CODE_SUBAGENT_MODEL a sentinel (§6.1) — refused at the validator
    // and again at the materialiser, with nothing written.
    const r = op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'sonnet', '--model', 'none');
    expect(r.code).toBe(1);
    expect(r.body['field']).toBe('subagent');
    expect(String(r.body['detail'])).toMatch(/set-subagent/);
    expect(classesOf('gpt')['sonnet']).toBe('gpt-5.6-terra');
  });

  it('CLAUDE_CODE_MAX_CONTEXT_TOKENS is min(the default model\'s catalogue context, 200000), and drops '
    + 'out when it cannot (§6.1, amended 2026-09-08, Task 16c)', () => {
    const r = op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'opus', '--model', 'gpt-5.6-sol');
    expect(r.code).toBe(0);
    // gpt-5.6-sol's catalogue context is 272000 — advertised, not usable
    // (fleet-host measurement: 196,341 the largest prompt ever accepted, 30
    // refusals past that wall) — so the key never exceeds the client's own
    // 200000 default.
    expect(settingsOf('.claude-gpt').env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe('200000');
    // Switching the default to a model no catalogue can vouch for — the same
    // "accepts a model no catalogue can vouch for" situation as above — leaves
    // nothing to measure a window from, and the STALE '200000' must not
    // survive the re-materialise: the eighth key carries no sentinel, so a
    // left-behind number would misstate the window rather than merely miss.
    fs.rmSync(path.join(home, '.ccrc', 'models', 'gpt.json'));
    const r2 = op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'opus', '--model', 'gpt-9-future');
    expect(r2.code).toBe(0);
    expect(classesOf('gpt')['opus']).toBe('gpt-9-future');
    expect(Object.keys(settingsOf('.claude-gpt').env)).not.toContain('CLAUDE_CODE_MAX_CONTEXT_TOKENS');
  });
});

describe('set-subagent (§10, ruling 5c)', () => {
  beforeEach(() => {
    writeCatalogue('gpt');
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
  });

  it('moves CLAUDE_CODE_SUBAGENT_MODEL to the named class\'s model', () => {
    const r = op('set-subagent', '--file', rosterPath(), '--id', 'gpt', '--class', 'opus');
    expect(r.code).toBe(0);
    expect(registryOf('gpt')['subagent']).toBe('opus');
    expect(settingsOf('.claude-gpt').env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('gpt-5.6-sol');
  });

  it('refuses a class whose slot is null, naming set-class as the remedy', () => {
    const r = op('set-subagent', '--file', rosterPath(), '--id', 'gpt', '--class', 'fable');
    expect(r.code).toBe(1);
    expect(r.body['field']).toBe('subagent');
    expect(String(r.body['detail'])).toMatch(/set-class fable/);
    expect(registryOf('gpt')['subagent']).toBe('sonnet');
  });

  it('refuses a word that is not a class', () => {
    const r = op('set-subagent', '--file', rosterPath(), '--id', 'gpt', '--class', 'subagent');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('unknown-class');
  });
});

describe('set-effort', () => {
  beforeEach(() => {
    writeCatalogue('gpt');
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
  });

  it('sets a level the catalogue offers, and it reaches the effort file', () => {
    const r = op('set-effort', '--file', rosterPath(), '--id', 'gpt', '--class', 'sonnet', '--level', 'xhigh');
    expect(r.code).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(home, '.ccrc', 'models', 'gpt.effort.json'), 'utf8')))
      .toEqual({ byModel: { 'gpt-5.6-luna': 'high', 'gpt-5.6-terra': 'xhigh', 'gpt-5.6-sol': 'max' } });
  });

  it('refuses a level the classed model does not offer, naming both', () => {
    // Luna has no `ultra`; Astra does (§4.1).
    const r = op('set-effort', '--file', rosterPath(), '--id', 'gpt', '--class', 'haiku', '--level', 'ultra');
    expect(r.code).toBe(1);
    expect(r.body['field']).toBe('effort.haiku');
    expect(String(r.body['detail'])).toContain('gpt-5.6-luna');
    expect(String(r.body['detail'])).toContain('ultra');
  });

  it('`default` removes the entry', () => {
    op('set-effort', '--file', rosterPath(), '--id', 'gpt', '--class', 'opus', '--level', 'default');
    expect((registryOf('gpt')['effort'] as Record<string, unknown>)['opus']).toBeUndefined();
    expect(JSON.parse(fs.readFileSync(path.join(home, '.ccrc', 'models', 'gpt.effort.json'), 'utf8'))
      .byModel['gpt-5.6-sol']).toBeUndefined();
  });

  it('refuses an effort on a class whose slot is null — there is no model to set it on', () => {
    const r = op('set-effort', '--file', rosterPath(), '--id', 'gpt', '--class', 'fable', '--level', 'max');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('class-unassigned');
  });
});

describe('discovery (§10) — the set discovery and classification operate on', () => {
  beforeEach(() => {
    writeCatalogue('router', { ...CODEX, probe: 'openrouter' });
    op('init', '--file', rosterPath(), '--id', 'router', '--probe', 'openrouter');
  });

  it('add builds the explicit list an openrouter lane requires', () => {
    whitelist(['fireworks']);
    const r = op('discovery', '--file', rosterPath(), '--id', 'router', '--action', 'add', '--model', 'gpt-5.5',
      '--endpoints', endpoints(['Fireworks']));
    expect(r.code).toBe(0);
    expect(r.body['scope']).toBe('list');
    expect(registryOf('router')['discovery']).toEqual(['gpt-5.5']);
  });

  it('add is idempotent and never duplicates', () => {
    whitelist(['fireworks']);
    const ep = endpoints(['Fireworks']);
    op('discovery', '--file', rosterPath(), '--id', 'router', '--action', 'add', '--model', 'gpt-5.5',
      '--endpoints', ep);
    op('discovery', '--file', rosterPath(), '--id', 'router', '--action', 'add', '--model', 'gpt-5.5',
      '--endpoints', ep);
    expect(registryOf('router')['discovery']).toEqual(['gpt-5.5']);
  });

  it('rm removes, and refuses to remove one a class still routes to', () => {
    whitelist(['fireworks']);
    op('discovery', '--file', rosterPath(), '--id', 'router', '--action', 'add', '--model', 'gpt-5.5',
      '--endpoints', endpoints(['Fireworks']));
    op('set-class', '--file', rosterPath(), '--id', 'router', '--class', 'sonnet', '--model', 'gpt-5.5');
    const r = op('discovery', '--file', rosterPath(), '--id', 'router', '--action', 'rm', '--model', 'gpt-5.5');
    expect(r.code).toBe(1);
    expect(r.body['field']).toBe('discovery');
    expect(registryOf('router')['discovery']).toEqual(['gpt-5.5']);
  });

  it('catalogue is refused on an openrouter lane', () => {
    const r = op('discovery', '--file', rosterPath(), '--id', 'router', '--action', 'catalogue');
    expect(r.code).toBe(1);
    expect(String(r.body['detail'])).toMatch(/openrouter requires an explicit discovery list/);
  });

  it('an unknown action is a usage error', () => {
    const r = op('discovery', '--file', rosterPath(), '--id', 'router', '--action', 'purge');
    expect(r.code).toBe(2);
  });
});

describe('discovery scope transitions (Fix round 1, Finding 2 — ruling 2026-09-08, spec §10)', () => {
  beforeEach(() => { op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex'); });

  it('add on a "catalogue" scope CONVERTS it to an explicit list of every classed id plus the new one', () => {
    const r = op('discovery', '--file', rosterPath(), '--id', 'gpt', '--action', 'add', '--model', 'gpt-5.5');
    expect(r.code).toBe(0);
    expect(r.body['scope']).toBe('list');
    // The seed's three classed ids (fable is null, excluded), in CLASSES
    // order, then the new one — never an empty list that silently drops what
    // "catalogue" used to cover.
    expect(registryOf('gpt')['discovery']).toEqual(
      ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.5']);
  });

  it('rm on a "catalogue" scope REFUSES — there is no explicit list to remove an id from', () => {
    const r = op('discovery', '--file', rosterPath(), '--id', 'gpt', '--action', 'rm', '--model', 'gpt-5.6-luna');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('discovery-is-catalogue');
    expect(r.body['field']).toBe('discovery');
    expect(String(r.body['detail'])).toMatch(/discovery add/);
    expect(String(r.body['detail'])).toMatch(/set-class .* none/);
    // …unchanged: the old behaviour silently turned "the whole catalogue"
    // into an empty explicit list here.
    expect(registryOf('gpt')['discovery']).toBe('catalogue');
  });

  it('catalogue RESTORES the whole-catalogue scope, from an explicit list back to "catalogue"', () => {
    // Finding 3: the OLD version of this test never actually exercised this —
    // its setup `discovery add` refused (the seed's own classed ids were not
    // yet in the list), so `discovery` was already "catalogue" from `init`
    // when the final assertion ran. With the conversion rule above, `add` now
    // succeeds, so the pre-state here is genuinely an explicit list.
    const added = op('discovery', '--file', rosterPath(), '--id', 'gpt', '--action', 'add', '--model', 'gpt-5.5');
    expect(added.code).toBe(0);
    expect(registryOf('gpt')['discovery']).toEqual(
      ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.5']);
    const r = op('discovery', '--file', rosterPath(), '--id', 'gpt', '--action', 'catalogue');
    expect(r.code).toBe(0);
    expect(r.body['scope']).toBe('catalogue');
    expect(registryOf('gpt')['discovery']).toBe('catalogue');
  });
});

describe('the ownership whitelist gates on the LANE, not the flag (Fix round 1, Finding 1 — ruling 2026-09-08, spec §10)', () => {
  it('openrouter discovery add without --endpoints refuses', () => {
    op('init', '--file', rosterPath(), '--id', 'router', '--probe', 'openrouter');
    const r = op('discovery', '--file', rosterPath(), '--id', 'router', '--action', 'add', '--model', 'gpt-5.5');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('endpoints-required');
    expect(String(r.body['detail'])).toMatch(/ccrc-models-probe/);
    expect(registryOf('router')['discovery']).toEqual([]);
  });

  it('--endpoints on a non-openrouter probe is a usage error, not a silently-ignored flag', () => {
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    const r = op('discovery', '--file', rosterPath(), '--id', 'gpt', '--action', 'add', '--model', 'gpt-5.5',
      '--endpoints', '/nonexistent/endpoints.json');
    expect(r.code).toBe(2);
  });
});

describe('the ownership whitelist at discovery-add (§5, §11)', () => {
  // `whitelist`/`endpoints` are module-scope now (Fix round 1) — see their
  // definitions near `writeCatalogue`.
  beforeEach(() => { op('init', '--file', rosterPath(), '--id', 'router', '--probe', 'openrouter'); });

  it('admits a model a whitelisted provider serves, and reports which', () => {
    whitelist(['fireworks', 'together']);
    const r = op('discovery', '--file', rosterPath(), '--id', 'router', '--action', 'add',
      '--model', 'z-ai/glm-5.2', '--endpoints', endpoints(['Fireworks', 'Z.AI']));
    expect(r.code).toBe(0);
    expect(r.body['servedBy']).toEqual(['fireworks']);
  });

  it('refuses when NO allowed provider serves it, naming the ones that do', () => {
    whitelist(['fireworks']);
    const r = op('discovery', '--file', rosterPath(), '--id', 'router', '--action', 'add',
      '--model', 'z-ai/glm-5.2', '--endpoints', endpoints(['Z.AI', 'Cortecs']));
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('no-allowed-provider');
    expect(String(r.body['detail'])).toContain('Z.AI');
    expect(registryOf('router')['discovery']).toEqual([]);
  });

  it('refuses when the whitelist file is absent — the proxy would refuse every request anyway', () => {
    const r = op('discovery', '--file', rosterPath(), '--id', 'router', '--action', 'add',
      '--model', 'z-ai/glm-5.2', '--endpoints', endpoints(['Fireworks']));
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('whitelist-absent');
  });

  it('normalises a provider name to the whitelist\'s slug form', () => {
    // The whitelist holds slugs (`google-ai-studio`); the endpoints body holds
    // display names (`Google AI Studio`). A check that compared them raw would
    // refuse every model on the list.
    whitelist(['google-ai-studio']);
    const r = op('discovery', '--file', rosterPath(), '--id', 'router', '--action', 'add',
      '--model', 'x/y', '--endpoints', endpoints(['Google AI Studio']));
    expect(r.code).toBe(0);
    expect(r.body['servedBy']).toEqual(['google-ai-studio']);
  });
});

describe('the registry write', () => {
  it('is atomic — no temp file survives a success', () => {
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    expect(fs.readdirSync(path.join(home, '.ccrc', 'models')).sort())
      .toEqual(['gpt.classes.json', 'gpt.classes.tsv', 'gpt.effort.json']);
  });

  it('keeps 2-space indent and a trailing newline', () => {
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    const text = fs.readFileSync(regPath('gpt'), 'utf8');
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "classes": {');
  });

  it('is 0600 — a compatible lane\'s registry names its endpoint', () => {
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    expect(fs.statSync(regPath('gpt')).mode & 0o777).toBe(0o600);
  });

  it('re-VALIDATES before writing: a mutation that would break the registry writes nothing', () => {
    writeCatalogue('gpt');
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    const before = fs.readFileSync(regPath('gpt'), 'utf8');
    const r = op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'opus', '--model', 'has space');
    expect(r.code).toBe(1);
    expect(fs.readFileSync(regPath('gpt'), 'utf8')).toBe(before);
  });
});

describe('materialise', () => {
  it('rewrites the three generated files from the registry and the catalogue', () => {
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    fs.rmSync(path.join(home, '.ccrc', 'models', 'gpt.classes.tsv'));
    // Fix round 1 (review): the seeded opus, gpt-5.6-sol, has catalogue
    // context 272000 — clamped TO the 200000 ceiling — so a mutant that
    // hardcoded the key to the literal '200000' (ignoring the catalogue
    // entirely) could not be told apart from a real clamp on that subject.
    // Point opus BELOW the ceiling instead, directly on disk (same pattern as
    // `writeCatalogue` below): only a model whose OWN context survives
    // unclamped proves the number came from the catalogue this run just
    // wrote, not a literal.
    const reg = registryOf('gpt');
    (reg['classes'] as Record<string, unknown>)['opus'] = 'gpt-5.3-codex-spark';
    fs.writeFileSync(regPath('gpt'), JSON.stringify(reg));
    writeCatalogue('gpt');
    const r = op('materialise', '--file', rosterPath(), '--id', 'gpt');
    expect(r.code).toBe(0);
    expect(r.body['wrote']).toEqual({
      settings: `${home}/.claude-gpt/settings.json`,
      classes: `${home}/.ccrc/models/gpt.classes.tsv`,
      effort: `${home}/.ccrc/models/gpt.effort.json`,
    });
    expect(fs.existsSync(path.join(home, '.ccrc', 'models', 'gpt.classes.tsv'))).toBe(true);
    // The catalogue this run just wrote (init ran before it existed, so init's
    // own materialise could not have) — proves `materialise` reads the SAME
    // freshly-parsed catalogue it used for `derived`, not a stale one (§6.1
    // amendment). gpt-5.3-codex-spark's catalogue context is 128000, BELOW
    // the 200000 ceiling, so this value can only have come from the fresh
    // catalogue — a mutant that hardcoded '200000' reds here (§6.1, amended
    // 2026-09-08, Task 16c fix round 1).
    expect(settingsOf('.claude-gpt').env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe('128000');
  });

  // C8: unpinned before this — dropping `{ mode: 0o600 }` at this write site
  // survived the whole covering suite (171/171, measured: models-op.test.ts +
  // ccrc-models.test.ts). Unlike the registry file's own pin (`the registry
  // write` describe above), nothing asserted the mode of either file this
  // same writer loop produces.
  //
  // Same vacuousness as `shared/modelenv.mjs`'s pins, same fix: a dropped
  // `{ mode: 0o600 }` falls back to 0o666 masked by whatever umask the
  // process has, and under a strict 077 that ALSO comes out 0o600 — the
  // mutant survives by coincidence. `op` forks a child via `spawnSync`, which
  // inherits the parent's umask at fork time, so forcing 022 here reaches the
  // child too: the mutant then lands on 0o644, not 0o600, under any runner
  // umask.
  it('the TSV and the effort file both land at 0600 (C8)', () => {
    const prevUmask = process.umask(0o022);
    try {
      op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
      expect(fs.statSync(path.join(home, '.ccrc', 'models', 'gpt.classes.tsv')).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.join(home, '.ccrc', 'models', 'gpt.effort.json')).mode & 0o777).toBe(0o600);
    } finally {
      process.umask(prevUmask);
    }
  });

  // materialise's catch never unlinked its own tmp — `writeRegistry`'s catch
  // does, this one did not. A deterministic rename failure (a directory
  // sitting at the TSV destination) leaked one `.tmp` file per failing call;
  // with the pre-C7-fix FIXED tmp name that was at most one stray total (the
  // next run's write reused the same name), but `${p}.${process.pid}.tmp`
  // turns it into a NEW leaked file every failing run — the failing writer
  // here being the hourly ccrc-models.timer this same wave wires into
  // `ccrc install`, so a lane wedged on this could accumulate one stray 0600
  // file an hour forever.
  it('a failed materialise unlinks its own tmp, run repeatedly', () => {
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    writeCatalogue('gpt');
    const tsvPath = path.join(home, '.ccrc', 'models', 'gpt.classes.tsv');
    fs.rmSync(tsvPath, { force: true });
    // A directory at the TSV's own destination: `renameSync(tmp, tsvPath)`
    // fails deterministically (EISDIR), every run, without racing anything.
    fs.mkdirSync(tsvPath);
    for (let i = 0; i < 3; i += 1) {
      const r = op('materialise', '--file', rosterPath(), '--id', 'gpt');
      expect(r.code, `run ${i}: ${JSON.stringify(r.body)}`).toBe(1);
    }
    const leftovers = fs.readdirSync(path.join(home, '.ccrc', 'models')).filter((n) => n.includes('.tmp'));
    expect(leftovers, `stray tmp files after 3 failing runs: ${JSON.stringify(leftovers)}`).toEqual([]);
  });

  it('on a lane with NO registry writes nothing and says so', () => {
    const r = op('materialise', '--file', rosterPath(), '--id', 'router');
    expect(r.code).toBe(0);
    expect(r.body['wrote']).toBeNull();
    expect(fs.existsSync(path.join(home, '.claude-router', 'settings.json'))).toBe(false);
  });

  it('on an UNSEEDED registry writes the TSV and no env block', () => {
    op('init', '--file', rosterPath(), '--id', 'router', '--probe', 'openrouter');
    const r = op('materialise', '--file', rosterPath(), '--id', 'router');
    expect(r.code).toBe(0);
    expect((r.body['wrote'] as Record<string, unknown>)['settings']).toBeNull();
    expect(fs.existsSync(path.join(home, '.claude-router', 'settings.json'))).toBe(false);
    expect(fs.existsSync(path.join(home, '.ccrc', 'models', 'router.classes.tsv'))).toBe(true);
  });

  it('on an anthropic lane refuses — its classes are the client\'s own', () => {
    const r = op('materialise', '--file', rosterPath(), '--id', 'claude-a');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('anthropic-lane');
  });

  // C7: a fixed `${p}.ccrc.tmp` name means two overlapping `materialise`
  // calls on the SAME lane race on ONE tmp file — the loser's `renameSync`
  // throws ENOENT once the winner has already renamed it away. Measured on
  // the pinned sha before this file's fix: 23-27/360 concurrent calls (6
  // wide, 60 rounds) failed this way. `${p}.${process.pid}.tmp` gives every
  // process its own name, so nothing to collide on remains. 20 rounds of 6
  // is narrower than the reviewer's 60 — this suite runs on every push, the
  // reviewer's repro ran once — but the collision is systemic (fires on any
  // overlap, not a rare interleaving), so 20*6 = 120 calls is already far
  // past the point a fixed name would show at least one failure.
  //
  // This exercises `deploy/models-op.mjs`'s OWN two tmp sites (the TSV and
  // the effort file) on every round, but NOT `shared/modelenv.mjs`'s
  // `mergeSettingsEnv` — `op('init', …)` above already materialises the
  // settings block once, so every later round's six calls compute the SAME
  // env, `mergeSettingsEnv`'s `!changed && existed` short-circuit returns
  // before it ever reaches its own tmp write, and 120 calls prove nothing
  // about that site. Deleting settings.json before each round removes
  // `existed`, so the short-circuit cannot fire and every round's six calls
  // race a genuine concurrent write there too.
  it('N concurrent materialise calls on the same lane all succeed (C7)', async () => {
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    writeCatalogue('gpt');
    const settingsPath = path.join(home, '.claude-gpt', 'settings.json');
    const rounds = 20;
    const width = 6;
    for (let round = 0; round < rounds; round += 1) {
      fs.rmSync(settingsPath, { force: true });
      const results = await Promise.all(
        Array.from({ length: width }, () => opAsync('materialise', '--file', rosterPath(), '--id', 'gpt')),
      );
      for (const r of results) {
        expect(r.code, `round ${round}: ${JSON.stringify(r.body)} stderr=${r.stderr}`).toBe(0);
      }
    }
  });
});

// minor: the check-only/`--commit true` two-phase protocol (Task 10 fix
// round 1's whole point, per the ledger's own record of that task) had zero
// coverage at THIS layer — `grep -n commit server/test/models-op.test.ts` returned
// nothing before this. It IS killed tree-wide, through
// `test/ccrc-models.test.ts`'s `_models_litellm` calls, but this op is the
// one writer of these bytes and its own suite could not tell check-only from
// commit — a future edit to the bash caller's two-call sequence would take
// the only pin with it.
describe('litellm (§6.3) — the two-phase check-then-commit protocol', () => {
  const TEMPLATE = path.join(REPO, 'deploy', 'litellm-config.template.yaml');
  const out = (): string => path.join(home, '.handoff', 'litellm-config.yaml');

  beforeEach(() => {
    writeCatalogue('gpt');
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
  });

  it('without --commit is CHECK-ONLY: reports changed:true and writes NOTHING at --out', () => {
    const r = op('litellm', '--file', rosterPath(), '--id', 'gpt', '--template', TEMPLATE, '--out', out());
    expect(r.code).toBe(0);
    expect(r.body['changed']).toBe(true);
    expect(fs.existsSync(out())).toBe(false);
    expect(fs.existsSync(`${out()}.prev`)).toBe(false);
  });

  it('--commit true writes both --out and --out.prev', () => {
    fs.mkdirSync(path.dirname(out()), { recursive: true });
    fs.writeFileSync(out(), 'stale previous rendering\n');
    const r = op('litellm', '--file', rosterPath(), '--id', 'gpt',
      '--template', TEMPLATE, '--out', out(), '--commit', 'true');
    expect(r.code).toBe(0);
    expect(r.body['changed']).toBe(true);
    expect(fs.existsSync(out())).toBe(true);
    expect(fs.readFileSync(out(), 'utf8')).not.toBe('stale previous rendering\n');
    expect(fs.existsSync(`${out()}.prev`)).toBe(true);
    expect(fs.readFileSync(`${out()}.prev`, 'utf8')).toBe('stale previous rendering\n');
  });
});

describe('rm (§4.1 Lifecycle, §10, §11) — reap, not a mutation', () => {
  beforeEach(() => {
    writeCatalogue('gpt');
    op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
  });

  it('removes all four generated files, in order, and clears exactly the eight env keys', () => {
    const p = path.join(home, '.claude-gpt', 'settings.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.env.DISABLE_TELEMETRY = '1';
    fs.writeFileSync(p, JSON.stringify(j, null, 2));
    // The beforeEach's `init` ran against a written catalogue, so the eighth
    // key is live before `rm` runs — this is the case that shows `rm` reaps
    // it too, not just the seven keys that predate the §6.1 amendment. The
    // default model's catalogue context (272000) is capped at 200000 (§6.1,
    // amended 2026-09-08, Task 16c).
    expect(j.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe('200000');
    const r = op('rm', '--file', rosterPath(), '--id', 'gpt');
    expect(r.code).toBe(0);
    expect(r.body['removed']).toEqual([
      regPath('gpt'),
      path.join(home, '.ccrc', 'models', 'gpt.json'),
      path.join(home, '.ccrc', 'models', 'gpt.classes.tsv'),
      path.join(home, '.ccrc', 'models', 'gpt.effort.json'),
    ]);
    expect(r.body['settings']).toBe('cleared');
    expect(fs.existsSync(regPath('gpt'))).toBe(false);
    expect(fs.existsSync(path.join(home, '.ccrc', 'models', 'gpt.json'))).toBe(false);
    expect(fs.existsSync(path.join(home, '.ccrc', 'models', 'gpt.classes.tsv'))).toBe(false);
    expect(fs.existsSync(path.join(home, '.ccrc', 'models', 'gpt.effort.json'))).toBe(false);
    const after = settingsOf('.claude-gpt');
    expect(after.env['DISABLE_TELEMETRY']).toBe('1');
    expect(Object.keys(after.env)).not.toContain('ANTHROPIC_MODEL');
    expect(Object.keys(after.env)).not.toContain('CLAUDE_CODE_MAX_CONTEXT_TOKENS');
  });

  it('is idempotent: a second call removes nothing and reports settings:unchanged', () => {
    op('rm', '--file', rosterPath(), '--id', 'gpt');
    const r = op('rm', '--file', rosterPath(), '--id', 'gpt');
    expect(r.code).toBe(0);
    expect(r.body['removed']).toEqual([]);
    expect(r.body['settings']).toBe('unchanged');
  });

  it('on an id the roster has no row for — an ORPHAN — skips the settings step and says so', () => {
    fs.writeFileSync(regPath('ghost'), fs.readFileSync(regPath('gpt'), 'utf8'));
    const r = op('rm', '--file', rosterPath(), '--id', 'ghost');
    expect(r.code).toBe(0);
    expect(r.body['removed']).toEqual([regPath('ghost')]);
    expect(r.body['settings']).toBe('orphan');
    // …and the still-live gpt lane, whose id the roster DOES have, is untouched.
    expect(fs.existsSync(regPath('gpt'))).toBe(true);
  });

  it('reaps a registry that does not even parse — rm -f semantics, not a validated read', () => {
    fs.writeFileSync(regPath('gpt'), '{ this is not json');
    const r = op('rm', '--file', rosterPath(), '--id', 'gpt');
    expect(r.code).toBe(0);
    expect(fs.existsSync(regPath('gpt'))).toBe(false);
  });

  it('never touches the roster', () => {
    const before = fs.readFileSync(rosterPath(), 'utf8');
    op('rm', '--file', rosterPath(), '--id', 'gpt');
    expect(fs.readFileSync(rosterPath(), 'utf8')).toBe(before);
  });

  // C6: `rm`'s unlink loop runs BEFORE the no-such-account gate (an orphan is
  // the expected case), which used to mean it ran before ANY id validation —
  // a `..`-bearing id built a path outside ~/.ccrc/models and deleted it,
  // reporting ok:true. Measured before the fix: this removed
  // $HOME/.claude/settings.json (via `cataloguePath`'s plain `${id}.json`
  // suffix) and answered ok:true. The account-id guard now runs at op entry,
  // before any of the four paths are built, on every op — not just `rm`.
  it('refuses a bad account id before any path is built, and deletes nothing (C6)', () => {
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{"marker":true}\n');
    const r = op('rm', '--file', rosterPath(), '--id', '../../.claude/settings');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('bad-account-id');
    expect(fs.existsSync(path.join(home, '.claude', 'settings.json'))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8')))
      .toEqual({ marker: true });
  });
});

// C6: the guard is at OP ENTRY, so every op that takes an `--id` refuses a
// bad one before touching the roster or any path — not just `rm`, which is
// the one the finding's own repro happened to exploit.
describe('the account-id guard applies to every op, not just rm (C6)', () => {
  it.each([
    ['show', []],
    ['set-subagent', ['--class', 'opus']],
    ['materialise', []],
    ['discovery', ['--action', 'catalogue']],
  ] as [string, string[]][])('%s refuses a bad --id', (opName, extra) => {
    const r = op(opName, '--file', rosterPath(), '--id', '../etc/passwd', ...extra);
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('bad-account-id');
  });

  it('accepts every id shape the roster itself uses, and an orphan reap id', () => {
    for (const id of ['gpt', 'claude-a', 'a', 'a'.repeat(32), 'ghost']) {
      const r = op('show', '--file', rosterPath(), '--id', id);
      expect(r.body['error']).not.toBe('bad-account-id');
    }
  });

  it('refuses an id one character over the 32-character cap', () => {
    const r = op('show', '--file', rosterPath(), '--id', 'a'.repeat(33));
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('bad-account-id');
  });
});
