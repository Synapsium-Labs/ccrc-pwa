// The coordinator advisor's pure parts (plan 2026-11-23-coordinator-advisor, PR B-D; D-8967..D-8971): the Settings row's
// narrowing, the eligibility decider, the line parser, the fold, the stale test and the readout's one word. Each rule of
// `advisorFor` has a case that goes red when the rule is removed (mutations measured in the plan's task note).
import { describe, it, expect } from 'vitest';
import {
  advisorFor, advisorStaleOf, advisorStateOf, coordinatorAdvisorOf, foldAdvisorFacts, utcDayOf, advisorApplyPathOf,
  type AdvisorFacts,
} from '../src/continuity/advisorPolicy.js';
import { advisorFactsOf } from '../src/transcript/parse.js';
import { advisorScopeOf, COORDINATOR_ADVISOR_DEFAULT } from '../../shared/coordinatorAdvisor.js';

const COORD = { kind: 'role', role: 'coordinator' } as const;
const base: AdvisorFacts = {
  setting: { choice: 'fable', cap: 12, scope: { kind: 'all' } }, sessionId: 'lane-a-project-a', reading: COORD, anthropic: true,
  routeClass: undefined, mainClass: 'opus', today: 0, droppedToday: false,
};

describe('coordinatorAdvisorOf: the Settings row', () => {
  it('a lost row is the default (off); a failed read is null', () => {
    expect(coordinatorAdvisorOf({ kind: 'absent' })).toEqual(COORDINATOR_ADVISOR_DEFAULT);
    expect(COORDINATOR_ADVISOR_DEFAULT.choice).toBe('off');
    expect(coordinatorAdvisorOf({ kind: 'unreadable', detail: 'x' })).toBeNull();
  });
  it('narrows each word; an unknown word, a bad cap or a bad scope is null', () => {
    expect(coordinatorAdvisorOf({ kind: 'row', choice: 'opus', cap: 5, scope: { kind: 'sessions', ids: ['b-x', 'a-y'] } }))
      .toEqual({ choice: 'opus', cap: 5, scope: { kind: 'sessions', ids: ['a-y', 'b-x'] } });
    for (const r of [{ choice: 'sonnet', cap: 5, scope: { kind: 'all' } }, { choice: 'off', cap: 0, scope: { kind: 'all' } },
      { choice: 'off', cap: 2.5, scope: { kind: 'all' } }, { choice: 'off', cap: 5, scope: null }]) {
      expect(coordinatorAdvisorOf({ kind: 'row', ...r }), JSON.stringify(r)).toBeNull();
    }
  });
  it('a scope names 1..16 distinct registry ids', () => {
    expect(advisorScopeOf({ kind: 'sessions', ids: [] })).toBeNull();
    expect(advisorScopeOf({ kind: 'sessions', ids: ['-x'] })).toBeNull();
    expect(advisorScopeOf({ kind: 'sessions', ids: ['a', 'a'] })).toBeNull();
    expect(advisorScopeOf({ kind: 'sessions', ids: Array.from({ length: 17 }, (_, i) => `s${i}`) })).toBeNull();
  });
});

describe('advisorFor: who is eligible (spec §4)', () => {
  it('an Opus coordinator on an Anthropic lane under the cap gets the chosen model', () => {
    expect(advisorFor(base)).toBe('fable');
    expect(advisorFor({ ...base, setting: { ...base.setting!, choice: 'opus' } })).toBe('opus');
    expect(advisorFor({ ...base, routeClass: 'opus', mainClass: 'unmeasured' })).toBe('fable');
  });
  it('an unreadable setting leaves the field alone; off clears', () => {
    expect(advisorFor({ ...base, setting: null })).toBeNull();
    expect(advisorFor({ ...base, setting: { ...base.setting!, choice: 'off' } })).toBe('clear');
  });
  it('outside the named scope clears', () => {
    expect(advisorFor({ ...base, setting: { ...base.setting!, scope: { kind: 'sessions', ids: ['other'] } } })).toBe('clear');
    expect(advisorFor({ ...base, setting: { ...base.setting!, scope: { kind: 'sessions', ids: [base.sessionId] } } })).toBe('fable');
  });
  it('only a coordinator: the Overlord, a worker, plain and an undecided reading clear', () => {
    for (const reading of [{ kind: 'role', role: 'overlord' }, { kind: 'role', role: 'worker' }, { kind: 'role', role: 'plain' },
      { kind: 'undecided', between: 'coordinator-or-plain' }] as const) {
      expect(advisorFor({ ...base, reading }), JSON.stringify(reading)).toBe('clear');
    }
  });
  it('only an Anthropic lane; unmeasured leaves it alone', () => {
    expect(advisorFor({ ...base, anthropic: false })).toBe('clear');
    expect(advisorFor({ ...base, anthropic: 'unmeasured' })).toBeNull();
  });
  it('only an Opus main model: a routed non-Opus class clears, an unmeasured model leaves it alone', () => {
    expect(advisorFor({ ...base, routeClass: 'sonnet' })).toBe('clear');
    expect(advisorFor({ ...base, routeClass: 'fable' })).toBe('clear');
    expect(advisorFor({ ...base, mainClass: 'sonnet' })).toBe('clear');
    expect(advisorFor({ ...base, mainClass: null })).toBe('clear');
    expect(advisorFor({ ...base, mainClass: 'unmeasured' })).toBeNull();
    expect(advisorFor({ ...base, routeClass: 'default', mainClass: 'opus' })).toBe('fable');
  });
  it('a measured reason to remove wins over an unmeasured lane or main model (review F3)', () => {
    for (const unmeasured of [{ anthropic: 'unmeasured' }, { mainClass: 'unmeasured' }, { anthropic: 'unmeasured', mainClass: 'unmeasured' }] as const) {
      expect(advisorFor({ ...base, ...unmeasured, today: 12 }), JSON.stringify(unmeasured)).toBe('clear');
      expect(advisorFor({ ...base, ...unmeasured, droppedToday: true }), JSON.stringify(unmeasured)).toBe('clear');
    }
    expect(advisorFor({ ...base, today: 'unmeasured', anthropic: false })).toBe('clear');
  });
  it('only Opus 5 and later pair: a measured older Opus id clears, a newer one or another id is left to the class rule (review R2-6)', () => {
    expect(advisorFor({ ...base, mainModel: 'claude-opus-4-7' })).toBe('clear');
    expect(advisorFor({ ...base, routeClass: 'opus', mainModel: 'claude-opus-4-7' })).toBe('clear');
    expect(advisorFor({ ...base, mainModel: 'claude-opus-5-5' })).toBe('fable');
    expect(advisorFor({ ...base, mainModel: 'claude-opus-5' })).toBe('fable');
    expect(advisorFor({ ...base, mainModel: 'unmeasured' })).toBe('fable');
  });
  it('the cap and a drop today clear; either unmeasured leaves it alone (D-8970)', () => {
    expect(advisorFor({ ...base, today: 11 })).toBe('fable');
    expect(advisorFor({ ...base, today: 12 })).toBe('clear');
    expect(advisorFor({ ...base, droppedToday: true })).toBe('clear');
    expect(advisorFor({ ...base, today: 'unmeasured' })).toBeNull();
    expect(advisorFor({ ...base, droppedToday: 'unmeasured' })).toBeNull();
  });
});

// The line shapes found in the installed build's strings (D-8969): a call and its usage in one assistant message.
const T = '2026-11-24T10:00:00.000Z';
const TMS = Date.parse(T);
const assistant = (id: string, content: unknown[], iterations?: unknown[], extra: Record<string, unknown> = {}): string => JSON.stringify({
  type: 'assistant', isSidechain: false, timestamp: T, ...extra,
  message: { id, model: 'claude-opus-5-5', content, usage: { input_tokens: 10, ...(iterations ? { iterations } : {}) } },
});
const CALL = { type: 'server_tool_use', id: 'srvtoolu_1', name: 'advisor', input: {} };
const RESULT = { type: 'advisor_tool_result', tool_use_id: 'srvtoolu_1', content: { type: 'advisor_result', text: 'x', stop_reason: 'end_turn' } };
const ITS = [{ type: 'message', input_tokens: 5 },
  { type: 'advisor_message', model: 'claude-fable-5', input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }];

describe('advisorFactsOf: one transcript line (D-8969)', () => {
  it('an assistant message carrying a call and its usage', () => {
    expect(advisorFactsOf(assistant('msg_1', [CALL, RESULT], ITS))).toEqual({
      kind: 'request', messageId: 'msg_1', at: TMS, calls: ['srvtoolu_1'], model: 'claude-fable-5',
      usage: { input: 1000, output: 200, cacheRead: 0, cacheWrite: 0 },
    });
  });
  it('a plain assistant message is one request with no call; a sidechain line is none', () => {
    expect(advisorFactsOf(assistant('msg_2', [{ type: 'text', text: 'hi' }]))).toMatchObject({ kind: 'request', calls: [], usage: null });
    expect(advisorFactsOf(assistant('msg_3', [CALL], ITS, { isSidechain: true }))).toEqual({ kind: 'none' });
  });
  it('a server_tool_use of another tool is not a call', () => {
    expect(advisorFactsOf(assistant('msg_4', [{ ...CALL, name: 'web_search' }]))).toMatchObject({ calls: [] });
  });
  it('the advisor_tool attachment', () => {
    const l = JSON.stringify({ type: 'attachment', timestamp: T, attachment: { type: 'advisor_tool', available: false, model: 'fable', toolChange: 'remove' } });
    expect(advisorFactsOf(l)).toEqual({ kind: 'availability', available: false, model: 'fable', at: TMS });
  });
  it('a line that is not JSON is unreadable, never dropped; an empty line and a user line are none', () => {
    expect(advisorFactsOf('{"type":"assistant",')).toEqual({ kind: 'unreadable' });
    expect(advisorFactsOf('')).toEqual({ kind: 'none' });
    expect(advisorFactsOf(JSON.stringify({ type: 'user', message: { content: 'x' } }))).toEqual({ kind: 'none' });
  });
});

describe('foldAdvisorFacts: the reader state and the calls', () => {
  const spawnAt = Math.floor(TMS / 1000) - 60;
  it('streamed lines of one message are one request and one call; usage fills the call', () => {
    const lines = [assistant('msg_1', [CALL]), assistant('msg_1', [CALL, RESULT], ITS), assistant('msg_2', [{ type: 'text', text: 'k' }])];
    const r = foldAdvisorFacts(null, '/t.jsonl', spawnAt, true, lines.map(advisorFactsOf), 300, 0);
    expect(r.state).toMatchObject({ file: '/t.jsonl', offset: 300, spawnAt, requests: 2, lastMessageId: 'msg_2', lastCallAt: TMS, unreadable: 0 });
    expect(r.calls).toEqual([{ callId: 'srvtoolu_1', day: '2026-11-24', at: TMS, model: 'claude-fable-5',
      tokens: { input: 1000, output: 200, cacheRead: 0, cacheWrite: 0 } }]);
  });
  it('a new spawn restarts the per-spawn counts; a line older than the spawn counts the call but not the request', () => {
    const prev = foldAdvisorFacts(null, '/t.jsonl', spawnAt, true, [advisorFactsOf(assistant('msg_1', []))], 10, 0).state;
    const later = foldAdvisorFacts(prev, '/t.jsonl', spawnAt + 3600, true, [advisorFactsOf(assistant('msg_9', [CALL], ITS))], 20, 1);
    expect(later.state).toMatchObject({ requests: 0, lastCallAt: null, unreadable: 1 });
    expect(later.calls).toHaveLength(1);
  });
  it('an available:false attachment since the spawn is recorded', () => {
    const l = JSON.stringify({ type: 'attachment', timestamp: T, attachment: { type: 'advisor_tool', available: false } });
    const r = foldAdvisorFacts(null, '/t', spawnAt, true, [advisorFactsOf(l)], 1, 0).state;
    expect(r.available).toBe('false');
    expect(r.droppedDay).toBe('2026-11-24');
  });
  it('the drop day outlives a new spawn and a new file; a spawn that did not apply the flag records none (review F4)', () => {
    const l = JSON.stringify({ type: 'attachment', timestamp: T, attachment: { type: 'advisor_tool', available: false } });
    const dropped = foldAdvisorFacts(null, '/t', spawnAt, true, [advisorFactsOf(l)], 1, 0).state;
    const next = foldAdvisorFacts(dropped, '/u', spawnAt + 60, false, [], 0, 0).state;
    expect(next).toMatchObject({ available: null, droppedDay: '2026-11-24' });
    expect(foldAdvisorFacts(null, '/t', spawnAt, false, [advisorFactsOf(l)], 1, 0).state.droppedDay).toBeNull();
  });
  it('a later line of the same message with no call of its own fills that message\'s call with its usage (review F8)', () => {
    const early = [{ type: 'advisor_message', model: 'claude-fable-5', input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }];
    const lines = [assistant('msg_1', [CALL], early), assistant('msg_1', [{ type: 'text', text: 'k' }], ITS)];
    const r = foldAdvisorFacts(null, '/t.jsonl', spawnAt, true, lines.map(advisorFactsOf), 9, 0);
    expect(r.calls).toEqual([expect.objectContaining({ callId: 'srvtoolu_1', tokens: { input: 1000, output: 200, cacheRead: 0, cacheWrite: 0 } })]);
  });
});

const DAY = '2026-11-24';
describe('advisorStaleOf: the roll reason advisor-stale (D-8970)', () => {
  it('the route and the spawn disagree, measured', () => {
    expect(advisorStaleOf('fable', false, null, DAY)).toBe(true);
    expect(advisorStaleOf(undefined, false, { kind: 'applied', model: 'fable', at: 1 }, DAY)).toBe(true);
    expect(advisorStaleOf('fable', false, { kind: 'applied', model: 'fable', at: 1 }, DAY)).toBe(false);
    expect(advisorStaleOf(undefined, false, null, DAY)).toBe(false);
    expect(advisorStaleOf(undefined, false, { kind: 'off', at: 1, fastDeath: false }, DAY)).toBe(false);
  });
  it('unmeasured is never stale, and a fast death is settled', () => {
    expect(advisorStaleOf('fable', true, null, DAY)).toBe(false);
    expect(advisorStaleOf('fable', false, 'unreadable', DAY)).toBe(false);
    const today = Math.floor(TMS / 1000);
    expect(advisorStaleOf('fable', false, { kind: 'off', at: today, fastDeath: true }, DAY)).toBe(false);
  });
  it('a fast death of an earlier day is stale like any off, so the advisor asked for again is restored (review F5)', () => {
    expect(advisorStaleOf('fable', false, { kind: 'off', at: Math.floor(TMS / 1000) - 86_400, fastDeath: true }, DAY)).toBe(true);
  });
});

describe('advisorStateOf: the readout (spec §6)', () => {
  const day = utcDayOf(TMS);
  const at = Math.floor(TMS / 1000) - 600;
  const applied = { kind: 'applied', model: 'fable', at } as const;
  const read = (o: object) => ({ file: '/t', offset: 0, spawnAt: at, requests: 0, lastMessageId: null, available: null, availableAt: null,
    lastCallAt: null, unreadable: 0, droppedDay: null, ...o });
  it.each([
    ['off', { routeWord: undefined, spawn: null, read: null, today: 0 }],
    ['queued', { routeWord: 'fable', spawn: null, read: null, today: 0 }],
    ['requested', { routeWord: 'fable', spawn: applied, read: read({}), today: 0 }],
    ['live', { routeWord: 'fable', spawn: applied, read: read({ available: 'true' }), today: 0 }],
    ['live', { routeWord: 'fable', spawn: applied, read: read({ lastCallAt: TMS }), today: 1 }],
    ['unseen', { routeWord: 'fable', spawn: applied, read: read({ requests: 20 }), today: 0 }],
    ['dropped', { routeWord: 'fable', spawn: applied, read: read({ available: 'false' }), today: 0 }],
    ['dropped', { routeWord: 'fable', spawn: { kind: 'off', at, fastDeath: true }, read: null, today: 0 }],
    ['capped', { routeWord: undefined, spawn: applied, read: read({ available: 'true' }), today: 12 }],
    ['unmeasured', { routeWord: undefined, spawn: 'unreadable', read: null, today: 12 }],
    ['dropped', { routeWord: undefined, spawn: { kind: 'off', at, fastDeath: false }, read: read({ spawnAt: at - 60, droppedDay: '2026-11-24' }), today: 0 }],
    ['requested', { routeWord: 'fable', spawn: applied, read: read({ spawnAt: at - 1, available: 'true' }), today: 0 }],
  ] as const)('%s', (want, i) => {
    expect(advisorStateOf({ ...i, cap: 12, day })).toBe(want);
  });
  it('the apply path: renewal while continuity is live, the roll while it takes coordinators, else the next start', () => {
    expect([advisorApplyPathOf(true, true), advisorApplyPathOf(false, true), advisorApplyPathOf(false, false)]).toEqual(['renewal', 'roll', 'next-spawn']);
  });
});
