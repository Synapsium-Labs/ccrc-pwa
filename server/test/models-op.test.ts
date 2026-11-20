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
import {
  backfillAdvance, chooseCandidate, familyOf, lastMoveOf, parseAdvance, recordMove, seedAnthropicAdvance, serializeAdvance,
} from '../../shared/model-advance.mjs';
import { parseAliases } from '../../shared/model-aliases.mjs';
import type { Aliases } from '../../shared/model-aliases.mjs';
import type { Advance, HistoryEntry } from '../../shared/model-advance.mjs';
import type { ModelClass, Registry } from '../../shared/models.js';
import { aliasesFileName } from '../../shared/models.mjs';
import { CLASSES, parseRegistry } from '../../shared/models.js';
// Auto-advance plan W2 (Tasks 8 and 9). Only names this file does not bind yet:
// W1 already imports `parseRegistry` and the type `Advance`.
import {
  BLOCKED_CAUSES, CANDIDATE_REASONS, REASON_MAX, causeOf, clientWindowNotice, unmeasuredMoveNotice,
} from '../../shared/model-advance.mjs';
// Auto-advance plan W3 Task 14: advance-health's bounded runs, in a process group of their own.
import { spawnSyncGroup } from './spawnGroup.js';
import type { ClassAdvance } from '../../shared/model-advance.mjs';
import { contextWindowFor, modelEnvBlock } from '../../shared/modelenv.mjs';
import { laneClassModels, parseCatalogue, parseWindows } from '../../shared/models.js';
import { readLaneModels } from '../src/laneModels.js';
import type { FleetIO } from '../src/io.js';
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
  it('lists every account that can carry a registry, and every Anthropic lane, flagged (D-8751)', () => {
    const r = op('lanes', '--file', rosterPath());
    expect(r.code).toBe(0);
    expect(r.body['lanes']).toEqual([
      { id: 'claude', configDirSuffix: '.claude', anthropic: true, hasRegistry: false,
        registryInvalid: null, catalogueInvalid: null, probe: null, baseUrl: null, windowNotices: [], ids: null },
      { id: 'claude-a', configDirSuffix: '.claude-a', anthropic: true, hasRegistry: false,
        registryInvalid: null, catalogueInvalid: null, probe: null, baseUrl: null, windowNotices: [], ids: null },
      { id: 'gpt', configDirSuffix: '.claude-gpt', anthropic: false, hasRegistry: false,
        registryInvalid: null, catalogueInvalid: null, probe: null, baseUrl: null, windowNotices: [] },
      { id: 'router', configDirSuffix: '.claude-router', anthropic: false, hasRegistry: false,
        registryInvalid: null, catalogueInvalid: null, probe: null, baseUrl: null, windowNotices: [] },
    ]);
  });

  it('reports probe and baseUrl once a registry exists', () => {
    op('init', '--file', rosterPath(), '--id', 'router', '--probe', 'compatible',
      '--base-url', 'https://api.cortecs.ai');
    const lanes = op('lanes', '--file', rosterPath()).body['lanes'] as Record<string, unknown>[];
    expect(lanes.find((l) => l['id'] === 'router')).toEqual({
      id: 'router', configDirSuffix: '.claude-router', anthropic: false,
      hasRegistry: true, registryInvalid: null, catalogueInvalid: null,
      probe: 'compatible', baseUrl: 'https://api.cortecs.ai/', // stored as the gate's url (D-7460)
      windowNotices: [],
    });
  });

  it('the upstream account is listed as an Anthropic row, never as a lane a registry can sit on (D-8751)', () => {
    const lanes = op('lanes', '--file', rosterPath()).body['lanes'] as { id: string; anthropic: boolean; hasRegistry: boolean }[];
    expect(lanes.find((l) => l.id === 'claude')).toMatchObject({ anthropic: true, hasRegistry: false });
    expect(lanes.filter((l) => l.hasRegistry)).toEqual([]);
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
    expect(registryOf('router')['baseUrl']).toBe('https://api.cortecs.ai/'); // stored as the gate's url (D-7460)
    expect(registryOf('router')['discovery']).toBe('catalogue');
  });

  it('refuses a --base-url with a user name and password by the baseUrl field, and writes nothing (D-7308)', () => {
    const r = op('init', '--file', rosterPath(), '--id', 'router', '--probe', 'compatible',
      '--base-url', 'https://u:p@compatible.example.invalid');
    expect(r.code).toBe(1);
    expect(r.body['field']).toBe('baseUrl');
    expect(fs.existsSync(regPath('router'))).toBe(false);
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

  it('CLAUDE_CODE_MAX_CONTEXT_TOKENS is the provider\'s promise, the class models\' catalogue context, and '
    + 'drops out when nothing promises one (D-8564)', () => {
    const r = op('set-class', '--file', rosterPath(), '--id', 'gpt', '--class', 'opus', '--model', 'gpt-5.6-sol');
    expect(r.code).toBe(0);
    // Every class model's catalogue context is 272000, and since D-8564 the
    // provider's promise IS the window (the 2026-09-08 rule capped it at the
    // client's 200000).
    expect(settingsOf('.claude-gpt').env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe('272000');
    // Switching the default to a model no catalogue can vouch for — the same
    // "accepts a model no catalogue can vouch for" situation as above — leaves
    // nothing to measure a window from, and the STALE '272000' must not
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
    // Fix round 1 (review): point opus at a model whose catalogue context
    // (128000) differs from every other class model's (272000), directly on
    // disk (same pattern as `writeCatalogue` below): only that model's OWN
    // context proves the number came from the catalogue this run just wrote,
    // not a literal.
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
    // amendment). gpt-5.3-codex-spark's catalogue context is 128000, the
    // smallest class model's, so this value can only have come from the fresh
    // catalogue — a mutant that hardcoded a literal reds here (§6.1, amended
    // 2026-09-08, Task 16c fix round 1; D-8564).
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
        // D-8619: `requests`, the per-request record, written only behind the lane's record-requests marker
        bridgeFiles: { stats: 'bridge.stats.json', store: 'reasoning.sqlite', recordings: 'recordings', requests: 'bridge.requests.jsonl' },
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
    // class models' catalogue context is 272000, the provider's promise
    // (D-8564).
    expect(j.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe('272000');
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

// Operator ruling 2026-11-12, option (b): on a Codex lane the security-guidance plugin's LLM reviews would POST
// Claude model ids to the bridge, which answers a local 404, so the lane's settings turn them off with
// ENABLE_CODE_SECURITY_REVIEW=0. The gate is the lane's exec.kind: `canCarryRegistry` also admits external,
// openrouter and compatible lanes, which keep the reviews (their exact-env cases elsewhere in this file are the
// negative pins), and an Anthropic lane never reaches the writer.
describe('a codex-kind lane\'s settings turn the plugin\'s LLM reviews off (operator ruling 2026-11-12, option b)', () => {
  const KEY = 'ENABLE_CODE_SECURITY_REVIEW';
  const CODEX_SUFFIX = '.claude-codex-a';
  const settingsFile = (): string => path.join(home, CODEX_SUFFIX, 'settings.json');
  const show = (): Result => op('show', '--file', rosterPath(), '--id', 'codex-a');
  const mat = (): Result => op('materialise', '--file', rosterPath(), '--id', 'codex-a');

  beforeEach(() => {
    seed({ ...ROSTER, accounts: [...ROSTER.accounts, CODEX_ROW] });
    writeCatalogue('codex-a');
    const r = op('init', '--file', rosterPath(), '--id', 'codex-a', '--probe', 'codex');
    expect(r.code, r.stdout + r.stderr).toBe(0);
  });

  it('materialise on a codex-kind lane writes ENABLE_CODE_SECURITY_REVIEW=0', () => {
    expect(mat().code).toBe(0);
    expect(settingsOf(CODEX_SUFFIX).env[KEY]).toBe('0');
  });

  it('init (its own materialise) wrote it too, with the seven model keys beside it', () => {
    const env = settingsOf(CODEX_SUFFIX).env;
    expect(env[KEY]).toBe('0');
    expect(env['ANTHROPIC_MODEL']).toBe(SEEDED.classes.opus);
  });

  it('show names the key as drift once it is deleted by hand, and a materialise restores it', () => {
    expect(show().body['settingsDrift']).toEqual([]);
    const j = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    delete j.env[KEY];
    fs.writeFileSync(settingsFile(), JSON.stringify(j, null, 2));
    expect(show().body['settingsDrift']).toEqual([KEY]);
    // `show` names the drift and never repairs it.
    expect(Object.keys(settingsOf(CODEX_SUFFIX).env)).not.toContain(KEY);
    expect(mat().code).toBe(0);
    expect(settingsOf(CODEX_SUFFIX).env[KEY]).toBe('0');
    expect(show().body['settingsDrift']).toEqual([]);
  });

  it('show names a hand-edited value of the key as drift too, and a materialise reverts it to 0', () => {
    const j = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    j.env[KEY] = '1';
    fs.writeFileSync(settingsFile(), JSON.stringify(j, null, 2));
    expect(show().body['settingsDrift']).toEqual([KEY]);
    expect(mat().code).toBe(0);
    expect(settingsOf(CODEX_SUFFIX).env[KEY]).toBe('0');
  });

  it('a lane that stops being codex-kind loses the key at its next materialise, and drifts until then', () => {
    const roster = JSON.parse(fs.readFileSync(rosterPath(), 'utf8'));
    const row = roster.accounts.find((a: { id: string }) => a.id === 'codex-a');
    row.exec = { kind: 'external', provider: 'openai' };
    fs.writeFileSync(rosterPath(), JSON.stringify(roster, null, 2));
    expect(show().body['settingsDrift']).toEqual([KEY]);
    expect(mat().code).toBe(0);
    expect(Object.keys(settingsOf(CODEX_SUFFIX).env)).not.toContain(KEY);
    expect(show().body['settingsDrift']).toEqual([]);
  });

  it('rm on a codex lane clears the key and keeps a key ccrc does not own', () => {
    const j = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    j.env['DISABLE_TELEMETRY'] = '1';
    fs.writeFileSync(settingsFile(), JSON.stringify(j, null, 2));
    expect(j.env[KEY]).toBe('0');
    const r = op('rm', '--file', rosterPath(), '--id', 'codex-a');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body['settings']).toBe('cleared');
    const after = settingsOf(CODEX_SUFFIX);
    expect(after.env['DISABLE_TELEMETRY']).toBe('1');
    expect(Object.keys(after.env)).not.toContain(KEY);
    expect(Object.keys(after.env)).not.toContain('ANTHROPIC_MODEL');
  });

  it('an external lane carrying a codex registry never gets the key (the gate)', () => {
    writeCatalogue('gpt');
    plantCodex(LEGACY_EXTERNAL_ID);
    expect(Object.keys(settingsOf('.claude-gpt').env)).not.toContain(KEY);
    expect(op('show', '--file', rosterPath(), '--id', 'gpt').body['settingsDrift']).toEqual([]);
  });

  // ccrc owns the key on every lane that carries a registry: a hand-set copy on another kind of lane is drift, and
  // the next materialise deletes it (`mergeSettingsEnv` walks `LANE_ENV_KEYS`). README says so.
  it('a hand-set copy on an external lane is drift, and its next materialise deletes it', () => {
    writeCatalogue('gpt');
    plantCodex(LEGACY_EXTERNAL_ID);
    const file = path.join(home, '.claude-gpt', 'settings.json');
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    j.env[KEY] = '0';
    fs.writeFileSync(file, JSON.stringify(j, null, 2));
    expect(op('show', '--file', rosterPath(), '--id', 'gpt').body['settingsDrift']).toEqual([KEY]);
    expect(op('materialise', '--file', rosterPath(), '--id', 'gpt').code).toBe(0);
    expect(Object.keys(settingsOf('.claude-gpt').env)).not.toContain(KEY);
  });

  // `rm` runs before the anthropic-lane gate, so it is the one verb that writes an Anthropic lane's settings:
  // it clears every key in `LANE_ENV_KEYS`, a hand-set copy of this one included, and nothing else.
  it('rm on an Anthropic lane clears a hand-set copy of the key and keeps a key ccrc does not own', () => {
    const dir = path.join(home, '.claude-a');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'settings.json'),
      JSON.stringify({ env: { DISABLE_TELEMETRY: '1', [KEY]: '0' } }, null, 2));
    const r = op('rm', '--file', rosterPath(), '--id', 'claude-a');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body['settings']).toBe('cleared');
    expect(settingsOf('.claude-a').env).toEqual({ DISABLE_TELEMETRY: '1' });
  });

  it('an Anthropic lane is still refused anthropic-lane, and its settings.json is byte-identical', () => {
    const dir = path.join(home, '.claude-a');
    fs.mkdirSync(dir, { recursive: true });
    const bytes = '{\n  "env": {\n    "DISABLE_TELEMETRY": "1"\n  }\n}\n';
    fs.writeFileSync(path.join(dir, 'settings.json'), bytes);
    const r = op('materialise', '--file', rosterPath(), '--id', 'claude-a');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('anthropic-lane');
    expect(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).toBe(bytes);
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

  it('one class model unmeasured: it counts at its provider default, 272000 (D-8564)', () => {
    const [m0, m1] = CLASS_MODELS as [string, string];
    plantWindows(ID, windowsFor({ [m0]: 511000, [m1]: 511000 }));
    expect(mat().code).toBe(0);
    expect(eighthKey()).toBe('272000');
  });

  it('with no windows file the env block is today\'s, every key', () => {
    const { haiku, sonnet, opus } = SEEDED.classes;
    expect(mat().code).toBe(0);
    expect(settingsOf(LEGACY_SUFFIX).env).toEqual({
      ANTHROPIC_DEFAULT_HAIKU_MODEL: haiku, ANTHROPIC_DEFAULT_SONNET_MODEL: sonnet,
      ANTHROPIC_DEFAULT_OPUS_MODEL: opus, ANTHROPIC_DEFAULT_FABLE_MODEL: 'ccrc-unavailable-fable',
      ANTHROPIC_MODEL: opus, ANTHROPIC_SMALL_FAST_MODEL: haiku, CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet',
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: '272000',
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
    expect(eighthKey()).toBe('272000');
  });

  it('show reports each measured window, the effective window, its rule and the unmeasured models', () => {
    const [m0, m1, m2] = CLASS_MODELS as [string, string, string];
    plantWindows(ID, { windows: { [m0]: { tokens: 511000, setAt: '2026-10-15T12:00:00.000Z' }, [m1]: { tokens: 450000 } } });
    const r = show();
    expect(r.code).toBe(0);
    expect(r.body['windows']).toEqual({ state: 'ok', byModel: {
      [m0]: { tokens: 511000, setAt: '2026-10-15T12:00:00.000Z' }, [m1]: { tokens: 450000, setAt: null } } });
    expect(r.body['contextWindow'])
      .toEqual({ tokens: 272000, rule: 'default', unmeasured: [m2], model: m2, source: 'provider' });
  });

  // The whole-wave fix round of codex bridge Stage 2 (L3): a window a refusal lowered carries `source` and
  // `refusedTokensEstimate` in the windows file, and `show` reports them, each only when the entry holds it in its
  // shape (additive: an entry without them reports as before).
  it('show reports a lowered window\'s source and refusedTokensEstimate, and only when the entry carries them', () => {
    const [m0, m1, m2] = CLASS_MODELS as [string, string, string];
    plantWindows(ID, { windows: {
      [m0]: { tokens: 342000, setAt: '2026-10-24T09:00:00.000Z', source: 'refusal', refusedTokensEstimate: 380000 },
      [m1]: { tokens: 450000 },
      [m2]: { tokens: 400000, setAt: '2026-10-15T12:00:00.000Z', source: 7, refusedTokensEstimate: 'many' },
    } });
    const r = show();
    expect(r.code).toBe(0);
    expect(r.body['windows']).toEqual({ state: 'ok', byModel: {
      [m0]: { tokens: 342000, setAt: '2026-10-24T09:00:00.000Z', source: 'refusal', refusedTokensEstimate: 380000 },
      [m1]: { tokens: 450000, setAt: null },
      [m2]: { tokens: 400000, setAt: '2026-10-15T12:00:00.000Z' } } });
  });

  it('show with every class model measured reports rule measured', () => {
    plantWindows(ID, all(400000));
    expect(show().body['contextWindow'])
      .toEqual({ tokens: 400000, rule: 'measured', unmeasured: [], model: CLASS_MODELS[0], source: 'measured' });
  });

  it('show with no windows file: state absent, every class model unmeasured', () => {
    const r = show();
    expect(r.body['windows']).toEqual({ state: 'absent' });
    expect(r.body['contextWindow']).toEqual({ tokens: 272000, rule: 'default', unmeasured: CLASS_MODELS,
      model: CLASS_MODELS[0], source: 'provider' });
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
    expect(r.body['contextWindow']).toEqual({ tokens: null, rule: 'none', unmeasured: [], model: null, source: null });
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
    expect(eighthKey()).toBe('272000');
    // `rm -f` semantics per file, as for the other four: a directory is not a
    // file `rm` may unlink, so it reaps the four before it and stops there,
    // the answer a directory at any of those four paths already gets.
    const r = op('rm', '--file', rosterPath(), '--id', ID);
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('unwritable');
    expect(String(r.body['detail'])).toContain(`${winPath(ID)} could not be removed`);
    expect(fs.existsSync(regPath(ID))).toBe(false);
  });

  it('a class that moves to an unmeasured model takes that model\'s provider default (spec §5; D-8564)', () => {
    plantWindows(ID, all(400000));
    expect(mat().code).toBe(0);
    expect(eighthKey()).toBe('400000');
    const next = CODEX.models.find((m) => !m.hidden && !CLASS_MODELS.includes(m.id) && m.context === 272000)!.id;
    const r = op('set-class', '--file', rosterPath(), '--id', ID, '--class', 'opus', '--model', next);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(eighthKey()).toBe('272000');
    expect(r.body['contextWindow'])
      .toEqual({ tokens: 272000, rule: 'default', unmeasured: [next], model: next, source: 'provider' });
  });

  // The mutation tail and init's create each pass the windows reading to
  // `materialise` (Task 3: the same reading to every caller). A tail or a
  // create that passed null would write the provider's 272000 over a lane
  // every one of whose class models is measured.
  it('a mutation that leaves the classes alone still writes the measured window (the tail passes the reading)', () => {
    plantWindows(ID, all(400000));
    expect(eighthKey()).toBe('272000');
    const r = op('set-effort', '--file', rosterPath(), '--id', ID, '--class', 'sonnet', '--level', 'xhigh');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(eighthKey()).toBe('400000');
    expect(r.body['contextWindow'])
      .toEqual({ tokens: 400000, rule: 'measured', unmeasured: [], model: CLASS_MODELS[0], source: 'measured' });
  });

  it('init applies a windows file already on disk: the lane it creates is materialised with the measured window', () => {
    seed({ ...ROSTER, accounts: [...ROSTER.accounts, CODEX_ROW] });
    writeCatalogue(CODEX_ROW.id);
    plantWindows(CODEX_ROW.id, all(400000));
    const r = op('init', '--file', rosterPath(), '--id', CODEX_ROW.id, '--probe', 'codex');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body['created']).toBe(true);
    expect(settingsOf(CODEX_ROW.configDirSuffix).env['CLAUDE_CODE_MAX_CONTEXT_TOKENS']).toBe('400000');
    expect(r.body['contextWindow'])
      .toEqual({ tokens: 400000, rule: 'measured', unmeasured: [], model: CLASS_MODELS[0], source: 'measured' });
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
    expect(eighthKey()).toBe('272000');
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
    // Two class models are still unmeasured, so their provider default (272000)
    // is still the smallest window.
    expect(eighthKey()).toBe('272000');
    expect(r.body['contextWindow']).toEqual({ tokens: 272000, rule: 'default',
      unmeasured: CLASS_MODELS.filter((m) => m !== OPUS), model: CLASS_MODELS[0], source: 'provider' });
  });

  it('the LAST class model measured flips the lane to the smallest window, in that same call', () => {
    const [m0, m1, m2] = CLASS_MODELS as [string, string, string];
    expect(setWindow(m0, '511000').code).toBe(0);
    expect(setWindow(m1, '450000').code).toBe(0);
    expect(eighthKey()).toBe('272000');
    const r = setWindow(m2, '400000');
    expect(r.code).toBe(0);
    expect(eighthKey()).toBe('400000');
    expect(r.body['contextWindow'])
      .toEqual({ tokens: 400000, rule: 'measured', unmeasured: [], model: m2, source: 'measured' });
    expect(r.body['settingsDrift']).toEqual([]);
  });

  it('set-window again replaces the value and answers the previous one', () => {
    expect(setWindow(OPUS, '400000').code).toBe(0);
    const r = setWindow(OPUS, '350000');
    expect(r.body).toMatchObject({ tokens: 350000, previous: 400000 });
    expect(windowsFile().windows[OPUS]!['tokens']).toBe(350000);
  });

  it.each(['1000', '872000'])('accepts the bound %s exactly (872000: the catalogue\'s maxContext)', (tokens) => {
    expect(setWindow(OPUS, tokens).code).toBe(0);
  });

  it('accepts WINDOW_MAX where no catalogue names a ceiling for the model', () => {
    fs.rmSync(path.join(home, '.ccrc', 'models', `${ID}.json`));
    expect(setWindow(OPUS, '1000000').code).toBe(0);
  });

  // D-8564: a measured window may never exceed the provider's own ceiling, the
  // catalogue's maxContext for the model (`windowCeiling`, shared/modelenv.mjs).
  it('refuses a window above the catalogue\'s maxContext for the model, naming it, and writes nothing', () => {
    const r = setWindow(OPUS, '872001');
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('above-max-context');
    expect(r.body['field']).toBe('tokens');
    expect(String(r.body['detail'])).toContain(`${OPUS}'s maxContext is 872000`);
    expect(fs.existsSync(winPath(ID))).toBe(false);
  });

  it('a STALE catalogue\'s maxContext still bounds set-window: a ceiling only ever lowers', () => {
    writeCatalogue(ID, CODEX_STALE);
    expect(setWindow(OPUS, '900000').body['error']).toBe('above-max-context');
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

  it('clear-window drops one entry and re-materialises: one class model unmeasured takes its provider default', () => {
    for (const m of CLASS_MODELS) expect(setWindow(m, '400000').code).toBe(0);
    expect(eighthKey()).toBe('400000');
    const r = clearWindow(OPUS);
    expect(r.body).toMatchObject({ removed: true });
    expect(eighthKey()).toBe('272000');
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
    expect(r.body['contextWindow'])
      .toEqual({ tokens: 400000, rule: 'measured', unmeasured: [], model: CLASS_MODELS[0], source: 'measured' });
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

  // Model-class Anthropic arm A2.3: an Anthropic lane has its own path for these three (and `aliases-refresh`), so
  // they are no longer refused as `anthropic-lane`; every other op still is (`an anthropic lane: ...` block).
  it.each([['set-subagent']])('%s is still refused on an Anthropic lane, as every op but show and the four it admits is', (v) => {
    const r = opEnv({ CCRC_MODELS_NOW: NOW }, v, '--file', rosterPath(), '--id', ROSTER.accounts[1]!.id, '--class', 'haiku');
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
    expect(r.body['advance']).toEqual({ state: 'ok', classes: adv.classes, pending: adv.pending });
  });
});

// Auto-advance plan W4a (R3, D-8686, D-8693): `show` names each class's model and label itself (`labels`, from
// `laneClassModels`), because the server's `models` op path receives no catalogue to derive them from, and its
// `advance` carries the file's pending intent, so a reader tells this answer from an older `ccrc`'s (D-5228).
describe('show carries labels and the pending intent (R3, D-8686)', () => {
  it("on a seeded codex lane, show's labels are laneClassModels(registry, catalogue)", () => {
    plantAdv(LEGACY_EXTERNAL_ID);
    const r = op('show', '--file', rosterPath(), '--id', LEGACY_EXTERNAL_ID);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body['labels']).toEqual(laneClassModels(parseRegistry(ADV_REGISTRY), parseCatalogue(ADV_CATALOGUE)));
    expect(Object.values(r.body['labels'] as Record<string, { label: unknown }>).some((row) => row.label !== null)).toBe(true);
  });

  it("an orphan's show carries labels too", () => {
    writeCatalogue('ghost', ADV_CATALOGUE);
    fs.writeFileSync(regPath('ghost'), `${JSON.stringify(ADV_REGISTRY, null, 2)}\n`, { mode: 0o600 });
    const r = op('show', '--file', rosterPath(), '--id', 'ghost');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body['orphan']).toBe(true);
    expect(r.body['labels']).toEqual(laneClassModels(parseRegistry(ADV_REGISTRY), parseCatalogue(ADV_CATALOGUE)));
  });

  it('a lane whose advance file holds a pending intent shows it under advance.pending', () => {
    plantAdv(LEGACY_EXTERNAL_ID);
    const adv = backfillAdvance({ registry: ADV_REGISTRY, seedFamilies: CODEX_SEEDS });
    const cls = (Object.keys(ADV_REGISTRY.classes) as ModelClass[]).find((c) => ADV_REGISTRY.classes[c] !== null)!;
    const pending = { class: cls, from: ADV_REGISTRY.classes[cls], to: 'model-9.9-gamma', effortFrom: null, effortTo: null, at: NOW };
    plantAdvance(LEGACY_EXTERNAL_ID, { ...adv, pending });
    const r = op('show', '--file', rosterPath(), '--id', LEGACY_EXTERNAL_ID);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((r.body['advance'] as Record<string, unknown>)['pending']).toEqual(pending);
    expect((r.body['advance'] as Record<string, unknown>)['state']).toBe('ok');
  });

  // The producer-consumer contract: the real verb's stdout, read by the server's one reader (`readShowAnswer`, behind
  // `readLaneModels`) through a stub `io.models`, gives the files path's classes and an `ok` advance state. A drift in
  // either half (a dropped `pending`, a renamed key) reds here, not only in its own half's pin.
  it("show's real stdout, read by readLaneModels, gives the lane's classes and an ok advance", async () => {
    plantAdv(LEGACY_EXTERNAL_ID);
    const adv = backfillAdvance({ registry: ADV_REGISTRY, seedFamilies: CODEX_SEEDS });
    const cls = (Object.keys(ADV_REGISTRY.classes) as ModelClass[]).find((c) => ADV_REGISTRY.classes[c] !== null)!;
    const pending = { class: cls, from: ADV_REGISTRY.classes[cls], to: 'model-9.9-gamma', effortFrom: null, effortTo: null, at: NOW };
    plantAdvance(LEGACY_EXTERNAL_ID, { ...adv, pending });
    const r = op('show', '--file', rosterPath(), '--id', LEGACY_EXTERNAL_ID);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const io = {
      models: async () => ({ kind: 'exited', code: r.code, stdout: r.stdout }),
      readFileMeasured: async () => { throw new Error('the op path reads no file'); },
    } as unknown as FleetIO;
    const got = await readLaneModels(io, path.join(home, '.ccrc'), LEGACY_EXTERNAL_ID);
    expect(got.kind).toBe('read');
    if (got.kind !== 'read') return;
    expect(got.classes).toEqual(laneClassModels(parseRegistry(ADV_REGISTRY), parseCatalogue(ADV_CATALOGUE)));
    expect(got.advance?.state).toBe('ok');
    expect(got.advance?.pending).toEqual(pending);
  });

  it("an Anthropic lane's labels is null", () => {
    const r = op('show', '--file', rosterPath(), '--id', ROSTER.accounts[0]!.id);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body['anthropic']).toBe(true);
    expect(r.body['labels']).toBeNull();
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
      ok: true, canary: 'passed', effort: { from: 'max', to: 'xhigh' }, cause: 'newer' }]);
  });

  // D-8384: the entry records WHY the class moved, the candidate's own reason, so a retirement to an OLDER model
  // reads differently from an advance. One case per reason `chooseCandidate` computes.
  it.each([
    ['newer', (): void => plantStep(), {}, 'opus', 'model-6.1-gamma'],
    ['retired', (): void => plantStep({
      registry: { ...STEP_REGISTRY, classes: { ...STEP_REGISTRY.classes, opus: 'model-6.1-gamma' },
        effort: { ...STEP_REGISTRY.effort, opus: 'xhigh' } },
      catalogue: { ...STEP_CATALOGUE, models: STEP_CATALOGUE.models.filter((m) => m.id !== 'model-6.1-gamma') },
    }), { from: 'model-6.1-gamma', to: 'model-5.6-gamma' }, 'opus', 'model-5.6-gamma'],
    ['empty', (): void => plantStep({ advance: stepAdvance({ fable: { family: 'delta' } }) }),
      { cls: 'fable', from: 'none', to: 'model-6-delta' }, 'fable', 'model-6-delta'],
  ] as [string, () => void, { cls?: string; from?: string; to?: string }, 'opus' | 'fable', string][])(
    'a move the family rule chose as %s records that word as its history entry\'s cause (D-8384)', (cause, plant, args, cls, to) => {
    plant();
    const r = commit(args);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body['outcome']).toBe('moved');
    const h = laneAdvance().classes[cls].history;
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ how: 'advance', to, ok: true, cause });
    expect(causeOf(h[0]!)).toBe(cause);
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
  const OPUS_INTENT = { ...INTENT, at: NOW, cause: 'newer' };

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
    // D-8384: the kept intent carried the candidate's reason, so the recovered entry says why it moved too.
    expect(opusOf().history).toEqual([{ ...RECOVERED_ENTRY, at: NOW, cause: 'newer' }]);
    expect(opusOf().previous).toEqual({ model: 'model-5.6-gamma', effort: 'max' });
  });

  it('moving to a model with no measured window takes that model\'s provider default (D-8564)', () => {
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
    expect(env()['CLAUDE_CODE_MAX_CONTEXT_TOKENS']).toBe('272000');
    // D-8384 (public issue #2607): `show` says so, in the one spelling doctor's models row prints.
    const shown = op('show', '--file', rosterPath(), '--id', 'lane-a');
    expect(shown.body['windowNotices']).toEqual([unmeasuredMoveNotice('lane-a', { class: 'opus',
      from: 'model-5.6-gamma', to: 'model-6.1-gamma', fromTokens: 400000, how: 'advance', cause: 'newer' }, 272000)]);
    expect(shown.body['windowNotices']).toEqual(["lane-a's opus class moved from model-5.6-gamma to model-6.1-gamma "
      + '(auto-advance to a newer model), and model-6.1-gamma has no measured window while model-5.6-gamma had 400000 '
      + 'tokens, so every session on the lane now runs at 272000 tokens; measure model-6.1-gamma, '
      + 'then: ccrc models lane-a set-window model-6.1-gamma <tokens>']);
    // …and `lanes` carries the same sentences for every lane in one call, which is how doctor asks.
    const lanes = op('lanes', '--file', rosterPath()).body['lanes'] as Record<string, unknown>[];
    expect(lanes.find((l) => l['id'] === 'lane-a')!['windowNotices']).toEqual(shown.body['windowNotices']);
  });

  it('moving to an unmeasured model whose provider promise is at least the old measured window warns of nothing (D-8564)', () => {
    // The live shape that prompted the ruling: every other class measured at 400000, opus advanced to a model the
    // catalogue promises 500000 for. The lane stays at 400000, so `show`, `lanes` (and doctor's models row) are quiet.
    const promised = { ...STEP_CATALOGUE, models: STEP_CATALOGUE.models.map((m) => (m.id === 'model-6.1-gamma'
      ? { ...m, context: 500000 } : m)) };
    plantStep({ catalogue: promised });
    plantWindows('lane-a', windowsFor({ 'model-6-alpha': 400000, 'model-6-beta': 400000, 'model-5.6-gamma': 400000 }));
    expect(op('materialise', '--file', rosterPath(), '--id', 'lane-a').code).toBe(0);
    expect(commit().body['outcome']).toBe('moved');
    expect(env()['CLAUDE_CODE_MAX_CONTEXT_TOKENS']).toBe('400000');
    expect(op('show', '--file', rosterPath(), '--id', 'lane-a').body['windowNotices']).toEqual([]);
    const lanes = op('lanes', '--file', rosterPath()).body['lanes'] as Record<string, unknown>[];
    expect(lanes.find((l) => l['id'] === 'lane-a')!['windowNotices']).toEqual([]);
  });

  it('moving to a model already measured keeps the measured rule, so the move passes the windows on', () => {
    plantStep();
    plantWindows('lane-a', windowsFor({ 'model-6-alpha': 400000, 'model-6-beta': 400000, 'model-5.6-gamma': 400000,
      'model-6.1-gamma': 300000 }));
    expect(commit().body['outcome']).toBe('moved');
    expect(env()['CLAUDE_CODE_MAX_CONTEXT_TOKENS']).toBe('300000');
    expect(op('show', '--file', rosterPath(), '--id', 'lane-a').body['windowNotices']).toEqual([]);
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

describe('lower-windows: a refusal lowers the window (codex-bridge D25, Stage 2 Task 15)', () => {
  // The bridge's stats file (Task 5's version 1) on a codex-kind lane, planted by hand: only `refusals` and `routes`
  // are read. Model ids are read off the fixtures by position, never spelled (this repository is public).
  const ID = CODEX_ROW.id;
  const OPUS = SEEDED.classes.opus!;
  const statsPath = (): string => path.join(home, '.ccrc', 'codex', ID, 'bridge.stats.json');
  const plantStats = (refusals: Record<string, unknown>, routes: Record<string, unknown> = {}): void => {
    fs.mkdirSync(path.dirname(statsPath()), { recursive: true });
    fs.writeFileSync(statsPath(), JSON.stringify({
      version: 1, lane: ID, since: '2026-10-01T00:00:00Z', startedAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-14T12:00:00Z', routes, refusals, outcomes: {}, names: {}, unexplained: {},
      usageHeaders: null, lastUpstreamRequestId: null,
    }), { mode: 0o600 });
  };
  const AT = '2026-10-14T12:00:00Z';
  const refusal = (tokens: number, at: string = AT): Record<string, unknown> =>
    ({ tokens, window: 400000, at, estimated: true });
  const entry = (tokens: number, setAt: string): Record<string, unknown> => ({ tokens, setAt });
  const lower = (): Result =>
    opEnv({ CCRC_MODELS_NOW: NOW }, 'lower-windows', '--file', rosterPath(), '--id', ID, '--stats', statsPath());
  const windowsFile = (): Record<string, unknown> & { windows: Record<string, Record<string, unknown>> } =>
    JSON.parse(fs.readFileSync(winPath(ID), 'utf8'));
  const tokensOf = (model: string): unknown => windowsFile().windows[model]?.['tokens'];

  beforeEach(() => {
    seed({ ...ROSTER, accounts: [...ROSTER.accounts, CODEX_ROW] });
    writeCatalogue(ID);
    plantCodex(ID);
  });

  it('a refusal at 380000 sets the window to 342000', () => {
    plantWindows(ID, { windows: { [OPUS]: entry(400000, '2026-10-01T00:00:00Z') } });
    plantStats({ [`backend/${OPUS}`]: refusal(380000) });
    const r = lower();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toMatchObject({ ok: true, lowered: [{ model: OPUS, from: 400000, to: 342000, refused: 380000 }],
      skipped: [] });
    expect(tokensOf(OPUS)).toBe(342000);
  });

  it('a lowered window is never recorded above the catalogue\'s maxContext for the model (D-8564)', () => {
    // `set-window` refuses a window above `windowCeiling` (`above-max-context`), so a refusal never writes one either:
    // the windows file holds only numbers the rule honours.
    writeCatalogue(ID, { ...CODEX, models: CODEX.models.map((row) => (row.id === OPUS
      ? { ...row, maxContext: 272000 } : row)) });
    plantWindows(ID, { windows: { [OPUS]: entry(400000, '2026-10-01T00:00:00Z') } });
    plantStats({ [`backend/${OPUS}`]: refusal(380000) });
    const r = lower();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toMatchObject({ lowered: [{ model: OPUS, from: 400000, to: 272000, refused: 380000 }] });
    expect(tokensOf(OPUS)).toBe(272000);
  });

  it('the floor of real usage never lifts a lowered window above the catalogue\'s maxContext (D-8564)', () => {
    writeCatalogue(ID, { ...CODEX, models: CODEX.models.map((row) => (row.id === OPUS
      ? { ...row, maxContext: 272000 } : row)) });
    plantWindows(ID, { windows: { [OPUS]: entry(400000, '2026-10-01T00:00:00Z') } });
    plantStats({ [`backend/${OPUS}`]: refusal(120000) },
      { [`backend/${OPUS}`]: { requests: 9, bytesPerToken: 3.5, promptTokensMax: 301500, promptTokensLast: 200000 } });
    const r = lower();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toMatchObject({ lowered: [{ model: OPUS, from: 400000, to: 272000, refused: 120000 }] });
    expect(tokensOf(OPUS)).toBe(272000);
  });

  it('a refusal never raises a window', () => {
    plantWindows(ID, { windows: { [OPUS]: entry(300000, '2026-10-01T00:00:00Z') } });
    plantStats({ [`backend/${OPUS}`]: refusal(380000) });
    const r = lower();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toMatchObject({ lowered: [], skipped: [{ model: OPUS, why: 'not-lower' }] });
    expect(tokensOf(OPUS)).toBe(300000);
    // Decided, so recorded: a skip is read once, exactly as a lowering is (fix round 1, F3).
    expect(windowsFile()['refusalsApplied']).toEqual({ [`backend/${OPUS}`]: AT });
  });

  it('a set-window after the refusal is not undone', () => {
    plantWindows(ID, { windows: { [OPUS]: entry(400000, '2026-10-14T13:00:00Z') } });
    plantStats({ [`backend/${OPUS}`]: refusal(380000) });
    const r = lower();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toMatchObject({ lowered: [], skipped: [{ model: OPUS, why: 'older-than-entry' }] });
    expect(tokensOf(OPUS)).toBe(400000);
  });

  it("a first entry is capped at the lane's window", () => {
    // No entry for the model: the lane's window is the provider's promise, the class models' 272000 (D-8564).
    plantStats({ [`backend/${OPUS}`]: refusal(380000) });
    const before = contextWindowFor(SEEDED, CODEX, null).tokens;
    expect(before).toBe(272000);
    const r = lower();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toMatchObject({ lowered: [{ model: OPUS, from: null, to: 272000, refused: 380000 }] });
    expect(tokensOf(OPUS)).toBe(272000);
  });

  it('a refusal of 1100 tokens is skipped below-minimum', () => {
    plantWindows(ID, { windows: { [OPUS]: entry(400000, '2026-10-01T00:00:00Z') } });
    plantStats({ [`backend/${OPUS}`]: refusal(1100) });
    const r = lower();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toMatchObject({ lowered: [], skipped: [{ model: OPUS, why: 'below-minimum' }] });
    expect(tokensOf(OPUS)).toBe(400000);
    expect(windowsFile()['refusalsApplied']).toEqual({ [`backend/${OPUS}`]: AT });
  });

  it('a model no class names is skipped', () => {
    plantStats({ 'backend/model-9-omega': refusal(380000) });
    const r = lower();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toMatchObject({ lowered: [], skipped: [{ model: 'model-9-omega', why: 'not-a-lane-model' }] });
    expect(windowsFile().windows['model-9-omega']).toBeUndefined();
    expect(windowsFile()['refusalsApplied']).toEqual({ 'backend/model-9-omega': AT });
  });

  it('a refusal estimated low never lowers below the largest accepted prompt', () => {
    plantWindows(ID, { windows: { [OPUS]: entry(400000, '2026-10-01T00:00:00Z') } });
    plantStats({ [`backend/${OPUS}`]: refusal(120000) },
      { [`backend/${OPUS}`]: { requests: 9, bytesPerToken: 3.5, promptTokensMax: 281500, promptTokensLast: 200000 } });
    const r = lower();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toMatchObject({ lowered: [{ model: OPUS, from: 400000, to: 282000, refused: 120000 }] });
    expect(tokensOf(OPUS)).toBe(282000);
  });

  it('a refusal on another route is not read', () => {
    plantWindows(ID, { windows: { [OPUS]: entry(400000, '2026-10-01T00:00:00Z') } });
    const before = fs.readFileSync(winPath(ID), 'utf8');
    plantStats({ [`siwc/${OPUS}`]: refusal(380000) },
      { [`siwc/${OPUS}`]: { requests: 1, bytesPerToken: 3.5, promptTokensMax: 1000, promptTokensLast: 1000 } });
    const r = lower();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toMatchObject({ ok: true, lowered: [], skipped: [] });
    expect(fs.readFileSync(winPath(ID), 'utf8')).toBe(before);
  });

  it('the entry records refusedTokensEstimate', () => {
    plantWindows(ID, { windows: { [OPUS]: entry(400000, '2026-10-01T00:00:00Z') } });
    plantStats({ [`backend/${OPUS}`]: refusal(380000) });
    expect(lower().code).toBe(0);
    expect(windowsFile().windows[OPUS]).toEqual({ tokens: 342000, setAt: NOW, source: 'refusal',
      refusedTokensEstimate: 380000 });
    expect(windowsFile()['refusalsApplied']).toEqual({ [`backend/${OPUS}`]: AT });
    expect(fs.statSync(winPath(ID)).mode & 0o777).toBe(0o600);
  });

  it('a refusal lowers, clear-window removes it, and the next refresh does not lower again', () => {
    plantWindows(ID, { windows: { [OPUS]: entry(400000, '2026-10-01T00:00:00Z') } });
    plantStats({ [`backend/${OPUS}`]: refusal(380000) });
    expect(lower().body['lowered']).toEqual([{ model: OPUS, from: 400000, to: 342000, refused: 380000 }]);
    const c = op('clear-window', '--file', rosterPath(), '--id', ID, '--model', OPUS);
    expect(c.code, c.stdout + c.stderr).toBe(0);
    expect(c.body['removed']).toBe(true);
    // The applied record is a top-level key clear-window does not know, so the file is kept with it (D-5161).
    expect(windowsFile()['refusalsApplied']).toEqual({ [`backend/${OPUS}`]: AT });
    const again = lower();
    expect(again.code, again.stdout + again.stderr).toBe(0);
    expect(again.body).toMatchObject({ lowered: [], skipped: [{ model: OPUS, why: 'already-applied' }] });
    expect(windowsFile().windows[OPUS]).toBeUndefined();
  });

  it('a refusal skipped older-than-entry, then set-window and clear-window, is not applied on the next refresh', () => {
    plantWindows(ID, { windows: { [OPUS]: entry(400000, '2026-10-14T13:00:00Z') } });
    plantStats({ [`backend/${OPUS}`]: refusal(380000) });
    expect(lower().body['skipped']).toEqual([{ model: OPUS, why: 'older-than-entry' }]);
    expect(windowsFile()['refusalsApplied']).toEqual({ [`backend/${OPUS}`]: AT });
    expect(op('set-window', '--file', rosterPath(), '--id', ID, '--model', OPUS, '--tokens', '450000').code).toBe(0);
    expect(op('clear-window', '--file', rosterPath(), '--id', ID, '--model', OPUS).code).toBe(0);
    const again = lower();
    expect(again.code, again.stdout + again.stderr).toBe(0);
    expect(again.body).toMatchObject({ lowered: [], skipped: [{ model: OPUS, why: 'already-applied' }] });
    expect(windowsFile().windows[OPUS]).toBeUndefined();
  });

  it('an absent stats file lowers nothing and writes nothing', () => {
    const r = lower();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toMatchObject({ ok: true, stats: 'absent', lowered: [], skipped: [] });
    expect(fs.existsSync(winPath(ID))).toBe(false);
  });

  it("a stats file of another lane is refused, and nothing is written", () => {
    plantStats({ [`backend/${OPUS}`]: refusal(380000) });
    const s = JSON.parse(fs.readFileSync(statsPath(), 'utf8'));
    fs.writeFileSync(statsPath(), JSON.stringify({ ...s, lane: 'lane-b' }));
    const r = lower();
    expect(r.code).toBe(1);
    expect(r.body['error']).toBe('stats-invalid');
    expect(fs.existsSync(winPath(ID))).toBe(false);
  });

  // Fix round 1 (review of Task 15): one case per guard the first round left without a red row.

  it('a later refusal of a model lowered once gets past the applied record, and the record moves to it', () => {
    const AT2 = '2026-10-14T18:00:00Z';
    plantWindows(ID, { windows: { [OPUS]: { tokens: 342000, setAt: '2026-10-14T13:00:00Z', source: 'refusal',
      refusedTokensEstimate: 380000 } }, refusalsApplied: { [`backend/${OPUS}`]: AT } });
    plantStats({ [`backend/${OPUS}`]: refusal(300000, AT2) });
    const r = lower();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toMatchObject({ lowered: [{ model: OPUS, from: 342000, to: 270000, refused: 300000 }], skipped: [] });
    expect(tokensOf(OPUS)).toBe(270000);
    expect(windowsFile()['refusalsApplied']).toEqual({ [`backend/${OPUS}`]: AT2 });
  });

  it("another route's largest accepted prompt is not this route's floor", () => {
    plantWindows(ID, { windows: { [OPUS]: entry(400000, '2026-10-01T00:00:00Z') } });
    plantStats({ [`backend/${OPUS}`]: refusal(120000) },
      { [`siwc/${OPUS}`]: { requests: 9, bytesPerToken: 3.5, promptTokensMax: 281500, promptTokensLast: 200000 } });
    const r = lower();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toMatchObject({ lowered: [{ model: OPUS, from: 400000, to: 108000, refused: 120000 }] });
    expect(tokensOf(OPUS)).toBe(108000);
  });

  it('an unreadable windows file is refused windows-unreadable, and it stays byte-identical', () => {
    plantWindows(ID, '{not json');
    plantStats({ [`backend/${OPUS}`]: refusal(380000) });
    const r = lower();
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(r.body['error']).toBe('windows-unreadable');
    expect(fs.readFileSync(winPath(ID), 'utf8')).toBe('{not json');
  });

  it.each([
    ['tokens that are not an integer', { tokens: 'x', window: 400000, at: AT, estimated: true }],
    ['no at', { tokens: 380000, window: 400000, estimated: true }],
    ['tokens of 0', { tokens: 0, window: 400000, at: AT, estimated: true }],
    ['tokens of -5', { tokens: -5, window: 400000, at: AT, estimated: true }],
    ['an entry that is null', null],
  ])('a refusal with %s is skipped refusal-invalid, and nothing is recorded', (_label, ref) => {
    plantWindows(ID, { windows: { [OPUS]: entry(400000, '2026-10-01T00:00:00Z') } });
    const before = fs.readFileSync(winPath(ID), 'utf8');
    plantStats({ [`backend/${OPUS}`]: ref });
    const r = lower();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toMatchObject({ lowered: [], skipped: [{ model: OPUS, why: 'refusal-invalid' }] });
    expect(fs.readFileSync(winPath(ID), 'utf8')).toBe(before);
  });

  it.each([
    ['a space', 'a b'],
    ['nothing', ''],
  ])('a refusal keyed by a model part with %s is skipped refusal-invalid, and nothing is recorded', (_label, model) => {
    plantWindows(ID, { windows: { [OPUS]: entry(400000, '2026-10-01T00:00:00Z') } });
    const before = fs.readFileSync(winPath(ID), 'utf8');
    plantStats({ [`backend/${model}`]: refusal(380000) });
    const r = lower();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toMatchObject({ lowered: [], skipped: [{ model, why: 'refusal-invalid' }] });
    expect(fs.readFileSync(winPath(ID), 'utf8')).toBe(before);
  });

  it.each([
    ['version 2', { version: 2 }],
    ['refusals that is not an object', { refusals: 'x' }],
    ['routes that is not an object', { routes: 'x' }],
  ])('a stats file with %s is refused stats-invalid, and nothing is written', (_label, over) => {
    plantStats({ [`backend/${OPUS}`]: refusal(380000) });
    const s = JSON.parse(fs.readFileSync(statsPath(), 'utf8'));
    fs.writeFileSync(statsPath(), JSON.stringify({ ...s, ...over }));
    const r = lower();
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(r.body['error']).toBe('stats-invalid');
    expect(fs.existsSync(winPath(ID))).toBe(false);
  });

  it('a FIFO at the stats path answers stats-unreadable and never blocks', () => {
    fs.mkdirSync(path.dirname(statsPath()), { recursive: true });
    expect(spawnSync('mkfifo', [statsPath()]).status).toBe(0);
    const r = spawnSync(process.execPath,
      [OP, 'lower-windows', '--file', rosterPath(), '--id', ID, '--stats', statsPath()],
      { env: { ...process.env, HOME: home, CCRC_MODELS_NOW: NOW }, encoding: 'utf8', timeout: 10_000 });
    expect(r.signal, 'lower-windows blocked on the FIFO and was ended at the 10 s bound').toBeNull();
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(JSON.parse(r.stdout.split('\n')[0]!)['error']).toBe('stats-unreadable');
    expect(fs.existsSync(winPath(ID))).toBe(false);
  }, 20_000);

  it('a lane that is not codex-kind is refused not-a-codex-lane, and nothing is written', () => {
    plantCodex(LEGACY_EXTERNAL_ID);
    plantStats({ [`backend/${OPUS}`]: refusal(380000) });
    const r = opEnv({ CCRC_MODELS_NOW: NOW }, 'lower-windows', '--file', rosterPath(), '--id', LEGACY_EXTERNAL_ID,
      '--stats', statsPath());
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(r.body['error']).toBe('not-a-codex-lane');
    expect(fs.existsSync(winPath(LEGACY_EXTERNAL_ID))).toBe(false);
  });

  it('a relative --stats is refused bad-argv', () => {
    plantStats({ [`backend/${OPUS}`]: refusal(380000) });
    const rel = path.relative(process.cwd(), statsPath());
    const r = opEnv({ CCRC_MODELS_NOW: NOW }, 'lower-windows', '--file', rosterPath(), '--id', ID, '--stats', rel);
    expect(r.code, r.stdout + r.stderr).toBe(2);
    expect(r.body['error']).toBe('bad-argv');
    expect(fs.existsSync(winPath(ID))).toBe(false);
  });

  it('a lane whose env block cannot be rendered is refused unroutable-lane, and the windows file is unchanged', () => {
    plantWindows(ID, { windows: { [OPUS]: entry(400000, '2026-10-01T00:00:00Z') } });
    const before = fs.readFileSync(winPath(ID), 'utf8');
    const reg = JSON.parse(fs.readFileSync(regPath(ID), 'utf8'));
    reg.subagent = 'opus';
    fs.writeFileSync(regPath(ID), `${JSON.stringify(reg, null, 2)}\n`);
    plantStats({ [`backend/${OPUS}`]: refusal(380000) });
    const r = lower();
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(r.body['error']).toBe('unroutable-lane');
    expect(fs.readFileSync(winPath(ID), 'utf8')).toBe(before);
  });

  // D-6905: a window set by hand is not a refusal's, so `set-window` over a lowered entry leaves out its
  // `source: "refusal"` and `refusedTokensEstimate`; any other `source` is kept ('PRESERVES keys this build …').
  it('a set-window over a lowered entry drops source and refusedTokensEstimate, and keeps any other key', () => {
    plantWindows(ID, { windows: { [OPUS]: { tokens: 400000, setAt: '2026-10-01T00:00:00Z', note: 'kept' } } });
    plantStats({ [`backend/${OPUS}`]: refusal(380000) });
    expect(lower().code).toBe(0);
    expect(windowsFile().windows[OPUS]).toEqual({ tokens: 342000, setAt: NOW, source: 'refusal',
      refusedTokensEstimate: 380000, note: 'kept' });
    const s = op('set-window', '--file', rosterPath(), '--id', ID, '--model', OPUS, '--tokens', '450000');
    expect(s.code, s.stdout + s.stderr).toBe(0);
    const written = windowsFile().windows[OPUS]!;
    expect(written).toEqual({ tokens: 450000, setAt: expect.any(String), note: 'kept' });
    expect(Object.keys(written).sort()).toEqual(['note', 'setAt', 'tokens']);
    const r = op('show', '--file', rosterPath(), '--id', ID);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect((r.body['windows'] as { byModel: Record<string, unknown> }).byModel[OPUS])
      .toEqual({ tokens: 450000, setAt: written['setAt'] });
  });
});

// ── auto-advance plan W3 Task 14: `advance-health`, doctor's one read ──────────────────────────────────────────
// Box-wide and READ-ONLY. Its two paths come from its caller (`--reg`, `--lock-template`), so these cases put the
// session registry at the fixture's own `~/.cc-sessions` and the lock directory under a neutral `<home>/lk`: the op
// assumes neither. Every run is BOUNDED, because a reader that opened a FIFO would block inside the open. Neutral
// ids only; the one path outside the fixture HOME, `/var/tmp`, is only lstat-ed and access-ed, never written.
describe('advance-health (auto-advance spec §2.8; plan W3 Task 14)', () => {
  const H_NOW = '2026-10-23T09:00:00Z';
  const H_MOVED = '2026-10-21T14:05:11Z';
  const H_TURN = '2026-10-22T09:11:40Z';
  const H_RENDER = '2026-10-22T09:12:03Z';
  const H_SID = 'lane-a-demo';
  const isRootH = typeof process.getuid === 'function' && process.getuid() === 0;
  const sessDir = (): string => path.join(home, '.cc-sessions');
  const lockDir = (): string => path.join(home, 'lk');
  const lockTpl = (): string => path.join(lockDir(), 'models-{id}.lock');
  const lockOf = (id = 'lane-a'): string => path.join(lockDir(), `models-${id}.lock`);

  /** `advance-health`, ended at 20 s: a hang reds the case, never the suite. `args` replaces the whole argument
   *  list after the op's name. In its own process group (`spawnSyncGroup`, `spawn-group-pin.test.ts`), so a bound
   *  that fires takes the whole tree with it; a timeout comes back as `error` (ETIMEDOUT), never as a lone signal. */
  function health(o: { now?: string; args?: string[] } = {}): Result {
    const args = o.args ?? ['--file', rosterPath(), '--reg', sessDir(), '--lock-template', lockTpl()];
    const r = spawnSyncGroup(process.execPath, [OP, 'advance-health', ...args],
      { env: { ...process.env, HOME: home, CCRC_MODELS_NOW: o.now ?? H_NOW }, encoding: 'utf8', timeout: 20_000 });
    expect(r.error, `advance-health was ended at the bound: ${r.stderr}`).toBeUndefined();
    const stdout = r.stdout ?? '';
    const lines = stdout.split('\n');
    expect(lines.length, `stdout carried ${lines.length - 1} lines, not one`).toBe(2);
    return { code: r.status ?? -1, body: JSON.parse(lines[0]!), stderr: r.stderr ?? '', stdout };
  }
  const laneH = (r: Result, id = 'lane-a'): Record<string, unknown> =>
    (r.body['lanes'] as Record<string, unknown>[]).find((l) => l['id'] === id)!;

  /** A lane's files as their writers leave them, with NO materialise: this op reads no settings, and a pin that
   *  breaks the grammar is one no materialise should be asked to render. `null` leaves that file absent. */
  function plantH(o: { id?: string; registry?: unknown; catalogue?: unknown; advance?: unknown } = {}): void {
    const id = o.id ?? 'lane-a';
    fs.mkdirSync(path.join(home, '.ccrc', 'models'), { recursive: true });
    fs.writeFileSync(regPath(id), `${JSON.stringify(o.registry ?? STEP_REGISTRY, null, 2)}\n`, { mode: 0o600 });
    if (o.catalogue !== null) writeCatalogue(id, o.catalogue ?? STEP_CATALOGUE);
    if (o.advance !== null) {
      fs.writeFileSync(advPath(id), `${JSON.stringify(o.advance ?? stepAdvance(), null, 2)}\n`, { mode: 0o600 });
    }
  }
  /** lane-a after one advance: opus moved from model-5.6-gamma to model-6.1-gamma at H_MOVED. */
  const MOVED_REG = { ...STEP_REGISTRY, classes: { ...STEP_REGISTRY.classes, opus: 'model-6.1-gamma' },
    effort: { ...STEP_REGISTRY.effort, opus: 'xhigh' } };
  const MOVE = { at: H_MOVED, how: 'advance', from: 'model-5.6-gamma', to: 'model-6.1-gamma', ok: true,
    canary: 'passed', effort: { from: 'max', to: 'xhigh' } };
  const MOVED_ADV = stepAdvance({ opus: { previous: { model: 'model-5.6-gamma', effort: 'max' }, history: [MOVE] } });
  /** opus's advance refused three times: the newest entry, a failed advance to the class's standing candidate. */
  const failedH = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
    at: '2026-10-22T10:05:12Z', how: 'advance', from: 'model-5.6-gamma', to: 'model-6.1-gamma', ok: false,
    canary: 'failed', reason: 'http 500: upstream error', tries: 3, lastAt: '2026-10-22T12:05:09Z', ...o });
  const HOLD = { at: '2026-10-22T08:00:00Z', by: 'hand' };

  /** One session's three registry files, as ccd, the session hook and the status line write them. `sidecar: null`
   *  writes no usage sidecar; a string is written as the sidecar verbatim. */
  function plantSessionH(o: { sid?: string; lane?: string; model?: string; sidecar?: string | null } = {}): void {
    const sid = o.sid ?? H_SID;
    fs.mkdirSync(path.join(sessDir(), 'usage'), { recursive: true });
    fs.writeFileSync(path.join(sessDir(), `${sid}.wrapper`), o.lane ?? 'lane-a');
    const turnAt = Date.parse(H_TURN);
    fs.writeFileSync(path.join(sessDir(), `${sid}.turn.json`), `${JSON.stringify({ v: 1, sessionId: `uuid-${sid}`,
      state: 'done', event: 'Stop', at: turnAt + 30_000, turnAt, stopAt: turnAt + 30_000, bg: -1, bgKinds: '',
      bgIds: '', err: null, restartAt: null, lostBg: 0, lostKinds: '', lostIds: '' })}\n`);
    if (o.sidecar === null) return;
    fs.writeFileSync(path.join(sessDir(), 'usage', `${sid}.json`), o.sidecar ?? `${JSON.stringify({
      ts: Date.parse(H_RENDER) / 1000, uuid: `uuid-${sid}`, account: o.lane ?? 'lane-a',
      model: o.model ?? 'model-5.6-gamma', effort: 'low', ctxPct: 12, cost: 0.1, agent: null })}\n`);
  }
  const BEHIND_ROW = { session: H_SID, class: 'opus', from: 'model-5.6-gamma', to: 'model-6.1-gamma',
    movedAt: H_MOVED, turnAt: H_TURN, renderAt: H_RENDER };

  beforeEach(() => { seed(stepRoster({ ...STEP_PORTS, authDir: codexAuthDir('lane-a') })); });

  it('answers one object: the time, the session registry\'s word, and one entry per lane with a registry, in roster order', () => {
    plantH();
    const r = health();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toEqual({ ok: true, op: 'advance-health', now: H_NOW, sessions: 'absent', sessionsUnmeasured: [],
      lanes: [{ id: 'lane-a', heldBack: [], heldBehind: [], blocked: [], sessionsBehind: [], sessionsUnmeasured: [] }] });
    plantH({ id: 'lane-b' });
    expect((health().body['lanes'] as Record<string, unknown>[]).map((l) => l['id'])).toEqual(['lane-a', 'lane-b']);
  });

  it('heldBack: a failed newest advance to the candidate that still stands, with the step that failed', () => {
    plantH({ advance: stepAdvance({ opus: { history: [failedH()] } }) });
    expect(laneH(health())['heldBack']).toEqual([{ class: 'opus', from: 'model-5.6-gamma', to: 'model-6.1-gamma',
      reason: 'http 500: upstream error', tries: 3, since: '2026-10-22T10:05:12Z', canary: 'failed' }]);
  });

  it('heldBack names a move that failed after its canary passed', () => {
    plantH({ advance: stepAdvance({ opus: { history: [failedH({ canary: 'passed', tries: 1, reason: 'materialise: EISDIR' })] } }) });
    expect(laneH(health())['heldBack']).toEqual([{ class: 'opus', from: 'model-5.6-gamma', to: 'model-6.1-gamma',
      reason: 'materialise: EISDIR', tries: 1, since: '2026-10-22T10:05:12Z', canary: 'passed' }]);
  });

  it('heldBack clears once an advance succeeds', () => {
    plantH({ registry: MOVED_REG, advance: stepAdvance({ opus: {
      previous: { model: 'model-5.6-gamma', effort: 'max' }, history: [failedH(), { ...MOVE, at: '2026-10-22T13:05:10Z' }] } }) });
    expect(laneH(health())['heldBack']).toEqual([]);
  });

  it('heldBack clears when its candidate has left the catalogue (D-5191)', () => {
    plantH({ catalogue: { ...STEP_CATALOGUE, models: STEP_CATALOGUE.models.filter((m) => m.id !== 'model-6.1-gamma') },
      advance: stepAdvance({ opus: { history: [failedH()] } }) });
    expect(laneH(health())['heldBack']).toEqual([]);
  });

  it('a held class is never held back: the hold stopped its retries, and heldBehind names it (D-5221)', () => {
    plantH({ advance: stepAdvance({ opus: { hold: HOLD, history: [failedH()] } }) });
    const lane = laneH(health());
    expect(lane['heldBack']).toEqual([]);
    expect(lane['heldBehind']).toEqual([{ class: 'opus', pin: 'model-5.6-gamma', newer: 'model-6.1-gamma', reason: 'newer',
      hold: HOLD }]);
  });

  it('heldBehind: a held class with a newer model of its family; nothing when released, or when nothing is newer', () => {
    plantH({ advance: stepAdvance({ opus: { hold: HOLD }, haiku: { hold: HOLD } }) });
    const rows = laneH(health())['heldBehind'] as Record<string, unknown>[];
    // D-8689: `reason` is #2701's vocabulary, the words a successful advance records as its `cause`; no new list.
    // Asserted first, so a row that loses its `reason` reds here (mutation A23), not only at the exact row below.
    for (const row of rows) expect(CANDIDATE_REASONS).toContain(row['reason']);
    expect(rows).toEqual([{ class: 'opus', pin: 'model-5.6-gamma', newer: 'model-6.1-gamma',
      reason: 'newer', hold: HOLD }]);
    plantH({ advance: stepAdvance({ haiku: { hold: HOLD } }) });
    expect(laneH(health())['heldBehind']).toEqual([]);
  });

  it('a move to a model with no measured window is the models row\'s finding, not advance-health\'s (D-8689)', () => {
    plantH({ registry: MOVED_REG, advance: MOVED_ADV });
    plantWindows('lane-a', windowsFor({ 'model-6-alpha': 400000, 'model-6-beta': 400000, 'model-5.6-gamma': 400000 }));
    const s = op('show', '--file', rosterPath(), '--id', 'lane-a');
    expect(s.code, s.stdout + s.stderr).toBe(0);
    expect(s.body['windowNotices'] as unknown[]).toHaveLength(1);
    expect(laneH(health())).toEqual({ id: 'lane-a', heldBack: [], heldBehind: [], blocked: [], sessionsBehind: [],
      sessionsUnmeasured: [] });
  });

  it('an empty class held by a revert is behind the newest model of its stored family', () => {
    const hold = { at: '2026-10-22T08:00:00Z', by: 'revert' };
    plantH({ advance: stepAdvance({ fable: { family: 'delta', hold } }) });
    expect(laneH(health())['heldBehind']).toEqual([{ class: 'fable', pin: null, newer: 'model-6-delta', reason: 'empty',
      hold }]);
  });

  it('a held class whose pin has left the catalogue is named with reason retired: its fallback may be OLDER than the pin', () => {
    // model-7-gamma is listed nowhere; the newest gamma the fresh catalogue lists is model-6.1-gamma, an older version.
    plantH({ registry: { ...STEP_REGISTRY, classes: { ...STEP_REGISTRY.classes, opus: 'model-7-gamma' } },
      advance: stepAdvance({ opus: { hold: HOLD } }) });
    expect(laneH(health())['heldBehind']).toEqual([{ class: 'opus', pin: 'model-7-gamma', newer: 'model-6.1-gamma',
      reason: 'retired', hold: HOLD }]);
  });

  it.each([
    ['an advance file of another version', 'advance-file-invalid', null, (): void => {
      fs.writeFileSync(advPath('lane-a'), `${JSON.stringify({ ...stepAdvance(), v: 2 }, null, 2)}\n`);
    }],
    ['an advance file that is a directory', 'advance-file-unreadable', null, (): void => {
      fs.rmSync(advPath('lane-a')); fs.mkdirSync(advPath('lane-a'));
    }],
    ['a registry that is not JSON', 'registry-invalid', null, (): void => { fs.writeFileSync(regPath('lane-a'), '{ not json'); }],
    // JSON that `parseRegistry` refuses (an unknown field): `readRegistry`'s `{invalid}` arm, not its `{err}` arm.
    ['a registry with a field it does not know', 'registry-invalid', null, (): void => {
      fs.writeFileSync(regPath('lane-a'), `${JSON.stringify({ ...STEP_REGISTRY, extra: 1 }, null, 2)}\n`);
    }],
    ['a registry that is a directory', 'registry-unreadable', null, (): void => {
      fs.rmSync(regPath('lane-a')); fs.mkdirSync(regPath('lane-a'));
    }],
    ['a catalogue that is not a catalogue', 'catalogue-invalid', null, (): void => { writeCatalogue('lane-a', { probe: 'codex' }); }],
    ['a catalogue that is a directory', 'catalogue-unreadable', null, (): void => {
      const p = path.join(home, '.ccrc', 'models', 'lane-a.json');
      fs.rmSync(p); fs.mkdirSync(p);
    }],
    ['a windows file that cannot be read while a class has a candidate', 'windows-unreadable', null, (): void => {
      plantWindows('lane-a', '{ not json');
    }],
    ['a pin that breaks the id grammar', 'pin-grammar', 'opus', (): void => {
      plantH({ registry: { ...STEP_REGISTRY, classes: { ...STEP_REGISTRY.classes, opus: 'model-x-gamma' } } });
    }],
    ['two classes on one family whose newest model one of them pins', 'shared-family', 'opus', (): void => {
      plantH({ registry: { ...STEP_REGISTRY, classes: { ...STEP_REGISTRY.classes, opus: 'model-5.6-alpha' } },
        advance: stepAdvance({ opus: { family: 'alpha' } }) });
    }],
  ] as [string, string, string | null, () => void][])('%s is blocked %s, a BLOCKED_CAUSES word, with its detail', (_w, cause, cls, spoil) => {
    plantH();
    spoil();
    const r = health();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const blocked = laneH(r)['blocked'] as Record<string, unknown>[];
    expect(blocked.map((b) => [b['class'], b['cause']])).toEqual([[cls, cause]]);
    expect(String(blocked[0]!['detail']).length).toBeGreaterThan(0);
    expect(BLOCKED_CAUSES).toContain(cause);
  });

  it('a pin that breaks the grammar names itself in the detail', () => {
    plantH({ registry: { ...STEP_REGISTRY, classes: { ...STEP_REGISTRY.classes, opus: 'model-x-gamma' } } });
    expect(laneH(health())['blocked']).toEqual([{ class: 'opus', cause: 'pin-grammar',
      detail: 'model-x-gamma is not <vendor>-<version>-<family>' }]);
  });

  it('an external-kind lane with a codex registry is blocked lane-not-codex-kind and gets no other codex finding (Review Focus 14)', () => {
    plantH({ id: 'lane-b', advance: stepAdvance({ opus: { hold: HOLD, history: [failedH()] } }) });
    const lane = laneH(health(), 'lane-b');
    expect(lane['blocked']).toEqual([{ class: null, cause: 'lane-not-codex-kind',
      detail: 'its roster row is exec.kind "external", and only an exec.kind "codex" lane advances' }]);
    expect(lane['heldBack']).toEqual([]);
    expect(lane['heldBehind']).toEqual([]);
  });

  describe('a lane-files lock path a writer could not use is lock-unwritable, measured with lstat and access only (D-5193)', () => {
    const lockFindings = (r: Result): Record<string, unknown>[] =>
      (laneH(r)['blocked'] as Record<string, unknown>[]).filter((b) => b['cause'] === 'lock-unwritable');
    /** A directory that exists, this account can write, and another account owns — the case `chmod 700` refuses.
     *  `/var/tmp` where it is one; read-only here. */
    const SHARED_TMP = '/var/tmp';
    const foreignUsable = ((): boolean => {
      try {
        if (isRootH || typeof process.getuid !== 'function') return false;
        const st = fs.lstatSync(SHARED_TMP);
        fs.accessSync(SHARED_TMP, fs.constants.W_OK);
        return st.isDirectory() && st.uid !== process.getuid();
      } catch {
        return false;
      }
    })();

    beforeEach(() => { plantH(); });

    it('no lock directory yet is not a finding, and advance-health makes none', () => {
      expect(lockFindings(health())).toEqual([]);
      expect(fs.existsSync(lockDir())).toBe(false);
    });

    it('a lock file this account can write, in a directory it owns, is not a finding', () => {
      fs.mkdirSync(lockDir(), { mode: 0o700 });
      fs.writeFileSync(lockOf(), '', { mode: 0o600 });
      expect(lockFindings(health())).toEqual([]);
    });

    it.each([
      ['a FIFO at the lock path', (): void => { expect(spawnSync('mkfifo', [lockOf()]).status).toBe(0); },
        /models-lane-a\.lock is not a regular file \(a FIFO, a directory or a socket\), which the lane-files lock never opens$/],
      ['a directory at the lock path', (): void => { fs.mkdirSync(lockOf()); },
        /models-lane-a\.lock is not a regular file \(a FIFO, a directory or a socket\), which the lane-files lock never opens$/],
      ['a symlink to a regular file at the lock path', (): void => {
        fs.writeFileSync(path.join(lockDir(), 'target'), ''); fs.symlinkSync(path.join(lockDir(), 'target'), lockOf());
      }, /models-lane-a\.lock is a symlink, which the lane-files lock never opens$/],
      ['a dangling symlink at the lock path', (): void => { fs.symlinkSync(path.join(lockDir(), 'nowhere'), lockOf()); },
        /models-lane-a\.lock is a symlink, which the lane-files lock never opens$/],
    ] as [string, () => void, RegExp][])('%s is a finding, and is never opened', (_w, plant, detail) => {
      fs.mkdirSync(lockDir(), { mode: 0o700 });
      plant();
      const before = fs.lstatSync(lockOf());
      const found = lockFindings(health());
      expect(found.map((b) => b['class'])).toEqual([null]);
      expect(String(found[0]!['detail'])).toMatch(detail);
      const after = fs.lstatSync(lockOf());
      expect([after.mode, after.ino, after.mtimeMs]).toEqual([before.mode, before.ino, before.mtimeMs]);
    });

    it('a lock directory that is a symlink is a finding', () => {
      fs.mkdirSync(path.join(home, 'real-lk'), { mode: 0o700 });
      fs.symlinkSync(path.join(home, 'real-lk'), lockDir());
      const found = lockFindings(health());
      expect(found).toHaveLength(1);
      expect(String(found[0]!['detail'])).toMatch(/\/lk is a symlink, which the lane-files lock never follows$/);
    });

    it('a lock directory that is a file is a finding', () => {
      fs.writeFileSync(lockDir(), '');
      const found = lockFindings(health());
      expect(found).toHaveLength(1);
      expect(String(found[0]!['detail'])).toMatch(/\/lk is not a directory$/);
    });

    it.skipIf(isRootH)('a lock file this account cannot write is a finding', () => {
      fs.mkdirSync(lockDir(), { mode: 0o700 });
      fs.writeFileSync(lockOf(), '', { mode: 0o400 });
      expect(String(lockFindings(health())[0]?.['detail'])).toMatch(/models-lane-a\.lock is not writable by this account \(EACCES\)$/);
    });

    // Ruling RC7's letter ("whose lock directory it cannot write"): reported although W1's `_models_lock` would
    // `chmod 700` a directory this account owns and go on; the remedy says the next writer repairs it.
    it.skipIf(isRootH)('a lock directory this account owns but cannot write is a finding', () => {
      fs.mkdirSync(lockDir(), { mode: 0o500 });
      expect(String(lockFindings(health())[0]?.['detail'])).toMatch(/\/lk is not writable by this account \(EACCES\)$/);
    });

    it.skipIf(!foreignUsable)('a writable lock directory another account owns is a finding: its chmod 700 would fail', () => {
      const r = health({ args: ['--file', rosterPath(), '--reg', sessDir(), '--lock-template',
        path.join(SHARED_TMP, 'models-{id}.lock')] });
      expect(String(lockFindings(r)[0]?.['detail']))
        .toMatch(/belongs to another account \(uid \d+\), so the lane-files lock cannot make it 0700$/);
    });
  });

  describe('sessionsBehind, read from the session registry its caller names (D-5194)', () => {
    beforeEach(() => { plantH({ registry: MOVED_REG, advance: MOVED_ADV }); });

    it('lists a session still rendering the replaced model, from its files alone: whether it runs is the doctor\'s question', () => {
      plantSessionH();
      const r = health();
      expect(r.body['sessions']).toBe('read');
      expect(laneH(r)['sessionsBehind']).toEqual([BEHIND_ROW]);
    });

    /** The turn marker's path, emptied of the file `plantSessionH` wrote there. */
    const markerAt = (): string => {
      const p = path.join(sessDir(), `${H_SID}.turn.json`);
      fs.rmSync(p);
      return p;
    };
    const un = (why: string): Record<string, unknown>[] => [{ session: H_SID, why }];

    // Never behind; and named in the lane's `sessionsUnmeasured` exactly when a file it needed could not be read as
    // one JSON object, so a lane nobody could measure is never a PASS that measured nothing.
    it.each([
      ['a session whose registry row names another lane', [], (): void => { plantSessionH({ lane: 'lane-b' }); }],
      ['a session whose main render is the new model, though a subagent\'s own sidecar shows the old one', [], (): void => {
        plantSessionH({ model: 'model-6.1-gamma' });
        const agents = path.join(sessDir(), 'usage', `${H_SID}.agents`);
        fs.mkdirSync(agents, { recursive: true });
        fs.writeFileSync(path.join(agents, 'helper.json'), `${JSON.stringify({ ts: Date.parse(H_RENDER) / 1000,
          uuid: `uuid-${H_SID}`, model: 'model-5.6-gamma', agent: 'helper' })}\n`);
      }],
      ['a session with no turn marker', un('marker-absent'), (): void => { plantSessionH(); markerAt(); }],
      ['a turn marker that is not JSON', un('marker-unreadable'), (): void => {
        plantSessionH(); fs.writeFileSync(markerAt(), '{ not json\n');
      }],
      ['a turn marker holding null', un('marker-unreadable'), (): void => {
        plantSessionH(); fs.writeFileSync(markerAt(), 'null\n');
      }],
      ['a FIFO at the turn marker', un('marker-unreadable'), (): void => {
        plantSessionH();
        expect(spawnSync('mkfifo', [markerAt()]).status).toBe(0);
      }],
      ['a session whose home writes no usage sidecar (its own status line)', un('sidecar-absent'), (): void => {
        plantSessionH({ sidecar: null });
      }],
      ['a usage sidecar over its 4096-byte cap', un('sidecar-unreadable'), (): void => {
        plantSessionH({ sidecar: `${JSON.stringify({ ts: Date.parse(H_RENDER) / 1000, uuid: `uuid-${H_SID}`,
          model: 'model-5.6-gamma', agent: null })}${' '.repeat(5000)}\n` });
      }],
      ['a usage sidecar holding a JSON list', un('sidecar-unreadable'), (): void => { plantSessionH({ sidecar: '[]\n' }); }],
      ['a FIFO at the usage sidecar', un('sidecar-unreadable'), (): void => {
        plantSessionH({ sidecar: null });
        expect(spawnSync('mkfifo', [path.join(sessDir(), 'usage', `${H_SID}.json`)]).status).toBe(0);
      }],
    ] as [string, Record<string, unknown>[], () => void][])('%s is not listed as behind, and nothing blocks', (_w, unmeasured, plant) => {
      plant();
      const r = health();
      expect(laneH(r)['sessionsBehind']).toEqual([]);
      expect(laneH(r)['sessionsUnmeasured']).toEqual(unmeasured);
      expect(laneH(r)['blocked']).toEqual([]);
      expect(r.body['sessionsUnmeasured']).toEqual([]);
    });

    it('a .wrapper it cannot read is a session of no known lane: named at the top level, never skipped, never opened', () => {
      plantSessionH();
      const fifo = path.join(sessDir(), 'lane-a-x.wrapper');
      expect(spawnSync('mkfifo', [fifo]).status).toBe(0);
      const r = health();
      expect(r.body['sessionsUnmeasured']).toEqual([{ session: 'lane-a-x', why: 'wrapper-unreadable' }]);
      expect(laneH(r)['sessionsBehind']).toEqual([BEHIND_ROW]);
      expect(fs.lstatSync(fifo).isFIFO()).toBe(true);
    });

    it('a lane whose advance file cannot be read names every session of it unmeasured: its moves were not read', () => {
      plantSessionH();
      fs.rmSync(advPath('lane-a'));
      fs.mkdirSync(advPath('lane-a'));
      const lane = laneH(health());
      expect(lane['sessionsBehind']).toEqual([]);
      expect(lane['sessionsUnmeasured']).toEqual([{ session: H_SID, why: 'advance-file-unreadable' }]);
    });

    // D-5220, a finding of R2's review: a registry that cannot be read or parsed ends
    // the lane before any session is judged, so each of the lane's sessions is named unmeasured with the registry's
    // own word, as the advance-file arm above names its own; never in neither list. With no advance file nothing has
    // moved, so no session is read there, whatever the registry says.
    it.each([
      ['cannot be read', 'registry-unreadable', (): void => { fs.rmSync(regPath('lane-a')); fs.mkdirSync(regPath('lane-a')); }],
      ['cannot be parsed', 'registry-invalid', (): void => {
        fs.writeFileSync(regPath('lane-a'), `${JSON.stringify({ ...MOVED_REG, extra: 1 }, null, 2)}\n`);
      }],
    ] as [string, string, () => void][])('a lane whose registry %s names every session of it unmeasured, as %s', (_w, why, spoil) => {
      plantH({ registry: MOVED_REG, advance: MOVED_ADV });
      plantSessionH();
      spoil();
      const lane = laneH(health());
      expect(lane['sessionsBehind']).toEqual([]);
      expect(lane['sessionsUnmeasured']).toEqual([{ session: H_SID, why }]);
      fs.rmSync(advPath('lane-a'));
      expect(laneH(health())['sessionsUnmeasured']).toEqual([]);
    });

    it('a hand set-class a crash cut short is judged as the next locked writer will record it, and the file is not written', () => {
      const adv = `${JSON.stringify(stepAdvance({}, { how: 'hand', class: 'opus', from: 'model-5.6-gamma',
        to: 'model-6.1-gamma', emptied: [], at: H_MOVED }), null, 2)}\n`;
      fs.writeFileSync(advPath('lane-a'), adv, { mode: 0o600 });
      plantSessionH();
      expect(laneH(health())['sessionsBehind']).toEqual([BEHIND_ROW]);
      expect(fs.readFileSync(advPath('lane-a'), 'utf8')).toBe(adv);
    });

    it('with no advance file nothing has moved, so no session is behind and none is unmeasured', () => {
      fs.rmSync(advPath('lane-a'));
      plantSessionH();
      const lane = laneH(health());
      expect(lane['sessionsBehind']).toEqual([]);
      expect(lane['sessionsUnmeasured']).toEqual([]);
    });

    it.each([
      ['absent', (): void => {}],
      ['read', (): void => { fs.mkdirSync(sessDir(), { recursive: true }); }],
      ['unreadable', (): void => { fs.writeFileSync(sessDir(), 'not a directory\n'); }],
    ] as [string, () => void][])('the session registry has its own word: %s', (word, plant) => {
      plant();
      expect(health().body['sessions']).toBe(word);
    });
  });

  it('writes nothing: ~/.ccrc and the session registry keep their bytes and mtimes, and no lock path is made', () => {
    plantH({ registry: MOVED_REG, advance: stepAdvance({}, { how: 'hand', class: 'opus', from: 'model-5.6-gamma',
      to: 'model-6.1-gamma', emptied: [], at: H_MOVED }) });
    plantSessionH();
    const sessions = (): string[] => fs.readdirSync(sessDir(), { recursive: true }).map(String).sort()
      .map((f) => `${f} ${fs.statSync(path.join(sessDir(), f)).mtimeMs}`);
    const before = [...snapshot(), ...sessions()];
    expect(health().code).toBe(0);
    expect(health().code).toBe(0);
    expect([...snapshot(), ...sessions()]).toEqual(before);
    expect(fs.existsSync(lockDir())).toBe(false);
  });

  it.each([
    ['a relative --reg', (): string[] => ['--file', rosterPath(), '--reg', '.cc-sessions', '--lock-template', lockTpl()]],
    ['a lock template with no {id}', (): string[] =>
      ['--file', rosterPath(), '--reg', sessDir(), '--lock-template', path.join(lockDir(), 'models.lock')]],
    ['a lock template with {id} twice', (): string[] =>
      ['--file', rosterPath(), '--reg', sessDir(), '--lock-template', path.join(lockDir(), '{id}', 'models-{id}.lock')]],
    ['a relative lock template', (): string[] => ['--file', rosterPath(), '--reg', sessDir(), '--lock-template', 'lk/models-{id}.lock']],
    ['no --lock-template', (): string[] => ['--file', rosterPath(), '--reg', sessDir()]],
    ['no --reg', (): string[] => ['--file', rosterPath(), '--lock-template', lockTpl()]],
    ['an --id, which a box-wide op does not take', (): string[] =>
      ['--file', rosterPath(), '--reg', sessDir(), '--lock-template', lockTpl(), '--id', 'lane-a']],
  ] as [string, () => string[]][])('%s is bad-argv at exit 2', (_w, args) => {
    plantH();
    const r = health({ args: args() });
    expect(r.code).toBe(2);
    expect(r.body).toMatchObject({ ok: false, error: 'bad-argv' });
  });

  it('a clock that is not a time is refused at exit 2, never a run judged against no time', () => {
    plantH();
    const r = health({ now: 'not-a-time' });
    expect(r.code).toBe(2);
    expect(r.body).toMatchObject({ ok: false, error: 'bad-argv' });
  });
});

// ── auto-advance ruling 11: the hourly writer reaps a stale catalogue staging file ───────────────────────────
// `ccd/ccrc-models-probe` stages a lane's catalogue as `$OUT.tmp.$$` beside it, with an EXIT trap; a probe killed
// hard leaves that file. The probe runs OUTSIDE the lane-files lock, so `advance-backfill` (the one write op the
// hourly step runs on every advancing lane) reaps one only when it is proved stale: a regular file, named for this
// lane, whose pid no longer runs and whose mtime is an hour or more before the op's clock. Every planted entry's own
// times are set two hours before NOW (`lutimesSync`: a symlink's own, a file's or a directory's like `utimesSync`)
// unless a case says otherwise, because a real mtime is later than this fixed NOW, so an entry left unset would be
// kept by the age test alone and hide the guard its case is about. Neutral ids only.
describe('advance-backfill reaps a stale catalogue staging file, and only that (ruling 11)', () => {
  const R_NOW = '2026-10-23T09:00:00Z';
  const TWO_HOURS_BEFORE = new Date(Date.parse(R_NOW) - 2 * 3_600_000);
  /** Above Linux's largest `pid_max` (2^22) and above macOS's: a pid no process holds. */
  const DEAD_PID = 4194305;
  const dir = (): string => path.join(home, '.ccrc', 'models');
  const at = (name: string): string => path.join(dir(), name);
  const aged = (p: string, when: Date = TWO_HOURS_BEFORE): void => { fs.lutimesSync(p, when, when); };
  const listing = (): string[] => fs.readdirSync(dir()).sort();
  const backfill = (): Result =>
    opEnv({ CCRC_MODELS_NOW: R_NOW }, 'advance-backfill', '--file', rosterPath(), '--id', 'lane-a');
  /** A regular staging file holding a cut-short catalogue, its times two hours before NOW unless `when` says otherwise. */
  const plantTmp = (name: string, when?: Date): string => {
    const p = at(name);
    fs.writeFileSync(p, '{"partial":');
    aged(p, when);
    return p;
  };

  beforeEach(() => {
    seed(stepRoster({ ...STEP_PORTS, authDir: codexAuthDir('lane-a') }));
    plantStep();
    for (const n of fs.readdirSync(dir())) aged(at(n));
  });

  it('a regular <lane>.json.tmp.<pid> whose pid is gone, two hours old, is removed and named; the catalogue keeps its bytes', () => {
    const catBefore = fs.readFileSync(at('lane-a.json'));
    plantTmp(`lane-a.json.tmp.${DEAD_PID}`);
    const before = listing();
    const r = backfill();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body['reapedTmp']).toEqual([`lane-a.json.tmp.${DEAD_PID}`]);
    expect(listing()).toEqual(before.filter((n) => n !== `lane-a.json.tmp.${DEAD_PID}`));
    expect(fs.readFileSync(at('lane-a.json'))).toEqual(catBefore);
  });

  it('the same file 59 minutes old is kept: a probe may still be writing it', () => {
    plantTmp(`lane-a.json.tmp.${DEAD_PID}`, new Date(Date.parse(R_NOW) - 59 * 60_000));
    const before = listing();
    const r = backfill();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).not.toHaveProperty('reapedTmp');
    expect(listing()).toEqual(before);
  });

  it('a staging file whose pid still runs is kept, however old', () => {
    plantTmp(`lane-a.json.tmp.${process.pid}`);
    const before = listing();
    const r = backfill();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).not.toHaveProperty('reapedTmp');
    expect(listing()).toEqual(before);
  });

  // EPERM is a live process of ANOTHER account, so its file is kept. Pid 1 is root's on Linux and macOS alike, and
  // signal 0 to it from any other account answers EPERM; the case runs only where that is measured true here (never
  // as root, nor in a namespace where pid 1 is this account's own).
  const pid1Eperm = ((): boolean => {
    try { process.kill(1, 0); return false; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
  })();
  it.skipIf(!pid1Eperm)('a staging file whose pid runs under another account (EPERM) is kept, however old', () => {
    plantTmp('lane-a.json.tmp.1');
    const before = listing();
    const r = backfill();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).not.toHaveProperty('reapedTmp');
    expect(listing()).toEqual(before);
  });

  it('a symlink with the staging name is kept, the link and its target intact', () => {
    const target = path.join(home, 'link-target');
    fs.writeFileSync(target, 'kept\n');
    aged(target);
    const link = at(`lane-a.json.tmp.${DEAD_PID}`);
    fs.symlinkSync(target, link);
    aged(link);
    const before = listing();
    const r = backfill();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).not.toHaveProperty('reapedTmp');
    expect(listing()).toEqual(before);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(link)).toBe(target);
    expect(fs.readFileSync(target, 'utf8')).toBe('kept\n');
  });

  it('a directory with the staging name is kept', () => {
    const d = at(`lane-a.json.tmp.${DEAD_PID}`);
    fs.mkdirSync(d);
    aged(d);
    const before = listing();
    const r = backfill();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).not.toHaveProperty('reapedTmp');
    expect(listing()).toEqual(before);
    expect(fs.lstatSync(d).isDirectory()).toBe(true);
  });

  it('another lane\'s staging file, a suffix that is not a pid, pid 0, models-op\'s own staging spelling and the registry\'s are all kept', () => {
    for (const n of [`lane-b.json.tmp.${DEAD_PID}`, 'lane-a.json.tmp.abc', 'lane-a.json.tmp.0',
      `lane-a.json.${DEAD_PID}.tmp`, `lane-a.classes.json.tmp.${DEAD_PID}`]) plantTmp(n);
    const before = listing();
    const r = backfill();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).not.toHaveProperty('reapedTmp');
    expect(listing()).toEqual(before);
  });

  it('with nothing to reap, the answer carries no reapedTmp key', () => {
    const r = backfill();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).not.toHaveProperty('reapedTmp');
    expect(r.body).toMatchObject({ ok: true, op: 'advance-backfill', id: 'lane-a', created: false });
  });
});

// ── D-8685 (public issue #2607): a stale catalogue under a class model with no measured window ───────────────
// The other way a lane's window falls. `contextWindowFor` reads a model's advertised window only from a FRESH
// catalogue (`providerWindow`), so once the catalogue goes stale a class model nobody measured has no window at all,
// and the lane falls to the client's own default. The live lanes' shape is (b): the move left a model nobody
// measured, from a model nobody measured either, so `unmeasuredMoves` has no measured old window to name. Each case
// moves opus by a real `advance-commit`, then rewrites the catalogue `stale: true` with the same models.
describe('a stale catalogue under a class model with no measured window (D-8685, public issue #2607)', () => {
  const S_NOW = '2026-10-22T10:05:12Z';
  const PROMISED = { ...STEP_CATALOGUE, models: STEP_CATALOGUE.models.map((m) => (m.id === 'model-6.1-gamma'
    ? { ...m, context: 500000 } : m)) };
  const commit = (): Result => opEnv({ CCRC_MODELS_NOW: S_NOW }, 'advance-commit', '--file', rosterPath(),
    '--id', 'lane-a', '--class', 'opus', '--from', 'model-5.6-gamma', '--to', 'model-6.1-gamma', '--canary', 'passed');
  /** The lane after the move, its catalogue now stale (or `fresh` left as it is), and what each reader says. */
  function moveThenStale(byModel: Record<string, number>, o: { fresh?: boolean; dropAdvance?: boolean } = {}): {
    show: unknown; lanes: unknown; room: ReturnType<typeof contextWindowFor>;
  } {
    plantStep({ catalogue: PROMISED });
    plantWindows('lane-a', windowsFor(byModel));
    const c = commit();
    expect(c.body['outcome'], c.stdout + c.stderr).toBe('moved');
    const catalogue = o.fresh === true ? PROMISED : { ...PROMISED, stale: true };
    writeCatalogue('lane-a', catalogue);
    if (o.dropAdvance === true) fs.rmSync(advPath('lane-a'));
    const shown = op('show', '--file', rosterPath(), '--id', 'lane-a');
    expect(shown.code, shown.stdout + shown.stderr).toBe(0);
    const lanes = op('lanes', '--file', rosterPath()).body['lanes'] as Record<string, unknown>[];
    const room = contextWindowFor(parseRegistry(registryOf('lane-a')), parseCatalogue(catalogue),
      parseWindows(JSON.parse(fs.readFileSync(winPath('lane-a'), 'utf8'))));
    return { show: shown.body['windowNotices'], lanes: lanes.find((l) => l['id'] === 'lane-a')!['windowNotices'], room };
  }
  const MEASURED_OLD = { 'model-6-alpha': 400000, 'model-6-beta': 400000, 'model-5.6-gamma': 400000 };
  const UNMEASURED_OLD = { 'model-6-alpha': 400000, 'model-6-beta': 400000 };
  const CLIENT_ROOM = { tokens: 200000, rule: 'default', unmeasured: ['model-6.1-gamma'], model: 'model-6.1-gamma',
    source: 'client' as const };
  /** The move notice (D-8384) the lane already carries in case (a). */
  const MOVE_NOTICE = unmeasuredMoveNotice('lane-a', { class: 'opus', from: 'model-5.6-gamma', to: 'model-6.1-gamma',
    fromTokens: 400000, how: 'advance', cause: 'newer' }, 200000);
  /** lane-a's registry after the move: opus on model-6.1-gamma. */
  const MOVED_REGISTRY = parseRegistry({ ...STEP_REGISTRY, classes: { ...STEP_REGISTRY.classes, opus: 'model-6.1-gamma' },
    effort: { ...STEP_REGISTRY.effort, opus: 'xhigh' } });
  /** What (b) and (c) are named by (D-8685), in its one spelling's literal text. */
  const CLIENT_NOTICE = "lane-a's opus class model model-6.1-gamma has no measured window, and the lane's catalogue is "
    + 'stale, so its advertised window is not read: every session on the lane now runs at the client\'s own default '
    + 'window, 200000 tokens; refresh the catalogue (ccrc models refresh lane-a), or measure model-6.1-gamma, then: '
    + 'ccrc models lane-a set-window model-6.1-gamma <tokens>';

  beforeEach(() => { seed(stepRoster({ ...STEP_PORTS, authDir: codexAuthDir('lane-a') })); });

  it('(a) the move left a measured model: the window falls to the client default, and the move notice alone names it', () => {
    const r = moveThenStale(MEASURED_OLD);
    expect(r.room).toEqual(CLIENT_ROOM);
    expect(r.show).toEqual([MOVE_NOTICE]);
    expect(r.lanes).toEqual(r.show);
  });

  it('(b) the move left an unmeasured model (the live lanes\' shape): the window falls to the client default, named once', () => {
    const r = moveThenStale(UNMEASURED_OLD);
    expect(r.room).toEqual(CLIENT_ROOM);
    expect(r.show).toEqual([CLIENT_NOTICE]);
    expect(r.show).toEqual([clientWindowNotice('lane-a', MOVED_REGISTRY, true, CLIENT_ROOM)]);
    expect(r.lanes).toEqual(r.show);
  });

  it('(c) as (b), with the advance file removed after the move: still named, for it needs no move', () => {
    const r = moveThenStale(UNMEASURED_OLD, { dropAdvance: true });
    expect(r.room).toEqual(CLIENT_ROOM);
    expect(r.show).toEqual([CLIENT_NOTICE]);
    expect(r.lanes).toEqual(r.show);
  });

  // Controls: nothing is named.
  it('the same lane with a FRESH catalogue reads the advertised window, and names nothing', () => {
    const r = moveThenStale(UNMEASURED_OLD, { fresh: true });
    expect(r.room).toMatchObject({ tokens: 400000, rule: 'default', source: 'measured' });
    expect(r.show).toEqual([]);
    expect(r.lanes).toEqual([]);
  });

  it('a stale catalogue on which every class model is measured names nothing', () => {
    const r = moveThenStale({ ...UNMEASURED_OLD, 'model-6.1-gamma': 300000 });
    expect(r.room).toMatchObject({ tokens: 300000, rule: 'measured', source: 'measured' });
    expect(r.show).toEqual([]);
    expect(r.lanes).toEqual([]);
  });

  it('a FRESH catalogue that promises no window (context 0) also falls to the client default, and is not D-8685\'s case', () => {
    // `providerWindow` reads only a positive integer, so `context: 0` promises nothing; `parseCatalogue` accepts it.
    const silent = { ...PROMISED, models: PROMISED.models.map((m) => (m.id === 'model-6.1-gamma' ? { ...m, context: 0 } : m)) };
    plantStep({ catalogue: silent });
    plantWindows('lane-a', windowsFor(UNMEASURED_OLD));
    expect(commit().body['outcome']).toBe('moved');
    const room = contextWindowFor(parseRegistry(registryOf('lane-a')), parseCatalogue(silent),
      parseWindows(JSON.parse(fs.readFileSync(winPath('lane-a'), 'utf8'))));
    expect(room).toEqual(CLIENT_ROOM);
    expect(op('show', '--file', rosterPath(), '--id', 'lane-a').body['windowNotices']).toEqual([]);
    const lanes = op('lanes', '--file', rosterPath()).body['lanes'] as Record<string, unknown>[];
    expect(lanes.find((l) => l['id'] === 'lane-a')!['windowNotices']).toEqual([]);
  });
});

// ── Model-class Anthropic arm A2, Task A2.3: the writer on an Anthropic lane ───────────────────────────────────────
// Plan docs/superpowers/plans/2026-11-18-model-class-advance-anthropic-arm.md. An Anthropic lane carries no registry:
// its own path admits `hold`, `release`, `revert` and `aliases-refresh`, and it keeps the lane's aliases file (what
// each class's alias resolves to) and the holds in its advance file. Every case runs in a fixture HOME with invented
// ids (`claude-opus-9-1`, `claude-opus-9-2`): nothing reads a real home, a cache of the box or a credential.
describe('an anthropic lane: the aliases file, holds and the writer (model-class Anthropic arm A2.3)', () => {
  const LANE = 'lane-a';
  const OTHER = 'lane-b';
  const SUFFIX = '.claude-lane-a';
  const OTHER_SUFFIX = '.claude-lane-b';
  const anthropicRow = (id: string, suffix: string): Record<string, unknown> => ({
    id, label: id, configDirSuffix: suffix, exec: { kind: 'generated' }, homeAble: true, hue: 'violet',
    telemetry: 'anthropic',
  });
  const X1 = 'claude-opus-9-1';
  const X2 = 'claude-opus-9-2';
  const X3 = 'claude-opus-9-3';
  const S1 = 'claude-sonnet-9-1';
  // Times: caches are fetched before the refresh that reads them, each a whole second.
  const C1 = '2026-11-16T00:00:00Z';
  const T0 = '2026-11-16T06:00:00Z';
  const C2 = '2026-11-16T12:00:00Z';
  const T1 = '2026-11-16T18:00:00Z';
  const C3 = '2026-11-17T00:00:00Z';
  const T2 = '2026-11-17T06:00:00Z';
  const T3 = '2026-11-17T12:00:00Z';

  const regDir = (): string => path.join(home, 'reg');
  beforeEach(() => {
    seed({ ...ROSTER, accounts: [...ROSTER.accounts, anthropicRow(LANE, SUFFIX), anthropicRow(OTHER, OTHER_SUFFIX)] });
    fs.mkdirSync(regDir(), { recursive: true });
  });

  const aliasesFile = (id: string = LANE): string => path.join(home, '.ccrc', 'models', aliasesFileName(id));
  const readAliases = (id: string = LANE): Aliases => parseAliases(JSON.parse(fs.readFileSync(aliasesFile(id), 'utf8')));
  const advFile = (id: string = LANE): string => advPath(id);
  const writeText = (p: string, text: string): void => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  };
  /** One catalogue cache file, in the current format: `targets` maps a class to the id its alias resolves to. */
  const cacheJson = (fetchedAt: string, targets: Partial<Record<ModelClass, string>>,
    rows: { id: string; min?: string | null }[]): unknown => ({
    version: 2, fetchedAt: Date.parse(fetchedAt), staleAt: Date.parse(fetchedAt) + 3_600_000, resolution: 'token_org',
    catalog: { config: {
      provider_alias_targets: Object.fromEntries(Object.entries(targets).map(([c, id]) => [c, { default: id }])),
      models: rows.map((r) => ({
        id: r.id, name: `Name ${r.id}`, min_claude_code_version: r.min ?? null,
        runtime: { effort_levels: ['low', 'high'], default_effort: 'high' }, thinking: { type: 'effort' },
      })),
    } },
  });
  const plantCache = (suffix: string, name: string, json: unknown): void => {
    writeText(path.join(home, suffix, 'cache', 'model-catalog', `${name}.json`), `${JSON.stringify(json)}\n`);
  };
  const plantBuild = (suffix: string, version: unknown): void => {
    writeText(path.join(home, suffix, '.last-update-result.json'), `${JSON.stringify({ version_to: version })}\n`);
  };
  /** A launch marker as ccd writes it (Task A3.2): `<born-epoch> <wrapper> <class> <id|->`. */
  const plantLaunch = (sid: string, bornAt: string, wrapper: string, cls: string, id: string): void => {
    writeText(path.join(regDir(), `${sid}.aliaslaunch`), `${Date.parse(bornAt) / 1000} ${wrapper} ${cls} ${id}\n`);
  };
  const refreshArgs = (id: string): string[] => ['aliases-refresh', '--file', rosterPath(), '--id', id, '--reg', regDir()];
  const refresh = (at: string, id: string = LANE, extra: NodeJS.ProcessEnv = {}): Result =>
    opEnv({ CCRC_MODELS_NOW: at, ...extra }, ...refreshArgs(id));
  const adv = (id: string = LANE): Advance => JSON.parse(fs.readFileSync(advFile(id), 'utf8')) as Advance;
  const plantSeeded = (): string => {
    const bytes = serializeAdvance(seedAnthropicAdvance());
    fs.mkdirSync(path.dirname(advFile()), { recursive: true });
    fs.writeFileSync(advFile(), bytes);
    return bytes;
  };
  const hold = (cls = 'opus', id: string = LANE): Result =>
    opEnv({ CCRC_MODELS_NOW: NOW }, 'hold', '--file', rosterPath(), '--id', id, '--class', cls);
  const verbOf = (v: string, cls = 'opus', extra: NodeJS.ProcessEnv = {}): Result =>
    opEnv({ CCRC_MODELS_NOW: NOW, ...extra }, v, '--file', rosterPath(), '--id', LANE, '--class', cls);
  /** The op through a COPY with one line replaced: the one way to make one of its writes fail for real. */
  const copyOf = (line: string, instead: string): string => {
    const src = fs.readFileSync(OP, 'utf8');
    expect(src.split(line), `the op has the line ${line}`).toHaveLength(2);
    const copy = path.join(home, 'models-op-copy.mjs');
    fs.writeFileSync(copy, src.replaceAll("from '../shared/", `from '${pathToFileURL(path.join(REPO, 'shared')).href}/`)
      .replace(line, instead));
    return copy;
  };
  const refreshThrough = (copy: string, at: string): Result => {
    const r = spawnSync(process.execPath, [copy, ...refreshArgs(LANE)],
      { env: { ...process.env, HOME: home, CCRC_MODELS_NOW: at }, encoding: 'utf8' });
    const stdout = r.stdout ?? '';
    expect(stdout.split('\n'), `stdout is not one JSON line: ${JSON.stringify(stdout)} ${r.stderr}`).toHaveLength(2);
    return { code: r.status ?? -1, body: JSON.parse(stdout.split('\n')[0]!), stderr: r.stderr ?? '', stdout };
  };
  /** The baseline every move case starts from: one cache naming X1 for opus, refreshed at T0. */
  const baseline = (rows: { id: string; min?: string | null }[] = [{ id: X1 }]): void => {
    plantCache(SUFFIX, 'cache-fixture', cacheJson(C1, { opus: X1 }, rows));
    const r = refresh(T0);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body['moved']).toEqual([]);
  };

  it("aliases-refresh writes the file: the lane's own cache gives each class its id, 0600, with no advance file made for it", () => {
    plantCache(SUFFIX, 'cache-fixture', cacheJson(C1, { opus: X2, sonnet: S1 }, [{ id: X2 }, { id: S1 }]));
    // Another home's cache is read for ROWS only: its target never names this lane's class.
    plantCache(OTHER_SUFFIX, 'cache-fixture', cacheJson(C3, { opus: X3 }, [{ id: X3 }]));
    const r = refresh(T0);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toEqual({ ok: true, op: 'aliases-refresh', id: LANE, moved: [] });
    const a = readAliases();
    expect(a).toMatchObject({ v: 1, at: T0, stale: false, cache: { fetchedAt: C1, format: 'current' } });
    expect(a.classes.opus).toMatchObject({ id: X2, source: 'cache', evidenceAt: C1, idSince: T0, cacheTarget: X2 });
    expect(a.classes.sonnet).toMatchObject({ id: S1, source: 'cache' });
    expect(a.classes.haiku.id).toBeNull();
    expect(a.classes.opus.row).toMatchObject({ id: X2, label: `Name ${X2}` });
    expect(fs.statSync(aliasesFile()).mode & 0o777).toBe(0o600);
    expect(fs.existsSync(advFile()), 'a refresh with no move makes no advance file').toBe(false);
  });

  it("aliases-refresh reads a row from another home, by id, and never that home's target", () => {
    plantCache(SUFFIX, 'cache-fixture', cacheJson(C1, { opus: X2 }, []));
    plantCache(OTHER_SUFFIX, 'cache-fixture', cacheJson(C3, { opus: X3 }, [{ id: X2, min: null }, { id: X3 }]));
    expect(refresh(T0).code).toBe(0);
    const o = readAliases().classes.opus;
    expect(o).toMatchObject({ id: X2, rowFrom: 'box', cacheTarget: X2 });
    expect(o.row).toMatchObject({ id: X2 });
  });

  it("aliases-refresh reads the lane's build and a home with no cache reads as absent", () => {
    plantBuild(SUFFIX, '9.2.0');
    writeText(path.join(home, SUFFIX, 'settings.json'), JSON.stringify({
      env: { SOME_KEY: 'x' }, modelSettings: { [X1]: { effortLevel: 'high' }, 'not a model id!': { effortLevel: 'low' } },
    }));
    plantCache(SUFFIX, 'cache-fixture', cacheJson(C1, { opus: X2 }, [{ id: X2, min: '9.9.0' }]));
    expect(refresh(T0).code).toBe(0);
    // The build (9.2.0) is below the row's minimum, so the target is no candidate.
    expect(readAliases().classes.opus.id).toBeNull();
    expect(readAliases().cache).toEqual({ fetchedAt: C1, format: 'current' });
    expect(refresh(T1, OTHER).code).toBe(0);
    expect(readAliases(OTHER).cache).toEqual({ none: 'absent' });
    expect(readAliases(OTHER).classes.opus.id).toBeNull();
  });

  it('saved levels reach the file: a level under another id of the class is orphaned, a level under the current id is not', () => {
    writeText(path.join(home, SUFFIX, 'settings.json'), JSON.stringify({
      modelSettings: { [X1]: { effortLevel: 'high' }, [X2]: { effortLevel: 7 }, 'not a model id!': { effortLevel: 'low' } },
    }));
    plantCache(SUFFIX, 'cache-fixture', cacheJson(C1, { opus: X2 }, [{ id: X2 }]));
    expect(refresh(T0).code).toBe(0);
    expect(readAliases().classes.opus.orphaned).toEqual({ id: X1, level: 'high' });
    writeText(path.join(home, SUFFIX, 'settings.json'), JSON.stringify({
      modelSettings: { [X1]: { effortLevel: 'high' }, [X2]: { effortLevel: 'low' } },
    }));
    expect(refresh(T1).code).toBe(0);
    expect(readAliases().classes.opus.orphaned).toBeNull();
  });

  it('an unreadable cache directory is cache.none unreadable, and a build that is no version reads as unknown', () => {
    writeText(path.join(home, SUFFIX, 'cache', 'model-catalog'), 'a file where the directory belongs');
    plantBuild(SUFFIX, { not: 'a version' });
    expect(refresh(T0).code).toBe(0);
    expect(readAliases().cache).toEqual({ none: 'unreadable' });
  });

  it('a cache file that is not JSON is cache.none invalid', () => {
    writeText(path.join(home, SUFFIX, 'cache', 'model-catalog', 'cache-fixture.json'), '{ not json');
    expect(refresh(T0).code).toBe(0);
    expect(readAliases().cache).toEqual({ none: 'invalid' });
  });

  it('aliases-refresh records a move: the second refresh after the target moved appends one entry, sets previous and names it', () => {
    baseline([{ id: X1 }, { id: X2 }]);
    plantCache(SUFFIX, 'cache-fixture', cacheJson(C2, { opus: X2 }, [{ id: X1 }, { id: X2 }]));
    const r = refresh(T1);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body['moved']).toEqual([{ class: 'opus', from: X1, to: X2 }]);
    expect(readAliases().classes.opus).toMatchObject({ id: X2, evidenceAt: C2, idSince: T1 });
    const opus = adv().classes.opus;
    expect(opus.history).toHaveLength(1);
    expect(opus.previous).toEqual({ model: X1, effort: null });
    for (const c of CLASSES.filter((k) => k !== 'opus')) expect(adv().classes[c].history).toEqual([]);
  });

  it("a move's entry is complete: ok, cause newer, the evidence time, and lastMoveOf returns it", () => {
    baseline([{ id: X1 }, { id: X2 }]);
    plantCache(SUFFIX, 'cache-fixture', cacheJson(C2, { opus: X2 }, [{ id: X1 }, { id: X2 }]));
    expect(refresh(T1).code).toBe(0);
    const entry = adv().classes.opus.history[0]!;
    expect(entry).toEqual({ at: T1, how: 'advance', from: X1, to: X2, ok: true, canary: 'not-run', cause: 'newer',
      evidenceAt: C2 });
    expect(lastMoveOf(adv().classes.opus)).toEqual(entry);
    expect(causeOf(entry)).toBe('newer');
    expect(adv().pending).toBeNull();
    expect(adv().classes.opus.family).toBe('opus');
  });

  it('a source change is not a move: the cache then a newer launch of the same id records nothing', () => {
    baseline();
    const seeded = plantSeeded();
    plantLaunch('s1', C2, LANE, 'opus', X1);
    const r = refresh(T1);
    expect(r.body['moved']).toEqual([]);
    expect(readAliases().classes.opus).toMatchObject({ id: X1, source: 'use', seenId: X1 });
    expect(fs.readFileSync(advFile(), 'utf8')).toBe(seeded);
  });

  it('a first id is not a move: null to an id records no entry, no previous and no push', () => {
    const seeded = plantSeeded();
    plantCache(SUFFIX, 'cache-fixture', cacheJson(C1, { opus: X1 }, [{ id: X1 }]));
    const r = refresh(T0);
    expect(r.body['moved']).toEqual([]);
    expect(readAliases().classes.opus).toMatchObject({ id: X1, idSince: T0 });
    expect(fs.readFileSync(advFile(), 'utf8')).toBe(seeded);
  });

  it('a swap and a wake record no backward move: a marker that goes never hands the class back, and nothing is recorded', () => {
    const seeded = plantSeeded();
    // No usable cache. S1 was marked before a release and filled X1; S2 was marked after it and filled X2.
    plantLaunch('s1', '2026-11-16T01:00:00Z', LANE, 'opus', X1);
    plantLaunch('s2', '2026-11-16T03:00:00Z', LANE, 'opus', X2);
    expect(refresh(T0).body['moved']).toEqual([]);
    expect(readAliases().classes.opus).toMatchObject({ id: X2, source: 'use', seenId: X2 });
    // A swap or a wake's respawn removes S2's marker.
    fs.rmSync(path.join(regDir(), 's2.aliaslaunch'));
    const second = refresh(T1);
    expect(second.body['moved']).toEqual([]);
    expect(readAliases().classes.opus).toMatchObject({ id: X2, seenId: X2 });
    // And S1's too.
    fs.rmSync(path.join(regDir(), 's1.aliaslaunch'));
    expect(refresh(T2).body['moved']).toEqual([]);
    expect(readAliases().classes.opus.id).toBe(X2);
    expect(fs.readFileSync(advFile(), 'utf8'), 'no history entry and no previous').toBe(seeded);
  });

  it('a marker of another lane, an unfilled one, an unknown class and a malformed one are not readings; a 1M reading fills the bare id', () => {
    plantLaunch('s1', '2026-11-16T01:00:00Z', OTHER, 'opus', X2);
    plantLaunch('s2', '2026-11-16T01:00:00Z', LANE, 'opus', '-');
    plantLaunch('s3', '2026-11-16T01:00:00Z', LANE, 'turbo', X2);
    writeText(path.join(regDir(), 's4.aliaslaunch'), 'not a marker\n');
    writeText(path.join(regDir(), 's5.aliaslaunch'), `${'9'.repeat(5000)}\n`);
    plantLaunch('s6', '2026-11-16T01:00:00Z', LANE, 'sonnet', `${S1}[1m]`);
    expect(refresh(T0).code).toBe(0);
    const a = readAliases();
    expect(a.classes.opus.id).toBeNull();
    expect(a.classes.sonnet).toMatchObject({ id: S1, source: 'use', seenId: S1 });
  });

  it('a stale cache records no backward move: a launch older than the cache never hands the class back', () => {
    plantCache(SUFFIX, 'cache-fixture', cacheJson('2026-11-10T00:00:00Z', { opus: X2 }, [{ id: X1 }, { id: X2 }]));
    expect(refresh('2026-11-12T00:00:00Z').code).toBe(0);
    const seeded = plantSeeded();
    plantLaunch('s1', '2026-11-08T00:00:00Z', LANE, 'opus', X1);
    const r = refresh('2026-11-20T00:00:00Z');
    expect(r.body['moved']).toEqual([]);
    expect(readAliases()).toMatchObject({ stale: true });
    expect(readAliases().classes.opus).toMatchObject({ id: X2, source: 'cache' });
    expect(fs.readFileSync(advFile(), 'utf8')).toBe(seeded);
  });

  it('an unreadable prior is never written over: the cause word, both files and the advance mtime untouched', () => {
    baseline();
    const seeded = plantSeeded();
    fs.rmSync(aliasesFile());
    fs.mkdirSync(aliasesFile());
    plantCache(SUFFIX, 'cache-fixture', cacheJson(C2, { opus: X2 }, [{ id: X1 }, { id: X2 }]));
    const advMtime = fs.statSync(advFile()).mtimeMs;
    const r = refresh(T1);
    expect([r.code, r.body['error']], r.stdout + r.stderr).toEqual([1, 'aliases-file-unreadable']);
    expect(r.body['moved']).toBeUndefined();
    expect(fs.statSync(aliasesFile()).isDirectory()).toBe(true);
    expect(fs.readFileSync(advFile(), 'utf8')).toBe(seeded);
    expect(fs.statSync(advFile()).mtimeMs).toBe(advMtime);
  });

  it("an invalid prior is never written over: the cause word, the file's bytes and mtime, and the advance file untouched", () => {
    baseline();
    const seeded = plantSeeded();
    const bad = '{"v": 2}\n';
    fs.writeFileSync(aliasesFile(), bad);
    const mtime = fs.statSync(aliasesFile()).mtimeMs;
    const advMtime = fs.statSync(advFile()).mtimeMs;
    plantCache(SUFFIX, 'cache-fixture', cacheJson(C2, { opus: X2 }, [{ id: X1 }, { id: X2 }]));
    const r = refresh(T1);
    expect([r.code, r.body['error']], r.stdout + r.stderr).toEqual([1, 'aliases-file-invalid']);
    expect(r.body['moved']).toBeUndefined();
    expect(fs.readFileSync(aliasesFile(), 'utf8')).toBe(bad);
    expect(fs.statSync(aliasesFile()).mtimeMs).toBe(mtime);
    expect(fs.readFileSync(advFile(), 'utf8')).toBe(seeded);
    expect(fs.statSync(advFile()).mtimeMs).toBe(advMtime);
  });

  it('an advance file it cannot read refuses the refresh and writes neither file', () => {
    baseline();
    const aliases0 = fs.readFileSync(aliasesFile(), 'utf8');
    fs.writeFileSync(advFile(), '{"v": 2}');
    plantCache(SUFFIX, 'cache-fixture', cacheJson(C2, { opus: X2 }, [{ id: X1 }, { id: X2 }]));
    const r = refresh(T1);
    expect([r.code, r.body['error']]).toEqual([1, 'advance-file-invalid']);
    expect(fs.readFileSync(advFile(), 'utf8')).toBe('{"v": 2}');
    expect(fs.readFileSync(aliasesFile(), 'utf8')).toBe(aliases0);
  });

  it.each([
    ['the aliases write fails after the move is recorded', "  return writeJsonFile(aliasesPath(id), parsed, 'aliases-unwritable');",
      "  return writeJsonFile(path.join(advancePath(id), 'x'), parsed, 'aliases-unwritable');", 'aliases-unwritable', 1],
    ['the advance write fails before anything is recorded', "  return writeJsonFile(advancePath(id), parsed, 'advance-unwritable');",
      "  return writeJsonFile(path.join(aliasesPath(id), 'x'), parsed, 'advance-unwritable');", 'advance-unwritable', 0],
  ] as [string, string, string, string, number][])('a cut-short move is recorded once when newer evidence arrives: %s', (_w, line, instead, error, entries) => {
    baseline([{ id: X1 }, { id: X2 }]);
    plantCache(SUFFIX, 'cache-fixture', cacheJson(C2, { opus: X2 }, [{ id: X1 }, { id: X2 }]));
    const cut = refreshThrough(copyOf(line, instead), T1);
    expect([cut.code, cut.body['error']], cut.stdout + cut.stderr).toEqual([1, error]);
    expect(cut.body['moved'], 'the cut refresh answered no move').toBeUndefined();
    expect(readAliases().classes.opus).toMatchObject({ id: X1, idSince: T0 });
    expect(fs.existsSync(advFile()) ? adv().classes.opus.history : []).toHaveLength(entries);
    // Newer evidence for X2 arrives (a cache refetched later); the next refresh runs at T2.
    plantCache(SUFFIX, 'cache-fixture', cacheJson(C3, { opus: X2 }, [{ id: X1 }, { id: X2 }]));
    const next = refresh(T2);
    expect(next.code, next.stdout + next.stderr).toBe(0);
    expect(next.body['moved']).toEqual([{ class: 'opus', from: X1, to: X2 }]);
    expect(adv().classes.opus.history, 'one entry for the move, whichever file was cut').toHaveLength(1);
    expect(adv().classes.opus.history[0]).toMatchObject({ from: X1, to: X2, at: entries === 1 ? T1 : T2 });
    expect(adv().classes.opus.previous).toEqual({ model: X1, effort: null });
    expect(readAliases().classes.opus).toMatchObject({ id: X2, evidenceAt: C3 });
    // And a refresh after that finds nothing to say.
    expect(refresh(T3).body['moved']).toEqual([]);
    expect(adv().classes.opus.history).toHaveLength(1);
  });

  it('a repeated move gets its own entry: X1 to X2, X2 unlaunchable and replaced by X1 with no move, then X1 to X2 again', () => {
    plantBuild(SUFFIX, '9.2.0');
    const rows = [{ id: X1 }, { id: X2, min: '9.2.0' }];
    plantCache(SUFFIX, 'cache-fixture', cacheJson(C1, { opus: X1 }, rows));
    expect(refresh(T0).body['moved']).toEqual([]);
    plantCache(SUFFIX, 'cache-fixture', cacheJson(C2, { opus: X2 }, rows));
    expect(refresh(T1).body['moved']).toEqual([{ class: 'opus', from: X1, to: X2 }]);
    expect(adv().classes.opus.history).toHaveLength(1);
    // The lane's build falls below X2's minimum; a fresh launch fills X1, which replaces X2 with no move.
    plantBuild(SUFFIX, '9.1.0');
    plantLaunch('s1', '2026-11-16T14:00:00Z', LANE, 'opus', X1);
    const replaced = refresh(T2);
    expect(replaced.body['moved']).toEqual([]);
    expect(readAliases().classes.opus).toMatchObject({ id: X1, source: 'use', idSince: T2 });
    expect(adv().classes.opus.history).toHaveLength(1);
    // The build returns and a refetched cache names X2 again.
    plantBuild(SUFFIX, '9.2.0');
    plantCache(SUFFIX, 'cache-fixture', cacheJson(C3, { opus: X2 }, rows));
    const again = refresh(T3);
    expect(again.body['moved']).toEqual([{ class: 'opus', from: X1, to: X2 }]);
    const h = adv().classes.opus.history;
    expect(h).toHaveLength(2);
    expect(h[1]).toMatchObject({ at: T3, from: X1, to: X2, ok: true });
    expect(adv().classes.opus.previous).toEqual({ model: X1, effort: null });
  });

  it("an unlaunchable id's replacement is not a move, and neither is the id staying unlaunchable", () => {
    plantBuild(SUFFIX, '9.2.0');
    const rows = [{ id: X2, min: '9.2.0' }, { id: X3 }];
    plantCache(SUFFIX, 'cache-fixture', cacheJson(C1, { opus: X2 }, rows));
    expect(refresh(T0).code).toBe(0);
    const seeded = plantSeeded();
    plantBuild(SUFFIX, '9.1.0');
    expect(refresh(T1).body['moved']).toEqual([]);
    expect(readAliases().classes.opus).toMatchObject({ id: X2, unobserved: true, unlaunchable: { needs: '9.2.0', laneVersion: '9.1.0' } });
    plantLaunch('s1', '2026-11-16T12:00:00Z', LANE, 'opus', X3);
    const r = refresh(T2);
    expect(r.body['moved']).toEqual([]);
    expect(readAliases().classes.opus).toMatchObject({ id: X3, unlaunchable: null });
    expect(fs.readFileSync(advFile(), 'utf8')).toBe(seeded);
  });

  it("hold records the held id: the class's current id from the aliases file, and the first hold seeds the advance file with the class words", () => {
    plantCache(SUFFIX, 'cache-fixture', cacheJson(C1, { opus: X2 }, [{ id: X2 }]));
    expect(refresh(T0).code).toBe(0);
    expect(fs.existsSync(advFile())).toBe(false);
    const r = hold();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toMatchObject({ ok: true, op: 'hold', class: 'opus', changed: true, anthropic: true });
    const a = adv();
    expect(a.classes.opus.hold).toEqual({ at: NOW, by: 'hand', model: X2 });
    for (const c of CLASSES) {
      expect(a.classes[c].family, `${c}'s family is its own class word`).toBe(c);
      expect(a.classes[c].previous).toBeNull();
      expect(a.classes[c].history).toEqual([]);
    }
    expect(a.pending).toBeNull();
    expect(parseAdvance(a)).toEqual(a);
    // A second hold changes nothing.
    const held = fs.readFileSync(advFile(), 'utf8');
    expect(opEnv({ CCRC_MODELS_NOW: T3 }, 'hold', '--file', rosterPath(), '--id', LANE, '--class', 'opus').body).toMatchObject({ changed: false });
    expect(fs.readFileSync(advFile(), 'utf8')).toBe(held);
  });

  it('hold with no id refuses alias-source-absent, writing nothing: no aliases file, a class with no id, or an unlaunchable id', () => {
    const r0 = hold();
    expect([r0.code, r0.body['error']], r0.stdout + r0.stderr).toEqual([1, 'alias-source-absent']);
    expect(fs.existsSync(advFile())).toBe(false);
    plantBuild(SUFFIX, '9.2.0');
    plantCache(SUFFIX, 'cache-fixture', cacheJson(C1, { opus: X2 }, [{ id: X2, min: '9.2.0' }]));
    expect(refresh(T0).code).toBe(0);
    expect(hold('sonnet').body['error']).toBe('alias-source-absent');
    plantBuild(SUFFIX, '9.1.0');
    expect(refresh(T2).code).toBe(0);
    expect(readAliases().classes.opus.unlaunchable).not.toBeNull();
    expect(hold('opus').body['error']).toBe('alias-source-absent');
    expect(fs.existsSync(advFile())).toBe(false);
  });

  it.each([
    ['unreadable', 'aliases-file-unreadable', (p: string): void => { fs.mkdirSync(p); }],
    ['invalid', 'aliases-file-invalid', (p: string): void => { fs.writeFileSync(p, '{"v": 2}\n'); }],
  ] as [string, string, (p: string) => void][])('hold refuses an aliases file that is %s, naming it, and writes nothing', (_w, word, plant) => {
    fs.mkdirSync(path.dirname(aliasesFile()), { recursive: true });
    plant(aliasesFile());
    const r = hold();
    expect([r.code, r.body['error']], r.stdout + r.stderr).toEqual([1, word]);
    expect(fs.existsSync(advFile())).toBe(false);
  });

  it("hold refuses settings-overrides-hold when the home's settings env names that class's key, and a key of another class does not", () => {
    plantCache(SUFFIX, 'cache-fixture', cacheJson(C1, { opus: X2 }, [{ id: X2 }]));
    expect(refresh(T0).code).toBe(0);
    writeText(path.join(home, SUFFIX, 'settings.json'), JSON.stringify({ env: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'something' } }));
    const r = hold();
    expect([r.code, r.body['error']], r.stdout + r.stderr).toEqual([1, 'settings-overrides-hold']);
    expect(fs.existsSync(advFile())).toBe(false);
    writeText(path.join(home, SUFFIX, 'settings.json'), JSON.stringify({ env: { ANTHROPIC_DEFAULT_SONNET_MODEL: 'something' } }));
    expect(hold().code).toBe(0);
  });

  it('revert holds the previous id: by revert, at previous.model, records no history entry and keeps previous', () => {
    baseline([{ id: X1 }, { id: X2 }]);
    plantCache(SUFFIX, 'cache-fixture', cacheJson(C2, { opus: X2 }, [{ id: X1 }, { id: X2 }]));
    expect(refresh(T1).code).toBe(0);
    const r = verbOf('revert');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const opus = adv().classes.opus;
    expect(opus.hold).toEqual({ at: NOW, by: 'revert', model: X1 });
    expect(opus.history).toHaveLength(1);
    expect(opus.previous).toEqual({ model: X1, effort: null });
  });

  it('revert with nothing to revert to refuses no-previous, and a settings key refuses a revert too', () => {
    const r = verbOf('revert');
    expect([r.code, r.body['error']]).toEqual([1, 'no-previous']);
    expect(fs.existsSync(advFile())).toBe(false);
    baseline([{ id: X1 }, { id: X2 }]);
    plantCache(SUFFIX, 'cache-fixture', cacheJson(C2, { opus: X2 }, [{ id: X1 }, { id: X2 }]));
    expect(refresh(T1).code).toBe(0);
    const before = fs.readFileSync(advFile(), 'utf8');
    writeText(path.join(home, SUFFIX, 'settings.json'), JSON.stringify({ env: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'something' } }));
    expect(verbOf('revert').body['error']).toBe('settings-overrides-hold');
    expect(fs.readFileSync(advFile(), 'utf8')).toBe(before);
  });

  it('release keeps releasedAt and spends no history: ten entries before, ten after, lastMoveOf unchanged', () => {
    const a = seedAnthropicAdvance();
    a.classes.opus.history = Array.from({ length: 10 }, (_v, i) => ({
      at: `2026-11-${String(i + 1).padStart(2, '0')}T00:00:00Z`, how: 'advance' as const, from: X1, to: X2, ok: true, canary: 'not-run' as const,
      cause: 'newer' as const,
    }));
    a.classes.opus.hold = { at: '2026-11-12T00:00:00Z', by: 'hand', model: X2 };
    fs.mkdirSync(path.dirname(advFile()), { recursive: true });
    fs.writeFileSync(advFile(), serializeAdvance(a));
    const lastBefore = lastMoveOf(a.classes.opus);
    const r = verbOf('release');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body).toMatchObject({ op: 'release', changed: true });
    const after = adv().classes.opus;
    expect(after.hold).toBeNull();
    expect(after['releasedAt']).toBe(NOW);
    expect(after.history).toEqual(a.classes.opus.history);
    expect(after.history).toHaveLength(10);
    expect(lastMoveOf(after)).toEqual(lastBefore);
    // A release of a class not held changes nothing and keeps the earlier releasedAt.
    expect(opEnv({ CCRC_MODELS_NOW: T3 }, 'release', '--file', rosterPath(), '--id', LANE, '--class', 'opus').body)
      .toMatchObject({ changed: false });
    expect(adv().classes.opus['releasedAt']).toBe(NOW);
  });

  it('set-class still refuses anthropic-lane, and so does every other registry op', () => {
    for (const args of [['set-class', '--class', 'opus', '--model', X2], ['set-subagent', '--class', 'haiku'],
      ['materialise'], ['advance-backfill'], ['init', '--probe', 'codex']]) {
      const r = op(args[0]!, '--file', rosterPath(), '--id', LANE, ...args.slice(1));
      expect([r.code, r.body['error']], args[0]).toEqual([1, 'anthropic-lane']);
    }
    expect(fs.existsSync(path.join(home, '.ccrc', 'models', `${LANE}.classes.json`))).toBe(false);
  });

  it('aliases-refresh refuses a lane that is not an Anthropic lane, and an unknown account', () => {
    const r = refresh(T0, 'gpt');
    expect([r.code, r.body['error']]).toEqual([1, 'not-an-anthropic-lane']);
    expect(refresh(T0, 'ghost').body['error']).toBe('no-such-account');
  });

  it('aliases-refresh needs --reg, an absolute one', () => {
    expect(op('aliases-refresh', '--file', rosterPath(), '--id', LANE).code).toBe(2);
    const r = op('aliases-refresh', '--file', rosterPath(), '--id', LANE, '--reg', 'reg');
    expect([r.code, r.body['error']]).toEqual([2, 'bad-argv']);
  });

  it('an absent session registry means no launches', () => {
    fs.rmSync(regDir(), { recursive: true });
    expect(refresh(T0).code).toBe(0);
    expect(readAliases().classes.opus.id).toBeNull();
  });

  it("rm reaps the aliases file and still clears only ccrc's keys from the settings", () => {
    plantCache(SUFFIX, 'cache-fixture', cacheJson(C1, { opus: X2 }, [{ id: X2 }]));
    expect(refresh(T0).code).toBe(0);
    writeText(path.join(home, SUFFIX, 'settings.json'), JSON.stringify({
      env: { DISABLE_TELEMETRY: '1', ANTHROPIC_DEFAULT_OPUS_MODEL: 'x' }, model: 'kept', modelSettings: { [X2]: { effortLevel: 'high' } },
    }));
    const r = op('rm', '--file', rosterPath(), '--id', LANE);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.body['removed']).toContain(aliasesFile());
    expect(fs.existsSync(aliasesFile())).toBe(false);
    const s = JSON.parse(fs.readFileSync(path.join(home, SUFFIX, 'settings.json'), 'utf8'));
    expect(s).toEqual({ env: { DISABLE_TELEMETRY: '1' }, model: 'kept', modelSettings: { [X2]: { effortLevel: 'high' } } });
  });

  it("refresh and hold never write the home's settings, a cache or a build file", () => {
    plantCache(SUFFIX, 'cache-fixture', cacheJson(C1, { opus: X2 }, [{ id: X2 }]));
    plantBuild(SUFFIX, '9.2.0');
    writeText(path.join(home, SUFFIX, 'settings.json'), '{"env":{"A":"1"}}\n');
    const snap = (): string[] => ['settings.json', '.last-update-result.json', 'cache/model-catalog/cache-fixture.json']
      .map((n) => `${fs.readFileSync(path.join(home, SUFFIX, n), 'utf8')}@${fs.statSync(path.join(home, SUFFIX, n)).mtimeMs}`);
    const before = snap();
    expect(refresh(T0).code).toBe(0);
    expect(hold().code).toBe(0);
    expect(snap()).toEqual(before);
  });

  it('lanes lists an Anthropic lane: anthropic true, no registry, no other kind field, and ids null with no aliases file (D-8751)', () => {
    const rows = op('lanes', '--file', rosterPath()).body['lanes'] as Record<string, unknown>[];
    const row = rows.find((l) => l['id'] === LANE)!;
    expect(row).toEqual({
      id: LANE, configDirSuffix: SUFFIX, anthropic: true, hasRegistry: false, registryInvalid: null,
      catalogueInvalid: null, probe: null, baseUrl: null, windowNotices: [], ids: null,
    });
    expect(rows.find((l) => l['id'] === OTHER)).toMatchObject({ anthropic: true, hasRegistry: false });
    // A registry row is unchanged: it carries no `ids` and is not Anthropic.
    const reg = rows.find((l) => l['id'] === 'gpt')!;
    expect(reg).toMatchObject({ anthropic: false });
    expect(reg).not.toHaveProperty('ids');
    // An aliases file that cannot be read or is not one this build reads is `ids: null` too, and the lane stays listed.
    fs.mkdirSync(path.dirname(aliasesFile()), { recursive: true });
    fs.writeFileSync(aliasesFile(), '{"v": 2}\n');
    expect((op('lanes', '--file', rosterPath()).body['lanes'] as Record<string, unknown>[])
      .find((l) => l['id'] === LANE)).toMatchObject({ anthropic: true, ids: null });
    fs.rmSync(aliasesFile());
    fs.mkdirSync(aliasesFile());
    expect((op('lanes', '--file', rosterPath()).body['lanes'] as Record<string, unknown>[])
      .find((l) => l['id'] === LANE)).toMatchObject({ anthropic: true, ids: null });
  });

  it('lanes carries both ids: the id kept, the cache target and the id a fresh launch reported, when they disagree (D-8751)', () => {
    plantCache(SUFFIX, 'cache-fixture', cacheJson(C1, { opus: X1, sonnet: S1 }, [{ id: X1 }, { id: X2 }, { id: S1 }]));
    plantLaunch('s1', C2, LANE, 'opus', X2);
    expect(refresh(T0).code).toBe(0);
    const row = (op('lanes', '--file', rosterPath()).body['lanes'] as Record<string, unknown>[])
      .find((l) => l['id'] === LANE)!;
    const ids = row['ids'] as Record<string, unknown>;
    expect(Object.keys(ids)).toEqual(['haiku', 'sonnet', 'opus', 'fable']);
    expect(ids['opus']).toEqual({ id: X2, cacheTarget: X1, seenId: X2 });
    expect(ids['sonnet']).toEqual({ id: S1, cacheTarget: S1, seenId: null });
    expect(ids['haiku']).toEqual({ id: null, cacheTarget: null, seenId: null });
    // The other lane has no aliases file: its ids are null, not an empty object.
    expect((op('lanes', '--file', rosterPath()).body['lanes'] as Record<string, unknown>[])
      .find((l) => l['id'] === OTHER)).toMatchObject({ ids: null });
  });

  it('show answers aliases beside advance: the parsed file, or its state', () => {
    const absent = op('show', '--file', rosterPath(), '--id', LANE);
    expect(absent.body['aliases']).toEqual({ state: 'absent' });
    plantCache(SUFFIX, 'cache-fixture', cacheJson(C1, { opus: X2 }, [{ id: X2 }]));
    expect(refresh(T0).code).toBe(0);
    const ok = op('show', '--file', rosterPath(), '--id', LANE);
    expect(ok.body['aliases']).toEqual(JSON.parse(fs.readFileSync(aliasesFile(), 'utf8')));
    expect(ok.body['advance']).toEqual({ state: 'absent' });
    fs.writeFileSync(aliasesFile(), '{"v": 2}\n');
    expect(op('show', '--file', rosterPath(), '--id', LANE).body['aliases']).toMatchObject({ state: 'invalid' });
    fs.rmSync(aliasesFile());
    fs.mkdirSync(aliasesFile());
    expect(op('show', '--file', rosterPath(), '--id', LANE).body['aliases']).toMatchObject({ state: 'unreadable' });
    // A lane that carries a registry answers no `aliases` at all.
    expect(op('show', '--file', rosterPath(), '--id', 'gpt').body).not.toHaveProperty('aliases');
  });

  it('nothing reads a secret path: the op and the resolver name no credential file', () => {
    // The three names are built from halves so this file does not spell them either.
    const names = [`.cred${'entials'}`, `.cc-sec${'rets'}`, `oauth${'Account'}`];
    for (const f of [OP, path.join(REPO, 'shared', 'model-aliases.mjs')]) {
      const src = fs.readFileSync(f, 'utf8');
      for (const word of names) expect(src.includes(word), `${path.basename(f)} names ${word}`).toBe(false);
    }
  });
});
