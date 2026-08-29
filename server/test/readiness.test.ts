// The program-ready measurement (program-leverage wave 3, F3).
//
// Two halves, tested apart because they have different clocks and different
// failure modes: the pure folds in `shared/api.ts` (this file's first half)
// and the ports-fed measurement in `server/src/readiness.ts` (its second).
//
// The thing every case below is really protecting is one distinction: a
// precondition we PROVED missing and a precondition we could not measure are
// different answers, and the badge an operator reads is only worth anything if
// the code never folds them together.
import { describe, it, expect } from 'vitest';
import {
  foldSkillStates, readyVerdict, FLOOR_STATES, TOKEN_STATES, COORD_DB_STATES, READY_VERDICTS,
  isFloorState, isTokenState, isCoordDbState, isReadyVerdict,
} from '../../shared/api.js';

const OK = {
  worker: 'present', coordinator: 'present', floor: 'seeded',
  boxToken: 'configured', coordDb: 'available',
} as const;

describe('foldSkillStates — every rostered HOME, folded honestly', () => {
  it('is present only when every home is present', () => {
    expect(foldSkillStates(['present', 'present'])).toBe('present');
  });

  it('a PROVEN absence anywhere dominates — one home without the skill is not installed', () => {
    expect(foldSkillStates(['present', 'absent'])).toBe('absent');
  });

  it('absent OUTRANKS unmeasurable — a proven failure is not downgraded to an unknown', () => {
    expect(foldSkillStates(['unmeasurable', 'absent'])).toBe('absent');
  });

  it('unmeasurable wins over present — one home we could not read is not a clean bill', () => {
    expect(foldSkillStates(['present', 'unmeasurable'])).toBe('unmeasurable');
  });

  it('NO homes at all is unmeasurable, never a vacuous present', () => {
    // A roster with zero homeAble accounts measured nothing. "Every home has
    // it" is vacuously true of an empty set and operationally a lie, so the
    // empty fold answers with the word for "we did not find out".
    expect(foldSkillStates([])).toBe('unmeasurable');
  });
});

describe('readyVerdict — three-valued, because a boolean would collapse blocked with unknown', () => {
  it('all five preconditions ok reads ready', () => {
    expect(readyVerdict(OK)).toBe('ready');
  });

  it('a proven-missing precondition reads blocked', () => {
    expect(readyVerdict({ ...OK, worker: 'absent' })).toBe('blocked');
    expect(readyVerdict({ ...OK, coordinator: 'absent' })).toBe('blocked');
    expect(readyVerdict({ ...OK, floor: 'not-seeded' })).toBe('blocked');
    expect(readyVerdict({ ...OK, boxToken: 'absent' })).toBe('blocked');
    expect(readyVerdict({ ...OK, coordDb: 'not-configured' })).toBe('blocked');
    expect(readyVerdict({ ...OK, coordDb: 'degraded' })).toBe('blocked');
  });

  it('an unmeasurable precondition reads unknown — NOT blocked', () => {
    expect(readyVerdict({ ...OK, worker: 'unmeasurable' })).toBe('unknown');
    expect(readyVerdict({ ...OK, coordinator: 'unmeasurable' })).toBe('unknown');
    expect(readyVerdict({ ...OK, floor: 'unmeasurable' })).toBe('unknown');
    expect(readyVerdict({ ...OK, boxToken: 'unmeasurable' })).toBe('unknown');
  });

  it('blocked OUTRANKS unknown — a proven failure is reportable even when something else is unknown', () => {
    expect(readyVerdict({ ...OK, worker: 'absent', floor: 'unmeasurable' })).toBe('blocked');
  });
});

describe('the derived lists and guards', () => {
  it('each list has exactly its members, derived from its map', () => {
    expect([...FLOOR_STATES]).toEqual(['seeded', 'not-seeded', 'unmeasurable']);
    expect([...TOKEN_STATES]).toEqual(['configured', 'absent', 'unmeasurable']);
    expect([...COORD_DB_STATES]).toEqual(['available', 'degraded', 'not-configured']);
    expect([...READY_VERDICTS]).toEqual(['ready', 'blocked', 'unknown']);
  });

  it('each guard accepts its own members and refuses a neighbour vocabulary word', () => {
    // The neighbours matter: these four unions sit beside `SkillState` and
    // share a shape, so a guard wired to the wrong list would still look
    // right on its own members.
    expect(isFloorState('seeded')).toBe(true);
    expect(isFloorState('present')).toBe(false);
    expect(isTokenState('configured')).toBe(true);
    expect(isTokenState('seeded')).toBe(false);
    expect(isCoordDbState('available')).toBe(true);
    expect(isCoordDbState('configured')).toBe(false);
    expect(isReadyVerdict('ready')).toBe(true);
    expect(isReadyVerdict('available')).toBe(false);
  });
});
