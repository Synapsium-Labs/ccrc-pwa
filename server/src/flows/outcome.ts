// A flow outcome a coordinator reports, and where the flow would go next (Flows wave 3b, plan `2026-11-20-flows-w3b.md`).
// Ring: L1, context Coordination (C5): pure. The engine's SHADOW: the answer is recorded (`flowsStore.recordFlowOutcome`)
// and returned, and nothing is sent. Only an instruction or a skill block takes a reported outcome: a protocol step is the
// run machine's to observe (spec §5) and a gate is the server's to measure (wave 4), except an `attested` gate (wave 4a):
// the coordinator reports its outcome WITH the evidence, and the record names who attested it. The server runs nothing.
import { renderFlowPrompt, type FlowDoc, type FlowParse, type FlowVar } from '../../../shared/flows.js';

export type OutcomeVerdict =
  | { ok: true; blockId: string; outcome: string; next: string; wouldSend: string; evidence: string | null }
  | { ok: false; refusal: 'bad-request' | 'conflict'; detail: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const utf8 = (s: string): number => new TextEncoder().encode(s).length;
/** The most an attested gate's evidence may hold (characters). */
export const EVIDENCE_MAX = 2000;

/** What entering `next` would do: compose a prompt (its size and what the server could not fill), observe a protocol
 *  step, or measure a gate. */
export function wouldSendOf(doc: FlowDoc, next: string, vars: Partial<Record<FlowVar, string>>): string {
  const b = doc.blocks.find((x) => x.id === next);
  if (!b) return `nothing: ${next} is not a block`;
  if (b.kind === 'protocol') return `observe ${b.step}`;
  if (b.kind === 'gate') return `measure ${b.gate?.kind ?? 'gate'}`;
  const r = renderFlowPrompt(b, vars);
  return `send ${b.role} ${next} bytes=${utf8(r.text)} missing=${r.missing.length ? r.missing.join(',') : 'none'}`;
}

/** `{ block, outcome }` against the programme's pinned flow. `doc` null: the programme pinned none, or its version
 *  cannot be read; both are a conflict, said apart. */
export function decideOutcome(
  doc: FlowParse | null, pinned: boolean, body: unknown, vars: Partial<Record<FlowVar, string>>,
): OutcomeVerdict {
  const b = isObj(body) ? body : {};
  const block = b['block'];
  const outcome = b['outcome'];
  if (typeof block !== 'string' || block === '' || typeof outcome !== 'string' || outcome === '') {
    return { ok: false, refusal: 'bad-request', detail: 'block and outcome are required strings' };
  }
  if (!pinned) return { ok: false, refusal: 'conflict', detail: 'the programme follows no flow' };
  if (doc === null || !doc.ok) return { ok: false, refusal: 'conflict', detail: `the pinned version cannot be read${doc && !doc.ok ? `: ${doc.reason}` : ''}` };
  const d = doc.doc;
  const at = d.blocks.find((x) => x.id === block);
  if (!at) return { ok: false, refusal: 'conflict', detail: `${block} is not a block of the pinned flow` };
  if (at.kind === 'protocol') return { ok: false, refusal: 'conflict', detail: `${block} is ccrc's own step: the run machine reports it` };
  const attested = at.kind === 'gate' && at.gate?.kind === 'attested';
  if (at.kind === 'gate' && !attested) return { ok: false, refusal: 'conflict', detail: `${block} is a gate: the server measures it` };
  const ev = b['evidence'];
  if (attested && (typeof ev !== 'string' || ev.trim() === '' || ev.length > EVIDENCE_MAX)) {
    return { ok: false, refusal: 'bad-request', detail: `an attested gate takes evidence: one to ${EVIDENCE_MAX} characters` };
  }
  if (!at.outcomes.includes(outcome)) {
    return { ok: false, refusal: 'conflict', detail: `${block} answers ${at.outcomes.join(' or ')}, not ${outcome}` };
  }
  const edge = d.edges.find((e) => e.from === block && e.outcome === outcome);
  if (!edge) return { ok: false, refusal: 'conflict', detail: `${block}'s ${outcome} leads nowhere in the pinned flow` };
  return { ok: true, blockId: block, outcome, next: edge.to, wouldSend: wouldSendOf(d, edge.to, vars), evidence: attested ? (ev as string) : null };
}
