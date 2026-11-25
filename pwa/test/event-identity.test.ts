// Each row once (desktop polish wave 175, `session/eventIdentity.ts`): the identity the session store merges every frame
// by, a live `events` frame and an older page alike. The four cases the brief names, each pinned before the merge relies
// on it: the same event from two frames appears once; two different events with equal text both appear; two blocks of
// one parsed record both appear; separate records that share a source id both appear. Plus the one limit the parser leaves.
import { describe, expect, it } from 'vitest';
import type { ChatEvent } from '../../shared/api';
import { eventIdentity, freshOf } from '../src/session/eventIdentity';
import { applySessionMsg, type SessionSnapshot } from '../src/stores/session';
import { buildChatItems } from '../src/session/chatItems';
import { uniqueKeys } from '../src/session/rowKeys';

const TS = '2026-11-24T10:00:00.000Z';
const TS2 = '2026-11-24T10:00:05.000Z';
const user = (uuid: string, text: string, ts = TS): ChatEvent => ({ kind: 'user', uuid, ts, text });
const assistant = (uuid: string, text: string, ts = TS): ChatEvent => ({ kind: 'assistant', uuid, ts, text });
const use = (uuid: string, toolId: string, ts = TS): ChatEvent =>
  ({ kind: 'tool_use', uuid, ts, toolId, name: 'Bash', input: '{"command":"ls"}' });
const result = (toolId: string, text: string, ts = TS): ChatEvent => ({ kind: 'tool_result', ts, toolId, text, isError: false });

/** A copy of an event, as a second frame carries it: equal fields, another object. */
const copy = (e: ChatEvent): ChatEvent => JSON.parse(JSON.stringify(e)) as ChatEvent;

const snap = (events: ChatEvent[]): SessionSnapshot => ({
  events, offset: 0, uuid: 'u', status: null, statusUpdatedAt: null, dialog: null, ask: null, tasks: [], mail: [],
  missingFile: null, strandedAccount: null, searchComplete: true, fileMeasured: true, file: '/t/a.jsonl',
});
const live = (s: SessionSnapshot, events: ChatEvent[]): SessionSnapshot =>
  applySessionMsg(s, { type: 'events', uuid: 'u', events, offset: 1 });

describe('the identity', () => {
  it('is equal for the same event read twice (another object, the same fields)', () => {
    const e = assistant('a1', 'hello');
    expect(eventIdentity(copy(e))).toBe(eventIdentity(e));
  });

  it('differs for every field the parser gives: kind, source id, time and what it shows', () => {
    const base = user('u1', 'hi');
    const others: ChatEvent[] = [
      assistant('u1', 'hi'), user('u2', 'hi'), user('u1', 'hi', TS2), user('u1', 'hi!'),
      { kind: 'user', uuid: 'u1', ts: TS, text: 'hi', compaction: true },
      { kind: 'system', uuid: 'u1', ts: TS, text: 'hi' }, { kind: 'system', uuid: 'u1', ts: TS, text: 'hi', origin: 'limit' },
    ];
    for (const o of others) expect(eventIdentity(o)).not.toBe(eventIdentity(base));
    expect(eventIdentity(result('t1', 'ok'))).not.toBe(eventIdentity({ ...result('t1', 'ok'), isError: true } as ChatEvent));
    expect(eventIdentity(result('t1', 'ok'))).not.toBe(eventIdentity(result('t2', 'ok')));
    expect(eventIdentity(use('u1', 't1'))).not.toBe(eventIdentity({ ...use('u1', 't1'), input: '{}' } as ChatEvent));
  });
});

describe('the four cases, in the store\'s merge', () => {
  it('the same event from the live stream and from a page: once', () => {
    const held = [user('u1', 'one'), assistant('a1', 'two')];
    expect(freshOf(held, [copy(held[1]!), assistant('a2', 'three')])).toEqual([assistant('a2', 'three')]);
    const s = live(snap(held), [copy(held[0]!), copy(held[1]!)]);
    expect(s.events).toHaveLength(2);
  });

  it('two different events with equal text: both', () => {
    const s = live(snap([user('u1', 'yes')]), [user('u2', 'yes')]);
    expect(s.events.map((e) => (e.kind === 'user' ? e.uuid : '?'))).toEqual(['u1', 'u2']);
  });

  it('two blocks of one parsed record (one uuid): both, also when their words are equal', () => {
    // An assistant record with prose and a call parses to two events with the record's uuid. Main's merge keyed on the
    // uuid and dropped the call when both came in one frame.
    const s = live(snap([]), [assistant('r1', 'Running it.'), use('r1', 't1')]);
    expect(s.events.map((e) => e.kind)).toEqual(['assistant', 'tool_use']);
    // A user record with two equal text blocks: two rows, counted, not collapsed.
    const twice = live(snap([]), [user('r2', 'same'), user('r2', 'same')]);
    expect(twice.events).toHaveLength(2);
    // And read again (a later frame carrying the same record): still two.
    expect(live(twice, [copy(twice.events[0]!), copy(twice.events[1]!)]).events).toHaveLength(2);
  });

  it('separate records that share a source id: both', () => {
    // Two records with the same uuid, written apart.
    const s = live(snap([user('dup', 'first')]), [user('dup', 'second', TS2)]);
    expect(s.events).toHaveLength(2);
    // Two results for one call id (or two with the empty id a missing one parses to).
    const r = live(snap([result('', 'a')]), [result('', 'b', TS2)]);
    expect(r.events).toHaveLength(2);
    const t = live(snap([result('t1', 'ok')]), [result('t1', 'ok again', TS2)]);
    expect(t.events).toHaveLength(2);
  });

  it('the one limit: two separate records equal in every field are one identity across frames, two within one', () => {
    expect(live(snap([]), [user('x', 'same'), user('x', 'same')]).events).toHaveLength(2);
    expect(live(snap([user('x', 'same')]), [user('x', 'same')]).events).toHaveLength(1);
  });

  it('a local row (a notice, a rotation divider, a gap marker) is never taken for a copy', () => {
    const local: ChatEvent = { kind: 'system', uuid: 'local-9', ts: TS, text: 'notice' };
    expect(freshOf([local], [{ ...local }])).toHaveLength(1);
  });
});

describe('each row\'s key once (`rowKeys.ts`)', () => {
  it('two message rows of one record get two keys, the newest keeping the plain one', () => {
    const items = buildChatItems([user('r1', 'first block'), user('r1', 'second block')], [], false);
    const keys = items.filter((i) => i.kind === 'message').map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.at(-1)).toBe('r1');
  });

  it('rows put before the first never rename a row already shown', () => {
    const shown = uniqueKeys([{ key: 'a' }, { key: 'b' }]);
    const after = uniqueKeys([{ key: 'b' }, { key: 'x' }, ...shown]);
    expect(after.slice(-2).map((i) => i.key)).toEqual(['a', 'b']);
    expect(after[0]!.key).toBe('b~1');
  });
});
