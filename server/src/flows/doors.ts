// The Flows doors' decisions (spec 2026-11-19 §8). Ring: L1, context Coordination (C5): pure, no I/O. The routes
// (`routes.ts`, L4) ask these and act on the answer; they compare nothing themselves.
import {
  parseFlowDoc, readFlowFile, skeletonFlowDoc, validateFlow, FLOW_LIMITS,
  type FlowDoc, type FlowParse, type FlowProblem, type FlowSource,
} from '../../../shared/flows.js';
import { findTemplate } from './templates.js';

export type DoorRefusal =
  | { ok: false; refusal: 'bad-request'; detail: string }
  | { ok: false; refusal: 'not-found'; detail: string }
  | { ok: false; refusal: 'conflict'; detail: string; problems?: FlowProblem[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A path id: a positive decimal integer, nothing else. */
export function flowIdOf(raw: unknown): number | null {
  return typeof raw === 'string' && /^[1-9][0-9]{0,15}$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
}

/** `POST /api/flows`: an empty flow (the wave skeleton), a copy of a template, or an imported file's document (§14.1), under
 *  the operator's title. An import becomes a draft, never a version, and only one that keeps the rules: the operator has
 *  read its prompts before it is sent, and publishing stays their act. */
export function decideCreate(body: unknown): { ok: true; doc: FlowDoc; source: FlowSource | null } | DoorRefusal {
  const b = isObj(body) ? body : {};
  const title = b.title === undefined ? undefined : typeof b.title === 'string' ? b.title.trim() : null;
  if (title === null || (title !== undefined && (title === '' || title.length > FLOW_LIMITS.title))) {
    return { ok: false, refusal: 'bad-request', detail: `title: 1 to ${FLOW_LIMITS.title} characters` };
  }
  if (b.import !== undefined) {
    if (b.template !== undefined) return { ok: false, refusal: 'bad-request', detail: 'a template or an import, not both' };
    const parsed = readFlowFile(JSON.stringify(b.import));
    if (!parsed.ok) return { ok: false, refusal: 'bad-request', detail: parsed.reason };
    const problems = validateFlow(parsed.doc);
    if (problems.length > 0) return { ok: false, refusal: 'conflict', detail: 'the file breaks the flow rules', problems };
    return { ok: true, doc: { ...parsed.doc, title: title ?? parsed.doc.title }, source: null };
  }
  if (b.template === undefined) return { ok: true, doc: skeletonFlowDoc(title ?? 'New flow'), source: null };
  if (typeof b.template !== 'string') return { ok: false, refusal: 'bad-request', detail: 'template' };
  if (b.version !== undefined && !(typeof b.version === 'number' && Number.isSafeInteger(b.version))) {
    return { ok: false, refusal: 'bad-request', detail: 'version' };
  }
  const t = findTemplate(b.template, b.version as number | undefined);
  if (!t) return { ok: false, refusal: 'not-found', detail: 'no such template' };
  return { ok: true, doc: { ...structuredClone(t.doc), title: title ?? `${t.title} (my copy)` }, source: { template: t.id, version: t.version } };
}

/** `PUT /api/flows/:id/draft`: any document of the right shape. A draft may break the rules; it answers its problems. */
export function decideDraft(body: unknown): { ok: true; doc: FlowDoc; problems: FlowProblem[] } | DoorRefusal {
  const parsed = parseFlowDoc(isObj(body) ? body.doc : undefined);
  if (!parsed.ok) return { ok: false, refusal: 'bad-request', detail: parsed.reason };
  return { ok: true, doc: parsed.doc, problems: validateFlow(parsed.doc) };
}

/** `POST /api/flows/:id/publish`: only a readable draft with no problem becomes a version. */
export function decidePublish(draft: FlowParse | null): { ok: true; doc: FlowDoc } | DoorRefusal {
  if (draft === null) return { ok: false, refusal: 'not-found', detail: 'no such flow' };
  if (!draft.ok) return { ok: false, refusal: 'conflict', detail: `the draft is unreadable: ${draft.reason}` };
  const problems = validateFlow(draft.doc);
  if (problems.length > 0) return { ok: false, refusal: 'conflict', detail: 'the draft breaks the flow rules', problems };
  return { ok: true, doc: draft.doc };
}

/** A read's problems: none to report for a draft the read could not parse (its reason says why). */
export const problemsOf = (draft: FlowParse): FlowProblem[] => (draft.ok ? validateFlow(draft.doc) : []);

/** `PUT /api/flows/default`: `{ flowId }`, a flow id or null to clear. Whether the flow can be one is the store's. */
export function decideDefault(body: unknown): { ok: true; flowId: number | null } | DoorRefusal {
  const v = isObj(body) ? body.flowId : undefined;
  if (v === null) return { ok: true, flowId: null };
  if (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) return { ok: true, flowId: v };
  return { ok: false, refusal: 'bad-request', detail: 'flowId must be a flow id or null' };
}
