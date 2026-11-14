// D-8406: the session's model picker names a class's model from the lane's own files, never from a name the tree
// spells. Three layers, each against fixture files only: the models kernel's derivation (`laneClassModels`) and the
// read grant's shape (`isLaneModelsReadName`), the server's reader (`readLaneModels`), and `GET /api/models/:lane`.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import type { FleetIO } from '../src/io.js';
import { readLaneModels } from '../src/laneModels.js';
import {
  MODELS_DIR_NAME, catalogueFileName, isLaneModelsReadName, laneClassModels, parseCatalogue, parseRegistry,
  registryFileName, type LaneModelsAnswer,
} from '../../shared/models.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const REGISTRY = {
  probe: 'codex', subagent: 'sonnet', discovery: 'catalogue',
  classes: { haiku: 'gpt-6-luna', sonnet: 'gpt-6.1-terra', opus: 'gpt-6.1-sol', fable: 'gpt-6-astra' },
};
const CATALOGUE = {
  probe: 'codex', fetchedAt: 1_700_000_000_000,
  models: [
    { id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol' }, { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra' },
    { id: 'gpt-6-luna', label: 'GPT-6 Luna' }, { id: 'gpt-6-astra', label: 'GPT-6-Astra' },
    { id: 'gpt-6.2-sol', label: 'GPT-6.2-Sol' },
  ],
};

/** Writes a lane's two files into a fixture home's `~/.ccrc/models`; `null` leaves that file out. */
function seedLane(home: string, lane: string, registry: unknown | null, catalogue: unknown | null): void {
  const dir = path.join(home, '.ccrc', MODELS_DIR_NAME);
  mkdirSync(dir, { recursive: true });
  const put = (name: string, v: unknown): void => {
    writeFileSync(path.join(dir, name), typeof v === 'string' ? v : JSON.stringify(v));
  };
  if (registry !== null) put(registryFileName(lane), registry);
  if (catalogue !== null) put(catalogueFileName(lane), catalogue);
}

describe('laneClassModels (D-8406)', () => {
  it('names each class by its registry model and that model\'s catalogue label', () => {
    expect(laneClassModels(parseRegistry(REGISTRY), parseCatalogue(CATALOGUE))).toEqual({
      haiku: { model: 'gpt-6-luna', label: 'GPT-6 Luna' },
      sonnet: { model: 'gpt-6.1-terra', label: 'GPT-6.1 Terra' },
      opus: { model: 'gpt-6.1-sol', label: 'GPT-6.1-Sol' },
      fable: { model: 'gpt-6-astra', label: 'GPT-6-Astra' },
    });
  });

  it('a model advance in the registry moves the label with it, with no code change', () => {
    const advanced = { ...REGISTRY, classes: { ...REGISTRY.classes, opus: 'gpt-6.2-sol' } };
    expect(laneClassModels(parseRegistry(advanced), parseCatalogue(CATALOGUE)).opus)
      .toEqual({ model: 'gpt-6.2-sol', label: 'GPT-6.2-Sol' });
  });

  it('no catalogue, or no row for the model, is a null label; a null slot is a null model', () => {
    const noFable = { ...REGISTRY, classes: { ...REGISTRY.classes, fable: null } };
    const out = laneClassModels(parseRegistry(noFable), null);
    expect(out.fable).toEqual({ model: null, label: null });
    expect(out.opus).toEqual({ model: 'gpt-6.1-sol', label: null });
    const thin = parseCatalogue({ ...CATALOGUE, models: [{ id: 'gpt-6-luna' }] });
    // A row with no label carries its id as the label (`parseCatalogue`); a model with no row has none.
    expect(laneClassModels(parseRegistry(REGISTRY), thin).haiku).toEqual({ model: 'gpt-6-luna', label: 'gpt-6-luna' });
    expect(laneClassModels(parseRegistry(REGISTRY), thin).sonnet).toEqual({ model: 'gpt-6.1-terra', label: null });
  });
});

describe('isLaneModelsReadName (D-8406): the read grant admits a lane\'s registry and catalogue and nothing else', () => {
  it.each([
    ['lane-a.classes.json', true], ['lane-a.json', true], ['a.json', true],
    ['lane-a.effort.json', false], ['lane-a.windows.json', false], ['lane-a.advance.json', false],
    ['lane-a.classes.tsv', false], ['lane-a.aliases.json', false], ['litellm.json', false], ['refresh.json', false],
    ['Lane-a.json', false], ['1lane.json', false], ['../lane-a.json', false], ['lane-a/x.json', false], ['.json', false],
    ['lane-a.json.bak', false], [`${'a'.repeat(33)}.json`, false], ['', false],
  ])('%s -> %s', (name, want) => {
    expect(isLaneModelsReadName(name)).toBe(want);
  });

  it('refuses a value that is not a string', () => {
    expect(isLaneModelsReadName(undefined)).toBe(false);
    expect(isLaneModelsReadName(42)).toBe(false);
  });
});

describe('readLaneModels (D-8406)', () => {
  it('reads the registry and the catalogue through the fleet io', async () => {
    const deps = testDeps(mkTmp('ccrc-lanemodels-'));
    seedLane(deps.cfg.home, 'gpt', REGISTRY, CATALOGUE);
    const r = await readLaneModels(deps.io, deps.cfg.ccrcDir, 'gpt');
    expect(r).toEqual({ kind: 'read', classes: laneClassModels(parseRegistry(REGISTRY), parseCatalogue(CATALOGUE)) });
  });

  it('a lane with no registry is absent: an Anthropic lane, or one init never ran on', async () => {
    const deps = testDeps(mkTmp('ccrc-lanemodels-'));
    expect(await readLaneModels(deps.io, deps.cfg.ccrcDir, 'claude')).toEqual({ kind: 'absent' });
  });

  it('a registry that is not JSON, or not a registry, is unreadable, never absent', async () => {
    const deps = testDeps(mkTmp('ccrc-lanemodels-'));
    seedLane(deps.cfg.home, 'gpt', '{not json', CATALOGUE);
    expect(await readLaneModels(deps.io, deps.cfg.ccrcDir, 'gpt')).toEqual({ kind: 'unreadable' });
    seedLane(deps.cfg.home, 'gpt', { probe: 'codex' }, CATALOGUE);
    expect(await readLaneModels(deps.io, deps.cfg.ccrcDir, 'gpt')).toEqual({ kind: 'unreadable' });
  });

  it('a catalogue that is absent or unreadable costs the labels only', async () => {
    const deps = testDeps(mkTmp('ccrc-lanemodels-'));
    seedLane(deps.cfg.home, 'gpt', REGISTRY, '{not json');
    const r = await readLaneModels(deps.io, deps.cfg.ccrcDir, 'gpt');
    expect(r.kind).toBe('read');
    if (r.kind !== 'read') return;
    expect(r.classes.opus).toEqual({ model: 'gpt-6.1-sol', label: null });
  });

  it('a fleet that refuses the read (an agent from before the grant) is unreadable', async () => {
    const base = testDeps(mkTmp('ccrc-lanemodels-'));
    seedLane(base.cfg.home, 'gpt', REGISTRY, CATALOGUE);
    const asked: string[] = [];
    const io: FleetIO = { ...base.io, readFileMeasured: async (p) => { asked.push(p); return { ok: false, reason: 'unreadable' }; } };
    expect(await readLaneModels(io, base.cfg.ccrcDir, 'gpt')).toEqual({ kind: 'unreadable' });
    const dir = path.join(base.cfg.ccrcDir, MODELS_DIR_NAME);
    expect(asked.sort()).toEqual([path.join(dir, 'gpt.classes.json'), path.join(dir, 'gpt.json')]);
  });
});

describe('GET /api/models/:lane (D-8406)', () => {
  const apps: FastifyInstance[] = [];
  afterEach(async () => { while (apps.length) await apps.pop()!.close(); });
  const serve = async (deps: Deps): Promise<FastifyInstance> => {
    const app = await buildServer(deps);
    apps.push(app);
    return app;
  };

  it('answers the lane\'s classes, models and labels', async () => {
    const deps = testDeps(mkTmp('ccrc-lanemodels-'));
    seedLane(deps.cfg.home, 'gpt', REGISTRY, CATALOGUE);
    const res = await (await serve(deps)).inject({ method: 'GET', url: '/api/models/gpt' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json<LaneModelsAnswer>();
    expect(body).toEqual({
      ok: true, lane: 'gpt',
      models: { kind: 'read', classes: laneClassModels(parseRegistry(REGISTRY), parseCatalogue(CATALOGUE)) },
    });
  });

  it('a rostered lane with no registry answers absent', async () => {
    const res = await (await serve(testDeps(mkTmp('ccrc-lanemodels-')))).inject({ method: 'GET', url: '/api/models/claude' });
    expect(res.statusCode).toBe(200);
    expect(res.json<LaneModelsAnswer>().models).toEqual({ kind: 'absent' });
  });

  it('a lane the roster does not hold is not-found, and no file is read for it', async () => {
    const base = testDeps(mkTmp('ccrc-lanemodels-'));
    let reads = 0;
    const io: FleetIO = { ...base.io, readFileMeasured: async (p, t, s) => { reads++; return base.io.readFileMeasured(p, t, s); } };
    const app = await serve({ ...base, io });
    for (const url of ['/api/models/lane-zz', '/api/models/..%2Faccounts', '/api/models/litellm']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(404);
      expect(res.json(), url).toEqual({ ok: false, error: 'not-found' });
    }
    expect(reads).toBe(0);
  });
});
