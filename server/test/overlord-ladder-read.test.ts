import { describe, expect, it } from 'vitest';
import type { DesignationRead } from '../../shared/overlord-designation.js';
import { degradedReading } from '../src/coord/overlordLadder.js';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from '../src/coord/schema.js';
import { CoordStore } from '../src/coord/store.js';
import { ladderRead, ladderConditionInputs, NO_WITNESS_YET, type LadderConditionInputs, type LadderConditionInputsFor } from '../src/coord/overlordLadderRead.js';
import { LADDER_CAUSE_MAP } from '../../shared/overlord-ladder.js';
import type { GenRow } from '../src/continuity/continuityStore.js';
import type { IsolationRead } from '../../shared/isolation.js';
import { SERVER_CAPS } from '../../shared/api.js';
import { ISOLATION_NOT_WIRED } from '../src/isolationWord.js';

// @ts-expect-error Both condition keys need a reader.
const incompleteInputs: LadderConditionInputs = { 'generation-degraded': () => 'lifted' };
void incompleteInputs;

function store() {
  const db = new DatabaseSync(':memory:');
  db.exec(MIGRATIONS.find((m) => m.includes('CREATE TABLE overlord_designation'))!);
  db.exec(MIGRATIONS.find((m) => m.includes('CREATE TABLE overlord_ladder'))!);
  return { db, coord: new CoordStore(db) };
}
const lifted = { 'generation-degraded': () => 'lifted' as const, 'off-model': () => 'lifted' as const, 'rung-word-missing': () => 'lifted' as const, 'shared-user': () => 'lifted' as const, 'no-witness-since-boot': () => 'lifted' as const };
const futureTable = { ...LADDER_CAUSE_MAP, 'condition-a': { kind: 'condition' } } as const;
// @ts-expect-error A new condition row cannot ship without its input.
const futureInputs: LadderConditionInputsFor<typeof futureTable> = lifted;
void futureInputs;

const designated = { kind: 'designated', sessionId: 'lane-a', term: 1, row: null } as unknown as DesignationRead;
const none: DesignationRead = { kind: 'not-designated', row: null };
const unreadable: DesignationRead = { kind: 'unmeasured', why: 'unreadable' };

describe('generation degraded condition', () => {
  it('preserves the distinction between a missing generation, unmeasured, and degraded', () => {
    expect(degradedReading(unreadable, 'no-generation')).toBe('unmeasured');
    expect(degradedReading(none, 'unmeasured')).toBe('lifted');
    expect(degradedReading(designated, 'unmeasured')).toBe('unmeasured');
    expect(degradedReading(designated, 'no-generation')).toBe('lifted');
    expect(degradedReading(designated, { state: 'degraded' })).toBe('standing');
    expect(degradedReading(designated, { state: 'active' })).toBe('lifted');
  });
});

describe('composed ladder read', () => {
  it('defaults to chat and fails closed on invalid rows', () => {
    const { db, coord } = store();
    expect(ladderRead(coord, ladderConditionInputs({ coord, serverCaps: [] }), NO_WITNESS_YET, [])).toMatchObject({ kind: 'measured', effective: { rung: 'chat', binding: [] }, conditions: [{ cause: 'generation-degraded', reading: 'lifted' }, { cause: 'off-model', reading: 'lifted' }, { cause: 'rung-word-missing', reading: 'lifted' }, { cause: 'shared-user', reading: 'unmeasured' }, { cause: 'no-witness-since-boot', reading: 'unmeasured' }] });
    db.exec("INSERT INTO overlord_latches (cause, cap, detail, raisedAt, raisedBy) VALUES ('latch-a', 'wrong', '', 1, 'actor')");
    expect(ladderRead(coord, lifted, NO_WITNESS_YET, []).kind).toBe('unmeasured');
    db.close();
  });
  it('caps an unmeasured condition and catches a throwing witness', () => {
    const { db, coord } = store();
    db.exec("INSERT INTO overlord_ladder VALUES (1, 'full', 'actor', 1, 7, NULL, 1)");
    const read = ladderRead(coord, { ...lifted, 'generation-degraded': () => { throw Error('offline'); } }, { heldFor: () => { throw Error('offline'); } }, ['overlord-answer-v1']);
    expect(read).toMatchObject({ effective: { rung: 'chat', binding: [{ cause: 'generation-degraded', reading: 'unmeasured' }] }, lastChange: { narrowing: { state: 'taking-effect', why: 'witness-unmeasured' } } });
    expect(ladderRead(coord, { ...lifted, 'generation-degraded': () => 'unmeasured' }, NO_WITNESS_YET, ['overlord-answer-v1'])).toMatchObject({ effective: { rung: 'chat', binding: [{ cause: 'generation-degraded', reading: 'unmeasured' }] } });
    db.close();
  });
  it('reports witness states for row-only, not-yet, held and unmeasured', () => {
    const { db, coord } = store();
    db.exec("INSERT INTO overlord_ladder VALUES (1, 'chat', 'actor', 1, 7, NULL, 1)");
    for (const [held, expected] of [['not-yet', { state: 'taking-effect', why: 'no-witness-yet' }], ['held', { state: 'done' }], ['unmeasured', { state: 'taking-effect', why: 'witness-unmeasured' }]] as const) {
      expect(ladderRead(coord, lifted, { heldFor: () => held }, [])).toMatchObject({ lastChange: { narrowing: expected } });
    }
    db.close();
  });
  it('uses the live generation accessor and the continuity gate', () => {
    const { db, coord } = store();
    const row = { identity: 'overlord', state: 'active', shadowState: 'degraded', walk: null } as GenRow;
    const source = {
      designationRead: () => designated,
      liveGenerations: () => ({ ok: true as const, rows: [row] }),
      laneArmSetting: () => ({ kind: 'row' as const, choice: 'live' as const, updatedAt: 1, importedAt: null, imported: null }),
      ladderRungRead: () => coord.ladderRungRead(),
    };
    expect(ladderConditionInputs({ coord: source, serverCaps: [], continuityGate: () => null })['generation-degraded']()).toBe('lifted');
    expect(ladderConditionInputs({ coord: source, serverCaps: [], continuityGate: () => 'closed' })['generation-degraded']()).toBe('standing');
    const broken = { ...source, liveGenerations: () => { throw Error('unreadable'); } };
    expect(ladderConditionInputs({ coord: broken, serverCaps: [] })['generation-degraded']()).toBe('unmeasured');
    db.close();
  });
  it('the word condition uses the stored rung and measured server capabilities', () => {
    const { db, coord } = store();
    db.exec("INSERT INTO overlord_ladder VALUES (1, 'full', 'actor', 1, NULL, 'chat', 1)");
    const inputs = ladderConditionInputs({ coord, serverCaps: [] });
    expect(inputs['rung-word-missing']()).toBe('standing');
    expect(ladderRead(coord, inputs, NO_WITNESS_YET, [])).toMatchObject({ effective: { rung: 'chat' }, lastChange: { narrowing: { state: 'taking-effect', why: 'not-journalled' } } });
    db.close();
  });
});

describe("the shared-user condition, read from the isolation word (Overlord W1, Table 7.5a)", () => {
  const WORDS = ['overlord-route-v1', 'overlord-answer-v1'];
  const atFull = () => { const s = store(); s.db.exec("INSERT INTO overlord_ladder VALUES (1, 'full', 'actor', 1, NULL, 'chat', 1)"); return s; };
  const inputs = (coord: CoordStore, read: IsolationRead | null, serverCaps: readonly string[] = WORDS) =>
    ladderConditionInputs({ coord, serverCaps, noWitnessSinceBoot: lifted['no-witness-since-boot'], ...(read === null ? {} : { isolation: { read: () => read } }) });
  it('a shared-user reading binds the effective rung at advise, the condition standing', () => {
    const { db, coord } = atFull();
    const r = ladderRead(coord, inputs(coord, { kind: 'measured', word: 'shared-user', cause: 'local-mode' }), NO_WITNESS_YET, WORDS);
    expect(r).toMatchObject({ kind: 'measured', effective: { rung: 'advise', binding: [{ cause: 'shared-user', kind: 'condition', cap: 'advise', reading: 'standing' }] } });
    db.close();
  });
  it('a separate-user reading lifts it', () => {
    const { db, coord } = atFull();
    const r = ladderRead(coord, inputs(coord, { kind: 'measured', word: 'separate-user', cause: 'other-user' }), NO_WITNESS_YET, WORDS);
    expect(r).toMatchObject({ kind: 'measured', effective: { rung: 'full', binding: [] } });
    db.close();
  });
  it('an unmeasured reading, and no reader wired, bind advise with the condition unmeasured', () => {
    // The ladder projects only the condition, so pin the default's reason before that projection.
    expect(ISOLATION_NOT_WIRED).toEqual({ kind: 'unmeasured', why: 'not-wired' });
    const { db, coord } = atFull();
    for (const read of [{ kind: 'unmeasured', why: 'agent-older' } as const, null]) {
      const r = ladderRead(coord, inputs(coord, read), NO_WITNESS_YET, WORDS);
      expect(r).toMatchObject({ kind: 'measured', effective: { rung: 'advise', binding: [{ cause: 'shared-user', cap: 'advise', reading: 'unmeasured' }] } });
    }
    db.close();
  });
  it('in W1 the effective rung is chat either way: the server holds no advise word, so the cap binds only from W2', () => {
    const { db, coord } = atFull();
    for (const read of [{ kind: 'measured', word: 'shared-user', cause: 'store-mode' } as const, { kind: 'measured', word: 'separate-user', cause: 'other-user' } as const]) {
      const r = ladderRead(coord, inputs(coord, read, SERVER_CAPS), NO_WITNESS_YET, SERVER_CAPS);
      expect(r).toMatchObject({ kind: 'measured', effective: { rung: 'chat' } });
    }
    db.close();
  });
});
