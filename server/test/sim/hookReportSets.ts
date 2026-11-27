// `hookReportOf`'s oracle and mutant set (Overlord W1 door process B1, plan `w1-door-process.md` Task 7 Step 4; its Global
// Constraints' "Mutation floors"). The cases are written ONCE here, as suite cases over a module: `continuity-hook-reports.test.ts`
// runs them against the real module, and `mutation-floors.test.ts` against each textual mutant. The mutants: each kind's
// check dropped (one per field), the length bounds loosened, the unknown-kind refusal removed.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { MutantSet, SuiteCase } from './mutate.js';
import { AGENT_TYPE_MAX, DOOR_TOOL_PREFIX, REPORT_MODEL_MAX } from '../../../shared/continuity-reports.js';
import { REPLY_REPORT_MAX_BYTES } from '../../../shared/operatorMessages.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export type HookReportsModule = typeof import('../../src/continuity/hookReports.js');

const KEY = 'ab'.repeat(32);
const W = { kind: 'witness', key: KEY, tool: 'mcp__door__card', agentId: 'agent-1', at: 5 };
const RS = { kind: 'reader-start', agentId: 'agent-1', agentType: 'reader', at: 5 };
const RP = { kind: 'reader-stop', agentId: 'agent-1', at: 5 };
const MS = { kind: 'model-switch', how: 'switched', from: 'model-a', to: 'model-b', at: 5 };
const PU = { kind: 'picked-up', messageId: 12, at: 5 };
/** The reply report (Overlord W1 chat, PR B): a fixture text, never one that looks like a secret. */
const RE_UUID = '0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
const RE = { kind: 'reply', entryUuid: RE_UUID, turnAt: 7, text: 'Done: project-a is green.', truncated: false, droppedBefore: null, at: 8 };

export function hookReportCases(m: HookReportsModule): Record<string, SuiteCase> {
  const f = (b: Record<string, unknown>): string | null => { const v = m.hookReportOf(b); return v.ok ? null : v.field; };
  const each = (b: Record<string, unknown>, key: string, vals: unknown[], want: string): void => {
    for (const x of vals) expect(f({ ...b, [key]: x }), `${key}=${String(x)}`).toBe(want);
  };
  return {
    'each kind\'s good body is accepted, optional fields read null': () => {
      for (const b of [W, RS, RP, { kind: 'readers-clear', at: 5 }, MS, PU]) expect(m.hookReportOf(b)).toEqual({ ok: true, report: b });
      expect(m.hookReportOf({ kind: 'witness', key: KEY, tool: 'mcp__door__card', at: 0 })).toEqual({ ok: true, report: { kind: 'witness', key: KEY, tool: 'mcp__door__card', agentId: null, at: 0 } });
      expect(m.hookReportOf({ kind: 'model-switch', how: 'typed-refused', at: 0 })).toEqual({ ok: true, report: { kind: 'model-switch', how: 'typed-refused', from: null, to: null, at: 0 } });
      expect(m.hookReportOf({ kind: 'reader-start', agentId: 'a', at: 0 })).toEqual({ ok: true, report: { kind: 'reader-start', agentId: 'a', agentType: null, at: 0 } });
    },
    'an unknown or missing kind is refused': () => { each({ at: 1 }, 'kind', ['nope', 7, null, undefined, '__proto__', 'toString'], 'kind'); },
    'a witness key that is not 64 lowercase hex': () => { each(W, 'key', ['AB'.repeat(32), 'a'.repeat(63), 'a'.repeat(65), 5, null, `${KEY}\n`], 'key'); },
    'a witness tool outside the door prefix and name grammar': () => {
      each(W, 'tool', ['card', 'mcp__door__', 'mcp__door__Card', 'mcp__door__1a', `mcp__door__${'a'.repeat(65)}`, 'mcp__other__card', 7, 'mcp__door__a-b', `${'x'.repeat(DOOR_TOOL_PREFIX.length)}card`], 'tool');
      expect(f({ ...W, tool: `mcp__door__${'a'.repeat(64)}` })).toBeNull();
    },
    'a witness agent id outside the roster shape': () => { each(W, 'agentId', ['a b', '', 'a'.repeat(65), 'a/b', 7], 'agentId'); },
    'a reader start: agent id and type': () => {
      each(RS, 'agentId', ['a.b', '', undefined, 7, 'a'.repeat(65)], 'agentId');
      each(RS, 'agentType', ['a'.repeat(AGENT_TYPE_MAX + 1), '', 'a\nb', 7], 'agentType');
      expect(f({ ...RS, agentType: 'a'.repeat(AGENT_TYPE_MAX) })).toBeNull();
    },
    'a reader stop: agent id': () => { each(RP, 'agentId', ['a.b', '', undefined, 7, 'a'.repeat(65)], 'agentId'); },
    'a model switch: how, from and to': () => {
      each(MS, 'how', ['other', 7, null, undefined], 'how');
      each(MS, 'from', ['a'.repeat(REPORT_MODEL_MAX + 1), 5, '', 'a\u0000b'], 'from');
      each(MS, 'to', ['a'.repeat(REPORT_MODEL_MAX + 1), 5, '', 'a\u0007b'], 'to');
      expect(f({ ...MS, from: 'a'.repeat(REPORT_MODEL_MAX) })).toBeNull();
    },
    'a picked-up messageId that is not a positive safe integer': () => {
      each(PU, 'messageId', [1.5, 0, -1, '12', null, undefined, Number.MAX_SAFE_INTEGER + 2, NaN], 'messageId');
    },
    'an `at` that is not a non-negative safe integer, for every kind': () => {
      for (const b of [W, RS, RP, { kind: 'readers-clear', at: 5 }, MS, PU, RE]) each(b, 'at', [-1, 1.5, '5', null, undefined, Number.MAX_SAFE_INTEGER + 2], 'at');
      expect(f({ ...PU, at: 0 })).toBeNull();
    },
    // The reply report (PR B): a good body, an absent `droppedBefore` read as null, the text bound in UTF-8 bytes, each field.
    'a reply: the good body, and an absent droppedBefore reads null': () => {
      expect(m.hookReportOf(RE)).toEqual({ ok: true, report: RE });
      const { droppedBefore: _d, ...noDrop } = RE;
      expect(m.hookReportOf(noDrop)).toEqual({ ok: true, report: RE });
      expect(m.hookReportOf({ ...RE, droppedBefore: 3, truncated: true })).toEqual({ ok: true, report: { ...RE, droppedBefore: 3, truncated: true } });
      expect(f({ ...RE, text: 'line one\n\nline two\twith a tab' })).toBeNull();
    },
    'a reply text one byte past REPLY_REPORT_MAX_BYTES is refused, and one at it is accepted': () => {
      expect(f({ ...RE, text: 'a'.repeat(REPLY_REPORT_MAX_BYTES) })).toBeNull();
      expect(f({ ...RE, text: 'a'.repeat(REPLY_REPORT_MAX_BYTES + 1) })).toBe('text');
      // Bytes, not characters: a three-byte character makes a text of fewer characters than the bound one byte too long.
      expect(f({ ...RE, text: `${'a'.repeat(REPLY_REPORT_MAX_BYTES - 2)}€` })).toBe('text');
      each(RE, 'text', ['', 7, null, undefined], 'text');
    },
    'a reply entryUuid that is not a lowercase uuid, a non-integer turnAt, a non-boolean truncated': () => {
      each(RE, 'entryUuid', [RE_UUID.toUpperCase(), RE_UUID.slice(1), `${RE_UUID}\n`, 'not-a-uuid', 7, null, undefined], 'entryUuid');
      each(RE, 'turnAt', [-1, 1.5, '7', null, undefined], 'turnAt');
      each(RE, 'truncated', ['false', 0, null, undefined], 'truncated');
    },
    'a reply droppedBefore that is not a positive integer': () => {
      each(RE, 'droppedBefore', [0, -1, 1.5, '1'], 'droppedBefore');
    },
  };
}

const MUTANTS = [
  { id: 'R1 the unknown-kind refusal removed', old: "  if (!isHookReportKind(kind)) return no('kind');\n", new: '' },
  { id: 'R2 the at check removed', old: "  if (!isCount(at)) return no('at');\n", new: '' },
  { id: 'R3 witness: the key check removed', old: "      if (!isKey(key)) return no('key');\n", new: '' },
  { id: 'R4 witness: the tool check removed', old: "      if (!isTool(tool)) return no('tool');\n", new: '' },
  { id: 'R5 witness: the agent id check removed', old: "      if (agentId === undefined) return no('agentId');\n", new: '' },
  { id: 'R6 reader-start: the agent id check removed', old: "      if (!isAgentId(agentId)) return no('agentId');\n      const agentType", new: '      const agentType' },
  { id: 'R7 reader-start: the type check removed', old: "      if (agentType === undefined) return no('agentType');\n", new: '' },
  { id: 'R8 reader-stop: the agent id check removed', old: "      if (!isAgentId(agentId)) return no('agentId');\n      return { ok: true, report: { kind, agentId, at } };",
    new: '      return { ok: true, report: { kind, agentId: agentId as string, at } };' },
  { id: 'R9 model-switch: the how check removed', old: "      if (!isModelSwitchHow(how)) return no('how');\n", new: '' },
  { id: 'R10 model-switch: the from check removed', old: "      if (from === undefined) return no('from');\n", new: '' },
  { id: 'R11 model-switch: the to check removed', old: "      if (to === undefined) return no('to');\n", new: '' },
  { id: 'R12 picked-up: the messageId check removed', old: "      if (!isPos(messageId)) return no('messageId');\n", new: '' },
  { id: 'R13 the length upper bound loosened', old: 'v.length <= max', new: 'v.length <= max + 1000' },
  { id: 'R14 the length lower bound loosened', old: 'v.length >= 1 &&', new: 'v.length >= 0 &&' },
  { id: 'R15 control characters admitted', old: ' && !/[\\x00-\\x1f\\x7f]/.test(v)', new: '' },
  { id: 'R16 a messageId of zero admitted', old: 'Number.isSafeInteger(v) && v > 0;', new: 'Number.isSafeInteger(v) && v >= 0;' },
  { id: 'R17 a negative at admitted', old: 'Number.isSafeInteger(v) && v >= 0;', new: 'Number.isSafeInteger(v) && v >= -5;' },
  { id: 'R18 the door prefix not required', old: 'v.startsWith(DOOR_TOOL_PREFIX) && ', new: '' },
  { id: 'R19 the tool name grammar not applied', old: ' && DOOR_TOOL_NAME_RE.test(v.slice(DOOR_TOOL_PREFIX.length))', new: '' },
  { id: 'R20 the key shape not applied', old: 'WITNESS_KEY_SHAPE.test(v)', new: 'v.length > 0' },
  // The reply arm (Overlord W1 chat, PR B).
  { id: 'R21 reply: the entryUuid check removed', old: "      if (!isEntryUuid(entryUuid)) return no('entryUuid');\n", new: '' },
  { id: 'R22 reply: the turnAt check removed', old: "      if (!isCount(turnAt)) return no('turnAt');\n", new: '' },
  { id: 'R23 reply: the text check removed', old: "      if (!isReplyText(text)) return no('text');\n", new: '' },
  { id: 'R24 reply: the length bound dropped', old: ' && utf8Bytes(v) <= REPLY_REPORT_MAX_BYTES', new: '' },
  { id: 'R25 reply: the bound counted in characters', old: 'utf8Bytes(v) <= REPLY_REPORT_MAX_BYTES', new: 'v.length <= REPLY_REPORT_MAX_BYTES' },
  { id: 'R26 reply: an empty text admitted', old: "typeof v === 'string' && v !== '' && utf8Bytes(v)", new: "typeof v === 'string' && utf8Bytes(v)" },
  { id: 'R27 reply: the truncated check removed', old: "      if (typeof truncated !== 'boolean') return no('truncated');\n", new: '' },
  { id: 'R28 reply: the droppedBefore check removed', old: "      if (droppedBefore === undefined) return no('droppedBefore');\n", new: '' },
  { id: 'R29 reply: the uuid shape loosened to any case', old: 'const ENTRY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;', new: 'const ENTRY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;' },
] as const;

const HOOK_REPORT_SET: MutantSet<HookReportsModule> = {
  modulePath: path.join(ROOT, 'server/src/continuity/hookReports.ts'),
  mutants: MUTANTS,
  suite: hookReportCases,
};

/** This piece's sets, keyed as `mutation-floors.json` keys them (`<file>#<decider>`). */
export const HOOK_REPORT_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/continuity/hookReports.ts#hookReportOf': HOOK_REPORT_SET as MutantSet<never>,
};
