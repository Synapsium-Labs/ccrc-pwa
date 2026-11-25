// Overlord W1, designation B, plan Tasks 7 and 10: the deciders Restart and the deadline sweep ask, and the write-set step
// before a renewal (`overlordDesignation.ts#restartVerdict`, `overlordBodyOf`, `pendingDeadlineOf`, `renewalSetOf`). The
// verdict cases live in `sim/designationSets.ts`, written once for this file and for the every-run mutation floors.
import { describe, it, expect } from 'vitest';
import * as m from '../src/coord/overlordDesignation.js';
import type { FleetSession } from '../../shared/api.js';
import type { DesignationRead } from '../../shared/overlord-designation.js';
import { parseRoster } from '../../shared/roster.js';
import { SET_A, SET_AB, afacts, boundRead, limit, pendingDeadlineCases, restartVerdictCases } from './sim/designationSets.js';

const X = 'overlord-quiet-otter';
/** The few fields `overlordBodyOf` reads of an assembled session (`rowStanding`'s facts and the lifecycle). */
const session = (over: Record<string, unknown>): FleetSession => ({ id: X, ...over }) as unknown as FleetSession;
const body = (s: FleetSession | null, listed: ReadonlySet<string> | null = new Set([X])) =>
  m.overlordBodyOf({ sessionId: X, listedIds: listed, session: s });

describe('restartVerdict', () => {
  for (const [name, fn] of Object.entries(restartVerdictCases(m))) it(name, fn);
});

describe('overlordBodyOf', () => {
  it('a listing that could not be read is unmeasured, whatever the session says', () => {
    expect(body(session({ presence: 'alive' }), null)).toMatchObject({ kind: 'unmeasured' });
    expect(body(null, null)).toMatchObject({ kind: 'unmeasured' });
  });
  it('an id the listing does not name is gone, absent', () => {
    expect(body(null, new Set(['lane-a-project-a']))).toEqual({ kind: 'gone', cause: 'absent' });
    expect(body(session({ presence: 'alive' }), new Set())).toEqual({ kind: 'gone', cause: 'absent' });
  });
  it('a listed id with no assembled session is unmeasured, never gone', () => {
    expect(body(null)).toMatchObject({ kind: 'unmeasured' });
  });
  it('presence alive is up; asleep is asleep', () => {
    expect(body(session({ presence: 'alive' }))).toEqual({ kind: 'up' });
    expect(body(session({ presence: 'alive', lifecycle: null }))).toEqual({ kind: 'up' });
    expect(body(session({ presence: 'asleep' }))).toEqual({ kind: 'asleep' });
  });
  it('alive and restarting, with no unmeasured field, is down with no first sighting', () => {
    expect(body(session({ presence: 'alive', lifecycle: 'restarting' }))).toEqual({ kind: 'down', since: null });
    expect(body(session({ presence: 'alive', lifecycle: 'restarting', unmeasured: [] }))).toEqual({ kind: 'down', since: null });
  });
  it('alive and restarting WITH an unmeasured identity field is unmeasured, and so is any other doubt', () => {
    expect(body(session({ presence: 'alive', lifecycle: 'restarting', unmeasured: ['uuid'] }))).toMatchObject({ kind: 'unmeasured' });
    expect(body(session({ presence: 'alive', unmeasured: ['wrapper'] }))).toMatchObject({ kind: 'unmeasured' });
    expect(body(session({ presence: 'unknown' }))).toMatchObject({ kind: 'unmeasured' });
    expect(body(session({}))).toMatchObject({ kind: 'unmeasured' });
  });
  it('a dead body is gone, naming its lifecycle when that is a dead cause, and orphan otherwise', () => {
    expect(body(session({ presence: 'dead', lifecycle: 'stopped' }))).toEqual({ kind: 'gone', cause: 'stopped' });
    expect(body(session({ presence: 'dead', lifecycle: 'never-started' }))).toEqual({ kind: 'gone', cause: 'never-started' });
    expect(body(session({ presence: 'dead', lifecycle: 'orphan' }))).toEqual({ kind: 'gone', cause: 'orphan' });
    expect(body(session({ presence: 'dead', lifecycle: 'restarting' }))).toEqual({ kind: 'gone', cause: 'orphan' });
    expect(body(session({ presence: 'dead', lifecycle: null }))).toEqual({ kind: 'gone', cause: 'orphan' });
    expect(body(session({ presence: 'dead' }))).toEqual({ kind: 'gone', cause: 'orphan' });
  });
});

describe('pendingDeadlineOf', () => {
  for (const [name, fn] of Object.entries(pendingDeadlineCases(m))) it(name, fn);
});

describe('renewalSetOf', () => {
  const read = (over: Parameters<typeof boundRead>[0] = {}): DesignationRead => boundRead({ model: 'fable', ...over });
  const OPUS = (over: Parameters<typeof boundRead>[0] = {}): DesignationRead => boundRead({ model: 'opus', ...over });
  const A = 'overlord-x'; // the id `boundRead` binds
  it('an unreadable row answers why, and nothing is written', () => {
    expect(m.renewalSetOf({ kind: 'unmeasured', why: 'torn row' }, A, afacts())).toEqual({ ok: false, detail: 'the designation could not be read: torn row' });
  });
  it('no live binding (no row, a row with no body) answers why', () => {
    expect(m.renewalSetOf({ kind: 'not-designated', row: null }, A, afacts())).toEqual({ ok: false, detail: 'no Overlord is bound' });
    expect(m.renewalSetOf({ kind: 'not-designated', row: { ...(OPUS() as Extract<DesignationRead, { kind: 'designated' }>).row, bound: null } }, A, afacts())).toMatchObject({ ok: false, detail: 'no Overlord is bound' });
  });
  it('a binding of another session answers why, naming both', () => {
    expect(m.renewalSetOf(OPUS(), X, afacts())).toEqual({ ok: false, detail: `the bound Overlord is ${A}, not ${X}` });
  });
  it('an unspellable set answers why', () => {
    const r = m.renewalSetOf(OPUS({ accountPools: { pools: ['bad name'], untagged: false } }), A, afacts());
    expect(r).toMatchObject({ ok: false });
    expect((r as { detail: string }).detail).toContain('unspellable');
  });
  it('an empty ordered list answers why, even when the set spells', () => {
    expect(m.renewalSetOf(OPUS({ accountPools: { pools: ['pool-z'], untagged: false } }), A, afacts()))
      .toEqual({ ok: false, detail: 'the ordered account list is empty' });
  });
  it('the designated session gets the poolset spelling, the list in the set\'s order and the row\'s model', () => {
    expect(m.renewalSetOf(OPUS({ accountPools: SET_AB }), A, afacts())).toEqual({ ok: true, poolset: 'pool-a,pool-b', acctorder: 'lane-b,lane-a,lane-c', model: 'opus' });
    expect(m.renewalSetOf(OPUS({ accountPools: SET_A }), A, afacts())).toEqual({ ok: true, poolset: 'pool-a', acctorder: 'lane-a,lane-c', model: 'opus' });
    expect(m.renewalSetOf(read({ accountPools: { pools: ['pool-a', 'pool-b'], untagged: true } }), A, afacts()))
      .toEqual({ ok: true, poolset: 'pool-a,pool-b+untagged', acctorder: 'lane-a,lane-c,lane-b,lane-d', model: 'fable' });
  });
  it('the order follows the row\'s set order, never the roster\'s, and a disabled or API-key lane is not listed', () => {
    const r = m.renewalSetOf(OPUS({ accountPools: { pools: ['pool-b', 'pool-a'], untagged: false } }), A, afacts({ 'lane-a': limit(), 'lane-b': limit(), 'lane-c': limit({ disabled: true }), 'lane-off': limit({ disabled: true }) }));
    expect(r).toMatchObject({ ok: true, acctorder: 'lane-b,lane-a' });
  });
  it('a roster of one anthropic lane in the set still lists it (the count is the start\'s, not the renewal\'s)', () => {
    const one = parseRoster({ version: 1, accounts: [{ id: 'lane-a', label: 'lane-a', configDirSuffix: '.lane-a', exec: { kind: 'upstream' }, homeAble: true,
      hue: 'cyan', telemetry: 'anthropic', continuity: { recordedAt: 1 }, pool: 'pool-a' }] });
    expect(m.renewalSetOf(OPUS({ accountPools: SET_A }), A, afacts(undefined, { roster: one }))).toMatchObject({ ok: true, acctorder: 'lane-a' });
  });
});
