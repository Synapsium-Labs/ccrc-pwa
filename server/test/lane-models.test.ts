// D-8406: the session's model picker names a class's model from the lane's own files, never from a name the tree
// spells. Three layers, against fixture files and stub ops only: the models kernel's derivation (`laneClassModels`),
// the server's reader (`readLaneModels`, through the `models` op alone since R3b retired the file-read grant), and
// `GET /api/models/:lane`.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import type { FleetIO } from '../src/io.js';
import { readLaneModels } from '../src/laneModels.js';
import type { ModelsAsked } from '../../shared/agent-protocol.js';
import {
  MODELS_DIR_NAME, catalogueFileName, laneClassModels, parseCatalogue, parseRegistry, registryFileName,
  type LaneModelsAnswer,
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
      haiku: { model: 'gpt-6-luna', label: 'GPT-6 Luna', efforts: [] },
      sonnet: { model: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', efforts: [] },
      opus: { model: 'gpt-6.1-sol', label: 'GPT-6.1-Sol', efforts: [] },
      fable: { model: 'gpt-6-astra', label: 'GPT-6-Astra', efforts: [] },
    });
  });

  it('a model advance in the registry moves the label with it, with no code change', () => {
    const advanced = { ...REGISTRY, classes: { ...REGISTRY.classes, opus: 'gpt-6.2-sol' } };
    expect(laneClassModels(parseRegistry(advanced), parseCatalogue(CATALOGUE)).opus)
      .toEqual({ model: 'gpt-6.2-sol', label: 'GPT-6.2-Sol', efforts: [] });
  });

  it('no catalogue, or no row for the model, is a null label; a null slot is a null model', () => {
    const noFable = { ...REGISTRY, classes: { ...REGISTRY.classes, fable: null } };
    const out = laneClassModels(parseRegistry(noFable), null);
    expect(out.fable).toEqual({ model: null, label: null, efforts: null });
    expect(out.opus).toEqual({ model: 'gpt-6.1-sol', label: null, efforts: null });
    const thin = parseCatalogue({ ...CATALOGUE, models: [{ id: 'gpt-6-luna' }] });
    // A row with no label carries its id as the label (`parseCatalogue`); a model with no row has none.
    expect(laneClassModels(parseRegistry(REGISTRY), thin).haiku).toEqual({ model: 'gpt-6-luna', label: 'gpt-6-luna', efforts: [] });
    expect(laneClassModels(parseRegistry(REGISTRY), thin).sonnet).toEqual({ model: 'gpt-6.1-terra', label: null, efforts: null });
  });
});

describe('laneClassModels carries the catalogue\'s effort levels (D-8686)', () => {
  it('a row that lists levels carries them; a classed model with no row carries null', () => {
    const levels = ['low', 'medium', 'high', 'xhigh'];
    const catalogue = parseCatalogue({
      ...CATALOGUE, models: [{ id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol', efforts: levels }, { id: 'gpt-6-luna', label: 'GPT-6 Luna' }],
    });
    const out = laneClassModels(parseRegistry(REGISTRY), catalogue);
    expect(out.opus.efforts).toEqual(levels);
    expect(out.haiku.efforts).toEqual([]); // a row that lists none
    expect(out.sonnet.efforts).toBeNull(); // no row for its model
  });
});

/** `show`'s answer for a lane over the seeded REGISTRY and CATALOGUE, as `deploy/models-op.mjs`'s `describe` prints it
 *  (the keys the server reads). */
const showOf = (lane: string, over: Record<string, unknown> = {}): ModelsAsked => ({
  kind: 'exited', code: 0,
  stdout: `${JSON.stringify({
    ok: true, op: 'show', id: lane, registry: REGISTRY,
    labels: laneClassModels(parseRegistry(REGISTRY), parseCatalogue(CATALOGUE)), advance: { state: 'absent' }, ...over,
  })}\n`,
});

describe('readLaneModels (D-8406, R3b)', () => {
  it('reads the lane through the models op, and the lane\'s files on the server\'s box are never read', async () => {
    const base = testDeps(mkTmp('ccrc-lanemodels-'));
    seedLane(base.cfg.home, 'gpt', REGISTRY, CATALOGUE);
    const reads: string[] = [];
    const io: FleetIO = {
      ...base.io, models: async (lane) => showOf(lane),
      readFileMeasured: async (p, t, s) => { reads.push(p); return base.io.readFileMeasured(p, t, s); },
    };
    const r = await readLaneModels(io, base.cfg.ccrcDir, 'gpt');
    expect(r).toMatchObject({ kind: 'read', classes: laneClassModels(parseRegistry(REGISTRY), parseCatalogue(CATALOGUE)) });
    expect(reads).toEqual([]);
  });

  it('a lane with no registry is absent: an Anthropic lane, or one init never ran on', async () => {
    const base = testDeps(mkTmp('ccrc-lanemodels-'));
    const io = (anthropic: boolean): FleetIO => ({ ...base.io, models: async (lane) => showOf(lane, { registry: null, labels: null, anthropic }) });
    expect(await readLaneModels(io(true), base.cfg.ccrcDir, 'claude')).toEqual({ kind: 'absent', laneKind: 'anthropic' });
    expect(await readLaneModels(io(false), base.cfg.ccrcDir, 'gpt')).toEqual({ kind: 'absent', laneKind: 'never-made' });
  });

  it('local mode with no ccrc launcher in the configured home is not-started, even with the lane\'s files in place', async () => {
    const deps = testDeps(mkTmp('ccrc-lanemodels-'));
    seedLane(deps.cfg.home, 'gpt', REGISTRY, CATALOGUE);
    expect(await readLaneModels(deps.io, deps.cfg.ccrcDir, 'gpt')).toEqual({ kind: 'not-started' });
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
    const base = testDeps(mkTmp('ccrc-lanemodels-'));
    const res = await (await serve({ ...base, io: { ...base.io, models: async (lane) => showOf(lane) } }))
      .inject({ method: 'GET', url: '/api/models/gpt' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json<LaneModelsAnswer>();
    expect(body).toEqual({
      ok: true, lane: 'gpt',
      models: {
        kind: 'read', classes: laneClassModels(parseRegistry(REGISTRY), parseCatalogue(CATALOGUE)),
        advance: { state: 'absent', detail: null, pending: null, classes: null },
      },
    });
  });

  it('a rostered lane with no registry answers absent', async () => {
    const base = testDeps(mkTmp('ccrc-lanemodels-'));
    const io: FleetIO = { ...base.io, models: async (lane) => showOf(lane, { registry: null, labels: null, anthropic: true }) };
    const res = await (await serve({ ...base, io })).inject({ method: 'GET', url: '/api/models/claude' });
    expect(res.statusCode).toBe(200);
    expect(res.json<LaneModelsAnswer>().models).toEqual({ kind: 'absent', laneKind: 'anthropic' });
  });

  // R3b: each outcome reaches the wire as its own answer, never folded.
  it.each([
    ['unsupported', { kind: 'unsupported' }, { kind: 'unsupported' }],
    ['not-started', { kind: 'not-started' }, { kind: 'not-started' }],
    ['refused', { kind: 'refused', why: 'bad-lane' }, { kind: 'refused', why: 'bad-lane' }],
    ['busy', { kind: 'busy' }, { kind: 'busy' }],
    ['timeout', { kind: 'timeout' }, { kind: 'unreadable' }],
    ['a carried refusal', { kind: 'exited', code: 1, stdout: `${JSON.stringify({ ok: false, error: 'catalogue-unreadable' })}\n` },
      { kind: 'unreadable', code: 'catalogue-unreadable' }],
  ] as const)('%s answers 200 with its own models arm', async (_n, asked, want) => {
    const base = testDeps(mkTmp('ccrc-lanemodels-'));
    const io: FleetIO = { ...base.io, models: async () => asked as ModelsAsked };
    const res = await (await serve({ ...base, io })).inject({ method: 'GET', url: '/api/models/gpt' });
    expect(res.statusCode).toBe(200);
    expect(res.json<LaneModelsAnswer>().models).toEqual(want);
  });

  it('a lane the roster does not hold is not-found, and nothing is asked for it', async () => {
    const base = testDeps(mkTmp('ccrc-lanemodels-'));
    let asked = 0;
    const io: FleetIO = { ...base.io, models: async () => { asked++; return { kind: 'unsupported' }; } };
    const app = await serve({ ...base, io });
    for (const url of ['/api/models/lane-zz', '/api/models/..%2Faccounts', '/api/models/litellm']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(404);
      expect(res.json(), url).toEqual({ ok: false, error: 'not-found' });
    }
    expect(asked).toBe(0);
  });
});
