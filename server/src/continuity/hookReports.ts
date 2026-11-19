// L1, context C3 (Session Conversation): the session hook's report, narrowed (Overlord spec §3.6 H1, Table 11.1e "The hook's
// reports"; plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-door-process.md`, Task 7). Pure: the body arrives as an
// argument; nothing reads a clock, a file or the store.
//
// `hookReportOf` is the report door's one narrowing: it bounds every string, refuses an unknown kind (unlike the loads report,
// a kind is the whole of a report, so there is nothing to drop), and names the first field that does not narrow. Optional
// fields the body leaves out read as null, never as an empty string. The hook's clock `at` is kept as sent; every window the
// server reads uses its own `receivedAt` (the store's column), so a hook with a wrong clock moves no window.
import {
  AGENT_ID_RE, AGENT_TYPE_MAX, DOOR_TOOL_NAME_RE, DOOR_TOOL_PREFIX, REPORT_MODEL_MAX, WITNESS_KEY_SHAPE, isHookReportKind,
  isModelSwitchHow, type HookReport,
} from '../../../shared/continuity-reports.js';

export type HookReportVerdict = { readonly ok: true; readonly report: HookReport } | { readonly ok: false; readonly field: string };

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isPos = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
/** A bounded printable string: 1 to `max` characters, no control character. */
const text = (max: number) => (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);
/** An optional field: absent or null reads null; a present value must narrow, else `undefined` (the caller refuses it). */
const opt = <T>(v: unknown, ok: (x: unknown) => x is T): T | null | undefined => (v === null || v === undefined ? null : ok(v) ? v : undefined);
const isAgentId = (v: unknown): v is string => typeof v === 'string' && AGENT_ID_RE.test(v);
const isTool = (v: unknown): v is string =>
  typeof v === 'string' && v.startsWith(DOOR_TOOL_PREFIX) && DOOR_TOOL_NAME_RE.test(v.slice(DOOR_TOOL_PREFIX.length));
const isKey = (v: unknown): v is string => typeof v === 'string' && WITNESS_KEY_SHAPE.test(v);

const no = (field: string): HookReportVerdict => ({ ok: false, field });

export function hookReportOf(body: Record<string, unknown>): HookReportVerdict {
  const kind = body['kind'];
  if (!isHookReportKind(kind)) return no('kind');
  const at = body['at'];
  if (!isCount(at)) return no('at');
  switch (kind) {
    case 'witness': {
      const key = body['key'];
      const tool = body['tool'];
      if (!isKey(key)) return no('key');
      if (!isTool(tool)) return no('tool');
      const agentId = opt(body['agentId'], isAgentId);
      if (agentId === undefined) return no('agentId');
      return { ok: true, report: { kind, key, tool, agentId, at } };
    }
    case 'reader-start': {
      const agentId = body['agentId'];
      if (!isAgentId(agentId)) return no('agentId');
      const agentType = opt(body['agentType'], text(AGENT_TYPE_MAX));
      if (agentType === undefined) return no('agentType');
      return { ok: true, report: { kind, agentId, agentType, at } };
    }
    case 'reader-stop': {
      const agentId = body['agentId'];
      if (!isAgentId(agentId)) return no('agentId');
      return { ok: true, report: { kind, agentId, at } };
    }
    case 'readers-clear':
      return { ok: true, report: { kind, at } };
    case 'model-switch': {
      const how = body['how'];
      if (!isModelSwitchHow(how)) return no('how');
      const from = opt(body['from'], text(REPORT_MODEL_MAX));
      if (from === undefined) return no('from');
      const to = opt(body['to'], text(REPORT_MODEL_MAX));
      if (to === undefined) return no('to');
      return { ok: true, report: { kind, how, from, to, at } };
    }
    case 'picked-up': {
      const messageId = body['messageId'];
      if (!isPos(messageId)) return no('messageId');
      return { ok: true, report: { kind, messageId, at } };
    }
  }
}
