// Auto-advance plan W4a Tasks 18-19, as re-planned (D-8686, D-8687, D-8688, D-5228, D-8693), and R3b: `readLaneModels`
// reads the `models` op's `show` alone. The files fallback is retired (R3b), so every outcome is its own answer, and no
// case reads a file: `lane-models-grant-retired.test.ts` holds that beside this file. Every case runs against fixture
// HOMEs and stub ops: the local arm's case spawns a bash stub under a fixture home, never a real `ccrc`, and never
// anything under the real home.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { localIO, localIOFor, type FleetIO } from '../src/io.js';
import { createIo } from '../src/remote/io.js';
import { AgentOpError, LinkNotSentError } from '../src/remote/errors.js';
import { readReadyOps } from '../src/remote/client.js';
import { readLaneModels } from '../src/laneModels.js';
import { MODELS_OP, type ModelsAsked } from '../../shared/agent-protocol.js';
import { MAX_CAP_WORDS } from '../../shared/api.js';
import { lastMoveOf, parseAdvance, seedAnthropicAdvance, serializeAdvance } from '../../shared/model-advance.mjs';
import {
  CLASSES, MODELS_DIR_NAME, catalogueFileName, laneClassModels, parseCatalogue, parseRegistry, registryFileName,
  type LaneModelsAnswer, type ModelClass,
} from '../../shared/models.js';
import { testDeps } from './helpers.js';
import { bootAgent, connectToAgent, makeFixture } from './remoteHelpers.js';
import { mkTmp } from './tmpHelpers.js';
import type { ModelsOpSpawn } from '../../agent/src/modelsop.js';

const [C0, C1, C2, C3] = CLASSES;
const PIN: Record<ModelClass, string | null> = {
  [C0]: 'model-5.6-gamma', [C1]: 'model-6.1-gamma', [C2]: 'model-6.1-delta', [C3]: null,
} as Record<ModelClass, string | null>;
const REG = { probe: 'codex', subagent: C1, discovery: 'catalogue', classes: PIN };
const CAT = {
  probe: 'codex', fetchedAt: 1_700_000_000_000,
  models: [
    { id: 'model-5.6-gamma', label: 'Model 5.6 Gamma', efforts: ['low', 'high'] },
    { id: 'model-6.1-gamma', label: 'Model 6.1 Gamma' },
    { id: 'model-6.1-delta', label: 'Model 6.1 Delta', efforts: ['medium'] },
  ],
};
const CLASS_LABELS = laneClassModels(parseRegistry(REG), parseCatalogue(CAT));

const AT = '2026-11-16T10:00:00Z';
const advClass = (c: ModelClass): Record<string, unknown> => c === C2
  ? {
    family: 'model', hold: { at: AT, by: 'hand' }, previous: { model: 'model-6.0-delta', effort: null },
    history: [
      { at: '2026-11-10T10:00:00Z', how: 'advance', from: 'model-6.0-delta', to: 'model-6.1-delta', ok: true, canary: 'passed' },
      { at: '2026-11-12T10:00:00Z', how: 'advance', from: 'model-6.1-delta', to: 'model-6.2-delta', ok: false, canary: 'failed', tries: 1, lastAt: '2026-11-12T10:00:00Z' },
    ],
  }
  : { family: c === C3 ? null : 'model', hold: null, previous: null, history: [] };
const ADV_CLASSES = Object.fromEntries(CLASSES.map((c) => [c, advClass(c)]));
const PENDING = { class: C1, from: 'model-6.1-gamma', to: 'model-6.2-gamma', effortFrom: null, effortTo: null, at: AT };

/** One `show` answer, as `deploy/models-op.mjs`'s `describe` prints it (the keys this reader reads, plus a few). */
function showJson(lane: string, over: Record<string, unknown> = {}): string {
  return `${JSON.stringify({
    ok: true, op: 'show', id: lane, anthropic: false, registry: REG, labels: CLASS_LABELS,
    advance: { state: 'ok', classes: ADV_CLASSES, pending: PENDING }, windowNotices: [], ...over,
  })}\n`;
}
const exited = (stdout: string, code = 0): ModelsAsked => ({ kind: 'exited', code, stdout });
const refusal = (error: string): string => `${JSON.stringify({ ok: false, error, detail: 'd' })}\n`;

function seedLane(home: string, lane: string): void {
  const dir = path.join(home, '.ccrc', MODELS_DIR_NAME);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, registryFileName(lane)), JSON.stringify(REG));
  writeFileSync(path.join(dir, catalogueFileName(lane)), JSON.stringify(CAT));
}

/** A fake FleetIO over a fixture home: its `models` answers `answer`, and its file reads are counted. */
function rig(answer: ModelsAsked | (() => Promise<ModelsAsked>)) {
  const base = testDeps(mkTmp('ccrc-lanemodels-op-'));
  seedLane(base.cfg.home, 'lane-a');
  const reads: string[] = [];
  const calls: Array<[string, string, unknown]> = [];
  const io: FleetIO = {
    ...base.io,
    readFileMeasured: async (p, t, s) => { reads.push(p); return base.io.readFileMeasured(p, t, s); },
    models: async (lane, action, cls) => { calls.push([lane, action, cls]); return typeof answer === 'function' ? answer() : answer; },
  };
  return { base, io, reads, calls, read: () => readLaneModels(io, base.cfg.ccrcDir, 'lane-a') };
}

describe('readLaneModels through the op (D-8686)', () => {
  it('an exited show gives the lane\'s classes, reads no file, and asks show once', async () => {
    const r = rig(exited(showJson('lane-a')));
    const got = await r.read();
    expect(got.kind).toBe('read');
    if (got.kind !== 'read') return;
    expect(got.classes).toEqual(CLASS_LABELS);
    expect(got.classes[C0].efforts).toEqual(['low', 'high']);
    expect(r.reads).toEqual([]);
    expect(r.calls).toEqual([['lane-a', 'show', undefined]]);
  });

  it('the advance file\'s ok state maps hold, previous, revertable, lastMove and pending', async () => {
    const got = await rig(exited(showJson('lane-a'))).read();
    if (got.kind !== 'read') throw new Error(got.kind);
    const parsed = parseAdvance({ v: 1, classes: ADV_CLASSES, pending: PENDING });
    expect(got.advance).toEqual({
      state: 'ok', detail: null, pending: PENDING,
      classes: Object.fromEntries(CLASSES.map((c) => [c, {
        family: parsed.classes[c].family, hold: parsed.classes[c].hold, previous: parsed.classes[c].previous,
        revertable: parsed.classes[c].previous !== null, lastMove: lastMoveOf(parsed.classes[c]),
      }])),
    });
    expect(got.advance!.classes![C2]).toMatchObject({ hold: { at: AT, by: 'hand' }, revertable: true });
    expect(got.advance!.classes![C2].lastMove).toMatchObject({ to: 'model-6.1-delta', ok: true });
    expect(got.advance!.classes![C0]).toMatchObject({ revertable: false, lastMove: null, hold: null });
  });

  it('absent is absent; unreadable and invalid keep their detail; a non-string detail is null', async () => {
    const adv = async (advance: unknown) => {
      const got = await rig(exited(showJson('lane-a', { advance }))).read();
      return got.kind === 'read' ? got.advance : got;
    };
    const none = { detail: null, pending: null, classes: null };
    expect(await adv({ state: 'absent' })).toEqual({ state: 'absent', ...none });
    expect(await adv({ state: 'unreadable', detail: 'p could not be read: EACCES.' }))
      .toEqual({ state: 'unreadable', detail: 'p could not be read: EACCES.', pending: null, classes: null });
    expect(await adv({ state: 'invalid', detail: 'p is not valid JSON.' }))
      .toEqual({ state: 'invalid', detail: 'p is not valid JSON.', pending: null, classes: null });
    expect(await adv({ state: 'invalid', detail: 7 })).toEqual({ state: 'invalid', ...none });
  });

  it('no advance key is unreported (D-5228), and so is an ok without pending; neither is absent', async () => {
    const none = { detail: null, pending: null, classes: null };
    const noKey = JSON.parse(showJson('lane-a')) as Record<string, unknown>;
    delete noKey.advance;
    const a = await rig(exited(`${JSON.stringify(noKey)}\n`)).read();
    expect(a).toEqual({ kind: 'read', classes: CLASS_LABELS, advance: { state: 'unreported', ...none } });
    const b = await rig(exited(showJson('lane-a', { advance: { state: 'ok', classes: ADV_CLASSES } }))).read();
    expect(b).toEqual({ kind: 'read', classes: CLASS_LABELS, advance: { state: 'unreported', ...none } });
  });

  it('an ok whose classes fail parseAdvance, or an advance that is not an object or has no state word, makes the whole answer unreadable', async () => {
    const bad = { ...ADV_CLASSES, [C0]: { ...advClass(C0), family: 'Not A Word' } };
    expect(await rig(exited(showJson('lane-a', { advance: { state: 'ok', classes: bad, pending: null } }))).read())
      .toEqual({ kind: 'unreadable' });
    expect(await rig(exited(showJson('lane-a', { advance: 'ok' }))).read()).toEqual({ kind: 'unreadable' });
    expect(await rig(exited(showJson('lane-a', { advance: { state: 7 } }))).read()).toEqual({ kind: 'unreadable' });
    expect(await rig(exited(showJson('lane-a', { advance: {} }))).read()).toEqual({ kind: 'unreadable' });
  });

  // R3b (the operator's ruling of 2026-11-17, lifting D-8693's "unreadable until wave 5"): a state WORD this server does
  // not know costs the advance record only. The lane's classes are kept, and the advance reads `invalid` with no detail.
  it.each(['stale', 'unreported', 'held', 'OK'])('an advance state word this server does not know (%s) reads invalid, classes kept', async (word) => {
    const r = rig(exited(showJson('lane-a', { advance: { state: word, detail: 'from a newer ccrc' } })));
    expect(await r.read()).toEqual({
      kind: 'read', classes: CLASS_LABELS, advance: { state: 'invalid', detail: null, pending: null, classes: null },
    });
    expect(r.reads).toEqual([]);
  });

  it('refusals: no-such-account is absent (exit 1 or 2), any other word unreadable, with no file read', async () => {
    const a = rig(exited(refusal('no-such-account'), 1));
    expect(await a.read()).toEqual({ kind: 'absent' });
    // the verb's grammar admits exit 2 for a refusal too
    const a2 = rig(exited(refusal('no-such-account'), 2));
    expect(await a2.read()).toEqual({ kind: 'absent' });
    // `unknown-argument`: a word `ccd/ccrc`'s show arm emits (exit 2), for an argv this server's builder never sends
    const b = rig(exited(refusal('unknown-argument'), 2));
    expect(await b.read()).toEqual({ kind: 'unreadable' });
    const c = rig(exited(refusal('registry-unreadable'), 1));
    expect(await c.read()).toEqual({ kind: 'unreadable' });
    // a synthetic word no build emits: unknown is unreadable, never a fallback
    const d = rig(exited(refusal('not-a-show-word'), 1));
    expect(await d.read()).toEqual({ kind: 'unreadable' });
    expect([...a.reads, ...a2.reads, ...b.reads, ...c.reads, ...d.reads]).toEqual([]);
  });

  // D-8693 named these: `show` reads the catalogue before the registry and refuses on it, and parses the registry WITH
  // the catalogue; it reads the fleet box's roster before any lane file (`roster-*`, `deploy/models-op.mjs`'s readRoster);
  // and `ccd/ccrc`'s `_models_answer` refuses `no-answer` on a node half that answered nothing usable. The files path
  // read past them until R3b; now each is `unreadable` WITH its code, so the sheet can name it (the coordinator's ruling).
  it.each([
    'catalogue-unreadable', 'catalogue-invalid', 'registry-invalid', 'roster-absent', 'roster-unreadable', 'roster-invalid',
    'no-answer',
  ])('a %s refusal is unreadable with its code carried, and no file is read', async (word) => {
    const r = rig(exited(refusal(word), 1));
    expect(await r.read()).toEqual({ kind: 'unreadable', code: word });
    expect(r.reads).toEqual([]);
  });

  it('a carried word at exit 2 carries its code too', async () => {
    const r = rig(exited(refusal('roster-invalid'), 2));
    expect(await r.read()).toEqual({ kind: 'unreadable', code: 'roster-invalid' });
    expect(r.reads).toEqual([]);
  });

  // `ccd/ccrc`'s `_ccrc_die` (e.g. `_models_deps` without jq) exits 1 with its message on stderr and NOTHING on stdout,
  // before any lane sub runs: `show` prints its body unconditionally and `_models_answer` refuses `no-answer` on an
  // empty one, so an empty stdout at exit 1 is that die alone: `unreadable`, code `no-output`. At exit 0 or 2 it is off
  // the grammar, with no code.
  it('an empty stdout at exit 1 (ccrc died before the lane) is unreadable no-output; at exit 0 or 2 it is unreadable', async () => {
    const r = rig(exited('', 1));
    expect(await r.read()).toEqual({ kind: 'unreadable', code: 'no-output' });
    expect(r.reads).toEqual([]);
    for (const code of [0, 2]) {
      const s = rig(exited('', code));
      expect(await s.read(), String(code)).toEqual({ kind: 'unreadable' });
      expect(s.reads).toEqual([]);
    }
  });

  it('an exit code that contradicts the body is unreadable: an answer at exit 1 or 2, a refusal at exit 0', async () => {
    for (const code of [1, 2]) {
      const r = rig(exited(showJson('lane-a'), code));
      expect(await r.read(), `answer at ${code}`).toEqual({ kind: 'unreadable' });
      expect(r.reads).toEqual([]);
    }
    for (const word of ['no-such-account', 'catalogue-invalid', 'roster-absent']) {
      const r = rig(exited(refusal(word), 0));
      expect(await r.read(), `${word} at 0`).toEqual({ kind: 'unreadable' });
      expect(r.reads).toEqual([]);
    }
  });

  it.each([
    ['two lines', `${showJson('lane-a')}${showJson('lane-a')}`, 0],
    ['non-JSON', '{not json\n', 0],
    ['an array', '[1]\n', 0],
    ['a bare value', '7\n', 0],
    ['empty output', '', 0],
    ['two trailing newlines', `${showJson('lane-a')}\n`, 0],
    ['exit 3 with a good object', showJson('lane-a'), 3],
    ['another op', showJson('lane-a', { op: 'hold' }), 0],
    ['another lane', showJson('lane-b'), 0],
    ['ok not true', showJson('lane-a', { ok: 'yes' }), 0],
  ])('bad stdout (%s) is unreadable', async (_n, stdout, code) => {
    const r = rig(exited(stdout as string, code as number));
    expect(await r.read()).toEqual({ kind: 'unreadable' });
    expect(r.reads).toEqual([]);
  });

  // R3b fix round 1, F1: `show` says why there is no registry, and the answer keeps it (an adapter never narrows it).
  it('registry null is absent, with the lane kind show sent: an Anthropic lane, or one never initialised', async () => {
    const absent = (over: Record<string, unknown>) => rig(exited(showJson('lane-a', { registry: null, labels: null, ...over }))).read();
    expect(await absent({ anthropic: true })).toEqual({ kind: 'absent', laneKind: 'anthropic' });
    expect(await absent({ anthropic: false })).toEqual({ kind: 'absent', laneKind: 'never-made' });
  });

  // Follow-up transient-beside-kept-answer (item 4): an `absent` with no lane kind has ONE cause, the fleet box's roster
  // has no such lane. Every `show` body has carried `anthropic` since the registry's first plan (`describe` and
  // `orphanDescribe` in the models op), so a null registry with no `anthropic` key, or one that is not a boolean, is a
  // body off the grammar: unreadable, never an absent the console words as a lane the box did not find.
  it('the two causes stay apart: no-such-account is an absent with no lane kind, a null registry without its reason is unreadable', async () => {
    expect(await rig(exited(refusal('no-such-account'), 1)).read()).toEqual({ kind: 'absent' });
    const absent = (over: Record<string, unknown>) => rig(exited(showJson('lane-a', { registry: null, labels: null, ...over }))).read();
    expect(await absent({ anthropic: undefined })).toEqual({ kind: 'unreadable' });
    expect(await absent({ anthropic: 'yes' })).toEqual({ kind: 'unreadable' });
    expect(await absent({ anthropic: null })).toEqual({ kind: 'unreadable' });
  });

  it('missing labels, a label whose model is not the pin, a bad pin or a bad efforts list is unreadable', async () => {
    const r = (over: Record<string, unknown>) => rig(exited(showJson('lane-a', over))).read();
    expect(await r({ labels: undefined })).toEqual({ kind: 'unreadable' });
    expect(await r({ labels: { ...CLASS_LABELS, [C1]: { ...CLASS_LABELS[C1], model: 'model-6.0-gamma' } } })).toEqual({ kind: 'unreadable' });
    expect(await r({ labels: { ...CLASS_LABELS, [C3]: { model: null } } })).toEqual({ kind: 'unreadable' });
    expect(await r({ labels: { ...CLASS_LABELS, [C0]: { ...CLASS_LABELS[C0], efforts: 'low' } } })).toEqual({ kind: 'unreadable' });
    // an array is not enough: every element must be a string
    expect(await r({ labels: { ...CLASS_LABELS, [C0]: { ...CLASS_LABELS[C0], efforts: ['low', 5] } } })).toEqual({ kind: 'unreadable' });
    expect(await r({ labels: { ...CLASS_LABELS, [C0]: { ...CLASS_LABELS[C0], efforts: [null] } } })).toEqual({ kind: 'unreadable' });
    expect(await r({ registry: { ...REG, classes: { ...PIN, [C0]: 5 } } })).toEqual({ kind: 'unreadable' });
    expect(await r({ registry: 'x' })).toEqual({ kind: 'unreadable' });
  });

  it('a label row without efforts (an older ccrc) reads efforts as null', async () => {
    const thin = Object.fromEntries(CLASSES.map((c) => [c, { model: CLASS_LABELS[c].model, label: CLASS_LABELS[c].label }]));
    const got = await rig(exited(showJson('lane-a', { labels: thin }))).read();
    if (got.kind !== 'read') throw new Error(got.kind);
    for (const c of CLASSES) expect(got.classes[c]).toEqual({ model: CLASS_LABELS[c].model, label: CLASS_LABELS[c].label, efforts: null });
  });

  // R3b (the coordinator's rulings): when nothing ran, the seam's own word is the answer, each its own arm, never folded
  // into unreadable and never a fallback. `busy` is transient: the next read asks again (below).
  it.each([
    [{ kind: 'unsupported' }, { kind: 'unsupported' }], [{ kind: 'refused', why: 'bad-lane' }, { kind: 'refused', why: 'bad-lane' }],
    [{ kind: 'not-started' }, { kind: 'not-started' }], [{ kind: 'busy' }, { kind: 'busy' }],
  ] as const)('nothing ran (%o): its own answer, and no file is read', async (asked, want) => {
    const r = rig(asked as ModelsAsked);
    expect(await r.read()).toEqual(want);
    expect(r.reads).toEqual([]);
  });

  it('busy is transient: the next read asks show again, and recovers the lane', async () => {
    let n = 0;
    const r = rig(async () => (++n === 1 ? { kind: 'busy' } : exited(showJson('lane-a'))));
    expect(await r.read()).toEqual({ kind: 'busy' });
    expect((await r.read()).kind).toBe('read');
    expect(r.calls).toHaveLength(2);
  });

  it.each([[{ kind: 'timeout' }], [{ kind: 'too-large' }], [{ kind: 'lost' }]] as const)(
    'it ran without an answer (%o), so it is unreadable, with no file read', async (asked) => {
      const r = rig(asked as ModelsAsked);
      expect(await r.read()).toEqual({ kind: 'unreadable' });
      expect(r.reads).toEqual([]);
    });

  it('never rejects: a models that rejects (a contract breach) reads unreadable, no file, and the next read asks again', async () => {
    const r = rig(() => Promise.reject(new Error('x')));
    await expect(r.read()).resolves.toEqual({ kind: 'unreadable' });
    expect(r.reads).toEqual([]);
    await expect(r.read()).resolves.toEqual({ kind: 'unreadable' });
    expect(r.calls).toHaveLength(2);
  });

  it('coalescing: two concurrent reads of one lane on one io call models once; a third after them calls again', async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    const r = rig(async () => { await gate; return exited(showJson('lane-a')); });
    const both = Promise.all([r.read(), r.read()]);
    await Promise.resolve();
    release();
    const [x, y] = await both;
    expect(x).toEqual(y);
    expect(r.calls).toHaveLength(1);
    await r.read();
    expect(r.calls).toHaveLength(2);
  });

  it('coalescing: two lanes at once call it twice, and two io objects do not share a call', async () => {
    const r = rig(async () => exited(refusal('no-such-account'), 1));
    await Promise.all([r.read(), readLaneModels(r.io, r.base.cfg.ccrcDir, 'lane-b')]);
    expect(r.calls.map((c) => c[0]).sort()).toEqual(['lane-a', 'lane-b']);
    const s = rig(async () => exited(refusal('no-such-account'), 1));
    await Promise.all([r.read(), s.read()]);
    expect(r.calls).toHaveLength(3);
    expect(s.calls).toHaveLength(1);
  });
});

describe('the mixed pairs (D-8688)', () => {
  // R3b: an agent from before the op answers `unsupported`, and since the grant is retired nothing else is asked.
  it('new server + an agent without the op: no frame is sent at all, and the read is unsupported', async () => {
    const home = mkTmp('ccrc-lanemodels-op-old-');
    seedLane(home, 'lane-a');
    const ccrcDir = path.join(home, '.ccrc');
    const frames: Array<Record<string, unknown>> = [];
    const client = {
      state: { agentOps: ['update', 'token-sync', 'account', 'disk', 'pressure', 'testbox', 'testbox-tools-sync', 'testbox-admin', 'backup', 'readdir-mtimes', 'overlord-history'] },
      request: async (f: Record<string, unknown>) => {
        frames.push(f);
        if (f.op === 'read') return { t: 'res', id: 1, ok: true, data: readFileSync(f.path as string, 'utf8') };
        throw new Error(`unexpected frame ${String(f.op)}`);
      },
    };
    const got = await readLaneModels(createIo(client as never), ccrcDir, 'lane-a');
    expect(got).toEqual({ kind: 'unsupported' });
    expect(frames).toEqual([]);
  });

  // `createIo().models`'s error mapping (D-8688): before the wire, or an agent that predates the op, is "nothing ran"
  // (its own answer since R3b); anything after the send, or an answer off the grammar, is `lost` (unreadable).
  describe('createIo(client).models maps each failure to its own word', () => {
    const fake = (onModels: () => Promise<unknown>) => {
      const home = mkTmp('ccrc-lanemodels-op-map-');
      seedLane(home, 'lane-a');
      const frames: Array<Record<string, unknown>> = [];
      const client = {
        state: { agentOps: [MODELS_OP] },
        request: async (f: Record<string, unknown>) => {
          frames.push(f);
          if (f.op === 'read') return { t: 'res', id: 1, ok: true, data: readFileSync(f.path as string, 'utf8') };
          return onModels();
        },
      };
      return { io: createIo(client as never), frames, ccrcDir: path.join(home, '.ccrc') };
    };

    it.each([
      ['an agent bad-request', 'unsupported', () => Promise.reject(new AgentOpError('bad-request', null))],
      ['a frame that never left', 'not-started', () => Promise.reject(new LinkNotSentError('disconnected'))],
      ['a link failure after the send', 'lost', () => Promise.reject(new Error('disconnected'))],
      ['another agent error after the send', 'lost', () => Promise.reject(new AgentOpError('internal', null))],
      ['an answer off the grammar', 'lost', () => Promise.resolve({ kind: 'exited', code: 'x', stdout: '', fleetIdentity: null })],
    ] as const)('%s is %s', async (_n, kind, onModels) => {
      const f = fake(onModels);
      expect(await f.io.models('lane-a', 'show')).toEqual({ kind });
      expect(f.frames.map((x) => x.op)).toEqual([MODELS_OP]);
    });

    it.each([
      ['bad-request', 'unsupported', () => Promise.reject(new AgentOpError('bad-request', null))],
      ['never sent', 'not-started', () => Promise.reject(new LinkNotSentError('aborted'))],
    ] as const)('readLaneModels over a %s answer is %s, and no read frame follows', async (_n, kind, onModels) => {
      const f = fake(onModels);
      expect(await readLaneModels(f.io, f.ccrcDir, 'lane-a')).toEqual({ kind });
      expect(f.frames.map((x) => x.op)).toEqual([MODELS_OP]);
    });

    // R3b fix round 1, F5: before the link's first ready frame no agent has said what it answers, so nothing is sent
    // and the answer is not-started (the frame never left), never unsupported ("update the fleet box" is the wrong remedy).
    it('before the first ready frame (agentOps unset) it is not-started, with nothing sent; a ready frame without the op is unsupported', async () => {
      const frames: Array<Record<string, unknown>> = [];
      const state: { agentOps: string[] | undefined } = { agentOps: undefined };
      const client = { state, request: async (f: Record<string, unknown>) => { frames.push(f); throw new Error('never asked'); } };
      const io = createIo(client as never);
      expect(await io.models('lane-a', 'show')).toEqual({ kind: 'not-started' });
      expect(await readLaneModels(io, '/nonexistent/.ccrc', 'lane-a')).toEqual({ kind: 'not-started' });
      state.agentOps = ['update', 'token-sync'];
      expect(await io.models('lane-a', 'show')).toEqual({ kind: 'unsupported' });
      expect(frames).toEqual([]);
    });

    it('a bad lane is refused by the builder before the wire', async () => {
      const f = fake(() => Promise.reject(new Error('never asked')));
      expect(await f.io.models('litellm', 'show')).toEqual({ kind: 'refused', why: 'bad-lane' });
      expect(f.frames).toEqual([]);
    });

    it('an exited answer passes through without its fleetIdentity', async () => {
      const f = fake(() => Promise.resolve({ kind: 'exited', code: 0, stdout: showJson('lane-a'), fleetIdentity: null }));
      expect(await f.io.models('lane-a', 'show')).toEqual({ kind: 'exited', code: 0, stdout: showJson('lane-a') });
    });
  });

  describe('new server + new agent, end to end', () => {
    const closers: Array<() => Promise<void>> = [];
    afterEach(async () => { while (closers.length) await closers.pop()!(); });

    it('readLaneModels answers through the op once agentOps lists models, with advance present', async () => {
      const fixture = makeFixture();
      const seen: Array<readonly string[]> = [];
      const spawnModels: ModelsOpSpawn = async (_file, argv) => { seen.push(argv); return { kind: 'exited', code: 0, stdout: showJson('lane-a') }; };
      const agent = await bootAgent(fixture, { spawnModels });
      closers.push(() => agent.close());
      const fleet = connectToAgent(agent.port);
      closers.push(() => fleet.close());
      await expect.poll(() => fleet.client.state.agentOps ?? [], { timeout: 3000 }).toContain(MODELS_OP);
      const got = await readLaneModels(fleet.io, path.join(fixture.home, '.ccrc'), 'lane-a');
      expect(seen).toEqual([['models', 'lane-a', 'show']]);
      expect(got.kind).toBe('read');
      expect(got.kind === 'read' && got.advance?.state).toBe('ok');
      expect(got.kind === 'read' && got.classes).toEqual(CLASS_LABELS);
    });
  });

  it('old server + new agent: readReadyOps reads the twelve-word list whole', () => {
    const ops = ['update', 'token-sync', 'account', 'disk', 'pressure', 'testbox', 'testbox-tools-sync', 'testbox-admin',
      'backup', 'readdir-mtimes', 'models', 'overlord-history'];
    expect(ops.length).toBeLessThanOrEqual(MAX_CAP_WORDS);
    expect(readReadyOps(ops)).toEqual(ops);
  });
});

describe('the local arm (D-8687)', () => {
  const saved: Record<string, string | undefined> = {};
  const KEYS = ['PATH', 'CCRC_AGENT_TOKEN'] as const;
  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k];
    process.env.PATH = path.dirname(process.execPath) === '/bin' ? '/usr/bin:/bin' : '/bin:/usr/bin';
    process.env.CCRC_AGENT_TOKEN = ['planted', 'agent', 'bearer'].join('-');
  });
  afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  it("localIOFor(home).models runs <home>/.local/bin/ccrc with {HOME, LANG, PATH}, node's directory first, and no stdin", async () => {
    const home = mkTmp('ccrc-lanemodels-local-');
    const bin = path.join(home, '.local', 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, 'ccrc'), [
      '#!/bin/bash',
      `printf '%s\\n' "$@" > '${home}/argv'`,
      `compgen -e | sort > '${home}/envnames'`,
      `printf '%s' "$PATH" > '${home}/path'`,
      `cat > '${home}/stdin'`,
      `echo '{"ok":true,"op":"show"}'`,
    ].join('\n'));
    chmodSync(path.join(bin, 'ccrc'), 0o755);
    expect(await localIOFor(home).models('lane-a', 'show')).toEqual({ kind: 'exited', code: 0, stdout: '{"ok":true,"op":"show"}\n' });
    expect(readFileSync(path.join(home, 'argv'), 'utf8')).toBe('models\nlane-a\nshow\n');
    const names = readFileSync(path.join(home, 'envnames'), 'utf8').trim().split('\n').filter((n) => !['OLDPWD', 'PWD', 'SHLVL', '_'].includes(n));
    expect(names).toEqual(['HOME', 'LANG', 'PATH']);
    expect(readFileSync(path.join(home, 'path'), 'utf8').split(':')[0]).toBe(path.dirname(process.execPath));
    expect(readFileSync(path.join(home, 'stdin'), 'utf8')).toBe('');
  });

  it('with no stub it is not-started; the bare localIO is unsupported (asserted, never run)', async () => {
    expect(await localIOFor(mkTmp('ccrc-lanemodels-local-')).models('lane-a', 'show')).toEqual({ kind: 'not-started' });
    expect(await localIO.models('lane-a', 'show')).toEqual({ kind: 'unsupported' });
  });
});

describe('GET /api/models/:lane through the op', () => {
  const apps: FastifyInstance[] = [];
  afterEach(async () => { while (apps.length) await apps.pop()!.close(); });

  it('answers 200 with models.advance present, no-store, and the same {ok, lane, models} keys', async () => {
    const base = testDeps(mkTmp('ccrc-lanemodels-op-route-'));
    // `gpt` is a lane of the default test roster (`lane-models.test.ts`'s route cases use it): the route refuses others.
    const io: FleetIO = { ...base.io, models: async (lane) => exited(showJson(lane)) };
    const app = await buildServer({ ...base, io });
    apps.push(app);
    const res = await app.inject({ method: 'GET', url: '/api/models/gpt' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json<LaneModelsAnswer>();
    expect(Object.keys(body).sort()).toEqual(['lane', 'models', 'ok']);
    expect(body.models.kind).toBe('read');
    expect(body.models.kind === 'read' && body.models.advance?.state).toBe('ok');
  });
});

// ── Model-class Anthropic arm A4, Task A4.1: an Anthropic lane's class models on the read ───────────────────────────
// The REAL op prints `show` for a fixture HOME (a roster row with `telemetry: 'anthropic'`, its aliases file and, for a hold,
// its advance file) and `readLaneModels` reads that stdout, so `describe`'s `labels` and `readShowAnswer` are measured
// together, the way the console reads them. Ids are invented, so no fixture goes stale at a release.
describe('an Anthropic lane through the real show (model-class Anthropic arm A4.1)', () => {
  const OP = fileURLToPath(new URL('../../deploy/models-op.mjs', import.meta.url));
  const X1 = 'claude-opus-9-1';
  const X2 = 'claude-opus-9-2';
  const S1 = 'claude-sonnet-9-1';
  const ROSTER = {
    version: 1,
    accounts: [
      { id: 'lane-up', label: 'lane-up', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, telemetry: 'anthropic' },
      { id: 'lane-a', label: 'lane-a', configDirSuffix: '.claude-lane-a', exec: { kind: 'generated' }, homeAble: true, telemetry: 'anthropic' },
    ],
  };
  const catRow = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id, label: `Name ${id}`, efforts: ['low', 'high'], defaultEffort: 'high', minVersion: null, ...over,
  });
  const aliasClass = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: null, source: null, evidenceAt: null, idSince: null, cacheTarget: null, seenId: null, seenAt: null,
    unobserved: true, unlaunchable: null, row: null, rowFrom: null, heldRow: null, orphaned: null, ...over,
  });
  /** A launchable, observed class on `id`, its row from the lane's own cache. */
  const kept = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => aliasClass({
    id, source: 'cache', evidenceAt: AT, idSince: AT, cacheTarget: id, unobserved: false, row: catRow(id), rowFrom: 'own', ...over,
  });
  const aliasesJson = (classes: Partial<Record<ModelClass, Record<string, unknown>>>): unknown => ({
    v: 1, at: AT, cache: { format: 'current', fetchedAt: AT }, stale: false,
    classes: Object.fromEntries(CLASSES.map((c) => [c, classes[c] ?? aliasClass()])),
  });

  /** A fixture HOME with the roster and, when given, the lane's aliases file and the holds of its advance file. */
  function plant(aliases: unknown, holds: Partial<Record<ModelClass, string>> = {}) {
    const base = testDeps(mkTmp('ccrc-lanemodels-anth-'));
    const home = base.cfg.home;
    const dir = path.join(home, '.ccrc', MODELS_DIR_NAME);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(home, '.ccrc', 'accounts.json'), JSON.stringify(ROSTER));
    if (aliases !== undefined) writeFileSync(path.join(dir, 'lane-a.aliases.json'), typeof aliases === 'string' ? aliases : JSON.stringify(aliases));
    if (Object.keys(holds).length > 0) {
      const adv = seedAnthropicAdvance();
      for (const [c, model] of Object.entries(holds)) adv.classes[c as ModelClass].hold = { at: AT, by: 'hand', model };
      writeFileSync(path.join(dir, 'lane-a.advance.json'), serializeAdvance(adv));
    }
    return { base, home, dir };
  }
  const showOf = (home: string): { code: number; stdout: string } => {
    const r = spawnSync(process.execPath, [OP, 'show', '--file', path.join(home, '.ccrc', 'accounts.json'), '--id', 'lane-a'],
      { env: { PATH: process.env['PATH'] ?? '', HOME: home }, encoding: 'utf8' });
    return { code: r.status ?? -1, stdout: r.stdout };
  };
  /** The lane read the way the console reads it: the real op's stdout through `readLaneModels`. */
  async function readLane(p: ReturnType<typeof plant>) {
    const s = showOf(p.home);
    const io: FleetIO = { ...p.base.io, models: async () => exited(s.stdout, s.code) };
    return { got: await readLaneModels(io, p.base.cfg.ccrcDir, 'lane-a'), shown: JSON.parse(s.stdout) as Record<string, unknown> };
  }
  const readOf = async (p: ReturnType<typeof plant>) => {
    const { got } = await readLane(p);
    if (got.kind !== 'read') throw new Error(`read ${got.kind}`);
    return got;
  };

  it('an Anthropic lane reads its aliases', async () => {
    const p = plant(aliasesJson({
      [C0]: kept(X1, { seenId: X1, orphaned: { id: 'claude-opus-9-0', level: 'high' } }),
      [C1]: kept(S1, { source: 'use', row: catRow(S1, { label: null, efforts: null }), cacheTarget: null }),
      [C2]: kept(X2, { row: catRow(X2, { efforts: [] }) }),
    }));
    const got = await readOf(p);
    expect(got.classes[C0]).toEqual({
      model: X1, label: `Name ${X1}`, efforts: ['low', 'high'], source: 'cache', cacheTarget: X1, seenId: X1,
      orphanedEffort: { id: 'claude-opus-9-0', level: 'high' },
    });
    // a row with no label reads as the id, and one with no effort field as null (not "takes none")
    expect(got.classes[C1]).toEqual({
      model: S1, label: S1, efforts: null, source: 'use', cacheTarget: null, seenId: null, orphanedEffort: null,
    });
    // a row that says the model takes no level
    expect(got.classes[C2]).toMatchObject({ model: X2, efforts: [], takesNoEffort: true });
    expect(got.classes[C0]).not.toHaveProperty('takesNoEffort');
    expect(got.advance?.state).toBe('absent');
  });

  it('a class with no id reads as a row of nulls, the lane read', async () => {
    const got = await readOf(plant(aliasesJson({ [C0]: kept(X1) })));
    expect(got.classes[C3]).toEqual({
      model: null, label: null, efforts: null, source: null, cacheTarget: null, seenId: null, unobserved: true,
      orphanedEffort: null,
    });
    expect(got.classes[C0].model).toBe(X1);
  });

  it('an unlaunchable id reads as a row of nulls and names the builds', async () => {
    const got = await readOf(plant(aliasesJson({
      [C0]: kept(X2, { unobserved: true, unlaunchable: { needs: '9.9.9', laneVersion: '2.0.0' }, row: catRow(X2, { minVersion: '9.9.9' }) }),
      [C1]: kept(S1, { unobserved: true, unlaunchable: { needs: '9.9.9', laneVersion: null }, row: catRow(S1, { minVersion: '9.9.9' }) }),
    })));
    expect(got.classes[C0]).toEqual({
      model: null, label: null, efforts: null, source: 'cache', cacheTarget: X2, seenId: null, unobserved: true,
      unlaunchable: { needs: '9.9.9', laneVersion: '2.0.0' }, orphanedEffort: null,
    });
    expect(got.classes[C1].unlaunchable).toEqual({ needs: '9.9.9', laneVersion: null });
    expect(got.classes[C1].model).toBeNull();
  });

  it("a held class's label and efforts are the held id's", async () => {
    // held on X1, and the alias has since moved to X2
    const p = plant(aliasesJson({
      [C0]: kept(X2, { row: catRow(X2, { label: 'Moved', efforts: ['low', 'medium', 'high'] }), heldRow: catRow(X1, { label: 'Held', efforts: ['low'] }) }),
      // held on the id the alias still names: no second id to show
      [C1]: kept(S1, { heldRow: catRow(S1, { label: 'Same' }) }),
      // held on an id with no row in the cache: the id is its own label, and no levels are known
      [C2]: kept(X2, { heldRow: null }),
    }), { [C0]: X1, [C1]: S1, [C2]: 'claude-opus-9-0' });
    const got = await readOf(p);
    expect(got.classes[C0]).toMatchObject({ model: X1, label: 'Held', efforts: ['low'], aliasId: X2 });
    expect(got.classes[C1]).toMatchObject({ model: S1, label: 'Same', efforts: ['low', 'high'] });
    expect(got.classes[C1]).not.toHaveProperty('aliasId');
    expect(got.classes[C2]).toMatchObject({ model: 'claude-opus-9-0', label: 'claude-opus-9-0', efforts: null, aliasId: X2 });
    // a class with no hold reads as the alias does
    expect(got.classes[C3]).toMatchObject({ model: null });
  });

  it('an unobserved class carries unobserved', async () => {
    const got = await readOf(plant(aliasesJson({ [C0]: kept(X1, { unobserved: true }), [C1]: kept(S1) })));
    expect(got.classes[C0].unobserved).toBe(true);
    expect(got.classes[C1]).not.toHaveProperty('unobserved');
  });

  it('the held id rides advance.hold.model', async () => {
    const got = await readOf(plant(aliasesJson({ [C0]: kept(X2, { heldRow: catRow(X1) }) }), { [C0]: X1 }));
    expect(got.advance?.state).toBe('ok');
    expect(got.advance?.classes?.[C0].hold).toEqual({ at: AT, by: 'hand', model: X1 });
    expect(got.advance?.classes?.[C1].hold).toBeNull();
  });

  it('an unreadable or invalid aliases file reads the lane unreadable', async () => {
    const aliasesState = (shown: Record<string, unknown>) => (shown.aliases as { state?: string }).state;
    // not JSON, and JSON that is not an aliases file: invalid
    for (const text of ['{not json', JSON.stringify({ v: 2 })]) {
      const { got, shown } = await readLane(plant(text));
      expect(aliasesState(shown), text).toBe('invalid');
      expect(got, text).toEqual({ kind: 'unreadable' });
    }
    // a directory where the file belongs cannot be read as a file: unreadable
    const p = plant(undefined);
    mkdirSync(path.join(p.dir, 'lane-a.aliases.json'));
    const { got, shown } = await readLane(p);
    expect(aliasesState(shown)).toBe('unreadable');
    expect(got).toEqual({ kind: 'unreadable' });
    // no file at all stays absent, with the lane kind
    expect((await readLane(plant(undefined))).got).toEqual({ kind: 'absent', laneKind: 'anthropic' });
  });
});

// A stub `show` for an Anthropic lane: the reader's own grammar, apart from the op that prints it.
describe('readLaneModels over an Anthropic lane\'s show body (model-class Anthropic arm A4.1)', () => {
  const ROWS = Object.fromEntries(CLASSES.map((c) => [c, { model: `claude-x-9-${c.length}`, label: 'L', efforts: ['low'] }]));
  const anth = (over: Record<string, unknown>) => showJson('lane-a', { anthropic: true, registry: null, aliases: { v: 1 }, labels: ROWS, ...over });
  const read = (over: Record<string, unknown>) => rig(exited(anth(over))).read();

  it('the aliases state words keep three answers: absent, absent for an older op, and unreadable twice', async () => {
    expect(await read({ aliases: { state: 'absent' }, labels: null })).toEqual({ kind: 'absent', laneKind: 'anthropic' });
    expect(await read({ aliases: undefined, labels: null })).toEqual({ kind: 'absent', laneKind: 'anthropic' });
    expect(await read({ aliases: { state: 'unreadable', detail: 'd' }, labels: null })).toEqual({ kind: 'unreadable' });
    expect(await read({ aliases: { state: 'invalid', detail: 'd' }, labels: null })).toEqual({ kind: 'unreadable' });
    expect((await read({})).kind).toBe('read');
  });

  it('a parsed aliases file with no labels, a bad class row or an unreadable advance reads unreadable', async () => {
    expect(await read({ labels: null })).toEqual({ kind: 'unreadable' });
    expect(await read({ labels: { ...ROWS, [C3]: { model: 7 } } })).toEqual({ kind: 'unreadable' });
    expect(await read({ labels: { ...ROWS, [C3]: undefined } })).toEqual({ kind: 'unreadable' });
    expect(await read({ aliases: 'x' })).toEqual({ kind: 'unreadable' });
    expect(await read({ advance: 'ok' })).toEqual({ kind: 'unreadable' });
  });

  it('a malformed optional field is dropped to absent and the row is kept', async () => {
    const bad = {
      model: 'claude-x-9-1', label: 'L', efforts: ['low'], takesNoEffort: false, source: 'guess', cacheTarget: 5, seenId: {},
      unobserved: false, unlaunchable: { needs: 5 }, aliasId: 7, orphanedEffort: { id: 'x' },
    };
    const good = {
      model: 'claude-x-9-2', label: 'L', efforts: [], takesNoEffort: true, source: 'use', cacheTarget: 'claude-x-9-3',
      seenId: null, unobserved: true, unlaunchable: { needs: '1.2', laneVersion: null }, aliasId: 'claude-x-9-4',
      orphanedEffort: { id: 'claude-x-9-5', level: 'high' },
    };
    const got = await read({ labels: { ...ROWS, [C0]: bad, [C1]: good } });
    if (got.kind !== 'read') throw new Error(got.kind);
    expect(got.classes[C0]).toEqual({ model: 'claude-x-9-1', label: 'L', efforts: ['low'] });
    expect(got.classes[C1]).toEqual(good);
  });

  it("a Codex lane's classes carry none of the new keys", async () => {
    const got = await rig(exited(showJson('lane-a'))).read();
    if (got.kind !== 'read') throw new Error(got.kind);
    for (const c of CLASSES) expect(Object.keys(got.classes[c]).sort(), c).toEqual(['efforts', 'label', 'model']);
  });
});
