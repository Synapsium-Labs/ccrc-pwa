// Overlord W1 home B, Task 7 (question 4, slug place-visible-rides-the-session-socket): the decider that rules on each
// `visible` frame of the session socket, `placeMarkDue`. It answers `write` only for a visible frame of the session the
// designation binds, when the `@overlord-place` mark is absent or at least `PLACE_MARK_EVERY_MS` old; every other case is `skip`.
// An unread designation and an unread mark are `skip`: the mark then ages, so a renewal may treat the place as hidden, which
// is the safe direction (the hard rows still bound the context). The expected words are written out, never read from the code.
import { describe, expect, it } from 'vitest';
import { placeMarkDue, type PlaceMarkFacts } from '../src/continuity/placeMark.js';
import { BREAK_PLACE_HIDDEN_MS, OVERLORD_PLACE_MARK, PLACE_MARK_EVERY_MS } from '../../shared/continuity.js';

const NOW = 1_800_000_000_000;
const facts = (over: Partial<PlaceMarkFacts> = {}): PlaceMarkFacts => ({
  frameSessionId: 'lane-a-overlord', visible: true, bound: { kind: 'bound', sessionId: 'lane-a-overlord' },
  markAtMs: 'absent', nowMs: NOW, ...over,
});

describe('PLACE_MARK_EVERY_MS', () => {
  it('is a minute, below the five minutes of BREAK_PLACE_HIDDEN_MS, so a visible place never reads hidden', () => {
    expect(PLACE_MARK_EVERY_MS).toBe(60_000);
    expect(PLACE_MARK_EVERY_MS).toBeLessThan(300_000);
    expect(PLACE_MARK_EVERY_MS).toBeLessThan(BREAK_PLACE_HIDDEN_MS);
  });
  it('the key is @overlord-place', () => { expect(OVERLORD_PLACE_MARK).toBe('@overlord-place'); });
});

describe('placeMarkDue', () => {
  it('a visible frame of the bound session and no mark yet: write', () => {
    expect(placeMarkDue(facts())).toBe('write');
  });
  it('a hidden frame: skip, whatever the mark', () => {
    expect(placeMarkDue(facts({ visible: false }))).toBe('skip');
    expect(placeMarkDue(facts({ visible: false, markAtMs: NOW - 10 * 60_000 }))).toBe('skip');
  });
  it('a frame of another session: skip', () => {
    expect(placeMarkDue(facts({ frameSessionId: 'lane-b-project-a' }))).toBe('skip');
  });
  it('no session designated: skip', () => {
    expect(placeMarkDue(facts({ bound: { kind: 'not-designated' } }))).toBe('skip');
  });
  it('a designation that could not be read: skip, even with the mark absent', () => {
    expect(placeMarkDue(facts({ bound: { kind: 'unread' } }))).toBe('skip');
    expect(placeMarkDue(facts({ bound: { kind: 'unread' }, markAtMs: NOW - 10 * 60_000 }))).toBe('skip');
  });
  it('a mark that could not be read: skip', () => {
    expect(placeMarkDue(facts({ markAtMs: 'unread' }))).toBe('skip');
  });
  it('a mark younger than 60 s: skip; at 60 s and older: write', () => {
    expect(placeMarkDue(facts({ markAtMs: NOW }))).toBe('skip');
    expect(placeMarkDue(facts({ markAtMs: NOW - 59_999 }))).toBe('skip');
    expect(placeMarkDue(facts({ markAtMs: NOW - 60_000 }))).toBe('write');
    expect(placeMarkDue(facts({ markAtMs: NOW - 5 * 60_000 }))).toBe('write');
  });
  it('a mark from the future (the wall clock stepped back): write, so it is never held stale until the clock catches up', () => {
    expect(placeMarkDue(facts({ markAtMs: NOW + 1 }))).toBe('write');
    expect(placeMarkDue(facts({ markAtMs: NOW + 3_600_000 }))).toBe('write');
  });
});
