// Programme model-class-advance, wave R4 (plan Task 19's POST as re-planned, D-8686, D-8687, D-5229): `POST /api/models/:lane`
// through `registerLaneModelsRoutes` on a bare Fastify and a fake `FleetIO`, plus the pure verdicts it applies
// (`laneModelsAct.ts`). The door takes Revert only, behind a fresh capability read (revert-holds-until-newer, D-8757):
// every act here is preceded by a `show` whose answer carries `revertHoldEnds: true`, and the gate's own refusals are
// `lane-models-revert-door.test.ts`'s. No file, no agent, no real `ccrc`: the real verbs behind the real local arm are
// `lane-models-hold-race.test.ts`'s. Every lane and model id here is a stand-in.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerLaneModelsRoutes } from '../src/laneModelsRoutes.js';
import { MODELS_ACT_BODY_REFUSALS, modelsActAuditWord, modelsActVerdict, parseModelsActBody } from '../src/laneModelsAct.js';
import { localIOFor, type FleetIO } from '../src/io.js';
import { readLaneModels } from '../src/laneModels.js';
import type { ModelsAsked } from '../../shared/agent-protocol.js';
import { CLASSES, laneClassModels, parseCatalogue, parseRegistry, type ModelClass } from '../../shared/models.js';
import { REFUSAL_STATUS } from '../../shared/refusal.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const [C0, C1] = CLASSES;
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
const CLASS_LABELS = laneClassModels(parseRegistry(REG), parseCatalogue(CAT));

/** A real SENTENCE of the kind the verb prints: a path and a command. It must never reach the HTTP answer. */
const DETAIL = "account \"lane-a\" has a problem at /home/someone/.ccrc/models/lane-a.advance.json; run 'ccrc models lane-a show'.";
const SHOW = `${JSON.stringify({
  ok: true, op: 'show', id: 'lane-a', anthropic: false, registry: REG, labels: CLASS_LABELS, windowNotices: [], revertHoldEnds: true,
})}\n`;
const exited = (stdout: string, code = 0): ModelsAsked => ({ kind: 'exited', code, stdout });
const revertDone = (cls: ModelClass = C1): ModelsAsked =>
  exited(`${JSON.stringify({ ok: true, op: 'revert', class: cls, id: 'lane-a' })}\n`);
const refusal = (error: unknown, code = 1): ModelsAsked => exited(`${JSON.stringify({ ok: false, error, detail: DETAIL })}\n`, code);

const spyWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => undefined);
interface Rig { app: FastifyInstance; events: string[]; calls: Array<[string, string, unknown]>; reads: string[]; warn: ReturnType<typeof spyWarn> }

describe('POST /api/models/:lane', () => {
  const apps: FastifyInstance[] = [];
  let warn: ReturnType<typeof spyWarn>;
  beforeEach(() => { warn = spyWarn(); });
  afterEach(async () => { warn.mockRestore(); while (apps.length) await apps.pop()!.close(); });

  /** `act` answers the writing action; `show` answers the capability read and the fresh read after the act. `events` is the
   *  order the io was asked in. */
  async function rig(act: ModelsAsked | (() => Promise<ModelsAsked>), over: { hasLane?: (l: string) => boolean } = {}): Promise<Rig> {
    const base = testDeps(mkTmp('ccrc-lanemodels-post-'));
    const events: string[] = [];
    const calls: Array<[string, string, unknown]> = [];
    const reads: string[] = [];
    const io: FleetIO = {
      ...base.io,
      readFileMeasured: async (p, t, s) => { reads.push(p); return base.io.readFileMeasured(p, t, s); },
      models: async (lane, action, cls) => {
        events.push(action); calls.push([lane, action, cls]);
        if (action === 'show') return exited(SHOW);
        return typeof act === 'function' ? act() : act;
      },
    };
    const app = Fastify();
    registerLaneModelsRoutes(app, {
      io, ccrcDir: base.cfg.ccrcDir, hasLane: over.hasLane ?? ((l) => l === 'lane-a'),
      actorOf: (req) => `device:${String(req.headers['x-test-device'] ?? 'unmeasured')}`,
    });
    apps.push(app);
    return { app, events, calls, reads, warn };
  }
  const post = (r: Rig, body: unknown, lane = 'lane-a') => r.app.inject({
    method: 'POST', url: `/api/models/${lane}`,
    headers: { 'x-test-device': 'phone-a', cookie: 'ccrc_session=sid-0123456789abcdef', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
  /** Only this door's lines: `testDeps`'s roster loader warns on its own. */
  const auditLines = (): string[] => warn.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('ccrc-server: models:'));

  it('a revert: 200, the capability read first and the fresh read asked AFTER the act, no-store, one audit line', async () => {
    const r = await rig(revertDone());
    const res = await post(r, { action: 'revert', class: C1 });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({
      ok: true, lane: 'lane-a', action: 'revert', class: C1, changed: null, partial: false,
      models: {
        kind: 'read', classes: CLASS_LABELS, advance: { state: 'unreported', detail: null, pending: null, classes: null },
        revertHoldEnds: true,
      },
    });
    expect(r.events, 'the capability read, the act, then the fresh read').toEqual(['show', 'revert', 'show']);
    expect(r.calls[1]).toEqual(['lane-a', 'revert', C1]);
    expect(auditLines()).toEqual([`ccrc-server: models: revert lane-a ${C1} by device:phone-a -> done`]);
  });

  it('a revert is changed null, and one whose final write failed is partial (done, with a note the audit keeps)', async () => {
    const stdout = (extra: Record<string, unknown>) => exited(`${JSON.stringify({ ok: true, op: 'revert', class: C1, id: 'lane-a', ...extra })}\n`);
    const plain = await rig(stdout({}));
    const a = await post(plain, { action: 'revert', class: C1 });
    expect(a.json()).toMatchObject({ ok: true, action: 'revert', changed: null, partial: false });
    const part = await rig(stdout({ advanceNote: 'lane-a.advance.json: could not be written. Nothing was changed.' }));
    const b = await post(part, { action: 'revert', class: C1 });
    expect(b.statusCode).toBe(200);
    expect(b.json()).toMatchObject({ changed: null, partial: true });
    expect(JSON.stringify(b.json()), 'the note is the verb\'s sentence').not.toContain('could not be written');
    expect(auditLines()).toEqual([
      `ccrc-server: models: revert lane-a ${C1} by device:phone-a -> done`,
      `ccrc-server: models: revert lane-a ${C1} by device:phone-a -> done-partial`,
    ]);
  });

  describe('every arm of what the op answered keeps its own word, and no fresh read follows a refusal', () => {
    it.each([
      ['refused', { kind: 'refused', why: 'bad-class' }, 'bad-request', { why: 'bad-class' }, 'bad-request bad-class'],
      ['unsupported', { kind: 'unsupported' }, 'unsupported', {}, 'unsupported'],
      ['not-started', { kind: 'not-started' }, 'unavailable', { cause: 'not-started' }, 'unavailable not-started'],
      ['busy', { kind: 'busy' }, 'busy', { cause: 'agent-busy' }, 'busy agent-busy'],
      ['timeout', { kind: 'timeout' }, 'outcome-unknown', { cause: 'timeout' }, 'outcome-unknown timeout'],
      ['too-large', { kind: 'too-large' }, 'outcome-unknown', { cause: 'too-large' }, 'outcome-unknown too-large'],
      ['lost', { kind: 'lost' }, 'outcome-unknown', { cause: 'lost' }, 'outcome-unknown lost'],
      ['a refusal at exit 1', refusal('no-previous', 1), 'lane-act-refused', { verbCode: 'no-previous' }, 'lane-act-refused no-previous'],
      ['a refusal at exit 2', refusal('lock-busy', 2), 'lane-act-refused', { verbCode: 'lock-busy' }, 'lane-act-refused lock-busy'],
    ] as const)('%s', async (_n, asked, error, extra, word) => {
      const r = await rig(asked as ModelsAsked);
      const res = await post(r, { action: 'revert', class: C1 });
      expect(res.statusCode, res.body).toBe(REFUSAL_STATUS[error]);
      expect(res.json()).toEqual({ ok: false, error, ...extra });
      expect(res.body, 'the verb\'s sentence crossed').not.toContain('/home/someone');
      expect(res.body).not.toContain('ccrc models');
      expect(r.events, 'a fresh read followed a refusal').toEqual(['show', 'revert']);
      expect(auditLines()).toEqual([`ccrc-server: models: revert lane-a ${C1} by device:phone-a -> ${word}`]);
    });

    it('a timeout is never a success and never a plain failure: 502 outcome-unknown, not 504 and not 200', async () => {
      const r = await rig({ kind: 'timeout' });
      const res = await post(r, { action: 'revert', class: C1 });
      expect(res.statusCode).toBe(502);
      expect(res.json().error).toBe('outcome-unknown');
    });

    it('an io that rejects (a breach of the seam) reads as lost, and is audited', async () => {
      const r = await rig(() => Promise.reject(new Error('/home/someone exploded')));
      const res = await post(r, { action: 'revert', class: C1 });
      expect(res.statusCode).toBe(502);
      expect(res.json()).toEqual({ ok: false, error: 'outcome-unknown', cause: 'lost' });
      expect(res.body).not.toContain('exploded');
      expect(auditLines()).toEqual([`ccrc-server: models: revert lane-a ${C1} by device:phone-a -> outcome-unknown lost`]);
    });
  });

  describe('a verb that ran and printed anything off the grammar is outcome-unknown, cause unreadable', () => {
    const ok = (over: Record<string, unknown> = {}): string =>
      `${JSON.stringify({ ok: true, op: 'revert', class: C1, id: 'lane-a', ...over })}\n`;
    it.each([
      ['exit 0 with a refusal body', refusal('no-previous', 0)],
      ['exit 1 with an ok body', exited(ok(), 1)],
      ['exit 2 with an ok body', exited(ok(), 2)],
      ['exit 3 with a good body', exited(ok(), 3)],
      ['exit 255 with a refusal', refusal('x', 255)],
      ['exit 0 with empty stdout', exited('', 0)],
      ['exit 1 with empty stdout (unlike show, never a refusal here)', exited('', 1)],
      ['exit 2 with empty stdout', exited('', 2)],
      ['two lines', exited(`${ok()}${ok()}`)],
      ['two trailing newlines', exited(`${ok()}\n`)],
      ['not JSON', exited('Traceback (most recent call last):\n')],
      ['an array', exited('[1]\n')],
      ['a bare value', exited('7\n')],
      ['another op', exited(ok({ op: 'hold' }))],
      ['another class', exited(ok({ class: C0 }))],
      ['another lane', exited(ok({ id: 'lane-b' }))],
      ['ok not true', exited(ok({ ok: 'yes' }))],
      ['no ok at all, at exit 0', exited(`${JSON.stringify({ op: 'revert', class: C1, id: 'lane-a' })}\n`)],
      ['a refusal word that is not kebab (spaces)', refusal('lock busy')],
      ['a refusal word with a capital', refusal('Lock-Busy')],
      ['a refusal word that is a sentence', refusal(DETAIL)],
      ['a refusal word over 64 characters', refusal(`a${'b'.repeat(64)}`)],
      ['a refusal word that is not a string', refusal(7)],
      ['a refusal with no word', exited('{"ok":false}\n', 1)],
    ] as const)('%s', async (_n, asked) => {
      const r = await rig(asked as ModelsAsked);
      const res = await post(r, { action: 'revert', class: C1 });
      expect(res.statusCode, res.body).toBe(502);
      expect(res.json()).toEqual({ ok: false, error: 'outcome-unknown', cause: 'unreadable' });
      expect(res.body).not.toContain('/home/someone');
      expect(r.events, 'a fresh read followed an unreadable answer').toEqual(['show', 'revert']);
      expect(auditLines()).toEqual([`ccrc-server: models: revert lane-a ${C1} by device:phone-a -> outcome-unknown unreadable`]);
    });
  });

  it('the audit line names the device the actor port gave, and never a session id or the cookie', async () => {
    const r = await rig(revertDone());
    await post(r, { action: 'revert', class: C1 });
    const line = auditLines()[0]!;
    expect(line).toContain('by device:phone-a');
    expect(line).not.toContain('sid-0123456789abcdef');
    expect(line).not.toContain('ccrc_session');
    expect(auditLines()).toHaveLength(1);
  });

  describe('nothing is asked of the op, and nothing audited, for a refused door', () => {
    it('a lane the roster does not hold is not-found, before the handler reads the parsed body', async () => {
      const r = await rig(revertDone());
      // the body is bad too: the lane is asked first, so the answer is not-found and not bad-request
      const res = await post(r, { action: 'nope', class: 'nope', extra: 1 }, 'lane-z');
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ ok: false, error: 'not-found' });
      expect(r.events).toEqual([]);
      expect(auditLines()).toEqual([]);
    });

    it('a body Fastify cannot parse never reaches the handler, for any lane: its own 400 for bad JSON, its own 415 for another content type', async () => {
      const r = await rig(revertDone());
      for (const lane of ['lane-a', 'lane-z']) {
        const bad = await r.app.inject({ method: 'POST', url: `/api/models/${lane}`, headers: { 'content-type': 'application/json' }, payload: '{"action":' });
        expect(bad.statusCode, `${lane}: ${bad.body}`).toBe(400);
        expect(bad.json(), 'Fastify\'s own error, not this door\'s refusal word').toMatchObject({ code: 'FST_ERR_CTP_INVALID_JSON_BODY' });
        const plain = await r.app.inject({ method: 'POST', url: `/api/models/${lane}`, headers: { 'content-type': 'application/octet-stream' }, payload: 'revert' });
        expect(plain.statusCode, `${lane}: ${plain.body}`).toBe(415);
      }
      expect(r.events).toEqual([]);
      expect(auditLines()).toEqual([]);
    });

    it.each([
      ['no body', undefined, 'bad-body'],
      ['an array', [{ action: 'revert', class: C1 }], 'bad-body'],
      ['a string', 'revert', 'bad-body'],
      ['an extra key', { action: 'revert', class: C1, force: true }, 'bad-body'],
      ['an extra key and a bad class', { action: 'revert', class: 'nope', extra: 1 }, 'bad-body'],
      ['an extra key and a hold', { action: 'hold', class: C1, extra: 1 }, 'bad-body'],
      ['an empty object (no action)', {}, 'bad-action'],
      ['an action that is no action', { action: 'drop', class: C1 }, 'bad-action'],
      ['show (the POST never shows)', { action: 'show' }, 'bad-action'],
      ['show with a class', { action: 'show', class: C1 }, 'bad-action'],
      ['an action that is not a string', { action: 5, class: C1 }, 'bad-action'],
      ['hold (an old console\'s; the shell and the agent keep it)', { action: 'hold', class: C1 }, 'bad-action'],
      ['release (likewise)', { action: 'release', class: C1 }, 'bad-action'],
      ['hold with no class', { action: 'hold' }, 'bad-action'],
      ['no class', { action: 'revert' }, 'bad-class'],
      ['a class that is no class', { action: 'revert', class: 'nope' }, 'bad-class'],
      ['a class that is not a string', { action: 'revert', class: 3 }, 'bad-class'],
    ] as const)('%s is 400 bad-request, why %s', async (_n, body, why) => {
      const r = await rig(revertDone());
      const res = await post(r, body);
      expect(res.statusCode, res.body).toBe(400);
      expect(res.json()).toEqual({ ok: false, error: 'bad-request', why });
      expect(r.events).toEqual([]);
      expect(auditLines()).toEqual([]);
    });

    it('a lane the roster holds but the op cannot carry (a reserved word) is bad-lane, before any op', async () => {
      const r = await rig(revertDone(), { hasLane: () => true });
      const res = await post(r, { action: 'revert', class: C1 }, 'litellm');
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ ok: false, error: 'bad-request', why: 'bad-lane' });
      expect(r.events).toEqual([]);
    });
  });
});

describe('the fresh read after the act never joins a show already in flight (F2, the local arm has no gate)', () => {
  const apps: FastifyInstance[] = [];
  let warn: ReturnType<typeof spyWarn>;
  beforeEach(() => { warn = spyWarn(); });
  afterEach(async () => { warn.mockRestore(); while (apps.length) await apps.pop()!.close(); });

  /** The show a GET began BEFORE the act wrote: it names the old pin. The fresh one names the pin the act left. */
  const STALE_REG = { ...REG, classes: { ...REG.classes, [C1]: 'model-6.1-delta' } };
  const showOf = (reg: typeof REG): string => `${JSON.stringify({
    ok: true, op: 'show', id: 'lane-a', anthropic: false, registry: reg, labels: laneClassModels(parseRegistry(reg), parseCatalogue(CAT)),
    windowNotices: [], revertHoldEnds: true,
  })}\n`;
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  /** An io whose `show` answers only when this test says so, one deferred per call, in the order asked. */
  function handRig() {
    const base = testDeps(mkTmp('ccrc-lanemodels-fresh-'));
    const events: string[] = [];
    const shows: Array<(a: ModelsAsked) => void> = [];
    const io: FleetIO = {
      ...base.io,
      models: (_lane, action) => {
        events.push(action);
        if (action !== 'show') return Promise.resolve(revertDone());
        return new Promise<ModelsAsked>((resolve) => { shows.push(resolve); });
      },
    };
    const app = Fastify();
    registerLaneModelsRoutes(app, { io, ccrcDir: base.cfg.ccrcDir, hasLane: (l) => l === 'lane-a', actorOf: () => 'device:phone-a' });
    apps.push(app);
    return { app, io, ccrcDir: base.cfg.ccrcDir, events, shows };
  }

  it('a show begun before the act is still running when the act settles: the POST\'s models come from a show begun AFTER the act', async () => {
    const t = handRig();
    // the GET's show, in flight and unresolved: it reads the old state
    const get = readLaneModels(t.io, t.ccrcDir, 'lane-a');
    expect(t.events).toEqual(['show']);
    const posted = t.app.inject({
      method: 'POST', url: '/api/models/lane-a', headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ action: 'revert', class: C1 }),
    });
    // the capability read is a show of its own, never the GET's: it too is fresh
    await sleep(25);
    expect(t.events, 'the capability read began its own show').toEqual(['show', 'show']);
    t.shows[1]!(exited(SHOW));
    // the act settles at once; give the route its ticks to start its own read
    await sleep(25);
    expect(t.events.slice(0, 3), 'the act ran').toEqual(['show', 'show', 'revert']);
    // the old show now finishes with the old state
    t.shows[0]!(exited(showOf(STALE_REG)));
    await sleep(25);
    // the POST's read, if it is its own, is the third show; answer it with the state the act left
    if (t.shows.length > 2) t.shows[2]!(exited(SHOW));
    const res = await posted;
    expect(res.statusCode, res.body).toBe(200);
    expect(t.events, 'a third show begun after the act').toEqual(['show', 'show', 'revert', 'show']);
    expect(res.json().models).toEqual({
      kind: 'read', classes: CLASS_LABELS, advance: { state: 'unreported', detail: null, pending: null, classes: null },
      revertHoldEnds: true,
    });
    // the GET still got the old state it asked for: it is not made to wait on the POST's
    expect(await get).toMatchObject({ kind: 'read', classes: { [C1]: { model: 'model-6.1-delta' } } });
  });

  it('CONTROL: two plain reads still share one show (the GET keeps coalescing)', async () => {
    const t = handRig();
    const a = readLaneModels(t.io, t.ccrcDir, 'lane-a');
    const b = readLaneModels(t.io, t.ccrcDir, 'lane-a');
    expect(t.events).toEqual(['show']);
    t.shows[0]!(exited(SHOW));
    expect(await a).toEqual(await b);
  });

  // TIMING-DEPENDENT: the 300/500/300 ms sleeps order the two shows, so under heavy load this case can pass without the
  // `fresh` option or fail on the first show not yet started. The deterministic guard is the hand-resolved case
  // ("a show begun before the act is still running when the act settles: the POST's models come from a show begun AFTER the
  // act", above, whose shows are resolved by hand); this one only adds the real local arm.
  it('through the real local arm (TIMING-DEPENDENT; the hand-resolved case above is the deterministic guard): a fake launcher whose show reads its state at its START, held until released', async () => {
    const home = mkTmp('ccrc-lanemodels-fresh-local-');
    const bin = path.join(home, '.local', 'bin');
    mkdirSync(bin, { recursive: true });
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    const state = path.join(home, 'state');
    const seq = path.join(home, 'shows');
    writeFileSync(state, 'old\n');
    writeFileSync(path.join(home, 'show-old.json'), showOf(STALE_REG));
    writeFileSync(path.join(home, 'show-new.json'), SHOW);
    // `show` snapshots the state, then waits for `go.<n>` (n = its place in the order begun); `revert` writes the state.
    writeFileSync(path.join(bin, 'ccrc'), [
      '#!/bin/sh',
      'case "$3" in',
      '  show)',
      `    echo x >> "${seq}"; n=$(wc -l < "${seq}" | tr -d ' ')`,
      `    snap=$(cat "${state}")`,
      `    while [ ! -e "${home}/go.$n" ]; do sleep 0.02; done`,
      `    cat "${home}/show-$snap.json" ;;`,
      `  revert) echo new > "${state}"; echo '{"ok":true,"op":"revert","class":"${C1}","id":"lane-a"}' ;;`,
      'esac', '',
    ].join('\n'), { mode: 0o755 });
    const base = testDeps(home);
    const io = localIOFor(home);
    const app = Fastify();
    registerLaneModelsRoutes(app, { io, ccrcDir: base.cfg.ccrcDir, hasLane: (l) => l === 'lane-a', actorOf: () => 'device:phone-a' });
    apps.push(app);
    const get = readLaneModels(io, base.cfg.ccrcDir, 'lane-a');
    await sleep(300);
    expect(readFileSync(seq, 'utf8').trim().split('\n'), 'the GET\'s show began').toHaveLength(1);
    const posted = app.inject({
      method: 'POST', url: '/api/models/lane-a', headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ action: 'revert', class: C1 }),
    });
    await sleep(500);
    expect(readFileSync(seq, 'utf8').trim().split('\n'), 'the capability read began a show of its own').toHaveLength(2);
    writeFileSync(path.join(home, 'go.1'), '');     // the GET's show finishes, having read `old`
    await sleep(300);
    writeFileSync(path.join(home, 'go.2'), '');     // the capability read finishes, having read `old`: the act follows
    await sleep(500);
    expect(readFileSync(seq, 'utf8').trim().split('\n'), 'the POST began its own show after the act').toHaveLength(3);
    writeFileSync(path.join(home, 'go.3'), '');     // the POST's own show, begun after the act, reads `new`
    const res = await posted;
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().models.classes[C1].model, 'the POST answered with the model read AFTER the act (its own fresh show)').toBe('model-6.1-gamma');
    expect((await get).kind).toBe('read');
  }, 30_000);
});

describe('laneModelsAct (pure)', () => {
  it('parseModelsActBody takes exactly {action: revert, class}, in the builder\'s order: lane, action, class', () => {
    expect(parseModelsActBody('lane-a', { action: 'revert', class: C1 })).toEqual({ ok: true, action: 'revert', cls: C1 });
    expect(parseModelsActBody('lane-a', { class: C0, action: 'revert' })).toEqual({ ok: true, action: 'revert', cls: C0 });
    // hold, release and show are the shell's and the agent's verbs: bad-action, as `show` always was here
    for (const action of ['hold', 'release', 'show']) {
      expect(parseModelsActBody('lane-a', { action, class: C1 }), action).toEqual({ ok: false, why: 'bad-action' });
      expect(parseModelsActBody('lane-a', { action }), action).toEqual({ ok: false, why: 'bad-action' });
    }
    // the lane is judged before the action, the action before the class
    expect(parseModelsActBody('litellm', { action: 'nope', class: 'nope' })).toEqual({ ok: false, why: 'bad-lane' });
    expect(parseModelsActBody('litellm', { action: 'show' })).toEqual({ ok: false, why: 'bad-lane' });
    expect(parseModelsActBody('litellm', { action: 'hold', class: C1 })).toEqual({ ok: false, why: 'bad-lane' });
    expect(parseModelsActBody('lane-a', { action: 'nope', class: 'nope' })).toEqual({ ok: false, why: 'bad-action' });
    expect(parseModelsActBody('lane-a', { action: 'show', class: 'nope' })).toEqual({ ok: false, why: 'bad-action' });
    expect(parseModelsActBody('lane-a', { action: 'hold', class: 'nope' })).toEqual({ ok: false, why: 'bad-action' });
    expect(parseModelsActBody('lane-a', { action: 'revert', class: 'nope' })).toEqual({ ok: false, why: 'bad-class' });
    expect(parseModelsActBody('lane-a', { action: 'revert' })).toEqual({ ok: false, why: 'bad-class' });
    expect(parseModelsActBody('lane-a', {})).toEqual({ ok: false, why: 'bad-action' });
    expect(parseModelsActBody('lane-a', null)).toEqual({ ok: false, why: 'bad-body' });
    expect(parseModelsActBody('lane-a', { action: 'revert', class: C1, x: 1 })).toEqual({ ok: false, why: 'bad-body' });
    // every word it can answer is in the one list
    expect([...MODELS_ACT_BODY_REFUSALS]).toEqual(['bad-body', 'bad-lane', 'bad-action', 'bad-class']);
  });

  it('every refusal word the verdicts use is a word the route vocabulary already has, at the status this door means', () => {
    const asked: ModelsAsked[] = [
      { kind: 'refused', why: 'bad-lane' }, { kind: 'unsupported' }, { kind: 'not-started' }, { kind: 'busy' },
      { kind: 'timeout' }, { kind: 'too-large' }, { kind: 'lost' }, refusal('no-previous'), exited('', 0),
    ];
    const seen = new Map<string, number>();
    for (const a of asked) {
      const v = modelsActVerdict('lane-a', 'revert', C1, a);
      if (v.kind !== 'refuse') throw new Error('expected a refusal');
      seen.set(v.error, REFUSAL_STATUS[v.error]);
    }
    expect(Object.fromEntries(seen)).toEqual({
      'bad-request': 400, unsupported: 501, unavailable: 503, busy: 409, 'outcome-unknown': 502, 'lane-act-refused': 409,
    });
  });

  it('a revert is changed null on the wire; partial only on a string advanceNote; a hold-shaped answer to a revert is unreadable', () => {
    const done = (over: Record<string, unknown>, op = 'revert'): ModelsAsked =>
      exited(`${JSON.stringify({ ok: true, op, class: C1, id: 'lane-a', ...over })}\n`);
    expect(modelsActVerdict('lane-a', 'revert', C1, done({}))).toEqual({ kind: 'done', changed: null, partial: false });
    expect(modelsActVerdict('lane-a', 'revert', C1, done({ advanceNote: 'x' }))).toEqual({ kind: 'done', changed: null, partial: true });
    expect(modelsActVerdict('lane-a', 'revert', C1, done({ advanceNote: 7 }))).toEqual({ kind: 'done', changed: null, partial: false });
    expect(modelsActVerdict('lane-a', 'revert', C1, done({ changed: true }, 'hold')))
      .toEqual({ kind: 'refuse', error: 'outcome-unknown', extra: { cause: 'unreadable' } });
    expect(modelsActAuditWord({ kind: 'done', changed: null, partial: false })).toBe('done');
    expect(modelsActAuditWord({ kind: 'done', changed: null, partial: true })).toBe('done-partial');
  });
});

describe('laneModelsAct.ts is ring L1: it imports shared/ and nothing else (CLAUDE.md, Clean Architecture)', () => {
  const SRC = readFileSync(path.join(import.meta.dirname, '..', 'src', 'laneModelsAct.ts'), 'utf8');
  /** Every module specifier in the file's import and export-from statements. */
  const specifiers = (src: string): string[] =>
    [...src.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+'([^']+)'/gm)].map((m) => m[1]!)
      .concat([...src.matchAll(/^\s*import\s+'([^']+)'/gm)].map((m) => m[1]!));

  it('every import is under ../../shared/, and it names no fs, fastify, clock or process', () => {
    const from = specifiers(SRC);
    expect(from.length, 'the scan read no import: it proves nothing').toBeGreaterThan(0);
    // Measured as a list of offenders, not as a pin on the file's text (the ARCH-06 ratchet counts those).
    expect(from.filter((f) => !f.startsWith('../../shared/')), 'laneModelsAct.ts imports outside shared/').toEqual([]);
    const code = SRC.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(/\bfastify\b|\breply\b|\bconsole\.|Date\.now|setTimeout|\bprocess\.|node:/.test(code), 'an L1 file touches I/O').toBe(false);
  });

  it('the scan sees a planted import (the control)', () => {
    const planted = (line: string): string[] => specifiers(`import { y } from '../../shared/models.js';\n${line}\n`);
    expect(planted("import { x } from './refuse.js';")).toEqual(['../../shared/models.js', './refuse.js']);
    expect(planted("import fs from 'node:fs';")).toEqual(['../../shared/models.js', 'node:fs']);
  });
});
