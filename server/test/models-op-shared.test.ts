// Auto-advance plan W4a Task 16, as re-planned (D-8687, D-8692): the `models` op's L0 words, its ONE builder, its
// bounds and the ONE reader of its answer (`shared/agent-protocol.ts`). The bounds' ORDER is read from `ccd/ccrc`'s own
// lock wait, and the actions from its own `MODELS_SUBS`, so a drift on either side reds here.
// (The file name `models-op.test.ts` is `deploy/models-op.mjs`'s suite.)
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ACCOUNT_OP, MODELS_ACTIONS, MODELS_ARGV_REFUSALS, MODELS_KILL_GRACE_MS, MODELS_OP, MODELS_OP_DRAIN_MS,
  MODELS_OP_OUTPUT_MAX_BYTES, MODELS_OP_REQUEST_TIMEOUT_MS, MODELS_SPAWN_TIMEOUT_MS, NODE_ID_RE, TOKEN_SYNC_OP, UPDATE_OP,
  buildModelsArgv, isModelsAction, isModelsClass, isModelsLaneId, readModelsOpAnswer,
  type AgentReq, type ModelsReq,
} from '../../shared/agent-protocol.js';
import { ACCOUNT_OP_KILL_GRACE_MS } from '../../shared/api.js';
import { CLASSES, MODELS_LANE_ID_RE, MODELS_RESERVED_IDS } from '../../shared/models.js';

const CCRC = readFileSync(path.join(import.meta.dirname, '..', '..', 'ccd', 'ccrc'), 'utf8');
const WRITING = MODELS_ACTIONS.filter((a) => a !== 'show');
const FID = '01234567-89ab-cdef-0123-456789abcdef';

describe('buildModelsArgv: the two frozen shapes', () => {
  it('show is [models, lane, show], frozen', () => {
    const b = buildModelsArgv('lane-a', 'show', undefined);
    expect(b).toEqual({ ok: true, argv: ['models', 'lane-a', 'show'] });
    expect(b.ok && Object.isFrozen(b.argv)).toBe(true);
  });

  it.each(WRITING.flatMap((a) => CLASSES.map((c) => [a, c] as const)))('%s %s is [models, lane, action, class], frozen', (a, c) => {
    const b = buildModelsArgv('lane-a', a, c);
    expect(b).toEqual({ ok: true, argv: ['models', 'lane-a', a, c] });
    expect(b.ok && Object.isFrozen(b.argv)).toBe(true);
  });
});

describe('buildModelsArgv: its refusals, by word, in order', () => {
  const badLanes: unknown[] = [...MODELS_RESERVED_IDS, 'lane/a', '..', '-lane', 'Lane-a', `l${'a'.repeat(32)}`, '',
    'lane-a\n', 'lane\u0000a', 7, null, undefined, ['lane-a'], { lane: 'lane-a' }];
  it.each(badLanes.map((l) => [JSON.stringify(l) ?? String(l), l]))('lane %s is bad-lane', (_n, lane) => {
    expect(buildModelsArgv(lane, 'show', undefined)).toEqual({ ok: false, why: 'bad-lane' });
    // the lane is judged first: a bad action and class too still say bad-lane
    expect(buildModelsArgv(lane, 'rm', 'subagent')).toEqual({ ok: false, why: 'bad-lane' });
  });

  it.each(['rm', 'set-class', undefined, 'Hold', 3, null])('action %s is bad-action', (a) => {
    expect(buildModelsArgv('lane-a', a, undefined)).toEqual({ ok: false, why: 'bad-action' });
    expect(buildModelsArgv('lane-a', a, CLASSES[0])).toEqual({ ok: false, why: 'bad-action' });
  });

  it('a class on show, none on a writing action, and an off-list class are bad-class', () => {
    expect(buildModelsArgv('lane-a', 'show', CLASSES[0])).toEqual({ ok: false, why: 'bad-class' });
    expect(buildModelsArgv('lane-a', 'show', null)).toEqual({ ok: false, why: 'bad-class' });
    expect(buildModelsArgv('lane-a', 'hold', undefined)).toEqual({ ok: false, why: 'bad-class' });
    for (const a of WRITING) expect(buildModelsArgv('lane-a', a, 'subagent')).toEqual({ ok: false, why: 'bad-class' });
    expect(buildModelsArgv('lane-a', 'hold', CLASSES[0].toUpperCase())).toEqual({ ok: false, why: 'bad-class' });
  });

  it('the refusal list is exactly the three words', () => {
    expect([...MODELS_ARGV_REFUSALS]).toEqual(['bad-lane', 'bad-action', 'bad-class']);
  });
});

describe('isModelsLaneId: the ONE lane guard', () => {
  it('takes a 32-character id and refuses 33', () => {
    expect(isModelsLaneId(`l${'a'.repeat(31)}`)).toBe(true);
    expect(isModelsLaneId(`l${'a'.repeat(32)}`)).toBe(false);
  });

  it.each([...MODELS_RESERVED_IDS])('%s passes MODELS_LANE_ID_RE alone and fails the guard', (w) => {
    expect(MODELS_LANE_ID_RE.test(w)).toBe(true);
    expect(isModelsLaneId(w)).toBe(false);
  });

  it('refuses a non-string', () => {
    for (const v of [1, null, undefined, {}, ['lane-a']]) expect(isModelsLaneId(v)).toBe(false);
  });
});

describe("the bounds, and their ORDER against ccd/ccrc's lock wait", () => {
  it('the spawn bound is above the lane-files lock wait, and the request deadline above the whole answer', () => {
    const waits = [...new Set([...CCRC.matchAll(/\$\{CCRC_MODELS_LOCK_S:-(\d+)\}/g)].map((m) => Number(m[1])))];
    expect(waits, 'exactly one distinct default lock wait in ccd/ccrc').toHaveLength(1);
    expect(waits[0]! * 1000).toBeLessThan(MODELS_SPAWN_TIMEOUT_MS);
    expect(MODELS_SPAWN_TIMEOUT_MS + MODELS_KILL_GRACE_MS + MODELS_OP_DRAIN_MS).toBeLessThan(MODELS_OP_REQUEST_TIMEOUT_MS);
  });

  it('pins the five values, the grace equal to the account op\'s', () => {
    expect(MODELS_SPAWN_TIMEOUT_MS).toBe(40_000);
    expect(MODELS_KILL_GRACE_MS).toBe(5_000);
    expect(MODELS_KILL_GRACE_MS).toBe(ACCOUNT_OP_KILL_GRACE_MS);
    expect(MODELS_OP_DRAIN_MS).toBe(2_000);
    expect(MODELS_OP_OUTPUT_MAX_BYTES).toBe(262_144);
    expect(MODELS_OP_REQUEST_TIMEOUT_MS).toBe(52_000);
  });
});

describe('the words', () => {
  it('MODELS_OP is models, and no other op\'s word', () => {
    expect(MODELS_OP).toBe('models');
    for (const w of [ACCOUNT_OP, UPDATE_OP, TOKEN_SYNC_OP]) expect(MODELS_OP).not.toBe(w);
  });

  it("every action is one of ccd/ccrc's MODELS_SUBS", () => {
    const lines = CCRC.split('\n').filter((l) => /^MODELS_SUBS="[^"]*"$/.test(l));
    expect(lines).toHaveLength(1);
    const subs = lines[0]!.slice('MODELS_SUBS="'.length, -1).split(' ');
    for (const a of MODELS_ACTIONS) expect(subs, a).toContain(a);
  });

  it('isModelsClass takes exactly CLASSES, isModelsAction exactly MODELS_ACTIONS', () => {
    for (const c of CLASSES) expect(isModelsClass(c)).toBe(true);
    for (const v of ['subagent', '', CLASSES[0].toUpperCase(), 1, null]) expect(isModelsClass(v)).toBe(false);
    for (const a of MODELS_ACTIONS) expect(isModelsAction(a)).toBe(true);
    for (const v of ['rm', 'Show', '', 1, null]) expect(isModelsAction(v)).toBe(false);
  });
});

describe("readModelsOpAnswer: the ONE reader's grammar", () => {
  const kinds = [
    { kind: 'exited', code: 0, stdout: '{"ok":true}\n' },
    { kind: 'exited', code: 255, stdout: '' },
    { kind: 'timeout' }, { kind: 'too-large' }, { kind: 'not-started' }, { kind: 'busy' },
    ...MODELS_ARGV_REFUSALS.map((why) => ({ kind: 'refused', why })),
  ];
  it.each(kinds.flatMap((k) => [[k, FID], [k, null]] as const))('%o round-trips with fleetIdentity %s', (k, fid) => {
    expect(readModelsOpAnswer({ ...k, fleetIdentity: fid })).toEqual({ ...k, fleetIdentity: fid });
  });

  it('fleetIdentity must be null or pass NODE_ID_RE', () => {
    expect(NODE_ID_RE.test(FID)).toBe(true);
    for (const fid of ['node-a', '', FID.toUpperCase(), 7, undefined]) {
      expect(readModelsOpAnswer({ kind: 'busy', fleetIdentity: fid }), String(fid)).toBeNull();
    }
  });

  it('exited with a code off 0..255 or a non-string stdout is null', () => {
    for (const code of [256, -1, 1.5, '0', null]) {
      expect(readModelsOpAnswer({ kind: 'exited', code, stdout: '', fleetIdentity: null }), String(code)).toBeNull();
    }
    for (const stdout of [null, 1, undefined, ['x']]) {
      expect(readModelsOpAnswer({ kind: 'exited', code: 0, stdout, fleetIdentity: null }), String(stdout)).toBeNull();
    }
  });

  it('refused with a why off the list, an unknown kind, a non-object and bad-request are null', () => {
    expect(readModelsOpAnswer({ kind: 'refused', why: 'bad-sub', fleetIdentity: null })).toBeNull();
    expect(readModelsOpAnswer({ kind: 'refused', fleetIdentity: null })).toBeNull();
    expect(readModelsOpAnswer({ kind: 'lost', fleetIdentity: null })).toBeNull();
    expect(readModelsOpAnswer({ kind: 'unsupported', fleetIdentity: null })).toBeNull();
    for (const raw of [null, undefined, 'exited', 3, []]) expect(readModelsOpAnswer(raw)).toBeNull();
    expect(readModelsOpAnswer({ t: 'res', id: 1, ok: false, err: 'bad-request' })).toBeNull();
  });
});

describe('ModelsReq is an AgentReq member', () => {
  it('each shape type-checks as an AgentReq', () => {
    const show: ModelsReq = { t: 'req', id: 1, op: 'models', lane: 'lane-a', action: 'show' };
    const hold: ModelsReq = { t: 'req', id: 2, op: 'models', lane: 'lane-a', action: 'hold', class: CLASSES[0] };
    const both: AgentReq[] = [show, hold];
    expect(both.map((r) => r.op)).toEqual(['models', 'models']);
  });
});
