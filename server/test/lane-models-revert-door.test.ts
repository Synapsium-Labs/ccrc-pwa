// revert-holds-until-newer (D-8757), Task 1: the Models write door takes Revert only, behind a FRESH capability check.
// `POST /api/models/:lane` reads the lane (`readLaneModels`, `{ fresh: true }`) before it writes, and writes only when that
// read carries `revertHoldEnds: true`: a hold the box would never end by itself must not be written from the console, and an
// older or unreadable box proves nothing. Hold and Release are the shell's and the agent's verbs, and this door refuses them
// `bad-action` before any read or write.
//
// THE CASES: (a) `revertGateVerdict`, the pure verdict, over every arm of `LaneModelsRead`; (b) the route over a stub io whose
// `show` is a Codex-lane body and, separately, an Anthropic-lane body, each with the capability and without it or with a
// malformed value; (c) every arm the pre-read can answer; (d) an old console's `hold` and `release`; (e) a done revert and the
// fresh read after it, and every uncertain outcome (exactly ONE revert call, never a retry). A stub io, no file, no agent, no
// real `ccrc`; every lane and model id is a stand-in.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerLaneModelsRoutes } from '../src/laneModelsRoutes.js';
import { revertGateVerdict, MODELS_DOOR_ACTIONS } from '../src/laneModelsAct.js';
import type { FleetIO } from '../src/io.js';
import type { ModelsAsked } from '../../shared/agent-protocol.js';
import {
  CLASSES, laneClassModels, parseCatalogue, parseRegistry, type LaneClassModels, type LaneModelsRead, type ModelClass,
} from '../../shared/models.js';
import { REFUSAL_STATUS } from '../../shared/refusal.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const [C0, C1] = CLASSES;
const LANE = 'lane-a';
const REG = {
  probe: 'codex', subagent: C1, discovery: 'catalogue',
  classes: { [C0]: 'model-5.6-gamma', [C1]: 'model-6.1-gamma', [CLASSES[2]]: 'model-6.1-delta', [CLASSES[3]]: null },
};
const CAT = {
  probe: 'codex', fetchedAt: 1_700_000_000_000,
  models: [
    { id: 'model-5.6-gamma', label: 'Model 5.6 Gamma' }, { id: 'model-6.1-gamma', label: 'Model 6.1 Gamma' },
    { id: 'model-6.1-delta', label: 'Model 6.1 Delta' },
  ],
};
const CLASS_LABELS: LaneClassModels = laneClassModels(parseRegistry(REG), parseCatalogue(CAT));
const ANTHROPIC_ROWS = Object.fromEntries(CLASSES.map((c) => [c, { model: `claude-x-9-${c.length}`, label: 'L', efforts: ['low'] }]));

/** `show`'s body for a Codex-kind lane and for an Anthropic one (no registry; the aliases file's labels), each as the op prints it. */
const codexBody = (over: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ ok: true, op: 'show', id: LANE, anthropic: false, registry: REG, labels: CLASS_LABELS, windowNotices: [], ...over });
const anthropicBody = (over: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ ok: true, op: 'show', id: LANE, anthropic: true, registry: null, aliases: { v: 1 }, labels: ANTHROPIC_ROWS, ...over });
const exited = (stdout: string, code = 0): ModelsAsked => ({ kind: 'exited', code, stdout });
const asShow = (body: Record<string, unknown>): ModelsAsked => exited(`${JSON.stringify(body)}\n`);
const spyWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => undefined);
const revertDone = (cls: ModelClass = C1): ModelsAsked =>
  exited(`${JSON.stringify({ ok: true, op: 'revert', class: cls, id: LANE })}\n`);

describe('revertGateVerdict (pure): one row per arm of LaneModelsRead, no default fold', () => {
  const read = (over: Partial<Extract<LaneModelsRead, { kind: 'read' }>> = {}): LaneModelsRead =>
    ({ kind: 'read', classes: CLASS_LABELS, ...over });
  it.each([
    ['a read that carries the capability', read({ revertHoldEnds: true }), { kind: 'act' }],
    ['a read without it', read(), { kind: 'refuse', error: 'unsupported', extra: { cause: 'revert-hold-ends' } }],
    ['unsupported', { kind: 'unsupported' }, { kind: 'refuse', error: 'unsupported', extra: {} }],
    ['not-started', { kind: 'not-started' }, { kind: 'refuse', error: 'unavailable', extra: { cause: 'not-started' } }],
    ['busy', { kind: 'busy' }, { kind: 'refuse', error: 'busy', extra: { cause: 'agent-busy' } }],
    ['refused', { kind: 'refused', why: 'bad-lane' }, { kind: 'refuse', error: 'bad-request', extra: { why: 'bad-lane' } }],
    ['unreadable', { kind: 'unreadable' }, { kind: 'refuse', error: 'unavailable', extra: { cause: 'lane-unreadable' } }],
    ['unreadable with a code', { kind: 'unreadable', code: 'no-output' }, { kind: 'refuse', error: 'unavailable', extra: { cause: 'lane-unreadable' } }],
    ['absent', { kind: 'absent' }, { kind: 'refuse', error: 'unavailable', extra: { cause: 'lane-absent' } }],
    ['absent, an Anthropic lane', { kind: 'absent', laneKind: 'anthropic' }, { kind: 'refuse', error: 'unavailable', extra: { cause: 'lane-absent' } }],
  ] as const)('%s', (_n, r, verdict) => {
    expect(revertGateVerdict(r as LaneModelsRead)).toEqual(verdict);
  });

  it('every refusal word it uses is one the route vocabulary has, at the status this door means', () => {
    expect(REFUSAL_STATUS.unsupported).toBe(501);
    expect(REFUSAL_STATUS.unavailable).toBe(503);
    expect(REFUSAL_STATUS.busy).toBe(409);
    expect(REFUSAL_STATUS['bad-request']).toBe(400);
  });

  it('the door\'s action vocabulary is revert and nothing else', () => {
    expect([...MODELS_DOOR_ACTIONS]).toEqual(['revert']);
  });
});

describe('POST /api/models/:lane: the capability read before the revert', () => {
  const apps: FastifyInstance[] = [];
  let warn: ReturnType<typeof spyWarn>;
  beforeEach(() => { warn = spyWarn(); });
  afterEach(async () => { warn.mockRestore(); while (apps.length) await apps.pop()!.close(); });

  interface Rig { app: FastifyInstance; events: string[]; calls: Array<[string, string, unknown]> }
  /** `show` answers what `shows` says, one answer per call in order (the last repeats); a writing action answers `act`. */
  async function rig(shows: ModelsAsked | ModelsAsked[], act: ModelsAsked | (() => Promise<ModelsAsked>) = revertDone()): Promise<Rig> {
    const base = testDeps(mkTmp('ccrc-lanemodels-revert-door-'));
    const events: string[] = [];
    const calls: Array<[string, string, unknown]> = [];
    const list = Array.isArray(shows) ? shows : [shows];
    let n = 0;
    const io: FleetIO = {
      ...base.io,
      models: async (lane, action, cls) => {
        events.push(action); calls.push([lane, action, cls]);
        if (action === 'show') return list[Math.min(n++, list.length - 1)]!;
        return typeof act === 'function' ? act() : act;
      },
    };
    const app = Fastify();
    registerLaneModelsRoutes(app, { io, hasLane: (l) => l === LANE, actorOf: () => 'device:phone-a' });
    apps.push(app);
    return { app, events, calls };
  }
  const post = (r: Rig, body: unknown) => r.app.inject({
    method: 'POST', url: `/api/models/${LANE}`, headers: { 'content-type': 'application/json' }, payload: JSON.stringify(body),
  });
  const audit = (): string[] => warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('ccrc-server: models:'));
  const REVERT = { action: 'revert', class: C1 };

  describe.each([['a Codex-kind lane', codexBody], ['an Anthropic lane', anthropicBody]] as const)('over %s\'s show body', (_name, bodyOf) => {
    it('with revertHoldEnds true: the read, the revert, then a second FRESH read, and a 200 carrying it', async () => {
      const r = await rig(asShow(bodyOf({ revertHoldEnds: true })));
      const res = await post(r, REVERT);
      expect(res.statusCode, res.body).toBe(200);
      expect(r.events, 'capability read, the act, the fresh read after it').toEqual(['show', 'revert', 'show']);
      expect(r.calls[1]).toEqual([LANE, 'revert', C1]);
      expect(res.json()).toMatchObject({ ok: true, lane: LANE, action: 'revert', class: C1, changed: null, partial: false });
      expect(res.json().models).toMatchObject({ kind: 'read', revertHoldEnds: true });
      expect(audit()).toEqual([`ccrc-server: models: revert ${LANE} ${C1} by device:phone-a -> done`]);
    });

    it.each([
      ['no key at all (an older op)', undefined], ["the string 'true'", 'true'], ['the number 1', 1], ['false', false], ['null', null], ['an object', {}],
    ] as const)('%s: 501 unsupported, cause revert-hold-ends, the io saw show only, nothing audited', async (_n, v) => {
      const r = await rig(asShow(bodyOf({ revertHoldEnds: v })));
      const res = await post(r, REVERT);
      expect(res.statusCode, res.body).toBe(501);
      expect(res.json()).toEqual({ ok: false, error: 'unsupported', cause: 'revert-hold-ends' });
      expect(r.events, 'a revert was asked of a box that did not prove the capability').toEqual(['show']);
      expect(audit()).toEqual([]);
    });

    it('the capability read is fresh: a second POST reads again, it never reuses the first answer', async () => {
      const r = await rig([asShow(bodyOf({ revertHoldEnds: true })), asShow(bodyOf({ revertHoldEnds: true })), asShow(bodyOf())]);
      expect((await post(r, REVERT)).statusCode).toBe(200);
      const second = await post(r, REVERT);
      // the third show (the second POST's capability read) lacks the capability: no second revert
      expect(second.statusCode, second.body).toBe(501);
      expect(r.events).toEqual(['show', 'revert', 'show', 'show']);
    });
  });

  describe('every arm the capability read can answer other than a read keeps its own word, and no write follows', () => {
    const refusalBody = (error: string): ModelsAsked => exited(`${JSON.stringify({ ok: false, error, detail: 'a sentence' })}\n`, 1);
    it.each([
      ['busy', { kind: 'busy' }, 409, { error: 'busy', cause: 'agent-busy' }],
      ['not-started', { kind: 'not-started' }, 503, { error: 'unavailable', cause: 'not-started' }],
      ['unsupported', { kind: 'unsupported' }, 501, { error: 'unsupported' }],
      ['refused', { kind: 'refused', why: 'bad-lane' }, 400, { error: 'bad-request', why: 'bad-lane' }],
      ['timeout', { kind: 'timeout' }, 503, { error: 'unavailable', cause: 'lane-unreadable' }],
      ['lost', { kind: 'lost' }, 503, { error: 'unavailable', cause: 'lane-unreadable' }],
      ['too-large', { kind: 'too-large' }, 503, { error: 'unavailable', cause: 'lane-unreadable' }],
      ['stdout off the grammar', exited('not json\n'), 503, { error: 'unavailable', cause: 'lane-unreadable' }],
      ['a refusal the retired files path carried', refusalBody('registry-invalid'), 503, { error: 'unavailable', cause: 'lane-unreadable' }],
      ['no such lane on the box', refusalBody('no-such-account'), 503, { error: 'unavailable', cause: 'lane-absent' }],
    ] as const)('%s', async (_n, asked, status, body) => {
      const r = await rig(asked as ModelsAsked);
      const res = await post(r, REVERT);
      expect(res.statusCode, res.body).toBe(status);
      expect(res.json()).toEqual({ ok: false, ...body });
      expect(r.events, 'a write was asked after a refused capability read').toEqual(['show']);
      expect(audit()).toEqual([]);
    });

    it('an io whose show rejects (a breach of the seam) reads as unreadable, and writes nothing', async () => {
      const base = testDeps(mkTmp('ccrc-lanemodels-revert-door-'));
      const events: string[] = [];
      const io: FleetIO = { ...base.io, models: async (_l, action) => { events.push(action); throw new Error('boom'); } };
      const app = Fastify();
      registerLaneModelsRoutes(app, { io, hasLane: () => true, actorOf: () => 'device:phone-a' });
      apps.push(app);
      const res = await app.inject({
        method: 'POST', url: `/api/models/${LANE}`, headers: { 'content-type': 'application/json' }, payload: JSON.stringify(REVERT),
      });
      expect(res.statusCode, res.body).toBe(503);
      expect(res.json()).toEqual({ ok: false, error: 'unavailable', cause: 'lane-unreadable' });
      expect(events).toEqual(['show']);
    });
  });

  describe('an old console\'s hold and release are refused bad-action before ANY read or write', () => {
    it.each([['hold'], ['release'], ['show']])('%s', async (action) => {
      const r = await rig(asShow(codexBody({ revertHoldEnds: true })));
      const res = await post(r, { action, class: C1 });
      expect(res.statusCode, res.body).toBe(400);
      expect(res.json()).toEqual({ ok: false, error: 'bad-request', why: 'bad-action' });
      expect(r.events, 'the io was asked something for a verb this door never takes').toEqual([]);
      expect(audit()).toEqual([]);
    });
  });

  describe('a done revert, then every uncertain outcome: exactly ONE revert call, never a retry', () => {
    it('a revert whose final write failed is partial, and the fresh read still follows', async () => {
      const done = exited(`${JSON.stringify({ ok: true, op: 'revert', class: C1, id: LANE, advanceNote: 'a note' })}\n`);
      const r = await rig(asShow(codexBody({ revertHoldEnds: true })), done);
      const res = await post(r, REVERT);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({ changed: null, partial: true });
      expect(r.events).toEqual(['show', 'revert', 'show']);
      expect(audit()).toEqual([`ccrc-server: models: revert ${LANE} ${C1} by device:phone-a -> done-partial`]);
    });

    it.each([
      ['timeout', { kind: 'timeout' }, 'timeout'],
      ['lost', { kind: 'lost' }, 'lost'],
      ['too-large', { kind: 'too-large' }, 'too-large'],
      ['stdout off the grammar', exited('Traceback (most recent call last):\n'), 'unreadable'],
    ] as const)('%s', async (_n, asked, cause) => {
      const r = await rig(asShow(codexBody({ revertHoldEnds: true })), asked as ModelsAsked);
      const res = await post(r, REVERT);
      expect(res.statusCode, res.body).toBe(502);
      expect(res.json()).toEqual({ ok: false, error: 'outcome-unknown', cause });
      expect(r.events.filter((e) => e === 'revert'), 'the revert was retried').toHaveLength(1);
      expect(r.events, 'no fresh read follows an unknown outcome').toEqual(['show', 'revert']);
      expect(audit()).toEqual([`ccrc-server: models: revert ${LANE} ${C1} by device:phone-a -> outcome-unknown ${cause}`]);
    });

    it('an io whose revert rejects reads as lost, once', async () => {
      const r = await rig(asShow(codexBody({ revertHoldEnds: true })), () => Promise.reject(new Error('boom')));
      const res = await post(r, REVERT);
      expect(res.statusCode).toBe(502);
      expect(res.json()).toEqual({ ok: false, error: 'outcome-unknown', cause: 'lost' });
      expect(r.events).toEqual(['show', 'revert']);
    });
  });
});
