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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { CODEX, CODEX_STALE, SEEDED, SEEDED_REGISTRY_BYTES } from './fixtures/modelCases.js';
import { codexAuthDir } from './codexLaneFixture.js';
import { ADVANCE_EXAMPLE, ADV_CATALOGUE, ADV_DEEP_TEXT, ADV_REGISTRY, ADV_SEEDS, EFFORTS4 } from './fixtures/advanceCases.js';
import { backfillAdvance, chooseCandidate, familyOf, recordMove, serializeAdvance } from '../../shared/model-advance.mjs';
import type { Advance, HistoryEntry } from '../../shared/model-advance.mjs';
import type { ModelClass, Registry } from '../../shared/models.js';
import { parseRegistry } from '../../shared/models.js';
// Auto-advance plan W2 (Tasks 8 and 9). Only names this file does not bind yet:
// W1 already imports `parseRegistry` and the type `Advance`.
import { BLOCKED_CAUSES, REASON_MAX } from '../../shared/model-advance.mjs';
import type { ClassAdvance } from '../../shared/model-advance.mjs';
import { contextWindowFor, modelEnvBlock } from '../../shared/modelenv.mjs';
import { parseCatalogue, parseWindows } from '../../shared/models.js';
import {
  STEP_CATALOGUE, STEP_REGISTRY, stepAdvance, stepRoster, stepRow,
} from './fixtures/advanceCases.js';

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
  return opEnv({}, ...args);
}

/** `op`, with `extra` laid over its environment (`CCRC_MODELS_NOW`, the advance file's clock). */
function opEnv(extra: NodeJS.ProcessEnv, ...args: string[]): Result {
  const r = spawnSync(process.execPath, [OP, ...args],
    { env: { ...process.env, HOME: home, ...extra }, encoding: 'utf8' });
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

/** This file's third ROSTER row, an EXTERNAL row, read by position rather than
 *  spelled, so no added line names a roster id outside Plan 3a's fixture
 *  vocabulary (ruling R13). */
const LEGACY_EXTERNAL_ID = ROSTER.accounts[2]!.id;

/** Plan 3a Task 2 (operator ruling Z3, D-3706): `init codex` no longer CREATES
 *  a codex registry on a row that is not exec.kind "codex", and this file's
 *  external rows are the kind the other repository's Codex lanes had before
 *  their flip (retired by Plan 4). A case that needs such a row WITH a codex
 *  registry is that old shape, a registry that predates the refusal, which the
 *  refusal leaves untouched. So it is planted in `init codex`'s own bytes
 *  (`SEEDED_REGISTRY_BYTES`), 0600 as `writeRegistry` writes it, and the op's
 *  own `materialise` then writes what `init` writes after them. */
function plantCodex(id: string): void {
  fs.mkdirSync(path.join(home, '.ccrc', 'models'), { recursive: true });
  fs.writeFileSync(regPath(id), SEEDED_REGISTRY_BYTES, { mode: 0o600 });
  const m = op('materialise', '--file', rosterPath(), '--id', id);
  expect(m.code, m.stdout + m.stderr).toBe(0);
}

/** One `exec.kind: "codex"` row, the one kind on which Z3 still lets `init
 *  codex` CREATE a registry. A case whose SUBJECT is init's own write
 *  (`writeRegistry`: its tmp-and-rename, its bytes, its mode) creates on this
 *  row, or makes a `compatible` create, never through `plantCodex`, which
 *  writes the file itself and so cannot measure that write (Plan 3a Task 2,
 *  fix round 1). Pure-parse ports: nothing here connects to one. */
const CODEX_ROW = {
  id: 'codex-a', label: 'codex-a', configDirSuffix: '.claude-codex-a',
  exec: { kind: 'codex', provider: 'openai', proxyPort: 45010, litellmPort: 45011, authDir: codexAuthDir('codex-a') },
  homeAble: false, telemetry: 'codex',
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

// Codex-bridge spec §2.7: the lane's measured windows, a SIBLING of the
// registry. Model ids are read off the fixtures and roster ids by position,
// never spelled: this repository is public.
const winPath = (id: string): string => path.join(home, '.ccrc', 'models', `${id}.windows.json`);
/** The planted registry's class models, distinct and in CLASSES order: what the rule measures. */
const CLASS_MODELS: string[] = [...new Set(Object.values(SEEDED.classes).filter((v): v is string => v !== null))];
const windowsFor = (byModel: Record<string, number>): unknown =>
  ({ windows: Object.fromEntries(Object.entries(byModel).map(([m, tokens]) => [m, { tokens }])) });
const plantWindows = (id: string, body: unknown): void => {
  fs.mkdirSync(path.dirname(winPath(id)), { recursive: true });
  fs.writeFileSync(winPath(id), typeof body === 'string' ? body : `${JSON.stringify(body, null, 2)}\n`);
};
const LEGACY_SUFFIX = ROSTER.accounts[2]!.configDirSuffix;
const eighthKey = (): string | undefined => settingsOf(LEGACY_SUFFIX).env['CLAUDE_CODE_MAX_CONTEXT_TOKENS'];

// auto-advance spec §2.1: the lane's advance file. The neutral fixture lane (`ADV_*`) is planted on this file's
// external row, or on CODEX_ROW where a case needs a codex-kind lane. Neutral ids only.
const NOW = '2026-10-15T00:00:00Z';
const advPath = (id: string): string => path.join(home, '.ccrc', 'models', `${id}.advance.json`);
const advanceOf = (id: string): Advance => JSON.parse(fs.readFileSync(advPath(id), 'utf8'));
const opAt = (...args: string[]): Result => opEnv({ CCRC_MODELS_NOW: NOW }, ...args);
function plantAdv(id: string = LEGACY_EXTERNAL_ID, registry: Registry = ADV_REGISTRY): void {
  writeCatalogue(id, ADV_CATALOGUE);
  fs.writeFileSync(regPath(id), `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
  const m = op('materialise', '--file', rosterPath(), '--id', id);
  expect(m.code, m.stdout + m.stderr).toBe(0);
}
const plantAdvance = (id: string, adv: Advance | string): void => {
  fs.writeFileSync(advPath(id), typeof adv === 'string' ? adv : serializeAdvance(adv));
};
/** `SEED_FAMILIES.codex`'s one literal word, read off the source rather than spelled (this repository is public), or
 *  null when the line has changed shape. Read when a case asks, never while vitest collects this file: a throw at
 *  collection would fail the whole file as one error and hide every other case's own result (`writeOps()`'s rule in
 *  ccrc-models-lock.test.ts). The case "SEED_FAMILIES.codex has its one literal word" names a reshaped line. */
const seedEmptyFamily = (): string | null => {
  const src = fs.readFileSync(OP, 'utf8');
  return /^\s*fable: '([a-z][a-z0-9]*)',$/m.exec(src.slice(src.indexOf('const SEED_FAMILIES')))?.[1] ?? null;
};
/** What `init codex` seeds: the families of SEEDED's three pins, and the literal for its empty class, read lazily: a
 *  case that needs the literal fails by name when it cannot be read. */
const CODEX_SEEDS = {
  haiku: familyOf(SEEDED.classes.haiku), sonnet: familyOf(SEEDED.classes.sonnet),
  opus: familyOf(SEEDED.classes.opus),
  get fable(): string {
    const word = seedEmptyFamily();
    if (word === null) {
      throw new Error('deploy/models-op.mjs has no SEED_FAMILIES literal for the empty class (the case '
        + '"SEED_FAMILIES.codex has its one literal word" names it)');
    }
    return word;
  },
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
    //
    // Plan 3a Task 2, fix round 1: `init`'s own CREATE stays on this list.
    // Since Z3 it cannot create a codex registry on the external row the
    // mutations below run on, which `plantCodex` therefore provides, so the
    // create runs on a codex-kind row the roster carries for it.
    seed({ ...ROSTER, accounts: [...ROSTER.accounts, CODEX_ROW] });
    const before = fs.readFileSync(rosterPath(), 'utf8');
    const mtimeBefore = fs.statSync(rosterPath()).mtimeMs;
    const created = op('init', '--file', rosterPath(), '--id', 'codex-a', '--probe', 'codex');
    expect(created.body['created'], created.stderr).toBe(true);
    writeCatalogue('gpt');
    plantCodex(LEGACY_EXTERNAL_ID);
    op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'fable', '--model', 'gpt-6-astra');
    op('set-subagent', '--file', rosterPath(), '--id', 'gpt', '--class', 'haiku');
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
    plantCodex(LEGACY_EXTERNAL_ID);
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
    plantCodex(LEGACY_EXTERNAL_ID);
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
    plantCodex(LEGACY_EXTERNAL_ID);
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
    plantCodex(LEGACY_EXTERNAL_ID);
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
    plantCodex(LEGACY_EXTERNAL_ID);
    fs.writeFileSync(regPath('ghost'), fs.readFileSync(regPath('gpt'), 'utf8'));
    const r = op('show', '--file', rosterPath(), '--id', 'ghost');
    expect(r.code).toBe(0);
    expect(r.body['orphan']).toBe(true);
    expect((r.body['derived'] as { available: string[] }).available).toEqual([]);
    expect(r.body['settingsDrift']).toEqual([]);
  });
});

describe('init (§10, §13.1)', () => {
  // Plan 3a Task 2 (operator ruling Z3, D-3706): a codex registry is CREATED
  // on an `exec.kind: "codex"` row only, so the two creation cases run on one
  // (`CODEX_ROW`, module scope). Their claims are unchanged, read off the
  // `SEEDED` fixture rather than retyped; the first also binds the bytes every
  // planted registry carries.
  it('seeds today\'s codex registry, byte for byte, on a codex-kind lane', () => {
    seed({ ...ROSTER, accounts: [...ROSTER.accounts, CODEX_ROW] });
    const r = op('init', '--file', rosterPath(), '--id', 'codex-a', '--probe', 'codex');
    expect(r.code).toBe(0);
    expect(r.body['created']).toBe(true);
    expect(registryOf('codex-a')).toEqual(SEEDED);
    // What `plantCodex` (above) and `ccrc-models.test.ts`' `seedCodex` write
    // for a lane whose registry predates the refusal: these same bytes.
    expect(fs.readFileSync(regPath('codex-a'), 'utf8')).toBe(SEEDED_REGISTRY_BYTES);
  });

  it('materialises on success: the env block, the three-column TSV and the effort file', () => {
    seed({ ...ROSTER, accounts: [...ROSTER.accounts, CODEX_ROW] });
    op('init', '--file', rosterPath(), '--id', 'codex-a', '--probe', 'codex');
    const { haiku, sonnet, opus } = SEEDED.classes;
    const s = settingsOf('.claude-codex-a');
    expect(s.env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe('ccrc-unavailable-fable');
    expect(s.env.ANTHROPIC_MODEL).toBe(opus);
    expect(s.env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('sonnet');
    expect(fs.readFileSync(path.join(home, '.ccrc', 'models', 'codex-a.classes.tsv'), 'utf8'))
      .toBe(`haiku\t${haiku}\tassigned\nsonnet\t${sonnet}\tassigned\n`
        + `opus\t${opus}\tassigned\nfable\t\tunassigned\n`);
    expect(JSON.parse(fs.readFileSync(path.join(home, '.ccrc', 'models', 'codex-a.effort.json'), 'utf8')))
      .toEqual({ byModel: { [haiku!]: 'high', [sonnet!]: 'high', [opus!]: 'max' } });
  });

  // Z3's refusal, on every row that is not codex-kind. The other repository's
  // Codex lanes' shape first (`ext-a`; retired by Plan 4); `ext-b` drops its
  // provider, and `gen-a` is the other kind a registry can sit on. Together
  // they say the gate is the row's KIND, never its telemetry or its provider.
  it.each([
    ['ext-a', { exec: { kind: 'external', provider: 'openai' }, telemetry: 'codex' }],
    ['ext-b', { exec: { kind: 'external' }, telemetry: 'codex' }],
    ['gen-a', { exec: { kind: 'generated' }, telemetry: 'none' }],
  ])('refuses to CREATE a codex registry on %s, a row that is not exec.kind codex, by name, and writes nothing (Z3)', (id, shape) => {
    seed({ ...ROSTER, accounts: [...ROSTER.accounts,
      { id, label: id, configDirSuffix: `.claude-${id}`, homeAble: false, ...shape }] });
    writeCatalogue(id);
    const r = op('init', '--file', rosterPath(), '--id', id, '--probe', 'codex');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('codex-registry-needs-codex-lane');
    expect(String(r.body['detail'])).toContain('Flip the lane to "codex" first (Plan 3b)');
    expect(String(r.body['detail'])).toContain('Nothing was written.');
    expect(r.stderr).toMatch(new RegExp(`^models-op: account "${id}" is not a codex-kind lane`, 'm'));
    for (const f of [`${id}.classes.json`, `${id}.classes.tsv`, `${id}.effort.json`]) {
      expect(fs.existsSync(path.join(home, '.ccrc', 'models', f)), f).toBe(false);
    }
    expect(fs.existsSync(path.join(home, `.claude-${id}`))).toBe(false);
  });

  it('every other probe kind is still created on an external row (Z3 refuses codex alone)', () => {
    const r = op('init', '--file', rosterPath(), '--id', 'router', '--probe', 'compatible',
      '--base-url', 'https://compatible.example.invalid');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body['created']).toBe(true);
    expect(registryOf('router')['probe']).toBe('compatible');
  });

  it('is idempotent — a second init changes nothing and says so', () => {
    plantCodex(LEGACY_EXTERNAL_ID);
    const before = fs.readFileSync(regPath('gpt'), 'utf8');
    const r = op('init', '--file', rosterPath(), '--id', 'gpt', '--probe', 'codex');
    expect(r.code).toBe(0);
    expect(r.body['created']).toBe(false);
    expect(fs.readFileSync(regPath('gpt'), 'utf8')).toBe(before);
  });

  it('refuses to CHANGE the probe kind of a registry that exists', () => {
    plantCodex(LEGACY_EXTERNAL_ID);
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
    plantCodex(LEGACY_EXTERNAL_ID);
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
    // to exercise). Moved to `haiku`, not `opus`: fix round 1, v2 (2026-09-09)
    // restricts `subagent` to haiku/sonnet, and opus is what this test is
    // about to reassign anyway.
    op('set-subagent', '--file', rosterPath(), '--id', 'gpt', '--class', 'haiku');
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
    // NEW-3 (round 3): the remedy names the two classes `set-subagent` accepts,
    // not the four `set-class` does — `<class>` would send an operator to
    // `set-subagent opus`, which is refused `subagent-class-unsupported`.
    expect(String(r.body['detail'])).toMatch(/set-subagent <haiku\|sonnet>/);
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
    plantCodex(LEGACY_EXTERNAL_ID);
  });

  it('moves CLAUDE_CODE_SUBAGENT_MODEL to the named class\'s alias', () => {
    // `haiku`, not `opus`: fix round 1, v2 (2026-09-09) restricts `subagent`
    // to haiku/sonnet — opus is refused (see below).
    const r = op('set-subagent', '--file', rosterPath(), '--id', 'gpt', '--class', 'haiku');
    expect(r.code).toBe(0);
    expect(registryOf('gpt')['subagent']).toBe('haiku');
    expect(settingsOf('.claude-gpt').env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('haiku');
  });

  it.each(['opus', 'fable'] as const)(
    'refuses --class %s: measured 2026-09-09 on Claude Code 2.1.267, it runs on the sonnet slot regardless',
    (cls) => {
      const before = registryOf('gpt');
      const beforeSettings = settingsOf('.claude-gpt');
      const r = op('set-subagent', '--file', rosterPath(), '--id', 'gpt', '--class', cls);
      expect(r.code).toBe(1);
      expect(r.body['error']).toBe('subagent-class-unsupported');
      expect(String(r.body['detail'])).toMatch(/haiku or sonnet/);
      // Nothing was written — registry AND settings unchanged.
      expect(registryOf('gpt')).toEqual(before);
      expect(settingsOf('.claude-gpt')).toEqual(beforeSettings);
    },
  );

  it('refuses a class whose slot is null, naming set-class as the remedy', () => {
    // `haiku`, not `fable`: fix round 1, v2 (2026-09-09) restricts `subagent`
    // to haiku/sonnet, so a null-slot case has to be a class the new gate
    // still lets through — haiku, nulled first, rather than fable (which is
    // now refused before this check is ever reached).
    op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'haiku', '--model', 'none');
    const r = op('set-subagent', '--file', rosterPath(), '--id', 'gpt', '--class', 'haiku');
    expect(r.code).toBe(1);
    expect(r.body['field']).toBe('subagent');
    expect(String(r.body['detail'])).toMatch(/set-class haiku/);
    expect(registryOf('gpt')['subagent']).toBe('sonnet');
  });

  it('refuses a word that is not a class', () => {
    const r = op('set-subagent', '--file', rosterPath(), '--id', 'gpt', '--class', 'subagent');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('unknown-class');
  });
});

describe('a legacy subagent: opus/fable already on disk (fix round 2A, N1)', () => {
  // `subagent: 'opus'` was a legal, verb-writable registry under the base
  // this branch narrowed (`ee1d6228`) — an operator could have run
  // `ccrc models gpt set-subagent opus` before this fix shipped. That value
  // must stay MANAGEABLE, not brick the lane: `parseRegistry` reads it
  // faithfully; only rendering (`show`'s `renderRefusal`, `materialise`) and
  // writing (`set-subagent`) refuse it, each naming
  // `ccrc models <id> set-subagent <haiku|sonnet>` as the remedy — a command
  // the parse gate lets run.
  beforeEach(() => {
    writeCatalogue('gpt');
    plantCodex(LEGACY_EXTERNAL_ID);
    // Hand-edit past every verb's own validation, the way a registry written
    // under the earlier contract would already be on disk.
    const p = regPath('gpt');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.subagent = 'opus';
    fs.writeFileSync(p, `${JSON.stringify(j, null, 2)}\n`);
  });

  it('(i) show exits 0, names the render failure as renderRefusal, and settingsDrift is empty', () => {
    const r = op('show', '--file', rosterPath(), '--id', 'gpt');
    expect(r.code).toBe(0);
    expect(registryOf('gpt')['subagent']).toBe('opus');
    expect(String(r.body['renderRefusal'])).toMatch(/must be haiku or sonnet/);
    expect(String(r.body['renderRefusal'])).toMatch(/set-subagent <haiku\|sonnet>/);
    expect(r.body['settingsDrift']).toEqual([]);
  });

  it('(ii) set-subagent --class haiku repairs the lane, and a following show clears renderRefusal', () => {
    const r = op('set-subagent', '--file', rosterPath(), '--id', 'gpt', '--class', 'haiku');
    expect(r.code).toBe(0);
    expect(registryOf('gpt')['subagent']).toBe('haiku');
    expect(settingsOf('.claude-gpt').env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('haiku');
    const r2 = op('show', '--file', rosterPath(), '--id', 'gpt');
    expect(r2.code).toBe(0);
    expect(r2.body['renderRefusal']).toBeNull();
  });

  it('(iii) materialise exits 1 settings-unwritable, with the remedy', () => {
    const r = op('materialise', '--file', rosterPath(), '--id', 'gpt');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('settings-unwritable');
    expect(String(r.body['detail'])).toMatch(/must be haiku or sonnet/);
    expect(String(r.body['detail'])).toMatch(/set-subagent <haiku\|sonnet>/);
  });

  it('(iv) set-subagent --class opus is still refused subagent-class-unsupported', () => {
    const r = op('set-subagent', '--file', rosterPath(), '--id', 'gpt', '--class', 'opus');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('subagent-class-unsupported');
    // Refused, nothing changed — the legacy value survives untouched.
    expect(registryOf('gpt')['subagent']).toBe('opus');
  });

  // The mutation tail's render check, before the write (`renderRefusal`, the
  // one check `set-window`/`clear-window` share): the edit itself is valid,
  // `parseRegistry` accepts it, and only the render refuses. Without the
  // check the registry would be rewritten and `materialise` then refuse.
  it('(v) set-effort is refused unroutable-lane BEFORE the write, and the registry is unchanged', () => {
    const id = LEGACY_EXTERNAL_ID;
    const before = fs.readFileSync(regPath(id), 'utf8');
    const r = op('set-effort', '--file', rosterPath(), '--id', id, '--class', 'sonnet', '--level', 'xhigh');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('unroutable-lane');
    expect(String(r.body['detail'])).toMatch(/set-subagent <haiku\|sonnet>/);
    expect(fs.readFileSync(regPath(id), 'utf8')).toBe(before);
  });
});

describe('set-effort', () => {
  beforeEach(() => {
    writeCatalogue('gpt');
    plantCodex(LEGACY_EXTERNAL_ID);
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
  beforeEach(() => { plantCodex(LEGACY_EXTERNAL_ID); });

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
  it('openrouter discovery add without --endpoints refuses, and the remedy names the verb that runs the probe (Plan 4)', () => {
    op('init', '--file', rosterPath(), '--id', 'router', '--probe', 'openrouter');
    const r = op('discovery', '--file', rosterPath(), '--id', 'router', '--action', 'add', '--model', 'gpt-5.5');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('endpoints-required');
    const detail = String(r.body['detail']);
    expect(detail).toContain('ccrc models router discovery add');
    expect(/Run 'ccrc-models-probe /.test(detail)).toBe(false);
    expect(registryOf('router')['discovery']).toEqual([]);
  });

  it('--endpoints on a non-openrouter probe is a usage error, not a silently-ignored flag', () => {
    plantCodex(LEGACY_EXTERNAL_ID);
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
  // Plan 3a Task 2, fix round 1: this describe's SUBJECT is `writeRegistry`,
  // init's own write, so each case CREATES through `init` on a row Z3 allows,
  // a codex-kind row (`CODEX_ROW`) or a `compatible` create, and never plants
  // the file through `plantCodex`, which would measure the fixture's write.
  it('is atomic — no temp file survives a success', () => {
    seed({ ...ROSTER, accounts: [...ROSTER.accounts, CODEX_ROW] });
    const r = op('init', '--file', rosterPath(), '--id', 'codex-a', '--probe', 'codex');
    expect(r.body['created'], r.stderr).toBe(true);
    expect(fs.readdirSync(path.join(home, '.ccrc', 'models')).sort())
      .toEqual(['codex-a.advance.json', 'codex-a.classes.json', 'codex-a.classes.tsv', 'codex-a.effort.json']);
  });

  it('keeps 2-space indent and a trailing newline', () => {
    seed({ ...ROSTER, accounts: [...ROSTER.accounts, CODEX_ROW] });
    const r = op('init', '--file', rosterPath(), '--id', 'codex-a', '--probe', 'codex');
    expect(r.body['created'], r.stderr).toBe(true);
    const text = fs.readFileSync(regPath('codex-a'), 'utf8');
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "classes": {');
  });

  // Round 3 re-review, M3: this pin was left out of C8's umask-forcing sweep
  // (the TSV/effort pin below, and `mergeSettingsEnv`'s/`clearSettingsEnv`'s
  // in modelenv.test.ts, all got it; `writeRegistry`'s own write did not).
  // Same vacuousness, same fix: a dropped `{ mode: 0o600 }` at
  // `writeRegistry` falls back to 0o666 masked by whatever umask the process
  // has, and under a strict 077 that ALSO comes out 0o600 by coincidence —
  // measured `(umask 077; …)` against the un-forced version of this test:
  // it passed with the mode pin dropped. `op` forks a child via `spawnSync`,
  // which inherits the parent's umask at fork time, so forcing 022 here
  // reaches the child too: the mutant then lands on 0o644, not 0o600, under
  // any runner umask.
  it('is 0600 — a compatible lane\'s registry names its endpoint', () => {
    const prevUmask = process.umask(0o022);
    try {
      const r = op('init', '--file', rosterPath(), '--id', 'router', '--probe', 'compatible',
        '--base-url', 'https://compatible.example.invalid');
      expect(r.body['created'], r.stderr).toBe(true);
      expect(fs.statSync(regPath('router')).mode & 0o777).toBe(0o600);
    } finally {
      process.umask(prevUmask);
    }
  });

  it('re-VALIDATES before writing: a mutation that would break the registry writes nothing', () => {
    writeCatalogue('gpt');
    plantCodex(LEGACY_EXTERNAL_ID);
    const before = fs.readFileSync(regPath('gpt'), 'utf8');
    const r = op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'opus', '--model', 'has space');
    expect(r.code).toBe(1);
    expect(fs.readFileSync(regPath('gpt'), 'utf8')).toBe(before);
  });
});

describe('materialise', () => {
  it('rewrites the three generated files from the registry and the catalogue', () => {
    plantCodex(LEGACY_EXTERNAL_ID);
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
      // `null` DELIBERATELY: this case's lane is `exec: { kind: 'external' }`
      // — the shape a Codex lane has on a box that has not cut over — and only
      // an `exec.kind: 'codex'` row gets spec §5.4's `lane.json`. The key is
      // present on every answer, so an exact pin here is where dropping it reds.
      lane: null,
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
      plantCodex(LEGACY_EXTERNAL_ID);
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
    plantCodex(LEGACY_EXTERNAL_ID);
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
  // `mergeSettingsEnv` — this case's `plantCodex(…)` setup (its own
  // `materialise` step, since Plan 3a Task 2 no longer runs `init` here)
  // already materialises the settings block once, so every later round's
  // six calls compute the SAME env, `mergeSettingsEnv`'s
  // `!changed && existed` short-circuit returns
  // before it ever reaches its own tmp write, and 120 calls prove nothing
  // about that site. Deleting settings.json before each round removes
  // `existed`, so the short-circuit cannot fire and every round's six calls
  // race a genuine concurrent write there too.
  it('N concurrent materialise calls on the same lane all succeed (C7)', async () => {
    plantCodex(LEGACY_EXTERNAL_ID);
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

// Spec §5.4: `~/.ccrc/codex/<id>/lane.json`, "the one thing `ccgpt`, the shim
// and the publisher read, so none of them re-derives a path from a naming
// convention". Written by `materialise`, beside the TSV and the effort file,
// through the same tmp + rename loop — so every accepted mutation re-renders it
// (rule 3), which `ccrc-models.test.ts` drives through the verb. The consumer
// half — the real publisher reading what this writer wrote — is
// `ccgpt-usage.test.ts`'s (D-3158).
describe('lane.json (spec §5.4) — the codex lane manifest', () => {
  // A codex-KIND row: the one kind whose `exec` carries `authDir` and the two
  // ports. Fixture values only — the public port pair the other codex-row
  // fixtures use, an auth dir that names nothing real. It also carries one
  // OPTIONAL exec field the manifest must not (`secretsFile`, a fixture path),
  // so a writer that copied `exec` wholesale reds the payload case's exact pin.
  const CODEX_LANE = {
    id: 'codex-a', label: 'codex-a', configDirSuffix: '.claude-codex-a',
    exec: {
      kind: 'codex', provider: 'openai', proxyPort: 45010, litellmPort: 45011, authDir: '.codex-a-auth',
      secretsFile: '.secrets/codex-a.env',
    },
    homeAble: false, telemetry: 'codex',
  };
  // The shape spec §1 measured for the other repository's Codex lanes (retired
  // by Plan 4): `external`, yet naming provider `openai` and reporting
  // `telemetry: 'codex'`. The row that tells the kind gate from a gate on
  // either of those two fields — `router` above carries neither, so it cannot.
  const CODEX_EXTERNAL = {
    id: 'codex-b', label: 'codex-b', configDirSuffix: '.claude-codex-b',
    exec: { kind: 'external', provider: 'openai' },
    homeAble: false, telemetry: 'codex',
  };
  const laneDir = (): string => path.join(home, '.ccrc', 'codex', 'codex-a');
  const lanePath = (): string => path.join(laneDir(), 'lane.json');
  const laneOf = (): Record<string, unknown> => JSON.parse(fs.readFileSync(lanePath(), 'utf8'));
  /** Moves the registry's haiku class onto `model` directly on disk — the
   *  operator's reclassification, which `init`'s seed never carries — so a
   *  writer that read `SEEDS` instead of the registry cannot pass. */
  const reclassifyHaiku = (model: string): void => {
    const reg = registryOf('codex-a');
    (reg['classes'] as Record<string, unknown>)['haiku'] = model;
    fs.writeFileSync(regPath('codex-a'), JSON.stringify(reg));
  };

  beforeEach(() => { seed({ ...ROSTER, accounts: [...ROSTER.accounts, CODEX_LANE, CODEX_EXTERNAL] }); });

  // Umask forced to 022 for the reason the TSV/effort 0600 pin above gives: a
  // dropped `{ mode: 0o600 }` under a strict runner umask would land 0600 by
  // coincidence. `op`'s `spawnSync` child inherits it.
  it('writes the §5.4 payload at 0600, probeModel read off the registry\'s haiku class', () => {
    const prevUmask = process.umask(0o022);
    try {
      expect(op('init', '--file', rosterPath(), '--id', 'codex-a', '--probe', 'codex').code).toBe(0);
      reclassifyHaiku('gpt-x-mini');
      const r = op('materialise', '--file', rosterPath(), '--id', 'codex-a');
      expect(r.code).toBe(0);
      expect((r.body['wrote'] as Record<string, unknown>)['lane']).toBe(lanePath());
      const text = fs.readFileSync(lanePath(), 'utf8');
      expect(text.endsWith('}\n')).toBe(true);
      expect(text).toContain('\n  "units": {');
      // The registry file is the oracle for `probeModel`, not a literal; the
      // line after is the control that the oracle holds the reclassified id.
      expect(JSON.parse(text)).toEqual({
        id: 'codex-a',
        configDir: '.claude-codex-a',
        authDir: '.codex-a-auth',
        proxyPort: 45010,
        litellmPort: 45011,
        bridge: 'litellm',
        upstream: 'backend',
        probeModel: classesOf('codex-a')['haiku'],
        units: { litellm: 'ccgpt-codex-a-litellm.service', shim: 'ccgpt-codex-a-shim.service' },
        bridgeFiles: { stats: 'bridge.stats.json', store: 'reasoning.sqlite', recordings: 'recordings' },
      });
      expect(classesOf('codex-a')['haiku']).toBe('gpt-x-mini');
      expect(fs.statSync(lanePath()).mode & 0o777).toBe(0o600);
    } finally {
      process.umask(prevUmask);
    }
  });

  // codex-bridge Stage 2, Task 10 (spec D20): ONE reader per layer. The mode and the
  // route are the PARSED account's (`rosterFromJson`'s resolved pair), never the raw
  // row's `exec`, so the default is spelled only in the two validators. A row with no
  // `exec.bridge` is the case that tells them apart: the raw row has nothing to copy.
  it('laneManifest copies the parsed account\'s bridge, not the raw row', () => {
    op('init', '--file', rosterPath(), '--id', 'codex-a', '--probe', 'codex');
    expect(Object.prototype.hasOwnProperty.call(CODEX_LANE.exec, 'bridge')).toBe(false);
    const lane = laneOf();
    expect(lane['bridge']).toBe('litellm');
    expect(lane['upstream']).toBe('backend');
    // Control, the other way: a named value is copied as named.
    seed({ ...ROSTER, accounts: [...ROSTER.accounts,
      { ...CODEX_LANE, exec: { ...CODEX_LANE.exec, bridge: 'direct', upstream: 'siwc' } }, CODEX_EXTERNAL] });
    const r = op('materialise', '--file', rosterPath(), '--id', 'codex-a');
    expect(r.code, JSON.stringify(r.body)).toBe(0);
    expect(laneOf()['bridge']).toBe('direct');
    expect(laneOf()['upstream']).toBe('siwc');
  });

  it('a roster the mirror refuses for its bridge word renders no lane.json at all', () => {
    op('init', '--file', rosterPath(), '--id', 'codex-a', '--probe', 'codex');
    const before = fs.readFileSync(lanePath(), 'utf8');
    seed({ ...ROSTER, accounts: [...ROSTER.accounts,
      { ...CODEX_LANE, exec: { ...CODEX_LANE.exec, bridge: 'proxy' } }, CODEX_EXTERNAL] });
    const r = op('materialise', '--file', rosterPath(), '--id', 'codex-a');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('roster-invalid');
    expect(String(r.body['detail'])).toMatch(/exec\.bridge/);
    expect(fs.readFileSync(lanePath(), 'utf8')).toBe(before);
  });

  it('with haiku unassigned, OMITS probeModel rather than choosing another class', () => {
    op('init', '--file', rosterPath(), '--id', 'codex-a', '--probe', 'codex');
    expect(Object.prototype.hasOwnProperty.call(laneOf(), 'probeModel')).toBe(true);
    // A mutation re-renders the file whole, so the key `init` wrote is GONE,
    // not left behind: a stale value would name a model the operator just
    // took off this lane.
    const r = op('set-class', '--file', rosterPath(), '--id', 'codex-a', '--class', 'haiku', '--model', 'none');
    expect(r.code).toBe(0);
    expect(classesOf('codex-a')['haiku']).toBeNull();
    const lane = laneOf();
    expect(Object.prototype.hasOwnProperty.call(lane, 'probeModel')).toBe(false);
    expect(lane['id']).toBe('codex-a');
    expect(lane['authDir']).toBe('.codex-a-auth');
  });

  it('on a lane that is not exec.kind codex, writes no manifest and answers lane: null', () => {
    // `router` is `external` carrying a CODEX registry, as the live Codex
    // lanes were before the cutover (retired by Plan 4; the next case adds
    // their provider and telemetry). It has no auth dir or ports to write, and
    // nothing may guess them.
    plantCodex('router');
    const r = op('materialise', '--file', rosterPath(), '--id', 'router');
    expect(r.code).toBe(0);
    expect((r.body['wrote'] as Record<string, unknown>)['lane']).toBeNull();
    expect(fs.existsSync(path.join(home, '.ccrc', 'codex'))).toBe(false);
  });

  it('on an external row carrying a codex registry, in the pre-cutover shape (provider openai, telemetry codex), writes no manifest either', () => {
    // A gate on `telemetry === 'codex'` or on `exec.provider === 'openai'`
    // passes the `router` case above and would write THIS row a manifest with no
    // authDir and no ports — `JSON.stringify` drops the undefined fields.
    plantCodex('codex-b');
    const r = op('materialise', '--file', rosterPath(), '--id', 'codex-b');
    expect(r.code).toBe(0);
    expect((r.body['wrote'] as Record<string, unknown>)['lane']).toBeNull();
    expect(fs.existsSync(path.join(home, '.ccrc', 'codex', 'codex-b'))).toBe(false);
  });

  // The directory holds the gateway key from Plan 2b-2 on (`runtime.env`, spec
  // §5.4), and only its creation can set its mode — `mkdirSync` never tightens
  // one that exists. Measured under two umasks, because 077 would hide a
  // dropped mode and 002 is the group-writable default some boxes carry.
  it('creates the lane directory 0700 under a permissive umask', () => {
    op('init', '--file', rosterPath(), '--id', 'codex-a', '--probe', 'codex');
    const prevUmask = process.umask();
    try {
      for (const mask of [0o002, 0o022]) {
        // Removed each round, so the directory is CREATED under this umask
        // rather than found already there.
        fs.rmSync(path.join(home, '.ccrc', 'codex'), { recursive: true, force: true });
        process.umask(mask);
        const r = op('materialise', '--file', rosterPath(), '--id', 'codex-a');
        const why = `umask ${mask.toString(8)}: ${JSON.stringify(r.body)}`;
        expect(r.code, why).toBe(0);
        expect(fs.statSync(laneDir()).mode & 0o777, why).toBe(0o700);
        expect(fs.statSync(lanePath()).mode & 0o777, why).toBe(0o600);
      }
    } finally {
      process.umask(prevUmask);
    }
  });

  it('a mutation that leaves haiku null answers with the remedy the publisher will need', () => {
    op('init', '--file', rosterPath(), '--id', 'codex-a', '--probe', 'codex');
    const haiku = classesOf('codex-a')['haiku'];
    expect(typeof haiku).toBe('string');
    // One model, one class: giving sonnet haiku's model MOVES haiku to null,
    // and `moved` is all the answer would otherwise say about it.
    const r = op('set-class', '--file', rosterPath(), '--id', 'codex-a', '--class', 'sonnet', '--model', String(haiku));
    expect(r.code).toBe(0);
    expect(r.body['moved']).toEqual(['haiku']);
    expect(classesOf('codex-a')['haiku']).toBeNull();
    expect(String(r.body['remedy'])).toContain("'ccrc models codex-a set-class haiku <modelId>'");
    expect(String(r.body['remedy'])).toMatch(/usage publisher refuses/);
    // Control, one way: assigning haiku again clears the remedy — it is keyed
    // on the result, not printed on every codex-lane mutation.
    const back = op('set-class', '--file', rosterPath(), '--id', 'codex-a', '--class', 'haiku', '--model', 'gpt-x-mini');
    expect(back.code).toBe(0);
    expect(Object.prototype.hasOwnProperty.call(back.body, 'remedy')).toBe(false);
  });

  it('the same move on a lane with no manifest carries no such remedy', () => {
    // Control, the other way: `router` has no lane.json and no publisher
    // reading one, so nothing about its usage publication just changed.
    plantCodex('router');
    const haiku = String(classesOf('router')['haiku']);
    const r = op('set-class', '--file', rosterPath(), '--id', 'router', '--class', 'sonnet', '--model', haiku);
    expect(r.code).toBe(0);
    expect(r.body['moved']).toEqual(['haiku']);
    expect(Object.prototype.hasOwnProperty.call(r.body, 'remedy')).toBe(false);
  });

  // The existing tmp-leftover case's shape, aimed at the third file.
  it('a failed lane.json write unlinks its own tmp, run repeatedly', () => {
    op('init', '--file', rosterPath(), '--id', 'codex-a', '--probe', 'codex');
    fs.rmSync(lanePath(), { force: true });
    // A directory at the manifest's destination: `renameSync(tmp, lane.json)`
    // fails (EISDIR) every run, AFTER the tmp exists.
    fs.mkdirSync(lanePath());
    for (let i = 0; i < 3; i += 1) {
      const r = op('materialise', '--file', rosterPath(), '--id', 'codex-a');
      expect(r.code, `run ${i}: ${JSON.stringify(r.body)}`).toBe(1);
      expect(r.body['error']).toBe('materialise-failed');
      // Control: the failure is the RENAME of a tmp that exists onto the
      // manifest's own path. rename(2) answers EISDIR only when its source is
      // there (a missing source is ENOENT, measured), so this is a tmp that
      // was really written and had to be unlinked. "Names lane.json" alone is
      // not enough: a failed OPEN of `lane.json.<pid>.tmp` names it too, and
      // would leave this case counting the leftovers of a tmp never made.
      const detail = String(r.body['detail']);
      expect(detail).toMatch(/^EISDIR: /);
      expect(detail).toContain(`rename '${lanePath()}.`);
      expect(detail).toContain(`.tmp' -> '${lanePath()}'`);
    }
    const leftovers = fs.readdirSync(laneDir()).filter((n) => n.includes('.tmp'));
    expect(leftovers, `stray tmp files after 3 failing runs: ${JSON.stringify(leftovers)}`).toEqual([]);
  });

  // The tmp-leftover case above is satisfied by a writer that makes no tmp at
  // all, so it cannot tell tmp + rename from an in-place write. This can:
  // replacing a directory entry is the DIRECTORY's permission, so a rename
  // lands over a read-only lane.json, and an in-place `writeFileSync` is
  // refused EACCES. Root ignores the file's write bit, so the discriminator
  // proves nothing there — a visible skip, not a false red.
  it.skipIf(typeof process.getuid === 'function' && process.getuid() === 0)(
    'replaces an existing lane.json by rename — a read-only one is still re-rendered', () => {
      op('init', '--file', rosterPath(), '--id', 'codex-a', '--probe', 'codex');
      fs.chmodSync(lanePath(), 0o444);
      reclassifyHaiku('gpt-x-mini');
      const r = op('materialise', '--file', rosterPath(), '--id', 'codex-a');
      expect(r.code, JSON.stringify(r.body)).toBe(0);
      expect(laneOf()['probeModel']).toBe('gpt-x-mini');
    });

  // ── Plan 3a Task 4: `materialise --check true` (ruling R7) ────────────────
  // `ccrc doctor`'s `_check_codex` asks this whether lane.json has gone stale
  // against the REGISTRY, which `_codex_lane_json_state`'s roster-only compare
  // cannot see. Every case proves the check WROTE NOTHING, by bytes AND by
  // mtime (a rewrite of identical bytes still moves the mtime), because a
  // check that cured what it measured would turn doctor into a writer.
  const stateOf = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const d of [path.join(home, '.ccrc', 'codex'), laneDir(), path.join(home, '.ccrc', 'models')]) {
      if (!fs.existsSync(d)) continue;
      out[`${d}/`] = String(fs.statSync(d).mtimeMs);
      for (const n of fs.readdirSync(d)) {
        const p = path.join(d, n);
        if (fs.statSync(p).isFile()) out[p] = `${fs.statSync(p).mtimeMs}:${fs.readFileSync(p, 'utf8')}`;
      }
    }
    return out;
  };
  const check = (id = 'codex-a', value = 'true'): Result =>
    op('materialise', '--file', rosterPath(), '--id', id, '--check', value);
  const laneChanged = (r: Result): unknown => (r.body['changed'] as Record<string, unknown>)['lane'];

  it('--check true on a converged codex lane: every file unchanged, and nothing written', () => {
    expect(op('init', '--file', rosterPath(), '--id', 'codex-a', '--probe', 'codex').code).toBe(0);
    const before = stateOf();
    const r = check();
    expect(r.code, JSON.stringify(r.body)).toBe(0);
    expect(r.body).toEqual({ ok: true, op: 'materialise', id: 'codex-a', check: true,
      changed: { lane: false, classes: false, effort: false } });
    expect(stateOf()).toEqual(before);
  });

  it('--check true after the registry moves on disk: lane.json is changed, and still holds the OLD bytes', () => {
    op('init', '--file', rosterPath(), '--id', 'codex-a', '--probe', 'codex');
    const old = fs.readFileSync(lanePath(), 'utf8');
    reclassifyHaiku('gpt-x-mini');
    const before = stateOf();
    const r = check();
    expect(r.code, JSON.stringify(r.body)).toBe(0);
    expect(laneChanged(r)).toBe(true);
    expect(stateOf()).toEqual(before);
    expect(fs.readFileSync(lanePath(), 'utf8')).toBe(old);
    // Control: the WRITE form cures it, and the check then answers unchanged.
    expect(op('materialise', '--file', rosterPath(), '--id', 'codex-a').code).toBe(0);
    expect(laneChanged(check())).toBe(false);
  });

  it('--check true after a roster port edit is changed; with the lane directory gone it is changed and the directory is NOT recreated', () => {
    op('init', '--file', rosterPath(), '--id', 'codex-a', '--probe', 'codex');
    seed({ ...ROSTER, accounts: [...ROSTER.accounts,
      { ...CODEX_LANE, exec: { ...CODEX_LANE.exec, proxyPort: 45020 } }, CODEX_EXTERNAL] });
    expect(laneChanged(check())).toBe(true);
    fs.rmSync(path.join(home, '.ccrc', 'codex'), { recursive: true, force: true });
    const r = check();
    expect(r.code, JSON.stringify(r.body)).toBe(0);
    expect(laneChanged(r)).toBe(true);
    expect(fs.existsSync(path.join(home, '.ccrc', 'codex'))).toBe(false);
  });

  it('--check true answers lane: null on a lane with no manifest, and changed: null on a lane with no registry', () => {
    // `router` is `external` and carries a codex registry that ALREADY EXISTS,
    // as the live first lane's does. It is planted by hand, never through
    // `init codex`, which ruling Z3 refuses on an external row: a registry
    // that already exists is the one shape Z3 leaves alone.
    fs.mkdirSync(path.dirname(regPath('router')), { recursive: true });
    fs.writeFileSync(regPath('router'), `${JSON.stringify({ probe: 'codex',
      classes: { haiku: null, sonnet: null, opus: null, fable: null }, subagent: 'sonnet', discovery: 'catalogue' }, null, 2)}\n`);
    const r = check('router');
    expect(r.code, JSON.stringify(r.body)).toBe(0);
    expect(laneChanged(r)).toBeNull();
    const none = check('codex-a');
    expect(none.code, JSON.stringify(none.body)).toBe(0);
    expect(none.body['changed']).toBeNull();
    expect(fs.existsSync(path.join(home, '.ccrc', 'codex'))).toBe(false);
  });

  it('--check with any value but "true" is refused at exit 2 and writes nothing — a typo never falls through to the write', () => {
    op('init', '--file', rosterPath(), '--id', 'codex-a', '--probe', 'codex');
    reclassifyHaiku('gpt-x-mini');
    const before = stateOf();
    for (const v of ['yes', 'TRUE', '1']) {
      const r = check('codex-a', v);
      expect(r.code, v).toBe(2);
      expect(r.body['error'], v).toBe('bad-argv');
    }
    expect(stateOf()).toEqual(before);
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
    plantCodex(LEGACY_EXTERNAL_ID);
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

  // Plan 4 Task C1: moved here from `ccrc-models.test.ts`, whose verb now
  // answers a row that is not codex-kind in its own dispatcher
  // (`not-codex-kind`) before this op is asked. This op's own guard still
  // refuses a lane whose registry is not a codex probe, and this is its pin.
  it('refuses a lane whose probe is not codex: not-a-codex-lane, naming its probe (Plan 4)', () => {
    op('init', '--file', rosterPath(), '--id', 'router', '--probe', 'openrouter');
    const r = op('litellm', '--file', rosterPath(), '--id', 'router', '--template', TEMPLATE, '--out', out());
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('not-a-codex-lane');
    expect(String(r.body['detail'])).toMatch(/has probe "openrouter"/);
    expect(fs.existsSync(out())).toBe(false);
  });
});

describe('rm (§4.1 Lifecycle, §10, §11) — reap, not a mutation', () => {
  beforeEach(() => {
    writeCatalogue('gpt');
    plantCodex(LEGACY_EXTERNAL_ID);
  });

  it('removes all four model-registry files, in order, and clears exactly the eight env keys', () => {
    const p = path.join(home, '.claude-gpt', 'settings.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.env.DISABLE_TELEMETRY = '1';
    fs.writeFileSync(p, JSON.stringify(j, null, 2));
    // The beforeEach's `plantCodex` (its `materialise` step, which Plan 3a
    // Task 2 put where `init` was) ran against a written catalogue, so the eighth
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
  // before any of its paths are built, on every op — not just `rm`.
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

describe('the measured windows file — read, applied, reported, reaped (codex-bridge spec §2.7)', () => {
  const ID = LEGACY_EXTERNAL_ID;
  const all = (tokens: number): unknown => windowsFor(Object.fromEntries(CLASS_MODELS.map((m) => [m, tokens])));
  const mat = (): Result => op('materialise', '--file', rosterPath(), '--id', ID);
  const show = (): Result => op('show', '--file', rosterPath(), '--id', ID);

  beforeEach(() => {
    writeCatalogue(ID);
    plantCodex(ID);
  });

  it('every class model measured: materialise writes the SMALLEST window — above 200000 when measured so', () => {
    const [m0, m1, m2] = CLASS_MODELS as [string, string, string];
    plantWindows(ID, windowsFor({ [m0]: 511000, [m1]: 450000, [m2]: 400000 }));
    const r = mat();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(eighthKey()).toBe('400000');
  });

  it('one class model unmeasured: the key stays today\'s 200000', () => {
    const [m0, m1] = CLASS_MODELS as [string, string];
    plantWindows(ID, windowsFor({ [m0]: 511000, [m1]: 511000 }));
    expect(mat().code).toBe(0);
    expect(eighthKey()).toBe('200000');
  });

  it('with no windows file the env block is today\'s, every key', () => {
    const { haiku, sonnet, opus } = SEEDED.classes;
    expect(mat().code).toBe(0);
    expect(settingsOf(LEGACY_SUFFIX).env).toEqual({
      ANTHROPIC_DEFAULT_HAIKU_MODEL: haiku, ANTHROPIC_DEFAULT_SONNET_MODEL: sonnet,
      ANTHROPIC_DEFAULT_OPUS_MODEL: opus, ANTHROPIC_DEFAULT_FABLE_MODEL: 'ccrc-unavailable-fable',
      ANTHROPIC_MODEL: opus, ANTHROPIC_SMALL_FAST_MODEL: haiku, CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet',
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: '200000',
    });
  });

  it.each([
    ['not JSON', '{ this is not json'],
    ['an array', '[]'],
    ['a windows that is not an object', '{"windows": 7}'],
    ['a window below the minimum', JSON.stringify({ windows: { [SEEDED.classes.opus!]: { tokens: 5 } } })],
  ])('an unreadable windows file (%s) never blocks materialise: the default rule applies', (_why, body) => {
    plantWindows(ID, all(400000));
    expect(mat().code).toBe(0);
    expect(eighthKey()).toBe('400000');
    plantWindows(ID, body);
    const r = mat();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(eighthKey()).toBe('200000');
  });

  it('show reports each measured window, the effective window, its rule and the unmeasured models', () => {
    const [m0, m1, m2] = CLASS_MODELS as [string, string, string];
    plantWindows(ID, { windows: { [m0]: { tokens: 511000, setAt: '2026-10-15T12:00:00.000Z' }, [m1]: { tokens: 450000 } } });
    const r = show();
    expect(r.code).toBe(0);
    expect(r.body['windows']).toEqual({ state: 'ok', byModel: {
      [m0]: { tokens: 511000, setAt: '2026-10-15T12:00:00.000Z' }, [m1]: { tokens: 450000, setAt: null } } });
    expect(r.body['contextWindow']).toEqual({ tokens: 200000, rule: 'default', unmeasured: [m2] });
  });

  it('show with every class model measured reports rule measured', () => {
    plantWindows(ID, all(400000));
    expect(show().body['contextWindow']).toEqual({ tokens: 400000, rule: 'measured', unmeasured: [] });
  });

  it('show with no windows file: state absent, every class model unmeasured', () => {
    const r = show();
    expect(r.body['windows']).toEqual({ state: 'absent' });
    expect(r.body['contextWindow']).toEqual({ tokens: 200000, rule: 'default', unmeasured: CLASS_MODELS });
  });

  // `contextWindow` is null ONLY with no registry file, and a caller tells
  // that lane apart by the null; an unseeded registry still gets the decision.
  it('an Anthropic lane, with no registry file, answers contextWindow null and windows absent', () => {
    const r = op('show', '--file', rosterPath(), '--id', ROSTER.accounts[1]!.id);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body['registry']).toBeNull();
    expect(r.body['contextWindow']).toBeNull();
    expect(r.body['windows']).toEqual({ state: 'absent' });
  });

  it('an UNSEEDED registry still gets the decision: no key, rule none (deviation B-1)', () => {
    const id = ROSTER.accounts[3]!.id;
    const i = op('init', '--file', rosterPath(), '--id', id, '--probe', 'openrouter');
    expect(i.code, i.stdout + i.stderr).toBe(0);
    const r = op('show', '--file', rosterPath(), '--id', id);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body['contextWindow']).toEqual({ tokens: null, rule: 'none', unmeasured: [] });
  });

  it('show on an unreadable windows file answers ok, names the file and the reason, and reports the default rule', () => {
    plantWindows(ID, '{ this is not json');
    const r = show();
    expect(r.code).toBe(0);
    const w = r.body['windows'] as { state: string; reason: string };
    expect(w.state).toBe('unreadable');
    expect(w.reason).toContain(winPath(ID));
    expect(w.reason).toMatch(/is not valid JSON/);
    expect((r.body['contextWindow'] as { rule: string }).rule).toBe('default');
  });

  it('settingsDrift names the eighth key once the windows moved past the last materialise', () => {
    plantWindows(ID, all(400000));
    expect(show().body['settingsDrift']).toEqual(['CLAUDE_CODE_MAX_CONTEXT_TOKENS']);
    expect(mat().code).toBe(0);
    expect(show().body['settingsDrift']).toEqual([]);
  });

  it('an unreadable windows file adds no drift: the drift check reads it as the default rule', () => {
    plantWindows(ID, '[]');
    expect(show().body['settingsDrift']).toEqual([]);
  });

  it('a DIRECTORY at the windows path: show reports it unreadable, materialise carries on, rm stops at it', () => {
    fs.mkdirSync(winPath(ID), { recursive: true });
    const s = show();
    expect(s.code, s.stdout + s.stderr).toBe(0);
    expect(s.body['windows']).toMatchObject({ state: 'unreadable' });
    expect((s.body['windows'] as { reason: string }).reason).toMatch(/not a regular file/);
    const m = mat();
    expect(m.code, m.stdout + m.stderr).toBe(0);
    expect(eighthKey()).toBe('200000');
    // `rm -f` semantics per file, as for the other four: a directory is not a
    // file `rm` may unlink, so it reaps the four before it and stops there,
    // the answer a directory at any of those four paths already gets.
    const r = op('rm', '--file', rosterPath(), '--id', ID);
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('unwritable');
    expect(String(r.body['detail'])).toContain(`${winPath(ID)} could not be removed`);
    expect(fs.existsSync(regPath(ID))).toBe(false);
  });

  it('a class that moves to an unmeasured model drops the lane back to the default rule (spec §5)', () => {
    plantWindows(ID, all(400000));
    expect(mat().code).toBe(0);
    expect(eighthKey()).toBe('400000');
    const next = CODEX.models.find((m) => !m.hidden && !CLASS_MODELS.includes(m.id) && m.context === 272000)!.id;
    const r = op('set-class', '--file', rosterPath(), '--id', ID, '--class', 'opus', '--model', next);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(eighthKey()).toBe('200000');
    expect(r.body['contextWindow']).toEqual({ tokens: 200000, rule: 'default', unmeasured: [next] });
  });

  // The mutation tail and init's create each pass the windows reading to
  // `materialise` (Task 3: the same reading to every caller). A tail or a
  // create that passed null would write the default rule's 200000 over a
  // lane every one of whose class models is measured.
  it('a mutation that leaves the classes alone still writes the measured window (the tail passes the reading)', () => {
    plantWindows(ID, all(400000));
    expect(eighthKey()).toBe('200000');
    const r = op('set-effort', '--file', rosterPath(), '--id', ID, '--class', 'sonnet', '--level', 'xhigh');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(eighthKey()).toBe('400000');
    expect(r.body['contextWindow']).toEqual({ tokens: 400000, rule: 'measured', unmeasured: [] });
  });

  it('init applies a windows file already on disk: the lane it creates is materialised with the measured window', () => {
    seed({ ...ROSTER, accounts: [...ROSTER.accounts, CODEX_ROW] });
    writeCatalogue(CODEX_ROW.id);
    plantWindows(CODEX_ROW.id, all(400000));
    const r = op('init', '--file', rosterPath(), '--id', CODEX_ROW.id, '--probe', 'codex');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body['created']).toBe(true);
    expect(settingsOf(CODEX_ROW.configDirSuffix).env['CLAUDE_CODE_MAX_CONTEXT_TOKENS']).toBe('400000');
    expect(r.body['contextWindow']).toEqual({ tokens: 400000, rule: 'measured', unmeasured: [] });
  });

  it('rm reaps the windows file with the lane\'s other model files, last', () => {
    plantWindows(ID, all(400000));
    const r = op('rm', '--file', rosterPath(), '--id', ID);
    expect(r.code).toBe(0);
    expect(r.body['removed'] as string[]).toHaveLength(5);
    expect((r.body['removed'] as string[]).slice(-1)).toEqual([winPath(ID)]);
    expect(fs.existsSync(winPath(ID))).toBe(false);
  });

  it('rm reaps an unreadable windows file too — rm -f semantics, not a validated read', () => {
    plantWindows(ID, '{ this is not json');
    expect(op('rm', '--file', rosterPath(), '--id', ID).code).toBe(0);
    expect(fs.existsSync(winPath(ID))).toBe(false);
  });

  it('an ORPHAN show reports its windows too', () => {
    fs.writeFileSync(regPath('ghost'), fs.readFileSync(regPath(ID), 'utf8'));
    plantWindows('ghost', all(400000));
    const r = op('show', '--file', rosterPath(), '--id', 'ghost');
    expect(r.body['orphan']).toBe(true);
    expect((r.body['windows'] as { state: string }).state).toBe('ok');
    expect((r.body['contextWindow'] as { rule: string }).rule).toBe('measured');
  });
});

// D-5785. With a stale or absent catalogue the default rule yields nothing,
// so the block OMITS the eighth key, and the hourly refresh materialises only
// after a successful probe. A windows file deleted or broken outside the two
// verbs then leaves a measured key of up to 1000000 in settings.json, which
// a drift check that asked only about the block's own keys never named. The
// key is drift whenever the next materialise would delete it.
describe('a measured key the block omits is drift until a materialise removes it (D-5785)', () => {
  const ID = LEGACY_EXTERNAL_ID;
  const KEY = 'CLAUDE_CODE_MAX_CONTEXT_TOKENS';
  const show = (): Result => op('show', '--file', rosterPath(), '--id', ID);
  const driftOf = (): unknown => show().body['settingsDrift'];
  const measureAll = (): void => {
    for (const m of CLASS_MODELS) {
      const r = op('set-window', '--file', rosterPath(), '--id', ID, '--model', m, '--tokens', '400000');
      expect(r.code, r.stdout + r.stderr).toBe(0);
    }
    expect(eighthKey()).toBe('400000');
  };
  const breaks: Record<string, () => void> = {
    deleted: () => fs.rmSync(winPath(ID)),
    'not JSON': () => fs.writeFileSync(winPath(ID), '{ this is not json'),
  };

  const catalogues: Record<string, unknown> = { absent: null, stale: CODEX_STALE };

  it.each([
    ['absent', 'deleted'],
    ['absent', 'not JSON'],
    ['stale', 'deleted'],
    ['stale', 'not JSON'],
  ])('catalogue %s, windows file %s: show names the key, materialise removes it', (which, how) => {
    if (catalogues[which] !== null) writeCatalogue(ID, catalogues[which]);
    plantCodex(ID);
    // No window and no catalogue number: no key, and nothing to report.
    expect(eighthKey()).toBeUndefined();
    expect(driftOf()).toEqual([]);
    measureAll();
    expect(driftOf()).toEqual([]);
    breaks[how]!();
    const s = show();
    expect(s.code, s.stdout + s.stderr).toBe(0);
    expect((s.body['contextWindow'] as { rule: string }).rule).toBe('none');
    expect(s.body['settingsDrift']).toEqual([KEY]);
    // `show` names the drift and never repairs it.
    expect(eighthKey()).toBe('400000');
    const m = op('materialise', '--file', rosterPath(), '--id', ID);
    expect(m.code, m.stdout + m.stderr).toBe(0);
    expect(Object.keys(settingsOf(LEGACY_SUFFIX).env)).not.toContain(KEY);
    expect(driftOf()).toEqual([]);
  });

  // The block INCLUDES the key here (a fresh catalogue's default rule), so the
  // answer is today's: the key once, by value, never a second time for being
  // on disk. 'settingsDrift names the eighth key once the windows moved past
  // the last materialise', above, is the same answer in the other direction.
  it('a fresh catalogue: the block carries the key, and drift names it once, by value', () => {
    writeCatalogue(ID);
    plantCodex(ID);
    measureAll();
    fs.rmSync(winPath(ID));
    expect(driftOf()).toEqual([KEY]);
    expect(op('materialise', '--file', rosterPath(), '--id', ID).code).toBe(0);
    expect(eighthKey()).toBe('200000');
    expect(driftOf()).toEqual([]);
  });
});

describe('set-window and clear-window (codex-bridge spec §2.7)', () => {
  const ID = LEGACY_EXTERNAL_ID;
  const OPUS = SEEDED.classes.opus!;
  const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  const windowsFile = (): Record<string, unknown> & { windows: Record<string, Record<string, unknown>> } =>
    JSON.parse(fs.readFileSync(winPath(ID), 'utf8'));
  const setWindow = (model: string, tokens: string, id: string = ID): Result =>
    op('set-window', '--file', rosterPath(), '--id', id, '--model', model, '--tokens', tokens);
  const clearWindow = (model: string, id: string = ID): Result =>
    op('clear-window', '--file', rosterPath(), '--id', id, '--model', model);
  const showOf = (): Result => op('show', '--file', rosterPath(), '--id', ID);

  beforeEach(() => {
    writeCatalogue(ID);
    plantCodex(ID);
  });

  it('set-window records the window with a UTC setAt, answers previous: null, and re-materialises', () => {
    const r = setWindow(OPUS, '400000');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toMatchObject({ ok: true, op: 'set-window', model: OPUS, tokens: 400000, previous: null });
    const entry = windowsFile().windows[OPUS]!;
    expect(entry['tokens']).toBe(400000);
    expect(String(entry['setAt'])).toMatch(ISO_UTC);
    // Two class models are still unmeasured, so the rule is still the default.
    expect(eighthKey()).toBe('200000');
    expect(r.body['contextWindow']).toEqual({ tokens: 200000, rule: 'default',
      unmeasured: CLASS_MODELS.filter((m) => m !== OPUS) });
  });

  it('the LAST class model measured flips the lane to the smallest window, in that same call', () => {
    const [m0, m1, m2] = CLASS_MODELS as [string, string, string];
    expect(setWindow(m0, '511000').code).toBe(0);
    expect(setWindow(m1, '450000').code).toBe(0);
    expect(eighthKey()).toBe('200000');
    const r = setWindow(m2, '400000');
    expect(r.code).toBe(0);
    expect(eighthKey()).toBe('400000');
    expect(r.body['contextWindow']).toEqual({ tokens: 400000, rule: 'measured', unmeasured: [] });
    expect(r.body['settingsDrift']).toEqual([]);
  });

  it('set-window again replaces the value and answers the previous one', () => {
    expect(setWindow(OPUS, '400000').code).toBe(0);
    const r = setWindow(OPUS, '350000');
    expect(r.body).toMatchObject({ tokens: 350000, previous: 400000 });
    expect(windowsFile().windows[OPUS]!['tokens']).toBe(350000);
  });

  it.each(['1000', '1000000'])('accepts the bound %s exactly', (tokens) => {
    expect(setWindow(OPUS, tokens).code).toBe(0);
  });

  it.each(['400k', '400,000', '4e5', '400000.0', '-400000', ' 400000', '999', '1000001', ''])(
    'refuses %j as a window, naming the field and the digits-only form, and writes nothing', (tokens) => {
      const r = setWindow(OPUS, tokens);
      expect(r.code).toBe(1);
      expect(r.body['error']).toBe('bad-window');
      expect(r.body['field']).toBe('tokens');
      expect(String(r.body['detail'])).toMatch(/from 1000 to 1000000, written in digits only/);
      expect(fs.existsSync(winPath(ID))).toBe(false);
    });

  it('refuses a model neither in the catalogue nor a class model — the typo guard — and writes nothing', () => {
    const r = setWindow('model-9-omega', '400000');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('unknown-window-model');
    expect(r.body['field']).toBe('model');
    expect(String(r.body['detail'])).toContain(`ccrc models ${ID} show`);
    expect(fs.existsSync(winPath(ID))).toBe(false);
  });

  it('refuses a CLASS name where a model id belongs, and says which it takes', () => {
    const r = setWindow('opus', '400000');
    expect(r.body['error']).toBe('unknown-window-model');
    expect(String(r.body['detail'])).toMatch(/takes a MODEL id, not a class/);
  });

  it('accepts a catalogue model no class names yet — measure it before a class moves to it', () => {
    const spare = CODEX.models.find((m) => !CLASS_MODELS.includes(m.id))!.id;
    const r = setWindow(spare, '400000');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((r.body['contextWindow'] as { rule: string }).rule).toBe('default');
  });

  it('accepts a class model on a lane no catalogue vouches for (never probed)', () => {
    fs.rmSync(path.join(home, '.ccrc', 'models', `${ID}.json`));
    expect(setWindow(OPUS, '400000').code).toBe(0);
  });

  it('refuses an id that is not a model id', () => {
    const r = setWindow('../escape', '400000');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('bad-model-id');
  });

  // clear-window has no typo guard, so this test is the only thing between
  // it and answering `ok, removed: false` for a string that is no model id.
  it('clear-window refuses an id that is not a model id too, and writes nothing', () => {
    const r = clearWindow('../escape');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('bad-model-id');
    expect(r.body['field']).toBe('model');
    expect(fs.existsSync(winPath(ID))).toBe(false);
  });

  it('never rewrites the class registry — bytes and mtime unchanged, the rollback property', () => {
    const before = fs.readFileSync(regPath(ID), 'utf8');
    const mtime = fs.statSync(regPath(ID)).mtimeMs;
    expect(setWindow(OPUS, '400000').code).toBe(0);
    expect(clearWindow(OPUS).code).toBe(0);
    expect(fs.readFileSync(regPath(ID), 'utf8')).toBe(before);
    expect(fs.statSync(regPath(ID)).mtimeMs).toBe(mtime);
    expect(Object.keys(registryOf(ID))).not.toContain('windows');
  });

  it('PRESERVES keys this build does not know, at the top level and inside an entry', () => {
    const [m0, m1] = CLASS_MODELS as [string, string];
    plantWindows(ID, { version: 2, windows: { [m0]: { tokens: 300000, source: 'probe' } } });
    expect(setWindow(m1, '400000').code).toBe(0);
    expect(setWindow(m0, '350000').code).toBe(0);
    const f = windowsFile();
    expect(f['version']).toBe(2);
    expect(f.windows[m0]).toMatchObject({ tokens: 350000, source: 'probe' });
    expect(f.windows[m1]).toMatchObject({ tokens: 400000 });
  });

  it('clear-window of an absent entry is ok with removed: false, and writes no file', () => {
    const r = clearWindow(OPUS);
    expect(r.code).toBe(0);
    expect(r.body).toMatchObject({ ok: true, op: 'clear-window', model: OPUS, removed: false });
    expect(fs.existsSync(winPath(ID))).toBe(false);
  });

  // The write gate: clear-window writes only when it removed an entry. The
  // file is planted COMPACT and dated in the past, so a rewrite of the very
  // same object (the writer's two-space form, a fresh mtime) would show.
  it('clear-window of an absent entry leaves a file holding another entry as it was: bytes and mtime', () => {
    const other = CLASS_MODELS.find((m) => m !== OPUS)!;
    plantWindows(ID, JSON.stringify(windowsFor({ [other]: 400000 })));
    const past = new Date('2026-01-01T00:00:00Z');
    fs.utimesSync(winPath(ID), past, past);
    const before = fs.readFileSync(winPath(ID), 'utf8');
    const mtime = fs.statSync(winPath(ID)).mtimeMs;
    const r = clearWindow(OPUS);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toMatchObject({ ok: true, op: 'clear-window', model: OPUS, removed: false });
    expect(fs.readFileSync(winPath(ID), 'utf8')).toBe(before);
    expect(fs.statSync(winPath(ID)).mtimeMs).toBe(mtime);
  });

  it('clear-window drops one entry and re-materialises: one class model unmeasured is the default rule again', () => {
    for (const m of CLASS_MODELS) expect(setWindow(m, '400000').code).toBe(0);
    expect(eighthKey()).toBe('400000');
    const r = clearWindow(OPUS);
    expect(r.body).toMatchObject({ removed: true });
    expect(eighthKey()).toBe('200000');
    expect(Object.keys(windowsFile().windows)).toEqual(CLASS_MODELS.filter((m) => m !== OPUS));
  });

  it('clearing the LAST entry deletes the file, so absent keeps meaning no measured window', () => {
    expect(setWindow(OPUS, '400000').code).toBe(0);
    expect(clearWindow(OPUS).body).toMatchObject({ removed: true });
    expect(fs.existsSync(winPath(ID))).toBe(false);
    expect(showOf().body['windows']).toEqual({ state: 'absent' });
  });

  it('clearing the last entry KEEPS a file that still holds a top-level key this build does not know', () => {
    plantWindows(ID, { version: 2, windows: { [OPUS]: { tokens: 300000 } } });
    expect(clearWindow(OPUS).body).toMatchObject({ removed: true });
    expect(windowsFile()).toEqual({ version: 2, windows: {} });
  });

  it('clear-window has no typo guard: a stale entry for a model the lane no longer names is removable', () => {
    plantWindows(ID, windowsFor({ 'model-9-omega': 5000 }));
    expect(clearWindow('model-9-omega').body).toMatchObject({ ok: true, removed: true });
    expect(fs.existsSync(winPath(ID))).toBe(false);
  });

  it('a stale entry for a model no class names is ignored by the rule and still listed by show', () => {
    plantWindows(ID, windowsFor({ ...Object.fromEntries(CLASS_MODELS.map((m) => [m, 400000])), 'model-9-omega': 5000 }));
    const r = showOf();
    expect(r.body['contextWindow']).toEqual({ tokens: 400000, rule: 'measured', unmeasured: [] });
    expect(Object.keys((r.body['windows'] as { byModel: Record<string, unknown> }).byModel)).toContain('model-9-omega');
  });

  it.each([
    ['not JSON', '{ this is not json'],
    ['an array', '[]'],
    ['a window too small', JSON.stringify({ windows: { 'model-9-omega': { tokens: 5 } } })],
  ])('an unreadable windows file (%s): both verbs refuse with the remedy, and the file is untouched', (_why, body) => {
    plantWindows(ID, body);
    for (const r of [setWindow(OPUS, '400000'), clearWindow(OPUS)]) {
      expect(r.code).toBe(1);
      expect(r.body['error']).toBe('windows-unreadable');
      expect(String(r.body['detail'])).toContain(winPath(ID));
      expect(String(r.body['detail'])).toMatch(/delete it to drop every measured window/);
    }
    expect(fs.readFileSync(winPath(ID), 'utf8')).toBe(body);
  });

  it('a DIRECTORY at the windows path: both verbs refuse windows-unreadable, never a block', () => {
    fs.mkdirSync(winPath(ID), { recursive: true });
    for (const r of [setWindow(OPUS, '400000'), clearWindow(OPUS)]) {
      expect(r.code).toBe(1);
      expect(r.body['error']).toBe('windows-unreadable');
      expect(String(r.body['detail'])).toMatch(/not a regular file/);
    }
    expect(fs.statSync(winPath(ID)).isDirectory()).toBe(true);
  });

  it('a lane whose env block cannot be rendered refuses both, as set-effort does, with nothing written', () => {
    // A legacy `subagent: opus` left on disk from before the 2026-09-09
    // narrowing: `parseRegistry` still reads it, `modelEnvBlock` refuses to
    // render it. Written first, the window would change on disk and the op
    // would then answer `materialise`'s refusal; refused first, nothing moves.
    plantWindows(ID, windowsFor({ [OPUS]: 300000 }));
    const before = fs.readFileSync(winPath(ID), 'utf8');
    const reg = JSON.parse(fs.readFileSync(regPath(ID), 'utf8'));
    reg.subagent = 'opus';
    fs.writeFileSync(regPath(ID), `${JSON.stringify(reg, null, 2)}\n`);
    for (const r of [setWindow(OPUS, '400000'), clearWindow(OPUS)]) {
      expect(r.code).toBe(1);
      expect(r.body['error']).toBe('unroutable-lane');
      expect(String(r.body['detail'])).toMatch(/set-subagent <haiku\|sonnet>/);
      expect(String(r.body['detail'])).toMatch(/No window was written/);
    }
    expect(fs.readFileSync(winPath(ID), 'utf8')).toBe(before);
  });

  it('a settings.json the materialise cannot rewrite: the refusal says the window was already recorded', () => {
    fs.writeFileSync(path.join(home, LEGACY_SUFFIX, 'settings.json'), '{ this is not json');
    const r = setWindow(OPUS, '400000');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('settings-unwritable');
    expect(String(r.body['detail'])).toContain(`${winPath(ID)} itself was already updated`);
    expect(windowsFile().windows[OPUS]!['tokens']).toBe(400000);
  });

  it('an anthropic lane refuses both, as it refuses every op but show', () => {
    const anthropic = ROSTER.accounts[1]!.id;
    for (const r of [setWindow(OPUS, '400000', anthropic), clearWindow(OPUS, anthropic)]) {
      expect(r.code).toBe(1);
      expect(r.body['error']).toBe('anthropic-lane');
    }
  });

  it('a lane with no class registry refuses both, naming init', () => {
    const bare = ROSTER.accounts[3]!.id;
    for (const r of [setWindow(OPUS, '400000', bare), clearWindow(OPUS, bare)]) {
      expect(r.code).toBe(1);
      expect(r.body['error']).toBe('no-registry');
    }
  });

  it('writes the file 0600 under a permissive umask, and leaves no temp file', () => {
    const prev = process.umask(0o022);
    try {
      expect(setWindow(OPUS, '400000').code).toBe(0);
    } finally {
      process.umask(prev);
    }
    expect(fs.statSync(winPath(ID)).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(path.dirname(winPath(ID))).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  // Root ignores a directory's write bit, so this proves nothing there: a
  // visible skip, not a false red (the lane.json rename case's own reason).
  it.skipIf(typeof process.getuid === 'function' && process.getuid() === 0)(
    'a models directory it cannot write: both verbs answer windows-unwritable, and the file is unchanged', () => {
      expect(setWindow(OPUS, '400000').code).toBe(0);
      const before = fs.readFileSync(winPath(ID), 'utf8');
      const dir = path.dirname(winPath(ID));
      fs.chmodSync(dir, 0o555);
      try {
        const set = setWindow(OPUS, '350000');
        expect(set.code).toBe(1);
        expect(set.body['error']).toBe('windows-unwritable');
        expect(String(set.body['detail'])).toMatch(/could not be written/);
        // OPUS is the only entry, so clearing it is the unlink arm.
        const clear = clearWindow(OPUS);
        expect(clear.code).toBe(1);
        expect(clear.body['error']).toBe('windows-unwritable');
        expect(String(clear.body['detail'])).toMatch(/could not be removed/);
      } finally {
        fs.chmodSync(dir, 0o755);
      }
      expect(fs.readFileSync(winPath(ID), 'utf8')).toBe(before);
    });

  it('a missing --tokens or --model is a usage error at exit 2', () => {
    const r = op('set-window', '--file', rosterPath(), '--id', ID, '--model', OPUS);
    expect(r.code).toBe(2);
    expect(String(r.body['detail'])).toContain('--tokens');
    expect(op('clear-window', '--file', rosterPath(), '--id', ID).code).toBe(2);
  });
});

describe('the advance file through init, set-class, rm and advance-backfill (auto-advance spec §2.1, §2.2)', () => {
  const ID = LEGACY_EXTERNAL_ID;
  const withCodexRow = (): void => seed({ ...ROSTER, accounts: [...ROSTER.accounts, CODEX_ROW] });
  const plantSeededRegistry = (id: string): void => {
    fs.mkdirSync(path.dirname(regPath(id)), { recursive: true });
    fs.writeFileSync(regPath(id), SEEDED_REGISTRY_BYTES, { mode: 0o600 });
  };

  it("SEED_FAMILIES.codex has its one literal word, the empty class's seed this file reads off the source", () => {
    expect(seedEmptyFamily(), "deploy/models-op.mjs's SEED_FAMILIES has no `<class>: '<word>',` line for its empty class")
      .not.toBeNull();
  });

  it("init codex writes the advance file: every class's family, the empty class's seed included, 0600", () => {
    withCodexRow();
    const prev = process.umask(0o022);
    try {
      const r = opAt('init', '--file', rosterPath(), '--id', CODEX_ROW.id, '--probe', 'codex');
      expect(r.code, r.stdout + r.stderr).toBe(0);
    } finally {
      process.umask(prev);
    }
    expect(fs.readFileSync(advPath(CODEX_ROW.id), 'utf8'))
      .toBe(serializeAdvance(backfillAdvance({ registry: SEEDED, seedFamilies: CODEX_SEEDS })));
    expect(Object.values(CODEX_SEEDS).every((f) => typeof f === 'string' && f.length > 0)).toBe(true);
    expect(fs.statSync(advPath(CODEX_ROW.id)).mode & 0o777).toBe(0o600);
  });

  it.each([
    ['openrouter', []],
    ['compatible', ['--base-url', 'https://compatible.example.invalid']],
  ] as [string, string[]][])('init %s writes no advance file', (probe, extra) => {
    const router = ROSTER.accounts[3]!.id;
    const r = op('init', '--file', rosterPath(), '--id', router, '--probe', probe, ...extra);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(fs.existsSync(advPath(router))).toBe(false);
  });

  it('init codex over an advance file an earlier registry left keeps its holds and history, clears pending and previous, re-seeds every family as a fresh init does, and says so (D-5966)', () => {
    withCodexRow();
    fs.mkdirSync(path.dirname(advPath(CODEX_ROW.id)), { recursive: true });
    const fresh = backfillAdvance({ registry: SEEDED, seedFamilies: CODEX_SEEDS });
    const familiesOf = (adv: Advance): Record<string, string | null> =>
      Object.fromEntries(Object.entries(adv.classes).map(([c, x]) => [c, x.family]));
    // Left by another registry: no family the new pins have (the empty class has none at all), a previous pin, a
    // hold, a history entry, and a hand intent whose `to` is the very pin init is about to write.
    const left = backfillAdvance({ registry: ADV_REGISTRY, seedFamilies: null });
    const hold = { at: NOW, by: 'hand' } as const;
    const history: HistoryEntry[] = [
      { at: NOW, how: 'advance', from: 'model-5.6-gamma', to: 'model-6.1-gamma', ok: true, canary: 'passed' },
    ];
    left.classes.opus = { ...left.classes.opus, hold, previous: { model: 'model-5.6-gamma', effort: 'max' }, history };
    left.pending = {
      how: 'hand', class: 'opus', from: 'model-5.6-gamma', to: SEEDED.classes.opus, emptied: [], at: NOW,
    };
    // CONTROL: every family the file holds differs from the one a fresh init writes.
    for (const [c, f] of Object.entries(familiesOf(left))) expect(f, c).not.toBe(familiesOf(fresh)[c]);
    plantAdvance(CODEX_ROW.id, left);
    const r = opAt('init', '--file', rosterPath(), '--id', CODEX_ROW.id, '--probe', 'codex');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body['created']).toBe(true);
    // Soft, so a mutation that keeps the old intent is seen by the false-move assertion below as well.
    const adv = advanceOf(CODEX_ROW.id);
    expect.soft(familiesOf(adv), 'every family as a fresh init writes it').toEqual(familiesOf(fresh));
    expect.soft(adv.pending, 'the old intent is cleared').toBeNull();
    expect.soft(Object.values(adv.classes).map((x) => x.previous), 'every previous cleared')
      .toEqual([null, null, null, null]);
    expect.soft([adv.classes.opus.hold, adv.classes.opus.history], 'the hold and the history kept')
      .toEqual([hold, history]);
    expect.soft(String(r.body['advanceNote']))
      .toMatch(/^the lane already had an advance file, left by an earlier class registry, and it was reused \(D-5966\)/);
    expect.soft(r.stderr).toContain(`models-op: ${String(r.body['advanceNote'])}`);
    // The next set-class records its own move and nothing else: no intent of the old registry's lands as a move.
    expect(opAt('set-class', '--file', rosterPath(), '--id', CODEX_ROW.id, '--class', 'sonnet', '--model', 'model-6.1-beta').code)
      .toBe(0);
    const after = advanceOf(CODEX_ROW.id);
    expect(after.classes.opus.history, 'no false move').toEqual(history);
    expect(after.classes.sonnet.history).toEqual([
      { at: NOW, how: 'hand', from: SEEDED.classes.sonnet, to: 'model-6.1-beta', ok: true, canary: 'not-run' },
    ]);
  });

  it('init of a probe with no seeds over an advance file an earlier registry left resets it the same way: no family, pending and previous cleared, holds and history kept (D-5966)', () => {
    const router = ROSTER.accounts[3]!.id;
    fs.mkdirSync(path.dirname(advPath(router)), { recursive: true });
    // Left by another registry: families, a previous, a hold and a history entry on one class, and a hand intent
    // to none, the pin init's unseeded registry gives every class.
    const left = backfillAdvance({ registry: ADV_REGISTRY, seedFamilies: ADV_SEEDS });
    const hold = { at: NOW, by: 'hand' } as const;
    const history: HistoryEntry[] = [
      { at: NOW, how: 'hand', from: 'model-5.6-gamma', to: 'model-6.1-gamma', ok: true, canary: 'not-run' },
    ];
    left.classes.opus = { ...left.classes.opus, hold, previous: { model: 'model-5.6-gamma', effort: 'max' }, history };
    left.pending = { how: 'hand', class: 'haiku', from: 'model-5.6-alpha', to: null, emptied: [], at: NOW };
    plantAdvance(router, left);
    const r = opAt('init', '--file', rosterPath(), '--id', router, '--probe', 'compatible',
      '--base-url', 'https://compatible.example.invalid');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body['created']).toBe(true);
    // Soft, so a mutation that skips the reset is seen by the false-move assertion below as well.
    const adv = advanceOf(router);
    expect.soft(Object.values(adv.classes).map((x) => x.family), 'no family: the probe has no seeds')
      .toEqual([null, null, null, null]);
    expect.soft(adv.pending, 'the old intent is cleared').toBeNull();
    expect.soft(Object.values(adv.classes).map((x) => x.previous), 'every previous cleared')
      .toEqual([null, null, null, null]);
    expect.soft(String(r.body['advanceNote']))
      .toMatch(/^the lane already had an advance file, left by an earlier class registry, and it was reused \(D-5966\)/);
    // The next set-class records its own move and nothing else, and the hold and history are still there.
    const set = opAt('set-class', '--file', rosterPath(), '--id', router, '--class', 'sonnet', '--model', 'model-6.1-beta');
    expect(set.code, set.stdout + set.stderr).toBe(0);
    const after = advanceOf(router);
    expect(after.classes.haiku.history, 'no false move').toEqual([]);
    expect([after.classes.opus.hold, after.classes.opus.history], 'the hold and the history kept').toEqual([hold, history]);
    expect(after.classes.sonnet.history).toEqual([
      { at: NOW, how: 'hand', from: null, to: 'model-6.1-beta', ok: true, canary: 'not-run' },
    ]);
  });

  it.each([
    ['a FIFO, which it cannot read', 'advance-file-unreadable', /could not be read: .*not a regular file/],
    ['[], which is not an advance file', 'advance-file-invalid', /^an advance file must be a JSON object/],
  ] as [string, string, RegExp][])('init codex over an advance file an earlier registry left that is %s creates the registry, answers one object, leaves that file as it is, and says so (D-5966)', (shape, word, reason) => {
    withCodexRow();
    const adv = advPath(CODEX_ROW.id);
    fs.mkdirSync(path.dirname(adv), { recursive: true });
    if (word === 'advance-file-unreadable') expect(spawnSync('mkfifo', [adv]).status, `mkfifo ${adv}`).toBe(0);
    else plantAdvance(CODEX_ROW.id, '[]');
    // Bounded, and the one-object contract asserted before the body is read: an op that crashed after its registry
    // write prints nothing, and one that opened the FIFO would block.
    const run = spawnSync(process.execPath, [OP, 'init', '--file', rosterPath(), '--id', CODEX_ROW.id, '--probe', 'codex'],
      { env: { ...process.env, HOME: home, CCRC_MODELS_NOW: NOW }, encoding: 'utf8', timeout: 10_000 });
    expect(run.signal, `init over ${shape} did not exit by itself`).toBeNull();
    expect(run.stdout.split('\n'), `stdout is not one JSON line: ${JSON.stringify(run.stdout)} ${run.stderr}`).toHaveLength(2);
    const body = JSON.parse(run.stdout.split('\n')[0]!) as Record<string, unknown>;
    expect([run.status, body['ok'], body['created']], run.stderr).toEqual([0, true, true]);
    expect(fs.readFileSync(regPath(CODEX_ROW.id), 'utf8'), 'the registry init creates').toBe(SEEDED_REGISTRY_BYTES);
    if (word === 'advance-file-unreadable') expect(fs.statSync(adv).isFIFO(), 'init replaced the FIFO').toBe(true);
    else expect(fs.readFileSync(adv, 'utf8')).toBe('[]');
    const note = String(body['advanceNote']);
    expect(note.startsWith(`${word}: `), note).toBe(true);
    expect(note.slice(word.length + 2)).toMatch(reason);
    expect(note).toContain(adv);
    expect(note).toMatch(/The class registry was created; the advance file an earlier registry left could not be used, so it was left as it is: its families are not re-seeded\./);
    expect(note).not.toContain('Nothing was');
    expect(run.stderr).toContain(`models-op: ${note}`);
  });

  it.each([
    ['with no advance file', false, /The class registry was created; the lane has no advance file yet, and the next write of one creates it from the registry\.$/],
    ['over an advance file an earlier registry left', true, /The class registry was created; the advance file an earlier registry left is as it was, its families not re-seeded\./],
  ] as [string, boolean, RegExp][])("init codex %s whose advance-file write fails answers ok, says what was and was not written, and never 'Nothing was changed'", (_why, leftover, rest) => {
    withCodexRow();
    let left = '';
    if (leftover) {
      fs.mkdirSync(path.dirname(advPath(CODEX_ROW.id)), { recursive: true });
      left = serializeAdvance(backfillAdvance({ registry: ADV_REGISTRY, seedFamilies: null }));
      plantAdvance(CODEX_ROW.id, left);
    }
    // The advance file's one write made to fail for real, in a COPY of the op (the set-class registry-write case's
    // idiom): `writeAdvance` aims `writeJsonFile` under the registry FILE, which init has just written.
    const src = fs.readFileSync(OP, 'utf8');
    const WRITE = "return writeJsonFile(advancePath(id), parsed, 'advance-unwritable');";
    expect(src.split(WRITE), 'writeAdvance has its one write').toHaveLength(2);
    const copy = path.join(home, 'models-op-advance-unwritable.mjs');
    fs.writeFileSync(copy, src.replaceAll("from '../shared/", `from '${pathToFileURL(path.join(REPO, 'shared')).href}/`)
      .replace(WRITE, "return writeJsonFile(path.join(registryPath(id), 'x'), parsed, 'advance-unwritable');"));
    const run = spawnSync(process.execPath, [copy, 'init', '--file', rosterPath(), '--id', CODEX_ROW.id, '--probe', 'codex'],
      { env: { ...process.env, HOME: home, CCRC_MODELS_NOW: NOW }, encoding: 'utf8', timeout: 10_000 });
    expect(run.stdout.split('\n'), `stdout is not one JSON line: ${JSON.stringify(run.stdout)} ${run.stderr}`).toHaveLength(2);
    const body = JSON.parse(run.stdout.split('\n')[0]!) as Record<string, unknown>;
    expect([run.status, body['ok'], body['created']], run.stderr).toEqual([0, true, true]);
    expect(fs.readFileSync(regPath(CODEX_ROW.id), 'utf8')).toBe(SEEDED_REGISTRY_BYTES);
    if (leftover) expect(fs.readFileSync(advPath(CODEX_ROW.id), 'utf8')).toBe(left);
    else expect(fs.existsSync(advPath(CODEX_ROW.id))).toBe(false);
    const note = String(body['advanceNote']);
    expect(note).toMatch(/^advance-unwritable: .*could not be written: /);
    expect(note).toMatch(rest);
    expect(note).not.toContain('Nothing was changed');
    expect(run.stderr).toContain(`models-op: ${note}`);
  });

  it('set-class records a hand entry and rewrites the family from a pin that parses', () => {
    plantAdv();
    const r = opAt('set-class', '--file', rosterPath(), '--id', ID, '--class', 'opus', '--model', 'model-6-delta');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const adv = advanceOf(ID);
    expect(adv.classes.opus.family).toBe('delta');
    expect(adv.classes.opus.history).toEqual([
      { at: NOW, how: 'hand', from: 'model-5.6-gamma', to: 'model-6-delta', ok: true, canary: 'not-run' },
    ]);
    expect(adv.classes.sonnet.history, 'a class the call did not move gets no entry').toEqual([]);
  });

  it.each([
    ['none', ['--class', 'haiku', '--model', 'none'], { haiku: { from: 'model-5.6-alpha', to: null } }],
    ['a pin that breaks the id grammar', ['--class', 'opus', '--model', 'vendor-6-alpha-mini'],
      { opus: { from: 'model-5.6-gamma', to: 'vendor-6-alpha-mini' } }],
    ['a class one-model-one-class empties', ['--class', 'fable', '--model', 'model-5.6-alpha'],
      { haiku: { from: 'model-5.6-alpha', to: null }, fable: { from: null, to: 'model-5.6-alpha' } }],
  ] as [string, string[], Record<string, { from: string | null; to: string | null }>][])(
    'set-class with %s records every class it changed, and clears the family of each one it emptied or pinned off-grammar (D-5195)',
    (_why, args, moves) => {
      plantAdv();
      const r = opAt('set-class', '--file', rosterPath(), '--id', ID, ...args);
      expect(r.code, r.stdout + r.stderr).toBe(0);
      const adv = advanceOf(ID);
      for (const [c, m] of Object.entries(moves)) {
        expect(adv.classes[c as ModelClass].history, c).toEqual([{ at: NOW, how: 'hand', ...m, ok: true, canary: 'not-run' }]);
        expect(adv.classes[c as ModelClass].family, c).toBe(familyOf(m.to));
      }
    });

  it('set-class <class> none on a class that is already empty clears the family it was seeded with, and records no move (D-5195; Review Focus: a class emptied by hand)', () => {
    plantAdv();   // ADV_REGISTRY: the fourth class empty
    plantAdvance(ID, backfillAdvance({ registry: ADV_REGISTRY, seedFamilies: ADV_SEEDS }));   // …and seeded 'delta'
    const before = registryOf(ID) as unknown as Registry;
    // CONTROL: seeded, the empty class would be filled from its family's newest eligible model.
    expect(chooseCandidate({ registry: before, catalogue: ADV_CATALOGUE, cls: 'fable', family: 'delta' }).candidate)
      .toBe('model-6-delta');
    const r = opAt('set-class', '--file', rosterPath(), '--id', ID, '--class', 'fable', '--model', 'none');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const fable = advanceOf(ID).classes.fable;
    expect(fable.family).toBeNull();
    expect(fable.history, 'an unchanged pin is no move: no history entry').toEqual([]);
    expect(chooseCandidate({ registry: registryOf(ID) as unknown as Registry, catalogue: ADV_CATALOGUE, cls: 'fable',
      family: fable.family })).toEqual({ candidate: null, reason: null, blocked: null });
  });

  it('set-class leaves previous alone, so Revert still undoes the last automatic advance', () => {
    plantAdv();
    const adv = backfillAdvance({ registry: ADV_REGISTRY, seedFamilies: CODEX_SEEDS });
    adv.classes.opus.previous = { model: 'model-5.6-gamma', effort: 'max' };
    plantAdvance(ID, adv);
    expect(opAt('set-class', '--file', rosterPath(), '--id', ID, '--class', 'opus', '--model', 'model-6-delta').code).toBe(0);
    expect(advanceOf(ID).classes.opus.previous).toEqual({ model: 'model-5.6-gamma', effort: 'max' });
  });

  it('set-class over an advance file it cannot read still writes the registry, leaves that file byte for byte, and says so', () => {
    plantAdv();
    plantAdvance(ID, '{ this is not json');
    const r = opAt('set-class', '--file', rosterPath(), '--id', ID, '--class', 'opus', '--model', 'model-6-delta');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(classesOf(ID)['opus']).toBe('model-6-delta');
    expect(fs.readFileSync(advPath(ID), 'utf8')).toBe('{ this is not json');
    expect(String(r.body['advanceNote'])).toMatch(/^advance-file-invalid: .*is not valid JSON/);
    expect(r.stderr).toContain('models-op: advance-file-invalid: ');
  });

  it("set-class with no advance file creates one: each pin's own family, init's seed for the empty class, and the move's hand entry", () => {
    plantAdv();
    expect(opAt('set-class', '--file', rosterPath(), '--id', ID, '--class', 'sonnet', '--model', 'model-6.1-beta').code).toBe(0);
    const want = recordMove(backfillAdvance({ registry: ADV_REGISTRY, seedFamilies: CODEX_SEEDS }), 'sonnet',
      { at: NOW, how: 'hand', from: 'model-6-beta', to: 'model-6.1-beta', ok: true, canary: 'not-run' });
    expect(fs.readFileSync(advPath(ID), 'utf8')).toBe(serializeAdvance(want));
  });

  it('set-class writes its hand intent before the registry is renamed, and records the move from it only after materialise (D-5188)', () => {
    // The order is the guard and a source scan its only red: a SIGTERM cannot be aimed between two lines. The scan
    // reads `main`'s mutation tail alone, because `revertOp` (Task 6) spells the same materialise line.
    const whole = fs.readFileSync(OP, 'utf8');
    const src = whole.slice(whole.indexOf('// Every remaining op needs an existing registry.'),
      whole.indexOf('process.exit(main(process.argv));'));
    const at = (text: string): number => {
      const i = src.indexOf(text);
      expect(i, `main's mutation tail lacks: ${text}`).toBeGreaterThan(0);
      return i;
    };
    const begin = at("const hand = opName === 'set-class' ? beginHandMove(a.id, registry, validated, a.class) : null;");
    const rename = at('const w = writeRegistry(a.id, validated);');
    const mat = at('const mat = materialise(account, validated, catalogue, windowsOf(win));');
    const settle = at('settleHandMove(a.id, validated)');
    expect(begin).toBeLessThan(rename);
    expect(mat).toBeLessThan(settle);
  });

  it('a set-class cut short after the registry rename leaves its hand intent, and the next locked writer records the move: the class stays empty (Review Focus: the crash gap, a hand set-class cut short)', () => {
    plantAdv();
    // A directory where the TSV goes: materialise fails AFTER the rename, where a SIGTERM would cut a set-class short.
    const tsv = path.join(home, '.ccrc', 'models', `${ID}.classes.tsv`);
    fs.rmSync(tsv);
    fs.mkdirSync(tsv);
    const r = opAt('set-class', '--file', rosterPath(), '--id', ID, '--class', 'opus', '--model', 'none');
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(r.body['error']).toBe('materialise-failed');
    expect(classesOf(ID)['opus'], 'the registry moved').toBeNull();
    const cut = advanceOf(ID);
    expect(cut.pending).toEqual({ how: 'hand', class: 'opus', from: 'model-5.6-gamma', to: null, emptied: [], at: NOW });
    expect([cut.classes.opus.family, cut.classes.opus.history]).toEqual(['gamma', []]);
    // The next locked writer, a set-class of another class once the TSV path is fixed, settles it first.
    fs.rmdirSync(tsv);
    expect(opAt('set-class', '--file', rosterPath(), '--id', ID, '--class', 'sonnet', '--model', 'model-6.1-beta').code).toBe(0);
    const after = advanceOf(ID);
    expect(after.pending).toBeNull();
    expect(after.classes.opus.history).toEqual([
      { at: NOW, how: 'hand', from: 'model-5.6-gamma', to: null, ok: true, canary: 'not-run' },
    ]);
    expect([after.classes.opus.family, after.classes.opus.previous]).toEqual([null, null]);
    expect(after.classes.sonnet.history).toEqual([
      { at: NOW, how: 'hand', from: 'model-6-beta', to: 'model-6.1-beta', ok: true, canary: 'not-run' },
    ]);
    expect(chooseCandidate({ registry: registryOf(ID) as unknown as Registry, catalogue: ADV_CATALOGUE, cls: 'opus',
      family: after.classes.opus.family })).toEqual({ candidate: null, reason: null, blocked: null });
  });

  it("a set-class whose registry write fails after its intent is written says what changed, never 'Nothing was changed', and the next writer records no move (D-5188)", () => {
    plantAdv();
    // The registry write is made to fail for real, in a COPY of the op (the probe idiom of the readAdvance and
    // writeAdvance describe below): `writeRegistry` aims `writeJsonFile` under the registry FILE, so its mkdir fails
    // after `beginHandMove` has written the intent. Every other byte of the copy is the op as it is.
    const src = fs.readFileSync(OP, 'utf8');
    const WRITE = "return writeJsonFile(registryPath(id), registry, 'registry-unwritable');";
    expect(src.split(WRITE), 'writeRegistry has its one line').toHaveLength(2);
    const copy = path.join(home, 'models-op-unwritable.mjs');
    fs.writeFileSync(copy, src.replaceAll("from '../shared/", `from '${pathToFileURL(path.join(REPO, 'shared')).href}/`)
      .replace(WRITE, "return writeJsonFile(path.join(registryPath(id), 'x'), registry, 'registry-unwritable');"));
    const run = spawnSync(process.execPath,
      [copy, 'set-class', '--file', rosterPath(), '--id', ID, '--class', 'opus', '--model', 'model-6-delta'],
      { env: { ...process.env, HOME: home, CCRC_MODELS_NOW: NOW }, encoding: 'utf8' });
    expect(run.status, run.stdout + run.stderr).toBe(1);
    const body = JSON.parse(run.stdout.split('\n')[0]!) as Record<string, unknown>;
    expect(body['error']).toBe('registry-unwritable');
    expect(String(body['detail']))
      .toMatch(/could not be written: .*\. The registry was not changed\. The hand intent this set-class wrote/);
    expect(String(body['detail'])).not.toContain('Nothing was changed');
    expect(classesOf(ID)['opus'], 'the registry did not move').toBe('model-5.6-gamma');
    expect(advanceOf(ID).pending).toEqual(
      { how: 'hand', class: 'opus', from: 'model-5.6-gamma', to: 'model-6-delta', emptied: [], at: NOW });
    // The real op, next: it finds the pin unchanged and records no move from that intent.
    expect(opAt('set-class', '--file', rosterPath(), '--id', ID, '--class', 'sonnet', '--model', 'model-6.1-beta').code).toBe(0);
    const after = advanceOf(ID);
    expect([after.pending, after.classes.opus.family, after.classes.opus.history]).toEqual([null, 'gamma', []]);
  });

  it('a hand intent whose rename never happened is dropped by the next locked writer: no entry, and the family as it was', () => {
    plantAdv();   // the registry still pins model-5.6-gamma: the set-class died before its rename
    const adv = backfillAdvance({ registry: ADV_REGISTRY, seedFamilies: CODEX_SEEDS });
    adv.pending = { how: 'hand', class: 'opus', from: 'model-5.6-gamma', to: null, emptied: [], at: NOW };
    plantAdvance(ID, adv);
    expect(opAt('set-class', '--file', rosterPath(), '--id', ID, '--class', 'sonnet', '--model', 'model-6.1-beta').code).toBe(0);
    const after = advanceOf(ID);
    expect(after.pending).toBeNull();
    expect([after.classes.opus.family, after.classes.opus.history]).toEqual(['gamma', []]);
  });

  it("rm reaps the advance file with the lane's other model files, last", () => {
    plantAdv();
    plantWindows(ID, windowsFor({ 'model-5.6-gamma': 400000 }));
    expect(opAt('set-class', '--file', rosterPath(), '--id', ID, '--class', 'sonnet', '--model', 'model-6.1-beta').code).toBe(0);
    const r = op('rm', '--file', rosterPath(), '--id', ID);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const dir = path.join(home, '.ccrc', 'models');
    expect(r.body['removed']).toEqual([regPath(ID), path.join(dir, `${ID}.json`), path.join(dir, `${ID}.classes.tsv`),
      path.join(dir, `${ID}.effort.json`), winPath(ID), advPath(ID)]);
    expect(fs.existsSync(advPath(ID))).toBe(false);
  });

  it('advance-backfill creates the file once, from the registry, and never rewrites it', () => {
    withCodexRow();
    plantSeededRegistry(CODEX_ROW.id);
    const first = op('advance-backfill', '--file', rosterPath(), '--id', CODEX_ROW.id);
    expect(first.body).toEqual({ ok: true, op: 'advance-backfill', id: CODEX_ROW.id, created: true });
    const bytes = fs.readFileSync(advPath(CODEX_ROW.id), 'utf8');
    expect(bytes).toBe(serializeAdvance(backfillAdvance({ registry: SEEDED, seedFamilies: CODEX_SEEDS })));
    const mtime = fs.statSync(advPath(CODEX_ROW.id)).mtimeMs;
    const again = op('advance-backfill', '--file', rosterPath(), '--id', CODEX_ROW.id);
    expect(again.body).toEqual({ ok: true, op: 'advance-backfill', id: CODEX_ROW.id, created: false, why: 'present' });
    expect(fs.readFileSync(advPath(CODEX_ROW.id), 'utf8')).toBe(bytes);
    expect(fs.statSync(advPath(CODEX_ROW.id)).mtimeMs).toBe(mtime);
  });

  it('advance-backfill answers why and writes nothing on a lane that is not codex-kind, or whose probe is not codex (D-5198)', () => {
    plantCodex(ID);
    expect(op('advance-backfill', '--file', rosterPath(), '--id', ID).body)
      .toEqual({ ok: true, op: 'advance-backfill', id: ID, created: false, why: 'lane-not-codex-kind' });
    expect(fs.existsSync(advPath(ID))).toBe(false);
    withCodexRow();
    expect(op('init', '--file', rosterPath(), '--id', CODEX_ROW.id, '--probe', 'compatible',
      '--base-url', 'https://compatible.example.invalid').code).toBe(0);
    expect(op('advance-backfill', '--file', rosterPath(), '--id', CODEX_ROW.id).body)
      .toEqual({ ok: true, op: 'advance-backfill', id: CODEX_ROW.id, created: false, why: 'probe-not-codex' });
    expect(fs.existsSync(advPath(CODEX_ROW.id))).toBe(false);
  });

  it('advance-backfill leaves an advance file it cannot read as it is, and says which', () => {
    withCodexRow();
    plantSeededRegistry(CODEX_ROW.id);
    plantAdvance(CODEX_ROW.id, '[]');
    expect(op('advance-backfill', '--file', rosterPath(), '--id', CODEX_ROW.id).body)
      .toEqual({ ok: true, op: 'advance-backfill', id: CODEX_ROW.id, created: false, why: 'advance-file-invalid' });
    expect(fs.readFileSync(advPath(CODEX_ROW.id), 'utf8')).toBe('[]');
  });

  it('advance-backfill refuses an Anthropic lane, and a lane with no registry', () => {
    expect(op('advance-backfill', '--file', rosterPath(), '--id', ROSTER.accounts[1]!.id).body['error']).toBe('anthropic-lane');
    expect(op('advance-backfill', '--file', rosterPath(), '--id', ROSTER.accounts[3]!.id).body['error']).toBe('no-registry');
  });

  it('a class emptied by hand stays empty: no later backfill, re-materialise, init or other set-class gives it a family back (Review Focus: a class emptied by hand)', () => {
    withCodexRow();
    plantAdv(CODEX_ROW.id);
    expect(opAt('set-class', '--file', rosterPath(), '--id', CODEX_ROW.id, '--class', 'opus', '--model', 'none').code).toBe(0);
    const emptied = fs.readFileSync(advPath(CODEX_ROW.id), 'utf8');
    expect(advanceOf(CODEX_ROW.id).classes.opus.family).toBeNull();
    // Every hour's first step (W2 runs advance-backfill, then the refresh's re-materialise), and init again:
    expect(op('advance-backfill', '--file', rosterPath(), '--id', CODEX_ROW.id).body)
      .toMatchObject({ created: false, why: 'present' });
    expect(op('materialise', '--file', rosterPath(), '--id', CODEX_ROW.id).code).toBe(0);
    expect(op('init', '--file', rosterPath(), '--id', CODEX_ROW.id, '--probe', 'codex').body['created']).toBe(false);
    expect(fs.readFileSync(advPath(CODEX_ROW.id), 'utf8')).toBe(emptied);
    // …and a hand change to another class leaves it emptied.
    expect(opAt('set-class', '--file', rosterPath(), '--id', CODEX_ROW.id, '--class', 'haiku', '--model', 'model-6.1-alpha').code).toBe(0);
    const after = advanceOf(CODEX_ROW.id);
    expect(after.classes.opus.family).toBeNull();
    const registry = registryOf(CODEX_ROW.id) as unknown as Registry;
    expect(chooseCandidate({ registry, catalogue: ADV_CATALOGUE, cls: 'opus', family: after.classes.opus.family }))
      .toEqual({ candidate: null, reason: null, blocked: null });
    // CONTROL: the family it lost would have filled it from that family's newest eligible model.
    expect(chooseCandidate({ registry, catalogue: ADV_CATALOGUE, cls: 'opus', family: 'gamma' }).candidate).toBe('model-6.1-gamma');
  });
});

describe('hold, release and revert (auto-advance spec §2.7, D12)', () => {
  const ID = LEGACY_EXTERNAL_ID;
  /** A lane as an automatic advance leaves it: opus moved from model-5.6-gamma to model-6.1-gamma, its effort
   *  resolved from max down to xhigh (the newer row offers four levels). */
  const ADVANCED: Registry = {
    ...ADV_REGISTRY, classes: { ...ADV_REGISTRY.classes, opus: 'model-6.1-gamma' },
    effort: { ...ADV_REGISTRY.effort, opus: 'xhigh' },
  };
  const advanced = (previous: { model: string | null; effort: string | null } = { model: 'model-5.6-gamma', effort: 'max' },
    registry: Registry = ADVANCED, cls: ModelClass = 'opus'): void => {
    plantAdv(ID, registry);
    const adv = backfillAdvance({ registry, seedFamilies: CODEX_SEEDS });
    adv.classes[cls].previous = previous;
    adv.classes[cls].history = [{ at: '2026-10-14T10:00:00Z', how: 'advance', from: previous.model,
      to: registry.classes[cls], ok: true, canary: 'passed' }];
    plantAdvance(ID, adv);
  };
  const verb = (v: string, cls = 'opus', extra: NodeJS.ProcessEnv = {}): Result =>
    opEnv({ CCRC_MODELS_NOW: NOW, ...extra }, v, '--file', rosterPath(), '--id', ID, '--class', cls);
  /** Every file under ~/.ccrc/models, name → bytes: what "writes nothing" is measured against. */
  const modelFiles = (): Record<string, string> => {
    const d = path.join(home, '.ccrc', 'models');
    return Object.fromEntries(fs.readdirSync(d).sort().map((n) => [n, fs.readFileSync(path.join(d, n), 'utf8')]));
  };

  it('hold records when and by what act; a second hold changes nothing; release clears it; a second release changes nothing', () => {
    plantAdv();
    const h1 = verb('hold');
    expect(h1.code, h1.stdout + h1.stderr).toBe(0);
    expect(h1.body).toMatchObject({ ok: true, op: 'hold', class: 'opus', changed: true });
    expect(advanceOf(ID).classes.opus.hold).toEqual({ at: NOW, by: 'hand' });
    const held = fs.readFileSync(advPath(ID), 'utf8');
    expect(verb('hold', 'opus', { CCRC_MODELS_NOW: '2026-10-16T00:00:00Z' }).body).toMatchObject({ changed: false });
    expect(fs.readFileSync(advPath(ID), 'utf8')).toBe(held);
    expect(verb('release').body).toMatchObject({ ok: true, op: 'release', class: 'opus', changed: true });
    expect(advanceOf(ID).classes.opus.hold).toBeNull();
    expect(verb('release').body).toMatchObject({ changed: false });
    expect(fs.readFileSync(regPath(ID), 'utf8'), 'a hold never touches the registry')
      .toBe(`${JSON.stringify(ADV_REGISTRY, null, 2)}\n`);
  });

  it("revert puts previous back — the pin, its effort and the lane's env — turns the hold on, clears previous and records the move", () => {
    advanced();
    const r = verb('revert');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toMatchObject({ ok: true, op: 'revert', class: 'opus', from: 'model-6.1-gamma', to: 'model-5.6-gamma' });
    const reg = registryOf(ID) as unknown as Registry;
    expect([reg.classes.opus, reg.effort?.opus]).toEqual(['model-5.6-gamma', 'max']);
    expect(settingsOf(LEGACY_SUFFIX).env['ANTHROPIC_DEFAULT_OPUS_MODEL']).toBe('model-5.6-gamma');
    const opus = advanceOf(ID).classes.opus;
    expect(opus.hold).toEqual({ at: NOW, by: 'revert' });
    expect(opus.previous).toBeNull();
    expect(opus.history[opus.history.length - 1]).toEqual({ at: NOW, how: 'revert', from: 'model-6.1-gamma',
      to: 'model-5.6-gamma', ok: true, canary: 'not-run', effort: { from: 'xhigh', to: 'max' } });
  });

  it("revert writes the restored pin's family, so the advance file stays true for every reader (D-5992)", () => {
    // opus on model-6.1-gamma, family gamma, with a previous pin of another family: the stored family would be stale
    // the moment the pin moved back, and W2 would read it.
    advanced({ model: 'model-6-delta', effort: 'max' });
    expect(advanceOf(ID).classes.opus.family, 'CONTROL: the family before the revert').toBe('gamma');
    const r = verb('revert');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(classesOf(ID)['opus']).toBe('model-6-delta');
    expect(advanceOf(ID).classes.opus.family).toBe(familyOf('model-6-delta'));
  });

  it('a revert to a previous with no effort level removes the class\'s level and keeps the others, and records the pair (D-5189)', () => {
    advanced({ model: 'model-5.6-gamma', effort: null });
    const r = verb('revert');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const reg = registryOf(ID) as unknown as Registry;
    expect(reg.classes.opus).toBe('model-5.6-gamma');
    expect(reg.effort, 'opus has no level now; the other classes keep theirs')
      .toEqual({ haiku: 'high', sonnet: 'high', fable: 'max' });
    const opus = advanceOf(ID).classes.opus;
    expect(opus.history[opus.history.length - 1]).toEqual({ at: NOW, how: 'revert', from: 'model-6.1-gamma',
      to: 'model-5.6-gamma', ok: true, canary: 'not-run', effort: { from: 'xhigh', to: null } });
  });

  it('a revert to a previous with no effort level drops the effort map when that level was its only entry (D-5189)', () => {
    advanced({ model: 'model-5.6-gamma', effort: null }, { ...ADVANCED, effort: { opus: 'xhigh' } });
    const r = verb('revert');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const reg = registryOf(ID);
    expect(reg['classes']).toMatchObject({ opus: 'model-5.6-gamma' });
    expect(Object.keys(reg), 'no empty effort map is left behind').not.toContain('effort');
  });

  it('a revert to none keeps the stored family: an empty class is filled from it, and a held one is reported behind it (D-5992)', () => {
    // fable filled from empty by an advance, then reverted to empty: the plan's example file's fable.
    advanced({ model: null, effort: null }, { ...ADV_REGISTRY, classes: { ...ADV_REGISTRY.classes, fable: 'model-6-delta' } },
      'fable');
    const r = verb('revert', 'fable');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(classesOf(ID)['fable']).toBeNull();
    expect(advanceOf(ID).classes.fable.family).toBe('delta');
  });

  it('a revert whose materialise fails puts the registry back and leaves the class held, previous and history as they were (D-5206)', () => {
    advanced();
    const reg0 = fs.readFileSync(regPath(ID), 'utf8');
    const opus0 = advanceOf(ID).classes.opus;
    fs.writeFileSync(path.join(home, LEGACY_SUFFIX, 'settings.json'), '{ this is not json');
    const r = verb('revert');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('settings-unwritable');
    expect(String(r.body['detail'])).toMatch(/opus is held, on model-6\.1-gamma/);
    expect(fs.readFileSync(regPath(ID), 'utf8')).toBe(reg0);
    const opus = advanceOf(ID).classes.opus;
    expect(opus.hold).toEqual({ at: NOW, by: 'revert' });
    expect([opus.previous, opus.history]).toEqual([opus0.previous, opus0.history]);
  });

  it('revert sets its own hold over a hand hold already standing: the hold records the act that set it last (D-5190)', () => {
    advanced();
    expect(verb('hold').code).toBe(0);   // { at: NOW, by: 'hand' }
    const later = '2026-10-16T00:00:00Z';
    const r = verb('revert', 'opus', { CCRC_MODELS_NOW: later });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(advanceOf(ID).classes.opus.hold).toEqual({ at: later, by: 'revert' });
  });

  it.each([
    ['no-previous: no automatic advance on record', (): void => { plantAdv(); }, 'opus', 'no-previous'],
    ['previous-not-in-catalogue', (): void => { advanced({ model: 'model-9-omega', effort: 'max' }); }, 'opus',
      'previous-not-in-catalogue'],
    ['previous-taken: another class pins it now', (): void => { advanced({ model: 'model-6-beta', effort: 'high' }); },
      'opus', 'previous-taken'],
    ['registry-invalid: the class subagents run as would be emptied', (): void => {
      advanced({ model: null, effort: null },
        { ...ADV_REGISTRY, classes: { ...ADV_REGISTRY.classes, sonnet: 'model-6.1-beta' } }, 'sonnet');
    }, 'sonnet', 'registry-invalid'],
    ['unroutable-lane: nothing left for an unqualified request', (): void => {
      advanced({ model: null, effort: null }, { probe: 'codex', classes: { haiku: 'model-6.1-alpha', sonnet: null,
        opus: null, fable: null }, subagent: 'haiku', discovery: 'catalogue' }, 'haiku');
    }, 'haiku', 'unroutable-lane'],
  ] as [string, () => void, string, string][])('revert refuses %s, and writes nothing', (_why, plant, cls, error) => {
    plant();
    const before = modelFiles();
    const r = verb('revert', cls);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(r.body['error']).toBe(error);
    expect(modelFiles()).toEqual(before);
  });

  it('revert puts back an effort level its model no longer offers through resolveEffort (D-5189)', () => {
    advanced({ model: 'model-5.6-gamma', effort: 'ultra' });
    const r = verb('revert');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((registryOf(ID) as unknown as Registry).effort?.opus).toBe('low');
  });

  it('hold settles a pending intent first: the next locked writer records the move that landed (Review Focus: the crash gap)', () => {
    // A writer killed between the registry rename and its commit leaves this: the pin already on `to`, the intent
    // still in the advance file.
    plantAdv(ID, ADVANCED);
    const adv = backfillAdvance({ registry: ADV_REGISTRY, seedFamilies: CODEX_SEEDS });
    adv.pending = { class: 'opus', from: 'model-5.6-gamma', to: 'model-6.1-gamma', effortFrom: 'max', effortTo: 'xhigh',
      at: '2026-10-14T10:00:00Z' };
    plantAdvance(ID, adv);
    expect(verb('hold', 'sonnet').code).toBe(0);
    const after = advanceOf(ID);
    expect(after.pending).toBeNull();
    expect(after.classes.opus.previous).toEqual({ model: 'model-5.6-gamma', effort: 'max' });
    expect(after.classes.opus.history).toEqual([{ at: '2026-10-14T10:00:00Z', how: 'advance', from: 'model-5.6-gamma',
      to: 'model-6.1-gamma', ok: true, canary: 'passed', effort: { from: 'max', to: 'xhigh' }, recovered: true }]);
    expect(after.classes.sonnet.hold).toEqual({ at: NOW, by: 'hand' });
  });

  it('an intent that never landed is dropped by the next locked writer, even one whose own change is nothing', () => {
    plantAdv();   // the pin is still model-5.6-gamma: the rename never happened
    const adv = backfillAdvance({ registry: ADV_REGISTRY, seedFamilies: CODEX_SEEDS });
    adv.classes.sonnet.hold = { at: NOW, by: 'hand' };
    adv.pending = { class: 'opus', from: 'model-5.6-gamma', to: 'model-6.1-gamma', effortFrom: 'max', effortTo: 'xhigh',
      at: '2026-10-14T10:00:00Z' };
    plantAdvance(ID, adv);
    expect(verb('hold', 'sonnet').body).toMatchObject({ changed: false });
    const after = advanceOf(ID);
    expect(after.pending).toBeNull();
    expect(after.classes.opus.history).toEqual([]);
  });

  it("hold settles a hand intent a set-class left between its rename and its record: the move recorded as hand, the emptied class's family cleared, previous untouched (Review Focus: the crash gap, a hand set-class cut short)", () => {
    // `set-class opus none` killed after its registry rename: the pin already none, the hand intent still on disk.
    plantAdv(ID, { ...ADV_REGISTRY, classes: { ...ADV_REGISTRY.classes, opus: null } });
    const adv = backfillAdvance({ registry: ADV_REGISTRY, seedFamilies: CODEX_SEEDS });
    adv.classes.opus.previous = { model: 'model-5-gamma', effort: 'max' };
    adv.pending = { how: 'hand', class: 'opus', from: 'model-5.6-gamma', to: null, emptied: [], at: '2026-10-14T10:00:00Z' };
    plantAdvance(ID, adv);
    expect(verb('hold', 'sonnet').code).toBe(0);
    const opus = advanceOf(ID).classes.opus;
    expect(advanceOf(ID).pending).toBeNull();
    expect(opus.history).toEqual([{ at: '2026-10-14T10:00:00Z', how: 'hand', from: 'model-5.6-gamma', to: null, ok: true,
      canary: 'not-run' }]);
    expect(opus.family).toBeNull();
    expect(opus.previous).toEqual({ model: 'model-5-gamma', effort: 'max' });
  });

  it.each([['hold'], ['release'], ['revert']])('%s refuses an advance file it cannot read, and leaves it as it is', (v) => {
    plantAdv();
    plantAdvance(ID, '{"v": 2}');
    const r = verb(v);
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('advance-file-invalid');
    expect(String(r.body['detail'])).toMatch(/will not overwrite one it cannot read/);
    expect(fs.readFileSync(advPath(ID), 'utf8')).toBe('{"v": 2}');
  });

  it.each([['hold'], ['release'], ['revert']])('%s is refused on an Anthropic lane, as every op but show is', (v) => {
    const r = opEnv({ CCRC_MODELS_NOW: NOW }, v, '--file', rosterPath(), '--id', ROSTER.accounts[1]!.id, '--class', 'opus');
    expect([r.code, r.body['error']]).toEqual([1, 'anthropic-lane']);
  });

  it('an unknown class is refused by name, writing nothing', () => {
    plantAdv();
    const r = verb('hold', 'subagent');
    expect([r.code, r.body['error']]).toEqual([1, 'unknown-class']);
    expect(fs.existsSync(advPath(ID))).toBe(false);
  });

  it('hold on a lane whose probe is not codex writes its advance file too, with no family seeded: a hand act is recorded on any lane, and only the codex arm advances one (D-5198)', () => {
    const router = ROSTER.accounts[3]!.id;
    expect(op('init', '--file', rosterPath(), '--id', router, '--probe', 'compatible',
      '--base-url', 'https://compatible.example.invalid').code).toBe(0);
    expect(fs.existsSync(advPath(router)), 'init compatible wrote an advance file').toBe(false);
    const r = opEnv({ CCRC_MODELS_NOW: NOW }, 'hold', '--file', rosterPath(), '--id', router, '--class', 'opus');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const adv = advanceOf(router);
    expect(adv.classes.opus.hold).toEqual({ at: NOW, by: 'hand' });
    expect(Object.values(adv.classes).map((c) => c.family)).toEqual([null, null, null, null]);
    // The hourly step still writes nothing there, and says why.
    expect(op('advance-backfill', '--file', rosterPath(), '--id', router).body).toMatchObject({ created: false });
  });

  it("a clock that is not of the advance file's form is refused by writeAdvance's read-back, and nothing is written", () => {
    plantAdv();
    const r = verb('hold', 'opus', { CCRC_MODELS_NOW: 'yesterday' });
    expect([r.code, r.body['error']]).toEqual([1, 'advance-invalid']);
    expect(fs.existsSync(advPath(ID))).toBe(false);
  });

  // `want` is a thunk: CODEX_SEEDS reads the seed literal when a case runs, never while vitest collects the table.
  it.each([
    ['absent', (): void => {}, () => ({ state: 'absent' })],
    ['ok', (): void => { plantAdvance(ID, backfillAdvance({ registry: ADV_REGISTRY, seedFamilies: CODEX_SEEDS })); },
      () => ({ state: 'ok', classes: backfillAdvance({ registry: ADV_REGISTRY, seedFamilies: CODEX_SEEDS }).classes })],
    ['invalid', (): void => { plantAdvance(ID, '{ this is not json'); }, () => ({ state: 'invalid' })],
    ['unreadable', (): void => { fs.mkdirSync(advPath(ID)); }, () => ({ state: 'unreadable' })],
  ] as [string, () => void, () => Record<string, unknown>][])('show carries the advance state: %s', (_why, plant, wantOf) => {
    const want = wantOf();
    plantAdv();
    plant();
    const r = op('show', '--file', rosterPath(), '--id', ID);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body['advance']).toMatchObject(want);
    if (want['state'] === 'invalid' || want['state'] === 'unreadable') {
      expect(String((r.body['advance'] as { detail: string }).detail)).toContain(advPath(ID));
    }
  });

  it('the class registry stays what an older parser reads, with an advance file beside it (D13)', () => {
    const KEYS = ['probe', 'classes', 'subagent', 'discovery', 'effort', 'baseUrl'];
    expect(fs.readFileSync(path.join(REPO, 'shared', 'models.mjs'), 'utf8'))
      .toContain(`const REGISTRY_KEYS = [${KEYS.map((k) => `'${k}'`).join(', ')}];`);
    const id = CODEX_ROW.id;
    const compatible = (step: string): void => {
      const text = fs.readFileSync(regPath(id), 'utf8');
      const json = JSON.parse(text) as Record<string, unknown>;
      expect(Object.keys(json).filter((k) => !KEYS.includes(k)), step).toEqual([]);
      expect(text, step).toBe(`${JSON.stringify(parseRegistry(json), null, 2)}\n`);
      expect(fs.existsSync(advPath(id)), step).toBe(true);
    };
    seed({ ...ROSTER, accounts: [...ROSTER.accounts, CODEX_ROW] });
    writeCatalogue(id, ADV_CATALOGUE);
    expect(opAt('init', '--file', rosterPath(), '--id', id, '--probe', 'codex').code).toBe(0);
    compatible('init');
    expect(opAt('set-class', '--file', rosterPath(), '--id', id, '--class', 'opus', '--model', 'model-5.6-gamma').code).toBe(0);
    compatible('set-class');
    expect(opAt('hold', '--file', rosterPath(), '--id', id, '--class', 'sonnet').code).toBe(0);
    compatible('hold');
    const adv = advanceOf(id);
    adv.classes.opus.previous = { model: 'model-6-delta', effort: 'max' };
    plantAdvance(id, adv);
    expect(opAt('revert', '--file', rosterPath(), '--id', id, '--class', 'opus').code).toBe(0);
    compatible('revert');
  });

  // ── Fix round 1: revert's write-failure guards, D-5991, and the rest of its arms ──────────────────────────────
  /** The op copied with one line changed so that a real write fails, the idiom of the set-class registry-write case
   *  above: `line` is that line as it is, `instead` its replacement, and every other byte is the op as it is. */
  const copyOp = (line: string, instead: string): string => {
    const src = fs.readFileSync(OP, 'utf8');
    expect(src.split(line), `the op has the line ${line}`).toHaveLength(2);
    const copy = path.join(home, 'models-op-copy.mjs');
    fs.writeFileSync(copy, src.replaceAll("from '../shared/", `from '${pathToFileURL(path.join(REPO, 'shared')).href}/`)
      .replace(line, instead));
    return copy;
  };
  /** `verb('revert')`, through a copy of the op. */
  const revertThrough = (copy: string): Result => {
    const r = spawnSync(process.execPath, [copy, 'revert', '--file', rosterPath(), '--id', ID, '--class', 'opus'],
      { env: { ...process.env, HOME: home, CCRC_MODELS_NOW: NOW }, encoding: 'utf8' });
    const stdout = r.stdout ?? '';
    expect(stdout.split('\n'), `stdout is not one JSON line: ${JSON.stringify(stdout)}`).toHaveLength(2);
    return { code: r.status ?? -1, body: JSON.parse(stdout.split('\n')[0]!), stderr: r.stderr ?? '', stdout };
  };
  const opusEnv = (): string | undefined => settingsOf(LEGACY_SUFFIX).env['ANTHROPIC_DEFAULT_OPUS_MODEL'];

  it("a revert whose hold cannot be written refuses before the registry moves: with a clock not of the file's form, every lane file keeps its bytes (D-5206)", () => {
    advanced();
    const before = modelFiles();
    const settings = fs.readFileSync(path.join(home, LEGACY_SUFFIX, 'settings.json'), 'utf8');
    const r = verb('revert', 'opus', { CCRC_MODELS_NOW: 'yesterday' });
    expect([r.code, r.body['error']], r.stdout + r.stderr).toEqual([1, 'advance-invalid']);
    expect(modelFiles()).toEqual(before);
    expect(fs.readFileSync(path.join(home, LEGACY_SUFFIX, 'settings.json'), 'utf8')).toBe(settings);
  });

  it("a revert whose registry write fails leaves the class held, previous kept and the lane as it was, and never says 'Nothing was changed' (D-5206)", () => {
    advanced();
    const reg0 = fs.readFileSync(regPath(ID), 'utf8');
    const opus0 = advanceOf(ID).classes.opus;
    // `writeRegistry` aims under the registry FILE, so its mkdir fails after the hold is written.
    const r = revertThrough(copyOp("return writeJsonFile(registryPath(id), registry, 'registry-unwritable');",
      "return writeJsonFile(path.join(registryPath(id), 'x'), registry, 'registry-unwritable');"));
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(r.body['error']).toBe('registry-unwritable');
    expect(String(r.body['detail']))
      .toMatch(/could not be written: .*\. The registry was not changed\. The hold this revert wrote to the lane's advance file stays, so opus is held now, on model-6\.1-gamma/);
    expect(String(r.body['detail'])).not.toContain('Nothing was changed');
    expect(fs.readFileSync(regPath(ID), 'utf8')).toBe(reg0);
    expect(opusEnv(), 'the lane still renders the pin it had').toBe('model-6.1-gamma');
    const opus = advanceOf(ID).classes.opus;
    expect(opus.hold).toEqual({ at: NOW, by: 'revert' });
    expect([opus.previous, opus.history]).toEqual([opus0.previous, opus0.history]);
  });

  it('a revert whose last advance-file write fails answers ok and says what is not recorded, and a second revert does what that says (D-5991)', () => {
    advanced();
    const opus0 = advanceOf(ID).classes.opus;
    // The commit's write aims under the registry FILE: the hold's write before it is the op's own.
    const r = revertThrough(copyOp('  const w2 = writeAdvance(a.id, done);',
      '  const w2 = writeAdvance(`${a.id}.classes.json/x`, done);'));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toMatchObject({ ok: true, op: 'revert', class: 'opus', from: 'model-6.1-gamma', to: 'model-5.6-gamma' });
    const note = String(r.body['advanceNote']);
    expect(note).toMatch(/^advance-unwritable: .*could not be written: .*\. The class was reverted and is held, but this move is not in its history and its previous model is still on record/);
    expect(note).not.toContain('Nothing was changed');
    expect(r.stderr).toContain(`models-op: ${note}`);
    expect([classesOf(ID)['opus'], opusEnv()]).toEqual(['model-5.6-gamma', 'model-5.6-gamma']);
    const cut = advanceOf(ID).classes.opus;
    expect([cut.hold, cut.previous, cut.history]).toEqual([{ at: NOW, by: 'revert' }, opus0.previous, opus0.history]);
    // What the note says, measured: the real op's second revert clears the record and records no move.
    const again = verb('revert');
    expect(again.code, again.stdout + again.stderr).toBe(0);
    const opus = advanceOf(ID).classes.opus;
    expect([opus.hold, opus.previous, opus.history]).toEqual([{ at: NOW, by: 'revert' }, null, opus0.history]);
  });

  it('a revert run again on a pin already reverted, its first run cut short after the registry write, renders the lane, clears previous, keeps the hold and records no self-move (D-5991)', () => {
    // A revert killed after its registry rename: the pin and its effort already put back, the hold on disk, and
    // previous and the history as they were.
    advanced();
    const adv = advanceOf(ID);
    adv.classes.opus.hold = { at: '2026-10-14T12:00:00Z', by: 'revert' };
    plantAdvance(ID, adv);
    fs.writeFileSync(regPath(ID), `${JSON.stringify(ADV_REGISTRY, null, 2)}\n`, { mode: 0o600 });
    const r = verb('revert');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toMatchObject({ ok: true, op: 'revert', from: 'model-5.6-gamma', to: 'model-5.6-gamma' });
    expect(opusEnv()).toBe('model-5.6-gamma');
    const opus = advanceOf(ID).classes.opus;
    expect([opus.previous, opus.hold]).toEqual([null, { at: NOW, by: 'revert' }]);
    expect(opus.history, 'no entry from a model to itself').toEqual(adv.classes.opus.history);
  });

  /** opus advanced from model-5.6-gamma at max to model-6.1-gamma at xhigh, then set back to model-5.6-gamma BY HAND:
   *  set-class keeps the class's level (xhigh) and leaves previous alone, so a revert finds the pin already on
   *  previous.model at another level. */
  const handBackAtAnotherLevel = (): void => {
    advanced();
    const s = opAt('set-class', '--file', rosterPath(), '--id', ID, '--class', 'opus', '--model', 'model-5.6-gamma');
    expect(s.code, s.stdout + s.stderr).toBe(0);
    const reg = registryOf(ID) as unknown as Registry;
    expect([reg.classes.opus, reg.effort?.opus], 'CONTROL: the pin is previous.model, at another level')
      .toEqual(['model-5.6-gamma', 'xhigh']);
    expect(advanceOf(ID).classes.opus.previous).toEqual({ model: 'model-5.6-gamma', effort: 'max' });
  };
  const handEntry: HistoryEntry = { at: NOW, how: 'hand', from: 'model-6.1-gamma', to: 'model-5.6-gamma', ok: true,
    canary: 'not-run' };

  it('a revert on a pin already on previous.model at another effort level puts the level back and records that change: one model, the effort pair', () => {
    handBackAtAnotherLevel();
    const r = verb('revert');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((registryOf(ID) as unknown as Registry).effort?.opus).toBe('max');
    const opus = advanceOf(ID).classes.opus;
    expect([opus.previous, opus.hold]).toEqual([null, { at: NOW, by: 'revert' }]);
    expect(opus.history.slice(-2)).toEqual([handEntry, { at: NOW, how: 'revert', from: 'model-5.6-gamma',
      to: 'model-5.6-gamma', ok: true, canary: 'not-run', effort: { from: 'xhigh', to: 'max' } }]);
  });

  it("a revert of only the effort level whose last advance-file write fails says that change is not recorded, and a second revert does what that says", () => {
    handBackAtAnotherLevel();
    const opus0 = advanceOf(ID).classes.opus;
    const r = revertThrough(copyOp('  const w2 = writeAdvance(a.id, done);',
      '  const w2 = writeAdvance(`${a.id}.classes.json/x`, done);'));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const note = String(r.body['advanceNote']);
    expect(note).toMatch(/^advance-unwritable: .*could not be written: .*\. The class's effort level was put back and the class is held, but this change is not in its history and its previous model is still on record: a second revert finds the class already on that model at that level, so it clears that record and records no move\.$/);
    expect((registryOf(ID) as unknown as Registry).effort?.opus).toBe('max');
    const again = verb('revert');
    expect(again.code, again.stdout + again.stderr).toBe(0);
    const opus = advanceOf(ID).classes.opus;
    expect([opus.previous, opus.history], 'cleared, and no move recorded').toEqual([null, opus0.history]);
  });

  it('a re-run on a reverted pin whose last advance-file write fails says the previous model is still on record, never that a move went unrecorded', () => {
    advanced();
    const adv = advanceOf(ID);
    adv.classes.opus.hold = { at: '2026-10-14T12:00:00Z', by: 'revert' };
    plantAdvance(ID, adv);
    fs.writeFileSync(regPath(ID), `${JSON.stringify(ADV_REGISTRY, null, 2)}\n`, { mode: 0o600 });
    const r = revertThrough(copyOp('  const w2 = writeAdvance(a.id, done);',
      '  const w2 = writeAdvance(`${a.id}.classes.json/x`, done);'));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const note = String(r.body['advanceNote']);
    expect(note).toMatch(/^advance-unwritable: .*could not be written: .*\. The class is on its previous model and held, but that previous model is still on record: run the revert again to clear it; it records no move\.$/);
    expect(note).not.toMatch(/not in its history/);
    const again = verb('revert');
    expect(again.code, again.stdout + again.stderr).toBe(0);
    expect([advanceOf(ID).classes.opus.previous, advanceOf(ID).classes.opus.history]).toEqual([null, adv.classes.opus.history]);
  });

  it("revert ranks a stored level the old model no longer offers by a row that lists it, so it lands on the next level down, not the model's lowest (D-5991)", () => {
    advanced();   // opus advanced from model-5.6-gamma at max to model-6.1-gamma at xhigh
    // Since then the old model has stopped offering max: four levels, as the newer model offers.
    writeCatalogue(ID, { ...ADV_CATALOGUE, models: ADV_CATALOGUE.models
      .map((m) => (m.id === 'model-5.6-gamma' ? { ...m, efforts: [...EFFORTS4] } : m)) });
    const r = verb('revert');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((registryOf(ID) as unknown as Registry).effort?.opus).toBe('xhigh');
  });

  it('revert adds the model it puts back to an explicit discovery list, as set-class does', () => {
    const list = ['model-5.6-alpha', 'model-6-beta', 'model-6.1-gamma'];
    advanced(undefined, { ...ADVANCED, discovery: list });
    const r = verb('revert');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((registryOf(ID) as unknown as Registry).discovery).toEqual([...list, 'model-5.6-gamma']);
  });

  it("revert never grows an openrouter lane's discovery list: a previous model the list lacks is refused, and nothing is written", () => {
    // No writer sets previous on an openrouter lane today, so it is planted: the guard is the whitelist's, and a list
    // that grew here would skip `discovery add`'s check.
    const router = ROSTER.accounts[3]!.id;
    const list = ['model-6.1-alpha', 'model-6.1-beta', 'model-6.1-gamma'];
    const registry: Registry = { probe: 'openrouter', classes: { haiku: 'model-6.1-alpha', sonnet: 'model-6.1-beta',
      opus: 'model-6.1-gamma', fable: null }, subagent: 'sonnet', discovery: list };
    writeCatalogue(router, { ...ADV_CATALOGUE, probe: 'openrouter' });
    fs.writeFileSync(regPath(router), `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
    const m = op('materialise', '--file', rosterPath(), '--id', router);
    expect(m.code, m.stdout + m.stderr).toBe(0);
    const adv = backfillAdvance({ registry, seedFamilies: null });
    adv.classes.opus.previous = { model: 'model-5.6-gamma', effort: null };
    plantAdvance(router, adv);
    const before = modelFiles();
    const r = opEnv({ CCRC_MODELS_NOW: NOW }, 'revert', '--file', rosterPath(), '--id', router, '--class', 'opus');
    expect([r.code, r.body['error']], r.stdout + r.stderr).toEqual([1, 'registry-invalid']);
    expect(String(r.body['detail'])).toMatch(/discovery list does not offer/);
    expect(modelFiles()).toEqual(before);
    expect((registryOf(router) as unknown as Registry).discovery).toEqual(list);
  });

  it.each([['hold'], ['release'], ['revert']])('%s refuses a lane with no class registry, naming init, and writes no advance file', (v) => {
    const bare = ROSTER.accounts[3]!.id;
    const r = opEnv({ CCRC_MODELS_NOW: NOW }, v, '--file', rosterPath(), '--id', bare, '--class', 'opus');
    expect([r.code, r.body['error']], r.stdout + r.stderr).toEqual([1, 'no-registry']);
    expect(fs.existsSync(advPath(bare))).toBe(false);
  });

  it("an orphan's show carries its advance state too (W4's Models view reads it)", () => {
    writeCatalogue('ghost', ADV_CATALOGUE);
    fs.writeFileSync(regPath('ghost'), `${JSON.stringify(ADV_REGISTRY, null, 2)}\n`, { mode: 0o600 });
    const adv = backfillAdvance({ registry: ADV_REGISTRY, seedFamilies: CODEX_SEEDS });
    plantAdvance('ghost', adv);
    const r = op('show', '--file', rosterPath(), '--id', 'ghost');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body['orphan']).toBe(true);
    expect(r.body['advance']).toEqual({ state: 'ok', classes: adv.classes });
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
    ['set-window', ['--model', 'model-9-omega', '--tokens', '400000']],
    ['clear-window', ['--model', 'model-9-omega']],
    ['advance-backfill', []],
    ['hold', ['--class', 'opus']],
    ['release', ['--class', 'opus']],
    ['revert', ['--class', 'opus']],
    ['advance-plan', []],
    ['advance-commit', ['--class', 'opus', '--from', 'none', '--to', 'model-6-delta', '--canary', 'passed']],
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

// ── Plan 3a final fix wave (MF-2): a FIFO at a lane file is never a block ───
// F2, D-2380's class, in this op's own readers. `readFileSync` opens BY NAME
// with no regard for TYPE: a FIFO with no writer, at a path one of these
// readers names, blocks INSIDE the open, so no `catch` ever runs. `ccrc
// doctor`'s `_check_codex` (`_dr_cx_lane`) and `--fix`'s `_fix_codex` call
// this op with no deadline of their own, so one planted FIFO used to hang the
// whole operator-facing doctor. Each reader now type-tests first
// (`readRegular`), and a non-regular file gets that read's EXISTING
// unreadable answer. Every spawn is bounded (`timeout`, ruling F8): pre-fix,
// the child blocks, is ended at the bound, and `signal` reds the case rather
// than the suite. The bound signals the DIRECT child, which is the process
// that blocks: this op spawns nothing.
describe('a FIFO at a lane file\'s path is that read\'s unreadable answer, never a block (MF-2, F2)', () => {
  const BOUND_MS = 10_000;
  const settingsPath = (): string => path.join(home, CODEX_ROW.configDirSuffix, 'settings.json');
  const fifo = (p: string): void => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.rmSync(p, { force: true });
    expect(spawnSync('mkfifo', [p]).status, `mkfifo ${p}`).toBe(0);
  };
  /** `op`, bounded. A child ended at the bound has printed nothing, so the
   *  signal is asserted BEFORE the body is parsed. */
  const bounded = (...args: string[]): Result => {
    const r = spawnSync(process.execPath, [OP, ...args],
      { env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: BOUND_MS });
    expect(r.signal, `models-op ${args[0]} did not exit by itself: it blocked on the FIFO and was ended at the ${BOUND_MS / 1000} s bound`).toBeNull();
    const stdout = r.stdout ?? '';
    return { code: r.status ?? -1, body: JSON.parse(stdout.split('\n')[0]!), stderr: r.stderr ?? '', stdout };
  };
  const init = (): void => {
    const r = op('init', '--file', rosterPath(), '--id', CODEX_ROW.id, '--probe', 'codex');
    expect(r.code, r.stdout + r.stderr).toBe(0);
  };

  beforeEach(() => { seed({ ...ROSTER, accounts: [...ROSTER.accounts, CODEX_ROW] }); });

  it('show with a FIFO catalogue answers catalogue-unreadable', () => {
    init();
    fifo(path.join(home, '.ccrc', 'models', `${CODEX_ROW.id}.json`));
    const r = bounded('show', '--file', rosterPath(), '--id', CODEX_ROW.id);
    expect(r.code, r.stdout).toBe(1);
    expect(r.body['error']).toBe('catalogue-unreadable');
    expect(r.body['detail']).toMatch(/not a regular file/);
  }, 20_000);

  it('show with a FIFO registry answers registry-unreadable', () => {
    fifo(regPath(CODEX_ROW.id));
    const r = bounded('show', '--file', rosterPath(), '--id', CODEX_ROW.id);
    expect(r.code, r.stdout).toBe(1);
    expect(r.body['error']).toBe('registry-unreadable');
    expect(r.body['detail']).toMatch(/not a regular file/);
  }, 20_000);

  it('show with a FIFO windows file answers ok: the windows unreadable, never a block (codex-bridge spec §2.7)', () => {
    init();
    fifo(path.join(home, '.ccrc', 'models', `${CODEX_ROW.id}.windows.json`));
    const r = bounded('show', '--file', rosterPath(), '--id', CODEX_ROW.id);
    expect(r.code, r.stdout).toBe(0);
    expect(r.body['windows']).toMatchObject({ state: 'unreadable' });
    expect((r.body['windows'] as { reason: string }).reason).toMatch(/not a regular file/);
  }, 20_000);

  it('materialise with a FIFO windows file answers ok under the default rule — never a block (codex-bridge spec §2.7)', () => {
    init();
    fifo(path.join(home, '.ccrc', 'models', `${CODEX_ROW.id}.windows.json`));
    const r = bounded('materialise', '--file', rosterPath(), '--id', CODEX_ROW.id);
    expect(r.code, r.stdout).toBe(0);
  }, 20_000);

  it('set-class with a FIFO advance file writes the registry and answers at once, the file unreadable and untouched — never a block (auto-advance spec §2.1)', () => {
    plantAdv(CODEX_ROW.id);
    const adv = path.join(home, '.ccrc', 'models', `${CODEX_ROW.id}.advance.json`);
    fifo(adv);
    const r = bounded('set-class', '--file', rosterPath(), '--id', CODEX_ROW.id,
      '--class', 'opus', '--model', 'model-6-delta');
    expect(r.code, r.stdout).toBe(0);
    expect(classesOf(CODEX_ROW.id)['opus']).toBe('model-6-delta');
    expect(String(r.body['advanceNote'])).toMatch(/^advance-file-unreadable: .*not a regular file/);
    expect(fs.statSync(adv).isFIFO(), 'set-class replaced the FIFO it could not read').toBe(true);
  }, 20_000);

  it('show with a FIFO advance file answers ok: the advance state unreadable, never a block (auto-advance spec §2.7)', () => {
    plantAdv(CODEX_ROW.id);
    fifo(path.join(home, '.ccrc', 'models', `${CODEX_ROW.id}.advance.json`));
    const r = bounded('show', '--file', rosterPath(), '--id', CODEX_ROW.id);
    expect(r.code, r.stdout).toBe(0);
    expect(r.body['advance']).toMatchObject({ state: 'unreadable' });
    expect((r.body['advance'] as { detail: string }).detail).toMatch(/not a regular file/);
  }, 20_000);

  it('show with a FIFO settings.json keeps today\'s answer for an unreadable one: every key missing', () => {
    init();
    fs.rmSync(settingsPath());
    // The control: the ABSENT file's answer, which the catch-all already gives.
    const absent = op('show', '--file', rosterPath(), '--id', CODEX_ROW.id);
    expect(absent.code, absent.stdout).toBe(0);
    expect((absent.body['settingsDrift'] as string[]).length).toBeGreaterThan(0);
    fifo(settingsPath());
    const r = bounded('show', '--file', rosterPath(), '--id', CODEX_ROW.id);
    expect(r.code, r.stdout).toBe(0);
    expect(r.body['settingsDrift']).toEqual(absent.body['settingsDrift']);
  }, 20_000);

  it('materialise --check true with a FIFO <id>.classes.tsv answers materialise-unreadable, and writes nothing', () => {
    init();
    const tsv = path.join(home, '.ccrc', 'models', `${CODEX_ROW.id}.classes.tsv`);
    fifo(tsv);
    const r = bounded('materialise', '--file', rosterPath(), '--id', CODEX_ROW.id, '--check', 'true');
    expect(r.code, r.stdout).toBe(1);
    expect(r.body['error']).toBe('materialise-unreadable');
    expect(r.body['detail']).toMatch(/exists and could not be read: not a regular file\. Nothing was written\.$/);
    expect(fs.statSync(tsv).isFIFO(), 'the check replaced the FIFO it measured').toBe(true);
  }, 20_000);

  it('litellm without --commit, with a FIFO --out, reads no previous rendering: changed:true, and writes nothing', () => {
    init();
    writeCatalogue(CODEX_ROW.id);
    const out = path.join(home, '.handoff', 'litellm-config.yaml');
    fifo(out);
    const r = bounded('litellm', '--file', rosterPath(), '--id', CODEX_ROW.id,
      '--template', path.join(REPO, 'deploy', 'litellm-config.template.yaml'), '--out', out);
    expect(r.code, r.stdout).toBe(0);
    expect(r.body['changed']).toBe(true);
    expect(fs.statSync(out).isFIFO(), 'the check-only call wrote at --out').toBe(true);
    expect(fs.existsSync(`${out}.prev`)).toBe(false);
  }, 20_000);

  // ── Plan 3b Task A6: the writer path and the roster read ────────────────
  // `mergeSettingsEnv` and `clearSettingsEnv` (`shared/modelenv.mjs`) read the
  // lane's settings.json, and `readRoster` is every op's first read: each
  // opened BY NAME, so a FIFO there blocked `materialise` (and with it
  // `_fix_codex`'s re-render), `rm`, and every verb. Each now reads through
  // the one `readRegular`, and a FIFO gets that read's EXISTING answer.
  it('materialise with a FIFO settings.json answers settings-unwritable, and writes nothing after the refused merge (Plan 3b A-6)', () => {
    init();
    const tsv = path.join(home, '.ccrc', 'models', `${CODEX_ROW.id}.classes.tsv`);
    const tsvBefore = fs.statSync(tsv).mtimeMs;
    fifo(settingsPath());
    const r = bounded('materialise', '--file', rosterPath(), '--id', CODEX_ROW.id);
    expect(r.code, r.stdout).toBe(1);
    expect(r.body['error']).toBe('settings-unwritable');
    expect(r.body['detail']).toMatch(/settings\.json could not be read: not a regular file\. Nothing was written\.$/);
    expect(fs.statSync(settingsPath()).isFIFO(), 'materialise replaced the FIFO it refused').toBe(true);
    expect(fs.statSync(tsv).mtimeMs, 'materialise wrote the TSV after refusing the settings merge').toBe(tsvBefore);
  }, 20_000);

  it('rm with a FIFO settings.json reaps the lane files, then answers settings-unwritable — never a block (Plan 3b A-6)', () => {
    init();
    fifo(settingsPath());
    const r = bounded('rm', '--file', rosterPath(), '--id', CODEX_ROW.id);
    expect(r.code, r.stdout).toBe(1);
    expect(r.body['error']).toBe('settings-unwritable');
    expect(r.body['detail']).toMatch(/settings\.json could not be read: not a regular file\. Nothing was written\.$/);
    // `rm`'s unlink loop runs BEFORE its settings step, by design (an orphan
    // has no settings to clear), so the model files are already reaped.
    expect(fs.existsSync(regPath(CODEX_ROW.id))).toBe(false);
    expect(fs.statSync(settingsPath()).isFIFO(), 'rm replaced the FIFO it refused').toBe(true);
  }, 20_000);

  it('every op with a FIFO roster answers roster-unreadable — never a block (Plan 3b A-6)', () => {
    fifo(rosterPath());
    const r = bounded('lanes', '--file', rosterPath());
    expect(r.code, r.stdout).toBe(1);
    expect(r.body['error']).toBe('roster-unreadable');
    expect(r.body['detail']).toMatch(/accounts\.json exists and could not be read: not a regular file\. /);
    expect(fs.statSync(rosterPath()).isFIFO()).toBe(true);
  }, 20_000);

  // The control: a DIRECTORY at settings.json never blocked (EISDIR is
  // immediate), and its code must not move. Green before this task and after.
  it('materialise with a DIRECTORY at settings.json still answers settings-unwritable (Plan 3b A-6)', () => {
    init();
    fs.rmSync(settingsPath());
    fs.mkdirSync(settingsPath());
    const r = bounded('materialise', '--file', rosterPath(), '--id', CODEX_ROW.id);
    expect(r.code, r.stdout).toBe(1);
    expect(r.body['error']).toBe('settings-unwritable');
    expect(r.body['detail']).toMatch(/settings\.json could not be read: /);
    expect(fs.statSync(settingsPath()).isDirectory()).toBe(true);
  }, 20_000);
});

// ── auto-advance W1 Task 3, fix round 1: readAdvance and writeAdvance keep to their answers ──────────────────────
// No op calls either until Task 5, and this file is a script that runs `main` when it is loaded, so these cases run
// the shipped functions through a COPY of it: its one `process.exit(main(…))` line replaced by a probe, and its
// `../shared/` imports pointed at this checkout's. Every other byte of the copy is the file as it is.
describe('readAdvance and writeAdvance keep to their answers before any op calls them (auto-advance §2.1)', () => {
  const LAST = 'process.exit(main(process.argv));';
  const probe = (line: string): { code: number | null; stdout: string; stderr: string } => {
    const src = fs.readFileSync(OP, 'utf8');
    expect(src.split(LAST), 'models-op ends in its one main call').toHaveLength(2);
    const shared = pathToFileURL(path.join(REPO, 'shared')).href;
    const file = path.join(home, 'models-op-probe.mjs');
    fs.writeFileSync(file, src.replaceAll("from '../shared/", `from '${shared}/`).replace(LAST, line));
    const r = spawnSync(process.execPath, [file], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  /** The probe's stdout as ONE JSON line, the shape every models-op answer has. */
  const oneLine = (stdout: string): unknown => {
    const one = stdout.endsWith('\n') && stdout.indexOf('\n') === stdout.length - 1;
    expect(one, `one line: ${stdout.slice(0, 200)}`).toBe(true);
    return JSON.parse(stdout);
  };
  const advFile = (): string => path.join(home, '.ccrc', 'models', 'lane-a.advance.json');
  const EXAMPLE_JSON = JSON.stringify(JSON.stringify(ADVANCE_EXAMPLE));

  it('a file nested too deeply to copy answers advance-file-invalid, as one JSON line, and never throws', () => {
    fs.mkdirSync(path.dirname(advFile()), { recursive: true });
    const deep = serializeAdvance(ADVANCE_EXAMPLE).replace(/\n}\n$/, `,\n  "note": ${ADV_DEEP_TEXT}\n}\n`);
    fs.writeFileSync(advFile(), deep);
    const r = probe("out(readAdvance('lane-a'));");
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    const answer = oneLine(r.stdout) as { err: [string, string] };
    expect(answer.err[0]).toBe('advance-file-invalid');
    expect(answer.err[1]).toMatch(/nests too deeply/);
  });

  it.each([
    ['a history with a hole at [0]', 'adv.classes.opus.history = [, adv.classes.opus.history[0]];',
      'classes.opus.history[0]'],
    ['a hold inherited rather than its own',
      '{ const { hold, ...own } = adv.classes.fable; '
        + 'adv.classes.fable = Object.assign(Object.create({ hold }), own); }',
      'classes.fable.hold'],
  ])('writeAdvance refuses %s as advance-invalid and writes nothing: it checks what a file would hold', (_why, edit, field) => {
    const r = probe(`const adv = JSON.parse(${EXAMPLE_JSON}); ${edit} out({ answer: writeAdvance('lane-a', adv) });`);
    expect(r.stderr).toBe('');
    const { answer } = oneLine(r.stdout) as { answer: [string, string] | null };
    expect(answer?.[0]).toBe('advance-invalid');
    expect(answer?.[1]).toContain(`(${field} `);
    expect(fs.existsSync(advFile()), 'a refused write leaves no file').toBe(false);
  });

  it("the control: the example unedited is written 0600 as serializeAdvance's bytes (D-5783), and reads back whole", () => {
    const w = probe(`out({ answer: writeAdvance('lane-a', JSON.parse(${EXAMPLE_JSON})) });`);
    expect(oneLine(w.stdout)).toEqual({ answer: null });
    expect(fs.readFileSync(advFile(), 'utf8')).toBe(serializeAdvance(ADVANCE_EXAMPLE));
    expect(fs.statSync(advFile()).mode & 0o777).toBe(0o600);
    expect(oneLine(probe("out(readAdvance('lane-a'));").stdout)).toEqual({ advance: ADVANCE_EXAMPLE });
  });
});

// D-5521 (A26a): `isAnthropicLane` is `telemetry === 'anthropic'`, so an OpenRouter lane
// writing `openrouter` and a compatible lane writing `none` are both registry lanes. Red
// before A26a for the openrouter half: `rosterFromJson` refused the whole roster.
describe('key lanes after D-5521 are not Anthropic lanes', () => {
  const KEY_ROSTER = {
    version: 1,
    accounts: [
      ROSTER.accounts[0],
      { id: 'lane-d', label: 'lane-d', configDirSuffix: '.claude-lane-d',
        exec: { kind: 'generated', provider: 'openrouter', secretsFile: '.cc-secrets/lane-d-openrouter.env' },
        homeAble: true, hue: 'amber', telemetry: 'openrouter' },
      { id: 'lane-e', label: 'lane-e', configDirSuffix: '.claude-lane-e',
        exec: { kind: 'generated', provider: 'compatible', baseUrl: 'https://compatible.example.invalid', secretsFile: '.cc-secrets/lane-e-compatible.env' },
        homeAble: true, hue: 'green', telemetry: 'none' },
    ],
  };

  it('init on an openrouter-telemetry lane writes its registry rather than refusing anthropic-lane', () => {
    seed(KEY_ROSTER);
    const r = op('init', '--file', rosterPath(), '--id', 'lane-d', '--probe', 'openrouter');
    expect(r.body['error']).toBeUndefined();
    expect(r.code).toBe(0);
    expect(registryOf('lane-d')['probe']).toBe('openrouter');
  });

  it('…and so does init on a none compatible lane', () => {
    seed(KEY_ROSTER);
    const r = op('init', '--file', rosterPath(), '--id', 'lane-e', '--probe', 'compatible',
      '--base-url', 'https://compatible.example.invalid');
    expect(r.body['error']).toBeUndefined();
    expect(r.code).toBe(0);
    expect(registryOf('lane-e')['probe']).toBe('compatible');
  });
});

// ── auto-advance plan W2, Tasks 8 and 9: the advance step's two ops ──────────
// Their own lane (`stepRoster`, fixtures/advanceCases.ts): neutral ids only.
// The roster's ports are pure-parse: nothing in this file connects to either.
const STEP_PORTS = { proxyPort: 45020, litellmPort: 45021 };
const STEP_SETTINGS = '.claude-lane-a';
/** lane-a's advance file, through W1's `advanceOf`. */
const laneAdvance = (): Advance => advanceOf('lane-a');

/** A lane's registry, catalogue and advance file, then the op's own materialise.
 *  `catalogue: null` leaves the lane never probed; `advance: null` leaves the
 *  advance file absent. */
function plantStep(o: { id?: string; registry?: unknown; catalogue?: unknown; advance?: unknown } = {}): void {
  const id = o.id ?? 'lane-a';
  fs.mkdirSync(path.join(home, '.ccrc', 'models'), { recursive: true });
  fs.writeFileSync(regPath(id), `${JSON.stringify(o.registry ?? STEP_REGISTRY, null, 2)}\n`, { mode: 0o600 });
  if (o.catalogue !== null) writeCatalogue(id, o.catalogue ?? STEP_CATALOGUE);
  if (o.advance !== null) {
    fs.writeFileSync(advPath(id), `${JSON.stringify(o.advance ?? stepAdvance(), null, 2)}\n`, { mode: 0o600 });
  }
  const m = op('materialise', '--file', rosterPath(), '--id', id);
  expect(m.code, m.stdout + m.stderr).toBe(0);
}

/** Every directory and file under ~/.ccrc and lane-a's settings directory,
 *  the two roots included: each one's path, type, mode, size and mtime, and a
 *  file's bytes (a link's target). The "writes nothing" pins compare two of
 *  these, so a file rewritten in place, a tmp left behind and a directory the
 *  op creates (whose parent's mtime moves too) each red them. Not followed
 *  through a link: `lstat`. */
function snapshot(): string[] {
  const out: string[] = [];
  const walk = (p: string): void => {
    const st = fs.lstatSync(p);
    const type = st.isDirectory() ? 'dir' : st.isFile() ? 'file' : st.isSymbolicLink() ? 'link' : 'other';
    const body = type === 'file' ? fs.readFileSync(p, 'utf8') : type === 'link' ? fs.readlinkSync(p) : '';
    out.push(`${path.relative(home, p)} ${type} ${(st.mode & 0o7777).toString(8)} ${st.size} ${st.mtimeMs} ${body}`);
    if (type === 'dir') for (const e of fs.readdirSync(p)) walk(path.join(p, e));
  };
  walk(path.join(home, '.ccrc'));
  if (fs.existsSync(path.join(home, STEP_SETTINGS))) walk(path.join(home, STEP_SETTINGS));
  return out.sort();
}

describe('advance-plan (auto-advance spec §2.2 to §2.3; plan W2 Task 8)', () => {
  const plan = (id = 'lane-a'): Result => op('advance-plan', '--file', rosterPath(), '--id', id);
  const none = { candidate: null, reason: null, blocked: null, effortTo: null, canaryEffort: null };

  beforeEach(() => { seed(stepRoster({ ...STEP_PORTS, authDir: codexAuthDir('lane-a') })); });

  it('a codex-kind lane on a fresh catalogue is eligible, and its candidate carries effortTo and canaryEffort', () => {
    plantStep();
    const r = plan();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toMatchObject({ ok: true, op: 'advance-plan', id: 'lane-a', eligible: true, why: null, file: 'ok' });
    expect(r.body['classes']).toEqual([
      { class: 'haiku', pin: 'model-6-alpha', family: 'alpha', held: false, ...none },
      { class: 'sonnet', pin: 'model-6-beta', family: 'beta', held: false, ...none },
      { class: 'opus', pin: 'model-5.6-gamma', family: 'gamma', held: false, candidate: 'model-6.1-gamma',
        reason: 'newer', blocked: null, effortTo: 'xhigh', canaryEffort: 'low' },
      { class: 'fable', pin: null, family: null, held: false, ...none },
    ]);
  });

  it('a pinned class whose stored family differs reports its pin\'s family, its candidate\'s (D-5992)', () => {
    // A stored family that disagrees with the pin is stale (a hand-edited file, a
    // set-class by a build from before the advance file): `chooseCandidate`
    // follows the pin's family, so the row must name that one. A newer gamma is
    // listed, so a row naming the stored word would point a reader at a move
    // across families that the step never makes.
    plantStep({
      registry: { ...STEP_REGISTRY, classes: { ...STEP_REGISTRY.classes, haiku: 'model-5.6-alpha' } },
      advance: stepAdvance({ haiku: { family: 'gamma' } }),
    });
    const haiku = (plan().body['classes'] as Record<string, unknown>[])[0];
    expect(haiku).toEqual({ class: 'haiku', pin: 'model-5.6-alpha', family: 'alpha', held: false,
      candidate: 'model-6-alpha', reason: 'newer', blocked: null, effortTo: 'high', canaryEffort: 'low' });
  });

  it('an empty class whose family is stored takes the newest of its family, with no effort of its own', () => {
    plantStep({ advance: stepAdvance({ fable: { family: 'delta' } }) });
    const fable = (plan().body['classes'] as Record<string, unknown>[])[3];
    expect(fable).toEqual({ class: 'fable', pin: null, family: 'delta', held: false, candidate: 'model-6-delta',
      reason: 'empty', blocked: null, effortTo: null, canaryEffort: 'low' });
  });

  it('a held class reports its candidate with held true', () => {
    plantStep({ advance: stepAdvance({ opus: { hold: { at: '2026-10-22T08:00:00Z', by: 'hand' } } }) });
    const opus = (plan().body['classes'] as Record<string, unknown>[])[2];
    expect(opus).toMatchObject({ class: 'opus', held: true, candidate: 'model-6.1-gamma' });
  });

  it('a class chooseCandidate blocks is reported blocked, with no candidate (shared-family)', () => {
    // haiku and sonnet both follow alpha, and sonnet pins its newest: only the
    // operator can say which class keeps the family, so haiku is blocked, and
    // the row says so rather than reading as a class with nothing to do.
    plantStep({
      registry: { ...STEP_REGISTRY,
        classes: { ...STEP_REGISTRY.classes, haiku: 'model-5.6-alpha', sonnet: 'model-6-alpha' } },
      advance: stepAdvance({ sonnet: { family: 'alpha' } }),
    });
    const haiku = (plan().body['classes'] as Record<string, unknown>[])[0];
    expect(haiku).toEqual({ class: 'haiku', pin: 'model-5.6-alpha', family: 'alpha', held: false, ...none,
      blocked: 'shared-family' });
  });

  it('an unreadable windows file blocks each candidate with windows-unreadable and keeps the candidate', () => {
    // The commit would abandon `windows-unreadable` after a canary (Task 9), so
    // the plan says so first and the step spends no request on it.
    plantStep();
    plantWindows('lane-a', '{ not json');
    const rows = plan().body['classes'] as Record<string, unknown>[];
    expect(rows[2]).toMatchObject({ class: 'opus', candidate: 'model-6.1-gamma', blocked: 'windows-unreadable' });
    expect(rows[0]).toMatchObject({ class: 'haiku', candidate: null, blocked: null });
    expect(BLOCKED_CAUSES).toContain('windows-unreadable');
  });

  it('an absent advance file derives families from pins and seeds no empty class', () => {
    plantStep({ advance: null });
    const r = plan();
    expect(r.body).toMatchObject({ eligible: true, file: 'absent' });
    const rows = r.body['classes'] as Record<string, unknown>[];
    expect(rows[2]).toMatchObject({ class: 'opus', family: 'gamma', candidate: 'model-6.1-gamma' });
    // A seeded family here would be the backfill's job done by a read-only op.
    expect(rows[3]).toEqual({ class: 'fable', pin: null, family: null, held: false, ...none });
    expect(fs.existsSync(advPath('lane-a'))).toBe(false);
  });

  it.each([
    ['an external-kind lane', 'lane-not-codex-kind', (): void => plantStep({ id: 'lane-b' }), 'lane-b'],
    ['a codex-kind lane whose registry is not a codex probe', 'probe-not-codex', (): void => plantStep({
      registry: { probe: 'openrouter', classes: { haiku: null, sonnet: null, opus: null, fable: null },
        subagent: 'sonnet', discovery: [] } }), 'lane-a'],
    ['a lane never probed', 'never-probed', (): void => plantStep({ catalogue: null }), 'lane-a'],
    ['a stale catalogue', 'catalogue-stale', (): void => plantStep({ catalogue: { ...STEP_CATALOGUE, stale: true } }),
      'lane-a'],
  ] as [string, string, () => void, string][])('%s is ineligible, why %s, and no class has a candidate', (_w, why, plant, id) => {
    plant();
    const r = plan(id);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toMatchObject({ eligible: false, why });
    for (const row of r.body['classes'] as Record<string, unknown>[]) expect(row).toMatchObject(none);
  });

  it('an Anthropic lane is refused, as it refuses every op but show', () => {
    const r = plan('lane-c');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('anthropic-lane');
  });

  it.each([
    ['an advance file that is a directory', 'advance-file-unreadable', (): void => {
      fs.rmSync(advPath('lane-a')); fs.mkdirSync(advPath('lane-a'));
    }],
    ['an advance file of another version', 'advance-file-invalid', (): void => {
      fs.writeFileSync(advPath('lane-a'), `${JSON.stringify({ ...stepAdvance(), v: 2 }, null, 2)}\n`);
    }],
    ['a registry that is not JSON', 'registry-invalid', (): void => { fs.writeFileSync(regPath('lane-a'), '{ not json'); }],
    ['a registry that is a directory', 'registry-unreadable', (): void => {
      fs.rmSync(regPath('lane-a')); fs.mkdirSync(regPath('lane-a'));
    }],
    ['a catalogue that is not a catalogue', 'catalogue-invalid', (): void => { writeCatalogue('lane-a', { probe: 'codex' }); }],
    ['a catalogue that is a directory', 'catalogue-unreadable', (): void => {
      const p = path.join(home, '.ccrc', 'models', 'lane-a.json');
      fs.rmSync(p); fs.mkdirSync(p);
    }],
  ] as [string, string, () => void][])('%s is a refusal naming %s, a BLOCKED_CAUSES word', (_w, word, spoil) => {
    plantStep();
    spoil();
    const r = plan();
    expect(r.code).toBe(1);
    expect(r.body).toMatchObject({ ok: false, error: word });
    expect(BLOCKED_CAUSES).toContain(word);
  });

  // A pending automatic intent that LANDED (the registry pins its `to`): the
  // next locked WRITER settles it, recording the move; a reader that settled it
  // in place would be a writer running without the lane-files lock.
  const LANDED = { class: 'opus', from: 'model-5-gamma', to: 'model-5.6-gamma', effortFrom: 'max', effortTo: 'max',
    at: '2026-10-22T08:00:00Z' };
  it.each([
    ['absent', 0, (): void => plantStep({ advance: null })],
    ['present, with a landed automatic intent pending', 0, (): void => plantStep({ advance: stepAdvance({}, LANDED) })],
    ['unreadable, a directory at its path', 1, (): void => {
      plantStep({ advance: null });
      fs.mkdirSync(advPath('lane-a'));
    }],
  ] as [string, number, () => void][])('the plan writes nothing with the advance file %s: every directory and file under '
    + '~/.ccrc and the lane\'s settings keeps its type, mode, size, mtime and bytes', (_w, code, plant) => {
    plant();
    const before = snapshot();
    const r = plan();
    expect(r.code, r.stdout + r.stderr).toBe(code);
    expect(plan().code).toBe(code);
    expect(snapshot()).toEqual(before);
  });
});

describe('advance-commit (auto-advance spec §2.1 D21 and §2.3; plan W2 Task 9)', () => {
  const NOW = '2026-10-22T10:05:12Z';
  const LATER = '2026-10-22T11:05:09Z';
  const HOLD = { at: '2026-10-22T09:00:00Z', by: 'hand' };
  /** The intent an opus move leaves under the lock before its registry rename. */
  const INTENT = { class: 'opus', from: 'model-5.6-gamma', to: 'model-6.1-gamma', effortFrom: 'max', effortTo: 'xhigh',
    at: '2026-10-22T09:05:11Z' };
  /** lane-a's registry as that move's rename left it: opus already on the new model. */
  const MOVED_REGISTRY = `${JSON.stringify({ ...STEP_REGISTRY, classes: { ...STEP_REGISTRY.classes, opus: 'model-6.1-gamma' },
    effort: { ...STEP_REGISTRY.effort, opus: 'xhigh' } }, null, 2)}\n`;
  /** What an answer names for that move once a locked writer settles it as landed: an automatic advance's. */
  const RECOVERED = { class: 'opus', from: 'model-5.6-gamma', to: 'model-6.1-gamma', how: 'advance' };
  /** The history entry that move becomes, once, in whichever locked writer settles it. */
  const RECOVERED_ENTRY = { at: INTENT.at, how: 'advance', from: 'model-5.6-gamma', to: 'model-6.1-gamma', ok: true,
    canary: 'passed', effort: { from: 'max', to: 'xhigh' }, recovered: true };
  /** A hand set-class's intent (W1 Task 5's `beginHandMove`), written before ITS registry rename
   *  (D-5188): fable set by hand to the delta model. */
  const HAND_INTENT = { how: 'hand', class: 'fable', from: null, to: 'model-6-delta', emptied: [],
    at: '2026-10-22T09:05:11Z' };
  /** lane-a's registry as that set-class's rename left it: fable already on the delta model. */
  const HAND_REGISTRY = `${JSON.stringify({ ...STEP_REGISTRY, classes: { ...STEP_REGISTRY.classes,
    fable: 'model-6-delta' } }, null, 2)}\n`;
  /** The entry that hand move becomes: the operator's act, so no `recovered` mark (W1 Task 3). */
  const HAND_ENTRY = { at: '2026-10-22T09:05:11Z', how: 'hand', from: null, to: 'model-6-delta', ok: true,
    canary: 'not-run' };
  /** What an answer names for it: reported as hand, never as an advance (D-5216). */
  const HAND_MOVE = { class: 'fable', from: null, to: 'model-6-delta', how: 'hand' };
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const commit = (o: { id?: string; cls?: string; from?: string; to?: string; canary?: string; reason?: string;
    now?: string } = {}): Result =>
    opEnv({ CCRC_MODELS_NOW: o.now ?? NOW }, 'advance-commit', '--file', rosterPath(), '--id', o.id ?? 'lane-a',
      '--class', o.cls ?? 'opus', '--from', o.from ?? 'model-5.6-gamma', '--to', o.to ?? 'model-6.1-gamma',
      '--canary', o.canary ?? 'passed', ...(o.reason === undefined ? [] : ['--reason', o.reason]));
  const backfill = (): Result =>
    opEnv({ CCRC_MODELS_NOW: NOW }, 'advance-backfill', '--file', rosterPath(), '--id', 'lane-a');
  const opusOf = (): ClassAdvance => laneAdvance().classes.opus;
  const env = (): Record<string, string> => settingsOf(STEP_SETTINGS).env;
  /** `advanceCommitOp`'s own source, for the order pin no fixture can stop between two writes. */
  const commitSource = (): string => {
    const src = fs.readFileSync(OP, 'utf8');
    const start = src.indexOf('function advanceCommitOp(');
    expect(start, 'deploy/models-op.mjs has no advanceCommitOp').toBeGreaterThan(0);
    return src.slice(start, src.indexOf('\n}\n', start));
  };

  beforeEach(() => { seed(stepRoster({ ...STEP_PORTS, authDir: codexAuthDir('lane-a') })); });

  it('a passed canary moves the class: pin, resolved effort, settings env, previous, the ok entry, no pending, a push', () => {
    plantStep();
    const r = commit();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toEqual({ ok: true, op: 'advance-commit', id: 'lane-a', class: 'opus', outcome: 'moved',
      from: 'model-5.6-gamma', to: 'model-6.1-gamma', effort: { from: 'max', to: 'xhigh' }, push: true,
      recovered: false });
    expect(classesOf('lane-a')['opus']).toBe('model-6.1-gamma');
    expect((registryOf('lane-a')['effort'] as Record<string, string>)['opus']).toBe('xhigh');
    expect(env()['ANTHROPIC_DEFAULT_OPUS_MODEL']).toBe('model-6.1-gamma');
    expect(env()['ANTHROPIC_MODEL']).toBe('model-6.1-gamma');
    expect(laneAdvance().pending).toBeNull();
    expect(opusOf().previous).toEqual({ model: 'model-5.6-gamma', effort: 'max' });
    expect(opusOf().history).toEqual([{ at: NOW, how: 'advance', from: 'model-5.6-gamma', to: 'model-6.1-gamma',
      ok: true, canary: 'passed', effort: { from: 'max', to: 'xhigh' } }]);
  });

  it('an empty class with a stored family is filled, and carries no effort it never had', () => {
    plantStep({ advance: stepAdvance({ fable: { family: 'delta' } }) });
    const r = commit({ cls: 'fable', from: 'none', to: 'model-6-delta' });
    expect(r.body).toMatchObject({ outcome: 'moved', from: null, to: 'model-6-delta', effort: { from: null, to: null } });
    expect(classesOf('lane-a')['fable']).toBe('model-6-delta');
    expect(laneAdvance().classes.fable.previous).toEqual({ model: null, effort: null });
  });

  it('a hold that appeared since the plan abandons the move, writing nothing', () => {
    // Review Focus (races and locks): the Hold wins.
    plantStep({ advance: stepAdvance({ opus: { hold: HOLD } }) });
    const before = snapshot();
    const r = commit();
    expect(r.body).toMatchObject({ ok: true, outcome: 'abandoned', why: 'held', push: false });
    expect(snapshot()).toEqual(before);
  });

  it('a failed canary on a class held since the plan abandons too, and records no failure', () => {
    plantStep({ advance: stepAdvance({ opus: { hold: HOLD } }) });
    const before = snapshot();
    expect(commit({ canary: 'failed', reason: 'http 500: upstream error' }).body)
      .toMatchObject({ outcome: 'abandoned', why: 'held', push: false });
    expect(snapshot()).toEqual(before);
  });

  it.each([
    ['the pin moved since the plan', 'pin-moved', { from: 'model-5.6-alpha' }, (): void => {}],
    ['a newer candidate appeared since the plan', 'candidate-changed', {}, (): void => {
      writeCatalogue('lane-a', { ...STEP_CATALOGUE, models: [...STEP_CATALOGUE.models, stepRow('model-6.2-gamma')] });
    }],
    ['the candidate left the catalogue', 'candidate-changed', {}, (): void => {
      writeCatalogue('lane-a', { ...STEP_CATALOGUE,
        models: STEP_CATALOGUE.models.filter((m) => m.id !== 'model-6.1-gamma') });
    }],
    ['a stale catalogue', 'catalogue-stale', {}, (): void => {
      writeCatalogue('lane-a', { ...STEP_CATALOGUE, stale: true });
    }],
    ['an unreadable windows file', 'windows-unreadable', {}, (): void => { plantWindows('lane-a', '{ not json'); }],
  ] as [string, string, { from?: string }, () => void][])('%s abandons with %s, writing nothing', (_w, why, args, spoil) => {
    plantStep();
    spoil();
    const before = snapshot();
    const r = commit(args);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toMatchObject({ outcome: 'abandoned', why, push: false });
    expect(snapshot()).toEqual(before);
  });

  it('a lane that is not codex-kind abandons not-eligible', () => {
    plantStep({ id: 'lane-b' });
    expect(commit({ id: 'lane-b' }).body).toMatchObject({ outcome: 'abandoned', why: 'not-eligible' });
    expect(classesOf('lane-b')['opus']).toBe('model-5.6-gamma');
  });

  it('a second commit of the same move, as an overlapping refresh sends it, abandons pin-moved and writes nothing', () => {
    // Review Focus (races and locks): two refreshes canary the same candidate;
    // the lane lock serialises their commits, and the second finds the pin moved.
    plantStep();
    expect(commit().body['outcome']).toBe('moved');
    const after = snapshot();
    const second = commit({ now: LATER });
    expect(second.body).toMatchObject({ outcome: 'abandoned', why: 'pin-moved', push: false });
    expect(snapshot()).toEqual(after);
    expect(opusOf().history).toHaveLength(1);
  });

  it('a failed materialise whose restore cannot rewrite the files either: registry restored, one failure, restored false', () => {
    plantStep();
    const regBefore = fs.readFileSync(regPath('lane-a'), 'utf8');
    const tsv = path.join(home, '.ccrc', 'models', 'lane-a.classes.tsv');
    fs.rmSync(tsv);
    fs.mkdirSync(tsv);
    const r = commit();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toMatchObject({ outcome: 'failed', restored: false, push: true });
    expect(String(r.body['reason'])).toMatch(
      /^materialise failed \(materialise-failed\) and re-materialising the previous registry failed too \(materialise-failed\): /);
    expect(fs.readFileSync(regPath('lane-a'), 'utf8')).toBe(regBefore);
    expect(env()['ANTHROPIC_DEFAULT_OPUS_MODEL']).toBe('model-5.6-gamma');
    expect(laneAdvance().pending).toBeNull();
    expect(opusOf().previous).toBeNull();
    expect(opusOf().history).toEqual([expect.objectContaining({
      how: 'advance', from: 'model-5.6-gamma', to: 'model-6.1-gamma', ok: false, canary: 'passed' })]);
    const again = commit({ now: LATER });
    expect(again.body).toMatchObject({ outcome: 'failed', push: false });
    expect(opusOf().history).toEqual([expect.objectContaining({ ok: false, canary: 'passed', tries: 2, lastAt: LATER })]);
  });

  // Root ignores a directory's write bit, so this proves nothing there: a
  // visible skip, not a false red.
  it.skipIf(isRoot)('a materialise that cannot rewrite settings.json restores the old registry and its files: restored true', () => {
    plantStep();
    const regBefore = fs.readFileSync(regPath('lane-a'), 'utf8');
    const settings = path.join(home, STEP_SETTINGS, 'settings.json');
    const settingsBefore = fs.readFileSync(settings, 'utf8');
    fs.chmodSync(path.dirname(settings), 0o555);
    const r = ((): Result => {
      try {
        return commit();
      } finally {
        fs.chmodSync(path.dirname(settings), 0o755);
      }
    })();
    expect(r.body).toMatchObject({ outcome: 'failed', restored: true, push: true });
    expect(String(r.body['reason'])).toMatch(/^materialise failed \(settings-unwritable\), so the previous registry was restored: /);
    expect(fs.readFileSync(regPath('lane-a'), 'utf8')).toBe(regBefore);
    expect(fs.readFileSync(settings, 'utf8')).toBe(settingsBefore);
  });

  it('a failed canary records one deduplicated failure and leaves the registry and settings untouched', () => {
    plantStep();
    const reg = fs.readFileSync(regPath('lane-a'), 'utf8');
    const settings = JSON.stringify(env());
    expect(commit({ canary: 'failed', reason: 'http 500: upstream error' }).body)
      .toMatchObject({ outcome: 'failed', push: true, reason: 'http 500: upstream error' });
    expect(commit({ canary: 'failed', reason: 'http 500: upstream error', now: LATER }).body)
      .toMatchObject({ outcome: 'failed', push: false });
    expect(opusOf().history).toEqual([expect.objectContaining({ how: 'advance', from: 'model-5.6-gamma',
      to: 'model-6.1-gamma', ok: false, canary: 'failed', reason: 'http 500: upstream error', tries: 2, lastAt: LATER })]);
    expect(fs.readFileSync(regPath('lane-a'), 'utf8')).toBe(reg);
    expect(JSON.stringify(env())).toBe(settings);
  });

  it('a reason is stored as printable ASCII of at most REASON_MAX characters, so the advance file stays readable', () => {
    plantStep();
    const r = commit({ canary: 'failed', reason: `${'é'.repeat(10)}${'x'.repeat(REASON_MAX + 100)}` });
    expect(r.body['reason']).toBe('x'.repeat(REASON_MAX));
    expect(String(opusOf().history[0]!.reason)).toMatch(new RegExp(`^[\\x20-\\x7e]{1,${REASON_MAX}}$`));
    expect(op('advance-plan', '--file', rosterPath(), '--id', 'lane-a').code).toBe(0);
  });

  it('the crash gap: an intent left between the rename and the materialise is recorded as landed by the next locked writer', () => {
    // Review Focus (the crash gap): a SIGTERM at the unit's 300 s bound after
    // the registry rename and before materialise leaves `pending` on disk, the
    // registry already at `to` and the lane's files still the old ones. Here
    // the next locked writer is a commit for another class.
    plantStep({ advance: stepAdvance({ fable: { family: 'delta' } }, INTENT) });
    fs.writeFileSync(regPath('lane-a'), MOVED_REGISTRY);
    expect(env()['ANTHROPIC_DEFAULT_OPUS_MODEL']).toBe('model-5.6-gamma');
    const r = commit({ cls: 'fable', from: 'none', to: 'model-6-delta' });
    expect(r.body).toMatchObject({ outcome: 'moved', recovered: true, recoveredMove: RECOVERED });
    expect(laneAdvance().pending).toBeNull();
    expect(opusOf().previous).toEqual({ model: 'model-5.6-gamma', effort: 'max' });
    expect(opusOf().history).toEqual([expect.objectContaining({ how: 'advance', from: 'model-5.6-gamma',
      to: 'model-6.1-gamma', ok: true, recovered: true })]);
    // This commit's own materialise rewrote the lane's files from the whole registry.
    expect(env()['ANTHROPIC_DEFAULT_OPUS_MODEL']).toBe('model-6.1-gamma');
  });

  it('the crash gap, every hour: advance-backfill settles a landed intent and names the move in its answer', () => {
    // Review Focus (the crash gap): the realistic path. After the gap the moved
    // class pins its family's newest model, so no commit runs for it; the
    // hourly step's first locked writer, the backfill, settles the intent.
    plantStep({ advance: stepAdvance({}, INTENT) });
    fs.writeFileSync(regPath('lane-a'), MOVED_REGISTRY);
    const r = backfill();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toEqual({ ok: true, op: 'advance-backfill', id: 'lane-a', created: false, why: 'present',
      recoveredMove: RECOVERED });
    expect(laneAdvance().pending).toBeNull();
    expect(opusOf().previous).toEqual({ model: 'model-5.6-gamma', effort: 'max' });
    expect(opusOf().history).toEqual([expect.objectContaining({ ok: true, recovered: true, to: 'model-6.1-gamma',
      effort: { from: 'max', to: 'xhigh' } })]);
    // Settled once: the next hour's backfill writes nothing.
    const bytes = fs.readFileSync(advPath('lane-a'), 'utf8');
    expect(backfill().body).toEqual({ ok: true, op: 'advance-backfill', id: 'lane-a', created: false, why: 'present' });
    expect(fs.readFileSync(advPath('lane-a'), 'utf8')).toBe(bytes);
  });

  it('advance-backfill drops an intent whose rename never happened, and names no move', () => {
    plantStep({ advance: stepAdvance({}, INTENT) });
    expect(backfill().body).toEqual({ ok: true, op: 'advance-backfill', id: 'lane-a', created: false, why: 'present' });
    expect(laneAdvance().pending).toBeNull();
    expect(opusOf().history).toEqual([]);
    expect(classesOf('lane-a')['opus']).toBe('model-5.6-gamma');
  });

  it('an intent whose rename never happened is dropped by a commit, and leaves no history', () => {
    plantStep({ advance: stepAdvance({}, INTENT) });
    const r = commit({ canary: 'failed', reason: 'http 500: upstream error' });
    expect(r.body).toMatchObject({ outcome: 'failed', recovered: false });
    expect(r.body).not.toHaveProperty('recoveredMove');
    expect(laneAdvance().pending).toBeNull();
    expect(opusOf().history).toEqual([expect.objectContaining({ ok: false, canary: 'failed' })]);
    expect(classesOf('lane-a')['opus']).toBe('model-5.6-gamma');
  });

  it('a hand set-class cut short after its rename is settled by advance-backfill and reported as hand: no recovered mark, no advance', () => {
    // Review Focus (the crash gap, a hand set-class cut short): W1's set-class
    // writes its intent before the rename, and W1's `reconcilePending` answers
    // `recovered: true` for it as for an advance, so `advanceForWrite` reads the
    // intent's `how` before it settles it (D-5216).
    plantStep({ advance: stepAdvance({}, HAND_INTENT) });
    fs.writeFileSync(regPath('lane-a'), HAND_REGISTRY);
    const r = backfill();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toEqual({ ok: true, op: 'advance-backfill', id: 'lane-a', created: false, why: 'present',
      recoveredMove: HAND_MOVE });
    const fable = laneAdvance().classes.fable;
    expect(laneAdvance().pending).toBeNull();
    expect(fable.history).toEqual([HAND_ENTRY]);
    expect([fable.family, fable.previous]).toEqual(['delta', null]);
  });

  it('a commit that settles a landed hand intent reports it as hand, recovered false, and still moves its own class', () => {
    plantStep({ advance: stepAdvance({}, HAND_INTENT) });
    fs.writeFileSync(regPath('lane-a'), HAND_REGISTRY);
    const r = commit();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toMatchObject({ outcome: 'moved', push: true, recovered: false, recoveredMove: HAND_MOVE });
    expect(laneAdvance().pending).toBeNull();
    expect(laneAdvance().classes.fable.history).toEqual([HAND_ENTRY]);
    expect(opusOf().history).toEqual([expect.objectContaining({ how: 'advance', to: 'model-6.1-gamma', ok: true })]);
  });

  /** revert's own entry, after the recovered one, when the revert undoes that very move. */
  const REVERT_ENTRY = { at: NOW, how: 'revert', from: 'model-6.1-gamma', to: 'model-5.6-gamma', ok: true,
    canary: 'not-run', effort: { from: 'xhigh', to: 'max' } };
  it.each([
    ['hold', ['hold', '--class', 'sonnet'], [RECOVERED_ENTRY]],
    ['release', ['release', '--class', 'sonnet'], [RECOVERED_ENTRY]],
    ['revert', ['revert', '--class', 'opus'], [RECOVERED_ENTRY, REVERT_ENTRY]],
    ['a hand set-class', ['set-class', '--class', 'fable', '--model', 'model-6-delta'], [RECOVERED_ENTRY]],
  ] as [string, string[], unknown[]][])('%s run first after a crashed automatic advance records that move once and names it in its answer', (_w, argv, history) => {
    // Review Focus (the crash gap): the lane's next locked writer may be a hand
    // verb rather than the hourly step, and it settles the landed intent in its
    // own write, as every writer does. So its answer names the move too
    // (D-6067): the intent is gone from disk after this, and no later writer
    // could report it. The class's WHOLE history pins "recorded exactly once".
    plantStep({ advance: stepAdvance({}, INTENT) });
    fs.writeFileSync(regPath('lane-a'), MOVED_REGISTRY);
    const [verb, ...args] = argv;
    const r = opEnv({ CCRC_MODELS_NOW: NOW }, verb!, '--file', rosterPath(), '--id', 'lane-a', ...args);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body['recoveredMove']).toEqual(RECOVERED);
    expect(laneAdvance().pending).toBeNull();
    expect(opusOf().history).toEqual(history);
    expect(backfill().body).not.toHaveProperty('recoveredMove');
  });

  it.each([
    ['hold, after an intent that never landed', ['hold', '--class', 'sonnet'], true],
    ['release, after an intent that never landed', ['release', '--class', 'sonnet'], true],
    ['a hand set-class, after an intent that never landed', ['set-class', '--class', 'fable', '--model', 'model-6-delta'],
      true],
    ['revert, with no intent at all', ['revert', '--class', 'opus'], false],
  ] as [string, string[], boolean][])('%s names no recovered move', (_w, argv, dropped) => {
    if (dropped) {
      plantStep({ advance: stepAdvance({}, INTENT) });   // the registry still pins `from`: the rename never happened
    } else {
      plantStep({ advance: stepAdvance({ opus: { previous: { model: 'model-5.6-gamma', effort: 'max' } } }) });
      fs.writeFileSync(regPath('lane-a'), MOVED_REGISTRY);
    }
    const [verb, ...args] = argv;
    const r = opEnv({ CCRC_MODELS_NOW: NOW }, verb!, '--file', rosterPath(), '--id', 'lane-a', ...args);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).not.toHaveProperty('recoveredMove');
    expect(laneAdvance().pending).toBeNull();
    expect(opusOf().history.filter((e) => e.how === 'advance')).toEqual([]);
  });

  it('a hand set-class whose own intent cannot be written names no recovered move; the next writer names it once', () => {
    // Its intent write is refused (a clock not of the file's form), so that write
    // recorded nothing, the crashed advance's intent included: it is still on
    // disk, and the next locked writer reports it. Naming it here too would
    // report one move twice.
    plantStep({ advance: stepAdvance({}, INTENT) });
    fs.writeFileSync(regPath('lane-a'), MOVED_REGISTRY);
    const r = opEnv({ CCRC_MODELS_NOW: 'yesterday' }, 'set-class', '--file', rosterPath(), '--id', 'lane-a',
      '--class', 'fable', '--model', 'model-6-delta');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(String(r.body['advanceNote'])).toMatch(/^advance-invalid: /);
    expect(r.body).not.toHaveProperty('recoveredMove');
    expect(laneAdvance().pending).toEqual(INTENT);
    expect(backfill().body['recoveredMove']).toEqual(RECOVERED);
  });

  /** The op copied with some lines replaced so that a real write fails (the idiom of the set-class registry-write
   *  case above), then run with `argv` on lane-a: every other byte is the op as it is. */
  const through = (edits: [string, string][], argv: string[]): Result => {
    let src = fs.readFileSync(OP, 'utf8');
    for (const [line, instead] of edits) {
      expect(src.split(line), `the op has the line ${line}`).toHaveLength(2);
      src = src.replace(line, instead);
    }
    const copy = path.join(home, 'models-op-copy.mjs');
    fs.writeFileSync(copy, src.replaceAll("from '../shared/", `from '${pathToFileURL(path.join(REPO, 'shared')).href}/`));
    const [verb, ...args] = argv;
    const r = spawnSync(process.execPath, [copy, verb!, '--file', rosterPath(), '--id', 'lane-a', ...args],
      { env: { ...process.env, HOME: home, CCRC_MODELS_NOW: NOW }, encoding: 'utf8' });
    const stdout = r.stdout ?? '';
    expect(stdout.split('\n'), `stdout is not one JSON line: ${JSON.stringify(stdout)}`).toHaveLength(2);
    return { code: r.status ?? -1, body: JSON.parse(stdout.split('\n')[0]!), stderr: r.stderr ?? '', stdout };
  };
  /** `writeRegistry` aimed under the registry FILE, so its mkdir fails: the one registry write a copy can refuse. */
  const REGISTRY_FAILS: [string, string] = ["return writeJsonFile(registryPath(id), registry, 'registry-unwritable');",
    "return writeJsonFile(path.join(registryPath(id), 'x'), registry, 'registry-unwritable');"];

  it.each([
    ['revert, its materialise failing', ['revert', '--class', 'opus'], 'materialise'],
    ['revert, its registry write failing', ['revert', '--class', 'opus'], 'registry'],
    ['a hand set-class, its materialise failing', ['set-class', '--class', 'fable', '--model', 'model-6-delta'],
      'materialise'],
    ['a hand set-class, its registry write failing', ['set-class', '--class', 'fable', '--model', 'model-6-delta'],
      'registry'],
  ] as [string, string[], string][])('%s after its first write still names the recovered move that write recorded (D-6067)', (_w, argv, fault) => {
    // The first write (revert's hold, set-class's intent) recorded the crashed
    // advance; the refusal that follows is the only answer this verb gives, so
    // it carries the move, or no answer ever would.
    plantStep({ advance: stepAdvance({}, INTENT) });
    fs.writeFileSync(regPath('lane-a'), MOVED_REGISTRY);
    let r: Result;
    if (fault === 'materialise') {
      const tsv = path.join(home, '.ccrc', 'models', 'lane-a.classes.tsv');
      fs.rmSync(tsv);
      fs.mkdirSync(tsv);
      const [verb, ...args] = argv;
      r = opEnv({ CCRC_MODELS_NOW: NOW }, verb!, '--file', rosterPath(), '--id', 'lane-a', ...args);
    } else {
      r = through([REGISTRY_FAILS], argv);
    }
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(r.body).toMatchObject({ ok: false, error: fault === 'materialise' ? 'materialise-failed' : 'registry-unwritable',
      recoveredMove: RECOVERED });
    expect(opusOf().history[0]).toEqual(RECOVERED_ENTRY);
    expect(laneAdvance().pending).not.toEqual(INTENT);
  });

  it('a commit whose failure record cannot be written after its intent write names the move that intent write recorded', () => {
    // A copy whose registry write fails (so the commit records a failed move)
    // and whose advance-file write fails once `pending` is cleared: the intent
    // write, step 6, recorded the crashed advance, and the refusal that follows
    // is this commit's only answer.
    plantStep({ advance: stepAdvance({ fable: { family: 'delta' } }, INTENT) });
    fs.writeFileSync(regPath('lane-a'), MOVED_REGISTRY);
    const r = through([REGISTRY_FAILS, ["  return writeJsonFile(advancePath(id), parsed, 'advance-unwritable');",
      "  return parsed.pending === null ? ['advance-unwritable', 'this copy refuses the write.']\n"
      + "    : writeJsonFile(advancePath(id), parsed, 'advance-unwritable');"]],
    ['advance-commit', '--class', 'fable', '--from', 'none', '--to', 'model-6-delta', '--canary', 'passed']);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(r.body).toMatchObject({ ok: false, error: 'advance-unwritable', recoveredMove: RECOVERED });
    expect(opusOf().history).toEqual([RECOVERED_ENTRY]);
    expect(laneAdvance().pending).toMatchObject({ class: 'fable', from: null, to: 'model-6-delta' });
  });

  it('a commit whose first write fails names no recovered move: the intent is still on disk for the next writer', () => {
    plantStep({ advance: stepAdvance({}, INTENT) });
    fs.writeFileSync(regPath('lane-a'), MOVED_REGISTRY);
    const r = commit({ cls: 'fable', from: 'none', to: 'model-6-delta', canary: 'failed', reason: 'http 500',
      now: 'yesterday' });
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(r.body).toMatchObject({ ok: false, error: 'advance-invalid' });
    expect(r.body).not.toHaveProperty('recoveredMove');
    expect(laneAdvance().pending).toEqual(INTENT);
    expect(backfill().body['recoveredMove']).toEqual(RECOVERED);
  });

  it('an abandoned commit still writes back an intent it reconciled, and nothing else', () => {
    plantStep({ advance: stepAdvance({ opus: { hold: HOLD } }, { class: 'haiku', from: 'model-5.6-alpha',
      to: 'model-6-alpha', effortFrom: 'high', effortTo: 'high', at: '2026-10-22T09:05:11Z' }) });
    const reg = fs.readFileSync(regPath('lane-a'), 'utf8');
    const r = commit();
    expect(r.body).toMatchObject({ outcome: 'abandoned', why: 'held', recovered: true });
    expect(laneAdvance().pending).toBeNull();
    expect(laneAdvance().classes.haiku.history).toEqual([expect.objectContaining({ ok: true, recovered: true })]);
    expect(fs.readFileSync(regPath('lane-a'), 'utf8')).toBe(reg);
  });

  it('a stale catalogue abandons only after the pending intent is settled (skeleton §3.3: step 2 before step 3)', () => {
    plantStep({ advance: stepAdvance({}, INTENT) });
    fs.writeFileSync(regPath('lane-a'), MOVED_REGISTRY);
    writeCatalogue('lane-a', { ...STEP_CATALOGUE, stale: true });
    const r = commit({ from: 'model-6.1-gamma', to: 'model-6.2-gamma' });
    expect(r.body).toMatchObject({ outcome: 'abandoned', why: 'catalogue-stale', recovered: true, recoveredMove: RECOVERED });
    expect(laneAdvance().pending).toBeNull();
    expect(opusOf().history).toEqual([expect.objectContaining({ ok: true, recovered: true })]);
  });

  it('the intent is written before the registry is renamed, in source', () => {
    // The crash gap's ORDER has no fixture that can stop the op between two
    // writes, so it is pinned where it lives.
    const body = commitSource();
    const intent = body.indexOf('writeAdvance(a.id, { ...adv, pending: intent })');
    const rename = body.indexOf('writeRegistry(a.id, validated)');
    expect(intent).toBeGreaterThan(0);
    expect(rename).toBeGreaterThan(intent);
  });

  /** The op's own arguments for the opus move every commit case here plans. */
  const OPUS_MOVE = ['advance-commit', '--class', 'opus', '--from', 'model-5.6-gamma', '--to', 'model-6.1-gamma',
    '--canary', 'passed'];
  /** The intent that move writes at step 6, under this file's clock. */
  const OPUS_INTENT = { ...INTENT, at: NOW };

  it('a move whose previous registry cannot be written back records the failure, restored false, and keeps the intent (D-5217)', () => {
    // A copy whose write-back of the previous registry, and only that write,
    // is aimed under the registry FILE, so its mkdir fails: the rename before
    // it lands, and the materialise between them fails on its own (the tsv a
    // directory). The registry still pins `--to`, so the intent is kept for
    // the next locked writer, which records the move as landed.
    plantStep();
    const tsv = path.join(home, '.ccrc', 'models', 'lane-a.classes.tsv');
    fs.rmSync(tsv);
    fs.mkdirSync(tsv);
    const r = through([["    const back = writeRegistry(a.id, registry);\n    if (back !== null) {\n      // The registry",
      "    const back = writeJsonFile(path.join(registryPath(a.id), 'x'), registry, 'registry-unwritable');\n"
      + '    if (back !== null) {\n      // The registry']], OPUS_MOVE);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toMatchObject({ ok: true, outcome: 'failed', restored: false, push: true, recovered: false });
    expect(String(r.body['reason'])).toMatch(
      /^materialise failed \(materialise-failed\) and the previous registry could not be written back \(registry-unwritable\): /);
    expect(classesOf('lane-a')['opus']).toBe('model-6.1-gamma');
    expect(laneAdvance().pending).toEqual(OPUS_INTENT);
    expect(opusOf().history).toEqual([expect.objectContaining({
      how: 'advance', from: 'model-5.6-gamma', to: 'model-6.1-gamma', ok: false, canary: 'passed' })]);
    expect(backfill().body['recoveredMove']).toEqual(RECOVERED);
    expect(laneAdvance().pending).toBeNull();
  });

  it('a move whose final history write fails still answers moved with a push, keeps the intent, and the next writer reports it again (D-6067)', () => {
    // The double report D-6067's cost accepts: the receipt pushes this move
    // now, and the next locked writer settles the kept intent as a recovered
    // advance, which is pushed again. A copy fails that one final write only:
    // it is aimed under the advance FILE, so its mkdir fails.
    plantStep();
    const r = through([['  w = writeAdvance(a.id, adv);\n  // A history',
      "  w = writeJsonFile(path.join(advancePath(a.id), 'x'), adv, 'advance-unwritable');\n  // A history"]], OPUS_MOVE);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toMatchObject({ ok: true, outcome: 'moved', push: true, recovered: false,
      reason: 'moved, but its history could not be written (advance-unwritable)' });
    expect(r.body).not.toHaveProperty('recoveredMove');
    expect(classesOf('lane-a')['opus']).toBe('model-6.1-gamma');
    expect(env()['ANTHROPIC_DEFAULT_OPUS_MODEL']).toBe('model-6.1-gamma');
    expect(laneAdvance().pending).toEqual(OPUS_INTENT);
    expect(opusOf().history).toEqual([]);
    const next = backfill();
    expect(next.code, next.stdout + next.stderr).toBe(0);
    expect(next.body['recoveredMove']).toEqual(RECOVERED);
    expect(laneAdvance().pending).toBeNull();
    expect(opusOf().history).toEqual([{ ...RECOVERED_ENTRY, at: NOW }]);
    expect(opusOf().previous).toEqual({ model: 'model-5.6-gamma', effort: 'max' });
  });

  it('moving to a model with no measured window drops the lane to the default window rule', () => {
    plantStep();
    plantWindows('lane-a', windowsFor({ 'model-6-alpha': 400000, 'model-6-beta': 400000, 'model-5.6-gamma': 400000 }));
    expect(op('materialise', '--file', rosterPath(), '--id', 'lane-a').code).toBe(0);
    expect(env()['CLAUDE_CODE_MAX_CONTEXT_TOKENS']).toBe('400000');
    expect(commit().body['outcome']).toBe('moved');
    const next = parseRegistry(registryOf('lane-a'));
    const cat = parseCatalogue(STEP_CATALOGUE);
    const windows = parseWindows(JSON.parse(fs.readFileSync(winPath('lane-a'), 'utf8')));
    expect(contextWindowFor(next, cat, windows).rule).toBe('default');
    expect(env()).toMatchObject(modelEnvBlock(next, cat, windows));
    expect(env()['CLAUDE_CODE_MAX_CONTEXT_TOKENS']).toBe('200000');
  });

  it('moving to a model already measured keeps the measured rule, so the move passes the windows on', () => {
    plantStep();
    plantWindows('lane-a', windowsFor({ 'model-6-alpha': 400000, 'model-6-beta': 400000, 'model-5.6-gamma': 400000,
      'model-6.1-gamma': 300000 }));
    expect(commit().body['outcome']).toBe('moved');
    expect(env()['CLAUDE_CODE_MAX_CONTEXT_TOKENS']).toBe('300000');
  });

  it('an absent advance file is backfilled in memory, and the commit writes it', () => {
    plantStep({ advance: null });
    expect(commit().body['outcome']).toBe('moved');
    const adv = laneAdvance();
    expect(adv.classes.haiku.family).toBe('alpha');
    expect(typeof adv.classes.fable.family).toBe('string');
    expect(adv.classes.opus.history).toHaveLength(1);
  });

  it('the moved registry is still what an older parser reads: known keys only, in writeRegistry\'s own bytes', () => {
    plantStep();
    expect(commit().body['outcome']).toBe('moved');
    const keys = /const REGISTRY_KEYS = \[([^\]]*)\];/.exec(fs.readFileSync(path.join(REPO, 'shared', 'models.mjs'), 'utf8'));
    expect(keys, 'shared/models.mjs has no REGISTRY_KEYS literal').not.toBeNull();
    const known = keys![1]!.split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter((s) => s !== '');
    const text = fs.readFileSync(regPath('lane-a'), 'utf8');
    const json = JSON.parse(text) as Record<string, unknown>;
    for (const k of Object.keys(json)) expect(known).toContain(k);
    expect(text).toBe(`${JSON.stringify(parseRegistry(json), null, 2)}\n`);
  });

  it.each([
    ['a class that is not one', ['--class', 'subagent'], 1, 'unknown-class'],
    ['a --canary that is neither passed nor failed', ['--canary', 'not-ready'], 2, 'bad-argv'],
    ['a --from that is not a model id', ['--from', '../x'], 1, 'bad-model-id'],
    ['a --to that is not a model id', ['--to', 'not an id'], 1, 'bad-model-id'],
  ] as [string, string[], number, string][])('%s is refused', (_w, args, code, word) => {
    plantStep();
    const base: Record<string, string> = { '--class': 'opus', '--from': 'model-5.6-gamma', '--to': 'model-6.1-gamma',
      '--canary': 'passed' };
    base[args[0]!] = args[1]!;
    const r = opEnv({ CCRC_MODELS_NOW: NOW }, 'advance-commit', '--file', rosterPath(), '--id', 'lane-a',
      ...Object.entries(base).flat());
    expect(r.code).toBe(code);
    expect(r.body['error']).toBe(word);
  });

  it('an Anthropic lane refuses it, as it refuses every op but show', () => {
    expect(commit({ id: 'lane-c' }).body['error']).toBe('anthropic-lane');
  });
});
