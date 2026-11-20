// Overlord W1 door process B1 (plan `w1-door-process.md` Task 7): `hookReportOf`, the report door's one narrowing, and
// `hookReportStore`'s reads. Each kind's good body is accepted; an unknown kind, a bad key, tool, agent id, an over-long
// string, a bad `how` or a non-integer id is refused naming its field. The reads answer an unmeasured arm, never `[]`.
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import * as hookReports from '../src/continuity/hookReports.js';
import { hookReportCases } from './sim/hookReportSets.js';
import { hookReportOf } from '../src/continuity/hookReports.js';
import { insertHookReport, modelSwitchesSince, readerEventsSince, witnessesFor } from '../src/continuity/hookReportStore.js';
import { AGENT_TYPE_MAX, REPORT_MODEL_MAX, type HookReport } from '../../shared/continuity-reports.js';

const KEY = 'ab'.repeat(32);
const good: Record<string, Record<string, unknown>> = {
  witness: { kind: 'witness', key: KEY, tool: 'mcp__door__card', agentId: 'agent-1', at: 5 },
  'reader-start': { kind: 'reader-start', agentId: 'agent-1', agentType: 'reader', at: 5 },
  'reader-stop': { kind: 'reader-stop', agentId: 'agent-1', at: 5 },
  'readers-clear': { kind: 'readers-clear', at: 5 },
  'model-switch': { kind: 'model-switch', how: 'switched', from: 'model-a', to: 'model-b', at: 5 },
  'picked-up': { kind: 'picked-up', messageId: 12, at: 5 },
};
const field = (b: Record<string, unknown>): string | null => {
  const v = hookReportOf(b);
  return v.ok ? null : v.field;
};

describe('hookReportOf: the shared oracle (the mutation floor runs the same cases)', () => {
  for (const [name, fn] of Object.entries(hookReportCases(hookReports))) it(name, fn);
});

describe('hookReportOf', () => {
  it('accepts each kind\'s good body, absent optional fields read as null', () => {
    for (const [k, b] of Object.entries(good)) expect(hookReportOf(b), k).toEqual({ ok: true, report: b });
    expect(hookReportOf({ kind: 'witness', key: KEY, tool: 'mcp__door__card', at: 0 })).toEqual({ ok: true, report: { kind: 'witness', key: KEY, tool: 'mcp__door__card', agentId: null, at: 0 } });
    expect(hookReportOf({ kind: 'reader-start', agentId: 'a', at: 0 })).toEqual({ ok: true, report: { kind: 'reader-start', agentId: 'a', agentType: null, at: 0 } });
    expect(hookReportOf({ kind: 'model-switch', how: 'typed-refused', at: 0 })).toEqual({ ok: true, report: { kind: 'model-switch', how: 'typed-refused', from: null, to: null, at: 0 } });
  });
  it('an unknown or missing kind is refused naming kind', () => {
    for (const kind of ['nope', 7, null, undefined, '__proto__']) expect(field({ ...good['readers-clear'], kind }), String(kind)).toBe('kind');
  });
  it('a witness key that is not 64 lowercase hex, a bad tool and a bad agent id are refused', () => {
    for (const key of ['AB'.repeat(32), 'a'.repeat(63), 'a'.repeat(65), 5, null, `${KEY}\n`]) expect(field({ ...good['witness'], key }), String(key)).toBe('key');
    for (const tool of ['card', 'mcp__door__', 'mcp__door__Card', 'mcp__door__1a', `mcp__door__${'a'.repeat(65)}`, 'mcp__other__card', 7, 'mcp__door__a-b']) {
      expect(field({ ...good['witness'], tool }), String(tool)).toBe('tool');
    }
    for (const agentId of ['a b', '', 'a'.repeat(65), 'a/b', 7]) expect(field({ ...good['witness'], agentId }), String(agentId)).toBe('agentId');
    expect(field({ ...good['reader-start'], agentId: 'a.b' })).toBe('agentId');
    expect(field({ ...good['reader-stop'], agentId: undefined })).toBe('agentId');
  });
  it('an over-long agent type or model, and a bad how, are refused', () => {
    expect(field({ ...good['reader-start'], agentType: 'a'.repeat(AGENT_TYPE_MAX + 1) })).toBe('agentType');
    expect(field({ ...good['reader-start'], agentType: 'a'.repeat(AGENT_TYPE_MAX) })).toBeNull();
    expect(field({ ...good['model-switch'], from: 'a'.repeat(REPORT_MODEL_MAX + 1) })).toBe('from');
    expect(field({ ...good['model-switch'], to: 'a'.repeat(REPORT_MODEL_MAX + 1) })).toBe('to');
    expect(field({ ...good['model-switch'], to: 5 })).toBe('to');
    for (const how of ['other', 7, null, undefined]) expect(field({ ...good['model-switch'], how }), String(how)).toBe('how');
  });
  it('a non-integer, non-positive or unsafe messageId is refused', () => {
    for (const messageId of [1.5, 0, -1, '12', null, Number.MAX_SAFE_INTEGER + 2, NaN]) expect(field({ ...good['picked-up'], messageId }), String(messageId)).toBe('messageId');
  });
  it('an `at` that is not a non-negative safe integer is refused, for every kind', () => {
    for (const b of Object.values(good)) for (const at of [-1, 1.5, '5', null, undefined, Number.MAX_SAFE_INTEGER + 2]) expect(field({ ...b, at }), `${String(b['kind'])} ${String(at)}`).toBe('at');
  });
});

const mem = (): DatabaseSync => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE continuity_hook_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, sessionId TEXT NOT NULL, kind TEXT NOT NULL, key TEXT, agentId TEXT, detail TEXT, at INTEGER NOT NULL, receivedAt INTEGER NOT NULL);`);
  return db;
};
const rep = (b: Record<string, unknown>): HookReport => {
  const v = hookReportOf(b);
  if (!v.ok) throw new Error(v.field);
  return v.report;
};

describe('hookReportStore reads', () => {
  it('a missing table answers unmeasured with a detail, on every read', () => {
    const db = new DatabaseSync(':memory:');
    for (const r of [witnessesFor(db, 's', KEY), readerEventsSince(db, 's', 0), modelSwitchesSince(db, 's', 0)]) {
      expect(r.ok).toBe(false);
      expect(r.ok ? '' : r.detail).toContain('continuity_hook_reports');
    }
    expect(insertHookReport(db, 's', rep(good['readers-clear']!), 1).ok).toBe(false);
  });
  it('a stored value that does not narrow answers unmeasured, never an empty list', () => {
    const db = mem();
    db.prepare("INSERT INTO continuity_hook_reports (sessionId, kind, key, detail, at, receivedAt) VALUES ('s','model-switch',NULL,'{not json',1,2)").run();
    const r = modelSwitchesSince(db, 's', 0);
    expect(r.ok).toBe(false);
    db.prepare("INSERT INTO continuity_hook_reports (sessionId, kind, at, receivedAt) VALUES ('s','mystery',1,2)").run();
    expect(readerEventsSince(db, 's', 0).ok).toBe(false);
  });
  it('witnesses, reader events and model switches round-trip, newest first, scoped by session and key', () => {
    const db = mem();
    const w = (at: number, agentId: string | null): void => { insertHookReport(db, 's', rep({ ...good['witness'], agentId, at }), 1_000 + at); };
    w(1, null); w(2, 'agent-1');
    insertHookReport(db, 'other', rep(good['witness']!), 1_100);
    insertHookReport(db, 's', rep({ ...good['witness'], key: 'cd'.repeat(32) }), 1_100);
    const ws = witnessesFor(db, 's', KEY);
    expect(ws.ok && ws.value.map((x) => [x.agentId, x.at, x.receivedAt])).toEqual([['agent-1', 2, 1_002], [null, 1, 1_001]]);
    insertHookReport(db, 's', rep(good['reader-start']!), 2_000);
    insertHookReport(db, 's', rep(good['reader-stop']!), 2_001);
    insertHookReport(db, 's', rep(good['readers-clear']!), 2_002);
    insertHookReport(db, 's', rep(good['model-switch']!), 2_003);
    const ev = readerEventsSince(db, 's', 2_001);
    expect(ev.ok && ev.value.map((x) => x.kind)).toEqual(['reader-stop', 'readers-clear']);
    const ms = modelSwitchesSince(db, 's', 0);
    expect(ms.ok && ms.value.map((x) => [x.how, x.from, x.to])).toEqual([['switched', 'model-a', 'model-b']]);
  });
});
