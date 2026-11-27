// Overlord W1, the private store (plan w1-private-store.md, Task 2): the Operator Model's vocabulary (`shared/operatorMessages.ts`)
// and its deciders (`server/src/operatorModel/messages.ts`). The deciders' cases live in `sim/operatorModelSets.ts`, so the
// mutation floors run the very cases asserted here.
import { describe, expect, it } from 'vitest';
import * as deciders from '../src/operatorModel/messages.js';
import {
  MESSAGE_ACTORS, MESSAGE_EVENT_ACTORS, MESSAGE_EVENTS, MESSAGE_MOVES, MESSAGE_STATES, READ_CALLERS, READ_DOORS, READ_TURN_STATES,
  SETTLED_BY, isMessageState, isOperatorMessageMail, operatorMessageIdOf, operatorMessageSubject,
} from '../../shared/operatorMessages.js';
import { TURN_MARK_STATES, type TurnMarkUnread } from '../src/coord/stall.js';
import { EVENT_ACTORS, TABLE_1, capTextCases, deliveryStageCases, messageMoveCases, nextIdCases } from './sim/operatorModelSets.js';

const run = (cases: Record<string, () => unknown>): void => {
  for (const [name, fn] of Object.entries(cases)) it(name, fn as () => void);
};

describe('the message moves (Table 1): messageMove', () => run(messageMoveCases(deciders)));
describe('deliveryStageOf', () => run(deliveryStageCases(deciders)));
describe('capMessageText (slug message-text-cap)', () => run(capTextCases(deciders)));
describe('nextMessageId (H27: never an id twice)', () => run(nextIdCases(deciders)));

describe('the vocabulary', () => {
  it('each list is its map\'s keys, in order', () => {
    expect(MESSAGE_STATES).toEqual(['recorded', 'queued', 'delivered', 'picked-up', 'settled', 'spent']);
    expect(MESSAGE_EVENTS).toEqual(['queue', 'deliver', 'pick-up', 'settle', 'spend', 'unsettle']);
    expect(MESSAGE_ACTORS).toEqual(['route', 'mail-lane', 'hook', 'acknowledge', 'citing-door', 'boot-pass']);
    expect(SETTLED_BY).toEqual(['cite', 'acknowledge', 'mark']);
    expect(READ_DOORS).toEqual(['board', 'messages', 'inbox', 'history', 'sequence', 'chat', 'chat-history']);
    expect(READ_CALLERS).toEqual(['overlord', 'reader', 'operator']);
  });

  it('the moves table and the actor list are the plan\'s, written out', () => {
    const asWritten = Object.fromEntries(Object.entries(MESSAGE_MOVES).map(([s, row]) =>
      [s, Object.fromEntries(Object.entries(row).map(([e, t]) => [e, t === 'delivery-stage' ? 'stage' : t]))]));
    expect(asWritten).toEqual(TABLE_1);
    expect(MESSAGE_EVENT_ACTORS).toEqual(EVENT_ACTORS);
  });

  it('a word guard refuses an inherited name', () => {
    expect(isMessageState('settled')).toBe(true);
    for (const w of ['toString', 'constructor', 'hasOwnProperty', '', 'Settled', 'unknown']) expect(isMessageState(w)).toBe(false);
  });

  it('READ_TURN_STATES mirrors the turn marker reader\'s words, both ways', () => {
    // `TurnMarkUnread` is a type only: the compiler makes this record exhaustive, so a new unread word reds the build.
    const UNREAD: Record<TurnMarkUnread, true> = { absent: true, unmeasured: true, malformed: true, foreign: true, stale: true };
    const reader = [...TURN_MARK_STATES, ...Object.keys(UNREAD)];
    expect([...READ_TURN_STATES].sort()).toEqual([...reader].sort());
    expect(READ_TURN_STATES.length).toBe(reader.length);
  });
});

describe('the nudge\'s subject (slug message-nudge-rides-the-mail-lane)', () => {
  it('round-trips a positive safe integer', () => {
    for (const id of [1, 7, 12_345, Number.MAX_SAFE_INTEGER]) {
      expect(operatorMessageSubject(id)).toBe(`operator-message:${id}`);
      expect(operatorMessageIdOf(operatorMessageSubject(id))).toBe(id);
    }
  });

  it('refuses every other spelling', () => {
    for (const s of ['operator-message:', 'operator-message:0x1', 'operator-message:-1', 'operator-message:07', 'operator-message:0',
      'operator-message:1.5', 'operator-message: 1', 'operator-message:1 ', 'operator-message:9007199254740992',
      'Operator-message:1', 'operator-messages:1', 'stall:1', '']) {
      expect(operatorMessageIdOf(s), s).toBeNull();
    }
  });

  it('isOperatorMessageMail: only from operator, only with a well-formed subject', () => {
    expect(isOperatorMessageMail({ fromId: 'operator', subject: 'operator-message:3' })).toBe(true);
    for (const fromId of ['coordinator', 'lane-a-project-a', 'operator ', 'Operator', 'system']) {
      expect(isOperatorMessageMail({ fromId, subject: 'operator-message:3' }), fromId).toBe(false);
    }
    expect(isOperatorMessageMail({ fromId: 'operator', subject: 'operator-message:03' })).toBe(false);
    expect(isOperatorMessageMail({ fromId: 'operator', subject: 'digest-correction' })).toBe(false);
  });
});
