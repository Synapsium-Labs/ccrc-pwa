// The brief a programme's pinned flow would compose, beside the one a dispatch sent (Flows wave 2, plan
// `2026-11-19-flows-w2.md` Task 4). Ring: L1, context Coordination (C5): pure. `dispatchRun` (L4) records the answer as
// one `run_events` detail and sends nothing new: in this wave the composed brief is measured, never delivered.
import { briefBlockFor, renderFlowPrompt, type FlowParse, type FlowVar } from '../../../shared/flows.js';

export interface FlowBriefShadowInput {
  /** The programme's flow pin; null when it pinned none. */
  pin: { flowId: number; version: number } | null;
  /** The pinned version's document; null when its row could not be read. */
  doc: FlowParse | null;
  kind: 'work' | 'review';
  vars: Partial<Record<FlowVar, string>>;
  /** The kickoff prefix the flow's brief would carry, as today's does. */
  prefix: string;
  /** The UTF-8 size of the brief actually sent (prefix and the coordinator's text). */
  todayBytes: number;
}

const utf8 = (s: string): number => new TextEncoder().encode(s).length;

/** One of `flow-brief:no-flow`, `flow-brief:unreadable <id>@<v>` (`unreadable programme` when the pin itself could not be
 *  read: `dispatch.ts#flowBriefShadowOf`), `flow-brief:no-block <id>@<v>`, or
 *  `flow-brief:composed <id>@<v> bytes=<n> today=<n> missing=<vars|none>`. */
export function flowBriefShadow(input: FlowBriefShadowInput): string {
  const { pin, doc } = input;
  if (pin === null) return 'flow-brief:no-flow';
  const at = `${pin.flowId}@${pin.version}`;
  if (doc === null || !doc.ok) return `flow-brief:unreadable ${at}`;
  const block = briefBlockFor(doc.doc, input.kind);
  if (block === null) return `flow-brief:no-block ${at}`;
  const r = renderFlowPrompt(block, input.vars);
  const missing = r.missing.length ? r.missing.join(',') : 'none';
  return `flow-brief:composed ${at} bytes=${utf8(input.prefix + r.text)} today=${input.todayBytes} missing=${missing}`;
}
